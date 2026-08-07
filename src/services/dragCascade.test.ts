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

describe('K15a — gap collapse (K14-introduced)', () => {
  /**
   * The gap is not hypothetical: this is the array `applyAnchorBasedTiming`
   * itself produces post-K14 whenever a locked segment's end falls before the
   * following segment's anchor. The pre-K14 locked branch grew the lock to fill
   * that span (`duration = max(preservedDuration, availableSpan)`), so its
   * output was contiguous by construction and no gap could reach a drag.
   */
  it('applyAnchorBasedTiming leaves a real gap after a locked segment (the K14 precondition)', () => {
    const out = applyAnchorBasedTiming(
      [
        seg('A', 0, 10),
        seg('B', 10, 2, { locked: true }),
        seg('C', 15, 3, { anchorStart: 15 }),
        seg('D', 18, 2, { anchorStart: 18 }),
      ],
      20,
    );
    expect(spans(out)).toBe('A[0.00..10.00] B[10.00..12.00] C[15.00..18.00] D[18.00..20.00]');
    // 3.000s of dead air between the lock's end and C's start.
    expect(out[2]!.startTime - (out[1]!.startTime + out[1]!.duration)).toBeCloseTo(3, 6);
  });

  it('a 0.2s drag on C does not move C — the 3s gap in front of it survives', () => {
    const gapped = applyAnchorBasedTiming(
      [
        seg('A', 0, 10),
        seg('B', 10, 2, { locked: true }),
        seg('C', 15, 3, { anchorStart: 15 }),
        seg('D', 18, 2, { anchorStart: 18 }),
      ],
      20,
    );
    const out = computeDragCascade(gapped, 2, gapped[2]!.duration + 0.2, 0, 'right', noBlock)!;

    // PRE-K15 this returned 'A[0.00..10.00] B[10.00..12.00] C[12.00..15.20] D[15.20..17.00]'
    // — a 0.2s drag displaced C by 3.000s and D by 2.800s, putting both slots
    // entirely off their own audio. The old cascade rebuilt every startTime from
    // a running sum starting at 0, which deletes any gap in the array.
    expect(spans(out)).toBe('A[0.00..10.00] B[10.00..12.00] C[15.00..18.20] D[18.20..20.00]');
    expect(out[2]!.startTime).toBe(gapped[2]!.startTime);
  });

  it('dragging the LAST segment — no neighbour to cascade into — still cannot collapse the gap', () => {
    const gapped = applyAnchorBasedTiming(
      [
        seg('A', 0, 10),
        seg('B', 10, 2, { locked: true }),
        seg('C', 15, 3, { anchorStart: 15 }),
        seg('D', 18, 2, { anchorStart: 18 }),
      ],
      20,
    );
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
  it('neighbourYieldableSec: head yield is exactly the leading silence', () => {
    // Slot [5,10]; the words the slot owns run 6.0 → 9.4, so 1.0s of leading
    // silence is all a right-edge drag on the previous segment may take.
    expect(neighbourYieldableSec({ startTime: 5, duration: 5 }, 'head', tokens(6, 10)))
      .toBeCloseTo(6 - 5, 6);
  });

  it('neighbourYieldableSec: tail yield is exactly the trailing silence', () => {
    expect(neighbourYieldableSec({ startTime: 5, duration: 5 }, 'tail', tokens(6, 10)))
      .toBeCloseTo(10 - 9.4, 6);
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

  it('a right-edge drag cannot eat past the next segment\'s first word', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    // Words: A 0.0-4.4, B 6.0-9.4 (1s of leading silence), C 11.0-14.4.
    const tk = [...tokens(0, 5), ...tokens(6, 10), ...tokens(11, 15)];
    // Ask A to grow by 3.0s — far past B's first word at 6.0.
    const out = computeDragCascade(arr, 0, 8, 0, 'right', noBlock, tk)!;

    // PRE-K15 this returned 'A[0.00..8.00] B[8.00..10.00] C[10.00..15.00]': B
    // was cut from 5.0s to 2.0s and lost its words at 6.0, 7.0 and part of 8.0
    // into A's slot. B was nowhere near MIN_SEGMENT_DURATION, so the old 0.3s
    // floor never engaged — which is why "a few hundred ms" could still be
    // catastrophic for a long neighbour.
    //
    // Now: B yields its 1.0s of leading silence and not one frame more, and the
    // 2.0s the bound refused is handed back to A. The cascade never reaches C,
    // because for a right-edge drag B's start IS the dragged segment's end —
    // no amount of yielding further down the chain can move it back.
    expect(spans(out)).toBe('A[0.00..6.00] B[6.00..10.00] C[10.00..15.00]');
    // The headline invariant: B's own first word (6.0) is still inside B.
    expect(out[1]!.startTime).toBeLessThanOrEqual(6);
    expect(out[2]).toEqual(arr[2]);
    // And total timeline duration is conserved — nothing was invented or lost.
    const total = (s: VideoSegment[]) => s.reduce((a, x) => a + x.duration, 0);
    expect(total(out)).toBeCloseTo(total(arr), 6);
  });

  it('a left-edge drag cannot eat past the previous segment\'s last word', () => {
    const arr = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    // A's words end at 3.4, leaving 1.6s of trailing silence before B starts.
    const tk = [...tokens(0, 3.5), ...tokens(6, 10)];
    // Drag B's left edge 3.0s earlier (B 5 → 8).
    const out = computeDragCascade(arr, 1, 8, 0, 'left', noBlock, tk)!;

    // PRE-K15: 'A[0.00..2.00] B[2.00..10.00] C[10.00..15.00]' — A cut to 2.0s,
    // losing its own word at 3.0 into B's slot.
    // Now A yields only its 1.6s of trailing silence; the other 1.4s is returned
    // to B, whose right edge never moved on a left-edge drag either way.
    expect(spans(out)).toBe('A[0.00..3.40] B[3.40..10.00] C[10.00..15.00]');
    expect(out[0]!.startTime + out[0]!.duration).toBeGreaterThanOrEqual(3.4);
    expect(out[2]).toEqual(arr[2]);
  });

  it('repeated drags into the same neighbour stop at the floor instead of bottoming out at 0.3s', () => {
    // This is the shape K14 exposed. Pre-K14 the cascade auto-locked B on the
    // first drag, so the SECOND drag hit the locked-neighbour guard and was
    // refused with a toast — an accidental one-shot circuit breaker, not a
    // bound. Decision 9 point 1 forbids restoring it, so the floor has to hold
    // on its own across any number of drags.
    const tk = [...tokens(0, 5), ...tokens(6, 10), ...tokens(11, 15)];
    let cur: VideoSegment[] = [seg('A', 0, 5), seg('B', 5, 5), seg('C', 10, 5)];
    for (let i = 0; i < 8; i++) {
      cur = computeDragCascade(cur, 0, cur[0]!.duration + 0.3, 0, 'right', noBlock, tk)!;
      expect(cur[1]!.startTime).toBeLessThanOrEqual(6);
    }
    // Eight 0.3s drags demanded 2.4s; B only ever gave up its 1.0s of leading
    // silence, and the remaining 1.4s was refused. B still holds its first word
    // and never came near MIN_SEGMENT_DURATION. Pre-K15 the same eight drags
    // left B at 5.0 - 2.4 = 2.6s starting at 7.4, with its words from 6.0 to 7.4
    // stranded in A's slot.
    expect(cur[0]!.duration).toBeCloseTo(6, 3);
    expect(cur[1]!.duration).toBeCloseTo(4, 3);
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
