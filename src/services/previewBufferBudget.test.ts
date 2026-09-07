import { describe, it, expect } from 'vitest';
import {
  WINDOW_AHEAD_SEC,
  PREVIEW_BUFFER_WINDOW_SEC,
  RETAIN_BEHIND_SEC,
  FEED_BYTE_BUDGET_MARGIN_SEC,
  DESIGN_MAX_SOURCE_FPS,
  admittedWindowSec,
  effectiveFeedAheadSec,
  effectiveRetainBehindSec,
  previewBufferBudgetTable,
} from './previewBufferBudget';

describe('previewBufferBudget', () => {
  it('admitted window is never smaller than the feed horizon at every table row', () => {
    for (const row of previewBufferBudgetTable()) {
      const feedWindowSec = effectiveFeedAheadSec(
        row.resolution === '1080p' ? 1920 : 3840,
        row.resolution === '1080p' ? 1080 : 2160,
      );
      expect(row.feedWindowSec).toBe(feedWindowSec);
      expect(feedWindowSec).toBeLessThanOrEqual(WINDOW_AHEAD_SEC + 1e-9);
      expect(row.admittedSec).toBeGreaterThanOrEqual(feedWindowSec - 1e-9);
      expect(PREVIEW_BUFFER_WINDOW_SEC).toBeGreaterThanOrEqual(WINDOW_AHEAD_SEC);
    }
  });

  it('1080p120 is time-bound, not byte-bound', () => {
    const row = previewBufferBudgetTable().find((r) => r.resolution === '1080p' && r.fps === 120)!;
    expect(row.byteBound).toBe(false);
    expect(row.admittedSec).toBe(2);
    expect(row.feedWindowSec).toBe(1.5);
    expect(row.framesAtFullWindow).toBe(240);
    expect(row.admittedBytes).toBe(746496000);
  });

  it('1080p feed stays at the full 1.5 s horizon for 30/60/120', () => {
    for (const fps of [30, 60, 120]) {
      const row = previewBufferBudgetTable().find((r) => r.resolution === '1080p' && r.fps === fps)!;
      expect(row.admittedSec).toBe(2);
      expect(row.feedWindowSec).toBe(1.5);
      expect(row.byteBound).toBe(false);
    }
  });

  it('4K feed is admitted minus the one-frame margin, not collapsed to 1/30', () => {
    const admitted = admittedWindowSec(3840, 2160);
    const ahead = effectiveFeedAheadSec(3840, 2160);
    expect(admitted).toBeLessThan(2);
    expect(ahead).toBeLessThan(WINDOW_AHEAD_SEC);
    expect(admitted).toBeGreaterThanOrEqual(ahead);
    expect(FEED_BYTE_BUDGET_MARGIN_SEC).toBe(1 / DESIGN_MAX_SOURCE_FPS);
    expect(ahead).toBe(admitted - FEED_BYTE_BUDGET_MARGIN_SEC);
    // The old admitted − RETAIN formula collapsed to ~0.033 s; this must not.
    expect(ahead).toBeGreaterThan(RETAIN_BEHIND_SEC * 0.5);
    expect(ahead).toBeGreaterThan(1 / 30);
  });

  it('4K effective retain-behind is one design-max frame, same at 30/60/120', () => {
    const expected = FEED_BYTE_BUDGET_MARGIN_SEC;
    for (const fps of [30, 60, 120]) {
      const retain = effectiveRetainBehindSec(3840, 2160);
      expect(retain).toBeCloseTo(expected, 12);
      expect(retain).toBeCloseTo(1 / DESIGN_MAX_SOURCE_FPS, 12);
      expect(retain).toBeLessThan(RETAIN_BEHIND_SEC);
      const row = previewBufferBudgetTable().find((r) => r.resolution === '4K' && r.fps === fps)!;
      expect(row.admittedSec - row.feedWindowSec).toBeCloseTo(expected, 12);
    }
  });
});
