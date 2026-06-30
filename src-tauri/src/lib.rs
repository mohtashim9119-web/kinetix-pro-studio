mod ffmpeg;
mod whisper;

use base64::Engine as _;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(whisper::WhisperState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(target_os = "windows")]
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
            ffmpeg::ffmpeg_read_file,
            ffmpeg::ffmpeg_delete_file,
            ffmpeg::ffmpeg_exec,
            ffmpeg::ffmpeg_destroy_session,
            ffmpeg::pick_save_path,
            ffmpeg::save_bytes_to_disk,
            ffmpeg::reveal_in_finder,
            whisper::whisper_transcribe,
            whisper::whisper_cancel,
            fetch_url_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
