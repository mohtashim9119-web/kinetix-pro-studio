//! Self-healing for `media-vault/registry.json`.
//!
//! The registry is the one index of the media vault. When it cannot be parsed,
//! every import and every listing fails — "0 imported, N failed" — so the
//! loader does not stop at "refuse": it walks a LADDER, most recent first, and
//! every rung that fires is LOUD (a typed, persisted `VaultRecoveryFinding`,
//! a quarantined copy of the bytes that were replaced, and a log line).
//!
//!   (a) full strict parse              — the normal, silent, healthy path.
//!   (b) SALVAGE                        — the first complete JSON value in the
//!       byte stream. A torn write leaves one whole document followed by the
//!       tail of another; the whole document is recovered with zero loss.
//!   (c) `.lastgood`                    — a copy of the registry written and
//!       parse-verified after the last successful save.
//!   (d) REBUILD                        — the vault's content-addressed blobs
//!       are intact by construction; the registry is re-derived from them plus
//!       the project records (references, titles). Renames that only ever lived
//!       in the unreadable registry are the one loss; the finding counts them.
//!
//! Crash safety. A recovery is three durable steps, always in this order, each
//! idempotent, so a kill at any boundary converges on the next launch:
//!   1. quarantine the corrupt bytes (manifest `copying` → copy → verify →
//!      `complete`, under `<root>/quarantine/vault-registry-<sha16>/`);
//!   2. persist the finding (deduplicated by the corrupt file's sha256, so a
//!      re-run never double-reports and a recovery is never silent);
//!   3. atomically replace `registry.json` with the recovered registry.
//! The original is never deleted before step 3 commits, and after it the bytes
//! live on in quarantine.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::atomic_stage::write_bytes_atomic;
use crate::media_vault::{
    acquire_registry_gate, registry_file, strict_parse_registry, MediaVaultEntry, MediaVaultRegistry,
    RegistryGuard,
};
use crate::sha256::{hash_file, hex_digest, Sha256};
use crate::storage_quarantine::{
    quarantine_dir, write_manifest, QuarantineManifest, QuarantineState, QuarantinedFile,
};
use crate::storage_root::{media_vault_dir, project_mirror_dir, projects_dir, resolve_storage_root};

pub const FINDINGS_FILE: &str = "recovery-findings.json";
pub const LASTGOOD_FILE: &str = "registry.json.lastgood";
pub const KIND_RECOVERED: &str = "vault-registry-recovered";
pub const KIND_LASTGOOD_UNVERIFIED: &str = "vault-lastgood-unverified";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecoveryMode {
    Salvage,
    Lastgood,
    Rebuild,
}

/// One persisted, machine-readable recovery event.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultRecoveryFinding {
    /// `vault-registry-recovered` | `vault-lastgood-unverified`.
    pub kind: String,
    /// Which rung fired (absent for `vault-lastgood-unverified`).
    #[serde(default)]
    pub mode: Option<RecoveryMode>,
    pub at_ms: u64,
    /// Entries in the registry after recovery.
    pub entries_recovered: u64,
    /// sha256 of the bytes that could not be parsed — the dedupe key.
    #[serde(default)]
    pub corrupt_sha256: String,
    #[serde(default)]
    pub corrupt_bytes: u64,
    /// Salvage only: trailing bytes that were discarded after the document.
    #[serde(default)]
    pub trailing_bytes_discarded: Option<u64>,
    /// Rebuild only: project references re-derived from project records.
    #[serde(default)]
    pub refs_rederived: Option<u64>,
    /// Rebuild only: entries whose title could not be recovered and now show a
    /// placeholder filename. An upper bound on lost renames — once the registry
    /// is unreadable, which entries had been renamed is itself unknowable.
    #[serde(default)]
    pub renamed_titles_reverted: Option<u64>,
    /// Where the replaced bytes were preserved.
    #[serde(default)]
    pub quarantine_path: String,
    pub detail: String,
    /// The user has seen and dismissed it (the record itself is kept).
    #[serde(default)]
    pub acknowledged: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct FindingsFile {
    #[serde(default)]
    findings: Vec<VaultRecoveryFinding>,
}

/// Test-only crash injection: where a recovery run "dies".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecoveryStop {
    AfterQuarantineManifest,
    AfterQuarantineCopy,
    AfterFindingPersisted,
    AfterRegistryReplaced,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn lastgood_file(root: &Path) -> PathBuf {
    media_vault_dir(root).join(LASTGOOD_FILE)
}

fn findings_path(root: &Path) -> PathBuf {
    media_vault_dir(root).join(FINDINGS_FILE)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex_digest(&h.finish())
}

// ---------------------------------------------------------------------------
// Findings store
// ---------------------------------------------------------------------------

/// Every recovery event on record, oldest first. A findings file that exists
/// but cannot be read is an error, not "no findings": silence is the one thing
/// this module must never produce.
pub fn read_findings(root: &Path) -> Result<Vec<VaultRecoveryFinding>, String> {
    match fs::read(findings_path(root)) {
        Ok(bytes) => serde_json::from_slice::<FindingsFile>(&bytes)
            .map(|f| f.findings)
            .map_err(|e| format!("media-vault: recovery findings unreadable: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("media-vault: read recovery findings: {e}")),
    }
}

fn write_findings(root: &Path, findings: Vec<VaultRecoveryFinding>) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&FindingsFile { findings })
        .map_err(|e| format!("media-vault: serialize recovery findings: {e}"))?;
    write_bytes_atomic(&findings_path(root), &bytes)
}

/// Appends `finding` unless one with the same corrupt-bytes hash and kind is
/// already recorded (an interrupted recovery re-running must not double-report).
/// Caller holds the registry gate.
fn persist_finding(root: &Path, finding: &VaultRecoveryFinding) -> Result<(), String> {
    let mut all = read_findings(root)?;
    let duplicate = all.iter().any(|f| {
        f.kind == finding.kind && f.mode == finding.mode && f.corrupt_sha256 == finding.corrupt_sha256
    });
    if duplicate {
        return Ok(());
    }
    all.push(finding.clone());
    write_findings(root, all)
}

/// Marks every finding acknowledged (the user dismissed the notice). The
/// records are kept for forensics.
pub fn acknowledge_findings(root: &Path) -> Result<u64, String> {
    let _gate = acquire_registry_gate(root)?;
    let mut all = read_findings(root)?;
    let mut changed = 0u64;
    for f in all.iter_mut().filter(|f| !f.acknowledged) {
        f.acknowledged = true;
        changed += 1;
    }
    if changed > 0 {
        write_findings(root, all)?;
    }
    Ok(changed)
}

// ---------------------------------------------------------------------------
// Quarantine of the replaced bytes (two-phase; storage_quarantine's manifest)
// ---------------------------------------------------------------------------

fn quarantine_corrupt_registry(
    root: &Path,
    bytes: &[u8],
    sha256: &str,
    stop: Option<RecoveryStop>,
) -> Result<PathBuf, String> {
    let id = format!("vault-registry-{}", &sha256[..16]);
    let qdir = quarantine_dir(root).join(&id);
    let rel = "media-vault/registry.json";
    let data = qdir.join("data").join(rel);

    let done = crate::storage_quarantine::read_manifest(&qdir)?
        .map(|m| m.state == QuarantineState::Complete)
        .unwrap_or(false)
        && hash_file(&data).map(|h| h == sha256).unwrap_or(false);
    if done {
        return Ok(qdir);
    }

    // Phase 1 — manifest (hash taken from the bytes in hand), then the copy.
    fs::create_dir_all(&qdir).map_err(|e| format!("create {}: {e}", qdir.display()))?;
    let mut manifest = QuarantineManifest {
        id,
        created_ms: now_ms(),
        state: QuarantineState::Copying,
        files: vec![QuarantinedFile {
            rel_path: rel.to_string(),
            bytes: bytes.len() as u64,
            sha256: sha256.to_string(),
        }],
    };
    write_manifest(&qdir, &manifest)?;
    if stop == Some(RecoveryStop::AfterQuarantineManifest) {
        return Err("stopped: AfterQuarantineManifest".into());
    }
    write_bytes_atomic(&data, bytes)?;
    if stop == Some(RecoveryStop::AfterQuarantineCopy) {
        return Err("stopped: AfterQuarantineCopy".into());
    }

    // Phase 2 — verify the copy byte-for-byte, then finish the manifest. The
    // "source" is replaced by rename by the caller, not removed here.
    let copied = hash_file(&data).map_err(|e| format!("verify quarantined registry: {e}"))?;
    if copied != sha256 {
        return Err(format!(
            "quarantined registry copy does not match its source ({copied} != {sha256}); registry left untouched"
        ));
    }
    manifest.state = QuarantineState::Complete;
    write_manifest(&qdir, &manifest)?;
    Ok(qdir)
}

// ---------------------------------------------------------------------------
// Rung (b): salvage
// ---------------------------------------------------------------------------

/// The first complete JSON value in `bytes`, accepted only if it is shaped like
/// a registry (an object carrying an `entries` object). Anything else — a first
/// value that is itself cut short, or merely `{}` — is refused so the ladder
/// moves on instead of "salvaging" an empty registry over a full one.
fn salvage_first_document(bytes: &[u8]) -> Option<(MediaVaultRegistry, u64)> {
    let mut stream = serde_json::Deserializer::from_slice(bytes).into_iter::<serde_json::Value>();
    let value = stream.next()?.ok()?;
    let consumed = stream.byte_offset();
    if !value.get("entries").map(|e| e.is_object()).unwrap_or(false) {
        return None;
    }
    let registry: MediaVaultRegistry = serde_json::from_value(value).ok()?;
    Some((registry, (bytes.len() - consumed) as u64))
}

// ---------------------------------------------------------------------------
// Rung (c): .lastgood
// ---------------------------------------------------------------------------

fn read_lastgood(root: &Path) -> Option<MediaVaultRegistry> {
    let bytes = fs::read(lastgood_file(root)).ok()?;
    strict_parse_registry(&bytes).ok()
}

/// After a successful registry save: write the same bytes to `.lastgood`, then
/// read them back and parse. A copy that does not verify is removed so rung (c)
/// can never trust it, and the failure is recorded — never swallowed.
pub(crate) fn maintain_lastgood(root: &Path, saved: &[u8]) {
    let path = lastgood_file(root);
    let verdict = write_bytes_atomic(&path, saved).and_then(|()| {
        let back = fs::read(&path).map_err(|e| format!("read back {}: {e}", path.display()))?;
        if back != saved {
            return Err("read-back bytes differ from what was written".to_string());
        }
        strict_parse_registry(&back).map(|_| ()).map_err(|e| format!("read-back does not parse: {e}"))
    });
    if let Err(detail) = verdict {
        let _ = fs::remove_file(&path);
        eprintln!("[media_vault] .lastgood could not be verified and was removed: {detail}");
        let finding = VaultRecoveryFinding {
            kind: KIND_LASTGOOD_UNVERIFIED.to_string(),
            mode: None,
            at_ms: now_ms(),
            entries_recovered: 0,
            corrupt_sha256: sha256_hex(saved),
            corrupt_bytes: saved.len() as u64,
            trailing_bytes_discarded: None,
            refs_rederived: None,
            renamed_titles_reverted: None,
            quarantine_path: String::new(),
            detail: format!("registry.json.lastgood failed verification and was removed: {detail}"),
            acknowledged: false,
        };
        if let Err(e) = persist_finding(root, &finding) {
            eprintln!("[media_vault] could not record the .lastgood finding either: {e}");
        }
    }
}

// ---------------------------------------------------------------------------
// Rung (d): rebuild from the filesystem
// ---------------------------------------------------------------------------

fn is_blob_name(name: &str) -> Option<&str> {
    let hash = name.strip_suffix(".bin")?;
    (hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())).then_some(hash)
}

fn mime_from_name(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        _ => "application/octet-stream",
    }
}

#[derive(Default)]
struct Hint {
    display_name: Option<String>,
    mime_type: Option<String>,
    added_at_ms: Option<u128>,
}

/// Best-effort read of `contentHash` / `displayName` / `mimeType` /
/// `addedAtMs` lines out of bytes that no longer parse. The registry is
/// pretty-printed with one key per line, so the titles (including renames) of
/// entries outside the damaged region are still recoverable.
fn lenient_hints(bytes: &[u8]) -> HashMap<String, Hint> {
    fn value_of(line: &str) -> Option<&str> {
        let (_, rest) = line.split_once(':')?;
        Some(rest.trim().trim_end_matches(','))
    }
    let text = String::from_utf8_lossy(bytes);
    let mut out: HashMap<String, Hint> = HashMap::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        let t = line.trim_start();
        if t.starts_with("\"contentHash\"") {
            current = value_of(t)
                .and_then(|v| serde_json::from_str::<String>(v).ok())
                .filter(|h| is_blob_name(&format!("{h}.bin")).is_some());
            if let Some(h) = &current {
                out.entry(h.clone()).or_default();
            }
        } else if let Some(h) = &current {
            let hint = out.entry(h.clone()).or_default();
            if t.starts_with("\"displayName\"") {
                hint.display_name = value_of(t).and_then(|v| serde_json::from_str::<String>(v).ok());
            } else if t.starts_with("\"mimeType\"") {
                hint.mime_type = value_of(t).and_then(|v| serde_json::from_str::<String>(v).ok());
            } else if t.starts_with("\"addedAtMs\"") {
                hint.added_at_ms = value_of(t).and_then(|v| v.parse::<u128>().ok());
            }
        }
    }
    out
}

/// `contentHash -> (project ids, asset name)` from every project record the
/// store and the durable mirror hold.
fn project_record_refs(root: &Path) -> (HashMap<String, BTreeSet<String>>, HashMap<String, String>) {
    let mut refs: HashMap<String, BTreeSet<String>> = HashMap::new();
    let mut names: HashMap<String, String> = HashMap::new();
    let mut read_record = |id: &str, path: &Path| {
        let Ok(text) = fs::read_to_string(path) else { return };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return };
        let project = v.get("project").unwrap_or(&v);
        let Some(assets) = project.get("assets").and_then(|a| a.as_array()) else { return };
        for asset in assets {
            let Some(hash) = asset.get("contentHash").and_then(|h| h.as_str()) else { continue };
            refs.entry(hash.to_string()).or_default().insert(id.to_string());
            if let Some(name) = asset.get("name").and_then(|n| n.as_str()) {
                names.entry(hash.to_string()).or_insert_with(|| name.to_string());
            }
        }
    };
    if let Ok(rd) = fs::read_dir(projects_dir(root)) {
        let mut dirs: Vec<_> = rd.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| e.file_name());
        for e in dirs {
            if let Some(id) = e.file_name().to_str() {
                read_record(id, &e.path().join("project.json"));
            }
        }
    }
    if let Ok(rd) = fs::read_dir(project_mirror_dir(root).join("projects")) {
        let mut files: Vec<_> = rd.filter_map(|e| e.ok()).collect();
        files.sort_by_key(|e| e.file_name());
        for e in files {
            let name = e.file_name().to_string_lossy().to_string();
            if let Some(id) = name.strip_suffix(".json") {
                read_record(id, &e.path());
            }
        }
    }
    (refs, names)
}

struct RebuildStats {
    refs_rederived: u64,
    titles_reverted: u64,
}

fn rebuild_from_filesystem(root: &Path, corrupt: &[u8]) -> Result<(MediaVaultRegistry, RebuildStats), String> {
    let vault = media_vault_dir(root);
    let hints = lenient_hints(corrupt);
    let (refs, names) = project_record_refs(root);

    let mut registry = MediaVaultRegistry::default();
    let mut stats = RebuildStats { refs_rederived: 0, titles_reverted: 0 };
    let read = match fs::read_dir(&vault) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((registry, stats)),
        Err(e) => return Err(format!("media-vault: scan {}: {e}", vault.display())),
    };
    for entry in read.filter_map(|e| e.ok()) {
        let file_name = entry.file_name().to_string_lossy().to_string();
        let Some(hash) = is_blob_name(&file_name) else { continue };
        let meta = entry.metadata().map_err(|e| format!("stat {file_name}: {e}"))?;
        let hint = hints.get(hash);
        let display_name = hint
            .and_then(|h| h.display_name.clone())
            .or_else(|| names.get(hash).cloned());
        if display_name.is_none() {
            stats.titles_reverted += 1;
        }
        let display_name = display_name.unwrap_or_else(|| format!("{}.bin", &hash[..8]));
        let mime_type = hint
            .and_then(|h| h.mime_type.clone())
            .unwrap_or_else(|| mime_from_name(&display_name).to_string());
        let added_at_ms = hint.and_then(|h| h.added_at_ms).unwrap_or_else(|| {
            meta.modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0)
        });
        let referenced_by_project_ids: Vec<String> =
            refs.get(hash).map(|s| s.iter().cloned().collect()).unwrap_or_default();
        stats.refs_rederived += referenced_by_project_ids.len() as u64;
        registry.entries.insert(
            hash.to_string(),
            MediaVaultEntry {
                content_hash: hash.to_string(),
                display_name,
                mime_type,
                size_bytes: meta.len(),
                added_at_ms,
                referenced_by_project_ids,
            },
        );
    }
    Ok((registry, stats))
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

pub(crate) fn heal_registry(
    root: &Path,
    gate: &RegistryGuard,
) -> Result<(MediaVaultRegistry, Option<VaultRecoveryFinding>), String> {
    heal_registry_with(root, gate, None)
}

/// Runs the ladder against the registry file on disk. Returns the healthy
/// registry (and, when a rung below "full parse" fired, its finding). Caller
/// holds the gate.
pub(crate) fn heal_registry_with(
    root: &Path,
    _gate: &RegistryGuard,
    stop: Option<RecoveryStop>,
) -> Result<(MediaVaultRegistry, Option<VaultRecoveryFinding>), String> {
    let path = registry_file(root);
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((MediaVaultRegistry::default(), None)),
        Err(e) => return Err(format!("media-vault: read {}: {e}", path.display())),
    };
    // Rung (a).
    if let Ok(registry) = strict_parse_registry(&bytes) {
        return Ok((registry, None));
    }

    let corrupt_sha = sha256_hex(&bytes);
    let mut finding = VaultRecoveryFinding {
        kind: KIND_RECOVERED.to_string(),
        mode: None,
        at_ms: now_ms(),
        entries_recovered: 0,
        corrupt_sha256: corrupt_sha.clone(),
        corrupt_bytes: bytes.len() as u64,
        trailing_bytes_discarded: None,
        refs_rederived: None,
        renamed_titles_reverted: None,
        quarantine_path: String::new(),
        detail: String::new(),
        acknowledged: false,
    };

    let registry = if let Some((registry, trailing)) = salvage_first_document(&bytes) {
        // Rung (b).
        finding.mode = Some(RecoveryMode::Salvage);
        finding.trailing_bytes_discarded = Some(trailing);
        finding.detail = format!(
            "registry.json held a complete document followed by {trailing} stray byte(s); the document was kept in full (no entries lost)"
        );
        registry
    } else if let Some(registry) = read_lastgood(root) {
        // Rung (c).
        finding.mode = Some(RecoveryMode::Lastgood);
        finding.detail = "registry.json was unreadable and held no complete document; restored from the verified registry.json.lastgood (changes made after it was written are not in it)".to_string();
        registry
    } else {
        // Rung (d).
        let (registry, stats) = rebuild_from_filesystem(root, &bytes)?;
        finding.mode = Some(RecoveryMode::Rebuild);
        finding.refs_rederived = Some(stats.refs_rederived);
        finding.renamed_titles_reverted = Some(stats.titles_reverted);
        finding.detail = format!(
            "registry.json was unreadable with no usable copy; rebuilt from the vault's blobs and the project records: {} entr{} restored, {} reference(s) re-derived, {} title(s) could not be recovered and show a placeholder filename (any rename on those is lost)",
            registry.entries.len(),
            if registry.entries.len() == 1 { "y" } else { "ies" },
            stats.refs_rederived,
            stats.titles_reverted
        );
        registry
    };
    finding.entries_recovered = registry.entries.len() as u64;

    // Step 1 — keep the replaced bytes.
    let qdir = quarantine_corrupt_registry(root, &bytes, &corrupt_sha, stop)?;
    finding.quarantine_path = qdir.display().to_string();
    // Step 2 — the finding, before the registry changes, so a crash after the
    // replace can never leave a silent recovery.
    persist_finding(root, &finding)?;
    if stop == Some(RecoveryStop::AfterFindingPersisted) {
        return Err("stopped: AfterFindingPersisted".into());
    }
    // Step 3 — replace.
    let json = crate::media_vault::serialize_registry(&registry)?;
    write_bytes_atomic(&path, &json)?;
    maintain_lastgood(root, &json);
    eprintln!(
        "[media_vault] registry recovered ({:?}): {} — corrupt copy kept at {}",
        finding.mode.unwrap(),
        finding.detail,
        finding.quarantine_path
    );
    if stop == Some(RecoveryStop::AfterRegistryReplaced) {
        return Err("stopped: AfterRegistryReplaced".into());
    }
    Ok((registry, Some(finding)))
}

/// App start: run the ladder once so a damaged registry is healed — and its
/// finding persisted — before anything else touches the vault.
pub fn heal_on_boot(root: &Path) -> Result<Option<VaultRecoveryFinding>, String> {
    if !registry_file(root).exists() {
        return Ok(None); // fresh vault — nothing to heal, nothing to create
    }
    let gate = acquire_registry_gate(root)?;
    heal_registry(root, &gate).map(|(_, finding)| finding)
}

/// Unacknowledged findings, for the launch notice and the sync-log view.
#[tauri::command]
pub fn media_vault_recovery_findings(app: tauri::AppHandle) -> Result<Vec<VaultRecoveryFinding>, String> {
    read_findings(&resolve_storage_root(&app)?)
}

#[tauri::command]
pub fn media_vault_recovery_acknowledge(app: tauri::AppHandle) -> Result<u64, String> {
    acknowledge_findings(&resolve_storage_root(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media_vault::{
        media_vault_import_bytes, media_vault_list, rename_display_name, unreference_project,
    };

    fn root(tag: &str) -> PathBuf {
        crate::atomic_stage::TEST_SKIP_FSYNC.store(true, std::sync::atomic::Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "kinetix-vault-recovery-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn registry_bytes(r: &Path) -> Vec<u8> {
        fs::read(registry_file(r)).unwrap()
    }

    /// A populated vault: four entries, renames, two projects, one unreferenced.
    /// Returns the hashes in import order.
    fn populated(r: &Path) -> Vec<String> {
        let mut hashes = Vec::new();
        for (i, (proj, name)) in
            [("proj-a", "intro.mp4"), ("proj-a", "outro.mov"), ("proj-b", "logo.png"), ("proj-b", "music.mp3")]
                .iter()
                .enumerate()
        {
            let e = media_vault_import_bytes(r, proj, format!("bytes-{i}").as_bytes(), name, "x/y").unwrap();
            hashes.push(e.content_hash);
        }
        media_vault_import_bytes(r, "proj-a", b"bytes-2", "logo.png", "x/y").unwrap(); // shared
        rename_display_name(r, &hashes[0], "Renamed Intro.mp4").unwrap();
        unreference_project(r, &hashes[3], "proj-b").unwrap(); // zero-ref
        hashes
    }

    fn snapshot(r: &Path) -> Vec<MediaVaultEntry> {
        let mut v = media_vault_list(r).unwrap();
        for e in v.iter_mut() {
            e.referenced_by_project_ids.sort();
        }
        v.sort_by(|a, b| a.content_hash.cmp(&b.content_hash));
        v
    }

    fn append(r: &Path, tail: &[u8]) {
        let mut b = registry_bytes(r);
        b.extend_from_slice(tail);
        fs::write(registry_file(r), b).unwrap();
    }

    const FIELD_TAIL: &[u8] = b"\n    \"addedAtMs\": 1,\n    \"referencedByProjectIds\": []\n  }\n}\n";

    #[test]
    fn salvage_recovers_the_field_shape_with_zero_loss_and_one_loud_finding() {
        let r = root("salvage");
        populated(&r);
        let before = snapshot(&r);
        append(&r, FIELD_TAIL);
        let corrupt = registry_bytes(&r);

        let after = snapshot(&r); // the load itself heals
        assert_eq!(after, before, "every entry, rename and reference survives");

        let findings = read_findings(&r).unwrap();
        assert_eq!(findings.len(), 1);
        let f = &findings[0];
        assert_eq!((f.kind.as_str(), f.mode), (KIND_RECOVERED, Some(RecoveryMode::Salvage)));
        assert_eq!(f.entries_recovered, before.len() as u64);
        assert_eq!(f.trailing_bytes_discarded, Some(FIELD_TAIL.len() as u64));
        assert!(!f.acknowledged);
        // The replaced bytes are preserved, verified, under quarantine.
        let kept = fs::read(PathBuf::from(&f.quarantine_path).join("data/media-vault/registry.json")).unwrap();
        assert_eq!(kept, corrupt);
        let manifest = crate::storage_quarantine::read_manifest(Path::new(&f.quarantine_path)).unwrap().unwrap();
        assert_eq!(manifest.state, QuarantineState::Complete);
        // The registry on disk is healthy again and unchanged in content.
        assert!(strict_parse_registry(&registry_bytes(&r)).is_ok());

        // A second load is silent: no second finding.
        assert_eq!(snapshot(&r), before);
        assert_eq!(read_findings(&r).unwrap().len(), 1);
        fs::remove_dir_all(&r).ok();
    }

    #[test]
    fn a_first_document_that_is_itself_cut_short_falls_through_to_lastgood() {
        let r = root("lastgood");
        populated(&r);
        let before = snapshot(&r);
        let whole = registry_bytes(&r);
        fs::write(registry_file(&r), &whole[..whole.len() / 2]).unwrap(); // truncated mid-document

        assert_eq!(snapshot(&r), before, "restored from the verified .lastgood");
        let f = read_findings(&r).unwrap().remove(0);
        assert_eq!(f.mode, Some(RecoveryMode::Lastgood));
        assert_eq!(f.trailing_bytes_discarded, None);
        fs::remove_dir_all(&r).ok();
    }

    #[test]
    fn a_registry_that_parses_as_an_empty_shell_is_not_salvaged_over_a_full_one() {
        let r = root("empty-shell");
        populated(&r);
        let before = snapshot(&r);
        // First value is `{}` — parseable, but not a registry document.
        fs::write(registry_file(&r), b"{} \"entries\": {{{ torn").unwrap();
        assert_eq!(snapshot(&r), before, "falls through to .lastgood, not to an empty salvage");
        assert_eq!(read_findings(&r).unwrap()[0].mode, Some(RecoveryMode::Lastgood));
        fs::remove_dir_all(&r).ok();
    }

    #[test]
    fn a_corrupt_lastgood_is_never_trusted_the_ladder_rebuilds_instead() {
        let r = root("bad-lastgood");
        populated(&r);
        let whole = registry_bytes(&r);
        fs::write(registry_file(&r), &whole[..whole.len() / 3]).unwrap();
        fs::write(lastgood_file(&r), b"{ not json at all").unwrap();
        let listed = media_vault_list(&r).unwrap();
        assert_eq!(listed.len(), 4, "all four blobs are found on disk");
        assert_eq!(read_findings(&r).unwrap()[0].mode, Some(RecoveryMode::Rebuild));
        fs::remove_dir_all(&r).ok();
    }

    #[test]
    fn rebuild_rederives_references_and_titles_from_blobs_and_project_records() {
        let r = root("rebuild");
        let hashes = populated(&r);
        // Project records referencing the hashes (the shape project.json uses).
        let rec = |id: &str, assets: &[(&str, &str)]| {
            let body = serde_json::json!({
                "version": 6, "savedAt": 1,
                "project": { "id": id, "name": id, "segments": [],
                    "assets": assets.iter().map(|(h, n)| serde_json::json!({"id": format!("a-{h}"), "name": n, "contentHash": h})).collect::<Vec<_>>() }
            });
            let dir = projects_dir(&r).join(id);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("project.json"), serde_json::to_vec(&body).unwrap()).unwrap();
        };
        rec("proj-a", &[(&hashes[0], "Renamed Intro.mp4"), (&hashes[1], "outro.mov"), (&hashes[2], "logo.png")]);
        rec("proj-b", &[(&hashes[2], "logo.png")]);

        // Destroy both the registry and the last-good copy; leave no hints.
        fs::write(registry_file(&r), b"\x00\x00 garbage, no json here").unwrap();
        fs::remove_file(lastgood_file(&r)).unwrap();

        let rebuilt = snapshot(&r);
        assert_eq!(rebuilt.len(), 4);
        let by_hash: HashMap<_, _> = rebuilt.iter().map(|e| (e.content_hash.clone(), e)).collect();
        assert_eq!(by_hash[&hashes[0]].display_name, "Renamed Intro.mp4", "the rename survives in the project record");
        assert_eq!(by_hash[&hashes[0]].referenced_by_project_ids, vec!["proj-a".to_string()]);
        assert_eq!(by_hash[&hashes[2]].referenced_by_project_ids, vec!["proj-a".to_string(), "proj-b".to_string()]);
        assert_eq!(by_hash[&hashes[0]].mime_type, "video/mp4");
        assert_eq!(by_hash[&hashes[0]].size_bytes, fs::metadata(crate::media_vault::blob_path_for_test(&r, &hashes[0])).unwrap().len());
        // The unreferenced blob has no record naming it: placeholder title, counted.
        assert!(by_hash[&hashes[3]].referenced_by_project_ids.is_empty());
        assert_eq!(by_hash[&hashes[3]].display_name, format!("{}.bin", &hashes[3][..8]));

        let f = read_findings(&r).unwrap().remove(0);
        assert_eq!(f.mode, Some(RecoveryMode::Rebuild));
        assert_eq!(f.refs_rederived, Some(4)); // a: 3, b: 1
        assert_eq!(f.renamed_titles_reverted, Some(1));
        assert!(f.detail.contains("placeholder"));
        fs::remove_dir_all(&r).ok();
    }

    #[test]
    fn rebuild_keeps_titles_it_can_read_out_of_the_damaged_bytes() {
        let r = root("hints");
        let hashes = populated(&r);
        let whole = registry_bytes(&r);
        // Cut the tail off (no complete document) and drop the last-good copy.
        fs::write(registry_file(&r), &whole[..whole.len() - 40]).unwrap();
        fs::remove_file(lastgood_file(&r)).unwrap();
        let rebuilt = snapshot(&r);
        let by_hash: HashMap<_, _> = rebuilt.iter().map(|e| (e.content_hash.clone(), e)).collect();
        assert_eq!(by_hash[&hashes[0]].display_name, "Renamed Intro.mp4", "rename read from the damaged file itself");
        assert_eq!(by_hash[&hashes[1]].display_name, "outro.mov");
        fs::remove_dir_all(&r).ok();
    }

    #[test]
    fn recovery_is_deterministic_on_identical_input() {
        let run = || {
            let r = root("determinism");
            populated(&r);
            let whole = registry_bytes(&r);
            fs::write(registry_file(&r), &whole[..whole.len() / 2]).unwrap();
            let snap = snapshot(&r);
            let mode = read_findings(&r).unwrap()[0].mode;
            fs::remove_dir_all(&r).ok();
            (snap.iter().map(|e| (e.content_hash.clone(), e.display_name.clone(), e.referenced_by_project_ids.clone())).collect::<Vec<_>>(), mode)
        };
        assert_eq!(run(), run());
    }

    /// Crash injection: the recovery "dies" at every phase boundary, for the
    /// salvage rung and the rebuild rung; the next launch must converge on a
    /// healthy registry, the same content, and exactly ONE finding.
    #[test]
    fn a_crash_at_every_recovery_phase_converges_on_restart() {
        for stop in [
            RecoveryStop::AfterQuarantineManifest,
            RecoveryStop::AfterQuarantineCopy,
            RecoveryStop::AfterFindingPersisted,
            RecoveryStop::AfterRegistryReplaced,
        ] {
            for rung in ["salvage", "rebuild"] {
                let r = root("crash");
                populated(&r);
                let expected = snapshot(&r);
                let whole = registry_bytes(&r);
                if rung == "salvage" {
                    append(&r, FIELD_TAIL);
                } else {
                    fs::write(registry_file(&r), &whole[..whole.len() / 2]).unwrap();
                    fs::remove_file(lastgood_file(&r)).unwrap();
                }

                {
                    let gate = acquire_registry_gate(&r).unwrap();
                    let died = heal_registry_with(&r, &gate, Some(stop));
                    assert!(died.is_err(), "{stop:?}/{rung}: the injected crash must surface");
                }
                // ---- restart ----
                let after = snapshot(&r);
                if rung == "salvage" {
                    assert_eq!(after, expected, "{stop:?}/{rung}: salvage loses nothing");
                } else {
                    assert_eq!(after.len(), expected.len(), "{stop:?}/{rung}: every blob is back");
                }
                assert!(strict_parse_registry(&registry_bytes(&r)).is_ok(), "{stop:?}/{rung}");
                let findings = read_findings(&r).unwrap();
                assert_eq!(findings.len(), 1, "{stop:?}/{rung}: exactly one finding, never zero, never two");
                let q = PathBuf::from(&findings[0].quarantine_path);
                assert_eq!(
                    crate::storage_quarantine::read_manifest(&q).unwrap().unwrap().state,
                    QuarantineState::Complete,
                    "{stop:?}/{rung}"
                );
                fs::remove_dir_all(&r).ok();
            }
        }
    }

    #[test]
    fn many_threads_loading_a_corrupt_registry_produce_exactly_one_recovery() {
        let r = root("one-recovery");
        populated(&r);
        let before = snapshot(&r);
        append(&r, FIELD_TAIL);
        let barrier = std::sync::Barrier::new(8);
        std::thread::scope(|s| {
            for _ in 0..8 {
                s.spawn(|| {
                    barrier.wait();
                    assert_eq!(snapshot(&r), before);
                });
            }
        });
        assert_eq!(read_findings(&r).unwrap().len(), 1);
        fs::remove_dir_all(&r).ok();
    }

    #[test]
    fn a_mutation_on_a_corrupt_registry_heals_then_applies() {
        let r = root("mutate-heals");
        populated(&r);
        append(&r, FIELD_TAIL);
        media_vault_import_bytes(&r, "proj-c", b"brand new", "new.png", "image/png").unwrap();
        assert_eq!(media_vault_list(&r).unwrap().len(), 5);
        assert_eq!(read_findings(&r).unwrap().len(), 1);
        fs::remove_dir_all(&r).ok();
    }

    #[test]
    fn lastgood_tracks_every_successful_save_and_is_parse_verified() {
        let r = root("lastgood-maint");
        populated(&r);
        assert_eq!(fs::read(lastgood_file(&r)).unwrap(), registry_bytes(&r));
        media_vault_import_bytes(&r, "proj-z", b"one more", "z.png", "image/png").unwrap();
        assert_eq!(fs::read(lastgood_file(&r)).unwrap(), registry_bytes(&r));
        assert!(strict_parse_registry(&fs::read(lastgood_file(&r)).unwrap()).is_ok());
        fs::remove_dir_all(&r).ok();
    }

    #[test]
    fn a_healthy_load_writes_nothing_and_reports_nothing() {
        let r = root("healthy");
        populated(&r);
        let before = registry_bytes(&r);
        let mtime = fs::metadata(registry_file(&r)).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        snapshot(&r);
        assert_eq!(registry_bytes(&r), before);
        assert_eq!(fs::metadata(registry_file(&r)).unwrap().modified().unwrap(), mtime);
        assert!(read_findings(&r).unwrap().is_empty());
        assert!(!quarantine_dir(&r).exists());
        fs::remove_dir_all(&r).ok();
    }

    #[test]
    fn heal_on_boot_repairs_before_anything_else_reads_and_reports() {
        let r = root("boot");
        populated(&r);
        append(&r, FIELD_TAIL);
        let f = heal_on_boot(&r).unwrap().expect("a recovery is reported at launch");
        assert_eq!(f.mode, Some(RecoveryMode::Salvage));
        assert!(heal_on_boot(&r).unwrap().is_none(), "idempotent");
        // A fresh root creates nothing.
        let fresh = root("boot-fresh");
        assert!(heal_on_boot(&fresh).unwrap().is_none());
        assert!(!media_vault_dir(&fresh).exists());
        fs::remove_dir_all(&r).ok();
        fs::remove_dir_all(&fresh).ok();
    }

    #[test]
    fn acknowledging_keeps_the_record_and_clears_the_notice() {
        let r = root("ack");
        populated(&r);
        append(&r, FIELD_TAIL);
        snapshot(&r);
        assert_eq!(acknowledge_findings(&r).unwrap(), 1);
        let all = read_findings(&r).unwrap();
        assert_eq!(all.len(), 1);
        assert!(all[0].acknowledged);
        assert_eq!(acknowledge_findings(&r).unwrap(), 0);
        fs::remove_dir_all(&r).ok();
    }

    #[test]
    fn an_unreadable_findings_file_is_an_error_never_silence() {
        let r = root("findings-corrupt");
        populated(&r);
        fs::write(findings_path(&r), b"{ torn").unwrap();
        assert!(read_findings(&r).is_err());
        append(&r, FIELD_TAIL);
        assert!(media_vault_list(&r).is_err(), "a recovery that cannot be recorded is refused, not hidden");
        fs::remove_dir_all(&r).ok();
    }
}
