use base64::{engine::general_purpose::STANDARD, Engine};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

/// Tracks the currently-running ffmpeg child process per session (D13 fix).
/// `ffmpeg_exec` inserts its `CommandChild` here for the duration of the run;
/// `ffmpeg_kill_session` removes and kills it. At most one entry per session_id
/// since a session runs its ffmpeg calls sequentially (segment encode, concat,
/// mux — never concurrently).
#[derive(Default)]
pub struct FfmpegProcessState(pub Mutex<HashMap<String, CommandChild>>);

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

/// Append-binary variant of `ffmpeg_write_file_raw`, for the WebCodecs export
/// worker's streamed annexb chunk output (docs/webcodecs-export-plan.md §6).
///
/// Same header extraction + `validate_path` + `session_dir` pattern as
/// `ffmpeg_write_file_raw`; the only difference is `OpenOptions::append(true)`
/// instead of a truncating `fs::write`. `create(true)` means the first append
/// for a given path creates the file; every subsequent append for that path
/// extends it — exactly the semantics a per-run `run_K.h264` stream needs as
/// `VideoEncoder` chunks arrive one at a time.
#[tauri::command]
pub fn ffmpeg_append_file_raw(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    use std::io::Write;

    let headers = request.headers();
    let session_id = headers
        .get("session-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "append_file_raw: missing or invalid 'session-id' header".to_string())?;
    let path = headers
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "append_file_raw: missing or invalid 'path' header".to_string())?;

    validate_path(path)?;
    let full = session_dir(session_id)?.join(path);

    match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => {
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&full)
                .map_err(|e| format!("append_file_raw({}): open: {}", path, e))?;
            file.write_all(data)
                .map_err(|e| format!("append_file_raw({}): write: {}", path, e))
        }
        tauri::ipc::InvokeBody::Json(_) => {
            Err("append_file_raw: expected a raw byte body, got JSON".to_string())
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

/// Counts H.264 Annex B coded-picture NAL units (type 1 = non-IDR slice, type 5
/// = IDR slice) in <session_dir>/<path>, without ever sending the file's bytes
/// to the renderer.
///
/// Replaces the WebCodecs export orchestrator's previous frame-count guard
/// (`exportPipelineWebCodecs.ts`'s `ffmpeg.readFile` + JS `countAnnexbFrames`
/// scan), which cost ~5s per export pulling the whole concatenated annexb
/// file's bytes across IPC just to count frames. This command reads the file
/// in bounded 64 KB chunks — never the whole file at once — and performs the
/// identical left-to-right Annex-B start-code scan the JS version used, so the
/// count matches it exactly.
///
/// Boundary handling: a start code (`00 00 01`) or its following NAL-type
/// header byte can straddle a 64 KB chunk boundary. Each iteration only
/// resolves positions where the header byte is definitely inside the current
/// window (`i + 3 < len`); anything closer to the end (at most 3 bytes) is
/// carried into the next chunk instead of guessed at. The final leftover
/// (after EOF) is scanned with the exact bounds semantics of the original
/// whole-file scan — a header byte beyond the true end of file is never
/// counted, matching `bytes[headerIdx] ... if (headerIdx < n)` in the JS
/// reference implementation.
#[tauri::command]
pub fn ffmpeg_count_annexb_frames(session_id: String, path: String) -> Result<u64, String> {
    use std::io::Read;

    validate_path(&path)?;
    let full = session_dir(&session_id)?.join(&path);
    let mut file = fs::File::open(&full)
        .map_err(|e| format!("count_annexb_frames({}): open: {}", path, e))?;

    const CHUNK_SIZE: usize = 64 * 1024;
    let mut read_buf = vec![0u8; CHUNK_SIZE];
    let mut leftover: Vec<u8> = Vec::with_capacity(4);
    let mut count: u64 = 0;

    loop {
        let n = file
            .read(&mut read_buf)
            .map_err(|e| format!("count_annexb_frames({}): read: {}", path, e))?;
        if n == 0 {
            break;
        }

        // Combine any carried-over tail bytes from the previous chunk with
        // this chunk's new bytes so a start code (or its header byte) that
        // straddles a chunk boundary is never missed.
        let mut window = std::mem::take(&mut leftover);
        window.extend_from_slice(&read_buf[..n]);

        let len = window.len();
        let mut i = 0usize;
        while i + 3 < len {
            if window[i] == 0 && window[i + 1] == 0 && window[i + 2] == 1 {
                let nal_type = window[i + 3] & 0x1f;
                if nal_type == 1 || nal_type == 5 {
                    count += 1;
                }
                i += 3;
            } else {
                i += 1;
            }
        }
        leftover = window[i..].to_vec();
    }

    // Final pass over whatever remains (at most 3 bytes) using the true-EOF
    // bounds semantics described above.
    let n = leftover.len();
    let mut i = 0usize;
    while i + 2 < n {
        if leftover[i] == 0 && leftover[i + 1] == 0 && leftover[i + 2] == 1 {
            let header_idx = i + 3;
            if header_idx < n {
                let nal_type = leftover[header_idx] & 0x1f;
                if nal_type == 1 || nal_type == 5 {
                    count += 1;
                }
            }
            i = header_idx;
        } else {
            i += 1;
        }
    }

    Ok(count)
}

/// Stream-concatenates a list of AnnexB H.264 piece files (in order) into a
/// single `output_path`, keeping only TWO file descriptors open at any instant
/// (one read, one write) — independent of piece count.
///
/// Replaces the WebCodecs export orchestrator's previous ffmpeg concat-protocol
/// pipe-list (`ffmpeg -i "concat:piece_0.h264|piece_1.h264|..."`), which opens
/// EVERY input simultaneously. On macOS the default per-process soft
/// file-descriptor limit (`ulimit -n`) is 256, so a large-segment export (each
/// non-GL segment becomes its own `piece_NN.h264`) blows past it partway through
/// the open phase — reproduced as `ffmpeg exited with code 232: Too many open
/// files` on a 407-segment project. Windows has no fixed per-process FD cap, so
/// it never surfaced there; this helper is OS-independent by construction.
///
/// Raw byte concatenation of AnnexB streams is spec-valid: every NAL unit is
/// start-code-prefixed (`00 00 01` / `00 00 00 01`), so appending one stream's
/// bytes after another's needs no container/framing rewrite. This helper is
/// therefore deliberately NOT AnnexB-aware — it does no NAL parsing (that is
/// `ffmpeg_count_annexb_frames`'s job, used by the orchestrator's post-concat
/// frame-count guard to prove the result is byte-correct). Uses a fixed 64 KB
/// copy buffer, matching `ffmpeg_count_annexb_frames`'s chunk size.
///
/// `output_path` is truncated/created. Every piece path (and the output path)
/// is `validate_path`-checked up front, before the output is opened, so a bad
/// path can never truncate an existing output. On ANY error (a missing or
/// unreadable piece, a write failure), the partial `output_path` is removed
/// before returning `Err` — a failed concat never leaves a half-written file
/// behind for a later step to mistake for a complete one.
#[tauri::command]
pub fn ffmpeg_concat_annexb_pieces(
    session_id: String,
    piece_paths: Vec<String>,
    output_path: String,
) -> Result<(), String> {
    validate_path(&output_path)?;
    for piece in &piece_paths {
        validate_path(piece)?;
    }

    let dir = session_dir(&session_id)?;
    let out_full = dir.join(&output_path);

    let result = concat_annexb_pieces_inner(&dir, &piece_paths, &out_full);
    if result.is_err() {
        // Don't leave a partial/corrupt output behind on failure. The write
        // handle inside `concat_annexb_pieces_inner` has already been dropped
        // (closed) by the time it returns, so this remove is safe.
        let _ = fs::remove_file(&out_full);
    }
    result
}

fn concat_annexb_pieces_inner(
    dir: &std::path::Path,
    piece_paths: &[String],
    out_full: &std::path::Path,
) -> Result<(), String> {
    use std::io::{Read, Write};

    let mut out = fs::File::create(out_full)
        .map_err(|e| format!("concat_annexb_pieces: create output: {}", e))?;

    const CHUNK_SIZE: usize = 64 * 1024;
    let mut buf = vec![0u8; CHUNK_SIZE];

    for piece in piece_paths {
        let piece_full = dir.join(piece);
        let mut input = fs::File::open(&piece_full)
            .map_err(|e| format!("concat_annexb_pieces: open piece({}): {}", piece, e))?;
        loop {
            let n = input
                .read(&mut buf)
                .map_err(|e| format!("concat_annexb_pieces: read piece({}): {}", piece, e))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])
                .map_err(|e| format!("concat_annexb_pieces: write output: {}", e))?;
        }
    }

    out.flush()
        .map_err(|e| format!("concat_annexb_pieces: flush output: {}", e))?;
    Ok(())
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
///
/// D13 fix — uses `spawn()` instead of `output()` so the child's `CommandChild`
/// handle can be stored in `FfmpegProcessState` for the duration of the run,
/// making it killable via `ffmpeg_kill_session` (the frontend's export-cancel
/// path). Stdout is discarded (as `output()` effectively was for our purposes —
/// only stderr was ever read); stderr is collected the same way for the same
/// error-tail reporting.
#[tauri::command]
pub async fn ffmpeg_exec(
    app: tauri::AppHandle,
    session_id: String,
    args: Vec<String>,
    state: tauri::State<'_, FfmpegProcessState>,
) -> Result<i32, String> {
    let cwd = session_dir(&session_id)?;

    let (mut rx, child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar error: {e}"))?
        .args(&args)
        .current_dir(&cwd)
        .spawn()
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    state.0.lock().unwrap().insert(session_id.clone(), child);

    let mut code: Option<i32> = None;
    let mut stderr: Vec<u8> = Vec::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Terminated(payload) => code = payload.code,
            CommandEvent::Stderr(line) => {
                stderr.extend(line);
                stderr.push(b'\n');
            }
            CommandEvent::Stdout(_) | CommandEvent::Error(_) => {}
            _ => {}
        }
    }

    // Already removed by ffmpeg_kill_session if this run was cancelled — a normal
    // completion removes it here instead.
    state.0.lock().unwrap().remove(&session_id);

    let exit_code = code.unwrap_or(-1);

    if exit_code != 0 {
        let stderr_str = String::from_utf8_lossy(&stderr);
        // Truncate to last 2000 chars to avoid pathologically large error payloads.
        let tail = if stderr_str.len() > 2000 {
            format!("...{}", &stderr_str[stderr_str.len() - 2000..])
        } else {
            stderr_str.to_string()
        };
        return Err(format!("ffmpeg exited with code {}: {}", exit_code, tail));
    }

    Ok(exit_code)
}

/// Kills the in-flight ffmpeg subprocess for `session_id`, if one is currently
/// running (D13 fix). A no-op — not an error — when nothing is running for that
/// session, which covers both "the export already finished" and "cancel raced
/// ahead of the first ffmpeg_exec call" without the caller needing to know which.
///
/// Called from the frontend's export-cancel path BEFORE `ffmpeg_destroy_session`
/// deletes the session temp dir, so the sidecar is no longer writing into a
/// directory that's about to disappear out from under it.
#[tauri::command]
pub fn ffmpeg_kill_session(
    session_id: String,
    state: tauri::State<'_, FfmpegProcessState>,
) -> Result<(), String> {
    if let Some(child) = state.0.lock().unwrap().remove(&session_id) {
        child
            .kill()
            .map_err(|e| format!("kill_session({}): {}", session_id, e))?;
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a real session directory (matching `session_dir`'s layout) so the
    /// public `ffmpeg_concat_annexb_pieces` command — including its on-error
    /// cleanup — can be exercised end to end.
    fn make_session() -> (String, PathBuf) {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{}", id));
        fs::create_dir_all(&dir).unwrap();
        (id, dir)
    }

    #[test]
    fn concat_annexb_pieces_produces_exact_byte_concatenation() {
        let (id, dir) = make_session();
        fs::write(dir.join("piece_0.h264"), [0u8, 1, 2, 3]).unwrap();
        fs::write(dir.join("piece_1.h264"), [4u8, 5]).unwrap();
        fs::write(dir.join("piece_2.h264"), [6u8, 7, 8, 9, 10]).unwrap();

        let result = ffmpeg_concat_annexb_pieces(
            id,
            vec![
                "piece_0.h264".to_string(),
                "piece_1.h264".to_string(),
                "piece_2.h264".to_string(),
            ],
            "video_all.h264".to_string(),
        );
        assert!(result.is_ok(), "concat should succeed: {:?}", result);

        let out = fs::read(dir.join("video_all.h264")).unwrap();
        assert_eq!(out, vec![0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn concat_annexb_pieces_handles_larger_than_chunk_input() {
        // A piece larger than the 64 KB copy buffer must be streamed across
        // multiple read/write iterations with no byte loss at the boundary.
        let (id, dir) = make_session();
        let big: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(dir.join("piece_0.h264"), &big).unwrap();
        fs::write(dir.join("piece_1.h264"), [42u8, 43, 44]).unwrap();

        let result = ffmpeg_concat_annexb_pieces(
            id,
            vec!["piece_0.h264".to_string(), "piece_1.h264".to_string()],
            "video_all.h264".to_string(),
        );
        assert!(result.is_ok(), "concat should succeed: {:?}", result);

        let out = fs::read(dir.join("video_all.h264")).unwrap();
        let mut expected = big.clone();
        expected.extend_from_slice(&[42u8, 43, 44]);
        assert_eq!(out, expected);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn concat_annexb_pieces_missing_piece_errors_and_leaves_no_partial_output() {
        let (id, dir) = make_session();
        fs::write(dir.join("piece_0.h264"), [10u8, 11, 12]).unwrap();
        // piece_1.h264 deliberately absent.
        fs::write(dir.join("piece_2.h264"), [20u8, 21]).unwrap();

        let result = ffmpeg_concat_annexb_pieces(
            id,
            vec![
                "piece_0.h264".to_string(),
                "piece_1.h264".to_string(),
                "piece_2.h264".to_string(),
            ],
            "video_all.h264".to_string(),
        );
        assert!(result.is_err(), "expected Err for a missing piece");
        assert!(
            !dir.join("video_all.h264").exists(),
            "partial output must be cleaned up on error"
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn concat_annexb_pieces_rejects_traversal_paths() {
        let (id, _dir) = make_session();
        let result = ffmpeg_concat_annexb_pieces(
            id.clone(),
            vec!["../escape.h264".to_string()],
            "video_all.h264".to_string(),
        );
        assert!(result.is_err(), "path traversal in a piece path must be rejected");

        let dir = std::env::temp_dir().join(format!("kinetix-export-{}", id));
        fs::remove_dir_all(&dir).unwrap();
    }
}
