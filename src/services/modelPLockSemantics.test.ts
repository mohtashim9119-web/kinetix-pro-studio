import { describe, it, expect } from 'vitest';
import { applyAnchorBasedTiming } from './syncEngine';
import { findPartitionViolations, canLockSegment, PARTITION_EPSILON_SEC } from './timelinePartition';
import type { VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

/**
 * MODEL P — lock semantics under the gapless-partition invariant.
 *
 * Ruling: `docs/decisions/2026-08-07-model-p-ruling.md`; analysis:
 * `docs/segments-invariant-ruling.md` §4.1/§6.3 ("K14 — lock hard wall /
 * growth exemption withdrawn: Needs rework. Must gain the §4.1 filling rule,
 * and must refuse unsatisfiable locks").
 *
 * The invariant these tests exist to defend:
 *
 *     startTime[i] + duration[i] === startTime[i+1]   for every adjacent pair
 *
 * K14 made a locked segment a hard wall in both directions, which was correct
 * for locks but silently adopted Model S — it left the array free to contain a
 * real gap. Two gap shapes are reachable through `applyAnchorBasedTiming`
 * alone, and they are NOT symmetric (this is the thing worth knowing before
 * touching the code):
 *
 *   - AFTER a lock: an unlocked successor whose own `anchorStart` sits LATER
 *     than the lock's end keeps that later anchor, because the pre-fix
 *     `Math.max(rawAnchor, lockFloor)` treats the lock's end as a FLOOR only.
 *     A floor closes an overlap and is blind to a gap. **This is the live
 *     defect.**
 *
 *   - BEFORE a lock: already closed pre-fix, and deliberately re-pinned below
 *     so a future edit cannot regress it. The predecessor's duration is
 *     derived as `nextAnchor - effectiveStart`, and `nextAnchor` is already
 *     substituted to a locked successor's own `startTime`, so its end lands
 *     exactly on the wall by construction.
 *
 * The third shape — two ADJACENT locks with space between them — is genuinely
 * unsatisfiable (both are declared immovable; nothing between them may move).
 * Per ruling §4.1(a) it is refused at lock-toggle time rather than resolved by
 * moving a lock, which is `canLockSegment`'s job and is covered at the bottom.
 */

const AUDIO_DURATION = 100;

function seg(partial: Partial<VideoSegment> & { id: string; startTime: number; duration: number }): VideoSegment {
  return {
    text: partial.id,
    order: 0,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    ...partial,
  };
}

/** The invariant itself, asserted directly rather than via any production helper. */
function expectGapless(segments: VideoSegment[], audioDuration?: number): void {
  for (let i = 0; i < segments.length - 1; i++) {
    const end = segments[i]!.startTime + segments[i]!.duration;
    expect(
      Math.abs(end - segments[i + 1]!.startTime),
      `gap/overlap between segment ${i} (ends ${end.toFixed(3)}) and segment ${i + 1} (starts ${segments[i + 1]!.startTime.toFixed(3)})`,
    ).toBeLessThanOrEqual(PARTITION_EPSILON_SEC);
  }
  if (audioDuration !== undefined && segments.length > 0) {
    const last = segments[segments.length - 1]!;
    expect(Math.abs(last.startTime + last.duration - audioDuration)).toBeLessThanOrEqual(PARTITION_EPSILON_SEC);
  }
}

describe('Model P — applyAnchorBasedTiming produces no gap around a lock', () => {
  it('DEFECT (K14): an unlocked successor anchored AFTER a lock no longer leaves a gap', () => {
    // Lock spans [10, 20). The successor's own anchor sits at 35 — 15s LATER
    // than the wall's end. Pre-fix, Math.max(35, 20) = 35 and the timeline
    // carried a real 15s hole between segment 1's end and segment 2's start.
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 10, anchorStart: 0 }),
      seg({ id: 'b', startTime: 10, duration: 10, anchorStart: 10, locked: true }),
      seg({ id: 'c', startTime: 35, duration: 20, anchorStart: 35 }),
      seg({ id: 'd', startTime: 60, duration: 40, anchorStart: 60 }),
    ];

    const out = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    expectGapless(out, AUDIO_DURATION);
    // The successor starts at the lock's exact end and absorbs the 15s as
    // LEADING silence.
    expect(out[2]!.startTime).toBeCloseTo(20, 3);

    // ...and its own END does not move — which is what makes the fill rule
    // safe: the segment acquires silence in front of its words, it does not
    // slide onto different audio, and nothing ripples past it. The end is
    // `nextAnchor` (segment d's own anchor, 60) both before and after the
    // fix; note this function never preserves a segment's prior DURATION —
    // each segment occupies [its own anchor, the next anchor] by design, so
    // 20 + 40 = 60 here, not 35 + 20 = 55.
    expect(out[2]!.startTime + out[2]!.duration).toBeCloseTo(60, 3);
    expect(out[3]!.startTime).toBeCloseTo(60, 3); // segment d never moved
    expect(findPartitionViolations(out, AUDIO_DURATION)).toEqual([]);
  });

  it('the locked segment itself never moves and never resizes', () => {
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 10, anchorStart: 0 }),
      seg({ id: 'b', startTime: 10, duration: 10, anchorStart: 10, locked: true }),
      seg({ id: 'c', startTime: 35, duration: 65, anchorStart: 35 }),
    ];

    const out = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    expect(out[1]!.startTime).toBe(10);
    expect(out[1]!.duration).toBe(10);
    expect(out[1]!.locked).toBe(true);
    // INVARIANT L2 — anchorStart mirrors the pinned startTime, so no later
    // pass can re-derive a position from a separately-stale anchor.
    expect(out[1]!.anchorStart).toBe(10);
  });

  it('a gap BEFORE a lock is closed by extending the unlocked predecessor to the wall', () => {
    // Predecessor's anchored span would end at 5, but the wall starts at 20.
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 5, anchorStart: 0 }),
      seg({ id: 'b', startTime: 20, duration: 10, anchorStart: 20, locked: true }),
      seg({ id: 'c', startTime: 30, duration: 70, anchorStart: 30 }),
    ];

    const out = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    expectGapless(out, AUDIO_DURATION);
    expect(out[0]!.startTime).toBe(0);
    expect(out[0]!.startTime + out[0]!.duration).toBeCloseTo(20, 3);
    expect(out[1]!.startTime).toBe(20); // wall untouched
  });

  it('a lock surrounded on BOTH sides by unlocked segments stays gapless on both edges', () => {
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 3, anchorStart: 0 }),
      seg({ id: 'b', startTime: 25, duration: 10, anchorStart: 25, locked: true }),
      seg({ id: 'c', startTime: 50, duration: 50, anchorStart: 50 }),
    ];

    const out = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    expectGapless(out, AUDIO_DURATION);
    expect(out[0]!.startTime + out[0]!.duration).toBeCloseTo(25, 3); // grew to the wall
    expect(out[2]!.startTime).toBeCloseTo(35, 3);                     // starts at the wall's end
    expect(out[1]!.startTime).toBe(25);
    expect(out[1]!.duration).toBe(10);
  });

  it('two locks with an unlocked segment between them: the middle absorbs both shortfalls', () => {
    // Both walls are honoured exactly; the one movable segment between them is
    // stretched to span the whole distance from wall 1's end to wall 2's start.
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 10, anchorStart: 0, locked: true }),
      seg({ id: 'b', startTime: 30, duration: 5, anchorStart: 30 }),
      seg({ id: 'c', startTime: 70, duration: 30, anchorStart: 70, locked: true }),
    ];

    const out = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    expectGapless(out, AUDIO_DURATION);
    expect(out[0]!.startTime).toBe(0);
    expect(out[0]!.duration).toBe(10);
    expect(out[1]!.startTime).toBeCloseTo(10, 3);
    expect(out[1]!.startTime + out[1]!.duration).toBeCloseTo(70, 3);
    expect(out[2]!.startTime).toBe(70);
    expect(out[2]!.duration).toBe(30);
  });

  it('consecutive locks that are already flush stay flush and produce no violation', () => {
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 10, anchorStart: 0 }),
      seg({ id: 'b', startTime: 10, duration: 10, anchorStart: 10, locked: true }),
      seg({ id: 'c', startTime: 20, duration: 10, anchorStart: 20, locked: true }),
      seg({ id: 'd', startTime: 30, duration: 70, anchorStart: 30 }),
    ];

    const out = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    expectGapless(out, AUDIO_DURATION);
    expect(findPartitionViolations(out, AUDIO_DURATION)).toEqual([]);
  });
});

describe('Model P — edge cases', () => {
  it('a single unlocked segment covers the whole timeline', () => {
    const out = applyAnchorBasedTiming([seg({ id: 'only', startTime: 0, duration: 5, anchorStart: 0 })], AUDIO_DURATION);
    expect(out).toHaveLength(1);
    expectGapless(out, AUDIO_DURATION);
    expect(out[0]!.startTime).toBe(0);
    expect(out[0]!.duration).toBeCloseTo(AUDIO_DURATION, 3);
  });

  it('a single LOCKED segment is left exactly as authored (unsatisfiable at both ends, reported not patched)', () => {
    const segments = [seg({ id: 'only', startTime: 4, duration: 5, anchorStart: 4, locked: true })];
    const out = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    // The lock is honoured — never moved, never resized, even though it can
    // cover neither the head nor the tail.
    expect(out[0]!.startTime).toBe(4);
    expect(out[0]!.duration).toBe(5);

    // ...and the shortfall is REPORTED rather than silently patched.
    const kinds = findPartitionViolations(out, AUDIO_DURATION).map(v => v.kind);
    expect(kinds).toContain('head-locked');
    expect(kinds).toContain('tail-locked');
  });

  it('an empty array is returned untouched', () => {
    expect(applyAnchorBasedTiming([], AUDIO_DURATION)).toEqual([]);
    expect(findPartitionViolations([], AUDIO_DURATION)).toEqual([]);
  });

  it('a LOCKED FIRST segment starting after 0 keeps its position (head-locked is reported, not patched)', () => {
    const segments = [
      seg({ id: 'a', startTime: 6, duration: 10, anchorStart: 6, locked: true }),
      seg({ id: 'b', startTime: 16, duration: 84, anchorStart: 16 }),
    ];

    const out = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    expect(out[0]!.startTime).toBe(6); // wall not moved to 0
    // Everything downstream of the wall is still gapless.
    expect(out[0]!.startTime + out[0]!.duration).toBeCloseTo(out[1]!.startTime, 3);
    expect(findPartitionViolations(out, AUDIO_DURATION).map(v => v.kind)).toContain('head-locked');
  });

  it('a LOCKED LAST segment ending before audioDuration is not stretched (tail-locked is reported)', () => {
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 10, anchorStart: 0 }),
      seg({ id: 'b', startTime: 10, duration: 10, anchorStart: 10, locked: true }),
    ];

    const out = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    expect(out[1]!.duration).toBe(10); // NOT stretched to 90
    expect(findPartitionViolations(out, AUDIO_DURATION).map(v => v.kind)).toContain('tail-locked');
  });

  it('an unlocked last segment IS stretched to exactly audioDuration', () => {
    const out = applyAnchorBasedTiming(
      [
        seg({ id: 'a', startTime: 0, duration: 10, anchorStart: 0 }),
        seg({ id: 'b', startTime: 10, duration: 3, anchorStart: 10 }),
      ],
      AUDIO_DURATION,
    );
    expectGapless(out, AUDIO_DURATION);
    expect(out[1]!.startTime + out[1]!.duration).toBeCloseTo(AUDIO_DURATION, 3);
  });

  it('a lock never gets squeezed below the floor by its neighbour, and never overlaps it', () => {
    // The predecessor's anchor sits past the wall's own start — an overlap
    // shape. The wall wins; the predecessor is the one that gives way.
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 40, anchorStart: 0 }),
      seg({ id: 'b', startTime: 20, duration: 10, anchorStart: 20, locked: true }),
      seg({ id: 'c', startTime: 30, duration: 70, anchorStart: 30 }),
    ];

    const out = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    expect(out[1]!.startTime).toBe(20);
    expect(out[1]!.duration).toBe(10);
    // No overlap: the predecessor's end may not cross the wall.
    expect(out[0]!.startTime + out[0]!.duration).toBeLessThanOrEqual(20 + PARTITION_EPSILON_SEC);
  });
});

describe('Model P — §4.1(a): unsatisfiable locks are refused at toggle time', () => {
  it('refuses a lock that would create a lock-lock gap with the PRECEDING lock', () => {
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 10, locked: true }),
      seg({ id: 'b', startTime: 25, duration: 10 }), // gap [10, 25) behind it
    ];

    const refusal = canLockSegment(segments, 1);

    expect(refusal).not.toBeNull();
    expect(refusal!.conflictIndex).toBe(0);
    expect(refusal!.conflictSegmentId).toBe('a');
    expect(refusal!.amountSec).toBeCloseTo(15, 3);
  });

  it('refuses a lock that would create a lock-lock gap with the FOLLOWING lock', () => {
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 10 }),
      seg({ id: 'b', startTime: 25, duration: 10, locked: true }),
    ];

    const refusal = canLockSegment(segments, 0);

    expect(refusal).not.toBeNull();
    expect(refusal!.conflictIndex).toBe(1);
    expect(refusal!.conflictSegmentId).toBe('b');
  });

  it('ALLOWS a lock adjacent to another lock when they are already flush', () => {
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 10, locked: true }),
      seg({ id: 'b', startTime: 10, duration: 10 }),
    ];
    expect(canLockSegment(segments, 1)).toBeNull();
  });

  it('ALLOWS a lock whose neighbours are unlocked, however large the discontinuity', () => {
    // An unlocked neighbour can always absorb — nothing is unsatisfiable here.
    const segments = [
      seg({ id: 'a', startTime: 0, duration: 1 }),
      seg({ id: 'b', startTime: 40, duration: 10 }),
      seg({ id: 'c', startTime: 80, duration: 20 }),
    ];
    expect(canLockSegment(segments, 1)).toBeNull();
  });

  it('ALLOWS locking the only segment, and tolerates an out-of-range index', () => {
    expect(canLockSegment([seg({ id: 'only', startTime: 0, duration: 10 })], 0)).toBeNull();
    expect(canLockSegment([seg({ id: 'only', startTime: 0, duration: 10 })], 7)).toBeNull();
  });
});

describe('Model P — findPartitionViolations detects each shape independently', () => {
  it('reports a plain gap between two segments', () => {
    const found = findPartitionViolations([
      seg({ id: 'a', startTime: 0, duration: 10 }),
      seg({ id: 'b', startTime: 15, duration: 85 }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('lock-lock-gap');
    expect(found[0]!.amountSec).toBeCloseTo(5, 3);
  });

  it('reports an overlap between two segments', () => {
    const found = findPartitionViolations([
      seg({ id: 'a', startTime: 0, duration: 20 }),
      seg({ id: 'b', startTime: 15, duration: 85 }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('lock-lock-overlap');
    expect(found[0]!.amountSec).toBeCloseTo(5, 3);
  });

  it('passes a clean contiguous array covering [0, audioDuration]', () => {
    expect(
      findPartitionViolations(
        [
          seg({ id: 'a', startTime: 0, duration: 40 }),
          seg({ id: 'b', startTime: 40, duration: 60 }),
        ],
        AUDIO_DURATION,
      ),
    ).toEqual([]);
  });

  it('tolerates sub-epsilon rounding noise rather than reporting it as a gap', () => {
    // Every value in the pipeline is Number(v.toFixed(3)) — two values equal
    // in intent can differ by half a millisecond of representation.
    expect(
      findPartitionViolations([
        seg({ id: 'a', startTime: 0, duration: 10.0004 }),
        seg({ id: 'b', startTime: 10, duration: 90 }),
      ]),
    ).toEqual([]);
  });
});
