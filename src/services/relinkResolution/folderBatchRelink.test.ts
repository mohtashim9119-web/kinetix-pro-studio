import { describe, it, expect } from 'vitest';
import { proposeFolderBatchRelink } from './folderBatchRelink';
import { canLeaveDegradedRelinkFlow, confirmRelinkProposal, markRelinkWritten } from './relinkStateMachine';
import { proposalsForAsset } from './matchProposals';
import type { RelinkCandidate, UnresolvedAssetMetadata } from './types';

const assets: UnresolvedAssetMetadata[] = [
  { id: 'a1', name: 'hero-clip.mp4', type: 'video', duration: 10 },
  { id: 'a2', name: 'vo.wav', type: 'audio', duration: 30 },
  { id: 'a3', name: 'still.png', type: 'image', duration: null },
];

const folder: RelinkCandidate[] = [
  { id: 'c1', name: 'hero-clip.mp4', type: 'video', duration: 10, path: '/Footage/hero-clip.mp4' },
  { id: 'c2', name: 'vo.wav', type: 'audio', duration: 30, path: '/Footage/vo.wav' },
  { id: 'c3', name: 'still.png', type: 'image', duration: null, path: '/Footage/still.png' },
  { id: 'c4', name: 'scratch.mp4', type: 'video', duration: 2, path: '/Footage/scratch.mp4' },
];

describe('proposeFolderBatchRelink', () => {
  it('matches many assets from one candidate set without writing or confirming', () => {
    const { proposals, flow } = proposeFolderBatchRelink(assets, folder);
    expect(flow.map((row) => row.phase)).toEqual(['proposed', 'proposed', 'proposed']);
    expect(proposalsForAsset(proposals, 'a1')[0]?.confidence).toBe('exact');
    expect(proposalsForAsset(proposals, 'a2')[0]?.confidence).toBe('exact');
    expect(proposalsForAsset(proposals, 'a3')[0]?.confidence).toBe('exact');
    expect(canLeaveDegradedRelinkFlow(flow)).toBe(false);
  });

  it('still requires a confirm+written step per asset after a folder pick', () => {
    const { flow } = proposeFolderBatchRelink(assets, folder);
    let next = flow;
    for (const [assetId, candidateId] of [['a1', 'c1'], ['a2', 'c2'], ['a3', 'c3']] as const) {
      const confirmed = confirmRelinkProposal(next, assetId, candidateId);
      expect(confirmed.ok).toBe(true);
      const written = markRelinkWritten(confirmed.flow, assetId);
      expect(written.ok).toBe(true);
      next = written.flow;
      if (assetId !== 'a3') expect(canLeaveDegradedRelinkFlow(next)).toBe(false);
    }
    expect(canLeaveDegradedRelinkFlow(next)).toBe(true);
  });
});
