/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Layer 2 spots R5 — the ONE shared rect-math helper (preview + resolver + export).
import { describe, it, expect } from 'vitest';
import {
  defaultSpotRect, resolveSpotRect, clampRect, moveRect, resizeRect, rectToPx, rectToCss,
  SPOT_MARGIN_HEIGHT_FRAC, SPOT_BORDER_HEIGHT_FRAC, MIN_SPOT_PCT, type PctRect,
} from './spotGeometry';

const F169 = 16 / 9;

describe('defaultSpotRect', () => {
  it('top-right 40% height, 16:9 clip in a 16:9 frame: w=40%, inset 2% of frame HEIGHT from each edge', () => {
    const r = defaultSpotRect('top-right', 40, F169, F169);
    expect(r.hPct).toBeCloseTo(40, 9);
    expect(r.wPct).toBeCloseTo(40, 9);
    expect(r.yPct).toBeCloseTo(2, 9);
    // margin is 2% of frame height = 2/ (16/9) % of width
    expect(r.xPct).toBeCloseTo(100 - 40 - 2 / F169, 9);
  });
  it('portrait clip in a 16:9 frame is narrower; other corners anchor correctly', () => {
    const r = defaultSpotRect('bottom-left', 40, 9 / 16, F169);
    expect(r.wPct).toBeCloseTo(40 * (9 / 16) / F169, 9);
    expect(r.xPct).toBeCloseTo(2 / F169, 9);
    expect(r.yPct).toBeCloseTo(100 - 40 - 2, 9);
  });
});

describe('resolveSpotRect', () => {
  it('geometry override wins over corner/heightPct; absent -> default; always clamped', () => {
    const g: PctRect = { xPct: 10, yPct: 20, wPct: 30, hPct: 25 };
    expect(resolveSpotRect({ corner: 'top-right', heightPct: 40, geometry: g }, F169, F169)).toEqual(g);
    expect(resolveSpotRect({ corner: 'top-right', heightPct: 40 }, F169, F169)).toEqual(defaultSpotRect('top-right', 40, F169, F169));
    const off = resolveSpotRect({ corner: 'top-right', heightPct: 40, geometry: { xPct: 90, yPct: 90, wPct: 30, hPct: 30 } }, F169, F169);
    expect(off.xPct + off.wPct).toBeLessThanOrEqual(100 + 1e-9);
    expect(off.yPct + off.hPct).toBeLessThanOrEqual(100 + 1e-9);
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
    expect(SPOT_MARGIN_HEIGHT_FRAC).toBe(0.02);
    expect(SPOT_BORDER_HEIGHT_FRAC).toBe(0.006);
  });
});
