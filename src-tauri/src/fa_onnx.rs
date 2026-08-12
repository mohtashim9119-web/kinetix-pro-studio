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

    let samples = read_wav_mono_16k(Path::new(audio_path)).map_err(FaOnnxError::Wav)?;
    let normed = zero_mean_unit_var_norm(&samples);
    let emission = run_forward_pass(&model_path, &normed)?;

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

    fn require_ort_enabled() -> bool {
        std::env::var("FA_REQUIRE_ORT").as_deref() == Ok("1")
    }

    /// Returns `true` if `ORT_DYLIB_PATH` is set (caller should proceed as
    /// normal). Returns `false` if unset and `FA_REQUIRE_ORT` is not `"1"`
    /// (caller should print a SKIP message and return early, unchanged from
    /// pre-D4 behavior). Panics if unset and `FA_REQUIRE_ORT=1`.
    pub fn ort_dylib_or_skip(context: &str) -> bool {
        if std::env::var("ORT_DYLIB_PATH").is_ok() {
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
        let normed = zero_mean_unit_var_norm(&input_samples);
        let got = run_forward_pass(&model_path, &normed)
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

    struct Fixture {
        file: &'static str,
        language: &'static str,
    }

    const FIXTURES: &[Fixture] = &[
        Fixture { file: "fa-e2e-alignment-en-deep-night.json", language: "en" },
        Fixture { file: "fa-e2e-alignment-en-mother-look.json", language: "en" },
        Fixture { file: "fa-e2e-alignment-es-resultan-inutiles.json", language: "es" },
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
        // in production).
        let normed = zero_mean_unit_var_norm(&input_samples);
        let emission = run_forward_pass(&model_path, &normed)
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
        for (i, (got, want)) in spans.iter().zip(expected_spans.iter()).enumerate() {
            let want_token = want["token"].as_i64().unwrap();
            let want_start = want["start"].as_i64().unwrap() as usize;
            let want_end = want["end"].as_i64().unwrap() as usize;
            let want_score = want["score"].as_f64().unwrap() as f32;

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

            max_abs_score_diff = max_abs_score_diff.max((got.score - want_score).abs());
        }

        eprintln!("{}: max_abs_score_diff={max_abs_score_diff}", fixture.file);
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
}
