/**
 * WS3 Round 10, Blocker 3 — checkpoint WRITING at rotation seams, and the
 * proof that a resumed run and an uninterrupted run of the same timeline
 * produce identical picture counts.
 *
 * This file deliberately uses a fake ffmpeg that keeps REAL BYTES: append,
 * truncate-to-offset, concat, file size and picture count are all the genuine
 * operations over an in-memory buffer, and the picture count is the same
 * access-unit counter the native guard runs. A fake that returned canned
 * numbers could not tell a correct checkpoint from a wrong one — which is the
 * only question this file is asking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';
import type { ExportWorkerInboundMessage, ExportWorkerOutboundMessage } from './exportWorker';
import { NO_FLUSH_OBSERVATION, type ExportWorkerDiagnosticsPayload } from './exportWorkerDiagnostics';
import {
  buildSyntheticSingleSliceWithParamSets,
  countAnnexbAccessUnits,
  scanAnnexbNals,
} from './annexbFrameCount';
import { validateExportState, type ExportStateManifest } from './exportCheckpoint';

vi.mock('../plainSegment', () => ({
  isPlainVideoSegment: () => false,
  isPlainImageSegment: () => false,
}));
vi.mock('./glCompositable', () => ({
  isGlCompositableSegment: () => true,
  GL_TRANSITION_SLUGS: new Set<string>(),
}));
vi.mock('./muxOnly', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./muxOnly')>()),
  muxOnly: vi.fn(async () => undefined),
}));

// eslint-disable-next-line import/first
import {
  exportProjectWebCodecs,
  type ExportWorkerHandle,
  type WebCodecsFfmpeg,
} from './exportPipelineWebCodecs';

const FPS = 30;
const FRAMES = 30;
const SESSION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

// ── The bitstream ───────────────────────────────────────────────────────────
// One access unit per frame, shaped like real encoder output: parameter sets
// and an AUD LEAD each picture. Split into one chunk per picture so the
// orchestrator's batching sees the same granularity the worker produces.
const STREAM = buildSyntheticSingleSliceWithParamSets(FRAMES);

function accessUnitSpans(): { start: number; end: number }[] {
  const nals = scanAnnexbNals(STREAM);
  const starts: number[] = [];
  for (let i = 0; i < nals.length; i++) {
    if (nals[i]!.nalType !== 1 && nals[i]!.nalType !== 5) continue;
    let j = i - 1;
    while (j >= 0 && nals[j]!.nalType !== 1 && nals[j]!.nalType !== 5) j--;
    starts.push(nals[j + 1]!.start);
  }
  return starts.map((start, i) => ({ start, end: starts[i + 1] ?? STREAM.length }));
}
const AU = accessUnitSpans();
expectAuCount();
function expectAuCount(): void {
  if (AU.length !== FRAMES) throw new Error(`fixture has ${AU.length} access units, expected ${FRAMES}`);
}
function auBytes(index: number): Uint8Array {
  return STREAM.subarray(AU[index]!.start, AU[index]!.end);
}

// ── A byte-real fake ffmpeg ────────────────────────────────────────────────
interface ByteFfmpeg {
  ffmpeg: WebCodecsFfmpeg;
  files: Map<string, Uint8Array>;
  manifests: string[];
}

function byteFfmpeg(seed: Record<string, Uint8Array> = {}): ByteFfmpeg {
  const files = new Map<string, Uint8Array>(Object.entries(seed));
  const manifests: string[] = [];
  const read = (p: string): Uint8Array => files.get(p) ?? new Uint8Array();
  const ffmpeg = {
    sessionId: SESSION_ID,
    writeExportState: vi.fn(async (s: string) => { manifests.push(s); }),
    writeFile: vi.fn(async (p: string, d: Uint8Array) => { files.set(p, d); }),
    writeFileRaw: vi.fn(async () => undefined),
    exec: vi.fn(async () => 0),
    readFile: vi.fn(async (p: string) => read(p)),
    deleteFile: vi.fn(async () => undefined),
    appendFileRaw: vi.fn(async (p: string, d: Uint8Array) => {
      const prev = read(p);
      const next = new Uint8Array(prev.length + d.length);
      next.set(prev, 0);
      next.set(d, prev.length);
      files.set(p, next);
    }),
    saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    sessionFileSize: vi.fn(async (p: string) => read(p).length),
    countAnnexbFrames: vi.fn(async (p: string) => countAnnexbAccessUnits(read(p))),
    concatAnnexbPieces: vi.fn(async (parts: string[], out: string) => {
      const total = parts.reduce((n, p) => n + read(p).length, 0);
      const buf = new Uint8Array(total);
      let at = 0;
      for (const p of parts) { buf.set(read(p), at); at += read(p).length; }
      files.set(out, buf);
    }),
    truncateAnnexb: vi.fn(async (p: string) => ({ pictures: countAnnexbAccessUnits(read(p)).pictures, vclNals: 0, bytesRemoved: 0, keptBytes: read(p).length })),
    truncateAnnexbToOffset: vi.fn(async (p: string, off: number) => {
      const prev = read(p);
      files.set(p, prev.slice(0, off));
      return { ...countAnnexbAccessUnits(prev.slice(0, off)), bytesRemoved: prev.length - off, keptBytes: off };
    }),
  } as unknown as WebCodecsFfmpeg;
  return { ffmpeg, files, manifests };
}

class FakeWorker implements ExportWorkerHandle {
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  initMessages: Extract<ExportWorkerInboundMessage, { type: 'init' }>[] = [];
  postMessage(message: unknown): void {
    const msg = message as ExportWorkerInboundMessage;
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
    id: 'proj-resume', name: 'T', script: '', sceneDetails: '',
    segments: [segment], assets: [asset],
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

function diagnostics(): ExportWorkerDiagnosticsPayload {
  return {
    phaseMs: {}, instrumentationMs: 0, demuxSplit: [], framesEncoded: FRAMES, pieceIndex: 0,
    lastPhase: 'encoder-flush', phaseLog: [], failure: null, demuxCacheSize: null, workerHeapBytes: null,
    decodedSourceFrames: 0, encodedChunkCount: FRAMES, encodedKeyframeCount: 1, encodedChunkBytes: 0,
    encodedChunkCountAtFlushStart: FRAMES,
    ...NO_FLUSH_OBSERVATION,
    encoderSessionIndex: 0, encoderSessions: 3, appendPendingAtFailure: null,
    decodersCreated: 0, decodersOpen: 0, cursorsCreated: 0, openCursors: 0,
    peakOpenCursors: 0, openImageBitmaps: 0, frameContentDigest: null, frameContentDigestFrames: null,
  };
}

function chunkFor(frame: number): Extract<ExportWorkerOutboundMessage, { type: 'chunk' }> {
  const b = auBytes(frame);
  const copy = new Uint8Array(b.length);
  copy.set(b);
  return { type: 'chunk', runId: 'run_0', bytes: copy.buffer, chunkType: frame === 0 ? 'key' : 'delta', timestamp: frame };
}

/**
 * Drains microtasks AND yields one macrotask.
 *
 * The macrotask yield matters: the checkpoint writer's timeline hash comes from
 * `crypto.subtle.digest`, which settles on a macrotask, and the export
 * deliberately never awaits it (awaiting it would move worker construction one
 * macrotask later on the clean path). In production the first rotation is
 * ~60 s in and the hash has landed long before; a unit test has to give it the
 * tick explicitly.
 */
async function flush(ticks = 40): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

/** Rotations at frames 10 and 20 — the same shape `planEncoderSessions`
 *  produces, just at a size a unit test can run. */
const ROTATIONS = [
  { sessionIndex: 1, frameIndex: 10 },
  { sessionIndex: 2, frameIndex: 20 },
];

async function driveWholeRun(
  fake: FakeWorker,
  fromFrame: number,
  rotations: readonly { sessionIndex: number; frameIndex: number }[],
): Promise<void> {
  fake.emit({ type: 'session-plan', pieceIndex: 0, sessions: 3, capFrames: 1800, totalFrames: FRAMES });
  for (let frame = fromFrame; frame < FRAMES; frame++) {
    const rotation = rotations.find((r) => r.frameIndex === frame);
    if (rotation) {
      await flush();
      fake.emit({ type: 'session-rotate', pieceIndex: 0, sessionIndex: rotation.sessionIndex, sessions: 3, frameIndex: frame });
      await flush();
    }
    fake.emit(chunkFor(frame));
  }
  await flush();
  fake.emit({ type: 'run-done', runId: 'run_0', frameCount: FRAMES });
  fake.emit({ type: 'done', frameCount: FRAMES, diagnostics: diagnostics() });
  await flush();
}

function latestManifest(serialized: string[]): ExportStateManifest {
  const last = serialized[serialized.length - 1]!;
  const parsed = JSON.parse(last) as ExportStateManifest;
  return parsed;
}

describe('durable checkpoints — written at rotation seams', () => {
  beforeEach(() => vi.clearAllMocks());

  it('an uninterrupted run writes a manifest whose every checkpoint the fence would ACCEPT', async () => {
    const { ffmpeg, files, manifests } = byteFfmpeg();
    const fake = new FakeWorker();
    const p = exportProjectWebCodecs(project(), ffmpeg, { width: 1920, height: 1080, fps: FPS }, () => undefined, { createWorker: () => fake });
    await flush();
    await driveWholeRun(fake, 0, ROTATIONS);
    const r = await p;
    expect(r.ok).toBe(true);

    const manifest = latestManifest(manifests);
    expect(manifest.sessionId).toBe(SESSION_ID);
    expect(manifest.checkpoints.length).toBe(ROTATIONS.length);

    const finalBytes = files.get('piece_0.h264')!;
    expect(countAnnexbAccessUnits(finalBytes).pictures).toBe(FRAMES);

    for (const cp of manifest.checkpoints) {
      // 1. The recorded picture count is the truth about the recorded prefix.
      expect(countAnnexbAccessUnits(finalBytes.subarray(0, cp.byteOffset)).pictures)
        .toBe(cp.cumulativePictures);
      // 2. And it is exactly the rotation's own frame index.
      expect(ROTATIONS.map((x) => x.frameIndex)).toContain(cp.cumulativePictures);
      // 3. The seam is recorded, sits BEFORE the verified offset, and holds
      //    the same picture count — the two facts the step-back rests on.
      expect(cp.seamByteOffset).toBeLessThan(cp.byteOffset);
      expect(countAnnexbAccessUnits(finalBytes.subarray(0, cp.seamByteOffset!)).pictures)
        .toBe(cp.cumulativePictures);
      // 4. The fence's step 5 accepts the verified offset — this is the
      //    property the whole placement rule exists to satisfy.
      const { truncateAnnexbToLastCompleteAu } = await import('./annexbFrameCount');
      expect(truncateAnnexbToLastCompleteAu(finalBytes.subarray(0, cp.byteOffset)).bytesRemoved).toBe(0);
    }
  });

  it('THE CONTROL: the raw rotation seam would have been rejected by the fence', async () => {
    const { ffmpeg, files, manifests } = byteFfmpeg();
    const fake = new FakeWorker();
    const p = exportProjectWebCodecs(project(), ffmpeg, { width: 1920, height: 1080, fps: FPS }, () => undefined, { createWorker: () => fake });
    await flush();
    await driveWholeRun(fake, 0, ROTATIONS);
    await p;

    const finalBytes = files.get('piece_0.h264')!;
    const { truncateAnnexbToLastCompleteAu } = await import('./annexbFrameCount');
    for (const cp of latestManifest(manifests).checkpoints) {
      const seam = AU[cp.cumulativePictures]!.start; // the naive checkpoint
      expect(cp.byteOffset).toBeGreaterThan(seam);
      expect(truncateAnnexbToLastCompleteAu(finalBytes.subarray(0, seam)).bytesRemoved).toBeGreaterThan(0);
    }
  });

  it('the manifest validates against the timeline it was written for, and not against a different one', async () => {
    const { ffmpeg, manifests } = byteFfmpeg();
    const fake = new FakeWorker();
    const p = exportProjectWebCodecs(project(), ffmpeg, { width: 1920, height: 1080, fps: FPS }, () => undefined, { createWorker: () => fake });
    await flush();
    await driveWholeRun(fake, 0, ROTATIONS);
    await p;

    const serialized = manifests[manifests.length - 1]!;
    const written = latestManifest(manifests);
    const good = validateExportState(serialized, {
      projectId: 'proj-resume', sourceTimelineHash: written.sourceTimelineHash,
      fps: FPS, width: 1920, height: 1080,
    }, Number.MAX_SAFE_INTEGER);
    expect(good.kind).toBe('resume');

    const stale = validateExportState(serialized, {
      projectId: 'proj-resume', sourceTimelineHash: 'f'.repeat(64),
      fps: FPS, width: 1920, height: 1080,
    }, Number.MAX_SAFE_INTEGER);
    expect(stale.kind).toBe('clean');
  });
});

describe('resumed vs uninterrupted', () => {
  beforeEach(() => vi.clearAllMocks());

  it('produce byte-identical output and identical picture counts', async () => {
    // ── The uninterrupted control ───────────────────────────────────────────
    const control = byteFfmpeg();
    const controlWorker = new FakeWorker();
    const controlRun = exportProjectWebCodecs(project(), control.ffmpeg, { width: 1920, height: 1080, fps: FPS }, () => undefined, { createWorker: () => controlWorker });
    await flush();
    await driveWholeRun(controlWorker, 0, ROTATIONS);
    expect((await controlRun).ok).toBe(true);
    const controlBytes = control.files.get('piece_0.h264')!;
    const checkpoint = latestManifest(control.manifests).checkpoints[1]!; // the second rotation

    // ── The crash ───────────────────────────────────────────────────────────
    // The surviving file holds the checkpoint's prefix — exactly what the
    // native fence leaves behind once it has truncated to the recorded offset.
    // The fence verifies at `byteOffset`, then the caller steps back to the
    // seam. Both prefixes hold the same picture count — that equality is the
    // reason the step-back is safe, so assert it here too.
    expect(countAnnexbAccessUnits(controlBytes.slice(0, checkpoint.byteOffset)).pictures)
      .toBe(checkpoint.cumulativePictures);
    const survivor = controlBytes.slice(0, checkpoint.seamByteOffset!);
    expect(countAnnexbAccessUnits(survivor).pictures).toBe(checkpoint.cumulativePictures);

    // ── The resume ──────────────────────────────────────────────────────────
    const resumed = byteFfmpeg({ 'piece_0.h264': survivor });
    const resumedWorker = new FakeWorker();
    const resumedRun = exportProjectWebCodecs(
      project(), resumed.ffmpeg, {
        width: 1920, height: 1080, fps: FPS,
        resume: {
          pieceIndex: checkpoint.pieceIndex,
          encoderSessionIndex: checkpoint.encoderSessionIndex,
          // The SEAM, not the fence's verification offset — see
          // `ExportCheckpointRecord.seamByteOffset`. Discovery performs this
          // step-back for real (`exportResumeDiscovery.ts`); here the survivor
          // buffer below is seeded to the same state.
          byteOffset: checkpoint.seamByteOffset!,
          cumulativePictures: checkpoint.cumulativePictures,
        },
      }, () => undefined, { createWorker: () => resumedWorker },
    );
    await flush();
    await driveWholeRun(resumedWorker, checkpoint.cumulativePictures, []);
    const r = await resumedRun;
    expect(r.ok).toBe(true);

    // THE PROOF: same picture count, and the same bytes.
    const resumedBytes = resumed.files.get('piece_0.h264')!;
    expect(countAnnexbAccessUnits(resumedBytes).pictures).toBe(FRAMES);
    expect(countAnnexbAccessUnits(resumedBytes).pictures)
      .toBe(countAnnexbAccessUnits(controlBytes).pictures);
    expect(Array.from(resumedBytes)).toEqual(Array.from(controlBytes));

    // The resumed run re-rendered only what was missing — its worker was told
    // to start at the checkpoint's frame, not at 0.
    expect(resumedWorker.initMessages[0]!.resumeFromFrameIndex).toBe(checkpoint.cumulativePictures);

  });

  it('a resumed run does NOT restart the manifest — a second crash rewinds to the newest rotation', async () => {
    const control = byteFfmpeg();
    const controlWorker = new FakeWorker();
    const run = exportProjectWebCodecs(project(), control.ffmpeg, { width: 1920, height: 1080, fps: FPS }, () => undefined, { createWorker: () => controlWorker });
    await flush();
    await driveWholeRun(controlWorker, 0, ROTATIONS);
    await run;
    const checkpoint = latestManifest(control.manifests).checkpoints[0]!;

    const resumed = byteFfmpeg({ 'piece_0.h264': control.files.get('piece_0.h264')!.slice(0, checkpoint.seamByteOffset!) });
    const worker = new FakeWorker();
    const resumedRun = exportProjectWebCodecs(
      project(), resumed.ffmpeg, {
        width: 1920, height: 1080, fps: FPS,
        resume: {
          pieceIndex: 0,
          encoderSessionIndex: checkpoint.encoderSessionIndex,
          byteOffset: checkpoint.seamByteOffset!,
          cumulativePictures: checkpoint.cumulativePictures,
          manifest: { ...latestManifest(control.manifests), checkpoints: [checkpoint] },
        },
      }, () => undefined, { createWorker: () => worker },
    );
    await flush();
    await driveWholeRun(worker, checkpoint.cumulativePictures, [ROTATIONS[1]!]);
    expect((await resumedRun).ok).toBe(true);

    // The resumed run never called beginPiece, so it never wrote an empty
    // manifest over the one on disk. Its own new rotation is appended to it.
    const manifest = latestManifest(resumed.manifests);
    expect(manifest.checkpoints.map((c) => c.cumulativePictures)).toEqual([10, 20]);
    // …and that checkpoint's offset is ABSOLUTE in the file, not local to the
    // resumed invocation's own append counter.
    const newest = manifest.checkpoints[1]!;
    expect(newest.byteOffset).toBeGreaterThan(checkpoint.byteOffset);
    expect(newest.seamByteOffset).toBeLessThan(newest.byteOffset);
    expect(countAnnexbAccessUnits(resumed.files.get('piece_0.h264')!.subarray(0, newest.byteOffset)).pictures).toBe(20);
  });

  it('CLEAN-PATH NEUTRALITY: an ffmpeg with no checkpoint surface exports unchanged and writes nothing', async () => {
    const { ffmpeg, files } = byteFfmpeg();
    // Strip the two optional members — the shape every pre-existing fake has.
    const stripped = { ...(ffmpeg as unknown as Record<string, unknown>) };
    delete stripped.sessionId;
    delete stripped.writeExportState;
    const fake = new FakeWorker();
    const p = exportProjectWebCodecs(project(), stripped as unknown as WebCodecsFfmpeg, { width: 1920, height: 1080, fps: FPS }, () => undefined, { createWorker: () => fake });
    await flush();
    await driveWholeRun(fake, 0, ROTATIONS);
    expect((await p).ok).toBe(true);
    expect(countAnnexbAccessUnits(files.get('piece_0.h264')!).pictures).toBe(FRAMES);
  });
});
