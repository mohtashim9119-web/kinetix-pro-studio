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
vi.mock('./muxOnly', () => ({
  muxOnly: (...args: unknown[]) => muxOnlyMock(...args),
}));

import { exportProjectWebCodecs, type WebCodecsFfmpeg } from './exportPipelineWebCodecs';

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
    countAnnexbFrames: vi.fn(async () => 90),
    concatAnnexbPieces: vi.fn(async () => undefined),
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
