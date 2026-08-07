/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// MODEL P — the gapless-partition checker and the lock-grantability gate
// ---------------------------------------------------------------------------
//
// OWNER RULING (2026-08-07) — `docs/decisions/2026-08-07-model-p-ruling.md`,
// analysis in `docs/segments-invariant-ruling.md`:
//
//     startTime[0] === 0
//     startTime[i] + duration[i] === startTime[i+1]   for every i in [0, n-2]
//     startTime[n-1] + duration[n-1] === audioDuration
//
// A gap is now illegal, unconditionally — it was previously undecided, and
// K14's lock hard wall had silently adopted "Model S" (gaps legal) while nine
// other components including BOTH export paths assume Model P and cannot
// represent a gap at all.
//
// SCOPE OF THIS FILE, AND WHAT IT DELIBERATELY IS NOT.
//
// This module READS. It does not position. The park commit (`210855d`,
// `model-p-editor-work`) proposed a much larger `enforceGaplessPartition`
// that would have become the single writer of `startTime` for the whole
// pipeline — deleting `applyAnchorBasedTiming`'s PASS 1/PASS 3 and
// `headExtendFirstSegment`, and re-routing six producers through it. That
// design is sound in the abstract and its reasoning is preserved in the
// commit, but it is NOT what landed here, for one measured reason: the Step M
// golden-baseline replay (`scripts/phase4-handoff-replay-sync.test.ts`)
// asserts the shipped pipeline's output byte-for-byte across three real
// corpus projects, and a positioning rewrite changes which function owns the
// head/tail rules on every project — including the ~99% of real projects that
// contain no locked segment at all and therefore have no Model P defect to
// fix. Enforcement was instead added where the gap is actually PRODUCED (the
// lock branch of `applyAnchorBasedTiming`), so lock-free projects replay
// byte-identically and the golden baseline keeps its power as a regression
// net. Re-deriving the park commit's positioner remains a legitimate future
// refactor; it is not a prerequisite for compliance.
//
// Pure. No I/O, no DOM, no React — same worker-safe discipline as
// `resolutionConfig.ts`/`zoomScale.ts`, so either export path can import it.
// ---------------------------------------------------------------------------

import type { VideoSegment } from '../types';

/**
 * Slack for every partition comparison. Every `startTime`/`duration` in this
 * pipeline is rounded to 3 decimals (`Number(v.toFixed(3))`), so two values
 * that are equal in intent can differ by up to half a millisecond of
 * representation. 1.5ms is comfortably above that and far below
 * `MIN_SEGMENT_DURATION` (0.1s), so it can never mask a real gap.
 */
export const PARTITION_EPSILON_SEC = 0.0015;

/** The pipeline's uniform 3-decimal rounding. */
function round3(v: number): number {
  return Number(v.toFixed(3));
}

export type PartitionViolationKind =
  /** Segment 0 starts after t=0. Named for the only shape that can now
   *  produce it: a LOCKED first segment, which may not be moved to cover the
   *  head. An unlocked one is head-extended long before this checker runs. */
  | 'head-locked'
  /** The last segment ends before `audioDuration` — again only reachable
   *  when it is locked, since an unlocked one is stretched to the audio. */
  | 'tail-locked'
  /** Unassigned space between two adjacent segments. */
  | 'lock-lock-gap'
  /** Doubly-assigned space between two adjacent segments. Illegal under BOTH
   *  candidate models, and so always a defect wherever it appears. */
  | 'lock-lock-overlap';

export interface PartitionViolation {
  kind: PartitionViolationKind;
  /** Index of the segment the violation is measured AT (for an adjacent-pair
   *  violation, the later of the two). */
  index: number;
  segmentId: string;
  /** Size of the unassigned (or doubly-assigned) span, in seconds. */
  amountSec: number;
}

/**
 * Read-only checker: every place `segments` fails to be a gapless partition
 * of `[0, audioDuration]`.
 *
 * Deliberately implemented as an independent walk rather than by running a
 * positioner and diffing — so a test asserting that the production pipeline's
 * output is clean is not merely asserting a constructor against itself.
 *
 * `audioDuration` is optional: omit it where total length is not in hand (the
 * drag path mid-gesture, for instance) and the tail check simply does not run.
 */
export function findPartitionViolations(
  segments: Pick<VideoSegment, 'id' | 'startTime' | 'duration' | 'locked'>[],
  audioDuration?: number,
): PartitionViolation[] {
  const found: PartitionViolation[] = [];
  if (segments.length === 0) return found;

  const first = segments[0]!;
  if (first.startTime > PARTITION_EPSILON_SEC) {
    found.push({
      kind: 'head-locked',
      index: 0,
      segmentId: first.id,
      amountSec: round3(first.startTime),
    });
  }

  for (let i = 0; i < segments.length - 1; i++) {
    const curr = segments[i]!;
    const next = segments[i + 1]!;
    const delta = round3(next.startTime - (curr.startTime + curr.duration));
    if (Math.abs(delta) <= PARTITION_EPSILON_SEC) continue;
    found.push({
      kind: delta > 0 ? 'lock-lock-gap' : 'lock-lock-overlap',
      index: i + 1,
      segmentId: next.id,
      amountSec: Math.abs(delta),
    });
  }

  if (audioDuration !== undefined && audioDuration > 0) {
    const last = segments[segments.length - 1]!;
    const end = round3(last.startTime + last.duration);
    if (Math.abs(end - audioDuration) > PARTITION_EPSILON_SEC) {
      found.push({
        kind: 'tail-locked',
        index: segments.length - 1,
        segmentId: last.id,
        amountSec: round3(Math.abs(audioDuration - end)),
      });
    }
  }

  return found;
}

/** What `canLockSegment` refuses, and why — surfaced to the user verbatim. */
export interface LockRefusal {
  /** Index of the ALREADY-locked segment this lock would collide with. */
  conflictIndex: number;
  conflictSegmentId: string;
  /** The span that would become unassignable, in seconds. */
  amountSec: number;
}

/**
 * Ruling §4.1(a) — may `segments[index]` be locked without making the gapless
 * invariant unsatisfiable?
 *
 * The one shape that cannot be satisfied is two ADJACENT locks with space
 * between them: both are declared immovable and there is no unlocked segment
 * between them to absorb the space. Every other lock is grantable, because
 * some neighbour is still free to move — however large the discontinuity.
 *
 * Returns `null` when the lock is fine, or the conflict when it is not. The
 * caller refuses the toggle and names the conflicting segment. Locks stay
 * unconditionally HONOURED, at the price of being conditionally GRANTABLE —
 * the trade the ruling document flagged at §5.2 and which ruling point 1's
 * "always" forces. Resolutions (b) "let the earlier lock's slot grow" and
 * (c) "permit a gap between two locks" are both explicitly rejected there.
 *
 * Unlocking is never refused: removing a wall can only ever make the
 * partition MORE satisfiable, so callers do not consult this to unlock.
 */
export function canLockSegment(
  segments: Pick<VideoSegment, 'id' | 'startTime' | 'duration' | 'locked'>[],
  index: number,
): LockRefusal | null {
  const seg = segments[index];
  if (!seg) return null;

  const prev = segments[index - 1];
  if (prev?.locked) {
    const delta = round3(seg.startTime - (prev.startTime + prev.duration));
    if (Math.abs(delta) > PARTITION_EPSILON_SEC) {
      return { conflictIndex: index - 1, conflictSegmentId: prev.id, amountSec: Math.abs(delta) };
    }
  }

  const next = segments[index + 1];
  if (next?.locked) {
    const delta = round3(next.startTime - (seg.startTime + seg.duration));
    if (Math.abs(delta) > PARTITION_EPSILON_SEC) {
      return { conflictIndex: index + 1, conflictSegmentId: next.id, amountSec: Math.abs(delta) };
    }
  }

  return null;
}
