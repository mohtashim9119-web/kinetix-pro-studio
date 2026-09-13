/**
 * Map CC's published project/asset rows onto the pure re-link descriptors.
 * No Tauri, no store writes — the host still owns `relinkAsset`.
 */

import type { Asset } from '../../types';
import type { AssetRecoveryEntry } from '../assetRecovery';
import type { UnresolvedAssetMetadata } from './types';

export function unresolvedMetadataFromAssets(
  assets: readonly Asset[],
  recoveryRows: readonly AssetRecoveryEntry[],
): UnresolvedAssetMetadata[] {
  const unresolved = new Set(
    recoveryRows.filter((row) => !row.resolved).map((row) => row.assetId),
  );
  return assets
    .filter((asset) => unresolved.has(asset.id))
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      duration: typeof asset.duration === 'number' ? asset.duration : null,
    }));
}
