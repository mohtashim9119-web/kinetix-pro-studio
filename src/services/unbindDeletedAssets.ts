/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wave 3 U9 A4 — what a deleted asset does to the scenes that used it.
 *
 * The scene reverts to an honest [NO ASSET] placeholder. If it carries an
 * EXPLICIT scene-doc tag it is also flagged `unmatchedExplicitTag`, the same
 * "never guess wrong" rule sync applies: without the flag, the next media
 * import's `autoMatchSegments` would fuzzy-match the scene from its spoken
 * text and silently bind a wrong file (the "bleed") instead of waiting for
 * the tag's own file — which the wand ("Match media to scenes") then finds.
 * Timings and every other field are untouched; unaffected segments keep their
 * identity by reference.
 */

import type { VideoSegment } from '../types';

export interface UnbindResult {
  segments: VideoSegment[];
  /** 1-based positions of scenes that lost their asset in this call. */
  newlyUnbound: number[];
}

export function unbindDeletedAssets(segments: VideoSegment[], removedIds: ReadonlySet<string>): UnbindResult {
  const newlyUnbound: number[] = [];
  const next = segments.map((s, i) => {
    if (!s.assetId || !removedIds.has(s.assetId)) return s;
    newlyUnbound.push(i + 1);
    const { assetId: _gone, ...rest } = s;
    return s.tag?.trim() ? { ...rest, unmatchedExplicitTag: true } : rest;
  });
  return { segments: next, newlyUnbound };
}
