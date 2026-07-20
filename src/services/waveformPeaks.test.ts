import { describe, it, expect } from 'vitest';
import {
  buildWaveformSource,
  drawSegmentWaveform,
  drawFullWaveform,
  computeBackingDimensions,
  computeSegmentWindow,
  sampleColumnPeaks,
  WaveformSource,
  WAVEFORM_MAX_PPS,
  WAVEFORM_DPR_CAP,
  PEAKS_PER_SECOND,
  LANE_HEIGHT_PX,
  MAX_CANVAS_BACKING_WIDTH,
} from './waveformPeaks';

// ---------------------------------------------------------------------------
// This suite runs in plain node (no jsdom) — matching the repo's canvas-test
// precedent (canvasAnimations.test.ts, frameRenderer.blendCache.test.ts), which
// record calls into a hand-stubbed 2D context rather than a real canvas.
//
// So drawSegmentWaveform is exercised against a recording fake canvas: we assert
// no exceptions, correct backing-store dimensions, and correct branch behavior
// on the empty/silent/null cases (fill vs. stroke-only). Pixel-level color
// assertions are NOT practical here (no rasterizer); the drawn envelope geometry
// is covered indirectly through the pure column/dimension helpers, which ARE
// unit-tested directly. See the report note.
// ---------------------------------------------------------------------------

interface CtxRecord {
  clearRect: number;
  setTransform: Array<[number, number, number, number, number, number]>;
  moveTo: number;
  lineTo: number;
  fill: number;
  stroke: number;
  gradientStops: Array<[number, string]>;
}

function makeFakeCanvas(): { canvas: HTMLCanvasElement; rec: CtxRecord } {
  const rec: CtxRecord = {
    clearRect: 0,
    setTransform: [],
    moveTo: 0,
    lineTo: 0,
    fill: 0,
    stroke: 0,
    gradientStops: [],
  };

  const gradient = {
    addColorStop: (offset: number, color: string) => {
      rec.gradientStops.push([offset, color]);
    },
  };

  const ctx = {
    clearRect: () => {
      rec.clearRect++;
    },
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      rec.setTransform.push([a, b, c, d, e, f]);
    },
    createLinearGradient: () => gradient,
    beginPath: () => {},
    moveTo: () => {
      rec.moveTo++;
    },
    lineTo: () => {
      rec.lineTo++;
    },
    closePath: () => {},
    fill: () => {
      rec.fill++;
    },
    stroke: () => {
      rec.stroke++;
    },
    strokeStyle: '',
    fillStyle: '' as string | CanvasGradient,
    lineWidth: 1,
  };

  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
  } as unknown as HTMLCanvasElement;

  return { canvas, rec };
}

// ===========================================================================
// buildWaveformSource — §4.2
// ===========================================================================

describe('buildWaveformSource — peak (not mean) extraction', () => {
  it('records the MAX absolute amplitude per block, not the average', () => {
    // blockSize derived from the live PEAKS_PER_SECOND (mirrors
    // buildWaveformSource's own formula) so this test stays valid if the
    // density is retuned again — 2 full blocks, not a hardcoded sample count.
    const sampleRate = 2000;
    const blockSize = Math.max(1, Math.round(sampleRate / PEAKS_PER_SECOND));
    // Column 0: a single 0.5 spike among 0.1s (mean would be 0.14).
    // Column 1: flat 0.2 (mean == peak == 0.2).
    const pcm = new Float32Array(blockSize * 2);
    for (let i = 0; i < blockSize; i++) pcm[i] = 0.1;
    pcm[3] = 0.5; // the transient spike
    for (let i = blockSize; i < blockSize * 2; i++) pcm[i] = 0.2;

    const src = buildWaveformSource(pcm, sampleRate, pcm.length / sampleRate);

    expect(src.peaks.length).toBe(2);
    // Global peak is column 0's 0.5. Normalized: col0 = 1, col1 = 0.2/0.5 = 0.4.
    expect(src.peaks[0]).toBeCloseTo(1, 6);
    expect(src.peaks[1]).toBeCloseTo(0.4, 6); // 0.2/0.5 in float32
    // A MEAN implementation would have made col1 (0.2) > col0 (0.14) → col1 the
    // brightest. Peak extraction keeps col0 brightest.
    expect(src.peaks[0]!).toBeGreaterThan(src.peaks[1]!);
  });

  it('uses the negative absolute peak too (abs, not raw sign)', () => {
    const pcm = new Float32Array(10);
    pcm[5] = -0.8; // largest magnitude is negative
    const src = buildWaveformSource(pcm, 2000, 0.005);
    // blockSize 10 → 1 column; peak = |−0.8| = 0.8 → normalized to 1.
    expect(src.peaks.length).toBe(1);
    expect(src.peaks[0]).toBeCloseTo(1, 10);
  });
});

describe('buildWaveformSource — normalization', () => {
  it('normalizes against the global max so the loudest column is exactly 1', () => {
    const pcm = new Float32Array([0.25, 0.5, 0.1, 0.05]);
    // sampleRate === PEAKS_PER_SECOND → blockSize round(sampleRate/PEAKS_PER_SECOND)
    // = 1 → 4 columns, one sample each, regardless of the live density.
    const src = buildWaveformSource(pcm, PEAKS_PER_SECOND, pcm.length / PEAKS_PER_SECOND);
    expect(src.peaks.length).toBe(4);
    let max = 0;
    for (const v of src.peaks) if (v > max) max = v;
    expect(max).toBeCloseTo(1, 10);
    expect(src.peaks[0]).toBeCloseTo(0.5, 10); // 0.25 / 0.5
    expect(src.peaks[1]).toBeCloseTo(1, 10); // 0.5 / 0.5
  });

  it('silence-only input does not divide by zero (all peaks 0, all finite)', () => {
    const pcm = new Float32Array(100); // all zeros
    const src = buildWaveformSource(pcm, 48000, 1);
    expect(src.peaks.length).toBeGreaterThan(0);
    for (const v of src.peaks) {
      expect(v).toBe(0);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('carries peaksPerSecond and totalDuration through', () => {
    const src = buildWaveformSource(new Float32Array([0.5]), 200, 12.5);
    expect(src.peaksPerSecond).toBe(PEAKS_PER_SECOND);
    expect(src.totalDuration).toBe(12.5);
  });
});

describe('buildWaveformSource — block/column arithmetic', () => {
  it('ceils the final partial block into its own column', () => {
    // blockSize derived from the live PEAKS_PER_SECOND: 2 full blocks + 1
    // partial (1 sample) → ceil to 3 columns, regardless of the density value.
    const sampleRate = 2000;
    const blockSize = Math.max(1, Math.round(sampleRate / PEAKS_PER_SECOND));
    const pcm = new Float32Array(blockSize * 2 + 1);
    pcm[pcm.length - 1] = 0.9; // in the partial 3rd column
    const src = buildWaveformSource(pcm, sampleRate, pcm.length / sampleRate);
    expect(src.peaks.length).toBe(3);
    expect(src.peaks[2]).toBeCloseTo(1, 10); // partial column captured the peak
  });

  it('empty PCM yields zero columns without throwing', () => {
    const src = buildWaveformSource(new Float32Array(0), 48000, 0);
    expect(src.peaks.length).toBe(0);
  });
});

// ===========================================================================
// computeBackingDimensions — §5.2
// ===========================================================================

describe('computeBackingDimensions — DPR + clamp math', () => {
  it('sizes at max-zoom density × dpr (unclamped average segment)', () => {
    // 4.3 s at 100 px/s = 430 css px; × dpr 2 = 860 backing; height 80 × 2 = 160.
    const d = computeBackingDimensions(4.3, 2);
    expect(d.cssMaxWidthPx).toBeCloseTo(430, 10);
    expect(d.laneHeightPx).toBe(LANE_HEIGHT_PX);
    expect(d.backingWidth).toBe(860);
    expect(d.backingHeight).toBe(160);
    expect(d.clamped).toBe(false);
  });

  it('handles dpr 1', () => {
    const d = computeBackingDimensions(1, 1);
    expect(d.backingWidth).toBe(100); // 1 s × 100 px/s × 1
    expect(d.backingHeight).toBe(80);
    expect(d.clamped).toBe(false);
  });

  it('clamps very wide backing stores to MAX_CANVAS_BACKING_WIDTH', () => {
    // 60 s × 100 × 2 = 12000 > 8192 → clamp.
    const d = computeBackingDimensions(60, 2);
    expect(d.clamped).toBe(true);
    expect(d.backingWidth).toBe(MAX_CANVAS_BACKING_WIDTH);
    expect(d.backingHeight).toBe(160); // height is never clamped
  });

  it('does not clamp right at the boundary', () => {
    // width exactly 8192 → not > cap → not clamped.
    const durAtCap = MAX_CANVAS_BACKING_WIDTH / (WAVEFORM_MAX_PPS * 2); // 40.96 s
    const d = computeBackingDimensions(durAtCap, 2);
    expect(d.backingWidth).toBe(MAX_CANVAS_BACKING_WIDTH);
    expect(d.clamped).toBe(false);
  });

  it('zero-duration segment yields zero css width', () => {
    const d = computeBackingDimensions(0, 2);
    expect(d.cssMaxWidthPx).toBe(0);
    expect(d.backingWidth).toBe(0);
  });
});

// ===========================================================================
// computeSegmentWindow — §4.2
// ===========================================================================

function srcOf(peaks: number[], peaksPerSecond = PEAKS_PER_SECOND): WaveformSource {
  return { peaks: Float32Array.from(peaks), peaksPerSecond, totalDuration: 999 };
}

describe('computeSegmentWindow — start/end column mapping', () => {
  it('maps startTime/duration to floor(time * peaksPerSecond)', () => {
    const src = srcOf(new Array(2000).fill(0)); // plenty of columns at any live density
    const w = computeSegmentWindow(src, 1, 2); // [1s, 3s)
    expect(w.startCol).toBe(1 * PEAKS_PER_SECOND);
    expect(w.endCol).toBe(3 * PEAKS_PER_SECOND);
  });

  it('clamps both ends to [0, peaks.length]', () => {
    const len = 500;
    const src = srcOf(new Array(len).fill(0));
    const availableSeconds = len / PEAKS_PER_SECOND;
    const startTime = availableSeconds / 2; // well within range, doesn't clamp
    const duration = availableSeconds * 10; // guaranteed to push endCol past len
    const w = computeSegmentWindow(src, startTime, duration);
    expect(w.startCol).toBe(Math.floor(startTime * PEAKS_PER_SECOND));
    expect(w.startCol).toBeLessThan(len); // confirms start genuinely didn't clamp
    expect(w.endCol).toBe(len); // clamped to length
  });

  it('never returns endCol < startCol', () => {
    const len = 100;
    const src = srcOf(new Array(len).fill(0));
    // startTime a full second past the available window, regardless of the
    // live density (available window = len / PEAKS_PER_SECOND seconds).
    const startTime = len / PEAKS_PER_SECOND + 1;
    const w = computeSegmentWindow(src, startTime, 1);
    expect(w.startCol).toBe(len);
    expect(w.endCol).toBe(len);
    expect(w.endCol).toBeGreaterThanOrEqual(w.startCol);
  });

  it('negative startTime clamps to column 0', () => {
    const src = srcOf(new Array(500).fill(0));
    const w = computeSegmentWindow(src, -1, 2);
    expect(w.startCol).toBe(0);
  });
});

// ===========================================================================
// sampleColumnPeaks — §5.3 (collapse via MAX, never mean)
// ===========================================================================

describe('sampleColumnPeaks — column collapse', () => {
  it('is a straight copy when outputColumns === N', () => {
    const peaks = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
    const out = sampleColumnPeaks(peaks, 0, 4, 4);
    expect(Array.from(out)).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6),
      expect.closeTo(0.3, 6),
      expect.closeTo(0.4, 6),
    ]);
  });

  it('collapses groups by MAX (not mean) preserving transients', () => {
    // N=6 collapsed into 3 output columns → groups of 2.
    const peaks = Float32Array.from([0, 1, 0, 0.5, 0, 0]);
    const out = sampleColumnPeaks(peaks, 0, 6, 3);
    // group0 max(0,1)=1, group1 max(0,0.5)=0.5, group2 max(0,0)=0.
    // A MEAN would have given 0.5, 0.25, 0 — the spike would be halved.
    expect(Array.from(out)).toEqual([
      expect.closeTo(1, 6),
      expect.closeTo(0.5, 6),
      expect.closeTo(0, 6),
    ]);
  });

  it('respects startCol offset', () => {
    const peaks = Float32Array.from([9, 9, 0.2, 0.8]);
    const out = sampleColumnPeaks(peaks, 2, 4, 2); // window is [0.2, 0.8]
    expect(Array.from(out)).toEqual([
      expect.closeTo(0.2, 6),
      expect.closeTo(0.8, 6),
    ]);
  });

  it('returns an empty/zero array for an empty window', () => {
    const peaks = Float32Array.from([1, 2, 3]);
    expect(sampleColumnPeaks(peaks, 1, 1, 4).every((v) => v === 0)).toBe(true);
    expect(sampleColumnPeaks(peaks, 0, 3, 0).length).toBe(0);
  });
});

// ===========================================================================
// drawSegmentWaveform — §5.3, §5.4, §5.5
// ===========================================================================

describe('drawSegmentWaveform — backing-store dimensions', () => {
  it('sets canvas.width/height from computeBackingDimensions (dpr 1 off-DOM)', () => {
    // Off-DOM resolveDpr() defaults to 1.
    const { canvas } = makeFakeCanvas();
    const src = srcOf(new Array(2000).fill(0.5)); // 10 s of audio
    drawSegmentWaveform(canvas, src, 0, 4.3);
    expect(canvas.width).toBe(430); // 4.3 × 100 × 1
    expect(canvas.height).toBe(80);
  });

  it('clamps a very long segment to MAX_CANVAS_BACKING_WIDTH', () => {
    const { canvas } = makeFakeCanvas();
    const src = srcOf(new Array(30000).fill(0.5)); // plenty of data
    // dpr 1 → 100 s × 100 = 10000 > 8192 → clamp.
    drawSegmentWaveform(canvas, src, 0, 100);
    expect(canvas.width).toBe(MAX_CANVAS_BACKING_WIDTH);
  });

  it('never lets width/height fall below 1', () => {
    const { canvas } = makeFakeCanvas();
    const src = srcOf([0.5]);
    drawSegmentWaveform(canvas, src, 0, 0);
    expect(canvas.width).toBeGreaterThanOrEqual(1);
    expect(canvas.height).toBeGreaterThanOrEqual(1);
  });

  it('varies width with duration across several segment lengths', () => {
    const src = srcOf(new Array(20000).fill(0.5));
    for (const [dur, expectedW] of [
      [1, 100],
      [2.5, 250],
      [10, 1000],
    ] as const) {
      const { canvas } = makeFakeCanvas();
      drawSegmentWaveform(canvas, src, 0, dur);
      expect(canvas.width).toBe(expectedW);
    }
  });
});

describe('drawSegmentWaveform — draws the mirrored fill for real audio', () => {
  it('clears, transforms, fills, and strokes without throwing', () => {
    const { canvas, rec } = makeFakeCanvas();
    const src = srcOf(new Array(2000).fill(0).map((_, i) => (i % 3 === 0 ? 1 : 0.2)));
    expect(() => drawSegmentWaveform(canvas, src, 0, 4)).not.toThrow();

    expect(rec.clearRect).toBeGreaterThan(0);
    expect(rec.setTransform.length).toBe(1);
    expect(rec.fill).toBe(1); // filled body drawn
    expect(rec.stroke).toBe(1); // center line drawn
    // 3-stop gradient (§5.4).
    expect(rec.gradientStops.map((s) => s[0])).toEqual([0, 0.5, 1]);
    // Mirrored path traces top L→R then bottom R→L → many lineTo calls.
    expect(rec.lineTo).toBeGreaterThan(10);
  });

  it('applies the correct backing→css transform scale (dpr 1)', () => {
    const { canvas, rec } = makeFakeCanvas();
    const src = srcOf(new Array(2000).fill(0.5));
    drawSegmentWaveform(canvas, src, 0, 4); // css width 400, backing 400, scale 1
    const [a, , , d] = rec.setTransform[0]!;
    expect(a).toBeCloseTo(1, 10);
    expect(d).toBeCloseTo(1, 10); // 80 backing / 80 css
  });
});

describe('drawSegmentWaveform — §5.5 empty / silent / missing-source', () => {
  it('null source → center-line hairline only (stroke, no fill)', () => {
    const { canvas, rec } = makeFakeCanvas();
    expect(() => drawSegmentWaveform(canvas, null, 0, 4)).not.toThrow();
    expect(rec.stroke).toBe(1);
    expect(rec.fill).toBe(0);
  });

  it('empty window (startTime past end of source) → hairline only', () => {
    const { canvas, rec } = makeFakeCanvas();
    const src = srcOf(new Array(100).fill(0.5)); // 0.5 s of data
    drawSegmentWaveform(canvas, src, 100, 4); // window starts way past the data
    expect(rec.stroke).toBe(1);
    expect(rec.fill).toBe(0);
  });

  it('entirely-silent window → hairline only (no fill)', () => {
    const { canvas, rec } = makeFakeCanvas();
    const src = srcOf(new Array(2000).fill(0)); // all silent
    drawSegmentWaveform(canvas, src, 0, 4);
    expect(rec.stroke).toBe(1);
    expect(rec.fill).toBe(0);
  });

  it('zero-duration segment → hairline only, still sizes a 1px canvas', () => {
    const { canvas, rec } = makeFakeCanvas();
    const src = srcOf(new Array(2000).fill(0.5));
    drawSegmentWaveform(canvas, src, 0, 0);
    expect(rec.fill).toBe(0);
    expect(rec.stroke).toBe(1);
  });
});

// ===========================================================================
// drawFullWaveform — single-canvas timeline waveform
// ===========================================================================
//
// Same recording-fake-canvas approach as drawSegmentWaveform above: no
// rasterizer, so we assert the correct draw branch (fill vs. stroke-only) and
// canvas sizing rather than pixel colors. drawFullWaveform draws directly in
// canvas pixel space (no setTransform), so the checks below are on
// dimensions + fill/stroke/lineTo counts.

describe('drawFullWaveform — sizing', () => {
  it('sizes the canvas to exactly the width/height passed in', () => {
    const { canvas } = makeFakeCanvas();
    const src = srcOf(new Array(2000).fill(0.5));
    drawFullWaveform(src, canvas, 1234, 80);
    expect(canvas.width).toBe(1234);
    expect(canvas.height).toBe(80);
  });

  it('floors fractional dimensions and never falls below 1px', () => {
    const { canvas } = makeFakeCanvas();
    const src = srcOf([0.5]);
    drawFullWaveform(src, canvas, 100.9, 60.9);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(60);

    const { canvas: c2 } = makeFakeCanvas();
    drawFullWaveform(src, c2, 0, 0);
    expect(c2.width).toBeGreaterThanOrEqual(1);
    expect(c2.height).toBeGreaterThanOrEqual(1);
  });
});

describe('drawFullWaveform — draws the mirrored fill for real audio', () => {
  it('clears, fills, and strokes without throwing (non-empty output)', () => {
    const { canvas, rec } = makeFakeCanvas();
    const src = srcOf(new Array(2000).fill(0).map((_, i) => (i % 3 === 0 ? 1 : 0.2)));
    expect(() => drawFullWaveform(src, canvas, 800, 80)).not.toThrow();

    expect(rec.clearRect).toBeGreaterThan(0);
    expect(rec.fill).toBe(1); // filled body drawn (proxy for non-transparent pixels)
    expect(rec.stroke).toBe(1); // center line drawn
    // 3-stop gradient, strongest at center.
    expect(rec.gradientStops.map((s) => s[0])).toEqual([0, 0.5, 1]);
    // Mirrored path traces top L→R then bottom R→L → many lineTo calls.
    expect(rec.lineTo).toBeGreaterThan(10);
  });

  it('draws a fill for a single-peak source (edge case)', () => {
    const { canvas, rec } = makeFakeCanvas();
    const src = srcOf([1]);
    expect(() => drawFullWaveform(src, canvas, 200, 80)).not.toThrow();
    expect(rec.fill).toBe(1);
    expect(rec.stroke).toBe(1);
  });

  it('collapses a very long peaks array (peaks >> width) without throwing', () => {
    const { canvas, rec } = makeFakeCanvas();
    // 50k peak columns collapsed onto a 300px canvas → sampleColumnPeaks MAX-collapse.
    const src = srcOf(new Array(50000).fill(0).map((_, i) => (i % 7 === 0 ? 1 : 0.1)));
    expect(() => drawFullWaveform(src, canvas, 300, 80)).not.toThrow();
    expect(rec.fill).toBe(1);
    expect(rec.stroke).toBe(1);
  });
});

describe('drawFullWaveform — empty / silent source → hairline only', () => {
  it('empty peaks → center-line hairline only (stroke, no fill)', () => {
    const { canvas, rec } = makeFakeCanvas();
    const src = srcOf([]);
    expect(() => drawFullWaveform(src, canvas, 400, 80)).not.toThrow();
    expect(rec.stroke).toBe(1);
    expect(rec.fill).toBe(0);
  });

  it('entirely-silent source → hairline only (no fill)', () => {
    const { canvas, rec } = makeFakeCanvas();
    const src = srcOf(new Array(2000).fill(0));
    drawFullWaveform(src, canvas, 400, 80);
    expect(rec.stroke).toBe(1);
    expect(rec.fill).toBe(0);
  });
});

// ===========================================================================
// Constant coupling guards — §4.2
// ===========================================================================

describe('waveform constants', () => {
  it('WAVEFORM_MAX_PPS and WAVEFORM_DPR_CAP (canvas-width sizing) are unchanged', () => {
    expect(WAVEFORM_MAX_PPS).toBe(100);
    expect(WAVEFORM_DPR_CAP).toBe(2);
  });

  it('PEAKS_PER_SECOND is the deliberately-tuned permanent extraction density (10/sec)', () => {
    // The one place this value is pinned as a literal — every other test in
    // this file derives its expected peak/column counts FROM this live
    // export instead of repeating the number, so retuning it here is all
    // that's needed if the density is ever revisited again.
    expect(PEAKS_PER_SECOND).toBe(10);
  });
});
