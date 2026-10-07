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
  anchorSegmentId: 's1', offsetSec: 0, source: 'doc', boundAt: 0, ...o,
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
  it('OVERRIDES a clip the user picked by hand: the wand re-binds to the name the doc asked for', () => {
    const picked = sp({ id: 'b', assetId: 'i1', clipName: 'avatar01' });
    const r = matchSpotsToMedia(assets, [picked]);
    expect(r.spots[0]!.assetId).toBe('v');
    expect(r.matched).toBe(1);
    expect(r.unmatched).toBe(0);
  });
  it('an already-correct spot is returned by reference and still counts as matched', () => {
    const ok = sp({ id: 'ok', assetId: 'v', clipName: 'avatar01' });
    const r = matchSpotsToMedia(assets, [ok]);
    expect(r.spots[0]).toBe(ok);
    expect(r.matched).toBe(1);
  });
  it('a different media type drops a stale duration override (a 3s image override must not clip a video)', () => {
    const r = matchSpotsToMedia(assets, [sp({ id: 'd', assetId: 'old', clipName: 'avatar01', durOverrideSec: 3 })]
    );
    expect(r.spots[0]!.assetId).toBe('v');
    expect('durOverrideSec' in r.spots[0]!).toBe(true); // 'old' is unknown to the vault: type change cannot be proven
    const withOld = matchSpotsToMedia([...assets, a('old', 'old.png', 5)], [sp({ id: 'd', assetId: 'old', clipName: 'avatar01', durOverrideSec: 3 })]);
    expect('durOverrideSec' in withOld.spots[0]!).toBe(false);
    const sameType = matchSpotsToMedia(assets, [sp({ id: 'e', assetId: 'old2', clipName: 'logo', durOverrideSec: 4 })]);
    expect(sameType.spots[0]!.durOverrideSec).toBe(4);
  });
  it('a name that resolves to nothing leaves the current clip and counts unmatched', () => {
    const keep = sp({ id: 'k', assetId: 'i1', clipName: 'nothing-like-this' });
    const r = matchSpotsToMedia(assets, [keep]);
    expect(r.spots[0]).toBe(keep);
    expect(r.unmatched).toBe(1);
  });
  it('a nameless spot that already has a clip is left alone and not counted', () => {
    const hand = sp({ id: 'h', assetId: 'i1' });
    const r = matchSpotsToMedia(assets, [hand]);
    expect(r.spots[0]).toBe(hand);
    expect(r.unmatched).toBe(0);
  });
  it('audio is never a candidate', () => {
    expect(matchSpotsToMedia(assets, [sp({ id: 'x', clipName: 'vo' })]).spots[0]!.assetId).toBeUndefined();
  });
});
