// K13 fix — unit tests for App.tsx's `preserveSegmentLocks`, which restores
// locked/startTime/duration across Apply Sync by matching previousSegments to
// the freshly-committed array by unique assetId, then validates every
// restored lock (bound check + findPartitionViolations) before committing.
//
// See preserveSegmentLocks' own doc comment (App.tsx) for why it runs AFTER
// autoMatchSegments/preserveEffectFields rather than feeding the restored
// lock into applyAnchorBasedTiming's own hard-wall pass earlier in the
// pipeline.
import { describe, it, expect } from 'vitest';
import { preserveSegmentLocks } from '../App';
import { TransitionType, AnimationType, type VideoSegment } from '../types';

let idCounter = 0;
function seg(overrides: Partial<VideoSegment> & { id: string; assetId?: string }): VideoSegment {
  idCounter += 1;
  return {
    text: overrides.text ?? `segment-${idCounter}`,
    startTime: 0,
    duration: 1,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: idCounter,
    ...overrides,
  };
}

describe('preserveSegmentLocks', () => {
  it('zero locked segments — no-op, output identical (referentially)', () => {
    const previousSegments = [
      seg({ id: 'p0', assetId: 'a1', startTime: 0, duration: 5 }),
      seg({ id: 'p1', assetId: 'a2', startTime: 5, duration: 5 }),
    ];
    const committed = [
      seg({ id: 'n0', assetId: 'a1', startTime: 0, duration: 5 }),
      seg({ id: 'n1', assetId: 'a2', startTime: 5, duration: 5 }),
    ];
    const result = preserveSegmentLocks(committed, previousSegments, 10);
    expect(result.segments).toBe(committed); // same array reference — true no-op
    expect(result.dropped).toEqual([]);
  });

  it('clean carry — an unchanged resync restores lock, startTime and duration exactly', () => {
    const previousSegments = [
      seg({ id: 'p0', assetId: 'a1', startTime: 0, duration: 8 }),
      seg({ id: 'p1', assetId: 'a2', startTime: 8, duration: 4, locked: true }),
      seg({ id: 'p2', assetId: 'a3', startTime: 12, duration: 8 }),
    ];
    const committed = [
      seg({ id: 'n0', assetId: 'a1', startTime: 0, duration: 8 }),
      seg({ id: 'n1', assetId: 'a2', startTime: 8, duration: 4 }),
      seg({ id: 'n2', assetId: 'a3', startTime: 12, duration: 8 }),
    ];
    const result = preserveSegmentLocks(committed, previousSegments, 20);
    expect(result.dropped).toEqual([]);
    expect(result.segments[1]).toMatchObject({ id: 'n1', locked: true, startTime: 8, duration: 4 });
    // Untouched segments keep their original object identity — only the
    // restored segment is a new object.
    expect(result.segments[0]).toBe(committed[0]);
    expect(result.segments[2]).toBe(committed[2]);
    // Inputs are never mutated.
    expect(committed[1]!.locked).toBeUndefined();
  });

  it('reworded caption elsewhere — lock survives; the segment\'s own new text is kept, not the old one', () => {
    const previousSegments = [
      seg({ id: 'p0', assetId: 'a1', text: 'old opening line', startTime: 0, duration: 8 }),
      seg({ id: 'p1', assetId: 'a2', text: 'old locked caption', startTime: 8, duration: 4, locked: true }),
      seg({ id: 'p2', assetId: 'a3', text: 'old closing line', startTime: 12, duration: 8 }),
    ];
    const committed = [
      seg({ id: 'n0', assetId: 'a1', text: 'REWORDED opening line', startTime: 0, duration: 8 }),
      seg({ id: 'n1', assetId: 'a2', text: 'REWORDED locked caption', startTime: 8, duration: 4 }),
      seg({ id: 'n2', assetId: 'a3', text: 'old closing line', startTime: 12, duration: 8 }),
    ];
    const result = preserveSegmentLocks(committed, previousSegments, 20);
    expect(result.dropped).toEqual([]);
    expect(result.segments[1]).toMatchObject({
      locked: true,
      startTime: 8,
      duration: 4,
      text: 'REWORDED locked caption', // preserveSegmentLocks never touches text
    });
  });

  it('reordered scene — lock follows its asset to its new index, not the old one', () => {
    const previousSegments = [
      seg({ id: 'p0', assetId: 'a1', startTime: 0, duration: 10 }),
      seg({ id: 'p1', assetId: 'a2', startTime: 10, duration: 5, locked: true }),
    ];
    // New order: a brand-new scene first, then a1, then a2 (a2 is now LAST).
    const committed = [
      seg({ id: 'n_new', assetId: 'a3', startTime: 0, duration: 3 }),
      seg({ id: 'n0', assetId: 'a1', startTime: 3, duration: 7 }),
      seg({ id: 'n1', assetId: 'a2', startTime: 10, duration: 5 }),
    ];
    const result = preserveSegmentLocks(committed, previousSegments, 15);
    expect(result.dropped).toEqual([]);
    // The lock landed on the segment carrying assetId a2 — index 2 in the
    // NEW array — not on whatever sits at the OLD index 1 (a1's new slot).
    expect(result.segments[2]).toMatchObject({ id: 'n1', assetId: 'a2', locked: true, startTime: 10, duration: 5 });
    expect(result.segments[1]).toMatchObject({ id: 'n0', assetId: 'a1' });
    expect(result.segments[1]!.locked).toBeUndefined();
  });

  it('deleted locked scene — silent drop, an unrelated lock elsewhere still survives', () => {
    const previousSegments = [
      seg({ id: 'p0', assetId: 'a1', startTime: 0, duration: 10, locked: true }),
      seg({ id: 'p1', assetId: 'a2', text: 'the scene about to be deleted', startTime: 10, duration: 5, locked: true }),
      seg({ id: 'p2', assetId: 'a3', startTime: 15, duration: 10 }),
    ];
    // a2's scene is gone entirely from the new scene doc.
    const committed = [
      seg({ id: 'n0', assetId: 'a1', startTime: 0, duration: 10 }),
      seg({ id: 'n2', assetId: 'a3', startTime: 10, duration: 10 }),
    ];
    const result = preserveSegmentLocks(committed, previousSegments, 20);
    // Silent — no log entry for the deleted scene's lock.
    expect(result.dropped).toEqual([]);
    expect(result.segments[0]).toMatchObject({ id: 'n0', locked: true, startTime: 0, duration: 10 });
    expect(result.segments[1]).toMatchObject({ id: 'n2' });
    expect(result.segments[1]!.locked).toBeUndefined();
  });

  it('locked segment with no assetId — logged drop, tool limitation not a deletion', () => {
    const previousSegments = [
      seg({ id: 'p0', assetId: 'a1', startTime: 0, duration: 10 }),
      seg({ id: 'p1', assetId: undefined, text: 'untagged locked scene', startTime: 10, duration: 5, locked: true }),
    ];
    const committed = [
      seg({ id: 'n0', assetId: 'a1', startTime: 0, duration: 10 }),
      seg({ id: 'n1', assetId: 'a4', startTime: 10, duration: 5 }),
    ];
    const result = preserveSegmentLocks(committed, previousSegments, 15);
    expect(result.dropped).toEqual([
      { reason: 'no-asset-id', oldText: 'untagged locked scene' },
    ]);
    expect(result.segments).toBe(committed); // nothing to restore, no changes at all
  });

  it('duplicate assetId in the OLD array — logged drop, ambiguous match never guessed', () => {
    const previousSegments = [
      seg({ id: 'p0', assetId: 'a1', text: 'first old scene using a1', startTime: 0, duration: 5, locked: true }),
      seg({ id: 'p1', assetId: 'a1', text: 'second old scene, same asset', startTime: 5, duration: 5 }),
    ];
    const committed = [
      seg({ id: 'n0', assetId: 'a1', startTime: 0, duration: 10 }),
    ];
    const result = preserveSegmentLocks(committed, previousSegments, 10);
    expect(result.dropped).toEqual([
      { reason: 'duplicate-asset-id', oldText: 'first old scene using a1' },
    ]);
    expect(result.segments).toBe(committed);
  });

  it('duplicate assetId in the NEW array — logged drop, ambiguous match never guessed', () => {
    const previousSegments = [
      seg({ id: 'p0', assetId: 'a1', text: 'the locked scene', startTime: 0, duration: 10, locked: true }),
    ];
    const committed = [
      seg({ id: 'n0', assetId: 'a1', startTime: 0, duration: 5 }),
      seg({ id: 'n1', assetId: 'a1', startTime: 5, duration: 5 }),
    ];
    const result = preserveSegmentLocks(committed, previousSegments, 10);
    expect(result.dropped).toEqual([
      { reason: 'duplicate-asset-id', oldText: 'the locked scene' },
    ]);
    expect(result.segments).toBe(committed);
  });

  it('lock past the end of a shortened voiceover — dropped and logged, others untouched', () => {
    const previousSegments = [
      seg({ id: 'p0', assetId: 'a1', startTime: 0, duration: 10 }),
      seg({ id: 'p1', assetId: 'a2', text: 'locked scene now past the new end', startTime: 10, duration: 10, locked: true }),
    ];
    // Voiceover shrank from 20s to 12s; the fresh sync naturally compresses
    // both segments to fit.
    const committed = [
      seg({ id: 'n0', assetId: 'a1', startTime: 0, duration: 8 }),
      seg({ id: 'n1', assetId: 'a2', startTime: 8, duration: 4 }),
    ];
    const result = preserveSegmentLocks(committed, previousSegments, 12);
    expect(result.dropped).toEqual([
      { reason: 'out-of-bounds', oldText: 'locked scene now past the new end', segmentIndex: 1 },
    ]);
    expect(result.segments).toBe(committed); // reverted whole — nothing to restore
  });

  it('a negative saved startTime is also rejected by the bound check (defensive)', () => {
    const previousSegments = [
      seg({ id: 'p0', assetId: 'a1', text: 'malformed locked scene', startTime: -2, duration: 5, locked: true }),
    ];
    const committed = [
      seg({ id: 'n0', assetId: 'a1', startTime: 0, duration: 5 }),
    ];
    const result = preserveSegmentLocks(committed, previousSegments, 10);
    expect(result.dropped).toEqual([
      { reason: 'out-of-bounds', oldText: 'malformed locked scene', segmentIndex: 0 },
    ]);
  });

  it('two adjacent restored locks that no longer abut — the later one drops, the earlier one survives once stable', () => {
    // In the OLD timeline, A and B were NOT adjacent (a scene sat between
    // them). That scene is deleted, so A and B become adjacent in the new
    // array — but their OLD absolute positions leave a gap between them.
    const previousSegments = [
      seg({ id: 'p0', assetId: 'a1', startTime: 0, duration: 5, locked: true }),
      seg({ id: 'p1', assetId: 'a3', startTime: 5, duration: 5 }), // deleted below
      seg({ id: 'p2', assetId: 'a2', text: 'the later, conflicting lock', startTime: 10, duration: 5, locked: true }),
    ];
    // a3's scene is gone; A keeps its natural position (nothing before it
    // changed), B naturally absorbs the rest of the (unchanged) 15s total.
    const committed = [
      seg({ id: 'n0', assetId: 'a1', startTime: 0, duration: 5 }),
      seg({ id: 'n1', assetId: 'a2', startTime: 5, duration: 10 }),
    ];
    const result = preserveSegmentLocks(committed, previousSegments, 15);
    // A's restored lock (0,5) exactly matches the natural array once B is
    // reverted to its natural (5,10) — so the loop stabilizes with A locked
    // and B reverted, not both wiped out.
    expect(result.segments[0]).toMatchObject({ id: 'n0', locked: true, startTime: 0, duration: 5 });
    expect(result.segments[1]).toMatchObject({ id: 'n1', startTime: 5, duration: 10 });
    expect(result.segments[1]!.locked).toBeUndefined();
    expect(result.dropped).toEqual([
      { reason: 'partition-conflict', oldText: 'the later, conflicting lock', segmentIndex: 1 },
    ]);
  });
});
