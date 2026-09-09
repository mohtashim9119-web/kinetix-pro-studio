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
// SCOPE OF THE KILL. `ffmpeg_kill_session` (`src-tauri/src/ffmpeg.rs`) kills
// any in-flight `ffmpeg_exec` child AND sets a per-session cooperative cancel
// flag (`Arc<AtomicBool>`) polled every 64 KB in the native concat, frame-count,
// and truncate commands. Remux / mux / tier-piece `ffmpeg.exec` calls die via
// process kill; concat / count / truncate stop their Rust loops and return
// `Err("cancelled")`. Residual window: up to one 64 KB read/write after the
// flag is set (poll is between chunks, not inside `read()`).
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

/** Per-piece MP4 -> annexb remux (stream copy, one piece). Measured on this
 *  machine (x86_64 sidecar, 60 s 1080p30 piece): p50/worst **0.14 s**; chosen
 *  **30 s** (~214× worst). */
export const REMUX_BOUND_MS = 30_000;

/**
 * Whole-export annexb concatenation. Measured native stream-copy of **1.7 GB**
 * (two-piece concat, SSD): p50/worst **0.64 s**; chosen **60 s** (~94× worst).
 */
export const CONCAT_BOUND_MS = 60_000;

/** Reference annexb size used for export-scale native I/O measurements (26 min 1080p30). */
export const EXPORT_SCALE_ANNEXB_BYTES = 1_700_000_000;

// ---------------------------------------------------------------------------
// MEASURED 2026-09-10 on the final streaming scanners, release profile, macOS
// internal SSD, via `ffmpeg::tests::measure_streaming_annexb_at_scale` run
// standalone under `/usr/bin/time -l` (no cargo build in the same process, so
// the RSS figure is the scanner's own). Three samples per cell; p50 = middle,
// worst = max. Peak RSS for the WHOLE run — which writes 4 GB of fixtures and
// performs six counts and six truncates — was 87,539,712 B (83.5 MiB), i.e.
// O(window), not O(file).
//
//   1.7 GB   count  p50 2714 ms / worst 2739 ms   truncate p50 5242 / worst 5820
//   2.3 GB   count  p50 3251 ms / worst 3255 ms   truncate p50 6770 / worst 6907
//
// These REPLACE the previous constants' inputs (1210 ms count, 2420 ms
// truncate at 2.3 GB), which were never measured and were ~2.7-2.9x too fast.
// Bounds built on them (18_150 ms / 36_300 ms) carried only ~5.5x real headroom
// and would have false-aborted a healthy 2.3 GB export on a disk barely 6x
// slower than this one — the same class of defect as the hang they guard.
// ---------------------------------------------------------------------------

/** Measured worst native frame-count scan at 1.7 GB. */
const FRAME_COUNT_WORST_MS_AT_1_7_GB = 2_739;

/** Measured worst native frame-count scan at 2.3 GB — the sizing case. */
const FRAME_COUNT_WORST_MS_AT_2_3_GB = 3_255;

/** Measured worst streaming truncate at 1.7 GB (scan + set_len + count). */
const TRUNCATE_WORST_MS_AT_1_7_GB = 5_820;

/** Measured worst streaming truncate at 2.3 GB — the sizing case. */
const TRUNCATE_WORST_MS_AT_2_3_GB = 6_907;

/**
 * Headroom over worst observed, for both native scans (x).
 *
 * 25x, chosen so a 2.3 GB export survives a device 25x slower than the machine
 * these numbers came from — an internal SSD. That covers a contended external
 * or network volume with margin. A 10x-slower disk needs 32.6 s (count) and
 * 69.1 s (truncate); 25x needs 81.4 s and 172.7 s. Both bounds clear those.
 *
 * The asymmetry with `MUX_HEADROOM` (15x) is deliberate and stated, not an
 * oversight: the mux bound scales with file size as well, so its effective
 * headroom at 2.3 GB is spent differently. See `computeMuxBoundMs`.
 */
const NATIVE_SCAN_HEADROOM = 25;

/** Post-concat frame-count guard. Measured streaming scan, 25x worst at 2.3 GB. */
export const FRAME_COUNT_BOUND_MS = Math.ceil(
  FRAME_COUNT_WORST_MS_AT_2_3_GB * NATIVE_SCAN_HEADROOM,
);

/**
 * Salvage-only: `ffmpeg.truncateAnnexb` on one GL piece's file, run BEFORE
 * concat. Measured streaming truncate, 25x worst at 2.3 GB. Replaces CC's
 * provisional 300_000 ms structural placeholder.
 */
export const TRUNCATE_BOUND_MS = Math.ceil(
  TRUNCATE_WORST_MS_AT_2_3_GB * NATIVE_SCAN_HEADROOM,
);

/** CC's provisional truncate bound (structural analogy, not measured). */
export const TRUNCATE_BOUND_MS_PROVISIONAL = 300_000;

/** Measured with-audio mux worst at 1.7 GB: premux 9.22 s + mix 4.70 s. */
const MUX_WITH_AUDIO_WORST_MS_AT_1_7_GB = 13_920;

/** Headroom over size-scaled mux worst (×). */
const MUX_HEADROOM = 15;

/**
 * Size-scaled mux bound: `muxOnly` runs one or two `ffmpeg.exec` passes under
 * ONE `withFfmpegLivenessBound` wrapper when audio is present — both passes share
 * this budget. Scales linearly with annexb bytes so a healthy 2.3 GB export
 * survives 10x slower I/O without false-abort.
 *
 * Verified against CC's risk table: the 13.92 s worst at 1.7 GB (premux 9.22 s +
 * mix 4.70 s) scales to 18.83 s at 2.3 GB, so 10x slower I/O is 188.3 s — the
 * exact row the table flagged against the old fixed 180_000 ms bound.
 *
 * Yields **208_800 ms (208.8 s) at 1.7 GB** and **282_495 ms (282.5 s) at
 * 2.3 GB**. Both clear 188.3 s, the 2.3 GB case with ~1.5x margin.
 *
 * KNOWN LIMIT, stated rather than papered over: at 25x slower I/O a 2.3 GB mux
 * needs 470.8 s and this bound would false-abort. The native scan bounds above
 * are sized for 25x; this one is sized for the 10x bar its measurement was
 * taken against. Raising `MUX_HEADROOM` to 25 would close the gap and was NOT
 * done this round because 13.92 s is the only mux number that exists and it was
 * measured at 1.7 GB only.
 */
export function computeMuxBoundMs(annexbByteLength: number): number {
  const scaledWorst =
    MUX_WITH_AUDIO_WORST_MS_AT_1_7_GB *
    (Math.max(annexbByteLength, EXPORT_SCALE_ANNEXB_BYTES) / EXPORT_SCALE_ANNEXB_BYTES);
  return Math.ceil(scaledWorst * MUX_HEADROOM);
}

/** @deprecated Use `computeMuxBoundMs(annexbBytes)` — fixed 180 s false-aborts at 2.3 GB × 10× I/O. */
export const MUX_BOUND_MS = 180_000;

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
