/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// F2 — the queue uses the workspace's export settings: resolution, fps and the
// folder, with the project's own as fallback and the All tab for projects in
// no workspace.

import { describe, it, expect, vi } from 'vitest';
import { BulkExportRunner, type BulkExportExecutorInput } from './bulkExportQueue';
import { BULK_EXPORT_NO_PATH } from './bulkExportSettings';
import { WorkspaceRegistry } from '../components/workspaceRegistry';
import { WorkspaceExportSettingsStore, exportSettingsForProject } from '../components/workspaceExportSettings';
import type { Asset, Project, VideoSegment } from '../types';

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};
const project = (id: string, name: string, extra: Record<string, unknown> = {}): Project => ({
  id, name, script: '', sceneDetails: '',
  segments: [{ id: 's', startTime: 0, duration: 1, assetId: 'a', text: '' } as VideoSegment],
  assets: [{ id: 'a', name: 'a', type: 'image', url: 'blob:x' } as Asset],
  ...extra,
}) as unknown as Project;

function setup(projects: Project[], metaPaths: Record<string, string> = {}) {
  const registry = new WorkspaceRegistry(mem());
  const store = new WorkspaceExportSettingsStore(mem());
  const runs: BulkExportExecutorInput[] = [];
  const runner = new BulkExportRunner({
    listProjects: () => projects.map(p => ({ id: p.id, name: p.name, lastExportPath: metaPaths[p.id] })),
    loadProject: async id => projects.find(p => p.id === id) ?? null,
    exportSettingsFor: id => exportSettingsForProject(id, registry, store),
    storage: mem(), playChime: () => {},
    execute: async input => { runs.push(input); return { status: 'done' }; },
  });
  return { registry, store, runner, runs };
}
const done = (r: BulkExportRunner, n: number): Promise<void> => vi.waitFor(() => expect(r.snapshot().filter(x => x.phase === 'done')).toHaveLength(n));

describe('workspace export settings reach the queue', () => {
  it('a workspace folder unblocks the row; the file lands there under the project name', async () => {
    const { registry, store, runner, runs } = setup([project('a', 'Sunrise: Take 2')]);
    const ws = registry.create('Cooking');
    registry.assign(['a'], ws.id);
    runner.setSelected('a', true);
    await runner.startSelected();
    expect(runner.snapshot()[0]).toMatchObject({ phase: 'blocked', message: BULK_EXPORT_NO_PATH });
    store.set(ws.id, { folder: '/Exports/Cooking', resolution: '720p', fps: 24 });
    await runner.retry('a');
    await done(runner, 1);
    expect(runs[0]).toMatchObject({ savedPath: '/Exports/Cooking/Sunrise_ Take 2.mp4', resolution: '720p', fps: 24 });
  });

  it("falls back to the project's own last export folder", async () => {
    const { runner, runs } = setup([project('a', 'Clip', { lastExportPath: '/rec/old.mp4' })]);
    runner.setSelected('a', true);
    await runner.startSelected();
    await done(runner, 1);
    expect(runs[0]!.savedPath).toBe('/rec/Clip.mp4');
    expect(runs[0]!.fps).toBe(30);
  });

  it('two projects with the same name do not overwrite each other', async () => {
    const { registry, store, runner, runs } = setup([project('a', 'Clip'), project('b', 'Clip')]);
    const ws = registry.create('W');
    registry.assign(['a', 'b'], ws.id);
    store.set(ws.id, { folder: '/out' });
    runner.setSelectedAll(true);
    await runner.startSelected();
    await done(runner, 2);
    expect(runs.map(r => r.savedPath).sort()).toEqual(['/out/Clip (2).mp4', '/out/Clip.mp4']);
  });

  it('a project in no workspace takes the All tab settings', async () => {
    const { store, runner, runs } = setup([project('a', 'Free')]);
    store.set('all', { folder: '/All', resolution: '720p', fps: 24 });
    runner.setSelected('a', true);
    await runner.startSelected();
    await done(runner, 1);
    expect(runs[0]).toMatchObject({ savedPath: '/All/Free.mp4', resolution: '720p', fps: 24 });
  });
});
