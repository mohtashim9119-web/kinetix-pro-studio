/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Spot, SpotGeometry } from '../../types';
import type { ResolveSpotsResult } from './resolveSpots';

/**
 * Merge a freshly bound doc into the spot list (id-stamped).
 *  - 'replace' (an explicit doc drop): doc spots become exactly the new doc's, but a
 *    spot whose id is unchanged keeps its stamps (duration / geometry / last-known).
 *  - 'rebind' (automatic on reopen): additionally NEVER drops an existing doc spot the
 *    binder could not re-anchor (it stays, flagged at resolve time) — a rebind must
 *    not lose work.
 * A still-valid existing clip choice (e.g. picked in the row dropdown) is kept; an
 * invalid one takes the doc's new binding. Manual spots always survive.
 */
export function mergeDocSpots(
  existing: readonly Spot[],
  bound: readonly Spot[],
  mode: 'replace' | 'rebind' = 'replace',
  validAssetIds?: ReadonlySet<string>,
): Spot[] {
  const oldDoc = existing.filter(s => s.source === 'doc');
  const byId = new Map(oldDoc.map(s => [s.id, s]));
  const merged = bound.map(b => {
    const old = byId.get(b.id);
    if (!old) return b;
    const out: Spot = { ...b };
    if (old.durOverrideSec !== undefined) out.durOverrideSec = old.durOverrideSec;
    if (old.geometry) out.geometry = old.geometry;
    if (old.lastKnownStartSec !== undefined) out.lastKnownStartSec = old.lastKnownStartSec;
    const keepClip = old.assetId && (!validAssetIds || validAssetIds.has(old.assetId));
    if (keepClip) {
      out.assetId = old.assetId;
      if (old.clipName) out.clipName = old.clipName;
    }
    return out;
  });
  const boundIds = new Set(bound.map(b => b.id));
  const kept = mode === 'rebind' ? oldDoc.filter(o => !boundIds.has(o.id)) : [];
  const order = new Map(oldDoc.map((s, i) => [s.id, i]));
  const docPart = [...merged.filter(m => order.has(m.id)), ...kept].sort((x, y) => (order.get(x.id)! - order.get(y.id)!));
  const fresh = merged.filter(m => !order.has(m.id));
  return [...existing.filter(s => s.source !== 'doc'), ...docPart, ...fresh];
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
      source: 'manual',
      boundAt: now,
    },
  ];
}

export interface SpotPatch {
  offsetSec?: number;
  assetId?: string | null;
  /** The name this clip was chosen by (what the wand would re-bind by). */
  clipName?: string;
  /** A number stamps the manual override; null clears it (back to full clip / 3s). */
  durOverrideSec?: number | null;
  /** A stamped manual box; null clears it (back to the corner default). */
  geometry?: SpotGeometry | null;
}

export function patchSpot(spots: readonly Spot[], id: string, patch: SpotPatch): Spot[] {
  return spots.map(s => {
    if (s.id !== id) return s;
    const { durOverrideSec, assetId, geometry, ...rest } = patch;
    const next: Spot = { ...s, ...rest };
    if (durOverrideSec === null) delete next.durOverrideSec;
    else if (durOverrideSec !== undefined) next.durOverrideSec = durOverrideSec;
    if (geometry === null) delete next.geometry;
    else if (geometry !== undefined) next.geometry = geometry;
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

