// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetStoreGuardsForTests,
  adoptMirroredProjects,
  commitTombstones,
  deletedProjectIds,
  loadAllMetas,
  loadProject,
  saveProject,
  upsertProjectMeta,
} from './projectStore';
import { isTauri } from './tauriFfmpeg';
import type { Project } from '../types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./tauriFfmpeg', () => ({ isTauri: vi.fn(() => false) }));

const REGISTRY = 'kinetix:projects:v1';
const TOMBSTONE = 'kinetix:deleted-projects:v1';

function persistTombstoneOnly(ids: string[]): void {
  localStorage.setItem(TOMBSTONE, JSON.stringify(ids));
}

function seed(n: number): string[] {
  const metas = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, savedAt: i, segmentCount: 1,
  }));
  localStorage.setItem(REGISTRY, JSON.stringify(metas));
  return metas.map(m => m.id);
}

const blank = (id: string): Project => ({
  id, name: 'X', script: '', sceneDetails: '', segments: [], headings: [], assets: [],
} as unknown as Project);

beforeEach(() => {
  localStorage.clear();
  __resetStoreGuardsForTests();
});

describe('tombstones — a deleted id never reappears', () => {
  it('(a) delete 10 projects, immediate reload: 0 reappear even if the registry file still lists them', async () => {
    const ids = seed(10);
    expect(loadAllMetas()).toHaveLength(10);
    await commitTombstones(ids);
    expect(loadAllMetas()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(REGISTRY) ?? '[]')).toHaveLength(0);
    expect(ids.every(id => deletedProjectIds().has(id))).toBe(true);
  });

  it('(b) kill mid-delete: tombstones in storage survive a session reset (crash) so relaunch still hides them', async () => {
    seed(3);
    await commitTombstones(['p0', 'p1']);
    __resetStoreGuardsForTests();
    expect(deletedProjectIds().has('p0')).toBe(true);
    expect(deletedProjectIds().has('p1')).toBe(true);
    expect(loadAllMetas().map(m => m.id)).toEqual(['p2']);
  });

  it('(c) a delayed mirror write for a dead id is ignored by adoption', async () => {
    await commitTombstones(['gone']);
    vi.mocked(isTauri).mockReturnValue(true);
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'project_tombstones_list') return ['gone'];
      if (cmd === 'project_mirror_read_all') {
        return {
          registry: JSON.stringify([{ id: 'gone', name: 'Dead', savedAt: 1, segmentCount: 0 }]),
          projects: [['gone', JSON.stringify({ version: 6, savedAt: 1, project: { id: 'gone', name: 'Dead', segments: [], assets: [] } })]],
        };
      }
      if (cmd === 'project_store_read') return null;
      return undefined;
    });
    const report = await adoptMirroredProjects();
    expect(report.adopted).toEqual([]);
    expect(loadAllMetas().some(m => m.id === 'gone')).toBe(false);
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('(d) background cleaner / late upsert touching a tombstoned id changes nothing', async () => {
    seed(1);
    await commitTombstones(['p0']);
    upsertProjectMeta({ id: 'p0', name: 'Resurrected', savedAt: 99, segmentCount: 9 });
    await saveProject(blank('p0'));
    expect(loadAllMetas()).toEqual([]);
    expect(await loadProject('p0')).toBeNull();
  });

  it('loadAllMetas hides tombstoned ids even if the registry JSON was not stripped yet', async () => {
    seed(2);
    persistTombstoneOnly(['p0']);
    expect(loadAllMetas().map(m => m.id)).toEqual(['p1']);
  });
});
