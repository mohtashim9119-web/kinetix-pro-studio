/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Media workflow Unit 2 — "Match media to scenes": the reconcile-to-names
// tool. Registered decisions: a name match OVERWRITES the current
// assignment (manual picks included); a scene with no name match keeps what
// it has; same-name ambiguity -> the oldest asset wins, reported. Never
// touches timings — assignment only.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { matchMediaToScenes, summarizeMediaMatch } from './matchMediaToScenes';
import type { Asset, VideoSegment } from '../types';

const img = (id: string, name: string, addedAt: number): Asset => ({ id, name, url: '', type: 'image', addedAt });
const seg = (id: string, tag: string | undefined, assetId: string | undefined, startTime: number, duration: number): VideoSegment =>
  ({ id, tag, assetId, text: `scene ${id}`, startTime, duration, anchorStart: startTime }) as unknown as VideoSegment;

describe('matchMediaToScenes', () => {
  it('OLD BUG: deliberately swapped assignments + correct names -> reconciled to the names; timings byte-identical', () => {
    const assets = [img('a1', '001_intro.png', 1), img('a2', '002_city.png', 2), img('a3', '003_end.jpg', 3)];
    const segments = [
      seg('s1', '001_intro', 'a3', 0, 2.5),   // wrong
      seg('s2', '002_city', 'a1', 2.5, 3.25), // wrong
      seg('s3', '003_end', undefined, 5.75, 4), // empty
    ];
    const before = JSON.stringify(segments.map(s => [s.id, s.startTime, s.duration, s.anchorStart]));

    const r = matchMediaToScenes(assets, segments);

    expect(r.segments.map(s => s.assetId)).toEqual(['a1', 'a2', 'a3']);
    expect(JSON.stringify(r.segments.map(s => [s.id, s.startTime, s.duration, s.anchorStart]))).toBe(before);
    expect(r.matched).toBe(3);
    expect(r.unmatched).toEqual([]);
  });

  it('a scene with no name match keeps its current assignment (by reference) and is named as unmatched', () => {
    const assets = [img('a1', '001_intro.png', 1), img('a9', 'manual_pick.png', 2)];
    const s2 = seg('s2', 'missing_file', 'a9', 2, 2);
    const s3 = seg('s3', undefined, 'a9', 4, 2);
    const r = matchMediaToScenes(assets, [seg('s1', '001_intro', undefined, 0, 2), s2, s3]);

    expect(r.segments[1]).toBe(s2);
    expect(r.segments[2]).toBe(s3);
    expect(r.matched).toBe(1);
    expect(r.unmatched).toEqual(['missing_file', 'S3']);
  });

  it('same-name ambiguity: the OLDEST asset wins, and the ambiguity is reported', () => {
    const assets = [img('new', '001_intro.jpg', 20), img('old', '001_intro.png', 10)];
    const r = matchMediaToScenes(assets, [seg('s1', '001_intro', undefined, 0, 2)]);
    expect(r.segments[0]!.assetId).toBe('old');
    expect(r.ambiguous).toEqual([{ name: '001_intro', count: 2 }]);
  });

  it('reuses the matcher tiers: a unique contiguous-word match assigns; an ambiguous one does not', () => {
    const assets = [img('a1', 'year_2003_2342368767.jpg', 1), img('b1', 'dog_run_1.png', 2), img('b2', 'dog_run_2.png', 3)];
    const r = matchMediaToScenes(assets, [seg('s1', 'year_2003', undefined, 0, 1), seg('s2', 'dog_run', undefined, 1, 1)]);
    expect(r.segments[0]!.assetId).toBe('a1');
    expect(r.segments[1]!.assetId).toBeUndefined();
    expect(r.unmatched).toEqual(['dog_run']);
  });

  it('a newly matched scene loses its unmatchedExplicitTag flag; audio (voiceover) is never a candidate', () => {
    const assets = [img('a1', '001_intro.png', 1), { id: 'vo', name: '002_vo.mp3', url: '', type: 'audio' } as Asset];
    const flagged = { ...seg('s1', '001_intro', undefined, 0, 1), unmatchedExplicitTag: true } as VideoSegment;
    const r = matchMediaToScenes(assets, [flagged, seg('s2', '002_vo', undefined, 1, 1)]);
    expect(r.segments[0]!.assetId).toBe('a1');
    expect(r.segments[0]!.unmatchedExplicitTag).toBeUndefined();
    expect(r.segments[1]!.assetId).toBeUndefined();
  });
});

// Wave 3 U9 A3 — the wand fills the [NO ASSET] placeholders of a 0-media build.
describe('matchMediaToScenes — filling unbound scenes (media added after the build)', () => {
  it('OLD-BUG-FIRST shape: a 0-media build (every scene unbound, tags kept) fills by name once media exists; timings byte-identical', () => {
    const segments = [
      { ...seg('s1', '001_intro', undefined, 0, 2.5), unmatchedExplicitTag: true } as VideoSegment,
      { ...seg('s2', '002_city', undefined, 2.5, 3.25), unmatchedExplicitTag: true } as VideoSegment,
      { ...seg('s3', 'nothing_named_this', undefined, 5.75, 4), unmatchedExplicitTag: true } as VideoSegment,
    ];
    const before = JSON.stringify(segments.map(s => [s.id, s.startTime, s.duration, s.anchorStart]));
    const assets = [img('a1', '001_intro.png', 1), img('a2', '002_city.mp4', 2)];

    const r = matchMediaToScenes(assets, segments);

    expect(r.segments.map(s => s.assetId)).toEqual(['a1', 'a2', undefined]);
    expect(r.segments[0]!.unmatchedExplicitTag).toBeUndefined();
    expect(r.segments[2]!.unmatchedExplicitTag).toBe(true); // honest placeholder stays flagged
    expect(JSON.stringify(r.segments.map(s => [s.id, s.startTime, s.duration, s.anchorStart]))).toBe(before);
    expect(r.filled).toBe(2);
    expect(r.placeholders).toBe(1);
    expect(summarizeMediaMatch(r)).toEqual({ matched: 2, unmatched: 1, filled: 2, placeholders: 1, conflicts: 0 });
  });

  it('a re-run on an already-filled project fills nothing new and is stable (idempotent)', () => {
    const assets = [img('a1', '001_intro.png', 1)];
    const first = matchMediaToScenes(assets, [seg('s1', '001_intro', undefined, 0, 2)]);
    const second = matchMediaToScenes(assets, first.segments);
    expect(second.filled).toBe(0);
    expect(second.segments[0]).toBe(first.segments[0]);
  });

  it('conflicts are counted in the summary (oldest wins)', () => {
    const assets = [img('new', '001_intro.jpg', 20), img('old', '001_intro.png', 10)];
    const r = matchMediaToScenes(assets, [seg('s1', '001_intro', undefined, 0, 2)]);
    expect(summarizeMediaMatch(r).conflicts).toBe(1);
  });
});

// App wiring (source scan, same convention as applySyncCancelInvariant):
// the button's handler writes ONLY `segments` (from the matcher) plus the
// one finding — no sync, no timing/provenance/spine field.
describe('App wiring — handleMatchMedia', () => {
  const src = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
  const start = src.indexOf('const handleMatchMedia = useCallback(');
  const body = src.slice(start, src.indexOf('}, []);', start));

  it('is assignment-only and wired to the Media block', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('matchMediaToScenes(prev.assets, prev.segments)');
    expect(body).toContain('{ ...prev, segments: result.segments }');
    expect(body).toContain('buildMediaMatchEntry(');
    expect(body).not.toMatch(/timingProvenance|lastSyncSpine|handleApplySync|startTime|duration/);
    expect(src).toContain('onMatchMedia={handleMatchMedia}');
  });
});
