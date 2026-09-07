/**
 * WS3 Defect 4d — `repairTimelineGaps`, the unblock for a project that ALREADY
 * has a hole saved in it.
 *
 * The safety property these tests exist to pin is narrow and total: the repair
 * writes ONE field (`duration`, on the earlier side of each hole) and never
 * writes a `startTime`. Every assertion about A/V sync follows from that, so it
 * is asserted directly and on every case.
 */
import { describe, it, expect } from 'vitest';
import {
  repairTimelineGaps,
  checkTimelineIsGapless,
  MAX_REPAIRABLE_GAP_SEC,
} from './timelinePartition';
import type { VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

const seg = (id: string, startTime: number, duration: number, extra: Partial<VideoSegment> = {}): VideoSegment => ({
  id,
  text: `t-${id}`,
  startTime,
  duration,
  transition: TransitionType.NONE,
  animation: AnimationType.NONE,
  order: 0,
  anchorStart: startTime,
  ...extra,
});

/** The safety property, asserted independently of the result record. */
function assertNoStartTimeMoved(before: readonly VideoSegment[], after: readonly VideoSegment[]): void {
  expect(after.length).toBe(before.length);
  for (let i = 0; i < before.length; i++) {
    expect(after[i]!.startTime, `segment ${i} startTime moved`).toBe(before[i]!.startTime);
    expect(after[i]!.id).toBe(before[i]!.id);
  }
}

describe('repairTimelineGaps', () => {
  it('closes the field shape — a 0.200s hole before segment 99 of 424', () => {
    const before: VideoSegment[] = [];
    for (let i = 0; i < 424; i++) before.push(seg(`s${i}`, i * 2, 2));
    // Punch exactly the reported hole. NOTE the indexing: the guard names the
    // LATER side, 1-based ("before segment 99"), so the hole sits between
    // array indices 97 and 98 and it is segments[97] that ends 0.200s early.
    before[97] = { ...before[97]!, duration: 1.8 };
    expect(checkTimelineIsGapless(before)).toContain('0.200s gap before segment 99');

    const result = repairTimelineGaps(before);

    expect(result.gapless).toBe(true);
    expect(checkTimelineIsGapless(result.segments)).toBeNull();
    expect(result.refusals).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      index: 97,
      segmentId: 's97',
      kind: 'gap',
      amountSec: 0.2,
      fromDuration: 1.8,
      toDuration: 2,
    });
    assertNoStartTimeMoved(before, result.segments);
  });

  it('is a no-op on an already-clean partition', () => {
    const before = [seg('a', 0, 2), seg('b', 2, 3), seg('c', 5, 1)];
    const result = repairTimelineGaps(before);
    expect(result.changes).toEqual([]);
    expect(result.refusals).toEqual([]);
    expect(result.gapless).toBe(true);
    expect(result.segments).toEqual(before);
  });

  it('closes an overlap by shrinking the earlier segment, same one-field rule', () => {
    const before = [seg('a', 0, 2.3), seg('b', 2, 3)];
    const result = repairTimelineGaps(before);
    expect(result.changes[0]).toMatchObject({ index: 0, kind: 'overlap', amountSec: 0.3, toDuration: 2 });
    expect(result.gapless).toBe(true);
    assertNoStartTimeMoved(before, result.segments);
  });

  it('refuses a hole larger than the threshold and reports it untouched', () => {
    const before = [seg('a', 0, 2), seg('b', 10, 3)];
    const result = repairTimelineGaps(before);
    expect(result.changes).toEqual([]);
    expect(result.refusals[0]).toMatchObject({ index: 0, kind: 'gap', reason: 'too-large' });
    expect(result.gapless).toBe(false);
    expect(result.segments[0]!.duration).toBe(2);
  });

  it('refuses to rewrite a LOCKED segment', () => {
    const before = [seg('a', 0, 1.8, { locked: true }), seg('b', 2, 3)];
    const result = repairTimelineGaps(before);
    expect(result.changes).toEqual([]);
    expect(result.refusals[0]).toMatchObject({ index: 0, reason: 'locked' });
    expect(result.segments[0]!.duration).toBe(1.8);
  });

  it('refuses an overlap that would drive the earlier segment under the minimum duration', () => {
    // Overlap of 0.95s — under the threshold, so 'too-large' does not fire
    // first — but closing it would leave 'a' only 0.05s long.
    const before = [seg('a', 0, 1), seg('b', 0.05, 3)];
    const result = repairTimelineGaps(before);
    expect(result.changes).toEqual([]);
    expect(result.refusals[0]).toMatchObject({ index: 0, reason: 'would-underflow' });
  });

  it('repairs several holes independently and never lets one affect the next', () => {
    const before = [seg('a', 0, 1.8), seg('b', 2, 2), seg('c', 4, 1.7), seg('d', 6, 2)];
    const result = repairTimelineGaps(before);
    expect(result.changes.map(c => c.index)).toEqual([0, 2]);
    expect(result.gapless).toBe(true);
    assertNoStartTimeMoved(before, result.segments);
  });

  it('threshold is a real gate, not decoration (destructive probe on the boundary)', () => {
    const justUnder = [seg('a', 0, 2 - (MAX_REPAIRABLE_GAP_SEC - 0.01)), seg('b', 2, 1)];
    expect(repairTimelineGaps(justUnder).changes).toHaveLength(1);
    const justOver = [seg('a', 0, 2 - (MAX_REPAIRABLE_GAP_SEC + 0.01)), seg('b', 2, 1)];
    expect(repairTimelineGaps(justOver).changes).toHaveLength(0);
    expect(repairTimelineGaps(justOver).refusals[0]!.reason).toBe('too-large');
  });

  it('does not mutate the input array or its segments', () => {
    const before = [seg('a', 0, 1.8), seg('b', 2, 2)];
    const snapshot = JSON.parse(JSON.stringify(before)) as VideoSegment[];
    repairTimelineGaps(before);
    expect(before).toEqual(snapshot);
  });
});
