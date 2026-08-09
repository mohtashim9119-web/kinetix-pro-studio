import { describe, it, expect } from 'vitest';
import { isGlCompositableSegment } from './glCompositable';
import { TransitionType, AnimationType } from '../../types';
import type { VideoSegment, Project, Asset, TextOverlay, SegmentGrade } from '../../types';

const VIDEO_ASSET: Asset = { id: 'v1', name: 'clip.mp4', url: 'blob:v1', type: 'video' };
const IMAGE_ASSET: Asset = { id: 'i1', name: 'pic.jpg', url: 'blob:i1', type: 'image' };
const AUDIO_ASSET: Asset = { id: 'a1', name: 'tone.mp3', url: 'blob:a1', type: 'audio' };

const NEUTRAL_GRADE: SegmentGrade = { brightness: 0, contrast: 0, saturation: 0, temperature: 0 };

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
    assets: [VIDEO_ASSET, IMAGE_ASSET, AUDIO_ASSET],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'sans-serif' },
    ...partial,
  };
}

describe('isGlCompositableSegment — baseline', () => {
  it('true for a bare segment with no effects and no neighbours', () => {
    const seg = makeSegment({ id: 's0' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });

  it('true for an image-asset segment', () => {
    const seg = makeSegment({ id: 's0', assetId: 'i1' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });

  it('false when the segment has no assetId (worker cannot source a texture)', () => {
    const seg = makeSegment({ id: 's0', assetId: undefined });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });

  it('false when assetId points at a missing asset', () => {
    const seg = makeSegment({ id: 's0', assetId: 'does-not-exist' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });

  it('false when the asset is audio-typed (not video/image)', () => {
    const seg = makeSegment({ id: 's0', assetId: 'a1' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });
});

describe('isGlCompositableSegment — grade', () => {
  it('true with a real (non-neutral) effectGrade — grade never disqualifies', () => {
    const seg = makeSegment({ id: 's0', effectGrade: { brightness: 0.5, contrast: -0.3, saturation: 0.2, temperature: 0.1 } });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });

  it('true with an explicit neutral effectGrade', () => {
    const seg = makeSegment({ id: 's0', effectGrade: NEUTRAL_GRADE });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });
});

describe('isGlCompositableSegment — animation', () => {
  it('true for effectAnimation "zoom-in"', () => {
    const seg = makeSegment({ id: 's0', effectAnimation: 'zoom-in' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });

  it('true for effectAnimation "zoom-out"', () => {
    const seg = makeSegment({ id: 's0', effectAnimation: 'zoom-out' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });

  it('true for legacy AnimationType.ZOOM_IN with no effectAnimation set', () => {
    const seg = makeSegment({ id: 's0', animation: AnimationType.ZOOM_IN });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });

  it('false for effectAnimation "ken-burns"', () => {
    const seg = makeSegment({ id: 's0', effectAnimation: 'ken-burns' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });

  it('false for legacy AnimationType.KEN_BURNS', () => {
    const seg = makeSegment({ id: 's0', animation: AnimationType.KEN_BURNS });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });

  it('false for legacy AnimationType.FLOAT', () => {
    const seg = makeSegment({ id: 's0', animation: AnimationType.FLOAT });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });

  it('false for clip-effect slug "duotone"', () => {
    const seg = makeSegment({ id: 's0', effectAnimation: 'duotone' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });

  it('false for clip-effect slug "gaussian-blur"', () => {
    const seg = makeSegment({ id: 's0', effectAnimation: 'gaussian-blur' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });

  it('false for clip-effect slug "color-grade"', () => {
    const seg = makeSegment({ id: 's0', effectAnimation: 'color-grade' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });

  it('false for clip-effect slug "sepia"', () => {
    const seg = makeSegment({ id: 's0', effectAnimation: 'sepia' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });

  it('false for clip-effect slug "invert"', () => {
    const seg = makeSegment({ id: 's0', effectAnimation: 'invert' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });

  it('effectAnimation slug wins over a legacy animation enum when both are set', () => {
    // effectAnimation='zoom-in' wins over a disqualifying legacy enum -> true
    const segA = makeSegment({ id: 's0', animation: AnimationType.KEN_BURNS, effectAnimation: 'zoom-in' });
    expect(isGlCompositableSegment(segA, makeProject(), {})).toBe(true);
    // effectAnimation='ken-burns' wins over an otherwise-fine legacy NONE -> false
    const segB = makeSegment({ id: 's0', animation: AnimationType.NONE, effectAnimation: 'ken-burns' });
    expect(isGlCompositableSegment(segB, makeProject(), {})).toBe(false);
  });
});

describe('isGlCompositableSegment — color filter', () => {
  it('false when segment.overlayFilter is set to a real filter', () => {
    const seg = makeSegment({ id: 's0', overlayFilter: 'noir' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });

  it('false when project.globalOverlayFilter is set to a real filter', () => {
    const seg = makeSegment({ id: 's0' });
    const project = makeProject({ globalOverlayFilter: 'vintage' });
    expect(isGlCompositableSegment(seg, project, {})).toBe(false);
  });

  it('true when segment.overlayFilter is explicitly "none" (equivalent to unset)', () => {
    const seg = makeSegment({ id: 's0', overlayFilter: 'none' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });

  it('true when project.globalOverlayFilter is explicitly "none"', () => {
    const seg = makeSegment({ id: 's0' });
    const project = makeProject({ globalOverlayFilter: 'none' });
    expect(isGlCompositableSegment(seg, project, {})).toBe(true);
  });
});

describe('isGlCompositableSegment — transitions', () => {
  const GL_SLUGS = ['cross-dissolve', 'dip-black', 'dip-white', 'light-leak'];

  for (const slug of GL_SLUGS) {
    it(`true for outgoing GL transition slug "${slug}" with a next neighbour`, () => {
      const seg = makeSegment({ id: 's0', effectTransition: slug, effectTransitionDuration: 0.5 });
      const next = makeSegment({ id: 's1' });
      expect(isGlCompositableSegment(seg, makeProject(), { next })).toBe(true);
    });

    it(`true when the incoming edge (prev's outgoing) is GL transition slug "${slug}"`, () => {
      const prev = makeSegment({ id: 'prev', effectTransition: slug, effectTransitionDuration: 0.5 });
      const seg = makeSegment({ id: 's0' });
      expect(isGlCompositableSegment(seg, makeProject(), { prev })).toBe(true);
    });
  }

  it('false for a legacy enum transition (FADE) on the outgoing edge', () => {
    const seg = makeSegment({ id: 's0', transition: TransitionType.FADE, transitionDuration: 0.5 });
    const next = makeSegment({ id: 's1' });
    expect(isGlCompositableSegment(seg, makeProject(), { next })).toBe(false);
  });

  it('false for a legacy enum transition (SLIDE) on the incoming edge', () => {
    const prev = makeSegment({ id: 'prev', transition: TransitionType.SLIDE, transitionDuration: 0.5 });
    const seg = makeSegment({ id: 's0' });
    expect(isGlCompositableSegment(seg, makeProject(), { prev })).toBe(false);
  });

  it('both segments sharing a legacy-enum edge independently fail (no special signaling needed)', () => {
    const prev = makeSegment({ id: 'prev', transition: TransitionType.WIPE, transitionDuration: 0.5 });
    const seg = makeSegment({ id: 's0' });
    const project = makeProject({ segments: [prev, seg] });
    // From `seg`'s perspective (incoming edge = prev's outgoing):
    expect(isGlCompositableSegment(seg, project, { prev })).toBe(false);
    // From `prev`'s perspective (its own outgoing edge into `seg`):
    expect(isGlCompositableSegment(prev, project, { next: seg })).toBe(false);
  });

  it('true when a legacy-enum transition is set but resolves to zero duration (no-op)', () => {
    const seg = makeSegment({ id: 's0', transition: TransitionType.FADE, transitionDuration: 0 });
    const next = makeSegment({ id: 's1' });
    const project = makeProject({ globalTransitionDuration: 0 });
    expect(isGlCompositableSegment(seg, project, { next })).toBe(true);
  });

  it('true for TransitionType.NONE (hard-cut) on either edge', () => {
    const seg = makeSegment({ id: 's0', transition: TransitionType.NONE });
    const next = makeSegment({ id: 's1' });
    expect(isGlCompositableSegment(seg, makeProject(), { next })).toBe(true);
  });

  it('an outgoing legacy transition is irrelevant when there is no next segment', () => {
    const seg = makeSegment({ id: 's0', transition: TransitionType.FADE, transitionDuration: 0.5 });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });

  it('an incoming legacy transition on a nonexistent prev is irrelevant', () => {
    const seg = makeSegment({ id: 's0' });
    expect(isGlCompositableSegment(seg, makeProject(), { prev: undefined })).toBe(true);
  });

  it('global transition fallback (legacy enum) disqualifies when segment has no own transition', () => {
    const seg = makeSegment({ id: 's0', transition: TransitionType.NONE });
    const next = makeSegment({ id: 's1' });
    const project = makeProject({ globalTransition: TransitionType.ZOOM, globalTransitionDuration: 0.5 });
    expect(isGlCompositableSegment(seg, project, { next })).toBe(false);
  });
});

describe('isGlCompositableSegment — non-disqualifiers (text, speed)', () => {
  it('true with a body caption shown', () => {
    const seg = makeSegment({ id: 's0', showOverlay: true, text: 'A caption' });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });

  it('true with extra positioned overlays', () => {
    const overlay: TextOverlay = {
      id: 'o1', text: 'hi', color: '#fff', backgroundColor: '#000',
      fontFamily: 'sans-serif', fontSize: 24, position: { x: 50, y: 50 },
    };
    const seg = makeSegment({ id: 's0', extraOverlays: [overlay] });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });

  it('true with a visible global text layer', () => {
    const layer: TextOverlay = {
      id: 'g1', text: 'watermark', color: '#fff', backgroundColor: 'transparent',
      fontFamily: 'sans-serif', fontSize: 18, position: { x: 90, y: 90 },
    };
    const seg = makeSegment({ id: 's0' });
    const project = makeProject({ textLayers: [layer] });
    expect(isGlCompositableSegment(seg, project, {})).toBe(true);
  });

  it('true with a heading intersecting the segment', () => {
    const seg = makeSegment({ id: 's0', startTime: 0, duration: 3 });
    const project = makeProject({
      headings: [{
        id: 'h1', time: 1, duration: 1, text: 'Heading', fontFamily: 'sans-serif',
        fontSize: 32, fontWeight: 700, color: '#fff', backgroundColor: 'transparent', x: 50, y: 50,
      }],
    });
    expect(isGlCompositableSegment(seg, project, {})).toBe(true);
  });

  it('true for a freeze-tail segment (clip shorter than duration — WS3 Batch B Case A)', () => {
    const seg = makeSegment({ id: 's0', duration: 5, trimStart: 0 });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });

  it('true for a trimmed-window segment (clip longer than duration — WS3 Batch B Case B)', () => {
    const seg = makeSegment({ id: 's0', duration: 3, trimStart: 10 });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(true);
  });
});

describe('isGlCompositableSegment — combinations', () => {
  it('grade + zoom + GL transition -> true', () => {
    const seg = makeSegment({
      id: 's0',
      effectAnimation: 'zoom-in',
      effectGrade: { brightness: 0.4, contrast: 0, saturation: 0, temperature: 0 },
      effectTransition: 'cross-dissolve',
      effectTransitionDuration: 0.5,
    });
    const next = makeSegment({ id: 's1' });
    expect(isGlCompositableSegment(seg, makeProject(), { next })).toBe(true);
  });

  it('grade + overlayFilter -> false (filter disqualifies despite GL-native grade)', () => {
    const seg = makeSegment({
      id: 's0',
      effectGrade: { brightness: 0.4, contrast: 0, saturation: 0, temperature: 0 },
      overlayFilter: 'noir',
    });
    expect(isGlCompositableSegment(seg, makeProject(), {})).toBe(false);
  });
});
