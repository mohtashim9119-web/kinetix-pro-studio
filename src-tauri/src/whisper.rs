use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

pub struct WhisperState(pub Mutex<Option<CommandChild>>);

impl Default for WhisperState {
    fn default() -> Self {
        WhisperState(Mutex::new(None))
    }
}

// SAFETY: CommandChild is Send + Sync in tauri_plugin_shell.
unsafe impl Send for WhisperState {}
unsafe impl Sync for WhisperState {}

// ---------------------------------------------------------------------------
// IPC event types
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptToken {
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(tag = "event", content = "data")]
pub enum WhisperEvent {
    Progress { percent: u8 },
    Done { tokens: Vec<TranscriptToken> },
    Error { message: String },
}

// ---------------------------------------------------------------------------
// Model path resolver
// ---------------------------------------------------------------------------

fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Production: resource_dir bundled by tauri
    if let Ok(resource_dir) = app.path().resource_dir() {
        let model = resource_dir.join("models").join("ggml-base.en.bin");
        if model.exists() {
            return Ok(model);
        }
    }

    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot get exe path: {e}"))?;

    // Production fallback: <bundle>/Contents/MacOS/../models/ (macOS app bundle)
    let prod_model = exe
        .parent()
        .unwrap_or(&exe)
        .join("models")
        .join("ggml-base.en.bin");
    if prod_model.exists() {
        return Ok(prod_model);
    }

    // Development: target/debug/ → target/ → src-tauri/ → models/
    let dev_model = exe
        .parent().unwrap_or(&exe)   // target/debug/
        .parent().unwrap_or(&exe)   // target/
        .parent().unwrap_or(&exe)   // src-tauri/
        .join("models")
        .join("ggml-base.en.bin");
    if dev_model.exists() {
        return Ok(dev_model);
    }

    Err(
        "ggml-base.en.bin not found. \
         Run: curl -L -o src-tauri/models/ggml-base.en.bin \
         https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
            .to_string(),
    )
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Transcribes audio via the bundled whisper-cli sidecar, streaming progress
/// and result tokens through the supplied Tauri IPC channel.
///
/// * `audio_b64`    — base64-encoded WAV bytes
/// * `duration_secs` — total audio duration (drives 0–100 progress)
/// * `on_event`     — frontend channel receiving WhisperEvent variants
#[tauri::command]
pub async fn whisper_transcribe(
    app: tauri::AppHandle,
    state: tauri::State<'_, WhisperState>,
    audio_b64: String,
    duration_secs: f64,
    on_event: Channel<WhisperEvent>,
) -> Result<(), String> {
    // Kill any previously running whisper child before starting a new job.
    {
        let mut lock = state.0.lock().map_err(|_| "state lock poisoned")?;
        if let Some(child) = lock.take() {
            let _ = child.kill();
        }
    }

    let audio_bytes = STANDARD
        .decode(&audio_b64)
        .map_err(|e| format!("base64 decode: {e}"))?;

    let tmp_id = Uuid::new_v4().to_string();
    let tmp_dir = std::env::temp_dir().join(format!("kinetix-whisper-{}", tmp_id));
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("create temp dir: {e}"))?;

    // Detect audio format from magic bytes and use correct extension
    let audio_ext = if audio_bytes.starts_with(b"RIFF") {
        "wav"
    } else if audio_bytes.starts_with(b"ID3")
        || audio_bytes.starts_with(b"\xff\xfb")
        || audio_bytes.starts_with(b"\xff\xf3")
        || audio_bytes.starts_with(b"\xff\xf2")
    {
        "mp3"
    } else if audio_bytes.starts_with(b"\x00\x00\x00")
        && audio_bytes.get(4..8) == Some(b"ftyp")
    {
        "m4a"
    } else if audio_bytes.starts_with(b"OggS") {
        "ogg"
    } else {
        "wav" // fallback — let whisper try
    };

    let audio_path = tmp_dir.join(format!("input.{}", audio_ext));
    fs::write(&audio_path, &audio_bytes).map_err(|e| format!("write audio: {e}"))?;

    let model = model_path(&app)?;

    let (mut rx, child) = app
        .shell()
        .sidecar("whisper")
        .map_err(|e| format!("sidecar lookup: {e}"))?
        .args([
            "-m",    model.to_str().unwrap_or(""),
            "-f",    audio_path.to_str().unwrap_or(""),
            "-ml",   "1",
            "-np",
            "-l",    "en",
            "--dtw", "base.en",
        ])
        .spawn()
        .map_err(|e| format!("whisper spawn: {e}"))?;

    // Store child so whisper_cancel can kill it.
    {
        let mut lock = state.0.lock().map_err(|_| "state lock poisoned")?;
        *lock = Some(child);
    }

    let mut line_buf: Vec<u8> = Vec::new();
    let mut accumulated: Vec<String> = Vec::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                line_buf.extend_from_slice(&bytes);
                // Drain complete lines from the buffer.
                while let Some(pos) = line_buf.iter().position(|&b| b == b'\n') {
                    let raw: Vec<u8> = line_buf.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&raw)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if let Some(end_sec) = parse_progress_line(&line) {
                        let percent = if duration_secs > 0.0 {
                            ((end_sec / duration_secs) * 100.0).clamp(0.0, 100.0) as u8
                        } else {
                            0
                        };
                        let _ = on_event.send(WhisperEvent::Progress { percent });
                    }
                    if !line.is_empty() {
                        accumulated.push(line);
                    }
                }
            }
            CommandEvent::Stderr(_) => {
                // whisper-cli writes timing info to stderr; ignored.
            }
            CommandEvent::Terminated(status) => {
                // Flush any remaining bytes in the line buffer.
                if !line_buf.is_empty() {
                    let line = String::from_utf8_lossy(&line_buf)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if !line.is_empty() {
                        accumulated.push(line);
                    }
                    line_buf.clear();
                }

                // Remove stored child (process is gone).
                {
                    let mut lock = state.0.lock().map_err(|_| "state lock poisoned")?;
                    *lock = None;
                }
                let _ = fs::remove_dir_all(&tmp_dir);

                let code = status.code.unwrap_or(-1);
                match code {
                    0 => {
                        let tokens = parse_stdout_tokens(&accumulated);
                        let _ = on_event.send(WhisperEvent::Done { tokens });
                    }
                    // SIGINT (130) or SIGTERM (143) — user cancelled; silent.
                    130 | 143 => {}
                    other => {
                        let _ = on_event.send(WhisperEvent::Error {
                            message: format!("whisper exited with code {other}"),
                        });
                    }
                }
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

/// Kills any running whisper transcription job.
#[tauri::command]
pub async fn whisper_cancel(
    state: tauri::State<'_, WhisperState>,
) -> Result<(), String> {
    let mut lock = state.0.lock().map_err(|_| "state lock poisoned")?;
    if let Some(child) = lock.take() {
        let _ = child.kill();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/// Returns the end timestamp in seconds from a whisper progress line of the
/// form `[HH:MM:SS.mmm --> HH:MM:SS.mmm]  text…`, or None if the line
/// doesn't match.
fn parse_progress_line(line: &str) -> Option<f64> {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') {
        return None;
    }
    let arrow = trimmed.find(" --> ")?;
    let after = &trimmed[arrow + 5..];
    let close = after.find(']')?;
    Some(parse_timestamp(&after[..close]))
}

/// Converts accumulated whisper stdout lines into `TranscriptToken` list.
fn parse_stdout_tokens(lines: &[String]) -> Vec<TranscriptToken> {
    let mut tokens = Vec::new();
    for line in lines {
        let trimmed = line.trim();
        if !trimmed.starts_with('[') {
            continue;
        }
        let close = match trimmed.find(']') {
            Some(i) => i,
            None => continue,
        };
        let ts_part = &trimmed[1..close];
        let arrow = match ts_part.find(" --> ") {
            Some(i) => i,
            None => continue,
        };
        let start_sec = parse_timestamp(&ts_part[..arrow]);
        let end_sec = parse_timestamp(&ts_part[arrow + 5..]);
        let text = trimmed[close + 1..].trim().to_string();
        if !text.is_empty() {
            tokens.push(TranscriptToken { start_sec, end_sec, text });
        }
    }
    tokens
}

/// Parses whisper timestamp strings (`HH:MM:SS.mmm` or `HH:MM:SS,mmm`) into
/// seconds as `f64`.
fn parse_timestamp(ts: &str) -> f64 {
    let ts = ts.trim().replace(',', ".");
    let parts: Vec<&str> = ts.split(':').collect();
    if parts.len() != 3 {
        return 0.0;
    }
    let h: f64 = parts[0].parse().unwrap_or(0.0);
    let m: f64 = parts[1].parse().unwrap_or(0.0);
    let s: f64 = parts[2].parse().unwrap_or(0.0);
    h * 3600.0 + m * 60.0 + s
}
