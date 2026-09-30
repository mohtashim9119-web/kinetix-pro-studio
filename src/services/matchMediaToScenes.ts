/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Media workflow Unit 2 — "Match media to scenes" (Media block header): the
 * reconcile-to-names tool. Re-runs the EXPLICIT-tag tiers `parseProjectData`
 * uses at sync time — `isExactFilenameMatch`, then a UNIQUE
 * `contiguousWordMatch` — against each scene's stored `tag` and the current
 * asset names (renamed names included, Unit 1), with no sync.
 *
 * Registered decisions: a name match OVERWRITES the scene's assignment,
 * manual picks included; a scene with no name match (no tag, no candidate,
 * or an ambiguous word match) keeps what it has, untouched by reference;
 * 2+ exact matches -> the OLDEST asset (`addedAt`, then list order) wins and
 * the ambiguity is reported. Assignment only: `assetId` (and the stale
 * `unmatchedExplicitTag` flag on a newly matched scene) are the only fields
 * written — never timings. Audio assets (the voiceover) are never
 * candidates.
 */

import type { Asset, VideoSegment } from '../types';
import { contiguousWordMatch, isExactFilenameMatch } from './syncEngine';

/** The block-facing digest of one Match run (N matched / M unmatched /
 *  conflicts), surfaced visibly in the Media block rather than only logged. */
export interface MediaMatchSummary {
  matched: number;
  unmatched: number;
  /** Scenes that had NO asset before this run and now have one. */
  filled: number;
  /** Scenes that still show an honest [NO ASSET] placeholder after the run. */
  placeholders: number;
  /** Tags 2+ assets exactly matched (oldest used). */
  conflicts: number;
}

export function summarizeMediaMatch(result: MediaMatchResult): MediaMatchSummary {
  return {
    matched: result.matched,
    unmatched: result.unmatched.length,
    filled: result.filled,
    placeholders: result.placeholders,
    conflicts: result.ambiguous.length,
  };
}

export interface MediaMatchResult {
  segments: VideoSegment[];
  matched: number;
  /** Scenes with no asset before that were bound by this run. */
  filled: number;
  /** Scenes still without an asset after this run (honest placeholders). */
  placeholders: number;
  /** Scene labels (tag, or `S<n>` for an untagged scene) that kept their media. */
  unmatched: string[];
  /** Tags 2+ assets exactly matched, where the oldest was used. */
  ambiguous: { name: string; count: number }[];
}

function oldestFirst(a: { asset: Asset; index: number }, b: { asset: Asset; index: number }): number {
  return (a.asset.addedAt ?? 0) - (b.asset.addedAt ?? 0) || a.index - b.index;
}

export function matchMediaToScenes(assets: readonly Asset[], segments: readonly VideoSegment[]): MediaMatchResult {
  const candidates = assets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => asset.type !== 'audio');
  const unmatched: string[] = [];
  const ambiguous: { name: string; count: number }[] = [];
  let matched = 0;
  let filled = 0;

  const next = segments.map((s, i) => {
    const name = s.tag?.trim();
    if (!name) {
      unmatched.push(`S${i + 1}`);
      return s;
    }

    let pick: Asset | undefined;
    const exact = candidates.filter(({ asset }) => isExactFilenameMatch(name, asset.name)).sort(oldestFirst);
    if (exact.length > 0) {
      pick = exact[0]!.asset;
      if (exact.length > 1 && !ambiguous.some(a => a.name === name)) ambiguous.push({ name, count: exact.length });
    } else {
      const words = candidates.filter(({ asset }) => contiguousWordMatch(name, asset.name));
      if (words.length === 1) pick = words[0]!.asset;
    }

    if (!pick) {
      unmatched.push(name);
      return s;
    }
    matched += 1;
    if (!s.assetId) filled += 1;
    if (s.assetId === pick.id && !s.unmatchedExplicitTag) return s;
    const { unmatchedExplicitTag: _stale, ...rest } = s;
    return { ...rest, assetId: pick.id };
  });

  const placeholders = next.filter(s => !s.assetId).length;
  return { segments: next, matched, filled, placeholders, unmatched, ambiguous };
}
