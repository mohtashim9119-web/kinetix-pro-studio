/**
 * Degraded-load model — props a future App.tsx can pass without this
 * slice writing IndexedDB, the native store, or autosave.
 *
 * Shape is CC's published `AssetRecoveryEntry`: one `nativeResolved` fact
 * (the native store IS the durable copy; there is no separate backup flag).
 * `resolved` is `cacheResolved || nativeResolved`. Saving stays illegal
 * while any asset is short of that.
 */

import type { AssetRecoveryEntry, ProjectAssetRecoveryStatus } from '../../services/assetRecovery';

export type SegmentResolutionStatus = 'resolved' | 'unresolved' | 'missing-asset';

export interface RecoverySegment {
  id: string;
  label: string;
  assetId: string | null;
  resolutionStatus: SegmentResolutionStatus;
}

export type RecoveryAsset = AssetRecoveryEntry;

export function recoveryAssetsFromStatus(
  status: ProjectAssetRecoveryStatus,
): RecoveryAsset[] {
  return status.assets.map((entry) => ({
    assetId: entry.assetId,
    name: entry.name,
    type: entry.type,
    cacheResolved: entry.cacheResolved,
    nativeResolved: entry.nativeResolved,
    resolved: entry.resolved,
  }));
}

export function canPersistRecoveredProject(input: {
  assets: readonly RecoveryAsset[];
  segments: readonly RecoverySegment[];
}): boolean {
  if (input.assets.some((asset) => !asset.resolved)) return false;
  if (input.segments.some((segment) => segment.resolutionStatus !== 'resolved')) return false;
  return true;
}

export function unresolvedAssetIds(assets: readonly RecoveryAsset[]): string[] {
  return assets.filter((asset) => !asset.resolved).map((asset) => asset.assetId);
}
