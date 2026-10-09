/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { WORKSPACES_KEY, WorkspaceRegistry, inWorkspace, resolveWorkspaceFilter } from './workspaceRegistry';

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
