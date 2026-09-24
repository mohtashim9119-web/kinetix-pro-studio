/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Media workflow Unit 1 — the project-record half of an inline rename from
 * the Media block (the vault registry's display name is renamed separately,
 * via `media_vault_rename`). `Asset.name` is the match key "Match media to
 * scenes" reads, so this is how a wrongly named file gets fixed before a
 * Match.
 *
 * A rename onto a name another asset already matches as is ALLOWED — two
 * files can legitimately share a name — but reported, with "same as
 * matching" semantics: `isExactFilenameMatch` (extension-agnostic,
 * case/Unicode-folded), the exact tier Match itself uses.
 */

import type { Project } from '../types';
import { isExactFilenameMatch } from './syncEngine';

export interface AssetRenameResult {
  project: Project;
  /** Present when the new name now matches 2+ assets. */
  collision?: { name: string; count: number };
}

export function applyAssetRename(project: Project, assetId: string, newName: string): AssetRenameResult {
  if (!project.assets.some(a => a.id === assetId)) return { project };
  const assets = project.assets.map(a => (a.id === assetId ? { ...a, name: newName } : a));
  const sameName = assets.filter(a => a.type !== 'audio' && isExactFilenameMatch(newName, a.name));
  const next = { ...project, assets };
  return sameName.length > 1 ? { project: next, collision: { name: newName, count: sameName.length } } : { project: next };
}
