/**
 * Lock conflict on undo/redo — BLOCK the traversal (Phase 3, 2026-08-08).
 *
 * Owner ruling, design §5.1: if travelling to a stored state would move a
 * segment the user has explicitly LOCKED, do not travel. Leave history untouched,
 * scroll to the locked segment, and say "Unlock to undo this change".
 *
 * WHY THE OBVIOUS ALTERNATIVE IS NOT BUILDABLE, since it will be proposed again:
 * "restore everything except the locked segment" cannot be done in either
 * representation.
 *
 *  - Under SNAPSHOTS there is nothing to skip. A stored entry is a whole
 *    `Project`; the locked segment's older value is simply part of it. Holding
 *    that one segment at its newer value while its neighbours go back to older
 *    ones breaks `startTime[i] + duration[i] === startTime[i+1]` by construction —
 *    the DEV gapless assertion would fire on our own write, and export's
 *    `checkTimelineIsGapless` would refuse the project.
 *  - Under PATCHES it is worse: applying a subset of inverses out of order yields
 *    a state no version of the pipeline ever produced, with no invariant holding.
 *
 * Blocking is the only option that keeps every reachable state one the pipeline
 * actually committed, which is the property the whole snapshot design rests on.
 *
 * WHY "LOCKED IN CURRENT STATE", NOT "LOCKED IN THE ENTRY". A lock is a statement
 * about the timeline as it stands NOW ("do not move this"), so the question is
 * whether the segment is locked now — not whether it happened to be locked at
 * some earlier point in history. This also makes the check stable under redo: the
 * same pair of states blocks in both directions.
 *
 * PURE, and separated from `App.tsx` so the decision can be swept by unit test.
 * It compares by segment id, which is sound because segment identity is stable
 * across history (design R2.2 — every edit is an identity-preserving `.map`;
 * Apply Sync is the sole exception, and it mints an entirely new id set, so no id
 * appears on both sides of that boundary and nothing can be falsely matched).
 */

import type { VideoSegment } from '../types';

/** How much a timing value may differ before it counts as "moved". */
const MOVE_EPSILON_SEC = 1e-9;

export interface LockConflict {
  /** The locked segment that blocks the traversal. */
  segmentId: string;
  /** Its 0-based index in CURRENT state, for the "segment N" message. */
  index: number;
  /** How many locked segments would move in total (the message names the first). */
  count: number;
}

function moved(a: VideoSegment, b: VideoSegment): boolean {
  return Math.abs(a.startTime - b.startTime) > MOVE_EPSILON_SEC
    || Math.abs(a.duration - b.duration) > MOVE_EPSILON_SEC;
}

/**
 * Returns the conflict that should block travelling from `current` to `target`,
 * or `null` if the traversal may proceed.
 *
 * Only TIMING is considered — `startTime` and `duration`. A lock in this app
 * means "this segment's position on the timeline is pinned"
 * (`computeDragCascade`'s wall, `applyAnchorBasedTiming`'s hard wall,
 * `canLockSegment`'s refusal all treat it that way). It has never meant "none of
 * this segment's other fields may change", so undoing a grade or an overlay-text
 * edit on a locked segment is correctly allowed — blocking that would make the
 * lock a general-purpose freeze it has never been anywhere else in the pipeline.
 *
 * A segment that exists in `current` but not in `target` (or vice versa) is NOT a
 * conflict: that is the Apply Sync boundary, where the whole id set changes, and
 * refusing to undo an Apply Sync because some locked segment "disappeared" would
 * make the single most valuable undo in the app permanently unreachable.
 */
export function findLockConflict(
  current: readonly VideoSegment[],
  target: readonly VideoSegment[],
): LockConflict | null {
  const byId = new Map(target.map(s => [s.id, s]));
  let first: LockConflict | null = null;
  let count = 0;
  for (let i = 0; i < current.length; i++) {
    const cur = current[i]!;
    if (!cur.locked) continue;
    const tgt = byId.get(cur.id);
    if (!tgt) continue; // absent from the target: an Apply Sync boundary, not a conflict
    if (!moved(cur, tgt)) continue;
    count++;
    if (!first) first = { segmentId: cur.id, index: i, count: 0 };
  }
  return first ? { ...first, count } : null;
}

/**
 * The user-facing message. Exported so the toast text is asserted by test rather
 * than duplicated as a string literal at the call site — the owner specified this
 * wording, so it should not drift silently.
 */
export function lockConflictMessage(conflict: LockConflict): string {
  const extra = conflict.count > 1 ? ` (+${conflict.count - 1} more locked)` : '';
  return `Segment ${conflict.index + 1} is locked. Unlock to undo this change.${extra}`;
}
