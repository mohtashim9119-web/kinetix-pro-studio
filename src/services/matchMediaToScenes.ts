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
 * Registered decisions: a name match OVERWRITES the scene's AUTO assignment
 * (Wave 3 B0: a manual, drag-assigned pick is never overwritten); a scene with no name match (no tag, no candidate,
 * or an ambiguous word match) keeps what it has, untouched by reference;
 * 2+ exact matches -> the OLDEST asset (`addedAt`, then list order) wins and
 * the ambiguity is reported. Assignment only: `assetId` (and the stale
 * `unmatchedExplicitTag` flag on a newly matched scene) are the only fields
 * written — never timings. Audio assets (the voiceover) are never
 * candidates.
 */

import type { Asset, VideoSegment } from '../types';
import { pickAssetByName } from './pickAssetByName';

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
  /** Scenes holding a manual (drag-assigned) pick — never overwritten. */
  manualKept: number;
  /** Layer 2 pass (present only when the project has spots). */
  layer2?: { matched: number; unmatched: number; conflicts: number };
}

export function summarizeMediaMatch(result: MediaMatchResult): MediaMatchSummary {
  return {
    matched: result.matched,
    unmatched: result.unmatched.length,
    filled: result.filled,
    placeholders: result.placeholders,
    conflicts: result.ambiguous.length,
    manualKept: result.manualKept,
  };
}

export interface MediaMatchResult {
  segments: VideoSegment[];
  matched: number;
  /** Scenes with no asset before that were bound by this run. */
  filled: number;
  /** Scenes still without an asset after this run (honest placeholders). */
  placeholders: number;
  /** Scenes whose manual pick the run left alone. */
  manualKept: number;
  /** Scene labels (tag, or `S<n>` for an untagged scene) that kept their media. */
  unmatched: string[];
  /** Tags 2+ assets exactly matched, where the oldest was used. */
  ambiguous: { name: string; count: number }[];
}

export function matchMediaToScenes(assets: readonly Asset[], segments: readonly VideoSegment[]): MediaMatchResult {
  const candidates = assets
    .map(asset => ({ asset }))
    .filter(({ asset }) => asset.type !== 'audio');
  const unmatched: string[] = [];
  const ambiguous: { name: string; count: number }[] = [];
  let matched = 0;
  let filled = 0;
  let manualKept = 0;

  const next = segments.map((s, i) => {
    // Wave 3 B0 — a drag-assigned pick is authoritative: never overwritten.
    if (s.assetAssignedBy === 'manual' && s.assetId) {
      manualKept += 1;
      return s;
    }
    const name = s.tag?.trim();
    if (!name) {
      unmatched.push(`S${i + 1}`);
      return s;
    }

    const { asset: pick, conflict } = pickAssetByName(name, candidates.map(c => c.asset));
    if (conflict && !ambiguous.some(a => a.name === name)) ambiguous.push({ name, count: conflict });

    if (!pick) {
      unmatched.push(name);
      return s;
    }
    matched += 1;
    if (!s.assetId) filled += 1;
    if (s.assetId === pick.id && !s.unmatchedExplicitTag) return s;
    const { unmatchedExplicitTag: _stale, assetAssignedBy: _m, ...rest } = s;
    return { ...rest, assetId: pick.id };
  });

  const placeholders = next.filter(s => !s.assetId).length;
  return { segments: next, matched, filled, placeholders, manualKept, unmatched, ambiguous };
}
