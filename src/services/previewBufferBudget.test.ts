import { describe, it, expect } from 'vitest';
import {
  WINDOW_AHEAD_SEC,
  PREVIEW_BUFFER_WINDOW_SEC,
  admittedWindowSec,
  effectiveFeedAheadSec,
  previewBufferBudgetTable,
} from './previewBufferBudget';

describe('previewBufferBudget', () => {
  it('admitted window is never smaller than the feed horizon at every table row', () => {
    for (const row of previewBufferBudgetTable()) {
      const feedAhead = effectiveFeedAheadSec(
        row.resolution === '1080p' ? 1920 : 3840,
        row.resolution === '1080p' ? 1080 : 2160,
      );
      expect(feedAhead).toBeLessThanOrEqual(WINDOW_AHEAD_SEC + 1e-9);
      expect(row.admittedSec).toBeGreaterThanOrEqual(feedAhead - 1e-9);
      expect(PREVIEW_BUFFER_WINDOW_SEC).toBeGreaterThanOrEqual(WINDOW_AHEAD_SEC);
    }
  });

  it('1080p120 is time-bound, not byte-bound', () => {
    const row = previewBufferBudgetTable().find((r) => r.resolution === '1080p' && r.fps === 120)!;
    expect(row.byteBound).toBe(false);
    expect(row.admittedSec).toBe(2);
    expect(row.framesAtFullWindow).toBe(240);
    expect(row.admittedBytes).toBe(746496000);
  });

  it('4K120 is byte-bound with degraded ahead', () => {
    const admitted = admittedWindowSec(3840, 2160);
    const ahead = effectiveFeedAheadSec(3840, 2160);
    expect(admitted).toBeLessThan(2);
    expect(ahead).toBeLessThan(WINDOW_AHEAD_SEC);
  });
});
