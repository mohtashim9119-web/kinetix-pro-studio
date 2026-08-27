/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Salvaged from the abandoned ws2-t21-never-drop-segments branch: the one
// piece of that branch's segmentInterpolation.ts worth keeping on its own —
// a pure, generic "split this time region among these text spans by
// character count" helper, with no dependency on that branch's drop/never-
// drop machinery. Not yet wired to any caller.
// ---------------------------------------------------------------------------

/** Mirrors snapBoundaries.ts's own floor — see syncConstants.ts for why the
 *  MIN_SEGMENT_DURATION copies (engine vs. UI-drag) are deliberately not
 *  merged across files. This is the ENGINE value (0.1s). */
const MIN_SEGMENT_DURATION = 0.1;

function round3(v: number): number {
  return Number(v.toFixed(3));
}

export interface CharWeightedSplitPiece {
  text: string;
}

export interface CharWeightedSplitResult {
  startTime: number;
  duration: number;
}

/** Splits `[regionStart, regionEnd)` among `pieces` by character count (a
 *  single piece gets the whole region — the same result trivially). Exact:
 *  rounding drift is reconciled onto the LAST piece so the pieces sum to
 *  EXACTLY `regionEnd - regionStart`, no matter what — required to keep the
 *  gapless invariant (Model P, permanent) intact against whatever owns
 *  `regionEnd` as its own already-fixed boundary.
 *
 *  The MIN_SEGMENT_DURATION floor is applied ONLY when the region can
 *  actually afford it for every piece (`n * MIN <= regionDuration`). A
 *  region too small for that (many pieces packed into a short span) skips
 *  the floor rather than overshoot `regionEnd` — a sub-floor duration in
 *  that rare case is still correct/gapless; overshooting past `regionEnd`
 *  is not. */
export function splitRegionByCharCount(
  pieces: readonly CharWeightedSplitPiece[],
  regionStart: number,
  regionEnd: number,
): CharWeightedSplitResult[] {
  const regionDuration = Math.max(0, regionEnd - regionStart);
  const charCounts = pieces.map(p => p.text.length);
  const totalChars = charCounts.reduce((a, b) => a + b, 0);
  const n = pieces.length;
  const canApplyFloor = MIN_SEGMENT_DURATION * n <= regionDuration;
  const out: CharWeightedSplitResult[] = [];
  let cursor = regionStart;
  for (let j = 0; j < n; j++) {
    const isLast = j === n - 1;
    const share = totalChars > 0 ? regionDuration * (charCounts[j]! / totalChars) : regionDuration / n;
    const startTime = round3(cursor);
    const duration = isLast
      ? round3(Math.max(0, regionEnd - cursor))
      : round3(canApplyFloor ? Math.max(MIN_SEGMENT_DURATION, share) : Math.max(0, share));
    out.push({ startTime, duration });
    cursor = startTime + duration;
  }
  return out;
}
