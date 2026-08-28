/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { planRestoreCluster, applyRestoreToSegments, restoreSegmentsByGapId, subFrameFloorSeconds } from './absorbedGapRestore';
import { isSliceSegmentId } from './segmentId';
import type { AbsorbedGap, VideoSegment } from '../types';

function seg(id: string, startTime: number, duration: number, extra?: Partial<VideoSegment>): VideoSegment {
  return { id, text: '', startTime, duration, transition: 'none', animation: 'none', order: 0, ...extra } as VideoSegment;
}

function gap(segmentId: string, text: string, start: number, end: number, gapAudio: AbsorbedGap['gapAudio'] = 'silent'): AbsorbedGap {
  return { segmentId, text, span: { start, end }, gapAudio };
}

function assertGapless(segments: readonly VideoSegment[]): void {
  for (let i = 0; i < segments.length - 1; i++) {
    const end = Number((segments[i]!.startTime + segments[i]!.duration).toFixed(3));
    expect(end).toBeCloseTo(segments[i + 1]!.startTime, 3);
  }
}

describe('subFrameFloorSeconds', () => {
  it('is 2 frames at the given fps', () => {
    expect(subFrameFloorSeconds(24)).toBeCloseTo(2 / 24, 6);
  });
});

describe('planRestoreCluster', () => {
  it('produces one segment per gap, each carrying its own original id, when pieces clear the frame floor', () => {
    const gaps = [gap('d1', 'First.', 10, 12)];
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.merged).toBe(false);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]!.id).toBe('d1');
    expect(plan.segments[0]!.startTime).toBe(10);
    expect(plan.segments[0]!.duration).toBe(2);
  });

  it('splits a multi-gap cluster by character count, contiguous and exact', () => {
    const gaps = [gap('d1', 'AB', 10, 14), gap('d2', 'AAAABBBB', 10, 14)]; // 2 chars vs 8 chars
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.merged).toBe(false);
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0]!.startTime).toBe(10);
    const end0 = plan.segments[0]!.startTime + plan.segments[0]!.duration;
    expect(plan.segments[1]!.startTime).toBeCloseTo(end0, 3);
    const end1 = plan.segments[1]!.startTime + plan.segments[1]!.duration;
    expect(end1).toBeCloseTo(14, 3);
  });

  it('merges a cluster into ONE slice-id slot when per-piece share falls under the frame floor', () => {
    // v6-shaped case: 3 skips sharing 0.24s at 24fps -> 0.08s/piece, well under 2/24 (~0.083s).
    const gaps = [gap('d1', 'One.', 10, 10.24), gap('d2', 'Two.', 10, 10.24), gap('d3', 'Three.', 10, 10.24)];
    const plan = planRestoreCluster(gaps, 'hostA', 24);
    expect(plan.merged).toBe(true);
    expect(plan.segments).toHaveLength(1);
    expect(isSliceSegmentId(plan.segments[0]!.id)).toBe(true);
    expect(plan.segments[0]!.text).toBe('One. Two. Three.');
    expect(plan.segments[0]!.startTime).toBe(10);
    expect(plan.segments[0]!.duration).toBeCloseTo(0.24, 3);
  });

  it('never merges a single-gap cluster even if it is itself sub-frame', () => {
    const gaps = [gap('d1', 'Solo.', 10, 10.01)];
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.merged).toBe(false);
    expect(plan.segments[0]!.id).toBe('d1');
  });
});

describe('applyRestoreToSegments', () => {
  it('restores a single dropped scene between two survivors, staying gapless', () => {
    // host [0,2) shrunk into the gap up to boundary 2.5; next starts at 2.5.
    // True reclaimable span (A1) is [1.8, 3.4).
    const segments = [
      seg('host', 0, 2.5, { absorbedGaps: [gap('d1', 'Dropped.', 1.8, 3.4)] }),
      seg('next', 2.5, 2),
    ];
    const out = applyRestoreToSegments(segments, 0, [gap('d1', 'Dropped.', 1.8, 3.4)], 24);

    expect(out).toHaveLength(3);
    expect(out[0]!.id).toBe('host');
    expect(out[0]!.duration).toBeCloseTo(1.8, 3); // shrunk back to span.start
    expect(out[0]!.absorbedGaps).toBeUndefined();
    expect(out[1]!.id).toBe('d1');
    expect(out[1]!.startTime).toBeCloseTo(1.8, 3);
    expect(out[2]!.id).toBe('next');
    expect(out[2]!.startTime).toBeCloseTo(3.4, 3);
    assertGapless(out);
  });

  it('keeps other absorbedGaps entries on the host that were not restored', () => {
    const segments = [
      seg('host', 0, 2.5, {
        absorbedGaps: [gap('d1', 'Dropped.', 1.8, 3.4), gap('d2', 'Other.', 5, 6)],
      }),
      seg('next', 2.5, 2),
    ];
    const out = applyRestoreToSegments(segments, 0, [gap('d1', 'Dropped.', 1.8, 3.4)], 24);
    expect(out[0]!.absorbedGaps).toHaveLength(1);
    expect(out[0]!.absorbedGaps![0]!.segmentId).toBe('d2');
  });

  it('restores a multi-gap cluster as contiguous inserted segments, staying gapless', () => {
    const gaps = [gap('d1', 'AB', 1.8, 3.4), gap('d2', 'AAAABBBB', 1.8, 3.4)];
    const segments = [
      seg('host', 0, 2.5, { absorbedGaps: gaps }),
      seg('next', 2.5, 2),
    ];
    const out = applyRestoreToSegments(segments, 0, gaps, 24);
    expect(out).toHaveLength(4);
    assertGapless(out);
    expect(out[3]!.startTime).toBeCloseTo(3.4, 3);
  });

  it('restoring the trailing gap on the LAST segment stretches the restored piece to the host\'s old end', () => {
    // host [0,5) is the LAST segment, previously extended to audioDuration = 5
    // by the last-survivor rule. True reclaimable span [1.8, 3.4).
    const segments = [seg('host', 0, 5, { absorbedGaps: [gap('d1', 'Tail.', 1.8, 3.4)] })];
    const out = applyRestoreToSegments(segments, 0, [gap('d1', 'Tail.', 1.8, 3.4)], 24);
    expect(out).toHaveLength(2);
    expect(out[0]!.duration).toBeCloseTo(1.8, 3);
    expect(out[1]!.startTime).toBeCloseTo(1.8, 3);
    // stretched from [1.8,3.4) (1.6s) out to the host's old end (5s) -> 3.2s total duration
    expect(out[1]!.duration).toBeCloseTo(3.2, 3);
    expect(out[1]!.startTime + out[1]!.duration).toBeCloseTo(5, 3);
    assertGapless(out);
  });

  it('a merged sub-frame cluster restores as one gapless slot carrying every piece\'s text', () => {
    const gaps = [gap('d1', 'One.', 1.8, 2.04), gap('d2', 'Two.', 1.8, 2.04), gap('d3', 'Three.', 1.8, 2.04)];
    const segments = [
      seg('host', 0, 1.9, { absorbedGaps: gaps }),
      seg('next', 1.9, 3),
    ];
    const out = applyRestoreToSegments(segments, 0, gaps, 24);
    expect(out).toHaveLength(3);
    expect(isSliceSegmentId(out[1]!.id)).toBe(true);
    expect(out[1]!.text).toBe('One. Two. Three.');
    assertGapless(out);
  });

  it('is a no-op when gapsToRestore is empty', () => {
    const segments = [seg('host', 0, 2), seg('next', 2, 2)];
    const out = applyRestoreToSegments(segments, 0, [], 24);
    expect(out).toEqual(segments);
  });

  it('is pure — does not mutate the input array', () => {
    const segments = [
      seg('host', 0, 2.5, { absorbedGaps: [gap('d1', 'Dropped.', 1.8, 3.4)] }),
      seg('next', 2.5, 2),
    ];
    const snapshot = JSON.parse(JSON.stringify(segments));
    applyRestoreToSegments(segments, 0, [gap('d1', 'Dropped.', 1.8, 3.4)], 24);
    expect(segments).toEqual(snapshot);
  });
});

describe('restoreSegmentsByGapId', () => {
  it('restores a named gap wherever it is hosted, leaving unrelated gaps untouched', () => {
    // Current (pre-restore) boundaries sit at the SNAPPED midpoint of each
    // gap's span (2.6 for [1.8,3.4), 7.6 for [7.2,8.0)) — the realistic
    // post-snapCoveredBoundaries shape, not the already-restored shape.
    const segments = [
      seg('a', 0, 2.6, { absorbedGaps: [gap('d1', 'One.', 1.8, 3.4)] }),
      seg('b', 2.6, 3.0),
      seg('c', 5.6, 2.0, { absorbedGaps: [gap('d2', 'Two.', 7.2, 8.0)] }),
      seg('d', 7.6, 2.4),
    ];
    assertGapless(segments); // fixture sanity
    const out = restoreSegmentsByGapId(segments, new Set(['d1']), 24);
    assertGapless(out);
    expect(out.map(s => s.id)).toEqual(['a', 'd1', 'b', 'c', 'd']);
    expect(out.find(s => s.id === 'c')!.absorbedGaps).toHaveLength(1); // d2 untouched
  });

  it('restores clusters on two different hosts in one call without index corruption', () => {
    const segments = [
      seg('a', 0, 2.6, { absorbedGaps: [gap('d1', 'One.', 1.8, 3.4)] }),
      seg('b', 2.6, 5.0, { absorbedGaps: [gap('d2', 'Two.', 7.2, 8.0)] }),
      seg('c', 7.6, 2.4),
    ];
    assertGapless(segments); // fixture sanity
    const out = restoreSegmentsByGapId(segments, new Set(['d1', 'd2']), 24);
    assertGapless(out);
    expect(out.map(s => s.id)).toEqual(['a', 'd1', 'b', 'd2', 'c']);
  });

  it('restores only ONE of two independent clusters hosted on the same segment', () => {
    const segments = [
      seg('a', 0, 1.9, { absorbedGaps: [gap('d1', 'One.', 1.8, 2.0)] }),
      seg('m', 1.9, 2.2, { absorbedGaps: [gap('d2', 'Two.', 4.0, 4.2)] }),
      seg('b', 4.1, 2),
    ];
    assertGapless(segments); // fixture sanity
    const out = restoreSegmentsByGapId(segments, new Set(['d2']), 24);
    assertGapless(out);
    expect(out.map(s => s.id)).toEqual(['a', 'm', 'd2', 'b']);
  });

  it('is a no-op for an empty id set', () => {
    const segments = [seg('a', 0, 2)];
    expect(restoreSegmentsByGapId(segments, new Set(), 24)).toEqual(segments);
  });
});
