// Pipeline Contract Program, Pair 1, Step 8 — injection tests for Contract
// 1→2's validator (syncContracts.ts). Per §3 Step 4: one deliberate-violation
// test per rule, a clean-case zero-violations test, and confirmation the
// validator never mutates its inputs (the "zero behavior change" guarantee).
import { describe, it, expect } from 'vitest';
import { analyzeDropDistribution, validateTokenOrdering, validate1to2 } from './syncContracts';
import type { TokenDrop } from './whisperService';
import type { TranscriptToken } from '../types';

function tok(startSec: number, endSec: number, text = 'word'): TranscriptToken {
  return { startSec, endSec, text };
}

function drop(index: number, reason: TokenDrop['reason'], startSec: number, endSec = startSec + 1, text = ''): TokenDrop {
  return { index, reason, startSec, endSec, text };
}

describe('analyzeDropDistribution (Contract 1→2, R1)', () => {
  it('flags a window holding more than 40% of drops', () => {
    const clustered = Array.from({ length: 10 }, (_, i) => drop(i, 'non-finite', 20 + i * 0.5));
    const drops = [...clustered, drop(10, 'empty-text', 0), drop(11, 'negative-start', 100)];

    const violations = analyzeDropDistribution(drops, 200, 150);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.contract).toBe('1->2');
    expect(violations[0]!.rule).toBe('drop-clustering');
    expect(violations[0]!.severity).toBe('warning');
    expect(violations[0]!.detail).toEqual({ windowStart: 20, windowEnd: 30, dropsInWindow: 10, totalDrops: 12 });
    expect(violations[0]!.fixHint).toContain('20s');
    expect(violations[0]!.fixHint).toContain('30s');
    expect(violations[0]!.fixHint.length).toBeGreaterThan(0);
  });

  it('returns no violation for drops scattered evenly across windows', () => {
    const drops = [
      drop(0, 'non-finite', 5),
      drop(1, 'non-finite', 15),
      drop(2, 'non-finite', 25),
      drop(3, 'non-finite', 35),
      drop(4, 'non-finite', 45),
    ];
    expect(analyzeDropDistribution(drops, 100, 60)).toEqual([]);
  });

  it('returns no violation for an empty drop list', () => {
    expect(analyzeDropDistribution([], 100, 60)).toEqual([]);
  });

  it('skips the clustering check below the minimum drop count, even at 100% concentration', () => {
    const drops = [
      drop(0, 'non-finite', 20),
      drop(1, 'non-finite', 21),
      drop(2, 'non-finite', 22),
      drop(3, 'non-finite', 23),
    ];
    expect(analyzeDropDistribution(drops, 50, 60)).toEqual([]);
  });

  it('skips the clustering check when audioDuration is unusable, even with heavy clustering', () => {
    const clustered = Array.from({ length: 10 }, (_, i) => drop(i, 'non-finite', 20 + i * 0.5));
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(analyzeDropDistribution(clustered, 50, bad)).toEqual([]);
    }
  });

  it('falls back to the nearest neighboring drop with a usable timestamp when a drop\'s own startSec is garbage', () => {
    // 10 of 12 drops share a real cluster around 20-25s; two of those ten
    // carry a non-finite startSec (the actual value a 'non-finite'-reason
    // drop has) — they should still bucket into the same window via their
    // nearest (by raw index) neighbor's real timestamp, not vanish from the
    // count or get bucketed elsewhere.
    const drops = [
      drop(0, 'non-finite', 20),
      drop(1, 'non-finite', NaN), // garbage — falls back to neighbor
      drop(2, 'non-finite', 21),
      drop(3, 'non-finite', 22),
      drop(4, 'non-finite', Infinity), // garbage — falls back to neighbor
      drop(5, 'non-finite', 23),
      drop(6, 'non-finite', 24),
      drop(7, 'non-finite', 24.5),
      drop(8, 'non-finite', 24.8),
      drop(9, 'non-finite', 24.9),
      drop(10, 'empty-text', 0),
      drop(11, 'negative-start', 100),
    ];

    const violations = analyzeDropDistribution(drops, 200, 150);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.detail).toEqual({ windowStart: 20, windowEnd: 30, dropsInWindow: 10, totalDrops: 12 });
  });

  it('falls back to proportional index/totalTokens placement when no drop has a usable timestamp', () => {
    // Every drop is garbage — no real timestamp anywhere to interpolate
    // from. The last-resort estimate (index/totalTokens * audioDuration)
    // still produces a coherent, low-index cluster near the start of the
    // (100-token, 100s) transcript.
    const drops = [
      drop(0, 'non-finite', NaN),
      drop(1, 'non-finite', NaN),
      drop(2, 'non-finite', NaN),
      drop(3, 'non-finite', NaN),
      drop(4, 'non-finite', NaN),
    ];
    const violations = analyzeDropDistribution(drops, 100, 100);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.detail).toMatchObject({ dropsInWindow: 5, totalDrops: 5 });
  });
});

describe('validateTokenOrdering (Contract 1→2, assumption 5)', () => {
  it('flags the first inversion and counts every inversion in the array', () => {
    const tokens = [tok(0, 1, 'a'), tok(2, 3, 'b'), tok(1.5, 2.5, 'c'), tok(4, 5, 'd')];
    const violations = validateTokenOrdering(tokens);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.contract).toBe('1->2');
    expect(violations[0]!.rule).toBe('token-ordering');
    expect(violations[0]!.severity).toBe('warning');
    expect(violations[0]!.detail).toEqual({ firstInversionIndex: 1, inversionCount: 1 });
    expect(violations[0]!.fixHint.length).toBeGreaterThan(0);
  });

  it('counts multiple inversions but still returns exactly one violation', () => {
    const tokens = [tok(0, 1), tok(5, 6), tok(1, 2), tok(2, 3), tok(0, 1)];
    // inversions: i=1 (5>1), i=3 (2>0) — two inversions
    const violations = validateTokenOrdering(tokens);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.detail).toEqual({ firstInversionIndex: 1, inversionCount: 2 });
  });

  it('returns no violation for an ascending array', () => {
    const tokens = [tok(0, 1), tok(1, 2), tok(2, 3), tok(3, 4)];
    expect(validateTokenOrdering(tokens)).toEqual([]);
  });

  it('returns no violation for empty or single-token arrays', () => {
    expect(validateTokenOrdering([])).toEqual([]);
    expect(validateTokenOrdering([tok(0, 1)])).toEqual([]);
  });
});

describe('validate1to2 (Contract 1→2 combined validator)', () => {
  it('combines both rules when both fire', () => {
    const clustered = Array.from({ length: 10 }, (_, i) => drop(i, 'non-finite', 20 + i * 0.5));
    const drops = [...clustered, drop(10, 'empty-text', 0), drop(11, 'negative-start', 100)];
    const tokens = [tok(0, 1), tok(5, 6), tok(1, 2)]; // one inversion

    const violations = validate1to2(tokens, drops, 200, 150);

    expect(violations).toHaveLength(2);
    expect(violations.map(v => v.rule).sort()).toEqual(['drop-clustering', 'token-ordering']);
  });

  it('returns an empty list for a clean run (ordered tokens, no drops)', () => {
    const tokens = [tok(0, 1), tok(1, 2), tok(2, 3)];
    expect(validate1to2(tokens, [], 3, 10)).toEqual([]);
  });

  it('returns an empty list for empty input', () => {
    expect(validate1to2([], [], 0, 0)).toEqual([]);
  });

  it('never mutates its inputs', () => {
    const tokens = [tok(0, 1), tok(5, 6), tok(1, 2)];
    const drops = [drop(0, 'non-finite', 20)];
    const tokensCopy = tokens.map(t => ({ ...t }));
    const dropsCopy = drops.map(d => ({ ...d }));

    validate1to2(tokens, drops, 10, 30);

    expect(tokens).toEqual(tokensCopy);
    expect(drops).toEqual(dropsCopy);
  });
});
