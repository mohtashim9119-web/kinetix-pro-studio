/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * G6 Step 4 — the per-file write-through shared by `zipIngest.ts`'s
 * `ingestZip` and this module's own `ingestLooseFiles` (the Media block's
 * "add loose files / add folder" door — a folder picker is just a
 * `<input webkitdirectory>` yielding a `FileList`, no different from a
 * multi-file picker for ingest purposes, so both share this one path).
 * Extracted here rather than duplicated a second time, the same reason
 * `zipIngest.ts` itself was split out of App.tsx.
 */

import { putAsset, deleteAsset } from './assetStore';
import { mediaVaultImportBytes } from './mediaVaultClient';
import { probeVideoFps } from './tauriFfmpeg';
import type { Asset } from '../types';

const MEDIA_VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const MEDIA_AUDIO_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const MEDIA_IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;

/** `undefined` for an unrecognized extension — the caller counts this as
 *  `unsupportedSkipped`, never silently guesses a type (the "unsupported ->
 *  finding" operator ruling `zipIngest.ts` already follows). */
export function detectMediaType(filename: string): Asset['type'] | undefined {
  if (MEDIA_VIDEO_EXT.test(filename)) return 'video';
  if (MEDIA_AUDIO_EXT.test(filename)) return 'audio';
  if (MEDIA_IMAGE_EXT.test(filename)) return 'image';
  return undefined;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Duplicated from App.tsx's own `getMediaDuration` — see `zipIngest.ts`'s
 *  identical comment for why (a tiny, pure DOM-probe helper, not worth a
 *  cross-module import for). */
function getMediaDuration(url: string, type: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const media = type === 'video' ? document.createElement('video') : document.createElement('audio');
    media.src = url;
    media.onloadedmetadata = () => resolve(media.duration);
    media.onerror = () => resolve(0);
  });
}

async function resolveVideoNativeFps(blob: Blob): Promise<number | undefined> {
  try {
    return await probeVideoFps(blob);
  } catch (err) {
    console.warn('[mediaIngest] fps probe failed, leaving nativeFps unset:', err);
    return undefined;
  }
}

export interface MediaIngestCounts {
  imported: number;
  deduped: number;
  unsupportedSkipped: number;
  failed: number;
}

/**
 * Ingests ONE candidate file already known to be a supported type: hashes
 * it, dedupes against `seenHashes` (mutated — caller owns its lifetime, one
 * `Set` per ingest batch), and on a fresh hash write-throughs to IndexedDB
 * AND the media vault synchronously, exactly like `zipIngest.ts`'s own
 * per-entry logic (a vault-write failure rolls back the IndexedDB write and
 * counts as failed — never IndexedDB-only). Returns the new `Asset`, or
 * `null` when the file was deduped or failed (either way, `counts` — also
 * caller-owned — has already been incremented accordingly; nothing here
 * throws for a per-file problem).
 */
export async function ingestOneMediaFile(
  projectId: string,
  name: string,
  blob: Blob,
  type: Asset['type'],
  seenHashes: Set<string>,
  counts: MediaIngestCounts,
  duplicateNames?: string[],
): Promise<Asset | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const contentHash = await sha256Hex(bytes);
  if (seenHashes.has(contentHash)) {
    counts.deduped += 1;
    duplicateNames?.push(name);
    return null;
  }
  seenHashes.add(contentHash);

  const id = crypto.randomUUID();
  const mimeType = blob.type || 'application/octet-stream';
  try {
    await putAsset(projectId, id, blob, { name, mimeType });
  } catch (err) {
    console.error('[mediaIngest] Failed to persist to IndexedDB, skipping:', name, err);
    counts.failed += 1;
    return null;
  }
  try {
    await mediaVaultImportBytes(projectId, bytes, name, mimeType);
  } catch (err) {
    console.error('[mediaIngest] Failed to write to media vault, skipping:', name, err);
    await deleteAsset(projectId, id).catch(() => {});
    counts.failed += 1;
    return null;
  }

  const nativeFps = type === 'video' ? await resolveVideoNativeFps(blob) : undefined;
  const url = URL.createObjectURL(blob);
  const duration = type === 'video' ? await getMediaDuration(url, 'video') : undefined;
  counts.imported += 1;
  // G6 Step 5 — stamped here for free: this function already computed the
  // hash above for dedup, so a freshly-imported asset never needs the
  // lazy backfill (`backfillAssetContentHashes.ts`) at all — only assets
  // imported BEFORE this field existed do.
  return { id, name, url, type, file: new File([blob], name), nativeFps, duration, addedAt: Date.now(), contentHash };
}

export interface LooseFilesIngestResult {
  assets: Asset[];
  audioAssetId: string | undefined;
  counts: MediaIngestCounts;
  /** Names of files this call dropped as duplicates (of `existingHashes` OR
   *  of another file earlier in this same batch) — for a caller that wants
   *  to name the duplicate rather than just count it (G6 polish item 1). */
  duplicateNames: string[];
}

/**
 * The Media block's "add loose files" / "add folder" door (App.tsx's
 * `ingestZip` is the "add zip" door — same underlying `ingestOneMediaFile`,
 * different front end for gathering candidate files). Sequential, same as
 * `ingestZip`, for the same reason: bounding memory use file-by-file rather
 * than decompressing/reading everything into memory via `Promise.all` first.
 *
 * `existingHashes` (G6 polish item 1) seeds the dedup set with the content
 * hashes already present in the project — without this, dedup only ever
 * caught duplicates WITHIN one ingest call (a fresh `Set` per call), so
 * importing the same file twice via two separate "add media" actions
 * silently stacked a second Asset record with the same bytes. Callers
 * should pass every already-imported asset's `contentHash`.
 */
export async function ingestLooseFiles(
  projectId: string,
  files: File[],
  existingHashes: Iterable<string> = [],
): Promise<LooseFilesIngestResult> {
  const counts: MediaIngestCounts = { imported: 0, deduped: 0, unsupportedSkipped: 0, failed: 0 };
  const assets: Asset[] = [];
  let audioAssetId: string | undefined;
  const seenHashes = new Set<string>(existingHashes);
  const duplicateNames: string[] = [];

  for (const file of files) {
    const type = detectMediaType(file.name);
    if (type === undefined) {
      counts.unsupportedSkipped += 1;
      continue;
    }
    const asset = await ingestOneMediaFile(projectId, file.name, file, type, seenHashes, counts, duplicateNames);
    if (asset) {
      assets.push(asset);
      if (asset.type === 'audio' && audioAssetId === undefined) audioAssetId = asset.id;
    }
  }

  return { assets, audioAssetId, counts, duplicateNames };
}
