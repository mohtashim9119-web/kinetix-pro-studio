import { describe, it, expect } from 'vitest';
import {
  deriveCompositeParams,
  deriveSlotPlan,
  brightnessOffsetUniform,
  brightnessFromOffset,
  contrastGainUniform,
  contrastFromGain,
  saturationMixUniform,
  temperatureTintUniform,
  SHADER_TEMPERATURE_CHANNEL_SCALE,
  NEUTRAL_GRADE,
  type GradeParams,
  type ProjectEffectConfig,
  type TransitionParams,
} from './compositeParams';
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
    expect(result.animScaleA).toBe(1);
    expect(result.animScaleB).toBe(1);
    expect(result.grade).toEqual(NEUTRAL_GRADE);
  });

  it('returns neutral defaults when currentTime falls outside every segment', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 5 })];
    const result = deriveCompositeParams(segments, 99, baseConfig);
    expect(result.transition).toBeNull();
    expect(result.animScaleA).toBe(1);
    expect(result.animScaleB).toBe(1);
  });
});

describe('deriveCompositeParams — transition window progress', () => {
  // seg-a [0,5) -> seg-b [5,10), the a->b transition resolved from seg-a's
  // own effectTransition field (the OUTGOING segment). The window is
  // CENTERED on the boundary (b.startTime = 5): [5 - duration/2, 5 +
  // duration/2) — supersedes the old anchored-at-B-start [5, 5+duration)
  // placement (D7 in project-state.md's Ignored Low Risk Bugs). See the
  // dedicated "50/50 centering" describe block below for symmetry-focused
  // coverage; these tests exercise the window/progress mechanics generally.
  function makeAB(duration = 1): VideoSegment[] {
    return [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'cross-dissolve', effectTransitionDuration: duration }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
  }

  it('progress is 0 at the window start (boundary - duration/2, still bounds-inside the OUTGOING segment)', () => {
    const result = deriveCompositeParams(makeAB(1), 4.5, baseConfig);
    expect(result.transition).toEqual({ type: 'cross-dissolve', progress: 0 });
  });

  it('progress is exactly 0.5 at the nominal A/B boundary itself', () => {
    const result = deriveCompositeParams(makeAB(1), 5, baseConfig);
    expect(result.transition?.progress).toBeCloseTo(0.5, 5);
  });

  it('progress approaches 1 just before the window closes (boundary + duration/2)', () => {
    const result = deriveCompositeParams(makeAB(1), 5.4999, baseConfig);
    expect(result.transition?.type).toBe('cross-dissolve');
    expect(result.transition?.progress).toBeCloseTo(0.9999, 4);
  });

  it('edge case: exactly at the window\'s closing boundary (boundary + duration/2), the transition is no longer active (matches useTransitionPreview.ts\'s half-open window)', () => {
    const result = deriveCompositeParams(makeAB(1), 5.5, baseConfig);
    expect(result.transition).toBeNull();
  });

  it('an unrecognised transition slug resolves to null — the engine only ever renders its own 4 slugs', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'not-a-real-slug', effectTransitionDuration: 1 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
    const result = deriveCompositeParams(segments, 5.2, baseConfig);
    expect(result.transition).toBeNull();
  });

  // Phase 5 cutover: slide-push was one of the 5 slugs retired from the UI
  // (effectsOptions.ts) because the GL engine never implemented it. A project
  // saved before the cutover can still carry it, so transitionResolver.ts folds
  // it into cross-dissolve — which IS GL-scoped. Without that fold this segment
  // would show a hard cut in preview while export still rendered a real
  // slide-push, i.e. exactly the preview/export divergence the cutover exists to
  // remove. Pins the fold end-to-end through the derivation, not just at the
  // resolver (transitionResolver.test.ts covers the mapping in isolation).
  it('a RETIRED slug (slide-push) folds into cross-dissolve and stays GL-rendered — no silent hard cut on a pre-cutover project', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'slide-push', effectTransitionDuration: 1 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
    const result = deriveCompositeParams(segments, 5.2, baseConfig);
    expect(result.transition).not.toBeNull();
    expect(result.transition?.type).toBe('cross-dissolve');
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
    // Window is [5-1, 5+1) = [4, 6); 4.5 is 0.25 through.
    const result = deriveCompositeParams(segments, 4.5, config);
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

  // Reachability: dip-black/dip-white were never independently constructed
  // as outputs anywhere in this file before — nothing proved
  // deriveCompositeParams could actually produce either slug at all.
  function makeABWithTransition(slug: string, duration = 1): VideoSegment[] {
    return [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: slug, effectTransitionDuration: duration }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
  }

  it('dip-black is reachable: progress 0 at window start, 1 approached at window end', () => {
    const segments = makeABWithTransition('dip-black');
    // duration=1 (makeABWithTransition default), boundary=5 → window [4.5, 5.5).
    expect(deriveCompositeParams(segments, 4.5, baseConfig).transition).toEqual({ type: 'dip-black', progress: 0 });
    expect(deriveCompositeParams(segments, 5.4999, baseConfig).transition?.progress).toBeCloseTo(0.9999, 4);
    expect(deriveCompositeParams(segments, 5.5, baseConfig).transition).toBeNull();
  });

  it('dip-white is reachable: progress 0 at window start, 1 approached at window end', () => {
    const segments = makeABWithTransition('dip-white');
    expect(deriveCompositeParams(segments, 4.5, baseConfig).transition).toEqual({ type: 'dip-white', progress: 0 });
    expect(deriveCompositeParams(segments, 5.4999, baseConfig).transition?.progress).toBeCloseTo(0.9999, 4);
    expect(deriveCompositeParams(segments, 5.5, baseConfig).transition).toBeNull();
  });

  it('light-leak is reachable at window start/mid, not just via the duration-fallback test above', () => {
    const segments = makeABWithTransition('light-leak', 2);
    // duration=2, boundary=5 → window [4, 6).
    expect(deriveCompositeParams(segments, 4, baseConfig).transition).toEqual({ type: 'light-leak', progress: 0 });
    expect(deriveCompositeParams(segments, 5, baseConfig).transition?.progress).toBeCloseTo(0.5, 5);
  });

  it('regression guard: dip-black and dip-white are never confused with each other when both are constructed in the same test-suite run — they are differentiated only by the effectTransition string value, not by structurally different code, which is exactly the "shared mechanism, parameter-only difference" shape the Phase 2 Step 1 vertex-shader flip bug taught us to distrust', () => {
    // duration=1, boundary=5 → window [4.5, 5.5); 4.8 and 5.2 are both inside.
    const blackResult = deriveCompositeParams(makeABWithTransition('dip-black'), 5.2, baseConfig);
    const whiteResult = deriveCompositeParams(makeABWithTransition('dip-white'), 5.2, baseConfig);

    expect(blackResult.transition?.type).toBe('dip-black');
    expect(whiteResult.transition?.type).toBe('dip-white');
    expect(blackResult.transition?.type).not.toBe(whiteResult.transition?.type);

    // Run both again, black-then-white then white-then-black, to rule out
    // any hidden module-level state (there is none in this pure function,
    // but the guard is cheap and matches the class of bug being distrusted).
    const secondBlack = deriveCompositeParams(makeABWithTransition('dip-black'), 4.8, baseConfig);
    expect(secondBlack.transition?.type).toBe('dip-black');
  });

  it('adjacency: a tick just past the transition window close (boundary + duration/2 + epsilon) is inactive; a tick just before close is still active — no off-by-epsilon confusion at the boundary', () => {
    const segments = makeABWithTransition('cross-dissolve', 1);
    const justBeforeClose = deriveCompositeParams(segments, 5.5 - 1e-4, baseConfig);
    const justAfterClose = deriveCompositeParams(segments, 5.5 + 1e-4, baseConfig);
    expect(justBeforeClose.transition).not.toBeNull();
    expect(justAfterClose.transition).toBeNull();
  });
});

describe('deriveCompositeParams — 50/50 centering (transition-centering fix)', () => {
  // Supersedes the old anchored-at-B-start placement, where the entire
  // transition duration played AFTER the boundary (100/0 split — D7 in
  // project-state.md's Ignored Low Risk Bugs). These tests exist
  // specifically to pin the centered spec: half before, half after, 0.5
  // exactly at the boundary — see docs/webgl-architecture-plan.md's
  // transition-centering entry.
  function makeAB(duration: number): VideoSegment[] {
    return [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'cross-dissolve', effectTransitionDuration: duration }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
  }

  it('progress is exactly 0.5 at the nominal A/B boundary, regardless of transition duration', () => {
    for (const duration of [0.5, 1, 2, 3]) {
      const result = deriveCompositeParams(makeAB(duration), 5, baseConfig);
      expect(result.transition?.progress).toBeCloseTo(0.5, 6);
    }
  });

  it('the window opens duration/2 seconds BEFORE the boundary and closes duration/2 seconds after — symmetric around the boundary', () => {
    const duration = 2;
    const segments = makeAB(duration);
    // Open edge: boundary - duration/2 = 4.
    expect(deriveCompositeParams(segments, 4, baseConfig).transition).not.toBeNull();
    expect(deriveCompositeParams(segments, 4 - 1e-6, baseConfig).transition).toBeNull();
    // Close edge: boundary + duration/2 = 6 (exclusive).
    expect(deriveCompositeParams(segments, 6 - 1e-6, baseConfig).transition).not.toBeNull();
    expect(deriveCompositeParams(segments, 6, baseConfig).transition).toBeNull();
  });

  it('half the window sits before the boundary (bounds-inside the OUTGOING segment) and half after (bounds-inside the INCOMING segment) — both halves resolve the SAME active transition', () => {
    const duration = 2;
    const segments = makeAB(duration);
    // 4.5 is bounds-inside 'a' [0,5) AND inside the transition window [4,6).
    const preBoundary = deriveCompositeParams(segments, 4.5, baseConfig);
    expect(preBoundary.transition?.type).toBe('cross-dissolve');
    expect(preBoundary.transition?.progress).toBeCloseTo(0.25, 6);
    // 5.5 is bounds-inside 'b' [5,10) AND inside the transition window [4,6).
    const postBoundary = deriveCompositeParams(segments, 5.5, baseConfig);
    expect(postBoundary.transition?.type).toBe('cross-dissolve');
    expect(postBoundary.transition?.progress).toBeCloseTo(0.75, 6);
  });
});

describe('deriveCompositeParams — zoom animScaleA (single-segment, no active transition)', () => {
  // With no active transition, slot A carries the containing segment's zoom
  // (animScaleA) and slot B is unused (animScaleB === 1). These tests pin the
  // slot-A scale; the per-layer transition behavior is covered by the
  // continuity describe block below.
  it('zoom-in scale is exactly 1.0 at segment start (t=0)', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, effectAnimation: 'zoom-in' })];
    const result = deriveCompositeParams(segments, 0, baseConfig);
    expect(result.animScaleA).toBeCloseTo(1.0, 6);
    expect(result.animScaleB).toBe(1);
  });

  it('zoom-in scale approaches 1.0 + 0.05*duration as currentTime approaches segment end (half-open [start, start+duration) window, matching findContainingSegment/transitionResolver convention — exactly at the boundary belongs to the next segment, not this one)', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, effectAnimation: 'zoom-in' })];
    const result = deriveCompositeParams(segments, 10 - 1e-6, baseConfig);
    expect(result.animScaleA).toBeCloseTo(1.5, 4);
  });

  it('zoom-in scale at the midpoint matches the 1.0 + 0.05*t formula exactly', () => {
    const segments = [makeSegment({ id: 'a', startTime: 2, duration: 8, effectAnimation: 'zoom-in' })];
    const result = deriveCompositeParams(segments, 2 + 4, baseConfig); // timeInSegment = 4
    expect(result.animScaleA).toBeCloseTo(1.0 + 0.05 * 4, 6);
  });

  it('zoom-out starts at the end-scale a matching zoom-in would reach, and decreases toward 1.0', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, effectAnimation: 'zoom-out' })];
    const atStart = deriveCompositeParams(segments, 0, baseConfig);
    const atEnd = deriveCompositeParams(segments, 10, baseConfig);
    expect(atStart.animScaleA).toBeCloseTo(1.0 + 0.05 * 10, 6); // 1.5
    expect(atEnd.animScaleA).toBeCloseTo(1.0, 6);
  });

  it('falls back to the legacy AnimationType enum when no effectAnimation slug is set', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, animation: AnimationType.ZOOM_IN })];
    const result = deriveCompositeParams(segments, 5, baseConfig);
    expect(result.animScaleA).toBeCloseTo(1.0 + 0.05 * 5, 6);
  });

  it('a non-zoom animation (in or out of the legacy enum) yields the neutral scale — out of scope for this engine', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, animation: AnimationType.KEN_BURNS })];
    const result = deriveCompositeParams(segments, 5, baseConfig);
    expect(result.animScaleA).toBe(1);
  });

  it('a currentTime outside every segment (e.g. past the last segment\'s end) yields the neutral scale, not an extrapolated one — no containing segment means no animation to derive from', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, effectAnimation: 'zoom-in' })];
    const result = deriveCompositeParams(segments, 50, baseConfig); // way past end, no containing segment
    expect(result.animScaleA).toBe(1);
    expect(result.animScaleB).toBe(1);
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
    // Window is [4.5, 5.5); 4.9 is inside it (pre-boundary half).
    const result = deriveCompositeParams(segments, 4.9, { ...baseConfig, grade });
    expect(result.transition).not.toBeNull();
    expect(result.grade).toEqual(grade);
  });

  it('grade is independent of transition/zoom-OUT state within the same call — the combined-tick test above only ever exercised zoom-in; resolveAnimScale\'s zoom-out branch is a separate formula and deserves its own combined-tick coverage', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'dip-white', effectTransitionDuration: 1 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5, effectAnimation: 'zoom-out' }),
    ];
    const grade = { brightness: 0, contrast: 0, saturation: 0.6, temperature: -0.3 };
    // currentTime=5 is exactly the boundary (progress 0.5). Per-layer: slot A
    // (outgoing 'a', no animation) is neutral; slot B (incoming 'b', zoom-out)
    // is at its own timeInSegment=0 start-scale. Pre-Bug-2 this test asserted a
    // SINGLE animScale that had already flipped to 'b' at the boundary — now
    // each layer carries its own scale, which is the whole point of the fix.
    const result = deriveCompositeParams(segments, 5, { ...baseConfig, grade });
    expect(result.transition).toEqual({ type: 'dip-white', progress: 0.5 });
    expect(result.animScaleA).toBe(1); // outgoing 'a' has no animation
    expect(result.animScaleB).toBeCloseTo(1.0 + 0.05 * 5, 6); // zoom-out at timeInSegment=0 of a 5s segment (its start-scale)
    expect(result.grade).toEqual(grade);
  });
});

describe('deriveCompositeParams — per-segment grade (Phase 4)', () => {
  it('resolves grade from the containing segment\'s effectGrade', () => {
    const grade = { brightness: 0.2, contrast: 0.1, saturation: -0.3, temperature: 0.5 };
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, effectGrade: grade })];
    const result = deriveCompositeParams(segments, 5, baseConfig);
    expect(result.grade).toEqual(grade);
  });

  it('containing segment\'s effectGrade wins over the project-level config.grade fallback', () => {
    const segGrade = { brightness: 0.4, contrast: 0, saturation: 0, temperature: 0 };
    const cfgGrade = { brightness: -0.4, contrast: 0, saturation: 0, temperature: 0 };
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10, effectGrade: segGrade })];
    const result = deriveCompositeParams(segments, 5, { ...baseConfig, grade: cfgGrade });
    expect(result.grade).toEqual(segGrade);
  });

  it('falls back to config.grade when the containing segment has no effectGrade', () => {
    const cfgGrade = { brightness: -0.4, contrast: 0, saturation: 0.2, temperature: 0 };
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10 })];
    const result = deriveCompositeParams(segments, 5, { ...baseConfig, grade: cfgGrade });
    expect(result.grade).toEqual(cfgGrade);
  });

  it('falls back to NEUTRAL_GRADE when neither the segment nor config supplies a grade', () => {
    const segments = [makeSegment({ id: 'a', startTime: 0, duration: 10 })];
    const result = deriveCompositeParams(segments, 5, baseConfig);
    expect(result.grade).toEqual(NEUTRAL_GRADE);
  });

  it('grade is per-segment: follows whichever segment currentTime is inside (no transition)', () => {
    const gradeA = { brightness: 0.3, contrast: 0, saturation: 0, temperature: 0 };
    const gradeB = { brightness: -0.3, contrast: 0, saturation: 0, temperature: 0 };
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectGrade: gradeA }),
      makeSegment({ id: 'b', startTime: 5, duration: 5, effectGrade: gradeB }),
    ];
    expect(deriveCompositeParams(segments, 2, baseConfig).grade).toEqual(gradeA);
    expect(deriveCompositeParams(segments, 7, baseConfig).grade).toEqual(gradeB);
  });

  it('grade snaps at the transition midpoint — follows the containing segment through a centered window (accepted Phase 4 limitation)', () => {
    const gradeA = { brightness: 0.5, contrast: 0, saturation: 0, temperature: 0 };
    const gradeB = { brightness: -0.5, contrast: 0, saturation: 0, temperature: 0 };
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'cross-dissolve', effectTransitionDuration: 1, effectGrade: gradeA }),
      makeSegment({ id: 'b', startTime: 5, duration: 5, effectGrade: gradeB }),
    ];
    // Window [4.5, 5.5): before the boundary currentTime is inside 'a', after it's inside 'b'.
    const before = deriveCompositeParams(segments, 4.9, baseConfig);
    const after = deriveCompositeParams(segments, 5.1, baseConfig);
    expect(before.transition).not.toBeNull();
    expect(after.transition).not.toBeNull();
    expect(before.grade).toEqual(gradeA); // still inside outgoing 'a'
    expect(after.grade).toEqual(gradeB);  // now inside incoming 'b'
  });
});

describe('deriveCompositeParams — per-layer zoom continuity across a transition (Bug 2 fix)', () => {
  // The pre-Bug-2 single animScale was derived from the bounds-CONTAINING
  // segment, which flips outgoing→incoming at transition progress 0.5, so the
  // one scale snapped from the outgoing segment's accumulated zoom to the
  // incoming segment's fresh zoom mid-blend (a visible pop, masked by opaque
  // dips but plain through cross-dissolve/light-leak). animScaleA/animScaleB
  // are each derived from their OWN segment's clock (clamped by
  // resolveAnimScale to [0, duration]), so each layer's scale is continuous
  // across the boundary.
  //
  // a[0,5) -> b[5,10), cross-dissolve duration 2 centered on the boundary at
  // t=5 → window [4,6). Sampled just before/after the boundary.
  function makeZoomAB(aAnim: 'zoom-in' | 'zoom-out', bAnim: 'zoom-in' | 'zoom-out'): VideoSegment[] {
    return [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'cross-dissolve', effectTransitionDuration: 2, effectAnimation: aAnim }),
      makeSegment({ id: 'b', startTime: 5, duration: 5, effectAnimation: bAnim }),
    ];
  }

  it('animScaleA follows the OUTGOING segment continuously and HOLDS at its end-scale past the boundary (does not reset)', () => {
    const segs = makeZoomAB('zoom-in', 'zoom-out');
    const before = deriveCompositeParams(segs, 5 - 1e-4, baseConfig);
    const after = deriveCompositeParams(segs, 5 + 1e-4, baseConfig);
    // 'a' zoom-in at t≈5 (clamped to its duration 5) = 1 + 0.05*5 = 1.25.
    expect(before.animScaleA).toBeCloseTo(1.25, 3);
    // Past the boundary, currentTime - a.startTime > a.duration, so
    // resolveAnimScale clamps timeInSegment to a.duration → still 1.25.
    expect(after.animScaleA).toBeCloseTo(1.25, 3);
    // Continuity: the outgoing layer's scale barely changes across the boundary
    // (no snap). Pre-fix, the single scale jumped here to 'b' instead.
    expect(Math.abs(after.animScaleA - before.animScaleA)).toBeLessThan(1e-2);
  });

  it('animScaleB follows the INCOMING segment continuously and HOLDS at its start-scale before the boundary', () => {
    const segs = makeZoomAB('zoom-in', 'zoom-out');
    const before = deriveCompositeParams(segs, 5 - 1e-4, baseConfig);
    const after = deriveCompositeParams(segs, 5 + 1e-4, baseConfig);
    // 'b' zoom-out start-scale = 1 + 0.05*5 = 1.25. Before the boundary
    // currentTime - b.startTime < 0 → clamped to 0 → still the start-scale.
    expect(before.animScaleB).toBeCloseTo(1.25, 3);
    expect(after.animScaleB).toBeCloseTo(1.25, 3);
    expect(Math.abs(after.animScaleB - before.animScaleB)).toBeLessThan(1e-2);
  });

  it('the reverse pairing (zoom-out -> zoom-in) is likewise continuous per layer', () => {
    const segs = makeZoomAB('zoom-out', 'zoom-in');
    const before = deriveCompositeParams(segs, 5 - 1e-4, baseConfig);
    const after = deriveCompositeParams(segs, 5 + 1e-4, baseConfig);
    // 'a' zoom-out at its end (t=5) = (1 + 0.05*5) - 0.05*5 = 1.0; held after.
    expect(before.animScaleA).toBeCloseTo(1.0, 3);
    expect(after.animScaleA).toBeCloseTo(1.0, 3);
    // 'b' zoom-in at its start (t=0) = 1.0; held before.
    expect(before.animScaleB).toBeCloseTo(1.0, 3);
    expect(after.animScaleB).toBeCloseTo(1.0, 3);
  });

  it('the outgoing layer keeps its accumulated zoom while the incoming layer with no zoom stays neutral — the two never bleed onto each other (the exact pop the old single-scalar model produced)', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 10, effectTransition: 'cross-dissolve', effectTransitionDuration: 2, effectAnimation: 'zoom-in' }),
      makeSegment({ id: 'b', startTime: 10, duration: 5 }), // no zoom on the incoming segment
    ];
    // window [9,11); boundary 10. Half a second PAST the boundary.
    const after = deriveCompositeParams(segments, 10 + 0.5, baseConfig);
    // Outgoing 'a' zoom-in clamped at its duration 10 = 1 + 0.05*10 = 1.5 — it
    // keeps its accumulated zoom instead of snapping to the incoming segment.
    expect(after.animScaleA).toBeCloseTo(1.5, 3);
    // Incoming 'b' has no zoom — its own layer is neutral. Pre-fix, the single
    // scale would have already popped to 1.0 here (incoming's fresh scale),
    // rescaling the whole blended composite at once.
    expect(after.animScaleB).toBe(1);
  });
});

describe('deriveSlotPlan — texture slot A/B assignment (Phase 3)', () => {
  // The compositor reads u_texA at progress 0 (OUTGOING) and u_texB at
  // progress 1 (INCOMING); deriveSlotPlan encodes exactly that so slot 'a'
  // is the outgoing/previous segment during a transition and 'b' the
  // incoming/containing one — the pairing useGlPreview.ts then feeds the
  // outgoing pool-pull into 'a' and the live current frame into 'b'.
  //
  // Since the centered window (see the "50/50 centering" describe block
  // above), deriveSlotPlan can no longer infer outgoing/incoming from
  // bounds-containment alone — it re-derives the active boundary via the
  // same resolveActiveBoundary deriveCompositeParams uses, which needs
  // `config` to resolve each candidate's transition. `transition` itself is
  // now purely an activation gate (null = suppressed/no-op), not a source
  // of pairing information — see this function's own doc comment.
  const noTransition: TransitionParams | null = null;
  const activeCrossDissolve: TransitionParams = { type: 'cross-dissolve', progress: 0.4 };

  // No resolvable transition config — used for the no-transition and
  // outside-bounds cases, which don't need an active boundary.
  function makeAB(): VideoSegment[] {
    return [
      makeSegment({ id: 'a', startTime: 0, duration: 5 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
  }

  // A real, resolvable transition on the a->b boundary (duration 1 →
  // window [4.5, 5.5)) — needed for every "active transition" case, since
  // deriveSlotPlan must genuinely resolve the pairing via config now.
  function makeABWithTransition(slug: 'cross-dissolve' | 'dip-black' | 'dip-white' | 'light-leak' = 'cross-dissolve'): VideoSegment[] {
    return [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: slug, effectTransitionDuration: 1 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
  }

  it('no transition, mid-segment: slot a = the containing (current) segment, slot b = null', () => {
    const segments = makeAB();
    const plan = deriveSlotPlan(segments, 2, noTransition, baseConfig);
    expect(plan.a?.id).toBe('a');
    expect(plan.b).toBeNull();
  });

  it('no transition, inside the second segment: slot a follows the playhead to that segment', () => {
    const segments = makeAB();
    const plan = deriveSlotPlan(segments, 7, noTransition, baseConfig);
    expect(plan.a?.id).toBe('b');
    expect(plan.b).toBeNull();
  });

  it('currentTime outside every segment: both slots null (nothing to draw)', () => {
    const segments = makeAB();
    const plan = deriveSlotPlan(segments, 99, noTransition, baseConfig);
    expect(plan.a).toBeNull();
    expect(plan.b).toBeNull();
  });

  it('active transition, pre-boundary half: slot a = OUTGOING, slot b = INCOMING — even though currentTime is still bounds-inside the outgoing segment', () => {
    const segments = makeABWithTransition();
    // Window is [4.5, 5.5); 4.7 is bounds-inside 'a' [0,5) but inside the window.
    const plan = deriveSlotPlan(segments, 4.7, activeCrossDissolve, baseConfig);
    expect(plan.a?.id).toBe('a'); // outgoing
    expect(plan.b?.id).toBe('b'); // incoming
  });

  it('active transition, post-boundary half: same outgoing/incoming pairing — now bounds-inside the incoming segment', () => {
    const segments = makeABWithTransition();
    const plan = deriveSlotPlan(segments, 5.3, activeCrossDissolve, baseConfig);
    expect(plan.a?.id).toBe('a');
    expect(plan.b?.id).toBe('b');
  });

  it('slot assignment is source-type agnostic — the same ids come back regardless of whether the assets are video or image (kind is resolved later by the driver): video<->image and image<->image assign identically to video<->video', () => {
    // deriveSlotPlan never inspects assets — same segments, same plan. This
    // is what lets useGlPreview.ts source slot 'a'/'b' from a VideoFrame OR
    // an image texture without deriveSlotPlan needing to know which.
    const segments = makeABWithTransition();
    const plan = deriveSlotPlan(segments, 4.7, activeCrossDissolve, baseConfig);
    expect(plan.a?.id).toBe('a');
    expect(plan.b?.id).toBe('b');
  });

  it('each of the 4 GL-scoped transition slugs produces the same outgoing/incoming pairing (the shader differs, the slot roles do not)', () => {
    for (const type of ['cross-dissolve', 'dip-black', 'dip-white', 'light-leak'] as const) {
      const segments = makeABWithTransition(type);
      const plan = deriveSlotPlan(segments, 4.7, { type, progress: 0.5 }, baseConfig);
      expect(plan.a?.id).toBe('a');
      expect(plan.b?.id).toBe('b');
    }
  });

  it('a suppressed transition (null — e.g. the isResizingRef/D12 drag guard forces transition=null upstream) collapses cleanly to the no-transition assignment: slot a = the containing segment, slot b = null, even while the playhead sits where a transition window would otherwise be', () => {
    const segments = makeABWithTransition();
    // Same playhead as the post-boundary active-transition test (containing = 'b'), but transition forced null.
    const plan = deriveSlotPlan(segments, 5.3, null, baseConfig);
    expect(plan.a?.id).toBe('b'); // containing segment at t=5.3 is seg-b
    expect(plan.b).toBeNull();
  });

  it('consistency with deriveCompositeParams: feeding it the SAME (segments, currentTime, config) and passing its resolved transition into deriveSlotPlan yields outgoing/incoming that agree with that transition being active', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'dip-black', effectTransitionDuration: 1 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
    const params = deriveCompositeParams(segments, 5.3, baseConfig);
    expect(params.transition?.type).toBe('dip-black');
    const plan = deriveSlotPlan(segments, 5.3, params.transition, baseConfig);
    expect(plan.a?.id).toBe('a');
    expect(plan.b?.id).toBe('b');
  });

  it('consistency with deriveCompositeParams holds on the pre-boundary half too — the case that could not exist before centering (the window used to sit entirely inside the incoming segment)', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'dip-black', effectTransitionDuration: 1 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
    const params = deriveCompositeParams(segments, 4.7, baseConfig);
    expect(params.transition?.type).toBe('dip-black');
    const plan = deriveSlotPlan(segments, 4.7, params.transition, baseConfig);
    expect(plan.a?.id).toBe('a');
    expect(plan.b?.id).toBe('b');
  });

  it('epsilon boundary: exactly at the window open (boundary - duration/2) both slots populate; just past the window close a null transition collapses to current-only', () => {
    const segments = makeABWithTransition();
    const atOpen = deriveSlotPlan(segments, 4.5, { type: 'cross-dissolve', progress: 0 }, baseConfig);
    expect(atOpen.a?.id).toBe('a');
    expect(atOpen.b?.id).toBe('b');
    // After the window closes (5.5) deriveCompositeParams returns
    // transition=null; deriveSlotPlan then draws the current (bounds-
    // containing) segment alone.
    const afterClose = deriveSlotPlan(segments, 6.0001, null, baseConfig);
    expect(afterClose.a?.id).toBe('b');
    expect(afterClose.b).toBeNull();
  });
});

/**
 * Grade slider → uniform remaps. Each channel maps the full −1..1 slider sweep
 * onto a gentler EFFECTIVE range so every slider position is usable; the
 * end-to-end property all four exist to guarantee (no combination flattens the
 * frame) is pinned by the simulation describe at the bottom.
 */

const SLIDER_SWEEP = [-1, -0.9, -0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5, 0.9, 1];

describe('brightnessOffsetUniform — additive brightness remap', () => {
  it('maps neutral (0) to 0', () => {
    expect(brightnessOffsetUniform(0)).toBe(0);
  });

  it('maps ±1 to ±BRIGHTNESS_MAX_OFFSET (±0.25), NOT ±1 — the raw feed spent the entire 0..1 channel range, blowing toward white by ~+0.57', () => {
    expect(brightnessOffsetUniform(1)).toBeCloseTo(0.25, 10);
    expect(brightnessOffsetUniform(-1)).toBeCloseTo(-0.25, 10);
  });

  it('is a strictly increasing odd function across the sweep', () => {
    for (const b of SLIDER_SWEEP) expect(brightnessOffsetUniform(-b)).toBeCloseTo(-brightnessOffsetUniform(b), 10);
    for (let i = 1; i < SLIDER_SWEEP.length; i++) {
      expect(brightnessOffsetUniform(SLIDER_SWEEP[i]!)).toBeGreaterThan(brightnessOffsetUniform(SLIDER_SWEEP[i - 1]!));
    }
  });

  it('brightnessFromOffset inverts it exactly', () => {
    for (const b of SLIDER_SWEEP) expect(brightnessFromOffset(brightnessOffsetUniform(b))).toBeCloseTo(b, 10);
  });
});

describe('contrastGainUniform — exponential contrast remap', () => {
  const gain = (c: number): number => 1 + contrastGainUniform(c);

  it('maps neutral (0) to 0 — the shader\'s "1 + u_contrast" stays 1 (gain 1×)', () => {
    expect(contrastGainUniform(0)).toBe(0);
  });

  it('maps +1 to gain CONTRAST_GAIN_MAX (1.6×) and −1 to gain 1/1.6 (0.625×) — the exponential is symmetric in log space, so one constant fixes both ends', () => {
    expect(gain(1)).toBeCloseTo(1.6, 10);
    expect(gain(-1)).toBeCloseTo(1 / 1.6, 10);
  });

  it('never reaches gain 0 for any finite slider value — the dead flat-gray state (every pixel to mid-gray regardless of content) is unreachable by construction, not merely avoided by clamping', () => {
    for (const c of SLIDER_SWEEP) expect(gain(c)).toBeGreaterThan(0);
  });

  it('rejects both superseded curves at −1: the raw linear feed (gain 0×, flat gray) and the untightened 2^c (gain 0.5×)', () => {
    expect(gain(-1)).not.toBeCloseTo(0, 3);
    expect(gain(-1)).not.toBeCloseTo(0.5, 3);
  });

  it('rejects the untightened 2^c at +1 too — gain 1.6×, not 2×', () => {
    expect(gain(1)).not.toBeCloseTo(2, 3);
  });

  it('contrastFromGain inverts it exactly — this is the inverse autoGrade solves through, so a drift here desyncs Auto from the manual sliders', () => {
    for (const c of SLIDER_SWEEP) expect(contrastFromGain(gain(c))).toBeCloseTo(c, 10);
  });
});

describe('saturationMixUniform — saturation remap', () => {
  const mix = (s: number): number => 1 + saturationMixUniform(s);

  it('maps neutral (0) to 0 — the shader\'s "1 + u_saturation" mix factor stays 1', () => {
    expect(saturationMixUniform(0)).toBe(0);
  });

  it('maps ±1 to a 0.4×–1.6× mix factor', () => {
    expect(mix(1)).toBeCloseTo(1.6, 10);
    expect(mix(-1)).toBeCloseTo(0.4, 10);
  });

  it('keeps some color at the bottom of the sweep — the mix factor never reaches 0 (full grayscale is a look, not a range endpoint)', () => {
    for (const s of SLIDER_SWEEP) expect(mix(s)).toBeGreaterThan(0);
  });
});

describe('temperatureTintUniform — temperature remap', () => {
  it('maps neutral (0) to 0', () => {
    expect(temperatureTintUniform(0)).toBe(0);
  });

  it('maps ±1 to ±TEMPERATURE_MAX_STRENGTH (±0.4) → a ±0.04 R/B channel shift once the shader applies its own 0.1 coefficient — a tint, not a channel-clipping cast', () => {
    expect(temperatureTintUniform(1)).toBeCloseTo(0.4, 10);
    expect(temperatureTintUniform(1) * SHADER_TEMPERATURE_CHANNEL_SCALE).toBeCloseTo(0.04, 10);
    expect(temperatureTintUniform(-1) * SHADER_TEMPERATURE_CHANNEL_SCALE).toBeCloseTo(-0.04, 10);
  });
});

/**
 * The end-to-end property the four remaps exist for, checked the only way that
 * actually proves it: by running the grade shader's real per-pixel math on the
 * CPU over every extreme slider combination. Unit-testing each remap's endpoints
 * alone would NOT catch "brightness +1 and contrast +1 together blow to white" —
 * that failure only exists in the composition, which is exactly what was broken.
 */
describe('grade remaps — no slider combination flattens the frame', () => {
  /** shaders.ts's GRADE_FRAGMENT_SHADER_SOURCE, transcribed 1:1, fed the same
   *  remapped uniforms glCompositor.ts's drawGrade sends. */
  function applyGrade(rgb: [number, number, number], g: GradeParams): [number, number, number] {
    const bOff = brightnessOffsetUniform(g.brightness);
    const cGain = 1 + contrastGainUniform(g.contrast);
    const sMix = 1 + saturationMixUniform(g.saturation);
    const tTint = temperatureTintUniform(g.temperature);

    let c = rgb.map((v) => v + bOff) as [number, number, number];
    c = c.map((v) => (v - 0.5) * cGain + 0.5) as [number, number, number];
    const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    c = c.map((v) => luma + (v - luma) * sMix) as [number, number, number];
    c[0] += tTint * SHADER_TEMPERATURE_CHANNEL_SCALE;
    c[2] -= tTint * SHADER_TEMPERATURE_CHANNEL_SCALE;
    return c.map((v) => Math.max(0, Math.min(1, v))) as [number, number, number];
  }

  /** Every corner of the 4-D slider space, plus the mid-extremes. */
  const combos: GradeParams[] = [];
  for (const brightness of [-1, 0, 1]) {
    for (const contrast of [-1, 0, 1]) {
      for (const saturation of [-1, 0, 1]) {
        for (const temperature of [-1, 0, 1]) combos.push({ brightness, contrast, saturation, temperature });
      }
    }
  }

  /** A normal-exposure test frame: a mid-tone ramp with a little color. Not a
   *  pathological all-black/all-white input — the claim under test is that
   *  ordinary content survives every slider position. */
  const frame: [number, number, number][] = [
    [0.2, 0.22, 0.25],
    [0.35, 0.33, 0.3],
    [0.5, 0.5, 0.5],
    [0.62, 0.6, 0.55],
    [0.78, 0.76, 0.8],
  ];

  it('preserves visible tonal separation across the frame for every extreme slider combination', () => {
    for (const g of combos) {
      const out = frame.map((px) => applyGrade(px, g));
      const lumas = out.map(([r, gg, b]) => 0.2126 * r + 0.7152 * gg + 0.0722 * b);
      const spread = Math.max(...lumas) - Math.min(...lumas);
      // The old raw feed produced spread === 0 here (flat gray → tinted flat
      // color) at contrast=−1, and collapsed to a solid 0 or 1 wherever
      // brightness and contrast pushed the same way.
      expect(spread, `flattened at ${JSON.stringify(g)}`).toBeGreaterThan(0.05);
    }
  });

  it('never drives the whole frame to solid black or solid white for any extreme slider combination', () => {
    for (const g of combos) {
      const out = frame.map((px) => applyGrade(px, g));
      const allBlack = out.every((px) => px.every((v) => v <= 0.001));
      const allWhite = out.every((px) => px.every((v) => v >= 0.999));
      expect(allBlack, `solid black at ${JSON.stringify(g)}`).toBe(false);
      expect(allWhite, `solid white at ${JSON.stringify(g)}`).toBe(false);
    }
  });

  it('leaves the frame untouched at neutral', () => {
    for (const px of frame) {
      const out = applyGrade(px, { brightness: 0, contrast: 0, saturation: 0, temperature: 0 });
      out.forEach((v, i) => expect(v).toBeCloseTo(px[i]!, 10));
    }
  });
});
