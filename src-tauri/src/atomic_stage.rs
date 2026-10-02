//! plan-v3 Wave 1 item 9 — write-then-rename for staged audio.
//!
//! A process death mid-`fs::write` onto the destination leaves a truncated
//! file whose name still exists, so the next run's `exists()`-only cache
//! hit (fa_shared.rs) treats poison as valid. Writing a sibling `.part` and
//! renaming it over the destination makes the visible name either the
//! previous complete file or absent — never a torn prefix.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Test-only: skip the fsyncs. On macOS `sync_all` is `F_FULLFSYNC`, tens of
/// milliseconds per call, which turns the thousands-of-writes race/soak
/// tests from seconds into minutes. Durability is not what those tests
/// measure (interleaving and content are); production builds always sync.
#[cfg(test)]
pub(crate) static TEST_SKIP_FSYNC: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn durable() -> bool {
    #[cfg(test)]
    {
        !TEST_SKIP_FSYNC.load(Ordering::Relaxed)
    }
    #[cfg(not(test))]
    {
        true
    }
}

/// A process-wide, never-repeating sequence number. Every atomic-write temp
/// name in this crate carries one, so two writers to the SAME destination can
/// never share a temp file — pid + millisecond alone is not unique (two
/// threads in one process inside one millisecond), and a bare pid or a fixed
/// name is worse. That sharing is the root cause of the media-vault registry
/// corruption: two writers opened one `registry.json.part` (each truncating
/// it), each wrote from its own offset 0, and the shorter document
/// overwrote the head of the longer — one complete document followed by the
/// other's tail ("trailing characters at line N column M").
pub(crate) fn next_temp_seq() -> u64 {
    TEMP_SEQ.fetch_add(1, Ordering::Relaxed)
}

fn nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

/// Sibling temp path for `dest`, unique per call: `<name>.<pid>.<seq>.<nanos>.part`.
/// Same directory as `dest` (same filesystem, so `rename` is atomic on every
/// OS this app ships). The `.part` suffix is kept so existing leftover sweeps
/// keep recognising an interrupted write.
pub(crate) fn unique_part_path(dest: &Path) -> Result<PathBuf, String> {
    let name = dest
        .file_name()
        .ok_or_else(|| "atomic_stage: destination has no file name".to_string())?;
    Ok(dest.with_file_name(format!(
        "{}.{}.{}.{}.part",
        name.to_string_lossy(),
        std::process::id(),
        next_temp_seq(),
        nanos()
    )))
}

/// The pre-fix FIXED sibling name. Test-only: the crash tests below place a
/// torn leftover by hand, and the pre-fix shape is what they model.
#[cfg(test)]
pub(crate) fn part_path(dest: &Path) -> Result<PathBuf, String> {
    let name = dest
        .file_name()
        .ok_or_else(|| "atomic_stage: destination has no file name".to_string())?;
    Ok(dest.with_file_name(format!("{}.part", name.to_string_lossy())))
}

/// fsync the directory entry so the rename itself survives a power cut.
/// Unix only: Windows cannot open a directory through `std::fs` (it needs
/// `FILE_FLAG_BACKUP_SEMANTICS`), and NTFS journals rename metadata itself —
/// the file's own `sync_all` below is the durability step available there.
#[cfg(unix)]
fn sync_parent_dir(dest: &Path) -> Result<(), String> {
    let Some(parent) = dest.parent() else { return Ok(()) };
    fs::File::open(parent)
        .and_then(|d| d.sync_all())
        .map_err(|e| format!("atomic_stage: fsync dir {}: {e}", parent.display()))
}

#[cfg(not(unix))]
fn sync_parent_dir(_dest: &Path) -> Result<(), String> {
    Ok(())
}

/// Write `bytes` to `dest` via a UNIQUE sibling `.part`, fsync, then `rename`.
///
/// A crash after the `.part` write and before the rename leaves:
/// - the previous `dest` bytes, if it already existed, or
/// - no `dest` at all, if this was the first write.
/// The leftover `.part` is never the cache-hit name. Concurrent callers for
/// the same `dest` each get their own temp file, so the last rename wins with
/// that writer's COMPLETE bytes — never a mix.
pub(crate) fn write_bytes_atomic(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    write_bytes_atomic_ex(dest, bytes, true)
}

/// Same two-phase part+rename as `write_bytes_atomic`. `sync_dir` false skips
/// the parent-directory fsync so a caller can fsync the directory once after a
/// batch of renames (still crash-safe: each part is fsynced before rename).
pub(crate) fn write_bytes_atomic_ex(dest: &Path, bytes: &[u8], sync_dir: bool) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("atomic_stage: create parent: {e}"))?;
    }
    let tmp = unique_part_path(dest)?;
    let written = (|| -> Result<(), String> {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("atomic_stage: create part: {e}"))?;
        f.write_all(bytes).map_err(|e| format!("atomic_stage: write part: {e}"))?;
        if durable() {
            f.sync_all().map_err(|e| format!("atomic_stage: fsync part: {e}"))?;
        }
        Ok(())
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("atomic_stage: rename part -> dest: {e}")
    })?;
    if durable() && sync_dir {
        sync_parent_dir(dest)?;
    }
    Ok(())
}

/// Durability of the directory entries after a deferred-dir-sync batch.
pub(crate) fn fsync_dir(dir: &Path) -> Result<(), String> {
    if !durable() {
        return Ok(());
    }
    #[cfg(unix)]
    {
        fs::File::open(dir)
            .and_then(|d| d.sync_all())
            .map_err(|e| format!("atomic_stage: fsync dir {}: {e}", dir.display()))
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".part"))
            .collect();
        assert!(leftovers.is_empty(), "no part may remain after rename: {leftovers:?}");

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

    #[test]
    fn every_temp_path_is_unique_and_keeps_the_part_suffix() {
        let dest = Path::new("/vault/registry.json");
        let a = unique_part_path(dest).unwrap();
        let b = unique_part_path(dest).unwrap();
        assert_ne!(a, b);
        assert!(a.to_string_lossy().ends_with(".part"));
        assert_eq!(a.parent(), dest.parent(), "same directory, so rename stays atomic");
    }

    #[test]
    fn a_failed_write_leaves_neither_dest_nor_temp() {
        let dir = unique_dir();
        // A directory where the destination's parent should be a file.
        let blocker = dir.join("blocker");
        fs::write(&blocker, b"i am a file").unwrap();
        assert!(write_bytes_atomic(&blocker.join("x.bin"), b"data").is_err());
        let names: Vec<_> = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name()).collect();
        assert_eq!(names.len(), 1, "{names:?}");
        remove_dir(&dir);
    }

    /// S1 — wall times for per-file `write_bytes_atomic` vs batched part-fsync
    /// then one dir-fsync. Gated: a plain `cargo test` returns immediately.
    /// `IMPORT_FSYNC_MEASURE=1 cargo test --release import_fsync_measure -- --nocapture`
    #[test]
    fn import_fsync_measure() {
        if std::env::var("IMPORT_FSYNC_MEASURE").ok().as_deref() != Some("1") {
            return;
        }
        use std::io::Write;
        use std::time::Instant;

        let files = 20usize;
        let bytes_each = 5 * 1024 * 1024;
        let body: Vec<u8> = (0..bytes_each).map(|i| (i % 251) as u8).collect();

        let per_dir = unique_dir();
        let per = Instant::now();
        for i in 0..files {
            write_bytes_atomic(&per_dir.join(format!("per-{i}.bin")), &body).unwrap();
        }
        let per_ms = per.elapsed().as_secs_f64() * 1000.0;

        let batch_dir = unique_dir();
        let batch = Instant::now();
        let mut parts = Vec::new();
        for i in 0..files {
            let dest = batch_dir.join(format!("batch-{i}.bin"));
            let tmp = dest.with_extension("part");
            {
                let mut f = fs::File::create(&tmp).unwrap();
                f.write_all(&body).unwrap();
                f.sync_all().unwrap();
            }
            parts.push((tmp, dest));
        }
        let after_writes = batch.elapsed().as_secs_f64() * 1000.0;
        for (tmp, dest) in &parts {
            fs::rename(tmp, dest).unwrap();
        }
        {
            let d = fs::File::open(&batch_dir).unwrap();
            d.sync_all().unwrap();
        }
        let batch_ms = batch.elapsed().as_secs_f64() * 1000.0;

        println!(
            "import_fsync_measure: {files} files × {:.1} MiB",
            bytes_each as f64 / (1024.0 * 1024.0)
        );
        println!(
            "  per-file write_bytes_atomic (part fsync + rename + dir fsync): {:.1} ms ({:.1} ms/file)",
            per_ms,
            per_ms / files as f64
        );
        println!(
            "  batched (all part fsyncs, then all renames, then ONE dir fsync): {:.1} ms (writes+file-fsync {:.1} ms)",
            batch_ms, after_writes
        );
        println!("  delta (per-file − batched): {:.1} ms", per_ms - batch_ms);

        remove_dir(&per_dir);
        remove_dir(&batch_dir);
    }

    #[test]
    fn deferred_dir_sync_still_leaves_complete_files_then_one_dir_fsync() {
        let dir = unique_dir();
        for i in 0..3 {
            write_bytes_atomic_ex(&dir.join(format!("{i}.bin")), format!("complete-{i}").as_bytes(), false).unwrap();
        }
        fsync_dir(&dir).unwrap();
        for i in 0..3 {
            assert_eq!(fs::read(dir.join(format!("{i}.bin"))).unwrap(), format!("complete-{i}").as_bytes());
        }
        remove_dir(&dir);
    }
}

/// Shared race harness for every atomic-write helper in the crate (the audit
/// of `write_bytes_atomic`'s same-class siblings): N threads start each round
/// together and write DIFFERENT-SIZED payloads to ONE destination. A correct
/// helper never errors and always leaves exactly one writer's complete bytes.
#[cfg(test)]
pub(crate) mod race_harness {
    use std::path::Path;
    use std::sync::{Arc, Barrier, Mutex};

    pub fn hammer_one_destination(
        label: &str,
        dest: &Path,
        rounds: usize,
        write: impl Fn(&Path, &[u8]) -> Result<(), String> + Sync,
    ) {
        TEST_SKIP.store(true, std::sync::atomic::Ordering::Relaxed);
        let payloads: Vec<Vec<u8>> = [96 * 1024, 4 * 1024, 40 * 1024, 1024]
            .iter()
            .enumerate()
            .map(|(i, n)| vec![b'a' + i as u8; *n])
            .collect();
        let barrier = Arc::new(Barrier::new(payloads.len()));
        let failures = Arc::new(Mutex::new(Vec::<String>::new()));
        std::thread::scope(|s| {
            for (i, payload) in payloads.iter().enumerate() {
                let (barrier, failures, write) = (barrier.clone(), failures.clone(), &write);
                s.spawn(move || {
                    for r in 0..rounds {
                        barrier.wait();
                        if let Err(e) = write(dest, payload) {
                            failures.lock().unwrap().push(format!("writer {i} round {r}: {e}"));
                        }
                    }
                });
            }
        });
        let failures = failures.lock().unwrap();
        assert!(failures.is_empty(), "{label}: {} writer error(s), first: {:?}", failures.len(), failures.first());
        let last = std::fs::read(dest).unwrap();
        assert!(payloads.iter().any(|p| *p == last), "{label}: final file is not one writer's complete bytes (len {})", last.len());
    }

    use std::sync::atomic::AtomicBool;
    // Same switch as `TEST_SKIP_FSYNC`; kept local so callers need one import.
    static TEST_SKIP: &AtomicBool = &super::TEST_SKIP_FSYNC;
}
