/**
 * The per-piece completion guard — detect, record, disclose, continue.
 *
 * Every finished piece is counted with the existing counter and compared with
 * the plan's exact count for it. A mismatch is RECORDED in the manifest
 * (`pieceDeviations`) and DISCLOSED in the existing Round 10 seal offer; the run
 * keeps rendering and never dead-ends at the bad piece. Field evidence: session
 * 88f86aa5 — pieces 2 and 4 finished one picture short and were recorded
 * complete with nothing said.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';
import type { ExportWorkerInboundMessage, ExportWorkerOutboundMessage } from './exportWorker';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';
import { muxOnly, type ForcedMp4SealOffer } from './muxOnly';

vi.mock('../plainSegment', () => ({ isPlainVideoSegment: () => false, isPlainImageSegment: () => false }));
vi.mock('./glCompositable', () => ({ isGlCompositableSegment: () => true, GL_TRANSITION_SLUGS: new Set<string>() }));
vi.mock('./muxOnly', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./muxOnly')>()),
  muxOnly: vi.fn(async () => undefined),
}));

// eslint-disable-next-line import/first
import { exportProjectWebCodecs, type ExportWorkerHandle, type WebCodecsFfmpeg } from './exportPipelineWebCodecs';
import { discoverResumableExport, type ResumeDiscoveryIo, type ResumeSessionHandle } from './exportResumeDiscovery';
import { buildSourceTimelineHash, timelineIdentityFromProject } from './exportCheckpoint';

const FPS = 30;
const SESSION = '11111111-2222-4333-8444-555555555555';

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  postMessage(m: unknown): void { void (m as ExportWorkerInboundMessage); }
  terminate(): void { /* no-op */ }
  emit(data: ExportWorkerOutboundMessage): void { this.onmessage?.({ data } as MessageEvent<ExportWorkerOutboundMessage>); }
}

const asset: Asset = { id: 'a0', name: 'a0.mp4', url: 'blob:a0', type: 'video' };
function seg(i: number, startTime: number, duration: number): VideoSegment {
  return { id: `s${i}`, text: '', assetId: 'a0', startTime, duration, transition: TransitionType.NONE, animation: AnimationType.NONE, order: i };
}
/** Two 61 s segments → two GL pieces of 1830 frames each (the 1800 cap cuts at the hard cut). */
const TWO_PIECES = { segments: [seg(0, 0, 61), seg(1, 61, 61)], expected: [1830, 1830] };
const ONE_PIECE = { segments: [seg(0, 0, 1)], expected: [30] };

function project(shape: { segments: VideoSegment[] }): Project {
  return {
    id: 'proj-guard', name: 'T', script: '', sceneDetails: '',
    segments: shape.segments, assets: [asset],
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0, globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

function diagnostics(frames: number, pieceIndex: number): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: frames, pieceIndex,
    lastPhase: 'encoder-flush', phaseLog: [], failure: null, demuxCacheSize: null, workerHeapBytes: null,
    decodedSourceFrames: 0, encodedChunkCount: frames, encodedKeyframeCount: 1, encodedChunkBytes: 0,
    encodedChunkCountAtFlushStart: frames,
    ...NO_FLUSH_OBSERVATION,
    encoderSessionIndex: 0, encoderSessions: 1, appendPendingAtFailure: null,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
  };
}

interface Run {
  result: Awaited<ReturnType<typeof exportProjectWebCodecs>>;
  offers: ForcedMp4SealOffer[];
  counts: string[];
  manifests: Record<string, unknown>[];
  /** The exact bytes of the newest manifest write - what is on disk after a restart. */
  persisted: () => string;
  warnings: string[];
}

/** Drives every piece's worker to a clean finish; `counted[path]` is what the native counter reports. */
async function run(
  shape: { segments: VideoSegment[]; expected: number[] },
  counted: Record<string, number>,
  opts: { consent?: boolean; noHook?: boolean } = {},
): Promise<Run> {
  const offers: ForcedMp4SealOffer[] = [];
  const counts: string[] = [];
  const manifests: Record<string, unknown>[] = [];
  const rawManifests: string[] = [];
  const warnings: string[] = [];
  const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warnings.push(a.map(String).join(' ')); });
  const landed = new Map<string, number>();
  const ffmpeg = {
    sessionId: SESSION,
    writeExportState: vi.fn(async (s: string) => { rawManifests.push(s); manifests.push(JSON.parse(s) as Record<string, unknown>); }),
    writeFile: vi.fn(async () => undefined), writeFileRaw: vi.fn(async () => undefined), exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()), deleteFile: vi.fn(async (p: string) => { landed.delete(p); }),
    appendFileRaw: vi.fn(async (p: string, d: Uint8Array) => { landed.set(p, (landed.get(p) ?? 0) + d.byteLength); }),
    saveSessionFile: vi.fn(async () => undefined), kill: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined),
    sessionFileSize: vi.fn(async (p: string) => landed.get(p) ?? 1_000),
    countAnnexbFrames: vi.fn(async (p: string) => {
      counts.push(p);
      const n = p === 'video_all.h264' ? Object.values(counted).reduce((a, b) => a + b, 0) : counted[p] ?? 0;
      return { pictures: n, vclNals: n };
    }),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb: vi.fn(async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
    truncateAnnexbToOffset: vi.fn(async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
  } as unknown as WebCodecsFfmpeg;

  let made = 0;
  const createWorker = (): ExportWorkerHandle => {
    const w = new FakeWorker();
    const idx = made++;
    setTimeout(() => {
      w.emit({ type: 'chunk', runId: `run_${idx}`, bytes: new Uint8Array(8).buffer, chunkType: 'key', timestamp: 0 });
      w.emit({ type: 'run-done', runId: `run_${idx}`, frameCount: shape.expected[idx]! });
      w.emit({ type: 'done', frameCount: shape.expected[idx]!, diagnostics: diagnostics(shape.expected[idx]!, idx) });
    }, 0);
    return w;
  };
  const result = await exportProjectWebCodecs(
    project(shape), ffmpeg,
    {
      width: 1920, height: 1080, fps: FPS,
      ...(opts.noHook ? {} : { requestForcedSealConsent: async (o: ForcedMp4SealOffer) => { offers.push(o); return opts.consent ?? false; } }),
    },
    () => undefined,
    { createWorker },
  );
  warn.mockRestore();
  return { result, offers, counts, manifests, persisted: () => rawManifests[rawManifests.length - 1]!, warnings };
}

const lastManifest = (r: Run): Record<string, unknown> => r.manifests[r.manifests.length - 1]!;

describe('per-piece completion guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a SHORT MID-FILM piece is recorded as a deviation and the run CONTINUES to the next piece', async () => {
    const r = await run(TWO_PIECES, { 'piece_0.h264': 1829, 'piece_1.h264': 1830 });
    // The run reached piece 1 (it was counted) — it did not stop at piece 0.
    expect(r.counts).toContain('piece_1.h264');
    expect(lastManifest(r).pieceDeviations).toEqual([{ pieceIndex: 0, counted: 1829, expected: 1830 }]);
    expect(lastManifest(r).completedPieces).toBe(2);
  });

  it('a short LAST piece is recorded the same way', async () => {
    const r = await run(TWO_PIECES, { 'piece_0.h264': 1830, 'piece_1.h264': 1829 });
    expect(lastManifest(r).pieceDeviations).toEqual([{ pieceIndex: 1, counted: 1829, expected: 1830 }]);
  });

  it('a short SINGLE-piece export is recorded the same way', async () => {
    const r = await run(ONE_PIECE, { 'piece_0.h264': 29 });
    expect(lastManifest(r).pieceDeviations).toEqual([{ pieceIndex: 0, counted: 29, expected: 30 }]);
  });

  it('the deviation reaches the existing seal decision, naming the piece with counted vs expected', async () => {
    const r = await run(TWO_PIECES, { 'piece_0.h264': 1829, 'piece_1.h264': 1830 });
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]!.picturesLost).toBe(1);
    expect(r.offers[0]!.deviatingPieces).toEqual([{ pieceIndex: 0, counted: 1829, expected: 1830 }]);
    expect(r.result.ok).toBe(false); // declined → the existing typed concat failure
  });

  it('an accepted seal still saves the shorter film (the escape hatch is not removed)', async () => {
    const r = await run(TWO_PIECES, { 'piece_0.h264': 1829, 'piece_1.h264': 1830 }, { consent: true });
    expect(r.result.ok).toBe(true);
  });

  it('one diagnostics line per deviation names the session, the piece, counted and expected', async () => {
    const r = await run(TWO_PIECES, { 'piece_0.h264': 1829, 'piece_1.h264': 1830 });
    const line = r.warnings.find((w) => w.includes('[ws3-piece-count]'));
    expect(line).toBeDefined();
    expect(line).toContain(SESSION);
    expect(line).toContain('"pieceIndex":0');
    expect(line).toContain('"counted":1829');
    expect(line).toContain('"expected":1830');
  });

  it('a fully rendered export records no deviation, offers nothing, and goes straight to mux', async () => {
    const r = await run(TWO_PIECES, { 'piece_0.h264': 1830, 'piece_1.h264': 1830 });
    expect(r.result.ok).toBe(true);
    expect(r.offers).toHaveLength(0);
    expect(lastManifest(r).pieceDeviations).toBeUndefined();
  });

  it('the guard counts each piece once, at completion, then the concat guard counts the whole', async () => {
    const r = await run(TWO_PIECES, { 'piece_0.h264': 1830, 'piece_1.h264': 1830 });
    expect(r.counts).toEqual(['piece_0.h264', 'piece_1.h264', 'video_all.h264']);
  });
});

describe('the seal decision is offered for ANY recorded deviation, not only a short total', () => {
  beforeEach(() => vi.clearAllMocks());
  // One piece short, another over plan: the whole film is the planned length.
  const CANCELLING = { 'piece_0.h264': 1829, 'piece_1.h264': 1831 };

  it('two deviations that cancel still produce the decision, naming BOTH pieces', async () => {
    const r = await run(TWO_PIECES, CANCELLING);
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]!.picturesLost).toBe(0);
    expect(r.offers[0]!.deviatingPieces).toEqual([
      { pieceIndex: 0, counted: 1829, expected: 1830 },
      { pieceIndex: 1, counted: 1831, expected: 1830 },
    ]);
  });

  it('declining stops the export with a typed concat failure that names the pieces (nothing is muxed)', async () => {
    const r = await run(TWO_PIECES, CANCELLING, { consent: false });
    expect(r.result.ok).toBe(false);
    if (r.result.ok) throw new Error('unreachable');
    expect(r.result.error.kind).toBe('concat');
    expect(r.result.error.message).toContain('Piece 1');
    expect(r.result.error.message).toContain('Piece 2');
    expect(vi.mocked(muxOnly)).not.toHaveBeenCalled();
  });

  it('accepting keeps the full-length film through the ordinary mux (no seal)', async () => {
    const r = await run(TWO_PIECES, CANCELLING, { consent: true });
    expect(r.result.ok).toBe(true);
    expect(vi.mocked(muxOnly)).toHaveBeenCalledTimes(1);
  });

  it('with nobody to ask, a full-length film is delivered and the deviation stays in the diagnostics', async () => {
    const r = await run(TWO_PIECES, CANCELLING, { noHook: true });
    expect(r.result.ok).toBe(true);
    expect(r.warnings.filter((w) => w.includes('[ws3-piece-count]')).length).toBeGreaterThan(0);
  });

  it('no deviation -> no decision (pin)', async () => {
    const r = await run(TWO_PIECES, { 'piece_0.h264': 1830, 'piece_1.h264': 1830 });
    expect(r.offers).toHaveLength(0);
  });

  it('a short total keeps its own decision and message (pin)', async () => {
    const r = await run(TWO_PIECES, { 'piece_0.h264': 1829, 'piece_1.h264': 1830 });
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]!.picturesLost).toBe(1);
    if (r.result.ok) throw new Error('unreachable');
    expect(r.result.error.message).toContain('measuredPictures=3659');
  });
});

describe('recorded deviations survive an app restart', () => {
  beforeEach(() => vi.clearAllMocks());

  /** A fresh discovery over the bytes a run left on disk - no memory shared with the run. */
  async function afterRestart(persisted: string, onDisk: Record<string, number>) {
    const bytes = new TextEncoder().encode(persisted);
    const hash = await buildSourceTimelineHash(timelineIdentityFromProject(project(TWO_PIECES), { fps: FPS, width: 1920, height: 1080 }, { spotRenderSpecs: [] }));
    const handle = (id: string): ResumeSessionHandle => ({
      sessionId: id,
      readExportState: async () => bytes,
      sessionFileSize: async () => 5_000,
      prepareCheckpointResume: async () => { throw new Error('a piece-boundary resume never fences'); },
      clearResumeFence: async () => undefined,
      truncateAnnexbToOffset: async () => { throw new Error('must not cut'); },
      destroy: async () => undefined,
    });
    const io: ResumeDiscoveryIo = {
      listResumableSessionIds: async () => [SESSION],
      peekExportState: async () => ({ kind: 'found', bytes: Array.from(bytes) }),
      peekSessionFileSize: async () => 5_000,
      reenter: async (id: string) => handle(id),
    };
    return discoverResumableExport(
      io,
      { expected: { projectId: 'proj-guard', sourceTimelineHash: hash!, fps: FPS, width: 1920, height: 1080 }, pieceExpectedFrames: TWO_PIECES.expected },
      async (_s, p) => onDisk[p]!,
      [SESSION],
    );
  }

  it('the deviation is in the bytes on disk; a fresh load ACCEPTS exactly that count', async () => {
    const r = await run(TWO_PIECES, { 'piece_0.h264': 1829, 'piece_1.h264': 1830 });
    expect(r.persisted()).toContain('pieceDeviations');
    const found = await afterRestart(r.persisted(), { 'piece_0.h264': 1829, 'piece_1.h264': 1830 });
    expect(found.resumable).not.toBeNull();
  });

  it('a fresh load still REFUSES a count the manifest never recorded (and a different count than recorded)', async () => {
    const r = await run(TWO_PIECES, { 'piece_0.h264': 1829, 'piece_1.h264': 1830 });
    const different = await afterRestart(r.persisted(), { 'piece_0.h264': 1828, 'piece_1.h264': 1830 });
    expect(different.resumable).toBeNull();
    const clean = await run(TWO_PIECES, { 'piece_0.h264': 1830, 'piece_1.h264': 1830 });
    expect(clean.persisted()).not.toContain('pieceDeviations');
    const unrecorded = await afterRestart(clean.persisted(), { 'piece_0.h264': 1829, 'piece_1.h264': 1830 });
    expect(unrecorded.resumable).toBeNull();
    expect(unrecorded.rejected[0]!.unrecoverable).toBe(true);
  });
});
