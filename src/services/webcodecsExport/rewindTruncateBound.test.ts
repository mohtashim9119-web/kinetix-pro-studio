/**
 * WS3 Round 10, Blocker 1 — the Rung 3 rewind's `truncateAnnexbToOffset` call
 * is bounded, kills the ffmpeg session on expiry, and surfaces the typed
 * `FfmpegBoundExpiredError` diagnostics.
 *
 * Rung 0's rule is that a RECOVERY path may not hang. Before this round the
 * rewind's truncate was the one native call in the whole recovery set with no
 * `withFfmpegLivenessBound` wrapper: its salvage-path sibling
 * (`ffmpeg.truncateAnnexb`, `salvageTruncate.test.ts`) had one, this did not.
 * A sidecar that wedged during a rewind therefore hung the export forever —
 * defeating the `FLUSH_BOUND_MS` expiry that sent it into the rewind in the
 * first place.
 *
 * Harness shape is deliberately `boundedRerenderWiring.test.ts`'s, so the two
 * files fail for the same reasons when the rewind path itself moves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';
import type { ExportWorkerInboundMessage, ExportWorkerOutboundMessage } from './exportWorker';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';
import { TRUNCATE_BOUND_MS } from './ffmpegLivenessBound';

vi.mock('../plainSegment', () => ({
  isPlainVideoSegment: () => false,
  isPlainImageSegment: () => false,
}));
vi.mock('./glCompositable', () => ({
  isGlCompositableSegment: () => true,
  GL_TRANSITION_SLUGS: new Set<string>(),
}));
vi.mock('./muxOnly', () => ({ muxOnly: vi.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import {
  exportProjectWebCodecs,
  type ExportWorkerHandle,
  type WebCodecsFfmpeg,
} from './exportPipelineWebCodecs';

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  initMessages: Extract<ExportWorkerInboundMessage, { type: 'init' }>[] = [];
  postMessage(message: unknown): void {
    const msg = message as ExportWorkerInboundMessage;
    if (msg.type === 'init') this.initMessages.push(msg);
  }
  terminate(): void { /* no-op */ }
  emit(data: ExportWorkerOutboundMessage): void {
    this.onmessage?.({ data } as MessageEvent<ExportWorkerOutboundMessage>);
  }
}

const segment: VideoSegment = {
  id: 's0', text: '', assetId: 'a0', startTime: 0, duration: 1,
  transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0,
};
const asset: Asset = { id: 'a0', name: 'a0.mp4', url: 'blob:a0', type: 'video' };

function project(): Project {
  return {
    id: 'p', name: 'T', script: '', sceneDetails: '',
    segments: [segment], assets: [asset],
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

const EXPECTED_FRAMES = 30;

function diagnostics(overrides: Partial<ExportWorkerDiagnosticsPayload> = {}): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: EXPECTED_FRAMES, pieceIndex: 0,
    lastPhase: 'encoder-flush',
    phaseLog: [],
    failure: null, demuxCacheSize: null, workerHeapBytes: null, decodedSourceFrames: 0,
    encodedChunkCount: EXPECTED_FRAMES, encodedKeyframeCount: 1, encodedChunkBytes: 0,
    encodedChunkCountAtFlushStart: EXPECTED_FRAMES,
    ...NO_FLUSH_OBSERVATION,
    encoderSessionIndex: 0, encoderSessions: 1, appendPendingAtFailure: null,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
    ...overrides,
  };
}

function rotationFlushTimeoutError(framesEncoded: number): Extract<ExportWorkerOutboundMessage, { type: 'error' }> {
  return {
    type: 'error',
    diagnostics: diagnostics({
      framesEncoded,
      failure: { name: 'EncoderFlushTimeoutError', message: 'flush did not settle', via: 'flush-timeout', frameIndex: framesEncoded - 1, timelineSec: null },
    }),
  };
}

function chunkMsg(index: number, size: number): Extract<ExportWorkerOutboundMessage, { type: 'chunk' }> {
  const bytes = new Uint8Array(size);
  bytes[0] = index & 0xff;
  return { type: 'chunk', runId: 'run_0', bytes: bytes.buffer.slice(0) as ArrayBuffer, chunkType: index === 0 ? 'key' : 'delta', timestamp: index };
}

async function flush(ticks = 30): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

describe('Rung 3 rewind truncate — bounded by TRUNCATE_BOUND_MS', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a truncateAnnexbToOffset that never settles expires the bound, kills ffmpeg, and returns typed diagnostics', async () => {
    const kill = vi.fn(async () => undefined);
    // Never settles — the exact shape of a wedged native streaming truncate.
    const truncateAnnexbToOffset = vi.fn(() => new Promise<never>(() => undefined));
    const ffmpeg = {
      writeFile: vi.fn(async () => undefined),
      writeFileRaw: vi.fn(async () => undefined),
      exec: vi.fn(async () => 0),
      readFile: vi.fn(async () => new Uint8Array()),
      deleteFile: vi.fn(async () => undefined),
      appendFileRaw: vi.fn(async () => undefined),
      saveSessionFile: vi.fn(async () => undefined),
      kill,
      destroy: vi.fn(async () => undefined),
      sessionFileSize: vi.fn(async () => 1_700_000_000),
      countAnnexbFrames: vi.fn(async () => ({ pictures: EXPECTED_FRAMES, vclNals: EXPECTED_FRAMES })),
      concatAnnexbPieces: vi.fn(async () => undefined),
      truncateAnnexb: vi.fn(async () => ({ pictures: EXPECTED_FRAMES, vclNals: EXPECTED_FRAMES, bytesRemoved: 0, keptBytes: 100 })),
      truncateAnnexbToOffset,
    } as unknown as WebCodecsFfmpeg;

    const fake = new FakeWorker();
    const resultPromise = exportProjectWebCodecs(
      project(), ffmpeg, { width: 1920, height: 1080, fps: 30 }, () => undefined,
      { createWorker: () => fake },
    );
    await flush();

    fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: EXPECTED_FRAMES });
    fake.emit(chunkMsg(0, 10));
    fake.emit(chunkMsg(1, 10));
    fake.emit(chunkMsg(2, 10));
    await vi.advanceTimersByTimeAsync(2_000); // let the batch age-timer flush
    fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: 1, sessions: 3, frameIndex: 5 });
    await flush();
    fake.emit(rotationFlushTimeoutError(9));
    await flush();

    expect(truncateAnnexbToOffset).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();

    // Run the bound out.
    await vi.advanceTimersByTimeAsync(TRUNCATE_BOUND_MS + 1_000);
    const r = await resultPromise;

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    // The typed liveness error, not the generic fallback message.
    expect(r.error.message).toContain('TRUNCATE_BOUND_MS');
    expect(r.error.message).toContain('aborting (ffmpeg liveness bound)');
    // The kill chain actually ran: ffmpeg.kill() -> set_session_cancelled ->
    // the per-session AtomicBool the Rust scanners poll.
    expect(kill).toHaveBeenCalled();
    const diag = JSON.parse(r.error.cause ?? '{}') as {
      label: string; boundMs: number; killed: boolean; files: string[]; pieceIndex: number | null;
    };
    expect(diag.label).toBe('TRUNCATE_BOUND_MS');
    expect(diag.boundMs).toBe(TRUNCATE_BOUND_MS);
    expect(diag.killed).toBe(true);
    expect(diag.files).toEqual(['piece_0.h264']);
    expect(diag.pieceIndex).toBe(0);
  });

  it('a truncateAnnexbToOffset that settles inside the bound is unaffected — the rewind proceeds', async () => {
    const kill = vi.fn(async () => undefined);
    const truncateAnnexbToOffset = vi.fn(async () => ({ pictures: 5, vclNals: 5, bytesRemoved: 40, keptBytes: 30 }));
    const ffmpeg = {
      writeFile: vi.fn(async () => undefined),
      writeFileRaw: vi.fn(async () => undefined),
      exec: vi.fn(async () => 0),
      readFile: vi.fn(async () => new Uint8Array()),
      deleteFile: vi.fn(async () => undefined),
      appendFileRaw: vi.fn(async () => undefined),
      saveSessionFile: vi.fn(async () => undefined),
      kill,
      destroy: vi.fn(async () => undefined),
      sessionFileSize: vi.fn(async () => 1_700_000_000),
      countAnnexbFrames: vi.fn(async () => ({ pictures: EXPECTED_FRAMES, vclNals: EXPECTED_FRAMES })),
      concatAnnexbPieces: vi.fn(async () => undefined),
      truncateAnnexb: vi.fn(async () => ({ pictures: EXPECTED_FRAMES, vclNals: EXPECTED_FRAMES, bytesRemoved: 0, keptBytes: 100 })),
      truncateAnnexbToOffset,
    } as unknown as WebCodecsFfmpeg;

    const fake = new FakeWorker();
    const resultPromise = exportProjectWebCodecs(
      project(), ffmpeg, { width: 1920, height: 1080, fps: 30 }, () => undefined,
      { createWorker: () => fake },
    );
    await flush();
    fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: EXPECTED_FRAMES });
    fake.emit(chunkMsg(0, 10));
    fake.emit(chunkMsg(1, 10));
    fake.emit(chunkMsg(2, 10));
    await vi.advanceTimersByTimeAsync(2_000);
    fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: 1, sessions: 3, frameIndex: 5 });
    await flush();
    fake.emit(rotationFlushTimeoutError(9));
    await flush();

    expect(fake.initMessages.length).toBe(2);
    fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: EXPECTED_FRAMES });
    fake.emit(chunkMsg(5, 12));
    fake.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
    fake.emit({ type: 'done', frameCount: EXPECTED_FRAMES, diagnostics: diagnostics() });
    await vi.advanceTimersByTimeAsync(2_000);

    const r = await resultPromise;
    expect(r.ok).toBe(true);
    expect(truncateAnnexbToOffset).toHaveBeenCalledWith('piece_0.h264', 30);
    // No bound expiry: the session is never killed on the happy rewind.
    expect(kill).not.toHaveBeenCalled();
  });
});
