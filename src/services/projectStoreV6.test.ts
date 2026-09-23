/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * G6 Step 5 — projectStore v5 -> v6 (`Asset.contentHash`, additive).
 *
 * Uses the same fake OS-store harness `projectStoreSegmentId.test.ts` already
 * established (a Map-backed `projectStoreClient`, not a real `localStorage`
 * stub — see that file's own header).
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
import { computeContentKey } from './segmentId';
import type { Project, VideoSegment, Asset } from '../types';
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

function baseProject(segments: VideoSegment[], assets: Asset[], over: Partial<Project> = {}): Project {
  return {
    id: 'p-v6',
    name: 'v6 Fixture',
    script: 'x',
    sceneDetails: '',
    segments,
    headings: [],
    assets,
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

describe('a v5 project (no Asset.contentHash) loads cleanly through the v6 bump', () => {
  it('loads with all segments resolving, unresolved assets untouched, and saves as v6 on the next write', async () => {
    const v5Record = {
      version: 5,
      savedAt: Date.now(),
      project: baseProject(
        [
          { id: computeContentKey('One.', 0), text: 'One.', assetId: 'a1', startTime: 0, duration: 2 } as VideoSegment,
          { id: computeContentKey('Two.', 1), text: 'Two.', assetId: 'a2', startTime: 2, duration: 2 } as VideoSegment,
        ],
        [
          { id: 'a1', name: 'a1.jpg', url: '', type: 'image' } as Asset,
          { id: 'a2', name: 'a2.mp4', url: '', type: 'video' } as Asset,
        ],
      ),
    };
    osBacking.set('p-v6', JSON.stringify(v5Record));

    const loaded = await loadProjectDetailed('p-v6');
    expect(loaded?.ok).toBe(true);
    if (!loaded || !loaded.ok) throw new Error('load failed');

    // "all segments resolving" — every segment's assetId still points at a
    // real asset in the loaded project; nothing was dropped or orphaned by
    // the version bump.
    const assetIds = new Set(loaded.project.assets.map(a => a.id));
    for (const seg of loaded.project.segments) {
      expect(seg.assetId).toBeDefined();
      expect(assetIds.has(seg.assetId!)).toBe(true);
    }
    // No contentHash existed in the v5 record — absent, not fabricated.
    expect(loaded.project.assets.every(a => a.contentHash === undefined)).toBe(true);

    await saveProject(loaded.project);
    const raw = osBacking.get('p-v6');
    const parsed = JSON.parse(raw!) as { version: number };
    expect(parsed.version).toBe(6);
  });

  it('a v5 project WITH a contentHash already on an asset (e.g. hand-migrated) round-trips it unchanged', async () => {
    const v5Record = {
      version: 5,
      savedAt: Date.now(),
      project: baseProject(
        [],
        [{ id: 'a1', name: 'a1.jpg', url: '', type: 'image', contentHash: 'abc123' } as Asset],
      ),
    };
    osBacking.set('p-v6', JSON.stringify(v5Record));

    const loaded = await loadProjectDetailed('p-v6');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.assets[0]!.contentHash).toBe('abc123');
  });
});

describe('G6 Step 5 regression — the v6 bump must not re-widen the UNRELATED v4->v5 timing-provenance migration', () => {
  it('a v5 project with real transcriptTokens but no timingProvenance stamp is left with it ABSENT, never backfilled to "unknown"', async () => {
    // This is exactly the state plan-v3 item 8's own migration is documented
    // to leave alone for a v5-or-newer envelope: "an absent stamp on a
    // project that has never stored timings" is a real, meaningful state
    // (never synced with provenance tracking on), not a gap to paper over.
    // Bumping PROJECT_STORE_VERSION to 6 for Step 5's unrelated
    // Asset.contentHash change must not change this — the migration's own
    // threshold is now the FIXED literal 5, not the current envelope version.
    const v5Record = {
      version: 5,
      savedAt: Date.now(),
      project: baseProject([], [], {
        transcriptTokens: [{ startSec: 0, endSec: 1, text: 'hi' }] as Project['transcriptTokens'],
      }),
    };
    osBacking.set('p-v6', JSON.stringify(v5Record));

    const loaded = await loadProjectDetailed('p-v6');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.timingProvenance).toBeUndefined();
  });

  it('a genuinely pre-v5 (v4) project WITH tokens still gets labelled engine-unknown, unaffected by the v6 bump', async () => {
    const v4Record = {
      version: 4,
      savedAt: Date.now(),
      project: baseProject([], [], {
        transcriptTokens: [{ startSec: 0, endSec: 1, text: 'hi' }] as Project['transcriptTokens'],
      }),
    };
    osBacking.set('p-v6', JSON.stringify(v4Record));

    const loaded = await loadProjectDetailed('p-v6');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.timingProvenance?.transcription).toBeDefined();
  });
});
