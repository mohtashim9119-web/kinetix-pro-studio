/**
 * Timeline drag-resize cascade — the pure timing half of a segment-boundary
 * drag, extracted out of `App.tsx` (K15) so it can be unit-tested directly.
 *
 * `computeDragCascade` is the ONLY writer of segment timing on the drag path;
 * `App.tsx`'s `applyDurationChange` is a thin wrapper that resolves the dragged
 * index, forwards the project's transcript tokens, and commits the result.
 *
 * ---------------------------------------------------------------------------
 * K15 — the two defects this file's current shape exists to close
 * ---------------------------------------------------------------------------
 *
 * **K15a — gap collapse (catastrophic, K14-introduced).** The pre-K15 cascade
 * ended by calling a module-private `recomputeStartTimes(segs)` that rebuilt
 * EVERY segment's `startTime` from a running sum of durations starting at 0 —
 * a flexbox-style global re-flow. That silently deletes any gap anywhere in the
 * array, including gaps nowhere near the drag. Before K14 that was harmless
 * because no upstream stage could produce a gap: `applyAnchorBasedTiming`'s
 * then-current locked branch GREW a locked segment to fill any span that opened
 * after it (`duration = max(preservedDuration, availableSpan)`), so its output
 * was contiguous by construction. K14 withdrew that growth exemption to make a
 * lock a hard wall in both directions, so a locked segment whose end falls
 * before the following segment's anchor now leaves a REAL gap
 * (`syncEngine.ts`'s `effectiveStart = max(rawAnchor, lockFloor)`). From that
 * point on, ANY drag anywhere in the timeline collapsed that gap and pulled
 * every following segment backwards by its full width — measured at 3.000s of
 * displacement for a 0.200s drag, which moves a segment's slot completely off
 * its own audio. It fired even when the drag had no neighbour to cascade into
 * at all (dragging the last segment), because the re-flow was unconditional.
 *
 * The fix: the cascade is now STRICTLY LOCAL. Only the contiguous window the
 * cascade actually touched is restacked, anchored on whichever edge of that
 * window the drag does not move. Every segment outside the window keeps its
 * `startTime` byte-identical, so a gap outside the window survives. This mirrors
 * the locality rule K14 already established for `applyAnchorBasedTiming`
 * ("DELIBERATELY LOCAL, never propagated through a running cursor").
 *
 * **K15b — unbounded neighbour absorption (predates K14).** The cascade floored
 * an absorbing neighbour at `MIN_SEGMENT_DURATION` (0.3s) and nothing else, so
 * a neighbour could be crushed from several seconds to 0.3s and lose every word
 * it owns. That floor is original, not K14's — but K14 removed
 * auto-lock-on-drag, which had been acting as an accidental one-shot circuit
 * breaker: pre-K14 the cascade wrote `locked: true` onto every absorbing
 * neighbour, so a SECOND drag into the same neighbour hit the locked-neighbour
 * guard and was refused with a toast. Post-K14 nothing stops the user repeating
 * the drag until the neighbour bottoms out. Decision 9 point 1 forbids
 * restoring auto-lock, so the bound has to be a real one — see
 * `neighbourYieldableSec` below.
 */

import type { TranscriptToken, VideoSegment } from '../types';

/** Minimum timeline slot width, seconds. Moved here from `App.tsx` (K15) so the
 *  cascade and its callers read one constant; `App.tsx` imports it back. */
export const MIN_SEGMENT_DURATION = 0.3;

/** Duration comparisons below this are treated as zero — matches the 0.001s
 *  granularity every `startTime`/`duration` in this pipeline is rounded to. */
const EPSILON_SEC = 0.001;

/** Which end of an absorbing neighbour the drag moves. A right-edge drag grows
 *  the dragged segment forward, pushing the NEXT segment's start later — that
 *  neighbour yields from its HEAD. A left-edge drag grows it backward, pulling
 *  the PREVIOUS segment's end earlier — that neighbour yields from its TAIL. */
export type YieldSide = 'head' | 'tail';

function isUsableToken(t: TranscriptToken): boolean {
  return Number.isFinite(t.startSec) && Number.isFinite(t.endSec) && t.endSec > t.startSec;
}

/**
 * How many seconds a neighbour may give up on `yieldSide` before the drag would
 * strip that neighbour of the last of its own words — the K15b bound, as
 * re-derived by the 2026-08-08 manual triage (failure F1).
 *
 * **The floor, stated plainly: a neighbour's slot may never be moved past its
 * own INNERMOST word.** A head-yielding neighbour's start may not pass its own
 * LAST word's onset; a tail-yielding neighbour's end may not fall below its own
 * FIRST word's offset. Either way the neighbour is guaranteed to keep at least
 * one of its own words, which is precisely the harm K15b was written to prevent:
 * "a neighbour could be crushed from several seconds to 0.3s and **lose every
 * word it owns**."
 *
 * ---------------------------------------------------------------------------
 * F1 — why this is the innermost word and not, as originally written, the
 * outermost one
 * ---------------------------------------------------------------------------
 *
 * K15b's first formulation bounded the yield at the neighbour's leading (or
 * trailing) SILENCE — its start could not pass its own FIRST word. That reads
 * well in the abstract and is wrong in practice, because of where the boundary
 * it measures from actually sits. `snapCoveredBoundaries` places a boundary at
 * the CENTRE of the silence between two segments, so a neighbour's leading
 * silence is only ever about half an inter-word gap: measured on the triage
 * fixture, 0.15s. That was the entire outward-drag budget for the whole
 * gesture, and at a zoomed-out 30 px/s it is four and a half screen pixels —
 * the manual tester's report was, verbatim, that an outward drag "stalls after
 * a few px" while an inward one worked normally. (Inward is unaffected: a
 * shrink makes the neighbour GROW, which this bound never governed.)
 *
 * The two requirements in tension are both real and both owner-stated: K15b's
 * "a drag must not silently strip a neighbour of its words" and the drag
 * checklist's step 1, "the dragged edge tracks the pointer with no visible lag
 * or snap". Bounding at the innermost word satisfies both — the neighbour can
 * never be emptied, and an ordinary boundary correction of a few hundred
 * milliseconds to a couple of seconds is no longer refused. It also degrades
 * correctly at the limit: for a neighbour holding exactly ONE word the
 * innermost and outermost word are the same word, so the bound collapses back
 * to the original silence-only budget, which is the right answer there — any
 * further yield would push that segment's only word out of its own slot.
 *
 * **Where the floor comes from:** the project's own `transcriptTokens` — the
 * same word-level array the aligner and `snapBoundaries.ts` place every boundary
 * against. Nothing new is measured or inferred here. A token belongs to this
 * neighbour when its MIDPOINT falls inside the neighbour's slot; midpoint
 * (rather than onset, or any-overlap) is chosen because a word straddling a slot
 * edge then counts as the neighbour it is mostly inside, and the straddled edge
 * yields nothing — the conservative answer at exactly the place this bound
 * matters.
 *
 * **Returns `Infinity`** when there is no word to protect: no tokens at all (no
 * voiceover yet, or a project whose transcript was never persisted) or no token
 * owned by this neighbour (a zero-token segment — an unscripted heading, or a
 * scene the aligner skipped). `Infinity` makes the caller's bound a no-op, which
 * is deliberate: those cases fall through to the pre-K15 `MIN_SEGMENT_DURATION`
 * clamp byte-for-byte, because inventing a larger floor for a segment with no
 * words would only refuse drags the user is entitled to make.
 *
 * This is a POSITION bound expressed as an amount, not a duration floor. A
 * duration floor is only equivalent while the neighbour's other edge is pinned,
 * and it is not: when the cascade runs on past this neighbour, its far edge
 * moves too. Computing `slotEnd - firstWordOnset` as a minimum duration was
 * tried first and is wrong for exactly that reason — it let a two-neighbour
 * cascade push a neighbour's start past its own first word while its duration
 * still satisfied the floor.
 */
export function neighbourYieldableSec(
  neighbour: Pick<VideoSegment, 'startTime' | 'duration'>,
  yieldSide: YieldSide,
  tokens: TranscriptToken[] | undefined,
): number {
  if (!tokens || tokens.length === 0) return Infinity;

  const slotStart = neighbour.startTime;
  const slotEnd = neighbour.startTime + neighbour.duration;

  // The INNERMOST owned word as seen from each yielding edge: for a head yield
  // that is the last word's onset, for a tail yield the first word's offset.
  // On a single-word neighbour these are that one word's own two edges, so the
  // bound degrades to the leading/trailing silence — see this function's header.
  let lastOwnedStart = -Infinity;
  let firstOwnedEnd = Infinity;
  let owns = false;
  for (const t of tokens) {
    if (!isUsableToken(t)) continue;
    const mid = (t.startSec + t.endSec) / 2;
    if (mid < slotStart || mid >= slotEnd) continue;
    owns = true;
    if (t.startSec > lastOwnedStart) lastOwnedStart = t.startSec;
    if (t.endSec < firstOwnedEnd) firstOwnedEnd = t.endSec;
  }
  if (!owns) return Infinity;

  const yieldable = yieldSide === 'head'
    ? lastOwnedStart - slotStart
    : slotEnd - firstOwnedEnd;
  // Never negative: a word already straddling the yielding edge means there is
  // nothing there to take, so the neighbour yields nothing.
  return Math.max(0, yieldable);
}

/**
 * Rewrites `startTime` (and, per K14's INVARIANT L2, `anchorStart` in lockstep
 * with it) for the inclusive index window `[lo, hi]` ONLY, restacking those
 * segments contiguously from `segs[lo]`'s own existing `startTime`.
 *
 * `segs[lo].startTime` is by construction the edge the drag does not move — the
 * dragged segment's own start on a right-edge drag, or the far end of the
 * cascade on a left-edge drag — so the window is anchored to a fixed point and
 * nothing outside it needs to move. Segments outside `[lo, hi]` are returned
 * untouched, which is what preserves a pre-existing gap (K15a).
 */
function restackWindow(segs: VideoSegment[], lo: number, hi: number): VideoSegment[] {
  let acc = segs[lo]?.startTime ?? 0;
  return segs.map((s, i) => {
    if (i < lo || i > hi) return s;
    const t = Number(acc.toFixed(3));
    acc += s.duration;
    return { ...s, startTime: t, anchorStart: t };
  });
}

/**
 * Applies a drag-resize delta to `originalSegments`, cascading overflow into
 * neighbours.
 *
 * K14 (decision 9 point 1) — dragging locks NOTHING. Neither the dragged
 * segment nor any absorbing neighbour is auto-locked. An ALREADY-locked
 * neighbour is still an impassable wall the cascade refuses to move through;
 * that check is unrelated to auto-locking and is unchanged.
 *
 * K15 — the cascade is bounded and local, per this file's header: no neighbour
 * is pushed past its own outermost word, and only the touched window is
 * restacked.
 *
 * Returns the updated array, or null if a locked neighbour blocked the cascade
 * (caller reverts the live-preview state and shows a toast).
 */
export function computeDragCascade(
  originalSegments: VideoSegment[],
  draggedIdx: number,
  finalDuration: number,
  finalTrimStart: number,
  direction: 'right' | 'left',
  onLockedBlock: (segIndex: number, segId: string) => void,
  tokens?: TranscriptToken[],
): VideoSegment[] | null {
  const segs = originalSegments.map(s => ({ ...s }));
  const dragged = segs[draggedIdx];
  if (!dragged) return null;
  // F5 (2026-08-08 manual triage) — the DRAGGED segment's own lock is a wall
  // too. Until now only an absorbing NEIGHBOUR's lock was checked, so a locked
  // segment could be freely resized by grabbing its own edge: the one gesture
  // that most obviously has to be refused. Owner decision 9 and the Model P
  // lock rework both state a locked segment is an immovable anchor, and the
  // rest of the pipeline (`applyAnchorBasedTiming`'s hard wall, the
  // lock-shortfall refusal) is built on that holding everywhere.
  //
  // Placed here rather than in `dragSession.ts` deliberately: this function is
  // the single writer of segment timing on the drag path, so one check covers
  // the live preview (`resolveDragPreview` → null → original array, the card
  // visibly does not move), the pointerup commit (`applyDurationChange` →
  // false → revert), and the playback-speed slider, which reaches the same
  // cascade. A guard in the session would have covered only the first two.
  if (dragged.locked) {
    onLockedBlock(draggedIdx, dragged.id);
    return null;
  }
  segs[draggedIdx] = { ...dragged, duration: finalDuration, trimStart: finalTrimStart };
  const delta = finalDuration - (originalSegments[draggedIdx]?.duration ?? finalDuration);
  let remaining = -delta; // positive → neighbour must grow; negative → neighbour must shrink
  const step = direction === 'right' ? 1 : -1;
  const yieldSide: YieldSide = direction === 'right' ? 'head' : 'tail';
  let ni = draggedIdx + step;
  // Highest/lowest index whose duration this cascade actually rewrote. Seeded to
  // the dragged segment so a drag that absorbs nothing still restacks (only) itself.
  let lastTouched = draggedIdx;
  // Shrink demand that the K15b word bound refused to let any neighbour absorb.
  let refused = 0;

  while (Math.abs(remaining) > EPSILON_SEC) {
    if (ni < 0 || ni >= segs.length) break;
    const neighbor = segs[ni]!;
    if (neighbor.locked) {
      onLockedBlock(ni, neighbor.id);
      return null;
    }

    if (remaining > 0) {
      // Neighbour GROWS to take back time the dragged segment gave up. There is
      // no upper bound to enforce and never was — the first neighbour absorbs
      // all of it, exactly as pre-K15.
      segs[ni] = { ...neighbor, duration: neighbor.duration + remaining };
      remaining = 0;
      lastTouched = ni;
      break;
    }

    // Neighbour must SHRINK. `-remaining` is precisely the distance this
    // neighbour's yielding edge is being asked to move, so it is the quantity
    // the K15b bound applies to directly.
    const yieldable = neighbourYieldableSec(originalSegments[ni]!, yieldSide, tokens);
    if (-remaining > yieldable) {
      refused += -remaining - yieldable;
      remaining = -yieldable;
      if (Math.abs(remaining) <= EPSILON_SEC) break;
    }
    // Below the word bound, the pre-K15 MIN_SEGMENT_DURATION clamp still governs
    // how much this neighbour can give before the overflow passes on — that path
    // is unchanged, and is the whole behaviour when `yieldable` is Infinity.
    const slack = Math.max(0, neighbor.duration - MIN_SEGMENT_DURATION);
    const take = Math.min(-remaining, slack);
    segs[ni] = { ...neighbor, duration: neighbor.duration - take };
    remaining += take;
    lastTouched = ni;
    ni += step;
  }

  // K15b — the shrink the word bound refused is handed BACK to the dragged
  // segment rather than dropped. Dropping it is what let a drag take time no
  // neighbour ever gave up: total duration of the touched window would change,
  // and the restack below would have had to push that difference into a
  // segment the drag never touched. Giving it back conserves the window's total
  // exactly, so the drag simply stops where the neighbour's words begin — the
  // CapCut/Premiere behaviour. Bounded by construction: `refused` can never
  // exceed the original delta, so the dragged segment is never pushed below the
  // duration it started the drag with.
  //
  // The separate case of `remaining` still being non-zero because the cascade
  // ran off the end of the array is deliberately left as it was pre-K15 — that
  // is not over-absorption, and changing it would move unrelated behaviour into
  // this fix.
  if (refused > EPSILON_SEC) {
    const cur = segs[draggedIdx]!;
    segs[draggedIdx] = {
      ...cur,
      duration: Number(Math.max(MIN_SEGMENT_DURATION, cur.duration - refused).toFixed(3)),
    };
  }

  const lo = Math.min(draggedIdx, lastTouched);
  const hi = Math.max(draggedIdx, lastTouched);

  // MODEL P (2026-08-07, compliance backlog item 2) — the touched window's
  // total duration must be CONSERVED whenever a segment follows it.
  //
  // `restackWindow` anchors on `segs[lo].startTime` and leaves everything
  // outside `[lo, hi]` untouched. So if the window's total length changes,
  // `segs[hi]`'s end moves while `segs[hi + 1]`'s start does not — a gap or an
  // overlap, exactly the adjacency violation Model P forbids.
  //
  // That is reachable today, and not theoretically: the cascade loop breaks
  // when it runs off the array (`ni < 0`), leaving `remaining` unabsorbed. The
  // live case is a LEFT-edge drag on segment 0 — the timeline head, which has
  // no predecessor to trade with, and whose left handle the Timeline renders
  // like any other. Measured before this fix: a -0.7s left drag on segment 0
  // left a 0.700s hole in front of segment 1, and a large grow produced a
  // 40.000s overlap.
  //
  // Handing `remaining` back to the dragged segment conserves the window
  // exactly, so the drag simply stops where there is nothing left to trade
  // with — the same "refuse what no neighbour gave up" rule K15b already
  // applies to its word-onset floor, and the same CapCut/Premiere feel.
  //
  // Scoped deliberately to `hi < segs.length - 1`. When the window ends at the
  // LAST segment there is no following segment to be disjoint from, so no
  // adjacency is broken and the pre-K15 off-the-end behaviour (explicitly
  // preserved above, and pinned by this file's own last-segment test) is left
  // exactly as it was. Model P's separate tail clause — the last segment ends
  // at `audioDuration` — cannot be enforced here in any case: this function is
  // not given the audio length, by design, so that a drag never re-stretches
  // the timeline mid-gesture.
  if (Math.abs(remaining) > EPSILON_SEC && hi < segs.length - 1) {
    const cur = segs[draggedIdx]!;
    segs[draggedIdx] = {
      ...cur,
      duration: Number(Math.max(MIN_SEGMENT_DURATION, cur.duration + remaining).toFixed(3)),
    };
  }

  return restackWindow(segs, lo, hi);
}

/**
 * A drag whose resolved duration differs from the segment's own by less than
 * this is treated as no drag at all: the gesture is a click, or a jitter, and
 * both the live preview and the commit leave the array untouched.
 *
 * Exported so `App.tsx`'s pointerup path and `resolveDragPreview` below read
 * ONE threshold. They used to hold two independent copies of `0.01`, which is
 * the same drift risk `resolveDragEdge` (services/dragGeometry.ts) was created
 * to remove on the geometry side.
 */
export const NEGLIGIBLE_DRAG_SEC = 0.01;

/**
 * K17 — the array the timeline must DRAW for an in-progress drag.
 *
 * The live preview and the pointerup commit have to answer one question
 * identically: given this pointer position, what does the whole segment array
 * become? Before K17 they did not even ask the same question. The preview wrote
 * `left`/`width` for the DRAGGED CARD ONLY and left every neighbour frozen at
 * its pre-drag geometry, while the commit ran `computeDragCascade` and moved
 * the neighbours too. Three consequences, all visible:
 *
 *   1. **Overlap.** Growing a segment's end pushed its right edge straight
 *      through the frozen next card. Under the timeline's pre-2026-07-31
 *      flexbox layout this was unrepresentable — a card's left edge WAS the sum
 *      of its predecessors' widths, so neighbours were shoved along by the
 *      browser for free. Absolute positioning (each card at its own
 *      `startTime`) removed that accidental coupling and exposed the defect;
 *      it did not introduce it. Overlap is illegal under BOTH candidate models
 *      of `segments` (docs/segments-invariant-ruling.md §0), so this needs no
 *      ruling to fix.
 *   2. **A jump on release.** Every neighbour the cascade moved snapped from
 *      its frozen position to its committed one the instant the pointer came
 *      up. What the user saw during the gesture was never what they got.
 *   3. **A dragged card that lied about its own size.** K15b's word-bound
 *      giveback can hand refused shrink back to the dragged segment, so its
 *      committed duration is smaller than the raw pointer geometry asked for.
 *      The preview drew the raw value and the commit wrote the bounded one.
 *
 * The fix is to make the preview render this function's output, and to make
 * the commit path resolve through the same call. It is deliberately NOT a
 * second, preview-flavoured copy of the cascade rules — it is `computeDragCascade`
 * plus the two fallbacks the commit path already applied, so the preview cannot
 * drift from the commit without `computeDragCascade` itself changing.
 *
 * Returns `originalSegments` UNCHANGED in the two cases the commit also
 * declines to write:
 *   - a negligible drag (see `NEGLIGIBLE_DRAG_SEC`);
 *   - a locked neighbour blocking the cascade (`computeDragCascade` → null).
 * The locked case matters for more than tidiness: the commit path reverts to
 * `originalSegments` on a block, so a preview that had drawn the drag anyway
 * would have to un-draw it on release — the very jump (2) this exists to
 * remove. Rendering the original array throughout means a blocked drag shows
 * the user, truthfully and immediately, that nothing is moving.
 *
 * Pure. `onLockedBlock` is intentionally absent: a preview frame runs up to
 * 60×/second and must not raise a toast. The commit path passes its own
 * reporting callback straight to `computeDragCascade`.
 */
export function resolveDragPreview(
  originalSegments: VideoSegment[],
  draggedIdx: number,
  finalDuration: number,
  finalTrimStart: number,
  direction: 'right' | 'left',
  tokens?: TranscriptToken[],
): VideoSegment[] {
  const dragged = originalSegments[draggedIdx];
  if (!dragged) return originalSegments;
  if (Math.abs(finalDuration - dragged.duration) < NEGLIGIBLE_DRAG_SEC) return originalSegments;
  return computeDragCascade(
    originalSegments,
    draggedIdx,
    finalDuration,
    finalTrimStart,
    direction,
    () => undefined,
    tokens,
  ) ?? originalSegments;
}
