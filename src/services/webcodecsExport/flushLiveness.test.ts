/**
 * WS3 flush-occlusion round — the FINAL flush, made observable.
 *
 * Field failure being pinned (Windows, 2 machines, production build, 647
 * segments / 1080p30 / 47840 frames encoded / 27 encoder sessions):
 *
 *   atMs 428708  encoder-rotate enter @46800
 *   atMs 428789  frame-loop     enter @46800     (rotation flush = 81 ms — fine)
 *   atMs 438344  encoder-flush  enter @47840     (47840 - 46800 = 1040 → FINAL flush)
 *   <nothing at all for 30 s>
 *   error.kind "unknown", failureVia "watchdog"
 *
 * Two things were wrong and both are covered here:
 *
 *  1. ARMING ORDER. `flushWithBound` raced `[encoder.flush(), new Promise(...)]`.
 *     Array literals evaluate left to right, so `flush()` was CALLED before the
 *     timeout was scheduled — a `flush()` that blocks the calling thread
 *     synchronously ran with no bound armed at all. `arms its timeout BEFORE
 *     calling flush()` below is the regression lock.
 *
 *  2. NO EVENTS. Nothing was emitted between flush entry and death, so the
 *     payload could not say which half stopped. The encoder's chunk callback
 *     now pulses the phase tracker for every chunk received during a flush.
 *
 * Everything here uses fake timers and a hand-written encoder stand-in — no
 * real `VideoEncoder`, no worker, no wall-clock cost.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushWithBound, EncoderFlushTimeoutError } from './exportWorker';
import { ExportPhaseTracker } from './exportPhaseTracker';
import { WATCHDOG_MS } from './exportPipelineWebCodecs';
import type { ExportPhaseLogEntry } from './exportWorkerDiagnostics';

afterEach(() => {
  vi.useRealTimers();
});

const BOUND_MS = 20_000;

/**
 * Stand-in for the two `VideoEncoder` members the bound touches, plus a
 * test-only hook to emit chunks the way a draining flush does.
 */
function encoderStub(opts: {
  flush: () => Promise<void>;
  encodeQueueSize?: number;
  onFlushCalled?: () => void;
}) {
  return {
    encodeQueueSize: opts.encodeQueueSize ?? 0,
    flush() {
      opts.onFlushCalled?.();
      return opts.flush();
    },
  };
}

/** The since-entry counters `exportWorker.ts` threads into the bound. */
function observation(chunks: number, bytes: number) {
  return () => ({ chunksSinceFlushEntry: chunks, bytesSinceFlushEntry: bytes });
}

describe('final flush — terminates via flush-timeout, not the watchdog', () => {
  it('a flush that never resolves rejects at the bound, with the full diagnostic payload', async () => {
    vi.useFakeTimers();
    const enc = encoderStub({ flush: () => new Promise<void>(() => {}), encodeQueueSize: 4 });

    const settled = flushWithBound(enc, 47840, 26, BOUND_MS, observation(0, 0)).then(
      () => null,
      (e: unknown) => e,
    );
    // The bound is tighter than the watchdog — that is the whole point.
    expect(BOUND_MS).toBeLessThan(WATCHDOG_MS);
    await vi.advanceTimersByTimeAsync(BOUND_MS);
    const err = await settled;

    expect(err).toBeInstanceOf(EncoderFlushTimeoutError);
    const e = err as EncoderFlushTimeoutError;
    // Every field the next Windows failure has to answer with.
    expect(e.framesEncoded).toBe(47840);
    expect(e.sessionIndex).toBe(26);
    expect(e.encodeQueueSize).toBe(4);
    expect(e.boundMs).toBe(BOUND_MS);
    // Leg (i): the encoder produced NOTHING since flush entry.
    expect(e.chunksSinceFlushEntry).toBe(0);
    expect(e.bytesSinceFlushEntry).toBe(0);
    expect(e.message).toContain('chunksSinceFlushEntry 0');
    expect(e.message).toContain('encoder session 26');
  });

  it('separates leg (ii)/(iii) — a flush that DID emit chunks reports them at expiry', async () => {
    vi.useFakeTimers();
    const enc = encoderStub({ flush: () => new Promise<void>(() => {}), encodeQueueSize: 1 });
    const settled = flushWithBound(enc, 47840, 26, BOUND_MS, observation(7, 91_234)).then(
      () => null,
      (e: unknown) => e as EncoderFlushTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(BOUND_MS);
    const e = await settled;
    expect(e!.chunksSinceFlushEntry).toBe(7);
    expect(e!.bytesSinceFlushEntry).toBe(91_234);
    expect(e!.message).toContain('bytesSinceFlushEntry 91234');
  });

  it('arms its timeout BEFORE calling flush() — a synchronously blocking flush is still bounded', async () => {
    vi.useFakeTimers();
    // Records the pending-timer count AT THE MOMENT flush() is entered. Under
    // the old `Promise.race([encoder.flush(), new Promise(...)])` this was 0:
    // the timeout had not been scheduled yet, so a flush() that never yielded
    // the thread was never timed at all.
    let timersWhenFlushCalled = -1;
    const enc = encoderStub({
      flush: () => new Promise<void>(() => {}),
      onFlushCalled: () => {
        timersWhenFlushCalled = vi.getTimerCount();
      },
    });
    const settled = flushWithBound(enc, 1, 0, BOUND_MS, observation(0, 0)).catch(() => 'rejected');
    expect(timersWhenFlushCalled).toBe(1);
    await vi.advanceTimersByTimeAsync(BOUND_MS);
    expect(await settled).toBe('rejected');
  });
});

describe('final flush — a slow but PROGRESSING flush is not killed', () => {
  it('does not terminate while flush is still running inside the bound, and resolves normally', async () => {
    vi.useFakeTimers();
    let resolveFlush: (() => void) | null = null;
    const enc = encoderStub({ flush: () => new Promise<void>((r) => { resolveFlush = r; }) });

    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
    const p = flushWithBound(enc, 100, 0, BOUND_MS, observation(0, 0)).then(
      () => { outcome = 'resolved'; },
      () => { outcome = 'rejected'; },
    );

    // 19.5s of "slow" — still inside the bound, still pending.
    await vi.advanceTimersByTimeAsync(19_500);
    expect(outcome).toBe('pending');

    resolveFlush!();
    await p;
    expect(outcome).toBe('resolved');
    // The bound's timer is cleared, so it cannot fire into a later phase.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('records a pulse for every chunk received during the flush', () => {
    const posted: ExportPhaseLogEntry[] = [];
    let clock = 0;
    const tracker = new ExportPhaseTracker(
      (m) => {
        if (m.type === 'phase') {
          posted.push({
            seq: m.seq, atMs: clock, phase: m.phase, pieceIndex: m.pieceIndex,
            segmentIndex: m.segmentIndex, assetId: m.assetId,
            framesEncoded: m.framesEncoded, kind: 'pulse',
          });
        }
      },
      0,
      () => clock,
    );
    tracker.enter('encoder-flush');
    // Ten chunks, 300ms apart — past PHASE_THROTTLE_MS (250ms), so each pulses.
    for (let i = 0; i < 10; i++) {
      clock += 300;
      tracker.pulse();
    }
    // 1 enter + 10 pulses. Before this round the flush emitted nothing at all.
    expect(posted.length).toBe(11);
    expect(posted.every((e) => e.phase === 'encoder-flush')).toBe(true);
  });
});

describe('final flush — no phase-log gap can reach WATCHDOG_MS while chunks flow', () => {
  it('a flush emitting a chunk every 250ms leaves a max inter-event gap well under WATCHDOG_MS', () => {
    const times: number[] = [];
    let clock = 0;
    const tracker = new ExportPhaseTracker(
      (m) => { if (m.type === 'phase') times.push(clock); },
      0,
      () => clock,
    );
    tracker.enter('encoder-flush');
    // 240 chunks x 250ms = 60s of flush — twice WATCHDOG_MS.
    for (let i = 0; i < 240; i++) {
      clock += 250;
      tracker.pulse();
    }
    expect(clock).toBeGreaterThanOrEqual(2 * WATCHDOG_MS);

    let maxGap = 0;
    for (let i = 1; i < times.length; i++) maxGap = Math.max(maxGap, times[i]! - times[i - 1]!);
    expect(times.length).toBeGreaterThan(200);
    expect(maxGap).toBeLessThan(WATCHDOG_MS);
    // Concretely: the throttle floor, not merely "under the watchdog".
    expect(maxGap).toBeLessThanOrEqual(500);
  });
});

describe('rotation flush — unchanged: still bounded, still the fast path', () => {
  it('resolves immediately when the rotation flush is fast, leaving no timer behind', async () => {
    vi.useFakeTimers();
    const enc = encoderStub({ flush: () => Promise.resolve(), encodeQueueSize: 0 });
    await expect(flushWithBound(enc, 46800, 25, BOUND_MS, observation(3, 4096))).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a hung ROTATION flush uses the same bound and names its own session index', async () => {
    vi.useFakeTimers();
    const enc = encoderStub({ flush: () => new Promise<void>(() => {}), encodeQueueSize: 2 });
    const settled = flushWithBound(enc, 46800, 25, BOUND_MS, observation(0, 0)).then(
      () => null,
      (e: unknown) => e as EncoderFlushTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(BOUND_MS);
    const e = await settled;
    expect(e).toBeInstanceOf(EncoderFlushTimeoutError);
    expect(e!.sessionIndex).toBe(25);
  });

  it('a real encoder rejection still propagates unchanged — the bound never masks it', async () => {
    vi.useFakeTimers();
    const boom = new Error('encoder said no');
    const enc = encoderStub({ flush: () => Promise.reject(boom) });
    await expect(flushWithBound(enc, 10, 1, BOUND_MS, observation(0, 0))).rejects.toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/**
 * CALL-SITE reach.
 *
 * The tests above exercise `flushWithBound` directly, which proves the BOUND
 * works and proves nothing about whether the final flush is wired to it — and
 * "the final flush is unbounded" is the exact defect this round was opened on.
 * `runExport`'s flush cannot be driven from a unit test (it needs a worker
 * realm, OffscreenCanvas and WebGL2), so the wiring is guarded at the source
 * instead. Source-reading guards have precedent in this repo
 * (`unreachableFromProduction.test.ts`, `webcodecsToggleConsumers.test.ts`).
 *
 * Destructive probe run for this file (CLAUDE.md §4 Testing): replacing the
 * final call site with a bare `await encoder.flush()` turns the first test in
 * this block red; restoring it turns it green. Reverting the arming order to
 * `Promise.race([encoder.flush(), ...])` turns 'arms its timeout BEFORE
 * calling flush()' red. Both were run and both went red as stated.
 */
describe('exportWorker source — both flush call sites go through the shared bound', () => {
  const src = readFileSync(
    fileURLToPath(new URL('./exportWorker.ts', import.meta.url)),
    'utf8',
  );

  it('the FINAL flush is bounded — no bare `await encoder.flush()` survives in the export path', () => {
    // A bare awaited flush anywhere in this file is the unbounded shape.
    expect(src).not.toMatch(/await\s+encoder\.flush\(\)/);
    // ...and the final flush specifically is a flushWithBound call.
    const finalFlush = src.slice(src.indexOf("tracker.enter('encoder-flush')"));
    expect(finalFlush).toMatch(/await flushWithBound\(encoder, framesEmitted, sessionIndex, FLUSH_BOUND_MS, flushObservation\)/);
  });

  it('there is exactly ONE implementation of the bound, shared by both call sites', () => {
    // Two call sites...
    const calls = src.match(/await flushWithBound\(/g) ?? [];
    expect(calls.length).toBe(2);
    // ...one definition, one timer.
    expect((src.match(/export async function flushWithBound\(/g) ?? []).length).toBe(1);
    expect((src.match(/new EncoderFlushTimeoutError\(/g) ?? []).length).toBe(1);
  });

  it('the chunk callback feeds the flush pulse, so a draining flush cannot be silent', () => {
    expect(src).toMatch(/noteFlushChunk\(tracker, chunkBytes\)/);
    expect(src).toMatch(/function noteFlushChunk\(/);
  });
});
