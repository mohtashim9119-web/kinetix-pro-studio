// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPutAsset = vi.fn();
const mockDeleteAsset = vi.fn();
vi.mock('./assetStore', () => ({
  putAsset: (...args: unknown[]) => mockPutAsset(...args),
  deleteAsset: (...args: unknown[]) => mockDeleteAsset(...args),
}));

const mockMediaVaultImportBytes = vi.fn();
vi.mock('./mediaVaultClient', () => ({
  mediaVaultImportBytes: (...args: unknown[]) => mockMediaVaultImportBytes(...args),
}));

vi.mock('./tauriFfmpeg', () => ({ probeVideoFps: vi.fn() }));

import { detectMediaType, ingestOneMediaFile, ingestLooseFiles, type MediaIngestCounts } from './mediaIngest';

const PROJECT_ID = 'proj-1';

beforeEach(() => {
  mockPutAsset.mockReset().mockResolvedValue(undefined);
  mockDeleteAsset.mockReset().mockResolvedValue(undefined);
  mockMediaVaultImportBytes.mockReset().mockResolvedValue(null);
});

function emptyCounts(): MediaIngestCounts {
  return { imported: 0, deduped: 0, unsupportedSkipped: 0, failed: 0 };
}

describe('detectMediaType', () => {
  it('recognizes video/audio/image extensions and returns undefined for anything else', () => {
    expect(detectMediaType('clip.mp4')).toBe('video');
    expect(detectMediaType('song.mp3')).toBe('audio');
    expect(detectMediaType('photo.jpg')).toBe('image');
    expect(detectMediaType('notes.txt')).toBeUndefined();
    expect(detectMediaType('.DS_Store')).toBeUndefined();
  });
});

describe('ingestOneMediaFile — the shared write-through (zip + loose-file/folder ingest)', () => {
  it('writes through IndexedDB and the vault, returning a fully-formed Asset', async () => {
    const counts = emptyCounts();
    const asset = await ingestOneMediaFile(
      PROJECT_ID, 'photo.jpg', new Blob([new Uint8Array([1, 2, 3])]), 'image', new Set(), counts,
    );
    expect(asset).not.toBeNull();
    expect(asset!.name).toBe('photo.jpg');
    expect(asset!.type).toBe('image');
    expect(counts).toEqual({ imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 });
    expect(mockPutAsset).toHaveBeenCalledTimes(1);
    expect(mockMediaVaultImportBytes).toHaveBeenCalledTimes(1);
  });

  it('G6 Step 5 — stamps contentHash on the returned Asset, so a freshly-imported asset never needs the lazy backfill', async () => {
    const asset = await ingestOneMediaFile(
      PROJECT_ID, 'photo.jpg', new Blob([new Uint8Array([1, 2, 3])]), 'image', new Set(), emptyCounts(),
    );
    expect(asset!.contentHash).toBeDefined();
    expect(asset!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('dedupes against a caller-supplied seenHashes set, across calls', async () => {
    const counts = emptyCounts();
    const seenHashes = new Set<string>();
    const bytes = new Uint8Array([9, 9, 9]);
    const first = await ingestOneMediaFile(PROJECT_ID, 'a.jpg', new Blob([bytes]), 'image', seenHashes, counts);
    const second = await ingestOneMediaFile(PROJECT_ID, 'b.jpg', new Blob([bytes]), 'image', seenHashes, counts);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(counts).toEqual({ imported: 1, deduped: 1, unsupportedSkipped: 0, failed: 0 });
  });

  it('rolls back the IndexedDB write when the vault write fails, never leaving it IndexedDB-only', async () => {
    mockMediaVaultImportBytes.mockRejectedValueOnce(new Error('vault down'));
    const counts = emptyCounts();
    const asset = await ingestOneMediaFile(
      PROJECT_ID, 'photo.jpg', new Blob([new Uint8Array([1])]), 'image', new Set(), counts,
    );
    expect(asset).toBeNull();
    expect(counts.failed).toBe(1);
    expect(mockDeleteAsset).toHaveBeenCalledTimes(1);
  });
});

describe('ingestLooseFiles — the Media block\'s "add loose files / add folder" door', () => {
  it('imports every supported file and counts unsupported ones as unsupportedSkipped', async () => {
    // Images and audio only here — jsdom's <video>/<audio> elements never
    // fire loadedmetadata/error for a fake blob URL, so a video fixture
    // would hang `getMediaDuration` forever. Video-extension recognition is
    // already covered by the `detectMediaType` unit test above.
    const files = [
      new File([new Uint8Array([1])], 'photo.jpg'),
      new File([new Uint8Array([2])], 'notes.txt'),
      new File([new Uint8Array([3, 3])], 'voice.mp3'),
    ];
    const result = await ingestLooseFiles(PROJECT_ID, files);
    expect(result.counts).toEqual({ imported: 2, deduped: 0, unsupportedSkipped: 1, failed: 0 });
    expect(result.assets.map(a => a.name).sort()).toEqual(['photo.jpg', 'voice.mp3']);
  });

  it('a macOS folder\'s `.DS_Store` and `._` twins are dropped silently — not assets, not unsupported', async () => {
    // A `<input webkitdirectory>` File carries its folder-relative path in
    // `webkitRelativePath`; jsdom's File leaves it '' so set it the way a
    // real folder pick would.
    const inFolder = (bytes: Uint8Array, rel: string): File => {
      const f = new File([bytes], rel.split('/').pop()!);
      Object.defineProperty(f, 'webkitRelativePath', { value: rel });
      return f;
    };
    const files = [
      inFolder(new Uint8Array([0, 0, 1]), 'Shoot/.DS_Store'),
      inFolder(new Uint8Array([0, 5, 22, 7]), 'Shoot/._photo.jpg'),
      inFolder(new Uint8Array([1]), 'Shoot/photo.jpg'),
      inFolder(new Uint8Array([0, 5, 22, 7, 1]), 'Shoot/__MACOSX/whatever.jpg'),
    ];
    const result = await ingestLooseFiles(PROJECT_ID, files);
    expect(result.counts).toEqual({ imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 });
    expect(result.assets.map(a => a.name)).toEqual(['photo.jpg']);
  });

  it('a folder picker\'s duplicate files (same content) dedupe within the batch, same as zip ingest', async () => {
    const bytes = new Uint8Array([7, 7, 7]);
    const files = [
      new File([bytes], 'a.jpg'),
      new File([bytes], 'a-copy.jpg'),
    ];
    const result = await ingestLooseFiles(PROJECT_ID, files);
    expect(result.counts).toEqual({ imported: 1, deduped: 1, unsupportedSkipped: 0, failed: 0 });
  });

  it('the first audio file becomes audioAssetId', async () => {
    const files = [
      new File([new Uint8Array([1])], 'photo.jpg'),
      new File([new Uint8Array([2])], 'voice.mp3'),
    ];
    const result = await ingestLooseFiles(PROJECT_ID, files);
    const audioAsset = result.assets.find(a => a.type === 'audio');
    expect(result.audioAssetId).toBe(audioAsset?.id);
  });

  // G6 polish item 1 — OLD BUG proof: two separate `ingestLooseFiles` calls
  // (i.e. two separate "add files" clicks, exactly what MediaBlock used to
  // do — no `existingHashes` arg existed at all) each get their own fresh
  // dedup set, so the SAME bytes imported twice via two doors produces TWO
  // Asset records sharing one contentHash. This is intentional/expected
  // when the caller passes nothing — it documents why `existingHashes` had
  // to be threaded through from the caller (MediaBlock), not fixed here.
  it('OLD BUG (documented): two separate calls with no existingHashes each dedupe only within their own batch, stacking a duplicate Asset', async () => {
    const bytes = new Uint8Array([5, 5, 5]);
    const first = await ingestLooseFiles(PROJECT_ID, [new File([bytes], 'clip.mp3')]);
    const second = await ingestLooseFiles(PROJECT_ID, [new File([bytes], 'clip.mp3')]);
    expect(first.assets).toHaveLength(1);
    expect(second.assets).toHaveLength(1); // bug: not deduped against the first call
    expect(second.assets[0]!.contentHash).toBe(first.assets[0]!.contentHash);
    expect(second.assets[0]!.id).not.toBe(first.assets[0]!.id);
  });

  it('FIXED: seeding existingHashes with the first call\'s contentHash makes the second import dedupe, producing NO new Asset record', async () => {
    const bytes = new Uint8Array([5, 5, 5]);
    const first = await ingestLooseFiles(PROJECT_ID, [new File([bytes], 'clip.mp3')]);
    const existingHashes = first.assets.map(a => a.contentHash!);
    const second = await ingestLooseFiles(PROJECT_ID, [new File([bytes], 'clip.mp3')], existingHashes);
    expect(second.assets).toHaveLength(0);
    expect(second.counts).toEqual({ imported: 0, deduped: 1, unsupportedSkipped: 0, failed: 0 });
    expect(second.duplicateNames).toEqual(['clip.mp3']);
  });

  it('different bytes, same name -> both kept (not treated as a duplicate)', async () => {
    const first = await ingestLooseFiles(PROJECT_ID, [new File([new Uint8Array([1])], 'clip.mp3')]);
    const existingHashes = first.assets.map(a => a.contentHash!);
    const second = await ingestLooseFiles(PROJECT_ID, [new File([new Uint8Array([2])], 'clip.mp3')], existingHashes);
    expect(second.assets).toHaveLength(1);
    expect(second.counts).toEqual({ imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 0 });
    expect(second.duplicateNames).toEqual([]);
  });
});
