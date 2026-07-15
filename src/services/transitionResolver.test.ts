import { describe, it, expect } from 'vitest';
import { resolveEffectiveTransition, resolveTransitionProgress } from './transitionResolver';
import { AnimationType, TransitionType, type VideoSegment } from '../types';

/**
 * Pure-function tests, mock-free — same discipline as compositeParams.test.ts.
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

describe('resolveEffectiveTransition', () => {
  it('the effectTransition slug wins over the legacy transition enum when set and non-NONE-sentinel', () => {
    const segment = makeSegment({
      effectTransition: 'cross-dissolve',
      effectTransitionDuration: 2,
      transition: TransitionType.FADE,
      transitionDuration: 5,
    });
    const result = resolveEffectiveTransition(segment, TransitionType.NONE, 1);
    expect(result).toEqual({ transition: 'cross-dissolve', duration: 2 });
  });

  it('falls back to globalTransitionDuration when effectTransition is set but effectTransitionDuration is not', () => {
    const segment = makeSegment({ effectTransition: 'light-leak' });
    const result = resolveEffectiveTransition(segment, TransitionType.NONE, 3);
    expect(result).toEqual({ transition: 'light-leak', duration: 3 });
  });

  it('falls back to the legacy transition enum when no effectTransition slug is set', () => {
    const segment = makeSegment({ transition: TransitionType.FADE, transitionDuration: 1.5 });
    const result = resolveEffectiveTransition(segment, TransitionType.NONE, 1);
    expect(result).toEqual({ transition: TransitionType.FADE, duration: 1.5 });
  });

  it('falls back to the project-level globalTransition when the segment has neither field set', () => {
    const segment = makeSegment();
    const result = resolveEffectiveTransition(segment, TransitionType.ZOOM, 1);
    expect(result).toEqual({ transition: TransitionType.ZOOM, duration: 1 });
  });

  it('duration is forced to 0 when the effective transition resolves to NONE (legacy branch)', () => {
    const segment = makeSegment({ transition: TransitionType.NONE, transitionDuration: 5 });
    const result = resolveEffectiveTransition(segment, TransitionType.NONE, 1);
    expect(result).toEqual({ transition: TransitionType.NONE, duration: 0 });
  });

  it('an undefined segment falls straight through to the global fallback', () => {
    const result = resolveEffectiveTransition(undefined, TransitionType.FADE, 2);
    expect(result).toEqual({ transition: TransitionType.FADE, duration: 2 });
  });
});

describe('resolveTransitionProgress — centered transition window', () => {
  // Supersedes the old anchored-at-B-start placement (D7 in
  // project-state.md's Ignored Low Risk Bugs, where the entire duration
  // played AFTER the boundary). The window is [boundary - duration/2,
  // boundary + duration/2), progress 0..1 linear across it.

  it('returns null when duration is 0 (division-by-zero guard)', () => {
    expect(resolveTransitionProgress(10, 0, 10)).toBeNull();
  });

  it('returns null when duration is negative', () => {
    expect(resolveTransitionProgress(10, -1, 10)).toBeNull();
  });

  it('progress is exactly 0.5 at the boundary itself, for any duration', () => {
    for (const duration of [0.1, 0.5, 1, 2, 10]) {
      expect(resolveTransitionProgress(10, duration, 10)).toBeCloseTo(0.5, 6);
    }
  });

  it('progress is 0 at the window open (boundary - duration/2)', () => {
    expect(resolveTransitionProgress(10, 2, 9)).toBe(0);
  });

  it('progress approaches 1 just before the window close (boundary + duration/2)', () => {
    expect(resolveTransitionProgress(10, 2, 11 - 1e-9)).toBeCloseTo(1, 6);
  });

  it('null exactly at the window close — half-open on the high end', () => {
    expect(resolveTransitionProgress(10, 2, 11)).toBeNull();
  });

  it('null just before the window open', () => {
    expect(resolveTransitionProgress(10, 2, 9 - 1e-9)).toBeNull();
  });

  it('null well outside the window on either side', () => {
    expect(resolveTransitionProgress(10, 2, 0)).toBeNull();
    expect(resolveTransitionProgress(10, 2, 100)).toBeNull();
  });

  it('is coordinate-system agnostic — works identically for a segment-local boundary (e.g. segmentEncoder.ts using segment.duration) as for absolute project time', () => {
    // boundaryTime here plays the role of a segment's own local `duration`.
    expect(resolveTransitionProgress(5, 1, 4.5)).toBe(0);
    expect(resolveTransitionProgress(5, 1, 5)).toBeCloseTo(0.5, 6);
    expect(resolveTransitionProgress(5, 1, 5.5)).toBeNull();
  });

  it('progress scales linearly with duration — a 4s window at the quarter-point reads 0.25', () => {
    // window = [8, 12); quarter-point = 9.
    expect(resolveTransitionProgress(10, 4, 9)).toBeCloseTo(0.25, 6);
  });
});

/**
 * WebGL2 Phase 5 cutover (docs/webgl-architecture-plan.md Section 6). Five
 * slugs were removed from effectsOptions.ts's TRANSITIONS because the GL
 * effects engine never implemented them — only the deleted CSS/Canvas2D
 * snapshot path ever rendered them. Projects saved before the cutover can
 * still carry one, so this resolver folds them into cross-dissolve.
 *
 * This resolver is the ONE function both preview (compositeParams.ts) and
 * export (segmentEncoder.ts/exportPipeline.ts) resolve through, which is why
 * the fold lives here: it keeps the two in agreement by construction. These
 * tests pin that contract at the resolver; compositeParams.test.ts pins the
 * same fold end-to-end through the derivation.
 */
describe('resolveEffectiveTransition — retired slugs (Phase 5 cutover)', () => {
  const RETIRED = ['wipe', 'slide-push', 'glitch-rgb', 'whip-pan', 'zoom'];

  it.each(RETIRED)('folds the retired slug "%s" into cross-dissolve', (slug) => {
    const segment = makeSegment({ effectTransition: slug, effectTransitionDuration: 0.8 });
    expect(resolveEffectiveTransition(segment, TransitionType.NONE, 0.5).transition).toBe('cross-dissolve');
  });

  it('preserves the retired slug\'s own duration — the transition survives the fold, only its look changes', () => {
    const segment = makeSegment({ effectTransition: 'whip-pan', effectTransitionDuration: 1.25 });
    expect(resolveEffectiveTransition(segment, TransitionType.NONE, 0.5).duration).toBe(1.25);
  });

  it.each(['cross-dissolve', 'dip-black', 'dip-white', 'light-leak'])(
    'passes the surviving slug "%s" through untouched',
    (slug) => {
      const segment = makeSegment({ effectTransition: slug, effectTransitionDuration: 0.8 });
      expect(resolveEffectiveTransition(segment, TransitionType.NONE, 0.5).transition).toBe(slug);
    },
  );

  it('does not fold an unrecognised slug — only the 5 known retirements are remapped', () => {
    const segment = makeSegment({ effectTransition: 'not-a-real-slug', effectTransitionDuration: 0.8 });
    expect(resolveEffectiveTransition(segment, TransitionType.NONE, 0.5).transition).toBe('not-a-real-slug');
  });

  it('does not fold the legacy TransitionType enums that happen to share a retired slug\'s string value (WIPE=\'wipe\', ZOOM=\'zoom\') — the fold is slug-branch only, so export behavior on the legacy enum path is unchanged', () => {
    const wipe = makeSegment({ transition: TransitionType.WIPE, transitionDuration: 0.8 });
    expect(resolveEffectiveTransition(wipe, TransitionType.NONE, 0.5).transition).toBe(TransitionType.WIPE);
    const zoom = makeSegment({ transition: TransitionType.ZOOM, transitionDuration: 0.8 });
    expect(resolveEffectiveTransition(zoom, TransitionType.NONE, 0.5).transition).toBe(TransitionType.ZOOM);
  });
});
