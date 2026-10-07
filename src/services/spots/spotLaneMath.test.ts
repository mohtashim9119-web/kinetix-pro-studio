/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots R2 — pure edge-drag rules for the timeline lane.
import { describe, it, expect } from 'vitest';
import { resizeSpotBlock, MIN_SPOT_DUR_SEC, SPOT_START_ANCHORED_MESSAGE } from './spotLaneMath';

describe('resizeSpotBlock', () => {
  it('right edge extends / shrinks the duration (video and image alike); the start never moves', () => {
    expect(resizeSpotBlock({ edge: 'end', startSec: 5, durSec: 3, deltaSec: 2, maxEndSec: 60 })).toEqual({ durSec: 5 });
    expect(resizeSpotBlock({ edge: 'end', startSec: 5, durSec: 3, deltaSec: -1.25, maxEndSec: 60 })).toEqual({ durSec: 1.75 });
  });
  it('minimum 0.5s', () => {
    expect(MIN_SPOT_DUR_SEC).toBe(0.5);
    expect(resizeSpotBlock({ edge: 'end', startSec: 0, durSec: 3, deltaSec: -99, maxEndSec: 60 })).toEqual({ durSec: 0.5 });
  });
  it('cannot extend past the end of the timeline (voiceover)', () => {
    expect(resizeSpotBlock({ edge: 'end', startSec: 55, durSec: 3, deltaSec: 30, maxEndSec: 60 })).toEqual({ durSec: 5 });
  });
  it('an image spot extends beyond its 3s default', () => {
    expect(resizeSpotBlock({ edge: 'end', startSec: 0, durSec: 3, deltaSec: 4.5, maxEndSec: 60 })).toEqual({ durSec: 7.5 });
  });
  it('left edge REFUSES honestly: duration unchanged, anchored message', () => {
    const r = resizeSpotBlock({ edge: 'start', startSec: 5, durSec: 3, deltaSec: 1, maxEndSec: 60 });
    expect(r).toEqual({ durSec: 3, refused: 'start-anchored' });
    expect(SPOT_START_ANCHORED_MESSAGE).toMatch(/anchored to its scene/i);
  });
  it('rounds to ms (no float dust stamped into the project)', () => {
    expect(resizeSpotBlock({ edge: 'end', startSec: 0, durSec: 3, deltaSec: 0.1 + 0.2, maxEndSec: 60 })).toEqual({ durSec: 3.3 });
  });
});
