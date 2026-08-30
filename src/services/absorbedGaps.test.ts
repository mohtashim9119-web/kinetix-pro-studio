/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  classifyGapAudio, computeAbsorbedGaps, applyAbsorbedGaps,
  collectOrphanTokens, attributeOrphansByText, computeOrphanRegions,
} from './absorbedGaps';
import type { SegmentAlignment } from './whisperService';
import type { VideoSegment, TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';

function seg(id: string, text: string, startTime: number, duration: number): VideoSegment {
  return { id, text, startTime, duration } as VideoSegment;
}

function align(firstTokenIdx: number, lastTokenIdx: number): SegmentAlignment {
  return {
    t0: 0, t1: 0, firstTokenIdx, lastTokenIdx, confidence: 1, matched: true,
    matchedWords: 1, totalWords: 1, longestRun: 1,
  } as SegmentAlignment;
}

function tok(startSec: number, endSec: number, text = 'x'): TranscriptToken {
  return { startSec, endSec, text };
}

describe('classifyGapAudio', () => {
  it('reports silent when the span is mostly covered by detected silence', () => {
    const silences: SilenceInterval[] = [{ startSec: 1, endSec: 2 }];
    expect(classifyGapAudio(1, 2, silences)).toBe('silent');
  });

  it('reports speech when the span has little/no silence overlap', () => {
    const silences: SilenceInterval[] = [{ startSec: 1.9, endSec: 2.0 }];
    expect(classifyGapAudio(1, 2, silences)).toBe('speech');
  });

  it('reports unknown when there is no silence data at all', () => {
    expect(classifyGapAudio(1, 2, [])).toBe('unknown');
  });

  it('reports unknown for a degenerate (empty/inverted) span', () => {
    expect(classifyGapAudio(2, 1, [{ startSec: 0, endSec: 5 }])).toBe('unknown');
    expect(classifyGapAudio(2, 2, [{ startSec: 0, endSec: 5 }])).toBe('unknown');
  });
});

describe('computeAbsorbedGaps', () => {
  it('returns empty when nothing was skipped', () => {
    const pre = [seg('a', 'A', 0, 1), seg('b', 'B', 1, 1)];
    const result = computeAbsorbedGaps(pre, [], ['a', 'b'], [align(0, 0), align(1, 1)], [], []);
    expect(result.size).toBe(0);
  });

  it('hosts a single dropped middle segment on the PREVIOUS survivor, with the true reclaimable span', () => {
    // pre-filter: [survivor0, dropped1, survivor2]
    const pre = [seg('s0', 'Kept one.', 0, 2), seg('d1', 'Dropped one.', 2, 1), seg('s2', 'Kept two.', 3, 2)];
    const tokens = [tok(0, 1.8, 'kept'), tok(3.4, 4.9, 'kept2')];
    const skipped = [{ segmentIndex: 1, segmentText: 'Dropped one.' }];
    // keptAlignments index-parallel to kept = [s0, s2]
    const keptAlignments = [align(0, 0), align(1, 1)];
    const silences: SilenceInterval[] = [{ startSec: 1.8, endSec: 3.4 }];

    const result = computeAbsorbedGaps(pre, skipped, ['s0', 's2'], keptAlignments, tokens, silences);

    expect(result.size).toBe(1);
    const gaps = result.get('s0');
    expect(gaps).toBeDefined();
    expect(gaps).toHaveLength(1);
    expect(gaps![0]!.segmentId).toBe('d1');
    expect(gaps![0]!.text).toBe('Dropped one.');
    expect(gaps![0]!.span).toEqual({ start: 1.8, end: 3.4 });
    expect(gaps![0]!.gapAudio).toBe('silent');
  });

  it('groups a run of consecutive drops into one shared span, one entry each, same host', () => {
    const pre = [
      seg('s0', 'Kept one.', 0, 1),
      seg('d1', 'Dropped A.', 1, 0.5),
      seg('d2', 'Dropped B.', 1.5, 0.5),
      seg('s3', 'Kept two.', 2, 1),
    ];
    const tokens = [tok(0, 0.9), tok(2.1, 3.0)];
    const skipped = [
      { segmentIndex: 1, segmentText: 'Dropped A.' },
      { segmentIndex: 2, segmentText: 'Dropped B.' },
    ];
    const keptAlignments = [align(0, 0), align(1, 1)];

    const result = computeAbsorbedGaps(pre, skipped, ['s0', 's3'], keptAlignments, tokens, []);
    const gaps = result.get('s0')!;
    expect(gaps).toHaveLength(2);
    expect(gaps[0]!.span).toEqual(gaps[1]!.span);
    expect(gaps[0]!.span).toEqual({ start: 0.9, end: 2.1 });
    expect(gaps.map(g => g.segmentId)).toEqual(['d1', 'd2']);
    expect(gaps.every(g => g.gapAudio === 'unknown')).toBe(true); // no silence data supplied
  });

  it('hosts a LEADING drop (before the first survivor) on the NEXT survivor', () => {
    const pre = [seg('d0', 'Dropped lead.', 0, 1), seg('s1', 'Kept.', 1, 2)];
    const tokens = [tok(1.2, 2.5)];
    const skipped = [{ segmentIndex: 0, segmentText: 'Dropped lead.' }];
    const keptAlignments = [align(0, 0)];

    const result = computeAbsorbedGaps(pre, skipped, ['s1'], keptAlignments, tokens, []);
    expect(result.get('s1')).toHaveLength(1);
    expect(result.get('s1')![0]!.span.end).toBe(1.2);
  });

  it('hosts a TRAILING drop (after the last survivor) on the PREVIOUS survivor', () => {
    const pre = [seg('s0', 'Kept.', 0, 2), seg('d1', 'Dropped tail.', 2, 1)];
    const tokens = [tok(0.1, 1.7)];
    const skipped = [{ segmentIndex: 1, segmentText: 'Dropped tail.' }];
    const keptAlignments = [align(0, 0)];

    const result = computeAbsorbedGaps(pre, skipped, ['s0'], keptAlignments, tokens, []);
    expect(result.get('s0')).toHaveLength(1);
    expect(result.get('s0')![0]!.span.start).toBe(1.7);
  });

  it('falls back to the dropped run\'s own recorded start/end when no token data is available', () => {
    const pre = [seg('s0', 'Kept.', 0, 2), seg('d1', 'Dropped.', 2, 1), seg('s2', 'Kept2.', 3, 2)];
    const skipped = [{ segmentIndex: 1, segmentText: 'Dropped.' }];
    const keptAlignments: SegmentAlignment[] = [];

    const result = computeAbsorbedGaps(pre, skipped, ['s0', 's2'], keptAlignments, [], []);
    expect(result.get('s0')![0]!.span).toEqual({ start: 2, end: 3 });
    expect(result.get('s0')![0]!.gapAudio).toBe('unknown');
  });

  it('is pure — does not mutate any input array or object', () => {
    const pre = [seg('s0', 'Kept.', 0, 2), seg('d1', 'Dropped.', 2, 1), seg('s2', 'Kept2.', 3, 2)];
    const preSnapshot = JSON.parse(JSON.stringify(pre));
    const skipped = [{ segmentIndex: 1, segmentText: 'Dropped.' }];
    computeAbsorbedGaps(pre, skipped, ['s0', 's2'], [align(0, 0), align(1, 1)], [tok(0, 1.8), tok(3.4, 4.9)], []);
    expect(pre).toEqual(preSnapshot);
  });
});

describe('applyAbsorbedGaps', () => {
  it('merges gaps onto the matching segment by id and leaves others untouched (same reference)', () => {
    const s0 = seg('s0', 'A', 0, 1);
    const s1 = seg('s1', 'B', 1, 1);
    const gapsByHost = new Map([['s0', [{ segmentId: 'd', text: 'D', span: { start: 0.5, end: 0.9 }, gapAudio: 'silent' as const }]]]);
    const out = applyAbsorbedGaps([s0, s1], gapsByHost);
    expect(out[0]!.absorbedGaps).toHaveLength(1);
    expect(out[1]).toBe(s1); // untouched segment returned by reference
  });

  it('returns the input array unchanged (by reference) when there is nothing to merge', () => {
    const segments = [seg('s0', 'A', 0, 1)];
    expect(applyAbsorbedGaps(segments, new Map())).toBe(segments);
  });
});

// ---------------------------------------------------------------------------
// WS2 session ws2-25, Commit 1 — WORD SOURCE.
//
// `computeAbsorbedGaps` builds every span by dereferencing
// `keptAlignments[i].lastTokenIdx`/`.firstTokenIdx` into the `tokens` argument.
// Those are positional indices with no identity of their own, so the array
// handed in decides the answer completely. App.tsx passes `aligned.tokens` —
// FA's word list on the FA arm, Whisper's on the Whisper arm.
//
// Measured on the real corpora (.work-phase4/session-ws2-25/c1-word-source.json):
// the two arms differ in token count (v6 3989 vs 3874; 173 1836 vs 1660) and in
// first/last token time, so this is a real fork, not a distinction without a
// difference. These tests pin the dependency itself: same segments, same
// alignments, DIFFERENT token arrays => different spans. A future edit that
// swaps `aligned.tokens` back for the raw Whisper array fails here.
// ---------------------------------------------------------------------------
describe('computeAbsorbedGaps — word source', () => {
  const preFilter = [seg('a', 'kept one', 0, 1), seg('b', 'dropped', 1, 1), seg('c', 'kept two', 2, 1)];
  const skipped = [{ segmentIndex: 1, segmentText: 'dropped' }];
  const keptIds = ['a', 'c'];
  // Survivor 'a' ends at token 0; survivor 'c' starts at token 1.
  const keptAlignments = [align(0, 0), align(1, 1)];

  it('reads spans from the token array it is given, not from any ambient array', () => {
    const whisperish: TranscriptToken[] = [tok(0.0, 78.73), tok(78.97, 80.0)];
    const faish: TranscriptToken[] = [tok(0.0, 78.56), tok(79.0, 80.0)];

    const fromWhisper = computeAbsorbedGaps(preFilter, skipped, keptIds, keptAlignments, whisperish, []);
    const fromFa = computeAbsorbedGaps(preFilter, skipped, keptIds, keptAlignments, faish, []);

    expect(fromWhisper.get('a')![0]!.span).toEqual({ start: 78.73, end: 78.97 });
    expect(fromFa.get('a')![0]!.span).toEqual({ start: 78.56, end: 79 });
  });

  it('produces a materially different span per arm for the same drop', () => {
    const whisperish: TranscriptToken[] = [tok(0, 442.94), tok(445.36, 446)];
    const faish: TranscriptToken[] = [tok(0, 442.5), tok(446.0, 447)];

    const w = computeAbsorbedGaps(preFilter, skipped, keptIds, keptAlignments, whisperish, []);
    const f = computeAbsorbedGaps(preFilter, skipped, keptIds, keptAlignments, faish, []);

    const width = (m: Map<string, { span: { start: number; end: number } }[]>) => {
      const g = m.get('a')![0]!.span;
      return Number((g.end - g.start).toFixed(3));
    };
    expect(width(w)).toBe(2.42);
    expect(width(f)).toBe(3.5);
    expect(width(w)).not.toBe(width(f));
  });

  it('falls back to the dropped run\'s own extent when given no tokens at all', () => {
    const none = computeAbsorbedGaps(preFilter, skipped, keptIds, keptAlignments, [], []);
    // No token to dereference on either side => the dropped run's own bounds.
    expect(none.get('a')![0]!.span).toEqual({ start: 1, end: 2 });
    expect(none.get('a')![0]!.gapAudio).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// WS2 session ws2-25, Commit 2 — ORPHAN TOKENS.
//
// The span between two survivors is not free time. Tokens that sit inside it —
// claimed by neither survivor's alignment — are the DROPPED scene's own
// speech, and they, not the span width, are what a restore should be sized
// from. Measured on 173 `shadow_loss`: 4 orphan tokens spanning 1.54s inside a
// 2.42s span, so the span-sized restore was taking 0.88s of neighbour time
// that no one ever spoke into.
// ---------------------------------------------------------------------------
describe('collectOrphanTokens', () => {
  const tokens = [tok(0, 1, 'a'), tok(1, 2, 'b'), tok(2, 3, 'c'), tok(3, 4, 'd'), tok(4, 5, 'e')];

  it('takes the tokens strictly between the two survivors, by INDEX not by time', () => {
    expect(collectOrphanTokens(tokens, 0, 4).map(t => t.text)).toEqual(['b', 'c', 'd']);
  });

  it('scans from token 0 for a leading run (no previous survivor)', () => {
    expect(collectOrphanTokens(tokens, undefined, 2).map(t => t.text)).toEqual(['a', 'b']);
  });

  it('scans to the end of the array for a trailing run (no next survivor)', () => {
    expect(collectOrphanTokens(tokens, 2, undefined).map(t => t.text)).toEqual(['d', 'e']);
  });

  it('is empty when the survivors are adjacent in index space', () => {
    expect(collectOrphanTokens(tokens, 1, 2)).toEqual([]);
  });

  it('is empty with no tokens at all', () => {
    expect(collectOrphanTokens([], 0, 5)).toEqual([]);
  });
});

describe('attributeOrphansByText', () => {
  it('gives every orphan to the only scene in a single-scene cluster', () => {
    const orphans = [tok(1, 2, 'don'), tok(2, 3, 'emerge')];
    expect(attributeOrphansByText(orphans, ['Some don’t emerge.'])).toEqual([0, 0]);
  });

  it('splits monotonically when each scene\'s own words appear in order', () => {
    const orphans = [tok(0, 1, 'but'), tok(1, 2, 'something'), tok(2, 3, 'small'), tok(3, 4, 'permanent')];
    const got = attributeOrphansByText(orphans, ['But something stayed.', 'Small and permanent.']);
    expect(got).toEqual([0, 0, 1, 1]);
  });

  it('declines when a scene would be left with no tokens at all', () => {
    const orphans = [tok(0, 1, 'but')];
    expect(attributeOrphansByText(orphans, ['But something stayed.', 'Small and permanent.'])).toBeNull();
  });

  it('declines when not one orphan matches the script — a positional chop is not an attribution', () => {
    const orphans = [tok(0, 1, 'zzz'), tok(1, 4, 'qqq')];
    expect(attributeOrphansByText(orphans, ['abcd', 'efgh'])).toBeNull();
  });

  it('declines with no orphans', () => {
    expect(attributeOrphansByText([], ['anything'])).toBeNull();
  });
});

describe('computeOrphanRegions', () => {
  it('covers exactly the first orphan onset to the last orphan end', () => {
    const orphans = [tok(443.82, 444.1, 'don'), tok(444.2, 445.36, 'emerge')];
    const regions = computeOrphanRegions(orphans, ['Some don’t emerge.']);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.start).toBe(443.82);
    expect(regions[0]!.end).toBe(445.36);
  });

  it('cuts a multi-scene cluster at the NEXT scene\'s first token onset', () => {
    const orphans = [tok(0, 1, 'but'), tok(1, 2, 'something'), tok(3, 4, 'small'), tok(4, 5, 'permanent')];
    const regions = computeOrphanRegions(orphans, ['But something stayed.', 'Small and permanent.']);
    expect(regions[0]).toMatchObject({ start: 0, end: 3 });
    expect(regions[1]).toMatchObject({ start: 3, end: 5 });
  });

  it('is contiguous and exact — pieces tile the whole orphan region with no seam', () => {
    const orphans = [tok(10, 11, 'alpha'), tok(12, 13, 'beta'), tok(14, 15.5, 'gamma')];
    const regions = computeOrphanRegions(orphans, ['alpha beta', 'gamma']);
    for (let i = 0; i + 1 < regions.length; i++) {
      expect(regions[i]!.end).toBe(regions[i + 1]!.start);
    }
    expect(regions[0]!.start).toBe(10);
    expect(regions[regions.length - 1]!.end).toBe(15.5);
  });

  it('falls back to character weighting when the text cannot be attributed', () => {
    const orphans = [tok(0, 1, 'zzz'), tok(1, 4, 'qqq')];
    const regions = computeOrphanRegions(orphans, ['abcd', 'efgh']);
    // Equal char counts => equal halves of [0, 4).
    expect(regions[0]).toMatchObject({ start: 0, end: 2 });
    expect(regions[1]).toMatchObject({ start: 2, end: 4 });
  });

  it('returns nothing at all when there are no orphan tokens', () => {
    expect(computeOrphanRegions([], ['anything'])).toEqual([]);
  });
});

describe('computeAbsorbedGaps — orphan recording', () => {
  it('records the orphan count and each scene\'s own spoken span', () => {
    const preFilter = [seg('a', 'one', 0, 1), seg('b', 'dropped', 1, 1), seg('c', 'two', 2, 1)];
    const tokens = [
      tok(440, 442.94, 'course'), tok(443.82, 444.0, 'don'), tok(444.0, 444.2, 'emerge'),
      tok(445.36, 446, 'ground'),
    ];
    const gaps = computeAbsorbedGaps(
      preFilter, [{ segmentIndex: 1, segmentText: 'Some don’t emerge.' }],
      ['a', 'c'], [align(0, 0), align(3, 3)], tokens, [],
    );
    const g = gaps.get('a')![0]!;
    expect(g.span).toEqual({ start: 442.94, end: 445.36 });
    expect(g.orphanCount).toBe(2);
    expect(g.spokenSpan).toEqual({ start: 443.82, end: 444.2 });
  });

  it('records orphanCount 0 and no spokenSpan when the transcript is empty there', () => {
    const preFilter = [seg('a', 'one', 0, 1), seg('b', 'dropped', 1, 1), seg('c', 'two', 2, 1)];
    const tokens = [tok(78.18, 78.73, 'happened'), tok(78.97, 80.57, 'You')];
    const gaps = computeAbsorbedGaps(
      preFilter, [{ segmentIndex: 1, segmentText: 'But something stayed in you.' }],
      ['a', 'c'], [align(0, 0), align(1, 1)], tokens, [],
    );
    const g = gaps.get('a')![0]!;
    expect(g.orphanCount).toBe(0);
    expect(g.spokenSpan).toBeUndefined();
  });
});
