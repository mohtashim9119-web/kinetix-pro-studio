/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// THE GAPLESS PARTITION — Model P's single enforcement point
// ---------------------------------------------------------------------------
//
// OWNER RULING (2026-08-07, docs/segments-invariant-ruling.md → Model P):
//
//   1. Strict gapless invariant: `segment[N].end === segment[N+1].start`, always.
//      No unassigned space on the timeline, ever.
//   2. 50/50 silence: the silence between two speech events splits equally
//      between the preceding segment's trailing silence and the following
//      segment's leading silence. (That rule lives in `snapBoundaries.ts` — it
//      decides DURATIONS. This file decides POSITIONS.)
//   3. Locks override everything: an explicitly locked boundary is a hard wall.
//   4. Export integrity: A/V sync 1:1, headings never dropped or truncated.
//
// WHY ONE FILE. Before this, SIX writers each enforced (or silently broke) the
// invariant on their own: `recomputeStartTimes`/`restackWindow` (dragCascade.ts),
// `applyAnchorBasedTiming` PASS 1/PASS 3 (syncEngine.ts), `headExtendFirstSegment`
// (syncEngine.ts), `snapCoveredBoundaries`'s appended contiguity fix and its
// tail extension (snapBoundaries.ts), and the live drag preview (App.tsx).
// The ruling document's §1.1 table shows the answer they gave flipping five
// times across the codebase's history, never once as a recorded decision. This
// file replaces every one of those with a single constructor, and each of them
// is deleted at the same commit rather than left as dead enforcement.
//
// THE CONTRACT, stated so producers can be checked against it:
//
//   * `enforceGaplessPartition` is the ONLY writer of `startTime` (and, per K14's
//     INVARIANT L2, of `anchorStart` in lockstep with it) outside a lock.
//   * It preserves each segment's `duration` and derives `startTime` as the
//     running prefix sum from 0. `startTime` is a DERIVED CACHE of that sum,
//     never an independent fact — which is precisely what makes K14's whole
//     stale-anchor defect family unrepresentable.
//   * Therefore every PRODUCER must express its intent as DURATIONS. A producer
//     that wants a boundary at time B gives the preceding segment the duration
//     that lands its end there. `applyAnchorBasedTiming` (anchors → durations),
//     `snapCoveredBoundaries` (50/50 boundaries → durations), `computeDragCascade`
//     (gesture → durations) and `retileCoveredSegments` (next survivor's start →
//     durations) all now do exactly that, and hand the positioning here.
//
// THE TWO EXCEPTIONS, both explicit, both at the ends of the array:
//
//   * HEAD RULE. An unlocked first segment is stretched back to `startTime 0`,
//     its END held fixed (its duration grows by exactly the lead-in it used to
//     leave uncovered). This IS `headExtendFirstSegment`, promoted here — the
//     head is timeline space like any other, and leaving it unassigned is a gap
//     by ruling point 1.
//   * TAIL RULE. When `audioDuration` is supplied, an unlocked last segment ends
//     exactly at it. The audio is the source of truth for total length; this is
//     what keeps `Σ duration === audioDuration` (CLAUDE.md Key Invariant (b))
//     true by construction rather than by three separate call sites agreeing.
//
// WHERE THE INVARIANT AND THE LOCKS GENUINELY COLLIDE (ruling §4.1). A lock is
// a hard wall (point 3) and the timeline is gapless (point 1). Those are not
// simultaneously satisfiable in exactly three shapes, and this file NEVER
// resolves them by moving a lock:
//
//   * `head-locked`       — segment 0 is locked and starts after 0.
//   * `tail-locked`       — the last segment is locked and ends before the audio.
//   * `lock-lock-gap`     — two ADJACENT locked segments with space between them.
//
// In all three the space stays unassigned and a `PartitionViolation` is
// reported. It is never patched silently, because patching it means moving a
// lock. The UI closes the loop from the other side: `canLockSegment` below is
// what `App.tsx`'s lock toggle consults, so a user can never CREATE a
// `lock-lock-gap` through the interface (ruling §4.1(a) — refuse the lock, name
// the conflict). The reporting therefore exists for projects persisted before
// this rule, and as the loud failure the ruling document asked for instead of a
// silent one.
//
// Any other discontinuity — the ordinary case, an unlocked segment on at least
// one side — is CLOSED here, by giving the space to the neighbour that is
// allowed to move. That is ruling §4.1's fill rule and the same operation
// `headExtendFirstSegment` and decision 8 / Option A already applied twice in
// this pipeline: absorbing silence is normal, and the segment that absorbs it
// does not move its own words.
//
// Pure. No I/O, no DOM, no React — same worker-safe discipline as
// `resolutionConfig.ts`/`zoomScale.ts`, so the export worker could import it.
// ---------------------------------------------------------------------------

import type { VideoSegment } from '../types';

/**
 * Slack for every partition comparison. Every `startTime`/`duration` in this
 * pipeline is rounded to 3 decimals (`Number(v.toFixed(3))`), so two values
 * that are equal in intent can differ by up to half a millisecond of
 * representation. 1.5ms is comfortably above that and far below
 * `MIN_SEGMENT_DURATION`, so it can never mask a real gap.
 */
export const PARTITION_EPSILON_SEC = 0.0015;

/** Shared floor with the rest of the timing pipeline. A partition may never
 *  emit a zero/negative span, even when a lock squeezes a neighbour. */
const MIN_SEGMENT_DURATION = 0.1;

/** The pipeline's uniform 3-decimal rounding. */
function round3(v: number): number {
  return Number(v.toFixed(3));
}

export type PartitionViolationKind =
  /** Segment 0 is locked and starts after t=0 — the head cannot be covered
   *  without moving the lock. */
  | 'head-locked'
  /** The last segment is locked and ends before `audioDuration` — the tail
   *  cannot be covered without moving the lock. */
  | 'tail-locked'
  /** Two ADJACENT locked segments with space between them. Ruling §4.1's
   *  unsatisfiable case; `canLockSegment` prevents the user reaching it. */
  | 'lock-lock-gap'
  /** Two ADJACENT locked segments that overlap. Illegal under both models;
   *  only reachable from data persisted before this rule existed. */
  | 'lock-lock-overlap';

export interface PartitionViolation {
  kind: PartitionViolationKind;
  /** Index of the LOCKED segment the violation is measured against. */
  index: number;
  segmentId: string;
  /** Size of the unassignable (or doubly-assigned) span, seconds. */
  amountSec: number;
}

/**
 * Positions `segments` as a gapless partition of `[0, audioDuration]`.
 *
 * Durations are authoritative and are preserved, except where the head rule,
 * the tail rule, or a lock forces a neighbour to absorb space — see this file's
 * header for all three, stated in full.
 *
 * `audioDuration` is optional: omit it on paths that have no audio length in
 * hand (the drag path, for instance, must not re-stretch the last segment
 * mid-gesture) and the tail rule simply does not run.
 *
 * `onViolation` receives every unsatisfiable lock case. Omitting it discards
 * them — the returned array is identical either way, because a violation is by
 * definition a span this function refused to reassign.
 *
 * Pure: the input array and its segments are never mutated.
 */
export function enforceGaplessPartition(
  segments: VideoSegment[],
  audioDuration?: number,
  onViolation?: (v: PartitionViolation) => void,
): VideoSegment[] {
  if (segments.length === 0) return segments;

  const out: VideoSegment[] = segments.map(s => ({ ...s }));

  // --- HEAD RULE (was `headExtendFirstSegment`, syncEngine.ts) --------------
  // Applied before the walk so the walk's cursor starts at a real 0. The END is
  // held fixed, which is the whole point: narration still begins where it
  // begins; segment 1 simply also owns the lead-in silence in front of it.
  const first = out[0]!;
  if (!first.locked && first.startTime > PARTITION_EPSILON_SEC) {
    first.duration = round3(first.duration + first.startTime);
    first.startTime = 0;
    first.anchorStart = 0;
  } else if (first.locked && first.startTime > PARTITION_EPSILON_SEC) {
    onViolation?.({
      kind: 'head-locked',
      index: 0,
      segmentId: first.id,
      amountSec: round3(first.startTime),
    });
  }

  // --- POSITIONING WALK ----------------------------------------------------
  // `cursor` is the exact end of everything already placed — i.e. the prefix
  // sum. An unlocked segment starts there, full stop. A locked segment keeps
  // its own start, and whatever distance the cursor has to travel to reach it
  // is charged to the unlocked neighbour behind it (or reported, if that
  // neighbour is itself locked).
  let cursor = 0;
  for (let i = 0; i < out.length; i++) {
    const seg = out[i]!;

    if (!seg.locked) {
      // ---- §4.1's FILL RULE, the one place duration is not preserved -------
      // A segment whose predecessor is LOCKED inherits whatever that hard wall
      // left over, and absorbs it as LEADING SILENCE: its own END is held
      // fixed and its duration grows (or shrinks, if the wall overran into it).
      //
      // This is the ruling's answer to "what fills the shortfall" —
      // "the following segment starts early, at the lock's actual end, and
      // absorbs the space. Its own first word does not move; it simply acquires
      // leading silence." Preserving DURATION here instead would slide the
      // segment's whole slot earlier by the shortfall, moving it off its own
      // audio — which is exactly the 3.000s displacement K15a was reported for,
      // arriving by a different route.
      //
      // Only after a LOCK, deliberately. Everywhere else the predecessor was
      // itself placed at the cursor, so there is no discontinuity to absorb and
      // duration is authoritative — which is what keeps the drag path (whose
      // whole intent IS a duration) untouched by this rule.
      const prev = i > 0 ? out[i - 1] : undefined;
      if (prev?.locked) {
        const ownEnd = seg.startTime + seg.duration;
        const delta = round3(ownEnd - cursor);
        if (Math.abs(round3(seg.startTime - cursor)) > PARTITION_EPSILON_SEC) {
          seg.duration = round3(Math.max(MIN_SEGMENT_DURATION, delta));
        }
      }
      seg.startTime = round3(cursor);
      seg.anchorStart = seg.startTime;
      cursor = round3(cursor + seg.duration);
      continue;
    }

    // Locked: a hard wall. `startTime` and `duration` are read-only here, and
    // `anchorStart` is forced to mirror `startTime` (K14 INVARIANT L2) so no
    // later pass can re-derive a position from a separately-stale anchor.
    seg.anchorStart = seg.startTime;

    const delta = round3(seg.startTime - cursor);
    if (Math.abs(delta) > PARTITION_EPSILON_SEC) {
      const prev = i > 0 ? out[i - 1]! : undefined;
      if (!prev) {
        // i === 0 with a non-zero start — already reported by the head rule.
      } else if (prev.locked) {
        onViolation?.({
          kind: delta > 0 ? 'lock-lock-gap' : 'lock-lock-overlap',
          index: i,
          segmentId: seg.id,
          amountSec: Math.abs(delta),
        });
      } else {
        // The unlocked neighbour behind the wall absorbs the difference — it
        // grows into a shortfall, or gives back an overrun. Its own START does
        // not move (it was already placed at the cursor), so this cannot ripple
        // backwards; only its end travels to meet the lock.
        const adjusted = round3(prev.duration + delta);
        if (adjusted < MIN_SEGMENT_DURATION) {
          // The lock has squeezed its neighbour past the floor. Honour the
          // floor (a zero/negative span is not renderable) and report what is
          // left over as a lock-lock overlap against the wall itself.
          prev.duration = MIN_SEGMENT_DURATION;
          onViolation?.({
            kind: 'lock-lock-overlap',
            index: i,
            segmentId: seg.id,
            amountSec: round3(MIN_SEGMENT_DURATION - adjusted),
          });
        } else {
          prev.duration = adjusted;
        }
      }
    }

    cursor = round3(seg.startTime + seg.duration);
  }

  // --- TAIL RULE (was applyAnchorBasedTiming PASS 3 + snapCoveredBoundaries'
  //     last-survivor extension) -------------------------------------------
  if (audioDuration !== undefined && audioDuration > 0) {
    const last = out[out.length - 1]!;
    if (!last.locked) {
      last.duration = round3(Math.max(MIN_SEGMENT_DURATION, audioDuration - last.startTime));
    } else {
      const end = round3(last.startTime + last.duration);
      if (Math.abs(end - audioDuration) > PARTITION_EPSILON_SEC) {
        onViolation?.({
          kind: 'tail-locked',
          index: out.length - 1,
          segmentId: last.id,
          amountSec: round3(Math.abs(audioDuration - end)),
        });
      }
    }
  }

  return out;
}

/**
 * Read-only checker: every place `segments` fails to be a gapless partition of
 * `[0, audioDuration]`.
 *
 * Deliberately NOT implemented by running `enforceGaplessPartition` and diffing
 * — this walks the array as given and reports what it finds, so a test that
 * asserts the constructor's output is clean is not just asserting the
 * constructor against itself. Used by the dev-time assertion in `App.tsx`, by
 * the export regression harness, and by the golden-diff audit.
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
  /** The span that would become unassignable, seconds. */
  amountSec: number;
}

/**
 * Ruling §4.1(a) — may `segments[index]` be locked without making the gapless
 * invariant unsatisfiable?
 *
 * The one shape that cannot be satisfied is two ADJACENT locks with space
 * between them: both are declared immovable, and there is no unlocked segment
 * in between to absorb the space. Every other lock is grantable, because some
 * neighbour is still free to move.
 *
 * Returns `null` when the lock is fine, or the conflict when it is not. The
 * caller refuses the toggle and names the conflicting segment — locks stay
 * unconditionally honoured, at the price of being conditionally *grantable*,
 * which is the trade the ruling document flagged at §5.2 and which point 1's
 * "always" forces.
 *
 * Unlocking is never refused: removing a wall can only ever make the partition
 * more satisfiable, so callers do not consult this on the unlock direction.
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
