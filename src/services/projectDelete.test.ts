/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteProjectEverywhere } from './projectDelete';

const deleteProjectData = vi.fn(async (_id: string) => undefined);
const deleteAllAssets = vi.fn(async (_id: string) => undefined);
const deleteAllWaveforms = vi.fn(async (_id: string) => undefined);
const deleteAllStagedForProject = vi.fn(async (_id: string) => undefined);
const deleteProjectAssetsNativeStrict = vi.fn(async (_id: string) => undefined);
const mediaVaultUnreference = vi.fn(async (_hash: string, _id: string) => undefined);
const mediaVaultUnreferenceProject = vi.fn(async (_id: string) => undefined);
const loadProject = vi.fn(async (_id: string) => null);

vi.mock('./projectStore', () => ({
  loadProject: (id: string) => loadProject(id),
  deleteProjectData: (id: string) => deleteProjectData(id),
}));
vi.mock('./assetStore', () => ({ deleteAllAssets: (id: string) => deleteAllAssets(id) }));
vi.mock('./waveformStore', () => ({ deleteAllWaveforms: (id: string) => deleteAllWaveforms(id) }));
vi.mock('./stagedFilesStore', () => ({
  deleteAllStagedForProject: (id: string) => deleteAllStagedForProject(id),
}));
vi.mock('./nativeAssetStore', () => ({
  deleteProjectAssetsNativeStrict: (id: string) => deleteProjectAssetsNativeStrict(id),
}));
vi.mock('./mediaVaultClient', () => ({
  mediaVaultUnreference: (hash: string, id: string) => mediaVaultUnreference(hash, id),
  mediaVaultUnreferenceProject: (id: string) => mediaVaultUnreferenceProject(id),
}));

describe('deleteProjectEverywhere', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    deleteProjectData.mockResolvedValue(undefined);
    deleteAllAssets.mockResolvedValue(undefined);
    deleteAllWaveforms.mockResolvedValue(undefined);
    deleteAllStagedForProject.mockResolvedValue(undefined);
    deleteProjectAssetsNativeStrict.mockResolvedValue(undefined);
    mediaVaultUnreferenceProject.mockResolvedValue(undefined);
  });

  it('does not load the project or issue per-hash vault unreferences', async () => {
    await deleteProjectEverywhere('proj-50');
    expect(loadProject).not.toHaveBeenCalled();
    expect(mediaVaultUnreference).not.toHaveBeenCalled();
    expect(mediaVaultUnreferenceProject).toHaveBeenCalledTimes(1);
    expect(mediaVaultUnreferenceProject).toHaveBeenCalledWith('proj-50');
    expect(deleteProjectData).toHaveBeenCalledWith('proj-50');
  });

  it('drops the record before vault/native work so the confirm can close', async () => {
    const order: string[] = [];
    deleteProjectData.mockImplementation(async () => {
      order.push('record');
    });
    mediaVaultUnreferenceProject.mockImplementation(async () => {
      order.push('vault');
    });
    await deleteProjectEverywhere('p');
    expect(order[0]).toBe('record');
    expect(order).toContain('vault');
  });
});
