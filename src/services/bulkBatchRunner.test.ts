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
    enqueue: (rows, opts) => queue.enqueue(rows.map((r): QueueJob => ({
      id: r.id, label: r.name,
      run: async ctx => {
        started.push(r.id);
        ctx.setPhase('Aligning on the cloud…');
        const how = await new Promise<string>((res, rej) => {
          gates.set(r.id, res);
          ctx.signal.addEventListener('abort', () => rej(new Error('aborted')));
        });
        if (how === 'failed') return { status: 'failed', detail: 'row failed' };
        if (how === 'paused') return { status: 'paused', reason: 'inference-failed', detail: 'CUDA OOM on worker-7' };
        return { status: 'done' };
      },
    })), opts),
  });
  return {
    queue, runner, started,
    finishCloud: (id: string) => gates.get(id)?.('done'),
    failCloud: (id: string) => gates.get(id)?.('failed'),
    pauseCloud: (id: string) => gates.get(id)?.('paused'),
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
    expect(stagesToRun('ready', false)).toEqual([]);
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

  it('cloud work runs with NO window open; finishing the timelines also runs in the background, one at a time', async () => {
    const disk = memory();
    const { runner, finishCloud, started } = boot(disk);
    const order: string[] = [];
    runner.setFinalizer(async id => { order.push(id); return { ok: true }; });
    runner.start([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    finishCloud('a');
    await vi.waitFor(() => expect(phases(runner).a).toBe('done'));
    finishCloud('b');
    await vi.waitFor(() => expect(phases(runner)).toEqual({ a: 'done', b: 'done' }));
    expect(order).toEqual(['a', 'b']);
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

  it('a failed row auto-retries once; a second failure parks it and the queue proceeds to the next row', async () => {
    const { runner, started, failCloud, finishCloud } = boot(memory());
    runner.start([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    failCloud('a');
    await vi.waitFor(() => expect(started).toEqual(['a', 'a']));
    failCloud('a');
    await vi.waitFor(() => expect(phases(runner).a).toBe('failed'));
    await vi.waitFor(() => expect(started).toEqual(['a', 'a', 'b']));
    finishCloud('b');
    await vi.waitFor(() => expect(phases(runner).b).toBe('cloud-done'));
  });

  it('F1: a paused row keeps the gateway\'s real message, not only inference-failed', async () => {
    const { runner, started, pauseCloud } = boot(memory());
    runner.start([{ id: 'a', name: 'A' }]);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    pauseCloud('a');
    await vi.waitFor(() => expect(phases(runner).a).toBe('paused'));
    expect(runner.snapshot()[0]!.message).toContain('CUDA OOM on worker-7');
    expect(runner.snapshot()[0]!.message).not.toBe('inference-failed');
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
    await vi.waitFor(() => expect(started).toEqual(['a', 'a']));
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

  it('cancel a running row: Retry resumes from checkpoint and finishes; sunk cost stays in the sum', async () => {
    let sec = 0;
    const localEngine: QueueEngine = { workerSec: () => sec, usdPerSec: 0.001, onDrain: () => {}, cancelReceipt: () => 'r' };
    const queue = new SyncQueue(localEngine);
    const started: string[] = [];
    const gates = new Map<string, (how: string) => void>();
    const runner = new BulkBatchRunner({
      queue,
      exists: () => true,
      storage: memory(),
      enqueue: (rows, opts) => queue.enqueue(rows.map((r): QueueJob => ({
        id: r.id, label: r.name,
        run: async ctx => {
          started.push(r.id);
          ctx.setPhase('Aligning on the cloud…');
          sec += 7;
          const how = await new Promise<string>((res, rej) => {
            gates.set(r.id, res);
            ctx.signal.addEventListener('abort', () => rej(new Error('aborted')));
          });
          if (how === 'cancelled') throw new Error('aborted');
          return { status: 'done' as const };
        },
      })), opts),
    });
    runner.start([{ id: 'a', name: 'A' }]);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    expect(runner.snapshot()[0]!.checkpoint).toBe('transcript-cached');
    queue.cancel('a');
    await vi.waitFor(() => expect(phases(runner).a).toBe('cancelled'));
    const sunk = runner.snapshot()[0]!.workerSec ?? 0;
    runner.retry('a');
    await vi.waitFor(() => expect(started).toEqual(['a', 'a']));
    expect(runner.snapshot()[0]!.checkpoint).toBe('transcript-cached');
    gates.get('a')?.('done');
    await vi.waitFor(() => expect(phases(runner).a).toBe('cloud-done'));
    expect(runner.snapshot()[0]!.workerSec).toBeGreaterThanOrEqual(sunk);
    expect((runner.snapshot()[0]!.billingAttempts?.length ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('cancel then replace content: Retry starts over (fresh run, not the old checkpoint)', async () => {
    const { runner, started, queue } = boot(memory());
    runner.start([{ id: 'a', name: 'A' }]);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    expect(runner.snapshot()[0]!.checkpoint).toBe('transcript-cached');
    queue.cancel('a');
    await vi.waitFor(() => expect(phases(runner).a).toBe('cancelled'));
    runner.noteContent('a', 'old-key');
    runner.noteContent('a', 'new-file-hash');
    expect(runner.snapshot()[0]!.checkpoint).toBeUndefined();
    const enqueued: Array<string | undefined> = [];
    runner['deps'].enqueue = rows => { enqueued.push(rows[0]!.checkpoint); };
    runner.retry('a');
    expect(phases(runner).a).toBe('queued');
    expect(enqueued[0]).toBeUndefined();
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

  it('a deferred awaitingOpen row is finished on resume (background finish does not wait for Open)', async () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({ rows: [{ id: 'a', name: 'A', phase: 'cloud-done', awaitingOpen: true, message: 'Ready — one click to finish' }] }));
    const { runner } = boot(disk);
    const calls: string[] = [];
    runner.setFinalizer(async id => { calls.push(id); return { ok: true }; });
    runner.resume();
    await vi.waitFor(() => expect(phases(runner).a).toBe('done'));
    expect(calls).toEqual(['a']);
    expect(runner.snapshot()[0]!.awaitingOpen).toBeFalsy();
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

  it('rebuildFromCache re-runs a done row through finish (cache hits: no cloud job)', async () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({ rows: [{ id: 'b', name: 'B', phase: 'done', checkpoint: 'ready' }] }));
    const { runner, started } = boot(disk);
    const done: string[] = [];
    runner.setFinalizer(async id => { done.push(id); return { ok: true }; });
    expect(runner.rebuildFromCache('missing')).toBe(false);
    expect(runner.rebuildFromCache('b')).toBe(true);
    expect(runner.snapshot()[0]).toMatchObject({ id: 'b', phase: 'cloud-done', checkpoint: 'aligned' });
    runner.holdFinishOpen();
    await vi.waitFor(() => expect(phases(runner).b).toBe('done'));
    expect(done).toEqual(['b']);
    expect(started).toEqual([]);
  });
});

describe('P7 cumulative row cost', () => {
  it('(a) fail then retry then finish sums both attempts, not the last only', async () => {
    let sec = 0;
    const engine: QueueEngine = { workerSec: () => sec, usdPerSec: 0.001, onDrain: () => {}, cancelReceipt: () => 'r' };
    const disk = memory();
    const queue = new SyncQueue(engine);
    let attempt = 0;
    const runner = new BulkBatchRunner({
      queue,
      exists: () => true,
      storage: disk,
      enqueue: (rows, opts) => queue.enqueue(rows.map((r): QueueJob => ({
        id: r.id, label: r.name,
        run: async () => {
          attempt += 1;
          if (attempt === 1) { sec += 12; return { status: 'failed', detail: 'oom' }; }
          sec += 8;
          return { status: 'done' };
        },
      })), opts),
    });
    runner.start([{ id: 'a', name: 'A' }]);
    await vi.waitFor(() => expect(runner.snapshot()[0]?.phase).toBe('cloud-done'));
    const row = runner.snapshot()[0]!;
    expect(row.workerSec).toBe(20);
    expect(row.billingAttempts?.map(a => a.workerSec)).toEqual([12, 8]);
  });

  it('(b) restart mid-run keeps the accumulated total', async () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({
      rows: [{
        id: 'a', name: 'A', phase: 'cloud', checkpoint: 'staged',
        workerSec: 12, billingAttempts: [{ at: 1, workerSec: 12 }],
      }],
    }));
    const p2 = boot(disk);
    expect(p2.runner.snapshot()[0]?.workerSec).toBe(12);
    expect(p2.runner.snapshot()[0]?.billingAttempts?.map(a => a.workerSec)).toEqual([12]);
  });
});

describe('P8 auto-retry keeps momentum', () => {
  function bootRetry(storage: ReturnType<typeof memory> = memory()) {
    let sec = 0;
    let boots = 0;
    const eng: QueueEngine = { workerSec: () => sec, usdPerSec: 0.001, onDrain: () => {}, cancelReceipt: () => 'r' };
    const queue = new SyncQueue(eng);
    const started: string[] = [];
    const gates = new Map<string, (how: string) => void>();
    const startedAt: number[] = [];
    const runner = new BulkBatchRunner({
      queue,
      exists: () => true,
      storage,
      enqueue: (rows, opts) => queue.enqueue(rows.map((r): QueueJob => ({
        id: r.id, label: r.name,
        run: async ctx => {
          started.push(r.id);
          startedAt.push(Date.now());
          const token = ctx.carry.get();
          if (typeof token !== 'string') {
            boots += 1;
            ctx.carry.set('gpu-1');
          }
          ctx.setPhase('Aligning on the cloud…');
          const how = await new Promise<string>((res, rej) => {
            gates.set(r.id, res);
            ctx.signal.addEventListener('abort', () => rej(new Error('aborted')));
          });
          if (how === 'failed') { sec += 7; return { status: 'failed', detail: 'worker-lost' }; }
          if (how === 'paused') return { status: 'paused', reason: 'cloud-auth', detail: 'Sign in to continue' };
          sec += 4;
          return { status: 'done' };
        },
      })), opts),
    });
    return {
      runner, started, startedAt, boots: () => boots,
      finish: (id: string) => gates.get(id)?.('done'),
      fail: (id: string) => gates.get(id)?.('failed'),
      pause: (id: string) => gates.get(id)?.('paused'),
    };
  }

  it('(a) one auto-retry succeeds: row completes, queue never stalled, cost sums both attempts, one boot', async () => {
    const p = bootRetry();
    p.runner.start([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await vi.waitFor(() => expect(p.started).toEqual(['a']));
    p.fail('a');
    await vi.waitFor(() => expect(p.started).toEqual(['a', 'a']));
    expect(p.startedAt[1]! - p.startedAt[0]!).toBeLessThan(50);
    expect(p.runner.snapshot().find(r => r.id === 'b')?.phase).toBe('queued');
    p.finish('a');
    await vi.waitFor(() => expect(p.runner.snapshot().find(r => r.id === 'a')?.phase).toBe('cloud-done'));
    p.finish('b');
    await vi.waitFor(() => expect(p.runner.snapshot().find(r => r.id === 'b')?.phase).toBe('cloud-done'));
    const a = p.runner.snapshot().find(r => r.id === 'a')!;
    expect(a.workerSec).toBe(11);
    expect(a.billingAttempts?.map(x => x.workerSec)).toEqual([7, 4]);
    expect(p.boots()).toBe(1);
    expect(p.started).toEqual(['a', 'a', 'b']);
  });

  it('(b) two failures park Failed — Retry with the real error and summed cost; next row starts instantly; zero idle billed', async () => {
    const p = bootRetry();
    p.runner.start([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await vi.waitFor(() => expect(p.started).toEqual(['a']));
    p.fail('a');
    await vi.waitFor(() => expect(p.started).toEqual(['a', 'a']));
    const beforeNext = Date.now();
    p.fail('a');
    await vi.waitFor(() => expect(p.started).toEqual(['a', 'a', 'b']));
    expect(Date.now() - beforeNext).toBeLessThan(250);
    const a = p.runner.snapshot().find(r => r.id === 'a')!;
    expect(a.phase).toBe('failed');
    expect(a.message).toBe('worker-lost');
    expect(a.workerSec).toBe(14);
    expect(a.billingAttempts?.map(x => x.workerSec)).toEqual([7, 7]);
    expect(p.runner.snapshot().find(r => r.id === 'b')?.phase).toBe('cloud');
    expect(p.boots()).toBe(1);
  });

  it('(c) a pause is never auto-retried', async () => {
    const p = bootRetry();
    p.runner.start([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await vi.waitFor(() => expect(p.started).toEqual(['a']));
    p.pause('a');
    await vi.waitFor(() => expect(p.runner.snapshot().find(r => r.id === 'a')?.phase).toBe('paused'));
    await vi.waitFor(() => expect(p.started).toEqual(['a', 'b']));
    expect(p.started.filter(id => id === 'a')).toHaveLength(1);
    expect(p.runner.snapshot().find(r => r.id === 'a')?.message).toContain('Sign in to continue');
  });
});

describe('P9 local build resume + P10 cancel', () => {
  it('kill client mid-local-build: relaunch auto-finishes with zero clicks', async () => {
    const disk = memory();
    disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({
      rows: [{ id: 'a', name: 'A', phase: 'finishing', checkpoint: 'aligned' }],
    }));
    const p2 = boot(disk);
    const clicks: string[] = [];
    p2.runner.setFinalizer(async id => { clicks.push(id); return { ok: true }; });
    p2.runner.resume();
    await vi.waitFor(() => expect(phases(p2.runner).a).toBe('done'));
    expect(clicks).toEqual(['a']);
    expect(p2.runner.snapshot()[0]?.awaitingOpen).toBeFalsy();
  });

  it('cancel-all across two groups parks their rows Cancelled and stops those queues', async () => {
    const { runner, queue, started, finishCloud } = boot(memory());
    runner.createGroup(['a', 'b']);
    runner.createGroup(['c', 'd']);
    runner.start([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }]);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    const groups = runner.groups();
    runner.cancelGroup(groups[0]!.id);
    await vi.waitFor(() => expect(phases(runner).a).toBe('cancelled'));
    expect(phases(runner).b).toBe('cancelled');
    await vi.waitFor(() => expect(started).toContain('c'));
    finishCloud('c');
    finishCloud('d');
    await vi.waitFor(() => expect(phases(runner).c).toBe('cloud-done'));
    expect(queue.snapshot().items.filter(i => i.id === 'b' && i.status === 'queued')).toEqual([]);
  });

  it('P11: the last row of a batch drains immediately — onDrain is not a timeout wait', async () => {
    const drainedAt: number[] = [];
    const localEngine: QueueEngine = {
      workerSec: () => 0, usdPerSec: 0,
      onDrain: () => { drainedAt.push(Date.now()); },
      cancelReceipt: () => 'r',
    };
    const queue = new SyncQueue(localEngine);
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    const runner = new BulkBatchRunner({
      queue,
      exists: () => true,
      storage: memory(),
      enqueue: rows => queue.enqueue(rows.map((r): QueueJob => ({
        id: r.id, label: r.name,
        run: async ctx => {
          started.push(r.id);
          ctx.setPhase('Aligning on the cloud…');
          await new Promise<void>((res, rej) => {
            gates.set(r.id, res);
            ctx.signal.addEventListener('abort', () => rej(new Error('aborted')));
          });
          return { status: 'done' as const };
        },
      }))),
    });
    runner.start([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    gates.get('a')?.();
    await vi.waitFor(() => expect(started).toEqual(['a', 'b']));
    const before = Date.now();
    gates.get('b')?.();
    await vi.waitFor(() => expect(drainedAt.length).toBe(1));
    expect(Date.now() - before).toBeLessThan(250);
    expect(phases(runner).b).toBe('cloud-done');
  });
});
