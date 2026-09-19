/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// plan-v3 Wave 1 item 4 — restart-safe pause-and-ask.
//
// A paused Apply Sync run (`FaRunResult.status === 'paused'`,
// `forcedAlignmentRun.ts`) stops before any commit and asks the user how to
// proceed (`SyncPausedDialog`). If the app closes — or the user simply
// switches away — before they answer, the ask must re-present on the next
// launch/open rather than silently vanish, which would leave a run neither
// finished nor visibly waiting.
//
// APP/SESSION-SCOPED LOCAL STORAGE, DELIBERATELY NOT `projectStore`. Three
// reasons:
//
//  1. THE V5 MIGRATION (plan-v3 item 8, Group C) touches `projectStore`'s
//     schema and is a separate, concurrently-landing change. A pause record
//     living on `Project` would need to migrate alongside it — coupling two
//     independently-scoped changes for no benefit, since nothing about a
//     pause record needs project-schema versioning at all.
//  2. UNDO WOULD RESURRECT IT. Same argument `stagedFilesStore.ts` makes for
//     staged files: a `Project` field rides `history.ts`'s 20-snapshot ring,
//     so an undo past the point a pause was resolved would silently re-arm a
//     dialog the user already answered. A pause record answers "is there an
//     unresolved ask right now", not "what did this project once contain" —
//     it has no undo semantics.
//  3. NOTHING ELSE NEEDS IT ON THE PROJECT. The record exists purely to
//     re-present a dialog; once the user answers (or a fresh Apply Sync
//     supersedes it), it is cleared and forgotten. `Project.faWordTimings`
//     and the sync log already carry the durable, meaningful record of what
//     happened — this store only ever answers "is the user still owed an
//     answer for run X".
//
// Keyed by project id (one browser/app origin can hold several projects'
// pause records at once, matching `uiStateStore.ts`'s own per-origin scope).
// `resumable: true` on every stored record is the caller's own reminder that
// `FaRunResult.status === 'paused'` runs are held BEFORE any transcript work
// is redone — the cached Whisper transcript this run already had lives on
// `Project.transcriptTokens`, so resuming (retry FA, or accept Whisper) never
// re-transcribes.
// ---------------------------------------------------------------------------

import type { FaFailureKind } from './forcedAlignmentRun';

const KEY_PREFIX = 'kinetix:fa-pause:v1:';

export interface FaPauseRecord {
  projectId: string;
  syncRunId: string;
  reason: FaFailureKind;
  detail?: string;
  /** Date.now() when the pause was recorded — shown in the re-presented
   *  dialog so a user who left it overnight knows how stale the ask is. */
  timestamp: number;
}

/** Persists a paused run's ask so it survives an app restart. Overwrites any
 *  prior pause record for this project — a project can only be waiting on
 *  one Apply Sync run's answer at a time (Apply Sync itself is single-flight
 *  per project). Silently no-ops on a storage failure (quota, private mode,
 *  unavailable `localStorage`): losing the restart-safety guarantee is a
 *  degradation, not a reason to make the pause itself throw. */
export function saveFaPause(record: FaPauseRecord): void {
  try {
    localStorage.setItem(KEY_PREFIX + record.projectId, JSON.stringify(record));
  } catch {
    /* quota exceeded or unavailable — the ask simply won't re-present */
  }
}

/** Reads back this project's pending pause record, or `null` if there is
 *  none (the common case) or the stored value is unreadable/malformed (a
 *  future schema change, or storage corruption — never throws into a caller
 *  that just wants to know whether to show the dialog). */
export function readFaPause(projectId: string): FaPauseRecord | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FaPauseRecord>;
    if (
      typeof parsed.projectId !== 'string'
      || typeof parsed.syncRunId !== 'string'
      || typeof parsed.reason !== 'string'
      || typeof parsed.timestamp !== 'number'
    ) {
      return null;
    }
    return parsed as FaPauseRecord;
  } catch {
    return null;
  }
}

/** Clears this project's pause record — called the instant the user answers
 *  (retry, continue with Whisper, or cancel) and at the start of every fresh
 *  Apply Sync (a new run supersedes whatever the previous one was asking). */
export function clearFaPause(projectId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + projectId);
  } catch {
    /* ignore — nothing to clean up if storage is unavailable */
  }
}
