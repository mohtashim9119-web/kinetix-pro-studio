/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7.8 — the batch is a persistent background job: it survives closing
// the window, a reload, a quit or a crash, and picks up from its last state.

import { describe, it, expect, vi } from 'vitest';
import { BulkBatchRunner, stagesToRun } from './bulkBatch';
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
  const gates = new Map<string, (how: string) => void>();
  const runner = new BulkBatchRunner({
    queue,
    exists,
    storage,
    enqueue: rows => queue.enqueue(rows.map((r): QueueJob => ({
      id: r.id, label: r.name,
      run: async ctx => {
        started.push(r.id);
        ctx.setPhase('Aligning on the cloud…');
        const how = await new Promise<string>((res, rej) => {
          gates.set(r.id, res);
          ctx.signal.addEventListener('abort', () => rej(new Error('aborted')));
        });
        if (how === 'failed') return { status: 'failed', detail: 'row failed' };
        return { status: 'done' };
      },
    }))),
  });
  return {
    queue, runner, started,
    finishCloud: (id: string) => gates.get(id)?.('done'),
    failCloud: (id: string) => gates.get(id)?.('failed'),
  };
}
const phases = (r: BulkBatchRunner) => Object.fromEntries(r.snapshot().map(x => [x.id, x.phase]));

describe('checkpoint stages', () => {
  it('resumes after the last completed stage and starts over when the content key changes', () => {
    expect(stagesToRun(undefined, false)).toEqual(['transcribe', 'align', 'build']);
    expect(stagesToRun('staged', false)).toEqual(['transcribe', 'align', 'build']);
    expect(stagesToRun('transcript-cached', false)).toEqual(['align', 'build']);
    expect(stagesToRun('aligned', false)).toEqual(['build']);
    expect(stagesToRun('built', false)).toEqual([]);
    expect(stagesToRun('aligned', true)).toEqual(['transcribe', 'align', 'build']);
  });
});

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

  it('a failed row is recorded and the queue proceeds to the next row', async () => {
    const { runner, started, failCloud, finishCloud } = boot(memory());
    runner.start([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    failCloud('a');
    await vi.waitFor(() => expect(phases(runner).a).toBe('failed'));
    await vi.waitFor(() => expect(started).toEqual(['a', 'b']));
    finishCloud('b');
    await vi.waitFor(() => expect(phases(runner).b).toBe('cloud-done'));
  });

  it('a crash between every stage resumes from that checkpoint', () => {
    const disk = memory();
    const stages = ['staged', 'transcript-cached', 'aligned'] as const;
    for (const checkpoint of stages) {
      disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({
        rows: [{ id: 'a', name: 'A', phase: 'cloud', checkpoint, contentKey: 'h|s|e' }],
      }));
      const queue = new SyncQueue(engine);
      const seen: string[] = [];
      const runner = new BulkBatchRunner({
        queue, exists: () => true, storage: disk,
        enqueue: rows => { seen.push(rows[0]!.checkpoint ?? 'none'); },
      });
      runner.resume();
      expect(seen).toEqual([checkpoint]);
    }
  });

  it('retry of a failed row re-enters from its checkpoint, and a content change starts over', async () => {
    const { runner, started, failCloud } = boot(memory());
    runner.start([{ id: 'a', name: 'A' }]);
    await vi.waitFor(() => expect(runner.snapshot()[0]!.checkpoint).toBe('transcript-cached'));
    failCloud('a');
    await vi.waitFor(() => expect(phases(runner).a).toBe('failed'));
    const enqueued: string[] = [];
    runner['deps'].enqueue = rows => { enqueued.push(`${rows[0]!.checkpoint}`); };
    runner.retry('a', 'h|s|e');
    expect(phases(runner).a).toBe('queued');
    expect(enqueued[0]).toBe('transcript-cached');
    runner.noteContent('a', 'h|s|e');
    runner.noteContent('a', 'changed');
    expect(runner.snapshot()[0]!.checkpoint).toBeUndefined();
    expect(started[0]).toBe('a');
  });
});

describe('v1.2.2 — interim finishing: sequential, deferrable, repairable', () => {
  it('rows finish strictly one at a time — a second finish never starts while one is running', async () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({ rows: [
      { id: 'a', name: 'A', phase: 'cloud-done' }, { id: 'b', name: 'B', phase: 'cloud-done' }, { id: 'c', name: 'C', phase: 'cloud-done' },
    ] }));
    const { runner } = boot(disk);
    let live = 0;
    let maxLive = 0;
    const order: string[] = [];
    runner.setFinalizer(async id => {
      live += 1; maxLive = Math.max(maxLive, live); order.push(id);
      await new Promise(r => setTimeout(r, 5));
      live -= 1;
      return { ok: true };
    });
    runner.holdFinishOpen();
    runner.holdFinishOpen(); // a second door open must not double-queue
    runner.resume();
    await vi.waitFor(() => expect(phases(runner)).toEqual({ a: 'done', b: 'done', c: 'done' }));
    expect(maxLive).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('a deferred row waits for its own Open (never re-finished on its own), and Open finishes it as the operator’s', async () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({ rows: [{ id: 'a', name: 'A', phase: 'cloud-done' }] }));
    const { runner } = boot(disk);
    const calls: [string, boolean][] = [];
    runner.setFinalizer(async (id, req) => {
      calls.push([id, req.userInitiated]);
      return req.userInitiated ? { ok: true } : { ok: false, deferred: true };
    });
    runner.holdFinishOpen();
    runner.resume();
    await vi.waitFor(() => expect(runner.snapshot()[0]!.awaitingOpen).toBe(true));
    expect(runner.snapshot()[0]!.phase).toBe('cloud-done');
    expect(runner.snapshot()[0]!.message).toBe('Ready — one click to finish');
    // Another pump (a queue change, a second door) does not retry it.
    runner.holdFinishOpen();
    await new Promise(r => setTimeout(r, 20));
    expect(calls).toEqual([['a', false]]);
    // It survives a reload as deferred.
    expect(JSON.parse(disk.getItem('kinetix:bulk-batch:v1')!).rows[0].awaitingOpen).toBe(true);
    expect(runner.finishNow('a')).toBe(true);
    await vi.waitFor(() => expect(phases(runner).a).toBe('done'));
    expect(calls).toEqual([['a', false], ['a', true]]);
  });

  it('a record the guard reset is re-queued to rebuild from its own files (cache hits: straight to finishing)', async () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({ rows: [{ id: 'b', name: 'B', phase: 'done', checkpoint: 'built' }] }));
    const { runner, started } = boot(disk);
    const done: string[] = [];
    runner.setFinalizer(async id => { done.push(id); return { ok: true }; });
    runner.requeueForRebuild('b', 'B', 'Repaired — rebuilding from its own files');
    runner.requeueForRebuild('gone-from-batch', 'C', 'Repaired — rebuilding from its own files');
    expect(runner.snapshot().map(r => [r.id, r.phase, r.checkpoint])).toEqual([['b', 'cloud-done', 'aligned'], ['gone-from-batch', 'cloud-done', 'aligned']]);
    runner.holdFinishOpen();
    await vi.waitFor(() => expect(phases(runner)).toEqual({ b: 'done', 'gone-from-batch': 'done' }));
    expect(done).toEqual(['b', 'gone-from-batch']);
    expect(started).toEqual([]); // no cloud work re-run
  });
});
