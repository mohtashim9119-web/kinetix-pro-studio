/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The wand's Layer-2 pass — like Layer 1, it OVERRIDES: every spot with a recorded
 * `clipName` (the name its doc block asked for — never changed by a dropdown pick)
 * is re-bound to the asset that name resolves to, via `pickAssetByName` (oldest-wins,
 * conflicts reported), replacing a clip the user picked by hand. A spot with no
 * clipName is skipped honestly — never guessed (a nameless spot keeps whatever it has).
 * If the new clip is a different media type, a stale duration override is dropped
 * (a 3s image override must not clip a video).
 */

import type { Asset, Spot } from '../../types';
import { pickAssetByName } from '../pickAssetByName';

export interface SpotMatchResult {
  spots: Spot[];
  /** Spots whose recorded name resolved to a vault clip (bound or re-bound). */
  matched: number;
  /** Spots the wand could not bind: a name that resolves to nothing, or no name and no clip. */
  unmatched: number;
  /** Of the unmatched, how many have NO recorded clip name (skipped, never guessed). */
  nameless: number;
  ambiguous: { name: string; count: number }[];
}

export function matchSpotsToMedia(assets: readonly Asset[], spots: readonly Spot[]): SpotMatchResult {
  const candidates = assets.filter(a => a.type === 'video' || a.type === 'image');
  const byId = new Map(assets.map(a => [a.id, a]));
  const ambiguous: { name: string; count: number }[] = [];
  let matched = 0;
  let unmatched = 0;
  let nameless = 0;
  const next = spots.map(sp => {
    const name = sp.clipName?.trim();
    if (!name) {
      if (!sp.assetId) { unmatched += 1; nameless += 1; }
      return sp;
    }
    const { asset, conflict } = pickAssetByName(name, candidates);
    if (conflict && !ambiguous.some(a => a.name === name)) ambiguous.push({ name, count: conflict });
    if (!asset) {
      unmatched += 1;
      return sp;
    }
    matched += 1;
    if (asset.id === sp.assetId) return sp;
    const out: Spot = { ...sp, assetId: asset.id };
    const prev = sp.assetId ? byId.get(sp.assetId) : undefined;
    if (prev && prev.type !== asset.type) delete out.durOverrideSec;
    return out;
  });
  return { spots: next, matched, unmatched, nameless, ambiguous };
}
