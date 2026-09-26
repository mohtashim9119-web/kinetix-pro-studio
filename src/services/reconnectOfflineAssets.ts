/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Media workflow Unit 4 — re-upload auto-resolves offline media. An ingest
 * door that sees an OFFLINE asset's exact bytes (`contentHash`) hands them
 * back as an `OfflineReconnect` instead of importing a duplicate; this writes
 * them into that asset's OWN slot through the existing relink machinery
 * (`relinkAsset`: native + IndexedDB, and the load-failure poison clears
 * itself once every asset in the project resolves). The asset id, its
 * metadata and every scene pointing at it stay exactly as they are.
 */

import type { Asset } from '../types';
import type { OfflineReconnect } from './mediaIngest';
import { relinkAsset } from './assetRecovery';

export interface OfflineReconnectResult {
  reconnected: { assetId: string; name: string; file: File }[];
  failed: { assetId: string; message: string }[];
  /** The last relink's whole-project answer (false when nothing ran). */
  allResolved: boolean;
}

export async function reconnectOfflineAssets(
  projectId: string,
  assets: readonly Asset[],
  candidates: readonly OfflineReconnect[],
): Promise<OfflineReconnectResult> {
  const result: OfflineReconnectResult = { reconnected: [], failed: [], allResolved: false };
  for (const { contentHash, file } of candidates) {
    for (const asset of assets) {
      if (!asset.unresolved || asset.contentHash !== contentHash) continue;
      const outcome = await relinkAsset(projectId, asset.id, file);
      if (outcome.ok) {
        result.reconnected.push({ assetId: asset.id, name: asset.name, file });
        result.allResolved = outcome.status?.allResolved ?? false;
      } else {
        result.failed.push({ assetId: asset.id, message: outcome.message ?? 'unknown error' });
      }
    }
  }
  return result;
}
