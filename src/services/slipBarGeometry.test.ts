import { describe, it, expect } from 'vitest';
import { computeSlipBarGeometry } from './slipBarGeometry';

describe('computeSlipBarGeometry', () => {
  describe('unknown source duration', () => {
    it('reports hasKnownSourceDuration: false and a zero-width bar for a long segment (confirmed FAIL repro, manual step 13)', () => {
      // Before the fix: srcDur defaulted to 60, widthPct = (90/60)*100 = 150 —
      // overflowed the track container.
      const geo = computeSlipBarGeometry({
        duration: 90,
        trimStart: 0,
        sourceDuration: undefined,
      });
      expect(geo.hasKnownSourceDuration).toBe(false);
      expect(geo.widthPct).toBe(0);
      expect(geo.leftPct).toBe(0);
    });

    it('reports hasKnownSourceDuration: false for a short segment too (not just the overflow case)', () => {
      const geo = computeSlipBarGeometry({
        duration: 10,
        trimStart: 2,
        sourceDuration: undefined,
      });
      expect(geo.hasKnownSourceDuration).toBe(false);
      expect(geo.widthPct).toBe(0);
      expect(geo.leftPct).toBe(0);
    });

    it('treats a zero or negative sourceDuration the same as undefined', () => {
      expect(computeSlipBarGeometry({ duration: 10, trimStart: 0, sourceDuration: 0 }).hasKnownSourceDuration).toBe(false);
      expect(computeSlipBarGeometry({ duration: 10, trimStart: 0, sourceDuration: -5 }).hasKnownSourceDuration).toBe(false);
    });
  });

  describe('known source duration — unchanged behavior', () => {
    it('computes widthPct/leftPct as plain proportions of sourceDuration', () => {
      const geo = computeSlipBarGeometry({
        duration: 30,
        trimStart: 10,
        sourceDuration: 60,
      });
      expect(geo.hasKnownSourceDuration).toBe(true);
      expect(geo.widthPct).toBeCloseTo(50, 5);
      expect(geo.leftPct).toBeCloseTo((10 / 60) * 100, 5);
    });

    it('widthPct is a plain duration/sourceDuration proportion — playbackSpeed no longer exists (WS3 Batch B)', () => {
      const geo = computeSlipBarGeometry({
        duration: 20,
        trimStart: 0,
        sourceDuration: 40,
      });
      expect(geo.widthPct).toBeCloseTo(50, 5);
    });
  });

  describe('isInert (WS3 Batch B, Piece 3 — Case A, freeze-last-frame)', () => {
    it('is true when the clip is shorter than the segment', () => {
      const geo = computeSlipBarGeometry({ duration: 10, trimStart: 0, sourceDuration: 4 });
      expect(geo.isInert).toBe(true);
    });

    it('is true when the clip is exactly as long as the segment (nothing to choose)', () => {
      const geo = computeSlipBarGeometry({ duration: 10, trimStart: 0, sourceDuration: 10 });
      expect(geo.isInert).toBe(true);
    });

    it('is false when the clip is longer than the segment (a real window to trim)', () => {
      const geo = computeSlipBarGeometry({ duration: 10, trimStart: 0, sourceDuration: 10.001 });
      expect(geo.isInert).toBe(false);
    });

    it('is false when sourceDuration is unknown — nothing to judge either way', () => {
      const geo = computeSlipBarGeometry({ duration: 10, trimStart: 0, sourceDuration: undefined });
      expect(geo.isInert).toBe(false);
    });
  });

  describe('rightPct (WS3 Batch B, Piece 3 — the actual overflow bug: leftPct + widthPct, composed and clamped ONCE, here)', () => {
    it('equals leftPct + widthPct in the ordinary case', () => {
      const geo = computeSlipBarGeometry({ duration: 20, trimStart: 10, sourceDuration: 60 });
      expect(geo.rightPct).toBeCloseTo(geo.leftPct + geo.widthPct, 9);
    });

    it('never exceeds 100 even when leftPct + widthPct individually sum past it', () => {
      // leftPct = 90, widthPct = 50 → sum 140 without the clamp this function exists to add.
      const geo = computeSlipBarGeometry({ duration: 30, trimStart: 54, sourceDuration: 60 });
      expect(geo.leftPct).toBeCloseTo(90, 5);
      expect(geo.widthPct).toBeCloseTo(50, 5);
      expect(geo.rightPct).toBe(100);
    });

    it('closes the exact investigation-doc repro: duration 5, sourceDuration 60, trimStart 500 (leftPct+widthPct = 108.33)', () => {
      const geo = computeSlipBarGeometry({ duration: 5, trimStart: 500, sourceDuration: 60 });
      expect(geo.leftPct).toBe(100); // already clamped individually
      expect(geo.widthPct).toBeCloseTo(8.333, 2);
      expect(geo.rightPct).toBe(100); // the sum, clamped — this is the fix
    });
  });

  describe('maxTrimStartSec (Timeline.tsx / App.tsx SegmentEditorModal trim-drag bound)', () => {
    it('is 0 for an unknown sourceDuration with a long segment — previously fabricated a 60s default, silently zeroing/discarding any existing trimStart on drag (confirmed FAIL via direct computation, cleanup run 2026-08-08 Stage 1)', () => {
      const geo = computeSlipBarGeometry({
        duration: 70,
        trimStart: 40,
        sourceDuration: undefined,
      });
      expect(geo.hasKnownSourceDuration).toBe(false);
      expect(geo.maxTrimStartSec).toBe(0);
    });

    it('is 0 for an unknown sourceDuration with a short segment too — previously fabricated a 60s default, permitting a committed trimStart far beyond the real (shorter, unprobed) source', () => {
      const geo = computeSlipBarGeometry({
        duration: 5,
        trimStart: 0,
        sourceDuration: undefined,
      });
      expect(geo.hasKnownSourceDuration).toBe(false);
      expect(geo.maxTrimStartSec).toBe(0);
    });

    it('is unchanged (sourceDuration - duration) when sourceDuration is known', () => {
      const geo = computeSlipBarGeometry({
        duration: 20,
        trimStart: 0,
        sourceDuration: 90,
      });
      expect(geo.hasKnownSourceDuration).toBe(true);
      expect(geo.maxTrimStartSec).toBe(70);
    });

    it('never goes negative when duration exceeds a known sourceDuration', () => {
      const geo = computeSlipBarGeometry({
        duration: 90,
        trimStart: 0,
        sourceDuration: 60,
      });
      expect(geo.maxTrimStartSec).toBe(0);
    });
  });

  describe('clamp is a hard backstop even with a known sourceDuration', () => {
    it('never exceeds 100 for widthPct when duration*playbackSpeed exceeds sourceDuration', () => {
      const geo = computeSlipBarGeometry({
        duration: 90,
        trimStart: 0,
        sourceDuration: 60,
      });
      expect(geo.hasKnownSourceDuration).toBe(true);
      expect(geo.widthPct).toBe(100);
    });

    it('never exceeds 100 for leftPct when trimStart exceeds sourceDuration', () => {
      const geo = computeSlipBarGeometry({
        duration: 5,
        trimStart: 200,
        sourceDuration: 60,
      });
      expect(geo.leftPct).toBe(100);
    });

    it('never goes below 0 for a negative trimStart', () => {
      const geo = computeSlipBarGeometry({
        duration: 5,
        trimStart: -10,
        sourceDuration: 60,
      });
      expect(geo.leftPct).toBe(0);
    });
  });
});
