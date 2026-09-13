/**
 * Degraded-load model — props a future App.tsx can pass without this
 * slice knowing about IndexedDB, native copies, or autosave.
 *
 * A project can keep segment metadata after Chromium evicts media bytes
 * (`docs/ws3-export/persistence-layer-audit.md` at 01e565d). Opening that
 * project must not persist. `canPersistRecoveredProject` is the UI-side
 * gate: if any asset is unresolved, Save is not a legal affordance.
 */

export type SegmentResolutionStatus = 'resolved' | 'unresolved' | 'missing-asset';

export interface RecoverySegment {
  id: string;
  label: string;
  assetId: string | null;
  resolutionStatus: SegmentResolutionStatus;
}

/**
 * `nativeCopyExists`/`backupExists` (this module's original shape) modeled a
 * distinction that doesn't exist in the shipped architecture:
 * `assetRecovery.ts`'s `AssetRecoveryEntry` collapses both into one
 * `nativeResolved` — the native store IS the durable backing copy once the
 * IndexedDB cache is gone, there is no separate "backup" an asset could sit
 * in instead. An asset with EITHER a cache or native copy is `resolved`, full
 * stop; nothing about a native-vs-backup split is ever surfaced to the user
 * because there is nothing left for the user to choose between. `unresolved`
 * here is therefore exactly "neither copy exists" — the one state that still
 * needs a decision, and the only one this screen has anything to say about.
 */
export interface RecoveryAsset {
  id: string;
  name: string;
  unresolved: boolean;
}

export function canPersistRecoveredProject(input: {
  assets: readonly RecoveryAsset[];
  segments: readonly RecoverySegment[];
}): boolean {
  if (input.assets.some((asset) => asset.unresolved)) return false;
  if (input.segments.some((segment) => segment.resolutionStatus !== 'resolved')) return false;
  return true;
}

export function unresolvedAssetIds(assets: readonly RecoveryAsset[]): string[] {
  return assets.filter((asset) => asset.unresolved).map((asset) => asset.id);
}
