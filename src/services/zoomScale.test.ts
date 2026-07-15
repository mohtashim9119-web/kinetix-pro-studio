import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ZOOM_SCALE_RATE,
  MIN_ZOOM_SCALE_RATE,
  MAX_ZOOM_SCALE_RATE,
  MAX_PEAK_SCALE,
  computePeakScale,
  computeZoomScale,
  computeMaxRate,
  sliderMaxRate,
  capRateForDuration,
  isRateCapped,
  resolveRateInputSync,
} from './zoomScale';

/**
 * Pure-function tests for the shared zoom-scale model — the single source both
 * the GL preview (compositeParams.ts) and the export canvas
 * (canvasAnimations.ts) render from. Mock-free, matching this repo's other
 * derivation-function suites.
 */

describe('computeZoomScale — zoom-in', () => {
  it('is exactly 1.0 at elapsed 0', () => {
    expect(computeZoomScale({ rate: 0.05, duration: 10, elapsed: 0, direction: 'in' })).toBeCloseTo(1.0, 10);
  });

  it('reaches peak (1 + rate*duration) at elapsed = duration, uncapped', () => {
    expect(computeZoomScale({ rate: 0.05, duration: 10, elapsed: 10, direction: 'in' })).toBeCloseTo(1.5, 10);
  });

  it('is linear in elapsed between 1.0 and peak', () => {
    // rate 0.04, duration 5 → peak 1.2; midpoint (elapsed 2.5) → 1.1.
    expect(computeZoomScale({ rate: 0.04, duration: 5, elapsed: 2.5, direction: 'in' })).toBeCloseTo(1.1, 10);
  });

  it('clamps elapsed above duration to the end (holds at peak, no extrapolation)', () => {
    expect(computeZoomScale({ rate: 0.05, duration: 5, elapsed: 99, direction: 'in' })).toBeCloseTo(1.25, 10);
  });

  it('clamps negative elapsed to the start (holds at 1.0)', () => {
    expect(computeZoomScale({ rate: 0.05, duration: 5, elapsed: -3, direction: 'in' })).toBeCloseTo(1.0, 10);
  });
});

describe('computeZoomScale — zoom-out', () => {
  it('starts at peak at elapsed 0', () => {
    expect(computeZoomScale({ rate: 0.05, duration: 10, elapsed: 0, direction: 'out' })).toBeCloseTo(1.5, 10);
  });

  it('reaches 1.0 at elapsed = duration', () => {
    expect(computeZoomScale({ rate: 0.05, duration: 10, elapsed: 10, direction: 'out' })).toBeCloseTo(1.0, 10);
  });

  it('is the mirror of zoom-in at every elapsed (in + out = 1 + peak)', () => {
    const rate = 0.03, duration = 7;
    for (const elapsed of [0, 1, 3.5, 6, 7]) {
      const zin = computeZoomScale({ rate, duration, elapsed, direction: 'in' });
      const zout = computeZoomScale({ rate, duration, elapsed, direction: 'out' });
      const peak = computePeakScale(rate, duration);
      expect(zin + zout).toBeCloseTo(1 + peak, 10);
    }
  });
});

describe('computeZoomScale — peak cap (MAX_PEAK_SCALE)', () => {
  it('never returns a scale above MAX_PEAK_SCALE, even for an out-of-range rate/duration', () => {
    // 0.1 * 60 = peak 7.0 uncapped → clamped to 1.99 at the end.
    expect(computeZoomScale({ rate: 0.1, duration: 60, elapsed: 60, direction: 'in' })).toBeCloseTo(MAX_PEAK_SCALE, 10);
  });

  it('interpolates linearly toward the CAPPED peak (1.0 → 1.99), not toward the uncapped one', () => {
    // peak capped at 1.99; halfway → 1 + (1.99 - 1)*0.5 = 1.495.
    expect(computeZoomScale({ rate: 0.1, duration: 60, elapsed: 30, direction: 'in' })).toBeCloseTo(1.495, 10);
  });

  it('returns 1 (no zoom) for a non-positive duration', () => {
    expect(computeZoomScale({ rate: 0.05, duration: 0, elapsed: 0, direction: 'in' })).toBe(1);
    expect(computeZoomScale({ rate: 0.05, duration: -4, elapsed: 1, direction: 'out' })).toBe(1);
  });
});

describe('computePeakScale', () => {
  it('is 1 + rate*duration when under the cap', () => {
    expect(computePeakScale(0.02, 5)).toBeCloseTo(1.1, 10);
  });
  it('clamps to MAX_PEAK_SCALE', () => {
    expect(computePeakScale(0.1, 100)).toBe(MAX_PEAK_SCALE);
  });
});

describe('computeMaxRate', () => {
  it('is MAX_ZOOM_SCALE_RATE for short segments (0.99/duration exceeds the global max)', () => {
    // duration 1 → 0.99/1 = 0.99, min(0.100, 0.99) = 0.100.
    expect(computeMaxRate(1)).toBe(MAX_ZOOM_SCALE_RATE);
    expect(computeMaxRate(5)).toBe(MAX_ZOOM_SCALE_RATE); // 0.99/5 = 0.198 > 0.1
  });

  it('sits exactly at the 0.100 boundary at duration 9.9 (0.99 / 9.9)', () => {
    expect(computeMaxRate(9.9)).toBeCloseTo(0.1, 10);
  });

  it('drops below 0.100 for durations longer than 9.9', () => {
    expect(computeMaxRate(10)).toBeCloseTo(0.099, 10);
    expect(computeMaxRate(20)).toBeCloseTo(0.0495, 10);
    expect(computeMaxRate(30)).toBeCloseTo(0.033, 10);
  });

  it('keeps the uncapped peak at exactly MAX_PEAK_SCALE for any duration (its whole point)', () => {
    for (const d of [1, 9.9, 10, 20, 33, 60]) {
      const peak = computePeakScale(computeMaxRate(d), d);
      expect(peak).toBeLessThanOrEqual(MAX_PEAK_SCALE + 1e-9);
      // For durations long enough to bind the cap (>9.9), it sits right at it.
      if (d > 9.9) expect(peak).toBeCloseTo(MAX_PEAK_SCALE, 9);
    }
  });

  it('treats a non-positive/absent duration as unbounded → MAX_ZOOM_SCALE_RATE', () => {
    expect(computeMaxRate(0)).toBe(MAX_ZOOM_SCALE_RATE);
    expect(computeMaxRate(-5)).toBe(MAX_ZOOM_SCALE_RATE);
  });
});

describe('sliderMaxRate — UI floor for very long segments', () => {
  it('equals computeMaxRate for durations where that stays >= the min', () => {
    expect(sliderMaxRate(5)).toBe(computeMaxRate(5)); // 0.1
    expect(sliderMaxRate(30)).toBe(computeMaxRate(30)); // ~0.033
  });

  it('floors at MIN_ZOOM_SCALE_RATE at an extreme duration where computeMaxRate drops below min', () => {
    // 600s: computeMaxRate = 0.99/600 = 0.00165, well below the 0.010 min.
    expect(computeMaxRate(600)).toBeLessThan(MIN_ZOOM_SCALE_RATE);
    expect(sliderMaxRate(600)).toBe(MIN_ZOOM_SCALE_RATE);
  });

  it('is never below MIN_ZOOM_SCALE_RATE for any duration (never max < min)', () => {
    for (const d of [1, 9.9, 10, 30, 99, 100, 500, 5000]) {
      expect(sliderMaxRate(d)).toBeGreaterThanOrEqual(MIN_ZOOM_SCALE_RATE);
    }
  });

  it('does NOT change the applied cap: capRateForDuration still uses the raw computeMaxRate below the floor', () => {
    // At 600s the slider floor is 0.010, but the ACTUAL applied cap is lower —
    // an applied rate is still capped below the UI floor.
    expect(capRateForDuration(0.010, 600)).toBeCloseTo(computeMaxRate(600), 12);
    expect(capRateForDuration(0.010, 600)).toBeLessThan(sliderMaxRate(600));
  });
});

describe('capRateForDuration — apply-to-all across mixed-duration segments', () => {
  it('leaves a chosen rate untouched on short segments (its max is 0.100)', () => {
    expect(capRateForDuration(0.05, 5)).toBe(0.05);
    expect(capRateForDuration(0.1, 3)).toBe(0.1);
  });

  it('caps the chosen rate down to the segment max on long segments', () => {
    // 30s segment: max 0.033 → a chosen 0.05 is pulled down to 0.033.
    expect(capRateForDuration(0.05, 30)).toBeCloseTo(0.033, 10);
    // 60s segment: max 0.0165.
    expect(capRateForDuration(0.05, 60)).toBeCloseTo(0.0165, 10);
  });

  it('a single chosen rate applied to a mix of durations is capped independently per segment', () => {
    const chosen = 0.06;
    const durations = [4, 12, 30, 90];
    const written = durations.map((d) => capRateForDuration(chosen, d));
    // 4s: max 0.1 → keeps 0.06. 12s: max 0.0825 → keeps 0.06. 30s: max 0.033 →
    // capped. 90s: max 0.011 → capped.
    expect(written[0]).toBeCloseTo(0.06, 10);
    expect(written[1]).toBeCloseTo(0.06, 10);
    expect(written[2]).toBeCloseTo(0.033, 10);
    expect(written[3]).toBeCloseTo(0.011, 10);
    // Every written rate keeps its segment's peak within MAX_PEAK_SCALE.
    written.forEach((r, i) => {
      expect(computePeakScale(r, durations[i]!)).toBeLessThanOrEqual(MAX_PEAK_SCALE + 1e-9);
    });
  });
});

describe('isRateCapped — BottomDrawer indicator', () => {
  it('is false on short segments (cap is the global max, nothing was limited)', () => {
    expect(isRateCapped(0.05, 5)).toBe(false);
    expect(isRateCapped(MAX_ZOOM_SCALE_RATE, 3)).toBe(false);
  });

  it('is true when a long segment sits at its own (sub-0.100) cap', () => {
    expect(isRateCapped(capRateForDuration(0.05, 30), 30)).toBe(true);
  });

  it('is false when a long segment is BELOW its cap (user chose a gentler rate)', () => {
    expect(isRateCapped(0.01, 30)).toBe(false); // max ~0.033, 0.01 is under it
  });
});

describe('resolveRateInputSync — sync-on-select guard', () => {
  it('syncs the input to a newly-selected segment\'s stored rate', () => {
    const r = resolveRateInputSync(undefined, 'seg-a', 0.042);
    expect(r.changed).toBe(true);
    expect(r.value).toBe('0.042');
  });

  it('syncs to the DEFAULT when the newly-selected segment has no stored rate', () => {
    const r = resolveRateInputSync('seg-a', 'seg-b', undefined);
    expect(r.changed).toBe(true);
    expect(r.value).toBe(DEFAULT_ZOOM_SCALE_RATE.toFixed(3)); // "0.010"
  });

  it('does NOT sync when the active segment id is unchanged — this is the live-edit guard', () => {
    // Same segment still selected (e.g. a re-render fired mid-typing): even
    // though a stale stored rate is passed, no sync → the input keeps whatever
    // the user is typing.
    const r = resolveRateInputSync('seg-a', 'seg-a', 0.099);
    expect(r.changed).toBe(false);
  });

  it('does NOT sync when nothing is selected before or after (both undefined)', () => {
    expect(resolveRateInputSync(undefined, undefined, undefined).changed).toBe(false);
  });

  it('formats a capped stored rate to 3 decimals', () => {
    const stored = capRateForDuration(0.05, 30); // ~0.033
    const r = resolveRateInputSync('seg-a', 'seg-b', stored);
    expect(r.changed).toBe(true);
    expect(r.value).toBe(stored.toFixed(3));
    expect(r.value).toMatch(/^\d\.\d{3}$/);
  });

  it('re-selecting a DIFFERENT segment after an edit re-syncs (id changed), discarding the un-applied edit', () => {
    // A→B is a real selection change → sync fires. (Un-applied edits are lost on
    // switch, matching the authoring model; only same-id re-renders are guarded.)
    expect(resolveRateInputSync('seg-a', 'seg-b', 0.02).changed).toBe(true);
  });
});

describe('module constants', () => {
  it('exposes the documented defaults/bounds', () => {
    expect(DEFAULT_ZOOM_SCALE_RATE).toBe(0.010);
    expect(MIN_ZOOM_SCALE_RATE).toBe(0.010);
    expect(MAX_ZOOM_SCALE_RATE).toBe(0.100);
    expect(MAX_PEAK_SCALE).toBe(1.99);
  });
});
