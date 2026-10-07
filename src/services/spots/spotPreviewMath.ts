/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure math for the Layer-2 preview rectangle. The master <audio> is the only
 * clock: everything here is a function of the stage's `currentTime`.
 *
 * LAYOUT CONTRACT (export parity): the box is the resolved percent rect from
 * `spotGeometry` (the same rect the export bakes), with a `SPOT_BORDER_PCT`% (of
 * frame height) white border drawn outside the box.
 */


import { SPOT_BORDER_HEIGHT_FRAC, type PctRect } from './spotGeometry';

/** Derived from the shared geometry constants (defined once) so preview and
 *  export cannot drift. The border is drawn OUTSIDE the box. */
export const SPOT_BORDER_PCT = +(SPOT_BORDER_HEIGHT_FRAC * 100).toFixed(4);
/** Stage-internal z scale: media (none) < SPOTS 35 < extra overlays 40 <
 *  text layers 45 < caption 46 < headings 47 < corner stats 50. */
export const SPOT_Z_INDEX = 35;

export interface PreviewSpotItem {
  id: string;
  assetId?: string;
  startSec: number;
  durSec: number;
  /** The RESOLVED box (% of frame) from `resolveSpots` — the same rect export bakes. */
  rect: PctRect;
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
