/**
 * WS3 item B addition — the recovery-screen data source and re-link command.
 *
 * Harness mirrors `projectStoreGuard.test.ts`'s: a Map-backed fake for
 * `projectStoreClient` (the OS project store) so `loadProjectDetailed` (the
 * real implementation, not mocked) behaves realistically, plus a Map-backed
 * fake IndexedDB (`assetStore.ts`'s `getAsset`/`putAsset`) and a mocked
 * `invoke` standing in for the native asset store (`asset_store_*`
 * commands) — the same shape `tauriFfmpeg.diagnostics.test.ts` already uses
 * for native-command assertions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

let osBacking: Map<string, string>;
let cacheBacking: Map<string, Blob>; // key: `${projectId}:${assetId}`
let nativeBacking: Map<string, { name: string; mimeType: string }>; // key: `${projectId}:${assetId}`

vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));

vi.mock('./projectStoreClient', () => ({
  osStoreWrite: (id: string, contents: string) => {
    osBacking.set(id, contents);
    return Promise.resolve();
  },
  osStoreRead: (id: string) => Promise.resolve(osBacking.has(id) ? osBacking.get(id)! : null),
  osStoreDelete: (id: string) => {
    osBacking.delete(id);
    return Promise.resolve();
  },
  osStoreListIds: () => Promise.resolve([...osBacking.keys()]),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('./assetStore', () => ({
  getAsset: (projectId: string, id: string) => {
    const blob = cacheBacking.get(`${projectId}:${id}`);
    return Promise.resolve(blob ? { projectId, id, blob, name: 'x', mimeType: blob.type } : null);
  },
  putAsset: (projectId: string, id: string, blob: Blob) => {
    cacheBacking.set(`${projectId}:${id}`, blob);
    return Promise.resolve();
  },
}));

import { invoke } from '@tauri-apps/api/core';
import { saveProject, __resetStoreGuardsForTests, getLoadFailure } from './projectStore';
import { getProjectAssetRecoveryStatus, relinkAsset } from './assetRecovery';
import type { Project, VideoSegment, Asset } from '../types';
import { AnimationType, TransitionType } from '../types';

const mockInvoke = invoke as unknown as Mock;

function installLocalStorage(): void {
  const backing = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() { return backing.size; },
  } as Storage);
}

function asset(id: string, name: string): Asset {
  return { id, name, url: '', type: 'video' } as Asset;
}
function seg(id: string, assetId: string): VideoSegment {
  return { id, text: '', assetId, startTime: 0, duration: 1, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0 } as VideoSegment;
}

function projectWith(assets: Asset[], segments: VideoSegment[]): Project {
  return {
    id: 'p-recovery', name: 'Recovery Fixture', script: '', sceneDetails: '',
    segments, headings: [], assets,
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    textLayers: [], globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    confirmed: true, aspectRatio: '16:9', resolutionTier: '1080p',
  } as Project;
}

/** Native asset_store_status responses keyed to whatever bytesPresent map is given. */
function mockNativeStatus(present: Record<string, boolean>): void {
  mockInvoke.mockImplementationOnce((_cmd: string, args: { assetIds: string[] }) =>
    Promise.resolve(args.assetIds.map((assetId) => ({
      assetId, bytesPresent: present[assetId] ?? false, metaPresent: present[assetId] ?? false,
      bytes: null, name: null, mimeType: null,
    }))),
  );
}

beforeEach(() => {
  __resetStoreGuardsForTests();
  installLocalStorage();
  osBacking = new Map();
  cacheBacking = new Map();
  nativeBacking = new Map();
  mockInvoke.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  __resetStoreGuardsForTests();
});

describe('getProjectAssetRecoveryStatus', () => {
  it('returns null when the project JSON itself cannot be read', async () => {
    const status = await getProjectAssetRecoveryStatus('never-saved');
    expect(status).toBeNull();
  });

  it('reports per-asset resolution across cache and native, even for a project with no load failure', async () => {
    const a1 = asset('a1', 'clip.mp4');
    const a2 = asset('a2', 'photo.png');
    await saveProject(projectWith([a1, a2], [seg('s0', 'a1'), seg('s1', 'a2')]));
    cacheBacking.set('p-recovery:a1', new Blob(['x']));
    mockNativeStatus({ a2: true }); // a2 resolvable natively, not in cache

    const status = await getProjectAssetRecoveryStatus('p-recovery');

    expect(status).not.toBeNull();
    expect(status!.loadFailure).toBeNull();
    expect(status!.assets).toEqual([
      { assetId: 'a1', name: 'clip.mp4', type: 'video', cacheResolved: true, nativeResolved: false, resolved: true },
      { assetId: 'a2', name: 'photo.png', type: 'video', cacheResolved: false, nativeResolved: true, resolved: true },
    ]);
    expect(status!.allResolved).toBe(true);
  });

  it('reports an unresolved asset (missing from both stores) and surfaces the load failure', async () => {
    const a1 = asset('a1', 'clip.mp4');
    await saveProject(projectWith([a1], [seg('s0', 'a1')]));
    mockNativeStatus({}); // nothing native

    const status = await getProjectAssetRecoveryStatus('p-recovery');
    expect(status!.assets).toEqual([
      { assetId: 'a1', name: 'clip.mp4', type: 'video', cacheResolved: false, nativeResolved: false, resolved: false },
    ]);
    expect(status!.allResolved).toBe(false);
  });
});

describe('relinkAsset', () => {
  it('writes the picked file natively and to the cache, and clears the load failure once ALL assets resolve', async () => {
    const a1 = asset('a1', 'clip.mp4');
    await saveProject(projectWith([a1], [seg('s0', 'a1')]));
    // Simulate item A having poisoned the project (the real flow: App.tsx's
    // orphan check calls reportAssetResolutionFailure).
    const { reportAssetResolutionFailure } = await import('./projectStore');
    reportAssetResolutionFailure('p-recovery', 'asset a1 unresolvable');
    expect(getLoadFailure('p-recovery')).toBeDefined();

    mockInvoke.mockResolvedValueOnce(undefined); // asset_store_write
    mockNativeStatus({ a1: true }); // post-write status check sees it resolved

    const file = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' });
    const outcome = await relinkAsset('p-recovery', 'a1', file);

    expect(outcome.ok).toBe(true);
    expect(outcome.status?.allResolved).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('asset_store_write', expect.any(Uint8Array), {
      headers: { 'project-id': 'p-recovery', 'asset-id': 'a1', name: 'clip.mp4', 'mime-type': 'video/mp4' },
    });
    // The load failure is now cleared — autosave can proceed.
    expect(getLoadFailure('p-recovery')).toBeUndefined();
    // Cache was repopulated too.
    expect(cacheBacking.has('p-recovery:a1')).toBe(true);
  });

  it('does NOT clear the load failure when other assets are still unresolved', async () => {
    const a1 = asset('a1', 'clip.mp4');
    const a2 = asset('a2', 'photo.png');
    await saveProject(projectWith([a1, a2], [seg('s0', 'a1'), seg('s1', 'a2')]));
    const { reportAssetResolutionFailure } = await import('./projectStore');
    reportAssetResolutionFailure('p-recovery', 'assets unresolvable');

    mockInvoke.mockResolvedValueOnce(undefined); // asset_store_write for a1
    mockNativeStatus({ a1: true }); // a2 still not present natively

    const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });
    const outcome = await relinkAsset('p-recovery', 'a1', file);

    expect(outcome.ok).toBe(true);
    expect(outcome.status?.allResolved).toBe(false);
    expect(getLoadFailure('p-recovery')).toBeDefined(); // still poisoned — a2 is unresolved
  });

  it('a native write failure is reported, never swallowed', async () => {
    const a1 = asset('a1', 'clip.mp4');
    await saveProject(projectWith([a1], [seg('s0', 'a1')]));
    mockInvoke.mockRejectedValueOnce(new Error('disk full'));
    mockNativeStatus({}); // status recheck after the failed write — still unresolved

    const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });
    const outcome = await relinkAsset('p-recovery', 'a1', file);

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/disk full/);
    expect(cacheBacking.has('p-recovery:a1')).toBe(false); // cache write never attempted
  });
});
