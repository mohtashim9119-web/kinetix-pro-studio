// Boundary-quality checker — Phase 1 of the waveform-watcher program.
// Unit tests for findQuietestRegion: synthetic peaks arrays with
// hand-computed expected minima, no fixtures.
import { describe, it, expect } from 'vitest';
import { findQuietestRegion } from './boundaryQuality';

describe('findQuietestRegion — sliding-window quietest-span search', () => {
  it('finds a displaced quiet region inside an otherwise loud window', () => {
    // 3.0s at 10 peaks/sec = 30 columns. Loud everywhere (0.8) except a
    // clear dip at t=[1.0, 1.4) (cols 10-13).
    const peaks = new Float32Array(30).fill(0.8);
    for (let i = 10; i < 14; i++) peaks[i] = 0.1;

    const result = findQuietestRegion(peaks, 10, 0.0, 3.0, 0.3);

    expect(result.found).toBe(true);
    expect(result.meanAmplitude).toBeCloseTo(0.1, 6);
    // Center of the quietest 3-column span sits inside [1.0, 1.4).
    expect(result.time!).toBeGreaterThanOrEqual(1.0);
    expect(result.time!).toBeLessThanOrEqual(1.4);
  });

  it('a uniformly loud window still reports found:true with a clear (high) minimum — no quiet region is not "not found"', () => {
    const peaks = new Float32Array(20).fill(0.7);
    const result = findQuietestRegion(peaks, 10, 0.0, 2.0, 0.2);
    expect(result.found).toBe(true);
    expect(result.meanAmplitude).toBeCloseTo(0.7, 6);
  });

  it('returns found:false when the window is narrower than the sustained span', () => {
    const peaks = new Float32Array(30).fill(0.5);
    // Window [1.0, 1.1) is only 0.1s wide; sustained span requested is 0.3s.
    const result = findQuietestRegion(peaks, 10, 1.0, 1.1, 0.3);
    expect(result.found).toBe(false);
    expect(result.time).toBeUndefined();
    expect(result.meanAmplitude).toBeUndefined();
  });

  it('clamps windowEndSec past the end of the peaks array instead of reading out of bounds', () => {
    // Only 1.0s (10 columns) of real data; window requests up to 5.0s.
    const peaks = new Float32Array(10).fill(0.3);
    const result = findQuietestRegion(peaks, 10, 0.0, 5.0, 0.3);
    expect(result.found).toBe(true);
    expect(result.meanAmplitude).toBeCloseTo(0.3, 6);
  });

  it('clamps a negative windowStartSec to column 0 instead of reading out of bounds', () => {
    const peaks = new Float32Array(20).fill(0.4);
    const result = findQuietestRegion(peaks, 10, -5.0, 2.0, 0.3);
    expect(result.found).toBe(true);
    expect(result.meanAmplitude).toBeCloseTo(0.4, 6);
  });

  it('is O(n) via a running sum — a large window with many candidate positions still resolves to the true minimum', () => {
    const peaks = new Float32Array(1000).fill(0.9);
    // A single quiet dip far from the start, 5 columns wide.
    for (let i = 700; i < 705; i++) peaks[i] = 0.02;
    const result = findQuietestRegion(peaks, 100, 0.0, 10.0, 0.05); // sustainedCols = 5
    expect(result.found).toBe(true);
    expect(result.meanAmplitude).toBeCloseTo(0.02, 6);
    expect(result.time!).toBeCloseTo(7.025, 2);
  });

  it('picks the FIRST-encountered minimum when multiple spans tie exactly', () => {
    const peaks = new Float32Array(20).fill(0.5);
    // Two identical dips.
    peaks[2] = 0.1; peaks[3] = 0.1;
    peaks[10] = 0.1; peaks[11] = 0.1;
    const result = findQuietestRegion(peaks, 10, 0.0, 2.0, 0.2);
    expect(result.found).toBe(true);
    expect(result.meanAmplitude).toBeCloseTo(0.1, 6);
    // Strict "<" comparison keeps the earliest tie, not the latest.
    expect(result.time!).toBeCloseTo(0.3, 6);
  });

  it('a sustainedWindowSec of 0 (or below one column) is floored to at least 1 column, never divides by zero', () => {
    const peaks = new Float32Array(10).fill(0.6);
    const result = findQuietestRegion(peaks, 10, 0.0, 1.0, 0);
    expect(result.found).toBe(true);
    expect(Number.isFinite(result.meanAmplitude)).toBe(true);
  });
});
