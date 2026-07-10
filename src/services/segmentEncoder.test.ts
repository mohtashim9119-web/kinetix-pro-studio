import { describe, it, expect } from 'vitest';
import { resolveBlendFrameParams } from './segmentEncoder';

/**
 * Pure-function tests for the export-side centered blend-window math —
 * mirrors compositeParams.test.ts's discipline (mock-free, no DOM/ffmpeg
 * harness needed since resolveBlendFrameParams takes/returns plain numbers).
 *
 * Supersedes the old anchored-at-B-start placement (D7 in project-state.md's
 * Ignored Low Risk Bugs, where the whole blend played entirely inside the
 * segment's trailingExtension, after its own nominal end). The blend zone is
 * now centered on `segmentDuration` (the outgoing segment's own nominal
 * end): half sits BEFORE it (still the segment's own un-extended span), half
 * AFTER (the trailingExtension) — see docs/webgl-architecture-plan.md's
 * transition-centering entry.
 */

describe('resolveBlendFrameParams', () => {
  // segmentDuration=5, transitionDuration=2 → zone [4, 6).
  const segmentDuration = 5;
  const transitionDuration = 2;

  it('returns null before the zone opens (segmentDuration - transitionDuration/2)', () => {
    expect(resolveBlendFrameParams(3, segmentDuration, transitionDuration)).toBeNull();
    expect(resolveBlendFrameParams(4 - 1e-9, segmentDuration, transitionDuration)).toBeNull();
  });

  it('returns null at and after the zone closes (segmentDuration + transitionDuration/2) — half-open', () => {
    expect(resolveBlendFrameParams(6, segmentDuration, transitionDuration)).toBeNull();
    expect(resolveBlendFrameParams(7, segmentDuration, transitionDuration)).toBeNull();
  });

  it('alpha is 0 at the zone open, and the incoming clip is held at its own t=0', () => {
    const result = resolveBlendFrameParams(4, segmentDuration, transitionDuration);
    expect(result).not.toBeNull();
    expect(result!.alpha).toBe(0);
    expect(result!.nextTimeInSegment).toBe(0);
  });

  it('alpha is exactly 0.5 at the nominal A/B boundary (timeInSegment === segmentDuration) — the 50/50 centering guarantee', () => {
    const result = resolveBlendFrameParams(segmentDuration, segmentDuration, transitionDuration);
    expect(result).not.toBeNull();
    expect(result!.alpha).toBeCloseTo(0.5, 6);
    // Exactly at the boundary the incoming clip's own true elapsed time is 0.
    expect(result!.nextTimeInSegment).toBeCloseTo(0, 6);
  });

  it('the incoming clip stays held at t=0 for the ENTIRE pre-boundary half, not just at the edges — never asked to seek before its own official start', () => {
    for (const timeInSegment of [4, 4.25, 4.5, 4.75, segmentDuration - 1e-6]) {
      const result = resolveBlendFrameParams(timeInSegment, segmentDuration, transitionDuration);
      expect(result).not.toBeNull();
      expect(result!.nextTimeInSegment).toBe(0);
    }
  });

  it('the incoming clip advances forward from its own t=0 through the post-boundary half', () => {
    // 5.5 is halfway between the boundary (5) and zone close (6): progress 0.75.
    const result = resolveBlendFrameParams(5.5, segmentDuration, transitionDuration);
    expect(result).not.toBeNull();
    expect(result!.alpha).toBeCloseTo(0.75, 6);
    expect(result!.nextTimeInSegment).toBeCloseTo(0.5, 6);
  });

  it('alpha approaches 1 just before the zone closes, with nextTimeInSegment approaching transitionDuration/2', () => {
    const result = resolveBlendFrameParams(6 - 1e-9, segmentDuration, transitionDuration);
    expect(result).not.toBeNull();
    expect(result!.alpha).toBeCloseTo(1, 6);
    expect(result!.nextTimeInSegment).toBeCloseTo(1, 5); // transitionDuration/2 = 1
  });

  it('a zero-duration transition never activates (division-by-zero guard, delegated to resolveTransitionProgress)', () => {
    expect(resolveBlendFrameParams(segmentDuration, segmentDuration, 0)).toBeNull();
  });

  it('total blend footprint is exactly transitionDuration seconds wide, straddling segmentDuration symmetrically', () => {
    const half = transitionDuration / 2;
    expect(resolveBlendFrameParams(segmentDuration - half - 1e-9, segmentDuration, transitionDuration)).toBeNull();
    expect(resolveBlendFrameParams(segmentDuration - half, segmentDuration, transitionDuration)).not.toBeNull();
    expect(resolveBlendFrameParams(segmentDuration + half - 1e-9, segmentDuration, transitionDuration)).not.toBeNull();
    expect(resolveBlendFrameParams(segmentDuration + half, segmentDuration, transitionDuration)).toBeNull();
  });
});
