/**
 * Orchestrator wiring test for the macOS-EMFILE concat fix.
 *
 * Confirms the multi-piece export path now concatenates pieces via the native
 * `ffmpeg.concatAnnexbPieces` helper (Rust `ffmpeg_concat_annexb_pieces`, only
 * 2 FDs open at a time) and hands the SINGLE resulting file to `muxOnly` — and,
 * critically, that it NEVER builds an ffmpeg concat-protocol pipe string
 * (`concat:piece_0.h264|...`), which opened every piece at once and exhausted
 * macOS's 256 per-process FD limit on large-segment exports.
 *
 * All IPC/encoder collaborators are mocked; the goal is the wiring, not real
 * ffmpeg. Uses three plain-image (Tier 1) segments — the exact bug scenario
 * (many single-segment pieces) and a path that spawns no worker and fetches no
 * fonts, keeping the test hermetic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';

// --- Mock the tier-routing predicates so all segments deterministically route
//     to Tier 1 (plain image), independent of the real predicates' details. ---
vi.mock('../plainSegment', () => ({
  isPlainVideoSegment: () => false,
  isPlainImageSegment: () => true,
}));
vi.mock('./glCompositable', () => ({
  isGlCompositableSegment: () => false,
  GL_TRANSITION_SLUGS: new Set<string>(),
}));

// --- Mock the encoders so no real ffmpeg/canvas work runs. ---
vi.mock('../segmentEncoder', () => ({
  encodeSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  encodePlainVideoSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  encodeStaticImageSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

// --- Mock the mux step so we can assert what video file it receives. ---
const muxOnlyMock = vi.fn(async (..._args: unknown[]) => undefined);
// WS3 Round 10 — PARTIAL module mock, made partial on purpose. The sealing
// seam (`forcedMp4SealOffer` / `sealTruncatedAnnexbToMp4`) now lives in this
// module and IS reached by the orchestrator's guard path, so a factory that
// returned only `muxOnly` deleted those two exports and turned a clean typed
// guard failure into "Failed to verify the concatenated output frame count".
// Spreading the real module keeps the seal logic honest while still stubbing
// the ffmpeg-invoking part.
vi.mock('./muxOnly', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./muxOnly')>()),
  muxOnly: (...args: unknown[]) => muxOnlyMock(...args),
}));

import { exportProjectWebCodecs, cancelExportWebCodecs, type WebCodecsFfmpeg } from './exportPipelineWebCodecs';
import { encodeStaticImageSegment } from '../segmentEncoder';
import {
  decideSessionRetentionOnFailure,
  type RetainableSession,
} from '../../hooks/exportSessionRetentionDecision';
import type { RetainForResumeReport } from '../tauriFfmpeg';

const FPS = 30;

function makeImageSegment(id: string, assetId: string, order: number): VideoSegment {
  return {
    id,
    text: '',
    assetId,
    startTime: order,
    duration: 1, // 1s @ 30fps -> 30 expected frames per plain-image piece
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order,
  };
}

function makeProject(): Project {
  const assets: Asset[] = [
    { id: 'a0', name: 'a0.png', url: 'blob:a0', type: 'image' },
    { id: 'a1', name: 'a1.png', url: 'blob:a1', type: 'image' },
    { id: 'a2', name: 'a2.png', url: 'blob:a2', type: 'image' },
  ];
  return {
    id: 'proj-1',
    name: 'Test',
    script: '',
    sceneDetails: '',
    segments: [
      makeImageSegment('s0', 'a0', 0),
      makeImageSegment('s1', 'a1', 1),
      makeImageSegment('s2', 'a2', 2),
    ],
    assets,
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

/** Fake WebCodecsFfmpeg — all methods are spies; `countAnnexbFrames` returns
 *  the expected total (3 pieces × 30 frames) so the post-concat guard passes. */
function makeFakeFfmpeg(): WebCodecsFfmpeg {
  return {
    writeFile: vi.fn(async () => undefined),
    writeFileRaw: vi.fn(async () => undefined),
    exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()),
    deleteFile: vi.fn(async () => undefined),
    appendFileRaw: vi.fn(async () => undefined),
    saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    sessionFileSize: vi.fn(async () => 1_700_000_000),
    countAnnexbFrames: vi.fn(async () => ({ pictures: 90, vclNals: 90 })),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb: vi.fn(async () => ({ pictures: 90, vclNals: 90, bytesRemoved: 0, keptBytes: 1000 })),
  } as unknown as WebCodecsFfmpeg;
}

describe('exportProjectWebCodecs — native AnnexB concat wiring', () => {
  beforeEach(() => {
    muxOnlyMock.mockClear();
  });

  it('concatenates pieces via ffmpeg.concatAnnexbPieces into a single file', async () => {
    const project = makeProject();
    const ffmpeg = makeFakeFfmpeg();

    const result = await exportProjectWebCodecs(project, ffmpeg, { width: 1920, height: 1080, fps: FPS });

    expect(result.ok).toBe(true);
    expect(ffmpeg.concatAnnexbPieces).toHaveBeenCalledTimes(1);
    expect(ffmpeg.concatAnnexbPieces).toHaveBeenCalledWith(
      ['piece_0.h264', 'piece_1.h264', 'piece_2.h264'],
      'video_all.h264',
    );
  });

  it('passes the single concatenated file to muxOnly', async () => {
    const project = makeProject();
    const ffmpeg = makeFakeFfmpeg();

    await exportProjectWebCodecs(project, ffmpeg, { width: 1920, height: 1080, fps: FPS });

    expect(muxOnlyMock).toHaveBeenCalledTimes(1);
    // muxOnly(ffmpeg, sessionId, videoFile, audioFile, outputFile, fps)
    const call = muxOnlyMock.mock.calls[0]!;
    expect(call[2]).toBe('video_all.h264');
    expect(call[3]).toBe(null); // no voiceover
    expect(call[4]).toBe('export_final.mp4');
  });

  it('never builds an ffmpeg concat-protocol pipe string', async () => {
    const project = makeProject();
    const ffmpeg = makeFakeFfmpeg();

    await exportProjectWebCodecs(project, ffmpeg, { width: 1920, height: 1080, fps: FPS });

    const execMock = ffmpeg.exec as unknown as ReturnType<typeof vi.fn>;
    for (const call of execMock.mock.calls) {
      const args = call[0] as string[];
      for (const arg of args) {
        expect(String(arg).startsWith('concat:')).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// WS2 Step 11 regression — the voiceover audio mux step must prefer an
// already-in-memory `voiceoverAsset.file` over `fetch(voiceoverAsset.url)`,
// same defect shape/fix as WS2 Step 10's `fetchAndDetectSilences` (a
// `blob:`-URL `fetch()` fails on Windows WebView2 where DOM-native consumption
// of the identical URL does not).
// ---------------------------------------------------------------------------
describe('exportProjectWebCodecs — voiceover mux fetch-avoidance (WS2 Step 11)', () => {
  beforeEach(() => {
    muxOnlyMock.mockClear();
  });

  function makeProjectWithVoiceover(voiceoverAsset: Asset): Project {
    const project = makeProject();
    return { ...project, assets: [...project.assets, voiceoverAsset], voiceoverId: voiceoverAsset.id };
  }

  it('uses voiceoverAsset.file directly and never calls fetch when a File is present', async () => {
    const file = new File(['fake-audio-bytes'], 'voiceover.mp3', { type: 'audio/mpeg' });
    const voiceoverAsset: Asset = { id: 'vo1', name: 'voiceover.mp3', url: 'blob:vo1', type: 'audio', file };
    const project = makeProjectWithVoiceover(voiceoverAsset);
    const ffmpeg = makeFakeFfmpeg();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await exportProjectWebCodecs(project, ffmpeg, { width: 1920, height: 1080, fps: FPS });

    expect(result.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(muxOnlyMock).toHaveBeenCalledTimes(1);
    const call = muxOnlyMock.mock.calls[0]!;
    expect(call[3]).toBe('voiceover_audio'); // audioFile, not null
    fetchSpy.mockRestore();
  });

  it('falls back to fetch(voiceoverAsset.url) when .file is absent', async () => {
    const voiceoverAsset: Asset = { id: 'vo1', name: 'voiceover.mp3', url: 'blob:vo1', type: 'audio' };
    const project = makeProjectWithVoiceover(voiceoverAsset);
    const ffmpeg = makeFakeFfmpeg();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(4),
    } as unknown as Response);

    const result = await exportProjectWebCodecs(project, ffmpeg, { width: 1920, height: 1080, fps: FPS });

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('blob:vo1');
    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// STEP 3b — the Machine 1 field incident: every piece fully rendered (its
// checkpoint written), then the MUX stage — not the render stage — fails
// with a disk error. Reproduced end to end through the REAL orchestrator and
// the REAL retention-decision function (`decideSessionRetentionOnFailure`,
// extracted from `useExport.ts` for exactly this reason) — not a synthetic
// unit slice of either. `retainForResume` below is a fake, but one that
// enforces the SAME keep/drop rule the native `is_resume_retained_file`
// does (see `session_claim.rs`), so a wrong caller (one that fails to call
// it, or calls it with the wrong session) is still caught.
// ---------------------------------------------------------------------------
describe('exportProjectWebCodecs — STEP 3b resume after a mux-stage failure', () => {
  beforeEach(() => {
    muxOnlyMock.mockClear();
    vi.mocked(encodeStaticImageSegment).mockClear();
  });

  /** Keeps only `piece_*.h264` and the manifest — the exact rule
   *  `is_resume_retained_file` (session_claim.rs) enforces natively. */
  function isResumeRetainedFile(name: string): boolean {
    if (name === 'export_state.json') return true;
    const m = /^piece_(\d+)\.h264$/.exec(name);
    return m !== null;
  }

  it('a non-ENOSPC mux disk error classifies as `mux`, not `disk_full` — the gap this step closes', async () => {
    const project = makeProject();
    const ffmpeg = makeFakeFfmpeg();
    // A genuine disk I/O error — the Machine 1 report — that is NOT
    // ENOSPC-shaped, so `isDiskFullError` must NOT reclassify it. Before
    // this step, `kind: 'mux'` never reached the retention gate at all.
    muxOnlyMock.mockRejectedValueOnce(new Error('EIO: i/o error, write'));

    const result = await exportProjectWebCodecs(project, ffmpeg, { width: 1920, height: 1080, fps: FPS });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mux');
    }
  });

  it('retains the fully-rendered pieces and manifest, dropping only the failed mux intermediates', async () => {
    const project = makeProject();
    const ffmpeg = makeFakeFfmpeg();
    muxOnlyMock.mockRejectedValueOnce(new Error('EIO: i/o error, write'));

    const result = await exportProjectWebCodecs(project, ffmpeg, { width: 1920, height: 1080, fps: FPS });
    expect(result.ok).toBe(false);

    // The disk state the real incident left behind: 3 rendered pieces, the
    // closing checkpoint, and the failed mux attempt's own intermediates.
    const sessionFiles = new Set([
      'piece_0.h264',
      'piece_1.h264',
      'piece_2.h264',
      'export_state.json',
      'video_all.h264',
      'export_final.mp4',
    ]);
    const active: RetainableSession = {
      retainForResume: async (): Promise<RetainForResumeReport> => {
        if (!sessionFiles.has('export_state.json')) {
          const removed = [...sessionFiles];
          sessionFiles.clear();
          return {
            sessionId: 'machine1', path: '/fake/kinetix-export-machine1',
            disposition: 'destroyed', retainedBytes: 0, reclaimedBytes: removed.length, removed,
          };
        }
        const removed = [...sessionFiles].filter((f) => !isResumeRetainedFile(f));
        for (const f of removed) sessionFiles.delete(f);
        return {
          sessionId: 'machine1', path: '/fake/kinetix-export-machine1',
          disposition: 'retained', retainedBytes: sessionFiles.size, reclaimedBytes: removed.length, removed,
        };
      },
    };

    // THE FIX, exercised directly: this is what `useExport.ts` now calls for
    // EVERY failure kind (not just `disk_full`) — including the `mux` kind
    // `result.error` just carried.
    const report = await decideSessionRetentionOnFailure(active);

    expect(report?.disposition).toBe('retained');
    expect(sessionFiles.has('piece_0.h264')).toBe(true);
    expect(sessionFiles.has('piece_1.h264')).toBe(true);
    expect(sessionFiles.has('piece_2.h264')).toBe(true);
    expect(sessionFiles.has('export_state.json')).toBe(true);
    expect(sessionFiles.has('video_all.h264')).toBe(false);
    expect(sessionFiles.has('export_final.mp4')).toBe(false);
  });

  it('a resumed run completes to a finished file without re-rendering any piece', async () => {
    const project = makeProject();
    const ffmpeg = makeFakeFfmpeg();

    // Every piece already rendered and checkpointed — exactly the state
    // `decideSessionRetentionOnFailure` above just proved survives. Piece 1
    // (the plain/Tier-1 path never spins up a Worker for ANY piece — see
    // this file's own header — so "without spinning up a worker" is
    // structural here, not merely unexercised).
    const result = await exportProjectWebCodecs(
      project,
      ffmpeg,
      {
        width: 1920, height: 1080, fps: FPS,
        resume: { pieceIndex: 3, encoderSessionIndex: 0, byteOffset: 0, cumulativePictures: 0 },
      },
    );

    expect(result.ok).toBe(true);
    // No piece was re-rendered: the encoder this project's segments would
    // have used is never called.
    expect(encodeStaticImageSegment).not.toHaveBeenCalled();
    // The 3 already-on-disk pieces are reused as-is, not regenerated.
    expect(ffmpeg.concatAnnexbPieces).toHaveBeenCalledWith(
      ['piece_0.h264', 'piece_1.h264', 'piece_2.h264'],
      'video_all.h264',
    );
    expect(muxOnlyMock).toHaveBeenCalledTimes(1);
  });

  it('negative case: an unrelated (non-mux) early failure with no manifest still destroys outright', async () => {
    // `disk_full` is not the only kind that must keep working — a failure
    // BEFORE any checkpoint exists (nothing to retain) must still free the
    // bytes, same as the pre-STEP-3b behavior.
    const active: RetainableSession = {
      retainForResume: async (): Promise<RetainForResumeReport> => ({
        sessionId: 'no-checkpoint-yet', path: '/fake/kinetix-export-none',
        disposition: 'destroyed', retainedBytes: 0, reclaimedBytes: 4096, removed: ['scratch.tmp'],
      }),
    };
    const report = await decideSessionRetentionOnFailure(active);
    expect(report?.disposition).toBe('destroyed');
  });

  it('negative case: a bare fake with no retainForResume falls back to null (caller must guard-destroy)', async () => {
    const report = await decideSessionRetentionOnFailure({});
    expect(report).toBeNull();
  });

  it('negative case: a user cancel still destroys unconditionally — it never routes through retention', async () => {
    const project = makeProject();
    const ffmpeg = makeFakeFfmpeg();

    const pending = exportProjectWebCodecs(project, ffmpeg, { width: 1920, height: 1080, fps: FPS });

    // `activeFfmpeg` is set synchronously before the first await inside
    // `exportProjectWebCodecs` — this call observes it deterministically,
    // not via a timing race.
    await cancelExportWebCodecs();

    expect(ffmpeg.kill).toHaveBeenCalledTimes(1);
    // THE NEGATIVE CASE: cancel forces past the manifest guard — it does
    // NOT call `retainForResume` and does NOT do a plain guarded destroy.
    expect(ffmpeg.destroy).toHaveBeenCalledWith({ force: true });

    // Let the in-flight export settle either way — its outcome is not
    // this test's concern, only that cancel's own destroy call was forced.
    await pending.catch(() => undefined);
  });
});
