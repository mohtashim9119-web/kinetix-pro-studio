/**
 * Folder pick → one batch of candidate descriptors → per-asset proposals.
 * Pure: the caller already listed the folder. This does not walk a path.
 */

import { proposeRelinkMatches } from './matchProposals';
import { applyRelinkProposals, createRelinkFlow } from './relinkStateMachine';
import type { RelinkAssetRecord, RelinkCandidate, RelinkProposal, UnresolvedAssetMetadata } from './types';

export interface FolderBatchRelinkResult {
  proposals: RelinkProposal[];
  flow: RelinkAssetRecord[];
}

export function proposeFolderBatchRelink(
  assets: readonly UnresolvedAssetMetadata[],
  candidates: readonly RelinkCandidate[],
): FolderBatchRelinkResult {
  const proposals = proposeRelinkMatches(assets, candidates);
  const seeded = createRelinkFlow(assets.map((asset) => asset.id));
  const applied = applyRelinkProposals(seeded, proposals);
  return { proposals, flow: applied.flow };
}
