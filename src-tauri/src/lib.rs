mod fa;
mod fa_dev;
mod fa_viterbi;
#[cfg(feature = "fa-inference")]
mod fa_onnx;
mod ffmpeg;
mod sha256;
mod whisper;

use base64::Engine as _;
use std::sync::OnceLock;

/// A UUID minted ONCE per app process, on first request.
///
/// This is the only reliable way the frontend can tell a **page reload** apart
/// from an **app restart** (undo/redo persistence, 2026-08-08): both produce a
/// fresh webview with an empty JS heap, so nothing in the renderer can
/// distinguish them. A reload keeps the same Rust process and therefore reads
/// back the same token; a restart is a new process and mints a new one.
///
/// The frontend tags its persisted undo history with the token it saw, and
/// discards the history on load if the token no longer matches — which is
/// exactly the owner-ruled policy: history survives a reload, and an app restart
/// starts fresh (`docs/decisions/2026-08-08-undo-redo-design.md` §6.0).
///
/// `OnceLock` rather than managed state so it cannot be reset by anything, and
/// so it has no initialisation ordering relationship with `run()`'s builder.
static APP_SESSION_TOKEN: OnceLock<String> = OnceLock::new();

#[tauri::command]
fn app_session_token() -> String {
    APP_SESSION_TOKEN
        .get_or_init(|| uuid::Uuid::new_v4().to_string())
        .clone()
}

#[tauri::command]
async fn fetch_url_bytes(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; KinetixPro/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Toggles the webview's developer tools (Web Inspector).
///
/// Rust-side because there is no JS API for it: Tauri exposes devtools only
/// through `WebviewWindow::open_devtools`/`close_devtools`/`is_devtools_open`,
/// all gated on `any(debug_assertions, feature = "devtools")`. So this command
/// exists in every build but is only FUNCTIONAL where those methods compile —
/// debug builds today, since `devtools` is not enabled as a release feature.
///
/// Returns an explicit error string in a release build rather than silently
/// doing nothing, so the caller can tell "not available in this build" apart
/// from "toggled". Wired to Cmd+Alt+I / Ctrl+Shift+I / F12 (`appShortcuts.ts`).
#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) -> Result<bool, String> {
    #[cfg(any(debug_assertions, feature = "devtools"))]
    {
        if window.is_devtools_open() {
            window.close_devtools();
            Ok(false)
        } else {
            window.open_devtools();
            Ok(true)
        }
    }
    #[cfg(not(any(debug_assertions, feature = "devtools")))]
    {
        let _ = window;
        Err("Developer tools are not available in this build".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(whisper::WhisperState::default())
        .manage(ffmpeg::FfmpegProcessState::default())
        .manage(fa::FaState::default())
        .manage(fa::FaModelCache::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(all(target_os = "windows", debug_assertions))]
            {
                use tauri::Manager;
                app.get_webview_window("main")
                   .map(|w| w.open_devtools());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ffmpeg::ffmpeg_create_session,
            ffmpeg::ffmpeg_write_file,
            ffmpeg::ffmpeg_write_file_raw,
            ffmpeg::ffmpeg_append_file_raw,
            ffmpeg::ffmpeg_read_file,
            ffmpeg::ffmpeg_count_annexb_frames,
            ffmpeg::ffmpeg_concat_annexb_pieces,
            ffmpeg::ffmpeg_delete_file,
            ffmpeg::ffmpeg_exec,
            ffmpeg::ffmpeg_kill_session,
            ffmpeg::ffmpeg_destroy_session,
            ffmpeg::pick_save_path,
            ffmpeg::save_session_file,
            ffmpeg::probe_audio_duration,
            ffmpeg::probe_video_fps,
            ffmpeg::reveal_in_finder,
            whisper::whisper_transcribe,
            whisper::whisper_cancel,
            fa::fa_align,
            fa::fa_cancel,
            fa_dev::fa_align_dev,
            fetch_url_bytes,
            app_session_token,
            toggle_devtools,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
