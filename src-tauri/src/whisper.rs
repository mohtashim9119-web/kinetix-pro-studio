use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

/// Returns the path to the models directory bundled with the app.
/// In development: resolves relative to the executable in target/debug/.
/// In production: resolves relative to the app bundle resources.
fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let model = resource_dir.join("models").join("ggml-base.en.bin");
        if model.exists() {
            return Ok(model);
        }
    }
    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot get exe path: {e}"))?;
    let dev_model = exe
        .parent().unwrap_or(&exe)   // target/debug/
        .parent().unwrap_or(&exe)   // target/
        .parent().unwrap_or(&exe)   // src-tauri/
        .join("models")
        .join("ggml-base.en.bin");
    if dev_model.exists() {
        return Ok(dev_model);
    }
    Err("ggml-base.en.bin model not found. Run: curl -L -o src-tauri/models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin".to_string())
}

/// Represents a single word-level timestamp token from whisper JSON output.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct WhisperToken {
    pub text: String,
    pub t0: f64,   // start time in seconds
    pub t1: f64,   // end time in seconds
}

/// Represents a segment from whisper JSON output.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct WhisperSegment {
    pub text: String,
    pub t0: f64,
    pub t1: f64,
    pub tokens: Vec<WhisperToken>,
}

/// Result returned to the frontend.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct WhisperResult {
    pub segments: Vec<WhisperSegment>,
    pub text: String,
}

/// Transcribes an audio file using the bundled whisper-cli sidecar.
/// audio_b64: base64-encoded audio file bytes (WAV or MP3).
/// Returns word-level timestamps as WhisperResult.
#[tauri::command]
pub async fn whisper_transcribe(
    app: tauri::AppHandle,
    audio_b64: String,
) -> Result<WhisperResult, String> {
    // Decode audio bytes
    let audio_bytes = STANDARD
        .decode(&audio_b64)
        .map_err(|e| format!("base64 decode error: {e}"))?;

    // Write to a temp file
    let tmp_id = Uuid::new_v4().to_string();
    let tmp_dir = std::env::temp_dir().join(format!("kinetix-whisper-{}", tmp_id));
    fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("failed to create temp dir: {e}"))?;

    let audio_path = tmp_dir.join("audio.wav");
    fs::write(&audio_path, &audio_bytes)
        .map_err(|e| format!("failed to write audio: {e}"))?;

    let json_path = tmp_dir.join("output");

    // Resolve model path
    let model = model_path(&app)?;

    // Run whisper-cli sidecar
    // Flags:
    //   -m  model path
    //   -f  input audio
    //   -of output file prefix (whisper appends .json automatically)
    //   -oj output JSON
    //   --dtw base.en  word-level timestamps
    //   -np  no progress prints
    //   -l en  language English
    let output = app
        .shell()
        .sidecar("whisper")
        .map_err(|e| format!("sidecar error: {e}"))?
        .args([
            "-m", model.to_str().unwrap_or(""),
            "-f", audio_path.to_str().unwrap_or(""),
            "-of", json_path.to_str().unwrap_or(""),
            "-oj",
            "--dtw", "base.en",
            "-np",
            "-l", "en",
        ])
        .output()
        .await
        .map_err(|e| format!("whisper exec error: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Cleanup temp dir
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err(format!("whisper failed: {}", stderr));
    }

    // Read the JSON output file whisper wrote
    let json_file = tmp_dir.join("output.json");
    let json_str = fs::read_to_string(&json_file)
        .map_err(|e| format!("failed to read whisper output: {e}"))?;

    // Cleanup temp dir
    let _ = fs::remove_dir_all(&tmp_dir);

    // Parse whisper JSON output
    // Whisper JSON structure: { "transcription": [ { "text": "...", "timestamps": { "from": "00:00:00,000", "to": "..." }, "tokens": [ { "text": "...", "timestamps": { "from": "...", "to": "..." } } ] } ] }
    parse_whisper_json(&json_str)
}

/// Parses whisper-cli JSON output into WhisperResult.
fn parse_whisper_json(json_str: &str) -> Result<WhisperResult, String> {
    let raw: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| format!("JSON parse error: {e}"))?;

    let transcription = raw["transcription"]
        .as_array()
        .ok_or("missing transcription array")?;

    let mut segments = Vec::new();
    let mut full_text = String::new();

    for seg in transcription {
        let text = seg["text"].as_str().unwrap_or("").trim().to_string();
        full_text.push_str(&text);
        full_text.push(' ');

        let t0 = parse_timestamp(seg["timestamps"]["from"].as_str().unwrap_or("0:00:00,000"));
        let t1 = parse_timestamp(seg["timestamps"]["to"].as_str().unwrap_or("0:00:00,000"));

        let mut tokens = Vec::new();
        if let Some(token_arr) = seg["tokens"].as_array() {
            for tok in token_arr {
                let tok_text = tok["text"].as_str().unwrap_or("").to_string();
                let tok_t0 = parse_timestamp(tok["timestamps"]["from"].as_str().unwrap_or("0:00:00,000"));
                let tok_t1 = parse_timestamp(tok["timestamps"]["to"].as_str().unwrap_or("0:00:00,000"));
                tokens.push(WhisperToken {
                    text: tok_text,
                    t0: tok_t0,
                    t1: tok_t1,
                });
            }
        }

        segments.push(WhisperSegment { text, t0, t1, tokens });
    }

    Ok(WhisperResult {
        segments,
        text: full_text.trim().to_string(),
    })
}

/// Parses whisper timestamp format "HH:MM:SS,mmm" into seconds as f64.
fn parse_timestamp(ts: &str) -> f64 {
    // Format: "00:00:01,234" → 1.234 seconds
    let ts = ts.replace(',', ".");
    let parts: Vec<&str> = ts.split(':').collect();
    if parts.len() != 3 {
        return 0.0;
    }
    let h: f64 = parts[0].parse().unwrap_or(0.0);
    let m: f64 = parts[1].parse().unwrap_or(0.0);
    let s: f64 = parts[2].parse().unwrap_or(0.0);
    h * 3600.0 + m * 60.0 + s
}
