/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Spot, SpotCorner } from '../../types';
import type { ResolveSpotsResult } from './resolveSpots';

export function mergeDocSpots(existing: readonly Spot[], bound: readonly Spot[]): Spot[] {
  return [...existing.filter(s => s.source !== 'doc'), ...bound];
}

export function addManualSpot(
  spots: readonly Spot[],
  anchorSegmentId: string,
  assetId: string | undefined,
  now: number,
  newId: () => string = () => crypto.randomUUID(),
): Spot[] {
  return [
    ...spots,
    {
      id: newId(),
      ...(assetId ? { assetId } : {}),
      anchorSegmentId,
      offsetSec: 0,
      corner: 'top-right',
      heightPct: 40,
      source: 'manual',
      boundAt: now,
    },
  ];
}

export interface SpotPatch {
  corner?: SpotCorner;
  heightPct?: number;
  offsetSec?: number;
  assetId?: string | null;
  /** A number stamps the manual override; null clears it (back to full clip / 3s). */
  durOverrideSec?: number | null;
}

export function patchSpot(spots: readonly Spot[], id: string, patch: SpotPatch): Spot[] {
  return spots.map(s => {
    if (s.id !== id) return s;
    const { durOverrideSec, assetId, ...rest } = patch;
    const next: Spot = { ...s, ...rest };
    if (durOverrideSec === null) delete next.durOverrideSec;
    else if (durOverrideSec !== undefined) next.durOverrideSec = durOverrideSec;
    if (assetId === null) delete next.assetId;
    else if (assetId !== undefined) next.assetId = assetId;
    return next;
  });
}

export function deleteSpot(spots: readonly Spot[], id: string): Spot[] {
  return spots.filter(s => s.id !== id);
}

/** Persists the resolver's last-known absolute starts + needs-review flags onto
 *  the spots. Returns the SAME array when nothing changed (effect-loop safe).
 *  `hasTimeline` false = no segments yet: nothing is orphaned, nothing stamped. */
export function stampResolution(spots: Spot[], result: ResolveSpotsResult, hasTimeline: boolean): Spot[] {
  if (!hasTimeline) return spots;
  const review = new Set(result.needsReview);
  let changed = false;
  const next = spots.map(s => {
    const known = result.lastKnown[s.id];
    const wantReview = review.has(s.id);
    const knownSame = known === undefined || s.lastKnownStartSec === known;
    if (knownSame && Boolean(s.needsReview) === wantReview) return s;
    changed = true;
    const out: Spot = { ...s };
    if (known !== undefined) out.lastKnownStartSec = known;
    if (wantReview) out.needsReview = true;
    else delete out.needsReview;
    return out;
  });
  return changed ? next : spots;
}

/** Sprinkle: every segment with NO spot anchored to it gets one carrying the
 *  default Layer-2 asset. No duration is stamped — a video plays its full clip,
 *  an image 3s, resolved at resolve time — so each is fully editable/deletable.
 *  Returns the SAME array when nothing is added (idempotent). */
export function sprinkleSpots(
  spots: Spot[],
  segments: readonly { id: string }[],
  assets: readonly { id: string; type: string }[],
  defaultAssetId: string | undefined,
  now: number,
  newId: () => string = () => crypto.randomUUID(),
): Spot[] {
  const usable = defaultAssetId && assets.some(a => a.id === defaultAssetId && (a.type === 'video' || a.type === 'image'));
  if (!usable) return spots;
  const anchored = new Set(spots.map(s => s.anchorSegmentId));
  const added: Spot[] = segments
    .filter(seg => !anchored.has(seg.id))
    .map(seg => ({
      id: newId(),
      assetId: defaultAssetId,
      anchorSegmentId: seg.id,
      offsetSec: 0,
      corner: 'top-right' as const,
      heightPct: 40,
      source: 'sprinkle' as const,
      boundAt: now,
    }));
  return added.length > 0 ? [...spots, ...added] : spots;
}
