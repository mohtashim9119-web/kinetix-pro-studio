/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// One project's full delete — the record, its assets, waveforms, staged slots,
// native bytes and media-vault references. Shared by the dashboard's delete and
// the bulk drawer's per-row delete, so both remove exactly the same things.
// Each step is independent and bounded: one that throws or hangs must never
// keep the project record alive (that was how deleted projects came back).

import { loadProject, deleteProjectData } from './projectStore';
import { deleteAllStagedForProject } from './stagedFilesStore';
import { deleteAllAssets } from './assetStore';
import { deleteProjectAssetsNativeStrict } from './nativeAssetStore';
import { deleteAllWaveforms } from './waveformStore';
import { mediaVaultUnreference, mediaVaultUnreferenceProject } from './mediaVaultClient';

/** Deletes one project everywhere. Returns the steps that failed (`id: label: why`). */
export async function deleteProjectEverywhere(id: string, timeoutMs = 10_000): Promise<string[]> {
  const failures: string[] = [];
  const step = async (label: string, work: () => Promise<unknown>): Promise<void> => {
    try {
      await Promise.race([
        work(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), timeoutMs)),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${id}: ${label}: ${message}`);
      console.error(`[projectDelete] ${label} FAILED for deleted project ${id}:`, message);
    }
  };
  // G6 Step 6 — read the project's assets BEFORE any deletion, so the
  // media-vault reference it holds on each contentHash can be dropped.
  const loaded = await loadProject(id).catch(() => null);
  const contentHashes = new Set(
    (loaded?.project.assets ?? []).map(a => a.contentHash).filter((h): h is string => !!h),
  );
  // The record and registry entry FIRST: this is what "deleted" means to the user.
  await step('project record removal', () => deleteProjectData(id));
  await step('asset cleanup', () => deleteAllAssets(id));
  await step('waveform cleanup', () => deleteAllWaveforms(id));
  // WS2-50 — a deleted project's staged slots go with it.
  await step('staged files cleanup', () => deleteAllStagedForProject(id));
  await step('native asset cleanup', () => deleteProjectAssetsNativeStrict(id));
  await step('media vault cleanup', () => Promise.all(Array.from(contentHashes, hash => mediaVaultUnreference(hash, id))));
  // Then everything else the vault still credits to this id (refs the record never listed).
  await step('media vault cleanup (all refs)', () => mediaVaultUnreferenceProject(id));
  return failures;
}
