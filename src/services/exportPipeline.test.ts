/**
 * WS2 Step 11 regression — `exportProject`'s voiceover audio mux step must
 * prefer an already-in-memory `voiceoverAsset.file` over `fetch(voiceoverAsset.url)`,
 * same defect shape/fix as WS2 Step 10's `fetchAndDetectSilences` (a `blob:`-URL
 * `fetch()` fails on Windows WebView2 where DOM-native consumption of the
 * identical URL does not — `docs/history-2.md`).
 *
 * All encoder/ffmpeg collaborators are mocked; the goal is the mux-step
 * wiring, not real ffmpeg encoding.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransitionType, AnimationType } from '../types';
import type { Asset, Project, VideoSegment } from '../types';

vi.mock('./segmentEncoder', () => ({
  encodeSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  encodePlainVideoSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  encodeStaticImageSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

import { exportProject } from './exportPipeline';
import type { FfmpegLike } from './segmentEncoder';

function makeFakeFfmpeg(): FfmpegLike {
  return {
    writeFile: vi.fn(async () => undefined),
    exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()),
    deleteFile: vi.fn(async () => undefined),
  } as unknown as FfmpegLike;
}

function makeSegment(): VideoSegment {
  return {
    id: 's0',
    text: '',
    startTime: 0,
    duration: 1,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
  };
}

function makeProject(voiceoverAsset: Asset): Project {
  return {
    id: 'proj-1',
    name: 'Test',
    script: '',
    sceneDetails: '',
    segments: [makeSegment()],
    assets: [voiceoverAsset],
    voiceoverId: voiceoverAsset.id,
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
  };
}

describe('exportProject — voiceover mux fetch-avoidance (WS2 Step 11)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses voiceoverAsset.file directly and never calls fetch when a File is present', async () => {
    const file = new File(['fake-audio-bytes'], 'voiceover.mp3', { type: 'audio/mpeg' });
    const voiceoverAsset: Asset = { id: 'vo1', name: 'voiceover.mp3', url: 'blob:vo1', type: 'audio', file };
    const project = makeProject(voiceoverAsset);
    const ffmpeg = makeFakeFfmpeg();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await exportProject(project, ffmpeg);

    expect(result.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ffmpeg.writeFile).toHaveBeenCalledWith('voiceover_audio', expect.any(Uint8Array));
  });

  it('falls back to fetch(voiceoverAsset.url) when .file is absent', async () => {
    const voiceoverAsset: Asset = { id: 'vo1', name: 'voiceover.mp3', url: 'blob:vo1', type: 'audio' };
    const project = makeProject(voiceoverAsset);
    const ffmpeg = makeFakeFfmpeg();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(4),
    } as unknown as Response);

    const result = await exportProject(project, ffmpeg);

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('blob:vo1');
  });
});
