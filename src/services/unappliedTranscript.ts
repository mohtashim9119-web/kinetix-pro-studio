/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.7 Requirement 3 — unapplied-transcript recovery, the pure half.
//
// Every rule that decides what happens to a `Project.unappliedTranscript` lives
// here as a plain function over a `Project`: recording one at transcription
// completion, restoring its tokens, clearing it, and judging whether it still
// describes the audio the project currently holds. `App.tsx` and
// `useWhisper.ts` do the wiring and own no rule of their own.
//
// WHY A SERVICE AND NOT INLINE IN App.tsx. The load-bearing behaviour of this
// feature is a NEGATIVE — "a failed apply must still leave the transcript on
// disk" — and a negative asserted through the component tree is asserted
// through everything that could mask it. As pure functions the ordering rule
// (restore tokens, write the timeline, clear only after) is stated once and
// testable without a DOM.
// ---------------------------------------------------------------------------

import type { Project, TranscriptToken, UnappliedTranscript } from '../types';

/**
 * Builds the record written at transcription completion.
 *
 * `tokens` is copied (a shallow array copy — the token objects themselves are
 * never mutated anywhere in the pipeline) so that a later writer clearing
 * `Project.transcriptTokens` cannot empty this record through a shared
 * reference. `fileIdentity` is `''` when the caller had no `File` to compute
 * one from; that is an UNKNOWN, and `isUnappliedTranscriptStale` treats it as
 * such rather than as a mismatch.
 */
export function buildUnappliedTranscript(
  tokens: readonly TranscriptToken[],
  assetId: string,
  fileIdentity: string | undefined,
  completedAt: Date = new Date(),
): UnappliedTranscript {
  return {
    tokens: [...tokens],
    assetId,
    fileIdentity: fileIdentity ?? '',
    completedAt: completedAt.toISOString(),
  };
}

/**
 * Records `record` on `project`.
 *
 * DELIBERATELY TOUCHES EXACTLY ONE KEY. In particular it does NOT write
 * `language` or `detectedLanguage`: the sticky-language rule (types.ts's
 * `language`, `languageDefaultDrift.test.ts`) says only an explicit completion
 * or an explicit user override may set that field, and a recovery record is
 * neither. `useWhisper.ts`'s completion update still writes the detected
 * language on its own established terms, in its own spread — this helper is
 * folded into that update and must not add a second, differently-reasoned
 * language writer. `unappliedTranscript.test.ts` locks the one-key property.
 */
export function withUnappliedTranscript(project: Project, record: UnappliedTranscript): Project {
  return { ...project, unappliedTranscript: record };
}

/**
 * Removes the record. Used by Discard, and by the apply path AFTER — never
 * before — its timeline write has completed.
 *
 * Returns the same object identity when there is nothing to clear, so a
 * redundant clear cannot masquerade as a project edit to the autosave/history
 * layers that compare by reference.
 */
export function clearUnappliedTranscript(project: Project): Project {
  if (project.unappliedTranscript === undefined) return project;
  const next = { ...project };
  delete next.unappliedTranscript;
  return next;
}

/** Toast copy for the recovery fallback when scene structure blocks a timeline write. */
export const TRANSCRIPT_SAVED_NEED_SCENE_TAGS_TOAST =
  'Transcript saved. Add scene tags to your scene doc, then run Apply Sync to build the timeline.';

/**
 * Fallback when Apply Sync aborts for a reason unrelated to the transcript:
 * persist the tokens to the ordinary cache, clear the unspent record, and let
 * the caller dismiss the banner.
 *
 * Does NOT re-arm the recovery banner — that is gated separately in App.tsx.
 */
export function salvageTranscriptWithoutTimeline(
  project: Project,
  record: UnappliedTranscript,
): Project {
  return clearUnappliedTranscript({
    ...project,
    transcriptTokens: [...record.tokens],
    lastTranscribedFileIdentity: record.fileIdentity !== ''
      ? record.fileIdentity
      : project.lastTranscribedFileIdentity,
  });
}

/** True when `live` holds the same token sequence as `record` (shallow text/times). */
export function transcriptTokensMatchRecord(
  live: readonly TranscriptToken[] | undefined,
  record: UnappliedTranscript,
): boolean {
  if (!live || live.length !== record.tokens.length) return false;
  return live.every((t, i) => {
    const r = record.tokens[i]!;
    return t.text === r.text && t.startSec === r.startSec && t.endSec === r.endSec;
  });
}

/**
 * Clears the live token cache when it still holds the discarded record's tokens.
 * Leaves unrelated cached tokens intact (e.g. a separately completed live run).
 */
export function clearDiscardedTranscriptCache(
  project: Project,
  record: UnappliedTranscript,
): Project {
  if (!transcriptTokensMatchRecord(project.transcriptTokens, record)) return project;
  const next: Project = {
    ...project,
    transcriptTokens: undefined,
    lastTranscribedAssetId: undefined,
  };
  if (
    record.fileIdentity !== ''
    && project.lastTranscribedFileIdentity === record.fileIdentity
  ) {
    next.lastTranscribedFileIdentity = undefined;
  }
  return next;
}

/**
 * Puts the recovered transcript back into the live token cache so the ordinary
 * Apply Sync path can consume it, WITHOUT clearing the record.
 *
 * The non-clearing is the whole point and is not an oversight: if this also
 * cleared, a timeline write that subsequently aborted (an unreadable voiceover,
 * an empty scene doc — `App.tsx`'s `handleApplySyncFromFiles` has four such
 * abort paths) would have already destroyed the only durable copy. Clearing is
 * a separate call the caller makes only on a reported success.
 *
 * `lastTranscribedAssetId` is deliberately NOT restored from `record.assetId`:
 * that id belonged to a staging-time asset that no longer exists after a
 * reload, and writing it would make `App.tsx`'s `cachedTokensReady` compare
 * against a dangling id. `lastTranscribedFileIdentity` — the identity test that
 * actually survives — is restored, and only when the record carries one.
 */
export function restoreUnappliedTranscriptTokens(project: Project, record: UnappliedTranscript): Project {
  return {
    ...project,
    transcriptTokens: [...record.tokens],
    lastTranscribedFileIdentity: record.fileIdentity !== ''
      ? record.fileIdentity
      : project.lastTranscribedFileIdentity,
  };
}

/** What a recovery banner needs to know about the record it is offering. */
export type UnappliedTranscriptStaleness =
  /** The record's `fileIdentity` matches the identity the project last
   *  transcribed — the transcript describes the audio in hand. */
  | 'fresh'
  /** The record's `fileIdentity` disagrees with the project's — the user
   *  staged different audio after this transcript completed. */
  | 'stale'
  /** No comparison was possible: the record carries no identity, or the
   *  project carries none to compare against. */
  | 'unknown';

/**
 * Compares the record's file identity against the project's own.
 *
 * IDENTITY, NOT TIME. The comparison is the `getFileIdentity` string
 * (`name|size|lastModified`), the same notion `Project.lastTranscribedFileIdentity`
 * uses — never `completedAt` versus a save timestamp. A transcript is stale
 * because it describes DIFFERENT AUDIO, not because it is old; a month-old
 * transcript of the voiceover still in the project is perfectly applicable.
 *
 * A `'stale'` verdict DOWNGRADES THE BANNER, it does not discard the record.
 * Nothing in this feature ever destroys a transcript the user did not ask to
 * destroy — the user is told the audio appears to have changed and still gets
 * both buttons. Auto-discarding on a heuristic would reintroduce, in the
 * opposite direction, exactly the silent data loss this requirement exists to
 * close.
 */
export function unappliedTranscriptStaleness(
  project: Project,
  record: UnappliedTranscript,
): UnappliedTranscriptStaleness {
  const current = project.lastTranscribedFileIdentity;
  if (!record.fileIdentity || !current) return 'unknown';
  return record.fileIdentity === current ? 'fresh' : 'stale';
}

/** Convenience predicate — `'stale'` only, so an `'unknown'` never reads as stale. */
export function isUnappliedTranscriptStale(project: Project, record: UnappliedTranscript): boolean {
  return unappliedTranscriptStaleness(project, record) === 'stale';
}
