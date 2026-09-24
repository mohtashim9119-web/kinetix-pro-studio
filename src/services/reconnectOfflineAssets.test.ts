/**
 * Media workflow Unit 4 — re-uploading an offline asset's bytes reconnects
 * it IN PLACE through the existing relink machinery (`relinkAsset`): bytes
 * into that asset id's native + IndexedDB slot, and the project's
 * load-failure poison auto-clears once every asset resolves.
 *
 * Same harness as assetRecovery.test.ts: the REAL projectStore /
 * relinkAsset over a Map-backed OS store and IndexedDB, with a mocked
 * `invoke` standing in for the native asset store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let osBacking: Map<string, string>;
let cacheBacking: Map<string, Blob>;

vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));
vi.mock('./projectStoreClient', () => ({
  osStoreWrite: (id: string, contents: string) => { osBacking.set(id, contents); return Promise.resolve(); },
  osStoreRead: (id: string) => Promise.resolve(osBacking.get(id) ?? null),
  osStoreDelete: (id: string) => { osBacking.delete(id); return Promise.resolve(); },
  osStoreListIds: () => Promise.resolve([...osBacking.keys()]),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./assetStore', () => ({
  getAllAssetsForProject: () => Promise.resolve([]),
  getAsset: (projectId: string, id: string) => {
    const blob = cacheBacking.get(`${projectId}:${id}`);
    return Promise.resolve(blob ? { projectId, id, blob, name: 'x', mimeType: blob.type } : null);
  },
  putAsset: (projectId: string, id: string, blob: Blob) => { cacheBacking.set(`${projectId}:${id}`, blob); return Promise.resolve(); },
}));

import { invoke } from '@tauri-apps/api/core';
import { saveProject, reportAssetResolutionFailure, getLoadFailure, __resetStoreGuardsForTests } from './projectStore';
import { reconnectOfflineAssets } from './reconnectOfflineAssets';
import type { Asset, Project, VideoSegment } from '../types';
import { AnimationType, TransitionType } from '../types';

const mockInvoke = invoke as unknown as Mock;
const PID = 'p-reconnect';
const HASH = 'ca92f0bda654a4403c0d83ca698098fd410946f70a3e4e9788490f802d73034d';

function project(assets: Asset[]): Project {
  const segments = [{ id: 's0', text: '', assetId: assets[0]!.id, startTime: 0, duration: 1, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0 }] as VideoSegment[];
  return {
    id: PID, name: 'Reconnect Fixture', script: '', sceneDetails: '', segments, headings: [], assets,
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0.5, globalAnimation: AnimationType.NONE,
    textLayers: [], globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    confirmed: true, aspectRatio: '16:9', resolutionTier: '1080p',
  } as Project;
}

beforeEach(() => {
  __resetStoreGuardsForTests();
  const ls = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => ls.set(k, v),
    removeItem: (k: string) => void ls.delete(k), clear: () => ls.clear(), key: () => null, get length() { return ls.size; },
  } as Storage);
  osBacking = new Map();
  cacheBacking = new Map();
  mockInvoke.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); __resetStoreGuardsForTests(); });

describe('reconnectOfflineAssets', () => {
  it('OLD BUG FIXED: offline asset + re-uploaded same bytes -> written into ITS slot, resolved, poison auto-cleared', async () => {
    const offline = { id: 'a-005', name: '005_need_a_car.mp4', url: '', type: 'video', contentHash: HASH, unresolved: true } as Asset;
    await saveProject(project([offline]));
    reportAssetResolutionFailure(PID, '1 asset could not be found');
    expect(getLoadFailure(PID)).toBeDefined();

    mockInvoke
      .mockResolvedValueOnce(undefined) // asset_store_write
      .mockImplementationOnce((_c: string, args: { assetIds: string[] }) => Promise.resolve(
        args.assetIds.map(assetId => ({ assetId, bytesPresent: true, metaPresent: true, bytes: null, name: null, mimeType: null })),
      ));

    const file = new File([new Uint8Array([1, 2, 3])], '005_need_a_car.mp4', { type: 'video/mp4' });
    const result = await reconnectOfflineAssets(PID, [offline], [{ contentHash: HASH, file }]);

    expect(result.reconnected.map(r => r.assetId)).toEqual(['a-005']);
    expect(mockInvoke).toHaveBeenCalledWith('asset_store_write', expect.any(Uint8Array), expect.objectContaining({
      headers: expect.objectContaining({ 'project-id': PID, 'asset-id': 'a-005' }),
    }));
    expect(getLoadFailure(PID)).toBeUndefined();
    expect(result.allResolved).toBe(true);
  });

  it('only UNRESOLVED assets with that exact hash are targets — an online twin is left alone', async () => {
    const online = { id: 'on', name: 'x.mp4', url: 'blob:x', type: 'video', contentHash: HASH } as Asset;
    const result = await reconnectOfflineAssets(PID, [online], [{ contentHash: HASH, file: new File([], 'x.mp4') }]);
    expect(result.reconnected).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// App wiring (source scan, same convention as applySyncCancelInvariant):
// every Media-block door's reconnect candidates reach reconnectOfflineAssets,
// and the offline flag clears in live state.
describe('App wiring — handleMediaIngestComplete reconnects', () => {
  const src = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
  const start = src.indexOf('const handleMediaIngestComplete = useCallback(');
  const body = src.slice(start, src.indexOf('}, []);', start));
  it('runs reconnectOfflineAssets on outcome.reconnected and clears `unresolved`', () => {
    expect(body).toContain('reconnectOfflineAssets(projectId, projectRef.current.assets, reconnects)');
    expect(body).toContain('unresolved: false');
    expect(body).toContain('buildMediaReconnectEntry(');
  });
});
