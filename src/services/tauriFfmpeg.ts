import { invoke } from '@tauri-apps/api/core';
import type { FfmpegLike } from './segmentEncoder';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

/**
 * Returns true when the frontend is running inside a Tauri WebView.
 * Used by sub-phase 6.3 to select the native vs. wasm export path at runtime.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Implements FfmpegLike by routing file I/O and ffmpeg invocation through
 * Tauri IPC to the native Rust backend.
 *
 * Each instance is backed by an isolated server-side session directory
 * under $TMPDIR/kinetix-export-<uuid>/. Call destroy() when the export
 * completes (success or failure) to release that directory.
 *
 * Known tech debt:
 *   Uint8Array is serialized as Array<number> over the Tauri IPC wire
 *   (JSON encoding). This is ~2-3× the raw byte count per frame write.
 *   Phase 7 optimization candidate: Tauri v2 Channel API or raw binary
 *   IPC support once stabilized.
 */
export class TauriFfmpeg implements FfmpegLike {
  readonly #sessionId: string;
  #destroyed = false;

  private constructor(sessionId: string) {
    this.#sessionId = sessionId;
  }

  /**
   * Requests a new session from the Rust side and returns a ready instance.
   * The session directory is created server-side; the client only holds the id.
   */
  static async create(): Promise<TauriFfmpeg> {
    const sessionId = await invoke<string>('ffmpeg_create_session');
    return new TauriFfmpeg(sessionId);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.#assertAlive();
    try {
      await invoke<void>('ffmpeg_write_file', {
        sessionId: this.#sessionId,
        path,
        // Tauri v2 IPC: Uint8Array → number[] in JSON. Overhead acknowledged.
        data: Array.from(data),
      });
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
  }

  async exec(args: string[]): Promise<number> {
    this.#assertAlive();
    try {
      return await invoke<number>('ffmpeg_exec', {
        sessionId: this.#sessionId,
        args,
      });
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
  }

  async readFile(path: string): Promise<Uint8Array | string> {
    this.#assertAlive();
    try {
      // Rust returns Vec<u8>; Tauri IPC deserializes it as number[].
      const bytes = await invoke<number[]>('ffmpeg_read_file', {
        sessionId: this.#sessionId,
        path,
      });
      return new Uint8Array(bytes);
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
  }

  async deleteFile(path: string): Promise<void> {
    this.#assertAlive();
    try {
      await invoke<void>('ffmpeg_delete_file', {
        sessionId: this.#sessionId,
        path,
      });
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
  }

  /**
   * Deletes the session directory. Should be called after every export
   * (success or failure). Safe to call multiple times.
   */
  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    try {
      await invoke<void>('ffmpeg_destroy_session', {
        sessionId: this.#sessionId,
      });
    } catch (err) {
      // Best-effort cleanup — session dir may already be gone.
      console.warn('[tauriFfmpeg] destroy failed:', err);
    }
  }

  #assertAlive(): void {
    if (this.#destroyed) {
      throw new Error('TauriFfmpeg: session already destroyed');
    }
  }
}
