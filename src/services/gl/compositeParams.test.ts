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
