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

/// Raw-binary variant of `ffmpeg_write_file`.
///
/// Writes the invoke request's raw body bytes to <session_dir>/<path>. Unlike
/// `ffmpeg_write_file`, the payload is NOT base64-encoded: the frontend passes a
/// `Uint8Array`/`ArrayBuffer` as the invoke body (Tauri v2 raw request body), and
/// `session_id` + `path` travel as request headers. This eliminates the per-frame
/// base64 encode (JS) + inflated-string IPC transfer + base64 decode (Rust) that
/// dominated the per-frame PNG-write cost on the canvas export path (audit
/// confirmed disk I/O itself is sub-ms).
///
/// `ffmpeg_write_file` is left untouched for backward compatibility and other
/// callers; only the segment encoder's per-frame image path uses this command.
/// Validation and the `fs::write` logic are identical to `ffmpeg_write_file` —
/// only the transport differs.
#[tauri::command]
pub fn ffmpeg_write_file_raw(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let headers = request.headers();
    let session_id = headers
        .get("session-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "write_file_raw: missing or invalid 'session-id' header".to_string())?;
    let path = headers
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "write_file_raw: missing or invalid 'path' header".to_string())?;

    validate_path(path)?;
    let full = session_dir(session_id)?.join(path);

    match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => {
            fs::write(&full, data).map_err(|e| format!("write_file_raw({}): {}", path, e))
        }
        tauri::ipc::InvokeBody::Json(_) => {
            Err("write_file_raw: expected a raw byte body, got JSON".to_string())
        }
    }
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

/// Copies a finished file from a session directory straight to a user-chosen
/// destination path, WITHOUT reading its bytes into a `Vec<u8>` for IPC.
///
/// This is the export save path. The old path read the final MP4 back through
/// `ffmpeg_read_file` (`Vec<u8>` → JSON `number[]`, ~8× the file size in the
/// WebView heap) and then re-serialized it via Blob → arrayBuffer → base64 →
/// `save_bytes_to_disk` — a 5–6× memory pile-up that tripped WebView2's OOM guard
/// (STATUS_BREAKPOINT) on large exports. Copying natively keeps the bytes out of
/// the renderer entirely.
///
/// `file_name` is validated as a session-local filename (same rules as the other
/// session commands); `dest_path` is the absolute path returned by
/// `pick_save_path`. Uses `fs::copy` (not `rename`) so it works when `$TMPDIR`
/// and the destination live on different volumes (common on Windows). The source
/// is left in place for `ffmpeg_destroy_session` to reclaim.
#[tauri::command]
pub fn save_session_file(
    session_id: String,
    file_name: String,
    dest_path: String,
) -> Result<(), String> {
    validate_path(&file_name)?;
    let src = session_dir(&session_id)?.join(&file_name);
    fs::copy(&src, &dest_path)
        .map_err(|e| format!("save_session_file({} -> {}): {}", file_name, dest_path, e))?;
    Ok(())
}

/// Extracts duration in seconds from ffmpeg's stderr `Duration: HH:MM:SS.ss`
/// line. Returns None if the line is absent or unparseable (e.g. `Duration: N/A`
/// for a stream with no known length) — callers surface a real error rather than
/// synthesizing a fake duration.
fn parse_ffmpeg_duration(stderr: &str) -> Option<f64> {
    let idx = stderr.find("Duration:")?;
    let after = &stderr[idx + "Duration:".len()..];
    // "Duration: 00:01:23.45, start: ..." → take the "00:01:23.45" token.
    let ts = after.trim_start().split(',').next()?.trim();
    let parts: Vec<&str> = ts.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].trim().parse().ok()?;
    let m: f64 = parts[1].trim().parse().ok()?;
    let s: f64 = parts[2].trim().parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Runs `ffmpeg -i <input>` (no output file) purely to read the container header;
/// ffmpeg exits non-zero in this mode but prints `Duration:` to stderr, which we
/// parse. The bundled build ships ffmpeg only (no separate ffprobe binary), so
/// this is the portable way to probe duration through the same sidecar.
async fn ffmpeg_probe_duration_secs(
    app: &tauri::AppHandle,
    input: &std::path::Path,
) -> Result<f64, String> {
    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar lookup: {e}"))?
        .args(["-hide_banner", "-i", input.to_str().unwrap_or("")])
        .output()
        .await
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_ffmpeg_duration(&stderr)
        .ok_or_else(|| "could not determine audio duration from ffmpeg output".to_string())
}

/// Probes an audio file's duration (seconds) via the bundled ffmpeg binary.
///
/// Replaces the old WebView `<audio>`-element probe on the frontend, which was
/// codec-dependent (OGG silently failed on macOS WKWebView) and fell back to a
/// hardcoded 60 s. This path is codec-independent (ffmpeg reads virtually
/// anything) and returns a hard error on failure — no fake duration.
///
/// `audio_b64` is the base64-encoded upload (same scheme as `ffmpeg_write_file`).
#[tauri::command]
pub async fn probe_audio_duration(
    app: tauri::AppHandle,
    audio_b64: String,
) -> Result<f64, String> {
    let bytes = STANDARD
        .decode(&audio_b64)
        .map_err(|e| format!("probe_audio_duration: base64 decode failed: {e}"))?;

    let tmp_id = Uuid::new_v4().to_string();
    let tmp_dir = std::env::temp_dir().join(format!("kinetix-probe-{}", tmp_id));
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("probe: create temp dir: {e}"))?;
    let input = tmp_dir.join("probe_input");
    if let Err(e) = fs::write(&input, &bytes) {
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err(format!("probe: write input: {e}"));
    }

    let result = ffmpeg_probe_duration_secs(&app, &input).await;
    let _ = fs::remove_dir_all(&tmp_dir);
    result
}

/// Extracts the video frame rate from ffmpeg's stderr. ffmpeg prints the
/// video stream's frame rate inline in its stream-info line, e.g.:
///   `Stream #0:0(und): Video: h264 ..., 1920x1080, 29.97 fps, 30 tbr, ...`
/// This parses the numeric token immediately preceding the first standalone
/// " fps" occurrence. Returns None if absent/unparseable (e.g. an audio-only
/// file, or a container ffmpeg can't identify a video stream in).
fn parse_ffmpeg_fps(stderr: &str) -> Option<f64> {
    let idx = stderr.find(" fps")?;
    let before = stderr[..idx].trim_end();
    let start = before
        .rfind(|c: char| !(c.is_ascii_digit() || c == '.'))
        .map(|p| p + 1)
        .unwrap_or(0);
    let token = &before[start..];
    let fps: f64 = token.parse().ok()?;
    if fps > 0.0 {
        Some(fps)
    } else {
        None
    }
}

/// Runs `ffmpeg -i <input>` (no output file) purely to read the container header;
/// ffmpeg exits non-zero in this mode but prints the video stream's frame rate
/// to stderr, which we parse. Mirrors `ffmpeg_probe_duration_secs`.
async fn ffmpeg_probe_fps(
    app: &tauri::AppHandle,
    input: &std::path::Path,
) -> Result<f64, String> {
    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar lookup: {e}"))?
        .args(["-hide_banner", "-i", input.to_str().unwrap_or("")])
        .output()
        .await
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_ffmpeg_fps(&stderr)
        .ok_or_else(|| "could not determine video frame rate from ffmpeg output".to_string())
}

/// Probes a video file's native frame rate via the bundled ffmpeg binary.
///
/// Used at asset stage/import time to auto-suggest a matching `exportFps`
/// (see the judder audit: export previously resampled every video to a fixed
/// fps with no knowledge of the source's native rate, at times causing frame
/// duplication/drop judder). This probe only informs that UI suggestion — it
/// never feeds into per-segment retiming.
///
/// `video_b64` is the base64-encoded upload (same scheme as `ffmpeg_write_file`).
#[tauri::command]
pub async fn probe_video_fps(app: tauri::AppHandle, video_b64: String) -> Result<f64, String> {
    let bytes = STANDARD
        .decode(&video_b64)
        .map_err(|e| format!("probe_video_fps: base64 decode failed: {e}"))?;

    let tmp_id = Uuid::new_v4().to_string();
    let tmp_dir = std::env::temp_dir().join(format!("kinetix-probe-{}", tmp_id));
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("probe: create temp dir: {e}"))?;
    let input = tmp_dir.join("probe_input");
    if let Err(e) = fs::write(&input, &bytes) {
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err(format!("probe: write input: {e}"));
    }

    let result = ffmpeg_probe_fps(&app, &input).await;
    let _ = fs::remove_dir_all(&tmp_dir);
    result
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
