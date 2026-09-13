/**
 * Per-asset re-link state machine.
 *
 *   unresolved → proposed → confirmed → written
 *                               ↘ failed
 *   unresolved / proposed → failed
 *
 * `written` and `failed` are terminal. Nothing auto-confirms: even an
 * exact proposal stays in `proposed` until `confirmRelinkProposal`.
 */

import { confirmableProposals, proposalsForAsset } from './matchProposals';
import type { RelinkAssetRecord, RelinkPhase, RelinkProposal, RelinkTransitionResult } from './types';

const TERMINAL: ReadonlySet<RelinkPhase> = new Set(['written', 'failed']);

function cloneFlow(flow: readonly RelinkAssetRecord[]): RelinkAssetRecord[] {
  return flow.map((record) => ({
    ...record,
    proposals: [...record.proposals],
  }));
}

function replaceRecord(
  flow: readonly RelinkAssetRecord[],
  assetId: string,
  next: RelinkAssetRecord,
): RelinkAssetRecord[] {
  return flow.map((record) => (record.assetId === assetId ? next : record));
}

export function createRelinkFlow(assetIds: readonly string[]): RelinkAssetRecord[] {
  return assetIds.map((assetId) => ({
    assetId,
    phase: 'unresolved',
    proposals: [],
    confirmedCandidateId: null,
  }));
}

export function applyRelinkProposals(
  flow: readonly RelinkAssetRecord[],
  proposals: readonly RelinkProposal[],
): RelinkTransitionResult {
  const next = cloneFlow(flow);
  for (let i = 0; i < next.length; i += 1) {
    const record = next[i];
    if (!record || TERMINAL.has(record.phase) || record.phase === 'confirmed') continue;
    const forAsset = proposalsForAsset(proposals, record.assetId);
    next[i] = {
      ...record,
      proposals: forAsset,
      phase: confirmableProposals(forAsset).length > 0 ? 'proposed' : 'unresolved',
      confirmedCandidateId: null,
    };
  }
  return { ok: true, flow: next };
}

export function confirmRelinkProposal(
  flow: readonly RelinkAssetRecord[],
  assetId: string,
  candidateId: string,
): RelinkTransitionResult {
  const record = flow.find((row) => row.assetId === assetId);
  if (!record) return { ok: false, reason: `unknown asset ${assetId}`, flow: cloneFlow(flow) };
  if (record.phase !== 'proposed') {
    return { ok: false, reason: `cannot confirm from ${record.phase}`, flow: cloneFlow(flow) };
  }
  const proposal = record.proposals.find((row) => row.candidateId === candidateId);
  if (!proposal) {
    return { ok: false, reason: `no proposal for candidate ${candidateId}`, flow: cloneFlow(flow) };
  }
  if (proposal.confidence === 'rejected') {
    return { ok: false, reason: 'rejected proposals cannot be confirmed', flow: cloneFlow(flow) };
  }
  const taken = flow.some(
    (row) =>
      row.assetId !== assetId &&
      row.confirmedCandidateId === candidateId &&
      (row.phase === 'confirmed' || row.phase === 'written'),
  );
  if (taken) {
    return { ok: false, reason: `candidate ${candidateId} is already confirmed on another asset`, flow: cloneFlow(flow) };
  }
  return {
    ok: true,
    flow: replaceRecord(flow, assetId, {
      ...record,
      phase: 'confirmed',
      confirmedCandidateId: candidateId,
    }),
  };
}

export function markRelinkWritten(
  flow: readonly RelinkAssetRecord[],
  assetId: string,
): RelinkTransitionResult {
  const record = flow.find((row) => row.assetId === assetId);
  if (!record) return { ok: false, reason: `unknown asset ${assetId}`, flow: cloneFlow(flow) };
  if (record.phase !== 'confirmed' || record.confirmedCandidateId === null) {
    return { ok: false, reason: `cannot mark written from ${record.phase}`, flow: cloneFlow(flow) };
  }
  return {
    ok: true,
    flow: replaceRecord(flow, assetId, { ...record, phase: 'written' }),
  };
}

export function markRelinkFailed(
  flow: readonly RelinkAssetRecord[],
  assetId: string,
): RelinkTransitionResult {
  const record = flow.find((row) => row.assetId === assetId);
  if (!record) return { ok: false, reason: `unknown asset ${assetId}`, flow: cloneFlow(flow) };
  if (record.phase === 'written') {
    return { ok: false, reason: 'written is terminal', flow: cloneFlow(flow) };
  }
  return {
    ok: true,
    flow: replaceRecord(flow, assetId, {
      ...record,
      phase: 'failed',
      confirmedCandidateId: null,
    }),
  };
}

/**
 * The only exit from item A's degraded / poisoned load: every unresolved
 * asset has been confirmed and marked written. Aligns with
 * `canPersistRecoveredProject` — anything short of `written` keeps Save illegal.
 */
export function canLeaveDegradedRelinkFlow(flow: readonly RelinkAssetRecord[]): boolean {
  if (flow.length === 0) return false;
  return flow.every((record) => record.phase === 'written');
}

export function phasesOf(flow: readonly RelinkAssetRecord[]): RelinkPhase[] {
  return flow.map((record) => record.phase);
}
