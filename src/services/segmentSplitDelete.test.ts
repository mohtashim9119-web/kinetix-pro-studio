/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { splitSegmentAtTime, deleteSegment, parentIdFromSliceId } from './segmentSplitDelete';
import { makeSliceSegmentId, isSliceSegmentId, MERGE_SLOT_ORDINAL, isMergeSlotSegmentId } from './segmentId';
import type { VideoSegment } from '../types';

function seg(id: string, startTime: number, duration: number, text = '', extra?: Partial<VideoSegment>): VideoSegment {
  return { id, text, startTime, duration, transition: 'none', animation: 'none', order: 0, ...extra } as VideoSegment;
}

function assertGapless(segments: readonly VideoSegment[]): void {
  for (let i = 0; i < segments.length - 1; i++) {
    const end = Number((segments[i]!.startTime + segments[i]!.duration).toFixed(3));
    expect(end).toBeCloseTo(segments[i + 1]!.startTime, 3);
  }
}

describe('parentIdFromSliceId', () => {
  it('recovers the parent id from a slice id', () => {
    expect(parentIdFromSliceId(makeSliceSegmentId('abc', 1))).toBe('abc');
  });

  it('returns null for a non-slice id', () => {
    expect(parentIdFromSliceId('plain-id')).toBeNull();
  });
});

describe('splitSegmentAtTime', () => {
  it('splits at the word boundary nearest the proportional time split, staying gapless', () => {
    const segments = [seg('a', 0, 10, 'The quick brown fox jumps over the lazy dog'), seg('b', 10, 2)];
    const { segments: out, split } = splitSegmentAtTime(segments, 0, 5); // 50% through
    expect(split).toBe(true);
    expect(out).toHaveLength(3);
    expect(isSliceSegmentId(out[0]!.id)).toBe(true);
    expect(isSliceSegmentId(out[1]!.id)).toBe(true);
    expect(parentIdFromSliceId(out[0]!.id)).toBe('a');
    expect(parentIdFromSliceId(out[1]!.id)).toBe('a');
    expect(out[0]!.text + ' ' + out[1]!.text).toBe('The quick brown fox jumps over the lazy dog');
    expect(out[0]!.text.endsWith(' ')).toBe(false);
    expect(out[1]!.text.startsWith(' ')).toBe(false);
    assertGapless(out);
    expect(out[0]!.startTime).toBe(0);
    expect(out[1]!.startTime + out[1]!.duration).toBeCloseTo(10, 3);
  });

  it('clamps the split point so both pieces respect MIN_SEGMENT_DURATION', () => {
    const segments = [seg('a', 0, 1, 'One two three four five')];
    const { segments: out, split } = splitSegmentAtTime(segments, 0, 0.01); // near the very start
    expect(split).toBe(true);
    expect(out[0]!.duration).toBeGreaterThanOrEqual(0.1);
    expect(out[1]!.duration).toBeGreaterThanOrEqual(0.1);
    assertGapless(out);
  });

  it('refuses to split a segment too short to hold two MIN_SEGMENT_DURATION pieces', () => {
    const segments = [seg('a', 0, 0.15, 'Too short')];
    const { segments: out, split } = splitSegmentAtTime(segments, 0, 0.075);
    expect(split).toBe(false);
    expect(out).toEqual(segments);
  });

  it('refuses to split text with no whitespace boundary to cut at', () => {
    const segments = [seg('a', 0, 5, 'Supercalifragilisticexpialidocious')];
    const { split } = splitSegmentAtTime(segments, 0, 2.5);
    expect(split).toBe(false);
  });

  it('is pure — does not mutate the input array', () => {
    const segments = [seg('a', 0, 10, 'Some words here today')];
    const snapshot = JSON.parse(JSON.stringify(segments));
    splitSegmentAtTime(segments, 0, 5);
    expect(segments).toEqual(snapshot);
  });
});

describe('deleteSegment', () => {
  it('refuses to delete an unsplit native segment', () => {
    const segments = [seg('native', 0, 2), seg('b', 2, 2)];
    const { segments: out, deleted } = deleteSegment(segments, 0, new Set());
    expect(deleted).toBe(false);
    expect(out).toEqual(segments);
  });

  it('deletes a split slice, giving its time to the sibling slice, staying gapless', () => {
    const p = 'parent';
    const segments = [
      seg(makeSliceSegmentId(p, 0), 0, 3),
      seg(makeSliceSegmentId(p, 1), 3, 2),
      seg('next', 5, 4),
    ];
    const { segments: out, deleted } = deleteSegment(segments, 1, new Set());
    expect(deleted).toBe(true);
    expect(out).toHaveLength(2);
    assertGapless(out);
    expect(out[0]!.duration).toBeCloseTo(5, 3); // absorbed the deleted slice's 2s
    expect(out[1]!.id).toBe('next');
  });

  it('refuses to delete the LAST remaining slice of a split', () => {
    const p = 'parent';
    const segments = [seg(makeSliceSegmentId(p, 0), 0, 5), seg('next', 5, 2)];
    const { segments: out, deleted } = deleteSegment(segments, 0, new Set());
    expect(deleted).toBe(false);
    expect(out).toEqual(segments);
  });

  it('deletes an individually-restored segment (plain id, in restoredIds), giving time to the downstream absorber', () => {
    const segments = [seg('host', 0, 2), seg('restored', 2, 1), seg('next', 3, 4)];
    const { segments: out, deleted } = deleteSegment(segments, 1, new Set(['restored']));
    expect(deleted).toBe(true);
    expect(out).toHaveLength(2);
    assertGapless(out);
    expect(out[1]!.startTime).toBeCloseTo(2, 3);
    expect(out[1]!.duration).toBeCloseTo(5, 3);
  });

  it('a restored segment carries no "last remaining" restriction (unlike a split slice)', () => {
    const segments = [seg('host', 0, 2), seg('solo-restored', 2, 1)];
    const { deleted } = deleteSegment(segments, 1, new Set(['solo-restored']));
    expect(deleted).toBe(true);
  });

  it('gives freed time to a downstream absorber (next) when deleting the first of two slices, if the next is not a sibling', () => {
    const p = 'parent';
    const segments = [
      seg('before', 0, 2),
      seg(makeSliceSegmentId(p, 0), 2, 1),
      seg(makeSliceSegmentId(p, 1), 3, 1),
    ];
    // delete slice 0 -> sibling is slice 1 (next), so time goes there.
    const { segments: out, deleted } = deleteSegment(segments, 1, new Set());
    expect(deleted).toBe(true);
    assertGapless(out);
    expect(out[1]!.startTime).toBeCloseTo(2, 3);
    expect(out[1]!.duration).toBeCloseTo(2, 3);
  });

  it('falls back to the PREVIOUS segment as absorber when deleting the very last segment', () => {
    const segments = [seg('host', 0, 2), seg('restored', 2, 1.5)];
    const { segments: out, deleted } = deleteSegment(segments, 1, new Set(['restored']));
    expect(deleted).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]!.duration).toBeCloseTo(3.5, 3);
  });

  it('is pure — does not mutate the input array', () => {
    const p = 'parent';
    const segments = [seg(makeSliceSegmentId(p, 0), 0, 3), seg(makeSliceSegmentId(p, 1), 3, 2)];
    const snapshot = JSON.parse(JSON.stringify(segments));
    deleteSegment(segments, 0, new Set());
    expect(segments).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// WS2 session ws2-25, Commit 4 — restored/split segment lifecycle.
// ---------------------------------------------------------------------------
describe('deleteSegment — text follows a stretching sibling (3-way split)', () => {
  it('keeps part 2\'s own text when deleting part 3 stretches part 2 into the vacated slot', () => {
    const orig = [seg('ORIG', 0, 6, 'You start watching the older hunters differently.')];
    const s1 = splitSegmentAtTime(orig, 0, 2);       // "You start watching" | "the older hunters differently."
    const s2 = splitSegmentAtTime(s1.segments, 1, 3.5); // splits piece 2 -> "the older" | "hunters differently."
    expect(s2.segments).toHaveLength(3);
    expect(s2.segments[0]!.text).toBe('You start watching');
    expect(s2.segments[1]!.text).toBe('the older');
    expect(s2.segments[2]!.text).toBe('hunters differently.');

    const del = deleteSegment(s2.segments, 2, new Set());
    expect(del.deleted).toBe(true);
    expect(del.segments).toHaveLength(2);
    // Part 2 stretched to absorb part 3's freed time — but its OWN text,
    // never part 3's or part 1's, must be what's attached to it afterward.
    expect(del.segments[1]!.text).toBe('the older');
    expect(del.segments[1]!.startTime).toBe(2);
    expect(del.segments[1]!.duration).toBeCloseTo(4, 3);
    assertGapless(del.segments);
  });

  it('keeps the correct text when the FIRST of a pair is deleted (next stretches backward)', () => {
    const orig = [seg('ORIG', 0, 6, 'You start watching the older hunters differently.')];
    const s1 = splitSegmentAtTime(orig, 0, 2);
    const del = deleteSegment(s1.segments, 0, new Set());
    expect(del.deleted).toBe(true);
    expect(del.segments).toHaveLength(1);
    expect(del.segments[0]!.text).toBe('the older hunters differently.');
    expect(del.segments[0]!.startTime).toBe(0);
  });
});

describe('deleteSegment — merged restore slot (3b/isMergeSlotSegmentId)', () => {
  it('is always deletable despite having no sibling — the old last-slice rule no longer applies to it', () => {
    const segments = [
      seg('host', 0, 5),
      seg(makeSliceSegmentId('host', MERGE_SLOT_ORDINAL), 5, 2, 'Merged restore text.'),
      seg('after', 7, 3),
    ];
    expect(isMergeSlotSegmentId(segments[1]!.id)).toBe(true);
    const del = deleteSegment(segments, 1, new Set());
    expect(del.deleted).toBe(true);
    expect(del.segments).toHaveLength(2);
  });

  it('an ordinary split\'s last remaining slice is still refused (unaffected by the merge-slot exception)', () => {
    const orig = [seg('ORIG', 0, 6, 'Some text here now.')];
    const s1 = splitSegmentAtTime(orig, 0, 2);
    const firstDelete = deleteSegment(s1.segments, 0, new Set());
    expect(firstDelete.deleted).toBe(true);
    expect(firstDelete.segments).toHaveLength(1);
    expect(isMergeSlotSegmentId(firstDelete.segments[0]!.id)).toBe(false);
    // Now only one slice remains from the original split pair — must be refused.
    const secondDelete = deleteSegment(firstDelete.segments, 0, new Set());
    expect(secondDelete.deleted).toBe(false);
  });
});
