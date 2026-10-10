/**
 * WS2 Step 11 regression — `exportProject`'s voiceover audio mux step must
 * prefer an already-in-memory `voiceoverAsset.file` over `fetch(voiceoverAsset.url)`,
 * same defect shape/fix as WS2 Step 10's `fetchAndDetectSilences` (a `blob:`-URL
 * `fetch()` fails on Windows WebView2 where DOM-native consumption of the
 * identical URL does not — `docs/archive/history/history-2.md`).
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

import { exportProject, type ExportStage } from './exportPipeline';
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

describe('exportProject — progress follows the same cumulative formula as WebCodecs (G7)', () => {
  it('legacy canvas stages are cumulative and frame-weighted: one monotone 0→90 run, no per-segment leaps', async () => {
    const { progressFor } = await import('../hooks/useExport');
    const asset = (id: string): Asset => ({ id, name: `${id}.png`, url: `blob:${id}`, type: 'image' });
    const seg = (id: string, assetId: string, startTime: number, duration: number, order: number): VideoSegment =>
      ({ ...makeSegment(), id, assetId, startTime, duration, order });
    const project: Project = {
      ...makeProject({ id: 'vo', name: 'vo.mp3', url: 'blob:vo', type: 'audio' }),
      voiceoverId: undefined,
      assets: [asset('a'), asset('b'), asset('c')],
      // 1s, 4s, 1s: a long middle segment must carry 4/6 of the bar, not 1/3.
      segments: [seg('s0', 'a', 0, 1, 0), seg('s1', 'b', 1, 4, 1), seg('s2', 'c', 5, 1, 2)],
    };
    const stages: ExportStage[] = [];
    const result = await exportProject(project, makeFakeFfmpeg(), { fps: 30 }, st => { stages.push(st); });
    expect(result.ok).toBe(true);
    const enc = stages.filter((st): st is Extract<ExportStage, { type: 'encoding_segment' }> => st.type === 'encoding_segment');
    expect(enc.length).toBe(3);
    expect(enc.every(st => st.cumulative === true && st.totalFrames === 180)).toBe(true);
    expect(enc.map(st => st.frame)).toEqual([0, 30, 150]);
    const pcts = enc.map(progressFor);
    expect(pcts).toEqual([0, 15, 75]);   // equal slices would have been 0, 30, 60
    for (let k = 1; k < pcts.length; k++) expect(pcts[k]).toBeGreaterThanOrEqual(pcts[k - 1]!);
  });
});
