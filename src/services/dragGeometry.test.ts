/**
 * K16 — drag geometry tests.
 *
 * PART 1 originally pinned `resolveDragEdge` byte-identical to the pre-K16
 * commit math (video speed-coupling included) across a full sweep. WS3
 * Batch B deliberately breaks that pin: the owner ruled `playbackSpeed`
 * removed as a concept (a video clip always plays at its native rate), so
 * `resolveDragEdge` no longer computes a speed-coupled duration/speed pair
 * at all, and gained a new clamp instead — a `'start'`-edge drag's
 * `trimStart` is now bounded to `[0, max(0, sourceDuration - duration)]`
 * (Piece 3, the slip-trim-bar-overflow root-cause fix). This section is
 * updated deliberately, not weakened: the sweep now pins `resolveDragEdge`
 * against `postBatchBCommit`, a literal transcription of the NEW math, and a
 * separate "what changed" block below states the old vs. new value for every
 * case where the two functions actually disagree, with the reason.
 *
 * PART 2 covers the pointer-accuracy fix itself, which DOES change which
 * `edgeContentX` a given pointer position produces — that is the defect being
 * fixed, and it is deliberately isolated from PART 1's surface.
 */

import { describe, it, expect } from 'vitest';
import {
  timelineContentX,
  segmentEdgeContentX,
  computeGrabOffsetPx,
  resolveDragEdge,
  computeAutoScrollVelocity,
  AUTOSCROLL_EDGE_ZONE_PX,
  AUTOSCROLL_MAX_SPEED_PX_PER_SEC,
  type DragEdge,
} from './dragGeometry';
import { MIN_SEGMENT_DURATION } from './dragCascade';
import { TransitionType, AnimationType, type VideoSegment } from '../types';

function seg(extra: Partial<VideoSegment> = {}): VideoSegment {
  return {
    id: 'S',
    text: 'text',
    startTime: 10,
    duration: 5,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// PART 1 — timing neutrality (WS3 Batch B — updated deliberately, see header).
// ---------------------------------------------------------------------------

/** Historical reference only — the pre-K16 / pre-Batch-B commit math,
 *  including the now-removed video speed coupling. Used below purely to
 *  compute "what the old code would have said" for the explicit before/after
 *  callouts; no longer the sweep's own oracle (see postBatchBCommit). */
function preBatchBCommit(
  originalTarget: VideoSegment,
  type: DragEdge,
  x: number,
  pps: number,
  isVideoSeg: boolean,
  sourceDuration?: number,
): { finalDuration: number; finalTrimStart: number; speedUpdate?: { playbackSpeed: number } } {
  const MIN_PLAYBACK_SPEED = 0.5;
  const MAX_PLAYBACK_SPEED = 2.0;
  const srcDur = sourceDuration ?? 0;
  let finalDuration: number;
  let finalTrimStart: number = originalTarget.trimStart ?? 0;
  if (type === 'end') {
    finalDuration = Math.max(MIN_SEGMENT_DURATION, (x / pps) - originalTarget.startTime);
  } else {
    const rawDelta = (x / pps) - originalTarget.startTime;
    finalDuration = Math.max(MIN_SEGMENT_DURATION, originalTarget.duration - rawDelta);
    finalTrimStart = Math.max(0, (originalTarget.trimStart ?? 0) + rawDelta);
  }
  let speedUpdate: { playbackSpeed: number } | undefined;
  if (isVideoSeg && srcDur > 0) {
    const finalClipLen = (originalTarget.trimEnd ?? srcDur) - finalTrimStart;
    if (finalClipLen > 0) {
      const maxDur = finalClipLen / MIN_PLAYBACK_SPEED;
      const minDur = Math.max(MIN_SEGMENT_DURATION, finalClipLen / MAX_PLAYBACK_SPEED);
      finalDuration = Math.max(minDur, Math.min(maxDur, finalDuration));
      const newSpeed = Math.max(
        MIN_PLAYBACK_SPEED,
        Math.min(MAX_PLAYBACK_SPEED, finalClipLen / finalDuration),
      );
      speedUpdate = { playbackSpeed: newSpeed };
    }
  }
  return { finalDuration, finalTrimStart, speedUpdate };
}

/**
 * The CURRENT `resolveDragEdge` math, transcribed literally as the sweep's
 * oracle — no speed coupling, plus the Piece 3 `trimStart` clamp against
 * `sourceDuration` on a `'start'`-edge drag.
 */
function postBatchBCommit(
  originalTarget: VideoSegment,
  type: DragEdge,
  x: number,
  pps: number,
  sourceDuration?: number,
): { finalDuration: number; finalTrimStart: number } {
  const srcDur = sourceDuration ?? 0;
  let finalDuration: number;
  let finalTrimStart: number = originalTarget.trimStart ?? 0;
  if (type === 'end') {
    finalDuration = Math.max(MIN_SEGMENT_DURATION, (x / pps) - originalTarget.startTime);
  } else {
    const rawDelta = (x / pps) - originalTarget.startTime;
    finalDuration = Math.max(MIN_SEGMENT_DURATION, originalTarget.duration - rawDelta);
    finalTrimStart = Math.max(0, (originalTarget.trimStart ?? 0) + rawDelta);
    if (srcDur > 0) {
      finalTrimStart = Math.min(finalTrimStart, Math.max(0, srcDur - finalDuration));
    }
  }
  return { finalDuration, finalTrimStart };
}

describe('WS3 Batch B PART 1 — resolveDragEdge is timing-identical to the current (post-speed-removal) commit math', () => {
  // The clip length is no longer a segment field — it is resolved from the
  // asset and handed to resolveDragEdge as its own input, so fixtures carry it
  // beside the segment rather than on it.
  const fixtures: { name: string; segment: VideoSegment; sourceDuration?: number }[] = [
    { name: 'image segment (never had speed coupling)', segment: seg() },
    {
      name: 'video segment with a known clip length',
      segment: seg({ trimStart: 1 }),
      sourceDuration: 12,
    },
    {
      name: 'video segment with an explicit trimEnd',
      segment: seg({ trimStart: 2, trimEnd: 9 }),
      sourceDuration: 30,
    },
    {
      name: 'segment with NO known clip length (trimStart clamp must stay off)',
      segment: seg(),
    },
    {
      name: 'segment already at the minimum slot width',
      segment: seg({ duration: MIN_SEGMENT_DURATION }),
    },
  ];
  const edges: DragEdge[] = ['start', 'end'];
  const zooms = [20, 100, 400];

  for (const f of fixtures) {
    for (const edge of edges) {
      for (const pps of zooms) {
        it(`${f.name} — ${edge} edge @ ${pps}px/s`, () => {
          // Sweep the edge across, and well past, the segment on both sides, so
          // every clamp branch is exercised rather than just the happy path.
          for (let sec = 0; sec <= 25; sec += 0.25) {
            const x = sec * pps;
            const old = postBatchBCommit(f.segment, edge, x, pps, f.sourceDuration);
            const now = resolveDragEdge({
              segment: f.segment,
              sourceDuration: f.sourceDuration,
              edge,
              edgeContentX: x,
              pixelsPerSecond: pps,
            });
            expect(now.duration).toBe(old.finalDuration);
            expect(now.trimStart).toBe(old.finalTrimStart);
          }
        });
      }
    }
  }

  it('the live-preview duration and the committed duration are still one value, not two copies', () => {
    const s = seg({ trimStart: 1 });
    const args = { segment: s, sourceDuration: 12, edge: 'end' as const, edgeContentX: 1740, pixelsPerSecond: 100 };
    expect(resolveDragEdge(args).duration).toBe(resolveDragEdge(args).duration);
    expect(resolveDragEdge(args)).toEqual(resolveDragEdge(args));
  });
});

describe('WS3 Batch B PART 1b — explicit before/after callouts for every case that changed', () => {
  it('a video segment dragged to stretch past 2x clip length: OLD clamped duration + set a speed, NEW leaves duration alone and never touches speed', () => {
    // sourceDuration 12, trimStart 1 → clipLen 11 at 1x. Dragging the end edge
    // out to 35s of raw content-space asks for duration 25 (startTime 10 → 35).
    const s = seg({ trimStart: 1 });
    const pps = 100;
    const x = 35 * pps;
    const old = preBatchBCommit(s, 'end', x, pps, /* isVideoSeg */ true, 12);
    // OLD: raw duration 25 exceeds clipLen/MIN_SPEED = 11/0.5 = 22, the max
    // duration the speed coupling allowed, so duration was clamped to 22 and
    // speed set to 0.5.
    expect(old.finalDuration).toBe(22);
    expect(old.speedUpdate?.playbackSpeed).toBe(0.5);

    const now = resolveDragEdge({ segment: s, sourceDuration: 12, edge: 'end', edgeContentX: x, pixelsPerSecond: pps });
    // NEW: no clamp tied to clip length at all — duration is exactly the raw
    // drag distance (25s), and there is no playbackSpeed field any more.
    expect(now.duration).toBe(25);
    expect('playbackSpeed' in now).toBe(false);
  });

  it('a video segment dragged to squeeze below 0.5x clip length: OLD floored duration + set a speed, NEW leaves duration alone', () => {
    // sourceDuration 12, trimStart 1 → clipLen 11 at 1x. Dragging the end edge
    // in to 12s of raw content-space asks for duration 2 (startTime 10 → 12).
    const s = seg({ trimStart: 1 });
    const pps = 100;
    const x = 12 * pps;
    const old = preBatchBCommit(s, 'end', x, pps, /* isVideoSeg */ true, 12);
    // OLD: clipLen/MAX_SPEED = 11/2.0 = 5.5 is the min duration the speed
    // coupling allowed, so duration was floored to 5.5 and speed set to 2.0.
    expect(old.finalDuration).toBe(5.5);
    expect(old.speedUpdate?.playbackSpeed).toBe(2.0);

    const now = resolveDragEdge({ segment: s, sourceDuration: 12, edge: 'end', edgeContentX: x, pixelsPerSecond: pps });
    // NEW: duration is exactly the raw drag distance (2s) — no speed floor.
    expect(now.duration).toBe(2);
    expect('playbackSpeed' in now).toBe(false);
  });

  it('a start-edge drag pushing trimStart past the clip end: OLD left it unbounded, NEW clamps it to sourceDuration - duration (Piece 3)', () => {
    // sourceDuration 12, trimStart 1, startTime 10, duration 5 (spans 10..15).
    // Dragging the start edge far left (content-space 0) asks for
    // finalTrimStart = 1 + (0 - 10) = -9 → clamped by the >=0 floor to... no,
    // rawDelta = -10, so trimStart candidate = max(0, 1 + -10) = 0 in this
    // direction — use a RIGHTWARD start-edge drag instead, which is the
    // actual overflow-producing direction (investigation doc §3): drag the
    // start edge to content-space 14.9s, just shy of the segment's own end.
    const s = seg({ trimStart: 1, startTime: 10, duration: 5 });
    const pps = 100;
    const x = 14.9 * pps;
    const old = preBatchBCommit(s, 'start', x, pps, /* isVideoSeg */ true, 12);
    // rawDelta = 14.9 - 10 = 4.9; finalDuration = max(MIN, 5 - 4.9) = 0.3
    // (MIN_SEGMENT_DURATION); OLD finalTrimStart = max(0, 1 + 4.9) = 5.9 —
    // unbounded against sourceDuration, and 5.9 + 0.3 = 6.2 <= 12 so it
    // happens not to overflow THIS clip, but nothing stopped it from doing so
    // for a shorter clip (this is exactly the bug Piece 3 closes).
    expect(old.finalTrimStart).toBeCloseTo(5.9, 9);

    const now = resolveDragEdge({ segment: s, sourceDuration: 12, edge: 'start', edgeContentX: x, pixelsPerSecond: pps });
    // NEW: same raw candidate (5.9), but now clamped to
    // max(0, sourceDuration - duration) = max(0, 12 - 0.3) = 11.7 — a no-op
    // here since 5.9 < 11.7. The clamp becomes visible in the next test,
    // where sourceDuration is short enough for it to actually bite.
    expect(now.trimStart).toBeCloseTo(5.9, 9);
  });

  it('a start-edge drag whose unclamped trimStart WOULD exceed sourceDuration - duration: NEW clamps it, closing the slip-bar overflow', () => {
    // A short clip (sourceDuration 4) makes the unclamped candidate exceed
    // the legal bound: trimStart 0, startTime 10, duration 5 (spans 10..15).
    // Drag the start edge to content-space 14.9s.
    const s = seg({ trimStart: 0, startTime: 10, duration: 5 });
    const pps = 100;
    const x = 14.9 * pps;
    const old = preBatchBCommit(s, 'start', x, pps, /* isVideoSeg */ true, 4);
    // rawDelta = 4.9; OLD finalTrimStart = max(0, 0 + 4.9) = 4.9 — already
    // past the clip's own 4s length, with nothing to stop it.
    expect(old.finalTrimStart).toBeCloseTo(4.9, 9);

    const now = resolveDragEdge({ segment: s, sourceDuration: 4, edge: 'start', edgeContentX: x, pixelsPerSecond: pps });
    // NEW: clamped to max(0, sourceDuration - duration) = max(0, 4 - 0.3) =
    // 3.7 (duration itself floors to MIN_SEGMENT_DURATION=0.3 here, same as
    // OLD) — trimStart can no longer land past what the clip actually has,
    // which is the root-cause fix for the slip-trim-bar overflow.
    expect(now.trimStart).toBeCloseTo(3.7, 9);
    expect(now.trimStart + now.duration).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// PART 2 — pointer accuracy. This is the behaviour K16 intentionally changes.
// ---------------------------------------------------------------------------

describe('K16 PART 2 — pointer accuracy', () => {
  it('timelineContentX carries no padding correction — the container has none', () => {
    // Measured live in the running app: #timeline-scroll-area computes
    // paddingLeft 0px / borderLeftWidth 0px, and its content origin sits exactly
    // 0px from getBoundingClientRect().left. Pre-K16 this subtracted a further
    // 24px, left over from the initial commit's `p-6` container (annotated
    // "// 24 is padding" there) which the layout redesign changed to `p-0`.
    expect(timelineContentX(500, 120, 0)).toBe(380);   // pre-K16: 356
    expect(timelineContentX(500, 120, 640)).toBe(1020); // pre-K16: 996
  });

  it('the 24px error was constant in pixels — it is the SECONDS error that scaled with zoom', () => {
    // This is what distinguishes a stale-origin constant from a wrong
    // pixels-per-second: a scale fault would show a gap proportional to the
    // distance dragged, at a fixed number of SECONDS. This showed the opposite.
    for (const pps of [20, 100, 400]) {
      const correct = timelineContentX(800, 100, 0);
      const preK16 = correct - 24;
      expect(correct - preK16).toBe(24);                       // px error: constant
      expect((correct - preK16) / pps).toBeCloseTo(24 / pps, 9); // seconds error: 1.2s / 0.24s / 0.06s
    }
  });

  it('the grab offset holds the edge under the exact point of the handle that was pressed', () => {
    const s = seg({ startTime: 10, duration: 5 });
    const pps = 100;
    // The end handle is 8px wide and sits flush INSIDE the segment's right edge
    // (1500px), i.e. it spans 1492..1500. The user presses at 1494.
    const grab = computeGrabOffsetPx(1494, s, 'end', pps);
    expect(grab).toBe(-6);
    // Moving the pointer 200px right must move the edge exactly 200px right, and
    // the edge must stay 6px right of the pointer for the whole gesture.
    const edgeAt = (pointerX: number) => pointerX - grab;
    expect(edgeAt(1494)).toBe(1500);
    expect(edgeAt(1694)).toBe(1700);
    expect(edgeAt(1294)).toBe(1300);
  });

  it('without a grab offset the edge jumps by up to the handle width on the first move', () => {
    const s = seg({ startTime: 10, duration: 5 });
    // Pre-K16 the edge was set straight from the pointer: pressing at 1492 (the
    // far side of the 8px handle) snapped the 1500px edge to 1492 before the
    // pointer had moved at all.
    expect(segmentEdgeContentX(s, 'end', 100)).toBe(1500);
    expect(computeGrabOffsetPx(1492, s, 'end', 100)).toBe(-8);
  });

  it('a start-edge drag moves the card LEFT and pins its right edge', () => {
    // Fault (3): pre-K16 only `style.width` was written, so on a start-edge drag
    // the grabbed edge never moved and the OPPOSITE edge moved instead — the lag
    // equalled the whole drag distance. Both properties are now derived here.
    const s = seg({ startTime: 10, duration: 5 }); // spans 1000..1500 px @100
    const r = resolveDragEdge({
      segment: s, edge: 'start', edgeContentX: 800, pixelsPerSecond: 100,
    });
    expect(r.segmentLeftPx).toBe(800);                                 // left edge follows the pointer
    expect(r.segmentLeftPx + r.duration * 100).toBeCloseTo(1500, 9);   // right edge pinned
  });

  it('an end-edge drag leaves the card\'s left edge exactly where it was', () => {
    const s = seg({ startTime: 10, duration: 5 });
    const r = resolveDragEdge({
      segment: s, edge: 'end', edgeContentX: 1700, pixelsPerSecond: 100,
    });
    expect(r.segmentLeftPx).toBe(1000);
    expect(r.segmentLeftPx + r.duration * 100).toBeCloseTo(1700, 9);
  });

  it('both edges track the pointer 1:1 across a sweep, at every zoom level', () => {
    const s = seg({ startTime: 10, duration: 5 });
    for (const pps of [20, 100, 400]) {
      for (const edge of ['start', 'end'] as DragEdge[]) {
        const edge0 = segmentEdgeContentX(s, edge, pps);
        const grab = computeGrabOffsetPx(edge0 + 3, s, edge, pps); // pressed 3px off the edge
        for (const move of [-150, -40, 0, 40, 150]) {
          const pointer = edge0 + 3 + move;
          const edgeX = pointer - grab;
          const r = resolveDragEdge({
            segment: s, edge, edgeContentX: edgeX, pixelsPerSecond: pps,
          });
          const renderedEdge = edge === 'start'
            ? r.segmentLeftPx
            : r.segmentLeftPx + r.duration * pps;
          // Below the MIN_SEGMENT_DURATION clamp the edge legitimately stops
          // following; everywhere above it, it must sit exactly on the pointer.
          if (r.duration > MIN_SEGMENT_DURATION + 1e-9) {
            expect(renderedEdge).toBeCloseTo(edgeX, 6);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// PART 4 — computeAutoScrollVelocity (edge auto-scroll, checklist step 9).
//
// Pure, DOM-free: the viewport rect is a caller-supplied argument, which is the
// only reason this is unit-testable at all (jsdom has no layout engine, so a
// real element's clientWidth is permanently 0). The end-to-end behaviour —
// ramp start/stop, teardown, and the commit-equivalence property that protects
// golden replay — lives in dragTriage.test.ts's F3 block against the real
// session. This file covers the arithmetic in isolation.
// ---------------------------------------------------------------------------
describe('PART 4 — computeAutoScrollVelocity', () => {
  // A viewport occupying clientX 0..400, so the right zone is 352..400 and the
  // left zone is 0..48 at the default 48px zone width.
  const VIEWPORT_LEFT = 0;
  const VIEWPORT_WIDTH = 400;
  const v = (clientX: number): number =>
    computeAutoScrollVelocity(clientX, VIEWPORT_LEFT, VIEWPORT_WIDTH);

  it('is exactly zero anywhere between the two edge zones', () => {
    for (const x of [48, 100, 200, 300, 352]) {
      expect(v(x), `clientX ${x} should not scroll`).toBe(0);
    }
  });

  it('ramps linearly from zero at the zone boundary to full speed at the viewport edge', () => {
    expect(v(352)).toBe(0); // exactly on the boundary — still no scroll
    expect(v(376)).toBeCloseTo(AUTOSCROLL_MAX_SPEED_PX_PER_SEC * 0.5, 9); // halfway
    expect(v(400)).toBeCloseTo(AUTOSCROLL_MAX_SPEED_PX_PER_SEC, 9); // at the edge
  });

  it('saturates rather than accelerating without bound past the edge', () => {
    expect(v(500)).toBeCloseTo(AUTOSCROLL_MAX_SPEED_PX_PER_SEC, 9);
    expect(v(100000)).toBeCloseTo(AUTOSCROLL_MAX_SPEED_PX_PER_SEC, 9);
  });

  it('is negative in the leading zone, mirroring the trailing one', () => {
    expect(v(24)).toBeCloseTo(-AUTOSCROLL_MAX_SPEED_PX_PER_SEC * 0.5, 9);
    expect(v(0)).toBeCloseTo(-AUTOSCROLL_MAX_SPEED_PX_PER_SEC, 9);
    expect(v(-999)).toBeCloseTo(-AUTOSCROLL_MAX_SPEED_PX_PER_SEC, 9);
  });

  it('respects a non-zero viewport origin', () => {
    // Same viewport shifted right by 1000px — every result must shift with it.
    expect(computeAutoScrollVelocity(1400, 1000, 400))
      .toBeCloseTo(AUTOSCROLL_MAX_SPEED_PX_PER_SEC, 9);
    expect(computeAutoScrollVelocity(1200, 1000, 400)).toBe(0);
  });

  it('degrades safely on a viewport with no width — jsdom\'s default', () => {
    // clientWidth 0 is what an unstubbed element reports, so this is the path
    // every pre-existing drag test takes: auto-scroll must simply not engage.
    expect(computeAutoScrollVelocity(395, 0, 0)).toBe(0);
    expect(computeAutoScrollVelocity(0, 0, 0)).toBe(0);
  });

  it('splits a viewport narrower than two zones in half instead of letting them fight', () => {
    // 60px wide: two 48px zones would overlap across the whole viewport and
    // both trigger. The zone collapses to 30px each, so the midpoint is neutral.
    expect(computeAutoScrollVelocity(30, 0, 60)).toBe(0);
    expect(computeAutoScrollVelocity(60, 0, 60)).toBeCloseTo(AUTOSCROLL_MAX_SPEED_PX_PER_SEC, 9);
    expect(computeAutoScrollVelocity(0, 0, 60)).toBeCloseTo(-AUTOSCROLL_MAX_SPEED_PX_PER_SEC, 9);
  });

  it('the exported zone width is what the ramp is actually measured against', () => {
    // Guards against the constant and the formula drifting apart.
    const justInside = VIEWPORT_WIDTH - AUTOSCROLL_EDGE_ZONE_PX + 1;
    expect(v(justInside)).toBeGreaterThan(0);
    expect(v(VIEWPORT_WIDTH - AUTOSCROLL_EDGE_ZONE_PX)).toBe(0);
  });
});
