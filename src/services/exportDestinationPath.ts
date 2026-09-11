/**
 * WS3 STEP 10 (H9) — validates the operator's chosen export destination
 * path BEFORE any rendering starts, so an impossible destination is
 * rejected at second zero rather than after a 30+ minute encode.
 *
 * `src-tauri/src/ffmpeg.rs`'s `save_session_file` now prefixes both sides
 * of its delivery copy with the Windows `\\?\` extended-length-path syntax
 * (`windows_long_path`), which makes that specific copy operation immune
 * to the classic ~260-character MAX_PATH ceiling — so this check is no
 * longer the ONLY thing standing between a long path and a failed delivery
 * for THIS pipeline. It stays valuable for two reasons: (1) fast, honest
 * feedback the moment the operator picks a bad destination, instead of
 * discovering it only after a real encode finishes; (2) a safety net for
 * any FUTURE code path that copies to `dest_path` without going through
 * `windows_long_path` (nothing else does today, but nothing enforces that
 * it never will). The session/temp paths ffmpeg itself writes into during
 * the render are NOT checked here — they live under the OS temp directory
 * with a short UUID name and are not the thing observed to overflow;
 * `windows_long_path` covers them too, defensively, at copy time.
 *
 * WINDOWS-ONLY BY DESIGN. `pick_save_path` (ffmpeg.rs) returns a
 * platform-native path string: Windows paths are always either
 * drive-letter-rooted (`C:\...`) or UNC (`\\server\share\...`); macOS/Linux
 * paths are always `/`-rooted. Detected from the path's own shape rather
 * than an OS-detection API/dependency (none exists in this codebase), so
 * this needs no new plugin. A macOS/Linux path is never checked against
 * MAX_PATH — that limit does not apply there, and enforcing it anyway would
 * incorrectly reject a valid long path on a platform this repo can actually
 * verify (see CLAUDE.md's governing principle: a defensive property must
 * hold whichever way the platform answers, never invent a constraint that
 * only applies to the platform this environment cannot test).
 */

/** Mirrors `src-tauri/src/ffmpeg.rs`'s `WINDOWS_MAX_PATH` — the classic
 *  Win32 MAX_PATH ceiling. Kept as a named, cross-referenced constant on
 *  both sides of the IPC boundary rather than a bare `260` on either. */
export const WINDOWS_MAX_PATH = 260;

/**
 * True when `path` is shaped like a Windows path — drive-letter-rooted
 * (`C:\...` or `C:/...`) or UNC (`\\server\share\...`). Never true for a
 * macOS/Linux `/`-rooted path.
 */
export function looksLikeWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/**
 * Returns an operator-facing message when `destPath` would exceed Windows'
 * MAX_PATH, or `null` when the destination is fine — including every
 * non-Windows path, for which this check never applies.
 */
export function checkExportDestinationPathLength(destPath: string): string | null {
  if (!looksLikeWindowsPath(destPath)) return null;
  if (destPath.length < WINDOWS_MAX_PATH) return null;
  return (
    `This save location is too long (${destPath.length} characters — Windows' limit is ` +
    `${WINDOWS_MAX_PATH}). Choose a shorter folder or file name and try again.`
  );
}
