/**
 * WS3 Tier 1 item 3b — non-deadlock proof for worker-side append back-pressure,
 * at the three seams named in the round's own risk statement: a worker parked
 * on `AppendBackpressureGate.waitIfNeeded()` must still be unblocked across
 * (1) an encoder-session rotation, (2) a normal 'done', and (3) a 'salvage-done'.
 *
 * The risk this guards against: the gate is unblocked only by an
 * 'append-ack' message from the main thread (`exportPipelineWebCodecs.ts`),
 * sent only from inside `flushPendingBatch`'s success path. If any of the
 * three seams could reach its own terminal/rotation handling WITHOUT that
 * path having run first, a worker parked at exactly that moment would wait
 * forever for main-thread action that was never coming — a hang this round
 * would have introduced.
 *
 * Each test below buffers a small run of chunks deliberately kept UNDER both
 * batch triggers (APPEND_BATCH_CHUNKS, APPEND_BATCH_BYTES) so nothing flushes
 * them on its own, then submits one oversized chunk that pushes the gate's
 * unacked total over threshold and parks the (simulated) worker. The named
 * seam is then the ONLY thing driven before the flush's own timer resolves —
 * proving that seam's `flushPendingBatch()` call (`noteTerminalMessage` for
 * done/salvage-done, the inline call in the `session-rotate` case) is what
 * flushes the buffered bytes and, once that flush's `appendFileRaw` resolves,
 * sends the ack that brings the parked chunk back under threshold. Byte
 * arithmetic is chosen so acking ONLY the buffered amount is what crosses
 * back under threshold — if the seam's flush never fired, the wait would
 * still be parked when the test asserts, and a real hang would instead read
 * as a vitest timeout on the final `await p`.
 *
 * `GatedFakeWorker` is not the real `exportWorker.ts` — it is a deliberately
 * small stand-in that reuses the REAL `AppendBackpressureGate` class (not a
 * re-implementation of its semantics) and gates chunk emission on it exactly
 * the way `runFrameLoopTick` gates `encoder.encode`: submit the chunk's
 * bytes, await the gate, only then let the byte reach the orchestrator. It
 * also feeds every inbound 'append-ack' the orchestrator sends back into the
 * SAME gate instance, exactly as `exportWorker.ts`'s `self.onmessage` does
 * for `activeAppendBackpressureGate`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, HeadingOverlay, TextOverlay, VideoSegment } from '../../types';
import {
  driveGlRun,
  APPEND_BATCH_BYTES,
  APPEND_BATCH_CHUNKS,
  APPEND_QUEUE_CEILING_BYTES,
  type ExportWorkerHandle,
  type WebCodecsFfmpeg,
} from './exportPipelineWebCodecs';
import type { ExportWorkerOutboundMessage, ExportWorkerInboundMessage } from './exportWorker';
import { AppendBackpressureGate, APPEND_BACKPRESSURE_THRESHOLD_BYTES } from './appendBackpressureGate';
import type { ProjectEffectConfig } from '../gl/compositeParams';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';

class GatedFakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  inbound: ExportWorkerInboundMessage[] = [];
  readonly gate = new AppendBackpressureGate(APPEND_BACKPRESSURE_THRESHOLD_BYTES);

  postMessage(message: unknown): void {
    const msg = message as ExportWorkerInboundMessage;
    this.inbound.push(msg);
    if (msg.type === 'append-ack') this.gate.ack(msg.bytesAcked);
  }

  terminate(): void { this.terminated = true; }

  emit(data: ExportWorkerOutboundMessage): void {
    this.onmessage?.({ data } as MessageEvent<ExportWorkerOutboundMessage>);
  }

  /** Mirrors exportWorker.ts's chunk callback: submit bytes to the gate,
   *  await it (this is where a real worker would be parked), only then post
   *  the chunk onward. */
  async emitChunkGated(c: { msg: Extract<ExportWorkerOutboundMessage, { type: 'chunk' }>; bytes: Uint8Array }): Promise<void> {
    this.gate.submit(c.bytes.byteLength);
    await this.gate.waitIfNeeded();
    this.emit(c.msg);
  }
}

/** WS3 Round 12 (H1) — `driveGlRun` now verifies every append against
 *  `sessionFileSize`, so the default fake must behave like a real growing
 *  file rather than a fixed stub. */
function makeFfmpeg(overrides: Partial<WebCodecsFfmpeg> = {}): WebCodecsFfmpeg {
  let landed = 0;
  return {
    writeFile: vi.fn(async () => undefined),
    writeFileRaw: vi.fn(async () => undefined),
    exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()),
    deleteFile: vi.fn(async () => undefined),
    appendFileRaw: vi.fn(async (_p: string, data: Uint8Array) => { landed += data.byteLength; }),
    saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    sessionFileSize: vi.fn(async () => landed),
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

function startDrive(fake: GatedFakeWorker, ffmpeg: WebCodecsFfmpeg) {
  return driveGlRun(
    ffmpeg, 'run_0', 'piece_0.h264', [segment], [asset], config,
    1920, 1080, 30, 30, () => undefined, textConfig, 0, 0,
    { createWorker: () => fake, now: () => Date.now() },
  );
}

function diagnostics(overrides: Partial<ExportWorkerDiagnosticsPayload> = {}): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: 8, pieceIndex: 0,
    lastPhase: 'encoder-flush', phaseLog: [], failure: null, demuxCacheSize: null,
    workerHeapBytes: null, decodedSourceFrames: 0, encodedChunkCount: 0,
    encodedKeyframeCount: 0, encodedChunkBytes: 0, encodedChunkCountAtFlushStart: null,
    ...NO_FLUSH_OBSERVATION,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
    ...overrides,
  };
}

function chunkOf(index: number, size: number): { msg: Extract<ExportWorkerOutboundMessage, { type: 'chunk' }>; bytes: Uint8Array } {
  const bytes = new Uint8Array(size);
  bytes[0] = index & 0xff;
  return {
    msg: { type: 'chunk', runId: 'run_0', bytes: bytes.buffer.slice(0) as ArrayBuffer, chunkType: index === 0 ? 'key' : 'delta', timestamp: index },
    bytes,
  };
}

afterEach(() => { vi.useRealTimers(); });

// Seven small chunks — well under APPEND_BATCH_CHUNKS (100) and, summed,
// well under APPEND_BATCH_BYTES (WS3 Round 12: 512 KiB, down from 4 MB —
// see APPEND_BATCH_BYTES's own doc comment) — so they sit in `pendingBatch`
// unflushed until something forces them out.
const SMALL_CHUNK_BYTES = 32 * 1024; // 32 KiB
const SMALL_CHUNK_COUNT = 7;
const BUFFERED_TOTAL = SMALL_CHUNK_BYTES * SMALL_CHUNK_COUNT; // 224 KiB — well under the 512 KiB batch cap

// Sized so that submitting it pushes cumulative unacked OVER_THRESHOLD_MARGIN
// over the back-pressure threshold, but acking ONLY the buffered amount
// brings it back under — i.e. the buffered amount is exactly what has to be
// flushed (and acked) for the gate to reopen. If the tested seam's own
// `flushPendingBatch()` call did not fire, this stays parked forever. The
// margin must stay LESS than BUFFERED_TOTAL: unacked-after-ack works out to
// exactly BIG_CHUNK_BYTES itself (`threshold - BUFFERED_TOTAL + margin`),
// which only lands back at-or-under `threshold` when `margin <= BUFFERED_TOTAL`
// (WS3 Round 12: shrunk from 2 MiB alongside BUFFERED_TOTAL's own shrink —
// see SMALL_CHUNK_BYTES's doc comment — to keep that relationship true).
const OVER_THRESHOLD_MARGIN = 64 * 1024; // 64 KiB, well under BUFFERED_TOTAL (224 KiB)
const BIG_CHUNK_BYTES = APPEND_BACKPRESSURE_THRESHOLD_BYTES - BUFFERED_TOTAL + OVER_THRESHOLD_MARGIN;

async function bufferSmallChunks(fake: GatedFakeWorker): Promise<void> {
  for (let i = 0; i < SMALL_CHUNK_COUNT; i++) {
    await fake.emitChunkGated(chunkOf(i, SMALL_CHUNK_BYTES));
  }
}

describe('append back-pressure — non-deadlock at the three seams', () => {
  it('session rotation flushes the buffer and unblocks the parked worker (seam 1/3)', async () => {
    vi.useFakeTimers();
    let landed = 0;
    const ffmpeg = makeFfmpeg({
      appendFileRaw: vi.fn((_p: string, data: Uint8Array) => new Promise<void>((res) => {
        setTimeout(() => { landed += data.byteLength; res(); }, 3_000);
      })),
      sessionFileSize: vi.fn(async () => landed),
    });
    const fake = new GatedFakeWorker();
    const p = startDrive(fake, ffmpeg);

    await bufferSmallChunks(fake);
    expect(fake.inbound.some((m) => m.type === 'append-ack')).toBe(false); // nothing flushed yet

    let bigResolved = false;
    const bigEmit = fake.emitChunkGated(chunkOf(SMALL_CHUNK_COUNT, BIG_CHUNK_BYTES)).then(() => { bigResolved = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(bigResolved).toBe(false); // parked: 7 buffered chunks were never posted, so never flushed/acked

    // Drive ONLY the seam under test.
    fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: 1, sessions: 2, frameIndex: SMALL_CHUNK_COUNT });
    await vi.advanceTimersByTimeAsync(0);
    expect(bigResolved).toBe(false); // rotation queued the flush; the writer mock hasn't resolved yet

    await vi.advanceTimersByTimeAsync(3_000); // the rotation-triggered flush's appendFileRaw resolves -> ack sent
    await bigEmit;
    expect(bigResolved).toBe(true);

    fake.emit({ type: 'done', frameCount: SMALL_CHUNK_COUNT + 1, diagnostics: diagnostics() });
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await p;
    expect(result.ok).toBe(true);
  });

  it('a normal done flushes the buffer and unblocks the parked worker (seam 2/3)', async () => {
    vi.useFakeTimers();
    let landed = 0;
    const ffmpeg = makeFfmpeg({
      appendFileRaw: vi.fn((_p: string, data: Uint8Array) => new Promise<void>((res) => {
        setTimeout(() => { landed += data.byteLength; res(); }, 3_000);
      })),
      sessionFileSize: vi.fn(async () => landed),
    });
    const fake = new GatedFakeWorker();
    const p = startDrive(fake, ffmpeg);

    await bufferSmallChunks(fake);
    let bigResolved = false;
    const bigEmit = fake.emitChunkGated(chunkOf(SMALL_CHUNK_COUNT, BIG_CHUNK_BYTES)).then(() => { bigResolved = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(bigResolved).toBe(false);

    // 'done' is posted by the (simulated) worker's frame loop AFTER this tick
    // — in reality it could not have been posted while the loop is still
    // parked submitting a frame. Emitting it here anyway and observing that
    // the parked promise STILL doesn't resolve until the writer's own timer
    // fires is the point: 'done' triggers the flush, but the ack still
    // depends on real (mocked) disk-confirmed completion, never on the
    // message arriving.
    fake.emit({ type: 'done', frameCount: SMALL_CHUNK_COUNT, diagnostics: diagnostics() });
    await vi.advanceTimersByTimeAsync(0);
    expect(bigResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(3_000);
    await bigEmit;
    expect(bigResolved).toBe(true);
    expect(fake.inbound.some((m) => m.type === 'append-ack')).toBe(true);

    await vi.advanceTimersByTimeAsync(3_000);
    const result = await p;
    expect(result.ok).toBe(true);
  });

  it('a salvage-done flushes the buffer and unblocks the parked worker (seam 3/3)', async () => {
    vi.useFakeTimers();
    let landed = 0;
    const ffmpeg = makeFfmpeg({
      appendFileRaw: vi.fn((_p: string, data: Uint8Array) => new Promise<void>((res) => {
        setTimeout(() => { landed += data.byteLength; res(); }, 3_000);
      })),
      sessionFileSize: vi.fn(async () => landed),
    });
    const fake = new GatedFakeWorker();
    const p = startDrive(fake, ffmpeg);

    await bufferSmallChunks(fake);
    let bigResolved = false;
    const bigEmit = fake.emitChunkGated(chunkOf(SMALL_CHUNK_COUNT, BIG_CHUNK_BYTES)).then(() => { bigResolved = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(bigResolved).toBe(false);

    fake.emit({ type: 'salvage-done', runId: 'run_0', frameCount: SMALL_CHUNK_COUNT, reason: 'flush-timeout', diagnostics: diagnostics() });
    await vi.advanceTimersByTimeAsync(0);
    expect(bigResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(3_000);
    await bigEmit;
    expect(bigResolved).toBe(true);

    await vi.advanceTimersByTimeAsync(3_000);
    const result = await p;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.salvaged).toBe(true);
  });

  it('the parked window (bounded by writer latency) stays far under FORWARD_PROGRESS_BOUND_MS', async () => {
    // Each seam test above parks for exactly the mock writer's 3s latency,
    // and every one settles 'ok: true' rather than a stall error — a fired
    // FORWARD_PROGRESS_BOUND_MS (45s) or WATCHDOG_MS (30s) would have settled
    // the run as an error instead. This test states that margin explicitly:
    // the SAME event (a completed append) both resets the progress bound
    // (exportPipelineWebCodecs.ts's `resetProgressBound`, called in the same
    // success branch as the ack) and unblocks the gate, so a worker legitimately
    // parked on back-pressure can only ever be read as live, never as stalled,
    // for as long as the writer itself is not the thing that's actually hung
    // (in which case the SAME bounds that catch a hung writer today still fire
    // — back-pressure adds no new failure mode there).
    vi.useFakeTimers();
    let landed = 0;
    const ffmpeg = makeFfmpeg({
      appendFileRaw: vi.fn((_p: string, data: Uint8Array) => new Promise<void>((res) => {
        setTimeout(() => { landed += data.byteLength; res(); }, 3_000);
      })),
      sessionFileSize: vi.fn(async () => landed),
    });
    const fake = new GatedFakeWorker();
    const p = startDrive(fake, ffmpeg);
    await bufferSmallChunks(fake);
    let bigResolved = false;
    const bigEmit = fake.emitChunkGated(chunkOf(SMALL_CHUNK_COUNT, BIG_CHUNK_BYTES)).then(() => { bigResolved = true; });
    await vi.advanceTimersByTimeAsync(0);
    fake.emit({ type: 'done', frameCount: SMALL_CHUNK_COUNT, diagnostics: diagnostics() });
    // Advance well past the parked window but nowhere near either liveness
    // bound, then let the flush chain fully settle. `bigEmit` MUST resolve
    // here — an un-awaited fire-and-forget parked promise would let this
    // test pass even if the gate never reopened, since `p`'s own completion
    // does not depend on the gated chunk ever landing.
    await vi.advanceTimersByTimeAsync(3_000);
    await bigEmit;
    expect(bigResolved).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await p;
    expect(result.ok).toBe(true); // not 'stall' / 'append-drain-stall'
  });
});

describe('append back-pressure — the threshold sits below the queue ceiling', () => {
  it('APPEND_BACKPRESSURE_THRESHOLD_BYTES is below APPEND_QUEUE_CEILING_BYTES with room to spare', () => {
    expect(APPEND_BACKPRESSURE_THRESHOLD_BYTES).toBeLessThan(APPEND_QUEUE_CEILING_BYTES);
    expect(APPEND_QUEUE_CEILING_BYTES / APPEND_BACKPRESSURE_THRESHOLD_BYTES).toBeGreaterThanOrEqual(4);
  });

  it('the threshold sits well above one batch trigger, so ordinary batching noise cannot spuriously engage it', () => {
    expect(APPEND_BACKPRESSURE_THRESHOLD_BYTES).toBeGreaterThan(APPEND_BATCH_BYTES * 4);
    expect(BUFFERED_TOTAL).toBeLessThan(APPEND_BATCH_BYTES);
    expect(SMALL_CHUNK_COUNT).toBeLessThan(APPEND_BATCH_CHUNKS);
  });
});
