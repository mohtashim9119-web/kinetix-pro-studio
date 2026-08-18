/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// R.12 — THE ATOMIC-RUN INVARIANT (WS1 Session H).
//
// Two halves, deliberately kept in one file. The SYNTHETIC half covers the
// structural shapes the three corpora do not contain (the fallback with no
// silence in the pre-run gap, a corpus-start run, two runs one token apart, a
// run at corpus end, a non-positive predecessor duration). The CORPUS half
// exercises the real production detector against the committed fixtures,
// because the question R.12 answers — "did a committed boundary land inside
// audio that is not in any script?" — only has a meaningful answer on real
// Whisper output, the same reasoning `faChunkPlan.test.ts`'s own R.5 block
// states for its corpus cases.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  detectRunPlacementDefects,
  applyRunPlacementCorrections,
  detectUtterancePlacementDefects,
  applyUtterancePlacementCorrections,
} from './faRunPlacementGate';
import { computeUnscriptedRuns, computeFaChunkPlan } from './faChunkPlan';
import { R11_MAX_SPAN_WORD_CONF, R12_MIN_CORRECTION_SEC } from './syncConstants';
import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';

// ---------------------------------------------------------------------------
// Synthetic fixture builder.
//
// `computeUnscriptedRuns` runs the real Hirschberg aligner, so the script and
// the transcript below are written to align unambiguously: every scripted word
// is unique, and the unscripted stretch shares no word with any segment's text.
// ---------------------------------------------------------------------------

const seg = (id: string, text: string, startTime: number, duration: number): VideoSegment =>
  ({ id, text, startTime, duration, transition: 'none', animation: 'none' }) as unknown as VideoSegment;

const tok = (text: string, startSec: number, endSec: number): TranscriptToken => ({ text, startSec, endSec });

/** Script: three segments. Transcript: s0's words, an unscripted four-token
 *  recitation at [3.00, 4.60], then s1's and s2's words. A silence sits in the
 *  pre-run gap at [2.20, 2.80] — midpoint 2.50, the only legal correction. */
function baseFixture(): {
  parsed: VideoSegment[]; tokens: TranscriptToken[]; silences: SilenceInterval[]; audioDuration: number;
} {
  return {
    parsed: [
      seg('seg0', 'alpha bravo charlie delta', 0, 3.5),
      seg('seg1', 'echo foxtrot golf hotel', 3.5, 3.5),
      seg('seg2', 'india juliett kilo lima', 7.0, 3.0),
    ],
    tokens: [
      tok('alpha', 0.10, 0.50), tok('bravo', 0.60, 1.00),
      tok('charlie', 1.10, 1.50), tok('delta', 1.60, 2.00),
      // the unscripted run — no segment's script contains these words.
      tok('level', 3.00, 3.30), tok('nine', 3.40, 3.70),
      tok('recitation', 3.80, 4.20), tok('here', 4.30, 4.60),
      tok('echo', 5.00, 5.40), tok('foxtrot', 5.50, 5.90),
      tok('golf', 6.00, 6.40), tok('hotel', 6.50, 6.90),
      tok('india', 7.50, 7.90), tok('juliett', 8.00, 8.40),
      tok('kilo', 8.50, 8.90), tok('lima', 9.00, 9.40),
    ],
    silences: [{ startSec: 2.20, endSec: 2.80 }, { startSec: 4.70, endSec: 4.95 }],
    audioDuration: 10.0,
  };
}

/** The committed array: identical timing to `parsed`, which is the defect —
 *  `seg1` starts at 3.50, strictly inside the run [3.00, 4.60]. */
const committedFrom = (parsed: readonly VideoSegment[]): VideoSegment[] => parsed.map(s => ({ ...s }));

describe('R.12 — the atomic-run invariant: detection', () => {
  it('the synthetic fixture really does contain one unscripted run holding one committed boundary', () => {
    // Guards the fixture itself: if `detectUnscriptedRuns` stopped seeing this
    // run, every assertion below would pass vacuously.
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const runs = computeUnscriptedRuns(parsed, tokens, silences, audioDuration);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.startSec).toBeCloseTo(3.00, 5);
    expect(runs[0]!.endSec).toBeCloseTo(4.60, 5);
    expect(runs[0]!.tokenLo).toBe(4);
    expect(runs[0]!.tokenHi).toBe(7);
  });

  it('corrects a boundary inside a run to the midpoint of (leading silence ∩ pre-run gap)', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const findings = detectRunPlacementDefects(parsed, committedFrom(parsed), tokens, silences, audioDuration);

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.segmentId).toBe('seg1');
    expect(f.segmentIndex).toBe(1);
    expect(f.committedValue).toBeCloseTo(3.50, 5);
    expect(f.correctedValue).toBeCloseTo(2.50, 5);     // midpoint of [2.20, 2.80] ∩ [2.00, 3.00]
    expect(f.placement).toBe('silence-midpoint');
    expect(f.backingSilence).toEqual({ startSec: 2.20, endSec: 2.80 });
    expect(f.gapStartSec).toBeCloseTo(2.00, 5);         // prevToken "delta".endSec
    expect(f.gapEndSec).toBeCloseTo(3.00, 5);           // run.startSec
    expect(f.delta).toBeCloseTo(-1.00, 5);
  });

  it('CLAMPS to the gap: a silence that runs on past the run onset is intersected, never used whole', () => {
    // The clamp is forced by measurement, not taste — unclamped, the midpoint
    // of a silence that overruns the run onset lands back INSIDE the run,
    // which is the very defect R.12 exists to remove. Measured on four of the
    // nine corpus rows (R4/R5/R7/R8) and, on R5, reproducing the committed
    // defect value exactly.
    const { parsed, tokens, audioDuration } = baseFixture();
    const silences: SilenceInterval[] = [{ startSec: 2.40, endSec: 4.40 }];
    const findings = detectRunPlacementDefects(parsed, committedFrom(parsed), tokens, silences, audioDuration);

    expect(findings).toHaveLength(1);
    // Unclamped this would be (2.40 + 4.40) / 2 = 3.40 — inside [3.00, 4.60].
    expect(findings[0]!.correctedValue).toBeCloseTo(2.70, 5); // midpoint of [2.40, 3.00]
    expect(findings[0]!.correctedValue).toBeLessThanOrEqual(3.00);
  });

  it('FALLBACK: with no silence overlapping the pre-run gap, the boundary goes to run.startSec', () => {
    const { parsed, tokens, audioDuration } = baseFixture();
    // Both silences moved clear of the gap [2.00, 3.00].
    const silences: SilenceInterval[] = [{ startSec: 1.20, endSec: 1.55 }, { startSec: 4.70, endSec: 4.95 }];
    const findings = detectRunPlacementDefects(parsed, committedFrom(parsed), tokens, silences, audioDuration);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.placement).toBe('run-start-fallback');
    expect(findings[0]!.backingSilence).toBeUndefined();
    expect(findings[0]!.correctedValue).toBeCloseTo(3.00, 5);
  });

  it('a silence touching the gap at a single instant is NOT an overlap (zero-length intersection)', () => {
    const { parsed, tokens, audioDuration } = baseFixture();
    const silences: SilenceInterval[] = [{ startSec: 1.20, endSec: 2.00 }]; // ends exactly at gapStart
    const findings = detectRunPlacementDefects(parsed, committedFrom(parsed), tokens, silences, audioDuration);
    expect(findings[0]!.placement).toBe('run-start-fallback');
  });

  it('R0 — a run at CORPUS START never fires: there is no preceding token, so no legal interval exists', () => {
    // Structural, not a special case: the rule needs `[prevToken.endSec,
    // run.startSec]`, and a run whose first token is token 0 has no
    // `prevToken`. V6's tenth recitation is exactly this shape.
    const parsed = [
      seg('seg0', 'echo foxtrot golf hotel', 0, 4.0),
      seg('seg1', 'india juliett kilo lima', 4.0, 6.0),
    ];
    const tokens = [
      tok('level', 0.10, 0.40), tok('one', 0.50, 0.80),
      tok('recitation', 0.90, 1.20), tok('here', 1.30, 1.60),
      tok('echo', 2.00, 2.40), tok('foxtrot', 2.50, 2.90),
      tok('golf', 3.00, 3.40), tok('hotel', 3.50, 3.90),
      tok('india', 4.50, 4.90), tok('juliett', 5.00, 5.40),
      tok('kilo', 5.50, 5.90), tok('lima', 6.00, 6.40),
    ];
    const runs = computeUnscriptedRuns(parsed, tokens, [], 10);
    expect(runs, 'fixture guard: the corpus-start run must exist').toHaveLength(1);
    expect(runs[0]!.tokenLo).toBe(0);

    // seg0 starts at 0, which is not strictly inside [0.10, 1.60] — but even a
    // boundary planted strictly inside it must be declined.
    const committed = [{ ...parsed[0]!, startTime: 0.80, duration: 3.2 }, { ...parsed[1]! }];
    expect(detectRunPlacementDefects(parsed, committed, tokens, [], 10)).toEqual([]);
  });

  it('a run at CORPUS END is corrected like any other — the invariant is about the run, not the corpus', () => {
    const parsed = [
      seg('seg0', 'alpha bravo charlie delta', 0, 3.0),
      seg('seg1', 'echo foxtrot golf hotel', 3.0, 7.0),
    ];
    const tokens = [
      tok('alpha', 0.10, 0.50), tok('bravo', 0.60, 1.00),
      tok('charlie', 1.10, 1.50), tok('delta', 1.60, 2.00),
      tok('echo', 2.20, 2.60), tok('foxtrot', 2.70, 3.10),
      tok('golf', 3.20, 3.60), tok('hotel', 3.70, 4.10),
      // trailing unscripted run, last tokens in the corpus.
      tok('level', 5.00, 5.30), tok('ten', 5.40, 5.70),
      tok('recitation', 5.80, 6.10), tok('ends', 6.20, 6.50),
    ];
    const runs = computeUnscriptedRuns(parsed, tokens, [], 10);
    expect(runs, 'fixture guard').toHaveLength(1);
    expect(runs[0]!.tokenHi).toBe(tokens.length - 1);

    const committed = [{ ...parsed[0]! }, { ...parsed[1]!, startTime: 5.50, duration: 4.5 }];
    const findings = detectRunPlacementDefects(parsed, committed, tokens, [{ startSec: 4.30, endSec: 4.90 }], 10);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.correctedValue).toBeCloseTo(4.60, 5); // midpoint of [4.30, 4.90] ∩ [4.10, 5.00]
  });

  it('index 0 is never a candidate — headExtendFirstSegment forces the first committed start to 0', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const committed = [{ ...parsed[0]!, startTime: 3.20, duration: 3.8 }, ...parsed.slice(1).map(s => ({ ...s }))];
    const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);
    expect(findings.some(f => f.segmentIndex === 0)).toBe(false);
  });

  it('a healthy boundary adjacent to a run does NOT move (neither the one before it nor the one after)', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const committed = [
      seg('seg0', 'alpha bravo charlie delta', 0, 2.50),
      seg('seg1', 'echo foxtrot golf hotel', 2.50, 4.50),   // already correct — sits in the gap
      seg('seg2', 'india juliett kilo lima', 7.00, 3.00),   // healthy, after the run
    ];
    const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);
    expect(findings, 'a boundary already outside the run is not a defect').toEqual([]);

    const out = applyRunPlacementCorrections(committed, findings);
    expect(out.map(s => s.startTime)).toEqual([0, 2.50, 7.00]);
  });

  it('a correction smaller than R12_MIN_CORRECTION_SEC is declined as a true no-op', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    // Committed at 2.53 — outside the run already, and 0.03 from the midpoint.
    const committed = [
      { ...parsed[0]!, duration: 2.53 },
      { ...parsed[1]!, startTime: 2.53, duration: 4.47 },
      { ...parsed[2]! },
    ];
    expect(R12_MIN_CORRECTION_SEC).toBeGreaterThan(0.03);
    expect(detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration)).toEqual([]);
  });

  it('two runs one claimed token apart are corrected independently, each into its OWN pre-run gap', () => {
    // `detectUnscriptedRuns` emits MAXIMAL runs, so two runs can never touch —
    // at least one claimed token separates them. This is the tightest spacing
    // the detector can produce, and it must not let run B's correction reach
    // back into run A.
    const parsed = [
      seg('seg0', 'alpha bravo charlie', 0, 2.0),
      seg('seg1', 'delta', 2.0, 4.0),
      seg('seg2', 'echo foxtrot golf', 6.0, 4.0),
    ];
    const tokens = [
      tok('alpha', 0.10, 0.50), tok('bravo', 0.60, 1.00), tok('charlie', 1.10, 1.50),
      tok('one', 2.00, 2.30), tok('two', 2.40, 2.70), tok('three', 2.80, 3.10), // run A
      tok('delta', 4.00, 4.40),                                                  // the single claimed token
      tok('four', 5.00, 5.30), tok('five', 5.40, 5.70), tok('six', 5.80, 6.10),  // run B
      tok('echo', 7.00, 7.40), tok('foxtrot', 7.50, 7.90), tok('golf', 8.00, 8.40),
    ];
    const silences: SilenceInterval[] = [{ startSec: 1.60, endSec: 1.95 }, { startSec: 4.50, endSec: 4.95 }];
    const runs = computeUnscriptedRuns(parsed, tokens, silences, 10);
    expect(runs, 'fixture guard: two runs').toHaveLength(2);

    const committed = [
      seg('seg0', 'alpha bravo charlie', 0, 2.20),
      seg('seg1', 'delta', 2.20, 3.30),   // inside run A [2.00, 3.10]
      seg('seg2', 'echo foxtrot golf', 5.50, 4.50), // inside run B [5.00, 6.10]
    ];
    const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, 10);
    expect(findings.map(f => f.segmentId)).toEqual(['seg1', 'seg2']);
    expect(findings[0]!.correctedValue).toBeCloseTo(1.775, 5); // mid of [1.60, 1.95] ∩ [1.50, 2.00]
    expect(findings[1]!.correctedValue).toBeCloseTo(4.725, 5); // mid of [4.50, 4.95] ∩ [4.40, 5.00]
    // Neither correction lands inside EITHER run.
    for (const f of findings) {
      for (const u of runs) {
        expect(f.correctedValue > u.startSec + 1e-9 && f.correctedValue < u.endSec - 1e-9).toBe(false);
      }
    }
  });

  it('H7 (permanent) — no finding on any input may place a boundary inside a run', () => {
    // The standing form of stop-and-rule exit H7. The guard is defensive: on
    // the committed corpora it never fires (measured), but overlapping Whisper
    // token spans could in principle put an earlier run's `endSec` past the
    // pre-run gap's own start, and R.12 must decline rather than relocate a
    // defect.
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const findings = detectRunPlacementDefects(parsed, committedFrom(parsed), tokens, silences, audioDuration);
    const runs = computeUnscriptedRuns(parsed, tokens, silences, audioDuration);
    for (const f of findings) {
      for (const u of runs) {
        expect(
          f.correctedValue > u.startSec + 1e-9 && f.correctedValue < u.endSec - 1e-9,
          `${f.segmentId}: corrected ${f.correctedValue} landed inside run [${u.startSec}, ${u.endSec}]`,
        ).toBe(false);
      }
    }
  });

  it('never strips the predecessor of its own last word: corrected >= prevToken.endSec', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const findings = detectRunPlacementDefects(parsed, committedFrom(parsed), tokens, silences, audioDuration);
    for (const f of findings) expect(f.correctedValue).toBeGreaterThanOrEqual(f.gapStartSec - 1e-9);
  });

  it('is inert on empty inputs', () => {
    expect(detectRunPlacementDefects([], [], [], [], 0)).toEqual([]);
    expect(detectRunPlacementDefects([seg('a', 'x', 0, 1)], [seg('a', 'x', 0, 1)], [], [], 1)).toEqual([]);
  });
});

describe('R.12 — the atomic-run invariant: application (Model P)', () => {
  it('moves the SHARED boundary only — predecessor absorbs the delta, own end stays fixed', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const committed = committedFrom(parsed);
    const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);
    const out = applyRunPlacementCorrections(committed, findings);

    expect(out[0]!.duration).toBeCloseTo(2.50, 5);   // 3.50 - 1.00
    expect(out[1]!.startTime).toBeCloseTo(2.50, 5);
    expect(out[1]!.duration).toBeCloseTo(4.50, 5);   // 3.50 + 1.00
    expect(out[1]!.startTime + out[1]!.duration).toBeCloseTo(7.00, 5); // own END unmoved
    expect(out[2]!.startTime).toBeCloseTo(7.00, 5);
  });

  it('keeps the partition gapless and conserves Σ duration', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const committed = committedFrom(parsed);
    const before = committed.reduce((a, s) => a + s.duration, 0);
    const out = applyRunPlacementCorrections(
      committed,
      detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration),
    );
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1]!.startTime + out[i - 1]!.duration).toBeCloseTo(out[i]!.startTime, 6);
    }
    expect(out.reduce((a, s) => a + s.duration, 0)).toBeCloseTo(before, 6);
  });

  it('is immutable — the input array and its members are untouched', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const committed = committedFrom(parsed);
    const snapshot = JSON.stringify(committed);
    applyRunPlacementCorrections(committed, detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration));
    expect(JSON.stringify(committed)).toBe(snapshot);
  });

  it('declines a correction that would drive a duration non-positive', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    // seg0 starts at 2.90, so moving the boundary back to 2.50 would leave it
    // a negative duration. Decline rather than commit an impossible partition.
    const committed = [
      seg('seg0', 'alpha bravo charlie delta', 2.90, 0.60),
      seg('seg1', 'echo foxtrot golf hotel', 3.50, 3.50),
      seg('seg2', 'india juliett kilo lima', 7.00, 3.00),
    ];
    const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);
    expect(findings, 'detection still reports it').toHaveLength(1);
    const out = applyRunPlacementCorrections(committed, findings);
    expect(out.map(s => s.startTime)).toEqual([2.90, 3.50, 7.00]);
  });

  it('an empty finding list returns the input untouched', () => {
    const { parsed } = baseFixture();
    const committed = committedFrom(parsed);
    expect(applyRunPlacementCorrections(committed, [])).toBe(committed);
  });

  it('a finding whose segment id is absent downstream is silently skipped (R.10 dropped it)', () => {
    const { parsed, tokens, silences, audioDuration } = baseFixture();
    const committed = committedFrom(parsed);
    const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);
    const withoutSeg1 = [committed[0]!, committed[2]!];
    expect(applyRunPlacementCorrections(withoutSeg1, findings).map(s => s.startTime)).toEqual([0, 7.00]);
  });
});

// ===========================================================================
// CORPUS HALF — the real production detector against the committed fixtures.
// ===========================================================================

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'fixtures');
const CORPUS_TIMEOUT_MS = 180_000;

function csv(name: string): Record<string, string>[] {
  const text = readFileSync(resolve(FIX, name), 'utf-8');
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const h = rows.shift() ?? [];
  return rows.filter(r => r.length === h.length)
    .map(r => Object.fromEntries(h.map((x, i) => [x, r[i] ?? ''])) as Record<string, string>);
}

type Corpus = 'v6' | '173' | 'spanish';
const AUDIO: Record<Corpus, number> = { v6: 1421.29, '173': 709.01, spanish: 92.04 };
const PARSED_COUNT: Record<Corpus, number> = { v6: 447, '173': 175, spanish: 27 };

/** The COMPLETE pre-skip parse (for run derivation) and the COMMITTED array
 *  (the boundaries under test) — the same two arrays production hands R.12. */
/**
 * `scripts/fixtures/phase4-fa-second-baseline-v6-segments.csv` is the SAME
 * fixture WS1 Session H's own R.12 re-pin overwrote with the nine corrections
 * already applied (`docs/work-in-progress.md` §11) — reading it live would
 * test the detector against its own already-corrected output (a false
 * negative: the detector correctly declines to re-fire on an already-correct
 * boundary, per its own no-op guard). These are the REAL pre-correction
 * values (this session's own Step 6 measurement, preserved here as literals
 * for exactly this reason — the same `resetToPreR11` pattern
 * `faSeamFitGate.test.ts` uses for the identical problem), restored onto the
 * loaded segments so detection tests exercise the real defect, not its own
 * fix. Both `startTime` AND `duration` are restored together so the
 * reconstructed array is still a valid gapless partition, exactly mirroring
 * how the predecessor's duration absorbed each correction on the way in.
 */
function resetToPreR12(segments: VideoSegment[], overrides: Record<string, { startTime: number; duration: number }>): VideoSegment[] {
  return segments.map(s => {
    const o = overrides[(s as unknown as { tag?: string }).tag ?? s.id];
    return o ? { ...s, startTime: o.startTime, duration: o.duration } : s;
  });
}

/** The nine R.12 boundaries and the one R.13 boundary, AND their predecessors'
 *  pre-correction durations, as measured by the real production detectors
 *  before each fixture re-pin (WS1 Session H's Step 6, then Session K's).
 *
 *  THIS TABLE MUST LIST EVERY ROW EITHER RULE MOVES. Session K's re-pin proved
 *  why: adding R.13 moved `225_night_scouts` in the fixture, and until it was
 *  added here the reconstruction was no longer gapless and five tests went red
 *  for a reason that had nothing to do with the rules. */
const V6_PRE_R12: Record<string, { startTime: number; duration: number }> = {
  '041_elder_lesson': { startTime: 122.64, duration: 4.53 },
  '042_eleven_years': { startTime: 127.17, duration: 3.79 },
  '084_instinctive_grip': { startTime: 247.26, duration: 5.48 },
  '085_the_spear_bearer': { startTime: 252.74, duration: 4.00 },
  '124_working_hands': { startTime: 368.45, duration: 3.90 },
  '125_night_circle': { startTime: 372.35, duration: 6.55 },
  '175_stepping_into_void': { startTime: 518.37, duration: 6.02 },
  '176_twenty_six_scout': { startTime: 524.39, duration: 3.70 },
  '223_carrying_weight': { startTime: 662.55, duration: 1.78 },
  '224_thirty_three': { startTime: 664.33, duration: 3.14 },
  // WS1 Session K: R.13 moved this row's OWN start (667.47 -> 669.05), which
  // also re-cut `224_thirty_three`'s duration. It has to be restored here or
  // the reconstruction is not a gapless partition and both rules see a state
  // the pipeline never produced. Every row ANY rule in this file moves must
  // appear in this table — that is what the entry below is guarding.
  '225_night_scouts': { startTime: 667.47, duration: 3.71 },
  '265_unending_dark': { startTime: 785.58, duration: 4.75 },
  '266_forty_one_burden': { startTime: 790.33, duration: 3.86 },
  '306_flint_knapping': { startTime: 921.31, duration: 5.66 },
  '307_forty_nine_years': { startTime: 926.97, duration: 4.43 },
  '339_night_voyage': { startTime: 1041.56, duration: 6.01 },
  '340_fifty_eight': { startTime: 1047.57, duration: 4.08 },
  '382_honesty_transfer': { startTime: 1182.81, duration: 8.00 },
  '383_sixty_four': { startTime: 1190.81, duration: 2.96 },
};

function corpus(key: Corpus): {
  parsed: VideoSegment[]; committed: VideoSegment[];
  tokens: TranscriptToken[]; silences: SilenceInterval[]; audioDuration: number;
} {
  const tokens: TranscriptToken[] = csv(`phase4-baseline-${key}-words.csv`)
    .map(r => ({ text: r.text!, startSec: Number(r.startSec), endSec: Number(r.endSec) }));
  const silences: SilenceInterval[] = csv(`phase4-baseline-${key}-silences.csv`)
    .map(r => ({ startSec: Number(r.startSec), endSec: Number(r.endSec) }));
  const mk = (r: Record<string, string>, text: string, order: number): VideoSegment => ({
    id: r.segmentTag ?? r.tag!, text, startTime: Number(r.startTime), duration: Number(r.duration),
    transition: 'none', animation: 'none', order,
  }) as unknown as VideoSegment;
  const committedRows = csv(`phase4-fa-second-baseline-${key}-segments.csv`);
  const skippedRows = csv(`phase4-fa-second-baseline-${key}-skipped.csv`);
  const skippedByIndex = new Map(skippedRows.map(r => [Number(r.segmentIndex), r]));
  const parsed: VideoSegment[] = [];
  let nextCommitted = 0;
  for (let i = 0; i < committedRows.length + skippedRows.length; i++) {
    const sk = skippedByIndex.get(i);
    if (sk) { parsed.push(mk(sk, sk.segmentText!, i)); continue; }
    parsed.push(mk(committedRows[nextCommitted++]!, committedRows[nextCommitted - 1]!.text!, i));
  }
  if (parsed.length !== PARSED_COUNT[key]) throw new Error(`${key}: parse is ${parsed.length}, expected ${PARSED_COUNT[key]}`);
  let committed = committedRows.map((r, i) => mk(r, r.text!, i));
  // v6's fixture carries R.12's OWN corrections already (this session's
  // re-pin) — reset to the pre-correction values so the detector is
  // exercised against the real defect. 173/spanish are untouched by R.12
  // (zero unscripted runs), so there is nothing to reset on them.
  if (key === 'v6') {
    committed = resetToPreR12(committed, V6_PRE_R12);
    // `parsed` also needs the pre-correction v6 committed timings for the
    // R.5 mutual-exclusion test's chunk-plan comparison below, but run
    // derivation reads only TEXT/ORDER from `parsed` (never timing), so no
    // reset is needed there — see `faRunPlacementGate.ts`'s own doc comment.
  }
  return { parsed, committed, tokens, silences, audioDuration: AUDIO[key] };
}

/** The nine corpus rows, with their Step-3 measured corrected values. */
const NINE: Array<{ tag: string; committed: number; corrected: number; placement: 'silence-midpoint' | 'run-start-fallback' }> = [
  { tag: '042_eleven_years', committed: 127.17, corrected: 125.54, placement: 'run-start-fallback' },
  { tag: '085_the_spear_bearer', committed: 252.74, corrected: 250.69, placement: 'silence-midpoint' },
  { tag: '125_night_circle', committed: 372.35, corrected: 370.75, placement: 'silence-midpoint' },
  { tag: '176_twenty_six_scout', committed: 524.39, corrected: 521.71, placement: 'silence-midpoint' },
  // The one row whose midpoint is not a 2dp value: (663.66 + 663.91) / 2.
  { tag: '224_thirty_three', committed: 664.33, corrected: 663.785, placement: 'silence-midpoint' },
  { tag: '266_forty_one_burden', committed: 790.33, corrected: 788.65, placement: 'silence-midpoint' },
  { tag: '307_forty_nine_years', committed: 926.97, corrected: 924.92, placement: 'silence-midpoint' },
  { tag: '340_fifty_eight', committed: 1047.57, corrected: 1044.67, placement: 'silence-midpoint' },
  { tag: '383_sixty_four', committed: 1190.81, corrected: 1188.95, placement: 'silence-midpoint' },
];

describe('R.12 — the corpus: all nine rows, blast radius, and the controls', () => {
  it('v6: fires on exactly the nine rows, at exactly their measured values', () => {
    const { parsed, committed, tokens, silences, audioDuration } = corpus('v6');
    const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);

    expect(findings.map(f => f.segmentId)).toEqual(NINE.map(n => n.tag));
    for (const n of NINE) {
      const f = findings.find(x => x.segmentId === n.tag)!;
      expect(Math.abs(f.committedValue - n.committed), `${n.tag}: committed`).toBeLessThan(0.005);
      expect(Math.abs(f.correctedValue - n.corrected), `${n.tag}: corrected`).toBeLessThan(0.005);
      expect(f.placement, `${n.tag}: placement path`).toBe(n.placement);
      expect(f.delta, `${n.tag}: every correction moves the boundary EARLIER`).toBeLessThan(0);
    }
  }, CORPUS_TIMEOUT_MS);

  it('exactly ONE of the nine takes the fallback path (042_eleven_years) — H8 as a standing check', () => {
    const { parsed, committed, tokens, silences, audioDuration } = corpus('v6');
    const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);
    const fallbacks = findings.filter(f => f.placement === 'run-start-fallback');
    expect(fallbacks.map(f => f.segmentId)).toEqual(['042_eleven_years']);
  }, CORPUS_TIMEOUT_MS);

  it('173 and spanish are UNTOUCHED — zero unscripted runs means zero effect', () => {
    for (const key of ['173', 'spanish'] as const) {
      const { parsed, committed, tokens, silences, audioDuration } = corpus(key);
      expect(computeUnscriptedRuns(parsed, tokens, silences, audioDuration), `${key}: runs`).toEqual([]);
      expect(detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration), `${key}: findings`).toEqual([]);
    }
  }, CORPUS_TIMEOUT_MS);

  it('blast radius is exactly 9 of 649 parsed rows across all three corpora', () => {
    let fired = 0; let rows = 0;
    for (const key of ['v6', '173', 'spanish'] as const) {
      const { parsed, committed, tokens, silences, audioDuration } = corpus(key);
      rows += parsed.length;
      fired += detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration).length;
    }
    expect(rows).toBe(649);
    expect(fired).toBe(9);
  }, CORPUS_TIMEOUT_MS);

  it('H7 on the real corpus: no corrected value lies inside ANY unscripted run', () => {
    const { parsed, committed, tokens, silences, audioDuration } = corpus('v6');
    const runs = computeUnscriptedRuns(parsed, tokens, silences, audioDuration);
    for (const f of detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration)) {
      for (const u of runs) {
        expect(
          f.correctedValue > u.startSec + 1e-9 && f.correctedValue < u.endSec - 1e-9,
          `${f.segmentId}: corrected ${f.correctedValue} inside run [${u.startSec}, ${u.endSec}]`,
        ).toBe(false);
      }
    }
  }, CORPUS_TIMEOUT_MS);

  it('the corrected v6 partition is still Model P: gapless, monotonic, Σ duration conserved', () => {
    const { parsed, committed, tokens, silences, audioDuration } = corpus('v6');
    const before = committed.reduce((a, s) => a + s.duration, 0);
    const out = applyRunPlacementCorrections(
      committed,
      detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration),
    );
    expect(out).toHaveLength(447);
    for (let i = 1; i < out.length; i++) {
      expect(
        Math.abs(out[i - 1]!.startTime + out[i - 1]!.duration - out[i]!.startTime),
        `gap or overlap at boundary ${i} (${out[i]!.id})`,
      ).toBeLessThan(1e-6);
      expect(out[i]!.duration, `${out[i]!.id}: non-positive duration`).toBeGreaterThan(0);
    }
    expect(out.reduce((a, s) => a + s.duration, 0)).toBeCloseTo(before, 6);
    expect(out[out.length - 1]!.startTime + out[out.length - 1]!.duration).toBeCloseTo(audioDuration, 2);
  }, CORPUS_TIMEOUT_MS);

  it('the ear-verified-correct controls do not move (H4 as a standing check)', () => {
    // The seven rows the owner's ear scored CORRECT across the three corpora.
    // If R.12 ever moves one of these, the rule is wrong, not the ear.
    const EAR_CORRECT: Array<{ key: Corpus; value: number }> = [
      { key: '173', value: 507.01 }, { key: 'v6', value: 571.07 }, { key: 'v6', value: 466.09 },
      { key: '173', value: 256.33 }, { key: 'spanish', value: 44.90 }, { key: 'v6', value: 969.30 },
      { key: 'v6', value: 259.88 },
    ];
    const cache = new Map<Corpus, ReturnType<typeof detectRunPlacementDefects>>();
    for (const c of EAR_CORRECT) {
      if (!cache.has(c.key)) {
        const { parsed, committed, tokens, silences, audioDuration } = corpus(c.key);
        cache.set(c.key, detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration));
      }
      for (const f of cache.get(c.key)!) {
        expect(
          Math.abs(f.committedValue - c.value) < 0.005,
          `R.12 fired on the ear-verified-correct ${c.key} boundary ${c.value} — stop-and-rule exit H4.`,
        ).toBe(false);
      }
    }
  }, CORPUS_TIMEOUT_MS);

  it('the other named controls do not move: item 6 (174.74), item 7 (451.03), V6 seam (457.81), R.5 outcomes', () => {
    const NAMED: Array<{ key: Corpus; value: number; why: string }> = [
      { key: '173', value: 174.74, why: 'ear-pass item 6 (R-U)' },
      { key: 'v6', value: 451.03, why: 'ear-pass item 7 (R.11)' },
      { key: 'v6', value: 457.81, why: 'V6 seam 150/151 FA value' },
      { key: 'v6', value: 931.40, why: 'item 4 (R.5)' },
      { key: 'v6', value: 130.96, why: 'item 5 (R.5)' },
      { key: 'v6', value: 671.18, why: 'ov3-226-four-scouts (R.11)' },
      { key: '173', value: 17.88, why: 'ov3-abysmal-opinion (R.11)' },
      { key: '173', value: 0.00, why: 'item 10 (R.10)' },
    ];
    const cache = new Map<Corpus, ReturnType<typeof detectRunPlacementDefects>>();
    for (const c of NAMED) {
      if (!cache.has(c.key)) {
        const { parsed, committed, tokens, silences, audioDuration } = corpus(c.key);
        cache.set(c.key, detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration));
      }
      for (const f of cache.get(c.key)!) {
        expect(
          Math.abs(f.committedValue - c.value) < 0.005,
          `R.12 fired on ${c.why} at ${c.value} — that boundary belongs to another rule.`,
        ).toBe(false);
      }
    }
  }, CORPUS_TIMEOUT_MS);
});

describe('R.12 — mutual exclusion against R.5, R.10, R.11 and R-U', () => {
  it('R.5: applying R.12 leaves the chunk plan BYTE-IDENTICAL on all three corpora', () => {
    // R.5 acts on chunk TEXT and WINDOWS, before inference; R.12 moves a
    // committed boundary, after it. The proof they cannot collide is that
    // feeding R.12's own output back through `computeFaChunkPlan` reproduces
    // the plan exactly — measured, not asserted.
    for (const key of ['v6', '173', 'spanish'] as const) {
      const { parsed, committed, tokens, silences, audioDuration } = corpus(key);
      const ser = (cs: readonly { startSec: number; endSec: number; text: string }[]): string =>
        cs.map(c => `${c.startSec.toFixed(3)},${c.endSec.toFixed(3)},${c.text}`).join('|');
      const before = ser(computeFaChunkPlan(parsed, tokens, silences, audioDuration));

      const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);
      const correctedById = new Map(findings.map(f => [f.segmentId, f.correctedValue]));
      const movedParse = parsed.map(s => ({ ...s }));
      for (let i = 0; i < movedParse.length; i++) {
        const want = correctedById.get(movedParse[i]!.id);
        if (want === undefined) continue;
        const delta = want - movedParse[i]!.startTime;
        movedParse[i] = { ...movedParse[i]!, startTime: want, duration: movedParse[i]!.duration - delta };
        if (i > 0) movedParse[i - 1] = { ...movedParse[i - 1]!, duration: movedParse[i - 1]!.duration + delta };
      }
      expect(ser(computeFaChunkPlan(movedParse, tokens, silences, audioDuration)), `${key}: chunk plan`).toBe(before);
    }
  }, CORPUS_TIMEOUT_MS);

  it('R.10: its firing set is 173-only, and 173 has no runs — the intersection is empty by construction', () => {
    const R10_FIRING_SET = ['perilous_realms', 'blue_monkey'];
    const { parsed, committed, tokens, silences, audioDuration } = corpus('173');
    const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);
    expect(findings).toEqual([]);
    for (const tag of R10_FIRING_SET) expect(findings.some(f => f.segmentId === tag)).toBe(false);
  }, CORPUS_TIMEOUT_MS);

  it('R.11: the two firing sets are disjoint, and conjunct 3 is what keeps R.11 off 372.35', () => {
    // H6 is closed BY CONSTRUCTION, not by luck. R.11's fit-deviation conjunct
    // alone flags v6 `125_night_circle`; its THIRD conjunct declines it because
    // the span to R.11's proposed 373.70 holds an FA word at real confidence
    // (0.0301, ~2.8x above R11_MAX_SPAN_WORD_CONF). 372.35 is R.12's row, and
    // R.11 must keep declining it for the two rules to stay exclusive.
    const R11_FIRING_SET = ['152_frozen_brush_mice', '226_four_scouts', '192_scout_listening', 'abysmal_opinion'];
    const fired: string[] = [];
    for (const key of ['v6', '173', 'spanish'] as const) {
      const { parsed, committed, tokens, silences, audioDuration } = corpus(key);
      fired.push(...detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration).map(f => f.segmentId));
    }
    for (const tag of R11_FIRING_SET) {
      expect(fired, `R.12 and R.11 both claim ${tag} — stop-and-rule exit H6`).not.toContain(tag);
    }
    expect(fired, 'R.12 must own 125_night_circle').toContain('125_night_circle');
    // The conjunct-3 margin that keeps R.11 off it. Red here means R.11 would
    // start competing for 372.35 and the exclusion argument collapses.
    expect(0.0301, 'R.11 conjunct 3 must keep declining 125_night_circle').toBeGreaterThan(R11_MAX_SPAN_WORD_CONF);
  }, CORPUS_TIMEOUT_MS);

  it('R-U / R-AA: item 6 lives in 173, which has no runs — no overlap possible', () => {
    const { parsed, committed, tokens, silences, audioDuration } = corpus('173');
    expect(detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration)).toEqual([]);
  }, CORPUS_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// R.13 — THE ATOMIC-UTTERANCE INVARIANT (WS1 Session K), the closing half.
//
// R.13 runs AFTER R.12 in production, so every corpus case below applies R.12's
// own corrections first and tests R.13 against the array R.12 actually hands
// it. Doing otherwise would test a state the app never reaches.
// ---------------------------------------------------------------------------

/** The post-R.12 committed array — exactly what `App.tsx` hands R.13. */
function postR12(key: Corpus): {
  parsed: VideoSegment[]; committed: VideoSegment[];
  tokens: TranscriptToken[]; silences: SilenceInterval[]; audioDuration: number;
} {
  const c = corpus(key);
  const committed = applyRunPlacementCorrections(
    c.committed,
    detectRunPlacementDefects(c.parsed, c.committed, c.tokens, c.silences, c.audioDuration),
  );
  return { ...c, committed };
}

describe('R.13 — the atomic-utterance invariant: detection (synthetic)', () => {
  /** s0 carries a run at [3.00, 4.60]; s0's own words run to 6.90. A silence
   *  sits at [4.70, 4.95] — BETWEEN the run and s0's own line — and another at
   *  [7.05, 7.35], after it. A closing boundary on the first is the defect. */
  function closingFixture() {
    const f = baseFixture();
    return {
      ...f,
      silences: [...f.silences, { startSec: 7.05, endSec: 7.35 }],
    };
  }

  it('fires when the closing boundary sits before the carrier finished its own line', () => {
    const { parsed, tokens, silences, audioDuration } = closingFixture();
    // The run [3.00, 4.60] sits between seg0's words (end 2.00) and seg1's
    // (5.00-6.90), so seg1 is the CARRIER once R.12 has pulled its start back
    // to 2.50. seg1's own line ends at 6.90; seg2 opens at 4.825 — inside it.
    const committed = [
      seg('seg0', 'alpha bravo charlie delta', 0, 2.50),
      seg('seg1', 'echo foxtrot golf hotel', 2.50, 2.325),
      seg('seg2', 'india juliett kilo lima', 4.825, 5.175),
    ];
    const findings = detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.segmentId).toBe('seg2');
    expect(findings[0]!.carrierId).toBe('seg1');
    expect(findings[0]!.utteranceEndSec).toBeCloseTo(6.90, 6);
    expect(findings[0]!.placement).toBe('silence-midpoint');
    expect(findings[0]!.correctedValue).toBeCloseTo(7.20, 6); // midpoint of [7.05, 7.35]
    expect(findings[0]!.delta).toBeGreaterThan(0);
  });

  it('only the segment CONTAINING the run onset is a carrier — a neighbour is never one', () => {
    // seg0's words end at 2.00, before the run starts at 3.00, and its span
    // stops at 2.50 so it does not contain the run onset either. The
    // containment scan — not the after-the-run guard — is what excludes it;
    // the guard is a defensive restatement of R.12's precedence and is
    // unreachable in the shipped order (see its own comment, and M8-B).
    const { parsed, tokens, silences, audioDuration } = closingFixture();
    const committed = [
      seg('seg0', 'alpha bravo charlie delta', 0, 2.50),
      seg('seg1', 'echo foxtrot golf hotel', 2.50, 2.325),
      seg('seg2', 'india juliett kilo lima', 4.825, 5.175),
    ];
    const findings = detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration);
    expect(findings.some(f => f.carrierId === 'seg0')).toBe(false);
  });

  it('is a NO-OP when the closing boundary already sits after the carrier own line', () => {
    const { parsed, tokens, silences, audioDuration } = closingFixture();
    const committed = [
      seg('seg0', 'alpha bravo charlie delta', 0, 2.50),
      seg('seg1', 'echo foxtrot golf hotel', 2.50, 4.70),
      seg('seg2', 'india juliett kilo lima', 7.20, 2.80),
    ];
    expect(detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration)).toEqual([]);
  });

  it('falls back to the utterance end itself when no silence starts at or after it', () => {
    const f = closingFixture();
    const silences = f.silences.filter(s => s.startSec < 6.90); // strip the post-utterance silence
    const committed = [
      seg('seg0', 'alpha bravo charlie delta', 0, 2.50),
      seg('seg1', 'echo foxtrot golf hotel', 2.50, 2.325),
      seg('seg2', 'india juliett kilo lima', 4.825, 5.175),
    ];
    const findings = detectUtterancePlacementDefects(f.parsed, committed, f.tokens, silences, f.audioDuration);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.placement).toBe('utterance-end-fallback');
    expect(findings[0]!.correctedValue).toBeCloseTo(6.90, 6);
  });

  it('declines a correction that would reach or pass the NEXT boundary', () => {
    const f = closingFixture();
    // A fourth committed scene opens at 7.10, before the [7.05, 7.35] midpoint
    // 7.20 — correcting seg2 to 7.20 would invert the partition, so R.13 must
    // decline entirely rather than relocate the defect.
    const committed = [
      seg('seg0', 'alpha bravo charlie delta', 0, 2.50),
      seg('seg1', 'echo foxtrot golf hotel', 2.50, 2.325),
      seg('seg2', 'india juliett kilo lima', 4.825, 2.275),
      seg('seg3', 'mike november oscar papa', 7.10, 2.90),
    ];
    expect(detectUtterancePlacementDefects(f.parsed, committed, f.tokens, f.silences, f.audioDuration)).toEqual([]);
  });

  it('declines a sub-epsilon correction, reusing the opening half own do-not-churn bound', () => {
    const f = closingFixture();
    const silences = f.silences.filter(s => s.startSec < 6.90); // force the fallback, corrected = 6.90
    const committed = [
      seg('seg0', 'alpha bravo charlie delta', 0, 2.50),
      seg('seg1', 'echo foxtrot golf hotel', 2.50, 4.38),
      seg('seg2', 'india juliett kilo lima', 6.88, 3.12),
    ];
    // 6.88 -> 6.90 is 0.02s, inside the bound, so R.13 must decline.
    expect(0.02).toBeLessThan(R12_MIN_CORRECTION_SEC);
    expect(detectUtterancePlacementDefects(f.parsed, committed, f.tokens, silences, f.audioDuration)).toEqual([]);
  });

  it('never proposes a value inside ANY unscripted run (H7, mirrored)', () => {
    const { parsed, tokens, silences, audioDuration } = closingFixture();
    const committed = [
      seg('seg0', 'alpha bravo charlie delta', 0, 2.50),
      seg('seg1', 'echo foxtrot golf hotel', 2.50, 2.325),
      seg('seg2', 'india juliett kilo lima', 4.825, 5.175),
    ];
    const runs = computeUnscriptedRuns(parsed, tokens, silences, audioDuration);
    for (const f of detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration)) {
      for (const u of runs) {
        expect(f.correctedValue > u.startSec + 1e-9 && f.correctedValue < u.endSec - 1e-9).toBe(false);
      }
    }
  });

  it('is empty when there are no unscripted runs at all', () => {
    const f = baseFixture();
    const noRunTokens = f.tokens.filter(t => !['level', 'nine', 'recitation', 'here'].includes(t.text));
    expect(detectUtterancePlacementDefects(f.parsed, f.parsed, noRunTokens, f.silences, f.audioDuration)).toEqual([]);
  });
});

describe('R.13 — application (Model P) and the corpus', () => {
  it('v6: fires on exactly ONE boundary, 225_night_scouts 667.47 -> 669.05', () => {
    const { parsed, committed, tokens, silences, audioDuration } = postR12('v6');
    const findings = detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration);
    expect(findings.map(f => f.segmentId)).toEqual(['225_night_scouts']);
    const f = findings[0]!;
    expect(f.carrierId).toBe('224_thirty_three');
    expect(Math.abs(f.committedValue - 667.47)).toBeLessThan(0.005);
    expect(Math.abs(f.correctedValue - 669.05)).toBeLessThan(0.005);
    expect(Math.abs(f.utteranceEndSec - 667.73)).toBeLessThan(0.005);
    expect(f.placement).toBe('silence-midpoint');
    expect(f.backingSilence).toEqual({ startSec: 668.70, endSec: 669.40 });
    expect(f.delta).toBeGreaterThan(0);
  }, CORPUS_TIMEOUT_MS);

  it('the other NINE recitations are exact no-ops — R.12 already left them clean', () => {
    const { parsed, committed, tokens, silences, audioDuration } = postR12('v6');
    const runs = computeUnscriptedRuns(parsed, tokens, silences, audioDuration);
    expect(runs).toHaveLength(10);
    const fired = detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration);
    expect(fired).toHaveLength(1);
    expect(runs.length - fired.length).toBe(9);
  }, CORPUS_TIMEOUT_MS);

  it('173 and spanish are UNTOUCHED — zero runs means zero effect', () => {
    for (const key of ['173', 'spanish'] as const) {
      const { parsed, committed, tokens, silences, audioDuration } = postR12(key);
      expect(detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration), `${key}`).toEqual([]);
    }
  }, CORPUS_TIMEOUT_MS);

  it('blast radius is exactly 1 of 649 parsed rows across all three corpora', () => {
    let fired = 0; let rows = 0;
    for (const key of ['v6', '173', 'spanish'] as const) {
      const { parsed, committed, tokens, silences, audioDuration } = postR12(key);
      rows += parsed.length;
      fired += detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration).length;
    }
    expect(rows).toBe(649);
    expect(fired).toBe(1);
  }, CORPUS_TIMEOUT_MS);

  it('the corrected v6 partition is still Model P: gapless, monotonic, sum conserved', () => {
    const { parsed, committed, tokens, silences, audioDuration } = postR12('v6');
    const before = committed.reduce((a, s) => a + s.duration, 0);
    const out = applyUtterancePlacementCorrections(
      committed,
      detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration),
    );
    expect(out).toHaveLength(447);
    for (let i = 1; i < out.length; i++) {
      expect(
        Math.abs(out[i - 1]!.startTime + out[i - 1]!.duration - out[i]!.startTime),
        `gap or overlap at boundary ${i} (${out[i]!.id})`,
      ).toBeLessThan(1e-6);
      expect(out[i]!.duration, `${out[i]!.id}: non-positive duration`).toBeGreaterThan(0);
    }
    expect(out.reduce((a, s) => a + s.duration, 0)).toBeCloseTo(before, 6);
    expect(out[out.length - 1]!.startTime + out[out.length - 1]!.duration).toBeCloseTo(audioDuration, 2);
  }, CORPUS_TIMEOUT_MS);

  it('applying R.13 moves ONLY 225_night_scouts start and 224_thirty_three duration', () => {
    const { parsed, committed, tokens, silences, audioDuration } = postR12('v6');
    const out = applyUtterancePlacementCorrections(
      committed,
      detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration),
    );
    const moved = out.filter((s, i) =>
      Math.abs(s.startTime - committed[i]!.startTime) > 1e-9 || Math.abs(s.duration - committed[i]!.duration) > 1e-9,
    ).map(s => s.id);
    expect(moved.sort()).toEqual(['224_thirty_three', '225_night_scouts']);
  }, CORPUS_TIMEOUT_MS);

  it('R.13 is IDEMPOTENT — re-running it on its own output finds nothing', () => {
    const { parsed, committed, tokens, silences, audioDuration } = postR12('v6');
    const out = applyUtterancePlacementCorrections(
      committed,
      detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration),
    );
    expect(detectUtterancePlacementDefects(parsed, out, tokens, silences, audioDuration)).toEqual([]);
  }, CORPUS_TIMEOUT_MS);
});

describe('R.13 — mutual exclusion against R.5, R.10, R.11, R.12 and R-U', () => {
  it('R.12: the two firing sets are disjoint — different boundaries of the same carrier', () => {
    const { parsed, committed: pre, tokens, silences, audioDuration } = corpus('v6');
    const r12 = detectRunPlacementDefects(parsed, pre, tokens, silences, audioDuration).map(f => f.segmentId);
    const { committed: post } = postR12('v6');
    const r13 = detectUtterancePlacementDefects(parsed, post, tokens, silences, audioDuration).map(f => f.segmentId);
    expect(r12).toHaveLength(9);
    expect(r13).toEqual(['225_night_scouts']);
    for (const tag of r13) expect(r12, `R.12 and R.13 both claim ${tag}`).not.toContain(tag);
  }, CORPUS_TIMEOUT_MS);

  it('R.11: its four rows are untouched by R.13, including the adjacent 226_four_scouts', () => {
    const R11_FIRING_SET = ['152_frozen_brush_mice', '226_four_scouts', '192_scout_listening', 'abysmal_opinion'];
    const fired: string[] = [];
    for (const key of ['v6', '173', 'spanish'] as const) {
      const { parsed, committed, tokens, silences, audioDuration } = postR12(key);
      fired.push(...detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration).map(f => f.segmentId));
    }
    for (const tag of R11_FIRING_SET) expect(fired, `R.13 and R.11 both claim ${tag}`).not.toContain(tag);
  }, CORPUS_TIMEOUT_MS);

  it('R.5: applying R.13 leaves the chunk plan BYTE-IDENTICAL on all three corpora', () => {
    for (const key of ['v6', '173', 'spanish'] as const) {
      const { parsed, committed, tokens, silences, audioDuration } = postR12(key);
      const ser = (cs: readonly { startSec: number; endSec: number; text: string }[]): string =>
        cs.map(c => `${c.startSec.toFixed(3)},${c.endSec.toFixed(3)},${c.text}`).join('|');
      const before = ser(computeFaChunkPlan(parsed, tokens, silences, audioDuration));
      const findings = detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration);
      const byId = new Map(findings.map(f => [f.segmentId, f.correctedValue]));
      const moved = parsed.map(s => ({ ...s }));
      for (let i = 0; i < moved.length; i++) {
        const want = byId.get(moved[i]!.id);
        if (want === undefined) continue;
        const delta = want - moved[i]!.startTime;
        moved[i] = { ...moved[i]!, startTime: want, duration: moved[i]!.duration - delta };
        if (i > 0) moved[i - 1] = { ...moved[i - 1]!, duration: moved[i - 1]!.duration + delta };
      }
      expect(ser(computeFaChunkPlan(moved, tokens, silences, audioDuration)), `${key}: chunk plan`).toBe(before);
    }
  }, CORPUS_TIMEOUT_MS);

  it('R.10 and R-U/R-AA: both live in 173, which has zero runs', () => {
    const { parsed, committed, tokens, silences, audioDuration } = postR12('173');
    expect(detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration)).toEqual([]);
  }, CORPUS_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// BOTH SIDES, as a standing corpus assertion (ruling R-AO).
// ---------------------------------------------------------------------------
describe('R.12 + R.13 — the run invariant holds on BOTH edges of every run', () => {
  it('v6: after both halves, no boundary is inside a run and no carrier loses its own line', () => {
    const c = corpus('v6');
    let committed = applyRunPlacementCorrections(
      c.committed,
      detectRunPlacementDefects(c.parsed, c.committed, c.tokens, c.silences, c.audioDuration),
    );
    committed = applyUtterancePlacementCorrections(
      committed,
      detectUtterancePlacementDefects(c.parsed, committed, c.tokens, c.silences, c.audioDuration),
    );
    const runs = computeUnscriptedRuns(c.parsed, c.tokens, c.silences, c.audioDuration);
    expect(runs).toHaveLength(10);

    // OPENING: no committed boundary strictly inside any run.
    for (let i = 1; i < committed.length; i++) {
      for (const u of runs) {
        expect(
          committed[i]!.startTime > u.startSec + 1e-9 && committed[i]!.startTime < u.endSec - 1e-9,
          `${committed[i]!.id} at ${committed[i]!.startTime} is inside run [${u.startSec}, ${u.endSec}]`,
        ).toBe(false);
      }
    }
    // CLOSING: nothing left for R.13 to find.
    expect(
      detectUtterancePlacementDefects(c.parsed, committed, c.tokens, c.silences, c.audioDuration),
      'a closing-edge defect survived both halves',
    ).toEqual([]);
  }, CORPUS_TIMEOUT_MS);
});
