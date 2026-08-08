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

    it('factors in playbackSpeed (defaults to 1 when omitted)', () => {
      const withSpeed = computeSlipBarGeometry({
        duration: 20,
        playbackSpeed: 2,
        trimStart: 0,
        sourceDuration: 40,
      });
      expect(withSpeed.widthPct).toBeCloseTo(100, 5);

      const noSpeed = computeSlipBarGeometry({
        duration: 20,
        trimStart: 0,
        sourceDuration: 40,
      });
      expect(noSpeed.widthPct).toBeCloseTo(50, 5);
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
