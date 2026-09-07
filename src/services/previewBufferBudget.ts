/**
 * Single source of truth for preview decode buffer sizing (Design B — WS3
 * 120fps fix). Export paths do not import this module.
 */

/** Section 4.2 decode-ahead horizon — how far past the playhead the feeder
 *  issues chunks. */
export const WINDOW_AHEAD_SEC = 1.5;

/** Trailing half of the sliding window — material kept behind the playhead. */
export const RETAIN_BEHIND_SEC = 0.5;

/** Full admitted source-time span: retain-behind + decode-ahead. Invariant:
 *  PREVIEW_BUFFER_WINDOW_SEC >= WINDOW_AHEAD_SEC at every source fps. */
export const PREVIEW_BUFFER_WINDOW_SEC = RETAIN_BEHIND_SEC + WINDOW_AHEAD_SEC;

/** I420 planar bytes per pixel (Y + U/4 + V/4). */
export const I420_BYTES_PER_PIXEL = 1.5;

/** Per-session decoded VideoFrame byte ceiling (768 MiB). Holds the full
 *  2.0 s window at 1080p120 (~712 MiB); binds first at 4K120. */
export const PREVIEW_BUFFER_MAX_BYTES_PER_SESSION = 768 * 1024 * 1024;

/** Pool-wide decoded VideoFrame byte ceiling across all live sessions
 *  (1536 MiB). Worst case 4×1080p120 full windows ≈ 2848 MiB without
 *  cross-session sharing — this cap forces LRU session eviction first. */
export const PREVIEW_BUFFER_MAX_BYTES_GLOBAL = 1536 * 1024 * 1024;

/** Legacy pool-wide session count ceiling (unchanged). */
export const MAX_CACHED_SESSIONS = 3;

export function estimateFrameBytes(codedWidth: number, codedHeight: number): number {
  return Math.ceil(codedWidth * codedHeight * I420_BYTES_PER_PIXEL);
}

/** Admitted buffer span in source seconds at a given resolution. Time window
 *  applies when byte budget permits; otherwise byte budget clamps seconds. */
export function admittedWindowSec(codedWidth: number, codedHeight: number): number {
  const frameBytes = estimateFrameBytes(codedWidth, codedHeight);
  if (frameBytes <= 0) return PREVIEW_BUFFER_WINDOW_SEC;
  const maxFrames = Math.floor(PREVIEW_BUFFER_MAX_BYTES_PER_SESSION / frameBytes);
  // Conservative fps-agnostic bound: assume up to 120 fps source.
  const maxSecFromBytes = maxFrames / 120;
  return Math.min(PREVIEW_BUFFER_WINDOW_SEC, maxSecFromBytes);
}

/** Effective decode-ahead when byte budget binds (may be < WINDOW_AHEAD_SEC). */
export function effectiveFeedAheadSec(codedWidth: number, codedHeight: number): number {
  const admitted = admittedWindowSec(codedWidth, codedHeight);
  return Math.max(0, admitted - RETAIN_BEHIND_SEC);
}

export interface PreviewBufferBudgetRow {
  resolution: string;
  fps: number;
  frameBytes: number;
  framesAtFullWindow: number;
  admittedSec: number;
  /** Actual source-time horizon issued ahead of the playhead. */
  feedWindowSec: number;
  admittedBytes: number;
  byteBound: boolean;
}

export function previewBufferBudgetTable(): PreviewBufferBudgetRow[] {
  const cases: Array<{ resolution: string; w: number; h: number; fps: number }> = [
    { resolution: '1080p', w: 1920, h: 1080, fps: 30 },
    { resolution: '1080p', w: 1920, h: 1080, fps: 60 },
    { resolution: '1080p', w: 1920, h: 1080, fps: 120 },
    { resolution: '4K', w: 3840, h: 2160, fps: 30 },
    { resolution: '4K', w: 3840, h: 2160, fps: 60 },
    { resolution: '4K', w: 3840, h: 2160, fps: 120 },
  ];
  return cases.map(({ resolution, w, h, fps }) => {
    const frameBytes = estimateFrameBytes(w, h);
    const admittedSec = admittedWindowSec(w, h);
    const feedWindowSec = effectiveFeedAheadSec(w, h);
    const byteBound = admittedSec < PREVIEW_BUFFER_WINDOW_SEC;
    const framesAtFullWindow = Math.ceil(admittedSec * fps);
    const admittedBytes = framesAtFullWindow * frameBytes;
    return {
      resolution,
      fps,
      frameBytes,
      framesAtFullWindow,
      admittedSec,
      feedWindowSec,
      admittedBytes,
      byteBound,
    };
  });
}
