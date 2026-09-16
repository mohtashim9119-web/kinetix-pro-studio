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
    /// Stale-root fix (WS3 Round 29, operator decision) — EVERY location
    /// this app knows still holds a full or partial, un-deleted copy of
    /// managed data: an old root a successful relocation moved away from,
    /// AND/OR a target a failed/cancelled relocation was copying into.
    /// Relocation never auto-deletes either kind (previously immediate,
    /// silent deletion the instant the new copy verified, or the instant a
    /// copy failed) — accumulates across as many hops as the operator makes
    /// (moving A -> B -> C without cleaning up in between leaves BOTH A and
    /// B listed, not just the most recent one) until cleaned up. A single
    /// `storage_root_cleanup_all_stale_roots` call always clears every
    /// entry in one action — there is deliberately no per-entry cleanup
    /// command, per an explicit operator decision that this should be one
    /// button, not N. A partial-target entry is ALSO what
    /// `copy_dir_recursive`'s resume logic reads to decide whether a new
    /// relocation to that same folder can resume instead of restarting.
    /// Was two separate fields (`previous_root: Option<String>`,
    /// `abandoned_targets: Vec<String>`) before this; unified because the
    /// split was itself the bug an operator caught — moving A -> B -> C
    /// only ever remembered the LATEST old root, silently losing track of
    /// earlier ones. `#[serde(default)]` so an existing config file from
    /// before this field existed (under either old name) parses as empty,
    /// not a hard error.
    #[serde(default)]
    stale_roots: Vec<String>,
    /// Migration-only (WS3 Round 29) — the pre-unification field names.
    /// Never written by this version; only read, once, by `read_config`'s
    /// migration step, so an existing config file's already-tracked stale
    /// entries survive the rename instead of silently vanishing the first
    /// time it's read under the new schema.
    #[serde(default, rename = "previous_root", skip_serializing)]
    legacy_previous_root: Option<String>,
    #[serde(default, rename = "abandoned_targets", skip_serializing)]
    legacy_abandoned_targets: Vec<String>,
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


/// Stale-root fix (WS3 Round 29) — reads the full config (both stale-root
/// fields at once) rather than duplicating `resolve_storage_root`'s own
/// read/parse/default logic a second time.
/// Migration (WS3 Round 29) — an existing config file predating the
/// `previous_root`/`abandoned_targets` -> `stale_roots` unification still
/// has its data under the old names; fold it in once, here, so it's never
/// silently lost. `stale_roots` only stays empty post-migration if there
/// was genuinely nothing stale recorded under either old name. Extracted as
/// its own function (from `read_config`, which needs an `AppHandle` only to
/// resolve the file path) purely so the migration logic itself — the part
/// that actually has behavior worth locking down — is unit-testable without
/// a Tauri runtime.
fn migrate_legacy_stale_roots(cfg: &mut StorageRootConfigFile) {
    if let Some(previous) = cfg.legacy_previous_root.take() {
        if !previous.trim().is_empty() && !cfg.stale_roots.iter().any(|p| p == &previous) {
            cfg.stale_roots.push(previous);
        }
    }
    for target in std::mem::take(&mut cfg.legacy_abandoned_targets) {
        if !cfg.stale_roots.iter().any(|p| p == &target) {
            cfg.stale_roots.push(target);
        }
    }
}

fn read_config(app: &tauri::AppHandle) -> Result<StorageRootConfigFile, String> {
    let cfg_path = config_path(app)?;
    let mut cfg: StorageRootConfigFile = match fs::read_to_string(&cfg_path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("storage-root.json is corrupt: {e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => StorageRootConfigFile::default(),
        Err(e) => return Err(format!("cannot read {}: {e}", cfg_path.display())),
    };
    migrate_legacy_stale_roots(&mut cfg);
    Ok(cfg)
}

fn write_config(app: &tauri::AppHandle, cfg: &StorageRootConfigFile) -> Result<(), String> {
    let cfg_path = config_path(app)?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| format!("serialize storage-root.json: {e}"))?;
    write_atomic(&cfg_path, &json)
}

/// Resume/no-auto-delete fix (WS3 Round 29, operator decision) — records
/// `target` as a stale location after a failure/cancel, so a later
/// relocation to the same folder can resume from it (`copy_dir_recursive`'s
/// size-match skip) and/or Settings can offer it for manual cleanup.
/// Accumulates: does NOT overwrite any earlier stale entry (see
/// `StorageRootConfigFile::stale_roots`'s own doc comment for why that
/// matters — moving A -> B -> C without cleaning up must remember BOTH A
/// and B). A no-op if already recorded (dedup) or if `target` IS the
/// current root (impossible in practice — a relocation refuses
/// same-as-current before copying starts — but never worth recording
/// regardless).
fn record_stale_root(app: &tauri::AppHandle, target: &Path) -> Result<(), String> {
    let mut cfg = read_config(app)?;
    let target_str = target.to_string_lossy().to_string();
    if cfg.root.as_deref() == Some(target_str.as_str()) {
        return Ok(());
    }
    if !cfg.stale_roots.iter().any(|t| t == &target_str) {
        cfg.stale_roots.push(target_str);
    }
    write_config(app, &cfg)
}

/// Best-effort total across every managed subtree PLUS the legacy top-level
/// `fa-models/` (see `relocate_legacy_fa_models`) at `root` — the same set
/// `storage_root_cleanup_all_stale_roots` actually removes, so the number
/// the operator sees before clicking cleanup is exactly what cleanup will
/// free.
fn stale_root_bytes(root: &Path) -> u64 {
    let mut bytes = 0u64;
    for (_, get_dir) in MANAGED_RELOCATION_SUBTREES {
        bytes += dir_size(&get_dir(root));
    }
    bytes += dir_size(&root.join("fa-models"));
    bytes
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleRootInfo {
    pub path: String,
    pub bytes: u64,
}

/// Stale-root fix (WS3 Round 29, operator decision) — relocation no longer
/// auto-deletes ANY leftover copy: not an old root after a successful move
/// (previously immediate, silent deletion right after the new copy
/// verified), and not a partial target after a failed/cancelled one
/// (previously immediate, silent deletion in the same breath as the
/// failure). This is the read side Settings polls to list every such
/// leftover this app knows about, accumulated across as many hops as the
/// operator makes. A recorded path that no longer exists on disk (the
/// operator already dealt with it some other way — deleted it in Finder, or
/// it was on since-unmounted removable media) is silently dropped from the
/// list, never reported as an error.
#[tauri::command]
pub fn storage_root_stale_roots(app: tauri::AppHandle) -> Result<Vec<StaleRootInfo>, String> {
    let cfg = read_config(&app)?;
    Ok(cfg
        .stale_roots
        .into_iter()
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .map(|p| StaleRootInfo {
            bytes: stale_root_bytes(&p),
            path: p.to_string_lossy().to_string(),
        })
        .collect())
}

/// Stale-root fix (WS3 Round 29, operator decision) — ONE action that
/// cleans up EVERY stale location this app knows about in one go
/// (deliberately not per-entry — an operator explicitly asked for "one
/// cleanup deletes everything" rather than a button per leftover folder).
/// Removes every managed subtree (and the legacy `fa-models/`) found at
/// each recorded path, via the same audited
/// `safe_delete::delete_app_staging_dir` every other cleanup in this module
/// uses — no raw recursive deletes. Clears the WHOLE list afterward
/// REGARDLESS of whether every deletion at every path succeeded: a stuck
/// stale-root list the operator can never dismiss (e.g. because one subtree
/// is momentarily locked by another process) would be a worse outcome than
/// occasionally under-reporting a leftover file the operator can still find
/// and remove by hand — this mirrors every other Phase-3-style cleanup in
/// this module, which is already best-effort by design. Silently skips (but
/// still drops from the list) any recorded path that happens to BE the
/// current root — that can only mean stale bookkeeping the caller shouldn't
/// trust anyway, never a reason to fail the whole cleanup.
///
/// Windows-audit fix (WS3 Round 29 Phase 2) — `diagnostic-logs` is skipped
/// here, unlike every other managed subtree. The app's log-file handle
/// stays bound to whatever root was current AT BOOT (see `lib.rs`'s setup
/// block); if the operator relocates and then cleans up stale roots in the
/// SAME session (no restart since the relocation), the stale root's
/// `diagnostic-logs/kinetix-diagnostic.log` is still open by this very
/// process. Deleting an open file works on macOS/Linux (unlink-while-open),
/// but Windows' default file-sharing mode refuses it outright — so
/// `remove_dir_all` on that one subtree would return `Err` here anyway,
/// just silently (the loop below discards it with `let _ =`, and this
/// function unconditionally clears `stale_roots` regardless), leaving an
/// orphaned, untracked leftover directory on disk with no way for the
/// operator to know it's still there. Rather than let that happen invisibly
/// on Windows only, `diagnostic-logs` is left out of the delete set
/// everywhere: a small, diagnostic-only leftover the operator can find and
/// remove by hand (the stale root's path is still shown in Settings before
/// cleanup runs) is a better outcome than a silent per-platform gap. The
/// chosen fix is exclusion, not close-and-reopen-the-handle-around-cleanup:
/// `tauri_plugin_log` doesn't expose a way to do that safely, and closing
/// the app's own active logger mid-session risks losing log lines emitted
/// during the very cleanup operation being logged.
/// The actual per-target delete loop, extracted from
/// `storage_root_cleanup_all_stale_roots` so it's unit-testable without an
/// `AppHandle` — the command itself only needs one to resolve `current`
/// (to skip a target that IS the live root) and to read/write the config
/// file; the deletion behavior itself takes a plain path.
fn cleanup_stale_root_subtrees(target: &Path) -> u64 {
    let mut reclaimed = 0u64;
    for (name, get_dir) in MANAGED_RELOCATION_SUBTREES {
        if name == "diagnostic-logs" {
            continue;
        }
        let dir = get_dir(target);
        if dir.is_dir() {
            let size = dir_size(&dir);
            if crate::safe_delete::delete_app_staging_dir(&dir, target, name).is_ok() {
                reclaimed += size;
            }
        }
    }
    let legacy_fa = target.join("fa-models");
    if legacy_fa.is_dir() {
        let size = dir_size(&legacy_fa);
        if crate::safe_delete::delete_app_staging_dir(&legacy_fa, target, "fa-models").is_ok() {
            reclaimed += size;
        }
    }
    reclaimed
}

#[tauri::command]
pub fn storage_root_cleanup_all_stale_roots(app: tauri::AppHandle) -> Result<u64, String> {
    let current = resolve_storage_root(&app)?;
    let cfg = read_config(&app)?;
    let mut reclaimed = 0u64;
    for path in &cfg.stale_roots {
        let target = PathBuf::from(path);
        if target == current || !target.is_dir() {
            continue;
        }
        reclaimed += cleanup_stale_root_subtrees(&target);
    }
    let mut cfg = cfg;
    cfg.stale_roots.clear();
    write_config(&app, &cfg)?;
    Ok(reclaimed)
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

/// A no-op cancellation check — used by callers (and every existing test)
/// that don't offer the operator a way to cancel mid-copy.
#[cfg_attr(not(test), allow(dead_code))]
fn never_cancelled() -> Result<(), String> {
    Ok(())
}

/// Streams `from` -> `to` in fixed chunks, hashing the SOURCE bytes as they
/// pass through (one read of `from`, not two) rather than `fs::copy` followed
/// by a separate full re-read of `from` for verification. Returns the source
/// digest so `verify_dir_recursive` only has to read `to` — catching genuine
/// write-time corruption — instead of re-reading BOTH sides. D17/D18 fix
/// (WS3 Round 29): this is the copy's dominant cost (every byte relocated
/// used to be read three times — once to copy, once to hash each side —
/// this cuts it to two), and each chunk is also the natural point to report
/// live progress, which `copy_dir_recursive` below does via `on_bytes`.
fn copy_file_with_hash(
    from: &Path,
    to: &Path,
    on_bytes: &dyn Fn(u64),
) -> Result<String, String> {
    use std::io::{Read, Write};
    let mut src_file = fs::File::open(from).map_err(|e| format!("open {}: {e}", from.display()))?;
    let mut dst_file =
        fs::File::create(to).map_err(|e| format!("create {}: {e}", to.display()))?;
    let mut hasher = crc32fast::Hasher::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = src_file
            .read(&mut buf)
            .map_err(|e| format!("read {}: {e}", from.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        dst_file
            .write_all(&buf[..n])
            .map_err(|e| format!("write {}: {e}", to.display()))?;
        on_bytes(n as u64);
    }
    Ok(format!("{:08x}", hasher.finalize()))
}

/// D-copy-speed fix (WS3 Round 29) — see `Cargo.toml`'s `crc32fast` entry
/// for why this is CRC32, not a cryptographic hash: this only ever verifies
/// our OWN just-written copy against accidental corruption, never a
/// malicious adversary, and the CPU generation this was measured against
/// has no SHA hardware extensions at all (though it does have the
/// SSE4.2/PCLMULQDQ CRC32 instructions `crc32fast` auto-detects and uses).
/// Used on this module's own hot path (destination verification, and the
/// legacy-fa-models merge's fallback source hash).
fn hash_file(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut file = fs::File::open(path).map_err(|e| format!("hash {}: {e}", path.display()))?;
    let mut hasher = crc32fast::Hasher::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("hash {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:08x}", hasher.finalize()))
}

/// Recursive copy, preserving the tree shape. Stops and returns `Err` on the
/// first failure — a PARTIAL copy must never be treated as a successful
/// relocation (the caller only deletes the source subtree after this
/// returns `Ok`).
///
/// D15 fix (WS3 Round 29) — `check_cancelled` is polled once per directory
/// entry (not just once per subtree), so an operator's Cancel click during a
/// large subtree (e.g. `assets/`, easily hundreds of files) takes effect
/// within one file rather than only at the next subtree boundary. Callers
/// with nothing to cancel pass `&never_cancelled`.
///
/// D17/D18 fix (WS3 Round 29) — `on_bytes` reports live progress as each
/// file streams through `copy_file_with_hash`, and `source_hashes` collects
/// that file's digest (keyed by its DESTINATION path) so `verify_dir_recursive`
/// never has to re-read the source side at all.
/// D-DS_Store fix (WS3 Round 29) — Finder rewrites `.DS_Store` on its own
/// schedule, entirely outside this app's control, purely to cache icon
/// positions/view state — never real project data. Excluding it (never
/// copied, never verified) sidesteps a real hazard the resume-skip logic
/// above surfaced: a `.DS_Store` left at the destination by an earlier
/// aborted attempt can match the CURRENT source file's size while Finder
/// has since rewritten its content, which the resume skip (correctly, by
/// design) cannot tell apart from a genuinely-already-copied file — and
/// verification (also correctly) then refuses to commit over a real digest
/// mismatch, failing the whole relocation over a file that was never
/// supposed to be meaningful in the first place. `.DS_Store` is safe to
/// simply not carry across at all — Finder recreates it on demand at the
/// new location the next time it's browsed.
///
/// D-diagnostic-log fix (WS3 Round 29) — `kinetix-diagnostic.log` is the
/// app's own live log file: this very process keeps an open file handle on
/// it and appends to it for as long as the app runs, INCLUDING while a
/// relocation copies and verifies it. Its size at copy time and its size at
/// verify time are therefore never guaranteed to match — every relocation
/// log line the copy/verify pass itself emits grows the source file out
/// from under its own snapshot. Copying a live, growing file byte-for-byte
/// isn't safely verifiable at all, so it's excluded the same way
/// `.DS_Store` is: never copied, never verified. Nothing meaningful is
/// lost — the log is diagnostic-only, and `tauri_plugin_log` creates a
/// fresh file at the new root the next time the app launches.
///
/// Windows-audit fix (WS3 Round 29 Phase 2) — `Thumbs.db` (Explorer's
/// per-folder thumbnail cache) and `desktop.ini` (folder customization
/// metadata: custom icon, localized display name) are Explorer's equivalent
/// of `.DS_Store` — written independently of this app, on Explorer's own
/// schedule, whenever a folder is browsed. Left unexcluded, a leftover copy
/// from an earlier aborted relocation attempt can match the CURRENT source
/// file's size (the resume-skip heuristic in `copy_dir_recursive` can't
/// tell that apart from a genuinely-already-copied file) while Explorer has
/// since rewritten its content — the exact same false verify-mismatch class
/// `.DS_Store` was excluded to prevent. Comparison is case-insensitive
/// (`eq_ignore_ascii_case`) because Windows filenames are case-insensitive
/// regardless of what case Explorer happens to have written.
fn is_ignored_entry(name: &std::ffi::OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    name.eq_ignore_ascii_case(".DS_Store")
        || name.eq_ignore_ascii_case("kinetix-diagnostic.log")
        || name.eq_ignore_ascii_case("Thumbs.db")
        || name.eq_ignore_ascii_case("desktop.ini")
}

fn copy_dir_recursive(
    src: &Path,
    dst: &Path,
    check_cancelled: &dyn Fn() -> Result<(), String>,
    on_bytes: &dyn Fn(u64),
    source_hashes: &mut std::collections::HashMap<PathBuf, String>,
) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("create_dir_all {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read_dir {}: {e}", src.display()))? {
        check_cancelled()?;
        let entry = entry.map_err(|e| format!("read_dir entry in {}: {e}", src.display()))?;
        if is_ignored_entry(&entry.file_name()) {
            continue;
        }
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let meta = entry
            .metadata()
            .map_err(|e| format!("metadata {}: {e}", from.display()))?;
        if meta.is_dir() {
            copy_dir_recursive(&from, &to, check_cancelled, on_bytes, source_hashes)?;
        } else {
            // Resume fix (WS3 Round 29, operator decision) — `to` may
            // already hold a complete copy of this exact file, left behind
            // by an earlier attempt that failed or was cancelled partway
            // through THIS SAME subtree (see `do_relocate`'s
            // `record_stale_root` and the no-auto-delete change that
            // makes this possible). A size match is treated as "already
            // copied" and skipped outright — cheap (one `fs::metadata`,
            // no read of either side) — rather than re-copying and
            // re-hashing bytes that are already there. `on_bytes` still
            // counts them toward progress, so the bar reflects real
            // remaining work, not a mysterious jump. `verify_dir_recursive`
            // never sees `to` in `source_hashes` for a skipped file, so its
            // existing "hash `from` fresh" fallback (see that function's
            // own comment) is what actually confirms this skip was safe —
            // a size match that turns out to be a false positive (rare, but
            // not impossible: same size, different bytes) still fails
            // verification and the whole relocation still refuses to
            // commit, exactly as if this file had been freshly copied and
            // failed to verify.
            let already_copied = fs::metadata(&to).map(|m| m.len() == meta.len()).unwrap_or(false);
            if already_copied {
                on_bytes(meta.len());
            } else {
                let hash = copy_file_with_hash(&from, &to, on_bytes)?;
                source_hashes.insert(to, hash);
            }
        }
    }
    Ok(())
}

fn verify_dir_recursive(
    src: &Path,
    dst: &Path,
    check_cancelled: &dyn Fn() -> Result<(), String>,
    source_hashes: &std::collections::HashMap<PathBuf, String>,
) -> Result<(), String> {
    check_cancelled()?;
    let mut source_names = Vec::new();
    for entry in fs::read_dir(src).map_err(|e| format!("verify read_dir {}: {e}", src.display()))? {
        let entry =
            entry.map_err(|e| format!("verify read_dir entry in {}: {e}", src.display()))?;
        if is_ignored_entry(&entry.file_name()) {
            continue;
        }
        source_names.push(entry.file_name());
    }
    let mut destination_names = Vec::new();
    for entry in fs::read_dir(dst).map_err(|e| format!("verify read_dir {}: {e}", dst.display()))? {
        let entry =
            entry.map_err(|e| format!("verify read_dir entry in {}: {e}", dst.display()))?;
        if is_ignored_entry(&entry.file_name()) {
            continue;
        }
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
            verify_dir_recursive(&from, &to, check_cancelled, source_hashes)?;
        } else {
            check_cancelled()?;
            if source_meta.len() != destination_meta.len() {
                return Err(format!(
                    "relocation verification failed: size differs for {} and {}",
                    from.display(),
                    to.display()
                ));
            }
            // The digest `copy_dir_recursive` already computed while
            // streaming this exact file — falls back to a fresh read of
            // `from` only if that map is somehow missing an entry (never
            // expected outside a test calling this function directly).
            let source_hash = match source_hashes.get(&to) {
                Some(hash) => hash.clone(),
                None => hash_file(&from)?,
            };
            let destination_hash = hash_file(&to)?;
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

#[cfg_attr(not(test), allow(dead_code))]
fn relocate_managed_subtrees_with<F, D>(
    current: &Path,
    new_root: &Path,
    commit_pointer: F,
    delete_source: D,
) -> Result<(Vec<String>, u64, Vec<String>), String>
where
    F: FnOnce() -> Result<(), String>,
    D: FnMut(&Path, &Path, &str) -> Result<(), String>,
{
    relocate_managed_subtrees_cancellable(
        current,
        new_root,
        commit_pointer,
        delete_source,
        &never_cancelled,
        &|_| {},
        &|| {},
    )
}

/// D15/D18 fix (WS3 Round 29) — the cancellable, progress-reporting variant
/// `storage_root_relocate` actually calls; `relocate_managed_subtrees_with`
/// above (kept for its existing callers/tests, none of which offer either)
/// is now a thin wrapper over this with `&never_cancelled`/a no-op reporter.
fn relocate_managed_subtrees_cancellable<F, D>(
    current: &Path,
    new_root: &Path,
    commit_pointer: F,
    mut delete_source: D,
    check_cancelled: &dyn Fn() -> Result<(), String>,
    on_bytes: &dyn Fn(u64),
    on_verify_start: &dyn Fn(),
) -> Result<(Vec<String>, u64, Vec<String>), String>
where
    F: FnOnce() -> Result<(), String>,
    D: FnMut(&Path, &Path, &str) -> Result<(), String>,
{
    let mut moved = Vec::new();
    let mut bytes_moved = 0u64;

    // Phase 1: copy and byte-verify EVERY subtree. No source deletion is
    // reachable until the entire set has passed.
    //
    // D-verify-feedback fix (WS3 Round 29) — `on_verify_start` fires for
    // EVERY subtree's verify, unconditionally. An earlier attempt tried to
    // fire it only for the loop's last subtree, on the theory that only the
    // "final" verify should surface a label — but which subtree is slow
    // enough to actually need one has nothing to do with loop position: the
    // large `models`/fa-models data (the one verify that can genuinely take
    // 30-50s+) sorts near the FRONT of `MANAGED_RELOCATION_SUBTREES`, while
    // `diagnostic-logs` — trivially small, and now nearly empty after the
    // live-writer-race fix excludes its one file — sorts LAST. Gating on
    // "last" showed nothing during the one verify that actually stalls the
    // UI, and showed a label too briefly to read on the one that doesn't.
    // The right signal for "is this worth showing" is duration, which only
    // the frontend can observe live — see `useStorageRootRelocation.ts`'s
    // debounced handling of this same event for that half of the fix.
    for (name, get_dir) in MANAGED_RELOCATION_SUBTREES {
        check_cancelled()?;
        let from = get_dir(current);
        if !from.is_dir() {
            continue;
        }
        let to = get_dir(new_root);
        let mut source_hashes = std::collections::HashMap::new();
        copy_dir_recursive(&from, &to, check_cancelled, on_bytes, &mut source_hashes)?;
        on_verify_start();
        verify_dir_recursive(&from, &to, check_cancelled, &source_hashes)?;
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
pub async fn storage_root_status(app: tauri::AppHandle) -> Result<StorageRootStatus, String> {
    let current = resolve_storage_root(&app)?;
    let default = default_root(&app)?;
    let managed_bytes = if current.is_dir() {
        // Round 29 (D14 follow-up) — models/ was excluded from this total
        // even though it's real, user-chosen data under management (never
        // reclaimable, but still "managed"), the same gap `size_report`'s
        // own "Downloaded models" row exists to cover. Resolved the same
        // way that row is: `check_installed_models`, since models are not
        // (yet) relocated onto the storage root itself — see the module doc
        // comment's subtree table — so a plain `dir_size` over `models_dir`
        // would silently miss whatever `model_download`/`fa` actually used.
        let installed = crate::models::check_installed_models(app.clone()).await?;
        let mut model_bytes = installed.whisper.map(|s| s.bytes).unwrap_or(0);
        for status in installed.fa.values() {
            model_bytes += status.bytes;
        }
        Some(
            dir_size(&assets_dir(&current))
                + dir_size(&projects_dir(&current))
                + dir_size(&cache_dir(&current))
                + dir_size(&project_backups_dir(&current))
                + model_bytes,
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

    // Whisper and FA models resolve through their OWN, separate schemes
    // (see this file's module doc comment) — `model_download::models_dir` is
    // the whisper target dir specifically; FA models can additionally live
    // at an exe-relative fallback `fa_model_candidate_paths` also checks.
    // Reported as one approximate row (the whisper dir as the representative
    // `path`) rather than pretending a single directory holds all of it.
    let models_path = crate::model_download::models_dir(&app).unwrap_or_else(|_| models_dir(&root));
    let installed = crate::models::check_installed_models(app.clone()).await?;
    let mut model_bytes = installed.whisper.map(|s| s.bytes).unwrap_or(0);
    for status in installed.fa.values() {
        model_bytes += status.bytes;
    }

    // D14 fix (WS3 Round 29): Round 28 (683ebe2) moved the export-session
    // temp tree onto the storage root (`export_sessions_dir`, a sibling of
    // `cache/`) but never added it to `reclaimable_dirs`/this report, so an
    // orphaned export session's bytes were structurally invisible to
    // Settings — `totalReclaimable` stayed 0 in the overwhelming majority of
    // sessions and the "Free up cached data" button never rendered
    // (`StorageSettingsSection.tsx`'s `totalReclaimable > 0` gate). Only the
    // `orphan` class counts here (a manifestless, unclaimed session) — a
    // `resumable` session is left alone, same posture as the boot-time
    // `sweep_manifestless_orphans` sweep, so this row never reports bytes
    // the operator might still want to resume.
    let export_sessions_path = export_sessions_dir(&root);
    let export_orphan_bytes = crate::session_claim::report_reclaimable_sessions(&export_sessions_path)
        .map(|r| r.orphan_bytes)
        .unwrap_or(0);

    // Stale-root fix (WS3 Round 29, operator decision) — surfaced last, one
    // row per leftover this app knows about (a completed relocation's old
    // location, and/or any failed/cancelled relocation's abandoned
    // target) — see `storage_root_stale_roots`'s own doc comment.
    let stale_roots = storage_root_stale_roots(app.clone())?;

    // Ordering below is an explicit operator decision (WS3 Round 29): most
    // valuable/expensive data first (models, assets), down to the smallest
    // and most disposable (orphaned sessions, stale roots) last.
    let mut rows = vec![
        row(&models_path, "Downloaded models", model_bytes, 0, "never-reclaimable"),
        row(&assets_dir(&root), "Project assets", assets_bytes, 0, "never-reclaimable"),
        row(
            &backups_path,
            "Project backups",
            backups_bytes,
            backups_reclaimable_bytes,
            "reclaimable",
        ),
        row(&projects_dir(&root), "Projects", projects_bytes, 0, "never-reclaimable"),
        row(&cache_path, "Cache", cache_bytes, cache_bytes, "reclaimable"),
        row(
            &export_sessions_path,
            "Orphaned export sessions",
            export_orphan_bytes,
            export_orphan_bytes,
            "reclaimable",
        ),
    ];
    for stale in stale_roots {
        // Deliberately its own classification, not "reclaimable" — the
        // generic "Free up cached data" button (`storage_root_reclaim`)
        // does NOT clean this up; only the dedicated
        // `storage_root_cleanup_all_stale_roots` does. Folding it into
        // "reclaimable" would make that generic button's advertised total
        // include bytes it can't actually free.
        rows.push(row(Path::new(&stale.path), "Stale root", stale.bytes, stale.bytes, "stale-root"));
    }

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

    // D14 fix (WS3 Round 29) — see `size_report`'s matching comment. Only
    // `orphan`-class sessions are swept (never `live`/`resumable`), the same
    // selection `sweep_manifestless_orphans` already applies at boot, via
    // the existing `reclaim_sessions` helper which itself refuses anything a
    // live process still claims.
    let export_sessions_path = export_sessions_dir(&root);
    if export_sessions_path.is_dir() {
        if let Ok(report) = crate::session_claim::report_reclaimable_sessions(&export_sessions_path) {
            let orphan_ids: Vec<String> = report
                .entries
                .iter()
                .filter(|e| e.class == "orphan")
                .map(|e| e.session_id.clone())
                .collect();
            if !orphan_ids.is_empty() {
                let reclaim_report = crate::session_claim::reclaim_sessions(&export_sessions_path, &orphan_ids)?;
                reclaimed += reclaim_report.bytes_reclaimed;
            }
        }
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
///
/// D15 fix (WS3 Round 29) — this used to be a plain synchronous
/// `#[tauri::command] fn` doing every bit of this (free-space `dir_size`
/// walks, then `copy_dir_recursive`'s file-by-file `fs::copy`, then
/// `verify_dir_recursive`'s file-by-file SHA-256 hash of both copies) inline
/// on the thread Tauri's IPC/event dispatch shares — with zero yield points
/// across possibly thousands of small-file syscalls, that starves the whole
/// webview's event loop for the operation's entire duration (a hang sized by
/// file COUNT, not total bytes, which is why it froze solid even though the
/// underlying copy finished in well under a minute of real I/O time). Now an
/// `async fn` that hands the actual work to `tauri::async_runtime::
/// spawn_blocking`, so the executor's other worker threads stay free to
/// service every other command/event — including the Cancel button's own
/// click — for the whole duration. `do_relocate` below is the exact
/// previous, unchanged synchronous body.
#[tauri::command]
pub async fn storage_root_relocate(
    app: tauri::AppHandle,
    new_root: String,
    cancel_state: tauri::State<'_, RelocationCancelFlag>,
    on_event: tauri::ipc::Channel<RelocationEvent>,
) -> Result<StorageRootRelocateReport, String> {
    let cancel_flag = cancel_state.0.clone();
    cancel_flag.store(false, std::sync::atomic::Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || do_relocate(app, new_root, cancel_flag, on_event))
        .await
        .map_err(|e| format!("relocation task panicked: {e}"))?
}

/// D18 fix (WS3 Round 29) — live copy progress, same `tag`/`content` shape
/// `ModelDownloadEvent` already uses (see that enum's own comment for why:
/// a bare `#[serde(tag = "...")]` without `content` was caught silently
/// lower-casing variant names and breaking the JS side's `msg.event ===`
/// checks). `bytes_total` is the same `used` figure the free-space check
/// computed — the two are the same walk, done once and reused here rather
/// than a second `dir_size` pass.
#[derive(serde::Serialize, Clone)]
#[serde(tag = "event", content = "data")]
pub enum RelocationEvent {
    #[serde(rename_all = "camelCase")]
    Progress { bytes_done: u64, bytes_total: u64 },
    /// D-verify-feedback fix (WS3 Round 29) — the copy phase's own
    /// `Progress` events cover only the copy loop; `verify_dir_recursive`'s
    /// re-hash of every destination file (real work — often 30+ real
    /// seconds on a large relocation, even at `crc32fast` speeds) ran with
    /// zero events after it, so the progress bar sat at a stale "100%" for
    /// that whole span with no way to tell "still working" apart from
    /// "hung". Sent once, the first time ANY subtree's verify starts.
    Verifying,
    Done,
}

/// D15 fix (WS3 Round 29) — the shared flag `storage_root_relocate` polls
/// (via `copy_dir_recursive`/`verify_dir_recursive`, once per directory
/// entry) and `storage_root_relocate_cancel` sets. Reset to `false` at the
/// start of every relocation, so a stale cancel from a PREVIOUS run can
/// never abort a new one.
#[derive(Default)]
pub struct RelocationCancelFlag(pub std::sync::Arc<std::sync::atomic::AtomicBool>);

/// The operator's Cancel button. Cooperative, not preemptive: takes effect
/// at the next file/subtree boundary `do_relocate` checks, not mid-syscall —
/// same posture as every other cancel path in this codebase (export cancel,
/// model-download cancel).
#[tauri::command]
pub fn storage_root_relocate_cancel(cancel_state: tauri::State<'_, RelocationCancelFlag>) {
    cancel_state.0.store(true, std::sync::atomic::Ordering::SeqCst);
}

fn do_relocate(
    app: tauri::AppHandle,
    new_root: String,
    cancel_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
    on_event: tauri::ipc::Channel<RelocationEvent>,
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

    // Free-space check, with headroom, against what will actually be
    // copied. D-progress-total fix (WS3 Round 29) — this used to hardcode
    // 5 subtree names, and silently fell out of sync when D20 added
    // `project-mirror`/`diagnostic-logs` to `MANAGED_RELOCATION_SUBTREES`:
    // both `used` (this free-space check) AND `bytes_total` below (which
    // reuses `used`) under-counted the real total by however much of those
    // two subtrees existed, so the progress bar hit "100%" while the copy
    // loop still had those two subtrees left to go — indistinguishable
    // from a hang. Summing over the same const both the copy loop and the
    // legacy-fa-models merge already iterate keeps this from silently
    // drifting out of sync again the next time a subtree is added.
    let used = MANAGED_RELOCATION_SUBTREES
        .iter()
        .map(|(_, get_dir)| dir_size(&get_dir(&real_current)))
        .sum::<u64>()
        + dir_size(&real_current.join("fa-models"));
    let available = fs4::available_space(&real_new)
        .map_err(|e| format!("cannot read free space on {}: {e}", real_new.display()))?;
    ensure_relocation_space(used, available)
        .map_err(|e| format!("{e} at {}", real_new.display()))?;
    // Stale-root fix (WS3 Round 29, operator decision) — ADDS where we're
    // moving FROM to the accumulated stale-roots list, never overwrites it:
    // moving A -> B -> C without cleaning up in between must remember BOTH
    // A and B, not just the latest hop. The old copy is no longer deleted
    // as part of this call (see the `delete_source` closure below) — this
    // list is what lets Settings surface every leftover as one cleanup-able
    // group instead of silently losing track of all but the most recent.
    //
    // Resume fix (WS3 Round 29) — if `real_new` was itself a previously
    // stale target (this run is a resume, per `copy_dir_recursive`'s
    // size-match skip), it's no longer stale once it becomes the live root
    // — dropped from the list here rather than left to linger as an entry
    // for a location that's now authoritative.
    let real_new_str = real_new.to_string_lossy().to_string();
    let real_current_str = real_current.to_string_lossy().to_string();
    let mut stale_roots = read_config(&app)?.stale_roots;
    stale_roots.retain(|t| t != &real_new_str);
    if !stale_roots.iter().any(|t| t == &real_current_str) {
        stale_roots.push(real_current_str);
    }
    let cfg = StorageRootConfigFile {
        root: Some(real_new_str),
        stale_roots,
        legacy_previous_root: None,
        legacy_abandoned_targets: Vec::new(),
    };
    let json = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("serialize storage-root.json: {e}"))?;
    let config = config_path(&app)?;
    let check_cancelled = || -> Result<(), String> {
        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
            Err("relocation cancelled by operator".to_string())
        } else {
            Ok(())
        }
    };
    // D18 fix (WS3 Round 29) — `used` above is already the exact total this
    // call will copy, from the SAME walk the free-space check needed anyway;
    // reused as `bytes_total` rather than a second `dir_size` pass. Emits
    // are throttled to roughly every 16 MiB of progress (plus always at
    // completion) rather than per-file or per-chunk, so an 8 GiB relocation
    // sends dozens of IPC messages, not thousands.
    const PROGRESS_EMIT_THRESHOLD_BYTES: u64 = 16 * 1024 * 1024;
    let bytes_total = used;
    let bytes_done = std::cell::Cell::new(0u64);
    let last_emitted = std::cell::Cell::new(0u64);
    let on_bytes = |n: u64| {
        let done = bytes_done.get() + n;
        bytes_done.set(done);
        if done.saturating_sub(last_emitted.get()) >= PROGRESS_EMIT_THRESHOLD_BYTES || done >= bytes_total {
            last_emitted.set(done);
            let _ = on_event.send(RelocationEvent::Progress { bytes_done: done, bytes_total });
        }
    };
    // D20 fix (WS3 Round 29) — the legacy top-level `fa-models/` merge runs
    // as part of Phase 2 (inside `commit_pointer`, right before the pointer
    // write), i.e. AFTER every normal subtree — including the modern nested
    // `models/fa-models/` — has already copied and verified. That ordering
    // is load-bearing: `relocate_legacy_fa_models` needs to see whatever the
    // old root's OWN nested copy already produced at the new root before it
    // can correctly skip a language that's already there. A failure here
    // fails `commit_pointer` itself, so the existing Phase-1-failure cleanup
    // below (which deletes the whole partial `models/` subtree at the new
    // root on any error) already covers a partial legacy merge too, since
    // it lands nested inside that same `models/` directory.
    let found_legacy_fa_models = std::cell::Cell::new(false);
    let relocation = relocate_managed_subtrees_cancellable(
        &real_current,
        &real_new,
        || {
            found_legacy_fa_models.set(relocate_legacy_fa_models(
                &real_current,
                &real_new,
                &check_cancelled,
                &on_bytes,
            )?);
            write_atomic(&config, &json)
        },
        // Stale-root fix (WS3 Round 29, operator decision) — no longer
        // deletes the old copy here. `stale_roots` (set above) is what lets
        // the operator clean it up explicitly and on their own schedule,
        // via `storage_root_cleanup_all_stale_roots`, instead of an
        // immediate, silent, un-reversible deletion the instant the new
        // copy verifies.
        |_from, _bounds, _name| Ok(()),
        &check_cancelled,
        &on_bytes,
        &|| {
            let _ = on_event.send(RelocationEvent::Verifying);
        },
    );
    let (mut moved, bytes_moved, cleanup_warnings) = match relocation {
        Ok(result) => result,
        Err(err) => {
            // A cancel (or any other Phase-1 failure) is caught BEFORE
            // `commit_pointer` ever runs — see `relocate_managed_subtrees_cancellable`'s
            // own phase ordering — so the old root is still authoritative and
            // untouched. Resume/no-auto-delete fix (WS3 Round 29, operator
            // decision) — the partial, never-adopted copy at the new root is
            // no longer deleted here: a later relocation to this SAME target
            // resumes from it (`copy_dir_recursive`'s size-match skip)
            // instead of restarting at 0, and it's recorded as an
            // "abandoned target" so Settings can ALSO offer it for manual
            // cleanup if the operator would rather just discard it. Only
            // recorded if something was actually written — an instant
            // failure (bad path, no space, refused before any subtree
            // started) leaves nothing worth tracking.
            if MANAGED_RELOCATION_SUBTREES
                .iter()
                .any(|(_, get_dir)| get_dir(&real_new).is_dir())
            {
                let _ = record_stale_root(&app, &real_new);
            }
            return Err(err);
        }
    };

    // Stale-root fix (WS3 Round 29, operator decision) — the legacy source
    // is no longer deleted here either. By the time we're here every legacy
    // language IS fully represented at the new root (freshly merged, or
    // already present from the old root's own nested copy — see
    // `relocate_legacy_fa_models`'s own doc comment), so it's redundant,
    // stale data — left in place under the old root for the operator's
    // explicit `storage_root_cleanup_previous` cleanup, same as every other
    // subtree, rather than deleted immediately and silently.
    if found_legacy_fa_models.get() {
        moved.push("fa-models (legacy)".to_string());
    }

    let _ = on_event.send(RelocationEvent::Done);
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

        copy_dir_recursive(&src, &dst, &never_cancelled, &|_| {}, &mut std::collections::HashMap::new()).unwrap();

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

        let result = copy_dir_recursive(&src, &dst, &never_cancelled, &|_| {}, &mut std::collections::HashMap::new());
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
            ("pub async fn storage_root_status", "/// WS3 item H — one row"),
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
