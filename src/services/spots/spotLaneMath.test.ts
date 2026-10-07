/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots R2 (revised) — pure drag rules for the timeline lane. The start is
// the USER's to move (stored as an offset from the scene anchor); the right edge sets
// the duration; the left edge moves the start with the end held in place.
import { describe, it, expect } from 'vitest';
import { resizeSpotBlock, moveSpotBlock, MIN_SPOT_DUR_SEC } from './spotLaneMath';

describe('resizeSpotBlock — right edge (duration)', () => {
  it('extends / shrinks; the start never moves', () => {
    expect(resizeSpotBlock({ edge: 'end', startSec: 5, durSec: 3, deltaSec: 2, maxEndSec: 60 })).toEqual({ durSec: 5 });
    expect(resizeSpotBlock({ edge: 'end', startSec: 5, durSec: 3, deltaSec: -1.25, maxEndSec: 60 })).toEqual({ durSec: 1.75 });
  });
  it('minimum 0.5s; cannot run past the end of the timeline', () => {
    expect(MIN_SPOT_DUR_SEC).toBe(0.5);
    expect(resizeSpotBlock({ edge: 'end', startSec: 0, durSec: 3, deltaSec: -99, maxEndSec: 60 })).toEqual({ durSec: 0.5 });
    expect(resizeSpotBlock({ edge: 'end', startSec: 55, durSec: 3, deltaSec: 30, maxEndSec: 60 })).toEqual({ durSec: 5 });
  });
  it('rounds to ms (no float dust)', () => {
    expect(resizeSpotBlock({ edge: 'end', startSec: 0, durSec: 3, deltaSec: 0.1 + 0.2, maxEndSec: 60 })).toEqual({ durSec: 3.3 });
  });
});

describe('resizeSpotBlock — left edge (start follows the user, end held)', () => {
  it('dragging right moves the start later and shortens the block; the end stays', () => {
    expect(resizeSpotBlock({ edge: 'start', startSec: 30, durSec: 10, deltaSec: 4, maxEndSec: 60 })).toEqual({ startDeltaSec: 4, durSec: 6 });
  });
  it('dragging left moves the start earlier and lengthens the block', () => {
    expect(resizeSpotBlock({ edge: 'start', startSec: 30, durSec: 10, deltaSec: -5, maxEndSec: 60 })).toEqual({ startDeltaSec: -5, durSec: 15 });
  });
  it('cannot cross before 0 or within 0.5s of the end', () => {
    expect(resizeSpotBlock({ edge: 'start', startSec: 2, durSec: 10, deltaSec: -99, maxEndSec: 60 })).toEqual({ startDeltaSec: -2, durSec: 12 });
    expect(resizeSpotBlock({ edge: 'start', startSec: 2, durSec: 10, deltaSec: 99, maxEndSec: 60 })).toEqual({ startDeltaSec: 9.5, durSec: 0.5 });
  });
});

describe('moveSpotBlock — body drag slides the whole block', () => {
  it('moves the start by the delta, duration unchanged', () => {
    expect(moveSpotBlock({ startSec: 30, durSec: 10, deltaSec: 6, maxEndSec: 60 })).toEqual({ startDeltaSec: 6 });
  });
  it('stays inside [0, timeline end]', () => {
    expect(moveSpotBlock({ startSec: 3, durSec: 10, deltaSec: -99, maxEndSec: 60 })).toEqual({ startDeltaSec: -3 });
    expect(moveSpotBlock({ startSec: 40, durSec: 10, deltaSec: 99, maxEndSec: 60 })).toEqual({ startDeltaSec: 10 });
  });
});
