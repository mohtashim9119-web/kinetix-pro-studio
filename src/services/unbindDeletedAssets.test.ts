/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { unbindDeletedAssets } from './unbindDeletedAssets';
import { autoMatchSegments } from './syncEngine';
import type { Asset, VideoSegment } from '../types';

const seg = (id: string, tag: string | undefined, assetId: string | undefined, text: string): VideoSegment =>
  ({ id, tag, assetId, text, startTime: 0, duration: 2, anchorStart: 0 }) as unknown as VideoSegment;

describe('unbindDeletedAssets', () => {
  it('unbinds only the scenes that used a removed asset; timings and others by reference', () => {
    const keep = seg('s1', 'a', 'x1', 'one');
    const gone = seg('s2', undefined, 'x2', 'two');
    const r = unbindDeletedAssets([keep, gone], new Set(['x2']));
    expect(r.segments[0]).toBe(keep);
    expect(r.segments[1]!.assetId).toBeUndefined();
    expect(r.segments[1]!.duration).toBe(2);
    expect(r.newlyUnbound).toEqual([2]);
  });

  it('OLD BUG (bleed): a TAGGED scene whose media was deleted is not fuzzy-guessed from its spoken text on the next import', () => {
    const decoy: Asset = { id: 'd1', name: 'city skyline.jpg', url: '', type: 'image' };
    const before = [seg('s1', '001_intro', 'x1', 'the city skyline at dawn')];
    // Without the flag (old behaviour) the spoken-text fuzzy pass would bind the decoy:
    const oldBehaviour = before.map(({ assetId: _a, ...s }) => s as VideoSegment);
    expect(autoMatchSegments([decoy], oldBehaviour)[0]!.assetId).toBe('d1');
    // With the flag it stays an honest placeholder until the wand finds its named file:
    const { segments } = unbindDeletedAssets(before, new Set(['x1']));
    expect(segments[0]!.unmatchedExplicitTag).toBe(true);
    expect(autoMatchSegments([decoy], segments)[0]!.assetId).toBeUndefined();
  });
});

// The full 0-media-build → add-media-later → wand loop, on the real parser.
import { parseProjectData, buildNoAssetSummaryEntry } from '../App';
import { matchMediaToScenes } from './matchMediaToScenes';

describe('U9 0-media build → media added later → wand', () => {
  const script = 'First line here. Second line here. Third line here.';
  const sceneDoc = '[001_intro]\nFirst line here.\n[002_city]\nSecond line here.\n[003_end]\nThird line here.';

  it('a 0-asset parse yields honest placeholders that KEEP their tags, and the stamped no-asset finding covers them', async () => {
    const segs = await parseProjectData(script, sceneDoc, [], 12);
    expect(segs).toHaveLength(3);
    expect(segs.every(s => !s.assetId)).toBe(true);
    expect(segs.map(s => s.tag)).toEqual(['001_intro', '002_city', '003_end']);
    expect(segs.every(s => s.unmatchedExplicitTag)).toBe(true);
    const entry = buildNoAssetSummaryEntry('run', [1, 2, 3], 3, 0);
    expect(entry?.type).toBe('no-asset');
  });

  it('after media arrives the autoMatch-on-import pass does not guess; the wand then fills by name with timings byte-equal', async () => {
    const segs = await parseProjectData(script, sceneDoc, [], 12);
    const timings = JSON.stringify(segs.map(s => [s.id, s.startTime, s.duration]));
    const assets: Asset[] = [
      { id: 'a1', name: '001_intro.png', url: '', type: 'image', addedAt: 1 },
      { id: 'a2', name: '002_city.mp4', url: '', type: 'video', addedAt: 2 },
    ];
    const afterImport = autoMatchSegments(assets, segs);
    expect(afterImport.every(s => !s.assetId)).toBe(true); // explicit tags are never fuzzy-guessed
    const r = matchMediaToScenes(assets, afterImport);
    expect(r.segments.map(s => s.assetId)).toEqual(['a1', 'a2', undefined]);
    expect(r.filled).toBe(2);
    expect(r.placeholders).toBe(1);
    expect(JSON.stringify(r.segments.map(s => [s.id, s.startTime, s.duration]))).toBe(timings);
  });
});
