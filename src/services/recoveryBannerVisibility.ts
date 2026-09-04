/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.7 Requirement 3 — recovery banner visibility (Defect A).
//
// The banner answers "you have an unspent transcript from a PRIOR session."
// It must NOT appear when `unappliedTranscript` is written during the live
// transcription that just finished — only when that field was already present
// at project open (hydration / switch / reload).
//
// `armed` is session state re-derived on every project load from persistence:
// opening a project that carries `unappliedTranscript` sets armed=true, so a
// reload still shows the banner even though armed lives in memory for the
// remainder of that session.
// ---------------------------------------------------------------------------

/** Arm the banner when a persisted project open finds an unspent record. */
export function armRecoveryBannerFromPersistedProject(hasUnappliedRecord: boolean): boolean {
  return hasUnappliedRecord;
}

/** Render gate: armed at open AND the record is still present. */
export function shouldShowRecoveryBanner(armed: boolean, hasUnappliedRecord: boolean): boolean {
  return armed && hasUnappliedRecord;
}

/** Live transcription completion must never arm the banner in-session. */
export function recoveryBannerArmedAfterLiveCompletion(_currentArmed: boolean): boolean {
  return false;
}
