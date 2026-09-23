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
///
/// `#[allow(dead_code)]`: no `#[tauri::command]` calls this yet — Step 4
/// wires the Media block UI to it. Exercised today by this module's own
/// tests; remove the attribute once Step 4 lands a real caller.
#[allow(dead_code)]
pub fn media_vault_list(root: &Path) -> Result<Vec<MediaVaultEntry>, String> {
    Ok(load_registry(root)?.entries.into_values().collect())
}

/// G6 Step 2's delete-refusal invariant, factored out as a pure function
/// (no filesystem access) so Step 6's Reclaim flow — which will add the
/// actual blob removal via a NEW hash-addressed single-file delete helper,
/// registered on `safe_delete.rs`'s pinned tripwire list per that step's own
/// plan — can check this FIRST and never reach the filesystem for a blob any
/// project still references.
///
/// `#[allow(dead_code)]`: no caller yet — Step 6 builds the Reclaim flow
/// that calls this. Exercised today by this module's own tests; remove the
/// attribute once Step 6 lands a real caller.
#[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kinetix-media-vault-test-{tag}-{}", now_millis()));
        fs::create_dir_all(&d).unwrap();
        d
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
}
