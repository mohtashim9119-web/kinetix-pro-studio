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
