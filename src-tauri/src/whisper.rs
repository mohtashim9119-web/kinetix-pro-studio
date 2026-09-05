use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// The live whisper-cli child processes, keyed by the same job key the
/// in-flight registry below uses.
///
/// A MAP AND NOT A SINGLE SLOT (Transcription Requirement 1). It was
/// `Mutex<Option<CommandChild>>` — one global slot — which was consistent with
/// the old kill-and-replace policy: there could only ever be one job, so one
/// slot sufficed. Now that two DIFFERENT keys run concurrently (see
/// `IN_FLIGHT`), a single slot would be overwritten by the second job and
/// `whisper_cancel` could only ever kill the last one started, leaving the
/// other running with no way to stop it.
///
/// KEPT rather than replaced by the registry, deliberately: `InFlightRegistry`
/// owns single-flight and event routing and holds no process handle at all, so
/// it cannot kill anything. Cancellation needs the `CommandChild`, and this is
/// the only thing that has it. The two are complementary, not redundant.
pub struct WhisperState(pub Mutex<HashMap<String, CommandChild>>);

impl Default for WhisperState {
    fn default() -> Self {
        WhisperState(Mutex::new(HashMap::new()))
    }
}

// SAFETY: CommandChild is Send + Sync in tauri_plugin_shell.
unsafe impl Send for WhisperState {}
unsafe impl Sync for WhisperState {}

// ---------------------------------------------------------------------------
// IPC event types
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptToken {
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(tag = "event", content = "data")]
pub enum WhisperEvent {
    Progress { percent: u8 },
    // `detected_language` (Phase 2a, multilingual model swap) is `Some(code)`
    // only when the invocation actually ran `-l auto` AND whisper-cli printed
    // an "auto-detected language" line to stderr — i.e. never set when the
    // caller passed an explicit language code (nothing to detect) and never
    // set on a run that failed before that line could print.
    Done { tokens: Vec<TranscriptToken>, detected_language: Option<String> },
    Error { message: String },
}

// ---------------------------------------------------------------------------
// Single-flight registry (Transcription Requirement 1)
// ---------------------------------------------------------------------------

/// The transcription jobs currently running, keyed by job key.
///
/// The SAME machinery `model_download.rs` uses, instantiated with this
/// module's own key/payload types — that reuse is the whole point of
/// `event_sink.rs`'s generalization, which named "a per-project
/// transcription job" as the consumer it was generalized for. Declaring a
/// separate `static` is what keeps this registry isolated from the download
/// engine's: a transcription for project X and a model download can never
/// collide on a key, because they are different maps.
///
/// KEY CHOICE. `audio_path` — the only per-job string the command already
/// took — is unusable: `whisper_stage_audio_raw` mints a fresh
/// `kinetix-whisper-<uuid>/input.<ext>` temp directory on EVERY call, so two
/// attempts to transcribe the identical audio for the identical project
/// produce two different paths and would both be granted a claim. The key
/// must therefore be supplied by the caller, and the frontend already has
/// exactly the right value: `useWhisper.ts`'s `StartTranscriptionOptions.
/// projectId`, which its own in-page single-flight gate is already scoped to.
/// Keying the native side by the same `Project.id` makes the two gates agree
/// by construction instead of by coincidence, and survives the page reload
/// that clears the in-page one.
static IN_FLIGHT: crate::event_sink::InFlightRegistry<String, WhisperEvent> =
    crate::event_sink::InFlightRegistry::new();

/// The key used when the caller supplies none.
///
/// A single shared key, NOT a per-call unique one. An id-less caller has no
/// identity to be a duplicate of, but the resource it contends for is real:
/// until every caller passes an id, all id-less jobs share one bucket and the
/// second is refused. That is deliberately stricter than the old
/// kill-and-replace and never weaker — a per-call unique key would grant every
/// id-less caller a claim and silently disable single-flight for exactly the
/// callers that have not been updated yet.
pub(crate) const DEFAULT_JOB_KEY: &str = "__default__";

/// Machine-readable prefix on the duplicate-job refusal, so the frontend can
/// tell "a job for this key is already running" apart from a spawn failure, a
/// missing model, or an ffmpeg error — all of which arrive as the same
/// `Err(String)`/`WhisperEvent::Error` shape. Prefix rather than a new error
/// enum: the IPC error type is `String` for every other failure in this
/// module, and changing it would be a far larger surface change than this
/// requirement asks for.
pub(crate) const IN_FLIGHT_REFUSAL_PREFIX: &str = "whisper:already-running:";

/// This module's instantiation of the generic sink.
pub(crate) type WhisperSink = crate::event_sink::EventSink<WhisperEvent>;

pub(crate) fn resolve_job_key(job_key: Option<String>) -> String {
    match job_key {
        Some(k) if !k.trim().is_empty() => k,
        _ => DEFAULT_JOB_KEY.to_string(),
    }
}

/// Phrased as a statement about the job that IS running, not as a failure of
/// the one being refused — mirroring `model_download::in_flight_refusal`.
pub(crate) fn in_flight_refusal(key: &str) -> String {
    format!(
        "{IN_FLIGHT_REFUSAL_PREFIX} a transcription is already running for this project \
         (job key {key}) — watch its progress or cancel it before starting another"
    )
}

/// Whether a transcription is running for this key right now.
///
/// Read-only, and deliberately NOT called by `whisper_transcribe` before its
/// claim: a test-then-acquire pair is a race, and `try_acquire` already does
/// both inside one critical section. Its callers are this module's tests and
/// any future status command — hence the `allow`.
#[allow(dead_code)]
pub(crate) fn is_transcription_in_flight(key: &str) -> bool {
    IN_FLIGHT.is_in_flight(key)
}

/// `Some(guard)` if nothing else holds `key`; `None` if one does. The guard
/// releases on drop — including an early `return`, a `?`, and a panic — which
/// is what makes the error and cancel paths release the entry without any
/// explicit cleanup of their own.
pub(crate) fn try_acquire_transcription(
    key: &str,
    sink: Arc<WhisperSink>,
) -> Option<crate::event_sink::InFlightGuard<String, WhisperEvent>> {
    IN_FLIGHT.try_acquire(key.to_string(), sink)
}

// ---------------------------------------------------------------------------
// Retained terminal events (the reload hole)
// ---------------------------------------------------------------------------

/// How long a terminal event is retained for a page that has not attached yet.
///
/// WHY A TTL AND NOT ONLY AN LRU. The thing being covered is one specific,
/// short interval: a WKWebView tearing down and a fresh page mounting and
/// running its attach probe. That is sub-second in practice and a couple of
/// seconds at worst, so 30s is roughly an order of magnitude of headroom over
/// the event this buffer exists for. It is deliberately not longer: a retained
/// event is also a STALENESS window (see `buffer_terminal`'s note on the
/// already-delivered case), and every second past what a reload actually needs
/// buys nothing and widens that.
const TERMINAL_BUFFER_TTL: Duration = Duration::from_secs(30);

/// Hard cap on retained entries, enforced on every insert.
///
/// WHY BOTH A TTL AND A CAP. The TTL bounds how LONG an entry lives; it does
/// not by itself bound how MANY exist, because expiry is only noticed when
/// something touches the map. A `Done` carries a full `Vec<TranscriptToken>` —
/// thousands of tokens for a long voiceover — so "bounded eventually" is not
/// good enough for the memory question and the cap answers it unconditionally:
/// the map can never hold more than this many entries at any instant,
/// regardless of how many jobs terminate or whether anything ever attaches.
///
/// WHY 16. An entry exists only for a job that has TERMINATED and not yet been
/// claimed, keyed by `${projectId}::${fileIdentity}` — so reaching the cap
/// means 16 distinct project/file pairs finishing inside one 30s window with
/// no page attaching to any of them. The app transcribes one voiceover at a
/// time and the registry above refuses a duplicate per key, so real
/// concurrency is 1-2; 16 is far above anything reachable and still a trivial
/// worst-case retention.
const TERMINAL_BUFFER_MAX_ENTRIES: usize = 16;

/// What is retained for one job key across a page reload.
///
/// TWO FIELDS AND NOT TWO MAPS. The terminal event and the last progress
/// percent have the same key, the same TTL, the same cap and one strict
/// ordering rule between them (a terminal event supersedes progress — see
/// `buffer_terminal_at`). Two parallel maps would have to keep all four of
/// those agreeing by hand; one entry makes them agree by construction.
struct Retained {
    /// The most recent `Progress` percent, while the job is still running.
    ///
    /// WHY THE NATIVE SIDE HOLDS THIS AT ALL. A reloaded page cannot supply
    /// it: progress is not persisted anywhere on the frontend (not in the
    /// project, not in localStorage), and a reload is a brand-new JS context,
    /// so there is no "last visible percentage" for it to keep. This process
    /// is the only thing that still knows the number — without it, a
    /// reattached page has nothing to show until whisper-cli happens to emit
    /// its next progress line.
    progress: Option<u8>,
    /// The terminal event, once one has been emitted.
    terminal: Option<WhisperEvent>,
    stored_at: Instant,
    /// Insertion order, for the eviction-oldest rule. A monotone counter and
    /// not `stored_at`: two entries can share an `Instant` on a coarse clock,
    /// and an eviction that cannot break a tie is not a total order.
    seq: u64,
}

static TERMINAL_BUFFER: OnceLock<Mutex<HashMap<String, Retained>>> = OnceLock::new();
static TERMINAL_SEQ: AtomicU64 = AtomicU64::new(0);

fn terminal_buffer() -> &'static Mutex<HashMap<String, Retained>> {
    TERMINAL_BUFFER.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Applies the cap, oldest-first. Shared by every insert path so no writer can
/// forget it.
fn enforce_cap(map: &mut HashMap<String, Retained>) {
    // A loop and not a single removal: the cap must hold even if it were ever
    // lowered with entries already in.
    while map.len() > TERMINAL_BUFFER_MAX_ENTRIES {
        let Some(oldest) = map
            .iter()
            .min_by_key(|(_k, held)| held.seq)
            .map(|(k, _held)| k.clone())
        else {
            break;
        };
        map.remove(&oldest);
    }
}

/// Drops everything older than the TTL. Called on every insert and every take,
/// so an expired entry is never observable and never counts against the cap.
fn prune_expired(map: &mut HashMap<String, Retained>, now: Instant) {
    map.retain(|_key, held| now.duration_since(held.stored_at) < TERMINAL_BUFFER_TTL);
}

/// `buffer_terminal` with the clock injected, so a TTL test can place an entry
/// in the past instead of sleeping for 30 real seconds.
fn buffer_terminal_at(key: &str, event: WhisperEvent, stored_at: Instant, now: Instant) {
    let Ok(mut map) = terminal_buffer().lock() else { return };
    prune_expired(&mut map, now);
    let seq = TERMINAL_SEQ.fetch_add(1, Ordering::Relaxed);
    // `progress: None` — the terminal event SUPERSEDES any retained percent.
    // Replaying a stale 58% to a page that is simultaneously being handed the
    // job's Done would drive the bar backwards from finished, and for a job
    // that ended in Error it would show progress for a run that failed.
    map.insert(
        key.to_string(),
        Retained { progress: None, terminal: Some(event), stored_at, seq },
    );
    enforce_cap(&mut map);
}

/// Retains a job's terminal event so a page that attaches after it fired still
/// receives it.
///
/// CALLED FROM THE EMISSION SITES ONLY, AND BEFORE THE SEND. Buffering first
/// is what makes this cover the case it exists for: the send races the webview
/// teardown and `EventSink::send` is best-effort by design, so its success
/// tells us nothing about whether a page actually observed the event. Writing
/// the buffer first means the event is retained no matter which way that race
/// lands.
///
/// THE COST, STATED. On the ordinary path the page IS alive, receives the
/// event, and the retained copy is never claimed — it simply expires. Until it
/// does, a fresh attach for the SAME key inside the TTL is answered from the
/// buffer instead of starting a new job. The key is
/// `${projectId}::${fileIdentity}`, so that can only ever replay the transcript
/// of the identical file for the identical project — the same result a rerun
/// would produce — and the window is bounded by `TERMINAL_BUFFER_TTL`.
///
/// NOT CALLED FOR A CANCELLED JOB, and not for the duplicate-job refusal — see
/// both call sites in `whisper_transcribe` for why each of those must stay out.
fn buffer_terminal(key: &str, event: WhisperEvent) {
    let now = Instant::now();
    buffer_terminal_at(key, event, now, now);
}

/// `take_buffered_terminal` with the clock injected (see `buffer_terminal_at`).
fn take_buffered_terminal_at(key: &str, now: Instant) -> Option<WhisperEvent> {
    let mut map = terminal_buffer().lock().ok()?;
    prune_expired(&mut map, now);
    // Removes the ENTRY only when it actually carries a terminal event. A
    // plain `map.remove(key)` here would also discard a live job's retained
    // progress on every attach that found no terminal — silently reintroducing
    // the 0%-flicker this retention exists to prevent, on exactly the path
    // that is supposed to fix it.
    if map.get(key).map(|held| held.terminal.is_some()) != Some(true) {
        return None;
    }
    map.remove(key).and_then(|held| held.terminal)
}

/// Claims the retained terminal event for `key`, if one is still live.
///
/// DELIVER-ONCE, by removal under the same lock the expiry check runs under:
/// the first caller to observe the entry takes it out of the map, so a second
/// attach for the same key sees nothing and correctly reports "no live job".
fn take_buffered_terminal(key: &str) -> Option<WhisperEvent> {
    take_buffered_terminal_at(key, Instant::now())
}

/// `record_progress` with the clock injected (see `buffer_terminal_at`).
fn record_progress_at(key: &str, percent: u8, now: Instant) {
    let Ok(mut map) = terminal_buffer().lock() else { return };
    prune_expired(&mut map, now);
    match map.get_mut(key) {
        // A job that has already emitted its terminal event never goes back to
        // reporting progress; ignoring a late Progress here keeps that
        // one-directional, rather than resurrecting a finished entry.
        Some(held) if held.terminal.is_some() => {}
        Some(held) => {
            held.progress = Some(percent);
            // `stored_at` is refreshed on every update, so a running job's
            // entry cannot age out from under it — the TTL measures silence,
            // not total job length. A long transcription is not a stale entry.
            held.stored_at = now;
        }
        None => {
            let seq = TERMINAL_SEQ.fetch_add(1, Ordering::Relaxed);
            map.insert(
                key.to_string(),
                Retained { progress: Some(percent), terminal: None, stored_at: now, seq },
            );
            enforce_cap(&mut map);
        }
    }
}

/// Retains the latest progress percent for `key`.
fn record_progress(key: &str, percent: u8) {
    record_progress_at(key, percent, Instant::now());
}

/// `last_progress` with the clock injected (see `buffer_terminal_at`).
fn last_progress_at(key: &str, now: Instant) -> Option<u8> {
    let mut map = terminal_buffer().lock().ok()?;
    prune_expired(&mut map, now);
    map.get(key).and_then(|held| held.progress)
}

/// The most recent progress percent for `key`, if one is still retained.
///
/// PEEKED, NOT TAKEN, unlike the terminal event: the job is still running and
/// will keep updating this, and a second page attaching needs the same answer
/// the first got. Deliver-once is a property of the terminal event, where
/// re-delivery would be wrong; a progress percent is idempotent.
fn last_progress(key: &str) -> Option<u8> {
    last_progress_at(key, Instant::now())
}

/// Drops everything retained for `key`.
fn forget_retained(key: &str) {
    if let Ok(mut map) = terminal_buffer().lock() {
        map.remove(key);
    }
}

/// Emits a progress update: retained first, then sent.
///
/// Retaining BEFORE the send, for the same reason `emit_terminal` does — the
/// send is best-effort and races the webview teardown, so its outcome says
/// nothing about whether a page saw the number.
fn emit_progress(sink: &WhisperSink, key: &str, percent: u8) {
    record_progress(key, percent);
    sink.send(WhisperEvent::Progress { percent });
}

/// Emits a job's terminal event: retained first, then sent.
fn emit_terminal(sink: &WhisperSink, key: &str, event: WhisperEvent) {
    buffer_terminal(key, event.clone());
    sink.send(event);
}

/// Decides and emits the terminal event for a finished whisper-cli process.
/// Returns whether anything was emitted — `false` is the silent cancel arm.
///
/// EXTRACTED FROM `whisper_transcribe`'S EVENT LOOP RATHER THAN LEFT INLINE,
/// for reach. `whisper_transcribe` is an async command needing an `AppHandle`
/// and a real sidecar, so no unit test can drive its `Terminated` arm; with
/// the decision inline, a test could only reach `emit_terminal` by calling it
/// directly, and would then keep passing if the call site were changed back to
/// a plain `sink.send` — measured, not assumed: that exact mutation left the
/// first version of this module's buffer tests green. Everything that decides
/// WHICH terminal event a exit code produces, and whether it is retained,
/// therefore lives here, where `terminal_dispatch_tests` can mutate-test it.
fn dispatch_terminal(
    sink: &WhisperSink,
    key: &str,
    code: i32,
    accumulated: &[String],
    detected_language: Option<String>,
) -> bool {
    let event = match code {
        0 => WhisperEvent::Done {
            tokens: parse_stdout_tokens(accumulated),
            detected_language,
        },
        // SIGINT (130) or SIGTERM (143) — user cancelled; silent.
        //
        // SILENT MEANS NOT RETAINED EITHER. A cancellation is the one terminal
        // exit with no terminal EVENT, and retaining something for it would
        // invent one: the next page to attach would be handed a completion or
        // a failure for a job the user deliberately stopped, instead of the
        // "no live job" that lets it start fresh. The early return is
        // load-bearing, not an omission.
        //
        // The retained PROGRESS is dropped here rather than left to expire:
        // the job is over, so a percent for it is dead state, and clearing it
        // at the moment of cancellation is what makes "a cancelled job retains
        // nothing" true immediately instead of TTL-eventually.
        130 | 143 => {
            forget_retained(key);
            return false;
        }
        // -1073741795 == 0xC000001D == STATUS_ILLEGAL_INSTRUCTION (Windows):
        // the whisper binary executed a CPU instruction (e.g. AVX2/FMA) this
        // machine doesn't support. Surface a human-readable cause instead of
        // the raw code.
        -1073741795 => WhisperEvent::Error {
            message: "Transcription failed: your CPU may not support required \
                      instructions. This should be fixed by a future update."
                .to_string(),
        },
        other => WhisperEvent::Error {
            message: format!("whisper exited with code {other}"),
        },
    };
    emit_terminal(sink, key, event);
    true
}

/// Points a running job's event stream at a freshly loaded page's channel.
///
/// Returns `false` when nothing is in flight for this key, which the caller
/// must treat as "read the status normally" and not as an error: a job can
/// legitimately finish in the gap between the page loading and this call.
///
/// The old page's channel is REPLACED, not duplicated — one job, one place
/// its events go, exactly as on the download path.
pub(crate) fn attach_transcription(key: &str, on_event: Channel<WhisperEvent>) -> bool {
    let live = IN_FLIGHT.attach(key);

    // THE BUFFER IS CONSULTED AFTER THE LOOKUP, NEVER BEFORE — and that
    // ordering is what closes the narrowest form of the reload hole.
    // `IN_FLIGHT.attach` clones the `Arc` out from under the registry lock and
    // hands it back; the swap happens afterwards, on the sink's own mutex. So
    // a job can emit its terminal event into the OLD channel in the gap
    // between those two steps and then drop its guard: the lookup already
    // succeeded, the swap lands on a sink nobody will send through again, and
    // the fresh page would be told `true` having received nothing. Taking the
    // retained event here, after the swap, covers that interleaving as well as
    // the ordinary "the job finished before the page came back" one, because
    // in both the event is in the buffer by the time this line runs.
    match take_buffered_terminal(key) {
        Some(event) => {
            match live {
                // Terminated-but-not-yet-released: swap first so nothing the
                // job still emits goes to the dead page, then hand over the
                // retained event.
                Some(sink) => {
                    sink.replace(on_event);
                    sink.send(event);
                }
                // Fully finished and released. There is no sink left to swap,
                // so the event goes straight down this page's own channel.
                None => WhisperSink::new(on_event).send(event),
            }
            true
        }
        None => match live {
            Some(sink) => {
                sink.replace(on_event);
                // IMMEDIATELY RESUME AT THE REAL PERCENT. Without this the
                // reattached page has no number at all until whisper-cli emits
                // its next progress line, so the UI shows its initial 0% in
                // the meantime and then jumps. The frontend cannot supply the
                // value itself — progress is persisted nowhere, and a reload
                // is a fresh JS context — so this process replaying it is the
                // only way a resumed bar can start where the job actually is.
                //
                // Sent AFTER the swap, so it lands on the new page's channel
                // and not the dead one it replaced.
                if let Some(percent) = last_progress(key) {
                    sink.send(WhisperEvent::Progress { percent });
                }
                true
            }
            // No live job and no retained terminal: any progress still sitting
            // here is orphaned (a panic mid-loop), and replaying it would show
            // a moving bar for a job that is gone. Report no-live-job and let
            // the frontend start fresh.
            None => false,
        },
    }
}

/// Re-attaches a reloaded page to an in-progress transcription.
///
/// WHAT A REATTACHED LISTENER GETS, AND WHAT IT DOES NOT. Every subsequent
/// event reaches it, terminal `Done` included, because the job emits through
/// the swappable sink rather than through the channel it was started with.
/// `Progress { percent }` is absolute (a fraction of `duration_secs`, not a
/// delta), so events missed while no page was attached cost nothing — the next
/// one carries the full state.
///
/// A job that TERMINATES in the window between the reload and this call used
/// to be the gap: the claim was gone, this returned `false`, and `Done`'s
/// token payload was unrecoverable, because nothing retained a terminal event
/// — unlike a model download, whose completion is observable on disk
/// afterwards, a transcript exists only in the event. That is what
/// `buffer_terminal`/`take_buffered_terminal` above now close. Such a call
/// returns `true` AND delivers the retained event down the channel it was
/// handed, so the caller settles rather than sitting at whatever percent it
/// last saw.
///
/// THIS THEREFORE RETURNS `true` FOR AN ALREADY-FINISHED JOB, which is a real
/// change in what the boolean means: it now says "this page has been connected
/// to that job's outcome", not "a process is still running". The frontend's
/// `attach false -> start a transcribe` sequence is unaffected because the two
/// answers stay disjoint and exhaustive — `true` is only ever returned
/// together with either a live sink or a delivered terminal event, so there is
/// no path on which a caller is told `true` and then hears nothing.
///
/// WHAT STILL RETURNS `false`, correctly:
///   * a key that never ran;
///   * a job cancelled by the user (exit 130/143), which emits and retains
///     nothing by design;
///   * a second attach for a key whose retained event the first already
///     claimed (deliver-once);
///   * an attach later than `TERMINAL_BUFFER_TTL` after the job finished.
/// In every one of those the caller starts a fresh transcription, exactly as
/// before this change.
///
/// KNOWN GAP. A job that dies WITHOUT reaching an emission site — a panic in
/// the event loop, or the `?` on `model_path`/the state lock — releases its
/// claim through `InFlightGuard::drop` and retains nothing, so the key is both
/// absent from the registry and unbuffered. That is not a hang: `whisper_
/// transcribe`'s `Err` rejects the in-page promise, and a page that reloads
/// past it is told `false` and starts a new job. The state is only reachable
/// with no page attached, and its resolution is the correct one.
#[tauri::command]
pub fn whisper_transcribe_attach(
    job_key: Option<String>,
    on_event: Channel<WhisperEvent>,
) -> Result<bool, String> {
    Ok(attach_transcription(&resolve_job_key(job_key), on_event))
}

// ---------------------------------------------------------------------------
// Model path resolver
// ---------------------------------------------------------------------------

// Phase 2a (multilingual model swap, docs/sync-pipeline-v2-plan.md H.1) — the
// English-only ggml-base.en.bin is replaced by the multilingual
// ggml-large-v3-turbo.bin so `-l auto` (see whisper_transcribe below) is no
// longer silently ignored (whisper-cli ignores -l auto on an .en-suffixed
// model). Measured 2026-08-04: 1624555275 bytes (~1.51 GiB) on disk,
// ~2.1-2.2 GiB resident during inference (docs/sync-pipeline-v2-plan.md H.9).
pub(crate) const MODEL_FILENAME: &str = "ggml-large-v3-turbo.bin";

fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // In-app acquisition (bug 4 fix): the model is downloaded on demand into
    // app_local_data_dir()/models/ (see model_download.rs) rather than bundled
    // — tauri.conf.json's resources map no longer ships models/* at all. This
    // is checked FIRST, ahead of every bundle/dev fallback below, so a user who
    // has downloaded the model always gets it; every existing fallback is kept
    // unchanged underneath for a hand-placed file (dev checkout, or a build
    // from before this change).
    if let Ok(local_data_dir) = app.path().app_local_data_dir() {
        let model = local_data_dir.join("models").join(MODEL_FILENAME);
        if model.exists() {
            return Ok(model);
        }
    }

    // Production: resource_dir bundled by tauri
    if let Ok(resource_dir) = app.path().resource_dir() {
        let model = resource_dir.join("models").join(MODEL_FILENAME);
        if model.exists() {
            return Ok(model);
        }
        // Windows: Tauri v2 resource_dir may include a _up_ segment — try one level up too
        #[cfg(target_os = "windows")]
        {
            if let Some(parent) = resource_dir.parent() {
                let model = parent.join("models").join(MODEL_FILENAME);
                if model.exists() {
                    return Ok(model);
                }
            }
        }
    }

    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot get exe path: {e}"))?;

    // Production fallback: <bundle>/Contents/MacOS/../models/ (macOS app bundle)
    let prod_model = exe
        .parent()
        .unwrap_or(&exe)
        .join("models")
        .join(MODEL_FILENAME);
    if prod_model.exists() {
        return Ok(prod_model);
    }

    // Development: target/debug/ → target/ → src-tauri/ → models/
    let dev_model = exe
        .parent().unwrap_or(&exe)   // target/debug/
        .parent().unwrap_or(&exe)   // target/
        .parent().unwrap_or(&exe)   // src-tauri/
        .join("models")
        .join(MODEL_FILENAME);
    if dev_model.exists() {
        return Ok(dev_model);
    }

    Err(format!(
        "{MODEL_FILENAME} not found. Use the model download panel in Settings, \
         or for a dev checkout: curl -L -o src-tauri/models/{MODEL_FILENAME} \
         https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{MODEL_FILENAME}"
    ))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Sniffs a file extension from magic bytes — the same detection
/// `whisper_transcribe` used to run inline on its base64-decoded bytes,
/// extracted so `whisper_stage_audio_raw` can run it on the raw request body
/// instead.
fn audio_extension_from_bytes(bytes: &[u8]) -> &'static str {
    let mime = if bytes.starts_with(b"RIFF") {
        "audio/wav"
    } else if bytes.starts_with(b"ID3")
        || bytes.starts_with(b"\xff\xfb")
        || bytes.starts_with(b"\xff\xf3")
        || bytes.starts_with(b"\xff\xf2")
    {
        "audio/mpeg"
    } else if bytes.starts_with(b"\x00\x00\x00") && bytes.get(4..8) == Some(b"ftyp") {
        "audio/mp4"
    } else if bytes.starts_with(b"OggS") {
        "audio/ogg"
    } else if bytes.starts_with(b"fLaC") {
        "audio/flac"
    } else if bytes.starts_with(b"FORM")
        && (bytes.get(8..12) == Some(b"AIFF") || bytes.get(8..12) == Some(b"AIFC"))
    {
        "audio/aiff"
    } else if bytes.starts_with(b"\x1a\x45\xdf\xa3") {
        "audio/webm"
    } else {
        "audio/wav" // fallback — let whisper try
    };

    match mime {
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/wave" | "audio/x-wav" => "wav",
        "audio/ogg" | "audio/vorbis" => "ogg",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/mp4" | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/aiff" | "audio/x-aiff" => "aiff",
        "audio/opus" => "opus",
        "audio/webm" => "webm",
        _ => "wav",
    }
}

/// Raw-binary staging command for `whisper_transcribe`'s audio input.
///
/// Writes the invoke request's raw body bytes to a fresh per-call temp
/// directory and returns the resulting file's path, which the frontend then
/// passes to `whisper_transcribe` as `audio_path`. Unlike the `audio_b64`
/// shape this replaces, the payload is NOT base64/JSON-encoded — the
/// frontend passes a `Uint8Array` as the invoke body (Tauri v2 raw request
/// body). This removes the base64 encode (JS) + inflated-string IPC
/// transfer + base64 decode (Rust) that `ffmpeg.rs`'s `ffmpeg_write_file_raw`
/// doc comment already names as the cost this shape avoids on the export
/// path — applied here to a whole voiceover file (potentially hundreds of MB
/// uncompressed) instead of one export frame, where the base64+JSON
/// round trip's ~5-8x peak memory multiplication across the JS heap and the
/// WKWebView IPC bridge is far more likely to matter.
#[tauri::command]
pub fn whisper_stage_audio_raw(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data,
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("whisper_stage_audio_raw: expected a raw byte body, got JSON".to_string())
        }
    };

    let tmp_id = Uuid::new_v4().to_string();
    let tmp_dir = std::env::temp_dir().join(format!("kinetix-whisper-{}", tmp_id));
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("create temp dir: {e}"))?;

    let audio_ext = audio_extension_from_bytes(bytes);
    let audio_path = tmp_dir.join(format!("input.{}", audio_ext));
    fs::write(&audio_path, bytes).map_err(|e| format!("write audio: {e}"))?;

    Ok(audio_path.to_string_lossy().to_string())
}

/// Transcodes any ffmpeg-readable audio file into a 16 kHz mono WAV via the
/// bundled ffmpeg sidecar.
///
/// This runs BEFORE whisper-cli sees the file. whisper.cpp's miniaudio backend
/// only decodes wav/mp3/ogg/flac, and fails silently on everything else (e.g.
/// M4A/AAC): exit code 0, zero tokens, no error. Normalizing through ffmpeg —
/// which is already the export muxer and reads virtually any container/codec —
/// makes that limitation irrelevant. `-ar 16000 -ac 1` matches whisper's own
/// internal target so no quality is lost versus feeding it a raw file.
pub(crate) async fn transcode_to_wav(
    app: &tauri::AppHandle,
    input: &std::path::Path,
    output: &std::path::Path,
) -> Result<(), String> {
    let out = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar lookup: {e}"))?
        .args([
            "-hide_banner",
            "-y",
            "-i", input.to_str().unwrap_or(""),
            "-ar", "16000",
            "-ac", "1",
            output.to_str().unwrap_or(""),
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail = if stderr.len() > 2000 {
            format!("...{}", &stderr[stderr.len() - 2000..])
        } else {
            stderr.to_string()
        };
        return Err(format!(
            "ffmpeg transcode failed (code {}): {}",
            out.status.code().unwrap_or(-1),
            tail
        ));
    }
    Ok(())
}

/// Transcribes audio via the bundled whisper-cli sidecar, streaming progress
/// and result tokens through the supplied Tauri IPC channel.
///
/// The raw upload is first normalized to 16 kHz mono WAV via `transcode_to_wav`
/// (see above) so whisper-cli's format limitations never apply.
///
/// * `audio_path`   — filesystem path to the raw audio file, already staged
///                     on disk by `whisper_stage_audio_raw` (any container
///                     ffmpeg can read). Its parent directory is this call's
///                     own temp dir, removed on completion below.
/// * `duration_secs` — total audio duration (drives 0–100 progress)
/// * `language`     — a whisper language code (e.g. "en"), or "auto" to let
///                     whisper-cli detect it (Phase 2a — H.1/H.7: detection is
///                     a suggestion, stored per-project and user-overridable;
///                     the frontend passes "auto" only when the project has no
///                     stored/overridden language yet).
/// * `on_event`     — frontend channel receiving WhisperEvent variants
/// * `job_key`      — the caller's identity for this job, normally
///                     `Project.id`. IPC SURFACE CHANGE (Transcription
///                     Requirement 1): this parameter is new. It is
///                     `Option<String>` and not `String` so a frontend that
///                     has not been updated yet keeps working — see
///                     `DEFAULT_JOB_KEY` for what an omitted key means and
///                     why the fallback is one shared key rather than a
///                     unique one per call.
#[tauri::command]
pub async fn whisper_transcribe(
    app: tauri::AppHandle,
    state: tauri::State<'_, WhisperState>,
    audio_path: String,
    duration_secs: f64,
    language: String,
    on_event: Channel<WhisperEvent>,
    job_key: Option<String>,
) -> Result<(), String> {
    let job_key = resolve_job_key(job_key);

    // REFUSE a duplicate for this key; do not kill and replace.
    //
    // WHAT THIS REPLACES (operator decision, Transcription Requirement 1). The
    // old body opened by taking the single `WhisperState` slot and calling
    // `child.kill()` on whatever was in it. Nothing told the first job's caller
    // that this had happened: its channel simply went quiet — the killed child
    // exits on SIGTERM (143), which the terminal arm below treats as a user
    // cancellation and deliberately reports nothing for. So a second Apply Sync
    // silently destroyed the first transcription's work, and the first page saw
    // a progress bar that stopped advancing and never resolved.
    //
    // The claim is taken BEFORE any file is written or any process spawned, and
    // held for the whole call by `_in_flight`, whose `Drop` releases it on every
    // exit — the `?` on `model_path`, the early `return` on a transcode failure,
    // the normal end of the event loop, and a panic. There is no explicit
    // release anywhere in this function, and there must not be one.
    //
    // The sink is built before the claim so a page attaching immediately after
    // the claim appears can never find a claim with no sink behind it (the
    // ordering `model_download::stream_download_verified` establishes).
    let sink = Arc::new(WhisperSink::new(on_event));
    let _in_flight = match try_acquire_transcription(&job_key, sink.clone()) {
        Some(guard) => guard,
        None => {
            let msg = in_flight_refusal(&job_key);
            // Both an event AND an `Err`: a caller watching only the channel
            // still learns why nothing happened.
            //
            // DELIBERATELY `sink.send` AND NOT `emit_terminal`. This is not
            // this key's terminal event — it is a statement about a job that
            // is still RUNNING under that key. Retaining it would hand the
            // next page to attach an "already running" Error for a job that is
            // alive and about to report its own real result, turning a
            // successful reattach into a spurious failure.
            sink.send(WhisperEvent::Error { message: msg.clone() });
            return Err(msg);
        }
    };

    let audio_path = PathBuf::from(audio_path);
    let tmp_dir = audio_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(std::env::temp_dir);

    // Universal pre-transcode: normalize the upload (any ffmpeg-readable
    // container/codec) into 16 kHz mono WAV before whisper-cli runs. On failure,
    // clean up and surface a real error rather than letting whisper silently
    // degrade — see transcode_to_wav's doc comment.
    let wav_path = tmp_dir.join("input_16k.wav");
    if let Err(e) = transcode_to_wav(&app, &audio_path, &wav_path).await {
        let _ = fs::remove_dir_all(&tmp_dir);
        emit_terminal(&sink, &job_key, WhisperEvent::Error { message: e });
        return Ok(());
    }

    let model = model_path(&app)?;

    // Phase 2a — language argument (docs/sync-pipeline-v2-plan.md, Step 3
    // decisions): "-l auto" (re-enabled now that the model is multilingual)
    // when the project has no stored/overridden language yet, else the
    // stored code directly, skipping re-detection. `-np` (no-prints) is
    // DROPPED: it was suppressing whisper-cli's "auto-detected language"
    // line along with the rest of the stderr diagnostic dump; empirically
    // verified (2026-08-04) that dropping it does not change stdout's token
    // lines at all (byte-identical with vs. without). `--dtw base.en` is
    // DROPPED: it was already a silent no-op (flash attention is on by
    // default and disables DTW; -nfa would enable it but breaks stdout
    // printing) AND the preset name is model-specific — carrying a
    // base.en-named preset over to turbo would be actively misleading. DTW
    // is Phase 2b/3 work, not this phase's (no timing-source change here).
    //
    // PHASE 2B RESULT (2026-08-05) — DTW is now PERMANENTLY abandoned, and
    // two clauses above are corrected (full measurement:
    // docs/sync-pipeline-v2-plan.md's "Phase 2b — RESULTS"):
    //   * CORRECT: `--dtw base.en` was indeed a silent no-op. whisper-cli's
    //     stderr says so verbatim: "dtw_token_timestamps is not supported
    //     with flash_attn - disabling".
    //   * WRONG: "-nfa ... breaks stdout printing". It does not, on this
    //     bundled binary — a full 23.7-minute run with -nfa and no -oj
    //     produced 4,639 clean bracketed lines that parse_stdout_tokens
    //     (below) handled without loss. Do not scope future work as though
    //     -nfa forces a move to JSON output.
    //   * The real reason not to add DTW: correctly enabled (stderr
    //     "dtw = 1"), it changes timestamps by EXACTLY 0.000000000s, measured
    //     against a no-DTW control over 4,579 + 2,080 tokens. Under `-ml 1`
    //     whisper emits GAPLESS token spans (each token starts where the
    //     previous ended), so a pause is structurally absorbed into the
    //     following word's span and DTW has nothing left to dispute.
    //     Phase 3 is forced alignment instead.
    //   * Measured but deliberately NOT acted on (Phase 2b is read-only):
    //     `-nfa` ALONE recovers a ~9.7s passage of real narration that the
    //     current flash-attention default silently drops on the V6 corpus
    //     project, at a cost of ~25-33% wall-clock. Documented as a finding
    //     for a future phase to weigh; do not enable it casually — it mints
    //     a new transcript era (K9) and needs its own verification pass.
    let (mut rx, child) = app
        .shell()
        .sidecar("whisper")
        .map_err(|e| format!("sidecar lookup: {e}"))?
        .args([
            "-m",  model.to_str().unwrap_or(""),
            "-f",  wav_path.to_str().unwrap_or(""),
            "-ml", "1",
            "-l",  language.as_str(),
        ])
        .spawn()
        .map_err(|e| format!("whisper spawn: {e}"))?;

    // Store child so whisper_cancel can kill it — under this job's own key, so
    // a concurrent job for a different key is neither overwritten nor killed.
    {
        let mut lock = state.0.lock().map_err(|_| "state lock poisoned")?;
        lock.insert(job_key.clone(), child);
    }

    let mut line_buf: Vec<u8> = Vec::new();
    let mut accumulated: Vec<String> = Vec::new();
    // Phase 2a — stderr is now scanned (previously fully ignored) for
    // whisper-cli's "auto-detected language: XX (p = 0.NN)" line, the only
    // way to observe what `-l auto` resolved to. Line-buffered the same way
    // stdout already is, just kept in a separate buffer/accumulator so the
    // two streams' interleaving can never corrupt either one's line framing.
    let mut err_line_buf: Vec<u8> = Vec::new();
    let mut detected_language: Option<String> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                line_buf.extend_from_slice(&bytes);
                // Drain complete lines from the buffer.
                while let Some(pos) = line_buf.iter().position(|&b| b == b'\n') {
                    let raw: Vec<u8> = line_buf.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&raw)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if let Some(end_sec) = parse_progress_line(&line) {
                        let percent = if duration_secs > 0.0 {
                            ((end_sec / duration_secs) * 100.0).clamp(0.0, 100.0) as u8
                        } else {
                            0
                        };
                        emit_progress(&sink, &job_key, percent);
                    }
                    if !line.is_empty() {
                        accumulated.push(line);
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                err_line_buf.extend_from_slice(&bytes);
                while let Some(pos) = err_line_buf.iter().position(|&b| b == b'\n') {
                    let raw: Vec<u8> = err_line_buf.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&raw)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if detected_language.is_none() {
                        if let Some(lang) = parse_detected_language(&line) {
                            detected_language = Some(lang);
                        }
                    }
                }
            }
            CommandEvent::Terminated(status) => {
                // Flush any remaining bytes in the line buffers.
                if !line_buf.is_empty() {
                    let line = String::from_utf8_lossy(&line_buf)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if !line.is_empty() {
                        accumulated.push(line);
                    }
                    line_buf.clear();
                }
                if !err_line_buf.is_empty() {
                    let line = String::from_utf8_lossy(&err_line_buf)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if detected_language.is_none() {
                        if let Some(lang) = parse_detected_language(&line) {
                            detected_language = Some(lang);
                        }
                    }
                    err_line_buf.clear();
                }

                // Remove stored child (process is gone). Only this job's own
                // entry — a `*lock = None` here would drop a concurrent job's
                // handle and make it uncancellable.
                {
                    let mut lock = state.0.lock().map_err(|_| "state lock poisoned")?;
                    lock.remove(&job_key);
                }
                let _ = fs::remove_dir_all(&tmp_dir);

                // Every decision this arm used to make inline now lives in
                // `dispatch_terminal`, so it can be unit-tested — see its doc
                // comment for why that extraction was necessary rather than
                // cosmetic.
                dispatch_terminal(
                    &sink,
                    &job_key,
                    status.code.unwrap_or(-1),
                    &accumulated,
                    detected_language,
                );
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

/// Kills a running whisper transcription job.
///
/// `job_key` targets one job; omitting it kills every running job, which is
/// exactly what this command did before there could be more than one — so an
/// un-updated frontend keeps its existing semantics.
///
/// Cancelling does NOT touch the in-flight registry directly. Killing the
/// child makes `whisper_transcribe`'s event loop see `Terminated`, which ends
/// the function and drops its `InFlightGuard`; that is what releases the
/// claim. Releasing it here as well would free the key while the job's own
/// task is still shutting down, and a new job could then claim it and spawn a
/// second child against the same project.
#[tauri::command]
pub async fn whisper_cancel(
    state: tauri::State<'_, WhisperState>,
    job_key: Option<String>,
) -> Result<(), String> {
    let mut lock = state.0.lock().map_err(|_| "state lock poisoned")?;
    match job_key {
        Some(key) => {
            if let Some(child) = lock.remove(&key) {
                let _ = child.kill();
            }
        }
        None => {
            for (_key, child) in lock.drain() {
                let _ = child.kill();
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/// Extracts the language code from a whisper-cli stderr line of the form
/// `whisper_full_with_state: auto-detected language: en (p = 0.999905)`
/// (verified against a real run, 2026-08-04), or None if the line doesn't
/// match. Only ever produced when `-l auto` was passed — a run given an
/// explicit language code skips detection and never prints this line.
fn parse_detected_language(line: &str) -> Option<String> {
    const MARKER: &str = "auto-detected language: ";
    let idx = line.find(MARKER)?;
    let after = &line[idx + MARKER.len()..];
    let code = after.split_whitespace().next()?;
    if code.is_empty() { None } else { Some(code.to_string()) }
}

/// Returns the end timestamp in seconds from a whisper progress line of the
/// form `[HH:MM:SS.mmm --> HH:MM:SS.mmm]  text…`, or None if the line
/// doesn't match.
fn parse_progress_line(line: &str) -> Option<f64> {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') {
        return None;
    }
    let arrow = trimmed.find(" --> ")?;
    let after = &trimmed[arrow + 5..];
    let close = after.find(']')?;
    Some(parse_timestamp(&after[..close]))
}

/// Converts accumulated whisper stdout lines into `TranscriptToken` list.
fn parse_stdout_tokens(lines: &[String]) -> Vec<TranscriptToken> {
    let mut tokens = Vec::new();
    for line in lines {
        let trimmed = line.trim();
        if !trimmed.starts_with('[') {
            continue;
        }
        let close = match trimmed.find(']') {
            Some(i) => i,
            None => continue,
        };
        let ts_part = &trimmed[1..close];
        let arrow = match ts_part.find(" --> ") {
            Some(i) => i,
            None => continue,
        };
        let start_sec = parse_timestamp(&ts_part[..arrow]);
        let end_sec = parse_timestamp(&ts_part[arrow + 5..]);
        let text = trimmed[close + 1..].trim().to_string();
        if !text.is_empty() {
            tokens.push(TranscriptToken { start_sec, end_sec, text });
        }
    }
    tokens
}

/// Parses whisper timestamp strings (`HH:MM:SS.mmm` or `HH:MM:SS,mmm`) into
/// seconds as `f64`.
fn parse_timestamp(ts: &str) -> f64 {
    let ts = ts.trim().replace(',', ".");
    let parts: Vec<&str> = ts.split(':').collect();
    if parts.len() != 3 {
        return 0.0;
    }
    let h: f64 = parts[0].parse().unwrap_or(0.0);
    let m: f64 = parts[1].parse().unwrap_or(0.0);
    let s: f64 = parts[2].parse().unwrap_or(0.0);
    h * 3600.0 + m * 60.0 + s
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod in_flight_tests {
    use super::*;

    /// A channel that records every event it is handed, so a test can assert
    /// WHAT a listener received and not merely that a send did not error.
    /// `EventSink::send` is best-effort by design (a dead page's channel just
    /// fails), so a non-recording channel would make every assertion below
    /// vacuously true.
    fn recording_channel() -> (Channel<WhisperEvent>, Arc<Mutex<Vec<String>>>) {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = log.clone();
        let channel = Channel::new(move |body: tauri::ipc::InvokeResponseBody| {
            let raw = match &body {
                tauri::ipc::InvokeResponseBody::Json(s) => s.clone(),
                tauri::ipc::InvokeResponseBody::Raw(b) => String::from_utf8_lossy(b).to_string(),
            };
            sink.lock().unwrap().push(raw);
            Ok(())
        });
        (channel, log)
    }

    fn sink_for(channel: Channel<WhisperEvent>) -> Arc<WhisperSink> {
        Arc::new(WhisperSink::new(channel))
    }

    fn noop_sink() -> Arc<WhisperSink> {
        sink_for(Channel::new(|_body| Ok(())))
    }

    // Keys are unique per test: the registry is a process-wide `static` and
    // cargo runs tests in parallel threads, so a shared key would make these
    // tests contend with each other rather than with what they are testing.

    #[test]
    fn second_transcription_for_the_same_key_is_refused_not_granted() {
        let key = "proj-refusal";
        let first = try_acquire_transcription(key, noop_sink())
            .expect("the first job must be granted the key");
        assert!(is_transcription_in_flight(key));
        assert!(
            try_acquire_transcription(key, noop_sink()).is_none(),
            "a second job for the same key must be REFUSED — the pre-registry \
             behaviour killed the first job's child instead, silently discarding \
             its work"
        );
        drop(first);
    }

    #[test]
    fn the_refusal_message_is_machine_distinguishable_from_other_errors() {
        // The frontend receives every failure in this module as the same
        // `Err(String)`/`WhisperEvent::Error` shape — a spawn failure, a
        // missing model, an ffmpeg transcode failure. Only the prefix lets it
        // tell "already running" (retryable later, nothing was lost) apart
        // from those (a real failure to report).
        let msg = in_flight_refusal("proj-x");
        assert!(msg.starts_with(IN_FLIGHT_REFUSAL_PREFIX));
        for other in [
            "sidecar lookup: not found".to_string(),
            "whisper exited with code 3".to_string(),
            format!("{MODEL_FILENAME} not found."),
        ] {
            assert!(
                !other.starts_with(IN_FLIGHT_REFUSAL_PREFIX),
                "{other} must not be mistaken for an already-running refusal"
            );
        }
    }

    #[test]
    fn distinct_keys_stay_independently_concurrent() {
        let a = try_acquire_transcription("proj-conc-a", noop_sink()).expect("a");
        let b = try_acquire_transcription("proj-conc-b", noop_sink())
            .expect("a different project must not be blocked by another's job — refusing \
                     there would strand a project behind a run whose result it cannot use");
        assert!(is_transcription_in_flight("proj-conc-a"));
        assert!(is_transcription_in_flight("proj-conc-b"));
        drop(a);
        assert!(
            !is_transcription_in_flight("proj-conc-a"),
            "releasing one key must not depend on the other"
        );
        assert!(is_transcription_in_flight("proj-conc-b"));
        drop(b);
    }

    #[test]
    fn a_reattached_page_receives_subsequent_events_and_the_terminal_done() {
        let key = "proj-reload";
        let (first_page, first_log) = recording_channel();
        let sink = sink_for(first_page);
        let _guard = try_acquire_transcription(key, sink.clone()).expect("claim");

        sink.send(WhisperEvent::Progress { percent: 10 });

        // The reload: the first page is gone, a fresh one attaches with its own
        // channel and no knowledge of the running job.
        let (second_page, second_log) = recording_channel();
        assert!(
            attach_transcription(key, second_page),
            "a live job must be reattachable"
        );

        sink.send(WhisperEvent::Progress { percent: 60 });
        sink.send(WhisperEvent::Done { tokens: vec![], detected_language: Some("en".into()) });

        let first = first_log.lock().unwrap().clone();
        let second = second_log.lock().unwrap().clone();

        assert_eq!(first.len(), 1, "the old page must stop receiving after the swap");
        assert!(first[0].contains("Progress"));

        // The whole point: the reattached page gets everything AFTER the swap,
        // terminal event included. `Progress` is an absolute percentage, so the
        // events it missed while nobody was attached cost it nothing.
        assert_eq!(second.len(), 2, "expected the post-attach Progress and the Done");
        assert!(second[0].contains("Progress") && second[0].contains("60"));
        assert!(
            second[1].contains("Done"),
            "a reattached page that never receives Done can never resolve — got {:?}",
            second[1]
        );
    }

    #[test]
    fn attach_reports_false_when_no_job_holds_the_key() {
        // Not an error: a job can finish between a page loading and its attach
        // call, and the caller must read that as "nothing running", not "failed".
        assert!(!attach_transcription("proj-nothing-running", Channel::new(|_b| Ok(()))));
    }

    #[test]
    fn the_entry_is_released_on_success_error_and_panic_paths() {
        // The three exits `whisper_transcribe` actually has. Each is modelled by
        // a scope holding a real guard, because the release mechanism under test
        // is `Drop` — the reason there is no explicit release call in the
        // command body at all.
        let key = "proj-release";

        // 1. Success: the event loop breaks and the function returns Ok.
        {
            let _g = try_acquire_transcription(key, noop_sink()).expect("claim");
        }
        assert!(!is_transcription_in_flight(key), "released on the success path");

        // 2. Error: an early `return`/`?` (transcode failure, missing model).
        fn errors_out(key: &str) -> Result<(), String> {
            let _g = try_acquire_transcription(key, noop_sink()).ok_or("claim")?;
            Err("transcode failed".to_string())
        }
        assert!(errors_out(key).is_err());
        assert!(!is_transcription_in_flight(key), "released on the error path");

        // 3. Panic: an unwind must not leave the key permanently unclaimable.
        let unwound = std::panic::catch_unwind(|| {
            let _g = try_acquire_transcription(key, noop_sink()).expect("claim");
            panic!("boom");
        });
        assert!(unwound.is_err());
        assert!(!is_transcription_in_flight(key), "released on the panic path");

        // 4. Cancel: `whisper_cancel` kills the child, the event loop sees
        //    Terminated and returns, and the guard drops with it — cancel never
        //    removes the entry itself (see whisper_cancel's doc comment).
        {
            let _g = try_acquire_transcription(key, noop_sink()).expect("claim");
            assert!(is_transcription_in_flight(key));
        }
        assert!(!is_transcription_in_flight(key), "released on the cancel path");

        assert!(
            try_acquire_transcription(key, noop_sink()).is_some(),
            "the key must be reclaimable after every one of those exits"
        );
    }

    // -----------------------------------------------------------------
    // Retained terminal events (the reload hole)
    // -----------------------------------------------------------------
    //
    // Every test below drives the real `attach_transcription` — the function
    // `whisper_transcribe_attach` is a one-line wrapper over — and asserts on
    // what a recording channel ACTUALLY received, not merely on the boolean.
    // A test that checked only the return value would pass on the exact bug
    // this buffer exists to fix: attach saying `true` while the page hears
    // nothing and hangs at its last percent.

    /// whisper-cli stdout for one token, in the `-ml 1` bracketed form
    /// `parse_stdout_tokens` consumes — real input, so a `Done` built from it
    /// carries a real payload rather than an empty vector that would make the
    /// "did the tokens survive" assertions vacuous.
    fn stdout_lines() -> Vec<String> {
        vec!["[00:00:00.000 --> 00:00:01.000]   hello".to_string()]
    }

    /// Runs one job to a given whisper-cli EXIT CODE through the same
    /// `dispatch_terminal` the command's event loop calls, then releases the
    /// claim — i.e. leaves exactly the state a reloading page finds.
    ///
    /// Deliberately NOT a direct `emit_terminal` call: going through the real
    /// decision point is what makes these tests notice if the emission site
    /// stops retaining. (Measured — with the helper calling `emit_terminal`
    /// directly, reverting the `Done` site to a plain `sink.send` left all of
    /// them green.)
    fn run_job_to_exit(key: &str, code: i32) -> bool {
        let guard = try_acquire_transcription(key, noop_sink()).expect("claim");
        let emitted =
            dispatch_terminal(&noop_sink(), key, code, &stdout_lines(), Some("en".into()));
        drop(guard);
        emitted
    }

    /// The common case: a job that finished successfully.
    fn run_job_to_done(key: &str) {
        assert!(run_job_to_exit(key, 0), "exit 0 must emit a terminal event");
    }

    /// A `Done` as `dispatch_terminal` would build it, for the tests that need
    /// to seed the buffer directly (the TTL and cap ones, which are about the
    /// retention policy rather than the emission site).
    fn done_event() -> WhisperEvent {
        WhisperEvent::Done {
            tokens: parse_stdout_tokens(&stdout_lines()),
            detected_language: Some("en".into()),
        }
    }

    #[test]
    fn a_page_attaching_after_done_fired_receives_the_retained_done() {
        // THE DEFECT THIS PINS. The terminal event fires while the webview is
        // tearing down; the fresh page attaches to a job whose claim is
        // already gone. Before the buffer this returned `false` with the
        // transcript unrecoverable, and the UI sat at its last percent
        // forever.
        let key = "proj-late-attach";
        run_job_to_done(key);
        assert!(
            !is_transcription_in_flight(key),
            "the job must be fully terminated and released — otherwise this \
             test is exercising the live-sink path, not the buffer"
        );

        let (page, log) = recording_channel();
        assert!(attach_transcription(key, page), "a retained Done must be attachable");

        let received = log.lock().unwrap().clone();
        assert_eq!(received.len(), 1, "expected exactly the retained terminal event");
        assert!(
            received[0].contains("Done") && received[0].contains("hello"),
            "the page must receive the Done WITH its token payload — a bare \
             `true` with no event is the hang this fixes; got {:?}",
            received[0]
        );
    }

    #[test]
    fn a_retained_event_is_delivered_exactly_once() {
        // Deliver-once, stated as the frontend sees it: the first attach is a
        // reattach, the second is "nothing running" and must lead to a fresh
        // transcribe rather than a replay.
        let key = "proj-deliver-once";
        run_job_to_done(key);

        let (first_page, first_log) = recording_channel();
        assert!(attach_transcription(key, first_page));
        assert_eq!(first_log.lock().unwrap().len(), 1);

        let (second_page, second_log) = recording_channel();
        assert!(
            !attach_transcription(key, second_page),
            "the second attach for a claimed key must report NO LIVE JOB — \
             returning true here would strand the page: the event is gone, so \
             nothing would ever arrive on that channel"
        );
        assert!(
            second_log.lock().unwrap().is_empty(),
            "and it must receive nothing at all"
        );
    }

    #[test]
    fn a_retained_event_expires_and_then_reports_no_live_job() {
        // The bound must produce "start a fresh job", never a hang. The clock
        // is injected rather than slept through — a 30s sleep in the suite
        // would be its own defect.
        let key = "proj-ttl";
        let now = Instant::now();
        let stale = now
            .checked_sub(TERMINAL_BUFFER_TTL + Duration::from_secs(1))
            .expect("clock far enough from its epoch to place an entry in the past");

        buffer_terminal_at(key, done_event(), stale, now);
        assert!(
            take_buffered_terminal_at(key, now).is_none(),
            "an entry older than the TTL must not be observable"
        );

        let (page, log) = recording_channel();
        assert!(
            !attach_transcription(key, page),
            "past the window the answer is no-live-job, so the frontend starts \
             a new transcription"
        );
        assert!(log.lock().unwrap().is_empty());

        // The complement, so this test cannot pass by the buffer being broken
        // outright: inside the window the same entry IS delivered.
        let fresh_key = "proj-ttl-inside";
        buffer_terminal_at(fresh_key, done_event(), now, now);
        assert!(
            take_buffered_terminal_at(fresh_key, now).is_some(),
            "an entry inside the TTL must still be claimable"
        );
    }

    #[test]
    fn an_error_terminal_event_is_retained_and_replayed_like_done() {
        // A failed run must reach the reloaded page too: a page told `false`
        // for a job that already failed starts a second one that fails the
        // same way, instead of reporting the failure it could have had.
        let key = "proj-late-error";
        assert!(run_job_to_exit(key, 3), "a nonzero exit must emit an Error");

        let (page, log) = recording_channel();
        assert!(attach_transcription(key, page));
        let received = log.lock().unwrap().clone();
        assert_eq!(received.len(), 1);
        assert!(
            received[0].contains("Error") && received[0].contains("code 3"),
            "the failure text must survive the replay — got {:?}",
            received[0]
        );

        // And it is deliver-once on this path too.
        let (again, again_log) = recording_channel();
        assert!(!attach_transcription(key, again));
        assert!(again_log.lock().unwrap().is_empty());
    }

    #[test]
    fn a_cancelled_job_retains_nothing() {
        // Exit 143 (SIGTERM, `whisper_cancel`) and 130 (SIGINT) take the
        // silent arm of the terminal `match`: no event is emitted, so
        // `emit_terminal` is never reached and nothing can be retained. The
        // test asserts the OUTCOME rather than the arm — a future refactor
        // that routed cancellation through an event would fail here, which is
        // the point.
        for code in [143, 130] {
            let key = format!("proj-cancelled-{code}");
            let (watching, watching_log) = recording_channel();
            let sink = sink_for(watching);
            let guard = try_acquire_transcription(&key, sink.clone()).expect("claim");

            assert!(
                !dispatch_terminal(&sink, &key, code, &stdout_lines(), Some("en".into())),
                "exit {code} must emit NOTHING — it is the user's own cancel"
            );
            assert!(
                watching_log.lock().unwrap().is_empty(),
                "not even to the page that was watching"
            );
            drop(guard);

            let (page, log) = recording_channel();
            assert!(
                !attach_transcription(&key, page),
                "a deliberately cancelled job must look like no job at all — \
                 replaying a completion or a failure for it would contradict \
                 the user's own cancel"
            );
            assert!(log.lock().unwrap().is_empty());
            assert!(take_buffered_terminal(&key).is_none(), "and nothing is retained");
        }

        // The control: the SAME helper with a non-cancel code does retain, so
        // this test cannot pass by retention being broken for every code.
        let control = "proj-cancelled-control";
        run_job_to_done(control);
        assert!(take_buffered_terminal(control).is_some());
    }

    #[test]
    fn the_retention_cap_evicts_oldest_and_never_grows_past_the_bound() {
        // Memory bound, asserted directly on the map. Keys are namespaced to
        // this test, but the cap is global, so the assertion is on the count
        // of THIS test's surviving keys against the cap, and on the identity
        // of which ones survived.
        let overflow = 5;
        let total = TERMINAL_BUFFER_MAX_ENTRIES + overflow;
        let now = Instant::now();
        let key_at = |i: usize| format!("proj-cap-{i}");

        for i in 0..total {
            buffer_terminal_at(&key_at(i), done_event(), now, now);
            assert!(
                terminal_buffer().lock().unwrap().len() <= TERMINAL_BUFFER_MAX_ENTRIES,
                "the map must be at or under the cap after EVERY insert, not \
                 merely at the end — an over-cap intermediate state is a real \
                 memory spike"
            );
        }

        let survivors: Vec<usize> =
            (0..total).filter(|i| take_buffered_terminal_at(&key_at(*i), now).is_some()).collect();
        assert_eq!(
            survivors.len(),
            TERMINAL_BUFFER_MAX_ENTRIES,
            "exactly the cap's worth must survive"
        );
        assert_eq!(
            survivors,
            (overflow..total).collect::<Vec<usize>>(),
            "and they must be the NEWEST ones — evicting newest-first would \
             drop the entry a page is most likely about to attach for"
        );
    }

    // -----------------------------------------------------------------
    // Resuming a reattached page at the real percent (the 0% flicker)
    // -----------------------------------------------------------------

    /// The percent carried by the single event a channel recorded.
    fn recorded_percent(raw: &str) -> Option<u8> {
        let marker = "\"percent\":";
        let start = raw.find(marker)? + marker.len();
        let rest = &raw[start..];
        let end = rest.find(|c: char| !c.is_ascii_digit())?;
        rest[..end].parse().ok()
    }

    #[test]
    fn a_reattached_page_resumes_at_the_last_known_percent() {
        // THE DEFECT THIS PINS. Reload at 37%, click Transcribe: the page has
        // no percent of its own (progress is persisted nowhere and a reload is
        // a fresh JS context), so it painted its initial 0% and sat there
        // until whisper-cli's next progress line jumped it to 58%. Attach must
        // hand it the real number straight away.
        let key = "proj-resume";
        let sink = noop_sink();
        let _guard = try_acquire_transcription(key, sink.clone()).expect("claim");

        emit_progress(&sink, key, 37);
        emit_progress(&sink, key, 58);

        let (page, log) = recording_channel();
        assert!(attach_transcription(key, page), "the job is live");

        let received = log.lock().unwrap().clone();
        assert_eq!(
            received.len(),
            1,
            "the reattached page must be given a percent immediately, without \
             waiting for whisper-cli's next progress line — got {received:?}"
        );
        assert_eq!(
            recorded_percent(&received[0]),
            Some(58),
            "and it must be the LATEST percent, not the first one seen"
        );
    }

    #[test]
    fn a_job_with_no_progress_yet_replays_nothing() {
        // The complement: during whisper-cli's model load no progress line has
        // been printed, so there is genuinely nothing to resume from.
        // Inventing a 0 here would be indistinguishable from the flicker.
        let key = "proj-resume-none";
        let _guard = try_acquire_transcription(key, noop_sink()).expect("claim");

        let (page, log) = recording_channel();
        assert!(attach_transcription(key, page), "still a live job");
        assert!(
            log.lock().unwrap().is_empty(),
            "no progress seen yet means no progress replayed"
        );
    }

    #[test]
    fn a_terminal_event_supersedes_a_retained_percent() {
        // Ordering rule. A page attaching after the job finished must receive
        // the Done ALONE — replaying a stale 58% alongside it would drive the
        // bar backwards from finished, and for an Error would show progress
        // for a run that failed.
        let key = "proj-resume-superseded";
        let sink = noop_sink();
        let guard = try_acquire_transcription(key, sink.clone()).expect("claim");
        emit_progress(&sink, key, 58);
        assert_eq!(last_progress(key), Some(58), "retained while running");
        assert!(dispatch_terminal(&sink, key, 0, &stdout_lines(), Some("en".into())));
        assert_eq!(
            last_progress(key),
            None,
            "the terminal event must clear the retained percent"
        );
        drop(guard);

        let (page, log) = recording_channel();
        assert!(attach_transcription(key, page));
        let received = log.lock().unwrap().clone();
        assert_eq!(received.len(), 1, "exactly the terminal event, nothing else");
        assert!(received[0].contains("Done"));
    }

    #[test]
    fn a_late_progress_cannot_resurrect_a_finished_job() {
        // Provenance is one-directional: once terminal, always terminal. A
        // straggling Progress arriving after Done must not put the entry back
        // into a running-looking state, or the next attach would resume a
        // finished job's bar instead of handing over its result.
        let key = "proj-resume-late";
        let sink = noop_sink();
        let guard = try_acquire_transcription(key, sink.clone()).expect("claim");
        assert!(dispatch_terminal(&sink, key, 0, &stdout_lines(), Some("en".into())));
        emit_progress(&sink, key, 99);
        assert_eq!(last_progress(key), None, "the late percent must be ignored");
        drop(guard);

        let (page, log) = recording_channel();
        assert!(attach_transcription(key, page));
        let received = log.lock().unwrap().clone();
        assert_eq!(received.len(), 1);
        assert!(received[0].contains("Done"), "still the terminal event");
    }

    #[test]
    fn a_retained_percent_is_peeked_not_consumed() {
        // Unlike the terminal event, progress is idempotent: two pages
        // attaching in succession (a double reload) must both resume at the
        // real percent. Consuming it would leave the second at 0%.
        let key = "proj-resume-twice";
        let sink = noop_sink();
        let _guard = try_acquire_transcription(key, sink.clone()).expect("claim");
        emit_progress(&sink, key, 42);

        for attempt in 1..=2 {
            let (page, log) = recording_channel();
            assert!(attach_transcription(key, page));
            let received = log.lock().unwrap().clone();
            assert_eq!(
                recorded_percent(&received[0]),
                Some(42),
                "attach #{attempt} must also resume at the real percent"
            );
        }
    }

    #[test]
    fn an_orphaned_percent_is_never_replayed_without_a_live_job() {
        // A job that died without reaching an emission site (a panic mid-loop)
        // leaves a percent behind with no claim and no terminal event.
        // Replaying it would animate a bar for a job that is gone; the caller
        // must be told there is nothing running so it starts fresh.
        let key = "proj-resume-orphan";
        {
            let _guard = try_acquire_transcription(key, noop_sink()).expect("claim");
            record_progress(key, 71);
        }
        assert!(!is_transcription_in_flight(key));
        assert_eq!(last_progress(key), Some(71), "the orphan is still in the map");

        let (page, log) = recording_channel();
        assert!(
            !attach_transcription(key, page),
            "no live job and no terminal event means no live job"
        );
        assert!(log.lock().unwrap().is_empty(), "and nothing is replayed");
    }

    #[test]
    fn a_cancelled_job_retains_no_percent_either() {
        let key = "proj-resume-cancelled";
        let sink = noop_sink();
        let guard = try_acquire_transcription(key, sink.clone()).expect("claim");
        emit_progress(&sink, key, 58);
        assert_eq!(last_progress(key), Some(58));
        assert!(!dispatch_terminal(&sink, key, 143, &stdout_lines(), None));
        assert_eq!(
            last_progress(key),
            None,
            "cancelling must drop the percent immediately, not leave it to expire"
        );
        drop(guard);
    }

    #[test]
    fn a_running_jobs_entry_does_not_age_out_while_it_reports() {
        // The TTL measures SILENCE, not total job length: a transcription can
        // legitimately run far longer than the window, and its percent must
        // still be there for a reload at minute ten. Each update refreshes
        // `stored_at`, so only a job that has gone quiet for the whole TTL
        // ages out.
        // THE STEPS MUST BE SHORTER THAN THE TTL AND SUM TO LONGER THAN IT.
        // Measured, not assumed: an earlier version of this test jumped
        // straight to 4x the TTL and stayed GREEN when the refresh was
        // deleted, because at that distance `record_progress_at` prunes the
        // stale entry and re-inserts a fresh one — so it exercised the insert
        // path and never the refresh it names. Each step here stays inside the
        // window (so nothing is pruned and the update must do the refreshing),
        // while two of them exceed it (so an un-refreshed entry is expired by
        // the time it is read).
        let key = "proj-resume-long";
        let step = TERMINAL_BUFFER_TTL * 3 / 5;
        let t0 = Instant::now();
        record_progress_at(key, 10, t0);

        let t1 = t0 + step;
        record_progress_at(key, 20, t1);

        let t2 = t1 + step;
        assert_eq!(
            last_progress_at(key, t2),
            Some(20),
            "a job that kept reporting must keep its percent past the TTL — \
             the window measures SILENCE, not total job length, or a reload at \
             minute ten of a long transcription would resume at nothing"
        );

        // ...but one that goes silent for a full window does expire.
        let silent = t2 + TERMINAL_BUFFER_TTL + Duration::from_secs(1);
        assert_eq!(last_progress_at(key, silent), None);
    }

    #[test]
    fn retained_events_for_distinct_keys_stay_independent() {
        // Regression guard on the existing concurrency property, now that a
        // second per-key map exists alongside the registry: two projects'
        // retained events must not consume or evict one another.
        let (a, b) = ("proj-buf-indep-a", "proj-buf-indep-b");
        run_job_to_done(a);
        run_job_to_done(b);

        let (page_a, log_a) = recording_channel();
        assert!(attach_transcription(a, page_a));
        assert_eq!(log_a.lock().unwrap().len(), 1);

        let (page_b, log_b) = recording_channel();
        assert!(
            attach_transcription(b, page_b),
            "claiming a's retained event must not consume b's"
        );
        assert_eq!(log_b.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_live_job_is_still_reattached_and_a_duplicate_still_refused() {
        // Regression guard: the buffer must not have changed either behaviour
        // of the live path. A retained event exists for this key at the same
        // time, so this also pins the interleaving the ordering in
        // `attach_transcription` exists for — a job that emitted its terminal
        // event but has NOT yet dropped its guard.
        let key = "proj-live-plus-buffer";
        let sink = noop_sink();
        let guard = try_acquire_transcription(key, sink.clone()).expect("claim");

        assert!(
            try_acquire_transcription(key, noop_sink()).is_none(),
            "single-flight must still refuse a duplicate while the job holds the key"
        );
        assert!(
            in_flight_refusal(key).starts_with(IN_FLIGHT_REFUSAL_PREFIX),
            "and the refusal must still carry the prefix the frontend keys off"
        );

        // Terminal event fired; the guard has not dropped yet.
        assert!(dispatch_terminal(&sink, key, 0, &stdout_lines(), Some("en".into())));
        assert!(is_transcription_in_flight(key), "still claimed at this instant");

        let (page, log) = recording_channel();
        assert!(attach_transcription(key, page));
        let received = log.lock().unwrap().clone();
        assert_eq!(
            received.len(),
            1,
            "the page must get the terminal event it would otherwise have \
             missed in this exact gap"
        );
        assert!(received[0].contains("Done"));

        drop(guard);
        assert!(!is_transcription_in_flight(key));
        assert!(
            try_acquire_transcription(key, noop_sink()).is_some(),
            "and the key must be reclaimable afterwards"
        );
    }

    #[test]
    fn an_omitted_job_key_collapses_to_one_shared_bucket() {
        // Not a per-call unique key: that would grant every id-less caller a
        // claim and silently disable single-flight for exactly the callers that
        // have not been updated to pass an id yet.
        assert_eq!(resolve_job_key(None), DEFAULT_JOB_KEY);
        assert_eq!(resolve_job_key(Some("   ".into())), DEFAULT_JOB_KEY);
        assert_eq!(resolve_job_key(Some("proj-7".into())), "proj-7");
    }
}
