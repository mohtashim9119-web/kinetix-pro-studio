/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Media workflow Unit 3 — the assignment a tile drop makes. User choice is
// authoritative (no name logic); assignment only — timings byte-identical.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { assignAssetToSegment } from './assetDragChannel';
import type { Asset, VideoSegment } from '../types';

const assets = [{ id: 'a1', name: 'totally_unrelated_name.png', url: '', type: 'image' }] as Asset[];
const segs = [
  { id: 's1', tag: '001_intro', assetId: 'old', text: '', startTime: 0, duration: 2.125, anchorStart: 0 },
  { id: 's2', tag: '002_city', text: '', startTime: 2.125, duration: 3, anchorStart: 2.125, unmatchedExplicitTag: true },
] as unknown as VideoSegment[];

describe('assignAssetToSegment', () => {
  it('sets assetId on exactly that segment, ignoring names; timings byte-identical; others by reference', () => {
    const before = JSON.stringify(segs.map(s => [s.startTime, s.duration, s.anchorStart]));
    const next = assignAssetToSegment(segs, assets, 's2', 'a1');
    expect(next[1]!.assetId).toBe('a1');
    expect(next[1]!.unmatchedExplicitTag).toBeUndefined();
    expect(next[0]).toBe(segs[0]);
    expect(JSON.stringify(next.map(s => [s.startTime, s.duration, s.anchorStart]))).toBe(before);
  });

  it('an unknown asset or segment id is a no-op (same array)', () => {
    expect(assignAssetToSegment(segs, assets, 's1', 'nope')).toBe(segs);
    expect(assignAssetToSegment(segs, assets, 'nope', 'a1')).toBe(segs);
  });
});

describe('App wiring — handleAssignAssetToSegment', () => {
  const src = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
  const start = src.indexOf('const handleAssignAssetToSegment = useCallback(');
  const body = src.slice(start, src.indexOf('}, []);', start));
  it('is assignment-only (no sync, no timing fields) and wired to the Timeline', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('assignAssetToSegment(prev.segments, prev.assets, segmentId, assetId)');
    expect(body).not.toMatch(/timingProvenance|lastSyncSpine|handleApplySync|startTime|duration/);
    expect(src).toContain('onAssignAssetToSegment={handleAssignAssetToSegment}');
  });
});
