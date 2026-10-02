/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// One project's full delete — the record, its assets, waveforms, staged slots,
// native bytes and media-vault references. Shared by the dashboard's delete and
// the bulk drawer's per-row delete, so both remove exactly the same things.
// Each step is independent and bounded: one that throws or hangs must never
// keep the project record alive (that was how deleted projects came back).

import { commitTombstones, deletedProjectIds, deleteProjectData } from './projectStore';
import { deleteAllStagedForProject } from './stagedFilesStore';
import { deleteAllAssets } from './assetStore';
import { deleteProjectAssetsNativeStrict } from './nativeAssetStore';
import { deleteAllWaveforms } from './waveformStore';
import { mediaVaultUnreferenceProject } from './mediaVaultClient';

async function bounded(id: string, label: string, work: () => Promise<unknown>, timeoutMs: number): Promise<string | null> {
  try {
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), timeoutMs)),
    ]);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[projectDelete] ${label} FAILED for deleted project ${id}:`, message);
    return `${id}: ${label}: ${message}`;
  }
}

/** Store + dashboard + mirror for a whole confirm set — one tombstone write. */
export async function deleteProjectRecords(ids: readonly string[], timeoutMs = 10_000): Promise<string[]> {
  await commitTombstones(ids);
  const failures = await Promise.all(
    ids.map(id => bounded(id, 'project record removal', () => deleteProjectData(id), timeoutMs)),
  );
  return failures.filter((f): f is string => f !== null);
}

/**
 * Vault / IndexedDB / native bytes. Must not recreate a record, ref, or list
 * entry for a tombstoned id — unreference drops refs only.
 */
export async function cleanupDeletedProjectAssets(id: string, timeoutMs = 10_000): Promise<string[]> {
  if (!deletedProjectIds().has(id)) return [];
  const failures = await Promise.all([
    bounded(id, 'asset cleanup', () => deleteAllAssets(id), timeoutMs),
    bounded(id, 'waveform cleanup', () => deleteAllWaveforms(id), timeoutMs),
    bounded(id, 'staged files cleanup', () => deleteAllStagedForProject(id), timeoutMs),
    bounded(id, 'native asset cleanup', () => deleteProjectAssetsNativeStrict(id), timeoutMs),
    bounded(id, 'media vault cleanup', () => mediaVaultUnreferenceProject(id), timeoutMs),
  ]);
  return failures.filter((f): f is string => f !== null);
}

/** Deletes one project everywhere. Returns the steps that failed (`id: label: why`). */
export async function deleteProjectEverywhere(id: string, timeoutMs = 10_000): Promise<string[]> {
  const recordFailures = await deleteProjectRecords([id], timeoutMs);
  const assetFailures = await cleanupDeletedProjectAssets(id, timeoutMs);
  return [...recordFailures, ...assetFailures];
}
