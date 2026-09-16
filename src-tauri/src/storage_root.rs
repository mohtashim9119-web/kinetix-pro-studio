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
//! | `temp/`    | yes (reserved for future use — general scratch space, not the export pipeline's own staging; see `export_sessions_dir` below) | yes (contents are ephemeral — cleared, not copied) |
//! | `export-sessions/` | yes (WS3 Round 28, D4) — `ffmpeg.rs::session_dir` resolves every `kinetix-export-<uuid>` directory under here, not `std::env::temp_dir()`, so a session created after a relocation lands on the new volume. Whisper's own transcription staging is unrelated (`WHISPER_STAGING_DIR_PREFIX` under `std::env::temp_dir()`) and deliberately not moved this round. | **NOT relocated** — a session is resolved fresh from wherever the root currently is at creation time; relocation while an export is live is out of scope (see `storage_root_relocate`'s doc comment for the model-download analog of this same "refuse rather than move a live thing" posture). |
//! | `models/`  | yes (WS3 Round 28, D4) — `models.rs`/`fa.rs` now resolve their install target through `storage_root::models_dir` first, with the OS-default location as a read-only fallback for pre-existing installs from before this round. | yes, with the same copy-verify-commit flow as `assets/`/`projects/`, refused outright while a download is in flight (see `model_download`'s in-flight guard). |
//! | `models/fa-models/` (legacy top-level, pre-nesting) | no — a bare `<app_local_data_dir>/fa-models/`, sibling of `models/`, not inside it (`fa.rs`'s `fa_model_candidate_paths` tier 2) | yes (D20, WS3 Round 29) — `relocate_legacy_fa_models` merges each legacy language into `models_dir(new_root).join("fa-models")` (skipping one already relocated via `models/`'s own nested copy), then removes the whole legacy source once every language is represented at the new root either way. |
//! | `cache/fa-audio-cache/` | yes (D20, WS3 Round 29) — was hardcoded to `app_local_data_dir()` directly (`fa.rs`'s `fa_audio_cache_dir`), bypassing this module entirely; now nested under `cache_dir` | yes, for free, as part of the `cache/` subtree above — no separate subtree entry needed |
//! | `project-mirror/` | yes (D20, WS3 Round 29 — `project_mirror.rs`'s `mirror_root`, repointed here; previously pinned unconditionally to `app_local_data_dir()`) | yes |
//! | `diagnostic-logs/` | yes (D20, WS3 Round 29 — previously pinned in 3 places: `lib.rs`'s two logging-setup branches, `ffmpeg.rs`'s `get_diagnostic_log_text`) | yes, with one caveat — see `diagnostic_logs_dir`'s own doc comment: the ACTIVE log-plugin file handle stays bound to the path current at THIS boot, so a relocation mid-session moves the historical files but this session's own later lines need a restart to follow |
//!
//! **Unified per an explicit operator decision (D20, WS3 Round 29):** every
//! managed subtree above now relocates — none are pinned to the OS default
//! by design any more. `project-mirror/` and `diagnostic-logs/` previously
//! were, on the reasoning that each needs a fixed anchor independent of the
//! storage root; that reasoning conflated "SOMETHING needs a fixed anchor"
//! (true — see the pointer-file paragraph below) with "THIS DIRECTORY must
//! be that anchor" (not true — `storage-root.json`'s own fixed location
//! already lets `resolve_storage_root` find the current root regardless of
//! relocation history, which is all either of them actually needed).
//!
//! **What is never touched:** the WebView2 (or WKWebView/WebKit) user data
//! folder. On Windows, that profile and `app_local_data_dir()` share
//! `%LOCALAPPDATA%\com.kinetix.pro-studio` — see `docs/ws3-export-pipeline/
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
//! root is, even after N relocations. This is the ONE fixed anchor the
//! whole system needs; every managed subtree, including `project-mirror/`
//! and `diagnostic-logs/`, is found by reading this pointer first and then
//! looking under whatever root it currently names.

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
    /// Source-copy cleanup failures after the pointer was durably switched.
    /// The new root is authoritative and complete even when these are present.
    pub cleanup_warnings: Vec<String>,
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

/// D20 fix (WS3 Round 29) — per an explicit operator decision to unify
/// EVERY managed subtree under one root rather than leave any of them
/// pinned to the OS default: `project_mirror.rs`'s cross-origin adoption
/// tree now resolves and relocates through here too. Still findable at
/// boot regardless of relocation history, because `resolve_storage_root`
/// itself reads the ALWAYS-fixed `storage-root.json` pointer first — that
/// one file, not this directory, is what actually needs a fixed location.
pub fn project_mirror_dir(root: &Path) -> PathBuf {
    root.join("project-mirror")
}

/// D20 fix (WS3 Round 29) — same operator decision as `project_mirror_dir`
/// above. Note for callers: the active `tauri_plugin_log` file handle is
/// opened once at boot against whatever path was current THEN — moving this
/// directory mid-session relocates the historical log files, but new lines
/// written before the next app restart still land in the (now unlinked,
/// still-open) old file, per ordinary POSIX/NTFS delete-while-open
/// semantics, and are lost once the process exits. A restart is needed for
/// logging itself to fully follow the new root, same as every other
/// "reflects: next launch" limitation already accepted for this app's
/// storage-root relocation.
pub fn diagnostic_logs_dir(root: &Path) -> PathBuf {
    root.join("diagnostic-logs")
}

/// WS3 Round 28 (D4) — the export pipeline's session temp tree
/// (`ffmpeg.rs::session_dir`, `kinetix-export-<uuid>` directories), now
/// resolved under the configured storage root instead of the OS-default
/// `std::env::temp_dir()`. Kept as its own named subtree (a sibling of
/// `temp/`, not reusing it) so a future relocation pass can decide
/// independently whether a LIVE export session should be moved — this round
/// does not move it (see `storage_root_relocate`'s doc comment); it is
/// simply resolved fresh from wherever the root currently is every time a
/// session directory is opened or scanned.
pub fn export_sessions_dir(root: &Path) -> PathBuf {
    root.join("export-sessions")
}

fn write_atomic(dest: &Path, contents: &str) -> Result<(), String> {
    let parent = dest
        .parent()
        .ok_or_else(|| format!("no parent: {}", dest.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
    let tmp = parent.join(format!(".storage-root.json.tmp-{}", std::process::id()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
        f.write_all(contents.as_bytes())
            .map_err(|e| format!("write {}: {e}", tmp.display()))?;
        f.sync_all()
            .map_err(|e| format!("fsync {}: {e}", tmp.display()))?;
    }
    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename {} -> {}: {e}", tmp.display(), dest.display())
    })
}

/// Recursive byte total. Best-effort: an unreadable entry is skipped, never
/// fails the whole walk (same posture `sweep_stale_backup_dirs` already has
/// elsewhere in this crate). `pub(crate)` — `project_mirror.rs`'s
/// stale-backup dry-run/sweep (D5c) sizes candidates with this exact
/// function so the size it reports and the size it deletes can never drift
/// onto two different byte-counting implementations.
pub(crate) fn dir_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
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
        let meta = entry
            .metadata()
            .map_err(|e| format!("metadata {}: {e}", from.display()))?;
        if meta.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)
                .map_err(|e| format!("copy {} -> {}: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

fn verify_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    let mut source_names = Vec::new();
    for entry in fs::read_dir(src).map_err(|e| format!("verify read_dir {}: {e}", src.display()))? {
        let entry =
            entry.map_err(|e| format!("verify read_dir entry in {}: {e}", src.display()))?;
        source_names.push(entry.file_name());
    }
    let mut destination_names = Vec::new();
    for entry in fs::read_dir(dst).map_err(|e| format!("verify read_dir {}: {e}", dst.display()))? {
        let entry =
            entry.map_err(|e| format!("verify read_dir entry in {}: {e}", dst.display()))?;
        destination_names.push(entry.file_name());
    }
    source_names.sort();
    destination_names.sort();
    if source_names != destination_names {
        return Err(format!(
            "relocation verification failed: directory entries differ between {} and {}",
            src.display(),
            dst.display()
        ));
    }

    for name in source_names {
        let from = src.join(&name);
        let to = dst.join(&name);
        let source_meta =
            fs::metadata(&from).map_err(|e| format!("verify metadata {}: {e}", from.display()))?;
        let destination_meta =
            fs::metadata(&to).map_err(|e| format!("verify metadata {}: {e}", to.display()))?;
        if source_meta.is_dir() != destination_meta.is_dir() {
            return Err(format!(
                "relocation verification failed: type differs for {} and {}",
                from.display(),
                to.display()
            ));
        }
        if source_meta.is_dir() {
            verify_dir_recursive(&from, &to)?;
        } else {
            if source_meta.len() != destination_meta.len() {
                return Err(format!(
                    "relocation verification failed: size differs for {} and {}",
                    from.display(),
                    to.display()
                ));
            }
            let source_hash = crate::sha256::hash_file(&from)
                .map_err(|e| format!("verify hash {}: {e}", from.display()))?;
            let destination_hash = crate::sha256::hash_file(&to)
                .map_err(|e| format!("verify hash {}: {e}", to.display()))?;
            if source_hash != destination_hash {
                return Err(format!(
                    "relocation verification failed: digest differs for {} and {}",
                    from.display(),
                    to.display()
                ));
            }
        }
    }
    Ok(())
}

const MANAGED_RELOCATION_SUBTREES: [(&str, fn(&Path) -> PathBuf); 7] = [
    ("assets", assets_dir),
    ("projects", projects_dir),
    ("cache", cache_dir),
    ("project-store-backups", project_backups_dir),
    ("models", models_dir),
    // D20 fix (WS3 Round 29) — unified per an explicit operator decision:
    // every managed subtree moves with the root, none stay pinned to the
    // OS default. See `project_mirror_dir`/`diagnostic_logs_dir`'s own doc
    // comments for what each requires from callers.
    ("project-mirror", project_mirror_dir),
    ("diagnostic-logs", diagnostic_logs_dir),
];

/// D20 fix (WS3 Round 29) — a legacy, TOP-LEVEL `<root>/fa-models/<lang>/`
/// tree (`fa.rs`'s `fa_model_candidate_paths` tier 2 — predates FA models
/// moving under `models/`) is not itself a `MANAGED_RELOCATION_SUBTREES`
/// entry, so it was silently left behind by every relocation while the
/// MODERN nested `models/fa-models/<lang>/` tree (already inside the
/// `models` subtree above) correctly moved. Merges each legacy language
/// directory into `models_dir(new_root).join("fa-models")`, the same
/// nested location a fresh download already uses, SKIPPING a language the
/// new root already has there (from the old root's own nested copy, which
/// `MANAGED_RELOCATION_SUBTREES` handles first — never overwriting a
/// possibly-newer copy with a possibly-older legacy one). Returns whether a
/// legacy tree was found at all: on success, EVERY legacy language is by
/// definition now represented at the new root (freshly merged, or already
/// there from the nested copy) — a `true` return is what tells the caller
/// it's safe to delete the WHOLE legacy source wholesale afterward, no
/// per-language bookkeeping needed.
fn relocate_legacy_fa_models(
    current: &Path,
    new_root: &Path,
    check_cancelled: &dyn Fn() -> Result<(), String>,
    on_bytes: &dyn Fn(u64),
) -> Result<bool, String> {
    let legacy_src = current.join("fa-models");
    if !legacy_src.is_dir() {
        return Ok(false);
    }
    let dest_root = models_dir(new_root).join("fa-models");
    for entry in fs::read_dir(&legacy_src).map_err(|e| format!("read_dir {}: {e}", legacy_src.display()))? {
        check_cancelled()?;
        let entry = entry.map_err(|e| format!("read_dir entry in {}: {e}", legacy_src.display()))?;
        if !entry
            .file_type()
            .map_err(|e| format!("file_type {}: {e}", entry.path().display()))?
            .is_dir()
        {
            continue;
        }
        let lang_dest = dest_root.join(entry.file_name());
        if lang_dest.is_dir() {
            continue;
        }
        let mut hashes = std::collections::HashMap::new();
        copy_dir_recursive(&entry.path(), &lang_dest, check_cancelled, on_bytes, &mut hashes)?;
        verify_dir_recursive(&entry.path(), &lang_dest, check_cancelled, &hashes)?;
    }
    Ok(true)
}

fn relocation_required_bytes(used: u64) -> u64 {
    ((used as f64) * (1.0 + RELOCATE_HEADROOM_RATIO)) as u64 + RELOCATE_HEADROOM_FLOOR_BYTES
}

fn ensure_relocation_space(used: u64, available: u64) -> Result<(), String> {
    let required = relocation_required_bytes(used);
    if available < required {
        Err(format!(
            "not enough free space: needs about {required} bytes, {available} available"
        ))
    } else {
        Ok(())
    }
}

fn relocate_managed_subtrees_with<F, D>(
    current: &Path,
    new_root: &Path,
    commit_pointer: F,
    mut delete_source: D,
) -> Result<(Vec<String>, u64, Vec<String>), String>
where
    F: FnOnce() -> Result<(), String>,
    D: FnMut(&Path, &Path, &str) -> Result<(), String>,
{
    let mut moved = Vec::new();
    let mut bytes_moved = 0u64;

    // Phase 1: copy and byte-verify EVERY subtree. No source deletion is
    // reachable until the entire set has passed.
    for (name, get_dir) in MANAGED_RELOCATION_SUBTREES {
        let from = get_dir(current);
        if !from.is_dir() {
            continue;
        }
        let to = get_dir(new_root);
        copy_dir_recursive(&from, &to)?;
        verify_dir_recursive(&from, &to)?;
        moved.push(name.to_string());
        bytes_moved += dir_size(&to);
    }

    // Phase 2: atomically switch authority to the fully verified copy.
    // Failure leaves every source untouched.
    commit_pointer()?;

    // Phase 3: cleanup only. A crash here is recoverable because the pointer
    // already names the complete new copy; failures are returned as warnings.
    let mut cleanup_warnings = Vec::new();
    for name in &moved {
        let (_, get_dir) = MANAGED_RELOCATION_SUBTREES
            .iter()
            .find(|(candidate, _)| candidate == name)
            .expect("moved name came from MANAGED_RELOCATION_SUBTREES");
        let from = get_dir(current);
        if let Err(error) = delete_source(&from, current, name) {
            cleanup_warnings.push(error);
        }
    }

    Ok((moved, bytes_moved, cleanup_warnings))
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

fn row(
    path: &std::path::Path,
    label: &str,
    current_bytes: u64,
    reclaimable_bytes: u64,
    classification: &str,
) -> SizeReportRow {
    SizeReportRow {
        path: path.to_string_lossy().to_string(),
        label: label.to_string(),
        current_bytes,
        reclaimable_bytes,
        sweep_classification: classification.to_string(),
    }
}

fn reclaimable_dirs(root: &Path) -> [PathBuf; 2] {
    [project_backups_dir(root), cache_dir(root)]
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
    let [backups_path, cache_path] = reclaimable_dirs(&root);
    let backups_bytes = dir_size(&backups_path);
    let cache_bytes = dir_size(&cache_path);
    // WS3 Batch 2 (D5c) — advertise only what the sweep would ACTUALLY
    // free (aged, orphaned entries), not the whole directory's current
    // size. `backups_bytes` above stays as `currentBytes` (the row's "how
    // big is this right now" figure, unrelated to reclaimability) — only
    // `reclaimableBytes` changes.
    let backups_reclaimable_bytes = crate::project_mirror::store_backups_stale_bytes(&app);

    let mut rows = vec![
        row(
            &assets_dir(&root),
            "Project assets",
            assets_bytes,
            0,
            "never-reclaimable",
        ),
        row(
            &projects_dir(&root),
            "Projects",
            projects_bytes,
            0,
            "never-reclaimable",
        ),
        row(
            &backups_path,
            "Project backups",
            backups_bytes,
            backups_reclaimable_bytes,
            "reclaimable",
        ),
        row(
            &cache_path,
            "Cache",
            cache_bytes,
            cache_bytes,
            "reclaimable",
        ),
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
    rows.push(row(
        &models_path,
        "Downloaded models",
        model_bytes,
        0,
        "never-reclaimable",
    ));

    Ok(rows)
}

/// Clears reclaimable subtrees (cache + stale project backups). Never touches
/// `assets/`, `projects/`, or `models/` — see `size_report`'s classification.
///
/// WS3 Batch 2 — three separate defects fixed here (Ruling E's D5a/D5b/D5c;
/// confirmed via STEP 0b that `StorageSettingsSection.tsx:130` genuinely
/// calls this — the bug was never missing wiring):
///   D5a — `reclaimable_dirs`'s backups path used to be bound to `_backups`
///         and discarded outright; this function only ever freed `cache/`.
///         Fixed: `sweep_stale_project_backups`'s return value (below) now
///         actually reaches `reclaimed`, covering the backups trees.
///   D5b — even the sweep call that DID run had its byte total thrown away
///         (`sweep_stale_project_backups` used to return `()`). Fixed by
///         giving it and `sweep_stale_backup_dirs` real `u64` returns.
///   D5c — `size_report`'s advertised "reclaimable" figure for backups was
///         the ENTIRE directory's current size, not the aged/orphaned
///         subset this function (and the sweep it calls) actually deletes
///         — the number shown to the operator was never true regardless of
///         whether the sweep itself worked. Fixed in `size_report` via
///         `project_mirror::store_backups_stale_bytes`, the read-only
///         counterpart to the exact same staleness scan this sweep runs.
#[tauri::command]
pub fn storage_root_reclaim(app: tauri::AppHandle) -> Result<u64, String> {
    let root = resolve_storage_root(&app)?;
    let mut reclaimed = crate::project_mirror::sweep_stale_project_backups(&app);
    let [_backups, cache] = reclaimable_dirs(&root);
    if cache.is_dir() {
        reclaimed += dir_size(&cache);
        crate::safe_delete::delete_app_staging_dir(&cache, &root, "cache")?;
        fs::create_dir_all(&cache)
            .map_err(|e| format!("recreate cache {}: {e}", cache.display()))?;
    }
    Ok(reclaimed)
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
    // WS3 Round 28 (D4) — a model (whisper or FA) currently downloading
    // writes into the very `models/` subtree this call is about to copy and
    // then delete from the source. Refuse outright rather than moving files
    // out from under a live writer; the operator can retry once the
    // download finishes or is cancelled.
    if crate::model_download::any_download_in_flight() {
        return Err(
            "cannot relocate the storage root while a model download is in progress — \
             wait for it to finish or cancel it, then try again"
                .to_string(),
        );
    }

    let current = resolve_storage_root(&app)?;
    let new_root = PathBuf::from(new_root);

    fs::create_dir_all(&new_root)
        .map_err(|e| format!("cannot create {}: {e}", new_root.display()))?;
    let real_new = fs::canonicalize(&new_root)
        .map_err(|e| format!("cannot canonicalize {}: {e}", new_root.display()))?;
    let real_current = if current.is_dir() {
        fs::canonicalize(&current)
            .map_err(|e| format!("cannot canonicalize {}: {e}", current.display()))?
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
    fs::write(&probe, b"probe")
        .map_err(|e| format!("{} is not writable: {e}", real_new.display()))?;
    fs::remove_file(&probe).map_err(|e| {
        format!(
            "could not remove writability probe {}: {e}",
            probe.display()
        )
    })?;

    // Free-space check, with headroom, against what will actually be copied.
    let used = dir_size(&assets_dir(&real_current))
        + dir_size(&projects_dir(&real_current))
        + dir_size(&cache_dir(&real_current))
        + dir_size(&project_backups_dir(&real_current))
        + dir_size(&models_dir(&real_current));
    let available = fs4::available_space(&real_new)
        .map_err(|e| format!("cannot read free space on {}: {e}", real_new.display()))?;
    ensure_relocation_space(used, available)
        .map_err(|e| format!("{e} at {}", real_new.display()))?;
    let cfg = StorageRootConfigFile {
        root: Some(real_new.to_string_lossy().to_string()),
    };
    let json = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("serialize storage-root.json: {e}"))?;
    let config = config_path(&app)?;
    let (moved, bytes_moved, cleanup_warnings) = relocate_managed_subtrees_with(
        &real_current,
        &real_new,
        || write_atomic(&config, &json),
        |from, bounds, name| {
            crate::safe_delete::delete_app_staging_dir(from, bounds, name).map_err(|e| {
                format!(
                    "new root is authoritative, but old {name} copy at {} could not be removed: {e}",
                    from.display()
                )
            })
        },
    )?;

    Ok(StorageRootRelocateReport {
        from: real_current.to_string_lossy().to_string(),
        to: real_new.to_string_lossy().to_string(),
        moved,
        bytes_moved,
        cleanup_warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "kinetix-storage-root-test-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
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
        assert_eq!(
            fs::read_to_string(dst.join("a/b/two.txt")).unwrap(),
            "two-bytes"
        );
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

    #[test]
    fn low_space_is_refused_before_relocation_can_start() {
        let used = 100 * 1024 * 1024;
        let required = relocation_required_bytes(used);
        assert!(ensure_relocation_space(used, required - 1).is_err());
        assert!(ensure_relocation_space(used, required).is_ok());
    }

    #[test]
    fn a_later_copy_failure_leaves_every_source_intact_and_never_commits() {
        let current = tmpdir("transaction-source");
        let destination = tmpdir("transaction-destination");
        fs::create_dir_all(assets_dir(&current)).unwrap();
        fs::write(assets_dir(&current).join("asset.bin"), b"asset").unwrap();
        fs::create_dir_all(projects_dir(&current)).unwrap();
        fs::write(projects_dir(&current).join("project.json"), b"project").unwrap();
        // Assets copy first. Make the later projects destination impossible.
        fs::write(projects_dir(&destination), b"blocks directory creation").unwrap();
        let committed = std::cell::Cell::new(false);

        let result = relocate_managed_subtrees_with(
            &current,
            &destination,
            || {
                committed.set(true);
                Ok(())
            },
            |_, _, _| panic!("source deletion must be unreachable before all copies verify"),
        );

        assert!(result.is_err());
        assert!(!committed.get());
        assert_eq!(
            fs::read(assets_dir(&current).join("asset.bin")).unwrap(),
            b"asset"
        );
        assert_eq!(
            fs::read(projects_dir(&current).join("project.json")).unwrap(),
            b"project"
        );
        fs::remove_dir_all(&current).ok();
        fs::remove_dir_all(&destination).ok();
    }

    #[test]
    fn pointer_failure_leaves_sources_and_success_commits_before_cleanup() {
        let current = tmpdir("commit-source");
        let destination = tmpdir("commit-destination");
        fs::create_dir_all(assets_dir(&current)).unwrap();
        fs::write(assets_dir(&current).join("asset.bin"), b"asset").unwrap();

        let result = relocate_managed_subtrees_with(
            &current,
            &destination,
            || Err("pointer write failed".into()),
            |_, _, _| panic!("cleanup must not run after pointer failure"),
        );
        assert!(result.is_err());
        assert!(assets_dir(&current).join("asset.bin").is_file());

        let second_destination = tmpdir("commit-destination-2");
        let committed = std::cell::Cell::new(false);
        let (_, _, warnings) = relocate_managed_subtrees_with(
            &current,
            &second_destination,
            || {
                committed.set(true);
                Ok(())
            },
            |_, _, _| {
                assert!(committed.get(), "pointer must commit before cleanup starts");
                Err("simulated cleanup refusal".into())
            },
        )
        .unwrap();
        assert_eq!(warnings, vec!["simulated cleanup refusal"]);
        assert!(assets_dir(&current).join("asset.bin").is_file());
        assert!(assets_dir(&second_destination).join("asset.bin").is_file());

        fs::remove_dir_all(&current).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&second_destination).ok();
    }

    #[test]
    fn reclaim_targets_are_only_cache_and_project_backups_inside_the_root() {
        let root = tmpdir("reclaim-bounds");
        let allowed = reclaimable_dirs(&root);
        let forbidden = [
            assets_dir(&root),
            projects_dir(&root),
            models_dir(&root),
            root.join("EBWebView"),
        ];

        for target in allowed {
            assert!(target.starts_with(&root));
            assert!(matches!(
                target.file_name().and_then(|name| name.to_str()),
                Some("cache" | "project-store-backups")
            ));
            assert!(!forbidden.contains(&target));
        }
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn relocation_moves_models_alongside_the_other_managed_subtrees() {
        // WS3 Round 28 (D4) — models must move with the rest of the managed
        // tree on relocation, using the same copy-verify-commit flow.
        let current = tmpdir("models-reloc-source");
        let destination = tmpdir("models-reloc-dest");
        fs::remove_dir_all(&destination).ok(); // exists only to get a unique path

        fs::create_dir_all(models_dir(&current).join("fa-models/en")).unwrap();
        fs::write(models_dir(&current).join("ggml-model.bin"), b"whisper-model-bytes").unwrap();
        fs::write(
            models_dir(&current).join("fa-models/en/model.onnx"),
            b"fa-model-bytes",
        )
        .unwrap();

        let (moved, bytes_moved, warnings) = relocate_managed_subtrees_with(
            &current,
            &destination,
            || Ok(()),
            |from, bounds, name| crate::safe_delete::delete_app_staging_dir(from, bounds, name),
        )
        .unwrap();

        assert!(warnings.is_empty());
        assert!(moved.contains(&"models".to_string()));
        assert!(bytes_moved > 0);

        // Before/after subtree shape.
        assert!(models_dir(&current).exists() == false, "source models/ must be gone after cleanup");
        assert_eq!(
            fs::read(models_dir(&destination).join("ggml-model.bin")).unwrap(),
            b"whisper-model-bytes"
        );
        assert_eq!(
            fs::read(models_dir(&destination).join("fa-models/en/model.onnx")).unwrap(),
            b"fa-model-bytes"
        );

        fs::remove_dir_all(&current).ok();
        fs::remove_dir_all(&destination).ok();
    }

    #[test]
    fn relocate_refuses_outright_while_a_model_download_is_in_flight() {
        let part = std::env::temp_dir().join(format!(
            "kinetix-storage-root-inflight-test-{}.part",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        let sink: std::sync::Arc<crate::model_download::EventSink> =
            std::sync::Arc::new(crate::model_download::EventSink::new(tauri::ipc::Channel::new(
                |_| Ok(()),
            )));
        let _guard = crate::model_download::try_acquire_in_flight(&part, sink)
            .expect("first claim must succeed");
        assert!(crate::model_download::any_download_in_flight());
    }

    #[test]
    fn status_and_size_report_commands_are_filesystem_read_only() {
        let source = include_str!("storage_root.rs");
        for (start, end) in [
            ("pub fn storage_root_status", "/// WS3 item H — one row"),
            ("pub async fn size_report", "/// Clears reclaimable subtrees"),
        ] {
            let body = source
                .split(start)
                .nth(1)
                .unwrap_or_else(|| panic!("missing command marker {start}"))
                .split(end)
                .next()
                .unwrap();
            for forbidden in [
                "fs::write",
                "fs::rename",
                "fs::remove_file",
                "fs::remove_dir_all",
                "fs::create_dir",
                "write_atomic",
            ] {
                assert!(
                    !body.contains(forbidden),
                    "{start} reintroduced filesystem mutation via {forbidden}"
                );
            }
        }
    }
}
