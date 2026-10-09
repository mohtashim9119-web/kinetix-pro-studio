/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  WORKSPACES_KEY, WORKSPACES_MIGRATED_KEY, WorkspaceRegistry, inWorkspace, migrateBulkGroupsToWorkspaces,
  readWorkspaceMigration, resolveWorkspaceFilter,
} from './workspaceRegistry';

function memStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed));
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

describe('WorkspaceRegistry', () => {
  it('creates workspaces in order, with a default name for a blank one; no count cap', () => {
    const reg = new WorkspaceRegistry(memStorage());
    const a = reg.create('Channel A');
    const b = reg.create('   ');
    expect(a.name).toBe('Channel A');
    expect(b.name).toBe('Workspace 1');
    for (let i = 0; i < 25; i++) reg.create(`More ${i}`);
    expect(reg.snapshot()).toHaveLength(27);
    expect(reg.snapshot().map(w => w.order)).toEqual([...reg.snapshot().map(w => w.order)].sort((x, y) => x - y));
  });

  it('persists to kinetix:workspaces:v1 with id, name, projectIds, order — and reloads it', () => {
    const storage = memStorage();
    const reg = new WorkspaceRegistry(storage);
    const ws = reg.create('Cooking');
    reg.assign(['p1', 'p2'], ws.id);
    const raw = JSON.parse(storage.getItem(WORKSPACES_KEY)!);
    expect(raw.workspaces[0]).toEqual({ id: ws.id, name: 'Cooking', projectIds: ['p1', 'p2'], order: 0 });
    const again = new WorkspaceRegistry(storage);
    expect(again.snapshot()).toEqual(reg.snapshot());
  });

  it('rename trims and ignores blank names', () => {
    const reg = new WorkspaceRegistry(memStorage());
    const ws = reg.create('Old');
    reg.rename(ws.id, '  New  ');
    expect(reg.snapshot()[0]!.name).toBe('New');
    reg.rename(ws.id, '   ');
    expect(reg.snapshot()[0]!.name).toBe('New');
  });

  it('delete removes the workspace only — its projects fall back to unassigned', () => {
    const reg = new WorkspaceRegistry(memStorage());
    const a = reg.create('A');
    const b = reg.create('B');
    reg.assign(['p1', 'p2'], a.id);
    reg.assign(['p3'], b.id);
    reg.remove(a.id);
    expect(reg.snapshot().map(w => w.name)).toEqual(['B']);
    expect(reg.workspaceOf('p1')).toBeUndefined();
    expect(reg.workspaceOf('p3')?.id).toBe(b.id);
  });

  it('assign has move semantics: one workspace per project', () => {
    const reg = new WorkspaceRegistry(memStorage());
    const a = reg.create('A');
    const b = reg.create('B');
    reg.assign(['p1', 'p2'], a.id);
    reg.assign(['p2'], b.id);
    expect(reg.snapshot().find(w => w.id === a.id)!.projectIds).toEqual(['p1']);
    expect(reg.snapshot().find(w => w.id === b.id)!.projectIds).toEqual(['p2']);
    reg.assign(['p1'], null);
    expect(reg.workspaceOf('p1')).toBeUndefined();
    reg.assign(['p9'], 'no-such-workspace');
    expect(reg.workspaceOf('p9')).toBeUndefined();
  });

  it('a hand-edited store that lists a project twice keeps only its first workspace', () => {
    const storage = memStorage({
      [WORKSPACES_KEY]: JSON.stringify({ workspaces: [
        { id: 'a', name: 'A', projectIds: ['p1'], order: 0 },
        { id: 'b', name: 'B', projectIds: ['p1', 'p2'], order: 1 },
      ] }),
    });
    const reg = new WorkspaceRegistry(storage);
    expect(reg.snapshot().map(w => w.projectIds)).toEqual([['p1'], ['p2']]);
  });

  it('forget drops deleted projects from their workspace', () => {
    const reg = new WorkspaceRegistry(memStorage());
    const a = reg.create('A');
    reg.assign(['p1', 'p2'], a.id);
    reg.forget(['p1']);
    expect(reg.snapshot()[0]!.projectIds).toEqual(['p2']);
  });

  it('corrupt storage starts empty', () => {
    const reg = new WorkspaceRegistry(memStorage({ [WORKSPACES_KEY]: '{not json' }));
    expect(reg.snapshot()).toEqual([]);
  });

  it('snapshot identity is stable between changes and changes on commit', () => {
    const reg = new WorkspaceRegistry(memStorage());
    const before = reg.snapshot();
    expect(reg.snapshot()).toBe(before);
    let calls = 0;
    reg.subscribe(() => { calls += 1; });
    reg.create('A');
    expect(reg.snapshot()).not.toBe(before);
    expect(calls).toBe(1);
  });
});

describe('workspace filters', () => {
  const ws = [{ id: 'a', name: 'A', projectIds: ['p1'], order: 0 }];
  it('All shows everything, a workspace only its members', () => {
    expect(inWorkspace(ws, 'all', 'p2')).toBe(true);
    expect(inWorkspace(ws, 'a', 'p1')).toBe(true);
    expect(inWorkspace(ws, 'a', 'p2')).toBe(false);
  });
  it('a filter naming a deleted workspace falls back to All', () => {
    expect(resolveWorkspaceFilter(ws, 'gone')).toBe('all');
    expect(resolveWorkspaceFilter(ws, 'a')).toBe('a');
  });
});

describe('one-time migration: bulk groups → workspaces', () => {
  const batch = (groups: { id: string; name: string; rowIds: string[] }[]): string =>
    JSON.stringify({ rows: [], groups: groups.map(g => ({ ...g, collapsed: false })) });

  it('every group becomes a workspace with the same name and members, and the counts are recorded', () => {
    const storage = memStorage({
      'kinetix:bulk-batch:v1': batch([
        { id: 'g1', name: 'Client A', rowIds: ['a', 'b'] },
        { id: 'g2', name: 'Client B', rowIds: ['c', 'd', 'e'] },
      ]),
    });
    const reg = new WorkspaceRegistry(storage);
    const result = migrateBulkGroupsToWorkspaces(reg, storage);
    expect(result).toEqual({ workspaces: 2, projects: 5, skipped: 0 });
    expect(reg.snapshot().map(w => [w.name, w.projectIds])).toEqual([['Client A', ['a', 'b']], ['Client B', ['c', 'd', 'e']]]);
    expect(readWorkspaceMigration(storage)).toMatchObject({ workspaces: 2, projects: 5, skipped: 0 });
  });

  it('is guarded by a done-flag: it never reruns (not even when groups change later)', () => {
    const storage = memStorage({ 'kinetix:bulk-batch:v1': batch([{ id: 'g1', name: 'A', rowIds: ['a', 'b'] }]) });
    const reg = new WorkspaceRegistry(storage);
    migrateBulkGroupsToWorkspaces(reg, storage);
    storage.setItem('kinetix:bulk-batch:v1', batch([{ id: 'g9', name: 'Later', rowIds: ['x', 'y'] }]));
    expect(migrateBulkGroupsToWorkspaces(reg, storage)).toBeNull();
    expect(migrateBulkGroupsToWorkspaces(new WorkspaceRegistry(storage), storage)).toBeNull();
    expect(reg.snapshot().map(w => w.name)).toEqual(['A']);
  });

  it('no batch (or no groups): records a zero result and sets the flag', () => {
    const storage = memStorage();
    const reg = new WorkspaceRegistry(storage);
    expect(migrateBulkGroupsToWorkspaces(reg, storage)).toEqual({ workspaces: 0, projects: 0, skipped: 0 });
    expect(storage.getItem(WORKSPACES_MIGRATED_KEY)).not.toBeNull();
    expect(reg.snapshot()).toEqual([]);
  });

  it('a project already in a workspace keeps it (one workspace per project); the rest migrate', () => {
    const storage = memStorage({ 'kinetix:bulk-batch:v1': batch([{ id: 'g1', name: 'A', rowIds: ['a', 'b'] }]) });
    const reg = new WorkspaceRegistry(storage);
    const mine = reg.create('Mine');
    reg.assign(['a'], mine.id);
    expect(migrateBulkGroupsToWorkspaces(reg, storage)).toEqual({ workspaces: 1, projects: 1, skipped: 1 });
    expect(reg.workspaceOf('a')?.id).toBe(mine.id);
    expect(reg.snapshot().find(w => w.name === 'A')!.projectIds).toEqual(['b']);
  });

  it('never writes the bulk batch', () => {
    const raw = batch([{ id: 'g1', name: 'A', rowIds: ['a', 'b'] }]);
    const storage = memStorage({ 'kinetix:bulk-batch:v1': raw });
    migrateBulkGroupsToWorkspaces(new WorkspaceRegistry(storage), storage);
    expect(storage.getItem('kinetix:bulk-batch:v1')).toBe(raw);
  });

  it('corrupt batch storage migrates nothing but still sets the flag', () => {
    const storage = memStorage({ 'kinetix:bulk-batch:v1': '{oops' });
    expect(migrateBulkGroupsToWorkspaces(new WorkspaceRegistry(storage), storage)).toEqual({ workspaces: 0, projects: 0, skipped: 0 });
    expect(storage.getItem(WORKSPACES_MIGRATED_KEY)).not.toBeNull();
  });
});
