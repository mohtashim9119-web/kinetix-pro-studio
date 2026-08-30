/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { classifyGapAudio, computeAbsorbedGaps } from './absorbedGaps';
import type { SegmentAlignment } from './whisperService';
import type { TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';

function seg(id: string, startTime: number, duration: number): { id: string; startTime: number; duration: number } {
  return { id, startTime, duration };
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
    const pre = [seg('a', 0, 1), seg('b', 1, 1)];
    const result = computeAbsorbedGaps(pre, [], ['a', 'b'], [align(0, 0), align(1, 1)], [], []);
    expect(result.size).toBe(0);
  });

  it('hosts a single dropped middle segment on the PREVIOUS survivor, with the true reclaimable span', () => {
    // pre-filter: [survivor0, dropped1, survivor2]
    const pre = [seg('s0', 0, 2), seg('d1', 2, 1), seg('s2', 3, 2)];
    const tokens = [tok(0, 1.8, 'kept'), tok(3.4, 4.9, 'kept2')];
    const skipped = [{ segmentIndex: 1 }];
    // keptAlignments index-parallel to kept = [s0, s2]
    const keptAlignments = [align(0, 0), align(1, 1)];
    const silences: SilenceInterval[] = [{ startSec: 1.8, endSec: 3.4 }];

    const result = computeAbsorbedGaps(pre, skipped, ['s0', 's2'], keptAlignments, tokens, silences);

    expect(result.size).toBe(1);
    const gaps = result.get('s0');
    expect(gaps).toBeDefined();
    expect(gaps).toHaveLength(1);
    expect(gaps![0]!.segmentId).toBe('d1');
    expect(gaps![0]!.span).toEqual({ start: 1.8, end: 3.4 });
    expect(gaps![0]!.gapAudio).toBe('silent');
  });

  it('groups a run of consecutive drops into one shared span, one entry each, same host', () => {
    const pre = [seg('s0', 0, 1), seg('d1', 1, 0.5), seg('d2', 1.5, 0.5), seg('s3', 2, 1)];
    const tokens = [tok(0, 0.9), tok(2.1, 3.0)];
    const skipped = [{ segmentIndex: 1 }, { segmentIndex: 2 }];
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
    const pre = [seg('d0', 0, 1), seg('s1', 1, 2)];
    const tokens = [tok(1.2, 2.5)];
    const skipped = [{ segmentIndex: 0 }];
    const keptAlignments = [align(0, 0)];

    const result = computeAbsorbedGaps(pre, skipped, ['s1'], keptAlignments, tokens, []);
    expect(result.get('s1')).toHaveLength(1);
    expect(result.get('s1')![0]!.span.end).toBe(1.2);
  });

  it('hosts a TRAILING drop (after the last survivor) on the PREVIOUS survivor', () => {
    const pre = [seg('s0', 0, 2), seg('d1', 2, 1)];
    const tokens = [tok(0.1, 1.7)];
    const skipped = [{ segmentIndex: 1 }];
    const keptAlignments = [align(0, 0)];

    const result = computeAbsorbedGaps(pre, skipped, ['s0'], keptAlignments, tokens, []);
    expect(result.get('s0')).toHaveLength(1);
    expect(result.get('s0')![0]!.span.start).toBe(1.7);
  });

  it('falls back to the dropped run\'s own recorded start/end when no token data is available', () => {
    const pre = [seg('s0', 0, 2), seg('d1', 2, 1), seg('s2', 3, 2)];
    const skipped = [{ segmentIndex: 1 }];
    const keptAlignments: SegmentAlignment[] = [];

    const result = computeAbsorbedGaps(pre, skipped, ['s0', 's2'], keptAlignments, [], []);
    expect(result.get('s0')![0]!.span).toEqual({ start: 2, end: 3 });
    expect(result.get('s0')![0]!.gapAudio).toBe('unknown');
  });

  it('is pure — does not mutate any input array or object', () => {
    const pre = [seg('s0', 0, 2), seg('d1', 2, 1), seg('s2', 3, 2)];
    const preSnapshot = JSON.parse(JSON.stringify(pre));
    const skipped = [{ segmentIndex: 1 }];
    computeAbsorbedGaps(pre, skipped, ['s0', 's2'], [align(0, 0), align(1, 1)], [tok(0, 1.8), tok(3.4, 4.9)], []);
    expect(pre).toEqual(preSnapshot);
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
  const preFilter = [seg('a', 0, 1), seg('b', 1, 1), seg('c', 2, 1)];
  const skipped = [{ segmentIndex: 1 }];
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
