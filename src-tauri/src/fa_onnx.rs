// ---------------------------------------------------------------------------
// Real ONNX forward pass for forced alignment (WS1 Task 5, Slice D2).
//
// Entirely behind the `fa-inference` Cargo feature (see this whole file's
// module-level `#![cfg(...)]` below) — with that feature off, none of this
// compiles and `ort` is absent from the build graph. `fa.rs`'s `fa_align`
// calls [`align`] only from its own `#[cfg(feature = "fa-inference")]` arm.
//
// Scope (WS1 Task 5 Slice D2 boundary — see docs/ws1-sync-pipeline/
// measurements/runtime-unblock-2026-08-12.md for the ort/onnxruntime
// version-deadlock resolution this wiring is built on):
//   - WAV decode + per-utterance zero-mean/unit-variance normalization,
//     matching transformers' Wav2Vec2FeatureExtractor(do_normalize=True)
//     exactly (verified against that class's own `zero_mean_unit_var_norm`
//     source, see `scripts/capture-fa-onnx-reference.py`'s docstring).
//   - ONNX session load + forward pass via `ort`, log_softmax over the
//     logits (matching torchaudio.functional.forced_align's expected input
//     convention, NOT raw logits).
//   - A MINIMAL, embedded per-language vocab (the same jonatasgrosman
//     HF-tokenizer vocab already captured at `scripts/fixtures/
//     fa-vocab-<lang>.json`) for the id-mapping (`char_to_id`/`blank_id`/
//     `word_delim_id`) side of tokenization. Text NORMALIZATION itself (WS1
//     Task 5 Slice D3) routes through `crate::fa::text`, the Rust port of
//     `src/services/faTextNormalize.ts` — vocab-aware, diacritic-preserving,
//     German ß->ss, digit-bearing/unspellable words dropped and recorded.
//     `src/services/textNormalize.ts`'s `canonicalize()` remains the source
//     of truth for Whisper/Hirschberg alignment specifically and is
//     untouched by either slice — see `crate::fa::text`'s module doc comment
//     for why the two are deliberately parallel, not shared.
//   - Handing the resulting emission matrix + normalized target tokens to the
//     already-ported Viterbi DP (`fa_viterbi::forced_align`/`merge_tokens`).
//
// Deliberately NOT in scope here (later, separately-decided slices):
//   - Per-segment audio windowing/onset search, multi-segment span
//     attribution beyond simple token-count bookkeeping, anchor derivation,
//     `anchorSource`/`CONF_MIN` (unrelated TS-side concerns, untouched).
//   - Session/model caching across calls (a 1.2+ GiB ONNX file is reloaded
//     on every `align()` call today — a real cost, deferred).
// ---------------------------------------------------------------------------
#![cfg(feature = "fa-inference")]

use crate::fa::text::{normalize_for_forced_alignment, Language};
use crate::fa::FaSegmentInput;
use crate::fa_viterbi::{forced_align, merge_tokens, AlignError, TokenSpan};
use ort::session::Session;
use ort::value::Tensor;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fmt;
use std::path::Path;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum FaOnnxError {
    ModelNotFound(crate::fa::FaError),
    Wav(WavError),
    OrtInit(String),
    OrtSession(String),
    OrtRun(String),
    UnsupportedLanguage(String),
    EmptyTokenization,
    Align(AlignError),
}

impl fmt::Display for FaOnnxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FaOnnxError::ModelNotFound(e) => write!(f, "{}", e.message),
            FaOnnxError::Wav(e) => write!(f, "failed to decode audio: {e}"),
            FaOnnxError::OrtInit(msg) => write!(f, "failed to initialize onnxruntime: {msg}"),
            FaOnnxError::OrtSession(msg) => write!(f, "failed to load ONNX session: {msg}"),
            FaOnnxError::OrtRun(msg) => write!(f, "ONNX forward pass failed: {msg}"),
            FaOnnxError::UnsupportedLanguage(lang) => write!(f, "no FA vocab for language \"{lang}\""),
            FaOnnxError::EmptyTokenization => {
                write!(f, "segment text produced zero target tokens after tokenization")
            }
            FaOnnxError::Align(e) => write!(f, "forced alignment failed: {e}"),
        }
    }
}

impl std::error::Error for FaOnnxError {}

// ---------------------------------------------------------------------------
// WAV decode (minimal canonical PCM16 mono 16kHz reader — no crate added;
// `audio_path` is always this codebase's own 16kHz-mono WAV convention, the
// same one `whisper.rs::transcode_to_wav` produces)
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum WavError {
    Io(String),
    NotRiffWave,
    MissingFmtChunk,
    MissingDataChunk,
    Truncated,
    UnsupportedFormat { channels: u16, bits_per_sample: u16, sample_rate: u32 },
}

impl fmt::Display for WavError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WavError::Io(msg) => write!(f, "I/O error: {msg}"),
            WavError::NotRiffWave => write!(f, "not a RIFF/WAVE file"),
            WavError::MissingFmtChunk => write!(f, "missing or malformed \"fmt \" chunk"),
            WavError::MissingDataChunk => write!(f, "missing \"data\" chunk"),
            WavError::Truncated => write!(f, "truncated WAV file"),
            WavError::UnsupportedFormat { channels, bits_per_sample, sample_rate } => write!(
                f,
                "unsupported WAV format: {channels} channel(s), {bits_per_sample}-bit, \
                 {sample_rate}Hz — expected 1 channel, 16-bit, 16000Hz"
            ),
        }
    }
}

pub fn read_wav_mono_16k(path: &Path) -> Result<Vec<f32>, WavError> {
    let bytes = std::fs::read(path).map_err(|e| WavError::Io(e.to_string()))?;
    parse_wav_pcm16_mono_16k(&bytes)
}

fn parse_wav_pcm16_mono_16k(bytes: &[u8]) -> Result<Vec<f32>, WavError> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(WavError::NotRiffWave);
    }

    let mut pos = 12usize;
    let mut channels: Option<u16> = None;
    let mut sample_rate: Option<u32> = None;
    let mut bits_per_sample: Option<u16> = None;
    let mut data: Option<&[u8]> = None;

    while pos + 8 <= bytes.len() {
        let chunk_id = &bytes[pos..pos + 4];
        let chunk_size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let body_start = pos + 8;
        let body_end = body_start.checked_add(chunk_size).ok_or(WavError::Truncated)?;
        if body_end > bytes.len() {
            return Err(WavError::Truncated);
        }

        if chunk_id == b"fmt " {
            if chunk_size < 16 {
                return Err(WavError::MissingFmtChunk);
            }
            let fmt = &bytes[body_start..body_end];
            channels = Some(u16::from_le_bytes(fmt[2..4].try_into().unwrap()));
            sample_rate = Some(u32::from_le_bytes(fmt[4..8].try_into().unwrap()));
            bits_per_sample = Some(u16::from_le_bytes(fmt[14..16].try_into().unwrap()));
        } else if chunk_id == b"data" {
            data = Some(&bytes[body_start..body_end]);
        }

        // RIFF chunks are word-aligned: an odd-sized chunk body is followed
        // by one padding byte not counted in chunk_size.
        pos = body_end + (chunk_size % 2);
    }

    let channels = channels.ok_or(WavError::MissingFmtChunk)?;
    let sample_rate = sample_rate.ok_or(WavError::MissingFmtChunk)?;
    let bits_per_sample = bits_per_sample.ok_or(WavError::MissingFmtChunk)?;
    let data = data.ok_or(WavError::MissingDataChunk)?;

    if channels != 1 || bits_per_sample != 16 || sample_rate != 16000 {
        return Err(WavError::UnsupportedFormat { channels, bits_per_sample, sample_rate });
    }

    Ok(data
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
        .collect())
}

// ---------------------------------------------------------------------------
// Preprocessing
// ---------------------------------------------------------------------------

/// Zero-mean/unit-variance normalization, matching transformers'
/// `Wav2Vec2FeatureExtractor.zero_mean_unit_var_norm`'s no-attention-mask
/// branch exactly: `(x - x.mean()) / sqrt(x.var() + 1e-7)`, population
/// variance. f64 accumulation for numerical stability; the final cast to
/// f32 is what the model actually consumes either way.
pub fn zero_mean_unit_var_norm(samples: &[f32]) -> Vec<f32> {
    let n = samples.len() as f64;
    let mean = samples.iter().map(|&x| x as f64).sum::<f64>() / n;
    let var = samples.iter().map(|&x| { let d = x as f64 - mean; d * d }).sum::<f64>() / n;
    let denom = (var + 1e-7).sqrt();
    samples.iter().map(|&x| ((x as f64 - mean) / denom) as f32).collect()
}

/// In-place log-softmax over one emission row (one frame's per-class
/// logits), matching `torch.log_softmax(logits, dim=-1)` — the convention
/// `fa_viterbi::forced_align` expects (log-probabilities, not raw logits).
fn log_softmax_row(row: &mut [f32]) {
    let max = row.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let mut sum = 0.0f32;
    for v in row.iter_mut() {
        *v -= max;
        sum += v.exp();
    }
    let log_sum = sum.ln();
    for v in row.iter_mut() {
        *v -= log_sum;
    }
}

// ---------------------------------------------------------------------------
// ONNX forward pass
// ---------------------------------------------------------------------------

/// Runs `input_samples` (already zero-mean/unit-variance normalized) through
/// the ONNX model at `model_path`, returning the per-frame log-probability
/// emission matrix (`T` rows of `C` classes). Resolves the onnxruntime C
/// library purely via the `ORT_DYLIB_PATH` environment variable — nothing is
/// vendored, downloaded, or bundled by this crate. `ort::init_from(..)
/// .commit()` is safe to call on every invocation (an idempotent
/// try-insert-once against a process-global static, not a hard re-init
/// error — see `ort`'s own `EnvironmentBuilder::commit` source).
pub fn run_forward_pass(model_path: &Path, input_samples: &[f32]) -> Result<Vec<Vec<f32>>, FaOnnxError> {
    let dylib_path = std::env::var("ORT_DYLIB_PATH")
        .map_err(|_| FaOnnxError::OrtInit("ORT_DYLIB_PATH not set".to_string()))?;
    let builder = ort::init_from(dylib_path).map_err(|e| FaOnnxError::OrtInit(e.to_string()))?;
    builder.commit();

    let mut session = Session::builder()
        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?
        .commit_from_file(model_path)
        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?;

    let n = input_samples.len();
    let input = Tensor::from_array(([1usize, n], input_samples.to_vec().into_boxed_slice()))
        .map_err(|e| FaOnnxError::OrtRun(e.to_string()))?;

    let outputs = session
        .run(ort::inputs!["input_values" => input])
        .map_err(|e| FaOnnxError::OrtRun(e.to_string()))?;

    let (shape, data) = outputs["logits"]
        .try_extract_tensor::<f32>()
        .map_err(|e| FaOnnxError::OrtRun(e.to_string()))?;

    if shape.len() != 3 {
        return Err(FaOnnxError::OrtRun(format!("unexpected output rank: {shape:?}")));
    }
    let t = shape[1] as usize;
    let c = shape[2] as usize;

    let mut emission = Vec::with_capacity(t);
    for i in 0..t {
        let mut row = data[i * c..(i + 1) * c].to_vec();
        log_softmax_row(&mut row);
        emission.push(row);
    }
    Ok(emission)
}

/// Every call site of [`run_forward_pass`] in this crate — this one included
/// — routes its call through here (WS1 Task 5 Slice D6). Serializes access
/// against the `missing_dylib` test module's deliberate `ORT_DYLIB_PATH`
/// remove-var/restore-var critical section: `run_forward_pass`'s first line
/// reads that env var, and Rust env vars are real process-global state, so a
/// naive `remove_var` in one test thread is racy against any other thread
/// concurrently inside a `run_forward_pass` call that expects the var
/// present. `require_ort::ort_dylib_or_skip`'s own gate-check read is
/// SEPARATELY guarded by the same `ORT_ENV_LOCK` (see that function's doc
/// comment) — an earlier version of this scheme assumed the unlocked gate
/// check was harmless since it "never mutates anything," which is true but
/// beside the point: under `FA_REQUIRE_ORT=1` that check's own PANIC branch
/// makes an unlucky interleaving against this test's remove-var window
/// directly observable as a spurious failure of an unrelated test — caught
/// by actually running the full suite concurrently against
/// `missing_dylib_returns_ort_init_error` (see that test's own doc comment),
/// not by reasoning alone. Both guards together are what make this
/// deterministic. See `require_ort::ORT_ENV_LOCK` for the shared primitive.
///
/// A plain passthrough (no lock, zero overhead) outside test builds —
/// `require_ort` itself is `#[cfg(test)]`-only, and a single real production
/// `fa_align` call is never contended anyway, so there is nothing to
/// serialize against there.
#[cfg(test)]
fn with_ort_env_lock<T>(f: impl FnOnce() -> T) -> T {
    let _guard = require_ort::ORT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f()
}
#[cfg(not(test))]
fn with_ort_env_lock<T>(f: impl FnOnce() -> T) -> T {
    f()
}

// ---------------------------------------------------------------------------
// Frame -> time conversion (WS1 Task 5 Slice D6)
//
// The emission matrix `run_forward_pass` returns has one row per output
// FRAME of the model's own convolutional feature encoder, not one row per
// audio sample — converting a frame index to a wall-clock second requires
// knowing that encoder's sample-domain stride.
//
// STRIDE SOURCE (authoritative, not guessed): every jonatasgrosman
// wav2vec2-large-xlsr-53-<lang> model (`export-fa-onnx.py`'s `REPO_IDS`, R-Q)
// is one shared Wav2Vec2ForCTC architecture. Its `Wav2Vec2FeatureEncoder` is
// 7 conv1d layers with `conv_stride = [5, 2, 2, 2, 2, 2, 2]` — read directly
// from each of the five languages' own HF `config.json` (local export
// scratch under `.work-phase4/spike-runtime/models/{english,spanish,french,
// german,portuguese}/config.json`, gitignored, not committed — produced by
// `export-fa-onnx.py`'s own model-loading step). All five are
// byte-identical: `[5, 2, 2, 2, 2, 2, 2]`, confirmed by direct inspection
// before writing this constant, not assumed from R-Q's architecture claim
// alone. The product of that list — 5*2*2*2*2*2*2 = 320 — is the number of
// INPUT SAMPLES the encoder consumes per output frame it advances by; this
// IS the actual computation producing the emission's frame axis (a
// structural property of the model graph), which makes it authoritative in
// a way neither of the two alternatives this slice was told to avoid can be:
// a hardcoded ~50fps constant is a rounded restatement of the same number
// with digits thrown away, and the fixtures' own `_provenance.frame_rate_fps`
// (`fa-emission-*.json`, a DIFFERENT model/vocab family — MMS_FA, not this
// jonatasgrosman family) is an empirically-measured `frame_count /
// audio_duration_seconds` ratio that is NOT exactly 1/0.02 because the real
// conv output-length formula (`floor((L_in - kernel)/stride) + 1`, chained
// over all 7 layers) truncates at each layer's boundary — its ratio drifts
// per-clip near those truncation boundaries (measured 49.615/49.823/49.841,
// never exactly 50.0) precisely because it is downstream of stride, not a
// second independent measurement of it.
//
// This module's own emission rows are always 16kHz-domain (`read_wav_mono_
// 16k`/`zero_mean_unit_var_norm` both operate on the fixed 16kHz WAV
// convention `whisper.rs::transcode_to_wav` produces, asserted directly in
// `parse_wav_pcm16_mono_16k`), so the sample rate half of the stride ratio is
// the same fixed constant every input in this codebase already assumes.
// Not called from production code yet — no windowing/span-consumption caller
// exists (out of scope for this slice, see task boundary), so these are
// exercised only by the `frame_to_seconds` test module below regardless of
// feature configuration. Same "established but unwired" pattern as
// `TokenSpan::len`/`is_empty` above.
#[allow(dead_code)]
pub const FA_FRAME_STRIDE_SAMPLES: u32 = 320;
#[allow(dead_code)]
pub const FA_SAMPLE_RATE_HZ: u32 = 16_000;

/// Converts an emission-matrix frame index to a wall-clock second, via the
/// model's real stride (see module section doc comment above) — never a
/// hardcoded fps constant, never the `fa-emission-*.json` fixtures'
/// empirically-measured `frame_rate_fps` provenance field (a different model
/// family, and downstream of stride rather than a second measurement of it).
/// f64 throughout: single multiply-then-divide, no accumulation, so this
/// carries none of the summation error a naive `frame * SECONDS_PER_FRAME`
/// loop could in principle accrue over many calls — not that it matters here,
/// since each call is independent and this is a pure function of its input.
#[allow(dead_code)]
pub fn frame_to_seconds(frame_index: usize) -> f64 {
    frame_index as f64 * (FA_FRAME_STRIDE_SAMPLES as f64 / FA_SAMPLE_RATE_HZ as f64)
}

/// Convenience wrapper for a [`TokenSpan`]'s own `start`/`end` frame indices
/// — `(start_seconds, end_seconds)`, `start` inclusive, `end` exclusive,
/// matching the span's own frame-domain convention (`fa_viterbi.rs`'s
/// `TokenSpan` doc comment).
#[allow(dead_code)]
pub fn token_span_seconds(span: &TokenSpan) -> (f64, f64) {
    (frame_to_seconds(span.start), frame_to_seconds(span.end))
}

// ---------------------------------------------------------------------------
// Minimal embedded vocab (id-mapping side) + vocab-aware tokenization via
// `crate::fa::text` (see module doc comment)
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct Vocab {
    char_to_id: HashMap<char, i64>,
    /// The vocab-membership character set `crate::fa::text::
    /// normalize_for_forced_alignment` checks against — derived via that
    /// same module's `vocab_chars_from_raw_vocab` (not re-derived from
    /// `char_to_id`'s keys independently), so the two never drift.
    chars: HashSet<char>,
    blank_id: i64,
    word_delim_id: Option<i64>,
}

fn vocab_json_for(language: &str) -> Result<&'static str, FaOnnxError> {
    match language {
        "en" => Ok(include_str!("../../scripts/fixtures/fa-vocab-en.json")),
        "es" => Ok(include_str!("../../scripts/fixtures/fa-vocab-es.json")),
        "fr" => Ok(include_str!("../../scripts/fixtures/fa-vocab-fr.json")),
        "de" => Ok(include_str!("../../scripts/fixtures/fa-vocab-de.json")),
        "pt" => Ok(include_str!("../../scripts/fixtures/fa-vocab-pt.json")),
        other => Err(FaOnnxError::UnsupportedLanguage(other.to_string())),
    }
}

fn load_vocab(language: &str) -> Result<Vocab, FaOnnxError> {
    let json_str = vocab_json_for(language)?;
    let parsed: serde_json::Value =
        serde_json::from_str(json_str).expect("embedded fa-vocab-*.json must parse");
    let vocab_obj = parsed["vocab"].as_object().expect("embedded fa-vocab-*.json must have a vocab object");
    let chars = crate::fa::text::vocab_chars_from_raw_vocab(vocab_obj);

    let mut char_to_id = HashMap::new();
    let mut blank_id = 0i64;
    let mut word_delim_id = None;
    for (key, value) in vocab_obj {
        let id = value.as_i64().expect("vocab id must be an integer");
        if key == "<pad>" {
            blank_id = id;
        } else if key == "|" {
            word_delim_id = Some(id);
        } else if key.chars().count() == 1 {
            char_to_id.insert(key.chars().next().unwrap(), id);
        }
        // Multi-char special tokens other than "<pad>" (e.g. "<s>", "</s>",
        // "<unk>") are not targetable by `text_to_token_ids` — normalized
        // text never needs to align to them directly.
    }
    Ok(Vocab { char_to_id, chars, blank_id, word_delim_id })
}

/// Vocab-aware text-to-token-id mapping: normalizes `text` via
/// `crate::fa::text::normalize_for_forced_alignment` (diacritic-preserving,
/// German ß->ss, digit-bearing/unspellable words dropped) and maps each
/// representable word's characters to `vocab`'s ids, inserting a single
/// word-delimiter id strictly BETWEEN representable words (never leading or
/// trailing — there is nothing to trim, unlike the old naive tokenizer,
/// since normalization already produces a single-space-joined, edge-trimmed
/// `text`). An unrepresentable word (dropped by normalization) contributes
/// no ids at all, not a delimiter placeholder.
fn text_to_token_ids(text: &str, language: Language, vocab: &Vocab) -> Vec<i64> {
    let normalized = normalize_for_forced_alignment(text, language, &vocab.chars);

    let mut ids = Vec::new();
    let mut first = true;
    for word in normalized.words.iter().filter(|w| w.representable) {
        if !first {
            if let Some(delim) = vocab.word_delim_id {
                ids.push(delim);
            }
        }
        first = false;
        let mapped = word.mapped.as_deref().expect("representable word must have `mapped` set");
        for ch in mapped.chars() {
            let id = *vocab
                .char_to_id
                .get(&ch)
                .unwrap_or_else(|| panic!("normalized word \"{mapped}\" contains char {ch:?} absent from vocab — normalize_for_forced_alignment invariant violated"));
            ids.push(id);
        }
    }
    ids
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/// Real `fa_align` implementation: resolves the ONNX model for `language`,
/// decodes+normalizes `audio_path`, runs the forward pass, vocab-aware-
/// normalizes and tokenizes the concatenation of every segment's text (see
/// module doc comment), and hands the emission matrix + target tokens to the
/// ported Viterbi DP. Returns the merged token spans (frame-index start/end
/// per target token) — not yet surfaced over IPC (see `fa.rs::fa_align`'s
/// doc comment: frontend wiring is a separate, later slice).
pub fn align(
    app: &tauri::AppHandle,
    audio_path: &str,
    segments: &[FaSegmentInput],
    language: &str,
) -> Result<Vec<TokenSpan>, FaOnnxError> {
    let model_path = crate::fa::fa_model_path(app, language).map_err(FaOnnxError::ModelNotFound)?;
    align_with_model_path(&model_path, audio_path, segments, language)
}

/// [`align`]'s body, minus model-path resolution — split out (WS1 Task 5
/// Slice D6) so tests can drive the real pipeline (WAV decode, normalize,
/// forward pass, tokenize, Viterbi) with an already-known `model_path`,
/// without a live `tauri::AppHandle` — nothing in this crate's test suite
/// constructs one (see `onnx_fixture_parity`/`e2e_parity`'s own
/// `fa_models_dir()` doc comments for why: those tests independently
/// reproduce the production resolver's path convention for the same reason).
/// `align` itself is now a two-line wrapper around this; behavior is
/// unchanged for the real `fa_align` IPC caller.
fn align_with_model_path(
    model_path: &Path,
    audio_path: &str,
    segments: &[FaSegmentInput],
    language: &str,
) -> Result<Vec<TokenSpan>, FaOnnxError> {
    let samples = read_wav_mono_16k(Path::new(audio_path)).map_err(FaOnnxError::Wav)?;
    let normed = zero_mean_unit_var_norm(&samples);
    let emission = with_ort_env_lock(|| run_forward_pass(model_path, &normed))?;

    let vocab = load_vocab(language)?;
    let lang_enum = Language::from_code(language).ok_or_else(|| FaOnnxError::UnsupportedLanguage(language.to_string()))?;
    let combined_text = segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
    let target_ids = text_to_token_ids(&combined_text, lang_enum, &vocab);
    if target_ids.is_empty() {
        return Err(FaOnnxError::EmptyTokenization);
    }

    let result = forced_align(&emission, &target_ids, vocab.blank_id).map_err(FaOnnxError::Align)?;
    Ok(merge_tokens(&result.path, &result.scores, vocab.blank_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- WAV parsing ------------------------------------------------------

    fn build_wav(channels: u16, sample_rate: u32, bits_per_sample: u16, samples: &[i16]) -> Vec<u8> {
        let block_align = channels * (bits_per_sample / 8);
        let byte_rate = sample_rate * block_align as u32;
        let data_bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_bytes.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&channels.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&byte_rate.to_le_bytes());
        bytes.extend_from_slice(&block_align.to_le_bytes());
        bytes.extend_from_slice(&bits_per_sample.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(data_bytes.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&data_bytes);
        bytes
    }

    #[test]
    fn parses_canonical_pcm16_mono_16k() {
        let wav = build_wav(1, 16000, 16, &[0, 16384, -16384, 32767, -32768]);
        let samples = parse_wav_pcm16_mono_16k(&wav).unwrap();
        assert_eq!(samples.len(), 5);
        assert!((samples[0] - 0.0).abs() < 1e-6);
        assert!((samples[1] - 0.5).abs() < 1e-4);
        assert!((samples[2] - (-0.5)).abs() < 1e-4);
    }

    #[test]
    fn rejects_stereo() {
        let wav = build_wav(2, 16000, 16, &[0, 0, 100, 100]);
        let err = parse_wav_pcm16_mono_16k(&wav).unwrap_err();
        assert!(matches!(err, WavError::UnsupportedFormat { channels: 2, .. }));
    }

    #[test]
    fn rejects_wrong_sample_rate() {
        let wav = build_wav(1, 44100, 16, &[0, 1, 2]);
        let err = parse_wav_pcm16_mono_16k(&wav).unwrap_err();
        assert!(matches!(err, WavError::UnsupportedFormat { sample_rate: 44100, .. }));
    }

    #[test]
    fn rejects_non_riff() {
        let err = parse_wav_pcm16_mono_16k(b"not a wav file at all").unwrap_err();
        assert!(matches!(err, WavError::NotRiffWave));
    }

    #[test]
    fn handles_odd_sized_chunk_padding() {
        // A odd-sized (e.g. 3-byte) LIST chunk before "data" must be
        // skipped with correct word-alignment padding, or "data" is missed.
        let mut wav = build_wav(1, 16000, 16, &[1, 2, 3]);
        // Splice a fake 3-byte odd chunk right after the "fmt " chunk (which
        // ends at byte 8+8+16=... build_wav's fmt chunk is fixed 16 bytes,
        // header 12 + "fmt " 8 + 16 = 36 bytes in).
        let mut spliced = wav[..36].to_vec();
        spliced.extend_from_slice(b"LIST");
        spliced.extend_from_slice(&3u32.to_le_bytes());
        spliced.extend_from_slice(&[9, 9, 9]);
        spliced.push(0); // word-alignment pad byte
        spliced.extend_from_slice(&wav[36..]);
        // Fix RIFF size field for the extra 12 bytes inserted (8 header + 3 body + 1 pad).
        let extra = 12u32;
        let orig_riff_size = u32::from_le_bytes(wav[4..8].try_into().unwrap());
        spliced[4..8].copy_from_slice(&(orig_riff_size + extra).to_le_bytes());
        wav = spliced;

        let samples = parse_wav_pcm16_mono_16k(&wav).unwrap();
        assert_eq!(samples.len(), 3);
    }

    // -- normalization ------------------------------------------------------

    #[test]
    fn zero_mean_unit_var_norm_matches_formula() {
        let samples = vec![1.0f32, 2.0, 3.0, 4.0];
        let normed = zero_mean_unit_var_norm(&samples);
        let mean: f64 = normed.iter().map(|&x| x as f64).sum::<f64>() / normed.len() as f64;
        assert!(mean.abs() < 1e-5, "mean should be ~0, got {mean}");
        let var: f64 =
            normed.iter().map(|&x| { let d = x as f64 - mean; d * d }).sum::<f64>() / normed.len() as f64;
        assert!((var - 1.0).abs() < 1e-3, "variance should be ~1, got {var}");
    }

    #[test]
    fn zero_mean_unit_var_norm_constant_input_does_not_produce_nan() {
        // var == 0 for a constant signal; the +1e-7 epsilon must prevent a
        // divide-by-zero / NaN result (silence padding is a real input case).
        let samples = vec![0.5f32; 10];
        let normed = zero_mean_unit_var_norm(&samples);
        assert!(normed.iter().all(|x| x.is_finite()));
    }

    // -- log_softmax --------------------------------------------------------

    #[test]
    fn log_softmax_row_sums_to_one_in_prob_space() {
        let mut row = vec![1.0f32, 2.0, 3.0, 0.5];
        log_softmax_row(&mut row);
        let sum: f32 = row.iter().map(|x| x.exp()).sum();
        assert!((sum - 1.0).abs() < 1e-5, "exp(log_softmax) should sum to 1, got {sum}");
    }

    #[test]
    fn log_softmax_row_preserves_argmax() {
        let mut row = vec![1.0f32, 5.0, 3.0, -2.0];
        let argmax_before = row.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).unwrap().0;
        log_softmax_row(&mut row);
        let argmax_after = row.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).unwrap().0;
        assert_eq!(argmax_before, argmax_after);
    }

    // -- vocab / tokenization ------------------------------------------------

    #[test]
    fn loads_all_five_embedded_vocabs() {
        for lang in ["en", "es", "fr", "de", "pt"] {
            let vocab = load_vocab(lang).unwrap();
            assert!(!vocab.char_to_id.is_empty(), "{lang} vocab should not be empty");
        }
    }

    #[test]
    fn unsupported_language_is_typed_error() {
        let err = load_vocab("zz").unwrap_err();
        assert!(matches!(err, FaOnnxError::UnsupportedLanguage(lang) if lang == "zz"));
    }

    #[test]
    fn tokenizes_simple_english_text() {
        let vocab = load_vocab("en").unwrap();
        let ids = text_to_token_ids("cat", Language::En, &vocab);
        assert_eq!(ids.len(), 3);
    }

    #[test]
    fn tokenize_drops_a_digit_bearing_word_entirely_not_just_the_digit() {
        // Vocab-aware normalization (WS1 Task 5 Slice D3) drops a
        // digit-bearing word WHOLESALE, unlike the old naive placeholder
        // which dropped only the offending characters and kept the rest —
        // "a5b" is one word containing a digit, so it contributes zero ids.
        let vocab = load_vocab("en").unwrap();
        let ids = text_to_token_ids("a5b", Language::En, &vocab);
        assert_eq!(ids, Vec::<i64>::new());
    }

    #[test]
    fn tokenize_drops_a_genuinely_out_of_vocab_word_entirely() {
        // "café" contains 'é', absent from the en vocab — the whole word is
        // unrepresentable and dropped, proving the port did not become
        // permissive (mirrors `fa::text`'s own OOV-rejection contract).
        let vocab = load_vocab("en").unwrap();
        assert!(!vocab.chars.contains(&'é'), "test premise: 'é' must be absent from the en vocab");
        let ids = text_to_token_ids("café", Language::En, &vocab);
        assert_eq!(ids, Vec::<i64>::new());
    }

    #[test]
    fn tokenize_trims_leading_trailing_word_delimiter() {
        let vocab = load_vocab("en").unwrap();
        let ids = text_to_token_ids("  cat  ", Language::En, &vocab);
        let delim = vocab.word_delim_id.unwrap();
        assert_ne!(ids.first(), Some(&delim));
        assert_ne!(ids.last(), Some(&delim));
    }

    #[test]
    fn tokenize_collapses_repeated_whitespace_to_one_delimiter() {
        let vocab = load_vocab("en").unwrap();
        let ids = text_to_token_ids("cat   dog", Language::En, &vocab);
        let delim = vocab.word_delim_id.unwrap();
        let delim_count = ids.iter().filter(|&&id| id == delim).count();
        assert_eq!(delim_count, 1);
    }

    #[test]
    fn tokenize_skips_delimiter_around_a_dropped_middle_word() {
        // "cat 5 dog" — the middle word is digit-only and dropped; the
        // surviving words get exactly one delimiter between them, not two
        // (no delimiter placeholder for the dropped word).
        let vocab = load_vocab("en").unwrap();
        let ids = text_to_token_ids("cat 5 dog", Language::En, &vocab);
        let delim = vocab.word_delim_id.unwrap();
        let delim_count = ids.iter().filter(|&&id| id == delim).count();
        assert_eq!(delim_count, 1);
        assert_eq!(ids.len(), 3 + 1 + 3); // "cat" + delim + "dog"
    }
}

// ---------------------------------------------------------------------------
// Shared skip/require guard (WS1 Task 5 Slice D4) for every test below (and
// in the `e2e_parity` module) that needs a real `ORT_DYLIB_PATH` and/or a
// locally-provisioned `model.onnx` to execute.
//
// D3 finding this closes: with `ORT_DYLIB_PATH` unset, the three D2 argmax-
// parity tests skipped silently (an `eprintln!` + early `return`, which the
// `cargo test` harness counts as an ordinary pass) — so a whole gate could
// go unexercised for an arbitrary stretch of time while every run still
// reported green. That is a silent-failure channel, not acceptable for a
// HARD GATE.
//
// Default (`FA_REQUIRE_ORT` unset): unchanged behavior — a missing
// `ORT_DYLIB_PATH` or missing model file is an expected, not broken, fresh-
// checkout state (neither is committed to the repo). The test prints a SKIP
// message and returns without asserting anything, same as before this
// slice.
//
// `FA_REQUIRE_ORT=1`: the same missing-dependency condition is now a hard
// `panic!`, naming exactly what's missing — for any environment (this
// task's own verification run, a future CI job) that must prove these tests
// actually executed rather than quietly no-op'd. A skip can never
// masquerade as a pass under this flag.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod require_ort {
    use std::path::Path;
    use std::sync::Mutex;

    /// Shared with `super::with_ort_env_lock` (WS1 Task 5 Slice D6) — see
    /// that function's own doc comment for the full determinism scheme this
    /// guards. `Mutex::new` is `const fn`, so a plain `static` needs no
    /// lazy-init wrapper.
    pub static ORT_ENV_LOCK: Mutex<()> = Mutex::new(());

    fn require_ort_enabled() -> bool {
        std::env::var("FA_REQUIRE_ORT").as_deref() == Ok("1")
    }

    /// Returns `true` if `ORT_DYLIB_PATH` is set (caller should proceed as
    /// normal). Returns `false` if unset and `FA_REQUIRE_ORT` is not `"1"`
    /// (caller should print a SKIP message and return early, unchanged from
    /// pre-D4 behavior). Panics if unset and `FA_REQUIRE_ORT=1`.
    ///
    /// The env-var read itself is `ORT_ENV_LOCK`-guarded (WS1 Task 5 Slice
    /// D6): under `FA_REQUIRE_ORT=1`, an unlocked read here would be racy
    /// against `missing_dylib_returns_ort_init_error`'s deliberate
    /// remove-var window on another thread — this function's own PANIC
    /// branch above makes an unlucky interleaving there consequential (a
    /// spurious hard failure of an unrelated test), not just a skip, so the
    /// check needs the same lock `with_ort_env_lock`'s call sites use, not
    /// only the later `run_forward_pass` call those sites protect.
    pub fn ort_dylib_or_skip(context: &str) -> bool {
        let is_set = {
            let _guard = ORT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            std::env::var("ORT_DYLIB_PATH").is_ok()
        };
        if is_set {
            return true;
        }
        if require_ort_enabled() {
            panic!(
                "{context}: ORT_DYLIB_PATH is not set, but FA_REQUIRE_ORT=1 demands real \
                 execution — a skip is not allowed here"
            );
        }
        eprintln!("SKIP {context}: ORT_DYLIB_PATH not set");
        false
    }

    /// Same contract as [`ort_dylib_or_skip`], for a required file that must
    /// exist on disk (a `model.onnx`).
    pub fn path_exists_or_skip(context: &str, path: &Path) -> bool {
        if path.exists() {
            return true;
        }
        if require_ort_enabled() {
            panic!(
                "{context}: required file not found at {} — FA_REQUIRE_ORT=1 demands real \
                 execution — a skip is not allowed here",
                path.display()
            );
        }
        eprintln!("SKIP {context}: file not found at {}", path.display());
        false
    }
}

// ---------------------------------------------------------------------------
// Fixture parity: real Rust `ort` forward pass vs. a Python (onnxruntime)
// reference, over the three real audio windows the DP fixtures use
// (`scripts/capture-fa-onnx-reference.py` generated these — see that
// script's docstring for why they're separate from `fa_viterbi.rs`'s own
// MMS_FA-based `fa-emission-*.json` fixtures, a different model entirely).
//
// HARD GATE: 0 argmax mismatches per fixture. Max abs diff is reported as an
// observation only (export fidelity was previously measured at ~0.00027,
// `scripts/fixtures/fa-onnx-manifest.json`).
//
// Skips cleanly (does not fail) when `ORT_DYLIB_PATH` is unset or the
// language's `model.onnx` isn't present locally — neither is committed to
// the repo (see this file's module doc comment and `fa.rs`'s model
// resolver), so a fresh checkout without either is an expected, not broken,
// state UNLESS `FA_REQUIRE_ORT=1` (see `require_ort` above), in which case
// the same condition fails loudly instead.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod onnx_fixture_parity {
    use super::*;
    use std::path::PathBuf;

    struct Fixture {
        file: &'static str,
        language: &'static str,
    }

    const FIXTURES: &[Fixture] = &[
        Fixture { file: "fa-onnx-emission-en-deep-night.json", language: "en" },
        Fixture { file: "fa-onnx-emission-en-mother-look.json", language: "en" },
        Fixture { file: "fa-onnx-emission-es-resultan-inutiles.json", language: "es" },
    ];

    /// Test-only reproduction of Tauri's `app_local_data_dir()` mapping for
    /// this app's identifier — mirrors `scripts/export-fa-onnx.py`'s own
    /// `default_app_local_data_dir()` (same rationale: this test isn't a
    /// running Tauri process either, so it can't call the real resolver;
    /// `fa.rs::fa_model_path` is the production resolver, exercised via a
    /// live `AppHandle` instead, not available to a plain unit test).
    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }

    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("onnx_fixture_parity's fa_models_dir() only reproduces the macOS app_local_data_dir mapping");
    }

    fn argmax(row: &[f32]) -> usize {
        row.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).unwrap().0
    }

    fn run_one(fixture: &Fixture) {
        if !super::require_ort::ort_dylib_or_skip(fixture.file) {
            return;
        }
        let model_path = fa_models_dir().join(fixture.language).join("model.onnx");
        if !super::require_ort::path_exists_or_skip(fixture.file, &model_path) {
            return;
        }

        let fixture_path = format!("{}/../scripts/fixtures/{}", env!("CARGO_MANIFEST_DIR"), fixture.file);
        let text = std::fs::read_to_string(&fixture_path)
            .unwrap_or_else(|e| panic!("failed to read fixture {fixture_path}: {e}"));
        let v: serde_json::Value = serde_json::from_str(&text).expect("fixture must be valid JSON");

        let input_samples: Vec<f32> = v["input_samples"]
            .as_array()
            .expect("input_samples")
            .iter()
            .map(|x| x.as_f64().unwrap() as f32)
            .collect();
        let expected: Vec<Vec<f32>> = v["emission_log_probs"]
            .as_array()
            .expect("emission_log_probs")
            .iter()
            .map(|row| row.as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect())
            .collect();

        // Same preprocessing `align()` applies in production — exercises
        // this module's own normalization, not just ort's forward pass.
        // Lock-wrapped per `with_ort_env_lock`'s own doc comment (WS1 Task 5
        // Slice D6 determinism scheme).
        let normed = zero_mean_unit_var_norm(&input_samples);
        let got = with_ort_env_lock(|| run_forward_pass(&model_path, &normed))
            .unwrap_or_else(|e| panic!("{}: forward pass failed: {e}", fixture.file));

        assert_eq!(got.len(), expected.len(), "{}: frame count mismatch", fixture.file);

        let mut n_argmax_mismatch = 0usize;
        let mut max_abs_diff = 0.0f32;
        for (t, (got_row, want_row)) in got.iter().zip(expected.iter()).enumerate() {
            assert_eq!(got_row.len(), want_row.len(), "{}: class count mismatch at frame {t}", fixture.file);
            if argmax(got_row) != argmax(want_row) {
                n_argmax_mismatch += 1;
                eprintln!(
                    "{}: argmax mismatch at frame {t}: got {}, want {}",
                    fixture.file,
                    argmax(got_row),
                    argmax(want_row)
                );
            }
            for (g, w) in got_row.iter().zip(want_row.iter()) {
                max_abs_diff = max_abs_diff.max((g - w).abs());
            }
        }

        eprintln!(
            "{}: {} frames, {n_argmax_mismatch} argmax mismatches, max_abs_diff={max_abs_diff}",
            fixture.file,
            got.len()
        );
        assert_eq!(
            n_argmax_mismatch, 0,
            "{}: {n_argmax_mismatch} argmax mismatch(es) — hard gate requires 0",
            fixture.file
        );
    }

    #[test]
    fn parity_en_deep_night() {
        run_one(&FIXTURES[0]);
    }

    #[test]
    fn parity_en_mother_look() {
        run_one(&FIXTURES[1]);
    }

    #[test]
    fn parity_es_resultan_inutiles() {
        run_one(&FIXTURES[2]);
    }
}

// ---------------------------------------------------------------------------
// End-to-end alignment parity (WS1 Task 5 Slice D4): the COMPLETE Rust path
// — resolve model -> zero-mean/unit-var normalize -> real `ort` forward pass
// -> `fa::text` vocab-aware tokenize -> `fa_viterbi::forced_align` -> `
// merge_tokens` — against `scripts/capture-fa-e2e-reference.py`'s reference
// (`scripts/fixtures/fa-e2e-alignment-*.json`): real jonatasgrosman ONNX
// emission (reused from the D2 fixture), tokenized via the live TS
// `faTextNormalize.ts` module, aligned via REAL torchaudio 2.2.2
// `forced_align`/`merge_tokens` — an independent implementation of the same
// DP `fa_viterbi.rs` was hand-ported from, not sourced from any Rust output.
//
// HARD GATE (per the task's own stop condition): every merged token span's
// `start`/`end` frame index must be IDENTICAL to the Python reference, zero
// tolerance — not "close enough". Score drift (a real, expected possibility
// given D2's own measured ~0.001 max abs log-prob diff between `ort` and
// onnxruntime) is reported as an observation only, never asserted against a
// tolerance. A span-count or token-count mismatch fails outright — no
// partial/best-effort comparison.
//
// Skips (or, under `FA_REQUIRE_ORT=1`, fails loudly — see `require_ort`
// above) exactly like `onnx_fixture_parity`: same missing-`ORT_DYLIB_PATH`/
// missing-`model.onnx` conditions, same reasoning.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod e2e_parity {
    use super::*;
    use std::path::PathBuf;

    // Seconds-comparison tolerance (WS1 Task 5 Slice D6). Both sides compute
    // `frame_index as f64 * (320.0 / 16000.0)` as a single multiply against
    // an identical pre-divided double (Rust: `FA_FRAME_STRIDE_SAMPLES as f64
    // / FA_SAMPLE_RATE_HZ as f64`; Python: `FRAME_STRIDE_SAMPLES /
    // SAMPLE_RATE`, `capture-fa-e2e-reference.py`) — same operation order, so
    // IEEE-754 double-precision arithmetic (which both Rust `f64` and
    // CPython `float` are) guarantees bit-identical results for every input
    // in this fixture family (frame indices are small, exactly-representable
    // integers; span durations here top out under 10s). The theoretical
    // rounding-error floor at that magnitude is double's ~15-17 significant
    // decimal digits, i.e. ~1e-15 absolute error — this tolerance sits 6
    // orders of magnitude above that floor (generous headroom against a
    // literal 0.0 assertion being too brittle across platforms/toolchains)
    // while remaining ~10 million times tighter than a single video frame at
    // 60fps (~0.017s) — nowhere close to wide enough to mask a real
    // conversion-formula discrepancy (e.g. an off-by-one-frame or
    // wrong-stride bug would show up as a diff on the order of 0.02s or
    // larger, ~7 orders of magnitude over this bound).
    const FA_SECONDS_TOLERANCE: f64 = 1e-9;

    struct Fixture {
        file: &'static str,
        language: &'static str,
    }

    const FIXTURES: &[Fixture] = &[
        Fixture { file: "fa-e2e-alignment-en-deep-night.json", language: "en" },
        Fixture { file: "fa-e2e-alignment-en-mother-look.json", language: "en" },
        Fixture { file: "fa-e2e-alignment-es-resultan-inutiles.json", language: "es" },
        // Slice D5: fr/de/pt, sourced from google/fleurs (CC-BY-4.0) real audio —
        // see docs/ws1-sync-pipeline/fa-text-to-spans-seam-d5-2026-08-12.md.
        Fixture { file: "fa-e2e-alignment-fr-pas-juste.json", language: "fr" },
        Fixture { file: "fa-e2e-alignment-de-nicht-fair.json", language: "de" },
        Fixture { file: "fa-e2e-alignment-pt-site-publico.json", language: "pt" },
    ];

    // Same test-only `app_local_data_dir()` reproduction as
    // `onnx_fixture_parity::fa_models_dir` (see that function's own doc
    // comment for why this can't call the real `fa.rs::fa_model_path`
    // resolver — no live `AppHandle` in a plain unit test).
    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }

    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("e2e_parity's fa_models_dir() only reproduces the macOS app_local_data_dir mapping");
    }

    fn run_one(fixture: &Fixture) {
        if !super::require_ort::ort_dylib_or_skip(fixture.file) {
            return;
        }
        let model_path = fa_models_dir().join(fixture.language).join("model.onnx");
        if !super::require_ort::path_exists_or_skip(fixture.file, &model_path) {
            return;
        }

        let fixture_path = format!("{}/../scripts/fixtures/{}", env!("CARGO_MANIFEST_DIR"), fixture.file);
        let text = std::fs::read_to_string(&fixture_path)
            .unwrap_or_else(|e| panic!("failed to read fixture {fixture_path}: {e}"));
        let v: serde_json::Value = serde_json::from_str(&text).expect("fixture must be valid JSON");

        let language_code = v["_provenance"]["language"].as_str().expect("_provenance.language");
        assert_eq!(language_code, fixture.language, "{}: fixture language mismatch", fixture.file);
        let source_text = v["_provenance"]["text"].as_str().expect("_provenance.text");

        let input_samples: Vec<f32> = v["input_samples"]
            .as_array()
            .expect("input_samples")
            .iter()
            .map(|x| x.as_f64().unwrap() as f32)
            .collect();
        let fixture_target_ids: Vec<i64> = v["target_token_ids"]
            .as_array()
            .expect("target_token_ids")
            .iter()
            .map(|x| x.as_i64().unwrap())
            .collect();
        let blank_id = v["blank_id"].as_i64().expect("blank_id");
        let expected_spans = v["expected_spans"].as_array().expect("expected_spans");

        // Step: fa::text vocab-aware tokenize (this module's own
        // `text_to_token_ids`, exercising the real production tokenization
        // path, not a fixture-supplied shortcut) — cross-checked against the
        // Python reference's own (TS-normalizer-derived) target ids before
        // anything else runs, so a tokenizer drift is diagnosed distinctly
        // from an alignment-DP or forward-pass divergence.
        let vocab = load_vocab(fixture.language).unwrap_or_else(|e| panic!("{}: load_vocab failed: {e}", fixture.file));
        let lang_enum = Language::from_code(fixture.language).expect("known language code");
        let got_target_ids = text_to_token_ids(source_text, lang_enum, &vocab);
        assert_eq!(
            got_target_ids, fixture_target_ids,
            "{}: Rust tokenizer's target_token_ids diverges from the TS-normalizer-derived \
             reference — this is a tokenizer regression, not an alignment/forward-pass issue",
            fixture.file
        );
        assert_eq!(vocab.blank_id, blank_id, "{}: blank_id mismatch between Rust vocab and fixture", fixture.file);

        // Step: real ONNX forward pass (same normalization `align()` applies
        // in production). Lock-wrapped per `with_ort_env_lock`'s own doc
        // comment (WS1 Task 5 Slice D6 determinism scheme).
        let normed = zero_mean_unit_var_norm(&input_samples);
        let emission = with_ort_env_lock(|| run_forward_pass(&model_path, &normed))
            .unwrap_or_else(|e| panic!("{}: forward pass failed: {e}", fixture.file));

        // Step: Viterbi DP + merge.
        let align_result = forced_align(&emission, &got_target_ids, blank_id)
            .unwrap_or_else(|e| panic!("{}: forced_align failed: {e}", fixture.file));
        let spans = merge_tokens(&align_result.path, &align_result.scores, blank_id);

        eprintln!(
            "{}: {} target tokens, {} frames, {} merged spans (expected {})",
            fixture.file,
            got_target_ids.len(),
            emission.len(),
            spans.len(),
            expected_spans.len()
        );

        // Vacuity guard: a zero-token/zero-span "pass" would prove nothing.
        assert!(!got_target_ids.is_empty(), "{}: zero target tokens — vacuous", fixture.file);
        assert!(!spans.is_empty(), "{}: zero merged spans — vacuous", fixture.file);

        assert_eq!(
            spans.len(),
            expected_spans.len(),
            "{}: merged span count mismatch — got {}, want {}",
            fixture.file,
            spans.len(),
            expected_spans.len()
        );

        let mut max_abs_score_diff = 0.0f32;
        let mut max_abs_seconds_diff = 0.0f64;
        for (i, (got, want)) in spans.iter().zip(expected_spans.iter()).enumerate() {
            let want_token = want["token"].as_i64().unwrap();
            let want_start = want["start"].as_i64().unwrap() as usize;
            let want_end = want["end"].as_i64().unwrap() as usize;
            let want_score = want["score"].as_f64().unwrap() as f32;
            let want_start_seconds = want["start_seconds"].as_f64().expect("fixture must carry start_seconds (D6)");
            let want_end_seconds = want["end_seconds"].as_f64().expect("fixture must carry end_seconds (D6)");

            assert_eq!(got.token, want_token, "{}: span[{i}] token mismatch — got {}, want {want_token}", fixture.file, got.token);
            // HARD GATE: zero tolerance on frame indices.
            assert_eq!(
                got.start, want_start,
                "{}: span[{i}] (token {}) start-frame diverges — got {}, want {} — STOP: this is a \
                 real alignment divergence, not a fixture or tolerance issue",
                fixture.file, got.token, got.start, want_start
            );
            assert_eq!(
                got.end, want_end,
                "{}: span[{i}] (token {}) end-frame diverges — got {}, want {} — STOP: this is a \
                 real alignment divergence, not a fixture or tolerance issue",
                fixture.file, got.token, got.end, want_end
            );

            // Seconds: converted via this module's own `frame_to_seconds`
            // (same 320/16000 formula, same order of operations, as the
            // Python reference's `frame_to_seconds` in
            // capture-fa-e2e-reference.py) — see FA_SECONDS_TOLERANCE's own
            // doc comment for why a nonzero tolerance is used at all despite
            // that.
            let (got_start_seconds, got_end_seconds) = token_span_seconds(got);
            let start_seconds_diff = (got_start_seconds - want_start_seconds).abs();
            let end_seconds_diff = (got_end_seconds - want_end_seconds).abs();
            assert!(
                start_seconds_diff <= FA_SECONDS_TOLERANCE,
                "{}: span[{i}] (token {}) start-seconds diverges — got {got_start_seconds}, want \
                 {want_start_seconds}, diff {start_seconds_diff} exceeds tolerance \
                 {FA_SECONDS_TOLERANCE} — STOP: this indicates a real conversion discrepancy \
                 between the Rust and Python frame->time formulas, not a tolerance issue",
                fixture.file, got.token
            );
            assert!(
                end_seconds_diff <= FA_SECONDS_TOLERANCE,
                "{}: span[{i}] (token {}) end-seconds diverges — got {got_end_seconds}, want \
                 {want_end_seconds}, diff {end_seconds_diff} exceeds tolerance \
                 {FA_SECONDS_TOLERANCE} — STOP: this indicates a real conversion discrepancy \
                 between the Rust and Python frame->time formulas, not a tolerance issue",
                fixture.file, got.token
            );
            max_abs_seconds_diff = max_abs_seconds_diff.max(start_seconds_diff).max(end_seconds_diff);

            max_abs_score_diff = max_abs_score_diff.max((got.score - want_score).abs());
        }

        eprintln!(
            "{}: max_abs_score_diff={max_abs_score_diff} max_abs_seconds_diff={max_abs_seconds_diff:e}",
            fixture.file
        );
    }

    #[test]
    fn e2e_en_deep_night() {
        run_one(&FIXTURES[0]);
    }

    #[test]
    fn e2e_en_mother_look() {
        run_one(&FIXTURES[1]);
    }

    #[test]
    fn e2e_es_resultan_inutiles() {
        run_one(&FIXTURES[2]);
    }

    #[test]
    fn e2e_fr_pas_juste() {
        run_one(&FIXTURES[3]);
    }

    #[test]
    fn e2e_de_nicht_fair() {
        run_one(&FIXTURES[4]);
    }

    #[test]
    fn e2e_pt_site_publico() {
        run_one(&FIXTURES[5]);
    }
}

// ---------------------------------------------------------------------------
// EmptyTokenization: real end-to-end `align_with_model_path` call (the same
// body `align`/`fa_align` runs, minus only the AppHandle-dependent model-path
// resolution — see that function's own doc comment) with real audio and real
// text whose every word is unrepresentable in the target language's vocab.
// Proves the typed `FaOnnxError::EmptyTokenization` variant specifically
// surfaces from the real pipeline, not merely that align_with_model_path
// returns *some* Err (WS1 Task 5 Slice D6, closing a previously-unverified
// item: this exact path is not otherwise exercised — `text_to_token_ids`'s
// own unit tests above assert on the intermediate token-id Vec directly, but
// never drive it through a real forward pass into `align`'s own
// `if target_ids.is_empty()` branch).
//
// Skips (or, under `FA_REQUIRE_ORT=1`, fails loudly) exactly like
// `onnx_fixture_parity`/`e2e_parity` — same missing-`ORT_DYLIB_PATH`/missing-
// `model.onnx` conditions, same reasoning.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod empty_tokenization {
    use super::*;
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }

    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("empty_tokenization's fa_models_dir() only reproduces the macOS app_local_data_dir mapping");
    }

    /// Minimal canonical-PCM16-mono-16kHz WAV byte builder — duplicated
    /// (rather than shared) from the `tests` module's own private `build_wav`
    /// above, since that helper is module-private and this is a sibling
    /// module, not a descendant; ~15 lines, not worth widening the other
    /// module's visibility for.
    fn build_wav(samples: &[i16]) -> Vec<u8> {
        let (channels, sample_rate, bits_per_sample): (u16, u32, u16) = (1, 16000, 16);
        let block_align = channels * (bits_per_sample / 8);
        let byte_rate = sample_rate * block_align as u32;
        let data_bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_bytes.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&channels.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&byte_rate.to_le_bytes());
        bytes.extend_from_slice(&block_align.to_le_bytes());
        bytes.extend_from_slice(&bits_per_sample.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(data_bytes.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&data_bytes);
        bytes
    }

    #[test]
    fn empty_tokenization_surfaces_from_align_with_real_unrepresentable_text() {
        const CONTEXT: &str = "empty_tokenization_surfaces_from_align_with_real_unrepresentable_text";
        if !super::require_ort::ort_dylib_or_skip(CONTEXT) {
            return;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(CONTEXT, &model_path) {
            return;
        }

        // Real, committed audio: reuses the D2 fixture's own `input_samples`
        // (a short ~3.8s real speech window, not synthesized silence) so the
        // forward pass this test drives is fast and the audio itself is
        // genuine, not fabricated for this test.
        let fixture_path =
            format!("{}/../scripts/fixtures/fa-onnx-emission-en-deep-night.json", env!("CARGO_MANIFEST_DIR"));
        let fixture_text = std::fs::read_to_string(&fixture_path)
            .unwrap_or_else(|e| panic!("{CONTEXT}: failed to read fixture {fixture_path}: {e}"));
        let v: serde_json::Value = serde_json::from_str(&fixture_text).expect("fixture must be valid JSON");
        let input_samples: Vec<f32> = v["input_samples"]
            .as_array()
            .expect("input_samples")
            .iter()
            .map(|x| x.as_f64().unwrap() as f32)
            .collect();
        let pcm16: Vec<i16> = input_samples
            .iter()
            .map(|&s| (s * 32768.0).clamp(i16::MIN as f32, i16::MAX as f32) as i16)
            .collect();
        let wav_bytes = build_wav(&pcm16);

        let tmp_path = std::env::temp_dir().join(format!(
            "fa-empty-tokenization-test-{}-{}.wav",
            std::process::id(),
            CONTEXT
        ));
        std::fs::write(&tmp_path, &wav_bytes)
            .unwrap_or_else(|e| panic!("{CONTEXT}: failed to write temp WAV {}: {e}", tmp_path.display()));

        // Real Japanese place names, space-separated — genuine natural-
        // language text, but the `en` vocab (`fa-vocab-en.json`) contains
        // only ASCII letters + "'"/"-"/"|" + special tokens (verified by
        // direct inspection before writing this test), so EVERY word here is
        // unrepresentable and dropped wholesale by
        // `normalize_for_forced_alignment` — zero surviving words, zero
        // target ids.
        let segments = vec![FaSegmentInput {
            segment_id: "seg-1".to_string(),
            text: "東京 大阪".to_string(),
        }];

        let result = align_with_model_path(&model_path, tmp_path.to_str().unwrap(), &segments, "en");
        let _ = std::fs::remove_file(&tmp_path);

        match result {
            Err(FaOnnxError::EmptyTokenization) => {}
            Err(other) => panic!(
                "{CONTEXT}: expected Err(FaOnnxError::EmptyTokenization) specifically, got a \
                 different error variant: {other:?}"
            ),
            Ok(spans) => panic!(
                "{CONTEXT}: expected Err(FaOnnxError::EmptyTokenization), but align_with_model_path \
                 succeeded with {} span(s) — the vocab-rejection premise this test depends on no \
                 longer holds",
                spans.len()
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// Missing dylib: `run_forward_pass` with `ORT_DYLIB_PATH` genuinely absent
// (WS1 Task 5 Slice D6), asserting `Err(FaOnnxError::OrtInit(_))` as the
// OUTCOME. Every other test in this file that touches `ORT_DYLIB_PATH`
// treats its absence as a SKIP condition (`require_ort::ort_dylib_or_skip`)
// — this is the first test that deliberately manufactures that absence and
// asserts the resulting typed error, rather than skipping around it.
//
// DETERMINISM UNDER PARALLEL TEST EXECUTION (the real hazard here): Rust
// runs `#[test]` functions on multiple OS threads by default, and
// `ORT_DYLIB_PATH` is real process-global state — every OTHER test that
// might be running concurrently in this same process (`onnx_fixture_parity`,
// `e2e_parity`, `empty_tokenization`, all of which reach `run_forward_pass`
// with the ambient `ORT_DYLIB_PATH` expected to stay present for their own
// duration) would be racy against a naive `remove_var`/`set_var` pair here.
// The fix: `with_ort_env_lock` (this module, above) wraps EVERY
// `run_forward_pass` call site in the crate — including this test's own —
// in the SAME `Mutex<()>` (`require_ort::ORT_ENV_LOCK`). This test acquires
// that lock directly (not via `with_ort_env_lock`, since it needs the var
// removed for the ENTIRE remove/call/restore sequence, not just around the
// call) and holds it for its whole critical section. Any other thread
// concurrently reaching a `run_forward_pass` call site blocks on the same
// mutex until this test restores the var and releases — it can never
// observe the var transiently absent. This makes the test deterministic
// under `cargo test`'s default parallelism without `--test-threads=1`, a
// `serial_test`-style crate (none added, per this slice's scope), or any
// special CI invocation — ordinary `cargo test --features fa-inference` is
// sufficient. The lock is poison-tolerant (`unwrap_or_else(|poisoned| ...)`)
// so a panic inside any single locked critical section (this test's own
// assertion failing, or a `run_forward_pass` panic elsewhere) cannot
// permanently wedge every other ORT-touching test behind a poisoned mutex.
//
// This test needs no `ORT_DYLIB_PATH`/`model.onnx` present to run — it
// manufactures the missing-var condition itself — so it is NEVER gated by
// `require_ort::ort_dylib_or_skip`/`path_exists_or_skip` and runs
// unconditionally in any environment with the `fa-inference` feature on,
// including a fresh checkout with no onnxruntime installed at all.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod missing_dylib {
    use super::*;

    #[test]
    fn missing_dylib_returns_ort_init_error() {
        let _guard = require_ort::ORT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

        let previous = std::env::var("ORT_DYLIB_PATH").ok();
        std::env::remove_var("ORT_DYLIB_PATH");

        // Model path is never touched — `run_forward_pass`'s very first line
        // reads `ORT_DYLIB_PATH` and returns before opening any file, so a
        // nonexistent path here proves nothing was silently skipped further
        // down the function. Sample content is irrelevant for the same
        // reason; a small dummy buffer keeps this test fast.
        let dummy_model_path = Path::new("/definitely/does/not/exist/model.onnx");
        let dummy_samples = vec![0.0f32; 100];
        let result = run_forward_pass(dummy_model_path, &dummy_samples);

        // Restore before asserting: if the assertion below panics, the env
        // var is already back to its original state for whichever test runs
        // next once this thread releases `_guard` (on unwind, at scope end).
        match previous {
            Some(v) => std::env::set_var("ORT_DYLIB_PATH", v),
            None => std::env::remove_var("ORT_DYLIB_PATH"),
        }

        match result {
            Err(FaOnnxError::OrtInit(msg)) => {
                assert!(!msg.is_empty(), "OrtInit error message should not be empty");
            }
            Err(other) => panic!(
                "expected Err(FaOnnxError::OrtInit(_)) specifically when ORT_DYLIB_PATH is unset, \
                 got a different error variant: {other:?}"
            ),
            Ok(_) => panic!(
                "expected Err(FaOnnxError::OrtInit(_)) when ORT_DYLIB_PATH is unset, but \
                 run_forward_pass succeeded — the env var may not have actually been removed"
            ),
        }
    }
}
