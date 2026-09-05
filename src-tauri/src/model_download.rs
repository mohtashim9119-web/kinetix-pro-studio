// ---------------------------------------------------------------------------
// In-app model acquisition — resumable download engine.
//
// Originally whisper-only (bug 4 fix, WS2 Step 3 A4): the whisper model
// (`whisper.rs::MODEL_FILENAME`, ~1.51 GiB) is no longer bundled into the
// installer (`tauri.conf.json`'s `resources` map dropped `models/*` in the
// same change) — it is downloaded on demand into `app_local_data_dir()/
// models/`, which `whisper.rs::model_path` now checks first.
//
// WS2 Step 13 Phase 3 generalized the download loop itself
// (`stream_download_verified`) so the FA-pack downloader (`models.rs::
// fa_model_download`) is a caller of the SAME engine, not a parallel copy:
// streamed progress, resumable partial downloads via a `.part` file + HTTP
// Range, atomic rename on completion, and a caller-supplied verification
// closure run before the rename (whisper: the sha256 check that lived here
// inline before this refactor; FA: `fa_dev::verify_model_manifest`, already
// exact-size+sha256 against the committed manifest — no new pinned constant
// added for FA). `ModelDownloadEvent`/`ModelDownloadState` stay generic
// (never whisper-specific in shape) and are reused as-is by both callers.
//
// Cancellation: a `Mutex<Arc<AtomicBool>>`-backed flag, the same shape as
// `whisper.rs::WhisperState` uses for its child-process handle, checked once
// per chunk. Cancelling leaves the `.part` file in place so a later call
// resumes from where it stopped, mirroring the resume-after-restart path.
//
// Redirect/resume note (WS2 Step 13 Phase 3.5): every call — including a
// resumed one — re-requests the STABLE `resolve/<rev>/...` URL, never a
// signed CDN URL captured from a prior response. `reqwest::Client`'s default
// redirect policy (up to 10 hops) follows the fresh 302 to whatever signed
// URL is current at request time, so a resume can never present an expired
// signed URL — there is nothing to expire because nothing signed is ever
// stored.
//
// -- WS2 T4.3: transfer resilience --------------------------------------
//
// The defect this round fixes was NOT a corrupt-partial or stale-partial
// bug. Measured (see `.work-phase4/session-ws2-42/`): a French FA pack's
// retained `.part` was 1_071_567_076 of 1_262_619_311 bytes — 84.87 % — and
// every sampled byte range in it (0, 123_456_789, 536_870_912, 800_000_000,
// 999_999_999, and the 1 KiB immediately before its own tail) was
// byte-identical to the server's. The partial was a VALID resume point the
// whole time; `delete_installed_model` had already been purging `.part`
// files correctly. What was missing was retry: a single HTTP/2 body-stream
// truncation ~85 % into a ~1.26 GiB transfer aborted the whole download and
// demanded a manual click, and the reported cause was reqwest 0.12's opaque
// `Kind::Decode` Display ("error decoding response body") with its
// `source()` chain thrown away.
//
// So three things change here, and only these three:
//
//   1. BOUNDED RETRY (`MAX_STREAM_ATTEMPTS`). A transient stream failure is
//      retried, resuming from the `.part`'s NEW length each time so a flaky
//      link makes forward progress across attempts rather than restarting.
//      Progress never moves backwards within a retry chain (`high_water`)
//      and never double-counts, because each attempt recomputes its start
//      offset from the file on disk rather than from a carried counter.
//      What is transient and what is not is decided by
//      `classify_stream_error`/`classify_status`, never by a bare retry-all.
//
//   2. CONDITIONAL RESUME. Resume used to be ASSUMED: any `.part` shorter
//      than the expected size produced a `Range` header, and any 206 was
//      appended to. Now a `.part` carries a `PartMeta` sidecar
//      (`<target>.part.meta`) recording the URL, the expected size, and
//      whatever validator the server offered (`X-Linked-ETag` — which on
//      Hugging Face IS the LFS object's own sha256 — else `ETag`, else
//      `Last-Modified`). A resume is attempted only when the sidecar agrees
//      with the request we are about to make, and the response is accepted
//      only when it is a 206 whose `Content-Range` starts exactly at our
//      offset, totals exactly the caller's expected size, and carries a
//      validator equal to the stored one. Any disagreement discards the
//      partial and restarts from zero rather than splicing two objects.
//
//   3. 416 IS NO LONGER A PERMANENT STICK. `expected_size` comes from the
//      committed manifest, not from the server, so a remote object shorter
//      than the manifest made every retry re-send an unsatisfiable Range and
//      re-fail identically, with the `.part` retained forever — unfixable
//      through the UI. A 416 now discards the partial and restarts from zero
//      ONCE; a second 416 is permanent and says so.
//
// Retaining the `.part` on a transient failure is deliberate and unchanged —
// it is the thing that makes resume work. The only retention that was ever
// wrong is the 416 path above.
//
// -- WS2 T4.4: one writer, honest progress, no silent stalls -------------
//
// Three defects, one root. MEASURED, from the operator's own app log
// (`.work-phase4/session-ws2-43/operator-app.log`): this module's discard
// logger recorded a `.part` of 1_754_528_449 bytes against a 1_262_619_311-
// byte object. No single writer here can overshoot — a fresh attempt
// truncates and stops at Content-Length, a resumed one is admitted only by
// `validate_resume_response`'s exact start/total check, and there is no
// `seek` or `set_len` in the module at all. Two writers on one `.part` is the
// only explanation, and it explains the headline symptom exactly: the bar
// reached 1.18 GiB / 1.18 GiB while verification found 81_926_489 bytes,
// because `discard_partial` unlinks a file the other writer still holds open
// and that writer goes on filling an orphaned inode, every `write_all`
// returning `Ok`.
//
//   1. SINGLE-FLIGHT (`try_acquire_in_flight`, keyed by `.part` path). The
//      cause. A UI guard cannot substitute: `ModelsSection` has three mounts,
//      each with its own state.
//
//   2. PROGRESS IS BOUNDED BY BYTES ON DISK (`reportable_progress`). The
//      symptom, made unrepresentable. A `Progress` event now reports
//      `min(counter, metadata(part).len())`, so the bar physically cannot
//      reach 100 % over a short file — for this cause or any future one. The
//      in-attempt discard at the top of `run_stream_attempt` also resets
//      `high_water`, which it did not before (a second, independent route to
//      the same lie).
//
//   3. A STALLED SOCKET IS A TIMEOUT, NOT A HANG (`READ_TIMEOUT`). With no
//      per-read deadline, Wi-Fi dropping mid-body left `response.chunk()`
//      awaiting forever: no error, no `Retrying`, a frozen bar and no way
//      forward but closing the dialog. `is_timeout()` was ALREADY classified
//      `Transient`; nothing was ever producing one.
//
// `sync_all` before `Completed` is added alongside — it is not what caused
// this (the writer is unbuffered, so `metadata()` was never stale), but the
// `.part`-then-rename contract is only crash-atomic if the bytes are down.
// ---------------------------------------------------------------------------

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::Manager;

use crate::whisper::MODEL_FILENAME;

/// Published at https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
/// (source cited in src-tauri/models/README.md). Size and SHA-256 measured
/// against a real local copy (2026-08-26) AND cross-checked against the
/// Hugging Face API's `lfs.oid` for this file — the two agreed exactly, so
/// both are hardcoded here rather than trusted from either source alone.
const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin";
pub(crate) const MODEL_SIZE_BYTES: u64 = 1_624_555_275;
pub(crate) const MODEL_SHA256: &str = "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69";
/// ggml's own file-format magic (`GGML_FILE_MAGIC` upstream), little-endian
/// bytes of `0x67676d6c` — measured against the real local model
/// (`ggml-large-v3-turbo.bin`'s first 4 bytes: `6c 6d 67 67`). Cheap
/// first-line-of-defense precheck for `import_local_model` before paying for
/// a full stream hash, mirroring `fa_dev.rs::verify_model_manifest`'s own
/// size-precheck-before-hash structure.
pub(crate) const GGML_MAGIC: [u8; 4] = [0x6c, 0x6d, 0x67, 0x67];

/// Total stream attempts per download call, including the first. Two retries
/// follow the initial attempt, with `backoff_before_attempt` between them.
/// Chosen per owner ruling (WS2 T4.3 A1/Q1) over a single silent retry: a
/// ~1.26 GiB transfer over a consumer link can take more than one transient
/// reset, and a resumed retry is invisible to the user anyway — progress
/// continues from the resumed offset rather than restarting — so the user-
/// facing "give up and offer Retry" moment is what A1 governs, not the
/// attempt count.
pub(crate) const MAX_STREAM_ATTEMPTS: u32 = 3;

/// Backoff before `attempt` (1-based). Attempt 1 never waits; attempt 2
/// waits 1s, attempt 3 waits 2s — exponential, and bounded by
/// `MAX_STREAM_ATTEMPTS` rather than by a cap constant.
pub(crate) fn backoff_before_attempt(attempt: u32) -> Duration {
    if attempt <= 1 {
        return Duration::from_secs(0);
    }
    Duration::from_secs(1u64 << (attempt - 2))
}

/// No `Client`-wide `timeout` is set — that is a deadline for the WHOLE
/// request including the body, and a legitimate 1.26 GiB transfer on a slow
/// link would trip it. These two bound the two ways a transfer can go silent
/// instead:
///
///   * `CONNECT_TIMEOUT` — the TCP/TLS handshake never completes (Wi-Fi
///     dropped before the request went out).
///   * `READ_TIMEOUT` — reqwest 0.12's per-read inactivity deadline: the
///     connection is established but no byte has arrived for this long.
///
/// Without the second one, a Wi-Fi drop mid-body is a black hole: the socket
/// is neither closed nor readable, `response.chunk().await` never returns,
/// and the retry loop below never runs — which is exactly the "bar hangs
/// forever with no status update" the operator reported (WS2 T4.4). With it,
/// the stall surfaces as a `reqwest::Error` whose `is_timeout()` is true,
/// which `classify_stream_error` already calls `Transient`, so it flows into
/// the existing `Retrying` → backoff → resume path and the UI says
/// "Reconnecting… (attempt 2 of 3)" instead of nothing.
///
/// 60s is deliberately far above any plausible inter-chunk gap on a working
/// link (chunks arrive in milliseconds) and far below the user's patience for
/// a frozen bar.
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// 60s in the shipped app; 2s under `cargo test`, so the stall test can
/// actually reach the timeout inside a test run. Scaled here, at the single
/// definition, rather than by giving the test a private client — a test that
/// built its own client would be testing its own timeout wiring instead of
/// the engine's.
pub(crate) const READ_TIMEOUT_SECS: u64 = if cfg!(test) { 2 } else { 60 };
pub(crate) const READ_TIMEOUT: Duration = Duration::from_secs(READ_TIMEOUT_SECS);

// ---------------------------------------------------------------------------
// Single-flight (WS2 T4.4)
// ---------------------------------------------------------------------------

/// Every `.part` path with a download currently writing to it.
///
/// WHY THIS EXISTS, precisely. Before it, nothing stopped two
/// `stream_download_verified` calls from targeting one `.part`, and the UI
/// guard could not stand in for it: `ModelsSection` is mounted in THREE
/// independent places (App Settings inline, the Manage Models modal, the
/// Project Settings FA detector), each with its own React state, and until
/// WS2 T4.4 that state was lost on unmount — so closing and reopening the
/// modal offered "Resume" for a transfer that was still running.
///
/// The damage two writers do is not merely duplicated work. `discard_partial`
/// is `remove_file`, and unlinking a file another task holds open does not
/// stop that task: on APFS its descriptor keeps writing to a now-nameless
/// inode that is freed when the descriptor closes. Every write returns `Ok`,
/// so the loser's byte counter climbs to 100 % while the bytes reachable at
/// the path are somebody else's. MEASURED on the operator's machine
/// (`.work-phase4/session-ws2-43/operator-app.log`): a `.part` observed at
/// 1_754_528_449 bytes against a 1_262_619_311-byte object — 491_909_138
/// bytes MORE than the file being downloaded, which one writer cannot
/// produce, followed by a verification that read 81_926_489 bytes at the path
/// while the bar showed 1.18 GiB / 1.18 GiB.
///
/// Keyed by `.part` path rather than by the caller's model-id string on
/// purpose: the path is the resource actually being contended for, and it is
/// the one key both callers (`whisper_model_download`, `models::
/// fa_model_download`) already derive from the same `part_path_for`. A
/// second, id-shaped key could drift from it; this one cannot.
///
/// `InFlightRegistry`/`EventSink` themselves are payload-agnostic
/// (`event_sink.rs`) — this `static` is what makes THIS registry the
/// download engine's own, isolated from any other consumer that might later
/// declare its own `InFlightRegistry<K, T>` with a different key/payload.
static IN_FLIGHT: crate::event_sink::InFlightRegistry<PathBuf, ModelDownloadEvent> =
    crate::event_sink::InFlightRegistry::new();

/// The channel a running download emits through, behind a swap point.
///
/// WHY A SWAP POINT AND NOT JUST A `Channel` (WS2 T4.6). A `Channel` belongs
/// to the page that created it. Reloading the webview — Cmd+R, or the dev
/// server's own refresh — destroys that page while the Rust task keeps
/// running: `tauri::async_runtime` does not cancel a spawned command future
/// when a page goes away. MEASURED, from the operator's own report: after a
/// refresh, a second download attempt was refused with "already running",
/// which is only possible if the first task was still alive and still holding
/// its `InFlightGuard`.
///
/// So after a reload the transfer is running and completely invisible: its
/// events go to a dead page, the new page's store is empty, and the row
/// offers Resume for a download that is already in progress. Clicking it is
/// the refusal the operator hit. Quitting worked only because it killed the
/// task outright, leaving an ordinary `.part` to resume from.
///
/// Making the sink swappable lets a fresh page take over the SAME transfer
/// (`attach_to_in_flight`) instead of racing it. There is exactly one event
/// path either way — no second progress mechanism to drift from this one.
/// This module's own instantiation of the generic sink (`event_sink.rs`) —
/// every method call below (`::new`, `.send`, `.replace`) resolves through
/// this alias to the generic impl unchanged, so this refactor moves the type
/// without moving its behaviour.
pub(crate) type EventSink = crate::event_sink::EventSink<ModelDownloadEvent>;

/// The sink of the download currently writing `part_path`, if there is one.
///
/// Returned under the same lock the guard removes itself under, so a download
/// that finishes concurrently either hands back a live sink (and will emit its
/// terminal event through it) or hands back `None` — never a sink that is
/// about to be dropped with the caller waiting on it.
pub(crate) fn attach_to_in_flight(part_path: &Path) -> Option<Arc<EventSink>> {
    IN_FLIGHT.attach(part_path)
}

/// Whether a download is writing this target right now. Cheap, and the only
/// thing that can tell a fresh page "this is in progress" rather than "this
/// has a partial on disk" — two states that look identical from the
/// filesystem alone.
pub(crate) fn is_part_in_flight(part_path: &Path) -> bool {
    IN_FLIGHT.is_in_flight(part_path)
}

/// Releases its claim on drop — including on an early `return`, a `?`, or a
/// panic — so a failed download can never leave a target permanently
/// un-downloadable. Thin newtype over `event_sink::InFlightGuard`: the struct
/// has no `Drop` impl of its own, so the compiler-generated drop glue drops
/// the inner guard, which is where the actual release logic lives — the
/// field is never read directly, only dropped, hence the `allow`.
#[allow(dead_code)]
pub(crate) struct InFlightGuard(crate::event_sink::InFlightGuard<PathBuf, ModelDownloadEvent>);

/// `Some(guard)` if nothing else is writing `part_path`; `None` if one is.
/// The insert and the test are one critical section, so two simultaneous
/// callers cannot both observe "free".
pub(crate) fn try_acquire_in_flight(
    part_path: &Path,
    sink: Arc<EventSink>,
) -> Option<InFlightGuard> {
    IN_FLIGHT.try_acquire(part_path.to_path_buf(), sink).map(InFlightGuard)
}

/// The refusal a second download for an already-in-flight target gets.
/// Phrased as a statement about the transfer that IS running, not as a
/// failure of the one being refused — the user's download is not lost, it is
/// already happening.
pub(crate) fn in_flight_refusal(part_path: &Path) -> String {
    format!(
        "a download for this model is already running (writing to {}); \
         watch its progress or press Cancel to stop it — starting a second one \
         would corrupt the first",
        part_path.display()
    )
}

// ---------------------------------------------------------------------------
// Progress accounting (WS2 T4.4)
// ---------------------------------------------------------------------------

/// Bytes actually reachable at `part_path` right now. `std::fs::File` is
/// unbuffered — there is no `BufWriter` anywhere in this module — so a size
/// read straight after a `write_all` already reflects that write; this needs
/// no flush to be honest about what a reader would find.
pub(crate) fn bytes_on_disk(part_path: &Path) -> u64 {
    fs::metadata(part_path).map(|m| m.len()).unwrap_or(0)
}

/// What a `Progress` event is allowed to claim.
///
/// `counter` is what this task believes it wrote — a property of its file
/// DESCRIPTOR. `on_disk` is what is reachable at the PATH. The two are the
/// same number only while nothing else has touched the path, and the whole of
/// Defect A is the gap between them. Reporting the minimum makes
/// "progress > bytes on disk" unrepresentable, so the bar cannot reach 100 %
/// on a short file no matter what goes wrong upstream — including failure
/// modes not yet imagined, which is the point of putting the guarantee here
/// rather than in each caller.
pub(crate) fn reportable_progress(counter: u64, on_disk: u64) -> u64 {
    counter.min(on_disk)
}

/// One cancel flag per in-flight download. Keyed by an opaque caller-chosen
/// string (`"whisper"` for the whisper command, `"fa-<lang>"` for the FA
/// downloader — `models::ModelId`'s own id strings, reused rather than
/// re-invented) so a whisper download and an FA download can be cancelled
/// independently and concurrently, unlike the old single-flag
/// `ModelDownloadState` this replaces.
#[derive(Default)]
pub struct ModelDownloadState(pub Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>);

// NOTE: `rename_all` is deliberately placed on each struct-like VARIANT below,
// never on the enum itself — `#[serde(tag = "event", ...)]` uses the variant
// NAME as the tag's value, so a top-level `rename_all` on the enum would also
// lowercase "Progress"/"Done"/etc. to "progress"/"done", breaking the JS
// side's `msg.event === 'Progress'` checks (`modelDownload.ts`) while the
// download itself kept working via the command's own Result — this exact
// mismatch was caught live: the `.part` file grew correctly on disk while the
// UI stayed stuck at 0/0, confirming the channel events were arriving but not
// matching. Per-variant `rename_all` only cases each variant's OWN fields
// (downloaded_bytes -> downloadedBytes), leaving "Progress"/"Done" intact.
#[derive(serde::Serialize, Clone)]
#[serde(tag = "event", content = "data")]
pub enum ModelDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Progress { downloaded_bytes: u64, total_bytes: u64 },
    /// Emitted between attempts of a bounded retry (WS2 T4.3, owner ruling
    /// A4/Q4): a silent backoff reads as a frozen progress bar and provokes
    /// premature cancels, so the UI shows "Reconnecting… (attempt 2/3)".
    /// `downloaded_bytes` is the offset the NEXT attempt will resume from —
    /// which is why a retry never appears to lose ground.
    #[serde(rename_all = "camelCase")]
    Retrying {
        attempt: u32,
        max_attempts: u32,
        reason: String,
        downloaded_bytes: u64,
        total_bytes: u64,
    },
    Done,
    Cancelled,
    Error { message: String },
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadStatus {
    pub present: bool,
    pub partial_bytes: u64,
    pub total_bytes: u64,
    /// A download is writing this target RIGHT NOW, in this process.
    ///
    /// The filesystem cannot answer this (WS2 T4.6): a growing `.part` and an
    /// abandoned one look identical to a `stat`, so a page that has just
    /// loaded cannot tell "resume this" from "this is already running" without
    /// asking the registry. Getting it wrong is what put a Resume button over
    /// a live transfer after a webview refresh.
    pub in_flight: bool,
}

pub(crate) fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("cannot resolve app_local_data_dir: {e}"))?
        .join("models");
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// `<target>.part` — the single place this suffix is spelled, so the
/// downloader, the FA/whisper status commands and `models::
/// delete_installed_model` cannot drift apart on it.
pub(crate) fn part_path_for(target: &Path) -> PathBuf {
    let mut p = target.as_os_str().to_owned();
    p.push(".part");
    PathBuf::from(p)
}

/// `<target>.sha256` — mirrors `models.rs`'s own (private) `sidecar_path`,
/// which now delegates here rather than keeping a second independent
/// implementation. Lives in THIS module because `finalize_verified_download`
/// writes it directly (WS2 T4.8) — see that function's doc comment.
pub(crate) fn sidecar_path_for(target: &Path) -> PathBuf {
    let mut p = target.as_os_str().to_owned();
    p.push(".sha256");
    PathBuf::from(p)
}

/// `<target>.part.meta` — the resume-validator sidecar introduced by WS2
/// T4.3. Kept OUT of the existing `.sha256` companion deliberately (owner
/// ruling A2/Q2): `.sha256` is the completed model's cryptographic digest and
/// is read as raw hex by `models::status_for_generic`; URL/ETag/size are
/// transient per-transfer session state with a different lifetime.
pub(crate) fn part_meta_path_for(part_path: &Path) -> PathBuf {
    let mut p = part_path.as_os_str().to_owned();
    p.push(".meta");
    PathBuf::from(p)
}

/// What a `.part` file's own bytes are only half of: without this, a partial
/// cannot be told apart from a partial of some OTHER object, and appending to
/// it splices two files together — a corruption the terminal sha256 catches
/// only after a full re-download has already been paid for.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PartMeta {
    /// The STABLE URL requested (never a signed CDN URL — see this module's
    /// redirect note above).
    pub url: String,
    /// The caller's expected final size — the committed manifest's
    /// `byteSize` for FA, `MODEL_SIZE_BYTES` for whisper. Recorded so a
    /// manifest bump invalidates a partial instead of resuming into it.
    pub expected_size: u64,
    /// Whatever the server offered, verbatim, or `None` if it offered
    /// nothing usable. `None` does NOT block a resume — plenty of origins
    /// send no validator — but a stored `Some` that disagrees with a fresh
    /// `Some` does.
    pub validator: Option<String>,
    /// Which header `validator` came from, for the error text only.
    pub validator_source: Option<String>,
}

pub(crate) fn read_part_meta(path: &Path) -> Option<PartMeta> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub(crate) fn write_part_meta(path: &Path, meta: &PartMeta) {
    if let Ok(raw) = serde_json::to_string(meta) {
        let _ = fs::write(path, raw);
    }
}

/// Removes a partial and its validator sidecar together. Every discard path
/// goes through this so the two can never be left out of step — a `.part`
/// with a stale `.part.meta` beside it is exactly the splice hazard the
/// sidecar exists to prevent.
pub(crate) fn discard_partial(part_path: &Path, meta_path: &Path) {
    let _ = fs::remove_file(part_path);
    let _ = fs::remove_file(meta_path);
}

/// The validator the server offered, most trustworthy first. On Hugging Face
/// `X-Linked-ETag` is the LFS object's own sha256 (MEASURED 2026-08-27 and
/// again in WS2 T4.3: it equals `fa-onnx-manifest.json`'s `sha256` for the
/// language exactly), which is why it outranks the CDN's own `ETag` — the
/// latter identifies a cache entry, the former identifies the bytes.
pub(crate) fn validator_from_headers(
    lookup: impl Fn(&str) -> Option<String>,
) -> (Option<String>, Option<String>) {
    for name in ["x-linked-etag", "etag", "last-modified"] {
        if let Some(v) = lookup(name) {
            let v = v.trim().to_string();
            if !v.is_empty() {
                return (Some(v), Some(name.to_string()));
            }
        }
    }
    (None, None)
}

/// `bytes <start>-<end>/<total>` → `(start, end, total)`. Returns `None` for
/// any form this engine must not trust, including the `*/<total>`
/// unsatisfied-range form and a `*` total.
pub(crate) fn parse_content_range(raw: &str) -> Option<(u64, u64, u64)> {
    let rest = raw.trim().strip_prefix("bytes")?.trim_start();
    let (range, total) = rest.split_once('/')?;
    let (start, end) = range.trim().split_once('-')?;
    Some((
        start.trim().parse().ok()?,
        end.trim().parse().ok()?,
        total.trim().parse().ok()?,
    ))
}

/// Why a stored partial may not be offered as a resume point. Carried as a
/// value rather than a bare `bool` so the discard reason reaches the user's
/// error text instead of being flattened into "starting over".
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ResumeRefusal {
    NoPartial,
    /// Every model this engine downloads is a fixed asset, not one that
    /// grows, so a `.part` at or past the expected size is not a resume
    /// point under any validator.
    PartialAtOrPastExpectedSize { existing: u64, expected: u64 },
    MissingMeta,
    UrlChanged { stored: String, requested: String },
    ExpectedSizeChanged { stored: u64, requested: u64 },
}

impl ResumeRefusal {
    pub(crate) fn describe(&self) -> String {
        match self {
            Self::NoPartial => "no partial download on disk".to_string(),
            Self::PartialAtOrPastExpectedSize { existing, expected } => format!(
                "the partial download is {existing} bytes but the expected file is {expected} — not a resume point"
            ),
            Self::MissingMeta => {
                "the partial download has no validator sidecar recording what it is a partial OF"
                    .to_string()
            }
            Self::UrlChanged { stored, requested } => {
                format!("the partial download was fetched from {stored}, not {requested}")
            }
            Self::ExpectedSizeChanged { stored, requested } => format!(
                "the partial download was fetched against an expected size of {stored}, now {requested}"
            ),
        }
    }
}

/// PRE-request half of conditional resume: may we even send a `Range` header?
/// Pure — takes the numbers and the sidecar, touches no filesystem and no
/// network, so the whole decision table is unit-testable without a server.
pub(crate) fn plan_resume(
    existing_len: u64,
    expected_size: u64,
    meta: Option<&PartMeta>,
    url: &str,
) -> Result<u64, ResumeRefusal> {
    // The URL is checked LAST, deliberately: `status_for_target` reuses the
    // checks below and has no URL to offer, so a URL refusal must not be able
    // to mask a size or sidecar refusal by firing before it.
    //
    // Note there is exactly ONE sidecar/size/length guard, in
    // `plan_resume_without_url`, and this function reaches it through `?`
    // rather than repeating it. An earlier draft re-checked `meta.is_some()`
    // here too; the second check was unreachable (the `?` above already
    // rejects a `None`) and its only effect was to make a destructive probe
    // ambiguous — reverting either copy alone left the other standing, so
    // neither could be shown to be load-bearing.
    let offset = plan_resume_without_url(existing_len, expected_size, meta)?;
    if let Some(meta) = meta {
        if meta.url != url {
            return Err(ResumeRefusal::UrlChanged {
                stored: meta.url.clone(),
                requested: url.to_string(),
            });
        }
    }
    Ok(offset)
}

/// Every resume precondition that does not depend on knowing the URL. Split
/// out so a status query — which is asked about a target path, not about a
/// pending request — evaluates the SAME table the downloader will, rather
/// than a lookalike that can drift from it.
pub(crate) fn plan_resume_without_url(
    existing_len: u64,
    expected_size: u64,
    meta: Option<&PartMeta>,
) -> Result<u64, ResumeRefusal> {
    if existing_len == 0 {
        return Err(ResumeRefusal::NoPartial);
    }
    if existing_len >= expected_size {
        return Err(ResumeRefusal::PartialAtOrPastExpectedSize {
            existing: existing_len,
            expected: expected_size,
        });
    }
    let meta = meta.ok_or(ResumeRefusal::MissingMeta)?;
    if meta.expected_size != expected_size {
        return Err(ResumeRefusal::ExpectedSizeChanged {
            stored: meta.expected_size,
            requested: expected_size,
        });
    }
    Ok(existing_len)
}

/// POST-response half of conditional resume. A 206 is necessary and nowhere
/// near sufficient: the range must start exactly where we are about to
/// append, the total must be the size we are verifying against, and a
/// validator the server gave us before must not have changed underneath the
/// transfer. Anything else and the partial is discarded rather than spliced.
pub(crate) fn validate_resume_response(
    status: u16,
    content_range: Option<&str>,
    fresh_validator: Option<&str>,
    stored: &PartMeta,
    existing_len: u64,
    expected_size: u64,
) -> Result<(), String> {
    if status != 206 {
        return Err(format!(
            "asked to resume from byte {existing_len} but the server answered HTTP {status}, not 206 Partial Content"
        ));
    }
    let raw = content_range.ok_or_else(|| {
        format!("the server answered 206 for a resume from byte {existing_len} but sent no Content-Range header")
    })?;
    let (start, _end, total) = parse_content_range(raw)
        .ok_or_else(|| format!("the server sent an uninterpretable Content-Range: {raw:?}"))?;
    if start != existing_len {
        return Err(format!(
            "asked to resume from byte {existing_len} but the server sent bytes starting at {start}"
        ));
    }
    if total != expected_size {
        return Err(format!(
            "the server reports the file is {total} bytes but the committed manifest expects {expected_size}"
        ));
    }
    match (stored.validator.as_deref(), fresh_validator) {
        (Some(stored_v), Some(fresh_v)) if stored_v != fresh_v => Err(format!(
            "the file on the server changed since the partial download was started ({} was {stored_v}, now {fresh_v})",
            stored.validator_source.as_deref().unwrap_or("its validator")
        )),
        _ => Ok(()),
    }
}

/// What a failure means for the retry loop. Nothing is retried by default —
/// each arm below is a deliberate classification, so a new failure mode
/// surfaces as `Permanent` rather than silently spinning three times.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Disposition {
    /// Retry after backoff, resuming from the partial's new length.
    Transient,
    /// Discard the partial and re-attempt from byte 0 — does not spend the
    /// transient budget, and is allowed at most once per download call.
    RestartFromZero,
    /// Stop. No retry will change the outcome.
    Permanent,
}

/// HTTP status → disposition. 416 is the whole reason this function exists:
/// `expected_size` comes from the committed manifest, never from the server,
/// so a remote object shorter than the manifest makes an otherwise-valid
/// resume offset unsatisfiable, and the pre-T4.3 engine re-sent that exact
/// unsatisfiable Range on every retry forever.
pub(crate) fn classify_status(status: u16, was_resume: bool) -> Disposition {
    match status {
        416 if was_resume => Disposition::RestartFromZero,
        // 408/429 are 4xx but are explicitly "try again" statuses; every
        // other 4xx describes the request itself and will not improve.
        408 | 429 => Disposition::Transient,
        500..=599 => Disposition::Transient,
        _ => Disposition::Permanent,
    }
}

/// reqwest error → disposition, for the request and body-stream stages.
///
/// The operator-reported failure lands here: reqwest 0.12 reports an HTTP/2
/// body-stream truncation as `Kind::Decode` ("error decoding response body"),
/// which `is_decode()` matches. That is transient — the bytes already on disk
/// are a valid prefix (MEASURED, WS2 T4.3 Step 1) and the next attempt
/// resumes from them. Note this crate builds reqwest WITHOUT `gzip`/`brotli`/
/// `deflate`/`zstd` (verified via `cargo tree -e features -i reqwest`), so a
/// decode error here can never be a decompression failure — there is no
/// decompressor in the build.
pub(crate) fn classify_stream_error(e: &reqwest::Error) -> Disposition {
    if e.is_timeout() || e.is_connect() || e.is_decode() || e.is_body() || e.is_request() {
        Disposition::Transient
    } else {
        Disposition::Permanent
    }
}

/// Flattens an error's whole `source()` chain into one line.
///
/// `format!("{e}")` on a `reqwest::Error` prints only its top-level kind —
/// which is how the operator's report came back as the bare, uninformative
/// "error decoding response body" with the real cause (an incomplete message
/// / stream reset) discarded before anything logged it.
pub(crate) fn cause_chain(err: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![err.to_string()];
    let mut source = err.source();
    while let Some(s) = source {
        let text = s.to_string();
        if !parts.iter().any(|p| p == &text) {
            parts.push(text);
        }
        source = s.source();
    }
    parts.join(": ")
}

/// Human-readable byte count for an error message — errors are read by
/// people, and "1071567076" is not a number anyone can size at a glance.
pub(crate) fn describe_bytes(bytes: u64) -> String {
    const GIB: f64 = (1024u64 * 1024 * 1024) as f64;
    const MIB: f64 = (1024u64 * 1024) as f64;
    let b = bytes as f64;
    if b >= GIB {
        format!("{:.2} GiB", b / GIB)
    } else if b >= MIB {
        format!("{:.1} MiB", b / MIB)
    } else {
        format!("{bytes} bytes")
    }
}

/// The one place the "retries exhausted, partial kept, resume is real"
/// message is built. It states the true cause (full `source()` chain), names
/// the partial path, and gives its CURRENT byte count against the total —
/// so the claim that the next attempt resumes is checkable by the reader
/// rather than merely asserted.
pub(crate) fn exhausted_message(
    cause: &str,
    attempts: u32,
    part_path: &Path,
    have: u64,
    total: u64,
) -> String {
    if have == 0 {
        // Nothing was kept, so nothing may be promised. The pre-T4.3 engine's
        // failure mode was exactly this: a resume claim attached to a state
        // that could not honour it.
        return format!(
            "download interrupted after {attempts} attempts: {cause} — no partial download was kept \
             ({}); the next download starts from the beginning",
            part_path.display()
        );
    }
    format!(
        "download interrupted after {attempts} attempts: {cause} — kept {} of {} ({}/{} bytes) at {}; \
         the next download resumes from there, it does not start over",
        describe_bytes(have),
        describe_bytes(total),
        have,
        total,
        part_path.display()
    )
}

/// The one place the "this failed for good" message is built. Unlike
/// `exhausted_message` it never promises resume — a message that promises
/// resume where resume cannot work is the specific defect this round
/// removes.
pub(crate) fn permanent_message(cause: &str, part_path: &Path, partial_discarded: bool) -> String {
    let tail = if partial_discarded {
        format!(
            "the partial download at {} was discarded; retrying will start from zero",
            part_path.display()
        )
    } else {
        format!(
            "the partial download at {} was left in place but will not help; delete the pack and download it again",
            part_path.display()
        )
    };
    format!("download failed permanently: {cause} — {tail}")
}

/// The shared body of `whisper_model_status` and `models::fa_model_status`:
/// present? and how many resumable bytes are on disk? Factored out so the FA
/// row cannot drift from the whisper row on what "resumable" means — notably
/// that a `.part` at or past `expected_size`, which `plan_resume` refuses,
/// must NOT be advertised as resumable bytes.
pub(crate) fn status_for_target(target: &Path, expected_size: u64) -> ModelDownloadStatus {
    // A completed target's own byte count is NOT a resumable partial, and
    // saying otherwise is what put "RESUME 1.51 GiB" on a fully installed
    // whisper row and "RESUME 1.18 GiB" on every installed FA pack (WS2 T4.5,
    // operator report — both numbers are `formatBytes(expected_size)` exactly,
    // which is how this line was identified as their single source). The
    // engine's own first statement settles what the right answer is:
    // `stream_download_verified` returns `Done` immediately when
    // `final_path.exists()`, so there is nothing to resume onto a completed
    // target and 0 is the only number that describes what a download would
    // actually do.
    //
    // `present` requires the SIZE to match too, not merely that a file is
    // there. A wrong-size file at the target path is not something to
    // suppress the Download button over — the user would be left with a row
    // offering no way to repair itself short of a delete. Such a file falls
    // through to the `.part` branch below, which reports the partial's bytes
    // and never the target's.
    //
    // `present` remains a CHEAP probe — a stat, not a hash. Whether an
    // existing file is genuinely the right model is `models::
    // check_installed_models`'s question, and the badge is still rendered
    // from its answer, never from this one.
    if let Ok(meta) = fs::metadata(target) {
        if meta.len() == expected_size {
            return ModelDownloadStatus {
                present: true,
                partial_bytes: 0,
                total_bytes: expected_size,
                in_flight: false,
            };
        }
    }
    let part_path = part_path_for(target);
    let on_disk = fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
    let meta = read_part_meta(&part_meta_path_for(&part_path));
    // Report only what the downloader would actually accept, so the UI can
    // never offer "Resume 1.02 GiB" for a partial the engine will discard.
    // The URL is the one precondition a status call cannot evaluate (it is a
    // property of the pending request, not of the target), so this uses the
    // URL-free half of the same decision table rather than a second copy.
    let partial_bytes = plan_resume_without_url(on_disk, expected_size, meta.as_ref()).unwrap_or(0);
    ModelDownloadStatus {
        present: false,
        partial_bytes,
        total_bytes: expected_size,
        in_flight: is_part_in_flight(&part_path),
    }
}

/// Reports whether the model is already present, and how much of a resumable
/// `.part` file (if any) already exists — used by the acquisition panel to
/// skip straight to "ready" or show a resume affordance instead of starting
/// cold.
#[tauri::command]
pub fn whisper_model_status(app: tauri::AppHandle) -> Result<ModelDownloadStatus, String> {
    let dir = models_dir(&app)?;
    Ok(status_for_target(&dir.join(MODEL_FILENAME), MODEL_SIZE_BYTES))
}

/// Hands a freshly loaded page the event stream of a download that is already
/// running, instead of leaving it to guess from the filesystem.
///
/// Returns `false` when nothing is in flight for this target — which the
/// caller must treat as "read the status normally", not as an error: a
/// transfer can legitimately finish in the gap between a status poll and this
/// call, and that is a completed download, not a failure.
///
/// The old page's channel is replaced, not duplicated. There is one transfer
/// and one place its events go; a fan-out would mean deciding what to do when
/// one of several listeners is dead, which is the problem this exists to
/// avoid.
pub(crate) fn attach_to_target(
    target: &Path,
    on_event: Channel<ModelDownloadEvent>,
) -> bool {
    let part_path = part_path_for(target);
    match attach_to_in_flight(&part_path) {
        Some(sink) => {
            sink.replace(on_event);
            true
        }
        None => false,
    }
}

/// Re-attaches to an in-progress whisper download after a page reload.
#[tauri::command]
pub fn whisper_model_download_attach(
    app: tauri::AppHandle,
    on_event: Channel<ModelDownloadEvent>,
) -> Result<bool, String> {
    let dir = models_dir(&app)?;
    Ok(attach_to_target(&dir.join(MODEL_FILENAME), on_event))
}

pub(crate) fn cancel_flag_for(state: &tauri::State<'_, ModelDownloadState>, key: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    state.0.lock().unwrap().insert(key.to_string(), flag.clone());
    flag
}

#[tauri::command]
pub fn whisper_model_download_cancel(state: tauri::State<'_, ModelDownloadState>) {
    if let Some(flag) = state.0.lock().unwrap().get("whisper") {
        flag.store(true, Ordering::SeqCst);
    }
}

/// Streams the model to `app_local_data_dir()/models/{MODEL_FILENAME}.part`,
/// resuming via HTTP Range if a validated partial file already exists, then
/// verifies SHA-256 and atomically renames to the final filename. Never
/// panics on a network/IO error — always returns `Err` with an actionable
/// message.
#[tauri::command]
pub async fn whisper_model_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModelDownloadState>,
    on_event: Channel<ModelDownloadEvent>,
) -> Result<(), String> {
    let dir = models_dir(&app)?;
    let final_path = dir.join(MODEL_FILENAME);
    let part_path = part_path_for(&final_path);
    let cancel_flag = cancel_flag_for(&state, "whisper");

    stream_download_verified(
        MODEL_URL.to_string(),
        final_path,
        part_path,
        MODEL_SIZE_BYTES,
        cancel_flag,
        on_event,
        |path| {
            let digest = crate::sha256::hash_file(path).map_err(|e| e.to_string())?;
            if digest != MODEL_SHA256 {
                return Err(format!(
                    "downloaded model failed checksum verification (expected {MODEL_SHA256}, got {digest})"
                ));
            }
            Ok(digest)
        },
    )
    .await
}

/// How one stream attempt ended. `Completed` means the body reached its end;
/// it says nothing about whether the bytes are correct — that is
/// `finalize_verified_download`'s job and it runs exactly once, after the
/// retry loop.
enum AttemptOutcome {
    Completed,
    Cancelled,
    Transient { cause: String },
    RestartFromZero { cause: String },
    Permanent { cause: String, partial_discarded: bool },
}

/// The generic resumable-download core both `whisper_model_download` and
/// `models::fa_model_download` call.
///
/// Structure (WS2 T4.3): a bounded retry loop around `run_stream_attempt`,
/// then `finalize_verified_download` exactly once. `verify` runs (on a
/// blocking thread — it may hash a multi-hundred-MB-to-multi-GB file) on the
/// `.part` file BEFORE the atomic rename; a verification failure deletes the
/// `.part` and never renames, so a bad download can never replace a
/// previously-good installed model. `url` is re-requested from scratch on
/// every attempt (including a resume) — see this module's own doc comment
/// for why that makes signed-URL expiry a non-issue.
///
/// `verify` returns the file's digest on success (WS2 T4.8), not `()` — see
/// `finalize_verified_download`'s doc comment for why: it is what lets the
/// `.sha256` sidecar be written from a hash that was going to be computed
/// anyway, rather than by hashing the file a second time afterward.
pub(crate) async fn stream_download_verified(
    url: String,
    final_path: PathBuf,
    part_path: PathBuf,
    expected_size: u64,
    cancel_flag: Arc<AtomicBool>,
    on_event: Channel<ModelDownloadEvent>,
    verify: impl FnOnce(&Path) -> Result<String, String> + Send + 'static,
) -> Result<(), String> {
    if final_path.exists() {
        let _ = on_event.send(ModelDownloadEvent::Done);
        return Ok(());
    }

    // Claimed BEFORE anything is opened or written, and held for the whole
    // call (including `finalize_verified_download`, which renames the file
    // out from under any second writer). A refusal is an `Error` event as
    // well as an `Err`, so a caller that only listens on the channel still
    // learns why nothing happened.
    // The caller's channel becomes a swappable sink BEFORE the claim, so the
    // claim and the sink are registered together and a page that attaches
    // immediately after cannot find a claim with no sink behind it.
    let sink = Arc::new(EventSink::new(on_event));
    let _in_flight = match try_acquire_in_flight(&part_path, sink.clone()) {
        Some(g) => g,
        None => {
            let msg = in_flight_refusal(&part_path);
            sink.send(ModelDownloadEvent::Error { message: msg.clone() });
            return Err(msg);
        }
    };

    let meta_path = part_meta_path_for(&part_path);
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; KinetixPro/1.0)")
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    // Never emitted below its previous value: a resumed attempt starts its
    // own counter at the offset it resumed from, so ground is never re-
    // covered and never re-counted. A RestartFromZero legitimately resets it,
    // and is announced by its own `Retrying` event rather than by a silent
    // backwards `Progress`.
    let mut high_water: u64 = 0;
    let mut attempt: u32 = 1;
    let mut restarted_from_zero = false;
    let mut force_from_zero = false;

    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            sink.send(ModelDownloadEvent::Cancelled);
            return Err("download cancelled — partial download kept for resume".to_string());
        }

        let outcome = run_stream_attempt(
            &client,
            &url,
            &part_path,
            &meta_path,
            expected_size,
            force_from_zero,
            &cancel_flag,
            &sink,
            &mut high_water,
        )
        .await;

        match outcome {
            AttemptOutcome::Completed => break,
            AttemptOutcome::Cancelled => {
                sink.send(ModelDownloadEvent::Cancelled);
                return Err("download cancelled — partial download kept for resume".to_string());
            }
            AttemptOutcome::Permanent { cause, partial_discarded } => {
                // Report what is actually on disk, not what this attempt
                // believed: an earlier RestartFromZero may already have
                // discarded the partial, and a message that misstates that is
                // the same class of defect as one promising a resume that
                // cannot work.
                let discarded = partial_discarded || !part_path.exists();
                let msg = permanent_message(&cause, &part_path, discarded);
                sink.send(ModelDownloadEvent::Error { message: msg.clone() });
                return Err(msg);
            }
            AttemptOutcome::RestartFromZero { cause } => {
                if restarted_from_zero {
                    // Second time: the remote object genuinely does not match
                    // what we are verifying against. Retrying cannot fix that.
                    discard_partial(&part_path, &meta_path);
                    let msg = permanent_message(
                        &format!(
                            "{cause}; restarting from zero did not help, so the remote file no longer \
                             matches the size recorded in the committed manifest ({expected_size} bytes)"
                        ),
                        &part_path,
                        true,
                    );
                    sink.send(ModelDownloadEvent::Error { message: msg.clone() });
                    return Err(msg);
                }
                restarted_from_zero = true;
                force_from_zero = true;
                discard_partial(&part_path, &meta_path);
                high_water = 0;
                sink.send(ModelDownloadEvent::Retrying {
                    attempt,
                    max_attempts: MAX_STREAM_ATTEMPTS,
                    reason: format!("{cause} — starting over from the beginning"),
                    downloaded_bytes: 0,
                    total_bytes: expected_size,
                });
                // A restart is not a transient failure and does not spend the
                // transient budget — it has not yet had one honest attempt at
                // a full transfer.
                continue;
            }
            AttemptOutcome::Transient { cause } => {
                let have = fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
                if attempt >= MAX_STREAM_ATTEMPTS {
                    let msg =
                        exhausted_message(&cause, attempt, &part_path, have, expected_size);
                    sink.send(ModelDownloadEvent::Error { message: msg.clone() });
                    return Err(msg);
                }
                let next = attempt + 1;
                sink.send(ModelDownloadEvent::Retrying {
                    attempt: next,
                    max_attempts: MAX_STREAM_ATTEMPTS,
                    reason: cause,
                    downloaded_bytes: have,
                    total_bytes: expected_size,
                });
                let wait = backoff_before_attempt(next);
                if !wait.is_zero() {
                    // No direct tokio dependency in this crate; a blocking
                    // sleep on the blocking pool is the no-new-dependency way
                    // to wait without stalling the async runtime.
                    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(wait)).await;
                }
                attempt = next;
                force_from_zero = false;
                continue;
            }
        }
    }

    finalize_verified_download(part_path, meta_path, final_path, expected_size, sink, verify).await
}

/// One attempt: decide the resume offset, make the request, gate the
/// response, then stream to the `.part` file. Returns how the attempt ended;
/// it never sleeps, never emits `Error`, and never verifies — the caller owns
/// all three.
#[allow(clippy::too_many_arguments)]
async fn run_stream_attempt(
    client: &reqwest::Client,
    url: &str,
    part_path: &Path,
    meta_path: &Path,
    expected_size: u64,
    force_from_zero: bool,
    cancel_flag: &Arc<AtomicBool>,
    sink: &EventSink,
    high_water: &mut u64,
) -> AttemptOutcome {
    let existing_len = fs::metadata(part_path).map(|m| m.len()).unwrap_or(0);
    let stored_meta = read_part_meta(meta_path);

    let planned = if force_from_zero {
        Err(ResumeRefusal::NoPartial)
    } else {
        plan_resume(existing_len, expected_size, stored_meta.as_ref(), url)
    };
    // A partial we refuse to resume from is discarded now, not left to be
    // re-evaluated identically on the next attempt. The reason is logged
    // rather than dropped: "why did this restart from zero" was exactly the
    // question Step 1 could not answer from the shipped error text.
    if let Err(ref refusal) = planned {
        if !matches!(refusal, ResumeRefusal::NoPartial) || existing_len > 0 {
            log::info!(
                "[model_download] discarding partial at {}: {}",
                part_path.display(),
                refusal.describe()
            );
            discard_partial(part_path, meta_path);
            // This attempt is about to stream from byte 0 into a file that no
            // longer exists, so the previous attempt's high-water mark is no
            // longer a claim about anything. Leaving it standing was a real
            // second route to "the bar says 100 % over a short file" — the
            // outer loop resets `high_water` on `RestartFromZero`, but this
            // discard does not go through that arm.
            *high_water = 0;
        }
    }
    let resume_from = planned.ok();

    let mut request = client.get(url);
    if let Some(offset) = resume_from {
        request = request.header("Range", format!("bytes={offset}-"));
    }

    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            let cause = cause_chain(&e);
            return match classify_stream_error(&e) {
                Disposition::Transient => AttemptOutcome::Transient { cause },
                _ => AttemptOutcome::Permanent { cause, partial_discarded: false },
            };
        }
    };

    let status = response.status().as_u16();
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    };
    let content_range = header("content-range");
    let (fresh_validator, fresh_validator_source) = validator_from_headers(&header);

    if !response.status().is_success() {
        let was_resume = resume_from.is_some();
        let cause = format!("the server answered HTTP {status} for {url}");
        return match classify_status(status, was_resume) {
            Disposition::Transient => AttemptOutcome::Transient { cause },
            Disposition::RestartFromZero => AttemptOutcome::RestartFromZero {
                cause: format!(
                    "the server rejected a resume from byte {} as an unsatisfiable range (HTTP 416)",
                    resume_from.unwrap_or(0)
                ),
            },
            Disposition::Permanent => {
                AttemptOutcome::Permanent { cause, partial_discarded: false }
            }
        };
    }

    // Conditional resume, post-response half. Any disagreement discards the
    // partial and restarts from zero rather than appending onto bytes we can
    // no longer vouch for.
    let mut start_offset = 0u64;
    if let Some(offset) = resume_from {
        let stored = stored_meta.clone().unwrap_or(PartMeta {
            url: url.to_string(),
            expected_size,
            validator: None,
            validator_source: None,
        });
        match validate_resume_response(
            status,
            content_range.as_deref(),
            fresh_validator.as_deref(),
            &stored,
            offset,
            expected_size,
        ) {
            Ok(()) => start_offset = offset,
            Err(cause) => {
                discard_partial(part_path, meta_path);
                return AttemptOutcome::RestartFromZero { cause };
            }
        }
    }

    let resumed = start_offset > 0;
    if !resumed {
        // A fresh transfer re-records what it is a transfer OF, so the next
        // attempt has something to check against.
        write_part_meta(
            meta_path,
            &PartMeta {
                url: url.to_string(),
                expected_size,
                validator: fresh_validator.clone(),
                validator_source: fresh_validator_source.clone(),
            },
        );
    }

    let mut file = match OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!resumed)
        .append(resumed)
        .open(part_path)
    {
        Ok(f) => f,
        Err(e) => {
            return AttemptOutcome::Permanent {
                cause: format!("cannot open {}: {e}", part_path.display()),
                partial_discarded: false,
            }
        }
    };

    let mut downloaded = start_offset;
    if downloaded > *high_water {
        *high_water = downloaded;
    }
    let mut last_emit = std::time::Instant::now();
    sink.send(ModelDownloadEvent::Progress {
        downloaded_bytes: reportable_progress(*high_water, bytes_on_disk(part_path)),
        total_bytes: expected_size,
    });

    let mut response = response;
    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            return AttemptOutcome::Cancelled;
        }
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if let Err(e) = file.write_all(&chunk) {
                    return AttemptOutcome::Permanent {
                        cause: format!("write failed (disk full?): {e}"),
                        partial_discarded: false,
                    };
                }
                downloaded += chunk.len() as u64;
                if downloaded > *high_water {
                    *high_water = downloaded;
                }
                if last_emit.elapsed().as_millis() >= 150 {
                    // Deliberately a fresh `metadata()` per emit, not the
                    // in-memory counter: the counter describes this task's
                    // file descriptor, and a descriptor can outlive the name
                    // it was opened under. Once every 150 ms a stat costs
                    // nothing against a multi-hundred-megabyte transfer.
                    sink.send(ModelDownloadEvent::Progress {
                        downloaded_bytes: reportable_progress(*high_water, bytes_on_disk(part_path)),
                        total_bytes: expected_size,
                    });
                    last_emit = std::time::Instant::now();
                }
            }
            Ok(None) => {
                // The body ended. Flush to stable storage before anyone
                // stats or hashes this file: `finalize_verified_download`
                // decides on its CONTENT, and the `.part`-then-rename dance
                // only buys crash-atomicity if the bytes are actually down
                // (the import path already does this — `models.rs`'s
                // `import_to_target` — this one did not).
                if let Err(e) = file.sync_all() {
                    return AttemptOutcome::Permanent {
                        cause: format!("could not flush {} to disk: {e}", part_path.display()),
                        partial_discarded: false,
                    };
                }
                return AttemptOutcome::Completed;
            }
            Err(e) => {
                let cause = cause_chain(&e);
                return match classify_stream_error(&e) {
                    Disposition::Transient => AttemptOutcome::Transient { cause },
                    _ => AttemptOutcome::Permanent { cause, partial_discarded: false },
                };
            }
        }
    }
}

/// The post-download half of [`stream_download_verified`]: verify (on a
/// blocking thread — may hash a file up to ~1.6 GiB whisper / ~1.26 GiB FA)
/// then atomically rename, or on a verification failure delete the `.part`
/// (and its validator sidecar) and return its specific error. Split out from
/// the network loop above so it is directly testable without a real HTTP
/// download — a test only needs to place bytes at `part_path` itself.
///
/// WS2 T4.8: writes the `.sha256` sidecar itself, right after the rename,
/// from the digest `verify` returns — MEASURED root cause of a repeat
/// operator report ("Unverified" after a completed download, then every row
/// stuck on "Checking…" on reload): `fa_model_download`'s old post-success
/// step re-hashed the SAME file `verify` had just hashed moments earlier, a
/// second full ~1.2 GiB read that, competing with macOS Spotlight indexing
/// the just-downloaded file, was measured hanging PAST 90 SECONDS on the
/// operator's machine — not merely slow (WS2 T4.6's "wrong thread" framing
/// undersold it; this fix doesn't move that read, it deletes it). Whisper had
/// the identical gap, latent: `whisper_model_download`'s `verify` closure
/// already computed a digest to check against `MODEL_SHA256` and threw it
/// away, leaving the FIRST post-download status check to hash the whole
/// ~1.6 GiB file cold. One digest, computed once, is now the sidecar for
/// both paths — there is no second read to contend with anything.
async fn finalize_verified_download(
    part_path: PathBuf,
    meta_path: PathBuf,
    final_path: PathBuf,
    expected_size: u64,
    sink: Arc<EventSink>,
    verify: impl FnOnce(&Path) -> Result<String, String> + Send + 'static,
) -> Result<(), String> {
    let verify_path = part_path.clone();
    let verify_result =
        tauri::async_runtime::spawn_blocking(move || verify(&verify_path)).await.map_err(|e| e.to_string())?;

    let digest = match verify_result {
        Ok(digest) => digest,
        Err(msg) => {
            // Retaining rejected bytes would guarantee the next attempt
            // reproduces the failure, so the partial goes — and the message
            // says so instead of promising a resume that cannot work.
            discard_partial(&part_path, &meta_path);
            let full_msg = format!(
                "{msg} — the partial download at {} was deleted; the next download starts from zero",
                part_path.display()
            );
            sink.send(ModelDownloadEvent::Error { message: full_msg.clone() });
            return Err(full_msg);
        }
    };

    fs::rename(&part_path, &final_path)
        .map_err(|e| format!("cannot finalize {}: {e}", final_path.display()))?;
    let _ = fs::remove_file(&meta_path);
    // Best-effort: a failed sidecar write costs the NEXT status check one
    // hash, exactly the pre-T4.8 behaviour — it must never fail the download
    // that already succeeded.
    let _ = fs::write(sidecar_path_for(&final_path), &digest);

    sink.send(ModelDownloadEvent::Progress { downloaded_bytes: expected_size, total_bytes: expected_size });
    sink.send(ModelDownloadEvent::Done);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sha256::{hex_digest, Sha256};

    /// `Sha256`/`hex_digest` stay imported by the crate-wide sha256 module
    /// used elsewhere; this file's own former inline streaming-hash re-check
    /// (removed by the Phase 3 refactor — `verify` now owns hashing) is
    /// covered instead by `hash_file_matches_in_memory_digest` in
    /// `sha256.rs` and by `models.rs`'s import-atomicity tests, which
    /// exercise the same `hash_file`/`GGML_MAGIC`/`MODEL_SHA256` constants
    /// this module still owns. This test only pins that the constants
    /// themselves didn't drift during the refactor.
    #[test]
    fn whisper_constants_unchanged_by_the_phase_3_refactor() {
        assert_eq!(MODEL_SIZE_BYTES, 1_624_555_275);
        assert_eq!(MODEL_SHA256, "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69");
        assert_eq!(GGML_MAGIC, [0x6c, 0x6d, 0x67, 0x67]);
    }

    #[test]
    fn hex_digest_still_reachable_for_a_zero_length_input() {
        let h = Sha256::new();
        assert_eq!(hex_digest(&h.finish()).len(), 64);
    }

    fn noop_channel() -> Channel<ModelDownloadEvent> {
        Channel::new(|_body| Ok(()))
    }

    fn test_sink() -> Arc<EventSink> {
        Arc::new(EventSink::new(noop_channel()))
    }

    fn temp_dir_named(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kinetix-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // -- finalize_verified_download (WS2 Step 13 Phase 3.4) -------------

    #[test]
    fn finalize_rejects_on_verify_failure_deletes_part_and_never_renames() {
        let dir = temp_dir_named("finalize-test");
        let part = dir.join("model.onnx.part");
        let meta = part_meta_path_for(&part);
        let final_path = dir.join("model.onnx");
        fs::write(&part, b"wrong bytes entirely").unwrap();
        fs::write(&meta, b"{}").unwrap();
        // A prior installed model must survive a rejected finalize, same
        // invariant `models.rs::import_to_target` already proves for import.
        fs::write(&final_path, b"pre-existing good model").unwrap();

        let result = tauri::async_runtime::block_on(finalize_verified_download(
            part.clone(),
            meta.clone(),
            final_path.clone(),
            21,
            test_sink(),
            |_path| Err("expected size mismatch: got 21, wanted 999".to_string()),
        ));

        let err = result.expect_err("verify failure must reject");
        assert!(err.contains("expected size mismatch"), "error must be specific, got: {err}");
        assert!(!part.exists(), ".part must be deleted on verify failure");
        assert!(!meta.exists(), ".part.meta must be deleted with its .part");
        assert_eq!(fs::read(&final_path).unwrap(), b"pre-existing good model", "existing target must survive");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn finalize_renames_to_final_path_on_verify_success() {
        let dir = temp_dir_named("finalize-test-ok");
        let part = dir.join("model.onnx.part");
        let meta = part_meta_path_for(&part);
        let final_path = dir.join("model.onnx");
        fs::write(&part, b"good bytes").unwrap();
        fs::write(&meta, b"{}").unwrap();

        let result = tauri::async_runtime::block_on(finalize_verified_download(
            part.clone(),
            meta.clone(),
            final_path.clone(),
            10,
            test_sink(),
            |_path| Ok("deadbeef".to_string()),
        ));

        assert!(result.is_ok(), "verify success must finalize, got {result:?}");
        assert!(!part.exists(), ".part must be gone after a successful rename");
        assert!(!meta.exists(), ".part.meta must not outlive the transfer it describes");
        assert_eq!(fs::read(&final_path).unwrap(), b"good bytes");
        // WS2 T4.8: the sidecar comes from the digest `verify` returned, not
        // from an independent re-hash — "deadbeef" is not `good bytes`'s real
        // sha256, so finding it proves no second hash happened.
        assert_eq!(
            fs::read_to_string(sidecar_path_for(&final_path)).unwrap(),
            "deadbeef",
            "the sidecar must be written from verify()'s returned digest, not re-derived"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancel_flags_are_independent_per_key() {
        let map: std::sync::Mutex<std::collections::HashMap<String, Arc<AtomicBool>>> =
            std::sync::Mutex::new(std::collections::HashMap::new());
        let a = Arc::new(AtomicBool::new(false));
        let b = Arc::new(AtomicBool::new(false));
        map.lock().unwrap().insert("whisper".to_string(), a.clone());
        map.lock().unwrap().insert("fa-en".to_string(), b.clone());
        a.store(true, Ordering::SeqCst);
        assert!(map.lock().unwrap().get("whisper").unwrap().load(Ordering::SeqCst));
        assert!(!map.lock().unwrap().get("fa-en").unwrap().load(Ordering::SeqCst));
    }

    // -- WS2 T4.3 pure decision-table tests -----------------------------

    fn meta_for(url: &str, size: u64, validator: Option<&str>) -> PartMeta {
        PartMeta {
            url: url.to_string(),
            expected_size: size,
            validator: validator.map(|s| s.to_string()),
            validator_source: validator.map(|_| "etag".to_string()),
        }
    }

    #[test]
    fn parse_content_range_reads_the_forms_that_matter_and_refuses_the_rest() {
        assert_eq!(parse_content_range("bytes 100-199/1000"), Some((100, 199, 1000)));
        assert_eq!(parse_content_range("bytes 0-0/1"), Some((0, 0, 1)));
        // The unsatisfied-range form carries no start; trusting it would be
        // an append at an unknown offset.
        assert_eq!(parse_content_range("bytes */1000"), None);
        assert_eq!(parse_content_range("bytes 100-199/*"), None);
        assert_eq!(parse_content_range("items 1-2/3"), None);
        assert_eq!(parse_content_range(""), None);
    }

    #[test]
    fn plan_resume_refuses_a_partial_with_no_sidecar_or_a_changed_url_or_size() {
        let url = "https://example.invalid/m.onnx";
        assert_eq!(plan_resume(0, 100, None, url), Err(ResumeRefusal::NoPartial));
        assert_eq!(
            plan_resume(100, 100, Some(&meta_for(url, 100, None)), url),
            Err(ResumeRefusal::PartialAtOrPastExpectedSize { existing: 100, expected: 100 })
        );
        assert_eq!(plan_resume(50, 100, None, url), Err(ResumeRefusal::MissingMeta));
        assert!(matches!(
            plan_resume(50, 100, Some(&meta_for("https://other.invalid/m", 100, None)), url),
            Err(ResumeRefusal::UrlChanged { .. })
        ));
        assert!(matches!(
            plan_resume(50, 100, Some(&meta_for(url, 99, None)), url),
            Err(ResumeRefusal::ExpectedSizeChanged { .. })
        ));
        assert_eq!(plan_resume(50, 100, Some(&meta_for(url, 100, Some("\"a\""))), url), Ok(50));
    }

    /// The specific case the brief names: a 206 whose `Content-Range` start
    /// disagrees with the offset we are about to append at. Appending it
    /// would splice a hole into the file that only the terminal sha256 could
    /// catch, after a full transfer had been paid for.
    #[test]
    fn validate_resume_response_rejects_a_206_whose_range_start_disagrees() {
        let m = meta_for("u", 1000, Some("\"v1\""));
        let err = validate_resume_response(206, Some("bytes 400-999/1000"), Some("\"v1\""), &m, 500, 1000)
            .expect_err("a 206 starting at 400 must not be appended at 500");
        assert!(err.contains("resume from byte 500"), "must name our offset: {err}");
        assert!(err.contains("starting at 400"), "must name the server's offset: {err}");

        assert!(validate_resume_response(206, Some("bytes 500-999/1000"), Some("\"v1\""), &m, 500, 1000).is_ok());
    }

    #[test]
    fn validate_resume_response_rejects_a_changed_validator_and_a_wrong_total() {
        let m = meta_for("u", 1000, Some("\"v1\""));
        let changed = validate_resume_response(206, Some("bytes 500-999/1000"), Some("\"v2\""), &m, 500, 1000)
            .expect_err("a changed validator must not be appended to");
        assert!(changed.contains("changed since"), "got: {changed}");

        let wrong_total = validate_resume_response(206, Some("bytes 500-899/900"), Some("\"v1\""), &m, 500, 1000)
            .expect_err("a total that disagrees with the manifest must be refused");
        assert!(wrong_total.contains("900") && wrong_total.contains("1000"), "got: {wrong_total}");

        // No stored validator, or none offered now, is not a mismatch — many
        // origins send neither, and refusing those would disable resume.
        let no_stored = meta_for("u", 1000, None);
        assert!(validate_resume_response(206, Some("bytes 500-999/1000"), Some("\"v9\""), &no_stored, 500, 1000).is_ok());
        assert!(validate_resume_response(206, Some("bytes 500-999/1000"), None, &m, 500, 1000).is_ok());
    }

    #[test]
    fn validate_resume_response_refuses_a_200_answer_to_a_range_request() {
        let m = meta_for("u", 1000, None);
        let err = validate_resume_response(200, None, None, &m, 500, 1000)
            .expect_err("a 200 must never be appended onto a partial");
        assert!(err.contains("not 206"), "got: {err}");
    }

    #[test]
    fn classify_status_retries_only_what_can_improve_and_restarts_only_a_resume_416() {
        assert_eq!(classify_status(416, true), Disposition::RestartFromZero);
        // A 416 on a request that carried no Range is not a resume problem —
        // restarting from zero is exactly what we already did.
        assert_eq!(classify_status(416, false), Disposition::Permanent);
        assert_eq!(classify_status(404, true), Disposition::Permanent);
        assert_eq!(classify_status(403, true), Disposition::Permanent);
        assert_eq!(classify_status(401, false), Disposition::Permanent);
        assert_eq!(classify_status(408, false), Disposition::Transient);
        assert_eq!(classify_status(429, false), Disposition::Transient);
        assert_eq!(classify_status(500, false), Disposition::Transient);
        assert_eq!(classify_status(503, true), Disposition::Transient);
    }

    #[test]
    fn backoff_is_exponential_and_the_first_attempt_never_waits() {
        assert_eq!(backoff_before_attempt(1), Duration::from_secs(0));
        assert_eq!(backoff_before_attempt(2), Duration::from_secs(1));
        assert_eq!(backoff_before_attempt(3), Duration::from_secs(2));
        assert_eq!(MAX_STREAM_ATTEMPTS, 3);
    }

    #[test]
    fn validator_prefers_the_lfs_object_hash_over_the_cdn_cache_tag() {
        let headers = |n: &str| match n {
            "x-linked-etag" => Some("\"sha-of-the-object\"".to_string()),
            "etag" => Some("\"cdn-cache-entry\"".to_string()),
            _ => None,
        };
        assert_eq!(
            validator_from_headers(headers),
            (Some("\"sha-of-the-object\"".to_string()), Some("x-linked-etag".to_string()))
        );
        let only_lm = |n: &str| (n == "last-modified").then(|| "Wed, 03 Sep 2026 00:00:00 GMT".to_string());
        assert_eq!(validator_from_headers(only_lm).1, Some("last-modified".to_string()));
        assert_eq!(validator_from_headers(|_| None), (None, None));
        // An empty header is not a validator.
        assert_eq!(validator_from_headers(|n| (n == "etag").then(|| "  ".to_string())), (None, None));
    }

    /// The message forms are the user-visible contract this round exists to
    /// fix, so they are pinned rather than left to drift.
    #[test]
    fn message_forms_state_path_bytes_and_never_promise_an_impossible_resume() {
        let p = Path::new("/tmp/x/model.onnx.part");

        let kept = exhausted_message("connection reset by peer", 3, p, 1_071_567_076, 1_262_619_311);
        assert!(kept.contains("after 3 attempts"), "{kept}");
        assert!(kept.contains("connection reset by peer"), "{kept}");
        assert!(kept.contains("1071567076/1262619311"), "{kept}");
        assert!(kept.contains("/tmp/x/model.onnx.part"), "{kept}");
        assert!(kept.contains("resumes from there"), "{kept}");

        // Nothing kept => no resume promise.
        let nothing = exhausted_message("connection reset", 3, p, 0, 1_262_619_311);
        assert!(!nothing.contains("resumes from there"), "must not promise resume: {nothing}");
        assert!(nothing.contains("starts from the beginning"), "{nothing}");

        let perm = permanent_message("the server answered HTTP 404", p, true);
        assert!(perm.contains("was discarded"), "{perm}");
        assert!(!perm.contains("resumes from there"), "must not promise resume: {perm}");
    }

    #[test]
    fn cause_chain_walks_sources_instead_of_printing_only_the_top_kind() {
        #[derive(Debug)]
        struct Inner;
        impl std::fmt::Display for Inner {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "connection closed before message completed")
            }
        }
        impl std::error::Error for Inner {}

        #[derive(Debug)]
        struct Outer(Inner);
        impl std::fmt::Display for Outer {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "error decoding response body")
            }
        }
        impl std::error::Error for Outer {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                Some(&self.0)
            }
        }

        let chain = cause_chain(&Outer(Inner));
        assert!(chain.contains("error decoding response body"), "{chain}");
        assert!(
            chain.contains("connection closed before message completed"),
            "the real cause must survive, not just reqwest's opaque kind: {chain}"
        );
    }

    #[test]
    fn status_for_target_reports_only_bytes_a_resume_would_actually_accept() {
        let dir = temp_dir_named("status-target");
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);
        let meta = part_meta_path_for(&part);

        // No partial at all.
        assert_eq!(status_for_target(&target, 1000).partial_bytes, 0);

        // A partial with NO sidecar is not resumable and must not be
        // advertised as if it were.
        fs::write(&part, vec![0u8; 400]).unwrap();
        let s = status_for_target(&target, 1000);
        assert!(!s.present);
        assert_eq!(s.partial_bytes, 0, "a sidecar-less partial is not a resume point");

        // With a sidecar agreeing on size, it is.
        write_part_meta(&meta, &meta_for("https://example.invalid/m", 1000, Some("\"v\"")));
        assert_eq!(status_for_target(&target, 1000).partial_bytes, 400);

        // A sidecar recording a different expected size invalidates it —
        // including when its URL also differs, which must not be allowed to
        // short-circuit the size check.
        write_part_meta(&meta, &meta_for("https://example.invalid/m", 999, Some("\"v\"")));
        assert_eq!(status_for_target(&target, 1000).partial_bytes, 0);
        write_part_meta(&meta, &meta_for("https://somewhere.else.invalid/x", 999, None));
        assert_eq!(status_for_target(&target, 1000).partial_bytes, 0);

        // A partial at or past the expected size is not a resume point.
        write_part_meta(&meta, &meta_for("https://example.invalid/m", 1000, None));
        fs::write(&part, vec![0u8; 1000]).unwrap();
        assert_eq!(status_for_target(&target, 1000).partial_bytes, 0);
        fs::write(&part, vec![0u8; 400]).unwrap();

        // A file at the target path whose SIZE IS WRONG is not an installed
        // model. It must not suppress the row's Download button — a row that
        // offers nothing has no way to repair itself — so the partial beside
        // it is still reported.
        //
        // The previous version of this assertion expected `present == true`
        // and `partial_bytes == 1000` for this same 10-byte file. That was
        // this defect written down as a fixture: it locked in both halves of
        // the bug (a wrong-size file counted as installed, and a size that is
        // not a partial's size reported as resumable bytes) and would have
        // stayed green through it forever.
        fs::write(&target, vec![1u8; 10]).unwrap();
        let s = status_for_target(&target, 1000);
        assert!(!s.present, "a 10-byte file is not a 1000-byte model");
        assert_eq!(s.partial_bytes, 400, "the real partial is still the resume point");

        let _ = fs::remove_dir_all(&dir);
    }

    /// WS2 T4.5, the operator's report: every installed row rendered
    /// "RESUME <full size>". Both numbers they saw — 1.51 GiB and 1.18 GiB —
    /// are `formatBytes(expected_size)` exactly, which is what identified
    /// this function's `present` branch as their single source.
    #[test]
    fn a_completed_model_reports_installed_with_zero_resumable_bytes() {
        let dir = temp_dir_named("t45-completed-model");
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);
        let meta = part_meta_path_for(&part);

        fs::write(&target, vec![1u8; 1000]).unwrap();
        let s = status_for_target(&target, 1000);
        assert!(s.present, "a full-size model on disk is present");
        assert_eq!(
            s.partial_bytes, 0,
            "a completed target's own byte count is not a resume point — \
             stream_download_verified returns Done the moment the target exists"
        );
        assert_eq!(s.total_bytes, 1000);

        // A leftover partial beside a completed model changes nothing: the
        // download would never run, so nothing is resumable.
        fs::write(&part, vec![0u8; 400]).unwrap();
        write_part_meta(&meta, &meta_for("https://example.invalid/m", 1000, Some("\"v\"")));
        let s = status_for_target(&target, 1000);
        assert!(s.present);
        assert_eq!(s.partial_bytes, 0, "a stray partial beside an installed model is not offered");

        let _ = fs::remove_dir_all(&dir);
    }

    /// The whisper row and the FA rows go through this one function, so the
    /// operator's two numbers are pinned against the two real constants
    /// rather than against a convenient small one.
    #[test]
    fn neither_real_model_size_is_ever_reported_as_resumable_bytes() {
        let dir = temp_dir_named("t45-real-sizes");
        const FR_MANIFEST_BYTES: u64 = 1_262_619_311;

        for (name, size) in [
            (MODEL_FILENAME, MODEL_SIZE_BYTES),
            ("model.onnx", FR_MANIFEST_BYTES),
        ] {
            let target = dir.join(name);
            // A sparse file of the real size, so this costs no disk: the
            // function only ever stats.
            let f = std::fs::File::create(&target).unwrap();
            f.set_len(size).unwrap();
            drop(f);

            let s = status_for_target(&target, size);
            assert!(s.present, "{name} at its exact size must read as present");
            assert_eq!(
                s.partial_bytes, 0,
                "{name} reported {} resumable bytes — this is the RESUME 1.51/1.18 GiB defect",
                s.partial_bytes
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    // -- WS2 T4.3 end-to-end seam: a hand-rolled origin ------------------
    //
    // A real `TcpListener` writing raw HTTP/1.1, so a body can be truncated
    // mid-transfer the way the operator's HTTP/2 stream was. No new
    // dev-dependency: `std::net` plus `std::thread` is the whole harness, and
    // reqwest speaks HTTP/1.1 to a plaintext origin by default.
    //
    // These tests exercise `stream_download_verified` itself — the same
    // function `whisper_model_download` and `models::fa_model_download` call,
    // which is how the Whisper path is covered without a 1.51 GiB download.
    mod fake_origin {
        use std::io::{Read, Write};
        use std::net::{Shutdown, TcpListener, TcpStream};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        /// What the origin does on the Nth connection. The last step repeats
        /// for every connection past the end of the plan.
        #[derive(Clone, Debug)]
        pub enum Step {
            /// Honour Range, then write only `n` body bytes and hang up —
            /// the truncation that reqwest reports as `Kind::Decode`.
            Truncate(u64),
            /// Honour Range and serve the whole remaining body.
            Full,
            /// Answer with a bare status line and no body.
            Status(u16),
            /// Answer a Range request with a 206 whose `Content-Range` starts
            /// `back` bytes earlier than asked.
            RangeShiftedBy(u64),
            /// Write headers and `n` body bytes, then hold the connection
            /// open forever without sending another byte and without closing
            /// it. This is what a Wi-Fi drop looks like from the client's
            /// side: not an error, not an EOF — silence. Distinguishing it
            /// from `Truncate` matters, because `Truncate` hangs up and so
            /// produces an error on its own; only this one requires a
            /// timeout to ever surface.
            Stall(u64),
        }

        pub fn body_byte(i: u64) -> u8 {
            (i % 251) as u8
        }

        pub fn body(total: u64) -> Vec<u8> {
            (0..total).map(body_byte).collect()
        }

        pub struct Origin {
            pub url: String,
            pub hits: Arc<AtomicUsize>,
            /// The `Range` start of every request received, in order —
            /// `None` for a request that carried no Range header.
            ///
            /// Asserting on hit COUNT alone cannot tell a resumed transfer
            /// from a fresh one (both are one connection), which is how the
            /// sidecar test below first passed with its own guard removed.
            /// Recording what was actually asked for is what makes that
            /// distinction observable.
            pub ranges: Arc<std::sync::Mutex<Vec<Option<u64>>>>,
        }

        fn requested_range_start(req: &str) -> Option<u64> {
            for line in req.lines() {
                let lower = line.to_ascii_lowercase();
                if let Some(rest) = lower.strip_prefix("range:") {
                    let rest = rest.trim().strip_prefix("bytes=")?;
                    let start = rest.split('-').next()?;
                    return start.trim().parse().ok();
                }
            }
            None
        }

        fn read_request(stream: &mut TcpStream) -> String {
            let mut buf = Vec::new();
            let mut byte = [0u8; 1];
            while stream.read(&mut byte).map(|n| n == 1).unwrap_or(false) {
                buf.push(byte[0]);
                if buf.len() >= 4 && &buf[buf.len() - 4..] == b"\r\n\r\n" {
                    break;
                }
            }
            String::from_utf8_lossy(&buf).to_string()
        }

        fn serve(
            mut stream: TcpStream,
            total: u64,
            etag: String,
            step: Step,
            seen: &std::sync::Mutex<Vec<Option<u64>>>,
        ) {
            let req = read_request(&mut stream);
            let range_start = requested_range_start(&req);
            seen.lock().unwrap().push(range_start);
            let full = body(total);

            let (status_line, start, truncate_after, extra) = match step {
                Step::Status(code) => {
                    let head = format!(
                        "HTTP/1.1 {code} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    );
                    let _ = stream.write_all(head.as_bytes());
                    let _ = stream.flush();
                    let _ = stream.shutdown(Shutdown::Both);
                    return;
                }
                Step::RangeShiftedBy(back) => {
                    let asked = range_start.unwrap_or(0);
                    let shifted = asked.saturating_sub(back);
                    (
                        "HTTP/1.1 206 Partial Content",
                        shifted,
                        None,
                        Some(format!("Content-Range: bytes {}-{}/{}\r\n", shifted, total - 1, total)),
                    )
                }
                Step::Stall(n) => {
                    let full_body = body(total);
                    let start = range_start.unwrap_or(0);
                    let slice = &full_body[start.min(total) as usize..];
                    let status_line = if range_start.is_some() {
                        format!(
                            "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {}-{}/{}\r\n",
                            start,
                            total - 1,
                            total
                        )
                    } else {
                        "HTTP/1.1 200 OK\r\n".to_string()
                    };
                    let head = format!(
                        "{status_line}Content-Length: {}\r\nAccept-Ranges: bytes\r\nETag: {etag}\r\nConnection: close\r\n\r\n",
                        slice.len()
                    );
                    let _ = stream.write_all(head.as_bytes());
                    let _ = stream.write_all(&slice[..(n as usize).min(slice.len())]);
                    let _ = stream.flush();
                    // Hold the socket open and silent, on a DETACHED thread —
                    // the accept loop must stay free to answer the retry, or
                    // the retry would be testing a refused connection rather
                    // than a second stall.
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(120));
                        drop(stream);
                    });
                    return;
                }
                Step::Truncate(n) => match range_start {
                    Some(s) => (
                        "HTTP/1.1 206 Partial Content",
                        s,
                        Some(n),
                        Some(format!("Content-Range: bytes {}-{}/{}\r\n", s, total - 1, total)),
                    ),
                    None => ("HTTP/1.1 200 OK", 0, Some(n), None),
                },
                Step::Full => match range_start {
                    Some(s) => (
                        "HTTP/1.1 206 Partial Content",
                        s,
                        None,
                        Some(format!("Content-Range: bytes {}-{}/{}\r\n", s, total - 1, total)),
                    ),
                    None => ("HTTP/1.1 200 OK", 0, None, None),
                },
            };

            let slice = &full[start.min(total) as usize..];
            let head = format!(
                "{status_line}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nETag: {etag}\r\n{}Connection: close\r\n\r\n",
                slice.len(),
                extra.unwrap_or_default()
            );
            let _ = stream.write_all(head.as_bytes());
            let to_write = match truncate_after {
                Some(n) => &slice[..(n as usize).min(slice.len())],
                None => slice,
            };
            let _ = stream.write_all(to_write);
            let _ = stream.flush();
            // Hanging up before Content-Length bytes have been sent is what
            // makes reqwest report an incomplete message.
            let _ = stream.shutdown(Shutdown::Both);
        }

        pub fn spawn(total: u64, etag: &'static str, plan: Vec<Step>) -> Origin {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
            let port = listener.local_addr().unwrap().port();
            let hits = Arc::new(AtomicUsize::new(0));
            let ranges: Arc<std::sync::Mutex<Vec<Option<u64>>>> =
                Arc::new(std::sync::Mutex::new(Vec::new()));
            let hits_thread = hits.clone();
            let ranges_thread = ranges.clone();
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(stream) = stream else { break };
                    let n = hits_thread.fetch_add(1, Ordering::SeqCst);
                    let step = plan.get(n).or_else(|| plan.last()).cloned().unwrap_or(Step::Full);
                    serve(stream, total, etag.to_string(), step, &ranges_thread);
                }
            });
            Origin { url: format!("http://127.0.0.1:{port}/model.onnx"), hits, ranges }
        }
    }

    use fake_origin::Step;

    /// Records every event the engine emits so progress monotonicity and the
    /// `Retrying` surface can be asserted rather than assumed.
    fn recording_channel() -> (Channel<ModelDownloadEvent>, Arc<Mutex<Vec<serde_json::Value>>>) {
        let log: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = log.clone();
        let ch = Channel::new(move |body: tauri::ipc::InvokeResponseBody| {
            let raw = match &body {
                tauri::ipc::InvokeResponseBody::Json(s) => s.clone(),
                tauri::ipc::InvokeResponseBody::Raw(b) => String::from_utf8_lossy(b).to_string(),
            };
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                sink.lock().unwrap().push(v);
            }
            Ok(())
        });
        (ch, log)
    }

    fn progress_series(log: &Arc<Mutex<Vec<serde_json::Value>>>) -> Vec<u64> {
        log.lock()
            .unwrap()
            .iter()
            .filter(|v| v["event"] == "Progress")
            .filter_map(|v| v["data"]["downloadedBytes"].as_u64())
            .collect()
    }

    fn retry_events(log: &Arc<Mutex<Vec<serde_json::Value>>>) -> Vec<serde_json::Value> {
        log.lock().unwrap().iter().filter(|v| v["event"] == "Retrying").cloned().collect()
    }

    const TOTAL: u64 = 200_000;

    fn run_engine(
        url: String,
        dir: &Path,
        verify_ok: bool,
    ) -> (Result<(), String>, PathBuf, PathBuf, PathBuf, Arc<Mutex<Vec<serde_json::Value>>>) {
        run_engine_for(url, dir, "model.onnx", verify_ok)
    }

    /// Same engine call, with the TARGET FILENAME as a parameter — so the FA
    /// filename (`model.onnx`) and the whisper filename
    /// (`ggml-large-v3-turbo.bin`) can be put through the identical matrix
    /// rather than one being assumed to behave like the other.
    fn run_engine_for(
        url: String,
        dir: &Path,
        filename: &str,
        verify_ok: bool,
    ) -> (Result<(), String>, PathBuf, PathBuf, PathBuf, Arc<Mutex<Vec<serde_json::Value>>>) {
        let target = dir.join(filename);
        let part = part_path_for(&target);
        let meta = part_meta_path_for(&part);
        let (ch, log) = recording_channel();
        let expected = fake_origin::body(TOTAL);
        let result = tauri::async_runtime::block_on(stream_download_verified(
            url,
            target.clone(),
            part.clone(),
            TOTAL,
            Arc::new(AtomicBool::new(false)),
            ch,
            move |p: &Path| {
                if !verify_ok {
                    return Err("expected sha256 mismatch for language \"fr\"".to_string());
                }
                let got = fs::read(p).map_err(|e| e.to_string())?;
                if got == expected {
                    Ok(hex_digest(&{
                        let mut h = Sha256::new();
                        h.update(&got);
                        h.finish()
                    }))
                } else {
                    Err(format!("bytes differ: got {} of {} bytes", got.len(), expected.len()))
                }
            },
        ));
        (result, target, part, meta, log)
    }

    /// Seeds a partial that IS a correct prefix, with a sidecar — the exact
    /// on-disk shape the operator's French pack was left in.
    fn seed_partial(part: &Path, meta: &Path, len: u64, url: &str, validator: Option<&str>) {
        fs::write(part, &fake_origin::body(TOTAL)[..len as usize]).unwrap();
        write_part_meta(
            meta,
            &PartMeta {
                url: url.to_string(),
                expected_size: TOTAL,
                validator: validator.map(|s| s.to_string()),
                validator_source: validator.map(|_| "etag".to_string()),
            },
        );
    }

    /// The operator's failure, end to end: the body is cut off mid-transfer,
    /// and the download now recovers by resuming instead of surfacing.
    #[test]
    fn transient_truncation_resumes_on_retry_and_completes() {
        let dir = temp_dir_named("t43-truncate-retry");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Truncate(50_000), Step::Full]);
        let (result, target, part, meta, log) = run_engine(origin.url.clone(), &dir, true);

        assert!(result.is_ok(), "a single truncation must be retried, got: {result:?}");
        assert_eq!(fs::read(&target).unwrap(), fake_origin::body(TOTAL), "bytes must be the whole object");
        assert!(!part.exists(), ".part must be gone after a successful finalize");
        assert!(!meta.exists(), ".part.meta must be gone with it");
        assert_eq!(origin.hits.load(std::sync::atomic::Ordering::SeqCst), 2, "exactly one retry");

        let retries = retry_events(&log);
        assert_eq!(retries.len(), 1, "the retry must be announced, not silent: {retries:?}");
        assert_eq!(retries[0]["data"]["attempt"], 2);
        assert_eq!(retries[0]["data"]["maxAttempts"], 3);
        assert_eq!(
            retries[0]["data"]["downloadedBytes"].as_u64(),
            Some(50_000),
            "the retry must report the offset it will resume from"
        );

        let series = progress_series(&log);
        assert!(
            series.windows(2).all(|w| w[1] >= w[0]),
            "progress must never move backwards across attempts: {series:?}"
        );
        assert_eq!(series.last().copied(), Some(TOTAL));

        let _ = fs::remove_dir_all(&dir);
    }

    /// WS2 T4.7 — cancel, then immediately start again for the SAME target,
    /// through the REAL engine (no manual guard manipulation). This exact
    /// sequence — cancel mid-transfer, click Resume right away — was never
    /// exercised end-to-end before; every prior cancel test only checked the
    /// UI's own bookkeeping against a mocked download. If cancellation left
    /// the `InFlightGuard` held (e.g. a code path that returns `Cancelled`
    /// without the guard's scope actually ending), the second call would be
    /// refused with the T4.4 single-flight message — the "duplicate download
    /// blocked" the operator asked about by name.
    #[test]
    fn cancel_then_immediate_resume_is_not_blocked_and_completes() {
        let dir = temp_dir_named("t47-cancel-then-resume");
        // First connection stalls after 60_000 bytes (giving the cancel
        // flag time to land mid-transfer); the second connection — made by
        // the resumed attempt below — serves the rest normally.
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Stall(60_000), Step::Full]);
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);
        let expected = fake_origin::body(TOTAL);

        let cancel_flag = Arc::new(AtomicBool::new(false));
        let cancel_flag_thread = cancel_flag.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            cancel_flag_thread.store(true, Ordering::SeqCst);
        });

        let verify_of = |expected: Vec<u8>| {
            move |p: &Path| {
                let got = fs::read(p).map_err(|e| e.to_string())?;
                if got == expected {
                    Ok(hex_digest(&{
                        let mut h = Sha256::new();
                        h.update(&got);
                        h.finish()
                    }))
                } else {
                    Err(format!("bytes differ: got {} of {}", got.len(), expected.len()))
                }
            }
        };

        let (ch1, log1) = recording_channel();
        let result1 = tauri::async_runtime::block_on(stream_download_verified(
            origin.url.clone(),
            target.clone(),
            part.clone(),
            TOTAL,
            cancel_flag,
            ch1,
            verify_of(expected.clone()),
        ));
        assert!(result1.is_err(), "a cancelled download must not resolve Ok");
        assert!(
            log1.lock().unwrap().iter().any(|v| v["event"] == "Cancelled"),
            "the UI must see an explicit Cancelled event, not silence"
        );
        let bytes_at_cancel = fs::metadata(&part).unwrap().len();
        assert!(
            bytes_at_cancel > 0 && bytes_at_cancel < TOTAL,
            "the test setup must land the cancel mid-transfer, got {bytes_at_cancel}"
        );

        // Immediately — no delay, nothing manually released — start again
        // for the exact same target. This is the operator's "Resume" click.
        let (ch2, log2) = recording_channel();
        let result2 = tauri::async_runtime::block_on(stream_download_verified(
            origin.url.clone(),
            target.clone(),
            part.clone(),
            TOTAL,
            Arc::new(AtomicBool::new(false)),
            ch2,
            verify_of(expected.clone()),
        ));

        assert!(result2.is_ok(), "resume immediately after cancel must not be refused: {result2:?}");
        let errors2: Vec<_> = log2.lock().unwrap().iter().filter(|v| v["event"] == "Error").cloned().collect();
        assert!(errors2.is_empty(), "must not show the single-flight \"already running\" refusal: {errors2:?}");
        assert_eq!(fs::read(&target).unwrap(), expected, "the completed file must be byte-correct");

        let first_progress = progress_series(&log2).first().copied().unwrap_or(0);
        assert!(
            first_progress >= bytes_at_cancel,
            "resume must continue from where cancel left off ({bytes_at_cancel}), \
             not restart from zero (first progress reported was {first_progress})"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// Retries are bounded, each one resumes rather than restarting (so the
    /// `.part` grows across attempts), and the final message states the kept
    /// byte count against the total.
    #[test]
    fn retries_are_bounded_and_each_attempt_resumes_rather_than_restarting() {
        let dir = temp_dir_named("t43-bounded");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Truncate(10_000)]);
        let (result, target, part, meta, log) = run_engine(origin.url.clone(), &dir, true);

        let err = result.expect_err("three truncations in a row must surface");
        assert!(err.contains("after 3 attempts"), "{err}");
        assert!(err.contains(&part.display().to_string()), "must name the partial: {err}");
        assert!(err.contains("30000/200000"), "must state kept bytes against the total: {err}");
        assert!(err.contains("resumes from there"), "the kept partial IS resumable, so say so: {err}");

        assert!(!target.exists(), "nothing may be promoted");
        assert_eq!(
            fs::metadata(&part).unwrap().len(),
            30_000,
            "each attempt must APPEND from the partial's new length, not restart"
        );
        assert!(meta.exists(), "the sidecar must survive so the next call can resume");
        assert_eq!(origin.hits.load(std::sync::atomic::Ordering::SeqCst), 3);
        assert_eq!(retry_events(&log).len(), 2, "two retries between three attempts");

        let series = progress_series(&log);
        assert!(series.windows(2).all(|w| w[1] >= w[0]), "monotonic: {series:?}");

        let _ = fs::remove_dir_all(&dir);
    }

    /// The validator gate: the object changed underneath a partial, so the
    /// partial is discarded and the transfer restarts from zero rather than
    /// splicing two different files together.
    #[test]
    fn a_changed_validator_discards_the_partial_and_restarts_from_zero() {
        let dir = temp_dir_named("t43-validator");
        let origin = fake_origin::spawn(TOTAL, "\"v2-the-file-changed\"", vec![Step::Full]);
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);
        let meta = part_meta_path_for(&part);
        seed_partial(&part, &meta, 50_000, &origin.url, Some("\"v1-what-we-started-with\""));

        let (result, target, part, meta, log) = run_engine(origin.url.clone(), &dir, true);

        assert!(result.is_ok(), "a restart from zero must still complete: {result:?}");
        assert_eq!(fs::read(&target).unwrap(), fake_origin::body(TOTAL));
        assert!(!part.exists() && !meta.exists());
        assert_eq!(
            origin.hits.load(std::sync::atomic::Ordering::SeqCst),
            2,
            "one rejected resume, then one clean transfer"
        );

        let retries = retry_events(&log);
        assert_eq!(retries.len(), 1);
        let reason = retries[0]["data"]["reason"].as_str().unwrap_or_default();
        assert!(reason.contains("changed since"), "the reason must name the validator change: {reason}");
        assert_eq!(
            retries[0]["data"]["downloadedBytes"].as_u64(),
            Some(0),
            "a restart resumes from nothing, and says so"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// A 206 that starts somewhere other than where we are about to append is
    /// refused. Appending it would punch a hole only the terminal sha256
    /// could find, after a full transfer had already been paid for.
    #[test]
    fn a_206_whose_content_range_start_disagrees_is_refused_and_restarts() {
        let dir = temp_dir_named("t43-range-start");
        let origin =
            fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::RangeShiftedBy(1_000), Step::Full]);
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);
        let meta = part_meta_path_for(&part);
        seed_partial(&part, &meta, 50_000, &origin.url, Some("\"v1\""));

        let (result, target, part, meta, log) = run_engine(origin.url.clone(), &dir, true);

        assert!(result.is_ok(), "must recover by restarting: {result:?}");
        assert_eq!(fs::read(&target).unwrap(), fake_origin::body(TOTAL));
        assert!(!part.exists() && !meta.exists());

        let retries = retry_events(&log);
        assert_eq!(retries.len(), 1);
        let reason = retries[0]["data"]["reason"].as_str().unwrap_or_default();
        assert!(reason.contains("resume from byte 50000"), "{reason}");
        assert!(reason.contains("starting at 49000"), "{reason}");

        let _ = fs::remove_dir_all(&dir);
    }

    /// The 416 stick found in Step 1: the manifest, not the server, owns
    /// `expected_size`, so an unsatisfiable Range used to be re-sent forever
    /// with the partial retained. Now it discards once, restarts, and if that
    /// still 416s it is permanent and says why — never "kept for resume".
    #[test]
    fn a_416_discards_the_partial_once_then_reports_permanent_without_promising_resume() {
        let dir = temp_dir_named("t43-416");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Status(416)]);
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);
        let meta = part_meta_path_for(&part);
        seed_partial(&part, &meta, 50_000, &origin.url, Some("\"v1\""));

        let (result, target, part, meta, _log) = run_engine(origin.url.clone(), &dir, true);

        let err = result.expect_err("a repeated 416 must not loop forever");
        assert!(err.contains("permanently"), "{err}");
        assert!(err.contains("416"), "the status must reach the user: {err}");
        assert!(err.contains("was discarded"), "{err}");
        assert!(!err.contains("resumes from there"), "must not promise a resume that cannot work: {err}");
        assert!(!part.exists(), "the stuck partial must be gone, not retained forever");
        assert!(!meta.exists());
        assert!(!target.exists());
        assert_eq!(
            origin.hits.load(std::sync::atomic::Ordering::SeqCst),
            2,
            "one resume attempt, one from-zero attempt, then stop"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// Regression lock on behaviour that was already correct before this
    /// round and must stay correct: a transfer that completes but fails
    /// verification leaves NO partial behind, so the next attempt cannot
    /// reproduce the failure from retained bytes.
    #[test]
    fn a_completed_transfer_that_fails_verification_leaves_no_partial_behind() {
        let dir = temp_dir_named("t43-verify-fail");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Full]);
        let (result, target, part, meta, _log) = run_engine(origin.url.clone(), &dir, false);

        let err = result.expect_err("a verification mismatch must not promote");
        assert!(err.contains("expected sha256 mismatch"), "the specific reason must survive: {err}");
        assert!(err.contains("was deleted"), "{err}");
        assert!(err.contains("starts from zero"), "{err}");
        assert!(!err.contains("resumes from there"), "must not promise resume: {err}");
        assert!(!part.exists(), "rejected bytes must not be retained");
        assert!(!meta.exists(), "its sidecar must go with it");
        assert!(!target.exists(), "nothing may be promoted");
        assert_eq!(
            origin.hits.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "a verification mismatch must NOT be retried"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// A 4xx that is not 416 stops immediately — no backoff, no three
    /// attempts against a request that will never improve.
    #[test]
    fn a_404_is_permanent_and_is_not_retried() {
        let dir = temp_dir_named("t43-404");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Status(404)]);
        let (result, _target, _part, _meta, log) = run_engine(origin.url.clone(), &dir, true);

        let err = result.expect_err("a 404 must fail");
        assert!(err.contains("permanently") && err.contains("404"), "{err}");
        assert_eq!(origin.hits.load(std::sync::atomic::Ordering::SeqCst), 1, "no retries for a 404");
        assert!(retry_events(&log).is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    /// A sidecar-less partial is never appended to, even when its bytes
    /// happen to be a correct prefix — the engine cannot know that, and
    /// guessing is what splices two objects together.
    #[test]
    fn a_partial_without_a_sidecar_is_discarded_rather_than_resumed() {
        let dir = temp_dir_named("t43-no-sidecar");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Full]);
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);
        // Deliberately NOT a correct prefix. A partial of unknown provenance
        // is exactly what a sidecar-less `.part` is, and resuming onto it
        // produces a file that only the terminal sha256 can reject — after a
        // full transfer has been paid for.
        fs::write(&part, vec![0xABu8; 50_000]).unwrap();

        let (result, target, part, meta, _log) = run_engine(origin.url.clone(), &dir, true);

        assert!(result.is_ok(), "{result:?}");
        assert_eq!(fs::read(&target).unwrap(), fake_origin::body(TOTAL));
        assert!(!part.exists() && !meta.exists());
        // The load-bearing assertion: the request must carry NO Range header.
        // Hit COUNT cannot show this — a successful resume and a successful
        // fresh fetch are both one connection — and an earlier version of this
        // test asserted only the count and stayed GREEN with its own guard
        // removed. What was actually asked for is the observable thing.
        assert_eq!(
            *origin.ranges.lock().unwrap(),
            vec![None],
            "no Range request may be sent for a partial we cannot identify"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// A partial WITH a matching sidecar is resumed — the positive control
    /// for the three discard tests above, and the property the operator's
    /// French `.part` depends on.
    #[test]
    fn a_partial_with_a_matching_sidecar_is_resumed_not_refetched() {
        let dir = temp_dir_named("t43-resume-ok");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Full]);
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);
        let meta = part_meta_path_for(&part);
        seed_partial(&part, &meta, 150_000, &origin.url, Some("\"v1\""));

        let (result, target, _part, _meta, log) = run_engine(origin.url.clone(), &dir, true);

        assert!(result.is_ok(), "{result:?}");
        assert_eq!(fs::read(&target).unwrap(), fake_origin::body(TOTAL));
        assert_eq!(
            *origin.ranges.lock().unwrap(),
            vec![Some(150_000)],
            "a validated partial must be resumed with a Range at its own length"
        );
        assert!(retry_events(&log).is_empty(), "a clean resume needs no retry");
        let series = progress_series(&log);
        assert_eq!(
            series.first().copied(),
            Some(150_000),
            "the first progress event must report the resumed offset, not 0: {series:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    // -- STEP 3: the Whisper engine download is the SAME code path ---------
    //
    // `whisper_model_download` (this file) and `models::fa_model_download`
    // both call `stream_download_verified`, so the retry / conditional-resume
    // / 416 / message work above is structurally shared. "Structurally shared"
    // is an inference from the call graph, though, and this repo does not
    // accept a green run as evidence of reach (CLAUDE.md §4 Testing). So the
    // whisper side is EXERCISED: the same matrix, run against whisper's own
    // filename and its own `MODEL_FILENAME`-derived `.part`/`.part.meta`
    // paths, checking there is no `model.onnx`-shaped assumption anywhere in
    // the suffix or directory handling.
    //
    // What this does NOT cover, stated rather than implied: the real 1.51 GiB
    // transfer, `MODEL_URL`, and the pinned-sha256 verify closure. Those need
    // the live network (`tests/fa_download_live.rs`'s opt-in shape) and are
    // out of reach of a unit suite.

    #[test]
    fn the_whisper_filename_goes_through_the_identical_retry_and_resume_matrix() {
        // 1. Transient truncation resumes and completes.
        let dir = temp_dir_named("t43-whisper-retry");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Truncate(50_000), Step::Full]);
        let (result, target, part, meta, log) =
            run_engine_for(origin.url.clone(), &dir, MODEL_FILENAME, true);

        assert!(result.is_ok(), "whisper's filename must retry the same way: {result:?}");
        assert_eq!(fs::read(&target).unwrap(), fake_origin::body(TOTAL));
        assert_eq!(part.file_name().unwrap().to_str().unwrap(), "ggml-large-v3-turbo.bin.part");
        assert_eq!(meta.file_name().unwrap().to_str().unwrap(), "ggml-large-v3-turbo.bin.part.meta");
        assert!(!part.exists() && !meta.exists());
        assert_eq!(retry_events(&log).len(), 1);
        assert_eq!(*origin.ranges.lock().unwrap(), vec![None, Some(50_000)]);
        let _ = fs::remove_dir_all(&dir);

        // 2. A resume 416 discards once, then reports permanent.
        let dir = temp_dir_named("t43-whisper-416");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Status(416)]);
        let target = dir.join(MODEL_FILENAME);
        let part = part_path_for(&target);
        let meta = part_meta_path_for(&part);
        seed_partial(&part, &meta, 50_000, &origin.url, Some("\"v1\""));
        let (result, _t, part, meta, _log) =
            run_engine_for(origin.url.clone(), &dir, MODEL_FILENAME, true);
        let err = result.expect_err("a repeated 416 must be permanent for whisper too");
        assert!(err.contains("permanently") && err.contains("416"), "{err}");
        assert!(!err.contains("resumes from there"), "{err}");
        assert!(!part.exists() && !meta.exists());
        let _ = fs::remove_dir_all(&dir);

        // 3. A verification failure leaves nothing behind.
        let dir = temp_dir_named("t43-whisper-verify");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Full]);
        let (result, target, part, meta, _log) =
            run_engine_for(origin.url.clone(), &dir, MODEL_FILENAME, false);
        assert!(result.unwrap_err().contains("was deleted"));
        assert!(!part.exists() && !meta.exists() && !target.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// `whisper_model_status` and `models::fa_model_status` are the same
    /// function underneath (`status_for_target`), so whisper's own row gets
    /// the resume affordance without a second implementation to keep in step.
    /// Exercised against whisper's real filename for the same reason as above.
    #[test]
    fn whisper_status_reports_a_resumable_partial_through_the_shared_helper() {
        let dir = temp_dir_named("t43-whisper-status");
        let target = dir.join(MODEL_FILENAME);
        let part = part_path_for(&target);
        let meta = part_meta_path_for(&part);

        assert_eq!(status_for_target(&target, MODEL_SIZE_BYTES).partial_bytes, 0);

        fs::write(&part, vec![7u8; 4096]).unwrap();
        assert_eq!(
            status_for_target(&target, MODEL_SIZE_BYTES).partial_bytes,
            0,
            "a sidecar-less whisper partial is no more resumable than an FA one"
        );

        write_part_meta(
            &meta,
            &PartMeta {
                url: "https://huggingface.co/whatever".to_string(),
                expected_size: MODEL_SIZE_BYTES,
                validator: None,
                validator_source: None,
            },
        );
        let st = status_for_target(&target, MODEL_SIZE_BYTES);
        assert!(!st.present);
        assert_eq!(st.partial_bytes, 4096);
        assert_eq!(st.total_bytes, MODEL_SIZE_BYTES);

        let _ = fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------
    // WS2 T4.4 — single flight, honest progress, no silent stalls
    // -----------------------------------------------------------------

    /// Defect A's guarantee, stated as arithmetic. Every `Progress` event
    /// goes through this function, so if it cannot report more than is on
    /// disk, neither can the bar.
    #[test]
    fn progress_can_never_exceed_bytes_on_disk() {
        // The operator's exact numbers: the counter believed the transfer was
        // complete while the path held 81_926_489 bytes.
        assert_eq!(reportable_progress(1_262_619_311, 81_926_489), 81_926_489);
        // The ordinary case is unaffected — a healthy transfer's counter and
        // its file agree, and reporting the min changes nothing.
        assert_eq!(reportable_progress(500, 500), 500);
        // A file larger than the counter (the two-writer overshoot the log
        // recorded) still reports only what this task claims to have written.
        assert_eq!(reportable_progress(500, 1_754_528_449), 500);
        assert_eq!(reportable_progress(0, 0), 0);
    }

    /// The half of the same guarantee that reads the filesystem.
    #[test]
    fn bytes_on_disk_reads_the_path_and_treats_a_missing_file_as_zero() {
        let dir = temp_dir_named("t44-bytes-on-disk");
        let part = dir.join("model.onnx.part");
        assert_eq!(bytes_on_disk(&part), 0, "a missing .part is zero, never an error");
        fs::write(&part, vec![0u8; 1234]).unwrap();
        assert_eq!(bytes_on_disk(&part), 1234);
        // Unlinked out from under a holder: the path is what is measured.
        fs::remove_file(&part).unwrap();
        assert_eq!(bytes_on_disk(&part), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A second download for a target already being written is refused at the
    /// Rust layer — not merely discouraged in the UI. This is the fix for the
    /// cause of Defect A.
    #[test]
    fn a_second_download_for_an_in_flight_target_is_refused() {
        let dir = temp_dir_named("t44-single-flight");
        let part = dir.join("model.onnx.part");

        let first = try_acquire_in_flight(&part, test_sink()).expect("the first claim must succeed");
        assert!(
            try_acquire_in_flight(&part, test_sink()).is_none(),
            "a second writer for the same .part must be refused while the first holds it"
        );
        drop(first);
        assert!(
            try_acquire_in_flight(&part, test_sink()).is_some(),
            "the claim must be released on drop, or a failed download makes the model permanently un-downloadable"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Refusal is per-target, so a whisper download and an FA download (or two
    /// different languages) still run concurrently — the property the old
    /// per-key cancel map was introduced to preserve.
    #[test]
    fn single_flight_is_per_target_not_global() {
        let dir = temp_dir_named("t44-single-flight-per-target");
        let fr = dir.join("fr.onnx.part");
        let de = dir.join("de.onnx.part");
        let _a = try_acquire_in_flight(&fr, test_sink()).expect("fr");
        let _b = try_acquire_in_flight(&de, test_sink()).expect("de must not be blocked by fr");
        assert!(try_acquire_in_flight(&fr, test_sink()).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    /// The guard must also release when the holder panics or returns early,
    /// which is why it is a `Drop` type rather than a matched pair of calls.
    #[test]
    fn an_in_flight_claim_is_released_even_if_the_holder_panics() {
        let dir = temp_dir_named("t44-single-flight-panic");
        let part = dir.join("model.onnx.part");
        let p = part.clone();
        let outcome = std::panic::catch_unwind(move || {
            let _guard = try_acquire_in_flight(&p, test_sink()).expect("claim");
            panic!("simulated download task panic");
        });
        assert!(outcome.is_err());
        assert!(
            try_acquire_in_flight(&part, test_sink()).is_some(),
            "a panicking download must not leave the target claimed forever"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// End to end through the real engine: while one download holds a target,
    /// a second call for that same target returns without touching the file
    /// and says why.
    #[test]
    fn the_engine_refuses_a_concurrent_download_for_the_same_part_file() {
        let dir = temp_dir_named("t44-engine-single-flight");
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);
        fs::write(&part, vec![9u8; 777]).unwrap();

        let _held = try_acquire_in_flight(&part, test_sink()).expect("stand in for the running download");

        let (ch, log) = recording_channel();
        let result = tauri::async_runtime::block_on(stream_download_verified(
            "http://127.0.0.1:1/never-requested".to_string(),
            target.clone(),
            part.clone(),
            TOTAL,
            Arc::new(AtomicBool::new(false)),
            ch,
            |_p: &Path| panic!("verification must never run for a refused download"),
        ));

        let err = result.expect_err("a second download for an in-flight target must not start");
        assert!(err.contains("already running"), "{err}");
        assert_eq!(
            fs::metadata(&part).unwrap().len(),
            777,
            "the refused call must not have opened, truncated or written the .part"
        );
        let errors: Vec<_> =
            log.lock().unwrap().iter().filter(|v| v["event"] == "Error").cloned().collect();
        assert_eq!(errors.len(), 1, "the refusal must reach the channel too: {errors:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// A status poll is what the modal does on every open and every refresh,
    /// while a transfer is running. It must be pure observation.
    #[test]
    fn a_status_poll_during_an_active_download_leaves_the_part_size_unchanged() {
        let dir = temp_dir_named("t44-status-is-readonly");
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);
        let meta = part_meta_path_for(&part);
        seed_partial(&part, &meta, 120_000, "http://origin/model.onnx", Some("\"v1\""));

        let before = fs::metadata(&part).unwrap().len();
        let meta_before = fs::read(&meta).unwrap();

        for _ in 0..25 {
            let st = status_for_target(&target, TOTAL);
            assert!(!st.present);
            assert_eq!(st.partial_bytes, 120_000);
        }

        assert_eq!(
            fs::metadata(&part).unwrap().len(),
            before,
            "polling status must never truncate, extend or rewrite the .part the writer holds open"
        );
        assert_eq!(fs::read(&meta).unwrap(), meta_before, "nor its sidecar");
        assert!(
            try_acquire_in_flight(&part, test_sink()).is_some(),
            "and it must not take the in-flight claim either"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// The third issue: Wi-Fi drops mid-body. The socket is not closed and
    /// not readable, so without a per-read deadline `chunk()` awaits forever
    /// and the UI sees nothing at all. With one, the stall becomes a
    /// `Retrying` event the modal can render as "Reconnecting… (attempt 2 of
    /// 3)", and then an explicit `Error` when the attempts run out.
    #[test]
    fn a_stalled_connection_emits_reconnecting_then_an_explicit_error() {
        let dir = temp_dir_named("t44-stall");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Stall(40_000)]);
        let (result, _target, part, _meta, log) = run_engine(origin.url.clone(), &dir, true);

        let err = result.expect_err("a permanently silent socket must not resolve as success");

        let retries = retry_events(&log);
        assert_eq!(
            retries.len(),
            (MAX_STREAM_ATTEMPTS - 1) as usize,
            "every stalled attempt must announce a reconnect rather than freezing: {retries:?}"
        );
        assert_eq!(retries[0]["data"]["attempt"], 2);
        assert_eq!(retries[0]["data"]["maxAttempts"], MAX_STREAM_ATTEMPTS);

        let errors: Vec<_> =
            log.lock().unwrap().iter().filter(|v| v["event"] == "Error").cloned().collect();
        assert_eq!(errors.len(), 1, "the failure must be pushed to the UI, not only returned: {errors:?}");
        let message = errors[0]["data"]["message"].as_str().unwrap_or_default();
        assert_eq!(message, err, "the channel error and the returned error must be the same text");
        assert!(
            message.contains("resumes from there"),
            "a kept partial must be described as resumable so the row offers Resume: {message}"
        );
        assert!(part.exists(), "the partial must be kept — that is what makes Resume real");

        // And the progress the UI was given never outran the file.
        let on_disk = fs::metadata(&part).unwrap().len();
        for value in progress_series(&log) {
            assert!(value <= on_disk, "progress {value} exceeded the {on_disk} bytes on disk");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// The engine-level form of the same guarantee, reproducing Defect A's
    /// actual shape: the `.part` is unlinked out from under a running
    /// transfer (which is exactly what a second writer's `discard_partial`
    /// does), and the bar must stop claiming the bytes that went with it.
    ///
    /// This is the test that separates the two implementations. With progress
    /// taken from the in-memory counter, the next attempt's first `Progress`
    /// still reports the pre-unlink high-water mark — the lie the operator
    /// saw at full scale. With it taken from the file, it reports 0, because
    /// 0 is what is there.
    #[test]
    fn progress_stops_claiming_bytes_once_the_part_file_is_unlinked_underneath_it() {
        let dir = temp_dir_named("t44-unlinked-underneath");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Stall(40_000)]);
        let part = part_path_for(&dir.join("model.onnx"));

        let doomed = part.clone();
        std::thread::spawn(move || {
            // After the first attempt has written its 40_000 bytes and gone
            // silent, but well before its 2s read deadline.
            std::thread::sleep(Duration::from_millis(700));
            let _ = fs::remove_file(&doomed);
        });

        let (result, _target, _part, _meta, log) = run_engine(origin.url.clone(), &dir, true);
        assert!(result.is_err(), "a stalled transfer cannot succeed");

        let events = log.lock().unwrap().clone();
        let first_retry = events
            .iter()
            .position(|v| v["event"] == "Retrying")
            .expect("the stall must have produced a retry");
        let next_progress = events[first_retry..]
            .iter()
            .find(|v| v["event"] == "Progress")
            .and_then(|v| v["data"]["downloadedBytes"].as_u64())
            .expect("the next attempt must emit its starting progress");

        assert_eq!(
            next_progress, 0,
            "after the .part was unlinked the bar must report 0, not the bytes that went with it"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Progress is bounded by the file for a whole ordinary download, not
    /// just at the end — including across a truncation and its resume.
    #[test]
    fn every_progress_event_of_a_real_download_is_backed_by_bytes_on_disk() {
        let dir = temp_dir_named("t44-progress-backed");
        let origin = fake_origin::spawn(TOTAL, "\"v1\"", vec![Step::Truncate(50_000), Step::Full]);
        let (result, target, _part, _meta, log) = run_engine(origin.url.clone(), &dir, true);
        assert!(result.is_ok(), "{result:?}");

        let series = progress_series(&log);
        // The terminal event is emitted after the rename, when the bytes are
        // at `target` rather than at `.part`; every earlier one must have been
        // covered by the file at the time, and the final total is the real
        // file's real size.
        assert_eq!(series.last().copied(), Some(TOTAL));
        assert_eq!(fs::metadata(&target).unwrap().len(), TOTAL);
        assert!(
            series.iter().all(|&v| v <= TOTAL),
            "no event may claim more than the object's own size: {series:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------
    // WS2 T4.6 — a page reload must re-attach, not start a second download
    // -----------------------------------------------------------------

    /// The operator's sequence: start a download, reload the webview, press
    /// Resume. The Rust task survives the reload (their "already running"
    /// refusal is the proof it does), so what the fresh page needs is the
    /// running transfer's event stream — not a second transfer.
    #[test]
    fn a_reloaded_page_attaches_to_the_running_download_and_receives_its_events() {
        let dir = temp_dir_named("t46-attach");
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);

        // The first page's channel, and the transfer it started.
        let (first_page, first_log) = recording_channel();
        let sink = Arc::new(EventSink::new(first_page));
        let _guard = try_acquire_in_flight(&part, sink.clone()).expect("claim");

        sink.send(ModelDownloadEvent::Progress { downloaded_bytes: 10, total_bytes: 100 });
        assert_eq!(progress_series(&first_log), vec![10]);

        // The page reloads. A fresh page asks to attach.
        let (second_page, second_log) = recording_channel();
        assert!(attach_to_target(&target, second_page), "an in-flight target must be attachable");

        // The SAME transfer's later events land on the new page…
        sink.send(ModelDownloadEvent::Progress { downloaded_bytes: 60, total_bytes: 100 });
        sink.send(ModelDownloadEvent::Done);
        assert_eq!(progress_series(&second_log), vec![60]);
        assert!(second_log.lock().unwrap().iter().any(|v| v["event"] == "Done"));

        // …and NOT on the dead one. One transfer, one destination: a fan-out
        // would leave the engine deciding what a dead listener means.
        assert_eq!(progress_series(&first_log), vec![10], "the replaced channel must stop receiving");

        let _ = fs::remove_dir_all(&dir);
    }

    /// Attaching to a target with nothing running is a plain `false`, never an
    /// error. A transfer can finish between a status poll and the attach call,
    /// and that is a completed download — the caller must read status again,
    /// not show a failure.
    #[test]
    fn attaching_to_a_target_with_no_download_running_reports_false() {
        let dir = temp_dir_named("t46-attach-nothing");
        let target = dir.join("model.onnx");
        let (ch, log) = recording_channel();
        assert!(!attach_to_target(&target, ch));
        assert!(log.lock().unwrap().is_empty(), "a no-op attach must emit nothing");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Once the transfer ends, its claim and its sink go together — an attach
    /// after that must not hand back a sink nothing will ever send through,
    /// which would hang the caller's promise forever.
    #[test]
    fn a_finished_download_is_no_longer_attachable() {
        let dir = temp_dir_named("t46-attach-after-finish");
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);

        let guard = try_acquire_in_flight(&part, test_sink()).expect("claim");
        assert!(attach_to_target(&target, noop_channel()));
        drop(guard);
        assert!(!attach_to_target(&target, noop_channel()), "a dropped guard takes its sink with it");

        let _ = fs::remove_dir_all(&dir);
    }

    /// What a freshly loaded page reads to decide between "Resume" and "this
    /// is already running". The filesystem cannot tell those apart — a growing
    /// `.part` and an abandoned one are the same `stat` — so this flag is the
    /// only thing that can, and it is what stopped the operator's Resume
    /// button from appearing over a live transfer.
    #[test]
    fn status_reports_a_running_download_as_in_flight() {
        let dir = temp_dir_named("t46-status-in-flight");
        let target = dir.join("model.onnx");
        let part = part_path_for(&target);
        let meta = part_meta_path_for(&part);
        seed_partial(&part, &meta, 120_000, "http://origin/model.onnx", Some("\"v1\""));

        // Same bytes on disk, both times. Only the registry differs.
        let idle = status_for_target(&target, TOTAL);
        assert!(!idle.in_flight, "a partial nobody is writing is a resume point");
        assert_eq!(idle.partial_bytes, 120_000);

        let guard = try_acquire_in_flight(&part, test_sink()).expect("claim");
        let live = status_for_target(&target, TOTAL);
        assert!(live.in_flight, "an identical .part IS distinguishable — by the registry, not by stat");
        assert_eq!(live.partial_bytes, 120_000, "the byte count is still true, it is just not an offer");

        drop(guard);
        assert!(!status_for_target(&target, TOTAL).in_flight);

        let _ = fs::remove_dir_all(&dir);
    }

    /// An installed model is never in flight — the engine returns `Done`
    /// before claiming anything, so the early-exit branch must not report a
    /// state it cannot be in.
    #[test]
    fn an_installed_model_is_never_reported_in_flight() {
        let dir = temp_dir_named("t46-installed-not-in-flight");
        let target = dir.join("model.onnx");
        fs::write(&target, vec![1u8; 1000]).unwrap();
        let s = status_for_target(&target, 1000);
        assert!(s.present);
        assert!(!s.in_flight);
        assert_eq!(s.partial_bytes, 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
