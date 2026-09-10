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
 * Mux uses the same 25x floor below. File-size scaling and slow-device
 * headroom are independent multipliers; applying only 15x after scaling was
 * the earlier 10x-row defect.
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

/** Measured 2026-09-10 two-pass muxOnly on real tiled Annex-B (not 0xFF),
 *  21 min AAC mix, TMPDIR=/var/folders/39/.../T, x86_64 sidecar.
 *  1.7 GB (1_700_660_619 B): pass-1 8.370 s, pass-2 5.450 s, total 13.820 s,
 *  peak RSS 55_234_560. 2.3 GB (2_300_238_216 B): pass-1 13.550 s, pass-2
 *  6.920 s, total 20.470 s, peak RSS 63_279_104. */
const MUX_PASS1_MS_AT_1_7_GB = 8_370;
const MUX_PASS2_MS_AT_1_7_GB = 5_450;
const MUX_PASS1_MS_AT_2_3_GB = 13_550;
const MUX_PASS2_MS_AT_2_3_GB = 6_920;
const MUX_SIZING_BYTES = 2_300_000_000;

/** Headroom over measured mux total (×). */
const MUX_HEADROOM = 25;

/**
 * Mux liveness bound. `muxOnly` runs one or two `ffmpeg.exec` passes under
 * ONE `withFfmpegLivenessBound` wrapper when audio is present.
 *
 * Shape is NOT linear in annexb bytes. Pass-1 (annexb→mp4 copy) grew
 * 8.370 s → 13.550 s from 1.7 GB to 2.3 GB (ratio 1.619 vs byte ratio 1.353)
 * — I/O bound in the annexb stream, noisy but same order as bytes. Pass-2
 * AAC-encodes a fixed-length 21 min voiceover against `-shortest` and only
 * grew 5.450 s → 6.920 s (ratio 1.270): the mix is audio-duration bound, with
 * a weak extra cost from a larger premux. Sizing interpolates the two
 * measured (pass-1, pass-2) pairs rather than multiplying the whole two-pass
 * total by 2.3/1.7.
 *
 *   1.7 GB measured 13.820 s → 25× = 345_500 ms.
 *   2.3 GB measured 20.470 s → 25× = 511_750 ms.
 * Round 7's 13.92 × (2.3/1.7) = 18.834 s extrapolation was 1.636 s (8.0%)
 * too fast against the 20.470 s measurement. Round 7's own 1.7 GB figure
 * (13.92 s) matches this run to 0.10 s.
 *
 * There is no `MUX_BOUND_MS` constant. Callers pass `computeMuxBoundMs` the
 * actual annexb byte length.
 */
export function computeMuxBoundMs(annexbByteLength: number): number {
  const bytes = Math.max(annexbByteLength, EXPORT_SCALE_ANNEXB_BYTES);
  const span = MUX_SIZING_BYTES - EXPORT_SCALE_ANNEXB_BYTES;
  const t = (bytes - EXPORT_SCALE_ANNEXB_BYTES) / span;
  const pass1 =
    MUX_PASS1_MS_AT_1_7_GB + t * (MUX_PASS1_MS_AT_2_3_GB - MUX_PASS1_MS_AT_1_7_GB);
  const pass2 =
    MUX_PASS2_MS_AT_1_7_GB + t * (MUX_PASS2_MS_AT_2_3_GB - MUX_PASS2_MS_AT_1_7_GB);
  return Math.ceil((pass1 + pass2) * MUX_HEADROOM);
}

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
