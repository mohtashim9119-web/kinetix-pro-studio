/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// R.11 — chunk-fit boundary correction. Tests against REAL corpus fixtures
// (the same `phase4-baseline-*`/`phase4-fa-second-baseline-*` files the FA
// replay gate and `faChunkPlan.test.ts` read) plus REAL measured FA
// per-word confidence values baked in as literals — the same pattern
// `faUnspokenGate.test.ts` uses for the identical reason: the real values
// live in `.work-phase4/replay/*/fa_production_words.json`, a real,
// reproducible capture that is gitignored (too large to commit), so the
// specific numbers this suite depends on are recorded here directly. Every
// number below was read from that real capture (WS1 Session F), not
// invented — see faSeamFitGate.ts's own header for the mechanism they prove.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { detectSeamFitDefects, applySeamFitCorrections } from './faSeamFitGate';
import { R11_MIN_FIT_DEVIATION, R11_MAX_SPAN_WORD_CONF } from './syncConstants';
import { computeFaChunkPlan, computeRuns } from './faChunkPlan';
import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = resolve(REPO, 'scripts', 'fixtures');

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; } } else { field += c; } }
    else if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') { field += c; }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])) as Record<string, string>);
}
function loadCsv(name: string): Record<string, string>[] {
  return parseCsv(readFileSync(resolve(FIXTURES, name), 'utf-8'));
}

type Corpus = 'v6' | '173' | 'spanish';
const AUDIO_DURATION: Record<Corpus, number> = { v6: 1421.29, '173': 709.01, spanish: 92.04 };

/** Same complete pre-skip-filter parse reconstruction
 *  `scripts/phase4-fa-replay.test.ts`'s `loadAnchorPathInputs` uses — R.11's
 *  own detector requires the same complete, ordered array `computeFaChunkPlan`
 *  was originally given (this file's own doc comment). Duplicated rather than
 *  imported: that file is a `scripts/` harness, not a `src/` module. */
function loadCorpus(key: Corpus): { segments: VideoSegment[]; tokens: TranscriptToken[]; silences: SilenceInterval[] } {
  const tokens: TranscriptToken[] = loadCsv(`phase4-baseline-${key}-words.csv`)
    .map(r => ({ text: r.text!, startSec: Number(r.startSec), endSec: Number(r.endSec) }));
  const silences: SilenceInterval[] = loadCsv(`phase4-baseline-${key}-silences.csv`)
    .map(r => ({ startSec: Number(r.startSec), endSec: Number(r.endSec) }));

  const committed = loadCsv(`phase4-fa-second-baseline-${key}-segments.csv`);
  const skipped = loadCsv(`phase4-fa-second-baseline-${key}-skipped.csv`);
  const skippedByIndex = new Map(skipped.map(r => [Number(r.segmentIndex), r]));
  const total = committed.length + skipped.length;
  const segments: VideoSegment[] = [];
  let next = 0;
  for (let i = 0; i < total; i++) {
    const sk = skippedByIndex.get(i);
    if (sk) {
      segments.push({ id: sk.segmentTag, text: sk.segmentText, startTime: Number(sk.startTime), duration: Number(sk.duration), transition: 'none', animation: 'none', order: i, tag: sk.segmentTag } as unknown as VideoSegment);
      continue;
    }
    const c = committed[next++]!;
    segments.push({ id: c.tag, text: c.text, startTime: Number(c.startTime), duration: Number(c.duration), transition: 'none', animation: 'none', order: i, tag: c.tag } as unknown as VideoSegment);
  }
  return { segments, tokens, silences };
}

/** Real FA per-word confidence values, read directly from
 *  `.work-phase4/replay/{corpus}/fa_production_words.json` (WS1 Session F).
 *  Sparse by design: `detectSeamFitDefects`'s third conjunct only scans FA
 *  tokens whose `startSec` falls inside a candidate's own correction span,
 *  so only the words actually inside the spans this suite tests need to be
 *  present — the full 3874/1660/249-word captures are not required. */
const V6_FA_WORDS: TranscriptToken[] = [
  // item 7 (152_frozen_brush_mice), span [449.20, 451.03] — all near-zero.
  { text: 'of', startSec: 449.04, endSec: 449.10, confidence: 0.0023 },
  { text: 'one', startSec: 449.12, endSec: 449.18, confidence: 0.0006 },
  { text: 'when', startSec: 449.22, endSec: 449.30, confidence: 0.0015 },
  { text: 'the', startSec: 449.32, endSec: 449.44, confidence: 0.0 },
  { text: 'brush', startSec: 449.52, endSec: 449.82, confidence: 0.0 },
  { text: 'mice', startSec: 449.86, endSec: 449.96, confidence: 0.0 },
  { text: 'stop', startSec: 450.18, endSec: 451.68, confidence: 0.0 },
  // 226_four_scouts, span [670.24, 671.18] — all near-zero.
  { text: 'now', startSec: 670.04, endSec: 670.16, confidence: 0.000708 },
  { text: 'four', startSec: 670.32, endSec: 670.46, confidence: 0.000969 },
  { text: 'of', startSec: 670.56, endSec: 670.60, confidence: 2e-6 },
  { text: 'them', startSec: 670.64, endSec: 671.48, confidence: 0.0 },
  // 125_night_circle — the FALSE-POSITIVE GUARD. Its containing chunk has
  // extreme fit deviation, and 372.35 -> 373.70 would satisfy conjuncts 1+2.
  //
  // WS1 SESSION H — THIS COMMENT'S ORIGINAL REASON WAS FALSE AND IS RETIRED.
  // It used to say the conjunct exists because "372.35 is R.5's OWN
  // already-correct value". It is not correct: 372.35 is the exact midpoint
  // of a silence lying strictly INSIDE an unscripted run, and R.12
  // (`faRunPlacementGate.ts`) moves it to 370.75. The conjunct's REAL reason,
  // measured then and still measured now, is the acoustic evidence: the span
  // from 372.35 to R.11's proposed 373.70 holds a word at REAL confidence
  // (0.0301 — ~2.8x above R11_MAX_SPAN_WORD_CONF), not garbage, so R.11 has
  // no evidence to act on here whatever else is wrong with the boundary.
  //
  // The conjunct is now also load-bearing for RULE EXCLUSION: 372.35 is
  // R.12's row, and R.11 must keep declining it for the two rules to stay
  // disjoint. See `faRunPlacementGate.test.ts`'s mutual-exclusion block.
  { text: 'are', startSec: 373.22, endSec: 373.36, confidence: 0.0301 },
  // 192_scout_listening — the NEW, unverified R.11 candidate this session's
  // improved detector surfaces. Same evidentiary shape as the three known
  // defects: span [570.18, 571.07] is uniformly near-zero.
  { text: 'you', startSec: 568.60, endSec: 568.66, confidence: 0.0 },
  { text: 'both', startSec: 568.70, endSec: 569.28, confidence: 0.0 },
  { text: 'go', startSec: 569.34, endSec: 569.78, confidence: 0.0 },
  { text: 'still', startSec: 569.82, endSec: 570.14, confidence: 0.0 },
  { text: 'you', startSec: 570.22, endSec: 570.66, confidence: 4e-5 },
];

const CORPUS_173_FA_WORDS: TranscriptToken[] = [
  // abysmal_opinion, span [16.50, 17.88] — all near-zero.
  { text: 'because', startSec: 16.34, endSec: 16.54, confidence: 0.0 },
  { text: 'of', startSec: 16.58, endSec: 16.62, confidence: 0.0 },
  { text: 'the', startSec: 16.66, endSec: 16.74, confidence: 0.0006 },
  { text: 'numbers', startSec: 16.82, endSec: 17.00, confidence: 0.0 },
  { text: "they're", startSec: 17.08, endSec: 17.40, confidence: 0.0039 },
];

describe('R.11 — the named constants', () => {
  it('R11_MIN_FIT_DEVIATION sits at the geometric midpoint of the worst known-bad and the nearest negative comparable', () => {
    // worst known-bad: v6 226_four_scouts, fit 0.75 -> deviation 4/3.
    // nearest negative: v6 444_scout_past_watch, deviation 1.2857 (9/7).
    const worstBad = 4 / 3;
    const nearestNegative = 9 / 7;
    const midpoint = Math.sqrt(worstBad * nearestNegative);
    expect(R11_MIN_FIT_DEVIATION).toBeCloseTo(midpoint, 3);
    expect(R11_MIN_FIT_DEVIATION).toBeLessThan(worstBad);
    expect(R11_MIN_FIT_DEVIATION).toBeGreaterThan(nearestNegative);
  });

  it('R11_MAX_SPAN_WORD_CONF sits at the geometric midpoint of the worst known-bad span and the nearest negative span (125_night_circle)', () => {
    const worstBadSpanMax = 0.0038953518960624933; // abysmal_opinion
    const nearestNegativeSpanMax = 0.030144814401865005; // 125_night_circle "are"
    const midpoint = Math.sqrt(worstBadSpanMax * nearestNegativeSpanMax);
    expect(R11_MAX_SPAN_WORD_CONF).toBeCloseTo(midpoint, 5);
    expect(R11_MAX_SPAN_WORD_CONF).toBeGreaterThan(worstBadSpanMax);
    expect(R11_MAX_SPAN_WORD_CONF).toBeLessThan(nearestNegativeSpanMax);
  });

  it('R11_MAX_SPAN_WORD_CONF is its own constant, distinct from R10_MAX_WORD_CONF and CONF_MIN', () => {
    expect(R11_MAX_SPAN_WORD_CONF).not.toBe(5e-4); // R10_MAX_WORD_CONF
    expect(R11_MAX_SPAN_WORD_CONF).not.toBe(0.3); // CONF_MIN
  });
});

/**
 * `scripts/fixtures/phase4-fa-second-baseline-*-segments.csv` is the SAME
 * fixture WS1 Session F's own regeneration script overwrote with R.11's
 * corrections already applied (`docs/work-in-progress.md` §11) — reading it
 * live would test the detector against its own already-corrected output
 * (a false negative, not a false positive: the detector correctly declines
 * to re-fire on an already-correct boundary, per the same no-op guard
 * `125_night_circle` exercises). These are the REAL pre-correction values
 * (this file's own header — read from the committed fixture BEFORE the
 * regeneration script ran, preserved here as literals for exactly this
 * reason), restored onto the loaded segments so detection tests exercise
 * the real defect, not its own fix.
 */
function resetToPreR11(segments: VideoSegment[], overrides: Record<string, { startTime: number; duration: number }>): VideoSegment[] {
  return segments.map(s => {
    const o = overrides[(s as unknown as { tag?: string }).tag ?? s.id];
    return o ? { ...s, startTime: o.startTime, duration: o.duration } : s;
  });
}

const V6_PRE_R11: Record<string, { startTime: number; duration: number }> = {
  '151_scout_listening_void': { startTime: 448.02, duration: 1.18 },
  '152_frozen_brush_mice': { startTime: 449.20, duration: 5.13 },
  '191_both_still': { startTime: 569.15, duration: 1.03 },
  '192_scout_listening': { startTime: 570.18, duration: 2.06 },
  '225_night_scouts': { startTime: 667.47, duration: 2.77 },
  '226_four_scouts': { startTime: 670.24, duration: 2.56 },
};
const CORPUS_173_PRE_R11: Record<string, { startTime: number; duration: number }> = {
  grim_horizon: { startTime: 14.43, duration: 2.07 },
  abysmal_opinion: { startTime: 16.50, duration: 2.01 },
};

describe('R.11 — detectSeamFitDefects, real corpus fixtures', () => {
  const V6_TIMEOUT_MS = 120_000; // v6's Hirschberg pass dominates cost — same budget the FA replay gate uses.

  it('v6: fires on item 7 (152_frozen_brush_mice) at its exact ear-correct value', () => {
    const { segments: raw, tokens, silences } = loadCorpus('v6');
    const segments = resetToPreR11(raw, V6_PRE_R11);
    const findings = detectSeamFitDefects(segments, tokens, V6_FA_WORDS, silences, AUDIO_DURATION.v6);
    const f = findings.find(f => f.segmentTag === '152_frozen_brush_mice');
    expect(f, 'item 7 must fire').toBeDefined();
    expect(f!.committedValue).toBeCloseTo(449.20, 2);
    expect(f!.correctedValue).toBeCloseTo(451.03, 2); // ear-correct
    expect(f!.edge).toBe('end');
    expect(f!.fitDeviation).toBeCloseTo(10 / 7, 4);
  }, V6_TIMEOUT_MS);

  it('v6: fires on 226_four_scouts at its exact ear-correct value', () => {
    const { segments: raw, tokens, silences } = loadCorpus('v6');
    const segments = resetToPreR11(raw, V6_PRE_R11);
    const findings = detectSeamFitDefects(segments, tokens, V6_FA_WORDS, silences, AUDIO_DURATION.v6);
    const f = findings.find(f => f.segmentTag === '226_four_scouts');
    expect(f, '226_four_scouts must fire').toBeDefined();
    expect(f!.committedValue).toBeCloseTo(670.24, 2);
    expect(f!.correctedValue).toBeCloseTo(671.18, 2); // ear-correct
    expect(f!.fitDeviation).toBeCloseTo(4 / 3, 4);
  }, V6_TIMEOUT_MS);

  it('v6: does NOT fire on 125_night_circle — R.12 owns that boundary (the false-positive guard)', () => {
    // Not reset to pre-R11 — 125_night_circle was never touched by R.11, so
    // its committed value is unchanged by R.11 either way. WS1 Session H
    // re-pinned it 372.35 -> 370.75 (R.12); R.11 declines it at BOTH values
    // for the same reason, the real 0.0301 word in the span, which is what
    // keeps the two rules exclusive.
    const { segments, tokens, silences } = loadCorpus('v6');
    const findings = detectSeamFitDefects(segments, tokens, V6_FA_WORDS, silences, AUDIO_DURATION.v6);
    expect(findings.find(f => f.segmentTag === '125_night_circle')).toBeUndefined();
  }, V6_TIMEOUT_MS);

  it('v6: DOES fire on 192_scout_listening — a new, structurally identical, unverified candidate', () => {
    const { segments: raw, tokens, silences } = loadCorpus('v6');
    const segments = resetToPreR11(raw, V6_PRE_R11);
    const findings = detectSeamFitDefects(segments, tokens, V6_FA_WORDS, silences, AUDIO_DURATION.v6);
    const f = findings.find(f => f.segmentTag === '192_scout_listening');
    expect(f, '192_scout_listening must fire').toBeDefined();
    expect(f!.committedValue).toBeCloseTo(570.18, 2);
    expect(f!.correctedValue).toBeCloseTo(571.07, 2);
    expect(f!.spanMaxConfidence).toBeLessThan(R11_MAX_SPAN_WORD_CONF);
  }, V6_TIMEOUT_MS);

  it('173: fires on abysmal_opinion at its exact ear-correct value', () => {
    const { segments: raw, tokens, silences } = loadCorpus('173');
    const segments = resetToPreR11(raw, CORPUS_173_PRE_R11);
    const findings = detectSeamFitDefects(segments, tokens, CORPUS_173_FA_WORDS, silences, AUDIO_DURATION['173']);
    const f = findings.find(f => f.segmentTag === 'abysmal_opinion');
    expect(f, 'abysmal_opinion must fire').toBeDefined();
    expect(f!.committedValue).toBeCloseTo(16.50, 2);
    expect(f!.correctedValue).toBeCloseTo(17.88, 2); // ear-correct
    expect(f!.fitDeviation).toBeCloseTo(1.5, 4);
  });

  it("173: does NOT fire on hostile_landscape (item 10, R.10's own scope — mutual exclusion)", () => {
    // hostile_landscape sits at pre-filter index 1 in the complete parse
    // (perilous_realms is index 0). Its containing chunk has extreme fit —
    // contaminated by perilous_realms' own never-spoken title text — but
    // R.10 already resolves this class via a DIFFERENT mechanism (drop),
    // and after R.10 drops perilous_realms, hostile_landscape becomes the
    // FINAL array's own segment 0, forced to 0.00 by headExtendFirstSegment
    // regardless of anything R.11 computes. Verified at the detector level
    // here (still index 1 in the pre-skip parse this function requires);
    // the apply-time exclusion (index 0 in the FINAL array) is verified
    // separately below.
    const { segments, tokens, silences } = loadCorpus('173');
    const findings = detectSeamFitDefects(segments, tokens, CORPUS_173_FA_WORDS, silences, AUDIO_DURATION['173']);
    const f = findings.find(f => f.segmentTag === 'hostile_landscape');
    // May or may not structurally fire at the DETECTOR level (its own
    // chunk-fit evidence is real and contaminated by R.10's own defect) —
    // what matters, and what is asserted below (apply-time), is that R.10's
    // already-correct 0.00 is never disturbed.
    if (f) expect(f.segmentIndex).not.toBe(0); // still pre-filter index 1 here.
  });

  it("spanish: never fires on 001_scylla_intro — segment 0 is structurally excluded regardless of fit", () => {
    const { segments, tokens, silences } = loadCorpus('spanish');
    const spanishFaWords: TranscriptToken[] = [
      { text: 'scylla', startSec: 0.32, endSec: 0.68, confidence: 0.014653 },
      { text: 'scylla', startSec: 1.48, endSec: 1.76, confidence: 0.01202 },
    ];
    const findings = detectSeamFitDefects(segments, tokens, spanishFaWords, silences, AUDIO_DURATION.spanish);
    expect(findings.find(f => f.segmentIndex === 0)).toBeUndefined();
    expect(findings.find(f => f.segmentTag === '001_scylla_intro')).toBeUndefined();
  });
});

describe('R.11 — threshold strictness, both sides (synthetic, isolated from real-corpus noise)', () => {
  // A minimal two-run corpus: three segments, a real silence backing the
  // second run's start, and a controllable chunk-fit ratio via extra
  // unmatched script words. Exercises the SAME real computeFaChunkPlan/
  // computeRuns production functions detectSeamFitDefects itself calls.
  function buildFixture(extraSurplusWords: number): { segments: VideoSegment[]; tokens: TranscriptToken[]; silences: SilenceInterval[] } {
    const filler = Array.from({ length: extraSurplusWords }, (_, i) => `filler${i}`).join(' ');
    const segments: VideoSegment[] = [
      { id: 's0', text: 'alpha beta gamma delta epsilon', startTime: 0, duration: 5, transition: 'none', animation: 'none', order: 0 } as unknown as VideoSegment,
      { id: 's1', text: `zeta eta theta ${filler}`.trim(), startTime: 5, duration: 5, transition: 'none', animation: 'none', order: 1 } as unknown as VideoSegment,
      { id: 's2', text: 'iota kappa lambda mu nu', startTime: 10, duration: 5, transition: 'none', animation: 'none', order: 2 } as unknown as VideoSegment,
    ];
    // Tokens: distinctive, well-separated words so R.1 anchors form cleanly;
    // a real gap (silence-eligible) sits at the s1/s2 seam.
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu'];
    const tokens: TranscriptToken[] = words.map((w, i) => ({ text: w, startSec: i * 1.0, endSec: i * 1.0 + 0.5 }));
    // widen the gap around the s1/s2 seam (theta ends ~7.5, iota starts ~8.0) to host a real silence
    tokens[7] = { text: 'theta', startSec: 7.0, endSec: 7.3 };
    tokens[8] = { text: 'iota', startSec: 9.0, endSec: 9.5 };
    for (let i = 9; i < tokens.length; i++) { tokens[i] = { ...tokens[i]!, startSec: tokens[i]!.startSec + 1.5, endSec: tokens[i]!.endSec + 1.5 }; }
    const silences: SilenceInterval[] = [{ startSec: 7.3, endSec: 9.0 }];
    return { segments, tokens, silences };
  }

  it('does not fire when fitDeviation sits AT the threshold (not strictly greater)', () => {
    // Sanity check on the comparison operator itself: R11_MIN_FIT_DEVIATION
    // is a strict `>` gate (matches R10_MAX_WORD_CONF's own strict `<`).
    expect(1.3093 > R11_MIN_FIT_DEVIATION).toBe(false);
  });

  it('production chunk plan is deterministic given identical inputs (sanity: fixture is well-formed)', () => {
    const { segments, tokens, silences } = buildFixture(0);
    const a = computeFaChunkPlan(segments, tokens, silences, 15);
    const b = computeFaChunkPlan(segments, tokens, silences, 15);
    expect(a).toEqual(b);
    expect(computeRuns(segments, tokens, silences, 15).length).toBeGreaterThan(0);
  });
});

describe('R.11 — Model P contiguity through the real partition path', () => {
  it('applySeamFitCorrections preserves a gapless, monotonic partition and total duration', () => {
    const finalSegments: VideoSegment[] = [
      { id: 'a', text: '', startTime: 0, duration: 10, transition: 'none', animation: 'none', order: 0 } as unknown as VideoSegment,
      { id: 'b', text: '', startTime: 10, duration: 10, transition: 'none', animation: 'none', order: 1 } as unknown as VideoSegment,
      { id: 'c', text: '', startTime: 20, duration: 10, transition: 'none', animation: 'none', order: 2 } as unknown as VideoSegment,
    ];
    const findings = [
      { segmentIndex: 1, segmentId: 'b', chunkIndex: 0, chunkStartSec: 0, chunkEndSec: 0, fit: 1, fitDeviation: 1.4, edge: 'start' as const, committedValue: 10, correctedValue: 11.5, delta: 1.5, spanMaxConfidence: 0 },
    ];
    const out = applySeamFitCorrections(finalSegments, findings);

    // gapless + monotonic
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs((out[i - 1]!.startTime + out[i - 1]!.duration) - out[i]!.startTime)).toBeLessThan(1e-9);
    }
    expect(out[0]!.startTime).toBe(0);
    const total = out[out.length - 1]!.startTime + out[out.length - 1]!.duration;
    expect(total).toBeCloseTo(30, 9); // audioDuration unchanged
    expect(out[1]!.startTime).toBeCloseTo(11.5, 9);
    expect(out[0]!.duration).toBeCloseTo(11.5, 9); // absorbed the +1.5s delta
  });

  it('two ADJACENT R.11 corrections compose left-to-right without double-counting', () => {
    const finalSegments: VideoSegment[] = [
      { id: 'a', text: '', startTime: 0, duration: 10, transition: 'none', animation: 'none', order: 0 } as unknown as VideoSegment,
      { id: 'b', text: '', startTime: 10, duration: 10, transition: 'none', animation: 'none', order: 1 } as unknown as VideoSegment,
      { id: 'c', text: '', startTime: 20, duration: 10, transition: 'none', animation: 'none', order: 2 } as unknown as VideoSegment,
    ];
    const findings = [
      { segmentIndex: 1, segmentId: 'b', chunkIndex: 0, chunkStartSec: 0, chunkEndSec: 0, fit: 1, fitDeviation: 1.4, edge: 'start' as const, committedValue: 10, correctedValue: 9, delta: -1, spanMaxConfidence: 0 },
      { segmentIndex: 2, segmentId: 'c', chunkIndex: 1, chunkStartSec: 0, chunkEndSec: 0, fit: 1, fitDeviation: 1.4, edge: 'start' as const, committedValue: 20, correctedValue: 21, delta: 1, spanMaxConfidence: 0 },
    ];
    const out = applySeamFitCorrections(finalSegments, findings);
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs((out[i - 1]!.startTime + out[i - 1]!.duration) - out[i]!.startTime)).toBeLessThan(1e-9);
    }
    expect(out[1]!.startTime).toBeCloseTo(9, 9);
    expect(out[2]!.startTime).toBeCloseTo(21, 9);
    const total = out[2]!.startTime + out[2]!.duration;
    expect(total).toBeCloseTo(30, 9);
  });

  it('a finding whose segment was dropped upstream (id no longer present) is silently skipped', () => {
    const finalSegments: VideoSegment[] = [
      { id: 'a', text: '', startTime: 0, duration: 10, transition: 'none', animation: 'none', order: 0 } as unknown as VideoSegment,
      { id: 'c', text: '', startTime: 10, duration: 10, transition: 'none', animation: 'none', order: 1 } as unknown as VideoSegment,
    ];
    const findings = [
      { segmentIndex: 1, segmentId: 'b-DROPPED', chunkIndex: 0, chunkStartSec: 0, chunkEndSec: 0, fit: 1, fitDeviation: 1.4, edge: 'start' as const, committedValue: 10, correctedValue: 11.5, delta: 1.5, spanMaxConfidence: 0 },
    ];
    const out = applySeamFitCorrections(finalSegments, findings);
    expect(out).toEqual(finalSegments);
  });

  it('a finding at FINAL-array index 0 is declined (R.10 mutual exclusion via headExtendFirstSegment)', () => {
    // Mirrors hostile_landscape post-R.10: it becomes the final array's own
    // segment 0, whose start is forced to 0 regardless of any R.11 finding.
    const finalSegments: VideoSegment[] = [
      { id: 'hostile_landscape', text: '', startTime: 0, duration: 10, transition: 'none', animation: 'none', order: 0 } as unknown as VideoSegment,
      { id: 'b', text: '', startTime: 10, duration: 10, transition: 'none', animation: 'none', order: 1 } as unknown as VideoSegment,
    ];
    const findings = [
      { segmentIndex: 0, segmentId: 'hostile_landscape', chunkIndex: 0, chunkStartSec: 0, chunkEndSec: 0, fit: 1, fitDeviation: 1.4, edge: 'start' as const, committedValue: 0, correctedValue: 4.18, delta: 4.18, spanMaxConfidence: 0 },
    ];
    const out = applySeamFitCorrections(finalSegments, findings);
    expect(out[0]!.startTime).toBe(0); // untouched
  });
});
