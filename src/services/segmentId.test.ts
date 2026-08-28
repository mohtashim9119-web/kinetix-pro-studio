/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  SEGMENT_ID_NORM_VERSION,
  normalizeForSegmentId,
  computeContentKey,
  assignSegmentIds,
  isCurrentVersionSegmentId,
  backfillSegmentIds,
  makeSliceSegmentId,
  isSliceSegmentId,
} from './segmentId';

describe('normalizeForSegmentId', () => {
  it('collapses case, punctuation, and whitespace differences', () => {
    expect(normalizeForSegmentId('Hello,  World!!')).toBe(normalizeForSegmentId('hello world'));
    expect(normalizeForSegmentId('  Trim me  ')).toBe(normalizeForSegmentId('Trim me'));
  });

  it('does not collapse genuinely different text', () => {
    expect(normalizeForSegmentId('Hello world')).not.toBe(normalizeForSegmentId('Hello there'));
  });
});

describe('computeContentKey', () => {
  it('is stable for identical text and ordinal', () => {
    expect(computeContentKey('The quick brown fox', 0)).toBe(computeContentKey('The quick brown fox', 0));
  });

  it('differs by ordinal for identical text', () => {
    const a = computeContentKey('Chapter One', 0);
    const b = computeContentKey('Chapter One', 1);
    expect(a).not.toBe(b);
  });

  it('is tagged with the frozen normalization version', () => {
    expect(computeContentKey('anything', 0).startsWith(`${SEGMENT_ID_NORM_VERSION}_`)).toBe(true);
  });
});

describe('assignSegmentIds — determinism across runs', () => {
  it('produces identical ids for two independent runs over the same fresh segments', () => {
    const segments = [
      { text: 'A soldier walks alone.' },
      { text: 'The desert stretches on.' },
      { text: 'Night falls quickly here.' },
    ];

    const runA = assignSegmentIds(segments);
    const runB = assignSegmentIds(segments.map(s => ({ ...s }))); // fresh objects, same content

    expect(runA.map(s => s.id)).toEqual(runB.map(s => s.id));
  });

  it('re-running Apply Sync on the identical script (same previousSegments) yields identical ids', () => {
    const segments = [{ text: 'Opening line.' }, { text: 'Closing line.' }];

    const firstRun = assignSegmentIds(segments); // fresh ingest, no previous
    const secondRun = assignSegmentIds(segments, firstRun); // "re-sync" against its own prior output
    const thirdRun = assignSegmentIds(segments, secondRun);

    expect(secondRun.map(s => s.id)).toEqual(firstRun.map(s => s.id));
    expect(thirdRun.map(s => s.id)).toEqual(firstRun.map(s => s.id));
  });
});

describe('assignSegmentIds — duplicate-text disambiguation', () => {
  it('assigns distinct ids to segments that share identical normalized text', () => {
    const segments = [
      { text: 'Thank you for watching.' },
      { text: 'Something in between.' },
      { text: 'Thank you for watching.' },
      { text: 'THANK YOU FOR WATCHING!' }, // normalizes identically to the above two
    ];

    const assigned = assignSegmentIds(segments);
    const ids = assigned.map(s => s.id);

    expect(new Set(ids).size).toBe(4); // all unique despite 3 sharing normalized text
    // deterministic by document order: same ordinal assignment every run
    const rerun = assignSegmentIds(segments.map(s => ({ ...s })));
    expect(rerun.map(s => s.id)).toEqual(ids);
  });
});

describe('assignSegmentIds — persisted-id join across a text edit', () => {
  it('carries forward the previous id when text is unchanged', () => {
    const previous = assignSegmentIds([{ text: 'Unchanged line.' }, { text: 'Also unchanged.' }]);
    const resynced = assignSegmentIds(
      [{ text: 'Unchanged line.' }, { text: 'Also unchanged.' }],
      previous,
    );
    expect(resynced.map(s => s.id)).toEqual(previous.map(s => s.id));
  });

  it('mints a fresh id for a segment whose text changed, without disturbing the others', () => {
    const previous = assignSegmentIds([{ text: 'Line one.' }, { text: 'Line two.' }, { text: 'Line three.' }]);
    const resynced = assignSegmentIds(
      [{ text: 'Line one.' }, { text: 'Line TWO edited.' }, { text: 'Line three.' }],
      previous,
    );

    expect(resynced[0]!.id).toBe(previous[0]!.id);
    expect(resynced[2]!.id).toBe(previous[2]!.id);
    expect(resynced[1]!.id).not.toBe(previous[1]!.id);
    expect(resynced[1]!.id).toBe(computeContentKey('Line TWO edited.', 0));
  });

  it('carries forward a legacy (non-content-shaped) previous id when text is unchanged', () => {
    const previous = [{ id: 'legacy-random-uuid-1234', text: 'Old segment.' }];
    const resynced = assignSegmentIds([{ text: 'Old segment.' }], previous);
    expect(resynced[0]!.id).toBe('legacy-random-uuid-1234');
  });
});

describe('isCurrentVersionSegmentId', () => {
  it('recognizes ids minted by this module', () => {
    expect(isCurrentVersionSegmentId(computeContentKey('x', 0))).toBe(true);
  });

  it('rejects legacy/foreign ids', () => {
    expect(isCurrentVersionSegmentId('123e4567-e89b-12d3-a456-426614174000')).toBe(false);
    expect(isCurrentVersionSegmentId('')).toBe(false);
  });
});

describe('backfillSegmentIds', () => {
  it('replaces missing or legacy ids with content-derived ones', () => {
    const segments = [
      { id: '', text: 'First.' },
      { id: 'random-uuid-abc', text: 'Second.' },
    ];
    const backfilled = backfillSegmentIds(segments);
    expect(isCurrentVersionSegmentId(backfilled[0]!.id)).toBe(true);
    expect(isCurrentVersionSegmentId(backfilled[1]!.id)).toBe(true);
  });

  it('leaves an already-current-version id untouched', () => {
    const alreadyGood = computeContentKey('Third.', 0);
    const segments = [{ id: alreadyGood, text: 'Third.' }];
    const backfilled = backfillSegmentIds(segments);
    expect(backfilled[0]!.id).toBe(alreadyGood);
  });

  it('is idempotent — loading twice produces identical ids', () => {
    const segments = [
      { id: '', text: 'Alpha.' },
      { id: 'legacy-1', text: 'Beta.' },
      { id: '', text: 'Alpha.' }, // duplicate text, needs ordinal disambiguation
    ];
    const first = backfillSegmentIds(segments);
    const second = backfillSegmentIds(first);
    expect(second.map(s => s.id)).toEqual(first.map(s => s.id));
    expect(new Set(first.map(s => s.id)).size).toBe(3);
  });

  it('disambiguates duplicate text correctly even when only some segments need backfill', () => {
    const alreadyGoodForFirst = computeContentKey('Repeat me.', 0);
    const segments = [
      { id: alreadyGoodForFirst, text: 'Repeat me.' }, // already valid, ordinal 0
      { id: '', text: 'Repeat me.' }, // needs backfill, should land on ordinal 1
    ];
    const backfilled = backfillSegmentIds(segments);
    expect(backfilled[0]!.id).toBe(alreadyGoodForFirst);
    expect(backfilled[1]!.id).toBe(computeContentKey('Repeat me.', 1));
    expect(backfilled[0]!.id).not.toBe(backfilled[1]!.id);
  });
});

describe('slice segment ids (WS2 T2.1)', () => {
  it('makeSliceSegmentId is recognized by isSliceSegmentId and isCurrentVersionSegmentId', () => {
    const parentId = computeContentKey('A restored gap neighbour.', 0);
    const sliceId = makeSliceSegmentId(parentId, 1);
    expect(isSliceSegmentId(sliceId)).toBe(true);
    expect(isCurrentVersionSegmentId(sliceId)).toBe(true);
  });

  it('does not mistake a plain content-key id for a slice id', () => {
    const contentId = computeContentKey('Not a slice.', 0);
    expect(isSliceSegmentId(contentId)).toBe(false);
  });

  it('does not mistake a legacy/foreign id for a slice id', () => {
    expect(isSliceSegmentId('123e4567-e89b-12d3-a456-426614174000')).toBe(false);
    expect(isSliceSegmentId('')).toBe(false);
  });

  it('a project containing slice ids survives two consecutive load cycles with ids unchanged', () => {
    const parentId = computeContentKey('Absorbing neighbour text.', 0);
    const segments = [
      { id: parentId, text: 'Absorbing neighbour text.' },
      { id: makeSliceSegmentId(parentId, 0), text: 'Restored slice one.' },
      { id: makeSliceSegmentId(parentId, 1), text: 'Restored slice two.' },
    ];

    // Simulates two consecutive `loadProjectDetailed` calls, each of which
    // runs `backfillSegmentIds` on the stored project unconditionally.
    const firstLoad = backfillSegmentIds(segments);
    const secondLoad = backfillSegmentIds(firstLoad);

    expect(firstLoad.map(s => s.id)).toEqual(segments.map(s => s.id));
    expect(secondLoad.map(s => s.id)).toEqual(segments.map(s => s.id));
  });
});
