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

/** Playback-speed clamp for a video segment whose duration is stretched or
 *  squeezed by a drag. Moved here from `App.tsx` (K16) alongside the math that
 *  uses them; `App.tsx` imports them back for the speed slider. */
export const MIN_PLAYBACK_SPEED = 0.5;
export const MAX_PLAYBACK_SPEED = 2.0;

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
  segment: Pick<VideoSegment, 'startTime' | 'duration' | 'trimStart' | 'trimEnd' | 'sourceDuration'>;
  edge: DragEdge;
  /** Content-space x the grabbed edge should sit at (grab offset already removed). */
  edgeContentX: number;
  pixelsPerSecond: number;
  /** True only for a segment backed by a video asset with a known source
   *  duration — gates the playback-speed coupling exactly as before. */
  isVideo: boolean;
}

export interface DragEdgeResult {
  duration: number;
  trimStart: number;
  /** Present only when the speed coupling engaged, matching the pre-K16
   *  `speedUpdate` variable's own presence rule exactly. */
  playbackSpeed?: number;
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
 * pre-K16 `handleUp`, including the order of the clamps and the exact
 * `finalClipLen > 0` gate on the speed coupling. `dragGeometry.test.ts` pins it
 * against a literal transcription of that expression: for the same
 * `edgeContentX`, this must return what the old code returned. K16 changes which
 * `edgeContentX` a given pointer position produces — it does not change what any
 * given `edgeContentX` means.
 */
export function resolveDragEdge(input: DragEdgeInput): DragEdgeResult {
  const { segment, edge, edgeContentX, pixelsPerSecond, isVideo } = input;
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
  }

  let playbackSpeed: number | undefined;
  const srcDur = segment.sourceDuration ?? 0;
  if (isVideo && srcDur > 0) {
    const clipLen = (segment.trimEnd ?? srcDur) - trimStart;
    if (clipLen > 0) {
      const maxDur = clipLen / MIN_PLAYBACK_SPEED;
      const minDur = Math.max(MIN_SEGMENT_DURATION, clipLen / MAX_PLAYBACK_SPEED);
      duration = Math.max(minDur, Math.min(maxDur, duration));
      playbackSpeed = Math.max(
        MIN_PLAYBACK_SPEED,
        Math.min(MAX_PLAYBACK_SPEED, clipLen / duration),
      );
    }
  }

  // A start-edge drag pins the segment's RIGHT edge and moves its left one, so
  // the card's `left` has to move with the width. An end-edge drag leaves the
  // left edge exactly where it was. Getting this wrong in the DOM writer is
  // fault (3) in this file's header.
  const segmentLeftPx = edge === 'start'
    ? (originalEnd - duration) * pixelsPerSecond
    : segment.startTime * pixelsPerSecond;

  return { duration, trimStart, playbackSpeed, segmentLeftPx };
}
