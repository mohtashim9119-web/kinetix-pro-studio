use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// The live whisper-cli child processes, keyed by the same job key the
/// in-flight registry below uses.
///
/// A MAP AND NOT A SINGLE SLOT (Transcription Requirement 1). It was
/// `Mutex<Option<CommandChild>>` — one global slot — which was consistent with
/// the old kill-and-replace policy: there could only ever be one job, so one
/// slot sufficed. Now that two DIFFERENT keys run concurrently (see
/// `IN_FLIGHT`), a single slot would be overwritten by the second job and
/// `whisper_cancel` could only ever kill the last one started, leaving the
/// other running with no way to stop it.
///
/// KEPT rather than replaced by the registry, deliberately: `InFlightRegistry`
/// owns single-flight and event routing and holds no process handle at all, so
/// it cannot kill anything. Cancellation needs the `CommandChild`, and this is
/// the only thing that has it. The two are complementary, not redundant.
pub struct WhisperState(pub Mutex<HashMap<String, CommandChild>>);

impl Default for WhisperState {
    fn default() -> Self {
        WhisperState(Mutex::new(HashMap::new()))
    }
}

// SAFETY: CommandChild is Send + Sync in tauri_plugin_shell.
unsafe impl Send for WhisperState {}
unsafe impl Sync for WhisperState {}

// ---------------------------------------------------------------------------
// IPC event types
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptToken {
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(tag = "event", content = "data")]
pub enum WhisperEvent {
    Progress { percent: u8 },
    // `detected_language` (Phase 2a, multilingual model swap) is `Some(code)`
    // only when the invocation actually ran `-l auto` AND whisper-cli printed
    // an "auto-detected language" line to stderr — i.e. never set when the
    // caller passed an explicit language code (nothing to detect) and never
    // set on a run that failed before that line could print.
    Done { tokens: Vec<TranscriptToken>, detected_language: Option<String> },
    Error { message: String },
}

// ---------------------------------------------------------------------------
// Single-flight registry (Transcription Requirement 1)
// ---------------------------------------------------------------------------

/// The transcription jobs currently running, keyed by job key.
///
/// The SAME machinery `model_download.rs` uses, instantiated with this
/// module's own key/payload types — that reuse is the whole point of
/// `event_sink.rs`'s generalization, which named "a per-project
/// transcription job" as the consumer it was generalized for. Declaring a
/// separate `static` is what keeps this registry isolated from the download
/// engine's: a transcription for project X and a model download can never
/// collide on a key, because they are different maps.
///
/// KEY CHOICE. `audio_path` — the only per-job string the command already
/// took — is unusable: `whisper_stage_audio_raw` mints a fresh
/// `kinetix-whisper-<uuid>/input.<ext>` temp directory on EVERY call, so two
/// attempts to transcribe the identical audio for the identical project
/// produce two different paths and would both be granted a claim. The key
/// must therefore be supplied by the caller, and the frontend already has
/// exactly the right value: `useWhisper.ts`'s `StartTranscriptionOptions.
/// projectId`, which its own in-page single-flight gate is already scoped to.
/// Keying the native side by the same `Project.id` makes the two gates agree
/// by construction instead of by coincidence, and survives the page reload
/// that clears the in-page one.
static IN_FLIGHT: crate::event_sink::InFlightRegistry<String, WhisperEvent> =
    crate::event_sink::InFlightRegistry::new();

/// The key used when the caller supplies none.
///
/// A single shared key, NOT a per-call unique one. An id-less caller has no
/// identity to be a duplicate of, but the resource it contends for is real:
/// until every caller passes an id, all id-less jobs share one bucket and the
/// second is refused. That is deliberately stricter than the old
/// kill-and-replace and never weaker — a per-call unique key would grant every
/// id-less caller a claim and silently disable single-flight for exactly the
/// callers that have not been updated yet.
pub(crate) const DEFAULT_JOB_KEY: &str = "__default__";

/// Machine-readable prefix on the duplicate-job refusal, so the frontend can
/// tell "a job for this key is already running" apart from a spawn failure, a
/// missing model, or an ffmpeg error — all of which arrive as the same
/// `Err(String)`/`WhisperEvent::Error` shape. Prefix rather than a new error
/// enum: the IPC error type is `String` for every other failure in this
/// module, and changing it would be a far larger surface change than this
/// requirement asks for.
pub(crate) const IN_FLIGHT_REFUSAL_PREFIX: &str = "whisper:already-running:";

/// This module's instantiation of the generic sink.
pub(crate) type WhisperSink = crate::event_sink::EventSink<WhisperEvent>;

pub(crate) fn resolve_job_key(job_key: Option<String>) -> String {
    match job_key {
        Some(k) if !k.trim().is_empty() => k,
        _ => DEFAULT_JOB_KEY.to_string(),
    }
}

/// Phrased as a statement about the job that IS running, not as a failure of
/// the one being refused — mirroring `model_download::in_flight_refusal`.
pub(crate) fn in_flight_refusal(key: &str) -> String {
    format!(
        "{IN_FLIGHT_REFUSAL_PREFIX} a transcription is already running for this project \
         (job key {key}) — watch its progress or cancel it before starting another"
    )
}

/// Whether a transcription is running for this key right now.
///
/// Read-only, and deliberately NOT called by `whisper_transcribe` before its
/// claim: a test-then-acquire pair is a race, and `try_acquire` already does
/// both inside one critical section. Its callers are this module's tests and
/// any future status command — hence the `allow`.
#[allow(dead_code)]
pub(crate) fn is_transcription_in_flight(key: &str) -> bool {
    IN_FLIGHT.is_in_flight(key)
}

/// `Some(guard)` if nothing else holds `key`; `None` if one does. The guard
/// releases on drop — including an early `return`, a `?`, and a panic — which
/// is what makes the error and cancel paths release the entry without any
/// explicit cleanup of their own.
pub(crate) fn try_acquire_transcription(
    key: &str,
    sink: Arc<WhisperSink>,
) -> Option<crate::event_sink::InFlightGuard<String, WhisperEvent>> {
    IN_FLIGHT.try_acquire(key.to_string(), sink)
}

/// Points a running job's event stream at a freshly loaded page's channel.
///
/// Returns `false` when nothing is in flight for this key, which the caller
/// must treat as "read the status normally" and not as an error: a job can
/// legitimately finish in the gap between the page loading and this call.
///
/// The old page's channel is REPLACED, not duplicated — one job, one place
/// its events go, exactly as on the download path.
pub(crate) fn attach_transcription(key: &str, on_event: Channel<WhisperEvent>) -> bool {
    match IN_FLIGHT.attach(key) {
        Some(sink) => {
            sink.replace(on_event);
            true
        }
        None => false,
    }
}

/// Re-attaches a reloaded page to an in-progress transcription.
///
/// WHAT A REATTACHED LISTENER GETS, AND WHAT IT DOES NOT. Every subsequent
/// event reaches it, terminal `Done` included, because the job emits through
/// the swappable sink rather than through the channel it was started with.
/// `Progress { percent }` is absolute (a fraction of `duration_secs`, not a
/// delta), so events missed while no page was attached cost nothing — the next
/// one carries the full state.
///
/// The gap is a job that TERMINATES in the window between the reload and this
/// call: the claim is gone, this returns `false`, and `Done`'s token payload
/// is not recoverable, because nothing buffers a terminal event. That is not a
/// regression (before this change a reload lost the job entirely) but it is
/// also not fixed here — unlike a model download, whose completion is
/// observable on disk afterwards, a transcript exists only in the event.
#[tauri::command]
pub fn whisper_transcribe_attach(
    job_key: Option<String>,
    on_event: Channel<WhisperEvent>,
) -> Result<bool, String> {
    Ok(attach_transcription(&resolve_job_key(job_key), on_event))
}

// ---------------------------------------------------------------------------
// Model path resolver
// ---------------------------------------------------------------------------

// Phase 2a (multilingual model swap, docs/sync-pipeline-v2-plan.md H.1) — the
// English-only ggml-base.en.bin is replaced by the multilingual
// ggml-large-v3-turbo.bin so `-l auto` (see whisper_transcribe below) is no
// longer silently ignored (whisper-cli ignores -l auto on an .en-suffixed
// model). Measured 2026-08-04: 1624555275 bytes (~1.51 GiB) on disk,
// ~2.1-2.2 GiB resident during inference (docs/sync-pipeline-v2-plan.md H.9).
pub(crate) const MODEL_FILENAME: &str = "ggml-large-v3-turbo.bin";

fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // In-app acquisition (bug 4 fix): the model is downloaded on demand into
    // app_local_data_dir()/models/ (see model_download.rs) rather than bundled
    // — tauri.conf.json's resources map no longer ships models/* at all. This
    // is checked FIRST, ahead of every bundle/dev fallback below, so a user who
    // has downloaded the model always gets it; every existing fallback is kept
    // unchanged underneath for a hand-placed file (dev checkout, or a build
    // from before this change).
    if let Ok(local_data_dir) = app.path().app_local_data_dir() {
        let model = local_data_dir.join("models").join(MODEL_FILENAME);
        if model.exists() {
            return Ok(model);
        }
    }

    // Production: resource_dir bundled by tauri
    if let Ok(resource_dir) = app.path().resource_dir() {
        let model = resource_dir.join("models").join(MODEL_FILENAME);
        if model.exists() {
            return Ok(model);
        }
        // Windows: Tauri v2 resource_dir may include a _up_ segment — try one level up too
        #[cfg(target_os = "windows")]
        {
            if let Some(parent) = resource_dir.parent() {
                let model = parent.join("models").join(MODEL_FILENAME);
                if model.exists() {
                    return Ok(model);
                }
            }
        }
    }

    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot get exe path: {e}"))?;

    // Production fallback: <bundle>/Contents/MacOS/../models/ (macOS app bundle)
    let prod_model = exe
        .parent()
        .unwrap_or(&exe)
        .join("models")
        .join(MODEL_FILENAME);
    if prod_model.exists() {
        return Ok(prod_model);
    }

    // Development: target/debug/ → target/ → src-tauri/ → models/
    let dev_model = exe
        .parent().unwrap_or(&exe)   // target/debug/
        .parent().unwrap_or(&exe)   // target/
        .parent().unwrap_or(&exe)   // src-tauri/
        .join("models")
        .join(MODEL_FILENAME);
    if dev_model.exists() {
        return Ok(dev_model);
    }

    Err(format!(
        "{MODEL_FILENAME} not found. Use the model download panel in Settings, \
         or for a dev checkout: curl -L -o src-tauri/models/{MODEL_FILENAME} \
         https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{MODEL_FILENAME}"
    ))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Sniffs a file extension from magic bytes — the same detection
/// `whisper_transcribe` used to run inline on its base64-decoded bytes,
/// extracted so `whisper_stage_audio_raw` can run it on the raw request body
/// instead.
fn audio_extension_from_bytes(bytes: &[u8]) -> &'static str {
    let mime = if bytes.starts_with(b"RIFF") {
        "audio/wav"
    } else if bytes.starts_with(b"ID3")
        || bytes.starts_with(b"\xff\xfb")
        || bytes.starts_with(b"\xff\xf3")
        || bytes.starts_with(b"\xff\xf2")
    {
        "audio/mpeg"
    } else if bytes.starts_with(b"\x00\x00\x00") && bytes.get(4..8) == Some(b"ftyp") {
        "audio/mp4"
    } else if bytes.starts_with(b"OggS") {
        "audio/ogg"
    } else if bytes.starts_with(b"fLaC") {
        "audio/flac"
    } else if bytes.starts_with(b"FORM")
        && (bytes.get(8..12) == Some(b"AIFF") || bytes.get(8..12) == Some(b"AIFC"))
    {
        "audio/aiff"
    } else if bytes.starts_with(b"\x1a\x45\xdf\xa3") {
        "audio/webm"
    } else {
        "audio/wav" // fallback — let whisper try
    };

    match mime {
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/wave" | "audio/x-wav" => "wav",
        "audio/ogg" | "audio/vorbis" => "ogg",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/mp4" | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/aiff" | "audio/x-aiff" => "aiff",
        "audio/opus" => "opus",
        "audio/webm" => "webm",
        _ => "wav",
    }
}

/// Raw-binary staging command for `whisper_transcribe`'s audio input.
///
/// Writes the invoke request's raw body bytes to a fresh per-call temp
/// directory and returns the resulting file's path, which the frontend then
/// passes to `whisper_transcribe` as `audio_path`. Unlike the `audio_b64`
/// shape this replaces, the payload is NOT base64/JSON-encoded — the
/// frontend passes a `Uint8Array` as the invoke body (Tauri v2 raw request
/// body). This removes the base64 encode (JS) + inflated-string IPC
/// transfer + base64 decode (Rust) that `ffmpeg.rs`'s `ffmpeg_write_file_raw`
/// doc comment already names as the cost this shape avoids on the export
/// path — applied here to a whole voiceover file (potentially hundreds of MB
/// uncompressed) instead of one export frame, where the base64+JSON
/// round trip's ~5-8x peak memory multiplication across the JS heap and the
/// WKWebView IPC bridge is far more likely to matter.
#[tauri::command]
pub fn whisper_stage_audio_raw(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data,
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("whisper_stage_audio_raw: expected a raw byte body, got JSON".to_string())
        }
    };

    let tmp_id = Uuid::new_v4().to_string();
    let tmp_dir = std::env::temp_dir().join(format!("kinetix-whisper-{}", tmp_id));
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("create temp dir: {e}"))?;

    let audio_ext = audio_extension_from_bytes(bytes);
    let audio_path = tmp_dir.join(format!("input.{}", audio_ext));
    fs::write(&audio_path, bytes).map_err(|e| format!("write audio: {e}"))?;

    Ok(audio_path.to_string_lossy().to_string())
}

/// Transcodes any ffmpeg-readable audio file into a 16 kHz mono WAV via the
/// bundled ffmpeg sidecar.
///
/// This runs BEFORE whisper-cli sees the file. whisper.cpp's miniaudio backend
/// only decodes wav/mp3/ogg/flac, and fails silently on everything else (e.g.
/// M4A/AAC): exit code 0, zero tokens, no error. Normalizing through ffmpeg —
/// which is already the export muxer and reads virtually any container/codec —
/// makes that limitation irrelevant. `-ar 16000 -ac 1` matches whisper's own
/// internal target so no quality is lost versus feeding it a raw file.
pub(crate) async fn transcode_to_wav(
    app: &tauri::AppHandle,
    input: &std::path::Path,
    output: &std::path::Path,
) -> Result<(), String> {
    let out = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar lookup: {e}"))?
        .args([
            "-hide_banner",
            "-y",
            "-i", input.to_str().unwrap_or(""),
            "-ar", "16000",
            "-ac", "1",
            output.to_str().unwrap_or(""),
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail = if stderr.len() > 2000 {
            format!("...{}", &stderr[stderr.len() - 2000..])
        } else {
            stderr.to_string()
        };
        return Err(format!(
            "ffmpeg transcode failed (code {}): {}",
            out.status.code().unwrap_or(-1),
            tail
        ));
    }
    Ok(())
}

/// Transcribes audio via the bundled whisper-cli sidecar, streaming progress
/// and result tokens through the supplied Tauri IPC channel.
///
/// The raw upload is first normalized to 16 kHz mono WAV via `transcode_to_wav`
/// (see above) so whisper-cli's format limitations never apply.
///
/// * `audio_path`   — filesystem path to the raw audio file, already staged
///                     on disk by `whisper_stage_audio_raw` (any container
///                     ffmpeg can read). Its parent directory is this call's
///                     own temp dir, removed on completion below.
/// * `duration_secs` — total audio duration (drives 0–100 progress)
/// * `language`     — a whisper language code (e.g. "en"), or "auto" to let
///                     whisper-cli detect it (Phase 2a — H.1/H.7: detection is
///                     a suggestion, stored per-project and user-overridable;
///                     the frontend passes "auto" only when the project has no
///                     stored/overridden language yet).
/// * `on_event`     — frontend channel receiving WhisperEvent variants
/// * `job_key`      — the caller's identity for this job, normally
///                     `Project.id`. IPC SURFACE CHANGE (Transcription
///                     Requirement 1): this parameter is new. It is
///                     `Option<String>` and not `String` so a frontend that
///                     has not been updated yet keeps working — see
///                     `DEFAULT_JOB_KEY` for what an omitted key means and
///                     why the fallback is one shared key rather than a
///                     unique one per call.
#[tauri::command]
pub async fn whisper_transcribe(
    app: tauri::AppHandle,
    state: tauri::State<'_, WhisperState>,
    audio_path: String,
    duration_secs: f64,
    language: String,
    on_event: Channel<WhisperEvent>,
    job_key: Option<String>,
) -> Result<(), String> {
    let job_key = resolve_job_key(job_key);

    // REFUSE a duplicate for this key; do not kill and replace.
    //
    // WHAT THIS REPLACES (operator decision, Transcription Requirement 1). The
    // old body opened by taking the single `WhisperState` slot and calling
    // `child.kill()` on whatever was in it. Nothing told the first job's caller
    // that this had happened: its channel simply went quiet — the killed child
    // exits on SIGTERM (143), which the terminal arm below treats as a user
    // cancellation and deliberately reports nothing for. So a second Apply Sync
    // silently destroyed the first transcription's work, and the first page saw
    // a progress bar that stopped advancing and never resolved.
    //
    // The claim is taken BEFORE any file is written or any process spawned, and
    // held for the whole call by `_in_flight`, whose `Drop` releases it on every
    // exit — the `?` on `model_path`, the early `return` on a transcode failure,
    // the normal end of the event loop, and a panic. There is no explicit
    // release anywhere in this function, and there must not be one.
    //
    // The sink is built before the claim so a page attaching immediately after
    // the claim appears can never find a claim with no sink behind it (the
    // ordering `model_download::stream_download_verified` establishes).
    let sink = Arc::new(WhisperSink::new(on_event));
    let _in_flight = match try_acquire_transcription(&job_key, sink.clone()) {
        Some(guard) => guard,
        None => {
            let msg = in_flight_refusal(&job_key);
            // Both an event AND an `Err`: a caller watching only the channel
            // still learns why nothing happened.
            sink.send(WhisperEvent::Error { message: msg.clone() });
            return Err(msg);
        }
    };

    let audio_path = PathBuf::from(audio_path);
    let tmp_dir = audio_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(std::env::temp_dir);

    // Universal pre-transcode: normalize the upload (any ffmpeg-readable
    // container/codec) into 16 kHz mono WAV before whisper-cli runs. On failure,
    // clean up and surface a real error rather than letting whisper silently
    // degrade — see transcode_to_wav's doc comment.
    let wav_path = tmp_dir.join("input_16k.wav");
    if let Err(e) = transcode_to_wav(&app, &audio_path, &wav_path).await {
        let _ = fs::remove_dir_all(&tmp_dir);
        sink.send(WhisperEvent::Error { message: e });
        return Ok(());
    }

    let model = model_path(&app)?;

    // Phase 2a — language argument (docs/sync-pipeline-v2-plan.md, Step 3
    // decisions): "-l auto" (re-enabled now that the model is multilingual)
    // when the project has no stored/overridden language yet, else the
    // stored code directly, skipping re-detection. `-np` (no-prints) is
    // DROPPED: it was suppressing whisper-cli's "auto-detected language"
    // line along with the rest of the stderr diagnostic dump; empirically
    // verified (2026-08-04) that dropping it does not change stdout's token
    // lines at all (byte-identical with vs. without). `--dtw base.en` is
    // DROPPED: it was already a silent no-op (flash attention is on by
    // default and disables DTW; -nfa would enable it but breaks stdout
    // printing) AND the preset name is model-specific — carrying a
    // base.en-named preset over to turbo would be actively misleading. DTW
    // is Phase 2b/3 work, not this phase's (no timing-source change here).
    //
    // PHASE 2B RESULT (2026-08-05) — DTW is now PERMANENTLY abandoned, and
    // two clauses above are corrected (full measurement:
    // docs/sync-pipeline-v2-plan.md's "Phase 2b — RESULTS"):
    //   * CORRECT: `--dtw base.en` was indeed a silent no-op. whisper-cli's
    //     stderr says so verbatim: "dtw_token_timestamps is not supported
    //     with flash_attn - disabling".
    //   * WRONG: "-nfa ... breaks stdout printing". It does not, on this
    //     bundled binary — a full 23.7-minute run with -nfa and no -oj
    //     produced 4,639 clean bracketed lines that parse_stdout_tokens
    //     (below) handled without loss. Do not scope future work as though
    //     -nfa forces a move to JSON output.
    //   * The real reason not to add DTW: correctly enabled (stderr
    //     "dtw = 1"), it changes timestamps by EXACTLY 0.000000000s, measured
    //     against a no-DTW control over 4,579 + 2,080 tokens. Under `-ml 1`
    //     whisper emits GAPLESS token spans (each token starts where the
    //     previous ended), so a pause is structurally absorbed into the
    //     following word's span and DTW has nothing left to dispute.
    //     Phase 3 is forced alignment instead.
    //   * Measured but deliberately NOT acted on (Phase 2b is read-only):
    //     `-nfa` ALONE recovers a ~9.7s passage of real narration that the
    //     current flash-attention default silently drops on the V6 corpus
    //     project, at a cost of ~25-33% wall-clock. Documented as a finding
    //     for a future phase to weigh; do not enable it casually — it mints
    //     a new transcript era (K9) and needs its own verification pass.
    let (mut rx, child) = app
        .shell()
        .sidecar("whisper")
        .map_err(|e| format!("sidecar lookup: {e}"))?
        .args([
            "-m",  model.to_str().unwrap_or(""),
            "-f",  wav_path.to_str().unwrap_or(""),
            "-ml", "1",
            "-l",  language.as_str(),
        ])
        .spawn()
        .map_err(|e| format!("whisper spawn: {e}"))?;

    // Store child so whisper_cancel can kill it — under this job's own key, so
    // a concurrent job for a different key is neither overwritten nor killed.
    {
        let mut lock = state.0.lock().map_err(|_| "state lock poisoned")?;
        lock.insert(job_key.clone(), child);
    }

    let mut line_buf: Vec<u8> = Vec::new();
    let mut accumulated: Vec<String> = Vec::new();
    // Phase 2a — stderr is now scanned (previously fully ignored) for
    // whisper-cli's "auto-detected language: XX (p = 0.NN)" line, the only
    // way to observe what `-l auto` resolved to. Line-buffered the same way
    // stdout already is, just kept in a separate buffer/accumulator so the
    // two streams' interleaving can never corrupt either one's line framing.
    let mut err_line_buf: Vec<u8> = Vec::new();
    let mut detected_language: Option<String> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                line_buf.extend_from_slice(&bytes);
                // Drain complete lines from the buffer.
                while let Some(pos) = line_buf.iter().position(|&b| b == b'\n') {
                    let raw: Vec<u8> = line_buf.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&raw)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if let Some(end_sec) = parse_progress_line(&line) {
                        let percent = if duration_secs > 0.0 {
                            ((end_sec / duration_secs) * 100.0).clamp(0.0, 100.0) as u8
                        } else {
                            0
                        };
                        sink.send(WhisperEvent::Progress { percent });
                    }
                    if !line.is_empty() {
                        accumulated.push(line);
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                err_line_buf.extend_from_slice(&bytes);
                while let Some(pos) = err_line_buf.iter().position(|&b| b == b'\n') {
                    let raw: Vec<u8> = err_line_buf.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&raw)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if detected_language.is_none() {
                        if let Some(lang) = parse_detected_language(&line) {
                            detected_language = Some(lang);
                        }
                    }
                }
            }
            CommandEvent::Terminated(status) => {
                // Flush any remaining bytes in the line buffers.
                if !line_buf.is_empty() {
                    let line = String::from_utf8_lossy(&line_buf)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if !line.is_empty() {
                        accumulated.push(line);
                    }
                    line_buf.clear();
                }
                if !err_line_buf.is_empty() {
                    let line = String::from_utf8_lossy(&err_line_buf)
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .to_string();
                    if detected_language.is_none() {
                        if let Some(lang) = parse_detected_language(&line) {
                            detected_language = Some(lang);
                        }
                    }
                    err_line_buf.clear();
                }

                // Remove stored child (process is gone). Only this job's own
                // entry — a `*lock = None` here would drop a concurrent job's
                // handle and make it uncancellable.
                {
                    let mut lock = state.0.lock().map_err(|_| "state lock poisoned")?;
                    lock.remove(&job_key);
                }
                let _ = fs::remove_dir_all(&tmp_dir);

                let code = status.code.unwrap_or(-1);
                match code {
                    0 => {
                        let tokens = parse_stdout_tokens(&accumulated);
                        sink.send(WhisperEvent::Done { tokens, detected_language });
                    }
                    // SIGINT (130) or SIGTERM (143) — user cancelled; silent.
                    130 | 143 => {}
                    // -1073741795 == 0xC000001D == STATUS_ILLEGAL_INSTRUCTION
                    // (Windows): the whisper binary executed a CPU instruction
                    // (e.g. AVX2/FMA) this machine doesn't support. Surface a
                    // human-readable cause instead of the raw code.
                    -1073741795 => {
                        sink.send(WhisperEvent::Error {
                            message: "Transcription failed: your CPU may not support \
                                      required instructions. This should be fixed by a \
                                      future update."
                                .to_string(),
                        });
                    }
                    other => {
                        sink.send(WhisperEvent::Error {
                            message: format!("whisper exited with code {other}"),
                        });
                    }
                }
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

/// Kills a running whisper transcription job.
///
/// `job_key` targets one job; omitting it kills every running job, which is
/// exactly what this command did before there could be more than one — so an
/// un-updated frontend keeps its existing semantics.
///
/// Cancelling does NOT touch the in-flight registry directly. Killing the
/// child makes `whisper_transcribe`'s event loop see `Terminated`, which ends
/// the function and drops its `InFlightGuard`; that is what releases the
/// claim. Releasing it here as well would free the key while the job's own
/// task is still shutting down, and a new job could then claim it and spawn a
/// second child against the same project.
#[tauri::command]
pub async fn whisper_cancel(
    state: tauri::State<'_, WhisperState>,
    job_key: Option<String>,
) -> Result<(), String> {
    let mut lock = state.0.lock().map_err(|_| "state lock poisoned")?;
    match job_key {
        Some(key) => {
            if let Some(child) = lock.remove(&key) {
                let _ = child.kill();
            }
        }
        None => {
            for (_key, child) in lock.drain() {
                let _ = child.kill();
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/// Extracts the language code from a whisper-cli stderr line of the form
/// `whisper_full_with_state: auto-detected language: en (p = 0.999905)`
/// (verified against a real run, 2026-08-04), or None if the line doesn't
/// match. Only ever produced when `-l auto` was passed — a run given an
/// explicit language code skips detection and never prints this line.
fn parse_detected_language(line: &str) -> Option<String> {
    const MARKER: &str = "auto-detected language: ";
    let idx = line.find(MARKER)?;
    let after = &line[idx + MARKER.len()..];
    let code = after.split_whitespace().next()?;
    if code.is_empty() { None } else { Some(code.to_string()) }
}

/// Returns the end timestamp in seconds from a whisper progress line of the
/// form `[HH:MM:SS.mmm --> HH:MM:SS.mmm]  text…`, or None if the line
/// doesn't match.
fn parse_progress_line(line: &str) -> Option<f64> {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') {
        return None;
    }
    let arrow = trimmed.find(" --> ")?;
    let after = &trimmed[arrow + 5..];
    let close = after.find(']')?;
    Some(parse_timestamp(&after[..close]))
}

/// Converts accumulated whisper stdout lines into `TranscriptToken` list.
fn parse_stdout_tokens(lines: &[String]) -> Vec<TranscriptToken> {
    let mut tokens = Vec::new();
    for line in lines {
        let trimmed = line.trim();
        if !trimmed.starts_with('[') {
            continue;
        }
        let close = match trimmed.find(']') {
            Some(i) => i,
            None => continue,
        };
        let ts_part = &trimmed[1..close];
        let arrow = match ts_part.find(" --> ") {
            Some(i) => i,
            None => continue,
        };
        let start_sec = parse_timestamp(&ts_part[..arrow]);
        let end_sec = parse_timestamp(&ts_part[arrow + 5..]);
        let text = trimmed[close + 1..].trim().to_string();
        if !text.is_empty() {
            tokens.push(TranscriptToken { start_sec, end_sec, text });
        }
    }
    tokens
}

/// Parses whisper timestamp strings (`HH:MM:SS.mmm` or `HH:MM:SS,mmm`) into
/// seconds as `f64`.
fn parse_timestamp(ts: &str) -> f64 {
    let ts = ts.trim().replace(',', ".");
    let parts: Vec<&str> = ts.split(':').collect();
    if parts.len() != 3 {
        return 0.0;
    }
    let h: f64 = parts[0].parse().unwrap_or(0.0);
    let m: f64 = parts[1].parse().unwrap_or(0.0);
    let s: f64 = parts[2].parse().unwrap_or(0.0);
    h * 3600.0 + m * 60.0 + s
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod in_flight_tests {
    use super::*;

    /// A channel that records every event it is handed, so a test can assert
    /// WHAT a listener received and not merely that a send did not error.
    /// `EventSink::send` is best-effort by design (a dead page's channel just
    /// fails), so a non-recording channel would make every assertion below
    /// vacuously true.
    fn recording_channel() -> (Channel<WhisperEvent>, Arc<Mutex<Vec<String>>>) {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = log.clone();
        let channel = Channel::new(move |body: tauri::ipc::InvokeResponseBody| {
            let raw = match &body {
                tauri::ipc::InvokeResponseBody::Json(s) => s.clone(),
                tauri::ipc::InvokeResponseBody::Raw(b) => String::from_utf8_lossy(b).to_string(),
            };
            sink.lock().unwrap().push(raw);
            Ok(())
        });
        (channel, log)
    }

    fn sink_for(channel: Channel<WhisperEvent>) -> Arc<WhisperSink> {
        Arc::new(WhisperSink::new(channel))
    }

    fn noop_sink() -> Arc<WhisperSink> {
        sink_for(Channel::new(|_body| Ok(())))
    }

    // Keys are unique per test: the registry is a process-wide `static` and
    // cargo runs tests in parallel threads, so a shared key would make these
    // tests contend with each other rather than with what they are testing.

    #[test]
    fn second_transcription_for_the_same_key_is_refused_not_granted() {
        let key = "proj-refusal";
        let first = try_acquire_transcription(key, noop_sink())
            .expect("the first job must be granted the key");
        assert!(is_transcription_in_flight(key));
        assert!(
            try_acquire_transcription(key, noop_sink()).is_none(),
            "a second job for the same key must be REFUSED — the pre-registry \
             behaviour killed the first job's child instead, silently discarding \
             its work"
        );
        drop(first);
    }

    #[test]
    fn the_refusal_message_is_machine_distinguishable_from_other_errors() {
        // The frontend receives every failure in this module as the same
        // `Err(String)`/`WhisperEvent::Error` shape — a spawn failure, a
        // missing model, an ffmpeg transcode failure. Only the prefix lets it
        // tell "already running" (retryable later, nothing was lost) apart
        // from those (a real failure to report).
        let msg = in_flight_refusal("proj-x");
        assert!(msg.starts_with(IN_FLIGHT_REFUSAL_PREFIX));
        for other in [
            "sidecar lookup: not found".to_string(),
            "whisper exited with code 3".to_string(),
            format!("{MODEL_FILENAME} not found."),
        ] {
            assert!(
                !other.starts_with(IN_FLIGHT_REFUSAL_PREFIX),
                "{other} must not be mistaken for an already-running refusal"
            );
        }
    }

    #[test]
    fn distinct_keys_stay_independently_concurrent() {
        let a = try_acquire_transcription("proj-conc-a", noop_sink()).expect("a");
        let b = try_acquire_transcription("proj-conc-b", noop_sink())
            .expect("a different project must not be blocked by another's job — refusing \
                     there would strand a project behind a run whose result it cannot use");
        assert!(is_transcription_in_flight("proj-conc-a"));
        assert!(is_transcription_in_flight("proj-conc-b"));
        drop(a);
        assert!(
            !is_transcription_in_flight("proj-conc-a"),
            "releasing one key must not depend on the other"
        );
        assert!(is_transcription_in_flight("proj-conc-b"));
        drop(b);
    }

    #[test]
    fn a_reattached_page_receives_subsequent_events_and_the_terminal_done() {
        let key = "proj-reload";
        let (first_page, first_log) = recording_channel();
        let sink = sink_for(first_page);
        let _guard = try_acquire_transcription(key, sink.clone()).expect("claim");

        sink.send(WhisperEvent::Progress { percent: 10 });

        // The reload: the first page is gone, a fresh one attaches with its own
        // channel and no knowledge of the running job.
        let (second_page, second_log) = recording_channel();
        assert!(
            attach_transcription(key, second_page),
            "a live job must be reattachable"
        );

        sink.send(WhisperEvent::Progress { percent: 60 });
        sink.send(WhisperEvent::Done { tokens: vec![], detected_language: Some("en".into()) });

        let first = first_log.lock().unwrap().clone();
        let second = second_log.lock().unwrap().clone();

        assert_eq!(first.len(), 1, "the old page must stop receiving after the swap");
        assert!(first[0].contains("Progress"));

        // The whole point: the reattached page gets everything AFTER the swap,
        // terminal event included. `Progress` is an absolute percentage, so the
        // events it missed while nobody was attached cost it nothing.
        assert_eq!(second.len(), 2, "expected the post-attach Progress and the Done");
        assert!(second[0].contains("Progress") && second[0].contains("60"));
        assert!(
            second[1].contains("Done"),
            "a reattached page that never receives Done can never resolve — got {:?}",
            second[1]
        );
    }

    #[test]
    fn attach_reports_false_when_no_job_holds_the_key() {
        // Not an error: a job can finish between a page loading and its attach
        // call, and the caller must read that as "nothing running", not "failed".
        assert!(!attach_transcription("proj-nothing-running", Channel::new(|_b| Ok(()))));
    }

    #[test]
    fn the_entry_is_released_on_success_error_and_panic_paths() {
        // The three exits `whisper_transcribe` actually has. Each is modelled by
        // a scope holding a real guard, because the release mechanism under test
        // is `Drop` — the reason there is no explicit release call in the
        // command body at all.
        let key = "proj-release";

        // 1. Success: the event loop breaks and the function returns Ok.
        {
            let _g = try_acquire_transcription(key, noop_sink()).expect("claim");
        }
        assert!(!is_transcription_in_flight(key), "released on the success path");

        // 2. Error: an early `return`/`?` (transcode failure, missing model).
        fn errors_out(key: &str) -> Result<(), String> {
            let _g = try_acquire_transcription(key, noop_sink()).ok_or("claim")?;
            Err("transcode failed".to_string())
        }
        assert!(errors_out(key).is_err());
        assert!(!is_transcription_in_flight(key), "released on the error path");

        // 3. Panic: an unwind must not leave the key permanently unclaimable.
        let unwound = std::panic::catch_unwind(|| {
            let _g = try_acquire_transcription(key, noop_sink()).expect("claim");
            panic!("boom");
        });
        assert!(unwound.is_err());
        assert!(!is_transcription_in_flight(key), "released on the panic path");

        // 4. Cancel: `whisper_cancel` kills the child, the event loop sees
        //    Terminated and returns, and the guard drops with it — cancel never
        //    removes the entry itself (see whisper_cancel's doc comment).
        {
            let _g = try_acquire_transcription(key, noop_sink()).expect("claim");
            assert!(is_transcription_in_flight(key));
        }
        assert!(!is_transcription_in_flight(key), "released on the cancel path");

        assert!(
            try_acquire_transcription(key, noop_sink()).is_some(),
            "the key must be reclaimable after every one of those exits"
        );
    }

    #[test]
    fn an_omitted_job_key_collapses_to_one_shared_bucket() {
        // Not a per-call unique key: that would grant every id-less caller a
        // claim and silently disable single-flight for exactly the callers that
        // have not been updated to pass an id yet.
        assert_eq!(resolve_job_key(None), DEFAULT_JOB_KEY);
        assert_eq!(resolve_job_key(Some("   ".into())), DEFAULT_JOB_KEY);
        assert_eq!(resolve_job_key(Some("proj-7".into())), "proj-7");
    }
}
