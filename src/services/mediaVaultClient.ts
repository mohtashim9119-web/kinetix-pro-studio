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
