/**
 * WS2 T4.6 — the bounded teardown flush.
 *
 * WHAT THESE TESTS ARE FOR, AND WHY THEY ARE THE CENTRE OF THIS ROUND. The
 * feature being shipped is "persist before teardown"; the HAZARD being shipped
 * alongside it is "teardown now waits on I/O". Every test below is about the
 * hazard, because the hazard is the one that produces an unquittable app. The
 * three cases that must hold are stated as three separate tests, each probing
 * ONE guard, so a green run names which guard is alive rather than asserting a
 * single conflated "it works".
 *
 * NODE ENVIRONMENT, deliberately: this module touches no DOM. `setTimeout` is
 * driven by vitest fake timers so the 2 s budget costs no wall-clock.
 *
 * WHAT THIS FILE CANNOT REACH — stated so a green run is not read as more than
 * it is. It proves the BUDGET primitive. It does not prove that App.tsx's
 * reload path, the `onCloseRequested` path, or Rust's Cmd+Q path actually call
 * it, nor that a real `saveProject` write lands on disk. The first three are
 * wiring, verified manually in the shell (Cmd+Q especially — see the round
 * report); the last is `projectStore`'s own coverage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushWithBudget, TEARDOWN_FLUSH_BUDGET_MS } from './teardownFlush';

describe('flushWithBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves "flushed" when the flush settles inside the budget', async () => {
    const flush = vi.fn(() => Promise.resolve('written'));
    const outcome = await flushWithBudget(flush, 2000);
    expect(outcome).toBe('flushed');
    expect(flush).toHaveBeenCalledTimes(1);
  });

  // GUARD 1, PROBED ALONE — the hang. This is the case that makes an app
  // unquittable if it is not handled, so it is asserted on its own with a flush
  // that is CONSTRUCTED never to settle (not merely slow).
  it('resolves "timed-out" after the budget when the flush never settles', async () => {
    let settled = false;
    const neverSettles = () => new Promise<void>(() => { /* intentionally never resolves */ });

    const promise = flushWithBudget(neverSettles, 2000).then(o => { settled = true; return o; });

    // Nothing may resolve before the budget elapses.
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe('timed-out');
  });

  // GUARD 2, PROBED ALONE — a rejecting flush. Distinct failure shape from the
  // hang: it must resolve IMMEDIATELY, not burn the whole budget first, because
  // a failed save is knowledge we already have.
  it('resolves "failed" immediately when the flush rejects, without waiting out the budget', async () => {
    const rejects = () => Promise.reject(new Error('storage-unavailable'));
    const promise = flushWithBudget(rejects, 2000);

    // Zero timer advance: a rejection must not be gated on the budget at all.
    await expect(promise).resolves.toBe('failed');
  });

  // GUARD 3, PROBED ALONE — a synchronous throw never produces a promise, so the
  // timeout race would otherwise have nothing to race against.
  it('resolves "failed" when the flush throws synchronously', async () => {
    const throws = (): Promise<void> => { throw new Error('bad call'); };
    await expect(flushWithBudget(throws, 2000)).resolves.toBe('failed');
  });

  // A rejection that arrives AFTER we stopped waiting must not surface as an
  // unhandled rejection — during teardown there may be no listener left to see
  // it, and in a strict runtime it can abort the very teardown it interrupted.
  it('swallows a rejection that lands after the budget has already elapsed', async () => {
    let reject!: (e: Error) => void;
    const late = () => new Promise<void>((_res, rej) => { reject = rej; });

    const promise = flushWithBudget(late, 2000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toBe('timed-out');

    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    reject(new Error('too late'));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  // The timeout timer must be cleared on the success path. Left dangling it
  // would keep a Node/webview timer alive past teardown for the full budget.
  it('clears its timeout timer once the flush settles', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    await flushWithBudget(() => Promise.resolve(), 2000);
    expect(clearSpy).toHaveBeenCalled();
  });

  it('defaults to the 2000 ms budget the owner ruled', async () => {
    expect(TEARDOWN_FLUSH_BUDGET_MS).toBe(2000);

    let settled = false;
    const promise = flushWithBudget(() => new Promise<void>(() => {}))
      .then(o => { settled = true; return o; });
    await vi.advanceTimersByTimeAsync(TEARDOWN_FLUSH_BUDGET_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe('timed-out');
  });
});
