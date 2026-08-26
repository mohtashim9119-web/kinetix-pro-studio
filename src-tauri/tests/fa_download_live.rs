// ---------------------------------------------------------------------------
// WS2 Step 13 Phase 3.8 — real end-to-end exercise of `models::fa_model_download`
// against the real, public `mohtashim9/kinetix-fa-models` HF repo: a full
// download to completion, then a fresh cancel-then-resume cycle, both
// against the smallest passing language (`en`, 1,262,512,711 bytes).
//
// Gated behind `FA_LIVE_DOWNLOAD=1` (mirrors `FA_LIVE_DURABLE_WAV`'s own
// convention in `fa_durable_wav_live.rs`) — this makes a real network
// request and writes into the REAL `app_local_data_dir` (same
// `mock_context::<Wry,_>` + real identifier pattern that file already
// established for reaching the production path), so it must never run in a
// plain `cargo test` sweep. The caller is responsible for having moved any
// existing `fa-models/en/model.onnx` aside first — this probe does NOT do
// that itself, to avoid a test silently deleting a real installed model a
// developer didn't intend to lose.
// ---------------------------------------------------------------------------

use app_lib::model_download::ModelDownloadState;
use app_lib::models::fa_model_download;
use tauri::ipc::Channel;
use tauri::Manager;

fn main() {
    if std::env::var("FA_LIVE_DOWNLOAD").ok().as_deref() != Some("1") {
        eprintln!(
            "SKIP fa_download_live: set FA_LIVE_DOWNLOAD=1 to run (WS2 Step 13 Phase 3.8, real \
             network request against the public HF repo, real app_local_data_dir writes)"
        );
        return;
    }

    let home = std::env::var("HOME").expect("HOME must be set");
    let mut ctx = tauri::test::mock_context::<tauri::Wry, _>(tauri::test::noop_assets());
    ctx.config_mut().identifier = "com.kinetix.pro-studio".to_string();

    let app = tauri::Builder::<tauri::Wry>::default()
        .manage(ModelDownloadState::default())
        .build(ctx)
        .expect("failed to build a real (Wry) Tauri app with zero windows for the live probe");
    let app_handle = app.handle().clone();

    let target = std::path::PathBuf::from(&home)
        .join("Library/Application Support/com.kinetix.pro-studio/fa-models/en/model.onnx");
    if target.exists() {
        panic!(
            "fa_download_live: {} already exists — move it aside before running this probe \
             (this probe deliberately does not delete an existing installed model itself)",
            target.display()
        );
    }

    // ---- Pass 1: full download to completion ----
    println!("fa_download_live: pass 1 — full download of en to {}", target.display());
    let start = std::time::Instant::now();
    let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let events_clone = events.clone();
    let on_event = Channel::new(move |body| {
        events_clone.lock().unwrap().push(format!("{body:?}"));
        Ok(())
    });
    let state = app_handle.state::<ModelDownloadState>();
    let result = tauri::async_runtime::block_on(fa_model_download(
        app_handle.clone(),
        state,
        "en".to_string(),
        on_event,
    ));
    let elapsed = start.elapsed();
    result.expect("pass 1 full download must succeed");
    let bytes = std::fs::metadata(&target).expect("target must exist after download").len();
    println!(
        "fa_download_live: pass 1 DONE — {bytes} bytes in {:.1}s ({:.2} MiB/s)",
        elapsed.as_secs_f64(),
        (bytes as f64 / 1024.0 / 1024.0) / elapsed.as_secs_f64().max(0.001)
    );
    assert_eq!(bytes, 1_262_512_711, "downloaded en model must match the manifest's exact byte size");
    let sidecar = target.with_extension("onnx.sha256");
    assert!(sidecar.exists(), "a successful download must write a .sha256 sidecar");
    println!("fa_download_live: sidecar present at {}", sidecar.display());

    // ---- Pass 2: delete, restart, cancel mid-flight, then resume ----
    std::fs::remove_file(&target).expect("remove pass-1 result to test cancel/resume fresh");
    std::fs::remove_file(&sidecar).ok();
    let part_path = target.with_extension("onnx.part");
    let _ = std::fs::remove_file(&part_path);

    println!("fa_download_live: pass 2 — start, cancel mid-flight, then resume");
    let cancel_state = app_handle.state::<ModelDownloadState>();
    let progress = std::sync::Arc::new(std::sync::Mutex::new(0u64));
    let progress_clone = progress.clone();
    let cancelled_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let cancelled_flag_clone = cancelled_flag.clone();
    let on_event2 = Channel::new(move |body| {
        let s = format!("{body:?}");
        if s.contains("Progress") {
            // Cheap parse: pull the first number after "downloadedBytes".
            if let Some(idx) = s.find("downloadedBytes") {
                if let Some(digits) = s[idx..].split(|c: char| !c.is_ascii_digit()).find(|d| !d.is_empty()) {
                    if let Ok(n) = digits.parse::<u64>() {
                        *progress_clone.lock().unwrap() = n;
                    }
                }
            }
        }
        if s.contains("Cancelled") {
            cancelled_flag_clone.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        Ok(())
    });

    let app_handle_for_cancel = app_handle.clone();
    let canceller = std::thread::spawn(move || {
        // Give the download several real seconds to get well underway before
        // cancelling — the first pass measured ~2.7 MiB/s, and connection
        // setup (DNS + TLS + the resolve/ redirect to the signed CDN URL)
        // alone can eat close to a second, so a short delay risks cancelling
        // before any bytes are actually on disk (observed once: cancelled at
        // 0 reported bytes with an 800ms delay).
        std::thread::sleep(std::time::Duration::from_secs(5));
        let state = app_handle_for_cancel.state::<ModelDownloadState>();
        let flag = state.0.lock().unwrap().get("fa-en").cloned();
        if let Some(flag) = flag {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    });
    let result2 = tauri::async_runtime::block_on(fa_model_download(
        app_handle.clone(),
        cancel_state,
        "en".to_string(),
        on_event2,
    ));
    canceller.join().unwrap();
    assert!(result2.is_err(), "a cancelled download must return Err");
    let partial_bytes_at_cancel = *progress.lock().unwrap();
    println!(
        "fa_download_live: pass 2 cancelled after {partial_bytes_at_cancel} bytes, part file present={}",
        part_path.exists()
    );
    assert!(part_path.exists(), ".part must survive a cancel, for resume");
    // Ground truth from the actual file on disk — authoritative, unlike
    // `partial_bytes_at_cancel` above (parsed from progress-channel text,
    // which can legitimately still read 0 if cancellation raced the very
    // first progress emit even after real bytes were written).
    let part_len_after_cancel = std::fs::metadata(&part_path).unwrap().len();
    assert!(
        part_len_after_cancel > 0,
        "cancel must have captured SOME bytes on disk to prove resume isn't starting from zero"
    );

    println!("fa_download_live: pass 2 — resuming from {part_len_after_cancel} bytes");
    let resume_state = app_handle.state::<ModelDownloadState>();
    let on_event3 = Channel::new(|_body| Ok(()));
    let resume_start = std::time::Instant::now();
    let result3 =
        tauri::async_runtime::block_on(fa_model_download(app_handle.clone(), resume_state, "en".to_string(), on_event3));
    result3.expect("resumed download must succeed");
    println!("fa_download_live: pass 2 resume completed in {:.1}s", resume_start.elapsed().as_secs_f64());

    let final_bytes = std::fs::metadata(&target).expect("target must exist after resume").len();
    assert_eq!(final_bytes, 1_262_512_711, "resumed download must reach the exact expected size");
    assert!(sidecar.exists(), "a successful resumed download must write a .sha256 sidecar");
    assert!(!part_path.exists(), ".part must be gone after a successful finalize");

    println!(
        "fa_download_live: RESULT — pass1 fresh download: {bytes} bytes / {:.1}s; \
         pass2 cancel-then-resume: cancelled at {partial_bytes_at_cancel} bytes, resumed and \
         finished at {final_bytes} bytes in {:.1}s; manifest verification passed both times \
         (fa_dev::verify_model_manifest ran inside fa_model_download before each finalize).",
        elapsed.as_secs_f64(),
        resume_start.elapsed().as_secs_f64()
    );
}
