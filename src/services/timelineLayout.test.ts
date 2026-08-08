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

// ---------------------------------------------------------------------------
// Manual WKWebView checklist STEP 4 guard — the card layer and the waveform
// layer must derive their time->pixel mapping from ONE source.
//
// The failure this pins is real and was found by hand, not by CI: growing the
// LAST segment's right edge is the only drag that changes the timeline's total
// duration, and `computeZoomPixelsPerSecond`'s lower bound is a FIT-TO-WIDTH
// term — `(width * 0.95) / totalDuration`. So a longer timeline meant a smaller
// pixelsPerSecond, and every card's `left = startTime * pixelsPerSecond` moved,
// while the segment ARRAY was provably untouched outside the dragged index
// (dragTriage.test.ts's F2 block pins both halves, including the measured
// 300px -> 259.0909px displacement).
//
// The fix froze the zoom BASIS across a resize drag (Timeline.tsx's
// `zoomBasisDuration`). These tests guard the property that fix depends on: the
// two layers cannot be allowed to derive pixels-per-second independently, or
// they will disagree the moment one of them rebases and the other does not.
// jsdom has no layout engine, so this asserts the pixel ARITHMETIC both layers
// consume — visual alignment itself stays a manual-only check (checklist step 4).
// ---------------------------------------------------------------------------
describe('card lane / waveform lane time->pixel agreement (checklist step 4 guard)', () => {
  const segments = [makeSeg('a', 0, 30), makeSeg('b', 30, 45), makeSeg('c', 75, 25)];
  const containerWidth = 1000;
  const DPR = 2;
  const MAX_CANVAS = 16384;

  it('one shared pixelsPerSecond makes both layers span the identical pixel extent', () => {
    const totalDuration = computeTotalDuration(segments); // 100
    const pps = computeZoomPixelsPerSecond(totalDuration, containerWidth, 0.6);

    // Card layer: the timeline's full extent is the last card's right edge.
    const cardExtentPx = segments
      .map(s => computeSegmentLayout(s, pps))
      .reduce((max, l) => Math.max(max, l.left + l.width), 0);

    // Waveform layer: the lane is `totalDuration * pps` wide and is filled by
    // tiles laid end to end (Timeline.tsx's backgroundPosition/-Size lists).
    const tiles = computeWaveformTileSpecs(totalDuration, pps, DPR, MAX_CANVAS);
    const tileExtentPx = tiles.reduce((sum, t) => sum + t.tileWidthCss, 0);

    expect(tileExtentPx).toBeCloseTo(cardExtentPx, 6);
    expect(tileExtentPx).toBeCloseTo(totalDuration * pps, 6);
  });

  it('every tile is exactly its own duration wide at the shared zoom, so a time maps to one x in both layers', () => {
    const totalDuration = computeTotalDuration(segments);
    const pps = computeZoomPixelsPerSecond(totalDuration, containerWidth, 0.6);
    const tiles = computeWaveformTileSpecs(totalDuration, pps, DPR, MAX_CANVAS);

    for (const t of tiles) {
      expect(t.tileWidthCss).toBeCloseTo((t.tileEndTime - t.tileStartTime) * pps, 6);
    }

    // Each interior segment boundary resolves to the same x under the card
    // layer's formula and under the waveform layer's tile-offset arithmetic.
    for (const s of segments.slice(1)) {
      const cardLeft = computeSegmentLayout(s, pps).left;
      const tile = tiles.find(t => s.startTime >= t.tileStartTime && s.startTime < t.tileEndTime)
        ?? tiles[tiles.length - 1]!;
      const waveformX = tile.tileStartTime * pps + (s.startTime - tile.tileStartTime) * pps;
      expect(waveformX).toBeCloseTo(cardLeft, 6);
    }
  });

  it('PROOF THE GUARD HAS TEETH — two independently-derived zooms make the layers diverge', () => {
    // Exactly the checklist step 4 shape: the last segment grows by 20s. If the
    // card layer holds a frozen zoom basis while the waveform layer rebases on
    // the new live totalDuration (or vice versa), the two stop agreeing — which
    // is what "the cards drift against the waveform" looked like on screen.
    const grown = [makeSeg('a', 0, 30), makeSeg('b', 30, 45), makeSeg('c', 75, 45)];

    const frozenPps = computeZoomPixelsPerSecond(computeTotalDuration(segments), containerWidth, 0.6);
    const rebasedPps = computeZoomPixelsPerSecond(computeTotalDuration(grown), containerWidth, 0.6);
    expect(rebasedPps).toBeLessThan(frozenPps);

    const cardExtentPx = grown
      .map(s => computeSegmentLayout(s, frozenPps))
      .reduce((max, l) => Math.max(max, l.left + l.width), 0);
    const tileExtentPx = computeWaveformTileSpecs(computeTotalDuration(grown), rebasedPps, DPR, MAX_CANVAS)
      .reduce((sum, t) => sum + t.tileWidthCss, 0);

    // Divergence is not a rounding artifact — it is a visible fraction of the
    // lane. Asserting a floor rather than an exact figure keeps this a
    // statement about the failure MODE, not about today's constants.
    expect(Math.abs(tileExtentPx - cardExtentPx)).toBeGreaterThan(50);
  });

  it('the fit-to-width lower bound is what couples zoom to total duration — pinned directly', () => {
    // The mechanism itself, isolated from any layer. sliderT=0 selects ppsMin,
    // and ppsMin is monotonically decreasing in totalDuration until it saturates
    // at ppsMax=100 for content short enough to already fit.
    expect(computeZoomPixelsPerSecond(100, 1000, 0)).toBeCloseTo((1000 * 0.95) / 100, 9);
    expect(computeZoomPixelsPerSecond(120, 1000, 0)).toBeCloseTo((1000 * 0.95) / 120, 9);
    expect(computeZoomPixelsPerSecond(120, 1000, 0))
      .toBeLessThan(computeZoomPixelsPerSecond(100, 1000, 0));
    // Saturation: 5s of content fits 1000px many times over, so the fit term is
    // clamped and a duration change no longer moves the zoom at all.
    expect(computeZoomPixelsPerSecond(5, 1000, 0)).toBe(100);
    expect(computeZoomPixelsPerSecond(8, 1000, 0)).toBe(100);
  });
});
