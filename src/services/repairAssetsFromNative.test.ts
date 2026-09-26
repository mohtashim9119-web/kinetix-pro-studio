/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Item A (project corruption) — an asset row whose bytes are gone from BOTH
// IndexedDB and the per-project native store, while the content-addressed
// media vault still holds the same bytes under the row's `contentHash`.
// Operator's projects: bbb06894's 005_need_a_car.mp4 (deleted, then its row
// restored by undo — bytes already destroyed), 7102a912's voiceover row, and
// 10d3bf90's 001_child_seven.png (a G6 import: vault + IndexedDB only). Open
// used to treat all of these as unresolvable although the bytes were on disk.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));
vi.mock('./assetLoadTimeout', () => ({ withAssetLoadTimeout: <T>(p: Promise<T>) => p }));
vi.mock('./assetStore', () => ({ putAsset: vi.fn(async () => undefined) }));
vi.mock('./nativeAssetStore', () => ({
  getAssetStatusNative: vi.fn(),
  readAssetNative: vi.fn(),
  writeAssetNative: vi.fn(async () => undefined),
}));
vi.mock('./mediaVaultClient', () => ({ mediaVaultReadBlob: vi.fn() }));

import { repairMissingAssetsFromVault } from './repairAssetsFromNative';
import { putAsset } from './assetStore';
import { writeAssetNative } from './nativeAssetStore';
import { mediaVaultReadBlob } from './mediaVaultClient';
import type { Asset } from '../types';

const vaulted: Asset = { id: 'v1', name: '005_need_a_car.mp4', type: 'video', url: '', contentHash: 'ca92f0bd' };
const legacy: Asset = { id: 'l1', name: '3. Voiceover.mp3', type: 'audio', url: '' };
const gone: Asset = { id: 'g1', name: 'gone.png', type: 'image', url: '', contentHash: 'deadbeef' };

beforeEach(() => {
  vi.mocked(putAsset).mockClear();
  vi.mocked(writeAssetNative).mockClear();
  vi.mocked(mediaVaultReadBlob).mockReset();
});

describe('repairMissingAssetsFromVault', () => {
  it('rebuilds a both-stores-missing asset from the vault by contentHash, into native AND IndexedDB', async () => {
    vi.mocked(mediaVaultReadBlob).mockResolvedValueOnce(new Uint8Array([7, 8, 9]));
    const report = await repairMissingAssetsFromVault('p1', [vaulted], ['v1']);

    expect(mediaVaultReadBlob).toHaveBeenCalledWith('ca92f0bd');
    expect(writeAssetNative).toHaveBeenCalledWith('p1', 'v1', new Uint8Array([7, 8, 9]), '005_need_a_car.mp4', '');
    expect(putAsset).toHaveBeenCalledOnce();
    expect(report.repaired.map(r => r.id)).toEqual(['v1']);
    expect(report.repaired[0]!.blob.size).toBe(3);
  });

  it('skips a row with no contentHash, and a hash the vault no longer has — both stay unresolved', async () => {
    vi.mocked(mediaVaultReadBlob).mockRejectedValueOnce('media_vault_read_blob: no blob for deadbeef');
    const report = await repairMissingAssetsFromVault('p1', [legacy, gone], ['l1', 'g1']);

    expect(mediaVaultReadBlob).toHaveBeenCalledTimes(1);
    expect(writeAssetNative).not.toHaveBeenCalled();
    expect(report.repaired).toEqual([]);
  });
});
