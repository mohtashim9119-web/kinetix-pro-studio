/**
 * Asset resolution must always settle — never hang — and classify the three
 * Machine-1 store populations correctly: both missing, native-only, cache-only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

let cacheBacking: Map<string, Blob>;
let getAllAssetsCallCount = 0;

vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));

vi.mock('./projectStoreClient', () => {
  const osBacking = new Map<string, string>();
  return {
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
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('./assetStore', () => ({
  getAllAssetsForProject: (projectId: string) => {
    getAllAssetsCallCount += 1;
    const assets: { projectId: string; id: string; blob: Blob; name: string; mimeType: string }[] = [];
    for (const [key, blob] of cacheBacking.entries()) {
      const [pid, id] = key.split(':');
      if (pid === projectId && id !== undefined) {
        assets.push({ projectId, id, blob, name: 'x', mimeType: blob.type });
      }
    }
    return Promise.resolve(assets);
  },
  putAsset: vi.fn(async () => undefined),
}));

import { invoke } from '@tauri-apps/api/core';
import { saveProject, __resetStoreGuardsForTests } from './projectStore';
import { getProjectAssetRecoveryStatus } from './assetRecovery';
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
  return { id, name, url: '', type: 'image' } as Asset;
}
function seg(id: string, assetId: string, text: string): VideoSegment {
  return { id, text, assetId, startTime: 0, duration: 1, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0 } as VideoSegment;
}

function projectWith(assets: Asset[], segments: VideoSegment[]): Project {
  return {
    id: 'p-bound', name: 'Bound Test', script: '', sceneDetails: '',
    segments, headings: [], assets,
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    textLayers: [], globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    confirmed: true, aspectRatio: '16:9', resolutionTier: '1080p',
  } as Project;
}

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
  cacheBacking = new Map();
  getAllAssetsCallCount = 0;
  mockInvoke.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  __resetStoreGuardsForTests();
});

describe('getProjectAssetRecoveryStatus — three store populations', () => {
  it('both copies missing → unresolved', async () => {
    const a1 = asset('a1', 'gone.jpg');
    await saveProject(projectWith([a1], [seg('s0', 'a1', 'Segment')]));
    mockNativeStatus({});

    const status = await getProjectAssetRecoveryStatus('p-bound');
    expect(status!.assets[0]).toMatchObject({
      assetId: 'a1', cacheResolved: false, nativeResolved: false, resolved: false,
    });
    expect(status!.allResolved).toBe(false);
  });

  it('native present, cache missing → resolved via native', async () => {
    const a1 = asset('a1', 'native-only.jpg');
    await saveProject(projectWith([a1], [seg('s0', 'a1', 'Segment')]));
    mockNativeStatus({ a1: true });

    const status = await getProjectAssetRecoveryStatus('p-bound');
    expect(status!.assets[0]).toMatchObject({
      cacheResolved: false, nativeResolved: true, resolved: true,
    });
    expect(status!.allResolved).toBe(true);
  });

  it('cache present, native missing → resolved via cache', async () => {
    const a1 = asset('a1', 'cache-only.jpg');
    await saveProject(projectWith([a1], [seg('s0', 'a1', 'Segment')]));
    cacheBacking.set('p-bound:a1', new Blob(['x'], { type: 'image/jpeg' }));
    mockNativeStatus({});

    const status = await getProjectAssetRecoveryStatus('p-bound');
    expect(status!.assets[0]).toMatchObject({
      cacheResolved: true, nativeResolved: false, resolved: true,
    });
    expect(status!.allResolved).toBe(true);
  });
});

describe('getProjectAssetRecoveryStatus — bounded read (no N× IndexedDB opens)', () => {
  it('uses exactly one getAllAssetsForProject call even for a large asset list', async () => {
    const assets = Array.from({ length: 120 }, (_, i) => asset(`a${i}`, `file-${i}.jpg`));
    const segments = assets.map((a, i) => seg(`s${i}`, a.id, `Seg ${i}`));
    await saveProject(projectWith(assets, segments));
    mockNativeStatus({});

    await getProjectAssetRecoveryStatus('p-bound');

    expect(getAllAssetsCallCount).toBe(1);
  });
});
