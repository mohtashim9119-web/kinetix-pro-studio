/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS1 Session O — mirror adoption.
 *
 * The safety property under test is that adoption is STRICTLY ADDITIVE. It has
 * to be: the mirror is shared by `tauri dev`, `tauri dev -f fa-inference` and
 * the bundled build, so any "newest wins" reconciliation would let launching an
 * older build silently roll a project backwards. Adoption may only ever add
 * project ids this origin does not already have.
 *
 * Project bodies now live in IndexedDB (`projectDataStore.ts`, polyfilled here
 * via `fake-indexeddb/auto` — see `projectStore.ts`'s 2026-08-25 note for why);
 * the registry stays in localStorage and is still exercised via a real mock.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const readMirror = vi.fn();
vi.mock('./projectMirror', () => ({
  readMirror: (...a: unknown[]) => readMirror(...a),
  writeMirroredProject: vi.fn(async () => {}),
  deleteMirroredProject: vi.fn(async () => {}),
}));

import { adoptMirroredProjects, loadProject, loadAllMetas, __resetStoreGuardsForTests } from './projectStore';
import { putProjectRecord } from './projectDataStore';

let backing: Map<string, string>;
function installLocalStorage(): void {
  backing = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() { return backing.size; },
  } as unknown as Storage);
}

interface StoredProjectFixture {
  version: 2;
  savedAt: number;
  project: Record<string, unknown> & { id: string; segments: unknown[] };
}

function storedProject(id: string, name: string, segments: number, savedAt = 1000): StoredProjectFixture {
  return {
    version: 2,
    savedAt,
    project: {
      id, name, script: '', sceneDetails: '',
      segments: Array.from({ length: segments }, (_, i) => ({
        id: `${id}-s${i}`, text: `t${i}`, startTime: i, duration: 1, showOverlay: true,
      })),
      headings: [], assets: [], textLayers: [],
      globalTransition: 'none', globalTransitionDuration: 0.5, globalAnimation: 'none',
      globalOverlayConfig: { color: '#FFF', backgroundColor: '#000', fontFamily: 'Inter' },
      confirmed: true, aspectRatio: '16:9', resolutionTier: '1080p',
    },
  };
}

function storedProjectJson(id: string, name: string, segments: number, savedAt = 1000): string {
  return JSON.stringify(storedProject(id, name, segments, savedAt));
}

/** Seeds IndexedDB as if `id` had already been saved locally (pre-adoption). */
async function seedLocal(id: string, name: string, segments: number, savedAt = 1000): Promise<void> {
  const fixture = storedProject(id, name, segments, savedAt);
  await putProjectRecord({ id, ...fixture });
}

beforeEach(() => {
  __resetStoreGuardsForTests();
  installLocalStorage();
  readMirror.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('adoptMirroredProjects', () => {
  it('is a no-op outside Tauri (readMirror returns null)', async () => {
    readMirror.mockResolvedValue(null);
    const report = await adoptMirroredProjects();
    expect(report.mirrorAvailable).toBe(false);
    expect(report.adopted).toEqual([]);
    expect(backing.size).toBe(0);
  });

  it('adopts a project this origin has never seen, and registers it', async () => {
    readMirror.mockResolvedValue({
      registry: JSON.stringify([{ id: 'v6-a', name: 'V6 New Audio Long Pauses', savedAt: 2000, segmentCount: 447 }]),
      projects: [['v6-a', storedProjectJson('v6-a', 'V6 New Audio Long Pauses', 447, 2000)]],
    });

    const report = await adoptMirroredProjects();

    expect(report.mirrorAvailable).toBe(true);
    expect(report.adopted).toEqual(['v6-a']);
    expect((await loadProject('v6-a'))!.project.segments).toHaveLength(447);
    expect(loadAllMetas().map(m => m.id)).toContain('v6-a');
    expect(loadAllMetas().find(m => m.id === 'v6-a')!.segmentCount).toBe(447);
  });

  it('NEVER overwrites a project this origin already has — even a newer, bigger mirrored one', async () => {
    await seedLocal('v6-b', 'Local V6', 3, 500);
    readMirror.mockResolvedValue({
      registry: null,
      projects: [['v6-b', storedProjectJson('v6-b', 'Mirrored V6', 447, 999999)]],
    });

    const report = await adoptMirroredProjects();

    expect(report.adopted).toEqual([]);
    expect(report.skippedAlreadyLocal).toEqual(['v6-b']);
    expect((await loadProject('v6-b'))!.project.segments).toHaveLength(3);
    expect((await loadProject('v6-b'))!.project.name).toBe('Local V6');
  });

  it('adopts the missing ones and leaves the present ones alone, in one pass', async () => {
    await seedLocal('a2', 'Local A', 5);
    readMirror.mockResolvedValue({
      registry: null,
      projects: [
        ['a2', storedProjectJson('a2', 'Mirror A', 99)],
        ['b2', storedProjectJson('b2', 'Mirror B', 27)],
        ['c2', storedProjectJson('c2', 'Mirror C', 26)],
      ],
    });

    const report = await adoptMirroredProjects();

    expect(report.adopted.sort()).toEqual(['b2', 'c2']);
    expect(report.skippedAlreadyLocal).toEqual(['a2']);
    expect((await loadProject('a2'))!.project.name).toBe('Local A');
    expect((await loadProject('b2'))!.project.segments).toHaveLength(27);
    expect((await loadProject('c2'))!.project.segments).toHaveLength(26);
  });

  it('refuses to inject a malformed mirrored value into this origin', async () => {
    readMirror.mockResolvedValue({
      registry: null,
      projects: [
        ['bad', '{"version":2,"project":{'],
        ['worse', JSON.stringify({ version: 2, savedAt: 1, project: { id: 'worse' } })],
        ['good', storedProjectJson('good', 'Good', 4)],
      ],
    });

    const report = await adoptMirroredProjects();

    expect(report.adopted).toEqual(['good']);
    expect(report.failed.map(f => f.id).sort()).toEqual(['bad', 'worse']);
    expect(await loadProject('bad')).toBeNull();
    expect(await loadProject('worse')).toBeNull();
  });

  it('survives an unparseable mirror registry by synthesising metas from the projects', async () => {
    readMirror.mockResolvedValue({
      registry: 'not json',
      projects: [['v6-c', storedProjectJson('v6-c', 'V6 New Audio Long Pauses', 447, 2000)]],
    });

    const report = await adoptMirroredProjects();

    expect(report.adopted).toEqual(['v6-c']);
    const meta = loadAllMetas().find(m => m.id === 'v6-c')!;
    expect(meta.name).toBe('V6 New Audio Long Pauses');
    expect(meta.segmentCount).toBe(447);
    expect(meta.savedAt).toBe(2000);
  });
});
