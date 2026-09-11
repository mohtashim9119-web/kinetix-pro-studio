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
        match fs::remove_dir_all(&dir) {
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
