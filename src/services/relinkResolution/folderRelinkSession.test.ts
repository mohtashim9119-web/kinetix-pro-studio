import { describe, it, expect } from 'vitest';
import { proposeRelinkMatches } from './matchProposals';
import {
  defaultFolderSelection,
  selectedFolderWrites,
  toggleFolderSelection,
} from './folderRelinkSession';
import type { RelinkCandidate, UnresolvedAssetMetadata } from './types';

const assetA: UnresolvedAssetMetadata = { id: 'a1', name: 'hero.mp4', type: 'video', duration: 10 };
const assetB: UnresolvedAssetMetadata = { id: 'a2', name: 'b-roll.mp4', type: 'video', duration: 8 };
const assetImg: UnresolvedAssetMetadata = { id: 'a3', name: 'poster.png', type: 'image', duration: null };

// Exact match: same name + same duration.
const candAExact: RelinkCandidate = { id: 'c1', name: 'hero.mp4', type: 'video', duration: 10, path: '/m/hero.mp4' };
// Probable: same name, duration off (within probable tolerance only).
const candAProb: RelinkCandidate = { id: 'c2', name: 'hero.mp4', type: 'video', duration: 9.5, path: '/m/hero2.mp4' };
// Exact for B.
const candBExact: RelinkCandidate = { id: 'c3', name: 'b-roll.mp4', type: 'video', duration: 8, path: '/m/b-roll.mp4' };
// Image exact (duration not-applicable on both sides).
const candImgExact: RelinkCandidate = { id: 'c4', name: 'poster.png', type: 'image', duration: null, path: '/m/poster.png' };
// Wrong type — rejected.
const candAWrongType: RelinkCandidate = { id: 'c5', name: 'hero.mp4', type: 'audio', duration: 10, path: '/m/hero.wav' };

describe('folderRelinkSession — no non-exact match is auto-accepted', () => {
  it('pre-selects only exact matches; probable and rejected are NOT auto-accepted', () => {
    const proposals = proposeRelinkMatches(
      [assetA, assetB, assetImg],
      [candAExact, candAProb, candBExact, candImgExact, candAWrongType],
    );
    const selection = defaultFolderSelection(proposals);
    // a1 has an exact candidate (c1) → auto-selected.
    expect(selection['a1']).toBe('c1');
    // b1 exact → auto-selected.
    expect(selection['a2']).toBe('c3');
    // image exact → auto-selected.
    expect(selection['a3']).toBe('c4');
  });

  it('does not auto-select when the best proposal is only probable', () => {
    const proposals = proposeRelinkMatches([assetA], [candAProb]);
    const selection = defaultFolderSelection(proposals);
    expect(selection['a1']).toBeNull();
  });

  it('does not auto-select when every proposal is rejected', () => {
    const proposals = proposeRelinkMatches([assetA], [candAWrongType]);
    const selection = defaultFolderSelection(proposals);
    expect(selection['a1']).toBeNull();
  });

  it('toggle selects a probable match only on explicit user action', () => {
    const proposals = proposeRelinkMatches([assetA], [candAProb]);
    let selection = defaultFolderSelection(proposals);
    expect(selection['a1']).toBeNull();
    // The user explicitly opts into the probable match.
    selection = toggleFolderSelection(selection, 'a1', 'c2');
    expect(selection['a1']).toBe('c2');
    // Toggling again clears it.
    selection = toggleFolderSelection(selection, 'a1', 'c2');
    expect(selection['a1']).toBeNull();
  });

  it('selectedFolderWrites lists only the explicitly/auto selected pairs', () => {
    const proposals = proposeRelinkMatches(
      [assetA, assetB],
      [candAExact, candBExact, candAProb],
    );
    let selection = defaultFolderSelection(proposals);
    expect(selectedFolderWrites(selection)).toEqual([
      { assetId: 'a1', candidateId: 'c1' },
      { assetId: 'a2', candidateId: 'c3' },
    ]);
    // User deselects a1's exact match.
    selection = toggleFolderSelection(selection, 'a1', 'c1');
    expect(selectedFolderWrites(selection)).toEqual([{ assetId: 'a2', candidateId: 'c3' }]);
  });
});
