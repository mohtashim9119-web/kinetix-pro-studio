/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Asset, VideoSegment } from '../types';

export const isFuzzyMatch = (search: string, target: string): boolean => {
  if (!search || !target) return false;
  const s = search.toLowerCase().trim().replace(/\[(IMAGE|VIDEO|HEADING):?\s*|\]/gi, '').replace(/\.(jpg|jpeg|png|webp|gif|bmp|svg|avif|heic|heif|mp4|mov|webm|m4v|wav|mp3|zip)$/i, '');
  const t = target.toLowerCase().trim().replace(/\.(jpg|jpeg|png|webp|gif|bmp|svg|avif|heic|heif|mp4|mov|webm|m4v|wav|mp3|zip)$/i, '');

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
 * Normalizes a string for strict tag/filename comparison: Unicode NFC form,
 * smart quotes/dashes folded to their plain ASCII equivalents, and zero-width
 * characters (U+200B, U+FEFF) stripped — the encoding artifacts a filename
 * commonly picks up surviving a copy-paste from Word/Google Docs.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[​﻿]/g, '');
}

/**
 * Allowlisted image+video extensions stripped from filenames/tags before an
 * exact-name comparison, so a bare tag `[002_age_24]` matches an uploaded
 * `002_age_24.jpg`. Uses an anchored, allowlisted trailing-extension pattern
 * (not a naive last-dot split) so dotted stems like `my.scene.02` survive
 * intact — only a real trailing media extension is removed.
 */
const MEDIA_EXT_RE = /\.(jpg|jpeg|png|webp|gif|bmp|svg|avif|heic|heif|mp4|mov|webm|m4v)$/i;

/** Removes a single trailing allowlisted media extension, if present. */
export function stripMediaExtension(s: string): string {
  return s.replace(MEDIA_EXT_RE, '');
}

/**
 * Strips stray edge punctuation that can't be part of a filename stem — a
 * typo'd leading colon, quotes, stray whitespace — while KEEPING characters
 * that are filename-legal at the edges: letters, digits, underscore, hyphen,
 * and dot. So `_intro.jpg`, `002_age_24`, and `my.scene.02` survive intact,
 * but `":  foo"` → `"foo"`. Interior characters (e.g. a space in
 * "my file.jpg") are untouched — only the leading/trailing runs are cleaned.
 */
const cleanEdgePunctuation = (v: string): string =>
  v.replace(/^[^a-zA-Z0-9_.-]+/, '').replace(/[^a-zA-Z0-9_.-]+$/, '');

/**
 * Normalizes raw bracket-tag content into a filename stem for matching.
 * Order matters: clean edges first (so a stray leading `:` or quote can't
 * hide a legacy `IMAGE:`/`VIDEO:`/`HEADING:` keyword from the strip), then
 * drop the legacy keyword prefix, then clean edges again (so any punctuation
 * the keyword strip exposed — e.g. `[IMAGE: : foo]` — is also removed).
 * `HEADING:` is stripped exactly like `IMAGE:`/`VIDEO:` — the keyword itself
 * is never read for anything; a `[HEADING: foo.jpg]` tag matches an asset
 * named `foo.jpg` the same as `[IMAGE: foo.jpg]` would (Path B Decision 6 —
 * headings are no longer a distinct tag kind).
 * Extension stripping is deliberately NOT done here; isExactFilenameMatch
 * strips extensions from both sides at compare time.
 */
export function cleanTagName(raw: string): string {
  let name = cleanEdgePunctuation(raw.trim());
  name = name.replace(/^(?:IMAGE|VIDEO|HEADING)\s*:\s*/i, '');
  return cleanEdgePunctuation(name);
}

/**
 * Strict, case-insensitive, extension-agnostic filename match for the
 * bare-bracket tag format — no fuzzy/substring/word-overlap fallback (that's
 * isFuzzyMatch's job). A trailing media extension is stripped from BOTH sides
 * first, so `[002_age_24]`, `[002_age_24.jpg]`, and asset `002_age_24.png` all
 * resolve to the same normalized stem.
 */
export function isExactFilenameMatch(tagName: string, assetName: string): boolean {
  return normalizeForMatch(stripMediaExtension(tagName.trim()).toLowerCase()) ===
    normalizeForMatch(stripMediaExtension(assetName.trim()).toLowerCase());
}

/** Splits a name into lowercase alphanumeric word tokens using the same stem
 *  normalization as isExactFilenameMatch (extension strip + Unicode fold +
 *  lowercase), so `002_age_24.jpg` → ['002','age','24']. */
function toWordTokens(s: string): string[] {
  return normalizeForMatch(stripMediaExtension(s.trim()).toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Explicit-tag fallback tier (runs only after isExactFilenameMatch fails):
 * true when the tag's word-token sequence appears as a CONTIGUOUS, in-order,
 * adjacent block anywhere inside the asset's word-token sequence — tag-within-
 * asset direction only, not the reverse. So a short tag `[year_2003]` resolves
 * to asset `year_2003_2342368767.jpg`, but `[2003_year]` does NOT match
 * `year_2003` (order + adjacency required — this is a token-level substring,
 * not a gap-allowing subsequence). An empty tag returns false.
 *
 * Deliberately looser than isExactFilenameMatch and stricter than isFuzzyMatch.
 * Because a single short tag can be a contiguous block of several filenames,
 * this is inherently ambiguity-prone: callers MUST require a UNIQUE match
 * before assigning and leave a 2+ match visibly unmatched rather than silently
 * picking one (same "never guess wrong" rule as the exact tier, commit 9b15a59).
 */
export function contiguousWordMatch(tagName: string, assetName: string): boolean {
  const tag = toWordTokens(tagName);
  if (tag.length === 0) return false;
  const asset = toWordTokens(assetName);
  if (tag.length > asset.length) return false;

  for (let i = 0; i + tag.length <= asset.length; i++) {
    let allMatch = true;
    for (let j = 0; j < tag.length; j++) {
      if (asset[i + j] !== tag[j]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }
  return false;
}

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

  // PASS 1 — normalize first-segment anchor to 0. (PASS 2 deleted in 3d-2)
  // If the new first segment was previously not first (its anchor > 0), or is brand-new
  // (anchor undefined), shift it to 0 so there is never a silent gap at the front.
  const first = out[0];
  if (first && ((first.anchorStart ?? 0) > 0 || first.anchorStart === undefined)) {
    if (first.anchorStart === undefined) first.anchorSource = 'estimate';
    first.anchorStart = 0;
  }

  // PASS 2 — recompute startTime and duration from anchors.
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

  // Backstop monotonic clamp (D16 defense-in-depth). If an anchor still
  // overshoots its successor — an overshoot the primary alignment guard in
  // whisperService did not catch — deriving durations below would push this
  // segment's end past the next segment's start, collapsing both to the 0.1
  // floor (the inversion class the warning above only reports). Walk backward,
  // pulling any inflated non-locked anchor down to its successor so anchors are
  // monotonically non-decreasing before durations are derived; the walk order
  // lets a run of overshoots collapse cleanly. Locked segments are authoritative
  // (never move/shrink) and are skipped. No-op when anchors are already
  // monotonic, so normal projects are byte-identical.
  for (let i = out.length - 2; i >= 0; i--) {
    const cur = out[i]!;
    if (cur.locked) continue;
    const curAnchor = cur.anchorStart ?? cur.startTime ?? 0;
    const nextAnchor = out[i + 1]?.anchorStart ?? out[i + 1]?.startTime ?? 0;
    if (curAnchor > nextAnchor) {
      cur.anchorStart = nextAnchor;
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

  // PASS 3 — clamp last segment exactly to audioDuration.
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

    // A segment that carried an EXPLICIT bracket tag whose filename failed
    // exact matching at parse time must never be fuzzy-guessed from its spoken
    // text — that silently picks a wrong asset. Leave it visibly unmatched
    // (red missing tile); recovery is re-running Apply Sync, which re-parses
    // the tag and exact-matches. Segments that never had an explicit tag name
    // (empty `[]`, so this flag was never set) are still fuzzy-matched below.
    if (s.unmatchedExplicitTag) return s;

    const bracketMatch = s.text.match(/\[(.*?):?\s*(.*?)\]/);
    if (bracketMatch) {
      const name = (bracketMatch[2] ?? '').trim();
      const asset = assets.find(a => isFuzzyMatch(name, a.name));
      if (asset) return { ...s, assetId: asset.id };
    }

    const contextAsset = findAssetByContext(s.text, assets);
    if (contextAsset) return { ...s, assetId: contextAsset.id };

    return s;
  });
