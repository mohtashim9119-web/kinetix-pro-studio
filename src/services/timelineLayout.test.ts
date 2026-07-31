// §6.0 Timeline smoke tests (docs/sync-pipeline-contract-plan.md) — pure
// geometry helpers extracted out of Timeline.tsx / TimelineWaveform.tsx /
// DropZonePanel.tsx. No DOM harness needed (services/*.test.ts convention).
import { describe, it, expect } from 'vitest';
import { computeTotalDuration } from '../components/Timeline';
import {
  computeSegmentLayout,
  computeHeadingLayout,
  computeBoundaryMarkerPositions,
  computeWaveformTileSpecs,
  computeDurationBarHeightPx,
  computeZoomPixelsPerSecond,
  computeSeekTimeFromClientX,
  computeTrimDrag,
  resolveDropGapIndex,
} from './timelineLayout';
import type { VideoSegment, HeadingOverlay } from '../types';
import { TransitionType, AnimationType } from '../types';

function makeSeg(id: string, startTime: number, duration: number): VideoSegment {
  return {
    id,
    text: `seg-${id}`,
    order: 0,
    startTime,
    duration,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
  };
}

function makeHeading(id: string, time: number, duration: number): HeadingOverlay {
  return {
    id,
    time,
    duration,
    text: 'Heading',
    fontFamily: 'Inter',
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
    backgroundColor: '#000000',
    x: 50,
    y: 50,
  };
}

// ---------------------------------------------------------------------------
// Test 1 — computeTotalDuration
// ---------------------------------------------------------------------------
describe('computeTotalDuration (Test 1)', () => {
  it('contiguous segments sum to the shared end time', () => {
    expect(computeTotalDuration([makeSeg('a', 0, 5), makeSeg('b', 5, 5)])).toBe(10);
  });

  it('a gap takes the max-right-edge, NOT the naive duration sum', () => {
    // naive sum = 5 + 5 = 10; real rightmost edge = 8 + 5 = 13.
    expect(computeTotalDuration([makeSeg('a', 0, 5), makeSeg('b', 8, 5)])).toBe(13);
  });

  it('an overlap still takes the max-right-edge', () => {
    // second segment starts before the first ends; rightmost edge = 3 + 5 = 8.
    expect(computeTotalDuration([makeSeg('a', 0, 5), makeSeg('b', 3, 5)])).toBe(8);
  });

  it('an empty array falls back to 1', () => {
    expect(computeTotalDuration([])).toBe(1);
  });

  it('a single segment resolves to its own end time', () => {
    expect(computeTotalDuration([makeSeg('a', 2, 4)])).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Test 8a — computeTotalDuration edge cases (explicit, per the §6.0 matrix)
// ---------------------------------------------------------------------------
describe('computeTotalDuration edge cases (Test 8a)', () => {
  it('empty array === 1', () => {
    expect(computeTotalDuration([])).toBe(1);
  });

  it('single segment [{0,7}] -> 7', () => {
    expect(computeTotalDuration([makeSeg('a', 0, 7)])).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — computeSegmentLayout
// ---------------------------------------------------------------------------
describe('computeSegmentLayout (Test 2)', () => {
  it('derives left/width from the segment\'s OWN startTime/duration, not cumulative flexbox flow', () => {
    // A deliberate gap between segment 1 (ends at 3+4=7) and segment 2 (starts
    // at 9) — a naive left-to-right flexbox flow would place segment 2 at the
    // cumulative width of its predecessors (150+200=350px), not its own
    // startTime*pps (450px). This pins the abb642c bug class (absolute
    // positioning must be a pure function of the card's own startTime).
    const segs = [makeSeg('a', 0, 3), makeSeg('b', 3, 4), makeSeg('c', 9, 2)];
    const pps = 50;
    const layouts = segs.map((s) => computeSegmentLayout(s, pps));

    expect(layouts).toEqual([
      { left: 0, width: 150 },
      { left: 150, width: 200 },
      { left: 450, width: 100 },
    ]);

    const cumulativeFlexboxLeft = layouts[0]!.width + layouts[1]!.width; // 350
    expect(layouts[2]!.left).not.toBe(cumulativeFlexboxLeft);
    expect(layouts[2]!.left).toBe(450);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — computeBoundaryMarkerPositions
// ---------------------------------------------------------------------------
describe('computeBoundaryMarkerPositions (Test 3)', () => {
  it('emits N-1 markers, one per interior boundary, at segments[i+1].startTime * pps', () => {
    const segs = [makeSeg('a', 0, 3), makeSeg('b', 3, 4), makeSeg('c', 7, 2)];
    const pps = 50;
    expect(computeBoundaryMarkerPositions(segs, pps)).toEqual([
      { id: 'b', left: 150 },
      { id: 'c', left: 350 },
    ]);
  });

  it('a single segment has no interior boundaries', () => {
    expect(computeBoundaryMarkerPositions([makeSeg('a', 0, 5)], 50)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — computeWaveformTileSpecs
// ---------------------------------------------------------------------------
describe('computeWaveformTileSpecs (Test 4)', () => {
  it('splits a long timeline into >1 gapless, non-overlapping tile covering [0, totalDuration)', () => {
    const totalDuration = 500;
    const pps = 100;
    const dpr = 1;
    const maxCanvasWidth = 16384;
    const specs = computeWaveformTileSpecs(totalDuration, pps, dpr, maxCanvasWidth);

    expect(specs.length).toBeGreaterThan(1);

    // Gapless / non-overlapping: each tile's end is the next tile's start.
    for (let i = 0; i < specs.length - 1; i++) {
      expect(specs[i]!.tileEndTime).toBeCloseTo(specs[i + 1]!.tileStartTime, 9);
    }
    expect(specs[0]!.tileStartTime).toBe(0);
    expect(specs[specs.length - 1]!.tileEndTime).toBeCloseTo(totalDuration, 9);

    // Summed CSS widths cover the full timeline at this zoom, within rounding.
    const summedWidth = specs.reduce((acc, s) => acc + s.tileWidthCss, 0);
    expect(summedWidth).toBeCloseTo(totalDuration * pps, 6);

    // No tile's backing-store width crosses the browser canvas cap.
    for (const s of specs) {
      expect(s.canvasWidth).toBeLessThanOrEqual(16384);
    }
  });

  it('a short timeline fits in exactly one tile', () => {
    const specs = computeWaveformTileSpecs(60, 100, 1, 16384);
    expect(specs.length).toBe(1);
    expect(specs[0]!.tileStartTime).toBe(0);
    expect(specs[0]!.tileEndTime).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — contiguity-divergence pin
// ---------------------------------------------------------------------------
describe('contiguity-divergence pin (Test 5)', () => {
  const EPSILON_DIGITS = 9; // toBeCloseTo precision — 0.1+0.2 !== 0.3 in IEEE-754

  it('for a gapless array, max-end and duration-sum agree within floating-point tolerance', () => {
    const segs = [makeSeg('a', 0, 0.1), makeSeg('b', 0.1, 0.2), makeSeg('c', 0.3, 0.4)];
    const maxEnd = computeTotalDuration(segs);
    const durationSum = segs.reduce((acc, s) => acc + s.duration, 0);
    expect(maxEnd).toBeCloseTo(durationSum, EPSILON_DIGITS);
  });

  it('for a non-contiguous array, max-end and duration-sum diverge by exactly the gap size', () => {
    const gapSize = 3;
    const segs = [makeSeg('a', 0, 5), makeSeg('b', 8, 5)]; // gap between t=5 and t=8
    const maxEnd = computeTotalDuration(segs); // 13
    const durationSum = segs.reduce((acc, s) => acc + s.duration, 0); // 10
    expect(maxEnd - durationSum).toBeCloseTo(gapSize, EPSILON_DIGITS);
  });
});

// ---------------------------------------------------------------------------
// Test 10 — computeDurationBarHeightPx
// ---------------------------------------------------------------------------
describe('computeDurationBarHeightPx (Test 10)', () => {
  it.each([0, 0.5, 1, 5, 100])('clamps duration=%s (maxDuration=5) into [10, 32]', (duration) => {
    const h = computeDurationBarHeightPx(duration, 5);
    expect(h).toBeGreaterThanOrEqual(10);
    expect(h).toBeLessThanOrEqual(32);
  });

  it('is unclamped in the middle of the range', () => {
    // duration/maxDuration * 32 = 2.5/5 * 32 = 16, inside [10,32].
    expect(computeDurationBarHeightPx(2.5, 5)).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Supplementary — the remaining Part 1 extractions not named in the §6.0
// matrix (computeZoomPixelsPerSecond, computeHeadingLayout,
// computeSeekTimeFromClientX, computeTrimDrag, resolveDropGapIndex). Added so
// no newly-extracted pure function ships with zero coverage; not part of the
// audit's numbered test list.
// ---------------------------------------------------------------------------
describe('computeZoomPixelsPerSecond (supplementary)', () => {
  it('pins the slider at ppsMax when the content already fits the container', () => {
    // width*0.95/totalDuration = 800*0.95/1 = 760 >= ppsMax(100) -> pinned.
    expect(computeZoomPixelsPerSecond(1, 800, 0.5)).toBe(100);
  });

  it('falls back to an 800px container width when containerWidth is 0', () => {
    const withZero = computeZoomPixelsPerSecond(1, 0, 0.5);
    const withFallback = computeZoomPixelsPerSecond(1, 800, 0.5);
    expect(withZero).toBe(withFallback);
  });

  it('interpolates exponentially between ppsMin and ppsMax at sliderT extremes', () => {
    const totalDuration = 1000; // ppsMin = min(800*0.95/1000, 100) = 0.76
    const atZero = computeZoomPixelsPerSecond(totalDuration, 800, 0);
    const atOne = computeZoomPixelsPerSecond(totalDuration, 800, 1);
    expect(atZero).toBeCloseTo(0.76, 6);
    expect(atOne).toBeCloseTo(100, 6);
  });
});

describe('computeHeadingLayout (supplementary)', () => {
  it('reads the HeadingOverlay-specific time/duration fields (not startTime)', () => {
    const h = makeHeading('h1', 4, 2);
    expect(computeHeadingLayout(h, 50)).toEqual({ left: 200, width: 100 });
  });
});

describe('computeSeekTimeFromClientX (supplementary)', () => {
  it('divides by pixelsPerSecond and clamps to [0, totalDuration]', () => {
    expect(computeSeekTimeFromClientX(500, 50, 100)).toBe(10);
    expect(computeSeekTimeFromClientX(-100, 50, 100)).toBe(0);
    expect(computeSeekTimeFromClientX(100000, 50, 100)).toBe(100);
  });
});

describe('computeTrimDrag (supplementary)', () => {
  it('subtracts drag time from startTrim and clamps to [0, maxTrim]', () => {
    // deltaX=100 at pps=50 -> deltaTime=2s; startTrim=5 -> 5-2=3.
    expect(computeTrimDrag(100, 50, 5, 10)).toBe(3);
    // Clamps at 0 when the drag would push trimStart negative.
    expect(computeTrimDrag(1000, 50, 5, 10)).toBe(0);
    // Clamps at maxTrim when dragging the opposite direction past the bound.
    expect(computeTrimDrag(-1000, 50, 5, 10)).toBe(10);
  });
});

describe('resolveDropGapIndex (supplementary)', () => {
  it('returns the index of the first row whose midpoint sits below the pointer', () => {
    const rects = [
      { top: 0, height: 20 }, // midpoint 10
      { top: 20, height: 20 }, // midpoint 30
      { top: 40, height: 20 }, // midpoint 50
    ];
    expect(resolveDropGapIndex(rects, 5)).toBe(0);
    expect(resolveDropGapIndex(rects, 25)).toBe(1);
    expect(resolveDropGapIndex(rects, 999)).toBe(3); // below all rows
  });

  it('skips unmounted (null) rows without shifting later indices', () => {
    const rects = [{ top: 0, height: 20 }, null, { top: 40, height: 20 }];
    // pointer below the null row's slot but above the third row's midpoint.
    expect(resolveDropGapIndex(rects, 35)).toBe(2);
  });
});
