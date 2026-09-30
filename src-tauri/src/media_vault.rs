//! G6 Step 2 — Media Vault: a project-INDEPENDENT, content-addressed asset
//! store, keyed by sha256 of the bytes rather than by `(project_id, asset_id)`
//! the way `asset_store.rs`'s existing per-project store is. The two coexist:
//! `asset_store.rs` stays the binding store `assetId` resolves through
//! (v6 additive — see `types.ts`'s `Asset.contentHash`, Step 5); this module
//! is the place the SAME bytes imported into two different projects (or the
//! same project twice, via a renamed zip re-import) live exactly once.
//!
//! **Layout**, following `assets_dir`'s own pattern (`storage_root.rs`):
//!   - `<storage_root>/media-vault/<sha256-hex>.bin` — the bytes, one file
//!     per distinct content hash.
//!   - `<storage_root>/media-vault/registry.json` — one JSON object mapping
//!     content-hash -> `MediaVaultEntry` (display name, mime type, size,
//!     added-at, and every project id currently referencing it).
//!
//! **Crash safety is the entire point of this module's shape.** Write-through
//! at import time is TWO PHASES — `write_blob_if_absent` (phase 1) then
//! `commit_registry_entry` (phase 2), always in that order, never the
//! reverse — so that a process kill between them leaves the registry with NO
//! trace of the attempted import: no entry exists yet, which is
//! indistinguishable from the call never having started. A REVERSED order
//! (registry first) would instead risk the one state this design makes
//! unreachable: a registered entry whose blob is missing — "dangling" in the
//! sense that matters, because the UI would show an asset that 404s on read.
//! The orphaned blob bytes a phase-1-only crash leaves behind are harmless
//! (nothing references them) and self-heal on the next import of the same
//! content, which finds them already on disk and skips rewriting — see
//! `write_blob_if_absent`'s own doc comment.
//!
//! This is exactly the bug class `migrateAssetsToNative.ts`'s doc comment
//! describes for the EXISTING IndexedDB-only-then-next-boot-migration import
//! asymmetry (a crash in that window loses the asset because nothing durable
//! was written yet at all) — this module's writes are synchronous and
//! durable at import time, so that window does not exist for vault blobs.
//!
//! G6 Step 3 wires this up: `media_vault_import` is the `#[tauri::command]`
//! the frontend's consolidated zip-ingest path (`App.tsx`'s `ingestZip`)
//! calls per file. The display name arrives base64-encoded in its own
//! header (`decode_display_name_header`), never raw — an HTTP-style header
//! value cannot safely carry arbitrary UTF-8 (non-ISO-8859-1 bytes are
//! rejected or mangled depending on the platform), and this command's whole
//! reason for existing is to fix exactly this class of "unicode naivety"
//! bug in the old zip-ingest code, not reintroduce a new instance of it one
//! layer down.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::atomic_stage::write_bytes_atomic;
use crate::sha256::{hex_digest, Sha256};
use crate::storage_root::{media_vault_dir, resolve_storage_root};

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// One media-vault registry row. `contentHash` is both the map key (in
/// `MediaVaultRegistry`) and denormalized onto the value itself so a caller
/// holding one `MediaVaultEntry` (e.g. a `media_vault_list` row in the UI)
/// never needs the map around to know its own key.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaVaultEntry {
    pub content_hash: String,
    pub display_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub added_at_ms: u128,
    /// Every project currently using this content. Empty means "imported but
    /// unreferenced" — the exact state Step 6's Reclaim button targets.
    #[serde(default)]
    pub referenced_by_project_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct MediaVaultRegistry {
    #[serde(default)]
    entries: HashMap<String, MediaVaultEntry>,
}

fn registry_path(root: &Path) -> PathBuf {
    media_vault_dir(root).join("registry.json")
}

/// The registry file's path (for a verbatim pre-change copy).
pub fn registry_file(root: &Path) -> PathBuf {
    registry_path(root)
}

fn blob_path(root: &Path, content_hash: &str) -> PathBuf {
    media_vault_dir(root).join(format!("{content_hash}.bin"))
}

/// Missing registry file reads as an empty registry (a fresh vault, or a
/// fresh storage root) — not an error. Any other read/parse failure IS an
/// error: a present-but-corrupt registry must never be silently treated as
/// empty, which would look like every existing entry's project references
/// simply vanished.
fn load_registry(root: &Path) -> Result<MediaVaultRegistry, String> {
    let path = registry_path(root);
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("media-vault: parse {}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(MediaVaultRegistry::default()),
        Err(e) => Err(format!("media-vault: read {}: {e}", path.display())),
    }
}

fn save_registry(root: &Path, registry: &MediaVaultRegistry) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(registry)
        .map_err(|e| format!("media-vault: serialize registry: {e}"))?;
    write_bytes_atomic(&registry_path(root), &json)
}

/// PHASE 1 of the write-through import. Hashes `bytes` and, only if no blob
/// for that hash already exists, writes it atomically (temp-file + rename,
/// same directory, via `atomic_stage::write_bytes_atomic`). Never touches the
/// registry — see the module doc comment for why the split, and never
/// re-writes an existing blob — content-addressing means a hash match IS a
/// bytes match, so re-writing would only cost I/O for zero benefit, and is
/// also what makes resuming after a phase-1-only crash free: the next import
/// of the same content finds the blob already there and moves straight to
/// phase 2.
fn write_blob_if_absent(root: &Path, bytes: &[u8]) -> Result<String, String> {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let content_hash = hex_digest(&hasher.finish());

    let bp = blob_path(root, &content_hash);
    if !bp.exists() {
        write_bytes_atomic(&bp, bytes)?;
    }
    Ok(content_hash)
}

/// PHASE 2 of the write-through import. Adds a fresh registry entry for
/// `content_hash`, or extends an existing one with `project_id` (never
/// duplicated in `referenced_by_project_ids`). Assumes phase 1 already ran
/// for this hash — nothing here re-verifies the blob is on disk, which is
/// exactly what keeps the invariant "a registry entry implies its blob
/// exists" true BY CONSTRUCTION: this function is the only writer of the
/// registry in this module, and every call site calls phase 1 first.
fn commit_registry_entry(
    root: &Path,
    content_hash: &str,
    project_id: &str,
    display_name: &str,
    mime_type: &str,
    size_bytes: u64,
) -> Result<MediaVaultEntry, String> {
    let mut registry = load_registry(root)?;
    let entry = registry
        .entries
        .entry(content_hash.to_string())
        .or_insert_with(|| MediaVaultEntry {
            content_hash: content_hash.to_string(),
            display_name: display_name.to_string(),
            mime_type: mime_type.to_string(),
            size_bytes,
            added_at_ms: now_millis(),
            referenced_by_project_ids: Vec::new(),
        });
    if !entry.referenced_by_project_ids.iter().any(|p| p == project_id) {
        entry.referenced_by_project_ids.push(project_id.to_string());
    }
    let result = entry.clone();
    save_registry(root, &registry)?;
    Ok(result)
}

/// THE write-through import (G6 Step 2). See the module doc comment for the
/// two-phase crash-safety argument; this is just phase 1 then phase 2, in
/// that fixed order, with nothing in between that can partially apply either
/// one.
pub fn media_vault_import_bytes(
    root: &Path,
    project_id: &str,
    bytes: &[u8],
    display_name: &str,
    mime_type: &str,
) -> Result<MediaVaultEntry, String> {
    let content_hash = write_blob_if_absent(root, bytes)?;
    commit_registry_entry(
        root,
        &content_hash,
        project_id,
        display_name,
        mime_type,
        bytes.len() as u64,
    )
}

/// Read-only listing for the Media block UI (Step 4) and the storage-hygiene
/// pass (Step 6). Reflects only what the registry knows — never stats the
/// filesystem for presence, so it cannot itself distinguish "present" from
/// "registered but the blob went missing"; that check is a separate concern
/// (the same missing/offline pattern the existing relink machinery already
/// has, per Step 4's plan), not this function's job.
pub fn media_vault_list(root: &Path) -> Result<Vec<MediaVaultEntry>, String> {
    Ok(load_registry(root)?.entries.into_values().collect())
}

/// G6 Step 2's delete-refusal invariant, factored out as a pure function (no
/// filesystem access) so `reclaim_unreferenced_blobs` (Step 6) can check
/// this FIRST and never reach the filesystem for a blob any project still
/// references.
pub fn refuse_delete_if_referenced(entry: &MediaVaultEntry) -> Result<(), String> {
    if entry.referenced_by_project_ids.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "refusing to delete media-vault blob {}: still referenced by {} project(s)",
            entry.content_hash,
            entry.referenced_by_project_ids.len()
        ))
    }
}

/// Decodes the `display-name-b64` header (see module doc comment for why
/// base64, not a raw header value). Factored out as a pure function so it is
/// unit-testable without constructing a real `tauri::ipc::Request`, the same
/// reason `asset_store.rs`'s write path splits its actual logic from its
/// `#[tauri::command]` shell.
fn decode_display_name_header(encoded: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("media_vault_import: invalid display-name-b64: {e}"))?;
    String::from_utf8(bytes)
        .map_err(|e| format!("media_vault_import: display-name-b64 was not valid UTF-8: {e}"))
}

/// G6 Step 3 — the write-through import's IPC surface. Bytes arrive as the
/// raw request body (never base64 — that do-not applies to the MEDIA bytes,
/// which can be gigabytes; it never applied to the few-byte display-name
/// header, which is base64'd for the opposite reason: header values have no
/// safe way to carry arbitrary UTF-8 at all). See `media_vault_import_bytes`
/// for the actual two-phase write-through logic this only wires up.
#[tauri::command]
pub fn media_vault_import(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
) -> Result<MediaVaultEntry, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data,
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("media_vault_import: expected a raw byte body, got JSON".to_string())
        }
    };
    let headers = request.headers();
    let header = |name: &str| -> Result<String, String> {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("media_vault_import: missing or invalid '{name}' header"))
    };
    let project_id = header("project-id")?;
    let display_name = decode_display_name_header(&header("display-name-b64")?)?;
    let mime_type = header("mime-type")?;

    let root = resolve_storage_root(&app)?;
    media_vault_import_bytes(&root, &project_id, bytes, &display_name, &mime_type)
}

/// G6 Step 4 — the Media block's listing IPC surface. Thin wrapper: all the
/// actual logic is `media_vault_list` above (kept `root`-based and
/// AppHandle-free specifically so it stays unit-testable without a real
/// Tauri app).
#[tauri::command]
pub fn media_vault_list_entries(app: tauri::AppHandle) -> Result<Vec<MediaVaultEntry>, String> {
    media_vault_list(&resolve_storage_root(&app)?)
}

/// G6 Step 4 — reads one vault blob's raw bytes back to the frontend, the
/// same `Result<Vec<u8>, String>` / JSON-array-over-IPC convention
/// `asset_store.rs`'s `asset_store_read` already uses. Used for image-type
/// entries, which are their own thumbnail (per the operator's "images use
/// themselves" ruling — no separate thumbnail file is generated for them).
#[tauri::command]
pub fn media_vault_read_blob(app: tauri::AppHandle, content_hash: String) -> Result<Vec<u8>, String> {
    let root = resolve_storage_root(&app)?;
    fs::read(blob_path(&root, &content_hash))
        .map_err(|e| format!("media_vault_read_blob({content_hash}): {e}"))
}

fn thumbnail_path(root: &Path, content_hash: &str) -> PathBuf {
    media_vault_dir(root).join(format!("{content_hash}.thumb.jpg"))
}

/// G6 Step 4a — one fixed timestamp, chosen once for every video rather than
/// a per-video "interesting frame" search: simple, deterministic, and good
/// enough for a grid thumbnail (a black first-frame is the main real-world
/// risk `-ss` this far in avoids).
const THUMBNAIL_AT_SECONDS: f64 = 1.0;
/// ffmpeg's `-q:v` MJPEG quality scale is 2 (best) to 31 (worst) — a
/// thumbnail-sized JPEG has no reason to spend bytes near the top of that
/// range.
const THUMBNAIL_JPEG_QUALITY: &str = "5";

/// Builds the ffmpeg arg list for `ffmpeg_extract_thumbnail`, split out as a
/// pure function so its shape is unit-testable without a `tauri::AppHandle`
/// or the ffmpeg sidecar binary itself (both are unavailable in a plain
/// `cargo test` run). ffmpeg's INPUT side probes file content regardless of
/// extension (a vault blob has none, and that's fine), but its OUTPUT
/// muxer only ever looks at the filename's final extension to pick a
/// format — and `output` here is a `.thumb.jpg.part` atomic-write staging
/// path, whose final extension is `.part`, not `.jpg`. Without an explicit
/// `-f mjpeg`, ffmpeg fails with "Unable to choose an output format" and
/// writes nothing, which the caller was already treating as a normal,
/// silent `Ok(false)` — exactly why this shipped invisibly (confirmed by
/// actually running the real ffmpeg binary against a real video with this
/// exact input/output shape, not by reading this code).
fn ffmpeg_thumbnail_args<'a>(input: &'a str, output: &'a str, seconds: &'a str) -> Vec<&'a str> {
    vec![
        "-hide_banner",
        "-y",
        "-ss",
        seconds,
        "-i",
        input,
        "-frames:v",
        "1",
        "-q:v",
        THUMBNAIL_JPEG_QUALITY,
        "-f",
        "mjpeg",
        output,
    ]
}

/// Runs the ffmpeg sidecar to grab one frame from `input` (a video already
/// on disk — a vault blob has no file extension, but ffmpeg's demuxer probes
/// file content, not the extension, for `-i`) into `output` as a small JPEG.
/// Same sidecar-invocation shape as `ffmpeg.rs`'s `ffmpeg_probe_fps`
/// (`app.shell().sidecar("ffmpeg")`, one-shot `.output()`, no cancellation —
/// this is a fast, non-interactive extraction, not an export-length run).
async fn ffmpeg_extract_thumbnail(
    app: &tauri::AppHandle,
    input: &Path,
    output: &Path,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let input_str = input.to_str().ok_or("media_vault: input path is not valid UTF-8")?;
    let output_str = output.to_str().ok_or("media_vault: output path is not valid UTF-8")?;
    let seconds = THUMBNAIL_AT_SECONDS.to_string();
    let result = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar lookup: {e}"))?
        .args(ffmpeg_thumbnail_args(input_str, output_str, &seconds))
        .output()
        .await
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;
    if !result.status.success() {
        return Err(format!(
            "ffmpeg thumbnail extraction failed: {}",
            String::from_utf8_lossy(&result.stderr)
        ));
    }
    Ok(())
}

/// Pure precheck `media_vault_generate_thumbnail` runs before ever touching
/// ffmpeg or a `tauri::AppHandle` — unit-testable on its own.
enum ThumbnailPrecheck {
    /// The blob does not exist — nothing to thumbnail. Caller returns
    /// `Ok(false)` without spawning ffmpeg.
    NoBlob,
    /// A thumbnail already exists — idempotent no-op. Caller returns
    /// `Ok(true)` without spawning ffmpeg.
    AlreadyGenerated,
    /// Neither — the caller must actually run ffmpeg.
    NeedsGeneration { blob_path: PathBuf, thumb_path: PathBuf },
}

fn precheck_thumbnail(root: &Path, content_hash: &str) -> ThumbnailPrecheck {
    let blob = blob_path(root, content_hash);
    if !blob.exists() {
        return ThumbnailPrecheck::NoBlob;
    }
    let thumb = thumbnail_path(root, content_hash);
    if thumb.exists() {
        return ThumbnailPrecheck::AlreadyGenerated;
    }
    ThumbnailPrecheck::NeedsGeneration { blob_path: blob, thumb_path: thumb }
}

/// G6 Step 4a — generates (or reuses) a video's thumbnail, idempotently.
/// NEVER returns `Err` for a bad/corrupt/0-byte video or a missing blob —
/// every content-level failure is `Ok(false)`, mirroring the
/// `resolveVideoNativeFps` probe-failure pattern (App.tsx): a thumbnail is a
/// display convenience, never something the caller should have to treat as
/// fatal. Only an infrastructure-level failure (the storage root itself
/// unresolvable) propagates as `Err`.
#[tauri::command]
pub async fn media_vault_generate_thumbnail(app: tauri::AppHandle, content_hash: String) -> Result<bool, String> {
    let root = resolve_storage_root(&app)?;
    let (blob, thumb) = match precheck_thumbnail(&root, &content_hash) {
        ThumbnailPrecheck::NoBlob => return Ok(false),
        ThumbnailPrecheck::AlreadyGenerated => return Ok(true),
        ThumbnailPrecheck::NeedsGeneration { blob_path, thumb_path } => (blob_path, thumb_path),
    };
    let tmp = media_vault_dir(&root).join(format!("{content_hash}.thumb.jpg.part"));
    match ffmpeg_extract_thumbnail(&app, &blob, &tmp).await {
        Ok(()) => match fs::rename(&tmp, &thumb) {
            Ok(()) => Ok(true),
            Err(e) => {
                eprintln!("[media_vault] thumbnail rename failed for {content_hash}: {e}");
                let _ = fs::remove_file(&tmp);
                Ok(false)
            }
        },
        Err(e) => {
            eprintln!("[media_vault] thumbnail extraction failed for {content_hash}: {e}");
            let _ = fs::remove_file(&tmp);
            Ok(false)
        }
    }
}

/// `root`-based core of `media_vault_read_thumbnail`, split out for
/// testability without a `tauri::AppHandle` (same pattern as
/// `media_vault_import_bytes`/`media_vault_import`).
fn read_thumbnail(root: &Path, content_hash: &str) -> Result<Option<Vec<u8>>, String> {
    match fs::read(thumbnail_path(root, content_hash)) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("media_vault_read_thumbnail({content_hash}): {e}")),
    }
}

/// G6 Step 4a — reads back a previously generated thumbnail. `Ok(None)`
/// (never `Err`) when none exists yet — the caller (the Media block) reads
/// this AFTER `media_vault_generate_thumbnail`, but a missing file here is
/// exactly the same "nothing to show, fall back to an icon" case as a
/// generation failure, not a distinguishable error.
#[tauri::command]
pub fn media_vault_read_thumbnail(app: tauri::AppHandle, content_hash: String) -> Result<Option<Vec<u8>>, String> {
    read_thumbnail(&resolve_storage_root(&app)?, &content_hash)
}

/// G6 Step 6 (the dead-feature-gap fix) — removes `project_id` from
/// `content_hash`'s `referenced_by_project_ids`, so a subsequent reclaim can
/// see it as zero-ref once every referencer has done this. An unknown hash
/// (never imported, or a legacy/foreign hash from another vault) is a no-op,
/// not an error — the caller (asset delete, project delete) has no reliable
/// way to know in advance whether a given `contentHash` was ever actually
/// committed to THIS vault's registry, and refusing would turn an ordinary
/// "nothing to unreference" case into a spurious failure. Uses
/// `load_registry`/`save_registry` — the module's only registry
/// read/write pair — so this shares the exact same atomic-write discipline
/// (`write_bytes_atomic`, temp-file + rename) as `commit_registry_entry`;
/// there is no separate crash window here because unlike import, there is no
/// second phase to interleave with (removing a reference never touches the
/// blob file, only the registry).
pub fn unreference_project(root: &Path, content_hash: &str, project_id: &str) -> Result<(), String> {
    let mut registry = load_registry(root)?;
    let Some(entry) = registry.entries.get_mut(content_hash) else {
        return Ok(());
    };
    let before = entry.referenced_by_project_ids.len();
    entry.referenced_by_project_ids.retain(|p| p != project_id);
    if entry.referenced_by_project_ids.len() == before {
        return Ok(());
    }
    save_registry(root, &registry)
}

/// Media workflow Unit 1 — renames `content_hash`'s registry display name
/// (inline rename in the Media block; the project's own `Asset.name` is
/// renamed by the frontend). Trimmed; empty is refused. An unknown hash is a
/// no-op, same reasoning as `unreference_project`: a pre-vault asset has no
/// entry here, and its project-side rename must not fail over that. Same
/// `load_registry`/`save_registry` pair — the module's only registry
/// read/write — so the same atomic temp-file + rename write; the blob file
/// is never touched.
pub fn rename_display_name(root: &Path, content_hash: &str, display_name: &str) -> Result<(), String> {
    let name = display_name.trim();
    if name.is_empty() {
        return Err("media-vault: refusing to rename to an empty name".into());
    }
    let mut registry = load_registry(root)?;
    let Some(entry) = registry.entries.get_mut(content_hash) else {
        return Ok(());
    };
    if entry.display_name == name {
        return Ok(());
    }
    entry.display_name = name.to_string();
    save_registry(root, &registry)
}

/// Media workflow Unit 1 — the rename IPC surface; thin wrapper over the
/// `root`-based `rename_display_name`.
#[tauri::command]
pub fn media_vault_rename(
    app: tauri::AppHandle,
    content_hash: String,
    display_name: String,
) -> Result<(), String> {
    let root = resolve_storage_root(&app)?;
    rename_display_name(&root, &content_hash, &display_name)
}

/// G6 Step 6 (dead-feature-gap fix) — the unreference IPC surface. Thin
/// wrapper, same shape as `media_vault_list_entries`: all the logic lives in
/// the `root`-based `unreference_project` above, kept AppHandle-free for
/// unit testability.
#[tauri::command]
pub fn media_vault_unreference(
    app: tauri::AppHandle,
    content_hash: String,
    project_id: String,
) -> Result<(), String> {
    let root = resolve_storage_root(&app)?;
    unreference_project(&root, &content_hash, &project_id)
}

/// How many vault entries (and how many bytes of them) one project id holds a
/// reference on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ProjectRefTotals {
    pub entries: u64,
    pub bytes: u64,
}

/// Read-only: project id -> the vault references it holds. Feeds the storage
/// consistency scan (`storage_consistency.rs`). A missing registry is an
/// empty map, not an error (`load_registry`'s own contract).
pub fn project_reference_totals(root: &Path) -> Result<HashMap<String, ProjectRefTotals>, String> {
    let mut out: HashMap<String, ProjectRefTotals> = HashMap::new();
    for entry in load_registry(root)?.entries.values() {
        for id in &entry.referenced_by_project_ids {
            let t = out.entry(id.clone()).or_default();
            t.entries += 1;
            t.bytes += entry.size_bytes;
        }
    }
    Ok(out)
}

/// Drops EVERY reference `project_id` holds, whatever the project record
/// still lists. Deleting a project used to unreference only the hashes its
/// record listed at that moment, so a reference taken at import time for an
/// asset the record no longer (or never) listed stayed behind forever —
/// pinning the blob against reclaim. Returns how many references were dropped.
pub fn unreference_project_everywhere(root: &Path, project_id: &str) -> Result<u64, String> {
    let mut registry = load_registry(root)?;
    let mut dropped = 0u64;
    for entry in registry.entries.values_mut() {
        let before = entry.referenced_by_project_ids.len();
        entry.referenced_by_project_ids.retain(|p| p != project_id);
        dropped += (before - entry.referenced_by_project_ids.len()) as u64;
    }
    if dropped > 0 {
        save_registry(root, &registry)?;
    }
    Ok(dropped)
}

/// One reference a project holds, with everything needed to put it back.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRefRecord {
    pub content_hash: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub blob_path: String,
    pub blob_present: bool,
    /// Other projects holding this blob. Empty => dropping this ref leaves it
    /// unreferenced (reclaimable, never auto-deleted).
    pub other_referencers: Vec<String>,
}

/// Read-only: every vault reference `project_id` holds.
pub fn project_refs(root: &Path, project_id: &str) -> Result<Vec<ProjectRefRecord>, String> {
    let mut out: Vec<ProjectRefRecord> = load_registry(root)?
        .entries
        .values()
        .filter(|e| e.referenced_by_project_ids.iter().any(|p| p == project_id))
        .map(|e| ProjectRefRecord {
            content_hash: e.content_hash.clone(),
            display_name: e.display_name.clone(),
            size_bytes: e.size_bytes,
            blob_path: blob_path(root, &e.content_hash).display().to_string(),
            blob_present: blob_path(root, &e.content_hash).is_file(),
            other_referencers: e
                .referenced_by_project_ids
                .iter()
                .filter(|p| p.as_str() != project_id)
                .cloned()
                .collect(),
        })
        .collect();
    out.sort_by(|a, b| a.content_hash.cmp(&b.content_hash));
    Ok(out)
}

/// Puts back references recorded by `project_refs` (the reversal of a drop).
/// Only re-adds to entries that still exist; returns how many were restored.
pub fn restore_project_refs(root: &Path, project_id: &str, hashes: &[String]) -> Result<u64, String> {
    let mut registry = load_registry(root)?;
    let mut restored = 0u64;
    for h in hashes {
        if let Some(e) = registry.entries.get_mut(h) {
            if !e.referenced_by_project_ids.iter().any(|p| p == project_id) {
                e.referenced_by_project_ids.push(project_id.to_string());
                restored += 1;
            }
        }
    }
    if restored > 0 {
        save_registry(root, &registry)?;
    }
    Ok(restored)
}

#[tauri::command]
pub fn media_vault_unreference_project(app: tauri::AppHandle, project_id: String) -> Result<u64, String> {
    let root = resolve_storage_root(&app)?;
    unreference_project_everywhere(&root, &project_id)
}

/// G6 Step 6 — read-only counterpart to `reclaim_unreferenced_blobs`, for
/// `size_report`'s "reclaimable" figure. Same shape as
/// `project_mirror::store_backups_stale_bytes` (the read-only twin of its
/// own sweep) — the number shown to the operator must always match what a
/// reclaim would actually free, never the whole subtree's current size.
pub fn zero_ref_bytes(root: &Path) -> Result<u64, String> {
    Ok(load_registry(root)?
        .entries
        .values()
        .filter(|e| e.referenced_by_project_ids.is_empty())
        .map(|e| e.size_bytes)
        .sum())
}

/// G6 Step 6 — the Reclaim button's media-vault sweep: deletes every
/// zero-ref blob (via `safe_delete::delete_media_vault_blob`, the ONLY
/// permitted way — see that function's own doc comment) and removes its
/// registry entry, returning total bytes freed. A per-blob delete failure is
/// logged and skipped, leaving that entry's registry row in place so the
/// NEXT reclaim pass retries it — one stuck blob must never block reclaiming
/// the rest. Only `load_registry`/`save_registry` failing (a corrupt
/// registry) propagates as `Err`; per-blob failures never do.
pub fn reclaim_unreferenced_blobs(root: &Path) -> Result<u64, String> {
    let mut registry = load_registry(root)?;
    let zero_ref: Vec<String> = registry
        .entries
        .iter()
        .filter(|(_, e)| e.referenced_by_project_ids.is_empty())
        .map(|(hash, _)| hash.clone())
        .collect();
    if zero_ref.is_empty() {
        return Ok(0);
    }

    let mut reclaimed = 0u64;
    let mut removed_any = false;
    for hash in zero_ref {
        let Some(entry) = registry.entries.get(&hash) else { continue };
        // Defense in depth: re-check the invariant right before deleting,
        // even though `zero_ref` was already filtered on it above — this is
        // the ONE call site `refuse_delete_if_referenced` exists for.
        if refuse_delete_if_referenced(entry).is_err() {
            continue;
        }
        let size = entry.size_bytes;
        match crate::safe_delete::delete_media_vault_blob(&media_vault_dir(root), &hash) {
            Ok(()) => {
                reclaimed += size;
                registry.entries.remove(&hash);
                removed_any = true;
            }
            Err(e) => eprintln!("[media_vault] reclaim: failed to delete blob {hash}, will retry next reclaim: {e}"),
        }
    }
    if removed_any {
        save_registry(root, &registry)?;
    }
    Ok(reclaimed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kinetix-media-vault-test-{tag}-{}", now_millis()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    // OLD BUG (G6 fix round) — ffmpeg's output muxer picks a format from the
    // filename's FINAL extension only. The real `output` path passed here is
    // `{hash}.thumb.jpg.part` (atomic-write staging), whose final extension
    // is `.part` — with no explicit `-f`, ffmpeg refused to write anything
    // ("Unable to choose an output format"), silently swallowed by this
    // command's `Ok(false)` contract for any content-level failure. Verified
    // against the real ffmpeg binary + a real video by hand (both are
    // gitignored, so not wired into this suite) before this fix landed; this
    // guards the arg SHAPE so `-f mjpeg` can never silently drop again.
    #[test]
    fn thumbnail_args_pin_an_explicit_output_format_after_the_dot_part_staging_path() {
        let args = ffmpeg_thumbnail_args("/vault/blobs/abc123", "/vault/media/abc123.thumb.jpg.part", "1");

        let f_pos = args.iter().position(|a| *a == "-f").expect("-f flag must be present");
        assert_eq!(args[f_pos + 1], "mjpeg", "must force mjpeg — the output filename's final extension is .part, not .jpg");
        assert_eq!(args.last(), Some(&"/vault/media/abc123.thumb.jpg.part"));
        assert_eq!(args[f_pos + 1..].len(), 2, "-f mjpeg must come right before the output path, not after it");
    }

    #[test]
    fn deleting_a_project_drops_every_reference_it_holds_even_ones_its_record_never_listed() {
        let root = tmpdir("unref-everywhere");
        // Real files: three imports by "proj-gone", one by "proj-keep" sharing a blob.
        let a = media_vault_import_bytes(&root, "proj-gone", b"listed", "a.jpg", "image/jpeg").unwrap();
        let b = media_vault_import_bytes(&root, "proj-gone", b"never listed in the record", "b.jpg", "image/jpeg").unwrap();
        let shared = media_vault_import_bytes(&root, "proj-gone", b"shared", "c.jpg", "image/jpeg").unwrap();
        media_vault_import_bytes(&root, "proj-keep", b"shared", "c.jpg", "image/jpeg").unwrap();

        // The OLD delete path: unreference only the hashes the record lists (here: just `a`).
        unreference_project(&root, &a.content_hash, "proj-gone").unwrap();
        let totals = project_reference_totals(&root).unwrap();
        assert_eq!(totals["proj-gone"].entries, 2, "old path leaves the refs the record did not list — the leak");

        let dropped = unreference_project_everywhere(&root, "proj-gone").unwrap();
        assert_eq!(dropped, 2);
        let totals = project_reference_totals(&root).unwrap();
        assert!(!totals.contains_key("proj-gone"));
        assert_eq!(totals["proj-keep"].entries, 1, "other projects' references are untouched");
        // b is now zero-ref and reclaimable; the shared blob is still held by proj-keep.
        let reclaimed = reclaim_unreferenced_blobs(&root).unwrap();
        assert!(reclaimed >= b.size_bytes);
        assert!(!blob_path(&root, &b.content_hash).exists());
        assert!(blob_path(&root, &shared.content_hash).exists());
        // Idempotent.
        assert_eq!(unreference_project_everywhere(&root, "proj-gone").unwrap(), 0);
    }

    #[test]
    fn import_writes_a_content_addressed_blob_and_a_registry_entry() {
        let root = tmpdir("import");
        let entry = media_vault_import_bytes(&root, "proj-1", b"hello world", "clip.mp4", "video/mp4").unwrap();

        assert_eq!(entry.display_name, "clip.mp4");
        assert_eq!(entry.mime_type, "video/mp4");
        assert_eq!(entry.size_bytes, 11);
        assert_eq!(entry.referenced_by_project_ids, vec!["proj-1".to_string()]);

        let blob = blob_path(&root, &entry.content_hash);
        assert!(blob.exists());
        assert_eq!(fs::read(&blob).unwrap(), b"hello world");

        let listed = media_vault_list(&root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0], entry);
    }

    #[test]
    fn same_bytes_from_a_second_project_dedupe_to_one_blob_with_both_referencers() {
        let root = tmpdir("dedupe");
        let first = media_vault_import_bytes(&root, "proj-1", b"same bytes", "a.mp4", "video/mp4").unwrap();
        let second = media_vault_import_bytes(&root, "proj-2", b"same bytes", "a-renamed.mp4", "video/mp4").unwrap();

        assert_eq!(first.content_hash, second.content_hash);
        // First writer's display name/mime win — a later importer of the
        // SAME bytes only adds itself as a referencer, it does not rename
        // an entry other projects already know by its original name.
        assert_eq!(second.display_name, "a.mp4");

        let listed = media_vault_list(&root).unwrap();
        assert_eq!(listed.len(), 1, "one distinct hash must be exactly one vault entry");
        let mut refs = listed[0].referenced_by_project_ids.clone();
        refs.sort();
        assert_eq!(refs, vec!["proj-1".to_string(), "proj-2".to_string()]);
    }

    #[test]
    fn re_importing_the_same_bytes_never_rewrites_the_blob_file() {
        let root = tmpdir("no-rewrite");
        let entry = media_vault_import_bytes(&root, "proj-1", b"stable content", "a.mp4", "video/mp4").unwrap();
        let blob = blob_path(&root, &entry.content_hash);
        let mtime_before = fs::metadata(&blob).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(20));
        media_vault_import_bytes(&root, "proj-1", b"stable content", "a.mp4", "video/mp4").unwrap();

        let mtime_after = fs::metadata(&blob).unwrap().modified().unwrap();
        assert_eq!(mtime_before, mtime_after, "an unchanged hash must skip the blob write entirely");
    }

    #[test]
    fn importing_the_same_project_twice_does_not_duplicate_its_reference() {
        let root = tmpdir("dedupe-referencer");
        media_vault_import_bytes(&root, "proj-1", b"x", "a.png", "image/png").unwrap();
        let entry = media_vault_import_bytes(&root, "proj-1", b"x", "a.png", "image/png").unwrap();
        assert_eq!(entry.referenced_by_project_ids, vec!["proj-1".to_string()]);
    }

    // -----------------------------------------------------------------
    // G6 Step 2's own named requirement: "kill between blob-write and
    // registry-commit -> next boot shows entry fully present or fully
    // absent, never dangling." A real process kill can't be simulated in a
    // unit test, but the two phases are separate functions FOR exactly this
    // reason — calling phase 1 alone and stopping there is a structurally
    // exact stand-in for "the process died right there": nothing on either
    // side of that boundary knows or cares whether the next line of code is
    // phase 2 or a SIGKILL.
    // -----------------------------------------------------------------
    #[test]
    fn crash_between_blob_write_and_registry_commit_leaves_no_dangling_entry() {
        let root = tmpdir("crash-window");

        // Phase 1 only — the "crash" happens here, before phase 2 ever runs.
        let content_hash = write_blob_if_absent(&root, b"orphaned by a kill").unwrap();
        assert!(blob_path(&root, &content_hash).exists(), "phase 1 itself must still be durable");

        // "Next boot": the registry was never touched, so nothing shows an
        // entry — not a dangling one, none at all. This IS "fully absent",
        // not a partial state a caller could mistake for success.
        let listed_after_crash = media_vault_list(&root).unwrap();
        assert!(listed_after_crash.is_empty(), "a phase-1-only write must be invisible to the registry");

        // Resuming (a plain retry of the SAME import, exactly what a user
        // re-attempting a failed import would trigger) finds the orphaned
        // blob already on disk, skips rewriting it, and completes cleanly —
        // no special "resume" code path, no leftover trace of the crash.
        let entry = media_vault_import_bytes(&root, "proj-1", b"orphaned by a kill", "clip.mp4", "video/mp4").unwrap();
        assert_eq!(entry.content_hash, content_hash);
        let listed_after_resume = media_vault_list(&root).unwrap();
        assert_eq!(listed_after_resume.len(), 1, "exactly one entry — fully present now, no duplicate/dangling residue");
    }

    #[test]
    fn refuse_delete_if_referenced_blocks_only_when_a_project_still_uses_it() {
        let referenced = MediaVaultEntry {
            content_hash: "h1".into(),
            display_name: "a.mp4".into(),
            mime_type: "video/mp4".into(),
            size_bytes: 1,
            added_at_ms: 0,
            referenced_by_project_ids: vec!["proj-1".into()],
        };
        assert!(refuse_delete_if_referenced(&referenced).is_err());

        let orphaned = MediaVaultEntry { referenced_by_project_ids: vec![], ..referenced };
        assert!(refuse_delete_if_referenced(&orphaned).is_ok());
    }

    #[test]
    fn missing_registry_file_is_an_empty_vault_not_an_error() {
        let root = tmpdir("missing-registry");
        assert_eq!(media_vault_list(&root).unwrap(), vec![]);
    }

    #[test]
    fn corrupt_registry_file_is_a_real_error_never_silently_treated_as_empty() {
        let root = tmpdir("corrupt-registry");
        fs::create_dir_all(media_vault_dir(&root)).unwrap();
        fs::write(registry_path(&root), b"{ not json").unwrap();
        assert!(media_vault_list(&root).is_err());
    }

    #[test]
    fn decode_display_name_header_round_trips_non_ascii_names() {
        // G6 Step 3's own reason for existing: a raw header value cannot
        // safely carry this. base64 of the UTF-8 bytes can.
        let name = "café_🎬_日本語.mp4";
        let encoded = base64::engine::general_purpose::STANDARD.encode(name.as_bytes());
        assert_eq!(decode_display_name_header(&encoded).unwrap(), name);
    }

    #[test]
    fn decode_display_name_header_rejects_invalid_base64_and_invalid_utf8() {
        assert!(decode_display_name_header("not valid base64!!!").is_err());
        // Valid base64 that decodes to bytes which are NOT valid UTF-8
        // (0xFF, 0xFE is an invalid UTF-8 sequence).
        let invalid_utf8 = base64::engine::general_purpose::STANDARD.encode([0xFFu8, 0xFE]);
        assert!(decode_display_name_header(&invalid_utf8).is_err());
    }

    #[test]
    fn precheck_thumbnail_reports_no_blob_when_nothing_was_ever_imported() {
        let root = tmpdir("thumb-no-blob");
        assert!(matches!(precheck_thumbnail(&root, "deadbeef"), ThumbnailPrecheck::NoBlob));
    }

    #[test]
    fn precheck_thumbnail_reports_already_generated_and_skips_regeneration() {
        let root = tmpdir("thumb-already");
        let entry = media_vault_import_bytes(&root, "proj-1", b"fake video bytes", "clip.mp4", "video/mp4").unwrap();
        fs::write(thumbnail_path(&root, &entry.content_hash), b"fake jpeg").unwrap();
        assert!(matches!(
            precheck_thumbnail(&root, &entry.content_hash),
            ThumbnailPrecheck::AlreadyGenerated
        ));
    }

    #[test]
    fn precheck_thumbnail_reports_needs_generation_for_an_imported_blob_with_no_thumb_yet() {
        let root = tmpdir("thumb-needs-gen");
        let entry = media_vault_import_bytes(&root, "proj-1", b"fake video bytes", "clip.mp4", "video/mp4").unwrap();
        match precheck_thumbnail(&root, &entry.content_hash) {
            ThumbnailPrecheck::NeedsGeneration { blob_path, thumb_path } => {
                assert!(blob_path.exists());
                assert!(!thumb_path.exists());
            }
            _ => panic!("expected NeedsGeneration"),
        }
    }

    #[test]
    fn read_thumbnail_is_none_not_an_error_when_nothing_was_generated() {
        let root = tmpdir("read-thumb-missing");
        assert_eq!(read_thumbnail(&root, "deadbeef").unwrap(), None);
    }

    #[test]
    fn read_thumbnail_returns_the_bytes_once_present() {
        let root = tmpdir("read-thumb-present");
        fs::create_dir_all(media_vault_dir(&root)).unwrap();
        fs::write(thumbnail_path(&root, "deadbeef"), b"fake jpeg bytes").unwrap();
        assert_eq!(read_thumbnail(&root, "deadbeef").unwrap(), Some(b"fake jpeg bytes".to_vec()));
    }

    // -----------------------------------------------------------------
    // G6 Step 6 — storage hygiene. The operator's own named test list:
    // "referenced blob -> refused; orphan -> deleted; disk space drops."
    // -----------------------------------------------------------------

    #[test]
    fn zero_ref_bytes_counts_only_unreferenced_entries() {
        let root = tmpdir("zero-ref-bytes");
        media_vault_import_bytes(&root, "proj-1", b"referenced", "a.jpg", "image/jpeg").unwrap();
        let orphan = media_vault_import_bytes(&root, "proj-1", b"orphaned bytes!!", "b.jpg", "image/jpeg").unwrap();
        // Drives the registry directly (rather than through
        // `unreference_project`) to reach a real zero-ref state — this test
        // is about `zero_ref_bytes`'s own counting logic, not the
        // unreference wiring, which has its own tests below.
        let mut registry = load_registry(&root).unwrap();
        registry.entries.get_mut(&orphan.content_hash).unwrap().referenced_by_project_ids.clear();
        save_registry(&root, &registry).unwrap();

        assert_eq!(zero_ref_bytes(&root).unwrap(), orphan.size_bytes);
    }

    #[test]
    fn reclaim_deletes_only_the_orphan_a_referenced_blob_is_refused_and_survives() {
        let root = tmpdir("reclaim-mixed");
        let referenced = media_vault_import_bytes(&root, "proj-1", b"still used", "a.jpg", "image/jpeg").unwrap();
        let orphan = media_vault_import_bytes(&root, "proj-1", b"nobody wants this", "b.jpg", "image/jpeg").unwrap();
        let mut registry = load_registry(&root).unwrap();
        registry.entries.get_mut(&orphan.content_hash).unwrap().referenced_by_project_ids.clear();
        save_registry(&root, &registry).unwrap();

        let disk_before = dir_size_for_test(&root);
        let reclaimed = reclaim_unreferenced_blobs(&root).unwrap();
        let disk_after = dir_size_for_test(&root);

        assert_eq!(reclaimed, orphan.size_bytes, "reclaimed bytes must equal exactly the orphan's size");
        assert!(disk_after < disk_before, "disk space must actually drop");
        assert!(!blob_path(&root, &orphan.content_hash).exists(), "the orphan blob must be gone");
        assert!(blob_path(&root, &referenced.content_hash).exists(), "the still-referenced blob must survive — refused, not deleted");

        let listed = media_vault_list(&root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].content_hash, referenced.content_hash);
    }

    #[test]
    fn reclaim_is_a_no_op_when_nothing_is_unreferenced() {
        let root = tmpdir("reclaim-noop");
        media_vault_import_bytes(&root, "proj-1", b"in use", "a.jpg", "image/jpeg").unwrap();
        assert_eq!(reclaim_unreferenced_blobs(&root).unwrap(), 0);
        assert_eq!(media_vault_list(&root).unwrap().len(), 1);
    }

    fn dir_size_for_test(dir: &Path) -> u64 {
        let mut total = 0u64;
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    total += meta.len();
                }
            }
        }
        total
    }

    // -----------------------------------------------------------------
    // G6 Step 6 (dead-feature-gap fix) — `unreference_project`. OLD BUG
    // FIRST: before this landed, nothing ever called anything that removed a
    // project id from `referenced_by_project_ids`, so a blob reached zero-ref
    // status only via a hand-edited registry (exactly what
    // `zero_ref_bytes_counts_only_unreferenced_entries` above does). These
    // tests exercise the real path end to end: import -> use -> delete ->
    // reclaimable.
    // -----------------------------------------------------------------

    #[test]
    fn a_blob_referenced_by_one_project_is_not_reclaimable_before_unreference_and_is_after() {
        let root = tmpdir("unref-single");
        let entry = media_vault_import_bytes(&root, "proj-1", b"one project's asset", "a.mp4", "video/mp4").unwrap();

        assert_eq!(zero_ref_bytes(&root).unwrap(), 0, "still referenced — not reclaimable yet");

        unreference_project(&root, &entry.content_hash, "proj-1").unwrap();

        assert_eq!(zero_ref_bytes(&root).unwrap(), entry.size_bytes, "no referencers left — now reclaimable");
        let reclaimed = reclaim_unreferenced_blobs(&root).unwrap();
        assert_eq!(reclaimed, entry.size_bytes);
        assert!(!blob_path(&root, &entry.content_hash).exists());
    }

    #[test]
    fn a_blob_referenced_by_two_projects_survives_one_deletion_reclaimable_only_after_both() {
        let root = tmpdir("unref-two-projects");
        let entry = media_vault_import_bytes(&root, "proj-1", b"shared bytes", "a.mp4", "video/mp4").unwrap();
        media_vault_import_bytes(&root, "proj-2", b"shared bytes", "a-copy.mp4", "video/mp4").unwrap();

        unreference_project(&root, &entry.content_hash, "proj-1").unwrap();
        assert_eq!(zero_ref_bytes(&root).unwrap(), 0, "proj-2 still references it");
        assert!(blob_path(&root, &entry.content_hash).exists());

        unreference_project(&root, &entry.content_hash, "proj-2").unwrap();
        assert_eq!(zero_ref_bytes(&root).unwrap(), entry.size_bytes, "both referencers gone — reclaimable now");
        reclaim_unreferenced_blobs(&root).unwrap();
        assert!(!blob_path(&root, &entry.content_hash).exists());
    }

    #[test]
    fn unreferencing_an_unknown_hash_is_a_no_op_not_an_error() {
        let root = tmpdir("unref-unknown-hash");
        media_vault_import_bytes(&root, "proj-1", b"real entry", "a.mp4", "video/mp4").unwrap();
        // A hash never imported into THIS vault (legacy/foreign) must not
        // error — the caller (asset/project delete) cannot know in advance
        // whether a given contentHash was ever actually committed here.
        assert!(unreference_project(&root, "never-imported-hash", "proj-1").is_ok());
        assert_eq!(media_vault_list(&root).unwrap().len(), 1, "the unrelated real entry is untouched");
    }

    #[test]
    fn unreferencing_a_project_that_is_not_a_referencer_is_a_no_op() {
        let root = tmpdir("unref-not-a-referencer");
        let entry = media_vault_import_bytes(&root, "proj-1", b"bytes", "a.mp4", "video/mp4").unwrap();
        unreference_project(&root, &entry.content_hash, "proj-never-used-this").unwrap();
        let listed = media_vault_list(&root).unwrap();
        assert_eq!(listed[0].referenced_by_project_ids, vec!["proj-1".to_string()], "proj-1's reference must survive untouched");
    }

    #[test]
    fn unreferencing_the_same_project_twice_is_idempotent() {
        let root = tmpdir("unref-idempotent");
        let entry = media_vault_import_bytes(&root, "proj-1", b"bytes", "a.mp4", "video/mp4").unwrap();
        unreference_project(&root, &entry.content_hash, "proj-1").unwrap();
        // Second call finds proj-1 already gone from the list — must stay Ok,
        // not error on "already removed."
        assert!(unreference_project(&root, &entry.content_hash, "proj-1").is_ok());
        assert_eq!(zero_ref_bytes(&root).unwrap(), entry.size_bytes);
    }

    // Crash-safety: `unreference_project` goes through the same
    // `load_registry`/`save_registry` pair as every other registry mutator in
    // this module, so it inherits `write_bytes_atomic`'s temp-file+rename
    // guarantee — a kill mid-write leaves the PREVIOUS registry contents on
    // disk (the rename never happened), never a half-written file. This test
    // pins the no-op case's OTHER half of that guarantee: when nothing
    // actually changes, this function must not touch the registry file at
    // all, so a no-op call can never be the thing a crash catches mid-write.
    #[test]
    fn a_no_op_unreference_never_rewrites_the_registry_file() {
        let root = tmpdir("unref-noop-no-write");
        let entry = media_vault_import_bytes(&root, "proj-1", b"bytes", "a.mp4", "video/mp4").unwrap();
        let mtime_before = fs::metadata(registry_path(&root)).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(20));
        // Neither branch here changes anything: an unknown hash, and a known
        // hash with a project id that was never a referencer.
        unreference_project(&root, "unknown-hash", "proj-1").unwrap();
        unreference_project(&root, &entry.content_hash, "proj-never-referenced-this").unwrap();

        let mtime_after = fs::metadata(registry_path(&root)).unwrap().modified().unwrap();
        assert_eq!(mtime_before, mtime_after, "a no-op unreference must skip the registry write entirely");
    }

    // Media workflow Unit 1 — inline rename in the Media block renames the
    // registry's display name too (the project's Asset.name is the match key;
    // this keeps the vault's own label in step).
    #[test]
    fn rename_updates_only_the_display_name_and_persists_it() {
        let root = tmpdir("rename");
        let entry = media_vault_import_bytes(&root, "proj-1", b"rename me", "wrong.png", "image/png").unwrap();
        let blob_before = fs::read(blob_path(&root, &entry.content_hash)).unwrap();

        rename_display_name(&root, &entry.content_hash, "  001_intro.png  ").unwrap();

        let listed = media_vault_list(&root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].display_name, "001_intro.png", "trimmed, and read back from disk");
        assert_eq!(listed[0].referenced_by_project_ids, entry.referenced_by_project_ids);
        assert_eq!(listed[0].size_bytes, entry.size_bytes);
        assert_eq!(fs::read(blob_path(&root, &entry.content_hash)).unwrap(), blob_before, "the blob is never touched");
    }

    #[test]
    fn rename_to_an_empty_name_is_refused_and_writes_nothing() {
        let root = tmpdir("rename-empty");
        let entry = media_vault_import_bytes(&root, "proj-1", b"x", "keep.png", "image/png").unwrap();
        assert!(rename_display_name(&root, &entry.content_hash, "   ").is_err());
        assert_eq!(media_vault_list(&root).unwrap()[0].display_name, "keep.png");
    }

    #[test]
    fn rename_of_an_unknown_hash_is_a_no_op_not_an_error() {
        // A pre-vault (legacy) asset has no registry entry — renaming it in
        // the project must still work, so the vault half declines quietly.
        let root = tmpdir("rename-unknown");
        media_vault_import_bytes(&root, "proj-1", b"y", "a.png", "image/png").unwrap();
        let mtime_before = fs::metadata(registry_path(&root)).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        rename_display_name(&root, "unknown-hash", "b.png").unwrap();
        let mtime_after = fs::metadata(registry_path(&root)).unwrap().modified().unwrap();
        assert_eq!(mtime_before, mtime_after);
    }
}
