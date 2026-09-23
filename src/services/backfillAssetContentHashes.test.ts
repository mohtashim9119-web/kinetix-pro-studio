/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAsset = vi.fn();
vi.mock('./assetStore', () => ({
  getAsset: (...args: unknown[]) => mockGetAsset(...args),
}));

import { backfillAssetContentHashes } from './backfillAssetContentHashes';
import type { Asset } from '../types';

const PROJECT_ID = 'p1';

beforeEach(() => {
  mockGetAsset.mockReset();
});

function makeAsset(overrides: Partial<Asset> & { id: string }): Asset {
  return { name: `${overrides.id}.jpg`, url: `blob:${overrides.id}`, type: 'image', ...overrides };
}

describe('backfillAssetContentHashes', () => {
  it('returns the SAME array reference when every asset already has a contentHash — a cheap no-op check', async () => {
    const assets = [makeAsset({ id: 'a1', contentHash: 'already-hashed' })];
    const result = await backfillAssetContentHashes(PROJECT_ID, assets);
    expect(result).toBe(assets);
    expect(mockGetAsset).not.toHaveBeenCalled();
  });

  it('hashes an asset\'s File bytes when present, without touching IndexedDB', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a1.jpg');
    const assets = [makeAsset({ id: 'a1', file })];
    const result = await backfillAssetContentHashes(PROJECT_ID, assets);
    expect(result).not.toBe(assets);
    expect(result[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(mockGetAsset).not.toHaveBeenCalled();
  });

  it('falls back to the IndexedDB-stored blob when no File is present (an asset restored across a reload)', async () => {
    mockGetAsset.mockResolvedValue({ blob: new Blob([new Uint8Array([4, 5, 6])]) });
    const assets = [makeAsset({ id: 'a1' })];
    const result = await backfillAssetContentHashes(PROJECT_ID, assets);
    expect(mockGetAsset).toHaveBeenCalledWith(PROJECT_ID, 'a1');
    expect(result[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('leaves contentHash absent (never fabricated) for an asset whose bytes cannot be read anywhere', async () => {
    mockGetAsset.mockResolvedValue(null);
    const assets = [makeAsset({ id: 'a1' })];
    const result = await backfillAssetContentHashes(PROJECT_ID, assets);
    expect(result[0]!.contentHash).toBeUndefined();
  });

  it('only patches the assets that actually needed it, leaving already-hashed ones as the same object', async () => {
    const already = makeAsset({ id: 'a1', contentHash: 'existing' });
    const file = new File([new Uint8Array([9])], 'a2.jpg');
    const needsHash = makeAsset({ id: 'a2', file });
    const result = await backfillAssetContentHashes(PROJECT_ID, [already, needsHash]);
    expect(result[0]).toBe(already);
    expect(result[1]).not.toBe(needsHash);
    expect(result[1]!.contentHash).toBeDefined();
  });

  it('a read failure for one asset does not stop the others from being hashed', async () => {
    mockGetAsset.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    const file = new File([new Uint8Array([1])], 'a2.jpg');
    const assets = [makeAsset({ id: 'a1' }), makeAsset({ id: 'a2', file })];
    const result = await backfillAssetContentHashes(PROJECT_ID, assets);
    expect(result[0]!.contentHash).toBeUndefined();
    expect(result[1]!.contentHash).toBeDefined();
  });
});
