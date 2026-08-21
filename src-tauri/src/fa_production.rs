// ---------------------------------------------------------------------------
// Production, capability-gated forced-alignment entry point
// (docs/work-in-progress.md §11 item 1).
//
// Reachable from the real running app — unlike `fa_dev.rs`'s `fa_align_dev`
// (devtools-console-only, `import.meta.env.DEV`-gated on the TS side), this
// command is the one a real Apply Sync run invokes when
// `faGate.ts::isFaGateOpenForProject(project)` is true. It has no gate of its
// own: exactly like `whisper_transcribe` has no server-side check that the
// frontend "should" be calling it, gating is the frontend's job, not this
// command's. Registering this command in `lib.rs` does not by itself turn FA
// on — the switch is the per-project `Project.faHighPrecisionSync` (WS1
// Session G, owner ruling R-AK; default ON, explicitly overridable per
// project in Settings), and this command's own behavior with no model
// present is identical to `fa_align`'s: a clean `Err`, never a panic.
//
// Body is `fa_dev.rs`'s `resolve_wav_and_align` — the exact same
// resolve-model / durable-WAV / delegate-to-`fa_align` path `fa_align_dev`
// already runs, live-verified against a real `AppHandle<Wry>` (D25 A1).
// `input_path` is a file `fa_stage_audio_raw` (`fa_dev.rs`) already staged
// under this command's OWN temp-directory namespace
// (`kinetix-fa-production-inputs`, distinct from `fa_align_dev`'s
// `kinetix-fa-dev-inputs` — the frontend passes that namespace as
// `fa_stage_audio_raw`'s `cache-dir` header), so a devtools call and a real
// production call against the same audio content never race on the same
// content-addressed path.
// ---------------------------------------------------------------------------

use crate::fa::{FaChunkInput, FaError, FaEvent, FaModelCache, FaState};
use crate::fa_dev::resolve_wav_and_align;
use tauri::ipc::Channel;

#[tauri::command]
pub async fn fa_align_production(
    app: tauri::AppHandle,
    state: tauri::State<'_, FaState>,
    model_cache: tauri::State<'_, FaModelCache>,
    input_path: String,
    chunks: Vec<FaChunkInput>,
    language: String,
    on_event: Channel<FaEvent>,
) -> Result<(), FaError> {
    resolve_wav_and_align(app, state, model_cache, input_path, chunks, language, on_event).await
}
