import { invoke } from '@tauri-apps/api/core';
import type { FfmpegLike } from './segmentEncoder';

/**
 * Converts a Uint8Array to a base64 string using 32 KB chunks to avoid
 * stack-overflow on large buffers (String.fromCharCode.apply has a per-call
 * argument limit of ~65 k entries on Safari/WebKit).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 32 * 1024;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

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
 * Probes an audio file's duration (seconds) via the bundled ffmpeg binary,
 * routed through Tauri IPC (`probe_audio_duration`).
 *
 * Replaces the old hidden-`<audio>`-element probe in App.tsx, which depended on
 * the WebView's native codec set (OGG silently failed on macOS WKWebView) and
 * fell back to a hardcoded 60 s — mis-proportioning every segment. ffmpeg reads
 * virtually any container/codec, so this is codec-independent.
 *
 * Throws on any read failure. Callers MUST surface the error, never synthesize
 * a duration.
 */
export async function probeAudioDuration(blob: Blob): Promise<number> {
  const buffer = await blob.arrayBuffer();
  const audioB64 = bytesToBase64(new Uint8Array(buffer));
  const secs = await invoke<number>('probe_audio_duration', { audioB64 });
  if (!Number.isFinite(secs) || secs <= 0) {
    throw new Error(`probe_audio_duration returned an invalid duration: ${secs}`);
  }
  return secs;
}

/**
 * Probes a video file's native frame rate via the bundled ffmpeg binary,
 * routed through Tauri IPC (`probe_video_fps`). Used to auto-suggest a
 * matching export fps (see the exported-video judder audit) — callers should
 * treat failure as non-fatal (unlike `probeAudioDuration`, this is a UI
 * suggestion, not something Apply Sync depends on to proceed correctly).
 *
 * Throws on any read failure.
 */
export async function probeVideoFps(blob: Blob): Promise<number> {
  const buffer = await blob.arrayBuffer();
  const videoB64 = bytesToBase64(new Uint8Array(buffer));
  const fps = await invoke<number>('probe_video_fps', { videoB64 });
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`probe_video_fps returned an invalid frame rate: ${fps}`);
  }
  return fps;
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
    // Frame data is base64-encoded before IPC to avoid the JSON-array-of-numbers
    // serialization cost (~5-10× speedup vs Array.from). Phase 6.3.1.
    // Channel API (binary IPC) is a further optimization for Phase 7 if needed.
    try {
      await invoke<void>('ffmpeg_write_file', {
        sessionId: this.#sessionId,
        path,
        dataB64: bytesToBase64(data),
      });
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
  }

  /**
   * Raw-binary variant of writeFile — sends `data` as the Tauri v2 raw invoke
   * body (Uint8Array, no base64) instead of a base64 string field. session_id
   * and path travel as request headers, read by the `ffmpeg_write_file_raw`
   * Rust command. This removes the per-frame base64 encode + inflated-string
   * IPC transfer + Rust-side base64 decode that dominated per-frame PNG-write
   * cost on the canvas export path (segmentEncoder.ts pipelined job). Same
   * on-disk result as writeFile — only the transport differs.
   */
  async writeFileRaw(path: string, data: Uint8Array): Promise<void> {
    this.#assertAlive();
    try {
      await invoke<void>('ffmpeg_write_file_raw', data, {
        headers: {
          'session-id': this.#sessionId,
          path,
        },
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
