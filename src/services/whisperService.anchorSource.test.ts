/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5, docs/work-in-progress.md §11 item 1 (owner ruling R-G):
// `distributeSegmentTimes` gained an optional `anchorSource` parameter so a
// forced-alignment caller can label its own output `'forced-alignment'`
// instead of the hardcoded `'whisper'` every pre-existing call site relies
// on. This file is deliberately separate from the regression-locked
// `syncTiming.test.ts` (CLAUDE.md's Testing invariant — 150+ tests, the
// golden-replay diff target) — it covers only this new parameter, not the
// timing math `syncTiming.test.ts` already owns.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { distributeSegmentTimes } from './whisperService';
import type { VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

function makeSegment(partial: Partial<VideoSegment> & { id: string }): VideoSegment {
  return {
    text: 'hello world',
    startTime: 0,
    duration: 1,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    ...partial,
  };
}

describe('distributeSegmentTimes — anchorSource parameter', () => {
  it('defaults to "whisper" when the parameter is omitted (byte-identical to pre-FA behavior)', () => {
    const segments = [makeSegment({ id: 's1' })];
    const [updated] = distributeSegmentTimes(segments, [{ t0: 1, t1: 2 }]);
    expect(updated!.anchorSource).toBe('whisper');
  });

  it('sets "whisper" when explicitly passed', () => {
    const segments = [makeSegment({ id: 's1' })];
    const [updated] = distributeSegmentTimes(segments, [{ t0: 1, t1: 2 }], 'whisper');
    expect(updated!.anchorSource).toBe('whisper');
  });

  it('sets "forced-alignment" when explicitly passed', () => {
    const segments = [makeSegment({ id: 's1' })];
    const [updated] = distributeSegmentTimes(segments, [{ t0: 1, t1: 2 }], 'forced-alignment');
    expect(updated!.anchorSource).toBe('forced-alignment');
  });

  it('applies the same anchorSource uniformly across every unlocked segment in the call', () => {
    const segments = [makeSegment({ id: 's1' }), makeSegment({ id: 's2' })];
    const updated = distributeSegmentTimes(
      segments,
      [{ t0: 0, t1: 1 }, { t0: 1, t1: 2 }],
      'forced-alignment',
    );
    expect(updated.map(s => s.anchorSource)).toEqual(['forced-alignment', 'forced-alignment']);
  });

  it('leaves a locked segment (and its anchorSource) untouched regardless of the parameter', () => {
    const segments = [makeSegment({ id: 's1', locked: true, anchorSource: 'estimate', anchorStart: 5 })];
    const updated = distributeSegmentTimes(segments, [{ t0: 1, t1: 2 }], 'forced-alignment');
    expect(updated[0]!.anchorSource).toBe('estimate');
    expect(updated[0]!.anchorStart).toBe(5);
  });
});
