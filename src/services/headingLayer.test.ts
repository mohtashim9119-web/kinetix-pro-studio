import { describe, it, expect } from 'vitest';
import { getActiveHeadingAt, clampHeadingsToDuration, createHeading } from './headingLayer';
import type { HeadingOverlay } from '../types';

function makeHeading(partial: Partial<HeadingOverlay> & { id: string }): HeadingOverlay {
  return {
    time: 0,
    duration: 1,
    text: 'Heading',
    fontFamily: 'Inter',
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
    backgroundColor: '#000000',
    x: 50,
    y: 50,
    ...partial,
  };
}

describe('getActiveHeadingAt', () => {
  it('is active exactly at its start time (start-inclusive)', () => {
    const h = makeHeading({ id: 'a', time: 5, duration: 2 });
    expect(getActiveHeadingAt([h], 5)).toBe(h);
  });

  it('is NOT active exactly at its end time (end-exclusive)', () => {
    const h = makeHeading({ id: 'a', time: 5, duration: 2 });
    expect(getActiveHeadingAt([h], 7)).toBeUndefined();
  });

  it('is active strictly inside its range', () => {
    const h = makeHeading({ id: 'a', time: 5, duration: 2 });
    expect(getActiveHeadingAt([h], 6)).toBe(h);
  });

  it('is not active outside its range', () => {
    const h = makeHeading({ id: 'a', time: 5, duration: 2 });
    expect(getActiveHeadingAt([h], 4.999)).toBeUndefined();
    expect(getActiveHeadingAt([h], 10)).toBeUndefined();
  });

  it('returns undefined when no headings intersect t', () => {
    const h1 = makeHeading({ id: 'a', time: 0, duration: 1 });
    const h2 = makeHeading({ id: 'b', time: 3, duration: 1 });
    expect(getActiveHeadingAt([h1, h2], 2)).toBeUndefined();
  });

  it('when overlapping headings both intersect t, the later one in array order wins', () => {
    const h1 = makeHeading({ id: 'a', time: 0, duration: 5 });
    const h2 = makeHeading({ id: 'b', time: 2, duration: 5 });
    expect(getActiveHeadingAt([h1, h2], 3)).toBe(h2);
    expect(getActiveHeadingAt([h2, h1], 3)).toBe(h1);
  });
});

describe('clampHeadingsToDuration', () => {
  it('leaves an in-range heading untouched', () => {
    const h = makeHeading({ id: 'a', time: 5, duration: 1 });
    const result = clampHeadingsToDuration([h], 10);
    expect(result[0]).toEqual(h);
    expect(result[0]?.needsReview).toBeUndefined();
  });

  it('clamps an out-of-range heading time to the new duration and sets needsReview', () => {
    const h = makeHeading({ id: 'a', time: 15, duration: 1 });
    const result = clampHeadingsToDuration([h], 10);
    expect(result[0]?.time).toBe(10);
    expect(result[0]?.needsReview).toBe(true);
  });

  it('clamps a heading whose time exactly equals the new duration (boundary is out-of-range)', () => {
    const h = makeHeading({ id: 'a', time: 10, duration: 1 });
    const result = clampHeadingsToDuration([h], 10);
    expect(result[0]?.time).toBe(10);
    expect(result[0]?.needsReview).toBe(true);
  });

  it('never deletes a heading, even when far out of range', () => {
    const h = makeHeading({ id: 'a', time: 1000, duration: 1 });
    const result = clampHeadingsToDuration([h], 10);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('a');
  });

  it('re-clamping an already-flagged heading does not corrupt it further', () => {
    const h = makeHeading({ id: 'a', time: 20, duration: 1, needsReview: true });
    // A second re-sync at an even shorter duration should still clamp correctly.
    const result = clampHeadingsToDuration([h], 8);
    expect(result[0]?.time).toBe(8);
    expect(result[0]?.needsReview).toBe(true);
  });

  it('does not mutate the input array', () => {
    const h = makeHeading({ id: 'a', time: 15, duration: 1 });
    const original = [h];
    clampHeadingsToDuration(original, 10);
    expect(original[0]?.time).toBe(15);
    expect(original[0]?.needsReview).toBeUndefined();
  });
});

describe('createHeading', () => {
  it('defaults to an opaque background and 1.0s duration', () => {
    const h = createHeading(3);
    expect(h.backgroundColor).toBe('#000000');
    expect(h.duration).toBe(1.0);
    expect(h.time).toBe(3);
  });

  it('generates a unique id per call', () => {
    const h1 = createHeading(0);
    const h2 = createHeading(0);
    expect(h1.id).not.toBe(h2.id);
  });

  it('allows overriding defaults', () => {
    const h = createHeading(5, { text: 'Intro', color: '#ff0000' });
    expect(h.text).toBe('Intro');
    expect(h.color).toBe('#ff0000');
    expect(h.backgroundColor).toBe('#000000');
  });
});
