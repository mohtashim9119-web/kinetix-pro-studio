/**
 * WS3 Tier 1 item 3b — pure unit tests for `AppendBackpressureGate`.
 *
 * These are deliberately independent of `driveGlRun`/the worker: the gate has
 * no dependency on either, and a bug in the gate's own bookkeeping should be
 * diagnosable without constructing a fake worker or a fake export run.
 * `appendBackpressureAckWiring.test.ts` covers the wiring into `exportPipelineWebCodecs.ts`
 * at the three seams (session rotation, done, salvage-done).
 */
import { describe, it, expect } from 'vitest';
import { AppendBackpressureGate } from './appendBackpressureGate';

/** Resolves once every already-queued microtask has run, without advancing
 *  any timer — the right tool for "has this promise settled yet?" on a gate
 *  that resolves via a plain `Promise` executor, not a timer. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe('AppendBackpressureGate', () => {
  it('resolves immediately while unacked bytes are at or under the threshold', async () => {
    const gate = new AppendBackpressureGate(1_000);
    gate.submit(1_000);
    let resolved = false;
    void gate.waitIfNeeded().then(() => { resolved = true; });
    await flushMicrotasks();
    expect(resolved).toBe(true);
    expect(gate.unacked()).toBe(1_000);
  });

  it('parks the caller once unacked bytes exceed the threshold, and wakes it on ack', async () => {
    const gate = new AppendBackpressureGate(1_000);
    gate.submit(1_500);
    let resolved = false;
    void gate.waitIfNeeded().then(() => { resolved = true; });
    await flushMicrotasks();
    expect(resolved).toBe(false);
    expect(gate.waiterCount()).toBe(1);

    // Ack half — still over threshold (1500 - 500 = 1000, at the threshold,
    // which is allowed) — check a value that leaves it ABOVE first.
    gate.ack(300); // unacked = 1200, still > 1000
    await flushMicrotasks();
    expect(resolved).toBe(false);

    gate.ack(600); // unacked = 900, <= 1000
    await flushMicrotasks();
    expect(resolved).toBe(true);
    expect(gate.waiterCount()).toBe(0);
  });

  it('wakes every parked waiter, not just the first', async () => {
    const gate = new AppendBackpressureGate(100);
    gate.submit(500);
    const resolvedFlags = [false, false, false];
    void gate.waitIfNeeded().then(() => { resolvedFlags[0] = true; });
    void gate.waitIfNeeded().then(() => { resolvedFlags[1] = true; });
    void gate.waitIfNeeded().then(() => { resolvedFlags[2] = true; });
    await flushMicrotasks();
    expect(gate.waiterCount()).toBe(3);

    gate.ack(500); // unacked = 0
    await flushMicrotasks();
    expect(resolvedFlags).toEqual([true, true, true]);
  });

  it('ignores an ack that is not greater than the current acked total (monotonic)', async () => {
    const gate = new AppendBackpressureGate(100);
    gate.submit(1_000);
    gate.ack(900); // unacked = 100, at threshold — resolves
    let resolved = false;
    void gate.waitIfNeeded().then(() => { resolved = true; });
    await flushMicrotasks();
    expect(resolved).toBe(true);

    // A stale/duplicate ack with a LOWER cumulative total must not move the
    // gate backwards and re-park a future waiter incorrectly.
    gate.ack(500);
    expect(gate.unacked()).toBe(100); // unchanged, not 500
  });

  it('never resolves on its own — only a real ack unblocks a parked waiter', async () => {
    const gate = new AppendBackpressureGate(0);
    gate.submit(1);
    let resolved = false;
    void gate.waitIfNeeded().then(() => { resolved = true; });
    // Flush far more microtasks than any real ack chain would need — proves
    // the gate isn't secretly timer-based or self-resolving.
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(resolved).toBe(false);
    gate.ack(1);
    await flushMicrotasks();
    expect(resolved).toBe(true);
  });
});
