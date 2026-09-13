//! Round 27 (Step 2) — folder-pick recovery support.
//!
//! The degraded-project recovery screen's PRIMARY action is "pick the folder
//! your originals live in". This module owns the two native pieces that view
//! cannot do from the WebView:
//!
//! 1. `relink_pick_folder` — a native directory dialog (rfd). The WebView
//!    cannot enumerate the operator's filesystem; only the shell can.
//! 2. `relink_list_folder` — walks the picked folder and returns one
//!    candidate descriptor per media file (name, size, path, inferred type,
//!    probed duration). The frontend's pure matcher
//!    (`src/services/relinkResolution/matchProposals.ts`) ranks these
//!    against the project's unresolved assets; this module never decides a
//!    match.
//!
//! The actual byte write is `asset_store_write_from_path` in `asset_store.rs`
//! — kept there because it shares `write_asset_atomic_provenanced` with the
//! import path and records the same provenance.
//!
//! Duration probing is BEST-EFFORT: it shells out to the bundled ffmpeg
//! sidecar (the same `ffmpeg_probe_duration_secs` `probe_audio_duration`
//! uses). A probe failure (no sidecar in `cargo test`, a non-media file,
//! a corrupt header) yields `duration: None` — the matcher treats a null
//! candidate duration as `within-probable`, so a name-exact match without a
//! probed duration ranks `probable`, never `exact`, and is therefore NOT
//! auto-accepted. That is the correct posture: an unprobed candidate must
//! not be silently written.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// One candidate file from a folder pick. Mirrors the frontend
/// `RelinkCandidate` (`src/services/relinkResolution/types.ts`); the host
/// maps these onto the matcher's input shape.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkCandidateFile {
    /// `crypto.randomUUID()` — a stable handle for this pick so the matcher's
    /// `candidateId` survives a re-render. Not the file's path.
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    /// `'image' | 'video' | 'audio'`, inferred from the extension. `'video'`
    /// /`'audio'` only — anything else is reported as `null` and skipped by
    /// the caller (non-media files are not recovery candidates).
    pub media_type: Option<String>,
    /// Probed duration in seconds. `None` for images, probe misses, and
    /// non-media files.
    pub duration: Option<f64>,
}

/// Opens a native "select folder" dialog and returns the chosen path, or
/// `None` if the operator cancelled. Pure UI — no filesystem side effects.
#[tauri::command]
pub async fn relink_pick_folder() -> Result<Option<String>, String> {
    let handle = rfd::AsyncFileDialog::new()
        .set_title("Pick the folder your original media lives in")
        .pick_folder()
        .await;
    Ok(handle.map(|p| p.path().to_string_lossy().into_owned()))
}

fn infer_media_type(path: &Path) -> Option<&'static str> {
    let ext = path.extension().and_then(|e| e.to_str())?.to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "mov" | "m4v" | "webm" | "mkv" | "avi" => Some("video"),
        "wav" | "mp3" | "m4a" | "aac" | "ogg" | "flac" => Some("audio"),
        "png" | "jpg" | "jpeg" | "webp" | "gif" => Some("image"),
        _ => None,
    }
}

/// Whether a candidate's type should be duration-probed: video and audio
/// carry a meaningful container duration; images do not.
fn should_probe(media_type: &str) -> bool {
    matches!(media_type, "video" | "audio")
}

/// Walks `folder_path` (one level — non-recursive — the operator picked the
/// folder their originals live in, not a tree to search) and returns one
/// `RelinkCandidateFile` per media file. Duration is probed best-effort via
/// the ffmpeg sidecar; a probe failure leaves `duration: None` (see the
/// module doc comment for why that downgrades an exact-name match to
/// `probable`, correctly keeping it off the auto-accept list).
#[tauri::command]
pub async fn relink_list_folder(
    app: tauri::AppHandle,
    folder_path: String,
) -> Result<Vec<RelinkCandidateFile>, String> {
    let folder = PathBuf::from(&folder_path);
    if !folder.is_dir() {
        return Err(format!("relink_list_folder: not a directory: {}", folder.display()));
    }
    let mut out = Vec::new();
    let entries = fs::read_dir(&folder).map_err(|e| format!("read_dir {}: {e}", folder.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
            continue;
        }
        let Some(media_type) = infer_media_type(&path) else { continue };
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let mut duration: Option<f64> = None;
        if should_probe(media_type) {
            // Best-effort: a missing sidecar (cargo test) or a corrupt header
            // yields None — the matcher downgrades the match accordingly.
            if let Ok(d) = crate::ffmpeg::ffmpeg_probe_duration_secs(&app, &path).await {
                duration = Some(d);
            }
        }
        out.push(RelinkCandidateFile {
            id: uuid_v4(),
            name,
            path: path.to_string_lossy().to_string(),
            size: meta.len(),
            media_type: Some(media_type.to_string()),
            duration,
        });
    }
    // Stable order so the matcher's output is deterministic across re-renders
    // and a test snapshot does not flap on readdir ordering.
    out.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    Ok(out)
}

/// A minimal RFC 4122 v4 UUID — `crypto.randomUUID()` is not available in
/// Rust, and pulling `uuid` in as a dependency just for this is overkill
/// when the only requirement is a unique-per-pick handle. Uses thread-local
/// RNG seeded from `SystemTime` + `ThreadId` (not `Math.random`-equivalent
/// weakness); collision probability across one folder pick is negligible.
fn uuid_v4() -> String {
    use std::cell::Cell;
    thread_local! {
        static STATE: Cell<u128> = Cell::new(seed());
    }
    STATE.with(|s| {
        let mut x = s.get();
        // xorshift128+ style — enough randomness for a per-pick handle id.
        x ^= x << 23;
        x ^= x >> 17;
        x ^= x << 5;
        s.set(x);
        x
    });
    let x = STATE.with(|s| s.get());
    let bytes = x.to_le_bytes();
    // Format as 8-4-4-4-12, set version (4) and variant (10xx) bits.
    let mut b = [0u8; 16];
    b[..16].copy_from_slice(&bytes[..16]);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

fn seed() -> u128 {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(1);
    let tid = std::thread::current()
        .id();
    let tid_hash = format!("{tid:?}").bytes().fold(0u128, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u128));
    t ^ (tid_hash << 64) ^ 0x9E3779B97F4A7C15
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "kinetix-relink-test-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn infer_media_type_recognizes_common_media_extensions() {
        assert_eq!(infer_media_type(Path::new("a/b/clip.MP4")), Some("video"));
        assert_eq!(infer_media_type(Path::new("clip.mov")), Some("video"));
        assert_eq!(infer_media_type(Path::new("voice.wav")), Some("audio"));
        assert_eq!(infer_media_type(Path::new("shot.png")), Some("image"));
        assert_eq!(infer_media_type(Path::new("notes.txt")), None);
        assert_eq!(infer_media_type(Path::new("noext")), None);
    }

    #[test]
    fn uuid_v4_is_unique_and_well_formed() {
        let a = uuid_v4();
        let b = uuid_v4();
        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
        assert_eq!(a.chars().filter(|c| *c == '-').count(), 4);
        // version 4
        assert_eq!(&a[14..15], "4");
    }
}
