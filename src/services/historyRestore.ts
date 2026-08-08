// historyRestore.ts — pure selection/playhead repair for App.tsx's
// applyRestoredState (Phase 2 undo/redo traversal, design §4). Extracted
// verbatim out of App.tsx (Stage 6, 2026-08-08 cleanup run) — behavior-
// preserving only, no change intended. The useState wiring itself
// (setSelectedSegmentId, setProjectSilent, etc.) stays in App.tsx; only the
// pure "what should the repaired value be" computation moved here, so it can
// be unit-tested without a DOM/render harness (this repo has no jsdom/
// testing-library — the same gap usePlayback.test.ts and timelineLayout.ts's
// own header already document).
//
// Selection is deliberately NOT restored to what it was at the time of the
// original edit (design §4, the "haunted editor" failure mode: undoing a
// timing change should not jump the editor to a segment the user was not
// looking at) — only REPAIRED: an id that no longer exists in the restored
// project is dropped, everything else passes through unchanged. Each
// function here is called from its own state setter's functional updater
// form in App.tsx (`setSelectedSegmentId(prev => repairSelectedSegmentId(prev,
// restored))`), not from a closed-over value — preserved exactly as it was
// before this extraction, since that is what keeps a same-tick batch of
// restore-triggered state updates each reading their own freshest `prev`.

import type { Project } from '../types';

/** Whether `id` still exists among `restored`'s segments — used to repair
 *  `selectedSegmentId` after a restore. */
export function repairSelectedSegmentId(id: string | null, restored: Project): string | null {
  return id && restored.segments.some(sg => sg.id === id) ? id : null;
}

/** Whether `id` still exists among `restored`'s headings — used to repair
 *  `selectedHeadingId` after a restore. */
export function repairSelectedHeadingId(id: string | null, restored: Project): string | null {
  return id && (restored.headings ?? []).some(hd => hd.id === id) ? id : null;
}

/**
 * Filters `ids` down to those still present in `restored`'s segments.
 *
 * Returns `ids` itself, unchanged, when nothing was filtered out — the common
 * case (a restore whose selection was already fully valid) must not force an
 * unnecessary re-render by allocating a new Set every time.
 */
export function repairSelectedSegmentIds(ids: Set<string>, restored: Project): Set<string> {
  const alive = new Set([...ids].filter(id => restored.segments.some(sg => sg.id === id)));
  return alive.size === ids.size ? ids : alive;
}

/**
 * Clamps `currentTime` into the restored timeline's bounds so a shorter
 * timeline cannot leave the playhead stranded past its end. Playback position
 * is otherwise not undoable (owner ruling: undo during playback keeps
 * playing — the playhead is not history), so this only ever pulls the value
 * DOWN to `restoredEnd`, never moves it for any other reason.
 */
export function clampCurrentTimeToRestoredEnd(currentTime: number, restored: Project): number {
  const restoredEnd = restored.segments.reduce(
    (acc, sg) => Math.max(acc, sg.startTime + sg.duration), 0);
  return currentTime > restoredEnd ? restoredEnd : currentTime;
}
