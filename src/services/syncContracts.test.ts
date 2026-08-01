// Pipeline Contract Program, Pair 1, Step 8 — injection tests for Contract
// 1→2's validator (syncContracts.ts). Per §3 Step 4: one deliberate-violation
// test per rule, a clean-case zero-violations test, and confirmation the
// validator never mutates its inputs (the "zero behavior change" guarantee).
import { describe, it, expect } from 'vitest';
import { analyzeDropDistribution, validateTokenOrdering, validate1to2, validateBoundaryQuality } from './syncContracts';
import type { TokenDrop, SegmentAlignment } from './whisperService';
import type { WaveformSource } from './waveformPeaks';
import type { SilenceInterval } from './silenceDetector';
import type { TranscriptToken, VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

function tok(startSec: number, endSec: number, text = 'word'): TranscriptToken {
  return { startSec, endSec, text };
}

function drop(index: number, reason: TokenDrop['reason'], startSec: number, endSec = startSec + 1, text = ''): TokenDrop {
  return { index, reason, startSec, endSec, text };
}

function seg(partial: Partial<VideoSegment> & { id: string; text: string; order: number }): VideoSegment {
  return {
    startTime: 0,
    duration: 1,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    ...partial,
  };
}

function align(firstTokenIdx: number, lastTokenIdx: number): SegmentAlignment {
  return {
    t0: 0, t1: 0, firstTokenIdx, lastTokenIdx,
    confidence: 1, matched: true, matchedWords: 2, totalWords: 2, longestRun: 2,
  };
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

describe('validateBoundaryQuality (Contract 5→6, waveform-watcher Phase 1)', () => {
  // Two covered segments: 'alpha bravo' spoken 0.0-1.0 (curr), 'charlie
  // delta' spoken 2.0-3.0 (next) — the same fixture shape
  // snapCoveredBoundaries's own test suite uses (syncTiming.test.ts). Search
  // window (computeBoundarySearchWindow): spokenMid 1.5, radius 0.9 ->
  // [0.6, 2.4].
  const tokens: TranscriptToken[] = [
    tok(0.0, 0.5, 'alpha'),
    tok(0.5, 1.0, 'bravo'),
    tok(2.0, 2.5, 'charlie'),
    tok(2.5, 3.0, 'delta'),
  ];
  const alignments: SegmentAlignment[] = [align(0, 1), align(2, 3)];

  function twoSegments(overrides: Partial<VideoSegment> = {}): VideoSegment[] {
    return [
      seg({ id: 's0', order: 0, text: 'alpha bravo', startTime: 0, duration: 2 }),
      seg({ id: 's1', order: 1, text: 'charlie delta', startTime: 2, duration: 3, ...overrides }),
    ];
  }

  // 30 columns at 10 peaks/sec = 3.0s of coverage — spans the whole search
  // window [0.6, 2.4] with room either side. Default 0.5 (moderately loud);
  // a genuine quiet dip at t=[0.8,1.0) (cols 8-9) and a loud spike exactly at
  // the committed boundary, t=2.0 (col 20).
  function makeWaveform(): WaveformSource {
    const peaks = new Float32Array(30).fill(0.5);
    peaks[8] = 0.05;
    peaks[9] = 0.05;
    peaks[20] = 0.9;
    return { peaks, peaksPerSecond: 10, totalDuration: 3 };
  }

  it('flags a fallback boundary that landed in loud audio, with correct detail fields', () => {
    const segments = twoSegments();
    const waveform = makeWaveform();

    const violations = validateBoundaryQuality(segments, alignments, tokens, [], waveform, 2, 0.2);

    expect(violations).toHaveLength(1);
    const v = violations[0]!;
    expect(v.contract).toBe('5->6');
    expect(v.rule).toBe('loud-fallback-boundary');
    expect(v.severity).toBe('warning');
    expect(v.message).not.toMatch(/firstTokenIdx|Hirschberg|token/i); // §6.3(c3) no-jargon rubric
    expect(v.fixHint.length).toBeGreaterThan(0);
    expect(v.detail).toMatchObject({
      segmentIndex: 0,
      boundaryTime: 2,
      boundaryAmplitude: expect.closeTo(0.9, 6),
      quietestAmplitude: expect.closeTo(0.05, 6),
      quietestTime: expect.closeTo(0.9, 6),
      windowStart: expect.closeTo(0.6, 6),
      windowEnd: expect.closeTo(2.4, 6),
    });
  });

  // Dual-gate calibration tests (2026-08-02) — the absolute-amplitude floor
  // and min-distance gate added alongside the K-ratio check. All three use a
  // finer 100 peaks/sec waveform (0.01s columns) so the quietest region's
  // distance from the boundary can be controlled precisely; the search
  // window is still [0.6, 2.4] from the shared `tokens`/`alignments` fixture
  // above, and every column used below falls inside it.
  it('does not fire below the absolute amplitude floor, even with a far, high-ratio quiet point', () => {
    const segments = twoSegments();
    const peaks = new Float32Array(300).fill(0.5);
    peaks[200] = 0.04; // boundary (t=2.0) — below the 0.05 floor
    for (let i = 80; i <= 84; i++) peaks[i] = 0.01; // quiet region, far away (~1.17s)

    const waveform: WaveformSource = { peaks, peaksPerSecond: 100, totalDuration: 3 };
    expect(validateBoundaryQuality(segments, alignments, tokens, [], waveform, 2, 0.05)).toEqual([]);
  });

  it('does not fire when the quietest point sits under the min-distance gate (0.05s away)', () => {
    const segments = twoSegments();
    const peaks = new Float32Array(300).fill(0.5);
    peaks[200] = 0.20; // boundary (t=2.0), clears the amplitude floor
    for (let i = 193; i <= 197; i++) peaks[i] = 0.02; // quiet region ~0.045s away

    const waveform: WaveformSource = { peaks, peaksPerSecond: 100, totalDuration: 3 };
    expect(validateBoundaryQuality(segments, alignments, tokens, [], waveform, 2, 0.05)).toEqual([]);
  });

  it('fires when the quietest point clears the min-distance gate (0.30s away)', () => {
    const segments = twoSegments();
    const peaks = new Float32Array(300).fill(0.5);
    peaks[200] = 0.20; // boundary (t=2.0), clears the amplitude floor
    for (let i = 168; i <= 172; i++) peaks[i] = 0.02; // quiet region ~0.30s away

    const waveform: WaveformSource = { peaks, peaksPerSecond: 100, totalDuration: 3 };
    const violations = validateBoundaryQuality(segments, alignments, tokens, [], waveform, 2, 0.05);
    expect(violations).toHaveLength(1);
  });

  it('does not fire when the boundary is silence-placed, regardless of how loud it is', () => {
    const segments = twoSegments();
    const waveform = makeWaveform();
    // A real silence spanning the pair's spoken gap — a genuine candidate
    // (mirrors snapCoveredBoundaries's own "places the boundary at the
    // midpoint" fixture) — so boundaryUsedFallback is false and the pair is
    // never even measured, however loud the actual committed boundary is.
    const silences: SilenceInterval[] = [{ startSec: 1.6, endSec: 1.9 }];

    expect(validateBoundaryQuality(segments, alignments, tokens, silences, waveform, 2, 0.2)).toEqual([]);
    expect(validateBoundaryQuality(segments, alignments, tokens, silences, waveform, 2, 0.2, 'report-all')).toEqual([]);
  });

  it('returns [] immediately when waveformSource is null, in both modes', () => {
    const segments = twoSegments();
    expect(validateBoundaryQuality(segments, alignments, tokens, [], null, 2, 0.2)).toEqual([]);
    expect(validateBoundaryQuality(segments, alignments, tokens, [], null, 2, 0.2, 'report-all')).toEqual([]);
  });

  it('skips a pair with either segment locked, mirroring snapCoveredBoundaries\' own guard', () => {
    const segments = twoSegments({ locked: true });
    const waveform = makeWaveform();
    expect(validateBoundaryQuality(segments, alignments, tokens, [], waveform, 2, 0.2, 'report-all')).toEqual([]);
  });

  it('report-all mode returns data for every fallback pair, flagged or not', () => {
    const segments = twoSegments();
    // A quiet, unremarkable waveform — the fallback boundary is not loud
    // relative to its surroundings, so it should NOT be flagged, but
    // report-all still returns its measurement (calibration needs the full
    // distribution, not just violations).
    const peaks = new Float32Array(30).fill(0.2);
    const waveform: WaveformSource = { peaks, peaksPerSecond: 10, totalDuration: 3 };

    const measurements = validateBoundaryQuality(segments, alignments, tokens, [], waveform, 2, 0.2, 'report-all');
    expect(measurements).toHaveLength(1);
    expect(measurements[0]!.flagged).toBe(false);
    expect(measurements[0]!.segmentIndex).toBe(0);

    // The default mode filters this same pair out entirely.
    expect(validateBoundaryQuality(segments, alignments, tokens, [], waveform, 2, 0.2)).toEqual([]);
  });

  it('never mutates its inputs (zero behavior change — committed segments are untouched)', () => {
    const segments = twoSegments();
    const waveform = makeWaveform();
    const segmentsCopy = segments.map(s => ({ ...s }));
    const alignmentsCopy = alignments.map(a => ({ ...a }));
    const tokensCopy = tokens.map(t => ({ ...t }));

    validateBoundaryQuality(segments, alignments, tokens, [], waveform, 2, 0.2);
    validateBoundaryQuality(segments, alignments, tokens, [], waveform, 2, 0.2, 'report-all');

    expect(segments).toEqual(segmentsCopy);
    expect(alignments).toEqual(alignmentsCopy);
    expect(tokens).toEqual(tokensCopy);
  });
});
