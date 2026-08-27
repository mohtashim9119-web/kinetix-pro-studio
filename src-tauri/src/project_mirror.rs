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

fn store_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("cannot resolve app_local_data_dir for the project store: {e}"))
}

fn store_project_file(root: &Path, id: &str) -> PathBuf {
    root.join("projects").join(id).join("project.json")
}

fn store_backups_dir(root: &Path) -> PathBuf {
    root.join("project-store-backups")
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
}
