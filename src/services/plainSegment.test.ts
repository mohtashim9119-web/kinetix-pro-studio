import { describe, it, expect } from 'vitest';
import { isPlainVideoSegment, isPlainImageSegment } from './plainSegment';
import { createHeading } from './headingLayer';
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

/** Image-asset variant: defaults assetId to the image asset. */
function makeImageSegment(partial: Partial<VideoSegment> & { id: string }): VideoSegment {
  return makeSegment({ assetId: 'i1', ...partial });
}

/** A project whose video asset carries `clipLen` as its probed duration —
 *  the clip length now lives on the asset, not the segment. */
function makeProjectWithClip(clipLen: number, partial: Partial<Project> = {}): Project {
  return makeProject({ assets: [{ ...VIDEO_ASSET, duration: clipLen }, IMAGE_ASSET], ...partial });
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

  it('false when the clip is shorter than the segment (freeze-last-frame — encodePlainVideoSegment cannot pad, WS3 Batch B)', () => {
    const seg = makeSegment({ id: 's', duration: 5, trimStart: 0 });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProjectWithClip(3))).toBe(false);
  });

  it('stays plain when the clip is at least as long as the segment (plain trim window)', () => {
    const seg = makeSegment({ id: 's', duration: 3, trimStart: 0 });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProjectWithClip(60))).toBe(true);
  });

  it('stays plain when the asset has no probed duration (no freeze possible to detect)', () => {
    const seg = makeSegment({ id: 's', duration: 3 });
    expect(VIDEO_ASSET.duration).toBeUndefined();
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProject())).toBe(true);
  });

  it('false when trimStart eats into an otherwise-sufficient clip, leaving less than the segment needs', () => {
    // clip 10s, trimStart 8 → only 2s of clip left, but duration is 3.
    const seg = makeSegment({ id: 's', duration: 3, trimStart: 8 });
    expect(isPlainVideoSegment(seg, undefined, undefined, makeProjectWithClip(10))).toBe(false);
  });
});

describe('isPlainImageSegment', () => {
  it('returns true for a bare full-frame image segment with no neighbours', () => {
    const seg = makeImageSegment({ id: 's0' });
    const project = makeProject({ segments: [seg] });
    expect(isPlainImageSegment(seg, undefined, undefined, project)).toBe(true);
  });

  it('stays plain with plain image neighbours and no transitions', () => {
    const prev = makeImageSegment({ id: 'prev', order: 0 });
    const seg = makeImageSegment({ id: 's1', order: 1 });
    const next = makeImageSegment({ id: 'next', order: 2 });
    const project = makeProject({ segments: [prev, seg, next] });
    expect(isPlainImageSegment(seg, prev, next, project)).toBe(true);
  });

  // ── Each failing condition flips it to false ───────────────────────────────

  it('false when the asset is a video, not an image', () => {
    const seg = makeSegment({ id: 's', assetId: 'v1' });
    expect(isPlainImageSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false when the segment has no asset', () => {
    const seg = makeImageSegment({ id: 's', assetId: undefined });
    expect(isPlainImageSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false when a caption is shown (showOverlay + text)', () => {
    const seg = makeImageSegment({ id: 's', showOverlay: true, text: 'A caption' });
    expect(isPlainImageSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('stays plain when showOverlay is true but text is empty', () => {
    const seg = makeImageSegment({ id: 's', showOverlay: true, text: '' });
    expect(isPlainImageSegment(seg, undefined, undefined, makeProject())).toBe(true);
  });

  it('false when the segment has extra overlays', () => {
    const overlay: TextOverlay = {
      id: 'o1', text: 'hi', color: '#fff', backgroundColor: '#000',
      fontFamily: 'sans-serif', fontSize: 24, position: { x: 50, y: 50 },
    };
    const seg = makeImageSegment({ id: 's', extraOverlays: [overlay] });
    expect(isPlainImageSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false when a global text layer is visible on this segment', () => {
    const layer: TextOverlay = {
      id: 'g1', text: 'watermark', color: '#fff', backgroundColor: 'transparent',
      fontFamily: 'sans-serif', fontSize: 18, position: { x: 90, y: 90 },
    };
    const seg = makeImageSegment({ id: 's' });
    const project = makeProject({ textLayers: [layer] });
    expect(isPlainImageSegment(seg, undefined, undefined, project)).toBe(false);
  });

  it('stays plain when the only global text layer is hidden on this segment', () => {
    const layer: TextOverlay = {
      id: 'g1', text: 'watermark', color: '#fff', backgroundColor: 'transparent',
      fontFamily: 'sans-serif', fontSize: 18, position: { x: 90, y: 90 },
      hiddenOnSegments: ['s'],
    };
    const seg = makeImageSegment({ id: 's' });
    const project = makeProject({ textLayers: [layer] });
    expect(isPlainImageSegment(seg, undefined, undefined, project)).toBe(true);
  });

  it('false when a legacy animation is set (Ken Burns)', () => {
    const seg = makeImageSegment({ id: 's', animation: AnimationType.KEN_BURNS });
    expect(isPlainImageSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false when an effectAnimation slug is set', () => {
    const seg = makeImageSegment({ id: 's', effectAnimation: 'ken-burns' });
    expect(isPlainImageSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('stays plain when effectAnimation is the "none" sentinel', () => {
    const seg = makeImageSegment({ id: 's', effectAnimation: 'none' });
    expect(isPlainImageSegment(seg, undefined, undefined, makeProject())).toBe(true);
  });

  it('false when a per-segment overlayFilter is set', () => {
    const seg = makeImageSegment({ id: 's', overlayFilter: 'grayscale' });
    expect(isPlainImageSegment(seg, undefined, undefined, makeProject())).toBe(false);
  });

  it('false when a global overlay filter is set', () => {
    const seg = makeImageSegment({ id: 's' });
    const project = makeProject({ globalOverlayFilter: 'sepia' });
    expect(isPlainImageSegment(seg, undefined, undefined, project)).toBe(false);
  });

  it('false when an outgoing transition overlaps the tail (own transition + next)', () => {
    const seg = makeImageSegment({ id: 's', transition: TransitionType.FADE, transitionDuration: 0.5 });
    const next = makeImageSegment({ id: 'next', order: 1 });
    expect(isPlainImageSegment(seg, undefined, next, makeProject())).toBe(false);
  });

  it('false when an incoming transition overlaps the head (prev transition into it)', () => {
    const prev = makeImageSegment({ id: 'prev', order: 0, transition: TransitionType.FADE, transitionDuration: 0.5 });
    const seg = makeImageSegment({ id: 's', order: 1 });
    expect(isPlainImageSegment(seg, prev, undefined, makeProject())).toBe(false);
  });

  it('false when a global transition applies and there is a next segment', () => {
    const seg = makeImageSegment({ id: 's', order: 0 });
    const next = makeImageSegment({ id: 'next', order: 1 });
    const project = makeProject({ globalTransition: TransitionType.FADE, globalTransitionDuration: 0.5 });
    expect(isPlainImageSegment(seg, undefined, next, project)).toBe(false);
  });
});

describe('Path B heading-layer guard (Decision 4, mandatory)', () => {
  // seg occupies [10, 15) throughout this block.
  it('false when a heading is fully inside the segment', () => {
    const seg = makeSegment({ id: 's', startTime: 10, duration: 5 });
    const heading = createHeading(11, { duration: 1, text: 'Title' });
    const project = makeProject({ headings: [heading] });
    expect(isPlainVideoSegment(seg, undefined, undefined, project)).toBe(false);
  });

  it('false when a heading straddles the segment edge', () => {
    const seg = makeSegment({ id: 's', startTime: 10, duration: 5 });
    // Starts before the segment (9) and ends inside it (10.5) — overlaps the head.
    const heading = createHeading(9, { duration: 1.5, text: 'Title' });
    const project = makeProject({ headings: [heading] });
    expect(isPlainVideoSegment(seg, undefined, undefined, project)).toBe(false);
  });

  it('stays plain when a heading exactly touches the boundary with zero overlap', () => {
    const seg = makeSegment({ id: 's', startTime: 10, duration: 5 });
    // Ends exactly when the segment starts (half-open: no overlap).
    const headingBefore = createHeading(9, { duration: 1, text: 'Title' });
    const projectBefore = makeProject({ headings: [headingBefore] });
    expect(isPlainVideoSegment(seg, undefined, undefined, projectBefore)).toBe(true);

    // Starts exactly when the segment ends (half-open: no overlap).
    const headingAfter = createHeading(15, { duration: 1, text: 'Title' });
    const projectAfter = makeProject({ headings: [headingAfter] });
    expect(isPlainVideoSegment(seg, undefined, undefined, projectAfter)).toBe(true);
  });

  it('stays plain when a heading is far away in time', () => {
    const seg = makeSegment({ id: 's', startTime: 10, duration: 5 });
    const heading = createHeading(100, { duration: 1, text: 'Title' });
    const project = makeProject({ headings: [heading] });
    expect(isPlainVideoSegment(seg, undefined, undefined, project)).toBe(true);
  });

  it('applies the same guard to isPlainImageSegment', () => {
    const seg = makeImageSegment({ id: 's', startTime: 10, duration: 5 });
    const heading = createHeading(11, { duration: 1, text: 'Title' });
    const project = makeProject({ headings: [heading] });
    expect(isPlainImageSegment(seg, undefined, undefined, project)).toBe(false);
  });
});
