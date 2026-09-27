// ---------------------------------------------------------------------------
// Wave 3 U1 — the desktop side of the cloud sync gateway.
//
// The gateway (`cloud/sync_service.py`, deployed as `kinetix-sync` on Modal)
// is the only remote the app talks to for sync, and ONLY this module talks to
// it. Every request goes out from Rust (`reqwest`); the WebView never holds
// the API key and never opens a connection, which is why the CSP's
// `connect-src` does not list the gateway (and `csp_does_not_reach_gateway`
// below keeps it that way).
//
// What leaves the machine is 16 kHz mono Opus at CBR 16 kbps, encoded here by
// the bundled ffmpeg with `-vn -map 0:a:0 -map_metadata -1`: no picture
// track, no second audio track, no container tags — even when the voiceover
// asset is a video file. The cache key on both sides is the SHA-256 of the
// ORIGINAL asset bytes, the same `audioHash` `services/spine.ts` computes, so
// "has this audio already been uploaded / transcribed" is one question with
// one answer (plan-v3 Wave 3 item 2).
//
// Wave 3 U3 — `cloud_cache_lookup` asks the gateway whether a stage is
// already computed BEFORE anything is encoded or uploaded. A hit returns the
// result itself (no job, no GPU, no meter line); a miss says whether the
// gateway already holds the audio. Responses are gzip-negotiated (results
// are 200-500 KB of JSON; on a high-RTT link slow start, not bandwidth,
// sets a hit's time), and one pooled HTTP client is shared across commands
// so a lookup and the submit after it reuse the TLS connection.
//
// Every failure is a typed `CloudError` (serialized with a `kind` tag), never
// a bare string the UI has to parse. Retry policy is NOT here: this layer
// makes exactly one attempt and reports what happened (retry-once-then-pause
// is Wave 3 U4, one layer up).
// ---------------------------------------------------------------------------

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

/// The deployed gateway. `KINETIX_GATEWAY_URL` overrides it (dev/staging only).
pub(crate) const DEFAULT_GATEWAY_URL: &str = "https://thekingsmanco99--kinetix-sync.modal.run";
const GATEWAY_URL_ENV: &str = "KINETIX_GATEWAY_URL";

const KEY_DIR: &str = "cloud-sync";
const KEY_FILE: &str = "gateway-key";
const OPUS_CACHE_DIR: &str = "cloud-opus-cache";
/// ~68 hours of 16 kbps Opus; LRU-evicted on write.
const OPUS_CACHE_MAX_BYTES: u64 = 512 * 1024 * 1024;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(300);
const POLL_INTERVAL: Duration = Duration::from_millis(1500);
const CANCEL_CHECK_SLICE: Duration = Duration::from_millis(100);
/// Client-side ceiling on one job's wall time: the worker's own 20-minute
/// timeout plus room for GPU scheduling. Past this the job is cancelled and
/// reported as a timeout rather than polled forever.
const JOB_WALL_LIMIT: Duration = Duration::from_secs(25 * 60);

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CloudError {
    /// No API key is stored on this machine.
    NotConfigured,
    /// DNS, connect, TLS, or connection reset — the gateway was not reached.
    Unreachable { detail: String },
    /// Reached, but no answer in time (or the job outran `JOB_WALL_LIMIT`).
    Timeout { detail: String },
    /// The gateway refused the key.
    Auth,
    /// Over the one-hour cap.
    TooLong { detail: String },
    /// Any other typed 4xx refusal (`not-opus`, `audio-missing`, `bad-chunks`, ...).
    Rejected { status: u16, code: String, detail: String },
    /// Gateway 5xx.
    Server { status: u16, detail: String },
    /// The job ran and failed on the worker.
    #[serde(rename_all = "camelCase")]
    JobFailed { job_id: String, code: String, detail: String },
    Cancelled,
    /// Local Opus encode failed (no audio track, unreadable file, ...).
    Encode { detail: String },
    Io { detail: String },
    /// The gateway answered with something this client cannot read.
    Protocol { detail: String },
}

impl CloudError {
    fn io(context: &str, err: impl std::fmt::Display) -> Self {
        CloudError::Io { detail: format!("{context}: {err}") }
    }
}

#[derive(Deserialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct ErrorDetail {
    pub code: String,
    pub detail: String,
}

/// A non-2xx gateway answer, typed.
fn classify_status(status: u16, body: &str) -> CloudError {
    let parsed = serde_json::from_str::<ErrorBody>(body).ok().map(|b| b.error);
    let (code, detail) = match parsed {
        Some(e) => (e.code, e.detail),
        None => (format!("http-{status}"), body.chars().take(300).collect()),
    };
    match status {
        401 => CloudError::Auth,
        413 => CloudError::TooLong { detail },
        400..=499 => CloudError::Rejected { status, code, detail },
        _ => CloudError::Server { status, detail },
    }
}

fn classify_transport(err: &reqwest::Error) -> CloudError {
    // reqwest's own message ("error sending request for url ...") hides the
    // cause; the source chain names it (DNS, TLS, refused, reset).
    let mut detail = err.to_string();
    let mut source = std::error::Error::source(err);
    while let Some(cause) = source {
        detail.push_str(": ");
        detail.push_str(&cause.to_string());
        source = cause.source();
    }
    if err.is_timeout() {
        CloudError::Timeout { detail }
    } else if err.is_decode() {
        CloudError::Protocol { detail }
    } else {
        CloudError::Unreachable { detail }
    }
}

// ---------------------------------------------------------------------------
// Wire types (mirror `cloud/sync_core.py`'s `public_job` and gateway replies).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingReply {
    pub member: String,
    pub schema: u32,
    pub engines: serde_json::Value,
    pub limits: serde_json::Value,
    #[serde(default)]
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadReply {
    /// False when the gateway already held this audio (no bytes sent).
    pub uploaded: bool,
    pub duration_sec: f64,
    pub opus_bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChunkInput {
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobRequest {
    /// `"transcribe"` | `"align"`.
    pub stage: String,
    pub audio_hash: String,
    pub language: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunks: Option<Vec<ChunkInput>>,
}

/// `POST /v1/cache/lookup` (`sync_core.lookup_reply`).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CacheLookup {
    pub cached: bool,
    /// Present only on a hit — the same body a finished job would carry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    /// On a miss: whether the gateway already holds this audio, i.e. whether
    /// running the stage needs an upload at all.
    #[serde(default)]
    pub audio_present: bool,
    #[serde(default)]
    pub audio_duration_sec: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub job_id: String,
    pub stage: String,
    pub status: String,
    #[serde(default)]
    pub cached: bool,
    pub audio_duration_sec: Option<f64>,
    pub worker_sec: Option<f64>,
    pub error: Option<ErrorDetail>,
    /// Present only on `done`: `{tokens, detectedLanguage, provenance}` for
    /// transcribe, `{words, nChunks, nFallbackChunks, provenance}` for align.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
}

impl JobView {
    fn is_terminal(&self) -> bool {
        matches!(self.status.as_str(), "done" | "failed" | "cancelled")
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CloudJobEvent {
    #[serde(rename_all = "camelCase")]
    Submitted { job_id: String, cached: bool },
    /// `queued` = waiting for a GPU (unbilled); `running` = on the GPU.
    #[serde(rename_all = "camelCase")]
    Status { job_id: String, status: String, elapsed_sec: f64 },
}

// ---------------------------------------------------------------------------
// HTTP client — Tauri-free so the live test can drive the real wire path.
// ---------------------------------------------------------------------------

pub struct GatewayClient {
    base: String,
    key: String,
    http: reqwest::Client,
}

fn build_http() -> Result<reqwest::Client, CloudError> {
    reqwest::Client::builder()
        .user_agent(concat!("KinetixProStudio/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(CONNECT_TIMEOUT)
        .gzip(true)
        .build()
        .map_err(|e| CloudError::Io { detail: format!("http client: {e}") })
}

/// One connection pool for every command (reqwest clients are cheap `Arc`
/// clones): a cache lookup and the upload/submit after it share a TLS
/// session instead of each paying a fresh handshake.
fn shared_http() -> Result<reqwest::Client, CloudError> {
    static HTTP: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(http) = HTTP.get() {
        return Ok(http.clone());
    }
    let http = build_http()?;
    Ok(HTTP.get_or_init(|| http).clone())
}

impl GatewayClient {
    /// A client with its own connection pool — the live test's entry point.
    /// The app goes through `client_for` (the shared pool) instead.
    #[cfg(test)]
    pub fn new(base: &str, key: &str) -> Result<Self, CloudError> {
        Ok(Self::with_http(base, key, build_http()?))
    }

    fn with_http(base: &str, key: &str, http: reqwest::Client) -> Self {
        Self { base: base.trim_end_matches('/').to_string(), key: key.to_string(), http }
    }

    fn request(&self, method: reqwest::Method, path: &str, timeout: Duration) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{}", self.base, path))
            .bearer_auth(&self.key)
            .timeout(timeout)
    }

    async fn send_json<T: serde::de::DeserializeOwned>(&self, req: reqwest::RequestBuilder) -> Result<T, CloudError> {
        let resp = req.send().await.map_err(|e| classify_transport(&e))?;
        let status = resp.status().as_u16();
        let body = resp.text().await.map_err(|e| classify_transport(&e))?;
        if !(200..300).contains(&status) {
            return Err(classify_status(status, &body));
        }
        serde_json::from_str(&body).map_err(|e| CloudError::Protocol { detail: format!("{e}") })
    }

    pub async fn ping(&self) -> Result<PingReply, CloudError> {
        let started = Instant::now();
        let mut reply: PingReply = self.send_json(self.request(reqwest::Method::GET, "/v1/ping", REQUEST_TIMEOUT)).await?;
        reply.latency_ms = started.elapsed().as_millis() as u64;
        Ok(reply)
    }

    /// `Some(duration)` when the gateway already holds this audio.
    pub async fn cached_audio_duration(&self, audio_hash: &str) -> Result<Option<f64>, CloudError> {
        let resp = self
            .request(reqwest::Method::HEAD, &format!("/v1/audio/{audio_hash}"), REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| classify_transport(&e))?;
        match resp.status().as_u16() {
            200 => Ok(resp
                .headers()
                .get("x-audio-duration-sec")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<f64>().ok())),
            404 => Ok(None),
            status => Err(classify_status(status, "")),
        }
    }

    /// HEAD first; PUT only when the gateway does not already hold the bytes.
    pub async fn ensure_audio(&self, audio_hash: &str, opus: &[u8]) -> Result<UploadReply, CloudError> {
        if let Some(duration_sec) = self.cached_audio_duration(audio_hash).await? {
            return Ok(UploadReply { uploaded: false, duration_sec, opus_bytes: opus.len() as u64 });
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct PutReply {
            duration_sec: f64,
        }
        let reply: PutReply = self
            .send_json(
                self.request(reqwest::Method::PUT, &format!("/v1/audio/{audio_hash}"), UPLOAD_TIMEOUT)
                    .header(reqwest::header::CONTENT_TYPE, "audio/ogg")
                    .body(opus.to_vec()),
            )
            .await?;
        Ok(UploadReply { uploaded: true, duration_sec: reply.duration_sec, opus_bytes: opus.len() as u64 })
    }

    /// Is this stage already computed? Asked before any encode or upload.
    pub async fn lookup(&self, job: &JobRequest) -> Result<CacheLookup, CloudError> {
        let reply: CacheLookup =
            self.send_json(self.request(reqwest::Method::POST, "/v1/cache/lookup", REQUEST_TIMEOUT).json(job)).await?;
        if reply.cached && reply.result.is_none() {
            return Err(CloudError::Protocol { detail: "cache hit with no result".to_string() });
        }
        Ok(reply)
    }

    pub async fn submit(&self, job: &JobRequest) -> Result<JobView, CloudError> {
        self.send_json(self.request(reqwest::Method::POST, "/v1/jobs", REQUEST_TIMEOUT).json(job)).await
    }

    pub async fn job(&self, job_id: &str) -> Result<JobView, CloudError> {
        self.send_json(self.request(reqwest::Method::GET, &format!("/v1/jobs/{job_id}"), REQUEST_TIMEOUT)).await
    }

    pub async fn cancel(&self, job_id: &str) -> Result<JobView, CloudError> {
        self.send_json(self.request(reqwest::Method::DELETE, &format!("/v1/jobs/{job_id}"), REQUEST_TIMEOUT)).await
    }

    /// Submit, then poll to a terminal state. `cancel` is checked between
    /// polls; when it trips, the job is cancelled on the gateway (so a job
    /// still waiting for a GPU is never charged) and `Cancelled` returned.
    pub async fn run_job(
        &self,
        job: &JobRequest,
        cancel: &AtomicBool,
        emit: &(dyn Fn(CloudJobEvent) + Send + Sync),
    ) -> Result<JobView, CloudError> {
        let started = Instant::now();
        if cancel.load(Ordering::SeqCst) {
            return Err(CloudError::Cancelled);
        }
        let mut view = self.submit(job).await?;
        emit(CloudJobEvent::Submitted { job_id: view.job_id.clone(), cached: view.cached });
        loop {
            if view.is_terminal() {
                break;
            }
            let wait_until = Instant::now() + POLL_INTERVAL;
            while Instant::now() < wait_until {
                if cancel.load(Ordering::SeqCst) {
                    let _ = self.cancel(&view.job_id).await;
                    return Err(CloudError::Cancelled);
                }
                tokio::time::sleep(CANCEL_CHECK_SLICE).await;
            }
            if started.elapsed() > JOB_WALL_LIMIT {
                let _ = self.cancel(&view.job_id).await;
                return Err(CloudError::Timeout {
                    detail: format!("job {} ran past {}s", view.job_id, JOB_WALL_LIMIT.as_secs()),
                });
            }
            view = self.job(&view.job_id).await?;
            emit(CloudJobEvent::Status {
                job_id: view.job_id.clone(),
                status: view.status.clone(),
                elapsed_sec: started.elapsed().as_secs_f64(),
            });
        }
        match view.status.as_str() {
            "done" => {
                // A cache hit answers `done` from the submit, without a result
                // body; one GET fetches it.
                if view.result.is_none() {
                    view = self.job(&view.job_id).await?;
                }
                if view.result.is_none() {
                    return Err(CloudError::Protocol { detail: format!("job {} is done with no result", view.job_id) });
                }
                Ok(view)
            }
            "cancelled" => Err(CloudError::Cancelled),
            _ => {
                let err = view.error.clone().unwrap_or(ErrorDetail {
                    code: "unknown".to_string(),
                    detail: "the job failed without a reason".to_string(),
                });
                Err(CloudError::JobFailed { job_id: view.job_id, code: err.code, detail: err.detail })
            }
        }
    }
}

// ---------------------------------------------------------------------------
// API key — stored by Rust, never handed back to the WebView.
//
// A 0600 file under the app config dir, not the OS keychain: an ad-hoc-signed
// dev build gets a new code signature on every rebuild, and macOS then puts up
// a keychain-access prompt on each first read — friction on exactly the
// manual verification passes this wave is gated on. Keychain storage is
// tracked debt for the SaaS-era account work.
// ---------------------------------------------------------------------------

fn key_path(app: &tauri::AppHandle) -> Result<PathBuf, CloudError> {
    let dir = app.path().app_config_dir().map_err(|e| CloudError::io("app config dir", e))?;
    Ok(dir.join(KEY_DIR).join(KEY_FILE))
}

pub(crate) fn validate_key_format(key: &str) -> Result<&str, CloudError> {
    let key = key.trim();
    let ok = key.starts_with("kx_")
        && (20..=200).contains(&key.len())
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok {
        Ok(key)
    } else {
        Err(CloudError::Rejected {
            status: 0,
            code: "bad-key-format".to_string(),
            detail: "that is not a Kinetix cloud key (they start with kx_)".to_string(),
        })
    }
}

fn write_private(path: &Path, contents: &str) -> Result<(), CloudError> {
    let dir = path.parent().ok_or_else(|| CloudError::io("key path", "no parent"))?;
    fs::create_dir_all(dir).map_err(|e| CloudError::io("create key dir", e))?;
    let tmp = dir.join(format!(".{KEY_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&tmp).map_err(|e| CloudError::io("write key", e))?;
    file.write_all(contents.as_bytes()).map_err(|e| CloudError::io("write key", e))?;
    file.sync_all().map_err(|e| CloudError::io("write key", e))?;
    drop(file);
    fs::rename(&tmp, path).map_err(|e| CloudError::io("store key", e))
}

fn read_key(app: &tauri::AppHandle) -> Result<String, CloudError> {
    match fs::read_to_string(key_path(app)?) {
        Ok(key) if !key.trim().is_empty() => Ok(key.trim().to_string()),
        Ok(_) => Err(CloudError::NotConfigured),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(CloudError::NotConfigured),
        Err(e) => Err(CloudError::io("read key", e)),
    }
}

fn gateway_url() -> String {
    std::env::var(GATEWAY_URL_ENV).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| DEFAULT_GATEWAY_URL.to_string())
}

fn client_for(app: &tauri::AppHandle) -> Result<GatewayClient, CloudError> {
    let key = read_key(app)?;
    Ok(GatewayClient::with_http(&gateway_url(), &key, shared_http()?))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub configured: bool,
    pub gateway: String,
}

#[tauri::command]
pub fn cloud_key_status(app: tauri::AppHandle) -> Result<KeyStatus, CloudError> {
    let configured = match read_key(&app) {
        Ok(_) => true,
        Err(CloudError::NotConfigured) => false,
        Err(e) => return Err(e),
    };
    Ok(KeyStatus { configured, gateway: gateway_url() })
}

#[tauri::command]
pub fn cloud_key_set(app: tauri::AppHandle, key: String) -> Result<KeyStatus, CloudError> {
    let key = validate_key_format(&key)?;
    write_private(&key_path(&app)?, key)?;
    Ok(KeyStatus { configured: true, gateway: gateway_url() })
}

#[tauri::command]
pub fn cloud_key_clear(app: tauri::AppHandle) -> Result<KeyStatus, CloudError> {
    match fs::remove_file(key_path(&app)?) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(CloudError::io("remove key", e)),
    }
    Ok(KeyStatus { configured: false, gateway: gateway_url() })
}

#[tauri::command]
pub async fn cloud_ping(app: tauri::AppHandle) -> Result<PingReply, CloudError> {
    client_for(&app)?.ping().await
}

// ---------------------------------------------------------------------------
// Audio: stage original bytes -> Opus (local cache) -> gateway.
// ---------------------------------------------------------------------------

fn is_audio_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn opus_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, CloudError> {
    let dir = app.path().app_local_data_dir().map_err(|e| CloudError::io("app data dir", e))?;
    Ok(dir.join(OPUS_CACHE_DIR))
}

fn opus_path(dir: &Path, audio_hash: &str) -> PathBuf {
    dir.join(format!("{audio_hash}.opus"))
}

fn source_path(dir: &Path, audio_hash: &str) -> PathBuf {
    dir.join(format!("{audio_hash}.src"))
}

/// The one Opus setting (docs/architecture/cloud-asr-plan.md, "Audio payload
/// sizing"): 16 kHz mono libopus CBR 16 kbps. `-vn` + `-map 0:a:0` send the
/// first audio track and nothing else — never a picture — and
/// `-map_metadata -1` drops container tags (titles, artist, location).
///
/// `-compression_level 4` (libopus complexity; default 10). The bundled
/// static ffmpeg's libopus is ~7x slower than a Homebrew build on the same
/// CPU: V6 (23.7 min) took 213 s at the default, 47 s at 4, with a cliff
/// between 5 and 6. CBR keeps the size identical at every level. Measured
/// cost on cloud transcription of V6 vs the level-10 baseline (Wave 3 U1):
/// level 4 = 99.2% text match, mean 9.3 ms / p95 40 ms start delta; level 0
/// = mean 59 ms / p95 440 ms, rejected. The U8 parity gate runs on this
/// exact setting.
pub(crate) fn opus_encode_args(input: &Path, output: &Path) -> Vec<String> {
    [
        "-hide_banner", "-nostdin", "-y",
        "-i", &input.to_string_lossy(),
        "-vn", "-map", "0:a:0", "-map_metadata", "-1",
        "-ar", "16000", "-ac", "1",
        "-c:a", "libopus", "-b:a", "16k", "-vbr", "off", "-compression_level", "4",
        "-f", "opus",
        &output.to_string_lossy(),
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

fn evict_lru(dir: &Path, max_bytes: u64, keep: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = entries
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let is_opus = e.path().extension().is_some_and(|x| x == "opus");
            if !(meta.is_file() && is_opus) {
                return None;
            }
            Some((e.path(), meta.len(), meta.modified().ok()?))
        })
        .collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    files.sort_by_key(|f| f.2);
    for (path, size, _) in files {
        if total <= max_bytes {
            break;
        }
        if path != keep && fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

/// `Some(bytes)` when this audio is already encoded locally — the caller can
/// skip sending the original over IPC entirely.
#[tauri::command]
pub fn cloud_opus_cached(app: tauri::AppHandle, audio_hash: String) -> Result<Option<u64>, CloudError> {
    if !is_audio_hash(&audio_hash) {
        return Err(CloudError::Protocol { detail: "audioHash must be sha256 hex".to_string() });
    }
    let path = opus_path(&opus_cache_dir(&app)?, &audio_hash);
    Ok(fs::metadata(path).ok().filter(|m| m.is_file()).map(|m| m.len()))
}

/// Raw-IPC-body staging of the ORIGINAL asset bytes (no base64 — CLAUDE.md
/// §6). The `audio-hash` header must equal the SHA-256 of the body: the
/// client's `audioHash` is the cache key on the gateway, so a mismatch would
/// file one recording's audio under another's name.
#[tauri::command]
pub fn cloud_stage_audio_raw(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, CloudError> {
    let claimed = request
        .headers()
        .get("audio-hash")
        .and_then(|v| v.to_str().ok())
        .filter(|v| is_audio_hash(v))
        .ok_or_else(|| CloudError::Protocol { detail: "missing or invalid 'audio-hash' header".to_string() })?
        .to_string();
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data,
        tauri::ipc::InvokeBody::Json(_) => {
            return Err(CloudError::Protocol { detail: "expected a raw byte body".to_string() })
        }
    };
    let mut hasher = crate::sha256::Sha256::new();
    hasher.update(bytes);
    let actual = crate::sha256::hex_digest(&hasher.finish());
    if actual != claimed {
        return Err(CloudError::Protocol {
            detail: format!("audio-hash header {claimed} does not match the body ({actual})"),
        });
    }
    let dir = opus_cache_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| CloudError::io("create opus cache", e))?;
    crate::atomic_stage::write_bytes_atomic(&source_path(&dir, &claimed), bytes)
        .map_err(|e| CloudError::io("stage audio", e))?;
    Ok(claimed)
}

/// Encode a staged original into the local Opus cache and drop the original.
#[tauri::command]
pub async fn cloud_encode_opus(app: tauri::AppHandle, audio_hash: String) -> Result<u64, CloudError> {
    if !is_audio_hash(&audio_hash) {
        return Err(CloudError::Protocol { detail: "audioHash must be sha256 hex".to_string() });
    }
    let dir = opus_cache_dir(&app)?;
    let dest = opus_path(&dir, &audio_hash);
    let src = source_path(&dir, &audio_hash);
    if let Ok(meta) = fs::metadata(&dest) {
        let _ = fs::remove_file(&src);
        return Ok(meta.len());
    }
    if !src.is_file() {
        return Err(CloudError::Io { detail: "no staged audio for this hash; stage it first".to_string() });
    }
    let tmp = dir.join(format!("{audio_hash}.{}.part", uuid::Uuid::new_v4()));
    let out = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| CloudError::Encode { detail: format!("ffmpeg sidecar lookup: {e}") })?
        .args(opus_encode_args(&src, &tmp))
        .output()
        .await
        .map_err(|e| CloudError::Encode { detail: format!("ffmpeg spawn: {e}") })?;
    let _ = fs::remove_file(&src);
    if !out.status.success() {
        let _ = fs::remove_file(&tmp);
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail: String = stderr.chars().rev().take(600).collect::<Vec<_>>().into_iter().rev().collect();
        return Err(CloudError::Encode { detail: format!("ffmpeg exit {}: {tail}", out.status.code().unwrap_or(-1)) });
    }
    fs::rename(&tmp, &dest).map_err(|e| CloudError::io("store opus", e))?;
    evict_lru(&dir, OPUS_CACHE_MAX_BYTES, &dest);
    fs::metadata(&dest).map(|m| m.len()).map_err(|e| CloudError::io("stat opus", e))
}

#[tauri::command]
pub async fn cloud_upload_audio(app: tauri::AppHandle, audio_hash: String) -> Result<UploadReply, CloudError> {
    if !is_audio_hash(&audio_hash) {
        return Err(CloudError::Protocol { detail: "audioHash must be sha256 hex".to_string() });
    }
    let client = client_for(&app)?;
    let path = opus_path(&opus_cache_dir(&app)?, &audio_hash);
    let opus = fs::read(&path).map_err(|e| CloudError::io("read opus (encode it first)", e))?;
    client.ensure_audio(&audio_hash, &opus).await
}

/// Wave 3 U3 — the cache question, asked before the audio is prepared. The
/// same `JobRequest` a submit would send, so both compute the same key.
#[tauri::command]
pub async fn cloud_cache_lookup(app: tauri::AppHandle, job: JobRequest) -> Result<CacheLookup, CloudError> {
    if !is_audio_hash(&job.audio_hash) {
        return Err(CloudError::Protocol { detail: "audioHash must be sha256 hex".to_string() });
    }
    client_for(&app)?.lookup(&job).await
}

// ---------------------------------------------------------------------------
// Jobs, with a per-run cancel flag the frontend's AbortSignal trips.
// ---------------------------------------------------------------------------

fn runs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static RUNS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct RunGuard(String);

impl Drop for RunGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = runs().lock() {
            map.remove(&self.0);
        }
    }
}

#[tauri::command]
pub async fn cloud_run_job(
    app: tauri::AppHandle,
    run_id: String,
    job: JobRequest,
    on_event: Channel<CloudJobEvent>,
) -> Result<JobView, CloudError> {
    let client = client_for(&app)?;
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = runs().lock().map_err(|_| CloudError::io("run registry", "poisoned"))?;
        if map.contains_key(&run_id) {
            return Err(CloudError::Protocol { detail: format!("run {run_id} is already in flight") });
        }
        map.insert(run_id.clone(), flag.clone());
    }
    let _guard = RunGuard(run_id);
    let emit = move |event: CloudJobEvent| {
        let _ = on_event.send(event);
    };
    client.run_job(&job, &flag, &emit).await
}

/// Trips the cancel flag of an in-flight `cloud_run_job`. Returns whether a
/// run by that id was found. Idempotent.
#[tauri::command]
pub fn cloud_cancel_run(run_id: String) -> bool {
    runs()
        .lock()
        .ok()
        .and_then(|map| map.get(&run_id).cloned())
        .map(|flag| flag.store(true, Ordering::SeqCst))
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_codes_become_typed_errors() {
        assert_eq!(classify_status(401, r#"{"error":{"code":"auth","detail":"x"}}"#), CloudError::Auth);
        assert!(matches!(classify_status(413, r#"{"error":{"code":"too-long","detail":"big"}}"#), CloudError::TooLong { .. }));
        assert_eq!(
            classify_status(409, r#"{"error":{"code":"audio-missing","detail":"upload first"}}"#),
            CloudError::Rejected { status: 409, code: "audio-missing".into(), detail: "upload first".into() }
        );
        assert!(matches!(classify_status(502, "<html>bad gateway</html>"), CloudError::Server { status: 502, .. }));
        // A 4xx without the gateway's error envelope still gets a code.
        assert!(matches!(classify_status(404, "nope"), CloudError::Rejected { code, .. } if code == "http-404"));
    }

    #[test]
    fn errors_serialize_with_a_kind_tag() {
        let v = serde_json::to_value(CloudError::JobFailed { job_id: "j".into(), code: "worker-error".into(), detail: "d".into() }).unwrap();
        assert_eq!(v["kind"], "jobFailed");
        assert_eq!(v["jobId"], "j");
        assert_eq!(serde_json::to_value(CloudError::NotConfigured).unwrap()["kind"], "notConfigured");
    }

    #[test]
    fn opus_args_never_carry_video_or_tags() {
        let args = opus_encode_args(Path::new("/in/movie.mov"), Path::new("/out/a.opus"));
        let joined = args.join(" ");
        for required in ["-vn", "-map 0:a:0", "-map_metadata -1", "-ar 16000", "-ac 1", "-c:a libopus", "-b:a 16k", "-vbr off", "-compression_level 4"] {
            assert!(joined.contains(required), "missing {required}: {joined}");
        }
        assert_eq!(args.last().unwrap(), "/out/a.opus");
    }

    #[test]
    fn key_format() {
        assert!(validate_key_format("kx_abcdefghijklmnopqrstuvwxyz0123456789-_").is_ok());
        assert!(validate_key_format("  kx_abcdefghijklmnopqrstuvwxyz\n").is_ok());
        assert!(validate_key_format("sk_abcdefghijklmnopqrstuvwxyz").is_err());
        assert!(validate_key_format("kx_short").is_err());
        assert!(validate_key_format("kx_abcdefghijklmnop qrstuvwxyz").is_err());
    }

    #[test]
    fn job_request_wire_shape() {
        let req = JobRequest {
            stage: "align".into(),
            audio_hash: "a".repeat(64),
            language: "en".into(),
            chunks: Some(vec![ChunkInput { start_sec: 0.0, end_sec: 1.5, text: "hi".into() }]),
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["audioHash"], "a".repeat(64));
        assert_eq!(v["chunks"][0]["startSec"], 0.0);
        let transcribe = JobRequest { stage: "transcribe".into(), audio_hash: "a".repeat(64), language: "auto".into(), chunks: None };
        assert!(serde_json::to_value(&transcribe).unwrap().get("chunks").is_none());
    }

    #[test]
    fn cache_lookup_wire_shape() {
        let hit: CacheLookup = serde_json::from_str(r#"{"cached":true,"result":{"tokens":[]}}"#).unwrap();
        assert!(hit.cached && hit.result.is_some() && !hit.audio_present);
        let miss: CacheLookup =
            serde_json::from_str(r#"{"cached":false,"audioPresent":true,"audioDurationSec":1421.3}"#).unwrap();
        assert_eq!(
            miss,
            CacheLookup { cached: false, result: None, audio_present: true, audio_duration_sec: Some(1421.3) }
        );
        let v = serde_json::to_value(&miss).unwrap();
        assert_eq!(v["audioPresent"], true);
        assert!(v.get("result").is_none());
    }

    #[test]
    fn lru_keeps_the_file_just_written() {
        let dir = std::env::temp_dir().join(format!("kx-opus-lru-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old.opus");
        let new = dir.join("new.opus");
        fs::write(&old, vec![0u8; 600]).unwrap();
        std::thread::sleep(Duration::from_millis(20));
        fs::write(&new, vec![0u8; 600]).unwrap();
        fs::write(dir.join("x.src"), vec![0u8; 5000]).unwrap(); // staging never evicted
        evict_lru(&dir, 1000, &new);
        assert!(!old.exists() && new.exists() && dir.join("x.src").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    /// The WebView must never reach the gateway directly: every request goes
    /// through this module, so the key never enters JS. If someone adds the
    /// gateway to `connect-src`, this fails and makes them read why.
    #[test]
    fn csp_does_not_reach_gateway() {
        let conf = include_str!("../tauri.conf.json");
        assert!(conf.contains("connect-src"));
        assert!(!conf.contains("modal.run"), "tauri.conf.json must not allow the WebView to reach the gateway");
    }

    // -----------------------------------------------------------------------
    // Live: the real Rust wire path against the deployed gateway. Opt-in:
    //   KINETIX_GATEWAY_KEY_FILE=../cloud/.keys/operator.key \
    //     cargo test cloud_gateway::tests::live -- --ignored --nocapture
    // Costs nothing: every job it submits is a cache hit from the U0 smoke,
    // and the only upload is a 5 s clip (storage, no GPU).
    // -----------------------------------------------------------------------

    fn live_client() -> GatewayClient {
        let key_file = std::env::var("KINETIX_GATEWAY_KEY_FILE").expect("set KINETIX_GATEWAY_KEY_FILE");
        let key = fs::read_to_string(key_file).unwrap();
        GatewayClient::new(&gateway_url(), key.trim()).unwrap()
    }

    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
    }

    fn bundled_ffmpeg() -> PathBuf {
        let triple = if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" };
        Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("ffmpeg-{triple}"))
    }

    #[test]
    #[ignore]
    fn live_wire_path() {
        tauri::async_runtime::block_on(async {
            let api = live_client();

            let ping = api.ping().await.expect("ping");
            println!("ping: member={} latency={}ms", ping.member, ping.latency_ms);

            let bad = GatewayClient::new(&gateway_url(), "kx_not-a-real-key-000000").unwrap();
            assert_eq!(bad.ping().await.unwrap_err(), CloudError::Auth);

            let nowhere = GatewayClient::new("https://kinetix-sync-does-not-exist.invalid", "kx_x").unwrap();
            assert!(matches!(nowhere.ping().await.unwrap_err(), CloudError::Unreachable { .. }));

            // Encode the real V6 original with the bundled ffmpeg and the
            // production args.
            let original = repo_root().join("cloud/fixtures/6.m4a");
            let bytes = fs::read(&original).expect("cloud/fixtures/6.m4a");
            let mut h = crate::sha256::Sha256::new();
            h.update(&bytes);
            let audio_hash = crate::sha256::hex_digest(&h.finish());
            let tmp = std::env::temp_dir().join(format!("kx-live-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&tmp).unwrap();
            let opus_out = tmp.join("v6.opus");
            let status = std::process::Command::new(bundled_ffmpeg())
                .args(opus_encode_args(&original, &opus_out))
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap();
            assert!(status.success());
            let opus = fs::read(&opus_out).unwrap();
            println!("bundled-ffmpeg V6 opus: {} bytes (harness fixture 2,952,316)", opus.len());
            assert!((opus.len() as i64 - 2_952_316).abs() < 30_000);

            // Already on the gateway from U0: HEAD answers, nothing is sent.
            let up = api.ensure_audio(&audio_hash, &opus).await.unwrap();
            assert!(!up.uploaded);
            println!("V6 ensure_audio: uploaded={} duration={:.2}s", up.uploaded, up.duration_sec);

            // A fresh 5 s clip exercises the real PUT.
            let clip_src = tmp.join("clip.wav");
            let clip_opus = tmp.join("clip.opus");
            assert!(std::process::Command::new(bundled_ffmpeg())
                .args(["-hide_banner", "-y", "-t", "5", "-i"])
                .arg(repo_root().join("cloud/fixtures/v6_16k.wav"))
                .arg(&clip_src)
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap()
                .success());
            assert!(std::process::Command::new(bundled_ffmpeg())
                .args(opus_encode_args(&clip_src, &clip_opus))
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap()
                .success());
            let clip_bytes = fs::read(&clip_src).unwrap();
            let mut h = crate::sha256::Sha256::new();
            h.update(&clip_bytes);
            let clip_hash = crate::sha256::hex_digest(&h.finish());
            let clip_up = api.ensure_audio(&clip_hash, &fs::read(&clip_opus).unwrap()).await.unwrap();
            println!("clip ensure_audio: uploaded={} duration={:.3}s", clip_up.uploaded, clip_up.duration_sec);
            assert!((clip_up.duration_sec - 5.0).abs() < 0.1);

            // Wave 3 U3 — the lookup answers both stages before any upload,
            // gzip-negotiated, with the full result in hand.
            let t0 = Instant::now();
            let hit = api
                .lookup(&JobRequest { stage: "transcribe".into(), audio_hash: audio_hash.clone(), language: "en".into(), chunks: None })
                .await
                .expect("lookup");
            assert!(hit.cached);
            assert_eq!(hit.result.as_ref().unwrap()["tokens"].as_array().unwrap().len(), 3960);
            println!("lookup transcribe: cached={} {}ms", hit.cached, t0.elapsed().as_millis());
            let unknown = api
                .lookup(&JobRequest { stage: "transcribe".into(), audio_hash: "d".repeat(64), language: "en".into(), chunks: None })
                .await
                .expect("lookup miss");
            assert_eq!(unknown, CacheLookup { cached: false, result: None, audio_present: false, audio_duration_sec: None });

            // Both cache stages answer through run_job without a GPU.
            let never = AtomicBool::new(false);
            let events = Mutex::new(Vec::new());
            let emit = |e: CloudJobEvent| events.lock().unwrap().push(e);
            let transcript = api
                .run_job(&JobRequest { stage: "transcribe".into(), audio_hash: audio_hash.clone(), language: "en".into(), chunks: None }, &never, &emit)
                .await
                .expect("transcribe cache hit");
            assert!(transcript.cached);
            let n_tokens = transcript.result.as_ref().unwrap()["tokens"].as_array().unwrap().len();
            println!("transcribe: cached={} tokens={}", transcript.cached, n_tokens);
            assert_eq!(n_tokens, 3960);

            let plan: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(repo_root().join("cloud/results/chunk_plan_v6.json")).unwrap()).unwrap();
            let chunks: Vec<ChunkInput> = plan["chunks"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| ChunkInput {
                    start_sec: c["startSec"].as_f64().unwrap(),
                    end_sec: c["endSec"].as_f64().unwrap(),
                    text: c["text"].as_str().unwrap().to_string(),
                })
                .collect();
            let aligned = api
                .run_job(&JobRequest { stage: "align".into(), audio_hash: audio_hash.clone(), language: "en".into(), chunks: Some(chunks) }, &never, &emit)
                .await
                .expect("align cache hit");
            let n_words = aligned.result.as_ref().unwrap()["words"].as_array().unwrap().len();
            println!("align: cached={} words={}", aligned.cached, n_words);
            assert_eq!(n_words, 3874);

            // Typed refusals come back typed.
            let missing = api
                .run_job(
                    &JobRequest {
                        stage: "align".into(),
                        audio_hash: "f".repeat(64),
                        language: "en".into(),
                        chunks: Some(vec![ChunkInput { start_sec: 0.0, end_sec: 1.0, text: "x".into() }]),
                    },
                    &never,
                    &emit,
                )
                .await
                .unwrap_err();
            assert!(matches!(missing, CloudError::Rejected { status: 409, ref code, .. } if code == "audio-missing"));

            // A pre-tripped cancel never submits.
            let tripped = AtomicBool::new(true);
            let r = api
                .run_job(&JobRequest { stage: "transcribe".into(), audio_hash, language: "en".into(), chunks: None }, &tripped, &emit)
                .await;
            assert_eq!(r.unwrap_err(), CloudError::Cancelled);
            println!("events: {:?}", events.lock().unwrap());
            fs::remove_dir_all(tmp).unwrap();
        });
    }
}
