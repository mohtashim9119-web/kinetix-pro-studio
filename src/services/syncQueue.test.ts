/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7 — the bulk queue core, engine-agnostic (fake engine, fake jobs).

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SyncQueue, formatUsd, type QueueEngine, type QueueJob, type QueueJobOutcome } from './syncQueue';
import { CLOUD_USD_PER_WORKER_SEC } from './cloudQueueJob';

function engine(overrides: Partial<QueueEngine> = {}): QueueEngine & { worked: number; drained: unknown[] } {
  const e: QueueEngine & { worked: number; drained: unknown[] } = {
    worked: 0,
    drained: [] as unknown[],
    workerSec(): number { return e.worked; },
    usdPerSec: 0.001,
    cancelReceipt: (_i: unknown, started: boolean) => (started ? 'running-receipt' : 'queued-receipt'),
    onDrain(carry: unknown) { e.drained.push(carry); },
    ...overrides,
  };
  return e;
}

const settle = async (q: SyncQueue): Promise<void> => {
  await vi.waitFor(() => expect(q.snapshot().running).toBe(false));
};

function job(id: string, run: QueueJob['run'], extra: Partial<QueueJob> = {}): QueueJob {
  return { id, label: `Project ${id}`, run, ...extra };
}

describe('SyncQueue', () => {
  it('runs jobs strictly in order, one at a time, with honest positions and states', async () => {
    const e = engine();
    const q = new SyncQueue(e);
    const log: string[] = [];
    let concurrent = 0;
    const mk = (id: string) => job(id, async ctx => {
      concurrent++;
      expect(concurrent).toBe(1);
      log.push(`start ${id} @${ctx.position}/${ctx.total} next=${ctx.hasNext}`);
      await new Promise(r => setTimeout(r, 5));
      e.worked += 10;
      concurrent--;
      return { status: 'done' };
    });
    q.enqueue([mk('a'), mk('b'), mk('c')]);
    expect(q.snapshot().items.map(i => [i.id, i.position])).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    await settle(q);
    expect(log).toEqual(['start a @1/3 next=true', 'start b @2/3 next=true', 'start c @3/3 next=false']);
    expect(q.snapshot().items.every(i => i.status === 'done' && i.workerSec === 10)).toBe(true);
    expect(q.snapshot().batch?.workerSec).toBe(30);
    expect(q.snapshot().batch?.estimatedUsd).toBeCloseTo(0.03, 6);
    expect(q.batchLine()).toBe('3 projects: 3 built · about $0.03 of cloud GPU (30 s worked)');
  });

  it('F6: one item is "1 project", and a failed row\'s GPU seconds still count', async () => {
    const e = engine();
    const q = new SyncQueue(e);
    q.enqueue([job('a', async () => {
      e.worked += 20;
      return { status: 'failed', detail: 'boom' };
    })]);
    await settle(q);
    expect(q.batchLine()).toBe('1 project: 1 failed · about $0.02 of cloud GPU (20 s worked)');
  });

  it('a paused or failed project stops only itself — the queue continues', async () => {
    const q = new SyncQueue(engine());
    const outcomes: Record<string, QueueJobOutcome> = {
      a: { status: 'done' },
      b: { status: 'paused', reason: 'offline', detail: 'x' },
      c: { status: 'failed', detail: 'boom' },
      d: { status: 'done' },
    };
    q.enqueue(Object.keys(outcomes).map(id => job(id, async () => outcomes[id]!)));
    await settle(q);
    expect(q.snapshot().items.map(i => i.status)).toEqual(['done', 'paused', 'failed', 'done']);
    expect(q.snapshot().items[1]!.reason).toBe('offline');
  });

  it('a job that throws is a failed item, not a dead queue', async () => {
    const q = new SyncQueue(engine());
    q.enqueue([job('a', async () => { throw new Error('kaput'); }), job('b', async () => ({ status: 'done' }))]);
    await settle(q);
    expect(q.snapshot().items.map(i => i.status)).toEqual(['failed', 'done']);
    expect(q.snapshot().items[0]!.detail).toBe('kaput');
  });

  it('cancel a QUEUED item: never runs, receipt says nothing started, the rest continue', async () => {
    const q = new SyncQueue(engine());
    const ran: string[] = [];
    let releaseA!: () => void;
    const gate = new Promise<void>(r => { releaseA = r; });
    q.enqueue([
      job('a', async () => { ran.push('a'); await gate; return { status: 'done' }; }),
      job('b', async () => { ran.push('b'); return { status: 'done' }; }),
      job('c', async () => { ran.push('c'); return { status: 'done' }; }),
    ]);
    await vi.waitFor(() => expect(q.snapshot().items[0]!.status).toBe('running'));
    q.cancel('b');
    expect(q.snapshot().items[1]).toMatchObject({ status: 'cancelled', receipt: 'queued-receipt' });
    releaseA();
    await settle(q);
    expect(ran).toEqual(['a', 'c']);
    expect(q.batchLine()).toContain('2 built, 1 cancelled');
  });

  it('cancel the RUNNING item mid-queue: its signal aborts, the receipt is the engine\'s, the chain is dropped, the queue continues', async () => {
    const e = engine({ settleCancel: vi.fn(async () => undefined) });
    const q = new SyncQueue(e);
    let sawAbort = false;
    q.enqueue([
      job('a', async ctx => {
        ctx.carry.set('held-container');
        await new Promise<void>((_, reject) => ctx.signal.addEventListener('abort', () => { sawAbort = true; reject(new DOMException('Aborted', 'AbortError')); }));
        return { status: 'done' };
      }),
      job('b', async ctx => { expect(ctx.carry.get()).toBeUndefined(); return { status: 'done' }; }),
    ]);
    await vi.waitFor(() => expect(q.snapshot().items[0]!.status).toBe('running'));
    q.cancel('a');
    await settle(q);
    expect(sawAbort).toBe(true);
    expect(q.snapshot().items.map(i => i.status)).toEqual(['cancelled', 'done']);
    expect(q.snapshot().items[0]!.receipt).toBe('running-receipt');
    expect(e.settleCancel).toHaveBeenCalled();
    // The container carried by the cancelled job was let go, not leaked.
    expect(e.drained[0]).toBe('held-container');
  });

  it('cancelAll stops everything, queued and running', async () => {
    const q = new SyncQueue(engine());
    q.enqueue([
      job('a', async ctx => { await new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('x')))); return { status: 'done' }; }),
      job('b', async () => ({ status: 'done' })),
    ]);
    await vi.waitFor(() => expect(q.snapshot().items[0]!.status).toBe('running'));
    q.cancelAll();
    await settle(q);
    expect(q.snapshot().items.map(i => i.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('hasNext goes false when the last queued job behind is cancelled (no container held for a job that will not come)', async () => {
    const q = new SyncQueue(engine());
    const seen: boolean[] = [];
    let go!: () => void;
    const gate = new Promise<void>(r => { go = r; });
    q.enqueue([
      job('a', async ctx => { seen.push(ctx.hasNext); await gate; seen.push(ctx.hasNext); return { status: 'done' }; }),
      job('b', async () => ({ status: 'done' })),
    ]);
    await vi.waitFor(() => expect(q.snapshot().items[0]!.status).toBe('running'));
    q.cancel('b');
    go();
    await settle(q);
    expect(seen).toEqual([true, false]);
  });

  it('the carry slot passes job to job and is released when the batch drains', async () => {
    const e = engine();
    const q = new SyncQueue(e);
    q.enqueue([
      job('a', async ctx => { ctx.carry.set('c1'); return { status: 'done' }; }),
      job('b', async ctx => { expect(ctx.carry.get()).toBe('c1'); ctx.carry.set('c2'); return { status: 'done' }; }),
    ]);
    await settle(q);
    expect(e.drained).toEqual(['c2']);
  });

  it('the next job is prepared while the current one runs (no idle GPU gap for loading)', async () => {
    const q = new SyncQueue(engine());
    const order: string[] = [];
    let go!: () => void;
    const gate = new Promise<void>(r => { go = r; });
    q.enqueue([
      job('a', async () => { order.push('run a'); await gate; order.push('end a'); return { status: 'done' }; }),
      job('b', async () => { order.push('run b'); return { status: 'done' }; }, { prepare: async () => { order.push('prepare b'); } }),
    ]);
    await vi.waitFor(() => expect(order).toContain('prepare b'));
    expect(order).not.toContain('end a'); // b was prepared while a was still running
    go();
    await settle(q);
    expect(order).toEqual(['prepare b', 'run a', 'end a', 'run b']);
  });

  it('the same project is not queued twice while it is live; a new batch replaces a finished one', async () => {
    const q = new SyncQueue(engine());
    let go!: () => void;
    const gate = new Promise<void>(r => { go = r; });
    expect(q.enqueue([job('a', async () => { await gate; return { status: 'done' }; })])).toBe(1);
    expect(q.enqueue([job('a', async () => ({ status: 'done' }))])).toBe(0);
    go();
    await settle(q);
    expect(q.enqueue([job('z', async () => ({ status: 'done' }))])).toBe(1);
    await settle(q);
    expect(q.snapshot().items.map(i => i.id)).toEqual(['z']);
  });

  it('formatUsd and the cloud price pin', () => {
    expect(formatUsd(0.0412)).toBe('$0.04');
    expect(formatUsd(0.004)).toBe('$0.0040');
    // Mirrors cloud/sync_core.py USD_PER_WORKER_SEC.
    const py = readFileSync(new URL('../../cloud/sync_core.py', import.meta.url), 'utf8');
    expect(py).toContain('USD_PER_WORKER_SEC = (0.59 + 0.0473 * WORKER_CPU_CORES + 0.008 * WORKER_MEMORY_GIB) / 3600.0');
    expect(py).toMatch(/WORKER_CPU_CORES = 2\b/);
    expect(py).toMatch(/WORKER_MEMORY_GIB = 8\b/);
    expect(CLOUD_USD_PER_WORKER_SEC).toBeCloseTo((0.59 + 0.0946 + 0.064) / 3600, 12);
  });
});
