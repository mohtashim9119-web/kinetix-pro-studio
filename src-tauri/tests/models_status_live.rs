// ---------------------------------------------------------------------------
// WS2 Step 13 Phase 1 diagnostic probe — runs the REAL `check_installed_models`
// command against a REAL `AppHandle<Wry>` pointed at the real
// `com.kinetix.pro-studio` `app_local_data_dir`, printing the exact returned
// report verbatim. Same `mock_context::<Wry, _>` + `noop_assets()` pattern
// `fa_durable_wav_live.rs` already uses (see that file's own doc comment for
// why this must be a `harness = false` binary, not a `#[test]`): a real Wry
// `EventLoop::new()` is AppKit-main-thread-only on macOS, and libtest never
// runs a `#[test]` fn on the process's actual main thread.
//
// Not gated behind an env var (unlike `fa_durable_wav_live`) — this touches
// no ffmpeg sidecar and no large corpus file, only a stat/hash of whatever is
// already on disk under the real app_local_data_dir, so it's safe and cheap
// to run in every `cargo test --test models_status_live` invocation.
// ---------------------------------------------------------------------------

use app_lib::models::check_installed_models;
use tauri::Manager;

fn main() {
    let home = std::env::var("HOME").expect("HOME must be set");

    let mut ctx = tauri::test::mock_context::<tauri::Wry, _>(tauri::test::noop_assets());
    ctx.config_mut().identifier = "com.kinetix.pro-studio".to_string();

    let app = tauri::Builder::<tauri::Wry>::default()
        .build(ctx)
        .expect("failed to build a real (Wry) Tauri app with zero windows for the live probe");
    let app_handle = app.handle().clone();

    let resolved_local_data_dir =
        app_handle.path().app_local_data_dir().expect("app_local_data_dir() must resolve");
    println!("models_status_live: app_local_data_dir() = {}", resolved_local_data_dir.display());
    assert_eq!(
        resolved_local_data_dir,
        std::path::PathBuf::from(&home).join("Library/Application Support/com.kinetix.pro-studio"),
        "app_local_data_dir() must resolve to the same path production does"
    );

    let report =
        tauri::async_runtime::block_on(check_installed_models(app_handle.clone())).expect("check_installed_models must not error");

    println!("models_status_live: whisper = {:?}", report.whisper);
    let mut langs: Vec<&String> = report.fa.keys().collect();
    langs.sort();
    for lang in langs {
        println!("models_status_live: fa[{lang}] = {:?}", report.fa[lang]);
    }
    // Real on-disk fact, independent of the command under test: whether each
    // final (non-.part) file exists at all, and its raw size — a ground
    // truth the printed report above is diffed against by hand/by the
    // caller of this probe.
    let whisper_path = resolved_local_data_dir.join("models").join("ggml-large-v3-turbo.bin");
    println!(
        "models_status_live: ground truth whisper file exists={} size={:?}",
        whisper_path.exists(),
        std::fs::metadata(&whisper_path).map(|m| m.len()).ok()
    );
    for lang in ["en", "es", "fr", "de", "pt"] {
        let p = resolved_local_data_dir.join("fa-models").join(lang).join("model.onnx");
        println!(
            "models_status_live: ground truth fa[{lang}] file exists={} size={:?}",
            p.exists(),
            std::fs::metadata(&p).map(|m| m.len()).ok()
        );
    }
}
