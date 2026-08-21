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
  acousticRunExtent,
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

  it('WS1 SESSION T REVERSAL: this fixture used to need a clamp; it no longer needs a correction at all', () => {
    // WHAT THIS CASE USED TO ASSERT, and why it was wrong — kept rather than
    // deleted, because the reversal is the point. Sessions H-S pinned the
    // CLAMPED answer 2.70 here and argued the intersection was forced by
    // measurement: "unclamped, the midpoint of a silence that overruns the run
    // onset lands back INSIDE the run". That was true of this fixture and of
    // four real corpus rows, and the explanation was still wrong. A silence
    // only appeared to "overrun the run onset" because the onset was a Whisper
    // timestamp sitting inside that very silence — `acousticRunExtent` now
    // measures the onset off the waveform instead, and once it does, the
    // silence [2.40, 4.40] is exactly the pause separating "delta" (ends 2.00)
    // from the run: it is still open at the model's claimed onset (3.00), so
    // the run's real acoustic onset is 4.40, not 3.00.
    //
    // The committed boundary this fixture is built around (`seg1` at 3.50) was
    // NEVER actually inside the run — it only looked that way because the run
    // was measured wrong. Corrected, `seg1` sits cleanly before the run
    // starts, and R.12 has nothing to fix: the same shape `224_thirty_three`
    // took in the real corpus (see the `EIGHT` table's own header comment).
    const { parsed, tokens, audioDuration } = baseFixture();
    const silences: SilenceInterval[] = [{ startSec: 2.40, endSec: 4.40 }];
    const findings = detectRunPlacementDefects(parsed, committedFrom(parsed), tokens, silences, audioDuration);
    expect(findings).toHaveLength(0);
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

/** The corpus rows R.12 fires on, with their measured corrected values.
 *
 *  WS1 SESSION T RE-PIN — nine rows became EIGHT, and the departure is the
 *  rule working rather than a regression. `224_thirty_three` sits at 664.33 in
 *  this frozen fixture. Run 5's acoustic onset was a Whisper timestamp at
 *  663.91, which put 664.33 "inside" the run and gave R.12 a defect to fix;
 *  the onset is now measured off the waveform at 665.00, and 664.33 is
 *  comfortably OUTSIDE the run. There is nothing left to correct, so R.12
 *  declines. (The value R.12 used to impose there, 663.785, is one of the five
 *  the owner scored EARLY; 664.33 is within 0.000s of the value the Session T
 *  A/B pass licensed for that boundary. The fixture's own committed value was
 *  right and the rule had been dragging it earlier.)
 *
 *  `042_eleven_years` also changes PATH here, `run-start-fallback` ->
 *  `silence-midpoint`, for the same reason: the widened gap now reaches the
 *  post-breath pause at [125.62, 125.90], which no longer has to be guessed
 *  at. */
const EIGHT: Array<{ tag: string; committed: number; corrected: number; placement: 'silence-midpoint' | 'run-start-fallback' }> = [
  { tag: '042_eleven_years', committed: 127.17, corrected: 125.76, placement: 'silence-midpoint' },
  { tag: '085_the_spear_bearer', committed: 252.74, corrected: 250.81, placement: 'silence-midpoint' },
  { tag: '125_night_circle', committed: 372.35, corrected: 370.75, placement: 'silence-midpoint' },
  { tag: '176_twenty_six_scout', committed: 524.39, corrected: 522.46, placement: 'silence-midpoint' },
  { tag: '266_forty_one_burden', committed: 790.33, corrected: 788.75, placement: 'silence-midpoint' },
  { tag: '307_forty_nine_years', committed: 926.97, corrected: 925.43, placement: 'silence-midpoint' },
  { tag: '340_fifty_eight', committed: 1047.57, corrected: 1045.62, placement: 'silence-midpoint' },
  { tag: '383_sixty_four', committed: 1190.81, corrected: 1189.05, placement: 'silence-midpoint' },
];

describe('R.12 — the corpus: all nine rows, blast radius, and the controls', () => {
  it('v6: fires on exactly the eight rows, at exactly their measured values', () => {
    const { parsed, committed, tokens, silences, audioDuration } = corpus('v6');
    const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);

    expect(findings.map(f => f.segmentId)).toEqual(EIGHT.map(n => n.tag));
    for (const n of EIGHT) {
      const f = findings.find(x => x.segmentId === n.tag)!;
      expect(Math.abs(f.committedValue - n.committed), `${n.tag}: committed`).toBeLessThan(0.005);
      expect(Math.abs(f.correctedValue - n.corrected), `${n.tag}: corrected`).toBeLessThan(0.005);
      expect(f.placement, `${n.tag}: placement path`).toBe(n.placement);
      expect(f.delta, `${n.tag}: every correction moves the boundary EARLIER`).toBeLessThan(0);
    }
  }, CORPUS_TIMEOUT_MS);

  it('NONE of the eight takes the fallback path any more — H8 as a standing check', () => {
    // H8 asked "how many rows have to be guessed at, because no measured
    // silence backs them?" Through Session S the answer was one:
    // `042_eleven_years`, whose gap ended at Whisper's claimed onset and
    // therefore contained no silence at all. Session T's onset correction
    // widens that gap to the pause's real end, and the pause is inside it.
    // The answer is now ZERO — every corpus row is backed by a measurement.
    // The fallback path is still live and still tested, on the synthetic
    // shapes that actually have no silence to find (see the Session T block
    // and the zero-length-intersection case above).
    const { parsed, committed, tokens, silences, audioDuration } = corpus('v6');
    const findings = detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration);
    const fallbacks = findings.filter(f => f.placement === 'run-start-fallback');
    expect(fallbacks.map(f => f.segmentId)).toEqual([]);
  }, CORPUS_TIMEOUT_MS);

  it('173 and spanish are UNTOUCHED — zero unscripted runs means zero effect', () => {
    for (const key of ['173', 'spanish'] as const) {
      const { parsed, committed, tokens, silences, audioDuration } = corpus(key);
      expect(computeUnscriptedRuns(parsed, tokens, silences, audioDuration), `${key}: runs`).toEqual([]);
      expect(detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration), `${key}: findings`).toEqual([]);
    }
  }, CORPUS_TIMEOUT_MS);

  it('blast radius is exactly 8 of 649 parsed rows across all three corpora', () => {
    let fired = 0; let rows = 0;
    for (const key of ['v6', '173', 'spanish'] as const) {
      const { parsed, committed, tokens, silences, audioDuration } = corpus(key);
      rows += parsed.length;
      fired += detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration).length;
    }
    expect(rows).toBe(649);
    expect(fired).toBe(8);
  }, CORPUS_TIMEOUT_MS);

  it('H7 on the real corpus: no corrected value lies inside ANY unscripted run', () => {
    // STATED AGAINST THE ACOUSTIC EXTENT, which is the interval H7 itself
    // tests and the one every clause of R.12, R.13 and R-AP is written
    // against. Through Session S this loop read `computeUnscriptedRuns`'s RAW
    // token span instead and still passed — but only because this frozen
    // fixture's word CSV is a PRE-FILTERED token array in which the run's
    // leading punctuation token is absent, making raw and acoustic identical.
    // On the live production path they are not: v6 run 1's raw span opens at
    // 125.25 (the end of the preceding word) while its acoustic extent opens
    // at 125.90, so a raw-span reading of this invariant is false in
    // production and always was. Testing the guard against a second,
    // independently-derived notion of "the run" is precisely the defect
    // `acousticRunExtent` exists to prevent — see its header.
    const { parsed, committed, tokens, silences, audioDuration } = corpus('v6');
    const extents = computeUnscriptedRuns(parsed, tokens, silences, audioDuration)
      .map(r => acousticRunExtent(r, tokens, silences));
    for (const f of detectRunPlacementDefects(parsed, committed, tokens, silences, audioDuration)) {
      for (const u of extents) {
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

  /**
   * WS1 SESSION Q — carrier identification, not `run.startSec`, is where the
   * head-side punctuation-inflation defect Session P found for R.12 recurs
   * for R.13. `baseFixture()`'s tokens are all substantive (real words), so
   * the base fixture cannot exercise this: the run's raw and acoustic onsets
   * coincide there. This fixture inserts a leading PUNCTUATION-ONLY token
   * (normalizes to nothing, so it is UNCLAIMED and becomes the run's own
   * `tokenLo`) immediately before the recitation, exactly the shape
   * `acousticRunExtent`'s own doc comment describes: "a recitation is
   * preceded by a full stop... that punctuation token becomes the run's
   * first token and the run's `startSec` is pinned to the END of the
   * previous word."
   *
   * `seg1`'s COMMITTED span starts at the run's ACOUSTIC onset (2.05) —
   * simulating what R.12 has already done to it by the time R.13 runs — which
   * is strictly AFTER the run's RAW onset (2.00, the punctuation token's own
   * start). A carrier lookup keyed on `run.startSec` therefore finds `seg0`
   * (2.00 sits inside `seg0`'s own [0, 2.05) span) — an unrelated, PRECEDING
   * segment whose own line trivially ends at 2.00, long before the run even
   * finishes — and R.13 silently declines a real defect. Measured on the live
   * v6 bundle, not merely constructed: this is the exact shape all nine of
   * v6's R.12-corrected runs took, and it declined via the SAME early-exit
   * (`ws1-session-q-r13-tail.test.ts`, `guard-utterance-not-after-run`, guard
   * deficits of 2.98s-5.61s — orders of magnitude past what any tail-side
   * `run.endSec` inflation could produce).
   */
  function headInflationFixture(): {
    parsed: VideoSegment[]; tokens: TranscriptToken[]; silences: SilenceInterval[]; audioDuration: number;
  } {
    return {
      parsed: [
        seg('seg0', 'alpha bravo charlie delta', 0, 2.05),
        seg('seg1', 'echo foxtrot golf hotel', 2.05, 2.95),
        seg('seg2', 'india juliett kilo lima', 5.00, 3.40),
      ],
      tokens: [
        tok('alpha', 0.10, 0.50), tok('bravo', 0.60, 1.00),
        tok('charlie', 1.10, 1.50), tok('delta', 1.60, 2.00),
        tok('.', 2.00, 2.02), // unclaimed — pins the run's RAW onset to 2.00.
        // the unscripted run — ACOUSTIC onset 2.05, not the punctuation's 2.00.
        tok('level', 2.05, 2.35), tok('nine', 2.40, 2.70),
        tok('recitation', 2.75, 3.05), tok('here', 3.10, 3.40),
        tok('echo', 3.80, 4.20), tok('foxtrot', 4.30, 4.70),
        tok('golf', 4.80, 5.20), tok('hotel', 5.30, 5.70),
        tok('india', 6.50, 6.90), tok('juliett', 7.00, 7.40),
        tok('kilo', 7.50, 7.90), tok('lima', 8.00, 8.40),
      ],
      // The only silence at/after seg1's true utterance end (hotel, 5.70) —
      // the sole legal placement for the closing correction.
      silences: [{ startSec: 5.80, endSec: 6.00 }],
      audioDuration: 10.0,
    };
  }

  it('the carrier is found by the run\'s ACOUSTIC onset, not run.startSec — a punctuation-inflated raw onset must not walk the lookup back into an unrelated preceding segment', () => {
    const { parsed, tokens, silences, audioDuration } = headInflationFixture();
    // Committed span mirrors what R.12 already did: seg1 starts exactly at
    // the run's acoustic onset (2.05), strictly after the raw one (2.00).
    const committed = [
      seg('seg0', 'alpha bravo charlie delta', 0, 2.05),
      seg('seg1', 'echo foxtrot golf hotel', 2.05, 2.95), // ends 5.00 — its OWN words run to 5.70.
      seg('seg2', 'india juliett kilo lima', 5.00, 3.40), // the real defect: opens 0.70s early.
    ];
    const findings = detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration);
    expect(findings, 'a carrier lookup keyed on the raw run onset misses this defect entirely').toHaveLength(1);
    expect(findings[0]!.carrierId, 'the carrier must be seg1 (the true owner), not seg0 (an unrelated neighbour)').toBe('seg1');
    expect(findings[0]!.segmentId).toBe('seg2');
    expect(findings[0]!.utteranceEndSec).toBeCloseTo(5.70, 6);
    expect(findings[0]!.correctedValue).toBeCloseTo(5.90, 6); // midpoint of [5.80, 6.00]
  });

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
    // containment scan — not the after-the-run guard — is what excludes it.
    // The guard has its own reachability case and its own tests below; it is
    // unreachable in the shipped order but NOT uncovered (M8-B is RED).
    const { parsed, tokens, silences, audioDuration } = closingFixture();
    const committed = [
      seg('seg0', 'alpha bravo charlie delta', 0, 2.50),
      seg('seg1', 'echo foxtrot golf hotel', 2.50, 2.325),
      seg('seg2', 'india juliett kilo lima', 4.825, 5.175),
    ];
    const findings = detectUtterancePlacementDefects(parsed, committed, tokens, silences, audioDuration);
    expect(findings.some(f => f.carrierId === 'seg0')).toBe(false);
  });

  /**
   * THE AFTER-THE-RUN GUARD, covered rather than accepted as uncoverable
   * (WS1 Session L, debt 1 — M8-B was reported GREEN in Session K).
   *
   * The guard is `utteranceEndSec > run.endSec`. Reaching it needs the
   * carrier's own line to end at or before the run does, and the reachability
   * argument is narrower than Session K's comment claimed. `claimed[]` in
   * `detectUnscriptedRuns` marks a segment's WHOLE matched span, so no
   * segment's `lastTokenIdx` can ever fall inside a run's token range: the
   * carrier's last token is strictly before `run.tokenLo` or strictly after
   * `run.tokenHi`. Before the run, monotonic token times put
   * `utteranceEndSec <= run.startSec`, which the detection test below then
   * contradicts. After the run, `utteranceEndSec >= run.endSec` — so
   * EQUALITY is the only value that reaches the guard, and it needs a
   * zero-width token at `run.endSec`, which Whisper does emit.
   *
   * That makes the guard reachable exactly once: on an UNCORRECTED array,
   * where the successor still opens strictly inside the run. R.12 owns that
   * boundary. Without the guard the two rules disagree on the same edge —
   * measured on this fixture: R.13 proposes 4.825, R.12 proposes 2.50.
   */
  function equalityBoundaryFixture() {
    return {
      parsed: [
        seg('seg0', 'alpha bravo charlie delta', 0, 3.5),
        seg('seg1', 'echo', 3.5, 3.5),
        seg('seg2', 'india juliett kilo lima', 7.0, 3.0),
      ],
      tokens: [
        tok('alpha', 0.10, 0.50), tok('bravo', 0.60, 1.00),
        tok('charlie', 1.10, 1.50), tok('delta', 1.60, 2.00),
        // the run — indices 4..7, [3.00, 4.60].
        tok('level', 3.00, 3.30), tok('nine', 3.40, 3.70),
        tok('recitation', 3.80, 4.20), tok('here', 4.30, 4.60),
        // the carrier's single own word, zero-width, ending EXACTLY at the
        // run's end. This is what puts `utteranceEndSec === run.endSec`.
        tok('echo', 4.60, 4.60),
        tok('india', 7.50, 7.90), tok('juliett', 8.00, 8.40),
        tok('kilo', 8.50, 8.90), tok('lima', 9.00, 9.40),
      ],
      silences: [{ startSec: 2.20, endSec: 2.80 }, { startSec: 4.70, endSec: 4.95 }] as SilenceInterval[],
      audioDuration: 10.0,
    };
  }

  /** The committed array BEFORE R.12 has run: `seg2` opens at 4.00, strictly
   *  inside the run [3.00, 4.60], and `seg1` (the carrier) contains 3.00. */
  const uncorrectedCommitted = () => [
    seg('seg0', 'alpha bravo charlie delta', 0, 2.50),
    seg('seg1', 'echo', 2.50, 1.50),
    seg('seg2', 'india juliett kilo lima', 4.00, 6.00),
  ];

  it('the fixture really does put utteranceEndSec EXACTLY at run.endSec', () => {
    const { parsed, tokens, silences, audioDuration } = equalityBoundaryFixture();
    const runs = computeUnscriptedRuns(parsed, tokens, silences, audioDuration);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.startSec).toBeCloseTo(3.00, 6);
    expect(runs[0]!.endSec).toBeCloseTo(4.60, 6);
    // The carrier's own (only) word is index 8, zero-width at the run's end.
    expect(tokens[8]!.endSec).toBeCloseTo(runs[0]!.endSec, 12);
    // And the uncorrected boundary really is strictly inside that run.
    expect(uncorrectedCommitted()[2]!.startTime).toBeGreaterThan(runs[0]!.startSec);
    expect(uncorrectedCommitted()[2]!.startTime).toBeLessThan(runs[0]!.endSec);
  });

  it('declines when the carrier own line ends exactly where the run ends — the guard', () => {
    const { parsed, tokens, silences, audioDuration } = equalityBoundaryFixture();
    expect(
      detectUtterancePlacementDefects(parsed, uncorrectedCommitted(), tokens, silences, audioDuration),
    ).toEqual([]);
  });

  it('and that declined boundary is R.12 own — the guard keeps the two rules from disagreeing', () => {
    const { parsed, tokens, silences, audioDuration } = equalityBoundaryFixture();
    const r12 = detectRunPlacementDefects(parsed, uncorrectedCommitted(), tokens, silences, audioDuration);
    expect(r12).toHaveLength(1);
    expect(r12[0]!.segmentId).toBe('seg2');
    expect(r12[0]!.committedValue).toBeCloseTo(4.00, 6);
    expect(r12[0]!.correctedValue).toBeCloseTo(2.50, 6);
  });

  it('once R.12 has corrected it, R.13 still declines — and for the containment reason', () => {
    const { parsed, tokens, silences, audioDuration } = equalityBoundaryFixture();
    const corrected = [
      seg('seg0', 'alpha bravo charlie delta', 0, 2.50),
      seg('seg1', 'echo', 2.50, 7.50),
    ];
    expect(
      detectUtterancePlacementDefects(parsed, corrected, tokens, silences, audioDuration),
    ).toEqual([]);
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
    expect(r12).toHaveLength(8); // WS1 Session T: 224_thirty_three is no longer inside its run.
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
    // The ACOUSTIC extent, for the reason the H7 corpus case above states at
    // length: it is the interval the invariant is defined on, and the raw
    // token span is not the same thing on the live path.
    const extents = runs.map(r => acousticRunExtent(r, c.tokens, c.silences));

    // OPENING: no committed boundary strictly inside any run.
    for (let i = 1; i < committed.length; i++) {
      for (const u of extents) {
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

// ---------------------------------------------------------------------------
// WS1 SESSION T — the onset correction, and the clamp's removal.
//
// Two independent changes, tested independently, plus the guard that must NOT
// have moved. Every fixture here is synthetic and states its own shape; the
// corpus evidence for both changes lives in
// `scripts/ws1-session-t-measure.test.ts` and in the plan doc's Part R.
// ---------------------------------------------------------------------------
describe('R.12 — WS1 Session T: the run onset is measured, not modelled', () => {
  /** The `042_eleven_years` SHAPE, reduced to a synthetic fixture.
   *
   *  The run's first token claims to start at 3.00. A short loud event (a
   *  breath, in the real corpus) occupies [3.00, 3.08], so the detector does
   *  NOT report silence there; the pause it does report is [3.08, 3.40], and
   *  real energy begins at 3.40. The pre-run gap therefore contains NO silence
   *  under the model's onset, and the pre-Session-T rule fell back to the
   *  claimed onset itself — landing the boundary on the breath.
   *
   *  This is the row that proves the correction is not breath logic: nothing
   *  here inspects amplitude, and the breath is represented only by the ABSENCE
   *  of a silence interval over it. */
  function breathShapeFixture() {
    const f = baseFixture();
    // Pause sits AFTER the claimed onset, separated from the previous word by
    // the (unrepresented) breath. Nothing overlaps the gap [2.00, 3.00].
    f.silences = [{ startSec: 3.08, endSec: 3.40 }, { startSec: 4.70, endSec: 4.95 }];
    return f;
  }

  it('moves the onset past a pause the model claimed to speak through — the 042 shape', () => {
    const f = breathShapeFixture();
    const findings = detectRunPlacementDefects(
      f.parsed, committedFrom(f.parsed), f.tokens, f.silences, f.audioDuration,
    );
    expect(findings).toHaveLength(1);
    const [found] = findings;
    // The gap's right edge is now the PAUSE's end (3.40), not the model's
    // claimed onset (3.00) — that widening is what brings the pause into the
    // gap at all.
    expect(found!.gapStartSec).toBeCloseTo(2.00, 6);
    expect(found!.gapEndSec).toBeCloseTo(3.40, 6);
    // Which makes this the silence-midpoint path, not the fallback it used to
    // take, and puts the value after the breath rather than on it.
    expect(found!.placement).toBe('silence-midpoint');
    expect(found!.correctedValue).toBeCloseTo(3.24, 6);
    expect(found!.runStartSec).toBeCloseTo(3.40, 6);
  });

  it('leaves the onset alone when the separating pause closed before the claim', () => {
    // `baseFixture`'s pause is [2.20, 2.80]; the claimed onset is 3.00. The
    // pause is shut well before the claim, so the model's answer stands and
    // the committed value is unchanged from every prior session's.
    const f = baseFixture();
    const findings = detectRunPlacementDefects(
      f.parsed, committedFrom(f.parsed), f.tokens, f.silences, f.audioDuration,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.runStartSec).toBeCloseTo(3.00, 6);
    expect(findings[0]!.gapEndSec).toBeCloseTo(3.00, 6);
    expect(findings[0]!.correctedValue).toBeCloseTo(2.50, 6);
  });

  it('never moves the onset EARLIER than the model claimed', () => {
    // A pause that both opens and closes before the claimed onset cannot pull
    // the run's start backward — that would let a run swallow preceding
    // speech. Asserted directly rather than left to the corpus.
    const f = baseFixture();
    f.silences = [{ startSec: 2.10, endSec: 2.30 }, { startSec: 2.50, endSec: 2.90 }];
    const findings = detectRunPlacementDefects(
      f.parsed, committedFrom(f.parsed), f.tokens, f.silences, f.audioDuration,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.runStartSec).toBeCloseTo(3.00, 6);
  });

  it('takes the model onset when there are no detected silences at all', () => {
    const f = baseFixture();
    f.silences = [];
    const findings = detectRunPlacementDefects(
      f.parsed, committedFrom(f.parsed), f.tokens, f.silences, f.audioDuration,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.runStartSec).toBeCloseTo(3.00, 6);
    expect(findings[0]!.placement).toBe('run-start-fallback');
    expect(findings[0]!.correctedValue).toBeCloseTo(3.00, 6);
  });
});

describe('R.12 — WS1 Session T: the placement value is UNCLAMPED', () => {
  /** A silence that outlasts the placement gap. The FIRST pause after the
   *  previous word is a brief one at [2.02, 2.10], which closes before the
   *  claimed onset (3.00) and so leaves the onset alone; the WIDER silence at
   *  [2.40, 3.40] is therefore not the separating pause, but it is the one
   *  with the strongest overlap with the gap [2.00, 3.00], so it backs the
   *  placement — and it runs on past the gap's right edge.
   *
   *  Clamped, the value would be mid([2.40, 3.00]) = 2.70.
   *  Unclamped, it is mid([2.40, 3.40]) = 2.90.
   *
   *  THIS IS THE MUTATION TARGET (M14): restoring `(best.lo + best.hi) / 2`
   *  makes this case RED. */
  function outlastingSilenceFixture() {
    const f = baseFixture();
    f.silences = [
      { startSec: 2.02, endSec: 2.10 },
      { startSec: 2.40, endSec: 3.40 },
      { startSec: 4.70, endSec: 4.95 },
    ];
    return f;
  }

  it('uses the WHOLE backing silence, not its intersection with the gap', () => {
    const f = outlastingSilenceFixture();
    const findings = detectRunPlacementDefects(
      f.parsed, committedFrom(f.parsed), f.tokens, f.silences, f.audioDuration,
    );
    expect(findings).toHaveLength(1);
    const [found] = findings;
    expect(found!.gapEndSec).toBeCloseTo(3.00, 6);
    expect(found!.backingSilence).toEqual({ startSec: 2.40, endSec: 3.40 });
    expect(found!.correctedValue).toBeCloseTo(2.90, 6);
    // Stated as an inequality too, so the case cannot pass by coincidence if
    // the fixture's numbers are ever adjusted: the clamped answer is 2.70.
    expect(found!.correctedValue).toBeGreaterThan(2.70 + 1e-6);
  });

  it('H7 still declines a value the unclamped midpoint would push inside a run', () => {
    // The guard was NOT weakened to accommodate the unclamped value — it is
    // the same test, and it still bites. Here the backing silence is wide
    // enough that its whole midpoint lands inside the run's own acoustic
    // extent [3.00, 4.60], so R.12 declines rather than relocating the defect.
    const f = baseFixture();
    f.silences = [{ startSec: 2.02, endSec: 2.10 }, { startSec: 2.60, endSec: 5.00 }];
    const findings = detectRunPlacementDefects(
      f.parsed, committedFrom(f.parsed), f.tokens, f.silences, f.audioDuration,
    );
    // mid([2.60, 5.00]) = 3.80, strictly inside [3.00, 4.60] -> declined.
    expect(findings).toHaveLength(0);
  });
});
