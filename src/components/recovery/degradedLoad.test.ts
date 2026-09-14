import { describe, it, expect } from 'vitest';
import {
  buildRecoveryItemRows,
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

describe('buildRecoveryItemRows', () => {
  const orphanAsset: RecoveryAsset = {
    id: 'a3',
    name: 'unused.wav',
    unresolved: true,
  };

  it('joins segment text, asset filename, and resolution status on one row', () => {
    const rows = buildRecoveryItemRows(
      [okSegment, brokenSegment],
      [resolved, missing],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      rowId: 's1',
      segmentLabel: 'Intro',
      assetName: 'clip.mp4',
      resolutionStatus: 'resolved',
      showRelink: false,
    });
    expect(rows[1]).toMatchObject({
      rowId: 's2',
      segmentLabel: 'Voiceover',
      assetName: 'vo.wav',
      resolutionStatus: 'unresolved',
      showRelink: true,
    });
  });

  it('appends orphan unresolved assets not referenced by any segment', () => {
    const rows = buildRecoveryItemRows([okSegment], [resolved, orphanAsset]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      rowId: 'orphan-a3',
      segmentLabel: null,
      assetName: 'unused.wav',
      resolutionStatus: 'unresolved',
      showRelink: true,
    });
  });
});
