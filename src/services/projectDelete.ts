/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// One project's full delete — the record, its assets, waveforms, staged slots,
// native bytes and media-vault references. Shared by the dashboard's delete and
// the bulk drawer's per-row delete, so both remove exactly the same things.
// Each step is independent and bounded: one that throws or hangs must never
// keep the project record alive (that was how deleted projects came back).

import { deleteProjectData } from './projectStore';
import { deleteAllStagedForProject } from './stagedFilesStore';
import { deleteAllAssets } from './assetStore';
import { deleteProjectAssetsNativeStrict } from './nativeAssetStore';
import { deleteAllWaveforms } from './waveformStore';
import { mediaVaultUnreferenceProject } from './mediaVaultClient';

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
  // Record first so the grid can drop the card without waiting on vault I/O.
  await step('project record removal', () => deleteProjectData(id));
  // One vault registry mutation (unreference every hash this id holds) — never
  // N per-asset IPC writes. IndexedDB + native cleanup run beside it.
  await Promise.all([
    step('asset cleanup', () => deleteAllAssets(id)),
    step('waveform cleanup', () => deleteAllWaveforms(id)),
    step('staged files cleanup', () => deleteAllStagedForProject(id)),
    step('native asset cleanup', () => deleteProjectAssetsNativeStrict(id)),
    step('media vault cleanup', () => mediaVaultUnreferenceProject(id)),
  ]);
  return failures;
}
