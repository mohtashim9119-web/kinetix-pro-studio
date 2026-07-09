import { describe, it, expect } from 'vitest';
import { deriveCompositeParams, NEUTRAL_GRADE, type ProjectEffectConfig } from './compositeParams';
import { AnimationType, TransitionType, type VideoSegment } from '../../types';

/**
 * Pure-function tests, mock-free — mirroring the style of
 * useWebCodecsPreview.test.ts's toSourceTime/computeKeepSet suites (see
 * that file's own doc comment for the rationale: this repo has no
 * jsdom/@testing-library/react, so pure derivation functions are tested
 * directly against plain inputs/outputs, no rendering harness needed).
 */

function makeSegment(overrides: Partial<VideoSegment> = {}): VideoSegment {
  return {
    id: 'seg-1',
    text: '',
    assetId: 'asset-1',
    startTime: 0,
    duration: 5,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    ...overrides,
  };
}

const baseConfig: ProjectEffectConfig = { globalTransitionDuration: 1 };

describe('deriveCompositeParams — ordinary mid-segment time', () => {
  it('returns null transition, neutral animScale, and default grade when nothing is configured', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10 })];
    const result = deriveCompositeParams(segments, 5, baseConfig);
    expect(result.transition).toBeNull();
    expect(result.animScale).toBe(1);
    expect(result.grade).toEqual(NEUTRAL_GRADE);
  });

  it('returns neutral defaults when currentTime falls outside every segment', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 5 })];
    const result = deriveCompositeParams(segments, 99, baseConfig);
    expect(result.transition).toBeNull();
    expect(result.animScale).toBe(1);
  });
});

describe('deriveCompositeParams — transition window progress', () => {
  // seg-a [0,5) -> seg-b [5,10), seg-b's leading transition resolved from
  // seg-a's own effectTransition field (the OUTGOING segment), duration 1s,
  // exactly mirroring useTransitionPreview.ts's "candidate B" contract.
  function makeAB(duration = 1): VideoSegment[] {
    return [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'cross-dissolve', effectTransitionDuration: duration }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
  }

  it('progress is 0 at the window start (exactly the incoming segment\'s startTime)', () => {
    const result = deriveCompositeParams(makeAB(), 5, baseConfig);
    expect(result.transition).toEqual({ type: 'cross-dissolve', progress: 0 });
  });

  it('progress is 0.5 at the window midpoint', () => {
    const result = deriveCompositeParams(makeAB(1), 5.5, baseConfig);
    expect(result.transition?.progress).toBeCloseTo(0.5, 5);
  });

  it('progress approaches 1 just before the window closes', () => {
    const result = deriveCompositeParams(makeAB(1), 5.999, baseConfig);
    expect(result.transition?.type).toBe('cross-dissolve');
    expect(result.transition?.progress).toBeCloseTo(0.999, 5);
  });

  it('edge case: exactly at the window\'s closing boundary, the transition is no longer active (matches useTransitionPreview.ts\'s half-open [start, start+duration) window)', () => {
    const result = deriveCompositeParams(makeAB(1), 6, baseConfig);
    expect(result.transition).toBeNull();
  });

  it('a non-GL-scoped transition slug (e.g. slide-push) resolves to null — out of scope for this engine', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'slide-push', effectTransitionDuration: 1 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
    const result = deriveCompositeParams(segments, 5.2, baseConfig);
    expect(result.transition).toBeNull();
  });

  it('the legacy TransitionType enum (no effectTransition slug set) also resolves to null — only the 4 new slugs are GL-scoped', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, transition: TransitionType.FADE, transitionDuration: 1 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
    const result = deriveCompositeParams(segments, 5.2, baseConfig);
    expect(result.transition).toBeNull();
  });

  it('falls back to config.globalTransitionDuration when the outgoing segment has an effectTransition slug but no per-segment duration override', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'light-leak' }), // no effectTransitionDuration
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
    const config: ProjectEffectConfig = { globalTransitionDuration: 2 };
    const result = deriveCompositeParams(segments, 5.5, config); // 0.25 through a 2s window
    expect(result.transition).toEqual({ type: 'light-leak', progress: 0.25 });
  });

  it('the legacy TransitionType enum can never resolve to a GL-scoped slug via project-level globalTransition — even TransitionType.ZOOM (enum value "zoom") is not one of the 4 scoped slugs', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
    const config: ProjectEffectConfig = { globalTransition: TransitionType.ZOOM, globalTransitionDuration: 1 };
    const result = deriveCompositeParams(segments, 5.2, config);
    expect(result.transition).toBeNull();
  });

  it('a zero-duration resolved transition never activates (division-by-zero guard)', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'cross-dissolve', effectTransitionDuration: 0 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
    const result = deriveCompositeParams(segments, 5, baseConfig);
    expect(result.transition).toBeNull();
  });

  it('the first segment in a project (no predecessor) never has an active transition', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'cross-dissolve', effectTransitionDuration: 1 })];
    const result = deriveCompositeParams(segments, 0, baseConfig);
    expect(result.transition).toBeNull();
  });
});

describe('deriveCompositeParams — zoom animScale', () => {
  it('zoom-in scale is exactly 1.0 at segment start (t=0)', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, effectAnimation: 'zoom-in' })];
    const result = deriveCompositeParams(segments, 0, baseConfig);
    expect(result.animScale).toBeCloseTo(1.0, 6);
  });

  it('zoom-in scale approaches 1.0 + 0.05*duration as currentTime approaches segment end (half-open [start, start+duration) window, matching findContainingSegment/transitionResolver convention — exactly at the boundary belongs to the next segment, not this one)', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, effectAnimation: 'zoom-in' })];
    const result = deriveCompositeParams(segments, 10 - 1e-6, baseConfig);
    expect(result.animScale).toBeCloseTo(1.5, 4);
  });

  it('zoom-in scale at the midpoint matches the 1.0 + 0.05*t formula exactly', () => {
    const segments = [makeSegment({ id: 'a', startTime: 2, duration: 8, effectAnimation: 'zoom-in' })];
    const result = deriveCompositeParams(segments, 2 + 4, baseConfig); // timeInSegment = 4
    expect(result.animScale).toBeCloseTo(1.0 + 0.05 * 4, 6);
  });

  it('zoom-out starts at the end-scale a matching zoom-in would reach, and decreases toward 1.0', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, effectAnimation: 'zoom-out' })];
    const atStart = deriveCompositeParams(segments, 0, baseConfig);
    const atEnd = deriveCompositeParams(segments, 10, baseConfig);
    expect(atStart.animScale).toBeCloseTo(1.0 + 0.05 * 10, 6); // 1.5
    expect(atEnd.animScale).toBeCloseTo(1.0, 6);
  });

  it('falls back to the legacy AnimationType enum when no effectAnimation slug is set', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, animation: AnimationType.ZOOM_IN })];
    const result = deriveCompositeParams(segments, 5, baseConfig);
    expect(result.animScale).toBeCloseTo(1.0 + 0.05 * 5, 6);
  });

  it('a non-zoom animation (in or out of the legacy enum) yields the neutral scale — out of scope for this engine', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, animation: AnimationType.KEN_BURNS })];
    const result = deriveCompositeParams(segments, 5, baseConfig);
    expect(result.animScale).toBe(1);
  });

  it('a currentTime outside every segment (e.g. past the last segment\'s end) yields the neutral scale, not an extrapolated one — no containing segment means no animation to derive from', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, effectAnimation: 'zoom-in' })];
    const result = deriveCompositeParams(segments, 50, baseConfig); // way past end, no containing segment
    expect(result.animScale).toBe(1);
  });
});

describe('deriveCompositeParams — grade passthrough', () => {
  it('returns NEUTRAL_GRADE when config.grade is not supplied', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10 })];
    const result = deriveCompositeParams(segments, 5, baseConfig);
    expect(result.grade).toEqual(NEUTRAL_GRADE);
  });

  it('passes config.grade through unmodified when supplied', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10 })];
    const grade = { brightness: 0.3, contrast: -0.2, saturation: 0.1, temperature: 0.4 };
    const result = deriveCompositeParams(segments, 5, { ...baseConfig, grade });
    expect(result.grade).toEqual(grade);
  });

  it('grade is independent of transition/zoom state within the same call', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'cross-dissolve', effectTransitionDuration: 1, effectAnimation: 'zoom-in' }),
      makeSegment({ id: 'b', startTime: 5, duration: 5, effectAnimation: 'zoom-out' }),
    ];
    const grade = { brightness: 0.5, contrast: 0, saturation: 0, temperature: 0 };
    const result = deriveCompositeParams(segments, 5.5, { ...baseConfig, grade });
    expect(result.transition).not.toBeNull();
    expect(result.grade).toEqual(grade);
  });
});
