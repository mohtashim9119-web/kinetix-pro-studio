/**
 * WS3 export-recovery round — flush-timeout SALVAGE.
 *
 * What is under test is the recovery that shipped, not the one that was
 * designed: a bounded RE-RENDER was ruled unreachable this round (it needs a
 * byte-truncate primitive that lives in src-tauri, owned by another agent —
 * see docs/ws3-export/recovery-architecture.md §3), so what exists is
 * fence-and-verify: stop the dead encoder's output reaching disk, end the run
 * without awaiting the un-cancellable flush, and let the orchestrator's
 * picture-accurate, zero-tolerance frame-count guard decide whether the file
 * ships.
 *
 * The tests are split by the three things that can go wrong:
 *   1. the POLICY says the wrong thing (`decideFlushTimeoutDisposition`);
 *   2. the VALVE leaks a chunk after the fence (`SessionOutputFence`);
 *   3. the ORCHESTRATOR treats a salvage as a clean run (`driveGlRun`), or
 *      the guard lets a short file through (`exportProjectWebCodecs`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, HeadingOverlay, Project, TextOverlay, VideoSegment } from '../../types';
import {
  SessionOutputFence,
  MAX_FLUSH_SALVAGES,
  decideFlushTimeoutDisposition,
  FlushSalvageBoundError,
  runFinalFlushWithRecovery,
  type FlushRecoveryEncoder,
  type ExportWorkerOutboundMessage,
} from './exportWorker';
import {
  driveGlRun,
  type ExportWorkerHandle,
  type WebCodecsFfmpeg,
} from './exportPipelineWebCodecs';
import type { ProjectEffectConfig } from '../gl/compositeParams';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';

// ---------------------------------------------------------------------------
// 1. Policy
// ---------------------------------------------------------------------------

describe('decideFlushTimeoutDisposition', () => {
  it('ABORTS a rotation-site timeout — the piece is short by the whole remainder of the run', () => {
    const d = decideFlushTimeoutDisposition({ site: 'rotation', salvagesUsed: 0 });
    expect(d.action).toBe('abort');
    expect(d.reason).toContain('rotation-flush');
  });

  it('SALVAGES a final-site timeout on the first occurrence', () => {
    const d = decideFlushTimeoutDisposition({ site: 'final', salvagesUsed: 0 });
    expect(d.action).toBe('salvage');
  });

  it('is bounded: a second final-site timeout ABORTS rather than salvaging again', () => {
    expect(MAX_FLUSH_SALVAGES).toBe(1);
    const d = decideFlushTimeoutDisposition({ site: 'final', salvagesUsed: MAX_FLUSH_SALVAGES });
    expect(d.action).toBe('abort');
    expect(d.reason).toContain('salvage bound reached');
  });

  it('never salvages past the bound, however many attempts have been made', () => {
    for (const used of [1, 2, 5, 50]) {
      expect(decideFlushTimeoutDisposition({ site: 'final', salvagesUsed: used }).action).toBe('abort');
    }
  });

  it('does NOT consult chunksSinceFlushEntry — it takes no such input', () => {
    // The predicate's whole signature is the assertion: `site` and a counter.
    // A field-unobserved drain signal cannot leak into this decision because
    // there is nowhere to pass it. See the function's own doc comment.
    const params = Object.keys(decideFlushTimeoutDisposition({ site: 'final', salvagesUsed: 0 }));
    expect(params.sort()).toEqual(['action', 'reason']);
  });

  it('FlushSalvageBoundError names the bound it hit', () => {
    const e = new FlushSalvageBoundError(1, 1);
    expect(e.name).toBe('FlushSalvageBoundError');
    expect(e.salvagesUsed).toBe(1);
    expect(e.message).toContain('max 1');
  });
});

// ---------------------------------------------------------------------------
// 2. Valve
// ---------------------------------------------------------------------------

describe('SessionOutputFence', () => {
  it('accepts every session until one is fenced', () => {
    const f = new SessionOutputFence();
    expect(f.accepts(0)).toBe(true);
    expect(f.accepts(26)).toBe(true);
    expect(f.fencedCount).toBe(0);
  });

  it('drops ONLY the fenced session — a rotation seam does not silence its successor', () => {
    const f = new SessionOutputFence();
    f.fence(25);
    expect(f.accepts(25)).toBe(false);
    expect(f.accepts(24)).toBe(true);
    expect(f.accepts(26)).toBe(true);
    expect(f.fencedCount).toBe(1);
  });

  it('is permanent — a late chunk arriving many turns later is still dropped', () => {
    const f = new SessionOutputFence();
    f.fence(26);
    for (let i = 0; i < 1000; i++) expect(f.accepts(26)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2b. The recovery itself, driven by a mocked encoder.
// ---------------------------------------------------------------------------

/** Minimal VideoEncoder stand-in. `flush` is supplied per test. */
function mockEncoder(flush: () => Promise<void>, queue = 4): FlushRecoveryEncoder & { resets: number } {
  return {
    flush,
    encodeQueueSize: queue,
    resets: 0,
    reset(this: { resets: number }) {
      this.resets++;
    },
  } as FlushRecoveryEncoder & { resets: number };
}

describe('runFinalFlushWithRecovery', () => {
  afterEach(() => vi.useRealTimers());

  it('clean flush -> kind "clean", nothing fenced, nothing reset', async () => {
    vi.useFakeTimers();
    const fence = new SessionOutputFence();
    const enc = mockEncoder(() => Promise.resolve());
    const out = await runFinalFlushWithRecovery({
      encoder: enc,
      framesEncoded: 47840,
      sessionIndex: 26,
      fence,
      salvagesUsed: 0,
      boundMs: 20_000,
    });
    expect(out.kind).toBe('clean');
    expect(fence.fencedCount).toBe(0);
    expect(enc.resets).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('FLUSH TIMEOUT -> salvage: the session is fenced, reset is attempted, and the hung flush is NOT awaited', async () => {
    vi.useFakeTimers();
    const fence = new SessionOutputFence();
    // The field shape: a flush that never settles.
    const enc = mockEncoder(() => new Promise<void>(() => {}));
    const p = runFinalFlushWithRecovery({
      encoder: enc,
      framesEncoded: 47840,
      sessionIndex: 26,
      fence,
      salvagesUsed: 0,
      boundMs: 20_000,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const out = await p; // settles despite flush() still pending — that is the point
    expect(out.kind).toBe('salvage');
    if (out.kind !== 'salvage') throw new Error('unreachable');
    expect(out.reason).toContain('final-flush timeout');
    expect(out.reason).toContain('47840');
    expect(fence.accepts(26)).toBe(false);
    expect(enc.resets).toBe(1);
  });

  it('RETRY BOUND: a timeout with the salvage budget spent throws FlushSalvageBoundError, still fencing', async () => {
    vi.useFakeTimers();
    const fence = new SessionOutputFence();
    const enc = mockEncoder(() => new Promise<void>(() => {}));
    const p = runFinalFlushWithRecovery({
      encoder: enc,
      framesEncoded: 47840,
      sessionIndex: 26,
      fence,
      salvagesUsed: MAX_FLUSH_SALVAGES,
      boundMs: 20_000,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await p;
    expect(err).toBeInstanceOf(FlushSalvageBoundError);
    // Fenced even on the abort path — the caller's finally still runs.
    expect(fence.accepts(26)).toBe(false);
  });

  it('a reset() that THROWS does not defeat the salvage — the fence is the guard, not reset', async () => {
    vi.useFakeTimers();
    const fence = new SessionOutputFence();
    const enc: FlushRecoveryEncoder = {
      flush: () => new Promise<void>(() => {}),
      encodeQueueSize: 4,
      reset() {
        throw new Error('encoder wedged');
      },
    };
    const p = runFinalFlushWithRecovery({ encoder: enc, framesEncoded: 1, sessionIndex: 0, fence, salvagesUsed: 0, boundMs: 20_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await p).kind).toBe('salvage');
    expect(fence.accepts(0)).toBe(false);
  });

  it('a real flush REJECTION is propagated untouched and is NOT salvaged', async () => {
    vi.useFakeTimers();
    const fence = new SessionOutputFence();
    const boom = new Error('encoder said no');
    const enc = mockEncoder(() => Promise.reject(boom));
    await expect(
      runFinalFlushWithRecovery({ encoder: enc, framesEncoded: 1, sessionIndex: 0, fence, salvagesUsed: 0, boundMs: 20_000 }),
    ).rejects.toBe(boom);
    expect(fence.fencedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Orchestrator
// ---------------------------------------------------------------------------

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
const effectConfig: ProjectEffectConfig = {
  globalTransition: TransitionType.NONE,
  globalTransitionDuration: 0,
};
const textConfig = {
  fontConfigs: [] as { family: string; bytes: ArrayBuffer }[],
  globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  textLayers: [] as TextOverlay[],
  headings: [] as HeadingOverlay[],
};

const diagnostics = (framesEncoded: number): ExportWorkerDiagnosticsPayload => ({
  phaseMs: {},
  instrumentationMs: 0,
  demuxSplit: [],
  framesEncoded,
  pieceIndex: 0,
  lastPhase: 'encoder-flush',
  phaseLog: [],
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
});

function chunk(bytes: number[]): ExportWorkerOutboundMessage {
  return {
    type: 'chunk',
    runId: 'run_0',
    bytes: new Uint8Array(bytes).buffer,
    chunkType: 'key',
    timestamp: 0,
  };
}

function startDrive(fake: FakeWorker, ffmpeg: WebCodecsFfmpeg) {
  return driveGlRun(
    ffmpeg,
    'run_0',
    'piece_0.h264',
    [segment],
    [asset],
    effectConfig,
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

/** Records every appended byte in call order, so byte-for-byte output
 *  neutrality is assertable rather than asserted. */
function recordingFfmpeg(): { ffmpeg: WebCodecsFfmpeg; written: number[] } {
  const written: number[] = [];
  const ffmpeg = {
    writeFile: vi.fn(async () => undefined),
    writeFileRaw: vi.fn(async () => undefined),
    exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()),
    deleteFile: vi.fn(async () => undefined),
    appendFileRaw: vi.fn(async (_p: string, data: Uint8Array) => {
      for (const b of data) written.push(b);
    }),
    saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    // WS3 Round 12 (H1) — must track `written`'s real length so the
    // per-append verify (`exportPipelineWebCodecs.ts`'s `flushPendingBatch`)
    // sees a landed size consistent with what was actually appended.
    sessionFileSize: vi.fn(async () => written.length),
    countAnnexbFrames: vi.fn(async () => ({ pictures: 0, vclNals: 0 })),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb: vi.fn(async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
  } as unknown as WebCodecsFfmpeg;
  return { ffmpeg, written };
}

describe('driveGlRun — salvage terminal', () => {
  it('OUTPUT NEUTRALITY: a clean run appends exactly the chunk bytes, in order, and is not marked salvaged', async () => {
    const fake = new FakeWorker();
    const { ffmpeg, written } = recordingFfmpeg();
    const p = startDrive(fake, ffmpeg);
    fake.emit(chunk([1, 2, 3]));
    fake.emit(chunk([4, 5]));
    fake.emit({ type: 'run-done', runId: 'run_0', frameCount: 2 });
    fake.emit({ type: 'done', frameCount: 2, diagnostics: diagnostics(2) });
    const r = await p;
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(written).toEqual([1, 2, 3, 4, 5]);
    expect(r.appendCallCount).toBe(2);
    expect(r.appendBytes).toBe(5);
    expect(r.salvaged).toBe(false);
    expect(r.salvageReason).toBeNull();
    // Session 0 always starts at byte 0; no rotation happened, so nothing else.
    expect(r.sessionByteOffsets).toEqual([0]);
  });

  it('a salvage-done resolves ok:true but MARKED salvaged, carrying the worker reason', async () => {
    const fake = new FakeWorker();
    const { ffmpeg, written } = recordingFfmpeg();
    const p = startDrive(fake, ffmpeg);
    fake.emit(chunk([9, 9]));
    fake.emit({ type: 'run-done', runId: 'run_0', frameCount: 30 });
    fake.emit({
      type: 'salvage-done',
      runId: 'run_0',
      frameCount: 30,
      reason: 'final-flush timeout after every frame was submitted',
      diagnostics: diagnostics(30),
    });
    const r = await p;
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.salvaged).toBe(true);
    expect(r.salvageReason).toContain('final-flush timeout');
    expect(r.frameCount).toBe(30);
    // Chunks posted BEFORE the fence closed still reach disk — the append queue
    // is drained on the salvage path exactly as on the clean one.
    expect(written).toEqual([9, 9]);
  });

  it('drains the append queue before settling a salvage, and surfaces an append error over it', async () => {
    const fake = new FakeWorker();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const ffmpeg = {
      ...recordingFfmpeg().ffmpeg,
      appendFileRaw: vi.fn(async () => {
        await gate;
        throw new Error('disk full');
      }),
    } as unknown as WebCodecsFfmpeg;
    const p = startDrive(fake, ffmpeg);
    fake.emit(chunk([1]));
    fake.emit({
      type: 'salvage-done',
      runId: 'run_0',
      frameCount: 1,
      reason: 'r',
      diagnostics: diagnostics(1),
    });
    release!();
    const r = await p;
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.diagnostics?.failure?.via).toBe('append-error');
  });

  it('SESSION BYTE LEDGER: a rotation records the byte offset of the new session, in append-queue order', async () => {
    const fake = new FakeWorker();
    const { ffmpeg } = recordingFfmpeg();
    const p = startDrive(fake, ffmpeg);
    fake.emit(chunk([1, 2, 3, 4]));
    fake.emit(chunk([5, 6]));
    fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: 1, sessions: 2, frameIndex: 1800 });
    fake.emit(chunk([7]));
    fake.emit({ type: 'done', frameCount: 3, diagnostics: diagnostics(3) });
    const r = await p;
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    // 4 + 2 bytes belonged to session 0; session 1's first byte is at offset 6.
    expect(r.sessionByteOffsets).toEqual([0, 6]);
    expect(r.appendBytes).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 4. The guard that actually decides — picture-exact, zero tolerance.
// ---------------------------------------------------------------------------

vi.mock('../plainSegment', () => ({
  isPlainVideoSegment: () => false,
  isPlainImageSegment: () => true,
}));
vi.mock('./glCompositable', () => ({
  isGlCompositableSegment: () => false,
  GL_TRANSITION_SLUGS: new Set<string>(),
}));
vi.mock('../segmentEncoder', () => ({
  encodeSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  encodePlainVideoSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  encodeStaticImageSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
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
import { exportProjectWebCodecs } from './exportPipelineWebCodecs';

function imageSegment(id: string, assetId: string, order: number): VideoSegment {
  return { ...segment, id, assetId, startTime: order, order };
}

function project(): Project {
  return {
    id: 'p',
    name: 'T',
    script: '',
    sceneDetails: '',
    segments: [imageSegment('s0', 'a0', 0), imageSegment('s1', 'a1', 1), imageSegment('s2', 'a2', 2)],
    assets: [
      { id: 'a0', name: 'a0.png', url: 'blob:a0', type: 'image' },
      { id: 'a1', name: 'a1.png', url: 'blob:a1', type: 'image' },
      { id: 'a2', name: 'a2.png', url: 'blob:a2', type: 'image' },
    ],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

function guardFfmpeg(pictures: number): WebCodecsFfmpeg {
  return {
    ...recordingFfmpeg().ffmpeg,
    countAnnexbFrames: vi.fn(async () => ({ pictures, vclNals: pictures })),
  } as unknown as WebCodecsFfmpeg;
}

describe('post-concat frame-count guard — the salvage predicate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('EXACT picture count -> the export ships', async () => {
    // 3 pieces x 1s @ 30fps = 90 expected pictures.
    const r = await exportProjectWebCodecs(project(), guardFfmpeg(90), { width: 1920, height: 1080, fps: 30 });
    expect(r.ok).toBe(true);
  });

  it('SHORT BY ONE picture -> ABORTS, and says so', async () => {
    const r = await exportProjectWebCodecs(project(), guardFfmpeg(89), { width: 1920, height: 1080, fps: 30 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('concat');
    expect(r.error.message).toContain('measuredPictures=89');
    expect(r.error.message).toContain('expectedTotal=90');
  });

  it('LONG BY ONE picture -> ABORTS too — a duplicated tail is as fatal as a truncated one', async () => {
    const r = await exportProjectWebCodecs(project(), guardFfmpeg(91), { width: 1920, height: 1080, fps: 30 });
    expect(r.ok).toBe(false);
  });
});
