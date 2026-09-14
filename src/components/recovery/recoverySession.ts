/**
 * Recovery-screen session lifecycle — pure contract for what "close" means.
 *
 * Closing the degraded-project recovery screen must write NOTHING: the
 * project stays poisoned, project.json is untouched, and any in-flight
 * folder-pick session is discarded rather than partially applied. App.tsx
 * implements this by calling only these side effects — never saveProject,
 * clearLoadFailure, relinkAsset, or writeAssetFromPath.
 */

export interface RecoveryCloseEffects {
  /** Clear the recovery screen from the UI (return to dashboard). */
  clearRecoveryUi: () => void;
  /** Discard an in-flight folder-pick session without writing bytes. */
  clearFolderRelink: () => void;
}

/** The only legal close path — UI state only, zero storage mutation. */
export function performRecoveryClose(effects: RecoveryCloseEffects): void {
  effects.clearFolderRelink();
  effects.clearRecoveryUi();
}
