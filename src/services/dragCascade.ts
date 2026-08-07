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
import { enforceGaplessPartition } from './timelinePartition';

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
 * start pushing that neighbour's own words out of its slot — the K15b bound.
 *
 * **The floor, stated plainly: a neighbour's slot may never be moved past its
 * own outermost word.** A head-yielding neighbour's start may not pass its own
 * FIRST word's onset; a tail-yielding neighbour's end may not fall below its own
 * LAST word's offset. Everything between the slot edge and that word is the
 * neighbour's own leading/trailing silence, and silence is the only thing a drag
 * is entitled to take. So the yieldable amount is exactly that silence.
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

  let firstOwnedStart = Infinity;
  let lastOwnedEnd = -Infinity;
  for (const t of tokens) {
    if (!isUsableToken(t)) continue;
    const mid = (t.startSec + t.endSec) / 2;
    if (mid < slotStart || mid >= slotEnd) continue;
    if (t.startSec < firstOwnedStart) firstOwnedStart = t.startSec;
    if (t.endSec > lastOwnedEnd) lastOwnedEnd = t.endSec;
  }
  if (firstOwnedStart === Infinity) return Infinity;

  const silence = yieldSide === 'head'
    ? firstOwnedStart - slotStart
    : slotEnd - lastOwnedEnd;
  // Never negative: a word already straddling the yielding edge means there is
  // no silence there to take, so the neighbour yields nothing.
  return Math.max(0, silence);
}

/**
 * ---------------------------------------------------------------------------
 * `restackWindow` — DELETED (Model P, 2026-08-07)
 * ---------------------------------------------------------------------------
 *
 * K15a's window-local restack rewrote `startTime`/`anchorStart` for the touched
 * index window only, "which is what preserves a pre-existing gap." Under the
 * owner's Model P ruling a gap is not something to preserve — it is
 * unrepresentable — so the function's entire justification is void and it has
 * been removed rather than left as a second, disagreeing positioner.
 *
 * `enforceGaplessPartition` (services/timelinePartition.ts) replaces it. The
 * ruling document's §6.1 already established the two are EQUIVALENT whenever
 * the cascade conserves the touched window's total duration — which K15b's
 * give-back guarantees, and which is asserted directly in `dragCascade.test.ts`
 * — so this is a change of authority, not of arithmetic, on every array that
 * was already a partition.
 *
 * K15a's locality survives where it actually mattered: `computeDragCascade`
 * still touches only the neighbours it must, and the yield floor still bounds
 * them. What it no longer does is decide where anything sits.
 */

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

  // Model P — positioning is not this function's job. It has decided
  // DURATIONS; the single constructor turns those into positions, and is the
  // only writer of `startTime`/`anchorStart` on this path. `lastTouched` is no
  // longer consulted for a window bound (see the `restackWindow` tombstone
  // above) and remains only as the loop's own progress marker.
  //
  // No `audioDuration` is passed, deliberately: a drag must not re-stretch the
  // last segment to the audio end mid-gesture — that would silently give the
  // tail back whatever the drag just took from it. The tail rule belongs to the
  // sync path, which is the only place total length is being decided.
  void lastTouched;
  return enforceGaplessPartition(segs);
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
