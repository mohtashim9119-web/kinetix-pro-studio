/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots U3 — pure resolver. Golden fixture: two segments, one full-length
// video spot, one 3s image spot, one override, one missing asset, one overlap.

import { describe, it, expect } from 'vitest';
import { resolveSpots } from './resolveSpots';
import type { Asset, Spot, VideoSegment } from '../../types';

const segs = [
  { id: 's1', text: 'a', startTime: 0, duration: 5 },
  { id: 's2', text: 'b', startTime: 5, duration: 5 },
] as unknown as VideoSegment[];
const assets: Asset[] = [
  { id: 'v', name: 'v.mp4', url: '', type: 'video', duration: 4 },
  { id: 'i', name: 'i.png', url: '', type: 'image' },
  { id: 'vl', name: 'long.mp4', url: '', type: 'video', duration: 30 },
];
const spot = (o: Partial<Spot> & { id: string; anchorSegmentId: string }): Spot => ({
  offsetSec: 0, corner: 'top-right', heightPct: 40, source: 'doc', boundAt: 0, ...o,
});

describe('resolveSpots', () => {
  it('golden fixture', () => {
    const spots = [
      spot({ id: 'A', anchorSegmentId: 's1', assetId: 'v' }),                         // full clip: 0..4
      spot({ id: 'B', anchorSegmentId: 's2', assetId: 'i' }),                         // image 3s: 5..8
      spot({ id: 'C', anchorSegmentId: 's2', assetId: 'i', offsetSec: 1, durOverrideSec: 2, corner: 'bottom-left' }), // 6..8 override, overlaps B
      spot({ id: 'D', anchorSegmentId: 's1', assetId: 'gone' }),                      // deleted asset
    ];
    const r = resolveSpots(spots, segs, assets, 10);
    expect(r.specs).toEqual([
      { assetId: 'v', startSec: 0, durSec: 4, corner: 'top-right', heightPct: 40 },
      { assetId: 'i', startSec: 5, durSec: 1, corner: 'top-right', heightPct: 40 },   // B truncated by C (last wins)
      { assetId: 'i', startSec: 6, durSec: 2, corner: 'bottom-left', heightPct: 40 },
    ]);
    expect(r.findings.map(f => [f.kind, f.spotId])).toEqual([
      ['spot-clip-missing', 'D'],
      ['spot-overlap', 'B'],
    ]);
    expect(r.lastKnown).toEqual({ A: 0, B: 5, C: 6, D: 0 });
  });

  it('clamps at the voiceover end with a finding; fully past -> dropped + finding', () => {
    const r = resolveSpots(
      [
        spot({ id: 'E', anchorSegmentId: 's2', assetId: 'vl', offsetSec: 4 }),  // 9..39 -> 9..10
        spot({ id: 'F', anchorSegmentId: 's2', assetId: 'i', offsetSec: 5 }),   // 10.. -> dropped
      ],
      segs, assets, 10,
    );
    expect(r.specs).toEqual([{ assetId: 'vl', startSec: 9, durSec: 1, corner: 'top-right', heightPct: 40 }]);
    expect(r.findings.map(f => [f.kind, f.spotId])).toEqual([['spot-past-voiceover', 'E'], ['spot-past-voiceover', 'F']]);
  });

  it('deleted anchor segment: keeps last-known absolute, flagged needsReview, never dropped', () => {
    const r = resolveSpots(
      [spot({ id: 'G', anchorSegmentId: 'deleted', assetId: 'i', lastKnownStartSec: 7 })],
      segs, assets, 10,
    );
    expect(r.specs).toEqual([{ assetId: 'i', startSec: 7, durSec: 3, corner: 'top-right', heightPct: 40 }]);
    expect(r.needsReview).toEqual(['G']);
  });

  it('deleted anchor with no last-known time cannot be placed: no spec, still reported for review', () => {
    const r = resolveSpots([spot({ id: 'H', anchorSegmentId: 'deleted', assetId: 'i' })], segs, assets, 10);
    expect(r.specs).toEqual([]);
    expect(r.needsReview).toEqual(['H']);
  });

  it('an unbound spot (no assetId) yields no spec and no clip-missing finding', () => {
    const r = resolveSpots([spot({ id: 'U', anchorSegmentId: 's1' })], segs, assets, 10);
    expect(r.specs).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it('video with unknown length is not guessed: dropped + spot-clip-missing', () => {
    const r = resolveSpots(
      [spot({ id: 'V', anchorSegmentId: 's1', assetId: 'nv' })],
      segs, [{ id: 'nv', name: 'n.mp4', url: '', type: 'video' }], 10,
    );
    expect(r.specs).toEqual([]);
    expect(r.findings.map(f => f.kind)).toEqual(['spot-clip-missing']);
  });
});
