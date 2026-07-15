import { describe, it, expect } from 'vitest';
import { applySegmentAnimation, type AnimationFrameInput } from './canvasAnimations';
import { AnimationType } from '../types';
import { DEFAULT_ZOOM_SCALE_RATE, computeZoomScale } from './zoomScale';

/**
 * Export-path zoom coverage (previously ZERO). applySegmentAnimation mutates a
 * canvas transform rather than returning a scale, so a minimal recording ctx
 * captures the single ctx.scale(x, x) call each zoom case makes. The recorded
 * factor must equal computeZoomScale — the exact function the GL preview
 * (compositeParams.ts resolveAnimScale) renders from — so preview and export
 * stay pixel-parallel. These mirror the compositeParams.test.ts zoom cases.
 */

interface Recorder {
  scale: number[];
}

function makeCtx(): { ctx: CanvasRenderingContext2D; rec: Recorder } {
  const rec: Recorder = { scale: [] };
  const ctx = {
    translate: () => {},
    scale: (x: number, _y: number) => { rec.scale.push(x); },
    save: () => {},
    restore: () => {},
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}

function scaleFor(input: Omit<AnimationFrameInput, 'canvasWidth' | 'canvasHeight'>): number {
  const { ctx, rec } = makeCtx();
  applySegmentAnimation(ctx, { ...input, canvasWidth: 1920, canvasHeight: 1080 });
  expect(rec.scale.length).toBe(1); // each zoom case scales exactly once
  return rec.scale[0]!;
}

describe('applySegmentAnimation — ZOOM_IN (export parity)', () => {
  const RATE = 0.05;

  it('is 1.0 at the start', () => {
    const s = scaleFor({ animation: AnimationType.ZOOM_IN, timeInSegment: 0, segmentDuration: 10, scaleRate: RATE });
    expect(s).toBeCloseTo(1.0, 10);
  });

  it('reaches peak (1 + rate*duration) at the end', () => {
    const s = scaleFor({ animation: AnimationType.ZOOM_IN, timeInSegment: 10, segmentDuration: 10, scaleRate: RATE });
    expect(s).toBeCloseTo(1.5, 10);
  });

  it('matches computeZoomScale at the midpoint (the same fn the GL path uses)', () => {
    const s = scaleFor({ animation: AnimationType.ZOOM_IN, timeInSegment: 4, segmentDuration: 8, scaleRate: RATE });
    expect(s).toBeCloseTo(computeZoomScale({ rate: RATE, duration: 8, elapsed: 4, direction: 'in' }), 10);
    expect(s).toBeCloseTo(1.2, 10);
  });

  it('falls back to DEFAULT_ZOOM_SCALE_RATE when scaleRate is omitted', () => {
    const s = scaleFor({ animation: AnimationType.ZOOM_IN, timeInSegment: 10, segmentDuration: 10 });
    expect(s).toBeCloseTo(1.0 + DEFAULT_ZOOM_SCALE_RATE * 10, 10); // 1.10
  });
});

describe('applySegmentAnimation — ZOOM_OUT (export parity)', () => {
  const RATE = 0.05;

  it('starts at peak', () => {
    const s = scaleFor({ animation: AnimationType.ZOOM_OUT, timeInSegment: 0, segmentDuration: 10, scaleRate: RATE });
    expect(s).toBeCloseTo(1.5, 10);
  });

  it('returns to 1.0 at the end', () => {
    const s = scaleFor({ animation: AnimationType.ZOOM_OUT, timeInSegment: 10, segmentDuration: 10, scaleRate: RATE });
    expect(s).toBeCloseTo(1.0, 10);
  });

  it('matches computeZoomScale at the midpoint', () => {
    const s = scaleFor({ animation: AnimationType.ZOOM_OUT, timeInSegment: 2.5, segmentDuration: 5, scaleRate: RATE });
    expect(s).toBeCloseTo(computeZoomScale({ rate: RATE, duration: 5, elapsed: 2.5, direction: 'out' }), 10);
  });
});

describe('applySegmentAnimation — zoom peak cap (export)', () => {
  it('never scales past the capped peak on a long high-rate segment', () => {
    const s = scaleFor({ animation: AnimationType.ZOOM_IN, timeInSegment: 60, segmentDuration: 60, scaleRate: 0.05 });
    expect(s).toBeCloseTo(1.99, 10); // MAX_PEAK_SCALE
  });
});

describe('applySegmentAnimation — non-zoom cases are unaffected by scaleRate', () => {
  it('NONE applies no scale', () => {
    const { ctx, rec } = makeCtx();
    applySegmentAnimation(ctx, { animation: AnimationType.NONE, timeInSegment: 3, segmentDuration: 10, scaleRate: 0.05, canvasWidth: 1920, canvasHeight: 1080 });
    expect(rec.scale.length).toBe(0);
  });

  it('KEN_BURNS keeps its own fixed 0.05/sec rate, ignoring scaleRate', () => {
    // Ken Burns is out of scope for the shared zoom model — a different
    // scaleRate must NOT change its scale.
    const a = scaleFor({ animation: AnimationType.KEN_BURNS, timeInSegment: 4, segmentDuration: 10, scaleRate: 0.05 });
    const b = scaleFor({ animation: AnimationType.KEN_BURNS, timeInSegment: 4, segmentDuration: 10, scaleRate: 0.01 });
    expect(a).toBeCloseTo(b, 10);
    expect(a).toBeCloseTo(1.0 + 0.05 * 4, 10); // 1.20, its own literal
  });
});
