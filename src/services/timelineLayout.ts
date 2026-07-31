// timelineLayout.ts — pure geometry helpers extracted out of Timeline.tsx,
// TimelineWaveform.tsx, and DropZonePanel.tsx (§6.0 Timeline smoke tests,
// docs/sync-pipeline-contract-plan.md). Behavior-preserving extractions only —
// every function here is a byte-for-byte port of the inline math it replaced,
// pulled out so it can be unit-tested without a DOM harness (this repo has no
// jsdom/testing-library — the same gap usePlayback.test.ts and
// useGlPreview.test.ts already document).
//
// Deliberately React-free and DOM-free, matching the services-vs-components
// split (CLAUDE.md conventions) — every DOM read (getBoundingClientRect,
// ResizeObserver, mouse-event wiring) stays in the component that owns it.

import type { VideoSegment, HeadingOverlay } from '../types';
import { LANE_HEIGHT_PX } from './waveformPeaks';

// ---------------------------------------------------------------------------
// Timeline.tsx — zoom, boundary markers, segment/heading layout, seek, trim
// ---------------------------------------------------------------------------

/**
 * Single source of truth for zoom: exponential interpolation between ppsMin
 * (fit-to-width) and ppsMax (100). When ppsMin >= ppsMax the project is short
 * enough to fit, so the slider is a no-op pinned at 100.
 *
 * Takes `totalDuration` as a plain number rather than recomputing it from a
 * segments array — the caller already derives it once (Timeline.tsx's own
 * `totalDuration` memo) and must reuse that value here instead of a second
 * independent computeTotalDuration call.
 */
export function computeZoomPixelsPerSecond(
  totalDuration: number,
  containerWidth: number,
  sliderT: number,
): number {
  const width = containerWidth || 800;
  const ppsMin = Math.min((width * 0.95) / totalDuration, 100);
  const ppsMax = 100;
  if (ppsMin >= ppsMax) return ppsMax;
  return ppsMin * Math.pow(ppsMax / ppsMin, sliderT);
}

export interface BoundaryMarkerPosition {
  id: string;
  left: number;
}

/**
 * One marker per INTERIOR segment boundary (segments[1..]'s own startTime) —
 * the very first boundary (time 0) and the final end are already marked by
 * the lanes' own left/right border, so index 0 is skipped to avoid doubling it.
 */
export function computeBoundaryMarkerPositions(
  segments: VideoSegment[],
  pixelsPerSecond: number,
): BoundaryMarkerPosition[] {
  return segments.slice(1).map((s) => ({ id: s.id, left: s.startTime * pixelsPerSecond }));
}

export interface TimelineLayout {
  left: number;
  width: number;
}

/**
 * Absolute-position layout for a segment card / waveform sub-cell — both read
 * the SAME VideoSegment fields (startTime, duration) with the SAME formula,
 * confirmed identical at both call sites before this extraction.
 */
export function computeSegmentLayout(
  segment: Pick<VideoSegment, 'startTime' | 'duration'>,
  pixelsPerSecond: number,
): TimelineLayout {
  return { left: segment.startTime * pixelsPerSecond, width: segment.duration * pixelsPerSecond };
}

/**
 * Absolute-position layout for a heading badge. HeadingOverlay uses its own
 * `time`/`duration` fields (not VideoSegment's `startTime`) — a distinct type
 * from computeSegmentLayout's input, kept as a separate function rather than
 * forced onto a shared shape.
 */
export function computeHeadingLayout(
  heading: Pick<HeadingOverlay, 'time' | 'duration'>,
  pixelsPerSecond: number,
): TimelineLayout {
  return { left: heading.time * pixelsPerSecond, width: heading.duration * pixelsPerSecond };
}

/**
 * Converts a scroll-area-relative x offset (already adjusted for
 * getBoundingClientRect()/scrollLeft by the caller) into a clamped seek time.
 */
export function computeSeekTimeFromClientX(
  x: number,
  pixelsPerSecond: number,
  totalDuration: number,
): number {
  return Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
}

/**
 * Slip-trim drag math: converts a horizontal mouse delta into a new
 * `trimStart` value, clamped to [0, maxTrim]. `maxTrim` (derived from the
 * segment's sourceDuration/duration) is computed by the caller.
 */
export function computeTrimDrag(
  deltaX: number,
  pixelsPerSecond: number,
  startTrim: number,
  maxTrim: number,
): number {
  const deltaTime = deltaX / pixelsPerSecond;
  return Math.max(0, Math.min(maxTrim, startTrim - deltaTime));
}

// ---------------------------------------------------------------------------
// TimelineWaveform.tsx — tile splitting
// ---------------------------------------------------------------------------

export interface WaveformTileSpec {
  tileStartTime: number;
  tileEndTime: number;
  tileWidthCss: number;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Splits [0, totalDuration) into tiles whose DEVICE-pixel (backing store)
 * width stays under `maxCanvasWidth` (the ~16384px WebKit/Blink canvas cap),
 * at the given zoom (`pixelsPerSecond`) and device-pixel-ratio (`dpr`).
 */
export function computeWaveformTileSpecs(
  totalDuration: number,
  pixelsPerSecond: number,
  dpr: number,
  maxCanvasWidth: number,
): WaveformTileSpec[] {
  const maxTileCssWidth = Math.max(1, Math.floor(maxCanvasWidth / dpr));
  const desiredWidth = totalDuration * pixelsPerSecond;
  const tileCount = Math.max(1, Math.ceil(desiredWidth / maxTileCssWidth));

  const specs: WaveformTileSpec[] = [];
  for (let i = 0; i < tileCount; i++) {
    const tileStartTime = (i * maxTileCssWidth) / pixelsPerSecond;
    const tileEndTime = Math.min(totalDuration, ((i + 1) * maxTileCssWidth) / pixelsPerSecond);
    const tileWidthCss = Math.max(1, (tileEndTime - tileStartTime) * pixelsPerSecond);
    const canvasWidth = Math.min(maxCanvasWidth, Math.max(1, Math.round(tileWidthCss * dpr)));
    const canvasHeight = Math.max(1, Math.round(LANE_HEIGHT_PX * dpr));
    specs.push({ tileStartTime, tileEndTime, tileWidthCss, canvasWidth, canvasHeight });
  }
  return specs;
}

// ---------------------------------------------------------------------------
// DropZonePanel.tsx — segment-row duration bar, drag-to-reorder gap index
// ---------------------------------------------------------------------------

/** Duration-proportional bar height for a segment row, clamped to [10, 32]px. */
export function computeDurationBarHeightPx(duration: number, maxDuration: number): number {
  return Math.max(10, Math.min(32, (duration / maxDuration) * 32));
}

/**
 * Resolves a pointer's vertical position to a gap index (0..rects.length)
 * among a list of pre-measured row rects — the first row whose vertical
 * midpoint sits below the pointer wins; falls through to rects.length if the
 * pointer is below all of them. A `null` entry (row not yet mounted) is
 * skipped without shifting the index of later entries.
 */
export function resolveDropGapIndex(
  rects: Array<{ top: number; height: number } | null>,
  pointerY: number,
): number {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (!rect) continue;
    if (pointerY < rect.top + rect.height / 2) return i;
  }
  return rects.length;
}
