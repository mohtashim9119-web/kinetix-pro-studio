/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MM:SS formatter shared by the Segments-tab row display
 * (DropZonePanel.tsx) and the deep-search predicate (segmentSearch.ts) — it
 * must stay identical to what the UI shows, or a time-code search query
 * would silently stop matching the row the user is actually looking at.
 */
export const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};
