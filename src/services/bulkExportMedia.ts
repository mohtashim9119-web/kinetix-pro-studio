/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk Export — real media. A stored project record never carries media URLs
// (projectStore writes every asset with url ''), so "url '' = offline" is only
// true of a record, never of the media on disk. Two seams, both over storage:
//
//  - `withStorageAvailability`: the pre-start CHECK. Asks storage (the same
//    question opening a project asks) and stamps each asset that has bytes
//    with a placeholder url so the shared media check reads the truth.
//    The placeholder is never exported from — it only answers "is it there".
//  - `loadProjectMedia`: the EXPORT. Loads the bytes the way
//    handleSwitchProject does (IndexedDB read → native repair → vault repair
//    → blob URLs) and hands back a revoke that frees every URL it minted.

import type { Asset, Project } from '../types';
import { getAllAssetsForProject, type StoredAsset } from './assetStore';
import { getProjectAssetRecoveryStatus } from './assetRecovery';
import { repairMissingAssetsFromNative, repairMissingAssetsFromVault } from './repairAssetsFromNative';
import { playableAudioBlob } from './audioFormats';
import { withAssetLoadTimeout } from './assetLoadTimeout';
import { findMediaIssues } from './exportFailure/missingMediaMessage';

/** Stamped on assets storage can supply; truthy is all the media check reads. */
export const STORAGE_AVAILABLE_URL = 'storage:available';

/** The project with each asset's url/unresolved set from what storage holds. */
export async function withStorageAvailability(
  project: Project,
  status: (id: string) => ReturnType<typeof getProjectAssetRecoveryStatus> = getProjectAssetRecoveryStatus,
): Promise<Project> {
  let resolved: Map<string, boolean> | null = null;
  try {
    const s = await status(project.id);
    if (s) resolved = new Map(s.assets.map(a => [a.assetId, a.resolved]));
  } catch (err) {
    console.warn('[bulk-export] could not read storage for', project.id, err);
  }
  // Storage unreadable: nothing is called offline here — the export's own
  // load runs next and parks the row with the real reason if it truly fails.
  return {
    ...project,
    assets: project.assets.map(a => {
      const has = resolved ? resolved.get(a.id) === true : true;
      return has
        ? { ...a, url: STORAGE_AVAILABLE_URL, unresolved: false }
        : { ...a, url: '', unresolved: true };
    }),
  };
}

export interface LoadedProjectMedia {
  project: Project;
  /** Frees every blob URL this load minted. Safe to call more than once. */
  revoke(): void;
}

export interface MediaLoadDeps {
  readStored: (projectId: string) => Promise<StoredAsset[]>;
  repairNative: typeof repairMissingAssetsFromNative;
  repairVault: typeof repairMissingAssetsFromVault;
  makeUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
}

const defaultDeps: MediaLoadDeps = {
  readStored: id => withAssetLoadTimeout(getAllAssetsForProject(id), 'getAllAssetsForProject(bulk export)'),
  repairNative: repairMissingAssetsFromNative,
  repairVault: repairMissingAssetsFromVault,
  makeUrl: blob => URL.createObjectURL(blob),
  revokeUrl: url => URL.revokeObjectURL(url),
};

/**
 * Loads the project's media for one export. THROWS (with a plain reason) when
 * a segment's media cannot be found anywhere — the caller parks the row.
 * Nothing is left minted on a throw.
 */
export async function loadProjectMedia(
  project: Project,
  overrides: Partial<MediaLoadDeps> = {},
): Promise<LoadedProjectMedia> {
  const deps = { ...defaultDeps, ...overrides };
  let stored: StoredAsset[];
  try {
    stored = await deps.readStored(project.id);
  } catch (err) {
    console.warn('[bulk-export] IndexedDB asset read failed; trying the native store:', err);
    stored = [];
  }
  const blobs = new Map(stored.map(a => [a.id, a]));

  let missing = project.assets.map(a => a.id).filter(id => !blobs.has(id));
  if (missing.length > 0) {
    const native = await deps.repairNative(project.id, project.assets, missing);
    for (const r of native.repaired) blobs.set(r.id, r);
    missing = missing.filter(id => !blobs.has(id));
  }
  if (missing.length > 0) {
    const vault = await deps.repairVault(project.id, project.assets, missing);
    for (const r of vault.repaired) blobs.set(r.id, r);
    missing = missing.filter(id => !blobs.has(id));
  }

  const minted: string[] = [];
  const revoke = (): void => {
    for (const url of minted.splice(0)) deps.revokeUrl(url);
  };
  const assets: Asset[] = project.assets.map(a => {
    const bytes = blobs.get(a.id);
    if (!bytes) return { ...a, url: '', file: undefined, unresolved: true };
    const blob = playableAudioBlob(bytes.blob, a.name, a.type);
    const url = deps.makeUrl(blob);
    minted.push(url);
    return { ...a, url, file: new File([blob], a.name, { type: blob.type }), unresolved: false };
  });

  // Only media a segment actually uses can fail the load; an unused orphan
  // asset stays offline exactly as it does when the project is opened.
  const issues = findMediaIssues(project.segments, assets);
  if (issues.offline.length > 0) {
    revoke();
    const n = issues.offline.length;
    throw new Error(`media could not be loaded from storage for ${n} scene${n === 1 ? '' : 's'}`);
  }
  return { project: { ...project, assets }, revoke };
}
