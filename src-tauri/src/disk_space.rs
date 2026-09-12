//! WS3 Round 21 — disk-full hardening: volume free space, volume identity,
//! and the one ENOSPC classifier every native write site and the ffmpeg
//! sidecar's exit share.
//!
//! Free space comes from `fs4::available_space`, which is `statvfs` →
//! `f_frsize * f_bavail` on Unix and `GetDiskFreeSpaceExW`'s FIRST out
//! parameter (`lpFreeBytesAvailableToCaller`, quota-aware — NOT
//! `lpTotalNumberOfFreeBytes`) on Windows, resolved on the path's own volume
//! via `GetVolumePathNameW`. Verified against `fs4-0.9.1/src/windows.rs:96-124`
//! and `src/unix.rs:62-63`; the crate is already a dependency (Manage Models
//! storage line), so no second FFI path is introduced.

use serde::Serialize;
use std::io;
use std::path::{Path, PathBuf};

/// `ERROR_DISK_FULL` — "There is not enough space on the disk."
#[cfg_attr(not(windows), allow(dead_code))]
pub const WINDOWS_ERROR_DISK_FULL: i32 = 112;
/// `ERROR_HANDLE_DISK_FULL` — "The disk is full." (raised on the handle
/// rather than the volume; NTFS emits it from `WriteFile` when the file's
/// allocation cannot grow).
#[cfg_attr(not(windows), allow(dead_code))]
pub const WINDOWS_ERROR_HANDLE_DISK_FULL: i32 = 39;
/// `AVERROR(ENOSPC)`: ffmpeg's `main` returns the negated errno on a fatal
/// write error. Seen verbatim as the process exit code on Windows (the field
/// report: `exit -28`); on POSIX the shell truncates it to `228` (`-28 & 0xFF`).
pub const FFMPEG_EXIT_ENOSPC: i32 = -28;
pub const FFMPEG_EXIT_ENOSPC_POSIX: i32 = 228;
/// The exact string ffmpeg (and glibc/BSD `strerror`) print for `ENOSPC`.
pub const ENOSPC_MESSAGE: &str = "No space left on device";

/// Round 21 (D3c) — how much of ffmpeg's stderr rides on an error string.
/// Before this round the tail was the last 2000 CHARACTERS, which on a mux
/// failure is almost entirely `frame= ... fps= ... speed=` progress lines
/// (the field blob carried ~4 KB of them in `error.cause`). The error lines
/// come last and are short, so a LINE cap that drops progress lines keeps
/// the actual error and nothing else.
pub const FFMPEG_STDERR_TAIL_LINES: usize = 12;
pub const FFMPEG_STDERR_TAIL_BYTES: usize = 1_500;

/// One `io::Error` is a disk-full condition when the portable kind says so
/// (`StorageFull`, or `QuotaExceeded` — a per-user quota exhausted is
/// out-of-space for this process even when the volume has bytes), or, on
/// Windows, the raw code is one of the two Win32 disk-full errors —
/// `ERROR_DISK_FULL` (112) and `ERROR_HANDLE_DISK_FULL` (39). std's
/// `decode_error_kind` maps both to `StorageFull` on current toolchains; the
/// raw check is kept so the mapping does not depend on the toolchain (the
/// Round 19 `cfg` audit recorded that the `112` branch had never executed
/// on Windows).
pub fn io_error_is_disk_full(err: &io::Error) -> bool {
    if matches!(err.kind(), io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded) {
        return true;
    }
    #[cfg(windows)]
    {
        if err.raw_os_error().is_some_and(windows_raw_error_is_disk_full) {
            return true;
        }
    }
    false
}

/// Pure classifier for a Windows raw OS error code — platform-independent so
/// the 112/39 mapping is exercised by tests on every platform, not only
/// under `#[cfg(windows)]` (where it is the only production caller).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn windows_raw_error_is_disk_full(code: i32) -> bool {
    code == WINDOWS_ERROR_DISK_FULL || code == WINDOWS_ERROR_HANDLE_DISK_FULL
}

/// The one string every native ENOSPC surfaces with, so the frontend's
/// classifier (`diskFull.ts`) has a single exact token to match on top of
/// the OS's own wording. Keeps the OS error code and path from `describe`.
pub const DISK_FULL_TAG: &str = "[disk-full]";

/// Prefix an error string with the disk-full tag when `err` is ENOSPC;
/// otherwise return the plain formatted string. Used at every session write
/// site that maps an `io::Error` to the command's `Err(String)`.
pub fn tag_if_disk_full(err: &io::Error, plain: String) -> String {
    if io_error_is_disk_full(err) {
        format!("{DISK_FULL_TAG} {plain}")
    } else {
        plain
    }
}

/// Whether an ffmpeg sidecar run died of ENOSPC — by exit code (either
/// spelling) or by the errno string anywhere in stderr (the muxer prints it
/// from the failing output stream, e.g. `[aost#0:1/aac] No space left on
/// device`, before `Error writing trailer`).
pub fn ffmpeg_run_is_disk_full(exit_code: i32, stderr: &str) -> bool {
    exit_code == FFMPEG_EXIT_ENOSPC
        || exit_code == FFMPEG_EXIT_ENOSPC_POSIX
        || stderr.contains(ENOSPC_MESSAGE)
}

/// Keep only the last `max_lines` non-progress lines of an ffmpeg stderr
/// dump, then cap at `max_bytes` (from the end). ffmpeg's `frame=` progress
/// lines are `\r`-separated on a terminal but `\n`-separated through the
/// sidecar's line reader, and they carry nothing an error report needs.
pub fn ffmpeg_stderr_tail(stderr: &str, max_lines: usize, max_bytes: usize) -> String {
    let kept: Vec<&str> = stderr
        .lines()
        .map(str::trim_end)
        .filter(|l| !l.is_empty() && !is_ffmpeg_progress_line(l))
        .collect();
    let start = kept.len().saturating_sub(max_lines);
    let mut joined = kept[start..].join("\n");
    if joined.len() > max_bytes {
        // Cut on a char boundary from the end.
        let mut cut = joined.len() - max_bytes;
        while !joined.is_char_boundary(cut) {
            cut += 1;
        }
        joined = format!("...{}", &joined[cut..]);
    }
    joined
}

fn is_ffmpeg_progress_line(line: &str) -> bool {
    let l = line.trim_start();
    l.starts_with("frame=") || l.starts_with("size=") || l.starts_with("video:")
}

/// One volume's free-space reading for the preflight (D1).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VolumeFreeSpace {
    /// The path that was asked about (as given).
    pub path: String,
    /// The nearest existing ancestor the reading was taken on (the
    /// destination file itself does not exist yet).
    pub probed_path: String,
    /// Opaque identity of the volume the path lives on. Two paths with equal
    /// keys share one free-space pool and their requirements must be summed.
    pub volume_key: String,
    /// `lpFreeBytesAvailableToCaller` / `f_bavail * f_frsize`.
    pub available_bytes: u64,
}

/// Walk up to the nearest existing ancestor (a destination file's parent may
/// itself not exist yet if the operator picked a new folder in the dialog).
pub fn nearest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut cur = Some(path);
    while let Some(p) = cur {
        if p.exists() {
            return Some(p.to_path_buf());
        }
        cur = p.parent();
    }
    None
}

/// Volume identity for "do these two paths share a free-space pool".
///
/// Unix: `st_dev` of the probed path — the kernel's own device id. KNOWN
/// GAP: two APFS volumes in one container (e.g. macOS `Data` and a second
/// user volume) have distinct `st_dev` but SHARE the container's free space,
/// so by key alone they look like separate pools and the preflight would
/// check each against the same bytes without summing. The frontend
/// (`diskFull.ts`'s `groupVolumes`) closes this by ALSO merging readings
/// whose `available_bytes` are byte-identical — two independent volumes
/// essentially never report the same free byte count, a shared pool always
/// does.
///
/// Windows: the path's root prefix (`C:`, `\\?\C:`, `\\server\share`) — the
/// drive-letter / UNC root. NTFS folder mount points (a volume mounted at
/// `C:\mnt\x`) read as `C:`; the preflight then sums both requirements onto
/// one volume, again the conservative direction.
pub fn volume_key(probed: &Path) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(m) = std::fs::metadata(probed) {
            return format!("dev:{}", m.dev());
        }
    }
    #[cfg(windows)]
    {
        use std::path::Component;
        if let Some(Component::Prefix(p)) = probed.components().next() {
            return format!("prefix:{}", p.as_os_str().to_string_lossy().to_ascii_uppercase());
        }
    }
    format!("path:{}", probed.display())
}

pub fn volume_free_space(path: &Path) -> Result<VolumeFreeSpace, String> {
    let probed = nearest_existing_ancestor(path)
        .ok_or_else(|| format!("free_space({}): no existing ancestor", path.display()))?;
    let available_bytes = fs4::available_space(&probed)
        .map_err(|e| format!("free_space({}): {e}", probed.display()))?;
    Ok(VolumeFreeSpace {
        path: path.display().to_string(),
        probed_path: probed.display().to_string(),
        volume_key: volume_key(&probed),
        available_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_full_kind_is_disk_full_everywhere() {
        assert!(io_error_is_disk_full(&io::Error::from(io::ErrorKind::StorageFull)));
        assert!(!io_error_is_disk_full(&io::Error::from(io::ErrorKind::PermissionDenied)));
        assert!(!io_error_is_disk_full(&io::Error::from_raw_os_error(5)));
    }

    #[test]
    fn windows_raw_codes_112_and_39_are_disk_full() {
        assert!(windows_raw_error_is_disk_full(112));
        assert!(windows_raw_error_is_disk_full(39));
        assert!(!windows_raw_error_is_disk_full(5));
        assert!(!windows_raw_error_is_disk_full(32));
    }

    #[cfg(windows)]
    #[test]
    fn windows_raw_os_error_39_maps_to_disk_full_on_this_platform() {
        assert!(io_error_is_disk_full(&io::Error::from_raw_os_error(39)));
        assert!(io_error_is_disk_full(&io::Error::from_raw_os_error(112)));
    }

    #[test]
    fn ffmpeg_exit_minus_28_and_enospc_stderr_are_disk_full() {
        assert!(ffmpeg_run_is_disk_full(-28, ""));
        assert!(ffmpeg_run_is_disk_full(228, ""));
        assert!(ffmpeg_run_is_disk_full(
            1,
            "[aost#0:1/aac] No space left on device\nError writing trailer\nError closing file"
        ));
        assert!(!ffmpeg_run_is_disk_full(1, "Invalid data found when processing input"));
        assert!(!ffmpeg_run_is_disk_full(-22, ""));
    }

    #[test]
    fn stderr_tail_drops_progress_lines_and_keeps_the_error() {
        let mut s = String::new();
        for i in 0..400 {
            s.push_str(&format!(
                "frame={i:6} fps=120 q=-1.0 size={} kB time=00:00:{:02}.00 bitrate=8000.0kbits/s speed=4x\n",
                i * 33,
                i % 60
            ));
        }
        s.push_str("[aost#0:1/aac] No space left on device\n");
        s.push_str("[out#0/mp4] Error writing trailer: No space left on device\n");
        s.push_str("[out#0/mp4] Error closing file: No space left on device\n");
        let tail = ffmpeg_stderr_tail(&s, FFMPEG_STDERR_TAIL_LINES, FFMPEG_STDERR_TAIL_BYTES);
        assert!(!tail.contains("frame="), "progress spam leaked: {tail}");
        assert!(tail.contains("No space left on device"));
        assert!(tail.contains("Error writing trailer"));
        assert!(tail.len() <= FFMPEG_STDERR_TAIL_BYTES + 3);
    }

    #[test]
    fn stderr_tail_byte_cap_keeps_the_end() {
        let s = "x".repeat(5000) + "\nlast line here";
        let tail = ffmpeg_stderr_tail(&s, 12, 100);
        assert!(tail.ends_with("last line here"));
        assert!(tail.starts_with("..."));
        assert!(tail.len() <= 103);
    }

    #[test]
    fn tag_if_disk_full_prefixes_only_enospc() {
        let e = io::Error::from(io::ErrorKind::StorageFull);
        assert!(tag_if_disk_full(&e, "write x".into()).starts_with(DISK_FULL_TAG));
        let e = io::Error::from(io::ErrorKind::NotFound);
        assert_eq!(tag_if_disk_full(&e, "write x".into()), "write x");
    }

    #[test]
    fn volume_free_space_walks_up_to_an_existing_ancestor() {
        let tmp = std::env::temp_dir();
        let missing = tmp.join("kinetix-disk-space-test-does-not-exist").join("nested").join("out.mp4");
        let v = volume_free_space(&missing).unwrap();
        assert_eq!(Path::new(&v.probed_path), tmp.as_path());
        assert!(v.available_bytes > 0);
        let same = volume_free_space(&tmp).unwrap();
        assert_eq!(v.volume_key, same.volume_key);
    }
}
