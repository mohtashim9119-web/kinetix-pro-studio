// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// "Export once → path saved." A manual export confirms its output path; Bulk
// Export must then see it — through the registry meta, written at path
// CONFIRMATION, not only through the project record's debounced autosave (an
// undo or a not-yet-landed autosave would otherwise lose it).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadAllMetas, recordLastExportPath, saveProject } from './projectStore';
import { BulkExportRunner } from './bulkExportQueue';
import { BULK_EXPORT_NO_PATH } from './bulkExportSettings';
import type { Asset, Project, VideoSegment } from '../types';

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};

const ID = '44444444-4444-4444-8444-444444444444';

/** The stored record as it is BEFORE the editor's autosave lands: no path. */
const stored = (): Project => ({
  id: ID, name: 'Manual', script: '', sceneDetails: '', headings: [], textLayers: [], confirmed: true,
  segments: [{ id: 's1', startTime: 0, duration: 1, assetId: 'a1', text: '' } as VideoSegment],
  assets: [{ id: 'a1', name: 'a1', type: 'image', url: 'blob:x' } as Asset],
} as unknown as Project);

function runnerOver(project: Project, started: string[] = []): BulkExportRunner {
  return new BulkExportRunner({
    listProjects: () => loadAllMetas().map(m => ({ id: m.id, name: m.name, lastExportPath: m.lastExportPath })),
    loadProject: async id => (id === project.id ? project : null),
    storage: mem(),
    playChime: () => {},
    execute: async ({ project: p }) => { started.push(p.id); return { status: 'done' }; },
  });
}

beforeEach(() => localStorage.clear());

describe('lastExportPath wiring: manual export → bulk export', () => {
  it('confirming a path writes it to the project meta, and the row is not blocked', async () => {
    const p = stored();
    expect((await saveProject(p)).ok).toBe(true);

    expect(recordLastExportPath(ID, '/Users/me/out/Manual_1.mp4')).toBe(true);
    expect(loadAllMetas().find(m => m.id === ID)?.lastExportPath).toBe('/Users/me/out/Manual_1.mp4');

    const started: string[] = [];
    const runner = runnerOver(p, started);
    runner.setSelected(ID, true);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot().find(r => r.id === ID)?.phase).toBe('done'));
    expect(started).toEqual([ID]);
  });

  it('a later full save keeps the meta path (registry upserts merge, never drop it)', async () => {
    const p = stored();
    await saveProject(p);
    recordLastExportPath(ID, '/o/a.mp4');
    await saveProject({ ...p, name: 'Renamed' });
    expect(loadAllMetas().find(m => m.id === ID)).toMatchObject({ name: 'Renamed', lastExportPath: '/o/a.mp4' });
  });

  it('reports false (not silent) when the project has no registry entry', () => {
    expect(recordLastExportPath('55555555-5555-4555-8555-555555555555', '/o/a.mp4')).toBe(false);
  });

  it('an export finished while the app was open: reopening the drawer clears the stale block, Start then runs', async () => {
    const p = stored();
    await saveProject(p);
    const started: string[] = [];
    const runner = runnerOver(p, started);
    runner.setSelected(ID, true);
    await runner.startSelected();
    expect(runner.snapshot().find(r => r.id === ID)).toMatchObject({ phase: 'blocked', message: BULK_EXPORT_NO_PATH });

    // Manual export in the editor confirms a path while the drawer is closed.
    recordLastExportPath(ID, '/o/Manual.mp4');

    // Drawer reopens: fresh metas, the stale block is gone.
    await runner.refresh();
    expect(runner.snapshot().find(r => r.id === ID)).toMatchObject({ phase: 'idle', message: undefined });

    // Ready again: the operator selects it (Start spent the earlier selection).
    runner.setSelected(ID, true);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot().find(r => r.id === ID)?.phase).toBe('done'));
    expect(started).toEqual([ID]);
  });

  it('refresh keeps a row blocked when it still has no path', async () => {
    const p = stored();
    await saveProject(p);
    const runner = runnerOver(p);
    runner.setSelected(ID, true);
    await runner.startSelected();
    await runner.refresh();
    expect(runner.snapshot().find(r => r.id === ID)).toMatchObject({ phase: 'blocked', message: BULK_EXPORT_NO_PATH });
  });
});
