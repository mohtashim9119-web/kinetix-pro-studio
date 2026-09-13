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
import { getAssetStatusNative, readAssetNative } from './nativeAssetStore';
import { isTauri } from './tauriFfmpeg';

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
    status = await getAssetStatusNative(projectId, [...missingIds]);
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
      const bytes = await readAssetNative(projectId, entry.assetId);
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
