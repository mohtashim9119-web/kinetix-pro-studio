/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G4 Unit 4 — local pre-FA coverage check. OLD-BUG-FIRST: before this unit,
// nothing computed script/transcript word overlap at all — this whole module
// did not exist, so every "flags"/"pauses" case below is a signal that was
// simply unavailable until now.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  computeLocalPreFaCoverage,
  LOCAL_COVERAGE_MARGINAL_MAX,
  LOCAL_COVERAGE_HOPELESS_MAX,
} from './localFaCoverageGate';

function seg(text: string) {
  return { text };
}
function tok(text: string) {
  return { text };
}

describe('computeLocalPreFaCoverage', () => {
  it('OLD BUG: a completely unrelated script and transcript classify as hopeless (nothing caught this before G4 Unit 4)', () => {
    const r = computeLocalPreFaCoverage(
      [seg('zzxq wqvbf jklpx')],
      [tok('completely'), tok('unrelated'), tok('audio')],
    );
    expect(r.coverage).toBe(0);
    expect(r.band).toBe('hopeless');
    expect(r.scriptWordCount).toBe(3);
  });

  it('a perfectly matching script and transcript classify as ok, coverage 1.0', () => {
    const r = computeLocalPreFaCoverage(
      [seg('hello world')],
      [tok('hello'), tok('world')],
    );
    expect(r.coverage).toBe(1);
    expect(r.band).toBe('ok');
  });

  it('marginal band: 1 of 3 words matched (33%)', () => {
    const r = computeLocalPreFaCoverage(
      [seg('hello zzxq wqvbf')],
      [tok('hello'), tok('world')],
    );
    expect(r.coverage).toBeCloseTo(1 / 3, 5);
    expect(r.band).toBe('marginal');
  });

  it(`ok band boundary: coverage just above ${LOCAL_COVERAGE_MARGINAL_MAX} is ok, not marginal`, () => {
    // 3 of 5 words matched = 0.6, above the 0.5 marginal ceiling.
    const r = computeLocalPreFaCoverage(
      [seg('alpha bravo charlie zzxq wqvbf')],
      [tok('alpha'), tok('bravo'), tok('charlie')],
    );
    expect(r.coverage).toBeCloseTo(0.6, 5);
    expect(r.band).toBe('ok');
  });

  it(`hopeless band boundary: coverage strictly above ${LOCAL_COVERAGE_HOPELESS_MAX} is marginal, not hopeless`, () => {
    // 1 of 4 words matched = 0.25, above the 0.2 hopeless ceiling.
    const r = computeLocalPreFaCoverage(
      [seg('alpha zzxq wqvbf jklpx')],
      [tok('alpha')],
    );
    expect(r.coverage).toBeCloseTo(0.25, 5);
    expect(r.band).toBe('marginal');
  });

  it(`hopeless band is inclusive at exactly ${LOCAL_COVERAGE_HOPELESS_MAX}`, () => {
    // 1 of 5 words matched = 0.2, exactly at the hopeless ceiling.
    const r = computeLocalPreFaCoverage(
      [seg('alpha zzxq wqvbf jklpx mnop')],
      [tok('alpha')],
    );
    expect(r.coverage).toBeCloseTo(0.2, 5);
    expect(r.band).toBe('hopeless');
  });

  it('a bag intersection, not a naive set check: a script word repeated MORE times than the transcript has it is only credited as many times as the transcript actually has', () => {
    // Script says "hello" 3 times; transcript has it once. Bag intersection
    // credits 1 match, not 3 — a naive Set.has() check would wrongly credit
    // all 3 and report 100% coverage for a script that is mostly padding.
    const r = computeLocalPreFaCoverage(
      [seg('hello hello hello')],
      [tok('hello')],
    );
    expect(r.coverage).toBeCloseTo(1 / 3, 5);
  });

  it('an empty script has nothing to check — coverage 1, band ok (not a false hopeless alarm on an empty scene)', () => {
    const r = computeLocalPreFaCoverage([seg('')], [tok('anything')]);
    expect(r.coverage).toBe(1);
    expect(r.band).toBe('ok');
    expect(r.scriptWordCount).toBe(0);
  });

  it('multiple script segments are pooled into one whole-script word count', () => {
    const r = computeLocalPreFaCoverage(
      [seg('hello'), seg('world')],
      [tok('hello'), tok('world')],
    );
    expect(r.scriptWordCount).toBe(2);
    expect(r.coverage).toBe(1);
  });

  it('reuses the real alignment-grade canonicalizer, not a naive lowercase split — a contraction normalizes the same way on both sides', () => {
    // canonicalize expands "don't" -> ["do", "not"] (or similar) on BOTH the
    // script and transcript sides identically, so a raw-string mismatch
    // ("don't" vs "do not") does not register as a false miss.
    const r = computeLocalPreFaCoverage(
      [seg("don't stop")],
      [tok("don't"), tok('stop')],
    );
    expect(r.band).toBe('ok');
    expect(r.coverage).toBe(1);
  });

  it('is case-insensitive (both sides canonicalize through lowercase)', () => {
    const r = computeLocalPreFaCoverage([seg('HELLO WORLD')], [tok('hello'), tok('world')]);
    expect(r.coverage).toBe(1);
  });
});
