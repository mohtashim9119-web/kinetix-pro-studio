/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Asset, VideoSegment } from '../types';
import { HEADING_DEFAULT_DURATION } from './whisperService';

export const isFuzzyMatch = (search: string, target: string): boolean => {
  if (!search || !target) return false;
  const s = search.toLowerCase().trim().replace(/\[(IMAGE|VIDEO|HEADING):?\s*|\]/gi, '').replace(/\.(jpg|jpeg|png|mp4|mov|wav|mp3|zip)$/i, '');
  const t = target.toLowerCase().trim().replace(/\.(jpg|jpeg|png|mp4|mov|wav|mp3|zip)$/i, '');

  if (t === s) return true;
  if (t.includes(s) || s.includes(t)) return true;

  const sWords = s.split(/[\s_\-]+/).filter(w => w.length > 2);
  const tWords = t.split(/[\s_\-]+/).filter(w => w.length > 2);

  let matches = 0;
  for (const word of sWords) {
    if (tWords.some(tw => tw.includes(word) || word.includes(tw))) {
      matches++;
    }
  }
  return matches >= 2;
};

export const findAssetByContext = (text: string, assets: Asset[]): Asset | null => {
  const words = text.toLowerCase().split(/[\s,.;:!?]+/).filter(w => w.length > 3);
  for (const asset of assets) {
    const assetName = asset.name.toLowerCase();
    if (words.some(word => assetName.includes(word))) return asset;
  }
  return null;
};

/**
 * Re-derives startTime and duration for each segment from its anchorStart,
 * preserving surviving scene positions across re-sync after scene add/remove.
 *
 * Preconditions:
 *  - segments are in display order
 *  - audioDuration > 0
 *  - each segment has either an anchorStart (surviving from prev sync) or
 *    undefined anchorStart (brand-new scene from this sync)
 *
 * Postconditions:
 *  - every segment has anchorStart, startTime, duration set
 *  - startTimes are monotonically non-decreasing and contiguous
 *  - first segment startTime = 0
 *  - last segment duration = audioDuration - last.startTime
 *  - locked segments: duration is preserved UNLESS removal opened a gap
 *    immediately after the segment, in which case duration grows to absorb it.
 *    Locked segments never shrink and never move.
 */
export function applyAnchorBasedTiming(
  segments: VideoSegment[],
  audioDuration: number,
): VideoSegment[] {
  if (segments.length === 0) return segments;
  if (audioDuration <= 0) return segments;

  const out: VideoSegment[] = segments.map(s => ({ ...s }));

  // PASS 1 — normalize first-segment anchor to 0.
  // If the new first segment was previously not first (its anchor > 0), or is brand-new
  // (anchor undefined), shift it to 0 so there is never a silent gap at the front.
  const first = out[0];
  if (first && ((first.anchorStart ?? 0) > 0 || first.anchorStart === undefined)) {
    if (first.anchorStart === undefined) first.anchorSource = 'estimate';
    first.anchorStart = 0;
  }

  // PASS 3 — recompute startTime and duration from anchors.
  // Locked-segment exemption: locked segments snap their startTime to their anchor
  // and their duration grows to max(preserved, availableSpan) — absorbing removal gaps
  // that opened up after them. They never shrink.
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    if ((cur.anchorStart ?? 0) < (prev.anchorStart ?? 0)) {
      console.warn('[anchor] out-of-order anchor at i=%d: prev=%s cur=%s id=%s',
        i, prev.anchorStart, cur.anchorStart, cur.id);
    }
  }
  for (let i = 0; i < out.length; i++) {
    const seg = out[i];
    if (!seg) continue;
    const isLast = i === out.length - 1;
    const nextAnchor = isLast ? audioDuration : (out[i + 1]?.anchorStart ?? out[i + 1]?.startTime ?? audioDuration);
    const anchorStart = seg.anchorStart ?? seg.startTime ?? 0;

    if (seg.locked) {
      seg.startTime = Number(anchorStart.toFixed(3));
      const preservedDuration = seg.duration ?? 0;
      const availableSpan = Math.max(0, nextAnchor - seg.startTime);
      seg.duration = Number(Math.max(preservedDuration, availableSpan).toFixed(3));
    } else {
      seg.startTime = Number(anchorStart.toFixed(3));
      seg.duration = Number(Math.max(0.1, nextAnchor - seg.startTime).toFixed(3));
    }
  }

  // PASS 4 — clamp last segment exactly to audioDuration.
  const last = out[out.length - 1];
  if (last) {
    last.duration = Number(Math.max(0.1, audioDuration - last.startTime).toFixed(3));
  }

  return out;
}

/**
 * Stable identity string for a File, used to detect re-staging the same
 * underlying file across separate selections. A fresh `File` object (and a
 * fresh Asset id) is minted on every stage event even when the user picks
 * the exact same file again, so reference/id equality can't catch this —
 * name+size+lastModified can.
 */
export function getFileIdentity(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export const autoMatchSegments = (assets: Asset[], segments: VideoSegment[]): VideoSegment[] =>
  segments.map(s => {
    if (s.assetId) return s;

    const headingLabel = s.headingConfig?.text ?? s.heading ?? '';
    const bracketMatch = (headingLabel + s.text).match(/\[(.*?):?\s*(.*?)\]/);
    if (bracketMatch) {
      const name = (bracketMatch[2] ?? '').trim();
      const asset = assets.find(a => isFuzzyMatch(name, a.name));
      if (asset) return { ...s, assetId: asset.id };
    }

    const contextAsset = findAssetByContext(headingLabel + ' ' + s.text, assets);
    if (contextAsset) return { ...s, assetId: contextAsset.id };

    return s;
  });

/**
 * Captures where a heading sat relative to its surrounding content, so it
 * can be relocated onto a different (freshly re-synced) content array.
 */
export interface HeadingAnchor {
  heading: VideoSegment;
  afterAssetId?: string;
  beforeAssetId?: string;
  ordinal: number;
}

/**
 * For each heading in `previousSegments`, records its full styling/config
 * plus enough positional context — nearest non-heading neighbor on each
 * side, and ordinal position among non-heading segments — to relocate it
 * onto a different content array via reinsertHeadings.
 */
export function computeHeadingAnchors(previousSegments: VideoSegment[]): HeadingAnchor[] {
  const anchors: HeadingAnchor[] = [];
  let ordinal = 0;

  for (let i = 0; i < previousSegments.length; i++) {
    const seg = previousSegments[i];
    if (!seg) continue;

    if (!seg.isHeading) {
      ordinal++;
      continue;
    }

    let afterAssetId: string | undefined;
    for (let b = i - 1; b >= 0; b--) {
      const cand = previousSegments[b];
      if (cand && !cand.isHeading) {
        afterAssetId = cand.assetId;
        break;
      }
    }

    let beforeAssetId: string | undefined;
    for (let f = i + 1; f < previousSegments.length; f++) {
      const cand = previousSegments[f];
      if (cand && !cand.isHeading) {
        beforeAssetId = cand.assetId;
        break;
      }
    }

    anchors.push({ heading: { ...seg }, afterAssetId, beforeAssetId, ordinal });
  }

  return anchors;
}

function closestIndexToOrdinal(candidates: number[], ordinal: number): number {
  let best = candidates[0]!;
  let bestDist = Math.abs(best - ordinal);
  for (let i = 1; i < candidates.length; i++) {
    const idx = candidates[i]!;
    const dist = Math.abs(idx - ordinal);
    if (dist < bestDist) {
      best = idx;
      bestDist = dist;
    }
  }
  return best;
}

function matchingIndices(contentSegments: VideoSegment[], assetId: string): number[] {
  const indices: number[] = [];
  for (let i = 0; i < contentSegments.length; i++) {
    if (contentSegments[i]?.assetId === assetId) indices.push(i);
  }
  return indices;
}

/**
 * Resolves which gap (0..contentSegments.length; gap g sits immediately
 * before contentSegments[g]) a heading should land in: prefer the fresh
 * segment matching afterAssetId (insert after it), else the one matching
 * beforeAssetId (insert before it), else the recorded ordinal position.
 * Reused assetIds are disambiguated by proximity to that ordinal.
 */
function resolveGapIndex(contentSegments: VideoSegment[], anchor: HeadingAnchor): number {
  if (anchor.afterAssetId !== undefined) {
    const candidates = matchingIndices(contentSegments, anchor.afterAssetId);
    if (candidates.length > 0) {
      return closestIndexToOrdinal(candidates, anchor.ordinal) + 1;
    }
  }

  if (anchor.beforeAssetId !== undefined) {
    const candidates = matchingIndices(contentSegments, anchor.beforeAssetId);
    if (candidates.length > 0) {
      return closestIndexToOrdinal(candidates, anchor.ordinal);
    }
  }

  return Math.min(Math.max(anchor.ordinal, 0), contentSegments.length);
}

/**
 * Places headings captured by computeHeadingAnchors back into a fresh
 * content (non-heading) array. Placement prefers the content segment
 * matching afterAssetId/beforeAssetId, falling back to the recorded
 * ordinal when neither resolves (asset deleted/renamed); ties among
 * reused assetIds are broken by proximity to that ordinal.
 *
 * Each heading steals duration from its bounding content neighbors using
 * the same 50/50-with-edge-spillover math as App.tsx handleInsertHeading,
 * so total duration is unchanged — headings borrow time, they don't add
 * it. Adjacent (clustered) headings resolve to the same gap and steal from
 * the same pair of neighbors in sequence, which keeps them ordered without
 * any cluster-specific casework — duration precision across a cluster is a
 * side effect of that, not a guarantee.
 */
export function reinsertHeadings(
  contentSegments: VideoSegment[],
  anchors: HeadingAnchor[],
): VideoSegment[] {
  const contentClones = contentSegments.map(s => ({ ...s }));
  if (anchors.length === 0) return contentClones;

  const buckets: VideoSegment[][] = Array.from({ length: contentClones.length + 1 }, () => []);
  for (const anchor of anchors) {
    const gap = resolveGapIndex(contentClones, anchor);
    const bucket = buckets[gap];
    if (bucket) bucket.push({ ...anchor.heading });
  }

  const merged: VideoSegment[] = [];
  for (let i = 0; i <= contentClones.length; i++) {
    const bucket = buckets[i];
    if (bucket) merged.push(...bucket);
    const content = contentClones[i];
    if (content) merged.push(content);
  }

  const HEADING_DUR = HEADING_DEFAULT_DURATION;
  const HALF = HEADING_DUR / 2;
  const MIN_DUR = 0.1;

  for (let i = 0; i < merged.length; i++) {
    const seg = merged[i];
    if (!seg) continue;
    if (!seg.isHeading) continue;

    let prevIdx = -1;
    for (let b = i - 1; b >= 0; b--) {
      const cand = merged[b];
      if (cand && !cand.isHeading) { prevIdx = b; break; }
    }
    let nextIdx = -1;
    for (let f = i + 1; f < merged.length; f++) {
      const cand = merged[f];
      if (cand && !cand.isHeading) { nextIdx = f; break; }
    }

    const prevSeg = prevIdx !== -1 ? merged[prevIdx] : undefined;
    const nextSeg = nextIdx !== -1 ? merged[nextIdx] : undefined;

    let prevSteal = 0;
    let nextSteal = 0;

    if (prevSeg && nextSeg) {
      const prevAvail = Math.max(0, prevSeg.duration - MIN_DUR);
      const nextAvail = Math.max(0, nextSeg.duration - MIN_DUR);
      prevSteal = Math.min(HALF, prevAvail);
      const remaining = HEADING_DUR - prevSteal;
      nextSteal = Math.min(remaining, nextAvail);
      const stillRemaining = HEADING_DUR - prevSteal - nextSteal;
      if (stillRemaining > 0) {
        prevSteal += Math.min(stillRemaining, prevAvail - prevSteal);
      }
    } else if (prevSeg && !nextSeg) {
      prevSteal = Math.max(0, Math.min(HEADING_DUR, prevSeg.duration - MIN_DUR));
    } else if (!prevSeg && nextSeg) {
      nextSteal = Math.max(0, Math.min(HEADING_DUR, nextSeg.duration - MIN_DUR));
    }

    const actualDur = Number((prevSteal + nextSteal).toFixed(3)) || HEADING_DUR;

    if (prevSeg) prevSeg.duration = Number((prevSeg.duration - prevSteal).toFixed(3));
    if (nextSeg) nextSeg.duration = Number((nextSeg.duration - nextSteal).toFixed(3));
    seg.duration = actualDur;
  }

  let cursor = 0;
  for (const seg of merged) {
    seg.startTime = Number(cursor.toFixed(3));
    if (seg.isHeading) {
      // Reinserted onto a fresh timeline — its old anchor is stale and would
      // misplace it if anything downstream re-derives timing from anchors.
      seg.anchorStart = seg.startTime;
      seg.anchorSource = 'estimate';
    }
    cursor += seg.duration;
  }

  return merged;
}
