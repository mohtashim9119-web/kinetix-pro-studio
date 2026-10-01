//! Quarantine — the ONLY way orphaned project data leaves its place, and it
//! never leaves the machine or the storage root: files are MOVED (never
//! deleted) into `<root>/quarantine/<project id>/data/…`, where the operator
//! can open and inspect them, with a `MANIFEST.json` recording every file's
//! original location, size and sha256. Nothing here runs by itself; it is
//! called only after an operator ruling on a specific project id.
//!
//! TWO-PHASE, CRASH-SAFE. A move is copy → verify → remove-source, and the
//! source is removed only after the quarantined copy has been verified
//! byte-for-byte (sha256) against the manifest AND the source is re-hashed
//! immediately before each removal:
//!
//!   1. `copying`  — manifest written (hashes taken from the SOURCE), files
//!      copied via `*.part` + rename. A crash here leaves the source intact and
//!      a partial quarantine; a re-run starts over from the source.
//!   2. `verified` — every copied file matches the manifest. A crash here
//!      leaves the source intact and a complete copy.
//!   3. source removal — file by file, each re-hashed first; a source that
//!      changed since it was verified (the app wrote to it) is KEPT and the
//!      run stops, so a live project is never half-removed. Directories are
//!      removed non-recursively, only when empty.
//!   4. `complete` — manifest state flipped last.
//!
//! Every re-run converges: it re-derives the source set, re-verifies, and
//! finishes whatever step is left. There is no state in which the only copy of
//! a byte is a partially written file.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::sha256::hash_file;
use crate::storage_consistency::{scan_consistency, FindingKind};
use crate::storage_root::{assets_dir, project_mirror_dir, projects_dir};

pub fn quarantine_dir(root: &Path) -> PathBuf {
    root.join("quarantine")
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuarantineState {
    Copying,
    Verified,
    Complete,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuarantinedFile {
    /// Path relative to the storage root — where it lived, and where under
    /// `data/` it now sits.
    pub rel_path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineManifest {
    pub id: String,
    pub created_ms: u64,
    pub state: QuarantineState,
    pub files: Vec<QuarantinedFile>,
}

/// Where a run stopped. Test-only crash injection: the production entry point
/// always passes `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StopAfter {
    ManifestWritten,
    FilesCopied,
    Verified,
    FirstSourceRemoved,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn safe_id(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok { Ok(id) } else { Err(format!("refusing unsafe project id for quarantine: {id:?}")) }
}

/// Every file the app keeps for `id`, as root-relative paths. Derived from the
/// id alone — the caller never supplies a path, so a hostile string cannot
/// aim the mover at anything outside these three subtrees.
fn source_files(root: &Path, id: &str) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    let mut add_tree = |base: PathBuf| -> Result<(), String> {
        let mut stack = vec![base];
        while let Some(p) = stack.pop() {
            let meta = match fs::symlink_metadata(&p) {
                Ok(m) => m,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(format!("stat {}: {e}", p.display())),
            };
            if meta.file_type().is_symlink() {
                return Err(format!("refusing to quarantine a symlink: {}", p.display()));
            }
            if meta.is_dir() {
                for e in fs::read_dir(&p).map_err(|e| format!("read_dir {}: {e}", p.display()))? {
                    stack.push(e.map_err(|e| e.to_string())?.path());
                }
            } else {
                out.push(p);
            }
        }
        Ok(())
    };
    add_tree(projects_dir(root).join(id))?;
    add_tree(assets_dir(root).join(id))?;
    add_tree(project_mirror_dir(root).join("projects").join(format!("{id}.json")))?;
    out.sort();
    out.into_iter()
        .map(|p| {
            p.strip_prefix(root)
                .map(|r| r.to_path_buf())
                .map_err(|_| format!("{} is outside the storage root", p.display()))
        })
        .collect()
}

pub(crate) fn write_manifest(dir: &Path, m: &QuarantineManifest) -> Result<(), String> {
    let text = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    crate::atomic_stage::write_bytes_atomic(&dir.join("MANIFEST.json"), text.as_bytes())
        .map_err(|e| format!("commit manifest: {e}"))
}

pub fn read_manifest(dir: &Path) -> Result<Option<QuarantineManifest>, String> {
    match fs::read_to_string(dir.join("MANIFEST.json")) {
        Ok(t) => serde_json::from_str(&t).map(Some).map_err(|e| format!("manifest unreadable: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read manifest: {e}")),
    }
}

fn copy_file_durably(src: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let part = crate::atomic_stage::unique_part_path(dest)?;
    fs::copy(src, &part).map_err(|e| format!("copy {} -> {}: {e}", src.display(), part.display()))?;
    fs::File::open(&part)
        .and_then(|f| f.sync_all())
        .map_err(|e| format!("sync {}: {e}", part.display()))?;
    fs::rename(&part, dest).map_err(|e| format!("commit {}: {e}", dest.display()))
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineReport {
    pub id: String,
    pub state: QuarantineState,
    pub files: u64,
    pub bytes: u64,
    pub quarantine_path: String,
}

/// Moves the project's on-disk data into quarantine. Refuses (moving nothing)
/// unless a FRESH consistency scan classifies the id as orphaned data:
/// on the dashboard, or with a plain dashboard-less-record it is refused too —
/// a `recordNotOnDashboard` project is quarantinable only when the operator
/// has ruled it so, which `allow_record_not_on_dashboard` states explicitly.
pub fn quarantine_project(
    root: &Path,
    id: &str,
    dashboard_ids: &[String],
    deleted_ids: &[String],
    allow_record_not_on_dashboard: bool,
) -> Result<QuarantineReport, String> {
    quarantine_inner(root, id, dashboard_ids, deleted_ids, allow_record_not_on_dashboard, None)
}

fn quarantine_inner(
    root: &Path,
    id: &str,
    dashboard_ids: &[String],
    deleted_ids: &[String],
    allow_record_not_on_dashboard: bool,
    stop_after: Option<StopAfter>,
) -> Result<QuarantineReport, String> {
    let id = safe_id(id)?;
    if dashboard_ids.iter().any(|d| d == id) {
        return Err(format!("project {id} is on the dashboard — not orphaned data, refusing to quarantine"));
    }
    let qdir = quarantine_dir(root).join(id);
    let data = qdir.join("data");
    let existing = read_manifest(&qdir)?;

    if let Some(m) = &existing {
        if m.state == QuarantineState::Complete {
            if source_files(root, id)?.is_empty() {
                return Ok(report(id, &qdir, m));
            }
            // Never overwrite a finished quarantine record with new data.
            return Err(format!(
                "project {id} already has a completed quarantine entry and files have reappeared — needs a ruling"
            ));
        }
    }

    // A first run must find the id orphaned in a fresh scan; a resumed run has
    // already passed that check and only finishes its own manifest's work.
    if existing.is_none() {
        let scan = scan_consistency(root, dashboard_ids, deleted_ids)?;
        match scan.findings.iter().find(|f| f.id == id).map(|f| f.kind) {
            None => return Err(format!("project {id} has no orphaned data to quarantine")),
            Some(FindingKind::DashboardWithoutRecord) => {
                return Err(format!("project {id} is a dashboard entry without data — nothing to move"))
            }
            Some(FindingKind::RecordNotOnDashboard) if !allow_record_not_on_dashboard => {
                return Err(format!(
                    "project {id} has an intact record that is merely not listed — needs an explicit ruling"
                ))
            }
            Some(_) => {}
        }
    }

    // Phase 1 — manifest from the SOURCE, then copy.
    let sources = source_files(root, id)?;
    let manifest = match existing {
        Some(m) if m.state != QuarantineState::Copying => m,
        _ => {
            // (Re)start: an earlier partial copy is our own scratch, never the
            // source; files are re-copied over it and re-verified below.
            let mut files = Vec::new();
            for rel in &sources {
                let abs = root.join(rel);
                let bytes = fs::metadata(&abs).map_err(|e| format!("stat {}: {e}", abs.display()))?.len();
                let sha256 = hash_file(&abs).map_err(|e| format!("hash {}: {e}", abs.display()))?;
                files.push(QuarantinedFile { rel_path: rel.to_string_lossy().replace('\\', "/"), bytes, sha256 });
            }
            let m = QuarantineManifest { id: id.to_string(), created_ms: now_ms(), state: QuarantineState::Copying, files };
            fs::create_dir_all(&qdir).map_err(|e| format!("create {}: {e}", qdir.display()))?;
            write_manifest(&qdir, &m)?;
            if stop_after == Some(StopAfter::ManifestWritten) {
                return Err("stopped: ManifestWritten".into());
            }
            for f in &m.files {
                copy_file_durably(&root.join(&f.rel_path), &data.join(&f.rel_path))?;
            }
            if stop_after == Some(StopAfter::FilesCopied) {
                return Err("stopped: FilesCopied".into());
            }
            m
        }
    };

    // Phase 2 — verify the quarantined copy against the manifest.
    verify_copy(&data, &manifest)?;
    let mut manifest = manifest;
    if manifest.state == QuarantineState::Copying {
        manifest.state = QuarantineState::Verified;
        write_manifest(&qdir, &manifest)?;
    }
    if stop_after == Some(StopAfter::Verified) {
        return Err("stopped: Verified".into());
    }

    // Phase 3 — remove each source only if it still equals what was verified.
    for f in &manifest.files {
        let abs = root.join(&f.rel_path);
        match fs::metadata(&abs) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue, // already moved on an earlier run
            Err(e) => return Err(format!("stat {}: {e}", abs.display())),
            Ok(_) => {}
        }
        let now = hash_file(&abs).map_err(|e| format!("re-hash {}: {e}", abs.display()))?;
        if now != f.sha256 {
            return Err(format!(
                "{} changed after it was quarantined-and-verified; source kept, nothing further removed",
                abs.display()
            ));
        }
        fs::remove_file(&abs).map_err(|e| format!("remove {}: {e}", abs.display()))?;
        if stop_after == Some(StopAfter::FirstSourceRemoved) {
            return Err("stopped: FirstSourceRemoved".into());
        }
    }
    // Empty source directories, deepest first, non-recursive.
    for base in [
        projects_dir(root).join(id),
        assets_dir(root).join(id),
    ] {
        prune_empty_dirs(&base);
    }

    // A file appearing in the source set that the manifest never saw means the
    // project was written to mid-move: leave it, report it, do not claim complete.
    let leftover = source_files(root, id)?;
    if !leftover.is_empty() {
        return Err(format!(
            "{} file(s) for project {id} appeared or remain that were not in the verified set; state left as verified",
            leftover.len()
        ));
    }

    manifest.state = QuarantineState::Complete;
    write_manifest(&qdir, &manifest)?;
    Ok(report(id, &qdir, &manifest))
}

fn report(id: &str, qdir: &Path, m: &QuarantineManifest) -> QuarantineReport {
    QuarantineReport {
        id: id.to_string(),
        state: m.state,
        files: m.files.len() as u64,
        bytes: m.files.iter().map(|f| f.bytes).sum(),
        quarantine_path: qdir.display().to_string(),
    }
}

fn verify_copy(data: &Path, m: &QuarantineManifest) -> Result<(), String> {
    for f in &m.files {
        let p = data.join(&f.rel_path);
        let len = fs::metadata(&p).map_err(|e| format!("quarantined copy missing {}: {e}", p.display()))?.len();
        if len != f.bytes {
            return Err(format!("quarantined copy {} has {len} bytes, expected {}", p.display(), f.bytes));
        }
        let h = hash_file(&p).map_err(|e| format!("hash {}: {e}", p.display()))?;
        if h != f.sha256 {
            return Err(format!("quarantined copy {} does not match its recorded sha256", p.display()));
        }
    }
    Ok(())
}

fn prune_empty_dirs(dir: &Path) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.filter_map(|e| e.ok()) {
        if e.path().is_dir() {
            prune_empty_dirs(&e.path());
        }
    }
    let _ = fs::remove_dir(dir); // fails (harmlessly) unless empty
}

// ---------------------------------------------------------------------------
// Media-vault reference drop — hardened, two-phase, reversible.
//
// A deleted project can leave references in the vault registry that pin blobs
// against reclaim. Dropping them is a registry edit, so it is treated like a
// move: the references are EXPORTED first (project id -> blob hashes -> paths ->
// sizes, plus a verbatim copy of the registry as it was), verified by reading
// the export back, and only then removed. Nothing is deleted: a blob that ends
// up with no referencer is merely reclaimable, and only the storage settings'
// "Free up cached data" can ever remove it.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RefDropManifest {
    pub id: String,
    pub created_ms: u64,
    /// `exported` (refs recorded, not yet removed) -> `dropped`.
    pub state: String,
    pub refs: Vec<crate::media_vault::ProjectRefRecord>,
    /// Hashes that no project references any more after the drop.
    pub became_reclaimable: Vec<String>,
}

pub fn ref_drop_dir(root: &Path, id: &str) -> PathBuf {
    quarantine_dir(root).join("vault-refs").join(id)
}

fn write_json_durably<T: Serialize>(dest: &Path, v: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    crate::atomic_stage::write_bytes_atomic(dest, text.as_bytes()).map_err(|e| format!("commit {}: {e}", dest.display()))
}

pub fn drop_project_refs(root: &Path, id: &str) -> Result<RefDropManifest, String> {
    let id = safe_id(id)?;
    let dir = ref_drop_dir(root, id);
    let manifest_path = dir.join("REFS.json");
    let refs = crate::media_vault::project_refs(root, id)?;

    let mut manifest = match fs::read_to_string(&manifest_path) {
        Ok(t) => serde_json::from_str::<RefDropManifest>(&t).map_err(|e| format!("refs manifest unreadable: {e}"))?,
        Err(_) => {
            if refs.is_empty() {
                return Err(format!("project {id} holds no vault references"));
            }
            // Phase 1 — export, verbatim registry copy, read back.
            let reg = crate::media_vault::registry_file(root);
            if reg.is_file() {
                fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                fs::copy(&reg, dir.join("registry.before.json")).map_err(|e| format!("copy registry: {e}"))?;
            }
            let m = RefDropManifest {
                id: id.to_string(),
                created_ms: now_ms(),
                state: "exported".to_string(),
                refs: refs.clone(),
                became_reclaimable: Vec::new(),
            };
            write_json_durably(&manifest_path, &m)?;
            let back: RefDropManifest = serde_json::from_str(
                &fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            if back != m {
                return Err("refs manifest read-back mismatch — nothing removed".into());
            }
            m
        }
    };
    if manifest.state == "dropped" && refs.is_empty() {
        return Ok(manifest);
    }
    // Phase 2 — remove, then verify none remain.
    crate::media_vault::unreference_project_everywhere(root, id)?;
    if !crate::media_vault::project_refs(root, id)?.is_empty() {
        return Err(format!("references for {id} remain after the drop"));
    }
    manifest.became_reclaimable = manifest
        .refs
        .iter()
        .filter(|r| r.other_referencers.is_empty())
        .map(|r| r.content_hash.clone())
        .collect();
    manifest.state = "dropped".to_string();
    write_json_durably(&manifest_path, &manifest)?;
    Ok(manifest)
}

/// Reverses a drop from its manifest. Returns how many references came back.
pub fn restore_dropped_refs(root: &Path, id: &str) -> Result<u64, String> {
    let id = safe_id(id)?;
    let text = fs::read_to_string(ref_drop_dir(root, id).join("REFS.json")).map_err(|e| format!("no refs manifest: {e}"))?;
    let m: RefDropManifest = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let hashes: Vec<String> = m.refs.iter().map(|r| r.content_hash.clone()).collect();
    crate::media_vault::restore_project_refs(root, id, &hashes)
}

/// IPC doors for the two directions. Nothing calls them automatically: a drop is
/// made only on an explicit operator ruling for a specific project id.
#[tauri::command]
pub fn storage_drop_project_refs(app: tauri::AppHandle, id: String) -> Result<RefDropManifest, String> {
    drop_project_refs(&crate::storage_root::resolve_storage_root(&app)?, &id)
}

#[tauri::command]
pub fn storage_restore_project_refs(app: tauri::AppHandle, id: String) -> Result<u64, String> {
    restore_dropped_refs(&crate::storage_root::resolve_storage_root(&app)?, &id)
}

/// Read-only listing of what is in quarantine, for a future UI.
#[allow(dead_code)]
pub fn list_quarantine(root: &Path) -> Vec<QuarantineManifest> {
    let mut out: Vec<QuarantineManifest> = fs::read_dir(quarantine_dir(root))
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| read_manifest(&e.path()).ok().flatten())
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

#[tauri::command]
pub async fn storage_quarantine_project(
    app: tauri::AppHandle,
    id: String,
    dashboard_ids: Vec<String>,
    deleted_ids: Vec<String>,
    allow_record_not_on_dashboard: bool,
    pending_ids: Option<Vec<String>>,
) -> Result<QuarantineReport, String> {
    refuse_unbuilt_bulk_row(&id, &deleted_ids, pending_ids.as_deref().unwrap_or_default())?;
    let root = crate::storage_root::resolve_storage_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        quarantine_project(&root, &id, &dashboard_ids, &deleted_ids, allow_record_not_on_dashboard)
    })
    .await
    .map_err(|e| format!("quarantine task failed: {e}"))?
}

/// An unbuilt bulk row (no record until Build Timeline) is normal, not
/// orphaned: its staged media must never be quarantined. A deleted id is.
pub fn refuse_unbuilt_bulk_row(id: &str, deleted_ids: &[String], pending_ids: &[String]) -> Result<(), String> {
    if pending_ids.iter().any(|p| p == id) && !deleted_ids.iter().any(|d| d == id) {
        return Err(format!("project {id} is an unbuilt bulk row — not orphaned data, refusing to quarantine"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unbuilt_bulk_row_is_never_quarantined() {
        let p = vec!["eeee5555".to_string()];
        assert!(refuse_unbuilt_bulk_row("eeee5555", &[], &p).is_err());
        assert!(refuse_unbuilt_bulk_row("eeee5555", &p, &p).is_ok());
        assert!(refuse_unbuilt_bulk_row("aaaa1111", &[], &p).is_ok());
    }

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "kinetix-quarantine-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    const ID: &str = "aaaa1111-0000-4000-8000-000000000001";

    /// An orphan: assets + a mirror copy, no store record, not on the dashboard.
    fn orphan(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
        let files = vec![
            (assets_dir(root).join(ID).join("v.bin"), (0..5000u32).map(|i| (i % 251) as u8).collect::<Vec<u8>>()),
            (assets_dir(root).join(ID).join("v.meta.json"), b"{\"name\":\"voice.wav\"}".to_vec()),
            (
                project_mirror_dir(root).join("projects").join(format!("{ID}.json")),
                b"{\"project\":{\"name\":\"Ghost\",\"segments\":[]}}".to_vec(),
            ),
        ];
        for (p, b) in &files {
            put(p, b);
        }
        files
    }

    fn quarantined(root: &Path, source: &Path) -> PathBuf {
        quarantine_dir(root).join(ID).join("data").join(source.strip_prefix(root).unwrap())
    }

    #[test]
    fn a_move_lands_every_byte_in_quarantine_and_only_then_removes_the_source() {
        let root = tmp("happy");
        let files = orphan(&root);
        let r = quarantine_project(&root, ID, &[], &[], false).unwrap();
        assert_eq!(r.state, QuarantineState::Complete);
        assert_eq!(r.files, 3);
        for (p, bytes) in &files {
            assert!(!p.exists(), "source removed: {}", p.display());
            assert_eq!(&fs::read(quarantined(&root, p)).unwrap(), bytes, "byte-identical copy");
        }
        assert!(!assets_dir(&root).join(ID).exists(), "empty source dir pruned");
        let m = read_manifest(&quarantine_dir(&root).join(ID)).unwrap().unwrap();
        assert_eq!(m.state, QuarantineState::Complete);
        assert_eq!(list_quarantine(&root).len(), 1);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_crash_after_the_manifest_or_the_copy_leaves_the_source_whole_and_a_rerun_finishes() {
        for stop in [StopAfter::ManifestWritten, StopAfter::FilesCopied, StopAfter::Verified] {
            let root = tmp("crash-early");
            let files = orphan(&root);
            let e = quarantine_inner(&root, ID, &[], &[], false, Some(stop)).unwrap_err();
            assert!(e.contains("stopped"), "{e}");
            for (p, bytes) in &files {
                assert_eq!(&fs::read(p).unwrap(), bytes, "source intact after crash at {stop:?}");
            }
            let r = quarantine_project(&root, ID, &[], &[], false).unwrap();
            assert_eq!(r.state, QuarantineState::Complete, "rerun after {stop:?}");
            for (p, bytes) in &files {
                assert!(!p.exists());
                assert_eq!(&fs::read(quarantined(&root, p)).unwrap(), bytes);
            }
            fs::remove_dir_all(&root).ok();
        }
    }

    #[test]
    fn a_crash_mid_source_removal_loses_nothing_and_a_rerun_completes() {
        let root = tmp("crash-mid");
        let files = orphan(&root);
        let e = quarantine_inner(&root, ID, &[], &[], false, Some(StopAfter::FirstSourceRemoved)).unwrap_err();
        assert!(e.contains("FirstSourceRemoved"));
        // Every byte is somewhere: source or quarantine (usually both).
        for (p, bytes) in &files {
            let q = fs::read(quarantined(&root, p)).unwrap();
            assert_eq!(&q, bytes, "quarantine holds a full copy of {}", p.display());
        }
        assert!(files.iter().any(|(p, _)| p.exists()), "some source still present mid-move");
        let r = quarantine_project(&root, ID, &[], &[], false).unwrap();
        assert_eq!(r.state, QuarantineState::Complete);
        assert!(files.iter().all(|(p, _)| !p.exists()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_corrupted_quarantine_copy_fails_verification_and_the_source_is_never_touched() {
        let root = tmp("corrupt");
        let files = orphan(&root);
        quarantine_inner(&root, ID, &[], &[], false, Some(StopAfter::FilesCopied)).unwrap_err();
        // Simulate bit-rot / a torn copy in the quarantined file.
        let victim = quarantined(&root, &files[0].0);
        let mut bad = fs::read(&victim).unwrap();
        bad[10] ^= 0xFF;
        fs::write(&victim, &bad).unwrap();
        // Manifest is still `copying`, so the rerun restarts the copy from the
        // intact source and heals it; verification then passes on fresh bytes.
        let rep = quarantine_project(&root, ID, &[], &[], false).unwrap();
        assert_eq!(rep.state, QuarantineState::Complete);
        assert_eq!(fs::read(quarantined(&root, &files[0].0)).unwrap(), files[0].1);
        // And a corruption AFTER verification but before removal is refused outright:
        let root2 = tmp("corrupt-verified");
        let files2 = orphan(&root2);
        quarantine_inner(&root2, ID, &[], &[], false, Some(StopAfter::Verified)).unwrap_err();
        let victim2 = quarantined(&root2, &files2[0].0);
        let mut bad2 = fs::read(&victim2).unwrap();
        bad2[0] ^= 0xFF;
        fs::write(&victim2, &bad2).unwrap();
        let e = quarantine_project(&root2, ID, &[], &[], false).unwrap_err();
        assert!(e.contains("sha256"), "{e}");
        for (p, bytes) in &files2 {
            assert_eq!(&fs::read(p).unwrap(), bytes, "source untouched when the copy fails verification");
        }
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&root2).ok();
    }

    #[test]
    fn a_source_that_changed_after_verification_is_kept() {
        let root = tmp("changed");
        let files = orphan(&root);
        quarantine_inner(&root, ID, &[], &[], false, Some(StopAfter::Verified)).unwrap_err();
        fs::write(&files[1].0, b"{\"name\":\"edited-while-we-were-away\"}").unwrap();
        let e = quarantine_project(&root, ID, &[], &[], false).unwrap_err();
        assert!(e.contains("changed after"), "{e}");
        assert_eq!(fs::read(&files[1].0).unwrap(), b"{\"name\":\"edited-while-we-were-away\"}");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_a_dashboard_project_an_unsafe_id_and_an_intact_unlisted_record() {
        let root = tmp("refuse");
        let files = orphan(&root);
        let e = quarantine_project(&root, ID, &[ID.to_string()], &[], false).unwrap_err();
        assert!(e.contains("on the dashboard"));
        assert!(quarantine_project(&root, "../etc", &[], &[], false).is_err());
        assert!(quarantine_project(&root, "no-such-project", &[], &[], false).is_err());
        put(&projects_dir(&root).join("bbbb2222").join("project.json"), b"{\"project\":{\"segments\":[]}}");
        let e = quarantine_project(&root, "bbbb2222", &[], &[], false).unwrap_err();
        assert!(e.contains("explicit ruling"), "{e}");
        assert!(projects_dir(&root).join("bbbb2222").join("project.json").exists());
        for (p, b) in &files {
            assert_eq!(&fs::read(p).unwrap(), b, "refusals move nothing");
        }
        assert!(!quarantine_dir(&root).join(ID).exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_completed_quarantine_is_idempotent() {
        let root = tmp("idem");
        orphan(&root);
        let a = quarantine_project(&root, ID, &[], &[], false).unwrap();
        let b = quarantine_project(&root, ID, &[], &[], false).unwrap();
        assert_eq!(a, b);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_ref_drop_exports_first_removes_only_that_projects_refs_and_is_reversible() {
        use crate::media_vault::{project_reference_totals, media_vault_import_bytes, zero_ref_bytes};
        let root = tmp("refdrop");
        let a = media_vault_import_bytes(&root, "gone", b"only gone holds this", "a.jpg", "image/jpeg").unwrap();
        let b = media_vault_import_bytes(&root, "gone", b"shared blob", "b.jpg", "image/jpeg").unwrap();
        media_vault_import_bytes(&root, "keep", b"shared blob", "b.jpg", "image/jpeg").unwrap();
        let registry_before = fs::read(root.join("media-vault").join("registry.json")).unwrap();

        let m = drop_project_refs(&root, "gone").unwrap();
        assert_eq!(m.state, "dropped");
        assert_eq!(m.refs.len(), 2);
        assert_eq!(m.became_reclaimable, vec![a.content_hash.clone()], "only the unshared blob becomes reclaimable");
        // Export is on disk, with the verbatim pre-drop registry beside it.
        assert_eq!(fs::read(ref_drop_dir(&root, "gone").join("registry.before.json")).unwrap(), registry_before);
        assert!(!project_reference_totals(&root).unwrap().contains_key("gone"));
        assert_eq!(project_reference_totals(&root).unwrap()["keep"].entries, 1);
        // Nothing deleted: both blobs are still on disk; the unshared one is merely reclaimable.
        assert!(root.join("media-vault").join(format!("{}.bin", a.content_hash)).is_file());
        assert!(root.join("media-vault").join(format!("{}.bin", b.content_hash)).is_file());
        assert_eq!(zero_ref_bytes(&root).unwrap(), a.size_bytes);
        // Idempotent; then reversible.
        assert_eq!(drop_project_refs(&root, "gone").unwrap(), m);
        assert_eq!(restore_dropped_refs(&root, "gone").unwrap(), 2);
        assert_eq!(project_reference_totals(&root).unwrap()["gone"].entries, 2);
        assert_eq!(zero_ref_bytes(&root).unwrap(), 0);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_ref_drop_for_a_project_with_no_refs_changes_nothing() {
        let root = tmp("refdrop-none");
        assert!(drop_project_refs(&root, "nobody").is_err());
        assert!(!ref_drop_dir(&root, "nobody").exists());
        fs::remove_dir_all(&root).ok();
    }

    /// OPERATOR TOOL, not a gate (ignored): executes an operator-ruled disposition on a real
    /// storage root. `KINETIX_OP_ROOT`, `KINETIX_OP_DASHBOARD` (ids listed on any dashboard),
    /// `KINETIX_OP_REFDROP` and `KINETIX_OP_QUARANTINE` (comma-separated full project ids).
    #[test]
    #[ignore]
    fn operator_execute_dispositions() {
        let list = |k: &str| -> Vec<String> {
            std::env::var(k).unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(String::from).collect()
        };
        let root = PathBuf::from(std::env::var("KINETIX_OP_ROOT").expect("KINETIX_OP_ROOT"));
        let dash = list("KINETIX_OP_DASHBOARD");
        let zero = |r: &Path| -> Vec<String> {
            let mut v: Vec<String> = crate::media_vault::media_vault_list(r).unwrap().into_iter()
                .filter(|e| e.referenced_by_project_ids.is_empty()).map(|e| e.content_hash).collect();
            v.sort();
            v
        };
        let before = zero(&root);
        for id in list("KINETIX_OP_REFDROP") {
            let m = drop_project_refs(&root, &id).unwrap();
            println!("REFDROP {id}: {} refs exported+dropped, {} became reclaimable, manifest {}",
                m.refs.len(), m.became_reclaimable.len(), ref_drop_dir(&root, &id).join("REFS.json").display());
        }
        for id in list("KINETIX_OP_QUARANTINE") {
            let r = quarantine_project(&root, &id, &dash, &[], true).unwrap();
            println!("QUARANTINE {id}: {:?} files={} bytes={} -> {}", r.state, r.files, r.bytes, r.quarantine_path);
        }
        let after = zero(&root);
        println!("ZEROREF before={} after={} newly={:?}", before.len(), after.len(),
            after.iter().filter(|h| !before.contains(h)).collect::<Vec<_>>());
    }
}
