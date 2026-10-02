// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Media workflow Unit 4 — re-uploading an OFFLINE asset's bytes through any
// Media-block door reconnects it instead of being dropped as a duplicate.
// OLD BUG: the doors seed their dedup set with every project hash —
// including an offline asset's — so the re-upload read "already in your
// project" and the asset stayed offline; the only way back was the relink
// screen's hunt.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPutAsset = vi.fn();
vi.mock('./assetStore', () => ({
  putAsset: (...args: unknown[]) => mockPutAsset(...args),
  deleteAsset: vi.fn(async () => undefined),
}));
const mockMediaVaultImportBytes = vi.fn();
vi.mock('./mediaVaultClient', () => ({
  mediaVaultImportBytes: (...args: unknown[]) => mockMediaVaultImportBytes(...args),
  mediaVaultFsyncDir: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./tauriFfmpeg', () => ({ probeVideoFps: vi.fn() }));

import { ingestLooseFiles, sha256Hex } from './mediaIngest';

beforeEach(() => {
  mockPutAsset.mockReset().mockResolvedValue(undefined);
  mockMediaVaultImportBytes.mockReset().mockResolvedValue(null);
});

describe('ingest doors — offline reconnect (Unit 4)', () => {
  it('OLD BUG: an offline asset\'s bytes re-uploaded come back as a reconnect, not a duplicate and not a new asset', async () => {
    const bytes = new Uint8Array([4, 2, 4, 2]);
    const hash = await sha256Hex(bytes);
    const file = new File([bytes], 'moved/005_need_a_car.png');

    const result = await ingestLooseFiles('p1', [file], [hash], [hash]);

    expect(result.assets).toEqual([]);
    expect(result.duplicateNames).toEqual([]);
    expect(result.reconnected?.map(r => r.contentHash)).toEqual([hash]);
    expect(result.reconnected?.[0]!.file.size).toBe(4);
    // The vault gets the bytes (it may never have had them); the per-asset
    // write is the reconnect's job, not a fresh asset's IndexedDB row.
    expect(mockMediaVaultImportBytes).toHaveBeenCalledTimes(1);
    expect(mockPutAsset).not.toHaveBeenCalled();
  });

  it('a second copy of the same bytes in one batch reconnects once', async () => {
    const bytes = new Uint8Array([7, 7]);
    const hash = await sha256Hex(bytes);
    const result = await ingestLooseFiles('p1', [new File([bytes], 'a.png'), new File([bytes], 'b.png')], [hash], [hash]);
    expect(result.reconnected).toHaveLength(1);
    expect(result.counts.deduped).toBe(1);
  });

  it('with no offline hashes passed, the result shape is unchanged (no `reconnected` key)', async () => {
    const result = await ingestLooseFiles('p1', [new File([new Uint8Array([1])], 'x.png')]);
    expect('reconnected' in result).toBe(false);
  });
});
