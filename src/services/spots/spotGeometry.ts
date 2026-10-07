/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE one rect-math helper for Layer 2 — imported by the resolver, the preview
 * and the export lane, so preview and export quads are the identical rect by
 * construction (the border-drift lesson: constants live HERE, once).
 *
 * Geometry is in percent of the FRAME: x/y = top-left, w/h = size, all as % of
 * frame width (x, w) or frame height (y, h). Pure; no DOM, no GL.
 */

import type { SpotCorner } from '../../types';

export interface PctRect {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

/** Default inset from the chosen corner, as a fraction of frame HEIGHT. */
export const SPOT_MARGIN_HEIGHT_FRAC = 0.02;
/** Border thickness (drawn OUTSIDE the rect), as a fraction of frame height. */
export const SPOT_BORDER_HEIGHT_FRAC = 0.006;
/** Smallest a spot box may be, per axis, in percent of the frame. */
export const MIN_SPOT_PCT = 5;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
/** Defeats float dust so equal inputs hash/compare equal everywhere. */
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Keep a rect inside the frame and above the minimum size. */
export function clampRect(r: PctRect): PctRect {
  const wPct = clamp(r.wPct, MIN_SPOT_PCT, 100);
  const hPct = clamp(r.hPct, MIN_SPOT_PCT, 100);
  return {
    xPct: clamp(r.xPct, 0, 100 - wPct),
    yPct: clamp(r.yPct, 0, 100 - hPct),
    wPct,
    hPct,
  };
}

/** The corner/height default: height = heightPct of the frame, width follows
 *  the clip's native aspect; inset 2% of frame height from both anchor edges. */
export function defaultSpotRect(corner: SpotCorner, heightPct: number, clipAspect: number, frameAspect: number): PctRect {
  const hPct = heightPct;
  const wPct = (heightPct * clipAspect) / frameAspect;
  const marginY = SPOT_MARGIN_HEIGHT_FRAC * 100;
  const marginX = marginY / frameAspect;
  const c = clampRect({
    xPct: corner.endsWith('right') ? 100 - wPct - marginX : marginX,
    yPct: corner.startsWith('top') ? marginY : 100 - hPct - marginY,
    wPct,
    hPct,
  });
  return { xPct: r6(c.xPct), yPct: r6(c.yPct), wPct: r6(c.wPct), hPct: r6(c.hPct) };
}

/** The stamped manual geometry when present, else the corner default. Clamped. */
export function resolveSpotRect(
  spot: { corner: SpotCorner; heightPct: number; geometry?: PctRect },
  clipAspect: number,
  frameAspect: number,
): PctRect {
  return spot.geometry ? clampRect(spot.geometry) : defaultSpotRect(spot.corner, spot.heightPct, clipAspect, frameAspect);
}

export function moveRect(r: PctRect, dxPct: number, dyPct: number): PctRect {
  return {
    ...r,
    xPct: clamp(r.xPct + dxPct, 0, 100 - r.wPct),
    yPct: clamp(r.yPct + dyPct, 0, 100 - r.hPct),
  };
}

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Resize by dragging `handle` by (dxPct, dyPct) in frame percent. Edges are free
 * (the opposite edge stays put). Corners keep the on-screen aspect ratio and
 * anchor the opposite corner. Always inside the frame, never below the minimum.
 * `frameAspect` = frame width / frame height (needed to hold aspect in pixels).
 */
export function resizeRect(r: PctRect, handle: ResizeHandle, dxPct: number, dyPct: number, frameAspect: number): PctRect {
  const left = r.xPct;
  const right = r.xPct + r.wPct;
  const top = r.yPct;
  const bottom = r.yPct + r.hPct;

  if (handle.length === 2) {
    const sx = handle.includes('e') ? 1 : -1;
    const sy = handle.includes('s') ? 1 : -1;
    // On-screen aspect (px): a = w*F/h, so h = w*F/a.
    const a = (r.wPct * frameAspect) / r.hPct;
    const scaleX = (r.wPct + sx * dxPct) / r.wPct;
    const scaleY = (r.hPct + sy * dyPct) / r.hPct;
    let scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    // Room available toward the dragged corner, and the minimum.
    const roomW = sx > 0 ? 100 - left : right;
    const roomH = sy > 0 ? 100 - top : bottom;
    const maxScale = Math.min(roomW / r.wPct, roomH / r.hPct);
    const minScale = Math.max(MIN_SPOT_PCT / r.wPct, MIN_SPOT_PCT / r.hPct);
    scale = clamp(scale, Math.min(minScale, maxScale), maxScale);
    const wPct = r.wPct * scale;
    const hPct = (wPct * frameAspect) / a;
    return {
      xPct: sx > 0 ? left : right - wPct,
      yPct: sy > 0 ? top : bottom - hPct,
      wPct,
      hPct,
    };
  }

  let l = left;
  let rt = right;
  let t = top;
  let b = bottom;
  if (handle === 'e') rt = clamp(right + dxPct, left + MIN_SPOT_PCT, 100);
  if (handle === 'w') l = clamp(left + dxPct, 0, right - MIN_SPOT_PCT);
  if (handle === 's') b = clamp(bottom + dyPct, top + MIN_SPOT_PCT, 100);
  if (handle === 'n') t = clamp(top + dyPct, 0, bottom - MIN_SPOT_PCT);
  return { xPct: l, yPct: t, wPct: rt - l, hPct: b - t };
}

/** Export surface: the rect in output pixels. */
export function rectToPx(r: PctRect, frameW: number, frameH: number): { x: number; y: number; w: number; h: number } {
  return { x: (r.xPct / 100) * frameW, y: (r.yPct / 100) * frameH, w: (r.wPct / 100) * frameW, h: (r.hPct / 100) * frameH };
}

/** Preview surface: the same rect as CSS percentages of the stage box. */
export function rectToCss(r: PctRect): { left: string; top: string; width: string; height: string } {
  return { left: `${r.xPct}%`, top: `${r.yPct}%`, width: `${r.wPct}%`, height: `${r.hPct}%` };
}
