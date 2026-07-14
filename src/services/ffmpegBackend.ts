import type { FfmpegLike } from './segmentEncoder';
import { TauriFfmpeg } from './tauriFfmpeg';

export interface TauriBackend {
  ffmpeg: FfmpegLike;
  /** Deletes the session temp dir. Idempotent — safe to call multiple times. */
  dispose: () => Promise<void>;
  /**
   * Copies a finished file (e.g. `export_final.mp4`) from the session temp dir
   * straight to `destPath` on disk, without routing the bytes through the
   * renderer. Must be called before dispose() removes the session dir.
   */
  saveOutputToDisk: (fileName: string, destPath: string) => Promise<void>;
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
    saveOutputToDisk: (fileName, destPath) => ffmpeg.saveSessionFile(fileName, destPath),
  };
}
