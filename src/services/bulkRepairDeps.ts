/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The app's real stores behind `bulkRepair.ts` — kept apart so the guard
// itself stays a pure, injectable unit.

import type { BulkRepairDeps } from './bulkRepair';
import { loadProject, saveProject } from './projectStore';
import { getStagedFilesForProject } from './stagedFilesStore';
import { restoreStagedFiles } from './stagedFilesPersist';
import { computeAudioHash, computeScriptHash } from './spine';
import { stripRtfIfNeeded } from './textUtils';
import { deleteAsset } from './assetStore';
import { deleteAssetNative } from './nativeAssetStore';
import { mediaVaultUnreference } from './mediaVaultClient';

export function defaultBulkRepairDeps(): BulkRepairDeps {
  return {
    load: async id => (await loadProject(id))?.project ?? null,
    loadStaged: async id => {
      const rows = await getStagedFilesForProject(id);
      return rows.length > 0 ? restoreStagedFiles(rows) : null;
    },
    readText: async file => stripRtfIfNeeded(await file.text()),
    hashAudio: computeAudioHash,
    hashScript: computeScriptHash,
    // Emptying is the point: the record goes back to its pre-build state.
    save: project => saveProject(project, { allowEmptying: true }),
    dropAsset: async (projectId, asset, keepHashes) => {
      await deleteAsset(projectId, asset.id).catch(() => undefined);
      await deleteAssetNative(projectId, asset.id).catch(() => undefined);
      if (asset.contentHash && !keepHashes.has(asset.contentHash)) {
        await mediaVaultUnreference(asset.contentHash, projectId).catch(() => undefined);
      }
    },
  };
}
