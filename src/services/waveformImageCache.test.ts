import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  putImage,
  peekImage,
  getPersistedImage,
  deleteImagesForAsset,
  deleteAllImagesForProject,
  _resetWaveformImageMirrorForTests,
  IMAGE_MIRROR_MAX_ENTRIES,
} from './waveformImageCache';

// Mirrors waveformStore.test.ts's conventions: fake-indexeddb/auto polyfill,
// plain node vitest environment (Blob + URL.createObjectURL are both real
// Node globals here, no jsdom needed), unique id namespaces per test since
// the fake IDBFactory has no "delete all databases" primitive.

function makeImage(tag: string): Blob {
  return new Blob([`png-bytes-${tag}`], { type: 'image/png' });
}

let counter = 0;
function freshIds(): { projectId: string; assetId: string; segmentId: string } {
  counter += 1;
  return { projectId: `project-${counter}`, assetId: `asset-${counter}`, segmentId: `segment-${counter}` };
}

beforeEach(() => {
  _resetWaveformImageMirrorForTests();
});

describe('waveformImageCache — Tier 1 (in-memory) roundtrip', () => {
  it('putImage immediately populates a synchronous peekImage hit', async () => {
    const { projectId, assetId, segmentId } = freshIds();
    await putImage(projectId, assetId, 1000, segmentId, 0, 5, makeImage('a'));

    const url = peekImage(assetId, 1000, segmentId, 0, 5);
    expect(url).toBeDefined();
    expect(url).toMatch(/^blob:/);
  });

  it('peekImage misses for an unseen key', () => {
    const { assetId, segmentId } = freshIds();
    expect(peekImage(assetId, 1000, segmentId, 0, 5)).toBeUndefined();
  });

  it('a different blobSize, segmentId, startTime, or duration is a distinct key (miss)', async () => {
    const { projectId, assetId, segmentId } = freshIds();
    await putImage(projectId, assetId, 1000, segmentId, 0, 5, makeImage('a'));

    expect(peekImage(assetId, 1001, segmentId, 0, 5)).toBeUndefined();
    expect(peekImage(assetId, 1000, `${segmentId}-other`, 0, 5)).toBeUndefined();
    expect(peekImage(assetId, 1000, segmentId, 1, 5)).toBeUndefined();
    expect(peekImage(assetId, 1000, segmentId, 0, 6)).toBeUndefined();
  });
});

describe('waveformImageCache — Tier 2 (IndexedDB) survives a Tier-1 reset ("app restart")', () => {
  it('getPersistedImage resolves a persisted record and rehydrates Tier 1', async () => {
    const { projectId, assetId, segmentId } = freshIds();
    await putImage(projectId, assetId, 2000, segmentId, 1.5, 3.25, makeImage('b'));

    // Simulate a fresh app session: Tier 1 wiped, only Tier 2 (IndexedDB) remains.
    _resetWaveformImageMirrorForTests();
    expect(peekImage(assetId, 2000, segmentId, 1.5, 3.25)).toBeUndefined();

    const url = await getPersistedImage(projectId, assetId, segmentId, 2000, 1.5, 3.25);
    expect(url).toMatch(/^blob:/);
    // The lookup also rehydrated Tier 1 — a subsequent sync peek now hits.
    expect(peekImage(assetId, 2000, segmentId, 1.5, 3.25)).toBe(url);
  });

  it('getPersistedImage returns undefined when the stored blobSize no longer matches', async () => {
    const { projectId, assetId, segmentId } = freshIds();
    await putImage(projectId, assetId, 2000, segmentId, 0, 4, makeImage('c'));
    _resetWaveformImageMirrorForTests();

    const url = await getPersistedImage(projectId, assetId, segmentId, 9999, 0, 4);
    expect(url).toBeUndefined();
    expect(peekImage(assetId, 9999, segmentId, 0, 4)).toBeUndefined();
  });

  it('getPersistedImage returns undefined for an unwritten (projectId, assetId, segmentId)', async () => {
    const { projectId, assetId, segmentId } = freshIds();
    expect(await getPersistedImage(projectId, assetId, segmentId, 10, 0, 1)).toBeUndefined();
  });

  it('getPersistedImage only resolves the exact (projectId, assetId, segmentId) triple', async () => {
    const { projectId, assetId, segmentId } = freshIds();
    const otherAssetId = `${assetId}-sibling`;
    await putImage(projectId, assetId, 3000, segmentId, 0, 2, makeImage('d'));
    await putImage(projectId, otherAssetId, 3000, segmentId, 0, 2, makeImage('e'));
    _resetWaveformImageMirrorForTests();

    expect(await getPersistedImage(projectId, assetId, segmentId, 3000, 0, 2)).toMatch(/^blob:/);
    expect(peekImage(otherAssetId, 3000, segmentId, 0, 2)).toBeUndefined();
  });
});

describe('waveformImageCache — invalidation', () => {
  it('deleteImagesForAsset removes only the targeted asset, from both tiers', async () => {
    const { projectId, assetId, segmentId } = freshIds();
    const otherAssetId = `${assetId}-sibling`;
    await putImage(projectId, assetId, 10, segmentId, 0, 1, makeImage('f'));
    await putImage(projectId, otherAssetId, 10, segmentId, 0, 1, makeImage('g'));

    await deleteImagesForAsset(projectId, assetId);

    // Tier 1 swept immediately.
    expect(peekImage(assetId, 10, segmentId, 0, 1)).toBeUndefined();
    expect(peekImage(otherAssetId, 10, segmentId, 0, 1)).toMatch(/^blob:/);

    // Tier 2 also cleared for the deleted asset — a post-reset lookup finds nothing.
    _resetWaveformImageMirrorForTests();
    expect(await getPersistedImage(projectId, assetId, segmentId, 10, 0, 1)).toBeUndefined();
    expect(await getPersistedImage(projectId, otherAssetId, segmentId, 10, 0, 1)).toMatch(/^blob:/);
  });

  it('deleteAllImagesForProject clears Tier 2 for a project but leaves other projects intact', async () => {
    const { projectId, assetId, segmentId } = freshIds();
    const otherProjectId = `${projectId}-other`;
    await putImage(projectId, assetId, 10, segmentId, 0, 1, makeImage('h'));
    await putImage(projectId, `${assetId}-2`, 10, segmentId, 0, 1, makeImage('i'));
    await putImage(otherProjectId, assetId, 10, segmentId, 0, 1, makeImage('j'));

    await deleteAllImagesForProject(projectId);
    _resetWaveformImageMirrorForTests();

    expect(await getPersistedImage(projectId, assetId, segmentId, 10, 0, 1)).toBeUndefined();
    expect(await getPersistedImage(projectId, `${assetId}-2`, segmentId, 10, 0, 1)).toBeUndefined();
    expect(await getPersistedImage(otherProjectId, assetId, segmentId, 10, 0, 1)).toMatch(/^blob:/);
  });
});

describe('waveformImageCache — Tier 1 LRU eviction', () => {
  it('evicts the least-recently-used entry once over IMAGE_MIRROR_MAX_ENTRIES', async () => {
    const { projectId, assetId } = freshIds();
    const firstSegmentId = 'segment-0';
    await putImage(projectId, assetId, 10, firstSegmentId, 0, 1, makeImage('first'));

    // Fill past the cap with distinct keys so the first entry ages out.
    for (let i = 1; i <= IMAGE_MIRROR_MAX_ENTRIES; i++) {
      await putImage(projectId, assetId, 10, `segment-${i}`, i, 1, makeImage(`fill-${i}`));
    }

    expect(peekImage(assetId, 10, firstSegmentId, 0, 1)).toBeUndefined();
    // A recently-inserted entry is still resident.
    expect(peekImage(assetId, 10, `segment-${IMAGE_MIRROR_MAX_ENTRIES}`, IMAGE_MIRROR_MAX_ENTRIES, 1)).toMatch(/^blob:/);
  }, 20000);
});
