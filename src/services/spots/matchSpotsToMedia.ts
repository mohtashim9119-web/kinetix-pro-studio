/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The wand's Layer-2 pass. Binds each UNBOUND spot that recorded a `clipName` via
 * `pickAssetByName` (oldest-wins, conflicts reported). A spot with no clipName
 * is skipped honestly — never guessed. Already-bound spots are untouched.
 */

import type { Asset, Spot } from '../../types';
import { pickAssetByName } from '../pickAssetByName';

export interface SpotMatchResult {
  spots: Spot[];
  matched: number;
  /** Spots still unbound after this pass (unmatched name OR nameless). */
  unmatched: number;
  /** Of the unmatched, how many have NO recorded clip name (skipped, never guessed). */
  nameless: number;
  ambiguous: { name: string; count: number }[];
}

export function matchSpotsToMedia(assets: readonly Asset[], spots: readonly Spot[]): SpotMatchResult {
  const candidates = assets.filter(a => a.type === 'video' || a.type === 'image');
  const ambiguous: { name: string; count: number }[] = [];
  let matched = 0;
  let unmatched = 0;
  let nameless = 0;
  const next = spots.map(sp => {
    if (sp.assetId) return sp;
    const name = sp.clipName?.trim();
    if (!name) {
      unmatched += 1;
      nameless += 1;
      return sp;
    }
    const { asset, conflict } = pickAssetByName(name, candidates);
    if (conflict && !ambiguous.some(a => a.name === name)) ambiguous.push({ name, count: conflict });
    if (!asset) {
      unmatched += 1;
      return sp;
    }
    matched += 1;
    return { ...sp, assetId: asset.id };
  });
  return { spots: next, matched, unmatched, nameless, ambiguous };
}
