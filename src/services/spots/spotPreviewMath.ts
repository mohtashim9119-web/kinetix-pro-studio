/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure math for the Layer-2 preview rectangle. The master <audio> is the only
 * clock: everything here is a function of the stage's `currentTime`.
 *
 * LAYOUT CONTRACT (export parity): the box is `heightPct`% of FRAME height tall,
 * width = native aspect, inset `SPOT_MARGIN_PCT`% of frame height from BOTH of
 * its anchor edges, with a `SPOT_BORDER_PCT`% (of frame height) white border
 * drawn outside the box (as the export quad's border rect).
 */

import type { SpotCorner } from '../../types';

import { SPOT_BORDER_HEIGHT_FRAC, SPOT_MARGIN_HEIGHT_FRAC } from '../webcodecsExport/spotRenderSpec';

/** Derived from the export lane's constants so preview and export cannot drift
 *  (rounded only to defeat float dust). The border is drawn OUTSIDE the box. */
export const SPOT_MARGIN_PCT = +(SPOT_MARGIN_HEIGHT_FRAC * 100).toFixed(4);
export const SPOT_BORDER_PCT = +(SPOT_BORDER_HEIGHT_FRAC * 100).toFixed(4);
/** Stage-internal z scale: media (none) < SPOTS 35 < extra overlays 40 <
 *  text layers 45 < caption 46 < headings 47 < corner stats 50. */
export const SPOT_Z_INDEX = 35;

export interface PreviewSpotItem {
  id: string;
  assetId?: string;
  startSec: number;
  durSec: number;
  corner: SpotCorner;
  heightPct: number;
}

export function activeSpotAt(items: readonly PreviewSpotItem[], t: number): PreviewSpotItem | undefined {
  let found: PreviewSpotItem | undefined;
  for (const it of items) if (t >= it.startSec && t < it.startSec + it.durSec) found = it;
  return found;
}

const PLAY_DRIFT_TOL = 0.25;
const PAUSED_SEEK_TOL = 0.04;

export function computeSpotSync(a: {
  t: number;
  item: PreviewSpotItem;
  /** Native clip length when known; absent for stills. */
  clipDuration?: number;
  elTime: number;
  isPlaying: boolean;
}): { seekTo?: number; shouldPlay: boolean } {
  const local = Math.min(Math.max(a.t - a.item.startSec, 0), a.item.durSec);
  const target = a.clipDuration !== undefined ? Math.min(local, a.clipDuration) : local;
  const pastClip = a.clipDuration !== undefined && local >= a.clipDuration;
  const shouldPlay = a.isPlaying && !pastClip;
  const tol = shouldPlay ? PLAY_DRIFT_TOL : PAUSED_SEEK_TOL;
  return Math.abs(a.elTime - target) > tol ? { seekTo: target, shouldPlay } : { shouldPlay };
}

export function spotBoxStyle(corner: SpotCorner, heightPct: number, aspect: number): Partial<Record<'height' | 'aspectRatio' | 'top' | 'bottom' | 'left' | 'right', string>> {
  const m = `${SPOT_MARGIN_PCT}cqh`;
  const vertical = corner.startsWith('top') ? { top: m } : { bottom: m };
  const horizontal = corner.endsWith('right') ? { right: m } : { left: m };
  return {
    height: `${heightPct}cqh`,
    aspectRatio: String(aspect),
    ...vertical,
    ...horizontal,
  };
}
