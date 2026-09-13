/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS3 item B — client for the native asset store (`asset_store.rs`).
 *
 * Media bytes used to live ONLY in the WebView's IndexedDB (`assetStore.ts`,
 * `kinetix-assets`/`assets-v2`) — no native copy existed anywhere. That is
 * the second half of the Machine-1 incident's root cause: an IndexedDB/
 * origin loss was unrecoverable because nothing else HELD the bytes. This
 * module writes every asset natively too, under the storage root
 * (`storage_root.rs`), keyed by the same `(projectId, assetId)` pair
 * `assetStore.ts` already uses.
 *
 * CONTRACT — the opposite of `projectMirror.ts`'s. That module is a
 * best-effort SAFETY NET: a mirror write failure must never block a local
 * save. This module is the AUTHORITATIVE store: `writeAssetNative` throws
 * on any failure, and every caller MUST treat that as a failed import — see
 * `processMediaFile` in App.tsx, the one production call site. Silently
 * continuing with only the IndexedDB copy written is exactly the shape this
 * item exists to close: "loss of asset resolution must be treated as a load
 * failure, never as a legitimate edit" applies just as much to an asset that
 * was never durably written in the first place.
 *
 * Outside Tauri (plain `npm run dev`, no IPC bridge) every function is an
 * immediate no-op / empty result — the plain-browser-dev fallback has no
 * native store to write to, same posture `projectStore.ts` already has for
 * its own `isTauri()` branch.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';

/** Mirrors `asset_store.rs`'s `AssetStatusEntry` (camelCase over IPC). */
export interface AssetStatusEntry {
  assetId: string;
  bytesPresent: boolean;
  metaPresent: boolean;
  bytes: number | null;
  name: string | null;
  mimeType: string | null;
}

/**
 * Writes one asset's bytes natively. THROWS on any failure — callers must
 * not swallow this; see the module doc comment.
 */
export async function writeAssetNative(
  projectId: string,
  assetId: string,
  bytes: Uint8Array,
  name: string,
  mimeType: string,
): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('asset_store_write', bytes, {
    headers: {
      'project-id': projectId,
      'asset-id': assetId,
      name,
      'mime-type': mimeType,
    },
  });
}

/** Convenience wrapper: writes a `Blob`/`File`'s bytes natively. Throws — see `writeAssetNative`. */
export async function writeAssetBlobNative(
  projectId: string,
  assetId: string,
  blob: Blob,
  name: string,
  mimeType: string,
): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return writeAssetNative(projectId, assetId, bytes, name, mimeType);
}

/** Reads one asset's bytes back from the native store. Throws if missing or unreadable. */
export async function readAssetNative(projectId: string, assetId: string): Promise<Uint8Array> {
  if (!isTauri()) throw new Error('readAssetNative: no native store outside Tauri');
  const bytes = await invoke<number[]>('asset_store_read', { projectId, assetId });
  return new Uint8Array(bytes);
}

/**
 * Per-asset resolution status for every id in `assetIds` — the recovery
 * screen's primary data source (see `assetRecovery.ts`). Outside Tauri,
 * every id reports as absent (there is no native store to have anything).
 */
export async function getAssetStatusNative(projectId: string, assetIds: string[]): Promise<AssetStatusEntry[]> {
  if (!isTauri() || assetIds.length === 0) {
    return assetIds.map((assetId) => ({
      assetId, bytesPresent: false, metaPresent: false, bytes: null, name: null, mimeType: null,
    }));
  }
  return invoke<AssetStatusEntry[]>('asset_store_status', { projectId, assetIds });
}

/** Best-effort delete of one asset's native copy. Never throws — mirrors `assetStore.ts::deleteAsset`'s posture for its own store. */
export async function deleteAssetNative(projectId: string, assetId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke<void>('asset_store_delete', { projectId, assetId });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[nativeAssetStore] delete failed for ${projectId}/${assetId} (non-fatal):`, err);
  }
}

/** Best-effort delete of a whole project's native asset directory. */
export async function deleteProjectAssetsNative(projectId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke<void>('asset_store_delete_project', { projectId });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[nativeAssetStore] delete-project failed for ${projectId} (non-fatal):`, err);
  }
}
