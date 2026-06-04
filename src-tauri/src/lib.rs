mod ffmpeg;
mod whisper;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
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
            ffmpeg::save_bytes_to_disk,
            whisper::whisper_transcribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
