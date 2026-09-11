import { invoke } from '@tauri-apps/api/core';
import type { FfmpegLike } from './segmentEncoder';
import type { AnnexbFrameCount } from './webcodecsExport/annexbFrameCount';
import {
  EXPORT_STATE_FILENAME,
  type AnnexbCheckpointRepairResult,
  type ExportCheckpointRecord,
} from './webcodecsExport/exportCheckpoint';

export type { AnnexbFrameCount };

/** Read-only cross-process session claim (native `session_claim.json`). */
export interface SessionClaimView {
  sessionId: string;
  holderPid: number;
  holderStartTimeMs: number;
  holderInstanceId: string;
  claimedAtMs: number;
  /** `live` | `stale` | `unclaimed` */
  holderLiveness: string;
}

export interface OrphanSweepEntry {
  sessionId: string;
  path: string;
  ageSecs: number;
  bytes: number;
  outcome: string;
  detail?: string | null;
}

export interface OrphanSweepReport {
  scanned: number;
  candidates: number;
  deleted: number;
  deferred: number;
  pendingDelete: number;
  bytesReclaimed: number;
  entries: OrphanSweepEntry[];
}

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

  /**
   * This session's own UUID — the same id `ffmpeg_write_export_state` requires
   * an `export_state.json` manifest's `sessionId` field to carry, and the same
   * id `listResumableSessionIds`/`reenter` speak in.
   *
   * WS3 Round 10 wiring edit (CC), named in that round's report: the checkpoint
   * writer has to put this id INSIDE the manifest it writes, and Rust rejects a
   * manifest whose `sessionId` disagrees with the session it is written to. The
   * id was private, so a caller could not build a manifest Rust would accept.
   * Read-only; nothing else about the encapsulation changes.
   */
  get sessionId(): string {
    return this.#sessionId;
  }

  /** UUIDs of crash-surviving session directories containing export_state.json. */
  static async listResumableSessionIds(): Promise<string[]> {
    return invoke<string[]>('ffmpeg_list_resumable_sessions');
  }

  /** Read-only claim inspection — does not take the claim. */
  static async readSessionClaim(sessionId: string): Promise<SessionClaimView> {
    return invoke<SessionClaimView>('ffmpeg_read_session_claim', { sessionId });
  }

  /** Sweeps manifest-less orphan session directories older than the threshold. */
  static async sweepOrphanSessions(minAgeSecs?: number): Promise<OrphanSweepReport> {
    return invoke<OrphanSweepReport>('ffmpeg_sweep_orphan_sessions', {
      minAgeSecs: minAgeSecs ?? null,
    });
  }

  /**
   * Re-enters a surviving session without minting a new UUID. The Rust side
   * keeps append/count/concat closed until `prepareCheckpointResume` succeeds.
   */
  static async reenter(sessionId: string): Promise<TauriFfmpeg> {
    await invoke<void>('ffmpeg_reenter_session', { sessionId });
    return new TauriFfmpeg(sessionId);
  }

  async readExportState(): Promise<Uint8Array> {
    const bytes = await this.readFile(EXPORT_STATE_FILENAME);
    return typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  }

  async writeExportState(serializedManifest: string): Promise<void> {
    this.#assertAlive();
    try {
      await invoke<void>('ffmpeg_write_export_state', {
        sessionId: this.#sessionId,
        serializedState: serializedManifest,
      });
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
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

  /**
   * Append-binary variant of `writeFileRaw` — sends `data` as the Tauri v2 raw
   * invoke body to `ffmpeg_append_file_raw`, which opens the target file with
   * `OpenOptions::append(true).create(true)` instead of truncating. Same
   * session-id/path header transport as `writeFileRaw`; only the Rust-side
   * open mode differs. Used by the WebCodecs export worker's orchestrator to
   * stream `EncodedVideoChunk` bytes straight to a per-run `run_K.h264` file
   * as they arrive — the caller is responsible for awaiting each call before
   * issuing the next so appends land in chunk order (docs/webcodecs-export-plan.md §4.4).
   */
  async appendFileRaw(path: string, data: Uint8Array): Promise<void> {
    this.#assertAlive();
    try {
      await invoke<void>('ffmpeg_append_file_raw', data, {
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

  /**
   * Counts H.264 Annex B access units (pictures) in <path> via the native
   * `ffmpeg_count_annexb_frames` command — the file is scanned in bounded
   * 64 KB chunks entirely on the Rust side, so its bytes never cross into
   * the renderer. Returns both picture count and raw VCL NAL count for the
   * post-concat guard's diagnostic message.
   */
  /** Byte length of a session file without reading its contents. */
  async sessionFileSize(path: string): Promise<number> {
    this.#assertAlive();
    try {
      return await invoke<number>('ffmpeg_session_file_size', {
        sessionId: this.#sessionId,
        path,
      });
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
  }

  async countAnnexbFrames(path: string): Promise<AnnexbFrameCount> {
    this.#assertAlive();
    try {
      return await invoke<AnnexbFrameCount>('ffmpeg_count_annexb_frames', {
        sessionId: this.#sessionId,
        path,
      });
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
  }

  /**
   * Truncates `<path>` at the last complete Annex-B access unit. Unused by
   * the production export pipeline this round — salvage/resume is not this
   * client's call. The native command exists so a future resume path can
   * truncate a GB-scale file without pulling bytes into the renderer.
   */
  async truncateAnnexb(path: string): Promise<{ pictures: number; vclNals: number; bytesRemoved: number; keptBytes: number }> {
    this.#assertAlive();
    try {
      return await invoke('ffmpeg_truncate_annexb', {
        sessionId: this.#sessionId,
        path,
      });
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
  }

  /**
   * Truncates `<path>` to an exact byte offset via in-place `set_len`, then
   * returns the picture count on the kept prefix for checkpoint verification.
   */
  async truncateAnnexbToOffset(
    path: string,
    byteOffset: number,
  ): Promise<{ pictures: number; vclNals: number; bytesRemoved: number; keptBytes: number }> {
    this.#assertAlive();
    try {
      return await invoke('ffmpeg_truncate_annexb_to_offset', {
        sessionId: this.#sessionId,
        path,
        byteOffset,
      });
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
  }

  /**
   * Atomic native pre-append resume gate. Rust performs backwards tail
   * inspection, unconditional whole-AU repair, exact checkpoint truncation,
   * and canonical picture recount before unblocking append/count/concat.
   */
  async prepareCheckpointResume(
    path: string,
    checkpoint: ExportCheckpointRecord,
  ): Promise<AnnexbCheckpointRepairResult> {
    this.#assertAlive();
    try {
      return await invoke<AnnexbCheckpointRepairResult>('ffmpeg_prepare_checkpoint_resume', {
        sessionId: this.#sessionId,
        path,
        byteOffset: checkpoint.byteOffset,
        cumulativePictures: checkpoint.cumulativePictures,
        pieceIndex: checkpoint.pieceIndex,
        encoderSessionIndex: checkpoint.encoderSessionIndex,
      });
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
  }

  /**
   * Stream-concatenates `piecePaths` (in order) into a single `outputPath` via
   * the native `ffmpeg_concat_annexb_pieces` command — only 2 file descriptors
   * are ever open (one read, one write), independent of piece count. Replaces
   * the ffmpeg concat-protocol (`-i concat:a|b|c|...`), which opened every piece
   * at once and exhausted macOS's default 256 per-process FD limit on
   * large-segment exports (`Too many open files`). Raw AnnexB byte concatenation
   * is spec-valid (every NAL unit is start-code-prefixed); the orchestrator's
   * post-concat `countAnnexbFrames` guard proves the result is byte-correct.
   */
  async concatAnnexbPieces(piecePaths: string[], outputPath: string): Promise<void> {
    this.#assertAlive();
    try {
      await invoke<void>('ffmpeg_concat_annexb_pieces', {
        sessionId: this.#sessionId,
        piecePaths,
        outputPath,
      });
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
   * Copies a finished file (e.g. `export_final.mp4`) from this session's temp
   * dir straight to `destPath` on disk via the native `save_session_file`
   * command — the bytes never enter the renderer. Replaces the readFile → Blob
   * → arrayBuffer → base64 → `save_bytes_to_disk` chain, which inflated the whole
   * MP4 ~5–6× through the WebView heap and crashed WebView2's OOM guard
   * (STATUS_BREAKPOINT) on large exports. Must be called before destroy() deletes
   * the session dir.
   */
  async saveSessionFile(fileName: string, destPath: string): Promise<void> {
    this.#assertAlive();
    try {
      await invoke<void>('save_session_file', {
        sessionId: this.#sessionId,
        fileName,
        destPath,
      });
    } catch (err) {
      throw new Error(typeof err === 'string' ? err : String(err));
    }
  }

  /**
   * Kills the in-flight ffmpeg subprocess for this session, if one is currently
   * running (D13 fix). Best-effort, mirroring destroy()'s catch-and-warn — a
   * missing/already-finished process is not an error. Must be called BEFORE
   * destroy() so the sidecar isn't left writing into a session dir that's about
   * to be deleted out from under it.
   */
  async kill(): Promise<void> {
    try {
      await invoke<void>('ffmpeg_kill_session', {
        sessionId: this.#sessionId,
      });
    } catch (err) {
      console.warn('[tauriFfmpeg] kill failed:', err);
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
