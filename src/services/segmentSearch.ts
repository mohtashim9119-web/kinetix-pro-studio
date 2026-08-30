/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Asset, VideoSegment } from '../types';
import { formatTime } from './timeFormat';

export interface SegmentSearchContext {
  displayTitle: string;
  description: string;
  assetFilename: string | undefined;
  segmentNumber: number; // 1-based row number
  startTime: number;
  endTime: number;
  duration: number;
}

const BARE_INTEGER_RE = /^\d+$/;
const DECIMAL_DURATION_RE = /^\d+\.\d{1,2}s?$/;
const TIME_CODE_RE = /^\d{1,3}:\d{2}$/;

/** "12" / "08" / "008" → numeric match against the 1-based segment number. */
export function matchesSegmentNumber(query: string, segmentNumber: number): boolean {
  if (!BARE_INTEGER_RE.test(query)) return false;
  return parseInt(query, 10) === segmentNumber;
}

/**
 * "4.5" / "4.5s" / "12.5s" → exact string match against the segment's
 * displayed duration (`duration.toFixed(1)`), not numeric equality — "4.50"
 * does not match a duration displaying "4.5".
 */
export function matchesDuration(query: string, duration: number): boolean {
  if (!DECIMAL_DURATION_RE.test(query)) return false;
  const stripped = query.endsWith('s') ? query.slice(0, -1) : query;
  return stripped === duration.toFixed(1);
}

/**
 * "00:12" → exact string match against the segment's start or end time code,
 * using the same MM:SS formatter the row display uses. The minutes component
 * is zero-padded to 2 digits before comparing (matching formatTime's own
 * padding) so a 1-digit-minute query like "0:12" still matches "00:12".
 */
export function matchesTimeCode(query: string, startTime: number, endTime: number): boolean {
  if (!TIME_CODE_RE.test(query)) return false;
  const [minutes = '', seconds = ''] = query.split(':');
  const normalized = `${minutes.padStart(2, '0')}:${seconds}`;
  return normalized === formatTime(startTime) || normalized === formatTime(endTime);
}

/**
 * Deep-search predicate for the Segments tab: substring match across title/
 * description/asset filename, OR'd with exact-shape matches against segment
 * number, duration, and time code. Empty/whitespace-only query always matches.
 */
export function matchesSegmentQuery(query: string, ctx: SegmentSearchContext): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  const lower = trimmed.toLowerCase();
  if (ctx.displayTitle.toLowerCase().includes(lower)) return true;
  if (ctx.description.toLowerCase().includes(lower)) return true;
  if (ctx.assetFilename?.toLowerCase().includes(lower)) return true;

  if (matchesSegmentNumber(trimmed, ctx.segmentNumber)) return true;
  if (matchesDuration(trimmed, ctx.duration)) return true;
  if (matchesTimeCode(trimmed, ctx.startTime, ctx.endTime)) return true;

  return false;
}

/**
 * Human-readable segment title for the Segments tab row. Falls back through
 * the asset filename (cleaned of leading index codes / trailing timestamps /
 * extension) to a positional "Scene N" label. VideoSegment has no
 * filename/sceneLine field of its own — the filename lives on the looked-up
 * Asset. The search predicate matches against this exact title, so both must
 * come from one function.
 *
 * `isSplit` (WS2 ws2-25 Commit 4) — a split slice (`isSliceSegmentId`). A
 * split slice keeps its parent's asset, so this only ever changes anything
 * for a slice whose parent had none. With no asset, such a segment falls
 * back to its OWN SCRIPT TEXT — the content it was created from — never the
 * positional label, which describes nothing true about it. An asset still
 * takes precedence once the user assigns one; only the empty-asset fallback
 * changes.
 */
export function computeSegmentDisplayTitle(
  seg: VideoSegment, asset: Asset | undefined, isSplit = false,
): string {
  if (asset?.name) {
    const cleaned = asset.name
      .replace(/\.[a-zA-Z0-9]+$/, '')      // extension
      .replace(/^\d{2,4}[_-]/, '')          // leading index code
      .replace(/[_-]\d{8,}$/, '')           // trailing timestamp
      .replace(/[_-]+/g, ' ')
      .trim();
    if (cleaned) return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (isSplit) {
    const text = seg.text?.trim();
    if (text) return text;
  }
  return `Scene ${seg.order + 1}`;
}
