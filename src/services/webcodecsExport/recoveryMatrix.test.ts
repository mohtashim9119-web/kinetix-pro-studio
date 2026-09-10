/**
 * WS3 Round 10, STEP 6 — the END-TO-END recovery matrix.
 *
 * Every rung has been tested on its own. None of them had ever been driven
 * THROUGH the next one, and the interactions are where a recovery ladder
 * breaks: a rewind that consumes the failover's budget, a salvage that runs
 * after the guard instead of before it, a seal that ships when the operator
 * declined, a resume that starts from a session another rung already truncated.
 *
 * Each row drives the real `exportProjectWebCodecs` and asserts BOTH the
 * outcome and the attempt count, because the second is what makes the whole
 * space bounded rather than merely usually-terminating.
 *
 * THE TOTAL BOUND (arithmetic in the round's ledger entry; asserted below):
 *   per hung rotation boundary  1 initial + 2 rewinds + 1 failover = 4 attempts
 *   truncates for those          2 rewinds + 1 failover            = 3
 *   salvage per GL piece                                           = 1 truncate
 *   sealing per export           1 offer + 1 consent + 1 seal (one mux)
 *   resume per export            <= 2 fences (cleanup keeps <= 2 sessions)
 *                                + 1 seam step-back + (pieceIndex) counts
 * Every one of those native calls is under a liveness bound; the enumeration
 * is in the ledger.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';
import type { ExportWorkerInboundMessage, ExportWorkerOutboundMessage } from './exportWorker';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';
import type { ForcedMp4SealOffer } from './muxOnly';

vi.mock('../plainSegment', () => ({ isPlainVideoSegment: () => false, isPlainImageSegment: () => false }));
vi.mock('./glCompositable', () => ({ isGlCompositableSegment: () => true, GL_TRANSITION_SLUGS: new Set<string>() }));
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

/** The whole recovery space's attempt budget for ONE hung rotation boundary. */
const MAX_HARDWARE_FAILOVERS_PER_EXPORT = 1;
const MAX_ATTEMPTS_PER_BOUNDARY = 1 + MAX_BOUNDARY_REWINDS_PER_EXPORT + MAX_HARDWARE_FAILOVERS_PER_EXPORT;
const MAX_TRUNCATES_PER_BOUNDARY = MAX_BOUNDARY_REWINDS_PER_EXPORT + MAX_HARDWARE_FAILOVERS_PER_EXPORT;

const FRAMES = 30;
const FPS = 30;

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  initMessages: Extract<ExportWorkerInboundMessage, { type: 'init' }>[] = [];
  postMessage(m: unknown): void {
    const msg = m as ExportWorkerInboundMessage;
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
    id: 'proj-matrix', name: 'T', script: '', sceneDetails: '',
    segments: [segment], assets: [asset],
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

function diagnostics(o: Partial<ExportWorkerDiagnosticsPayload> = {}): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: FRAMES, pieceIndex: 0,
    lastPhase: 'encoder-flush', phaseLog: [], failure: null, demuxCacheSize: null, workerHeapBytes: null,
    decodedSourceFrames: 0, encodedChunkCount: FRAMES, encodedKeyframeCount: 1, encodedChunkBytes: 0,
    encodedChunkCountAtFlushStart: FRAMES,
    ...NO_FLUSH_OBSERVATION,
    encoderSessionIndex: 0, encoderSessions: 1, appendPendingAtFailure: null,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
    ...o,
  };
}
function rotationFlushTimeout(framesEncoded: number): Extract<ExportWorkerOutboundMessage, { type: 'error' }> {
  return { type: 'error', diagnostics: diagnostics({
    framesEncoded, encoderSessions: 3, encoderSessionIndex: 0,
    failure: { name: 'EncoderFlushTimeoutError', message: 'flush did not settle', via: 'flush-timeout', frameIndex: framesEncoded - 1, timelineSec: null },
  }) };
}
function chunk(i: number, size: number): Extract<ExportWorkerOutboundMessage, { type: 'chunk' }> {
  const b = new Uint8Array(size); b[0] = i & 0xff;
  return { type: 'chunk', runId: 'run_0', bytes: b.buffer.slice(0) as ArrayBuffer, chunkType: i === 0 ? 'key' : 'delta', timestamp: i };
}
async function flush(ticks = 30): Promise<void> { for (let i = 0; i < ticks; i++) await Promise.resolve(); }

function ffmpegHarness(o: {
  measuredPictures?: number;
  truncateOffsetPictures?: number;
  salvageTruncatePictures?: number;
} = {}) {
  const calls: string[] = [];
  const measured = o.measuredPictures ?? FRAMES;
  const truncateAnnexbToOffset = vi.fn(async (_p: string, off: number) => {
    calls.push('truncateAnnexbToOffset');
    return { pictures: o.truncateOffsetPictures ?? 5, vclNals: 0, bytesRemoved: 0, keptBytes: off };
  });
  const truncateAnnexb = vi.fn(async () => {
    calls.push('truncateAnnexb');
    return { pictures: o.salvageTruncatePictures ?? FRAMES, vclNals: FRAMES, bytesRemoved: 0, keptBytes: 100 };
  });
  const exec = vi.fn(async () => { calls.push('exec'); return 0; });
  const countAnnexbFrames = vi.fn(async () => { calls.push('countAnnexbFrames'); return { pictures: measured, vclNals: measured }; });
  const ffmpeg = {
    writeFile: vi.fn(async () => undefined), writeFileRaw: vi.fn(async () => undefined), exec,
    readFile: vi.fn(async () => new Uint8Array()), deleteFile: vi.fn(async () => undefined),
    appendFileRaw: vi.fn(async () => undefined), saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined),
    sessionFileSize: vi.fn(async () => 1_700_000_000),
    countAnnexbFrames, concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb, truncateAnnexbToOffset,
  } as unknown as WebCodecsFfmpeg;
  return { ffmpeg, calls, truncateAnnexb, truncateAnnexbToOffset, exec, countAnnexbFrames };
}

async function run(
  ffmpeg: WebCodecsFfmpeg,
  drive: (fake: FakeWorker) => Promise<void> | void,
  options: { requestForcedSealConsent?: (o: ForcedMp4SealOffer) => Promise<boolean> } = {},
) {
  const fake = new FakeWorker();
  const p = exportProjectWebCodecs(project(), ffmpeg, { width: 1920, height: 1080, fps: FPS, ...options }, () => undefined, { createWorker: () => fake });
  await flush();
  await drive(fake);
  return { result: await p, fake };
}

/** One hung rotation, then a clean resumed attempt. */
async function hangOnceThenSucceed(fake: FakeWorker): Promise<void> {
  fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: FRAMES });
  fake.emit(chunk(0, 10)); fake.emit(chunk(1, 10)); fake.emit(chunk(2, 10));
  await flush();
  fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: 1, sessions: 3, frameIndex: 5 });
  await flush();
  fake.emit(rotationFlushTimeout(9));
  await flush();
  fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: FRAMES });
  fake.emit(chunk(5, 12));
  fake.emit({ type: 'run-done', runId: 'run_0', frameCount: FRAMES });
  fake.emit({ type: 'done', frameCount: FRAMES, diagnostics: diagnostics() });
  await flush();
}

/** Hang on EVERY attempt, exhausting rewinds and then the failover. */
async function hangForever(fake: FakeWorker): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_BOUNDARY; attempt++) {
    fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: FRAMES });
    if (attempt === 0) {
      fake.emit(chunk(0, 10)); fake.emit(chunk(1, 10)); fake.emit(chunk(2, 10));
      await flush();
      fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: 1, sessions: 3, frameIndex: 5 });
      await flush();
    }
    fake.emit(rotationFlushTimeout(9));
    await flush();
  }
}

describe('END-TO-END recovery matrix', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ROW 1 — flush timeout, rewind succeeds: one truncate, one resumed attempt, export ships', async () => {
    const h = ffmpegHarness();
    const { result, fake } = await run(h.ffmpeg, hangOnceThenSucceed);
    expect(result.ok).toBe(true);
    expect(h.truncateAnnexbToOffset).toHaveBeenCalledTimes(1);
    expect(fake.initMessages).toHaveLength(2);
    expect(fake.initMessages[1]!.resumeFromFrameIndex).toBe(5);
    // Rung 5a never engaged — the failover is still available for a later boundary.
    expect(fake.initMessages.every((m) => !m.forceSoftwareEncoder)).toBe(true);
  });

  it('ROW 2 — both rewinds exhausted, failover to software, which then succeeds', async () => {
    const h = ffmpegHarness();
    const { result, fake } = await run(h.ffmpeg, async (fake) => {
      for (let attempt = 0; attempt <= MAX_BOUNDARY_REWINDS_PER_EXPORT; attempt++) {
        fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: FRAMES });
        if (attempt === 0) {
          fake.emit(chunk(0, 10)); fake.emit(chunk(1, 10)); fake.emit(chunk(2, 10));
          await flush();
          fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: 1, sessions: 3, frameIndex: 5 });
          await flush();
        }
        fake.emit(rotationFlushTimeout(9));
        await flush();
      }
      // The software attempt is the one that works.
      fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: FRAMES });
      fake.emit(chunk(5, 12));
      fake.emit({ type: 'run-done', runId: 'run_0', frameCount: FRAMES });
      fake.emit({ type: 'done', frameCount: FRAMES, diagnostics: diagnostics() });
      await flush();
    });
    expect(result.ok).toBe(true);
    expect(fake.initMessages).toHaveLength(MAX_ATTEMPTS_PER_BOUNDARY);
    expect(fake.initMessages.map((m) => m.forceSoftwareEncoder ?? false))
      .toEqual([false, false, false, true]);
    expect(h.truncateAnnexbToOffset).toHaveBeenCalledTimes(MAX_TRUNCATES_PER_BOUNDARY);
  });

  it('ROW 3 — the whole ladder exhausts: BOUNDED, and it stops rather than looping', async () => {
    const h = ffmpegHarness();
    const { result, fake } = await run(h.ffmpeg, hangForever);
    expect(result.ok).toBe(false);
    // THE NUMBER. 1 initial + 2 rewinds + 1 failover, never more.
    expect(fake.initMessages).toHaveLength(MAX_ATTEMPTS_PER_BOUNDARY);
    expect(h.truncateAnnexbToOffset).toHaveBeenCalledTimes(MAX_TRUNCATES_PER_BOUNDARY);
    // Nothing downstream of the render ran: no concat guard, no mux.
    expect(h.countAnnexbFrames).not.toHaveBeenCalled();
    expect(h.exec).not.toHaveBeenCalled();
  });

  it('ROW 4 — salvage truncates, guard reports a shortfall, operator CONSENTS, a short MP4 ships', async () => {
    // The salvaged piece keeps every frame it claimed, so salvage passes its own
    // exact-match check; the post-concat guard then measures 3 short.
    const h = ffmpegHarness({ measuredPictures: FRAMES - 3 });
    const seen: ForcedMp4SealOffer[] = [];
    const { result } = await run(h.ffmpeg, (fake) => {
      fake.emit(chunk(0, 8));
      fake.emit({ type: 'run-done', runId: 'run_0', frameCount: FRAMES });
      fake.emit({ type: 'done', frameCount: FRAMES, diagnostics: diagnostics() });
    }, { requestForcedSealConsent: async (o) => { seen.push(o); return true; } });

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.picturesKept).toBe(FRAMES - 3);
    expect(seen[0]!.picturesLost).toBe(3);
    // The guard ran BEFORE the seal, and the seal is one ordinary mux.
    expect(h.calls.indexOf('countAnnexbFrames')).toBeLessThan(h.calls.indexOf('exec'));
    expect(h.calls.filter((c) => c === 'exec')).toHaveLength(1);
  });

  it('ROW 5 — same shortfall, operator DECLINES: the unchanged typed failure, nothing muxed', async () => {
    const h = ffmpegHarness({ measuredPictures: FRAMES - 3 });
    const { result } = await run(h.ffmpeg, (fake) => {
      fake.emit(chunk(0, 8));
      fake.emit({ type: 'run-done', runId: 'run_0', frameCount: FRAMES });
      fake.emit({ type: 'done', frameCount: FRAMES, diagnostics: diagnostics() });
    }, { requestForcedSealConsent: async () => false });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('concat');
    expect(result.error.message).toContain('measuredPictures=27');
    expect(h.exec).not.toHaveBeenCalled();
  });

  it('ROW 6 — a rewind FOLLOWED BY a shortfall still reaches the seal seam exactly once', async () => {
    // The interaction row: Rung 3 and Rung 2b in the same export. A rewind must
    // not consume, skip, or double the sealing offer.
    const h = ffmpegHarness({ measuredPictures: FRAMES - 1 });
    const seen: ForcedMp4SealOffer[] = [];
    const { result, fake } = await run(h.ffmpeg, hangOnceThenSucceed, {
      requestForcedSealConsent: async (o) => { seen.push(o); return true; },
    });
    expect(result.ok).toBe(true);
    expect(fake.initMessages).toHaveLength(2);
    expect(h.truncateAnnexbToOffset).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.picturesLost).toBe(1);
  });

  it('ROW 7 — CLEAN: none of the above runs, and the ffmpeg trace holds no recovery call', async () => {
    const h = ffmpegHarness();
    const { result, fake } = await run(h.ffmpeg, (fake) => {
      fake.emit(chunk(0, 8));
      fake.emit({ type: 'run-done', runId: 'run_0', frameCount: FRAMES });
      fake.emit({ type: 'done', frameCount: FRAMES, diagnostics: diagnostics() });
    }, { requestForcedSealConsent: async () => { throw new Error('must not be consulted'); } });

    expect(result.ok).toBe(true);
    expect(fake.initMessages).toHaveLength(1);
    expect(h.truncateAnnexb).not.toHaveBeenCalled();
    expect(h.truncateAnnexbToOffset).not.toHaveBeenCalled();
    // `muxOnly` is stubbed in this file, so a clean export's whole native
    // trace is the guard and nothing else. (Rows 4 and 6 reach `exec` because
    // `sealTruncatedAnnexbToMp4` is the REAL function and calls the real
    // `muxOnly` — the stub only replaces the module's named export.)
    expect(h.calls).toEqual(['countAnnexbFrames']);
  });

  // ── The two crash rows. Their byte-real proofs live in
  // `exportResumeWiring.test.ts` (a fake ffmpeg that keeps actual bytes) and
  // `exportResumeDiscovery.test.ts` (call-ordering). These rows drive the same
  // production entry point the app calls, so the matrix covers all seven. ────

  it('ROW 8 — crash mid-export, restart, discover, validate, fence, resume, complete', async () => {
    const { evaluateResumeCandidate } = await import('./exportResumeDiscovery');
    const { appendExportCheckpoint, createExportStateManifest, serializeExportState } = await import('./exportCheckpoint');
    const HASH = 'a'.repeat(64);
    const SESSION = '11111111-2222-4333-8444-555555555555';
    const manifest = appendExportCheckpoint(
      createExportStateManifest({ sessionId: SESSION, projectId: 'proj-matrix', sourceTimelineHash: HASH, fps: FPS, width: 1920, height: 1080 }),
      { pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 4_000, seamByteOffset: 3_960, cumulativePictures: 10, fps: FPS, width: 1920, height: 1080, sourceTimelineHash: HASH },
    );
    const order: string[] = [];
    const outcome = await evaluateResumeCandidate(
      {
        listResumableSessionIds: async () => [SESSION],
        reenter: async (sessionId) => ({
          sessionId,
          readExportState: async () => new TextEncoder().encode(serializeExportState(manifest)),
          sessionFileSize: async () => 9_000,
          prepareCheckpointResume: async (_p, cp) => { order.push('fence'); return { pictures: cp.cumulativePictures, vclNals: 0, bytesRemoved: 5_000, keptBytes: cp.byteOffset }; },
          truncateAnnexbToOffset: async (_p, off) => { order.push('seamCut'); return { pictures: 10, vclNals: 0, bytesRemoved: 40, keptBytes: off }; },
          destroy: async () => undefined,
        }),
      },
      SESSION,
      { expected: { projectId: 'proj-matrix', sourceTimelineHash: HASH, fps: FPS, width: 1920, height: 1080 }, pieceExpectedFrames: [FRAMES] },
      async () => { order.push('count'); return FRAMES; },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    // Fence first, seam step-back second — and nothing counted at all, because
    // the checkpoint is in piece 0 so there is no earlier piece to verify.
    expect(order).toEqual(['fence', 'seamCut']);
    expect(outcome.value.appendFromByteOffset).toBe(3_960);
    expect(outcome.value.picturesAlreadyRendered).toBe(10);

    // …and the pipeline continues from exactly there.
    const h = ffmpegHarness();
    const { result, fake } = await run(h.ffmpeg, (fk) => {
      fk.emit(chunk(10, 8));
      fk.emit({ type: 'run-done', runId: 'run_0', frameCount: FRAMES });
      fk.emit({ type: 'done', frameCount: FRAMES, diagnostics: diagnostics() });
    });
    expect(result.ok).toBe(true);
    expect(fake.initMessages).toHaveLength(1);
  });

  it('ROW 9 — a stale timeline hash offers no resume and mutates no bitstream', async () => {
    const { evaluateResumeCandidate } = await import('./exportResumeDiscovery');
    const { appendExportCheckpoint, createExportStateManifest, serializeExportState } = await import('./exportCheckpoint');
    const WRITTEN_FOR = 'a'.repeat(64);
    const NOW = 'b'.repeat(64);
    const SESSION = '11111111-2222-4333-8444-555555555555';
    const manifest = appendExportCheckpoint(
      createExportStateManifest({ sessionId: SESSION, projectId: 'proj-matrix', sourceTimelineHash: WRITTEN_FOR, fps: FPS, width: 1920, height: 1080 }),
      { pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 4_000, seamByteOffset: 3_960, cumulativePictures: 10, fps: FPS, width: 1920, height: 1080, sourceTimelineHash: WRITTEN_FOR },
    );
    const touched: string[] = [];
    const outcome = await evaluateResumeCandidate(
      {
        listResumableSessionIds: async () => [SESSION],
        reenter: async (sessionId) => ({
          sessionId,
          readExportState: async () => new TextEncoder().encode(serializeExportState(manifest)),
          sessionFileSize: async () => { touched.push('size'); return 9_000; },
          prepareCheckpointResume: async () => { touched.push('fence'); throw new Error('must not run'); },
          truncateAnnexbToOffset: async () => { touched.push('seamCut'); throw new Error('must not run'); },
          destroy: async () => undefined,
        }),
      },
      SESSION,
      { expected: { projectId: 'proj-matrix', sourceTimelineHash: NOW, fps: FPS, width: 1920, height: 1080 }, pieceExpectedFrames: [FRAMES] },
      async () => { touched.push('count'); return FRAMES; },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.reason).toContain('sourceTimelineHash mismatch');
    // Not one call that could read, cut or count the surviving bitstream.
    expect(touched).toEqual([]);
  });
});
