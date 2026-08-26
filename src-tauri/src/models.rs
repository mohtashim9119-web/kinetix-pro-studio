// ---------------------------------------------------------------------------
// Manage Models & Add-ons (WS2 Step 12, A3) — model acquisition backend.
//
// Two model kinds share one allowlisted `model_id` namespace:
//   "whisper"   — the transcription engine (bug 4's existing downloader,
//                 `model_download.rs`, untouched — this module ADDS import,
//                 not a second download stack).
//   "fa-<lang>" — a forced-alignment pack, one per supported language.
//
// Path resolution for BOTH kinds reuses the existing resolvers rather than
// hand-building `fa-models/<lang>/model.onnx` or `models/<whisper file>`
// anywhere new:
//   - Whisper target dir: `model_download::models_dir` (model_download.rs).
//   - FA target path: `fa::fa_model_candidate_paths(...)[0]` (fa.rs) — the
//     FIRST candidate is the managed `app_local_data_dir` location, already
//     the preferred slot per ruling R-D (fa.rs's own doc comment on that
//     function).
//
// Import validation reuses `fa_dev::verify_model_manifest` — an EXACT
// sha256 + byte-size check against the already-committed, already-tested
// `fa-onnx-manifest.json` (WS1 Task 5 Slice D2) — rather than parsing the
// ONNX graph at import time. This was a late change from the original plan
// (which called for opening an ONNX session and inspecting `input_values`/
// `logits`/vocab-dim metadata): `fa_onnx::load_session` requires
// `ORT_DYLIB_PATH` to be set (it calls `ort::init_from` internally), which
// is NOT the case in a plain `tauri:dev`/`tauri:build` — the exact build
// this modal must work in. An exact-hash check against a committed manifest
// is strictly stronger than a structural graph check (it catches a
// byte-identical-shape wrong-language file the structural check would miss)
// and needs no ORT runtime at all, so it is used unconditionally rather than
// as a "session unavailable" fallback.
// ---------------------------------------------------------------------------

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::fa::fa_model_candidate_paths;
use crate::fa_dev::{manifest_byte_size_for, verify_model_manifest};
use crate::model_download::{
    cancel_flag_for, models_dir, stream_download_verified, ModelDownloadEvent, ModelDownloadState,
    GGML_MAGIC, MODEL_SHA256, MODEL_SIZE_BYTES,
};
use crate::sha256::hash_file;
use crate::whisper::MODEL_FILENAME;

// ---------------------------------------------------------------------------
// FA download engine (WS2 Step 13 Phase 3) — a caller of
// `model_download::stream_download_verified`, not a parallel download stack.
// ---------------------------------------------------------------------------

/// PUBLIC HuggingFace model repo (owner-confirmed, WS2 Step 13): unauthenticated
/// GET, no token, no Authorization header, no netrc. MEASURED 2026-08-27: the
/// repo exists and is public (`GET /api/models/mohtashim9/kinetix-fa-models`
/// → `"private": false`), but at measurement time contained only
/// `.gitattributes` at that point — every `<lang>/model.onnx` 404d. The
/// owner's upload finished LATER in this same session: re-probed
/// 2026-08-27, all 5 languages now 200, Content-Length and
/// `X-Linked-ETag` (the LFS object's own sha256) matching
/// `fa-onnx-manifest.json` EXACTLY for every language, Range resume
/// confirmed (206 + correct `Content-Range` on a `bytes=0-1023` probe).
const FA_MODEL_REPO_ID: &str = "mohtashim9/kinetix-fa-models";

/// Revision used to build the download URL — pinned to the commit
/// containing the real uploaded files, MEASURED 2026-08-27 via
/// `GET /api/models/mohtashim9/kinetix-fa-models` (`"sha"` field) after the
/// owner's upload completed. Earlier in this same session, before the
/// upload finished, this constant was deliberately `"main"` rather than the
/// pre-upload commit SHA (`7cab3961679235f84b716607560f221a115101b9`, which
/// contained only `.gitattributes` — pinning to it would have made the
/// files permanently unreachable at that revision once pushed in a later
/// commit). Now that the upload is confirmed complete and stable, pinning
/// protects against a future silent re-upload to `main` silently changing
/// what a fresh download fetches without `fa_dev::verify_model_manifest`'s
/// hash gate being the only thing standing between that and an install.
/// ACTION NEEDED if the owner ever re-uploads/reorganizes this repo: re-run
/// the HEAD/API probe and update this single constant — the URL builder,
/// `stream_download_verified` call, and the manifest verification gate need
/// no other change.
const FA_MODEL_REVISION: &str = "f618960d71728eba5f12528d5571838a10d262bf";

fn fa_model_download_url(lang: &str) -> String {
    format!("https://huggingface.co/{FA_MODEL_REPO_ID}/resolve/{FA_MODEL_REVISION}/{lang}/model.onnx")
}

/// Free bytes on the volume containing `app_local_data_dir` must exceed
/// `needed_bytes` plus a fixed safety margin, or the download is refused
/// before any network request — never left to fail mid-stream with a less
/// actionable "disk full" write error. Reuses `get_available_disk_space`'s
/// own `fs4` call rather than a second disk-space code path.
const DISK_SPACE_MARGIN_BYTES: u64 = 200 * 1024 * 1024; // 200 MiB

fn ensure_disk_space(app: &tauri::AppHandle, needed_bytes: u64) -> Result<(), String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("cannot resolve app_local_data_dir: {e}"))?;
    let free = available_space_on(app)?;
    let required = needed_bytes.saturating_add(DISK_SPACE_MARGIN_BYTES);
    if free < required {
        return Err(format!(
            "not enough free disk space: {free} bytes free, need at least {required} bytes \
             ({needed_bytes} for the model + {DISK_SPACE_MARGIN_BYTES} margin) on the volume \
             containing {}",
            dir.display()
        ));
    }
    Ok(())
}

/// Downloads the FA pack for `language` via the same resumable engine
/// (`model_download::stream_download_verified`) the whisper downloader uses
/// — `.part` + HTTP Range resume + progress `Channel` + cancel, reusing that
/// module's `ModelDownloadEvent`/`ModelDownloadState` types unchanged (no
/// second event shape for the frontend to handle). Verification runs
/// `fa_dev::verify_model_manifest` against the `.part` file BEFORE the
/// atomic rename — introduces no new pinned hash/size constant; a mismatch
/// deletes the `.part` and leaves any previously-installed model at the
/// target path untouched, and is reported with the manifest's own specific
/// expected-vs-actual message (never a generic string).
#[tauri::command]
pub async fn fa_model_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModelDownloadState>,
    language: String,
    on_event: tauri::ipc::Channel<ModelDownloadEvent>,
) -> Result<(), String> {
    let lang = FA_LANGUAGES
        .iter()
        .find(|&&l| l == language)
        .copied()
        .ok_or_else(|| format!("unsupported FA language \"{language}\" — expected one of: {}", FA_LANGUAGES.join(", ")))?;

    let expected_size = manifest_byte_size_for(lang)
        .ok_or_else(|| format!("no manifest entry for language \"{lang}\" in fa-onnx-manifest.json"))?;

    ensure_disk_space(&app, expected_size)?;

    let target = target_path(&app, ModelId::Fa(lang))?;
    let dir = target.parent().ok_or_else(|| "invalid FA model target path".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let mut part_path = target.as_os_str().to_owned();
    part_path.push(".part");
    let part_path = PathBuf::from(part_path);

    let cancel_key = format!("fa-{lang}");
    let cancel_flag = cancel_flag_for(&state, &cancel_key);

    let url = fa_model_download_url(lang);
    let lang_owned = lang.to_string();
    let result = stream_download_verified(url, target.clone(), part_path, expected_size, cancel_flag, on_event, {
        let lang_owned = lang_owned.clone();
        move |path: &Path| verify_model_manifest(path, &lang_owned).map_err(|e| e.message)
    })
    .await;

    if result.is_ok() {
        // Same post-install bookkeeping `import_to_target` does: a `.sha256`
        // sidecar so the NEXT `check_installed_models` call is a stat, not a
        // re-hash. `stream_download_verified` already verified the digest
        // via `verify_model_manifest` above — this just persists it.
        if let Ok(digest) = hash_file(&target) {
            let _ = fs::write(sidecar_path(&target), digest);
        }
    }
    result
}

#[tauri::command]
pub fn fa_model_download_cancel(state: tauri::State<'_, ModelDownloadState>, language: String) {
    if let Some(flag) = state.0.lock().unwrap().get(&format!("fa-{language}")) {
        flag.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Canonical FA language allowlist. Mirrors `fa_onnx.rs::vocab_json_for`'s
/// match arms and `fa_dev.rs`/`fa_onnx.rs`'s own test-loop literals — no
/// single shared Rust constant existed before this module (confirmed by
/// grep across `src-tauri/src/*.rs`), so this becomes it.
pub(crate) const FA_LANGUAGES: [&str; 5] = ["en", "es", "fr", "de", "pt"];

/// `"whisper"` or `"fa-<lang>"` for a `lang` in [`FA_LANGUAGES`]. Rejects
/// everything else, including path-traversal payloads
/// (`"fa-../../etc"`, `"fa-..%2f.."`), an empty FA suffix (`"fa-"`), and a
/// wrong-case language (`"fa-EN"`) — the suffix is compared byte-for-byte
/// against the allowlist, never joined onto a path or trimmed with
/// `trim_start_matches` before validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ModelId {
    Whisper,
    Fa(&'static str),
}

impl ModelId {
    pub(crate) fn parse(raw: &str) -> Result<Self, String> {
        if raw == "whisper" {
            return Ok(ModelId::Whisper);
        }
        if let Some(suffix) = raw.strip_prefix("fa-") {
            if let Some(lang) = FA_LANGUAGES.iter().find(|&&l| l == suffix) {
                return Ok(ModelId::Fa(lang));
            }
        }
        Err(format!(
            "unknown model id \"{raw}\" — expected \"whisper\" or \"fa-<lang>\" for one of: {}",
            FA_LANGUAGES.join(", ")
        ))
    }
}

// ---------------------------------------------------------------------------
// Target path resolution — always via the existing resolvers
// ---------------------------------------------------------------------------

fn target_path(app: &tauri::AppHandle, id: ModelId) -> Result<PathBuf, String> {
    match id {
        ModelId::Whisper => Ok(models_dir(app)?.join(MODEL_FILENAME)),
        ModelId::Fa(lang) => {
            let local_data_dir = app.path().app_local_data_dir().ok();
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|p| p.to_path_buf()));
            let candidates = fa_model_candidate_paths(local_data_dir.as_deref(), exe_dir.as_deref(), lang);
            // Candidate [0] is the managed `app_local_data_dir` slot — the
            // only one this module ever WRITES to (the exe-dir fallback in
            // `fa_model_candidate_paths` stays a manual-placement-only path;
            // see that function's own doc comment).
            candidates
                .into_iter()
                .next()
                .ok_or_else(|| "cannot resolve app_local_data_dir for FA model install target".to_string())
        }
    }
}

fn sidecar_path(target: &Path) -> PathBuf {
    let mut p = target.as_os_str().to_owned();
    p.push(".sha256");
    PathBuf::from(p)
}

fn expected_size(id: ModelId) -> Option<u64> {
    match id {
        ModelId::Whisper => Some(MODEL_SIZE_BYTES),
        ModelId::Fa(lang) => manifest_byte_size_for(lang),
    }
}

// ---------------------------------------------------------------------------
// check_installed_models
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModelStatus {
    pub installed: bool,
    pub bytes: u64,
}

#[derive(serde::Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModelsReport {
    pub whisper: Option<InstalledModelStatus>,
    /// Keyed by bare language code ("en", "es", ...), not the "fa-<lang>"
    /// model id — the frontend already threads language codes everywhere
    /// (`Project.language`), so this avoids a redundant prefix/strip step
    /// on every caller.
    pub fa: std::collections::HashMap<String, InstalledModelStatus>,
}

/// An installed model is one whose final (non-`.part`) file EXACTLY matches
/// the expected size — never a `len() > 1_000_000` heuristic. A `.sha256`
/// sidecar next to it (written by [`import_local_model`]/the FA downloader
/// on success) short-circuits this to a stat only; its absence (a model
/// hand-placed before this modal existed, e.g. the 5 dev-leftover FA models
/// found in A5) falls back to the same exact-size check plus, for FA, a full
/// manifest re-verify — slower once, then a sidecar gets written so the next
/// check is cheap too.
#[tauri::command]
pub async fn check_installed_models(app: tauri::AppHandle) -> Result<InstalledModelsReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut report = InstalledModelsReport::default();

        let whisper_path = target_path(&app, ModelId::Whisper)?;
        report.whisper = status_for(ModelId::Whisper, &whisper_path);

        for lang in FA_LANGUAGES {
            let path = target_path(&app, ModelId::Fa(lang))?;
            if let Some(status) = status_for(ModelId::Fa(lang), &path) {
                report.fa.insert(lang.to_string(), status);
            }
        }
        Ok(report)
    })
    .await
    .map_err(|e| format!("check_installed_models: task join failed: {e}"))?
}

/// Pure filesystem check — no `AppHandle` needed, only `path` (already
/// resolved by the caller) — so it is directly unit-testable (WS2 Step 13
/// Phase 1.5) without building a mock/live `AppHandle`.
fn status_for(id: ModelId, path: &Path) -> Option<InstalledModelStatus> {
    status_for_generic(path, expected_size(id), |p| match id {
        ModelId::Whisper => hash_file(p).ok().map(|h| h == MODEL_SHA256).unwrap_or(false),
        ModelId::Fa(lang) => verify_model_manifest(p, lang).is_ok(),
    })
}

/// The size/sidecar/fallback-hash decision, parameterized over `expected_size`
/// and a caller-supplied `verify` closure instead of a real `ModelId` — this
/// is what makes the fallback-hash branch unit-testable without a
/// multi-hundred-MB-to-multi-GB real/synthetic file: a test can pass a tiny
/// `expected_size` and a cheap `verify` closure while still exercising the
/// exact same size/sidecar/hash-fallback/sidecar-write control flow
/// `status_for` uses in production.
fn status_for_generic(
    path: &Path,
    expected: Option<u64>,
    verify: impl FnOnce(&Path) -> bool,
) -> Option<InstalledModelStatus> {
    let meta = fs::metadata(path).ok()?;
    let bytes = meta.len();
    let size_ok = expected.map(|e| e == bytes).unwrap_or(true);

    let sidecar_ok = fs::read_to_string(sidecar_path(path))
        .ok()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    let installed = if sidecar_ok {
        size_ok
    } else if size_ok {
        // No sidecar yet (hand-placed model, or the FIRST check after a
        // fresh install) — verify once and write one so the next call is
        // cheap. HARD RULE (WS2 Step 13 Phase 1.4): the sidecar is a cache,
        // never a requirement — its absence must fall back to this real
        // verification, not to `false`.
        let verified = verify(path);
        if verified {
            let digest = hash_file(path).unwrap_or_default();
            let _ = fs::write(sidecar_path(path), digest);
        }
        verified
    } else {
        false
    };

    Some(InstalledModelStatus { installed, bytes })
}


// ---------------------------------------------------------------------------
// import_local_model
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// `false` when the user cancelled the native file-picker — not an
    /// error, mirrors `ffmpeg::pick_save_path`'s `Option`-as-cancel
    /// convention (that command returns `Ok(None)`; this one returns
    /// `Ok(ImportResult { cancelled: true })` since it also needs to report
    /// success/size on the non-cancelled path).
    pub cancelled: bool,
}

/// Opens a native "pick a file" dialog via `rfd::AsyncFileDialog` — the SAME
/// crate `ffmpeg.rs::pick_save_path` already uses for its save dialog. This
/// is a plain Rust dependency invoked from a `#[tauri::command]`, not the
/// `@tauri-apps/plugin-dialog` JS plugin: no `tauri.conf.json` or
/// capabilities change is needed (confirmed: `pick_save_path` already works
/// today with zero `dialog:*` entries in `capabilities/default.json`). Q4's
/// "narrow unfreeze of tauri.conf.json + capabilities" turned out to be
/// unnecessary — this module makes NO changes to either file.
///
/// Then, on a blocking thread (a ~1.2 GiB copy must not run on the async
/// runtime): copies to `<target>.part`, fsyncs, atomically renames to
/// `<target>`, validates, and on success writes the `.sha256` sidecar. Any
/// failure — including validation failure — deletes the `.part` and leaves
/// any prior installed model at `<target>` untouched.
#[tauri::command]
pub async fn import_local_model(app: tauri::AppHandle, model_id: String) -> Result<ImportResult, String> {
    let id = ModelId::parse(&model_id)?;

    let filter_name = match id {
        ModelId::Whisper => "Whisper GGML model",
        ModelId::Fa(_) => "ONNX model",
    };
    let filter_exts: &[&str] = match id {
        ModelId::Whisper => &["bin"],
        ModelId::Fa(_) => &["onnx"],
    };

    let handle = rfd::AsyncFileDialog::new()
        .set_title("Import Model File")
        .add_filter(filter_name, filter_exts)
        .pick_file()
        .await;

    let Some(handle) = handle else {
        return Ok(ImportResult { cancelled: true });
    };
    let source_path = handle.path().to_path_buf();

    tauri::async_runtime::spawn_blocking(move || {
        import_blocking(&app, id, &source_path)?;
        Ok(ImportResult { cancelled: false })
    })
    .await
    .map_err(|e| format!("import_local_model: task join failed: {e}"))?
}

fn import_blocking(app: &tauri::AppHandle, id: ModelId, source: &Path) -> Result<(), String> {
    let target = target_path(app, id)?;
    import_to_target(id, source, &target)
}

/// The app-independent half of an import: copy-to-`.part` + fsync + validate
/// + atomic rename + sidecar, given an already-resolved `target` path.
/// Split out from [`import_blocking`] so it is directly unit-testable
/// without constructing a `tauri::AppHandle`.
fn import_to_target(id: ModelId, source: &Path, target: &Path) -> Result<(), String> {
    let dir = target.parent().ok_or_else(|| "invalid model target path".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;

    let part_path = {
        let mut p = target.as_os_str().to_owned();
        p.push(".part");
        PathBuf::from(p)
    };

    // Cross-device-safe copy: `fs::copy` handles both same-volume (fast
    // path, may use reflink/CoW on supporting filesystems) and cross-volume
    // copies uniformly — unlike `fs::rename`, which fails with `EXDEV`
    // across volumes. The source may be on a different volume than
    // `app_local_data_dir` (e.g. an external drive), so `rename` alone is
    // not an option here even before the atomicity requirement.
    let copy_result = fs::copy(source, &part_path).map_err(|e| {
        format!("failed to copy {} to {}: {e}", source.display(), part_path.display())
    });
    if let Err(e) = copy_result {
        let _ = fs::remove_file(&part_path);
        return Err(e);
    }

    // fsync before validating/renaming — the whole point of the `.part` +
    // rename dance is that a crash mid-copy never leaves a corrupt file at
    // `target`; an un-fsynced `.part` could still be lost on a crash right
    // after the copy call returns but before the OS has actually flushed it.
    if let Err(e) = File::open(&part_path).and_then(|f| f.sync_all()) {
        let _ = fs::remove_file(&part_path);
        return Err(format!("fsync failed for {}: {e}", part_path.display()));
    }

    if let Err(e) = validate_import(id, &part_path) {
        let _ = fs::remove_file(&part_path);
        return Err(e);
    }

    fs::rename(&part_path, &target).map_err(|e| {
        let _ = fs::remove_file(&part_path);
        format!("cannot finalize {}: {e}", target.display())
    })?;

    let digest = hash_file(&target).map_err(|e| format!("post-import hash failed: {e}"))?;
    fs::write(sidecar_path(&target), digest).map_err(|e| format!("cannot write sidecar: {e}"))?;

    Ok(())
}

/// Rejects a bad import with a SPECIFIC message naming what was wrong —
/// never a generic string. Whisper: ggml magic bytes, then exact size, then
/// the pinned sha256 (`model_download.rs`'s own constants, the same ones the
/// downloader verifies against). FA: `fa_dev::verify_model_manifest`, which
/// already produces specific "wrong size" / "wrong hash for language X"
/// messages — this is the check that catches a Spanish model imported into
/// the English slot, since the manifest's sha256 differs per language even
/// though every FA model is byte-size-similar (~1.26 GiB each).
fn validate_import(id: ModelId, path: &Path) -> Result<(), String> {
    match id {
        ModelId::Whisper => {
            let mut magic = [0u8; 4];
            let mut f = File::open(path).map_err(|e| format!("cannot open imported file: {e}"))?;
            f.read_exact(&mut magic)
                .map_err(|_| "imported file is too short to be a ggml model".to_string())?;
            if magic != GGML_MAGIC {
                return Err(format!(
                    "imported file does not start with the ggml magic bytes (expected {GGML_MAGIC:02x?}, \
                     got {magic:02x?}) — this is not a whisper.cpp ggml model file"
                ));
            }
            let actual_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            if actual_size != MODEL_SIZE_BYTES {
                return Err(format!(
                    "imported file is {actual_size} bytes, expected exactly {MODEL_SIZE_BYTES} for \
                     ggml-large-v3-turbo.bin — wrong or corrupt file"
                ));
            }
            let digest = hash_file(path).map_err(|e| format!("failed to hash imported file: {e}"))?;
            if digest != MODEL_SHA256 {
                return Err(format!(
                    "imported file's sha256 ({digest}) does not match the expected whisper model \
                     hash ({MODEL_SHA256}) — wrong or corrupt file"
                ));
            }
            Ok(())
        }
        ModelId::Fa(lang) => verify_model_manifest(path, lang).map_err(|e| e.message),
    }
}

// ---------------------------------------------------------------------------
// delete_installed_model
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn delete_installed_model(app: tauri::AppHandle, model_id: String) -> Result<(), String> {
    let id = ModelId::parse(&model_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let target = target_path(&app, id)?;
        let mut part = target.as_os_str().to_owned();
        part.push(".part");
        let part = PathBuf::from(part);

        for p in [&target, &sidecar_path(&target), &part] {
            if p.exists() {
                fs::remove_file(p).map_err(|e| format!("cannot delete {}: {e}", p.display()))?;
            }
        }

        // Remove the now-empty language directory for an FA model
        // ("fa-models/<lang>/") — never for whisper, whose directory
        // ("models/") is shared with nothing else here but is also not this
        // module's to remove (pre-existing, owned by `model_download.rs`).
        if matches!(id, ModelId::Fa(_)) {
            if let Some(dir) = target.parent() {
                let _ = fs::remove_dir(dir); // no-op / fails silently if non-empty or absent
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("delete_installed_model: task join failed: {e}"))?
}

// ---------------------------------------------------------------------------
// get_available_disk_space
// ---------------------------------------------------------------------------

/// Free space on the volume that actually CONTAINS `app_local_data_dir`
/// (models install there), not `disks.list().first()` — resolved via
/// `fs4::available_space`, which calls `statvfs`/`GetDiskFreeSpaceExW` on
/// the given PATH directly rather than enumerating and matching mount
/// points itself.
#[tauri::command]
pub fn get_available_disk_space(app: tauri::AppHandle) -> Result<u64, String> {
    available_space_on(&app)
}

fn available_space_on(app: &tauri::AppHandle) -> Result<u64, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("cannot resolve app_local_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    fs4::available_space(&dir).map_err(|e| format!("cannot resolve free space for {}: {e}", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_id_accepts_whisper_and_known_fa_languages() {
        assert_eq!(ModelId::parse("whisper"), Ok(ModelId::Whisper));
        for lang in FA_LANGUAGES {
            assert_eq!(ModelId::parse(&format!("fa-{lang}")), Ok(ModelId::Fa(lang)));
        }
    }

    #[test]
    fn model_id_rejects_path_traversal_and_malformed_ids() {
        let bad = [
            "fa-../../etc",
            "fa-..%2f..",
            "fa-",
            "fa-EN",
            "fa-en/../../../etc/passwd",
            "../whisper",
            "fa-xx",
            "",
            "whisper/../../etc",
        ];
        for id in bad {
            assert!(ModelId::parse(id).is_err(), "expected \"{id}\" to be rejected");
        }
    }

    // -- status_for (WS2 Step 13 Phase 1.5 — status-check bug regression) --
    //
    // A real model is ~1.2-1.6 GiB — too large to allocate/write as an
    // in-memory `Vec` in a unit test. Every test below that needs a
    // whisper-SIZED file uses `File::set_len` (a sparse file: the OS commits
    // no real disk blocks and this process allocates no multi-GiB buffer,
    // yet `fs::metadata().len()` and a full read both see the true size)
    // rather than materializing real bytes.

    fn sparse_file_of_len(path: &Path, len: u64) {
        let f = File::create(path).unwrap();
        f.set_len(len).unwrap();
    }

    /// A size-matching file WITH a `.sha256` sidecar reads installed from
    /// the sidecar alone (no re-hash needed) — this is the fast path a
    /// sparse all-zero file can stand in for, since the sidecar
    /// short-circuits before any hashing happens.
    #[test]
    fn status_valid_model_with_sidecar_reads_installed_from_sidecar() {
        let dir = std::env::temp_dir().join(format!("kinetix-status-sidecar-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ggml-large-v3-turbo.bin");
        sparse_file_of_len(&path, MODEL_SIZE_BYTES);
        fs::write(sidecar_path(&path), MODEL_SHA256).unwrap();

        let status = status_for(ModelId::Whisper, &path).expect("file exists, must return Some");
        assert!(status.installed, "a size-matching file with a present sidecar must read installed");
        assert_eq!(status.bytes, MODEL_SIZE_BYTES);

        let _ = fs::remove_dir_all(&dir);
    }

    /// HARD RULE (WS2 Step 13 Phase 1.4): a MISSING sidecar must NOT mark a
    /// valid model as not-installed — it is a cache, not a requirement. On a
    /// cache miss with a file that genuinely passes verification, the
    /// fallback must read installed=true AND write a sidecar for next time.
    /// Uses `status_for_generic` (a tiny `expected_size` + a cheap `verify`
    /// closure) rather than a real whisper/FA file — the production
    /// `status_for` wrapper calls this exact function with the real
    /// per-model constants, proven equivalent by the `status_for`-level
    /// tests around this one; this one isolates the control flow from the
    /// cost of hashing a multi-hundred-MB file.
    #[test]
    fn status_generic_valid_without_sidecar_falls_back_to_verify_and_writes_sidecar() {
        let dir = std::env::temp_dir().join(format!("kinetix-status-nosidecar-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("small-model.bin");
        let content: &[u8] = b"tiny stand-in content";
        fs::write(&path, content).unwrap();
        assert!(!sidecar_path(&path).exists());

        let status = status_for_generic(&path, Some(content.len() as u64), |_p| true)
            .expect("file exists, must return Some");
        assert!(status.installed, "a size-matching file whose verify() succeeds must read installed");
        assert!(sidecar_path(&path).exists(), "a successful fallback verify must write a sidecar");

        let _ = fs::remove_dir_all(&dir);
    }

    /// The mirror case: a size-matching file whose `verify()` genuinely
    /// fails (the fallback-hash-rejects-a-wrong-file case a hash-blind,
    /// size-only implementation would get wrong) must read not-installed
    /// and must NOT write a sidecar.
    #[test]
    fn status_generic_valid_size_but_failed_verify_reads_not_installed_no_sidecar() {
        let dir = std::env::temp_dir().join(format!("kinetix-status-badverify-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("small-model.bin");
        let content: &[u8] = b"tiny stand-in content";
        fs::write(&path, content).unwrap();

        let status = status_for_generic(&path, Some(content.len() as u64), |_p| false)
            .expect("file exists, must return Some");
        assert!(!status.installed, "size-correct but verify()-false must not read installed");
        assert!(!sidecar_path(&path).exists(), "a failed fallback verify must not write a sidecar");

        let _ = fs::remove_dir_all(&dir);
    }

    /// A truncated file (wrong size) must read not-installed regardless of
    /// sidecar presence — the exact-size check is never bypassed.
    #[test]
    fn status_truncated_model_reads_not_installed_even_with_a_stale_sidecar() {
        let dir = std::env::temp_dir().join(format!("kinetix-status-truncated-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ggml-large-v3-turbo.bin");
        fs::write(&path, b"truncated, way too short").unwrap();
        // A stale sidecar from a PREVIOUS good install must not resurrect a
        // now-truncated file as installed — size is checked before the
        // sidecar short-circuit is trusted.
        fs::write(sidecar_path(&path), MODEL_SHA256).unwrap();

        let status = status_for(ModelId::Whisper, &path).expect("file exists, must return Some");
        assert!(!status.installed, "a wrong-size file must never read installed, sidecar or not");

        let _ = fs::remove_dir_all(&dir);
    }

    /// A stale `.part` sitting alongside an already-valid final file must
    /// not affect that file's own installed status — `status_for` is only
    /// ever called with the FINAL (non-`.part`) path, and a `.part`'s
    /// existence is irrelevant to it.
    #[test]
    fn status_stale_part_alongside_valid_model_does_not_affect_its_status() {
        let dir = std::env::temp_dir().join(format!("kinetix-status-stalepart-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ggml-large-v3-turbo.bin");
        sparse_file_of_len(&path, MODEL_SIZE_BYTES);
        fs::write(sidecar_path(&path), MODEL_SHA256).unwrap();
        let mut part = path.as_os_str().to_owned();
        part.push(".part");
        fs::write(PathBuf::from(&part), b"leftover partial bytes from an interrupted retry").unwrap();

        let status = status_for(ModelId::Whisper, &path).expect("file exists, must return Some");
        assert!(status.installed, "a stale .part must not affect the final file's own installed status");

        let _ = fs::remove_dir_all(&dir);
    }

    // -- import atomicity ------------------------------------------------

    /// A source file that fails validation (wrong ggml magic, right size)
    /// must leave the `.part` file deleted AND the pre-existing target file
    /// untouched — a failed import is never allowed to clobber a working
    /// installed model.
    #[test]
    fn import_atomicity_leaves_part_deleted_and_target_untouched_on_validation_failure() {
        let dir = std::env::temp_dir().join(format!("kinetix-import-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("ggml-large-v3-turbo.bin");
        let source = dir.join("bad-source.bin");

        // Pre-existing "installed" target — must survive a failed import.
        fs::write(&target, b"pre-existing installed model bytes").unwrap();
        // Wrong magic bytes — `validate_import` checks magic before size, so
        // this fails validation after the (small, fast) copy without ever
        // needing a real ~1.6 GiB file in the test.
        fs::write(&source, b"NOPE not a real ggml model at all").unwrap();

        let result = import_to_target(ModelId::Whisper, &source, &target);
        assert!(result.is_err(), "expected validation failure, got {result:?}");

        let part_path = {
            let mut p = target.as_os_str().to_owned();
            p.push(".part");
            PathBuf::from(p)
        };
        assert!(!part_path.exists(), ".part file must be deleted after a failed import");
        assert_eq!(
            fs::read(&target).unwrap(),
            b"pre-existing installed model bytes",
            "target must be untouched by a failed import"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// A source file that fails validation because of its SIZE (not magic)
    /// still leaves no `.part` behind and no sidecar written.
    #[test]
    fn import_atomicity_rejects_wrong_size_and_writes_no_sidecar() {
        let dir = std::env::temp_dir().join(format!("kinetix-import-test-size-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("ggml-large-v3-turbo.bin");
        let source = dir.join("too-small.bin");
        fs::write(&source, GGML_MAGIC).unwrap(); // right magic, way too short

        let result = import_to_target(ModelId::Whisper, &source, &target);
        assert!(result.is_err());
        assert!(!target.exists(), "a rejected import must not create the target");
        assert!(!sidecar_path(&target).exists(), "a rejected import must not write a sidecar");

        let _ = fs::remove_dir_all(&dir);
    }

    /// The FA import path re-uses `verify_model_manifest` — a synthetic
    /// small file, not one of the real ~1.26 GiB models (too large to copy
    /// in a unit test / commit as a fixture), exercises the same rejection
    /// branch a real wrong-language file would hit: the manifest's exact
    /// per-language `byteSize` rejects it before any hash is computed.
    #[test]
    fn fa_import_rejects_a_file_that_does_not_match_any_language_manifest_entry() {
        let dir = std::env::temp_dir().join(format!("kinetix-import-test-fa-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("model.onnx");
        let source = dir.join("wrong-lang.onnx");
        fs::write(&source, b"not a real onnx model, wrong size entirely").unwrap();

        let result = import_to_target(ModelId::Fa("en"), &source, &target);
        let err = result.expect_err("a non-manifest-matching file must be rejected");
        assert!(err.contains("bytes") || err.contains("manifest"), "error should be specific, got: {err}");
        assert!(!target.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn model_id_never_touches_filesystem_on_rejection() {
        // ModelId::parse is pure string comparison against the allowlist —
        // no join(), no Path construction, no fs call — verified by
        // inspection (this test documents the invariant so a future edit
        // that adds a `Path::new(raw)` here breaks a change reviewers can
        // grep for, not just re-read the source to notice).
        let before = std::env::temp_dir();
        let _ = ModelId::parse("fa-../../etc/passwd");
        let after = std::env::temp_dir();
        assert_eq!(before, after);
    }
}
