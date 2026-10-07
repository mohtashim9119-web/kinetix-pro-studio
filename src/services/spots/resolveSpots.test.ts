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
  offsetSec: 0, source: 'doc', boundAt: 0, ...o,
});

describe('resolveSpots', () => {
  it('golden fixture', () => {
    const spots = [
      spot({ id: 'A', anchorSegmentId: 's1', assetId: 'v' }),                         // full clip: 0..4
      spot({ id: 'B', anchorSegmentId: 's2', assetId: 'i' }),                         // image 3s: 5..8
      spot({ id: 'C', anchorSegmentId: 's2', assetId: 'i', offsetSec: 1, durOverrideSec: 2 }), // 6..8 override, overlaps B
      spot({ id: 'D', anchorSegmentId: 's1', assetId: 'gone' }),                      // deleted asset
    ];
    const r = resolveSpots(spots, segs, assets, 10);
    expect(r.specs).toEqual([
      { assetId: 'v', startSec: 0, durSec: 4, xPct: 0, yPct: 0, wPct: 50, hPct: 100 },
      { assetId: 'i', startSec: 5, durSec: 1, xPct: 0, yPct: 0, wPct: 50, hPct: 100 },   // B truncated by C (last wins)
      { assetId: 'i', startSec: 6, durSec: 2, xPct: 0, yPct: 0, wPct: 50, hPct: 100 },
    ]);
    expect(r.findings.map(f => [f.kind, f.spotId])).toEqual([
      ['spot-clip-missing', 'D'],
      ['spot-overlap', 'B'],
    ]);
    expect(r.findings.map(f => f.message)).toEqual([
      'Scene 1: Spot clip is no longer in the vault — skipped.',
      'Scene 2: Spot overlaps the next spot — the later one wins.',
    ]);
    expect(r.lastKnown).toEqual({ A: 0, B: 5, C: 6, D: 0 });
    // Deleted clip: timing kept (start + default 3s) so the preview can show [NO CLIP] in place.
    expect(r.noClip.D).toMatchObject({ startSec: 0, durSec: 3 });
    expect(Object.fromEntries(Object.entries(r.bySpot).map(([k, v]) => [k, [v.startSec, v.durSec]]))).toEqual({ A: [0, 4], B: [5, 1], C: [6, 2] });
  });

  it('clamps at the voiceover end with a finding; fully past -> dropped + finding', () => {
    const r = resolveSpots(
      [
        spot({ id: 'E', anchorSegmentId: 's2', assetId: 'vl', offsetSec: 4 }),  // 9..39 -> 9..10
        spot({ id: 'F', anchorSegmentId: 's2', assetId: 'i', offsetSec: 5 }),   // 10.. -> dropped
      ],
      segs, assets, 10,
    );
    expect(r.specs).toEqual([{ assetId: 'vl', startSec: 9, durSec: 1, xPct: 0, yPct: 0, wPct: 50, hPct: 100 }]);
    expect(r.findings.map(f => [f.kind, f.spotId])).toEqual([['spot-past-voiceover', 'E'], ['spot-past-voiceover', 'F']]);
    expect(r.findings.map(f => f.message)).toEqual([
      'Scene 2: Spot runs past the voiceover — trimmed.',
      'Scene 2: Spot starts after the voiceover — skipped.',
    ]);
  });

  it('deleted anchor segment: keeps last-known absolute, flagged needsReview, never dropped', () => {
    const r = resolveSpots(
      [spot({ id: 'G', anchorSegmentId: 'deleted', assetId: 'i', lastKnownStartSec: 7 })],
      segs, assets, 10,
    );
    expect(r.specs).toEqual([{ assetId: 'i', startSec: 7, durSec: 3, xPct: 0, yPct: 0, wPct: 50, hPct: 100 }]);
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
    expect(r.noClip.U).toMatchObject({ startSec: 0, durSec: 3 });
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

describe('resolved rect (geometry + layout)', () => {
  it('a stamped geometry override wins and is carried verbatim into the spec', () => {
    const g = { xPct: 10, yPct: 20, wPct: 30, hPct: 25 };
    const r = resolveSpots([spot({ id: 'G', anchorSegmentId: 's1', assetId: 'i', geometry: g })], segs, assets, 10);
    expect(r.specs[0]).toMatchObject(g);
    expect(r.bySpot.G!.rect).toEqual(g);
  });
  it('R7 cascade: no geometry -> LEFT HALF; project default moves un-dragged spots only; individual wins', () => {
    const G = { xPct: 10, yPct: 20, wPct: 30, hPct: 25 };
    const P = { xPct: 60, yPct: 5, wPct: 35, hPct: 50 };
    const spots = [
      spot({ id: 'A', anchorSegmentId: 's1', assetId: 'i' }),
      spot({ id: 'B', anchorSegmentId: 's2', assetId: 'i', geometry: G }),
    ];
    const none = resolveSpots(spots, segs, assets, 10);
    expect(none.bySpot.A!.rect).toEqual({ xPct: 0, yPct: 0, wPct: 50, hPct: 100 });
    expect(none.bySpot.B!.rect).toEqual(G);
    const withDefault = resolveSpots(spots, segs, assets, 10, { projectDefault: P });
    expect(withDefault.bySpot.A!.rect).toEqual(P);   // un-dragged follows the project default
    expect(withDefault.bySpot.B!.rect).toEqual(G);   // dragged keeps its own
    expect(withDefault.specs.map(x => [x.xPct, x.yPct, x.wPct, x.hPct])).toEqual([[60, 5, 35, 50], [10, 20, 30, 25]]);
    // reset B -> falls to the project default
    const reset = resolveSpots([spots[0]!, { ...spots[1]!, geometry: undefined }], segs, assets, 10, { projectDefault: P });
    expect(reset.bySpot.B!.rect).toEqual(P);
  });
});
