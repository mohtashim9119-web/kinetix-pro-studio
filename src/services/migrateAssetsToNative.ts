/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS3 item B — one-time (in effect: idempotent every-boot) migration of
 * existing installs' IndexedDB-only asset bytes onto the native store.
 *
 * Deliberately idempotent rather than gated by a "migration done" flag —
 * same shape `migrateLocalStorageProjectsToOsStore` (`projectStore.ts`)
 * already uses for the analogous project-body migration: every asset is
 * checked against the native store's OWN status before writing, so running
 * this on every boot is cheap once the backlog is cleared (a no-op scan),
 * and — unlike a one-shot flag — it is also self-healing if a previous
 * attempt was interrupted partway (app quit mid-migration, a transient
 * write failure) rather than leaving the gap permanently unfixed because the
 * flag already says "done".
 *
 * Fire-and-forget from the caller's perspective: this can move real media
 * bytes (potentially gigabytes across a library), so it must never block
 * app startup. Failures are per-asset and non-fatal to the scan — one
 * unwritable asset does not stop the rest of the library from migrating —
 * but are NOT silently dropped either: the report lists them, and the
 * console logs a summary so a stalled migration is visible in the field.
 */

import { getAllAssetsForProject } from './assetStore';
import { loadAllMetas } from './projectStore';
import { getAssetStatusNative, writeAssetBlobNative } from './nativeAssetStore';
import { isTauri } from './tauriFfmpeg';

export interface AssetMigrationReport {
  migrated: { projectId: string; assetId: string }[];
  failed: { projectId: string; assetId: string; message: string }[];
}

export async function migrateIndexedDbAssetsToNative(): Promise<AssetMigrationReport> {
  const report: AssetMigrationReport = { migrated: [], failed: [] };
  if (!isTauri()) return report;

  for (const meta of loadAllMetas()) {
    let stored;
    try {
      stored = await getAllAssetsForProject(meta.id);
    } catch (err) {
      console.warn(`[assetMigration] could not read IndexedDB assets for project ${meta.id}:`, err);
      continue;
    }
    if (stored.length === 0) continue;

    let status;
    try {
      status = await getAssetStatusNative(meta.id, stored.map((a) => a.id));
    } catch (err) {
      console.warn(`[assetMigration] could not read native asset status for project ${meta.id}:`, err);
      continue;
    }
    const alreadyNative = new Set(status.filter((s) => s.bytesPresent).map((s) => s.assetId));

    for (const asset of stored) {
      if (alreadyNative.has(asset.id)) continue;
      try {
        await writeAssetBlobNative(meta.id, asset.id, asset.blob, asset.name, asset.mimeType);
        report.migrated.push({ projectId: meta.id, assetId: asset.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report.failed.push({ projectId: meta.id, assetId: asset.id, message });
        console.error(
          `[assetMigration] FAILED writing asset ${asset.id} (project ${meta.id}) to the native store — ` +
            `it stays IndexedDB-only for now: ${message}`,
        );
      }
    }
  }

  if (report.migrated.length > 0 || report.failed.length > 0) {
    console.info(
      `[assetMigration] migrated ${report.migrated.length} asset(s) to the native store` +
        (report.failed.length > 0 ? `, ${report.failed.length} failed (will retry next launch)` : ''),
    );
  }
  return report;
}
