//! WS3 item B — asset bytes become native and authoritative.
//!
//! Media bytes lived ONLY in the WebView's IndexedDB (`kinetix-assets`/
//! `assets-v2`, `src/services/assetStore.ts`) — no native copy existed.
//! IndexedDB is per-origin browser storage: subject to the same origin-split
//! and quota-eviction hazards `project_mirror.rs`'s own doc comment already
//! describes for `localStorage`, except assets are typically the largest
//! bytes a project holds. This module gives every asset a NATIVE, durable
//! copy under the storage root (`storage_root.rs`), keyed by
//! `(project_id, asset_id)` — the same compound key `assetStore.ts` already
//! uses. IndexedDB becomes a CACHE that can be lost without losing work: a
//! missing IndexedDB entry with a present native copy is a launch-time
//! repair (frontend-side, `repairAssetsFromNative.ts`), not data loss.
//!
//! Layout: `<storage_root>/assets/<project_id>/<asset_id>.bin` (the bytes)
//! plus `<asset_id>.meta.json` (name, mime type, byte count, written-at) —
//! a separate sidecar rather than encoding metadata into the filename, so an
//! asset's display name (arbitrary user-controlled Unicode) never has to
//! survive being a filesystem path component.
//!
//! Every write is temp-and-rename in the SAME directory (never in place),
//! matching `project_mirror.rs::write_atomic`'s exact contract. A write
//! failure is NEVER swallowed here — every command returns `Result` and the
//! frontend caller (`nativeAssetStore.ts`) is required to surface it as a
//! failed import, not a silent absence; see that module's own doc comment.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::storage_root::{assets_dir, resolve_storage_root};

/// Project-open provenance checks are deliberately bounded. Files above this
/// size require explicit folder-pick confirmation instead of hashing during
/// project open.
const MAX_AUTOMATIC_HASH_FILE_BYTES: u64 = 256 * 1024 * 1024;
/// The user-triggered hash-only rung is bounded independently by entry count,
/// per-file size, and aggregate bytes read.
const MAX_HASH_SCAN_FILES: usize = 256;
const MAX_HASH_SCAN_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_HASH_SCAN_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Same shape as `project_mirror.rs::safe_id` — rejects anything but a plain
/// single path segment. Both `project_id` and `asset_id` are
/// `crypto.randomUUID()` values in practice, but this command is reachable
/// from the webview, so both are treated as untrusted input.
fn safe_component(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(id)
    } else {
        Err(format!(
            "refusing unsafe id for an asset-store path: {id:?}"
        ))
    }
}

/// Provenance for an asset's bytes — where they came from on the user's
/// own filesystem, recorded at import/re-link time so a later resolution
/// ladder (Step 4) can re-find them silently instead of forcing the
/// recovery screen. Every field is optional and `#[serde(default)]`-ed so a
/// meta file written BEFORE this round (no provenance) still deserializes:
/// those assets have `original_path: None` and MUST route to folder-pick,
/// never to silent resolution — see `docs/ws3-export/architecture-ledger.md`'s
/// Round 27 entry for the pre-provenance limitation.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct AssetProvenance {
    /// Absolute path to the user's original source file at import/re-link
    /// time. `None` on assets imported before provenance was recorded, and
    /// on any write path that did not know a path (e.g. a bare byte blob).
    #[serde(default)]
    original_path: Option<String>,
    /// `original_path`'s parent directory, denormalized for the resolution
    /// ladder's "same filename in the recorded folder" rung.
    #[serde(default)]
    containing_folder: Option<String>,
    /// sha256 of the bytes. `None` until Step 4's ladder populates it; the
    /// folder-pick write path (Step 2) records the path/folder/size but
    /// leaves the hash for the ladder's own write.
    #[serde(default)]
    content_hash: Option<String>,
    /// Probed media duration in seconds. `None` for images and probe misses.
    #[serde(default)]
    duration: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AssetMetaFile {
    name: String,
    mime_type: String,
    bytes: u64,
    written_at_ms: u128,
    /// Round 27 provenance. Absent on every meta file written before this
    /// round — `#[serde(default)]` makes that a `None` provenance, which the
    /// resolution ladder treats as "no recorded origin → folder-pick only".
    #[serde(default)]
    provenance: Option<AssetProvenance>,
}

/// Provenance surfaced over IPC for the resolution ladder (Round 27 Step 4).
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AssetProvenanceStatus {
    pub original_path: Option<String>,
    pub containing_folder: Option<String>,
    pub content_hash: Option<String>,
    pub duration: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetStatusEntry {
    pub asset_id: String,
    pub bytes_present: bool,
    pub meta_present: bool,
    pub bytes: Option<u64>,
    pub name: Option<String>,
    pub mime_type: Option<String>,
    /// Round 27 — recorded origin, if any. Absent/`null` fields mean the asset
    /// was imported before provenance existed and MUST route to folder-pick.
    pub provenance: Option<AssetProvenanceStatus>,
}

/// Result of one resolution-ladder attempt for a single asset id.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetResolutionResult {
    pub asset_id: String,
    /// `exact_path` | `same_folder_filename` | `user_root_filename` | `content_hash` | `none`
    pub rung: String,
    /// `exact` | `probable` | `none`
    pub confidence: String,
    /// True ONLY for exact-path + matching recorded size + matching hash.
    pub silent: bool,
    pub candidate_path: Option<String>,
    pub reason: Option<String>,
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn project_dir(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let root = resolve_storage_root(app)?;
    let project_id = safe_component(project_id)?;
    Ok(assets_dir(&root).join(project_id))
}

fn bytes_path(dir: &Path, asset_id: &str) -> PathBuf {
    dir.join(format!("{asset_id}.bin"))
}
fn meta_path(dir: &Path, asset_id: &str) -> PathBuf {
    dir.join(format!("{asset_id}.meta.json"))
}

/// Temp-and-rename write, same-directory, fsync before rename — identical
/// contract to `project_mirror.rs::write_atomic`, duplicated locally rather
/// than shared across modules (this crate's existing convention: see that
/// function's own doc comment on why `project_mirror_*` and `project_store_*`
/// keep separate-but-identical copies rather than one shared entry point
/// used from two backup trees).
fn write_atomic_bytes(dest: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = dest
        .parent()
        .ok_or_else(|| format!("no parent: {}", dest.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
    let tmp = parent.join(format!(
        ".{}.tmp-{}-{}",
        dest.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "asset".into()),
        std::process::id(),
        now_millis()
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
        f.write_all(contents)
            .map_err(|e| format!("write {}: {e}", tmp.display()))?;
        f.sync_all()
            .map_err(|e| format!("fsync {}: {e}", tmp.display()))?;
    }
    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename {} -> {}: {e}", tmp.display(), dest.display())
    })
}

fn copy_atomic_with_hash(src: &Path, dest: &Path) -> Result<(u64, String), String> {
    let parent = dest
        .parent()
        .ok_or_else(|| format!("no parent: {}", dest.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
    let tmp = parent.join(format!(
        ".{}.tmp-{}-{}",
        dest.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "asset".into()),
        std::process::id(),
        now_millis()
    ));

    let result = (|| -> Result<(u64, String), String> {
        let mut input =
            fs::File::open(src).map_err(|e| format!("open source {}: {e}", src.display()))?;
        let mut output =
            fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
        let mut hasher = crate::sha256::Sha256::new();
        let mut copied = 0u64;
        let mut buffer = vec![0u8; 1024 * 1024];
        loop {
            let count = input
                .read(&mut buffer)
                .map_err(|e| format!("read source {}: {e}", src.display()))?;
            if count == 0 {
                break;
            }
            output
                .write_all(&buffer[..count])
                .map_err(|e| format!("write {}: {e}", tmp.display()))?;
            hasher.update(&buffer[..count]);
            copied += count as u64;
        }
        output
            .sync_all()
            .map_err(|e| format!("fsync {}: {e}", tmp.display()))?;
        fs::rename(&tmp, dest)
            .map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), dest.display()))?;
        Ok((copied, crate::sha256::hex_digest(&hasher.finish())))
    })();

    if result.is_err() && tmp.exists() {
        fs::remove_file(&tmp).map_err(|cleanup| {
            format!(
                "copy failed and temp cleanup {} failed: {cleanup}",
                tmp.display()
            )
        })?;
    }
    result
}

/// The actual write logic, factored out of the `#[tauri::command]` so it is
/// unit-testable without a `tauri::AppHandle`: takes the already-resolved
/// project directory directly. Bytes are written first; if the metadata
/// write then fails, the just-written bytes file is removed (best-effort)
/// before returning `Err` — a half-written asset (bytes with no matching
/// metadata, or vice versa) must never be left looking resolvable to a later
/// status check. The caller MUST treat any `Err` here as a failed import
/// (the WS3 item B ruling this closes: "never swallow a write failure — a
/// failed asset write must surface as a failed import, not a silent
/// absence").
fn write_asset_atomic(
    dir: &Path,
    asset_id: &str,
    bytes: &[u8],
    name: String,
    mime_type: String,
) -> Result<(), String> {
    write_asset_atomic_provenanced(dir, asset_id, bytes, name, mime_type, None)
}

/// Same as `write_asset_atomic` but also records the asset's provenance
/// (Round 27). `provenance = None` is the legacy/import-path shape: the
/// bytes are durable, but nothing remembers where they came from, so a
/// later resolution cannot auto-relink them — they route to folder-pick.
fn write_asset_atomic_provenanced(
    dir: &Path,
    asset_id: &str,
    bytes: &[u8],
    name: String,
    mime_type: String,
    provenance: Option<AssetProvenance>,
) -> Result<(), String> {
    let bp = bytes_path(dir, asset_id);
    let mp = meta_path(dir, asset_id);

    write_atomic_bytes(&bp, bytes)?;

    let meta = AssetMetaFile {
        name,
        mime_type,
        bytes: bytes.len() as u64,
        written_at_ms: now_millis(),
        provenance,
    };
    let meta_json = serde_json::to_vec(&meta).map_err(|e| format!("serialize asset meta: {e}"))?;
    if let Err(e) = write_atomic_bytes(&mp, &meta_json) {
        let _ = fs::remove_file(&bp);
        return Err(format!(
            "wrote asset bytes but failed to write its metadata, bytes removed: {e}"
        ));
    }
    Ok(())
}

/// Writes one asset's bytes AND metadata natively, atomically per-file. See
/// `write_asset_atomic` for the actual logic and its failure contract.
#[tauri::command]
pub fn asset_store_write(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data,
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("asset_store_write: expected a raw byte body, got JSON".to_string())
        }
    };
    let headers = request.headers();
    let header = |name: &str| -> Result<String, String> {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("asset_store_write: missing or invalid '{name}' header"))
    };
    let project_id = header("project-id")?;
    let asset_id = header("asset-id")?;
    let name = header("name")?;
    let mime_type = header("mime-type")?;

    let dir = project_dir(&app, &project_id)?;
    let asset_id = safe_component(&asset_id)?;
    write_asset_atomic(&dir, asset_id, bytes, name, mime_type)
}

/// Round 27 (Step 2/4) — copies a file BY PATH into the native asset store,
/// recording its provenance. This is the folder-pick write path: bytes
/// never cross IPC (the do-not: "Base64 large blobs over Tauri IPC"), and
/// the source path becomes the asset's recorded origin so a later open can
/// silently re-resolve it. `duration` is the caller's probed value (the
/// folder list already probed it); `None` for images / probe misses.
///
/// THROWS on any read/write failure — never swallowed; the recovery UI
/// surfaces it per-row so a partial batch is reported, not silently lost.
#[tauri::command]
pub async fn asset_store_write_from_path(
    app: tauri::AppHandle,
    project_id: String,
    asset_id: String,
    src_path: String,
    name: String,
    mime_type: String,
    duration: Option<f64>,
) -> Result<(), String> {
    let dir = project_dir(&app, &project_id)?;
    let asset_id = safe_component(&asset_id)?;
    let src = PathBuf::from(&src_path);
    // Refuse to "copy" a path that is not a regular file — guards against a
    // candidate descriptor that pointed at a directory or a broken symlink.
    if !src.is_file() {
        return Err(format!(
            "asset_store_write_from_path: source is not a regular file: {}",
            src.display()
        ));
    }
    let asset_id = asset_id.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let bp = bytes_path(&dir, &asset_id);
        let mp = meta_path(&dir, &asset_id);
        let containing_folder = src.parent().map(|p| p.to_string_lossy().to_string());
        let (bytes, content_hash) = copy_atomic_with_hash(&src, &bp)?;
        let provenance = AssetProvenance {
            original_path: Some(src_path),
            containing_folder,
            content_hash: Some(content_hash),
            duration,
        };
        let meta = AssetMetaFile {
            name,
            mime_type,
            bytes,
            written_at_ms: now_millis(),
            provenance: Some(provenance),
        };
        let meta_json =
            serde_json::to_vec(&meta).map_err(|e| format!("serialize asset meta: {e}"))?;
        if let Err(error) = write_atomic_bytes(&mp, &meta_json) {
            fs::remove_file(&bp).map_err(|cleanup| {
                format!(
                    "wrote asset bytes but metadata failed ({error}); bytes cleanup {} also failed: {cleanup}",
                    bp.display()
                )
            })?;
            return Err(format!(
                "wrote asset bytes but failed to write metadata; bytes removed: {error}"
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("asset_store_write_from_path worker failed: {e}"))?
}
/// callers that need to distinguish "missing" from "other I/O error" should
/// consult `asset_store_status` first (the recovery-status data source), not
/// probe by calling this and inspecting the error string.
#[tauri::command]
pub fn asset_store_read(
    app: tauri::AppHandle,
    project_id: String,
    asset_id: String,
) -> Result<Vec<u8>, String> {
    let dir = project_dir(&app, &project_id)?;
    let asset_id = safe_component(&asset_id)?;
    fs::read(bytes_path(&dir, asset_id)).map_err(|e| format!("asset_store_read({asset_id}): {e}"))
}

/// Per-asset resolution status for every asset id the CALLER names, plus
/// whatever this project's native store additionally has on disk that the
/// caller didn't ask about (surfaced the same way, at the end of the list) —
/// this is the WS3 item A recovery-screen data source: "per-asset resolution
/// status, whether a native copy... exists". `asset_ids` is normally the
/// project's own `project.assets[].id` list; passing it explicitly (rather
/// than just listing the directory) means an asset that is NEITHER in
/// IndexedDB NOR natively still gets a `bytes_present: false` ROW instead of
/// silently not appearing at all.
#[tauri::command]
pub fn asset_store_status(
    app: tauri::AppHandle,
    project_id: String,
    asset_ids: Vec<String>,
) -> Result<Vec<AssetStatusEntry>, String> {
    let dir = project_dir(&app, &project_id)?;
    let mut out = Vec::with_capacity(asset_ids.len());
    for raw_id in asset_ids {
        let Ok(asset_id) = safe_component(&raw_id) else {
            out.push(AssetStatusEntry {
                asset_id: raw_id,
                bytes_present: false,
                meta_present: false,
                bytes: None,
                name: None,
                mime_type: None,
                provenance: None,
            });
            continue;
        };
        let bp = bytes_path(&dir, asset_id);
        let mp = meta_path(&dir, &asset_id);
        let bytes_present = bp.is_file();
        let meta: Option<AssetMetaFile> = fs::read(&mp)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok());
        let provenance = meta.as_ref().and_then(|m| {
            m.provenance.as_ref().map(|p| AssetProvenanceStatus {
                original_path: p.original_path.clone(),
                containing_folder: p.containing_folder.clone(),
                content_hash: p.content_hash.clone(),
                duration: p.duration,
            })
        });
        out.push(AssetStatusEntry {
            asset_id: asset_id.to_string(),
            bytes_present,
            meta_present: meta.is_some(),
            bytes: meta.as_ref().map(|m| m.bytes),
            name: meta.as_ref().map(|m| m.name.clone()),
            mime_type: meta.as_ref().map(|m| m.mime_type.clone()),
            provenance,
        });
    }
    Ok(out)
}

fn file_matches_recorded(
    meta: &AssetMetaFile,
    path: &Path,
    max_hash_bytes: u64,
) -> Result<(bool, bool), String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return Ok((false, false)),
    };
    let size_ok = metadata.len() == meta.bytes;
    if !size_ok || metadata.len() > max_hash_bytes {
        return Ok((size_ok, false));
    }
    let hash_ok = match (
        meta.provenance
            .as_ref()
            .and_then(|p| p.content_hash.as_deref()),
        crate::sha256::hash_file(path),
    ) {
        (Some(recorded), Ok(actual)) => recorded.eq_ignore_ascii_case(&actual),
        (_, Err(error)) => {
            return Err(format!("hash {}: {error}", path.display()));
        }
        _ => false,
    };
    Ok((size_ok, hash_ok))
}

fn filename_in_folder(folder: &Path, name: &str) -> Option<PathBuf> {
    let candidate = folder.join(name);
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

fn hash_match_in_folder(folder: &Path, expected_hash: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(folder).ok()?;
    let mut files_seen = 0usize;
    let mut bytes_seen = 0u64;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let size = entry.metadata().ok()?.len();
        if size > MAX_HASH_SCAN_FILE_BYTES {
            continue;
        }
        files_seen += 1;
        bytes_seen = bytes_seen.saturating_add(size);
        if files_seen > MAX_HASH_SCAN_FILES || bytes_seen > MAX_HASH_SCAN_TOTAL_BYTES {
            return None;
        }
        if let Ok(hash) = crate::sha256::hash_file(&path) {
            if hash.eq_ignore_ascii_case(expected_hash) {
                return Some(path);
            }
        }
    }
    None
}

/// Round 27 Step 4 — walks the provenance resolution ladder for one asset.
/// ONLY the exact-path rung with matching size AND hash is marked `silent:
/// true`; every weaker rung returns a candidate for confirmation instead.
/// Pre-provenance assets (`original_path: None`) always return rung `none`.
#[tauri::command]
pub async fn asset_store_attempt_resolution(
    app: tauri::AppHandle,
    project_id: String,
    asset_id: String,
    user_picked_root: Option<String>,
) -> Result<AssetResolutionResult, String> {
    let dir = project_dir(&app, &project_id)?;
    let asset_id = safe_component(&asset_id)?;
    let asset_id = asset_id.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let mp = meta_path(&dir, &asset_id);
        let meta: AssetMetaFile = fs::read(&mp)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .ok_or_else(|| format!("asset_store_attempt_resolution: no metadata for {asset_id}"))?;

        let Some(provenance) = meta.provenance.as_ref() else {
            return Ok(AssetResolutionResult {
                asset_id: asset_id.to_string(),
                rung: "none".into(),
                confidence: "none".into(),
                silent: false,
                candidate_path: None,
                reason: Some("pre-provenance: no recorded origin — folder-pick only".into()),
            });
        };

        let Some(original_path) = provenance.original_path.as_deref() else {
            return Ok(AssetResolutionResult {
                asset_id: asset_id.to_string(),
                rung: "none".into(),
                confidence: "none".into(),
                silent: false,
                candidate_path: None,
                reason: Some("pre-provenance: no original_path — folder-pick only".into()),
            });
        };

        // Rung 1 — exact path hit.
        let original = PathBuf::from(original_path);
        if original.is_file() {
            let (size_ok, hash_ok) =
                file_matches_recorded(&meta, &original, MAX_AUTOMATIC_HASH_FILE_BYTES)?;
            if size_ok && hash_ok {
                return Ok(AssetResolutionResult {
                    asset_id: asset_id.to_string(),
                    rung: "exact_path".into(),
                    confidence: "exact".into(),
                    silent: true,
                    candidate_path: Some(original_path.to_string()),
                    reason: None,
                });
            }
            return Ok(AssetResolutionResult {
                asset_id: asset_id.to_string(),
                rung: "exact_path".into(),
                confidence: if size_ok {
                    "probable".into()
                } else {
                    "none".into()
                },
                silent: false,
                candidate_path: Some(original_path.to_string()),
                reason: Some(
                    "exact path exists but size/hash mismatch — confirmation required".into(),
                ),
            });
        }

        // Rung 2 — same filename in recorded folder.
        if let Some(folder) = provenance.containing_folder.as_deref().map(PathBuf::from) {
            if folder.is_dir() {
                if let Some(candidate) = filename_in_folder(&folder, &meta.name) {
                    let (size_ok, hash_ok) =
                        file_matches_recorded(&meta, &candidate, MAX_AUTOMATIC_HASH_FILE_BYTES)?;
                    let confidence = if size_ok && hash_ok {
                        "exact"
                    } else if size_ok {
                        "probable"
                    } else {
                        "probable"
                    };
                    return Ok(AssetResolutionResult {
                        asset_id: asset_id.to_string(),
                        rung: "same_folder_filename".into(),
                        confidence: confidence.into(),
                        silent: false,
                        candidate_path: Some(candidate.to_string_lossy().into_owned()),
                        reason: Some(
                            "same filename in recorded folder — confirmation required".into(),
                        ),
                    });
                }
            }
        }

        // Rung 3 — same filename under user-picked root (folder-pick flow only).
        if let Some(root) = user_picked_root.as_deref() {
            let folder = PathBuf::from(root);
            if folder.is_dir() {
                if let Some(candidate) = filename_in_folder(&folder, &meta.name) {
                    return Ok(AssetResolutionResult {
                        asset_id: asset_id.to_string(),
                        rung: "user_root_filename".into(),
                        confidence: "probable".into(),
                        silent: false,
                        candidate_path: Some(candidate.to_string_lossy().into_owned()),
                        reason: Some(
                            "same filename under picked root — confirmation required".into(),
                        ),
                    });
                }
            }
        }

        // Rung 4 — content-hash match regardless of name (scan recorded folder).
        if let (Some(expected_hash), Some(folder)) = (
            provenance.content_hash.as_deref(),
            user_picked_root.as_deref().map(PathBuf::from),
        ) {
            if folder.is_dir() {
                if let Some(candidate) = hash_match_in_folder(&folder, expected_hash) {
                    return Ok(AssetResolutionResult {
                        asset_id: asset_id.to_string(),
                        rung: "content_hash".into(),
                        confidence: "exact".into(),
                        silent: false,
                        candidate_path: Some(candidate.to_string_lossy().into_owned()),
                        reason: Some(
                            "hash match with different filename — confirmation required".into(),
                        ),
                    });
                }
            }
        }

        Ok(AssetResolutionResult {
            asset_id: asset_id.to_string(),
            rung: "none".into(),
            confidence: "none".into(),
            silent: false,
            candidate_path: None,
            reason: Some("no ladder rung matched".into()),
        })
    })
    .await
    .map_err(|e| format!("asset_store_attempt_resolution worker failed: {e}"))?
}

/// Removes one asset's native copy (both files), best-effort per file —
/// mirrors `assetStore.ts::deleteAsset`'s "if it's already gone, that's
/// fine" posture for the IndexedDB side.
#[tauri::command]
pub fn asset_store_delete(
    app: tauri::AppHandle,
    project_id: String,
    asset_id: String,
) -> Result<(), String> {
    let dir = project_dir(&app, &project_id)?;
    let asset_id = safe_component(&asset_id)?;
    let _ = fs::remove_file(bytes_path(&dir, asset_id));
    let _ = fs::remove_file(meta_path(&dir, asset_id));
    Ok(())
}

/// Removes a whole project's native asset directory — mirrors
/// `assetStore.ts::deleteAllAssets`/`deleteAllAssetsForProject` parity for
/// project deletion.
///
/// WS3 item H (folded-in project-delete orphaning fix) — routes through the
/// item E audited helper (`safe_delete::delete_app_staging_dir`) instead of
/// a raw `fs::remove_dir_all`, same posture as every other recursive delete
/// in this crate now has: `dir` must canonicalize to somewhere strictly
/// inside the project's OWN parent (`assets/`), never merely "looked like
/// the right path". No filename-prefix convention applies here (a project
/// id is a bare UUID, not `kinetix-whisper-…`), so `required_prefix` is
/// empty — `str::starts_with("")` is unconditionally true, meaning this
/// still gets full canonicalization + containment checking, just no name
/// pattern on top of it.
///
/// The caller (`nativeAssetStore.ts`'s `deleteProjectAssetsNativeStrict`,
/// wired into `ProjectDashboard.tsx`'s bulk-delete flow) is REQUIRED to
/// treat a non-`is_dir()` early return as success (nothing to delete) but
/// any `Err` from the helper as a real, surfaced failure — never
/// fire-and-forget for project-level deletion, unlike the best-effort
/// single-asset delete commands above.
#[tauri::command]
pub fn asset_store_delete_project(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
    let root = resolve_storage_root(&app)?;
    let project_id = safe_component(&project_id)?;
    let dir = assets_dir(&root).join(project_id);
    if !dir.is_dir() {
        return Ok(());
    }
    crate::safe_delete::delete_app_staging_dir(&dir, &assets_dir(&root), "")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("kinetix-asset-store-test-{tag}-{}", now_millis()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn safe_component_accepts_a_uuid_and_rejects_traversal() {
        assert!(safe_component("fd77f95e-b339-4463-810c-6eaf3539c58b").is_ok());
        assert!(safe_component("..").is_err());
        assert!(safe_component("a/b").is_err());
        assert!(safe_component("../../etc/passwd").is_err());
        assert!(safe_component("").is_err());
    }

    #[test]
    fn write_atomic_bytes_writes_and_replaces_leaving_no_temp_residue() {
        let d = tmpdir("write");
        let dest = d.join("a.bin");
        write_atomic_bytes(&dest, b"hello").unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"hello");
        write_atomic_bytes(&dest, b"replacement bytes").unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"replacement bytes");
        let leftovers: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn write_asset_atomic_writes_both_files_on_success() {
        let d = tmpdir("write-both");
        write_asset_atomic(
            &d,
            "asset-1",
            b"payload bytes",
            "clip.mp4".into(),
            "video/mp4".into(),
        )
        .unwrap();
        assert_eq!(
            fs::read(bytes_path(&d, "asset-1")).unwrap(),
            b"payload bytes"
        );
        let meta: AssetMetaFile =
            serde_json::from_slice(&fs::read(meta_path(&d, "asset-1")).unwrap()).unwrap();
        assert_eq!(meta.name, "clip.mp4");
        assert_eq!(meta.mime_type, "video/mp4");
        assert_eq!(meta.bytes, 13);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_failed_metadata_write_removes_the_just_written_bytes_and_returns_err() {
        // Force the metadata write to fail deterministically: pre-create its
        // destination path AS A DIRECTORY. write_atomic_bytes's temp file
        // (a differently-named sibling) is created fine, but the final
        // `rename(tmp, meta_path)` fails because meta_path already exists
        // and is a directory, not a file — the same shape a real failure
        // (disk full mid-write, permission change, AV lock) produces: bytes
        // land, metadata does not.
        let d = tmpdir("meta-fail");
        fs::create_dir_all(meta_path(&d, "asset-1")).unwrap();

        let result = write_asset_atomic(
            &d,
            "asset-1",
            b"payload",
            "clip.mp4".into(),
            "video/mp4".into(),
        );

        assert!(
            result.is_err(),
            "a metadata write that cannot land must be reported, not swallowed"
        );
        assert!(
            !bytes_path(&d, "asset-1").exists(),
            "the bytes file must be removed when its metadata could not be written — a half-written \
             asset must never look resolvable to a later status check"
        );

        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn bytes_and_meta_paths_are_named_consistently_from_the_same_asset_id() {
        let d = tmpdir("paths");
        let bp = bytes_path(&d, "asset-1");
        let mp = meta_path(&d, "asset-1");
        assert_eq!(bp, d.join("asset-1.bin"));
        assert_eq!(mp, d.join("asset-1.meta.json"));
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn write_from_path_records_content_hash_in_provenance() {
        let d = tmpdir("prov-hash");
        let src_dir = d.join("src");
        fs::create_dir_all(&src_dir).unwrap();
        let src = src_dir.join("clip.mp4");
        fs::write(&src, b"video-bytes-for-hash").unwrap();
        let expected_hash = crate::sha256::hash_file(&src).unwrap();

        let provenance = AssetProvenance {
            original_path: Some(src.to_string_lossy().into_owned()),
            containing_folder: Some(src_dir.to_string_lossy().into_owned()),
            content_hash: Some(expected_hash.clone()),
            duration: Some(12.5),
        };
        write_asset_atomic_provenanced(
            &d,
            "asset-1",
            b"video-bytes-for-hash",
            "clip.mp4".into(),
            "video/mp4".into(),
            Some(provenance),
        )
        .unwrap();

        let meta: AssetMetaFile =
            serde_json::from_slice(&fs::read(meta_path(&d, "asset-1")).unwrap()).unwrap();
        assert_eq!(
            meta.provenance
                .as_ref()
                .and_then(|p| p.content_hash.as_deref()),
            Some(expected_hash.as_str())
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn legacy_write_leaves_provenance_absent() {
        let d = tmpdir("pre-prov");
        write_asset_atomic(&d, "asset-1", b"x", "clip.mp4".into(), "video/mp4".into()).unwrap();
        let meta: AssetMetaFile =
            serde_json::from_slice(&fs::read(meta_path(&d, "asset-1")).unwrap()).unwrap();
        assert!(meta.provenance.is_none());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn path_copy_streams_bytes_and_reuses_the_same_pass_digest() {
        let d = tmpdir("stream-copy");
        let src = d.join("source.bin");
        let dest = d.join("asset.bin");
        let payload = vec![0x5au8; 3 * 1024 * 1024 + 17];
        fs::write(&src, &payload).unwrap();

        let (bytes, digest) = copy_atomic_with_hash(&src, &dest).unwrap();

        assert_eq!(bytes, payload.len() as u64);
        assert_eq!(digest, crate::sha256::hash_file(&src).unwrap());
        assert_eq!(fs::read(&dest).unwrap(), payload);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn automatic_exact_path_hashing_refuses_files_above_the_cap_without_reading_them() {
        let d = tmpdir("automatic-hash-cap");
        let path = d.join("large-sparse-media.bin");
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_AUTOMATIC_HASH_FILE_BYTES + 1).unwrap();
        let meta = AssetMetaFile {
            name: "large.mp4".into(),
            mime_type: "video/mp4".into(),
            bytes: MAX_AUTOMATIC_HASH_FILE_BYTES + 1,
            written_at_ms: now_millis(),
            provenance: Some(AssetProvenance {
                content_hash: Some("would-require-reading-the-file".into()),
                ..AssetProvenance::default()
            }),
        };

        let (size_ok, hash_ok) =
            file_matches_recorded(&meta, &path, MAX_AUTOMATIC_HASH_FILE_BYTES).unwrap();
        assert!(size_ok);
        assert!(!hash_ok, "over-cap files require confirmation and are never silent");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn path_import_keeps_streaming_copy_and_hash_off_the_async_command_thread() {
        let source = include_str!("asset_store.rs");
        let command = source
            .split("pub async fn asset_store_write_from_path")
            .nth(1)
            .expect("path-import command must remain async")
            .split("/// callers that need to distinguish")
            .next()
            .unwrap();
        assert!(command.contains("spawn_blocking"));
        assert!(command.contains("copy_atomic_with_hash"));
        assert!(!command.contains("fs::read(&src)"));
        assert!(!command.contains("hash_file(&src)"));
    }

    #[test]
    fn status_and_resolution_commands_are_filesystem_read_only() {
        let source = include_str!("asset_store.rs");
        for (start, end) in [
            ("pub fn asset_store_status", "fn file_matches_recorded"),
            (
                "pub async fn asset_store_attempt_resolution",
                "/// Removes one asset's native copy",
            ),
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

    #[test]
    fn four_hundred_forty_eight_assets_create_448_bytes_and_448_metadata_sidecars() {
        let d = tmpdir("448-layout");
        for index in 0..448 {
            write_asset_atomic(
                &d,
                &format!("asset-{index}"),
                b"x",
                format!("clip-{index}.mp4"),
                "video/mp4".into(),
            )
            .unwrap();
        }

        let names: Vec<String> = fs::read_dir(&d)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names.len(), 896);
        assert_eq!(names.iter().filter(|name| name.ends_with(".bin")).count(), 448);
        assert_eq!(
            names
                .iter()
                .filter(|name| name.ends_with(".meta.json"))
                .count(),
            448
        );
        assert!(names.iter().all(|name| {
            name.ends_with(".bin") || name.ends_with(".meta.json")
        }));
        fs::remove_dir_all(&d).ok();
    }
}
