import type { Asset, VideoSegment } from '../../types';

const MAX_LISTED = 10;

/** 1-based timeline positions (what the user sees) of segments whose assetId
 *  does not resolve to an asset with a url. Unassigned segments are intentional. */
export function findMissingMediaSegmentNumbers(
  segments: readonly VideoSegment[],
  assetMap: ReadonlyMap<string, Asset>,
): number[] {
  const out: number[] = [];
  segments.forEach((s, i) => {
    if (s.assetId && !assetMap.get(s.assetId)?.url) out.push(i + 1);
  });
  return out;
}

export function buildMissingMediaMessage(numbers: readonly number[]): string {
  const shown = numbers.slice(0, MAX_LISTED).join(', ');
  const more = numbers.length > MAX_LISTED ? ` +${numbers.length - MAX_LISTED} more` : '';
  const noun = numbers.length === 1 ? 'segment' : 'segments';
  return `Export blocked: media is missing for ${noun} ${shown}${more}. Add it to unblock export.`;
}

/** 1-based timeline numbers of segments with no media assigned at all. These
 *  export as black frames on the slower canvas path (not blocked). */
export function findUnassignedSegmentNumbers(segments: readonly VideoSegment[]): number[] {
  const out: number[] = [];
  segments.forEach((s, i) => { if (!s.assetId) out.push(i + 1); });
  return out;
}

export interface MediaIssues {
  /** No media assigned — exports as black frames on the slower canvas path. */
  none: number[];
  /** Assigned file is offline (no bytes) — export is blocked. */
  offline: number[];
  /** Assigned file is present but undecodable — export may fail. */
  corrupt: number[];
}

export function findMediaIssues(segments: readonly VideoSegment[], assets: readonly Asset[]): MediaIssues {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const issues: MediaIssues = { none: [], offline: [], corrupt: [] };
  segments.forEach((seg, i) => {
    if (!seg.assetId) { issues.none.push(i + 1); return; }
    const asset = byId.get(seg.assetId);
    if (!asset || asset.unresolved || !asset.url) issues.offline.push(i + 1);
    else if (asset.corrupt) issues.corrupt.push(i + 1);
  });
  return issues;
}

export function hasMediaIssues(i: MediaIssues): boolean {
  return i.none.length + i.offline.length + i.corrupt.length > 0;
}

function subject(numbers: readonly number[]): string {
  const shown = numbers.slice(0, MAX_LISTED).join(', ');
  const more = numbers.length > MAX_LISTED ? ` +${numbers.length - MAX_LISTED} more` : '';
  return numbers.length === 1 ? `Segment ${shown} has` : `Segments ${shown}${more} have`;
}

export function buildMediaIssuesWarning(i: MediaIssues): string {
  const parts: string[] = [];
  if (i.none.length) parts.push(`${subject(i.none)} no media and will export as black frames, using slower export path.`);
  if (i.offline.length) parts.push(`${subject(i.offline)} offline media and will block export.`);
  if (i.corrupt.length) parts.push(`${subject(i.corrupt)} damaged media and may fail to export.`);
  return `${parts.join(' ')} Add media or continue.`;
}

export function buildUnassignedMediaWarning(numbers: readonly number[]): string {
  return buildMediaIssuesWarning({ none: [...numbers], offline: [], corrupt: [] });
}

/** Headline is plain; segment ids are logged, never shown to the user. */
export function buildMissingMediaError(
  segments: readonly VideoSegment[],
  assetMap: ReadonlyMap<string, Asset>,
): { kind: 'asset_missing'; message: string } {
  const numbers = findMissingMediaSegmentNumbers(segments, assetMap);
  console.warn(
    '[export] missing media: ' +
      numbers.map((n) => `#${n} segment "${segments[n - 1]!.id}" assetId "${segments[n - 1]!.assetId}"`).join('; '),
  );
  return { kind: 'asset_missing', message: buildMissingMediaMessage(numbers) };
}
