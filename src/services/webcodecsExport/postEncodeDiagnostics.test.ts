/**
 * WS3 Round 20 — post-encode failures carry liveness.
 *
 * The first Windows field report failed at the mux stage
 * (`write_file(voiceover_audio): sync_all: Access is denied. (os error 5)`)
 * and its Copy-diagnostics blob had `liveness`, `lastPhase`, `framesEncoded`,
 * `pieceIndex`, `appendLedger` and `phaseLogTail` ALL null. Every failure
 * constructed after the piece loop was `{ kind, message, cause }` — no
 * `liveness` — because `snapshotLiveness` lives inside `driveGlRun`'s
 * closure and is gone by then. This file pins that each post-encode stage
 * (concat, the frame-count guard, the voiceover write, mux, delivery) now
 * reports the last piece's frames/ledger AND names the failing stage as
 * `lastPhase`, with the phase-log tail ending in it — and that the native
 * cause string (OS error code + path) is passed through verbatim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';
import type { ExportWorkerInboundMessage, ExportWorkerOutboundMessage } from './exportWorker';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';
import { buildExportDiagnosticsBlob } from '../exportDiagnosticsBlob';

vi.mock('../plainSegment', () => ({
  isPlainVideoSegment: () => false,
  isPlainImageSegment: () => false,
}));
vi.mock('./glCompositable', () => ({
  isGlCompositableSegment: () => true,
  GL_TRANSITION_SLUGS: new Set<string>(),
}));

// eslint-disable-next-line import/first
import {
  exportProjectWebCodecs,
  type ExportWorkerHandle,
  type WebCodecsFfmpeg,
} from './exportPipelineWebCodecs';

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  postMessage(_m: unknown): void { void (_m as ExportWorkerInboundMessage); }
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
const voiceover: Asset = { id: 'vo', name: 'vo.wav', url: 'blob:vo', type: 'audio' };

function project(withVoiceover: boolean): Project {
  return {
    id: 'proj-diag', name: 'T', script: '', sceneDetails: '',
    segments: [segment], assets: withVoiceover ? [asset, voiceover] : [asset],
    ...(withVoiceover ? { voiceoverId: 'vo' } : {}),
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

const EXPECTED_FRAMES = 30;
const FPS = 30;

function diagnostics(): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: EXPECTED_FRAMES, pieceIndex: 0,
    lastPhase: 'encoder-flush',
    phaseLog: [{ seq: 0, atMs: 1, phase: 'encoder-flush', pieceIndex: 0, segmentIndex: 0, assetId: 'a0', framesEncoded: EXPECTED_FRAMES, kind: 'enter' }],
    failure: null, demuxCacheSize: null, workerHeapBytes: null,
    decodedSourceFrames: 0, encodedChunkCount: EXPECTED_FRAMES, encodedKeyframeCount: 1,
    encodedChunkBytes: 0, encodedChunkCountAtFlushStart: EXPECTED_FRAMES,
    ...NO_FLUSH_OBSERVATION,
    encoderSessionIndex: 0, encoderSessions: 1, appendPendingAtFailure: null,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
  };
}

/** The exact native cause from the machine-1 field report, as `durable_fs`
 *  now formats it (label, step, path, io error, and the bracketed fields). */
const FIELD_CAUSE =
  'write_file(voiceover_audio): sync_all on C:\\Users\\op\\AppData\\Local\\Temp\\kinetix-export-abc\\voiceover_audio: ' +
  'Access is denied. (os error 5) [os_error=5, attempts=1, elapsed_ms=0]';

type Overrides = Partial<Record<keyof WebCodecsFfmpeg, (...a: never[]) => unknown>>;

function harness(overrides: Overrides = {}): WebCodecsFfmpeg {
  const landed = new Map<string, number>();
  const base = {
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
    truncateAnnexbToOffset: vi.fn(async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
  };
  return { ...base, ...overrides } as unknown as WebCodecsFfmpeg;
}

async function run(ffmpeg: WebCodecsFfmpeg, withVoiceover: boolean, savePath?: string) {
  const fake = new FakeWorker();
  const p = exportProjectWebCodecs(
    project(withVoiceover), ffmpeg,
    { width: 1920, height: 1080, fps: FPS, ...(savePath ? { savePath } : {}) },
    () => undefined,
    { createWorker: () => fake },
  );
  await Promise.resolve();
  await Promise.resolve();
  fake.emit({ type: 'chunk', runId: 'run_0', bytes: new Uint8Array(8).buffer, chunkType: 'key', timestamp: 0 });
  fake.emit({ type: 'run-done', runId: 'run_0', frameCount: EXPECTED_FRAMES });
  fake.emit({ type: 'done', frameCount: EXPECTED_FRAMES, diagnostics: diagnostics() });
  return p;
}

const PROJECT_META = { segmentCount: 1, hasVoiceover: true, exportResolution: '1080p' as const, exportFps: 30 as const, ts: 't' };

function expectPopulated(err: { liveness?: unknown }, phase: string) {
  const blob = buildExportDiagnosticsBlob(err as never, PROJECT_META) as Record<string, unknown>;
  // The six fields the field report had null — every one populated.
  expect(blob.liveness).not.toBeNull();
  expect(blob.lastPhase).toBe(phase);
  expect(blob.framesEncoded).toBe(EXPECTED_FRAMES);
  expect(blob.pieceIndex).toBe(0);
  expect(blob.appendLedger).not.toBeNull();
  const tail = blob.phaseLogTail as Array<{ phase: string; kind: string }>;
  expect(tail.length).toBeGreaterThan(1);
  expect(tail[tail.length - 1]).toMatchObject({ phase, kind: 'post-encode' });
  // The worker's own last phase precedes the post-encode stages.
  expect(tail[0]).toMatchObject({ phase: 'encoder-flush' });
  expect(typeof blob.msSinceLastPhaseChange).toBe('number');
}

describe('WS3 Round 20 — post-encode failures carry the last piece liveness and name their stage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the field failure: voiceover write throws at the mux stage → liveness populated, phase named, native cause verbatim', async () => {
    const ffmpeg = harness({
      writeFile: vi.fn(async (path: string) => {
        if (path === 'voiceover_audio') throw new Error(FIELD_CAUSE);
      }),
    });
    // The voiceover fetch: `voiceoverAsset.url` is read via fetch when no File is attached.
    vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })));
    const r = await run(ffmpeg, true);
    vi.unstubAllGlobals();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('mux');
    expect(r.error.cause).toBe(FIELD_CAUSE);
    expect(r.error.cause).toContain('os error 5');
    expect(r.error.cause).toContain('voiceover_audio');
    expectPopulated(r.error, 'mux:write-voiceover');
  });

  it('concat throws → phase "concat"', async () => {
    // Two pieces are needed for concat to run; a single piece skips it. Use
    // the one-piece path's other post-encode failure instead: the guard's
    // count call throwing is a `concat`-kind failure at "concat:verify".
    const ffmpeg = harness({ countAnnexbFrames: vi.fn(async () => { throw new Error('count exploded'); }) });
    const r = await run(ffmpeg, false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('concat');
    expectPopulated(r.error, 'concat:verify');
  });

  it('the frame-count guard MISMATCH (typed concat failure, no consent surface) carries liveness too', async () => {
    const ffmpeg = harness({ countAnnexbFrames: vi.fn(async () => ({ pictures: EXPECTED_FRAMES - 5, vclNals: EXPECTED_FRAMES - 5 })) });
    const r = await run(ffmpeg, false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('concat');
    expectPopulated(r.error, 'concat:verify');
  });

  it('mux exec throws → phase "mux"', async () => {
    const ffmpeg = harness({ exec: vi.fn(async () => { throw new Error('ffmpeg exited 1'); }) });
    const r = await run(ffmpeg, false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('mux');
    expectPopulated(r.error, 'mux');
  });

  it('delivery throws (pipeline-side savePath) → phase "deliver"', async () => {
    const ffmpeg = harness({ saveSessionFile: vi.fn(async () => { throw new Error('copy_session_file: fsync dest: nope'); }) });
    const r = await run(ffmpeg, false, 'C:\\out.mp4');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expectPopulated(r.error, 'deliver');
  });

  it('a SUCCESSFUL run returns its terminal liveness so useExport can attach it to a delivery failure', async () => {
    const r = await run(harness(), false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.liveness).toBeDefined();
    expect(r.liveness!.lastPhase).toBe('done');
    expect(r.liveness!.framesEncoded).toBe(EXPECTED_FRAMES);
    expect(r.liveness!.appendLedger).not.toBeNull();
  });

  it('a delivery that reports durableConfirmed=false is still a success', async () => {
    const ffmpeg = harness({
      saveSessionFile: vi.fn(async () => ({ durableConfirmed: false, durabilityWarning: 'copy_session_file: fsync dest on C:\\out.mp4: … [os_error=32, attempts=6, elapsed_ms=790]' })),
    });
    const r = await run(ffmpeg, false, 'C:\\out.mp4');
    expect(r.ok).toBe(true);
  });
});
