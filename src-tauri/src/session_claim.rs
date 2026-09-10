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
        use std::mem::MaybeUninit;
        use std::os::windows::io::AsRawHandle;
        unsafe {
            let handle = std::process::id();
            let proc = windows_sys::Win32::System::Threading::OpenProcess(
                windows_sys::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                handle,
            );
            if proc.is_null() {
                return now_ms();
            }
            let mut creation = MaybeUninit::<i64>::uninit();
            let mut exit = MaybeUninit::<i64>::uninit();
            let mut kernel = MaybeUninit::<i64>::uninit();
            let mut user = MaybeUninit::<i64>::uninit();
            let ok = windows_sys::Win32::System::Threading::GetProcessTimes(
                proc,
                creation.as_mut_ptr(),
                exit.as_mut_ptr(),
                kernel.as_mut_ptr(),
                user.as_mut_ptr(),
            );
            windows_sys::Win32::Foundation::CloseHandle(proc);
            if ok == 0 {
                return now_ms();
            }
            let filetime = creation.assume_init();
            // FILETIME is 100-ns intervals since 1601-01-01.
            const EPOCH_DIFF_100NS: i64 = 116_444_736_000_000_000;
            let unix_100ns = filetime - EPOCH_DIFF_100NS;
            return (unix_100ns / 10_000).max(0) as u64;
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        now_ms()
    }
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
        use std::mem::MaybeUninit;
        unsafe {
            let proc = windows_sys::Win32::System::Threading::OpenProcess(
                windows_sys::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                pid,
            );
            if proc.is_null() {
                return false;
            }
            let mut creation = MaybeUninit::<i64>::uninit();
            let mut exit = MaybeUninit::<i64>::uninit();
            let mut kernel = MaybeUninit::<i64>::uninit();
            let mut user = MaybeUninit::<i64>::uninit();
            let ok = windows_sys::Win32::System::Threading::GetProcessTimes(
                proc,
                creation.as_mut_ptr(),
                exit.as_mut_ptr(),
                kernel.as_mut_ptr(),
                user.as_mut_ptr(),
            );
            windows_sys::Win32::Foundation::CloseHandle(proc);
            if ok == 0 {
                return false;
            }
            let filetime = creation.assume_init();
            const EPOCH_DIFF_100NS: i64 = 116_444_736_000_000_000;
            let unix_100ns = filetime - EPOCH_DIFF_100NS;
            let observed = (unix_100ns / 10_000).max(0) as u64;
            observed.abs_diff(start_time_ms) <= 2_000
        }
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
                if dir.exists() {
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
                } else if existed_before {
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
                } else {
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
}
