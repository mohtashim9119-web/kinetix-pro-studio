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
    if target.exists() {
        return ModelDownloadStatus {
            present: true,
            partial_bytes: expected_size,
            total_bytes: expected_size,
        };
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
    ModelDownloadStatus { present: false, partial_bytes, total_bytes: expected_size }
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
            Ok(())
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
pub(crate) async fn stream_download_verified(
    url: String,
    final_path: PathBuf,
    part_path: PathBuf,
    expected_size: u64,
    cancel_flag: Arc<AtomicBool>,
    on_event: Channel<ModelDownloadEvent>,
    verify: impl FnOnce(&Path) -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    if final_path.exists() {
        let _ = on_event.send(ModelDownloadEvent::Done);
        return Ok(());
    }

    let meta_path = part_meta_path_for(&part_path);
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; KinetixPro/1.0)")
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
            let _ = on_event.send(ModelDownloadEvent::Cancelled);
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
            &on_event,
            &mut high_water,
        )
        .await;

        match outcome {
            AttemptOutcome::Completed => break,
            AttemptOutcome::Cancelled => {
                let _ = on_event.send(ModelDownloadEvent::Cancelled);
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
                let _ = on_event.send(ModelDownloadEvent::Error { message: msg.clone() });
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
                    let _ = on_event.send(ModelDownloadEvent::Error { message: msg.clone() });
                    return Err(msg);
                }
                restarted_from_zero = true;
                force_from_zero = true;
                discard_partial(&part_path, &meta_path);
                high_water = 0;
                let _ = on_event.send(ModelDownloadEvent::Retrying {
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
                    let _ = on_event.send(ModelDownloadEvent::Error { message: msg.clone() });
                    return Err(msg);
                }
                let next = attempt + 1;
                let _ = on_event.send(ModelDownloadEvent::Retrying {
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

    finalize_verified_download(part_path, meta_path, final_path, expected_size, on_event, verify).await
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
    on_event: &Channel<ModelDownloadEvent>,
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
    let _ = on_event.send(ModelDownloadEvent::Progress {
        downloaded_bytes: *high_water,
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
                    let _ = on_event.send(ModelDownloadEvent::Progress {
                        downloaded_bytes: *high_water,
                        total_bytes: expected_size,
                    });
                    last_emit = std::time::Instant::now();
                }
            }
            Ok(None) => return AttemptOutcome::Completed,
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
async fn finalize_verified_download(
    part_path: PathBuf,
    meta_path: PathBuf,
    final_path: PathBuf,
    expected_size: u64,
    on_event: Channel<ModelDownloadEvent>,
    verify: impl FnOnce(&Path) -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    let verify_path = part_path.clone();
    let verify_result =
        tauri::async_runtime::spawn_blocking(move || verify(&verify_path)).await.map_err(|e| e.to_string())?;

    if let Err(msg) = verify_result {
        // Retaining rejected bytes would guarantee the next attempt
        // reproduces the failure, so the partial goes — and the message says
        // so instead of promising a resume that cannot work.
        discard_partial(&part_path, &meta_path);
        let full_msg = format!(
            "{msg} — the partial download at {} was deleted; the next download starts from zero",
            part_path.display()
        );
        let _ = on_event.send(ModelDownloadEvent::Error { message: full_msg.clone() });
        return Err(full_msg);
    }

    fs::rename(&part_path, &final_path)
        .map_err(|e| format!("cannot finalize {}: {e}", final_path.display()))?;
    let _ = fs::remove_file(&meta_path);

    let _ =
        on_event.send(ModelDownloadEvent::Progress { downloaded_bytes: expected_size, total_bytes: expected_size });
    let _ = on_event.send(ModelDownloadEvent::Done);
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
            noop_channel(),
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
            noop_channel(),
            |_path| Ok(()),
        ));

        assert!(result.is_ok(), "verify success must finalize, got {result:?}");
        assert!(!part.exists(), ".part must be gone after a successful rename");
        assert!(!meta.exists(), ".part.meta must not outlive the transfer it describes");
        assert_eq!(fs::read(&final_path).unwrap(), b"good bytes");

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

        // An installed model reports present and ignores any stray partial.
        fs::write(&target, vec![1u8; 10]).unwrap();
        let s = status_for_target(&target, 1000);
        assert!(s.present);
        assert_eq!(s.partial_bytes, 1000);

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
                    Ok(())
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
}
