// ---------------------------------------------------------------------------
// In-app whisper model acquisition (bug 4 fix, WS2 Step 3 A4).
//
// The whisper model (`whisper.rs::MODEL_FILENAME`, ~1.51 GiB) is no longer
// bundled into the installer (`tauri.conf.json`'s `resources` map dropped
// `models/*` in the same change) — it is downloaded on demand into
// `app_local_data_dir()/models/`, which `whisper.rs::model_path` now checks
// first. This module owns that download: streamed progress, resumable
// partial downloads via a `.part` file + HTTP Range, atomic rename on
// completion, and a SHA-256 check before the rename (using the crate's own
// hand-rolled `sha256` module — no new dependency).
//
// Cancellation: a `Mutex<Arc<AtomicBool>>`-backed flag, the same shape as
// `whisper.rs::WhisperState` uses for its child-process handle, checked once
// per chunk. Cancelling leaves the `.part` file in place so a later call
// resumes from where it stopped, mirroring the resume-after-restart path.
// ---------------------------------------------------------------------------

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;
use tauri::Manager;

use crate::sha256::{hex_digest, Sha256};
use crate::whisper::MODEL_FILENAME;

/// Published at https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
/// (source cited in src-tauri/models/README.md). Size and SHA-256 measured
/// against a real local copy (2026-08-26) AND cross-checked against the
/// Hugging Face API's `lfs.oid` for this file — the two agreed exactly, so
/// both are hardcoded here rather than trusted from either source alone.
const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin";
const MODEL_SIZE_BYTES: u64 = 1_624_555_275;
const MODEL_SHA256: &str = "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69";

pub struct ModelDownloadState(pub Mutex<Arc<AtomicBool>>);

impl Default for ModelDownloadState {
    fn default() -> Self {
        ModelDownloadState(Mutex::new(Arc::new(AtomicBool::new(false))))
    }
}

// NOTE: `rename_all` is deliberately placed on each struct-like VARIANT below,
// never on the enum itself — `#[serde(tag = "event", ...)]` uses the variant
// NAME as the tag's value, so a top-level `rename_all` on the enum would also
// lowercase "Progress"/"Done"/etc. to "progress"/"done", breaking the JS
// side's `msg.event === 'Progress'` checks (`modelDownload.ts`) while the
// download itself kept working via the command's own Result — this exact
// mismatch was caught live: the `.part` file grew correctly on disk while the
// UI stayed stuck at 0/0, confirming the channel events were arriving but not
// matching. Per-variant `rename_all` only cases each variant's OWN fields
// (downloaded_bytes -> downloadedBytes), leaving "Progress"/"Done" intact.
#[derive(serde::Serialize, Clone)]
#[serde(tag = "event", content = "data")]
pub enum ModelDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Progress { downloaded_bytes: u64, total_bytes: u64 },
    Done,
    Cancelled,
    Error { message: String },
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadStatus {
    pub present: bool,
    pub partial_bytes: u64,
    pub total_bytes: u64,
}

fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("cannot resolve app_local_data_dir: {e}"))?
        .join("models");
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Reports whether the model is already present, and how much of a resumable
/// `.part` file (if any) already exists — used by the acquisition panel to
/// skip straight to "ready" or show a resume affordance instead of starting
/// cold.
#[tauri::command]
pub fn whisper_model_status(app: tauri::AppHandle) -> Result<ModelDownloadStatus, String> {
    let dir = models_dir(&app)?;
    let final_path = dir.join(MODEL_FILENAME);
    if final_path.exists() {
        return Ok(ModelDownloadStatus {
            present: true,
            partial_bytes: MODEL_SIZE_BYTES,
            total_bytes: MODEL_SIZE_BYTES,
        });
    }
    let part_path = dir.join(format!("{MODEL_FILENAME}.part"));
    let partial_bytes = fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
    Ok(ModelDownloadStatus { present: false, partial_bytes, total_bytes: MODEL_SIZE_BYTES })
}

#[tauri::command]
pub fn whisper_model_download_cancel(state: tauri::State<'_, ModelDownloadState>) {
    state.0.lock().unwrap().store(true, Ordering::SeqCst);
}

/// Streams the model to `app_local_data_dir()/models/{MODEL_FILENAME}.part`,
/// resuming via HTTP Range if a partial file already exists, then verifies
/// SHA-256 and atomically renames to the final filename. Never panics on a
/// network/IO error — always returns `Err` with an actionable message, and
/// leaves the `.part` file in place for a caller-initiated retry EXCEPT on a
/// checksum mismatch, where the corrupt data is deleted rather than reused.
#[tauri::command]
pub async fn whisper_model_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModelDownloadState>,
    on_event: Channel<ModelDownloadEvent>,
) -> Result<(), String> {
    let dir = models_dir(&app)?;
    let final_path = dir.join(MODEL_FILENAME);
    let part_path = dir.join(format!("{MODEL_FILENAME}.part"));

    if final_path.exists() {
        let _ = on_event.send(ModelDownloadEvent::Done);
        return Ok(());
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    *state.0.lock().unwrap() = cancel_flag.clone();

    let mut existing_len = fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
    // A `.part` file that is somehow >= the known final size is not a valid
    // resume point (the model is a fixed asset, not one that grows) — discard
    // it and restart clean rather than feeding a bogus Range request.
    if existing_len >= MODEL_SIZE_BYTES {
        let _ = fs::remove_file(&part_path);
        existing_len = 0;
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; KinetixPro/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client.get(MODEL_URL);
    if existing_len > 0 {
        request = request.header("Range", format!("bytes={existing_len}-"));
    }

    let mut response = request.send().await.map_err(|e| {
        format!("model download request failed: {e} (partial download, if any, kept at {} for retry)", part_path.display())
    })?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} downloading model from {MODEL_URL}", response.status()));
    }
    // A server that ignores our Range header (200 instead of 206) means we
    // must not append — start the .part file over from byte 0.
    let resumed = existing_len > 0 && response.status().as_u16() == 206;
    let start_offset = if resumed { existing_len } else { 0 };

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!resumed)
        .append(resumed)
        .open(&part_path)
        .map_err(|e| format!("cannot open {}: {e}", part_path.display()))?;

    // The hand-rolled `Sha256` hasher carries no serializable state, so a
    // resumed download re-hashes the bytes already on disk before streaming
    // the rest — the final digest must cover the WHOLE file regardless of how
    // many sessions it took to download, or a resumed download would always
    // fail its own checksum.
    let mut hasher = Sha256::new();
    if resumed {
        let mut existing = File::open(&part_path).map_err(|e| e.to_string())?;
        let mut buf = [0u8; 1 << 20];
        loop {
            let n = existing.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
    }

    let mut downloaded = start_offset;
    let mut last_emit = std::time::Instant::now();
    let _ = on_event.send(ModelDownloadEvent::Progress {
        downloaded_bytes: downloaded,
        total_bytes: MODEL_SIZE_BYTES,
    });

    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            let _ = on_event.send(ModelDownloadEvent::Cancelled);
            return Err("download cancelled — partial download kept for resume".to_string());
        }
        match response.chunk().await {
            Ok(Some(chunk)) => {
                file.write_all(&chunk)
                    .map_err(|e| format!("write failed (disk full?): {e}"))?;
                hasher.update(&chunk);
                downloaded += chunk.len() as u64;
                if last_emit.elapsed().as_millis() >= 150 {
                    let _ = on_event.send(ModelDownloadEvent::Progress {
                        downloaded_bytes: downloaded,
                        total_bytes: MODEL_SIZE_BYTES,
                    });
                    last_emit = std::time::Instant::now();
                }
            }
            Ok(None) => break,
            Err(e) => {
                let msg = format!("download interrupted: {e} (partial download kept at {} for resume)", part_path.display());
                let _ = on_event.send(ModelDownloadEvent::Error { message: msg.clone() });
                return Err(msg);
            }
        }
    }
    drop(file);

    let digest = hex_digest(&hasher.finish());
    if digest != MODEL_SHA256 {
        let _ = fs::remove_file(&part_path);
        let msg = format!(
            "downloaded model failed checksum verification (expected {MODEL_SHA256}, got {digest}) — deleted, please retry"
        );
        let _ = on_event.send(ModelDownloadEvent::Error { message: msg.clone() });
        return Err(msg);
    }

    fs::rename(&part_path, &final_path)
        .map_err(|e| format!("cannot finalize {}: {e}", final_path.display()))?;

    let _ = on_event.send(ModelDownloadEvent::Progress {
        downloaded_bytes: MODEL_SIZE_BYTES,
        total_bytes: MODEL_SIZE_BYTES,
    });
    let _ = on_event.send(ModelDownloadEvent::Done);
    Ok(())
}
