/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Asset, VideoSegment } from '../types';

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
