/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  splitSegmentAtTime,
  deleteSegment,
  parentIdFromSliceId,
  splitSelectedSegment,
  deleteSelectedSegment,
} from './segmentSplitDelete';
import { makeSliceSegmentId, isSliceSegmentId } from './segmentId';
import { emptyHistory, pushEntry, undo } from './history';
import type { VideoSegment } from '../types';

/** True iff `id` is `null`, or points at a real element of `segments` — the
 *  invariant a caller (App.tsx) relies on to never hand `BottomDrawer` a
 *  `segmentId` absent from `project.segments` (WS2 ws2-28). */
function selectionIsCoherent(id: string | null, segments: readonly VideoSegment[]): boolean {
  return id === null || segments.some(s => s.id === id);
}

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
    const { segments: out, deleted } = deleteSegment(segments, 0);
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
    const { segments: out, deleted } = deleteSegment(segments, 1);
    expect(deleted).toBe(true);
    expect(out).toHaveLength(2);
    assertGapless(out);
    expect(out[0]!.duration).toBeCloseTo(5, 3); // absorbed the deleted slice's 2s
    expect(out[1]!.id).toBe('next');
  });

  it('refuses to delete the LAST remaining slice of a split', () => {
    const p = 'parent';
    const segments = [seg(makeSliceSegmentId(p, 0), 0, 5), seg('next', 5, 2)];
    const { segments: out, deleted } = deleteSegment(segments, 0);
    expect(deleted).toBe(false);
    expect(out).toEqual(segments);
  });

  it('gives freed time to a downstream absorber (next) when deleting the first of two slices, if the next is not a sibling', () => {
    const p = 'parent';
    const segments = [
      seg('before', 0, 2),
      seg(makeSliceSegmentId(p, 0), 2, 1),
      seg(makeSliceSegmentId(p, 1), 3, 1),
    ];
    // delete slice 0 -> sibling is slice 1 (next), so time goes there.
    const { segments: out, deleted } = deleteSegment(segments, 1);
    expect(deleted).toBe(true);
    assertGapless(out);
    expect(out[1]!.startTime).toBeCloseTo(2, 3);
    expect(out[1]!.duration).toBeCloseTo(2, 3);
  });

  it('is pure — does not mutate the input array', () => {
    const p = 'parent';
    const segments = [seg(makeSliceSegmentId(p, 0), 0, 3), seg(makeSliceSegmentId(p, 1), 3, 2)];
    const snapshot = JSON.parse(JSON.stringify(segments));
    deleteSegment(segments, 0);
    expect(segments).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// WS2 session ws2-25, Commit 4 — split segment lifecycle.
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

    const del = deleteSegment(s2.segments, 2);
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
    const del = deleteSegment(s1.segments, 0);
    expect(del.deleted).toBe(true);
    expect(del.segments).toHaveLength(1);
    expect(del.segments[0]!.text).toBe('the older hunters differently.');
    expect(del.segments[0]!.startTime).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WS2 ws2-28, Commit 2 — deleteSegment reports its absorber.
// ---------------------------------------------------------------------------
describe('deleteSegment — absorbedById', () => {
  it('reports the PREVIOUS sibling when it absorbs (3-way split, deleting the last slice)', () => {
    const orig = [seg('ORIG', 0, 6, 'You start watching the older hunters differently.')];
    const s1 = splitSegmentAtTime(orig, 0, 2);
    const s2 = splitSegmentAtTime(s1.segments, 1, 3.5);
    const del = deleteSegment(s2.segments, 2);
    expect(del.deleted).toBe(true);
    expect(del.absorbedById).toBe(s2.segments[1]!.id);
  });

  it('reports the NEXT sibling when it absorbs (deleting the first of a pair)', () => {
    const orig = [seg('ORIG', 0, 6, 'You start watching the older hunters differently.')];
    const s1 = splitSegmentAtTime(orig, 0, 2);
    const del = deleteSegment(s1.segments, 0);
    expect(del.deleted).toBe(true);
    expect(del.absorbedById).toBe(s1.segments[1]!.id);
  });

  it('reports the sibling-next absorber when deleting the first of two slices ahead of an unrelated segment', () => {
    const p = 'parent';
    const segments = [
      seg('before', 0, 2),
      seg(makeSliceSegmentId(p, 0), 2, 1),
      seg(makeSliceSegmentId(p, 1), 3, 1),
    ];
    const del = deleteSegment(segments, 1);
    expect(del.deleted).toBe(true);
    expect(del.absorbedById).toBe(makeSliceSegmentId(p, 1));
  });

  it('is null on every refused delete', () => {
    const unsplitRefusal = deleteSegment([seg('native', 0, 2), seg('b', 2, 2)], 0);
    expect(unsplitRefusal.deleted).toBe(false);
    expect(unsplitRefusal.absorbedById).toBeNull();

    const p = 'parent';
    const lastSliceRefusal = deleteSegment(
      [seg(makeSliceSegmentId(p, 0), 0, 5), seg('next', 5, 2)],
      0,
    );
    expect(lastSliceRefusal.deleted).toBe(false);
    expect(lastSliceRefusal.absorbedById).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WS2 ws2-28, Commit 2 — selection-aware wrappers: this is what App.tsx's
// handlers call verbatim (segmentSplitDelete.ts's header comment), so pinning
// THESE is pinning the wiring the two prior attempts missed by only testing
// the plain split/delete functions above.
// ---------------------------------------------------------------------------
describe('splitSelectedSegment', () => {
  it('moves selection to the first resulting slice when the split TARGET was selected', () => {
    const segments = [seg('a', 0, 10, 'The quick brown fox jumps over the lazy dog'), seg('b', 10, 2)];
    const result = splitSelectedSegment(segments, 'a', 5, 'a');
    expect(result.split).toBe(true);
    expect(result.selectedSegmentId).toBe(result.segments[0]!.id);
    expect(selectionIsCoherent(result.selectedSegmentId, result.segments)).toBe(true);
    // The redirect target really is the FIRST (ordinal 0) slice, not the second.
    expect(parentIdFromSliceId(result.selectedSegmentId!)).toBe('a');
    expect(result.selectedSegmentId).toBe(makeSliceSegmentId('a', 0));
  });

  it('leaves selection untouched when the split target was NOT the selection (playhead fallback, nothing open)', () => {
    const segments = [seg('a', 0, 10, 'The quick brown fox jumps over the lazy dog'), seg('b', 10, 2)];
    const result = splitSelectedSegment(segments, 'a', 5, null);
    expect(result.split).toBe(true);
    expect(result.selectedSegmentId).toBeNull();
  });

  it('leaves a DIFFERENT open selection untouched when some other segment is split', () => {
    const segments = [
      seg('a', 0, 10, 'The quick brown fox jumps over the lazy dog'),
      seg('open-elsewhere', 10, 4, 'Something else entirely here'),
    ];
    const result = splitSelectedSegment(segments, 'a', 5, 'open-elsewhere');
    expect(result.split).toBe(true);
    expect(result.selectedSegmentId).toBe('open-elsewhere');
    expect(selectionIsCoherent(result.selectedSegmentId, result.segments)).toBe(true);
  });

  it('leaves selection untouched on a refused split (no whitespace to cut at)', () => {
    const segments = [seg('a', 0, 5, 'Supercalifragilisticexpialidocious')];
    const result = splitSelectedSegment(segments, 'a', 2.5, 'a');
    expect(result.split).toBe(false);
    expect(result.selectedSegmentId).toBe('a');
    expect(result.segments).toEqual(segments);
  });

  it('leaves selection untouched when the target id does not exist', () => {
    const segments = [seg('a', 0, 5, 'One two three')];
    const result = splitSelectedSegment(segments, 'does-not-exist', 2.5, 'a');
    expect(result.split).toBe(false);
    expect(result.selectedSegmentId).toBe('a');
  });
});

describe('deleteSelectedSegment', () => {
  it('moves selection to the absorbing sibling when the DELETED slice was selected (3-way chain, last slice — the exact ws2-28 repro)', () => {
    const orig = [seg('ORIG', 0, 6, 'You start watching the older hunters differently.')];
    const s1 = splitSegmentAtTime(orig, 0, 2);
    const s2 = splitSegmentAtTime(s1.segments, 1, 3.5);
    expect(s2.segments).toHaveLength(3);
    const slice3Id = s2.segments[2]!.id;
    const slice2Id = s2.segments[1]!.id;

    const result = deleteSelectedSegment(s2.segments, slice3Id, slice3Id);
    expect(result.deleted).toBe(true);
    expect(result.absorbedById).toBe(slice2Id);
    expect(result.selectedSegmentId).toBe(slice2Id);
    expect(result.segments.find(s => s.id === slice2Id)!.text).toBe('the older');
    expect(selectionIsCoherent(result.selectedSegmentId, result.segments)).toBe(true);
  });

  it('the 2-slice case: split in 2, delete slice 2 (selected) — selection follows to slice 1', () => {
    const orig = [seg('ORIG', 0, 6, 'Alpha bravo charlie delta echo foxtrot')];
    const s1 = splitSegmentAtTime(orig, 0, 3);
    expect(s1.segments).toHaveLength(2);
    const slice1Id = s1.segments[0]!.id;
    const slice2Id = s1.segments[1]!.id;

    const result = deleteSelectedSegment(s1.segments, slice2Id, slice2Id);
    expect(result.deleted).toBe(true);
    expect(result.segments).toHaveLength(1);
    expect(result.absorbedById).toBe(slice1Id);
    expect(result.selectedSegmentId).toBe(slice1Id);
    expect(selectionIsCoherent(result.selectedSegmentId, result.segments)).toBe(true);
  });

  it('deleting slice 1 (not the last) while selected — selection follows to whichever sibling absorbs', () => {
    const orig = [seg('ORIG', 0, 6, 'Alpha bravo charlie delta echo foxtrot')];
    const s1 = splitSegmentAtTime(orig, 0, 3);
    const slice1Id = s1.segments[0]!.id;
    const slice2Id = s1.segments[1]!.id;

    const result = deleteSelectedSegment(s1.segments, slice1Id, slice1Id);
    expect(result.deleted).toBe(true);
    expect(result.segments).toHaveLength(1);
    // slice 1 has no PREVIOUS sibling, so its next (slice 2) absorbs — same
    // cascade rule as the plain deleteSegment test above, just observed
    // through the selection-aware wrapper this time.
    expect(result.absorbedById).toBe(slice2Id);
    expect(result.selectedSegmentId).toBe(slice2Id);
    expect(selectionIsCoherent(result.selectedSegmentId, result.segments)).toBe(true);
  });

  it('deleting a slice that is NOT selected leaves the open editor untouched (guards the ws2-25 fix from regressing)', () => {
    const orig = [seg('ORIG', 0, 6, 'You start watching the older hunters differently.')];
    const s1 = splitSegmentAtTime(orig, 0, 2);
    const s2 = splitSegmentAtTime(s1.segments, 1, 3.5);
    const slice1Id = s2.segments[0]!.id;
    const slice3Id = s2.segments[2]!.id;

    // slice 1 is open in the drawer; slice 3 gets deleted (e.g. via the D
    // shortcut targeting the playhead segment, not the selection).
    const result = deleteSelectedSegment(s2.segments, slice3Id, slice1Id);
    expect(result.deleted).toBe(true);
    expect(result.selectedSegmentId).toBe(slice1Id); // unchanged
    expect(selectionIsCoherent(result.selectedSegmentId, result.segments)).toBe(true);
  });

  it('leaves selection untouched on a refused delete (last remaining slice)', () => {
    const p = 'parent';
    const segments = [seg(makeSliceSegmentId(p, 0), 0, 5), seg('next', 5, 2)];
    const targetId = makeSliceSegmentId(p, 0);
    const result = deleteSelectedSegment(segments, targetId, targetId);
    expect(result.deleted).toBe(false);
    expect(result.selectedSegmentId).toBe(targetId);
    expect(result.segments).toEqual(segments);
    // Not orphaned: the segment that failed to delete is still right there.
    expect(selectionIsCoherent(result.selectedSegmentId, result.segments)).toBe(true);
  });

  it('leaves selection untouched when the target id does not exist', () => {
    const segments = [seg('a', 0, 5, 'One two three')];
    const result = deleteSelectedSegment(segments, 'does-not-exist', 'a');
    expect(result.deleted).toBe(false);
    expect(result.selectedSegmentId).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// WS2 ws2-28, Commit 2 — undo. `selectedSegmentId` is plain UI state, never
// part of `Project`/history's snapshot (CLAUDE.md's undo/redo invariants) —
// so undo only ever restores `segments`. What matters for "coherent" is (a)
// the restored segments are byte-identical to what was there before the
// split/delete (never a partial or re-derived revert), and (b) whatever
// `selectedSegmentId` is sitting at post-undo, it is either valid against
// the RESTORED array or null — never dangling in a way that could render
// wrong content. (b) is what Commit 1's BottomDrawer restructuring
// guarantees structurally (see BottomDrawer.orphanedSelection.test.tsx);
// this test pins (a) via the real history.ts module, not a hand-rolled
// simulation of undo.
// ---------------------------------------------------------------------------
describe('undo after a selection-redirecting split/delete', () => {
  it('restores byte-identical pre-split segments, independent of what selectedSegmentId does', () => {
    const original = [seg('ORIG', 0, 6, 'You start watching the older hunters differently.')];
    let history = emptyHistory<VideoSegment[]>();
    history = pushEntry(history, { state: original, label: 'split segment' });

    const result = splitSelectedSegment(original, 'ORIG', 2, 'ORIG');
    expect(result.split).toBe(true);
    // Selection followed the split, per the earlier test — and is coherent
    // against the POST-split array.
    expect(selectionIsCoherent(result.selectedSegmentId, result.segments)).toBe(true);

    const traversal = undo(history, result.segments);
    expect(traversal).not.toBeNull();
    expect(traversal!.entry.state).toEqual(original); // text/timing coherent, byte-for-byte
    // Post-undo, `result.selectedSegmentId` (a real slice id) is no longer
    // present in the restored (pre-split) array — expected, since selection
    // isn't part of this snapshot. Commit 1 is what makes that safe: it
    // degrades to a blank drawer, never to stale/wrong text.
    expect(selectionIsCoherent(result.selectedSegmentId, traversal!.entry.state)).toBe(false);
  });

  it('restores byte-identical pre-delete segments after a selection-redirecting delete', () => {
    const orig = [seg('ORIG', 0, 6, 'Alpha bravo charlie delta echo foxtrot')];
    const s1 = splitSegmentAtTime(orig, 0, 3);
    const slice2Id = s1.segments[1]!.id;

    let history = emptyHistory<VideoSegment[]>();
    history = pushEntry(history, { state: s1.segments, label: 'delete segment' });

    const result = deleteSelectedSegment(s1.segments, slice2Id, slice2Id);
    expect(result.deleted).toBe(true);

    const traversal = undo(history, result.segments);
    expect(traversal).not.toBeNull();
    expect(traversal!.entry.state).toEqual(s1.segments); // both slices' text/timing back exactly
  });
});
