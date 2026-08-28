/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { classifyGapAudio, computeAbsorbedGaps, applyAbsorbedGaps } from './absorbedGaps';
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
