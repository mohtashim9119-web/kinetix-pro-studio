/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Media workflow Unit 3 — the dataTransfer type a Media block tile drag
 * carries (payload: the asset id) and a timeline segment card accepts. The
 * timeline's own gestures are pointer-event based with no HTML5 drag
 * handlers, and DropZonePanel's slots accept `Files`; a dedicated type keeps
 * all three apart — a segment ignores any drag that doesn't carry this.
 */

import type { Asset, VideoSegment } from '../types';

export const ASSET_DRAG_MIME = 'application/x-kinetix-asset-id';

export function carriesAssetDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  return !!dataTransfer && Array.from(dataTransfer.types ?? []).includes(ASSET_DRAG_MIME);
}

/**
 * The assignment a tile drop makes: `assetId` on exactly `segmentId`, with
 * the stale `unmatchedExplicitTag` flag dropped (the scene is no longer
 * unmatched) and the pick stamped `assetAssignedBy: 'manual'` (Wave 3 B0 — the
 * wand never overwrites it). The user's pick is authoritative — no name logic. Assignment
 * only: every timing field is carried through untouched, every other segment
 * by reference. An unknown asset/segment id returns the same array.
 */
export function assignAssetToSegment(
  segments: VideoSegment[],
  assets: readonly Asset[],
  segmentId: string,
  assetId: string,
): VideoSegment[] {
  if (!assets.some(a => a.id === assetId) || !segments.some(s => s.id === segmentId)) return segments;
  return segments.map(s => {
    if (s.id !== segmentId) return s;
    const { unmatchedExplicitTag: _stale, ...rest } = s;
    return { ...rest, assetId, assetAssignedBy: 'manual' as const };
  });
}
