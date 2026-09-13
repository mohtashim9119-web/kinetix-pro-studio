import { describe, it, expect } from 'vitest';
import {
  canPersistRecoveredProject,
  unresolvedAssetIds,
  type RecoveryAsset,
  type RecoverySegment,
} from './degradedLoad';

const resolved: RecoveryAsset = {
  id: 'a1',
  name: 'clip.mp4',
  unresolved: false,
};

const missing: RecoveryAsset = {
  id: 'a2',
  name: 'vo.wav',
  unresolved: true,
};

const okSegment: RecoverySegment = {
  id: 's1',
  label: 'Intro',
  assetId: 'a1',
  resolutionStatus: 'resolved',
};

const brokenSegment: RecoverySegment = {
  id: 's2',
  label: 'Voiceover',
  assetId: 'a2',
  resolutionStatus: 'unresolved',
};

describe('canPersistRecoveredProject', () => {
  it('is false while any asset is unresolved', () => {
    expect(canPersistRecoveredProject({
      assets: [resolved, missing],
      segments: [okSegment, brokenSegment],
    })).toBe(false);
  });

  it('is false when every asset is resolved but a segment is still unresolved', () => {
    expect(canPersistRecoveredProject({
      assets: [resolved],
      segments: [okSegment, brokenSegment],
    })).toBe(false);
  });

  it('is true only when every asset and segment is resolved', () => {
    expect(canPersistRecoveredProject({
      assets: [resolved],
      segments: [okSegment],
    })).toBe(true);
  });
});

describe('unresolvedAssetIds', () => {
  it('lists only unresolved ids', () => {
    expect(unresolvedAssetIds([resolved, missing])).toEqual(['a2']);
  });
});
