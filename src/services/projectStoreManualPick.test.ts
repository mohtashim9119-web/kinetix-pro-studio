/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wave 3 U9 B0 — the manual-pick marker (`assetAssignedBy`) survives a
 * save/load round trip through the real store layer.
 *
 * Uses the same Map-backed fake `projectStoreClient` harness as
 * `projectStoreGuard.test.ts` (see that file's header for why a fake OS store
 * rather than a `localStorage` stub is used here).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let osBacking: Map<string, string>;

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

import { saveProject, loadProjectDetailed, __resetStoreGuardsForTests } from './projectStore';
import { isCurrentVersionSegmentId, computeContentKey } from './segmentId';
import type { Project, VideoSegment } from '../types';
import { AnimationType, TransitionType } from '../types';

let registryBacking: Map<string, string>;

function installLocalStorage(): void {
  registryBacking = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (registryBacking.has(k) ? registryBacking.get(k)! : null),
    setItem: (k: string, v: string) => registryBacking.set(k, String(v)),
    removeItem: (k: string) => void registryBacking.delete(k),
    clear: () => registryBacking.clear(),
    key: (i: number) => [...registryBacking.keys()][i] ?? null,
    get length() {
      return registryBacking.size;
    },
  } as Storage);
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as unknown as Storage);
}

function baseProject(segments: VideoSegment[], over: Partial<Project> = {}): Project {
  return {
    id: 'p-b0',
    name: 'T1.2 Fixture',
    script: 'x',
    sceneDetails: '',
    segments,
    headings: [],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    textLayers: [],
    globalOverlayConfig: { color: '#FFFFFF', backgroundColor: '#000000', fontFamily: 'Inter' },
    confirmed: true,
    aspectRatio: '16:9',
    resolutionTier: '1080p',
    ...over,
  } as Project;
}

beforeEach(() => {
  __resetStoreGuardsForTests();
  installLocalStorage();
  osBacking = new Map();
});

describe('B0 — manual-pick marker persistence', () => {
  it('assetAssignedBy: manual survives save -> load; an auto-bound scene stays unmarked', async () => {
    const idA = computeContentKey('Manual scene.', 0);
    const idB = computeContentKey('Auto scene.', 1);
    const project = baseProject([
      { id: idA, text: 'Manual scene.', startTime: 0, duration: 2, showOverlay: true, assetId: 'a1', assetAssignedBy: 'manual' } as VideoSegment,
      { id: idB, text: 'Auto scene.', startTime: 2, duration: 2, showOverlay: true, assetId: 'a2' } as VideoSegment,
    ], { assets: [
      { id: 'a1', name: 'a1.png', url: '', type: 'image' },
      { id: 'a2', name: 'a2.png', url: '', type: 'image' },
    ] as Project['assets'] });
    expect((await saveProject(project)).ok).toBe(true);
    const loaded = await loadProjectDetailed('p-b0');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.segments[0]!.assetAssignedBy).toBe('manual');
    expect(loaded.project.segments[1]!.assetAssignedBy).toBeUndefined();
  });

  it('B2: Asset.corrupt survives save -> load (the chip does not need a re-probe after a reload)', async () => {
    const id = computeContentKey('Scene.', 0);
    const project = baseProject(
      [{ id, text: 'Scene.', startTime: 0, duration: 2, showOverlay: true, assetId: 'a1' } as VideoSegment],
      { assets: [{ id: 'a1', name: 'a1.mp4', url: '', type: 'video', contentHash: 'h1', corrupt: 'no-frame' }] as Project['assets'] },
    );
    expect((await saveProject(project)).ok).toBe(true);
    const loaded = await loadProjectDetailed('p-b0');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.assets[0]!.corrupt).toBe('no-frame');
  });
});
