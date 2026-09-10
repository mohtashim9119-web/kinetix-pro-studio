/**
 * WS3 Tier 1 item 3c — Rung 3 wired to real execution, at the
 * `exportProjectWebCodecs` call site (mirroring `salvageTruncate.test.ts`'s
 * own level — reached via the same test-only `createWorker` injection point).
 *
 * `decideBoundedRerenderDisposition` (`boundedRerenderPolicy.test.ts`) was,
 * before this round, tested in isolation with zero production callers. These
 * tests exercise the REAL decision + truncate + resume path: a MID-run
 * (rotation) flush timeout — never the final flush, which keeps its own
 * separate salvage path — triggers a truncate-to-the-last-good-session-
 * boundary and a resumed `driveGlRun` call, bounded by
 * `MAX_BOUNDARY_REWINDS_PER_EXPORT`.
 *
 * The SAME `FakeWorker` instance is reused across a rewind's two (or three)
 * `driveGlRun` invocations — `createWorker` is a factory the orchestrator
 * calls once per attempt, and returning the same object each time lets one
 * test drive both the failing attempt and its resumed retry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';
import type { ExportWorkerInboundMessage, ExportWorkerOutboundMessage } from './exportWorker';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';

vi.mock('../plainSegment', () => ({
  isPlainVideoSegment: () => false,
  isPlainImageSegment: () => false,
}));
vi.mock('./glCompositable', () => ({
  isGlCompositableSegment: () => true,
  GL_TRANSITION_SLUGS: new Set<string>(),
}));
// WS3 Round 10 — PARTIAL module mock, made partial on purpose. The sealing
// seam (`forcedMp4SealOffer` / `sealTruncatedAnnexbToMp4`) now lives in this
// module and IS reached by the orchestrator's guard path, so a factory that
// returned only `muxOnly` deleted those two exports and turned a clean typed
// guard failure into "Failed to verify the concatenated output frame count".
// Spreading the real module keeps the seal logic honest while still stubbing
// the ffmpeg-invoking part.
vi.mock('./muxOnly', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./muxOnly')>()),
  muxOnly: vi.fn(async () => undefined),
}));

// eslint-disable-next-line import/first
import {
  exportProjectWebCodecs,
  MAX_BOUNDARY_REWINDS_PER_EXPORT,
  type ExportWorkerHandle,
  type WebCodecsFfmpeg,
} from './exportPipelineWebCodecs';

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  /** Every 'init' message this worker slot has received, in order — one per
   *  `driveGlRun` attempt (the first, plus one per rewind). */
  initMessages: Extract<ExportWorkerInboundMessage, { type: 'init' }>[] = [];
  postMessage(message: unknown): void {
    const msg = message as ExportWorkerInboundMessage;
    if (msg.type === 'init') this.initMessages.push(msg);
  }
  terminate(): void { this.terminated = true; }
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
    phaseLog: [{ seq: 1, atMs: 0, phase: 'frame-loop', pieceIndex: 0, segmentIndex: 0, assetId: 'a0', framesEncoded: EXPECTED_FRAMES, kind: 'enter' }],
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

/** A flush-timeout 'error' message, matching what `runFrameLoopTick`'s
 *  rotation catch block (exportWorker.ts) actually produces on a
 *  `EncoderFlushTimeoutError` re-thrown from a MID-run rotation. */
function rotationFlushTimeoutError(framesEncoded: number): Extract<ExportWorkerOutboundMessage, { type: 'error' }> {
  return {
    type: 'error',
    diagnostics: diagnostics({
      framesEncoded,
      failure: { name: 'EncoderFlushTimeoutError', message: 'flush did not settle', via: 'flush-timeout', frameIndex: framesEncoded - 1, timelineSec: null },
    }),
  };
}

/** Flushes many more microtask ticks than any single `await` chain in the
 *  rewind path needs (error message -> `finish` resolves -> `runGlPiece`'s
 *  await resumes -> `await ffmpeg.truncateAnnexbToOffset` resolves -> the
 *  resumed `runGlPiece` call's own Promise executor runs) — cheap, and far
 *  more robust than counting exact microtask hops by hand. */
async function flush(ticks = 20): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

function chunkMsg(index: number, size: number): Extract<ExportWorkerOutboundMessage, { type: 'chunk' }> {
  const bytes = new Uint8Array(size);
  bytes[0] = index & 0xff;
  return { type: 'chunk', runId: 'run_0', bytes: bytes.buffer.slice(0) as ArrayBuffer, chunkType: index === 0 ? 'key' : 'delta', timestamp: index };
}

function ffmpegHarness(opts: {
  truncateOffsetResult?: { pictures: number; vclNals: number; bytesRemoved: number; keptBytes: number };
} = {}): { ffmpeg: WebCodecsFfmpeg; truncateAnnexbToOffset: ReturnType<typeof vi.fn>; truncateAnnexb: ReturnType<typeof vi.fn>; appendFileRaw: ReturnType<typeof vi.fn> } {
  // WS3 Round 12 (H1) — tracked by path so `driveGlRun`'s per-append verify
  // (`sessionFileSize` read right after `appendFileRaw`) sees a landed size
  // consistent with what was actually appended, while any OTHER path (the
  // orchestrator's post-run `finalVideoFile` probe when it differs from the
  // piece file) keeps the old fixed stub these tests never depend on.
  const landed = new Map<string, number>();
  const appendFileRaw = vi.fn(async (p: string, data: Uint8Array) => {
    landed.set(p, (landed.get(p) ?? 0) + data.byteLength);
  });
  const truncateAnnexb = vi.fn(async () => ({ pictures: EXPECTED_FRAMES, vclNals: EXPECTED_FRAMES, bytesRemoved: 0, keptBytes: 100 }));
  // A rewind's truncate shrinks the real file back to `byteOffset` — the
  // fake must do the same to `landed`, or the resumed run's next append
  // verify sees a landed size that never actually shrank.
  const truncateAnnexbToOffset = vi.fn(async (p: string, byteOffset: number) => {
    landed.set(p, byteOffset);
    return opts.truncateOffsetResult ?? { pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 };
  });
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
    sessionFileSize: vi.fn(async (p: string) => landed.get(p) ?? 1_700_000_000),
    countAnnexbFrames: vi.fn(async () => ({ pictures: EXPECTED_FRAMES, vclNals: EXPECTED_FRAMES })),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb,
    truncateAnnexbToOffset,
  } as unknown as WebCodecsFfmpeg;
  return { ffmpeg, truncateAnnexbToOffset, truncateAnnexb, appendFileRaw };
}

async function runWithFakeWorker(ffmpeg: WebCodecsFfmpeg, drive: (fake: FakeWorker) => Promise<void> | void) {
  const fake = new FakeWorker();
  const resultPromise = exportProjectWebCodecs(
    project(),
    ffmpeg,
    { width: 1920, height: 1080, fps: 30 },
    () => undefined,
    { createWorker: () => fake },
  );
  await Promise.resolve();
  await Promise.resolve();
  await drive(fake);
  const result = await resultPromise;
  return { result, fake };
}

describe('bounded re-render (Rung 3) — wired at the exportProjectWebCodecs call site', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a mid-run rotation flush-timeout rewinds to the last good session boundary and resumes', async () => {
    const { ffmpeg, truncateAnnexbToOffset, appendFileRaw } = ffmpegHarness({
      // The kept portion must hold exactly 5 pictures — `rewindFrameIndex`.
      truncateOffsetResult: { pictures: 5, vclNals: 5, bytesRemoved: 40, keptBytes: 30 },
    });

    const { result: r, fake } = await runWithFakeWorker(ffmpeg, async (fake) => {
      // --- Attempt 1: session 0 (3 planned), then rotate into session 1 at
      // frame 5, then HANG rotating out of session 1.
      fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: EXPECTED_FRAMES });
      fake.emit(chunkMsg(0, 10));
      fake.emit(chunkMsg(1, 10));
      fake.emit(chunkMsg(2, 10)); // session 0: 30 bytes total
      await flush(); // let the batch flush AND the session-rotate's async appendQueue marker settle
      fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: 1, sessions: 3, frameIndex: 5 });
      await flush(); // `sessionByteOffsets[1]`/`sessionFrameIndices[1]` are set inside an `appendQueue.then` — must fully settle before the hang below, or the rewind's own defensive undefined-check aborts it
      fake.emit(chunkMsg(3, 12));
      fake.emit(chunkMsg(4, 12)); // session 1: 24 more bytes
      await flush();
      fake.emit(rotationFlushTimeoutError(9)); // hangs rotating OUT of session 1

      await flush();

      // --- Attempt 2 (resumed): the SAME fake worker slot, now driving a
      // fresh `driveGlRun` call. Finish cleanly.
      expect(fake.initMessages.length).toBe(2);
      fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: EXPECTED_FRAMES });
      fake.emit(chunkMsg(5, 12));
      fake.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
      fake.emit({ type: 'done', frameCount: EXPECTED_FRAMES, diagnostics: diagnostics() });
    });

    expect(r.ok).toBe(true);

    // The truncate must land at session 1's OWN recorded boundary: 30 bytes
    // (session 0's chunks), not session 1's own bytes.
    expect(truncateAnnexbToOffset).toHaveBeenCalledTimes(1);
    expect(truncateAnnexbToOffset).toHaveBeenCalledWith('piece_0.h264', 30);

    // The resumed attempt's OWN init message must carry `resumeFromFrameIndex`
    // equal to session 1's recorded start — frame 5 — not 0 and not undefined.
    expect(fake.initMessages.length).toBe(2);
    expect(fake.initMessages[0]!.resumeFromFrameIndex).toBeUndefined();
    expect(fake.initMessages[1]!.resumeFromFrameIndex).toBe(5);

    // Session 1's own 2 chunks (24 bytes) never crossed a batch trigger
    // before the hang, so they were still sitting in `pendingBatch` —
    // `finish()`'s abort path clears that buffer without flushing it
    // (there is no point writing more bytes into a run about to be
    // truncated), so they never reached `appendFileRaw` at all. Only the
    // resumed run's own new chunk (12 bytes) is appended after session 0's
    // batch — proving the rewind didn't duplicate or re-send anything.
    const appendedByteLengths = appendFileRaw.mock.calls.map((c: unknown[]) => (c[1] as Uint8Array).byteLength);
    expect(appendedByteLengths).toEqual([30, 12]);
  });

  it('a final-flush timeout (last planned session) is NOT treated as a rewind candidate', async () => {
    const { ffmpeg, truncateAnnexbToOffset } = ffmpegHarness();
    const { result: r } = await runWithFakeWorker(ffmpeg, (fake) => {
      // Single-session piece: encoderSessionIndex (0) === encoderSessions-1 (0)
      // — this is the FINAL flush's own failure shape, not a rotation's.
      fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 1, capFrames: 1800, totalFrames: EXPECTED_FRAMES });
      fake.emit(rotationFlushTimeoutError(EXPECTED_FRAMES));
    });
    expect(r.ok).toBe(false);
    expect(truncateAnnexbToOffset).not.toHaveBeenCalled();
  });

  it(`stops SAME-RUNG rewinding once MAX_BOUNDARY_REWINDS_PER_EXPORT (${MAX_BOUNDARY_REWINDS_PER_EXPORT}) is reached, then fails over to software once, then fails instead`, async () => {
    // WS3 Round 9 (Rung 5a) — this test used to assert a hard abort right at
    // the rewind bound. That bound is unchanged; what changed is what
    // happens AFTER it, once `decideHardwareFailoverDisposition` exists:
    // exactly one more attempt, forced onto `SOFTWARE_ONLY_LADDER`, before
    // the export actually gives up. See `hardwareFailoverWiring.test.ts` for
    // the dedicated coverage of that branch — this test still pins the part
    // that is genuinely this file's own: the SAME-RUNG rewind bound itself,
    // extended one attempt further so the whole export completes.
    const { ffmpeg, truncateAnnexbToOffset } = ffmpegHarness({
      truncateOffsetResult: { pictures: 5, vclNals: 5, bytesRemoved: 0, keptBytes: 30 },
    });

    const { result: r, fake } = await runWithFakeWorker(ffmpeg, async (fake) => {
      // Same hang, over and over — every RESUMED attempt makes zero further
      // progress before hanging again (no session-rotate of its own), which
      // is exactly the case that used to defeat the ledger: a resumed run's
      // `sessionAt` must start at the session it resumed INTO, not 0, or a
      // hang before its own first rotation reads the wrong session entirely.
      // One extra iteration beyond the old bound: the failover (software)
      // attempt hangs too, so the export exhausts BOTH resources.
      for (let attempt = 0; attempt <= MAX_BOUNDARY_REWINDS_PER_EXPORT + 1; attempt++) {
        fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: EXPECTED_FRAMES });
        if (attempt === 0) {
          fake.emit(chunkMsg(0, 10));
          fake.emit(chunkMsg(1, 10));
          fake.emit(chunkMsg(2, 10));
          await flush();
          fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: 1, sessions: 3, frameIndex: 5 });
          await flush();
        }
        fake.emit(rotationFlushTimeoutError(9));
        await flush();
      }
    });

    expect(r.ok).toBe(false);
    // MAX_BOUNDARY_REWINDS_PER_EXPORT same-rung truncates, plus exactly ONE
    // more for the software failover attempt — never fewer, never more.
    expect(truncateAnnexbToOffset).toHaveBeenCalledTimes(MAX_BOUNDARY_REWINDS_PER_EXPORT + 1);
    // All three land at the SAME boundary — correct here specifically
    // because every resumed attempt makes zero progress before hanging
    // again, so there is nothing new to cut back past.
    expect(truncateAnnexbToOffset.mock.calls.map((c: unknown[]) => c[1])).toEqual([30, 30, 30]);
    // THE FIELD THIS TEST EXISTS TO PIN: every resumed init message must
    // still carry `resumeFromFrameIndex: 5` — session 1's real start. Before
    // `resumeSessionIndex` was threaded through `DriveGlRunDeps`, a resumed
    // run's own `sessionAt` reset to 0 on hanging again, so the SECOND
    // rewind read `hungSessionIndex=0` and resumed from frame 0 instead of
    // 5 — silently re-encoding (and duplicating) frames already on disk.
    expect(fake.initMessages.length).toBe(MAX_BOUNDARY_REWINDS_PER_EXPORT + 2);
    expect(fake.initMessages.map((m) => m.resumeFromFrameIndex)).toEqual([undefined, 5, 5, 5]);
    // The LAST attempt only is the software failover — see
    // `hardwareFailoverWiring.test.ts` for the dedicated ordering proof.
    expect(fake.initMessages.map((m) => m.forceSoftwareEncoder ?? false)).toEqual([false, false, false, true]);
  });

  it('a truncate that keeps the wrong picture count aborts rather than resuming from a mismatched boundary', async () => {
    const { ffmpeg, truncateAnnexbToOffset } = ffmpegHarness({
      // Expected exactly 5 pictures (rewindFrameIndex) — this is off by one.
      truncateOffsetResult: { pictures: 4, vclNals: 4, bytesRemoved: 0, keptBytes: 30 },
    });
    const { result: r } = await runWithFakeWorker(ffmpeg, async (fake) => {
      fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: EXPECTED_FRAMES });
      fake.emit(chunkMsg(0, 10));
      fake.emit(chunkMsg(1, 10));
      fake.emit(chunkMsg(2, 10));
      await flush();
      fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: 1, sessions: 3, frameIndex: 5 });
      await flush();
      fake.emit(rotationFlushTimeoutError(9));
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(truncateAnnexbToOffset).toHaveBeenCalledTimes(1);
    expect(r.error.message).toContain('expected exactly 5');
    expect(r.error.message).toContain('kept 4 picture');
  });

  it('OUTPUT NEUTRALITY: a run that never hits a rotation flush-timeout never calls truncateAnnexbToOffset, and its first init message carries no resumeFromFrameIndex', async () => {
    const { ffmpeg, truncateAnnexbToOffset, appendFileRaw } = ffmpegHarness();
    const { result: r, fake } = await runWithFakeWorker(ffmpeg, (fk) => {
      fk.emit(chunkMsg(0, 3));
      fk.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
      fk.emit({ type: 'done', frameCount: EXPECTED_FRAMES, diagnostics: diagnostics() });
    });
    expect(r.ok).toBe(true);
    expect(fake.initMessages[0]!.resumeFromFrameIndex).toBeUndefined();
    expect(truncateAnnexbToOffset).not.toHaveBeenCalled();
    expect(appendFileRaw).toHaveBeenCalledTimes(1);
  });
});
