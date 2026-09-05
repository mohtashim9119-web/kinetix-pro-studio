// ---------------------------------------------------------------------------
// WS3 fa-perf-foundation — live, real-`AppHandle` instrumented run of the
// PRODUCTION forced-alignment command (`fa_align_production`), capturing the
// `FaEvent::Timing` payload it now emits and printing the actual per-stage
// split.
//
// WHY THIS EXISTS AND WHAT ONLY IT COVERS. `fa_timing.rs`'s unit tests prove
// the accumulator arithmetic and the DTO assembly. `fa.rs`'s prove the wire
// shape and the single-flight refusal. `fa_onnx.rs`'s ignored `stage_timing`
// test proves the three per-chunk stages are really recorded against a real
// model. NONE of them executes `resolve_wav_and_align`, which is where the
// three PREFIX stages are measured and where the single-flight claim is
// taken — that function needs a live `AppHandle<Wry>`, the ffmpeg sidecar,
// and a real model, so nothing in the unit suite can reach it. Deleting the
// staging lookup, the manifest probe, or the durable-WAV timing from it
// would leave the whole suite green (source guards in `fa_timing.rs` catch
// the claim's removal specifically; they do not catch a stage silently
// wired to zero). This binary is the only thing that runs that code.
//
// Same `harness = false` / real-Wry / main-thread rationale as
// `fa_durable_wav_live.rs` — see that file's header for the full argument;
// it is unchanged here. `fa_production` was widened from `mod` to `pub mod`
// in `lib.rs` so this crate can name `fa_align_production` and measure the
// REAL production command rather than its dev-command sibling (a
// compile-time-only visibility change, zero runtime effect, matching the
// widening already done for `fa`/`fa_dev`).
//
// Self-gated, mirroring this codebase's existing convention: a plain
// `cargo test` sweep compiles this binary and exits immediately without
// touching the filesystem, the sidecar, the model, or the Wry runtime. Run
// it with:
//
//   ORT_DYLIB_PATH=<...>/libonnxruntime.1.23.2.dylib \
//   FA_LIVE_TIMING=1 \
//   cargo test --release --features fa-inference --test fa_timing_live
//
// `--features fa-inference` matters: without it the run stops at
// `NotImplemented` and only the prefix stages are populated (which is still
// a valid, if partial, measurement — the timing event is emitted on that
// path too, deliberately).
// ---------------------------------------------------------------------------

use app_lib::fa::{FaChunkInput, FaEvent, FaModelCache, FaState};
use app_lib::fa_production::fa_align_production;
use tauri::Manager;

fn repo_root() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// Window of the real production chunk plan to align. Bounded so one run
/// finishes in minutes rather than an hour: the point is the per-stage
/// SPLIT, which a representative slice shows as well as the whole corpus.
const WINDOW_START_SEC: f64 = 0.0;
const WINDOW_END_SEC: f64 = 120.0;

#[derive(serde::Deserialize)]
struct ChunkPlanFile {
    chunks: Vec<PlanChunk>,
}
#[derive(serde::Deserialize)]
struct PlanChunk {
    #[serde(rename = "startSec")]
    start_sec: f64,
    #[serde(rename = "endSec")]
    end_sec: f64,
    text: String,
}

fn load_production_chunks(corpus: &str) -> Vec<FaChunkInput> {
    let path = repo_root().join(format!(".work-phase4/replay/{corpus}/fa_production_chunks.json"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let plan: ChunkPlanFile = serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
    plan.chunks
        .into_iter()
        .filter(|c| c.end_sec > WINDOW_START_SEC && c.start_sec < WINDOW_END_SEC)
        .map(|c| FaChunkInput { start_sec: c.start_sec, end_sec: c.end_sec, text: c.text })
        .collect()
}

fn main() {
    if std::env::var("FA_LIVE_TIMING").ok().as_deref() != Some("1") {
        eprintln!("SKIP fa_timing_live: set FA_LIVE_TIMING=1 to run (needs the real 173 corpus, a real FA model, and ORT_DYLIB_PATH)");
        return;
    }
    let audio_path = repo_root().join(".work-phase4/replay/173/audio_16k.wav");
    if !audio_path.exists() {
        eprintln!("SKIP fa_timing_live: real 173 corpus audio not found at {}", audio_path.display());
        return;
    }
    let home = std::env::var("HOME").expect("HOME must be set");
    let model_path = std::path::PathBuf::from(&home)
        .join("Library/Application Support/com.kinetix.pro-studio/fa-models/en/model.onnx");
    if !model_path.exists() {
        eprintln!("SKIP fa_timing_live: no FA model at {}", model_path.display());
        return;
    }

    let mut ctx = tauri::test::mock_context::<tauri::Wry, _>(tauri::test::noop_assets());
    ctx.config_mut().identifier = "com.kinetix.pro-studio".to_string();
    let app = tauri::Builder::<tauri::Wry>::default()
        .plugin(tauri_plugin_shell::init())
        .manage(FaState::default())
        .manage(FaModelCache::default())
        .build(ctx)
        .expect("failed to build a real (Wry) Tauri app for the live timing run");
    let app_handle = app.handle().clone();

    // Stage the audio through the REAL production staging command's own
    // content-addressed scheme and namespace. `fa_stage_audio_raw` extracts
    // its bytes from a `tauri::ipc::Request`, which this binary cannot build
    // (it calls commands as plain Rust functions, bypassing the IPC
    // dispatcher), so the write is replicated by hand exactly as
    // `fa_durable_wav_live.rs` already does for the dev namespace. NOTE the
    // consequence, stated rather than hidden: no `record_staging_duration`
    // happens on this path, so `stagingMs` will correctly report `null`
    // (unknown) — this run measures the other six stages.
    let audio_bytes = std::fs::read(&audio_path).expect("read 173 corpus audio");
    let content_key = sha256_hex_of_file(&audio_path);
    let input_dir = std::env::temp_dir().join("kinetix-fa-production-inputs");
    std::fs::create_dir_all(&input_dir).expect("create production input dir");
    let input_path = input_dir.join(format!("{content_key}.wav"));
    if !input_path.exists() {
        std::fs::write(&input_path, &audio_bytes).expect("stage input audio");
    }

    let chunks = load_production_chunks("173");
    assert!(!chunks.is_empty(), "window [{WINDOW_START_SEC},{WINDOW_END_SEC}) matched no production chunks");
    println!(
        "fa_timing_live: {} chunks over [{WINDOW_START_SEC}, {WINDOW_END_SEC}) of the real 173 corpus",
        chunks.len()
    );

    let captured: std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>> = Default::default();
    let sink = captured.clone();
    let on_event = tauri::ipc::Channel::<FaEvent>::new(move |body| {
        // The channel hands over the already-serialized event body, which is
        // exactly what the frontend would receive — so what this prints is
        // the real wire payload, not a Rust-side reconstruction of it.
        if let tauri::ipc::InvokeResponseBody::Json(text) = body {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if v["event"] == serde_json::json!("Timing") {
                    sink.lock().unwrap().push(v);
                }
            }
        }
        Ok(())
    });

    let state = app_handle.state::<FaState>();
    let model_cache = app_handle.state::<FaModelCache>();
    let wall = std::time::Instant::now();
    let result = tauri::async_runtime::block_on(fa_align_production(
        app_handle.clone(),
        state,
        model_cache,
        input_path.to_string_lossy().to_string(),
        chunks.clone(),
        "en".to_string(),
        on_event,
    ));
    let wall_elapsed = wall.elapsed();

    let events = captured.lock().unwrap();
    assert_eq!(
        events.len(),
        1,
        "exactly ONE FaEvent::Timing must be emitted per run — {} were seen, which means the \
         aggregate is being emitted per chunk",
        events.len()
    );
    let t = &events[0]["data"]["timing"];
    println!("fa_timing_live: result = {result:?}");
    println!("fa_timing_live: harness wall clock = {:.3}s", wall_elapsed.as_secs_f64());
    println!("=== MEASURED PER-STAGE SPLIT (real 173 corpus, real model) ===");
    println!("{}", serde_json::to_string_pretty(t).unwrap());

    // Assertions, so this is a TEST and not merely a print. Only facts that
    // must hold regardless of machine speed.
    assert!(t["totalMs"].as_f64().unwrap() > 0.0, "totalMs must be real wall clock");
    assert!(t["manifestVerifyMs"].as_f64().is_some(), "the manifest stage must be measured");
    assert!(t["durableWavMs"].as_f64().is_some(), "the durable-WAV stage must be measured");
    assert!(t["stagingMs"].is_null(), "this harness stages by hand, so stagingMs must report unknown");
    let stage_sum = t["manifestVerifyMs"].as_f64().unwrap()
        + t["durableWavMs"].as_f64().unwrap()
        + t["modelLoadMs"].as_f64().unwrap_or(0.0)
        + t["chunks"]["forward"]["totalMs"].as_f64().unwrap()
        + t["chunks"]["viterbi"]["totalMs"].as_f64().unwrap()
        + t["chunks"]["tokenize"]["totalMs"].as_f64().unwrap();
    assert!(
        stage_sum <= t["totalMs"].as_f64().unwrap() + 1.0,
        "the measured stages must fit inside the run's own wall clock (sum {stage_sum} ms vs total {} ms)",
        t["totalMs"]
    );
    println!(
        "fa_timing_live: stages account for {:.1}ms of {:.1}ms total ({:.1}% attributed, remainder is \
         WAV decode / vocab load / stitching / IPC)",
        stage_sum,
        t["totalMs"].as_f64().unwrap(),
        100.0 * stage_sum / t["totalMs"].as_f64().unwrap()
    );
    println!("fa_timing_live: PASS");
}

/// The same content-addressing `fa_stage_audio_raw` applies. Independent of
/// `app_lib::sha256` (not `pub`), shelling out to the system tool rather than
/// adding a crate — identical technique and rationale to
/// `fa_durable_wav_live.rs`'s own helper.
fn sha256_hex_of_file(path: &std::path::Path) -> String {
    let out = std::process::Command::new("shasum")
        .args(["-a", "256", path.to_str().unwrap()])
        .output()
        .or_else(|_| std::process::Command::new("sha256sum").arg(path.to_str().unwrap()).output())
        .expect("neither shasum nor sha256sum available");
    String::from_utf8_lossy(&out.stdout).split_whitespace().next().unwrap_or("").to_string()
}
