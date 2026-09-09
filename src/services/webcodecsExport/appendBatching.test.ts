/**
 * WS3 append-batching round — the append path's four properties.
 *
 * The 354-segment WebView2 field run died at the 30s watchdog with 64
 * consecutive `encoder-flush-append` pulses 12.4 ms apart, unbroken to the
 * moment of death: the writer was landing a chunk every 12.4 ms and was killed
 * anyway, because a completed append reset FORWARD_PROGRESS_BOUND_MS but never
 * WATCHDOG_MS, and no chunk message can arrive after the worker posts 'done'.
 *
 * These tests pin, in order:
 *   1. a >30s drain with zero chunk arrivals now SUCCEEDS (the regression);
 *   2. a drain that makes no progress still terminates, naming the queue depth;
 *   3. batching does not change one byte of the output or its order;
 *   4. the append-queue ceiling fires with a typed error.
 *
 * Note on (3): the unbatched path no longer exists to diff against, so its
 * behaviour is reconstructed rather than invoked — one append per chunk, in
 * emission order, is exactly `concat(sources)`. That is the reference the
 * recording writer is checked against.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, HeadingOverlay, TextOverlay, VideoSegment } from '../../types';
import {
  driveGlRun,
  WATCHDOG_MS,
  APPEND_BATCH_CHUNKS,
  APPEND_BATCH_BYTES,
  APPEND_BATCH_MAX_AGE_MS,
  APPEND_QUEUE_CEILING_BYTES,
  type DriveGlRunDeps,
  type ExportWorkerHandle,
  type WebCodecsFfmpeg,
} from './exportPipelineWebCodecs';
import type { ExportWorkerOutboundMessage } from './exportWorker';
import type { ProjectEffectConfig } from '../gl/compositeParams';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(): void { /* inbound ignored */ }
  terminate(): void { this.terminated = true; }
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
    sessionFileSize: vi.fn(async () => 0),
    countAnnexbFrames: vi.fn(async () => ({ pictures: 0, vclNals: 0 })),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb: vi.fn(async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
    ...overrides,
  } as unknown as WebCodecsFfmpeg;
}

const segment: VideoSegment = {
  id: 's0', text: '', assetId: 'a0', startTime: 0, duration: 1,
  transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0,
};
const asset: Asset = { id: 'a0', name: 'a0.mp4', url: 'blob:a0', type: 'video' };
const config: ProjectEffectConfig = { globalTransition: TransitionType.NONE, globalTransitionDuration: 0 };
const textConfig = {
  fontConfigs: [] as { family: string; bytes: ArrayBuffer }[],
  globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  textLayers: [] as TextOverlay[],
  headings: [] as HeadingOverlay[],
};

function startDrive(fake: FakeWorker, ffmpeg: WebCodecsFfmpeg, extraDeps: Partial<DriveGlRunDeps> = {}) {
  return driveGlRun(
    ffmpeg, 'run_0', 'piece_0.h264', [segment], [asset], config,
    1920, 1080, 30, 30, () => undefined, textConfig, 0, 0,
    { createWorker: () => fake, now: () => Date.now(), ...extraDeps },
  );
}

function diagnostics(overrides: Partial<ExportWorkerDiagnosticsPayload> = {}): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: 3, pieceIndex: 0,
    lastPhase: 'encoder-flush', phaseLog: [], failure: null, demuxCacheSize: null,
    workerHeapBytes: null, decodedSourceFrames: 0, encodedChunkCount: 0,
    encodedKeyframeCount: 0, encodedChunkBytes: 0, encodedChunkCountAtFlushStart: null,
    ...NO_FLUSH_OBSERVATION,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
    ...overrides,
  };
}

const doneMsg = (frameCount: number): Extract<ExportWorkerOutboundMessage, { type: 'done' }> => ({
  type: 'done', frameCount, diagnostics: diagnostics({ framesEncoded: frameCount }),
});

/** A chunk whose bytes are unique to its index, so a reordering or a dropped
 *  chunk is visible in the concatenation rather than hidden by zero-fill. */
function chunkOf(index: number, size = 8): { msg: Extract<ExportWorkerOutboundMessage, { type: 'chunk' }>; bytes: Uint8Array } {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (index * 31 + i * 7) & 0xff;
  return {
    msg: { type: 'chunk', runId: 'run_0', bytes: bytes.buffer.slice(0) as ArrayBuffer, chunkType: index === 0 ? 'key' : 'delta', timestamp: index },
    bytes,
  };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

afterEach(() => { vi.useRealTimers(); });

describe('append batching — output is byte-identical to one-call-per-chunk', () => {
  it('writes exactly concat(sources) and reduces IPC calls by ~APPEND_BATCH_CHUNKS', async () => {
    const received: Uint8Array[] = [];
    const ffmpeg = makeFfmpeg({
      appendFileRaw: vi.fn(async (_p: string, data: Uint8Array) => { received.push(data.slice()); }),
    });
    const fake = new FakeWorker();
    const p = startDrive(fake, ffmpeg);

    const N = 250;
    const sources: Uint8Array[] = [];
    for (let i = 0; i < N; i++) {
      const c = chunkOf(i);
      sources.push(c.bytes);
      fake.emit(c.msg);
    }
    fake.emit(doneMsg(N));
    const result = await p;

    expect(result.ok).toBe(true);
    // THE BYTE-EQUALITY PROOF. `concat(sources)` is precisely what the
    // one-append-per-chunk path produced: same chunks, same order, no framing.
    expect(concat(received)).toEqual(concat(sources));
    // ...and the IPC reduction that is the entire point.
    expect(received.length).toBe(Math.ceil(N / APPEND_BATCH_CHUNKS)); // 3, not 250
    if (!result.ok) return;
    expect(result.appendCallCount).toBe(N);
    expect(result.appendBytes).toBe(N * 8);
  });

  it('flushes the partial buffer at a session rotation so sessionByteOffsets still names the exact seam', async () => {
    const ffmpeg = makeFfmpeg();
    const fake = new FakeWorker();
    const p = startDrive(fake, ffmpeg);

    // 7 chunks — well under APPEND_BATCH_CHUNKS, so without the rotation flush
    // they would all still be sitting in the buffer when the marker is taken.
    for (let i = 0; i < 7; i++) fake.emit(chunkOf(i).msg);
    fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: 1, sessions: 2, frameIndex: 7 });
    for (let i = 7; i < 10; i++) fake.emit(chunkOf(i).msg);
    fake.emit(doneMsg(10));

    const result = await p;
    expect(result.ok).toBe(true);
    expect(result.sessionByteOffsets).toEqual([0, 7 * 8]);
  });

  it('a batch is bounded by bytes as well as by count', async () => {
    const received: Uint8Array[] = [];
    const ffmpeg = makeFfmpeg({
      appendFileRaw: vi.fn(async (_p: string, data: Uint8Array) => { received.push(data.slice()); }),
    });
    const fake = new FakeWorker();
    const p = startDrive(fake, ffmpeg);

    // Three chunks of just over half the byte cap: the count trigger (100) is
    // nowhere near, so only the byte trigger can split these.
    const size = Math.ceil(APPEND_BATCH_BYTES / 2) + 1;
    for (let i = 0; i < 3; i++) fake.emit(chunkOf(i, size).msg);
    fake.emit(doneMsg(3));

    const result = await p;
    expect(result.ok).toBe(true);
    expect(received.length).toBe(2); // [0,1] hit the byte cap; [2] flushed at done
    expect(received[0]!.byteLength).toBe(size * 2);
    expect(received[1]!.byteLength).toBe(size);
  });
});

describe('append batching — the age trigger is a liveness bound, not a throughput knob', () => {
  it('flushes a partial buffer within APPEND_BATCH_MAX_AGE_MS even when no further chunk ever arrives', async () => {
    vi.useFakeTimers();
    const received: Uint8Array[] = [];
    const ffmpeg = makeFfmpeg({
      appendFileRaw: vi.fn(async (_p: string, data: Uint8Array) => { received.push(data.slice()); }),
    });
    const fake = new FakeWorker();
    const p = startDrive(fake, ffmpeg);

    // Three chunks — nowhere near either size trigger — and then silence.
    for (let i = 0; i < 3; i++) fake.emit(chunkOf(i).msg);
    expect(received.length).toBe(0);
    await vi.advanceTimersByTimeAsync(APPEND_BATCH_MAX_AGE_MS + 50);
    expect(received.length).toBe(1);
    expect(received[0]!.byteLength).toBe(24);

    fake.emit(doneMsg(3));
    expect((await p).ok).toBe(true);
  });

  it('a slow encoder does not trip the forward-progress bound while its output sits in the buffer', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const p = startDrive(fake, makeFfmpeg());

    // 50 chunks at 2s apart: 100s of wall clock, far past
    // FORWARD_PROGRESS_BOUND_MS, and never enough chunks to hit the count
    // trigger. Without the age trigger no append would complete in that whole
    // window and the stall guard would fire on a healthy run.
    for (let i = 0; i < 50; i++) {
      fake.emit(chunkOf(i).msg);
      await vi.advanceTimersByTimeAsync(2_000);
    }
    fake.emit(doneMsg(50));
    const result = await p;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appendCallCount).toBe(50);
  });
});

describe('append liveness — a completed append counts as life', () => {
  it('a 40s terminal drain with zero chunk arrivals COMPLETES instead of being killed at WATCHDOG_MS', async () => {
    vi.useFakeTimers();
    // Each IPC call takes 5s. Eight batches = 40s of drain, all of it after the
    // last chunk message — the exact window the old watchdog killed at 30s.
    const ffmpeg = makeFfmpeg({
      appendFileRaw: vi.fn(() => new Promise<void>((res) => { setTimeout(res, 5_000); })),
    });
    const fake = new FakeWorker();
    const p = startDrive(fake, ffmpeg);

    const N = APPEND_BATCH_CHUNKS * 8;
    for (let i = 0; i < N; i++) fake.emit(chunkOf(i).msg);
    fake.emit(doneMsg(N));

    await vi.advanceTimersByTimeAsync(45_000);
    const result = await p;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appendCallCount).toBe(N);
    // The drain really did outlast the watchdog — otherwise this test proves nothing.
    expect(result.appendDrainMs).toBeGreaterThan(WATCHDOG_MS);
  });

  it('a drain that makes NO progress still terminates, with a typed error naming the queue depth', async () => {
    vi.useFakeTimers();
    const ffmpeg = makeFfmpeg({ appendFileRaw: vi.fn(() => new Promise<void>(() => { /* never */ })) });
    const fake = new FakeWorker();
    const p = startDrive(fake, ffmpeg);

    const N = 250;
    for (let i = 0; i < N; i++) fake.emit(chunkOf(i).msg);
    fake.emit(doneMsg(N));

    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 1_000);
    const result = await p;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics?.failure?.via).toBe('append-drain-stall');
    // Names the depth in both currencies, and says the worker had finished.
    expect(result.error.message).toContain(`${N} chunk(s)`);
    expect(result.error.message).toContain(`${N * 8} byte(s) pending`);
    expect(result.error.message).toContain('worker had already reported done');
    expect(fake.terminated).toBe(true);
  });

  it('the payload carries the main-thread append ledger even when the worker never replies', async () => {
    vi.useFakeTimers();
    const ffmpeg = makeFfmpeg({ appendFileRaw: vi.fn(() => new Promise<void>(() => { /* never */ })) });
    const fake = new FakeWorker();
    const p = startDrive(fake, ffmpeg);

    for (let i = 0; i < 250; i++) fake.emit(chunkOf(i).msg);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 1_000);
    const result = await p;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const ledger = result.error.liveness?.appendLedger;
    expect(ledger).toBeTruthy();
    if (!ledger) return;
    // Every one of these is main-thread state: none of it needed a worker reply,
    // which is the whole reason this block exists.
    expect(ledger.queueDepthChunks).toBe(250);
    expect(ledger.queueDepthBytes).toBe(250 * 8);
    expect(ledger.chunksAppended).toBe(0);
    expect(ledger.appendInFlight).toBe(true);
    expect(ledger.doneReceived).toBe(false);
    expect(ledger.msSinceDone).toBeNull();
    expect(ledger.msSinceLastAppendCompleted).toBeGreaterThanOrEqual(WATCHDOG_MS);
    // ...while every worker-sourced field is absent, exactly as the field
    // payload showed — the route, not the worker, is why.
    expect(result.diagnostics?.selectedHardwareRung).toBeNull();
    expect(result.diagnostics?.flushChunksSinceEntry).toBeNull();
  });
});

describe('append queue ceiling', () => {
  it('APPEND_QUEUE_CEILING_BYTES is 256 MB', () => {
    expect(APPEND_QUEUE_CEILING_BYTES).toBe(256 * 1024 * 1024);
  });

  it('fires a typed append-queue-overflow naming the depth once the backlog crosses the ceiling', async () => {
    vi.useFakeTimers();
    const ffmpeg = makeFfmpeg({ appendFileRaw: vi.fn(() => new Promise<void>(() => { /* never */ })) });
    const fake = new FakeWorker();
    // Injected ceiling — the real one is 256 MB and allocating that much in a
    // unit test would measure the allocator, not the bound.
    const p = startDrive(fake, ffmpeg, { appendQueueCeilingBytes: 1_000 });

    for (let i = 0; i < 200; i++) fake.emit(chunkOf(i).msg); // 200 * 8 = 1600 B
    await vi.advanceTimersByTimeAsync(100);
    const result = await p;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics?.failure?.via).toBe('append-queue-overflow');
    expect(result.error.message).toContain('outran the writer');
    expect(result.error.message).toContain('1000-byte append-queue ceiling');
    expect(fake.terminated).toBe(true);
  });

  it('does not fire when the writer keeps up', async () => {
    const ffmpeg = makeFfmpeg();
    const fake = new FakeWorker();
    const p = startDrive(fake, ffmpeg, { appendQueueCeilingBytes: 1_000 });
    for (let i = 0; i < 50; i++) fake.emit(chunkOf(i).msg);
    fake.emit(doneMsg(50));
    const result = await p;
    expect(result.ok).toBe(true);
  });
});
