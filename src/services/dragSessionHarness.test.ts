// @vitest-environment jsdom
/**
 * WS2 task 2 — the Route 2 drag-path harness, exercised.
 *
 * PART 3 ports every one of `dragSession.test.ts`'s 17 characterization
 * tests to run through the REAL `startDragSession` via `DragSessionHarness`
 * (real jsdom elements, real dispatched pointer events, real rAF-flushed
 * frames) — proof the harness is faithful to the code it drives. Each test
 * below is annotated with the original it corresponds to, by description and
 * line number in `dragSession.test.ts`. `dragSession.test.ts` itself is not
 * touched by this file — per WS2 task 1's neutrality contract, those 17
 * stay exactly as committed.
 *
 * PART 4 closes the coverage gaps a duck-typed reference transcription
 * structurally cannot reach: multi-gesture sessions, `pointercancel`,
 * locks on both sides of the dragged segment (through the real session, not
 * just `computeDragCascade` directly), rapid back-to-back drags, a
 * plain-click no-op vs. a tiny-but-real drag (with live-DOM proof, not just
 * the segment array), a drag on the timeline's last segment, and the
 * gapless invariant re-checked after every individual frame rather than
 * once at the end.
 *
 * UPDATED 2026-08-08 (manual triage F7): several tests below previously
 * exercised `NEGLIGIBLE_DRAG_SEC`, a revert threshold withdrawn by owner
 * ruling the same day — a drag that moved now commits however small it was.
 * Each was re-derived in place rather than deleted; see the inline note at
 * each one for what it asserted before and why.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { DragSessionHarness } from './dragSessionHarness';
import { checkTimelineIsGapless } from './timelinePartition';
import { TransitionType, AnimationType, type VideoSegment } from '../types';

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

const spans = (segs: Pick<VideoSegment, 'id' | 'startTime' | 'duration'>[]): string =>
  segs.map(s => `${s.id}[${s.startTime.toFixed(2)}..${(s.startTime + s.duration).toFixed(2)}]`).join(' ');

let activeHarness: DragSessionHarness | null = null;
function harnessOf(segments: VideoSegment[], config?: ConstructorParameters<typeof DragSessionHarness>[1]): DragSessionHarness {
  activeHarness = new DragSessionHarness(segments, config);
  return activeHarness;
}
afterEach(() => {
  activeHarness?.dispose();
  activeHarness = null;
});

// ---------------------------------------------------------------------------
// PART 3 — the 17 characterization tests, ported through the real session.
// ---------------------------------------------------------------------------

describe('PART 3 — ported characterization tests, via the real session (proof of harness fidelity)', () => {
  describe('ports of PART 0 (dragSession.test.ts:85-110) — locks on both sides, through the full session', () => {
    it('a right-edge grow into a locked right neighbour is blocked, left lock irrelevant', () => {
      const original = [seg('A', 0, 5, { locked: true }), seg('B', 5, 5), seg('C', 10, 5, { locked: true })];
      const h = harnessOf(original);
      h.grab('B', 'end').moveBy(1); // duration 5 -> 6
      const outcome = h.release();
      expect(outcome.kind).toBe('reverted-blocked');
      expect(outcome.blockedIds).toEqual(['C']);
      expect(outcome.segments).toBe(original);
      expect(checkTimelineIsGapless(outcome.segments)).toBeNull();
    });

    it('a left-edge grow into a locked left neighbour is blocked, right lock irrelevant', () => {
      const original = [seg('A', 0, 5, { locked: true }), seg('B', 5, 5), seg('C', 10, 5, { locked: true })];
      const h = harnessOf(original);
      h.grab('B', 'start').moveBy(-1); // duration 5 -> 6, growing left
      const outcome = h.release();
      expect(outcome.kind).toBe('reverted-blocked');
      expect(outcome.blockedIds).toEqual(['A']);
      expect(outcome.segments).toBe(original);
    });

    it('even a SHRINK is blocked with locks on both sides — the freed time still has to cascade somewhere', () => {
      const original = [seg('A', 0, 5, { locked: true }), seg('B', 5, 5), seg('C', 10, 5, { locked: true })];
      const h = harnessOf(original);
      h.grab('B', 'end').moveBy(-1); // duration 5 -> 4
      const outcome = h.release();
      expect(outcome.kind).toBe('reverted-blocked');
      expect(outcome.blockedIds).toEqual(['C']);
    });
  });

  describe('ports of "elsBySegId construction" (dragSession.test.ts:292-303)', () => {
    it('groups multiple elements (thumbnail lane + waveform lane) under one segment id', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5)];
      const h = harnessOf(original); // default elementsPerSegment: 2
      expect(h.mountedElementCountFor('A')).toBe(2);
      h.grab('A', 'end').moveBy(1);
      // liveGeometryFor() itself throws if the two mounted elements disagree.
      expect(h.liveGeometryFor('A')).toEqual({ leftPx: 0, widthPx: 600 });
      h.release();
    });

    it('a stray element with no data-seg-id is never selected by the real query, and does not break the drag', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5)];
      const h = harnessOf(original);
      h.mountElementWithNoSegId();
      h.grab('A', 'end').moveBy(1);
      expect(h.liveGeometryFor('A')).toEqual({ leftPx: 0, widthPx: 600 });
      const outcome = h.release();
      expect(outcome.kind).toBe('committed');
    });
  });

  describe('ports of "writeGeometry diffing" (dragSession.test.ts:307-363)', () => {
    it('writes left/width only for segments whose geometry actually changed', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end').moveBy(1); // A: 5 -> 6, cascades into B: 5 -> 4
      expect(h.liveGeometryFor('A')).toEqual({ leftPx: 0, widthPx: 600 });
      expect(h.liveGeometryFor('B')).toEqual({ leftPx: 600, widthPx: 400 });
      // C never moved — untouched style, exactly the original assertion.
      expect(h.liveGeometryFor('C')).toEqual({ leftPx: null, widthPx: null });
      const outcome = h.release();
      expect(spans(outcome.segments)).toBe('A[0.00..6.00] B[6.00..10.00] C[10.00..15.00]');
    });

    it('reverts a previously-moved segment to ITS OWN ORIGINAL geometry once a later frame no longer moves it', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end');
      // Frame 1: A grows 5 -> 8, cascading into B: 5 -> 2.
      h.moveBy(3);
      expect(h.liveGeometryFor('A')).toEqual({ leftPx: 0, widthPx: 800 });
      expect(h.liveGeometryFor('B')).toEqual({ leftPx: 800, widthPx: 200 });
      // Frame 2: pointer returns to the start — A is back to its OWN
      // original geometry (excluded from `moved`), yet its stale frame-1
      // style must still be reverted via the writtenIds carry-forward,
      // exactly as B's is.
      h.moveBy(-3);
      expect(h.liveGeometryFor('A')).toEqual({ leftPx: 0, widthPx: 500 });
      expect(h.liveGeometryFor('B')).toEqual({ leftPx: 500, widthPx: 500 });
      h.release();
    });

    it('a segment with no known (unmounted) element is silently skipped — the drag still resolves', () => {
      // CONVERTED 2026-08-08: was a ONE-segment array dragging 'A' end, which
      // is now the locked last edge and would make this assert the ruling
      // rather than the unmounted-element skip it exists for. A trailing 'B'
      // makes A's end an ordinary boundary again; A is still the unmounted one,
      // so the behaviour under test is unchanged.
      const original = [seg('A', 0, 5), seg('B', 5, 5)];
      const h = harnessOf(original, { unmountedIds: ['A'] });
      expect(() => h.grab('A', 'end').moveBy(1)).not.toThrow();
      const outcome = h.release();
      expect(outcome.kind).toBe('committed');
      expect(outcome.segments[0]!.duration).toBe(6);
    });
  });

  describe('ports of "commit-dispatch decision" (dragSession.test.ts:373-402)', () => {
    it('a press-and-release with no movement never resolves or commits anything', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end');
      const outcome = h.release(); // no moveBy at all — hasMoved stays false
      expect(outcome.kind).toBe('no-op-not-moved');
      expect(outcome.segments).toBe(original);
    });

    // RE-DERIVED 2026-08-08 by owner ruling (manual triage F7): the
    // negligible-drag threshold is withdrawn. A drag that moved commits
    // however small it was, and the live preview draws it, because fine
    // adjustment at high zoom is a real editing gesture. This test previously
    // asserted `'reverted-negligible'` and an unwritten DOM.
    it('a tiny drag now COMMITS and previews, rather than being discarded', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end').moveBy(0.005);
      // The live preview draws it too — preview and commit still agree, which
      // is the K17 invariant that actually matters here.
      expect(h.liveGeometryFor('A').widthPx).toBeCloseTo(5.005 * 100, 6);
      const outcome = h.release();
      expect(outcome.kind).toBe('committed');
      expect(outcome.segments).not.toBe(original);
      expect(outcome.segments[0]!.duration).toBeCloseTo(5.005, 6);
    });

    it('a real drag calls commit and reports success', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end').moveBy(1);
      const outcome = h.release();
      expect(outcome.kind).toBe('committed');
      expect(outcome.segments).not.toBe(original);
    });

    it('a real drag whose cascade is blocked by a lock reports reverted-blocked — and the live preview never visibly moved', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5, { locked: true })];
      const h = harnessOf(original);
      h.grab('A', 'end').moveBy(1);
      // computeDragCascade returns null for the preview too; resolveDragPreview
      // falls back to originalSegments, so writeGeometry sees no change.
      expect(h.liveGeometryFor('A')).toEqual({ leftPx: null, widthPx: null });
      const outcome = h.release();
      expect(outcome.kind).toBe('reverted-blocked');
      expect(outcome.blockedIds).toEqual(['B']);
      expect(outcome.segments).toBe(original);
    });

    // RE-DERIVED 2026-08-08 (F7): there is no threshold to be symmetric about
    // any more — this now pins that even a sub-millimeter drag on both sides of
    // the OLD threshold commits identically, i.e. the boundary itself is gone.
    it('there is no negligible-drag threshold left — a drag on either side of the old boundary commits the same way', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5)];
      const under = harnessOf(original);
      under.grab('A', 'end').moveBy(0.001);
      expect(under.release().kind).toBe('committed');
      under.dispose();

      const over = harnessOf(original);
      over.grab('A', 'end').moveBy(0.02);
      expect(over.release().kind).toBe('committed');
    });
  });

  describe('ports of "onResizeStart top-of-closure bug" (dragSession.test.ts:406-421)', () => {
    it('sets resizing state unconditionally, even for an out-of-range dragged id — and NEVER attaches listeners, so nothing can ever clear it', () => {
      const original = [seg('A', 0, 5)];
      const h = harnessOf(original);
      // This test PINS a known, deliberately-unfixed bug, so it is the one
      // place in the suite that ends with dirty session state on purpose. The
      // universal post-condition (dragSessionHarness.ts) would otherwise fail
      // it — correctly. Declaring it here keeps the audit switched on for every
      // other test while making this exception explicit and greppable rather
      // than a silent hole. The declaration itself fails if the residue stops
      // appearing, so whoever fixes the bug is forced back to this test.
      h.acknowledgeKnownResidue(
        'early-bail drag start leaves resizingId/resizingType/body.resizing stuck — ' +
        'the "FOUND, NOT FIXED" bug in dragSession.ts\'s header; the desired behaviour is ' +
        'pinned by the skipped BUG PIN test at the end of PART 4',
      );
      h.grab('ZZZ-does-not-exist', 'end');
      expect(h.resizingIdValue).toBe('ZZZ-does-not-exist');
      expect(h.resizingTypeValue).toBe('end');
      expect(h.bodyHasResizingClass).toBe(true);
      // No listeners were ever attached (the real bug: this path returns
      // before `window.addEventListener`), so a release resolves as a
      // harmless no-op — but the stuck state above is NEVER cleared by it.
      const outcome = h.release();
      expect(outcome.kind).toBe('no-op-not-moved');
      expect(h.resizingIdValue).toBe('ZZZ-does-not-exist'); // still stuck
      expect(h.bodyHasResizingClass).toBe(true); // still stuck
    });

    it('the same side effects run on the success path too — and THIS path DOES clear them on release', () => {
      // CONVERTED 2026-08-08: was a ONE-segment array. 'A' end is now the
      // locked last edge, on which startDragSession returns BEFORE setting
      // resizingId/resizingType/the body class at all — so the side effects
      // this test is about would never be set and it would pass vacuously. A
      // trailing 'B' restores an ordinary boundary drag; the assertions are
      // unchanged. (The locked edge's own "sets nothing" behaviour is asserted
      // separately, just below.)
      const original = [seg('A', 0, 5), seg('B', 5, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end');
      expect(h.resizingIdValue).toBe('A');
      expect(h.resizingTypeValue).toBe('end');
      expect(h.bodyHasResizingClass).toBe(true);
      h.release();
      // A real gesture's handleUp clears resizingId/Type/class UNCONDITIONALLY
      // at its top, before the hasMoved branch — contrast with the early-bail
      // case above, which can never reach handleUp at all.
      expect(h.resizingIdValue).toBeNull();
      expect(h.bodyHasResizingClass).toBe(false);
    });

    it('the LOCKED last edge sets no session state at all — nothing to leave stuck', () => {
      // The defensive guard (owner ruling 2026-08-08) is placed ABOVE the
      // resizingId/resizingType/body-class writes precisely so it cannot
      // reproduce the still-unruled early-bail stuck-state bug those writes
      // cause on the two pre-existing bail paths. This pins that placement:
      // move the guard below them and this test fails immediately.
      const original = [seg('A', 0, 5), seg('B', 5, 5)];
      const h = harnessOf(original);
      h.grab('B', 'end'); // B is last — locked edge
      expect(h.resizingIdValue).toBeNull();
      expect(h.resizingTypeValue).toBeNull();
      expect(h.bodyHasResizingClass).toBe(false);
      h.release();
      expect(h.resizingIdValue).toBeNull();
      expect(h.bodyHasResizingClass).toBe(false);
    });
  });

  describe('ports of PART 2 — multi-step gesture snapshot (dragSession.test.ts:432-486)', () => {
    it('a two-frame right-edge drag on the middle segment previews, then commits, identically', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5), seg('D', 15, 5)];
      const h = harnessOf(original);
      h.grab('B', 'end'); // edge starts at content-x 1000 (10s * 100px/s)

      // Frame 1: pointer -> content-x 1200px = 12s (B: 5 -> 7).
      h.moveBy(2);
      expect(spans(h.readLiveSegments(original))).toBe(
        'A[0.00..5.00] B[5.00..12.00] C[12.00..15.00] D[15.00..20.00]',
      );
      expect(h.liveGeometryFor('D')).toEqual({ leftPx: null, widthPx: null }); // locality

      // Frame 2: pointer -> content-x 1400px = 14s (B: 5 -> 9).
      h.moveBy(2);
      expect(spans(h.readLiveSegments(original))).toBe(
        'A[0.00..5.00] B[5.00..14.00] C[14.00..15.00] D[15.00..20.00]',
      );

      // Release at frame 2's position — commit must equal the last preview.
      const outcome = h.release();
      expect(spans(outcome.segments)).toBe('A[0.00..5.00] B[5.00..14.00] C[14.00..15.00] D[15.00..20.00]');
      expect(checkTimelineIsGapless(outcome.segments)).toBeNull();
    });

    it('a drag blocked by a lock leaves the preview AND the commit at the original array', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5, { locked: true })];
      const h = harnessOf(original);
      h.grab('A', 'end').moveBy(1);
      expect(spans(h.readLiveSegments(original))).toBe(spans(original));
      const outcome = h.release();
      expect(outcome.kind).toBe('reverted-blocked');
      expect(outcome.blockedIds).toEqual(['B']);
      expect(outcome.segments).toBe(original);
    });
  });
});

// ---------------------------------------------------------------------------
// PART 4 — new coverage the harness makes practical for the first time.
// ---------------------------------------------------------------------------

describe('PART 4 — coverage gaps closed by the real session harness', () => {
  it('several grabs and releases in sequence within one session', () => {
    const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    const h = harnessOf(original);

    const first = h.grab('A', 'end').moveBy(1).release(); // A: 5 -> 6, B absorbs
    expect(first.kind).toBe('committed');
    expect(spans(first.segments)).toBe('A[0.00..6.00] B[6.00..10.00] C[10.00..15.00]');
    expect(checkTimelineIsGapless(first.segments)).toBeNull();

    // Second gesture in the SAME session, dragging a DIFFERENT segment,
    // starting from the first gesture's committed result.
    const second = h.grab('C', 'start').moveBy(-2).release(); // C absorbs 2s from B
    expect(second.kind).toBe('committed');
    expect(spans(second.segments)).toBe('A[0.00..6.00] B[6.00..8.00] C[8.00..15.00]');
    expect(checkTimelineIsGapless(second.segments)).toBeNull();
  });

  it('a drag interrupted by pointercancel mid-gesture DISCARDS rather than commits (ruled 2026-08-08)', () => {
    // CONVERTED 2026-08-08 (array only): a third segment 'C' was added so that
    // the "a fresh gesture right after works normally" check at the end can
    // still grab an ordinary end edge. It previously grabbed 'B' end, which is
    // now the locked last edge and would have made the leak check vacuous. The
    // pointercancel behaviour under test — and every assertion about it — is
    // unchanged.
    const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    const h = harnessOf(original);
    h.grab('A', 'end').moveBy(1);
    const outcome = h.cancel();
    // dragSession.ts wires 'pointercancel' to a dedicated handleCancel that
    // sets wasCancelled before delegating to the shared handleUp — an
    // involuntary OS-forced interruption must never silently commit a
    // segment-timing change; see
    // docs/decisions/2026-08-08-pointercancel-ruling.md. The segment array
    // reverts to its pre-drag geometry, exactly as if the drag had never
    // happened.
    expect(outcome.kind).toBe('reverted-cancelled');
    expect(spans(outcome.segments)).toBe('A[0.00..5.00] B[5.00..10.00] C[10.00..15.00]');
    // The original comment's concern ("must not leave the drag armed
    // forever") still holds under discard — cleanup is unconditional in
    // handleUp regardless of which branch (commit/revert-cancelled) ran.
    expect(h.resizingIdValue).toBeNull();
    expect(h.bodyHasResizingClass).toBe(false);
    // Listeners were properly torn down by the shared handleUp — a fresh
    // gesture right after works normally, proving no leak.
    const next = h.grab('B', 'end').moveBy(1).release();
    expect(next.kind).toBe('committed');
  });

  it('pointercancel with NO movement is a harmless no-op, same as pointerup', () => {
    const original = [seg('A', 0, 5), seg('B', 5, 5)];
    const h = harnessOf(original);
    h.grab('A', 'end');
    const outcome = h.cancel();
    expect(outcome.kind).toBe('no-op-not-moved');
    expect(outcome.segments).toBe(original);
  });

  it('a drag on a segment with locks on BOTH immediate neighbours, through the full session — left-edge shrink variant', () => {
    const original = [seg('A', 0, 5, { locked: true }), seg('B', 5, 5), seg('C', 10, 5, { locked: true })];
    const h = harnessOf(original);
    h.grab('B', 'start').moveBy(1); // shrink B from the left: duration 5 -> 4
    const outcome = h.release();
    expect(outcome.kind).toBe('reverted-blocked');
    // A left-edge shrink hands the freed span backward to A (locked).
    expect(outcome.blockedIds).toEqual(['A']);
    expect(outcome.segments).toBe(original);
    expect(checkTimelineIsGapless(outcome.segments)).toBeNull();
  });

  it('rapid successive drags with no state reset between them — five gestures back to back on a shared session', () => {
    const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5), seg('D', 15, 5), seg('E', 20, 5)];
    const h = harnessOf(original);
    let current = original;
    const grabs: Array<[string, 'start' | 'end', number]> = [
      ['A', 'end', 1],
      ['B', 'end', -1],
      ['C', 'start', 1],
      ['D', 'end', 2],
      ['E', 'start', -1],
    ];
    for (const [id, edge, delta] of grabs) {
      const outcome = h.grab(id, edge).moveBy(delta).release();
      expect(outcome.kind).toBe('committed');
      expect(checkTimelineIsGapless(outcome.segments)).toBeNull();
      expect(outcome.segments).not.toBe(current);
      current = outcome.segments;
    }
    // Total duration of the whole timeline is conserved across all five
    // gestures — every one only ever traded time between adjacent segments.
    const totalBefore = original.reduce((sum, s) => sum + s.duration, 0);
    const totalAfter = current.reduce((sum, s) => sum + s.duration, 0);
    expect(totalAfter).toBeCloseTo(totalBefore, 6);
  });

  // RE-DERIVED 2026-08-08 (F7): a sub-pixel drag used to revert untouched; it
  // now commits like any other drag that moved. Renamed to describe what it
  // now proves — that a genuine no-op (no pointermove at all) is still the
  // only thing that leaves the array and DOM untouched, which `hasMoved`
  // (unaffected by the ruling) still guards.
  it('a plain press-and-release with no pointermove leaves BOTH the segment array and the live DOM untouched', () => {
    const original = [seg('A', 0, 5), seg('B', 5, 5)];
    const h = harnessOf(original);
    h.grab('A', 'end');
    expect(h.liveGeometryFor('A')).toEqual({ leftPx: null, widthPx: null });
    expect(h.liveGeometryFor('B')).toEqual({ leftPx: null, widthPx: null });
    const outcome = h.release();
    expect(outcome.kind).toBe('no-op-not-moved');
    expect(outcome.segments).toBe(original);
    expect(h.liveGeometryFor('A')).toEqual({ leftPx: null, widthPx: null });
  });

  it('a tiny (sub-pixel) drag still commits, with the live DOM matching the committed array', () => {
    const original = [seg('A', 0, 5), seg('B', 5, 5)];
    const h = harnessOf(original);
    h.grab('A', 'end').moveBy(0.003);
    expect(h.liveGeometryFor('A').widthPx).toBeCloseTo(5.003 * 100, 6);
    const outcome = h.release();
    expect(outcome.kind).toBe('committed');
    expect(outcome.segments[0]!.duration).toBeCloseTo(5.003, 6);
  });

  // -------------------------------------------------------------------------
  // CONVERTED 2026-08-08 by owner ruling — the final segment's right edge is
  // now INERT in both directions (docs/decisions/2026-08-08-last-segment-edge.md,
  // semantic option (i)).
  //
  // These two tests previously asserted the GROW and SHRINK behaviour of that
  // edge: that a grow was uncontested (C: 5 -> 8, lengthening the timeline) and
  // that a shrink was clamped only by MIN_SEGMENT_DURATION (C -> 0.3s). Both
  // operations no longer exist. They are converted rather than deleted because
  // the two directions are exactly what the ruling names — "not draggable, in
  // either direction" — so they remain the most direct statement of it, and a
  // regression that resurrected either would fail here by name.
  // -------------------------------------------------------------------------
  it('a GROW on the final segment\'s right edge is inert — the gesture never starts', () => {
    const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    const h = harnessOf(original);
    const outcome = h.grab('C', 'end').moveBy(3).release();
    // The defensive guard in startDragSession returns before wiring a single
    // listener, so nothing ever registers as having moved.
    expect(outcome.kind).toBe('no-op-not-moved');
    expect(spans(outcome.segments)).toBe('A[0.00..5.00] B[5.00..10.00] C[10.00..15.00]');
    expect(checkTimelineIsGapless(outcome.segments)).toBeNull();
    // No live DOM write either — the card does not even flex during the gesture.
    expect(h.liveGeometryFor('C')).toEqual({ leftPx: null, widthPx: null });
  });

  it('a SHRINK on the final segment\'s right edge is equally inert', () => {
    const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    const h = harnessOf(original);
    const outcome = h.grab('C', 'end').moveBy(-4.8).release();
    expect(outcome.kind).toBe('no-op-not-moved');
    expect(outcome.segments[2]!.duration).toBeCloseTo(5, 6);
    expect(checkTimelineIsGapless(outcome.segments)).toBeNull();
  });

  it('the final segment\'s LEFT edge is unaffected and still drags normally', () => {
    // The ruling locks one edge, not the segment. Without this, "inert" could
    // silently widen to the whole last card and nothing would catch it.
    const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    const h = harnessOf(original);
    const outcome = h.grab('C', 'start').moveBy(-2).release(); // C grows leftward, B yields
    expect(outcome.kind).toBe('committed');
    expect(spans(outcome.segments)).toBe('A[0.00..5.00] B[5.00..8.00] C[8.00..15.00]');
    expect(checkTimelineIsGapless(outcome.segments)).toBeNull();
  });

  it('no drag anywhere in the array can start a gesture on the locked edge', () => {
    // The predicate is index-based, so it must follow the array rather than any
    // one segment id: after a gesture that does not reorder anything, the SAME
    // last index stays locked and every other end edge stays live.
    const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    const h = harnessOf(original);
    expect(h.grab('A', 'end').moveBy(1).release().kind).toBe('committed');
    expect(h.grab('B', 'end').moveBy(1).release().kind).toBe('committed');
    expect(h.grab('C', 'end').moveBy(1).release().kind).toBe('no-op-not-moved');
  });

  it('the gapless invariant holds after EVERY individual frame of a multi-frame drag, not just at release', () => {
    const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5), seg('D', 15, 5)];
    const h = harnessOf(original);
    h.grab('B', 'end');
    const steps = [0.7, -1.3, 2.0, -0.4, 1.1];
    let cumulative = 0;
    for (const delta of steps) {
      cumulative += delta;
      h.moveBy(delta);
      const live = h.readLiveSegments(original);
      expect(checkTimelineIsGapless(live)).toBeNull();
      // Cross-check the live DOM read-back against the same pure math the
      // frame itself used, so a gapless-but-WRONG frame can't slip through.
      const b = live.find(s => s.id === 'B')!;
      expect(b.duration).toBeCloseTo(Math.max(0.3, 5 + cumulative), 6);
    }
    const outcome = h.release();
    expect(checkTimelineIsGapless(outcome.segments)).toBeNull();
  });

  it('the gapless invariant also holds after every frame across a cascade that spans multiple neighbours', () => {
    const original = [seg('A', 0, 3), seg('B', 3, 0.5), seg('C', 3.5, 0.5), seg('D', 4, 3)];
    const h = harnessOf(original);
    h.grab('A', 'end');
    // Grow A well past B alone (B is only 0.5s) so the cascade must reach
    // into C as well — exercising the multi-hop path frame-by-frame.
    for (const delta of [0.3, 0.3, 0.3]) {
      h.moveBy(delta);
      expect(checkTimelineIsGapless(h.readLiveSegments(original))).toBeNull();
    }
    const outcome = h.release();
    expect(checkTimelineIsGapless(outcome.segments)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // PART 5 — the interrupted drag (manual checklist step 10), FIXED 2026-08-08
  //
  // Three previous attempts patched the `pointercancel` handler and all three
  // passed their synthetic tests and failed the manual retest. Instrumenting
  // the real Tauri/WKWebView shell for one ⌘+Tab-away-and-back mid-drag showed
  // why — the captured log, in full:
  //
  //     +0ms     gesture-start
  //     +5236ms  tauri:onFocusChanged  focused=false
  //     +5239ms  window:blur           document.hasFocus()=false
  //     +5996ms  pointerup             buttons=0
  //     +5997ms  TEARDOWN RAN          hasMoved=true wasCancelled=false
  //
  // NO `pointercancel` is ever delivered, so `handleCancel` — the thing every
  // prior fix edited — is not on this code path at all. And teardown was not
  // missed: the release arrived ~760ms later as a plain `pointerup`, so the
  // gesture took the COMMIT branch and silently changed segment timings, which
  // is exactly what the 2026-08-08 discard ruling exists to prevent.
  //
  // These tests pin the two signals that actually resolve it. They are written
  // against the same real `startDragSession` as the rest of this file — the
  // only synthetic part is the event dispatch, which is what the harness is for.
  // -------------------------------------------------------------------------
  describe('PART 5 — interrupted drag: the signals WKWebView actually delivers', () => {
    it('window blur mid-drag DISCARDS the gesture and clears all session state', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end').moveBy(1);
      const outcome = h.blurWindow();
      // Same resolution as a real pointercancel: revert, never commit.
      expect(outcome.kind).toBe('reverted-cancelled');
      expect(spans(outcome.segments)).toBe('A[0.00..5.00] B[5.00..10.00] C[10.00..15.00]');
      // The residue the manual test reported — and `.resizing` carries BOTH
      // `cursor: col-resize !important` and `user-select: none`
      // (src/index.css:99-103), so this one class is the whole stuck cursor.
      expect(h.resizingIdValue).toBeNull();
      expect(h.resizingTypeValue).toBeNull();
      expect(h.bodyHasResizingClass).toBe(false);
      // And the listeners are gone, so the LATE pointerup the log shows
      // arriving ~760ms later reaches nothing and cannot commit.
      const late = h.release();
      expect(late.kind).toBe('reverted-cancelled'); // unchanged by the late event
      expect(spans(h.currentSegments)).toBe('A[0.00..5.00] B[5.00..10.00] C[10.00..15.00]');
      // A fresh gesture afterwards still works — no leak.
      expect(h.grab('B', 'end').moveBy(1).release().kind).toBe('committed');
    });

    it('the late pointerup after a blur cannot resurrect the commit — the exact measured sequence', () => {
      // Replays the captured log's ordering verbatim: move, blur, THEN pointerup.
      const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end').moveBy(2);       // +0ms .. a real drag, 2s of growth
      h.blurWindow();                      // +5239ms window:blur
      h.release();                         // +5996ms pointerup, buttons=0
      // Pre-fix this committed A at 7.00 and stole 2s from B. It must not.
      expect(spans(h.currentSegments)).toBe('A[0.00..5.00] B[5.00..10.00] C[10.00..15.00]');
    });

    it('an ELEMENT blur inside the page does NOT resolve the drag', () => {
      // The guard that keeps the fix from breaking every ordinary focus change:
      // element blur does not bubble, and `handleBlur` also checks the target.
      const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end').moveBy(1);
      h.blurElement();
      // Still live: nothing reverted, nothing committed, state still armed.
      expect(h.resizingIdValue).toBe('A');
      expect(h.bodyHasResizingClass).toBe(true);
      // And the gesture completes normally afterwards.
      const outcome = h.release();
      expect(outcome.kind).toBe('committed');
      expect(spans(outcome.segments)).toBe('A[0.00..6.00] B[6.00..10.00] C[10.00..15.00]');
    });

    it('a pointermove with buttons=0 DISCARDS — the backstop for a release we never saw', () => {
      // The case no OS signal covers: the user released the button in another
      // application, so no pointerup reached us at all, and then moved the
      // pointer back over our window. Derived purely from the event we are
      // already handling, so it holds on any platform.
      const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end').moveBy(1);
      const outcome = h.moveButtonUp(1);
      expect(outcome.kind).toBe('reverted-cancelled');
      expect(spans(outcome.segments)).toBe('A[0.00..5.00] B[5.00..10.00] C[10.00..15.00]');
      expect(h.resizingIdValue).toBeNull();
      expect(h.bodyHasResizingClass).toBe(false);
      expect(h.grab('B', 'end').moveBy(1).release().kind).toBe('committed');
    });

    it('the backstop fires even on the FIRST move of a gesture, before anything moved', () => {
      const original = [seg('A', 0, 5), seg('B', 5, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end');
      const outcome = h.moveButtonUp(1);
      // hasMoved was never set, so handleUp's `!hasMoved` early return applies:
      // nothing to revert, and teardown still runs.
      expect(outcome.kind).toBe('no-op-not-moved');
      expect(h.resizingIdValue).toBeNull();
      expect(h.bodyHasResizingClass).toBe(false);
    });

    it('a normal multi-frame drag is completely unaffected — buttons=1 throughout', () => {
      // Non-vacuity guard in the other direction: the backstop must not fire on
      // an ordinary gesture. If `dispatchPointer` ever regresses to buttons=0,
      // this fails alongside the 22 tests that already caught it once.
      const original = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
      const h = harnessOf(original);
      h.grab('A', 'end');
      for (const d of [0.4, 0.4, 0.4]) h.moveBy(d);
      expect(h.resizingIdValue).toBe('A');
      const outcome = h.release();
      expect(outcome.kind).toBe('committed');
      expect(checkTimelineIsGapless(outcome.segments)).toBeNull();
    });
  });

  it.skip(
    'BUG PIN (do not fix here) — an early-bail drag start should NOT leave resizingId/the resizing class stuck. ' +
    'Currently FAILS: dragSession.ts sets resizing state unconditionally before validating the dragged segment ' +
    'exists, and nothing on that early-return path clears it (see project-state.md, WS2 task 1 note, and the ' +
    'passing pin of the CURRENT behavior two describe blocks above). Unskip once fixed.',
    () => {
      const original = [seg('A', 0, 5)];
      const h = harnessOf(original);
      h.grab('does-not-exist', 'end');
      // Desired behavior: an aborted drag start leaves no visible trace.
      expect(h.resizingIdValue).toBeNull();
      expect(h.bodyHasResizingClass).toBe(false);
    },
  );
});
