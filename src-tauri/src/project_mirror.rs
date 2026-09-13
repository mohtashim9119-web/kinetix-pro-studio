//! WS1 Session O — durable project mirror.
//!
//! WHY THIS EXISTS. Project JSON lives in the webview's `localStorage`, which
//! WebKit scopes by ORIGIN. `tauri dev` serves the frontend from
//! `http://localhost:3000` (`tauri.conf.json`'s `devUrl`) while a bundled
//! build serves it from `tauri://localhost`. Those are two different origins,
//! so they are two disjoint `localStorage` stores: a project saved in dev is
//! invisible to the release build and vice versa. Session O's forensics
//! measured exactly that split on this machine — 8 projects under
//! `~/Library/WebKit/app` (dev) and 4 different ones under
//! `~/Library/WebKit/com.kinetix.pro-studio` (release).
//!
//! `app_local_data_dir()` is keyed by the BUNDLE IDENTIFIER, not the origin,
//! so it resolves to the same directory in `tauri dev`, `tauri dev -f
//! fa-inference`, and a bundled build alike — the same property that already
//! lets `fa.rs` share one `fa-models/` tree across all three. This module
//! mirrors every project save there, and `projectStore.ts` adopts anything
//! the mirror holds that the local origin does not.
//!
//! The mirror is a MIRROR, not the primary store: `localStorage` stays the
//! synchronous read path the app renders from (converting that API to async
//! would ripple through every `App.tsx` caller). Every write here is
//! best-effort and asynchronous — a mirror failure must never block or fail a
//! local save.
//!
//! WS2 T1.3 — PRIMARY STORE. This module now also exposes `project_store_*`
//! commands (`app_local_data_dir()/projects/<id>/project.json`) which are the
//! PRIMARY project-body store as of this change — `localStorage` is deprecated
//! for the project payload (kept only as a plain-browser-dev fallback outside
//! Tauri; see `projectStore.ts`'s `isTauri()` branch). The `project_store_*`
//! commands are a separate directory tree from `project_mirror_*`'s
//! `project-mirror/` tree on purpose: the two are allowed to serve different
//! roles (primary vs. legacy backup/cross-origin-adoption source) without one
//! write path fighting the other's backup rotation. Both reuse `write_atomic`/
//! `safe_id`/`rotate_backup` unchanged.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::Manager;

/// Directory under `app_local_data_dir()` holding the mirror.
const MIRROR_DIRNAME: &str = "project-mirror";
/// How many timestamped backups of a project's previous good state to retain.
/// Ten is deliberately generous: a project JSON is a few hundred KiB, so the
/// whole retained set for one project stays in single-digit MiB.
const BACKUP_RETAIN: usize = 10;

/// WS3 STEP 4 — how long a DELETED project's backup subdirectory survives
/// before [`sweep_stale_backup_dirs`] reclaims it. `BACKUP_RETAIN` only
/// bounds how many files accumulate per LIVE project id; it never bounded
/// how many project ids' worth of `backups/<id>/` directories pile up over
/// the app's lifetime — `project_mirror_delete_project`'s own doc comment
/// deliberately keeps a deleted project's backups as a safety net, but nothing
/// ever swept that safety net once its recovery window had passed, so it was
/// really "keep forever" in practice. 30 days is generous for that recovery
/// window (reopening the app well after an accidental delete) — the same
/// "grace period, not forever" shape as `exportResumeDiscovery.ts`'s 7-day
/// `ABANDONED_SESSION_TTL_MS`, longer here because a project JSON backup set
/// costs single-digit MiB at most, nothing like an export session's GBs.
const STALE_BACKUP_MIN_AGE_SECS: u64 = 30 * 24 * 60 * 60;

#[derive(Serialize)]
pub struct MirrorSnapshot {
    /// The `ProjectMeta[]` registry JSON, if the mirror has one.
    registry: Option<String>,
    /// `(project id, StoredProject JSON)` for every project file present.
    projects: Vec<(String, String)>,
}

fn mirror_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("cannot resolve app_local_data_dir for the project mirror: {e}"))?;
    Ok(dir.join(MIRROR_DIRNAME))
}

fn projects_dir(root: &Path) -> PathBuf {
    root.join("projects")
}

fn backups_dir(root: &Path) -> PathBuf {
    root.join("backups")
}

fn now_millis() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// Rejects anything that is not a plain single path segment. Project ids are
/// `crypto.randomUUID()` values, but this command is reachable from the
/// webview, so the id is treated as untrusted input rather than assumed
/// well-formed — a `..` or a separator here would escape the mirror directory.
fn safe_id(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(id)
    } else {
        Err(format!("refusing unsafe project id for a mirror path: {id:?}"))
    }
}

/// Step 5 item 3 — atomic write. Content goes to a uniquely-named temp file in
/// the SAME directory (so the rename cannot cross a filesystem boundary), is
/// flushed and fsynced, and only then renamed over the destination. `rename(2)`
/// within a directory is atomic, so a reader either sees the whole previous
/// file or the whole new one; an interrupted write leaves the temp file behind
/// and the destination untouched, never a truncated destination.
fn write_atomic(dest: &Path, contents: &str) -> Result<(), String> {
    let parent = dest
        .parent()
        .ok_or_else(|| format!("destination has no parent directory: {}", dest.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;

    let tmp = parent.join(format!(
        ".{}.tmp-{}-{}",
        dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "mirror".into()),
        std::process::id(),
        now_millis()
    ));

    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
        f.write_all(contents.as_bytes()).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        f.flush().map_err(|e| format!("flush {}: {e}", tmp.display()))?;
        // Durability before the rename — otherwise a crash can leave the
        // renamed name pointing at unflushed (zero-length) content.
        f.sync_all().map_err(|e| format!("fsync {}: {e}", tmp.display()))?;
    }

    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename {} -> {}: {e}", tmp.display(), dest.display())
    })
}

/// WS3 item A — defense-in-depth backstop for the JS-side guard in
/// `projectStore.ts`'s `saveProject` (Guard 1b). Detects the exact corruption
/// shape that turned a recoverable IndexedDB/origin cache loss into permanent
/// destruction across twenty projects: the SAME number of segments, but one
/// that carried an `assetId` in the currently-stored file no longer carries
/// it in the incoming write, while the Asset it pointed at is STILL listed in
/// the incoming project's own `assets` array. A legitimate removal
/// (`handleDeleteAsset` / `handleDeleteAllAssets` in App.tsx) always removes
/// the Asset entry from `assets` in the SAME write, so it never trips this.
///
/// This is a backstop, not a general validator: parse failures on either side
/// (or a shape this function does not recognize) return `false` — not
/// degraded — and are left to the guards that already own validity elsewhere.
/// The JS-side guard is expected to be the one that actually fires in
/// practice; this exists so a future bug that bypasses it (a direct
/// `invoke('project_store_write', ...)` call, a dev script) still cannot
/// rotate the last known-good backup out from under a degraded write.
fn is_asset_reference_loss(existing: &str, incoming: &str) -> bool {
    let Ok(existing_v) = serde_json::from_str::<serde_json::Value>(existing) else { return false };
    let Ok(incoming_v) = serde_json::from_str::<serde_json::Value>(incoming) else { return false };

    let existing_segments = existing_v.pointer("/project/segments").and_then(|v| v.as_array());
    let incoming_segments = incoming_v.pointer("/project/segments").and_then(|v| v.as_array());
    let (Some(existing_segments), Some(incoming_segments)) = (existing_segments, incoming_segments) else {
        return false;
    };
    if existing_segments.is_empty() || existing_segments.len() != incoming_segments.len() {
        return false;
    }

    let incoming_asset_ids: HashSet<&str> = incoming_v
        .pointer("/project/assets")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|a| a.get("id").and_then(|v| v.as_str())).collect())
        .unwrap_or_default();

    let incoming_by_id: HashMap<&str, &serde_json::Value> = incoming_segments
        .iter()
        .filter_map(|s| s.get("id").and_then(|v| v.as_str()).map(|id| (id, s)))
        .collect();

    for seg in existing_segments {
        let Some(id) = seg.get("id").and_then(|v| v.as_str()) else { continue };
        let Some(existing_asset_id) = seg.get("assetId").and_then(|v| v.as_str()) else { continue };
        if existing_asset_id.is_empty() {
            continue;
        }
        let Some(incoming_seg) = incoming_by_id.get(id) else { continue };
        let incoming_has_ref = incoming_seg
            .get("assetId")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        if !incoming_has_ref && incoming_asset_ids.contains(existing_asset_id) {
            return true;
        }
    }
    false
}

/// Step 5 item 4 — rotate the CURRENT contents of `src` into `backups_root/<id>/`
/// before it is overwritten, then prune to the newest [`BACKUP_RETAIN`].
/// Best-effort throughout: a backup failure must not stop the save it
/// precedes, so every error here is returned to the caller only for logging,
/// never propagated as a write failure. Takes the backups root directly
/// (rather than deriving it internally) so both the legacy mirror and the
/// primary store can share this logic while keeping their backup trees
/// separate.
fn rotate_backup(backups_root: &Path, id: &str, src: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    let previous = fs::read_to_string(src).map_err(|e| format!("read {}: {e}", src.display()))?;
    if previous.trim().is_empty() {
        return Ok(());
    }
    let dir = backups_root.join(id);
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all {}: {e}", dir.display()))?;
    write_atomic(&dir.join(format!("{}.json", now_millis())), &previous)?;

    // Prune oldest-first. Filenames are zero-padded-free millisecond stamps, so
    // sort numerically on the parsed stem rather than lexically.
    let mut entries: Vec<(u128, PathBuf)> = fs::read_dir(&dir)
        .map_err(|e| format!("read_dir {}: {e}", dir.display()))?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            let stem = p.file_stem()?.to_string_lossy().to_string();
            stem.parse::<u128>().ok().map(|ms| (ms, p))
        })
        .collect();
    entries.sort_by_key(|(ms, _)| *ms);
    let excess = entries.len().saturating_sub(BACKUP_RETAIN);
    for (_, path) in entries.into_iter().take(excess) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

/// WS3 STEP 4 — sweeps whole per-project backup subdirectories under
/// `backups_root` for ids that are no longer in `live_ids`, once the
/// directory's newest entry is older than `min_age_secs`. The other half of
/// closing the leak `rotate_backup`'s own cap doesn't: that cap bounds file
/// COUNT per id, this bounds directory LIFETIME once its project is gone.
///
/// Age is the newest backup's own mtime (mirrors `rotate_backup`'s "prune
/// oldest first" reasoning — a directory is only as fresh as its most recent
/// entry), not the directory's own mtime, which a filesystem may not update
/// on every child write. An unreadable or empty directory has nothing worth
/// a 30-day grace period for and is swept immediately. Best-effort
/// throughout, same posture as `rotate_backup` and
/// `session_claim::sweep_manifestless_orphans`: an error reading or removing
/// one entry is skipped, never aborts the pass or fails app launch.
fn sweep_stale_backup_dirs(backups_root: &Path, live_ids: &HashSet<String>, min_age_secs: u64) {
    let Ok(entries) = fs::read_dir(backups_root) else { return };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(id) = path.file_name().and_then(|n| n.to_str()) else { continue };
        if live_ids.contains(id) {
            continue;
        }
        let newest_mtime = fs::read_dir(&path).ok().and_then(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
                .max()
        });
        let old_enough = match newest_mtime {
            Some(mtime) => now
                .duration_since(mtime)
                .map(|age| age.as_secs() >= min_age_secs)
                .unwrap_or(false),
            None => true,
        };
        if old_enough {
            let _ = fs::remove_dir_all(&path);
        }
    }
}

/// Project ids the legacy mirror still has a project file for.
fn live_mirror_ids(root: &Path) -> HashSet<String> {
    let mut ids = HashSet::new();
    if let Ok(rd) = fs::read_dir(projects_dir(root)) {
        for entry in rd.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Some(stem) = path.file_stem() {
                ids.insert(stem.to_string_lossy().to_string());
            }
        }
    }
    ids
}

/// Project ids the primary store still has a project file for.
fn live_store_ids(root: &Path) -> HashSet<String> {
    let mut ids = HashSet::new();
    if let Ok(rd) = fs::read_dir(root.join("projects")) {
        for entry in rd.filter_map(|e| e.ok()) {
            if entry.path().join("project.json").is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    ids.insert(name.to_string());
                }
            }
        }
    }
    ids
}

/// WS3 STEP 4 — best-effort startup sweep for both backup trees (the legacy
/// mirror's `project-mirror/backups/` and the primary store's
/// `project-store-backups/`). Never blocks or fails app launch — errors from
/// either tree's `mirror_root`/`store_root` resolution are silently skipped,
/// same posture `sweep_stale_backup_dirs` itself already has.
pub fn sweep_stale_project_backups(app: &tauri::AppHandle) {
    if let Ok(root) = mirror_root(app) {
        let live = live_mirror_ids(&root);
        sweep_stale_backup_dirs(&backups_dir(&root), &live, STALE_BACKUP_MIN_AGE_SECS);
    }
    if let Ok(root) = store_root(app) {
        let live = live_store_ids(&root);
        sweep_stale_backup_dirs(&store_backups_dir(&root), &live, STALE_BACKUP_MIN_AGE_SECS);
    }
}

/// Reads every project file plus the registry. Used once at boot for the
/// adoption pass. A single unreadable project file is skipped rather than
/// failing the whole snapshot — adopting nine of ten projects beats adopting
/// none.
#[tauri::command]
pub fn project_mirror_read_all(app: tauri::AppHandle) -> Result<MirrorSnapshot, String> {
    let root = mirror_root(&app)?;
    let registry = fs::read_to_string(root.join("registry.json")).ok();

    let mut projects = Vec::new();
    if let Ok(rd) = fs::read_dir(projects_dir(&root)) {
        for entry in rd.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().map(|s| s.to_string_lossy().to_string()) else {
                continue;
            };
            if safe_id(&stem).is_err() {
                continue;
            }
            match fs::read_to_string(&path) {
                Ok(text) => projects.push((stem, text)),
                Err(e) => log::warn!("[project_mirror] skipping unreadable {}: {e}", path.display()),
            }
        }
    }
    Ok(MirrorSnapshot { registry, projects })
}

/// Writes one project (and, when supplied, the registry) to the mirror,
/// rotating the project's previous contents into `backups/` first.
#[tauri::command]
pub fn project_mirror_write_project(
    app: tauri::AppHandle,
    id: String,
    contents: String,
    registry: Option<String>,
) -> Result<(), String> {
    let root = mirror_root(&app)?;
    let id = safe_id(&id)?;
    let dest = projects_dir(&root).join(format!("{id}.json"));

    // WS3 item A — refuse the write outright (rotate nothing, overwrite
    // nothing) when it is the dangling-reference degradation shape. See
    // `is_asset_reference_loss`'s doc comment.
    if let Ok(existing) = fs::read_to_string(&dest) {
        if is_asset_reference_loss(&existing, &contents) {
            return Err(format!(
                "refusing to mirror project {id}: incoming write keeps its segment count but drops \
                 asset reference(s) still listed in its own assets array (WS3 item A backstop)"
            ));
        }
    }

    if let Err(e) = rotate_backup(&backups_dir(&root), id, &dest) {
        // Non-fatal by design — see rotate_backup's contract.
        log::warn!("[project_mirror] backup rotation failed for {id}: {e}");
    }
    write_atomic(&dest, &contents)?;
    if let Some(registry) = registry {
        write_atomic(&root.join("registry.json"), &registry)?;
    }
    Ok(())
}

/// Removes a project from the mirror. Its backups are deliberately RETAINED:
/// a delete is the one operation where a stale copy is the only remaining
/// safety net, and the retention cap already bounds the space.
#[tauri::command]
pub fn project_mirror_delete_project(
    app: tauri::AppHandle,
    id: String,
    registry: Option<String>,
) -> Result<(), String> {
    let root = mirror_root(&app)?;
    let id = safe_id(&id)?;
    let dest = projects_dir(&root).join(format!("{id}.json"));
    if let Err(e) = rotate_backup(&backups_dir(&root), id, &dest) {
        log::warn!("[project_mirror] backup rotation failed for {id}: {e}");
    }
    if dest.exists() {
        fs::remove_file(&dest).map_err(|e| format!("remove {}: {e}", dest.display()))?;
    }
    if let Some(registry) = registry {
        write_atomic(&root.join("registry.json"), &registry)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// WS2 T1.3 — primary project-body store.
//
// Directory layout: `app_local_data_dir()/projects/<id>/project.json`, kept
// separate from `project_mirror_*`'s `project-mirror/` tree above. Backups for
// the primary store rotate into `app_local_data_dir()/project-store-backups/<id>/`
// — a distinct tree from the mirror's own `project-mirror/backups/`, so the two
// write paths never contend over the same backup directory.
// ---------------------------------------------------------------------------

/// WS3 item C — resolves through the configurable storage root
/// (`storage_root.rs`), not `app_local_data_dir()` directly. On any install
/// that has never relocated, `resolve_storage_root` returns exactly
/// `app_local_data_dir()` (its own documented default), so this is a no-op
/// for the overwhelming majority of installs today — behavior changes only
/// after an explicit `storage_root_relocate`, which itself moves this
/// module's `projects/` and `project-store-backups/` trees before ever
/// updating the pointer this reads.
fn store_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::storage_root::resolve_storage_root(app)
}

fn store_project_file(root: &Path, id: &str) -> PathBuf {
    root.join("projects").join(id).join("project.json")
}

fn store_backups_dir(root: &Path) -> PathBuf {
    // WS3 item C — shared with storage_root.rs's relocation logic so the two
    // never drift onto different literal paths; see
    // `storage_root::project_backups_dir`'s own doc comment.
    crate::storage_root::project_backups_dir(root)
}

/// Reads one project's JSON from the primary store. `Ok(None)` for "no such
/// project" — kept distinguishable from an error, mirroring `loadProject`'s
/// existing "absent is not a failure" contract on the JS side.
#[tauri::command]
pub fn project_store_read(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    let root = store_root(&app)?;
    let id = safe_id(&id)?;
    let path = store_project_file(&root, id);
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

/// Writes one project's JSON to the primary store, atomically, rotating the
/// previous contents into the backup tree first (same non-fatal contract as
/// `project_mirror_write_project`).
#[tauri::command]
pub fn project_store_write(app: tauri::AppHandle, id: String, contents: String) -> Result<(), String> {
    let root = store_root(&app)?;
    let id = safe_id(&id)?;
    let dest = store_project_file(&root, id);

    // WS3 item A — same backstop as `project_mirror_write_project`; see
    // `is_asset_reference_loss`'s doc comment. This is the PRIMARY store, so
    // this is the check that actually stood between the incident's degraded
    // writes and the last known-good `project.json` for each of the twenty
    // affected projects.
    if let Ok(existing) = fs::read_to_string(&dest) {
        if is_asset_reference_loss(&existing, &contents) {
            return Err(format!(
                "refusing to overwrite project {id}: incoming write keeps its segment count but drops \
                 asset reference(s) still listed in its own assets array (WS3 item A backstop)"
            ));
        }
    }

    if let Err(e) = rotate_backup(&store_backups_dir(&root), id, &dest) {
        log::warn!("[project_store] backup rotation failed for {id}: {e}");
    }
    write_atomic(&dest, &contents)
}

/// Removes a project from the primary store. Backups are retained, same
/// rationale as `project_mirror_delete_project`.
#[tauri::command]
pub fn project_store_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = store_root(&app)?;
    let id = safe_id(&id)?;
    let dest = store_project_file(&root, id);
    if let Err(e) = rotate_backup(&store_backups_dir(&root), id, &dest) {
        log::warn!("[project_store] backup rotation failed for {id}: {e}");
    }
    if dest.exists() {
        fs::remove_file(&dest).map_err(|e| format!("remove {}: {e}", dest.display()))?;
        // Prune the now-empty `projects/<id>/` directory. Best-effort — a
        // failure here (e.g. the dir isn't actually empty for some reason)
        // must not fail the delete itself.
        if let Some(parent) = dest.parent() {
            let _ = fs::remove_dir(parent);
        }
    }
    Ok(())
}

/// Lists every project id currently present in the primary store. Used by the
/// boot-time migration to skip ids it has already adopted.
#[tauri::command]
pub fn project_store_list_ids(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let root = store_root(&app)?;
    let dir = root.join("projects");
    let mut ids = Vec::new();
    match fs::read_dir(&dir) {
        Ok(rd) => {
            for entry in rd.filter_map(|e| e.ok()) {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
                    continue;
                };
                if safe_id(&name).is_err() {
                    continue;
                }
                if path.join("project.json").is_file() {
                    ids.push(name);
                }
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("read_dir {}: {e}", dir.display())),
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kinetix-mirror-test-{tag}-{}", now_millis()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn safe_id_accepts_a_uuid_and_rejects_traversal() {
        assert!(safe_id("fd77f95e-b339-4463-810c-6eaf3539c58b").is_ok());
        assert!(safe_id("..").is_err());
        assert!(safe_id("a/b").is_err());
        assert!(safe_id("../../etc/passwd").is_err());
        assert!(safe_id("").is_err());
        assert!(safe_id("a.b").is_err());
    }

    #[test]
    fn write_atomic_replaces_contents_and_leaves_no_temp_file() {
        let d = tmpdir("atomic");
        let dest = d.join("p.json");
        write_atomic(&dest, "{\"v\":1}").unwrap();
        assert_eq!(fs::read_to_string(&dest).unwrap(), "{\"v\":1}");
        write_atomic(&dest, "{\"v\":2}").unwrap();
        assert_eq!(fs::read_to_string(&dest).unwrap(), "{\"v\":2}");

        // No `.tmp-` residue survives a successful write.
        let leftovers: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");
        fs::remove_dir_all(&d).ok();
    }

    // Unix-only: inode identity via `MetadataExt::ino()`. Windows' equivalent
    // (`file_index()`) is nightly-only, so the replace-not-truncate property
    // is unasserted there (docs/ws3-export/windows-validation.md).
    #[cfg(unix)]
    #[test]
    fn write_atomic_never_truncates_the_destination_in_place() {
        // The destination inode must be REPLACED, not opened for truncation —
        // that is what makes an interrupted write non-destructive. Compare the
        // inode number across a rewrite.
        use std::os::unix::fs::MetadataExt;
        let d = tmpdir("inode");
        let dest = d.join("p.json");
        write_atomic(&dest, "original").unwrap();
        let before = fs::metadata(&dest).unwrap().ino();
        write_atomic(&dest, "replacement").unwrap();
        let after = fs::metadata(&dest).unwrap().ino();
        assert_ne!(before, after, "destination was truncated in place, not replaced by rename");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn rotate_backup_retains_at_most_the_cap_and_keeps_the_newest() {
        let d = tmpdir("rotate");
        let id = "abc-123";
        let dest = projects_dir(&d).join(format!("{id}.json"));
        for i in 0..(BACKUP_RETAIN + 5) {
            write_atomic(&dest, &format!("{{\"n\":{i}}}")).unwrap();
            rotate_backup(&backups_dir(&d), id, &dest).unwrap();
            // Distinct millisecond stamps — the backup filename is the clock.
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let dir = backups_dir(&d).join(id);
        let mut stamps: Vec<u128> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.path().file_stem()?.to_string_lossy().parse::<u128>().ok())
            .collect();
        stamps.sort();
        assert_eq!(stamps.len(), BACKUP_RETAIN, "retention cap not enforced");

        // Each iteration writes n=i then immediately rotates it, so the newest
        // backup holds the value written by the FINAL iteration: i = cap+4.
        let newest = dir.join(format!("{}.json", stamps.last().unwrap()));
        assert_eq!(
            fs::read_to_string(newest).unwrap(),
            format!("{{\"n\":{}}}", BACKUP_RETAIN + 4)
        );
        fs::remove_dir_all(&d).ok();
    }

    // ── WS3 STEP 4 — sweep_stale_backup_dirs: the leak rotate_backup's own
    //    per-id cap doesn't close (a DELETED project's whole backup
    //    directory, never just bounded, never swept). ─────────────────────

    fn touch_backup_file(dir: &Path, name: &str, age_secs: u64) {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, b"{}").unwrap();
        let older = SystemTime::now() - std::time::Duration::from_secs(age_secs);
        let file = fs::File::open(&path).unwrap();
        file.set_modified(older).unwrap();
    }

    #[test]
    fn a_dead_projects_backup_dir_past_the_grace_period_is_swept() {
        let d = tmpdir("sweep-dead-old");
        let root = backups_dir(&d);
        touch_backup_file(&root.join("dead-project"), "111.json", 40 * 24 * 60 * 60);

        sweep_stale_backup_dirs(&root, &HashSet::new(), STALE_BACKUP_MIN_AGE_SECS);

        assert!(!root.join("dead-project").exists(), "a long-dead project's backups must be reclaimed");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_dead_projects_backup_dir_still_inside_the_grace_period_survives() {
        let d = tmpdir("sweep-dead-recent");
        let root = backups_dir(&d);
        touch_backup_file(&root.join("just-deleted"), "111.json", 60);

        sweep_stale_backup_dirs(&root, &HashSet::new(), STALE_BACKUP_MIN_AGE_SECS);

        assert!(
            root.join("just-deleted").exists(),
            "the safety net project_mirror_delete_project's doc comment promises must survive a recent delete"
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_live_projects_backup_dir_is_never_swept_regardless_of_age() {
        let d = tmpdir("sweep-live");
        let root = backups_dir(&d);
        touch_backup_file(&root.join("still-around"), "111.json", 400 * 24 * 60 * 60);

        let live: HashSet<String> = ["still-around".to_string()].into_iter().collect();
        sweep_stale_backup_dirs(&root, &live, STALE_BACKUP_MIN_AGE_SECS);

        assert!(root.join("still-around").exists(), "a live project's backups must never be swept, no matter how old");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn live_mirror_ids_reflects_exactly_the_json_files_present() {
        let d = tmpdir("live-mirror-ids");
        write_atomic(&projects_dir(&d).join("a.json"), "{}").unwrap();
        write_atomic(&projects_dir(&d).join("b.json"), "{}").unwrap();
        let ids = live_mirror_ids(&d);
        assert_eq!(ids, ["a".to_string(), "b".to_string()].into_iter().collect());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn live_store_ids_requires_an_actual_project_json_not_just_the_id_directory() {
        let d = tmpdir("live-store-ids");
        let projects = d.join("projects");
        fs::create_dir_all(projects.join("has-project")).unwrap();
        fs::write(projects.join("has-project").join("project.json"), "{}").unwrap();
        // An id directory with no project.json (e.g. left behind mid-write)
        // must not count as live — otherwise its backups could never be swept.
        fs::create_dir_all(projects.join("empty-dir")).unwrap();
        let ids = live_store_ids(&d);
        assert_eq!(ids, ["has-project".to_string()].into_iter().collect());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn an_end_to_end_delete_then_sweep_reclaims_exactly_the_dead_projects_backups() {
        // Mirrors the real sequence: a project accumulates backups while
        // live, gets deleted (rotate_backup keeps firing on delete per
        // project_mirror_delete_project's own contract), ages past the
        // grace period, and only THEN is its directory reclaimed — a live
        // sibling project's own backups must survive the same sweep.
        let d = tmpdir("e2e-sweep");
        let dead_dest = projects_dir(&d).join("dead.json");
        let alive_dest = projects_dir(&d).join("alive.json");
        write_atomic(&dead_dest, "{\"n\":0}").unwrap();
        write_atomic(&alive_dest, "{\"n\":0}").unwrap();
        rotate_backup(&backups_dir(&d), "dead", &dead_dest).unwrap();
        rotate_backup(&backups_dir(&d), "alive", &alive_dest).unwrap();
        // "Delete" dead: remove its live file (mirrors project_mirror_delete_project).
        fs::remove_file(&dead_dest).unwrap();
        // Age dead's backup past the grace period; alive's stays fresh.
        for entry in fs::read_dir(backups_dir(&d).join("dead")).unwrap().filter_map(|e| e.ok()) {
            let older = SystemTime::now() - std::time::Duration::from_secs(40 * 24 * 60 * 60);
            fs::File::open(entry.path()).unwrap().set_modified(older).unwrap();
        }

        let live = live_mirror_ids(&d);
        assert_eq!(live, ["alive".to_string()].into_iter().collect());
        sweep_stale_backup_dirs(&backups_dir(&d), &live, STALE_BACKUP_MIN_AGE_SECS);

        assert!(!backups_dir(&d).join("dead").exists(), "the deleted, aged-out project's backups must be gone");
        assert!(backups_dir(&d).join("alive").exists(), "the live sibling's backups must be untouched");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn an_interrupted_write_leaves_the_destination_whole_and_no_partial_content() {
        // Reproduces the failure `write_atomic` exists to prevent: content is
        // staged into the temp file, and the process "dies" before the rename.
        // The destination must still hold the COMPLETE previous value — never a
        // truncated or half-written one — and the reader must never observe the
        // partial bytes under the destination name.
        let d = tmpdir("interrupted");
        let dest = d.join("p.json");
        let good = r#"{"version":2,"project":{"segments":[1,2,3]}}"#;
        write_atomic(&dest, good).unwrap();

        // Stage a partial write exactly as write_atomic would, then stop.
        let tmp = d.join(".p.json.tmp-simulated-interrupt");
        {
            let mut f = fs::File::create(&tmp).unwrap();
            f.write_all(br#"{"version":2,"project":{"segm"#).unwrap();
            f.flush().unwrap();
        }
        // No rename happens — the interruption.

        assert_eq!(
            fs::read_to_string(&dest).unwrap(),
            good,
            "destination was damaged by an interrupted write"
        );
        // The partial content exists only under the temp name, and the temp
        // name is not a *.json file, so read_all's extension filter skips it.
        assert!(tmp.exists());
        assert_ne!(tmp.extension().and_then(|e| e.to_str()), Some("json"));

        // A subsequent successful write still lands cleanly over the good value.
        write_atomic(&dest, r#"{"version":2,"project":{"segments":[4]}}"#).unwrap();
        assert_eq!(
            fs::read_to_string(&dest).unwrap(),
            r#"{"version":2,"project":{"segments":[4]}}"#
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn rotate_backup_is_a_noop_when_there_is_nothing_to_back_up() {
        let d = tmpdir("noop");
        rotate_backup(&backups_dir(&d), "abc", &projects_dir(&d).join("abc.json")).unwrap();
        assert!(!backups_dir(&d).join("abc").exists());
        fs::remove_dir_all(&d).ok();
    }

    // -----------------------------------------------------------------------
    // WS2 T1.3 — primary store path/backup shape. The `#[tauri::command]`
    // wrappers (`project_store_read`/`write`/`delete`/`list_ids`) need a real
    // `tauri::AppHandle` to resolve `app_local_data_dir()`, which a unit test
    // can't construct — so these tests exercise the same private helpers
    // (`store_project_file`, `store_backups_dir`, `write_atomic`,
    // `rotate_backup`) the commands are thin wrappers around, on a tmpdir
    // standing in for `store_root()`'s result. That's the same style already
    // used above for the mirror's own commands.
    // -----------------------------------------------------------------------

    #[test]
    fn store_project_file_uses_the_id_as_a_directory_not_a_filename() {
        let d = tmpdir("store-path-shape");
        let path = store_project_file(&d, "abc-123");
        assert_eq!(path, d.join("projects").join("abc-123").join("project.json"));
    }

    #[test]
    fn store_backups_dir_is_a_separate_tree_from_the_mirrors_backups_dir() {
        let d = tmpdir("store-vs-mirror-backups");
        assert_ne!(store_backups_dir(&d), backups_dir(&d));
    }

    #[test]
    fn primary_store_write_read_delete_round_trip_and_prunes_the_empty_dir() {
        let d = tmpdir("store-round-trip");
        let id = "fd77f95e-b339-4463-810c-6eaf3539c58b";
        let dest = store_project_file(&d, id);

        // Write (mirrors project_store_write's body minus the AppHandle).
        if let Err(e) = rotate_backup(&store_backups_dir(&d), id, &dest) {
            panic!("unexpected rotate_backup error on first write: {e}");
        }
        write_atomic(&dest, r#"{"version":2,"project":{"segments":[1]}}"#).unwrap();
        assert_eq!(
            fs::read_to_string(&dest).unwrap(),
            r#"{"version":2,"project":{"segments":[1]}}"#
        );

        // A second write rotates the first version into the store's own
        // (separate) backup tree.
        rotate_backup(&store_backups_dir(&d), id, &dest).unwrap();
        write_atomic(&dest, r#"{"version":2,"project":{"segments":[1,2]}}"#).unwrap();
        let backup_dir = store_backups_dir(&d).join(id);
        assert!(backup_dir.exists(), "expected a rotated backup for the primary store");

        // Delete removes the file and prunes the now-empty `<id>/` directory,
        // but leaves the backup tree (and the id's history) alone.
        if let Err(e) = rotate_backup(&store_backups_dir(&d), id, &dest) {
            panic!("unexpected rotate_backup error before delete: {e}");
        }
        fs::remove_file(&dest).unwrap();
        if let Some(parent) = dest.parent() {
            let _ = fs::remove_dir(parent);
        }
        assert!(!dest.exists());
        assert!(!dest.parent().unwrap().exists(), "the now-empty <id>/ dir should be pruned");
        assert!(backup_dir.exists(), "backups must survive a delete");

        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn store_list_ids_only_reports_dirs_with_a_project_json_and_a_safe_id() {
        let d = tmpdir("store-list-ids");
        let projects = d.join("projects");
        // A real project: dir + project.json.
        fs::create_dir_all(projects.join("real-id")).unwrap();
        write_atomic(&projects.join("real-id").join("project.json"), "{}").unwrap();
        // A leftover empty dir (e.g. after a delete's prune failed once) — no
        // project.json, must not be reported as present.
        fs::create_dir_all(projects.join("empty-id")).unwrap();
        // An unsafe name — must never be reachable via list_ids either.
        fs::create_dir_all(projects.join("unsafe.id")).unwrap();
        write_atomic(&projects.join("unsafe.id").join("project.json"), "{}").unwrap();

        // Inline the same filter list_ids uses, since the command itself
        // needs an AppHandle.
        let mut ids: Vec<String> = fs::read_dir(&projects)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let path = e.path();
                if !path.is_dir() {
                    return None;
                }
                let name = path.file_name()?.to_string_lossy().to_string();
                if safe_id(&name).is_err() {
                    return None;
                }
                path.join("project.json").is_file().then_some(name)
            })
            .collect();
        ids.sort();
        assert_eq!(ids, vec!["real-id".to_string()]);

        fs::remove_dir_all(&d).ok();
    }

    // ── WS3 item A — is_asset_reference_loss ────────────────────────────
    //
    // Regression coverage for the Machine 1 incident shape: same segment
    // count, a segment's `assetId` pointer disappears, but the Asset it
    // pointed at is still listed in the incoming write's own `assets` array.

    fn stored(segments: &str, assets: &str) -> String {
        format!(r#"{{"version":4,"savedAt":1,"project":{{"segments":{segments},"assets":{assets}}}}}"#)
    }

    #[test]
    fn flags_a_dropped_asset_reference_when_the_asset_metadata_survives() {
        // RED case before the fix existed: this is exactly the shape that
        // overwrote twenty projects' native project.json.
        let existing = stored(
            r#"[{"id":"seg-1","assetId":"asset-1"}]"#,
            r#"[{"id":"asset-1","name":"clip.mp4"}]"#,
        );
        let incoming = stored(
            r#"[{"id":"seg-1"}]"#, // assetId silently dropped
            r#"[{"id":"asset-1","name":"clip.mp4"}]"#, // asset metadata still present
        );
        assert!(is_asset_reference_loss(&existing, &incoming));
    }

    #[test]
    fn allows_a_deliberate_asset_deletion_that_removes_the_asset_too() {
        // handleDeleteAsset/handleDeleteAllAssets shape: the Asset itself is
        // removed from `assets` in the SAME write, so this must NOT trip.
        let existing = stored(
            r#"[{"id":"seg-1","assetId":"asset-1"}]"#,
            r#"[{"id":"asset-1","name":"clip.mp4"}]"#,
        );
        let incoming = stored(r#"[{"id":"seg-1"}]"#, r#"[]"#);
        assert!(!is_asset_reference_loss(&existing, &incoming));
    }

    #[test]
    fn allows_an_unrelated_edit_that_keeps_every_reference_intact() {
        let existing = stored(
            r#"[{"id":"seg-1","assetId":"asset-1"}]"#,
            r#"[{"id":"asset-1","name":"clip.mp4"}]"#,
        );
        let incoming = stored(
            r#"[{"id":"seg-1","assetId":"asset-1","text":"edited"}]"#,
            r#"[{"id":"asset-1","name":"clip.mp4"}]"#,
        );
        assert!(!is_asset_reference_loss(&existing, &incoming));
    }

    #[test]
    fn ignores_a_segment_count_change_entirely() {
        // "retain their count" is the precondition — a genuine add/remove of a
        // segment is out of scope for this guard.
        let existing = stored(
            r#"[{"id":"seg-1","assetId":"asset-1"}]"#,
            r#"[{"id":"asset-1","name":"clip.mp4"}]"#,
        );
        let incoming = stored(
            r#"[{"id":"seg-1"},{"id":"seg-2"}]"#,
            r#"[{"id":"asset-1","name":"clip.mp4"}]"#,
        );
        assert!(!is_asset_reference_loss(&existing, &incoming));
    }

    #[test]
    fn unparsable_content_on_either_side_is_never_treated_as_degraded() {
        let existing = stored(
            r#"[{"id":"seg-1","assetId":"asset-1"}]"#,
            r#"[{"id":"asset-1","name":"clip.mp4"}]"#,
        );
        assert!(!is_asset_reference_loss("not json", &existing));
        assert!(!is_asset_reference_loss(&existing, "not json"));
    }

}
