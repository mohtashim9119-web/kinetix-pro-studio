//! Crash-safe deleted-project registry (`deleted-projects.json` at the storage
//! root). Once an id is listed here, no load or write path may resurrect it.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static GATE: Mutex<()> = Mutex::new(());

fn lock_gate() -> std::sync::MutexGuard<'static, ()> {
    GATE.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn tombstone_file(root: &Path) -> PathBuf {
    root.join("deleted-projects.json")
}

pub fn load_ids(root: &Path) -> BTreeSet<String> {
    let path = tombstone_file(root);
    let Ok(raw) = fs::read_to_string(&path) else {
        return BTreeSet::new();
    };
    match serde_json::from_str::<Vec<String>>(&raw) {
        Ok(list) => list.into_iter().filter(|s| !s.is_empty()).collect(),
        Err(_) => BTreeSet::new(),
    }
}

pub fn is_tombstoned(root: &Path, id: &str) -> bool {
    load_ids(root).contains(id)
}

/// Merge `ids` into the on-disk set with a unique-temp atomic write.
pub fn add_ids(root: &Path, ids: &[String]) -> Result<Vec<String>, String> {
    if ids.is_empty() {
        return Ok(load_ids(root).into_iter().collect());
    }
    let _gate = lock_gate();
    let mut set = load_ids(root);
    for id in ids {
        if !id.is_empty() {
            set.insert(id.clone());
        }
    }
    let list: Vec<String> = set.into_iter().collect();
    fs::create_dir_all(root).map_err(|e| format!("tombstones create_dir: {e}"))?;
    let payload = serde_json::to_vec(&list).map_err(|e| format!("tombstones encode: {e}"))?;
    crate::atomic_stage::write_bytes_atomic(&tombstone_file(root), &payload)?;
    Ok(list)
}

#[tauri::command]
pub fn project_tombstones_add(app: tauri::AppHandle, ids: Vec<String>) -> Result<Vec<String>, String> {
    let root = crate::storage_root::resolve_storage_root(&app)?;
    add_ids(&root, &ids)
}

#[tauri::command]
pub fn project_tombstones_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let root = crate::storage_root::resolve_storage_root(&app)?;
    Ok(load_ids(&root).into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp(tag: &str) -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "kinetix-tombstones-{}-{}-{}",
            tag,
            std::process::id(),
            n
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn add_survives_a_fresh_read_like_a_crash_relaunch() {
        let dir = tmp("crash");
        add_ids(&dir, &["dead-a".into(), "dead-b".into()]).unwrap();
        assert!(is_tombstoned(&dir, "dead-a"));
        assert!(is_tombstoned(&dir, "dead-b"));
        assert!(!is_tombstoned(&dir, "live"));
        let again = load_ids(&dir);
        assert!(again.contains("dead-a"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_is_idempotent_and_never_drops_prior_ids() {
        let dir = tmp("merge");
        add_ids(&dir, &["a".into()]).unwrap();
        add_ids(&dir, &["b".into(), "a".into()]).unwrap();
        let ids = load_ids(&dir);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains("a") && ids.contains("b"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn relocate_moves_tombstones_off_the_old_root() {
        let old = tmp("tomb-old");
        let new = tmp("D-DATA-Kinetix-Storage");
        add_ids(&old, &["dead-1".into()]).unwrap();
        add_ids(&new, &["dead-2".into()]).unwrap();
        assert!(relocate_to(&old, &new).unwrap());
        assert!(!tombstone_file(&old).exists(), "must not leave tombstones on the old root");
        assert!(is_tombstoned(&new, "dead-1"));
        assert!(is_tombstoned(&new, "dead-2"));
        let _ = fs::remove_dir_all(&old);
        let _ = fs::remove_dir_all(&new);
    }

    #[test]
    fn d_drive_style_path_joins_the_tombstone_filename() {
        let root = PathBuf::from(r"D:\DATA\Kinetix Storage");
        assert_eq!(
            tombstone_file(&root),
            PathBuf::from(r"D:\DATA\Kinetix Storage").join("deleted-projects.json")
        );
    }
}

/// Merge tombstones onto `to_root`. Does not delete the source — call
/// [`remove_file_at`] after the storage-root pointer has switched.
pub fn copy_to(from_root: &Path, to_root: &Path) -> Result<bool, String> {
    let from = tombstone_file(from_root);
    if !from.is_file() {
        return Ok(false);
    }
    let _gate = lock_gate();
    fs::create_dir_all(to_root).map_err(|e| format!("tombstones relocate mkdir: {e}"))?;
    let mut set = load_ids(to_root);
    set.extend(load_ids(from_root));
    let list: Vec<String> = set.into_iter().collect();
    let payload = serde_json::to_vec(&list).map_err(|e| format!("tombstones encode: {e}"))?;
    crate::atomic_stage::write_bytes_atomic(&tombstone_file(to_root), &payload)?;
    Ok(true)
}

pub fn remove_file_at(root: &Path) -> Result<(), String> {
    let path = tombstone_file(root);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("tombstones remove old root copy: {e}")),
    }
}

/// Copy then delete — tests and any one-shot move. Production relocation
/// splits copy/delete around the pointer commit.
pub fn relocate_to(from_root: &Path, to_root: &Path) -> Result<bool, String> {
    let copied = copy_to(from_root, to_root)?;
    if copied {
        remove_file_at(from_root)?;
    }
    Ok(copied)
}
