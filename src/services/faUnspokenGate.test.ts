/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// R.10 — scripted text never spoken. Unit tests, hand-written fixtures.
//
// Every confidence number below is a REAL measured value from the post-R.5
// capture (WS1 Session E Step 1), not an invented one — so a change to the
// threshold or to either conjunct fails here with the corpus case it breaks
// named, rather than with a synthetic number nobody can trace.
//
//   perilous_realms  (item 10's culprit)   maxConf 1.7248e-5, 7 words, matched:false
//   blue_monkey      (item 11)             maxConf 6.4257e-6, 6 words, matched:false
//   001_scylla_intro (the subword NEAR-MISS) maxConf 1.4653e-2, 1 word, matched:false
//   029_night_understanding (FA recovery)  maxConf 9.9997e-1, 9 words, matched:false
//   013_silent_prehistoric_night           maxConf 3.4890e-4, 5 words, matched:TRUE
//     ^ the one that matters most: it sits BELOW the threshold and is saved by
//       conjunct (1) alone. It is one of the 14 ordinary spoken lines that share
//       item 11's raw "every word needsReview" signature (WS1 Session C).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  detectUnspokenScriptSegments,
  applyUnspokenScriptGate,
  R10_SKIP_REASON,
} from './faUnspokenGate';
import { R10_MAX_WORD_CONF, R10_MIN_WORD_COUNT, CONF_MIN } from './syncConstants';
import { snapCoveredBoundaries } from './snapBoundaries';
import { headExtendFirstSegment } from './syncEngine';
import { findPartitionViolations } from './timelinePartition';
import { filterToCoveredSegments } from '../App';
import type { SegmentAlignment } from './whisperService';
import type { SilenceInterval } from './silenceDetector';
import type { TranscriptToken, VideoSegment } from '../types';

// --- fixture builders ------------------------------------------------------

let nextId = 0;
function seg(text: string, startTime: number, duration: number, tag?: string): VideoSegment {
  return {
    id: `seg-${++nextId}`, text, startTime, duration,
    transition: 'none', animation: 'none', order: nextId, tag,
  } as unknown as VideoSegment;
}

/** `n` FA words evenly filling [startSec, endSec), every one at `confidence`
 *  except the loudest, which carries `maxConf` — the shape the detector reads. */
function faWords(startSec: number, endSec: number, n: number, maxConf: number): TranscriptToken[] {
  const step = (endSec - startSec) / Math.max(n, 1);
  return Array.from({ length: n }, (_, i) => ({
    text: `w${i}`,
    startSec: startSec + i * step,
    endSec: startSec + (i + 1) * step,
    confidence: i === 0 ? maxConf : maxConf / 10,
    wordIndex: i,
    needsReview: maxConf < CONF_MIN,
  }));
}

function align(matched: boolean, confidence = matched ? 1 : 0): SegmentAlignment {
  return {
    t0: 0, t1: 0, firstTokenIdx: matched ? 0 : -1, lastTokenIdx: matched ? 0 : -1,
    confidence, matched, matchedWords: matched ? 1 : 0, totalWords: 1, longestRun: matched ? 1 : 0,
  };
}

// --- the constant ----------------------------------------------------------

describe('R.10 — the named threshold', () => {
  it('R10_MAX_WORD_CONF is its OWN constant, not CONF_MIN', () => {
    // Owner directive (2026-08-17, recorded at the R-Z respec): the two answer
    // different questions and must not drift into each other. CONF_MIN (0.3)
    // over-fires 16/649 on the "every word needsReview" signal.
    expect(R10_MAX_WORD_CONF).not.toBe(CONF_MIN);
    expect(R10_MAX_WORD_CONF).toBe(5e-4);
    expect(R10_MIN_WORD_COUNT).toBe(2);
  });

  it('sits at the geometric midpoint of the two nearest measured points', () => {
    // highest true positive 1.7248e-5 (perilous_realms); nearest negative
    // 1.4653e-2 (spanish 001_scylla_intro). Derived, not fitted.
    const midpoint = Math.sqrt(1.7248e-5 * 1.4653e-2);
    expect(midpoint).toBeGreaterThan(5.0e-4);
    expect(midpoint).toBeLessThan(5.1e-4);
    expect(R10_MAX_WORD_CONF / 1.7248e-5).toBeGreaterThan(25);
    expect(1.4653e-2 / R10_MAX_WORD_CONF).toBeGreaterThan(25);
  });
});

// --- detection -------------------------------------------------------------

describe('R.10 — detectUnspokenScriptSegments', () => {
  it("fires on item 11's configuration (173 blue_monkey)", () => {
    const segments = [seg('"The blue monkey jumped over the moon".', 36.96, 0.77, 'blue_monkey')];
    const found = detectUnspokenScriptSegments(segments, [align(false, 0)], faWords(36.96, 37.73, 6, 6.4257e-6));
    expect(found).toHaveLength(1);
    expect(found[0]!.segmentIndex).toBe(0);
    expect(found[0]!.segmentTag).toBe('blue_monkey');
    expect(found[0]!.faWordCount).toBe(6);
    expect(found[0]!.maxWordConfidence).toBeCloseTo(6.4257e-6, 10);
  });

  it("fires on item 10's configuration (173 perilous_realms, the never-spoken title)", () => {
    const segments = [seg('The Hardest Warhammer 40K Environments to Fight In', 0, 1.36, 'perilous_realms')];
    const found = detectUnspokenScriptSegments(segments, [align(false, 0)], faWords(0, 1.36, 7, 1.7248e-5));
    expect(found).toHaveLength(1);
    expect(found[0]!.segmentTag).toBe('perilous_realms');
  });

  it('does NOT fire on a healthy segment FA genuinely recovered (v6 029_night_understanding)', () => {
    // matched:false under Whisper, but FA has real acoustic support at 0.99997
    // — this is the case R.10 must never touch: the 6 genuine recoveries are
    // the whole reason the FA path exists.
    const segments = [seg('A new understanding of what the night actually is.', 88.0, 3.2)];
    const found = detectUnspokenScriptSegments(segments, [align(false, 0)], faWords(88.0, 91.2, 9, 9.9997e-1));
    expect(found).toEqual([]);
  });

  it('does NOT fire on the 001_scylla_intro subword near-miss — and is blocked TWICE over', () => {
    // Whisper tokenizes "Scylla" as S + illa, so `matched` is false; the word
    // IS spoken (twice). Conjunct (2) rejects it at 1.4653e-2, and conjunct (3)
    // rejects it at 1 word. Both are asserted, independently.
    const segments = [seg('Scylla.', 0, 1.6, '001_scylla_intro')];
    const words = faWords(0, 1.6, 1, 1.4653e-2);
    expect(detectUnspokenScriptSegments(segments, [align(false, 0)], words)).toEqual([]);

    // conjunct (2) alone would reject it: same word count, still too confident
    const twoWordsButConfident = faWords(0, 1.6, 2, 1.4653e-2);
    expect(detectUnspokenScriptSegments(segments, [align(false, 0)], twoWordsButConfident)).toEqual([]);

    // conjunct (3) alone would reject it: silent enough, but a single word
    const oneWordButSilent = faWords(0, 1.6, 1, 1e-8);
    expect(detectUnspokenScriptSegments(segments, [align(false, 0)], oneWordButSilent)).toEqual([]);
  });

  it('does NOT fire on an ordinary short spoken line BELOW the threshold (v6 013_silent_prehistoric_night)', () => {
    // 3.489e-4 is UNDER R10_MAX_WORD_CONF. Only conjunct (1) saves it, and it
    // is one of the 14 perfectly ordinary lines that share item 11's raw
    // "every word needsReview" signature. If conjunct (1) is ever dropped,
    // this test is what goes red.
    const segments = [seg('The night goes quiet.', 40.1, 1.5)];
    const words = faWords(40.1, 41.6, 5, 3.489e-4);
    expect(words.every(w => w.confidence! < R10_MAX_WORD_CONF)).toBe(true);
    expect(detectUnspokenScriptSegments(segments, [align(true, 1)], words)).toEqual([]);
  });

  it('is strict at the threshold: exactly R10_MAX_WORD_CONF does not fire, just under does', () => {
    const segments = [seg('x y z', 10, 1)];
    const at = detectUnspokenScriptSegments(segments, [align(false, 0)], faWords(10, 11, 3, R10_MAX_WORD_CONF));
    expect(at).toEqual([]);
    const under = detectUnspokenScriptSegments(segments, [align(false, 0)], faWords(10, 11, 3, R10_MAX_WORD_CONF * 0.999));
    expect(under).toHaveLength(1);
  });

  it('requires at least R10_MIN_WORD_COUNT FA words inside the span', () => {
    const segments = [seg('x y', 10, 1)];
    expect(detectUnspokenScriptSegments(segments, [align(false, 0)], faWords(10, 11, 1, 1e-8))).toEqual([]);
    expect(detectUnspokenScriptSegments(segments, [align(false, 0)], faWords(10, 11, 2, 1e-8))).toHaveLength(1);
  });

  it('never fires on a matched segment — R.5 mutual exclusion holds by construction', () => {
    // R.5 acts on unclaimed AUDIO runs, whose owning neighbours are matched
    // segments by definition; R.10 requires matched === false. A segment
    // cannot be both, at any confidence, so no arbitration rule is needed.
    const segments = [seg('anything at all', 5, 2)];
    for (const conf of [1e-12, 1e-8, 1e-6, 1e-4, 0.5, 1]) {
      expect(detectUnspokenScriptSegments(segments, [align(true, 1)], faWords(5, 7, 6, conf))).toEqual([]);
    }
  });

  it('declines rather than guesses when a segment has no FA words at all', () => {
    const segments = [seg('never aligned', 5, 2)];
    expect(detectUnspokenScriptSegments(segments, [align(false, 0)], [])).toEqual([]);
  });

  it('treats a token with no confidence field as unusable evidence, never as zero', () => {
    // A Whisper token has no `confidence`. Reading `undefined` as 0 would make
    // R.10 fire on the whole corpus the moment it were handed the wrong array.
    const segments = [seg('a b c', 5, 2)];
    const bare: TranscriptToken[] = [
      { text: 'a', startSec: 5.0, endSec: 5.5 },
      { text: 'b', startSec: 5.5, endSec: 6.0 },
      { text: 'c', startSec: 6.0, endSec: 6.5 },
    ];
    expect(detectUnspokenScriptSegments(segments, [align(false, 0)], bare)).toEqual([]);
  });

  it('scans every segment and reports findings in segment order', () => {
    const segments = [
      seg('title never spoken', 0, 1.36, 'perilous_realms'),
      seg('a real line', 1.36, 3),
      seg('planted string', 36.96, 0.77, 'blue_monkey'),
    ];
    const alignments = [align(false, 0), align(true, 1), align(false, 0)];
    const words = [
      ...faWords(0, 1.36, 7, 1.7248e-5),
      ...faWords(1.36, 4.36, 3, 0.99),
      ...faWords(36.96, 37.73, 6, 6.4257e-6),
    ];
    const found = detectUnspokenScriptSegments(segments, alignments, words);
    expect(found.map(f => f.segmentIndex)).toEqual([0, 2]);
    expect(found.map(f => f.segmentTag)).toEqual(['perilous_realms', 'blue_monkey']);
  });
});

// --- application -----------------------------------------------------------

describe('R.10 — applyUnspokenScriptGate', () => {
  const alignments = [align(true, 1), align(false, 0), align(true, 1), align(true, 1)];

  it('is a no-op when nothing was detected, returning the same array identity', () => {
    expect(applyUnspokenScriptGate(alignments, [])).toBe(alignments);
  });

  it('flips ONLY the flagged indices to matched:false and copies the rest through', () => {
    const out = applyUnspokenScriptGate(alignments, [
      { segmentIndex: 2, segmentId: 'x', maxWordConfidence: 1e-6, faWordCount: 5 },
    ]);
    expect(out).toHaveLength(alignments.length);
    expect(out.map(a => a.matched)).toEqual([true, false, false, true]);
    // untouched entries are carried through unchanged
    expect(out[0]).toEqual(alignments[0]);
    expect(out[3]).toEqual(alignments[3]);
    // and the input is never mutated (history's snapshot invariant, CLAUDE.md)
    expect(alignments.map(a => a.matched)).toEqual([true, false, true, true]);
  });

  it('zeroes the flagged entry\'s token indices so no downstream snap reads them', () => {
    const out = applyUnspokenScriptGate(alignments, [
      { segmentIndex: 2, segmentId: 'x', maxWordConfidence: 1e-6, faWordCount: 5 },
    ]);
    expect(out[2]!.firstTokenIdx).toBe(-1);
    expect(out[2]!.lastTokenIdx).toBe(-1);
    expect(out[2]!.audioRegion).toBeUndefined();
  });

  it('ignores an out-of-range index rather than growing the array', () => {
    const out = applyUnspokenScriptGate(alignments, [
      { segmentIndex: 99, segmentId: 'x', maxWordConfidence: 1e-6, faWordCount: 5 },
    ]);
    expect(out).toHaveLength(alignments.length);
    expect(out.map(a => a.matched)).toEqual([true, false, true, true]);
  });

  it('names its own skip reason, distinct from the plain no-audio-match one', () => {
    expect(R10_SKIP_REASON).toBe('scripted text never spoken');
  });
});

// --- the invariant the drop must not break ---------------------------------

describe('R.10 — Model P survives the drop (contiguity, no gaps, sigma)', () => {
  // The gate's whole application is "force matched:false and let the EXISTING
  // skip path run". This block proves that is enough: the same
  // filterToCoveredSegments -> snapCoveredBoundaries -> headExtendFirstSegment
  // sequence App.tsx runs, with an R.10 drop in the middle AND at index 0.
  const AUDIO = 20;
  const tokens: TranscriptToken[] = [
    { text: 'title', startSec: 0.10, endSec: 0.60, confidence: 1.2e-5 },
    { text: 'words', startSec: 0.65, endSec: 1.10, confidence: 3.0e-6 },
    { text: 'alpha', startSec: 3.00, endSec: 3.80, confidence: 0.99 },
    { text: 'beta', startSec: 3.90, endSec: 4.60, confidence: 0.99 },
    { text: 'planted', startSec: 8.00, endSec: 8.40, confidence: 6.4e-6 },
    { text: 'string', startSec: 8.45, endSec: 8.90, confidence: 1.1e-7 },
    { text: 'gamma', startSec: 12.00, endSec: 12.80, confidence: 0.99 },
    { text: 'delta', startSec: 12.90, endSec: 13.70, confidence: 0.99 },
  ];
  const silences: SilenceInterval[] = [
    { startSec: 1.10, endSec: 3.00 },
    { startSec: 4.60, endSec: 8.00 },
    { startSec: 8.90, endSec: 12.00 },
    { startSec: 13.70, endSec: AUDIO },
  ];
  const build = (): VideoSegment[] => [
    seg('title words', 0, 3, 'never_spoken_title'),
    seg('alpha beta', 3, 5, 'real_one'),
    seg('planted string', 8, 4, 'planted'),
    seg('gamma delta', 12, 8, 'real_two'),
  ];

  const runPipeline = (dropIdx: number[]): VideoSegment[] => {
    const segments = build();
    const alignments: SegmentAlignment[] = [align(false, 0), align(true, 1), align(false, 0), align(true, 1)];
    // real token spans, so snapCoveredBoundaries has something to snap against
    const spans = [[0, 1], [2, 3], [4, 5], [6, 7]];
    alignments.forEach((a, i) => {
      a.firstTokenIdx = spans[i]![0]!; a.lastTokenIdx = spans[i]![1]!;
      a.audioRegion = { startSec: tokens[spans[i]![0]!]!.startSec, endSec: tokens[spans[i]![1]!]!.endSec };
    });
    const gated = applyUnspokenScriptGate(
      alignments,
      dropIdx.map(i => ({ segmentIndex: i, segmentId: segments[i]!.id, maxWordConfidence: 1e-6, faWordCount: 2 })),
    );
    const { kept, keptAlignments, skipped } = filterToCoveredSegments(segments, gated);
    expect(skipped.length).toBe(dropIdx.length + alignments.filter((a, i) => !a.matched && !dropIdx.includes(i)).length);
    let out = snapCoveredBoundaries(kept, keptAlignments, tokens, silences, AUDIO);
    out = headExtendFirstSegment(out);
    return out;
  };

  const assertModelP = (out: VideoSegment[]): void => {
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.startTime).toBeCloseTo(0, 6);
    for (let i = 0; i + 1 < out.length; i++) {
      expect(
        Math.abs(out[i]!.startTime + out[i]!.duration - out[i + 1]!.startTime),
        `gap or overlap between ${out[i]!.tag} and ${out[i + 1]!.tag}`,
      ).toBeLessThan(1e-6);
    }
    const last = out[out.length - 1]!;
    expect(Math.abs(last.startTime + last.duration - AUDIO)).toBeLessThan(1e-6);
    expect(findPartitionViolations(out, AUDIO)).toEqual([]);
    expect(out.reduce((s, x) => s + x.duration, 0)).toBeCloseTo(AUDIO, 6);
  };

  it('a MIDDLE drop leaves the partition gapless and the neighbour absorbs the span', () => {
    const out = runPipeline([2]);
    expect(out.map(s => s.tag)).not.toContain('planted');
    assertModelP(out);
  });

  it('a drop at INDEX 0 head-extends the new first segment back to 0 (item 10s shape)', () => {
    const out = runPipeline([0]);
    expect(out.map(s => s.tag)).not.toContain('never_spoken_title');
    expect(out[0]!.tag).toBe('real_one');
    expect(out[0]!.startTime).toBe(0);
    assertModelP(out);
  });

  it('BOTH drops together — the 173 configuration — still satisfies Model P', () => {
    const out = runPipeline([0, 2]);
    expect(out.map(s => s.tag)).toEqual(['real_one', 'real_two']);
    assertModelP(out);
  });

  it('the dropped scene is recorded with R.10s OWN skip reason, not a plain no-match', () => {
    const segments = build();
    const alignments: SegmentAlignment[] = [align(true, 1), align(true, 1), align(false, 0), align(true, 1)];
    const gated = applyUnspokenScriptGate(alignments, [
      { segmentIndex: 2, segmentId: segments[2]!.id, maxWordConfidence: 6.4e-6, faWordCount: 2 },
    ]);
    const { skipped } = filterToCoveredSegments(segments, gated, new Set([2]));
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.segmentIndex).toBe(2);
    expect(skipped[0]!.segmentTag).toBe('planted');
    expect(skipped[0]!.reason).toBe(R10_SKIP_REASON);
  });

  it('an ordinary no-audio-match skip keeps its own reason when R.10 also fired elsewhere', () => {
    const segments = build();
    const alignments: SegmentAlignment[] = [align(false, 0), align(true, 1), align(false, 0), align(true, 1)];
    const { skipped } = filterToCoveredSegments(segments, alignments, new Set([2]));
    expect(skipped.map(s => s.reason)).toEqual(['no audio match', R10_SKIP_REASON]);
  });
});
