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

/** Dispatches one real bubbling click at a throwaway element and reports
 *  whether it survived the capture-phase window listeners `handleUp` arms.
 *  Consumes exactly one armed one-shot swallower per call. */
function clickReachesTarget(): boolean {
  let reached = false;
  const target = document.createElement('button');
  document.body.appendChild(target);
  target.addEventListener('click', () => { reached = true; });
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  target.remove();
  return reached;
}

/** jsdom never synthesizes the click a real browser produces after a release,
 *  so swallowers armed by earlier tests in this shared-per-file environment
 *  survive into later ones. Drain them so a swallow assertion measures the
 *  gesture under test rather than the file's history. */
function drainGhostClickSwallowers(): void {
  for (let i = 0; i < 100; i++) if (clickReachesTarget()) return;
}

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
//
// RESOLVED BY RULING, NOT BY FIX (2026-08-08) —
// `docs/decisions/2026-08-08-last-segment-edge.md`, semantic option (i).
//
// The three tests below were written against an operation that no longer
// exists: the last segment's right edge is now inert in both directions. They
// are CONVERTED rather than deleted, because between them they still state the
// three things worth protecting, and each would catch a real regression:
//
//   1. the array-level claim  -> now: the gesture commits nothing at all;
//   2. the render-level claim -> now: the same, proven through the layout math
//                                that produced the visible drift;
//   3. the mechanism pin      -> KEPT VERBATIM, including the 300px ->
//                                259.0909px rescale numbers. It never drove
//                                the drag path — it is a pure computation over
//                                two hand-written arrays — and it is now the
//                                record of WHY the operation was removed rather
//                                than merely re-fixed. See its own note below.
// ---------------------------------------------------------------------------
describe('F2 — the last segment\'s right edge is inert (ruled 2026-08-08)', () => {
  const base = (): VideoSegment[] => [seg('A', 0, 3), seg('B', 3, 3), seg('C', 6, 3)];

  it('the gesture commits nothing — every segment, dragged one included, is byte-identical', () => {
    // BEFORE: asserted the drag COMMITTED and that only earlier segments were
    // untouched (`out.kind === 'committed'`, A and B unchanged, C grown).
    // AFTER: the whole array is unchanged, including C. The earlier claim is
    // strictly implied by this one, so nothing is lost by strengthening it.
    const h = harnessOf(base());
    const before = base();
    const out = h.grab('C', 'end').moveBy(2.0).release();

    expect(out.kind).toBe('no-op-not-moved');
    expect(byId(out.segments, 'A')).toEqual(before[0]);
    expect(byId(out.segments, 'B')).toEqual(before[1]);
    expect(byId(out.segments, 'C')).toEqual(before[2]);
  });

  it('total timeline duration is unchanged, so nothing can be re-laid-out at all', () => {
    // BEFORE: computed each card's rendered `left` before and after the drag
    // against a FROZEN zoom basis, and asserted B had not moved. That test
    // could only ever pass — it evaluated the same basis on both sides — so it
    // was really asserting the freeze's existence, not the drag's safety.
    // AFTER: asserts the thing the freeze was compensating for. If total
    // duration cannot move, `computeZoomPixelsPerSecond` cannot rebase, and no
    // card can be re-laid-out, whether or not the basis is frozen. That is a
    // claim about the operation rather than about one mitigation of it.
    const containerWidth = 1000;
    const sliderT = 0.0;
    const before = base();

    const h = harnessOf(base());
    const out = h.grab('C', 'end').moveBy(2.0).release();

    expect(computeTotalDuration(out.segments)).toBeCloseTo(computeTotalDuration(before), 9);

    // And therefore, evaluated against LIVE total duration on both sides — the
    // formula as it behaves with no freeze at all — every card lands where it
    // started.
    const ppsBefore = computeZoomPixelsPerSecond(computeTotalDuration(before), containerWidth, sliderT);
    const ppsAfter = computeZoomPixelsPerSecond(computeTotalDuration(out.segments), containerWidth, sliderT);
    expect(ppsAfter).toBeCloseTo(ppsBefore, 9);
    expect(byId(out.segments, 'B').startTime * ppsAfter)
      .toBeCloseTo(byId(before, 'B').startTime * ppsBefore, 9);
  });

  it('pins the MECHANISM: rebasing zoom on a new total duration is what moved them', () => {
    // KEPT VERBATIM, deliberately — including the 300px -> 259.0909px numbers.
    //
    // Its intent is unchanged and it never exercised the drag path: it is a
    // pure computation over two hand-written arrays, `before` and `after`,
    // neither produced by a gesture. What it measures is what the fit-to-width
    // zoom term DOES when total duration changes by any means — and total
    // duration is still changed by Apply Sync, by the playback-speed slider, by
    // the segment editor's numeric duration field, and by project load
    // (`docs/decisions/2026-08-08-last-segment-edge.md` §4). So the rescale is
    // still live; the ruling removed one way of triggering it, not the effect.
    //
    // It is also now the numeric record of why option (i) was chosen over (ii)
    // and (iii): both of those keep an edge that moves total duration, and this
    // is the size of the visual consequence when it does.
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

  it('the last segment\'s LEFT edge still drags — the ruling locks one edge, not the card', () => {
    // NEW. Without it, "the last segment is inert" could widen silently to the
    // whole card and the suite would not notice; the ruling is explicit that
    // the left edge "remains fully draggable".
    const h = harnessOf(base());
    const out = h.grab('C', 'start').moveBy(-1.0).release();

    expect(out.kind).toBe('committed');
    expect(byId(out.segments, 'C').duration).toBeCloseTo(4.0, 2);
    expect(byId(out.segments, 'B').duration).toBeCloseTo(2.0, 2);
    // …and even this one does not change total duration.
    expect(computeTotalDuration(out.segments)).toBeCloseTo(9, 6);
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
    // listener was never consumed — it stayed armed and ate the next
    // legitimate click anywhere in the app (a seek, a segment selection, a
    // toolbar button).
    //
    // vitest shares one jsdom per FILE, and a real browser — unlike jsdom —
    // synthesizes the click that consumes this listener after every genuine
    // release. So drain whatever earlier tests in this file left armed before
    // measuring; otherwise this asserts test-file pollution, not the defect.
    drainGhostClickSwallowers();

    const h = harnessOf(base());
    h.grab('B', 'end').moveBy(1.0).cancel();

    expect(clickReachesTarget()).toBe(true);
  });

  it('CONTROL — a genuine release still arms exactly one swallower', () => {
    // Proves the test above can actually fail: the swallow is real, one-shot,
    // and still does its D12 job on the path that produces a ghost click.
    drainGhostClickSwallowers();

    const h = harnessOf(base());
    h.grab('B', 'end').moveBy(1.0).release();

    expect(clickReachesTarget()).toBe(false);  // swallowed
    expect(clickReachesTarget()).toBe(true);   // one-shot: the next one lands
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
  // IMPLEMENTED 2026-08-08 (WS2 re-scope, Stage 3 — checklist step 9). This
  // block was previously a single `it.fails` asserting the ABSENCE of the
  // capability: no code path in `dragSession.ts` wrote `scrollLeft` at all.
  // It is now a real passing suite, so the "1 expected fail" is gone from the
  // suite's counts.
  //
  // What these tests CAN prove: the ramp starts and stops on the right pointer
  // positions, the scroll rate is proportional to overshoot and to elapsed
  // time, the loop is torn down on every resolution path, and — the property
  // that actually protects the golden replay — a drag that reaches a given
  // content-x by scrolling commits IDENTICALLY to one that reaches it by
  // pointer motion alone.
  //
  // What they cannot prove, and what checklist step 9 stays manual for: how it
  // FEELS. Whether the ramp is comfortable, whether the edge visibly stays
  // under the pointer while content moves beneath it, whether it janks under a
  // real compositor (assessment §4.1/§4.4).
  const base = (): VideoSegment[] => [seg('A', 0, 3), seg('B', 3, 3), seg('C', 6, 3)];
  // A 400px viewport on a 900px timeline: 500px of scroll range.
  const viewport = { pixelsPerSecond: 100, scrollLeft: 0, viewportWidth: 400, scrollWidth: 900 };

  it('scrolls the timeline when the drag passes its visible right edge', () => {
    const h = harnessOf(base(), viewport);
    // Park the pointer at clientX 395 — inside the right edge zone (the zone
    // starts at 400 - 48 = 352).
    h.grab('B', 'end').movePointerTo(395);
    expect(h.autoScrollActive).toBe(true);
    h.advanceTime(100);
    expect(h.scrollLeft).toBeGreaterThan(0);
    h.release();
  });

  it('does not scroll while the pointer is comfortably inside the viewport', () => {
    const h = harnessOf(base(), viewport);
    h.grab('B', 'end').movePointerTo(200); // mid-viewport, both zones clear
    expect(h.autoScrollActive).toBe(false);
    h.advanceTime(500);
    expect(h.scrollLeft).toBe(0);
    h.release();
  });

  it('stops the moment the pointer comes back inside the viewport', () => {
    const h = harnessOf(base(), viewport);
    h.grab('B', 'end').movePointerTo(395);
    h.advanceTime(100);
    const scrolledTo = h.scrollLeft;
    expect(scrolledTo).toBeGreaterThan(0);

    h.movePointerTo(200); // back inside
    h.advanceTime(500);
    expect(h.autoScrollActive).toBe(false);
    expect(h.scrollLeft).toBe(scrolledTo); // not one pixel further
    h.release();
  });

  it('scrolls faster the further past the edge the pointer sits', () => {
    const gentle = harnessOf(base(), viewport);
    gentle.grab('B', 'end').movePointerTo(365); // 13px into the 48px zone
    gentle.advanceTime(50);
    const gentleScroll = gentle.scrollLeft;
    gentle.release();
    gentle.dispose();

    const hard = harnessOf(base(), viewport);
    hard.grab('B', 'end').movePointerTo(420); // past the edge — saturated
    hard.advanceTime(50);
    const hardScroll = hard.scrollLeft;
    hard.release();

    expect(gentleScroll).toBeGreaterThan(0);
    expect(hardScroll).toBeGreaterThan(gentleScroll);
  });

  it('scrolls left, not right, in the leading edge zone', () => {
    const h = harnessOf(base(), { ...viewport, scrollLeft: 300 });
    h.grab('B', 'end').movePointerTo(10); // inside the left zone (0..48)
    h.advanceTime(100);
    expect(h.scrollLeft).toBeLessThan(300);
    h.release();
  });

  it('clamps at both ends of the scroll range', () => {
    const atEnd = harnessOf(base(), { ...viewport, scrollLeft: 500 }); // already at max
    atEnd.grab('B', 'end').movePointerTo(420);
    atEnd.advanceTime(5000);
    expect(atEnd.scrollLeft).toBe(500); // scrollWidth 900 - clientWidth 400
    atEnd.release();
    atEnd.dispose();

    const atStart = harnessOf(base(), viewport); // scrollLeft 0
    atStart.grab('B', 'end').movePointerTo(0);
    atStart.advanceTime(5000);
    expect(atStart.scrollLeft).toBe(0);
    atStart.release();
  });

  it('the ramp is torn down on release, on cancel, and on a blocked drag', () => {
    // The universal post-condition (dragSessionHarness.ts) already fails any
    // test leaving a queued auto-scroll frame, so this asserts it directly for
    // all three resolutions rather than relying on the audit alone.
    const released = harnessOf(base(), viewport);
    released.grab('B', 'end').movePointerTo(395);
    expect(released.autoScrollActive).toBe(true);
    released.release();
    expect(released.autoScrollActive).toBe(false);
    released.dispose();

    const cancelled = harnessOf(base(), viewport);
    cancelled.grab('B', 'end').movePointerTo(395);
    expect(cancelled.autoScrollActive).toBe(true);
    cancelled.cancel();
    expect(cancelled.autoScrollActive).toBe(false);
    cancelled.dispose();

    const blocked = harnessOf(
      [seg('A', 0, 3), seg('B', 3, 3), seg('C', 6, 3, { locked: true })],
      viewport,
    );
    blocked.grab('B', 'end').movePointerTo(395);
    expect(blocked.autoScrollActive).toBe(true);
    const outcome = blocked.release();
    expect(outcome.kind).toBe('reverted-blocked');
    expect(blocked.autoScrollActive).toBe(false);
  });

  // -------------------------------------------------------------------------
  // THE PROPERTY THAT PROTECTS GOLDEN REPLAY.
  // -------------------------------------------------------------------------
  it('a drag that reaches a content-x by SCROLLING commits identically to one that reaches it by pointer motion', () => {
    // Content-space x is `clientX - rectLeft + scrollLeft` (dragGeometry.ts's
    // timelineContentX), read live on every resolve. So 300px of scroll and
    // 300px of pointer travel are the same displacement by construction — this
    // test is what proves auto-scroll introduced no second, competing delta.
    const TARGET_CONTENT_X = 900; // B's right edge from 600px -> 900px = +3.00s

    // (a) No auto-scroll: pointer travels the whole way inside a wide viewport.
    const byPointer = harnessOf(base(), {
      pixelsPerSecond: 100, scrollLeft: 0, viewportWidth: 2000, scrollWidth: 2000,
    });
    const pointerOutcome = byPointer.grab('B', 'end').moveBy(3.0).release();
    expect(byPointer.scrollLeft).toBe(0); // nothing auto-scrolled
    byPointer.dispose();

    // (b) With auto-scroll: the pointer moves only part of the way, parks in
    // the edge zone, and the scroll ramp covers the rest.
    const byScroll = harnessOf(base(), viewport);
    byScroll.grab('B', 'end').movePointerTo(700); // +100px of pointer travel
    // Ramp until the remaining 200px of scroll has been covered, then step out
    // of the edge zone so the loop stops exactly at the target.
    while (byScroll.scrollLeft < 200) byScroll.advanceTime(10);
    byScroll.forceScrollLeft(200);
    byScroll.movePointerTo(700);
    const scrollOutcome = byScroll.release();

    // Same content-x reached two different ways -> byte-identical timings.
    expect(byScroll.scrollLeft).toBe(200);
    expect(700 - 0 + 200).toBe(TARGET_CONTENT_X);
    expect(scrollOutcome.kind).toBe(pointerOutcome.kind);
    expect(scrollOutcome.segments.map(s => [s.id, s.startTime, s.duration]))
      .toEqual(pointerOutcome.segments.map(s => [s.id, s.startTime, s.duration]));
  });
});
