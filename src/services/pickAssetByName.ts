/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The "Match media to scenes" wand's name matcher, extracted so Layer 2 spots
 * bind clips with the exact same semantics: normalized exact match first (2+
 * -> the OLDEST wins, by `addedAt` then list order, and the conflict count is
 * reported); otherwise a UNIQUE `contiguousWordMatch` (2+ is ambiguous and
 * yields nothing — never guess). `candidates` is the caller's pool (audio
 * already excluded); list order is the tiebreak.
 */

import type { Asset } from '../types';
import { contiguousWordMatch, isExactFilenameMatch } from './syncEngine';

export interface AssetPick {
  asset?: Asset;
  /** Number of assets that exactly matched, when 2+ (oldest was used). */
  conflict?: number;
}

export function pickAssetByName(name: string, candidates: readonly Asset[]): AssetPick {
  const exact = candidates
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => isExactFilenameMatch(name, asset.name))
    .sort((a, b) => (a.asset.addedAt ?? 0) - (b.asset.addedAt ?? 0) || a.index - b.index);
  if (exact.length > 0) {
    return exact.length > 1 ? { asset: exact[0]!.asset, conflict: exact.length } : { asset: exact[0]!.asset };
  }
  const words = candidates.filter(asset => contiguousWordMatch(name, asset.name));
  return words.length === 1 ? { asset: words[0]! } : {};
}
