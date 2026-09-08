/**
 * WS3 Defect 1b/3 — the flush bound.
 *
 * The field failure is a `VideoEncoder.flush()` that never settled:
 * `lastPhase: "encoder-flush"`, `framesEncoded: 38061`,
 * `msSinceLastPhaseChange: 30158`. The only thing that noticed was the main
 * thread's message watchdog, which can say "silent for 30s" and nothing else —
 * not which operation hung, not how deep the encoder queue was.
 *
 * These tests pin what the bound reports, not how fast it fires. They use fake
 * timers, so they add no wall-clock time to the suite.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushWithBound, EncoderFlushTimeoutError } from './exportWorker';

afterEach(() => {
  vi.useRealTimers();
});

/** Minimal stand-in for the two `VideoEncoder` members the bound touches. */
function fakeEncoder(flush: () => Promise<void>, encodeQueueSize: number) {
  return { flush, encodeQueueSize };
}

describe('flushWithBound', () => {
  it('resolves normally when flush settles inside the bound, and clears its timer', async () => {
    vi.useFakeTimers();
    const enc = fakeEncoder(() => Promise.resolve(), 0);
    await expect(flushWithBound(enc, 1234, 0, 20_000)).resolves.toBeUndefined();
    // No pending timeout is left behind to fire into a later phase.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a flush REJECTION unchanged — the bound never masks a real encoder error', async () => {
    vi.useFakeTimers();
    const boom = new Error('encoder said no');
    const enc = fakeEncoder(() => Promise.reject(boom), 3);
    await expect(flushWithBound(enc, 10, 0, 20_000)).rejects.toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('on expiry throws a typed error that NAMES flush and carries frames + queue depth', async () => {
    vi.useFakeTimers();
    // Never settles — the field shape exactly.
    const enc = fakeEncoder(() => new Promise<void>(() => {}), 4);
    const p = flushWithBound(enc, 38061, 0, 20_000).then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await p;

    expect(err).toBeInstanceOf(EncoderFlushTimeoutError);
    const e = err as EncoderFlushTimeoutError;
    expect(e.name).toBe('EncoderFlushTimeoutError');
    expect(e.framesEncoded).toBe(38061);
    expect(e.encodeQueueSize).toBe(4);
    expect(e.boundMs).toBe(20_000);
    // The message is what reaches the operator through `formatFailureMessage`.
    expect(e.message).toContain('flush()');
    expect(e.message).toContain('38061');
    expect(e.message).toContain('encodeQueueSize 4');
  });

  it('does NOT fire one millisecond early — the bound is the bound', async () => {
    vi.useFakeTimers();
    let settled = false;
    const enc = fakeEncoder(() => new Promise<void>(() => {}), 1);
    const p = flushWithBound(enc, 1, 0, 20_000).catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
  });

  it('names the SESSION index, so a rotation flush is distinguishable from the final one', async () => {
    vi.useFakeTimers();
    const enc = fakeEncoder(() => new Promise<void>(() => {}), 2);
    const p = flushWithBound(enc, 5400, 3, 20_000).then(
      () => null,
      (e: unknown) => e as EncoderFlushTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(20_000);
    const e = await p;
    expect(e).toBeInstanceOf(EncoderFlushTimeoutError);
    expect(e!.sessionIndex).toBe(3);
    expect(e!.message).toContain('encoder session 3');
  });
});
