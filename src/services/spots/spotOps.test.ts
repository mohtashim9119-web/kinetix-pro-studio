/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots U4 — pure edit operations the Layer-2 panel and App effects use.

import { describe, it, expect } from 'vitest';
import { mergeDocSpots, addManualSpot, patchSpot, deleteSpot, stampResolution } from './spotOps';
import { resolveSpots } from './resolveSpots';
import type { Asset, Spot, VideoSegment } from '../../types';

const spot = (o: Partial<Spot> & { id: string }): Spot => ({
  anchorSegmentId: 's1', offsetSec: 0, corner: 'top-right', heightPct: 40, source: 'doc', boundAt: 0, ...o,
});

describe('spotOps', () => {
  it('mergeDocSpots replaces prior doc spots, keeps manual + sprinkle', () => {
    const existing = [spot({ id: 'a' }), spot({ id: 'm', source: 'manual' }), spot({ id: 'sp', source: 'sprinkle' })];
    const r = mergeDocSpots(existing, [spot({ id: 'n' })]);
    expect(r.map(s => s.id)).toEqual(['m', 'sp', 'n']);
  });
  it('addManualSpot defaults per contract', () => {
    const r = addManualSpot([], 's2', 'a1', 5, () => 'x');
    expect(r).toEqual([{ id: 'x', assetId: 'a1', anchorSegmentId: 's2', offsetSec: 0, corner: 'top-right', heightPct: 40, source: 'manual', boundAt: 5 }]);
  });
  it('patchSpot stamps durOverrideSec; null clears it; other spots untouched by reference', () => {
    const a = spot({ id: 'a' }); const b = spot({ id: 'b' });
    const r = patchSpot([a, b], 'a', { durOverrideSec: 4, corner: 'bottom-left' });
    expect(r[0]).toMatchObject({ durOverrideSec: 4, corner: 'bottom-left' });
    expect(r[1]).toBe(b);
    const cleared = patchSpot(r, 'a', { durOverrideSec: null });
    expect('durOverrideSec' in cleared[0]!).toBe(false);
  });
  it('deleteSpot removes by id', () => {
    expect(deleteSpot([spot({ id: 'a' }), spot({ id: 'b' })], 'a').map(s => s.id)).toEqual(['b']);
  });
  it('stampResolution writes lastKnown + needsReview; returns the same array when nothing changes', () => {
    const segs = [{ id: 's1', text: 't', startTime: 2, duration: 3 }] as unknown as VideoSegment[];
    const assets: Asset[] = [{ id: 'i', name: 'i.png', url: '', type: 'image' }];
    const spots = [spot({ id: 'a', assetId: 'i' }), spot({ id: 'o', anchorSegmentId: 'gone', assetId: 'i', lastKnownStartSec: 1 })];
    const res = resolveSpots(spots, segs, assets, 5);
    const stamped = stampResolution(spots, res, true);
    expect(stamped[0]).toMatchObject({ lastKnownStartSec: 2 });
    expect(stamped[1]).toMatchObject({ needsReview: true, lastKnownStartSec: 1 });
    const again = stampResolution(stamped, resolveSpots(stamped, segs, assets, 5), true);
    expect(again).toBe(stamped);
  });
  it('stampResolution is a no-op while there is no timeline (no anchors yet)', () => {
    const spots = [spot({ id: 'a' })];
    expect(stampResolution(spots, resolveSpots(spots, [], [], 0), false)).toBe(spots);
  });
});

import { sprinkleSpots } from './spotOps';

describe('sprinkleSpots', () => {
  const segs = [{ id: 's1' }, { id: 's2' }, { id: 's3' }] as unknown as VideoSegment[];
  const assets: Asset[] = [
    { id: 'v', name: 'a.mp4', url: '', type: 'video', duration: 4 },
    { id: 'au', name: 'vo.mp3', url: '', type: 'audio' },
  ];
  let n = 0;
  const newId = () => `n${++n}`;

  it('every segment WITHOUT a spot gets one: sprinkle source, default asset, no duration override', () => {
    const existing = [spot({ id: 'keep', anchorSegmentId: 's2', source: 'doc' })];
    const r = sprinkleSpots(existing, segs, assets, 'v', 7, newId);
    expect(r.map(s => [s.anchorSegmentId, s.source])).toEqual([['s2', 'doc'], ['s1', 'sprinkle'], ['s3', 'sprinkle']]);
    expect(r[0]).toBe(existing[0]);
    const added = r.slice(1);
    expect(added.every(s => s.assetId === 'v' && s.durOverrideSec === undefined && s.corner === 'top-right' && s.heightPct === 40 && s.boundAt === 7)).toBe(true);
  });
  it('is idempotent: a second click adds nothing (same array back)', () => {
    const once = sprinkleSpots([], segs, assets, 'v', 1, newId);
    expect(sprinkleSpots(once, segs, assets, 'v', 2, newId)).toBe(once);
  });
  it('no usable default asset (unset, deleted, or audio) -> unchanged', () => {
    expect(sprinkleSpots([], segs, assets, undefined, 1, newId)).toEqual([]);
    expect(sprinkleSpots([], segs, assets, 'gone', 1, newId)).toEqual([]);
    expect(sprinkleSpots([], segs, assets, 'au', 1, newId)).toEqual([]);
  });
});
