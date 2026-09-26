/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * G6 Step 5 — lazy, non-blocking backfill of `Asset.contentHash` for
 * projects saved before the field existed (schema v5 and earlier; v6 adds
 * it as a purely additive, optional field — `assetId` stays the binding key
 * everywhere, this is enrichment only).
 *
 * Deliberately NOT a boot-time, whole-registry sweep like
 * `migrateAssetsToNative.ts` — that migration only ever writes bytes to a
 * SEPARATE native store, never touching `project.json`/`saveProject`, so a
 * background pass across every project at boot cannot race a live edit.
 * `contentHash` lives ON the project's own asset records, which App.tsx's
 * live `project` state and its autosave debounce already own; a background
 * `saveProject()` call for a project currently open in the UI would risk a
 * classic read-modify-write race (load fresh from disk, patch, save —
 * clobbering an in-flight live edit the autosave hasn't flushed yet).
 * Backfilling ONLY the currently-open project, through the app's own
 * `setProject` (so the result flows through the SAME autosave path as any
 * other edit), avoids that hazard entirely. A project that is never
 * reopened simply never gets backfilled — acceptable: nothing currently
 * reads `contentHash` as load-bearing, only as an enrichment (Media block
 * thumbnails, future dedup display).
 */

import { getAsset } from './assetStore';
import { sha256Hex } from './mediaIngest';
import type { Asset } from '../types';

/**
 * Returns a NEW array with `contentHash` filled in for every asset that was
 * missing it and whose bytes could be read — or the SAME array reference,
 * unchanged, when nothing needed backfilling (lets a caller skip a
 * pointless `setProject`/re-render via a cheap `=== ` check). Never throws:
 * an asset whose bytes cannot be read (missing/unresolved) is left with
 * `contentHash` still absent, to be retried the next time this project
 * opens — the same self-healing posture `migrateIndexedDbAssetsToNative`
 * already has for its own per-asset failures.
 */
export async function backfillAssetContentHashes(projectId: string, assets: Asset[]): Promise<Asset[]> {
  const missing = assets.filter(a => a.contentHash === undefined);
  if (missing.length === 0) return assets;

  const patches = new Map<string, string>();
  for (const asset of missing) {
    try {
      let bytes: Uint8Array;
      if (asset.file) {
        bytes = new Uint8Array(await asset.file.arrayBuffer());
      } else {
        const stored = await getAsset(projectId, asset.id);
        if (!stored?.blob) continue;
        bytes = new Uint8Array(await stored.blob.arrayBuffer());
      }
      patches.set(asset.id, await sha256Hex(bytes));
    } catch (err) {
      console.warn('[backfillAssetContentHashes] could not hash asset, will retry next open:', asset.id, err);
    }
  }
  if (patches.size === 0) return assets;

  return assets.map(a => (patches.has(a.id) ? { ...a, contentHash: patches.get(a.id) } : a));
}
