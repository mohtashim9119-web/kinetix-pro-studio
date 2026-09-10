use base64::{engine::general_purpose::STANDARD, Engine};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

/// Per-export session state: killable ffmpeg children and cooperative cancel
/// flags for native I/O commands (concat, frame-count, truncate).
#[derive(Default)]
pub struct FfmpegSessionState {
    pub children: Mutex<HashMap<String, CommandChild>>,
    pub cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Surviving sessions re-entered after a process restart. Native append,
    /// count, and concat stay closed until checkpoint repair succeeds.
    resume_pending: Mutex<HashSet<String>>,
}

/// Back-compat alias — lib.rs still `.manage(ffmpeg::FfmpegProcessState::default())`.
pub type FfmpegProcessState = FfmpegSessionState;

const IO_CHUNK_SIZE: usize = 64 * 1024;

fn register_session_cancel_flag(state: &FfmpegSessionState, session_id: &str) {
    state
        .cancel_flags
        .lock()
        .unwrap()
        .insert(session_id.to_string(), Arc::new(AtomicBool::new(false)));
}

fn session_cancel_flag(state: &FfmpegSessionState, session_id: &str) -> Option<Arc<AtomicBool>> {
    state.cancel_flags.lock().unwrap().get(session_id).cloned()
}

fn check_cancelled(cancel: Option<&AtomicBool>) -> Result<(), String> {
    if cancel.is_some_and(|f| f.load(Ordering::Relaxed)) {
        return Err("cancelled".to_string());
    }
    Ok(())
}

fn set_session_cancelled(state: &FfmpegSessionState, session_id: &str) {
    if let Some(flag) = session_cancel_flag(state, session_id) {
        flag.store(true, Ordering::SeqCst);
    }
}

fn ensure_resume_prepared(
    state: &FfmpegSessionState,
    session_id: &str,
    operation: &str,
) -> Result<(), String> {
    if state.resume_pending.lock().unwrap().contains(session_id) {
        return Err(format!(
            "{operation}: resumed session {session_id} has not passed checkpoint pre-append validation"
        ));
    }
    Ok(())
}

/// Validates a logical filename is safe for use inside a session directory.
///
/// Rules:
///   - Must be non-empty.
///   - Every character must be in [A-Za-z0-9_.-].
///   - Must not be "." or ".." (caught by the char set since ".." would pass
///     char-by-char, so we check explicitly).
///   - No path separators (/ and \ are outside the allowed charset, so they
///     are rejected by the loop — explicit check is for clarity).
fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("invalid path: must not be empty".to_string());
    }
    if path == "." || path == ".." {
        return Err(format!("invalid path: \"{}\" is not allowed", path));
    }
    for ch in path.chars() {
        if !matches!(ch, 'A'..='Z' | 'a'..='z' | '0'..='9' | '_' | '.' | '-') {
            return Err(format!(
                "invalid path: \"{}\" contains disallowed character '{}'",
                path, ch
            ));
        }
    }
    Ok(())
}

/// Parses session_id as a UUID and returns the corresponding session directory.
///
/// Validation ensures the frontend cannot supply an arbitrary directory path
/// by crafting a malformed session_id string.
fn session_dir(session_id: &str) -> Result<PathBuf, String> {
    // Parse as UUID to validate format — reject anything that isn't a real v4 UUID.
    let _ = Uuid::parse_str(session_id)
        .map_err(|_| format!("invalid session_id: \"{}\" is not a valid UUID", session_id))?;
    Ok(std::env::temp_dir().join(format!("kinetix-export-{}", session_id)))
}

fn recover_export_state_replace(dir: &Path) -> Result<(), String> {
    let final_path = dir.join("export_state.json");
    if final_path.is_file() {
        return Ok(());
    }
    let temp = dir.join("export_state.json.tmp");
    let backup = dir.join("export_state.json.bak");
    if temp.is_file() {
        fs::rename(&temp, &final_path)
            .map_err(|e| format!("recover_export_state: promote temp: {}", e))?;
        let _ = fs::remove_file(&backup);
        return Ok(());
    }
    if backup.is_file() {
        fs::rename(&backup, &final_path)
            .map_err(|e| format!("recover_export_state: restore backup: {}", e))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Creates a new isolated session directory under $TMPDIR.
/// Returns the session id (UUID v4 string) that must be passed to all
/// subsequent commands for this export.
#[tauri::command]
pub fn ffmpeg_create_session(
    state: tauri::State<'_, FfmpegSessionState>,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let dir = std::env::temp_dir().join(format!("kinetix-export-{}", id));
    fs::create_dir_all(&dir).map_err(|e| format!("create_session: {}", e))?;
    register_session_cancel_flag(&state, &id);
    Ok(id)
}

/// Lists crash-surviving export sessions that contain `export_state.json`.
/// Names are parsed as UUIDs; arbitrary `kinetix-export-*` directories are
/// ignored rather than exposed to the renderer.
#[tauri::command]
pub fn ffmpeg_list_resumable_sessions() -> Result<Vec<String>, String> {
    let temp = std::env::temp_dir();
    let entries = fs::read_dir(&temp)
        .map_err(|e| format!("list_resumable_sessions({}): {}", temp.display(), e))?;
    let mut sessions = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("list_resumable_sessions: {}", e))?;
        if !entry
            .file_type()
            .map_err(|e| format!("list_resumable_sessions: file_type: {}", e))?
            .is_dir()
        {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(id) = name.strip_prefix("kinetix-export-") else {
            continue;
        };
        if Uuid::parse_str(id).is_err() {
            continue;
        }
        recover_export_state_replace(&entry.path())?;
        if entry.path().join("export_state.json").is_file() {
            sessions.push(id.to_string());
        }
    }
    sessions.sort();
    Ok(sessions)
}

/// Re-enters an existing crash-surviving session directory without minting a
/// fresh UUID. This only opens the session for read/size/truncate operations:
/// append/count/concat remain blocked until `ffmpeg_prepare_checkpoint_resume`
/// succeeds.
#[tauri::command]
pub fn ffmpeg_reenter_session(
    session_id: String,
    state: tauri::State<'_, FfmpegSessionState>,
) -> Result<(), String> {
    let dir = session_dir(&session_id)?;
    if !dir.is_dir() {
        return Err(format!(
            "reenter_session: session directory does not exist: {}",
            dir.display()
        ));
    }
    recover_export_state_replace(&dir)?;
    if !dir.join("export_state.json").is_file() {
        return Err("reenter_session: export_state.json is missing".to_string());
    }
    register_session_cancel_flag(&state, &session_id);
    state.resume_pending.lock().unwrap().insert(session_id);
    Ok(())
}

/// Writes base64-encoded bytes to <session_dir>/<path>.
///
/// The frontend encodes Uint8Array → base64 string before invoking this command.
/// Decoding in Rust eliminates the JSON-array-of-numbers IPC overhead that was
/// the dominant export bottleneck (~5-10× speedup on per-frame PNG writes). Phase 6.3.1.
#[tauri::command]
pub fn ffmpeg_write_file(session_id: String, path: String, data_b64: String) -> Result<(), String> {
    validate_path(&path)?;
    let full = session_dir(&session_id)?.join(&path);
    let data = STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("write_file({}): base64 decode failed: {}", path, e))?;
    fs::write(&full, &data).map_err(|e| format!("write_file({}): {}", path, e))
}

/// Raw-binary variant of `ffmpeg_write_file`.
///
/// Writes the invoke request's raw body bytes to <session_dir>/<path>. Unlike
/// `ffmpeg_write_file`, the payload is NOT base64-encoded: the frontend passes a
/// `Uint8Array`/`ArrayBuffer` as the invoke body (Tauri v2 raw request body), and
/// `session_id` + `path` travel as request headers. This eliminates the per-frame
/// base64 encode (JS) + inflated-string IPC transfer + base64 decode (Rust) that
/// dominated the per-frame PNG-write cost on the canvas export path (audit
/// confirmed disk I/O itself is sub-ms).
///
/// `ffmpeg_write_file` is left untouched for backward compatibility and other
/// callers; only the segment encoder's per-frame image path uses this command.
/// Validation and the `fs::write` logic are identical to `ffmpeg_write_file` —
/// only the transport differs.
#[tauri::command]
pub fn ffmpeg_write_file_raw(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let headers = request.headers();
    let session_id = headers
        .get("session-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "write_file_raw: missing or invalid 'session-id' header".to_string())?;
    let path = headers
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "write_file_raw: missing or invalid 'path' header".to_string())?;

    validate_path(path)?;
    let full = session_dir(session_id)?.join(path);

    match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => {
            fs::write(&full, data).map_err(|e| format!("write_file_raw({}): {}", path, e))
        }
        tauri::ipc::InvokeBody::Json(_) => {
            Err("write_file_raw: expected a raw byte body, got JSON".to_string())
        }
    }
}

/// Append-binary variant of `ffmpeg_write_file_raw`, for the WebCodecs export
/// worker's streamed annexb chunk output (docs/webcodecs-export-plan.md §6).
///
/// Same header extraction + `validate_path` + `session_dir` pattern as
/// `ffmpeg_write_file_raw`; the only difference is `OpenOptions::append(true)`
/// instead of a truncating `fs::write`. `create(true)` means the first append
/// for a given path creates the file; every subsequent append for that path
/// extends it — exactly the semantics a per-run `run_K.h264` stream needs as
/// `VideoEncoder` chunks arrive one at a time.
#[tauri::command]
pub fn ffmpeg_append_file_raw(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, FfmpegSessionState>,
) -> Result<(), String> {
    use std::io::Write;

    let headers = request.headers();
    let session_id = headers
        .get("session-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "append_file_raw: missing or invalid 'session-id' header".to_string())?;
    let path = headers
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "append_file_raw: missing or invalid 'path' header".to_string())?;

    validate_path(path)?;
    ensure_resume_prepared(&state, session_id, "append_file_raw")?;
    let full = session_dir(session_id)?.join(path);

    match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => {
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&full)
                .map_err(|e| format!("append_file_raw({}): open: {}", path, e))?;
            file.write_all(data)
                .map_err(|e| format!("append_file_raw({}): write: {}", path, e))
        }
        tauri::ipc::InvokeBody::Json(_) => {
            Err("append_file_raw: expected a raw byte body, got JSON".to_string())
        }
    }
}

/// Returns the byte length of `<session_dir>/<path>` without reading contents.
#[tauri::command]
pub fn ffmpeg_session_file_size(session_id: String, path: String) -> Result<u64, String> {
    validate_path(&path)?;
    let full = session_dir(&session_id)?.join(&path);
    fs::metadata(&full)
        .map(|m| m.len())
        .map_err(|e| format!("session_file_size({}): {}", path, e))
}

/// Durably replaces `export_state.json`: validate JSON, write + fsync a temp
/// file, then atomically rename it over the prior manifest. A process crash can
/// leave the previous complete manifest or the new complete manifest, never a
/// half-written file under the authoritative name.
#[tauri::command]
pub fn ffmpeg_write_export_state(
    session_id: String,
    serialized_state: String,
) -> Result<(), String> {
    use std::io::Write;

    let parsed: serde_json::Value = serde_json::from_str(&serialized_state)
        .map_err(|e| format!("write_export_state: invalid JSON: {}", e))?;
    let manifest_session = parsed
        .get("sessionId")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "write_export_state: manifest sessionId is missing".to_string())?;
    if manifest_session != session_id {
        return Err("write_export_state: manifest sessionId mismatch".to_string());
    }

    let dir = session_dir(&session_id)?;
    let temp = dir.join("export_state.json.tmp");
    let final_path = dir.join("export_state.json");
    let mut file =
        fs::File::create(&temp).map_err(|e| format!("write_export_state: create temp: {}", e))?;
    file.write_all(serialized_state.as_bytes())
        .map_err(|e| format!("write_export_state: write temp: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("write_export_state: sync temp: {}", e))?;
    drop(file);
    if let Err(rename_err) = fs::rename(&temp, &final_path) {
        // Unix replaces an existing destination atomically. Windows rename
        // does not, so use a recoverable two-rename fallback. Startup promotes
        // the fsynced temp (or restores backup) if the process dies mid-swap.
        let backup = dir.join("export_state.json.bak");
        let _ = fs::remove_file(&backup);
        if final_path.is_file() {
            fs::rename(&final_path, &backup).map_err(|e| {
                format!("write_export_state: replace fallback after {rename_err}: backup: {e}")
            })?;
        }
        if let Err(e) = fs::rename(&temp, &final_path) {
            let _ = fs::rename(&backup, &final_path);
            return Err(format!("write_export_state: promote temp: {}", e));
        }
        let _ = fs::remove_file(&backup);
    }
    Ok(())
}

/// Reads <session_dir>/<path> and returns its bytes.
#[tauri::command]
pub fn ffmpeg_read_file(session_id: String, path: String) -> Result<Vec<u8>, String> {
    validate_path(&path)?;
    let full = session_dir(&session_id)?.join(&path);
    fs::read(&full).map_err(|e| format!("read_file({}): {}", path, e))
}

/// Picture and raw-VCL counts for an Annex-B H.264 stream.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnexbFrameCount {
    pub pictures: u64,
    pub vcl_nals: u64,
}

/// Result of truncating an Annex-B file at the last complete access unit.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnexbTruncateResult {
    pub pictures: u64,
    pub vcl_nals: u64,
    pub bytes_removed: u64,
    pub kept_bytes: u64,
}

/// Result of the atomic checkpoint pre-append handshake.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointResumeResult {
    pub pictures: u64,
    pub vcl_nals: u64,
    pub bytes_removed: u64,
    pub kept_bytes: u64,
    pub last_nal_start: Option<u64>,
    pub trailing_nal_had_header: bool,
    pub tail_was_whole_au: bool,
}

struct AnnexbBitReader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> AnnexbBitReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    fn read_bit(&mut self) -> u8 {
        let byte_idx = self.pos >> 3;
        if byte_idx >= self.bytes.len() {
            return 0;
        }
        let bit_idx = 7 - (self.pos & 7);
        self.pos += 1;
        (self.bytes[byte_idx] >> bit_idx) & 1
    }

    fn read_ue(&mut self) -> Option<u32> {
        let mut zeros = 0u32;
        while self.read_bit() == 0 {
            zeros += 1;
            if zeros > 32 {
                return None;
            }
        }
        let mut value = (1u32 << zeros).wrapping_sub(1);
        for i in (0..zeros).rev() {
            value += (self.read_bit() as u32) << i;
        }
        Some(value)
    }
}

fn rbsp_from_nal_payload(payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len());
    for (i, &b) in payload.iter().enumerate() {
        if i >= 2 && b == 0x03 && payload[i - 1] == 0 && payload[i - 2] == 0 {
            continue;
        }
        out.push(b);
    }
    out
}

fn parse_first_mb_in_slice(payload: &[u8]) -> Option<u32> {
    if payload.is_empty() {
        return None;
    }
    let rbsp = rbsp_from_nal_payload(payload);
    AnnexbBitReader::new(&rbsp).read_ue()
}

/// Counts access units over one buffer using `scan_annexb_nals` — the SAME NAL
/// span routine the truncate cut path uses. Sharing it is deliberate: the two
/// paths previously derived NAL boundaries independently, and their notions of
/// where a NAL begins differed by one byte on a four-byte start code (this one
/// took `header - 3`, i.e. the three-byte code's position; the cut path backs up
/// over the leading zero). A truncate could then cut at an offset the counter
/// interpreted as a different boundary, so the exact-match guard would compare
/// against a boundary the cut did not respect. One routine, one answer.
fn count_annexb_access_units_in_buffer(buf: &[u8], count: &mut AnnexbFrameCount) {
    for nal in scan_annexb_nals(buf) {
        if nal.nal_type != 1 && nal.nal_type != 5 {
            continue;
        }
        count.vcl_nals += 1;
        if nal.header + 1 >= nal.end {
            continue;
        }
        if parse_first_mb_in_slice(&buf[nal.header + 1..nal.end]) == Some(0) {
            count.pictures += 1;
        }
    }
}

struct AnnexbAccessUnitScanner {
    buffer: Vec<u8>,
    count: AnnexbFrameCount,
}

impl AnnexbAccessUnitScanner {
    fn new() -> Self {
        Self {
            buffer: Vec::new(),
            count: AnnexbFrameCount {
                pictures: 0,
                vcl_nals: 0,
            },
        }
    }

    fn feed(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
        self.drain_complete_nals();
    }

    fn finish(&mut self) {
        if !self.buffer.is_empty() {
            count_annexb_access_units_in_buffer(&self.buffer, &mut self.count);
            self.buffer.clear();
        }
    }

    fn drain_complete_nals(&mut self) {
        let nals = scan_annexb_nals(&self.buffer);
        if nals.len() < 2 {
            if nals.is_empty() {
                compact_buffer_tail_without_start_codes(&mut self.buffer);
            } else if self.buffer.len() > MAX_IN_FLIGHT_NAL_BYTES {
                // Exactly one start code, and its NAL has outgrown the cap:
                // nothing will ever close it from inside this buffer, and the
                // start-code-free compaction above cannot fire while that code
                // is present. Count the NAL now — `first_mb_in_slice` lives in
                // the bytes right after the header, which we already hold — and
                // drop its payload, keeping only enough tail to reassemble a
                // start code split across the next chunk boundary. The dropped
                // payload cannot contain a start code of its own (RBSP escaping
                // forbids `00 00 01` inside a NAL), so no count is lost.
                let buf = std::mem::take(&mut self.buffer);
                count_annexb_access_units_in_buffer(&buf, &mut self.count);
                let keep = ANNEXB_START_CODE_LOOKBACK.min(buf.len());
                self.buffer.extend_from_slice(&buf[buf.len() - keep..]);
            }
            return;
        }
        let last_nal_start = nals[nals.len() - 1].start;
        let process = self.buffer[..last_nal_start].to_vec();
        count_annexb_access_units_in_buffer(&process, &mut self.count);
        self.buffer = self.buffer[last_nal_start..].to_vec();
    }
}

/// In-memory reference implementation, kept as the oracle the streaming
/// scanners are diffed against in tests. Production reads through the
/// streaming path only, so this is test-only by design, not by accident.
#[cfg(test)]
fn count_annexb_access_units(bytes: &[u8]) -> AnnexbFrameCount {
    let mut scanner = AnnexbAccessUnitScanner::new();
    scanner.feed(bytes);
    scanner.finish();
    scanner.count
}

/// Bytes retained when compacting a buffer that contains no start codes so a
/// `00 00 01` / `00 00 00 01` split across chunk boundaries is still found.
const ANNEXB_START_CODE_LOOKBACK: usize = 4;

/// Hard cap on the bytes of a SINGLE in-flight (not yet closed) NAL that either
/// streaming scanner will retain before it force-closes that NAL and drops its
/// payload. Neither scanner needs a NAL's payload body: the count path needs the
/// header byte plus the leading `first_mb_in_slice` Exp-Golomb code, and the cut
/// path needs only `start` / `header` / `nal_type` / `first_mb` offsets. Without
/// this cap a file that ends mid-NAL — the salvage case, a crashed or killed
/// export — is absorbed whole as payload: O(file) memory and a quadratic
/// re-scan. 8 MiB sits far above any real H.264 NAL this app emits (a 4K IDR is
/// ~2 MiB worst case), so a well-formed stream never reaches it; force-closing a
/// legitimately larger NAL is still CORRECT, only slower, because the head that
/// decides everything has already been parsed.
const MAX_IN_FLIGHT_NAL_BYTES: usize = 8 * 1024 * 1024;

fn buffer_contains_start_code(buf: &[u8]) -> bool {
    buf.windows(3).any(|w| w[0] == 0 && w[1] == 0 && w[2] == 1)
}

fn compact_buffer_tail_without_start_codes(buffer: &mut Vec<u8>) {
    if buffer.len() <= IO_CHUNK_SIZE {
        return;
    }
    if buffer_contains_start_code(buffer) {
        return;
    }
    let discard = buffer.len().saturating_sub(ANNEXB_START_CODE_LOOKBACK);
    if discard > 0 {
        buffer.drain(..discard);
    }
}

fn compact_buffer_without_start_codes(buffer: &mut Vec<u8>, base_offset: &mut u64) {
    if buffer.len() <= IO_CHUNK_SIZE {
        return;
    }
    if buffer_contains_start_code(buffer) {
        return;
    }
    let discard = buffer.len().saturating_sub(ANNEXB_START_CODE_LOOKBACK);
    if discard == 0 {
        return;
    }
    *base_offset += discard as u64;
    buffer.drain(..discard);
}

#[derive(Clone, Copy)]
struct ScannedNal {
    start: u64,
    header: u64,
    end: u64,
    nal_type: u8,
    first_mb: Option<u32>,
}

fn scanned_nal_from_span(nal: &AnnexbNalSpan, base_offset: u64, buffer: &[u8]) -> ScannedNal {
    let first_mb = if nal.nal_type == 1 || nal.nal_type == 5 {
        if nal.header + 1 < nal.end {
            parse_first_mb_in_slice(&buffer[nal.header + 1..nal.end])
        } else {
            None
        }
    } else {
        None
    };
    ScannedNal {
        start: base_offset + nal.start as u64,
        header: base_offset + nal.header as u64,
        end: base_offset + nal.end as u64,
        nal_type: nal.nal_type,
        first_mb,
    }
}

struct StreamAnnexbNalScanner {
    buffer: Vec<u8>,
    base_offset: u64,
    nals: Vec<ScannedNal>,
    /// A NAL whose head (start / header / type / `first_mb`) has been parsed but
    /// whose `end` is not yet known, because its payload outgrew
    /// `MAX_IN_FLIGHT_NAL_BYTES` and was dropped. Closed by the next start code,
    /// or by `finish` at end of file. At most one can be outstanding: once the
    /// payload is dropped the buffer holds no start code, so the ordinary
    /// start-code-free compaction keeps it small from then on.
    pending: Option<ScannedNal>,
}

impl StreamAnnexbNalScanner {
    fn new() -> Self {
        Self {
            buffer: Vec::new(),
            base_offset: 0,
            nals: Vec::new(),
            pending: None,
        }
    }

    fn feed(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
        self.drain_complete_nals();
    }

    /// Every emit goes through here so a force-closed NAL always gets its real
    /// `end` — the start offset of whatever NAL follows it.
    fn push_nal(&mut self, nal: ScannedNal) {
        if let Some(mut pending) = self.pending.take() {
            pending.end = nal.start;
            self.nals.push(pending);
        }
        self.nals.push(nal);
    }

    fn finish(&mut self, _file_len: u64) {
        let end_offset = self.base_offset + self.buffer.len() as u64;
        if !self.buffer.is_empty() {
            let nals = scan_annexb_nals(&self.buffer);
            for nal in nals {
                let scanned = scanned_nal_from_span(&nal, self.base_offset, &self.buffer);
                self.push_nal(scanned);
            }
        }
        if let Some(mut pending) = self.pending.take() {
            pending.end = end_offset;
            self.nals.push(pending);
        }
        self.buffer.clear();
    }

    fn drain_complete_nals(&mut self) {
        loop {
            let nals = scan_annexb_nals(&self.buffer);
            if nals.len() < 2 {
                if nals.len() == 1 && self.buffer.len() > MAX_IN_FLIGHT_NAL_BYTES {
                    self.force_close_in_flight_nal(nals[0]);
                    break;
                }
                compact_buffer_without_start_codes(&mut self.buffer, &mut self.base_offset);
                break;
            }
            for nal in &nals[..nals.len() - 1] {
                let scanned = scanned_nal_from_span(nal, self.base_offset, &self.buffer);
                self.push_nal(scanned);
            }
            let keep_from = nals[nals.len() - 1].start;
            self.base_offset += keep_from as u64;
            self.buffer.drain(..keep_from);
        }
    }

    /// Parks the single open NAL's head and discards its payload. The cut
    /// decision reads only `start` / `header` / `nal_type` / `first_mb`, all of
    /// which are already resolved here, so dropping the body loses nothing; the
    /// provisional `end` is corrected by `push_nal`/`finish`. Retains
    /// `ANNEXB_START_CODE_LOOKBACK` trailing bytes so a start code straddling
    /// the next chunk boundary is still detected.
    fn force_close_in_flight_nal(&mut self, span: AnnexbNalSpan) {
        let scanned = scanned_nal_from_span(&span, self.base_offset, &self.buffer);
        if let Some(mut previous) = self.pending.take() {
            previous.end = scanned.start;
            self.nals.push(previous);
        }
        self.pending = Some(scanned);
        let keep = ANNEXB_START_CODE_LOOKBACK.min(self.buffer.len());
        let discard = self.buffer.len() - keep;
        self.base_offset += discard as u64;
        self.buffer.drain(..discard);
    }
}

fn scan_annexb_nals_from_file(
    full: &Path,
    path: &str,
    cancel: Option<&AtomicBool>,
) -> Result<Vec<ScannedNal>, String> {
    use std::io::Read;

    check_cancelled(cancel)?;
    let mut file =
        fs::File::open(full).map_err(|e| format!("scan_annexb_nals({}): open: {}", path, e))?;
    let mut read_buf = vec![0u8; IO_CHUNK_SIZE];
    let mut scanner = StreamAnnexbNalScanner::new();
    loop {
        check_cancelled(cancel)?;
        let n = file
            .read(&mut read_buf)
            .map_err(|e| format!("scan_annexb_nals({}): read: {}", path, e))?;
        if n == 0 {
            break;
        }
        scanner.feed(&read_buf[..n]);
    }
    let file_len = fs::metadata(full)
        .map_err(|e| format!("scan_annexb_nals({}): metadata: {}", path, e))?
        .len();
    scanner.finish(file_len);
    Ok(scanner.nals)
}

struct PictureGroupScanned {
    vcl: Vec<ScannedNal>,
}

fn group_pictures_scanned(nals: &[ScannedNal]) -> Vec<PictureGroupScanned> {
    let mut pictures: Vec<PictureGroupScanned> = Vec::new();
    for nal in nals {
        if nal.nal_type != 1 && nal.nal_type != 5 {
            continue;
        }
        if nal.header + 1 >= nal.end {
            continue;
        }
        if nal.first_mb == Some(0) {
            pictures.push(PictureGroupScanned { vcl: vec![*nal] });
        } else if let Some(last) = pictures.last_mut() {
            last.vcl.push(*nal);
        }
    }
    pictures
}

fn dropped_picture_cut_scanned(
    nals: &[ScannedNal],
    prev_last_vcl: ScannedNal,
    dropped_first_vcl: ScannedNal,
) -> u64 {
    for nal in nals {
        if nal.start <= prev_last_vcl.start {
            continue;
        }
        if nal.start >= dropped_first_vcl.start {
            break;
        }
        if nal.nal_type == 9 {
            return nal.start;
        }
    }
    dropped_first_vcl.start
}

/// A NAL that begins the *next* access unit (or a delimiter after this one):
/// non-VCL (AUD/SPS/PPS/SEI) or a VCL whose `first_mb_in_slice == 0`.
/// Continuation slices (`first_mb != 0`) do not complete the current AU.
fn nal_begins_next_access_unit(nal_type: u8, first_mb: Option<u32>) -> bool {
    if nal_type != 1 && nal_type != 5 {
        return true;
    }
    first_mb == Some(0)
}

/// Salvage-truncate completeness predicate.
///
/// The final access unit is provably complete iff a start code was observed
/// that begins something other than a continuation slice of this picture —
/// a fully-scanned subsequent NAL that is non-VCL, or a VCL with
/// `first_mb_in_slice == 0`. A dangling start code (no header) is not enough:
/// its type is unknown, so the conservative policy drops the AU.
///
/// Exact-offset resume (`truncate_annexb_to_offset_inner`) does not consult
/// this predicate. Cost of a drop: one picture (33.33 ms at 1080p30).
fn scanned_final_au_is_provably_complete(nals: &[ScannedNal], last_vcl: &ScannedNal) -> bool {
    nals.iter().any(|n| {
        n.start >= last_vcl.end && nal_begins_next_access_unit(n.nal_type, n.first_mb)
    })
}

fn compute_truncate_cut_from_scanned(nals: &[ScannedNal], file_len: u64) -> u64 {
    let pictures = group_pictures_scanned(nals);
    if pictures.is_empty() {
        return 0;
    }

    let mut keep_count = pictures.len();
    let last = &pictures[keep_count - 1];
    let last_vcl = last.vcl[last.vcl.len() - 1];
    if !scanned_final_au_is_provably_complete(nals, &last_vcl) {
        keep_count -= 1;
    }

    if keep_count == 0 {
        return 0;
    }

    if keep_count < pictures.len() {
        let dropped = &pictures[keep_count];
        let prev = &pictures[keep_count - 1];
        let prev_last = prev.vcl[prev.vcl.len() - 1];
        dropped_picture_cut_scanned(nals, prev_last, dropped.vcl[0])
    } else {
        nals.last().map(|n| n.end).unwrap_or(file_len).min(file_len)
    }
}

#[derive(Clone, Copy)]
struct AnnexbNalSpan {
    start: usize,
    header: usize,
    end: usize,
    nal_type: u8,
}

fn scan_annexb_nals(bytes: &[u8]) -> Vec<AnnexbNalSpan> {
    let n = bytes.len();
    let mut starts: Vec<(usize, usize)> = Vec::new();
    let mut dangling_start: Option<usize> = None;
    let mut i = 0usize;
    while i + 2 < n {
        if bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 1 {
            let start = if i > 0 && bytes[i - 1] == 0 { i - 1 } else { i };
            let header = i + 3;
            if header >= n {
                dangling_start = Some(start);
                break;
            }
            starts.push((start, header));
            i = header;
        } else {
            i += 1;
        }
    }

    let mut nals = Vec::with_capacity(starts.len());
    for k in 0..starts.len() {
        let (start, header) = starts[k];
        let end = if k + 1 < starts.len() {
            starts[k + 1].0
        } else {
            dangling_start.unwrap_or(n)
        };
        nals.push(AnnexbNalSpan {
            start,
            header,
            end,
            nal_type: bytes[header] & 0x1f,
        });
    }
    nals
}

#[cfg(test)]
fn mode_of(values: &[usize]) -> Option<usize> {
    if values.is_empty() {
        return None;
    }
    let mut best = values[0];
    let mut best_n = 0usize;
    for &v in values {
        let n = values.iter().filter(|x| **x == v).count();
        if n > best_n {
            best = v;
            best_n = n;
        }
    }
    Some(best)
}

/// In-memory helper that MUST go through the production cut so fixture
/// reach includes `scanned_final_au_is_provably_complete`. A twin that
/// reimplemented the predicate (the old `span_final_au_is_provably_complete`)
/// stayed green when production was mutated.
#[cfg(test)]
fn truncate_annexb_to_last_complete_au(bytes: &[u8]) -> (Vec<u8>, AnnexbTruncateResult) {
    let spans = scan_annexb_nals(bytes);
    let scanned: Vec<ScannedNal> = spans
        .iter()
        .map(|n| scanned_nal_from_span(n, 0, bytes))
        .collect();
    let cut = compute_truncate_cut_from_scanned(&scanned, bytes.len() as u64) as usize;
    let cut = cut.min(bytes.len());
    let kept = bytes[..cut].to_vec();
    let measured = count_annexb_access_units(&kept);
    (
        kept,
        AnnexbTruncateResult {
            pictures: measured.pictures,
            vcl_nals: measured.vcl_nals,
            bytes_removed: (bytes.len() - cut) as u64,
            kept_bytes: cut as u64,
        },
    )
}

/// Counts H.264 Annex B access units (pictures) in <session_dir>/<path>,
/// without ever sending the file's bytes to the renderer.
///
/// Replaces the WebCodecs export orchestrator's previous frame-count guard
/// (`exportPipelineWebCodecs.ts`'s `ffmpeg.readFile` + JS scan), which cost
/// ~5s per export pulling the whole concatenated annexb file's bytes across
/// IPC just to count frames. This command reads the file in bounded 64 KB
/// chunks — never the whole file at once — and counts pictures via
/// `first_mb_in_slice == 0` on VCL NALs (types 1/5), matching
/// `annexbFrameCount.ts`. Raw VCL NAL count is returned alongside for
/// diagnostics (multi-slice encoders can inflate VCL count without changing
/// picture count).
#[tauri::command]
pub fn ffmpeg_count_annexb_frames(
    session_id: String,
    path: String,
    state: tauri::State<'_, FfmpegSessionState>,
) -> Result<AnnexbFrameCount, String> {
    validate_path(&path)?;
    ensure_resume_prepared(&state, &session_id, "count_annexb_frames")?;
    let full = session_dir(&session_id)?.join(&path);
    let cancel = session_cancel_flag(&state, &session_id);
    count_annexb_frames_inner(&full, &path, cancel.as_deref())
}

fn count_annexb_frames_inner(
    full: &Path,
    path: &str,
    cancel: Option<&AtomicBool>,
) -> Result<AnnexbFrameCount, String> {
    use std::io::Read;

    check_cancelled(cancel)?;
    let mut file =
        fs::File::open(full).map_err(|e| format!("count_annexb_frames({}): open: {}", path, e))?;

    let mut read_buf = vec![0u8; IO_CHUNK_SIZE];
    let mut scanner = AnnexbAccessUnitScanner::new();

    loop {
        check_cancelled(cancel)?;
        let n = file
            .read(&mut read_buf)
            .map_err(|e| format!("count_annexb_frames({}): read: {}", path, e))?;
        if n == 0 {
            break;
        }
        scanner.feed(&read_buf[..n]);
    }

    check_cancelled(cancel)?;
    scanner.finish();
    Ok(scanner.count)
}

/// Finds the final Annex-B start code by reading backwards in bounded chunks.
/// This is deliberately independent of the forward AU scanner: checkpoint
/// recovery first inspects whether the crash left a dangling start code/header,
/// then the canonical scanner decides the last whole-AU cut.
fn inspect_annexb_tail_backwards(full: &Path, path: &str) -> Result<(Option<u64>, bool), String> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file =
        fs::File::open(full).map_err(|e| format!("inspect_annexb_tail({}): open: {}", path, e))?;
    let file_len = file
        .metadata()
        .map_err(|e| format!("inspect_annexb_tail({}): metadata: {}", path, e))?
        .len();
    let mut end = file_len;
    while end > 0 {
        let start = end.saturating_sub(IO_CHUNK_SIZE as u64);
        let overlap_start = start.saturating_sub(3);
        let read_len = (end - overlap_start) as usize;
        let mut buf = vec![0u8; read_len];
        file.seek(SeekFrom::Start(overlap_start))
            .map_err(|e| format!("inspect_annexb_tail({}): seek: {}", path, e))?;
        file.read_exact(&mut buf)
            .map_err(|e| format!("inspect_annexb_tail({}): read: {}", path, e))?;
        if buf.len() >= 3 {
            for i in (0..=buf.len() - 3).rev() {
                if buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 1 {
                    let three_byte_start = overlap_start + i as u64;
                    let start_code = if i > 0 && buf[i - 1] == 0 {
                        three_byte_start - 1
                    } else {
                        three_byte_start
                    };
                    let header = three_byte_start + 3;
                    return Ok((Some(start_code), header < file_len));
                }
            }
        }
        if start == 0 {
            break;
        }
        end = start;
    }
    Ok((None, false))
}

/// Truncates `<session_dir>/<path>` at the last complete Annex-B access unit.
/// Single forward pass over the file (bounded lookback buffer), then in-place
/// `set_len` — never materializes the whole file in memory.
#[tauri::command]
pub fn ffmpeg_truncate_annexb(
    session_id: String,
    path: String,
    state: tauri::State<'_, FfmpegSessionState>,
) -> Result<AnnexbTruncateResult, String> {
    validate_path(&path)?;
    let full = session_dir(&session_id)?.join(&path);
    let cancel = session_cancel_flag(&state, &session_id);
    truncate_annexb_inner(&full, &path, cancel.as_deref())
}

/// Truncates `<session_dir>/<path>` to an exact caller-supplied byte length
/// via in-place `set_len`, then returns the picture count on the kept prefix
/// so the caller can verify the seam against a checkpoint.
#[tauri::command]
pub fn ffmpeg_truncate_annexb_to_offset(
    session_id: String,
    path: String,
    byte_offset: u64,
    state: tauri::State<'_, FfmpegSessionState>,
) -> Result<AnnexbTruncateResult, String> {
    validate_path(&path)?;
    let full = session_dir(&session_id)?.join(&path);
    let cancel = session_cancel_flag(&state, &session_id);
    truncate_annexb_to_offset_inner(&full, &path, byte_offset, cancel.as_deref())
}

fn truncate_annexb_inner(
    full: &Path,
    path: &str,
    cancel: Option<&AtomicBool>,
) -> Result<AnnexbTruncateResult, String> {
    check_cancelled(cancel)?;
    let file_len = fs::metadata(full)
        .map_err(|e| format!("truncate_annexb({}): metadata: {}", path, e))?
        .len();
    let nals = scan_annexb_nals_from_file(full, path, cancel)?;
    check_cancelled(cancel)?;
    let cut = compute_truncate_cut_from_scanned(&nals, file_len);
    if cut < file_len {
        let file = fs::OpenOptions::new()
            .write(true)
            .open(full)
            .map_err(|e| format!("truncate_annexb({}): open: {}", path, e))?;
        file.set_len(cut)
            .map_err(|e| format!("truncate_annexb({}): set_len({}): {}", path, cut, e))?;
    }
    check_cancelled(cancel)?;
    let measured = count_annexb_frames_inner(full, path, cancel)?;
    Ok(AnnexbTruncateResult {
        pictures: measured.pictures,
        vcl_nals: measured.vcl_nals,
        bytes_removed: file_len.saturating_sub(cut),
        kept_bytes: cut,
    })
}

fn truncate_annexb_to_offset_inner(
    full: &Path,
    path: &str,
    byte_offset: u64,
    cancel: Option<&AtomicBool>,
) -> Result<AnnexbTruncateResult, String> {
    check_cancelled(cancel)?;
    let file_len = fs::metadata(full)
        .map_err(|e| format!("truncate_annexb_to_offset({}): metadata: {}", path, e))?
        .len();
    if byte_offset > file_len {
        return Err(format!(
            "truncate_annexb_to_offset({}): offset {} exceeds file length {}",
            path, byte_offset, file_len
        ));
    }
    if byte_offset < file_len {
        let file = fs::OpenOptions::new()
            .write(true)
            .open(full)
            .map_err(|e| format!("truncate_annexb_to_offset({}): open: {}", path, e))?;
        file.set_len(byte_offset).map_err(|e| {
            format!(
                "truncate_annexb_to_offset({}): set_len({}): {}",
                path, byte_offset, e
            )
        })?;
    }
    check_cancelled(cancel)?;
    let measured = count_annexb_frames_inner(full, path, cancel)?;
    Ok(AnnexbTruncateResult {
        pictures: measured.pictures,
        vcl_nals: measured.vcl_nals,
        bytes_removed: file_len.saturating_sub(byte_offset),
        kept_bytes: byte_offset,
    })
}

/// Atomically prepares a crash-surviving file for checkpoint resume.
///
/// Order is load-bearing:
/// 1. inspect the tail backwards;
/// 2. run the canonical whole-AU truncate unconditionally;
/// 3. truncate to the authoritative checkpoint byte offset;
/// 4. run the canonical truncate again and require a no-op;
/// 5. require the canonical picture count to equal the checkpoint;
/// 6. only then open append/count/concat for this resumed session.
#[tauri::command]
pub fn ffmpeg_prepare_checkpoint_resume(
    session_id: String,
    path: String,
    byte_offset: u64,
    cumulative_pictures: u64,
    piece_index: u64,
    encoder_session_index: u64,
    state: tauri::State<'_, FfmpegSessionState>,
) -> Result<CheckpointResumeResult, String> {
    validate_path(&path)?;
    if !state.resume_pending.lock().unwrap().contains(&session_id) {
        return Err(format!(
            "prepare_checkpoint_resume: session {session_id} is not pending resume"
        ));
    }
    let full = session_dir(&session_id)?.join(&path);
    let cancel = session_cancel_flag(&state, &session_id);
    let result = prepare_checkpoint_resume_inner(
        &full,
        &path,
        byte_offset,
        cumulative_pictures,
        piece_index,
        encoder_session_index,
        cancel.as_deref(),
    )?;
    state.resume_pending.lock().unwrap().remove(&session_id);
    Ok(result)
}

fn prepare_checkpoint_resume_inner(
    full: &Path,
    path: &str,
    byte_offset: u64,
    cumulative_pictures: u64,
    piece_index: u64,
    encoder_session_index: u64,
    cancel: Option<&AtomicBool>,
) -> Result<CheckpointResumeResult, String> {
    let original_len = fs::metadata(&full)
        .map_err(|e| format!("prepare_checkpoint_resume({}): metadata: {}", path, e))?
        .len();
    let (last_nal_start, trailing_nal_had_header) = inspect_annexb_tail_backwards(&full, &path)?;

    let inferred = truncate_annexb_inner(full, path, cancel)?;
    if inferred.kept_bytes < byte_offset {
        return Err(format!(
            "prepare_checkpoint_resume(piece={piece_index}, encoderSession={encoder_session_index}): \
             canonical AU repair kept {} bytes, before checkpoint offset {}",
            inferred.kept_bytes, byte_offset
        ));
    }

    let exact = truncate_annexb_to_offset_inner(full, path, byte_offset, cancel)?;
    let boundary_check = truncate_annexb_inner(full, path, cancel)?;
    if boundary_check.bytes_removed != 0 || boundary_check.kept_bytes != byte_offset {
        return Err(format!(
            "prepare_checkpoint_resume(piece={piece_index}, encoderSession={encoder_session_index}): \
             checkpoint offset {byte_offset} is not a canonical whole-AU boundary"
        ));
    }
    if boundary_check.pictures != cumulative_pictures {
        return Err(format!(
            "prepare_checkpoint_resume(piece={piece_index}, encoderSession={encoder_session_index}): \
             checkpoint pictures {} != canonical pictures {}",
            cumulative_pictures, boundary_check.pictures
        ));
    }

    Ok(CheckpointResumeResult {
        pictures: exact.pictures,
        vcl_nals: exact.vcl_nals,
        bytes_removed: original_len.saturating_sub(byte_offset),
        kept_bytes: exact.kept_bytes,
        last_nal_start,
        trailing_nal_had_header,
        tail_was_whole_au: inferred.bytes_removed == 0,
    })
}

/// Stream-concatenates a list of AnnexB H.264 piece files (in order) into a
/// single `output_path`, keeping only TWO file descriptors open at any instant
/// (one read, one write) — independent of piece count.
///
/// Replaces the WebCodecs export orchestrator's previous ffmpeg concat-protocol
/// pipe-list (`ffmpeg -i "concat:piece_0.h264|piece_1.h264|..."`), which opens
/// EVERY input simultaneously. On macOS the default per-process soft
/// file-descriptor limit (`ulimit -n`) is 256, so a large-segment export (each
/// non-GL segment becomes its own `piece_NN.h264`) blows past it partway through
/// the open phase — reproduced as `ffmpeg exited with code 232: Too many open
/// files` on a 407-segment project. Windows has no fixed per-process FD cap, so
/// it never surfaced there; this helper is OS-independent by construction.
///
/// Raw byte concatenation of AnnexB streams is spec-valid: every NAL unit is
/// start-code-prefixed (`00 00 01` / `00 00 00 01`), so appending one stream's
/// bytes after another's needs no container/framing rewrite. This helper is
/// therefore deliberately NOT AnnexB-aware — it does no NAL parsing (that is
/// `ffmpeg_count_annexb_frames`'s job, used by the orchestrator's post-concat
/// frame-count guard to prove the result is byte-correct). Uses a fixed 64 KB
/// copy buffer, matching `ffmpeg_count_annexb_frames`'s chunk size.
///
/// `output_path` is truncated/created. Every piece path (and the output path)
/// is `validate_path`-checked up front, before the output is opened, so a bad
/// path can never truncate an existing output. On ANY error (a missing or
/// unreadable piece, a write failure), the partial `output_path` is removed
/// before returning `Err` — a failed concat never leaves a half-written file
/// behind for a later step to mistake for a complete one.
#[tauri::command]
pub fn ffmpeg_concat_annexb_pieces(
    session_id: String,
    piece_paths: Vec<String>,
    output_path: String,
    state: tauri::State<'_, FfmpegSessionState>,
) -> Result<(), String> {
    validate_path(&output_path)?;
    for piece in &piece_paths {
        validate_path(piece)?;
    }
    ensure_resume_prepared(&state, &session_id, "concat_annexb_pieces")?;

    let dir = session_dir(&session_id)?;
    let out_full = dir.join(&output_path);
    let cancel = session_cancel_flag(&state, &session_id);

    let result = concat_annexb_pieces_inner(&dir, &piece_paths, &out_full, cancel.as_deref());
    if result.is_err() {
        // Don't leave a partial/corrupt output behind on failure. The write
        // handle inside `concat_annexb_pieces_inner` has already been dropped
        // (closed) by the time it returns, so this remove is safe.
        let _ = fs::remove_file(&out_full);
    }
    result
}

fn concat_annexb_pieces_inner(
    dir: &Path,
    piece_paths: &[String],
    out_full: &Path,
    cancel: Option<&AtomicBool>,
) -> Result<(), String> {
    use std::io::{Read, Write};

    check_cancelled(cancel)?;
    let mut out = fs::File::create(out_full)
        .map_err(|e| format!("concat_annexb_pieces: create output: {}", e))?;

    let mut buf = vec![0u8; IO_CHUNK_SIZE];

    for piece in piece_paths {
        check_cancelled(cancel)?;
        let piece_full = dir.join(piece);
        let mut input = fs::File::open(&piece_full)
            .map_err(|e| format!("concat_annexb_pieces: open piece({}): {}", piece, e))?;
        loop {
            check_cancelled(cancel)?;
            let n = input
                .read(&mut buf)
                .map_err(|e| format!("concat_annexb_pieces: read piece({}): {}", piece, e))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])
                .map_err(|e| format!("concat_annexb_pieces: write output: {}", e))?;
        }
    }

    check_cancelled(cancel)?;
    out.flush()
        .map_err(|e| format!("concat_annexb_pieces: flush output: {}", e))?;
    Ok(())
}

/// Deletes <session_dir>/<path>. Missing file is treated as success.
#[tauri::command]
pub fn ffmpeg_delete_file(session_id: String, path: String) -> Result<(), String> {
    validate_path(&path)?;
    let full = session_dir(&session_id)?.join(&path);
    match fs::remove_file(&full) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete_file({}): {}", path, e)),
    }
}

/// Runs the bundled ffmpeg sidecar with `args`, using the session directory as cwd.
///
/// Returns the exit code on success (0 for clean ffmpeg runs). On non-zero
/// exit, returns Err containing the tail of ffmpeg's stderr output so the
/// frontend can surface a useful error message.
///
/// Note: ffmpeg writes progress and encoding info to stderr even on success.
/// We only surface stderr when the exit code is non-zero.
///
/// Uses the Tauri sidecar API (tauri-plugin-shell) so the binary runs from
/// inside the app bundle — no PATH dependency required. Phase 6.5.
///
/// D13 fix — uses `spawn()` instead of `output()` so the child's `CommandChild`
/// handle can be stored in `FfmpegProcessState` for the duration of the run,
/// making it killable via `ffmpeg_kill_session` (the frontend's export-cancel
/// path). Stdout is discarded (as `output()` effectively was for our purposes —
/// only stderr was ever read); stderr is collected the same way for the same
/// error-tail reporting.
#[tauri::command]
pub async fn ffmpeg_exec(
    app: tauri::AppHandle,
    session_id: String,
    args: Vec<String>,
    state: tauri::State<'_, FfmpegSessionState>,
) -> Result<i32, String> {
    let cwd = session_dir(&session_id)?;

    let (mut rx, child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar error: {e}"))?
        .args(&args)
        .current_dir(&cwd)
        .spawn()
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    state
        .children
        .lock()
        .unwrap()
        .insert(session_id.clone(), child);

    let mut code: Option<i32> = None;
    let mut stderr: Vec<u8> = Vec::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Terminated(payload) => code = payload.code,
            CommandEvent::Stderr(line) => {
                stderr.extend(line);
                stderr.push(b'\n');
            }
            CommandEvent::Stdout(_) | CommandEvent::Error(_) => {}
            _ => {}
        }
    }

    // Already removed by ffmpeg_kill_session if this run was cancelled — a normal
    // completion removes it here instead.
    state.children.lock().unwrap().remove(&session_id);

    let exit_code = code.unwrap_or(-1);

    if exit_code != 0 {
        let stderr_str = String::from_utf8_lossy(&stderr);
        // Truncate to last 2000 chars to avoid pathologically large error payloads.
        let tail = if stderr_str.len() > 2000 {
            format!("...{}", &stderr_str[stderr_str.len() - 2000..])
        } else {
            stderr_str.to_string()
        };
        return Err(format!("ffmpeg exited with code {}: {}", exit_code, tail));
    }

    Ok(exit_code)
}

/// Kills the in-flight ffmpeg subprocess for `session_id`, if one is currently
/// running (D13 fix). A no-op — not an error — when nothing is running for that
/// session, which covers both "the export already finished" and "cancel raced
/// ahead of the first ffmpeg_exec call" without the caller needing to know which.
///
/// Called from the frontend's export-cancel path BEFORE `ffmpeg_destroy_session`
/// deletes the session temp dir, so the sidecar is no longer writing into a
/// directory that's about to disappear out from under it.
#[tauri::command]
pub fn ffmpeg_kill_session(
    session_id: String,
    state: tauri::State<'_, FfmpegSessionState>,
) -> Result<(), String> {
    set_session_cancelled(&state, &session_id);
    if let Some(child) = state.children.lock().unwrap().remove(&session_id) {
        child
            .kill()
            .map_err(|e| format!("kill_session({}): {}", session_id, e))?;
    }
    Ok(())
}

/// Deletes the entire session directory and all its contents.
///
/// Should be called after the export completes (success or failure) to
/// reclaim disk space. Best-effort: if the directory is already gone, no error.
#[tauri::command]
pub fn ffmpeg_destroy_session(
    session_id: String,
    state: tauri::State<'_, FfmpegSessionState>,
) -> Result<(), String> {
    state.cancel_flags.lock().unwrap().remove(&session_id);
    state.resume_pending.lock().unwrap().remove(&session_id);
    let dir = session_dir(&session_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("destroy_session: {}", e))?;
    }
    Ok(())
}

/// Opens a native OS save-file dialog and returns the chosen path without
/// writing anything. `default_name` is the suggested filename; `default_dir`
/// (if provided) opens the dialog in that directory — used to remember the
/// last export location.
///
/// Returns `Some(path)` or `None` if the user cancelled.
#[tauri::command]
pub async fn pick_save_path(
    default_name: String,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("Save Export As")
        .set_file_name(&default_name)
        .add_filter("MP4 Video", &["mp4"]);

    if let Some(dir) = default_dir {
        dialog = dialog.set_directory(&dir);
    }

    let handle = dialog.save_file().await;
    Ok(handle.map(|p| p.path().to_string_lossy().into_owned()))
}

/// Copies a finished file from a session directory straight to a user-chosen
/// destination path, WITHOUT reading its bytes into a `Vec<u8>` for IPC.
///
/// This is the export save path. The old path read the final MP4 back through
/// `ffmpeg_read_file` (`Vec<u8>` → JSON `number[]`, ~8× the file size in the
/// WebView heap) and then re-serialized it via Blob → arrayBuffer → base64 →
/// `save_bytes_to_disk` — a 5–6× memory pile-up that tripped WebView2's OOM guard
/// (STATUS_BREAKPOINT) on large exports. Copying natively keeps the bytes out of
/// the renderer entirely.
///
/// `file_name` is validated as a session-local filename (same rules as the other
/// session commands); `dest_path` is the absolute path returned by
/// `pick_save_path`. Uses `fs::copy` (not `rename`) so it works when `$TMPDIR`
/// and the destination live on different volumes (common on Windows). The source
/// is left in place for `ffmpeg_destroy_session` to reclaim.
#[tauri::command]
pub fn save_session_file(
    session_id: String,
    file_name: String,
    dest_path: String,
) -> Result<(), String> {
    validate_path(&file_name)?;
    let src = session_dir(&session_id)?.join(&file_name);
    fs::copy(&src, &dest_path)
        .map_err(|e| format!("save_session_file({} -> {}): {}", file_name, dest_path, e))?;
    Ok(())
}

/// Extracts duration in seconds from ffmpeg's stderr `Duration: HH:MM:SS.ss`
/// line. Returns None if the line is absent or unparseable (e.g. `Duration: N/A`
/// for a stream with no known length) — callers surface a real error rather than
/// synthesizing a fake duration.
fn parse_ffmpeg_duration(stderr: &str) -> Option<f64> {
    let idx = stderr.find("Duration:")?;
    let after = &stderr[idx + "Duration:".len()..];
    // "Duration: 00:01:23.45, start: ..." → take the "00:01:23.45" token.
    let ts = after.trim_start().split(',').next()?.trim();
    let parts: Vec<&str> = ts.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].trim().parse().ok()?;
    let m: f64 = parts[1].trim().parse().ok()?;
    let s: f64 = parts[2].trim().parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Runs `ffmpeg -i <input>` (no output file) purely to read the container header;
/// ffmpeg exits non-zero in this mode but prints `Duration:` to stderr, which we
/// parse. The bundled build ships ffmpeg only (no separate ffprobe binary), so
/// this is the portable way to probe duration through the same sidecar.
async fn ffmpeg_probe_duration_secs(
    app: &tauri::AppHandle,
    input: &std::path::Path,
) -> Result<f64, String> {
    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar lookup: {e}"))?
        .args(["-hide_banner", "-i", input.to_str().unwrap_or("")])
        .output()
        .await
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_ffmpeg_duration(&stderr)
        .ok_or_else(|| "could not determine audio duration from ffmpeg output".to_string())
}

/// Probes an audio file's duration (seconds) via the bundled ffmpeg binary.
///
/// Replaces the old WebView `<audio>`-element probe on the frontend, which was
/// codec-dependent (OGG silently failed on macOS WKWebView) and fell back to a
/// hardcoded 60 s. This path is codec-independent (ffmpeg reads virtually
/// anything) and returns a hard error on failure — no fake duration.
///
/// `audio_b64` is the base64-encoded upload (same scheme as `ffmpeg_write_file`).
#[tauri::command]
pub async fn probe_audio_duration(app: tauri::AppHandle, audio_b64: String) -> Result<f64, String> {
    let bytes = STANDARD
        .decode(&audio_b64)
        .map_err(|e| format!("probe_audio_duration: base64 decode failed: {e}"))?;

    let tmp_id = Uuid::new_v4().to_string();
    let tmp_dir = std::env::temp_dir().join(format!("kinetix-probe-{}", tmp_id));
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("probe: create temp dir: {e}"))?;
    let input = tmp_dir.join("probe_input");
    if let Err(e) = fs::write(&input, &bytes) {
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err(format!("probe: write input: {e}"));
    }

    let result = ffmpeg_probe_duration_secs(&app, &input).await;
    let _ = fs::remove_dir_all(&tmp_dir);
    result
}

/// Extracts the video frame rate from ffmpeg's stderr. ffmpeg prints the
/// video stream's frame rate inline in its stream-info line, e.g.:
///   `Stream #0:0(und): Video: h264 ..., 1920x1080, 29.97 fps, 30 tbr, ...`
/// This parses the numeric token immediately preceding the first standalone
/// " fps" occurrence. Returns None if absent/unparseable (e.g. an audio-only
/// file, or a container ffmpeg can't identify a video stream in).
fn parse_ffmpeg_fps(stderr: &str) -> Option<f64> {
    let idx = stderr.find(" fps")?;
    let before = stderr[..idx].trim_end();
    let start = before
        .rfind(|c: char| !(c.is_ascii_digit() || c == '.'))
        .map(|p| p + 1)
        .unwrap_or(0);
    let token = &before[start..];
    let fps: f64 = token.parse().ok()?;
    if fps > 0.0 {
        Some(fps)
    } else {
        None
    }
}

/// Runs `ffmpeg -i <input>` (no output file) purely to read the container header;
/// ffmpeg exits non-zero in this mode but prints the video stream's frame rate
/// to stderr, which we parse. Mirrors `ffmpeg_probe_duration_secs`.
async fn ffmpeg_probe_fps(app: &tauri::AppHandle, input: &std::path::Path) -> Result<f64, String> {
    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar lookup: {e}"))?
        .args(["-hide_banner", "-i", input.to_str().unwrap_or("")])
        .output()
        .await
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_ffmpeg_fps(&stderr)
        .ok_or_else(|| "could not determine video frame rate from ffmpeg output".to_string())
}

/// Probes a video file's native frame rate via the bundled ffmpeg binary.
///
/// Used at asset stage/import time to auto-suggest a matching `exportFps`
/// (see the judder audit: export previously resampled every video to a fixed
/// fps with no knowledge of the source's native rate, at times causing frame
/// duplication/drop judder). This probe only informs that UI suggestion — it
/// never feeds into per-segment retiming.
///
/// `video_b64` is the base64-encoded upload (same scheme as `ffmpeg_write_file`).
#[tauri::command]
pub async fn probe_video_fps(app: tauri::AppHandle, video_b64: String) -> Result<f64, String> {
    let bytes = STANDARD
        .decode(&video_b64)
        .map_err(|e| format!("probe_video_fps: base64 decode failed: {e}"))?;

    let tmp_id = Uuid::new_v4().to_string();
    let tmp_dir = std::env::temp_dir().join(format!("kinetix-probe-{}", tmp_id));
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("probe: create temp dir: {e}"))?;
    let input = tmp_dir.join("probe_input");
    if let Err(e) = fs::write(&input, &bytes) {
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err(format!("probe: write input: {e}"));
    }

    let result = ffmpeg_probe_fps(&app, &input).await;
    let _ = fs::remove_dir_all(&tmp_dir);
    result
}

/// Opens the file manager (Finder on macOS, Explorer on Windows) with the
/// specified file selected. Used for the "Show in Finder" button after a
/// successful export. Fire-and-forget: the OS handler runs asynchronously.
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;
    use std::thread;
    use std::time::Duration;

    /// Creates a real session directory (matching `session_dir`'s layout) for
    /// inner-function tests that do not need a Tauri `State` handle.
    fn make_session() -> (String, PathBuf) {
        let id = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("kinetix-export-{}", id));
        fs::create_dir_all(&dir).unwrap();
        (id, dir)
    }

    fn write_large_piece(dir: &Path, name: &str, total_bytes: usize) -> Vec<u8> {
        let chunk: Vec<u8> = (0..IO_CHUNK_SIZE).map(|i| (i % 251) as u8).collect();
        let mut out = Vec::with_capacity(total_bytes);
        while out.len() < total_bytes {
            let take = (total_bytes - out.len()).min(chunk.len());
            out.extend_from_slice(&chunk[..take]);
        }
        fs::write(dir.join(name), &out).unwrap();
        out
    }

    #[test]
    fn concat_annexb_pieces_produces_exact_byte_concatenation() {
        let (_id, dir) = make_session();
        fs::write(dir.join("piece_0.h264"), [0u8, 1, 2, 3]).unwrap();
        fs::write(dir.join("piece_1.h264"), [4u8, 5]).unwrap();
        fs::write(dir.join("piece_2.h264"), [6u8, 7, 8, 9, 10]).unwrap();

        let result = concat_annexb_pieces_inner(
            &dir,
            &[
                "piece_0.h264".to_string(),
                "piece_1.h264".to_string(),
                "piece_2.h264".to_string(),
            ],
            &dir.join("video_all.h264"),
            None,
        );
        assert!(result.is_ok(), "concat should succeed: {:?}", result);

        let out = fs::read(dir.join("video_all.h264")).unwrap();
        assert_eq!(out, vec![0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn concat_annexb_pieces_handles_larger_than_chunk_input() {
        let (_id, dir) = make_session();
        let big: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(dir.join("piece_0.h264"), &big).unwrap();
        fs::write(dir.join("piece_1.h264"), [42u8, 43, 44]).unwrap();

        let result = concat_annexb_pieces_inner(
            &dir,
            &["piece_0.h264".to_string(), "piece_1.h264".to_string()],
            &dir.join("video_all.h264"),
            None,
        );
        assert!(result.is_ok(), "concat should succeed: {:?}", result);

        let out = fs::read(dir.join("video_all.h264")).unwrap();
        let mut expected = big.clone();
        expected.extend_from_slice(&[42u8, 43, 44]);
        assert_eq!(out, expected);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn concat_annexb_pieces_missing_piece_errors() {
        let (_id, dir) = make_session();
        fs::write(dir.join("piece_0.h264"), [10u8, 11, 12]).unwrap();
        let out_full = dir.join("video_all.h264");
        let result = concat_annexb_pieces_inner(
            &dir,
            &["piece_0.h264".to_string(), "piece_1.h264".to_string()],
            &out_full,
            None,
        );
        assert!(result.is_err(), "expected Err for a missing piece");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn concat_annexb_pieces_rejects_traversal_paths_via_validate_path() {
        assert!(validate_path("../escape.h264").is_err());
    }

    #[test]
    fn native_concat_count_truncate_return_cancelled_when_flag_preset() {
        let (_id, dir) = make_session();
        write_large_piece(&dir, "piece_0.h264", 2 * IO_CHUNK_SIZE);
        fs::write(dir.join("scan.h264"), build_multi_slice_stream(2, 4)).unwrap();
        let stream = build_multi_slice_stream(3, 4);
        fs::write(dir.join("piece.h264"), &stream).unwrap();
        let cancel = AtomicBool::new(true);

        assert_eq!(
            concat_annexb_pieces_inner(
                &dir,
                &["piece_0.h264".to_string()],
                &dir.join("out.h264"),
                Some(&cancel),
            ),
            Err("cancelled".to_string())
        );
        assert_eq!(
            count_annexb_frames_inner(&dir.join("scan.h264"), "scan.h264", Some(&cancel)),
            Err("cancelled".to_string())
        );
        assert_eq!(
            truncate_annexb_inner(&dir.join("piece.h264"), "piece.h264", Some(&cancel)),
            Err("cancelled".to_string())
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn concat_stops_mid_copy_when_cancel_flag_is_set() {
        let (_id, dir) = make_session();
        // ~128 MB per piece so the copy loop runs long enough to cancel mid-flight.
        write_large_piece(&dir, "piece_0.h264", 2048 * IO_CHUNK_SIZE);
        write_large_piece(&dir, "piece_1.h264", 2048 * IO_CHUNK_SIZE);
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_worker = cancel.clone();
        let dir_worker = dir.clone();
        let out_full = dir.join("video_all.h264");
        let out_worker = out_full.clone();

        let handle = thread::spawn(move || {
            concat_annexb_pieces_inner(
                &dir_worker,
                &["piece_0.h264".to_string(), "piece_1.h264".to_string()],
                &out_worker,
                Some(cancel_worker.as_ref()),
            )
        });

        loop {
            if out_full.exists() {
                let len = fs::metadata(&out_full).map(|m| m.len()).unwrap_or(0);
                if len >= IO_CHUNK_SIZE as u64 {
                    cancel.store(true, Ordering::SeqCst);
                    break;
                }
            }
            if handle.is_finished() {
                break;
            }
            thread::sleep(Duration::from_millis(1));
        }
        let result = handle.join().unwrap();
        assert_eq!(result, Err("cancelled".to_string()));

        let size_after_cancel = fs::metadata(&out_full).unwrap().len();
        thread::sleep(Duration::from_millis(50));
        assert_eq!(
            fs::metadata(&out_full).unwrap().len(),
            size_after_cancel,
            "concat must stop writing after cancel"
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn count_stops_mid_scan_when_cancel_flag_is_set() {
        let (_id, dir) = make_session();
        write_large_piece(&dir, "scan.h264", 2048 * IO_CHUNK_SIZE);
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_worker = cancel.clone();
        let full = dir.join("scan.h264");

        let handle = thread::spawn(move || {
            count_annexb_frames_inner(&full, "scan.h264", Some(cancel_worker.as_ref()))
        });

        thread::sleep(Duration::from_millis(10));
        cancel.store(true, Ordering::SeqCst);
        let result = handle.join().unwrap();
        assert_eq!(result, Err("cancelled".to_string()));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn kill_session_sets_cancel_flag_for_native_commands() {
        let state = FfmpegSessionState::default();
        let id = Uuid::new_v4().to_string();
        register_session_cancel_flag(&state, &id);
        let flag = session_cancel_flag(&state, &id).unwrap();
        assert!(!flag.load(Ordering::Relaxed));
        set_session_cancelled(&state, &id);
        assert!(flag.load(Ordering::Relaxed));
    }

    #[test]
    fn salvage_interleaving_cancel_then_truncate_leaves_stable_file() {
        let (_id, dir) = make_session();
        let stream = build_multi_slice_stream(6, 8);
        let vcls = vcl_nals(&stream);
        let slice5 = vcls[2 * 8 + 5];
        let partial = stream[..slice5.header + 2].to_vec();
        fs::write(dir.join("video_all.h264"), &partial).unwrap();
        let size_before = fs::metadata(dir.join("video_all.h264")).unwrap().len();

        write_large_piece(&dir, "piece_tail.h264", 2048 * IO_CHUNK_SIZE);
        let cancel = AtomicBool::new(true);
        let out_full = dir.join("video_all.h264");

        // Simulates bound expiry: kill set the flag before salvage truncate runs.
        let concat_result = concat_annexb_pieces_inner(
            &dir,
            &["piece_tail.h264".to_string()],
            &out_full,
            Some(&cancel),
        );
        assert_eq!(concat_result, Err("cancelled".to_string()));
        assert_eq!(
            fs::metadata(&out_full).unwrap().len(),
            size_before,
            "cancelled concat must not append orphan bytes"
        );

        let truncate_result = truncate_annexb_inner(&out_full, "video_all.h264", None).unwrap();
        assert_eq!(truncate_result.pictures, 2);

        let size_after_truncate = fs::metadata(&out_full).unwrap().len();
        thread::sleep(Duration::from_millis(20));
        assert_eq!(
            fs::metadata(&out_full).unwrap().len(),
            size_after_truncate,
            "file stable after truncate — no orphan writer"
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    fn write_start_code(out: &mut Vec<u8>) {
        out.extend_from_slice(&[0, 0, 0, 1]);
    }

    fn write_ue(out_bits: &mut Vec<u8>, value: u32) {
        let mut tmp = value + 1;
        let mut bits = 0u32;
        while tmp > 1 {
            bits += 1;
            tmp >>= 1;
        }
        for _ in 0..bits {
            out_bits.push(0);
        }
        out_bits.push(1);
        for i in (0..bits).rev() {
            out_bits.push(((value >> i) & 1) as u8);
        }
    }

    fn bits_to_rbsp_bytes(bits: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for chunk in bits.chunks(8) {
            let mut byte = 0u8;
            for (b, &bit) in chunk.iter().enumerate() {
                byte |= bit << (7 - b);
            }
            bytes.push(byte);
        }
        bytes
    }

    fn write_nal(out: &mut Vec<u8>, nal_type: u8, rbsp: &[u8]) {
        write_start_code(out);
        out.push((2 << 5) | (nal_type & 0x1f));
        out.extend_from_slice(rbsp);
    }

    fn write_slice_nal(out: &mut Vec<u8>, idr: bool, first_mb: u32) {
        let mut bits = Vec::new();
        write_ue(&mut bits, first_mb);
        write_ue(&mut bits, if idr { 7 } else { 5 });
        write_nal(out, if idr { 5 } else { 1 }, &bits_to_rbsp_bytes(&bits));
    }

    fn build_multi_slice_stream(pictures: usize, slices_per_picture: usize) -> Vec<u8> {
        let mut out = Vec::new();
        write_nal(&mut out, 7, &[0x42, 0x00, 0x1e]);
        write_nal(&mut out, 8, &[0x68, 0xce]);
        for p in 0..pictures {
            write_nal(&mut out, 9, &[0xf0]);
            write_nal(&mut out, 6, &[0x05, 0xde, 0xad]);
            for s in 0..slices_per_picture {
                write_slice_nal(
                    &mut out,
                    p == 0 && s == 0,
                    if s == 0 { 0 } else { 100 + s as u32 },
                );
            }
            write_nal(&mut out, 7, &[0x42, 0x00, 0x1e, (p as u8) & 0xff]);
            write_nal(&mut out, 8, &[0x68, 0xce, (p as u8) & 0xff]);
        }
        out
    }

    fn build_synthetic_single_slice_with_param_sets(pictures: usize) -> Vec<u8> {
        let mut out = Vec::new();
        for p in 0..pictures {
            write_nal(&mut out, 7, &[0x42, 0x00, 0x1e, (p as u8) & 0xff]);
            write_nal(&mut out, 8, &[0x68, 0xce, (p as u8) & 0xff]);
            write_nal(&mut out, 9, &[0xf0]);
            write_nal(&mut out, 6, &[0x05, 0xbe, 0xef]);
            write_slice_nal(&mut out, p == 0, 0);
        }
        out
    }

    /// Single-slice pictures with a large payload (~33 KB) and a trailing AUD
    /// after every picture so a clean file's final AU is provably complete.
    fn write_slice_nal_with_payload(out: &mut Vec<u8>, idr: bool, first_mb: u32, extra: usize) {
        let mut bits = Vec::new();
        write_ue(&mut bits, first_mb);
        write_ue(&mut bits, if idr { 7 } else { 5 });
        let mut rbsp = bits_to_rbsp_bytes(&bits);
        // 0xAB never forms a start code; this is payload, not 0xFF padding of a file.
        rbsp.extend(std::iter::repeat(0xABu8).take(extra));
        write_nal(out, if idr { 5 } else { 1 }, &rbsp);
    }

    fn build_single_slice_with_trailing_aud(pictures: usize, extra: usize) -> Vec<u8> {
        let mut out = Vec::new();
        write_nal(&mut out, 7, &[0x42, 0x00, 0x1e]);
        write_nal(&mut out, 8, &[0x68, 0xce]);
        for p in 0..pictures {
            write_nal(&mut out, 9, &[0xf0]);
            write_slice_nal_with_payload(&mut out, p == 0, 0, extra);
            write_nal(&mut out, 9, &[0xf0]);
        }
        out
    }

    fn build_variable_slice_stream(slices_per_picture: &[usize]) -> Vec<u8> {
        let mut out = Vec::new();
        write_nal(&mut out, 7, &[0x42, 0x00, 0x1e]);
        write_nal(&mut out, 8, &[0x68, 0xce]);
        for (p, &spp) in slices_per_picture.iter().enumerate() {
            write_nal(&mut out, 9, &[0xf0]);
            for s in 0..spp {
                write_slice_nal(
                    &mut out,
                    p == 0 && s == 0,
                    if s == 0 { 0 } else { 100 + s as u32 },
                );
            }
            write_nal(&mut out, 7, &[0x42, 0x00, 0x1e, (p as u8) & 0xff]);
            write_nal(&mut out, 8, &[0x68, 0xce, (p as u8) & 0xff]);
        }
        out
    }

    fn picture_start_offsets_from_count(bytes: &[u8]) -> Vec<usize> {
        scan_annexb_nals(bytes)
            .into_iter()
            .filter(|n| n.nal_type == 1 || n.nal_type == 5)
            .filter(|n| {
                n.header + 1 < n.end
                    && parse_first_mb_in_slice(&bytes[n.header + 1..n.end]) == Some(0)
            })
            .map(|n| n.start)
            .collect()
    }

    fn picture_start_offsets_from_grouping(bytes: &[u8]) -> Vec<usize> {
        let spans = scan_annexb_nals(bytes);
        let scanned: Vec<ScannedNal> = spans
            .iter()
            .map(|n| scanned_nal_from_span(n, 0, bytes))
            .collect();
        group_pictures_scanned(&scanned)
            .into_iter()
            .map(|p| p.vcl[0].start as usize)
            .collect()
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut hasher = crate::sha256::Sha256::new();
        hasher.update(bytes);
        crate::sha256::hex_digest(&hasher.finish())
    }

    fn vcl_nals(bytes: &[u8]) -> Vec<AnnexbNalSpan> {
        scan_annexb_nals(bytes)
            .into_iter()
            .filter(|n| n.nal_type == 1 || n.nal_type == 5)
            .collect()
    }

    /// A file left behind by a crashed or killed export can end mid-NAL: the
    /// last start code is present but nothing ever closes it. Both streaming
    /// scanners retain the in-flight NAL, and their "no start code present"
    /// compaction cannot fire while that one start code sits in the buffer, so
    /// without an explicit in-flight cap the whole remaining file is absorbed
    /// as NAL payload — O(file) memory, plus a quadratic re-scan of the growing
    /// buffer on every chunk. Salvage is exactly the malformed-input case, so
    /// this path is reachable in production.
    #[test]
    fn stream_nal_scanner_stays_bounded_on_unterminated_trailing_nal() {
        const FEED: usize = 1024 * 1024;
        const TRAILING_MIB: usize = 24;

        let prefix = build_multi_slice_stream(6, 2);
        let mut scanner = StreamAnnexbNalScanner::new();
        scanner.feed(&prefix);
        // Open a slice NAL and never close it.
        scanner.feed(&[0, 0, 0, 1, 0x41]);

        let chunk = vec![0xFFu8; FEED];
        let mut peak = scanner.buffer.len();
        for _ in 0..TRAILING_MIB {
            scanner.feed(&chunk);
            peak = peak.max(scanner.buffer.len());
        }
        // Fixed independently of the production constant so raising/disabling
        // the cap cannot make the test move its own goalpost.
        let bound = 10 * 1024 * 1024;
        assert!(
            peak <= bound,
            "in-flight NAL buffer peaked at {peak} bytes, above the {bound}-byte bound \
             (unbounded absorption of the unterminated trailing NAL)"
        );
    }

    #[test]
    fn access_unit_scanner_stays_bounded_on_unterminated_trailing_nal() {
        const FEED: usize = 1024 * 1024;
        const TRAILING_MIB: usize = 24;

        let mut all = build_multi_slice_stream(6, 2);
        all.extend_from_slice(&[0, 0, 0, 1, 0x41]);
        all.extend(std::iter::repeat(0xFFu8).take(TRAILING_MIB * FEED));

        let mut scanner = AnnexbAccessUnitScanner::new();
        let mut peak = 0usize;
        for chunk in all.chunks(FEED) {
            scanner.feed(chunk);
            peak = peak.max(scanner.buffer.len());
        }
        // Fixed independently of the production constant (destructive probe).
        let bound = 10 * 1024 * 1024;
        assert!(
            peak <= bound,
            "count-path buffer peaked at {peak} bytes, above the {bound}-byte bound"
        );
        scanner.finish();

        // Force-closing the in-flight NAL must not change what is counted: the
        // dropped payload cannot hold a start code, and `first_mb_in_slice` was
        // read from the retained head. (The unterminated trailing slice does
        // parse `first_mb == 0`, so it legitimately reads as a 7th picture
        // start — the truncate path is what discards it as incomplete.)
        assert_eq!(scanner.count, count_annexb_access_units(&all));
        assert_eq!(scanner.count.pictures, 7);
    }

    /// The same malformed shape driven through the real file path: the cut must
    /// still land on the last complete picture and the kept prefix must count
    /// back the pictures the prefix actually contains.
    #[test]
    fn truncate_annexb_on_unterminated_trailing_nal_produces_sane_cut() {
        let (_id, dir) = make_session();
        let path = dir.join("crashed.h264");
        let prefix = build_multi_slice_stream(6, 2);
        {
            use std::io::Write;
            let mut file = fs::File::create(&path).unwrap();
            file.write_all(&prefix).unwrap();
            file.write_all(&[0, 0, 0, 1, 0x41]).unwrap();
            let chunk = vec![0xFFu8; IO_CHUNK_SIZE];
            for _ in 0..(12 * 1024 * 1024 / IO_CHUNK_SIZE) {
                file.write_all(&chunk).unwrap();
            }
            file.flush().unwrap();
        }

        let got = truncate_annexb_inner(&path, "crashed.h264", None).unwrap();
        assert_eq!(got.pictures, 6);
        assert!(
            got.kept_bytes <= prefix.len() as u64 + 8,
            "cut kept {} bytes, past the valid prefix ({} bytes)",
            got.kept_bytes,
            prefix.len()
        );
        assert!(got.bytes_removed > 12 * 1024 * 1024);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// Production has exactly two annexb consumers: the counter that reports
    /// pictures/vclNals, and the cut-point selector. They now share
    /// `scan_annexb_nals`, so they cannot drift apart about where a NAL — and
    /// therefore a picture — begins. This locks that agreement, including the
    /// degenerate shapes where the two previously derived boundaries that
    /// differed by one byte (a four-byte start code, and a VCL NAL with an
    /// empty or single-byte payload).
    #[test]
    fn count_path_and_cut_path_agree_on_every_picture_boundary() {
        let mut streams: Vec<Vec<u8>> = vec![
            build_multi_slice_stream(1, 1),
            build_multi_slice_stream(3, 1),
            build_multi_slice_stream(5, 8),
            build_multi_slice_stream(2, 3),
            build_synthetic_single_slice_with_param_sets(4),
        ];
        // VCL NAL with an EMPTY payload, closed by a four-byte start code, then
        // a VCL NAL with a single payload byte.
        streams.push(vec![
            0, 0, 0, 1, 0x41, 0, 0, 0, 1, 0x41, 0x88, 0, 0, 0, 1, 0x41, 0x88, 0x00,
        ]);

        for (i, stream) in streams.iter().enumerate() {
            let counted = count_annexb_access_units(stream);
            let spans = scan_annexb_nals(stream);
            let scanned: Vec<ScannedNal> = spans
                .iter()
                .map(|n| scanned_nal_from_span(n, 0, stream))
                .collect();
            let grouped = group_pictures_scanned(&scanned);
            let cut_vcl = scanned
                .iter()
                .filter(|n| n.nal_type == 1 || n.nal_type == 5)
                .count();
            assert_eq!(
                counted.pictures as usize,
                grouped.len(),
                "stream {i}: counter and cut path disagree on picture count"
            );
            assert_eq!(
                counted.vcl_nals as usize, cut_vcl,
                "stream {i}: counter and cut path disagree on VCL NAL count"
            );
        }
    }

    /// Byte-exhaustive: at every prefix of a small corpus (fixed slices,
    /// variable slices, repeated SPS/PPS/AUD/SEI), the canonical count path
    /// and the cut-path grouping agree on picture-start offsets. This is the
    /// permanent unification guard — sampling is not a substitute.
    #[test]
    fn count_and_cut_grouping_agree_at_every_byte_offset() {
        let streams: Vec<(&str, Vec<u8>)> = vec![
            ("multi-2x2", build_multi_slice_stream(2, 2)),
            ("variable-1-3-2", build_variable_slice_stream(&[1, 3, 2])),
            ("paramsets-3", build_synthetic_single_slice_with_param_sets(3)),
            ("single-aud-2", build_single_slice_with_trailing_aud(2, 8)),
        ];
        for (name, stream) in streams {
            for offset in 0..=stream.len() {
                let prefix = &stream[..offset];
                let from_count = picture_start_offsets_from_count(prefix);
                let from_group = picture_start_offsets_from_grouping(prefix);
                assert_eq!(
                    from_count, from_group,
                    "{name} offset {offset}/{}: count path {:?} grouping {:?}",
                    stream.len(),
                    from_count,
                    from_group
                );
            }
        }
    }

    #[test]
    fn variable_slice_mode_heuristic_is_not_used_for_complete_last_picture() {
        // 1, 3, 2, 4 slices — every closed count is unique, so mode_of picks
        // the first (1). The last picture has 4 slices and trailing SPS/PPS,
        // so it is provably complete. The old mode heuristic would drop it.
        let stream = build_variable_slice_stream(&[1, 3, 2, 4]);
        let closed = [1usize, 3, 2];
        assert_eq!(mode_of(&closed), Some(1));
        let (kept, result) = truncate_annexb_to_last_complete_au(&stream);
        assert_eq!(result.pictures, 4);
        assert_eq!(result.bytes_removed, 0);
        assert_eq!(kept, stream);
    }

    #[test]
    fn conservative_final_au_policy_five_fixtures() {
        const PAYLOAD: usize = 33_000;

        // 1. Crash mid-payload of a single-slice picture.
        let clean = build_single_slice_with_trailing_aud(4, PAYLOAD);
        let vcls = vcl_nals(&clean);
        assert_eq!(vcls.len(), 4);
        let last = vcls[3];
        let mid = last.header + 2 + PAYLOAD / 2;
        assert!(mid < last.end);
        let crashed = &clean[..mid];
        let (kept, result) = truncate_annexb_to_last_complete_au(crashed);
        assert_eq!(result.pictures, 3, "mid-payload must drop the incomplete last AU");
        assert_eq!(count_annexb_access_units(&kept).pictures, 3);
        assert!(result.bytes_removed > 0);
        {
            let (_id, dir) = make_session();
            fs::write(dir.join("mid.h264"), crashed).unwrap();
            let disk = truncate_annexb_inner(&dir.join("mid.h264"), "mid.h264", None).unwrap();
            assert_eq!(disk.pictures, 3, "production file path must drop the same AU");
            fs::remove_dir_all(&dir).unwrap();
        }

        // 2. Crash immediately after first_mb_in_slice == 0 of a new picture.
        let after_first_mb = last.header + 2;
        let crashed = &clean[..after_first_mb.min(last.end)];
        let (_, result) = truncate_annexb_to_last_complete_au(crashed);
        assert_eq!(result.pictures, 3, "first_mb==0 with no following AU delimiter must drop");

        // 3. Crash with a provably complete final AU (trailing AUD present, then
        //    a dangling start code). Expect no drop of the complete pictures.
        let mut complete_then_dangling = clean.clone();
        complete_then_dangling.extend_from_slice(&[0, 0, 0, 1]);
        let (kept, result) = truncate_annexb_to_last_complete_au(&complete_then_dangling);
        assert_eq!(result.pictures, 4);
        assert_eq!(kept, clean);

        // 4. Multi-slice crash mid-picture.
        let multi = build_multi_slice_stream(4, 8);
        let mv = vcl_nals(&multi);
        let slice5 = mv[2 * 8 + 5];
        let (_, result) = truncate_annexb_to_last_complete_au(&multi[..slice5.header + 2]);
        assert_eq!(result.pictures, 2);

        // 5. Clean file: final AU closed by trailing AUD. No drop, bytesRemoved=0.
        let (kept, result) = truncate_annexb_to_last_complete_au(&clean);
        assert_eq!(result.pictures, 4);
        assert_eq!(result.bytes_removed, 0);
        assert_eq!(kept, clean);
    }

    #[test]
    fn clean_path_truncate_is_full_bytes_identical() {
        let stream = build_multi_slice_stream(4, 8);
        let (kept, result) = truncate_annexb_to_last_complete_au(&stream);
        assert_eq!(result.bytes_removed, 0);
        assert_eq!(kept.as_slice(), stream.as_slice());

        let (_id, dir) = make_session();
        fs::write(dir.join("clean.h264"), &stream).unwrap();
        let got = truncate_annexb_inner(&dir.join("clean.h264"), "clean.h264", None).unwrap();
        assert_eq!(got.bytes_removed, 0);
        assert_eq!(got.kept_bytes, stream.len() as u64);
        assert_eq!(fs::read(dir.join("clean.h264")).unwrap(), stream);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn resume_exact_offset_path_untouched_by_final_au_policy() {
        let stream = build_multi_slice_stream(4, 8);
        let vcls = vcl_nals(&stream);
        let first_vcl_p2 = vcls[2 * 8];
        let previous_vcl = vcls[2 * 8 - 1];
        let checkpoint_offset = scan_annexb_nals(&stream)
            .iter()
            .find(|n| {
                n.nal_type == 9 && n.start > previous_vcl.start && n.start < first_vcl_p2.start
            })
            .expect("AUD at checkpoint")
            .start as u64;

        let fixtures: Vec<(&str, Vec<u8>, u64, u64)> = vec![
            (
                "mid-nal",
                stream[..vcls[2 * 8 + 5].header + 2].to_vec(),
                checkpoint_offset,
                2,
            ),
            (
                "mid-picture",
                stream[..vcls[2 * 8 + 5].start].to_vec(),
                checkpoint_offset,
                2,
            ),
            (
                "exact-au-boundary",
                stream[..checkpoint_offset as usize].to_vec(),
                checkpoint_offset,
                2,
            ),
            ("clean", stream.clone(), stream.len() as u64, 4),
        ];

        for (name, bytes, offset, pictures) in fixtures {
            let (_id, dir) = make_session();
            let offset_path = dir.join("offset.h264");
            let resume_path = dir.join("resume.h264");
            fs::write(&offset_path, &bytes).unwrap();
            fs::write(&resume_path, &bytes).unwrap();

            let offset_result =
                truncate_annexb_to_offset_inner(&offset_path, "offset.h264", offset, None)
                    .unwrap_or_else(|e| panic!("{name} offset: {e}"));
            let resume_result = prepare_checkpoint_resume_inner(
                &resume_path,
                "resume.h264",
                offset,
                pictures,
                0,
                0,
                None,
            )
            .unwrap_or_else(|e| panic!("{name} resume: {e}"));

            let offset_bytes = fs::read(&offset_path).unwrap();
            let resume_bytes = fs::read(&resume_path).unwrap();
            assert_eq!(
                offset_bytes, resume_bytes,
                "{name}: resume path must stay byte-identical to exact-offset"
            );
            assert_eq!(offset_result.kept_bytes, offset, "{name}");
            assert_eq!(resume_result.kept_bytes, offset, "{name}");
            assert_eq!(offset_result.pictures, pictures, "{name}");
            assert_eq!(resume_result.pictures, pictures, "{name}");
            fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn count_annexb_access_units_multi_slice_counts_pictures_not_slices() {
        let stream = build_multi_slice_stream(5, 8);
        let count = count_annexb_access_units(&stream);
        assert_eq!(count.pictures, 5);
        assert_eq!(count.vcl_nals, 40);
    }

    #[test]
    fn ffmpeg_count_annexb_frames_command_matches_in_memory_counter() {
        let (_id, dir) = make_session();
        let stream = build_multi_slice_stream(3, 4);
        fs::write(dir.join("test.h264"), &stream).unwrap();
        let got = count_annexb_frames_inner(&dir.join("test.h264"), "test.h264", None).unwrap();
        let want = count_annexb_access_units(&stream);
        assert_eq!(got.pictures, want.pictures);
        assert_eq!(got.vcl_nals, want.vcl_nals);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn ffmpeg_count_annexb_frames_matches_js_synthetic_bytes() {
        // Digests locked against annexbFrameCount.test.ts's JS constructors.
        let cases: [(&str, Vec<u8>, u64, u64, usize, &str); 4] = [
            (
                "8slice-10pic",
                build_multi_slice_stream(10, 8),
                10,
                80,
                945,
                "efd16ab57ff667563b14ce12bafa3425e5c7802f637d92e4f3565f4475920112",
            ),
            (
                "1slice-12pic",
                build_synthetic_single_slice_with_param_sets(12),
                12,
                12,
                444,
                "d02aca0757167768f0561f6a8a92632b3dd8ab69266757d2ab88734beb22233c",
            ),
            (
                "paramsets-3pic",
                build_multi_slice_stream(3, 1),
                3,
                3,
                126,
                "b6ce471760350a3545a80ccb54da71441a04c2006c55452b6e00187adfb38894",
            ),
            (
                "short-9pic",
                build_synthetic_single_slice_with_param_sets(9),
                9,
                9,
                333,
                "c84a5aae5a64f203d9ec02326e84e5296792813de7b4cd35b5ec7ca7404a55aa",
            ),
        ];

        for (name, stream, pictures, vcl_nals_expected, len, digest) in cases {
            assert_eq!(stream.len(), len, "{name} byteLength");
            assert_eq!(sha256_hex(&stream), digest, "{name} sha256");
            let mem = count_annexb_access_units(&stream);
            assert_eq!(mem.pictures, pictures, "{name} pictures");
            assert_eq!(mem.vcl_nals, vcl_nals_expected, "{name} vclNals");

            let (_id, dir) = make_session();
            fs::write(dir.join("test.h264"), &stream).unwrap();
            let got = count_annexb_frames_inner(&dir.join("test.h264"), "test.h264", None).unwrap();
            assert_eq!(got, mem, "{name} command vs in-memory");
            fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn truncate_mid_nal_mid_picture_and_boundary() {
        let stream = build_multi_slice_stream(4, 8);
        let vcls = vcl_nals(&stream);
        assert_eq!(vcls.len(), 32);

        // mid-NAL: 2 bytes into slice 5 of picture 2
        let slice5 = vcls[2 * 8 + 5];
        let mid_nal = &stream[..slice5.header + 2];
        let (kept, result) = truncate_annexb_to_last_complete_au(mid_nal);
        assert_eq!(result.pictures, 2);
        assert_eq!(result.vcl_nals, 16);
        assert_eq!(count_annexb_access_units(&kept).pictures, 2);

        // mid-picture: cut at start of slice 5 of 8
        let mid_pic = &stream[..slice5.start];
        let (_, result) = truncate_annexb_to_last_complete_au(mid_pic);
        assert_eq!(result.pictures, 2);
        assert_eq!(result.vcl_nals, 16);

        // exactly on a picture boundary: AUD of picture 2
        let first_vcl_p2 = vcls[2 * 8];
        let prev_last = vcls[2 * 8 - 1];
        let nals = scan_annexb_nals(&stream);
        let aud = nals
            .iter()
            .find(|n| n.nal_type == 9 && n.start > prev_last.start && n.start < first_vcl_p2.start)
            .expect("AUD of picture 2");
        let on_boundary = &stream[..aud.start];
        let (_, result) = truncate_annexb_to_last_complete_au(on_boundary);
        assert_eq!(result.pictures, 2);
        assert_eq!(result.vcl_nals, 16);

        // complete file is a no-op
        let (kept, result) = truncate_annexb_to_last_complete_au(&stream);
        assert_eq!(result.pictures, 4);
        assert_eq!(result.vcl_nals, 32);
        assert_eq!(result.bytes_removed, 0);
        assert_eq!(kept, stream);
    }

    #[test]
    fn ffmpeg_truncate_annexb_command_matches_in_memory() {
        let (_id, dir) = make_session();
        let stream = build_multi_slice_stream(4, 8);
        let vcls = vcl_nals(&stream);
        let slice5 = vcls[2 * 8 + 5];
        let truncated = &stream[..slice5.header + 2];
        fs::write(dir.join("piece.h264"), truncated).unwrap();
        let got = truncate_annexb_inner(&dir.join("piece.h264"), "piece.h264", None).unwrap();
        let (_, want) = truncate_annexb_to_last_complete_au(truncated);
        assert_eq!(got, want);
        let on_disk = fs::read(dir.join("piece.h264")).unwrap();
        assert_eq!(count_annexb_access_units(&on_disk).pictures, 2);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn resumed_session_blocks_append_count_concat_until_prepared() {
        let state = FfmpegSessionState::default();
        let id = Uuid::new_v4().to_string();
        state.resume_pending.lock().unwrap().insert(id.clone());

        for operation in [
            "append_file_raw",
            "count_annexb_frames",
            "concat_annexb_pieces",
        ] {
            let err = ensure_resume_prepared(&state, &id, operation).unwrap_err();
            assert!(err.contains(operation));
            assert!(err.contains("has not passed checkpoint pre-append validation"));
        }

        state.resume_pending.lock().unwrap().remove(&id);
        assert!(ensure_resume_prepared(&state, &id, "append_file_raw").is_ok());
    }

    #[test]
    fn checkpoint_resume_repairs_mid_nal_mid_picture_boundary_and_clean_file() {
        let stream = build_multi_slice_stream(4, 8);
        let vcls = vcl_nals(&stream);
        let first_vcl_p2 = vcls[2 * 8];
        let previous_vcl = vcls[2 * 8 - 1];
        let checkpoint_offset = scan_annexb_nals(&stream)
            .iter()
            .find(|n| {
                n.nal_type == 9 && n.start > previous_vcl.start && n.start < first_vcl_p2.start
            })
            .expect("AUD at checkpoint")
            .start;

        let fixtures: Vec<(&str, Vec<u8>, u64, u64)> = vec![
            (
                "mid-nal",
                stream[..vcls[2 * 8 + 5].header + 2].to_vec(),
                checkpoint_offset as u64,
                2,
            ),
            (
                "mid-picture",
                stream[..vcls[2 * 8 + 5].start].to_vec(),
                checkpoint_offset as u64,
                2,
            ),
            (
                "exact-au-boundary",
                stream[..checkpoint_offset].to_vec(),
                checkpoint_offset as u64,
                2,
            ),
            ("clean", stream.clone(), stream.len() as u64, 4),
        ];

        for (name, bytes, offset, pictures) in fixtures {
            let (_id, dir) = make_session();
            let full = dir.join("piece_0.h264");
            fs::write(&full, &bytes).unwrap();
            let got = prepare_checkpoint_resume_inner(
                &full,
                "piece_0.h264",
                offset,
                pictures,
                0,
                0,
                None,
            )
            .unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(got.kept_bytes, offset, "{name}");
            assert_eq!(got.pictures, pictures, "{name}");
            assert_eq!(got.bytes_removed, bytes.len() as u64 - offset, "{name}");
            if name == "clean" || name == "exact-au-boundary" {
                assert_eq!(got.bytes_removed, 0, "{name}");
                assert!(got.tail_was_whole_au, "{name}");
            }
            fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn checkpoint_resume_rejects_picture_count_disagreement() {
        let (_id, dir) = make_session();
        let stream = build_multi_slice_stream(4, 8);
        let full = dir.join("piece_0.h264");
        fs::write(&full, &stream).unwrap();
        let err = prepare_checkpoint_resume_inner(
            &full,
            "piece_0.h264",
            stream.len() as u64,
            3,
            0,
            0,
            None,
        )
        .unwrap_err();
        assert!(err.contains("checkpoint pictures 3 != canonical pictures 4"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn backwards_tail_inspection_detects_dangling_start_code() {
        let (_id, dir) = make_session();
        let mut stream = build_multi_slice_stream(2, 2);
        stream.extend_from_slice(&[0, 0, 0, 1]);
        let full = dir.join("piece.h264");
        fs::write(&full, &stream).unwrap();
        let (start, has_header) = inspect_annexb_tail_backwards(&full, "piece.h264").unwrap();
        assert_eq!(start, Some((stream.len() - 4) as u64));
        assert!(!has_header);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn export_state_write_is_validated_synced_and_replaceable() {
        let (id, dir) = make_session();
        let first = format!(
            "{{\"schemaVersion\":1,\"sessionId\":\"{}\",\"checkpoints\":[]}}\n",
            id
        );
        ffmpeg_write_export_state(id.clone(), first.clone()).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("export_state.json")).unwrap(),
            first
        );

        let second = format!(
            "{{\"schemaVersion\":1,\"sessionId\":\"{}\",\"checkpoints\":[{{\"pieceIndex\":0}}]}}\n",
            id
        );
        ffmpeg_write_export_state(id.clone(), second.clone()).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("export_state.json")).unwrap(),
            second
        );
        assert!(!dir.join("export_state.json.tmp").exists());

        let other_id = Uuid::new_v4().to_string();
        let mismatch = format!("{{\"sessionId\":\"{}\"}}", other_id);
        assert!(ffmpeg_write_export_state(id, mismatch)
            .unwrap_err()
            .contains("sessionId mismatch"));
        fs::remove_dir_all(&dir).unwrap();
    }

    fn write_io_benchmark_blob(path: &Path, target_bytes: usize) {
        use std::io::Write;
        let chunk: Vec<u8> = (0..IO_CHUNK_SIZE).map(|i| (i % 251) as u8).collect();
        let mut file = fs::File::create(path).unwrap();
        let mut written = 0usize;
        while written < target_bytes {
            let take = (target_bytes - written).min(chunk.len());
            file.write_all(&chunk[..take]).unwrap();
            written += take;
        }
        file.flush().unwrap();
    }

    /// One-off timing against `WS3_BENCH_FILE` (existing on-disk annexb).
    #[test]
    #[ignore = "manual: WS3_BENCH_FILE=/path/to/file.h264"]
    fn measure_ws3_bench_file_from_env() {
        use std::time::Instant;
        let path = std::env::var("WS3_BENCH_FILE").expect("WS3_BENCH_FILE");
        let full = PathBuf::from(path);
        let t0 = Instant::now();
        let _ = count_annexb_frames_inner(&full, "bench.h264", None).unwrap();
        println!("ws3 frame_count_ms: {}", t0.elapsed().as_millis());
    }

    /// Export-scale native I/O measurement (~1.7 GB on disk, no full-RAM buffer).
    /// Uses high-entropy bytes so frame-count measures sequential read throughput,
    /// not pathological multi-million-picture parsing on repeated fixtures.
    /// Run: `cargo test --release measure_export_scale_native_io_on_disk -- --ignored --nocapture`
    #[test]
    #[ignore = "manual: writes ~1.7 GB under $TMPDIR — export-scale bound measurement"]
    fn measure_export_scale_native_io_on_disk() {
        use std::time::Instant;

        const TARGET_BYTES: usize = 1_700_000_000;
        let (_id, dir) = make_session();
        write_io_benchmark_blob(&dir.join("piece_a.h264"), TARGET_BYTES / 2);
        write_io_benchmark_blob(&dir.join("piece_b.h264"), TARGET_BYTES - TARGET_BYTES / 2);

        let mut samples: Vec<(&str, u128)> = Vec::new();

        let t0 = Instant::now();
        let _ = concat_annexb_pieces_inner(
            &dir,
            &["piece_a.h264".to_string(), "piece_b.h264".to_string()],
            &dir.join("concat_out.h264"),
            None,
        )
        .unwrap();
        samples.push(("concat_ms", t0.elapsed().as_millis()));

        let t0 = Instant::now();
        let _ = count_annexb_frames_inner(&dir.join("concat_out.h264"), "concat_out.h264", None)
            .unwrap();
        samples.push(("frame_count_ms", t0.elapsed().as_millis()));

        let truncate_stream = build_multi_slice_stream(400, 8);
        fs::write(dir.join("truncate_src.h264"), &truncate_stream).unwrap();
        let t0 = Instant::now();
        let _ = truncate_annexb_inner(&dir.join("truncate_src.h264"), "truncate_src.h264", None)
            .unwrap();
        samples.push(("truncate_3200pic_ms", t0.elapsed().as_millis()));

        println!("ws3-native-bounds-measurement target_bytes={TARGET_BYTES}");
        for (label, ms) in &samples {
            println!("  {label}: {ms} ms");
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn truncate_stops_mid_scan_when_cancel_flag_is_set() {
        let (_id, dir) = make_session();
        write_large_piece(&dir, "piece.h264", 2048 * IO_CHUNK_SIZE);
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_worker = cancel.clone();
        let full = dir.join("piece.h264");

        let handle = thread::spawn(move || {
            truncate_annexb_inner(&full, "piece.h264", Some(cancel_worker.as_ref()))
        });

        thread::sleep(Duration::from_millis(10));
        cancel.store(true, Ordering::SeqCst);
        let result = handle.join().unwrap();
        assert_eq!(result, Err("cancelled".to_string()));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn streaming_truncate_cut_matches_in_memory_on_fixtures() {
        let fixtures: [(&str, Vec<u8>); 4] = [
            ("8slice-10pic", build_multi_slice_stream(10, 8)),
            (
                "1slice-12pic",
                build_synthetic_single_slice_with_param_sets(12),
            ),
            ("paramsets-3pic", build_multi_slice_stream(3, 1)),
            (
                "short-9pic",
                build_synthetic_single_slice_with_param_sets(9),
            ),
        ];
        for (name, stream) in fixtures {
            let (_id, dir) = make_session();
            fs::write(dir.join("test.h264"), &stream).unwrap();
            let file_len = stream.len() as u64;
            let nals =
                scan_annexb_nals_from_file(&dir.join("test.h264"), "test.h264", None).unwrap();
            let stream_cut = compute_truncate_cut_from_scanned(&nals, file_len);
            let (_, mem) = truncate_annexb_to_last_complete_au(&stream);
            assert_eq!(stream_cut, mem.kept_bytes, "{name} cut");
            fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn truncate_to_offset_refuses_past_eof_and_reports_picture_count() {
        let (_id, dir) = make_session();
        let stream = build_multi_slice_stream(4, 8);
        fs::write(dir.join("piece.h264"), &stream).unwrap();
        let vcls = vcl_nals(&stream);
        let offset = vcls[8].start as u64;
        let got =
            truncate_annexb_to_offset_inner(&dir.join("piece.h264"), "piece.h264", offset, None)
                .unwrap();
        assert_eq!(got.kept_bytes, offset);
        assert_eq!(got.pictures, 1);
        let on_disk = fs::read(dir.join("piece.h264")).unwrap();
        assert_eq!(on_disk.len() as u64, offset);
        assert_eq!(count_annexb_access_units(&on_disk).pictures, got.pictures);
        let err = truncate_annexb_to_offset_inner(
            &dir.join("piece.h264"),
            "piece.h264",
            offset + 1,
            None,
        );
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("exceeds file length"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn session_file_size_reports_byte_length() {
        let (_id, dir) = make_session();
        let stream = build_multi_slice_stream(2, 4);
        fs::write(dir.join("piece.h264"), &stream).unwrap();
        let size = fs::metadata(dir.join("piece.h264")).unwrap().len();
        assert_eq!(size as usize, stream.len());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn truncate_to_offset_stops_mid_count_when_cancel_flag_is_set() {
        let (_id, dir) = make_session();
        write_large_piece(&dir, "piece.h264", 2048 * IO_CHUNK_SIZE);
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_worker = cancel.clone();
        let full = dir.join("piece.h264");
        let offset = (1024 * IO_CHUNK_SIZE) as u64;

        let handle = thread::spawn(move || {
            truncate_annexb_to_offset_inner(
                &full,
                "piece.h264",
                offset,
                Some(cancel_worker.as_ref()),
            )
        });

        thread::sleep(Duration::from_millis(10));
        cancel.store(true, Ordering::SeqCst);
        let result = handle.join().unwrap();
        assert_eq!(result, Err("cancelled".to_string()));
        fs::remove_dir_all(&dir).unwrap();
    }

    fn write_padded_annexb_fixture(path: &Path, valid_prefix: &[u8], target_bytes: u64) {
        use std::io::Write;
        let mut file = fs::File::create(path).unwrap();
        file.write_all(valid_prefix).unwrap();
        // Dangling start code closes the prefix's last open NAL so GB-scale
        // padding is not absorbed as false payload (keeps streaming buffers bounded).
        file.write_all(&[0, 0, 0, 1]).unwrap();
        let pad_byte = 0xFFu8;
        let chunk = vec![pad_byte; IO_CHUNK_SIZE];
        let mut written = valid_prefix.len() as u64;
        while written < target_bytes {
            let take = ((target_bytes - written) as usize).min(chunk.len());
            file.write_all(&chunk[..take]).unwrap();
            written += take as u64;
        }
        file.flush().unwrap();
    }

    /// Export-scale timing for streaming count/truncate (pair with
    /// `scripts/ws3-measure-streaming-annexb.sh` for peak RSS via `/usr/bin/time -l`).
    /// Run: `cargo test --release measure_streaming_annexb_at_scale -- --ignored --nocapture`
    #[test]
    #[ignore = "manual: writes ~2.3 GB under $TMPDIR"]
    fn measure_streaming_annexb_at_scale() {
        use std::time::Instant;

        const TARGET_1_7_GB: u64 = 1_700_000_000;
        const TARGET_2_3_GB: u64 = 2_300_000_000;
        let prefix = build_multi_slice_stream(400, 8);
        let (_id, dir) = make_session();

        for (label, target) in [("1_7gb", TARGET_1_7_GB), ("2_3gb", TARGET_2_3_GB)] {
            let path = dir.join(format!("scale_{label}.h264"));
            let master = dir.join(format!("scale_{label}_master.h264"));
            write_padded_annexb_fixture(&master, &prefix, target);

            let mut count_samples = Vec::new();
            for _ in 0..3 {
                let t0 = Instant::now();
                let got = count_annexb_frames_inner(&master, "scale.h264", None).unwrap();
                count_samples.push(t0.elapsed().as_millis());
                assert_eq!(got.pictures, 400);
            }
            count_samples.sort_unstable();

            let mut trunc_samples = Vec::new();
            for _ in 0..3 {
                fs::copy(&master, &path).unwrap();
                let t0 = Instant::now();
                let got = truncate_annexb_inner(&path, "scale.h264", None).unwrap();
                trunc_samples.push(t0.elapsed().as_millis());
                assert_eq!(got.pictures, 400);
            }
            trunc_samples.sort_unstable();

            println!(
                "ws3-streaming-measurement {label} bytes={target} count_p50_ms={} count_worst_ms={} truncate_p50_ms={} truncate_worst_ms={}",
                count_samples[1],
                count_samples[2],
                trunc_samples[1],
                trunc_samples[2],
            );
        }
        fs::remove_dir_all(&dir).unwrap();
    }
}
