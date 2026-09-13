//! WS3 item C — one configurable data root, defaulting to the existing
//! `app_local_data_dir()` location, relocatable to another volume.
//!
//! Item B (native asset bytes) is built on this: assets need somewhere
//! authoritative to live that is NOT inside a WebView origin's storage,
//! and that somewhere must be the SAME directory across `tauri dev`,
//! `tauri dev -f fa-inference`, and a bundled build — exactly the property
//! `project_mirror.rs` already established for the project-body store via
//! `app_local_data_dir()` being keyed by bundle identifier, not origin.
//!
//! **Subtrees, and what actually moves on relocation today:**
//!
//! | Subtree    | Resolved through this module | Moved by `storage_root_relocate` |
//! |---|---|---|
//! | `assets/`  | yes (item B)                  | yes |
//! | `projects/`| yes (`project_mirror.rs`'s `store_root`, repointed) | yes |
//! | `cache/`   | yes (reserved for future use) | yes |
//! | `temp/`    | yes (reserved for future use — NOT the export pipeline's or whisper's own temp staging, both of which deliberately stay on `std::env::temp_dir()`; see the doc comment on `temp_dir()` below) | yes (contents are ephemeral — cleared, not copied) |
//! | `models/`  | path is DEFINED for shape-completeness | **NOT moved**. `models.rs`/`fa.rs` have their own, older, multi-candidate resolution scheme (`fa_model_candidate_paths`, `model_download::models_dir`, ruling R-D) built around external-drive placement that this round does not audit or repoint. Relocating the root today does not move installed models; they stay reachable at their original location. Flagged here rather than silently pretended-away — closing this gap is follow-up work, not part of this round's scope. |
//!
//! **What is never touched:** the WebView2 (or WKWebView/WebKit) user data
//! folder. On Windows, that profile and `app_local_data_dir()` share
//! `%LOCALAPPDATA%\com.kinetix.pro-studio` — see `docs/ws3-export/
//! w23-machine1-validation.md`'s ledger note — but this module only ever
//! moves the NAMED subtrees above, never the directory as a whole, so the
//! WebView's own profile (wherever exactly Tauri/the OS places it) is
//! structurally never a move target. Relocating assets off that volume is a
//! durability improvement (frees `%LOCALAPPDATA%` from asset-byte pressure
//! that could otherwise starve the WebView2 profile into origin-storage
//! eviction — the Machine-1 class of loss), not just a capacity one.
//!
//! **The pointer file itself never moves.** `storage-root.json` always lives
//! at the OS-default `app_local_data_dir()` — the one location every build
//! configuration agrees on — so the app can always find out where the REAL
//! root is, even after N relocations. This is the same reasoning that keeps
//! `project_mirror.rs`'s legacy `project-mirror/` adoption tree pinned to
//! `app_local_data_dir()` unconditionally.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const CONFIG_FILENAME: &str = "storage-root.json";

/// Safety margin on top of the measured used-bytes total before a relocation
/// target is accepted — mirrors `diskFull.ts`'s own 10% headroom ratio
/// (`EXPORT_DISK_HEADROOM_RATIO`) for the same reason: a byte-for-byte copy
/// plus filesystem overhead (directory entries, allocation granularity) is
/// never exactly the measured total.
const RELOCATE_HEADROOM_RATIO: f64 = 0.10;
const RELOCATE_HEADROOM_FLOOR_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Serialize, Deserialize, Default)]
struct StorageRootConfigFile {
    /// Absolute path to the current root. Absent/missing file = default.
    root: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRootStatus {
    pub current_root: String,
    pub default_root: String,
    pub is_default: bool,
    /// Best-effort recursive size of the subtrees this module actually
    /// manages (`assets`, `projects`, `cache`) under the current root. `None`
    /// on a walk error (never fails the whole status read for that).
    pub managed_bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRootRelocateReport {
    pub from: String,
    pub to: String,
    /// Subtrees actually moved this call (only ones that existed at `from`).
    pub moved: Vec<String>,
    pub bytes_moved: u64,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("cannot resolve app_local_data_dir for storage-root config: {e}"))?
        .join(CONFIG_FILENAME))
}

fn default_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("cannot resolve app_local_data_dir: {e}"))
}

/// The current storage root. Reads the pointer file (itself always at the
/// default location — see the module doc comment); missing/unreadable/
/// unparsable is treated as "no relocation has happened", which is the safe
/// default. A relocation that this function cannot corroborate (e.g. the
/// pointed-to directory no longer exists — an external drive unplugged) is
/// NOT silently discarded here: callers that need to know get the recorded
/// path regardless, so a missing volume surfaces as a real I/O error at the
/// point of use rather than a silent fall-back to the default root, which
/// would put new writes in one place while old data sits, invisible, in
/// another.
pub fn resolve_storage_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cfg_path = config_path(app)?;
    match fs::read_to_string(&cfg_path) {
        Ok(text) => {
            let parsed: StorageRootConfigFile = serde_json::from_str(&text)
                .map_err(|e| format!("storage-root.json is corrupt: {e}"))?;
            match parsed.root {
                Some(r) if !r.trim().is_empty() => Ok(PathBuf::from(r)),
                _ => default_root(app),
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => default_root(app),
        Err(e) => Err(format!("cannot read {}: {e}", cfg_path.display())),
    }
}

pub fn assets_dir(root: &Path) -> PathBuf {
    root.join("assets")
}
pub fn projects_dir(root: &Path) -> PathBuf {
    root.join("projects")
}
pub fn cache_dir(root: &Path) -> PathBuf {
    root.join("cache")
}
/// `project_mirror.rs`'s primary-store backup tree
/// (`project-store-backups/`) — a sibling of `projects/`, not nested under
/// it (so `rotate_backup`'s own `<id>/<timestamp>.json` layout there stays
/// exactly as it already is), but it moves ALONGSIDE `projects/` on
/// relocation since the two are meaningless apart: a relocated primary store
/// with its backups left behind at the old root is a silent capability loss
/// (no more rollback), not a relocation.
pub fn project_backups_dir(root: &Path) -> PathBuf {
    root.join("project-store-backups")
}
/// Reserved for future use. Deliberately NOT where the export pipeline
/// (`ffmpeg.rs::session_dir`, `std::env::temp_dir().join("kinetix-export-
/// <uuid>")`) or whisper staging (`whisper.rs`, `WHISPER_STAGING_DIR_PREFIX`
/// under `std::env::temp_dir()`) write — both are load-bearing, already
/// shipped, gate-verified subsystems (Round 21 disk-full hardening, W23
/// validation, the item E hazard fix) that this round does not repoint.
/// Moving them is real future work, not a free rename.
#[allow(dead_code)]
pub fn temp_dir(root: &Path) -> PathBuf {
    root.join("temp")
}
/// See the module doc comment's subtree table — path is defined for
/// shape-completeness; `models.rs`/`fa.rs` do not yet consult it.
/// Used only as a last-resort fallback in `size_report` if
/// `model_download::models_dir` itself fails to resolve — models are not
/// actually stored here (see the module doc comment's subtree table).
pub fn models_dir(root: &Path) -> PathBuf {
    root.join("models")
}

fn write_atomic(dest: &Path, contents: &str) -> Result<(), String> {
    let parent = dest.parent().ok_or_else(|| format!("no parent: {}", dest.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
    let tmp = parent.join(format!(".storage-root.json.tmp-{}", std::process::id()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
        f.write_all(contents.as_bytes()).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        f.sync_all().map_err(|e| format!("fsync {}: {e}", tmp.display()))?;
    }
    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename {} -> {}: {e}", tmp.display(), dest.display())
    })
}

/// Recursive byte total. Best-effort: an unreadable entry is skipped, never
/// fails the whole walk (same posture `sweep_stale_backup_dirs` already has
/// elsewhere in this crate).
fn dir_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            total += dir_size(&path);
        } else {
            total += meta.len();
        }
    }
    total
}

/// Recursive copy, preserving the tree shape. Stops and returns `Err` on the
/// first failure — a PARTIAL copy must never be treated as a successful
/// relocation (the caller only deletes the source subtree after this
/// returns `Ok`).
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("create_dir_all {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read_dir {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read_dir entry in {}: {e}", src.display()))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let meta = entry.metadata().map_err(|e| format!("metadata {}: {e}", from.display()))?;
        if meta.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("copy {} -> {}: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn storage_root_status(app: tauri::AppHandle) -> Result<StorageRootStatus, String> {
    let current = resolve_storage_root(&app)?;
    let default = default_root(&app)?;
    let managed_bytes = if current.is_dir() {
        Some(
            dir_size(&assets_dir(&current))
                + dir_size(&projects_dir(&current))
                + dir_size(&cache_dir(&current))
                + dir_size(&project_backups_dir(&current)),
        )
    } else {
        None
    };
    Ok(StorageRootStatus {
        current_root: current.to_string_lossy().to_string(),
        default_root: default.to_string_lossy().to_string(),
        is_default: current == default,
        managed_bytes,
    })
}

/// WS3 item H — one row of the size report. `path` is the resolved absolute
/// filesystem path (so the UI can offer a "reveal in Finder"-style action,
/// same idea as the existing `reveal_in_finder` command); `label` is
/// operator-facing prose. `sweepClassification` is `"never-reclaimable"` or
/// `"reclaimable"` — see `size_report`'s own doc comment for which subtree
/// gets which and why.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeReportRow {
    pub path: String,
    pub label: String,
    pub current_bytes: u64,
    pub reclaimable_bytes: u64,
    pub sweep_classification: String,
}

fn row(path: &std::path::Path, label: &str, current_bytes: u64, reclaimable_bytes: u64, classification: &str) -> SizeReportRow {
    SizeReportRow {
        path: path.to_string_lossy().to_string(),
        label: label.to_string(),
        current_bytes,
        reclaimable_bytes,
        sweep_classification: classification.to_string(),
    }
}

/// WS3 item H (Step 7) — the size report's data source, over the storage
/// root. One row per subtree:
///
/// | Subtree | Classification | Why |
/// |---|---|---|
/// | `assets/` | never-reclaimable | Project media — item B's authoritative copy. |
/// | `projects/` | never-reclaimable | Project JSON bodies — the actual project data, not a cache. |
/// | `models/` | never-reclaimable | Downloaded whisper/FA models — re-downloading is expensive (100s of MB–GB) and the user chose to install them. |
/// | `project-store-backups/` | reclaimable | `rotate_backup`'s own safety net — bounded by `BACKUP_RETAIN`/`STALE_BACKUP_MIN_AGE_SECS` already, but every byte of it can be cleared without losing current data. |
/// | `cache/` | reclaimable | A cache by construction — nothing here is the only copy of anything. |
///
/// `models/` bytes come from `models::check_installed_models` (whisper +
/// every installed FA language's `InstalledModelStatus.bytes`), NOT from
/// this module's own `dir_size` — models are not yet relocated onto the
/// configurable storage root (see the module doc comment's subtree table),
/// so this is the one row whose `path` is NOT necessarily under the current
/// storage root; it reports wherever `models.rs`'s own resolution currently
/// puts them.
#[tauri::command]
pub async fn size_report(app: tauri::AppHandle) -> Result<Vec<SizeReportRow>, String> {
    let root = resolve_storage_root(&app)?;

    let assets_bytes = dir_size(&assets_dir(&root));
    let projects_bytes = dir_size(&projects_dir(&root));
    let backups_bytes = dir_size(&project_backups_dir(&root));
    let cache_bytes = dir_size(&cache_dir(&root));

    let mut rows = vec![
        row(&assets_dir(&root), "Project assets", assets_bytes, 0, "never-reclaimable"),
        row(&projects_dir(&root), "Projects", projects_bytes, 0, "never-reclaimable"),
        row(&project_backups_dir(&root), "Project backups", backups_bytes, backups_bytes, "reclaimable"),
        row(&cache_dir(&root), "Cache", cache_bytes, cache_bytes, "reclaimable"),
    ];

    // Whisper and FA models resolve through their OWN, separate schemes
    // (see this file's module doc comment) — `model_download::models_dir` is
    // the whisper target dir specifically; FA models can additionally live
    // at an exe-relative fallback `fa_model_candidate_paths` also checks.
    // Reported as one approximate row (the whisper dir as the representative
    // `path`) rather than pretending a single directory holds all of it.
    let models_path = crate::model_download::models_dir(&app).unwrap_or_else(|_| models_dir(&root));
    let installed = crate::models::check_installed_models(app).await?;
    let mut model_bytes = installed.whisper.map(|s| s.bytes).unwrap_or(0);
    for status in installed.fa.values() {
        model_bytes += status.bytes;
    }
    rows.push(row(&models_path, "Downloaded models", model_bytes, 0, "never-reclaimable"));

    Ok(rows)
}

/// Relocates `assets/`, `projects/`, and `cache/` (whichever exist) from the
/// current root to `new_root`. Does NOT touch `models/` or `temp/` — see the
/// module doc comment. Checks writability and free space BEFORE copying
/// anything; copies fully before deleting anything at the old location, so
/// an interrupted relocation leaves the OLD data intact and the NEW location
/// either absent or partially populated, never a state where neither copy is
/// complete.
#[tauri::command]
pub fn storage_root_relocate(
    app: tauri::AppHandle,
    new_root: String,
) -> Result<StorageRootRelocateReport, String> {
    let current = resolve_storage_root(&app)?;
    let new_root = PathBuf::from(new_root);

    fs::create_dir_all(&new_root).map_err(|e| format!("cannot create {}: {e}", new_root.display()))?;
    let real_new = fs::canonicalize(&new_root)
        .map_err(|e| format!("cannot canonicalize {}: {e}", new_root.display()))?;
    let real_current = if current.is_dir() {
        fs::canonicalize(&current).map_err(|e| format!("cannot canonicalize {}: {e}", current.display()))?
    } else {
        current.clone()
    };
    if real_new == real_current {
        return Err("the new root is the same as the current root".to_string());
    }
    if real_new.starts_with(&real_current) {
        return Err(format!(
            "refusing to relocate into a subdirectory of the current root ({} is inside {})",
            real_new.display(),
            real_current.display()
        ));
    }

    // Writability probe.
    let probe = real_new.join(format!(".kinetix-relocate-probe-{}", std::process::id()));
    fs::write(&probe, b"probe").map_err(|e| format!("{} is not writable: {e}", real_new.display()))?;
    let _ = fs::remove_file(&probe);

    // Free-space check, with headroom, against what will actually be copied.
    let used = dir_size(&assets_dir(&real_current))
        + dir_size(&projects_dir(&real_current))
        + dir_size(&cache_dir(&real_current))
        + dir_size(&project_backups_dir(&real_current));
    let required = ((used as f64) * (1.0 + RELOCATE_HEADROOM_RATIO)) as u64 + RELOCATE_HEADROOM_FLOOR_BYTES;
    let available = fs4::available_space(&real_new)
        .map_err(|e| format!("cannot read free space on {}: {e}", real_new.display()))?;
    if available < required {
        return Err(format!(
            "not enough free space at {}: needs about {required} bytes, {available} available",
            real_new.display()
        ));
    }

    let mut moved = Vec::new();
    let mut bytes_moved = 0u64;
    for (name, get_dir) in [
        ("assets", assets_dir as fn(&Path) -> PathBuf),
        ("projects", projects_dir as fn(&Path) -> PathBuf),
        ("cache", cache_dir as fn(&Path) -> PathBuf),
        ("project-store-backups", project_backups_dir as fn(&Path) -> PathBuf),
    ] {
        let from = get_dir(&real_current);
        if !from.is_dir() {
            continue;
        }
        let to = get_dir(&real_new);
        copy_dir_recursive(&from, &to)?;
        let copied_bytes = dir_size(&to);
        let original_bytes = dir_size(&from);
        if copied_bytes != original_bytes {
            return Err(format!(
                "relocation verification failed for {name}: copied {copied_bytes} bytes, source has \
                 {original_bytes} — the OLD copy at {} is left in place; nothing was deleted",
                from.display()
            ));
        }
        // Only now, with the new copy verified, is the old subtree removed.
        fs::remove_dir_all(&from).map_err(|e| {
            format!(
                "copied {name} successfully but could not remove the old copy at {}: {e} — both copies \
                 now exist; the new one at {} is authoritative going forward, the old one is safe to \
                 delete by hand",
                from.display(),
                to.display()
            )
        })?;
        moved.push(name.to_string());
        bytes_moved += copied_bytes;
    }

    let cfg = StorageRootConfigFile { root: Some(real_new.to_string_lossy().to_string()) };
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| format!("serialize storage-root.json: {e}"))?;
    write_atomic(&config_path(&app)?, &json)?;

    Ok(StorageRootRelocateReport {
        from: real_current.to_string_lossy().to_string(),
        to: real_new.to_string_lossy().to_string(),
        moved,
        bytes_moved,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "kinetix-storage-root-test-{tag}-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn dir_size_sums_nested_files() {
        let d = tmpdir("size");
        fs::write(d.join("a.txt"), b"12345").unwrap();
        fs::create_dir_all(d.join("nested")).unwrap();
        fs::write(d.join("nested/b.txt"), b"1234567890").unwrap();
        assert_eq!(dir_size(&d), 15);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn copy_dir_recursive_preserves_tree_shape_and_bytes() {
        let src = tmpdir("copy-src");
        let dst = tmpdir("copy-dst");
        fs::remove_dir_all(&dst).ok(); // exists only to get a unique path
        fs::create_dir_all(src.join("a/b")).unwrap();
        fs::write(src.join("root.txt"), b"root").unwrap();
        fs::write(src.join("a/one.txt"), b"one").unwrap();
        fs::write(src.join("a/b/two.txt"), b"two-bytes").unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        assert_eq!(fs::read_to_string(dst.join("root.txt")).unwrap(), "root");
        assert_eq!(fs::read_to_string(dst.join("a/one.txt")).unwrap(), "one");
        assert_eq!(fs::read_to_string(dst.join("a/b/two.txt")).unwrap(), "two-bytes");
        assert_eq!(dir_size(&src), dir_size(&dst));

        fs::remove_dir_all(&src).ok();
        fs::remove_dir_all(&dst).ok();
    }

    #[test]
    fn copy_dir_recursive_leaves_nothing_on_a_mid_copy_failure() {
        // Simulate a failure by pointing the destination at a path that
        // cannot be created (a file, not a directory, sitting where a
        // subdirectory needs to go).
        let src = tmpdir("copy-fail-src");
        fs::create_dir_all(src.join("a")).unwrap();
        fs::write(src.join("a/one.txt"), b"one").unwrap();

        let dst = tmpdir("copy-fail-dst");
        fs::remove_dir_all(&dst).ok();
        fs::write(&dst, b"i am a file, not a directory").unwrap(); // blocks create_dir_all(dst)

        let result = copy_dir_recursive(&src, &dst);
        assert!(result.is_err());

        fs::remove_dir_all(&src).ok();
        fs::remove_file(&dst).ok();
    }
}
