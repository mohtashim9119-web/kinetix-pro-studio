import { describe, it, expect } from 'vitest';
import type { Asset } from '../../types';
import type { AssetRecoveryEntry } from '../assetRecovery';
import { unresolvedMetadataFromAssets } from './fromRecoveryAssets';

const hero: Asset = {
  id: 'a1',
  name: 'hero-clip.mp4',
  url: 'blob:hero',
  type: 'video',
  duration: 10,
};

const vo: Asset = {
  id: 'a2',
  name: 'vo.wav',
  url: 'blob:vo',
  type: 'audio',
  duration: 30,
};

const still: Asset = {
  id: 'a3',
  name: 'still.png',
  url: 'blob:still',
  type: 'image',
};

const rows: AssetRecoveryEntry[] = [
  { assetId: 'a1', name: hero.name, type: 'video', cacheResolved: false, nativeResolved: false, resolved: false },
  { assetId: 'a2', name: vo.name, type: 'audio', cacheResolved: false, nativeResolved: true, resolved: true },
  { assetId: 'a3', name: still.name, type: 'image', cacheResolved: false, nativeResolved: false, resolved: false },
];

describe('unresolvedMetadataFromAssets', () => {
  it('keeps only assets that are short of CC resolved (cache or native)', () => {
    expect(unresolvedMetadataFromAssets([hero, vo, still], rows)).toEqual([
      { id: 'a1', name: 'hero-clip.mp4', type: 'video', duration: 10 },
      { id: 'a3', name: 'still.png', type: 'image', duration: null },
    ]);
  });

  it('does not treat nativeResolved as a separate backup that still needs re-link', () => {
    const onlyNative: AssetRecoveryEntry[] = [
      { assetId: 'a2', name: vo.name, type: 'audio', cacheResolved: false, nativeResolved: true, resolved: true },
    ];
    expect(unresolvedMetadataFromAssets([vo], onlyNative)).toEqual([]);
  });
});
