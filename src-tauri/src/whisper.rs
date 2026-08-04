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
    // `detected_language` (Phase 2a, multilingual model swap) is `Some(code)`
    // only when the invocation actually ran `-l auto` AND whisper-cli printed
    // an "auto-detected language" line to stderr — i.e. never set when the
    // caller passed an explicit language code (nothing to detect) and never
    // set on a run that failed before that line could print.
    Done { tokens: Vec<TranscriptToken>, detected_language: Option<String> },
    Error { message: String },
}

// ---------------------------------------------------------------------------
// Model path resolver
// ---------------------------------------------------------------------------

// Phase 2a (multilingual model swap, docs/sync-pipeline-v2-plan.md H.1) — the
// English-only ggml-base.en.bin is replaced by the multilingual
// ggml-large-v3-turbo.bin so `-l auto` (see whisper_transcribe below) is no
// longer silently ignored (whisper-cli ignores -l auto on an .en-suffixed
// model). Measured 2026-08-04: 1624555275 bytes (~1.51 GiB) on disk,
// ~2.1-2.2 GiB resident during inference (docs/sync-pipeline-v2-plan.md H.9).
const MODEL_FILENAME: &str = "ggml-large-v3-turbo.bin";

fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Production: resource_dir bundled by tauri
    if let Ok(resource_dir) = app.path().resource_dir() {
        let model = resource_dir.join("models").join(MODEL_FILENAME);
        if model.exists() {
            return Ok(model);
        }
        // Windows: Tauri v2 resource_dir may include a _up_ segment — try one level up too
        #[cfg(target_os = "windows")]
        {
            if let Some(parent) = resource_dir.parent() {
                let model = parent.join("models").join(MODEL_FILENAME);
                if model.exists() {
                    return Ok(model);
                }
            }
        }
    }

    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot get exe path: {e}"))?;

    // Production fallback: <bundle>/Contents/MacOS/../models/ (macOS app bundle)
    let prod_model = exe
        .parent()
        .unwrap_or(&exe)
        .join("models")
        .join(MODEL_FILENAME);
    if prod_model.exists() {
        return Ok(prod_model);
    }

    // Development: target/debug/ → target/ → src-tauri/ → models/
    let dev_model = exe
        .parent().unwrap_or(&exe)   // target/debug/
        .parent().unwrap_or(&exe)   // target/
        .parent().unwrap_or(&exe)   // src-tauri/
        .join("models")
        .join(MODEL_FILENAME);
    if dev_model.exists() {
        return Ok(dev_model);
    }

    Err(format!(
        "{MODEL_FILENAME} not found. \
         Run: curl -L -o src-tauri/models/{MODEL_FILENAME} \
         https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{MODEL_FILENAME}"
    ))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Transcodes any ffmpeg-readable audio file into a 16 kHz mono WAV via the
/// bundled ffmpeg sidecar.
///
/// This runs BEFORE whisper-cli sees the file. whisper.cpp's miniaudio backend
/// only decodes wav/mp3/ogg/flac, and fails silently on everything else (e.g.
/// M4A/AAC): exit code 0, zero tokens, no error. Normalizing through ffmpeg —
/// which is already the export muxer and reads virtually any container/codec —
/// makes that limitation irrelevant. `-ar 16000 -ac 1` matches whisper's own
/// internal target so no quality is lost versus feeding it a raw file.
async fn transcode_to_wav(
    app: &tauri::AppHandle,
    input: &std::path::Path,
    output: &std::path::Path,
) -> Result<(), String> {
    let out = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar lookup: {e}"))?
        .args([
            "-hide_banner",
            "-y",
            "-i", input.to_str().unwrap_or(""),
            "-ar", "16000",
            "-ac", "1",
            output.to_str().unwrap_or(""),
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail = if stderr.len() > 2000 {
            format!("...{}", &stderr[stderr.len() - 2000..])
        } else {
            stderr.to_string()
        };
        return Err(format!(
            "ffmpeg transcode failed (code {}): {}",
            out.status.code().unwrap_or(-1),
            tail
        ));
    }
    Ok(())
}

/// Transcribes audio via the bundled whisper-cli sidecar, streaming progress
/// and result tokens through the supplied Tauri IPC channel.
///
/// The raw upload is first normalized to 16 kHz mono WAV via `transcode_to_wav`
/// (see above) so whisper-cli's format limitations never apply.
///
/// * `audio_b64`    — base64-encoded audio bytes (any container ffmpeg can read)
/// * `duration_secs` — total audio duration (drives 0–100 progress)
/// * `language`     — a whisper language code (e.g. "en"), or "auto" to let
///                     whisper-cli detect it (Phase 2a — H.1/H.7: detection is
///                     a suggestion, stored per-project and user-overridable;
///                     the frontend passes "auto" only when the project has no
///                     stored/overridden language yet).
/// * `on_event`     — frontend channel receiving WhisperEvent variants
#[tauri::command]
pub async fn whisper_transcribe(
    app: tauri::AppHandle,
    state: tauri::State<'_, WhisperState>,
    audio_b64: String,
    duration_secs: f64,
    language: String,
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

    // Detect audio format from magic bytes, map to MIME, then resolve extension
    let mime = if audio_bytes.starts_with(b"RIFF") {
        "audio/wav"
    } else if audio_bytes.starts_with(b"ID3")
        || audio_bytes.starts_with(b"\xff\xfb")
        || audio_bytes.starts_with(b"\xff\xf3")
        || audio_bytes.starts_with(b"\xff\xf2")
    {
        "audio/mpeg"
    } else if audio_bytes.starts_with(b"\x00\x00\x00")
        && audio_bytes.get(4..8) == Some(b"ftyp")
    {
        "audio/mp4"
    } else if audio_bytes.starts_with(b"OggS") {
        "audio/ogg"
    } else if audio_bytes.starts_with(b"fLaC") {
        "audio/flac"
    } else if audio_bytes.starts_with(b"FORM")
        && (audio_bytes.get(8..12) == Some(b"AIFF") || audio_bytes.get(8..12) == Some(b"AIFC"))
    {
        "audio/aiff"
    } else if audio_bytes.starts_with(b"\x1a\x45\xdf\xa3") {
        "audio/webm"
    } else {
        "audio/wav" // fallback — let whisper try
    };

    let audio_ext = match mime {
        "audio/mpeg" | "audio/mp3"                  => "mp3",
        "audio/wav"  | "audio/wave" | "audio/x-wav" => "wav",
        "audio/ogg"  | "audio/vorbis"               => "ogg",
        "audio/flac" | "audio/x-flac"               => "flac",
        "audio/mp4"  | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/aiff" | "audio/x-aiff"               => "aiff",
        "audio/opus"                                 => "opus",
        "audio/webm"                                 => "webm",
        _                                            => "wav",
    };

    let audio_path = tmp_dir.join(format!("input.{}", audio_ext));
    fs::write(&audio_path, &audio_bytes).map_err(|e| format!("write audio: {e}"))?;

    // Universal pre-transcode: normalize the upload (any ffmpeg-readable
    // container/codec) into 16 kHz mono WAV before whisper-cli runs. On failure,
    // clean up and surface a real error rather than letting whisper silently
    // degrade — see transcode_to_wav's doc comment.
    let wav_path = tmp_dir.join("input_16k.wav");
    if let Err(e) = transcode_to_wav(&app, &audio_path, &wav_path).await {
        let _ = fs::remove_dir_all(&tmp_dir);
        let _ = on_event.send(WhisperEvent::Error { message: e });
        return Ok(());
    }

    let model = model_path(&app)?;

    // Phase 2a — language argument (docs/sync-pipeline-v2-plan.md, Step 3
    // decisions): "-l auto" (re-enabled now that the model is multilingual)
    // when the project has no stored/overridden language yet, else the
    // stored code directly, skipping re-detection. `-np` (no-prints) is
    // DROPPED: it was suppressing whisper-cli's "auto-detected language"
    // line along with the rest of the stderr diagnostic dump; empirically
    // verified (2026-08-04) that dropping it does not change stdout's token
    // lines at all (byte-identical with vs. without). `--dtw base.en` is
    // DROPPED: it was already a silent no-op (flash attention is on by
    // default and disables DTW; -nfa would enable it but breaks stdout
    // printing) AND the preset name is model-specific — carrying a
    // base.en-named preset over to turbo would be actively misleading. DTW
    // is Phase 2b/3 work, not this phase's (no timing-source change here).
    let (mut rx, child) = app
        .shell()
        .sidecar("whisper")
        .map_err(|e| format!("sidecar lookup: {e}"))?
        .args([
            "-m",  model.to_str().unwrap_or(""),
            "-f",  wav_path.to_str().unwrap_or(""),
            "-ml", "1",
            "-l",  language.as_str(),
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
    // Phase 2a — stderr is now scanned (previously fully ignored) for
    // whisper-cli's "auto-detected language: XX (p = 0.NN)" line, the only
    // way to observe what `-l auto` resolved to. Line-buffered the same way
    // stdout already is, just kept in a separate buffer/accumulator so the
    // two streams' interleaving can never corrupt either one's line framing.
    let mut err_line_buf: Vec<u8> = Vec::new();
    let mut detected_language: Option<String> = None;

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
            CommandEvent::Stderr(bytes) => {
                err_line_buf.extend_from_slice(&bytes);
                while let Some(pos) = err_line_buf.iter().position(|&b| b == b'\n') {
                    let raw: Vec<u8> = err_line_buf.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&raw)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if detected_language.is_none() {
                        if let Some(lang) = parse_detected_language(&line) {
                            detected_language = Some(lang);
                        }
                    }
                }
            }
            CommandEvent::Terminated(status) => {
                // Flush any remaining bytes in the line buffers.
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
                if !err_line_buf.is_empty() {
                    let line = String::from_utf8_lossy(&err_line_buf)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if detected_language.is_none() {
                        if let Some(lang) = parse_detected_language(&line) {
                            detected_language = Some(lang);
                        }
                    }
                    err_line_buf.clear();
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
                        let _ = on_event.send(WhisperEvent::Done { tokens, detected_language });
                    }
                    // SIGINT (130) or SIGTERM (143) — user cancelled; silent.
                    130 | 143 => {}
                    // -1073741795 == 0xC000001D == STATUS_ILLEGAL_INSTRUCTION
                    // (Windows): the whisper binary executed a CPU instruction
                    // (e.g. AVX2/FMA) this machine doesn't support. Surface a
                    // human-readable cause instead of the raw code.
                    -1073741795 => {
                        let _ = on_event.send(WhisperEvent::Error {
                            message: "Transcription failed: your CPU may not support \
                                      required instructions. This should be fixed by a \
                                      future update."
                                .to_string(),
                        });
                    }
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

/// Extracts the language code from a whisper-cli stderr line of the form
/// `whisper_full_with_state: auto-detected language: en (p = 0.999905)`
/// (verified against a real run, 2026-08-04), or None if the line doesn't
/// match. Only ever produced when `-l auto` was passed — a run given an
/// explicit language code skips detection and never prints this line.
fn parse_detected_language(line: &str) -> Option<String> {
    const MARKER: &str = "auto-detected language: ";
    let idx = line.find(MARKER)?;
    let after = &line[idx + MARKER.len()..];
    let code = after.split_whitespace().next()?;
    if code.is_empty() { None } else { Some(code.to_string()) }
}

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
