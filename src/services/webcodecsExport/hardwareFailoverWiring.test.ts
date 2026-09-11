/**
 * WS3 Round 9 — Rung 5a wired at the `exportProjectWebCodecs` call site.
 *
 * Duplicates the minimal `FakeWorker`/`ffmpegHarness` pattern from
 * `boundedRerenderWiring.test.ts` (nothing there is exported, and that file
 * belongs to a prior round) to drive the SAME rotation-flush-timeout shape
 * far enough to exhaust `MAX_BOUNDARY_REWINDS_PER_EXPORT`, then prove the
 * failover branch: exactly one extra `driveGlRun` attempt, forced onto
 * `SOFTWARE_ONLY_LADDER`, never more — the worst-case total-attempt bound
 * Round 9's final report has to state and prove.
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

function rotationFlushTimeoutError(framesEncoded: number): Extract<ExportWorkerOutboundMessage, { type: 'error' }> {
  return {
    type: 'error',
    diagnostics: diagnostics({
      framesEncoded,
      failure: { name: 'EncoderFlushTimeoutError', message: 'flush did not settle', via: 'flush-timeout', frameIndex: framesEncoded - 1, timelineSec: null },
    }),
  };
}

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
} = {}): { ffmpeg: WebCodecsFfmpeg; truncateAnnexbToOffset: ReturnType<typeof vi.fn>; landed: Map<string, number> } {
  // WS3 Round 12 (H1) — tracked by path so `driveGlRun`'s per-append verify
  // (`sessionFileSize` read right after `appendFileRaw`) sees a landed size
  // consistent with what was actually appended, and a rewind's truncate
  // shrinks it back the same way a real file would.
  const landed = new Map<string, number>();
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
    appendFileRaw: vi.fn(async (p: string, data: Uint8Array) => {
      landed.set(p, (landed.get(p) ?? 0) + data.byteLength);
    }),
    saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    sessionFileSize: vi.fn(async (p: string) => landed.get(p) ?? 1_700_000_000),
    countAnnexbFrames: vi.fn(async () => ({ pictures: EXPECTED_FRAMES, vclNals: EXPECTED_FRAMES })),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb: vi.fn(async () => ({ pictures: EXPECTED_FRAMES, vclNals: EXPECTED_FRAMES, bytesRemoved: 0, keptBytes: 100 })),
    truncateAnnexbToOffset,
  } as unknown as WebCodecsFfmpeg;
  return { ffmpeg, truncateAnnexbToOffset, landed };
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

/** Emits one rotation-flush-timeout "attempt" — session-plan, a rotate into
 *  session 1 at frame 5 (only on the FIRST attempt, matching how a resumed
 *  run that makes zero further progress behaves), then the hang. Mirrors
 *  `boundedRerenderWiring.test.ts`'s own bound-exhaustion test. */
async function emitHangingAttempt(fake: FakeWorker, isFirst: boolean): Promise<void> {
  fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: EXPECTED_FRAMES });
  if (isFirst) {
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

describe('Rung 5a (hardware->software failover) — wired at exportProjectWebCodecs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rewinds first (same rung) for MAX_BOUNDARY_REWINDS_PER_EXPORT attempts, THEN fails over — never before', async () => {
    const { ffmpeg, truncateAnnexbToOffset } = ffmpegHarness({
      truncateOffsetResult: { pictures: 5, vclNals: 5, bytesRemoved: 0, keptBytes: 30 },
    });

    const { result: r, fake } = await runWithFakeWorker(ffmpeg, async (fake) => {
      // Attempt 0 (initial) + MAX_BOUNDARY_REWINDS_PER_EXPORT same-rung
      // rewinds, all hanging identically — this alone must NOT trigger
      // failover (ordering: rewind budget must be truly exhausted first).
      for (let attempt = 0; attempt <= MAX_BOUNDARY_REWINDS_PER_EXPORT; attempt++) {
        await emitHangingAttempt(fake, attempt === 0);
      }
      // Failover attempt: this is init message #(MAX+2) — let it SUCCEED,
      // proving the software rung is actually usable, not just selected.
      expect(fake.initMessages.length).toBe(MAX_BOUNDARY_REWINDS_PER_EXPORT + 2);
      fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: EXPECTED_FRAMES });
      fake.emit(chunkMsg(9, 12));
      fake.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
      fake.emit({ type: 'done', frameCount: EXPECTED_FRAMES, diagnostics: diagnostics() });
    });

    expect(r.ok).toBe(true);

    // Exactly MAX_BOUNDARY_REWINDS_PER_EXPORT same-rung rewinds, THEN
    // exactly one MORE truncate for the failover attempt — never fewer
    // (premature failover) and never more (unbounded escalation).
    expect(truncateAnnexbToOffset).toHaveBeenCalledTimes(MAX_BOUNDARY_REWINDS_PER_EXPORT + 1);

    // The ordering proof: every init message up to and including the
    // MAX_BOUNDARY_REWINDS_PER_EXPORT-th rewind carries no
    // forceSoftwareEncoder; only the LAST one does.
    const flags = fake.initMessages.map((m) => m.forceSoftwareEncoder ?? false);
    expect(flags.slice(0, MAX_BOUNDARY_REWINDS_PER_EXPORT + 1)).toEqual(
      new Array(MAX_BOUNDARY_REWINDS_PER_EXPORT + 1).fill(false),
    );
    expect(flags[MAX_BOUNDARY_REWINDS_PER_EXPORT + 1]).toBe(true);
  });

  it('total worst-case attempt bound: rewinds AND the failover attempt all hang -> hard abort, exactly MAX+2 attempts, never MAX+3', async () => {
    const { ffmpeg, truncateAnnexbToOffset } = ffmpegHarness({
      truncateOffsetResult: { pictures: 5, vclNals: 5, bytesRemoved: 0, keptBytes: 30 },
    });

    const { result: r, fake } = await runWithFakeWorker(ffmpeg, async (fake) => {
      // Initial attempt + MAX rewinds + 1 failover attempt, ALL hanging.
      for (let attempt = 0; attempt <= MAX_BOUNDARY_REWINDS_PER_EXPORT + 1; attempt++) {
        await emitHangingAttempt(fake, attempt === 0);
      }
    });

    expect(r.ok).toBe(false);
    // Proves the bound: 1 initial + MAX_BOUNDARY_REWINDS_PER_EXPORT same-rung
    // rewinds + 1 software failover retry = MAX+2 total driveGlRun attempts,
    // MAX+1 total truncate calls (the initial attempt never truncates).
    expect(fake.initMessages.length).toBe(MAX_BOUNDARY_REWINDS_PER_EXPORT + 2);
    expect(truncateAnnexbToOffset).toHaveBeenCalledTimes(MAX_BOUNDARY_REWINDS_PER_EXPORT + 1);
    // Destructive-probe assertion: emitting a THIRD post-failover hanging
    // attempt (already included in the loop above via the +1) still
    // produced no further init message — the one-shot flag, not a silently
    // reusable counter, is what stopped it.
  });

  /**
   * WS3 STEP 9 (C7) — the "two sources of truth" question the round has to
   * answer: does the CROSS-PROCESS ceiling (`totalRecoveryAttempts` on the
   * manifest, checked once by discovery BEFORE a resumed process starts)
   * actually bound the IN-PROCESS rewind budget (`boundaryRewindsUsed`,
   * checked by `decideBoundedRerenderDisposition` on every hang WITHIN a
   * process) once that process is running? Before this round it did not:
   * `boundaryRewindsUsed` started at a hardcoded 0 every fresh process
   * regardless of `options.resume`, so a resumed run always got a brand
   * new MAX_BOUNDARY_REWINDS_PER_EXPORT budget on top of whatever the
   * crashed process already spent. This test's manifest already shows the
   * rewind budget fully spent (`boundaryRewindsUsed: MAX`); the FIRST hang
   * in the resumed process must therefore go straight to the failover
   * attempt (one truncate, one forced-software init message) — never a
   * fresh rewind first.
   */
  it('a resumed run seeds its in-process rewind budget from resume.manifest — no fresh MAX_BOUNDARY_REWINDS_PER_EXPORT on top of what the crashed process already spent', async () => {
    const { ffmpeg, truncateAnnexbToOffset } = ffmpegHarness({
      truncateOffsetResult: { pictures: 5, vclNals: 5, bytesRemoved: 0, keptBytes: 30 },
    });
    const resumeManifest = {
      schemaVersion: 1 as const,
      sessionId: 'irrelevant-for-this-probe',
      projectId: 'p',
      sourceTimelineHash: 'a'.repeat(64),
      fps: 30, width: 1920, height: 1080,
      checkpoints: [],
      // Already fully spent BEFORE the crash — the exact scenario write #2
      // (STEP 8/9) persists.
      boundaryRewindsUsed: MAX_BOUNDARY_REWINDS_PER_EXPORT,
      hardwareFailoverUsed: false,
      checkpointResumeAttempts: 1,
      totalRecoveryAttempts: MAX_BOUNDARY_REWINDS_PER_EXPORT + 1,
    };

    const fake = new FakeWorker();
    const resultPromise = exportProjectWebCodecs(
      project(),
      ffmpeg,
      {
        width: 1920, height: 1080, fps: 30,
        resume: {
          pieceIndex: 0,
          encoderSessionIndex: 1,
          byteOffset: 30,
          cumulativePictures: 5,
          manifest: resumeManifest,
        },
      },
      () => undefined,
      { createWorker: () => fake },
    );
    await Promise.resolve();
    await Promise.resolve();

    // The FIRST hang in this resumed process. Without STEP 9's seeding fix,
    // `decideBoundedRerenderDisposition` would see a fresh in-memory 0 here
    // and attempt a rewind (no failover, no forced-software init message) —
    // this assertion is what would go RED without the fix.
    await emitHangingAttempt(fake, true);
    fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: EXPECTED_FRAMES });
    fake.emit(chunkMsg(9, 12));
    fake.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
    fake.emit({ type: 'done', frameCount: EXPECTED_FRAMES, diagnostics: diagnostics() });
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    // Exactly 2 init messages: the initial resumed attempt + the ONE
    // failover attempt — no intermediate rewind attempt fits between them.
    expect(fake.initMessages.length).toBe(2);
    const flags = fake.initMessages.map((m) => m.forceSoftwareEncoder ?? false);
    expect(flags).toEqual([false, true]);
    // Exactly one truncate — the failover's own rewind-to-boundary cut, not
    // a spurious extra rewind truncate first.
    expect(truncateAnnexbToOffset).toHaveBeenCalledTimes(1);
  });

  it('OUTPUT NEUTRALITY (full bytes, not a metadata hash): a clean run appends exactly the chunk bytes, in order, with no forceSoftwareEncoder anywhere', async () => {
    const { ffmpeg, truncateAnnexbToOffset, landed } = ffmpegHarness();
    const appendedBuffers: Uint8Array[] = [];
    (ffmpeg.appendFileRaw as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (path: string, bytes: Uint8Array) => {
        appendedBuffers.push(new Uint8Array(bytes));
        landed.set(path, (landed.get(path) ?? 0) + bytes.byteLength);
      },
    );
    const { result: r, fake } = await runWithFakeWorker(ffmpeg, (fk) => {
      fk.emit(chunkMsg(0, 3));
      fk.emit(chunkMsg(1, 5));
      fk.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
      fk.emit({ type: 'done', frameCount: EXPECTED_FRAMES, diagnostics: diagnostics() });
    });
    expect(r.ok).toBe(true);
    expect(fake.initMessages.length).toBe(1);
    expect(fake.initMessages[0]!.forceSoftwareEncoder).toBeUndefined();
    expect(truncateAnnexbToOffset).not.toHaveBeenCalled();
    // Full bytes, concatenated in append order — the two chunks this run
    // emitted (chunkMsg stamps byte 0 with the chunk index), nothing more,
    // nothing rewritten, no extra IDR, no failover-only marker bytes.
    const concatenated = Buffer.concat(appendedBuffers.map((b) => Buffer.from(b)));
    const expected = Buffer.concat([chunkMsg(0, 3).bytes, chunkMsg(1, 5).bytes].map((b) => Buffer.from(b)));
    expect(concatenated.equals(expected)).toBe(true);
  });
});
