/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The ONE media preparation for a stored project: what opening it does before
// the editor sees it, shared by `handleSwitchProject` (App.tsx) and Bulk
// Export. IndexedDB read -> native repair -> vault repair -> silent
// re-import by original path -> blob URLs (+ video-duration backfill).
// Anything that needs a project's real media goes through here, never a copy.

import type { Asset } from '../types';
import { getAllAssetsForProject, type StoredAsset } from './assetStore';
import { withAssetLoadTimeout } from './assetLoadTimeout';
import { repairMissingAssetsFromNative, repairMissingAssetsFromVault } from './repairAssetsFromNative';
import { applySilentProvenanceResolution } from './assetResolutionLadder';
import { playableAudioBlob } from './audioFormats';

/** `signal` lets a caller that gave up release the element's pending load. */
export const getMediaDuration = (url: string, type: 'video' | 'audio', signal?: AbortSignal): Promise<number> => {
  return new Promise((resolve) => {
    const media = type === 'video' ? document.createElement('video') : document.createElement('audio');
    media.src = url;
    media.onloadedmetadata = () => resolve(media.duration);
    media.onerror = () => resolve(0);
    signal?.addEventListener('abort', () => {
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
    }, { once: true });
  });
};

/** A video's duration probe never answered: the media would not load. */
export const MEDIA_PROBE_TIMEOUT_MS = 20_000;

export class MediaLoadTimeoutError extends Error {
  constructor() {
    super('media would not load');
    this.name = 'MediaLoadTimeoutError';
  }
}

export interface MediaPreparationDeps {
  readStored: (projectId: string, label: string) => Promise<StoredAsset[]>;
  repairNative: typeof repairMissingAssetsFromNative;
  repairVault: typeof repairMissingAssetsFromVault;
  resolveByProvenance: typeof applySilentProvenanceResolution;
  makeUrl: (blob: Blob) => string;
  probeVideoDuration: (url: string, signal?: AbortSignal) => Promise<number>;
  /** Frees a blob URL minted by `makeUrl` (a failed preparation frees all of its own). */
  revokeUrl: (url: string) => void;
  /** Bound on one duration probe; past it the preparation fails loudly. */
  probeTimeoutMs: number;
}

const defaultDeps: MediaPreparationDeps = {
  readStored: (id, label) => withAssetLoadTimeout(getAllAssetsForProject(id), label),
  repairNative: repairMissingAssetsFromNative,
  repairVault: repairMissingAssetsFromVault,
  resolveByProvenance: applySilentProvenanceResolution,
  makeUrl: blob => URL.createObjectURL(blob),
  probeVideoDuration: (url, signal) => getMediaDuration(url, 'video', signal),
  revokeUrl: url => URL.revokeObjectURL(url),
  probeTimeoutMs: MEDIA_PROBE_TIMEOUT_MS,
};

/** The probe, bounded. A hung <video> metadata load must never leave the
 *  caller on "Loading media…" forever. */
function probeBounded(deps: MediaPreparationDeps, url: string): Promise<number> {
  const abort = new AbortController();
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      abort.abort();
      reject(new MediaLoadTimeoutError());
    }, deps.probeTimeoutMs);
    deps.probeVideoDuration(url, abort.signal).then(
      (d) => { clearTimeout(timer); resolve(d); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export interface PreparedProjectMedia {
  /** Every asset, rehydrated; an orphan keeps its row with url '' and unresolved. */
  assets: Asset[];
  /** Assets whose bytes are in no store (also flagged unresolved above). */
  orphaned: Asset[];
}

/**
 * Prepares `assets` of one stored project. `onOrphans` runs as soon as the
 * orphans are known — before any blob URL is minted — so a caller can poison
 * the project and warn exactly where opening always did.
 */
export async function prepareProjectMedia(
  projectId: string,
  assets: readonly Asset[],
  opts: { onOrphans?: (orphans: Asset[]) => void; deps?: Partial<MediaPreparationDeps> } = {},
): Promise<PreparedProjectMedia> {
  const deps = { ...defaultDeps, ...opts.deps };
  // Bounded so a stuck store cannot hold the caller open forever.
  const stored = await deps.readStored(projectId, 'getAllAssetsForProject(switch)').catch((err) => {
    console.warn('[kinetix] IndexedDB asset read failed or timed out:', err);
    return [] as StoredAsset[];
  });
  const blobMap = new Map(stored.map(a => [a.id, a]));

  // An asset missing from IndexedDB but present in the NATIVE store is only a
  // cache miss: rebuild IndexedDB from it.
  let missingIds = assets.map(a => a.id).filter(id => !blobMap.has(id));
  if (missingIds.length > 0) {
    const repair = await deps.repairNative(projectId, assets, missingIds);
    for (const repaired of repair.repaired) blobMap.set(repaired.id, repaired);
    missingIds = missingIds.filter(id => !blobMap.has(id));
  }
  // Second rung: the media vault still holds the same bytes under contentHash.
  if (missingIds.length > 0) {
    const vaultRepair = await deps.repairVault(projectId, assets, missingIds);
    for (const repaired of vaultRepair.repaired) blobMap.set(repaired.id, repaired);
    missingIds = missingIds.filter(id => !blobMap.has(id));
  }
  // Silently re-import assets whose exact path + size + hash still match;
  // weaker rungs fall through to unresolved.
  if (missingIds.length > 0) {
    const ladder = await deps.resolveByProvenance(projectId, assets, missingIds);
    if (ladder.resolved.length > 0) {
      const resolvedIds = new Set(ladder.resolved);
      const refreshed = await deps.readStored(projectId, 'getAllAssetsForProject(post-ladder)');
      for (const s of refreshed) {
        if (resolvedIds.has(s.id)) blobMap.set(s.id, s);
      }
    }
    missingIds = missingIds.filter(id => !blobMap.has(id));
  }

  const orphaned = assets.filter(a => !blobMap.has(a.id));
  if (orphaned.length > 0) opts.onOrphans?.(orphaned);
  const orphanedIds = new Set(orphaned.map(a => a.id));

  // Every URL minted here is freed if any asset fails to prepare: a failed
  // preparation leaves nothing behind.
  const minted: string[] = [];
  const settled = await Promise.allSettled(
    assets.map(async (asset): Promise<Asset> => {
      if (orphanedIds.has(asset.id)) return { ...asset, url: '', file: undefined, unresolved: true };
      const bytes = blobMap.get(asset.id)!;
      // 1.5.3 — repairs a voiceover persisted untyped (bundle door, pre-1.5.3).
      const playable = playableAudioBlob(bytes.blob, asset.name, asset.type);
      const url = deps.makeUrl(playable);
      minted.push(url);
      const file = new File([playable], asset.name, { type: playable.type });
      // Back-compat backfill: a project saved before Asset.duration existed.
      const duration = asset.type === 'video' && asset.duration === undefined
        ? await probeBounded(deps, url)
        : asset.duration;
      return { ...asset, url, file, duration, unresolved: false };
    }),
  );
  const failure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) {
    for (const url of minted) deps.revokeUrl(url);
    throw failure.reason;
  }
  const rehydrated = settled.map(r => (r as PromiseFulfilledResult<Asset>).value);
  return { assets: rehydrated, orphaned };
}
