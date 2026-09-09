/**
 * WS3 salvage-runtime round — Step 1: wiring a flush-timeout salvage to a
 * REAL native truncation and a REAL native picture count, at the exact
 * per-piece call site in `exportProjectWebCodecs`, strictly before concat.
 *
 * Reached at the `exportProjectWebCodecs` level (not just `driveGlRun` in
 * isolation, as `flushSalvage.test.ts` already covers) via a test-only
 * `createWorker` injection point added to `exportProjectWebCodecs` for this
 * round — mirroring `DriveGlRunDeps.createWorker` one level up. Segments are
 * routed to Tier GL by mocking `isGlCompositableSegment` true (mirroring
 * `flushSalvage.test.ts`'s own routing-mock pattern, inverted).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';
import type { ExportWorkerOutboundMessage } from './exportWorker';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';

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
import { TRUNCATE_BOUND_MS } from './ffmpegLivenessBound';

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(_message: unknown): void {}
  terminate(): void {
    this.terminated = true;
  }
  emit(data: ExportWorkerOutboundMessage): void {
    this.onmessage?.({ data } as MessageEvent<ExportWorkerOutboundMessage>);
  }
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

function project(): Project {
  return {
    id: 'p',
    name: 'T',
    script: '',
    sceneDetails: '',
    segments: [segment],
    assets: [asset],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

// 1 segment, 1s @ 30fps -> 30 expected frames, exactly the piece total (a
// single-piece export, so `finalVideoFile = pieceFiles[0]` and concat is
// skipped entirely — the case the ordering argument in Step 1(d) calls out
// as needing pre-concat, per-piece truncation to stay uniform with the
// multi-piece case).
const EXPECTED_FRAMES = 30;

function diagnostics(framesEncoded: number): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {},
    instrumentationMs: 0,
    demuxSplit: [],
    framesEncoded,
    pieceIndex: 0,
    lastPhase: 'encoder-flush',
    phaseLog: [
      { seq: 1, atMs: 0, phase: 'frame-loop', pieceIndex: 0, segmentIndex: 0, assetId: 'a0', framesEncoded, kind: 'enter' },
    ],
    failure: null,
    demuxCacheSize: null,
    workerHeapBytes: null,
    decodedSourceFrames: 0,
    encodedChunkCount: framesEncoded,
    encodedKeyframeCount: 1,
    encodedChunkBytes: 0,
    encodedChunkCountAtFlushStart: framesEncoded,
    ...NO_FLUSH_OBSERVATION,
    encoderSessionIndex: 0,
    encoderSessions: 1,
    appendPendingAtFailure: null,
    decodersCreated: 0,
    decodersOpen: 0,
    cursorsCreated: 0,
    openCursors: 0,
    peakOpenCursors: 0,
    openImageBitmaps: 0,
    frameContentDigest: null,
    frameContentDigestFrames: null,
  };
}

/** Records every `truncateAnnexb` call and every appended byte, so both "was
 *  it called" and "with what result" are directly assertable. */
function ffmpegHarness(opts: {
  truncateResult?: { pictures: number; vclNals: number; bytesRemoved: number; keptBytes: number };
  countResult?: { pictures: number; vclNals: number };
} = {}): { ffmpeg: WebCodecsFfmpeg; truncateAnnexb: ReturnType<typeof vi.fn>; appendFileRaw: ReturnType<typeof vi.fn> } {
  const truncateAnnexb = vi.fn(async () => opts.truncateResult ?? { pictures: EXPECTED_FRAMES, vclNals: EXPECTED_FRAMES, bytesRemoved: 0, keptBytes: 100 });
  const appendFileRaw = vi.fn(async () => undefined);
  const ffmpeg = {
    writeFile: vi.fn(async () => undefined),
    writeFileRaw: vi.fn(async () => undefined),
    exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()),
    deleteFile: vi.fn(async () => undefined),
    appendFileRaw,
    saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    countAnnexbFrames: vi.fn(async () => opts.countResult ?? { pictures: EXPECTED_FRAMES, vclNals: EXPECTED_FRAMES }),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb,
  } as unknown as WebCodecsFfmpeg;
  return { ffmpeg, truncateAnnexb, appendFileRaw };
}

/** Drives `exportProjectWebCodecs` with a fake GL worker that emits exactly
 *  one 'salvage-done' (or, for the clean-path test, one 'done'). */
async function runWithFakeWorker(
  ffmpeg: WebCodecsFfmpeg,
  emit: (fake: FakeWorker) => void,
) {
  const fake = new FakeWorker();
  const resultPromise = exportProjectWebCodecs(
    project(),
    ffmpeg,
    { width: 1920, height: 1080, fps: 30 },
    () => undefined,
    { createWorker: () => fake },
  );
  // The worker is constructed synchronously inside `driveGlRun`, but only
  // once `exportProjectWebCodecs` has walked past routing/piece-planning —
  // give the microtask queue a turn before emitting.
  await Promise.resolve();
  await Promise.resolve();
  emit(fake);
  return resultPromise;
}

describe('salvage -> truncate -> count -> compare, at the exportProjectWebCodecs call site', () => {
  beforeEach(() => vi.clearAllMocks());

  it('(a)/(b) EXACT picture match after truncation -> ships, mux runs', async () => {
    const { ffmpeg, truncateAnnexb } = ffmpegHarness({
      truncateResult: { pictures: EXPECTED_FRAMES, vclNals: EXPECTED_FRAMES, bytesRemoved: 0, keptBytes: 12345 },
    });
    const r = await runWithFakeWorker(ffmpeg, (fake) => {
      fake.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
      fake.emit({
        type: 'salvage-done',
        runId: 'run_0',
        frameCount: EXPECTED_FRAMES,
        reason: 'final-flush timeout after every frame was submitted',
        diagnostics: diagnostics(EXPECTED_FRAMES),
      });
    });
    expect(r.ok).toBe(true);
    expect(truncateAnnexb).toHaveBeenCalledTimes(1);
    expect(truncateAnnexb).toHaveBeenCalledWith('piece_0.h264');
  });

  it('(b) SHORT after truncation -> aborts with the full typed payload, never ships', async () => {
    const { ffmpeg, truncateAnnexb } = ffmpegHarness({
      truncateResult: { pictures: EXPECTED_FRAMES - 1, vclNals: EXPECTED_FRAMES - 1, bytesRemoved: 512, keptBytes: 9000 },
    });
    const r = await runWithFakeWorker(ffmpeg, (fake) => {
      fake.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
      fake.emit({
        type: 'salvage-done',
        runId: 'run_0',
        frameCount: EXPECTED_FRAMES,
        reason: 'final-flush timeout after every frame was submitted',
        diagnostics: diagnostics(EXPECTED_FRAMES),
      });
    });
    expect(truncateAnnexb).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('concat');
    // The full typed payload: pictures found, expected, bytes removed,
    // encoderSessionIndex/encoderSessions, framesEncoded, and the reason.
    expect(r.error.message).toContain(`picturesAfterTruncation=${EXPECTED_FRAMES - 1}`);
    expect(r.error.message).toContain(`expectedFrames=${EXPECTED_FRAMES}`);
    expect(r.error.message).toContain('bytesRemovedByTruncation=512');
    expect(r.error.message).toContain('keptBytes=9000');
    expect(r.error.message).toContain(`framesSubmittedToEncoder=${EXPECTED_FRAMES}`);
    expect(r.error.message).toContain('encoderSessionIndex=0/1');
    expect(r.error.message).toContain('salvageReason=final-flush timeout');
    expect(r.error.message).toContain('short by 1');
    expect(r.error.liveness?.encoderSessions).toBe(1);
    expect(r.error.liveness?.encoderSessionIndex).toBe(0);
    expect(r.error.liveness?.framesEncoded).toBe(EXPECTED_FRAMES);
    expect(r.error.liveness?.failureVia).toBe('flush-timeout');
  });

  it('LONG after truncation -> also aborts (never widened past exact match)', async () => {
    const { ffmpeg } = ffmpegHarness({
      truncateResult: { pictures: EXPECTED_FRAMES + 1, vclNals: EXPECTED_FRAMES + 1, bytesRemoved: 0, keptBytes: 9000 },
    });
    const r = await runWithFakeWorker(ffmpeg, (fake) => {
      fake.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
      fake.emit({
        type: 'salvage-done',
        runId: 'run_0',
        frameCount: EXPECTED_FRAMES,
        reason: 'r',
        diagnostics: diagnostics(EXPECTED_FRAMES),
      });
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.message).toContain('long by 1');
  });

  it('(d) BOUND EXPIRY: a truncateAnnexb call that never settles kills the session THEN aborts with a typed, salvage-scoped error', async () => {
    vi.useFakeTimers();
    try {
      const killOrder: string[] = [];
      const truncateAnnexb = vi.fn(() => new Promise<never>(() => undefined));
      const { ffmpeg } = ffmpegHarness();
      (ffmpeg as unknown as { truncateAnnexb: typeof truncateAnnexb }).truncateAnnexb = truncateAnnexb;
      const kill = vi.fn(async () => {
        killOrder.push('kill');
      });
      (ffmpeg as unknown as { kill: typeof kill }).kill = kill;

      const resultPromise = runWithFakeWorker(ffmpeg, (fake) => {
        fake.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
        fake.emit({
          type: 'salvage-done',
          runId: 'run_0',
          frameCount: EXPECTED_FRAMES,
          reason: 'final-flush timeout after every frame was submitted',
          diagnostics: diagnostics(EXPECTED_FRAMES),
        });
      }).then((r) => {
        killOrder.push('resolved');
        return r;
      });

      await vi.advanceTimersByTimeAsync(TRUNCATE_BOUND_MS + 1_000);
      const r = await resultPromise;

      expect(truncateAnnexb).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledTimes(1);
      // Kill must have actually run (its own await settled) before the export
      // pipeline's promise resolves with the aborted result — never an
      // orphaned session left behind while the caller already moved on.
      expect(killOrder).toEqual(['kill', 'resolved']);

      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('unreachable');
      expect(r.error.kind).toBe('concat');
      // The salvage call site's own bound — not FRAME_COUNT_BOUND_MS's label,
      // which this call used to (mis)borrow.
      expect(r.error.message).toContain('TRUNCATE_BOUND_MS');
      expect(r.error.message).toContain('ffmpeg liveness bound');
      // Salvage context survives into the diagnostics payload carried on `cause`.
      expect(r.error.cause).toContain('piece_0.h264');
      expect(r.error.cause).toContain('"pieceIndex":0');
      expect(r.error.cause).toContain('"killed":true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('(c) OUTPUT NEUTRALITY: truncateAnnexb is NEVER invoked on the clean (non-salvaged) path', async () => {
    const { ffmpeg, truncateAnnexb, appendFileRaw } = ffmpegHarness();
    const r = await runWithFakeWorker(ffmpeg, (fake) => {
      fake.emit({
        type: 'chunk',
        runId: 'run_0',
        bytes: new Uint8Array([1, 2, 3]).buffer,
        chunkType: 'key',
        timestamp: 0,
      });
      fake.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
      fake.emit({ type: 'done', frameCount: EXPECTED_FRAMES, diagnostics: diagnostics(EXPECTED_FRAMES) });
    });
    expect(r.ok).toBe(true);
    expect(truncateAnnexb).not.toHaveBeenCalled();
    // The clean path's bytes are exactly what was appended — untouched by
    // any truncation call.
    expect(appendFileRaw).toHaveBeenCalledTimes(1);
    expect(appendFileRaw).toHaveBeenCalledWith('piece_0.h264', new Uint8Array([1, 2, 3]));
  });
});
