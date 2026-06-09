use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;
use std::io;
use std::path::PathBuf;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

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

/// Runs the bundled ffmpeg sidecar with `args`, using the session directory as cwd.
///
/// Returns the exit code on success (0 for clean ffmpeg runs). On non-zero
/// exit, returns Err containing the tail of ffmpeg's stderr output so the
/// frontend can surface a useful error message.
///
/// Note: ffmpeg writes progress and encoding info to stderr even on success.
/// We only surface stderr when the exit code is non-zero.
///
/// Uses the Tauri sidecar API (tauri-plugin-shell) so the binary runs from
/// inside the app bundle — no PATH dependency required. Phase 6.5.
#[tauri::command]
pub async fn ffmpeg_exec(
    app: tauri::AppHandle,
    session_id: String,
    args: Vec<String>,
) -> Result<i32, String> {
    let cwd = session_dir(&session_id)?;

    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar error: {e}"))?
        .args(&args)
        .current_dir(&cwd)
        .output()
        .await
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

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

/// Opens a native OS save-file dialog and returns the chosen path without
/// writing anything. `default_name` is the suggested filename; `default_dir`
/// (if provided) opens the dialog in that directory — used to remember the
/// last export location.
///
/// Returns `Some(path)` or `None` if the user cancelled.
#[tauri::command]
pub async fn pick_save_path(
    default_name: String,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("Save Export As")
        .set_file_name(&default_name)
        .add_filter("MP4 Video", &["mp4"]);

    if let Some(dir) = default_dir {
        dialog = dialog.set_directory(&dir);
    }

    let handle = dialog.save_file().await;
    Ok(handle.map(|p| p.path().to_string_lossy().into_owned()))
}

/// Writes base64-decoded bytes to an explicit file path chosen by the caller.
///
/// The frontend base64-encodes the MP4 blob (same scheme as ffmpeg_write_file)
/// and passes the path returned by `pick_save_path`. Separating path-picking
/// from writing lets the user confirm the destination before the render starts.
#[tauri::command]
pub async fn save_bytes_to_disk(path: String, data_b64: String) -> Result<(), String> {
    let data = STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("save_bytes_to_disk: base64 decode failed: {e}"))?;
    fs::write(&path, &data).map_err(|e| format!("save_bytes_to_disk: {e}"))
}

/// Opens the file manager (Finder on macOS, Explorer on Windows) with the
/// specified file selected. Used for the "Show in Finder" button after a
/// successful export. Fire-and-forget: the OS handler runs asynchronously.
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
