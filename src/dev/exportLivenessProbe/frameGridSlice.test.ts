import { describe, expect, it } from 'vitest';
import { countPlayheadGaps, framesPerSegment, sliceProjectFrameGrid } from './frameGridSlice';
import type { Project, VideoSegment } from '../../types';
import { AnimationType, TransitionType } from '../../types';

function legacyFloatSlice(segmentCount: number, timelineSec: number): VideoSegment[] {
  const segDur = timelineSec / segmentCount;
  return Array.from({ length: segmentCount }, (_, i) => ({
    id: `legacy-${i}`,
    text: '',
    assetId: 'v1',
    startTime: i * segDur,
    duration: segDur,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: i,
  }));
}

const stubProject: Project = {
  id: 'p',
  name: 'stub',
  script: '',
  sceneDetails: '',
  segments: [],
  assets: [{ id: 'v1', name: 'v.mp4', url: 'blob:', type: 'video', addedAt: 0, duration: 10 }],
  globalTransition: TransitionType.NONE,
  globalTransitionDuration: 0.5,
  globalAnimation: AnimationType.NONE,
  globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
  confirmed: true,
  aspectRatio: '16:9',
  resolutionTier: '1080p',
};

describe('frameGridSlice', () => {
  it('100×40s @ 30fps legacy float slice has 20 playhead gaps; frame grid has zero', () => {
    const legacy = legacyFloatSlice(100, 40);
    expect(countPlayheadGaps(legacy, 30)).toBe(20);

    const aligned = sliceProjectFrameGrid(stubProject, 100, 40, 30).segments;
    expect(countPlayheadGaps(aligned, 30)).toBe(0);
    expect(framesPerSegment(40, 100, 30)).toBe(12);
    expect(Math.round((aligned[99]!.startTime + aligned[99]!.duration) * 30)).toBe(1200);
  });

  it('263×105.2s baseline has zero gaps on the frame grid', () => {
    const timeline = 263 * 0.4;
    const aligned = sliceProjectFrameGrid(stubProject, 263, timeline, 30).segments;
    expect(countPlayheadGaps(aligned, 30)).toBe(0);
  });
});
