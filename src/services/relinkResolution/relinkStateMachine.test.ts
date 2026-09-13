import { describe, it, expect } from 'vitest';
import { canPersistRecoveredProject } from '../../components/recovery/degradedLoad';
import { proposeRelinkMatches } from './matchProposals';
import {
  applyRelinkProposals,
  canLeaveDegradedRelinkFlow,
  confirmRelinkProposal,
  createRelinkFlow,
  markRelinkFailed,
  markRelinkWritten,
  phasesOf,
} from './relinkStateMachine';
import type { RelinkAssetRecord, RelinkCandidate, RelinkPhase, UnresolvedAssetMetadata } from './types';

const assetA: UnresolvedAssetMetadata = { id: 'a1', name: 'hero-clip.mp4', type: 'video', duration: 10 };
const assetB: UnresolvedAssetMetadata = { id: 'a2', name: 'b-roll.mp4', type: 'video', duration: 8 };
const candA: RelinkCandidate = { id: 'c1', name: 'hero-clip.mp4', type: 'video', duration: 10, path: '/m/hero-clip.mp4' };
const candB: RelinkCandidate = { id: 'c2', name: 'b-roll.mp4', type: 'video', duration: 8, path: '/m/b-roll.mp4' };

function seedProposed(assets: UnresolvedAssetMetadata[], candidates: RelinkCandidate[]): RelinkAssetRecord[] {
  const applied = applyRelinkProposals(createRelinkFlow(assets.map((a) => a.id)), proposeRelinkMatches(assets, candidates));
  expect(applied.ok).toBe(true);
  return applied.flow;
}

function writeAll(flow: RelinkAssetRecord[], pairs: Array<[string, string]>): RelinkAssetRecord[] {
  let next = flow;
  for (const [assetId, candidateId] of pairs) {
    const confirmed = confirmRelinkProposal(next, assetId, candidateId);
    expect(confirmed.ok).toBe(true);
    const written = markRelinkWritten(confirmed.flow, assetId);
    expect(written.ok).toBe(true);
    next = written.flow;
  }
  return next;
}

describe('relink state machine', () => {
  it('starts unresolved and never auto-confirms an exact match', () => {
    const flow = seedProposed([assetA], [candA]);
    expect(phasesOf(flow)).toEqual(['proposed']);
    expect(flow[0]?.proposals[0]?.confidence).toBe('exact');
    expect(flow[0]?.confirmedCandidateId).toBeNull();
    expect(canLeaveDegradedRelinkFlow(flow)).toBe(false);
  });

  it('walks unresolved → proposed → confirmed → written', () => {
    let flow = seedProposed([assetA], [candA]);
    const confirmed = confirmRelinkProposal(flow, 'a1', 'c1');
    expect(confirmed.ok).toBe(true);
    expect(phasesOf(confirmed.flow)).toEqual(['confirmed']);
    const written = markRelinkWritten(confirmed.flow, 'a1');
    expect(written.ok).toBe(true);
    expect(phasesOf(written.flow)).toEqual(['written']);
    expect(canLeaveDegradedRelinkFlow(written.flow)).toBe(true);
  });

  it('refuses to confirm a rejected proposal or to skip proposed', () => {
    const flow = seedProposed(
      [assetA],
      [{ id: 'c-audio', name: 'hero-clip.mp4', type: 'audio', duration: 10, path: '/m/x.wav' }],
    );
    expect(phasesOf(flow)).toEqual(['unresolved']);
    expect(confirmRelinkProposal(flow, 'a1', 'c-audio').ok).toBe(false);
    expect(markRelinkWritten(createRelinkFlow(['a1']), 'a1').ok).toBe(false);
  });

  it('will not confirm the same candidate onto two assets', () => {
    const shared: RelinkCandidate = { id: 'c-shared', name: 'hero-clip.mp4', type: 'video', duration: 10, path: '/m/hero-clip.mp4' };
    const twin: UnresolvedAssetMetadata = { id: 'a2', name: 'hero-clip.mp4', type: 'video', duration: 10 };
    let flow = seedProposed([assetA, twin], [shared]);
    const first = confirmRelinkProposal(flow, 'a1', 'c-shared');
    expect(first.ok).toBe(true);
    const second = confirmRelinkProposal(first.flow, 'a2', 'c-shared');
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected confirm to fail');
    expect(second.reason).toMatch(/already confirmed/);
    expect(canLeaveDegradedRelinkFlow(first.flow)).toBe(false);
  });

  it('marks failed as terminal and blocks leave-degraded', () => {
    const failed = markRelinkFailed(createRelinkFlow(['a1']), 'a1');
    expect(failed.ok).toBe(true);
    expect(phasesOf(failed.flow)).toEqual(['failed']);
    expect(canLeaveDegradedRelinkFlow(failed.flow)).toBe(false);
    expect(markRelinkWritten(failed.flow, 'a1').ok).toBe(false);
    expect(markRelinkFailed(writeAll(seedProposed([assetA], [candA]), [['a1', 'c1']]), 'a1').ok).toBe(false);
  });
});

describe('canLeaveDegradedRelinkFlow — extends the no-save invariant', () => {
  it('is false while any asset is short of written', () => {
    const short: RelinkPhase[] = ['unresolved', 'proposed', 'confirmed', 'failed'];
    for (const phase of short) {
      const flow: RelinkAssetRecord[] = [{
        assetId: 'a1',
        phase,
        proposals: [],
        confirmedCandidateId: phase === 'confirmed' ? 'c1' : null,
      }];
      expect(canLeaveDegradedRelinkFlow(flow)).toBe(false);
    }
  });

  it('agrees with canPersistRecoveredProject: not written ≡ still unresolved', () => {
    const mid = seedProposed([assetA, assetB], [candA, candB]);
    expect(canLeaveDegradedRelinkFlow(mid)).toBe(false);
    expect(canPersistRecoveredProject({
      assets: [
        { assetId: 'a1', name: assetA.name, type: 'video', cacheResolved: false, nativeResolved: false, resolved: false },
        { assetId: 'a2', name: assetB.name, type: 'video', cacheResolved: false, nativeResolved: false, resolved: false },
      ],
      segments: [
        { id: 's1', label: 'A', assetId: 'a1', resolutionStatus: 'unresolved' },
        { id: 's2', label: 'B', assetId: 'a2', resolutionStatus: 'unresolved' },
      ],
    })).toBe(false);

    const done = writeAll(mid, [['a1', 'c1'], ['a2', 'c2']]);
    expect(canLeaveDegradedRelinkFlow(done)).toBe(true);
    expect(canPersistRecoveredProject({
      assets: [
        { assetId: 'a1', name: assetA.name, type: 'video', cacheResolved: false, nativeResolved: true, resolved: true },
        { assetId: 'a2', name: assetB.name, type: 'video', cacheResolved: false, nativeResolved: true, resolved: true },
      ],
      segments: [
        { id: 's1', label: 'A', assetId: 'a1', resolutionStatus: 'resolved' },
        { id: 's2', label: 'B', assetId: 'a2', resolutionStatus: 'resolved' },
      ],
    })).toBe(true);
  });

  it('is false for an empty flow — there is no recovered project to persist', () => {
    expect(canLeaveDegradedRelinkFlow([])).toBe(false);
  });
});
