import { describe, it, expect } from 'vitest';
import {
  matchesSegmentQuery,
  matchesSegmentNumber,
  matchesDuration,
  matchesTimeCode,
  computeSegmentDisplayTitle,
  type SegmentSearchContext,
} from './segmentSearch';
import { AnimationType, TransitionType, type Asset, type VideoSegment } from '../types';

function makeCtx(overrides: Partial<SegmentSearchContext> = {}): SegmentSearchContext {
  return {
    displayTitle: 'Civic Stats',
    description: 'A quick look at the numbers',
    assetFilename: '009_civic_stats.jpeg',
    segmentNumber: 8,
    startTime: 10,
    endTime: 14,
    duration: 4,
    ...overrides,
  };
}

describe('matchesSegmentQuery — substring matching', () => {
  it('matches case-insensitively against the display title', () => {
    expect(matchesSegmentQuery('civic', makeCtx())).toBe(true);
    expect(matchesSegmentQuery('CIVIC', makeCtx())).toBe(true);
  });

  it('matches case-insensitively against the description', () => {
    expect(matchesSegmentQuery('numbers', makeCtx())).toBe(true);
    expect(matchesSegmentQuery('NUMBERS', makeCtx())).toBe(true);
  });

  it('matches case-insensitively against the asset filename', () => {
    expect(matchesSegmentQuery('civic_stats', makeCtx())).toBe(true);
    expect(matchesSegmentQuery('.JPEG', makeCtx())).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesSegmentQuery('nonexistent', makeCtx())).toBe(false);
  });

  it('returns true for an empty or whitespace-only query', () => {
    expect(matchesSegmentQuery('', makeCtx())).toBe(true);
    expect(matchesSegmentQuery('   ', makeCtx())).toBe(true);
  });
});

describe('matchesSegmentNumber', () => {
  it('matches "8", "08", and "008" against segment #8 (numeric, not padded string)', () => {
    expect(matchesSegmentNumber('8', 8)).toBe(true);
    expect(matchesSegmentNumber('08', 8)).toBe(true);
    expect(matchesSegmentNumber('008', 8)).toBe(true);
  });

  it('does not match a different segment number', () => {
    expect(matchesSegmentNumber('9', 8)).toBe(false);
  });

  it('does not match by substring — "8" must not match #18 or #80', () => {
    expect(matchesSegmentNumber('8', 18)).toBe(false);
    expect(matchesSegmentNumber('8', 80)).toBe(false);
  });

  it('is gated on a bare-integer shape', () => {
    expect(matchesSegmentNumber('8.0', 8)).toBe(false);
    expect(matchesSegmentNumber('8s', 8)).toBe(false);
  });
});

describe('matchesDuration', () => {
  it('matches "4.5" and "4.5s" against a duration of 4.5', () => {
    expect(matchesDuration('4.5', 4.5)).toBe(true);
    expect(matchesDuration('4.5s', 4.5)).toBe(true);
  });

  it('does not match "4.50" — comparison is against the displayed string', () => {
    expect(matchesDuration('4.50', 4.5)).toBe(false);
  });

  it('matches "4.5" against a duration of 4.53 (rounding-collision behavior, locked)', () => {
    expect(matchesDuration('4.5', 4.53)).toBe(true);
  });

  it('does not match a bare integer — wrong shape, that is the segment-number branch', () => {
    expect(matchesDuration('4', 4.0)).toBe(false);
    expect(matchesDuration('4', 4.5)).toBe(false);
  });
});

describe('matchesTimeCode', () => {
  it('matches a segment starting at the given time', () => {
    expect(matchesTimeCode('00:12', 12, 20)).toBe(true);
  });

  it('matches a segment ending at the given time', () => {
    expect(matchesTimeCode('00:12', 5, 12)).toBe(true);
  });

  it('returns false when neither boundary matches', () => {
    expect(matchesTimeCode('00:12', 5, 20)).toBe(false);
  });

  it('allows a 1-digit minute component', () => {
    expect(matchesTimeCode('0:12', 12, 20)).toBe(true);
  });
});

describe('matchesSegmentQuery — combined', () => {
  it('returns true (single boolean OR) when a query hits both a title substring and a segment number', () => {
    // "8" is a substring of neither field here but matches segmentNumber; and
    // separately verify a query that could hit either branch still yields one boolean.
    expect(matchesSegmentQuery('8', makeCtx({ segmentNumber: 8, displayTitle: 'Scene 8 recap' }))).toBe(true);
  });
});

describe('computeSegmentDisplayTitle', () => {
  const baseSeg: VideoSegment = {
    id: 'seg-1',
    text: 'hello',
    startTime: 0,
    duration: 4,
    transition: TransitionType.NONE,
    animation: AnimationType.KEN_BURNS,
    order: 3,
  };

  it('cleans an asset filename into a title-cased title', () => {
    const asset: Asset = { id: 'a1', name: '009_civic_stats.jpeg', url: '', type: 'image' };
    expect(computeSegmentDisplayTitle(baseSeg, asset)).toBe('Civic Stats');
  });

  it('falls back to a positional Scene label when there is no asset', () => {
    expect(computeSegmentDisplayTitle(baseSeg, undefined)).toBe('Scene 4');
  });
});
