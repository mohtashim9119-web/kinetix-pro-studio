/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * G6 Step 3 — thin IPC client for `media_vault.rs`'s content-addressed
 * store, mirroring `nativeAssetStore.ts`'s own shape (raw byte body over
 * IPC, never base64 — that do-not is about the BYTES, which can be
 * gigabytes). Outside Tauri (plain `npm run dev`), every function is a
 * no-op / `null` result, same posture `nativeAssetStore.ts` already has —
 * there is no native vault to write to.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';

/** Mirrors `media_vault.rs`'s `MediaVaultEntry` (camelCase over IPC). */
export interface MediaVaultEntry {
  contentHash: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  addedAtMs: number;
  referencedByProjectIds: string[];
}

/**
 * base64 of `s`'s UTF-8 bytes. An HTTP-style header value has no safe way to
 * carry arbitrary UTF-8 (non-ISO-8859-1 bytes are rejected or mangled
 * depending on the platform) — this is why the display name travels as its
 * own base64'd header (`display-name-b64`, decoded in `media_vault.rs`'s
 * `decode_display_name_header`) rather than a raw `name` header the way
 * `nativeAssetStore.ts`'s pre-existing `asset_store_write` does. Deliberately
 * NOT the classic `btoa(unescape(encodeURIComponent(s)))` trick — `unescape`
 * is deprecated; this does the same UTF-8-bytes-to-binary-string conversion
 * without it.
 */
function toBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Write-through import into the media vault. Returns `null` outside Tauri
 * (no native vault exists there — the caller proceeds IndexedDB-only, same
 * as every other native-store client in this codebase). Throws on any
 * in-Tauri failure — never swallowed, matching `writeAssetNative`'s "a
 * failed write must surface as a failed import" contract; `ingestZip`
 * (`App.tsx`) is the one production caller and treats a throw here as a
 * failed file, not a silent IndexedDB-only fallback.
 */
export async function mediaVaultImportBytes(
  projectId: string,
  bytes: Uint8Array,
  displayName: string,
  mimeType: string,
): Promise<MediaVaultEntry | null> {
  if (!isTauri()) return null;
  return invoke<MediaVaultEntry>('media_vault_import', bytes, {
    headers: {
      'project-id': projectId,
      'display-name-b64': toBase64Utf8(displayName),
      'mime-type': mimeType,
    },
  });
}

/** G6 Step 4 — every vault entry, for the Media block. `[]` outside Tauri. */
export async function mediaVaultListEntries(): Promise<MediaVaultEntry[]> {
  if (!isTauri()) return [];
  return invoke<MediaVaultEntry[]>('media_vault_list_entries');
}

/** G6 Step 4 — reads one vault blob's raw bytes (used for image-type
 *  entries, which are their own thumbnail — no separate thumbnail file is
 *  generated for them). `null` outside Tauri; throws on a real read failure
 *  (missing/corrupt blob), which the caller should treat as "show a fallback
 *  icon", not surface to the user as an error. */
export async function mediaVaultReadBlob(contentHash: string): Promise<Uint8Array | null> {
  if (!isTauri()) return null;
  const bytes = await invoke<number[]>('media_vault_read_blob', { contentHash });
  return new Uint8Array(bytes);
}

/** G6 Step 4a — generates (or reuses) a video's thumbnail. `false` outside
 *  Tauri and on any generation failure (corrupt/0-byte video, missing blob)
 *  — never throws; the caller falls back to a generic icon, the same
 *  posture `resolveVideoNativeFps` already has for its own probe. */
export async function mediaVaultGenerateThumbnail(contentHash: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('media_vault_generate_thumbnail', { contentHash });
  } catch (err) {
    console.warn('[mediaVaultClient] thumbnail generation failed, falling back to an icon:', contentHash, err);
    return false;
  }
}

/** Wave 3 B2 — the same generation, told apart: 'generated' (a thumbnail now
 *  exists), 'failed' (Tauri ran ffmpeg and it could not read a frame — the
 *  bytes are corrupt/0-byte/truncated), 'unavailable' (not in Tauri, or the
 *  IPC itself threw — says NOTHING about the file, so never a corrupt verdict). */
export type ThumbnailOutcome = 'generated' | 'failed' | 'unavailable';

export async function mediaVaultGenerateThumbnailDetailed(contentHash: string): Promise<ThumbnailOutcome> {
  if (!isTauri()) return 'unavailable';
  try {
    return (await invoke<boolean>('media_vault_generate_thumbnail', { contentHash })) ? 'generated' : 'failed';
  } catch (err) {
    console.warn('[mediaVaultClient] thumbnail IPC failed, no verdict on the file:', contentHash, err);
    return 'unavailable';
  }
}

/** G6 Step 4a — reads back a previously generated thumbnail. `null` outside
 *  Tauri, when none has been generated yet, or on any read failure — every
 *  case renders identically (fall back to a generic icon), so this never
 *  throws. */
export async function mediaVaultReadThumbnail(contentHash: string): Promise<Uint8Array | null> {
  if (!isTauri()) return null;
  try {
    const bytes = await invoke<number[] | null>('media_vault_read_thumbnail', { contentHash });
    return bytes === null ? null : new Uint8Array(bytes);
  } catch (err) {
    console.warn('[mediaVaultClient] thumbnail read failed, falling back to an icon:', contentHash, err);
    return null;
  }
}

/**
 * G6 Step 6 (dead-feature-gap fix) — removes `projectId` from `contentHash`'s
 * referencers, so a subsequent reclaim can see the blob as zero-ref once
 * every project that used it has done this. Best-effort / never throws —
 * same posture as `deleteAssetNative`: an asset delete or project delete
 * must not fail just because storage-hygiene bookkeeping hit a snag, and a
 * blob that stays over-referenced only wastes disk (recoverable by rerunning
 * this), never corrupts anything. No-op outside Tauri and for an unknown
 * hash (the Rust side already treats an unknown hash as a no-op, not an
 * error — see `media_vault.rs`'s `unreference_project`).
 */
export async function mediaVaultUnreference(contentHash: string, projectId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke<void>('media_vault_unreference', { contentHash, projectId });
  } catch (err) {
    console.warn('[mediaVaultClient] unreference failed (non-fatal):', contentHash, projectId, err);
  }
}

/**
 * Drops EVERY vault reference a deleted project holds, however it got them.
 * `mediaVaultUnreference` per listed hash misses a reference taken at import
 * time for an asset the record never listed (or no longer lists) — e.g. a bulk
 * project deleted before its build wrote its assets — which pinned the blob
 * against reclaim forever. Best-effort / never throws, same posture as above.
 */
export async function mediaVaultUnreferenceProject(projectId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke<number>('media_vault_unreference_project', { projectId });
  } catch (err) {
    console.warn('[mediaVaultClient] unreference-project failed (non-fatal):', projectId, err);
  }
}

/**
 * Media workflow Unit 1 — renames the vault registry's display name for
 * `contentHash` (the project's own `Asset.name` is renamed in App state).
 * Best-effort / never throws, same posture as `mediaVaultUnreference`: the
 * registry label is the vault's own bookkeeping, and the rename that matters
 * for matching (`Asset.name`) has already happened. No-op outside Tauri and
 * for an unknown hash (Rust treats that as a no-op too).
 */
export async function mediaVaultRename(contentHash: string, displayName: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke<void>('media_vault_rename', { contentHash, displayName });
  } catch (err) {
    console.warn('[mediaVaultClient] rename failed (non-fatal):', contentHash, err);
  }
}
