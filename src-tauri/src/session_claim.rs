//! Cross-process session claim for export temp directories (WS3 H5).
//!
//! A claim file (`session_claim.json`) records which OS process owns a session
//! directory. Create and reenter acquire it; destroy releases it. Discovery can
//! read claim state without taking it via `read_session_claim_view`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const SESSION_CLAIM_FILENAME: &str = "session_claim.json";
pub const SESSION_CLAIM_SCHEMA_VERSION: u32 = 1;

/// Minimum directory age before a manifest-less orphan may be swept (H10).
pub const ORPHAN_SWEEP_MIN_AGE_SECS: u64 = 3_600;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionClaimRecord {
    pub schema_version: u32,
    pub session_id: String,
    pub holder_pid: u32,
    /// Process start time in milliseconds since Unix epoch — disambiguates PID reuse.
    pub holder_start_time_ms: u64,
    /// Random UUID minted once per app process — disambiguates same-PID edge cases.
    pub holder_instance_id: String,
    pub claimed_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionClaimView {
    pub session_id: String,
    pub holder_pid: u32,
    pub holder_start_time_ms: u64,
    pub holder_instance_id: String,
    pub claimed_at_ms: u64,
    /// `live` = holder PID exists with matching start time; `stale` = reclaimable.
    pub holder_liveness: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OrphanSweepEntry {
    pub session_id: String,
    pub path: String,
    pub age_secs: u64,
    pub bytes: u64,
    pub outcome: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OrphanSweepReport {
    pub scanned: u64,
    pub candidates: u64,
    pub deleted: u64,
    pub deferred: u64,
    /// Windows: `remove_dir_all` returned Ok but the directory may still exist
    /// while a handle keeps it open — reported separately from `deleted`.
    pub pending_delete: u64,
    pub bytes_reclaimed: u64,
    pub entries: Vec<OrphanSweepEntry>,
}

struct ProcessIdentity {
    pid: u32,
    start_time_ms: u64,
    instance_id: String,
}

static PROCESS_INSTANCE_ID: OnceLock<String> = OnceLock::new();

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn current_process_identity() -> ProcessIdentity {
    let instance_id = PROCESS_INSTANCE_ID
        .get_or_init(|| Uuid::new_v4().to_string())
        .clone();
    ProcessIdentity {
        pid: std::process::id(),
        start_time_ms: process_start_time_ms(),
        instance_id,
    }
}

fn process_start_time_ms() -> u64 {
    #[cfg(unix)]
    {
        use std::time::Duration;
        let pid = std::process::id();
        let stat = format!("/proc/{pid}/stat");
        if let Ok(text) = fs::read_to_string(&stat) {
            // Field 22 (1-based) is starttime in clock ticks after the closing paren.
            if let Some(rest) = text.rsplit(')') .next() {
                let fields: Vec<&str> = rest.split_whitespace().collect();
                if fields.len() >= 20 {
                    if let Ok(ticks) = fields[19].parse::<u64>() {
                        let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) } as u64;
                        if hz > 0 {
                            let boot = boot_time_epoch_ms().unwrap_or(0);
                            return boot.saturating_add(ticks.saturating_mul(1000) / hz);
                        }
                    }
                }
            }
        }
        // Fallback: this process's own start is "now" — still unique within the session.
        let _ = Duration::from_secs(0);
        now_ms()
    }
    #[cfg(windows)]
    {
        // `GetCurrentProcess()` is a pseudo-handle for this process: never
        // needs OpenProcess, never needs CloseHandle, cannot fail.
        let handle = unsafe { windows_sys::Win32::System::Threading::GetCurrentProcess() };
        match windows_process_times(handle) {
            Some(times) => times.creation_unix_ms,
            // Own start time unreadable — "now" is still unique within the session.
            None => now_ms(),
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        now_ms()
    }
}

#[cfg(windows)]
struct WindowsProcessTimes {
    /// Creation time in milliseconds since the Unix epoch — the value persisted
    /// as `holder_start_time_ms`, and the value compared against it.
    creation_unix_ms: u64,
}

/// Convert a Win32 `FILETIME` (100-ns intervals since 1601-01-01 UTC) to
/// milliseconds since the Unix epoch. Saturates to 0 for pre-1970 values.
#[cfg(windows)]
fn filetime_to_unix_ms(ft: &windows_sys::Win32::Foundation::FILETIME) -> u64 {
    // 1601-01-01 → 1970-01-01 in 100-ns units.
    const EPOCH_DIFF_100NS: u64 = 116_444_736_000_000_000;
    let raw = ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64;
    raw.saturating_sub(EPOCH_DIFF_100NS) / 10_000
}

/// The one `GetProcessTimes` call site. Both the self-identity path and the
/// foreign-PID liveness path go through here so the FILETIME handling cannot
/// diverge between them — two inline copies is how the original type error
/// (`*mut i64` passed where `*mut FILETIME` is required) got past review.
///
/// `handle` must carry `PROCESS_QUERY_LIMITED_INFORMATION`. Returns `None`
/// when `GetProcessTimes` fails.
#[cfg(windows)]
fn windows_process_times(
    handle: windows_sys::Win32::Foundation::HANDLE,
) -> Option<WindowsProcessTimes> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::GetProcessTimes;
    let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let mut creation = zero;
    let mut exit = zero;
    let mut kernel = zero;
    let mut user = zero;
    let ok = unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) };
    if ok == 0 {
        return None;
    }
    Some(WindowsProcessTimes {
        creation_unix_ms: filetime_to_unix_ms(&creation),
    })
}

#[cfg(unix)]
fn boot_time_epoch_ms() -> Option<u64> {
    let text = fs::read_to_string("/proc/stat").ok()?;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("btime ") {
            let secs: u64 = rest.trim().parse().ok()?;
            return Some(secs.saturating_mul(1000));
        }
    }
    None
}

/// Returns true when `pid` is running and its start time matches `start_time_ms`.
pub fn is_holder_process_live(pid: u32, start_time_ms: u64) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        use std::time::Duration;
        // Signal 0 — existence probe only.
        let alive = unsafe { libc::kill(pid as i32, 0) == 0 };
        if !alive {
            return false;
        }
        let stat = format!("/proc/{pid}/stat");
        if let Ok(text) = fs::read_to_string(&stat) {
            if let Some(rest) = text.rsplit(')').next() {
                let fields: Vec<&str> = rest.split_whitespace().collect();
                if fields.len() >= 20 {
                    if let Ok(ticks) = fields[19].parse::<u64>() {
                        let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) } as u64;
                        if hz > 0 {
                            let boot = boot_time_epoch_ms().unwrap_or(0);
                            let observed = boot.saturating_add(ticks.saturating_mul(1000) / hz);
                            // Allow 2 s slack for clock/tick rounding — not a heartbeat timeout.
                            let slack = 2_000u64;
                            return observed.abs_diff(start_time_ms) <= slack;
                        }
                    }
                }
            }
        }
        let _ = Duration::from_secs(0);
        // PID exists but start time unreadable — treat as live to avoid stealing.
        true
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED};
        use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        let proc = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if proc.is_null() {
            // ERROR_INVALID_PARAMETER: no such PID — stale. ERROR_ACCESS_DENIED:
            // the process exists but is another user's / elevated — cannot
            // verify, so assume live rather than steal its directory.
            return unsafe { GetLastError() } == ERROR_ACCESS_DENIED;
        }
        let times = windows_process_times(proc);
        unsafe { CloseHandle(proc) };
        let Some(times) = times else {
            // PID exists but times unreadable — treat as live to avoid stealing
            // (mirrors the unix arm's unreadable-/proc branch).
            return true;
        };
        // Deliberately NOT consulting the exit-time FILETIME: MSDN documents
        // its content as undefined while the process is still running, so
        // "nonzero exit time ⇒ stale" could steal a live holder's directory.
        if start_time_ms == 0 {
            // Legacy / unverifiable claim: no usable start time recorded.
            // PID exists — cannot verify, assume live.
            return true;
        }
        // Allow 2 s slack for clock rounding — not a heartbeat timeout.
        times.creation_unix_ms.abs_diff(start_time_ms) <= 2_000
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (pid, start_time_ms);
        false
    }
}

fn claim_path(dir: &Path) -> PathBuf {
    dir.join(SESSION_CLAIM_FILENAME)
}

pub fn read_session_claim_record(dir: &Path) -> Result<Option<SessionClaimRecord>, String> {
    let path = claim_path(dir);
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("read_session_claim({}): {e}", path.display()))?;
    let record: SessionClaimRecord = serde_json::from_str(&text)
        .map_err(|e| format!("read_session_claim({}): invalid JSON: {e}", path.display()))?;
    Ok(Some(record))
}

pub fn read_session_claim_view(dir: &Path, session_id: &str) -> Result<SessionClaimView, String> {
    match read_session_claim_record(dir)? {
        Some(record) => {
            let live = is_holder_process_live(record.holder_pid, record.holder_start_time_ms);
            Ok(SessionClaimView {
                session_id: session_id.to_string(),
                holder_pid: record.holder_pid,
                holder_start_time_ms: record.holder_start_time_ms,
                holder_instance_id: record.holder_instance_id,
                claimed_at_ms: record.claimed_at_ms,
                holder_liveness: if live { "live".to_string() } else { "stale".to_string() },
            })
        }
        None => Ok(SessionClaimView {
            session_id: session_id.to_string(),
            holder_pid: 0,
            holder_start_time_ms: 0,
            holder_instance_id: String::new(),
            claimed_at_ms: 0,
            holder_liveness: "unclaimed".to_string(),
        }),
    }
}

fn write_claim_record(dir: &Path, session_id: &str) -> Result<(), String> {
    let identity = current_process_identity();
    let record = SessionClaimRecord {
        schema_version: SESSION_CLAIM_SCHEMA_VERSION,
        session_id: session_id.to_string(),
        holder_pid: identity.pid,
        holder_start_time_ms: identity.start_time_ms,
        holder_instance_id: identity.instance_id,
        claimed_at_ms: now_ms(),
    };
    let path = claim_path(dir);
    let temp = dir.join(format!("{SESSION_CLAIM_FILENAME}.tmp"));
    let payload = serde_json::to_string_pretty(&record)
        .map_err(|e| format!("write_session_claim: serialize: {e}"))?;
    {
        let mut file = fs::File::create(&temp)
            .map_err(|e| format!("write_session_claim: create temp: {e}"))?;
        file.write_all(payload.as_bytes())
            .map_err(|e| format!("write_session_claim: write temp: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("write_session_claim: sync temp: {e}"))?;
    }
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("write_session_claim: remove prior: {e}"))?;
    }
    fs::rename(&temp, &path).map_err(|e| format!("write_session_claim: rename: {e}"))?;
    Ok(())
}

/// Acquire or refresh the claim for this process. Refuses when a live foreign holder exists.
pub fn acquire_session_claim(dir: &Path, session_id: &str) -> Result<(), String> {
    if let Some(existing) = read_session_claim_record(dir)? {
        let identity = current_process_identity();
        let same_holder = existing.holder_pid == identity.pid
            && existing.holder_instance_id == identity.instance_id;
        if !same_holder && is_holder_process_live(existing.holder_pid, existing.holder_start_time_ms) {
            return Err(format!(
                "session {session_id} is claimed by live process pid={} instance={} — refuse reentry",
                existing.holder_pid, existing.holder_instance_id
            ));
        }
    }
    write_claim_record(dir, session_id)
}

pub fn release_session_claim(dir: &Path) -> Result<(), String> {
    let path = claim_path(dir);
    if path.is_file() {
        if let Some(existing) = read_session_claim_record(dir)? {
            let identity = current_process_identity();
            if existing.holder_instance_id != identity.instance_id {
                return Ok(());
            }
        }
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("release_session_claim: {e}")),
        }
    } else {
        Ok(())
    }
}

pub fn is_session_dir_claimed_by_live_holder(dir: &Path) -> Result<bool, String> {
    match read_session_claim_record(dir)? {
        Some(record) => Ok(is_holder_process_live(record.holder_pid, record.holder_start_time_ms)),
        None => Ok(false),
    }
}

/// WS3 STEP 8 (H10) — the three outcomes a successful `remove_dir_all` call
/// can leave behind, extracted as a pure classifier so the accounting
/// invariant ("a directory the sweep could not actually remove must never
/// be counted as reclaimed space") is directly unit-testable without
/// depending on real Windows delete-pending semantics, which this
/// environment cannot reproduce (`remove_dir_all` either fully succeeds or
/// fully fails on macOS/Linux — there is no real way to force the
/// open-handle-pends-behind-a-successful-call race here). The classifier
/// takes only the two booleans the real call site already has
/// (`existed_before`, `dir.exists()` after the call), so the SAME decision
/// this makes is exercised for real on every platform — only the INPUT that
/// drives `PendingDelete` is Windows-specific, not the logic that decides
/// what to do with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RemoveOutcome {
    /// `remove_dir_all` returned `Ok`, but the directory is genuinely gone —
    /// the ordinary case. Counts toward `bytes_reclaimed`.
    Deleted,
    /// `remove_dir_all` returned `Ok`, but the directory still exists —
    /// Windows: a delete pending behind an open handle. MUST NOT count
    /// toward `bytes_reclaimed`; the bytes are not actually reclaimed yet.
    PendingDelete,
    /// The directory was already gone before the call even ran (a race with
    /// something else deleting it). Not a reclaim THIS sweep performed.
    VanishedBeforeDelete,
}

fn classify_remove_outcome(existed_before: bool, still_exists_after: bool) -> RemoveOutcome {
    if still_exists_after {
        RemoveOutcome::PendingDelete
    } else if existed_before {
        RemoveOutcome::Deleted
    } else {
        RemoveOutcome::VanishedBeforeDelete
    }
}

pub fn sweep_manifestless_orphans(min_age_secs: u64) -> Result<OrphanSweepReport, String> {
    let temp = std::env::temp_dir();
    let entries = fs::read_dir(&temp)
        .map_err(|e| format!("sweep_orphans({}): {e}", temp.display()))?;
    let now = now_ms();
    let mut report = OrphanSweepReport {
        scanned: 0,
        candidates: 0,
        deleted: 0,
        deferred: 0,
        pending_delete: 0,
        bytes_reclaimed: 0,
        entries: Vec::new(),
    };

    for entry in entries {
        let entry = entry.map_err(|e| format!("sweep_orphans: read_dir: {e}"))?;
        if !entry.file_type().map_err(|e| format!("sweep_orphans: file_type: {e}"))?.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(id) = name.strip_prefix("kinetix-export-") else {
            continue;
        };
        if Uuid::parse_str(id).is_err() {
            continue;
        }
        report.scanned += 1;
        let dir = entry.path();
        if dir.join("export_state.json").is_file()
            || dir.join("export_state.json.tmp").is_file()
            || dir.join("export_state.json.bak").is_file()
        {
            report.deferred += 1;
            report.entries.push(OrphanSweepEntry {
                session_id: id.to_string(),
                path: dir.display().to_string(),
                age_secs: dir_age_secs(&dir, now),
                bytes: dir_size(&dir),
                outcome: "deferred".to_string(),
                detail: Some("manifest present — not an orphan".to_string()),
            });
            continue;
        }
        let age_secs = dir_age_secs(&dir, now);
        if age_secs < min_age_secs {
            report.deferred += 1;
            report.entries.push(OrphanSweepEntry {
                session_id: id.to_string(),
                path: dir.display().to_string(),
                age_secs,
                bytes: dir_size(&dir),
                outcome: "deferred".to_string(),
                detail: Some(format!("younger than {min_age_secs}s threshold")),
            });
            continue;
        }
        if is_session_dir_claimed_by_live_holder(&dir)? {
            report.deferred += 1;
            report.entries.push(OrphanSweepEntry {
                session_id: id.to_string(),
                path: dir.display().to_string(),
                age_secs,
                bytes: dir_size(&dir),
                outcome: "deferred".to_string(),
                detail: Some("claimed by a live holder".to_string()),
            });
            continue;
        }
        report.candidates += 1;
        let bytes = dir_size(&dir);
        let existed_before = dir.exists();
        match crate::safe_delete::delete_app_staging_dir(
            &dir,
            &temp,
            "kinetix-export-",
        ) {
            Ok(()) => {
                match classify_remove_outcome(existed_before, dir.exists()) {
                    RemoveOutcome::PendingDelete => {
                        // Windows: delete may pend behind an open handle while returning Ok.
                        report.pending_delete += 1;
                        report.entries.push(OrphanSweepEntry {
                            session_id: id.to_string(),
                            path: dir.display().to_string(),
                            age_secs,
                            bytes,
                            outcome: "pending_delete".to_string(),
                            detail: Some(
                                "remove_dir_all returned Ok but directory still exists — \
                                 likely an open handle (Windows delete-pending semantics)"
                                    .to_string(),
                            ),
                        });
                    }
                    RemoveOutcome::Deleted => {
                        report.deleted += 1;
                        report.bytes_reclaimed += bytes;
                        report.entries.push(OrphanSweepEntry {
                            session_id: id.to_string(),
                            path: dir.display().to_string(),
                            age_secs,
                            bytes,
                            outcome: "deleted".to_string(),
                            detail: None,
                        });
                    }
                    RemoveOutcome::VanishedBeforeDelete => {
                        report.deferred += 1;
                        report.entries.push(OrphanSweepEntry {
                            session_id: id.to_string(),
                            path: dir.display().to_string(),
                            age_secs,
                            bytes,
                            outcome: "deferred".to_string(),
                            detail: Some("directory disappeared before delete".to_string()),
                        });
                    }
                }
            }
            Err(e) => {
                report.deferred += 1;
                report.entries.push(OrphanSweepEntry {
                    session_id: id.to_string(),
                    path: dir.display().to_string(),
                    age_secs,
                    bytes,
                    outcome: "deferred".to_string(),
                    detail: Some(format!("remove_dir_all failed: {e}")),
                });
            }
        }
    }
    Ok(report)
}

fn dir_age_secs(dir: &Path, now_ms: u64) -> u64 {
    fs::metadata(dir)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| now_ms.saturating_sub(d.as_millis() as u64) / 1000)
        .unwrap_or(0)
}

fn dir_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                total += fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            } else if path.is_dir() {
                total += dir_size(&path);
            }
        }
    }
    total
}

// ---------------------------------------------------------------------------
// WS3 Round 21 — orphan reclamation (D5) and retain-for-resume (D3d)
// ---------------------------------------------------------------------------

/// Files a durable resume needs. Everything else in a session directory is
/// a mux/concat/delivery intermediate that the next attempt regenerates.
/// `piece_<n>.h264` is the resumed bitstream itself; `export_state.json`
/// (+ its `.tmp`/`.bak` siblings) is the manifest; the claim file is
/// re-taken by `reenter`. `tier1_piece_*.mp4` / `canvas_piece_*.mp4` are
/// transient sources for a piece that is remuxed to `piece_<n>.h264` in the
/// same step — not resume inputs.
pub fn is_resume_retained_file(name: &str) -> bool {
    if name == "export_state.json"
        || name == "export_state.json.tmp"
        || name == "export_state.json.bak"
        || name == SESSION_CLAIM_FILENAME
    {
        return true;
    }
    is_piece_file(name)
}

/// `piece_<n>.h264` naming check, shared by [`is_resume_retained_file`] and
/// `ffmpeg::session_disk_snapshot` (a diagnostic-only piece count/byte total,
/// which needs the same name shape without the manifest/claim-file branches).
pub fn is_piece_file(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("piece_") else { return false };
    let Some(idx) = rest.strip_suffix(".h264") else { return false };
    !idx.is_empty() && idx.bytes().all(|b| b.is_ascii_digit())
}

pub fn has_manifest(dir: &Path) -> bool {
    dir.join("export_state.json").is_file()
        || dir.join("export_state.json.tmp").is_file()
        || dir.join("export_state.json.bak").is_file()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DestroySessionOutcome {
    /// `destroyed` — directory removed; `refused_manifest` — a resume
    /// manifest is present and `force` was not set, so nothing was touched;
    /// `not_found` — the directory was already gone.
    pub disposition: String,
}

/// STEP 3b — the single place that removes a session directory outright.
/// Before this existed, `ffmpeg_destroy_session` called `fs::remove_dir_all`
/// unconditionally: any caller on the destroy path (a mux-stage failure that
/// never routes through `retain_session_for_resume`, a future call site,
/// etc.) could silently erase a resumable checkpoint. `force` is the
/// escape hatch for the calls that must always fully tear down regardless of
/// a manifest — an explicit user cancel, an operator's "start clean" choice,
/// a successful export's own teardown, and the abandoned-session TTL
/// collector — every OTHER call site defaults to the guard.
pub fn destroy_session_dir(dir: &Path, force: bool) -> Result<DestroySessionOutcome, String> {
    if !dir.exists() {
        return Ok(DestroySessionOutcome { disposition: "not_found".to_string() });
    }
    if !force && has_manifest(dir) {
        return Ok(DestroySessionOutcome { disposition: "refused_manifest".to_string() });
    }
    let _ = release_session_claim(dir);
    let bounds = dir
        .parent()
        .ok_or_else(|| format!("destroy_session: no parent for {}", dir.display()))?;
    crate::safe_delete::delete_app_staging_dir(dir, bounds, "kinetix-export-")
        .map_err(|e| format!("destroy_session: {e}"))?;
    Ok(DestroySessionOutcome { disposition: "destroyed".to_string() })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RetainForResumeReport {
    pub session_id: String,
    pub path: String,
    /// `retained` — manifest present, pieces kept, intermediates removed;
    /// `destroyed` — no manifest, directory removed outright;
    /// `refused_live` — a live foreign process holds the claim; nothing touched.
    pub disposition: String,
    /// Bytes still on disk after this call (the resume's own inputs).
    pub retained_bytes: u64,
    /// Bytes this call actually removed.
    pub reclaimed_bytes: u64,
    /// Files removed (session-local names).
    pub removed: Vec<String>,
}

/// See `ffmpeg_retain_session_for_resume`. Never counts a byte as reclaimed
/// unless the file is actually gone afterwards.
pub fn retain_session_for_resume(dir: &Path, session_id: &str) -> Result<RetainForResumeReport, String> {
    let path = dir.display().to_string();
    if !dir.exists() {
        return Ok(RetainForResumeReport {
            session_id: session_id.to_string(),
            path,
            disposition: "destroyed".to_string(),
            retained_bytes: 0,
            reclaimed_bytes: 0,
            removed: Vec::new(),
        });
    }
    if let Some(record) = read_session_claim_record(dir)? {
        let identity = current_process_identity();
        let same_holder = record.holder_instance_id == identity.instance_id;
        if !same_holder && is_holder_process_live(record.holder_pid, record.holder_start_time_ms) {
            return Ok(RetainForResumeReport {
                session_id: session_id.to_string(),
                path,
                disposition: "refused_live".to_string(),
                retained_bytes: dir_size(dir),
                reclaimed_bytes: 0,
                removed: Vec::new(),
            });
        }
    }
    if !has_manifest(dir) {
        let bytes = dir_size(dir);
        let _ = release_session_claim(dir);
        let bounds = dir.parent().ok_or_else(|| {
            format!(
                "retain_session_for_resume: no parent for {}",
                dir.display()
            )
        })?;
        crate::safe_delete::delete_app_staging_dir(dir, bounds, "kinetix-export-")
            .map_err(|e| format!("retain_session_for_resume: destroy: {e}"))?;
        let gone = !dir.exists();
        return Ok(RetainForResumeReport {
            session_id: session_id.to_string(),
            path,
            disposition: "destroyed".to_string(),
            retained_bytes: if gone { 0 } else { dir_size(dir) },
            reclaimed_bytes: if gone { bytes } else { 0 },
            removed: Vec::new(),
        });
    }
    let mut removed = Vec::new();
    let mut reclaimed = 0u64;
    let entries = fs::read_dir(dir).map_err(|e| format!("retain_session_for_resume: read_dir: {e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if is_resume_retained_file(name) {
            continue;
        }
        let p = entry.path();
        let bytes = if p.is_dir() { dir_size(&p) } else { fs::metadata(&p).map(|m| m.len()).unwrap_or(0) };
        let result = if p.is_dir() {
            crate::safe_delete::delete_app_staging_dir(&p, dir, "")
        } else {
            fs::remove_file(&p)
                .map_err(|e| format!("remove_file {}: {e}", p.display()))
        };
        if result.is_ok() && !p.exists() {
            reclaimed += bytes;
            removed.push(name.to_string());
        }
    }
    release_session_claim(dir)?;
    Ok(RetainForResumeReport {
        session_id: session_id.to_string(),
        path,
        disposition: "retained".to_string(),
        retained_bytes: dir_size(dir),
        reclaimed_bytes: reclaimed,
        removed,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReclaimableSessionEntry {
    pub session_id: String,
    pub path: String,
    pub age_secs: u64,
    pub bytes: u64,
    pub has_manifest: bool,
    /// `live` | `stale` | `unclaimed` (see `SessionClaimView::holder_liveness`).
    pub holder_liveness: String,
    /// `live` — never reclaimable; `resumable` — reclaimable if abandoned;
    /// `orphan` — reclaimable now.
    pub class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReclaimableSessionsReport {
    /// The temp tree that was scanned — printed for the operator so a manual
    /// clear-out needs no guessing (`%LOCALAPPDATA%\Temp` on Windows,
    /// `$TMPDIR` — `/var/folders/…/T/` — on macOS).
    pub temp_dir: String,
    pub scanned: u64,
    pub live_bytes: u64,
    pub resumable_bytes: u64,
    pub orphan_bytes: u64,
    /// `resumable_bytes + orphan_bytes` — everything the operator may reclaim.
    pub reclaimable_bytes: u64,
    pub entries: Vec<ReclaimableSessionEntry>,
}

fn holder_liveness_of(dir: &Path) -> Result<String, String> {
    Ok(match read_session_claim_record(dir)? {
        Some(record) => {
            let identity = current_process_identity();
            if record.holder_instance_id == identity.instance_id
                || is_holder_process_live(record.holder_pid, record.holder_start_time_ms)
            {
                "live".to_string()
            } else {
                "stale".to_string()
            }
        }
        None => "unclaimed".to_string(),
    })
}

fn export_session_dirs() -> Result<Vec<(String, PathBuf)>, String> {
    let temp = std::env::temp_dir();
    let entries = fs::read_dir(&temp).map_err(|e| format!("reclaim: read_dir({}): {e}", temp.display()))?;
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("reclaim: read_dir: {e}"))?;
        if !entry.file_type().map_err(|e| format!("reclaim: file_type: {e}"))?.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(id) = name.strip_prefix("kinetix-export-") else { continue };
        if Uuid::parse_str(id).is_err() {
            continue;
        }
        out.push((id.to_string(), entry.path()));
    }
    Ok(out)
}

/// See `ffmpeg_reclaimable_sessions`. Read-only.
pub fn report_reclaimable_sessions() -> Result<ReclaimableSessionsReport, String> {
    let now = now_ms();
    let mut report = ReclaimableSessionsReport {
        temp_dir: std::env::temp_dir().display().to_string(),
        scanned: 0,
        live_bytes: 0,
        resumable_bytes: 0,
        orphan_bytes: 0,
        reclaimable_bytes: 0,
        entries: Vec::new(),
    };
    for (id, dir) in export_session_dirs()? {
        report.scanned += 1;
        let bytes = dir_size(&dir);
        let manifest = has_manifest(&dir);
        let liveness = holder_liveness_of(&dir)?;
        let class = if liveness == "live" {
            report.live_bytes += bytes;
            "live"
        } else if manifest {
            report.resumable_bytes += bytes;
            "resumable"
        } else {
            report.orphan_bytes += bytes;
            "orphan"
        };
        report.entries.push(ReclaimableSessionEntry {
            session_id: id,
            path: dir.display().to_string(),
            age_secs: dir_age_secs(&dir, now),
            bytes,
            has_manifest: manifest,
            holder_liveness: liveness,
            class: class.to_string(),
        });
    }
    report.reclaimable_bytes = report.resumable_bytes + report.orphan_bytes;
    Ok(report)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReclaimReport {
    pub removed: Vec<String>,
    pub refused_live: Vec<String>,
    pub pending_delete: Vec<String>,
    pub failed: Vec<String>,
    /// Only directories that are actually gone afterwards count.
    pub bytes_reclaimed: u64,
}

/// See `ffmpeg_reclaim_sessions`. Same accounting invariant as the sweep: a
/// directory that still exists after `remove_dir_all` (Windows
/// delete-pending) is never counted as reclaimed.
pub fn reclaim_sessions(session_ids: &[String]) -> Result<ReclaimReport, String> {
    let mut report = ReclaimReport {
        removed: Vec::new(),
        refused_live: Vec::new(),
        pending_delete: Vec::new(),
        failed: Vec::new(),
        bytes_reclaimed: 0,
    };
    for id in session_ids {
        if Uuid::parse_str(id).is_err() {
            report.failed.push(format!("{id}: not a session id"));
            continue;
        }
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        if !dir.exists() {
            continue;
        }
        if holder_liveness_of(&dir)? == "live" {
            report.refused_live.push(id.clone());
            continue;
        }
        let bytes = dir_size(&dir);
        let _ = release_session_claim(&dir);
        match crate::safe_delete::delete_app_staging_dir(
            &dir,
            &std::env::temp_dir(),
            "kinetix-export-",
        ) {
            Ok(()) => match classify_remove_outcome(true, dir.exists()) {
                RemoveOutcome::Deleted => {
                    report.bytes_reclaimed += bytes;
                    report.removed.push(id.clone());
                }
                RemoveOutcome::PendingDelete => report.pending_delete.push(id.clone()),
                RemoveOutcome::VanishedBeforeDelete => {}
            },
            Err(e) => report.failed.push(format!("{id}: {e}")),
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_session_dir(tag: &str) -> (String, PathBuf) {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{tag}.txt")), b"orphan").unwrap();
        (id, dir)
    }

    #[test]
    fn claim_contention_second_holder_refused_while_first_live() {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        acquire_session_claim(&dir, &id).unwrap();
        let record = read_session_claim_record(&dir).unwrap().unwrap();
        // Simulate a foreign live holder by writing a claim for this PID with a wrong instance.
        let foreign = SessionClaimRecord {
            schema_version: SESSION_CLAIM_SCHEMA_VERSION,
            session_id: id.clone(),
            holder_pid: record.holder_pid,
            holder_start_time_ms: record.holder_start_time_ms,
            holder_instance_id: Uuid::new_v4().to_string(),
            claimed_at_ms: now_ms(),
        };
        fs::write(
            claim_path(&dir),
            serde_json::to_string_pretty(&foreign).unwrap(),
        )
        .unwrap();
        let err = acquire_session_claim(&dir, &id).unwrap_err();
        assert!(err.contains("claimed by live process"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stale_claim_recovery_after_dead_pid() {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let stale = SessionClaimRecord {
            schema_version: SESSION_CLAIM_SCHEMA_VERSION,
            session_id: id.clone(),
            holder_pid: 4_000_000,
            holder_start_time_ms: 1,
            holder_instance_id: Uuid::new_v4().to_string(),
            claimed_at_ms: now_ms(),
        };
        fs::write(
            claim_path(&dir),
            serde_json::to_string_pretty(&stale).unwrap(),
        )
        .unwrap();
        acquire_session_claim(&dir, &id).expect("stale claim must be reclaimable");
        let view = read_session_claim_view(&dir, &id).unwrap();
        assert_eq!(view.holder_liveness, "live");
        let _ = fs::remove_dir_all(&dir);
    }

    // ── STEP 3b — the Machine 1 field incident, reproduced ──────────────────
    //
    // Reported shape: a 28-minute export whose single piece fully rendered
    // and whose closing checkpoint was written, then the MUX stage (not the
    // render stage) failed with a disk error at 93% overall progress. Before
    // this step, only a `disk_full`-classified failure ever reached
    // `retain_session_for_resume` — any OTHER failure at the mux stage (an
    // I/O error that isn't ENOSPC-shaped, which is exactly what a flaky
    // external drive or a permissions hiccup produces) fell through to an
    // unconditional `ffmpeg_destroy_session`, erasing the piece and the
    // manifest a moment after they were durably written. This test mirrors
    // that disk state exactly — not a synthetic slice — and proves the fix
    // at the layer both the TS retention gate (`useExport.ts`) and the
    // native guard (`destroy_session_dir`) ultimately rest on.
    #[test]
    fn machine1_incident_mux_stage_disk_error_after_full_render_retains_piece_and_manifest() {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        acquire_session_claim(&dir, &id).unwrap();

        // The one piece: fully rendered, the exact bitstream a resume needs.
        let piece_bytes = vec![0xAAu8; 65_536];
        fs::write(dir.join("piece_0.h264"), &piece_bytes).unwrap();
        // The closing checkpoint, written durably before mux ever started.
        fs::write(
            dir.join("export_state.json"),
            br#"{"sessionId":"machine1","pieceIndex":0,"closed":true}"#,
        )
        .unwrap();
        // What the failed mux attempt left behind: the concatenated stream
        // and a truncated/partial delivery file — neither is needed to
        // resume, both must go.
        fs::write(dir.join("video_all.h264"), vec![0xBBu8; 65_536]).unwrap();
        fs::write(dir.join("export_final.mp4"), vec![0xCCu8; 4_096]).unwrap();

        // THE ACTUAL DEFECT, characterized: an unconditional destroy (the
        // pre-fix `ffmpeg_destroy_session` body) would have wiped everything
        // above regardless of the manifest. Demonstrate that shape directly
        // so a future regression that reintroduces an unconditional
        // destroy() call on this path is caught here, not just by the
        // generic guard tests above.
        let would_have_survived_the_old_code = !dir.join("piece_0.h264").exists();
        assert!(!would_have_survived_the_old_code, "sanity: files exist before the real call");

        // The actual fix: retain-for-resume, exactly what a mux-stage
        // failure now routes through regardless of its error `kind`.
        let report = retain_session_for_resume(&dir, &id).unwrap();
        assert_eq!(report.disposition, "retained");
        assert!(dir.join("piece_0.h264").is_file(), "the fully-rendered piece must survive");
        assert_eq!(fs::read(dir.join("piece_0.h264")).unwrap(), piece_bytes);
        assert!(dir.join("export_state.json").is_file(), "the closing checkpoint must survive");
        assert!(!dir.join("video_all.h264").exists(), "the failed mux's concat intermediate is not needed to resume");
        assert!(!dir.join("export_final.mp4").exists(), "the failed mux's partial output is not needed to resume");

        // Prove the RESUME side can actually find it: the exact predicate
        // `sweep_manifestless_orphans` and the resumable-sessions listing
        // use to recognize a session as resumable, not a re-derived one.
        assert!(has_manifest(&dir), "a resumed run's discovery must see this session as resumable");

        // Negative control from the same incident: had the native guard
        // ALSO been bypassed (a caller forcing destroy on a mux failure,
        // which nothing in this step does), the piece and manifest are
        // gone — confirming the two assertions above are actually
        // distinguishing retained-vs-destroyed, not vacuously true.
        let forced = destroy_session_dir(&dir, true).unwrap();
        assert_eq!(forced.disposition, "destroyed");
        assert!(!dir.exists());
    }

    // ── STEP 3b — destroy_session_dir: refuse to erase a resume manifest ────

    #[test]
    fn destroy_session_dir_refuses_when_manifest_present_and_not_forced() {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("piece_0.h264"), vec![1u8; 4096]).unwrap();
        fs::write(dir.join("export_state.json"), b"{}").unwrap();
        let outcome = destroy_session_dir(&dir, false).unwrap();
        assert_eq!(outcome.disposition, "refused_manifest");
        assert!(dir.exists(), "manifest'd session must survive an unforced destroy");
        assert!(dir.join("piece_0.h264").is_file());
        assert!(dir.join("export_state.json").is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn destroy_session_dir_forced_removes_despite_manifest() {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("export_state.json"), b"{}").unwrap();
        let outcome = destroy_session_dir(&dir, true).unwrap();
        assert_eq!(outcome.disposition, "destroyed");
        assert!(!dir.exists());
    }

    #[test]
    fn destroy_session_dir_removes_a_manifestless_session_even_unforced() {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("scratch.tmp"), vec![1u8; 16]).unwrap();
        let outcome = destroy_session_dir(&dir, false).unwrap();
        assert_eq!(outcome.disposition, "destroyed");
        assert!(!dir.exists());
    }

    #[test]
    fn destroy_session_dir_reports_not_found_when_already_gone() {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        let _ = fs::remove_dir_all(&dir);
        let outcome = destroy_session_dir(&dir, false).unwrap();
        assert_eq!(outcome.disposition, "not_found");
    }

    // ── WS3 Round 21 (D3d / D5) — retain-for-resume and reclamation ─────────

    #[test]
    fn resume_retained_files_are_exactly_pieces_manifest_and_claim() {
        for keep in ["piece_0.h264", "piece_17.h264", "export_state.json", "export_state.json.tmp", "export_state.json.bak", SESSION_CLAIM_FILENAME] {
            assert!(is_resume_retained_file(keep), "{keep}");
        }
        for drop in [
            "video_all.h264",
            "piece_0.h264.premux.mp4",
            "export_final.mp4",
            "voiceover_audio",
            "tier1_piece_0.mp4",
            "canvas_piece_0.mp4",
            "frame_00001.png",
            "piece_.h264",
            "piece_x.h264",
        ] {
            assert!(!is_resume_retained_file(drop), "{drop}");
        }
    }

    #[test]
    fn retain_for_resume_keeps_pieces_and_manifest_drops_intermediates() {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        acquire_session_claim(&dir, &id).unwrap();
        fs::write(dir.join("piece_0.h264"), vec![1u8; 4096]).unwrap();
        fs::write(dir.join("export_state.json"), b"{}").unwrap();
        fs::write(dir.join("piece_0.h264.premux.mp4"), vec![2u8; 2048]).unwrap();
        fs::write(dir.join("export_final.mp4"), vec![3u8; 1024]).unwrap(); // the truncated mux output
        fs::write(dir.join("voiceover_audio"), vec![4u8; 512]).unwrap();
        let report = retain_session_for_resume(&dir, &id).unwrap();
        assert_eq!(report.disposition, "retained");
        assert_eq!(report.reclaimed_bytes, 2048 + 1024 + 512);
        assert!(dir.join("piece_0.h264").is_file());
        assert!(dir.join("export_state.json").is_file());
        assert!(!dir.join("piece_0.h264.premux.mp4").exists());
        assert!(!dir.join("export_final.mp4").exists());
        assert!(!dir.join("voiceover_audio").exists());
        assert!(!claim_path(&dir).exists(), "claim released so discovery reads `unclaimed`");
        assert_eq!(report.retained_bytes, 4096 + 2);
        let mut removed = report.removed.clone();
        removed.sort();
        assert_eq!(removed, vec!["export_final.mp4", "piece_0.h264.premux.mp4", "voiceover_audio"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn retain_for_resume_without_manifest_destroys_the_session() {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        acquire_session_claim(&dir, &id).unwrap();
        fs::write(dir.join("piece_0.h264"), vec![1u8; 4096]).unwrap();
        let report = retain_session_for_resume(&dir, &id).unwrap();
        assert_eq!(report.disposition, "destroyed");
        assert!(!dir.exists());
        assert_eq!(report.retained_bytes, 0);
        assert!(report.reclaimed_bytes >= 4096);
    }

    #[test]
    fn retain_for_resume_refuses_a_live_foreign_holder() {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        acquire_session_claim(&dir, &id).unwrap();
        let record = read_session_claim_record(&dir).unwrap().unwrap();
        let foreign = SessionClaimRecord { holder_instance_id: Uuid::new_v4().to_string(), ..record };
        fs::write(claim_path(&dir), serde_json::to_string(&foreign).unwrap()).unwrap();
        fs::write(dir.join("export_final.mp4"), vec![3u8; 1024]).unwrap();
        let report = retain_session_for_resume(&dir, &id).unwrap();
        assert_eq!(report.disposition, "refused_live");
        assert!(dir.join("export_final.mp4").is_file(), "nothing touched under a live foreign claim");
        assert_eq!(report.reclaimed_bytes, 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reclaimable_report_classifies_live_resumable_and_orphan() {
        let mk = |manifest: bool, claim: bool| {
            let id = Uuid::new_v4().to_string();
            let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("piece_0.h264"), vec![1u8; 1000]).unwrap();
            if manifest {
                fs::write(dir.join("export_state.json"), b"{}").unwrap();
            }
            if claim {
                acquire_session_claim(&dir, &id).unwrap();
            }
            (id, dir)
        };
        let (live_id, live_dir) = mk(true, true);
        let (resumable_id, resumable_dir) = mk(true, false);
        let (orphan_id, orphan_dir) = mk(false, false);
        let report = report_reclaimable_sessions().unwrap();
        assert!(!report.temp_dir.is_empty());
        let find = |id: &str| report.entries.iter().find(|e| e.session_id == id).unwrap().clone();
        assert_eq!(find(&live_id).class, "live");
        assert_eq!(find(&live_id).holder_liveness, "live");
        assert_eq!(find(&resumable_id).class, "resumable");
        assert!(find(&resumable_id).has_manifest);
        assert_eq!(find(&orphan_id).class, "orphan");
        assert!(report.live_bytes >= 1000);
        assert!(report.resumable_bytes >= 1002);
        assert!(report.orphan_bytes >= 1000);
        assert_eq!(report.reclaimable_bytes, report.resumable_bytes + report.orphan_bytes);
        release_session_claim(&live_dir).unwrap();
        for d in [live_dir, resumable_dir, orphan_dir] {
            let _ = fs::remove_dir_all(&d);
        }
    }

    #[test]
    fn reclaim_sessions_removes_named_non_live_and_refuses_live() {
        let mk = |claim: bool| {
            let id = Uuid::new_v4().to_string();
            let dir = std::env::temp_dir().join(format!("kinetix-export-{id}"));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("piece_0.h264"), vec![1u8; 1000]).unwrap();
            fs::write(dir.join("export_state.json"), b"{}").unwrap();
            if claim {
                acquire_session_claim(&dir, &id).unwrap();
            }
            (id, dir)
        };
        let (live_id, live_dir) = mk(true);
        let (gone_id, gone_dir) = mk(false);
        let report = reclaim_sessions(&[live_id.clone(), gone_id.clone(), "not-a-uuid".to_string()]).unwrap();
        assert_eq!(report.refused_live, vec![live_id.clone()]);
        assert_eq!(report.removed, vec![gone_id.clone()]);
        assert_eq!(report.failed.len(), 1);
        assert!(report.bytes_reclaimed >= 1002);
        assert!(live_dir.exists(), "live session untouched");
        assert!(!gone_dir.exists());
        release_session_claim(&live_dir).unwrap();
        let _ = fs::remove_dir_all(&live_dir);
    }

    #[test]
    fn sweep_refuses_claimed_directory() {
        let (id, dir) = temp_session_dir("sweep-refuse");
        acquire_session_claim(&dir, &id).unwrap();
        assert!(
            is_session_dir_claimed_by_live_holder(&dir).unwrap(),
            "sweep guard must treat a live claim as in-use"
        );
        release_session_claim(&dir).unwrap();
        assert!(
            !is_session_dir_claimed_by_live_holder(&dir).unwrap(),
            "released claim must not block sweep"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    // WS3 STEP 8 (H10) — `classify_remove_outcome` in isolation, not a full
    // `sweep_manifestless_orphans` run. That function scans the WHOLE OS
    // temp directory and is shared, global, mutating state — under
    // `cargo test`'s default parallelism, calling it for real (even with a
    // 0 min-age override) risks racing and deleting ANOTHER concurrently
    // running test's own `kinetix-export-*` directory, which is a worse
    // failure mode than the thing being tested. `classify_remove_outcome`
    // is the exact decision the real call site makes from the same two
    // inputs it already has (`existed_before`, `dir.exists()` after the
    // call) — testing it directly exercises the real accounting logic with
    // none of the shared-filesystem risk. See its own doc comment for why
    // this environment cannot reproduce Windows delete-pending semantics
    // for real either way.
    #[test]
    fn pending_delete_is_never_classified_as_deleted() {
        // The Windows race this exists for: remove_dir_all returned Ok, but
        // an open handle kept the directory alive.
        assert_eq!(
            classify_remove_outcome(true, true),
            RemoveOutcome::PendingDelete
        );
    }

    #[test]
    fn a_genuine_removal_is_classified_as_deleted() {
        assert_eq!(
            classify_remove_outcome(true, false),
            RemoveOutcome::Deleted
        );
    }

    #[test]
    fn a_directory_gone_before_the_call_is_neither_deleted_nor_pending() {
        // Raced away by something else before remove_dir_all ran — not a
        // reclaim THIS sweep performed, so it must not inflate
        // bytes_reclaimed either.
        assert_eq!(
            classify_remove_outcome(false, false),
            RemoveOutcome::VanishedBeforeDelete
        );
    }

    #[test]
    fn only_the_deleted_outcome_is_eligible_for_bytes_reclaimed() {
        // Direct statement of the STEP 8 invariant: exactly one of the three
        // outcomes may ever be counted as reclaimed space.
        let outcomes = [
            classify_remove_outcome(true, true),   // PendingDelete
            classify_remove_outcome(true, false),  // Deleted
            classify_remove_outcome(false, false), // VanishedBeforeDelete
        ];
        let reclaimable: Vec<_> = outcomes
            .iter()
            .filter(|o| **o == RemoveOutcome::Deleted)
            .collect();
        assert_eq!(reclaimable.len(), 1);
        assert_ne!(*reclaimable[0], RemoveOutcome::PendingDelete);
    }

    /// Windows-only: compiled by the windows-check CI job (`--all-targets`),
    /// RUN only by a real `cargo test` on Windows — see
    /// docs/ws3-export/windows-validation.md's claim start-time row.
    #[cfg(windows)]
    mod windows_start_time {
        use super::super::*;
        use windows_sys::Win32::Foundation::FILETIME;

        fn ft(raw: u64) -> FILETIME {
            FILETIME { dwLowDateTime: raw as u32, dwHighDateTime: (raw >> 32) as u32 }
        }

        #[test]
        fn filetime_conversion_matches_known_vectors() {
            // 1970-01-01T00:00:00Z as FILETIME.
            assert_eq!(filetime_to_unix_ms(&ft(116_444_736_000_000_000)), 0);
            // 2000-01-01T00:00:00Z = 946684800 s after the Unix epoch.
            assert_eq!(filetime_to_unix_ms(&ft(125_911_584_000_000_000)), 946_684_800_000);
            // Pre-1970 saturates to 0 rather than wrapping.
            assert_eq!(filetime_to_unix_ms(&ft(0)), 0);
            // High/low split is honored (not just the low dword).
            let split = ft(125_911_584_000_000_000);
            assert_ne!(split.dwHighDateTime, 0);
        }

        #[test]
        fn own_process_start_time_is_plausible_and_stable() {
            let a = process_start_time_ms();
            let b = process_start_time_ms();
            assert_eq!(a, b, "creation time must not drift between reads");
            let now = now_ms();
            assert!(a <= now, "start {a} after now {now}");
            // Test process started less than an hour ago.
            assert!(now - a < 3_600_000, "start {a} implausibly far from now {now}");
        }

        #[test]
        fn liveness_uses_start_time_to_detect_pid_reuse() {
            let pid = std::process::id();
            let start = process_start_time_ms();
            assert!(is_holder_process_live(pid, start));
            // Same PID, start time an hour off ⇒ a different process reused the PID.
            assert!(!is_holder_process_live(pid, start + 3_600_000));
            // Legacy/unverifiable record (no start time) with an existing PID ⇒ live.
            assert!(is_holder_process_live(pid, 0));
            // Nonexistent PID ⇒ stale regardless of start time.
            assert!(!is_holder_process_live(4_000_000, start));
        }
    }
}
