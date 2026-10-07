/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots R4 — the wand's second pass: bind UNBOUND spots by their
// recorded clipName (pickAssetByName: oldest-wins, conflicts reported). A
// nameless spot is skipped honestly — never guessed.
import { describe, it, expect } from 'vitest';
import { matchSpotsToMedia } from './matchSpotsToMedia';
import type { Asset, Spot } from '../../types';

const a = (id: string, name: string, addedAt: number, type: Asset['type'] = 'image'): Asset => ({ id, name, url: '', type, addedAt });
const sp = (o: Partial<Spot> & { id: string }): Spot => ({
  anchorSegmentId: 's1', offsetSec: 0, corner: 'top-right', heightPct: 40, source: 'doc', boundAt: 0, ...o,
});

describe('matchSpotsToMedia', () => {
  const assets = [a('v', 'avatar01.mp4', 1, 'video'), a('new', 'logo.jpg', 20), a('old', 'logo.png', 10), a('au', 'vo.mp3', 3, 'audio')];

  it('binds an unbound spot by clipName; counts matched/unmatched; conflicts reported (oldest wins)', () => {
    const spots = [sp({ id: '1', clipName: 'avatar01' }), sp({ id: '2', clipName: 'logo' }), sp({ id: '3', clipName: 'nothing' })];
    const r = matchSpotsToMedia(assets, spots);
    expect(r.spots.map(s => s.assetId)).toEqual(['v', 'old', undefined]);
    expect(r.matched).toBe(2);
    expect(r.unmatched).toBe(1);
    expect(r.ambiguous).toEqual([{ name: 'logo', count: 2 }]);
  });
  it('no clipName -> skipped, never guessed (counts as unmatched, same reference)', () => {
    const nameless = sp({ id: 'n' });
    const r = matchSpotsToMedia(assets, [nameless]);
    expect(r.spots[0]).toBe(nameless);
    expect(r.matched).toBe(0);
    expect(r.unmatched).toBe(1);
  });
  it('already-bound spots are left alone (by reference) and are not counted as unmatched', () => {
    const bound = sp({ id: 'b', assetId: 'v', clipName: 'logo' });
    const r = matchSpotsToMedia(assets, [bound]);
    expect(r.spots[0]).toBe(bound);
    expect(r.matched).toBe(0);
    expect(r.unmatched).toBe(0);
  });
  it('audio is never a candidate', () => {
    expect(matchSpotsToMedia(assets, [sp({ id: 'x', clipName: 'vo' })]).spots[0]!.assetId).toBeUndefined();
  });
});
