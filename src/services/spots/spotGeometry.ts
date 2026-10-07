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

export interface PctRect {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

/** Built-in default for every new block: the LEFT HALF of the screen, full height. */
export const GLOBAL_SPOT_GEOMETRY: PctRect = { xPct: 0, yPct: 0, wPct: 50, hPct: 100 };

/** Border thickness (drawn OUTSIDE the rect), as a fraction of frame height. */
export const SPOT_BORDER_HEIGHT_FRAC = 0.006;
/** Smallest a spot box may be, per axis, in percent of the frame. */
export const MIN_SPOT_PCT = 5;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
/** Defeats float dust so equal inputs hash/compare equal everywhere. */

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

/**
 * The three-level default cascade, most-specific-wins, all percentages:
 *   block.geometry (individual override) ?? project default ?? GLOBAL left half.
 * Defaults only flow DOWNWARD: a project default never overwrites an override.
 * The stamp on a project default (`source`) is metadata, not geometry.
 */
export function resolveSpotRect(spot: { geometry?: PctRect }, projectDefault?: PctRect & { source?: string }): PctRect {
  const g = spot.geometry ?? projectDefault ?? GLOBAL_SPOT_GEOMETRY;
  return clampRect({ xPct: g.xPct, yPct: g.yPct, wPct: g.wPct, hPct: g.hPct });
}

export type SpotGeometryLevel = 'default' | 'project' | 'custom';
export function spotGeometryLevel(spot: { geometry?: PctRect }, projectDefault?: PctRect): SpotGeometryLevel {
  return spot.geometry ? 'custom' : projectDefault ? 'project' : 'default';
}

/**
 * Center-crop ("cover") UV window so a clip fills a box without distortion.
 * `boxAspectPx` = box width / box height in OUTPUT pixels. Preview uses CSS
 * object-cover and export samples this window — the same crop on both surfaces.
 */
export function coverUv(boxAspectPx: number, nativeW: number, nativeH: number): { u0: number; v0: number; u1: number; v1: number } {
  if (!(nativeW > 0) || !(nativeH > 0) || !(boxAspectPx > 0)) return { u0: 0, v0: 0, u1: 1, v1: 1 };
  const src = nativeW / nativeH;
  if (src > boxAspectPx) {
    const vis = boxAspectPx / src;
    return { u0: (1 - vis) / 2, v0: 0, u1: 1 - (1 - vis) / 2, v1: 1 };
  }
  if (src < boxAspectPx) {
    const vis = src / boxAspectPx;
    return { u0: 0, v0: (1 - vis) / 2, u1: 1, v1: 1 - (1 - vis) / 2 };
  }
  return { u0: 0, v0: 0, u1: 1, v1: 1 };
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

/** "x 72% · y 8% · 24% × 40%" — the panel's geometry row. Whole percents. */
export function formatSpotGeometry(r: PctRect): string {
  const n = (v: number) => Math.round(v);
  return `x ${n(r.xPct)}% · y ${n(r.yPct)}% · ${n(r.wPct)}% × ${n(r.hPct)}%`;
}
