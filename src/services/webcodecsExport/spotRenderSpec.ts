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

export type SpotCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export interface SpotRenderSpec {
  assetId: string;
  startSec: number;
  durSec: number;
  corner: SpotCorner;
  heightPct: number;
}

/** scene < spots < captions/headings — pin against preview layering. */
export const SPOT_LAYER_ORDER = ['scene', 'spots', 'captions'] as const;

/** Inset from the chosen corner, as a fraction of frame height (size-independent). */
export const SPOT_MARGIN_HEIGHT_FRAC = 0.02;
/** Border thickness as a fraction of frame height. */
export const SPOT_BORDER_HEIGHT_FRAC = 0.006;
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

/**
 * Percentage-based PiP quad: height = heightPct of frame height; width follows
 * the clip's native aspect. Margin/border scale with frame height so 720p and
 * 1080p land on the same relative corner.
 */
export function spotQuadRect(
  spec: Pick<SpotRenderSpec, 'corner' | 'heightPct'>,
  frameW: number,
  frameH: number,
  nativeW: number,
  nativeH: number,
): SpotQuadRect {
  const h = (spec.heightPct / 100) * frameH;
  const aspect = nativeH === 0 ? 1 : nativeW / nativeH;
  const w = h * aspect;
  const margin = SPOT_MARGIN_HEIGHT_FRAC * frameH;
  switch (spec.corner) {
    case 'top-left':
      return { x: margin, y: margin, w, h };
    case 'top-right':
      return { x: frameW - w - margin, y: margin, w, h };
    case 'bottom-left':
      return { x: margin, y: frameH - h - margin, w, h };
    case 'bottom-right':
      return { x: frameW - w - margin, y: frameH - h - margin, w, h };
  }
}

export function spotBorderRect(quad: SpotQuadRect, frameH: number): SpotQuadRect {
  const t = SPOT_BORDER_HEIGHT_FRAC * frameH;
  return { x: quad.x - t, y: quad.y - t, w: quad.w + 2 * t, h: quad.h + 2 * t };
}

export function canonicalSpotRenderSpecs(
  specs: readonly SpotRenderSpec[] | null | undefined,
): ReadonlyArray<{
  assetId: string;
  startSec: number;
  durSec: number;
  corner: SpotCorner;
  heightPct: number;
}> {
  return [...(specs ?? [])]
    .map((s) => ({
      assetId: s.assetId,
      startSec: s.startSec,
      durSec: s.durSec,
      corner: s.corner,
      heightPct: s.heightPct,
    }))
    .sort((a, b) => a.startSec - b.startSec || a.assetId.localeCompare(b.assetId) || a.corner.localeCompare(b.corner));
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
