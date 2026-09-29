/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7.8 — the batch is a persistent background job: it survives closing
// the window, a reload, a quit or a crash, and picks up from its last state.

import { describe, it, expect, vi } from 'vitest';
import { BulkBatchRunner } from './bulkBatch';
import { SyncQueue, type QueueEngine, type QueueJob } from './syncQueue';

const engine: QueueEngine = { workerSec: () => 0, usdPerSec: 0, onDrain: () => {}, cancelReceipt: () => 'r' };
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
};

/** A "process": its own queue + runner over shared storage (the disk). */
function boot(storage: ReturnType<typeof memory>, exists: (id: string) => boolean = () => true) {
  const queue = new SyncQueue(engine);
  const started: string[] = [];
  const gates = new Map<string, () => void>();
  const runner = new BulkBatchRunner({
    queue,
    exists,
    storage,
    enqueue: rows => queue.enqueue(rows.map((r): QueueJob => ({
      id: r.id, label: r.name,
      run: async ctx => {
        started.push(r.id);
        await new Promise<void>((res, rej) => { gates.set(r.id, res); ctx.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
        return { status: 'done' };
      },
    }))),
  });
  return { queue, runner, started, finishCloud: (id: string) => gates.get(id)?.() };
}
const phases = (r: BulkBatchRunner) => Object.fromEntries(r.snapshot().map(x => [x.id, x.phase]));

describe('a persistent batch', () => {
  it('records every phase to storage, so a reload finds the batch exactly where it was', async () => {
    const disk = memory();
    const p1 = boot(disk);
    p1.runner.start([{ id: 'a', name: 'Alpine' }, { id: 'b', name: 'Valley' }]);
    await vi.waitFor(() => expect(phases(p1.runner)).toEqual({ a: 'cloud', b: 'queued' }));
    // "Reload": a brand-new process reads the same disk.
    const p2 = boot(disk);
    expect(phases(p2.runner)).toEqual({ a: 'cloud', b: 'queued' });
    expect(p2.runner.snapshot().map(r => r.name)).toEqual(['Alpine', 'Valley']);
  });

  it('resume() re-queues the unfinished cloud work after a restart (cache hits + the gateway\'s in-flight reuse make it free); finished rows are not re-run', async () => {
    const disk = memory();
    const p1 = boot(disk);
    p1.runner.start([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await vi.waitFor(() => expect(p1.started).toEqual(['a']));
    p1.finishCloud('a');
    await vi.waitFor(() => expect(phases(p1.runner)).toEqual({ a: 'cloud-done', b: 'cloud' }));
    // Crash: nothing else is written. New process:
    const p2 = boot(disk);
    p2.runner.resume();
    await vi.waitFor(() => expect(p2.started).toEqual(['b']));
    expect(phases(p2.runner)).toEqual({ a: 'cloud-done', b: 'cloud' });
  });

  it('cloud work runs with NO window open; finishing the timelines waits for a window (or the operator), then runs one at a time', async () => {
    const disk = memory();
    const { runner, finishCloud, started } = boot(disk);
    const order: string[] = [];
    runner.setFinalizer(async id => { order.push(id); return { ok: true }; });
    runner.start([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    finishCloud('a');
    await vi.waitFor(() => expect(phases(runner).a).toBe('cloud-done'));
    await new Promise(r => setTimeout(r, 20));
    expect(order).toEqual([]); // no window: not finished yet
    const release = runner.holdFinishOpen();
    await vi.waitFor(() => expect(phases(runner).a).toBe('done'));
    finishCloud('b');
    await vi.waitFor(() => expect(phases(runner)).toEqual({ a: 'done', b: 'done' }));
    expect(order).toEqual(['a', 'b']);
    release();
  });

  it('a finish that fails is recorded with its reason (the project stays openable)', async () => {
    const { runner, finishCloud, started } = boot(memory());
    runner.setFinalizer(async () => ({ ok: false, message: 'Timed out waiting: its transcript is not ready.' }));
    runner.holdFinishOpen();
    runner.start([{ id: 'a', name: 'A' }]);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    finishCloud('a');
    await vi.waitFor(() => expect(phases(runner).a).toBe('finish-failed'));
    expect(runner.snapshot()[0]!.message).toContain('transcript is not ready');
  });

  it('a timeline that was mid-finish when the app stopped is finished again, not stuck', async () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({ rows: [{ id: 'a', name: 'A', phase: 'finishing' }] }));
    const { runner } = boot(disk);
    const done: string[] = [];
    runner.setFinalizer(async id => { done.push(id); return { ok: true }; });
    runner.holdFinishOpen();
    runner.resume();
    await vi.waitFor(() => expect(phases(runner).a).toBe('done'));
    expect(done).toEqual(['a']);
  });

  it('deleted projects leave the batch: on boot, and when deleted from the dashboard', async () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({ rows: [
      { id: 'gone', name: 'G', phase: 'queued' }, { id: 'kept', name: 'K', phase: 'done' },
    ] }));
    const { runner, started } = boot(disk, id => id !== 'gone');
    runner.resume();
    expect(phases(runner)).toEqual({ kept: 'done' });
    expect(started).toEqual([]);
    runner.forget(['kept']);
    expect(runner.snapshot()).toEqual([]);
    expect(disk.getItem('kinetix:bulk-batch:v1')).toBeNull();
  });

  it('"Clear finished" removes only finished rows', async () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({ rows: [
      { id: 'a', name: 'A', phase: 'done' }, { id: 'b', name: 'B', phase: 'cloud' }, { id: 'c', name: 'C', phase: 'cancelled' },
    ] }));
    const { runner } = boot(disk);
    runner.clearFinished();
    expect(phases(runner)).toEqual({ b: 'cloud' });
  });

  it('a cancelled or failed cloud job is recorded on its row, and the others carry on', async () => {
    const { runner, queue, started, finishCloud } = boot(memory());
    runner.start([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    queue.cancel('a');
    await vi.waitFor(() => expect(phases(runner).a).toBe('cancelled'));
    await vi.waitFor(() => expect(started).toEqual(['a', 'b']));
    finishCloud('b');
    await vi.waitFor(() => expect(phases(runner).b).toBe('cloud-done'));
  });
});
