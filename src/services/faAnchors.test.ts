/**
 * faAnchors.ts — R.1 anchor + R.0 run computation, R-O/R-P ruling coverage.
 *
 * Every fixture is hand-written (Hirschberg output, tokens, silences are all
 * constructed directly) — this module has no live caller yet (Slice D1 is
 * pure and unwired), so there is no real project to drive it from.
 *
 * SCOPE NOTE — R.7's `CONF_MIN` is deliberately NOT covered here. `CONF_MIN`
 * gates a run's boundary word on forced alignment's OWN per-word confidence,
 * which is FA OUTPUT — data this module has no access to, since it runs
 * strictly before any FA pass (`faAnchors.ts`'s own header comment, and R.1's
 * "computed before any FA pass" text). Wiring a fake confidence input just to
 * exercise `CONF_MIN` here would test behavior this module doesn't have.
 * `CONF_MIN` is defined in `syncConstants.ts` for its real (post-FA) consumer.
 */

import { describe, it, expect } from 'vitest';
import { computeFaAnchors } from './faAnchors';
import type { TokenAlignment, TokenAlignmentOp } from './whisperService';
import type { TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';
import { MAX_RUN_SEC, RUN_SURVIVAL_MIN_RUN_LONG } from './syncConstants';

function tok(text: string, startSec: number, endSec: number): TranscriptToken {
  return { text, startSec, endSec };
}

function sil(startSec: number, endSec: number): SilenceInterval {
  return { startSec, endSec };
}

/** All-match alignment: query word `i` matches subject (token) index `i`. */
function allMatchAlignment(n: number): TokenAlignment {
  const ops: TokenAlignmentOp[] = [];
  const matchedSubjectOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    ops.push({ type: 'match', qi: i, sj: i });
    matchedSubjectOf[i] = i;
  }
  return { ops, matchedSubjectOf, score: n };
}

/** Asserts I1/I2 (Model P, per R-E) directly: every run's `windowEnd` equals
 *  the next run's `windowStart`, with no numeric gap anywhere in the
 *  partition — a test that would still pass with a real gap does not count. */
function assertNoGaps(runs: ReturnType<typeof computeFaAnchors>['runs']): void {
  for (let i = 0; i < runs.length - 1; i++) {
    expect(runs[i]!.windowEnd, `gap between run ${i} and ${i + 1}`).toBe(runs[i + 1]!.windowStart);
  }
}

describe('computeFaAnchors', () => {
  it('zero anchors found: no candidate is admissible -> one run, corpus start to end', () => {
    // 5 matched words, all too short to pass R-O's MIN_ANCHOR_WORD_CHARS.
    const words = ['is', 'at', 'on', 'it', 'do'];
    const alignment = allMatchAlignment(words.length);
    const tokens = words.map((w, i) => tok(w, i + 1, i + 1.4));
    const silences = [sil(0.9, 1.0), sil(1.9, 2.0), sil(2.9, 3.0), sil(3.9, 4.0), sil(4.9, 5.0)];
    const audioDuration = 8;

    const { anchors, runs } = computeFaAnchors(alignment, tokens, silences, audioDuration);

    expect(anchors).toEqual([]);
    expect(runs).toEqual([
      { windowStart: 0, windowEnd: 8, startProvenance: 'corpus-start', endProvenance: 'corpus-end' },
    ]);
  });

  it('every admissible token becomes an anchor (no selection among candidates)', () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'hotel'];
    const alignment = allMatchAlignment(words.length);
    const starts = [1, 3, 5, 7, 9];
    const tokens = words.map((w, i) => tok(w, starts[i]!, starts[i]! + 0.5));
    const silences = starts.map(s => sil(s - 0.1, s));
    const audioDuration = 12;

    const { anchors, runs } = computeFaAnchors(alignment, tokens, silences, audioDuration);

    expect(anchors.map(a => a.qi)).toEqual([0, 1, 2, 3, 4]);
    expect(anchors.map(a => a.timeSec)).toEqual(starts);
    expect(runs.map(r => [r.windowStart, r.windowEnd])).toEqual([
      [0, 1], [1, 3], [3, 5], [5, 7], [7, 9], [9, 12],
    ]);
    assertNoGaps(runs);
  });

  it(`MIN_ANCHOR_RUN (${RUN_SURVIVAL_MIN_RUN_LONG}) boundary: a run of exactly 3 is rejected, exactly 4 is admitted`, () => {
    // qi 0-2: contiguous match run of 3 ("alpha","bravo","charlie") - too short.
    // qi 3: a 'sub' spacer breaks contiguity (a real text mismatch, not a candidate).
    // qi 4-7: contiguous match run of 4 ("delta","hotel","india","kilo") - admissible length.
    const ops: TokenAlignmentOp[] = [
      { type: 'match', qi: 0, sj: 0 },
      { type: 'match', qi: 1, sj: 1 },
      { type: 'match', qi: 2, sj: 2 },
      { type: 'sub', qi: 3, sj: 3 },
      { type: 'match', qi: 4, sj: 4 },
      { type: 'match', qi: 5, sj: 5 },
      { type: 'match', qi: 6, sj: 6 },
      { type: 'match', qi: 7, sj: 7 },
    ];
    const matchedSubjectOf = new Int32Array([0, 1, 2, -1, 4, 5, 6, 7]);
    const alignment: TokenAlignment = { ops, matchedSubjectOf, score: 7 };

    const words = ['alpha', 'bravo', 'charlie', 'MISMATCH', 'delta', 'hotel', 'india', 'kilo'];
    const starts = [1, 3, 5, 7, 9, 11, 13, 15];
    const tokens = words.map((w, i) => tok(w, starts[i]!, starts[i]! + 0.5));
    const silences = starts.map(s => sil(s - 0.1, s));
    const audioDuration = 18;

    const { anchors } = computeFaAnchors(alignment, tokens, silences, audioDuration);

    expect(anchors.some(a => a.qi === 1)).toBe(false); // run of 3 - rejected
    expect(anchors.some(a => a.qi === 5)).toBe(true);  // run of 4 - admitted
  });

  it('MAX_RUN_SEC forces a split when no admissible anchor exists anywhere in a long span', () => {
    const alignment: TokenAlignment = { ops: [], matchedSubjectOf: new Int32Array(0), score: 0 };
    const tokens: TranscriptToken[] = [];
    const silences: SilenceInterval[] = [];
    const audioDuration = MAX_RUN_SEC * 2 + 5; // 65 - needs two forced splits

    const { anchors, runs } = computeFaAnchors(alignment, tokens, silences, audioDuration);

    expect(anchors).toEqual([]);
    expect(runs).toEqual([
      { windowStart: 0, windowEnd: MAX_RUN_SEC, startProvenance: 'corpus-start', endProvenance: 'forced-split-max-run' },
      { windowStart: MAX_RUN_SEC, windowEnd: MAX_RUN_SEC * 2, startProvenance: 'forced-split-max-run', endProvenance: 'forced-split-max-run' },
      { windowStart: MAX_RUN_SEC * 2, windowEnd: audioDuration, startProvenance: 'forced-split-max-run', endProvenance: 'corpus-end' },
    ]);
    assertNoGaps(runs);
  });

  it('R-O rejects a candidate shorter than MIN_ANCHOR_WORD_CHARS, in an otherwise-valid run', () => {
    // "on" (2 chars) sits in a run of 5, with its own agreeing silence -
    // isolates the length check as the sole cause of rejection.
    const words = ['on', 'alpha', 'bravo', 'charlie', 'delta'];
    const alignment = allMatchAlignment(words.length);
    const starts = [1, 3, 5, 7, 9];
    const tokens = words.map((w, i) => tok(w, starts[i]!, starts[i]! + 0.5));
    const silences = starts.map(s => sil(s - 0.1, s));
    const audioDuration = 12;

    const { anchors } = computeFaAnchors(alignment, tokens, silences, audioDuration);

    expect(anchors.some(a => a.qi === 0)).toBe(false); // "on" - too short
    expect(anchors.some(a => a.qi === 1)).toBe(true);  // "alpha" - control, admitted
  });

  it('R-O rejects a glide-initial candidate, in an otherwise-valid run', () => {
    // "your" (4 chars, passes length) starts with 'y' - GLIDE_INITIAL_CHARS.
    const words = ['your', 'alpha', 'bravo', 'charlie', 'delta'];
    const alignment = allMatchAlignment(words.length);
    const starts = [1, 3, 5, 7, 9];
    const tokens = words.map((w, i) => tok(w, starts[i]!, starts[i]! + 0.5));
    const silences = starts.map(s => sil(s - 0.1, s));
    const audioDuration = 12;

    const { anchors } = computeFaAnchors(alignment, tokens, silences, audioDuration);

    expect(anchors.some(a => a.qi === 0)).toBe(false); // "your" - glide-initial
    expect(anchors.some(a => a.qi === 1)).toBe(true);  // "alpha" - control, admitted
  });

  it('R-P selects the LONGEST detected silence inside the force-split window, not the first or last', () => {
    const alignment: TokenAlignment = { ops: [], matchedSubjectOf: new Int32Array(0), score: 0 };
    const tokens: TranscriptToken[] = [];
    // Three silences inside [0, MAX_RUN_SEC]: durations 1, 2.5, 0.8 - the
    // middle one is longest and must be the one chosen, not the earliest.
    const silences = [sil(5, 6), sil(10, 12.5), sil(20, 20.8)];
    const audioDuration = 32;

    const { runs } = computeFaAnchors(alignment, tokens, silences, audioDuration);

    expect(runs).toEqual([
      { windowStart: 0, windowEnd: 12.5, startProvenance: 'corpus-start', endProvenance: 'forced-split-silence' },
      { windowStart: 12.5, windowEnd: 32, startProvenance: 'forced-split-silence', endProvenance: 'corpus-end' },
    ]);
    assertNoGaps(runs);
  });

  it('R-P falls back to exactly MAX_RUN_SEC when the force-split window has no detected silence', () => {
    const alignment: TokenAlignment = { ops: [], matchedSubjectOf: new Int32Array(0), score: 0 };
    const tokens: TranscriptToken[] = [];
    const silences: SilenceInterval[] = [];
    const audioDuration = 45;

    const { runs } = computeFaAnchors(alignment, tokens, silences, audioDuration);

    expect(runs).toEqual([
      { windowStart: 0, windowEnd: MAX_RUN_SEC, startProvenance: 'corpus-start', endProvenance: 'forced-split-max-run' },
      { windowStart: MAX_RUN_SEC, windowEnd: 45, startProvenance: 'forced-split-max-run', endProvenance: 'corpus-end' },
    ]);
  });

  it('clamps the first run to audio start (0) and the last run to audioDuration exactly', () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta'];
    const alignment = allMatchAlignment(words.length);
    const starts = [4, 5, 6, 7]; // single anchor lands wherever the agreeing silence is
    const tokens = words.map((w, i) => tok(w, starts[i]!, starts[i]! + 0.5));
    const silences = [sil(4.9, 5)]; // only qi=1 ("bravo") agrees
    const audioDuration = 10;

    const { anchors, runs } = computeFaAnchors(alignment, tokens, silences, audioDuration);

    expect(anchors.map(a => a.qi)).toEqual([1]);
    expect(runs[0]!.windowStart).toBe(0);
    expect(runs[0]!.startProvenance).toBe('corpus-start');
    expect(runs[runs.length - 1]!.windowEnd).toBe(audioDuration);
    expect(runs[runs.length - 1]!.endProvenance).toBe('corpus-end');
  });

  it('R-E: no-gap property holds directly across mixed agreed-anchor and forced-split boundaries', () => {
    // Three 6-word blocks; only one word per block has an agreeing silence
    // (t=5, t=10, t=15 respectively) - the rest exist only as filler so the
    // agreement check (not run-length) is what isolates each anchor. After
    // the third anchor (t=15) there are no more candidates at all, so the
    // remaining 35s to audioDuration (50) must force-split once (no silence
    // there -> forced-split-max-run at 15+30=45) before reaching corpus-end.
    const blockWords = ['alpha', 'bravo', 'charlie', 'delta', 'hotel', 'india'];
    const words = [...blockWords, ...blockWords, ...blockWords];
    const alignment = allMatchAlignment(words.length);

    const starts = [
      1, 3, 5, 6, 8, 9,       // block 1 (qi 0-5): anchor at qi=2, t=5
      31, 33, 10, 34, 36, 38, // block 2 (qi 6-11): anchor at qi=8, t=10
      61, 63, 15, 64, 66, 68, // block 3 (qi 12-17): anchor at qi=14, t=15
    ];
    const tokens = words.map((w, i) => tok(w, starts[i]!, starts[i]! + 0.5));
    const silences = [sil(4.9, 5), sil(9.9, 10), sil(14.9, 15)];
    const audioDuration = 50;

    const { anchors, runs } = computeFaAnchors(alignment, tokens, silences, audioDuration);

    expect(anchors.map(a => a.timeSec)).toEqual([5, 10, 15]);
    expect(runs.map(r => [r.windowStart, r.windowEnd, r.startProvenance, r.endProvenance])).toEqual([
      [0, 5, 'corpus-start', 'agreed-anchor'],
      [5, 10, 'agreed-anchor', 'agreed-anchor'],
      [10, 15, 'agreed-anchor', 'agreed-anchor'],
      [15, 45, 'agreed-anchor', 'forced-split-max-run'],
      [45, 50, 'forced-split-max-run', 'corpus-end'],
    ]);
    assertNoGaps(runs);
  });
});
