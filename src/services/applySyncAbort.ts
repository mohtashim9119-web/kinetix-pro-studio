/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.7 Requirement 3 — classifying Apply Sync aborts for recovery fallback.
//
// Recovery from an unapplied transcript must distinguish preconditions that
// have nothing to do with the transcript itself (no scene structure to sync
// against) from failures where consuming the transcript into a timeline was
// attempted and failed. Only the former may salvage tokens and dismiss the
// banner; the latter must retain the durable record.
//
// Message strings MUST stay byte-identical to App.tsx's exported constants.
// ---------------------------------------------------------------------------

/** Must match `App.tsx`'s `EMPTY_SCENE_DOC_MESSAGE`. */
const EMPTY_SCENE_DOC_MESSAGE =
  'Your scene doc has no scenes to sync. Add scene tags and try again.';
/** Must match `App.tsx`'s `NO_SCENE_DOC_MESSAGE` (WS2-50). Same class as
 *  `EMPTY_SCENE_DOC_MESSAGE` — a precondition about the scene doc, not about
 *  the transcript — so it classifies identically. */
const NO_SCENE_DOC_MESSAGE =
  'No scene doc is loaded, so there is nothing to sync. Add a scene details file and try again.';
/** Must match `App.tsx`'s `EMPTY_TRANSCRIPT_MESSAGE`. */
const EMPTY_TRANSCRIPT_MESSAGE =
  'No speech was found in the audio. No timeline will be created.';
/** Must match `App.tsx`'s `FULL_MISMATCH_MESSAGE`. */
const FULL_MISMATCH_MESSAGE =
  "This voiceover doesn't match your scene doc. No timeline will be created.";

/** Prefix of the voiceover-duration probe abort (App.tsx ~3298). */
export const VOICEOVER_DURATION_ABORT_PREFIX = "Couldn't read the voiceover's duration";

export type SyncAbortClassification = 'transcript_unrelated' | 'timeline_failure';

export type ApplySyncResult = { ok: true } | { ok: false; message: string };

export function classifySyncAbortMessage(message: string): SyncAbortClassification {
  if (message === EMPTY_SCENE_DOC_MESSAGE) return 'transcript_unrelated';
  if (message === NO_SCENE_DOC_MESSAGE) return 'transcript_unrelated';
  if (message.startsWith(VOICEOVER_DURATION_ABORT_PREFIX)) return 'transcript_unrelated';
  if (message === EMPTY_TRANSCRIPT_MESSAGE) return 'timeline_failure';
  if (message === FULL_MISMATCH_MESSAGE) return 'timeline_failure';
  // Any future/unknown abort message: retain the record (conservative).
  return 'timeline_failure';
}

/** Stable labels for tests and the operator report table. */
export const SYNC_ABORT_PATH_LABELS = {
  voiceoverDuration: 'voiceover duration probe failed',
  emptySceneDoc: 'empty scene doc (zero parsed segments)',
  emptyTranscript: 'empty transcript (zero Whisper tokens)',
  coverageGate: 'coverage gate (full mismatch)',
  throwAfterCommit: 'throw after step-8 commit',
} as const;
