/**
 * WS3 Round 10, Blocker 2 — the sealing seam, WIRED.
 *
 * Cursor's `forcedMp4SealOffer` / `sealTruncatedAnnexbToMp4` (muxOnly.ts,
 * `SealingOfferSeam`) shipped as complete primitives with no caller. This file
 * pins the four constraints the round required of the call site:
 *
 *  1. THE GUARD IS NOT RELAXED. It runs first, on the real concatenated file,
 *     and it reports the true discrepancy. The conservative final-AU drop makes
 *     that discrepancy LARGER by exactly one picture and nothing compensates.
 *  2. DECLINING YIELDS THE SAME TYPED FAILURE AS BEFORE — the unchanged
 *     `formatConcatFrameCountMismatch` message, `kind: 'concat'`.
 *  3. A CLEAN EXPORT NEVER REACHES THE SEAM, and its ffmpeg call sequence is
 *     identical, argument-for-argument, to the pre-wiring tree's.
 *  4. THE OFFER'S NUMBERS ARE THE POST-DROP NUMBERS — the operator is never
 *     told more was kept than actually was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';
import type { ExportWorkerInboundMessage, ExportWorkerOutboundMessage } from './exportWorker';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';
import { buildVideoRemuxArgs, buildAudioMuxArgs, type ForcedMp4SealOffer } from './muxOnly';

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

function project(): Project {
  return {
    id: 'proj-seal', name: 'T', script: '', sceneDetails: '',
    segments: [segment], assets: [asset],
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
    lastPhase: 'encoder-flush', phaseLog: [], failure: null, demuxCacheSize: null, workerHeapBytes: null,
    decodedSourceFrames: 0, encodedChunkCount: EXPECTED_FRAMES, encodedKeyframeCount: 1,
    encodedChunkBytes: 0, encodedChunkCountAtFlushStart: EXPECTED_FRAMES,
    ...NO_FLUSH_OBSERVATION,
    encoderSessionIndex: 0, encoderSessions: 1, appendPendingAtFailure: null,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
  };
}

/** Every ffmpeg call the pipeline makes, in order — the byte-neutrality trace. */
type Call = { fn: string; args: unknown[] };

function harness(measuredPictures: number): {
  ffmpeg: WebCodecsFfmpeg;
  calls: Call[];
} {
  const calls: Call[] = [];
  const rec = <T>(fn: string, impl: (...a: never[]) => T) =>
    vi.fn((...args: unknown[]) => { calls.push({ fn, args }); return (impl as (...a: unknown[]) => T)(...args); });
  // WS3 Round 12 (H1) — tracked by path so `driveGlRun`'s per-append verify
  // (`sessionFileSize` read right after `appendFileRaw`) sees a landed size
  // consistent with what was actually appended.
  const landed = new Map<string, number>();
  const ffmpeg = {
    writeFile: rec('writeFile', async () => undefined),
    writeFileRaw: rec('writeFileRaw', async () => undefined),
    exec: rec('exec', async () => 0),
    readFile: rec('readFile', async () => new Uint8Array()),
    deleteFile: rec('deleteFile', async () => undefined),
    appendFileRaw: rec('appendFileRaw', async (p: string, data: Uint8Array) => {
      landed.set(p, (landed.get(p) ?? 0) + data.byteLength);
    }),
    saveSessionFile: rec('saveSessionFile', async () => undefined),
    kill: rec('kill', async () => undefined),
    destroy: rec('destroy', async () => undefined),
    sessionFileSize: rec('sessionFileSize', async (p: string) => landed.get(p) ?? 1_700_000_000),
    countAnnexbFrames: rec('countAnnexbFrames', async () => ({ pictures: measuredPictures, vclNals: measuredPictures })),
    concatAnnexbPieces: rec('concatAnnexbPieces', async () => undefined),
    truncateAnnexb: rec('truncateAnnexb', async () => ({ pictures: measuredPictures, vclNals: measuredPictures, bytesRemoved: 0, keptBytes: 100 })),
    truncateAnnexbToOffset: rec('truncateAnnexbToOffset', async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
  } as unknown as WebCodecsFfmpeg;
  return { ffmpeg, calls };
}

async function run(
  ffmpeg: WebCodecsFfmpeg,
  requestForcedSealConsent?: (offer: ForcedMp4SealOffer) => Promise<boolean>,
) {
  const fake = new FakeWorker();
  const p = exportProjectWebCodecs(
    project(), ffmpeg,
    { width: 1920, height: 1080, fps: FPS, ...(requestForcedSealConsent ? { requestForcedSealConsent } : {}) },
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

describe('forced MP4 sealing — wired at the concat-guard seam', () => {
  beforeEach(() => vi.clearAllMocks());

  it('CONSTRAINT 3 (byte neutrality): a clean export never offers, never consults consent, and issues the same ffmpeg calls', async () => {
    const consent = vi.fn(async () => true);
    const { ffmpeg, calls } = harness(EXPECTED_FRAMES); // measured === expected
    const r = await run(ffmpeg, consent);
    expect(r.ok).toBe(true);
    expect(consent).not.toHaveBeenCalled();

    // The full ffmpeg trace of a clean single-piece GL export. `muxOnly` with
    // no audio is exactly ONE exec with `buildVideoRemuxArgs` — the sealing
    // wiring adds nothing to it.
    const execCalls = calls.filter((c) => c.fn === 'exec');
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]!.args[0]).toEqual(
      buildVideoRemuxArgs('piece_0.h264', 'export_final.mp4', FPS),
    );
    expect(calls.map((c) => c.fn)).toEqual([
      'appendFileRaw',      // the one chunk
      'sessionFileSize',    // WS3 Round 12 (H1) — per-append verify
      'countAnnexbFrames',  // the guard
      'sessionFileSize',    // mux bound sizing
      'exec',               // muxOnly (video only)
      'deleteFile',         // intermediate cleanup: piece_0.h264
      'deleteFile',         // intermediate cleanup: video_all.h264
    ]);
    expect(calls.filter((c) => c.fn === 'deleteFile').map((c) => c.args[0]))
      .toEqual(['piece_0.h264', 'video_all.h264']);
  });

  it('CONSTRAINT 1 + 4: the guard fires, then an offer is built from the POST-DROP measured numbers', async () => {
    const seen: ForcedMp4SealOffer[] = [];
    const { ffmpeg } = harness(EXPECTED_FRAMES - 3); // 27 of 30 kept
    const r = await run(ffmpeg, async (offer) => { seen.push(offer); return false; });

    expect(seen).toHaveLength(1);
    const offer = seen[0]!;
    // Exactly the numbers the guard measured — no compensation for the
    // conservative final-AU drop in either direction.
    expect(offer.picturesKept).toBe(27);
    expect(offer.picturesExpected).toBe(30);
    expect(offer.picturesLost).toBe(3);
    expect(offer.fps).toBe(FPS);
    expect(offer.keptWallDurationSeconds).toBeCloseTo(27 / FPS, 10);
    expect(offer.lostWallDurationSeconds).toBeCloseTo(3 / FPS, 10);
    // Declined here, so still a failure — see the next test for the message.
    expect(r.ok).toBe(false);
  });

  it('CONSTRAINT 2: declining yields the unchanged typed concat failure, and no seal ffmpeg call', async () => {
    const { ffmpeg, calls } = harness(EXPECTED_FRAMES - 3);
    const declined = await run(ffmpeg, async () => false);
    expect(declined.ok).toBe(false);
    if (declined.ok) throw new Error('unreachable');
    expect(declined.error.kind).toBe('concat');
    expect(declined.error.message).toContain('27');
    expect(declined.error.message).toContain('30');
    expect(calls.some((c) => c.fn === 'exec')).toBe(false);

    // …and identical to the message produced with NO consent hook wired at
    // all — i.e. the pre-wiring tree's own failure, unchanged.
    const { ffmpeg: ffmpeg2 } = harness(EXPECTED_FRAMES - 3);
    const unwired = await run(ffmpeg2);
    expect(unwired.ok).toBe(false);
    if (unwired.ok) throw new Error('unreachable');
    // WS3 Round 20 — every post-encode failure now carries `liveness`
    // (populated, with a wall-clock `msSinceLastPhaseChange`), so the two
    // errors are compared on their TYPED content; the liveness view is
    // asserted present on both rather than byte-equal.
    const { liveness: declinedLiveness, ...declinedTyped } = declined.error;
    const { liveness: unwiredLiveness, ...unwiredTyped } = unwired.error;
    expect(unwiredTyped).toEqual(declinedTyped);
    expect(declinedLiveness?.lastPhase).toBe('concat:verify');
    expect(unwiredLiveness?.lastPhase).toBe('concat:verify');
  });

  it('consenting seals: one muxOnly-shaped exec, a successful result, and the guard still having reported the shortfall', async () => {
    const { ffmpeg, calls } = harness(EXPECTED_FRAMES - 3);
    const consent = vi.fn(async () => true);
    const r = await run(ffmpeg, consent);
    expect(consent).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.outputFile).toBe('export_final.mp4');
    const execCalls = calls.filter((c) => c.fn === 'exec');
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]!.args[0]).toEqual(
      buildVideoRemuxArgs('piece_0.h264', 'export_final.mp4', FPS),
    );
    // The guard ran BEFORE the seal — ordering, not just presence.
    const order = calls.map((c) => c.fn);
    expect(order.indexOf('countAnnexbFrames')).toBeLessThan(order.indexOf('exec'));
  });

  it('a consent surface that throws is treated as a decline, not a yes', async () => {
    const { ffmpeg, calls } = harness(EXPECTED_FRAMES - 3);
    const r = await run(ffmpeg, async () => { throw new Error('modal unmounted'); });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('concat');
    expect(r.error.message).toContain('27');
    expect(calls.some((c) => c.fn === 'exec')).toBe(false);
  });

  it('a LONGER-than-expected stream is not sealable — consent is never asked for', async () => {
    const consent = vi.fn(async () => true);
    const { ffmpeg } = harness(EXPECTED_FRAMES + 2);
    const r = await run(ffmpeg, consent);
    expect(consent).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });

  it('a ZERO-picture stream is not sealable — nothing to offer', async () => {
    const consent = vi.fn(async () => true);
    const { ffmpeg } = harness(0);
    const r = await run(ffmpeg, consent);
    expect(consent).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });

  it('the seal is a real muxOnly, so audio arguments are the ordinary two-pass ones', () => {
    // Guards the arg builders the seal path reuses — if these ever diverge
    // from `muxOnly`'s, a sealed file would be built differently from a clean
    // one, which is exactly what "sealing is muxOnly + consent" forbids.
    expect(buildAudioMuxArgs('v.mp4', 'a.aac', 'o.mp4')).toContain('-shortest');
    expect(buildVideoRemuxArgs('v.h264', 'o.mp4', FPS)).toContain('-r');
  });
});
