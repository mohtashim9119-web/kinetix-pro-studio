/**
 * Timeline drag-resize GEOMETRY — pointer coordinates in, segment timing out.
 * Pure: no DOM, no React, no I/O. Extracted from `App.tsx`'s `onResizeStart`
 * (K16) for two reasons.
 *
 * 1. `onResizeStart` computed the same duration TWICE from two hand-written
 *    copies of the same expression — once in `liveDurationForX` for the drag's
 *    live width, once again in `handleUp` for the value actually committed. Two
 *    copies of timing math that must agree is a drift risk by construction; the
 *    live preview silently lying about what will be committed is exactly the
 *    class of bug this file removes. There is now one function, called from both
 *    places.
 * 2. `resolveDragEdge` is the timing-neutrality proof surface for K16. Its
 *    output for a given content-space edge position is asserted, in
 *    `dragGeometry.test.ts`, to be byte-identical to the pre-K16 expression it
 *    replaces. That is what makes it checkable that K16 changed WHERE the edge
 *    is read from, and nothing about what a given edge position means.
 *
 * ---------------------------------------------------------------------------
 * K16 — what was actually wrong with the pointer mapping
 * ---------------------------------------------------------------------------
 *
 * Three independent faults, all measured before anything was changed. None of
 * them scaled with zoom: every one is a constant pixel error, which rules out
 * the "stale pixels-per-second" hypothesis outright.
 *
 * **(1) A stale container-origin constant — 24px, constant.** The pointer→content
 * mapping was `clientX - rect.left + scrollLeft - 24`. That `- 24` is annotated
 * `// 24 is padding` in the initial commit, where `#timeline-scroll-area`
 * carried `p-6 pt-10` — 24px of real horizontal padding. The layout redesign
 * changed the container to `p-0 pt-[15px]` and the constant was never removed.
 * Measured live in the running app: the container's computed `paddingLeft` and
 * `borderLeftWidth` are both `0px`, and its content origin sits exactly 0px from
 * `getBoundingClientRect().left`. So the term was a pure 24px error, placing the
 * dragged edge 24px to the LEFT of the pointer. Constant in pixels; in SECONDS
 * it is `24 / pixelsPerSecond`, so it was worth 0.24s at the default 100 px/s
 * and over a second when zoomed out — which is why its damage looked
 * zoom-dependent even though the pixel gap never was.
 *
 * **(2) No grab offset — up to 8px, constant.** `onResizeStart` never received
 * the pointer position, so the edge was snapped to wherever the pointer was
 * rather than preserving where inside the handle the user actually grabbed. The
 * handles are `w-2` — measured 8px — so this contributed a further 0-8px, in the
 * same direction for the end handle and the opposite for the start handle.
 *
 * **(3) The dragged edge did not move at all on a left-edge drag — the whole
 * drag distance.** This is the ~100px the owner reported, and it is not a
 * coordinate error. Each segment card is absolutely positioned with `left` and
 * `width` from React state; the drag loop wrote `style.width` and nothing else.
 * On a right-edge drag that is correct — the left edge is meant to stay put and
 * the right edge tracks. On a LEFT-edge drag it means the grabbed edge is
 * pinned while the OPPOSITE edge moves, in the opposite direction. So the lag on
 * a left-edge drag equalled the drag distance itself, unbounded, while a
 * right-edge drag was off by the constant 24-32px of (1)+(2). "Roughly 100px,
 * sometimes less" is those two cases.
 *
 * Fault (3) is why this module exposes `segmentLeftPx` alongside the duration:
 * a left-edge drag has to move BOTH properties to keep the segment's right edge
 * pinned where it belongs.
 */

import type { VideoSegment } from '../types';
import { MIN_SEGMENT_DURATION } from './dragCascade';

/** Which edge of the segment card the user grabbed. */
export type DragEdge = 'start' | 'end';

/**
 * Pointer clientX → timeline content-space x, in pixels.
 *
 * `#timeline-scroll-area` has zero horizontal padding and zero border (measured
 * in the running app, see this file's header), so its content origin is exactly
 * its border-box left and no correction term belongs here. Do NOT reintroduce
 * one: if the container ever regains padding, read it from the live computed
 * style rather than hard-coding a number that goes stale silently the next time
 * the layout changes — which is precisely how the 24px error survived.
 */
export function timelineContentX(
  clientX: number,
  timelineRectLeft: number,
  scrollLeft: number,
): number {
  return clientX - timelineRectLeft + scrollLeft;
}

// ---------------------------------------------------------------------------
// Edge auto-scroll (manual WKWebView checklist step 9, 2026-08-08)
// ---------------------------------------------------------------------------

/** How close to a viewport edge the pointer must get before the timeline
 *  starts scrolling itself, in CSS px. Also the width over which the scroll
 *  ramps from zero to full speed, so entering the zone never jerks. */
export const AUTOSCROLL_EDGE_ZONE_PX = 48;

/** Ceiling on the self-scroll rate, in CSS px per second. Reached when the
 *  pointer is at (or past) the viewport edge itself. */
export const AUTOSCROLL_MAX_SPEED_PX_PER_SEC = 1200;

/**
 * Signed auto-scroll velocity in px/sec for a pointer at `pointerClientX`:
 * negative to scroll left, positive right, and exactly 0 outside both edge
 * zones (the caller treats 0 as "stop the loop", so this is the only
 * termination condition).
 *
 * The ramp is linear in overshoot INTO the zone and saturates at the edge, so
 * a pointer dragged well past the viewport does not accelerate without bound —
 * past the edge it simply pins at `maxSpeedPxPerSec`. Deliberately expressed in
 * px/SEC rather than px/frame: the caller multiplies by real elapsed time, so
 * the scroll rate is the same whether frames arrive at 60Hz or 30Hz.
 *
 * Pure — no DOM. The viewport rect is supplied by the caller, which is what
 * makes this unit-testable at all (jsdom has no layout engine).
 */
export function computeAutoScrollVelocity(
  pointerClientX: number,
  viewportLeft: number,
  viewportWidth: number,
  edgeZonePx: number = AUTOSCROLL_EDGE_ZONE_PX,
  maxSpeedPxPerSec: number = AUTOSCROLL_MAX_SPEED_PX_PER_SEC,
): number {
  if (viewportWidth <= 0 || edgeZonePx <= 0) return 0;
  // A viewport narrower than two zones would make the two overlap and fight;
  // half the width each is the natural degenerate split.
  const zone = Math.min(edgeZonePx, viewportWidth / 2);
  const rightTrigger = viewportLeft + viewportWidth - zone;
  const leftTrigger = viewportLeft + zone;

  if (pointerClientX > rightTrigger) {
    const overshoot = Math.min(pointerClientX - rightTrigger, zone);
    return maxSpeedPxPerSec * (overshoot / zone);
  }
  if (pointerClientX < leftTrigger) {
    const overshoot = Math.min(leftTrigger - pointerClientX, zone);
    return -maxSpeedPxPerSec * (overshoot / zone);
  }
  return 0;
}

/** Content-space x of a segment's given edge at the current zoom. */
export function segmentEdgeContentX(
  segment: Pick<VideoSegment, 'startTime' | 'duration'>,
  edge: DragEdge,
  pixelsPerSecond: number,
): number {
  const seconds = edge === 'start'
    ? segment.startTime
    : segment.startTime + segment.duration;
  return seconds * pixelsPerSecond;
}

/**
 * Distance, in pixels, between where the user pressed and the edge they grabbed.
 * Held constant for the whole gesture and subtracted from every subsequent
 * pointer position, so the edge stays exactly under the point of the handle the
 * user is holding rather than jumping to the pointer on the first move.
 */
export function computeGrabOffsetPx(
  pointerContentX: number,
  segment: Pick<VideoSegment, 'startTime' | 'duration'>,
  edge: DragEdge,
  pixelsPerSecond: number,
): number {
  return pointerContentX - segmentEdgeContentX(segment, edge, pixelsPerSecond);
}

export interface DragEdgeInput {
  /** The segment as it was at drag START — never a partially-dragged copy. */
  segment: Pick<VideoSegment, 'startTime' | 'duration' | 'trimStart' | 'trimEnd'>;
  /** The clip's own length, resolved by the caller from the asset the segment
   *  points at (`Asset.duration`). Undefined for an image segment, or when
   *  the probe failed — the Piece 3 trimStart clamp below simply doesn't
   *  engage then, rather than guessing a bound. */
  sourceDuration?: number;
  edge: DragEdge;
  /** Content-space x the grabbed edge should sit at (grab offset already removed). */
  edgeContentX: number;
  pixelsPerSecond: number;
}

export interface DragEdgeResult {
  duration: number;
  trimStart: number;
  /** Content-space left edge, px — what the card's `style.left` must become.
   *  Unchanged from the segment's own start on an end-edge drag; on a
   *  start-edge drag the right edge is pinned, so this is
   *  `(originalEnd - duration) * pixelsPerSecond`. */
  segmentLeftPx: number;
}

/**
 * The single source of truth for what a dragged edge position means, in both
 * the live preview and the committed result.
 *
 * Every arithmetic step below is carried over verbatim from `App.tsx`'s
 * pre-K16 `handleUp`, EXCEPT the video speed-coupling block, removed here
 * (WS3 Batch B, Piece 2 — owner ruling: a video clip always plays at its
 * native rate, "duration ↔ playbackSpeed" is no longer a concept). A video
 * segment's duration is now exactly as freely draggable as an image's; what
 * plays when the dragged duration no longer matches the clip length is a
 * preview/export-time concern (freeze-last-frame for a too-short clip, a
 * `trimStart`-positioned window for a too-long one — see toSourceTime in
 * useWebCodecsPreview.ts and its mirrors), not a constraint on the drag
 * itself. `dragGeometry.test.ts` PART 1 was updated deliberately for this —
 * see its own comments for the old vs. new expected values.
 *
 * Piece 3 (same pass) — a `'start'`-edge drag's `trimStart` is now clamped to
 * `[0, max(0, sourceDuration - duration)]`, the root-cause fix for the
 * slip-trim bar overflow (investigation doc §3): previously unbounded here,
 * an ordinary left-edge drag on a video segment could push `trimStart`
 * arbitrarily high. The clamp only ever engages for a segment with a known,
 * positive `sourceDuration` (i.e. a video segment) — an image segment has
 * none and is unaffected.
 */
export function resolveDragEdge(input: DragEdgeInput): DragEdgeResult {
  const { segment, sourceDuration, edge, edgeContentX, pixelsPerSecond } = input;
  const edgeSec = edgeContentX / pixelsPerSecond;
  const originalTrimStart = segment.trimStart ?? 0;
  const originalEnd = segment.startTime + segment.duration;

  let duration: number;
  let trimStart: number = originalTrimStart;
  if (edge === 'end') {
    duration = Math.max(MIN_SEGMENT_DURATION, edgeSec - segment.startTime);
  } else {
    const rawDelta = edgeSec - segment.startTime;
    duration = Math.max(MIN_SEGMENT_DURATION, segment.duration - rawDelta);
    trimStart = Math.max(0, originalTrimStart + rawDelta);
    const srcDur = sourceDuration ?? 0;
    if (srcDur > 0) {
      trimStart = Math.min(trimStart, Math.max(0, srcDur - duration));
    }
  }

  // A start-edge drag pins the segment's RIGHT edge and moves its left one, so
  // the card's `left` has to move with the width. An end-edge drag leaves the
  // left edge exactly where it was. Getting this wrong in the DOM writer is
  // fault (3) in this file's header.
  const segmentLeftPx = edge === 'start'
    ? (originalEnd - duration) * pixelsPerSecond
    : segment.startTime * pixelsPerSecond;

  return { duration, trimStart, segmentLeftPx };
}
