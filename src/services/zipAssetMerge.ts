import type { Asset } from '../types';
import { deleteAsset } from './assetStore';

/** Outcome of merging one zip archive's extracted assets into a project. */
export interface ZipMergeResult {
  /** Survivors, in extraction order — the caller appends these to its own list. */
  kept: Asset[];
  /**
   * Id of the LAST audio survivor, or `undefined` when no audio survived.
   * A dropped duplicate never appears here: an id that names no row in
   * `project.assets` must not become `project.voiceoverId`.
   */
  audioAssetId?: string;
}

/**
 * Merges one zip archive's extracted assets into a project, deduplicating by
 * filename against `existing` AND against earlier survivors of this same
 * archive (two files with the same basename in different archive directories
 * collapse to one).
 *
 * `extracted` arrives already written to IndexedDB — `extractZipToAssets`
 * persists every file it reads before any dedup decision is made. So dropping
 * a duplicate from the asset list is only half of it: the row it already wrote
 * has to go too, or each deduplicated import leaves a blob behind that nothing
 * will ever reference or reclaim.
 *
 * Deleting it is safe precisely because the id was minted inside
 * `extractZipToAssets` and never escapes this merge: a dropped asset is never
 * pushed to `project.assets`, never reaches an undo-history snapshot, and —
 * per `audioAssetId` above — never becomes `voiceoverId`. The delete therefore
 * can only remove the row this same import just created, never a pre-existing
 * one.
 */
export async function mergeExtractedZipAssets(
  projectId: string,
  existing: readonly Asset[],
  extracted: readonly Asset[],
): Promise<ZipMergeResult> {
  const takenNames = new Set(existing.map(a => a.name));
  const kept: Asset[] = [];
  let audioAssetId: string | undefined;

  for (const asset of extracted) {
    if (takenNames.has(asset.name)) {
      URL.revokeObjectURL(asset.url);
      await deleteAsset(projectId, asset.id).catch(err =>
        console.error('[kinetix] Failed to delete deduplicated zip asset from IndexedDB:', err),
      );
      continue;
    }
    takenNames.add(asset.name);
    kept.push(asset);
    if (asset.type === 'audio') audioAssetId = asset.id;
  }

  return { kept, audioAssetId };
}
