/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The export engine reports progress in bursts (1, 5, 7, 10 …). The bar and the
// number should move steadily instead: the shown value glides toward the real
// one, and between reports creeps forward at the measured rate — but never more
// than a couple of points ahead of what the engine has actually confirmed, and
// never backwards.

/** How far past the confirmed percent the display may creep while waiting. */
export const MAX_LOOKAHEAD = 2;

/**
 * One animation step.
 * @param shown   what is displayed now (0–100, fractional)
 * @param target  the engine's latest confirmed percent
 * @param rate    measured percent per second (0 when unknown)
 * @param dtSec   seconds since the last step
 */
export function stepSmoothPercent(shown: number, target: number, rate: number, dtSec: number): number {
  let next: number;
  if (shown < target) {
    // Catch up to a report: at least the measured rate, faster the further behind.
    const speed = Math.max(rate, (target - shown) * 2, 1);
    next = Math.min(target, shown + speed * dtSec);
  } else {
    // Waiting for the next report: creep, bounded by the look-ahead.
    next = Math.min(target + MAX_LOOKAHEAD, shown + Math.max(0, rate) * dtSec);
  }
  // Only the real 100 reaches 100.
  const ceiling = target >= 100 ? 100 : 99;
  return Math.min(ceiling, Math.max(shown, next));
}
