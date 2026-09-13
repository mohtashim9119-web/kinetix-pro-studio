/**
 * Folder-pick session selection — the one place the "no non-exact match is
 * auto-accepted" invariant is enforced for the folder-pick flow.
 *
 * The matcher (`proposeRelinkMatches`) ranks every candidate per asset and
 * sorts each asset's list best-first. `defaultFolderSelection` walks that
 * ranked list and pre-selects ONLY an asset's top proposal when it is
 * `confidence === 'exact'`. A `probable` top proposal — same name but a
 * duration only within probable tolerance, or a similar name — is left
 * UNSELECTED: the user must explicitly toggle it. A `rejected` proposal is
 * never selectable through auto-selection.
 *
 * This is the difference between "the folder pick proposed 40 exact matches
 * and the user clicks Write once" (usable) and "the folder pick silently
 * wrote 40 probable guesses" (the exact shape the invariant forbids).
 */

import type { RelinkProposal } from './types';

export type FolderSelection = Record<string, string | null>;

/**
 * Pre-select an asset's top-ranked proposal ONLY when it is `exact`. The
 * matcher sorts each asset's proposals best-first, so `proposalsForAsset`
 * is not needed here — the first non-rejected proposal for an asset is its
 * best, and we additionally require `exact`.
 */
export function defaultFolderSelection(proposals: readonly RelinkProposal[]): FolderSelection {
  const selection: FolderSelection = {};
  for (const proposal of proposals) {
    const current = selection[proposal.assetId];
    // Keep the first proposal seen for an asset (matcher sorts best-first).
    if (current !== undefined) continue;
    selection[proposal.assetId] = proposal.confidence === 'exact' ? proposal.candidateId : null;
  }
  return selection;
}

/** Toggle a candidate on/off for an asset. Selecting a probable match here is
 *  the explicit user action that lifts it past the auto-accept gate. */
export function toggleFolderSelection(
  selection: FolderSelection,
  assetId: string,
  candidateId: string,
): FolderSelection {
  const next: FolderSelection = { ...selection };
  next[assetId] = selection[assetId] === candidateId ? null : candidateId;
  return next;
}

/** The (assetId, candidateId) pairs the user has accepted for writing. */
export function selectedFolderWrites(
  selection: FolderSelection,
): Array<{ assetId: string; candidateId: string }> {
  const out: Array<{ assetId: string; candidateId: string }> = [];
  for (const [assetId, candidateId] of Object.entries(selection)) {
    if (candidateId !== null) out.push({ assetId, candidateId });
  }
  return out;
}
