/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Edge-drag rules for the Layer-2 timeline lane. A spot's START is anchored to
 * its scene: only DURATION is editable, and it is stamped as `durOverrideSec`
 * (preserved across re-sync). Dragging the left edge refuses, honestly.
 */

export const MIN_SPOT_DUR_SEC = 0.5;
export const SPOT_START_ANCHORED_MESSAGE =
  "A Layer-2 spot's start is anchored to its scene — drag the right edge to change its duration.";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function resizeSpotBlock(a: {
  edge: 'start' | 'end';
  startSec: number;
  durSec: number;
  deltaSec: number;
  /** End of the timeline (voiceover); a block may not run past it. */
  maxEndSec: number;
}): { durSec: number; refused?: 'start-anchored' } {
  if (a.edge === 'start') return { durSec: a.durSec, refused: 'start-anchored' };
  const room = Math.max(MIN_SPOT_DUR_SEC, a.maxEndSec - a.startSec);
  const next = Math.min(Math.max(a.durSec + a.deltaSec, MIN_SPOT_DUR_SEC), room);
  return { durSec: r3(next) };
}
