/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots U2 — pure binders. pickAssetByName is the wand's matcher
// extracted (behaviour pinned by matchMediaToScenes.test.ts, which stays green
// untouched); parseSpotDoc / bindSpotDoc bind a scene-format doc to main
// segments + vault assets.

import { describe, it, expect } from 'vitest';
import { pickAssetByName } from '../pickAssetByName';
import { parseSpotDoc } from './parseSpotDoc';
import { bindSpotDoc } from './bindSpotDoc';
import type { Asset, VideoSegment } from '../../types';

const asset = (id: string, name: string, addedAt: number, type: Asset['type'] = 'image'): Asset =>
  ({ id, name, url: '', type, addedAt });
const seg = (id: string, tag: string | undefined, text: string, startTime: number): VideoSegment =>
  ({ id, tag, text, startTime, duration: 2 }) as unknown as VideoSegment;

describe('pickAssetByName', () => {
  it('exact match wins; oldest-wins with conflict count', () => {
    const r = pickAssetByName('001_intro', [asset('new', '001_intro.jpg', 20), asset('old', '001_intro.png', 10)]);
    expect(r.asset?.id).toBe('old');
    expect(r.conflict).toBe(2);
  });
  it('word-match fallback only when unique', () => {
    expect(pickAssetByName('year_2003', [asset('a', 'year_2003_999.jpg', 1)]).asset?.id).toBe('a');
    const amb = pickAssetByName('dog_run', [asset('a', 'dog_run_1.png', 1), asset('b', 'dog_run_2.png', 2)]);
    expect(amb.asset).toBeUndefined();
  });
  it('no match -> empty result', () => {
    expect(pickAssetByName('zzz', [asset('a', 'x.png', 1)])).toEqual({});
  });
});

describe('parseSpotDoc', () => {
  it('parses [tag] + inline or following-line body', () => {
    const r = parseSpotDoc('[intro] avatar1.mp4\n[city]\nlogo.png\n[end]');
    expect(r.errors).toEqual([]);
    expect(r.blocks).toEqual([
      { index: 0, tag: 'intro', body: 'avatar1.mp4' },
      { index: 1, tag: 'city', body: 'logo.png' },
      { index: 2, tag: 'end', body: '' },
    ]);
  });
  it('reports honest per-block errors: empty tag, leading text, no tags at all', () => {
    const r = parseSpotDoc('stray words\n[] x\n[ok] y');
    expect(r.blocks.map(b => b.tag)).toEqual(['ok']);
    expect(r.errors.map(e => e.reason)).toEqual(['text-before-first-tag', 'empty-tag']);
    expect(parseSpotDoc('just prose').errors[0]!.reason).toBe('no-tags');
  });
});

describe('bindSpotDoc', () => {
  const segments = [seg('s1', 'intro', 'Welcome to the show', 0), seg('s2', 'city', 'The city at night looks great', 2)];
  const assets = [asset('v1', 'avatar1.mp4', 1, 'video'), asset('i1', 'logo.png', 2), asset('au', 'vo.mp3', 3, 'audio')];
  const opts = () => ({ now: 100, newId: (() => { let n = 0; return () => `sp${++n}`; })() });

  it('binds tag->segment (exact), tag words within segment text (fallback), clip by name; records clipName', () => {
    const blocks = parseSpotDoc('[intro] avatar1.mp4\n[night] logo').blocks;
    const r = bindSpotDoc(blocks, segments, assets, opts());
    expect(r.spots).toEqual([
      { id: 'sp1', assetId: 'v1', clipName: 'avatar1.mp4', anchorSegmentId: 's1', offsetSec: 0, corner: 'top-right', heightPct: 40, source: 'doc', boundAt: 100 },
      { id: 'sp2', assetId: 'i1', clipName: 'logo', anchorSegmentId: 's2', offsetSec: 0, corner: 'top-right', heightPct: 40, source: 'doc', boundAt: 100 },
    ]);
    expect(r.findings).toEqual([]);
  });
  it('unmatched tag -> spot-segment-unmatched in the short clean wording, no spot', () => {
    const r = bindSpotDoc(parseSpotDoc('[intro] logo\n[nope] logo').blocks, segments, assets, opts());
    expect(r.spots).toHaveLength(1);
    expect(r.findings).toEqual([{ kind: 'spot-segment-unmatched', blockIndex: 1, message: '[nope]: No scene found for block 2.' }]);
  });
  it('body-less block -> an UNBOUND spot (honest [NO CLIP]); no guess, not dropped, no finding', () => {
    const r = bindSpotDoc(parseSpotDoc('[intro]').blocks, segments, assets, opts());
    expect(r.spots).toHaveLength(1);
    expect(r.spots[0]!.assetId).toBeUndefined();
    expect('clipName' in r.spots[0]!).toBe(false);
    expect(r.findings).toEqual([]);
  });
  it('named clip that matches nothing (audio never a candidate): unbound spot keeps clipName; EXACT wording', () => {
    const r = bindSpotDoc(parseSpotDoc('[intro] vo.mp3').blocks, segments, assets, opts());
    expect(r.spots[0]!.assetId).toBeUndefined();
    expect(r.spots[0]!.clipName).toBe('vo.mp3');
    expect(r.findings).toEqual([{ kind: 'spot-clip-unmatched', blockIndex: 0, message: '[intro]: No asset named "vo.mp3" found for block 1.' }]);
  });
  it('numbers blocks 1-based in doc order, verbatim name quotes', () => {
    const r = bindSpotDoc(parseSpotDoc('[intro] logo\n[city] avatar01').blocks, segments, assets, opts());
    expect(r.findings[0]!.message).toBe('[city]: No asset named "avatar01" found for block 2.');
  });
});
