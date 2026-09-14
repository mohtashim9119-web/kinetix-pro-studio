/**
 * Round 27 Step 4 — prove the ladder routes three asset populations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));
vi.mock('./assetStore', () => ({ putAsset: vi.fn(async () => undefined) }));
vi.mock('./nativeAssetStore', () => ({
  writeAssetFromPath: vi.fn(async () => undefined),
  readAssetNative: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
vi.mock('./assetLoadTimeout', () => ({
  withAssetLoadTimeout: <T>(p: Promise<T>) => p,
  ASSET_LOAD_TIMEOUT_MS: 30_000,
}));

import { invoke } from '@tauri-apps/api/core';
import {
  applySilentProvenanceResolution,
  isPartialProvenance,
  isPreProvenance,
  requiresConfirmation,
  routesToFolderPick,
  type AssetProvenanceStatus,
  type AssetResolutionResult,
} from './assetResolutionLadder';
import { writeAssetFromPath } from './nativeAssetStore';

const mockInvoke = invoke as unknown as Mock;

const asset = {
  id: 'a1',
  name: 'clip.mp4',
  type: 'video' as const,
  url: '',
  file: new File([], 'clip.mp4', { type: 'video/mp4' }),
};

beforeEach(() => {
  mockInvoke.mockReset();
  vi.mocked(writeAssetFromPath).mockClear();
});

describe('population routing policy', () => {
  it('pre-provenance (legacy imports) routes to folder-pick only', () => {
    expect(isPreProvenance(null)).toBe(true);
    expect(isPreProvenance({ originalPath: null, containingFolder: null, contentHash: null, duration: null })).toBe(true);
    const result: AssetResolutionResult = {
      assetId: 'a1',
      rung: 'none',
      confidence: 'none',
      silent: false,
      candidatePath: null,
      reason: 'pre-provenance',
    };
    expect(routesToFolderPick(result)).toBe(true);
    expect(result.silent).toBe(false);
  });

  it('partial provenance (folder-pick write, no hash) never resolves silently', () => {
    const partial: AssetProvenanceStatus = {
      originalPath: '/media/clip.mp4',
      containingFolder: '/media',
      contentHash: null,
      duration: 10,
    };
    expect(isPartialProvenance(partial)).toBe(true);
    const result: AssetResolutionResult = {
      assetId: 'a1',
      rung: 'exact_path',
      confidence: 'probable',
      silent: false,
      candidatePath: '/media/clip.mp4',
      reason: 'hash missing',
    };
    expect(requiresConfirmation(result)).toBe(true);
  });

  it('fully provenanced exact-path + hash match is the only silent rung', () => {
    const full: AssetProvenanceStatus = {
      originalPath: '/media/clip.mp4',
      containingFolder: '/media',
      contentHash: 'abc',
      duration: 10,
    };
    expect(isPreProvenance(full)).toBe(false);
    expect(isPartialProvenance(full)).toBe(false);
    const result: AssetResolutionResult = {
      assetId: 'a1',
      rung: 'exact_path',
      confidence: 'exact',
      silent: true,
      candidatePath: '/media/clip.mp4',
      reason: null,
    };
    expect(requiresConfirmation(result)).toBe(false);
    expect(routesToFolderPick(result)).toBe(false);
  });
});

describe('applySilentProvenanceResolution', () => {
  it('re-imports only silent exact-path matches on open', async () => {
    mockInvoke.mockResolvedValueOnce({
      assetId: 'a1',
      rung: 'exact_path',
      confidence: 'exact',
      silent: true,
      candidatePath: '/media/clip.mp4',
      reason: null,
    });
    const report = await applySilentProvenanceResolution('p1', [asset], ['a1']);
    expect(report.resolved).toEqual(['a1']);
    expect(writeAssetFromPath).toHaveBeenCalledOnce();
    expect(report.folderPickOnly).toEqual([]);
  });

  it('leaves partial and pre-provenance assets for confirmation or folder-pick', async () => {
    mockInvoke
      .mockResolvedValueOnce({
        assetId: 'legacy',
        rung: 'none',
        confidence: 'none',
        silent: false,
        candidatePath: null,
        reason: 'pre-provenance',
      })
      .mockResolvedValueOnce({
        assetId: 'partial',
        rung: 'same_folder_filename',
        confidence: 'probable',
        silent: false,
        candidatePath: '/pick/clip.mp4',
        reason: 'confirmation',
      });
    const report = await applySilentProvenanceResolution('p1', [asset, { ...asset, id: 'partial' }], ['legacy', 'partial']);
    expect(report.resolved).toEqual([]);
    expect(report.folderPickOnly).toEqual(['legacy']);
    expect(report.needsConfirmation).toHaveLength(1);
    expect(writeAssetFromPath).not.toHaveBeenCalled();
  });
});
