/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G6 Step 3 — ONE zip-ingest path, replacing the two duplicate
// implementations that used to live in App.tsx (`extractZipToAssets`,
// the staged-files Apply-Sync path) and its manual-upload handler
// (`processZipFile`, now a thin wrapper around `ingestZip` here). Extracted
// to its own service module rather than left in App.tsx — the same reason
// `zipAssetMerge.ts` was split out (see that module's own test file's doc
// comment): logic that needs real, direct unit tests should not require
// mounting or importing the whole App.tsx graph to exercise.
//
// Both old implementations shared the same three bugs, fixed once, here:
//
//   1. NO TRAVERSAL CHECK. JSZip (since 3.x) already flags an unsafe entry
//      via the PUBLIC `unsafeOriginalName` field — set only when the raw
//      zip-internal path contained `..`/was otherwise unsafe (zip-slip,
//      https://snyk.io/research/zip-slip-vulnerability). Neither old
//      function ever read it, so a crafted `../../whatever` entry extracted
//      exactly like any other file.
//   2. NO BOMB CAPS. Both extracted every entry via `Promise.all` — unbounded
//      parallel decompression with no entry-count, per-file, or total-bytes
//      ceiling. This ingests SEQUENTIALLY instead, specifically so a running
//      total can abort mid-archive rather than only after everything is
//      already fully decompressed in memory.
//   3. FILENAME DEDUP, DEFAULT-TO-IMAGE. Both compared `name === name`
//      against sibling files to dedupe (`processZipFile` also against
//      already-in-project assets) and defaulted any unrecognized extension
//      to `type: 'image'`. Filename dedup silently DROPPED a genuinely
//      different file that happened to share a name with another (an
//      "over-match" data-loss bug — zip-slipped or not, `folder1/video.mp4`
//      and `folder2/video.mp4` both reduce to display name `video.mp4`) and
//      was Unicode-naive (NFC/NFD forms of an accented name compare
//      unequal). Content-hash dedup here replaces it: identical BYTES dedupe
//      (within this zip, and across projects/time via the media vault's own
//      dedup — Step 2); same-name-different-bytes no longer collide at all.
//      An unrecognized extension is now a counted `unsupportedSkipped`
//      finding, never a silently-wrong asset type (the "unsupported ->
//      finding" operator ruling).
// ---------------------------------------------------------------------------

import { putAsset, deleteAsset } from './assetStore';
import { mediaVaultImportBytes } from './mediaVaultClient';
import { probeVideoFps } from './tauriFfmpeg';
import type { Asset } from '../types';

/** Typed failure for "oversized total" — distinguishable from a generic
 *  extraction error so a caller can show a specific message rather than a
 *  generic "ZIP Error" catch-all. */
export class ZipTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipTooLargeError';
  }
}

// Generous but bounded — a legitimate "all my b-roll for this project"
// export can easily be hundreds of clips; these exist to stop a pathological
// or malicious archive, not a normal library.
export const ZIP_MAX_ENTRIES = 5000;
export const ZIP_MAX_ENTRY_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB — one very large source clip
export const ZIP_MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024; // 20 GiB — a whole project's assets

const ZIP_VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const ZIP_AUDIO_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const ZIP_IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;

export interface ZipIngestCounts {
  imported: number;
  deduped: number;
  unsupportedSkipped: number;
  failed: number;
}

export interface ZipIngestResult {
  assets: Asset[];
  /** First audio-type entry found, for voiceover auto-assignment — mirrors
   *  `zipImportVoiceoverId.ts`'s `resolveZipImportVoiceoverId` contract. */
  audioAssetId: string | undefined;
  /** ONE grouped finding per ingest, not one per file — Step 4 renders this
   *  as a single Sync Log entry. */
  counts: ZipIngestCounts;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Duplicated from App.tsx's own `getMediaDuration` (a tiny, pure DOM-probe
 *  helper with no App.tsx-specific dependency) rather than imported — same
 *  small-helper-duplication convention this codebase already uses in Rust
 *  (`now_millis`, `write_atomic_bytes`) to avoid a cross-module coupling for
 *  a few lines. */
function getMediaDuration(url: string, type: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const media = type === 'video' ? document.createElement('video') : document.createElement('audio');
    media.src = url;
    media.onloadedmetadata = () => resolve(media.duration);
    media.onerror = () => resolve(0);
  });
}

/** Mirrors App.tsx's own `resolveVideoNativeFps`: a failure here is
 *  non-fatal — fps auto-match is a convenience, not something the sync flow
 *  depends on — so this swallows errors and returns undefined. */
async function resolveVideoNativeFps(blob: Blob): Promise<number | undefined> {
  try {
    return await probeVideoFps(blob);
  } catch (err) {
    console.warn('[zipIngest] fps probe failed, leaving nativeFps unset:', err);
    return undefined;
  }
}

/**
 * Extracts all supported media from a zip archive, hardens against
 * traversal/bomb archives, dedupes by content hash, and write-throughs every
 * kept file to IndexedDB AND the media vault (Step 2) synchronously — no
 * reliance on the fire-and-forget next-boot migration
 * (`migrateAssetsToNative.ts`) for zip-imported bytes, closing the exact
 * asymmetry Step 2's own doc comment names. Does NOT call `setProject` —
 * callers commit `result.assets` themselves (App.tsx's two call sites: the
 * staged-files Apply-Sync path, and `processZipFile`).
 *
 * THROWS `ZipTooLargeError` for an oversized archive (typed, so a caller can
 * show a specific message) — this is a whole-ingest abort, not a per-file
 * skip, since a caller past this point cannot know how much of the archive
 * it never got to see. Never throws for a per-file problem (traversal,
 * unsupported type, a persist failure) — those are counted, not fatal.
 */
export async function ingestZip(projectId: string, zipFile: File): Promise<ZipIngestResult> {
  const counts: ZipIngestCounts = { imported: 0, deduped: 0, unsupportedSkipped: 0, failed: 0 };
  const assets: Asset[] = [];
  let audioAssetId: string | undefined;
  const seenHashes = new Set<string>();

  let JSZipModule: typeof import('jszip');
  try {
    ({ default: JSZipModule } = await import('jszip'));
  } catch (loadErr) {
    console.error('[ingestZip] Failed to load jszip:', loadErr);
    counts.failed += 1;
    return { assets, audioAssetId, counts };
  }

  const zip = new JSZipModule();
  const content = await zip.loadAsync(zipFile);
  const entries = Object.values(content.files).filter(f => !f.dir);

  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new ZipTooLargeError(
      `This zip has ${entries.length} files, more than the ${ZIP_MAX_ENTRIES}-file limit.`,
    );
  }

  let totalBytes = 0;

  // Sequential, not Promise.all — JSZip exposes no public, reliable
  // pre-decompression size (its own type definitions mark
  // `_data.uncompressedSize` private/unofficial), so the running-total bomb
  // check can only happen BETWEEN entries, not before any of them. Parallel
  // extraction would decompress everything into memory before this loop
  // ever got a chance to abort.
  for (const fileData of entries) {
    if (fileData.unsafeOriginalName !== undefined) {
      console.warn('[ingestZip] rejected unsafe (traversal) zip entry:', fileData.unsafeOriginalName);
      counts.failed += 1;
      continue;
    }

    const filename = fileData.name;
    const name = filename.split('/').pop() || filename;
    let type: Asset['type'] | undefined;
    if (ZIP_VIDEO_EXT.test(filename)) type = 'video';
    else if (ZIP_AUDIO_EXT.test(filename)) type = 'audio';
    else if (ZIP_IMAGE_EXT.test(filename)) type = 'image';
    if (type === undefined) {
      counts.unsupportedSkipped += 1;
      continue;
    }

    const blob = await fileData.async('blob');
    totalBytes += blob.size;
    if (blob.size > ZIP_MAX_ENTRY_BYTES) {
      throw new ZipTooLargeError(`"${name}" is larger than the ${ZIP_MAX_ENTRY_BYTES}-byte per-file limit.`);
    }
    if (totalBytes > ZIP_MAX_TOTAL_BYTES) {
      throw new ZipTooLargeError(`This zip's total size exceeds the ${ZIP_MAX_TOTAL_BYTES}-byte limit.`);
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const contentHash = await sha256Hex(bytes);
    if (seenHashes.has(contentHash)) {
      counts.deduped += 1;
      continue;
    }
    seenHashes.add(contentHash);

    const id = crypto.randomUUID();
    const mimeType = blob.type || 'application/octet-stream';
    try {
      await putAsset(projectId, id, blob, { name, mimeType });
    } catch (err) {
      console.error('[ingestZip] Failed to persist to IndexedDB, skipping:', name, err);
      counts.failed += 1;
      continue;
    }
    try {
      await mediaVaultImportBytes(projectId, bytes, name, mimeType);
    } catch (err) {
      // Never leave a file IndexedDB-only with a failed vault write — same
      // "never swallow a write failure" doctrine `writeAssetNative` already
      // follows for loose-file import. `null` (outside Tauri) is not a
      // failure; only a genuine throw is.
      console.error('[ingestZip] Failed to write to media vault, skipping:', name, err);
      await deleteAsset(projectId, id).catch(() => {});
      counts.failed += 1;
      continue;
    }

    const nativeFps = type === 'video' ? await resolveVideoNativeFps(blob) : undefined;
    const url = URL.createObjectURL(blob);
    const duration = type === 'video' ? await getMediaDuration(url, 'video') : undefined;
    const asset: Asset = { id, name, url, type, file: new File([blob], name), nativeFps, duration, addedAt: Date.now() };
    assets.push(asset);
    counts.imported += 1;
    if (type === 'audio' && audioAssetId === undefined) audioAssetId = id;
  }

  return { assets, audioAssetId, counts };
}
