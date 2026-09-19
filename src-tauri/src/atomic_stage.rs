//! plan-v3 Wave 1 item 9 — write-then-rename for staged audio.
//!
//! A process death mid-`fs::write` onto the destination leaves a truncated
//! file whose name still exists, so the next run's `exists()`-only cache
//! hit (fa_dev.rs) treats poison as valid. Writing a sibling `.part` and
//! renaming it over the destination makes the visible name either the
//! previous complete file or absent — never a torn prefix.

use std::fs;
use std::path::Path;

/// Sibling `*.part` path in the same directory as `dest` (same filesystem,
/// so `rename` is atomic on every OS this app ships).
pub(crate) fn part_path(dest: &Path) -> Result<std::path::PathBuf, String> {
    let name = dest
        .file_name()
        .ok_or_else(|| "atomic_stage: destination has no file name".to_string())?;
    Ok(dest.with_file_name(format!("{}.part", name.to_string_lossy())))
}

/// Write `bytes` to `dest` via a sibling `.part` then `rename`.
///
/// A crash after the `.part` write and before the rename leaves:
/// - the previous `dest` bytes, if it already existed, or
/// - no `dest` at all, if this was the first write.
/// The leftover `.part` is never the cache-hit name.
pub(crate) fn write_bytes_atomic(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("atomic_stage: create parent: {e}"))?;
    }
    let tmp = part_path(dest)?;
    if tmp.exists() {
        let _ = fs::remove_file(&tmp);
    }
    fs::write(&tmp, bytes).map_err(|e| format!("atomic_stage: write part: {e}"))?;
    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("atomic_stage: rename part -> dest: {e}")
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn unique_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kinetix-atomic-stage-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn remove_dir(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn crash_before_rename_leaves_the_previous_complete_file() {
        let dir = unique_dir();
        let dest = dir.join("clip.wav");
        let old = b"COMPLETE-OLD-AUDIO-BYTES";
        fs::write(&dest, old).unwrap();

        // The restart hazard: we got as far as writing the sibling part,
        // then the process died before rename. dest must still be the old
        // complete file — never a truncated mix of old+new.
        let tmp = part_path(&dest).unwrap();
        fs::write(&tmp, b"NEW-BYTES-THAT-MUST-NOT-BECOME-VISIBLE-TORN").unwrap();
        assert!(dest.exists(), "dest must still exist after a torn part write");
        assert_eq!(fs::read(&dest).unwrap(), old);
        assert!(tmp.exists(), "the leftover part is the incomplete write");
        assert_ne!(
            fs::read(&tmp).unwrap(),
            fs::read(&dest).unwrap(),
            "cache-hit name and part must not be the same file"
        );

        remove_dir(&dir);
    }

    #[test]
    fn crash_before_rename_on_first_write_leaves_no_dest() {
        let dir = unique_dir();
        let dest = dir.join("clip.wav");
        let tmp = part_path(&dest).unwrap();
        fs::write(&tmp, b"TORN-FIRST-WRITE").unwrap();

        assert!(
            !dest.exists(),
            "a first write that dies before rename must leave no dest — exists()-only cache must miss"
        );
        assert!(tmp.exists());

        remove_dir(&dir);
    }

    #[test]
    fn successful_atomic_write_replaces_dest_and_removes_part() {
        let dir = unique_dir();
        let dest = dir.join("clip.wav");
        fs::write(&dest, b"old").unwrap();

        write_bytes_atomic(&dest, b"new-complete").unwrap();

        assert_eq!(fs::read(&dest).unwrap(), b"new-complete");
        assert!(!part_path(&dest).unwrap().exists(), "part must be gone after rename");

        remove_dir(&dir);
    }

    #[test]
    fn in_place_fs_write_is_the_hazard_this_helper_closes() {
        // Contrast, not a recommendation: a direct write onto dest can leave
        // a shorter file at the cache-hit name. The atomic helper must never
        // do that.
        let dir = unique_dir();
        let dest = dir.join("clip.wav");
        fs::write(&dest, b"COMPLETE-OLD-AUDIO-BYTES").unwrap();
        fs::write(&dest, b"TORN").unwrap();
        assert_eq!(
            fs::read(&dest).unwrap(),
            b"TORN",
            "sanity: in-place write is exactly the truncated-cache hazard"
        );
        assert!(dest.exists());

        remove_dir(&dir);
    }
}
