/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G5 — master bundle ingest (plan-v3 Wave 2, folded from G6's Option A).
//
// A "bundle" zip carries more than media: a script and/or scene-details text
// file and/or a voiceover audio file, alongside images/videos (loose, or
// under a media/ subfolder — path structure is never inspected, only each
// entry's own extension, same as `zipIngest.ts`). Detected on a zip dropped
// on ANY of DropZonePanel's four slots, not just the generic assets drop.
//
// A zip carrying NONE of those markers (no text, no audio) is not a bundle —
// `classifyBundleZip` returns `{ kind: 'not-a-bundle' }` and the caller falls
// through to the existing, UNCHANGED `zipIngest.ts` media-zip path. Nothing
// about a plain media zip's behavior changes.
//
// TRANSACTIONAL: classification (Pass 1, below) reads every entry — text
// content and media/audio blobs — into memory but writes NOTHING. Only once
// the full manifest validates (script text present, scene text present,
// voiceover audio present, at least one media file present) does Pass 2 run,
// persisting media through the same `ingestOneMediaFile` vault door every
// other ingest path uses. A bundle that fails validation — corrupt archive,
// or a bundle-shaped zip missing one of the four required pieces — writes
// NOTHING: no slot is touched, no asset is persisted. This is the "one
// transaction, manifest-validated, all-or-nothing" requirement; the boundary
// is transactional across the FOUR SLOTS as a set (either all four fill, or
// none do) — it does not add a rollback mechanism across individual already-
// committed vault writes, since none happen before validation passes.
//
// macOS metadata (`._` AppleDouble twins, `.DS_Store`, `__MACOSX/`) is
// dropped before classification — see `macosMetadata.ts`. Without that, a
// Finder-made bundle's `._1. Script.txt` twin claimed the Script slot and
// `._voiceover.mp3` the Voiceover slot, pushing the real files aside.
//
// NESTED ZIP: a `.zip` entry in the bundle is media — opened through
// `zipIngest.ts`'s own `walkZipMediaEntries` (same metadata filter, traversal
// check and bomb caps, applied to the inner archive as-is), still inside
// Pass 1, so its media is classified in memory and persisted in Pass 2 with
// everything else, content-hash deduped against the same set. ONE level
// only: a zip inside that inner zip is never opened — its path is reported
// in `nestedZipsSkipped` (one grouped finding), bounding the work.
// ---------------------------------------------------------------------------

import { detectMediaType, ingestOneMediaFile, makeOfflineReconnectSink, finishIngestBatch, mapPool, type MediaIngestCounts, type OfflineReconnect } from './mediaIngest';
import { stripRtfIfNeeded, detectTextFileRole } from './textUtils';
import { ZIP_MAX_ENTRIES, ZIP_MAX_ENTRY_BYTES, ZIP_MAX_TOTAL_BYTES, ZipTooLargeError, walkZipMediaEntries } from './zipIngest';
import { isMacOSMetadataPath } from './macosMetadata';
import { timedIngest } from './ingestTiming';
import { withAudioMimeType } from './audioFormats';
import type { Asset } from '../types';

export interface BundleIngestSuccess {
  kind: 'success';
  scriptFile: File;
  sceneFile: File;
  voiceoverFile: File;
  mediaAssets: Asset[];
  counts: MediaIngestCounts;
  duplicateNames: string[];
  /** `inner.zip/deeper.zip`-style paths of zips found inside one of the
   *  bundle's own zips — never opened (one nesting level only). */
  nestedZipsSkipped: string[];
  /** Media workflow Unit 4 — present only when `offlineHashes` was passed. */
  reconnected?: OfflineReconnect[];
}

export type BundleZipOutcome =
  | { kind: 'not-a-bundle' }
  | BundleIngestSuccess
  | { kind: 'failure'; message: string };

interface ClassifiedTextEntry {
  name: string;
  text: string;
  role: 'script' | 'sceneDetails';
}

/**
 * Opens `zipFile`, classifies every entry, and either:
 *  - returns `{ kind: 'not-a-bundle' }` (no text/audio marker found — caller
 *    should fall through to `ingestZip`),
 *  - ingests the bundle and returns `{ kind: 'success', ... }`, or
 *  - returns `{ kind: 'failure', message }` for a corrupt archive, an
 *    oversized archive, or a bundle-shaped zip missing a required piece.
 *
 * Never throws for a bundle-shaped problem — every failure is a typed
 * outcome the caller can show as one grouped finding, per the "zero silent
 * fallbacks" / typed-outcome convention the rest of this codebase's ingest
 * and sync paths already follow.
 */
export async function classifyAndIngestBundleZip(
  projectId: string,
  zipFile: File,
  existingHashes: Iterable<string> = [],
  offlineHashes?: Iterable<string>,
): Promise<BundleZipOutcome> {
  let JSZipModule: typeof import('jszip');
  try {
    ({ default: JSZipModule } = await import('jszip'));
  } catch (loadErr) {
    console.error('[bundleIngest] Failed to load jszip:', loadErr);
    return { kind: 'failure', message: 'Could not read the zip archive — try again.' };
  }

  let content: Awaited<ReturnType<InstanceType<typeof JSZipModule>['loadAsync']>>;
  try {
    content = await timedIngest('bundle:loadAsync', () => new JSZipModule().loadAsync(zipFile), zipFile.size);
  } catch (err) {
    console.error('[bundleIngest] Failed to open zip:', err);
    return { kind: 'failure', message: `"${zipFile.name}" could not be read — the archive appears corrupt.` };
  }

  const entries = Object.keys(content.files)
    .map(k => content.files[k]!)
    .filter(f => !f.dir && !isMacOSMetadataPath(f.name));
  if (entries.length > ZIP_MAX_ENTRIES) {
    return { kind: 'failure', message: `"${zipFile.name}" has ${entries.length} files, more than the ${ZIP_MAX_ENTRIES}-file limit.` };
  }

  // ---- Pass 1: classify. No persistence happens in this pass. ----
  const textEntries: ClassifiedTextEntry[] = [];
  const audioNames: { entry: (typeof entries)[number]; name: string }[] = [];
  const mediaNames: { entry: (typeof entries)[number]; name: string; type: Asset['type'] }[] = [];
  const innerZips: { entry: (typeof entries)[number]; name: string }[] = [];
  let unsupportedSkipped = 0;
  let unsafeRejected = 0;
  const nestedZipsSkipped: string[] = [];

  for (const entry of entries) {
    if (entry.unsafeOriginalName !== undefined && entry.unsafeOriginalName !== entry.name) {
      console.warn('[bundleIngest] rejected unsafe (traversal) zip entry:', entry.unsafeOriginalName);
      unsafeRejected += 1;
      continue;
    }
    const filename = entry.name;
    const name = filename.split('/').pop() || filename;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'txt' || ext === 'rtf') {
      const raw = await entry.async('string');
      const stripped = stripRtfIfNeeded(raw);
      textEntries.push({ name, text: stripped, role: detectTextFileRole(stripped) });
      continue;
    }
    if (ext === 'zip') {
      innerZips.push({ entry, name });
      continue;
    }
    const type = detectMediaType(name);
    if (type === undefined) {
      unsupportedSkipped += 1;
      continue;
    }
    if (type === 'audio') audioNames.push({ entry, name });
    else mediaNames.push({ entry, name, type });
  }

  const isBundleAttempt = textEntries.length > 0 || audioNames.length > 0;
  if (!isBundleAttempt) {
    return { kind: 'not-a-bundle' };
  }

  const audioEntries: { name: string; blob: Blob }[] = [];
  const mediaEntries: { name: string; blob: Blob; type: Asset['type'] }[] = [];
  let totalBytes = 0;

  const takeBlob = async (entry: (typeof entries)[number], name: string): Promise<Blob | { fail: BundleZipOutcome }> => {
    const blob = await entry.async('blob');
    totalBytes += blob.size;
    if (blob.size > ZIP_MAX_ENTRY_BYTES) {
      return { fail: { kind: 'failure', message: `"${name}" is larger than the ${ZIP_MAX_ENTRY_BYTES}-byte per-file limit — nothing in this bundle was imported.` } };
    }
    if (totalBytes > ZIP_MAX_TOTAL_BYTES) {
      return { fail: { kind: 'failure', message: `"${zipFile.name}"'s total size exceeds the ${ZIP_MAX_TOTAL_BYTES}-byte limit — nothing in this bundle was imported.` } };
    }
    return blob;
  };

  for (const a of audioNames) {
    const blob = await takeBlob(a.entry, a.name);
    if (!(blob instanceof Blob)) return blob.fail;
    audioEntries.push({ name: a.name, blob });
  }
  for (const m of mediaNames) {
    const blob = await takeBlob(m.entry, m.name);
    if (!(blob instanceof Blob)) return blob.fail;
    mediaEntries.push({ name: m.name, blob, type: m.type });
  }
  for (const z of innerZips) {
    const blob = await takeBlob(z.entry, z.name);
    if (!(blob instanceof Blob)) return blob.fail;
    try {
      const walk = await walkZipMediaEntries(JSZipModule, blob, async (innerName, innerBlob, innerType) => {
        mediaEntries.push({ name: innerName, blob: innerBlob, type: innerType });
      });
      unsupportedSkipped += walk.unsupportedSkipped;
      unsafeRejected += walk.unsafeRejected;
      nestedZipsSkipped.push(...walk.nestedZipNames.map(n => `${z.name}/${n}`));
    } catch (err) {
      if (err instanceof ZipTooLargeError) {
        return { kind: 'failure', message: `"${z.name}" inside "${zipFile.name}": ${err.message} Nothing in this bundle was imported.` };
      }
      console.error('[bundleIngest] Failed to open inner zip:', z.name, err);
      return { kind: 'failure', message: `"${z.name}" inside "${zipFile.name}" could not be read — the archive appears corrupt. Nothing in this bundle was imported.` };
    }
  }

  // Script vs scene disambiguation — same order DropZonePanel's own
  // `addFiles` already uses for a loose multi-text-file drop: the first
  // sceneDetails-shaped (bracket-tagged) file claims "scene", else "script".
  let pendingScript: ClassifiedTextEntry | undefined;
  let pendingScene: ClassifiedTextEntry | undefined;
  for (const tf of textEntries) {
    if (tf.role === 'sceneDetails') {
      if (!pendingScene) pendingScene = tf;
      else if (!pendingScript) pendingScript = tf;
    } else {
      if (!pendingScript) pendingScript = tf;
      else if (!pendingScene) pendingScene = tf;
    }
  }

  // Only the FIRST audio entry is the voiceover; any additional audio in the
  // bundle is not silently dropped — it becomes ordinary media, exactly like
  // any other audio file `ingestZip` would keep.
  const voiceoverEntry = audioEntries[0];
  for (const extra of audioEntries.slice(1)) {
    mediaEntries.push({ name: extra.name, blob: extra.blob, type: 'audio' });
  }

  const missing: string[] = [];
  if (!pendingScript) missing.push('a script text file');
  if (!pendingScene) missing.push('a scene-details text file');
  if (!voiceoverEntry) missing.push('a voiceover audio file');
  if (mediaEntries.length === 0) missing.push('at least one media file');
  if (missing.length > 0) {
    return {
      kind: 'failure',
      message: `"${zipFile.name}" looks like a project bundle but is missing ${missing.join(', ')} — nothing was imported.`,
    };
  }

  // ---- Pass 2: validation passed — persist media through the vault door. ----
  const counts: MediaIngestCounts = { imported: 0, deduped: 0, unsupportedSkipped, failed: unsafeRejected };
  const seenHashes = new Set<string>(existingHashes);
  const duplicateNames: string[] = [];
  const mediaAssets: Asset[] = [];
  const offline = makeOfflineReconnectSink(offlineHashes);
  await mapPool(mediaEntries, 4, async m => {
    const asset = await ingestOneMediaFile(projectId, m.name, m.blob, m.type, seenHashes, counts, duplicateNames, offline);
    if (asset) mediaAssets.push(asset);
  });
  await finishIngestBatch();

  return {
    kind: 'success',
    scriptFile: new File([pendingScript!.text], pendingScript!.name, { type: 'text/plain' }),
    sceneFile: new File([pendingScene!.text], pendingScene!.name, { type: 'text/plain' }),
    voiceoverFile: withAudioMimeType(new File([voiceoverEntry!.blob], voiceoverEntry!.name)),
    mediaAssets,
    counts,
    duplicateNames,
    nestedZipsSkipped,
    ...(offline ? { reconnected: offline.found } : {}),
  };
}
