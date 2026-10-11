/**
 * The encoder gap at the source: the worker compares submitted frames with
 * emitted chunks after a flush and, when the encoder swallowed a frame, fails
 * the rung (`encoder-gap`). The pipeline answers with the SAME bounded
 * re-render as a counted deviation — from scratch, on the software rung, with
 * no recovery charge. A re-render that gaps again is tolerated (recorded with
 * its cause) rather than looped.
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
import { exportProjectWebCodecs, type ExportWorkerHandle, type WebCodecsFfmpeg } from './exportPipelineWebCodecs';

const FPS = 30;
const SESSION = '11111111-2222-4333-8444-555555555555';
const N = 1830;

type Init = Extract<ExportWorkerInboundMessage, { type: 'init' }>;
class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  init: Init | null = null;
  postMessage(m: unknown): void { const msg = m as ExportWorkerInboundMessage; if (msg.type === 'init') this.init = msg; }
  terminate(): void { /* no-op */ }
  emit(data: ExportWorkerOutboundMessage): void { this.onmessage?.({ data } as MessageEvent<ExportWorkerOutboundMessage>); }
}

const asset: Asset = { id: 'a0', name: 'a0.mp4', url: 'blob:a0', type: 'video' };
const project = (): Project => ({
  id: 'proj-gap', name: 'T', script: '', sceneDetails: '',
  segments: [0, 1].map((i): VideoSegment => ({ id: `s${i}`, text: '', assetId: 'a0', startTime: i * 61, duration: 61, transition: TransitionType.NONE, animation: AnimationType.NONE, order: i })),
  assets: [asset],
  globalTransition: TransitionType.NONE, globalTransitionDuration: 0, globalAnimation: AnimationType.NONE,
  globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
});

function diag(pieceIndex: number, o: Partial<ExportWorkerDiagnosticsPayload> = {}): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: N, pieceIndex,
    lastPhase: 'encoder-flush', phaseLog: [], failure: null, demuxCacheSize: null, workerHeapBytes: null,
    decodedSourceFrames: 0, encodedChunkCount: N, encodedKeyframeCount: 1, encodedChunkBytes: 0, encodedChunkCountAtFlushStart: N,
    ...NO_FLUSH_OBSERVATION,
    encoderSessionIndex: 0, encoderSessions: 1, appendPendingAtFailure: null,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
    ...o,
  };
}

/** What each successive worker does. */
type Behaviour = 'ok' | 'gap-error' | 'gap-done';

async function run(behaviours: Behaviour[], counts: Record<string, number[]>) {
  const inits: Init[] = [];
  const deletes: string[] = [];
  const manifests: Record<string, unknown>[] = [];
  const offers: ForcedMp4SealOffer[] = [];
  const warnings: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warnings.push(a.map(String).join(' ')); });
  const seen = new Map<string, number>();
  const landed = new Map<string, number>();
  const ffmpeg = {
    sessionId: SESSION,
    writeExportState: vi.fn(async (s: string) => { manifests.push(JSON.parse(s) as Record<string, unknown>); }),
    writeFile: vi.fn(async () => undefined), writeFileRaw: vi.fn(async () => undefined), exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()),
    deleteFile: vi.fn(async (p: string) => { deletes.push(p); landed.delete(p); }),
    appendFileRaw: vi.fn(async (p: string, d: Uint8Array) => { landed.set(p, (landed.get(p) ?? 0) + d.byteLength); }),
    saveSessionFile: vi.fn(async () => undefined), kill: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined),
    sessionFileSize: vi.fn(async (p: string) => landed.get(p) ?? 1_000),
    countAnnexbFrames: vi.fn(async (p: string) => {
      const seq = counts[p];
      if (!seq) return { pictures: 2 * N, vclNals: 2 * N };
      const k = seen.get(p) ?? 0; seen.set(p, k + 1);
      const n = seq[Math.min(k, seq.length - 1)]!;
      return { pictures: n, vclNals: n };
    }),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb: vi.fn(async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
    truncateAnnexbToOffset: vi.fn(async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
  } as unknown as WebCodecsFfmpeg;
  let made = 0;
  const createWorker = (): ExportWorkerHandle => {
    const w = new FakeWorker();
    const behaviour = behaviours[Math.min(made, behaviours.length - 1)]!;
    made++;
    setTimeout(() => {
      if (w.init) inits.push(w.init);
      const runId = w.init?.runId ?? 'run_0';
      const piece = Number(runId.replace('run_', ''));
      w.emit({ type: 'chunk', runId, bytes: new Uint8Array(8).buffer, chunkType: 'key', timestamp: 0 });
      if (behaviour === 'gap-error') {
        w.emit({ type: 'error', diagnostics: diag(piece, {
          framesEncoded: N, encodedChunkCount: N - 1,
          failure: { name: 'EncoderGapError', message: 'encoder emitted 1829 chunks for 1830 frames', via: 'encoder-gap', frameIndex: null, timelineSec: null },
          encoderGap: { submitted: N, emitted: N - 1, sessionIndex: 0 },
        }) });
        return;
      }
      w.emit({ type: 'run-done', runId, frameCount: N });
      w.emit({ type: 'done', frameCount: N, diagnostics: diag(piece, behaviour === 'gap-done' ? { encodedChunkCount: N - 1, encoderGap: { submitted: N, emitted: N - 1, sessionIndex: 0 } } : {}) });
    }, 0);
    return w;
  };
  const result = await exportProjectWebCodecs(
    project(), ffmpeg,
    { width: 1920, height: 1080, fps: FPS, requestForcedSealConsent: async (o) => { offers.push(o); return false; } },
    () => undefined, { createWorker },
  );
  return { result, inits, deletes, manifests, offers, warnings, made };
}
const last = (r: { manifests: Record<string, unknown>[] }): Record<string, unknown> => r.manifests[r.manifests.length - 1]!;

describe('encoder gap at the source', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('a gap fails the rung; the piece is re-rendered from scratch, exact, on the software rung', async () => {
    const r = await run(['gap-error', 'ok', 'ok'], { 'piece_0.h264': [N], 'piece_1.h264': [N] });
    expect(r.result.ok).toBe(true);
    expect(r.made).toBe(3); // piece 0 twice, piece 1 once
    expect(r.inits.map((i) => i.runId)).toEqual(['run_0', 'run_0', 'run_1']);
    expect(r.inits[0]!.failOnEncoderGap).toBe(true);
    expect(r.inits[0]!.forceSoftwareEncoder ?? false).toBe(false);
    expect(r.inits[1]!.forceSoftwareEncoder).toBe(true);
    expect(r.inits[1]!.resumeFromFrameIndex ?? 0).toBe(0); // from scratch, not mid-piece
    expect(r.deletes).toContain('piece_0.h264');
    expect(last(r).pieceDeviations).toBeUndefined();
  });

  it('the re-render tolerates a second gap instead of looping: it ends as a recorded deviation', async () => {
    const r = await run(['gap-error', 'gap-done', 'ok'], { 'piece_0.h264': [N - 1], 'piece_1.h264': [N] });
    expect(r.made).toBe(3);
    expect(r.inits[1]!.failOnEncoderGap).toBe(false);
  });

  it('the gap reason reaches the deviation record and the disclosure names the cause', async () => {
    const r = await run(['gap-done', 'ok'], { 'piece_0.h264': [N - 1], 'piece_1.h264': [N] });
    const dev = (last(r).pieceDeviations as { pieceIndex: number; counted: number; expected: number; cause?: string }[])[0]!;
    expect(dev).toMatchObject({ pieceIndex: 0, counted: N - 1, expected: N, cause: 'encoder_gap' });
    expect(r.offers[0]!.deviatingPieces![0]!.cause).toBe('encoder_gap');
  });

  it('one [ws3-encoder-gap] line names session, piece, submitted and emitted', async () => {
    const r = await run(['gap-error', 'ok', 'ok'], { 'piece_0.h264': [N], 'piece_1.h264': [N] });
    const line = r.warnings.find((w) => w.includes('[ws3-encoder-gap]'));
    expect(line).toBeDefined();
    expect(line).toContain(SESSION);
    expect(line).toContain('"pieceIndex":0');
    expect(line).toContain('"submitted":1830');
    expect(line).toContain('"emitted":1829');
  });

  it('the gap is not a recovery attempt: the persisted budget and the in-flight marker are untouched', async () => {
    const r = await run(['gap-error', 'ok', 'ok'], { 'piece_0.h264': [N], 'piece_1.h264': [N] });
    const m = last(r);
    expect(m.totalRecoveryAttempts ?? 0).toBe(0);
    expect(m.checkpointResumeAttempts ?? 0).toBe(0);
    expect(m.boundaryRewindsUsed ?? 0).toBe(0);
    expect(m.hardwareFailoverUsed ?? false).toBe(false);
    expect(m.resumeAttemptInFlight).toBeUndefined();
  });

  it('a healthy run never fails a rung (pin)', async () => {
    const r = await run(['ok', 'ok'], { 'piece_0.h264': [N], 'piece_1.h264': [N] });
    expect(r.result.ok).toBe(true);
    expect(r.made).toBe(2);
    expect(r.inits.every((i) => !i.forceSoftwareEncoder)).toBe(true);
    expect(r.warnings.filter((w) => w.includes('[ws3-encoder-gap]'))).toEqual([]);
  });
});
