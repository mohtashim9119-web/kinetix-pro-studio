//! WS3 item E — the one audited helper allowed to recursively delete a
//! directory this app created for itself.
//!
//! WHY THIS EXISTS. `whisper.rs` had THREE sites that called
//! `fs::remove_dir_all` on `Path::parent()` of a caller-supplied `audioPath`
//! — the transcode-failure arm, the `CommandEvent::Terminated` arm, and (the
//! worst of the three, because it fires on every early return, including
//! ones that look completely unrelated to file I/O) the `Drop` impl of
//! `TmpDirCleanupGuard`. None of them verified that the path they were about
//! to delete was actually a staging directory this app created — they
//! trusted the shape of an IPC-reachable string parameter. Any caller
//! passing a path to a real user file (a project asset, a document, anything
//! under `~/Documents`) got that file's ENTIRE PARENT DIRECTORY deleted,
//! recursively, the moment the transcription failed or was terminated.
//!
//! `delete_app_staging_dir` closes that class of bug generally, not just at
//! the three sites that happened to trigger it: it is the only function in
//! this crate permitted to call `fs::remove_dir_all`, and it refuses unless
//! every one of these holds:
//!
//!   1. `dir` canonicalizes successfully. Canonicalization failure — the
//!      path does not exist, a component is not traversable, permission is
//!      denied — is treated as REFUSAL, never as "nothing to delete, silently
//!      proceed". A caller that wants "delete if present, no-op if absent"
//!      gets exactly that from the `Result`, by discarding it the same way
//!      the three call sites already discarded `remove_dir_all`'s — but the
//!      REFUSAL is what's silently absorbed, not an unverified delete.
//!   2. `bounds` also canonicalizes.
//!   3. The canonical `dir` lies STRICTLY inside canonical `bounds` (not
//!      equal to it — the staging root itself is never a valid delete
//!      target). `std::fs::canonicalize` resolves symlinks AND Windows
//!      reparse points (junctions) to their real target, so a `dir` that is,
//!      or passes through, a symlink/junction pointing outside `bounds` is
//!      caught by this same containment check rather than being followed
//!      blindly into `remove_dir_all`.
//!   4. The canonical `dir`'s own file name starts with `required_prefix` —
//!      ties the check to "a directory THIS module creates", not merely "any
//!      directory that happens to live under the same parent as ours" (two
//!      unrelated directories can share a parent under a shared system temp
//!      root).
//!
//! A refusal is logged (`kinetix::safe_delete`, warn) — bounds/prefix
//! refusals are a real security-relevant event worth a record, unlike the
//! everyday "already gone" `NotFound` case a caller's `let _ =` absorbs.

use std::fs;
use std::path::Path;

/// See the module doc comment. `required_prefix` is matched against `dir`'s
/// own (canonical) file name, not any ancestor.
pub fn delete_app_staging_dir(dir: &Path, bounds: &Path, required_prefix: &str) -> Result<(), String> {
    let real_dir = fs::canonicalize(dir).map_err(|e| {
        format!("refusing to delete {}: cannot canonicalize: {e}", dir.display())
    })?;
    let real_bounds = fs::canonicalize(bounds).map_err(|e| {
        format!(
            "refusing to delete {}: staging root {} cannot canonicalize: {e}",
            dir.display(),
            bounds.display()
        )
    })?;

    if real_dir == real_bounds || !real_dir.starts_with(&real_bounds) {
        let msg = format!(
            "refusing to delete {} — resolves to {}, which is not strictly inside the staging root {} \
             (resolves to {})",
            dir.display(),
            real_dir.display(),
            bounds.display(),
            real_bounds.display()
        );
        log::warn!(target: "kinetix::safe_delete", "{msg}");
        return Err(msg);
    }

    let name_ok = real_dir
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with(required_prefix));
    if !name_ok {
        let msg = format!(
            "refusing to delete {} (resolves to {}) — its name does not start with the required prefix {:?}",
            dir.display(),
            real_dir.display(),
            required_prefix
        );
        log::warn!(target: "kinetix::safe_delete", "{msg}");
        return Err(msg);
    }

    fs::remove_dir_all(&real_dir).map_err(|e| format!("remove_dir_all {}: {e}", real_dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now_millis() -> u128 {
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
    }

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("kinetix-safe-delete-test-{tag}-{}", now_millis()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn deletes_a_directory_that_is_in_bounds_and_correctly_prefixed() {
        let bounds = tmpdir("bounds-ok");
        let target = bounds.join("kinetix-whisper-abc123");
        fs::create_dir_all(target.join("nested")).unwrap();
        fs::write(target.join("nested/file.txt"), b"x").unwrap();

        assert!(delete_app_staging_dir(&target, &bounds, "kinetix-whisper-").is_ok());
        assert!(!target.exists());

        fs::remove_dir_all(&bounds).ok();
    }

    #[test]
    fn refuses_a_target_outside_the_bounds_entirely() {
        // The Machine-1-class shape: `dir` is some unrelated real directory
        // that just happens not to sit under `bounds` at all.
        let bounds = tmpdir("bounds-a");
        let outside = tmpdir("definitely-not-staging");
        fs::write(outside.join("users_real_file.txt"), b"precious").unwrap();

        let result = delete_app_staging_dir(&outside, &bounds, "kinetix-whisper-");
        assert!(result.is_err());
        assert!(outside.exists(), "an out-of-bounds directory must survive untouched");
        assert!(outside.join("users_real_file.txt").exists());

        fs::remove_dir_all(&bounds).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn refuses_the_bounds_directory_itself_even_though_it_is_technically_inside_itself() {
        let bounds = tmpdir("bounds-self");
        let result = delete_app_staging_dir(&bounds, &bounds, "kinetix-whisper-");
        assert!(result.is_err());
        assert!(bounds.exists());
        fs::remove_dir_all(&bounds).ok();
    }

    #[test]
    fn refuses_a_correctly_placed_directory_with_the_wrong_name_prefix() {
        let bounds = tmpdir("bounds-b");
        let target = bounds.join("some-other-apps-cache-dir");
        fs::create_dir_all(&target).unwrap();

        let result = delete_app_staging_dir(&target, &bounds, "kinetix-whisper-");
        assert!(result.is_err());
        assert!(target.exists());

        fs::remove_dir_all(&bounds).ok();
    }

    #[test]
    fn a_nonexistent_target_is_a_refusal_not_a_silent_noop() {
        // Canonicalization failure is a REFUSAL — the caller decides whether
        // to treat that as "fine, already gone" by discarding the Result,
        // same as the pre-existing `let _ = fs::remove_dir_all(...)` posture,
        // but the function itself never claims success on a path it could
        // not resolve.
        let bounds = tmpdir("bounds-c");
        let missing = bounds.join("kinetix-whisper-never-existed");
        let result = delete_app_staging_dir(&missing, &bounds, "kinetix-whisper-");
        assert!(result.is_err());
        fs::remove_dir_all(&bounds).ok();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_that_resolves_outside_bounds() {
        use std::os::unix::fs::symlink;
        let bounds = tmpdir("bounds-symlink");
        let real_target = tmpdir("symlink-victim");
        fs::write(real_target.join("victim.txt"), b"do not delete me").unwrap();

        // `dir` itself is a symlink living INSIDE bounds, with the right name
        // prefix, but pointing OUTSIDE bounds — must still be refused because
        // canonicalize resolves it before the containment check runs.
        let link = bounds.join("kinetix-whisper-symlinked");
        symlink(&real_target, &link).unwrap();

        let result = delete_app_staging_dir(&link, &bounds, "kinetix-whisper-");
        assert!(result.is_err());
        assert!(real_target.exists());
        assert!(real_target.join("victim.txt").exists());

        fs::remove_dir_all(&bounds).ok();
        fs::remove_dir_all(&real_target).ok();
    }

    #[test]
    fn a_deeply_nested_valid_target_is_still_deleted() {
        let bounds = tmpdir("bounds-nested");
        let target = bounds.join("kinetix-whisper-deep");
        fs::create_dir_all(target.join("a/b/c")).unwrap();
        assert!(delete_app_staging_dir(&target, &bounds, "kinetix-whisper-").is_ok());
        assert!(!target.exists());
        fs::remove_dir_all(&bounds).ok();
    }

    // ── WS3 item H — an empty `required_prefix` (used by
    //    `asset_store_delete_project`, where a project id is a bare UUID
    //    with no naming convention to check) still enforces containment;
    //    it only skips the name-pattern check, never the canonicalize +
    //    bounds check.
    #[test]
    fn an_empty_prefix_skips_the_name_check_but_still_enforces_containment() {
        let bounds = tmpdir("bounds-empty-prefix");
        let target = bounds.join("550e8400-e29b-41d4-a716-446655440000"); // a bare UUID, no prefix
        fs::create_dir_all(target.join("a1.bin")).unwrap();

        assert!(delete_app_staging_dir(&target, &bounds, "").is_ok());
        assert!(!target.exists());

        fs::remove_dir_all(&bounds).ok();
    }

    #[test]
    fn an_empty_prefix_still_refuses_a_target_outside_bounds() {
        let bounds = tmpdir("bounds-empty-prefix-outside");
        let outside = tmpdir("empty-prefix-victim");
        fs::write(outside.join("real_file.txt"), b"do not delete").unwrap();

        let result = delete_app_staging_dir(&outside, &bounds, "");
        assert!(result.is_err());
        assert!(outside.exists());
        assert!(outside.join("real_file.txt").exists());

        fs::remove_dir_all(&bounds).ok();
        fs::remove_dir_all(&outside).ok();
    }
}
