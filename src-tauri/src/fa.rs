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
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FaWordSpan {
    pub word: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub confidence: f32,
    pub word_index: u32,
}

/// The IPC-boundary conversion this module's doc comment on [`FaWordSpan`]
/// describes: `exp(score)` turns a mean log-probability into a probability.
/// `word_index` is threaded through as an explicit parameter (not derived
/// here) because a single `WordSpan` carries no positional information of
/// its own — only its caller, iterating the stitched `Vec<WordSpan>`, knows
/// where it sits. Pulled out as its own function (rather than inlined in
/// `fa_align`'s match arm) so it has a direct unit-test target — see the
/// `fa_word_span_*` tests below.
#[cfg(feature = "fa-inference")]
fn word_span_to_dto(w: crate::fa_onnx::WordSpan, word_index: u32) -> FaWordSpan {
    FaWordSpan {
        word: w.text,
        start_sec: w.start_seconds,
        end_sec: w.end_seconds,
        confidence: w.score.exp(),
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
                        { "word": "hello", "startSec": 0.25, "endSec": 0.5, "confidence": 0.5, "wordIndex": 0 }
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
        let span = FaWordSpan { word: "test".to_string(), start_sec: 1.5, end_sec: 2.25, confidence: 0.5, word_index: 3 };
        let json = serde_json::to_value(&span).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "word": "test", "startSec": 1.5, "endSec": 2.25, "confidence": 0.5, "wordIndex": 3 })
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
