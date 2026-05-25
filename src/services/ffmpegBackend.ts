import type { FfmpegLike } from './segmentEncoder';
import { TauriFfmpeg } from './tauriFfmpeg';

export interface TauriBackend {
  ffmpeg: FfmpegLike;
  /** Deletes the session temp dir. Idempotent — safe to call multiple times. */
  dispose: () => Promise<void>;
}

/**
 * Creates a Tauri-backed FfmpegLike instance with a session-scoped temp dir.
 *
 * Each export gets a fresh session (and therefore a fresh UUID temp directory).
 * Caller must invoke dispose() on completion, error, or cancellation.
 *
 * Sub-phase 6.4 will remove the wasm worker path from useExport.ts entirely,
 * at which point this becomes the sole backend factory.
 */
export async function createTauriBackend(): Promise<TauriBackend> {
  const ffmpeg = await TauriFfmpeg.create();
  return {
    ffmpeg,
    dispose: () => ffmpeg.destroy(),
  };
}
