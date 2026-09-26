/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { MATCH_ETA_THRESHOLD_MS, estimateMatchMs, matchEtaMessage, matchEtaStageMessage } from './matchEta';

describe('estimateMatchMs (WS2 G2 completion, Unit 3)', () => {
  it('reproduces the measured samples closely (fitted model, not a lookup)', () => {
    // The fit is a single averaged k, so it will not reproduce either sample
    // exactly — but both samples individually implied k values within ~3%
    // of each other (3152.7/4500^2 vs 12242.2/9000^2), so the fitted
    // estimate at each sample point stays within a few percent of the
    // measured mean.
    const at4500 = estimateMatchMs(4500, 4500);
    const at9000 = estimateMatchMs(9000, 9000);
    expect(at4500).toBeGreaterThan(3152.7 * 0.95);
    expect(at4500).toBeLessThan(3152.7 * 1.05);
    expect(at9000).toBeGreaterThan(12242.2 * 0.95);
    expect(at9000).toBeLessThan(12242.2 * 1.05);
  });

  it('scales as O(n*m): doubling BOTH dimensions roughly quadruples the estimate', () => {
    const base = estimateMatchMs(1000, 1000);
    const doubled = estimateMatchMs(2000, 2000);
    expect(doubled / base).toBeCloseTo(4, 1);
  });

  it('generalizes to UNEQUAL query/subject counts (the common real case — script words vs. transcript words) as a true product, not an average', () => {
    const square = estimateMatchMs(3000, 3000);
    const rect = estimateMatchMs(1000, 9000); // same cell count (9,000,000)
    expect(rect).toBeCloseTo(square, 0);
  });

  it('returns 0 for a zero or negative word count on either side (no NaN/Infinity from an empty script or transcript)', () => {
    expect(estimateMatchMs(0, 500)).toBe(0);
    expect(estimateMatchMs(500, 0)).toBe(0);
    expect(estimateMatchMs(-1, 500)).toBe(0);
  });
});

describe('matchEtaStageMessage (WS2 G2 completion, Unit 3 — operator-approved, additive only)', () => {
  it('returns null (no status line) below the threshold — no behavior change for an ordinary small sync', () => {
    // A small project: a few hundred words each side, well under 2s.
    expect(matchEtaStageMessage(300, 300)).toBeNull();
  });

  it('returns the stage message once the estimate clears MATCH_ETA_THRESHOLD_MS', () => {
    // 4500x4500 estimates to ~3.15s, comfortably above the 2s threshold.
    const msg = matchEtaStageMessage(4500, 4500);
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/^Matching a long script — about \d+s\.$/);
  });

  it('is a hard boundary at exactly the threshold: an estimate at or below MATCH_ETA_THRESHOLD_MS never surfaces a message', () => {
    // Binary-search-ish: find a word count whose estimate sits just at/under
    // the threshold and confirm no message, then just over it and confirm one.
    let words = 100;
    while (estimateMatchMs(words, words) < MATCH_ETA_THRESHOLD_MS) words += 100;
    // `words` now estimates AT OR ABOVE the threshold; back off one step.
    const justUnder = words - 100;
    expect(estimateMatchMs(justUnder, justUnder)).toBeLessThan(MATCH_ETA_THRESHOLD_MS);
    expect(matchEtaStageMessage(justUnder, justUnder)).toBeNull();
    expect(matchEtaStageMessage(words, words)).not.toBeNull();
  });
});

describe('matchEtaMessage', () => {
  it('rounds to the nearest whole second and never reports 0s', () => {
    expect(matchEtaMessage(2001)).toBe('Matching a long script — about 2s.');
    expect(matchEtaMessage(2499)).toBe('Matching a long script — about 2s.');
    expect(matchEtaMessage(2500)).toBe('Matching a long script — about 3s.');
    expect(matchEtaMessage(400)).toBe('Matching a long script — about 1s.'); // never "about 0s"
  });
});
