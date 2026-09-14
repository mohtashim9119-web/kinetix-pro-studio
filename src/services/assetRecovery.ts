/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS3 item B addition — the data source and re-link command Cursor's
 * recovery screen (`ws3-recovery-ui`) needs. This module does NOT mount any
 * UI; it exposes the data and one command, documented here so the wiring on
 * the UI side is mechanical (see each exported type's own doc comment for
 * the exact shape).
 *
 * WHY A PROJECT CAN BE INSPECTED HERE EVEN THOUGH IT WON'T OPEN. Item A's
 * Guard 2 poisons a project (`loadFailures`, `reportAssetResolutionFailure`)
 * and `App.tsx`'s `handleSwitchProject` refuses to open it — deliberately,
 * so nothing can autosave a degraded copy over it. But `loadProjectDetailed`
 * itself has no opinion about asset resolution (that check lives entirely in
 * `handleSwitchProject`), so it still returns the project's JSON — including
 * its `assets` array — for a poisoned project exactly as it would for a
 * healthy one. That is what makes this module possible without touching
 * live app state at all: it reads the stored project directly, the same way
 * the (still poisoned) project itself would be read if it opened.
 *
 * RE-LINK IS THE SUPPORTED RECOVERY for the Machine-1 class of loss: an
 * asset that is unresolvable in BOTH IndexedDB and the native store (item
 * B's authoritative copy) has lost its only cached/durable bytes, but the
 * user's ORIGINAL SOURCE FILE — wherever it lives on their own filesystem —
 * was never touched. `relinkAsset` re-supplies those bytes into the SAME
 * asset id's native (and cache) slot; nothing in `project.json` changes,
 * because nothing about the logical asset changed, only where its bytes
 * live again.
 */

import type { Asset, Project } from '../types';
import { getAllAssetsForProject, putAsset } from './assetStore';
import { getAssetStatusNative, writeAssetBlobNative } from './nativeAssetStore';
import { loadProjectDetailed, getLoadFailure, clearLoadFailure, type LoadFailure } from './projectStore';
import { withAssetLoadTimeout, ASSET_LOAD_TIMEOUT_MS } from './assetLoadTimeout';

/** One row of the recovery screen's asset list. */
export interface AssetRecoveryEntry {
  assetId: string;
  /** From the project's own stored metadata — present even when unresolved. */
  name: string;
  type: Asset['type'];
  /** Present in the IndexedDB cache right now. */
  cacheResolved: boolean;
  /**
   * Present in the native store — item B's authoritative, durable copy. The
   * user's own phrasing for this in the wild is "a native copy or backup" —
   * in this architecture those are the same fact: the native store IS the
   * durable backing copy once the IndexedDB cache is lost, there is no
   * separate "backup" concept for asset bytes distinct from it.
   */
  nativeResolved: boolean;
  /** `cacheResolved || nativeResolved`. An asset needing NO recovery action. */
  resolved: boolean;
}

/** The recovery screen's whole-project payload. */
export interface ProjectAssetRecoveryStatus {
  projectId: string;
  projectName: string;
  /**
   * The load failure that made this project unopenable, if any (item A's
   * Guard 2). `null` for a project that opens fine — the recovery screen
   * can still be shown for such a project (nothing wrong), just with
   * `allResolved: true` and nothing to do.
   */
  loadFailure: LoadFailure | null;
  assets: AssetRecoveryEntry[];
  /** `assets.every(a => a.resolved)`. When true, the project is safe to reopen. */
  allResolved: boolean;
}

/**
 * Reads a project's stored data directly (bypassing `handleSwitchProject`)
 * and reports per-asset resolution status. Returns `null` only when the
 * project's OWN JSON cannot be read at all (a genuinely different failure
 * class from asset loss — `loadFailure` on the returned object is how an
 * asset-loss poisoning is reported instead).
 */
export async function getProjectAssetRecoveryStatus(projectId: string): Promise<ProjectAssetRecoveryStatus | null> {
  const outcome = await loadProjectDetailed(projectId);
  if (!outcome || !outcome.ok) return null;

  const project: Project = outcome.project;
  const assetIds = project.assets.map((a) => a.id);

  // One IndexedDB read per project — NOT one `getAsset` open per id. The old
  // N-parallel-get pattern hung WKWebView indefinitely on large libraries
  // (900+ assets) and never reached the recovery screen.
  const [storedAssets, nativeEntries] = await Promise.all([
    withAssetLoadTimeout(getAllAssetsForProject(projectId), 'getAllAssetsForProject').catch((err) => {
      console.warn(`[assetRecovery] cache read failed for project ${projectId}:`, err);
      return [];
    }),
    withAssetLoadTimeout(getAssetStatusNative(projectId, assetIds), 'getAssetStatusNative').catch((err) => {
      console.warn(`[assetRecovery] native status read failed for project ${projectId}:`, err);
      return assetIds.map((assetId) => ({
        assetId,
        bytesPresent: false,
        metaPresent: false,
        bytes: null,
        name: null,
        mimeType: null,
      }));
    }),
  ]);
  const cacheById = new Map(storedAssets.map((a) => [a.id, true]));
  const nativeById = new Map(nativeEntries.map((e) => [e.assetId, e.bytesPresent]));

  const assets: AssetRecoveryEntry[] = project.assets.map((a) => {
    const cacheResolved = cacheById.get(a.id) ?? false;
    const nativeResolved = nativeById.get(a.id) ?? false;
    return { assetId: a.id, name: a.name, type: a.type, cacheResolved, nativeResolved, resolved: cacheResolved || nativeResolved };
  });

  return {
    projectId,
    projectName: project.name,
    loadFailure: getLoadFailure(projectId) ?? null,
    assets,
    allResolved: assets.every((a) => a.resolved),
  };
}

export interface RelinkOutcome {
  ok: boolean;
  /** Populated on `ok: false` — never swallowed, surfaced to the recovery UI verbatim. */
  message?: string;
  /** The recomputed whole-project status after this asset's re-link. */
  status: ProjectAssetRecoveryStatus | null;
}

/**
 * Writes `file`'s bytes into `assetId`'s native (and IndexedDB cache) slot
 * for `projectId` — the supported recovery action for an asset the user's
 * own source file survived. `project.json` is not touched: the asset id,
 * its `name`/`type` metadata, and every segment's `assetId` pointer stay
 * exactly as they are.
 *
 * If this re-link makes EVERY asset in the project resolved, the project's
 * load-failure poison (item A's Guard 2) is cleared automatically — the
 * user does not need a separate "I'm done" action. Until then the project
 * stays poisoned and un-openable, same as before this call: a PARTIAL
 * re-link must never look like a resolved project.
 */
export async function relinkAsset(projectId: string, assetId: string, file: File): Promise<RelinkOutcome> {
  try {
    await writeAssetBlobNative(projectId, assetId, file, file.name, file.type);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[assetRecovery] re-link write failed for asset ${assetId} (project ${projectId}):`, message);
    return { ok: false, message, status: await getProjectAssetRecoveryStatus(projectId) };
  }

  // Best-effort cache repopulation — the native write above is what matters
  // for durability; a cache-write failure here does not fail the re-link.
  try {
    await putAsset(projectId, assetId, file, { name: file.name, mimeType: file.type });
  } catch (err) {
    console.warn(`[assetRecovery] re-link succeeded natively but IndexedDB cache write failed (non-fatal):`, err);
  }

  const status = await getProjectAssetRecoveryStatus(projectId);
  if (status?.allResolved) {
    clearLoadFailure(projectId);
  }
  return { ok: true, status };
}
