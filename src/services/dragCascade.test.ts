/**
 * K15 — timeline drag-resize cascade regression tests.
 *
 * Every fixture here is hand-written; nothing is snapshotted off a live run.
 * The three PARTs map 1:1 onto the two defects the owner reported and the
 * question of which of them K14 introduced:
 *
 *   PART 1 — K15a, gap collapse. K14-INTRODUCED.
 *   PART 2 — K15b, unbounded neighbour absorption. PREDATES K14; K14 removed
 *            the auto-lock that had been masking it.
 *   PART 3 — pre-K15 behaviour that must NOT change.
 *
 * PART 1 and PART 2's headline cases were each confirmed FAILING against the
 * pre-K15 cascade before the fix landed; the failing values are recorded inline
 * next to each assertion.
 */

import { describe, it, expect } from 'vitest';
import {
  computeDragCascade,
  neighbourYieldableSec,
  MIN_SEGMENT_DURATION,
  resolveDragPreview,
  NEGLIGIBLE_DRAG_SEC,
} from './dragCascade';
import { applyAnchorBasedTiming } from './syncEngine';
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

/** One token per whole second in [from, to), 0.4s long — enough to give a
 *  segment an unambiguous first/last owned word without hand-listing them. */
function tokens(from: number, to: number): TranscriptToken[] {
  const out: TranscriptToken[] = [];
  for (let t = from; t < to - 1e-9; t += 1) {
    out.push({ startSec: Number(t.toFixed(3)), endSec: Number((t + 0.4).toFixed(3)), text: 'w' });
  }
  return out;
}

const spans = (segs: VideoSegment[] | null): string =>
  segs === null
    ? 'BLOCKED'
    : segs.map(s => `${s.id}[${s.startTime.toFixed(2)}..${(s.startTime + s.duration).toFixed(2)}]`).join(' ');

const noBlock = (): void => {};

// ---------------------------------------------------------------------------
// PART 1 — K15a: a gap anywhere in the array must survive a drag.
// ---------------------------------------------------------------------------

describe('K15a — restack locality (gap fixtures now constructed directly)', () => {
  /**
   * REWRITTEN 2026-08-07, Model P ruling (`docs/decisions/2026-08-07-model-p-
   * ruling.md`). NOT relaxed — the assertions below are strictly stronger.
   *
   * These three tests used to MANUFACTURE their gapped fixture by calling
   * `applyAnchorBasedTiming` with a locked segment, relying on K14's hard wall
   * leaving a real 3.000s hole after the lock. That hole was the Model S
   * behaviour the ruling rejected, and it is now fixed at source (the §4.1
   * fill rule: an unlocked successor starts at the lock's exact end and
   * absorbs the shortfall as leading silence — see `syncEngine.ts` PASS 2 and
   * `modelPLockSemantics.test.ts`). The old fixture is therefore no longer
   * producible through the production pipeline at all.
   *
   * What is still worth testing is `restackWindow`'s LOCALITY — that a drag
   * restacks only the index window it touched and never re-flows the whole
   * array from 0. That property is independent of how the input array came to
   * look the way it does, so the gapped arrays below are now written as
   * LITERALS. A literal is the honest fixture here: it says "given an array
   * shaped like this, the cascade does that," without asserting that the
   * pipeline can still produce that shape (it cannot).
   *
   * The first test is inverted in place: it asserted the gap EXISTS; it now
   * asserts the gap is CLOSED, which is the K14 rework's headline result.
   */
  it('applyAnchorBasedTiming no longer leaves a gap after a locked segment (K14 rework, Model P)', () => {
    const out = applyAnchorBasedTiming(
      [
        seg('A', 0, 10),
        seg('B', 10, 2, { locked: true }),
        seg('C', 15, 3, { anchorStart: 15 }),
        seg('D', 18, 2, { anchorStart: 18 }),
      ],
      20,
    );
    // PRE-FIX (Model S, asserted by this very test until 2026-08-07):
    //   'A[0.00..10.00] B[10.00..12.00] C[15.00..18.00] D[18.00..20.00]'
    //   — 3.000s of dead air between the lock's end and C's start.
    // POST-FIX: C starts at the lock's exact end and absorbs that 3.000s as
    // leading silence. C's END (18.00, i.e. D's own anchor) is unchanged, so
    // D does not move and nothing ripples past the fill.
    expect(spans(out)).toBe('A[0.00..10.00] B[10.00..12.00] C[12.00..18.00] D[18.00..20.00]');
    expect(out[2]!.startTime - (out[1]!.startTime + out[1]!.duration)).toBeCloseTo(0, 6);
    // The lock itself is untouched in both position and length.
    expect(out[1]!.startTime).toBe(10);
    expect(out[1]!.duration).toBe(2);
  });

  it('a 0.2s drag on C does not move C — a pre-existing gap in front of it survives', () => {
    // Literal fixture (see the describe-block note): an array carrying a
    // 3.000s hole between B's end and C's start, however it might have arisen
    // — e.g. a project persisted before the Model P rework landed.
    const gapped = [
      seg('A', 0, 10),
      seg('B', 10, 2, { locked: true }),
      seg('C', 15, 3, { anchorStart: 15 }),
      seg('D', 18, 2, { anchorStart: 18 }),
    ];
    const out = computeDragCascade(gapped, 2, gapped[2]!.duration + 0.2, 0, 'right', noBlock)!;

    // PRE-K15 this returned 'A[0.00..10.00] B[10.00..12.00] C[12.00..15.20] D[15.20..17.00]'
    // — a 0.2s drag displaced C by 3.000s and D by 2.800s, putting both slots
    // entirely off their own audio. The old cascade rebuilt every startTime from
    // a running sum starting at 0, which deletes any gap in the array.
    expect(spans(out)).toBe('A[0.00..10.00] B[10.00..12.00] C[15.00..18.20] D[18.20..20.00]');
    expect(out[2]!.startTime).toBe(gapped[2]!.startTime);
  });

  it('dragging the LAST segment — no neighbour to cascade into — still cannot collapse the gap', () => {
    const gapped = [
      seg('A', 0, 10),
      seg('B', 10, 2, { locked: true }),
      seg('C', 15, 3, { anchorStart: 15 }),
      seg('D', 18, 2, { anchorStart: 18 }),
    ];
    const out = computeDragCascade(gapped, 3, gapped[3]!.duration + 0.2, 0, 'right', noBlock)!;

    // PRE-K15: 'A[0.00..10.00] B[10.00..12.00] C[12.00..15.00] D[15.00..17.20]'.
    // The re-flow was unconditional, so it fired even with zero cascade work to
    // do — proof the collapse was never a cascade bug, but a restack-scope one.
    expect(spans(out)).toBe('A[0.00..10.00] B[10.00..12.00] C[15.00..18.00] D[18.00..20.20]');
  });

  it('segments outside the touched window keep startTime AND anchorStart byte-identical', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5), seg('D', 15, 5)];
    const out = computeDragCascade(arr, 0, 5.5, 0, 'right', noBlock)!;
    // A grew 0.5s, B absorbed all of it; C and D were never asked for anything.
    expect(out[2]).toEqual(arr[2]);
    expect(out[3]).toEqual(arr[3]);
  });

  it('a left-edge drag anchors on the far end of the cascade, leaving later segments untouched', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    // Drag B's left edge 0.5s earlier: B grows to 5.5, A shrinks to 4.5.
    const out = computeDragCascade(arr, 1, 5.5, 0, 'left', noBlock)!;
    expect(spans(out)).toBe('A[0.00..4.50] B[4.50..10.00] C[10.00..15.00]');
    expect(out[2]).toEqual(arr[2]);
  });
});

// ---------------------------------------------------------------------------
// PART 2 — K15b: a neighbour may yield its silence, never its words.
// ---------------------------------------------------------------------------

describe('K15b — neighbour yield floor (predates K14)', () => {
  // RE-DERIVED 2026-08-08 (manual triage F1). These two previously asserted the
  // bound was the neighbour's leading/trailing SILENCE — its OUTERMOST word.
  // That measured ~0.15s on real synced material (snapCoveredBoundaries puts a
  // boundary at the silence CENTRE, so a neighbour's leading silence is half an
  // inter-word gap), which is a few screen pixels of total outward drag budget:
  // the reported "outward drag stalls after a few px". The bound is now the
  // INNERMOST word — the neighbour is guaranteed to keep at least one of its own
  // words, which is the harm K15b actually names. See dragCascade.ts's header.
  it('neighbourYieldableSec: head yield runs to the neighbour\'s LAST word', () => {
    // Slot [5,10]; the words the slot owns run 6.0 → 9.4. A right-edge drag on
    // the previous segment may move this slot's start up to its last word's
    // onset at 9.0 — 4.0s — and no further.
    expect(neighbourYieldableSec({ startTime: 5, duration: 5 }, 'head', tokens(6, 10)))
      .toBeCloseTo(9 - 5, 6);
  });

  it('neighbourYieldableSec: tail yield runs back to the neighbour\'s FIRST word', () => {
    // Mirrored: the slot's end may fall to its first word's offset, 6.4.
    expect(neighbourYieldableSec({ startTime: 5, duration: 5 }, 'tail', tokens(6, 10)))
      .toBeCloseTo(10 - 6.4, 6);
  });

  it('degrades to the silence-only bound for a neighbour holding exactly ONE word', () => {
    // The innermost and outermost word are the same word here, so the bound
    // collapses to the original leading/trailing-silence budget — the correct
    // answer at this limit: any further yield pushes the segment's only word
    // out of its own slot.
    const one: TranscriptToken[] = [{ startSec: 6, endSec: 9.4, text: 'w' }];
    expect(neighbourYieldableSec({ startTime: 5, duration: 5 }, 'head', one)).toBeCloseTo(1, 6);
    expect(neighbourYieldableSec({ startTime: 5, duration: 5 }, 'tail', one)).toBeCloseTo(0.6, 6);
  });

  it('neighbourYieldableSec is Infinity — i.e. no bound, pre-K15 behaviour — with no owned word', () => {
    // Nothing spoken anywhere near [5,10]: an unscripted heading, or a scene the
    // aligner skipped. Nothing to protect, so the MIN_SEGMENT_DURATION clamp
    // remains the only bound, exactly as before K15.
    expect(neighbourYieldableSec({ startTime: 5, duration: 5 }, 'head', tokens(20, 30))).toBe(Infinity);
    expect(neighbourYieldableSec({ startTime: 5, duration: 5 }, 'head', undefined)).toBe(Infinity);
    expect(neighbourYieldableSec({ startTime: 5, duration: 5 }, 'head', [])).toBe(Infinity);
  });

  it('neighbourYieldableSec is 0 when a word already straddles the yielding edge', () => {
    // Slot [5,6); the word it owns starts at 5.5 and runs past the slot end, so
    // there is no trailing silence to give.
    const tk: TranscriptToken[] = [{ startSec: 5.5, endSec: 6.4, text: 'w' }];
    expect(neighbourYieldableSec({ startTime: 5, duration: 1 }, 'tail', tk)).toBe(0);
  });

  it('neighbourYieldableSec ignores malformed tokens instead of trusting their timestamps', () => {
    const tk: TranscriptToken[] = [
      { startSec: Number.NaN, endSec: 6, text: 'bad' },
      { startSec: 8, endSec: 8, text: 'zero-length' },
      { startSec: 6, endSec: 6.4, text: 'good' },
    ];
    expect(neighbourYieldableSec({ startTime: 5, duration: 5 }, 'head', tk)).toBeCloseTo(1, 6);
  });

  it('a right-edge drag cannot strip the next segment of its last word', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    // Words: A 0.0-4.4, B 6.0-9.4 (last word onset 9.0), C 11.0-14.4.
    const tk = [...tokens(0, 5), ...tokens(6, 10), ...tokens(11, 15)];
    // Ask A to grow by 3.0s. B may yield up to its last word's onset — 4.0s —
    // so this is granted in full, and the dragged edge tracks the pointer.
    const out = computeDragCascade(arr, 0, 8, 0, 'right', noBlock, tk)!;

    // PRE-K15 this same call returned exactly this array too, but for the wrong
    // reason — nothing bounded it at all, and a 6.0s demand would have been
    // granted just as readily, stranding every one of B's words in A's slot.
    // RE-DERIVED 2026-08-08 (F1): under the first K15b formulation this returned
    // 'A[0.00..6.00] B[6.00..10.00] ...' — B yielded only its 1.0s of leading
    // silence and 2.0s of a legitimate 3.0s drag was refused, which is the
    // "outward drag stalls" defect. The bound still exists; it now sits at B's
    // LAST word, not its first.
    expect(spans(out)).toBe('A[0.00..8.00] B[8.00..10.00] C[10.00..15.00]');
    // The headline invariant: B still holds a word of its own (9.0 → 9.4).
    expect(out[1]!.startTime).toBeLessThanOrEqual(9);
    expect(out[2]).toEqual(arr[2]);
    // And total timeline duration is conserved — nothing was invented or lost.
    const total = (s: VideoSegment[]) => s.reduce((a, x) => a + x.duration, 0);
    expect(total(out)).toBeCloseTo(total(arr), 6);
  });

  it('the right-edge bound still refuses a drag that would empty the neighbour', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    const tk = [...tokens(0, 5), ...tokens(6, 10), ...tokens(11, 15)];
    // Demand 4.5s — past B's last word at 9.0, which would leave B holding
    // nothing it owns. B yields 4.0s; the remaining 0.5s is handed back to A.
    const out = computeDragCascade(arr, 0, 9.5, 0, 'right', noBlock, tk)!;
    expect(spans(out)).toBe('A[0.00..9.00] B[9.00..10.00] C[10.00..15.00]');
    expect(out[1]!.startTime).toBeLessThanOrEqual(9);
    expect(out[1]!.duration).toBeGreaterThan(MIN_SEGMENT_DURATION);
  });

  it('a left-edge drag cannot strip the previous segment of its first word', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    // A's words run 0.0 → 3.4; its FIRST word ends at 0.4, so A's tail may fall
    // to 0.4 — 4.6s of yield — before A would hold nothing of its own.
    const tk = [...tokens(0, 3.5), ...tokens(6, 10)];
    // Drag B's left edge 3.0s earlier (B 5 → 8). Granted in full.
    const out = computeDragCascade(arr, 1, 8, 0, 'left', noBlock, tk)!;

    // RE-DERIVED 2026-08-08 (F1): under the first K15b formulation this was
    // 'A[0.00..3.40] B[3.40..10.00] ...' — A yielded only its 1.6s of trailing
    // silence and 1.4s of the drag was refused.
    expect(spans(out)).toBe('A[0.00..2.00] B[2.00..10.00] C[10.00..15.00]');
    // A still holds a word of its own (0.0 → 0.4).
    expect(out[0]!.startTime + out[0]!.duration).toBeGreaterThanOrEqual(0.4);
    expect(out[2]).toEqual(arr[2]);
  });

  it('repeated drags into the same neighbour stop at the floor instead of bottoming out at 0.3s', () => {
    // This is the shape K14 exposed. Pre-K14 the cascade auto-locked B on the
    // first drag, so the SECOND drag hit the locked-neighbour guard and was
    // refused with a toast — an accidental one-shot circuit breaker, not a
    // bound. Decision 9 point 1 forbids restoring it, so the floor has to hold
    // on its own across any number of drags.
    //
    // RE-DERIVED 2026-08-08 (F1): the loop count is raised from 8 to 30 because
    // the floor now sits at B's LAST word rather than its first, so 8 drags no
    // longer reach it — and reaching it is the entire point of this test. The
    // assertion is unchanged in kind: however many times the user drags, B is
    // never emptied and never bottoms out at MIN_SEGMENT_DURATION.
    const tk = [...tokens(0, 5), ...tokens(6, 10), ...tokens(11, 15)];
    let cur: VideoSegment[] = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    for (let i = 0; i < 30; i++) {
      cur = computeDragCascade(cur, 0, cur[0]!.duration + 0.3, 0, 'right', noBlock, tk)!;
      // B keeps its last word (onset 9.0) inside its own slot, every time.
      expect(cur[1]!.startTime).toBeLessThanOrEqual(9);
    }
    // Thirty 0.3s drags demanded 9.0s; B gave up 4.0s — everything down to its
    // last word — and every further request was refused and handed back to A,
    // which is why A settles at 9.0 rather than 14.0. Pre-K15 the same drags
    // left B pinned at MIN_SEGMENT_DURATION with all four of its words stranded
    // in A's slot.
    expect(cur[0]!.duration).toBeCloseTo(9, 3);
    expect(cur[1]!.duration).toBeCloseTo(1, 3);
    expect(cur[1]!.duration).toBeGreaterThan(MIN_SEGMENT_DURATION);
  });

  it('an already-locked neighbour still blocks the cascade outright (unchanged)', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5, { locked: true }), seg('C', 10, 5)];
    const blocked: number[] = [];
    const out = computeDragCascade(arr, 0, 6, 0, 'right', i => blocked.push(i));
    expect(out).toBeNull();
    expect(blocked).toEqual([1]);
  });

  it('dragging never sets `locked` on anything (decision 9 point 1)', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    const out = computeDragCascade(arr, 0, 5.5, 0, 'right', noBlock)!;
    expect(out.every(s => s.locked !== true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PART 3 — behaviour that must NOT have changed.
// ---------------------------------------------------------------------------

describe('K15 — unchanged behaviour', () => {
  it('a plain grow into a long neighbour on a token-less project is identical to pre-K15', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    const out = computeDragCascade(arr, 0, 5.3, 0, 'right', noBlock)!;
    expect(spans(out)).toBe('A[0.00..5.30] B[5.30..10.00] C[10.00..15.00]');
  });

  it('a token-less short neighbour still clamps to MIN_SEGMENT_DURATION and passes overflow on', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 0.4), seg('C', 5.4, 5)];
    const out = computeDragCascade(arr, 0, 5.3, 0, 'right', noBlock)!;
    expect(spans(out)).toBe('A[0.00..5.30] B[5.30..5.60] C[5.60..10.40]');
  });

  it('shrinking a segment hands the time to its neighbour, unchanged', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    const out = computeDragCascade(arr, 0, 4, 0, 'right', noBlock, tokens(0, 15))!;
    // Growth is never bounded by the floor — only shrinkage is.
    expect(spans(out)).toBe('A[0.00..4.00] B[4.00..10.00] C[10.00..15.00]');
  });

  it('K14 INVARIANT L2 — every startTime this cascade writes carries anchorStart with it', () => {
    const arr = [seg('A', 0, 5, { anchorStart: 99 }), seg('B', 5, 5, { anchorStart: 99 }), seg('C', 10, 5)];
    const out = computeDragCascade(arr, 0, 5.5, 0, 'right', noBlock)!;
    expect(out[0]!.anchorStart).toBe(out[0]!.startTime);
    expect(out[1]!.anchorStart).toBe(out[1]!.startTime);
  });

  it('an out-of-range dragged index is a no-op null, not a throw', () => {
    expect(computeDragCascade([seg('A', 0, 5)], 7, 6, 0, 'right', noBlock)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PART 4 — K17: the live drag preview must show what the commit will write.
//
// The defect these pin: the drag's live preview wrote `left`/`width` for the
// DRAGGED CARD ONLY, leaving every neighbour the cascade would move frozen at
// its pre-drag geometry. So a growing segment's edge ran through the next card
// (an overlap, illegal under BOTH candidate models of `segments`), and every
// neighbour snapped into place on release.
//
// `resolveDragPreview` is the array the preview now draws. What must hold is
// not "it looks right" but that it is the SAME array the commit path writes —
// App.tsx's applyDurationChange resolves through `computeDragCascade` with the
// identical arguments, so these compare the two directly.
// ---------------------------------------------------------------------------

describe('K17 — live preview equals the committed cascade', () => {
  /** Three 5s slots, one spoken word centred in each, leaving exactly 1.0s of
   *  true silence at both edges of every slot. `tokens(0, 15)` is deliberately
   *  NOT used here: it puts a word onset at each slot's exact start, so K15b's
   *  word bound correctly refuses ALL yield and no neighbour can move — which
   *  makes it useless for asserting that neighbours DO move. */
  const SILENCE_TOKENS: TranscriptToken[] = [
    { startSec: 1, endSec: 4, text: 'a' },
    { startSec: 6, endSec: 9, text: 'b' },
    { startSec: 11, endSec: 14, text: 'c' },
  ];
  const threeSegs = (): VideoSegment[] => [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];

  const CASES: ReadonlyArray<
    readonly [label: string, draggedIdx: number, duration: number, dir: 'right' | 'left']
  > = [
    ['grow right into next', 0, 5.8, 'right'],
    ['shrink right, next takes it back', 0, 3.5, 'right'],
    ['grow left into prev', 2, 5.8, 'left'],
    ['shrink left, prev takes it back', 2, 3.5, 'left'],
  ];

  it.each(CASES)(
    'preview is byte-identical to the commit — %s',
    (_label, draggedIdx, duration, dir) => {
      const arr = threeSegs();
      const committed = computeDragCascade(arr, draggedIdx, duration, 0, dir, noBlock, SILENCE_TOKENS);
      const previewed = resolveDragPreview(arr, draggedIdx, duration, 0, dir, SILENCE_TOKENS);
      expect(previewed).toEqual(committed);
    },
  );

  it.each(CASES)(
    'the preview actually MOVES a neighbour, not only the dragged card — %s',
    (_label, draggedIdx, duration, dir) => {
      const arr = threeSegs();
      const out = resolveDragPreview(arr, draggedIdx, duration, 0, dir, SILENCE_TOKENS);
      // The assertion this whole fix exists for, stated directly: some segment
      // OTHER than the dragged one has different geometry than it started with.
      // The pre-K17 preview moved only the dragged card and fails here.
      const movedOthers = out.filter((s, i) =>
        i !== draggedIdx &&
        (s.startTime !== arr[i]!.startTime || s.duration !== arr[i]!.duration),
      );
      expect(movedOthers.length).toBeGreaterThan(0);
    },
  );

  it('previews a two-neighbour cascade — the second neighbour moves as well', () => {
    // B is token-less (yield floor = Infinity) and short, so MIN_SEGMENT_DURATION
    // clamps it and the overflow passes on to C. All three cards must move.
    const arr = [seg('A', 0, 5), seg('B', 5, 0.4), seg('C', 5.4, 5)];
    const out = resolveDragPreview(arr, 0, 5.3, 0, 'right');
    expect(spans(out)).toBe('A[0.00..5.30] B[5.30..5.60] C[5.60..10.40]');
    expect(out).toEqual(computeDragCascade(arr, 0, 5.3, 0, 'right', noBlock));
  });

  it('no two cards ever overlap in a previewed frame, at any drag position', () => {
    // An overlap at ANY pointer position is the bug, so one hand-picked position
    // would not be evidence — sweep both edges densely, with and without tokens.
    for (const toks of [SILENCE_TOKENS, undefined]) {
      for (let d = 0.3; d <= 12; d += 0.1) {
        for (const [idx, dir] of [[0, 'right'], [2, 'left']] as const) {
          const out = resolveDragPreview(threeSegs(), idx, Number(d.toFixed(2)), 0, dir, toks);
          for (let i = 0; i + 1 < out.length; i++) {
            const end = out[i]!.startTime + out[i]!.duration;
            expect(end).toBeLessThanOrEqual(out[i + 1]!.startTime + 1e-9);
          }
        }
      }
    }
  });

  it('a negligible drag previews the original array unchanged — nothing to un-draw on release', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5)];
    // App.tsx's pointerup path declines to commit below this same threshold, so
    // a preview that had drawn the drag would have to snap back at release.
    const out = resolveDragPreview(arr, 0, 5 + NEGLIGIBLE_DRAG_SEC / 2, 0, 'right', SILENCE_TOKENS);
    expect(out).toBe(arr);
  });

  it('a locked neighbour previews the original array — the blocked commit reverts to exactly this', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5, { locked: true }), seg('C', 10, 5)];
    expect(computeDragCascade(arr, 0, 7, 0, 'right', noBlock, SILENCE_TOKENS)).toBeNull();
    expect(resolveDragPreview(arr, 0, 7, 0, 'right', SILENCE_TOKENS)).toBe(arr);
  });

  it('K15a locality holds in the preview too — a gap outside the touched window survives', () => {
    // The K14-shaped array: B is locked and ends at 3.0, C starts at 5.0.
    const arr = [seg('A', 0, 2), seg('B', 2, 1, { locked: true }), seg('C', 5, 3), seg('D', 8, 3)];
    const out = resolveDragPreview(arr, 2, 4, 0, 'right', SILENCE_TOKENS);
    expect(out[0]).toEqual(arr[0]);
    expect(out[1]).toEqual(arr[1]);
    expect(out[2]!.startTime).toBe(5);
    // The 2.000s gap between B's end and C's start is untouched by the preview,
    // exactly as it is by the commit.
    expect(out[2]!.startTime - (out[1]!.startTime + out[1]!.duration)).toBeCloseTo(2, 9);
  });

  it("previews K15b's bounded duration, not the raw pointer duration", () => {
    // B owns words from 6.0, so it can yield only 1.0s of leading silence; a drag
    // asking for 3.0s more is bounded and the refused 2.0s is given back to A.
    // Pre-K17 the preview drew the raw request and the commit wrote the bounded
    // value — a visible jump at release.
    const arr = threeSegs();
    const RAW = 8;
    const out = resolveDragPreview(arr, 0, RAW, 0, 'right', SILENCE_TOKENS);
    expect(out[0]!.duration).toBe(6);
    expect(out[0]!.duration).toBeLessThan(RAW);
    expect(out).toEqual(computeDragCascade(arr, 0, RAW, 0, 'right', noBlock, SILENCE_TOKENS));
  });
});
