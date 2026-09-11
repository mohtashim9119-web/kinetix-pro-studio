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
// D2 (`49e233a`) — see `fa_onnx.rs` and `docs/archive/history/work-in-progress.md` §5 for the
// full slice-by-slice record (`task5-slice-ledger.md`, its original source,
// was deleted 2026-08-14, `9cf5867`; retrieve: `git show
// 251be64:docs/ws1-sync-pipeline/task5-slice-ledger.md`). Still not wired
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
//
// The tuple field is `pub(crate)`, not `pub` (WS1 Task 5 Slice D25 A1 —
// `fa` became `pub mod fa;` in `lib.rs` so `tests/fa_durable_wav_live.rs`
// could reach `fa_align_dev`, which made this struct externally reachable
// too): a `pub` field's DECLARED type, `Mutex<FaModelCacheSlot>`, names
// `FaModelCacheSlot`, itself `pub(crate)` (holding `fa_onnx::CachedSession`,
// also `pub(crate)`) — `cargo check --features fa-inference` correctly
// flagged this as a private-type leak once the struct itself went public.
// Every real reader of `.0` is inside this same module (grepped); nothing
// needs it from outside the crate, so narrowing is the fix, not widening
// `CachedSession`/`FaModelCacheSlot` to `pub` just to match.
#[cfg_attr(not(feature = "fa-inference"), allow(dead_code))]
pub struct FaModelCache(pub(crate) Mutex<FaModelCacheSlot>);

impl Default for FaModelCache {
    fn default() -> Self {
        FaModelCache(Mutex::new(Default::default()))
    }
}

/// Moves the state to `Running`.
///
/// WS3 fa-perf-foundation: this used to be described as deliberately
/// permissive, mirroring `whisper_transcribe`'s old kill-and-replace shape.
/// That is no longer the policy. Concurrency is now refused UPSTREAM of here,
/// at the single-flight claim in `fa_dev::resolve_wav_and_align` (see
/// [`IN_FLIGHT`]) — taken before any expensive work and released on every
/// exit by `Drop`. This function stays an unconditional write on purpose:
/// duplicating the in-flight test here would be a second, independently
/// racy mechanism guarding the same thing, which is exactly what
/// `event_sink.rs` exists to prevent. The claim is the gate; this is the
/// state transition the gate admits.
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
    // WS3 fa-perf-foundation: a run is already in flight for this key, and
    // this one is REFUSED rather than allowed to clobber it. Distinct from
    // `Cancelled` (that run was stopped; this one never started) and from
    // `InferenceFailed` (nothing failed — the request was declined).
    AlreadyRunning,
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
    pub(crate) fn already_running(message: impl Into<String>) -> Self {
        FaError { kind: FaErrorKind::AlreadyRunning, message: message.into() }
    }
}

// ---------------------------------------------------------------------------
// Single-flight registry (WS3 fa-perf-foundation)
// ---------------------------------------------------------------------------

/// The forced-alignment runs currently in flight, keyed by run key.
///
/// The SAME machinery `whisper.rs` and `model_download.rs` use
/// (`event_sink::InFlightRegistry`), instantiated with this module's own
/// key/payload types. A separate `static` is what keeps this registry
/// isolated from theirs: an FA run and a transcription can never collide on
/// a key, because they are different maps.
///
/// WHAT THIS REPLACES. [`start_run`] used to write `FaRunState::Running`
/// unconditionally, with no in-flight check at all — its own doc comment
/// described that as deliberately mirroring `whisper_transcribe`'s old
/// kill-and-replace permissiveness. Whisper has since abandoned that shape
/// (Transcription Requirement 1) for exactly the reason it bites here: two
/// concurrent runs both proceed, the second's `start_run` overwrites a
/// `Cancelled` the first was about to observe, and the first's `finish_run`
/// writes `Idle` while the second is still going. Neither caller is told.
///
/// KEY CHOICE — `input_path`. It is the only per-run string available at the
/// `fa_align_production` boundary (the others are `chunks`, `language`, and
/// the channel), and unlike whisper's `audio_path` it is genuinely stable:
/// `fa_stage_audio_raw` writes to a CONTENT-ADDRESSED path,
/// `<namespace>/<sha256-of-bytes>.<ext>`, so the same audio content yields
/// the same path on every call and across a page reload. Whisper's key had to
/// come from the frontend precisely because `whisper_stage_audio_raw` mints a
/// fresh `kinetix-whisper-<uuid>/` directory per call; that failure mode does
/// not apply here.
///
/// WHAT THIS KEY DOES NOT COVER, stated rather than glossed:
///   * Two DIFFERENT projects sharing one voiceover file hash to one key, so
///     the second is refused even though it is not a duplicate. A false
///     refusal is the safe direction of that error (the caller is told, and
///     the real contended resources below are global anyway), but it is a
///     wrong answer.
///   * The genuinely contended resources — `FaState` and `FaModelCache` —
///     are process-global, NOT per-key. So two DISTINCT-key runs, which this
///     registry admits concurrently by design, still share one
///     `FaRunState`: B's `start_run` can erase a `Cancelled` meant for A.
///     The registry cannot fix that; only a per-key run state can. Today
///     nothing triggers it — `fa_cancel` is not invoked from anywhere in
///     `src/` (grepped) — but it is real.
/// Both want the same fix, and it needs a TS change this round is scoped out
/// of: pass the project id as a `jobKey` to `fa_align_production` AND to
/// `fa_cancel`, exactly as `useWhisper.ts` already passes `projectId`, then
/// key both this registry and `FaState` by it.
static IN_FLIGHT: crate::event_sink::InFlightRegistry<String, FaEvent> =
    crate::event_sink::InFlightRegistry::new();

/// Machine-readable prefix on the duplicate-run refusal, so the frontend can
/// tell "a run is already in flight for this key" apart from a missing model,
/// a hash mismatch, or an inference error. Mirrors `whisper.rs`'s
/// `IN_FLIGHT_REFUSAL_PREFIX` (`"whisper:already-running:"`) convention
/// exactly — same shape, this module's own namespace. `FaError` carries a
/// typed `kind` too (`AlreadyRunning`), but the prefix is what an existing TS
/// consumer can match today with no change: `describeInvokeError` already
/// surfaces `FaError.message` verbatim.
pub(crate) const IN_FLIGHT_REFUSAL_PREFIX: &str = "fa:already-running:";

/// This module's instantiation of the generic sink.
pub(crate) type FaSink = crate::event_sink::EventSink<FaEvent>;

/// Phrased as a statement about the run that IS in flight, not as a failure
/// of the one being refused — mirroring `whisper::in_flight_refusal`.
pub(crate) fn in_flight_refusal(key: &str) -> String {
    format!(
        "{IN_FLIGHT_REFUSAL_PREFIX} a forced-alignment run is already in progress for this audio          (run key {key}) — watch its progress or cancel it before starting another"
    )
}

/// Whether an FA run is in flight for this key right now.
///
/// Read-only, and deliberately NOT called before a claim: a test-then-acquire
/// pair is a race, and `try_acquire` already does both inside one critical
/// section. Its callers are this module's tests.
#[cfg(test)]
pub(crate) fn is_fa_run_in_flight(key: &str) -> bool {
    IN_FLIGHT.is_in_flight(key)
}

pub(crate) fn try_acquire_fa_run(
    key: &str,
    sink: std::sync::Arc<FaSink>,
) -> Option<crate::event_sink::InFlightGuard<String, FaEvent>> {
    IN_FLIGHT.try_acquire(key.to_string(), sink)
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
/// (see `docs/archive/history/work-in-progress.md` §4's word-timing-schema row for why
/// (`d18-index-trace-2026-08-14.md`'s Step 1 trace, the original source, was
/// deleted 2026-08-14, `9cf5867`; retrieve: `git show
/// 251be64:docs/ws1-sync-pipeline/d18-index-trace-2026-08-14.md`): neither
/// `FaWordSpan` nor `TranscriptToken` carried any
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
/// `docs/archive/history/work-in-progress.md` §4's R.7 confidence flag row for the full
/// three-option design writeup (`d19-r7-fallback-2026-08-14.md`, the
/// original source, was deleted 2026-08-14, `9cf5867`; retrieve: `git show
/// 251be64:docs/ws1-sync-pipeline/d19-r7-fallback-2026-08-14.md`).
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
    /// Permanent production stage timing for the run (WS3 fa-perf-
    /// foundation), emitted exactly ONCE per run, immediately before that
    /// run's terminal `Done` or `Error`. Not `#[cfg(test)]`, not behind a
    /// Cargo feature — a real Apply Sync reports where its wall clock went.
    ///
    /// A SEPARATE VARIANT, not a field appended to `Done`. Three reasons, in
    /// order of weight:
    ///
    ///   1. `Done` is sent only on success. The runs whose timing matters
    ///      most are the slow ones that then FAIL — a manifest mismatch after
    ///      a full ~1.26 GiB hash, an inference error at chunk 180 of 200.
    ///      Hanging timing off `Done` would report nothing for exactly those.
    ///      This variant is emitted on the success path, the error path, and
    ///      the `fa-inference`-off not-implemented path alike.
    ///   2. Timing is telemetry about the run; `Done`'s payload is the run's
    ///      RESULT. Keeping a fixed-size diagnostic beside a payload that can
    ///      carry thousands of words keeps the two independently readable.
    ///   3. It is additively safe at the TS boundary. Both existing consumers
    ///      (`forcedAlignmentRun.ts`, `App.tsx`'s `__faDevAlign`) dispatch on
    ///      `msg.event` with an if/else chain and no exhaustiveness check, so
    ///      an unrecognized tag is ignored rather than mishandled — whereas a
    ///      new REQUIRED field inside `Done` would silently be dropped by a
    ///      TS type that does not declare it, with nothing marking the drift.
    ///      `faBoundaryTypes.ts`'s `FaEvent` union still needs this variant
    ///      added by hand; see this round's report for that follow-up.
    ///
    /// `FaEvent` already derived `Clone` before this variant existed, and
    /// `FaRunTiming` is `Clone` — no derive change was needed.
    Timing { timing: crate::fa_timing::FaRunTiming },
}

// ---------------------------------------------------------------------------
// Model path resolver
// ---------------------------------------------------------------------------

// Format resolved as of WS1 Task 5 Slice D2: ONNX, exported per-language by
// `scripts/export-fa-onnx.py` into this same `fa-models/<lang>/` convention
// (ruling superseding the earlier "format unresolved" placeholder note —
// see docs/archive/history/work-in-progress.md §7 item 4; original source
// measurements/runtime-unblock-2026-08-12.md was deleted 2026-08-14,
// `9cf5867`; retrieve: `git show
// 251be64:docs/ws1-sync-pipeline/measurements/runtime-unblock-2026-08-12.md`).
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
pub(crate) fn fa_model_candidate_paths(
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
// (`docs/archive/history/work-in-progress.md` §5, D24/D25 rows; `task5-slice-ledger.md` §6,
// the original source, was deleted 2026-08-14, `9cf5867`; retrieve: `git show
// 251be64:docs/ws1-sync-pipeline/task5-slice-ledger.md`): `fa_align` takes a
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
const FA_AUDIO_CACHE_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Pure path builder — no filesystem access — mirrors
/// `fa_model_candidate_paths`'s own split so this half is directly
/// unit-testable without a live `tauri::AppHandle`.
fn fa_audio_cache_dir_from_local_data_dir(local_data_dir: &Path) -> PathBuf {
    local_data_dir.join(FA_AUDIO_CACHE_DIRNAME)
}

/// `AppHandle`-based wrapper — see the pure builder above for the tested
/// half, mirroring `fa_model_path`'s own split. Reachable in every build (not
/// just `cfg(test)`) since WS1 Task 5 Slice D25 A1 wired `ensure_durable_wav`
/// into `fa_dev.rs`'s `fa_align_dev` — no longer `allow(dead_code)`.
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
fn evict_lru_until_under_cap(cache_dir: &Path, max_bytes: u64) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else { return };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total: u64 = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("wav") {
            // Skips anything not a finalized `.wav` entry — a stray non-cache
            // file, AND (WS1 Task 5 Slice D25 A2a) the `.tmp/` subdirectory
            // holding in-progress writes: `Path::extension()` on a bare
            // `.tmp` directory name is `None` (a leading-dot name has no
            // extension by Rust's own convention), so it's excluded the same
            // way a non-`.wav` file would be — this loop is non-recursive
            // and never descends into `.tmp/` regardless.
            continue;
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
///
/// **Concurrency (WS1 Task 5 Slice D25 A2b).** `tmp_path` is per-CALL unique
/// (a UUID suffix, `uuid` already a direct dependency — no new crate), not
/// derived solely from `key`. Two concurrent misses on the SAME source used
/// to resolve to the identical deterministic tmp path — two ffmpeg sidecar
/// processes would then race to write the SAME file, and whichever
/// `finalize_cache_write` rename ran first could be clobbered mid-write by
/// the other process still appending to that now-renamed-away path, or the
/// two writers' output could interleave, corrupting the WAV a third caller
/// might already be reading as a "finalized" hit. A unique tmp path per call
/// makes that structurally impossible: each writer owns its own tmp file
/// exclusively, so by the time either reaches `finalize_cache_write`, its
/// own tmp file is already a complete, valid transcode. Both callers'
/// renames still target the same `final_path`, and a real filesystem
/// `rename` is atomic — the second rename to complete simply replaces the
/// first atomically (last-writer-wins), never leaving a torn/partial file
/// visible to a concurrent reader, and never leaking a leftover tmp file
/// that later contended for the same name.
///
/// **Tmp file location and naming (WS1 Task 5 Slice D25 A1/A2a) — a real
/// `cargo test --test fa_durable_wav_live` run against the real 173 corpus
/// caught a bug in an earlier version of this function that named the tmp
/// file `{key}.{unique}.wav.tmp`: ffmpeg's own output-format auto-detection
/// (`whisper.rs::transcode_to_wav` passes no explicit `-f`, protected from
/// edits this slice) keys off the LITERAL trailing filename extension, which
/// for that name was `.tmp`, not `.wav` — every real transcode into the
/// cache failed with "Unable to choose an output format," never caught
/// before because nothing had exercised this with a real `AppHandle` and a
/// real ffmpeg invocation until this slice.** Fixed by giving the tmp file a
/// name ffmpeg's own extension-sniffing recognizes (`{key}.{unique}.wav`,
/// no `.tmp` suffix) while keeping it excluded from
/// [`evict_lru_until_under_cap`]'s accounting — not via a naming
/// convention this time, but a SEPARATE `.tmp/` subdirectory of `cache_dir`
/// that eviction's own non-recursive `read_dir` never descends into. Still
/// "in the destination directory" for the atomicity guarantee this
/// function's own doc comment above states (`fs::rename` is atomic within a
/// filesystem, not a directory — `.tmp/` is a child of `cache_dir`, same
/// filesystem, same mount, always).
fn resolve_cache_entry(cache_dir: &Path, source_path: &Path) -> Result<CacheLookup, FaError> {
    std::fs::create_dir_all(cache_dir)
        .map_err(|e| FaError::inference_failed(format!("create FA audio cache dir {}: {e}", cache_dir.display())))?;
    let tmp_dir = cache_dir.join(".tmp");
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| FaError::inference_failed(format!("create FA audio cache tmp dir {}: {e}", tmp_dir.display())))?;

    let key = source_identity_key(source_path)
        .map_err(|e| FaError::inference_failed(format!("stat source media {}: {e}", source_path.display())))?;
    let final_path = cache_dir.join(format!("{key}.wav"));

    if final_path.exists() {
        if let Ok(file) = std::fs::File::open(&final_path) {
            let _ = file.set_modified(std::time::SystemTime::now());
        }
        return Ok(CacheLookup::Hit(final_path));
    }

    let unique = uuid::Uuid::new_v4();
    let tmp_path = tmp_dir.join(format!("{key}.{unique}.wav"));
    Ok(CacheLookup::Miss { tmp_path, final_path })
}

/// Finalizes a successful transcode: renames the `.tmp` file into place
/// (atomic on every target OS this codebase ships for — a reader can never
/// observe a partially-written `.wav`), then runs the LRU eviction pass.
/// Called only after the caller's own transcode step has already succeeded
/// against `tmp_path`.
fn finalize_cache_write(tmp_path: &Path, final_path: &Path, cache_dir: &Path) -> Result<PathBuf, FaError> {
    std::fs::rename(tmp_path, final_path).map_err(|e| {
        let _ = std::fs::remove_file(tmp_path);
        FaError::inference_failed(format!("finalize durable WAV cache entry: {e}"))
    })?;
    evict_lru_until_under_cap(cache_dir, FA_AUDIO_CACHE_MAX_BYTES);
    Ok(final_path.to_path_buf())
}

/// Production-shaped entry point (WS1 Task 5 Slice D24 B1). Its only caller
/// is `fa_dev.rs`'s dev-only `fa_align_dev` (WS1 Task 5 Slice D25 A1) —
/// still no production/UI-reachable caller; `fa_align_dev` itself is
/// console-only, per its own module doc comment. Resolves the cache
/// directory via a live `AppHandle` and transcodes for real via
/// `whisper.rs::transcode_to_wav` (unchanged, reused as-is per D24's own
/// scope — Track B never modified `whisper.rs`) rather than a
/// reimplementation. On a cache hit, this never spawns ffmpeg at all.
///
/// `pub`, not `pub(crate)` (WS1 Task 5 Slice D25 A1): `fa_align_dev`'s own
/// `verify_model_manifest` step hashes the full ~1.2 GiB `model.onnx` on
/// EVERY call (a pre-existing, unrelated D10 fixed cost, independent of this
/// function), which dominates an end-to-end `fa_align_dev` wall-clock
/// measurement and would mask this function's own miss-vs-hit timing signal.
/// `tests/fa_durable_wav_live.rs` (an integration-test crate, so it can only
/// reach `pub` items) calls this directly for an isolated measurement, in
/// addition to going through the real `fa_align_dev` for the end-to-end
/// wiring proof. A compile-time-only visibility widening — zero runtime
/// effect, same as the `mod fa`/`mod fa_dev` widening in `lib.rs`.
pub async fn ensure_durable_wav(app: &tauri::AppHandle, source_path: &Path) -> Result<PathBuf, FaError> {
    ensure_durable_wav_timed(app, source_path).await.map(|(path, _hit)| path)
}

/// [`ensure_durable_wav`] plus the one bit its caller cannot infer: whether
/// the durable WAV was already on disk (`true`) or had to be transcoded by a
/// full ffmpeg sidecar run (`false`). WS3 fa-perf-foundation — a cache hit
/// and a miss differ by seconds on a long voiceover, and a timing report
/// that could not tell them apart would attribute a hit's near-zero cost and
/// a miss's multi-second transcode to the same stage with no way to read the
/// difference.
///
/// The body is byte-for-byte the pre-WS3 [`ensure_durable_wav`], with the
/// hit/miss flag added to each arm's return; the public wrapper above keeps
/// the old signature so `tests/fa_durable_wav_live.rs` and every other
/// existing caller are untouched.
pub async fn ensure_durable_wav_timed(
    app: &tauri::AppHandle,
    source_path: &Path,
) -> Result<(PathBuf, bool), FaError> {
    let cache_dir = fa_audio_cache_dir(app)?;
    match resolve_cache_entry(&cache_dir, source_path)? {
        CacheLookup::Hit(path) => Ok((path, true)),
        CacheLookup::Miss { tmp_path, final_path } => {
            if let Err(e) = crate::whisper::transcode_to_wav(app, source_path, &tmp_path).await {
                let _ = std::fs::remove_file(&tmp_path);
                return Err(FaError::inference_failed(format!("transcode to durable WAV failed: {e}")));
            }
            finalize_cache_write(&tmp_path, &final_path, &cache_dir).map(|p| (p, false))
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
/// capability-gated Settings toggle, per `docs/archive/history/work-in-progress.md` §11
/// item 1's ruling — `task5-slice-ledger.md`, the original source, was
/// deleted 2026-08-14, `9cf5867`; retrieve: `git show
/// 251be64:docs/ws1-sync-pipeline/task5-slice-ledger.md`) is a later, separately-scoped slice.
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
    // A direct `fa_align` call did no staging, no manifest verification and
    // no durable-WAV resolution of its own, so its prefix stages are genuinely
    // zero/unknown — `FaStagePrefix::default()` says exactly that (a `None`
    // `staging_nanos`, not a fabricated 0 ms). `resolve_wav_and_align` is the
    // caller that has real numbers for those, and it passes them.
    fa_align_with_prefix(
        app,
        state,
        model_cache,
        audio_path,
        chunks,
        language,
        on_event,
        crate::fa_timing::FaStagePrefix::default(),
        std::time::Instant::now(),
    )
    .await
}

/// [`fa_align`]'s real body, plus the pre-`fa_align` stage measurements its
/// caller already made (WS3 fa-perf-foundation).
///
/// `run_started` is the caller's OWN run clock, not one minted here: for a
/// production run the wall clock that matters starts at
/// `resolve_wav_and_align`'s first statement, before the ~1.26 GiB manifest
/// hash and the durable-WAV transcode, so `totalMs` covers those rather than
/// beginning after the two most expensive prefix stages have already
/// finished.
///
/// `FaEvent::Timing` is emitted on EVERY exit path — success, inference
/// error, and the `fa-inference`-off not-implemented arm — always immediately
/// before the terminal `Done`/`Error`, so a consumer that has seen a terminal
/// event has already seen this run's timing.
#[allow(unused_variables, clippy::too_many_arguments)]
pub(crate) async fn fa_align_with_prefix(
    app: tauri::AppHandle,
    state: tauri::State<'_, FaState>,
    model_cache: tauri::State<'_, FaModelCache>,
    audio_path: String,
    chunks: Vec<FaChunkInput>,
    language: String,
    on_event: Channel<FaEvent>,
    prefix: crate::fa_timing::FaStagePrefix,
    run_started: std::time::Instant,
) -> Result<(), FaError> {
    start_run(&state)?;

    #[cfg(feature = "fa-inference")]
    {
        // OFFLOAD (WS3 fa-perf-foundation). `align_chunked_for_language` is
        // fully synchronous and, on a real corpus, runs for MINUTES — a live
        // 3-chunk window of the 173 corpus measured 12.4 s of forward pass
        // alone. Running that directly in this `async fn` body parks a Tauri
        // async-runtime worker thread for the whole alignment, during which
        // every other IPC command scheduled onto that worker — `fa_cancel`
        // included — waits. `spawn_blocking` moves it onto the blocking pool,
        // mirroring `models.rs`'s `import_local_model` and
        // `model_download.rs`'s `finalize_verified_download`.
        //
        // MOVING THE `State` BORROWS. `tauri::State<'r, T>` carries the
        // lifetime of the borrow it was resolved from, so neither `state` nor
        // `model_cache` can cross into a `move` closure that must be
        // `Send + 'static`. An `AppHandle` can: it is `Clone`, `Send` and
        // `'static` by construction. So the closure captures a CLONE of the
        // handle and re-resolves both pieces of managed state from it on the
        // blocking thread (`app.state::<T>()`), producing `State` values whose
        // lifetimes are local to the closure. Both resolve to the very same
        // `Mutex`es the async side holds — `.manage()` stores one instance per
        // type for the process — so this is a re-BORROW, not a copy: nothing
        // is duplicated and no state can diverge between the two threads.
        //
        // CANCELLATION still works, and works better than before. `fa_cancel`
        // is a separate command that flips that same managed `FaState` mutex;
        // `align_chunked` polls `is_cancelled` at every chunk boundary from
        // the blocking thread and returns `Err(Cancelled)` before starting the
        // next chunk. Previously a cancel issued mid-alignment could not even
        // be SERVICED until the alignment released the async worker; now the
        // async runtime is free the whole time the blocking thread is busy.
        //
        // THE `with_cached_session` MUTEX INVARIANT SURVIVES, and is in fact
        // strengthened. That function holds the model-cache lock across `f`,
        // which is sound only if `f` never `.await`s. Here `f` runs inside a
        // synchronous `FnOnce` on a blocking thread, where an `.await` is not
        // merely absent but syntactically impossible — there is no async
        // context to await in. `fa_timing`'s `no_await_*` guards assert both
        // halves of that in the source.
        let app_for_blocking = app.clone();
        let audio_path_for_blocking = audio_path.clone();
        let chunks_for_blocking = chunks.clone();
        let language_for_blocking = language.clone();
        let events_for_blocking = on_event.clone();
        let joined = tauri::async_runtime::spawn_blocking(move || {
            let blocking_state = app_for_blocking.state::<FaState>();
            let blocking_cache = app_for_blocking.state::<FaModelCache>();
            let total = chunks_for_blocking.len() as u32;
            let on_progress = |index: u32| {
                let _ = events_for_blocking.send(FaEvent::Progress { index, total });
            };
            let mut inference = crate::fa_timing::FaInferenceTimings::default();
            let result = crate::fa_onnx::align_chunked_for_language(
                &app_for_blocking,
                &blocking_cache.0,
                &audio_path_for_blocking,
                &chunks_for_blocking,
                &language_for_blocking,
                || is_cancelled(&blocking_state),
                on_progress,
                &mut inference,
            );
            (result, inference)
        })
        .await;

        // A join failure means the blocking task panicked or the pool shut
        // down. `finish_run` first, unconditionally: the run state must return
        // to Idle whatever happened, or the next run inherits a stale
        // `Running`/`Cancelled`. Reported as `InferenceFailed` rather than
        // being allowed to propagate as a panic across the IPC boundary.
        let (result, inference) = match joined {
            Ok(pair) => pair,
            Err(e) => {
                finish_run(&state)?;
                let err = FaError::inference_failed(format!(
                    "forced alignment task failed to complete on the blocking pool: {e}"
                ));
                let _ = on_event.send(FaEvent::Error { message: err.message.clone() });
                return Err(err);
            }
        };
        finish_run(&state)?;
        // Sent before the terminal event on BOTH arms — an inference that
        // failed at chunk 180 of 200 still reports the 180 chunks it timed.
        let _ = on_event.send(FaEvent::Timing {
            timing: crate::fa_timing::FaRunTiming::assemble(
                prefix,
                inference,
                elapsed_nanos(run_started),
            ),
        });
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
        // Emitted even here: with the feature off there are no inference
        // stages to report, but the prefix stages (staging, durable WAV,
        // manifest verification) genuinely ran and genuinely cost time, and a
        // build that reported nothing at all would make the timing surface
        // feature-conditional — which this one deliberately is not.
        let _ = on_event.send(FaEvent::Timing {
            timing: crate::fa_timing::FaRunTiming::assemble(
                prefix,
                crate::fa_timing::FaInferenceTimings::default(),
                elapsed_nanos(run_started),
            ),
        });
        let _ = on_event.send(FaEvent::Error { message: err.message.clone() });

        finish_run(&state)?;
        Err(err)
    }
}

/// `Instant::elapsed` as saturating whole nanoseconds — the one conversion
/// every timing call site in this module shares. Saturating rather than
/// wrapping for the same reason `fa_timing::StageAccumulator::record`
/// saturates: telemetry must never be able to fail the run it measures.
pub(crate) fn elapsed_nanos(since: std::time::Instant) -> u64 {
    u64::try_from(since.elapsed().as_nanos()).unwrap_or(u64::MAX)
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

    // -- A2: atomicity, concurrency, real-cap eviction, stale source
    // (WS1 Task 5 Slice D25) ----------------------------------------------

    #[test]
    fn resolve_cache_entry_tmp_path_lives_under_a_dot_tmp_subdir_of_cache_dir() {
        // A2a: the .tmp write target must be in the DESTINATION directory
        // (a subdirectory of it counts — same filesystem, `fs::rename`
        // atomicity is a same-filesystem guarantee, not a same-directory
        // one), never a system temp dir. A cross-filesystem tmp location
        // would make `finalize_cache_write`'s rename NON-atomic (silently
        // falling back to copy+delete on some platforms, or erroring on
        // others) and is the specific failure mode this test guards against.
        let dir = durable_wav_test_dir("tmp-in-dest-dir");
        let cache_dir = dir.join("cache");
        std::fs::create_dir_all(&dir).unwrap();
        let source_path = dir.join("source.wav");
        std::fs::write(&source_path, b"source audio bytes").unwrap();

        let tmp_path = match resolve_cache_entry(&cache_dir, &source_path).unwrap() {
            CacheLookup::Miss { tmp_path, .. } => tmp_path,
            CacheLookup::Hit(_) => panic!("expected a miss"),
        };
        assert!(tmp_path.starts_with(cache_dir.join(".tmp")), "tmp_path {} must live under cache_dir/.tmp", tmp_path.display());
        assert_eq!(tmp_path.extension().and_then(|e| e.to_str()), Some("wav"), "tmp filename must end in .wav so ffmpeg's own extension-based format auto-detection succeeds (D25 A1's live-corpus finding)");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_cache_entry_concurrent_misses_on_the_same_source_get_distinct_tmp_paths() {
        // A2b: two "concurrent" callers (simulated here as two sequential
        // calls before either finalizes — the real concurrency hazard is
        // about the TMP PATH THEY'D BOTH WRITE TO, which resolve_cache_entry
        // decides synchronously and independently of any other in-flight
        // call, so two sequential calls exercise the exact same decision two
        // real concurrent async tasks would each make) resolving a miss on
        // the SAME source must never be handed the same tmp_path — that was
        // the actual bug: a deterministic `{key}.wav.tmp` name meant two
        // real ffmpeg processes would both target the identical file.
        let dir = durable_wav_test_dir("concurrent-miss");
        let cache_dir = dir.join("cache");
        std::fs::create_dir_all(&dir).unwrap();
        let source_path = dir.join("source.wav");
        std::fs::write(&source_path, b"source audio bytes").unwrap();

        let tmp_path_a = match resolve_cache_entry(&cache_dir, &source_path).unwrap() {
            CacheLookup::Miss { tmp_path, .. } => tmp_path,
            CacheLookup::Hit(_) => panic!("expected a miss (caller A)"),
        };
        let tmp_path_b = match resolve_cache_entry(&cache_dir, &source_path).unwrap() {
            CacheLookup::Miss { tmp_path, .. } => tmp_path,
            CacheLookup::Hit(_) => panic!("expected a miss (caller B) — final_path must not exist yet, neither caller has finalized"),
        };
        assert_ne!(tmp_path_a, tmp_path_b, "two concurrent misses on the same source must never share a tmp path");

        // Both "writers" independently succeed (each owns its own file, so
        // no interleaving is even possible), and whichever finalizes last
        // atomically wins — never a torn/partial final file.
        std::fs::write(&tmp_path_a, b"writer A's transcode").unwrap();
        std::fs::write(&tmp_path_b, b"writer B's transcode").unwrap();
        let final_path_a = cache_dir.join(format!("{}.wav", source_identity_key(&source_path).unwrap()));
        finalize_cache_write(&tmp_path_a, &final_path_a, &cache_dir).unwrap();
        let final_path_b = finalize_cache_write(&tmp_path_b, &final_path_a, &cache_dir).unwrap();
        assert_eq!(final_path_b, final_path_a, "both writers target the same final_path (same source identity)");
        assert_eq!(std::fs::read(&final_path_a).unwrap(), b"writer B's transcode", "last rename to complete wins atomically — no interleaving, no torn file");
        assert!(!tmp_path_a.exists() && !tmp_path_b.exists(), "both tmp files must be gone after finalize (renamed away)");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn evict_lru_until_under_cap_at_the_real_cap_respects_a_recent_touch_over_creation_order() {
        // A2c, using the REAL production constant (FA_AUDIO_CACHE_MAX_BYTES,
        // 2 GiB), not a scaled-down stand-in. Sparse files (`File::set_len`,
        // no bytes actually written) keep this fast and disk-light while
        // still reporting real logical sizes via `metadata().len()` — the
        // only thing `evict_lru_until_under_cap` ever reads.
        //
        // `entry_c` is created FIRST (would be the natural LRU-eviction
        // target by creation order) but its mtime is bumped to "now" AFTER
        // every other entry is created — simulating "this entry was just
        // used" (`resolve_cache_entry`'s own hit re-stamp). If the in-use
        // entry were NOT protected, it would be evicted first; this test
        // confirms it survives while an entry nobody touched again does not.
        let dir = durable_wav_test_dir("evict-real-cap-in-use");
        std::fs::create_dir_all(&dir).unwrap();

        let entry_c = dir.join("c-oldest-by-creation-but-touched-last.wav");
        std::fs::File::create(&entry_c).unwrap().set_len(1200 * 1024 * 1024).unwrap();
        let entry_a = dir.join("a.wav");
        std::fs::File::create(&entry_a).unwrap().set_len(600 * 1024 * 1024).unwrap();
        let entry_b = dir.join("b.wav");
        std::fs::File::create(&entry_b).unwrap().set_len(700 * 1024 * 1024).unwrap();
        // Total = 2500 MiB > 2048 MiB (FA_AUDIO_CACHE_MAX_BYTES). Distinct
        // mtimes, strictly increasing by creation EXCEPT entry_c, touched
        // last so it becomes the newest by mtime despite being oldest by
        // creation.
        let now = std::time::SystemTime::now();
        std::fs::File::open(&entry_a).unwrap().set_modified(now - std::time::Duration::from_secs(200)).unwrap();
        std::fs::File::open(&entry_b).unwrap().set_modified(now - std::time::Duration::from_secs(100)).unwrap();
        std::fs::File::open(&entry_c).unwrap().set_modified(now).unwrap(); // the "just used" touch

        evict_lru_until_under_cap(&dir, FA_AUDIO_CACHE_MAX_BYTES);

        assert!(!entry_a.exists(), "the oldest-by-mtime entry must be evicted first, even though it was created AFTER the in-use entry");
        assert!(entry_b.exists(), "entry_b was never the oldest by mtime and must survive");
        assert!(entry_c.exists(), "the recently-touched (in-use) entry must survive despite being oldest by creation order");
        let remaining: u64 = [&entry_b, &entry_c].iter().map(|p| std::fs::metadata(p).unwrap().len()).sum();
        assert!(remaining <= FA_AUDIO_CACHE_MAX_BYTES, "cache must be at or under the real 2 GiB cap after eviction, was {remaining} bytes");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_cache_entry_edited_source_is_a_miss_and_never_serves_the_old_final_path() {
        // A2d, end-to-end (not just source_identity_key's own already-tested
        // sensitivity in isolation): confirms `resolve_cache_entry` itself
        // treats an edited source as a genuine miss with a DIFFERENT
        // final_path, and that the OLD entry's own bytes are never touched
        // or served under the new identity.
        let dir = durable_wav_test_dir("stale-source-e2e");
        let cache_dir = dir.join("cache");
        std::fs::create_dir_all(&dir).unwrap();
        let source_path = dir.join("source.wav");
        std::fs::write(&source_path, b"original source bytes").unwrap();

        let (tmp1, final1) = match resolve_cache_entry(&cache_dir, &source_path).unwrap() {
            CacheLookup::Miss { tmp_path, final_path } => (tmp_path, final_path),
            CacheLookup::Hit(_) => panic!("expected a miss on a never-before-seen source"),
        };
        std::fs::write(&tmp1, b"OLD transcoded wav bytes").unwrap();
        finalize_cache_write(&tmp1, &final1, &cache_dir).unwrap();

        // Edit the source: same path/name, different size.
        std::fs::write(&source_path, b"a completely different, longer edited source payload").unwrap();

        match resolve_cache_entry(&cache_dir, &source_path).unwrap() {
            CacheLookup::Miss { tmp_path: tmp2, final_path: final2 } => {
                assert_ne!(final2, final1, "an edited source must mint a NEW cache key/final_path, not reuse the old one");
                assert!(!final2.exists(), "the new key's entry must not exist yet");
                // The OLD entry is left exactly as it was — orphaned, not
                // served, not deleted here (LRU eviction is the only thing
                // that reclaims it, per this function's own doc comment).
                assert!(final1.exists(), "the old entry must still exist, untouched");
                assert_eq!(std::fs::read(&final1).unwrap(), b"OLD transcoded wav bytes", "the old entry's bytes must be unchanged — never overwritten in place");
                let _ = tmp2;
            }
            CacheLookup::Hit(path) => panic!("an edited source must NEVER be served as a hit against the old entry, got {}", path.display()),
        }

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
                | FaErrorKind::Cancelled
                | FaErrorKind::AlreadyRunning => {}
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
            // WS3 fa-perf-foundation. NOTE, deliberately recorded rather than
            // silently accepted: `faBoundaryTypes.ts`'s `FaErrorKind` union
            // does NOT yet carry `'alreadyRunning'`. This round is scoped to
            // `src-tauri/` and cannot add it. The drift is one-way and inert
            // at runtime (nothing in `src/` switches on `FaError.kind`; both
            // FA consumers read `message`, which carries
            // `IN_FLIGHT_REFUSAL_PREFIX` and is what `describeInvokeError`
            // surfaces), but it IS drift, and this comment is the record.
            (FaErrorKind::AlreadyRunning, "alreadyRunning"),
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

    // -- single flight (WS3 fa-perf-foundation) ---------------------------
    //
    // `start_run` used to write `Running` unconditionally with no in-flight
    // check, so two concurrent runs both proceeded and the second clobbered
    // the first's cancel state. The gate is now a claim on `IN_FLIGHT`, taken
    // in `resolve_wav_and_align` before any expensive work.

    fn noop_sink() -> std::sync::Arc<FaSink> {
        std::sync::Arc::new(FaSink::new(Channel::new(|_body| Ok(()))))
    }

    #[test]
    fn a_second_run_for_the_same_key_is_refused_while_the_first_holds_it() {
        let key = "/tmp/kinetix-fa-production-inputs/aaaa.wav";
        let first = try_acquire_fa_run(key, noop_sink()).expect("the first claim must succeed");
        assert!(is_fa_run_in_flight(key));
        assert!(
            try_acquire_fa_run(key, noop_sink()).is_none(),
            "a second run over the same staged audio must be REFUSED, not allowed to proceed and              clobber the first run's cancel state"
        );
        drop(first);
        assert!(
            try_acquire_fa_run(key, noop_sink()).is_some(),
            "the key must be reclaimable once the first run releases it"
        );
    }

    #[test]
    fn the_refusal_message_carries_the_exact_machine_readable_prefix() {
        let msg = in_flight_refusal("/tmp/x.wav");
        assert!(
            msg.starts_with("fa:already-running:"),
            "the frontend distinguishes a duplicate-run refusal by this prefix — mirroring              whisper's `whisper:already-running:` convention. Got: {msg}"
        );
        assert!(msg.contains("/tmp/x.wav"), "the refusal must name the key it is about");
    }

    #[test]
    fn the_refusal_is_typed_as_already_running_and_is_not_mistakable_for_another_failure() {
        let err = FaError::already_running(in_flight_refusal("/tmp/x.wav"));
        assert_eq!(err.kind, FaErrorKind::AlreadyRunning);
        assert!(err.message.starts_with(IN_FLIGHT_REFUSAL_PREFIX));
        // Non-vacuity: no OTHER FaError this module builds may collide with
        // the prefix, or the frontend's match would fire on the wrong thing.
        for other in [
            FaError::inference_failed("onnx blew up"),
            FaError::cancelled("user cancelled"),
            FaError::model_not_found("no model"),
            FaError::state_lock_poisoned(),
        ] {
            assert!(
                !other.message.starts_with(IN_FLIGHT_REFUSAL_PREFIX),
                "{:?} must not be mistaken for an already-running refusal",
                other.kind
            );
        }
    }

    #[test]
    fn distinct_keys_stay_concurrent() {
        // Two different staged inputs are two different runs; single flight
        // must not serialize them at the registry. (They still serialize on
        // the model-cache mutex once inside `align_chunked` — that is a
        // separate, deliberate mechanism, asserted in `fa_timing`'s source
        // guards, not here.)
        let a = try_acquire_fa_run("/tmp/kinetix-fa-production-inputs/aa.wav", noop_sink()).expect("a");
        let b = try_acquire_fa_run("/tmp/kinetix-fa-production-inputs/bb.wav", noop_sink())
            .expect("a different staged input must not be blocked by an unrelated run");
        assert!(is_fa_run_in_flight("/tmp/kinetix-fa-production-inputs/aa.wav"));
        assert!(is_fa_run_in_flight("/tmp/kinetix-fa-production-inputs/bb.wav"));
        drop(a);
        drop(b);
    }

    #[test]
    fn the_claim_releases_on_all_four_exit_paths() {
        // The four exits `resolve_wav_and_align` actually has. Each is
        // modelled by a scope holding a real guard, because the release
        // mechanism under test is `Drop` — which is why there is no explicit
        // release call in the command body at all.
        let key = "/tmp/kinetix-fa-production-inputs/release.wav";

        // 1. Success: the tail call returns Ok and the guard drops with it.
        {
            let _g = try_acquire_fa_run(key, noop_sink()).expect("claim");
        }
        assert!(!is_fa_run_in_flight(key), "released on the success path");

        // 2. Error: an early `?` (no model, hash mismatch, transcode failure).
        fn errors_out(key: &str) -> Result<(), FaError> {
            let _g = try_acquire_fa_run(key, noop_sink()).ok_or_else(FaError::state_lock_poisoned)?;
            Err(FaError::inference_failed("model missing"))
        }
        assert!(errors_out(key).is_err());
        assert!(!is_fa_run_in_flight(key), "released on the error path");

        // 3. Cancel: `fa_cancel` flips FaState, align_chunked returns
        //    Err(Cancelled), that propagates out through the tail call and the
        //    guard drops — cancel never removes the entry itself.
        fn cancelled_run(key: &str) -> Result<(), FaError> {
            let _g = try_acquire_fa_run(key, noop_sink()).ok_or_else(FaError::state_lock_poisoned)?;
            Err(FaError::cancelled("forced alignment was cancelled"))
        }
        assert_eq!(cancelled_run(key).unwrap_err().kind, FaErrorKind::Cancelled);
        assert!(!is_fa_run_in_flight(key), "released on the cancel path");

        // 4. Panic: an unwind must not leave the key permanently unclaimable.
        let unwound = std::panic::catch_unwind(|| {
            let _g = try_acquire_fa_run(key, noop_sink()).expect("claim");
            panic!("boom");
        });
        assert!(unwound.is_err());
        assert!(!is_fa_run_in_flight(key), "released on the panic path");

        assert!(
            try_acquire_fa_run(key, noop_sink()).is_some(),
            "the key must be reclaimable after every one of those four exits"
        );
    }

    #[test]
    fn a_refused_run_does_not_disturb_the_claim_it_was_refused_for() {
        // The bug this whole commit exists for, stated as an assertion: the
        // loser must change nothing about the winner.
        let key = "/tmp/kinetix-fa-production-inputs/undisturbed.wav";
        let winner = try_acquire_fa_run(key, noop_sink()).expect("claim");
        for _ in 0..5 {
            assert!(try_acquire_fa_run(key, noop_sink()).is_none());
            assert!(is_fa_run_in_flight(key), "a refused duplicate must leave the running claim intact");
        }
        drop(winner);
        assert!(!is_fa_run_in_flight(key));
    }

    // -- offload to the blocking pool (WS3 fa-perf-foundation) ------------
    //
    // The alignment call now runs under `tauri::async_runtime::spawn_blocking`
    // instead of inline in an `async fn`. The one behaviour that has to
    // survive that move is cancellation: `fa_cancel` runs on the async
    // runtime and flips `FaState`, while the run polls `is_cancelled` from a
    // blocking-pool thread. These prove the signal actually crosses that
    // thread boundary — which is the genuinely new thing here, and is not
    // implied by any of the existing single-threaded state-machine tests
    // above.

    /// Stands in for `align_chunked`'s chunk-boundary cancellation poll:
    /// checks `is_cancelled` repeatedly, returns `true` the moment it sees
    /// the flag, and gives up at `deadline` otherwise.
    fn poll_until_cancelled_or(state: &FaState, deadline: std::time::Duration) -> bool {
        let started = std::time::Instant::now();
        while started.elapsed() < deadline {
            if is_cancelled(state) {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        false
    }

    #[test]
    fn cancellation_lands_on_a_run_already_executing_on_the_blocking_pool() {
        let state = std::sync::Arc::new(FaState::default());
        start_run(&state).unwrap();

        let (running_tx, running_rx) = std::sync::mpsc::channel::<()>();
        let polling_state = state.clone();
        let handle = tauri::async_runtime::spawn_blocking(move || {
            // Only signal once we are genuinely executing on the pool, so the
            // cancel below cannot land before the run started and pass for the
            // wrong reason.
            running_tx.send(()).expect("receiver is alive");
            poll_until_cancelled_or(&polling_state, std::time::Duration::from_secs(10))
        });

        running_rx.recv().expect("the blocking task must reach its poll loop");
        // This is `fa_cancel`'s side: a DIFFERENT thread from the one running
        // the alignment, touching the same managed `FaState`.
        cancel_run(&state).unwrap();

        let observed = tauri::async_runtime::block_on(handle).expect("blocking task must join");
        assert!(
            observed,
            "a cancel issued while the run is on the blocking pool must be observed by the run's own              chunk-boundary poll — otherwise fa_cancel is inert once the offload starts"
        );
    }

    #[test]
    fn a_run_on_the_blocking_pool_that_is_never_cancelled_reports_no_cancellation() {
        // Non-vacuity for the test above: the poll must be capable of
        // returning `false`, or "observed a cancel" proves nothing.
        let state = std::sync::Arc::new(FaState::default());
        start_run(&state).unwrap();
        let polling_state = state.clone();
        let handle = tauri::async_runtime::spawn_blocking(move || {
            poll_until_cancelled_or(&polling_state, std::time::Duration::from_millis(50))
        });
        let observed = tauri::async_runtime::block_on(handle).expect("blocking task must join");
        assert!(!observed, "nothing cancelled this run, so its poll must never report a cancellation");
    }

    #[test]
    fn a_cancelled_run_still_returns_to_idle_after_the_blocking_task_joins() {
        // `finish_run` runs after the join on every path, so a cancelled run's
        // transient signal cannot bleed into the next run — the same guarantee
        // `cancelled_run_resets_to_idle_and_no_longer_reads_as_cancelled`
        // proves for the inline path, re-proved across the thread boundary.
        let state = std::sync::Arc::new(FaState::default());
        start_run(&state).unwrap();
        let (running_tx, running_rx) = std::sync::mpsc::channel::<()>();
        let polling_state = state.clone();
        let handle = tauri::async_runtime::spawn_blocking(move || {
            running_tx.send(()).unwrap();
            poll_until_cancelled_or(&polling_state, std::time::Duration::from_secs(10))
        });
        running_rx.recv().unwrap();
        cancel_run(&state).unwrap();
        assert!(tauri::async_runtime::block_on(handle).unwrap());

        finish_run(&state).unwrap();
        assert_eq!(*state.0.lock().unwrap(), FaRunState::Idle);
        assert!(!is_cancelled(&state));
    }

    // -- FaEvent::Timing wire shape (WS3 fa-perf-foundation) --------------

    #[test]
    fn fa_event_timing_serializes_the_tagged_shape_the_other_variants_use() {
        let event = FaEvent::Timing { timing: crate::fa_timing::FaRunTiming::default() };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["event"], serde_json::json!("Timing"), "tag stays PascalCase, like Progress/Done/Error");
        assert!(json["data"]["timing"].is_object(), "payload must sit under `data`, matching the enum's serde attrs");
    }

    #[test]
    fn fa_event_timing_reports_every_requested_stage_on_a_fully_populated_run() {
        // The "every stage populated" gate. A synthetic run in which every
        // stage genuinely cost something, asserted field by field — a stage
        // wired to a hardcoded zero, or omitted from the DTO entirely, fails
        // here rather than shipping as a silently missing column.
        let prefix = crate::fa_timing::FaStagePrefix {
            staging_nanos: Some(121_000_000),
            durable_wav_nanos: 3_400_000_000,
            durable_wav_cache_hit: false,
            manifest_verify_nanos: 5_250_000_000,
            manifest_digest_cache_hit: false,
        };
        let mut inference = crate::fa_timing::FaInferenceTimings {
            model: crate::fa_timing::ModelLoadReport { cache_hit: false, load_nanos: 880_000_000 },
            chunks: Default::default(),
        };
        for i in 1..=3u64 {
            inference.chunks.forward.record(std::time::Duration::from_millis(40 * i));
            inference.chunks.viterbi.record(std::time::Duration::from_millis(5 * i));
            inference.chunks.tokenize.record(std::time::Duration::from_micros(300 * i));
        }
        let event = FaEvent::Timing {
            timing: crate::fa_timing::FaRunTiming::assemble(prefix, inference, 12_000_000_000),
        };
        let json = serde_json::to_value(&event).unwrap();
        let t = &json["data"]["timing"];

        // 1. raw-body staging
        assert_eq!(t["stagingMs"], serde_json::json!(121.0));
        // 2. durable WAV transcode, with hit/miss
        assert_eq!(t["durableWavMs"], serde_json::json!(3400.0));
        assert_eq!(t["durableWavCacheHit"], serde_json::json!(false));
        // 3. manifest SHA-256 verification, with memo-hit vs full hash
        assert_eq!(t["manifestVerifyMs"], serde_json::json!(5250.0));
        assert_eq!(t["manifestDigestCacheHit"], serde_json::json!(false));
        // 4. model load, with hit/miss and a duration on the miss
        assert_eq!(t["modelCacheHit"], serde_json::json!(false));
        assert_eq!(t["modelLoadMs"], serde_json::json!(880.0));
        // 5/6/7. per-chunk forward pass, Viterbi, tokenization — AGGREGATED
        assert_eq!(t["chunks"]["chunkCount"], serde_json::json!(3));
        assert_eq!(t["chunks"]["forward"]["totalMs"], serde_json::json!(240.0), "40+80+120");
        assert_eq!(t["chunks"]["forward"]["meanMs"], serde_json::json!(80.0), "240 / 3");
        assert_eq!(t["chunks"]["forward"]["maxMs"], serde_json::json!(120.0));
        assert_eq!(t["chunks"]["viterbi"]["totalMs"], serde_json::json!(30.0), "5+10+15");
        assert_eq!(t["chunks"]["tokenize"]["totalMs"], serde_json::json!(1.8), "0.3+0.6+0.9");
        // run total
        assert_eq!(t["totalMs"], serde_json::json!(12_000.0));

        // Non-vacuity: nothing above may have been satisfied by a default.
        let defaulted = serde_json::to_value(&FaEvent::Timing {
            timing: crate::fa_timing::FaRunTiming::default(),
        })
        .unwrap();
        assert_ne!(t, &defaulted["data"]["timing"]);
    }

    #[test]
    fn fa_event_timing_emits_one_aggregate_not_one_event_per_chunk() {
        // The flood guard. 250 chunks must still produce ONE payload whose
        // size does not grow with the chunk count — the reason the per-chunk
        // numbers are aggregated to count/total/mean/max in the first place.
        let mut inference = crate::fa_timing::FaInferenceTimings::default();
        for _ in 0..250 {
            inference.chunks.forward.record(std::time::Duration::from_millis(10));
            inference.chunks.viterbi.record(std::time::Duration::from_millis(1));
            inference.chunks.tokenize.record(std::time::Duration::from_micros(100));
        }
        let small = serde_json::to_string(&FaEvent::Timing {
            timing: crate::fa_timing::FaRunTiming::assemble(
                Default::default(),
                crate::fa_timing::FaInferenceTimings::default(),
                1,
            ),
        })
        .unwrap();
        let big = serde_json::to_string(&FaEvent::Timing {
            timing: crate::fa_timing::FaRunTiming::assemble(Default::default(), inference, 1),
        })
        .unwrap();
        assert_eq!(
            big.len().abs_diff(small.len()) < 200,
            true,
            "a 250-chunk run's timing payload must not scale with chunk count (0 chunks: {} bytes, \
             250 chunks: {} bytes)",
            small.len(),
            big.len()
        );
        // ...and it must still be a real aggregate of all 250.
        let json = serde_json::to_value(&big.parse::<serde_json::Value>().unwrap()).unwrap();
        assert_eq!(json["data"]["timing"]["chunks"]["chunkCount"], serde_json::json!(250));
        assert_eq!(json["data"]["timing"]["chunks"]["forward"]["totalMs"], serde_json::json!(2500.0));
    }

    #[test]
    fn fa_align_direct_call_reports_unknown_staging_rather_than_a_fabricated_zero() {
        // `fa_align` invoked directly did no staging of its own. Its prefix
        // must say "unknown", so a dashboard cannot average a fabricated
        // 0 ms staging step into a real one's.
        let t = crate::fa_timing::FaRunTiming::assemble(
            crate::fa_timing::FaStagePrefix::default(),
            crate::fa_timing::FaInferenceTimings::default(),
            5_000_000,
        );
        assert_eq!(t.staging_ms, None);
    }

    #[test]
    fn fa_event_progress_carries_index_and_total() {
        let event = FaEvent::Progress { index: 3, total: 24 };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json, serde_json::json!({ "event": "Progress", "data": { "index": 3, "total": 24 } }));
    }
}
