import type { HeadingOverlay, VideoSegment } from '../types';

/**
 * Path B heading layer (docs/path-b-heading-layer-plan.md, Decision 4).
 * The single shared lookup used by both preview (PreviewStage) and export
 * (frameRenderer/exportPipeline) — no per-caller reimplementation.
 * Start-inclusive / end-exclusive: `t` in [heading.time, heading.time + heading.duration).
 * If multiple headings overlap at `t`, the last one in array order wins.
 */
export function getActiveHeadingAt(headings: HeadingOverlay[], t: number): HeadingOverlay | undefined {
  let active: HeadingOverlay | undefined;
  for (const h of headings) {
    if (t >= h.time && t < h.time + h.duration) {
      active = h;
    }
  }
  return active;
}

/**
 * Decision 2: headings never move on re-sync. If a heading's `time` falls at or
 * past the new voiceoverDuration, clamp it to the duration and flag `needsReview`
 * so the user can fix it — never delete. In-range headings are returned untouched.
 */
export function clampHeadingsToDuration(
  headings: HeadingOverlay[],
  voiceoverDuration: number
): HeadingOverlay[] {
  return headings.map(h => {
    if (h.time < voiceoverDuration) return h;
    return { ...h, time: voiceoverDuration, needsReview: true };
  });
}

/**
 * Path B corrective fix (docs/path-b-heading-layer-plan.md, Phase 3/4/5
 * correction) — centers a newly-placed heading ON the segment boundary
 * instead of starting exactly at it (a 50/50 split of `duration` straddling
 * the cut, instead of a 0/100 split that ran entirely into the next
 * segment). `Math.max(0, ...)` clamps the case of a boundary at (or near)
 * t=0, where the heading can't extend before the start of the timeline.
 */
export function centerHeadingOnBoundary(boundaryTime: number, duration: number): number {
  return Math.max(0, boundaryTime - duration / 2);
}

export const MIN_HEADING_DURATION = 0.3; // seconds — mirrors App.tsx's MIN_SEGMENT_DURATION

/**
 * Path B Phase 4 (docs/path-b-heading-layer-plan.md) — pure resize math for the
 * timeline's edge-drag handles. `edge: 'end'` (right handle) only changes
 * `duration`; `edge: 'start'` (left handle) shifts `time` and inversely adjusts
 * `duration` so the opposite edge (`time + duration`) stays fixed, mirroring how
 * segment start-edge resize works. Clamps to MIN_HEADING_DURATION and time >= 0.
 */
export function resizeHeading(
  original: Pick<HeadingOverlay, 'time' | 'duration'>,
  edge: 'start' | 'end',
  deltaSeconds: number
): { time: number; duration: number } {
  if (edge === 'end') {
    return {
      time: original.time,
      duration: Math.max(MIN_HEADING_DURATION, original.duration + deltaSeconds),
    };
  }
  const maxDelta = original.duration - MIN_HEADING_DURATION;
  const clampedDelta = Math.min(deltaSeconds, maxDelta);
  const time = Math.max(0, original.time + clampedDelta);
  const actualDelta = time - original.time;
  return { time, duration: original.duration - actualDelta };
}

/**
 * Path B Phase 5 — a single row in the segments-tab list, merging
 * top-level HeadingOverlays with content segments in display order.
 * `SegmentRow.index` is the row's position in the real `segments` array
 * (unaffected by interleaved heading rows) — callers use it for
 * onInsertHeading(afterIndex)/onSegmentClick/etc, which all key off real
 * segment-array indices.
 */
export type InterleavedRow =
  | { type: 'heading'; heading: HeadingOverlay }
  | { type: 'segment'; segment: VideoSegment; index: number };

/**
 * Merges headings into the segment list for left-panel display (Decision 3):
 * a heading row is placed immediately before the first segment whose
 * `startTime` is at or after the heading's `time` — for a freshly created
 * heading (time === following segment's startTime) that's exactly "between
 * the two segments it falls between". Headings past the last segment's end
 * sort to the end of the list. Multiple headings landing at the same point
 * keep their relative order (stable sort by time).
 */
export function interleaveHeadingRows(
  segments: VideoSegment[],
  headings: HeadingOverlay[]
): InterleavedRow[] {
  const sortedHeadings = [...headings].sort((a, b) => a.time - b.time);
  const rows: InterleavedRow[] = [];
  let hIdx = 0;
  segments.forEach((segment, index) => {
    while (hIdx < sortedHeadings.length && sortedHeadings[hIdx]!.time <= segment.startTime) {
      rows.push({ type: 'heading', heading: sortedHeadings[hIdx]! });
      hIdx++;
    }
    rows.push({ type: 'segment', segment, index });
  });
  while (hIdx < sortedHeadings.length) {
    rows.push({ type: 'heading', heading: sortedHeadings[hIdx]! });
    hIdx++;
  }
  return rows;
}

/**
 * The absolute timestamp for the gap at `gapIndex` (0..segments.length) among
 * `segments` — `gapIndex` uses the same "afterIndex + 1" convention as
 * onInsertHeading. Used both to place a newly created heading (Decision 3:
 * time = the following segment's startTime) and to retime a heading dropped
 * into a gap via left-panel drag. Falls back to the end of the previous
 * segment when there is no following one, and to 0 for an empty project.
 */
export function boundaryTimeForGap(
  segments: Pick<VideoSegment, 'startTime' | 'duration'>[],
  gapIndex: number
): number {
  const clamped = Math.max(0, Math.min(gapIndex, segments.length));
  const next = segments[clamped];
  if (next) return next.startTime;
  const prev = segments[clamped - 1];
  if (prev) return prev.startTime + prev.duration;
  return 0;
}

/**
 * Converts a drop position within an `interleaveHeadingRows` result (a row
 * index, 0..rows.length) into the equivalent segment-array gap index — the
 * count of segment rows strictly before that position. Feeds
 * `boundaryTimeForGap` so a left-panel heading drag retimes to a real
 * segment boundary instead of an arbitrary interleaved-list position.
 */
export function segmentGapIndexForRow(rows: InterleavedRow[], rowIndex: number): number {
  const clamped = Math.max(0, Math.min(rowIndex, rows.length));
  let count = 0;
  for (let i = 0; i < clamped; i++) {
    if (rows[i]!.type === 'segment') count++;
  }
  return count;
}

export const DEFAULT_HEADING_DURATION = 1.0;

/** Factory for a new HeadingOverlay — defaults match Phase 0's pinned visual
 *  parity target: opaque background, 1.0s duration, centered position. */
export function createHeading(
  time: number,
  overrides: Partial<Omit<HeadingOverlay, 'id' | 'time'>> = {}
): HeadingOverlay {
  return {
    id: crypto.randomUUID(),
    time,
    duration: DEFAULT_HEADING_DURATION,
    text: '',
    fontFamily: 'Inter',
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
    backgroundColor: '#000000',
    x: 50,
    y: 50,
    ...overrides,
  };
}
