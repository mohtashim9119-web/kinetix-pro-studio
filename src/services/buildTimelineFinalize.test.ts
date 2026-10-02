/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TransitionType, AnimationType, type Asset, type VideoSegment } from '../types';
import { matchEffectsAndLocks } from './buildTimelineFinalize';

function seg(partial: Partial<VideoSegment>): VideoSegment {
  return {
    id: 's1',
    order: 0,
    startTime: 0,
    duration: 1,
    text: 'hello',
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    ...partial,
  };
}

describe('matchEffectsAndLocks — the editor post-align steps bulk used to skip', () => {
  it('auto-matches media by name and restores a lock + effect from the previous scene', () => {
    const assets: Asset[] = [
      { id: 'clip-1', name: 'hello.jpg', url: 'blob:x', type: 'image', addedAt: 1 } as Asset,
    ];
    const previous = [seg({
      assetId: 'clip-1',
      locked: true,
      startTime: 0,
      duration: 1,
      effectGrade: { brightness: 0.2, contrast: 0, saturation: 0, temperature: 0.3 },
    })];
    const { segments, droppedLocks } = matchEffectsAndLocks(
      [seg({ id: 'fresh', assetId: undefined })],
      assets,
      previous,
      1,
    );
    expect(droppedLocks).toEqual([]);
    expect(segments[0]!.assetId).toBe('clip-1');
    expect(segments[0]!.locked).toBe(true);
    expect(segments[0]!.effectGrade?.temperature).toBe(0.3);
  });
});
