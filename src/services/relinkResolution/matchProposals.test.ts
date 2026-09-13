import { describe, it, expect } from 'vitest';
import {
  classifyRelinkMatch,
  proposeRelinkMatches,
  proposalsForAsset,
} from './matchProposals';
import type { RelinkCandidate, UnresolvedAssetMetadata } from './types';

const video = (over: Partial<UnresolvedAssetMetadata> & Pick<UnresolvedAssetMetadata, 'id' | 'name'>): UnresolvedAssetMetadata => ({
  type: 'video',
  duration: 12.5,
  ...over,
});

const candidate = (over: Partial<RelinkCandidate> & Pick<RelinkCandidate, 'id' | 'name'>): RelinkCandidate => ({
  type: 'video',
  duration: 12.5,
  path: `/Users/me/Footage/${over.name}`,
  ...over,
});

describe('classifyRelinkMatch', () => {
  it('is exact when normalized name, type, and duration all agree', () => {
    const result = classifyRelinkMatch(
      video({ id: 'a1', name: 'Hero_Clip.MP4' }),
      candidate({ id: 'c1', name: 'hero clip.mp4' }),
    );
    expect(result.confidence).toBe('exact');
    expect(result.basis).toEqual({ name: 'exact', type: 'match', duration: 'within-exact' });
  });

  it('is exact for images when name and type match and duration is absent on both', () => {
    const result = classifyRelinkMatch(
      { id: 'a1', name: 'still.png', type: 'image', duration: null },
      { id: 'c1', name: 'still.png', type: 'image', duration: null, path: '/stills/still.png' },
    );
    expect(result.confidence).toBe('exact');
    expect(result.basis.duration).toBe('not-applicable');
  });

  it('is probable when the name is similar or duration is only within probable slack', () => {
    const similar = classifyRelinkMatch(
      video({ id: 'a1', name: 'hero-clip.mp4' }),
      candidate({ id: 'c1', name: 'hero-clip-final.mp4' }),
    );
    expect(similar.confidence).toBe('probable');
    expect(similar.basis.name).toBe('similar');

    const durationOff = classifyRelinkMatch(
      video({ id: 'a1', name: 'hero-clip.mp4' }),
      candidate({ id: 'c1', name: 'hero-clip.mp4', duration: 13.4 }),
    );
    expect(durationOff.confidence).toBe('probable');
    expect(durationOff.basis.duration).toBe('within-probable');
  });

  it('rejects type mismatch and duration way outside tolerance', () => {
    const typeMismatch = classifyRelinkMatch(
      video({ id: 'a1', name: 'hero-clip.mp4' }),
      candidate({ id: 'c1', name: 'hero-clip.mp4', type: 'audio', duration: 12.5 }),
    );
    expect(typeMismatch.confidence).toBe('rejected');
    expect(typeMismatch.notes.join(' ')).toMatch(/type mismatch/);

    const durationWayOff = classifyRelinkMatch(
      video({ id: 'a1', name: 'hero-clip.mp4' }),
      candidate({ id: 'c1', name: 'hero-clip.mp4', duration: 120 }),
    );
    expect(durationWayOff.confidence).toBe('rejected');
    expect(durationWayOff.notes.join(' ')).toMatch(/duration/);
  });
});

describe('proposeRelinkMatches — ambiguity', () => {
  it('ranks one-to-many: one asset, several candidates, exact before probable', () => {
    const proposals = proposeRelinkMatches(
      [video({ id: 'a1', name: 'hero-clip.mp4' })],
      [
        candidate({ id: 'c-off', name: 'hero-clip-final.mp4' }),
        candidate({ id: 'c-exact', name: 'hero-clip.mp4' }),
        candidate({ id: 'c-wrong', name: 'other.mp4', duration: 3, type: 'audio' }),
      ],
    );
    const forAsset = proposalsForAsset(proposals, 'a1');
    expect(forAsset.map((row) => row.candidateId)).toEqual(['c-exact', 'c-off', 'c-wrong']);
    expect(forAsset.map((row) => row.confidence)).toEqual(['exact', 'probable', 'rejected']);
  });

  it('flags many-to-one: two assets, one confirmable candidate', () => {
    const proposals = proposeRelinkMatches(
      [video({ id: 'a1', name: 'hero-clip.mp4' }), video({ id: 'a2', name: 'hero-clip.mp4' })],
      [candidate({ id: 'c-shared', name: 'hero-clip.mp4' })],
    );
    const a1 = proposalsForAsset(proposals, 'a1')[0];
    const a2 = proposalsForAsset(proposals, 'a2')[0];
    expect(a1?.confidence).toBe('exact');
    expect(a2?.confidence).toBe('exact');
    expect(a1?.manyToOneAssetIds).toEqual(['a2']);
    expect(a2?.manyToOneAssetIds).toEqual(['a1']);
    expect(a1?.notes.join(' ')).toMatch(/also matches a2/);
  });
});
