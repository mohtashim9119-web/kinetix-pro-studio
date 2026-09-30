/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { assetHealth, buildAssetHealthEntry, repointFromCorrupt, HEALTH_STATE_FINDING_KIND } from './assetHealth';
import { attentionKindForEntry } from './syncLogUserView';
import type { Asset, VideoSegment } from '../types';

const a = (id: string, over: Partial<Asset> = {}): Asset =>
  ({ id, name: `${id}.png`, url: '', type: 'image', contentHash: `h-${id}`, ...over }) as Asset;
const seg = (id: string, assetId: string | undefined, extra: Partial<VideoSegment> = {}): VideoSegment =>
  ({ id, assetId, text: id, startTime: 0, duration: 1, ...extra }) as VideoSegment;

describe('assetHealth — the four states', () => {
  it('available: resolved and hashed', () => expect(assetHealth(a('1'))).toBe('available'));
  it('unverified: resolved but no content hash', () => expect(assetHealth(a('1', { contentHash: undefined }))).toBe('unverified'));
  it('missing: offline', () => expect(assetHealth(a('1', { unresolved: true }))).toBe('missing'));
  it('corrupt: bytes present, decode failed', () => expect(assetHealth(a('1', { corrupt: 'no-frame' }))).toBe('corrupt'));
  it('precedence: missing beats a stale corrupt flag; corrupt beats unverified', () => {
    expect(assetHealth(a('1', { unresolved: true, corrupt: 'image-decode' }))).toBe('missing');
    expect(assetHealth(a('1', { corrupt: 'image-decode', contentHash: undefined }))).toBe('corrupt');
  });
});

describe('typed findings — machine-readable kind, never prose', () => {
  it('each non-available state maps to its own finding kind', () => {
    expect(HEALTH_STATE_FINDING_KIND).toEqual({ missing: 'asset-missing', unverified: 'asset-unverified', corrupt: 'asset-corrupt' });
  });

  it('the entry carries finding.kind + count and is a media-import (Imports bucket) entry', () => {
    const e = buildAssetHealthEntry('run', 'asset-corrupt', [a('1', { corrupt: 'no-frame' })]);
    expect(e.finding).toEqual({ kind: 'asset-corrupt', count: 1 });
    expect(e.type).toBe('media-import');
    expect(e.severity).toBe('warning');
    expect(attentionKindForEntry(e)).toBeUndefined(); // details-only, in the Imports bucket (no new attention surface)
    expect(e.message).toContain('Nothing was deleted');
  });

  it('a copy edit cannot change the kind: kind is set at build time for all four', () => {
    for (const kind of ['asset-missing', 'asset-unverified', 'asset-corrupt', 'asset-replaced'] as const) {
      expect(buildAssetHealthEntry('r', kind, [a('1'), a('2')]).finding).toEqual({ kind, count: 2 });
    }
  });
});

describe('repointFromCorrupt — re-upload replaces via name, destroys nothing', () => {
  const bad = a('bad', { name: 'Shot_01.png', corrupt: 'image-decode' });
  const fresh = a('fresh', { name: 'shot_01.PNG' });

  it('moves the corrupt file\'s scenes to the same-named healthy file, keeping provenance; the corrupt asset is NOT removed', () => {
    const segments = [seg('s1', 'bad', { assetAssignedBy: 'manual' }), seg('s2', 'other')];
    const r = repointFromCorrupt([bad], [fresh], segments);
    expect(r.segments[0]).toMatchObject({ assetId: 'fresh', assetAssignedBy: 'manual' });
    expect(r.segments[1]).toBe(segments[1]);
    expect(r.replaced).toEqual([bad]);
  });

  it('a different name, a healthy old file, or a corrupt newcomer moves nothing (same array back)', () => {
    const segments = [seg('s1', 'bad')];
    expect(repointFromCorrupt([bad], [a('x', { name: 'other.png' })], segments).segments).toBe(segments);
    expect(repointFromCorrupt([a('ok', { name: 'shot_01.png' })], [fresh], segments).segments).toBe(segments);
    expect(repointFromCorrupt([bad], [a('n', { name: 'shot_01.png', corrupt: 'image-decode' })], segments).segments).toBe(segments);
  });
});
