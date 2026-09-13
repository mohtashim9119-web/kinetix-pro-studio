/**
 * WS3 item B — the native asset store's TS client. Pins the exact IPC shape
 * (raw-body write with headers, matching `ffmpeg_write_file_raw`'s existing
 * pattern in `tauriFfmpeg.ts`) and the "never swallow a write failure"
 * contract: `writeAssetNative` must THROW, not catch-and-warn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));

import { invoke } from '@tauri-apps/api/core';
import {
  writeAssetNative,
  writeAssetBlobNative,
  readAssetNative,
  getAssetStatusNative,
  deleteAssetNative,
  deleteProjectAssetsNative,
} from './nativeAssetStore';

const mockInvoke = invoke as unknown as Mock;

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('writeAssetNative', () => {
  it('sends bytes as the raw invoke body with project-id/asset-id/name/mime-type headers', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const bytes = new Uint8Array([1, 2, 3]);
    await writeAssetNative('proj-1', 'asset-1', bytes, 'clip.mp4', 'video/mp4');
    expect(mockInvoke).toHaveBeenCalledWith('asset_store_write', bytes, {
      headers: { 'project-id': 'proj-1', 'asset-id': 'asset-1', name: 'clip.mp4', 'mime-type': 'video/mp4' },
    });
  });

  it('THROWS on failure — never swallowed, per the WS3 item B ruling', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      writeAssetNative('proj-1', 'asset-1', new Uint8Array([1]), 'a.mp4', 'video/mp4'),
    ).rejects.toThrow('disk full');
  });
});

describe('writeAssetBlobNative', () => {
  it('reads the Blob into bytes before writing', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: 'video/mp4' });
    await writeAssetBlobNative('proj-1', 'asset-1', blob, 'clip.mp4', 'video/mp4');
    const [, sentBytes] = mockInvoke.mock.calls[0]!;
    expect(Array.from(sentBytes as Uint8Array)).toEqual([9, 9, 9]);
  });
});

describe('readAssetNative', () => {
  it('converts the returned number[] into a Uint8Array', async () => {
    mockInvoke.mockResolvedValueOnce([4, 5, 6]);
    const bytes = await readAssetNative('proj-1', 'asset-1');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([4, 5, 6]);
    expect(mockInvoke).toHaveBeenCalledWith('asset_store_read', { projectId: 'proj-1', assetId: 'asset-1' });
  });
});

describe('getAssetStatusNative', () => {
  it('passes assetIds through and returns the native status rows', async () => {
    mockInvoke.mockResolvedValueOnce([
      { assetId: 'a1', bytesPresent: true, metaPresent: true, bytes: 10, name: 'a.mp4', mimeType: 'video/mp4' },
    ]);
    const status = await getAssetStatusNative('proj-1', ['a1']);
    expect(mockInvoke).toHaveBeenCalledWith('asset_store_status', { projectId: 'proj-1', assetIds: ['a1'] });
    expect(status).toEqual([
      { assetId: 'a1', bytesPresent: true, metaPresent: true, bytes: 10, name: 'a.mp4', mimeType: 'video/mp4' },
    ]);
  });

  it('short-circuits to an all-absent report for an empty id list, without calling invoke', async () => {
    const status = await getAssetStatusNative('proj-1', []);
    expect(status).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('deleteAssetNative / deleteProjectAssetsNative', () => {
  it('deleteAssetNative never throws even on failure — best-effort, mirrors assetStore.ts::deleteAsset', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('gone already'));
    await expect(deleteAssetNative('proj-1', 'asset-1')).resolves.toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith('asset_store_delete', { projectId: 'proj-1', assetId: 'asset-1' });
  });

  it('deleteProjectAssetsNative never throws even on failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('gone already'));
    await expect(deleteProjectAssetsNative('proj-1')).resolves.toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith('asset_store_delete_project', { projectId: 'proj-1' });
  });
});
