import { describe, it, expect } from 'vitest';
import {
  getActiveHeadingAt,
  clampHeadingsToDuration,
  createHeading,
  resizeHeading,
  MIN_HEADING_DURATION,
  interleaveHeadingRows,
  boundaryTimeForGap,
  segmentGapIndexForRow,
  centerHeadingOnBoundary,
  type InterleavedRow,
} from './headingLayer';
import type { HeadingOverlay, VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

function makeHeading(partial: Partial<HeadingOverlay> & { id: string }): HeadingOverlay {
  return {
    time: 0,
    duration: 1,
    text: 'Heading',
    fontFamily: 'Inter',
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
    backgroundColor: '#000000',
    x: 50,
    y: 50,
    ...partial,
  };
}

describe('getActiveHeadingAt', () => {
  it('is active exactly at its start time (start-inclusive)', () => {
    const h = makeHeading({ id: 'a', time: 5, duration: 2 });
    expect(getActiveHeadingAt([h], 5)).toBe(h);
  });

  it('is NOT active exactly at its end time (end-exclusive)', () => {
    const h = makeHeading({ id: 'a', time: 5, duration: 2 });
    expect(getActiveHeadingAt([h], 7)).toBeUndefined();
  });

  it('is active strictly inside its range', () => {
    const h = makeHeading({ id: 'a', time: 5, duration: 2 });
    expect(getActiveHeadingAt([h], 6)).toBe(h);
  });

  it('is not active outside its range', () => {
    const h = makeHeading({ id: 'a', time: 5, duration: 2 });
    expect(getActiveHeadingAt([h], 4.999)).toBeUndefined();
    expect(getActiveHeadingAt([h], 10)).toBeUndefined();
  });

  it('returns undefined when no headings intersect t', () => {
    const h1 = makeHeading({ id: 'a', time: 0, duration: 1 });
    const h2 = makeHeading({ id: 'b', time: 3, duration: 1 });
    expect(getActiveHeadingAt([h1, h2], 2)).toBeUndefined();
  });

  it('when overlapping headings both intersect t, the later one in array order wins', () => {
    const h1 = makeHeading({ id: 'a', time: 0, duration: 5 });
    const h2 = makeHeading({ id: 'b', time: 2, duration: 5 });
    expect(getActiveHeadingAt([h1, h2], 3)).toBe(h2);
    expect(getActiveHeadingAt([h2, h1], 3)).toBe(h1);
  });
});

describe('clampHeadingsToDuration', () => {
  it('leaves an in-range heading untouched', () => {
    const h = makeHeading({ id: 'a', time: 5, duration: 1 });
    const result = clampHeadingsToDuration([h], 10);
    expect(result[0]).toEqual(h);
    expect(result[0]?.needsReview).toBeUndefined();
  });

  it('clamps an out-of-range heading time to the new duration and sets needsReview', () => {
    const h = makeHeading({ id: 'a', time: 15, duration: 1 });
    const result = clampHeadingsToDuration([h], 10);
    expect(result[0]?.time).toBe(10);
    expect(result[0]?.needsReview).toBe(true);
  });

  it('clamps a heading whose time exactly equals the new duration (boundary is out-of-range)', () => {
    const h = makeHeading({ id: 'a', time: 10, duration: 1 });
    const result = clampHeadingsToDuration([h], 10);
    expect(result[0]?.time).toBe(10);
    expect(result[0]?.needsReview).toBe(true);
  });

  it('never deletes a heading, even when far out of range', () => {
    const h = makeHeading({ id: 'a', time: 1000, duration: 1 });
    const result = clampHeadingsToDuration([h], 10);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('a');
  });

  it('re-clamping an already-flagged heading does not corrupt it further', () => {
    const h = makeHeading({ id: 'a', time: 20, duration: 1, needsReview: true });
    // A second re-sync at an even shorter duration should still clamp correctly.
    const result = clampHeadingsToDuration([h], 8);
    expect(result[0]?.time).toBe(8);
    expect(result[0]?.needsReview).toBe(true);
  });

  it('does not mutate the input array', () => {
    const h = makeHeading({ id: 'a', time: 15, duration: 1 });
    const original = [h];
    clampHeadingsToDuration(original, 10);
    expect(original[0]?.time).toBe(15);
    expect(original[0]?.needsReview).toBeUndefined();
  });
});

describe('resizeHeading', () => {
  it('end edge: grows duration, leaves time untouched', () => {
    const result = resizeHeading({ time: 5, duration: 1 }, 'end', 2);
    expect(result).toEqual({ time: 5, duration: 3 });
  });

  it('end edge: shrinking below MIN_HEADING_DURATION clamps to the minimum', () => {
    const result = resizeHeading({ time: 5, duration: 1 }, 'end', -10);
    expect(result).toEqual({ time: 5, duration: MIN_HEADING_DURATION });
  });

  it('start edge: shrinking (positive delta) shifts time forward and keeps the opposite edge fixed', () => {
    const original = { time: 5, duration: 2 };
    const result = resizeHeading(original, 'start', 1);
    expect(result).toEqual({ time: 6, duration: 1 });
    // opposite edge (time + duration) is conserved
    expect(result.time + result.duration).toBe(original.time + original.duration);
  });

  it('start edge: growing (negative delta) shifts time backward and keeps the opposite edge fixed', () => {
    const original = { time: 5, duration: 2 };
    const result = resizeHeading(original, 'start', -3);
    expect(result).toEqual({ time: 2, duration: 5 });
    expect(result.time + result.duration).toBe(original.time + original.duration);
  });

  it('start edge: shrinking past MIN_HEADING_DURATION clamps duration to the minimum', () => {
    const result = resizeHeading({ time: 1, duration: 1 }, 'start', 5);
    expect(result.duration).toBeCloseTo(MIN_HEADING_DURATION);
    expect(result.time).toBeCloseTo(1 + (1 - MIN_HEADING_DURATION));
  });

  it('start edge: dragging past t=0 clamps time to 0 and grows duration to absorb the rest', () => {
    const result = resizeHeading({ time: 0.2, duration: 0.5 }, 'start', -5);
    expect(result.time).toBe(0);
    expect(result.duration).toBeCloseTo(0.7);
  });

  it('start edge: zero delta is a no-op', () => {
    const original = { time: 5, duration: 2 };
    expect(resizeHeading(original, 'start', 0)).toEqual(original);
  });
});

function makeSegment(partial: Partial<VideoSegment> & { id: string; startTime: number; duration: number }): VideoSegment {
  return {
    text: '',
    order: 0,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    ...partial,
  };
}

describe('interleaveHeadingRows', () => {
  it('returns segment-only rows in order when there are no headings', () => {
    const segs = [
      makeSegment({ id: 's1', startTime: 0, duration: 5 }),
      makeSegment({ id: 's2', startTime: 5, duration: 5 }),
    ];
    const rows = interleaveHeadingRows(segs, []);
    expect(rows).toEqual([
      { type: 'segment', segment: segs[0], index: 0 },
      { type: 'segment', segment: segs[1], index: 1 },
    ]);
  });

  it('places a heading immediately before the segment whose startTime equals the heading time (creation-time placement)', () => {
    const segs = [
      makeSegment({ id: 's1', startTime: 0, duration: 5 }),
      makeSegment({ id: 's2', startTime: 5, duration: 5 }),
    ];
    const h = { id: 'h1', time: 5 } as HeadingOverlay;
    const rows = interleaveHeadingRows(segs, [h]);
    expect(rows.map(r => r.type === 'heading' ? `h:${r.heading.id}` : `s:${r.segment.id}`))
      .toEqual(['s:s1', 'h:h1', 's:s2']);
  });

  it('places a heading before the very first segment when its time is at or before that segment\'s startTime', () => {
    const segs = [makeSegment({ id: 's1', startTime: 0, duration: 5 })];
    const h = { id: 'h1', time: 0 } as HeadingOverlay;
    const rows = interleaveHeadingRows(segs, [h]);
    expect(rows[0]).toEqual({ type: 'heading', heading: h });
  });

  it('places a heading after the last segment when its time is past the end of all segments', () => {
    const segs = [makeSegment({ id: 's1', startTime: 0, duration: 5 })];
    const h = { id: 'h1', time: 10 } as HeadingOverlay;
    const rows = interleaveHeadingRows(segs, [h]);
    expect(rows[rows.length - 1]).toEqual({ type: 'heading', heading: h });
  });

  it('sorts multiple headings by time regardless of input order', () => {
    const segs = [
      makeSegment({ id: 's1', startTime: 0, duration: 5 }),
      makeSegment({ id: 's2', startTime: 5, duration: 5 }),
    ];
    const hA = { id: 'hA', time: 5 } as HeadingOverlay;
    const hB = { id: 'hB', time: 0 } as HeadingOverlay;
    const rows = interleaveHeadingRows(segs, [hA, hB]);
    expect(rows.map(r => r.type === 'heading' ? r.heading.id : r.segment.id))
      .toEqual(['hB', 's1', 'hA', 's2']);
  });

  it('preserves relative order of headings that land at the exact same point', () => {
    const segs = [makeSegment({ id: 's1', startTime: 0, duration: 5 })];
    const hA = { id: 'hA', time: 0 } as HeadingOverlay;
    const hB = { id: 'hB', time: 0 } as HeadingOverlay;
    const rows = interleaveHeadingRows(segs, [hA, hB]);
    expect(rows.map(r => r.type === 'heading' ? r.heading.id : r.segment.id))
      .toEqual(['hA', 'hB', 's1']);
  });

  it('preserves the real segment-array index on segment rows even with headings interleaved', () => {
    const segs = [
      makeSegment({ id: 's1', startTime: 0, duration: 5 }),
      makeSegment({ id: 's2', startTime: 5, duration: 5 }),
    ];
    const h = { id: 'h1', time: 5 } as HeadingOverlay;
    const rows = interleaveHeadingRows(segs, [h]);
    const segRows = rows.filter((r): r is Extract<InterleavedRow, { type: 'segment' }> => r.type === 'segment');
    expect(segRows.map(r => r.index)).toEqual([0, 1]);
  });

  it('returns an empty list for no segments and no headings', () => {
    expect(interleaveHeadingRows([], [])).toEqual([]);
  });

  it('places all headings at the end when there are no segments', () => {
    const h = { id: 'h1', time: 3 } as HeadingOverlay;
    const rows = interleaveHeadingRows([], [h]);
    expect(rows).toEqual([{ type: 'heading', heading: h }]);
  });
});

describe('boundaryTimeForGap', () => {
  const segs = [
    { startTime: 0, duration: 5 },
    { startTime: 5, duration: 3 },
    { startTime: 8, duration: 4 },
  ];

  it('returns 0 for gap 0 before the first segment', () => {
    expect(boundaryTimeForGap(segs, 0)).toBe(0);
  });

  it('returns the following segment\'s startTime for a mid-list gap', () => {
    expect(boundaryTimeForGap(segs, 1)).toBe(5);
    expect(boundaryTimeForGap(segs, 2)).toBe(8);
  });

  it('returns the end of the last segment for the trailing gap', () => {
    expect(boundaryTimeForGap(segs, 3)).toBe(12);
  });

  it('clamps out-of-range gap indices', () => {
    expect(boundaryTimeForGap(segs, -5)).toBe(0);
    expect(boundaryTimeForGap(segs, 999)).toBe(12);
  });

  it('returns 0 for an empty segment list', () => {
    expect(boundaryTimeForGap([], 0)).toBe(0);
  });
});

describe('segmentGapIndexForRow', () => {
  it('counts only segment rows before the given row index', () => {
    const segs = [
      makeSegment({ id: 's1', startTime: 0, duration: 5 }),
      makeSegment({ id: 's2', startTime: 5, duration: 5 }),
    ];
    const h = { id: 'h1', time: 5 } as HeadingOverlay;
    const rows = interleaveHeadingRows(segs, [h]); // [s1, h1, s2]
    expect(segmentGapIndexForRow(rows, 0)).toBe(0); // before s1
    expect(segmentGapIndexForRow(rows, 1)).toBe(1); // between s1 and h1 — 1 segment seen
    expect(segmentGapIndexForRow(rows, 2)).toBe(1); // between h1 and s2 — still 1
    expect(segmentGapIndexForRow(rows, 3)).toBe(2); // after s2
  });

  it('clamps out-of-range row indices', () => {
    const rows: InterleavedRow[] = [
      { type: 'segment', segment: makeSegment({ id: 's1', startTime: 0, duration: 5 }), index: 0 },
    ];
    expect(segmentGapIndexForRow(rows, -1)).toBe(0);
    expect(segmentGapIndexForRow(rows, 999)).toBe(1);
  });

  it('returns 0 for an empty row list', () => {
    expect(segmentGapIndexForRow([], 0)).toBe(0);
  });
});

describe('centerHeadingOnBoundary', () => {
  it('centers a 1.0s heading on a mid-timeline boundary (0.5s into each neighbor)', () => {
    expect(centerHeadingOnBoundary(10, 1.0)).toBe(9.5);
  });

  it('is exact-center math for an arbitrary duration', () => {
    expect(centerHeadingOnBoundary(20, 4)).toBe(18);
  });

  it('clamps to 0 when the boundary is at the very start of the timeline', () => {
    expect(centerHeadingOnBoundary(0, 1.0)).toBe(0);
  });

  it('clamps to 0 when centering would push before t=0', () => {
    expect(centerHeadingOnBoundary(0.2, 1.0)).toBe(0);
  });
});

describe('createHeading', () => {
  it('defaults to an opaque background and 1.0s duration', () => {
    const h = createHeading(3);
    expect(h.backgroundColor).toBe('#000000');
    expect(h.duration).toBe(1.0);
    expect(h.time).toBe(3);
  });

  it('generates a unique id per call', () => {
    const h1 = createHeading(0);
    const h2 = createHeading(0);
    expect(h1.id).not.toBe(h2.id);
  });

  it('allows overriding defaults', () => {
    const h = createHeading(5, { text: 'Intro', color: '#ff0000' });
    expect(h.text).toBe('Intro');
    expect(h.color).toBe('#ff0000');
    expect(h.backgroundColor).toBe('#000000');
  });
});
