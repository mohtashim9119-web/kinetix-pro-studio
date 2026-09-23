/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G6 Step 3 — old-bug-first tests for the consolidated zip-ingest path.
// Each test proves a specific bug the two retired implementations
// (`extractZipToAssets`, `processZipFile`) had, fixed once in `ingestZip`.
// See `zipIngest.ts`'s own doc comment for the full bug list.
// ---------------------------------------------------------------------------

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

// Not exercised by any test fixture here (all fixtures are images), but
// `zipIngest.ts` imports it at module scope — stub it so importing this
// module never touches a real Tauri IPC bridge.
vi.mock('./tauriFfmpeg', () => ({ probeVideoFps: vi.fn() }));

/** A fake JSZipObject — enough of the shape `ingestZip` actually reads
 *  (`name`, `dir`, `unsafeOriginalName`, `async('blob')`).
 *
 *  Real jszip (3.x) sets `unsafeOriginalName` on EVERY non-directory entry,
 *  unconditionally — it equals `name` (the resolved path) for a safe entry,
 *  and differs from it only for a genuine traversal entry whose raw path
 *  `resolve()` rewrote. Defaulting it to `undefined` here (as this fixture
 *  used to) doesn't match that contract and previously masked the
 *  `unsafeOriginalName !== undefined` bug — see `zipIngest.realjszip.test.ts`
 *  for coverage against the real dependency. */
function fakeEntry(
  name: string,
  bytes: Uint8Array,
  opts: { unsafeOriginalName?: string; sizeOverride?: number } = {},
): {
  name: string;
  dir: false;
  unsafeOriginalName?: string;
  async: (kind: string) => Promise<Blob>;
} {
  return {
    name,
    dir: false,
    unsafeOriginalName: opts.unsafeOriginalName ?? name,
    async: async (kind: string) => {
      if (kind !== 'blob') throw new Error(`fakeEntry only supports 'blob', got ${kind}`);
      const blob = new Blob([bytes]);
      if (opts.sizeOverride !== undefined) {
        Object.defineProperty(blob, 'size', { value: opts.sizeOverride });
      }
      return blob;
    },
  };
}

let mockZipFiles: Record<string, ReturnType<typeof fakeEntry>> = {};
vi.mock('jszip', () => ({
  // A regular `function`, not an arrow — `new JSZipModule()` in the real
  // code needs a constructible target (vitest's mock invokes it via
  // `Reflect.construct` when called with `new`, which throws on an arrow
  // function: arrow functions are never constructible).
  default: vi.fn().mockImplementation(function () {
    return { loadAsync: vi.fn().mockImplementation(async () => ({ files: mockZipFiles })) };
  }),
}));

import { ingestZip, ZipTooLargeError, ZIP_MAX_ENTRIES, ZIP_MAX_ENTRY_BYTES, ZIP_MAX_TOTAL_BYTES } from './zipIngest';

const PROJECT_ID = 'proj-1';
function zipFile(): File {
  return new File([new Uint8Array([0])], 'archive.zip');
}

beforeEach(() => {
  mockZipFiles = {};
  mockPutAsset.mockReset().mockResolvedValue(undefined);
  mockDeleteAsset.mockReset().mockResolvedValue(undefined);
  mockMediaVaultImportBytes.mockReset().mockResolvedValue(null);
});

describe('ingestZip — content-hash dedup replaces the old filename dedup', () => {
  it('OLD BUG (renamed-duplicate -> data survives twice): a renamed duplicate now dedupes to ONE imported asset and one vault write', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    mockZipFiles = {
      'photo.jpg': fakeEntry('photo.jpg', bytes),
      'photo_copy.jpg': fakeEntry('photo_copy.jpg', bytes), // same bytes, different name
    };

    const result = await ingestZip(PROJECT_ID, zipFile());

    expect(result.counts).toEqual({ imported: 1, deduped: 1, unsupportedSkipped: 0, failed: 0 });
    expect(result.assets).toHaveLength(1);
    expect(mockMediaVaultImportBytes).toHaveBeenCalledTimes(1);
  });

  it('OLD BUG (over-match data loss): same-name different-bytes are BOTH kept, never conflated', async () => {
    // folder1/video... and folder2/video... both reduce to display name
    // "clip.jpg" after `filename.split('/').pop()` — the exact shape that
    // made the old filename-dedup wrongly drop one of these.
    mockZipFiles = {
      'folder1/clip.jpg': fakeEntry('folder1/clip.jpg', new Uint8Array([1, 1, 1])),
      'folder2/clip.jpg': fakeEntry('folder2/clip.jpg', new Uint8Array([2, 2, 2])),
    };

    const result = await ingestZip(PROJECT_ID, zipFile());

    expect(result.counts).toEqual({ imported: 2, deduped: 0, unsupportedSkipped: 0, failed: 0 });
    expect(result.assets).toHaveLength(2);
    expect(result.assets[0]!.name).toBe('clip.jpg');
    expect(result.assets[1]!.name).toBe('clip.jpg');
    expect(result.assets[0]!.id).not.toBe(result.assets[1]!.id);
    expect(mockMediaVaultImportBytes).toHaveBeenCalledTimes(2);
  });

  it('unrecognized extensions are counted as unsupportedSkipped, never silently imported as an image', async () => {
    mockZipFiles = {
      'notes.txt': fakeEntry('notes.txt', new Uint8Array([1])),
      '.DS_Store': fakeEntry('.DS_Store', new Uint8Array([1])),
      'photo.jpg': fakeEntry('photo.jpg', new Uint8Array([9, 9, 9])),
    };

    const result = await ingestZip(PROJECT_ID, zipFile());

    expect(result.counts).toEqual({ imported: 1, deduped: 0, unsupportedSkipped: 2, failed: 0 });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.type).toBe('image');
  });
});

describe('ingestZip — traversal hardening (OLD BUG: neither retired function checked this)', () => {
  it('an unsafe (../) entry is rejected, never extracted', async () => {
    mockZipFiles = {
      // Real jszip resolves the raw `../../etc/passwd` entry to `etc/passwd`
      // (its `name`) while `unsafeOriginalName` keeps the raw, unresolved
      // path — the mismatch between the two is the actual unsafe signal.
      'etc/passwd': fakeEntry('etc/passwd', new Uint8Array([1]), {
        unsafeOriginalName: '../../etc/passwd',
      }),
      'safe.jpg': fakeEntry('safe.jpg', new Uint8Array([2, 2])),
    };

    const result = await ingestZip(PROJECT_ID, zipFile());

    expect(result.counts).toEqual({ imported: 1, deduped: 0, unsupportedSkipped: 0, failed: 1 });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.name).toBe('safe.jpg');
    expect(mockPutAsset).toHaveBeenCalledTimes(1);
  });
});

describe('ingestZip — bomb caps (OLD BUG: neither retired function had any)', () => {
  it('oversized total decompressed size -> a typed failure, not a silent truncation', async () => {
    mockZipFiles = {
      'huge.jpg': fakeEntry('huge.jpg', new Uint8Array([1]), { sizeOverride: ZIP_MAX_TOTAL_BYTES + 1 }),
    };

    await expect(ingestZip(PROJECT_ID, zipFile())).rejects.toBeInstanceOf(ZipTooLargeError);
  });

  it('a single oversized entry -> a typed failure', async () => {
    mockZipFiles = {
      'huge.jpg': fakeEntry('huge.jpg', new Uint8Array([1]), { sizeOverride: ZIP_MAX_ENTRY_BYTES + 1 }),
    };

    await expect(ingestZip(PROJECT_ID, zipFile())).rejects.toBeInstanceOf(ZipTooLargeError);
  });

  it('too many entries -> a typed failure before any extraction is attempted', async () => {
    mockZipFiles = {};
    for (let i = 0; i < ZIP_MAX_ENTRIES + 1; i++) {
      mockZipFiles[`img${i}.jpg`] = fakeEntry(`img${i}.jpg`, new Uint8Array([1]));
    }

    await expect(ingestZip(PROJECT_ID, zipFile())).rejects.toBeInstanceOf(ZipTooLargeError);
    expect(mockPutAsset).not.toHaveBeenCalled();
  });
});

describe('ingestZip — write-through failure handling', () => {
  it('a failed IndexedDB write is counted as failed, never silently dropped from the count', async () => {
    mockZipFiles = { 'photo.jpg': fakeEntry('photo.jpg', new Uint8Array([1, 2, 3])) };
    mockPutAsset.mockRejectedValueOnce(new Error('disk full'));

    const result = await ingestZip(PROJECT_ID, zipFile());

    expect(result.counts).toEqual({ imported: 0, deduped: 0, unsupportedSkipped: 0, failed: 1 });
    expect(mockMediaVaultImportBytes).not.toHaveBeenCalled();
  });

  it('a failed media-vault write rolls back the IndexedDB write and counts as failed — never IndexedDB-only', async () => {
    mockZipFiles = { 'photo.jpg': fakeEntry('photo.jpg', new Uint8Array([1, 2, 3])) };
    mockMediaVaultImportBytes.mockRejectedValueOnce(new Error('vault write failed'));

    const result = await ingestZip(PROJECT_ID, zipFile());

    expect(result.counts).toEqual({ imported: 0, deduped: 0, unsupportedSkipped: 0, failed: 1 });
    expect(mockPutAsset).toHaveBeenCalledTimes(1);
    expect(mockDeleteAsset).toHaveBeenCalledTimes(1);
  });
});

describe('ingestZip — voiceover auto-assignment', () => {
  it('the first audio entry becomes audioAssetId', async () => {
    mockZipFiles = {
      'photo.jpg': fakeEntry('photo.jpg', new Uint8Array([1])),
      'voice.mp3': fakeEntry('voice.mp3', new Uint8Array([2, 2])),
    };

    const result = await ingestZip(PROJECT_ID, zipFile());

    expect(result.audioAssetId).toBeDefined();
    const audioAsset = result.assets.find(a => a.type === 'audio');
    expect(result.audioAssetId).toBe(audioAsset?.id);
  });
});
