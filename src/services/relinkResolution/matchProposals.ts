/**
 * Pure ranking of re-link candidates against unresolved asset metadata.
 * Never auto-accepts. Even an `exact` row is only a proposal.
 */

import type {
  RelinkCandidate,
  RelinkConfidence,
  RelinkMatchBasis,
  RelinkProposal,
  UnresolvedAssetMetadata,
} from './types';

/** Absolute slack (seconds) for an exact duration match. */
export const EXACT_DURATION_ABS_SECONDS = 0.25;
/** Relative slack for an exact duration match. */
export const EXACT_DURATION_RATIO = 0.02;
/** Absolute slack (seconds) for a probable duration match. */
export const PROBABLE_DURATION_ABS_SECONDS = 2;
/** Relative slack for a probable duration match. */
export const PROBABLE_DURATION_RATIO = 0.15;

export function normalizeRelinkName(name: string): string {
  return name.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
}

export function relinkNameStem(name: string): string {
  const normalized = normalizeRelinkName(name);
  return normalized.replace(/\.[a-z0-9]+$/, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr: number[] = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? b.length;
}

function nameSimilarity(assetName: string, candidateName: string): RelinkMatchBasis['name'] {
  const a = relinkNameStem(assetName);
  const b = relinkNameStem(candidateName);
  if (a === b && a.length > 0) return 'exact';
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return 'similar';
  const longest = Math.max(a.length, b.length, 1);
  const ratio = 1 - levenshtein(a, b) / longest;
  return ratio >= 0.75 ? 'similar' : 'unrelated';
}

function durationBand(
  assetDuration: number | null,
  candidateDuration: number | null,
): RelinkMatchBasis['duration'] {
  if (assetDuration === null && candidateDuration === null) return 'not-applicable';
  if (assetDuration === null || candidateDuration === null) return 'within-probable';
  const delta = Math.abs(assetDuration - candidateDuration);
  const exactSlack = Math.max(EXACT_DURATION_ABS_SECONDS, assetDuration * EXACT_DURATION_RATIO);
  const probableSlack = Math.max(PROBABLE_DURATION_ABS_SECONDS, assetDuration * PROBABLE_DURATION_RATIO);
  if (delta <= exactSlack) return 'within-exact';
  if (delta <= probableSlack) return 'within-probable';
  return 'mismatch';
}

export function classifyRelinkMatch(
  asset: UnresolvedAssetMetadata,
  candidate: RelinkCandidate,
): { confidence: RelinkConfidence; basis: RelinkMatchBasis; notes: string[] } {
  const name = nameSimilarity(asset.name, candidate.name);
  const type: RelinkMatchBasis['type'] = asset.type === candidate.type ? 'match' : 'mismatch';
  const duration = durationBand(asset.duration, candidate.duration);
  const basis: RelinkMatchBasis = { name, type, duration };
  const notes: string[] = [];

  if (type === 'mismatch') {
    notes.push(`type mismatch (${asset.type} vs ${candidate.type})`);
    return { confidence: 'rejected', basis, notes };
  }
  if (duration === 'mismatch') {
    notes.push('duration outside probable tolerance');
    return { confidence: 'rejected', basis, notes };
  }
  if (name === 'exact' && (duration === 'within-exact' || duration === 'not-applicable')) {
    return { confidence: 'exact', basis, notes };
  }
  if (name === 'unrelated' && duration !== 'within-exact') {
    notes.push('name unrelated and duration not an exact match');
    return { confidence: 'rejected', basis, notes };
  }
  if (name === 'similar') notes.push('name is similar, not exact');
  if (duration === 'within-probable') notes.push('duration is within probable tolerance only');
  return { confidence: 'probable', basis, notes };
}

function rankScore(proposal: RelinkProposal): number {
  const confidenceRank = proposal.confidence === 'exact' ? 0 : proposal.confidence === 'probable' ? 1 : 2;
  const nameRank = proposal.basis.name === 'exact' ? 0 : proposal.basis.name === 'similar' ? 1 : 2;
  return confidenceRank * 10 + nameRank;
}

function annotateManyToOne(proposals: RelinkProposal[]): RelinkProposal[] {
  const confirmableByCandidate = new Map<string, string[]>();
  for (const proposal of proposals) {
    if (proposal.confidence === 'rejected') continue;
    const ids = confirmableByCandidate.get(proposal.candidateId) ?? [];
    ids.push(proposal.assetId);
    confirmableByCandidate.set(proposal.candidateId, ids);
  }
  return proposals.map((proposal) => {
    const claimants = confirmableByCandidate.get(proposal.candidateId) ?? [];
    if (claimants.length <= 1 || proposal.confidence === 'rejected') return proposal;
    const others = claimants.filter((id) => id !== proposal.assetId);
    return {
      ...proposal,
      manyToOneAssetIds: others,
      notes: [...proposal.notes, `candidate also matches ${others.join(', ')}`],
    };
  });
}

/**
 * Rank every candidate against every unresolved asset. One-to-many is the
 * natural per-asset list; many-to-one is flagged on each shared candidate.
 */
export function proposeRelinkMatches(
  assets: readonly UnresolvedAssetMetadata[],
  candidates: readonly RelinkCandidate[],
): RelinkProposal[] {
  const raw: RelinkProposal[] = [];
  for (const asset of assets) {
    const perAsset: RelinkProposal[] = candidates.map((candidate) => {
      const classified = classifyRelinkMatch(asset, candidate);
      return {
        assetId: asset.id,
        candidateId: candidate.id,
        confidence: classified.confidence,
        basis: classified.basis,
        manyToOneAssetIds: [],
        notes: classified.notes,
      };
    });
    perAsset.sort((a, b) => rankScore(a) - rankScore(b));
    raw.push(...perAsset);
  }
  return annotateManyToOne(raw);
}

export function proposalsForAsset(
  proposals: readonly RelinkProposal[],
  assetId: string,
): RelinkProposal[] {
  return proposals.filter((proposal) => proposal.assetId === assetId);
}

export function confirmableProposals(
  proposals: readonly RelinkProposal[],
): RelinkProposal[] {
  return proposals.filter((proposal) => proposal.confidence !== 'rejected');
}
