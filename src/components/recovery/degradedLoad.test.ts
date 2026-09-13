import { describe, it, expect } from 'vitest';
import type { ProjectAssetRecoveryStatus } from '../../services/assetRecovery';
import {
  canPersistRecoveredProject,
  recoveryAssetsFromStatus,
  unresolvedAssetIds,
  type RecoveryAsset,
  type RecoverySegment,
} from './degradedLoad';

const resolved: RecoveryAsset = {
  assetId: 'a1',
  name: 'clip.mp4',
  type: 'video',
  cacheResolved: true,
  nativeResolved: true,
  resolved: true,
};

const missing: RecoveryAsset = {
  assetId: 'a2',
  name: 'vo.wav',
  type: 'audio',
  cacheResolved: false,
  nativeResolved: false,
  resolved: false,
};

const nativeOnly: RecoveryAsset = {
  assetId: 'a3',
  name: 'still.png',
  type: 'image',
  cacheResolved: false,
  nativeResolved: true,
  resolved: true,
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

  it('treats nativeResolved as resolved — there is no separate backup flag', () => {
    expect(canPersistRecoveredProject({
      assets: [nativeOnly],
      segments: [{ id: 's3', label: 'Still', assetId: 'a3', resolutionStatus: 'resolved' }],
    })).toBe(true);
    expect(nativeOnly.resolved).toBe(nativeOnly.cacheResolved || nativeOnly.nativeResolved);
  });
});

describe('unresolvedAssetIds', () => {
  it('lists only unresolved ids', () => {
    expect(unresolvedAssetIds([resolved, missing, nativeOnly])).toEqual(['a2']);
  });
});

describe('recoveryAssetsFromStatus', () => {
  it('copies CC ProjectAssetRecoveryStatus rows without inventing a backup field', () => {
    const status: ProjectAssetRecoveryStatus = {
      projectId: 'p1',
      projectName: 'Talk',
      loadFailure: null,
      allResolved: false,
      assets: [resolved, missing, nativeOnly],
    };
    const rows = recoveryAssetsFromStatus(status);
    expect(rows).toEqual([resolved, missing, nativeOnly]);
    expect(rows.some((row) => 'backupExists' in row || 'nativeCopyExists' in row)).toBe(false);
    expect(rows.map((row) => row.nativeResolved)).toEqual([true, false, true]);
  });
});
