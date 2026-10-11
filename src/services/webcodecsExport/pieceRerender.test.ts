/**
 * A GL piece that finishes off-plan is re-rendered once before the run settles
 * for a recorded deviation. The re-render is bounded (per piece and per
 * export), is not a recovery attempt (it never touches the resume budget), and
 * a second miss continues with the deviation recorded — it never loops.
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
  MAX_PIECE_RERENDERS_PER_PIECE,
  MAX_PIECE_RERENDERS_PER_EXPORT,
  type ExportWorkerHandle,
  type WebCodecsFfmpeg,
} from './exportPipelineWebCodecs';

const FPS = 30;
const SESSION = '11111111-2222-4333-8444-555555555555';
const PIECE_FRAMES = 1830;

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  runId = 'run_0';
  postMessage(m: unknown): void {
    const msg = m as ExportWorkerInboundMessage;
    if (msg.type === 'init') this.runId = msg.runId;
  }
  terminate(): void { /* no-op */ }
  emit(data: ExportWorkerOutboundMessage): void { this.onmessage?.({ data } as MessageEvent<ExportWorkerOutboundMessage>); }
}

const asset: Asset = { id: 'a0', name: 'a0.mp4', url: 'blob:a0', type: 'video' };
function segs(n: number): VideoSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, text: '', assetId: 'a0', startTime: i * 61, duration: 61,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: i,
  }));
}
function project(pieces: number): Project {
  return {
    id: 'proj-rerender', name: 'T', script: '', sceneDetails: '',
    segments: segs(pieces), assets: [asset],
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0, globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}
function diagnostics(pieceIndex: number): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: PIECE_FRAMES, pieceIndex,
    lastPhase: 'encoder-flush', phaseLog: [], failure: null, demuxCacheSize: null, workerHeapBytes: null,
    decodedSourceFrames: 0, encodedChunkCount: PIECE_FRAMES, encodedKeyframeCount: 1, encodedChunkBytes: 0,
    encodedChunkCountAtFlushStart: PIECE_FRAMES,
    ...NO_FLUSH_OBSERVATION,
    encoderSessionIndex: 0, encoderSessions: 1, appendPendingAtFailure: null,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
  };
}

interface Run {
  result: Awaited<ReturnType<typeof exportProjectWebCodecs>>;
  offers: ForcedMp4SealOffer[];
  workersMade: number;
  runIds: string[];
  deletes: string[];
  events: string[];
  manifests: Record<string, unknown>[];
}

/**
 * `perPiece[i]` is the sequence of counts the counter reports for piece i's
 * file, one per render of it (the last value repeats). The whole-film count is
 * the sum of each piece's FINAL value.
 */
async function run(
  pieces: number,
  perPiece: Record<number, number[]>,
  opts: { deleteFails?: boolean } = {},
): Promise<Run> {
  const offers: ForcedMp4SealOffer[] = [];
  const runIds: string[] = [];
  const deletes: string[] = [];
  const events: string[] = [];
  const manifests: Record<string, unknown>[] = [];
  const rendered = new Map<number, number>();
  const finalCount = (i: number): number => {
    const seq = perPiece[i] ?? [PIECE_FRAMES];
    return seq[Math.min((rendered.get(i) ?? 1) - 1, seq.length - 1)]!;
  };
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const landed = new Map<string, number>();
  const ffmpeg = {
    sessionId: SESSION,
    writeExportState: vi.fn(async (s: string) => { manifests.push(JSON.parse(s) as Record<string, unknown>); }),
    writeFile: vi.fn(async () => undefined), writeFileRaw: vi.fn(async () => undefined), exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()),
    deleteFile: vi.fn(async (p: string) => {
      deletes.push(p);
      events.push(`delete ${p}`);
      if (opts.deleteFails && p.startsWith('piece_')) throw new Error('EBUSY');
      landed.delete(p);
    }),
    appendFileRaw: vi.fn(async (p: string, d: Uint8Array) => { landed.set(p, (landed.get(p) ?? 0) + d.byteLength); }),
    saveSessionFile: vi.fn(async () => undefined), kill: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined),
    sessionFileSize: vi.fn(async (p: string) => landed.get(p) ?? 1_000),
    countAnnexbFrames: vi.fn(async (p: string) => {
      const m = /^piece_(\d+)\.h264$/.exec(p);
      let n: number;
      if (m) n = finalCount(Number(m[1]));
      else n = Array.from({ length: pieces }, (_, i) => perPiece[i]?.[perPiece[i]!.length - 1] ?? PIECE_FRAMES).reduce((a, b) => a + b, 0);
      return { pictures: n, vclNals: n };
    }),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb: vi.fn(async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
    truncateAnnexbToOffset: vi.fn(async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
  } as unknown as WebCodecsFfmpeg;

  let made = 0;
  const createWorker = (): ExportWorkerHandle => {
    const w = new FakeWorker();
    made++;
    setTimeout(() => {
      runIds.push(w.runId);
      events.push(`render ${w.runId}`);
      const idx = Number(w.runId.replace('run_', ''));
      rendered.set(idx, (rendered.get(idx) ?? 0) + 1);
      w.emit({ type: 'chunk', runId: w.runId, bytes: new Uint8Array(8).buffer, chunkType: 'key', timestamp: 0 });
      w.emit({ type: 'run-done', runId: w.runId, frameCount: PIECE_FRAMES });
      w.emit({ type: 'done', frameCount: PIECE_FRAMES, diagnostics: diagnostics(idx) });
    }, 0);
    return w;
  };
  const result = await exportProjectWebCodecs(
    project(pieces), ffmpeg,
    { width: 1920, height: 1080, fps: FPS, requestForcedSealConsent: async (o) => { offers.push(o); return false; } },
    () => undefined,
    { createWorker },
  );
  return { result, offers, workersMade: made, runIds, deletes, events, manifests };
}

const last = (r: Run): Record<string, unknown> => r.manifests[r.manifests.length - 1]!;

describe('piece re-render on a count deviation', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('the allowance is proposed as 1 per piece and 3 per export', () => {
    expect(MAX_PIECE_RERENDERS_PER_PIECE).toBe(1);
    expect(MAX_PIECE_RERENDERS_PER_EXPORT).toBe(3);
  });

  it('a short piece is re-rendered, comes back exact, and the export completes with NO deviation', async () => {
    const r = await run(2, { 0: [PIECE_FRAMES - 1, PIECE_FRAMES] });
    expect(r.result.ok).toBe(true);
    expect(r.offers).toHaveLength(0);
    expect(r.runIds).toEqual(['run_0', 'run_0', 'run_1']); // piece 0 twice, then piece 1 — earlier work untouched
    expect(r.deletes).toContain('piece_0.h264'); // the short file is removed before the re-render appends
    expect(last(r).pieceDeviations).toBeUndefined();
    expect(last(r).completedPieces).toBe(2);
  });

  it('earlier good pieces are reused, not re-rendered', async () => {
    const r = await run(3, { 1: [PIECE_FRAMES - 1, PIECE_FRAMES] });
    expect(r.runIds).toEqual(['run_0', 'run_1', 'run_1', 'run_2']);
    // Nothing is removed before the re-render of piece 1 except piece 1 itself.
    const beforeLastRender = r.events.slice(0, r.events.lastIndexOf('render run_2'));
    expect(beforeLastRender.filter((e) => e.startsWith('delete piece_'))).toEqual(['delete piece_1.h264']);
  });

  it('a second short render continues with the deviation recorded — it does not loop', async () => {
    const r = await run(2, { 0: [PIECE_FRAMES - 1] });
    expect(r.runIds).toEqual(['run_0', 'run_0', 'run_1']); // exactly ONE re-render
    expect(last(r).pieceDeviations).toEqual([{ pieceIndex: 0, counted: PIECE_FRAMES - 1, expected: PIECE_FRAMES }]);
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]!.deviatingPieces).toEqual([{ pieceIndex: 0, counted: PIECE_FRAMES - 1, expected: PIECE_FRAMES }]);
  });

  it('the export-wide allowance bounds the total: the 4th deviating piece is recorded, not re-rendered', async () => {
    const short = [PIECE_FRAMES - 1, PIECE_FRAMES];
    const r = await run(4, { 0: short, 1: short, 2: short, 3: [PIECE_FRAMES - 1] });
    expect(r.runIds.filter((id) => id === 'run_0')).toHaveLength(2);
    expect(r.runIds.filter((id) => id === 'run_1')).toHaveLength(2);
    expect(r.runIds.filter((id) => id === 'run_2')).toHaveLength(2);
    expect(r.runIds.filter((id) => id === 'run_3')).toHaveLength(1); // allowance spent
    expect(last(r).pieceDeviations).toEqual([{ pieceIndex: 3, counted: PIECE_FRAMES - 1, expected: PIECE_FRAMES }]);
  });

  it('the allowance belongs to the export, not the process: two projects each get their own', async () => {
    const a = await run(2, { 0: [PIECE_FRAMES - 1, PIECE_FRAMES] });
    const b = await run(2, { 1: [PIECE_FRAMES - 1, PIECE_FRAMES] });
    expect(a.runIds).toEqual(['run_0', 'run_0', 'run_1']);
    expect(b.runIds).toEqual(['run_0', 'run_1', 'run_1']);
  });

  it('a re-render is not a recovery attempt: the resume budget is untouched', async () => {
    const r = await run(2, { 0: [PIECE_FRAMES - 1, PIECE_FRAMES] });
    const m = last(r);
    expect(m.totalRecoveryAttempts ?? 0).toBe(0);
    expect(m.checkpointResumeAttempts ?? 0).toBe(0);
    expect(m.boundaryRewindsUsed ?? 0).toBe(0);
    expect(m.hardwareFailoverUsed ?? false).toBe(false);
    expect(m.resumeAttemptInFlight).toBeUndefined();
  });

  it('if the short file cannot be removed, nothing is appended onto it: the deviation is recorded instead', async () => {
    const r = await run(2, { 0: [PIECE_FRAMES - 1, PIECE_FRAMES] }, { deleteFails: true });
    expect(r.runIds).toEqual(['run_0', 'run_1']); // no second render onto the old bytes
    expect(last(r).pieceDeviations).toEqual([{ pieceIndex: 0, counted: PIECE_FRAMES - 1, expected: PIECE_FRAMES }]);
  });

  it('a fully rendered session still goes straight to mux (pin)', async () => {
    const r = await run(2, {});
    expect(r.result.ok).toBe(true);
    expect(r.runIds).toEqual(['run_0', 'run_1']);
    expect(r.deletes.filter((p) => p.startsWith('piece_'))).toHaveLength(2); // only the final intermediate cleanup
  });
});
