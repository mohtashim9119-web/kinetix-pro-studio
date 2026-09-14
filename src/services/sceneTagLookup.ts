/**
 * Recovers the ORIGINAL filename a segment was tagged with, straight from
 * `project.sceneDetails` — the raw script/scene text, which `handleDeleteAsset`
 * never touches. Deleting an asset clears the segment's `assetId` and drops
 * the `Asset` record (with it, the only other place the filename lived), but
 * the bracket tag the operator originally typed is still sitting in
 * `sceneDetails` untouched. This is a lookup by segment TEXT, not by array
 * position — segment order can diverge from scene order after a re-sync
 * (splits/merges), but a segment's own `text` is exactly the scene
 * description it was created from, so matching on that stays correct even
 * after reordering. Returns null when no scene's description matches (a
 * split/merged segment's text may no longer match any single scene verbatim
 * — the caller falls back to "not linked" rather than guessing).
 */

import { cleanTagName } from './syncEngine';

const TAG_REGEX = /(?=\[[^\]]*\])/;

interface SceneTagEntry {
  tagName: string;
  description: string;
}

function parseSceneTags(sceneDetails: string): SceneTagEntry[] {
  const rawDetails = sceneDetails.split(TAG_REGEX).filter((block) => block.trim() !== '');
  const entries: SceneTagEntry[] = [];

  for (const block of rawDetails) {
    const trimmedBlock = block.trim();
    const tagMatch = trimmedBlock.match(/^\[[^\]]*\]/);
    if (!tagMatch) continue;
    const bracketContent = tagMatch[0].slice(1, -1);
    const tagName = cleanTagName(bracketContent);
    if (!tagName) continue;
    const description = trimmedBlock
      .slice(tagMatch[0].length)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .join(' ');
    entries.push({ tagName, description });
  }
  return entries;
}

/**
 * Finds the original tag name (filename stem, e.g. "042_eleven_years") for a
 * segment whose `text` exactly matches one scene's description. Returns null
 * when `sceneDetails` is empty, no scene's description matches, or more than
 * one scene shares the same description (ambiguous — never guess wrong).
 */
export function findExpectedFileNameForSegmentText(
  sceneDetails: string,
  segmentText: string,
): string | null {
  const text = segmentText.trim();
  if (!text || !sceneDetails) return null;

  const entries = parseSceneTags(sceneDetails);
  const matches = entries.filter((e) => e.description.trim() === text);
  if (matches.length !== 1) return null;
  return matches[0]!.tagName;
}
