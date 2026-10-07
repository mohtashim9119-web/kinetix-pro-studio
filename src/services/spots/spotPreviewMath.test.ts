/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots U5 — pure preview math (the DOM rectangle's brain).
import { describe, it, expect } from 'vitest';
import { activeSpotAt, computeSpotSync, SPOT_Z_INDEX, type PreviewSpotItem } from './spotPreviewMath';

const item = (o: Partial<PreviewSpotItem> & { id: string; startSec: number; durSec: number }): PreviewSpotItem => ({
  rect: { xPct: 58.875, yPct: 2, wPct: 40, hPct: 40 }, ...o,
});

describe('activeSpotAt', () => {
  const items = [item({ id: 'a', startSec: 0, durSec: 4 }), item({ id: 'b', startSec: 6, durSec: 2 })];
  it('half-open interval [start, start+dur)', () => {
    expect(activeSpotAt(items, 0)?.id).toBe('a');
    expect(activeSpotAt(items, 3.99)?.id).toBe('a');
    expect(activeSpotAt(items, 4)).toBeUndefined();
    expect(activeSpotAt(items, 6)?.id).toBe('b');
  });
  it('later item wins when two are active', () => {
    expect(activeSpotAt([item({ id: 'x', startSec: 0, durSec: 5 }), item({ id: 'y', startSec: 2, durSec: 5 })], 3)?.id).toBe('y');
  });
});

describe('computeSpotSync', () => {
  const it0 = item({ id: 'a', startSec: 10, durSec: 4 });
  it('seek-on-enter: element far from target -> seek to local time', () => {
    expect(computeSpotSync({ t: 12, item: it0, clipDuration: 4, elTime: 0, isPlaying: true })).toEqual({ seekTo: 2, shouldPlay: true });
  });
  it('playing within drift tolerance: no seek, plays', () => {
    expect(computeSpotSync({ t: 12, item: it0, clipDuration: 4, elTime: 2.1, isPlaying: true })).toEqual({ shouldPlay: true });
  });
  it('paused scrub: exact seek, no play', () => {
    expect(computeSpotSync({ t: 11, item: it0, clipDuration: 4, elTime: 2, isPlaying: false })).toEqual({ seekTo: 1, shouldPlay: false });
  });
  it('override longer than the clip: holds the last frame (no play past clip end)', () => {
    const long = item({ id: 'l', startSec: 0, durSec: 9 });
    expect(computeSpotSync({ t: 6, item: long, clipDuration: 4, elTime: 4, isPlaying: true })).toEqual({ shouldPlay: false });
  });
});

describe('z slot', () => {
  it('sits above the media and below extra overlays (40), text layers (45), captions (46)', () => {
    expect(SPOT_Z_INDEX).toBeGreaterThan(0);
    expect(SPOT_Z_INDEX).toBeLessThan(40);
  });
});
