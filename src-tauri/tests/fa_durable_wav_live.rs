// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D25 A1 — live, real-`AppHandle` exercise of the durable
// FA audio cache's two previously-untested halves: `app_local_data_dir()`
// resolution and the real `whisper::transcode_to_wav` ffmpeg-sidecar call.
// D24 B3 proved every PURE function `ensure_durable_wav` delegates to; this
// file proves the two thin `AppHandle`-based wrappers around them, by
// calling the REAL, unmodified `fa_align_dev` (the only production caller,
// per D25 A1) twice against the real 173 corpus audio.
//
// Why a separate `harness = false` integration-test binary (Cargo.toml),
// not a `#[cfg(test)]` unit test inside `fa.rs`/`fa_dev.rs` itself: getting
// a real `tauri::AppHandle` — `fa_align_dev`'s own signature is hardcoded to
// `AppHandle<Wry>` via tauri's `#[default_runtime]` macro, and so is
// `whisper.rs::transcode_to_wav`'s (unmodified/protected this slice) — means
// building a REAL (not `tauri::test::MockRuntime`) `tauri::App`. That needs
// the underlying wry/tao `EventLoop::new()`, which on macOS is an AppKit
// main-thread-only operation. Libtest (the harness `cargo test`'s `#[test]`
// functions run under) always runs each test on its OWN worker thread, never
// the process's actual main thread — so this can only work as a plain
// `fn main()` in its own binary, which IS the process main thread. Making
// this an integration-test crate (rather than a unit test) also means it can
// only reach `pub` items — `fa`/`fa_dev` were widened from `mod` to `pub mod`
// in `lib.rs` for exactly this (a compile-time-only visibility change, zero
// runtime effect — see that edit's own comment).
//
// `tauri::test::mock_context::<tauri::Wry, _>(tauri::test::noop_assets())`
// (not the real `tauri::generate_context!()`) supplies a `Context<Wry>` with
// an EMPTY `app.windows` list, so `Builder::<Wry>::build()` never needs to
// create an actual webview/window — avoiding any dependency on a running
// Vite dev server or a built `dist/` — while still using the REAL runtime,
// so `AppHandle<Wry>` really is what `fa_align_dev` expects. The identifier
// is set to the real `com.kinetix.pro-studio` (mock_context's own default is
// an empty string) so `app_local_data_dir()` resolves to the SAME path
// production does — reused by `fa_onnx.rs`'s own `real_corpus_measurement`/
// `cancellation`/`empty_tokenization` test modules' `fa_models_dir()` helper.
//
// Self-gated (env var + real-corpus-file presence, mirroring this codebase's
// `ORT_REQUIRE=1`/`ort_dylib_or_skip` convention elsewhere): a plain
// `cargo test` sweep still compiles this binary but exits immediately
// without touching the filesystem, the ffmpeg sidecar, or the Wry runtime —
// `FA_LIVE_DURABLE_WAV=1 cargo test --test fa_durable_wav_live` runs it.
// ---------------------------------------------------------------------------

use app_lib::fa::{FaChunkInput, FaModelCache, FaState};
use app_lib::fa_dev::fa_align_dev;
use tauri::Manager;

fn repo_root() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn sha256_hex_of_file(path: &std::path::Path) -> String {
    // Independent of `app_lib::sha256` (not `pub`) — a tiny, separate
    // content-identity check so this probe's own "byte-identical" claim
    // doesn't depend on the very cache code it's verifying. Shells out to
    // the system `shasum`/`sha256sum` rather than adding a crate.
    let out = std::process::Command::new("shasum")
        .args(["-a", "256", path.to_str().unwrap()])
        .output()
        .or_else(|_| std::process::Command::new("sha256sum").arg(path.to_str().unwrap()).output())
        .expect("neither shasum nor sha256sum available to verify content identity");
    let text = String::from_utf8_lossy(&out.stdout);
    text.split_whitespace().next().unwrap_or("").to_string()
}

fn main() {
    if std::env::var("FA_LIVE_DURABLE_WAV").ok().as_deref() != Some("1") {
        eprintln!(
            "SKIP fa_durable_wav_live: set FA_LIVE_DURABLE_WAV=1 to run (WS1 Task 5 Slice D25 A1, \
             real ffmpeg sidecar + real Wry AppHandle, not run by a plain `cargo test` sweep)"
        );
        return;
    }

    let audio_path = repo_root().join(".work-phase4/replay/173/audio_16k.wav");
    if !audio_path.exists() {
        eprintln!("SKIP fa_durable_wav_live: real 173 corpus audio not found at {}", audio_path.display());
        return;
    }

    let home = std::env::var("HOME").expect("HOME must be set");
    let cache_dir =
        std::path::PathBuf::from(&home).join("Library/Application Support/com.kinetix.pro-studio/fa-audio-cache");
    let dev_input_dir = std::env::temp_dir().join("kinetix-fa-dev-inputs");
    // Clean slate: both caches are confirmed empty/absent before this probe
    // ever ran (grepped `fa-audio-cache/` was never created by any live path
    // — D24's own gate table) — removing any leftovers from a prior manual
    // run of THIS probe keeps "first call misses" honest and reproducible.
    let _ = std::fs::remove_dir_all(&cache_dir);
    let _ = std::fs::remove_dir_all(&dev_input_dir);

    println!("fa_durable_wav_live: source audio = {}", audio_path.display());
    println!("fa_durable_wav_live: expected cache dir = {}", cache_dir.display());

    let mut ctx = tauri::test::mock_context::<tauri::Wry, _>(tauri::test::noop_assets());
    ctx.config_mut().identifier = "com.kinetix.pro-studio".to_string();

    let app = tauri::Builder::<tauri::Wry>::default()
        .plugin(tauri_plugin_shell::init())
        .manage(FaState::default())
        .manage(FaModelCache::default())
        .build(ctx)
        .expect("failed to build a real (Wry) Tauri app with zero windows for the live probe");
    let app_handle = app.handle().clone();

    let resolved_local_data_dir =
        app_handle.path().app_local_data_dir().expect("app_local_data_dir() must resolve");
    println!("fa_durable_wav_live: app_local_data_dir() resolved to {}", resolved_local_data_dir.display());
    assert_eq!(
        resolved_local_data_dir,
        std::path::PathBuf::from(&home).join("Library/Application Support/com.kinetix.pro-studio"),
        "app_local_data_dir() must resolve to the same path production does"
    );

    // `fa_align_dev` now takes an already-staged `input_path` (WS1 — the
    // audio_b64/audio_ext_hint IPC shape was replaced by a raw-body staging
    // command, `fa_stage_audio_raw`, to avoid a 5-8x base64/JSON memory
    // multiplication across the JS heap and the WKWebView IPC bridge on a
    // long voiceover). This probe calls `fa_align_dev` directly as a Rust
    // function, bypassing the Tauri IPC dispatcher entirely, so it can't
    // invoke `fa_stage_audio_raw` (which extracts its raw body from a real
    // `tauri::ipc::Request`) — instead it replicates that command's own
    // content-addressed write by hand: same `kinetix-fa-dev-inputs` dir,
    // same sha256-of-bytes filename scheme.
    let audio_bytes = std::fs::read(&audio_path).expect("read real 173 corpus audio");
    let content_key = sha256_hex_of_file(&audio_path);
    std::fs::create_dir_all(&dev_input_dir).expect("create dev input dir");
    let input_path = dev_input_dir.join(format!("{content_key}.wav"));
    std::fs::write(&input_path, &audio_bytes).expect("stage input audio");
    let input_path_str = input_path.to_string_lossy().to_string();
    let chunks = vec![FaChunkInput { start_sec: 0.0, end_sec: 1.0, text: "probe".to_string() }];

    let run = |label: &str| -> std::time::Duration {
        let state = app_handle.state::<FaState>();
        let model_cache = app_handle.state::<FaModelCache>();
        let on_event = tauri::ipc::Channel::new(|_body| Ok(()));
        let start = std::time::Instant::now();
        let result = tauri::async_runtime::block_on(fa_align_dev(
            app_handle.clone(),
            state,
            model_cache,
            input_path_str.clone(),
            chunks.clone(),
            "en".to_string(),
            on_event,
        ));
        let elapsed = start.elapsed();
        // `fa-inference` is OFF in this probe build (default features), so
        // `fa_align_dev` always finishes with `Err(NotImplemented)` AFTER
        // the transcode/cache step already ran — that's the expected,
        // correct outcome here; only a DIFFERENT error kind is a real
        // failure of this probe.
        match &result {
            Err(e) if e.kind == app_lib::fa::FaErrorKind::NotImplemented => {}
            other => panic!("fa_durable_wav_live[{label}]: unexpected result (want NotImplemented after a successful cache step): {other:?}"),
        }
        println!("fa_durable_wav_live[{label}]: wall_clock={:.3}s", elapsed.as_secs_f64());
        elapsed
    };

    let elapsed_1 = run("run1_miss");

    let entries: Vec<_> = std::fs::read_dir(&cache_dir)
        .unwrap_or_else(|e| panic!("cache dir must exist after run1: {e}"))
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("wav"))
        .collect();
    assert_eq!(entries.len(), 1, "exactly one durable WAV cache entry must exist after run1, found {}", entries.len());
    let cached_path = entries[0].path();
    let size_after_run1 = std::fs::metadata(&cached_path).unwrap().len();
    let mtime_after_run1 = std::fs::metadata(&cached_path).unwrap().modified().unwrap();
    let hash_after_run1 = sha256_hex_of_file(&cached_path);
    println!(
        "fa_durable_wav_live: cache file after run1 = {} ({} bytes, sha256={})",
        cached_path.display(),
        size_after_run1,
        hash_after_run1
    );

    // Age the entry artificially so a re-stamp on run2's hit is unambiguous
    // against real-clock resolution (mirrors `resolve_cache_entry_hit_re_
    // stamps_mtime`'s own unit-test technique, here against the real file).
    let aged = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    std::fs::File::open(&cached_path).unwrap().set_modified(aged).unwrap();

    let elapsed_2 = run("run2_expected_hit");

    let entries_after_run2: Vec<_> = std::fs::read_dir(&cache_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("wav"))
        .collect();
    assert_eq!(entries_after_run2.len(), 1, "run2 must not create a second cache entry, found {}", entries_after_run2.len());
    let hash_after_run2 = sha256_hex_of_file(&cached_path);
    let mtime_after_run2 = std::fs::metadata(&cached_path).unwrap().modified().unwrap();

    assert_eq!(hash_after_run2, hash_after_run1, "run2 must be a cache HIT: content must be byte-identical, not re-transcoded");
    assert!(mtime_after_run2 > mtime_after_run1, "run2's hit must re-stamp mtime forward (was artificially aged)");
    assert!(mtime_after_run2 > aged, "re-stamped mtime must be after the artificial aging, proving the hit path ran");

    println!(
        "fa_durable_wav_live: PART A (full fa_align_dev, includes the ~1.2GiB model.onnx SHA-256 \
         manifest-verification step that runs unconditionally on every call — a pre-existing D10 fixed \
         cost, UNRELATED to the durable cache, expected to swamp the miss-vs-hit delta at this scale) \
         run1(miss)={:.3}s run2(hit)={:.3}s content_identical={} mtime_restamped={}",
        elapsed_1.as_secs_f64(),
        elapsed_2.as_secs_f64(),
        hash_after_run2 == hash_after_run1,
        mtime_after_run2 > aged,
    );

    // -- PART B: ensure_durable_wav in isolation, no manifest verification --
    //
    // Same real 173 corpus audio, but passed DIRECTLY as `source_path` (not
    // through fa_align_dev's base64/content-addressed-dev-input layer), and
    // a FRESH cache dir, so this measures ONLY the durable-cache mechanism
    // Part A's wall-clock couldn't isolate.
    let _ = std::fs::remove_dir_all(&cache_dir);
    let b_start1 = std::time::Instant::now();
    let b_path1 = tauri::async_runtime::block_on(app_lib::fa::ensure_durable_wav(&app_handle, &audio_path))
        .expect("ensure_durable_wav run1 (miss) must succeed");
    let b_elapsed1 = b_start1.elapsed();
    let b_hash1 = sha256_hex_of_file(&b_path1);
    let b_mtime1 = std::fs::metadata(&b_path1).unwrap().modified().unwrap();

    let b_aged = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    std::fs::File::open(&b_path1).unwrap().set_modified(b_aged).unwrap();

    let b_start2 = std::time::Instant::now();
    let b_path2 = tauri::async_runtime::block_on(app_lib::fa::ensure_durable_wav(&app_handle, &audio_path))
        .expect("ensure_durable_wav run2 (expected hit) must succeed");
    let b_elapsed2 = b_start2.elapsed();
    let b_hash2 = sha256_hex_of_file(&b_path2);
    let b_mtime2 = std::fs::metadata(&b_path2).unwrap().modified().unwrap();

    assert_eq!(b_path1, b_path2, "both calls on the same unchanged source must resolve to the same cache path");
    assert_eq!(b_hash2, b_hash1, "run2 must be byte-identical to run1");
    assert!(b_mtime2 > b_mtime1, "run2's hit must re-stamp mtime forward of run1's own finalize-time mtime");
    assert!(b_mtime2 > b_aged, "re-stamped mtime must be after the artificial aging, proving the hit path ran");
    // Content-hash equality and a forward mtime are each individually
    // satisfiable by a genuine re-transcode too (ffmpeg is deterministic
    // enough on identical input+settings to plausibly reproduce identical
    // output bytes, and finalize's own rename would ALSO leave a
    // near-"now" mtime) — wall-clock is the signal that actually
    // distinguishes "skipped ffmpeg entirely" from "re-ran it": a real
    // transcode of this ~709s corpus takes several seconds; a hit is a
    // `stat` + a `set_modified` touch, orders of magnitude faster.
    assert!(
        b_elapsed2 < b_elapsed1 / 4,
        "run2 must be dramatically faster than run1 — run1(miss)={:.3}s run2(hit)={:.3}s; a run2 anywhere \
         near run1's own duration means ffmpeg ran again, not a real cache hit",
        b_elapsed1.as_secs_f64(),
        b_elapsed2.as_secs_f64()
    );

    println!(
        "fa_durable_wav_live: PART B (ensure_durable_wav direct, isolated from manifest verification) \
         cache_path={} run1(miss)={:.3}s run2(hit)={:.3}s speedup={:.1}x content_identical={} mtime_restamped={}",
        b_path1.display(),
        b_elapsed1.as_secs_f64(),
        b_elapsed2.as_secs_f64(),
        b_elapsed1.as_secs_f64() / b_elapsed2.as_secs_f64().max(0.0001),
        b_hash2 == b_hash1,
        b_mtime2 > b_aged,
    );

    println!("fa_durable_wav_live: PASS");
}
