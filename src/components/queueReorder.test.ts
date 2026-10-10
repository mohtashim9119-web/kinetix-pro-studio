import { describe, it, expect } from 'vitest';
import { moveQueued, dropTarget } from './queueReorder';

describe('moveQueued', () => {
  it('moves a row before another, or to the end', () => {
    expect(moveQueued(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveQueued(['a', 'b', 'c', 'd'], 'a', null)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveQueued(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c']);
  });
});

describe('dropTarget', () => {
  const rows = [{ id: 'a', top: 0, bottom: 100 }, { id: 'b', top: 100, bottom: 200 }, { id: 'c', top: 200, bottom: 300 }];
  it('inserts before the first row whose middle is below the pointer', () => {
    expect(dropTarget(40, rows, 'c')).toBe('a');
    expect(dropTarget(60, rows, 'c')).toBe('b');
    expect(dropTarget(290, rows, 'a')).toBeNull();
  });
  it('ignores the dragged row itself', () => {
    expect(dropTarget(40, rows, 'a')).toBe('b');
  });
});
