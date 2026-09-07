/**
 * Fake-worker harness for `driveGlRun`.
 *
 * The sibling `exportPipelineWebCodecs.test.ts` mocks `isGlCompositableSegment`
 * to false and never executes this function. These tests inject a Worker
 * lookalike so the watchdog, phase-token handling, and terminal breakdown
 * can be asserted in node/vitest without a real module worker or GL.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, HeadingOverlay, TextOverlay, VideoSegment } from '../../types';
import {
  driveGlRun,
  WATCHDOG_MS,
  FORWARD_PROGRESS_BOUND_MS,
  SILENT_INTERVAL_CAP,
  SILENT_INTERVAL_MIN_MS,
  type ExportWorkerHandle,
  type WebCodecsFfmpeg,
} from './exportPipelineWebCodecs';
import type { ExportWorkerOutboundMessage } from './exportWorker';
import type { ProjectEffectConfig } from '../gl/compositeParams';
import type { ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  inbound: unknown[] = [];

  postMessage(message: unknown): void {
    this.inbound.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: ExportWorkerOutboundMessage): void {
    this.onmessage?.({ data } as MessageEvent<ExportWorkerOutboundMessage>);
  }
}

function makeFfmpeg(overrides: Partial<WebCodecsFfmpeg> = {}): WebCodecsFfmpeg {
  return {
    writeFile: vi.fn(async () => undefined),
    writeFileRaw: vi.fn(async () => undefined),
    exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()),
    deleteFile: vi.fn(async () => undefined),
    appendFileRaw: vi.fn(async () => undefined),
    saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    countAnnexbFrames: vi.fn(async () => 0),
    concatAnnexbPieces: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as WebCodecsFfmpeg;
}

const segment: VideoSegment = {
  id: 's0',
  text: '',
  assetId: 'a0',
  startTime: 0,
  duration: 1,
  transition: TransitionType.NONE,
  animation: AnimationType.NONE,
  order: 0,
};

const asset: Asset = { id: 'a0', name: 'a0.mp4', url: 'blob:a0', type: 'video' };

const config: ProjectEffectConfig = {
  globalTransition: TransitionType.NONE,
  globalTransitionDuration: 0,
};

const textConfig = {
  fontConfigs: [] as { family: string; bytes: ArrayBuffer }[],
  globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  textLayers: [] as TextOverlay[],
  headings: [] as HeadingOverlay[],
};

function startDrive(fake: FakeWorker, ffmpeg: WebCodecsFfmpeg = makeFfmpeg()) {
  return driveGlRun(
    ffmpeg,
    'run_0',
    'piece_0.h264',
    [segment],
    [asset],
    config,
    1920,
    1080,
    30,
    30,
    () => undefined,
    textConfig,
    0,
    0,
    { createWorker: () => fake, now: () => Date.now() },
  );
}

function phase(
  name: string,
  seq: number,
): Extract<ExportWorkerOutboundMessage, { type: 'phase' }> {
  return {
    type: 'phase',
    phase: name,
    pieceIndex: 0,
    segmentIndex: 0,
    assetId: 'a0',
    framesEncoded: 0,
    seq,
  };
}

function diagnostics(
  phaseMs: Record<string, number>,
  overrides: Partial<ExportWorkerDiagnosticsPayload> = {},
): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs,
    instrumentationMs: 0.05,
    demuxSplit: [],
    framesEncoded: 3,
    pieceIndex: 0,
    lastPhase: 'frame-loop',
    phaseLog: [{ seq: 1, atMs: 0, phase: 'frame-loop', pieceIndex: 0, segmentIndex: 0, assetId: 'a0', framesEncoded: 3, kind: 'enter' }],
    failure: null,
    demuxCacheSize: 2,
    workerHeapBytes: 1_000_000,
    decodedSourceFrames: 0,
    encodedChunkCount: 1,
    encodedKeyframeCount: 1,
    encodedChunkBytes: 8,
    encodedChunkCountAtFlushStart: null,
    decodersCreated: 0,
    decodersOpen: 0,
    cursorsCreated: 0,
    openCursors: 0,
    peakOpenCursors: 0,
    openImageBitmaps: 0,
    frameContentDigest: null,
    frameContentDigestFrames: null,
    ...overrides,
  };
}

function doneMsg(
  phaseMs: Record<string, number>,
  frameCount = 3,
): Extract<ExportWorkerOutboundMessage, { type: 'done' }> {
  return {
    type: 'done',
    frameCount,
    diagnostics: diagnostics(phaseMs, { framesEncoded: frameCount }),
  };
}

function chunkMsg(timestamp = 0): Extract<ExportWorkerOutboundMessage, { type: 'chunk' }> {
  return {
    type: 'chunk',
    runId: 'run_0',
    bytes: new ArrayBuffer(8),
    chunkType: 'key',
    timestamp,
  };
}

function expectPopulatedDiagnostics(d: ExportWorkerDiagnosticsPayload | null): void {
  expect(d).not.toBeNull();
  if (!d) return;
  expect(d.phaseMs).toBeDefined();
  expect(d.pieceIndex).toBe(0);
  expect(typeof d.framesEncoded).toBe('number');
  expect(Array.isArray(d.phaseLog)).toBe(true);
  expect(d.lastPhase).not.toBeUndefined();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('driveGlRun fake-worker harness', () => {
  it('WATCHDOG_MS is unchanged at 30_000', () => {
    expect(WATCHDOG_MS).toBe(30_000);
  });

  it('receives phase messages in expected order and returns diagnostics on done', async () => {
    const fake = new FakeWorker();
    const received: string[] = [];
    const original = fake.emit.bind(fake);
    fake.emit = (data) => {
      if (data.type === 'phase') received.push(data.phase);
      original(data);
    };

    const p = startDrive(fake);
    expect(fake.inbound[0]).toMatchObject({ type: 'init', pieceIndex: 0, startIndex: 0 });

    const order = ['gl-context', 'shader-compile', 'font-init', 'encoder-ladder', 'frame-loop'] as const;
    order.forEach((name, i) => fake.emit(phase(name, i + 1)));
    fake.emit(chunkMsg());
    fake.emit(
      doneMsg({
        'gl-context': 4,
        'shader-compile': 12,
        'font-init': 20,
        'encoder-ladder': 30,
        'frame-loop': 100,
      }),
    );

    const result = await p;
    expect(received).toEqual([...order]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectPopulatedDiagnostics(result.diagnostics);
    expect(result.diagnostics.phaseMs['frame-loop']).toBe(100);
    expect(result.frameCount).toBe(3);
    expect(fake.terminated).toBe(true);
  });

  it('fires the watchdog on a worker that goes silent and requests diagnostics', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 60);
    const result = await p;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('30s');
    expect(result.error.liveness?.lastPhase).toBe('init');
    expect(result.error.liveness?.maxSilentMs).toBeGreaterThanOrEqual(WATCHDOG_MS);
    expect(fake.inbound.some((m) => (m as { type?: string }).type === 'request-diagnostics')).toBe(true);
    expectPopulatedDiagnostics(result.diagnostics);
    expect(result.diagnostics?.failure?.via).toBe('watchdog');
    expect(fake.terminated).toBe(true);
  });

  it('worker error path returns populated diagnostics with failure identity (destructive probe)', async () => {
    const fake = new FakeWorker();
    const p = startDrive(fake);
    fake.emit({
      type: 'error',
      diagnostics: diagnostics({}, {
        framesEncoded: 42,
        failure: {
          name: 'EncodingError',
          message: 'Hardware encoder reset',
          via: 'encoder-callback',
          frameIndex: 41,
          timelineSec: 1.367,
        },
      }),
    });
    const result = await p;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('encoder-callback');
    expect(result.error.message).toContain('EncodingError');
    expect(result.error.message).toContain('frame 41');
    expectPopulatedDiagnostics(result.diagnostics);
    expect(result.diagnostics?.failure?.via).toBe('encoder-callback');
  });

  it('cancelled path returns populated diagnostics', async () => {
    const fake = new FakeWorker();
    const p = startDrive(fake);
    fake.emit({
      type: 'cancelled',
      diagnostics: diagnostics({ 'frame-loop': 10 }, {
        failure: { name: 'AbortError', message: 'Export cancelled.', via: 'cancel', frameIndex: 5, timelineSec: 0.167 },
      }),
    });
    const result = await p;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('cancelled');
    expectPopulatedDiagnostics(result.diagnostics);
  });

  it('worker crash path returns populated diagnostics', async () => {
    const fake = new FakeWorker();
    const p = startDrive(fake);
    fake.onerror?.({ message: 'boom', filename: 'worker.ts', lineno: 1 } as ErrorEvent);
    const result = await p;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('worker-crash');
    expectPopulatedDiagnostics(result.diagnostics);
  });

  it('does not fire the watchdog on a normal chunk stream', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake);
    fake.emit(chunkMsg(0));
    await vi.advanceTimersByTimeAsync(20_000);
    fake.emit(chunkMsg(1));
    await vi.advanceTimersByTimeAsync(20_000);
    fake.emit(doneMsg({ 'frame-loop': 40 }, 2));
    const result = await p;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frameCount).toBe(2);
  });

  it('does not treat phase tokens as watchdog resets (resetting set unchanged)', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake);
    fake.emit(phase('gl-context', 1));
    fake.emit(phase('shader-compile', 2));
    fake.emit(phase('frame-loop', 3));
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 60);
    const result = await p;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('30s');
    expect(result.error.liveness?.lastPhase).toBe('frame-loop');
  });

  it('watchdog failure includes terminal silent interval with phase attribution (destructive probe)', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake);
    fake.emit(chunkMsg(0));
    fake.emit(phase('frame-loop', 1));
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 60);
    const result = await p;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.silentIntervals.length).toBeGreaterThanOrEqual(1);
    const terminal = result.silentIntervals[result.silentIntervals.length - 1]!;
    expect(terminal.durationMs).toBeGreaterThanOrEqual(WATCHDOG_MS);
    expect(terminal.phase).toBe('frame-loop');
  });

  // WS3 Part D: the message-based WATCHDOG_MS resets on ANY worker message
  // (including 'chunk' — a real live evidence run stalled for 131.8s, 4.4x
  // WATCHDOG_MS, while trickling messages kept resetting it). This test
  // reproduces that shape directly: a hung `ffmpeg.appendFileRaw` that never
  // resolves, with chunk messages still arriving often enough that WATCHDOG_MS
  // itself never lapses — proving FORWARD_PROGRESS_BOUND_MS is a genuinely
  // independent signal (armed on real append completion only, never on bare
  // message arrival), not just a slower copy of the same watchdog.
  it('fires the forward-progress bound when an append hangs even though messages keep arriving (destructive probe target)', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const hangingAppend = vi.fn(() => new Promise<void>(() => { /* never resolves */ }));
    const ffmpeg = makeFfmpeg({ appendFileRaw: hangingAppend });
    const p = startDrive(fake, ffmpeg);

    // Feed the message-based watchdog every 20s (< WATCHDOG_MS) so it never
    // fires on its own — isolating the forward-progress bound as the signal
    // under test.
    fake.emit(chunkMsg(0));
    await vi.advanceTimersByTimeAsync(20_000);
    fake.emit(chunkMsg(1));
    await vi.advanceTimersByTimeAsync(20_000);
    fake.emit(chunkMsg(2));
    await vi.advanceTimersByTimeAsync(FORWARD_PROGRESS_BOUND_MS - 40_000 + 100);

    const result = await p;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics?.failure?.via).toBe('stall');
    expect(result.error.message).toContain('forward progress');
    expectPopulatedDiagnostics(result.diagnostics);
    expect(fake.terminated).toBe(true);
    expect(hangingAppend).toHaveBeenCalled();
  });

  // WS3 export-liveness-occlusion round (docs/ws3-silent-gaps-diagnosis.md
  // Step 1/4): both bounds above are ALSO evaluated on every worker message
  // via `checkLivenessBounds` (exportPipelineWebCodecs.ts), not solely via
  // their own `setTimeout` deadline — because that `setTimeout` lives on this
  // document's main-thread context, which the diagnosis found WebKit
  // throttles/defers for an occluded window, while the worker's own
  // `setInterval`-sourced 'heartbeat' message (exportWorker.ts) kept arriving
  // in the one live run that reproduced the failure. The two tests below
  // exercise that new path directly.
  it('a fully silent worker (heartbeat-only, no chunk/queue-sample ever) terminates at WATCHDOG_MS with a populated diagnostics payload', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake);

    // Exactly the run-5 shape: the frame loop produces zero chunk/
    // queue-sample/phase output for the whole gap — only the worker's
    // wall-clock heartbeat keeps arriving, on its own ~5s cadence.
    let elapsed = 0;
    while (elapsed < WATCHDOG_MS + 100) {
      await vi.advanceTimersByTimeAsync(5_000);
      elapsed += 5_000;
      fake.emit({ type: 'heartbeat', atMs: elapsed });
    }

    const result = await p;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('30s');
    expect(result.error.liveness?.lastPhase).toBe('init');
    expectPopulatedDiagnostics(result.diagnostics);
    expect(result.diagnostics?.failure?.via).toBe('watchdog');
    expect(fake.terminated).toBe(true);
  });

  it('the forward-progress bound fires from the message-driven check even when its own setTimeout deadline never invokes its callback (throttled-scheduler simulation)', async () => {
    // Simulate a WebKit-occluded document whose long-lived DOMTimer deadlines
    // are scheduled but never serviced: any setTimeout armed for >= WATCHDOG_MS
    // silently never calls back, while short (<1s) setTimeouts — the 50ms
    // grace period finishWatchdog/finishProgressBound themselves use once
    // actually invoked — still work, so the run can still settle and this
    // test can still observe the outcome.
    const realSetTimeout = global.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
        if (typeof ms === 'number' && ms >= WATCHDOG_MS) {
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }
        return realSetTimeout(fn as never, ms, ...args);
      }) as typeof setTimeout);

    try {
      let simulatedNow = 1_000_000;
      const fake = new FakeWorker();
      const hangingAppend = vi.fn(() => new Promise<void>(() => { /* never resolves */ }));
      const ffmpeg = makeFfmpeg({ appendFileRaw: hangingAppend });
      const p = driveGlRun(
        ffmpeg,
        'run_0',
        'piece_0.h264',
        [segment],
        [asset],
        config,
        1920,
        1080,
        30,
        30,
        () => undefined,
        textConfig,
        0,
        0,
        { createWorker: () => fake, now: () => simulatedNow },
      );

      // Starts the hanging append — its own resetProgressBound's setTimeout
      // is now a permanent no-op per the mock above, exactly like a document
      // timer starved by occlusion. `appendQueue.then(...)` schedules a
      // microtask, so flush one before asserting it ran.
      fake.emit(chunkMsg(0));
      await Promise.resolve();
      await Promise.resolve();
      expect(hangingAppend).toHaveBeenCalled();

      // Two more chunks (< WATCHDOG_MS apart) keep resetting ONLY the
      // watchdog's own anchor (`lastOutputAt`, via 'chunk''s synchronous
      // noteWatchdogOutput/resetWatchdog — the append itself stays queued
      // behind the first, hung call and never actually completes) — isolating
      // FORWARD_PROGRESS_BOUND_MS as the signal under test, same shape as
      // the existing real-timer version of this scenario above.
      simulatedNow += 20_000;
      fake.emit(chunkMsg(1));
      simulatedNow += 20_000;
      fake.emit(chunkMsg(2));

      // Jump the clock past FORWARD_PROGRESS_BOUND_MS (measured from the
      // never-reset lastRealProgressAt, still anchored at run start) without
      // ever advancing any fake-timer queue — nothing here depends on a
      // scheduled deadline firing. Only a heartbeat message gives the
      // message-driven check a chance to notice.
      simulatedNow += FORWARD_PROGRESS_BOUND_MS - 40_000 + 100;
      fake.emit({ type: 'heartbeat', atMs: simulatedNow });

      const result = await p;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics?.failure?.via).toBe('stall');
      expect(result.error.message).toContain('forward progress');
      expectPopulatedDiagnostics(result.diagnostics);
      expect(fake.terminated).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// WS3 Defect 7 — the per-frame accumulators inside driveGlRun.
// ---------------------------------------------------------------------------

describe('driveGlRun — bounded silent-interval recording', () => {
  it('records nothing for ordinary per-frame chunk cadence (destructive probe on the old behaviour)', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake);
    // 200 chunks, ~20 ms apart — normal frame cadence. The pre-fix code kept
    // one event per chunk AND emitted one attribution per consecutive pair
    // (minDurationMs was 0), so this would have produced ~199 retained
    // intervals for 200 perfectly healthy frames.
    for (let i = 0; i < 200; i++) {
      fake.emit(chunkMsg(i));
      await vi.advanceTimersByTimeAsync(20);
    }
    fake.emit(doneMsg({ 'frame-loop': 4000 }, 200));
    const result = await p;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the terminal gap, which is always reported.
    expect(result.silentIntervals.length).toBeLessThanOrEqual(1);
  });

  it('still records a real gap, and never exceeds SILENT_INTERVAL_CAP', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake);
    fake.emit(phase('frame-loop', 1));
    // Alternate a real 1s stall with fast frames, many more times than the cap.
    for (let i = 0; i < SILENT_INTERVAL_CAP + 100; i++) {
      fake.emit(chunkMsg(i));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    fake.emit(doneMsg({ 'frame-loop': 1 }, 1));
    const result = await p;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Bounded — the whole point.
    expect(result.silentIntervals.length).toBeLessThanOrEqual(SILENT_INTERVAL_CAP + 1);
    // ...and not empty: real gaps above SILENT_INTERVAL_MIN_MS still land.
    expect(result.silentIntervals.length).toBeGreaterThan(1);
    for (const iv of result.silentIntervals) {
      expect(iv.durationMs).toBeGreaterThanOrEqual(SILENT_INTERVAL_MIN_MS);
    }
  });

  it('eviction keeps the LONGEST gap, not the most recent', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake);
    fake.emit(phase('frame-loop', 1));
    // One outlier stall first, then enough shorter stalls to overflow the cap.
    fake.emit(chunkMsg(0));
    await vi.advanceTimersByTimeAsync(20_000);
    for (let i = 1; i < SILENT_INTERVAL_CAP + 50; i++) {
      fake.emit(chunkMsg(i));
      await vi.advanceTimersByTimeAsync(300);
    }
    fake.emit(doneMsg({ 'frame-loop': 1 }, 1));
    const result = await p;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const longest = Math.max(...result.silentIntervals.map((iv) => iv.durationMs));
    expect(longest).toBeGreaterThanOrEqual(20_000);
  });
});
