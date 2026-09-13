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

export interface RecoveryAsset {
  id: string;
  name: string;
  unresolved: boolean;
  nativeCopyExists: boolean;
  backupExists: boolean;
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
