/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS2 T1.2 — stable content-derived segment ids: round trip and pre-T1.2
 * migration coverage for the store layer.
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
    id: 'p-t12',
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

describe('round trip through save/load', () => {
  it('preserves a current-version segment id unchanged across a save/load cycle', async () => {
    const id = computeContentKey('Round trip segment.', 0);
    const project = baseProject([
      { id, text: 'Round trip segment.', startTime: 0, duration: 2, showOverlay: true } as VideoSegment,
    ]);

    const outcome = await saveProject(project);
    expect(outcome.ok).toBe(true);

    const loaded = await loadProjectDetailed('p-t12');
    expect(loaded?.ok).toBe(true);
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.segments[0]!.id).toBe(id);
  });

  it('bumps the on-disk schema version to 3', async () => {
    const id = computeContentKey('Version check.', 0);
    const project = baseProject([
      { id, text: 'Version check.', startTime: 0, duration: 2, showOverlay: true } as VideoSegment,
    ]);
    await saveProject(project);

    const raw = osBacking.get('p-t12');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as { version: number };
    expect(parsed.version).toBe(3);
  });
});

describe('migration — loading a pre-T1.2 project.json', () => {
  it('backfills random-UUID segment ids on load, deterministically and idempotently', async () => {
    // A record as it would have been written before T1.2: version 2, real
    // crypto.randomUUID()-shaped ids that carry no relationship to content.
    const preT12Record = {
      version: 2,
      savedAt: Date.now(),
      project: baseProject([
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          text: 'Legacy segment one.',
          startTime: 0,
          duration: 2,
          showOverlay: true,
        } as VideoSegment,
        {
          id: '9c858901-8a57-4791-81fe-4c455b099bc9',
          text: 'Legacy segment two.',
          startTime: 2,
          duration: 2,
          showOverlay: true,
        } as VideoSegment,
      ]),
    };
    osBacking.set('p-t12', JSON.stringify(preT12Record));

    const firstLoad = await loadProjectDetailed('p-t12');
    expect(firstLoad?.ok).toBe(true);
    if (!firstLoad || !firstLoad.ok) throw new Error('load failed');

    const [seg1, seg2] = firstLoad.project.segments;
    expect(isCurrentVersionSegmentId(seg1!.id)).toBe(true);
    expect(isCurrentVersionSegmentId(seg2!.id)).toBe(true);
    expect(seg1!.id).not.toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(seg1!.id).toBe(computeContentKey('Legacy segment one.', 0));
    expect(seg2!.id).toBe(computeContentKey('Legacy segment two.', 0));

    // Loading the SAME still-unsaved-back raw record a second time must
    // backfill to the identical ids (idempotency doesn't depend on having
    // re-saved in between).
    const secondLoad = await loadProjectDetailed('p-t12');
    if (!secondLoad || !secondLoad.ok) throw new Error('second load failed');
    expect(secondLoad.project.segments.map(s => s.id)).toEqual(
      firstLoad.project.segments.map(s => s.id),
    );
  });

  it('is idempotent once the backfilled project has actually been re-saved', async () => {
    const preT12Record = {
      version: 2,
      savedAt: Date.now(),
      project: baseProject([
        { id: 'old-random-id', text: 'Save-then-reload.', startTime: 0, duration: 2, showOverlay: true } as VideoSegment,
      ]),
    };
    osBacking.set('p-t12', JSON.stringify(preT12Record));

    const loaded = await loadProjectDetailed('p-t12');
    if (!loaded || !loaded.ok) throw new Error('load failed');

    await saveProject(loaded.project);

    const reloaded = await loadProjectDetailed('p-t12');
    if (!reloaded || !reloaded.ok) throw new Error('reload failed');

    expect(reloaded.project.segments[0]!.id).toBe(loaded.project.segments[0]!.id);
  });
});
