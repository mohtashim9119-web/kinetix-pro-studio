//! Per-project dashboard preview frames — content-addressed JPEG on disk.
//!
//! Layout: `<storage_root>/projects/<project_id>/thumbs/<preview_hash>.jpg`
//!
//! Writes go unique-temp → fsync file → rename (see `atomic_stage::write_bytes_atomic`).
//! A crash before rename leaves only a `.part` sibling; `read` never treats a
//! `.part` as the thumbnail (no torn JPEG on the card).

use std::fs;
use std::path::{Path, PathBuf};

use crate::atomic_stage::write_bytes_atomic;
use crate::storage_root::{projects_dir, resolve_storage_root};

fn safe_component(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(id)
    } else {
        Err(format!("refusing unsafe id for a project thumbnail path: {id:?}"))
    }
}

fn safe_hash(hash: &str) -> Result<&str, String> {
    let ok = (8..=64).contains(&hash.len())
        && hash.chars().all(|c| c.is_ascii_hexdigit());
    if ok {
        Ok(hash)
    } else {
        Err(format!("refusing unsafe preview hash for a thumbnail path: {hash:?}"))
    }
}

pub(crate) fn thumbnail_path(root: &Path, project_id: &str, hash: &str) -> Result<PathBuf, String> {
    let project_id = safe_component(project_id)?;
    let hash = safe_hash(hash)?;
    Ok(projects_dir(root)
        .join(project_id)
        .join("thumbs")
        .join(format!("{hash}.jpg")))
}

/// JPEG SOI — a leftover `.part` or empty dest must not be served as a frame.
fn looks_like_jpeg(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0] == 0xFF && bytes[1] == 0xD8
}

pub(crate) fn write_thumbnail(root: &Path, project_id: &str, hash: &str, jpeg: &[u8]) -> Result<(), String> {
    if !looks_like_jpeg(jpeg) {
        return Err("project_thumbnail_write: body is not a JPEG".into());
    }
    let dest = thumbnail_path(root, project_id, hash)?;
    write_bytes_atomic(&dest, jpeg)
}

pub(crate) fn read_thumbnail(root: &Path, project_id: &str, hash: &str) -> Result<Option<Vec<u8>>, String> {
    let dest = thumbnail_path(root, project_id, hash)?;
    match fs::read(&dest) {
        Ok(bytes) if looks_like_jpeg(&bytes) => Ok(Some(bytes)),
        Ok(_) => Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("project_thumbnail_read: {e}")),
    }
}

pub(crate) fn has_thumbnail(root: &Path, project_id: &str, hash: &str) -> Result<bool, String> {
    Ok(read_thumbnail(root, project_id, hash)?.is_some())
}

#[tauri::command]
pub fn project_thumbnail_write(request: tauri::ipc::Request<'_>, app: tauri::AppHandle) -> Result<(), String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data,
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("project_thumbnail_write: expected a raw byte body, got JSON".into());
        }
    };
    let headers = request.headers();
    let header = |name: &str| -> Result<String, String> {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("project_thumbnail_write: missing '{name}' header"))
    };
    let project_id = header("project-id")?;
    let hash = header("preview-hash")?;
    let root = resolve_storage_root(&app)?;
    write_thumbnail(&root, &project_id, &hash, bytes)
}

#[tauri::command]
pub fn project_thumbnail_read(
    app: tauri::AppHandle,
    project_id: String,
    preview_hash: String,
) -> Result<Option<Vec<u8>>, String> {
    let root = resolve_storage_root(&app)?;
    read_thumbnail(&root, &project_id, &preview_hash)
}

#[tauri::command]
pub fn project_thumbnail_has(
    app: tauri::AppHandle,
    project_id: String,
    preview_hash: String,
) -> Result<bool, String> {
    let root = resolve_storage_root(&app)?;
    has_thumbnail(&root, &project_id, &preview_hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atomic_stage::{unique_part_path, TEST_SKIP_FSYNC};
    use std::io::Write;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "kinetix-thumb-test-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn jpeg_a() -> Vec<u8> {
        vec![0xFF, 0xD8, 0xFF, 0xE0, b'A', 0xFF, 0xD9]
    }
    fn jpeg_b() -> Vec<u8> {
        vec![0xFF, 0xD8, 0xFF, 0xE0, b'B', 0xFF, 0xD9]
    }

    #[test]
    fn two_projects_keep_independent_frames() {
        TEST_SKIP_FSYNC.store(true, std::sync::atomic::Ordering::Relaxed);
        let root = tmp("two");
        write_thumbnail(&root, "proj-a", "aaaaaaaa", &jpeg_a()).unwrap();
        write_thumbnail(&root, "proj-b", "bbbbbbbb", &jpeg_b()).unwrap();
        assert_eq!(read_thumbnail(&root, "proj-a", "aaaaaaaa").unwrap().unwrap(), jpeg_a());
        assert_eq!(read_thumbnail(&root, "proj-b", "bbbbbbbb").unwrap().unwrap(), jpeg_b());
        TEST_SKIP_FSYNC.store(false, std::sync::atomic::Ordering::Relaxed);
    }

    #[test]
    fn crash_before_rename_leaves_placeholder_not_partial() {
        TEST_SKIP_FSYNC.store(true, std::sync::atomic::Ordering::Relaxed);
        let root = tmp("crash");
        let dest = thumbnail_path(&root, "proj-c", "cccccccc").unwrap();
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        let part = unique_part_path(&dest).unwrap();
        {
            let mut f = fs::File::create(&part).unwrap();
            f.write_all(&[0xFF, 0xD8, 0x00]).unwrap();
        }
        assert!(!dest.exists());
        assert!(read_thumbnail(&root, "proj-c", "cccccccc").unwrap().is_none());
        TEST_SKIP_FSYNC.store(false, std::sync::atomic::Ordering::Relaxed);
    }

    #[test]
    fn rekey_writes_new_hash_leaves_old_file() {
        TEST_SKIP_FSYNC.store(true, std::sync::atomic::Ordering::Relaxed);
        let root = tmp("rekey");
        write_thumbnail(&root, "proj-d", "11111111", &jpeg_a()).unwrap();
        write_thumbnail(&root, "proj-d", "22222222", &jpeg_b()).unwrap();
        assert_eq!(read_thumbnail(&root, "proj-d", "11111111").unwrap().unwrap(), jpeg_a());
        assert_eq!(read_thumbnail(&root, "proj-d", "22222222").unwrap().unwrap(), jpeg_b());
        TEST_SKIP_FSYNC.store(false, std::sync::atomic::Ordering::Relaxed);
    }

    #[test]
    fn non_jpeg_body_is_refused() {
        TEST_SKIP_FSYNC.store(true, std::sync::atomic::Ordering::Relaxed);
        let root = tmp("bad");
        let err = write_thumbnail(&root, "proj-e", "eeeeeeee", &[0, 1, 2, 3]).unwrap_err();
        assert!(err.contains("JPEG"));
        assert!(read_thumbnail(&root, "proj-e", "eeeeeeee").unwrap().is_none());
        TEST_SKIP_FSYNC.store(false, std::sync::atomic::Ordering::Relaxed);
    }
}
