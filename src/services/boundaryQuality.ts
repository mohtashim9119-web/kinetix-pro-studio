/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Boundary-quality checker — Phase 1 of the waveform-watcher program
// (post-hoc measurement + instrumentation, architecture B: a pass that runs
// AFTER the voiceover waveform's peaks are built, never reordering or
// altering any existing sync step). This file holds the one piece of new
// signal the checker needs that neither `waveformPeaks.ts` (drawing/
// extraction) nor `snapBoundaries.ts` (boundary computation) already has:
// "where, inside a time window, is the audio quietest?" — the answer a
// fallback boundary (one `snapCoveredBoundaries` placed at the plain
// spoken-edge midpoint because no silence was assignable) is checked
// against. `syncContracts.ts`'s `validateBoundaryQuality` is the consumer;
// this module stays pure and DOM/React-free, matching every other service
// in this pipeline.
// ---------------------------------------------------------------------------

/** Result of `findQuietestRegion` — `found: false` means the window held too
 *  little data to evaluate even one `sustainedWindowSec`-wide span (never
 *  that the window "has no quiet part"; a uniformly loud window still has a
 *  well-defined minimum and reports `found: true`). */
export interface QuietestRegionResult {
  found: boolean;
  /** Time (seconds) at the CENTER of the quietest sustained span found. */
  time?: number;
  /** Mean peak amplitude ([0,1], normalized) over that span. */
  meanAmplitude?: number;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Slides a `sustainedWindowSec`-wide window across `peaks[windowStartSec,
 * windowEndSec)` and returns the position with the lowest mean amplitude —
 * the most plausible "true quiet" spot in that span, as opposed to a single
 * quiet peak-column that could just be a brief dip inside otherwise-loud
 * speech. A running sum keeps this O(n) in the number of peak columns
 * spanned, not O(n * sustainedCols).
 *
 * `windowStartSec`/`windowEndSec` are clamped into `[0, peaks.length /
 * peaksPerSecond]` (via column indices) rather than assumed valid — callers
 * pass a boundary search window that is itself already clamped to spoken-word
 * edges, but this function does not trust that invariant blindly.
 *
 * Returns `{ found: false }` when the window (after clamping) holds fewer
 * peak columns than one `sustainedWindowSec` span — there is nothing a
 * sliding window of that size could even measure once.
 *
 * Pure; exported for direct unit testing.
 */
export function findQuietestRegion(
  peaks: Float32Array,
  peaksPerSecond: number,
  windowStartSec: number,
  windowEndSec: number,
  sustainedWindowSec: number,
): QuietestRegionResult {
  const startCol = clampInt(Math.floor(windowStartSec * peaksPerSecond), 0, peaks.length);
  const endCol = clampInt(Math.ceil(windowEndSec * peaksPerSecond), 0, peaks.length);
  const sustainedCols = Math.max(1, Math.round(sustainedWindowSec * peaksPerSecond));

  if (endCol - startCol < sustainedCols) {
    return { found: false };
  }

  // Running-sum sliding window mean (O(n) in the number of columns spanned).
  let sum = 0;
  for (let i = startCol; i < startCol + sustainedCols; i++) sum += peaks[i] ?? 0;

  let bestSum = sum;
  let bestStartCol = startCol;
  for (let i = startCol + sustainedCols; i < endCol; i++) {
    sum += (peaks[i] ?? 0) - (peaks[i - sustainedCols] ?? 0);
    if (sum < bestSum) {
      bestSum = sum;
      bestStartCol = i - sustainedCols + 1;
    }
  }

  const meanAmplitude = bestSum / sustainedCols;
  const centerCol = bestStartCol + sustainedCols / 2;
  const time = centerCol / peaksPerSecond;
  return { found: true, time, meanAmplitude };
}
