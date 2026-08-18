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
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const readMirror = vi.fn();
vi.mock('./projectMirror', () => ({
  readMirror: (...a: unknown[]) => readMirror(...a),
  writeMirroredProject: vi.fn(async () => {}),
  deleteMirroredProject: vi.fn(async () => {}),
}));

import { adoptMirroredProjects, loadProject, loadAllMetas, __resetStoreGuardsForTests } from './projectStore';

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

function storedProject(id: string, name: string, segments: number, savedAt = 1000): string {
  return JSON.stringify({
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
  });
}

const key = (id: string): string => `kinetix:project:${id}:v1`;

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
      registry: JSON.stringify([{ id: 'v6', name: 'V6 New Audio Long Pauses', savedAt: 2000, segmentCount: 447 }]),
      projects: [['v6', storedProject('v6', 'V6 New Audio Long Pauses', 447, 2000)]],
    });

    const report = await adoptMirroredProjects();

    expect(report.mirrorAvailable).toBe(true);
    expect(report.adopted).toEqual(['v6']);
    expect(loadProject('v6')!.project.segments).toHaveLength(447);
    expect(loadAllMetas().map(m => m.id)).toContain('v6');
    expect(loadAllMetas().find(m => m.id === 'v6')!.segmentCount).toBe(447);
  });

  it('NEVER overwrites a project this origin already has — even a newer, bigger mirrored one', async () => {
    const localBytes = storedProject('v6', 'Local V6', 3, 500);
    backing.set(key('v6'), localBytes);
    readMirror.mockResolvedValue({
      registry: null,
      projects: [['v6', storedProject('v6', 'Mirrored V6', 447, 999999)]],
    });

    const report = await adoptMirroredProjects();

    expect(report.adopted).toEqual([]);
    expect(report.skippedAlreadyLocal).toEqual(['v6']);
    // Byte-for-byte untouched.
    expect(backing.get(key('v6'))).toBe(localBytes);
    expect(loadProject('v6')!.project.segments).toHaveLength(3);
    expect(loadProject('v6')!.project.name).toBe('Local V6');
  });

  it('adopts the missing ones and leaves the present ones alone, in one pass', async () => {
    const localBytes = storedProject('a', 'Local A', 5);
    backing.set(key('a'), localBytes);
    readMirror.mockResolvedValue({
      registry: null,
      projects: [
        ['a', storedProject('a', 'Mirror A', 99)],
        ['b', storedProject('b', 'Mirror B', 27)],
        ['c', storedProject('c', 'Mirror C', 26)],
      ],
    });

    const report = await adoptMirroredProjects();

    expect(report.adopted.sort()).toEqual(['b', 'c']);
    expect(report.skippedAlreadyLocal).toEqual(['a']);
    expect(backing.get(key('a'))).toBe(localBytes);
    expect(loadProject('b')!.project.segments).toHaveLength(27);
    expect(loadProject('c')!.project.segments).toHaveLength(26);
  });

  it('refuses to inject a malformed mirrored value into this origin', async () => {
    readMirror.mockResolvedValue({
      registry: null,
      projects: [
        ['bad', '{"version":2,"project":{'],
        ['worse', JSON.stringify({ version: 2, savedAt: 1, project: { id: 'worse' } })],
        ['good', storedProject('good', 'Good', 4)],
      ],
    });

    const report = await adoptMirroredProjects();

    expect(report.adopted).toEqual(['good']);
    expect(report.failed.map(f => f.id).sort()).toEqual(['bad', 'worse']);
    expect(backing.has(key('bad'))).toBe(false);
    expect(backing.has(key('worse'))).toBe(false);
  });

  it('survives an unparseable mirror registry by synthesising metas from the projects', async () => {
    readMirror.mockResolvedValue({
      registry: 'not json',
      projects: [['v6', storedProject('v6', 'V6 New Audio Long Pauses', 447, 2000)]],
    });

    const report = await adoptMirroredProjects();

    expect(report.adopted).toEqual(['v6']);
    const meta = loadAllMetas().find(m => m.id === 'v6')!;
    expect(meta.name).toBe('V6 New Audio Long Pauses');
    expect(meta.segmentCount).toBe(447);
    expect(meta.savedAt).toBe(2000);
  });
});
