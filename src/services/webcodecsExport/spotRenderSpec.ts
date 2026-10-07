/**
 * Layer 2 spots — export-lane payload and layout.
 *
 * `SpotRenderSpec` is the CC→export seam (structurally identical to
 * `types.ts` after the app-lane merge). Specs arrive already resolved;
 * this module never computes start/dur/corner from a Project.
 *
 * Absence of `spotRenderSpecs`, or an empty array, is the zero-spot path:
 * byte-identical to today's export (no renderer, no extra decode).
 */

import { rectToPx, SPOT_BORDER_HEIGHT_FRAC } from '../spots/spotGeometry';

/** The RESOLVED box in percent of the frame (individual override, else the
 *  project default, else the built-in left half) — resolved app-side by the shared `spotGeometry`
 *  helper; the worker renders this rect directly. */
export interface SpotRenderSpec {
  assetId: string;
  startSec: number;
  durSec: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

/** scene < spots < captions/headings — pin against preview layering. */
export const SPOT_LAYER_ORDER = ['scene', 'spots', 'captions'] as const;

// Defined ONCE in the shared geometry helper (preview + export cannot drift).
export { SPOT_BORDER_HEIGHT_FRAC };
export const SPOT_BORDER_RGBA: readonly [number, number, number, number] = [1, 1, 1, 1];

export function hasSpotRenderWork(specs: readonly SpotRenderSpec[] | null | undefined): boolean {
  return Array.isArray(specs) && specs.length > 0;
}

export function specEndSec(spec: SpotRenderSpec): number {
  return spec.startSec + spec.durSec;
}

export function specActiveAt(spec: SpotRenderSpec, timelineSec: number): boolean {
  return timelineSec >= spec.startSec && timelineSec < specEndSec(spec);
}

export function specsActiveAt(specs: readonly SpotRenderSpec[], timelineSec: number): SpotRenderSpec[] {
  return specs.filter((s) => specActiveAt(s, timelineSec));
}

export interface SpotQuadRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The spec's rect in output pixels (shared helper — identical to the preview's). */
export function spotQuadRect(
  spec: Pick<SpotRenderSpec, 'xPct' | 'yPct' | 'wPct' | 'hPct'>,
  frameW: number,
  frameH: number,
): SpotQuadRect {
  return rectToPx(spec, frameW, frameH);
}

/** The border rect IS the spot's outer edge (the last edge — never drawn outside the
 *  rect, so a box pushed to the frame edge keeps its whole border on screen). */
export function spotBorderRect(quad: SpotQuadRect, _frameH: number): SpotQuadRect {
  return quad;
}

/** The media's rect: the quad inset by the border thickness on every side. */
export function spotContentRect(quad: SpotQuadRect, frameH: number): SpotQuadRect {
  const t = SPOT_BORDER_HEIGHT_FRAC * frameH;
  return { x: quad.x + t, y: quad.y + t, w: Math.max(0, quad.w - 2 * t), h: Math.max(0, quad.h - 2 * t) };
}

export function canonicalSpotRenderSpecs(
  specs: readonly SpotRenderSpec[] | null | undefined,
): ReadonlyArray<{
  assetId: string;
  startSec: number;
  durSec: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}> {
  return [...(specs ?? [])]
    .map((s) => ({
      assetId: s.assetId,
      startSec: s.startSec,
      durSec: s.durSec,
      xPct: s.xPct,
      yPct: s.yPct,
      wPct: s.wPct,
      hPct: s.hPct,
    }))
    .sort((a, b) => a.startSec - b.startSec || a.assetId.localeCompare(b.assetId) || a.xPct - b.xPct || a.yPct - b.yPct);
}

export interface SpotPathRefusal {
  path: 'legacy' | 'canvas' | 'plain';
  message: string;
}

export function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

export function evaluateSpotPathRefusal(
  project: { segments: ReadonlyArray<{ startTime: number; duration: number }> },
  specs: readonly SpotRenderSpec[] | null | undefined,
  args: {
    gateOpen: boolean;
    routing: {
      pieces: ReadonlyArray<{
        tier: 'plain' | 'gl' | 'canvas';
        startIndex: number;
        segmentCount: number;
      }>;
    } | null;
  },
): SpotPathRefusal | null {
  if (!hasSpotRenderWork(specs)) return null;
  const list = specs!;
  if (!args.gateOpen || !args.routing) {
    return {
      path: 'legacy',
      message: `Export refused: ${list.length} spot(s) cannot render on the legacy export path, so they would be silently dropped.`,
    };
  }
  for (const piece of args.routing.pieces) {
    if (piece.tier === 'gl') continue;
    const segs = project.segments.slice(piece.startIndex, piece.startIndex + piece.segmentCount);
    if (segs.length === 0) continue;
    const p0 = segs[0]!.startTime;
    const last = segs[segs.length - 1]!;
    const p1 = last.startTime + last.duration;
    const hit = list.find((s) => rangesOverlap(s.startSec, specEndSec(s), p0, p1));
    if (hit) {
      return {
        path: piece.tier,
        message: `Export refused: spot asset "${hit.assetId}" overlaps the ${piece.tier} export path, which cannot render spots.`,
      };
    }
  }
  return null;
}
