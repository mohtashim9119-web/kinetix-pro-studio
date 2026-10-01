/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk UI rebuild U1 — the batch is organised in GROUPS: a name, a collapse
// toggle, 2–30 rows each, at most 10 groups. A batch saved before groups
// existed becomes one default group. Groups persist with the batch.

import { describe, it, expect } from 'vitest';
import {
  BULK_GROUP_MAX_ROWS, BULK_GROUP_MIN_ROWS, BULK_MAX_GROUPS, BulkBatchRunner, groupProgress, batchProgress,
} from './bulkBatch';
import { SyncQueue, type QueueEngine } from './syncQueue';

const engine: QueueEngine = { workerSec: () => 0, usdPerSec: 0, onDrain: () => {}, cancelReceipt: () => 'r' };
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
};
const boot = (disk: ReturnType<typeof memory>, exists: (id: string) => boolean = () => true) =>
  new BulkBatchRunner({ queue: new SyncQueue(engine), exists, storage: disk, enqueue: () => {} });
const ids = (n: number, p = 'r'): string[] => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe('bulk groups', () => {
  it('limits: 2–30 rows per group, at most 10 groups', () => {
    expect([BULK_GROUP_MIN_ROWS, BULK_GROUP_MAX_ROWS, BULK_MAX_GROUPS]).toEqual([2, 30, 10]);
    const runner = boot(memory());
    expect(runner.createGroup(ids(1))).toBeUndefined();
    expect(runner.createGroup(ids(31))).toBeUndefined();
    for (let g = 0; g < 10; g += 1) expect(runner.createGroup(ids(2, `g${g}-`))).toBeDefined();
    expect(runner.createGroup(ids(2, 'x'))).toBeUndefined();
    expect(runner.canCreateGroup()).toBe(false);
    expect(runner.groups()).toHaveLength(10);
  });

  it('each group has a name and a collapse toggle; both persist across a restart', () => {
    const disk = memory();
    const a = boot(disk);
    const g1 = a.createGroup(ids(3, 'a'))!;
    const g2 = a.createGroup(ids(2, 'b'))!;
    expect(g1.name).toBe('Group 1');
    expect(g2.name).toBe('Group 2');
    a.setCollapsed(g1.id, true);
    a.renameGroup(g2.id, 'Client B');
    const b = boot(disk);
    expect(b.groups().map(g => [g.name, g.collapsed, g.rowIds.length])).toEqual([['Group 1', true, 3], ['Client B', false, 2]]);
  });

  it('a batch saved before groups existed becomes ONE default group holding every row', () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({ rows: [
      { id: 'a', name: 'A', phase: 'done' }, { id: 'b', name: 'B', phase: 'cloud' }, { id: 'c', name: 'C', phase: 'failed' },
    ] }));
    const runner = boot(disk);
    expect(runner.groups()).toHaveLength(1);
    expect(runner.groups()[0]!.rowIds).toEqual(['a', 'b', 'c']);
    expect(runner.groups()[0]!.collapsed).toBe(false);
  });

  it('adding a row stops at 30; removing a row empties its record AND its group slot; an empty group goes', () => {
    const runner = boot(memory());
    const g = runner.createGroup(ids(29))!;
    expect(runner.addRowToGroup(g.id, 'extra')).toBe(true);
    expect(runner.addRowToGroup(g.id, 'one-too-many')).toBe(false);
    const small = runner.createGroup(['x', 'y'])!;
    runner.start([{ id: 'x', name: 'X' }]);
    runner.removeRow('x');
    expect(runner.snapshot().some(r => r.id === 'x')).toBe(false);
    expect(runner.groups().find(gr => gr.id === small.id)!.rowIds).toEqual(['y']);
    runner.removeRow('y');
    expect(runner.groups().some(gr => gr.id === small.id)).toBe(false);
  });

  it('progress: n/m done and the failed count, per group and for the whole batch', () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({
      rows: [
        { id: 'a', name: 'A', phase: 'done' }, { id: 'b', name: 'B', phase: 'failed' },
        { id: 'c', name: 'C', phase: 'cloud' }, { id: 'd', name: 'D', phase: 'finish-failed' },
      ],
      groups: [
        { id: 'g1', name: 'One', collapsed: false, rowIds: ['a', 'b', 'draft-1'] },
        { id: 'g2', name: 'Two', collapsed: false, rowIds: ['c', 'd'] },
      ],
    }));
    const runner = boot(disk);
    const [g1, g2] = runner.groups();
    expect(groupProgress(g1!, runner.snapshot())).toEqual({ done: 1, total: 3, failed: 1, running: false });
    expect(groupProgress(g2!, runner.snapshot())).toEqual({ done: 0, total: 2, failed: 1, running: true });
    expect(batchProgress(runner.groups(), runner.snapshot())).toEqual({ done: 1, total: 5, failed: 2, running: true });
  });

  it('"Clear finished" on one group leaves the other groups alone, and nothing clears by itself', () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({
      rows: [{ id: 'a', name: 'A', phase: 'done' }, { id: 'b', name: 'B', phase: 'done' }, { id: 'c', name: 'C', phase: 'cloud' }],
      groups: [
        { id: 'g1', name: 'One', collapsed: false, rowIds: ['a', 'c'] },
        { id: 'g2', name: 'Two', collapsed: false, rowIds: ['b', 'z'] },
      ],
    }));
    const runner = boot(disk);
    runner.resume();
    expect(runner.snapshot().map(r => r.id)).toEqual(['a', 'b', 'c']);
    runner.clearFinished('g1');
    expect(runner.snapshot().map(r => r.id)).toEqual(['b', 'c']);
    expect(runner.groups().map(g => g.rowIds)).toEqual([['c'], ['b', 'z']]);
  });

  it('a row reaching done is announced once (the toast), never opened', async () => {
    const runner = boot(memory());
    runner.createGroup(['a', 'b']);
    runner.start([{ id: 'a', name: 'Project 7' }]);
    const heard: string[] = [];
    runner.onReady(r => heard.push(r.name));
    runner.setFinalizer(async () => ({ ok: true }));
    // Pretend the cloud finished.
    (runner as unknown as { rows: { phase: string }[] }).rows[0]!.phase = 'cloud-done';
    expect(runner.finishNow('a')).toBe(true);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(heard).toEqual(['Project 7']);
  });

  it('a deleted project leaves its group on boot too', () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({
      rows: [{ id: 'a', name: 'A', phase: 'done' }, { id: 'b', name: 'B', phase: 'done' }],
      groups: [{ id: 'g1', name: 'One', collapsed: false, rowIds: ['a', 'b', 'draft'] }],
    }));
    const runner = boot(disk, id => id !== 'a');
    runner.resume();
    expect(runner.groups()[0]!.rowIds).toEqual(['b', 'draft']);
  });
});
