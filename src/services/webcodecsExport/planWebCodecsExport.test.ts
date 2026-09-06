/**
 * Routing preview for the Round 2 GL-forcing caption: showOverlay+text
 * knocks a segment out of Tier 1 (plainSegment.ts:91-92) without failing
 * isGlCompositableSegment (glCompositable.ts:41-44).
 */
import { describe, it, expect } from 'vitest';
import { AnimationType, TransitionType, type Asset, type Project, type VideoSegment } from '../../types';
import { planWebCodecsExport } from './exportPipelineWebCodecs';
import { isPlainImageSegment } from '../plainSegment';
import { isGlCompositableSegment } from './glCompositable';

function makeProject(segment: VideoSegment, asset: Asset): Project {
  return {
    id: 'p',
    name: 't',
    script: '',
    sceneDetails: '',
    segments: [segment],
    assets: [asset],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
  };
}

describe('planWebCodecsExport — caption forces GL', () => {
  const asset: Asset = {
    id: 'a0',
    name: 'still.png',
    url: 'blob:img',
    type: 'image',
  };

  it('a plain image with no caption routes to Tier 1', () => {
    const segment: VideoSegment = {
      id: 's0',
      text: 'hello',
      assetId: 'a0',
      startTime: 0,
      duration: 1,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: 0,
      showOverlay: false,
    };
    const project = makeProject(segment, asset);
    expect(isPlainImageSegment(segment, undefined, undefined, project)).toBe(true);
    expect(isGlCompositableSegment(segment, project, {})).toBe(true);
    const plan = planWebCodecsExport(project, 30);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.segmentCounts).toEqual({ plain: 1, gl: 0, canvas: 0 });
    expect(plan.pieceCounts).toEqual({ plain: 1, gl: 0, canvas: 0 });
  });

  it('showOverlay + non-empty text is the minimum change that moves the same image to GL', () => {
    const segment: VideoSegment = {
      id: 's0',
      text: 'hello',
      assetId: 'a0',
      startTime: 0,
      duration: 1,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: 0,
      showOverlay: true,
    };
    const project = makeProject(segment, asset);
    expect(isPlainImageSegment(segment, undefined, undefined, project)).toBe(false);
    expect(isGlCompositableSegment(segment, project, {})).toBe(true);
    const plan = planWebCodecsExport(project, 30);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.segmentCounts).toEqual({ plain: 0, gl: 1, canvas: 0 });
    expect(plan.pieceCounts).toEqual({ plain: 0, gl: 1, canvas: 0 });
  });
});
