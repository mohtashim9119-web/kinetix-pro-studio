/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS3 item B — launch-time repair: "detects origin data missing while
 * native data survives and rebuilds rather than presenting empty projects."
 *
 * Called from App.tsx's `handleSwitchProject`, BEFORE the item-A orphan
 * check (`reportAssetResolutionFailure`/the load-failure poison) runs — this
 * is deliberately upstream of that guard, not a replacement for it. An asset
 * whose IndexedDB cache is gone but whose NATIVE copy survives is not data
 * loss at all; re-populating IndexedDB from the native store closes the gap
 * silently, and the orphan check downstream then simply has nothing to
 * complain about. Only an asset missing from BOTH stores is a genuine
 * load failure — that path is unchanged.
 */

import type { Asset } from '../types';
import { putAsset, type StoredAsset } from './assetStore';
import { getAssetStatusNative, readAssetNative, writeAssetNative } from './nativeAssetStore';
import { mediaVaultReadBlob } from './mediaVaultClient';
import { isTauri } from './tauriFfmpeg';
import { withAssetLoadTimeout } from './assetLoadTimeout';

export interface AssetRepairReport {
  /** Assets successfully re-populated into IndexedDB from the native store. */
  repaired: StoredAsset[];
  failed: { assetId: string; message: string }[];
}

/**
 * `assets` is the project's full `Project.assets` list (for name/type
 * fallback); `missingIds` is the subset whose bytes IndexedDB does not
 * currently have. Returns only what it actually repaired — the caller
 * merges these into its own blob map rather than re-reading IndexedDB.
 */
export async function repairMissingAssetsFromNative(
  projectId: string,
  assets: readonly Asset[],
  missingIds: readonly string[],
): Promise<AssetRepairReport> {
  const report: AssetRepairReport = { repaired: [], failed: [] };
  if (!isTauri() || missingIds.length === 0) return report;

  let status;
  try {
    status = await withAssetLoadTimeout(
      getAssetStatusNative(projectId, [...missingIds]),
      'getAssetStatusNative(repair)',
    );
  } catch (err) {
    console.warn(`[assetRepair] could not read native asset status for project ${projectId}:`, err);
    return report;
  }

  const byId = new Map(assets.map((a) => [a.id, a]));

  for (const entry of status) {
    if (!entry.bytesPresent) continue;
    const asset = byId.get(entry.assetId);
    if (!asset) continue;
    const mimeType = entry.mimeType ?? asset.file?.type ?? '';
    const name = entry.name ?? asset.name;
    try {
      const bytes = await withAssetLoadTimeout(
        readAssetNative(projectId, entry.assetId),
        `readAssetNative(${entry.assetId})`,
      );
      // `Uint8Array.buffer` may be a larger backing ArrayBuffer than the
      // view (rare, but possible depending on the IPC deserializer) — slice
      // to the view's own bounds so the Blob never carries extra bytes.
      const blob = new Blob([bytes.slice().buffer], { type: mimeType });
      await putAsset(projectId, entry.assetId, blob, { name, mimeType });
      report.repaired.push({ projectId, id: entry.assetId, blob, name, mimeType });
      console.info(
        `[assetRepair] rebuilt IndexedDB cache for asset ${entry.assetId} ("${name}", project ${projectId}) ` +
          `from its native copy — no data was lost, only the cache.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.failed.push({ assetId: entry.assetId, message });
      console.error(`[assetRepair] FAILED to rebuild asset ${entry.assetId} from its native copy: ${message}`);
    }
  }
  return report;
}

/**
 * Item A — the second repair rung, run after `repairMissingAssetsFromNative`
 * on whatever it could not fill: an asset missing from BOTH IndexedDB and the
 * per-project native store whose `contentHash` the media vault still holds.
 * That shape is real, not theoretical — an undone delete restores the row but
 * not the bytes the delete destroyed, and G6's ingest doors write only
 * IndexedDB + the vault. The vault bytes are written into the native store
 * (so the next open resolves at the first rung) and IndexedDB. A row with no
 * `contentHash`, or a hash the vault no longer has, is left for the ladder
 * and the offline path exactly as before.
 */
export async function repairMissingAssetsFromVault(
  projectId: string,
  assets: readonly Asset[],
  missingIds: readonly string[],
): Promise<AssetRepairReport> {
  const report: AssetRepairReport = { repaired: [], failed: [] };
  if (!isTauri() || missingIds.length === 0) return report;

  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const assetId of missingIds) {
    const asset = byId.get(assetId);
    if (!asset?.contentHash) continue;
    let bytes: Uint8Array | null;
    try {
      bytes = await withAssetLoadTimeout(mediaVaultReadBlob(asset.contentHash), `mediaVaultReadBlob(${assetId})`);
    } catch {
      continue; // the vault no longer has these bytes — not repairable here
    }
    if (!bytes) continue;
    const mimeType = asset.file?.type ?? '';
    try {
      await writeAssetNative(projectId, assetId, bytes, asset.name, mimeType);
      const blob = new Blob([bytes.slice().buffer], { type: mimeType });
      await putAsset(projectId, assetId, blob, { name: asset.name, mimeType });
      report.repaired.push({ projectId, id: assetId, blob, name: asset.name, mimeType });
      console.info(
        `[assetRepair] rebuilt asset ${assetId} ("${asset.name}", project ${projectId}) from the media vault ` +
          `(contentHash ${asset.contentHash}) — native store and IndexedDB were both missing it.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.failed.push({ assetId, message });
      console.error(`[assetRepair] FAILED to rebuild asset ${assetId} from the media vault: ${message}`);
    }
  }
  return report;
}
