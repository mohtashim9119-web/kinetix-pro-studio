/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots R5 — the ONE shared rect-math helper (preview + resolver + export).
import { describe, it, expect } from 'vitest';
import {
  GLOBAL_SPOT_GEOMETRY, spotGeometryLevel, coverUv, formatSpotGeometry, resolveSpotRect, clampRect, moveRect, resizeRect, rectToPx, rectToCss,
  SPOT_BORDER_HEIGHT_FRAC, MIN_SPOT_PCT, type PctRect,
} from './spotGeometry';

const F169 = 16 / 9;

describe('R7 default cascade: block.geometry ?? project default ?? GLOBAL left half', () => {
  const G: PctRect = { xPct: 10, yPct: 20, wPct: 30, hPct: 25 };
  const P: PctRect = { xPct: 60, yPct: 5, wPct: 35, hPct: 50 };

  it('the built-in global default is the LEFT HALF screen (0,0 · 50% × 100%)', () => {
    expect(GLOBAL_SPOT_GEOMETRY).toEqual({ xPct: 0, yPct: 0, wPct: 50, hPct: 100 });
  });
  it('a new block (no geometry, no project default) resolves to the left half', () => {
    expect(resolveSpotRect({}, undefined)).toEqual(GLOBAL_SPOT_GEOMETRY);
  });
  it('a project default moves every block that has no individual override', () => {
    expect(resolveSpotRect({}, P)).toEqual(P);
    expect(resolveSpotRect({}, { ...P, source: 'project-default' })).toEqual(P); // stamp is not geometry
  });
  it('an individual override WINS over the project default and never gets overwritten by it', () => {
    expect(resolveSpotRect({ geometry: G }, P)).toEqual(G);
  });
  it('clearing the individual override falls back to the project default (then the global)', () => {
    expect(resolveSpotRect({}, P)).toEqual(P);
    expect(resolveSpotRect({}, undefined)).toEqual(GLOBAL_SPOT_GEOMETRY);
  });
  it('level reported for the panel: default / project / custom', () => {
    expect(spotGeometryLevel({}, undefined)).toBe('default');
    expect(spotGeometryLevel({}, P)).toBe('project');
    expect(spotGeometryLevel({ geometry: G }, P)).toBe('custom');
    expect(spotGeometryLevel({ geometry: G }, undefined)).toBe('custom');
  });
  it('always clamped inside the frame', () => {
    const off = resolveSpotRect({ geometry: { xPct: 90, yPct: 90, wPct: 30, hPct: 30 } }, undefined);
    expect(off.xPct + off.wPct).toBeLessThanOrEqual(100 + 1e-9);
    expect(off.yPct + off.hPct).toBeLessThanOrEqual(100 + 1e-9);
  });
});

describe('coverUv — center-crop to fill (preview object-cover == export UV crop)', () => {
  it('same aspect: full texture', () => {
    expect(coverUv(16 / 9, 1920, 1080)).toEqual({ u0: 0, v0: 0, u1: 1, v1: 1 });
  });
  it('wider source than the box: crops left/right equally', () => {
    const c = coverUv(0.5, 1920, 1080); // box is tall; source is wide
    expect(c.v0).toBe(0);
    expect(c.v1).toBe(1);
    expect(c.u0).toBeCloseTo((1 - 0.5 / (16 / 9)) / 2, 9);
    expect(c.u1).toBeCloseTo(1 - c.u0, 9);
  });
  it('taller source than the box: crops top/bottom equally', () => {
    const c = coverUv(2, 900, 1200);
    expect(c.u0).toBe(0);
    expect(c.u1).toBe(1);
    expect(c.v0).toBeCloseTo((1 - (900 / 1200) / 2) / 2, 9);
    expect(c.v1).toBeCloseTo(1 - c.v0, 9);
  });
  it('unknown native size: full texture (no crop)', () => {
    expect(coverUv(1, 0, 0)).toEqual({ u0: 0, v0: 0, u1: 1, v1: 1 });
  });
});

describe('clampRect / moveRect / resizeRect', () => {
  it('clamp keeps the rect inside the frame and above the minimum size', () => {
    expect(clampRect({ xPct: -5, yPct: -5, wPct: 20, hPct: 20 })).toEqual({ xPct: 0, yPct: 0, wPct: 20, hPct: 20 });
    const big = clampRect({ xPct: 0, yPct: 0, wPct: 150, hPct: 150 });
    expect(big.wPct).toBe(100);
    expect(big.hPct).toBe(100);
    expect(clampRect({ xPct: 10, yPct: 10, wPct: 0, hPct: 0 }).wPct).toBe(MIN_SPOT_PCT);
  });
  it('move translates and clamps at the frame edges (snapping off: any value)', () => {
    const r: PctRect = { xPct: 50, yPct: 10, wPct: 20, hPct: 20 };
    expect(moveRect(r, 7.3, 4.1)).toEqual({ xPct: 57.3, yPct: 14.1, wPct: 20, hPct: 20 });
    expect(moveRect(r, 100, -100)).toEqual({ xPct: 80, yPct: 0, wPct: 20, hPct: 20 });
  });
  it('edge resize is free; the opposite edge stays put', () => {
    const r: PctRect = { xPct: 40, yPct: 10, wPct: 20, hPct: 20 };
    expect(resizeRect(r, 'e', 10, 0, F169)).toEqual({ xPct: 40, yPct: 10, wPct: 30, hPct: 20 });
    expect(resizeRect(r, 'w', -10, 0, F169)).toEqual({ xPct: 30, yPct: 10, wPct: 30, hPct: 20 });
    expect(resizeRect(r, 's', 0, 5, F169)).toEqual({ xPct: 40, yPct: 10, wPct: 20, hPct: 25 });
  });
  it('corner resize keeps the on-screen aspect and anchors the opposite corner', () => {
    const r: PctRect = { xPct: 40, yPct: 10, wPct: 20, hPct: 20 };
    const out = resizeRect(r, 'se', 10, 0, F169);
    expect(out.xPct).toBe(40);
    expect(out.yPct).toBe(10);
    // on-screen aspect (px) preserved
    expect((out.wPct * F169) / out.hPct).toBeCloseTo((r.wPct * F169) / r.hPct, 9);
    expect(out.wPct).toBeCloseTo(30, 9);
  });
  it('resize never collapses below the minimum or leaves the frame', () => {
    const r: PctRect = { xPct: 40, yPct: 10, wPct: 20, hPct: 20 };
    expect(resizeRect(r, 'e', -500, 0, F169).wPct).toBe(MIN_SPOT_PCT);
    const out = resizeRect(r, 'e', 500, 0, F169);
    expect(out.xPct + out.wPct).toBeLessThanOrEqual(100 + 1e-9);
  });
});

describe('one rect, two surfaces', () => {
  const r: PctRect = { xPct: 72, yPct: 8, wPct: 24, hPct: 40 };
  it('rectToPx (export) and rectToCss (preview) describe the identical rect', () => {
    const px = rectToPx(r, 1920, 1080);
    expect(px).toEqual({ x: 0.72 * 1920, y: 0.08 * 1080, w: 0.24 * 1920, h: 0.4 * 1080 });
    expect(rectToCss(r)).toEqual({ left: '72%', top: '8%', width: '24%', height: '40%' });
  });
  it('shared constants are defined once', () => {
    expect(SPOT_BORDER_HEIGHT_FRAC).toBe(0.006);
  });
});

describe('formatSpotGeometry (panel geometry row)', () => {
  it('reads "x 72% · y 8% · 24% × 40%"', () => {
    expect(formatSpotGeometry({ xPct: 72, yPct: 8, wPct: 24, hPct: 40 })).toBe('x 72% · y 8% · 24% × 40%');
  });
  it('rounds to whole percents (live-updating without jitter)', () => {
    expect(formatSpotGeometry({ xPct: 71.6, yPct: 7.5, wPct: 23.51, hPct: 39.49 })).toBe('x 72% · y 8% · 24% × 39%');
  });
  it('the left-half default reads naturally', () => {
    expect(formatSpotGeometry(GLOBAL_SPOT_GEOMETRY)).toBe('x 0% · y 0% · 50% × 100%');
  });
});
