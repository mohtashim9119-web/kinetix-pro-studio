/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Drag rules for the Layer-2 timeline lane. A spot is anchored to a scene only as
 * the REFERENCE for its start (`startSec = anchor.startTime + offsetSec`, so spots
 * follow their scenes through re-sync); the START itself is the user's to move.
 *  - right edge: duration (stamped as `durOverrideSec`);
 *  - left edge:  start moves, the END stays put (duration follows);
 *  - body:       the whole block slides, duration unchanged.
 */

export const MIN_SPOT_DUR_SEC = 0.5;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function resizeSpotBlock(a: {
  edge: 'start' | 'end';
  startSec: number;
  durSec: number;
  deltaSec: number;
  /** End of the timeline (voiceover); a block may not run past it. */
  maxEndSec: number;
}): { durSec: number; startDeltaSec?: number } {
  if (a.edge === 'end') {
    const room = Math.max(MIN_SPOT_DUR_SEC, a.maxEndSec - a.startSec);
    return { durSec: r3(clamp(a.durSec + a.deltaSec, MIN_SPOT_DUR_SEC, room)) };
  }
  const end = a.startSec + a.durSec;
  const newStart = clamp(a.startSec + a.deltaSec, 0, Math.max(0, end - MIN_SPOT_DUR_SEC));
  return { startDeltaSec: r3(newStart - a.startSec), durSec: r3(end - newStart) };
}

export function moveSpotBlock(a: {
  startSec: number;
  durSec: number;
  deltaSec: number;
  maxEndSec: number;
}): { startDeltaSec: number } {
  const newStart = clamp(a.startSec + a.deltaSec, 0, Math.max(0, a.maxEndSec - a.durSec));
  return { startDeltaSec: r3(newStart - a.startSec) };
}
