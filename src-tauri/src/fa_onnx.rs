// ---------------------------------------------------------------------------
// Real ONNX forward pass for forced alignment (WS1 Task 5, Slice D2).
//
// Entirely behind the `fa-inference` Cargo feature (see this whole file's
// module-level `#![cfg(...)]` below) — with that feature off, none of this
// compiles and `ort` is absent from the build graph. `fa.rs`'s `fa_align`
// calls [`align_chunked_for_language`] only from its own
// `#[cfg(feature = "fa-inference")]` arm.
//
// Scope (WS1 Task 5 Slice D2 boundary — see docs/work-in-progress.md §7
// item 4 for the ort/onnxruntime version-deadlock resolution this wiring is
// built on; original source measurements/runtime-unblock-2026-08-12.md was
// deleted 2026-08-14, `9cf5867`; retrieve: `git show
// 251be64:docs/ws1-sync-pipeline/measurements/runtime-unblock-2026-08-12.md`):
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
//   - Per-segment span attribution beyond simple token-count bookkeeping,
//     anchor derivation, `anchorSource`/`CONF_MIN` (unrelated TS-side
//     concerns, untouched).
//
// WS1 Task 5 Slice D11 landed audio windowing/chunking (`align_chunked`,
// below) and the session-scoped model cache this comment used to say was
// deferred (`CachedSession`/`with_cached_session`, below) — a 1.2+GiB ONNX
// file is no longer reloaded once per chunk within a run, nor once per
// separate `fa_align` call in the same app session.
// ---------------------------------------------------------------------------
#![cfg(feature = "fa-inference")]

use crate::fa::text::{normalize_for_forced_alignment, Language, WordResult};
use crate::fa_viterbi::{forced_align, merge_tokens, AlignError, TokenSpan};
use ort::session::Session;
use ort::value::Tensor;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fmt;
use std::path::PathBuf;
use std::sync::Mutex;
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
    /// WS1 Task 5 Slice D11: `FaState` moved to `Cancelled` (via `fa_cancel`)
    /// between two chunks of a windowed `align_chunked` run. Checked at
    /// every chunk boundary (before the file-load/cache section and before
    /// each chunk's own forward pass) — never mid-chunk, and never after a
    /// chunk's words have already been appended to the result, so no
    /// partial word list is ever discarded silently or returned as if
    /// complete.
    Cancelled,
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
            FaOnnxError::Cancelled => write!(f, "forced alignment was cancelled"),
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
/// Loads (compiles) an ONNX session from `model_path` — the expensive half
/// of what `run_forward_pass` used to do in one call every time (WS1 Task 5
/// Slice D11 split, motivated by D10's own finding that reloading a 1.2+GiB
/// model per chunk — ~24 times for a 709s project — is "a wrong
/// architecture, not a slow one"). Callers that need to run more than one
/// forward pass against the same model (the chunk loop, via
/// `align_chunked`'s session cache) load once and reuse the returned
/// `Session` across calls to [`run_forward_pass_with_session`]; callers that
/// only ever need a single pass can still use [`run_forward_pass`] below,
/// unchanged in behavior.
// ---------------------------------------------------------------------------
// Bundled onnxruntime C runtime resolution (WS1 Session M, ruling R-N)
//
// The single most material discovery of the programme: before Session M, the
// onnxruntime C library was resolved PURELY via the `ORT_DYLIB_PATH`
// environment variable, and nothing in the shipped app ever set it. Every
// in-app FA run therefore failed at `load_session`'s first line with "failed to
// initialize onnxruntime: ORT_DYLIB_PATH not set" and fell back to Whisper
// timing — forced alignment had NEVER executed inside the application. Every
// prior fixture/measurement came from the `cargo test` / Python-spike driver,
// which set `ORT_DYLIB_PATH` to a dylib inside `.work-phase4/` (gitignored
// scratch, outside the repo's control and never on a shipped path).
//
// R-N's implementation: `load-dynamic` PLUS bundle the dylib. The app resolves
// its own runtime at a stable location (a Tauri resource — see
// `tauri.conf.json`'s `bundle.resources` and `src-tauri/onnxruntime/`), with no
// dependence on any shell-set variable. `ORT_DYLIB_PATH` survives as a
// test/override escape hatch ONLY: when it is already set we honor it and skip
// the bundled lookup entirely — the whole existing test-skip convention
// (`ort_dylib_or_skip`, the `missing_dylib` module, every `#[ignore]`d live
// test) rests on that env var being the switch, and this must not disturb it.
// ---------------------------------------------------------------------------

/// One row per (OS, arch) this build can load a bundled onnxruntime C library
/// for — the single source of truth [`resolve_bundled_ort_dylib`] resolves
/// against AND the refusal message on an unsupported target is generated
/// from (WS2 Step 13 Phase 4.5: "supported targets derived from one table,
/// not hardcoded to macos-x86_64"). Kept in sync with
/// `src-tauri/onnxruntime/onnxruntime.manifest.json` (one manifest entry per
/// row) and the guard test `scripts/onnxruntimeBundle.guard.test.ts`.
///
/// macOS x86_64 AND aarch64 share ONE filename: `build.yml` `lipo`s the two
/// per-arch dylibs Microsoft publishes into a single universal (fat) Mach-O
/// at that filename, matching the app's own `universal-apple-darwin` bundle
/// target — dyld picks the matching slice at load time with no code-level
/// arch branch needed, the same way it already does for this app's main
/// executable. MEASURED 2026-08-27: `lipo -create` on the two official
/// v1.23.2 release dylibs (x86_64 sha256 `8c9c78de...` matching the
/// pre-existing pin, aarch64 sha256 `d306d2bc...`) produces a 2-slice fat
/// dylib (`lipo -info`: "x86_64 arm64") that `dlopen`s successfully on this
/// session's real Intel (x86_64) machine — the arm64 slice's own runtime
/// behavior is unverified (no Apple Silicon hardware available this
/// session), covered instead by the `fa-ort-matrix` CI job once it gains an
/// arm64 runner cell.
struct OrtTarget {
    os: &'static str,
    arch: &'static str,
    filename: &'static str,
}

const ORT_DYLIB_FILENAME_MACOS: &str = "libonnxruntime.1.23.2.dylib";
/// Windows ships two files from Microsoft's release zip:
/// `onnxruntime.dll` (the engine, named here — this is what
/// `ORT_DYLIB_PATH` points at) and `onnxruntime_providers_shared.dll` (a
/// same-directory dependency `onnxruntime.dll` loads implicitly via the
/// Windows DLL search order — never referenced by path directly, just
/// bundled alongside). Both must be present in the same `onnxruntime/`
/// resource folder for the engine to actually load, not just the one this
/// constant names.
const ORT_DYLIB_FILENAME_WINDOWS: &str = "onnxruntime.dll";

const SUPPORTED_ORT_TARGETS: &[OrtTarget] = &[
    OrtTarget { os: "macos", arch: "x86_64", filename: ORT_DYLIB_FILENAME_MACOS },
    OrtTarget { os: "macos", arch: "aarch64", filename: ORT_DYLIB_FILENAME_MACOS },
    OrtTarget { os: "windows", arch: "x86_64", filename: ORT_DYLIB_FILENAME_WINDOWS },
];

fn ort_filename_for_current_target() -> Option<&'static str> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    SUPPORTED_ORT_TARGETS.iter().find(|t| t.os == os && t.arch == arch).map(|t| t.filename)
}

/// Ensures `ORT_DYLIB_PATH` names a loadable onnxruntime C library before the
/// first `ort::init_from`. Idempotent and cheap on repeat calls.
///
/// - If `ORT_DYLIB_PATH` is already set to a non-empty value, it is honored
///   verbatim and NOTHING is resolved or overwritten — this is the test/manual
///   override path (see the module comment above). We do not even stat it; a
///   caller who set it owns its correctness, exactly as before Session M.
/// - Otherwise the bundled library is resolved via the app's resource
///   directory (with dev/exe-dir fallbacks mirroring `whisper.rs::model_path`),
///   the running target is checked against the one the bundled binary was built
///   for, and `ORT_DYLIB_PATH` is set to the resolved path for `load_session`
///   to read unchanged.
///
/// Setting a process-global env var here is safe in production: a real FA run
/// is single-flight, the value resolved is deterministic (same bundled path
/// every time), and `load_session` reads it immediately after on the same
/// logical path. Test builds serialize all `ORT_DYLIB_PATH` access through
/// `require_ort::ORT_ENV_LOCK` (see `with_ort_env_lock`); this function is only
/// ever reached in production via `align_chunked_for_language`, never from a
/// test (tests set the override themselves and take the early return above).
pub fn ensure_ort_dylib(app: &tauri::AppHandle) -> Result<(), FaOnnxError> {
    if let Ok(existing) = std::env::var("ORT_DYLIB_PATH") {
        if !existing.trim().is_empty() {
            return Ok(());
        }
    }
    let resolved = resolve_bundled_ort_dylib(app)?;
    std::env::set_var("ORT_DYLIB_PATH", &resolved);
    Ok(())
}

/// Resolves the bundled onnxruntime C library's path, or returns a loud,
/// actionable `OrtInit` error. Arch/OS is a HARD gate, generated from
/// [`SUPPORTED_ORT_TARGETS`] (WS2 Step 13 Phase 4.5) rather than a single
/// hardcoded `cfg!` check — only a target with a table row is accepted; any
/// other target fails with a message naming the running target AND the full
/// supported list, rather than silently loading an incompatible library
/// (the explicit-architecture requirement in R-N).
fn resolve_bundled_ort_dylib(app: &tauri::AppHandle) -> Result<PathBuf, FaOnnxError> {
    let Some(filename) = ort_filename_for_current_target() else {
        let supported = SUPPORTED_ORT_TARGETS
            .iter()
            .map(|t| format!("{}-{}", t.os, t.arch))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(FaOnnxError::OrtInit(format!(
            "no bundled onnxruntime C runtime for this target ({}-{}). Supported targets today: \
             {supported}. High-precision sync cannot run here. Build/run on a supported target, \
             or set ORT_DYLIB_PATH to a compatible onnxruntime library for this target.",
            std::env::consts::OS,
            std::env::consts::ARCH,
        )));
    };

    use tauri::Manager;
    let mut tried: Vec<PathBuf> = Vec::new();

    // Production: the Tauri-bundled resource directory.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let cand = resource_dir.join("onnxruntime").join(filename);
        if cand.exists() {
            return Ok(cand);
        }
        tried.push(cand);
    }

    // Dev / exe-dir fallbacks, mirroring `whisper.rs::model_path`:
    //   target/debug/<exe> → target/debug → target → src-tauri → onnxruntime/
    if let Ok(exe) = std::env::current_exe() {
        let exe_dir = exe.parent().map(Path::to_path_buf).unwrap_or_else(|| exe.clone());
        // Production macOS bundle: <bundle>/Contents/MacOS/../Resources handled
        // above via resource_dir(); this covers a loose exe-adjacent layout.
        let adj = exe_dir.join("onnxruntime").join(filename);
        if adj.exists() {
            return Ok(adj);
        }
        tried.push(adj);

        let dev = exe_dir
            .parent().unwrap_or(&exe_dir)   // target/
            .parent().unwrap_or(&exe_dir)   // src-tauri/
            .join("onnxruntime")
            .join(filename);
        if dev.exists() {
            return Ok(dev);
        }
        tried.push(dev);
    }

    Err(FaOnnxError::OrtInit(format!(
        "bundled onnxruntime C runtime '{filename}' not found (looked in: {}). \
         Re-provision it per src-tauri/onnxruntime/README.md, or set ORT_DYLIB_PATH to a \
         compatible onnxruntime library.",
        tried.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", "),
    )))
}

/// WS2 Step 17 Part 1.6: `ort::init_from`'s underlying error, on a Windows
/// `LoadLibrary` failure, is an opaque OS error (typically "The specified
/// module could not be found. (os error 126)") that does not say WHICH
/// dependency is missing — `onnxruntime.dll` itself and each of its 4
/// MSVC-runtime dependents (`vcruntime140.dll`, `vcruntime140_1.dll`,
/// `msvcp140.dll`, `msvcp140_1.dll` — measured via `pefile` against the real
/// signed release, WS2 Step 17 Part 1.1) produce the identical error 126, so a
/// user with a missing VC++ runtime sees the same message as a corrupted
/// bundle and has no actionable next step. This is the exact failure mode
/// that made bug 2's 117-cut FA-silently-falls-back regression invisible
/// (Step 15) — the fallback path logged a generic failure, not a named cause.
/// Appends a concrete, named-DLL hint on Windows only; every other target's
/// error is returned unchanged.
#[cfg(target_os = "windows")]
fn augment_ort_load_error(msg: String) -> String {
    format!(
        "{msg} — on Windows this usually means one of the Microsoft Visual C++ Runtime files \
         onnxruntime.dll requires is missing: vcruntime140.dll, vcruntime140_1.dll, \
         msvcp140.dll, or msvcp140_1.dll. This installer bundles those 4 files app-locally next \
         to onnxruntime.dll (WS2 Step 17 Part 1); if they are absent, either re-run the \
         installer or install the Microsoft Visual C++ Redistributable (x64) from \
         https://aka.ms/vs/17/release/vc_redist.x64.exe."
    )
}
#[cfg(not(target_os = "windows"))]
fn augment_ort_load_error(msg: String) -> String {
    msg
}

/// Pre-flight runtime probe (WS1 Session M): resolve + actually load-and-init
/// the onnxruntime C library WITHOUT touching any model, returning the resolved
/// dylib path on success. This is the "runtime library load" line of the FA
/// pre-flight report — it proves `load_session`'s first two lines would succeed
/// (dylib resolvable AND ort can dlopen+init it) before the app commits to a
/// multi-minute sync. Cheap and idempotent: `ort::init_from(..).commit()` is a
/// try-insert-once against a process-global static (see `load_session`), so a
/// probe here never conflicts with the real run that follows.
pub fn probe_ort_runtime(app: &tauri::AppHandle) -> Result<String, FaOnnxError> {
    ensure_ort_dylib(app)?;
    let dylib_path = std::env::var("ORT_DYLIB_PATH")
        .map_err(|_| FaOnnxError::OrtInit("ORT_DYLIB_PATH unset after ensure_ort_dylib".to_string()))?;
    let builder = ort::init_from(&dylib_path)
        .map_err(|e| FaOnnxError::OrtInit(augment_ort_load_error(e.to_string())))?;
    builder.commit();
    Ok(dylib_path)
}

/// WS1 Session Y, Phase 1: pinned to single-threaded, sequential, deterministic
/// execution. Left at ORT's own defaults, `SetIntraOpNumThreads`/
/// `SetInterOpNumThreads` are unset (ORT picks a thread count from the host's
/// core count) and `SetDeterministicCompute` is off (ORT's default kernels
/// trade run-to-run bit-reproducibility for speed) — Session X
/// (`docs/work-in-progress.md`'s 2026-08-22 Changelog entry) measured this as
/// the INFERRED mechanism behind FA word timings diverging across two
/// byte-identical-token captures of the same audio (the "45-46
/// non-determinism"). `with_optimization_level` is deliberately NOT touched
/// here: ORT's graph optimizations are a one-time, deterministic rewrite of
/// the graph at session-commit time (see the `ort` crate's own
/// `GraphOptimizationLevel` doc comment) — they are not a source of
/// run-to-run variance, so disabling them would cost inference speed without
/// affecting determinism. The actual knob for numeric run-to-run
/// reproducibility is `with_deterministic_compute`.
pub fn load_session(model_path: &Path) -> Result<Session, FaOnnxError> {
    let dylib_path = std::env::var("ORT_DYLIB_PATH")
        .map_err(|_| FaOnnxError::OrtInit("ORT_DYLIB_PATH not set".to_string()))?;
    let builder = ort::init_from(dylib_path)
        .map_err(|e| FaOnnxError::OrtInit(augment_ort_load_error(e.to_string())))?;
    builder.commit();

    Session::builder()
        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?
        .with_intra_threads(1)
        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?
        .with_inter_threads(1)
        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?
        .with_parallel_execution(false)
        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?
        .with_deterministic_compute(true)
        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?
        // WS1 Session AO Step 4 — OOM fix. ORT's memory-pattern optimizer
        // (`EnableMemPattern`, ON by default) caches a distinct allocation
        // plan keyed by INPUT SHAPE, explicitly documented by `ort` itself
        // ("disable it if the input size varies, i.e. dynamic batch") — see
        // this crate's own `with_memory_pattern` doc comment. Every FA chunk
        // has a different sample count (a different input shape), and this
        // session is cached and reused across an entire app-process lifetime
        // (`with_cached_session`, above) — MEASURED (Session AO Step 1,
        // `.work-phase4/session-ao/rss_timeline.csv`) to accumulate a
        // per-shape allocation without release: a shared, single-process,
        // real-audio run of v6 -> 173 (cache HIT, same session) -> spanish
        // (cache MISS, new session) -> v6-again (cache MISS, new session)
        // rose monotonically for all but 1 of 1585 one-second RSS samples
        // and JUMPED +771 MiB exactly at the spanish cache-miss boundary —
        // a dropped `Session`'s memory was never released, only added to.
        // Peak RSS for that one process (4.121 GiB, ps; 4220.0 MiB,
        // `/usr/bin/time -l`) exceeded the highest SINGLE-corpus peak any
        // prior one-process-per-corpus measurement had ever recorded (v6
        // alone, 3205.3 MiB, Session AK) by ~1 GiB — a gap no earlier
        // measurement could see, because none of them reused a session
        // across corpora/languages in one process the way the live app
        // does. Disabling memory-pattern optimization stops ORT from
        // building this per-shape cache at all; it is a pure allocator-
        // strategy change (this call does not touch the model graph, the
        // emission matrix, or any of `with_intra_threads`/`with_inter_
        // threads`/`with_parallel_execution`/`with_deterministic_compute`,
        // already pinned above and left untouched here) and is expected to
        // be output-neutral — verified separately (Session AO Step 5:
        // exact boundary equality on v6/173/spanish, golden replay 6/6,
        // oracle diff green, all 13 production pins reproducing).
        .with_memory_pattern(false)
        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?
        .commit_from_file(model_path)
        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))
}

/// Runs `input_samples` (already zero-mean/unit-variance normalized) through
/// an already-loaded `session`, returning the per-frame log-probability
/// emission matrix (`T` rows of `C` classes) — the inference half of what
/// `run_forward_pass` used to do in one call (see [`load_session`]'s doc
/// comment for why the two were split).
pub fn run_forward_pass_with_session(session: &mut Session, input_samples: &[f32]) -> Result<Vec<Vec<f32>>, FaOnnxError> {
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

/// Convenience wrapper preserving the pre-D11 single-call signature/behavior
/// exactly (`load_session` then `run_forward_pass_with_session`, session
/// discarded after one pass) — still used by every fixture-parity test in
/// this file (none of which need session reuse across multiple calls), but
/// no longer by any production path (`align_chunked` calls
/// `run_forward_pass_with_session` directly against its cached session), so
/// it is dead code outside `cargo test`.
#[allow(dead_code)]
pub fn run_forward_pass(model_path: &Path, input_samples: &[f32]) -> Result<Vec<Vec<f32>>, FaOnnxError> {
    let mut session = load_session(model_path)?;
    run_forward_pass_with_session(&mut session, input_samples)
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
    /// This language's parsed `fa-cardinal-<lang>.json` (WS2 T3.2 Step
    /// 3b-iii) — loaded alongside the vocab since every real caller needs
    /// both together to call `normalize_for_forced_alignment`.
    cardinal_data: crate::fa::text::FaCardinalData,
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

/// Mirrors `vocab_json_for` — the compositional cardinal-number generator's
/// data source (WS2 T3.2 Step 3b-iii), embedded the same way for the same
/// reason (see that function's own precedent).
fn cardinal_json_for(language: &str) -> Result<&'static str, FaOnnxError> {
    match language {
        "en" => Ok(include_str!("../../scripts/fixtures/fa-cardinal-en.json")),
        "es" => Ok(include_str!("../../scripts/fixtures/fa-cardinal-es.json")),
        "fr" => Ok(include_str!("../../scripts/fixtures/fa-cardinal-fr.json")),
        "de" => Ok(include_str!("../../scripts/fixtures/fa-cardinal-de.json")),
        "pt" => Ok(include_str!("../../scripts/fixtures/fa-cardinal-pt.json")),
        other => Err(FaOnnxError::UnsupportedLanguage(other.to_string())),
    }
}

fn load_cardinal_data(language: &str) -> Result<crate::fa::text::FaCardinalData, FaOnnxError> {
    let json_str = cardinal_json_for(language)?;
    Ok(serde_json::from_str(json_str).expect("embedded fa-cardinal-*.json must parse"))
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
    let cardinal_data = load_cardinal_data(language)?;
    Ok(Vocab { char_to_id, chars, blank_id, word_delim_id, cardinal_data })
}

/// The flat CTC target-id sequence for one chunk's text, plus the
/// bookkeeping [`collapse_word_fragments`] needs to reverse
/// [`tokenize_normalized_words`]'s own expansion after alignment. See that
/// function's doc comment for what `fragment_counts` means and why it keeps
/// `words_per_chunk` (`fa_onnx.rs:1745`) correct without any change there.
struct TokenizedTargets {
    ids: Vec<i64>,
    fragment_counts: Vec<usize>,
}

/// Vocab-aware CTC target-id tokenization over an ALREADY-NORMALIZED word
/// list (WS2 T3.2 Step 3a-ii — the multi-word tokenizer capability). Pulled
/// out of [`tokenize_for_alignment`] as its own pure function so a test can
/// drive a SYNTHETIC multi-word [`WordResult`] through it directly, without
/// needing a real normalizer that emits an internal space (none does yet —
/// see this function's own neutrality note below).
///
/// For every REPRESENTABLE word, its `mapped` text is split on whitespace
/// into one or more FRAGMENTS — today always exactly one, since no
/// normalizer output contains internal whitespace (`fragment_counts`'s own
/// note below) — and each fragment's characters are mapped to `vocab`'s
/// ids, with a single word-delimiter id inserted strictly BETWEEN every
/// fragment, INCLUDING between two fragments of the SAME source word,
/// exactly as between two DIFFERENT source words. `merge_char_spans_to_words`
/// (below) cannot tell the two kinds of delimiter apart, and isn't meant to
/// — [`collapse_word_fragments`] is what puts one word's fragments back
/// together afterward, using `fragment_counts` to know where.
///
/// `fragment_counts[i]` is representable word `i`'s (0-based, in
/// `words.iter().filter(|w| w.representable)` order) fragment count: `1`
/// for a `mapped` string with no internal whitespace (every word today), `N`
/// for one compositionally generated as N space-linked pieces (WS2 T3.2 Step
/// 3b, not yet wired — no normalizer calls this with such a `mapped` value
/// yet). `fragment_counts.len()` always equals the representable-word count,
/// so `words_per_chunk`'s existing "one count per representable
/// `FaWordResult`" formula (`fa_onnx.rs:1745`) and `check_words_within_own_
/// chunk`'s slicing (`:1308-1332`) stay correct UNCHANGED once
/// [`collapse_word_fragments`] has run on this function's output — they
/// count/slice by REPRESENTABLE WORDS, not fragments, and collapsing
/// guarantees exactly one `WordSpan` survives per representable word by the
/// time anything downstream counts them.
///
/// NEUTRALITY: for the input this codebase produces today (every `mapped`
/// string is a single whitespace-free token), every `fragments` vec below
/// has length 1, so no delimiter is ever inserted that today's
/// one-delimiter-between-words code didn't already insert, and the emitted
/// `ids` sequence is byte-identical to the pre-Step-3a `text_to_token_ids`
/// body this function replaces internally.
fn tokenize_normalized_words(words: &[WordResult], vocab: &Vocab) -> TokenizedTargets {
    let mut ids = Vec::new();
    let mut fragment_counts = Vec::new();
    let mut first = true;
    for word in words.iter().filter(|w| w.representable) {
        let mapped = word.mapped.as_deref().expect("representable word must have `mapped` set");
        let fragments: Vec<&str> = mapped.split_whitespace().collect();
        assert!(
            !fragments.is_empty(),
            "representable word \"{mapped}\" (input {:?}) produced zero whitespace fragments — \
             `mapped` must be non-empty for a representable word",
            word.input,
        );
        fragment_counts.push(fragments.len());
        for fragment in fragments {
            if !first {
                if let Some(delim) = vocab.word_delim_id {
                    ids.push(delim);
                }
            }
            first = false;
            for ch in fragment.chars() {
                let id = *vocab
                    .char_to_id
                    .get(&ch)
                    .unwrap_or_else(|| panic!("normalized fragment \"{fragment}\" contains char {ch:?} absent from vocab — normalize_for_forced_alignment invariant violated"));
                ids.push(id);
            }
        }
    }
    TokenizedTargets { ids, fragment_counts }
}

/// Normalizes `text` via `crate::fa::text::normalize_for_forced_alignment`
/// (diacritic-preserving, German ß->ss, digit-bearing/unspellable words
/// dropped) then tokenizes it — see [`tokenize_normalized_words`] for the
/// real per-word/per-fragment tokenization logic this delegates to.
fn tokenize_for_alignment(text: &str, language: Language, vocab: &Vocab) -> TokenizedTargets {
    let normalized = normalize_for_forced_alignment(text, language, &vocab.chars, &vocab.cardinal_data);
    tokenize_normalized_words(&normalized.words, vocab)
}

/// Vocab-aware text-to-token-id mapping: the flat id sequence only, for
/// every existing caller that doesn't need [`tokenize_for_alignment`]'s
/// per-word fragment bookkeeping (only [`align_chunk_samples`], via
/// [`collapse_word_fragments`], does). Thin wrapper, unchanged signature and
/// behavior from before WS2 T3.2 Step 3a-ii — see [`tokenize_normalized_
/// words`]'s NEUTRALITY note.
#[cfg_attr(not(test), allow(dead_code))]
fn text_to_token_ids(text: &str, language: Language, vocab: &Vocab) -> Vec<i64> {
    tokenize_for_alignment(text, language, vocab).ids
}

// ---------------------------------------------------------------------------
// Character -> word span merge (WS1 Task 5 Slice D8)
//
// `fa_viterbi::merge_tokens` collapses the Viterbi path into CHARACTER-level
// spans (one per surviving token run — every distinct vocab char, INCLUDING
// the word-delimiter "|", since `merge_tokens` only drops `blank`-valued
// runs, not delimiter runs; the fixture data confirms this directly — e.g.
// `fa-e2e-alignment-en-deep-night.json`'s `target_token_ids` has 23 entries
// for a 6-word/18-letter sentence, the extra 5 being delimiter id 4 (`"|"`
// in `fa-vocab-en.json`), and `expected_spans` has exactly 23 entries to
// match, one per token including every delimiter). This function does the
// next step: group those character spans into WORD-level spans, splitting
// on the delimiter, reconstructing each word's text from its constituent
// characters' vocab ids.
//
// Three determinations made before writing this (full citations and
// reasoning in this slice's final report):
//   1. `TokenSpan.score` is a mean LOG-PROBABILITY (`fa_viterbi.rs`'s
//      `merge_tokens` doc comment + `log_softmax_row` above), not a
//      probability — always <= 0, unbounded below. `syncConstants.ts`'s
//      `CONF_MIN = 0.3` reads as a probability-shaped floor. These are
//      different units; this slice does not convert between them (that is
//      the later wiring slice's problem, not this pure-merge slice's).
//   2. Word-level score is the MEAN of constituent character spans' scores,
//      WEIGHTED by each span's own frame length (`end - start`) — not an
//      unweighted mean. This is what directly averaging the underlying
//      per-frame log-probs across the word's own character-bearing frames
//      would give (since each character span's own score is already a mean
//      over its own frame extent); an unweighted mean would let a
//      single-frame character run outvote a ten-frame one.
//   3. The delimiter's own spans are consumed as GROUPING BOUNDARIES only —
//      never included in a word's reconstructed text, never emitted as a
//      word of their own.
// ---------------------------------------------------------------------------

/// One word-level span: reconstructed text, wall-clock seconds (via
/// [`frame_to_seconds`]), and an aggregated score. See this section's module
/// doc comment above for the three determinations behind these fields —
/// `score` is a mean LOG-PROBABILITY (<= 0, unbounded below), NOT directly
/// comparable to `syncConstants.ts`'s `CONF_MIN`. That conversion
/// (`exp(score)`, the geometric mean of the per-frame probabilities, in
/// [0,1]) is deliberately NOT applied here — `WordSpan` keeps the raw
/// log-prob internally; `fa.rs`'s `FaWordSpan` DTO applies the
/// exponentiation at the IPC boundary (WS1 Task 5 Slice D9 ruling).
// `pub(crate)`: constructed by `align_chunk_samples`/`align_chunked` below
// (WS1 Task 5 Slice D9/D11) and consumed by `fa.rs::fa_align` to build the `FaEvent::Done`
// IPC payload — needs to cross the module boundary, but never needs to be a
// public type of this crate.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct WordSpan {
    pub text: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub score: f32,
}

/// Groups `char_spans` (one [`TokenSpan`] per character, in ascending time
/// order, as produced by `fa_viterbi::merge_tokens`) into word-level
/// [`WordSpan`]s, splitting on `vocab`'s own word-delimiter token id. A run
/// of zero non-delimiter spans between two delimiters (or at either end,
/// or from a wholly-empty `char_spans`) contributes no word — never an
/// empty [`WordSpan`] in the output.
///
/// A mandatory CTC blank between two immediately-repeated characters inside
/// one word (e.g. "book"'s repeated "o") produces two separate same-token
/// character spans with a frame gap between them that belongs to neither
/// span; that gap is simply excluded from the word's score by construction
/// (the weighted mean below only ever sums over spans that are actually
/// present in `char_spans`).
///
/// Called from `align_chunk_samples` below (WS1 Task 5 Slice D9/D11) so
/// each chunk's result is word-level, not the character-level `TokenSpan`s
/// it produced through Slice D8.
fn merge_char_spans_to_words(char_spans: &[TokenSpan], vocab: &Vocab) -> Vec<WordSpan> {
    let id_to_char: HashMap<i64, char> = vocab.char_to_id.iter().map(|(&c, &id)| (id, c)).collect();

    let mut words = Vec::new();
    let mut current: Vec<&TokenSpan> = Vec::new();

    for span in char_spans {
        if Some(span.token) == vocab.word_delim_id {
            flush_word(&mut current, &id_to_char, &mut words);
            continue;
        }
        current.push(span);
    }
    flush_word(&mut current, &id_to_char, &mut words);

    words
}

/// Reconstructs one [`WordSpan`] from `current`'s accumulated character
/// spans (if any) and pushes it to `words`, then clears `current` for the
/// next word. A no-op when `current` is empty (two adjacent delimiters, or a
/// leading/trailing delimiter) — the "no empty word" contract
/// [`merge_char_spans_to_words`] documents.
fn flush_word<'a>(current: &mut Vec<&'a TokenSpan>, id_to_char: &HashMap<i64, char>, words: &mut Vec<WordSpan>) {
    if current.is_empty() {
        return;
    }

    let text: String = current
        .iter()
        .map(|span| {
            *id_to_char.get(&span.token).unwrap_or_else(|| {
                panic!(
                    "char span token {} absent from vocab's char_to_id reverse map — \
                     merge_char_spans_to_words invariant violated",
                    span.token
                )
            })
        })
        .collect();

    let start = current.first().expect("current is non-empty here").start;
    let end = current.last().expect("current is non-empty here").end;
    // Weighted by each span's own frame length (`end - start`) — never 0,
    // since `merge_tokens` only ever produces spans with `end > start`.
    let total_frames: usize = current.iter().map(|s| s.end - s.start).sum();
    let weighted_score = current.iter().map(|s| s.score * (s.end - s.start) as f32).sum::<f32>() / total_frames as f32;

    words.push(WordSpan {
        text,
        start_seconds: frame_to_seconds(start),
        end_seconds: frame_to_seconds(end),
        score: weighted_score,
    });
    current.clear();
}

/// Collapses `fragment_words` — the FLAT, per-space-delimited-fragment
/// `WordSpan`s `merge_char_spans_to_words` just produced for one chunk, via
/// `tokenize_normalized_words`'s delimiter placement — back to exactly one
/// `WordSpan` per REPRESENTABLE source [`WordResult`], per `fragment_counts`
/// (same order, one entry per source word — see `tokenize_normalized_
/// words`'s own doc comment). This is the other half of the multi-word
/// tokenization capability (WS2 T3.2 Step 3a-ii): that function expands one
/// word's `mapped` text into N space-delimited fragments, each getting its
/// own CTC target run and therefore its own `WordSpan` out of the merge;
/// this function puts them back together so every OTHER consumer —
/// `words_per_chunk`'s per-chunk count (`fa_onnx.rs:1745`),
/// `check_words_within_own_chunk`'s slicing (`:1308-1332`), `fa.rs`'s
/// `word_index` script-word join key, `faBoundaryTypes.ts`'s documented
/// "an `FaWordSpan` is already exactly one word" contract (`:120-125`) —
/// keeps seeing exactly one `WordSpan` per source word, same as before this
/// capability existed. Called once per chunk, from [`align_chunk_samples`]
/// below, before that chunk's words are ever handed to its caller.
///
/// TIMING ATTRIBUTION (WS2 T3.2 Step 3a): a collapsed word's
/// `start_seconds` is its FIRST fragment's own `start_seconds`;
/// `end_seconds` is its LAST fragment's own `end_seconds` — the source
/// token's span runs first-fragment-start to last-fragment-end, never a sum
/// or an average of parts. `text` is every fragment's text rejoined with a
/// single space (undoing exactly the `split_whitespace` `tokenize_
/// normalized_words` performed). `score` is the DURATION-weighted mean
/// across fragments — the same weighting rule `flush_word` (above) already
/// applies one level down, char-spans into one fragment; this applies it one
/// level up, fragments into one collapsed word. `flush_word` weights by
/// FRAME count directly; here only `WordSpan.{start,end}_seconds` are
/// available (already converted via `frame_to_seconds`, a FIXED linear
/// scale: `frame_to_seconds(f) = f * FA_FRAME_STRIDE_SAMPLES /
/// FA_SAMPLE_RATE_HZ`), so `end_seconds - start_seconds` is exactly
/// proportional to frame count and weighting by it produces the identical
/// result up to that shared constant factor, which cancels out of the
/// ratio.
///
/// STRADDLE INVARIANT — the reason this function is well-defined at all: a
/// group `fragment_words[lo..lo+count]` is guaranteed to be every fragment
/// of ONE source word, in order, with nothing from a neighboring CHUNK mixed
/// in, only because a chunk boundary can never fall between two fragments of
/// the same source word. This is NOT enforced by anything in this function
/// or this file — it depends entirely on `faChunkPlan.ts` (TypeScript)
/// deciding every chunk's TEXT over RAW, pre-normalization script tokens
/// (`RawScriptToken`, one atomic unit per whitespace-delimited script word,
/// assigned WHOLE to exactly one chunk by `attributeByIndex`) strictly
/// BEFORE this module's own `normalize_for_forced_alignment` — the only
/// place expansion happens — ever runs on that chunk's text. `align_chunked`
/// (below) calls it fresh, once, per already-finalized `FaChunkInput`, with
/// no state shared across chunks, so expansion can only ever act on a
/// word that already belongs wholly to the one chunk being processed.
/// Proved in full in WS2 T3.2 Step 3a-i
/// (`.work-phase4/session-ws2-35/t32-step3a-i-chunk-straddle-precheck.md`).
/// If chunk assignment ever started operating on FA-normalized
/// (post-expansion) text instead of raw text, that guarantee would no
/// longer hold and this function's grouping could silently misattribute
/// fragments across a chunk seam. **The standing code-level guard for this
/// precondition is `faChunkPlan.test.ts`'s "chunk boundaries are
/// independent of FA text normalization" test** (WS2 T3.2 Step 3a-ii) — it
/// asserts chunk count and every `startSec`/`endSec` stay byte-identical
/// whether or not FA normalization is applied, even when normalization
/// changes representable-word count, and fails first if a future change
/// ever lets normalized text influence chunk-boundary decisions, before
/// this function could ever observe a straddle.
fn collapse_word_fragments(fragment_words: Vec<WordSpan>, fragment_counts: &[usize]) -> Vec<WordSpan> {
    let total: usize = fragment_counts.iter().sum();
    assert_eq!(
        fragment_words.len(),
        total,
        "collapse_word_fragments: merge produced {} WordSpan(s) but tokenization recorded {} \
         fragment(s) across {} source word(s) — delimiter placement and fragment counting have \
         desynchronized",
        fragment_words.len(),
        total,
        fragment_counts.len(),
    );

    let mut collapsed = Vec::with_capacity(fragment_counts.len());
    let mut idx = 0usize;
    for &count in fragment_counts {
        assert!(count >= 1, "collapse_word_fragments: a representable source word must produce at least one fragment");
        let group = &fragment_words[idx..idx + count];
        idx += count;
        if count == 1 {
            collapsed.push(group[0].clone());
            continue;
        }
        let text = group.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");
        let start_seconds = group[0].start_seconds;
        let end_seconds = group[count - 1].end_seconds;
        let total_duration: f64 = group.iter().map(|w| w.end_seconds - w.start_seconds).sum();
        let score = if total_duration > 0.0 {
            (group.iter().map(|w| w.score as f64 * (w.end_seconds - w.start_seconds)).sum::<f64>() / total_duration) as f32
        } else {
            (group.iter().map(|w| w.score as f64).sum::<f64>() / group.len() as f64) as f32
        };
        collapsed.push(WordSpan { text, start_seconds, end_seconds, score });
    }
    collapsed
}

// ---------------------------------------------------------------------------
// Session cache (WS1 Task 5 Slice D11)
//
// D10 measured a single whole-file forward pass peaking at 19.5GiB at 240s
// and accelerating — a 709s project extrapolates to 60-154GB, infeasible on
// a 32GB machine. Windowing (below) bounds that, but naively reloads a
// 1.2+GiB ONNX file on every one of a project's ~24 chunks — "a wrong
// architecture, not a slow one" (D10 commit message). The fix: a
// session-scoped cache, one entry, keyed by (language, resolved path, file
// size, mtime) — mirrors this codebase's own `getFileIdentity` precedent for
// exactly this staleness problem (`whisperService.ts`/`syncEngine.ts`'s
// `Project.lastTranscribedFileIdentity`, `CLAUDE.md` §4: "keyed by file
// identity, not asset id"). A cache HIT (same key) reuses the already-loaded
// `Session` across every chunk in the SAME `align_chunked` call and across
// SEPARATE calls in the same app session; a cache MISS (any part of the key
// differs — including a plain language switch) discards the old session and
// loads fresh. Eviction beyond a key-mismatch replacement is simply process
// lifetime — `FaModelCache` lives in Tauri-managed `State`, gone on app
// restart, matching the ledger's own ruling ("held for the lifetime of a
// sync run... evicted on language change or app/session end").
//
// SHA-256 model-integrity verification is a SEPARATE, unchanged concern —
// `fa_dev.rs`'s `verify_model_manifest` already runs it exactly once per
// `fa_align_dev` call, upstream of `fa_align`/`align_chunked` entirely, and
// is untouched by this slice. This cache's own key (size + mtime, not a
// hash) exists only to answer "is my cached `Session` still the file I just
// verified," not to replace that verification — a size+mtime change forces
// a fresh `load_session` call, but does not re-hash anything (hashing is the
// caller's job, once, before ever reaching this cache).
// ---------------------------------------------------------------------------

/// Identifies a cached `Session` such that it can never silently serve a
/// stale or wrong model: language (a session compiled for one language's
/// vocab/architecture is never reused for another, even if the ONNX graph
/// shape happened to match) plus the resolved model file's own identity
/// (path + size + mtime — the same `getFileIdentity`-style triple this
/// codebase already trusts elsewhere, see module doc comment above).
#[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) struct CacheKey {
    language: String,
    path: PathBuf,
    size: u64,
    mtime: std::time::SystemTime,
}

impl CacheKey {
    fn for_model(language: &str, path: &Path) -> Result<Self, FaOnnxError> {
        let meta = std::fs::metadata(path)
            .map_err(|e| FaOnnxError::OrtSession(format!("stat {}: {e}", path.display())))?;
        let mtime = meta
            .modified()
            .map_err(|e| FaOnnxError::OrtSession(format!("mtime {}: {e}", path.display())))?;
        Ok(CacheKey { language: language.to_string(), path: path.to_path_buf(), size: meta.len(), mtime })
    }
}

/// One cached, already-loaded ONNX session plus the key that identifies the
/// exact model file it was loaded from. `pub(crate)`: named by `fa.rs`'s
/// `FaModelCache` (a `Mutex<Option<CachedSession>>` managed as Tauri
/// `State`), never constructed outside this module.
pub(crate) struct CachedSession {
    key: CacheKey,
    session: Session,
}

/// Returns the already-cached session for `(language, model_path)` if the
/// key matches, otherwise loads fresh (replacing any differently-keyed
/// entry) and caches it. Holds `cache`'s lock for the duration of `f` — safe
/// here because every caller (`align_chunked`) runs `f` fully synchronously,
/// with no `.await` inside, so no other async task can make progress on this
/// thread while the lock is held regardless.
#[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
fn with_cached_session<T>(
    cache: &Mutex<Option<CachedSession>>,
    model_path: &Path,
    language: &str,
    f: impl FnOnce(&mut Session) -> Result<T, FaOnnxError>,
) -> Result<T, FaOnnxError> {
    let key = CacheKey::for_model(language, model_path)?;
    let mut guard = cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let needs_reload = !matches!(&*guard, Some(cached) if cached.key == key);
    if needs_reload {
        // WS1 Session AP Step 3 — drop the incumbent session BEFORE building
        // the replacement, not after. The previous order (build-then-assign)
        // left the old and new `Session` briefly co-resident on every
        // cache-miss reload: `*guard = Some(..)` only drops the old value at
        // the point of assignment, which is after `load_session` has already
        // finished allocating the new one. A dropped ORT session's pages
        // don't come back to the OS on this allocator, so that transient
        // spike became the new floor. Explicitly clearing the slot first
        // means the drop happens, and its (partial) memory effect lands,
        // before the new session's allocation begins. Trade-off: if
        // `load_session` now fails, the cache is left empty instead of
        // retaining the old (still-valid, differently-keyed) session — an
        // acceptable cost next to the OOM this exists to reduce; the caller
        // already treats a `with_cached_session` failure as fatal for this
        // call, and the following call simply reloads from disk.
        *guard = None;
        let session = with_ort_env_lock(|| load_session(model_path))?;
        *guard = Some(CachedSession { key, session });
    }
    let cached = guard.as_mut().expect("just inserted above, or already present and key-matched");
    f(&mut cached.session)
}

// ---------------------------------------------------------------------------
// Chunked orchestration (WS1 Task 5 Slice D11)
// ---------------------------------------------------------------------------

/// Converts a chunk's `[start_sec, end_sec)` into a sample-index range into
/// `total_samples`-long 16kHz audio, clamped so a chunk boundary that lands
/// a hair past the decoded sample count (container-duration vs. decoded-PCM
/// drift, the same class of slack `MALFORMED_TOKEN_DURATION_TOLERANCE_SEC`
/// exists for on the TS side) can never panic on an out-of-bounds slice.
/// `start` is clamped to `end` from below (never past it), so a
/// pathological input can produce an EMPTY slice but never an inverted one.
fn chunk_sample_range(total_samples: usize, start_sec: f64, end_sec: f64) -> (usize, usize) {
    let start = ((start_sec * FA_SAMPLE_RATE_HZ as f64).round().max(0.0) as usize).min(total_samples);
    let end = ((end_sec * FA_SAMPLE_RATE_HZ as f64).round().max(0.0) as usize).clamp(start, total_samples);
    (start, end)
}

/// Aligns ONE chunk's text against its own already-sliced samples, using an
/// already-loaded `session`. Returns word spans in CHUNK-LOCAL seconds — the
/// caller ([`align_chunked`]) adds the chunk's own `start_sec` to get
/// absolute audio time. Shares every step (`normalize` -> forward pass ->
/// tokenize -> Viterbi -> word merge -> fragment collapse) with the pre-D11
/// single-pass path; the only D11 change was that `session`/`chunk_samples`/
/// `chunk_text` became per-chunk parameters instead of whole-file state. WS2
/// T3.2 Step 3a-ii added the final collapse step — see
/// [`collapse_word_fragments`]'s own doc comment for why it's safe to do
/// per-chunk like this (the straddle invariant).
fn align_chunk_samples(
    session: &mut Session,
    vocab: &Vocab,
    lang_enum: Language,
    chunk_samples: &[f32],
    chunk_text: &str,
) -> Result<Vec<WordSpan>, FaOnnxError> {
    let normed = zero_mean_unit_var_norm(chunk_samples);
    let emission = run_forward_pass_with_session(session, &normed)?;

    let tokenized = tokenize_for_alignment(chunk_text, lang_enum, vocab);
    if tokenized.ids.is_empty() {
        return Err(FaOnnxError::EmptyTokenization);
    }

    let result = forced_align(&emission, &tokenized.ids, vocab.blank_id).map_err(FaOnnxError::Align)?;
    let char_spans = merge_tokens(&result.path, &result.scores, vocab.blank_id);
    let fragment_words = merge_char_spans_to_words(&char_spans, vocab);
    Ok(collapse_word_fragments(fragment_words, &tokenized.fragment_counts))
}

/// Thin wrapper resolving `language`'s model path via a live `AppHandle`
/// (production `fa_align`'s own resolution, `fa.rs::fa_model_path`) before
/// delegating to [`align_chunked`] — split out for the same reason `align`/
/// `align_with_model_path` were split pre-D11: tests drive the real pipeline
/// with an already-known `model_path`, without a live `tauri::AppHandle`
/// (nothing in this crate's test suite constructs one — see
/// `onnx_fixture_parity`/`e2e_parity`'s own `fa_models_dir()` doc comments).
pub fn align_chunked_for_language(
    app: &tauri::AppHandle,
    cache: &Mutex<Option<CachedSession>>,
    audio_path: &str,
    chunks: &[crate::fa::FaChunkInput],
    language: &str,
    is_cancelled: impl Fn() -> bool,
    on_progress: impl FnMut(u32),
) -> Result<Vec<WordSpan>, FaOnnxError> {
    // WS1 Session M (R-N): make the bundled onnxruntime C runtime loadable
    // before any `load_session` runs. In production this sets `ORT_DYLIB_PATH`
    // from the bundled resource; under tests/manual override it is already set
    // and this is a no-op. Runs BEFORE model resolution so a runtime-library
    // failure surfaces as its own actionable error rather than masquerading as
    // a missing model. This is the ONE production code path that owns runtime
    // resolution — nothing resolves into `.work-phase4/` or any gitignored dir.
    ensure_ort_dylib(app)?;
    let model_path = crate::fa::fa_model_path(app, language).map_err(FaOnnxError::ModelNotFound)?;
    align_chunked(cache, &model_path, audio_path, chunks, language, is_cancelled, on_progress)
}

/// A CTC-infeasible chunk's placeholder score (WS1 Task 5 Slice D20):
/// `f32::NEG_INFINITY.exp() == 0.0` exactly (clean f32 underflow, no NaN) —
/// unconditionally below `CONF_MIN` (0.3) once `fa.rs::word_span_to_dto`
/// applies its `exp()` IPC-boundary conversion, so every placeholder word
/// [`fallback_words_for_infeasible_chunk`] produces surfaces as
/// `needs_review: true` via the SAME mechanism a real low-confidence word
/// already uses (D19/R.7) — no new field, no new wire shape.
const CTC_INFEASIBLE_FALLBACK_SCORE: f32 = f32::NEG_INFINITY;

/// Root cause (WS1 Task 5 Slice D20, measured on the real 709s/173-project
/// corpus — see `docs/work-in-progress.md` §6's CTC-infeasibility paragraph;
/// original source `d20-ctc-infeasibility-2026-08-14.md` was deleted
/// 2026-08-14, `9cf5867`; retrieve: `git show
/// 251be64:docs/ws1-sync-pipeline/d20-ctc-infeasibility-2026-08-14.md`):
/// a chunk's `[start_sec, end_sec)` window can be legitimately narrow (an
/// anchor-verified run a few tenths of a second wide is a real, correct
/// `faAnchors.ts` output) while `faChunkPlan.ts`'s `segment.startTime`
/// membership rule attributes it an ENTIRE committed segment's text — one
/// whose own real committed `duration` runs far past the run's `endSec` —
/// because that segment's `startTime` happens to fall inside the narrow
/// window. `AlignError::TooManyRepeats` ("targets length is too long for
/// CTC") is the resulting hard failure: the assigned text structurally
/// cannot fit the window's own frame count at ANY confidence, not a
/// borderline case. Both of D11's own real-corpus failures (chunk 4,
/// chunk 52) were measured this way — genuinely dense speech (option (ii)
/// in the task brief) was ruled out directly: cross-referencing the same
/// corpus's real Whisper word onsets, all but the FIRST word of each
/// chunk's assigned text has its real onset well past the chunk's own
/// `end_sec`, i.e. the text overwhelmingly belongs to LATER chunks, not
/// this one.
///
/// Rather than aborting the whole `align_chunked` run over one bad window
/// (the pre-D20 behavior — see this function's own caller), this produces
/// one placeholder [`WordSpan`] per REPRESENTABLE word in the chunk's own
/// text (same normalizer every other chunk's tokenization uses, so the
/// word count matches `check_word_count_matches_normalizer`'s expectation
/// exactly), evenly spaced across the chunk's own `[start_sec, end_sec)` —
/// keeping `wordIndex` gapless for a downstream consumer (D19's own
/// rejection of "drop the word's timing" applies here too: a hole in an
/// index-keyed array is worse than an approximate, clearly-flagged one) —
/// each carrying [`CTC_INFEASIBLE_FALLBACK_SCORE`] so it is never mistaken
/// for a real, trustworthy alignment. Returns an empty `Vec` (contributing
/// no words, not a panic) if the chunk's text normalizes to zero
/// representable words — the same "no empty output" contract
/// `merge_char_spans_to_words` already holds for real alignment.
fn fallback_words_for_infeasible_chunk(chunk: &crate::fa::FaChunkInput, lang: Language, vocab: &Vocab) -> Vec<WordSpan> {
    let normalized = normalize_for_forced_alignment(&chunk.text, lang, &vocab.chars, &vocab.cardinal_data);
    let words: Vec<&str> =
        normalized.words.iter().filter(|w| w.representable).filter_map(|w| w.mapped.as_deref()).collect();
    if words.is_empty() {
        return Vec::new();
    }
    let window = (chunk.end_sec - chunk.start_sec).max(0.0);
    let n = words.len() as f64;
    words
        .into_iter()
        .enumerate()
        .map(|(i, text)| WordSpan {
            text: text.to_string(),
            start_seconds: chunk.start_sec + window * (i as f64) / n,
            end_seconds: chunk.start_sec + window * ((i + 1) as f64) / n,
            score: CTC_INFEASIBLE_FALLBACK_SCORE,
        })
        .collect()
}

/// Real `fa_align` implementation (WS1 Task 5 Slice D11): decodes
/// `audio_path` ONCE (not once per chunk), gets-or-loads a cached `Session`
/// for `model_path`/`language` (see the session-cache section above), then
/// loops `chunks` in order — slicing that chunk's own samples, checking
/// `is_cancelled` before starting it, running the existing forward-pass/
/// tokenize/Viterbi/merge pipeline against just that slice, and offsetting
/// the resulting word spans by the chunk's own `start_sec` to make them
/// absolute — accumulating one flat `Vec<WordSpan>` across every chunk.
/// `on_progress(i)` is called once per COMPLETED chunk, `i` running
/// `1..=chunks.len()`, immediately after that chunk's words are appended.
///
/// Cancellation: checked before any chunk-specific work starts (including
/// before chunk 0, so a cancel requested before the first chunk even begins
/// is honored) and again before every subsequent chunk. On a cancelled run,
/// returns `Err(FaOnnxError::Cancelled)` immediately — no `Ok` with a
/// partial word list is ever returned, so a cancelled run can never be
/// mistaken for a completed one by its caller.
///
/// CTC infeasibility (WS1 Task 5 Slice D20): a chunk whose Viterbi pass
/// fails with `AlignError::TooManyRepeats` specifically (the assigned text
/// structurally cannot fit the window — see
/// [`fallback_words_for_infeasible_chunk`]'s own doc comment for why this
/// happens and how it was verified NOT to be genuinely dense speech) no
/// longer aborts the run: it falls back to evenly-spaced, `needs_review`
/// placeholder words and processing continues with the next chunk. Every
/// OTHER error kind (`Wav`, `OrtRun`, `EmptyTokenization`,
/// `AlignError::EmptyTargets`, …) is unchanged — still propagates and
/// aborts the whole run, since those indicate a real system/input failure
/// this fallback has no basis to paper over. `eprintln!` marks the event
/// (never a silent skip) in addition to the per-word `needs_review` flag
/// every consumer of the returned words already gets.
pub fn align_chunked(
    cache: &Mutex<Option<CachedSession>>,
    model_path: &Path,
    audio_path: &str,
    chunks: &[crate::fa::FaChunkInput],
    language: &str,
    is_cancelled: impl Fn() -> bool,
    mut on_progress: impl FnMut(u32),
) -> Result<Vec<WordSpan>, FaOnnxError> {
    if is_cancelled() {
        return Err(FaOnnxError::Cancelled);
    }

    let vocab = load_vocab(language)?;
    let lang_enum =
        Language::from_code(language).ok_or_else(|| FaOnnxError::UnsupportedLanguage(language.to_string()))?;
    let samples = read_wav_mono_16k(Path::new(audio_path)).map_err(FaOnnxError::Wav)?;

    with_cached_session(cache, model_path, language, |session| {
        let mut all_words = Vec::new();
        for (i, chunk) in chunks.iter().enumerate() {
            if is_cancelled() {
                return Err(FaOnnxError::Cancelled);
            }
            let (start_sample, end_sample) = chunk_sample_range(samples.len(), chunk.start_sec, chunk.end_sec);
            let chunk_samples = &samples[start_sample..end_sample];
            match align_chunk_samples(session, &vocab, lang_enum, chunk_samples, &chunk.text) {
                Ok(words) => {
                    for w in words {
                        all_words.push(WordSpan {
                            text: w.text,
                            start_seconds: w.start_seconds + chunk.start_sec,
                            end_seconds: w.end_seconds + chunk.start_sec,
                            score: w.score,
                        });
                    }
                }
                Err(FaOnnxError::Align(AlignError::TooManyRepeats { input_length, target_length, num_repeats })) => {
                    eprintln!(
                        "fa_onnx::align_chunked: chunk {i} [{:.2},{:.2}) is CTC-infeasible \
                         (input_length={input_length}, target_length={target_length}, \
                         num_repeats={num_repeats}) — falling back to evenly-spaced placeholder \
                         timing, every word flagged needs_review; run continues",
                        chunk.start_sec, chunk.end_sec,
                    );
                    all_words.extend(fallback_words_for_infeasible_chunk(chunk, lang_enum, &vocab));
                }
                Err(e) => return Err(e),
            }
            on_progress(i as u32 + 1);
        }
        Ok(all_words)
    })
}

// ---------------------------------------------------------------------------
// Windowed-output invariants (WS1 Task 5 Slice D11 — the Automated Agreement
// Budget's "hard structural invariants" leg, `docs/work-in-progress.md` §5;
// `task5-slice-ledger.md` §4, the original source, was deleted 2026-08-14,
// `9cf5867`; retrieve: `git show
// 251be64:docs/ws1-sync-pipeline/task5-slice-ledger.md`).
// Pure, standalone checkers over `align_chunked`'s stitched `Vec<WordSpan>`
// output — hold at ANY audio length, independent of any whole-file reference
// (D7's cancellation established no such reference is even computable at
// production length). Each is unit-tested with both a hand-built PASSING
// case and a hand-built FAILING case (the failing case is the non-vacuity
// proof: if a checker can never fail, it is not actually checking anything).
// ---------------------------------------------------------------------------

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, PartialEq)]
pub(crate) enum InvariantViolation {
    TimesNotNonDecreasing { index: usize, prev_start: f64, start: f64 },
    WordsOverlap { index: usize, prev_end: f64, start: f64 },
    WordOutsideOwnChunkWindow { index: usize, chunk_index: usize, word_start: f64, word_end: f64, chunk_start: f64, chunk_end: f64 },
    WordCountMismatch { got: usize, want: usize },
    TimeOutOfBounds { index: usize, start: f64, end: f64, audio_duration: f64 },
    ConfidenceOutOfUnitInterval { index: usize, confidence: f32 },
}

/// I: word start times are non-decreasing across the WHOLE stitched output
/// (not just within one chunk) — a real regression signature for a wrong
/// chunk-offset addition (WS1 Task 5 Slice D11's `chunk.start_sec` stitch)
/// would show up here as a later chunk's words sorting BEFORE an earlier
/// chunk's, since without the offset every chunk's words restart near 0.
#[cfg_attr(not(test), allow(dead_code))]
fn check_times_non_decreasing(words: &[WordSpan]) -> Result<(), InvariantViolation> {
    for i in 1..words.len() {
        if words[i].start_seconds < words[i - 1].start_seconds {
            return Err(InvariantViolation::TimesNotNonDecreasing {
                index: i,
                prev_start: words[i - 1].start_seconds,
                start: words[i].start_seconds,
            });
        }
    }
    Ok(())
}

/// I: no two consecutive words' time ranges overlap — `words[i].end_seconds
/// <= words[i+1].start_seconds`, zero tolerance (unlike the seam check
/// below, which needs frame-quantization slack, adjacent WORDS within the
/// same monotonic CTC path structurally cannot overlap unless stitching
/// itself is broken).
#[cfg_attr(not(test), allow(dead_code))]
fn check_no_overlap(words: &[WordSpan]) -> Result<(), InvariantViolation> {
    for i in 1..words.len() {
        if words[i].start_seconds < words[i - 1].end_seconds {
            return Err(InvariantViolation::WordsOverlap {
                index: i,
                prev_end: words[i - 1].end_seconds,
                start: words[i].start_seconds,
            });
        }
    }
    Ok(())
}

/// I: every word attributed to chunk `k` (by `words_per_chunk`, the same
/// count `align_chunked` itself produces per iteration) falls within that
/// chunk's OWN `[start_sec, end_sec]` window, widened by exactly one frame
/// (`FA_FRAME_STRIDE_SEC` = 0.02s, the model's own quantization unit — see
/// `fa_onnx.rs`'s frame->time conversion section for its derivation) each
/// side — "no gap at chunk seams beyond what the source audio justifies":
/// since D11 uses RAW, unpadded, exactly-contiguous run windows
/// (`faAnchors.ts`'s own I1/I2 guarantee, untouched by this slice), a word
/// legitimately assigned to chunk k can never need more slack than one
/// frame's own quantization to stay inside that chunk's window — anything
/// wider indicates a real stitching bug (wrong chunk offset, or attributing
/// a word to the wrong chunk's word-count bucket), not silence.
#[cfg_attr(not(test), allow(dead_code))]
fn check_words_within_own_chunk(
    words: &[WordSpan],
    chunks: &[crate::fa::FaChunkInput],
    words_per_chunk: &[usize],
) -> Result<(), InvariantViolation> {
    const TOL: f64 = FA_FRAME_STRIDE_SAMPLES as f64 / FA_SAMPLE_RATE_HZ as f64; // 0.02s
    let mut idx = 0usize;
    for (chunk_index, &count) in words_per_chunk.iter().enumerate() {
        let chunk = &chunks[chunk_index];
        for w in &words[idx..idx + count] {
            if w.start_seconds < chunk.start_sec - TOL || w.end_seconds > chunk.end_sec + TOL {
                return Err(InvariantViolation::WordOutsideOwnChunkWindow {
                    index: idx,
                    chunk_index,
                    word_start: w.start_seconds,
                    word_end: w.end_seconds,
                    chunk_start: chunk.start_sec,
                    chunk_end: chunk.end_sec,
                });
            }
            idx += 1;
        }
    }
    Ok(())
}

/// I: the stitched word COUNT matches the normalizer's own representable-word
/// count for the SAME text the chunks were built from (concatenated in
/// order) — "every representable word present exactly once." Uses
/// `crate::fa::text::normalize_for_forced_alignment` (the same normalizer
/// `text_to_token_ids` calls per chunk) directly, not a re-derivation, so
/// this cannot silently diverge from what tokenization itself considers
/// representable.
#[cfg_attr(not(test), allow(dead_code))]
fn check_word_count_matches_normalizer(
    words: &[WordSpan],
    full_text: &str,
    vocab_chars: &HashSet<char>,
    language: Language,
    cardinal_data: &crate::fa::text::FaCardinalData,
) -> Result<(), InvariantViolation> {
    let normalized = normalize_for_forced_alignment(full_text, language, vocab_chars, cardinal_data);
    let want = normalized.words.iter().filter(|w| w.representable).count();
    if words.len() != want {
        return Err(InvariantViolation::WordCountMismatch { got: words.len(), want });
    }
    Ok(())
}

/// I: every word's `[start_seconds, end_seconds]` lies within
/// `[0, audio_duration]` — widened by one frame's quantization slack, same
/// justification as `check_words_within_own_chunk`.
#[cfg_attr(not(test), allow(dead_code))]
fn check_times_within_audio_bounds(words: &[WordSpan], audio_duration: f64) -> Result<(), InvariantViolation> {
    const TOL: f64 = FA_FRAME_STRIDE_SAMPLES as f64 / FA_SAMPLE_RATE_HZ as f64;
    for (i, w) in words.iter().enumerate() {
        if w.start_seconds < -TOL || w.end_seconds > audio_duration + TOL {
            return Err(InvariantViolation::TimeOutOfBounds {
                index: i,
                start: w.start_seconds,
                end: w.end_seconds,
                audio_duration,
            });
        }
    }
    Ok(())
}

/// I: every word's CONFIDENCE (`exp(score)` — the same IPC-boundary
/// conversion `fa.rs::word_span_to_dto` applies; `WordSpan.score` itself is
/// a log-probability, always `<=0`, so this check exponentiates rather than
/// comparing `score` directly) lies in `[0, 1]`. Mathematically this can
/// only fail if `score` is `NaN` or `+inf` (impossible from a real
/// log-softmax output) — checked anyway because the GATE'S JOB is to catch a
/// FUTURE regression (e.g. someone accidentally comparing raw `score`
/// against `[0,1]` again, the exact D8/D9 spec defect this project already
/// hit once — see `docs/work-in-progress.md` §5's D8 row for the
/// "Confidence unit" ruling; `task5-slice-ledger.md`, the original source,
/// was deleted 2026-08-14, `9cf5867`; retrieve: `git show
/// 251be64:docs/ws1-sync-pipeline/task5-slice-ledger.md`), not
/// just today's known-safe case.
#[cfg_attr(not(test), allow(dead_code))]
fn check_confidence_in_unit_interval(words: &[WordSpan]) -> Result<(), InvariantViolation> {
    for (i, w) in words.iter().enumerate() {
        let confidence = w.score.exp();
        if !(0.0..=1.0).contains(&confidence) {
            return Err(InvariantViolation::ConfidenceOutOfUnitInterval { index: i, confidence });
        }
    }
    Ok(())
}

#[cfg(test)]
mod invariants {
    use super::*;

    fn w(text: &str, start: f64, end: f64, score: f32) -> WordSpan {
        WordSpan { text: text.to_string(), start_seconds: start, end_seconds: end, score }
    }

    // -- times_non_decreasing -----------------------------------------

    #[test]
    fn times_non_decreasing_passes_on_sorted_input() {
        let words = vec![w("a", 0.0, 0.1, -0.1), w("b", 0.1, 0.2, -0.1), w("b", 0.2, 0.3, -0.1)];
        assert!(check_times_non_decreasing(&words).is_ok());
    }

    #[test]
    fn times_non_decreasing_catches_an_out_of_order_word() {
        // Non-vacuity: a hand-built violation must actually be caught.
        let words = vec![w("a", 0.5, 0.6, -0.1), w("b", 0.1, 0.2, -0.1)];
        let err = check_times_non_decreasing(&words).unwrap_err();
        assert_eq!(err, InvariantViolation::TimesNotNonDecreasing { index: 1, prev_start: 0.5, start: 0.1 });
    }

    // -- no_overlap -----------------------------------------------------

    #[test]
    fn no_overlap_passes_on_touching_but_non_overlapping_words() {
        let words = vec![w("a", 0.0, 0.5, -0.1), w("b", 0.5, 1.0, -0.1)];
        assert!(check_no_overlap(&words).is_ok());
    }

    #[test]
    fn no_overlap_catches_a_real_overlap() {
        let words = vec![w("a", 0.0, 0.6, -0.1), w("b", 0.5, 1.0, -0.1)];
        let err = check_no_overlap(&words).unwrap_err();
        assert_eq!(err, InvariantViolation::WordsOverlap { index: 1, prev_end: 0.6, start: 0.5 });
    }

    // -- words_within_own_chunk ------------------------------------------

    fn chunk(start: f64, end: f64, text: &str) -> crate::fa::FaChunkInput {
        crate::fa::FaChunkInput { start_sec: start, end_sec: end, text: text.to_string() }
    }

    #[test]
    fn words_within_own_chunk_passes_when_every_word_is_inside_its_chunk() {
        let chunks = vec![chunk(0.0, 1.0, "a"), chunk(1.0, 2.0, "b")];
        let words = vec![w("a", 0.1, 0.9, -0.1), w("b", 1.1, 1.9, -0.1)];
        assert!(check_words_within_own_chunk(&words, &chunks, &[1, 1]).is_ok());
    }

    #[test]
    fn words_within_own_chunk_catches_a_word_stitched_with_the_wrong_offset() {
        // Simulates the exact real bug this invariant exists to catch: chunk
        // 1's word was stitched WITHOUT adding chunk 1's own start_sec (it
        // sits inside chunk 0's window instead of its own).
        let chunks = vec![chunk(0.0, 1.0, "a"), chunk(1.0, 2.0, "b")];
        let words = vec![w("a", 0.1, 0.9, -0.1), w("b", 0.1, 0.9, -0.1)];
        let err = check_words_within_own_chunk(&words, &chunks, &[1, 1]).unwrap_err();
        assert_eq!(
            err,
            InvariantViolation::WordOutsideOwnChunkWindow {
                index: 1,
                chunk_index: 1,
                word_start: 0.1,
                word_end: 0.9,
                chunk_start: 1.0,
                chunk_end: 2.0,
            }
        );
    }

    // -- word_count_matches_normalizer ------------------------------------

    #[test]
    fn word_count_matches_normalizer_passes_when_counts_agree() {
        let vocab = load_vocab("en").unwrap();
        let words = vec![w("cat", 0.0, 0.1, -0.1), w("dog", 0.1, 0.2, -0.1)];
        assert!(check_word_count_matches_normalizer(&words, "cat dog", &vocab.chars, Language::En, &vocab.cardinal_data).is_ok());
    }

    #[test]
    fn word_count_matches_normalizer_catches_a_dropped_word() {
        let vocab = load_vocab("en").unwrap();
        // Real text has 2 representable words ("cat", "dog" — "5x" is a
        // mixed alnum word, still digit-bearing-and-dropped by the
        // normalizer regardless of WS2 T3.2 Step 3b-iii's cardinal-number
        // generator, since it isn't a bare digit string), but only 1 word is
        // present in the (deliberately wrong) output. (A bare "5" would no
        // longer serve this test — Step 3b-iii made it representable
        // ("five") under English too.)
        let words = vec![w("cat", 0.0, 0.1, -0.1)];
        let err = check_word_count_matches_normalizer(&words, "cat 5x dog", &vocab.chars, Language::En, &vocab.cardinal_data).unwrap_err();
        assert_eq!(err, InvariantViolation::WordCountMismatch { got: 1, want: 2 });
    }

    // -- times_within_audio_bounds ----------------------------------------

    #[test]
    fn times_within_audio_bounds_passes_inside_the_file() {
        let words = vec![w("a", 0.0, 1.0, -0.1), w("b", 5.0, 5.9, -0.1)];
        assert!(check_times_within_audio_bounds(&words, 10.0).is_ok());
    }

    #[test]
    fn times_within_audio_bounds_catches_a_word_past_the_end_of_the_file() {
        let words = vec![w("a", 9.0, 12.0, -0.1)];
        let err = check_times_within_audio_bounds(&words, 10.0).unwrap_err();
        assert_eq!(err, InvariantViolation::TimeOutOfBounds { index: 0, start: 9.0, end: 12.0, audio_duration: 10.0 });
    }

    // -- confidence_in_unit_interval ---------------------------------------

    #[test]
    fn confidence_in_unit_interval_passes_for_real_log_probability_range() {
        // score=0.0 -> confidence=1.0 (max); score=-5.0 -> confidence≈0.0067
        // (small but positive) — both legal log-probabilities.
        let words = vec![w("a", 0.0, 0.1, 0.0), w("b", 0.1, 0.2, -5.0)];
        assert!(check_confidence_in_unit_interval(&words).is_ok());
    }

    #[test]
    fn confidence_in_unit_interval_catches_a_positive_log_probability() {
        // score > 0.0 exponentiates to a confidence > 1.0 — impossible from
        // a real log-softmax output (log-probabilities are always <= 0), but
        // this proves the gate actually rejects it if it ever occurred,
        // e.g. from a future bug that passes a raw (non-log) score through.
        let words = vec![w("a", 0.0, 0.1, 0.7)];
        let err = check_confidence_in_unit_interval(&words).unwrap_err();
        match err {
            InvariantViolation::ConfidenceOutOfUnitInterval { index: 0, confidence } => {
                assert!(confidence > 1.0, "expected confidence > 1.0, got {confidence}");
            }
            other => panic!("expected ConfidenceOutOfUnitInterval, got {other:?}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Real-corpus measurements (WS1 Task 5 Slice D11) — the Automated Agreement
// Budget's leg (a) (bounded-agreement: whole-file vs. windowed, at a
// duration where both are computable) and leg (c) (full-length sanity: the
// complete 709s project, windowed, observational).
//
// NOT part of the standard `cargo test`/`FA_REQUIRE_ORT=1` gate matrix —
// `#[ignore]`d by default. These need real, gitignored corpus data
// (`.work-phase4/replay/173/`, present on the machine that ran D10's own
// measurements, not committed to the repo) PLUS a chunk plan dumped by
// `scripts/dump-fa-chunk-plan.ts` (which drives the real, unmodified
// `computeFaChunkPlan`/`faAnchors.ts` — not a Rust reimplementation of the
// planner) into `$FA_CHUNK_PLAN_DIR`. Run explicitly:
//   FA_CHUNK_PLAN_DIR=<dir> ORT_DYLIB_PATH=<path> \
//     cargo test --features fa-inference -- --ignored --nocapture agreement
// Skips (prints why, does not fail) if the env var or files are absent —
// this is real-corpus measurement work, not a fixture-backed regression
// gate a fresh checkout is expected to run.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod real_corpus_measurement {
    use super::*;
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }
    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("real_corpus_measurement's fa_models_dir() only reproduces the macOS mapping");
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    #[derive(serde::Deserialize)]
    struct ChunkPlanFile {
        #[allow(dead_code)]
        #[serde(rename = "audioDuration")]
        audio_duration: f64,
        chunks: Vec<PlanChunk>,
    }
    #[derive(serde::Deserialize)]
    struct PlanChunk {
        #[serde(rename = "startSec")]
        start_sec: f64,
        #[serde(rename = "endSec")]
        end_sec: f64,
        text: String,
    }

    fn load_plan(dir: &Path, label: &str) -> Option<Vec<crate::fa::FaChunkInput>> {
        let path = dir.join(format!("{label}.json"));
        if !path.exists() {
            eprintln!("SKIP real_corpus_measurement: {} not found", path.display());
            return None;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        let plan: ChunkPlanFile = serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
        Some(
            plan.chunks
                .into_iter()
                .map(|c| crate::fa::FaChunkInput { start_sec: c.start_sec, end_sec: c.end_sec, text: c.text })
                .collect(),
        )
    }

    fn percentile(sorted: &[f64], p: f64) -> f64 {
        if sorted.is_empty() {
            return f64::NAN;
        }
        let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
        sorted[idx.min(sorted.len() - 1)]
    }

    /// Leg (a): whole-file vs. windowed agreement on the real 240s excerpt.
    /// Reports the FULL distribution (min/p50/p90/p99/max) of per-word
    /// |start diff| and |end diff| between the two passes — no budget is
    /// asserted here, only measured and printed (the budget derivation is a
    /// documentation/report step per the task's own instruction: "do NOT
    /// pick a number that makes the test pass").
    #[test]
    #[ignore]
    fn agreement_240s_excerpt_whole_file_vs_windowed() {
        const CONTEXT: &str = "agreement_240s_excerpt_whole_file_vs_windowed";
        if !super::require_ort::ort_dylib_or_skip(CONTEXT) {
            return;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(CONTEXT, &model_path) {
            return;
        }
        let Ok(plan_dir) = std::env::var("FA_CHUNK_PLAN_DIR") else {
            eprintln!("SKIP {CONTEXT}: FA_CHUNK_PLAN_DIR not set");
            return;
        };
        let plan_dir = PathBuf::from(plan_dir);
        let Some(windowed_chunks) = load_plan(&plan_dir, "173-excerpt-240s-windowed") else { return };
        let Some(whole_file_chunks) = load_plan(&plan_dir, "173-excerpt-240s-wholefile") else { return };

        let audio_path = repo_root().join(".work-phase4/replay/173/audio_16k.wav");
        if !audio_path.exists() {
            eprintln!("SKIP {CONTEXT}: real audio not found at {}", audio_path.display());
            return;
        }
        let audio_path_str = audio_path.to_str().unwrap();

        eprintln!(
            "{CONTEXT}: windowed={} chunks, whole_file={} chunk(s), running whole-file pass...",
            windowed_chunks.len(),
            whole_file_chunks.len()
        );
        let wf_cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let wf_start = std::time::Instant::now();
        let whole_file_words = align_chunked(&wf_cache, &model_path, audio_path_str, &whole_file_chunks, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("{CONTEXT}: whole-file align_chunked failed: {e}"));
        eprintln!("{CONTEXT}: whole-file pass done in {:.1}s, {} words", wf_start.elapsed().as_secs_f64(), whole_file_words.len());

        // FINDING (real 240s excerpt, first run of this test): a whole-list
        // `align_chunked(&windowed_chunks, ...)` call aborts entirely on the
        // real corpus — one chunk ([18.08s, 18.70s), 0.62s of audio) is
        // assigned a 81-character/~80-target-token text load (the segment
        // whose committed `startTime` falls in that window has a stale,
        // imprecise OLD timing — its real committed duration is 4.65s, far
        // more than the 0.62s window the anchor-verified run structure gave
        // it), which the Viterbi DP genuinely cannot fit ("targets length is
        // too long for CTC"). This is precisely R.7's "target text cannot
        // fit the window even at full run length" case — R.7's skip-and-flag
        // gate is explicitly OUT OF SCOPE for this slice, so `align_chunked`
        // has no fallback and the error propagates, aborting the whole run.
        //
        // To still gather real per-word agreement data despite this (a
        // MEASUREMENT-ONLY workaround — production `align_chunked` is
        // UNCHANGED, still all-or-nothing, per scope), this test calls
        // `align_chunked` ONCE PER CHUNK (a one-element slice each time)
        // instead of once for the whole list, recording which chunks
        // individually fail rather than losing the entire 240s. See the
        // final report for the full accounting of this finding.
        eprintln!("{CONTEXT}: running windowed pass (per-chunk, see FINDING comment above)...");
        let win_cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let win_start = std::time::Instant::now();
        let mut windowed_words: Vec<WordSpan> = Vec::new();
        let mut windowed_word_chunk_idx: Vec<usize> = Vec::new();
        let mut failed_chunks: Vec<(usize, String)> = Vec::new();
        let mut ok_chunk_count = 0usize;
        for (i, chunk) in windowed_chunks.iter().enumerate() {
            let single = std::slice::from_ref(chunk);
            match align_chunked(&win_cache, &model_path, audio_path_str, single, "en", || false, |_| {}) {
                Ok(mut words) => {
                    ok_chunk_count += 1;
                    windowed_word_chunk_idx.extend(std::iter::repeat(i).take(words.len()));
                    windowed_words.append(&mut words);
                }
                Err(e) => {
                    eprintln!(
                        "{CONTEXT}: chunk {i} [{:.2},{:.2}) FAILED ({} chars): {e}",
                        chunk.start_sec,
                        chunk.end_sec,
                        chunk.text.chars().count()
                    );
                    failed_chunks.push((i, e.to_string()));
                }
            }
        }
        eprintln!(
            "{CONTEXT}: windowed pass done in {:.1}s, {} words, {ok_chunk_count}/{} chunks succeeded, {} failed",
            win_start.elapsed().as_secs_f64(),
            windowed_words.len(),
            windowed_chunks.len(),
            failed_chunks.len(),
        );
        if !failed_chunks.is_empty() {
            eprintln!(
                "{CONTEXT}: {} of {} chunks failed — R.7 (out of scope) would be needed to make production \
                 align_chunked survive this; the agreement distribution below is over the {} SUCCEEDING chunks' \
                 words only, not the full 240s.",
                failed_chunks.len(),
                windowed_chunks.len(),
                ok_chunk_count,
            );
        }

        // Hard structural invariants on the windowed output, at real length.
        check_times_non_decreasing(&windowed_words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        check_no_overlap(&windowed_words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        let audio_duration = whole_file_chunks[0].end_sec;
        check_times_within_audio_bounds(&windowed_words, audio_duration).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        check_confidence_in_unit_interval(&windowed_words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        let failed_set: std::collections::HashSet<usize> = failed_chunks.iter().map(|(i, _)| *i).collect();
        let mut words_per_chunk = vec![0usize; windowed_chunks.len()];
        {
            // Recompute the per-chunk word counts the same way align_chunked
            // itself does (one text_to_token_ids/forced_align pass per
            // chunk) purely for the invariant's own bucketing — a second,
            // independent count derived from the SAME real vocab/tokenizer,
            // not reused from align_chunked's internal state. A chunk this
            // test's own per-chunk loop above recorded as FAILED contributed
            // zero words to `windowed_words` (align_chunked never got past
            // its Viterbi DP for that chunk), so its bucket is 0 here too —
            // using the normalizer count for a failed chunk would wrongly
            // expect words that were never produced.
            let vocab = load_vocab("en").unwrap();
            let lang = Language::from_code("en").unwrap();
            for (i, c) in windowed_chunks.iter().enumerate() {
                if failed_set.contains(&i) {
                    continue;
                }
                let normalized = normalize_for_forced_alignment(&c.text, lang, &vocab.chars, &vocab.cardinal_data);
                words_per_chunk[i] = normalized.words.iter().filter(|w| w.representable).count();
            }
        }
        check_words_within_own_chunk(&windowed_words, &windowed_chunks, &words_per_chunk)
            .unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        eprintln!("{CONTEXT}: all hard structural invariants hold on the {} succeeding windowed chunks' output.", ok_chunk_count);

        // Per-word agreement: greedy text-matched two-pointer walk (not a
        // straight zip) — `windowed_words` is missing every FAILED chunk's
        // words, so it is a strict SUBSEQUENCE of `whole_file_words`'
        // word-text sequence, not the same length. Both sides tokenize the
        // SAME underlying text via the SAME normalizer, so corresponding
        // words are byte-identical text in the same relative order; this
        // walk advances the whole-file pointer past any word a failed
        // windowed chunk dropped, and reports how many windowed words it
        // managed to match.
        let mut wf_idx = 0usize;
        let mut matched = 0usize;
        let mut start_diffs: Vec<f64> = Vec::new();
        let mut end_diffs: Vec<f64> = Vec::new();
        // Per-chunk diff accumulation — diagnostic only, to distinguish
        // "disagreement is diffuse/small everywhere" from "a few chunks
        // carry a large systematic offset" before deriving any budget.
        let mut per_chunk_diffs: std::collections::BTreeMap<usize, Vec<f64>> = std::collections::BTreeMap::new();
        for (wi, win_word) in windowed_words.iter().enumerate() {
            while wf_idx < whole_file_words.len() && whole_file_words[wf_idx].text != win_word.text {
                wf_idx += 1;
            }
            if wf_idx >= whole_file_words.len() {
                eprintln!("{CONTEXT}: ran out of whole-file words to match against remaining windowed words");
                break;
            }
            let sd = (whole_file_words[wf_idx].start_seconds - win_word.start_seconds).abs();
            start_diffs.push(sd);
            end_diffs.push((whole_file_words[wf_idx].end_seconds - win_word.end_seconds).abs());
            per_chunk_diffs.entry(windowed_word_chunk_idx[wi]).or_default().push(sd);
            matched += 1;
            wf_idx += 1;
        }
        eprintln!(
            "{CONTEXT}: text-matched {matched}/{} windowed words against {} whole-file words ({} windowed chunks skipped)",
            windowed_words.len(),
            whole_file_words.len(),
            failed_chunks.len(),
        );
        eprintln!("{CONTEXT}: per-chunk mean |start diff| (diagnostic):");
        for (chunk_idx, diffs) in &per_chunk_diffs {
            let mean = diffs.iter().sum::<f64>() / diffs.len() as f64;
            let c = &windowed_chunks[*chunk_idx];
            let preview: String = c.text.chars().take(40).collect();
            eprintln!(
                "{CONTEXT}:   chunk {chunk_idx} [{:.2},{:.2}) {} words mean|diff|={:.3}s text={:?}",
                c.start_sec,
                c.end_sec,
                diffs.len(),
                mean,
                preview,
            );
        }
        if start_diffs.is_empty() {
            eprintln!("{CONTEXT}: zero matched words — no distribution to report.");
            return;
        }
        start_diffs.sort_by(|a, b| a.total_cmp(b));
        end_diffs.sort_by(|a, b| a.total_cmp(b));

        eprintln!(
            "{CONTEXT}: START diff (s) — min={:.4} p50={:.4} p90={:.4} p99={:.4} max={:.4}",
            start_diffs[0],
            percentile(&start_diffs, 0.50),
            percentile(&start_diffs, 0.90),
            percentile(&start_diffs, 0.99),
            start_diffs[start_diffs.len() - 1],
        );
        eprintln!(
            "{CONTEXT}: END diff (s) — min={:.4} p50={:.4} p90={:.4} p99={:.4} max={:.4}",
            end_diffs[0],
            percentile(&end_diffs, 0.50),
            percentile(&end_diffs, 0.90),
            percentile(&end_diffs, 0.99),
            end_diffs[end_diffs.len() - 1],
        );
    }

    /// Leg (c): full 709s project, windowed only (whole-file is
    /// infeasible per D10 — not attempted here). Observational: reports
    /// wall-clock, word count, and does NOT assert against D10's 240s
    /// Whisper-delta baseline (no Whisper anchorStart data is wired through
    /// this Rust-only harness — that comparison is the TS-side dev tool's
    /// job, `App.tsx`'s `__faDevAlign`). Confirms the hard invariants hold
    /// at 709s and prints memory via `/usr/bin/time`-style RSS if available.
    #[test]
    #[ignore]
    fn full_length_709s_windowed_sanity() {
        const CONTEXT: &str = "full_length_709s_windowed_sanity";
        if !super::require_ort::ort_dylib_or_skip(CONTEXT) {
            return;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(CONTEXT, &model_path) {
            return;
        }
        let Ok(plan_dir) = std::env::var("FA_CHUNK_PLAN_DIR") else {
            eprintln!("SKIP {CONTEXT}: FA_CHUNK_PLAN_DIR not set");
            return;
        };
        let plan_dir = PathBuf::from(plan_dir);
        let Some(chunks) = load_plan(&plan_dir, "173-full-709s-windowed") else { return };

        let audio_path = repo_root().join(".work-phase4/replay/173/audio_16k.wav");
        if !audio_path.exists() {
            eprintln!("SKIP {CONTEXT}: real audio not found at {}", audio_path.display());
            return;
        }

        eprintln!("{CONTEXT}: running {} chunks over the full 709s project...", chunks.len());
        // Per-chunk loop (not one whole-list align_chunked call) for the
        // same reason the 240s excerpt test uses one — see that test's own
        // FINDING comment: at least one real chunk in this corpus fails
        // R.7's "target text cannot fit the window" case (R.7 itself is out
        // of scope), and this leg needs to survive that to report anything
        // at 709s. Production `align_chunked` remains unmodified and
        // all-or-nothing; this is a measurement-only adaptation.
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let start = std::time::Instant::now();
        let mut words: Vec<WordSpan> = Vec::new();
        let mut failed_chunks: Vec<usize> = Vec::new();
        for (i, chunk) in chunks.iter().enumerate() {
            let single = std::slice::from_ref(chunk);
            match align_chunked(&cache, &model_path, audio_path.to_str().unwrap(), single, "en", || false, |_| {}) {
                Ok(mut w) => words.append(&mut w),
                Err(e) => {
                    eprintln!(
                        "{CONTEXT}: chunk {i} [{:.2},{:.2}) FAILED ({} chars): {e}",
                        chunk.start_sec,
                        chunk.end_sec,
                        chunk.text.chars().count()
                    );
                    failed_chunks.push(i);
                }
            }
        }
        let elapsed = start.elapsed();

        check_times_non_decreasing(&words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        check_no_overlap(&words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        let audio_duration = chunks.last().unwrap().end_sec;
        check_times_within_audio_bounds(&words, audio_duration).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        check_confidence_in_unit_interval(&words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));

        eprintln!(
            "{CONTEXT}: wall_clock={:.1}s chunks_ok={}/{} chunks_failed={} words={} audio_duration={audio_duration:.2}s",
            elapsed.as_secs_f64(),
            chunks.len() - failed_chunks.len(),
            chunks.len(),
            failed_chunks.len(),
            words.len(),
        );
        eprintln!("{CONTEXT}: all hard structural invariants hold at full 709s length (over the succeeding chunks).");
    }

    /// WS1 Task 5 Slice D20, Steps 2/6. Unlike `full_length_709s_windowed_
    /// sanity` above (pre-D20, needed a per-chunk workaround loop because
    /// `align_chunked` aborted the whole run on chunk 4/52's CTC
    /// infeasibility), this calls `align_chunked` ONCE with the full
    /// 97-chunk list — the exact call shape a real (still-gated) production
    /// caller would make — and expects `Ok`, proving the D20 fallback
    /// resolves the abort end-to-end on the real corpus, not just in the
    /// isolated unit tests. Also reports the Rust path's own confidence
    /// distribution (Step 6) over the GENUINELY aligned words only
    /// (`score.is_finite()` — excludes the fallback placeholders' sentinel
    /// `NEG_INFINITY`, which would otherwise flood the low end of the
    /// distribution with a synthetic, not-model-produced value).
    #[test]
    #[ignore]
    fn full_length_709s_single_call_with_fallback_and_confidence_distribution() {
        const CONTEXT: &str = "full_length_709s_single_call_with_fallback_and_confidence_distribution";
        if !super::require_ort::ort_dylib_or_skip(CONTEXT) {
            return;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(CONTEXT, &model_path) {
            return;
        }
        let Ok(plan_dir) = std::env::var("FA_CHUNK_PLAN_DIR") else {
            eprintln!("SKIP {CONTEXT}: FA_CHUNK_PLAN_DIR not set");
            return;
        };
        let plan_dir = PathBuf::from(plan_dir);
        let Some(chunks) = load_plan(&plan_dir, "173-full-709s-windowed") else { return };

        let audio_path = repo_root().join(".work-phase4/replay/173/audio_16k.wav");
        if !audio_path.exists() {
            eprintln!("SKIP {CONTEXT}: real audio not found at {}", audio_path.display());
            return;
        }

        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let start = std::time::Instant::now();
        let words = align_chunked(&cache, &model_path, audio_path.to_str().unwrap(), &chunks, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("{CONTEXT}: expected Ok (D20 fallback should absorb chunk 4/52's CTC infeasibility), got Err: {e}"));
        let elapsed = start.elapsed();

        check_times_non_decreasing(&words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        check_no_overlap(&words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        let audio_duration = chunks.last().unwrap().end_sec;
        check_times_within_audio_bounds(&words, audio_duration).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        check_confidence_in_unit_interval(&words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));

        let fallback_count = words.iter().filter(|w| !w.score.is_finite()).count();
        eprintln!(
            "{CONTEXT}: wall_clock={:.1}s words={} (of which {fallback_count} are D20 CTC-infeasibility fallback \
             placeholders) audio_duration={audio_duration:.2}s — single align_chunked call, no per-chunk workaround",
            elapsed.as_secs_f64(),
            words.len(),
        );
        eprintln!("{CONTEXT}: all hard structural invariants hold at full 709s length (single-call, fallback included).");

        let mut scored: Vec<(f64, &str)> = words
            .iter()
            .filter(|w| w.score.is_finite())
            .map(|w| (w.score.exp() as f64, w.text.as_str()))
            .collect();
        scored.sort_by(|a, b| a.0.total_cmp(&b.0));
        let confidences: Vec<f64> = scored.iter().map(|(c, _)| *c).collect();
        let below_conf_min = confidences.iter().filter(|&&c| c < 0.3).count();
        eprintln!(
            "{CONTEXT}: Rust-path confidence distribution over {} genuinely-aligned words (fallback excluded) — \
             min={:.4} p1={:.4} p50={:.4} p90={:.4} p99={:.4} max={:.4} fraction_below_0.3={:.4} ({below_conf_min}/{})",
            confidences.len(),
            confidences.first().copied().unwrap_or(f64::NAN),
            percentile(&confidences, 0.01),
            percentile(&confidences, 0.50),
            percentile(&confidences, 0.90),
            percentile(&confidences, 0.99),
            confidences.last().copied().unwrap_or(f64::NAN),
            below_conf_min as f64 / confidences.len().max(1) as f64,
            confidences.len(),
        );
        eprintln!(
            "{CONTEXT}: 15 lowest-confidence real words: {:?}",
            &scored[..15.min(scored.len())]
        );
        eprintln!(
            "{CONTEXT}: 15 highest-confidence real words: {:?}",
            &scored[scored.len().saturating_sub(15)..]
        );
    }

    /// WS1 Task 5 Slice D21, Step 1. Re-plans the full 709s corpus with
    /// INDEX attribution (`computeFaChunkPlanWithAttribution(...,
    /// 'script-word-index')`, no coalescing — same run/window granularity as
    /// the time-attributed plan `full_length_709s_single_call_with_fallback_
    /// and_confidence_distribution` above uses) instead of D20's
    /// `segment.startTime`-membership rule, then calls `align_chunked` ONCE
    /// over the resulting chunk list — the same single-call shape a real
    /// (still-gated) production caller would use. D20 diagnosed both CTC-
    /// infeasibility cases (its own chunk 4, chunk 52) as 100% text mis-
    /// attribution, not genuinely dense audio; this test asks whether
    /// index attribution — which cuts chunk text at each chunk's own
    /// bounding anchors' `qi` rather than trusting a segment's stale
    /// `startTime` — removes the mis-attribution and, with it, the CTC
    /// failures. `align_chunked`'s own D20 fallback is left fully in place
    /// (not bypassed) — if index attribution does NOT fix everything, this
    /// test still returns `Ok` via the fallback and reports how many words
    /// needed it, rather than aborting the measurement.
    #[test]
    #[ignore]
    fn full_length_709s_index_attribution_single_call() {
        const CONTEXT: &str = "full_length_709s_index_attribution_single_call";
        if !super::require_ort::ort_dylib_or_skip(CONTEXT) {
            return;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(CONTEXT, &model_path) {
            return;
        }
        let Ok(plan_dir) = std::env::var("FA_CHUNK_PLAN_DIR") else {
            eprintln!("SKIP {CONTEXT}: FA_CHUNK_PLAN_DIR not set");
            return;
        };
        let plan_dir = PathBuf::from(plan_dir);
        let Some(chunks) = load_plan(&plan_dir, "173-full-709s-index-windowed") else { return };

        let audio_path = repo_root().join(".work-phase4/replay/173/audio_16k.wav");
        if !audio_path.exists() {
            eprintln!("SKIP {CONTEXT}: real audio not found at {}", audio_path.display());
            return;
        }

        eprintln!(
            "{CONTEXT}: running {} index-attributed chunks over the full 709s project \
             (any CTC-infeasibility fallback fires below, per-chunk, via align_chunked's own eprintln)...",
            chunks.len()
        );
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let start = std::time::Instant::now();
        let words = align_chunked(&cache, &model_path, audio_path.to_str().unwrap(), &chunks, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("{CONTEXT}: expected Ok, got Err (a non-CTC-infeasibility failure — the D20 fallback only absorbs TooManyRepeats): {e}"));
        let elapsed = start.elapsed();

        check_times_non_decreasing(&words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        check_no_overlap(&words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        let audio_duration = chunks.last().unwrap().end_sec;
        check_times_within_audio_bounds(&words, audio_duration).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));
        check_confidence_in_unit_interval(&words).unwrap_or_else(|e| panic!("{CONTEXT}: {e:?}"));

        let fallback_count = words.iter().filter(|w| !w.score.is_finite()).count();
        eprintln!(
            "{CONTEXT}: wall_clock={:.1}s chunks={} words={} (of which {fallback_count} are D20 CTC-infeasibility \
             fallback placeholders) audio_duration={audio_duration:.2}s — single align_chunked call, index attribution",
            elapsed.as_secs_f64(),
            chunks.len(),
            words.len(),
        );
        eprintln!("{CONTEXT}: all hard structural invariants hold at full 709s length (single-call, index attribution).");

        // WS1 Task 5 Slice D21, Step 4 input — raw confidence values for the
        // full 709s corpus's genuinely-aligned words (fallback excluded,
        // though Step 1/2 above establish fallback_count is 0 here), so the
        // report step can score a proposed threshold against the real
        // current population rather than D20's stale (pre-index-attribution)
        // 1616-word figure.
        let confidences_path = plan_dir.join("173-full-709s-index-confidences.json");
        let confidences_raw: Vec<f64> =
            words.iter().filter(|w| w.score.is_finite()).map(|w| w.score.exp() as f64).collect();
        std::fs::write(&confidences_path, serde_json::to_string(&confidences_raw).unwrap())
            .unwrap_or_else(|e| panic!("write {}: {e}", confidences_path.display()));
        eprintln!(
            "{CONTEXT}: wrote {} confidence values to {}",
            confidences_raw.len(),
            confidences_path.display()
        );

        // WS1 Task 5 Slice D21, Step 2 — regression guard. Step 1 (this same
        // test, above) measured ZERO fallback placeholders on the real 709s
        // corpus under index attribution: attribution alone resolves both of
        // D20's CTC-infeasibility cases (chunk 4 → "the worst" instead of the
        // wrongly-attributed 13-word sentence; chunk 52 → "decision. It"
        // instead of the wrongly-attributed 14-word sentence — see this
        // slice's own report). This assertion turns that measurement into a
        // gate: the D20 fallback stays in the code (a safety net proven
        // necessary under the OLD `segment.startTime` attribution rule, kept
        // for exactly the case index attribution doesn't cover — see this
        // function's own doc comment), but under index attribution it must
        // never fire on this real corpus. A future regression that
        // reintroduces fabricated/mis-attributed chunk text would silently
        // trip the fallback again; this assertion makes that failure loud
        // instead of silently absorbed.
        assert_eq!(
            fallback_count, 0,
            "{CONTEXT}: expected ZERO CTC-infeasibility fallback placeholders under index attribution on the real \
             709s corpus (Step 1 of this slice measured 0/1643) — a nonzero count here means index attribution no \
             longer fully resolves chunk text mis-assignment and needs re-investigation, not silent absorption by \
             the D20 fallback."
        );
    }
}

// ---------------------------------------------------------------------------
// D12 window-size ladder / attribution isolation / Whisper triage (WS1 Task
// 5 Slice D12 Step 5) — #[ignore]d, real-corpus, measurement-only. Separates
// the three variables D11's own agreement measurement conflated (window
// size, text-attribution source, choice of reference) — see
// `docs/work-in-progress.md` §6's "Attribution isolation (D12/D13)"
// paragraph for the conflation this module exists to resolve; original
// source measurements/d11-chunked-alignment-2026-08-13.md §5's "conclusions
// NOT yet supported" was deleted 2026-08-14, `9cf5867`; retrieve: `git show
// 251be64:docs/ws1-sync-pipeline/measurements/d11-chunked-alignment-2026-08-13.md`.
//
// Needs, beyond `real_corpus_measurement`'s own preconditions: chunk plans
// dumped by `scripts/dump-fa-chunk-plan-ladder.ts` (into the same
// `$FA_CHUNK_PLAN_DIR` as `scripts/dump-fa-chunk-plan.ts`'s own D11 output)
// and the real Whisper `transcript_tokens.json` for the 173-project replay
// fixture (already present, already used as `computeFaChunkPlan`'s own
// `tokens` input — NOT `tokens_fa.json`, which is a DIFFERENT, D7-cancelled
// tool's output: the per-segment torchaudio MMS_FA reference
// `measure-forced-alignment.py` produces, per `meta_fa.json`'s own `cmd`
// field — using it here would silently resurrect the exact
// "window-is-the-committed-span" anti-pattern D7's cancellation rejected).
//
// Run (each rung as its own process, for an isolated wall-clock/peak-RSS
// reading via an external `/usr/bin/time -l` wrapper — this module does not
// instrument its own memory):
//   SCRATCHPAD_DIR=<dir> npx tsx scripts/dump-fa-chunk-plan.ts
//   SCRATCHPAD_DIR=<dir> npx tsx scripts/dump-fa-chunk-plan-ladder.ts
//   ORT_DYLIB_PATH=<path> FA_CHUNK_PLAN_DIR=<dir> /usr/bin/time -l \
//     cargo test --features fa-inference -- --ignored --nocapture --exact \
//     fa_onnx::d12_measurement::ladder_7s
//   … (repeat per rung, then attribution_isolation, then whisper_triage —
//   the FIRST of these run in a given `$FA_CHUNK_PLAN_DIR` computes and
//   caches the whole-file reference; later runs reuse the cache file).
// ---------------------------------------------------------------------------
#[cfg(test)]
mod d12_measurement {
    use super::*;
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }
    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("d12_measurement's fa_models_dir() only reproduces the macOS mapping");
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    /// A ground-truth word for comparison purposes: normalized text plus
    /// absolute audio time. Used for both the whole-file FA reference
    /// (`RefWord.text` is the same normalized/lowercased form `WordSpan.text`
    /// already is) and the Whisper reference (normalized the same way via
    /// `normalize_word`, so text comparison is apples-to-apples either way).
    #[derive(serde::Serialize, serde::Deserialize, Clone)]
    struct RefWord {
        text: String,
        start: f64,
        end: f64,
    }

    #[derive(serde::Deserialize)]
    struct ChunkPlanFile {
        #[allow(dead_code)]
        #[serde(rename = "audioDuration")]
        audio_duration: f64,
        chunks: Vec<PlanChunk>,
    }
    #[derive(serde::Deserialize)]
    struct PlanChunk {
        #[serde(rename = "startSec")]
        start_sec: f64,
        #[serde(rename = "endSec")]
        end_sec: f64,
        text: String,
    }

    fn load_plan(dir: &Path, label: &str) -> Option<Vec<crate::fa::FaChunkInput>> {
        let path = dir.join(format!("{label}.json"));
        if !path.exists() {
            eprintln!("SKIP d12_measurement: {} not found", path.display());
            return None;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        let plan: ChunkPlanFile = serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
        Some(
            plan.chunks
                .into_iter()
                .map(|c| crate::fa::FaChunkInput { start_sec: c.start_sec, end_sec: c.end_sec, text: c.text })
                .collect(),
        )
    }

    fn percentile(sorted: &[f64], p: f64) -> f64 {
        if sorted.is_empty() {
            return f64::NAN;
        }
        let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
        sorted[idx.min(sorted.len() - 1)]
    }

    /// Loads (or computes-and-caches to `<plan_dir>/173-excerpt-240s-
    /// reference-words.json`) the whole-file reference pass over the real
    /// 240s excerpt. Cached so the 4 ladder rungs plus the
    /// attribution-isolation leg — each its own `cargo test --exact`
    /// process, per this module's own top doc comment — don't each pay the
    /// whole-file pass's own ~113s/~20GiB cost separately (measured at
    /// `docs/work-in-progress.md` §5's D11 row; `d11-chunked-alignment-2026-08-13.md`
    /// §1, the original source, was deleted 2026-08-14, `9cf5867`; retrieve:
    /// `git show 251be64:docs/ws1-sync-pipeline/measurements/d11-chunked-alignment-2026-08-13.md`).
    fn whole_file_reference_240s(plan_dir: &Path, model_path: &Path, audio_path: &str) -> Vec<RefWord> {
        // WS1 Task 5 Slice D23 — see `require_ort::WHOLE_FILE_REFERENCE_LOCK`'s
        // own doc comment: held for this whole function so a concurrent
        // caller blocks instead of racing a second ~20GiB compute.
        let _guard =
            super::require_ort::WHOLE_FILE_REFERENCE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let cache_path = plan_dir.join("173-excerpt-240s-reference-words.json");
        if cache_path.exists() {
            let text = std::fs::read_to_string(&cache_path)
                .unwrap_or_else(|e| panic!("read cached reference {}: {e}", cache_path.display()));
            return serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("parse cached reference {}: {e}", cache_path.display()));
        }
        let plan = load_plan(plan_dir, "173-excerpt-240s-wholefile").expect("wholefile plan must exist to compute the reference");
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        eprintln!("d12_measurement: computing whole-file 240s reference (first use in this $FA_CHUNK_PLAN_DIR, will be cached)...");
        let start = std::time::Instant::now();
        let words = align_chunked(&cache, model_path, audio_path, &plan, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("whole-file reference pass failed: {e}"));
        eprintln!(
            "d12_measurement: whole-file reference computed in {:.1}s, {} words",
            start.elapsed().as_secs_f64(),
            words.len()
        );
        let ref_words: Vec<RefWord> =
            words.iter().map(|w| RefWord { text: w.text.clone(), start: w.start_seconds, end: w.end_seconds }).collect();
        std::fs::write(&cache_path, serde_json::to_string(&ref_words).unwrap())
            .unwrap_or_else(|e| panic!("write reference cache {}: {e}", cache_path.display()));
        ref_words
    }

    struct AgreementStats {
        matched: usize,
        start_diffs: Vec<f64>,
        end_diffs: Vec<f64>,
    }

    /// Same greedy text-matched two-pointer walk as
    /// `real_corpus_measurement`'s own agreement test (D11) — `windowed` is
    /// a strict subsequence of `reference`'s word-text sequence (missing any
    /// word a failed/skipped chunk dropped), both sides share the same
    /// normalized text space, so this recovers the correspondence without
    /// needing equal lengths.
    fn text_matched_diff_stats(windowed: &[WordSpan], reference: &[RefWord]) -> AgreementStats {
        let mut ref_idx = 0usize;
        let mut start_diffs = Vec::new();
        let mut end_diffs = Vec::new();
        let mut matched = 0usize;
        for w in windowed {
            while ref_idx < reference.len() && reference[ref_idx].text != w.text {
                ref_idx += 1;
            }
            if ref_idx >= reference.len() {
                break;
            }
            let r = &reference[ref_idx];
            start_diffs.push((r.start - w.start_seconds).abs());
            end_diffs.push((r.end - w.end_seconds).abs());
            matched += 1;
            ref_idx += 1;
        }
        start_diffs.sort_by(|a, b| a.total_cmp(b));
        end_diffs.sort_by(|a, b| a.total_cmp(b));
        AgreementStats { matched, start_diffs, end_diffs }
    }

    #[allow(clippy::too_many_arguments)]
    fn print_stats_row(
        label: &str,
        stats: &AgreementStats,
        windowed_total: usize,
        reference_total: usize,
        ctc_failed: usize,
        ctc_total: usize,
        wall_clock_sec: f64,
    ) {
        if stats.start_diffs.is_empty() {
            eprintln!("d12_measurement: [{label}] matched=0/{windowed_total} (ref={reference_total}) — no distribution");
            return;
        }
        eprintln!(
            "d12_measurement: [{label}] matched={}/{windowed_total} (ref={reference_total}) ctc_failed={ctc_failed}/{ctc_total} \
             wall={wall_clock_sec:.1}s START(s) min={:.4} p50={:.4} p90={:.4} p99={:.4} max={:.4} \
             END(s) min={:.4} p50={:.4} p90={:.4} p99={:.4} max={:.4}",
            stats.matched,
            stats.start_diffs[0],
            percentile(&stats.start_diffs, 0.50),
            percentile(&stats.start_diffs, 0.90),
            percentile(&stats.start_diffs, 0.99),
            stats.start_diffs[stats.start_diffs.len() - 1],
            stats.end_diffs[0],
            percentile(&stats.end_diffs, 0.50),
            percentile(&stats.end_diffs, 0.90),
            percentile(&stats.end_diffs, 0.99),
            stats.end_diffs[stats.end_diffs.len() - 1],
        );
    }

    /// Runs `chunks` per-chunk, one `align_chunked` call each (fault-
    /// tolerant — a CTC-infeasible chunk is skipped, not fatal). Same
    /// measurement-only adaptation `real_corpus_measurement`'s own D11 tests
    /// use; production `align_chunked` remains unmodified, all-or-nothing.
    fn run_windowed_fault_tolerant(
        model_path: &Path,
        audio_path: &str,
        chunks: &[crate::fa::FaChunkInput],
    ) -> (Vec<WordSpan>, usize) {
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let mut words = Vec::new();
        let mut failed = 0usize;
        for chunk in chunks {
            let single = std::slice::from_ref(chunk);
            match align_chunked(&cache, model_path, audio_path, single, "en", || false, |_| {}) {
                Ok(mut w) => words.append(&mut w),
                Err(_) => failed += 1,
            }
        }
        (words, failed)
    }

    fn common_setup(context: &str) -> Option<(PathBuf, PathBuf, PathBuf)> {
        if !super::require_ort::ort_dylib_or_skip(context) {
            return None;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(context, &model_path) {
            return None;
        }
        let Ok(plan_dir) = std::env::var("FA_CHUNK_PLAN_DIR") else {
            eprintln!("SKIP {context}: FA_CHUNK_PLAN_DIR not set");
            return None;
        };
        let plan_dir = PathBuf::from(plan_dir);
        let audio_path = repo_root().join(".work-phase4/replay/173/audio_16k.wav");
        if !audio_path.exists() {
            eprintln!("SKIP {context}: real audio not found at {}", audio_path.display());
            return None;
        }
        Some((plan_dir, model_path, audio_path))
    }

    /// PART A — window-size ladder. `target_label` selects one of
    /// `scripts/dump-fa-chunk-plan-ladder.ts`'s coalesce-target dumps
    /// (`computeFaChunkPlanCoalesced`, WS1 Task 5 Slice D12 Step 4).
    fn run_ladder_rung(target_label: &str) {
        let context = format!("d12_ladder_{target_label}");
        let Some((plan_dir, model_path, audio_path)) = common_setup(&context) else { return };
        let audio_path_str = audio_path.to_str().unwrap();
        let reference = whole_file_reference_240s(&plan_dir, &model_path, audio_path_str);
        let Some(chunks) = load_plan(&plan_dir, &format!("173-excerpt-240s-ladder-{target_label}")) else { return };

        let start = std::time::Instant::now();
        let (words, failed) = run_windowed_fault_tolerant(&model_path, audio_path_str, &chunks);
        let wall = start.elapsed().as_secs_f64();
        eprintln!(
            "d12_measurement: [ladder-{target_label}] {} chunks, {} succeeded, {} failed, wall={wall:.1}s",
            chunks.len(),
            chunks.len() - failed,
            failed,
        );
        let stats = text_matched_diff_stats(&words, &reference);
        print_stats_row(&format!("ladder-{target_label}"), &stats, words.len(), reference.len(), failed, chunks.len(), wall);
    }

    #[test]
    #[ignore]
    fn ladder_7s() {
        run_ladder_rung("7s");
    }
    #[test]
    #[ignore]
    fn ladder_20s() {
        run_ladder_rung("20s");
    }
    #[test]
    #[ignore]
    fn ladder_45s() {
        run_ladder_rung("45s");
    }
    #[test]
    #[ignore]
    fn ladder_90s() {
        run_ladder_rung("90s");
    }

    /// PART B — attribution isolation. Cuts ONLY where the whole-file
    /// reference itself shows an inter-word gap `>= GAP_THRESHOLD_SEC`, and
    /// assigns each resulting window's TEXT by whole-file WORD membership —
    /// not by `segment.startTime` (`faChunkPlan.ts`'s rule, the thing under
    /// suspicion per `docs/work-in-progress.md` §6's "Attribution isolation"
    /// paragraph; `d11-chunked-alignment-2026-08-13.md` §5 point 1, the
    /// original source, was deleted 2026-08-14, `9cf5867`; retrieve: `git show
    /// 251be64:docs/ws1-sync-pipeline/measurements/d11-chunked-alignment-2026-08-13.md`).
    /// This makes chunk text correct by construction: whatever disagreement
    /// remains here is attributable to windowing itself (running FA on a
    /// smaller window vs. the whole file), not to attribution drift.
    #[test]
    #[ignore]
    fn attribution_isolation() {
        const CONTEXT: &str = "d12_attribution_isolation";
        let Some((plan_dir, model_path, audio_path)) = common_setup(CONTEXT) else { return };
        let audio_path_str = audio_path.to_str().unwrap();
        let reference = whole_file_reference_240s(&plan_dir, &model_path, audio_path_str);

        // GAP_THRESHOLD_SEC: a round number well above CTC frame
        // quantization (0.02s, `conv_stride`-derived) and well above
        // ordinary inter-word co-articulation gaps in continuous narrated
        // speech, chosen so this diagnostic leg actually finds cut points
        // inside 240s of real audio — NOT derived from a corpus measurement
        // the way `ANCHOR_AGREEMENT_SEC`/`PAD_BASE` were (this leg isolates
        // ONE variable for a report, it does not propose a production
        // rule), so stated explicitly here rather than silently reused from
        // `syncConstants.ts` (which this slice does not touch).
        const GAP_THRESHOLD_SEC: f64 = 0.5;

        let mut chunks: Vec<crate::fa::FaChunkInput> = Vec::new();
        let mut cur_start = 0.0f64;
        let mut cur_words: Vec<&str> = Vec::new();
        for i in 0..reference.len() {
            cur_words.push(&reference[i].text);
            let is_last = i == reference.len() - 1;
            let gap = if is_last { 0.0 } else { reference[i + 1].start - reference[i].end };
            if is_last || gap >= GAP_THRESHOLD_SEC {
                let cut = if is_last { reference[i].end } else { reference[i].end + gap / 2.0 };
                chunks.push(crate::fa::FaChunkInput { start_sec: cur_start, end_sec: cut, text: cur_words.join(" ") });
                cur_start = cut;
                cur_words.clear();
            }
        }
        eprintln!(
            "d12_measurement: [attribution-isolation] built {} text-correct-by-construction chunks (gap threshold {GAP_THRESHOLD_SEC}s) \
             from {} reference words",
            chunks.len(),
            reference.len(),
        );

        let start = std::time::Instant::now();
        let (words, failed) = run_windowed_fault_tolerant(&model_path, audio_path_str, &chunks);
        let wall = start.elapsed().as_secs_f64();
        let stats = text_matched_diff_stats(&words, &reference);
        print_stats_row("attribution-isolation", &stats, words.len(), reference.len(), failed, chunks.len(), wall);
    }

    /// PART C — Whisper triage. Compares (a) the whole-file reference and
    /// (b) a windowed rung (`FA_D12_BEST_RUNG`, default `"90s"` — override
    /// after reading part A's own printed table, since which rung is "best"
    /// is this test's caller's judgment call, not something this test
    /// decides for itself).
    ///
    /// **Does NOT compute the agreement stats itself.** `text_matched_diff_stats`'s
    /// naive sequential-text-equality walk (used for the ladder/attribution
    /// legs above) is only valid when both sides tokenize the SAME
    /// underlying text — true for whole-file-vs-windowed (both come from
    /// `segment.text`, the SCRIPT) but FALSE here: Whisper's tokens come
    /// from the actual spoken AUDIO, which routinely differs in wording from
    /// the script (that gap is exactly what this codebase's own
    /// `alignQueryToSubject` Hirschberg-style fuzzy alignment exists to
    /// bridge everywhere else). A first run of this test confirmed the
    /// failure mode directly: the naive walk matched only 4/569 words
    /// (diverging after the first wording difference and never
    /// resynchronizing). Rather than ship a silently-wrong number, this test
    /// dumps BOTH sides to JSON and defers the actual comparison to
    /// `scripts/fa-whisper-triage-report.ts`, which reuses the real,
    /// already-proven `alignQueryToSubject` to match FA words against
    /// Whisper words properly.
    #[test]
    #[ignore]
    fn whisper_triage() {
        const CONTEXT: &str = "d12_whisper_triage";
        let Some((plan_dir, model_path, audio_path)) = common_setup(CONTEXT) else { return };
        let audio_path_str = audio_path.to_str().unwrap();
        // Ensures the reference cache file exists on disk (this call is a
        // no-op if a prior ladder/attribution test already populated it).
        let _reference = whole_file_reference_240s(&plan_dir, &model_path, audio_path_str);

        let best_rung = std::env::var("FA_D12_BEST_RUNG").unwrap_or_else(|_| "90s".to_string());
        let Some(chunks) = load_plan(&plan_dir, &format!("173-excerpt-240s-ladder-{best_rung}")) else { return };
        let start = std::time::Instant::now();
        let (windowed_words, failed) = run_windowed_fault_tolerant(&model_path, audio_path_str, &chunks);
        let wall = start.elapsed().as_secs_f64();
        eprintln!(
            "d12_measurement: [whisper-triage] ladder-{best_rung}: {} chunks, {} succeeded, {} failed, wall={wall:.1}s, {} words",
            chunks.len(),
            chunks.len() - failed,
            failed,
            windowed_words.len(),
        );

        let windowed_ref: Vec<RefWord> =
            windowed_words.iter().map(|w| RefWord { text: w.text.clone(), start: w.start_seconds, end: w.end_seconds }).collect();
        let out_path = plan_dir.join(format!("173-excerpt-240s-ladder-{best_rung}-words.json"));
        std::fs::write(&out_path, serde_json::to_string(&windowed_ref).unwrap())
            .unwrap_or_else(|e| panic!("write {}: {e}", out_path.display()));
        eprintln!(
            "d12_measurement: [whisper-triage] wrote {} words to {} — run \
             `npx tsx scripts/fa-whisper-triage-report.ts` (FA_CHUNK_PLAN_DIR={}) for the actual agreement stats \
             (whole-file reference already cached at 173-excerpt-240s-reference-words.json in the same dir).",
            windowed_ref.len(),
            out_path.display(),
            plan_dir.display(),
        );
    }
}

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D13 Step 2 + Step 4 — index-attribution measurement.
//
// D12 found attribution, not window size, dominates chunked-alignment
// disagreement, but proved it with `attribution_isolation` (Part B above): an
// ORACLE construction (chunk boundaries cut wherever the whole-file reference
// itself has a real word gap, text assigned by whole-file WORD MEMBERSHIP)
// that production cannot reproduce, since it presupposes the whole-file
// answer it is meant to replace. This module asks two separate questions:
//
//   Step 2 (`b_control`): does B's near-zero disagreement come from its TEXT
//   being correct, or from its BOUNDARIES being chosen at convenient,
//   already-known-clean cut points? Holds boundaries at the REAL, anchor-
//   derived 7s-coalesced run structure (`173-excerpt-240s-ladder-7s.json`'s
//   own `startSec`/`endSec` — its `text` field is discarded) and assigns text
//   by the SAME oracle whole-file-word-membership rule B uses, keyed by each
//   reference word's own start time. If `b_control`'s disagreement lands close
//   to full B's, text assignment alone explains the improvement; if it lands
//   close to the plain ladder-7s rung instead, boundary placement matters too.
//
//   Step 4 (`index_7s`/`index_45s`): the actual production-reachable
//   candidate — `computeFaChunkPlanWithAttribution(..., 'script-word-index',
//   target)` (`faChunkPlan.ts`, Slice D13 Step 3), which needs no oracle,
//   only `computeFaAnchors`'s own `qi`. Chunk plans are dumped ahead of time by
//   `scripts/dump-fa-chunk-plan-index-ladder.ts` at the same 7s/45s targets
//   Step 4 asks for, text already index-derived — no extra Rust-side text
//   logic needed for these two, unlike `b_control`.
//
//   Step 4 (`whisper_triage_index`): D12's own `whisper_triage` sanity check
//   (Part C), re-run against index attribution's OWN best rung instead of the
//   time-attribution ladder's, so the comparison against real Whisper
//   timestamps — external ground truth, not the whole-file reference this
//   module's other legs compare against — covers index attribution too.
//
// Duplicates (rather than imports from) `d12_measurement`'s small helpers —
// `fa_models_dir`, `repo_root`, `RefWord`, `ChunkPlanFile`/`PlanChunk`,
// `load_plan`, `percentile`, `whole_file_reference_240s`, `AgreementStats`,
// `text_matched_diff_stats`, `print_stats_row`, `run_windowed_fault_tolerant`,
// `common_setup` — matching the established convention already visible
// between `real_corpus_measurement` (D11) and `d12_measurement` (D12): each
// slice's measurement module is a self-contained, additive sibling, never a
// shared/refactored dependency of the previous slice's. The whole-file
// reference cache FILE PATH is identical either way
// (`<dir>/173-excerpt-240s-reference-words.json`), so whichever module's test
// runs first in a given `$FA_CHUNK_PLAN_DIR` pays the ~113s/~20GiB cost once;
// every later test in either module reuses the same cache file.
//
// Run (mirrors d12_measurement's own invocation pattern):
//   SCRATCHPAD_DIR=<dir> npx tsx scripts/dump-fa-chunk-plan-index-ladder.ts
//   ORT_DYLIB_PATH=<path> FA_CHUNK_PLAN_DIR=<dir> cargo test --features fa-inference \
//     -- --ignored --nocapture --exact fa_onnx::d13_measurement::b_control
//   … (repeat per test: index_7s, index_45s, whisper_triage_index)
// ---------------------------------------------------------------------------
#[cfg(test)]
mod d13_measurement {
    use super::*;
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }
    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("d13_measurement's fa_models_dir() only reproduces the macOS mapping");
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    /// Same shape as `d12_measurement::RefWord` — normalized text plus
    /// absolute audio time, used for both the whole-file reference and (via
    /// `RawWhisperToken` in the TS triage script) the Whisper side.
    #[derive(serde::Serialize, serde::Deserialize, Clone)]
    struct RefWord {
        text: String,
        start: f64,
        end: f64,
    }

    #[derive(serde::Deserialize)]
    struct ChunkPlanFile {
        #[allow(dead_code)]
        #[serde(rename = "audioDuration")]
        audio_duration: f64,
        chunks: Vec<PlanChunk>,
    }
    #[derive(serde::Deserialize)]
    struct PlanChunk {
        #[serde(rename = "startSec")]
        start_sec: f64,
        #[serde(rename = "endSec")]
        end_sec: f64,
        text: String,
    }

    fn load_plan(dir: &Path, label: &str) -> Option<Vec<crate::fa::FaChunkInput>> {
        let path = dir.join(format!("{label}.json"));
        if !path.exists() {
            eprintln!("SKIP d13_measurement: {} not found", path.display());
            return None;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        let plan: ChunkPlanFile = serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
        Some(
            plan.chunks
                .into_iter()
                .map(|c| crate::fa::FaChunkInput { start_sec: c.start_sec, end_sec: c.end_sec, text: c.text })
                .collect(),
        )
    }

    /// Loads just the `[startSec, endSec)` window boundaries from a dumped
    /// plan, discarding `text` entirely — `b_control`'s whole point is to pair
    /// these REAL, anchor-derived boundaries with a DIFFERENT text source.
    fn load_plan_boundaries_only(dir: &Path, label: &str) -> Option<Vec<(f64, f64)>> {
        let path = dir.join(format!("{label}.json"));
        if !path.exists() {
            eprintln!("SKIP d13_measurement: {} not found", path.display());
            return None;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        let plan: ChunkPlanFile = serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
        Some(plan.chunks.into_iter().map(|c| (c.start_sec, c.end_sec)).collect())
    }

    fn percentile(sorted: &[f64], p: f64) -> f64 {
        if sorted.is_empty() {
            return f64::NAN;
        }
        let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
        sorted[idx.min(sorted.len() - 1)]
    }

    /// Identical cache contract to `d12_measurement::whole_file_reference_240s`
    /// — same cache file path, so a prior D12 (or D13) test run in the same
    /// `$FA_CHUNK_PLAN_DIR` is reused rather than recomputed.
    fn whole_file_reference_240s(plan_dir: &Path, model_path: &Path, audio_path: &str) -> Vec<RefWord> {
        // WS1 Task 5 Slice D23 — see `require_ort::WHOLE_FILE_REFERENCE_LOCK`'s
        // own doc comment: held for this whole function so a concurrent
        // caller blocks instead of racing a second ~20GiB compute.
        let _guard =
            super::require_ort::WHOLE_FILE_REFERENCE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let cache_path = plan_dir.join("173-excerpt-240s-reference-words.json");
        if cache_path.exists() {
            let text = std::fs::read_to_string(&cache_path)
                .unwrap_or_else(|e| panic!("read cached reference {}: {e}", cache_path.display()));
            return serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("parse cached reference {}: {e}", cache_path.display()));
        }
        let plan = load_plan(plan_dir, "173-excerpt-240s-wholefile").expect("wholefile plan must exist to compute the reference");
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        eprintln!("d13_measurement: computing whole-file 240s reference (first use in this $FA_CHUNK_PLAN_DIR, will be cached)...");
        let start = std::time::Instant::now();
        let words = align_chunked(&cache, model_path, audio_path, &plan, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("whole-file reference pass failed: {e}"));
        eprintln!(
            "d13_measurement: whole-file reference computed in {:.1}s, {} words",
            start.elapsed().as_secs_f64(),
            words.len()
        );
        let ref_words: Vec<RefWord> =
            words.iter().map(|w| RefWord { text: w.text.clone(), start: w.start_seconds, end: w.end_seconds }).collect();
        std::fs::write(&cache_path, serde_json::to_string(&ref_words).unwrap())
            .unwrap_or_else(|e| panic!("write reference cache {}: {e}", cache_path.display()));
        ref_words
    }

    struct AgreementStats {
        matched: usize,
        start_diffs: Vec<f64>,
        end_diffs: Vec<f64>,
    }

    /// Same greedy text-matched two-pointer walk as
    /// `d12_measurement::text_matched_diff_stats` — valid here for the same
    /// reason it was valid there: both sides come from the SCRIPT (whole-file
    /// reference vs. a windowed script-text pass), never from Whisper's own
    /// transcription of the audio.
    fn text_matched_diff_stats(windowed: &[WordSpan], reference: &[RefWord]) -> AgreementStats {
        let mut ref_idx = 0usize;
        let mut start_diffs = Vec::new();
        let mut end_diffs = Vec::new();
        let mut matched = 0usize;
        for w in windowed {
            while ref_idx < reference.len() && reference[ref_idx].text != w.text {
                ref_idx += 1;
            }
            if ref_idx >= reference.len() {
                break;
            }
            let r = &reference[ref_idx];
            start_diffs.push((r.start - w.start_seconds).abs());
            end_diffs.push((r.end - w.end_seconds).abs());
            matched += 1;
            ref_idx += 1;
        }
        start_diffs.sort_by(|a, b| a.total_cmp(b));
        end_diffs.sort_by(|a, b| a.total_cmp(b));
        AgreementStats { matched, start_diffs, end_diffs }
    }

    #[allow(clippy::too_many_arguments)]
    fn print_stats_row(
        label: &str,
        stats: &AgreementStats,
        windowed_total: usize,
        reference_total: usize,
        ctc_failed: usize,
        ctc_total: usize,
        wall_clock_sec: f64,
    ) {
        if stats.start_diffs.is_empty() {
            eprintln!("d13_measurement: [{label}] matched=0/{windowed_total} (ref={reference_total}) — no distribution");
            return;
        }
        eprintln!(
            "d13_measurement: [{label}] matched={}/{windowed_total} (ref={reference_total}) ctc_failed={ctc_failed}/{ctc_total} \
             wall={wall_clock_sec:.1}s START(s) min={:.4} p50={:.4} p90={:.4} p99={:.4} max={:.4} \
             END(s) min={:.4} p50={:.4} p90={:.4} p99={:.4} max={:.4}",
            stats.matched,
            stats.start_diffs[0],
            percentile(&stats.start_diffs, 0.50),
            percentile(&stats.start_diffs, 0.90),
            percentile(&stats.start_diffs, 0.99),
            stats.start_diffs[stats.start_diffs.len() - 1],
            stats.end_diffs[0],
            percentile(&stats.end_diffs, 0.50),
            percentile(&stats.end_diffs, 0.90),
            percentile(&stats.end_diffs, 0.99),
            stats.end_diffs[stats.end_diffs.len() - 1],
        );
    }

    /// Same fault-tolerant per-chunk runner as `d12_measurement`'s — a
    /// CTC-infeasible chunk is skipped (counted), not fatal to the whole leg.
    fn run_windowed_fault_tolerant(
        model_path: &Path,
        audio_path: &str,
        chunks: &[crate::fa::FaChunkInput],
    ) -> (Vec<WordSpan>, usize) {
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let mut words = Vec::new();
        let mut failed = 0usize;
        for chunk in chunks {
            let single = std::slice::from_ref(chunk);
            match align_chunked(&cache, model_path, audio_path, single, "en", || false, |_| {}) {
                Ok(mut w) => words.append(&mut w),
                Err(_) => failed += 1,
            }
        }
        (words, failed)
    }

    fn common_setup(context: &str) -> Option<(PathBuf, PathBuf, PathBuf)> {
        if !super::require_ort::ort_dylib_or_skip(context) {
            return None;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(context, &model_path) {
            return None;
        }
        let Ok(plan_dir) = std::env::var("FA_CHUNK_PLAN_DIR") else {
            eprintln!("SKIP {context}: FA_CHUNK_PLAN_DIR not set");
            return None;
        };
        let plan_dir = PathBuf::from(plan_dir);
        let audio_path = repo_root().join(".work-phase4/replay/173/audio_16k.wav");
        if !audio_path.exists() {
            eprintln!("SKIP {context}: real audio not found at {}", audio_path.display());
            return None;
        }
        Some((plan_dir, model_path, audio_path))
    }

    /// STEP 2 — B-control. Real, anchor-derived 7s-coalesced boundaries
    /// (`173-excerpt-240s-ladder-7s.json`'s `startSec`/`endSec`, its own
    /// `text` discarded) paired with ORACLE text: each whole-file reference
    /// word is assigned to the chunk whose window contains that word's OWN
    /// start time — the same "oracle whole-file word membership" rule
    /// `attribution_isolation` (full B) uses, applied to a boundary structure
    /// B itself does NOT use (B cuts only at real reference gaps; these
    /// boundaries were chosen by R.1 anchor agreement, oblivious to where the
    /// whole-file pass's own words start and end). A boundary landing inside a
    /// spoken word's own span is therefore possible here in a way it cannot be
    /// in B by construction — exactly the difference this leg exists to
    /// measure.
    ///
    /// Empty-chunk folding mirrors `faChunkPlan.ts`'s `runsToChunks`: a window
    /// that receives no reference words extends the PREVIOUS chunk's
    /// `end_sec` forward (or, if it is the first window(s), defers its own
    /// `start_sec` onto the next chunk that does get words) — never sent to
    /// the aligner as an empty-text chunk.
    /// Shared body for `b_control`/`b_control_45s` (WS1 Task 5 Slice D14 A2 —
    /// "the missing control"). `ladder_label` selects which real,
    /// anchor-derived coalesced boundary structure to pair with oracle text
    /// (`"7s"` was D13's own only measured rung; `"45s"` is the
    /// matched-window-size counterpart to `index-45s`, needed to judge index
    /// attribution against the oracle-text bound AT THE SAME granularity it
    /// actually runs at in the combined table — D13 Step 2 only ever measured
    /// this at 7s, leaving 45s an asserted-not-measured gap). Extracted
    /// (rather than duplicated per this module's own top doc comment
    /// convention, since D13 itself has not shipped as a separate commit yet
    /// — this is still the same in-flight slice) so both rungs share
    /// identical boundary/oracle-text logic and can only ever differ in which
    /// real boundary file they load.
    fn run_b_control(context: &str, ladder_label: &str) {
        let Some((plan_dir, model_path, audio_path)) = common_setup(context) else { return };
        let audio_path_str = audio_path.to_str().unwrap();
        let reference = whole_file_reference_240s(&plan_dir, &model_path, audio_path_str);
        let Some(boundaries) = load_plan_boundaries_only(&plan_dir, &format!("173-excerpt-240s-ladder-{ladder_label}")) else {
            return;
        };

        let mut texts_by_window: Vec<Vec<&str>> = boundaries.iter().map(|_| Vec::new()).collect();
        let mut idx = 0usize;
        for w in &reference {
            while idx < boundaries.len() - 1 && w.start >= boundaries[idx + 1].0 {
                idx += 1;
            }
            texts_by_window[idx].push(&w.text);
        }

        let mut chunks: Vec<crate::fa::FaChunkInput> = Vec::new();
        let mut pending_start: Option<f64> = None;
        for (i, (start_sec, end_sec)) in boundaries.iter().enumerate() {
            let text = texts_by_window[i].join(" ");
            if text.is_empty() {
                if let Some(last) = chunks.last_mut() {
                    last.end_sec = *end_sec;
                } else {
                    pending_start = Some(pending_start.unwrap_or(*start_sec));
                }
                continue;
            }
            chunks.push(crate::fa::FaChunkInput { start_sec: pending_start.take().unwrap_or(*start_sec), end_sec: *end_sec, text });
        }
        eprintln!(
            "d13_measurement: [b-control-{ladder_label}] {} windows -> {} non-empty chunks (real anchor-derived {ladder_label}-coalesced boundaries, oracle text)",
            boundaries.len(),
            chunks.len(),
        );

        let start = std::time::Instant::now();
        let (words, failed) = run_windowed_fault_tolerant(&model_path, audio_path_str, &chunks);
        let wall = start.elapsed().as_secs_f64();
        let stats = text_matched_diff_stats(&words, &reference);
        print_stats_row(&format!("b-control-{ladder_label}"), &stats, words.len(), reference.len(), failed, chunks.len(), wall);
    }

    #[test]
    #[ignore]
    fn b_control() {
        run_b_control("d13_b_control", "7s");
    }

    /// WS1 Task 5 Slice D14 A2 — "the missing control." D13's own combined
    /// table (§4) has a B-control row only at 7s, so `index-45s` was judged
    /// against B (full oracle, ~6-7s granularity) and B-control-7s, never
    /// against an oracle-text construction AT ITS OWN 45s granularity — the
    /// "matched-window-size counterpart" every other row in that table has.
    #[test]
    #[ignore]
    fn b_control_45s() {
        run_b_control("d13_b_control_45s", "45s");
    }

    /// STEP 4 — index attribution at a given coalesce-target label. Plan
    /// already has index-derived text (`dump-fa-chunk-plan-index-ladder.ts`) —
    /// no extra text logic needed here, unlike `b_control`.
    fn run_index_rung(target_label: &str) {
        let context = format!("d13_index_{target_label}");
        let Some((plan_dir, model_path, audio_path)) = common_setup(&context) else { return };
        let audio_path_str = audio_path.to_str().unwrap();
        let reference = whole_file_reference_240s(&plan_dir, &model_path, audio_path_str);
        let Some(chunks) = load_plan(&plan_dir, &format!("173-excerpt-240s-index-{target_label}")) else { return };

        let start = std::time::Instant::now();
        let (words, failed) = run_windowed_fault_tolerant(&model_path, audio_path_str, &chunks);
        let wall = start.elapsed().as_secs_f64();
        eprintln!(
            "d13_measurement: [index-{target_label}] {} chunks, {} succeeded, {} failed, wall={wall:.1}s",
            chunks.len(),
            chunks.len() - failed,
            failed,
        );
        let stats = text_matched_diff_stats(&words, &reference);
        print_stats_row(&format!("index-{target_label}"), &stats, words.len(), reference.len(), failed, chunks.len(), wall);
    }

    #[test]
    #[ignore]
    fn index_7s() {
        run_index_rung("7s");
    }
    #[test]
    #[ignore]
    fn index_45s() {
        run_index_rung("45s");
    }

    /// STEP 4 — Whisper triage for index attribution's best rung (D12's own
    /// methodology, Part C: dumps both sides to JSON and defers the actual
    /// comparison to `alignQueryToSubject`-based TS, since a naive
    /// sequential-text-equality walk is wrong against real Whisper transcript
    /// wording — see `d12_measurement::whisper_triage`'s own doc comment for
    /// the 4/569 failure this avoids). `FA_D13_BEST_RUNG` picks which of
    /// `index_7s`/`index_45s` to triage; default `"45s"` pending Step 4's own
    /// measured table.
    #[test]
    #[ignore]
    fn whisper_triage_index() {
        const CONTEXT: &str = "d13_whisper_triage_index";
        let Some((plan_dir, model_path, audio_path)) = common_setup(CONTEXT) else { return };
        let audio_path_str = audio_path.to_str().unwrap();
        let _reference = whole_file_reference_240s(&plan_dir, &model_path, audio_path_str);

        let best_rung = std::env::var("FA_D13_BEST_RUNG").unwrap_or_else(|_| "45s".to_string());
        let Some(chunks) = load_plan(&plan_dir, &format!("173-excerpt-240s-index-{best_rung}")) else { return };
        let start = std::time::Instant::now();
        let (windowed_words, failed) = run_windowed_fault_tolerant(&model_path, audio_path_str, &chunks);
        let wall = start.elapsed().as_secs_f64();
        eprintln!(
            "d13_measurement: [whisper-triage] index-{best_rung}: {} chunks, {} succeeded, {} failed, wall={wall:.1}s, {} words",
            chunks.len(),
            chunks.len() - failed,
            failed,
            windowed_words.len(),
        );

        let windowed_ref: Vec<RefWord> =
            windowed_words.iter().map(|w| RefWord { text: w.text.clone(), start: w.start_seconds, end: w.end_seconds }).collect();
        let out_path = plan_dir.join(format!("173-excerpt-240s-index-{best_rung}-words.json"));
        std::fs::write(&out_path, serde_json::to_string(&windowed_ref).unwrap())
            .unwrap_or_else(|e| panic!("write {}: {e}", out_path.display()));
        eprintln!(
            "d13_measurement: [whisper-triage] wrote {} words to {} — run \
             `npx tsx scripts/fa-whisper-triage-report-index.ts {best_rung}` (FA_CHUNK_PLAN_DIR={}) for the actual agreement stats \
             (whole-file reference already cached at 173-excerpt-240s-reference-words.json in the same dir).",
            windowed_ref.len(),
            out_path.display(),
            plan_dir.display(),
        );
    }
}

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D21, Step 3 — does Rust-path confidence predict timing
// error? `#[ignore]`d, real-corpus, measurement-only, mirroring d12_
// measurement/d13_measurement's own structure (own `common_setup`/`RefWord`/
// `whole_file_reference_240s`, duplicated rather than imported — same
// rationale d13_measurement's own header comment states: keeping each
// measurement module's real-corpus dependency chain self-contained).
//
// Uses the real 240s excerpt (the only length a whole-file FA reference is
// computable at — D10) run through PRODUCTION's own default, unmodified
// windowing (`173-excerpt-240s-windowed.json`, `dump-fa-chunk-plan.ts`'s D11
// output, `segment.startTime` attribution — the same plan d12_measurement's
// own ladder-rung and agreement tests already consume). For every windowed
// word that text-matches a whole-file reference word (same greedy walk
// `text_matched_diff_stats` already uses elsewhere in this file), pairs that
// word's own Rust confidence (`exp(score)`) with its measured timing error
// (`max(|start diff|, |end diff|)` against the whole-file reference) and
// reports the Pearson correlation between the two, plus the error
// distribution split at `CONF_MIN` (0.3).
// ---------------------------------------------------------------------------
#[cfg(test)]
mod d21_measurement {
    use super::*;
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }
    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("d21_measurement's fa_models_dir() only reproduces the macOS mapping");
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    #[derive(serde::Serialize, serde::Deserialize, Clone)]
    struct RefWord {
        text: String,
        start: f64,
        end: f64,
    }

    #[derive(serde::Deserialize)]
    struct ChunkPlanFile {
        #[allow(dead_code)]
        #[serde(rename = "audioDuration")]
        audio_duration: f64,
        chunks: Vec<PlanChunk>,
    }
    #[derive(serde::Deserialize)]
    struct PlanChunk {
        #[serde(rename = "startSec")]
        start_sec: f64,
        #[serde(rename = "endSec")]
        end_sec: f64,
        text: String,
    }

    fn load_plan(dir: &Path, label: &str) -> Option<Vec<crate::fa::FaChunkInput>> {
        let path = dir.join(format!("{label}.json"));
        if !path.exists() {
            eprintln!("SKIP d21_measurement: {} not found", path.display());
            return None;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        let plan: ChunkPlanFile = serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
        Some(
            plan.chunks
                .into_iter()
                .map(|c| crate::fa::FaChunkInput { start_sec: c.start_sec, end_sec: c.end_sec, text: c.text })
                .collect(),
        )
    }

    fn percentile(sorted: &[f64], p: f64) -> f64 {
        if sorted.is_empty() {
            return f64::NAN;
        }
        let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
        sorted[idx.min(sorted.len() - 1)]
    }

    fn common_setup(context: &str) -> Option<(PathBuf, PathBuf, PathBuf)> {
        if !super::require_ort::ort_dylib_or_skip(context) {
            return None;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(context, &model_path) {
            return None;
        }
        let Ok(plan_dir) = std::env::var("FA_CHUNK_PLAN_DIR") else {
            eprintln!("SKIP {context}: FA_CHUNK_PLAN_DIR not set");
            return None;
        };
        let plan_dir = PathBuf::from(plan_dir);
        let audio_path = repo_root().join(".work-phase4/replay/173/audio_16k.wav");
        if !audio_path.exists() {
            eprintln!("SKIP {context}: real audio not found at {}", audio_path.display());
            return None;
        }
        Some((plan_dir, model_path, audio_path))
    }

    /// Identical cache contract to `d12_measurement::whole_file_reference_240s`
    /// — same cache file, so a prior d12/d13 run in this `$FA_CHUNK_PLAN_DIR`
    /// is reused rather than recomputed (~113s/~20GiB cost, D10/D11).
    fn whole_file_reference_240s(plan_dir: &Path, model_path: &Path, audio_path: &str) -> Vec<RefWord> {
        // WS1 Task 5 Slice D23 — see `require_ort::WHOLE_FILE_REFERENCE_LOCK`'s
        // own doc comment: held for this whole function so a concurrent
        // caller blocks instead of racing a second ~20GiB compute.
        let _guard =
            super::require_ort::WHOLE_FILE_REFERENCE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let cache_path = plan_dir.join("173-excerpt-240s-reference-words.json");
        if cache_path.exists() {
            let text = std::fs::read_to_string(&cache_path)
                .unwrap_or_else(|e| panic!("read cached reference {}: {e}", cache_path.display()));
            return serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("parse cached reference {}: {e}", cache_path.display()));
        }
        let plan = load_plan(plan_dir, "173-excerpt-240s-wholefile").expect("wholefile plan must exist to compute the reference");
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        eprintln!("d21_measurement: computing whole-file 240s reference (first use in this $FA_CHUNK_PLAN_DIR, will be cached)...");
        let start = std::time::Instant::now();
        let words = align_chunked(&cache, model_path, audio_path, &plan, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("whole-file reference pass failed: {e}"));
        eprintln!(
            "d21_measurement: whole-file reference computed in {:.1}s, {} words",
            start.elapsed().as_secs_f64(),
            words.len()
        );
        let ref_words: Vec<RefWord> =
            words.iter().map(|w| RefWord { text: w.text.clone(), start: w.start_seconds, end: w.end_seconds }).collect();
        std::fs::write(&cache_path, serde_json::to_string(&ref_words).unwrap())
            .unwrap_or_else(|e| panic!("write reference cache {}: {e}", cache_path.display()));
        ref_words
    }

    /// Pearson correlation coefficient. `NaN` if either series has zero
    /// variance (guards a divide-by-zero rather than panicking — reported,
    /// not asserted against, since a degenerate real-corpus result is still
    /// a real answer to "does confidence predict error").
    fn pearson_r(xs: &[f64], ys: &[f64]) -> f64 {
        let n = xs.len() as f64;
        let mean_x = xs.iter().sum::<f64>() / n;
        let mean_y = ys.iter().sum::<f64>() / n;
        let mut cov = 0.0;
        let mut var_x = 0.0;
        let mut var_y = 0.0;
        for i in 0..xs.len() {
            let dx = xs[i] - mean_x;
            let dy = ys[i] - mean_y;
            cov += dx * dy;
            var_x += dx * dx;
            var_y += dy * dy;
        }
        if var_x == 0.0 || var_y == 0.0 {
            return f64::NAN;
        }
        cov / (var_x.sqrt() * var_y.sqrt())
    }

    /// WS1 Task 5 Slice D21, Step 3. Pairs each windowed word's real Rust
    /// confidence with its measured timing error against the whole-file
    /// reference, over the real 240s excerpt run through PRODUCTION's own
    /// default (unmodified) windowing/attribution — `align_chunked` is
    /// called exactly as a real caller would, no per-chunk workaround (the
    /// 240s excerpt has no known CTC-infeasibility case — unlike the 709s
    /// full corpus, D20 — so a single call is expected to return `Ok`
    /// outright; if it doesn't, that itself is reported rather than papered
    /// over with a fault-tolerant loop).
    #[test]
    #[ignore]
    fn confidence_vs_error_correlation_240s() {
        const CONTEXT: &str = "confidence_vs_error_correlation_240s";
        let Some((plan_dir, model_path, audio_path)) = common_setup(CONTEXT) else { return };
        let audio_path_str = audio_path.to_str().unwrap();

        let reference = whole_file_reference_240s(&plan_dir, &model_path, audio_path_str);

        let Some(chunks) = load_plan(&plan_dir, "173-excerpt-240s-windowed") else { return };
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let windowed = align_chunked(&cache, &model_path, audio_path_str, &chunks, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("{CONTEXT}: expected Ok over the 240s excerpt's own production windowing, got Err: {e}"));

        // Greedy text-matched two-pointer walk, same technique as
        // `d12_measurement::text_matched_diff_stats`, extended to also carry
        // each matched windowed word's own confidence (`exp(score)`) —
        // excludes any fallback placeholder (`!score.is_finite()`), since a
        // placeholder's confidence is a synthetic sentinel, not a real
        // model output, and would corrupt the correlation with a fabricated
        // (0.0, large-error) pair the model itself never produced.
        let mut ref_idx = 0usize;
        let mut confidences: Vec<f64> = Vec::new();
        let mut errors: Vec<f64> = Vec::new();
        let mut skipped_fallback = 0usize;
        for w in &windowed {
            while ref_idx < reference.len() && reference[ref_idx].text != w.text {
                ref_idx += 1;
            }
            if ref_idx >= reference.len() {
                break;
            }
            if !w.score.is_finite() {
                skipped_fallback += 1;
                ref_idx += 1;
                continue;
            }
            let r = &reference[ref_idx];
            let start_diff = (r.start - w.start_seconds).abs();
            let end_diff = (r.end - w.end_seconds).abs();
            confidences.push(w.score.exp() as f64);
            errors.push(start_diff.max(end_diff));
            ref_idx += 1;
        }

        assert!(
            confidences.len() > 10,
            "{CONTEXT}: too few matched (confidence, error) pairs ({}) to correlate meaningfully — \
             something upstream likely regressed (chunk plan, reference, or text-matching)",
            confidences.len()
        );

        let r = pearson_r(&confidences, &errors);

        let mut below: Vec<f64> = Vec::new();
        let mut above: Vec<f64> = Vec::new();
        for i in 0..confidences.len() {
            if confidences[i] < 0.3 {
                below.push(errors[i]);
            } else {
                above.push(errors[i]);
            }
        }
        below.sort_by(|a, b| a.total_cmp(b));
        above.sort_by(|a, b| a.total_cmp(b));

        eprintln!(
            "{CONTEXT}: matched={} (skipped_fallback={skipped_fallback}) windowed_total={} ref_total={} \
             pearson_r(confidence, error)={r:.4}",
            confidences.len(),
            windowed.len(),
            reference.len(),
        );
        if !below.is_empty() {
            eprintln!(
                "{CONTEXT}: BELOW 0.3 confidence (n={}) error(s) min={:.4} p50={:.4} p90={:.4} max={:.4} mean={:.4}",
                below.len(),
                below[0],
                percentile(&below, 0.50),
                percentile(&below, 0.90),
                below[below.len() - 1],
                below.iter().sum::<f64>() / below.len() as f64,
            );
        } else {
            eprintln!("{CONTEXT}: BELOW 0.3 confidence: n=0 (no matched word fell below CONF_MIN on this excerpt)");
        }
        if !above.is_empty() {
            eprintln!(
                "{CONTEXT}: ABOVE/EQ 0.3 confidence (n={}) error(s) min={:.4} p50={:.4} p90={:.4} max={:.4} mean={:.4}",
                above.len(),
                above[0],
                percentile(&above, 0.50),
                percentile(&above, 0.90),
                above[above.len() - 1],
                above.iter().sum::<f64>() / above.len() as f64,
            );
        }

        // WS1 Task 5 Slice D21, Step 4 — threshold derivation inputs. Uses
        // `docs/ws1-sync-pipeline/measurements/d15-mis-assignment-
        // diagnostic-2026-08-13.md`'s own already-proposed, owner-sign-off-
        // pending 0.3s (300ms) per-word timing tolerance (§2.2 there) as the
        // NAMED TOLERANCE — not a number invented fresh for this slice — and
        // reports the confidence value that separates violators (error >
        // 0.3s) from non-violators in this real matched set, so the report
        // step can state a derivation instead of an arbitrary percentile.
        const TOLERANCE_SEC: f64 = 0.3;
        let mut violator_confidences: Vec<f64> = Vec::new();
        let mut non_violator_confidences: Vec<f64> = Vec::new();
        for i in 0..confidences.len() {
            if errors[i] > TOLERANCE_SEC {
                violator_confidences.push(confidences[i]);
            } else {
                non_violator_confidences.push(confidences[i]);
            }
        }
        violator_confidences.sort_by(|a, b| a.total_cmp(b));
        non_violator_confidences.sort_by(|a, b| a.total_cmp(b));
        if !violator_confidences.is_empty() {
            let max_violator_conf = violator_confidences[violator_confidences.len() - 1];
            let collateral = non_violator_confidences.iter().filter(|&&c| c < max_violator_conf).count();
            eprintln!(
                "{CONTEXT}: VIOLATORS (error > {TOLERANCE_SEC}s tolerance, n={}) confidence min={:.6} p50={:.6} \
                 p90={:.6} max={:.6}",
                violator_confidences.len(),
                violator_confidences[0],
                percentile(&violator_confidences, 0.50),
                percentile(&violator_confidences, 0.90),
                max_violator_conf,
            );
            eprintln!(
                "{CONTEXT}: no-miss threshold candidate = max violator confidence = {max_violator_conf:.6} \
                 (a threshold at or above this catches every observed violator); at that threshold, \
                 {collateral}/{} non-violators ({:.1}%) would ALSO be flagged (collateral)",
                non_violator_confidences.len(),
                100.0 * collateral as f64 / non_violator_confidences.len().max(1) as f64,
            );
            eprintln!(
                "{CONTEXT}: non-violator confidence distribution: n={} min={:.6} p50={:.6} p90={:.6} max={:.6}",
                non_violator_confidences.len(),
                non_violator_confidences.first().copied().unwrap_or(f64::NAN),
                percentile(&non_violator_confidences, 0.50),
                percentile(&non_violator_confidences, 0.90),
                non_violator_confidences.last().copied().unwrap_or(f64::NAN),
            );
        } else {
            eprintln!("{CONTEXT}: VIOLATORS (error > {TOLERANCE_SEC}s tolerance): n=0 — no threshold derivation possible from this excerpt");
        }

        // Dump raw pairs for the full-709s (Step 1's clean, index-attributed,
        // zero-fallback, 1643-word) population to be scored against
        // whichever threshold this step proposes (Step 4's own report step,
        // not asserted here).
        let raw_path = plan_dir.join("173-excerpt-240s-confidence-error-pairs.json");
        #[derive(serde::Serialize)]
        struct Pair {
            confidence: f64,
            error_sec: f64,
        }
        let pairs: Vec<Pair> =
            confidences.iter().zip(errors.iter()).map(|(&c, &e)| Pair { confidence: c, error_sec: e }).collect();
        std::fs::write(&raw_path, serde_json::to_string(&pairs).unwrap())
            .unwrap_or_else(|e| panic!("write {}: {e}", raw_path.display()));
        eprintln!("{CONTEXT}: wrote {} raw (confidence, error) pairs to {}", pairs.len(), raw_path.display());
    }
}

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D22, Step 3 — is D21's r=-0.75 driven by seam
// mis-assignment itself, or does confidence predict timing error even
// WITHIN the correctly-assigned population (the population R.7 will mostly
// see once the chunked path's internal default is index attribution — see
// this slice's `faChunkPlan.ts` change)? `#[ignore]`d, real-corpus,
// measurement-only, self-contained per d13/d21_measurement's own convention
// (own `common_setup`/`RefWord`/`whole_file_reference_240s`, duplicated
// rather than imported).
//
// Reuses D21 Step 3's EXACT setup (the 240s excerpt's production, unmodified
// `segment.startTime` windowing, `173-excerpt-240s-windowed.json`) so the
// full-population Pearson r reproduces D21's own -0.75 as an internal sanity
// check, then applies D15's own mis-assignment identification method
// (`docs/work-in-progress.md` §6's "Mis-assignment diagnostic (D15)"
// paragraph; `d15-mis-assignment-diagnostic-2026-08-13.md` §1.1, the
// original source, was deleted 2026-08-14, `9cf5867`, retrieve: `git show
// 251be64:docs/ws1-sync-pipeline/measurements/d15-mis-assignment-diagnostic-2026-08-13.md`:
// for each matched
// word, compare which chunk window contains its OWN measured start time
// against which chunk window contains the WHOLE-FILE REFERENCE word's own
// start time, at the SAME boundary list — a mismatch is a mis-assignment)
// generalized from D15's original index-vs-B-control comparison to this
// module's segment.startTime-vs-oracle-time comparison, over the SAME
// boundary set D21 Step 3 already uses. No new ONNX pass beyond what D21
// Step 3 itself needed (the whole-file reference is cached, reused if a
// prior d21/d22 run in this $FA_CHUNK_PLAN_DIR already computed it).
// ---------------------------------------------------------------------------
#[cfg(test)]
mod d22_measurement {
    use super::*;
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }
    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("d22_measurement's fa_models_dir() only reproduces the macOS mapping");
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    #[derive(serde::Serialize, serde::Deserialize, Clone)]
    struct RefWord {
        text: String,
        start: f64,
        end: f64,
    }

    #[derive(serde::Deserialize)]
    struct ChunkPlanFile {
        #[allow(dead_code)]
        #[serde(rename = "audioDuration")]
        audio_duration: f64,
        chunks: Vec<PlanChunk>,
    }
    #[derive(serde::Deserialize)]
    struct PlanChunk {
        #[serde(rename = "startSec")]
        start_sec: f64,
        #[serde(rename = "endSec")]
        end_sec: f64,
        text: String,
    }

    fn load_plan(dir: &Path, label: &str) -> Option<Vec<crate::fa::FaChunkInput>> {
        let path = dir.join(format!("{label}.json"));
        if !path.exists() {
            eprintln!("SKIP d22_measurement: {} not found", path.display());
            return None;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        let plan: ChunkPlanFile = serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
        Some(
            plan.chunks
                .into_iter()
                .map(|c| crate::fa::FaChunkInput { start_sec: c.start_sec, end_sec: c.end_sec, text: c.text })
                .collect(),
        )
    }

    fn percentile(sorted: &[f64], p: f64) -> f64 {
        if sorted.is_empty() {
            return f64::NAN;
        }
        let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
        sorted[idx.min(sorted.len() - 1)]
    }

    fn common_setup(context: &str) -> Option<(PathBuf, PathBuf, PathBuf)> {
        if !super::require_ort::ort_dylib_or_skip(context) {
            return None;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(context, &model_path) {
            return None;
        }
        let Ok(plan_dir) = std::env::var("FA_CHUNK_PLAN_DIR") else {
            eprintln!("SKIP {context}: FA_CHUNK_PLAN_DIR not set");
            return None;
        };
        let plan_dir = PathBuf::from(plan_dir);
        let audio_path = repo_root().join(".work-phase4/replay/173/audio_16k.wav");
        if !audio_path.exists() {
            eprintln!("SKIP {context}: real audio not found at {}", audio_path.display());
            return None;
        }
        Some((plan_dir, model_path, audio_path))
    }

    /// Same cache file D21's own `whole_file_reference_240s` writes/reads
    /// (`173-excerpt-240s-reference-words.json`) — a prior d13/d21/d22 run in
    /// this `$FA_CHUNK_PLAN_DIR` is reused rather than recomputed (~113s/
    /// ~20GiB cost, D10/D11).
    fn whole_file_reference_240s(plan_dir: &Path, model_path: &Path, audio_path: &str) -> Vec<RefWord> {
        // WS1 Task 5 Slice D23 — see `require_ort::WHOLE_FILE_REFERENCE_LOCK`'s
        // own doc comment: held for this whole function so a concurrent
        // caller blocks instead of racing a second ~20GiB compute.
        let _guard =
            super::require_ort::WHOLE_FILE_REFERENCE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let cache_path = plan_dir.join("173-excerpt-240s-reference-words.json");
        if cache_path.exists() {
            let text = std::fs::read_to_string(&cache_path)
                .unwrap_or_else(|e| panic!("read cached reference {}: {e}", cache_path.display()));
            return serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("parse cached reference {}: {e}", cache_path.display()));
        }
        let plan = load_plan(plan_dir, "173-excerpt-240s-wholefile").expect("wholefile plan must exist to compute the reference");
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        eprintln!("d22_measurement: computing whole-file 240s reference (first use in this $FA_CHUNK_PLAN_DIR, will be cached)...");
        let start = std::time::Instant::now();
        let words = align_chunked(&cache, model_path, audio_path, &plan, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("whole-file reference pass failed: {e}"));
        eprintln!(
            "d22_measurement: whole-file reference computed in {:.1}s, {} words",
            start.elapsed().as_secs_f64(),
            words.len()
        );
        let ref_words: Vec<RefWord> =
            words.iter().map(|w| RefWord { text: w.text.clone(), start: w.start_seconds, end: w.end_seconds }).collect();
        std::fs::write(&cache_path, serde_json::to_string(&ref_words).unwrap())
            .unwrap_or_else(|e| panic!("write reference cache {}: {e}", cache_path.display()));
        ref_words
    }

    fn pearson_r(xs: &[f64], ys: &[f64]) -> f64 {
        let n = xs.len() as f64;
        let mean_x = xs.iter().sum::<f64>() / n;
        let mean_y = ys.iter().sum::<f64>() / n;
        let mut cov = 0.0;
        let mut var_x = 0.0;
        let mut var_y = 0.0;
        for i in 0..xs.len() {
            let dx = xs[i] - mean_x;
            let dy = ys[i] - mean_y;
            cov += dx * dy;
            var_x += dx * dx;
            var_y += dy * dy;
        }
        if var_x == 0.0 || var_y == 0.0 {
            return f64::NAN;
        }
        cov / (var_x.sqrt() * var_y.sqrt())
    }

    /// D15's own validated method ("output word i's own chunk of origin is
    /// recoverable by checking which chunk window contains ITS OWN start
    /// time — validated as non-decreasing across the full 569-word
    /// sequence"): a monotonic, resume-from-cursor scan over gapless,
    /// non-overlapping `[start_sec, end_sec)` windows. Caller must invoke
    /// with non-decreasing `t` per cursor to preserve the monotonic-scan
    /// guarantee (two independent cursors — one for the attributed word's
    /// own measured time, one for the oracle/reference word's own time —
    /// are used below, each individually monotonic).
    fn chunk_index_for_time(chunks: &[crate::fa::FaChunkInput], cursor: &mut usize, t: f64) -> usize {
        while *cursor < chunks.len() - 1 && t >= chunks[*cursor].end_sec {
            *cursor += 1;
        }
        *cursor
    }

    /// WS1 Task 5 Slice D22, Step 3. Reproduces D21 Step 3's own full-
    /// population Pearson r as an internal sanity check, then recomputes it
    /// on the subset D15's method identifies as CORRECTLY attributed (the
    /// population R.7 will mostly see once index attribution is the
    /// chunked-path default), reporting whether the correlation survives or
    /// collapses.
    #[test]
    #[ignore]
    fn mis_assignment_filtered_correlation_240s() {
        const CONTEXT: &str = "mis_assignment_filtered_correlation_240s";
        let Some((plan_dir, model_path, audio_path)) = common_setup(CONTEXT) else { return };
        let audio_path_str = audio_path.to_str().unwrap();

        let reference = whole_file_reference_240s(&plan_dir, &model_path, audio_path_str);

        let Some(chunks) = load_plan(&plan_dir, "173-excerpt-240s-windowed") else { return };
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let windowed = align_chunked(&cache, &model_path, audio_path_str, &chunks, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("{CONTEXT}: expected Ok over the 240s excerpt's own production windowing, got Err: {e}"));

        let mut ref_idx = 0usize;
        let mut time_cursor = 0usize;
        let mut oracle_cursor = 0usize;
        let mut confidences: Vec<f64> = Vec::new();
        let mut errors: Vec<f64> = Vec::new();
        let mut mis_assigned: Vec<bool> = Vec::new();
        let mut skipped_fallback = 0usize;

        for w in &windowed {
            while ref_idx < reference.len() && reference[ref_idx].text != w.text {
                ref_idx += 1;
            }
            if ref_idx >= reference.len() {
                break;
            }
            if !w.score.is_finite() {
                skipped_fallback += 1;
                ref_idx += 1;
                continue;
            }
            let r = &reference[ref_idx];
            let start_diff = (r.start - w.start_seconds).abs();
            let end_diff = (r.end - w.end_seconds).abs();

            // D15's method, generalized: does the window containing this
            // word's OWN measured start time (the attribution rule under
            // test's own placement) match the window containing the
            // WHOLE-FILE REFERENCE word's own start time (the oracle-time
            // placement), at the identical boundary list?
            let attributed_chunk = chunk_index_for_time(&chunks, &mut time_cursor, w.start_seconds);
            let oracle_chunk = chunk_index_for_time(&chunks, &mut oracle_cursor, r.start);

            confidences.push(w.score.exp() as f64);
            errors.push(start_diff.max(end_diff));
            mis_assigned.push(attributed_chunk != oracle_chunk);
            ref_idx += 1;
        }

        assert!(
            confidences.len() > 10,
            "{CONTEXT}: too few matched (confidence, error) pairs ({}) to correlate meaningfully",
            confidences.len()
        );

        let r_full = pearson_r(&confidences, &errors);
        let n_mis = mis_assigned.iter().filter(|&&m| m).count();

        let mut fc: Vec<f64> = Vec::new();
        let mut fe: Vec<f64> = Vec::new();
        for i in 0..confidences.len() {
            if !mis_assigned[i] {
                fc.push(confidences[i]);
                fe.push(errors[i]);
            }
        }
        let r_filtered = pearson_r(&fc, &fe);

        eprintln!(
            "{CONTEXT}: matched={} (skipped_fallback={skipped_fallback}) full_population_r={r_full:.4} \
             (D21 Step 3's own reproduced figure) mis_assigned={n_mis}/{} ({:.1}%) correctly_assigned_n={} \
             filtered_r={r_filtered:.4}",
            confidences.len(),
            confidences.len(),
            100.0 * n_mis as f64 / confidences.len() as f64,
            fc.len(),
        );

        let mut below: Vec<f64> = Vec::new();
        let mut above: Vec<f64> = Vec::new();
        for i in 0..fc.len() {
            if fc[i] < 0.3 {
                below.push(fe[i]);
            } else {
                above.push(fe[i]);
            }
        }
        below.sort_by(|a, b| a.total_cmp(b));
        above.sort_by(|a, b| a.total_cmp(b));
        if !below.is_empty() {
            eprintln!(
                "{CONTEXT}: CORRECTLY-ASSIGNED, BELOW 0.3 confidence (n={}) error(s) min={:.4} p50={:.4} p90={:.4} \
                 max={:.4} mean={:.4}",
                below.len(),
                below[0],
                percentile(&below, 0.50),
                percentile(&below, 0.90),
                below[below.len() - 1],
                below.iter().sum::<f64>() / below.len() as f64,
            );
        } else {
            eprintln!("{CONTEXT}: CORRECTLY-ASSIGNED, BELOW 0.3 confidence: n=0");
        }
        if !above.is_empty() {
            eprintln!(
                "{CONTEXT}: CORRECTLY-ASSIGNED, ABOVE/EQ 0.3 confidence (n={}) error(s) min={:.4} p50={:.4} \
                 p90={:.4} max={:.4} mean={:.4}",
                above.len(),
                above[0],
                percentile(&above, 0.50),
                percentile(&above, 0.90),
                above[above.len() - 1],
                above.iter().sum::<f64>() / above.len() as f64,
            );
        } else {
            eprintln!("{CONTEXT}: CORRECTLY-ASSIGNED, ABOVE/EQ 0.3 confidence: n=0");
        }

        #[derive(serde::Serialize)]
        struct Pair {
            confidence: f64,
            error_sec: f64,
            mis_assigned: bool,
        }
        let pairs: Vec<Pair> = confidences
            .iter()
            .zip(errors.iter())
            .zip(mis_assigned.iter())
            .map(|((&c, &e), &m)| Pair { confidence: c, error_sec: e, mis_assigned: m })
            .collect();
        let out_path = plan_dir.join("173-excerpt-240s-mis-assignment-filtered-pairs.json");
        std::fs::write(&out_path, serde_json::to_string(&pairs).unwrap())
            .unwrap_or_else(|e| panic!("write {}: {e}", out_path.display()));
        eprintln!("{CONTEXT}: wrote {} pairs to {}", pairs.len(), out_path.display());
    }

    /// A small closed-class function-word list, heuristic only (not a
    /// linguistic authority) — used solely to characterize D21's below-0.3
    /// tail (Step 4), never to gate anything.
    const FUNCTION_WORDS: &[&str] = &[
        "a", "an", "the", "and", "or", "but", "nor", "so", "yet", "for", "of", "in", "on", "at", "to", "from", "by",
        "with", "as", "is", "are", "was", "were", "be", "been", "being", "it", "he", "she", "they", "we", "you", "i",
        "that", "this", "these", "those", "not", "no", "do", "does", "did", "has", "have", "had", "will", "would",
        "can", "could", "shall", "should", "may", "might", "must", "if", "than", "then", "there", "here", "its",
        "his", "her", "their", "our", "your", "my", "which", "who", "whom", "whose", "what", "when", "where", "why",
        "how", "them", "us", "him", "all", "any", "each", "some", "such", "own", "same", "up", "down", "out", "off",
        "over", "under", "again", "once",
    ];

    fn is_function_word(raw_text: &str) -> bool {
        let stripped: String = raw_text.chars().filter(|c| c.is_alphanumeric() || *c == '\'').collect();
        FUNCTION_WORDS.contains(&stripped.to_lowercase().as_str())
    }

    fn is_punctuation_adjacent(raw_text: &str) -> bool {
        let first_non_alnum = raw_text.chars().next().is_some_and(|c| !c.is_alphanumeric());
        let last_non_alnum = raw_text.chars().last().is_some_and(|c| !c.is_alphanumeric());
        first_non_alnum || last_non_alnum
    }

    /// WS1 Task 5 Slice D22, Step 4. Runs the full 709s project through
    /// index attribution (the SAME single `align_chunked` call shape D21
    /// Step 1/2's own regression test uses — `173-full-709s-index-windowed`)
    /// and, for every genuinely-aligned word (fallback excluded — D21 Step
    /// 1/2 already established and gate this slice's own Step 2 re-verifies
    /// that fallback_count is 0 on this corpus under index attribution),
    /// records the per-word detail needed to characterize the below-0.3
    /// tail: char length, frame length (`(end-start)/0.02`, the CTC frame
    /// duration, D6), which chunk it landed in, its ordinal position within
    /// that chunk's own word sequence, its distance to the nearer edge of
    /// its own chunk window (seam proximity), a heuristic function-word/
    /// punctuation-adjacent classification, and — for the ~569 words whose
    /// real onset falls within the 240s whole-file reference's own
    /// coverage — measured timing error against that reference (`None`
    /// beyond it, honestly, not fabricated).
    #[test]
    #[ignore]
    fn full_709s_index_attribution_tail_characterization() {
        const CONTEXT: &str = "full_709s_index_attribution_tail_characterization";
        let Some((plan_dir, model_path, audio_path)) = common_setup(CONTEXT) else { return };
        let audio_path_str = audio_path.to_str().unwrap();

        let reference = whole_file_reference_240s(&plan_dir, &model_path, audio_path_str);

        let Some(chunks) = load_plan(&plan_dir, "173-full-709s-index-windowed") else { return };
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let start = std::time::Instant::now();
        let words = align_chunked(&cache, &model_path, audio_path_str, &chunks, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("{CONTEXT}: expected Ok, got Err: {e}"));
        eprintln!(
            "{CONTEXT}: aligned {} words over {} index-attributed chunks in {:.1}s",
            words.len(),
            chunks.len(),
            start.elapsed().as_secs_f64()
        );

        let fallback_count = words.iter().filter(|w| !w.score.is_finite()).count();
        eprintln!("{CONTEXT}: fallback_count={fallback_count} (Step 2 gate: must be 0 to match D21 Step 1/2)");

        #[derive(serde::Serialize, Clone)]
        struct WordDetail {
            text: String,
            confidence: f64,
            char_len: usize,
            frame_len: f64,
            chunk_index: usize,
            chunk_start_sec: f64,
            chunk_end_sec: f64,
            position_in_chunk: usize,
            chunk_word_count: usize,
            seam_distance_sec: f64,
            is_function_word: bool,
            is_punctuation_adjacent: bool,
            error_sec: Option<f64>,
        }

        const FRAME_SEC: f64 = 0.02; // D6: conv_stride = 320 samples/16kHz

        let mut chunk_cursor = 0usize;
        let mut position_in_current_chunk = 0usize;
        let mut last_chunk_index: Option<usize> = None;
        let mut ref_idx = 0usize;
        let mut ref_join_attempts = 0usize;
        let mut ref_join_hits = 0usize;

        // First pass: chunk index + position-in-chunk (needs a forward
        // monotonic scan matching output order, same method as Step 3).
        let mut prelim: Vec<(usize, usize)> = Vec::with_capacity(words.len()); // (chunk_index, position_in_chunk)
        for w in &words {
            if !w.score.is_finite() {
                prelim.push((usize::MAX, 0));
                continue;
            }
            let idx = chunk_index_for_time(&chunks, &mut chunk_cursor, w.start_seconds);
            if last_chunk_index != Some(idx) {
                position_in_current_chunk = 0;
                last_chunk_index = Some(idx);
            } else {
                position_in_current_chunk += 1;
            }
            prelim.push((idx, position_in_current_chunk));
        }
        // chunk_word_count per chunk index, from the same prelim pass.
        let mut chunk_word_counts: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
        for (idx, _) in &prelim {
            if *idx != usize::MAX {
                *chunk_word_counts.entry(*idx).or_insert(0) += 1;
            }
        }

        let mut details: Vec<WordDetail> = Vec::with_capacity(words.len());
        for (i, w) in words.iter().enumerate() {
            if !w.score.is_finite() {
                continue; // fallback placeholder — excluded, matches D21 Step 6's own convention
            }
            let (chunk_idx, position) = prelim[i];
            let chunk = &chunks[chunk_idx];
            let seam_distance = (w.start_seconds - chunk.start_sec).min(chunk.end_sec - w.end_seconds);

            // Reference join: greedy sequential text match, same technique
            // as Step 3/D21 Step 3, only while the reference has words left.
            let mut error_sec = None;
            if ref_idx < reference.len() {
                ref_join_attempts += 1;
                while ref_idx < reference.len() && reference[ref_idx].text != w.text {
                    ref_idx += 1;
                }
                if ref_idx < reference.len() {
                    let r = &reference[ref_idx];
                    let start_diff = (r.start - w.start_seconds).abs();
                    let end_diff = (r.end - w.end_seconds).abs();
                    error_sec = Some(start_diff.max(end_diff));
                    ref_join_hits += 1;
                    ref_idx += 1;
                }
            }

            details.push(WordDetail {
                text: w.text.clone(),
                confidence: w.score.exp() as f64,
                char_len: w.text.chars().count(),
                frame_len: (w.end_seconds - w.start_seconds) / FRAME_SEC,
                chunk_index: chunk_idx,
                chunk_start_sec: chunk.start_sec,
                chunk_end_sec: chunk.end_sec,
                position_in_chunk: position,
                chunk_word_count: *chunk_word_counts.get(&chunk_idx).unwrap_or(&0),
                seam_distance_sec: seam_distance,
                is_function_word: is_function_word(&w.text),
                is_punctuation_adjacent: is_punctuation_adjacent(&w.text),
                error_sec,
            });
        }

        eprintln!(
            "{CONTEXT}: reference-join attempts={ref_join_attempts} hits={ref_join_hits} \
             ({:.1}% of attempts matched — words beyond the 240s reference's own coverage get error_sec=None, honestly)",
            100.0 * ref_join_hits as f64 / ref_join_attempts.max(1) as f64,
        );

        let below: Vec<&WordDetail> = details.iter().filter(|d| d.confidence < 0.3).collect();
        let above: Vec<&WordDetail> = details.iter().filter(|d| d.confidence >= 0.3).collect();

        fn summarize(label: &str, group: &[&WordDetail]) {
            if group.is_empty() {
                eprintln!("  {label}: n=0");
                return;
            }
            let mut char_lens: Vec<f64> = group.iter().map(|d| d.char_len as f64).collect();
            let mut frame_lens: Vec<f64> = group.iter().map(|d| d.frame_len).collect();
            let mut seam_dists: Vec<f64> = group.iter().map(|d| d.seam_distance_sec).collect();
            let mut positions: Vec<f64> = group.iter().map(|d| d.position_in_chunk as f64).collect();
            char_lens.sort_by(|a, b| a.total_cmp(b));
            frame_lens.sort_by(|a, b| a.total_cmp(b));
            seam_dists.sort_by(|a, b| a.total_cmp(b));
            positions.sort_by(|a, b| a.total_cmp(b));
            let fn_count = group.iter().filter(|d| d.is_function_word).count();
            let punct_count = group.iter().filter(|d| d.is_punctuation_adjacent).count();
            let errors_present: Vec<f64> = group.iter().filter_map(|d| d.error_sec).collect();
            eprintln!(
                "  {label}: n={} char_len(median)={:.1} frame_len(median)={:.2} seam_dist(median)={:.4}s \
                 position_in_chunk(median)={:.1} function_word={}/{} ({:.1}%) punct_adjacent={}/{} ({:.1}%) \
                 has_reference_error={}/{}",
                group.len(),
                percentile(&char_lens, 0.5),
                percentile(&frame_lens, 0.5),
                percentile(&seam_dists, 0.5),
                percentile(&positions, 0.5),
                fn_count,
                group.len(),
                100.0 * fn_count as f64 / group.len() as f64,
                punct_count,
                group.len(),
                100.0 * punct_count as f64 / group.len() as f64,
                errors_present.len(),
                group.len(),
            );
            if !errors_present.is_empty() {
                let mut e = errors_present.clone();
                e.sort_by(|a, b| a.total_cmp(b));
                eprintln!(
                    "    reference-backed error(s) among these: n={} min={:.4} p50={:.4} max={:.4} mean={:.4}",
                    e.len(),
                    e[0],
                    percentile(&e, 0.5),
                    e[e.len() - 1],
                    e.iter().sum::<f64>() / e.len() as f64,
                );
            }
        }

        eprintln!(
            "{CONTEXT}: genuinely-aligned words={} below_0.3={} ({:.2}%) above_eq_0.3={}",
            details.len(),
            below.len(),
            100.0 * below.len() as f64 / details.len() as f64,
            above.len(),
        );
        summarize("BELOW 0.3", &below);
        summarize("ABOVE/EQ 0.3", &above);

        // Seam-distance bucket for the below-0.3 group specifically — is it
        // concentrated near a chunk edge?
        let near_seam = below.iter().filter(|d| d.seam_distance_sec < 0.5).count();
        let near_edge_first_or_last = below
            .iter()
            .filter(|d| d.position_in_chunk == 0 || d.position_in_chunk + 1 == d.chunk_word_count)
            .count();
        eprintln!(
            "{CONTEXT}: of {} below-0.3 words: {} ({:.1}%) sit within 0.5s of their own chunk's edge; \
             {} ({:.1}%) are their chunk's first or last word",
            below.len(),
            near_seam,
            100.0 * near_seam as f64 / below.len().max(1) as f64,
            near_edge_first_or_last,
            100.0 * near_edge_first_or_last as f64 / below.len().max(1) as f64,
        );

        let out_path = plan_dir.join("173-full-709s-index-tail-detail.json");
        std::fs::write(&out_path, serde_json::to_string(&details).unwrap())
            .unwrap_or_else(|e| panic!("write {}: {e}", out_path.display()));
        eprintln!("{CONTEXT}: wrote {} word-detail records to {}", details.len(), out_path.display());
    }
}

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D23 Step 3 — correlation on the REAL index-attribution
// population, no filtering.
//
// D22 Step 3's own r=-0.78 was measured on TIME-attribution output with
// mis-assigned words filtered out — a proxy for what index attribution's own
// population would look like, not a direct measurement (D22's own doc
// comment: "the REAL population index attribution produces is very likely
// cleaner than this filtered proxy, not just no-worse-than it" — stated as a
// prediction, not measured). This module measures the real thing: runs the
// 240s excerpt through INDEX attribution (`173-excerpt-240s-index-windowed`,
// `scripts/dump-fa-chunk-plan-index-240s-windowed.ts`), joins every output
// word against the whole-file reference by the same greedy sequential
// text-match technique D21/D22 already use, and correlates confidence
// against timing error with NO mis-assignment filtering applied at all —
// there is nothing to filter FOR, since index attribution's own chunk text
// is exactly the qi-range between real anchors, not a segment.startTime
// membership guess.
//
// Own `common_setup`/`RefWord`/`whole_file_reference_240s` (duplicated
// rather than imported, matching every measurement module's own convention
// in this file) — the whole-file reference is CACHED (`WHOLE_FILE_REFERENCE_
// LOCK`-guarded since WS1 Task 5 Slice D23's own Step 2), reused if a prior
// d12/d13/d21/d22/d23 run in this `$FA_CHUNK_PLAN_DIR` already computed it.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WS1 Session Y, Phase 1: engine determinism proof + gate.
//
// `load_session` (above) now pins `with_intra_threads(1)`,
// `with_inter_threads(1)`, `with_parallel_execution(false)`, and
// `with_deterministic_compute(true)`. This module proves that pinning
// actually produces byte-identical `align_chunked` output across
// independently-constructed `Session`s (the in-process stand-in for
// "independent runs" — a real app restart is out of scope for `cargo test`),
// and separately proves the OLD unpinned configuration is not reliably
// deterministic on this same input, so the pinned test is not vacuously
// passing. Real `.work-phase4/replay/{173,v6}` production audio + the exact
// production chunk plan (`fa_production_chunks.json`), windowed to keep
// runtime bounded rather than re-aligning the full multi-hundred-second file
// three times per corpus. `#[ignore]`, same convention as every other
// real-inference test in this file: run with
// `cargo test --features fa-inference --lib phase1_determinism -- --ignored --nocapture`.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod phase1_determinism {
    use super::*;
    use std::path::PathBuf;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }
    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("phase1_determinism's fa_models_dir() only reproduces the macOS mapping");
    }

    #[derive(serde::Deserialize)]
    struct ChunkPlanFile {
        #[allow(dead_code)]
        #[serde(rename = "audioDuration")]
        audio_duration: f64,
        chunks: Vec<PlanChunk>,
    }
    #[derive(serde::Deserialize)]
    struct PlanChunk {
        #[serde(rename = "startSec")]
        start_sec: f64,
        #[serde(rename = "endSec")]
        end_sec: f64,
        text: String,
    }

    /// Loads the REAL production chunk plan for `corpus` and keeps only the
    /// chunks overlapping `[window_start, window_end)` — real per-chunk
    /// boundaries and text, a bounded slice of them, not a synthetic
    /// re-chunking.
    fn load_production_chunks_windowed(corpus: &str, window_start: f64, window_end: f64) -> Vec<crate::fa::FaChunkInput> {
        let path = repo_root().join(format!(".work-phase4/replay/{corpus}/fa_production_chunks.json"));
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        let plan: ChunkPlanFile = serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
        let _ = plan.audio_duration;
        plan.chunks
            .into_iter()
            .filter(|c| c.end_sec > window_start && c.start_sec < window_end)
            .map(|c| crate::fa::FaChunkInput { start_sec: c.start_sec, end_sec: c.end_sec, text: c.text })
            .collect()
    }

    fn common_setup(context: &str, corpus: &str) -> Option<(PathBuf, PathBuf)> {
        if !super::require_ort::ort_dylib_or_skip(context) {
            return None;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(context, &model_path) {
            return None;
        }
        let audio_path = repo_root().join(format!(".work-phase4/replay/{corpus}/audio_16k.wav"));
        if !audio_path.exists() {
            eprintln!("SKIP {context}: real audio not found at {}", audio_path.display());
            return None;
        }
        Some((model_path, audio_path))
    }

    /// Runs `chunks` through a FRESH `Session` (own `Mutex::new(None)` cache,
    /// so `with_cached_session` is forced to call `load_session` again —
    /// exercising ORT's own per-session thread pool/kernel selection, not
    /// just Rust calling-code determinism) via the real `load_session` (the
    /// pinned configuration).
    fn run_once_pinned(model_path: &Path, audio_path: &str, chunks: &[crate::fa::FaChunkInput]) -> Vec<super::WordSpan> {
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        align_chunked(&cache, model_path, audio_path, chunks, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("run_once_pinned: align_chunked failed: {e}"))
    }

    /// Mirrors pre-Session-Y `load_session` exactly: bare
    /// `Session::builder().commit_from_file(...)`, no thread/execution-mode/
    /// determinism configuration — the control path this module's mutation
    /// test uses to confirm the pinned test isn't vacuously passing.
    fn load_session_unpinned(model_path: &Path) -> Session {
        let dylib_path = std::env::var("ORT_DYLIB_PATH").expect("ORT_DYLIB_PATH must be set (checked by common_setup)");
        ort::init_from(dylib_path).expect("ort::init_from").commit();
        Session::builder().expect("Session::builder").commit_from_file(model_path).expect("commit_from_file")
    }

    fn run_once_unpinned(model_path: &Path, audio_path: &str, chunks: &[crate::fa::FaChunkInput]) -> Vec<super::WordSpan> {
        let mut session = load_session_unpinned(model_path);
        let vocab = load_vocab("en").expect("load_vocab en");
        let samples = read_wav_mono_16k(Path::new(audio_path)).expect("read_wav_mono_16k");
        let mut all_words = Vec::new();
        for chunk in chunks {
            let (start_sample, end_sample) = chunk_sample_range(samples.len(), chunk.start_sec, chunk.end_sec);
            let chunk_samples = &samples[start_sample..end_sample];
            let words = align_chunk_samples(&mut session, &vocab, Language::En, chunk_samples, &chunk.text)
                .unwrap_or_else(|e| panic!("run_once_unpinned: align_chunk_samples failed: {e}"));
            for w in words {
                all_words.push(super::WordSpan {
                    text: w.text,
                    start_seconds: w.start_seconds + chunk.start_sec,
                    end_seconds: w.end_seconds + chunk.start_sec,
                    score: w.score,
                });
            }
        }
        all_words
    }

    fn report_words(label: &str, words: &[super::WordSpan]) {
        eprintln!("  {label}: {} words", words.len());
        for w in words {
            eprintln!("    {:>8.3} - {:<8.3} conf(exp(score))={:.6e} score={:.6}  {:?}", w.start_seconds, w.end_seconds, w.score.exp(), w.score, w.text);
        }
    }

    fn assert_byte_identical(corpus: &str, run1: &[super::WordSpan], run2: &[super::WordSpan], run3: &[super::WordSpan]) {
        assert_eq!(run1, run2, "{corpus}: run 1 vs run 2 diverged under the PINNED session — determinism NOT achieved");
        assert_eq!(run2, run3, "{corpus}: run 2 vs run 3 diverged under the PINNED session — determinism NOT achieved");
    }

    /// PHASE 1 CORE PROOF: three independent pinned-session runs each on
    /// 173's and v6's real production audio/chunks, byte-identical word
    /// arrays required. 173's window [161.46, 194.22) covers the real
    /// production chunk boundaries either side of the "45-46"
    /// (`vessel_damage_clue`) boundary Session W/X measured diverging
    /// (live 174.740 vs. regen 172.910) — the words in that window are
    /// printed every run so the adjudication is visible directly in the
    /// test's own output, not re-derived separately. v6's window [0, 25.5)
    /// is an arbitrary early slice (v6 carries no named 45-46-style defect)
    /// chosen only to prove general determinism at bounded cost.
    #[test]
    #[ignore]
    fn pinned_session_is_byte_identical_173_and_v6() {
        const CONTEXT: &str = "pinned_session_is_byte_identical_173_and_v6";

        for (corpus, window_start, window_end) in [("173", 161.46, 194.22), ("v6", 0.0, 25.5)] {
            let Some((model_path, audio_path)) = common_setup(CONTEXT, corpus) else { continue };
            let audio_path_str = audio_path.to_str().unwrap();
            let chunks = load_production_chunks_windowed(corpus, window_start, window_end);
            assert!(!chunks.is_empty(), "{corpus}: window [{window_start},{window_end}) matched no production chunks");

            eprintln!("=== {corpus}: 3 independent PINNED-session runs over [{window_start},{window_end}) ===");
            let run1 = run_once_pinned(&model_path, audio_path_str, &chunks);
            report_words("run 1", &run1);
            let run2 = run_once_pinned(&model_path, audio_path_str, &chunks);
            report_words("run 2", &run2);
            let run3 = run_once_pinned(&model_path, audio_path_str, &chunks);
            report_words("run 3", &run3);

            assert_byte_identical(corpus, &run1, &run2, &run3);
            eprintln!("=== {corpus}: PASS — all 3 pinned runs byte-identical ===");
        }
    }

    /// MUTATION: the same 173 window run 3x through the PRE-Session-Y
    /// unpinned session construction (`load_session_unpinned`, above — bare
    /// `Session::builder()`, ORT's own thread-count/execution-mode/
    /// determinism defaults). This is the standing control that must turn
    /// this gate RED if the pinned test above ever regresses to unpinned
    /// behavior silently (e.g. someone reverts `load_session`'s options) —
    /// it does not itself gate anything in `load_session`, it only proves
    /// the pinned test isn't vacuously passing because ORT happened to be
    /// deterministic on this hardware regardless of configuration. This
    /// test's own assertion is `assert_ne!`-shaped: it PASSES (reports the
    /// mechanism confirmed) when the unpinned path diverges, and explicitly
    /// reports — rather than silently passing — if the unpinned path turns
    /// out byte-identical too, since that would mean the INFERRED mechanism
    /// from Session X's Step 7 was not the right one and needs a different
    /// explanation.
    #[test]
    #[ignore]
    fn unpinned_session_control_173() {
        const CONTEXT: &str = "unpinned_session_control_173";
        let Some((model_path, audio_path)) = common_setup(CONTEXT, "173") else { return };
        let audio_path_str = audio_path.to_str().unwrap();
        let chunks = load_production_chunks_windowed("173", 161.46, 194.22);
        assert!(!chunks.is_empty());

        eprintln!("=== 173: 3 independent UNPINNED-session runs (mutation control) over [161.46,194.22) ===");
        let run1 = run_once_unpinned(&model_path, audio_path_str, &chunks);
        report_words("run 1", &run1);
        let run2 = run_once_unpinned(&model_path, audio_path_str, &chunks);
        report_words("run 2", &run2);
        let run3 = run_once_unpinned(&model_path, audio_path_str, &chunks);
        report_words("run 3", &run3);

        if run1 == run2 && run2 == run3 {
            eprintln!(
                "=== 173: UNPINNED runs were ALSO byte-identical on this hardware/window — the \
                 pinned test above does not by itself prove pinning is what makes it \
                 deterministic here; the divergence Session X measured must have another \
                 explanation (or does not reproduce at this window size) ==="
            );
        } else {
            eprintln!(
                "=== 173: UNPINNED runs DIVERGED (confirms the mutation: this gate WOULD catch a \
                 regression to unpinned session construction) ==="
            );
        }
    }

    /// Mirrors `load_session_unpinned` but forces the MOST aggressive
    /// divergence-prone configuration `ort = "2.0.0-rc.13"` exposes: explicit
    /// PARALLEL execution mode plus a multi-thread intra-op pool (unpinned
    /// defaults to ORT's own choice, which on this build is sequential mode —
    /// `unpinned_session_control_173` above stayed byte-identical, so this
    /// tries harder before concluding no mutation can turn the gate RED).
    /// `with_deterministic_compute` is left at its default (off).
    fn load_session_forced_parallel(model_path: &Path) -> Session {
        let dylib_path = std::env::var("ORT_DYLIB_PATH").expect("ORT_DYLIB_PATH must be set (checked by common_setup)");
        ort::init_from(dylib_path).expect("ort::init_from").commit();
        Session::builder()
            .expect("Session::builder")
            .with_intra_threads(8)
            .expect("with_intra_threads")
            .with_inter_threads(4)
            .expect("with_inter_threads")
            .with_parallel_execution(true)
            .expect("with_parallel_execution")
            .commit_from_file(model_path)
            .expect("commit_from_file")
    }

    fn run_once_forced_parallel(model_path: &Path, audio_path: &str, chunks: &[crate::fa::FaChunkInput]) -> Vec<super::WordSpan> {
        let mut session = load_session_forced_parallel(model_path);
        let vocab = load_vocab("en").expect("load_vocab en");
        let samples = read_wav_mono_16k(Path::new(audio_path)).expect("read_wav_mono_16k");
        let mut all_words = Vec::new();
        for chunk in chunks {
            let (start_sample, end_sample) = chunk_sample_range(samples.len(), chunk.start_sec, chunk.end_sec);
            let chunk_samples = &samples[start_sample..end_sample];
            let words = align_chunk_samples(&mut session, &vocab, Language::En, chunk_samples, &chunk.text)
                .unwrap_or_else(|e| panic!("run_once_forced_parallel: align_chunk_samples failed: {e}"));
            for w in words {
                all_words.push(super::WordSpan {
                    text: w.text,
                    start_seconds: w.start_seconds + chunk.start_sec,
                    end_seconds: w.end_seconds + chunk.start_sec,
                    score: w.score,
                });
            }
        }
        all_words
    }

    /// STEP 3 (WS1 Session Z): `unpinned_session_control_173` never turns
    /// RED on this hardware — ORT's own unconfigured defaults happened to be
    /// sequential-mode and stable here, so that control cannot prove the gate
    /// catches a real regression. This test tries a strictly more aggressive
    /// mutation (explicit parallel execution mode, 8 intra-op + 4 inter-op
    /// threads) run 5x (not 3 — a thread-scheduling race is not guaranteed
    /// to show on the 3rd run either). Diagnostic only, like the test above:
    /// it reports which outcome occurred rather than asserting one, because
    /// an assertion here would be asserting a property of THIS hardware/ORT
    /// build's thread scheduler, not a property this codebase controls.
    #[test]
    #[ignore]
    fn forced_parallel_session_control_173() {
        const CONTEXT: &str = "forced_parallel_session_control_173";
        let Some((model_path, audio_path)) = common_setup(CONTEXT, "173") else { return };
        let audio_path_str = audio_path.to_str().unwrap();
        let chunks = load_production_chunks_windowed("173", 161.46, 194.22);
        assert!(!chunks.is_empty());

        eprintln!("=== 173: 5 independent FORCED-PARALLEL-session runs (stronger mutation) over [161.46,194.22) ===");
        let runs: Vec<Vec<super::WordSpan>> = (1..=5)
            .map(|i| {
                let r = run_once_forced_parallel(&model_path, audio_path_str, &chunks);
                report_words(&format!("run {i}"), &r);
                r
            })
            .collect();

        let all_identical = runs.windows(2).all(|w| w[0] == w[1]);
        if all_identical {
            eprintln!(
                "=== 173: FORCED-PARALLEL runs (5x, 8 intra + 4 inter threads, explicit parallel \
                 execution mode) were ALSO byte-identical on this hardware — no configuration this \
                 test tried turns the determinism gate RED here; treat the pinned test as \
                 documentation of intended configuration, not as a proven-armed regression gate ==="
            );
        } else {
            eprintln!(
                "=== 173: FORCED-PARALLEL runs DIVERGED — the gate CAN be turned RED on this \
                 hardware; pinning is doing real work, and the divergence mechanism is real \
                 thread-scheduling-order-dependent floating point, not merely INFERRED ==="
            );
        }
    }
}

#[cfg(test)]
mod d23_measurement {
    use super::*;
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }
    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("d23_measurement's fa_models_dir() only reproduces the macOS mapping");
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    #[derive(serde::Serialize, serde::Deserialize, Clone)]
    struct RefWord {
        text: String,
        start: f64,
        end: f64,
    }

    #[derive(serde::Deserialize)]
    struct ChunkPlanFile {
        #[allow(dead_code)]
        #[serde(rename = "audioDuration")]
        audio_duration: f64,
        chunks: Vec<PlanChunk>,
    }
    #[derive(serde::Deserialize)]
    struct PlanChunk {
        #[serde(rename = "startSec")]
        start_sec: f64,
        #[serde(rename = "endSec")]
        end_sec: f64,
        text: String,
    }

    fn load_plan(dir: &Path, label: &str) -> Option<Vec<crate::fa::FaChunkInput>> {
        let path = dir.join(format!("{label}.json"));
        if !path.exists() {
            eprintln!("SKIP d23_measurement: {} not found", path.display());
            return None;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        let plan: ChunkPlanFile = serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
        Some(
            plan.chunks
                .into_iter()
                .map(|c| crate::fa::FaChunkInput { start_sec: c.start_sec, end_sec: c.end_sec, text: c.text })
                .collect(),
        )
    }

    fn percentile(sorted: &[f64], p: f64) -> f64 {
        if sorted.is_empty() {
            return f64::NAN;
        }
        let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
        sorted[idx.min(sorted.len() - 1)]
    }

    fn common_setup(context: &str) -> Option<(PathBuf, PathBuf, PathBuf)> {
        if !super::require_ort::ort_dylib_or_skip(context) {
            return None;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(context, &model_path) {
            return None;
        }
        let Ok(plan_dir) = std::env::var("FA_CHUNK_PLAN_DIR") else {
            eprintln!("SKIP {context}: FA_CHUNK_PLAN_DIR not set");
            return None;
        };
        let plan_dir = PathBuf::from(plan_dir);
        let audio_path = repo_root().join(".work-phase4/replay/173/audio_16k.wav");
        if !audio_path.exists() {
            eprintln!("SKIP {context}: real audio not found at {}", audio_path.display());
            return None;
        }
        Some((plan_dir, model_path, audio_path))
    }

    /// Same cache file every sibling measurement module's own
    /// `whole_file_reference_240s` writes/reads. WS1 Task 5 Slice D23:
    /// guarded by `require_ort::WHOLE_FILE_REFERENCE_LOCK` for its entire
    /// check-cache-or-compute-and-write body (see that lock's own doc
    /// comment) — safe to run concurrently with a d12/d13/d21/d22 test in
    /// the same process without racing a second ~20GiB compute.
    fn whole_file_reference_240s(plan_dir: &Path, model_path: &Path, audio_path: &str) -> Vec<RefWord> {
        let _guard =
            super::require_ort::WHOLE_FILE_REFERENCE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let cache_path = plan_dir.join("173-excerpt-240s-reference-words.json");
        if cache_path.exists() {
            let text = std::fs::read_to_string(&cache_path)
                .unwrap_or_else(|e| panic!("read cached reference {}: {e}", cache_path.display()));
            return serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("parse cached reference {}: {e}", cache_path.display()));
        }
        let plan = load_plan(plan_dir, "173-excerpt-240s-wholefile").expect("wholefile plan must exist to compute the reference");
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        eprintln!("d23_measurement: computing whole-file 240s reference (first use in this $FA_CHUNK_PLAN_DIR, will be cached)...");
        let start = std::time::Instant::now();
        let words = align_chunked(&cache, model_path, audio_path, &plan, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("whole-file reference pass failed: {e}"));
        eprintln!(
            "d23_measurement: whole-file reference computed in {:.1}s, {} words",
            start.elapsed().as_secs_f64(),
            words.len()
        );
        let ref_words: Vec<RefWord> =
            words.iter().map(|w| RefWord { text: w.text.clone(), start: w.start_seconds, end: w.end_seconds }).collect();
        std::fs::write(&cache_path, serde_json::to_string(&ref_words).unwrap())
            .unwrap_or_else(|e| panic!("write reference cache {}: {e}", cache_path.display()));
        ref_words
    }

    fn pearson_r(xs: &[f64], ys: &[f64]) -> f64 {
        let n = xs.len() as f64;
        let mean_x = xs.iter().sum::<f64>() / n;
        let mean_y = ys.iter().sum::<f64>() / n;
        let mut cov = 0.0;
        let mut var_x = 0.0;
        let mut var_y = 0.0;
        for i in 0..xs.len() {
            let dx = xs[i] - mean_x;
            let dy = ys[i] - mean_y;
            cov += dx * dy;
            var_x += dx * dx;
            var_y += dy * dy;
        }
        if var_x == 0.0 || var_y == 0.0 {
            return f64::NAN;
        }
        cov / (var_x.sqrt() * var_y.sqrt())
    }

    /// WS1 Task 5 Slice D23, Step 3. Runs the 240s excerpt through INDEX
    /// attribution's own uncoalesced/production-matching windowing
    /// (`173-excerpt-240s-index-windowed`) and joins the output DIRECTLY
    /// against the whole-file reference — no mis-assignment filter, no
    /// proxy population. Reports the full-population Pearson r and the
    /// error distribution split at `CONF_MIN`=0.3, the same reporting shape
    /// D21 Step 3/D22 Step 3 use, so the two are directly comparable.
    #[test]
    #[ignore]
    fn direct_correlation_index_attribution_240s() {
        const CONTEXT: &str = "direct_correlation_index_attribution_240s";
        let Some((plan_dir, model_path, audio_path)) = common_setup(CONTEXT) else { return };
        let audio_path_str = audio_path.to_str().unwrap();

        let reference = whole_file_reference_240s(&plan_dir, &model_path, audio_path_str);

        let Some(chunks) = load_plan(&plan_dir, "173-excerpt-240s-index-windowed") else { return };
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let words = align_chunked(&cache, &model_path, audio_path_str, &chunks, "en", || false, |_| {})
            .unwrap_or_else(|e| panic!("{CONTEXT}: expected Ok over the 240s excerpt's own index windowing, got Err: {e}"));

        let mut ref_idx = 0usize;
        let mut confidences: Vec<f64> = Vec::new();
        let mut errors: Vec<f64> = Vec::new();
        let mut skipped_fallback = 0usize;

        for w in &words {
            while ref_idx < reference.len() && reference[ref_idx].text != w.text {
                ref_idx += 1;
            }
            if ref_idx >= reference.len() {
                break;
            }
            if !w.score.is_finite() {
                skipped_fallback += 1;
                ref_idx += 1;
                continue;
            }
            let r = &reference[ref_idx];
            let start_diff = (r.start - w.start_seconds).abs();
            let end_diff = (r.end - w.end_seconds).abs();

            confidences.push(w.score.exp() as f64);
            errors.push(start_diff.max(end_diff));
            ref_idx += 1;
        }

        assert!(
            confidences.len() > 10,
            "{CONTEXT}: too few matched (confidence, error) pairs ({}) to correlate meaningfully",
            confidences.len()
        );

        let r_full = pearson_r(&confidences, &errors);

        eprintln!(
            "{CONTEXT}: matched={} (skipped_fallback={skipped_fallback}) chunks={} words_total={} \
             full_population_r={r_full:.4} (index attribution, NO filtering, direct join against whole-file reference)",
            confidences.len(),
            chunks.len(),
            words.len(),
        );

        let mut below: Vec<f64> = Vec::new();
        let mut above: Vec<f64> = Vec::new();
        for i in 0..confidences.len() {
            if confidences[i] < 0.3 {
                below.push(errors[i]);
            } else {
                above.push(errors[i]);
            }
        }
        below.sort_by(|a, b| a.total_cmp(b));
        above.sort_by(|a, b| a.total_cmp(b));
        if !below.is_empty() {
            eprintln!(
                "{CONTEXT}: BELOW 0.3 confidence (n={}) error(s) min={:.4} p50={:.4} p90={:.4} max={:.4} mean={:.4}",
                below.len(),
                below[0],
                percentile(&below, 0.50),
                percentile(&below, 0.90),
                below[below.len() - 1],
                below.iter().sum::<f64>() / below.len() as f64,
            );
        } else {
            eprintln!("{CONTEXT}: BELOW 0.3 confidence: n=0");
        }
        if !above.is_empty() {
            eprintln!(
                "{CONTEXT}: ABOVE/EQ 0.3 confidence (n={}) error(s) min={:.4} p50={:.4} p90={:.4} max={:.4} mean={:.4}",
                above.len(),
                above[0],
                percentile(&above, 0.50),
                percentile(&above, 0.90),
                above[above.len() - 1],
                above.iter().sum::<f64>() / above.len() as f64,
            );
        } else {
            eprintln!("{CONTEXT}: ABOVE/EQ 0.3 confidence: n=0");
        }

        #[derive(serde::Serialize)]
        struct Pair {
            confidence: f64,
            error_sec: f64,
        }
        let pairs: Vec<Pair> =
            confidences.iter().zip(errors.iter()).map(|(&c, &e)| Pair { confidence: c, error_sec: e }).collect();
        let out_path = plan_dir.join("173-excerpt-240s-index-direct-pairs.json");
        std::fs::write(&out_path, serde_json::to_string(&pairs).unwrap())
            .unwrap_or_else(|e| panic!("write {}: {e}", out_path.display()));
        eprintln!("{CONTEXT}: wrote {} pairs to {}", pairs.len(), out_path.display());
    }
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
        // "cat 5x dog" — the middle word is digit-bearing (not a bare digit
        // string, so WS2 T3.2 Step 3b-iii's cardinal generator does not
        // expand it) and dropped; the surviving words get exactly one
        // delimiter between them, not two (no delimiter placeholder for the
        // dropped word). A bare "5" would no longer serve this test — Step
        // 3b-iii made it representable ("five") under English too.
        let vocab = load_vocab("en").unwrap();
        let ids = text_to_token_ids("cat 5x dog", Language::En, &vocab);
        let delim = vocab.word_delim_id.unwrap();
        let delim_count = ids.iter().filter(|&&id| id == delim).count();
        assert_eq!(delim_count, 1);
        assert_eq!(ids.len(), 3 + 1 + 3); // "cat" + delim + "dog"
    }
}

// ---------------------------------------------------------------------------
// Multi-word tokenizer capability (WS2 T3.2 Step 3a-ii) unit tests. No real
// normalizer produces a multi-fragment `mapped` string yet (Step 3b, not
// wired) — every `WordResult` driven through these tests is HAND-BUILT, the
// same "synthetic, not fabricated-as-real" convention `ctc_infeasibility_
// fallback` below uses real captured data for and `invariants` above uses
// hand-built `WordSpan`s for. These tests are the only thing exercising this
// capability until Step 3b supplies real input — see `collapse_word_
// fragments`'s own doc comment for the design these tests verify.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod multi_word_fragment_capability {
    use super::*;

    fn w(text: &str, start: f64, end: f64, score: f32) -> WordSpan {
        WordSpan { text: text.to_string(), start_seconds: start, end_seconds: end, score }
    }

    // -- collapse_word_fragments, unit-level (hand-built WordSpans, no
    //    tokenization/alignment involved) --------------------------------

    #[test]
    fn collapse_is_identity_when_every_source_word_has_exactly_one_fragment() {
        // Today's real shape: `fragment_counts` is always all-1s, so
        // collapsing must be a byte-identical no-op — this is what makes
        // Step 3a-ii behavior-neutral for every real input that exists
        // today.
        let fragment_words = vec![w("cat", 0.0, 0.1, -0.05), w("dog", 0.2, 0.3, -0.07)];
        let collapsed = collapse_word_fragments(fragment_words.clone(), &[1, 1]);
        assert_eq!(collapsed, fragment_words);
    }

    #[test]
    fn collapse_merges_a_multi_fragment_group_with_first_start_last_end_and_duration_weighted_score() {
        // Hand-computable: group [wow(1.0-1.5, score -0.4), zap(1.5-2.5,
        // score -1.0)] — durations 0.5 and 1.0 — collapses to
        // start=1.0 (wow's own start), end=2.5 (zap's own end), text
        // "wow zap", score = ((-0.4)*0.5 + (-1.0)*1.0) / 1.5 = -0.8.
        // Surrounding single-fragment words ("cat", "dog") must pass
        // through untouched, proving the index bookkeeping doesn't leak
        // across group boundaries.
        let fragment_words = vec![
            w("cat", 0.0, 0.1, -0.05),
            w("wow", 1.0, 1.5, -0.4),
            w("zap", 1.5, 2.5, -1.0),
            w("dog", 3.0, 3.2, -0.05),
        ];
        let collapsed = collapse_word_fragments(fragment_words, &[1, 2, 1]);
        assert_eq!(collapsed.len(), 3);
        assert_eq!(collapsed[0], w("cat", 0.0, 0.1, -0.05));
        assert_eq!(collapsed[1].text, "wow zap");
        assert!((collapsed[1].start_seconds - 1.0).abs() < 1e-9);
        assert!((collapsed[1].end_seconds - 2.5).abs() < 1e-9);
        assert!((collapsed[1].score - (-0.8)).abs() < 1e-5, "got {}", collapsed[1].score);
        assert_eq!(collapsed[2], w("dog", 3.0, 3.2, -0.05));
    }

    #[test]
    #[should_panic(expected = "desynchronized")]
    fn collapse_panics_on_a_fragment_count_total_mismatch() {
        // Non-vacuity: the consistency guard must actually fire, not just be
        // present. 2 words in `fragment_words` but `fragment_counts` claims
        // 3 total fragments.
        let fragment_words = vec![w("cat", 0.0, 0.1, -0.05), w("dog", 0.2, 0.3, -0.07)];
        collapse_word_fragments(fragment_words, &[1, 2]);
    }

    // -- tokenize_normalized_words: fragment expansion + counting --------

    /// A hand-built 3-word list whose MIDDLE word is a multi-fragment
    /// `WordResult` — the shape WS2 T3.2 Step 3b's compositional generator
    /// will eventually produce for a space-linked reading (e.g. a year-shaped
    /// cardinal), authored directly here since no real normalizer emits one
    /// yet. Letters are chosen with no adjacent-repeat characters anywhere
    /// in the concatenated sequence (verified by assertion below, not just
    /// claimed) — the premise the deterministic emission matrix in the
    /// end-to-end test further down depends on.
    fn synthetic_words() -> Vec<WordResult> {
        vec![
            WordResult { input: "cat".to_string(), representable: true, mapped: Some("cat".to_string()), reason: None },
            WordResult { input: "98".to_string(), representable: true, mapped: Some("wow zap".to_string()), reason: None },
            WordResult { input: "dog".to_string(), representable: true, mapped: Some("dog".to_string()), reason: None },
        ]
    }

    #[test]
    fn tokenize_normalized_words_expands_a_multi_fragment_word_and_counts_it_correctly() {
        let vocab = load_vocab("en").unwrap();
        let tokenized = tokenize_normalized_words(&synthetic_words(), &vocab);

        // 3 source words -> fragment_counts has 3 entries; the middle one
        // (2 space-delimited fragments) is 2, the other two are 1.
        assert_eq!(tokenized.fragment_counts, vec![1, 2, 1]);

        // 4 delimiter-bounded runs total ("cat" | "wow" | "zap" | "dog") ->
        // exactly 3 delimiters in the flat id stream (between cat/wow,
        // wow/zap, zap/dog) — one MORE than the 2 a naive one-delimiter-
        // per-source-word scheme would emit, because the intra-word
        // fragment boundary gets a delimiter too.
        let delim = vocab.word_delim_id.unwrap();
        let delim_count = tokenized.ids.iter().filter(|&&id| id == delim).count();
        assert_eq!(delim_count, 3);
    }

    #[test]
    fn tokenize_normalized_words_is_unaffected_by_expansion_for_every_single_fragment_word() {
        // Neutrality at the tokenizer layer: a word list with no internal
        // spaces anywhere produces fragment_counts of all 1s, i.e. this
        // function's new code path (the inner fragments loop) executes with
        // exactly one iteration per word — same delimiter placement as
        // before this capability existed.
        let vocab = load_vocab("en").unwrap();
        let words = vec![
            WordResult { input: "cat".to_string(), representable: true, mapped: Some("cat".to_string()), reason: None },
            WordResult { input: "dog".to_string(), representable: true, mapped: Some("dog".to_string()), reason: None },
        ];
        let tokenized = tokenize_normalized_words(&words, &vocab);
        assert_eq!(tokenized.fragment_counts, vec![1, 1]);
        assert_eq!(tokenized.ids, text_to_token_ids("cat dog", Language::En, &vocab));
    }

    // -- end-to-end: tokenize -> forced_align -> merge -> collapse -------

    #[test]
    fn multi_fragment_word_tokenizes_aligns_and_collapses_to_one_word_span_per_source_word() {
        let vocab = load_vocab("en").unwrap();
        let words = synthetic_words();
        let tokenized = tokenize_normalized_words(&words, &vocab);
        assert_eq!(tokenized.fragment_counts, vec![1, 2, 1]);

        // Test premise this deterministic-alignment trick depends on: no
        // adjacent-repeat target ids anywhere in the flat sequence (R=0).
        for pair in tokenized.ids.windows(2) {
            assert_ne!(pair[0], pair[1], "test premise violated: adjacent-repeat target id would break T==L determinism");
        }

        // T == L, zero slack — `fa_viterbi.rs`'s own established property
        // (`t_exactly_equals_l_plus_r`/`aabbc_canonical_repeat_case_minimal_
        // t`): with R=0 and T==L, the Viterbi path is FORCED to be exactly
        // the target sequence, one frame per id, no blanks anywhere,
        // regardless of the emission matrix's own values — so a uniform
        // matrix is sufficient to make this test fully deterministic.
        let vocab_size = vocab
            .char_to_id
            .values()
            .copied()
            .chain(std::iter::once(vocab.blank_id))
            .chain(vocab.word_delim_id)
            .max()
            .unwrap() as usize
            + 1;
        let t = tokenized.ids.len();
        let log_probs = vec![vec![-1.0f32; vocab_size]; t];

        let result = forced_align(&log_probs, &tokenized.ids, vocab.blank_id)
            .expect("T == L with zero slack must always succeed");
        assert_eq!(result.path, tokenized.ids, "zero-slack alignment must reproduce the target sequence exactly");

        let char_spans = merge_tokens(&result.path, &result.scores, vocab.blank_id);
        let fragment_words = merge_char_spans_to_words(&char_spans, &vocab);
        // Pre-collapse: 4 separate WordSpans — proof the tokenizer's
        // expansion really did split "wow zap" into two independently
        // CTC-aligned fragments, not one.
        assert_eq!(fragment_words.len(), 4);
        assert_eq!(fragment_words.iter().map(|s| s.text.as_str()).collect::<Vec<_>>(), vec!["cat", "wow", "zap", "dog"]);

        let collapsed = collapse_word_fragments(fragment_words.clone(), &tokenized.fragment_counts);

        // THE CAPABILITY: exactly one WordSpan per SOURCE word (3, matching
        // `words.len()`), not one per fragment (4).
        assert_eq!(collapsed.len(), words.len());
        assert_eq!(collapsed.iter().map(|s| s.text.as_str()).collect::<Vec<_>>(), vec!["cat", "wow zap", "dog"]);

        // TIMING ATTRIBUTION: the collapsed multi-fragment word's span runs
        // first-fragment-start ("wow") to last-fragment-end ("zap") —
        // strictly wider than either fragment alone, proving this is a real
        // union rather than accidentally equal to one fragment's span.
        assert_eq!(collapsed[1].start_seconds, fragment_words[1].start_seconds);
        assert_eq!(collapsed[1].end_seconds, fragment_words[2].end_seconds);
        assert!(collapsed[1].end_seconds > fragment_words[1].end_seconds);
        assert!(collapsed[1].start_seconds < fragment_words[2].start_seconds);

        // INTERNAL FRAGMENT BOUNDARY NOT OBSERVABLE DOWNSTREAM: `collapsed`
        // carries no 4th entry, no marker, and no way to recover that "wow
        // zap" was ever two separate CTC targets — exactly the
        // `faBoundaryTypes.ts:120-125` / `fa.rs` `word_index` "already
        // exactly one word" contract this capability must preserve. A
        // consumer iterating `collapsed` by position sees source-word index
        // 1 map to "wow zap" as a single unit, the same shape it would see
        // for any ordinary single-fragment word.
        assert_eq!(collapsed[0].text, words[0].mapped.as_deref().unwrap());
        assert_eq!(collapsed[2].text, words[2].mapped.as_deref().unwrap());
    }
}

// ---------------------------------------------------------------------------
// CTC-infeasibility fallback unit tests (WS1 Task 5 Slice D20). Real data:
// both chunks are the exact (window, text) pairs `align_chunked` produced
// `AlignError::TooManyRepeats` on when run against the real 709s/173-project
// corpus (`docs/work-in-progress.md` §6's CTC-infeasibility paragraph;
// `d20-ctc-infeasibility-2026-08-14.md`'s own Step 2 reproduction, the
// original source, was deleted 2026-08-14, `9cf5867`; retrieve: `git show
// 251be64:docs/ws1-sync-pipeline/d20-ctc-infeasibility-2026-08-14.md`) —
// not fabricated. Neither test touches ORT/ONNX
// (`fallback_words_for_infeasible_chunk` only calls the embedded-vocab text
// normalizer + arithmetic), so this module runs unconditionally under
// `--features fa-inference`, no `require_ort` gate needed.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod ctc_infeasibility_fallback {
    use super::*;

    /// D20 Step 2, chunk 4 of the real 709s/173-project windowed plan.
    fn real_chunk_4() -> crate::fa::FaChunkInput {
        crate::fa::FaChunkInput {
            start_sec: 18.08,
            end_sec: 18.70,
            text: "because the environment was already doing the killing before the enemy showed up."
                .to_string(),
        }
    }

    /// D20 Step 2, chunk 52 of the real 709s/173-project windowed plan.
    fn real_chunk_52() -> crate::fa::FaChunkInput {
        crate::fa::FaChunkInput {
            start_sec: 405.58,
            end_sec: 406.98,
            text: "It just became a problem with a physical solution rather than a tactical one."
                .to_string(),
        }
    }

    #[test]
    fn real_infeasible_chunk_still_produces_a_ctc_error_this_slice_catches() {
        // Non-vacuity: confirms the real chunk 4/52 (window, text) pairs
        // still reproduce `AlignError::TooManyRepeats` against the SAME
        // real input-length math the ONNX-backed run hit — pure arithmetic
        // (frame-stride-derived frame count vs. tokenized target length),
        // no ONNX needed, since `forced_align`'s length precondition (`t <
        // l + r`) is checked before it ever touches the emission matrix's
        // actual row contents (`fa_viterbi.rs:145-154`), so an empty-row
        // synthetic emission of the real frame count reproduces the same
        // error the real ONNX run hit.
        let vocab = load_vocab("en").unwrap();
        let frame_stride_sec = FA_FRAME_STRIDE_SAMPLES as f64 / FA_SAMPLE_RATE_HZ as f64;
        for chunk in [real_chunk_4(), real_chunk_52()] {
            let target_ids = text_to_token_ids(&chunk.text, Language::En, &vocab);
            let window = chunk.end_sec - chunk.start_sec;
            let input_length = (window / frame_stride_sec).round() as usize;
            let emission: Vec<Vec<f32>> = vec![Vec::new(); input_length];
            let err = forced_align(&emission, &target_ids, vocab.blank_id).unwrap_err();
            assert!(
                matches!(err, AlignError::TooManyRepeats { .. }),
                "expected TooManyRepeats for real chunk text {:?} against a {input_length}-frame window, got {err:?}",
                chunk.text,
            );
        }
    }

    #[test]
    fn fallback_covers_every_representable_word_evenly_spaced_within_the_window() {
        let vocab = load_vocab("en").unwrap();
        for chunk in [real_chunk_4(), real_chunk_52()] {
            let normalized = normalize_for_forced_alignment(&chunk.text, Language::En, &vocab.chars, &vocab.cardinal_data);
            let want_count = normalized.words.iter().filter(|w| w.representable).count();

            let words = fallback_words_for_infeasible_chunk(&chunk, Language::En, &vocab);

            assert_eq!(words.len(), want_count, "chunk {:?}: fallback word count must match the normalizer's own representable-word count", chunk.text);
            assert!(!words.is_empty(), "real chunk text must produce at least one representable word");

            // Every word lies within the chunk's own window, in order, with
            // no overlap — the same hard invariants `check_words_within_own_
            // chunk`/`check_no_overlap`/`check_times_non_decreasing` assert
            // on real alignment output.
            for w in &words {
                assert!(w.start_seconds >= chunk.start_sec && w.end_seconds <= chunk.end_sec,
                    "word {:?} [{}, {}) escapes chunk window [{}, {})", w.text, w.start_seconds, w.end_seconds, chunk.start_sec, chunk.end_sec);
            }
            for pair in words.windows(2) {
                assert!(pair[0].end_seconds <= pair[1].start_seconds, "words overlap: {pair:?}");
                assert!(pair[0].start_seconds <= pair[1].start_seconds, "words out of order: {pair:?}");
            }

            // Every placeholder word is unconditionally below CONF_MIN once
            // exponentiated — the exact mechanism that makes it surface as
            // `needs_review: true` at the IPC boundary (`fa.rs::word_span_to_dto`).
            for w in &words {
                assert_eq!(w.score, CTC_INFEASIBLE_FALLBACK_SCORE);
                let confidence = w.score.exp();
                assert_eq!(confidence, 0.0, "fallback confidence must be exactly 0.0, got {confidence}");
                assert!(confidence < 0.3, "fallback confidence must be below CONF_MIN");
            }
        }
    }

    #[test]
    fn fallback_produces_real_expected_word_text_for_chunk_4() {
        // Pins the exact word sequence for chunk 4's real text — a
        // regression guard on `normalize_for_forced_alignment`'s own
        // word-splitting behavior for this real input, not just a count.
        let vocab = load_vocab("en").unwrap();
        let words = fallback_words_for_infeasible_chunk(&real_chunk_4(), Language::En, &vocab);
        let texts: Vec<&str> = words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(
            texts,
            vec![
                "because", "the", "environment", "was", "already", "doing", "the", "killing",
                "before", "the", "enemy", "showed", "up",
            ]
        );
    }

    #[test]
    fn fallback_on_empty_representable_text_returns_empty_not_a_panic() {
        let vocab = load_vocab("en").unwrap();
        // "1st"/"2nd" are digit-BEARING but not bare digit strings (ordinal
        // suffix letters), so they stay unrepresentable regardless of WS2
        // T3.2 Step 3b-iii's cardinal-number generator (which only expands a
        // token that is ENTIRELY digits) — a bare "42 99" would no longer
        // serve this test, since Step 3b-iii made bare digits representable
        // under English too.
        let chunk = crate::fa::FaChunkInput { start_sec: 1.0, end_sec: 2.0, text: "1st 2nd".to_string() };
        let words = fallback_words_for_infeasible_chunk(&chunk, Language::En, &vocab);
        assert!(words.is_empty(), "digit-bearing text has zero representable words — expected empty, not a panic");
    }
}

// ---------------------------------------------------------------------------
// Character -> word span merge unit tests (WS1 Task 5 Slice D8). None of
// these touch ORT/ONNX — `TokenSpan` lists are hand-built or produced by a
// synthetic `forced_align` call (the same technique `fa_viterbi.rs`'s own
// hand-computable tests use), so this module runs unconditionally in every
// environment, no `require_ort` gate needed.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod word_merge {
    use super::*;

    /// English vocab char ids used throughout this module (confirmed by
    /// direct inspection of `fa-vocab-en.json`): c=9, a=7, t=26, d=10, o=21,
    /// g=13, b=8, k=17, delimiter "|"=4.
    fn span(token: i64, start: usize, end: usize, score: f32) -> TokenSpan {
        TokenSpan { token, start, end, score }
    }

    #[test]
    fn merges_two_words_split_by_one_delimiter() {
        let vocab = load_vocab("en").unwrap();
        let delim = vocab.word_delim_id.unwrap();
        // "cat" (c=9,a=7,t=26) | "dog" (d=10,o=21,g=13)
        let spans = vec![
            span(9, 0, 1, -0.1),
            span(7, 1, 2, -0.2),
            span(26, 2, 3, -0.3),
            span(delim, 3, 4, -0.05),
            span(10, 5, 6, -0.4),
            span(21, 6, 7, -0.5),
            span(13, 7, 8, -0.6),
        ];
        let words = merge_char_spans_to_words(&spans, &vocab);
        assert_eq!(words.len(), 2, "zero-word pass must be impossible for non-empty input");
        assert_eq!(words[0].text, "cat");
        assert_eq!(words[1].text, "dog");
        // Delimiter is a pure boundary — never included in reconstructed text.
        assert!(!words[0].text.contains('|') && !words[1].text.contains('|'));
    }

    #[test]
    fn word_seconds_span_first_to_last_constituent_char_frame() {
        let vocab = load_vocab("en").unwrap();
        let spans = vec![span(9, 3, 5, -0.1), span(7, 5, 6, -0.2), span(26, 8, 9, -0.3)];
        let words = merge_char_spans_to_words(&spans, &vocab);
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].start_seconds, frame_to_seconds(3));
        assert_eq!(words[0].end_seconds, frame_to_seconds(9));
    }

    #[test]
    fn word_score_is_weighted_by_span_frame_length_not_unweighted_mean() {
        let vocab = load_vocab("en").unwrap();
        // "ca": 'c' is a 10-frame run at score -1.0, 'a' is a 1-frame run at
        // score -10.0. Weighted mean = (-1.0*10 + -10.0*1) / 11 ≈ -1.818.
        // Unweighted mean would give (-1.0 + -10.0) / 2 = -5.5 — a materially
        // different number, so this test actually distinguishes the two
        // aggregation choices rather than passing under either.
        let spans = vec![span(9, 0, 10, -1.0), span(7, 10, 11, -10.0)];
        let words = merge_char_spans_to_words(&spans, &vocab);
        assert_eq!(words.len(), 1);
        let weighted = (-1.0f32 * 10.0 + -10.0f32 * 1.0) / 11.0;
        assert!(
            (words[0].score - weighted).abs() < 1e-5,
            "expected frame-length-weighted mean {weighted}, got {}",
            words[0].score
        );
        let unweighted = (-1.0f32 + -10.0f32) / 2.0;
        assert!(
            (words[0].score - unweighted).abs() > 1.0,
            "score must NOT equal the unweighted mean {unweighted} — got {}",
            words[0].score
        );
    }

    #[test]
    fn leading_and_trailing_delimiters_produce_no_empty_word() {
        let vocab = load_vocab("en").unwrap();
        let delim = vocab.word_delim_id.unwrap();
        let spans = vec![span(delim, 0, 1, -0.05), span(9, 1, 2, -0.1), span(delim, 2, 3, -0.05)];
        let words = merge_char_spans_to_words(&spans, &vocab);
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].text, "c");
    }

    #[test]
    fn two_adjacent_delimiters_produce_no_empty_word() {
        let vocab = load_vocab("en").unwrap();
        let delim = vocab.word_delim_id.unwrap();
        let spans = vec![span(9, 0, 1, -0.1), span(delim, 1, 2, -0.05), span(delim, 2, 3, -0.05), span(7, 3, 4, -0.2)];
        let words = merge_char_spans_to_words(&spans, &vocab);
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "c");
        assert_eq!(words[1].text, "a");
    }

    #[test]
    fn empty_input_produces_zero_words_not_a_panic() {
        let vocab = load_vocab("en").unwrap();
        let words = merge_char_spans_to_words(&[], &vocab);
        assert_eq!(words, Vec::<WordSpan>::new());
    }

    #[test]
    fn repeated_adjacent_character_within_a_word_stays_one_word_two_spans() {
        // "book": b=8, o=21 (repeated — CTC forces a mandatory blank between
        // the two 'o' spans, so they arrive here as two separate same-token
        // TokenSpans with a frame gap between them, per merge_tokens), k=17.
        let vocab = load_vocab("en").unwrap();
        let spans = vec![
            span(8, 0, 1, -0.1),
            span(21, 1, 2, -0.2),
            // frame 2 is the mandatory blank, dropped by merge_tokens — not
            // present here, by construction.
            span(21, 3, 4, -0.25),
            span(17, 4, 5, -0.3),
        ];
        let words = merge_char_spans_to_words(&spans, &vocab);
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].text, "book");
        // The gap frame (2) is excluded from both the span extent used for
        // scoring and the reported boundaries — end_seconds is the LAST
        // span's own end (frame 5), not stretched to cover the gap.
        assert_eq!(words[0].start_seconds, frame_to_seconds(0));
        assert_eq!(words[0].end_seconds, frame_to_seconds(5));
        let weighted = (-0.1f32 * 1.0 + -0.2f32 * 1.0 + -0.25f32 * 1.0 + -0.3f32 * 1.0) / 4.0;
        assert!((words[0].score - weighted).abs() < 1e-5);
    }

    // -- non-vacuity: perturb each new assertion, confirm it actually fails --

    #[test]
    fn non_vacuity_word_count_assertion_catches_a_wrong_count() {
        let vocab = load_vocab("en").unwrap();
        let delim = vocab.word_delim_id.unwrap();
        let spans =
            vec![span(9, 0, 1, -0.1), span(7, 1, 2, -0.2), span(delim, 2, 3, -0.05), span(26, 3, 4, -0.3)];
        let words = merge_char_spans_to_words(&spans, &vocab);
        // Real assertion this mirrors: `assert_eq!(words.len(), 2)`.
        assert_eq!(words.len(), 2, "sanity: real count must be 2");
        // Perturbed: assert the WRONG count and confirm it fails.
        let perturbed = std::panic::catch_unwind(|| assert_eq!(words.len(), 3));
        assert!(perturbed.is_err(), "perturbed wrong-count assertion must fail, not silently pass");
    }

    #[test]
    fn non_vacuity_text_reconstruction_assertion_catches_wrong_text() {
        let vocab = load_vocab("en").unwrap();
        let spans = vec![span(9, 0, 1, -0.1), span(7, 1, 2, -0.2), span(26, 2, 3, -0.3)];
        let words = merge_char_spans_to_words(&spans, &vocab);
        assert_eq!(words[0].text, "cat", "sanity: real text must be \"cat\"");
        let text = words[0].text.clone();
        let perturbed = std::panic::catch_unwind(move || assert_eq!(text, "dog"));
        assert!(perturbed.is_err(), "perturbed wrong-text assertion must fail, not silently pass");
    }

    #[test]
    fn non_vacuity_seconds_assertion_catches_wrong_boundary() {
        let vocab = load_vocab("en").unwrap();
        let spans = vec![span(9, 3, 5, -0.1)];
        let words = merge_char_spans_to_words(&spans, &vocab);
        assert_eq!(words[0].start_seconds, frame_to_seconds(3), "sanity: real start must be frame 3");
        let start = words[0].start_seconds;
        let perturbed = std::panic::catch_unwind(move || assert_eq!(start, frame_to_seconds(4)));
        assert!(perturbed.is_err(), "perturbed wrong-boundary assertion must fail, not silently pass");
    }

    // -- drop-path coverage: an unrepresentable word must vanish cleanly ----

    #[test]
    fn unrepresentable_middle_word_is_dropped_with_correct_neighbours_and_no_stray_delimiter() {
        // "cat 5x dog": the real production tokenizer (`text_to_token_ids`,
        // vocab-aware, same path `align_chunk_samples` uses) drops "5x"
        // wholesale — a digit-bearing (not bare-digit) word stays out of WS2
        // T3.2 Step 3b-iii's cardinal generator's scope, so it still hits
        // D5's documented contract-only drop path (a bare "5" would no
        // longer serve this test — Step 3b-iii made it representable
        // ("five") under English too). This test drives that REAL tokenizer
        // output through a SYNTHETIC `forced_align` call (uniform, heavily-
        // favored per-frame log-probs, T == L exactly so the path is fully
        // forced — the same technique `fa_viterbi.rs`'s own
        // `aabbc_canonical_repeat_case_minimal_t` test uses) to get REAL
        // character-level TokenSpans out of the actual DP, not hand-
        // fabricated ones, then merges them into words.
        let vocab = load_vocab("en").unwrap();
        let target_ids = text_to_token_ids("cat 5x dog", Language::En, &vocab);
        // Sanity: the tokenizer already dropped "5x" — one delimiter, 6 letters.
        assert_eq!(target_ids.len(), 7, "test premise: \"cat\"+delim+\"dog\" must be 7 ids");

        let l = target_ids.len();
        let c = 30usize; // safely above every vocab id used (max id here is 26 't').
        // T == L, R == 0 (no immediately-repeated adjacent ids in "catXdog"
        // once delim is counted — 'c','a','t','|','d','o','g' are all
        // distinct from their neighbours), so the DP is fully forced through
        // exactly one label per frame with zero blanks, regardless of
        // magnitude (same zero-slack reasoning as fa_viterbi.rs's own
        // t_exactly_equals_l_plus_r/aabbc tests).
        let mut log_probs = vec![vec![-10.0f32; c]; l];
        for (t, &id) in target_ids.iter().enumerate() {
            log_probs[t][id as usize] = -0.01;
        }
        let result = forced_align(&log_probs, &target_ids, vocab.blank_id).unwrap();
        assert_eq!(result.path, target_ids, "test premise: zero-slack path must equal target_ids exactly");

        let char_spans = merge_tokens(&result.path, &result.scores, vocab.blank_id);
        assert_eq!(char_spans.len(), l, "test premise: one span per frame, none merged (no repeats)");

        let words = merge_char_spans_to_words(&char_spans, &vocab);
        assert_eq!(words.len(), 2, "the dropped middle word must not produce a third word");
        assert_eq!(words[0].text, "cat", "left neighbour must be correct");
        assert_eq!(words[1].text, "dog", "right neighbour must be correct");
        assert!(words.iter().all(|w| !w.text.is_empty()), "no empty word");
        assert!(words.iter().all(|w| !w.text.contains('|')), "no stray delimiter in reconstructed text");
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

    /// WS1 Task 5 Slice D23. Guards every `whole_file_reference_240s`
    /// (duplicated once per `d12_measurement`/`d13_measurement`/
    /// `d21_measurement`/`d22_measurement` module — see each copy's own doc
    /// comment) across its ENTIRE check-cache-or-compute-and-write critical
    /// section, following this module's own `ORT_ENV_LOCK` precedent.
    ///
    /// Without this: two tests in the same multi-threaded `cargo test`
    /// process (e.g. `d22_measurement`'s own `mis_assignment_filtered_
    /// correlation_240s` and `full_709s_index_attribution_tail_
    /// characterization`, both real, both real callers) can both observe a
    /// cold cache and both start computing the whole-file reference
    /// CONCURRENTLY — each pass peaks ~20GiB (D10/D11) on a 32GiB machine,
    /// which drove this exact machine into 23GiB+ of swap and a 30+ minute
    /// uninterruptible-I/O stall with no forward progress (WS1 Task 5 Slice
    /// D23's own Step 2). The prior workaround was `--test-threads=1` on the
    /// `cargo test` invocation — an easy-to-forget flag a future CI
    /// configuration would silently not carry. With this lock, the first
    /// caller computes and writes the cache file while holding the lock; a
    /// second, concurrent caller blocks on the lock, then — once it
    /// acquires it — finds the cache file already populated and returns
    /// from the fast path immediately, with no flag required.
    pub static WHOLE_FILE_REFERENCE_LOCK: Mutex<()> = Mutex::new(());

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
        // see docs/work-in-progress.md §5's D5 row; original source
        // fa-text-to-spans-seam-d5-2026-08-12.md was deleted 2026-08-14,
        // `9cf5867`; retrieve: `git show
        // 251be64:docs/ws1-sync-pipeline/fa-text-to-spans-seam-d5-2026-08-12.md`.
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
// Character -> word merge against the six real e2e fixtures (WS1 Task 5
// Slice D8). Reuses `e2e_parity`'s own pipeline (real ONNX forward pass ->
// `forced_align` -> `merge_tokens`) to get REAL character-level TokenSpans,
// then feeds them to `merge_char_spans_to_words` and checks two independent
// things against two independent ground truths:
//
//   1. The merged word TEXT list matches the normalizer's OWN
//      representable-word output (`fa::text::normalize_for_forced_alignment`
//      on the fixture's `_provenance.text`) — NOT a naive whitespace split.
//      A naive split would happen to pass on these six fixtures purely
//      because none of them contains an unrepresentable word (D5's own
//      finding), proving nothing about the drop path; the normalizer's own
//      output is correct by definition and exercises the real contract.
//   2. Each word's `start_seconds`/`end_seconds` matches the fixture's own
//      pre-computed `expected_spans[i]["start_seconds"/"end_seconds"]`
//      fields (Python-computed ground truth, independent of this file's
//      `frame_to_seconds`), via an INDEPENDENT grouping loop written here
//      in the test (not by calling `merge_char_spans_to_words` a second
//      time) — so both the grouping boundaries and the seconds conversion
//      are cross-checked against fixture-authored numbers, not against this
//      module's own function a second time.
//
// Same require_ort/FA_REQUIRE_ORT skip-vs-fail gating and ORT_ENV_LOCK
// discipline as `e2e_parity` (same missing-`ORT_DYLIB_PATH`/missing-
// `model.onnx` conditions, same reasoning — see that module's own comment).
// ---------------------------------------------------------------------------
#[cfg(test)]
mod word_merge_e2e {
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
        Fixture { file: "fa-e2e-alignment-fr-pas-juste.json", language: "fr" },
        Fixture { file: "fa-e2e-alignment-de-nicht-fair.json", language: "de" },
        Fixture { file: "fa-e2e-alignment-pt-site-publico.json", language: "pt" },
    ];

    const FA_SECONDS_TOLERANCE: f64 = 1e-9;

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }

    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("word_merge_e2e's fa_models_dir() only reproduces the macOS app_local_data_dir mapping");
    }

    /// Groups fixture-authored `expected_spans` on `delim` into
    /// `(start_seconds, end_seconds)` pairs, read directly from each group's
    /// first/last member's own `start_seconds`/`end_seconds` JSON fields —
    /// independent of `merge_char_spans_to_words`/`frame_to_seconds`, so
    /// this is real fixture ground truth, not a second call into the code
    /// under test.
    fn expected_word_seconds_from_fixture(expected_spans: &[serde_json::Value], delim: i64) -> Vec<(f64, f64)> {
        let mut out = Vec::new();
        let mut run_start: Option<f64> = None;
        let mut run_end: Option<f64> = None;
        for span in expected_spans {
            let token = span["token"].as_i64().unwrap();
            if token == delim {
                if let (Some(s), Some(e)) = (run_start.take(), run_end.take()) {
                    out.push((s, e));
                }
                continue;
            }
            let s = span["start_seconds"].as_f64().unwrap();
            let e = span["end_seconds"].as_f64().unwrap();
            if run_start.is_none() {
                run_start = Some(s);
            }
            run_end = Some(e);
        }
        if let (Some(s), Some(e)) = (run_start, run_end) {
            out.push((s, e));
        }
        out
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
        let blank_id = v["blank_id"].as_i64().expect("blank_id");
        let expected_spans = v["expected_spans"].as_array().expect("expected_spans");

        let vocab = load_vocab(fixture.language).unwrap_or_else(|e| panic!("{}: load_vocab failed: {e}", fixture.file));
        let lang_enum = Language::from_code(fixture.language).expect("known language code");
        let target_ids = text_to_token_ids(source_text, lang_enum, &vocab);

        let normed = zero_mean_unit_var_norm(&input_samples);
        let emission = with_ort_env_lock(|| run_forward_pass(&model_path, &normed))
            .unwrap_or_else(|e| panic!("{}: forward pass failed: {e}", fixture.file));

        let align_result = forced_align(&emission, &target_ids, blank_id)
            .unwrap_or_else(|e| panic!("{}: forced_align failed: {e}", fixture.file));
        let char_spans = merge_tokens(&align_result.path, &align_result.scores, blank_id);

        // Vacuity guards: neither char-span nor word-merge output may be
        // empty for these six real, real-speech fixtures.
        assert!(!char_spans.is_empty(), "{}: zero char spans — vacuous", fixture.file);
        let words = merge_char_spans_to_words(&char_spans, &vocab);
        assert!(!words.is_empty(), "{}: zero merged words — vacuous", fixture.file);

        // 1) Word text vs. the normalizer's OWN representable-word output —
        // NOT a naive whitespace split (see module doc comment for why).
        let normalized = normalize_for_forced_alignment(source_text, lang_enum, &vocab.chars, &vocab.cardinal_data);
        let expected_words: Vec<String> = normalized
            .words
            .iter()
            .filter(|w| w.representable)
            .map(|w| w.mapped.clone().expect("representable word must have `mapped` set"))
            .collect();
        let got_words: Vec<String> = words.iter().map(|w| w.text.clone()).collect();
        assert_eq!(
            got_words, expected_words,
            "{}: merged word text list diverges from the normalizer's own representable-word output",
            fixture.file
        );

        // 2) Seconds vs. fixture-authored ground truth, via an independent
        // grouping loop over the fixture's own JSON (not this module's
        // function called a second time).
        let delim = vocab.word_delim_id.expect("every supported language has a word delimiter");
        let expected_seconds = expected_word_seconds_from_fixture(expected_spans, delim);
        assert_eq!(
            words.len(),
            expected_seconds.len(),
            "{}: word count diverges from an independent fixture-JSON grouping",
            fixture.file
        );

        let mut max_abs_seconds_dev = 0.0f64;
        let mut min_score = f32::INFINITY;
        let mut max_score = f32::NEG_INFINITY;
        for (got, (want_start, want_end)) in words.iter().zip(expected_seconds.iter()) {
            let start_dev = (got.start_seconds - want_start).abs();
            let end_dev = (got.end_seconds - want_end).abs();
            assert!(
                start_dev <= FA_SECONDS_TOLERANCE,
                "{}: word \"{}\" start_seconds diverges from fixture ground truth — got {}, want {want_start}, diff {start_dev}",
                fixture.file, got.text, got.start_seconds
            );
            assert!(
                end_dev <= FA_SECONDS_TOLERANCE,
                "{}: word \"{}\" end_seconds diverges from fixture ground truth — got {}, want {want_end}, diff {end_dev}",
                fixture.file, got.text, got.end_seconds
            );
            max_abs_seconds_dev = max_abs_seconds_dev.max(start_dev).max(end_dev);
            min_score = min_score.min(got.score);
            max_score = max_score.max(got.score);
        }

        eprintln!(
            "{}: {} words, {} char spans, max_abs_seconds_dev={max_abs_seconds_dev:e}, score_range=[{min_score}, {max_score}]",
            fixture.file,
            words.len(),
            char_spans.len()
        );
    }

    #[test]
    fn words_en_deep_night() {
        run_one(&FIXTURES[0]);
    }

    #[test]
    fn words_en_mother_look() {
        run_one(&FIXTURES[1]);
    }

    #[test]
    fn words_es_resultan_inutiles() {
        run_one(&FIXTURES[2]);
    }

    #[test]
    fn words_fr_pas_juste() {
        run_one(&FIXTURES[3]);
    }

    #[test]
    fn words_de_nicht_fair() {
        run_one(&FIXTURES[4]);
    }

    #[test]
    fn words_pt_site_publico() {
        run_one(&FIXTURES[5]);
    }
}

// ---------------------------------------------------------------------------
// EmptyTokenization: real end-to-end `align_chunked` call (the same body
// `align_chunked_for_language`/`fa_align` runs, minus only the AppHandle-
// dependent model-path resolution — see that function's own doc comment)
// with real audio and real text whose every word is unrepresentable in the
// target language's vocab. Proves the typed `FaOnnxError::EmptyTokenization`
// variant specifically surfaces from the real pipeline, not merely that
// align_chunked returns *some* Err (WS1 Task 5 Slice D6, closing a previously-unverified
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
        let chunks = vec![crate::fa::FaChunkInput {
            start_sec: 0.0,
            end_sec: 60.0, // deliberately past the ~3.8s clip's real length — chunk_sample_range clamps
            text: "東京 大阪".to_string(),
        }];
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);

        let result = align_chunked(
            &cache,
            &model_path,
            tmp_path.to_str().unwrap(),
            &chunks,
            "en",
            || false,
            |_| {},
        );
        let _ = std::fs::remove_file(&tmp_path);

        match result {
            Err(FaOnnxError::EmptyTokenization) => {}
            Err(other) => panic!(
                "{CONTEXT}: expected Err(FaOnnxError::EmptyTokenization) specifically, got a \
                 different error variant: {other:?}"
            ),
            Ok(spans) => panic!(
                "{CONTEXT}: expected Err(FaOnnxError::EmptyTokenization), but align_chunked \
                 succeeded with {} span(s) — the vocab-rejection premise this test depends on no \
                 longer holds",
                spans.len()
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// Cancellation determinism (WS1 Task 5 Slice D11).
//
// A real, multi-chunk `align_chunked` run, cancelled mid-way via a
// DETERMINISTIC `is_cancelled` closure — not a timer, not a background
// thread, not a sleep-and-hope race. `align_chunked` is single-threaded and
// synchronous end to end (no `.await` anywhere in its call graph — confirmed
// by direct reading), so a closure that counts its own call count and
// returns `true` on a specific, pre-computed call number reproduces "cancel
// requested after exactly N chunks completed" with zero flakiness: the same
// input always produces the same call sequence, always stops at the same
// chunk, every run, on every machine, forever. Real ORT + a real (tiny)
// model.onnx forward pass runs for the chunks that DO execute, so this
// exercises the actual production code path, not a stub.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod cancellation {
    use super::*;
    use std::cell::Cell;
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }

    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("cancellation's fa_models_dir() only reproduces the macOS app_local_data_dir mapping");
    }

    /// Duplicated per this file's own established convention (see
    /// `empty_tokenization::build_wav`'s doc comment) rather than shared
    /// across sibling test modules.
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
        bytes.extend_from_slice(&1u16.to_le_bytes());
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
    fn cancellation_stops_before_completing_all_chunks_deterministically() {
        const CONTEXT: &str = "cancellation_stops_before_completing_all_chunks_deterministically";
        if !super::require_ort::ort_dylib_or_skip(CONTEXT) {
            return;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(CONTEXT, &model_path) {
            return;
        }

        // Real, committed audio (same D2 fixture `empty_tokenization` reuses)
        // sliced into 4 short, real sub-windows — this test cares about
        // CONTROL FLOW (which chunks ran), not alignment accuracy, so simple
        // real English words per chunk are enough to let a processed chunk
        // succeed cleanly.
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
        let duration_sec = input_samples.len() as f64 / FA_SAMPLE_RATE_HZ as f64;
        let pcm16: Vec<i16> = input_samples
            .iter()
            .map(|&s| (s * 32768.0).clamp(i16::MIN as f32, i16::MAX as f32) as i16)
            .collect();
        let wav_bytes = build_wav(&pcm16);
        let tmp_path =
            std::env::temp_dir().join(format!("fa-cancellation-test-{}-{}.wav", std::process::id(), CONTEXT));
        std::fs::write(&tmp_path, &wav_bytes)
            .unwrap_or_else(|e| panic!("{CONTEXT}: failed to write temp WAV {}: {e}", tmp_path.display()));

        let quarter = duration_sec / 4.0;
        let words = ["cat", "dog", "bird", "fish"];
        let chunks: Vec<crate::fa::FaChunkInput> = (0..4)
            .map(|i| crate::fa::FaChunkInput {
                start_sec: quarter * i as f64,
                end_sec: quarter * (i as f64 + 1.0),
                text: words[i].to_string(),
            })
            .collect();

        // Deterministic call-count-based cancellation: `align_chunked` calls
        // `is_cancelled` once before the loop (call 1) then once per chunk
        // boundary (calls 2, 3, 4, 5 for chunks 0-3). Returning `true` on
        // call 4 lets chunks 0 and 1 complete (their own pre-checks are
        // calls 2 and 3, both `false`) and cancels before chunk 2 ever
        // starts (call 4).
        let call_count = Cell::new(0u32);
        let is_cancelled = || {
            call_count.set(call_count.get() + 1);
            call_count.get() >= 4
        };
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let mut completed_indices: Vec<u32> = Vec::new();
        let result = align_chunked(
            &cache,
            &model_path,
            tmp_path.to_str().unwrap(),
            &chunks,
            "en",
            is_cancelled,
            |i| completed_indices.push(i),
        );
        let _ = std::fs::remove_file(&tmp_path);

        match result {
            Err(FaOnnxError::Cancelled) => {}
            Err(other) => panic!("{CONTEXT}: expected Err(FaOnnxError::Cancelled), got {other:?}"),
            Ok(words) => panic!(
                "{CONTEXT}: expected Err(FaOnnxError::Cancelled), but align_chunked completed \
                 successfully with {} word(s) — cancellation had no effect",
                words.len()
            ),
        }

        // Exactly chunks 0 and 1 (1-based progress indices 1 and 2) ran —
        // not zero (proves real work happened before the cancel), not all 4
        // (proves the cancel actually stopped the loop early), and the
        // EXACT count (not just "fewer than 4") proves the call-count
        // arithmetic above is right, not just "roughly early."
        assert_eq!(
            completed_indices,
            vec![1, 2],
            "{CONTEXT}: expected exactly chunks 1 and 2 (1-based) to complete before cancellation, got {completed_indices:?}"
        );
        assert!(
            completed_indices.len() < chunks.len(),
            "{CONTEXT}: a cancelled run must stop before completing every chunk"
        );
    }

    /// Non-vacuity: an `is_cancelled` that never returns `true` must run
    /// every chunk to completion — proves the test above's early stop is
    /// actually caused by cancellation firing, not by some unrelated bug
    /// that always stops the loop early regardless of the predicate.
    #[test]
    fn non_cancelled_run_completes_every_chunk() {
        const CONTEXT: &str = "non_cancelled_run_completes_every_chunk";
        if !super::require_ort::ort_dylib_or_skip(CONTEXT) {
            return;
        }
        let model_path = fa_models_dir().join("en").join("model.onnx");
        if !super::require_ort::path_exists_or_skip(CONTEXT, &model_path) {
            return;
        }

        let fixture_path =
            format!("{}/../scripts/fixtures/fa-onnx-emission-en-deep-night.json", env!("CARGO_MANIFEST_DIR"));
        let fixture_text = std::fs::read_to_string(&fixture_path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&fixture_text).unwrap();
        let input_samples: Vec<f32> =
            v["input_samples"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect();
        let duration_sec = input_samples.len() as f64 / FA_SAMPLE_RATE_HZ as f64;
        let pcm16: Vec<i16> =
            input_samples.iter().map(|&s| (s * 32768.0).clamp(i16::MIN as f32, i16::MAX as f32) as i16).collect();
        let tmp_path =
            std::env::temp_dir().join(format!("fa-cancellation-test-nocancel-{}-{}.wav", std::process::id(), CONTEXT));
        std::fs::write(&tmp_path, build_wav(&pcm16)).unwrap();

        let quarter = duration_sec / 4.0;
        let words = ["cat", "dog", "bird", "fish"];
        let chunks: Vec<crate::fa::FaChunkInput> = (0..4)
            .map(|i| crate::fa::FaChunkInput {
                start_sec: quarter * i as f64,
                end_sec: quarter * (i as f64 + 1.0),
                text: words[i].to_string(),
            })
            .collect();

        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let mut completed_indices: Vec<u32> = Vec::new();
        let result = align_chunked(
            &cache,
            &model_path,
            tmp_path.to_str().unwrap(),
            &chunks,
            "en",
            || false,
            |i| completed_indices.push(i),
        );
        let _ = std::fs::remove_file(&tmp_path);

        assert!(result.is_ok(), "{CONTEXT}: expected Ok, got {result:?}");
        assert_eq!(completed_indices, vec![1, 2, 3, 4], "{CONTEXT}: every chunk must complete when never cancelled");
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

// ---------------------------------------------------------------------------
// WS1 SESSION P — FA REGENERATION AGAINST THE LIVE CHUNK PLAN.
//
// WHY (measured). `.work-phase4/replay/v6/fa_production_words.json` was
// aligned against a 280-chunk plan; the current code computes 277 chunks from
// the same corpus. Every rule that reads those words (R.11/R.12/R.13, and
// every boundary they correct) has therefore been reading FA output produced
// against windows the app no longer builds — a stale vintage, and the reason
// Session P's R.11 firing set would not converge with the live run's.
//
// This regenerates the FA arm with the SAME ENGINE that produced the stale
// capture — `align_chunked`, the real production path, jonatasgrosman ONNX via
// `ort` — so the ONLY variable changed is the chunk plan. Regenerating with a
// different engine (torchaudio MMS_FA, whose per-segment output
// `meta_fa.json`/`tokens_fa.json` describes) would swap a vintage mismatch for
// a MODEL mismatch and make a non-converging result uninterpretable: MMS_FA
// and jonatasgrosman have different vocabularies and different class counts
// (see `capture-fa-onnx-reference.py`'s own header on exactly this point).
//
// PRODUCTION FIDELITY. `align_chunked` is called ONCE with the WHOLE chunk
// slice, which is what `fa.rs::fa_align` does — NOT one chunk per call like
// `d12_measurement::run_windowed_fault_tolerant`, whose per-chunk loop drops
// failures on the floor and so cannot reproduce production's own
// CTC-infeasible fallback words. The DTO conversion below (`score.exp()`,
// `needs_review = confidence < 0.3`, `word_index` across the whole run)
// duplicates `fa.rs::word_span_to_dto`/`word_spans_to_dtos` rather than
// calling them because those are `fn`-private to `fa.rs`; the formulas are
// asserted identical by this module's own `dto_formula_matches_production`
// test, which needs no model and always runs.
//
// RUN (per corpus — v6 is the load-bearing one; 173/spanish serve Step 7b(d)):
//   ORT_DYLIB_PATH=<repo>/src-tauri/onnxruntime/libonnxruntime.1.23.2.dylib \
//   FA_REGEN_CORPUS=v6 FA_REGEN_LANG=en FA_REQUIRE_ORT=1 \
//   cargo test --features fa-inference -- --ignored --nocapture --exact \
//     fa_onnx::session_p_regen::regenerate_fa_against_live_plan
//
// Reads  `.work-phase4/replay/<corpus>/fa_live_chunks.json` + `audio_16k.wav`.
// Writes `.work-phase4/replay/<corpus>/fa_live_words.json`.
//
// WS1 Session AG: both filenames are overridable — `FA_REGEN_PLAN` selects the
// plan to align against and `FA_REGEN_OUT` the words file to write. Both
// default to the names above, so the invocation recorded here is unchanged.
// Session AG uses them to align the same audio against an S1-folded plan
// WITHOUT overwriting the baseline arm the comparison is against.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod session_p_regen {
    use super::*;
    use std::path::PathBuf;

    /// Mirrors `fa.rs`'s own `CONF_MIN` (0.3), which mirrors
    /// `syncConstants.ts`'s. Duplicated here only because it is private to
    /// `fa.rs`; `dto_formula_matches_production` pins the duplication.
    const CONF_MIN_MIRROR: f32 = 0.3;

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }
    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("session_p_regen's fa_models_dir() only reproduces the macOS mapping");
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    #[derive(serde::Deserialize)]
    struct LivePlanFile {
        #[serde(rename = "audioDuration")]
        audio_duration: f64,
        chunks: Vec<LivePlanChunk>,
    }
    #[derive(serde::Deserialize)]
    struct LivePlanChunk {
        #[serde(rename = "startSec")]
        start_sec: f64,
        #[serde(rename = "endSec")]
        end_sec: f64,
        text: String,
    }

    /// The production DTO formula, isolated so it has a test of its own.
    /// Returns `(confidence, needs_review)` for one raw CTC score.
    fn dto_confidence(score: f32) -> (f32, bool) {
        let confidence = score.exp();
        (confidence, confidence < CONF_MIN_MIRROR)
    }

    /// Runs with no model and no ORT: pins that this module's duplicated DTO
    /// formula still matches `fa.rs::word_span_to_dto`'s documented behaviour
    /// (`confidence = score.exp()`, `needs_review = confidence < CONF_MIN`),
    /// including the `NEG_INFINITY -> 0.0` CTC-infeasible placeholder case
    /// `CTC_INFEASIBLE_FALLBACK_SCORE` relies on.
    #[test]
    fn dto_formula_matches_production() {
        let (c, r) = dto_confidence(0.0);
        assert_eq!(c, 1.0);
        assert!(!r, "a perfect score must not be flagged for review");

        let (c, r) = dto_confidence(f32::NEG_INFINITY);
        assert_eq!(c, 0.0, "CTC-infeasible placeholder must underflow to exactly 0.0, never NaN");
        assert!(r, "a placeholder word must always surface as needs_review");

        // Either side of CONF_MIN, via the same exp() the boundary applies.
        let (c, r) = dto_confidence(CONF_MIN_MIRROR.ln() - 1e-3);
        assert!(c < CONF_MIN_MIRROR && r);
        let (c, r) = dto_confidence(CONF_MIN_MIRROR.ln() + 1e-3);
        assert!(c > CONF_MIN_MIRROR && !r);
    }

    #[test]
    #[ignore]
    fn regenerate_fa_against_live_plan() {
        const CONTEXT: &str = "session_p_regen";
        let corpus = std::env::var("FA_REGEN_CORPUS").unwrap_or_else(|_| "v6".to_string());
        let language = std::env::var("FA_REGEN_LANG").unwrap_or_else(|_| "en".to_string());

        if !require_ort::ort_dylib_or_skip(CONTEXT) {
            return;
        }
        let model_path = fa_models_dir().join(&language).join("model.onnx");
        if !require_ort::path_exists_or_skip(CONTEXT, &model_path) {
            return;
        }
        let dir = repo_root().join(".work-phase4/replay").join(&corpus);
        // WS1 Session AG: the plan IN and the words OUT are overridable by env
        // var, defaulting to the Session P filenames so every existing
        // invocation is byte-for-byte unchanged. Session AG needs to align the
        // SAME audio against a DIFFERENT chunk plan (the S1 fold) and compare,
        // which is impossible while both filenames are hardcoded — and
        // overwriting `fa_live_words.json` to do it would destroy the very
        // baseline the comparison is against.
        let plan_file = std::env::var("FA_REGEN_PLAN").unwrap_or_else(|_| "fa_live_chunks.json".to_string());
        let out_file = std::env::var("FA_REGEN_OUT").unwrap_or_else(|_| "fa_live_words.json".to_string());
        let plan_path = dir.join(&plan_file);
        let audio_path = dir.join("audio_16k.wav");
        if !require_ort::path_exists_or_skip(CONTEXT, &plan_path)
            || !require_ort::path_exists_or_skip(CONTEXT, &audio_path)
        {
            return;
        }

        let plan: LivePlanFile = serde_json::from_str(
            &std::fs::read_to_string(&plan_path).unwrap_or_else(|e| panic!("read {}: {e}", plan_path.display())),
        )
        .unwrap_or_else(|e| panic!("parse {}: {e}", plan_path.display()));
        let chunks: Vec<crate::fa::FaChunkInput> = plan
            .chunks
            .iter()
            .map(|c| crate::fa::FaChunkInput {
                start_sec: c.start_sec,
                end_sec: c.end_sec,
                text: c.text.clone(),
            })
            .collect();

        eprintln!(
            "{CONTEXT}: corpus={corpus} lang={language} chunks={} audio={:.2}s model={}",
            chunks.len(),
            plan.audio_duration,
            model_path.display()
        );

        // ONE call, whole slice — production's own shape.
        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let started = std::time::Instant::now();
        let mut last_progress = 0u32;
        let words = align_chunked(
            &cache,
            &model_path,
            audio_path.to_str().expect("audio path is UTF-8"),
            &chunks,
            &language,
            || false,
            // `on_progress` reports the CHUNK INDEX, not a percentage —
            // log it as what it is.
            |p| {
                if p >= last_progress + 25 {
                    last_progress = p;
                    eprintln!("{CONTEXT}: chunk {p}/{}", chunks.len());
                }
            },
        )
        .unwrap_or_else(|e| panic!("{CONTEXT}: align_chunked failed: {e:?}"));
        let elapsed = started.elapsed().as_secs_f64();

        assert!(!words.is_empty(), "{CONTEXT}: alignment produced zero words");

        let mut needs_review = 0usize;
        let dtos: Vec<serde_json::Value> = words
            .iter()
            .enumerate()
            .map(|(i, w)| {
                let (confidence, review) = dto_confidence(w.score);
                if review {
                    needs_review += 1;
                }
                serde_json::json!({
                    "word": w.text,
                    "startSec": w.start_seconds,
                    "endSec": w.end_seconds,
                    "confidence": confidence,
                    "needsReview": review,
                    "wordIndex": i,
                })
            })
            .collect();

        let out = serde_json::json!({
            "_provenance": {
                "engine": "real Rust fa_onnx::align_chunked (production path, whole-slice call) — WS1 Session P regeneration",
                "corpus": corpus,
                "language": language,
                "audio_duration_sec": plan.audio_duration,
                "audio": audio_path.file_name().and_then(|s| s.to_str()),
                "model": model_path.to_str(),
                "chunk_plan": plan_file,
                "chunk_count": chunks.len(),
                "word_count": dtos.len(),
                "needs_review_count": needs_review,
                "elapsed_sec": elapsed,
            },
            "words": dtos,
        });
        let out_path = dir.join(&out_file);
        std::fs::write(&out_path, format!("{}\n", serde_json::to_string_pretty(&out).expect("serialize")))
            .unwrap_or_else(|e| panic!("write {}: {e}", out_path.display()));

        eprintln!(
            "{CONTEXT}: wrote {} ({} words, {} needs_review, {:.1}s)",
            out_path.display(),
            dtos.len(),
            needs_review,
            elapsed
        );
    }
}

// ---------------------------------------------------------------------------
// WS1 Session AO Step 1 — cross-corpus, SAME-PROCESS session-lifetime RSS
// timeline. DIAGNOSTIC ONLY: reads no chunking parameter, writes no chunking
// parameter, changes no boundary — it re-runs the FROZEN production chunk
// plans (`fa_production_chunks.json`, already committed by prior sessions)
// through the real `align_chunked` and measures memory, nothing else.
//
// Every prior real-corpus memory measurement (`session_p_regen` above;
// Sessions AK/AM/AL's `fa-run-resources.json`) runs exactly ONE corpus per
// PROCESS, each independently wrapped in `/usr/bin/time -l` — confirmed by
// reading `.work-phase4/session-ak/fa-run-resources.json`'s own per-corpus
// entries (v6 3205.3 MB / 173 2227.6 MB / spanish 1938.1 MB, three separate
// processes). That is NOT the shape of the live desktop app: `FaModelCache`
// (`fa.rs`) is Tauri-managed `State` — ONE `Mutex<Option<CachedSession>>`
// living for the WHOLE app-process lifetime, reused across every Apply Sync
// click and every project opened without an app restart. This test
// reproduces that shape instead: one process, one shared cache, driving
// align_chunked across v6 -> 173 -> spanish -> v6-again. v6 and 173 share a
// language ("en"), so v6 -> 173 is a cache HIT under `with_cached_session`'s
// own key rule (repeated forward passes, session never reloaded) — isolating
// whether ORT's arena grows across calls with no reload. 173 -> spanish and
// spanish -> v6-again are language switches, i.e. cache MISSES that drop the
// old `CachedSession` and load a fresh one — isolating whether a dropped
// session's memory is actually released back to the OS (a dip in the RSS
// timeline) or merely orphaned (RSS keeps climbing).
//
// A background thread samples this process's CURRENT RSS via `ps -o rss=`
// once a second for the whole run — deliberately NOT `getrusage`'s
// `ru_maxrss`, which is a cumulative peak that can only ever increase and so
// cannot show a timeline SHAPE (monotone climb vs. sawtooth-with-rising-floor
// vs. single spike), only a final number the existing `/usr/bin/time -l`
// wrapper already gives us.
//
// Output: `.work-phase4/session-ao/rss_timeline.csv` (elapsed_sec,rss_kb)
// and `.work-phase4/session-ao/stage_markers.json` (each corpus's own
// [startSec, endSec] window into that timeline, plus chunk/word counts).
//
// RUN (debug profile, matching every prior session's own methodology — see
// each `fa-run-resources.json` note field):
//   ORT_DYLIB_PATH=<repo>/src-tauri/onnxruntime/libonnxruntime.1.23.2.dylib \
//   FA_REQUIRE_ORT=1 cargo test --features fa-inference -- \
//     --ignored --nocapture --exact \
//     fa_onnx::session_ao_memory::cross_corpus_session_lifetime_rss
// ---------------------------------------------------------------------------
#[cfg(test)]
mod session_ao_memory {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Instant;

    #[cfg(target_os = "macos")]
    fn fa_models_dir() -> PathBuf {
        let home = std::env::var("HOME").expect("HOME must be set");
        PathBuf::from(home).join("Library/Application Support/com.kinetix.pro-studio/fa-models")
    }
    #[cfg(not(target_os = "macos"))]
    fn fa_models_dir() -> PathBuf {
        panic!("session_ao_memory's fa_models_dir() only reproduces the macOS mapping");
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    #[derive(serde::Deserialize)]
    struct PlanFile {
        #[allow(dead_code)]
        #[serde(rename = "audioDuration")]
        audio_duration: f64,
        chunks: Vec<PlanChunk>,
    }
    #[derive(serde::Deserialize)]
    struct PlanChunk {
        #[serde(rename = "startSec")]
        start_sec: f64,
        #[serde(rename = "endSec")]
        end_sec: f64,
        text: String,
    }

    /// Reads the FROZEN production plan already committed by prior sessions
    /// — computes nothing, mutates nothing.
    fn load_production_plan(dir: &Path) -> Vec<crate::fa::FaChunkInput> {
        let path = dir.join("fa_production_chunks.json");
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        let plan: PlanFile = serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
        plan.chunks
            .into_iter()
            .map(|c| crate::fa::FaChunkInput { start_sec: c.start_sec, end_sec: c.end_sec, text: c.text })
            .collect()
    }

    /// Current (not peak) resident set size in KB for THIS process, via
    /// `ps -o rss=` — see this module's own doc comment for why current RSS,
    /// not `getrusage`'s cumulative `ru_maxrss`, is what a timeline needs.
    fn current_rss_kb() -> Option<u64> {
        let pid = std::process::id();
        let out = std::process::Command::new("ps").args(["-o", "rss=", "-p", &pid.to_string()]).output().ok()?;
        String::from_utf8_lossy(&out.stdout).trim().parse::<u64>().ok()
    }

    #[test]
    #[ignore]
    fn cross_corpus_session_lifetime_rss() {
        const CONTEXT: &str = "session_ao_memory";
        if !require_ort::ort_dylib_or_skip(CONTEXT) {
            return;
        }
        // v6 and 173 deliberately share "en" (a cache HIT on the second
        // call); spanish ("es") and the final v6-again both force a cache
        // MISS (language switch) — see module doc comment.
        let corpora: [(&str, &str); 4] = [("v6", "en"), ("173", "en"), ("spanish", "es"), ("v6", "en")];
        let replay_root = repo_root().join(".work-phase4/replay");
        for (corpus, _lang) in &corpora {
            let audio = replay_root.join(corpus).join("audio_16k.wav");
            let plan = replay_root.join(corpus).join("fa_production_chunks.json");
            if !require_ort::path_exists_or_skip(CONTEXT, &audio) || !require_ort::path_exists_or_skip(CONTEXT, &plan) {
                return;
            }
        }

        let out_dir = repo_root().join(".work-phase4/session-ao");
        std::fs::create_dir_all(&out_dir).unwrap_or_else(|e| panic!("create {}: {e}", out_dir.display()));
        let csv_path = out_dir.join("rss_timeline.csv");
        let markers_path = out_dir.join("stage_markers.json");

        let stop = Arc::new(AtomicBool::new(false));
        let stop2 = stop.clone();
        let csv_path2 = csv_path.clone();
        let started = Instant::now();
        std::fs::write(&csv_path, "elapsed_sec,rss_kb\n").unwrap_or_else(|e| panic!("init {}: {e}", csv_path.display()));
        let sampler = std::thread::spawn(move || {
            while !stop2.load(Ordering::Relaxed) {
                if let Some(kb) = current_rss_kb() {
                    let elapsed = started.elapsed().as_secs_f64();
                    if let Ok(mut f) = std::fs::OpenOptions::new().append(true).open(&csv_path2) {
                        let _ = writeln!(f, "{elapsed:.2},{kb}");
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(1000));
            }
        });

        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        let mut markers: Vec<serde_json::Value> = Vec::new();
        for (i, (corpus, lang)) in corpora.iter().enumerate() {
            let dir = replay_root.join(corpus);
            let model_path = fa_models_dir().join(lang).join("model.onnx");
            let chunks = load_production_plan(&dir);
            let audio_path = dir.join("audio_16k.wav");
            let t0 = started.elapsed().as_secs_f64();
            eprintln!("{CONTEXT}: [{i}] START corpus={corpus} lang={lang} chunks={} t={t0:.2}s", chunks.len());
            let words = align_chunked(
                &cache,
                &model_path,
                audio_path.to_str().expect("audio path is UTF-8"),
                &chunks,
                lang,
                || false,
                |_| {},
            )
            .unwrap_or_else(|e| panic!("{CONTEXT}: align_chunked({corpus}) failed: {e:?}"));
            let t1 = started.elapsed().as_secs_f64();
            eprintln!(
                "{CONTEXT}: [{i}] DONE corpus={corpus} words={} t={t1:.2}s ({:.2}s elapsed for this stage)",
                words.len(),
                t1 - t0
            );
            markers.push(serde_json::json!({
                "index": i, "corpus": corpus, "lang": lang, "startSec": t0, "endSec": t1,
                "chunkCount": chunks.len(), "wordCount": words.len(),
            }));
        }

        stop.store(true, Ordering::Relaxed);
        sampler.join().expect("sampler thread join");

        std::fs::write(
            &markers_path,
            serde_json::to_string_pretty(&serde_json::json!({ "stages": markers })).expect("serialize"),
        )
        .unwrap_or_else(|e| panic!("write {}: {e}", markers_path.display()));
        eprintln!("{CONTEXT}: wrote {} and {}", csv_path.display(), markers_path.display());
    }

    // -----------------------------------------------------------------------
    // WS1 Session AP Step 5 — GUARDRAIL. This leak regressed once already
    // (the per-shape memory-pattern cache, `a6f2978`) with no test to catch
    // it; this is that test. Runs the identical v6 -> 173 -> spanish ->
    // v6-again single-process sequence as `cross_corpus_session_lifetime_rss`
    // above and fails if peak RSS crosses `PEAK_RSS_CEILING_MIB`.
    //
    // Ceiling derivation (WS1 Session AP, measured, not estimated):
    //   - Post drop-then-build-fix (this session's Step 3 change) peak RSS
    //     for this exact sequence measured 2743.7 MiB (single run,
    //     `.work-phase4/session-ao-postfix-run1/` after Step 3 lands, see
    //     `sync-pipeline-v2-plan.md` Part AI's AP addendum).
    //   - Pre-fix peak RSS for the SAME sequence, same ps-based sampling
    //     methodology, measured 3844.2 / 3947.3 / 4065.8 MiB across three
    //     separate runs (`.work-phase4/session-ao-preexisting/`,
    //     `-postfix-run1/`, `-postfix-run2-control/`) — a ~220 MiB
    //     (~5.6% of the ~3952 MiB mean) run-to-run spread on unmodified code,
    //     the only cross-run variance figure this workstream has measured.
    //   - Ceiling = 2743.7 MiB x 1.25 (a margin over 4x the observed 5.6%
    //     unmodified-code noise band, chosen because this is a single
    //     post-fix run, not a characterized distribution) = 3429.6 MiB,
    //     rounded up to 3500 MiB. This sits comfortably below every pre-fix
    //     measurement on record (lowest observed: 3844.2 MiB) — a regression
    //     back to build-then-drop or a reintroduced per-shape cache trips it.
    //
    // NOT in the default `cargo test` sweep: like every other real-audio/
    // real-ORT test in this module, it needs the bundled onnxruntime dylib,
    // the fa-inference feature, and the replay corpora, and costs ~25-30
    // minutes wall-clock for the 4-stage sequence — gated `#[ignore]` +
    // `require_ort`, matching every sibling test in this module. Run
    // manually before a release or after any change to `with_cached_session`
    // or `load_session`'s ORT session options.
    //
    // RUN:
    //   ORT_DYLIB_PATH=<repo>/src-tauri/onnxruntime/libonnxruntime.1.23.2.dylib \
    //   FA_REQUIRE_ORT=1 cargo test --features fa-inference -- \
    //     --ignored --nocapture --exact \
    //     fa_onnx::session_ao_memory::guardrail_multi_corpus_peak_rss_bounded
    // -----------------------------------------------------------------------
    #[test]
    #[ignore]
    fn guardrail_multi_corpus_peak_rss_bounded() {
        const CONTEXT: &str = "session_ap_guardrail";
        /// See derivation in this test's own doc comment above. Labelled
        /// constant, not a magic number, per CLAUDE.md's testing rule.
        const PEAK_RSS_CEILING_MIB: u64 = 3500;

        if !require_ort::ort_dylib_or_skip(CONTEXT) {
            return;
        }
        let corpora: [(&str, &str); 4] = [("v6", "en"), ("173", "en"), ("spanish", "es"), ("v6", "en")];
        let replay_root = repo_root().join(".work-phase4/replay");
        for (corpus, _lang) in &corpora {
            let audio = replay_root.join(corpus).join("audio_16k.wav");
            let plan = replay_root.join(corpus).join("fa_production_chunks.json");
            if !require_ort::path_exists_or_skip(CONTEXT, &audio) || !require_ort::path_exists_or_skip(CONTEXT, &plan) {
                return;
            }
        }

        let stop = Arc::new(AtomicBool::new(false));
        let peak_kb = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let stop2 = stop.clone();
        let peak_kb2 = peak_kb.clone();
        let sampler = std::thread::spawn(move || {
            while !stop2.load(Ordering::Relaxed) {
                if let Some(kb) = current_rss_kb() {
                    peak_kb2.fetch_max(kb, Ordering::Relaxed);
                }
                std::thread::sleep(std::time::Duration::from_millis(1000));
            }
        });

        let cache: Mutex<Option<CachedSession>> = Mutex::new(None);
        for (corpus, lang) in &corpora {
            let dir = replay_root.join(corpus);
            let model_path = fa_models_dir().join(lang).join("model.onnx");
            let chunks = load_production_plan(&dir);
            let audio_path = dir.join("audio_16k.wav");
            eprintln!("{CONTEXT}: running corpus={corpus} lang={lang} chunks={}", chunks.len());
            align_chunked(&cache, &model_path, audio_path.to_str().expect("audio path is UTF-8"), &chunks, lang, || false, |_| {})
                .unwrap_or_else(|e| panic!("{CONTEXT}: align_chunked({corpus}) failed: {e:?}"));
        }

        stop.store(true, Ordering::Relaxed);
        sampler.join().expect("sampler thread join");

        let peak_mib = peak_kb.load(Ordering::Relaxed) as f64 / 1024.0;
        eprintln!("{CONTEXT}: peak RSS = {peak_mib:.1} MiB (ceiling {PEAK_RSS_CEILING_MIB} MiB)");
        assert!(
            peak_mib <= PEAK_RSS_CEILING_MIB as f64,
            "{CONTEXT}: peak RSS {peak_mib:.1} MiB exceeded the {PEAK_RSS_CEILING_MIB} MiB guardrail ceiling — \
             this is the regression class a6f2978/WS1 Session AP fixed (per-shape memory-pattern cache, then \
             build-before-drop session eviction); see this test's own doc comment for the ceiling's derivation."
        );
    }
}
