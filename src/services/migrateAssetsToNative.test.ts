/**
 * WS3 item B — one-time (idempotent-every-boot) IndexedDB → native asset
 * migration. Mocks `assetStore.ts` (IndexedDB), `projectStore.ts`'s
 * `loadAllMetas`, and `nativeAssetStore.ts` (the native store client).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));

const mockGetAllAssetsForProject = vi.fn();
vi.mock('./assetStore', () => ({
  getAllAssetsForProject: (projectId: string) => mockGetAllAssetsForProject(projectId),
}));

const mockLoadAllMetas = vi.fn();
vi.mock('./projectStore', () => ({
  loadAllMetas: () => mockLoadAllMetas(),
}));

const mockGetAssetStatusNative = vi.fn();
const mockWriteAssetBlobNative = vi.fn();
vi.mock('./nativeAssetStore', () => ({
  getAssetStatusNative: (projectId: string, assetIds: string[]) => mockGetAssetStatusNative(projectId, assetIds),
  writeAssetBlobNative: (...a: unknown[]) => mockWriteAssetBlobNative(...a),
}));

import { migrateIndexedDbAssetsToNative } from './migrateAssetsToNative';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadAllMetas.mockReturnValue([{ id: 'p1', name: 'P1', savedAt: 1, segmentCount: 1 }]);
  mockGetAllAssetsForProject.mockResolvedValue([]);
  mockGetAssetStatusNative.mockResolvedValue([]);
  mockWriteAssetBlobNative.mockResolvedValue(undefined);
});

describe('migrateIndexedDbAssetsToNative', () => {
  it('writes every IndexedDB asset the native store does not already have', async () => {
    mockGetAllAssetsForProject.mockResolvedValue([
      { projectId: 'p1', id: 'a1', blob: new Blob(['x']), name: 'a1.mp4', mimeType: 'video/mp4' },
      { projectId: 'p1', id: 'a2', blob: new Blob(['y']), name: 'a2.mp4', mimeType: 'video/mp4' },
    ]);
    mockGetAssetStatusNative.mockResolvedValue([
      { assetId: 'a1', bytesPresent: true, metaPresent: true, bytes: 1, name: 'a1.mp4', mimeType: 'video/mp4' },
      { assetId: 'a2', bytesPresent: false, metaPresent: false, bytes: null, name: null, mimeType: null },
    ]);

    const report = await migrateIndexedDbAssetsToNative();

    // a1 already native — skipped; a2 is not — migrated.
    expect(mockWriteAssetBlobNative).toHaveBeenCalledTimes(1);
    expect(mockWriteAssetBlobNative).toHaveBeenCalledWith('p1', 'a2', expect.any(Blob), 'a2.mp4', 'video/mp4');
    expect(report.migrated).toEqual([{ projectId: 'p1', assetId: 'a2' }]);
    expect(report.failed).toEqual([]);
  });

  it('is idempotent — a second run with everything already native writes nothing', async () => {
    mockGetAllAssetsForProject.mockResolvedValue([
      { projectId: 'p1', id: 'a1', blob: new Blob(['x']), name: 'a1.mp4', mimeType: 'video/mp4' },
    ]);
    mockGetAssetStatusNative.mockResolvedValue([
      { assetId: 'a1', bytesPresent: true, metaPresent: true, bytes: 1, name: 'a1.mp4', mimeType: 'video/mp4' },
    ]);

    const report = await migrateIndexedDbAssetsToNative();
    expect(mockWriteAssetBlobNative).not.toHaveBeenCalled();
    expect(report.migrated).toEqual([]);
  });

  it('a per-asset write failure is reported, not thrown, and does not stop the rest of the scan', async () => {
    mockGetAllAssetsForProject.mockResolvedValue([
      { projectId: 'p1', id: 'a1', blob: new Blob(['x']), name: 'a1.mp4', mimeType: 'video/mp4' },
      { projectId: 'p1', id: 'a2', blob: new Blob(['y']), name: 'a2.mp4', mimeType: 'video/mp4' },
    ]);
    mockGetAssetStatusNative.mockResolvedValue([]);
    mockWriteAssetBlobNative
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);

    const report = await migrateIndexedDbAssetsToNative();

    expect(report.failed).toEqual([{ projectId: 'p1', assetId: 'a1', message: 'disk full' }]);
    expect(report.migrated).toEqual([{ projectId: 'p1', assetId: 'a2' }]);
  });

  // Boot-migration sanity, requested alongside the ws3-recovery-ui wiring
  // pass: a fresh install has no projects at all, so the scan must return
  // immediately with an empty report rather than erroring on an empty list.
  it('a fresh install with nothing to migrate returns an empty report and writes nothing', async () => {
    mockLoadAllMetas.mockReturnValue([]);

    const report = await migrateIndexedDbAssetsToNative();

    expect(report).toEqual({ migrated: [], failed: [] });
    expect(mockGetAllAssetsForProject).not.toHaveBeenCalled();
    expect(mockWriteAssetBlobNative).not.toHaveBeenCalled();
  });

  // This module is deliberately NOT gated by a "migration done" flag — see
  // its own doc comment — specifically so a migration interrupted partway
  // (app quit mid-run, a transient write failure) is retried on the very
  // next boot instead of the gap sticking around forever. Simulate two
  // boots: the first leaves a1 failed and a2 written; the second must
  // retry ONLY a1 (now the only one the native store doesn't have yet).
  it('an interrupted migration resumes on the next boot, retrying only what never landed', async () => {
    const assets = [
      { projectId: 'p1', id: 'a1', blob: new Blob(['x']), name: 'a1.mp4', mimeType: 'video/mp4' },
      { projectId: 'p1', id: 'a2', blob: new Blob(['y']), name: 'a2.mp4', mimeType: 'video/mp4' },
    ];
    mockGetAllAssetsForProject.mockResolvedValue(assets);
    mockGetAssetStatusNative.mockResolvedValue([]);
    mockWriteAssetBlobNative
      .mockRejectedValueOnce(new Error('app quit mid-write'))
      .mockResolvedValueOnce(undefined);

    const boot1 = await migrateIndexedDbAssetsToNative();
    expect(boot1.failed).toEqual([{ projectId: 'p1', assetId: 'a1', message: 'app quit mid-write' }]);
    expect(boot1.migrated).toEqual([{ projectId: 'p1', assetId: 'a2' }]);

    vi.clearAllMocks();
    mockGetAllAssetsForProject.mockResolvedValue(assets);
    // Boot 2's native-status read now reflects boot 1's real outcome: a2 landed, a1 did not.
    mockGetAssetStatusNative.mockResolvedValue([
      { assetId: 'a1', bytesPresent: false, metaPresent: false, bytes: null, name: null, mimeType: null },
      { assetId: 'a2', bytesPresent: true, metaPresent: true, bytes: 1, name: 'a2.mp4', mimeType: 'video/mp4' },
    ]);
    mockWriteAssetBlobNative.mockResolvedValue(undefined);

    const boot2 = await migrateIndexedDbAssetsToNative();
    expect(mockWriteAssetBlobNative).toHaveBeenCalledTimes(1);
    expect(mockWriteAssetBlobNative).toHaveBeenCalledWith('p1', 'a1', expect.any(Blob), 'a1.mp4', 'video/mp4');
    expect(boot2.migrated).toEqual([{ projectId: 'p1', assetId: 'a1' }]);
    expect(boot2.failed).toEqual([]);
  });

  it('is a no-op outside Tauri', async () => {
    vi.doMock('./tauriFfmpeg', () => ({ isTauri: () => false }));
    vi.resetModules();
    const { migrateIndexedDbAssetsToNative: migrateOutsideTauri } = await import('./migrateAssetsToNative');
    const report = await migrateOutsideTauri();
    expect(report).toEqual({ migrated: [], failed: [] });
    expect(mockWriteAssetBlobNative).not.toHaveBeenCalled();
  });
});
