import { describe, it, expect } from 'vitest';
import { compactRanges } from './rangeCompact';

describe('compactRanges', () => {
  it('returns an empty string for an empty array', () => {
    expect(compactRanges([])).toBe('');
  });

  it('renders a single number as itself', () => {
    expect(compactRanges([7])).toBe('7');
  });

  it('renders a run of 3+ consecutive numbers as an en-dash range', () => {
    expect(compactRanges([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])).toBe('7–18');
  });

  it('renders the full documented example', () => {
    const numbers = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97];
    expect(compactRanges(numbers)).toBe('7–18, 23, 78–97');
  });

  it('renders a 2-run as two singles, not a range', () => {
    expect(compactRanges([7, 9])).toBe('7, 9');
    expect(compactRanges([7, 8])).toBe('7, 8');
  });

  it('sorts unsorted input before compacting', () => {
    expect(compactRanges([9, 7, 8, 10])).toBe('7–10');
  });

  it('deduplicates repeated values', () => {
    expect(compactRanges([7, 7, 8, 8, 9])).toBe('7–9');
  });
});
