import { describe, it, expect } from 'vitest';
import { computeDragCascade, resolveDragPreview, MIN_SEGMENT_DURATION } from './dragCascade';
import { applyAnchorBasedTiming } from './syncEngine';
import { findPartitionViolations, PARTITION_EPSILON_SEC } from './timelinePartition';
import type { VideoSegment, TranscriptToken } from '../types';
import { TransitionType, AnimationType } from '../types';

/**
 * THE REGRESSION NET for the Model P gapless invariant.
 *
 *     startTime[i] + duration[i] === startTime[i+1]
 *
 * Ruling: `docs/decisions/2026-08-07-model-p-ruling.md`. The compliance
 * backlog this file closes is enumerated in `project-state.md`'s Open
 * Decisions.
 *
 * Every other Model P test pins ONE named scenario. This file instead sweeps
 * the two writers that can move a boundary — `computeDragCascade` (the drag
 * path) and `applyAnchorBasedTiming` (the sync path) — across a wide matrix of
 * inputs and asserts only the invariant. It exists to catch the case nobody
 * thought to name, which is precisely how K14's gap survived review: every
 * targeted test passed, because none of them asked this question.
 *
 * Deliberately asserts the invariant DIRECTLY (arithmetic on the array) as
 * well as via `findPartitionViolations`, so the net does not depend on the
 * checker being correct — if the two ever disagree, that is itself a defect
 * worth failing on.
 */

const seg = (
  id: string,
  startTime: number,
  duration: number,
  extra: Partial<VideoSegment> = {},
): VideoSegment => ({
  id,
  text: `text-${id}`,
  startTime,
  duration,
  transition: TransitionType.NONE,
  animation: AnimationType.NONE,
  order: 0,
  anchorStart: startTime,
  ...extra,
});

/** Builds a contiguous, gapless array of `n` segments each `dur` long. */
function gaplessArray(n: number, dur = 5): VideoSegment[] {
  return Array.from({ length: n }, (_, i) => seg(String.fromCharCode(65 + i), i * dur, dur));
}

/** One token per whole second in [from, to), 0.4s long. */
function tokens(from: number, to: number): TranscriptToken[] {
  const out: TranscriptToken[] = [];
  for (let t = from; t < to - 1e-9; t += 1) {
    out.push({ startSec: Number(t.toFixed(3)), endSec: Number((t + 0.4).toFixed(3)), text: 'w' });
  }
  return out;
}

/**
 * The invariant, asserted arithmetically and independently of any production
 * helper. Returns nothing; throws with the offending pair named.
 */
function assertGapless(segments: VideoSegment[], context: string): void {
  for (let i = 0; i < segments.length - 1; i++) {
    const end = segments[i]!.startTime + segments[i]!.duration;
    const nextStart = segments[i + 1]!.startTime;
    expect(
      Math.abs(end - nextStart),
      `${context}: segment ${i} ends ${end.toFixed(3)} but segment ${i + 1} starts ${nextStart.toFixed(3)}`,
    ).toBeLessThanOrEqual(PARTITION_EPSILON_SEC);
  }
  // Cross-check the independent checker agrees with the arithmetic above.
  const adjacencyViolations = findPartitionViolations(segments)
    .filter(v => v.kind === 'lock-lock-gap' || v.kind === 'lock-lock-overlap');
  expect(adjacencyViolations, `${context}: findPartitionViolations disagrees with direct arithmetic`).toEqual([]);
}

const noBlock = (): void => {};

describe('gapless invariant — the drag path (computeDragCascade / restackWindow)', () => {
  // Sweep: every segment index, both edges, growing and shrinking, across
  // several magnitudes — including magnitudes large enough to exhaust a
  // neighbour and trip the MIN_SEGMENT_DURATION floor.
  const deltas = [-4.9, -2.5, -0.7, -0.1, 0.1, 0.7, 2.5, 4.9, 40];

  for (const direction of ['right', 'left'] as const) {
    for (const delta of deltas) {
      it(`stays gapless: ${direction}-edge drag of ${delta >= 0 ? '+' : ''}${delta}s at every index`, () => {
        for (let idx = 0; idx < 5; idx++) {
          const arr = gaplessArray(5);
          const target = Math.max(MIN_SEGMENT_DURATION, arr[idx]!.duration + delta);
          const out = computeDragCascade(arr, idx, target, 0, direction, noBlock);
          if (out === null) continue; // blocked by a lock — nothing committed
          assertGapless(out, `${direction} drag ${delta}s at index ${idx}`);
        }
      });
    }
  }

  it('stays gapless when the K15b word-onset floor refuses part of the shrink', () => {
    // The floor hands refused shrink BACK to the dragged segment, which is what
    // conserves the touched window's total duration — and total conservation is
    // exactly what keeps restackWindow's [lo, hi] edge flush with hi+1.
    const arr = gaplessArray(4, 10);
    const tk = tokens(0, 40); // every segment densely owns words: little silence to yield
    for (let idx = 0; idx < 4; idx++) {
      for (const direction of ['right', 'left'] as const) {
        const out = computeDragCascade(arr, idx, arr[idx]!.duration + 6, 0, direction, noBlock, tk);
        if (out === null) continue;
        assertGapless(out, `${direction} drag at ${idx} against the word floor`);
      }
    }
  });

  it('stays gapless when a locked neighbour bounds the cascade', () => {
    for (let lockIdx = 0; lockIdx < 5; lockIdx++) {
      const arr = gaplessArray(5);
      arr[lockIdx] = { ...arr[lockIdx]!, locked: true };
      for (let idx = 0; idx < 5; idx++) {
        for (const direction of ['right', 'left'] as const) {
          const out = computeDragCascade(arr, idx, arr[idx]!.duration + 2, 0, direction, noBlock);
          if (out === null) continue; // the lock blocked it — nothing committed
          assertGapless(out, `drag ${direction} at ${idx} with lock at ${lockIdx}`);
        }
      }
    }
  });

  it('the LIVE PREVIEW path agrees with the commit path, and is itself gapless', () => {
    // resolveDragPreview delegates to computeDragCascade precisely so the two
    // cannot drift (K17). Pinning that here means a future "preview-only
    // shortcut" optimisation cannot silently reintroduce a preview-side gap.
    const arr = gaplessArray(5);
    for (let idx = 0; idx < 5; idx++) {
      for (const direction of ['right', 'left'] as const) {
        const preview = resolveDragPreview(arr, idx, arr[idx]!.duration + 1.5, 0, direction);
        const commit = computeDragCascade(arr, idx, arr[idx]!.duration + 1.5, 0, direction, noBlock);
        expect(preview).toEqual(commit);
        if (preview) assertGapless(preview, `preview ${direction} at ${idx}`);
      }
    }
  });

  it('a two-segment array — the minimum where a boundary exists at all — stays gapless', () => {
    for (const direction of ['right', 'left'] as const) {
      for (const delta of [-2, -0.1, 0.1, 2]) {
        const arr = gaplessArray(2);
        const out = computeDragCascade(arr, 0, Math.max(MIN_SEGMENT_DURATION, arr[0]!.duration + delta), 0, direction, noBlock);
        if (out) assertGapless(out, `2-segment ${direction} ${delta}`);
      }
    }
  });
});

describe('gapless invariant — the sync path (applyAnchorBasedTiming)', () => {
  const AUDIO = 100;

  it('stays gapless with a lock at every possible index', () => {
    for (let lockIdx = 0; lockIdx < 5; lockIdx++) {
      // Anchors deliberately scattered AWAY from a contiguous layout, so each
      // run genuinely exercises the fill rule rather than a no-op.
      const arr = [
        seg('A', 0, 10, { anchorStart: 0 }),
        seg('B', 18, 5, { anchorStart: 18 }),
        seg('C', 40, 5, { anchorStart: 40 }),
        seg('D', 62, 5, { anchorStart: 62 }),
        seg('E', 85, 15, { anchorStart: 85 }),
      ];
      arr[lockIdx] = { ...arr[lockIdx]!, locked: true };

      const out = applyAnchorBasedTiming(arr, AUDIO);
      assertGapless(out, `sync with lock at index ${lockIdx}`);

      // The lock itself is honoured exactly — position and length both.
      expect(out[lockIdx]!.startTime).toBe(arr[lockIdx]!.startTime);
      expect(out[lockIdx]!.duration).toBe(arr[lockIdx]!.duration);
    }
  });

  it('stays gapless with TWO locks at every non-adjacent pair of indices', () => {
    for (let a = 0; a < 5; a++) {
      for (let b = a + 2; b < 5; b++) {
        const arr = [
          seg('A', 0, 10, { anchorStart: 0 }),
          seg('B', 18, 5, { anchorStart: 18 }),
          seg('C', 40, 5, { anchorStart: 40 }),
          seg('D', 62, 5, { anchorStart: 62 }),
          seg('E', 85, 15, { anchorStart: 85 }),
        ];
        arr[a] = { ...arr[a]!, locked: true };
        arr[b] = { ...arr[b]!, locked: true };
        assertGapless(applyAnchorBasedTiming(arr, AUDIO), `sync with locks at ${a} and ${b}`);
      }
    }
  });

  it('stays gapless with no locks at all (the ordinary Apply Sync case)', () => {
    const arr = [
      seg('A', 0, 10, { anchorStart: 0 }),
      seg('B', 18, 5, { anchorStart: 18 }),
      seg('C', 40, 5, { anchorStart: 40 }),
      seg('D', 85, 15, { anchorStart: 85 }),
    ];
    const out = applyAnchorBasedTiming(arr, AUDIO);
    assertGapless(out, 'sync, no locks');
    // ...and covers the whole timeline, head and tail (Key Invariant (b)).
    expect(out[0]!.startTime).toBe(0);
    expect(out.at(-1)!.startTime + out.at(-1)!.duration).toBeCloseTo(AUDIO, 3);
  });

  it('is idempotent — re-running on its own output changes nothing and stays gapless', () => {
    // A real risk: Apply Sync, a lock toggle, and a drag can each re-run this
    // pass over an already-timed array. A pass that were not idempotent would
    // drift a boundary a little further on every user interaction.
    const arr = [
      seg('A', 0, 10, { anchorStart: 0 }),
      seg('B', 18, 5, { anchorStart: 18, locked: true }),
      seg('C', 40, 5, { anchorStart: 40 }),
      seg('D', 85, 15, { anchorStart: 85 }),
    ];
    const once = applyAnchorBasedTiming(arr, AUDIO);
    const twice = applyAnchorBasedTiming(once, AUDIO);
    assertGapless(once, 'sync pass 1');
    assertGapless(twice, 'sync pass 2');
    expect(twice.map(s => [s.startTime, s.duration])).toEqual(once.map(s => [s.startTime, s.duration]));
  });
});
