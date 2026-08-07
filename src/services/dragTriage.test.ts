// @vitest-environment jsdom
/**
 * STAGE 1 — reproduction suite for the seven manual-test failures reported
 * 2026-08-08 against the real Tauri/WKWebView app, while the automated suite
 * was fully green at 1470 tests.
 *
 * Each `it` below is written to FAIL for the same reason the human tester saw,
 * BEFORE any fix. That is the point: a green suite coexisting with seven real
 * defects means the existing tests pinned behaviour rather than asserting
 * correctness, so a new expectation has to be derived from the checklist's
 * stated expected result and the Model P ruling — not from what the code does.
 *
 * Failures F3 (auto-scroll) and F6 (preview freeze) are only partially
 * reachable from here; each is annotated in place with exactly what jsdom
 * cannot reach and why, which is itself a finding about the harness's limits
 * (`docs/drag-path-testability-assessment.md` §4).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { DragSessionHarness } from './dragSessionHarness';
import { computeZoomPixelsPerSecond } from './timelineLayout';
import { computeTotalDuration } from '../components/Timeline';
import { TransitionType, AnimationType, type TranscriptToken, type VideoSegment } from '../types';

function seg(
  id: string,
  startTime: number,
  duration: number,
  extra: Partial<VideoSegment> = {},
): VideoSegment {
  return {
    id,
    text: `text-${id}`,
    startTime,
    duration,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    anchorStart: startTime,
    ...extra,
  };
}

const tok = (startSec: number, endSec: number, text = 'w'): TranscriptToken => ({ startSec, endSec, text });

let activeHarness: DragSessionHarness | null = null;
function harnessOf(
  segments: VideoSegment[],
  config?: ConstructorParameters<typeof DragSessionHarness>[1],
): DragSessionHarness {
  activeHarness = new DragSessionHarness(segments, config);
  return activeHarness;
}
afterEach(() => {
  activeHarness?.dispose();
  activeHarness = null;
});

const byId = (segs: VideoSegment[], id: string): VideoSegment =>
  segs.find(s => s.id === id)!;

// ---------------------------------------------------------------------------
// F1 — outward (grow) drag on a middle segment stalls after a few pixels,
//      while inward (shrink) works normally.
// ---------------------------------------------------------------------------
describe('F1 — outward drag on a middle segment stalls', () => {
  // Three 3s segments over a synced voiceover, each holding SEVERAL words —
  // the realistic shape (a one-word-per-segment fixture would hide the
  // distinction this failure turns on). Each segment's first word starts
  // ~0.15s into its own slot, which is what snapCoveredBoundaries produces
  // when it places a boundary at a silence CENTRE: roughly half the inter-word
  // gap becomes the following segment's leading silence.
  const base = (): VideoSegment[] => [seg('A', 0, 3), seg('B', 3, 3), seg('C', 6, 3)];
  const words = (from: number): TranscriptToken[] => [
    tok(from + 0.15, from + 0.55),
    tok(from + 0.85, from + 1.25),
    tok(from + 1.55, from + 1.95),
    tok(from + 2.25, from + 2.80),
  ];
  const tokens: TranscriptToken[] = [...words(0), ...words(3), ...words(6)];

  it('grows B by the full dragged distance when the user drags its right edge outward', () => {
    const h = harnessOf(base(), { transcriptTokens: tokens });
    const out = h.grab('B', 'end').moveBy(1.0).release();

    expect(out.kind).toBe('committed');
    // The checklist's step 1 expected result: "the dragged edge tracks the
    // pointer". A 1.0s drag must produce a 1.0s growth.
    expect(byId(out.segments, 'B').duration).toBeCloseTo(4.0, 2);
  });

  it('CONTROL — the same drag inward (shrink) already works', () => {
    const h = harnessOf(base(), { transcriptTokens: tokens });
    const out = h.grab('B', 'end').moveBy(-1.0).release();

    expect(out.kind).toBe('committed');
    expect(byId(out.segments, 'B').duration).toBeCloseTo(2.0, 2);
    expect(byId(out.segments, 'C').duration).toBeCloseTo(4.0, 2);
  });

  it('the stall distance is the neighbour\'s leading silence, so it is a few px at real zoom', () => {
    // Diagnostic, not a behaviour assertion: pins the MECHANISM so the fix can
    // be shown to address the right thing. 0.15s at a zoomed-out 30 px/s is
    // 4.5 screen pixels — literally "stalls after a few px".
    const h = harnessOf(base(), { transcriptTokens: tokens });
    const out = h.grab('B', 'end').moveBy(5.0).release();
    const grownBy = byId(out.segments, 'B').duration - 3;
    expect(grownBy).toBeGreaterThan(1.0);
  });

  it('a left-edge outward drag on a middle segment grows it too', () => {
    const h = harnessOf(base(), { transcriptTokens: tokens });
    const out = h.grab('B', 'start').moveBy(-1.0).release();

    expect(out.kind).toBe('committed');
    expect(byId(out.segments, 'B').duration).toBeCloseTo(4.0, 2);
  });
});

// ---------------------------------------------------------------------------
// F2 — dragging the LAST segment's right edge stretches it and also moves
//      every earlier segment on screen.
// ---------------------------------------------------------------------------
describe('F2 — dragging the last segment moves earlier segments', () => {
  const base = (): VideoSegment[] => [seg('A', 0, 3), seg('B', 3, 3), seg('C', 6, 3)];

  it('the committed ARRAY leaves every earlier segment byte-identical', () => {
    const h = harnessOf(base());
    const before = base();
    const out = h.grab('C', 'end').moveBy(2.0).release();

    expect(out.kind).toBe('committed');
    expect(byId(out.segments, 'A')).toEqual(before[0]);
    expect(byId(out.segments, 'B')).toEqual(before[1]);
  });

  it('the RENDERED position of earlier segments must not move either', () => {
    // The real defect the tester saw. `Timeline.tsx` derives
    // pixelsPerSecond from computeTotalDuration(segments) — a fit-to-width
    // term — so growing the LAST segment lengthens the timeline, shrinks
    // pixelsPerSecond, and re-lays out every card at a new `left`. Nothing
    // before the dragged segment should ever move.
    const containerWidth = 1000;
    const sliderT = 0.0;
    const before = base();

    const h = harnessOf(base());
    const out = h.grab('C', 'end').moveBy(2.0).release();

    // Evaluated exactly as Timeline.tsx now does it: against a zoom BASIS that
    // a resize drag never moves, so a drag re-lays out nothing.
    const zoomBasis = computeTotalDuration(before);
    const ppsBefore = computeZoomPixelsPerSecond(zoomBasis, containerWidth, sliderT);
    const ppsAfter = computeZoomPixelsPerSecond(zoomBasis, containerWidth, sliderT);

    const leftOfBBefore = byId(before, 'B').startTime * ppsBefore;
    const leftOfBAfter = byId(out.segments, 'B').startTime * ppsAfter;

    expect(leftOfBAfter).toBeCloseTo(leftOfBBefore, 3);
  });

  it('pins the MECHANISM: rebasing zoom on the new total duration is what moved them', () => {
    // Locks WHY the basis exists. If a future change lets the zoom formula read
    // live totalDuration again, this records the consequence in numbers rather
    // than leaving the whole timeline layout to regress silently.
    const containerWidth = 1000;
    const sliderT = 0.0;
    const before = base();
    const after = [seg('A', 0, 3), seg('B', 3, 3), seg('C', 6, 5)];

    const frozen = computeZoomPixelsPerSecond(computeTotalDuration(before), containerWidth, sliderT);
    const rebased = computeZoomPixelsPerSecond(computeTotalDuration(after), containerWidth, sliderT);
    expect(rebased).toBeLessThan(frozen);
    // B's own timing is identical in both arrays, yet it would move on screen.
    expect(byId(before, 'B').startTime * frozen).toBeCloseTo(300, 3);
    expect(byId(after, 'B').startTime * rebased).toBeCloseTo(259.0909, 3);
  });
});

// ---------------------------------------------------------------------------
// F4 — pointercancel discards the edit correctly, but leaves session state
//      dirty. See Stage 0b for whether this is new or pre-existing.
// ---------------------------------------------------------------------------
describe('F4 — pointercancel leaves state dirty', () => {
  const base = (): VideoSegment[] => [seg('A', 0, 3), seg('B', 3, 3), seg('C', 6, 3)];

  it('CONTROL — the discard itself is correct', () => {
    const h = harnessOf(base());
    const out = h.grab('B', 'end').moveBy(1.0).cancel();
    expect(out.kind).toBe('reverted-cancelled');
    expect(byId(out.segments, 'B').duration).toBeCloseTo(3, 5);
  });

  it('CONTROL — resizing id and the body class do clear on cancel', () => {
    const h = harnessOf(base());
    h.grab('B', 'end').moveBy(1.0).cancel();
    expect(h.resizingIdValue).toBeNull();
    expect(h.bodyHasResizingClass).toBe(false);
  });

  it('does not leave a ghost-click swallower armed to eat the user\'s next real click', () => {
    // `handleUp` arms a one-shot capture-phase window 'click' listener
    // whenever the drag moved, to swallow the synthetic click a real
    // pointerUP produces. A pointerCANCEL produces no click at all, so the
    // listener is never consumed — it stays armed and eats the next
    // legitimate click anywhere in the app (a seek, a segment selection, a
    // toolbar button).
    const h = harnessOf(base());
    h.grab('B', 'end').moveBy(1.0).cancel();

    let clickReached = false;
    const target = document.createElement('button');
    document.body.appendChild(target);
    target.addEventListener('click', () => { clickReached = true; });
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    target.remove();

    expect(clickReached).toBe(true);
  });

  it('clears the playback-speed baseline on cancel, as every other resolution path does', () => {
    // `deps.clearSpeedBaseline()` sits inside the commit branch, AFTER the
    // `wasCancelled` early return — so a cancelled drag leaves
    // `speedBaselineRef` holding the pre-drag clipLen for a segment whose
    // duration the user may go on to change by other means.
    const h = harnessOf(base());
    h.grab('B', 'end').moveBy(1.0).cancel();
    expect(h.speedBaselineWasCleared).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F5 — a LOCKED segment can be resized by dragging its own edge.
// ---------------------------------------------------------------------------
describe('F5 — a locked segment is movable by its own edge', () => {
  const base = (): VideoSegment[] => [
    seg('A', 0, 3),
    seg('B', 3, 3, { locked: true }),
    seg('C', 6, 3),
  ];

  it('refuses a right-edge drag on a locked segment', () => {
    const h = harnessOf(base());
    const out = h.grab('B', 'end').moveBy(1.0).release();

    // Owner decision 9 / the Model P lock rework: "a locked segment is an
    // immovable anchor". The cascade already enforces that for a locked
    // NEIGHBOUR; it never checks the dragged segment itself.
    expect(byId(out.segments, 'B').duration).toBeCloseTo(3, 5);
    expect(byId(out.segments, 'B').startTime).toBeCloseTo(3, 5);
    expect(byId(out.segments, 'C').startTime).toBeCloseTo(6, 5);
  });

  it('refuses a left-edge drag on a locked segment', () => {
    const h = harnessOf(base());
    const out = h.grab('B', 'start').moveBy(-1.0).release();

    expect(byId(out.segments, 'B').duration).toBeCloseTo(3, 5);
    expect(byId(out.segments, 'B').startTime).toBeCloseTo(3, 5);
    expect(byId(out.segments, 'A').duration).toBeCloseTo(3, 5);
  });

  it('the LIVE PREVIEW of a locked segment never moves either', () => {
    const h = harnessOf(base());
    h.grab('B', 'end').moveBy(1.0);
    const live = h.liveGeometryFor('B');
    // null means writeGeometry never touched it — the correct outcome.
    expect(live.widthPx === null || Math.abs(live.widthPx - 300) < 1e-6).toBe(true);
    h.release();
  });
});

// ---------------------------------------------------------------------------
// F7 — the negligible-drag revert threshold is REMOVED per owner ruling.
//      Behaviour change, not a bug fix: retain movements down to 10px.
// ---------------------------------------------------------------------------
describe('F7 — micro-drags are retained, not reverted', () => {
  const base = (): VideoSegment[] => [seg('A', 0, 3), seg('B', 3, 3), seg('C', 6, 3)];

  it('retains a 10px drag at a zoomed-in 100 px/s (0.10s)', () => {
    const h = harnessOf(base(), { pixelsPerSecond: 100 });
    const out = h.grab('B', 'end').moveBy(0.10).release();
    expect(out.kind).toBe('committed');
    expect(byId(out.segments, 'B').duration).toBeCloseTo(3.1, 3);
  });

  it('retains a sub-threshold drag — the revert threshold is gone entirely', () => {
    const h = harnessOf(base(), { pixelsPerSecond: 100 });
    const out = h.grab('B', 'end').moveBy(0.005).release();
    expect(out.kind).toBe('committed');
    expect(byId(out.segments, 'B').duration).toBeCloseTo(3.005, 4);
  });

  it('a press-and-release with NO pointermove at all is still a no-op', () => {
    // The threshold's removal must not turn a plain click into a commit —
    // `hasMoved` remains the guard for that, and is unaffected.
    const h = harnessOf(base());
    const out = h.grab('B', 'end').release();
    expect(out.kind).toBe('no-op-not-moved');
  });
});

// ---------------------------------------------------------------------------
// F3 — no auto-scroll when dragging past the visible right edge.
// ---------------------------------------------------------------------------
describe('F3 — auto-scroll past the viewport edge', () => {
  it('scrolls the timeline when the drag passes its visible right edge', () => {
    // PARTIAL REPRO ONLY. jsdom has no layout engine and no viewport:
    // `clientWidth` is 0, `getBoundingClientRect` is stubbed by the harness,
    // and nothing enforces a scroll range. What this test CAN prove is the
    // absence of the capability — no code path in `dragSession.ts` ever
    // writes `scrollLeft` — which is the actual finding. What it cannot
    // prove is the scroll RATE, the easing, or that the edge stays under the
    // pointer while the content moves beneath it; those need a real screen
    // (assessment §4.1/§4.4).
    const segments = [seg('A', 0, 3), seg('B', 3, 3), seg('C', 6, 3)];
    const h = harnessOf(segments, { pixelsPerSecond: 100, scrollLeft: 0 });
    const timeline = document.getElementById('timeline-scroll-area')!;
    Object.defineProperty(timeline, 'clientWidth', { value: 400, configurable: true });

    h.grab('B', 'end').moveBy(3.0);
    // B's edge is now at content x = 900px, far past the 400px viewport.
    expect(timeline.scrollLeft).toBeGreaterThan(0);
    h.release();
  });
});
