/**
 * Round 27 Step 4 — provenance resolution ladder policy (pure TS).
 *
 * Filesystem probing lives in Rust (`asset_store_attempt_resolution`); this
 * module holds the routing rules the frontend applies to its results and the
 * three asset populations the round must prove in tests.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';
import { writeAssetFromPath } from './nativeAssetStore';
import { putAsset } from './assetStore';
import { readAssetNative } from './nativeAssetStore';
import type { Asset } from '../types';
import { withAssetLoadTimeout } from './assetLoadTimeout';

export type ResolutionRung =
  | 'exact_path'
  | 'same_folder_filename'
  | 'user_root_filename'
  | 'content_hash'
  | 'none';

export type ResolutionConfidence = 'exact' | 'probable' | 'none';

export interface AssetProvenanceStatus {
  originalPath: string | null;
  containingFolder: string | null;
  contentHash: string | null;
  duration: number | null;
}

export interface AssetResolutionResult {
  assetId: string;
  rung: ResolutionRung;
  confidence: ResolutionConfidence;
  silent: boolean;
  candidatePath: string | null;
  reason: string | null;
}

/** True when provenance is absent — MUST route to folder-pick, never silent. */
export function isPreProvenance(provenance: AssetProvenanceStatus | null | undefined): boolean {
  return !provenance?.originalPath;
}

/** True when Step 2 folder-pick wrote path/folder but left hash for Step 4. */
export function isPartialProvenance(provenance: AssetProvenanceStatus | null | undefined): boolean {
  if (!provenance?.originalPath) return false;
  return !provenance.contentHash;
}

export function requiresConfirmation(result: AssetResolutionResult): boolean {
  return !result.silent && result.candidatePath !== null;
}

export function routesToFolderPick(result: AssetResolutionResult): boolean {
  return result.rung === 'none' && !result.silent;
}

export async function attemptAssetResolution(
  projectId: string,
  assetId: string,
  userPickedRoot?: string | null,
): Promise<AssetResolutionResult | null> {
  if (!isTauri()) return null;
  return invoke<AssetResolutionResult>('asset_store_attempt_resolution', {
    projectId,
    assetId,
    userPickedRoot: userPickedRoot ?? null,
  });
}

export interface SilentResolutionReport {
  resolved: string[];
  needsConfirmation: AssetResolutionResult[];
  folderPickOnly: string[];
}

/**
 * On project open: silently re-import assets whose exact path + size + hash
 * match; everything weaker is returned for the recovery screen.
 */
export async function applySilentProvenanceResolution(
  projectId: string,
  assets: readonly Asset[],
  missingIds: readonly string[],
): Promise<SilentResolutionReport> {
  const report: SilentResolutionReport = { resolved: [], needsConfirmation: [], folderPickOnly: [] };
  if (!isTauri() || missingIds.length === 0) return report;

  const byId = new Map(assets.map((a) => [a.id, a]));

  for (const assetId of missingIds) {
    const result = await attemptAssetResolution(projectId, assetId);
    if (!result) continue;

    if (result.silent && result.candidatePath) {
      const asset = byId.get(assetId);
      if (!asset) continue;
      const mimeType = asset.file?.type ?? 'application/octet-stream';
      await writeAssetFromPath(
        projectId,
        assetId,
        result.candidatePath,
        asset.name,
        mimeType,
        asset.duration ?? null,
      );
      const bytes = await withAssetLoadTimeout(readAssetNative(projectId, assetId), `readAssetNative(${assetId})`);
      const blob = new Blob([bytes.slice().buffer], { type: mimeType });
      await putAsset(projectId, assetId, blob, { name: asset.name, mimeType });
      report.resolved.push(assetId);
    } else if (routesToFolderPick(result)) {
      report.folderPickOnly.push(assetId);
    } else if (requiresConfirmation(result)) {
      report.needsConfirmation.push(result);
    }
  }

  return report;
}
