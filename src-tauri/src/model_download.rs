// ---------------------------------------------------------------------------
// In-app model acquisition — resumable download engine.
//
// Originally whisper-only (bug 4 fix, WS2 Step 3 A4): the whisper model
// (`whisper.rs::MODEL_FILENAME`, ~1.51 GiB) is no longer bundled into the
// installer (`tauri.conf.json`'s `resources` map dropped `models/*` in the
// same change) — it is downloaded on demand into `app_local_data_dir()/
// models/`, which `whisper.rs::model_path` now checks first.
//
// WS2 Step 13 Phase 3 generalized the download loop itself
// (`stream_download_verified`) so the FA-pack downloader (`models.rs::
// fa_model_download`) is a caller of the SAME engine, not a parallel copy:
// streamed progress, resumable partial downloads via a `.part` file + HTTP
// Range, atomic rename on completion, and a caller-supplied verification
// closure run before the rename (whisper: the sha256 check that lived here
// inline before this refactor; FA: `fa_dev::verify_model_manifest`, already
// exact-size+sha256 against the committed manifest — no new pinned constant
// added for FA). `ModelDownloadEvent`/`ModelDownloadState` stay generic
// (never whisper-specific in shape) and are reused as-is by both callers —
// the frontend's `modelDownload.ts` event union needed no change.
//
// Cancellation: a `Mutex<Arc<AtomicBool>>`-backed flag, the same shape as
// `whisper.rs::WhisperState` uses for its child-process handle, checked once
// per chunk. Cancelling leaves the `.part` file in place so a later call
// resumes from where it stopped, mirroring the resume-after-restart path.
//
// Redirect/resume note (WS2 Step 13 Phase 3.5): every call — including a
// resumed one — re-requests the STABLE `resolve/<rev>/...` URL, never a
// signed CDN URL captured from a prior response. `reqwest::Client`'s default
// redirect policy (up to 10 hops) follows the fresh 302 to whatever signed
// URL is current at request time, so a resume can never present an expired
// signed URL — there is nothing to expire because nothing signed is ever
// stored.
// ---------------------------------------------------------------------------

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;
use tauri::Manager;

use crate::whisper::MODEL_FILENAME;

/// Published at https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
/// (source cited in src-tauri/models/README.md). Size and SHA-256 measured
/// against a real local copy (2026-08-26) AND cross-checked against the
/// Hugging Face API's `lfs.oid` for this file — the two agreed exactly, so
/// both are hardcoded here rather than trusted from either source alone.
const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin";
pub(crate) const MODEL_SIZE_BYTES: u64 = 1_624_555_275;
pub(crate) const MODEL_SHA256: &str = "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69";
/// ggml's own file-format magic (`GGML_FILE_MAGIC` upstream), little-endian
/// bytes of `0x67676d6c` — measured against the real local model
/// (`ggml-large-v3-turbo.bin`'s first 4 bytes: `6c 6d 67 67`). Cheap
/// first-line-of-defense precheck for `import_local_model` before paying for
/// a full stream hash, mirroring `fa_dev.rs::verify_model_manifest`'s own
/// size-precheck-before-hash structure.
pub(crate) const GGML_MAGIC: [u8; 4] = [0x6c, 0x6d, 0x67, 0x67];

/// One cancel flag per in-flight download. Keyed by an opaque caller-chosen
/// string (`"whisper"` for the whisper command, `"fa-<lang>"` for the FA
/// downloader — `models::ModelId`'s own id strings, reused rather than
/// re-invented) so a whisper download and an FA download can be cancelled
/// independently and concurrently, unlike the old single-flag
/// `ModelDownloadState` this replaces.
#[derive(Default)]
pub struct ModelDownloadState(pub Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>);

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

pub(crate) fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

pub(crate) fn cancel_flag_for(state: &tauri::State<'_, ModelDownloadState>, key: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    state.0.lock().unwrap().insert(key.to_string(), flag.clone());
    flag
}

#[tauri::command]
pub fn whisper_model_download_cancel(state: tauri::State<'_, ModelDownloadState>) {
    if let Some(flag) = state.0.lock().unwrap().get("whisper") {
        flag.store(true, Ordering::SeqCst);
    }
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
    let cancel_flag = cancel_flag_for(&state, "whisper");

    stream_download_verified(
        MODEL_URL.to_string(),
        final_path,
        part_path,
        MODEL_SIZE_BYTES,
        cancel_flag,
        on_event,
        |path| {
            let digest = crate::sha256::hash_file(path).map_err(|e| e.to_string())?;
            if digest != MODEL_SHA256 {
                return Err(format!(
                    "downloaded model failed checksum verification (expected {MODEL_SHA256}, got {digest})"
                ));
            }
            Ok(())
        },
    )
    .await
}

/// The generic resumable-download core both `whisper_model_download` and
/// `models::fa_model_download` call. `verify` runs (on a blocking thread —
/// it may hash a multi-hundred-MB-to-multi-GB file) on the `.part` file
/// BEFORE the atomic rename; a verification failure deletes the `.part` and
/// never renames, so a bad download can never replace a previously-good
/// installed model. `url` is re-requested from scratch on every call
/// (including a resume) — see this module's own doc comment for why that
/// makes signed-URL expiry a non-issue.
pub(crate) async fn stream_download_verified(
    url: String,
    final_path: PathBuf,
    part_path: PathBuf,
    expected_size: u64,
    cancel_flag: Arc<AtomicBool>,
    on_event: Channel<ModelDownloadEvent>,
    verify: impl FnOnce(&Path) -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    if final_path.exists() {
        let _ = on_event.send(ModelDownloadEvent::Done);
        return Ok(());
    }

    let mut existing_len = fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
    // A `.part` file that is somehow >= the known final size is not a valid
    // resume point (every model this engine downloads is a fixed asset, not
    // one that grows) — discard it and restart clean rather than feeding a
    // bogus Range request.
    if existing_len >= expected_size {
        let _ = fs::remove_file(&part_path);
        existing_len = 0;
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; KinetixPro/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client.get(&url);
    if existing_len > 0 {
        request = request.header("Range", format!("bytes={existing_len}-"));
    }

    let mut response = request.send().await.map_err(|e| {
        format!("model download request failed: {e} (partial download, if any, kept at {} for retry)", part_path.display())
    })?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} downloading model from {url}", response.status()));
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

    let mut downloaded = start_offset;
    let mut last_emit = std::time::Instant::now();
    let _ =
        on_event.send(ModelDownloadEvent::Progress { downloaded_bytes: downloaded, total_bytes: expected_size });

    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            let _ = on_event.send(ModelDownloadEvent::Cancelled);
            return Err("download cancelled — partial download kept for resume".to_string());
        }
        match response.chunk().await {
            Ok(Some(chunk)) => {
                file.write_all(&chunk)
                    .map_err(|e| format!("write failed (disk full?): {e}"))?;
                downloaded += chunk.len() as u64;
                if last_emit.elapsed().as_millis() >= 150 {
                    let _ = on_event.send(ModelDownloadEvent::Progress {
                        downloaded_bytes: downloaded,
                        total_bytes: expected_size,
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

    finalize_verified_download(part_path, final_path, expected_size, on_event, verify).await
}

/// The post-download half of [`stream_download_verified`]: verify (on a
/// blocking thread — may hash a file up to ~1.6 GiB whisper / ~1.26 GiB FA)
/// then atomically rename, or on a verification failure delete the `.part`
/// and return its specific error. Split out from the network loop above so
/// it is directly testable without a real HTTP download — a test only needs
/// to place bytes at `part_path` itself.
async fn finalize_verified_download(
    part_path: PathBuf,
    final_path: PathBuf,
    expected_size: u64,
    on_event: Channel<ModelDownloadEvent>,
    verify: impl FnOnce(&Path) -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    let verify_path = part_path.clone();
    let verify_result =
        tauri::async_runtime::spawn_blocking(move || verify(&verify_path)).await.map_err(|e| e.to_string())?;

    if let Err(msg) = verify_result {
        let _ = fs::remove_file(&part_path);
        let full_msg = format!("{msg} — deleted, please retry");
        let _ = on_event.send(ModelDownloadEvent::Error { message: full_msg.clone() });
        return Err(full_msg);
    }

    fs::rename(&part_path, &final_path)
        .map_err(|e| format!("cannot finalize {}: {e}", final_path.display()))?;

    let _ =
        on_event.send(ModelDownloadEvent::Progress { downloaded_bytes: expected_size, total_bytes: expected_size });
    let _ = on_event.send(ModelDownloadEvent::Done);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sha256::{hex_digest, Sha256};

    /// `Sha256`/`hex_digest` stay imported by the crate-wide sha256 module
    /// used elsewhere; this file's own former inline streaming-hash re-check
    /// (removed by the Phase 3 refactor — `verify` now owns hashing) is
    /// covered instead by `hash_file_matches_in_memory_digest` in
    /// `sha256.rs` and by `models.rs`'s import-atomicity tests, which
    /// exercise the same `hash_file`/`GGML_MAGIC`/`MODEL_SHA256` constants
    /// this module still owns. This test only pins that the constants
    /// themselves didn't drift during the refactor.
    #[test]
    fn whisper_constants_unchanged_by_the_phase_3_refactor() {
        assert_eq!(MODEL_SIZE_BYTES, 1_624_555_275);
        assert_eq!(MODEL_SHA256, "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69");
        assert_eq!(GGML_MAGIC, [0x6c, 0x6d, 0x67, 0x67]);
    }

    #[test]
    fn hex_digest_still_reachable_for_a_zero_length_input() {
        let h = Sha256::new();
        assert_eq!(hex_digest(&h.finish()).len(), 64);
    }

    // -- finalize_verified_download (WS2 Step 13 Phase 3.4) -------------

    fn noop_channel() -> Channel<ModelDownloadEvent> {
        Channel::new(|_body| Ok(()))
    }

    #[test]
    fn finalize_rejects_on_verify_failure_deletes_part_and_never_renames() {
        let dir = std::env::temp_dir().join(format!("kinetix-finalize-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let part = dir.join("model.onnx.part");
        let final_path = dir.join("model.onnx");
        fs::write(&part, b"wrong bytes entirely").unwrap();
        // A prior installed model must survive a rejected finalize, same
        // invariant `models.rs::import_to_target` already proves for import.
        fs::write(&final_path, b"pre-existing good model").unwrap();

        let result = tauri::async_runtime::block_on(finalize_verified_download(
            part.clone(),
            final_path.clone(),
            21,
            noop_channel(),
            |_path| Err("expected size mismatch: got 21, wanted 999".to_string()),
        ));

        let err = result.expect_err("verify failure must reject");
        assert!(err.contains("expected size mismatch"), "error must be specific, got: {err}");
        assert!(!part.exists(), ".part must be deleted on verify failure");
        assert_eq!(fs::read(&final_path).unwrap(), b"pre-existing good model", "existing target must survive");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn finalize_renames_to_final_path_on_verify_success() {
        let dir = std::env::temp_dir().join(format!("kinetix-finalize-test-ok-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let part = dir.join("model.onnx.part");
        let final_path = dir.join("model.onnx");
        fs::write(&part, b"good bytes").unwrap();

        let result = tauri::async_runtime::block_on(finalize_verified_download(
            part.clone(),
            final_path.clone(),
            10,
            noop_channel(),
            |_path| Ok(()),
        ));

        assert!(result.is_ok(), "verify success must finalize, got {result:?}");
        assert!(!part.exists(), ".part must be gone after a successful rename");
        assert_eq!(fs::read(&final_path).unwrap(), b"good bytes");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancel_flags_are_independent_per_key() {
        let map: std::sync::Mutex<std::collections::HashMap<String, Arc<AtomicBool>>> =
            std::sync::Mutex::new(std::collections::HashMap::new());
        let a = Arc::new(AtomicBool::new(false));
        let b = Arc::new(AtomicBool::new(false));
        map.lock().unwrap().insert("whisper".to_string(), a.clone());
        map.lock().unwrap().insert("fa-en".to_string(), b.clone());
        a.store(true, Ordering::SeqCst);
        assert!(map.lock().unwrap().get("whisper").unwrap().load(Ordering::SeqCst));
        assert!(!map.lock().unwrap().get("fa-en").unwrap().load(Ordering::SeqCst));
    }
}
