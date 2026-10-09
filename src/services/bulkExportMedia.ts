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
import { getProjectAssetRecoveryStatus } from './assetRecovery';
import { prepareProjectMedia, type MediaPreparationDeps } from './projectMediaPreparation';
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

/**
 * Loads the project's media for one export. THROWS (with a plain reason) when
 * a segment's media cannot be found anywhere — the caller parks the row.
 * Nothing is left minted on a throw.
 */
export async function loadProjectMedia(
  project: Project,
  deps: Partial<MediaPreparationDeps> = {},
  revokeUrl?: (url: string) => void,
): Promise<LoadedProjectMedia> {
  const { assets } = await prepareProjectMedia(project.id, project.assets, { deps });
  let revoked = false;
  const revoke = (): void => {
    if (revoked) return;
    revoked = true;
    for (const a of assets) if (a.url) (revokeUrl ?? URL.revokeObjectURL)(a.url);
  };
  // Only media a segment actually uses can fail the load; an unused orphan
  // stays offline exactly as it does when the project is opened.
  const issues = findMediaIssues(project.segments, assets);
  if (issues.offline.length > 0) {
    revoke();
    const n = issues.offline.length;
    throw new Error(`media could not be loaded from storage for ${n} scene${n === 1 ? '' : 's'}`);
  }
  return { project: { ...project, assets }, revoke };
}
