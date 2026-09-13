/**
 * Re-link resolution — types only.
 *
 * Metadata is whatever survived in project.json after item A poisoned the
 * load (`asset-unresolvable`). Candidate files are caller-supplied descriptors;
 * this module never reads the filesystem. Field names follow CC's published
 * `Asset` / `AssetRecoveryEntry` (`assetRecovery.ts`, `nativeAssetStore.ts`).
 */

import type { Asset } from '../../types';

export type RelinkAssetType = Asset['type'];

export type RelinkConfidence = 'exact' | 'probable' | 'rejected';

export type RelinkPhase = 'unresolved' | 'proposed' | 'confirmed' | 'written' | 'failed';

export interface UnresolvedAssetMetadata {
  id: string;
  name: string;
  type: RelinkAssetType;
  /** Seconds. `Asset.duration` when probed; null on images and probe misses. */
  duration: number | null;
}

export interface RelinkCandidate {
  id: string;
  /** File name or last path segment. Not a live handle. */
  name: string;
  type: RelinkAssetType;
  duration: number | null;
  /** Display / identity only. Never opened here. */
  path: string;
}

export interface RelinkMatchBasis {
  name: 'exact' | 'similar' | 'unrelated';
  type: 'match' | 'mismatch';
  duration: 'within-exact' | 'within-probable' | 'mismatch' | 'not-applicable';
}

export interface RelinkProposal {
  assetId: string;
  candidateId: string;
  confidence: RelinkConfidence;
  basis: RelinkMatchBasis;
  /** Set when more than one asset ranks this candidate confirmable. */
  manyToOneAssetIds: readonly string[];
  notes: readonly string[];
}

export interface RelinkAssetRecord {
  assetId: string;
  phase: RelinkPhase;
  proposals: readonly RelinkProposal[];
  confirmedCandidateId: string | null;
}

export type RelinkTransitionResult =
  | { ok: true; flow: RelinkAssetRecord[] }
  | { ok: false; reason: string; flow: RelinkAssetRecord[] };
