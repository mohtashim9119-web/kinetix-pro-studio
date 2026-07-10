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
