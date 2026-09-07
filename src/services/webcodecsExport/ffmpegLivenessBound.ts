/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS3 Defect 2 — liveness bounds for the ffmpeg sidecar paths.
//
// WHAT WAS UNBOUNDED, AND WHY IT MATTERS MORE NOW
//
// `driveGlRun` has had two bounds for a while (WATCHDOG_MS and
// FORWARD_PROGRESS_BOUND_MS) — but those cover only the GL WORKER. Every other
// long-running step in a WebCodecs export is a single `invoke()` into the Rust
// ffmpeg sidecar with no timeout of any kind:
//
//   encodeTier1Piece      exportPipelineWebCodecs.ts — encodePlainVideoSegment /
//                         encodeStaticImageSegment (segmentEncoder.ts:~429/~533,
//                         `ffmpeg.exec`) + writeFile + remuxMp4ToAnnexb
//   encodeCanvasPiece     exportPipelineWebCodecs.ts — encodeSegment
//                         (segmentEncoder.ts:~331, per-frame PNG writes then one
//                         `ffmpeg.exec`) + writeFile + remuxMp4ToAnnexb
//   concatAnnexbPieces    tauriFfmpeg.ts:224 — `ffmpeg_concat_annexb_pieces`
//   countAnnexbFrames     tauriFfmpeg.ts:202 — `ffmpeg_count_annexb_frames`
//   muxOnly               muxOnly.ts:167/178/186 — one or two `ffmpeg.exec`
//
// CLASSIFICATION (Defect 2a). Every one of the calls above is a bare
// `invoke(...)`: one promise, no incremental output, nothing streamed back
// while the sidecar works. They are all class (ii) — OPAQUE, needs a timeout.
// The single exception is `encodeCanvasPiece`, which is opaque at the ffmpeg
// call but wraps a JS-side per-frame render/write loop that DOES emit
// incremental progress (`EncodeSegmentOptions.onProgress`); that one gets a
// resettable bound via `touch()`, so a slow-but-moving canvas encode is never
// killed for being slow.
//
// SIZING (Defect 2b). These are deliberately LOOSE. Their job is to convert
// "hangs forever with no payload" into "fails in bounded time with a typed
// error and a diagnostics payload" — not to be tight enough to catch a merely
// slow machine. Each value is justified at its own constant below against the
// largest plausible real job: a ~23-piece, 1268.7s, 1080p30 export (the field
// run), whose concatenated annexb video is on the order of 1-2 GB.
//
// KILL ON EXPIRY (Defect 2c). Expiry calls `ffmpeg.kill()`
// (`ffmpeg_kill_session`) before throwing, so the sidecar process dies rather
// than being orphaned while the renderer walks away from its promise. The
// underlying `invoke` promise is abandoned by the race, not awaited — killing
// the session is what actually settles it.
//
// Deliberately NOT reusing WATCHDOG_MS: that bound is frozen (it fired
// correctly in the field) and it measures a completely different thing — the
// silence of a worker message stream, not the wall time of one opaque
// subprocess call.
// ---------------------------------------------------------------------------

/** The subset of the ffmpeg client this module needs. */
export interface FfmpegKillable {
  kill(): Promise<void>;
}

/**
 * Per-piece Tier 1 / Tier C encode (render + `ffmpeg.exec` + remux), 10 min.
 *
 * Tier C is the expensive one: it renders and writes one PNG per frame before
 * ffmpeg ever runs. A single 60s segment at 30fps is 1800 PNG round-trips
 * through the IPC bridge; at a pessimistic 100ms each that is 180s, and the
 * libx264 encode of the same span adds tens of seconds. 600s leaves better
 * than 3x headroom over that worst case. Also resettable on per-frame progress
 * for Tier C, so this only ever fires on a genuinely stopped encode.
 */
export const TIER_PIECE_BOUND_MS = 600_000;

/** Per-piece MP4 -> annexb remux (stream copy, one piece), 2 min. A piece is at
 *  most MAX_ENCODER_SESSION_FRAMES long and a stream copy touches no pixels;
 *  this is milliseconds in practice (the plan's own §4.4 wording). */
export const REMUX_BOUND_MS = 120_000;

/**
 * Whole-export annexb concatenation, 10 min. The 1268.7s 1080p30 field job at
 * roughly 8-12 Mbps is ~1.3-1.9 GB; `ffmpeg_concat_annexb_pieces` stream-copies
 * it with 2 FDs open. Even at a punitive 5 MB/s that is ~380s, so 600s clears
 * it; on any real disk this completes in seconds.
 */
export const CONCAT_BOUND_MS = 600_000;

/** Post-concat frame-count guard, 5 min. A 64 KB-chunked native scan of the
 *  same ~1.9 GB file — pure sequential read, no decode. 300s is ~6 MB/s, far
 *  below any real device. */
export const FRAME_COUNT_BOUND_MS = 300_000;

/**
 * Mux (`muxOnly`, one or two `ffmpeg.exec` calls), 15 min. Larger than concat
 * because the with-audio case makes TWO passes over the whole ~1.9 GB video
 * (annexb -> real-PTS MP4 premux, then the audio mix) and additionally AAC-
 * encodes ~21 minutes of voiceover. This is the single longest legitimate step
 * in a large export, so it gets the loosest bound.
 */
export const MUX_BOUND_MS = 900_000;

export interface FfmpegBoundDiagnostics {
  /** Which bounded step expired — the same label as the constant's name. */
  label: string;
  boundMs: number;
  elapsedMs: number;
  /** Orchestrator piece index, when the step belongs to one. */
  pieceIndex: number | null;
  /** Total pieces in this export, when known. */
  pieceCount: number | null;
  /** Session files the step was reading/writing. */
  files: string[];
  /** Did `ffmpeg.kill()` actually run, and did it throw? */
  killed: boolean;
  killError: string | null;
  /** For a resettable bound: how many progress ticks were seen, and how long
   *  ago the last one was. Both null for an opaque (non-resettable) bound. */
  progressTicks: number | null;
  msSinceLastProgress: number | null;
}

/** Typed failure for an expired ffmpeg liveness bound. */
export class FfmpegBoundExpiredError extends Error {
  readonly diagnostics: FfmpegBoundDiagnostics;

  constructor(diagnostics: FfmpegBoundDiagnostics) {
    super(
      `ffmpeg step "${diagnostics.label}" made no progress for ${Math.round(diagnostics.boundMs / 1000)}s ` +
        `(elapsed ${Math.round(diagnostics.elapsedMs)}ms, files=${diagnostics.files.join(',') || 'none'}, ` +
        `piece=${diagnostics.pieceIndex ?? '-'}/${diagnostics.pieceCount ?? '-'}) — aborting (ffmpeg liveness bound).`,
    );
    this.name = 'FfmpegBoundExpiredError';
    this.diagnostics = diagnostics;
  }
}

export interface FfmpegBoundOptions {
  label: string;
  boundMs: number;
  ffmpeg: FfmpegKillable;
  files?: string[];
  pieceIndex?: number | null;
  pieceCount?: number | null;
  /** Injectable for tests; defaults to `performance.now`. */
  now?: () => number;
}

/** Handed to the wrapped function so a step with real incremental progress can
 *  push the deadline out. An opaque step simply never calls it. */
export interface FfmpegBoundHandle {
  touch(): void;
}

/**
 * Runs `fn` under a wall-clock liveness bound. On expiry: kill the ffmpeg
 * session, then reject with `FfmpegBoundExpiredError` carrying the standard
 * diagnostics payload. On success/failure of `fn`, the timer is always cleared.
 *
 * `touch()` restarts the bound — use it only where a real forward-progress
 * signal exists (a completed frame write), never on a bare "still running"
 * ping, or the bound becomes unable to fire at all.
 */
export async function withFfmpegLivenessBound<T>(
  options: FfmpegBoundOptions,
  fn: (handle: FfmpegBoundHandle) => Promise<T>,
): Promise<T> {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  let lastProgressAt = startedAt;
  let progressTicks = 0;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // `arm` is assigned by the Promise executor, which runs SYNCHRONOUSLY inside
  // the constructor — so it is always set before `handle.touch` can be called.
  // Kept as a local (never module state) so concurrent bounded steps cannot
  // re-arm each other's timers.
  let arm: ((ms: number) => void) | null = null;

  const expiry = new Promise<never>((_resolve, reject) => {
    arm = (ms: number): void => {
      timer = setTimeout(() => {
        void (async () => {
          if (settled) return;
          let killed = false;
          let killError: string | null = null;
          try {
            await options.ffmpeg.kill();
            killed = true;
          } catch (err) {
            killError = err instanceof Error ? err.message : String(err);
          }
          if (settled) return;
          reject(
            new FfmpegBoundExpiredError({
              label: options.label,
              boundMs: options.boundMs,
              elapsedMs: now() - startedAt,
              pieceIndex: options.pieceIndex ?? null,
              pieceCount: options.pieceCount ?? null,
              files: options.files ?? [],
              killed,
              killError,
              progressTicks: progressTicks > 0 ? progressTicks : null,
              msSinceLastProgress: progressTicks > 0 ? now() - lastProgressAt : null,
            }),
          );
        })();
      }, ms);
    };
    arm(options.boundMs);
  });

  const handle: FfmpegBoundHandle = {
    touch: () => {
      if (settled) return;
      progressTicks++;
      lastProgressAt = now();
      if (timer) clearTimeout(timer);
      arm?.(options.boundMs);
    },
  };

  try {
    return await Promise.race([fn(handle), expiry]);
  } finally {
    settled = true;
    if (timer) clearTimeout(timer);
  }
}
