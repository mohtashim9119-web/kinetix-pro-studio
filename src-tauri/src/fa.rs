use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::Manager;

pub mod text;

// ---------------------------------------------------------------------------
// Forced-alignment (FA) command surface (WS1 Task 5 boundary, R-D).
//
// Establishes the IPC command surface, cancellation, and progress-event shape
// a native inference engine drops into. With the `fa-inference` Cargo feature
// OFF (still the default in every build), `fa_align` always returns a typed
// not-implemented error and no ML dependency enters the build graph — that
// part of this comment's original claim is unchanged. With `fa-inference` ON,
// this has carried a real ONNX forward pass + Viterbi alignment since Slice
// D2 (`49e233a`) — see `fa_onnx.rs` and `docs/ws1-sync-pipeline/
// task5-slice-ledger.md` for the full slice-by-slice record. Still not wired
// into Apply Sync: the only caller of `fa_align` anywhere in `src/` is the
// DEV-only `fa_align_dev` (`fa_dev.rs`) reached via `window.__faDevAlign`
// (Slice D10) — production wiring (a capability-gated Settings toggle) is a
// later, separately-scoped slice per that same ledger's rulings.
//
// Deliberately mirrors three established patterns from `whisper.rs` rather
// than inventing parallel ones (see that file for line numbers as of
// `fc0e756`/this task's own read):
//   1. WhisperState's cancellation mutex (`whisper.rs:15-25`, used at
//      `whisper.rs:188-193`/`310-313`/`390-393` and in `whisper_cancel`,
//      `whisper.rs:432-441`) — a `Mutex`-guarded field toggled by the
//      long-running command and read/cleared by a separate cancel command.
//      FA has no child process to hold (no sidecar, no model) so the guarded
//      value is a run-state enum (`FaRunState`) rather than
//      `Option<CommandChild>` — same shape, different payload, because there
//      is genuinely nothing to kill yet.
//   2. The `Channel<FaEvent>` progress shape (`whisper.rs:39-50`'s
//      `WhisperEvent`, taken as an `on_event: Channel<WhisperEvent>` param at
//      `whisper.rs:185`, sent via `on_event.send(...)` at e.g.
//      `whisper.rs:252/342/400`) — `#[serde(tag = "event", content = "data")]`
//      with `Progress`/`Done`/`Error` variants.
//   3. `model_path()`'s resolution ladder (`whisper.rs:64-112`) — try a
//      preferred managed location first, fall back to a manual-placement
//      location, return a descriptive `Err` naming exactly where to put the
//      file if neither exists. FA's ladder swaps whisper's
//      bundled-`resource_dir()` tier for `app_local_data_dir()` per ruling
//      R-D ("Task 5 itself resolves FA models via `app_local_data_dir` with a
//      manual-placement fallback" — `project-state.md` §5) and never touches
//      `src-tauri/models/` (that's the whisper model's bundle-glob location,
//      `tauri.conf.json`'s `resources` map, untouched by this file).
//
// The serde camelCase convention (`whisper.rs:32`'s
// `#[serde(rename_all = "camelCase")]` on `TranscriptToken`) is followed on
// every multi-word-field struct below (`FaChunkInput`, `FaError`) — applied
// per-struct/per-variant rather than at the `FaEvent` enum's own top level,
// so variant tag names stay PascalCase (`"Progress"`/`"Done"`/`"Error"`,
// matching `WhisperEvent`'s tags) while field names inside each variant's
// payload are camelCase.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaRunState {
    Idle,
    Running,
    Cancelled,
}

pub struct FaState(pub Mutex<FaRunState>);

impl Default for FaState {
    fn default() -> Self {
        FaState(Mutex::new(FaRunState::Idle))
    }
}

/// Session-scoped ONNX model cache (WS1 Task 5 Slice D11) — see
/// `fa_onnx.rs`'s "Session cache" section for the full design rationale
/// (key, staleness argument, eviction). Managed as Tauri `State` (`lib.rs`)
/// alongside `FaState`, so it lives for the app process's lifetime and is
/// shared across every `fa_align`/`fa_align_dev` call in one session.
///
/// The slot type is feature-conditional (`FaModelCacheSlot`) because the
/// cached value itself — `fa_onnx::CachedSession`, which holds a real
/// `ort::Session` — only exists when the `fa-inference` feature (and thus
/// the optional `ort` crate) is compiled in. With the feature OFF, the slot
/// is `()`: `FaModelCache` still exists and is still manageable as `State`
/// (so `fa_align`'s signature and `lib.rs`'s `.manage()` call need no
/// `#[cfg(...)]` of their own), it simply holds nothing.
#[cfg(feature = "fa-inference")]
pub(crate) type FaModelCacheSlot = Option<crate::fa_onnx::CachedSession>;
#[cfg(not(feature = "fa-inference"))]
pub(crate) type FaModelCacheSlot = ();

// Under `fa-inference` OFF, the not-implemented arm of `fa_align` never
// touches `model_cache` at all (there is no session to cache), so the field
// is only ever default-constructed and stored, never read, in that config.
#[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
pub struct FaModelCache(pub Mutex<FaModelCacheSlot>);

impl Default for FaModelCache {
    fn default() -> Self {
        FaModelCache(Mutex::new(Default::default()))
    }
}

/// Unconditionally moves the state to `Running`, mirroring `whisper_transcribe`'s
/// own "kill any previously running job, then start" permissiveness
/// (`whisper.rs:188-193`) rather than rejecting a concurrent start.
fn start_run(state: &FaState) -> Result<(), FaError> {
    let mut lock = state.0.lock().map_err(|_| FaError::state_lock_poisoned())?;
    *lock = FaRunState::Running;
    Ok(())
}

/// Mirrors `whisper_cancel` (`whisper.rs:432-441`): a no-op, not an error, if
/// nothing is running — cancelling only has an effect on a `Running` state.
fn cancel_run(state: &FaState) -> Result<(), FaError> {
    let mut lock = state.0.lock().map_err(|_| FaError::state_lock_poisoned())?;
    if *lock == FaRunState::Running {
        *lock = FaRunState::Cancelled;
    }
    Ok(())
}

/// Returns the state to `Idle` once a run concludes for any reason (error,
/// done, or was cancelled mid-run) — `Cancelled` is a transient signal a
/// running job would have checked, not a resting state.
fn finish_run(state: &FaState) -> Result<(), FaError> {
    let mut lock = state.0.lock().map_err(|_| FaError::state_lock_poisoned())?;
    *lock = FaRunState::Idle;
    Ok(())
}

/// The cancellation-poll predicate `align_chunked` (`fa_onnx.rs`, WS1 Task 5
/// Slice D11) checks at every chunk boundary — `true` iff `fa_cancel` has
/// flipped this run's state to `Cancelled` since it started. A poisoned lock
/// reads as "not cancelled" (recovers the poisoned guard rather than
/// propagating — matches this module's existing poison-tolerance elsewhere,
/// e.g. `fa_onnx.rs`'s `with_ort_env_lock`) rather than aborting a run over
/// an unrelated panic on another thread.
#[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
fn is_cancelled(state: &FaState) -> bool {
    let lock = state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *lock == FaRunState::Cancelled
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FaErrorKind {
    // Only constructed by the `#[cfg(not(feature = "fa-inference"))]` arm of
    // `fa_align` (plus tests, which run in both configurations) — genuinely
    // dead in a plain, non-test `fa-inference`-on build.
    #[cfg_attr(feature = "fa-inference", allow(dead_code))]
    NotImplemented,
    // Reachable via `fa_model_path`/`no_model_found_error` below, and (with
    // `fa-inference` on) genuinely returned by `fa_align` when no
    // `model.onnx` exists for the requested language.
    #[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
    ModelNotFound,
    StateLockPoisoned,
    // Only constructed by the `fa-inference`-gated real implementation
    // (`fa_onnx.rs`) — WAV-decode failure, ort session/inference failure, or
    // an empty/unusable tokenization of the requested segments' text.
    #[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
    InferenceFailed,
    // Constructed only by `fa_dev.rs`'s pre-use manifest check (WS1 Task 5
    // Slice D10) — a resolved `model.onnx` whose SHA-256 doesn't match
    // `scripts/fixtures/fa-onnx-manifest.json`'s committed hash for that
    // language, or has no manifest entry at all. `fa_dev` is unconditionally
    // compiled (unlike `fa_onnx.rs`), so this variant is never `dead_code`.
    ModelHashMismatch,
    // WS1 Task 5 Slice D11: `fa_cancel` flipped `FaState` to `Cancelled`
    // while a chunked alignment run was mid-loop. The run stops before the
    // next chunk starts and returns this — never `Ok`, never a partial
    // `Done` — so a cancelled run can never be mistaken for a completed one.
    #[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
    Cancelled,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FaError {
    pub kind: FaErrorKind,
    pub message: String,
}

impl std::fmt::Display for FaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl FaError {
    #[cfg_attr(feature = "fa-inference", allow(dead_code))]
    fn not_implemented(message: impl Into<String>) -> Self {
        FaError { kind: FaErrorKind::NotImplemented, message: message.into() }
    }
    #[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
    fn model_not_found(message: impl Into<String>) -> Self {
        FaError { kind: FaErrorKind::ModelNotFound, message: message.into() }
    }
    fn state_lock_poisoned() -> Self {
        FaError {
            kind: FaErrorKind::StateLockPoisoned,
            message: "FA state lock poisoned".to_string(),
        }
    }
    #[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
    pub(crate) fn inference_failed(message: impl Into<String>) -> Self {
        FaError { kind: FaErrorKind::InferenceFailed, message: message.into() }
    }
    #[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
    pub(crate) fn cancelled(message: impl Into<String>) -> Self {
        FaError { kind: FaErrorKind::Cancelled, message: message.into() }
    }
}

// ---------------------------------------------------------------------------
// IPC event + input types
// ---------------------------------------------------------------------------

/// One forced-alignment CHUNK: an audio time window (raw, unpadded — R.2
/// padding is out of scope for WS1 Task 5 Slice D11) and the script text to
/// align against it. Mirrors `src/services/faChunkPlan.ts`'s `FaChunk`.
/// Replaces the pre-D11 `FaSegmentInput` (single segment id/text pair, no
/// time window, implicitly aligned against the WHOLE audio file in one
/// pass) — D10 proved that whole-file pass infeasible at production audio
/// length, making per-chunk windowing (not per-segment identity) the unit
/// `fa_align` now operates on.
#[derive(serde::Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FaChunkInput {
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
}

/// One word-level alignment result, crossing the IPC boundary as
/// `FaEvent::Done`'s payload (WS1 Task 5 Slice D9). Mirrors
/// `fa_onnx::WordSpan` field-for-field except `confidence`: `WordSpan.score`
/// is a mean LOG-probability (<= 0, unbounded below); `confidence` is
/// `exp(score)`, the geometric mean of the per-frame probabilities, in
/// [0,1] and therefore directly comparable to `syncConstants.ts`'s
/// `CONF_MIN` — the exponentiation is applied once, here, at the boundary,
/// so nothing downstream needs to know `WordSpan` ever carried a log-prob.
///
/// `word_index` (WS1 Task 5 Slice D18): the word's 0-based position in the
/// FULL, chunk-stitched output — the same order `align_chunked`'s `all_words`
/// already accumulates in (chunk order, then within-chunk text order), so it
/// is assigned once, after every chunk has been merged, never reset per
/// chunk. This is the intended join key back to the script's own word
/// sequence (`faAnchors.ts`'s `FaAnchor.qi` space / `faChunkPlan.ts`'s
/// `queryWords`) — a persisted word timing's TIME is not a reliable join key
/// (see `docs/ws1-sync-pipeline/d18-index-trace-2026-08-14.md`'s Step 1
/// trace for why: neither `FaWordSpan` nor `TranscriptToken` carried any
/// index before this slice, even though the order was always available —
/// it was simply discarded at this exact DTO boundary).
///
/// `needs_review` (WS1 Task 5 Slice D19, R.7): `true` when `confidence <
/// CONF_MIN`. The word's own `start_sec`/`end_sec` are never dropped or
/// overwritten when this fires — this DTO carries no Whisper timing to fall
/// back to in the first place (`fa_align`'s only inputs are `audio_path`,
/// `chunks: Vec<FaChunkInput>`, `language` — no per-word Whisper anchor
/// crosses this IPC boundary), so the only signal a consumer gets is this
/// flag, mirroring the existing `HeadingOverlay.needsReview` convention
/// (`src/types.ts`) rather than inventing a new shape. See
/// `docs/ws1-sync-pipeline/d19-r7-fallback-2026-08-14.md` for the full
/// three-option design writeup.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FaWordSpan {
    pub word: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub confidence: f32,
    pub needs_review: bool,
    pub word_index: u32,
}

/// Mirrors `syncConstants.ts`'s `CONF_MIN = 0.3` (TS file itself is off
/// limits to this slice) — the floor `needs_review` compares `confidence`
/// against. Kept as a Rust-side literal rather than read across the IPC
/// boundary because `word_span_to_dto` runs entirely on the Rust side, with
/// no TS runtime in scope at the point this decision is made.
#[cfg(feature = "fa-inference")]
const CONF_MIN: f32 = 0.3;

/// The IPC-boundary conversion this module's doc comment on [`FaWordSpan`]
/// describes: `exp(score)` turns a mean log-probability into a probability,
/// and that same probability is compared against [`CONF_MIN`] to set
/// `needs_review`. `word_index` is threaded through as an explicit parameter
/// (not derived here) because a single `WordSpan` carries no positional
/// information of its own — only its caller, iterating the stitched
/// `Vec<WordSpan>`, knows where it sits. Pulled out as its own function
/// (rather than inlined in `fa_align`'s match arm) so it has a direct
/// unit-test target — see the `fa_word_span_*` tests below.
#[cfg(feature = "fa-inference")]
fn word_span_to_dto(w: crate::fa_onnx::WordSpan, word_index: u32) -> FaWordSpan {
    let confidence = w.score.exp();
    FaWordSpan {
        word: w.text,
        start_sec: w.start_seconds,
        end_sec: w.end_seconds,
        confidence,
        needs_review: confidence < CONF_MIN,
        word_index,
    }
}

/// Converts the FULL, already chunk-stitched `Vec<WordSpan>` `align_chunked`
/// returns into `Vec<FaWordSpan>` DTOs, assigning each word its `word_index`
/// by its position in THIS vec — i.e. across the whole run, not per chunk.
/// This is the exact point WS1 Task 5 Slice D18's index trace found the
/// script-word index was being discarded (the word order was always
/// available here; nothing carried it forward). Pulled out of `fa_align`'s
/// Ok arm so it has a direct unit-test target that needs no live model/
/// AppHandle — see the `word_spans_to_dtos_*` tests below.
#[cfg(feature = "fa-inference")]
fn word_spans_to_dtos(word_spans: Vec<crate::fa_onnx::WordSpan>) -> Vec<FaWordSpan> {
    word_spans
        .into_iter()
        .enumerate()
        .map(|(i, w)| word_span_to_dto(w, i as u32))
        .collect()
}

/// Maps `fa_onnx::align`'s error into the `FaError` `fa_align` rejects its
/// promise with (WS1 Task 5 Slice D10 fix). A `ModelNotFound` failure must
/// reach the frontend as `FaErrorKind::ModelNotFound`, not flattened into
/// `InferenceFailed` — the underlying `FaError` already carries the right
/// kind and a fully formed message (`no_model_found_error`, above), so it is
/// forwarded as-is rather than re-wrapped. Every other `FaOnnxError` variant
/// (WAV decode, ort init/session/run, empty tokenization, unsupported
/// language, Viterbi failure) has no more specific `FaErrorKind` of its own
/// and still maps to `InferenceFailed`, unchanged from pre-D10 behavior.
/// Pulled out as its own function (rather than inlined in `fa_align`'s match
/// arm) so it has a direct unit-test target, mirroring `word_span_to_dto`'s
/// own rationale above.
#[cfg(feature = "fa-inference")]
fn fa_onnx_error_to_fa_error(e: crate::fa_onnx::FaOnnxError) -> FaError {
    match e {
        crate::fa_onnx::FaOnnxError::ModelNotFound(fa_error) => fa_error,
        // WS1 Task 5 Slice D11: same "forward the specific kind, don't
        // flatten" rule the D10 fix above established for ModelNotFound —
        // a cancelled run must reach the frontend as FaErrorKind::Cancelled,
        // never generic InferenceFailed, so a caller can distinguish "the
        // user cancelled" from "alignment genuinely failed."
        crate::fa_onnx::FaOnnxError::Cancelled => FaError::cancelled("forced alignment was cancelled"),
        other => FaError::inference_failed(other.to_string()),
    }
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(tag = "event", content = "data")]
pub enum FaEvent {
    /// Sent once per completed chunk (WS1 Task 5 Slice D11) — `index` is the
    /// 0-based count of chunks FINISHED so far (never sent for chunk 0
    /// before its own forward pass + Viterbi + merge complete), `total` is
    /// the fixed chunk count for this run. `index == total` after the last
    /// chunk, immediately before `Done`. Deliberately `index`/`total`
    /// (integers), not a pre-divided `percent` — the frontend can derive a
    /// percentage trivially and integers avoid a rounding-boundary
    /// (`floor` vs `round`) argument neither side needs to have. Genuinely
    /// constructed (not dead) under `fa-inference` ON — the not-implemented
    /// arm under `fa-inference` OFF errors before any chunk loop exists, so
    /// this variant is allowed dead there only, not unconditionally (WS1
    /// Task 5 Slice D11 — previously an unconditional `#[allow(dead_code)]`
    /// left over from before any real chunk loop existed).
    #[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
    Progress { index: u32, total: u32 },
    /// Real per-word alignment output (WS1 Task 5 Slice D9), sent once by
    /// the `fa-inference`-gated real implementation below on a successful
    /// `fa_onnx::align` call. The feature-off `not_implemented` path never
    /// sends `Done` — it errors first — so this variant stays theoretically
    /// dead in that configuration, same reason `Progress` above does.
    #[allow(dead_code)]
    Done { words: Vec<FaWordSpan> },
    Error { message: String },
}

// ---------------------------------------------------------------------------
// Model path resolver
// ---------------------------------------------------------------------------

// Format resolved as of WS1 Task 5 Slice D2: ONNX, exported per-language by
// `scripts/export-fa-onnx.py` into this same `fa-models/<lang>/` convention
// (ruling superseding the earlier "format unresolved" placeholder note —
// see docs/ws1-sync-pipeline/measurements/runtime-unblock-2026-08-12.md).
#[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
const FA_MODEL_FILENAME: &str = "model.onnx";

/// Pure candidate-path builder — no filesystem access, no `AppHandle`, so it
/// is directly unit-testable. Order matters: the managed location (R-D: FA
/// models resolve via `app_local_data_dir`) is preferred; the manual-
/// placement location is the fallback for a model dropped in by hand before
/// Step T's on-demand downloader exists (R-D keeps Step T out of this task).
/// Deliberately never includes anything under `src-tauri/models/` — that's
/// the whisper model's bundle-glob location (`tauri.conf.json`'s
/// `resources` map), untouched by this module. Called from `fa_align`'s
/// `fa-inference`-gated real implementation (`fa_onnx.rs`) via
/// [`fa_model_path`] below; still unused (and `dead_code`-allowed) when that
/// feature is off.
#[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
fn fa_model_candidate_paths(
    local_data_dir: Option<&Path>,
    exe_dir: Option<&Path>,
    language_code: &str,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = local_data_dir {
        candidates.push(dir.join("fa-models").join(language_code).join(FA_MODEL_FILENAME));
    }
    if let Some(dir) = exe_dir {
        candidates.push(dir.join("fa-models").join(language_code).join(FA_MODEL_FILENAME));
    }
    candidates
}

/// The first existing candidate, in preference order, or `None`.
#[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
fn resolve_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.exists()).cloned()
}

/// A useful, typed error naming every path tried, when none exists.
#[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
fn no_model_found_error(candidates: &[PathBuf], language_code: &str) -> FaError {
    let tried = candidates
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    FaError::model_not_found(format!(
        "No FA model found for language \"{language_code}\". Tried: {tried}. Place it manually \
         at one of those paths — the on-demand downloader (Step T) is a separate, later task \
         (ruling R-D). Never place it under src-tauri/models/ — that ships the whisper model via \
         the bundle's resources glob and FA models are not part of that glob."
    ))
}

#[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
pub(crate) fn fa_model_path(app: &tauri::AppHandle, language_code: &str) -> Result<PathBuf, FaError> {
    let local_data_dir = app.path().app_local_data_dir().ok();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()));

    let candidates = fa_model_candidate_paths(
        local_data_dir.as_deref(),
        exe_dir.as_deref(),
        language_code,
    );
    resolve_existing(&candidates).ok_or_else(|| no_model_found_error(&candidates, language_code))
}

// ---------------------------------------------------------------------------
// Durable transcoded-audio cache (WS1 Task 5 Slice D24 B1/B2) — UNWIRED, no
// production/script/test caller invokes [`ensure_durable_wav`] on any live
// path yet (`isFaGateOpen()` stays OFF regardless — this section changes no
// shipped behavior). Closes the ledger's own "Production audio path" gap
// (`docs/ws1-sync-pipeline/task5-slice-ledger.md` §6): `fa_align` takes a
// filesystem path to an already-16kHz-mono WAV and never transcodes
// anything itself (by design, its own doc comment above: "reuses whatever
// the caller already has on disk"), and the only thing in this codebase
// that PRODUCES such a WAV is `whisper.rs::transcode_to_wav` — its one
// production caller (`whisper_transcribe`) deletes that WAV
// (`fs::remove_dir_all`) the moment whisper-cli exits, a lifetime
// `fa_align` could never observe. `fa_align_dev` (`fa_dev.rs`) works around
// this today by making its OWN throwaway WAV per dev invocation; a future
// real Apply-Sync caller needs one that (a) survives past the call that
// requested it and (b) is reused across repeated FA runs against the SAME
// source media, rather than re-transcoding a multi-minute file every time —
// the same reload-cost shape D10/D11 already measured and fixed for the
// ONNX model itself via `CachedSession`.
//
// MECHANISM: a durable WAV cache under `app_local_data_dir()/fa-audio-
// cache/<key>.wav`, mirroring `fa_model_path`'s own `app_local_data_dir`
// resolution precedent (R-D) rather than inventing a second convention.
// Unlike `fa_model_path`'s ladder (a FIXED file the USER places by hand,
// with a manual-placement fallback tier), this cache is written BY the app
// itself — there is exactly one location, no fallback tier makes sense for
// output nothing external ever places.
//
// Every function below follows this file's own established "pure core,
// thin AppHandle-based wrapper" split (`fa_model_candidate_paths`/
// `resolve_existing` vs. `fa_model_path`) so the core cache-hit/miss/
// eviction logic is directly unit-testable without a live `AppHandle` or an
// async runtime — see the "durable WAV cache" test section below (B3).
// ---------------------------------------------------------------------------

/// Sibling of `fa-models` (see `fa_model_candidate_paths` above) under
/// `app_local_data_dir()` — never shared with it: a model the user places by
/// hand and a WAV the app derives from a source file are different
/// lifecycles (see this section's own doc comment).
const FA_AUDIO_CACHE_DIRNAME: &str = "fa-audio-cache";

/// Total on-disk budget for the durable WAV cache (WS1 Task 5 Slice D24 B2)
/// — see [`evict_lru_until_under_cap`]'s own doc comment for the eviction
/// policy this bounds. 2 GiB, by the same stated-order-of-magnitude
/// reasoning this codebase's other budget constants use rather than a
/// measured optimum: a 16kHz mono PCM WAV runs ~1.83 MiB/minute (16000
/// samples/s * 2 bytes/sample * 60s / 2^20), so 2 GiB covers roughly 18
/// hours of cached source audio — generous headroom for one active
/// project's repeated FA re-runs against the same source media, while
/// staying a small, bounded fraction of typical available disk.
#[cfg_attr(not(test), allow(dead_code))]
const FA_AUDIO_CACHE_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Pure path builder — no filesystem access — mirrors
/// `fa_model_candidate_paths`'s own split so this half is directly
/// unit-testable without a live `tauri::AppHandle`.
#[cfg_attr(not(test), allow(dead_code))]
fn fa_audio_cache_dir_from_local_data_dir(local_data_dir: &Path) -> PathBuf {
    local_data_dir.join(FA_AUDIO_CACHE_DIRNAME)
}

/// `AppHandle`-based wrapper — see the pure builder above for the tested
/// half, mirroring `fa_model_path`'s own split. Unconditionally (not
/// `cfg(test)`-gated) `allow(dead_code)`: unlike the pure functions below,
/// nothing calls this even in a test build (this codebase has no
/// `AppHandle` test-mocking precedent — see the "durable WAV cache" test
/// section's own header comment).
#[allow(dead_code)]
fn fa_audio_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, FaError> {
    let local_data_dir = app.path().app_local_data_dir().map_err(|e| {
        FaError::inference_failed(format!("cannot resolve app_local_data_dir for the FA audio cache: {e}"))
    })?;
    Ok(fa_audio_cache_dir_from_local_data_dir(&local_data_dir))
}

/// WS1 Task 5 Slice D24 B2 — the cache key. Deliberately mirrors this
/// codebase's OWN existing precedent for exactly this class of problem —
/// `syncEngine.ts`'s `getFileIdentity(file) = "${file.name}|${file.size}|
/// ${file.lastModified}"`, which `CLAUDE.md` records as a standing
/// invariant ("Transcription cache validity is keyed by file identity, not
/// asset id") — rather than a full content hash: this codebase already
/// decided that name+size+mtime is what "the same source media" means for
/// transcription-cache invalidation, and a multi-hundred-MiB source media
/// file is expensive to hash in full on every FA run, whereas a `stat()`
/// call is not.
///
/// STALE SOURCE (explicit answer, not silently resolved): if the source
/// file is edited in place (same path, different size/mtime), its identity
/// string changes, so it hashes to a DIFFERENT cache key — the old entry is
/// never looked up again under the new identity (silently orphaned, never
/// served stale or overwritten in place) rather than needing an explicit
/// invalidation step. [`evict_lru_until_under_cap`] is what eventually
/// reclaims an orphaned entry's disk space — this layer has no reverse
/// index from an old identity back to a project/asset, so it cannot safely
/// delete an orphan any sooner than the LRU cap does.
///
/// Hashed (not used as the literal filename) because the source filename
/// can contain characters that are not a safe/portable single path segment
/// on every target OS.
#[cfg_attr(not(test), allow(dead_code))]
fn source_identity_key(source_path: &Path) -> std::io::Result<String> {
    let meta = std::fs::metadata(source_path)?;
    let name = source_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let mtime_secs =
        meta.modified()?.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let identity = format!("{name}|{}|{mtime_secs}", meta.len());
    let mut hasher = crate::sha256::Sha256::new();
    hasher.update(identity.as_bytes());
    Ok(crate::sha256::hex_digest(&hasher.finish()))
}

/// WS1 Task 5 Slice D24 B2 — retention policy: least-recently-used
/// eviction, bounded by [`FA_AUDIO_CACHE_MAX_BYTES`], applied
/// opportunistically after every new cache WRITE (never on a cache HIT — a
/// hit only re-stamps the entry's own mtime, see [`resolve_cache_entry`]),
/// so a miss can never leave the directory unbounded even if nothing else
/// ever prunes it. "Least-recently-used" is the file's own mtime: a hit
/// re-stamps it, so an entry every FA run keeps touching survives, and one
/// nothing has looked up in a while — including an orphan left behind by a
/// changed source identity — ages toward eviction. Errors reading/removing
/// an individual entry are logged-and-skipped rather than aborting the
/// whole pass — best-effort cleanup, not a correctness-critical path (worst
/// case: the cache grows past its budget until the next successful pass,
/// never data loss or a wrong alignment result).
#[cfg_attr(not(test), allow(dead_code))]
fn evict_lru_until_under_cap(cache_dir: &Path, max_bytes: u64) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else { return };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total: u64 = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("wav") {
            continue; // skip .wav.tmp (in-progress writes) and anything else
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(mtime) = meta.modified() else { continue };
        total += meta.len();
        files.push((path, meta.len(), mtime));
    }
    if total <= max_bytes {
        return;
    }
    files.sort_by_key(|(_, _, mtime)| *mtime);
    for (path, size, _) in files {
        if total <= max_bytes {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

/// A resolved cache lookup: either the durable WAV already exists (`Hit`),
/// or it must be produced by transcoding `source_path` into `tmp_path` and
/// then finalized via [`finalize_cache_write`] (`Miss`). Split from the
/// actual transcode call (async, lives in `whisper.rs`) so this half stays
/// synchronous and directly testable — see this section's own doc comment.
#[cfg_attr(not(test), allow(dead_code))]
enum CacheLookup {
    Hit(PathBuf),
    Miss { tmp_path: PathBuf, final_path: PathBuf },
}

/// The cache-hit/miss decision, pure filesystem stat/rename logic — no
/// transcoding happens here. On a hit, re-stamps the entry's mtime (see
/// [`evict_lru_until_under_cap`]'s own doc comment for why) via
/// `File::set_modified` (stable since Rust 1.75; this crate's own
/// `rust-version = "1.77.2"` already requires at least that) rather than a
/// new crate dependency.
#[cfg_attr(not(test), allow(dead_code))]
fn resolve_cache_entry(cache_dir: &Path, source_path: &Path) -> Result<CacheLookup, FaError> {
    std::fs::create_dir_all(cache_dir)
        .map_err(|e| FaError::inference_failed(format!("create FA audio cache dir {}: {e}", cache_dir.display())))?;

    let key = source_identity_key(source_path)
        .map_err(|e| FaError::inference_failed(format!("stat source media {}: {e}", source_path.display())))?;
    let final_path = cache_dir.join(format!("{key}.wav"));

    if final_path.exists() {
        if let Ok(file) = std::fs::File::open(&final_path) {
            let _ = file.set_modified(std::time::SystemTime::now());
        }
        return Ok(CacheLookup::Hit(final_path));
    }

    let tmp_path = cache_dir.join(format!("{key}.wav.tmp"));
    Ok(CacheLookup::Miss { tmp_path, final_path })
}

/// Finalizes a successful transcode: renames the `.tmp` file into place
/// (atomic on every target OS this codebase ships for — a reader can never
/// observe a partially-written `.wav`), then runs the LRU eviction pass.
/// Called only after the caller's own transcode step has already succeeded
/// against `tmp_path`.
#[cfg_attr(not(test), allow(dead_code))]
fn finalize_cache_write(tmp_path: &Path, final_path: &Path, cache_dir: &Path) -> Result<PathBuf, FaError> {
    std::fs::rename(tmp_path, final_path).map_err(|e| {
        let _ = std::fs::remove_file(tmp_path);
        FaError::inference_failed(format!("finalize durable WAV cache entry: {e}"))
    })?;
    evict_lru_until_under_cap(cache_dir, FA_AUDIO_CACHE_MAX_BYTES);
    Ok(final_path.to_path_buf())
}

/// Production-shaped entry point (WS1 Task 5 Slice D24 B1) — UNWIRED, no
/// caller anywhere in `src/`/`src-tauri/src/` yet (grepped; see this
/// section's own doc comment). Resolves the cache directory via a live
/// `AppHandle` and transcodes for real via `whisper.rs::transcode_to_wav`
/// (unchanged, reused as-is per this slice's own scope — Track B does not
/// modify `whisper.rs`) rather than a reimplementation. On a cache hit, this
/// never spawns ffmpeg at all. Unconditional `allow(dead_code)` for the same
/// reason as `fa_audio_cache_dir` above — no `AppHandle` reaches this in any
/// test.
#[allow(dead_code)]
pub(crate) async fn ensure_durable_wav(app: &tauri::AppHandle, source_path: &Path) -> Result<PathBuf, FaError> {
    let cache_dir = fa_audio_cache_dir(app)?;
    match resolve_cache_entry(&cache_dir, source_path)? {
        CacheLookup::Hit(path) => Ok(path),
        CacheLookup::Miss { tmp_path, final_path } => {
            if let Err(e) = crate::whisper::transcode_to_wav(app, source_path, &tmp_path).await {
                let _ = std::fs::remove_file(&tmp_path);
                return Err(FaError::inference_failed(format!("transcode to durable WAV failed: {e}")));
            }
            finalize_cache_write(&tmp_path, &final_path, &cache_dir)
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Forced-alignment entry point.
///
/// With the `fa-inference` Cargo feature OFF (the default — still true of
/// every build until that feature is deliberately enabled), this always
/// returns `Err(FaError { kind: NotImplemented, .. })`, unchanged from Task
/// 5's original boundary skeleton: no model, no inference, no ML dependency
/// in the build graph. With `fa-inference` ON, this resolves the ONNX model
/// for `language`, then LOOPS `chunks` in order (WS1 Task 5 Slice D11) —
/// slicing each chunk's own audio window, checking for cancellation at every
/// chunk boundary, running a forward pass + the ported Viterbi DP
/// (`fa_viterbi.rs`) against just that chunk, and emitting `FaEvent::Progress`
/// once per completed chunk — reusing a single cached `Session`
/// (`model_cache`) across every chunk in the run rather than reloading the
/// 1.2+GiB model file each time. See `fa_onnx.rs`'s `align_chunked` for the
/// implementation and its own module doc comment for why whole-file
/// alignment (the pre-D11 shape) is infeasible at production audio length.
/// Neither path panics, blocks the main thread indefinitely, or silently
/// succeeds.
///
/// Not called from `src/` for production timing in either configuration yet
/// — the only caller anywhere is the DEV-only `fa_align_dev` (`fa_dev.rs`,
/// Slice D10), unreachable from any UI control. Real frontend wiring (a
/// capability-gated Settings toggle, per `docs/ws1-sync-pipeline/
/// task5-slice-ledger.md`'s ruling) is a later, separately-scoped slice.
///
/// * `audio_path`   — filesystem path to the audio FA would align against
///   (reuses whatever the caller already has on disk, e.g. the same
///   16 kHz-mono WAV `whisper.rs::transcode_to_wav` produces, rather than
///   re-sending audio bytes through IPC a second time).
/// * `chunks`       — ordered `{startSec, endSec, text}` windows to align,
///   one forward pass per chunk (`src/services/faChunkPlan.ts` builds this
///   from `faAnchors.ts`'s run structure — unmodified — plus segment-time
///   membership; see that module's own doc comment for why).
/// * `language`     — an FA language code (one of the five shipping models).
/// * `on_event`     — frontend channel receiving `FaEvent` variants
///   (`Progress` once per completed chunk, then `Done` or `Error`).
#[tauri::command]
#[allow(unused_variables)]
pub async fn fa_align(
    app: tauri::AppHandle,
    state: tauri::State<'_, FaState>,
    model_cache: tauri::State<'_, FaModelCache>,
    audio_path: String,
    chunks: Vec<FaChunkInput>,
    language: String,
    on_event: Channel<FaEvent>,
) -> Result<(), FaError> {
    start_run(&state)?;

    #[cfg(feature = "fa-inference")]
    {
        let total = chunks.len() as u32;
        let on_progress = |index: u32| {
            let _ = on_event.send(FaEvent::Progress { index, total });
        };
        let result = crate::fa_onnx::align_chunked_for_language(
            &app,
            &model_cache.0,
            &audio_path,
            &chunks,
            &language,
            || is_cancelled(&state),
            on_progress,
        );
        finish_run(&state)?;
        return match result {
            Ok(word_spans) => {
                let words: Vec<FaWordSpan> = word_spans_to_dtos(word_spans);
                let _ = on_event.send(FaEvent::Done { words });
                Ok(())
            }
            Err(e) => {
                let err = fa_onnx_error_to_fa_error(e);
                let _ = on_event.send(FaEvent::Error { message: err.message.clone() });
                Err(err)
            }
        };
    }

    #[cfg(not(feature = "fa-inference"))]
    {
        let err = FaError::not_implemented(
            "Forced alignment inference is not implemented yet. This command establishes the \
             boundary (state, cancellation, progress channel, argument shape) that a future native \
             inference engine will drop into — no model, no inference, no ML dependency added.",
        );
        let _ = on_event.send(FaEvent::Error { message: err.message.clone() });

        finish_run(&state)?;
        Err(err)
    }
}

/// Cancels a running FA job. Mirrors `whisper_cancel` (`whisper.rs:432-441`):
/// a no-op, not an error, when nothing is running.
#[tauri::command]
pub async fn fa_cancel(state: tauri::State<'_, FaState>) -> Result<(), FaError> {
    cancel_run(&state)
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- state machine -------------------------------------------------

    #[test]
    fn idle_to_running_to_cancelled() {
        let state = FaState::default();
        assert_eq!(*state.0.lock().unwrap(), FaRunState::Idle);

        start_run(&state).unwrap();
        assert_eq!(*state.0.lock().unwrap(), FaRunState::Running);

        cancel_run(&state).unwrap();
        assert_eq!(*state.0.lock().unwrap(), FaRunState::Cancelled);
    }

    #[test]
    fn cancel_on_idle_is_noop_not_error() {
        let state = FaState::default();
        assert_eq!(*state.0.lock().unwrap(), FaRunState::Idle);

        let result = cancel_run(&state);
        assert!(result.is_ok());
        assert_eq!(*state.0.lock().unwrap(), FaRunState::Idle);
    }

    #[test]
    fn cancel_on_cancelled_stays_cancelled() {
        let state = FaState::default();
        start_run(&state).unwrap();
        cancel_run(&state).unwrap();
        cancel_run(&state).unwrap();
        assert_eq!(*state.0.lock().unwrap(), FaRunState::Cancelled);
    }

    #[test]
    fn finish_returns_to_idle_from_running() {
        let state = FaState::default();
        start_run(&state).unwrap();
        finish_run(&state).unwrap();
        assert_eq!(*state.0.lock().unwrap(), FaRunState::Idle);
    }

    // -- is_cancelled + the cancelled-run reset sequence (WS1 Task 5 Slice
    // D11) — the exact state-machine transitions `fa_align`'s real body
    // drives around a chunked `align_chunked` call: `start_run` before the
    // loop, `is_cancelled` polled at every chunk boundary (mirrored here by
    // fa_onnx.rs's own `cancellation` test module, which proves the LOOP
    // itself stops early — this test proves the STATE resets correctly
    // afterward, the half `align_chunked` itself has no access to). ------

    #[test]
    fn is_cancelled_false_when_idle_or_running() {
        let state = FaState::default();
        assert!(!is_cancelled(&state), "Idle must not read as cancelled");
        start_run(&state).unwrap();
        assert!(!is_cancelled(&state), "Running must not read as cancelled");
    }

    #[test]
    fn is_cancelled_true_only_after_cancel_run_on_a_running_state() {
        let state = FaState::default();
        start_run(&state).unwrap();
        cancel_run(&state).unwrap();
        assert!(is_cancelled(&state), "Cancelled must read as cancelled");
    }

    #[test]
    fn cancelled_run_resets_to_idle_and_no_longer_reads_as_cancelled() {
        // Mirrors fa_align's real sequence around a chunked run: start_run
        // before the loop begins, cancel_run simulating fa_cancel firing
        // mid-loop (the point fa_onnx.rs's own cancellation test proves the
        // chunk loop itself observes and stops at), finish_run afterward —
        // called UNCONDITIONALLY regardless of the align_chunked result,
        // exactly as fa_align's own body does (`finish_run(&state)?` runs
        // before either match arm, Ok or Err). The guarantee this proves:
        // once a cancelled run finishes, its transient Cancelled signal
        // cannot bleed into whatever runs next — the very next check reads
        // Idle, not Cancelled, so a future run is never mistaken for still
        // being the one that was just cancelled.
        let state = FaState::default();
        start_run(&state).unwrap();
        cancel_run(&state).unwrap();
        assert!(is_cancelled(&state));

        finish_run(&state).unwrap();

        assert_eq!(*state.0.lock().unwrap(), FaRunState::Idle);
        assert!(!is_cancelled(&state), "a finished (even cancelled) run must not still read as cancelled");
    }

    // -- model resolution ladder ---------------------------------------

    #[test]
    fn candidate_paths_prefers_managed_over_manual_in_order() {
        let local = PathBuf::from("/fake/local-data");
        let exe = PathBuf::from("/fake/exe-dir");
        let candidates = fa_model_candidate_paths(Some(&local), Some(&exe), "en");
        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/fake/local-data/fa-models/en/model.onnx"),
                PathBuf::from("/fake/exe-dir/fa-models/en/model.onnx"),
            ]
        );
    }

    #[test]
    fn candidate_paths_never_targets_src_tauri_models() {
        let local = PathBuf::from("/fake/local-data");
        let exe = PathBuf::from("/fake/exe-dir");
        let candidates = fa_model_candidate_paths(Some(&local), Some(&exe), "es");
        for c in &candidates {
            let s = c.display().to_string();
            assert!(!s.contains("src-tauri/models"), "candidate must not target src-tauri/models: {s}");
        }
    }

    #[test]
    fn candidate_paths_omits_missing_tiers() {
        let exe = PathBuf::from("/fake/exe-dir");
        let candidates = fa_model_candidate_paths(None, Some(&exe), "de");
        assert_eq!(candidates, vec![PathBuf::from("/fake/exe-dir/fa-models/de/model.onnx")]);

        let candidates = fa_model_candidate_paths(None, None, "de");
        assert!(candidates.is_empty());
    }

    #[test]
    fn resolve_existing_none_when_nothing_on_disk() {
        let candidates = vec![
            PathBuf::from("/definitely/does/not/exist/fa-models/en/model.onnx"),
            PathBuf::from("/also/missing/fa-models/en/model.onnx"),
        ];
        assert_eq!(resolve_existing(&candidates), None);
    }

    #[test]
    fn no_model_found_error_names_every_candidate_and_the_language() {
        let candidates = vec![
            PathBuf::from("/fake/local-data/fa-models/fr/model.onnx"),
            PathBuf::from("/fake/exe-dir/fa-models/fr/model.onnx"),
        ];
        let err = no_model_found_error(&candidates, "fr");
        assert_eq!(err.kind, FaErrorKind::ModelNotFound);
        assert!(err.message.contains("fr"));
        assert!(err.message.contains("/fake/local-data/fa-models/fr/model.onnx"));
        assert!(err.message.contains("/fake/exe-dir/fa-models/fr/model.onnx"));
        // The message DOES mention "src-tauri/models" — as a "never place it
        // here" warning, not as a candidate. `candidate_paths_never_targets_
        // src_tauri_models` above is the real guard on the actual paths tried.
    }

    // -- durable WAV cache (WS1 Task 5 Slice D24 B1-B3) -------------------
    //
    // `ensure_durable_wav` itself needs a live `tauri::AppHandle` (this
    // codebase has no `AppHandle` test-mocking precedent anywhere — grepped
    // — matching `fa_model_path`'s own untested-wrapper convention above).
    // These tests instead exercise every PURE/sync piece it delegates to —
    // `fa_audio_cache_dir_from_local_data_dir`, `source_identity_key`,
    // `resolve_cache_entry`, `finalize_cache_write`, and
    // `evict_lru_until_under_cap` — with real temp files/dirs, which is the
    // entire cache-hit/miss/retention pipeline minus the one line that
    // spawns the ffmpeg sidecar. This is the reachability proof WS1 Task 5
    // Slice D24's own instruction asks for ("prove reachability with a
    // test, not a wiring change") — no production/script caller invokes any
    // of this outside `cargo test`.

    fn durable_wav_test_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("fa-durable-wav-test-{label}-{}", std::process::id()))
    }

    #[test]
    fn fa_audio_cache_dir_is_a_sibling_of_fa_models_not_shared_with_it() {
        let local = PathBuf::from("/fake/local-data");
        let cache_dir = fa_audio_cache_dir_from_local_data_dir(&local);
        assert_eq!(cache_dir, PathBuf::from("/fake/local-data/fa-audio-cache"));
        assert_ne!(cache_dir, local.join("fa-models"));
    }

    #[test]
    fn source_identity_key_stable_for_an_unchanged_file() {
        let dir = durable_wav_test_dir("stable");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("source.wav");
        std::fs::write(&path, b"same bytes").unwrap();

        let key1 = source_identity_key(&path).unwrap();
        let key2 = source_identity_key(&path).unwrap();
        assert_eq!(key1, key2, "identity key must be stable across repeated stats of an untouched file");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn source_identity_key_changes_when_file_size_changes() {
        let dir = durable_wav_test_dir("size-change");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("source.wav");

        std::fs::write(&path, b"short").unwrap();
        let key_before = source_identity_key(&path).unwrap();

        std::fs::write(&path, b"a much longer replacement payload").unwrap();
        let key_after = source_identity_key(&path).unwrap();

        assert_ne!(key_before, key_after, "editing the source file's content/size must mint a new cache key");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn source_identity_key_changes_when_mtime_changes_at_same_size() {
        // Same byte length (so `meta.len()` alone can't explain a
        // difference), only mtime bumped via `File::set_modified` — a
        // deterministic stand-in for "the file was re-saved with identical
        // content," which real editors do routinely.
        let dir = durable_wav_test_dir("mtime-change");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("source.wav");
        std::fs::write(&path, b"same size!").unwrap();

        let key_before = source_identity_key(&path).unwrap();

        let file = std::fs::File::open(&path).unwrap();
        let bumped = std::time::SystemTime::now() + std::time::Duration::from_secs(120);
        file.set_modified(bumped).unwrap();

        let key_after = source_identity_key(&path).unwrap();
        assert_ne!(key_before, key_after, "a changed mtime at identical size must still mint a new cache key");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_cache_entry_misses_then_hits_after_finalize() {
        let dir = durable_wav_test_dir("miss-then-hit");
        let cache_dir = dir.join("cache");
        std::fs::create_dir_all(&dir).unwrap();
        let source_path = dir.join("source.wav");
        std::fs::write(&source_path, b"source audio bytes").unwrap();

        let (tmp_path, final_path) = match resolve_cache_entry(&cache_dir, &source_path).unwrap() {
            CacheLookup::Miss { tmp_path, final_path } => (tmp_path, final_path),
            CacheLookup::Hit(_) => panic!("expected a miss on a never-before-seen source identity"),
        };
        assert!(tmp_path.starts_with(&cache_dir));
        assert!(final_path.starts_with(&cache_dir));
        assert_ne!(tmp_path, final_path);

        // Stand-in for a successful transcode: write real bytes to tmp_path
        // (never `ensure_durable_wav`'s own ffmpeg call — see this test
        // module's own header comment for why).
        std::fs::write(&tmp_path, b"fake transcoded pcm bytes").unwrap();
        let finalized = finalize_cache_write(&tmp_path, &final_path, &cache_dir).unwrap();
        assert_eq!(finalized, final_path);
        assert!(final_path.exists());
        assert!(!tmp_path.exists(), "the .tmp file must be renamed away, not left behind");

        match resolve_cache_entry(&cache_dir, &source_path).unwrap() {
            CacheLookup::Hit(path) => assert_eq!(path, final_path),
            CacheLookup::Miss { .. } => panic!("expected a hit on the same source identity after finalize"),
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_cache_entry_hit_re_stamps_mtime() {
        let dir = durable_wav_test_dir("touch-mtime");
        let cache_dir = dir.join("cache");
        std::fs::create_dir_all(&dir).unwrap();
        let source_path = dir.join("source.wav");
        std::fs::write(&source_path, b"source audio bytes").unwrap();

        let (tmp_path, final_path) = match resolve_cache_entry(&cache_dir, &source_path).unwrap() {
            CacheLookup::Miss { tmp_path, final_path } => (tmp_path, final_path),
            CacheLookup::Hit(_) => panic!("expected a miss the first time"),
        };
        std::fs::write(&tmp_path, b"fake transcoded pcm bytes").unwrap();
        finalize_cache_write(&tmp_path, &final_path, &cache_dir).unwrap();

        // Artificially age the entry, then confirm a hit re-stamps it back
        // to "now" (within a generous tolerance) — the signal
        // `evict_lru_until_under_cap` relies on to treat a still-used entry
        // as fresh.
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        std::fs::File::open(&final_path).unwrap().set_modified(old).unwrap();

        match resolve_cache_entry(&cache_dir, &source_path).unwrap() {
            CacheLookup::Hit(path) => assert_eq!(path, final_path),
            CacheLookup::Miss { .. } => panic!("expected a hit"),
        }
        let restamped = std::fs::metadata(&final_path).unwrap().modified().unwrap();
        let age = std::time::SystemTime::now().duration_since(restamped).unwrap_or_default();
        assert!(age < std::time::Duration::from_secs(30), "hit must re-stamp mtime close to now, was {age:?} old");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn evict_lru_until_under_cap_removes_oldest_first_until_under_budget() {
        let dir = durable_wav_test_dir("evict-lru");
        std::fs::create_dir_all(&dir).unwrap();

        // Three 100-byte entries, mtimes strictly oldest -> newest.
        let oldest = dir.join("oldest.wav");
        let middle = dir.join("middle.wav");
        let newest = dir.join("newest.wav");
        for p in [&oldest, &middle, &newest] {
            std::fs::write(p, vec![0u8; 100]).unwrap();
        }
        let now = std::time::SystemTime::now();
        std::fs::File::open(&oldest).unwrap().set_modified(now - std::time::Duration::from_secs(300)).unwrap();
        std::fs::File::open(&middle).unwrap().set_modified(now - std::time::Duration::from_secs(200)).unwrap();
        std::fs::File::open(&newest).unwrap().set_modified(now - std::time::Duration::from_secs(100)).unwrap();

        // Total is 300 bytes; cap at 150 forces removing the oldest entry
        // (down to 200), which still exceeds the cap, so the next-oldest
        // (middle) must go too (down to 100) — only `newest` should survive.
        evict_lru_until_under_cap(&dir, 150);

        assert!(!oldest.exists(), "oldest entry must be evicted first");
        assert!(!middle.exists(), "second-oldest entry must be evicted once the first eviction still exceeds the cap");
        assert!(newest.exists(), "newest entry must survive — the cache stayed within budget once older entries were removed");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn evict_lru_until_under_cap_ignores_non_wav_entries() {
        let dir = durable_wav_test_dir("evict-ignores-non-wav");
        std::fs::create_dir_all(&dir).unwrap();

        let real_entry = dir.join("real.wav");
        let in_progress = dir.join("in-progress.wav.tmp");
        std::fs::write(&real_entry, vec![0u8; 10]).unwrap();
        std::fs::write(&in_progress, vec![0u8; 10_000]).unwrap();

        // A cap far too small for the .tmp file's own size to matter, since
        // it must never be counted or evicted by this pass.
        evict_lru_until_under_cap(&dir, 1);

        assert!(!real_entry.exists(), "the only real .wav entry must still be evicted once over budget");
        assert!(in_progress.exists(), ".wav.tmp (an in-progress write) must never be touched by eviction");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn evict_lru_until_under_cap_noop_when_already_under_budget() {
        let dir = durable_wav_test_dir("evict-noop");
        std::fs::create_dir_all(&dir).unwrap();
        let entry = dir.join("small.wav");
        std::fs::write(&entry, vec![0u8; 10]).unwrap();

        evict_lru_until_under_cap(&dir, 1_000_000);
        assert!(entry.exists(), "nothing should be evicted when total size is already under the cap");

        let _ = std::fs::remove_dir_all(&dir);
    }

    // -- fa_align (without a model / AppHandle) -------------------------

    #[test]
    fn fa_align_error_is_typed_not_implemented() {
        // Exercises the same not-implemented construction fa_align returns,
        // without needing a live tauri::AppHandle/async runtime — the
        // command itself is a thin wrapper around this and `start_run`/
        // `finish_run`, both already covered above.
        let err = FaError::not_implemented("Forced alignment inference is not implemented yet.");
        assert_eq!(err.kind, FaErrorKind::NotImplemented);
        assert!(!err.message.is_empty());
    }

    // -- serde camelCase shape -------------------------------------------
    // (FaEvent::Progress's own shape test moved below, WS1 Task 5 Slice D11
    // — it now carries `index`/`total`, not `percent`; see
    // `fa_event_progress_carries_index_and_total`.)

    #[test]
    fn fa_event_error_serializes_camelcase_tagged_shape() {
        let event = FaEvent::Error { message: "boom".to_string() };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json, serde_json::json!({ "event": "Error", "data": { "message": "boom" } }));
    }

    #[test]
    fn fa_event_done_serializes_camelcase_tagged_shape() {
        // 0.5/0.32/0.58 (like 0.5 below) are exactly representable in binary
        // floating point, so the f32->f64 widening serde_json performs on
        // `confidence` round-trips without drift — avoids a spurious
        // precision mismatch unrelated to what this test checks (the JSON
        // shape and field names).
        let event = FaEvent::Done {
            words: vec![FaWordSpan {
                word: "hello".to_string(),
                start_sec: 0.25,
                end_sec: 0.5,
                confidence: 0.5,
                needs_review: false,
                word_index: 0,
            }],
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "event": "Done",
                "data": {
                    "words": [
                        { "word": "hello", "startSec": 0.25, "endSec": 0.5, "confidence": 0.5, "needsReview": false, "wordIndex": 0 }
                    ]
                }
            })
        );
    }

    #[test]
    fn fa_event_done_serializes_empty_words_as_empty_array() {
        let event = FaEvent::Done { words: vec![] };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json, serde_json::json!({ "event": "Done", "data": { "words": [] } }));
    }

    // -- FaWordSpan: field names + exponentiation (WS1 Task 5 Slice D9) -----

    #[test]
    fn fa_word_span_serializes_camelcase_field_names() {
        let span = FaWordSpan {
            word: "test".to_string(),
            start_sec: 1.5,
            end_sec: 2.25,
            confidence: 0.5,
            needs_review: false,
            word_index: 3,
        };
        let json = serde_json::to_value(&span).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "word": "test", "startSec": 1.5, "endSec": 2.25, "confidence": 0.5, "needsReview": false, "wordIndex": 3 })
        );
    }

    // `word_span_to_dto` only exists under `fa-inference` (it takes a
    // `crate::fa_onnx::WordSpan`, itself only compiled under that feature —
    // see `lib.rs`'s `#[cfg(feature = "fa-inference")] mod fa_onnx;`), so
    // these two tests are feature-gated rather than living in the
    // unconditional `#[cfg(test)]` block above.
    #[cfg(feature = "fa-inference")]
    #[test]
    fn fa_word_span_confidence_is_exponentiated_log_probability() {
        // Exercises the REAL production conversion function (`word_span_to_dto`,
        // the same one `fa_align`'s Ok arm calls), not a reimplementation —
        // a log-prob of 0.0 (probability 1.0, the maximum-confidence case)
        // must exponentiate to 1.0, and a log-prob of -1.0 must exponentiate
        // to 1/e — both hand-computable, both landing inside [0, 1] as the
        // WS1 Task 5 Slice D9 ruling requires (prompted by D8's finding that
        // `TokenSpan.score`/`WordSpan.score` are log-probabilities, not
        // probabilities).
        let zero = crate::fa_onnx::WordSpan {
            text: "a".to_string(),
            start_seconds: 0.0,
            end_seconds: 0.1,
            score: 0.0,
        };
        assert_eq!(word_span_to_dto(zero, 0).confidence, 1.0);

        let neg_one = crate::fa_onnx::WordSpan {
            text: "b".to_string(),
            start_seconds: 0.1,
            end_seconds: 0.2,
            score: -1.0,
        };
        let confidence = word_span_to_dto(neg_one, 1).confidence;
        assert!((confidence - std::f32::consts::E.recip()).abs() < 1e-6);
        assert!(confidence > 0.0 && confidence < 1.0);
    }

    #[cfg(feature = "fa-inference")]
    #[test]
    fn fa_word_span_to_dto_preserves_text_and_seconds() {
        let w = crate::fa_onnx::WordSpan {
            text: "kinetix".to_string(),
            start_seconds: 1.25,
            end_seconds: 1.75,
            score: -2.0,
        };
        let dto = word_span_to_dto(w, 7);
        assert_eq!(dto.word, "kinetix");
        assert_eq!(dto.start_sec, 1.25);
        assert_eq!(dto.end_sec, 1.75);
        assert_eq!(dto.word_index, 7);
    }

    // -- word_index (WS1 Task 5 Slice D18) --------------------------------
    //
    // These exercise `word_spans_to_dtos`, the real function `fa_align`'s Ok
    // arm calls, with hand-built `WordSpan`s — no live model/AppHandle
    // needed, since `word_index` assignment is pure positional bookkeeping
    // over an already-produced `Vec<WordSpan>` (see this function's own doc
    // comment for why the index doesn't need to be derived any deeper than
    // that).

    #[cfg(feature = "fa-inference")]
    fn spans(words: &[&str]) -> Vec<crate::fa_onnx::WordSpan> {
        words
            .iter()
            .enumerate()
            .map(|(i, w)| crate::fa_onnx::WordSpan {
                text: w.to_string(),
                start_seconds: i as f64,
                end_seconds: i as f64 + 0.5,
                score: -0.1,
            })
            .collect()
    }

    #[cfg(feature = "fa-inference")]
    #[test]
    fn word_spans_to_dtos_indices_monotonic_and_no_duplicates() {
        let dtos = word_spans_to_dtos(spans(&["the", "quick", "brown", "fox"]));
        let indices: Vec<u32> = dtos.iter().map(|d| d.word_index).collect();
        assert_eq!(indices, vec![0, 1, 2, 3]);
        let mut sorted = indices.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), indices.len(), "no duplicate word_index values");
    }

    #[cfg(feature = "fa-inference")]
    #[test]
    fn word_spans_to_dtos_index_resolves_to_expected_script_word() {
        // Simulates a consumer joining FA output back to the script's own
        // word array purely via `word_index` — never via time or position in
        // some other array.
        let script_words = ["the", "quick", "brown", "fox"];
        let dtos = word_spans_to_dtos(spans(&script_words));
        for dto in &dtos {
            assert_eq!(dto.word, script_words[dto.word_index as usize]);
        }
    }

    #[cfg(feature = "fa-inference")]
    #[test]
    fn word_spans_to_dtos_index_survives_chunked_path_across_seams() {
        // `align_chunked`'s own loop appends each chunk's words onto one
        // running `Vec<WordSpan>` (`all_words`) BEFORE `word_spans_to_dtos`
        // ever runs — so this concatenation is exactly what a two-chunk run
        // hands to it. The index must continue across that chunk seam, not
        // reset to 0 for chunk 2's first word.
        let mut chunk1 = spans(&["the", "quick"]);
        let chunk2 = spans(&["brown", "fox", "jumps"]);
        chunk1.extend(chunk2);
        let all_words = chunk1;

        let dtos = word_spans_to_dtos(all_words);
        let indices: Vec<u32> = dtos.iter().map(|d| d.word_index).collect();
        assert_eq!(indices, vec![0, 1, 2, 3, 4]);
        // The seam itself: chunk 2's first word ("brown") is index 2, not 0.
        assert_eq!(dtos[2].word, "brown");
        assert_eq!(dtos[2].word_index, 2);
    }

    // -- needs_review / R.7 fallback (WS1 Task 5 Slice D19) ----------------
    //
    // Data below is REAL, not fabricated: verbatim (confidence, word) pairs
    // read from the D18 Step 5 measurement run's own output files
    // (`.work-phase4/replay/173/tokens_fa.json` — matched, real audio +
    // real committed text — and `tokens_mismatch-shuffled.json` — real
    // audio, a cyclically rotated OTHER segment's text). Both are local,
    // gitignored measurement artifacts (same convention D18 used for them),
    // so the values are reproduced here as literals rather than read at
    // test time — the NUMBERS are real, only their storage location changed.
    // Each pair is turned into a `WordSpan` via `confidence.ln()` so these
    // tests exercise the real production function (`word_span_to_dto`), not
    // a reimplementation of the threshold compare.

    #[cfg(feature = "fa-inference")]
    fn word_span_with_confidence(text: &str, confidence: f32) -> crate::fa_onnx::WordSpan {
        crate::fa_onnx::WordSpan {
            text: text.to_string(),
            start_seconds: 0.0,
            end_seconds: 1.0,
            score: confidence.ln(),
        }
    }

    #[cfg(feature = "fa-inference")]
    #[test]
    fn needs_review_fires_on_real_mismatched_sub_threshold_words() {
        // Real (confidence, word) pairs, all < CONF_MIN, from the D18 Step 5
        // shuffled-transcript (mismatched) run.
        let real_sub_threshold: &[(f32, &str)] = &[
            (0.25, "that"),
            (0.0, "on"),
            (0.1511, "auspex"),
            (0.1938, "scans"),
            (0.0, "as"),
            (0.199, "physically"),
            (0.0168, "larger"),
            (0.002, "than"),
            (0.0012, "the"),
            (0.0, "geological"),
            (0.2195, "formation"),
            (0.041, "around"),
            (0.2481, "them"),
            (0.0, "a"),
            (0.2497, "data"),
            (0.0002, "a"),
            (0.2499, "time"),
            (0.2499, "Warriors"),
            (0.001, "go"),
            (0.2819, "down."),
        ];
        for (confidence, word) in real_sub_threshold {
            let dto = word_span_to_dto(word_span_with_confidence(word, *confidence), 0);
            assert!(
                dto.needs_review,
                "expected needs_review for real sub-threshold word {word:?} (confidence {confidence})"
            );
        }
    }

    #[cfg(feature = "fa-inference")]
    #[test]
    fn needs_review_does_not_fire_on_real_mismatched_words_that_still_scored_above_conf_min() {
        // Even under mismatch, some words still align well by chance — the
        // flag must track confidence, not "was this the mismatched run."
        let real_above_threshold: &[(f32, &str)] = &[
            (0.4, "rooms"),
            (0.4984, "register"),
            (0.5836, "should"),
            (0.3323, "permit."),
            (0.727, "Whether"),
            (0.3997, "that's"),
            (0.3332, "sensor"),
            (0.4255, "artifact"),
            (0.5272, "or"),
            (0.3744, "accurate"),
            (0.9993, "is"),
            (0.3332, "not"),
            (0.6644, "question"),
            (0.4986, "anyone"),
            (0.4703, "fighting"),
        ];
        for (confidence, word) in real_above_threshold {
            let dto = word_span_to_dto(word_span_with_confidence(word, *confidence), 0);
            assert!(
                !dto.needs_review,
                "did not expect needs_review for real above-threshold word {word:?} (confidence {confidence})"
            );
        }
    }

    #[cfg(feature = "fa-inference")]
    #[test]
    fn needs_review_matched_corpus_stays_essentially_untouched() {
        // Real (confidence, word) pairs from the D18 Step 5 MATCHED run
        // (correct text, correct audio): the full real 29/1645
        // below-threshold set (all 29, verbatim — D18 Step 5's own "1.8%
        // baseline" measurement) plus a deterministic real sample of 82
        // above-threshold words (every 20th entry in the real 1645-word
        // capture, spanning many different segments). This reproduces both
        // tails of that real distribution and asserts the rule agrees with
        // every one of these real points, rather than re-deriving the full
        // corpus count (which lives only in the gitignored
        // `.work-phase4/` measurement output, not a committed fixture).
        let real_below_threshold: &[(f32, &str)] = &[
            (0.0043, "the"),
            (0.0, "worst"),
            (0.2955, "vox-casters,"),
            (0.1664, "and"),
            (0.2122, "debris,"),
            (0.266, "pull"),
            (0.0558, "competing"),
            (0.0015, "launched"),
            (0.2232, "round"),
            (0.2371, "six"),
            (0.1342, "what"),
            (0.003, "by"),
            (0.0316, "centuries,"),
            (0.0439, "is"),
            (0.1246, "cycling"),
            (0.0818, "through"),
            (0.1746, "Two,"),
            (0.0004, "Cadian"),
            (0.0004, "Space."),
            (0.0, "the"),
            (0.0, "laws"),
            (0.017, "the"),
            (0.0418, "somewhere"),
            (0.0036, "the"),
            (0.0039, "setting"),
            (0.0001, "force"),
            (0.0002, "depends"),
            (0.0013, "on"),
            (0.1472, "outcome,"),
        ];
        let real_above_threshold: &[(f32, &str)] = &[
            (0.9606, "Some"),
            (0.9991, "function"),
            (0.9973, "because"),
            (0.9991, "Number"),
            (0.945, "killed"),
            (0.9995, "outcome,"),
            (0.9492, "a"),
            (0.9621, "something"),
            (0.538, "ants"),
            (0.9929, "fire,"),
            (0.9917, "track"),
            (0.9981, "soldiers"),
            (0.9985, "until"),
            (0.9995, "as"),
            (0.9955, "absorbs"),
            (0.9719, "fused"),
            (0.999, "on."),
            (0.9698, "weren't"),
            (0.9562, "warp"),
            (0.9995, "by"),
            (0.9994, "is"),
            (0.9984, "this"),
            (0.9739, "the"),
            (0.8467, "collapse"),
            (0.9391, "arrive"),
            (0.9997, "make"),
            (0.9998, "outcome"),
            (0.9998, "rather"),
            (0.9998, "resist"),
            (0.9185, "engineered,"),
            (0.7311, "Chaos-aligned"),
            (0.9993, "extended"),
            (0.9982, "two"),
            (0.9997, "contact"),
            (0.9997, "had"),
            (0.9978, "because"),
            (0.9991, "that"),
            (0.893, "has"),
            (0.8569, "Tomb"),
            (0.9809, "than"),
            (0.9994, "anyone"),
            (0.9974, "other"),
            (0.9985, "and"),
            (0.976, "corridors,"),
            (0.9305, "scaling"),
            (0.9992, "model"),
            (0.9923, "stop"),
            (0.868, "Number"),
            (0.8919, "are"),
            (0.9467, "requires"),
            (0.9994, "that"),
            (0.9394, "the"),
            (0.9691, "atmospheric"),
            (0.9971, "in"),
            (0.9421, "between"),
            (0.8587, "effect"),
            (0.9997, "They"),
            (0.9996, "impossible"),
            (0.8629, "The"),
            (0.9421, "Warp,"),
            (0.9911, "of"),
            (0.9987, "A"),
            (0.9842, "a"),
            (0.9996, "concept"),
            (0.9992, "in"),
            (0.9693, "what"),
            (0.9991, "distances."),
            (0.9967, "have"),
            (0.8908, "anomalies."),
            (0.963, "for"),
            (0.9483, "what"),
            (0.9649, "available,"),
            (0.9995, "from"),
            (0.8958, "one"),
            (0.7938, "worst"),
            (0.9042, "in"),
            (0.9992, "it"),
            (0.8369, "on"),
            (0.9732, "Some"),
            (0.9976, "sent"),
            (0.9301, "the"),
            (0.9694, "else"),
        ];

        for (confidence, word) in real_below_threshold {
            let dto = word_span_to_dto(word_span_with_confidence(word, *confidence), 0);
            assert!(dto.needs_review, "expected needs_review for {word:?} ({confidence})");
        }
        for (confidence, word) in real_above_threshold {
            let dto = word_span_to_dto(word_span_with_confidence(word, *confidence), 0);
            assert!(!dto.needs_review, "did not expect needs_review for {word:?} ({confidence})");
        }

        // Cross-check against D18 Step 5's own count: exactly 29/1645
        // (1.76%) of the real matched corpus fell below CONF_MIN.
        assert_eq!(
            real_below_threshold.len(),
            29,
            "full real below-threshold set from the matched run"
        );
    }

    // -- CONF_MIN TS/Rust drift guard (WS1 Task 5 Slice D20 Step 5) --------
    //
    // D19 introduced this file's own `CONF_MIN = 0.3` literal, deliberately
    // duplicating `syncConstants.ts:536`'s `export const CONF_MIN = 0.3`
    // rather than reading across the IPC boundary (that module's own doc
    // comment above explains why). A hand-duplicated literal has no
    // compiler to catch drift the way `FaErrorKind`'s exhaustive match does
    // (see that guard below) — the TS side is a plain `f32`, not an enum
    // variant a Rust `match` could refuse to compile without. This test is
    // the runtime equivalent: it reads `syncConstants.ts`'s OWN source text
    // at test time (never touching that protected file, only reading it)
    // and fails if the two literals no longer agree — the same "unable to
    // silently ship a drift" property the `FaErrorKind` guard has, just
    // enforced at test-run time instead of compile time, since no Rust
    // compiler pass can see into a `.ts` file's literal.
    #[cfg(feature = "fa-inference")]
    #[test]
    fn conf_min_matches_sync_constants_ts_literal() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/services/syncConstants.ts");
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {}: {e} — CONF_MIN drift guard cannot run without the TS source", path.display()));
        let needle = "export const CONF_MIN = ";
        let start = source.find(needle).unwrap_or_else(|| {
            panic!("\"{needle}\" not found in {} — syncConstants.ts's CONF_MIN export was renamed or removed", path.display())
        });
        let after = &source[start + needle.len()..];
        let end = after.find(';').unwrap_or_else(|| panic!("no terminating ';' found after CONF_MIN's value in {}", path.display()));
        let ts_value: f32 = after[..end].trim().parse().unwrap_or_else(|e| {
            panic!("could not parse {:?} as f32 (from {}): {e}", &after[..end], path.display())
        });
        assert_eq!(
            ts_value, CONF_MIN,
            "syncConstants.ts's CONF_MIN ({ts_value}) has drifted from fa.rs's own CONF_MIN ({CONF_MIN}) — \
             update fa.rs's literal to match (syncConstants.ts is off limits to this workstream's Rust slices)"
        );
    }

    // -- ModelNotFound kind preservation (WS1 Task 5 Slice D10 fix) --------

    #[cfg(feature = "fa-inference")]
    #[test]
    fn fa_onnx_error_to_fa_error_preserves_model_not_found_kind_and_message() {
        let original = FaError::model_not_found("no model for \"en\", tried: /a, /b".to_string());
        let wrapped = crate::fa_onnx::FaOnnxError::ModelNotFound(original.clone());
        let mapped = fa_onnx_error_to_fa_error(wrapped);
        assert_eq!(mapped.kind, FaErrorKind::ModelNotFound);
        assert_eq!(mapped.message, original.message);
    }

    #[cfg(feature = "fa-inference")]
    #[test]
    fn fa_onnx_error_to_fa_error_maps_other_variants_to_inference_failed() {
        let e = crate::fa_onnx::FaOnnxError::EmptyTokenization;
        let mapped = fa_onnx_error_to_fa_error(e);
        assert_eq!(mapped.kind, FaErrorKind::InferenceFailed);
        assert!(mapped.message.contains("zero target tokens"));
    }

    #[test]
    fn fa_error_serializes_camelcase_fields() {
        let err = FaError::not_implemented("nope");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "notImplemented", "message": "nope" }));
    }

    // -- TS/Rust FaErrorKind drift guard (WS1 Task 5 Slice D6) ------------

    #[test]
    fn every_fa_error_kind_variant_serializes_to_its_expected_camelcase_string() {
        // Compile-time exhaustiveness guard: this match has NO wildcard arm,
        // so it fails to COMPILE (not just fails a runtime assertion) the
        // moment `FaErrorKind` gains a variant not listed both here and in
        // `cases` below — a future variant cannot silently ship without its
        // serialized string being asserted by this test.
        fn assert_exhaustive(kind: FaErrorKind) {
            match kind {
                FaErrorKind::NotImplemented
                | FaErrorKind::ModelNotFound
                | FaErrorKind::StateLockPoisoned
                | FaErrorKind::InferenceFailed
                | FaErrorKind::ModelHashMismatch
                | FaErrorKind::Cancelled => {}
            }
        }

        // This list is the Rust source of truth this test guards. It is NOT
        // itself checked against `src/services/faBoundaryTypes.ts`'s
        // `FaErrorKind` union — no TS runtime exists in a `cargo test` run —
        // so this guard is ONE-DIRECTIONAL: it catches a Rust variant added
        // without a matching TS union member (this test fails to compile
        // until both are updated together), but it CANNOT catch the reverse
        // (a TS-side rename or addition that drifts away from Rust with no
        // corresponding Rust change to trip this match). Keeping the two in
        // sync when only the TS side changes remains a manual/code-review
        // responsibility — see `faBoundaryTypes.ts`'s own doc comment on
        // `FaErrorKind`, which points back here.
        let cases: &[(FaErrorKind, &str)] = &[
            (FaErrorKind::NotImplemented, "notImplemented"),
            (FaErrorKind::ModelNotFound, "modelNotFound"),
            (FaErrorKind::StateLockPoisoned, "stateLockPoisoned"),
            (FaErrorKind::InferenceFailed, "inferenceFailed"),
            (FaErrorKind::ModelHashMismatch, "modelHashMismatch"),
            (FaErrorKind::Cancelled, "cancelled"),
        ];
        for (kind, expected) in cases {
            assert_exhaustive(*kind);
            let json = serde_json::to_value(kind).unwrap();
            assert_eq!(json, serde_json::json!(expected), "FaErrorKind serialized string mismatch for {kind:?}");
        }
    }

    #[test]
    fn fa_chunk_input_deserializes_camelcase_fields() {
        let json = serde_json::json!({ "startSec": 1.5, "endSec": 30.0, "text": "hello world" });
        let input: FaChunkInput = serde_json::from_value(json).unwrap();
        assert_eq!(input.start_sec, 1.5);
        assert_eq!(input.end_sec, 30.0);
        assert_eq!(input.text, "hello world");
    }

    // -- FaEvent::Progress shape (WS1 Task 5 Slice D11) --------------------

    #[test]
    fn fa_event_progress_carries_index_and_total() {
        let event = FaEvent::Progress { index: 3, total: 24 };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json, serde_json::json!({ "event": "Progress", "data": { "index": 3, "total": 24 } }));
    }
}
