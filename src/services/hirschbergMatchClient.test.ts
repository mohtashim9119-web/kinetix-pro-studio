/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// WS2 Wave 2 Group 2, item 4 — MID-RUN CANCEL, folded into G2 by logged
// ruling (final-shape-mapping-2026-09-18.md §M3.6's "AbortSignal so C8's
// cancel reaches it"). This test environment has no global `Worker`, so
// `alignQueryToSubjectAsync`'s normal call in this suite (and every other
// test file) takes the documented fallback — synchronous, resolves before
// any abort could race it. That is correct for proving OUTPUT equality
// (`syncMatchAsync.test.ts`, `faChunkPlan.test.ts`) but cannot exercise a
// cancel that lands WHILE the match is genuinely in flight — there is no
// await point inside the synchronous fallback for an abort to interrupt.
//
// This file installs a FAKE `globalThis.Worker` — one that accepts a
// dispatched request and never responds on its own — specifically so
// `alignQueryToSubjectAsync` takes its REAL worker-dispatch branch, and an
// abort fired after dispatch (before any response) must be what resolves the
// call. That proves the actual client-side cancel wiring this session wrote
// (pending-map cleanup, `terminate()`, typed rejection) — the OS/browser-
// runtime guarantee that `Worker.terminate()` actually interrupts whatever
// JS is running inside a real worker is outside what a test in this
// environment can exercise; that half is the operator's manual verification
// pass (see the G2 report's "operator click protocol").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  postMessage(msg: unknown): void {
    this.posted.push(msg);
    // Deliberately never responds — simulates a long-running match still in
    // flight when the abort below fires.
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('hirschbergMatchClient — mid-flight cancel (WS2 G2 item 4)', () => {
  let lastFakeWorker: FakeWorker | undefined;
  let originalWorker: typeof Worker | undefined;

  beforeEach(() => {
    originalWorker = (globalThis as { Worker?: typeof Worker }).Worker;
    (globalThis as unknown as { Worker: unknown }).Worker = class extends FakeWorker {
      constructor() {
        super();
        lastFakeWorker = this;
      }
    };
  });

  afterEach(() => {
    (globalThis as unknown as { Worker: unknown }).Worker = originalWorker;
    lastFakeWorker = undefined;
    vi.resetModules();
  });

  it('an abort fired after dispatch, before any worker response, rejects with MatchCancelledError, terminates the worker, and does so within a small bounded time — no zombie worker, no hang', async () => {
    // Fresh module instance per test (vi.resetModules in afterEach) so each
    // test gets its own `sharedWorker` singleton, not one a prior test's
    // abort already terminated/nulled.
    const { alignQueryToSubjectAsync, MatchCancelledError } = await import('./hirschbergMatchClient');

    const controller = new AbortController();
    const t0 = performance.now();
    const promise = alignQueryToSubjectAsync(['a', 'b', 'c'], ['a', 'b', 'c'], undefined, controller.signal);

    // The fake worker has been dispatched to (postMessage called) but will
    // never respond — this IS "mid-match" from the caller's perspective.
    expect(lastFakeWorker).toBeDefined();
    expect(lastFakeWorker!.posted.length).toBe(1);
    expect(lastFakeWorker!.terminated).toBe(false);

    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(MatchCancelledError);
    const elapsedMs = performance.now() - t0;

    // Bounded time: cancellation is synchronous cleanup (pending.delete +
    // terminate() + reject), not gated on the worker ever responding — this
    // must resolve in a handful of milliseconds, not stall until some
    // timeout.
    expect(elapsedMs).toBeLessThan(500);

    // No zombie: the worker that was actually mid-flight was terminated.
    expect(lastFakeWorker!.terminated).toBe(true);
  });

  it('after a mid-flight cancel, the NEXT call gets a fresh worker (the terminated one is never reused)', async () => {
    const { alignQueryToSubjectAsync } = await import('./hirschbergMatchClient');

    const controller = new AbortController();
    const firstPromise = alignQueryToSubjectAsync(['a'], ['a'], undefined, controller.signal);
    const firstWorker = lastFakeWorker;
    controller.abort();
    await expect(firstPromise).rejects.toThrow();
    expect(firstWorker!.terminated).toBe(true);

    // A second, non-aborted call must dispatch to a NEW fake worker instance,
    // never the terminated one.
    const second = alignQueryToSubjectAsync(['b'], ['b']);
    expect(lastFakeWorker).not.toBe(firstWorker);
    // Resolve the second call manually (its own fake worker instance) so the
    // test doesn't hang: simulate the worker responding.
    lastFakeWorker!.onmessage?.({
      data: { id: (lastFakeWorker!.posted[0] as { id: number }).id, ops: [], matchedSubjectOf: new Int32Array(0), score: 0 },
    } as MessageEvent);
    await expect(second).resolves.toEqual({ ops: [], matchedSubjectOf: new Int32Array(0), score: 0 });
  });
});
