import { describe, it, expect } from 'vitest';
import {
  deriveCompositeParams,
  deriveSlotPlan,
  NEUTRAL_GRADE,
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
    expect(deriveCompositeParams(segments, 5, baseConfig).transition).toEqual({ type: 'dip-black', progress: 0 });
    expect(deriveCompositeParams(segments, 5.999, baseConfig).transition?.progress).toBeCloseTo(0.999, 5);
    expect(deriveCompositeParams(segments, 6, baseConfig).transition).toBeNull();
  });

  it('dip-white is reachable: progress 0 at window start, 1 approached at window end', () => {
    const segments = makeABWithTransition('dip-white');
    expect(deriveCompositeParams(segments, 5, baseConfig).transition).toEqual({ type: 'dip-white', progress: 0 });
    expect(deriveCompositeParams(segments, 5.999, baseConfig).transition?.progress).toBeCloseTo(0.999, 5);
    expect(deriveCompositeParams(segments, 6, baseConfig).transition).toBeNull();
  });

  it('light-leak is reachable at window start/mid, not just via the duration-fallback test above', () => {
    const segments = makeABWithTransition('light-leak', 2);
    expect(deriveCompositeParams(segments, 5, baseConfig).transition).toEqual({ type: 'light-leak', progress: 0 });
    expect(deriveCompositeParams(segments, 6, baseConfig).transition?.progress).toBeCloseTo(0.5, 5);
  });

  it('regression guard: dip-black and dip-white are never confused with each other when both are constructed in the same test-suite run — they are differentiated only by the effectTransition string value, not by structurally different code, which is exactly the "shared mechanism, parameter-only difference" shape the Phase 2 Step 1 vertex-shader flip bug taught us to distrust', () => {
    const blackResult = deriveCompositeParams(makeABWithTransition('dip-black'), 5.3, baseConfig);
    const whiteResult = deriveCompositeParams(makeABWithTransition('dip-white'), 5.3, baseConfig);

    expect(blackResult.transition?.type).toBe('dip-black');
    expect(whiteResult.transition?.type).toBe('dip-white');
    expect(blackResult.transition?.type).not.toBe(whiteResult.transition?.type);

    // Run both again, black-then-white then white-then-black, to rule out
    // any hidden module-level state (there is none in this pure function,
    // but the guard is cheap and matches the class of bug being distrusted).
    const secondBlack = deriveCompositeParams(makeABWithTransition('dip-black'), 5.7, baseConfig);
    expect(secondBlack.transition?.type).toBe('dip-black');
  });

  it('adjacency: a tick just past the transition window close (start + duration + epsilon) is inactive; a tick just before close is still active — no off-by-epsilon confusion at the boundary', () => {
    const segments = makeABWithTransition('cross-dissolve', 1);
    const justBeforeClose = deriveCompositeParams(segments, 5 + 1 - 1e-4, baseConfig);
    const justAfterClose = deriveCompositeParams(segments, 5 + 1 + 1e-4, baseConfig);
    expect(justBeforeClose.transition).not.toBeNull();
    expect(justAfterClose.transition).toBeNull();
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

  it('grade is independent of transition/zoom-OUT state within the same call — the combined-tick test above only ever exercised zoom-in; resolveAnimScale\'s zoom-out branch is a separate formula and deserves its own combined-tick coverage', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'dip-white', effectTransitionDuration: 1 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5, effectAnimation: 'zoom-out' }),
    ];
    const grade = { brightness: 0, contrast: 0, saturation: 0.6, temperature: -0.3 };
    const result = deriveCompositeParams(segments, 5.5, { ...baseConfig, grade });
    expect(result.transition).toEqual({ type: 'dip-white', progress: 0.5 });
    expect(result.animScale).toBeCloseTo(1.0 + 0.05 * (5 - 0.5), 6); // zoom-out at timeInSegment=0.5 of an 5s segment
    expect(result.grade).toEqual(grade);
  });
});

describe('deriveSlotPlan — texture slot A/B assignment (Phase 3)', () => {
  // The compositor reads u_texA at progress 0 (OUTGOING) and u_texB at
  // progress 1 (INCOMING); deriveSlotPlan encodes exactly that so slot 'a'
  // is the outgoing/previous segment during a transition and 'b' the
  // incoming/containing one — the pairing useGlPreview.ts then feeds the
  // outgoing pool-pull into 'a' and the live current frame into 'b'.
  const noTransition: TransitionParams | null = null;
  const activeCrossDissolve: TransitionParams = { type: 'cross-dissolve', progress: 0.4 };

  function makeAB(): VideoSegment[] {
    return [
      makeSegment({ id: 'a', startTime: 0, duration: 5 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
  }

  it('no transition, mid-segment: slot a = the containing (current) segment, slot b = null', () => {
    const segments = makeAB();
    const plan = deriveSlotPlan(segments, 2, noTransition);
    expect(plan.a?.id).toBe('a');
    expect(plan.b).toBeNull();
  });

  it('no transition, inside the second segment: slot a follows the playhead to that segment', () => {
    const segments = makeAB();
    const plan = deriveSlotPlan(segments, 7, noTransition);
    expect(plan.a?.id).toBe('b');
    expect(plan.b).toBeNull();
  });

  it('currentTime outside every segment: both slots null (nothing to draw)', () => {
    const segments = makeAB();
    const plan = deriveSlotPlan(segments, 99, noTransition);
    expect(plan.a).toBeNull();
    expect(plan.b).toBeNull();
  });

  it('active transition: slot a = OUTGOING (previous) segment, slot b = INCOMING (containing/current) segment', () => {
    const segments = makeAB();
    // Playhead just inside seg-b's leading window (containing = incoming = 'b').
    const plan = deriveSlotPlan(segments, 5.4, activeCrossDissolve);
    expect(plan.a?.id).toBe('a'); // outgoing
    expect(plan.b?.id).toBe('b'); // incoming
  });

  it('slot assignment is source-type agnostic — the same ids come back regardless of whether the assets are video or image (kind is resolved later by the driver): video<->image and image<->image assign identically to video<->video', () => {
    // deriveSlotPlan never inspects assets — same segments, same plan. This
    // is what lets useGlPreview.ts source slot 'a'/'b' from a VideoFrame OR
    // an image texture without deriveSlotPlan needing to know which.
    const segments = makeAB();
    const plan = deriveSlotPlan(segments, 5.4, activeCrossDissolve);
    expect(plan.a?.id).toBe('a');
    expect(plan.b?.id).toBe('b');
  });

  it('each of the 4 GL-scoped transition slugs produces the same outgoing/incoming pairing (the shader differs, the slot roles do not)', () => {
    const segments = makeAB();
    for (const type of ['cross-dissolve', 'dip-black', 'dip-white', 'light-leak'] as const) {
      const plan = deriveSlotPlan(segments, 5.4, { type, progress: 0.5 });
      expect(plan.a?.id).toBe('a');
      expect(plan.b?.id).toBe('b');
    }
  });

  it('a suppressed transition (null — e.g. the isResizingRef/D12 drag guard forces transition=null upstream) collapses cleanly to the no-transition assignment: slot a = the containing segment, slot b = null, even while the playhead sits where a transition window would otherwise be', () => {
    const segments = makeAB();
    // Same playhead as the active-transition test, but transition forced null.
    const plan = deriveSlotPlan(segments, 5.4, null);
    expect(plan.a?.id).toBe('b'); // containing segment at t=5.4 is seg-b
    expect(plan.b).toBeNull();
  });

  it('consistency with deriveCompositeParams: feeding it the SAME (segments, currentTime) and passing its resolved transition into deriveSlotPlan yields outgoing/incoming that agree with that transition being active', () => {
    const segments = [
      makeSegment({ id: 'a', startTime: 0, duration: 5, effectTransition: 'dip-black', effectTransitionDuration: 1 }),
      makeSegment({ id: 'b', startTime: 5, duration: 5 }),
    ];
    const params = deriveCompositeParams(segments, 5.3, baseConfig);
    expect(params.transition?.type).toBe('dip-black');
    const plan = deriveSlotPlan(segments, 5.3, params.transition);
    expect(plan.a?.id).toBe('a');
    expect(plan.b?.id).toBe('b');
  });

  it('epsilon boundary: exactly at the incoming segment start (window open) both slots populate; just past the window close a null transition collapses to current-only', () => {
    const segments = makeAB();
    const atOpen = deriveSlotPlan(segments, 5, { type: 'cross-dissolve', progress: 0 });
    expect(atOpen.a?.id).toBe('a');
    expect(atOpen.b?.id).toBe('b');
    // After the window closes deriveCompositeParams returns transition=null;
    // deriveSlotPlan then draws the current segment alone.
    const afterClose = deriveSlotPlan(segments, 6.0001, null);
    expect(afterClose.a?.id).toBe('b');
    expect(afterClose.b).toBeNull();
  });
});
