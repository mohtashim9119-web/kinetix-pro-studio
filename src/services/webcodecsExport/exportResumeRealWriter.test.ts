/**
 * Resume after a cancel, against the REAL checkpoint writer.
 *
 * The G2 test proved only that a retained session survives a non-forced
 * destroy — with a manifest the FAKE session wrote itself. The live incident
 * (cancelled at ~7%, Retry restarted from 0%) lived in the part that test never
 * ran: when does the real engine write a usable checkpoint, and does Retry find
 * and use it? Everything below runs the real orchestrator, writer, manifest
 * validation, discovery and fence logic over real Annex-B bytes; only the
 * process boundary (ffmpeg IPC, the worker thread) and the encoders are fake.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';

vi.mock('../plainSegment', () => ({
  isPlainVideoSegment: () => false,
  isPlainImageSegment: () => false,
}));
// Segment ids starting with "g" are GL-compositable; everything else is canvas tier.
vi.mock('./glCompositable', () => ({
  isGlCompositableSegment: (seg: { id: string }) => seg.id.startsWith('g'),
  GL_TRANSITION_SLUGS: new Set<string>(),
}));
vi.mock('../segmentEncoder', () => ({
  encodeSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  encodePlainVideoSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  encodeStaticImageSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
vi.mock('./muxOnly', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./muxOnly')>()),
  muxOnly: vi.fn(async () => undefined),
}));

// eslint-disable-next-line import/first
import { exportProjectWebCodecs, cancelExportWebCodecs, createExportRunControl, type WebCodecsFfmpeg } from './exportPipelineWebCodecs';
import { encodeSegment } from '../segmentEncoder';
import { muxOnly } from './muxOnly';
import { adoptRankedResume, rankResumeCandidates, type ResumeCandidateOutcome } from './exportResumeDiscovery';
import { buildExpectedIdentity } from './exportResumeSession';
import { countAnnexbAccessUnits } from './annexbFrameCount';
import type { ExportStateManifest } from './exportCheckpoint';
import type { ExportStage } from '../exportPipeline';
import { progressFor } from '../../hooks/useExport';
import {
  FPS, FakeWorker, byteFfmpeg, discoveryIoFor, feedFrames, finishRun, flush, makeStream,
  type ByteFfmpeg, type Rotation,
} from './exportResumeRealWriterHarness';

const FRAMES = 30;                       // one second per piece
const DIMS = { width: 1920, height: 1080, fps: FPS };
const { au } = makeStream(FRAMES);

const seg = (id: string, order: number): VideoSegment => ({
  id, text: '', assetId: `a${order}`, startTime: order, duration: 1,
  transition: TransitionType.NONE, animation: AnimationType.NONE, order,
});
const assetFor = (order: number): Asset => ({ id: `a${order}`, name: `a${order}.mp4`, url: `blob:a${order}`, type: 'video' });
function project(ids: string[]): Project {
  return {
    id: 'proj-real', name: 'T', script: '', sceneDetails: '',
    segments: ids.map((id, i) => seg(id, i)), assets: ids.map((_, i) => assetFor(i)),
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

const manifestOf = (f: ByteFfmpeg): ExportStateManifest => JSON.parse(f.manifestOnDisk()!) as ExportStateManifest;

/**
 * What the NEXT export does against the surviving session: the read-only
 * offer (`findResumeOffer`'s Phase A), then — the operator answered Resume —
 * adoption (`adoptResumeOffer`'s Phase B). The offer must not touch a byte.
 */
async function discover(f: ByteFfmpeg, p: Project, pieceCount: number): Promise<ResumeCandidateOutcome> {
  const expected = await buildExpectedIdentity(p, DIMS);
  const target = { expected, pieceExpectedFrames: Array.from({ length: pieceCount }, () => FRAMES) };
  const count = async (session: { countAnnexbFrames?: unknown }, path: string): Promise<number> =>
    countAnnexbAccessUnits(f.files.get(path) ?? new Uint8Array()).pictures + 0 * Number(!!session);
  const io = discoveryIoFor(f);
  const before = new Map([...f.files].map(([k, v]) => [k, v.slice()]));
  const { ranked, rejected } = await rankResumeCandidates(io, target, await io.listResumableSessionIds(), () => null);
  expect(f.files).toEqual(before);
  expect(f.fencePending()).toBe(false);
  if (ranked.length === 0) {
    const first = rejected[0];
    return first ? { ok: false, ...first } : { ok: false, reason: 'no surviving session' };
  }
  const adopted = await adoptRankedResume(io, ranked, target, count as never);
  return adopted.resumable ? { ok: true, value: adopted.resumable } : { ok: false, ...adopted.rejected[0]! };
}

/** The resume plan `useExport` builds from an offer. */
function resumePlanOf(found: Extract<Awaited<ReturnType<typeof discover>>, { ok: true }>) {
  const r = found.value;
  return {
    pieceIndex: r.checkpoint.pieceIndex,
    encoderSessionIndex: r.checkpoint.encoderSessionIndex,
    byteOffset: r.appendFromByteOffset,
    fencedByteOffset: r.fencedByteOffset,
    cumulativePictures: r.checkpoint.cumulativePictures,
    manifest: r.manifest,
  };
}

const stagesOf = (): { stages: ExportStage[]; onProgress: (s: ExportStage) => void } => {
  const stages: ExportStage[] = [];
  return { stages, onProgress: (s) => { stages.push(s); } };
};
const firstEncodeStage = (stages: ExportStage[]): Extract<ExportStage, { type: 'encoding_segment' }> | undefined =>
  stages.find((x): x is Extract<ExportStage, { type: 'encoding_segment' }> => x.type === 'encoding_segment');
const firstEncodeFrame = (stages: ExportStage[]): number | null => firstEncodeStage(stages)?.frame ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(encodeSegment).mockReset();
  vi.mocked(encodeSegment).mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe('GL tier — cancel mid-first-piece', () => {
  const ROTATIONS: Rotation[] = [{ sessionIndex: 1, frameIndex: 10 }, { sessionIndex: 2, frameIndex: 20 }];

  async function cancelledAt(frames: number): Promise<{ f: ByteFfmpeg; p: Project }> {
    const p = project(['g0']);
    const f = byteFfmpeg();
    const w = new FakeWorker();
    const control = createExportRunControl();
    const run = exportProjectWebCodecs(p, f.ffmpeg, { ...DIMS, control }, () => undefined, { createWorker: () => w });
    void run.catch(() => undefined);
    await flush();
    await feedFrames(w, au, 0, frames, ROTATIONS, FRAMES, 3);
    // The orchestrator batches appends (flushed after APPEND_BATCH_MAX_AGE_MS = 1 s)
    // and places a rotation's checkpoint with the first append after the seam, so a
    // checkpoint is durable ~1 s after its rotation. A human's cancel click lands later.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await cancelExportWebCodecs(control, { keepForResume: true });
    return { f, p };
  }

  it('D7.1b — six cancel → Retry → cancel-before-the-first-append cycles: the same checkpoint is offered every time, nothing charged, the file never shorter than the checkpoint', async () => {
    const { f, p } = await cancelledAt(15);
    const cp = manifestOf(f).checkpoints[0]!;
    expect(cp.seamByteOffset).toBeLessThan(cp.byteOffset); // the case under test
    for (let cycle = 1; cycle <= 6; cycle++) {
      const found = await discover(f, p, 1);
      expect(found.ok, `cycle ${cycle}`).toBe(true);
      if (!found.ok) return;
      expect(found.value.checkpoint.cumulativePictures).toBe(10);
      expect(f.files.get('piece_0.h264')!.length, `cycle ${cycle}: adoption cut below the checkpoint`).toBeGreaterThanOrEqual(cp.byteOffset);
      const w2 = new FakeWorker();
      const c2 = createExportRunControl();
      const run2 = exportProjectWebCodecs(p, f.ffmpeg, { ...DIMS, control: c2, resume: resumePlanOf(found) }, () => undefined, { createWorker: () => w2 });
      void run2.catch(() => undefined);
      await flush();
      await cancelExportWebCodecs(c2, { keepForResume: true }); // before the resumed run appends anything
      expect(f.destroyed()).toBe(false);
      expect(manifestOf(f).totalRecoveryAttempts ?? 0).toBe(0);
      expect(f.files.get('piece_0.h264')!.length).toBeGreaterThanOrEqual(cp.byteOffset);
    }
  }, 30_000);

  it('D7.1b — backstop: a file an older build already stepped back to the rotation seam is still offered, at the seam', async () => {
    const { f, p } = await cancelledAt(15);
    const cp = manifestOf(f).checkpoints[0]!;
    f.files.set('piece_0.h264', f.files.get('piece_0.h264')!.slice(0, cp.seamByteOffset));
    const found = await discover(f, p, 1);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.checkpoint.cumulativePictures).toBe(10);
    expect(found.value.appendFromByteOffset).toBe(cp.seamByteOffset);
    expect(countAnnexbAccessUnits(f.files.get('piece_0.h264')!).pictures).toBe(10);
  });

  it('pin — the crash-repair path still drops an incomplete trailing picture before a resume', async () => {
    const { f, p } = await cancelledAt(15);
    const cp = manifestOf(f).checkpoints[0]!;
    const onDisk = f.files.get('piece_0.h264')!;
    // A crash mid-write: half of the next picture landed after the checkpoint.
    const torn = au(11).slice(0, Math.max(1, Math.floor(au(11).length / 2)));
    const withTail = new Uint8Array(onDisk.length + torn.length);
    withTail.set(onDisk, 0);
    withTail.set(torn, onDisk.length);
    f.files.set('piece_0.h264', withTail);
    const found = await discover(f, p, 1);
    expect(found.ok).toBe(true);
    const kept = f.files.get('piece_0.h264')!;
    expect(kept.length).toBe(cp.byteOffset);
    expect(countAnnexbAccessUnits(kept).pictures).toBe(10);
  });

  it('D7.1a — an operator cancel of a resumed run charges nothing: no marker, no attempt on disk', async () => {
    const { f, p } = await cancelledAt(15);
    const found = await discover(f, p, 1);
    if (!found.ok) throw new Error('expected an offer');
    const w2 = new FakeWorker();
    const c2 = createExportRunControl();
    const run2 = exportProjectWebCodecs(p, f.ffmpeg, { ...DIMS, control: c2, resume: resumePlanOf(found) }, () => undefined, { createWorker: () => w2 });
    void run2.catch(() => undefined);
    await flush();
    expect(manifestOf(f).resumeAttemptInFlight, 'the attempt is in flight while the run runs').toBe(true);
    await cancelExportWebCodecs(c2, { keepForResume: true });
    expect(manifestOf(f).resumeAttemptInFlight).toBeUndefined();
    expect(manifestOf(f).totalRecoveryAttempts ?? 0).toBe(0);
  });

  it('D7.1a — a resumed run that fails by itself without progress still charges its attempt', async () => {
    const { f, p } = await cancelledAt(15);
    const found = await discover(f, p, 1);
    if (!found.ok) throw new Error('expected an offer');
    vi.mocked(f.ffmpeg.appendFileRaw).mockRejectedValue(new Error('EIO: device went away'));
    const w2 = new FakeWorker();
    const run2 = exportProjectWebCodecs(p, f.ffmpeg, { ...DIMS, control: createExportRunControl(), resume: resumePlanOf(found) }, () => undefined, { createWorker: () => w2 });
    await flush();
    await feedFrames(w2, au, 10, 12, [], FRAMES, 3);
    await new Promise((r) => setTimeout(r, 1100));
    const r = await run2;
    expect(r.ok).toBe(false);
    expect(manifestOf(f).resumeAttemptInFlight).toBeUndefined();
    expect(manifestOf(f).totalRecoveryAttempts).toBe(1);
  });

  it('cancel after the first rotation → the REAL writer left a checkpoint at the stop point, and Retry resumes there', async () => {
    const { f, p } = await cancelledAt(15);
    expect(f.destroyed(), 'the session must survive a bulk cancel').toBe(false);
    const m = manifestOf(f);
    expect(m.checkpoints.map(c => c.cumulativePictures)).toEqual([10]);   // written by the real writer

    const found = await discover(f, p, 1);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.checkpoint.cumulativePictures).toBe(10);
    expect(found.value.picturesAlreadyRendered).toBe(10);
    // Discovery fenced the session: the native gate is open for appends.
    expect(f.fencePending()).toBe(false);
    // …and the offer carries THE handle that was fenced, for the export to run on.
    expect(found.value.session.sessionId).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');

    // Retry: a second run continues from frame 10, not frame 0.
    const { stages, onProgress } = stagesOf();
    const w2 = new FakeWorker();
    let muxedVideo: Uint8Array | undefined;
    vi.mocked(muxOnly).mockImplementationOnce(async (...args: unknown[]) => { muxedVideo = f.files.get(args[2] as string)?.slice(); });
    const run2 = exportProjectWebCodecs(p, f.ffmpeg, { ...DIMS, resume: resumePlanOf(found) }, onProgress, { createWorker: () => w2 });
    await flush();
    expect(w2.initMessages[0]!.resumeFromFrameIndex).toBe(10);
    await feedFrames(w2, au, 10, FRAMES, [ROTATIONS[1]!], FRAMES, 3);
    await finishRun(w2, FRAMES, 3);
    const r = await run2;
    expect(r.ok).toBe(true);

    // Valid output: every frame, once.
    // The file handed to the mux holds every frame, once.
    expect(countAnnexbAccessUnits(muxedVideo!).pictures).toBe(FRAMES);
    // The bar STARTS at the resumed position (10 of 30 frames → 30%), not 0%.
    expect(firstEncodeFrame(stages)).toBe(10);
    expect(progressFor(firstEncodeStage(stages)!)).toBe(30);
  });

  it('LIVE INCIDENT: re-entering the session AGAIN after the fence (what useExport used to do) re-arms the native fence — the resume must fail FAST with the real cause, not stall 45 s', async () => {
    const { f, p } = await cancelledAt(15);
    const found = await discover(f, p, 1);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    await discoveryIoFor(f).reenter('3f2504e0-4f89-41d3-9a0c-0305e82c3301');   // the second reenter
    expect(f.fencePending()).toBe(true);

    const w2 = new FakeWorker();
    const run2 = exportProjectWebCodecs(p, f.ffmpeg, { ...DIMS, resume: resumePlanOf(found) }, () => undefined, { createWorker: () => w2 });
    await flush();
    await feedFrames(w2, au, 10, 25, [], FRAMES, 3);
    await new Promise((resolve) => setTimeout(resolve, 1100));        // the append batch flushes (and is refused)
    const r = await run2;                                              // settles by itself — no 45 s stall bound
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('has not passed checkpoint pre-append validation');
      expect(r.error.message).not.toMatch(/no forward progress/);
    }
  });

  it('useExport runs the resume on the handle discovery fenced — it never re-enters the session a second time', () => {
    const src = readFileSync(resolve(import.meta.dirname, '..', '..', 'hooks', 'useExport.ts'), 'utf-8');
    expect(src).toContain('resumeFfmpeg = adopted.resumable.session as unknown as WebCodecsFfmpeg;');
    expect(src).not.toMatch(/resumeFfmpeg = \(await TauriFfmpeg\.reenter/);
  });

  it('cancel before the first checkpoint → discovery says so (typed), never a silent restart', async () => {
    const { f, p } = await cancelledAt(5);
    expect(f.destroyed()).toBe(false);                    // the empty manifest keeps the session…
    expect(manifestOf(f).checkpoints).toEqual([]);
    const found = await discover(f, p, 1);               // …and the answer is "no checkpoint yet"
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.noCheckpointYet).toBe(true);
  });
});

describe('canvas tier — piece-boundary resume (no rotation checkpoints exist there)', () => {
  it('cancel during piece 1 → piece 0 is recorded finished; Retry re-renders only pieces 1 and 2', async () => {
    const p = project(['c0', 'c1', 'c2']);
    const f = byteFfmpeg({ framesPerPiece: FRAMES });
    let rejectBlocked: (e: Error) => void = () => {};
    let call = 0;
    vi.mocked(encodeSegment).mockImplementation(async () => {
      if (call++ < 1) return new Uint8Array([1, 2, 3]);
      return new Promise<Uint8Array>((_, reject) => { rejectBlocked = reject; });
    });
    (f.ffmpeg.kill as ReturnType<typeof vi.fn>).mockImplementation(async () => { rejectBlocked(new Error('ffmpeg killed')); });
    const control = createExportRunControl();
    const run = exportProjectWebCodecs(p, f.ffmpeg, { ...DIMS, control }, () => undefined);
    void run.catch(() => undefined);
    await vi.waitFor(() => expect(call).toBe(2));
    await flush();
    await cancelExportWebCodecs(control, { keepForResume: true });
    await run.catch(() => undefined);

    expect(f.destroyed()).toBe(false);
    expect(manifestOf(f).completedPieces).toBe(1);        // written by the real writer

    const found = await discover(f, p, 3);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.checkpoint.pieceIndex).toBe(1);
    expect(found.value.checkpoint.cumulativePictures).toBe(0);
    expect(found.value.picturesAlreadyRendered).toBe(FRAMES);

    vi.mocked(encodeSegment).mockReset();
    vi.mocked(encodeSegment).mockResolvedValue(new Uint8Array([1, 2, 3]));
    const { stages, onProgress } = stagesOf();
    const r = await exportProjectWebCodecs(p, f.ffmpeg, { ...DIMS, resume: resumePlanOf(found) }, onProgress);
    expect(r.ok).toBe(true);
    expect(encodeSegment).toHaveBeenCalledTimes(2);       // pieces 1 and 2 — piece 0 was kept
    // Valid output: all three pieces, in order, every frame.
    expect(f.lastConcat()).toEqual({ parts: ['piece_0.h264', 'piece_1.h264', 'piece_2.h264'], pictures: FRAMES * 3 });
    // Progress starts where the finished piece ends: 30 of 90 frames → 30%.
    expect(firstEncodeFrame(stages)).toBe(FRAMES);
    expect(progressFor(firstEncodeStage(stages)!)).toBe(30);
  });

  it('cancel inside piece 0 → nothing finished yet → honest "no checkpoint yet"', async () => {
    const p = project(['c0', 'c1']);
    const f = byteFfmpeg({ framesPerPiece: FRAMES });
    let rejectBlocked: (e: Error) => void = () => {};
    vi.mocked(encodeSegment).mockImplementation(() => new Promise<Uint8Array>((_, reject) => { rejectBlocked = reject; }));
    (f.ffmpeg.kill as ReturnType<typeof vi.fn>).mockImplementation(async () => { rejectBlocked(new Error('ffmpeg killed')); });
    const control = createExportRunControl();
    const run = exportProjectWebCodecs(p, f.ffmpeg, { ...DIMS, control }, () => undefined);
    void run.catch(() => undefined);
    await vi.waitFor(() => expect(encodeSegment).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));   // the timeline hash settles on a macrotask
    await flush();
    await cancelExportWebCodecs(control, { keepForResume: true });
    await run.catch(() => undefined);

    expect(manifestOf(f).completedPieces).toBe(0);
    const found = await discover(f, p, 2);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.noCheckpointYet).toBe(true);
  });
});

describe('mixed canvas + GL — a fresh GL piece does not forget the finished canvas piece', () => {
  it('cancel in the GL piece before its first rotation → resumes at the GL piece start, canvas piece kept', async () => {
    const p = project(['c0', 'g1']);
    const f = byteFfmpeg({ framesPerPiece: FRAMES });
    const w = new FakeWorker();
    const control = createExportRunControl();
    const run = exportProjectWebCodecs(p, f.ffmpeg, { ...DIMS, control }, () => undefined, { createWorker: () => w });
    void run.catch(() => undefined);
    await vi.waitFor(() => expect(w.initMessages.length).toBe(1));
    await flush();
    await feedFrames(w, au, 0, 6, [], FRAMES, 1, 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));   // let the append batch reach disk
    await cancelExportWebCodecs(control, { keepForResume: true });

    const m = manifestOf(f);
    expect(m.checkpoints).toEqual([]);
    expect(m.completedPieces).toBe(1);                     // carried through the GL piece's manifest reset
    const found = await discover(f, p, 2);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.checkpoint).toMatchObject({ pieceIndex: 1, cumulativePictures: 0 });

    // Retry: the stale partial GL file is discarded and the piece renders from its first frame.
    expect(f.files.get('piece_1.h264')?.length).toBeGreaterThan(0);
    vi.mocked(encodeSegment).mockClear();
    const { stages, onProgress } = stagesOf();
    const w2 = new FakeWorker();
    const run2 = exportProjectWebCodecs(p, f.ffmpeg, { ...DIMS, resume: resumePlanOf(found) }, onProgress, { createWorker: () => w2 });
    await vi.waitFor(() => expect(w2.initMessages.length).toBe(1));
    await flush();
    expect(encodeSegment).not.toHaveBeenCalled();          // canvas piece 0 is not re-encoded
    expect(w2.initMessages[0]!.resumeFromFrameIndex ?? 0).toBe(0);
    expect(f.files.get('piece_1.h264')?.length ?? 0).toBe(0);
    await feedFrames(w2, au, 0, FRAMES, [], FRAMES, 1, 1);
    await finishRun(w2, FRAMES, 1, 1);
    expect((await run2).ok).toBe(true);
    expect(f.lastConcat()).toEqual({ parts: ['piece_0.h264', 'piece_1.h264'], pictures: FRAMES * 2 });
    expect(firstEncodeFrame(stages)).toBe(FRAMES);         // starts at 30 of 60 frames → 45%
    expect(progressFor(firstEncodeStage(stages)!)).toBe(45);
  });
});

// Keep the type import used in strict configs.
export type _Unused = WebCodecsFfmpeg;
