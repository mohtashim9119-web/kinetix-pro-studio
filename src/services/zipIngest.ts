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
//
// G6 Step 4 — the per-file write-through (hash, dedupe, IndexedDB + vault)
// moved to `mediaIngest.ts`'s `ingestOneMediaFile`, shared with the Media
// block's "add loose files / add folder" door (`ingestLooseFiles`, same
// module). This file keeps only what is genuinely zip-specific: jszip
// loading, traversal rejection, and the bomb caps (which need the
// decompressed-entry loop zip alone has).
// ---------------------------------------------------------------------------

import { detectMediaType, ingestOneMediaFile, type MediaIngestCounts } from './mediaIngest';
import { isMacOSMetadataPath } from './macosMetadata';
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

export type ZipIngestCounts = MediaIngestCounts;

export interface ZipIngestResult {
  assets: Asset[];
  /** First audio-type entry found, for voiceover auto-assignment — mirrors
   *  `zipImportVoiceoverId.ts`'s `resolveZipImportVoiceoverId` contract. */
  audioAssetId: string | undefined;
  /** ONE grouped finding per ingest, not one per file — Step 4 renders this
   *  as a single Sync Log entry. */
  counts: ZipIngestCounts;
  /** Names of archive entries dropped as duplicates of `existingHashes` or of
   *  another entry earlier in this same archive (G6 polish item 1). */
  duplicateNames: string[];
}

type JSZipCtor = typeof import('jszip');

export interface ZipMediaWalkResult {
  /** Entries with an unrecognized extension (macOS metadata excluded). */
  unsupportedSkipped: number;
  /** Entries rejected by the traversal (zip-slip) check. */
  unsafeRejected: number;
  /** Paths of `.zip` entries found inside this archive — NOT opened here.
   *  Each caller decides: `ingestZip` counts them unsupported (unchanged
   *  plain-media-zip behavior); bundle ingest opens a bundle's own top-level
   *  zips exactly once and reports anything deeper as skipped. */
  nestedZipNames: string[];
}

/**
 * The one zip-walking loop shared by `ingestZip` and bundle ingest's inner
 * media zip: open, drop macOS metadata (`isMacOSMetadataPath` — silently,
 * never counted), reject traversal entries, enforce the bomb caps, and hand
 * each supported media entry to `onMedia` in archive order. Sequential, not
 * Promise.all — JSZip exposes no public, reliable pre-decompression size
 * (its own type definitions mark `_data.uncompressedSize`
 * private/unofficial), so the running-total bomb check can only happen
 * BETWEEN entries; parallel extraction would decompress everything before
 * this loop ever got a chance to abort.
 *
 * THROWS `ZipTooLargeError` for an oversized archive; a corrupt archive
 * throws whatever `loadAsync` throws.
 */
export async function walkZipMediaEntries(
  JSZipModule: JSZipCtor,
  zipSource: Blob,
  onMedia: (name: string, blob: Blob, type: Asset['type']) => Promise<void>,
): Promise<ZipMediaWalkResult> {
  const result: ZipMediaWalkResult = { unsupportedSkipped: 0, unsafeRejected: 0, nestedZipNames: [] };
  const content = await new JSZipModule().loadAsync(zipSource);
  // Metadata filtered BEFORE the entry-count cap: a Finder zip carries one
  // `__MACOSX/._` twin per real file, so counting them would halve the
  // effective limit for every Mac user.
  const entries = Object.values(content.files).filter(f => !f.dir && !isMacOSMetadataPath(f.name));

  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new ZipTooLargeError(
      `This zip has ${entries.length} files, more than the ${ZIP_MAX_ENTRIES}-file limit.`,
    );
  }

  let totalBytes = 0;
  for (const fileData of entries) {
    // jszip (3.x) sets `unsafeOriginalName` on EVERY non-directory entry,
    // unconditionally, to the raw pre-resolve() path — it equals `name` for
    // a safe entry and differs from it only when resolve() actually rewrote
    // the path (a genuine `../` traversal/zip-slip attempt). Checking
    // `!== undefined` alone is true for every real entry and rejects 100%
    // of any zip; the actual signal is a MISMATCH between the two.
    if (fileData.unsafeOriginalName !== undefined && fileData.unsafeOriginalName !== fileData.name) {
      console.warn('[ingestZip] rejected unsafe (traversal) zip entry:', fileData.unsafeOriginalName);
      result.unsafeRejected += 1;
      continue;
    }

    const filename = fileData.name;
    const name = filename.split('/').pop() || filename;
    if (/\.zip$/i.test(name)) {
      result.nestedZipNames.push(filename);
      continue;
    }
    const type = detectMediaType(filename);
    if (type === undefined) {
      result.unsupportedSkipped += 1;
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

    await onMedia(name, blob, type);
  }
  return result;
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
export async function ingestZip(
  projectId: string,
  zipFile: File,
  existingHashes: Iterable<string> = [],
): Promise<ZipIngestResult> {
  const counts: ZipIngestCounts = { imported: 0, deduped: 0, unsupportedSkipped: 0, failed: 0 };
  const assets: Asset[] = [];
  let audioAssetId: string | undefined;
  const seenHashes = new Set<string>(existingHashes);
  const duplicateNames: string[] = [];

  let JSZipModule: JSZipCtor;
  try {
    ({ default: JSZipModule } = await import('jszip'));
  } catch (loadErr) {
    console.error('[ingestZip] Failed to load jszip:', loadErr);
    counts.failed += 1;
    return { assets, audioAssetId, counts, duplicateNames };
  }

  const walk = await walkZipMediaEntries(JSZipModule, zipFile, async (name, blob, type) => {
    const asset = await ingestOneMediaFile(projectId, name, blob, type, seenHashes, counts, duplicateNames);
    if (asset) {
      assets.push(asset);
      if (asset.type === 'audio' && audioAssetId === undefined) audioAssetId = asset.id;
    }
  });
  counts.failed += walk.unsafeRejected;
  // A plain media zip never unpacks a zip inside it (only a bundle's own
  // top-level zips are opened — see `bundleIngest.ts`) — unchanged
  // pre-G5 behavior: an inner zip is an unsupported entry.
  counts.unsupportedSkipped += walk.unsupportedSkipped + walk.nestedZipNames.length;

  return { assets, audioAssetId, counts, duplicateNames };
}
