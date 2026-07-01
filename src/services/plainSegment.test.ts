import { describe, it, expect } from 'vitest';
import { isPlainVideoSegment } from './plainSegment';
import { TransitionType, AnimationType } from '../types';
import type { VideoSegment, Project, Asset, TextOverlay } from '../types';

const VIDEO_ASSET: Asset = { id: 'v1', name: 'clip.mp4', url: 'blob:v1', type: 'video' };
const IMAGE_ASSET: Asset = { id: 'i1', name: 'pic.jpg', url: 'blob:i1', type: 'image' };

function makeSegment(partial: Partial<VideoSegment> & { id: string }): VideoSegment {
  return {
    text: '',
    startTime: 0,
    duration: 3,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    assetId: 'v1',
    ...partial,
  };
}

function makeProject(partial: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test',
    script: '',
    sceneDetails: '',
    segments: [],
    assets: [VIDEO_ASSET, IMAGE_ASSET],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'sans-serif' },
    ...partial,
  };
}

describe('isPlainVideoSegment', () => {
  it('returns true for a bare full-frame video segment with no neighbours', () => {
    const seg = makeSegment({ id: 's0' });
    const project = makeProject({ segments: [seg] });
    expect(isPlainVideoSegment(seg, undefined, undefined, project)).toBe(true);
  });

  it('stays plain with plain video neighbours and no transitions', () => {
    const prev = makeSegment({ id: 'prev', order: 0 });
    const seg = makeSegment({ id: 's1', order: 1 });
    const next = makeSegment({ id: 'next', order: 2 });
    const project = makeProject({ segments: [prev, seg, next] });
    expect(isPlainVideoSegment(seg, prev, next, project)).toBe(true);
  });

  // ── Each failing condition flips it to false ───────────────────────────────

  it('false for a heading segment', () => {
    const seg = makeSegment({ id: 's', isHeading: true, headingConfig: { text: 'Title' } });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false for a legacy heading (heading field set)', () => {
    const seg = makeSegment({ id: 's', heading: 'Title' });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false when the asset is an image, not a video', () => {
    const seg = makeSegment({ id: 's', assetId: 'i1' });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false when the segment has no asset', () => {
    const seg = makeSegment({ id: 's', assetId: undefined });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false when a caption is shown (showOverlay + text)', () => {
    const seg = makeSegment({ id: 's', showOverlay: true, text: 'A caption' });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('stays plain when showOverlay is true but text is empty', () => {
    const seg = makeSegment({ id: 's', showOverlay: true, text: '' });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(true);
  });

  it('false when the segment has extra overlays', () => {
    const overlay: TextOverlay = {
      id: 'o1', text: 'hi', color: '#fff', backgroundColor: '#000',
      fontFamily: 'sans-serif', fontSize: 24, position: { x: 50, y: 50 },
    };
    const seg = makeSegment({ id: 's', extraOverlays: [overlay] });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false when a global text layer is visible on this segment', () => {
    const layer: TextOverlay = {
      id: 'g1', text: 'watermark', color: '#fff', backgroundColor: 'transparent',
      fontFamily: 'sans-serif', fontSize: 18, position: { x: 90, y: 90 },
    };
    const seg = makeSegment({ id: 's' });
    const project = makeProject({ textLayers: [layer] });
    expect(isPlainVideoSegment(seg, undefined, undefined, project)).toBe(false);
  });

  it('stays plain when the only global text layer is hidden on this segment', () => {
    const layer: TextOverlay = {
      id: 'g1', text: 'watermark', color: '#fff', backgroundColor: 'transparent',
      fontFamily: 'sans-serif', fontSize: 18, position: { x: 90, y: 90 },
      hiddenOnSegments: ['s'],
    };
    const seg = makeSegment({ id: 's' });
    const project = makeProject({ textLayers: [layer] });
    expect(isPlainVideoSegment(seg, undefined, undefined, project)).toBe(true);
  });

  it('false when a legacy animation is set', () => {
    const seg = makeSegment({ id: 's', animation: AnimationType.KEN_BURNS });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false when an effectAnimation slug is set', () => {
    const seg = makeSegment({ id: 's', effectAnimation: 'ken-burns' });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('stays plain when effectAnimation is the "none" sentinel', () => {
    const seg = makeSegment({ id: 's', effectAnimation: 'none' });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(true);
  });

  it('false when a per-segment overlayFilter is set', () => {
    const seg = makeSegment({ id: 's', overlayFilter: 'grayscale' });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false when a global overlay filter is set', () => {
    const seg = makeSegment({ id: 's' });
    const project = makeProject({ globalOverlayFilter: 'sepia' });
    expect(isPlainVideoSegment(seg, undefined, undefined, project)).toBe(false);
  });

  it('false when an outgoing transition overlaps the tail (own transition + next)', () => {
    const seg = makeSegment({ id: 's', transition: TransitionType.FADE, transitionDuration: 0.5 });
    const next = makeSegment({ id: 'next', order: 1 });
    expect(isPlainVideoSegment(seg, undefined, next, makeProject())).toBe(false);
  });

  it('false when an incoming transition overlaps the head (prev transition into it)', () => {
    const prev = makeSegment({ id: 'prev', order: 0, transition: TransitionType.FADE, transitionDuration: 0.5 });
    const seg = makeSegment({ id: 's', order: 1 });
    expect(isPlainVideoSegment(seg, prev, undefined, makeProject())).toBe(false);
  });

  it('false when a global transition applies and there is a next segment', () => {
    const seg = makeSegment({ id: 's', order: 0 });
    const next = makeSegment({ id: 'next', order: 1 });
    const project = makeProject({ globalTransition: TransitionType.FADE, globalTransitionDuration: 0.5 });
    expect(isPlainVideoSegment(seg, undefined, next, project)).toBe(false);
  });

  it('false when playbackSpeed differs from 1', () => {
    const seg = makeSegment({ id: 's', playbackSpeed: 2 });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('stays plain when playbackSpeed is explicitly 1', () => {
    const seg = makeSegment({ id: 's', playbackSpeed: 1 });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(true);
  });
});
