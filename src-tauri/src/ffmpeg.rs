use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;
use std::io;
use std::path::PathBuf;
use std::process::Command;
use uuid::Uuid;

// In sub-phase 6.5 this becomes the resolved sidecar path.
const FFMPEG_BINARY: &str = "ffmpeg";

/// Validates a logical filename is safe for use inside a session directory.
///
/// Rules:
///   - Must be non-empty.
///   - Every character must be in [A-Za-z0-9_.-].
///   - Must not be "." or ".." (caught by the char set since ".." would pass
///     char-by-char, so we check explicitly).
///   - No path separators (/ and \ are outside the allowed charset, so they
///     are rejected by the loop — explicit check is for clarity).
fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("invalid path: must not be empty".to_string());
    }
    if path == "." || path == ".." {
        return Err(format!("invalid path: \"{}\" is not allowed", path));
    }
    for ch in path.chars() {
        if !matches!(ch, 'A'..='Z' | 'a'..='z' | '0'..='9' | '_' | '.' | '-') {
            return Err(format!(
                "invalid path: \"{}\" contains disallowed character '{}'",
                path, ch
            ));
        }
    }
    Ok(())
}

/// Parses session_id as a UUID and returns the corresponding session directory.
///
/// Validation ensures the frontend cannot supply an arbitrary directory path
/// by crafting a malformed session_id string.
fn session_dir(session_id: &str) -> Result<PathBuf, String> {
    // Parse as UUID to validate format — reject anything that isn't a real v4 UUID.
    let _ = Uuid::parse_str(session_id)
        .map_err(|_| format!("invalid session_id: \"{}\" is not a valid UUID", session_id))?;
    Ok(std::env::temp_dir().join(format!("kinetix-export-{}", session_id)))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Creates a new isolated session directory under $TMPDIR.
/// Returns the session id (UUID v4 string) that must be passed to all
/// subsequent commands for this export.
#[tauri::command]
pub fn ffmpeg_create_session() -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let dir = std::env::temp_dir().join(format!("kinetix-export-{}", id));
    fs::create_dir_all(&dir).map_err(|e| format!("create_session: {}", e))?;
    Ok(id)
}

/// Writes base64-encoded bytes to <session_dir>/<path>.
///
/// The frontend encodes Uint8Array → base64 string before invoking this command.
/// Decoding in Rust eliminates the JSON-array-of-numbers IPC overhead that was
/// the dominant export bottleneck (~5-10× speedup on per-frame PNG writes). Phase 6.3.1.
#[tauri::command]
pub fn ffmpeg_write_file(session_id: String, path: String, data_b64: String) -> Result<(), String> {
    validate_path(&path)?;
    let full = session_dir(&session_id)?.join(&path);
    let data = STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("write_file({}): base64 decode failed: {}", path, e))?;
    fs::write(&full, &data).map_err(|e| format!("write_file({}): {}", path, e))
}

/// Reads <session_dir>/<path> and returns its bytes.
#[tauri::command]
pub fn ffmpeg_read_file(session_id: String, path: String) -> Result<Vec<u8>, String> {
    validate_path(&path)?;
    let full = session_dir(&session_id)?.join(&path);
    fs::read(&full).map_err(|e| format!("read_file({}): {}", path, e))
}

/// Deletes <session_dir>/<path>. Missing file is treated as success.
#[tauri::command]
pub fn ffmpeg_delete_file(session_id: String, path: String) -> Result<(), String> {
    validate_path(&path)?;
    let full = session_dir(&session_id)?.join(&path);
    match fs::remove_file(&full) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete_file({}): {}", path, e)),
    }
}

/// Runs `ffmpeg <args>` with the session directory as cwd.
///
/// Returns the exit code on success (0 for clean ffmpeg runs). On non-zero
/// exit, returns Err containing the tail of ffmpeg's stderr output so the
/// frontend can surface a useful error message.
///
/// Note: ffmpeg writes progress and encoding info to stderr even on success.
/// We only surface stderr when the exit code is non-zero.
#[tauri::command]
pub fn ffmpeg_exec(session_id: String, args: Vec<String>) -> Result<i32, String> {
    let cwd = session_dir(&session_id)?;
    let output = Command::new(FFMPEG_BINARY)
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("ffmpeg spawn failed: {} (is ffmpeg on PATH?)", e))?;

    let exit_code = output.status.code().unwrap_or(-1);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Truncate to last 2000 chars to avoid pathologically large error payloads.
        let tail = if stderr.len() > 2000 {
            format!("...{}", &stderr[stderr.len() - 2000..])
        } else {
            stderr.to_string()
        };
        return Err(format!("ffmpeg exited with code {}: {}", exit_code, tail));
    }

    Ok(exit_code)
}

/// Deletes the entire session directory and all its contents.
///
/// Should be called after the export completes (success or failure) to
/// reclaim disk space. Best-effort: if the directory is already gone, no error.
#[tauri::command]
pub fn ffmpeg_destroy_session(session_id: String) -> Result<(), String> {
    let dir = session_dir(&session_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("destroy_session: {}", e))?;
    }
    Ok(())
}

/// Opens a native OS save-file dialog and writes the base64-decoded bytes to
/// the chosen path.
///
/// Returns `true` if the file was saved, `false` if the user cancelled.
/// The dialog suggests `default_name` as the filename and filters to .mp4.
///
/// Accepts base64-encoded data (same encoding as ffmpeg_write_file) to avoid
/// JSON-array-of-numbers overhead on the final MP4 blob, which can be 100+ MB.
///
/// Uses `rfd::AsyncFileDialog` which dispatches the native panel to the main
/// thread internally (required on macOS/AppKit) while awaiting on the Tauri
/// tokio runtime — no deadlock risk.
#[tauri::command]
pub async fn save_bytes_to_disk(data_b64: String, default_name: String) -> Result<bool, String> {
    let data = STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("save_bytes_to_disk: base64 decode failed: {e}"))?;

    let handle = rfd::AsyncFileDialog::new()
        .set_file_name(&default_name)
        .add_filter("MP4 Video", &["mp4"])
        .save_file()
        .await;

    match handle {
        None => Ok(false),
        Some(file_handle) => std::fs::write(file_handle.path(), &data)
            .map(|_| true)
            .map_err(|e| format!("Failed to save file: {e}")),
    }
}
