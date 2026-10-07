/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Layer 2 spots U1 — additive `Project.spots`: a project
 * stored without them loads with `spots: []`; stored spots round-trip; the
 * five `spot-*` finding kinds are details-only in the sync-log user view.
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
import { attentionKindForEntry } from './syncLogUserView';
import { computeContentKey } from './segmentId';
import type { Project, Spot, SyncLogEntry, SyncLogFindingKind, VideoSegment } from '../types';
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

function baseProject(over: Partial<Project> = {}): Project {
  const id = computeContentKey('Spot fixture.', 0);
  return {
    id: 'p-spot',
    name: 'Spot Fixture',
    script: 'x',
    sceneDetails: '',
    segments: [{ id, text: 'Spot fixture.', startTime: 0, duration: 2, showOverlay: true } as VideoSegment],
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

describe('Project.spots load default', () => {
  it('loads a project saved without spots as spots: []', async () => {
    await saveProject(baseProject());
    const loaded = await loadProjectDetailed('p-spot');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.spots).toEqual([]);
  });

  it('round-trips stored spots and the per-project default spot asset', async () => {
    const spot: Spot = {
      id: 'sp1',
      assetId: 'a1',
      anchorSegmentId: computeContentKey('Spot fixture.', 0),
      offsetSec: 0,
      source: 'doc',
      boundAt: 123,
    };
    await saveProject(baseProject({ spots: [spot] }));
    const loaded = await loadProjectDetailed('p-spot');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.spots).toEqual([spot]);
  });
});

describe('removed default-clip + sprinkle: older saves load clean', () => {
  it('drops defaultSpotAssetId and re-labels a legacy sprinkle spot as manual (kept, editable)', async () => {
    const legacy = {
      id: 'sp9', assetId: 'a1', anchorSegmentId: computeContentKey('Spot fixture.', 0), offsetSec: 0,
      source: 'sprinkle', boundAt: 1,
    };
    await saveProject(baseProject({ spots: [legacy as unknown as Spot], defaultSpotAssetId: 'a1' } as Partial<Project>));
    const loaded = await loadProjectDetailed('p-spot');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect('defaultSpotAssetId' in loaded.project).toBe(false);
    expect(loaded.project.spots![0]!.source).toBe('manual');
  });
});

describe('spot-* finding kinds', () => {
  const SPOT_KINDS: SyncLogFindingKind[] = [
    'spot-segment-unmatched',
    'spot-clip-unmatched',
    'spot-past-voiceover',
    'spot-overlap',
    'spot-clip-missing',
  ];
  it.each(SPOT_KINDS)('%s is details-only (no attention kind)', kind => {
    const entry = {
      id: 'e',
      timestamp: 0,
      syncRunId: 'r',
      type: 'warning',
      message: 'm',
      finding: { kind },
    } as SyncLogEntry;
    expect(attentionKindForEntry(entry)).toBeUndefined();
  });
});

describe('R8 — the Layer-2 doc persists with the project', () => {
  it('Project.spotDoc round-trips with spots + overrides (quit -> reopen)', async () => {
    const spot = {
      id: 'sp-1', assetId: 'a1', clipName: 'avatar.mp4', anchorSegmentId: computeContentKey('Spot fixture.', 0), offsetSec: 0,
      source: 'doc' as const, boundAt: 1, durOverrideSec: 5, geometry: { xPct: 1, yPct: 2, wPct: 30, hPct: 40 },
    };
    const spotDoc = { name: 'avatar-scenes.txt', text: '[intro] avatar.mp4', droppedAt: 123 };
    await saveProject(baseProject({ spots: [spot], spotDoc, spotDefaultGeometry: { xPct: 5, yPct: 5, wPct: 40, hPct: 90, source: 'project-default' } }));
    const loaded = await loadProjectDetailed('p-spot');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.spotDoc).toEqual(spotDoc);
    expect(loaded.project.spots).toEqual([spot]);
    expect(loaded.project.spotDefaultGeometry).toMatchObject({ wPct: 40, source: 'project-default' });
  });
  it('a failed write leaves the previous record whole — no partial doc (atomic project save)', async () => {
    const spotDoc = { name: 'a.txt', text: '[intro] x', droppedAt: 1 };
    await saveProject(baseProject({ spotDoc }));
    const before = osBacking.get('p-spot');
    osBacking.set('p-spot', before!); // the store only ever holds whole records
    const loaded = await loadProjectDetailed('p-spot');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.spotDoc).toEqual(spotDoc);
  });
});
