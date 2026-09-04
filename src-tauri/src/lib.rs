// `fa`/`fa_dev` are `pub` (WS1 Task 5 Slice D25 A1) solely so the live,
// real-`AppHandle` durable-cache probe under `tests/fa_durable_wav_live.rs`
// (a separate `harness = false` integration-test crate — the only way to get
// the real Wry runtime's `EventLoop::new()` to run on the actual process
// main thread, which macOS/AppKit requires) can reach `fa_align_dev` and its
// `FaState`/`FaModelCache`/`FaChunkInput`/`FaEvent` types, all already `pub`
// within the crate. No item's own visibility (`pub`/`pub(crate)`) changed,
// and no runtime behavior changed — this is a compile-time-only widening of
// which OTHER CRATES may name these modules.
pub mod fa;
pub mod fa_dev;
mod fa_preflight;
mod fa_production;
mod fa_viterbi;
#[cfg(feature = "fa-inference")]
mod fa_onnx;
mod ffmpeg;
pub mod model_download;
pub mod models;
mod project_mirror;
mod sha256;
mod whisper;

use base64::Engine as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

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

// ---------------------------------------------------------------------------
// DEFERRED QUIT (WS2 T4.6) — give the frontend a bounded moment to persist
// before the process dies, WITHOUT ever making the app unquittable.
//
// WHY THIS IS RUST'S JOB AND NOT THE FRONTEND'S. macOS builds the predefined
// Quit item with the AppKit selector `terminate:` (muda's macOS backend), so
// Cmd+Q never reaches the webview at all: there is no JS event to listen for,
// no `beforeunload`, nothing to `preventDefault`. The only way to get a moment
// before termination is to stop using the predefined item — see
// `build_menu_with_deferred_quit` — and own the termination ourselves.
//
// WHY THE BUDGET LIVES HERE TOO, which is the load-bearing half. The frontend
// does the actual flushing, but a timeout implemented in the frontend is
// worthless in exactly the scenario the timeout exists for: if the renderer is
// wedged, its timer never fires either, and the app is unquittable — a strictly
// worse regression than the data loss this whole round is fixing. So the wait
// runs on a Rust thread that the webview cannot influence, and `app.exit(0)`
// is called UNCONDITIONALLY when it returns, whatever the frontend did or did
// not manage to do.
//
// The frontend correspondingly has NO timeout of its own on this path: it
// flushes, then reports completion, and reports it even when the flush failed.
// One budget, owned by the side that can always act.

/// How long the quit path waits for the frontend's flush before terminating
/// anyway. See `src/services/teardownFlush.ts`'s `TEARDOWN_FLUSH_BUDGET_MS` for
/// the measurement behind the number (median 20.8 ms / worst-of-12 50.1 ms for a
/// full round trip on an 815,558-char real project, so this is ~40x the worst
/// case). Deliberately a SEPARATE constant from the frontend's rather than a
/// shared one: the entire point of this budget is that it holds when the
/// frontend is unreachable, so it cannot be sourced from the frontend.
const QUIT_FLUSH_BUDGET_MS: u64 = 2000;

/// How often the waiting thread checks for completion. Small enough that a
/// normal (tens-of-ms) flush is not visibly padded, large enough that the wait
/// costs ~80 wakeups rather than a spin.
const QUIT_FLUSH_POLL_MS: u64 = 25;

/// Set once a quit has been requested and the frontend told about it. A SECOND
/// request while one is pending means the user is insisting — see
/// `begin_deferred_quit`.
static QUIT_PENDING: AtomicBool = AtomicBool::new(false);

/// Set by `quit_flush_complete` when the frontend is done (successfully or not).
static QUIT_FLUSH_DONE: AtomicBool = AtomicBool::new(false);

/// Waits for `done` for at most `budget`, polling every `poll`.
///
/// Returns `true` if `done` was observed, `false` if the budget elapsed first.
/// **The caller must terminate in BOTH cases** — the return value is for logging
/// only, and no branch may depend on it.
///
/// Extracted as a free function with no Tauri types in its signature purely so
/// the timeout path can be unit-tested; a wait loop that has never been observed
/// to give up is a wait loop that has not been shown to be bounded.
fn await_flush(done: &AtomicBool, budget: Duration, poll: Duration) -> bool {
    let deadline = Instant::now() + budget;
    loop {
        if done.load(Ordering::SeqCst) {
            return true;
        }
        let now = Instant::now();
        if now >= deadline {
            return false;
        }
        // Never overshoot the deadline waiting for the next poll tick.
        std::thread::sleep(poll.min(deadline - now));
    }
}

/// Called by the frontend once its teardown flush has settled — or failed. It
/// reports completion either way, because "the save failed" is knowledge that
/// should shorten the wait, not lengthen it.
#[tauri::command]
fn quit_flush_complete() {
    QUIT_FLUSH_DONE.store(true, Ordering::SeqCst);
}

/// Starts the deferred-quit sequence. Always terminates the app, on every path.
fn begin_deferred_quit(app: &tauri::AppHandle) {
    use tauri::Emitter as _;

    // A second Cmd+Q while a quit is already pending is the user's escape
    // hatch: go now, do not start another wait. Without this, an impatient
    // double-press would be indistinguishable from a hang.
    if QUIT_PENDING.swap(true, Ordering::SeqCst) {
        app.exit(0);
        return;
    }

    QUIT_FLUSH_DONE.store(false, Ordering::SeqCst);

    // If the event cannot even be delivered there is nothing to wait for.
    if let Err(err) = app.emit("app-quit-requested", ()) {
        log::warn!("[quit] could not notify the frontend ({err}); quitting immediately");
        app.exit(0);
        return;
    }

    let handle = app.clone();
    std::thread::spawn(move || {
        let flushed = await_flush(
            &QUIT_FLUSH_DONE,
            Duration::from_millis(QUIT_FLUSH_BUDGET_MS),
            Duration::from_millis(QUIT_FLUSH_POLL_MS),
        );
        if !flushed {
            log::warn!(
                "[quit] frontend flush did not report within {QUIT_FLUSH_BUDGET_MS}ms; quitting anyway"
            );
        }
        // UNCONDITIONAL. Both branches above lead here.
        handle.exit(0);
    });
}

/// The default menu with ONLY the predefined Quit item swapped for one that
/// routes through `begin_deferred_quit`.
///
/// Surgical on purpose: everything else in the menu — About, Services, Hide,
/// Hide Others, the File/Edit/View/Window/Help submenus — is left exactly as
/// `Menu::default` built it, so this cannot drift from Tauri's defaults.
///
/// The replacement keeps the removed item's OWN text (macOS renders it as
/// "Quit <app name>"), is inserted at the SAME index, and carries the standard
/// `CmdOrCtrl+Q` accelerator, so the menu is indistinguishable from the default
/// to look at. What it does not inherit is the AppKit `terminate:` selector —
/// which is the entire point.
///
/// EVERY FAILURE PATH FALLS BACK TO THE UNMODIFIED DEFAULT MENU. A menu we could
/// not edit means Cmd+Q behaves exactly as it does today (immediate terminate,
/// no flush); a menu we half-edited could mean no Quit item at all. Degrading to
/// today's behaviour is always the right answer here.
fn build_menu_with_deferred_quit<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};

    let menu = Menu::default(app)?;

    // macOS only. Elsewhere Quit lives in the File submenu and is not bound to
    // Cmd+Q, so the problem this solves does not exist there and the default
    // menu is returned untouched.
    #[cfg(target_os = "macos")]
    {
        let items = menu.items()?;
        let Some(MenuItemKind::Submenu(app_menu)) = items.first() else {
            log::warn!("[quit] app submenu not where expected; leaving the default menu alone");
            return Ok(menu);
        };

        let sub_items = app_menu.items()?;
        let quit_at = sub_items.iter().position(|item| match item {
            // Identify by KIND plus the item's own rendered text rather than by
            // index: the index is an implementation detail of `Menu::default`,
            // whereas a predefined item reading "Quit ..." is the thing we mean.
            MenuItemKind::Predefined(p) => p.text().unwrap_or_default().starts_with("Quit"),
            _ => false,
        });

        let Some(index) = quit_at else {
            log::warn!("[quit] no predefined Quit item found; leaving the default menu alone");
            return Ok(menu);
        };

        let label = match &sub_items[index] {
            MenuItemKind::Predefined(p) => p.text().unwrap_or_else(|_| "Quit".to_string()),
            _ => "Quit".to_string(),
        };

        let replacement = MenuItem::with_id(
            app,
            DEFERRED_QUIT_MENU_ID,
            &label,
            true,
            Some("CmdOrCtrl+Q"),
        )?;

        app_menu.remove_at(index)?;
        app_menu.insert(&replacement, index)?;
    }

    Ok(menu)
}

/// Menu id of the replacement Quit item. Matched in the builder's menu handler.
const DEFERRED_QUIT_MENU_ID: &str = "kinetix-deferred-quit";

#[cfg(test)]
mod deferred_quit_tests {
    use super::*;

    /// THE TEST THAT MATTERS. Everything else in this round is about saving
    /// data; this one is about the app still being quittable when saving goes
    /// wrong. A wait loop that has never been observed to give up has not been
    /// shown to be bounded, so the timeout path is asserted directly rather
    /// than inferred from the code reading correctly.
    #[test]
    fn gives_up_when_the_flush_never_reports() {
        let done = AtomicBool::new(false); // nothing will ever set it
        let started = Instant::now();

        let flushed = await_flush(
            &done,
            Duration::from_millis(200),
            Duration::from_millis(10),
        );

        assert!(!flushed, "must report that it gave up");
        let elapsed = started.elapsed();
        assert!(
            elapsed >= Duration::from_millis(200),
            "must not return before the budget elapsed (returned after {elapsed:?})"
        );
        // Generous upper bound: this asserts boundedness, not scheduler precision.
        assert!(
            elapsed < Duration::from_millis(2000),
            "must not overrun the budget indefinitely (returned after {elapsed:?})"
        );
    }

    #[test]
    fn returns_immediately_when_the_flush_has_already_reported() {
        let done = AtomicBool::new(true);
        let started = Instant::now();

        assert!(await_flush(
            &done,
            Duration::from_millis(2000),
            Duration::from_millis(25),
        ));
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "an already-complete flush must not wait out any of the budget"
        );
    }

    /// The normal case: the frontend reports part-way through the budget, and
    /// the wait ends then rather than running to the deadline.
    #[test]
    fn returns_as_soon_as_the_flush_reports() {
        static DONE: AtomicBool = AtomicBool::new(false);
        DONE.store(false, Ordering::SeqCst);

        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(50));
            DONE.store(true, Ordering::SeqCst);
        });

        let started = Instant::now();
        let flushed = await_flush(
            &DONE,
            Duration::from_millis(5000),
            Duration::from_millis(10),
        );

        assert!(flushed);
        assert!(
            started.elapsed() < Duration::from_millis(2500),
            "must return on the signal, not at the deadline"
        );
    }

    /// A poll interval longer than the whole budget must still respect the
    /// budget — otherwise a single oversized sleep would blow straight past it.
    #[test]
    fn never_overshoots_the_budget_when_the_poll_interval_is_larger() {
        let done = AtomicBool::new(false);
        let started = Instant::now();

        let flushed = await_flush(
            &done,
            Duration::from_millis(100),
            Duration::from_millis(5000), // deliberately absurd
        );

        assert!(!flushed);
        assert!(
            started.elapsed() < Duration::from_millis(1000),
            "a poll longer than the budget must be clamped to the deadline"
        );
    }

    /// A zero budget is a degenerate but reachable configuration; it must give
    /// up at once rather than sleep.
    #[test]
    fn a_zero_budget_gives_up_without_sleeping() {
        let done = AtomicBool::new(false);
        let started = Instant::now();

        assert!(!await_flush(
            &done,
            Duration::ZERO,
            Duration::from_millis(25),
        ));
        assert!(started.elapsed() < Duration::from_millis(200));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(build_menu_with_deferred_quit)
        .on_menu_event(|app, event| {
            if event.id() == DEFERRED_QUIT_MENU_ID {
                begin_deferred_quit(app);
            }
        })
        .plugin(tauri_plugin_shell::init())
        .manage(whisper::WhisperState::default())
        .manage(model_download::ModelDownloadState::default())
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
            whisper::whisper_stage_audio_raw,
            whisper::whisper_cancel,
            model_download::whisper_model_status,
            model_download::whisper_model_download,
            model_download::whisper_model_download_cancel,
            model_download::whisper_model_download_attach,
            models::check_installed_models,
            models::import_local_model,
            models::delete_installed_model,
            models::get_available_disk_space,
            models::fa_model_download,
            models::fa_model_download_cancel,
            models::fa_model_download_attach,
            models::fa_model_status,
            fa::fa_align,
            fa::fa_cancel,
            fa_dev::fa_align_dev,
            fa_dev::fa_stage_audio_raw,
            fa_production::fa_align_production,
            fa_preflight::fa_preflight,
            project_mirror::project_mirror_read_all,
            project_mirror::project_mirror_write_project,
            project_mirror::project_mirror_delete_project,
            project_mirror::project_store_read,
            project_mirror::project_store_write,
            project_mirror::project_store_delete,
            project_mirror::project_store_list_ids,
            fetch_url_bytes,
            app_session_token,
            toggle_devtools,
            quit_flush_complete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// WHY THERE IS NO AUTOMATED TEST OF THE MENU SWAP, recorded so the next person
// does not spend the same hour discovering it. `build_menu_with_deferred_quit`
// was covered by a `tauri::test::mock_app()` test asserting the whole thing the
// owner asked to have confirmed — replacement at the same index, label still
// reading "Quit ...", no predefined Quit surviving, About/Services/Hide/Hide
// Others untouched. It cannot run: muda panics with "`muda::MenuChild` can only
// be created on the main thread" (its macOS backend takes a `MainThreadMarker`),
// and Rust's test harness runs every test on a spawned thread. No amount of
// `--test-threads=1` changes that; the harness still does not use the process
// main thread.
//
// The established pattern in this repo for the same constraint is a separate
// `harness = false` integration crate under `tests/` — see
// `tests/fa_durable_wav_live.rs`, which exists precisely because the real Wry
// `EventLoop::new()` must run on the process main thread. A menu-swap probe
// could be built that way. Until it is, the menu's APPEARANCE and BINDING are
// verified by hand in the shell, while the behaviour behind it (the bounded
// wait, and quit proceeding regardless) is covered by `deferred_quit_tests`
// above — which is the half that can make the app unquittable.
