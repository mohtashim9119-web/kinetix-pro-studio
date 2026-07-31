import { describe, it, expect, vi } from 'vitest';
import { applyAnchorBasedTiming, headExtendFirstSegment } from './syncEngine';
import {
  distributeSegmentTimes,
  alignScenestoTranscript,
  canonicalizeForAlignment,
  extractSegmentAlignments,
  alignQueryToSubject,
  classifyCoverage,
  computeCoverageSummary,
  countTranscriptWords,
  filterMalformedTokens,
  findConcatenatingMatches,
  computeLongestRunWithHoles,
  requiredRunLength,
  hasQualifyingRun,
  isLocallyClustered,
  buildOccArrayFromGlobalMatches,
} from './whisperService';
import type { SegmentAlignment, OccEntry } from './whisperService';
import {
  evaluateCoverageGate,
  filterToCoveredSegments,
  retileCoveredSegments,
  emptySceneDocAbortMessage,
  emptyTranscriptAbortMessage,
  EMPTY_SCENE_DOC_MESSAGE,
  EMPTY_TRANSCRIPT_MESSAGE,
  FULL_MISMATCH_MESSAGE,
} from '../App';
import {
  snapCoveredBoundaries,
  isBoundarySilenceCandidate,
  fillsTokenGapWithinSpan,
  isBreathSilence,
} from './snapBoundaries';
import {
  TOKEN_GAP_EPSILON_SEC,
  LOW_CONFIDENCE_RATIO,
  MALFORMED_TOKEN_DURATION_TOLERANCE_SEC,
  MIN_COVERED_RUN_LENGTH,
  NOISE_FLOOR_COVERAGE,
  TEMPORAL_TOLERANCE_MIN_SEC,
  TEMPORAL_TOLERANCE_MAX_SEC,
  MAX_CONCAT_TOKENS,
  MAX_CONCAT_GAP_SEC,
  BREATH_MAX_SPEECH_COVERAGE_RATIO,
  BREATH_TOKEN_OVERLAP_FLOOR_SEC,
  RUN_SURVIVAL_MAX_HOLE,
  RUN_SURVIVAL_MIN_RUN_SHORT,
  RUN_SURVIVAL_MIN_RUN_LONG,
  RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE,
  RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP,
} from './syncConstants';
import type { VideoSegment, TranscriptToken } from '../types';
import { TransitionType, AnimationType } from '../types';
import type { SilenceInterval } from './silenceDetector';

function makeSegment(partial: Partial<VideoSegment> & { id: string; text: string; order: number }): VideoSegment {
  return {
    startTime: 0,
    duration: 1,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    ...partial,
  };
}

function wordTokens(text: string, startAt: number, wordDurationSec: number): TranscriptToken[] {
  return text.split(' ').map((word, i) => ({
    text: word,
    startSec: Number((startAt + i * wordDurationSec).toFixed(3)),
    endSec: Number((startAt + (i + 1) * wordDurationSec).toFixed(3)),
  }));
}

// Mirrors the exact composition used on the cached-token path (App.tsx
// handleApplySyncFromFiles "Option C" + useWhisper.ts alignSegmentsFromCachedTranscript):
//   applyAnchorBasedTiming -> aligner -> distributeSegmentTimes -> applyAnchorBasedTiming
// This exact order was the subject of 4 bug-fix commits (d445d09, e3866d9,
// 5c8fe27, 1eb7738) around "click 1 vs click 2" timing divergence. Any change
// that alters the output below — intentionally or not — should fail this test.
// Content-only (Path B Phase 7): headings are a separate HeadingOverlay array
// with no timeline-duration participation, so this Σ-duration invariant is
// asserted purely over content segments — they must sum to exactly
// AUDIO_DURATION, with no applyHeadingTiming absorption step in between.
describe('cached-token sync pipeline (Apply Sync, Option C)', () => {
  it('produces stable timing for a fresh project synced against cached Whisper tokens', () => {
    const AUDIO_DURATION = 11.5;

    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'Welcome to our amazing product showcase', assetId: 'a1' }),
      makeSegment({ id: 's2', order: 1, text: 'It changes everything you thought you knew', assetId: 'a2' }),
      makeSegment({ id: 's3', order: 2, text: 'Get started today and see the difference', assetId: 'a3' }),
    ];

    // Whisper word timestamps: 0.4s lead-in silence before the first word,
    // a 0.6s pause between phrases, and 0.4s of trailing silence after
    // the last word (audio runs to 11.5s but the last word ends at 11.1s).
    const tokens: TranscriptToken[] = [
      ...wordTokens('Welcome to our amazing product showcase', 0.4, 0.5),
      ...wordTokens('It changes everything you thought you knew', 4.0, 0.5),
      ...wordTokens('Get started today and see the difference', 7.6, 0.5),
    ];

    const silences: SilenceInterval[] = [
      { startSec: 0, endSec: 0.4 },
      { startSec: 3.4, endSec: 4.0 },
      { startSec: 7.5, endSec: 7.6 },
    ];

    const anchorTimed = applyAnchorBasedTiming(segments, AUDIO_DURATION);
    const alignments = alignScenestoTranscript(anchorTimed, tokens, silences);
    const distributed = distributeSegmentTimes(anchorTimed, alignments, AUDIO_DURATION);
    const final = applyAnchorBasedTiming(distributed, AUDIO_DURATION);

    // Segment 0's raw Whisper t0 (0.4s lead-in silence) must be clamped to
    // anchor 0, and the last segment must absorb trailing silence out to
    // AUDIO_DURATION.
    expect(final.map(s => ({
      anchorStart: s.anchorStart, anchorSource: s.anchorSource, startTime: s.startTime, duration: s.duration,
    }))).toEqual([
      { anchorStart: 0, anchorSource: 'whisper', startTime: 0, duration: 3.7 },
      { anchorStart: 3.7, anchorSource: 'whisper', startTime: 3.7, duration: 3.85 },
      { anchorStart: 7.55, anchorSource: 'whisper', startTime: 7.55, duration: 3.95 },
    ]);

    // Σ-duration invariant: content segments sum to exactly AUDIO_DURATION —
    // headings own no timeline seconds and never participate in this sum.
    const totalDuration = final.reduce((sum, s) => sum + s.duration, 0);
    expect(totalDuration).toBeCloseTo(AUDIO_DURATION, 3);
  });
});

// ---------------------------------------------------------------------------
// Real 11→14 scene repro — the exact case that broke under carry-forward.
//
// Audio narration is unchanged between syncs. OLD scene file has 11 brackets;
// NEW has 14 (adds 002_age_24, 012_tape_deck, 014_pay_cash; rewords 006/007
// boundary). Under the deleted carry-forward merge loop, 012_tape_deck was
// squeezed to a ~0.13s sliver because its fresh estimate anchor sat between
// stale whisper anchors from the OLD sync. Clean-slate eliminates this by
// re-deriving every segment fresh from the audio.
//
// Token stream represents the full spoken narration (unchanged audio):
// 0.3s per word, 0.4s silence gaps between phrases.
// ---------------------------------------------------------------------------
describe('clean-slate re-sync (real 11→14 scene repro)', () => {
  const AUDIO_DURATION = 30.0;

  const tokens: TranscriptToken[] = [
    ...wordTokens('You are 24', 0.5, 0.3),
    ...wordTokens('The year is 2003', 1.8, 0.3),
    ...wordTokens('You have in your savings account $11,000', 3.4, 0.3),
    ...wordTokens('You need a car', 5.9, 0.3),
    ...wordTokens('You go to a used lot on a Saturday in April', 7.5, 0.3),
    ...wordTokens('The salesman walks you to a', 11.2, 0.3),
    ...wordTokens('2001 Honda Civic with $84,000 on it', 13.4, 0.3),
    ...wordTokens('The Civic is technically gray', 15.9, 0.3),
    ...wordTokens('The Civic has cloth seats', 17.8, 0.3),
    ...wordTokens('The Civic has a tape deck', 19.7, 0.3),
    ...wordTokens('that the salesman tells you also plays CDs through an adapter', 21.9, 0.3),
    ...wordTokens('You pay $9,400 in cash', 25.6, 0.3),
    ...wordTokens('You drive the Civic home', 27.5, 0.3),
  ];

  const silences: SilenceInterval[] = [
    { startSec: 0, endSec: 0.5 },
    { startSec: 1.4, endSec: 1.8 },
    { startSec: 3.0, endSec: 3.4 },
    { startSec: 5.5, endSec: 5.9 },
    { startSec: 7.1, endSec: 7.5 },
    { startSec: 10.8, endSec: 11.2 },
    { startSec: 13.0, endSec: 13.4 },
    { startSec: 15.5, endSec: 15.9 },
    { startSec: 17.4, endSec: 17.8 },
    { startSec: 19.3, endSec: 19.7 },
    { startSec: 21.5, endSec: 21.9 },
    { startSec: 25.2, endSec: 25.6 },
    { startSec: 27.1, endSec: 27.5 },
    { startSec: 29.0, endSec: 30.0 },
  ];

  function addEstimateAnchors(segments: VideoSegment[]): VideoSegment[] {
    const totalText = segments.reduce((sum, s) => sum + Math.max(1, s.text.length), 0);
    let cursor = 0;
    return segments.map(s => {
      const anchor = Number(cursor.toFixed(3));
      const weight = Math.max(1, s.text.length) / totalText;
      cursor += weight * AUDIO_DURATION;
      return { ...s, anchorStart: anchor, anchorSource: 'estimate' as const };
    });
  }

  function runCleanSlatePipeline(segments: VideoSegment[], debug = false): VideoSegment[] {
    const anchored = addEstimateAnchors(segments);
    const anchorTimed = applyAnchorBasedTiming(anchored, AUDIO_DURATION);
    const alignments = alignScenestoTranscript(anchorTimed, tokens, silences);
    if (debug) {
      console.log('ALIGNMENTS:');
      for (let i = 0; i < alignments.length; i++) {
        const a = alignments[i]!;
        console.log(`  [${i}] t0=${a.t0} t1=${a.t1}`);
      }
    }
    const distributed = distributeSegmentTimes(anchorTimed, alignments, AUDIO_DURATION);
    if (debug) {
      console.log('AFTER distributeSegmentTimes:');
      for (const s of distributed) {
        console.log(`  ${s.id} anchor=${s.anchorStart} src=${s.anchorSource} start=${s.startTime} dur=${s.duration}`);
      }
    }
    return applyAnchorBasedTiming(distributed, AUDIO_DURATION);
  }

  const oldScenes = [
    makeSegment({ id: 'o0', order: 0, text: 'The year is 2003.', assetId: '003' }),
    makeSegment({ id: 'o1', order: 1, text: 'You have in your savings account $11,000.', assetId: '004' }),
    makeSegment({ id: 'o2', order: 2, text: 'You need a car.', assetId: '005' }),
    makeSegment({ id: 'o3', order: 3, text: 'You go to a used lot on a', assetId: '006' }),
    makeSegment({ id: 'o4', order: 4, text: 'Saturday in April.', assetId: '007' }),
    makeSegment({ id: 'o5', order: 5, text: 'The salesman walks you to a', assetId: '008' }),
    makeSegment({ id: 'o6', order: 6, text: '2001 Honda Civic with $84,000 on it.', assetId: '009' }),
    makeSegment({ id: 'o7', order: 7, text: 'The Civic is technically gray.', assetId: '010' }),
    makeSegment({ id: 'o8', order: 8, text: 'The Civic has cloth seats.', assetId: '011' }),
    makeSegment({ id: 'o9', order: 9, text: 'that the salesman tells you also plays CDs through an adapter.', assetId: '013' }),
    makeSegment({ id: 'o10', order: 10, text: 'You drive the Civic home.', assetId: '015' }),
  ];

  const newScenes = [
    makeSegment({ id: 'n0', order: 0, text: 'You are 24.', assetId: '002' }),
    makeSegment({ id: 'n1', order: 1, text: 'The year is 2003.', assetId: '003' }),
    makeSegment({ id: 'n2', order: 2, text: 'You have in your savings account $11,000.', assetId: '004' }),
    makeSegment({ id: 'n3', order: 3, text: 'You need a car.', assetId: '005' }),
    makeSegment({ id: 'n4', order: 4, text: 'You go to a used lot', assetId: '006' }),
    makeSegment({ id: 'n5', order: 5, text: 'on a Saturday in April.', assetId: '007' }),
    makeSegment({ id: 'n6', order: 6, text: 'The salesman walks you to a', assetId: '008' }),
    makeSegment({ id: 'n7', order: 7, text: '2001 Honda Civic with $84,000 on it.', assetId: '009' }),
    makeSegment({ id: 'n8', order: 8, text: 'The Civic is technically gray.', assetId: '010' }),
    makeSegment({ id: 'n9', order: 9, text: 'The Civic has cloth seats.', assetId: '011' }),
    makeSegment({ id: 'n10', order: 10, text: 'The Civic has a tape deck', assetId: '012' }),
    makeSegment({ id: 'n11', order: 11, text: 'that the salesman tells you also plays CDs through an adapter.', assetId: '013' }),
    makeSegment({ id: 'n12', order: 12, text: 'You pay $9,400 in cash.', assetId: '014' }),
    makeSegment({ id: 'n13', order: 13, text: 'You drive the Civic home.', assetId: '015' }),
  ];

  it('14 NEW scenes synced fresh — contiguous, sliver-free, correct tape-deck placement', () => {
    const final = runCleanSlatePipeline(newScenes);

    for (let i = 1; i < final.length; i++) {
      expect(final[i]!.startTime).toBeCloseTo(
        final[i - 1]!.startTime + final[i - 1]!.duration, 2,
      );
    }

    for (const seg of final) {
      expect(seg.duration).toBeGreaterThanOrEqual(0.3);
    }

    const total = final.reduce((sum, s) => sum + s.duration, 0);
    expect(total).toBeCloseTo(AUDIO_DURATION, 2);

    expect(final[0]!.startTime).toBe(0);
    for (let i = 1; i < final.length; i++) {
      expect(final[i]!.startTime).toBeGreaterThanOrEqual(final[i - 1]!.startTime);
    }

    for (const seg of final) {
      expect(seg.anchorSource).toBe('whisper');
    }

    const tapeDeck = final.find(s => s.id === 'n10')!;
    const clothSeats = final.find(s => s.id === 'n9')!;
    const cdAdapter = final.find(s => s.id === 'n11')!;
    expect(tapeDeck.duration).toBeGreaterThan(0.5);
    expect(tapeDeck.startTime).toBeGreaterThan(clothSeats.startTime);
    expect(tapeDeck.startTime).toBeLessThan(cdAdapter.startTime);
  });

  it('11 OLD scenes synced fresh — contiguous, no slivers', () => {
    const final = runCleanSlatePipeline(oldScenes, true);
    console.log('OLD pipeline output:');
    for (const s of final) {
      console.log(`  ${s.id} asset=${s.assetId} start=${s.startTime} dur=${s.duration} anchor=${s.anchorStart} src=${s.anchorSource} text="${s.text.slice(0,30)}"`);
    }

    for (let i = 1; i < final.length; i++) {
      expect(final[i]!.startTime).toBeCloseTo(
        final[i - 1]!.startTime + final[i - 1]!.duration, 2,
      );
    }

    for (const seg of final) {
      expect(seg.duration).toBeGreaterThanOrEqual(0.3);
    }

    const total = final.reduce((sum, s) => sum + s.duration, 0);
    expect(total).toBeCloseTo(AUDIO_DURATION, 2);

    expect(final[0]!.startTime).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Synthetic stale-anchor-squeeze demonstration — deliberately decoupled from
// the Civic narration above (different made-up text, different token data).
//
// The real merge loop that used to carry old whisper anchors forward across
// re-sync was deleted in clean-slate step 3a, so it can no longer be run
// directly to prove "before vs after." Instead this proves the mechanism
// itself: applyAnchorBasedTiming (still the shared production function,
// untouched by 3a) computes a segment's duration purely as
// next-segment-anchor minus this-segment-anchor. Feed it a newly-inserted
// segment's fresh estimate sitting right next to an old neighbor's UNCHANGED
// ("stale") anchor, and the squeeze happens mechanically — regardless of
// which code path produced that input shape. Clean-slate avoids this only
// because it never feeds applyAnchorBasedTiming a mix of stale and fresh
// anchors in the first place — every anchor is re-derived from the same
// audio pass together.
// ---------------------------------------------------------------------------
describe('clean-slate prevents the stale-anchor-meets-fresh-estimate squeeze (synthetic)', () => {
  const AUDIO_DURATION = 12;

  // One word per second, zero silences, zero gaps between phrases — kept
  // deliberately simple since this test is about anchor provenance, not
  // about the silence-snapping logic exercised by the Civic repro above.
  const tokens: TranscriptToken[] = [
    ...wordTokens('One two three', 0, 1),
    ...wordTokens('Four five six', 3, 1),
    ...wordTokens('Seven', 6, 1),
    ...wordTokens('Eight nine ten eleven twelve', 7, 1),
  ];

  // D ("Seven") is the newly-inserted bracket, landing between B and C.
  const newScenes: VideoSegment[] = [
    makeSegment({ id: 'a', order: 0, text: 'One two three', assetId: 'A' }),
    makeSegment({ id: 'b', order: 1, text: 'Four five six', assetId: 'B' }),
    makeSegment({ id: 'd', order: 2, text: 'Seven', assetId: 'D' }),
    makeSegment({ id: 'c', order: 3, text: 'Eight nine ten eleven twelve', assetId: 'C' }),
  ];

  it('clean-slate: D gets its real ~1s slot when every anchor is re-derived together', () => {
    const seeded = newScenes.map((s, i) => ({ ...s, anchorStart: i * 3, anchorSource: 'estimate' as const }));
    const anchorTimed = applyAnchorBasedTiming(seeded, AUDIO_DURATION);
    const alignments = alignScenestoTranscript(anchorTimed, tokens, []);
    const distributed = distributeSegmentTimes(anchorTimed, alignments, AUDIO_DURATION);
    const final = applyAnchorBasedTiming(distributed, AUDIO_DURATION);

    const d = final.find(s => s.assetId === 'D')!;
    expect(d.startTime).toBeCloseTo(6, 1);
    expect(d.duration).toBeGreaterThan(0.5);
  });

  it('stale carry-forward: D gets squeezed below 0.5s when C keeps its pre-insertion anchor', () => {
    // A and B are unaffected by the insertion, so a carry-forward merge loop
    // would leave their whisper anchors untouched — exactly as clean-slate
    // would also (correctly) re-derive them to the same values.
    // C is the bug: before D existed, C sat directly after B at anchor 6.
    // A carry-forward loop never re-checks C once it already has a whisper
    // anchor, so it stays at 6 even though D now needs room before it.
    // D is brand new, so it gets *some* fresh estimate — 5.7 here stands in
    // for whatever a global, neighbor-blind proportional estimate produces;
    // the only thing that matters for this test is that it lands close to
    // C's stale anchor, which a neighbor-blind estimate has no way to avoid.
    const staleCarryForward: VideoSegment[] = [
      { ...newScenes[0]!, anchorStart: 0,   anchorSource: 'whisper' },
      { ...newScenes[1]!, anchorStart: 3,   anchorSource: 'whisper' },
      { ...newScenes[2]!, anchorStart: 5.7, anchorSource: 'estimate' },
      { ...newScenes[3]!, anchorStart: 6,   anchorSource: 'whisper' },
    ];

    const staleResult = applyAnchorBasedTiming(staleCarryForward, AUDIO_DURATION);
    const d = staleResult.find(s => s.assetId === 'D')!;
    expect(d.duration).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Legacy-project regression: a project saved before anchorStart/anchorSource
// existed (pre-2026-06-18) loads with anchorStart === undefined on every
// segment, even though startTime/duration are real, already-synced values.
// PASS 2 used to paper over this by manufacturing a fresh character-weight
// anchorStart for every such segment; it was deleted in step 3d-2 now that
// PASS 3 falls back to a segment's own startTime instead of 0/audioDuration
// (step 3d-1, commit eb7fc8e). This test guards that fallback directly:
// without it, every segment here collapses toward the timeline origin
// (anchorStart ?? 0); with it, the original sequential layout survives.
// ---------------------------------------------------------------------------
describe('legacy project — anchorStart undefined on every segment (pre-6/18 save)', () => {
  it('preserves original sequential startTime/duration via the PASS 3 startTime fallback', () => {
    const AUDIO_DURATION = 12;
    const segments: VideoSegment[] = [
      makeSegment({ id: 'l0', order: 0, text: 'Welcome to our amazing product showcase', assetId: 'a1', startTime: 0, duration: 4 }),
      makeSegment({ id: 'l1', order: 1, text: 'It changes everything you knew', assetId: 'a2', startTime: 4, duration: 4 }),
      makeSegment({ id: 'l2', order: 2, text: 'Get started today', assetId: 'a3', startTime: 8, duration: 4 }),
    ];

    expect(segments.every(s => s.anchorStart === undefined)).toBe(true);

    const result = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    // No collapse to the origin — each segment keeps its own startTime.
    expect(result[0]!.startTime).toBe(0);
    expect(result[1]!.startTime).toBe(4);
    expect(result[2]!.startTime).toBe(8);

    // Sequential and non-overlapping: each starts exactly where the last ends.
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.startTime).toBeCloseTo(
        result[i - 1]!.startTime + result[i - 1]!.duration, 3,
      );
    }

    // Durations roughly match the original saved values (4s each).
    for (const seg of result) {
      expect(seg.duration).toBeCloseTo(4, 1);
    }

    const total = result.reduce((sum, s) => sum + s.duration, 0);
    expect(total).toBeCloseTo(AUDIO_DURATION, 3);
  });
});

// ---------------------------------------------------------------------------
// D16 — script↔Whisper token-count mismatch (numbers/contractions/symbols)
// desyncs the monotonic alignment cursor, cascading segment-timing drift.
//
// Part A: symmetric canonicalization (canonicalizeForAlignment), so a
// spelled-out number in the script and Whisper's digit output collapse to the
// same word sequence. Part C: a confidence guard that refuses to advance the
// cursor on a bad match, containing any residual (uncanonicalized) mismatch.
// ---------------------------------------------------------------------------
describe('D16 — canonicalization equivalence (Part A)', () => {
  const eq = (a: string, b: string) =>
    expect(canonicalizeForAlignment(a)).toEqual(canonicalizeForAlignment(b));

  it('spelled number ↔ digits: "thirty seven" === "37" (and hyphenated)', () => {
    expect(canonicalizeForAlignment('37')).toEqual(['thirty', 'seven']);
    eq('thirty seven', '37');
    eq('thirty-seven', '37');
    eq('thirty-seven', 'thirty seven');
  });

  it('single digit ↔ word, both directions: "5" === "five"', () => {
    expect(canonicalizeForAlignment('5')).toEqual(['five']);
    eq('5', 'five');
    eq('five', '5');
  });

  it('year: "2024" === "twenty twenty four" (pair reading, documented choice)', () => {
    expect(canonicalizeForAlignment('2024')).toEqual(['twenty', 'twenty', 'four']);
    eq('2024', 'twenty twenty four');
    // 2000–2009 fall back to cardinal ("two thousand three"), not pair form.
    expect(canonicalizeForAlignment('2003')).toEqual(['two', 'thousand', 'three']);
    eq('2003', 'two thousand three');
  });

  it('contraction ↔ expansion, both directions: "don\'t" === "do not"', () => {
    expect(canonicalizeForAlignment("don't")).toEqual(['do', 'not']);
    eq("don't", 'do not');
    eq('do not', "don't");
    // No stray "t"/"don" fragments (the pre-fix failure mode).
    expect(canonicalizeForAlignment("don't")).not.toContain('t');
    // Curly apostrophe folds identically.
    eq('don’t', 'do not');
    eq("it's", 'it is');
    eq("can't", 'cannot');
  });

  it('symbols: "%" === "percent", "&" === "and", "$5" === "5 dollars"', () => {
    eq('50%', 'fifty percent');
    expect(canonicalizeForAlignment('50%')).toEqual(['fifty', 'percent']);
    eq('r&d', 'r and d');
    eq('$5', '5 dollars');
    expect(canonicalizeForAlignment('$5')).toEqual(['five', 'dollars']);
    eq('@', 'at');
  });

  it('simple decimal: "3.5" === "three point five"', () => {
    expect(canonicalizeForAlignment('3.5')).toEqual(['three', 'point', 'five']);
    eq('3.5', 'three point five');
  });

  // 2026-07-08 — mixed alnum token (whisper.cpp -ml 1 can glue a short function
  // word onto a following number with no space, e.g. "to97%"). The percent-symbol
  // already splits off ("to97%" -> tokens ["to97", "percent"]), but "to97" failed
  // the whole-token /^\d+$/ digit check, so the number never expanded and the
  // spelled-out script side ("to ninety seven percent") could not match. The
  // embedded-digit-run split fixes exactly this, symmetrically on both sides.
  it('mixed alnum token: glued "to97%" === spelled "to ninety seven percent"', () => {
    expect(canonicalizeForAlignment('to97%')).toEqual(['to', 'ninety', 'seven', 'percent']);
    eq('to97%', 'to ninety seven percent');
    // Works for any glued function word whisper.cpp might emit, not just "to".
    expect(canonicalizeForAlignment('at97')).toEqual(['at', 'ninety', 'seven']);
    eq('was2024', 'was twenty twenty four');
    // Multiple embedded runs, left-to-right order preserved.
    expect(canonicalizeForAlignment('a1b2')).toEqual(['a', 'one', 'b', 'two']);
    // NEGATIVE / no-regression: tokens that already worked are byte-identical.
    // Pure digit tokens, pure alpha tokens, and symbol-attached digit tokens
    // (the "97%" case that already passed) must be untouched by the new branch.
    expect(canonicalizeForAlignment('97')).toEqual(['ninety', 'seven']);
    expect(canonicalizeForAlignment('97%')).toEqual(['ninety', 'seven', 'percent']);
    expect(canonicalizeForAlignment('hello')).toEqual(['hello']);
    expect(canonicalizeForAlignment('ninety seven percent')).toEqual(['ninety', 'seven', 'percent']);
  });
});

describe('D16 — alignment robustness (Parts A + C)', () => {
  // Assigns each segment its aligned t0. Tokens carry per-phrase timestamps
  // ~3s apart, so a segment drifted by a full phrase (or stranded at 0) lands
  // clearly outside its true-boundary band. NOTE: the aligner's gap-fill pass
  // midpoints each boundary between the two spoken phrases, so the EXPECTED t0
  // of segment N is roughly the midpoint of the silence before phrase N — not
  // that phrase's raw first-word timestamp. Assertions use boundary bands, not
  // exact starts, to stay robust to that midpointing while still excluding the
  // drift outcome (a full ~3s offset or a collapse toward 0).
  function alignT0s(segments: VideoSegment[], tokens: TranscriptToken[]): number[] {
    return alignScenestoTranscript(segments, tokens, []).map(a => a.t0);
  }

  it('REGRESSION: script "thirty seven" aligns to Whisper "37"; next segment does NOT drift', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'the answer is thirty seven' }),
      makeSegment({ id: 's1', order: 1, text: 'then we continue onward here' }),
      makeSegment({ id: 's2', order: 2, text: 'final closing statement now please' }),
    ];
    // Whisper emits the number as a digit token "37".
    const tokens: TranscriptToken[] = [
      ...wordTokens('the answer is 37', 0.0, 0.5),                 // 0.0 → 2.0
      ...wordTokens('then we continue onward here', 3.0, 0.5),     // 3.0 → 5.5
      ...wordTokens('final closing statement now please', 6.0, 0.5), // 6.0 → 8.5
    ];

    const t0 = alignT0s(segments, tokens);
    expect(t0[0]).toBeLessThan(0.5);                 // s0 starts at phrase 1
    expect(t0[1]!).toBeGreaterThan(2.0);             // s1 at the 1→2 boundary,
    expect(t0[1]!).toBeLessThan(3.5);                //   NOT offset by the count mismatch
    expect(t0[2]!).toBeGreaterThan(5.0);             // s2 at the 2→3 boundary — no cascade
    expect(t0[2]!).toBeLessThan(6.5);
  });

  it('reverse: script digit "37" aligns to Whisper words "thirty seven"', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'chapter 37 begins now' }),
      makeSegment({ id: 's1', order: 1, text: 'the story moves forward' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('chapter thirty seven begins now', 0.0, 0.5),
      ...wordTokens('the story moves forward', 3.0, 0.5),
    ];
    const t0 = alignT0s(segments, tokens);
    expect(t0[0]).toBeLessThan(0.5);
    expect(t0[1]!).toBeGreaterThan(2.0);
    expect(t0[1]!).toBeLessThan(3.5);
  });

  it('contraction: script "don\'t" aligns to Whisper "do not" without stranding the next segment', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: "we don't stop here" }),
      makeSegment({ id: 's1', order: 1, text: 'the journey keeps going' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('we do not stop here', 0.0, 0.5),
      ...wordTokens('the journey keeps going', 3.0, 0.5),
    ];
    const t0 = alignT0s(segments, tokens);
    expect(t0[0]).toBeLessThan(0.5);
    expect(t0[1]!).toBeGreaterThan(2.0);
    expect(t0[1]!).toBeLessThan(3.5);
  });

  it('symbol: script "fifty percent" aligns to Whisper "50 %"', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'sales rose fifty percent' }),
      makeSegment({ id: 's1', order: 1, text: 'that is remarkable growth' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('sales rose 50 %', 0.0, 0.5),
      ...wordTokens('that is remarkable growth', 3.0, 0.5),
    ];
    const t0 = alignT0s(segments, tokens);
    expect(t0[0]).toBeLessThan(0.5);
    expect(t0[1]!).toBeGreaterThan(2.0);
    expect(t0[1]!).toBeLessThan(3.5);
  });

  // 2026-07-08 — end-to-end coverage for the "ninety seven percent" field
  // failure. whisper.cpp -ml 1 glued the preceding "to" onto the number
  // ("to97%"), which pre-fix failed the whole-token digit check, leaving "to97"
  // an opaque, unmatchable literal (the embedded-digit-run split now expands it
  // to ["to","ninety","seven","percent"] — the CANONICALIZATION unit test above,
  // "mixed alnum token…", is the strict guard and fails without the fix). This
  // test exercises the whole aligner on the glued token and asserts every
  // segment lands in its own phrase with no collapse. NOTE: with no silences
  // supplied, the aligner self-corrects this synthetic case even pre-fix (the
  // real-world collapse needed the full silences + anchor pipeline over ~200
  // segments); it is integration coverage, not the primary regression guard.
  it('glued Whisper token "to97%" aligns to script "to ninety seven percent" through the full aligner; no collapse', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'satisfaction ratings climbed to ninety seven percent' }),
      makeSegment({ id: 's1', order: 1, text: 'that is remarkable growth' }),
      makeSegment({ id: 's2', order: 2, text: 'thanks for watching today' }),
    ];
    // Whisper glues "to" onto the number and drops the space before "%".
    const tokens: TranscriptToken[] = [
      ...wordTokens('satisfaction ratings climbed to97%', 0.0, 0.5), // 0.0 → 2.5
      ...wordTokens('that is remarkable growth', 3.0, 0.5),          // 3.0 → 5.0
      ...wordTokens('thanks for watching today', 6.0, 0.5),          // 6.0 → 8.0
    ];

    const results = alignScenestoTranscript(segments, tokens, []);
    const t0 = results.map(r => r.t0);
    // s0 anchored at phrase 1, s1 at the 1→2 boundary, s2 at the 2→3 boundary —
    // no drift, no cascade.
    expect(t0[0]).toBeLessThan(0.5);
    expect(t0[1]!).toBeGreaterThan(2.0);
    expect(t0[1]!).toBeLessThan(3.5);
    expect(t0[2]!).toBeGreaterThan(5.0);
    expect(t0[2]!).toBeLessThan(6.5);
    // No segment collapses to a near-zero span (the reported clamp symptom).
    for (const r of results) {
      expect(r.t1 - r.t0).toBeGreaterThan(0.5);
    }
  });

  // SAFETY NET (re-baselined for the Hirschberg aligner, WS1a). An unmatchable
  // segment (made-up tokens the normalizer can't reconcile) that ALSO contains a
  // common word appearing far ahead used to over-advance the greedy cursor and
  // strand the following segment at ~0 (the D16 cascade). The diff aligner has no
  // cursor: global optimization assigns the shared word "hotel" to s2 (which
  // wholly matches "echo foxtrot golf hotel"), so s1 is correctly classified
  // UNCOVERED (confidence 0) and its covered neighbors keep their matched
  // positions. Doc §6.1: this is the outcome-test replacement for the old
  // console-warn mechanism assertion; under R12 (WS1b) s1's single-segment gap
  // will interpolate rather than abort.
  it('SAFETY NET: an unmatchable segment is uncovered and does not displace its covered neighbors', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta' }),
      // Two words match nothing; "hotel" also occurs far ahead in s2's phrase —
      // the aligner must NOT anchor s1 there.
      makeSegment({ id: 's1', order: 1, text: 'qwerty asdf hotel' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot golf hotel' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo charlie delta', 0.0, 0.5), // idx 0–3
      ...wordTokens('lorem ipsum dolor', 2.5, 0.5),         // idx 4–6 (s1's real, unmatched audio)
      ...wordTokens('echo foxtrot golf hotel', 4.5, 0.5),   // idx 7–10
    ];

    // Per-segment classification: s0/s2 fully covered, s1 uncovered (global
    // optimality gives "hotel" to s2, not s1). No neighbor displacement.
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[0]!.matched).toBe(true);
    expect(cov[0]!.confidence).toBe(1);
    expect(cov[1]!.matched).toBe(false);
    expect(cov[1]!.confidence).toBe(0);
    expect(cov[2]!.matched).toBe(true);
    expect(cov[2]!.confidence).toBe(1);

    // Full pipeline: s0 at the front, s2 near its true phrase in the second half
    // of the audio — NOT stranded at ~0 by a cascading cursor.
    const t0 = alignT0s(segments, tokens);
    expect(t0[0]).toBeLessThan(0.5);
    expect(t0[2]!).toBeGreaterThan(3.0);
  });
});

// ---------------------------------------------------------------------------
// Diff-aligner outcome tests (re-baselined from the D16 overshoot guard, WS1a).
//
// These scenarios (a low-confidence/unmatchable segment whose only "match" is a
// common word far ahead; two such segments in a row) used to be handled by the
// greedy matcher's overshoot guard + low-confidence cursor hold, and the old
// tests asserted those guards' console-warn internals. Both guards are DELETED —
// the Hirschberg diff aligner has no cursor, so global optimization assigns each
// shared word to the segment that maximizes total score and classifies the
// genuinely unmatchable segments as UNCOVERED (confidence 0) instead of
// overshooting. Per doc §6.1 these are rewritten as OUTCOME tests: the covered
// segments land at their true audio positions with no cascade or inversion. The
// backstop monotonic clamp in applyAnchorBasedTiming (test (d)) is matcher-
// independent and survives unchanged as defense-in-depth.
// ---------------------------------------------------------------------------
describe('diff-aligner outcomes + backstop clamp', () => {
  function alignSpans(
    segments: VideoSegment[],
    tokens: TranscriptToken[],
  ): Array<{ t0: number; t1: number; dur: number }> {
    return alignScenestoTranscript(segments, tokens, []).map(a => ({
      t0: a.t0, t1: a.t1, dur: Number((a.t1 - a.t0).toFixed(3)),
    }));
  }

  // (a) A partially-matched segment ("echo" matches, two words don't) stays in
  // its real audio window; the aligner does not strand or collapse it or its
  // neighbors. (No console-warn assertions — the guards that emitted them are gone.)
  it('(a) a partially-matched segment keeps its real window; no cascade', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta' }),
      // "echo" matches idx 4; the other two match nothing.
      makeSegment({ id: 's1', order: 1, text: 'echo qwerty asdf' }),
      makeSegment({ id: 's2', order: 2, text: 'foxtrot golf hotel india' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo charlie delta', 0.0, 0.5), // idx 0–3
      ...wordTokens('echo lorem ipsum', 2.5, 0.5),          // idx 4–6
      ...wordTokens('foxtrot golf hotel india', 4.5, 0.5),  // idx 7–10
    ];

    // updated 2026-08-02: run-based survival (Bug C fix) — s1's single true
    // match ("echo") is a lone anchor with no adjacent matched word to form a
    // run with; longest run = 1. Bug C's ORIGINAL bands required a run of 2
    // for a 3-word segment, so this FAILED the consecutive-run requirement
    // and was classified unmatched — superseding the old "any real match
    // keeps it" (Bug 2) doctrine this test originally pinned.
    //
    // RECALIBRATED (threshold recalibration, second pass, 2026-08-02): 1-3
    // word segments now require only a run of 1 (syncConstants.ts's
    // RUN_SURVIVAL_* header) — a real production project showed the
    // 2-required floor rejected too many genuinely-spoken short segments. A
    // single true match on a 3-word segment qualifies directly again, same
    // as the pre-Bug-C behavior, just via the run mechanism rather than Bug
    // 2's bare non-zero count. matchedWords/confidence are unaffected either
    // way (they were always the real, preserved counts).
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[1]!.matched).toBe(true);
    expect(cov[1]!.confidence).toBeCloseTo(1 / 3, 5);
    expect(cov[1]!.matchedWords).toBe(1);
    expect(cov[1]!.longestRun).toBe(1);

    // The SPAN-level behavior is unaffected: alignScenestoTranscript's Step 2
    // still gives s1 a real, non-zero span (from s0's real end to s2's real
    // start) via the same gap-fill mechanism an already-uncovered middle
    // segment has always used (see test (b)/(c) below) — no cascade, no
    // collapse, regardless of whether s1 is "covered" or "matched".
    const spans = alignSpans(segments, tokens);
    expect(spans[1]!.dur).toBeGreaterThan(0.5);
    expect(spans[0]!.t0).toBeLessThanOrEqual(spans[1]!.t0);
    expect(spans[1]!.t0).toBeLessThanOrEqual(spans[2]!.t0);
    expect(spans[2]!.t0).toBeGreaterThan(3.0);
  });

  // (b) An unmatchable segment whose only shared word ("hotel") occurs far ahead
  // is classified UNCOVERED — global optimality gives "hotel" to s2 — and the
  // following segment lands near its true phrase, uninverted (pre-rewrite this
  // over-advanced the cursor and collapsed s1 to the floor while inverting s2).
  it('(b) a far-ahead shared word does not anchor its segment; no inversion', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta' }),
      makeSegment({ id: 's1', order: 1, text: 'qwerty asdf hotel' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot golf hotel' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo charlie delta', 0.0, 0.5), // idx 0–3
      ...wordTokens('lorem ipsum dolor', 2.5, 0.5),         // idx 4–6 (s1's real, unmatched audio)
      ...wordTokens('echo foxtrot golf hotel', 4.5, 0.5),   // idx 7–10 (shared "hotel" far ahead)
    ];

    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[1]!.matched).toBe(false); // "hotel" belongs to s2, not s1
    expect(cov[2]!.confidence).toBe(1);

    const spans = alignSpans(segments, tokens);
    expect(spans[1]!.t0).toBeLessThanOrEqual(spans[2]!.t0); // no inversion
    expect(spans[2]!.t0).toBeGreaterThan(3.0);              // s2 near its true phrase
    expect(spans.every(s => s.t1 >= s.t0)).toBe(true);
  });

  // (c) Two consecutive unmatchable segments (their only shared words, "hotel"/
  // "golf", both belong to the covered s3) are both classified UNCOVERED. The
  // covered segments s0 and s3 keep their true, non-collapsed positions; the run
  // stays monotonic with no inversion. Under R12 (WS1b) this 2-consecutive-gap
  // will HARD-ABORT — WS1a only classifies; nothing gates yet.
  it('(c) two consecutive unmatchable segments are uncovered; covered ones keep their true spans', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta' }),
      makeSegment({ id: 's1', order: 1, text: 'qwerty asdf hotel' }),  // shared "hotel" ahead
      makeSegment({ id: 's2', order: 2, text: 'zzz yyy golf' }),        // shared "golf" ahead
      makeSegment({ id: 's3', order: 3, text: 'echo foxtrot golf hotel' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo charlie delta', 0.0, 0.5),  // idx 0–3
      ...wordTokens('lorem ipsum dolor sit amet', 2.5, 0.5), // idx 4–8 (s1+s2 real, unmatched)
      ...wordTokens('echo foxtrot golf hotel', 5.5, 0.5),    // idx 9–12
    ];

    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[0]!.matched).toBe(true);
    expect(cov[1]!.matched).toBe(false);
    expect(cov[2]!.matched).toBe(false);
    expect(cov[3]!.matched).toBe(true);

    const spans = alignSpans(segments, tokens);
    // Covered endpoints keep real, non-collapsed spans.
    expect(spans[0]!.dur).toBeGreaterThan(0.5);
    expect(spans[3]!.dur).toBeGreaterThan(0.5);
    expect(spans[3]!.t0).toBeGreaterThan(3.0);
    // Monotonic, no inversion across the whole run.
    for (let i = 0; i < spans.length - 1; i++) {
      expect(spans[i]!.t0).toBeLessThanOrEqual(spans[i + 1]!.t0);
    }
    expect(spans.every(s => s.t1 >= s.t0)).toBe(true);
  });

  // (d) Backstop clamp exercised directly: feed applyAnchorBasedTiming an anchor
  // that overshoots its successor (t1 would exceed next.t0) and confirm the
  // clamp pulls it back so startTimes stay monotonic and the correct later
  // segment keeps its true anchor.
  it('(d) backstop clamp: an inverted anchor is clamped, later segment protected', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 'd0', order: 0, text: 'a', anchorStart: 0, anchorSource: 'whisper' }),
      makeSegment({ id: 'd1', order: 1, text: 'b', anchorStart: 5, anchorSource: 'whisper' }), // overshoot
      makeSegment({ id: 'd2', order: 2, text: 'c', anchorStart: 3, anchorSource: 'whisper' }), // true, earlier
      makeSegment({ id: 'd3', order: 3, text: 'd', anchorStart: 6, anchorSource: 'whisper' }),
    ];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = applyAnchorBasedTiming(segments, 10);
    warnSpy.mockRestore();

    const starts = result.map(s => s.startTime);
    // Monotonic non-decreasing (pre-fix this was [0, 5, 3, 6] — not sorted).
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    // No negative/zero durations anywhere.
    expect(result.every(s => s.duration >= 0.1)).toBe(true);
    // d2 (the correct, earlier segment) keeps its true anchor — not pushed forward.
    expect(result[2]!.startTime).toBe(3);
    // d1 (the overshoot) is the one that collapses, not its neighbors.
    expect(result[1]!.duration).toBeLessThan(0.5);
  });
});

// ===========================================================================
// WS1a — Hirschberg diff aligner (architecture doc §3.1, §3.1.1, §6.2)
// ===========================================================================
describe('WS1a — Hirschberg diff aligner', () => {
  // A single-word insertion in the transcript (a Whisper hallucination) is a
  // subject word with no scene-doc counterpart. The aligner matches the
  // surrounding words and absorbs the insertion as a free gap — the segment is
  // fully covered and not shifted (doc §6.2, "single-word insertion").
  it('absorbs a single-word transcript insertion (Whisper hallucination) without shifting', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'the quick brown fox' }),
      makeSegment({ id: 's1', order: 1, text: 'jumps over lazy dogs' }),
    ];
    const tokens: TranscriptToken[] = [
      // "zzz" is a hallucinated insertion between "brown" and "fox".
      ...wordTokens('the quick brown zzz fox', 0.0, 0.5),
      ...wordTokens('jumps over lazy dogs', 3.0, 0.5),
    ];
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[0]!.matched).toBe(true);
    expect(cov[0]!.confidence).toBe(1);      // all 4 scene-doc words matched
    expect(cov[1]!.confidence).toBe(1);      // neighbor undisturbed by the insertion
    // s0 spans its real audio (first word "the" ~0.0 to last word "fox" ~2.75).
    expect(cov[0]!.audioRegion!.startSec).toBeLessThan(0.5);
  });

  // A single-word deletion (a scene-doc word absent from the transcript) is a
  // penalized query gap: the aligner matches the remaining words and lowers the
  // segment's confidence rather than failing it (doc §6.2, "single-word deletion").
  it('tolerates a single-word scene-doc deletion (word absent from transcript), lowering confidence', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'the quick brown fox' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('the quick fox', 0.0, 0.5), // "brown" never spoken
    ];
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[0]!.matched).toBe(true);
    expect(cov[0]!.confidence).toBeCloseTo(3 / 4, 5); // 3 of 4 words matched
  });

  // Repeated phrases ("let us go" three times) must be disambiguated by GLOBAL
  // optimality — each scene segment matches the occurrence its unique context
  // selects, not the greedy first match (doc §6.2, "repeated phrases"; fixes S4).
  it('disambiguates a phrase repeated 3× by global optimality, not greedy first-match', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'intro alpha let us go' }),
      makeSegment({ id: 's1', order: 1, text: 'middle bravo let us go' }),
      makeSegment({ id: 's2', order: 2, text: 'outro charlie let us go' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('intro alpha let us go', 0.0, 0.5),   // 0.0 → 2.5
      ...wordTokens('middle bravo let us go', 3.0, 0.5),  // 3.0 → 5.5
      ...wordTokens('outro charlie let us go', 6.0, 0.5), // 6.0 → 8.5
    ];
    const cov = extractSegmentAlignments(segments, tokens);
    // Each "let us go" resolves to its OWN occurrence — every segment fully covered.
    expect(cov.map(c => c.confidence)).toEqual([1, 1, 1]);
    // First-matched word of each segment falls in its own phrase window, in order.
    expect(cov[0]!.audioRegion!.startSec).toBeLessThan(0.5);
    expect(cov[1]!.audioRegion!.startSec).toBeGreaterThanOrEqual(3.0);
    expect(cov[1]!.audioRegion!.startSec).toBeLessThan(5.5);
    expect(cov[2]!.audioRegion!.startSec).toBeGreaterThanOrEqual(6.0);
  });

  // Per-segment confidence extraction (doc §3.1.1, R11).
  it('extracts per-segment confidence: 3 of 5 words matched → 0.6, matched=true', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta echo' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo charlie', 0.0, 0.5), // only 3 of the 5 words spoken
    ];
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[0]!.confidence).toBeCloseTo(0.6, 5);
    expect(cov[0]!.matched).toBe(true);
    expect(cov[0]!.audioRegion).toBeDefined();
  });

  it('extracts per-segment confidence: 0 of 5 words matched → 0, matched=false, no audio region', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta echo' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('zulu yankee xray whiskey victor', 0.0, 0.5), // nothing in common
    ];
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[0]!.confidence).toBe(0);
    expect(cov[0]!.matched).toBe(false);
    expect(cov[0]!.audioRegion).toBeUndefined();
  });

  // AlignResult widening (doc §3.1.1, §4) — the per-segment result carries the
  // new confidence / matched / audioRegion fields WS1b threads through.
  it('AlignResult carries confidence, matched, and audioRegion (present iff matched)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'nomatch words here' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo', 0.0, 0.5),
      ...wordTokens('completely different speech', 2.0, 0.5),
    ];
    const cov = extractSegmentAlignments(segments, tokens);
    expect(typeof cov[0]!.confidence).toBe('number');
    expect(typeof cov[0]!.matched).toBe('boolean');
    expect(cov[0]!.matched).toBe(true);
    expect(cov[0]!.audioRegion).toBeDefined();
    expect(cov[1]!.matched).toBe(false);
    expect(cov[1]!.audioRegion).toBeUndefined();
  });

  // Zero-token segment neutrality (doc §3.1.1 point 4, §6.2 item 15): an
  // empty-text segment between covered neighbors is classification-neutral —
  // uncovered but never a gap member, anchored at the previous boundary, and it
  // does not crash the aligner.
  it('treats a zero-token segment as neutral: uncovered, anchored at the previous boundary', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: '   ' }), // empty after trim
      makeSegment({ id: 's2', order: 2, text: 'charlie delta' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo charlie delta', 0.0, 0.5),
    ];
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[0]!.matched).toBe(true);
    expect(cov[2]!.matched).toBe(true);
    expect(cov[1]!.matched).toBe(false);
    expect(cov[1]!.confidence).toBe(0);
    expect(cov[1]!.audioRegion).toBeUndefined();
    // Anchored at the previous segment's boundary (t0 === t1).
    expect(cov[1]!.t0).toBe(cov[1]!.t1);
  });
});

// ===========================================================================
// WS1a — Hirschberg ≡ full-matrix NW property test (doc §6.2 item 14, R7)
// ===========================================================================
// The correctness gate for the free-end-gap / linear-space traceback: a
// TEST-SIDE full-matrix reference (same scoring: match +1, mismatch −1, gap −1;
// free leading + trailing subject gaps) must yield the same optimal SCORE as the
// Hirschberg aligner on random and hand-built fixtures, including free-end-gap
// cases. Score equality is the rigorous optimality gate; for hand-built
// fixtures with a unique optimum the exact match set is also asserted.
describe('WS1a — Hirschberg ≡ full-matrix NW (property)', () => {
  const MATCH = 1, MISMATCH = -1, GAP = -1;

  // Reference full-matrix semi-global NW score (free leading + trailing subject gaps).
  function refSemiGlobalScore(q: string[], s: string[]): number {
    const n = q.length, m = s.length;
    const H: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let j = 0; j <= m; j++) H[0]![j] = 0;              // free leading subject gap
    for (let i = 1; i <= n; i++) {
      H[i]![0] = i * GAP;                                   // query deletions charged
      for (let j = 1; j <= m; j++) {
        const diag = H[i - 1]![j - 1]! + (q[i - 1] === s[j - 1] ? MATCH : MISMATCH);
        const del = H[i - 1]![j]! + GAP;
        const ins = H[i]![j - 1]! + GAP;
        H[i]![j] = Math.max(diag, del, ins);
      }
    }
    let best = H[n]![0]!;                                   // free trailing subject gap
    for (let j = 1; j <= m; j++) best = Math.max(best, H[n]![j]!);
    return best;
  }

  it('matches the reference score on 300 random small fixtures', () => {
    // Small alphabet to force matches, repeats, and ties.
    const alphabet = ['a', 'b', 'c', 'd'];
    let seed = 123456789;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const randArr = (maxLen: number): string[] => {
      const len = Math.floor(rand() * (maxLen + 1));
      return Array.from({ length: len }, () => alphabet[Math.floor(rand() * alphabet.length)]!);
    };
    for (let iter = 0; iter < 300; iter++) {
      const q = randArr(7);
      const s = randArr(9);
      const got = alignQueryToSubject(q, s).score;
      const ref = refSemiGlobalScore(q, s);
      expect(got).toBe(ref);
    }
  });

  it('matches the reference score AND match set on hand-built free-end-gap fixtures', () => {
    const cases: Array<{ q: string[]; s: string[]; matches: Array<[number, number]> }> = [
      // Free leading subject gap: leading "a","a" cost nothing.
      { q: ['b', 'c'], s: ['a', 'a', 'b', 'c'], matches: [[0, 2], [1, 3]] },
      // Free trailing subject gap: trailing "c","c" cost nothing.
      { q: ['a', 'b'], s: ['a', 'b', 'c', 'c'], matches: [[0, 0], [1, 1]] },
      // Both ends free.
      { q: ['b', 'c'], s: ['a', 'b', 'c', 'd'], matches: [[0, 1], [1, 2]] },
      // Interior deletion (scene-doc "x" not spoken).
      { q: ['a', 'x', 'b'], s: ['a', 'b'], matches: [[0, 0], [2, 1]] },
      // Interior insertion (transcript "x" hallucinated).
      { q: ['a', 'b'], s: ['a', 'x', 'b'], matches: [[0, 0], [1, 2]] },
      // No overlap at all → empty infix, all deletions.
      { q: ['x', 'y'], s: ['a', 'b'], matches: [] },
    ];
    for (const { q, s, matches } of cases) {
      const al = alignQueryToSubject(q, s);
      expect(al.score).toBe(refSemiGlobalScore(q, s));
      const got: Array<[number, number]> = [];
      al.matchedSubjectOf.forEach((sj, qi) => { if (sj >= 0) got.push([qi, sj]); });
      expect(got).toEqual(matches);
    }
  });

  it('returned matches are structurally sound (equal words, strictly increasing)', () => {
    const q = ['a', 'b', 'a', 'c', 'b'];
    const s = ['z', 'a', 'b', 'q', 'a', 'c', 'b', 'z'];
    const subjectOf = ['z', 'a', 'b', 'q', 'a', 'c', 'b', 'z'];
    const al = alignQueryToSubject(q, s);
    let prevQi = -1, prevSj = -1;
    al.matchedSubjectOf.forEach((sj, qi) => {
      if (sj >= 0) {
        expect(q[qi]).toBe(subjectOf[sj]);   // matched words are equal
        expect(qi).toBeGreaterThan(prevQi);  // strictly increasing query index
        expect(sj).toBeGreaterThan(prevSj);  // strictly increasing subject index
        prevQi = qi; prevSj = sj;
      }
    });
  });
});

// ===========================================================================
// WS1a — unified normalizer (architecture doc §3.2, R1)
// ===========================================================================
describe('WS1a — unified normalizer (R1 carve-out, ZW-join, NFC)', () => {
  // R1 hyphen carve-out: number-word / digit compounds split; everything else
  // keeps its hyphen as one token.
  it('splits number-word / digit hyphen compounds, preserves everything else', () => {
    // thirty-seven ≡ 37 ≡ "thirty seven" (the existing D16 equivalence at :393 relies on this).
    expect(canonicalizeForAlignment('thirty-seven')).toEqual(['thirty', 'seven']);
    expect(canonicalizeForAlignment('thirty-seven')).toEqual(canonicalizeForAlignment('37'));
    // all-digit sub-parts split too.
    expect(canonicalizeForAlignment('3-4')).toEqual(['three', 'four']);
    // "twenty" is a number word, so twenty-twenty splits.
    expect(canonicalizeForAlignment('twenty-twenty')).toEqual(['twenty', 'twenty']);
    // "first" is an ordinal (NOT in NUMBER_WORDS) → the compound stays one token.
    expect(canonicalizeForAlignment('twenty-first')).toEqual(['twenty-first']);
    // A non-number compound keeps its hyphen as a single token.
    expect(canonicalizeForAlignment('co-operate')).toEqual(['co-operate']);
    expect(canonicalizeForAlignment('co-operate')).toHaveLength(1);
    // "cooperate" is a distinct single token — by the LOCKED design (doc §3.2, R1)
    // co-operate keeps its hyphen and is NOT folded to "cooperate"; any residual
    // mismatch is a local diff cost in the aligner, not a normalizer concern.
    expect(canonicalizeForAlignment('cooperate')).toEqual(['cooperate']);
    expect(canonicalizeForAlignment('co-operate')).not.toEqual(canonicalizeForAlignment('cooperate'));
  });

  // Abbreviations: periods are token boundaries (e.g. → ["e","g"]). The
  // normalizer does NOT collapse "e.g." to "eg"; abbreviation equivalence is
  // handled downstream as a local diff cost by the aligner (doc §2.2 B2, §3.1),
  // not by the normalizer — so this asserts the ACTUAL, correct behavior.
  it('tokenizes abbreviations on their periods (no false eg-equivalence)', () => {
    expect(canonicalizeForAlignment('e.g.')).toEqual(['e', 'g']);
    expect(canonicalizeForAlignment('U.S.A.')).toEqual(['u', 's', 'a']);
    // Each side is a single token vs. multiple — deliberately NOT equal.
    expect(canonicalizeForAlignment('e.g.')).not.toEqual(canonicalizeForAlignment('eg'));
  });

  // ZW/BOM/directional removal with JOIN semantics — an in-word zero-width space
  // is deleted (not turned into a space), preserving word adjacency (S1).
  it('joins across an in-word zero-width space (ZWSP → single token)', () => {
    expect(canonicalizeForAlignment('wor​ld')).toEqual(['world']);
    expect(canonicalizeForAlignment('wor​ld')).toEqual(canonicalizeForAlignment('world'));
    // BOM at the front is stripped, not spaced.
    expect(canonicalizeForAlignment('﻿hello')).toEqual(['hello']);
  });

  // NFC normalization (S2): NFD and NFC forms of the same accented word
  // canonicalize identically (both sides symmetric).
  it('normalizes NFD and NFC accented forms to the same tokens', () => {
    const nfc = 'café';        // "café" precomposed (U+00E9)
    const nfd = 'café';       // "café" as e + combining acute (U+0065 U+0301)
    expect(canonicalizeForAlignment(nfd)).toEqual(canonicalizeForAlignment(nfc));
  });
});

// ===========================================================================
// WS1b — bidirectional coverage metric (doc §3.3, R13)
// ===========================================================================
describe('WS1b — bidirectional coverage metric', () => {
  it('fully-covered fixture: sceneDocCoverage = transcriptCoverage = bidirectionalCoverage = 1', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    const summary = computeCoverageSummary(cov, countTranscriptWords(tokens));
    expect(summary.sceneDocCoverage).toBe(1);
    expect(summary.transcriptCoverage).toBe(1);
    expect(summary.bidirectionalCoverage).toBe(1);
  });

  it('half-covered fixture: 4 of 8 scene-doc words matched, all 4 transcript words consumed', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot' }),   // never spoken
      makeSegment({ id: 's3', order: 3, text: 'golf hotel' }),     // never spoken
    ];
    const tokens = wordTokens('alpha bravo charlie delta', 0, 0.5); // only s0+s1's words
    const cov = extractSegmentAlignments(segments, tokens);
    const summary = computeCoverageSummary(cov, countTranscriptWords(tokens));
    expect(summary.sceneDocCoverage).toBeCloseTo(0.5, 5);   // 4 of 8 scene-doc words
    expect(summary.transcriptCoverage).toBe(1);              // all 4 transcript words consumed
    expect(summary.bidirectionalCoverage).toBeCloseTo(0.5, 5);
  });

  it('zero-coverage fixture: no segment matches anything', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
    ];
    const tokens = wordTokens('zulu yankee xray whiskey', 0, 0.5); // nothing in common
    const cov = extractSegmentAlignments(segments, tokens);
    const summary = computeCoverageSummary(cov, countTranscriptWords(tokens));
    expect(summary.sceneDocCoverage).toBe(0);
    expect(summary.transcriptCoverage).toBe(0);
    expect(summary.bidirectionalCoverage).toBe(0);
  });
});

// ===========================================================================
// WS1b — two-signal abort gate (doc §3.4, R13) + middle-gap error (§3.5, R12)
// ===========================================================================
describe('WS1b — evaluateCoverageGate: R13 two-signal abort gate', () => {
  it('full mismatch (longest covered run = 0) aborts with the mismatch message', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot' }),
    ];
    const tokens = wordTokens('zulu yankee xray whiskey victor uniform', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(true);
    if (gate.aborted) expect(gate.message).toBe(FULL_MISMATCH_MESSAGE);
  });

  it('near-zero coverage (longest covered run = 1) aborts — run below MIN_COVERED_RUN_LENGTH', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),      // matched
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),    // never spoken
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot' }),     // never spoken
    ];
    const tokens = wordTokens('alpha bravo', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(true);
    if (gate.aborted) expect(gate.message).toBe(FULL_MISMATCH_MESSAGE);
  });

  it('partial coverage (run >= 2, bidirectional >= floor) proceeds — no abort', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot' }),     // trailing, never spoken
    ];
    const tokens = wordTokens('alpha bravo charlie delta', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(false);
  });

  it('matched-on-noise (run >= 2 but bidirectional < NOISE_FLOOR_COVERAGE) aborts', () => {
    // A tiny, genuinely-covered 2-segment run diluted by one huge, entirely
    // unmatched segment elsewhere — technically contiguous, but the aggregate
    // scene-doc coverage collapses under the noise floor (Signal 2).
    const noiseWords = Array.from({ length: 40 }, (_, i) => {
      const a = String.fromCharCode(97 + Math.floor(i / 26));
      const b = String.fromCharCode(97 + (i % 26));
      return `noise${a}${b}`;
    }).join(' ');
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: noiseWords }),        // trailing, none spoken
    ];
    const tokens = wordTokens('alpha bravo charlie delta', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(true);
    if (gate.aborted) expect(gate.message).toBe(FULL_MISMATCH_MESSAGE);
  });
});

// Round 4 (R4-1) reversed R12: an internal run of uncovered segments — of any
// length — no longer aborts. These tests are the former R12 abort tests turned
// into their skip counterparts: the gate passes, and the uncovered segments are
// filtered out of the committed timeline (filterToCoveredSegments) instead.
describe('R4-1 — middle gaps SKIP instead of aborting', () => {
  it('2 consecutive unmatched between matched: no abort; both are skipped; only the matched segments are committed', () => {
    // s0+s1 form a contiguous covered run of 2 (>= MIN_COVERED_RUN_LENGTH), so
    // R13 Signal 1 passes even though s2/s3 break the coverage in the middle.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot' }),     // never spoken
      makeSegment({ id: 's3', order: 3, text: 'golf hotel' }),       // never spoken
      makeSegment({ id: 's4', order: 4, text: 'india juliet' }),
    ];
    const tokens = [...wordTokens('alpha bravo charlie delta', 0, 0.5), ...wordTokens('india juliet', 4.0, 0.5)];
    const cov = extractSegmentAlignments(segments, tokens);

    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(false);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s0', 's1', 's4']);
    expect(skipped.map(r => r.segmentIndex)).toEqual([2, 3]);
    expect(skipped.map(r => r.reason)).toEqual(['no audio match', 'no audio match']);
    expect(skipped.map(r => r.segmentText)).toEqual(['echo foxtrot', 'golf hotel']);
  });

  it('1 unmatched between matched: no abort; the unmatched one is skipped', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot' }),     // never spoken
      makeSegment({ id: 's3', order: 3, text: 'golf hotel' }),
      makeSegment({ id: 's4', order: 4, text: 'india juliet' }),
    ];
    const tokens = [
      ...wordTokens('alpha bravo charlie delta', 0, 0.5),
      ...wordTokens('golf hotel india juliet', 4.0, 0.5),
    ];
    const cov = extractSegmentAlignments(segments, tokens);

    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(false);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s0', 's1', 's3', 's4']);
    expect(skipped.map(r => r.segmentIndex)).toEqual([2]);
  });

  it('leading unmatched: no abort; skipped', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'echo foxtrot' }),     // never spoken, leading
      makeSegment({ id: 's1', order: 1, text: 'alpha bravo' }),
      makeSegment({ id: 's2', order: 2, text: 'charlie delta' }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(false);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s1', 's2']);
    expect(skipped.map(r => r.segmentIndex)).toEqual([0]);
  });

  it('trailing unmatched: no abort; skipped', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot' }),     // never spoken, trailing
    ];
    const tokens = wordTokens('alpha bravo charlie delta', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(false);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s0', 's1']);
    expect(skipped.map(r => r.segmentIndex)).toEqual([2]);
  });

  it('carries the segment tag and coverage word-counts onto the skip record (WS-logs skip detail)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'echo foxtrot golf', tag: 'missing1' }), // never spoken
      makeSegment({ id: 's2', order: 2, text: 'india juliet' }),
    ];
    const tokens = [...wordTokens('alpha bravo', 0, 0.5), ...wordTokens('india juliet', 2.0, 0.5)];
    const cov = extractSegmentAlignments(segments, tokens);

    const { skipped } = filterToCoveredSegments(segments, cov);
    expect(skipped).toHaveLength(1);
    // NOTE (updated 2026-08-02, Bug C): a skipped segment is NOT universally
    // guaranteed matchedWords===0/confidence===0 — the consecutive-run
    // survival requirement can skip a segment with real matched words that
    // never form a qualifying run (see syncConstants.ts's RUN_SURVIVAL_*).
    // THIS fixture's segment genuinely has zero matches ("echo foxtrot golf"
    // is never spoken at all), so 0/0 is this fixture's own property, not a
    // universal guarantee of a skip record in general.
    expect(skipped[0]).toMatchObject({
      segmentIndex: 1,
      segmentTag: 'missing1',
      matchedWords: 0,
      totalWords: 3,
      confidence: 0,
    });
  });

  it('omits segmentTag on the skip record when the segment has no tag', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'echo foxtrot' }), // never spoken, no tag
    ];
    const tokens = wordTokens('alpha bravo', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    const { skipped } = filterToCoveredSegments(segments, cov);
    expect(skipped[0]!.segmentTag).toBeUndefined();
  });

  it('all unmatched (full mismatch): STILL aborts — R13 fires, nothing is committed', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot' }),
    ];
    const tokens = wordTokens('zulu yankee xray whiskey victor uniform', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(true);
    if (gate.aborted) expect(gate.message).toBe(FULL_MISMATCH_MESSAGE);
  });

  it('a locked segment with no audio coverage is skipped like any other — no abort, no special message', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot', locked: true }), // uncovered + locked
      makeSegment({ id: 's3', order: 3, text: 'golf hotel' }),
    ];
    const tokens = [...wordTokens('alpha bravo charlie delta', 0, 0.5), ...wordTokens('golf hotel', 3.0, 0.5)];
    const cov = extractSegmentAlignments(segments, tokens);

    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(false);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s0', 's1', 's3']);
    expect(skipped.map(r => r.segmentIndex)).toEqual([2]);
  });

  // Neutral (zero-token) segments: still classification-neutral for the METRICS
  // (they neither break a covered run nor dilute the denominators), and skipped
  // at commit time like any other segment the audio doesn't cover.
  it('neutral (zero-token) segments never abort and are skipped at commit time', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: '' }),      // neutral
      makeSegment({ id: 's2', order: 2, text: '   ' }),   // neutral
      makeSegment({ id: 's3', order: 3, text: 'golf hotel' }),
    ];
    const tokens = [...wordTokens('alpha bravo', 0, 0.5), ...wordTokens('golf hotel', 3.0, 0.5)];
    const cov = extractSegmentAlignments(segments, tokens);

    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(false);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s0', 's3']);
    expect(skipped.map(r => r.segmentIndex)).toEqual([1, 2]);
    expect(skipped.map(r => r.reason)).toEqual(['no audio match', 'no audio match']);
  });
});

// ===========================================================================
// R4-1 re-tile — after filtering, survivors must tile contiguously (no gaps
// left where skipped segments used to sit); the last extends to the audio end.
// ===========================================================================
describe('R4-1 — retileCoveredSegments', () => {
  it('re-derives each duration from the next start; last extends to audioDuration', () => {
    const kept: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'a', startTime: 0, duration: 1, anchorStart: 0 }),
      makeSegment({ id: 's1', order: 1, text: 'b', startTime: 3, duration: 1, anchorStart: 3 }),
      makeSegment({ id: 's2', order: 2, text: 'c', startTime: 7, duration: 1, anchorStart: 7 }),
      makeSegment({ id: 's3', order: 3, text: 'd', startTime: 10, duration: 1, anchorStart: 10 }),
      makeSegment({ id: 's4', order: 4, text: 'e', startTime: 15, duration: 1, anchorStart: 15 }),
    ];

    const out = retileCoveredSegments(kept, 20);

    expect(out.map(s => s.duration)).toEqual([3, 4, 3, 5, 5]);
    // Each segment's end reaches the next segment's start — contiguous, no gaps.
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i]!.startTime + out[i]!.duration).toBeCloseTo(out[i + 1]!.startTime, 6);
    }
    // Last segment ends exactly at the audio duration.
    const last = out[out.length - 1]!;
    expect(last.startTime + last.duration).toBeCloseTo(20, 6);
  });

  it('startTime and anchorStart are preserved — only duration changes', () => {
    const kept: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'a', startTime: 0, duration: 99, anchorStart: 0, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'b', startTime: 4, duration: 99, anchorStart: 4, anchorSource: 'whisper' }),
    ];

    const out = retileCoveredSegments(kept, 10);

    expect(out.map(s => s.startTime)).toEqual([0, 4]);
    expect(out.map(s => s.anchorStart)).toEqual([0, 4]);
    expect(out.map(s => s.anchorSource)).toEqual(['whisper', 'whisper']);
    expect(out.map(s => s.duration)).toEqual([4, 6]);
  });

  it('last kept segment extends to audioDuration regardless of its original t1', () => {
    const kept: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'a', startTime: 0, duration: 2, anchorStart: 0 }),
      // Its original duration ends at 6, well short of the 18s audio.
      makeSegment({ id: 's1', order: 1, text: 'b', startTime: 5, duration: 1, anchorStart: 5 }),
    ];

    const out = retileCoveredSegments(kept, 18);

    const last = out[out.length - 1]!;
    expect(last.startTime + last.duration).toBeCloseTo(18, 6);
    expect(last.duration).toBeCloseTo(13, 6);
  });

  it('defensive clamp: duplicate startTimes never produce a zero/negative duration', () => {
    const kept: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'a', startTime: 5, duration: 2, anchorStart: 5 }),
      makeSegment({ id: 's1', order: 1, text: 'b', startTime: 5, duration: 3, anchorStart: 5 }),
      makeSegment({ id: 's2', order: 2, text: 'c', startTime: 9, duration: 1, anchorStart: 9 }),
    ];

    const out = retileCoveredSegments(kept, 12);

    // No segment may end up with a non-positive duration.
    for (const s of out) expect(s.duration).toBeGreaterThan(0);
    // The degenerate pair (both startTime 5) keeps its original duration for the
    // one whose next-start equals its own start (nextDuration <= 0 -> fallback).
    expect(out.find(s => s.id === 's0')!.duration).toBe(2); // 5->5 = 0, keeps original 2
    expect(out.find(s => s.id === 's1')!.duration).toBe(4); // 5->9 = 4
    expect(out.find(s => s.id === 's2')!.duration).toBe(3); // 9->12 (audio end) = 3
  });

  it('empty input returns empty', () => {
    expect(retileCoveredSegments([], 10)).toEqual([]);
  });

  // Integration: filter (skips 3,4,5) THEN retile — the survivors tile
  // contiguously and segment 2's end reaches segment 6's start, NOT the removed
  // segment 3's position (the bug this fix closes).
  it('skip + retile: covered [0,1,2,6,7,8,9] tile contiguously with no gaps', () => {
    // 10 segments, indices 3/4/5 never spoken. Each spoken phrase is 4 words @
    // 0.5s = 2s, with a 1s silence between phrases (words at 0,2 / 3,5 / 6,8 ...).
    const spoken = [
      'alpha bravo charlie delta',      // s0  0.0–2.0
      'echo foxtrot golf hotel',        // s1  3.0–5.0
      'india juliet kilo lima',         // s2  6.0–8.0
      'quebec romeo sierra tango',      // s6  9.0–11.0
      'uniform victor whiskey xray',    // s7 12.0–14.0
      'yankee zulu alfa bravo2',        // s8 15.0–17.0
      'charlie2 delta2 echo2 foxtrot2', // s9 18.0–20.0
    ];
    const unspoken = ['mike november', 'oscar papa', 'quebec2 romeo2'];
    const texts = [
      spoken[0]!, spoken[1]!, spoken[2]!,
      unspoken[0]!, unspoken[1]!, unspoken[2]!,   // s3, s4, s5 — skipped
      spoken[3]!, spoken[4]!, spoken[5]!, spoken[6]!,
    ];
    const segments: VideoSegment[] = texts.map((text, i) => makeSegment({ id: `s${i}`, order: i, text }));

    let wordStart = 0;
    const tokens: TranscriptToken[] = [];
    for (const phrase of spoken) {
      tokens.push(...wordTokens(phrase, wordStart, 0.5));
      wordStart += 3; // 2s of words + 1s silence
    }
    const AUDIO_DURATION = 20;

    const cov = extractSegmentAlignments(segments, tokens);
    expect(evaluateCoverageGate(segments, cov, countTranscriptWords(tokens)).aborted).toBe(false);

    // Mirror the real pipeline: alignment windows land on the segments (startTime
    // = t0) BEFORE filtering, so the survivors carry real Whisper-anchored starts.
    const timed = distributeSegmentTimes(segments, cov, AUDIO_DURATION);
    const { kept, skipped } = filterToCoveredSegments(timed, cov);
    expect(kept.map(s => s.id)).toEqual(['s0', 's1', 's2', 's6', 's7', 's8', 's9']);
    expect(skipped.map(r => r.segmentIndex)).toEqual([3, 4, 5]);

    const retiled = retileCoveredSegments(kept, AUDIO_DURATION);

    // Contiguous: every segment's end == the next segment's start (no gaps).
    for (let i = 0; i < retiled.length - 1; i++) {
      expect(retiled[i]!.startTime + retiled[i]!.duration).toBeCloseTo(retiled[i + 1]!.startTime, 6);
    }
    // Last extends to the audio end.
    const last = retiled[retiled.length - 1]!;
    expect(last.startTime + last.duration).toBeCloseTo(AUDIO_DURATION, 6);

    // Segment s2's end reaches s6's start (~9s), NOT the removed s3's position.
    const s2 = retiled.find(s => s.id === 's2')!;
    const s6 = retiled.find(s => s.id === 's6')!;
    expect(s2.startTime + s2.duration).toBeCloseTo(s6.startTime, 6);
    expect(s6.startTime).toBeGreaterThan(8); // s6 begins around 9s, past the s2 phrase end
  });
});

// ===========================================================================
// headExtendFirstSegment — head/tail symmetry post-pass (syncEngine.ts)
// ===========================================================================
describe('headExtendFirstSegment', () => {
  it('stretches segment 1 back to 0 when it starts after the first spoken word, keeping its end fixed', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo', startTime: 0.16, duration: 4.02, anchorStart: 0.16, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta', startTime: 4.18, duration: 3 }),
    ];

    const out = headExtendFirstSegment(segments);

    expect(out[0]!.startTime).toBe(0);
    expect(out[0]!.duration).toBeCloseTo(4.18, 6);
    expect(out[0]!.anchorStart).toBe(0);
    // End (startTime + duration) is unchanged by the stretch.
    expect(out[0]!.startTime + out[0]!.duration).toBeCloseTo(0.16 + 4.02, 6);
    // Contiguity: s1 (untouched) still starts exactly where s0 now ends.
    expect(out[0]!.startTime + out[0]!.duration).toBeCloseTo(out[1]!.startTime, 6);
    // s2 is completely untouched — no ripple.
    expect(out[1]).toEqual(segments[1]);
  });

  it('is a no-op when segment 1 already starts at 0', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha', startTime: 0, duration: 2, anchorStart: 0, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'bravo', startTime: 2, duration: 2 }),
    ];

    const out = headExtendFirstSegment(segments);

    expect(out).toEqual(segments);
  });

  it('leaves a locked first segment untouched even if its startTime > 0', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha', startTime: 0.16, duration: 4, locked: true, anchorStart: 0.16, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'bravo', startTime: 4.16, duration: 2 }),
    ];

    const out = headExtendFirstSegment(segments);

    expect(out).toEqual(segments);
  });

  it('is a no-op on an empty array', () => {
    expect(headExtendFirstSegment([])).toEqual([]);
  });
});

// ===========================================================================
// R4-2 — the skip filter itself (covered segments in, uncovered segments out)
// ===========================================================================
describe('R4-2 — filterToCoveredSegments', () => {
  it('5 covered + 3 uncovered commits exactly 5 segments, not 8', () => {
    const spoken = ['alpha bravo', 'charlie delta', 'echo foxtrot', 'golf hotel', 'india juliet'];
    const unspoken = ['kilo lima', 'mike november', 'oscar papa'];
    // Interleaved so the uncovered set spans leading, middle, and trailing
    // positions — all three are skipped identically (R4-1).
    const texts = [
      unspoken[0]!, spoken[0]!, spoken[1]!, unspoken[1]!,
      spoken[2]!, spoken[3]!, spoken[4]!, unspoken[2]!,
    ];
    const segments: VideoSegment[] = texts.map((text, i) =>
      makeSegment({ id: `s${i}`, order: i, text }),
    );
    const tokens = wordTokens(spoken.join(' '), 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    expect(evaluateCoverageGate(segments, cov, countTranscriptWords(tokens)).aborted).toBe(false);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept).toHaveLength(5);
    expect(skipped).toHaveLength(3);
    expect(kept.map(s => s.id)).toEqual(['s1', 's2', 's4', 's5', 's6']);
    expect(skipped.map(r => r.segmentIndex)).toEqual([0, 3, 7]);
    expect(skipped.map(r => r.segmentText)).toEqual(unspoken);
  });

  it('kept segments carry their Whisper-anchored startTime through untouched (no re-timing)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo', startTime: 0, duration: 1 }),
      makeSegment({ id: 's1', order: 1, text: 'kilo lima', startTime: 1, duration: 2 }),   // uncovered
      makeSegment({ id: 's2', order: 2, text: 'charlie delta', startTime: 3, duration: 1 }),
    ];
    const tokens = [...wordTokens('alpha bravo', 0, 0.5), ...wordTokens('charlie delta', 3.0, 0.5)];
    const cov = extractSegmentAlignments(segments, tokens);

    const { kept } = filterToCoveredSegments(segments, cov);
    // The dropped segment's [1, 3) span becomes a real gap — s2 is NOT pulled
    // back to 1, and s0 is NOT stretched to 3 (R4-1: no stitching).
    expect(kept.map(s => ({ id: s.id, startTime: s.startTime, duration: s.duration }))).toEqual([
      { id: 's0', startTime: 0, duration: 1 },
      { id: 's2', startTime: 3, duration: 1 },
    ]);
  });

  it('a fully-covered project skips nothing (no regression for the normal case)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot' }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta echo foxtrot', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept).toHaveLength(3);
    expect(skipped).toHaveLength(0);
  });

  // Bug 2 fix: a matched segment is KEPT regardless of confidence — the skip
  // filter no longer gates on the LOW_CONFIDENCE_RATIO threshold at all. Only
  // `covered` (used by R13's contiguous-run gate, unchanged) still applies the
  // threshold; `filterToCoveredSegments` now keys purely off `matched`.
  //
  // updated 2026-08-02: run-based survival (Bug C fix) — a SINGLE isolated
  // match at the tail of a 6-word segment ("echo", the only spoken word) is
  // exactly the shape Bug 2's blanket "any real match keeps it" doctrine was
  // too permissive about: longest run = 1 (a lone anchor), required = 3 for a
  // 6-word segment, so it now correctly SKIPS again — not because of
  // confidence (still true, unaffected), but because one scattered word
  // cannot be trusted as "this segment was spoken" on its own. Bug 2's fix
  // (matched != covered) still stands; this fixture just no longer
  // demonstrates it, since the segment is not `matched` in the first place.
  it('a segment with a single, isolated matched word (no run) is skipped despite matchedWords > 0 (Bug 2 -> Bug C)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'zulu victor whiskey xray yankee echo' }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta echo', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[2]!.matched).toBe(false);
    expect(cov[2]!.matchedWords).toBe(1); // the real match is preserved, not zeroed
    expect(cov[2]!.confidence).toBeLessThan(LOW_CONFIDENCE_RATIO);
    expect(cov[2]!.longestRun).toBe(1);
    // `covered` (R13 input) is false, same as before — now for TWO independent
    // reasons (uncovered by ratio AND unmatched by run), not just one.
    expect(classifyCoverage(cov)[2]!.covered).toBe(false);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s0', 's1']);
    expect(skipped).toMatchObject([{ segmentIndex: 2, reason: 'no audio match' }]);
  });

  it('a matched=false, confidence=0 segment is still skipped with reason "no audio match" (Bug 2)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'never spoken words here' }),
    ];
    const tokens = wordTokens('alpha bravo', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[1]!.matched).toBe(false);
    expect(cov[1]!.confidence).toBe(0);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s0']);
    // toMatchObject, not toEqual: the record also carries the WS-logs skip-detail
    // fields (segmentTag/matchedWords/totalWords/confidence) — asserted separately
    // above, not the concern of this Bug-2 regression guard.
    expect(skipped).toMatchObject([
      { segmentIndex: 1, segmentText: 'never spoken words here', reason: 'no audio match' },
    ]);
  });

  it('never produces a "low confidence" skip reason (Bug 2 regression guard)', () => {
    // updated 2026-08-02: run-based survival (Bug C fix) — s1's one spoken
    // word ("charlie", isolated, no adjacent match) no longer clears the
    // consecutive-run requirement (longest run 1, required 3 for 5 words),
    // so it now ALSO skips — 'no audio match' is still the only reason
    // used, which is this guard's actual point: regardless of how MANY
    // segments end up skipped, or WHY (zero matches vs. an insufficient
    // run), 'low confidence' must never appear as a skip reason.
    const spoken = ['alpha bravo', 'charlie delta echo foxtrot golf'];
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: spoken[0]! }),
      makeSegment({ id: 's1', order: 1, text: spoken[1]! }),
      makeSegment({ id: 's2', order: 2, text: 'never spoken at all' }),
    ];
    const tokens = wordTokens('alpha bravo charlie', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s0']);
    expect(skipped.map(r => r.reason)).toEqual(['no audio match', 'no audio match']);
    expect(skipped.every(r => r.reason === 'no audio match')).toBe(true);
  });

  it('294-segment-like fixture: a weakly-matched segment (confidence 0.33, mirroring the reported segment 135) is KEPT again (matched-not-covered) via the recalibrated 1-3-word band, while R13 still passes on the strongly-covered majority', () => {
    // Layered history — this is the exact "Bug 2 flagship" shape the Bug C
    // design doc calls out by name: a single isolated matched word
    // ("weaktwo") in the MIDDLE of a 3-word segment, with no adjacent match
    // to form a run with (longest run = 1).
    //   - Bug 2 (original): matched = matchedCount > 0, so this SURVIVED on
    //     the lone match alone (confidence 0.33 never even considered).
    //   - Bug C (2026-08-02, first pass): required a run of 2 for a 3-word
    //     segment; a run of 1 fell short, so this SKIPPED — a deliberate
    //     policy reversal at the time.
    //   - Threshold recalibration (second pass, 2026-08-02): verified against
    //     a real 174-segment project, the run-of-2 floor for short segments
    //     rejected too many genuinely-spoken ones. 1-3-word segments now
    //     require only a run of 1, so this SURVIVES again — but via the run
    //     mechanism (`matched`), not Bug 2's bare non-zero count, and it is
    //     still NOT `covered` (confidence 0.33 stays under LOW_CONFIDENCE_RATIO
    //     0.4) — a real, visible distinction Bug 2 never had. R13's gate
    //     (below) still passes independently, since it never depended on this
    //     one segment's own classification.
    //
    // Simulates the reported repro (segment 135, "Navigational charts
    // cross-referenced.", matched=true/confidence=0.3333/words=1/3): many
    // strongly-covered segments surrounding one weakly-matched segment (1 of 3
    // unique words spoken). Words are unique per segment (no repeats across
    // segments) so the aligner's monotonic matching is unambiguous.
    const before = Array.from({ length: 10 }, (_, i) => `beforeA${i} beforeB${i}`);
    const after = Array.from({ length: 10 }, (_, i) => `afterA${i} afterB${i}`);
    const segments: VideoSegment[] = [
      ...before.map((text, i) => makeSegment({ id: `before${i}`, order: i, text })),
      makeSegment({
        id: 'weak135',
        order: before.length,
        text: 'weakone weaktwo weakthree', // 1 of 3 words will be spoken -> confidence 1/3
      }),
      ...after.map((text, i) =>
        makeSegment({ id: `after${i}`, order: before.length + 1 + i, text }),
      ),
    ];
    // Transcript speaks every "before"/"after" word in full, plus exactly one
    // of the weak segment's three words ("weaktwo").
    const tokens = wordTokens([...before, 'weaktwo', ...after].join(' '), 0, 0.25);
    const cov = extractSegmentAlignments(segments, tokens);

    const weakIdx = before.length;
    expect(cov[weakIdx]!.matched).toBe(true);
    expect(cov[weakIdx]!.matchedWords).toBe(1); // preserved, not zeroed
    expect(cov[weakIdx]!.totalWords).toBe(3);
    expect(cov[weakIdx]!.confidence).toBeCloseTo(1 / 3, 4);
    expect(cov[weakIdx]!.confidence).toBeLessThan(LOW_CONFIDENCE_RATIO);
    expect(cov[weakIdx]!.longestRun).toBe(1);
    // `covered` (R13 input) is still false — `matched` and `covered` are
    // independent axes (Bug 2's own point), and confidence 0.33 alone keeps
    // this uncovered regardless of the run recalibration above.
    expect(classifyCoverage(cov)[weakIdx]!.covered).toBe(false);

    // R13 gate: still passes — the strongly-covered runs are long enough, and
    // overall bidirectional coverage clears the noise floor. Entirely
    // independent of weak135's own matched/skip classification.
    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(false);

    // Recalibration: the weak segment is now KEPT (matched === true) —
    // matched-not-covered, not a return to Bug 2's mechanism.
    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toContain('weak135');
    expect(kept).toHaveLength(segments.length);
    expect(skipped).toHaveLength(0);
  });
});

// ===========================================================================
// R13 gate — unchanged: still keys on `covered` (matched && confidence >=
// LOW_CONFIDENCE_RATIO), independent of the Bug 2 skip-filter fix above.
// ===========================================================================
describe('R13 gate is unaffected by the Bug 2 skip-filter change', () => {
  it('a project where every segment is weakly matched (confidence 0.2-0.4) still aborts', () => {
    // Every segment matches SOME words but never clears the 0.4 covered
    // threshold, so the contiguous-covered-run signal stays at 0 and R13 fires
    // — even though, post-Bug-2-fix, none of these segments would be skipped
    // by the commit-time filter if the gate let the run through.
    //
    // updated 2026-08-02: run-based survival (Bug C fix) — each segment's one
    // matched word ("common", the last of 5, isolated) no longer clears the
    // consecutive-run requirement either (longest run 1, required 3), so
    // `matched` now flips to false for every segment too, not just `covered`.
    // R13's own abort outcome is untouched — it already fired on
    // longestCoveredRun === 0 regardless of the (now also false) `matched`
    // flag, so this is the one line that needed updating.
    const segments: VideoSegment[] = Array.from({ length: 6 }, (_, i) =>
      makeSegment({
        id: `s${i}`,
        order: i,
        // 5 words per segment; only 1 will match → confidence 0.2.
        text: `zulu${i} victor${i} whiskey${i} xray${i} common`,
      }),
    );
    const tokens = wordTokens('common common common common common common', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    // Every segment is unmatched now (an isolated, non-contiguous word does
    // not qualify) and, as before, none is `covered`.
    const flags = classifyCoverage(cov);
    expect(cov.every(a => !a.matched)).toBe(true);
    expect(flags.every(f => !f.covered)).toBe(true);

    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(true);
  });

  it('cross-script mismatch (all segments fully unmatched) still aborts (regression guard)', () => {
    const segments: VideoSegment[] = Array.from({ length: 5 }, (_, i) =>
      makeSegment({ id: `s${i}`, order: i, text: `unrelated${i} content${i} here${i}` }),
    );
    const tokens = wordTokens('totally different transcript audio entirely', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    expect(cov.every(a => !a.matched)).toBe(true);

    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(true);

    // And even if the orchestrator somehow ran the filter anyway (it doesn't,
    // it returns early on abort), nothing would be kept.
    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept).toHaveLength(0);
    expect(skipped).toHaveLength(5);
    expect(skipped.every(r => r.reason === 'no audio match')).toBe(true);
  });
});

// ===========================================================================
// WS1b — empty-input hard aborts (doc §3.4/§3.11, S15)
// ===========================================================================
describe('WS1b — empty-input hard aborts', () => {
  it('empty scene doc (0 parsed segments) aborts with the empty-scene message', () => {
    expect(emptySceneDocAbortMessage(0)).toBe(EMPTY_SCENE_DOC_MESSAGE);
  });

  it('a non-empty parse does not trigger the empty-scene abort', () => {
    expect(emptySceneDocAbortMessage(3)).toBeNull();
  });

  it('empty transcript (0 tokens) with a voiceover staged aborts with the empty-transcript message', () => {
    expect(emptyTranscriptAbortMessage(true, 0)).toBe(EMPTY_TRANSCRIPT_MESSAGE);
  });

  it('a non-empty transcript does not trigger the empty-transcript abort', () => {
    expect(emptyTranscriptAbortMessage(true, 42)).toBeNull();
  });

  it('no voiceover staged at all is not an empty-transcript error (character-timed projects are valid)', () => {
    expect(emptyTranscriptAbortMessage(false, 0)).toBeNull();
  });
});

// ===========================================================================
// WS1b — silence-snap guards with bounded tolerance (doc §3.6, R4)
//
// AMENDED by the silence-sharing fix: the R4 clamps apply to the NO-SILENCE
// fallback only. A boundary that came from a detected silence is acoustic
// ground truth and outranks Whisper's ~300ms-error word timestamps, so it is
// never clamped against them — clamping it was pulling boundaries back OUT of
// the silence they were meant to split, handing the whole silence to one side
// instead of sharing it 50/50.
// ===========================================================================
describe('WS1b — silence-snap boundaries (silence found = ground truth, no-silence = token midpoint)', () => {
  it('a silence centre beyond nextSpokenStart + tolerance is NOT clamped (silence wins)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
    ];
    // lastSpokenEnd (bravo) = 1.0; nextSpokenStart (charlie) = 3.0.
    // forwardBound would be 3.0 + 0.15 = 3.15; the silence centre (3.3) is
    // beyond it and is kept anyway.
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 0.5 },
      { text: 'bravo', startSec: 0.5, endSec: 1.0 },
      { text: 'charlie', startSec: 3.0, endSec: 3.5 },
      { text: 'delta', startSec: 3.5, endSec: 4.0 },
    ];
    const silences: SilenceInterval[] = [{ startSec: 3.2, endSec: 3.4 }];
    const results = alignScenestoTranscript(segments, tokens, silences);
    expect(results[0]!.t1).toBeCloseTo(3.3, 5);
    expect(results[1]!.t0).toBeCloseTo(3.3, 5);
  });

  // REGRESSION FIX (2026-08-03, was: "a silence intruding past lastSpokenEnd
  // - tolerance is rejected by candidacy, falling back to the token
  // midpoint"). This test used to pin `isBoundarySilenceCandidate`'s SPAN
  // condition rejecting a silence more than BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC
  // before lastSpokenEnd. Bisected against a real production project, that
  // condition was found to reject genuine inter-segment silences whenever
  // real Whisper trailing-word blur exceeded its 0.3s budget — exactly this
  // shape — clamping the boundary to the (blurred) speech end instead of the
  // real gap. The SPAN condition is deleted (see `isBoundarySilenceCandidate`'s
  // own doc comment); a silence overlapping the search window is now accepted
  // regardless of its distance from either spoken edge, provided it is not
  // itself a same-segment breath (`fillsTokenGapWithinSpan/isBreathSilence`,
  // neither of which this silence trips — it sits well outside either
  // segment's own matched-token span).
  it('a silence overlapping the search window is accepted even when it sits well before lastSpokenEnd', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
    ];
    // lastSpokenEnd (bravo) = 2.0; nextSpokenStart (charlie) = 4.0.
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 1.0 },
      { text: 'bravo', startSec: 1.0, endSec: 2.0 },
      { text: 'charlie', startSec: 4.0, endSec: 4.5 },
      { text: 'delta', startSec: 4.5, endSec: 5.0 },
    ];
    const silences: SilenceInterval[] = [{ startSec: 1.6, endSec: 1.7 }];
    const results = alignScenestoTranscript(segments, tokens, silences);
    // Accepted -> silence centre (1.6 + 1.7) / 2 = 1.65.
    expect(results[0]!.t1).toBeCloseTo(1.65, 5);
    expect(results[1]!.t0).toBeCloseTo(1.65, 5);
  });

  it('a snap within tolerance of both bounds is unchanged', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
    ];
    // Same tokens as the backward-clamp case (bounds [1.85, 4.15]); silence
    // center (3.0) sits comfortably inside the tolerance window.
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 1.0 },
      { text: 'bravo', startSec: 1.0, endSec: 2.0 },
      { text: 'charlie', startSec: 4.0, endSec: 4.5 },
      { text: 'delta', startSec: 4.5, endSec: 5.0 },
    ];
    const silences: SilenceInterval[] = [{ startSec: 2.9, endSec: 3.1 }];
    const results = alignScenestoTranscript(segments, tokens, silences);
    expect(results[0]!.t1).toBeCloseTo(3.0, 5);
    expect(results[1]!.t0).toBeCloseTo(3.0, 5);
  });

  it('no-silence fallback with inverted bounds (lastSpokenEnd > nextSpokenStart) still lands at the plain midpoint', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
    ];
    // lastSpokenEnd (bravo) = 2.0; nextSpokenStart (charlie) = 1.6 — the
    // segments' spoken words overlap/sit too close together (a degenerate
    // Whisper timing case). There are no clamps to resolve this anymore — the
    // honest answer is just the midpoint of the two spoken edges, 1.80.
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 1.0 },
      { text: 'bravo', startSec: 1.0, endSec: 2.0 },
      { text: 'charlie', startSec: 1.6, endSec: 2.4 },
      { text: 'delta', startSec: 2.4, endSec: 3.0 },
    ];
    const results = alignScenestoTranscript(segments, tokens, []);
    expect(results[0]!.t1).toBeCloseTo(1.8, 5);
    expect(results[1]!.t0).toBeCloseTo(1.8, 5);
  });

  // REGRESSION FIX (2026-08-03, was: "the same inverted-bounds fixture now
  // also rejects an out-of-tolerance silence, matching its own no-silence
  // fallback"). Same reason as the test above: this silence sits inside the
  // search WINDOW ([0.8, 3.0]) and, with the SPAN/tolerance condition
  // deleted from `isBoundarySilenceCandidate`, window overlap alone is now
  // sufficient — matching pre-regression (commit 0c83a06) behavior, where
  // this same shape was picked outright.
  it('the same inverted-bounds fixture accepts a silence overlapping the window regardless of its distance from either spoken edge', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 1.0 },
      { text: 'bravo', startSec: 1.0, endSec: 2.0 },
      { text: 'charlie', startSec: 1.6, endSec: 2.4 },
      { text: 'delta', startSec: 2.4, endSec: 3.0 },
    ];
    const silences: SilenceInterval[] = [{ startSec: 2.6, endSec: 2.8 }];
    const results = alignScenestoTranscript(segments, tokens, silences);
    // Accepted -> silence centre (2.6 + 2.8) / 2 = 2.7.
    expect(results[0]!.t1).toBeCloseTo(2.7, 5);
    expect(results[1]!.t0).toBeCloseTo(2.7, 5);
  });

  it('no-silence fallback boundary = token midpoint, no clamps applied', () => {
    // The fallback boundary is always exactly the spoken-word midpoint, even
    // when that value would have sat outside the old ±0.150s tolerance
    // window — there is no clamp post-processing on this branch anymore.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
    ];
    // lastSpokenEnd (bravo) = 2.0; nextSpokenStart (charlie) = 4.0. The old
    // tolerance window would have been [1.85, 4.15] — the midpoint (3.0) sits
    // well outside a ±0.150s clamp of either edge, yet is exactly what the
    // fallback produces.
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 1.0 },
      { text: 'bravo', startSec: 1.0, endSec: 2.0 },
      { text: 'charlie', startSec: 4.0, endSec: 4.5 },
      { text: 'delta', startSec: 4.5, endSec: 5.0 },
    ];
    const results = alignScenestoTranscript(segments, tokens, []);
    expect(results[0]!.t1).toBeCloseTo((2.0 + 4.0) / 2, 5);
    expect(results[1]!.t0).toBeCloseTo((2.0 + 4.0) / 2, 5);
  });
});

// ===========================================================================
// WS1b — integration: cross-script mismatch (primary B1 validation, doc §6.2/§6.4)
// ===========================================================================
describe('WS1b — cross-script mismatch integration', () => {
  it('a scene doc and a completely unrelated transcript hard-abort with the full-mismatch message', () => {
    // Scene doc: a cooking-recipe project.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'preheat oven three fifty degrees' }),
      makeSegment({ id: 's1', order: 1, text: 'whisk eggs sugar together' }),
      makeSegment({ id: 's2', order: 2, text: 'fold flour gently' }),
    ];
    // Transcript: an unrelated financial-report project — zero word overlap.
    const tokens = wordTokens('quarterly revenue exceeded analyst expectations twelve percent', 0, 0.4);

    const cov = extractSegmentAlignments(segments, tokens);
    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));

    expect(gate.aborted).toBe(true);
    if (gate.aborted) expect(gate.message).toBe(FULL_MISMATCH_MESSAGE);
    // The orchestrator (App.tsx handleApplySyncFromFiles) returns immediately
    // on gate.aborted, before preserveEffectFields/setProject are ever
    // reached — no partial timeline is committed (doc §3.4(b)).
  });
});


// ===========================================================================
// Middle-gap position-offset fix — snapCoveredBoundaries (services/snapBoundaries.ts)
//
// The aligner's own snap runs on the FULL segment array, so a boundary shared
// with an UNMATCHED segment is computed from that segment's -1 token sentinels
// (i.e. from placeholder anchors, not from anything spoken). The covered
// segment on the other side keeps that corrupted boundary through the filter.
// snapCoveredBoundaries re-runs the snap on the covered-only array, where every
// token index is real, and derives durations from the result (subsuming the
// R4-1 re-tile).
// ===========================================================================
describe('snapCoveredBoundaries — covered-only boundary snap', () => {
  // Two covered segments: 'alpha bravo' spoken 0.0-1.0, 'charlie delta' spoken
  // 2.0-3.0. Every test below varies only the silences.
  function twoCoveredSegments() {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo', startTime: 0, duration: 2, anchorStart: 0, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta', startTime: 2, duration: 3, anchorStart: 2, anchorSource: 'whisper' }),
    ];
    const tokens = [...wordTokens('alpha bravo', 0, 0.5), ...wordTokens('charlie delta', 2.0, 0.5)];
    const alignments = extractSegmentAlignments(segments, tokens);
    // Precondition for every case here: both segments really are matched, so
    // their token indices are real and none of the -1-sentinel fallbacks fire.
    expect(alignments.every(a => a.matched)).toBe(true);
    return { segments, tokens, alignments };
  }

  it('places the boundary at the midpoint of a detected silence between two covered segments', () => {
    const { segments, tokens, alignments } = twoCoveredSegments();
    // Deliberately OFF-CENTRE (mid 1.75, not the 1.5 token midpoint) so this
    // asserts the silence was actually used, not merely that the fallback
    // happened to agree.
    const silences: SilenceInterval[] = [{ startSec: 1.6, endSec: 1.9 }];

    const out = snapCoveredBoundaries(segments, alignments, tokens, silences, 5);

    expect(out[1]!.startTime).toBeCloseTo(1.75, 6);
    expect(out[1]!.anchorStart).toBeCloseTo(1.75, 6);
    // Durations come from the boundary — this is the re-tile, subsumed.
    expect(out[0]!.duration).toBeCloseTo(1.75, 6);
    expect(out[1]!.duration).toBeCloseTo(3.25, 6);
    // Contiguous: no gap left behind.
    expect(out[0]!.startTime + out[0]!.duration).toBeCloseTo(out[1]!.startTime, 6);
  });

  it('falls back to the spoken-word midpoint when no silence overlaps the search window', () => {
    const { segments, tokens, alignments } = twoCoveredSegments();

    const out = snapCoveredBoundaries(segments, alignments, tokens, [], 5);

    // lastSpokenEnd 1.0, nextSpokenStart 2.0 -> 1.5.
    expect(out[1]!.startTime).toBeCloseTo(1.5, 6);
    expect(out[1]!.anchorStart).toBeCloseTo(1.5, 6);
    expect(out[0]!.duration).toBeCloseTo(1.5, 6);
    expect(out[1]!.duration).toBeCloseTo(3.5, 6);
  });

  it('does NOT clamp a silence midpoint that sits beyond ±0.15s of the spoken edges (both directions)', () => {
    // Silence-sharing fix: a detected silence is acoustic ground truth and
    // outranks Whisper's word timestamps in both directions — there is no
    // clamp on this branch at all (the old fallback-only clamps are gone).
    //
    // Updated for intra-segment silence rejection (2026-08-01): a pause inside
    // a segment's own speech is not a boundary. The original fixtures here
    // ([2.3, 2.9] and [0.2, 0.7]) were written purely to test the ABSENCE of a
    // ±0.15s clamp, but geometrically both were intra-segment pauses — one
    // entirely after nextSpokenStart (2.0), one entirely before lastSpokenEnd
    // (1.0) — so neither is a boundary candidate anymore. Both are replaced
    // with silences that SPAN their boundary (the only kind a real pause
    // between two segments can be) while still having a centre well outside
    // ±0.15s of the spoken edges, which preserves this test's original intent
    // and its exact assertion shape. The intra-segment cases the old fixtures
    // accidentally described are now asserted deliberately, and in the correct
    // direction, by the two "rejects a silence that…" tests below.
    //
    // Forward: a silence spanning nextSpokenStart (2.0), centred at 2.475 —
    // well past the old forward clamp target of 2.15.
    {
      const { segments, tokens, alignments } = twoCoveredSegments();
      const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 1.95, endSec: 3.0 }], 5);
      expect(out[1]!.startTime).toBeCloseTo(2.475, 6);         // NOT 2.15
      expect(out[1]!.startTime).toBeGreaterThan(2.0 + 0.15);
    }
    // Backward: a silence spanning lastSpokenEnd (1.0), centred at 0.625 —
    // well before the old backward clamp target of 0.85.
    {
      const { segments, tokens, alignments } = twoCoveredSegments();
      const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 0.2, endSec: 1.05 }], 5);
      expect(out[1]!.startTime).toBeCloseTo(0.625, 6);         // NOT 0.85
      expect(out[1]!.startTime).toBeLessThan(1.0 - 0.15);
    }
  });

  it('leaves a silence centre that already sits near the spoken edges untouched (no regression)', () => {
    // The pre-fix behaviour for a near-edge silence was already "use the
    // silence centre" — this asserts the removal changed nothing for that case.
    const { segments, tokens, alignments } = twoCoveredSegments();
    const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 1.4, endSec: 1.7 }], 5);
    const boundary = out[1]!.startTime;
    expect(boundary).toBeCloseTo(1.55, 6);
  });

  it('no-silence fallback boundary = token midpoint, no clamps applied', () => {
    // Fallback = the spoken-word midpoint (1.5) exactly, with no clamp
    // post-processing — the old clamp block no longer exists.
    const { segments, tokens, alignments } = twoCoveredSegments();
    const out = snapCoveredBoundaries(segments, alignments, tokens, [], 5);
    expect(out[1]!.startTime).toBeCloseTo((1.0 + 2.0) / 2, 6);
  });

  it('no-silence fallback with inverted bounds (lastSpokenEnd > nextSpokenStart) still lands at the plain midpoint', () => {
    // Degenerate case: the two segments' spoken words sit too close together
    // (or overlap) for a clean boundary. There are no clamps to resolve this
    // anymore — the honest answer is just the midpoint of the two spoken edges.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo', startTime: 0, duration: 2, anchorStart: 0, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta', startTime: 1.6, duration: 1.4, anchorStart: 1.6, anchorSource: 'whisper' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 1.0 },
      { text: 'bravo', startSec: 1.0, endSec: 2.0 },   // lastSpokenEnd = 2.0
      { text: 'charlie', startSec: 1.6, endSec: 2.4 }, // nextSpokenStart = 1.6 (< lastSpokenEnd)
      { text: 'delta', startSec: 2.4, endSec: 3.0 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    const out = snapCoveredBoundaries(segments, alignments, tokens, [], 3);
    expect(out[1]!.startTime).toBeCloseTo((2.0 + 1.6) / 2, 6);
  });

  it('reproduces the 14-segment regression: silence 6.56-7.12 vs nextSpokenStart 6.40 keeps the 6.84 centre', () => {
    // The exact shape of pair i=2 on the reported 14-segment project. Before the
    // silence-sharing fix a forward clamp would have pulled the boundary to
    // BEFORE the silence even started (6.55), handing the whole 0.56s silence
    // to the next segment. The boundary must be the silence centre, 6.84, so
    // the two segments share the silence evenly.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo', startTime: 5.3, duration: 1.1, anchorStart: 5.3, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta', startTime: 6.4, duration: 1.6, anchorStart: 6.4, anchorSource: 'whisper' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 5.30, endSec: 5.80 },
      { text: 'bravo', startSec: 5.80, endSec: 6.30 },   // lastSpokenEnd = 6.30
      { text: 'charlie', startSec: 6.40, endSec: 7.20 }, // nextSpokenStart = 6.40
      { text: 'delta', startSec: 7.20, endSec: 8.00 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 6.56, endSec: 7.12 }], 8);

    expect(out[1]!.startTime).toBeCloseTo(6.84, 6);
    expect(out[1]!.startTime).not.toBeCloseTo(6.4 + 0.15, 6); // the old 6.55
    // The silence really is shared 50/50 either side of the boundary.
    expect(out[1]!.startTime - 6.56).toBeCloseTo(7.12 - out[1]!.startTime, 6);
    // …and the aligner's own snap agrees, so preview and the covered re-snap
    // cannot drift apart on this pair.
    const viaAligner = alignScenestoTranscript(segments, tokens, [{ startSec: 6.56, endSec: 7.12 }]);
    expect(viaAligner[1]!.t0).toBeCloseTo(6.84, 6);
  });

  it('contention-aware assignment gives a contested silence to its better-fitting pair, needing no monotonic fallback here', () => {
    // Three covered segments; same fixture as the pre-contention-aware-fix
    // version of this test. Silence A [2.10, 3.10] (centre 2.60) actually
    // overlaps BOTH pair 0's window [0.6, 2.2] and pair 1's window [2.0, 2.75]
    // (the two windows overlap each other in [2.0, 2.2]) — the old greedy
    // left-to-right walk let pair 0 claim it first simply because pair 0 ran
    // first, even though A is a much worse fit for pair 0 (|2.60-1.5|=1.10)
    // than for pair 1 (|2.60-2.25|=0.35). That forced pair 1 into its
    // second-best silence B (centre 2.35), which is LESS than pair 0's
    // already-committed 2.6 — tripping the monotonic safety net down to an
    // unclamped 2.25 fallback.
    //
    // Updated for contention-aware silence claiming (2026-07-30): A is now
    // assigned to whichever pair's own spoken midpoint it's actually closer
    // to — pair 1 — leaving pair 0 with no assigned silence at all (honest
    // token-midpoint fallback, 1.5) and pair 1 with BOTH A and B as
    // candidates, of which B (0.10 from pair 1's own midpoint) is still the
    // closer pick. Pair 1 lands on 2.35 directly and monotonically; the
    // safety net this test used to exercise never needs to fire for this
    // fixture, because contention-aware assignment resolves the
    // non-monotonicity before the safety net would even see it. This is a
    // strictly better outcome, not merely a different one: pair 1 gets its
    // genuinely-closer silence instead of an unclamped fallback, and pair 0 —
    // left with nothing — honestly reports its own token midpoint instead of
    // overshooting onto a silence that was never really its own.
    //
    // COVERAGE NOTE: this was the only fixture in this suite that exercised
    // snapCoveredBoundaries's monotonic-fallback branch on a silence-derived
    // (not token-midpoint) proposal. This change removes its ability to
    // trigger that branch. A replacement fixture would need two genuinely
    // NON-shared, inverted-order silences (each exclusively visible to its
    // own pair) rather than one contested one — not constructed here; see the
    // audit report for this gap.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo', startTime: 0, duration: 2, anchorStart: 0 }),
      makeSegment({ id: 's1', order: 1, text: 'charlie', startTime: 2, duration: 0.3, anchorStart: 2 }),
      makeSegment({ id: 's2', order: 2, text: 'delta echo', startTime: 2.3, duration: 1.2, anchorStart: 2.3 }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 0.5 },
      { text: 'bravo', startSec: 0.5, endSec: 1.0 },   // pair 0 lastSpokenEnd = 1.0
      { text: 'charlie', startSec: 2.0, endSec: 2.2 }, // pair 0 nextSpokenStart = 2.0
      { text: 'delta', startSec: 2.3, endSec: 2.8 },   // pair 1 nextSpokenStart = 2.3
      { text: 'echo', startSec: 2.8, endSec: 3.3 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    const silences: SilenceInterval[] = [
      { startSec: 2.10, endSec: 3.10 }, // A — centre 2.60, contested by pair 0 AND pair 1; assigned to pair 1 (closer fit)
      { startSec: 2.25, endSec: 2.45 }, // B — centre 2.35, only pair 1 can see it
    ];
    const out = snapCoveredBoundaries(segments, alignments, tokens, silences, 5);

    expect(out[1]!.startTime).toBeCloseTo(1.5, 6);  // pair 0 → no assigned silence, token-midpoint fallback
    expect(out[2]!.startTime).toBeCloseTo(2.35, 6); // pair 1 → silence B (closer than the reassigned A), no fallback needed
  });

  // -------------------------------------------------------------------------
  // Intra-segment silence rejection (2026-08-01)
  //
  // Confirmed in production via the [snap-diag] pair log: a pair with
  // touching tokens (spokenGapWidth 0 → the fixed 1.0s search radius) has a
  // window that reaches BACKWARDS past its own trailing spoken words — the
  // searchStart clamp uses currFirstSpokenStart, which sits before any
  // mid-segment pause. A breath INSIDE the current segment's own speech then
  // overlaps the window and wins the closest-centre pick, placing the boundary
  // before the segment finished speaking and handing its trailing words to the
  // next segment ("the worst" moved a whole phrase downstream).
  //
  // A silence that ends before lastSpokenEnd is separated from the boundary by
  // speech — it is an intra-segment pause, not a boundary pause, and is not a
  // boundary candidate at all. Same, mirrored, for a silence that starts after
  // nextSpokenStart.
  //
  // Both comparisons are relaxed by BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC
  // (0.3s), because the spoken edges themselves are Whisper timestamps with
  // ~±0.3s of error. So the three cases below: intrusion DEEPER than the
  // tolerance is rejected (the two "rejects…" tests), intrusion SHALLOWER than
  // it is accepted (the "accepts…" test).
  // -------------------------------------------------------------------------
  it('rejects a silence that ends well before the current segment stops speaking', () => {
    // Production shape (real pair 4: touching tokens → spokenGapWidth 0 → the
    // fixed 1.0s radius), with seg0's speech carried past the breath so the
    // intrusion clears the tolerance: seg0's last word ends at 19.20 and the
    // breath at [18.32, 18.70] ends 0.50s before that — well past the 0.30s
    // that Whisper edge blur can account for, so it is a real mid-sentence
    // pause. Both silences fall inside the pair's window [18.20, 20.20]; the
    // deep one is the one the span test has to reject on its own merits.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie', startTime: 17.5, duration: 1.7, anchorStart: 17.5, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'delta echo', startTime: 19.2, duration: 1.0, anchorStart: 19.2, anchorSource: 'whisper' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha',   startSec: 17.50, endSec: 18.00 },
      { text: 'bravo',   startSec: 18.00, endSec: 18.32 },
      // ...a breath here, 18.32 → 18.70, INSIDE seg0's own speech...
      { text: 'charlie', startSec: 18.70, endSec: 19.20 }, // lastSpokenEnd = 19.20
      { text: 'delta',   startSec: 19.20, endSec: 19.70 }, // nextSpokenStart = 19.20
      { text: 'echo',    startSec: 19.70, endSec: 20.20 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    const silences: SilenceInterval[] = [
      { startSec: 17.68, endSec: 18.08 }, // intrusion 1.12s — rejected
      { startSec: 18.32, endSec: 18.70 }, // intrusion 0.50s — rejected (> 0.30s tolerance)
    ];
    const out = snapCoveredBoundaries(segments, alignments, tokens, silences, 25);

    // Both rejected, so the pair falls back to the token midpoint — which here
    // IS the true sentence end, 19.20 — instead of the breath centre 18.51.
    expect(out[1]!.startTime).toBeCloseTo(19.20, 6);
    expect(out[1]!.startTime).not.toBeCloseTo(18.51, 3);
    expect(out[0]!.duration).toBeCloseTo(19.20 - 17.5, 6);
  });

  it('rejects a silence that starts well after the next segment begins speaking (mirrored case)', () => {
    // The same defect mirrored: a breath inside the NEXT segment's opening
    // words. Left uncorrected it lets the CURRENT segment reach forward and
    // steal the next segment's first word. The breath starts at 19.35, i.e.
    // 0.48s after nextSpokenStart (18.87) — past the 0.30s tolerance.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo', startTime: 17.5, duration: 1.37, anchorStart: 17.5, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta echo', startTime: 18.87, duration: 1.63, anchorStart: 18.87, anchorSource: 'whisper' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha',   startSec: 17.50, endSec: 18.20 },
      { text: 'bravo',   startSec: 18.20, endSec: 18.87 }, // lastSpokenEnd = 18.87
      { text: 'charlie', startSec: 18.87, endSec: 19.35 }, // nextSpokenStart = 18.87
      // ...a breath here, 19.35 → 19.80, INSIDE seg1's own speech...
      { text: 'delta',   startSec: 19.80, endSec: 20.10 },
      { text: 'echo',    startSec: 20.10, endSec: 20.50 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    const silences: SilenceInterval[] = [{ startSec: 19.35, endSec: 19.80 }];
    const out = snapCoveredBoundaries(segments, alignments, tokens, silences, 25);

    // Rejected → token midpoint 18.87, not the silence centre 19.575 (which
    // would have swallowed "charlie" into the previous segment).
    expect(out[1]!.startTime).toBeCloseTo(18.87, 6);
    expect(out[1]!.startTime).not.toBeCloseTo(19.575, 3);
  });

  // -------------------------------------------------------------------------
  // Token-gap discrimination (2026-08-01, second evidence source)
  //
  // The tolerance above is a TIMESTAMP heuristic — it tries to correct
  // Whisper's timestamp error using Whisper's timestamps. It therefore cannot
  // separate the two things that look identical inside the 0.30s band:
  //
  //   (a) a mid-sentence BREATH — the silence fills the gap between two
  //       consecutive tokens that BOTH belong to one segment's matched span;
  //   (b) a real boundary pause MISLABELLED — the silence lies INSIDE a single
  //       stretched token's span, because Whisper smeared that word across the
  //       pause following it.
  //
  // `fillsTokenGapWithinSpan` supplies independent ALIGNMENT evidence: the
  // Hirschberg text match says which segment owns each word, and it says so
  // without consulting a single timestamp. When the alignment says two words
  // are both mine, a pause between them is mine too — a breath, never a
  // boundary. Each segment owns its full spoken text, breaths included.
  //
  // The four tests below pin both sides of that distinction inside the
  // tolerance band, plus the merged-interval residual the rule deliberately
  // does not close.
  // -------------------------------------------------------------------------
  it('rejects a sub-tolerance intrusion when the silence fills a gap between two of the current segment\'s own tokens', () => {
    // The real production pair-4 geometry, unmodified — and the case that
    // motivated token-gap discrimination in the first place. Before it, this
    // fixture asserted the OPPOSITE (boundary 18.51): seg0's last word
    // nominally ends at 18.87 and the silence [18.32, 18.70] ends only 0.17s
    // before that, inside the 0.30s tolerance, so the silence won as "edge
    // blur". That was wrong, and production proved it — "charlie" here stands
    // for the real pair's trailing phrase ("the worst"), which a boundary at
    // 18.51 splits away from its own sentence and hands downstream.
    //
    // The alignment evidence settles it: [18.32, 18.70] fits EXACTLY between
    // bravo (ends 18.32) and charlie (starts 18.70), two consecutive tokens of
    // seg0's OWN matched span. It is seg0's breath. Rejected regardless of how
    // shallow the intrusion is — an alignment fact is not forgivable by a
    // timestamp tolerance.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie', startTime: 17.5, duration: 1.37, anchorStart: 17.5, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'delta echo', startTime: 18.87, duration: 1.03, anchorStart: 18.87, anchorSource: 'whisper' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha',   startSec: 17.50, endSec: 18.00 },
      { text: 'bravo',   startSec: 18.00, endSec: 18.32 },
      // ...seg0's own breath here, 18.32 → 18.70, between two of ITS tokens...
      { text: 'charlie', startSec: 18.70, endSec: 18.87 }, // lastSpokenEnd = 18.87
      { text: 'delta',   startSec: 18.87, endSec: 19.40 }, // nextSpokenStart = 18.87
      { text: 'echo',    startSec: 19.40, endSec: 19.90 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 18.32, endSec: 18.70 }], 25);

    // Rejected → the token midpoint. Both spoken edges are 18.87 (touching
    // tokens), so the midpoint is 18.87 exactly: "charlie" ends ON the
    // boundary and stays with seg0, which keeps its full 1.37s of speech.
    expect(out[1]!.startTime).toBeCloseTo(18.87, 6);
    expect(out[1]!.startTime).not.toBeCloseTo(18.51, 3); // the pre-fix breath centre
    expect(out[0]!.duration).toBeCloseTo(1.37, 6);
  });

  it('accepts a sub-tolerance silence INSIDE the current segment\'s last token (stretched word, not a breath)', () => {
    // The other side of the same 0.17s intrusion — and the reason the
    // tolerance's backward accept path must survive token-gap discrimination.
    // Geometrically almost identical to the test above, with ONE difference
    // that changes everything: seg0's final word is a single STRETCHED token
    // (bravo, 18.00 → 18.87) smeared across the pause, so the silence
    // [18.32, 18.70] lies token-INTERIOR — there is no gap between two of
    // seg0's tokens for it to fill. No alignment evidence exists against it,
    // so the tolerance decides, and the silence — acoustic ground truth — wins.
    //
    // This is the deliberate trade the tolerance still makes. Without this
    // fixture the rewrite above would leave the backward accept path with zero
    // coverage.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo', startTime: 17.5, duration: 1.37, anchorStart: 17.5, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta', startTime: 18.87, duration: 1.03, anchorStart: 18.87, anchorSource: 'whisper' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha',   startSec: 17.50, endSec: 18.00 },
      { text: 'bravo',   startSec: 18.00, endSec: 18.87 }, // stretched across the pause; lastSpokenEnd = 18.87
      { text: 'charlie', startSec: 18.87, endSec: 19.40 }, // nextSpokenStart = 18.87
      { text: 'delta',   startSec: 19.40, endSec: 19.90 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 18.32, endSec: 18.70 }], 25);

    // Accepted → the silence centre, not the token midpoint 18.87.
    expect(out[1]!.startTime).toBeCloseTo(18.51, 6);
  });

  it('rejects a sub-tolerance breath filling a gap between the NEXT segment\'s first two tokens', () => {
    // The mirror of the rewritten fixture above, and previously unguarded: the
    // breath sits between the NEXT segment's first two tokens (charlie ends
    // 19.04, delta starts 19.40). Its intrusion past nextSpokenStart (18.87) is
    // only 0.17s — inside the tolerance — so before token-gap discrimination
    // the silence won at centre 19.22, reaching forward to steal "charlie"
    // from the segment that actually speaks it.
    //
    // The pre-existing mirrored rejection test above uses a 0.48s intrusion,
    // which the tolerance already rejected on its own; this one lives in the
    // band only the alignment evidence can decide.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo', startTime: 17.5, duration: 1.37, anchorStart: 17.5, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta echo', startTime: 18.87, duration: 1.43, anchorStart: 18.87, anchorSource: 'whisper' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha',   startSec: 17.50, endSec: 18.20 },
      { text: 'bravo',   startSec: 18.20, endSec: 18.87 }, // lastSpokenEnd = 18.87
      { text: 'charlie', startSec: 18.87, endSec: 19.04 }, // nextSpokenStart = 18.87
      // ...seg1's own breath here, 19.04 → 19.40, between two of ITS tokens...
      { text: 'delta',   startSec: 19.40, endSec: 19.90 },
      { text: 'echo',    startSec: 19.90, endSec: 20.30 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 19.04, endSec: 19.40 }], 25);

    // Rejected → token midpoint 18.87, so "charlie" stays with seg1.
    expect(out[1]!.startTime).toBeCloseTo(18.87, 6);
    expect(out[1]!.startTime).not.toBeCloseTo(19.22, 3); // the pre-fix breath centre
  });

  it('rejects a mid-sentence pause regardless of its width (the rule is width-independent)', () => {
    // A 1.20s pause — far longer than any of the fixtures above, and longer
    // than the whole 0.30s tolerance band — taken between two words of the
    // SAME segment. Width is not part of the predicate and must not become
    // part of it: what makes this a breath is WHOSE words surround it, not how
    // long it lasts.
    //
    // The intrusion is deliberately sub-tolerance (seg0's trailing word runs
    // 19.10 → 19.30, so the silence ends 0.20s before lastSpokenEnd), which is
    // what stops the pre-existing tolerance test from covering this: before
    // token-gap discrimination the silence won at centre 18.50, cutting seg0
    // off 0.80s before it stopped speaking.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie', startTime: 17.5, duration: 1.8, anchorStart: 17.5, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'delta echo', startTime: 19.3, duration: 1.0, anchorStart: 19.3, anchorSource: 'whisper' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha',   startSec: 17.50, endSec: 17.70 },
      { text: 'bravo',   startSec: 17.70, endSec: 17.90 },
      // ...a LONG mid-sentence pause here, 17.90 → 19.10 (1.20s)...
      { text: 'charlie', startSec: 19.10, endSec: 19.30 }, // lastSpokenEnd = 19.30
      { text: 'delta',   startSec: 19.30, endSec: 19.80 }, // nextSpokenStart = 19.30
      { text: 'echo',    startSec: 19.80, endSec: 20.30 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 17.90, endSec: 19.10 }], 25);

    // Rejected → token midpoint 19.30, not the 1.20s pause's centre 18.50.
    expect(out[1]!.startTime).toBeCloseTo(19.30, 6);
    expect(out[1]!.startTime).not.toBeCloseTo(18.50, 3);
  });

  it('REGRESSION: real pair-4 production geometry (4 touching micro-tokens) — fillsTokenGapWithinSpan cannot fire, isBreathSilence rejects it as a multi-fragment breath', () => {
    // The ACTUAL production pair-4 shape (as opposed to the 3-token
    // simplification used by the fixture above), confirmed via the
    // [snap-diag] pair-log instrumentation: seg0's tail is FOUR touching
    // micro-tokens, not three, and the breath [18.32, 18.70] straddles THREE
    // of them (t2 overlap 0.14s, t3 overlap 0.09s — the whole of t3 — and t4
    // overlap 0.15s), none of which individually forms a clean two-token gap
    // for fillsTokenGapWithinSpan to fit (every token here touches its
    // neighbor, so there is no gap at all — the tokens themselves are
    // dense enough that the silence just runs across several of them).
    //
    // Pre-fix, this collapses to fillsTokenGapWithinSpan alone: containment
    // finds no gap (asserted directly below) and isBoundarySilenceCandidate's
    // tolerance accepts the shallow 0.17s intrusion as edge blur — the exact
    // pre-token-gap-discrimination failure mode, landing on the breath centre
    // 18.51 and splitting seg0's real trailing words away from their own
    // sentence.
    //
    // isBreathSilence closes it independently of containment: two of the
    // silence's three touched tokens (t2 and t3) are INTERIOR to seg0's span
    // (strictly between its first and last token) and each clears
    // BREATH_TOKEN_OVERLAP_FLOOR_SEC (t3 exactly, at the floor) — two
    // sandwiched fragments at full (1.0) coverage is the multi-fragment
    // override, independent of the containment test entirely.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta', startTime: 17.92, duration: 0.95, anchorStart: 17.92, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'echo foxtrot', startTime: 18.87, duration: 1.03, anchorStart: 18.87, anchorSource: 'whisper' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha',   startSec: 17.92, endSec: 18.17 },
      { text: 'bravo',   startSec: 18.17, endSec: 18.46 },
      // ...the breath, 18.32 → 18.70, straddling bravo/charlie/delta...
      { text: 'charlie', startSec: 18.46, endSec: 18.55 },
      { text: 'delta',   startSec: 18.55, endSec: 18.87 }, // lastSpokenEnd = 18.87
      { text: 'echo',    startSec: 18.87, endSec: 19.40 }, // nextSpokenStart = 18.87
      { text: 'foxtrot', startSec: 19.40, endSec: 19.90 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    // Containment genuinely cannot fire here — every token touches its
    // neighbor, so there is no clean two-token gap the silence fits inside.
    expect(fillsTokenGapWithinSpan({ startSec: 18.32, endSec: 18.70 }, tokens, 0, 3)).toBe(false);
    // The coverage-composite predicate rejects it directly, on the curr side.
    expect(isBreathSilence({ startSec: 18.32, endSec: 18.70 }, tokens, 0, 3)).toBe(true);

    const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 18.32, endSec: 18.70 }], 25);

    // Rejected → the token midpoint, 18.87 (both spoken edges touch there) —
    // not the pre-fix breath centre 18.51.
    expect(out[1]!.startTime).toBeCloseTo(18.87, 6);
    expect(out[1]!.startTime).not.toBeCloseTo(18.51, 3);
  });

  it('a silence reaching past the segment\'s last word: fillsTokenGapWithinSpan still cannot fire, but isBreathSilence closes it (residual CLOSED, 2026-08-01)', () => {
    // FORMERLY a documented-open residual; CLOSED by coverage-composite breath
    // discrimination (isBreathSilence, syncConstants.ts). The
    // `fillsTokenGapWithinSpan` limitation itself is UNCHANGED and still
    // directly unit-tested below ("cannot fire when the silence reaches past
    // the span's last token"): it tests CONTAINMENT, needing a token of the
    // span on BOTH sides of the silence, and a silence that starts inside a
    // token gap but runs PAST lastSpokenEnd has no following token inside the
    // span, so that ONE predicate structurally cannot fire.
    //
    // What changed is the composed Pass 1 filter no longer depends on that
    // predicate alone. This is the merged-interval case: the silence detector
    // swallowed a breath, a quiet word, and the real trailing pause into one
    // interval (only possible when that word stays under silenceDetector's
    // -45dB threshold). isBreathSilence's independent coverage-ratio branch
    // catches it: seg0's span here is [alpha, bravo, charlie], and the silence
    // [18.32, 18.90] covers only alpha's 0s + bravo's 0s + charlie's 0.17s of
    // actual token time against its own 0.58s width — a 0.293 ratio, just
    // under BREATH_MAX_SPEECH_COVERAGE_RATIO (0.3), so it rejects as "mostly
    // empty air" independent of containment. Both spoken edges are 18.87
    // (touching tokens), so the boundary lands squarely on the token
    // midpoint — 18.87, not the old 18.61 that split "charlie" — and "charlie"
    // stays with seg0.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie', startTime: 17.5, duration: 1.37, anchorStart: 17.5, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'delta echo', startTime: 18.87, duration: 1.03, anchorStart: 18.87, anchorSource: 'whisper' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha',   startSec: 17.50, endSec: 18.00 },
      { text: 'bravo',   startSec: 18.00, endSec: 18.32 },
      { text: 'charlie', startSec: 18.70, endSec: 18.87 }, // lastSpokenEnd = 18.87
      { text: 'delta',   startSec: 18.87, endSec: 19.40 }, // nextSpokenStart = 18.87
      { text: 'echo',    startSec: 19.40, endSec: 19.90 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    // Starts in seg0's token gap (18.32) but ends past lastSpokenEnd (18.90 >
    // 18.87) — no following token of the span sits after it, so
    // fillsTokenGapWithinSpan still cannot fire on this silence directly.
    expect(fillsTokenGapWithinSpan({ startSec: 18.32, endSec: 18.90 }, tokens, 0, 2)).toBe(false);

    const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 18.32, endSec: 18.90 }], 25);

    expect(out[1]!.startTime).toBeCloseTo(18.87, 6);
    expect(out[1]!.startTime).not.toBeCloseTo(18.61, 3); // the old, open-residual answer
    expect(out[0]!.duration).toBeCloseTo(1.37, 6);
  });

  it('extends the last kept segment to audioDuration', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo', startTime: 0, duration: 1, anchorStart: 0 }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta', startTime: 2, duration: 1, anchorStart: 2 }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot', startTime: 4, duration: 1, anchorStart: 4 }),
    ];
    const tokens = [
      ...wordTokens('alpha bravo', 0, 0.5),
      ...wordTokens('charlie delta', 2.0, 0.5),
      ...wordTokens('echo foxtrot', 4.0, 0.5),
    ];
    const alignments = extractSegmentAlignments(segments, tokens);

    const out = snapCoveredBoundaries(segments, alignments, tokens, [], 12);

    const last = out[out.length - 1]!;
    expect(last.startTime + last.duration).toBeCloseTo(12, 6);
    // …and the whole timeline is still contiguous from 0 to audioDuration.
    expect(out[0]!.startTime).toBe(0);
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i]!.startTime + out[i]!.duration).toBeCloseTo(out[i + 1]!.startTime, 6);
    }
  });

  it('never moves or shrinks a locked segment', () => {
    const { segments, tokens, alignments } = twoCoveredSegments();
    const locked = segments.map((s, i) => (i === 1 ? { ...s, locked: true } : s));

    const out = snapCoveredBoundaries(locked, alignments, tokens, [{ startSec: 1.6, endSec: 1.9 }], 5);

    // The pair touches a locked segment, so the boundary is left exactly as
    // supplied — startTime, anchorStart and duration all untouched.
    expect(out[1]!.startTime).toBe(2);
    expect(out[1]!.anchorStart).toBe(2);
    expect(out[1]!.duration).toBe(3);
    expect(out[0]!.duration).toBe(2);
  });

  it('does not mutate the input segments', () => {
    const { segments, tokens, alignments } = twoCoveredSegments();
    const before = segments.map(s => ({ ...s }));

    snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 1.6, endSec: 1.9 }], 5);

    expect(segments).toEqual(before);
  });
});

// ===========================================================================
// Direct unit tests for the two candidacy predicates (snapBoundaries.ts).
//
// Both are pure and exported precisely so their semantics can be pinned
// without constructing a whole segment/alignment fixture. Every case above
// reaches them only THROUGH snapCoveredBoundaries, which means a change to
// either predicate's boundary semantics could previously slip through
// whenever no end-to-end fixture happened to sit on that boundary.
// ===========================================================================
describe('fillsTokenGapWithinSpan — alignment-evidence predicate', () => {
  // Two tokens with a real 0.4s gap between them, both inside one span.
  const GAPPED: TranscriptToken[] = [
    { text: 'alpha', startSec: 0.0, endSec: 1.0 },
    { text: 'bravo', startSec: 1.4, endSec: 2.0 },
  ];

  it('fires on an exact fit between two consecutive tokens of the span', () => {
    expect(fillsTokenGapWithinSpan({ startSec: 1.0, endSec: 1.4 }, GAPPED, 0, 1)).toBe(true);
  });

  it('is false for a single-token span — no internal gap exists to fill', () => {
    // The starvation-cascade fixture is entirely single-token spans; this is
    // why the rule is structurally unable to disturb it.
    expect(fillsTokenGapWithinSpan({ startSec: 1.0, endSec: 1.4 }, GAPPED, 0, 0)).toBe(false);
  });

  it('is false for a sentinel (-1) span — unmatched segments carry no usable indices', () => {
    // snapCoveredBoundaries never sees a sentinel (it runs on covered-only
    // segments), but the aligner's full-array path does — this guard is what
    // would make the predicate safe to reuse there.
    expect(fillsTokenGapWithinSpan({ startSec: 1.0, endSec: 1.4 }, GAPPED, -1, -1)).toBe(false);
  });

  it('is false when the silence swallows a whole token rather than sitting in one gap', () => {
    const tokens: TranscriptToken[] = [
      { text: 'alpha',   startSec: 0.0, endSec: 1.0 },
      { text: 'bravo',   startSec: 1.5, endSec: 2.0 },
      { text: 'charlie', startSec: 2.5, endSec: 3.0 },
    ];
    // [1.0, 2.5] covers 'bravo' entirely — it fits in NO single gap, so this is
    // not the within-speech breath the rule identifies.
    expect(fillsTokenGapWithinSpan({ startSec: 1.0, endSec: 2.5 }, tokens, 0, 2)).toBe(false);
  });

  it('is false for overlapping/duplicate tokens at any realistic silence length', () => {
    // Whisper emits these (endSec past the next token's startSec). A negative
    // gap can only admit a silence shorter than 2*epsilon (0.04s), and the
    // detector floors real silences at minDurationSec (0.25s) — so the rule is
    // structurally unreachable by duplicate-token noise, not merely untuned
    // for it.
    const overlapping: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 1.0 },
      { text: 'bravo', startSec: 0.9, endSec: 2.0 }, // starts BEFORE alpha ends
    ];
    expect(fillsTokenGapWithinSpan({ startSec: 1.0, endSec: 1.25 }, overlapping, 0, 1)).toBe(false);
    expect(2 * TOKEN_GAP_EPSILON_SEC).toBeLessThan(0.25); // the guarantee, asserted
  });

  it('cannot fire when the silence reaches past the span\'s last token (the documented residual)', () => {
    // Containment, not majority-overlap: no token of the span follows the
    // silence, so the second condition can never be met. This is the
    // merged breath+word+pause case, pinned end-to-end by its own fixture.
    expect(fillsTokenGapWithinSpan({ startSec: 1.0, endSec: 2.5 }, GAPPED, 0, 1)).toBe(false);
  });

  it('walks the whole index RANGE, including interior tokens the segment never matched', () => {
    // Hirschberg insertion (e.g. a Whisper hallucination) sitting inside the
    // span. It still occupies audio time inside this segment's speech, so a
    // silence in the gap beside it is still this segment's breath.
    const withInsertion: TranscriptToken[] = [
      { text: 'alpha',       startSec: 0.0, endSec: 1.0 },
      { text: 'hallucinated', startSec: 1.4, endSec: 1.6 }, // matched by nothing
      { text: 'charlie',     startSec: 2.0, endSec: 3.0 },
    ];
    expect(fillsTokenGapWithinSpan({ startSec: 1.0, endSec: 1.4 }, withInsertion, 0, 2)).toBe(true);
  });

  it('absorbs one analysis frame of edge quantization, but no more', () => {
    // Each silence edge pushed 0.01s outside the true gap — inside the 20ms
    // frame the detector quantizes to, so still a fit.
    expect(fillsTokenGapWithinSpan({ startSec: 0.99, endSec: 1.41 }, GAPPED, 0, 1)).toBe(true);
    // 0.05s outside on the leading edge — beyond quantization, no longer a fit.
    expect(fillsTokenGapWithinSpan({ startSec: 0.95, endSec: 1.41 }, GAPPED, 0, 1)).toBe(false);
  });
});

describe('isBoundarySilenceCandidate — plain window-overlap predicate', () => {
  // REGRESSION FIX (2026-08-03): this predicate used to also reject a silence
  // whose edge intruded more than BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC
  // (0.3s) past the pair's own spoken edges (lastSpokenEnd/nextSpokenStart).
  // Bisected against a real production project, that tolerance was found to
  // reject genuine inter-segment silences wholesale — real trailing-word
  // timestamps blur into the following pause by more than 0.3s routinely —
  // clamping every such boundary to the (blurred) speech end. The SPAN
  // condition is deleted, not re-tuned (see the function's own doc comment);
  // this predicate is now pure window overlap, matching pre-regression
  // (commit 0c83a06) behavior. The intra-segment/breath rejection job it used
  // to share is fully covered by `fillsTokenGapWithinSpan` / `isBreathSilence`
  // above, which use alignment evidence, not a timestamp guess.
  const WINDOW_START = 1.0;
  const WINDOW_END = 4.0;
  const call = (silence: SilenceInterval) =>
    isBoundarySilenceCandidate(silence, WINDOW_START, WINDOW_END);

  it('accepts a silence inside the window that spans the pair\'s spoken gap', () => {
    expect(call({ startSec: 2.2, endSec: 2.8 })).toBe(true);
  });

  it('rejects a silence entirely before the window', () => {
    expect(call({ startSec: 0.2, endSec: 0.9 })).toBe(false);
  });

  it('rejects a silence entirely after the window', () => {
    expect(call({ startSec: 4.5, endSec: 5.0 })).toBe(false);
  });

  it('window overlap is strict — merely touching either edge is not overlap', () => {
    expect(call({ startSec: 0.5, endSec: WINDOW_START })).toBe(false);
    expect(call({ startSec: WINDOW_END, endSec: 4.5 })).toBe(false);
  });

  it('accepts a silence deep inside where the CURRENT segment\'s speech used to be, as long as it overlaps the window — no longer rejected on edge-distance alone', () => {
    expect(call({ startSec: 1.1, endSec: 1.5 })).toBe(true);
  });

  it('accepts a silence deep inside where the NEXT segment\'s speech used to be, as long as it overlaps the window — no longer rejected on edge-distance alone', () => {
    expect(call({ startSec: 3.5, endSec: 3.9 })).toBe(true);
  });
});

describe('isBreathSilence — coverage-composite predicate (iteration 3)', () => {
  it('extent-gate: a silence barely touching the tested span (majority elsewhere) is false regardless of everything else', () => {
    // Classic inter-segment silence: it sits mostly in the NEXT segment's
    // territory, so a call against the CURR side's span must gate out before
    // even computing a ratio. Span [0,1]; silence overlaps only [0.9,1.0] of
    // its own [0.9,2.0] width — overlapFrac = 0.1/1.1, well under 0.5.
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 0.5 },
      { text: 'bravo', startSec: 0.5, endSec: 1.0 },
    ];
    expect(isBreathSilence({ startSec: 0.9, endSec: 2.0 }, tokens, 0, 1)).toBe(false);
  });

  it('ratio-only rejection: a silence mostly empty of any span speech rejects even with zero interior tokens', () => {
    // Two-token span (no interior token exists at all), silence sits mostly
    // within the span's extent but only lightly touches either token —
    // covered well under BREATH_MAX_SPEECH_COVERAGE_RATIO. The multi-fragment
    // branch cannot fire here (no interior token), so this isolates the
    // "mostly empty air" branch on its own.
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 1.0 },
      { text: 'bravo', startSec: 3.0, endSec: 4.0 },
    ];
    // Silence [0.9, 3.1]: width 2.2. Covered = alpha's [0.9,1.0]=0.1 +
    // bravo's [3.0,3.1]=0.1 = 0.2. Ratio = 0.2/2.2 ≈ 0.091, well under 0.3.
    const silence = { startSec: 0.9, endSec: 3.1 };
    // Extent overlap = the whole silence (it sits inside [0,4]) → gate passes.
    expect(isBreathSilence(silence, tokens, 0, 1)).toBe(true);
    // Confirm it's really the ratio branch and not the override: no interior
    // token exists in a 2-token span, so significantInteriorCount is 0 by
    // construction — this fires on ratio <= BREATH_MAX_SPEECH_COVERAGE_RATIO
    // alone.
    expect(BREATH_MAX_SPEECH_COVERAGE_RATIO).toBe(0.3);
  });

  it('override rejection (pair-4 shape): high coverage + 2 significant interior tokens rejects even though no single token spans the whole silence', () => {
    // Minimal reproduction of the real pair-4 shape: a silence straddling
    // 3 touching tokens, 2 of which are INTERIOR (t2, t3) and individually
    // clear the floor, at full coverage.
    const tokens: TranscriptToken[] = [
      { text: 't1', startSec: 0.00, endSec: 0.25 },
      { text: 't2', startSec: 0.25, endSec: 0.54 }, // overlap [0.40,0.54] = 0.14
      { text: 't3', startSec: 0.54, endSec: 0.63 }, // overlap [0.54,0.63] = 0.09 (whole token)
      { text: 't4', startSec: 0.63, endSec: 0.95 }, // overlap [0.63,0.78] = 0.15
    ];
    const silence = { startSec: 0.40, endSec: 0.78 }; // width 0.38, fully covered by t2+t3+t4
    expect(isBreathSilence(silence, tokens, 0, 3)).toBe(true);
  });

  it('sigCount floor edge: two sub-floor interior slivers (0.05s, below the 0.09s floor) do not trigger the override even at full coverage', () => {
    // Same shape as the override-rejection case above (4 touching tokens,
    // full coverage), but the two INTERIOR tokens' overlaps are shrunk to
    // 0.05s each — under BREATH_TOKEN_OVERLAP_FLOOR_SEC (0.09s) by the
    // documented 0.04s margin — with the two EDGE tokens padding coverage
    // back up to ratio 1.0. This isolates the floor comparison itself: high
    // ratio, zero QUALIFYING interior tokens (edge tokens never count
    // regardless of size), must NOT reject via the override — and ratio 1.0
    // is well above BREATH_MAX_SPEECH_COVERAGE_RATIO too, so the other
    // branch can't rescue a reject either.
    const tokens: TranscriptToken[] = [
      { text: 't1', startSec: 0.00, endSec: 0.25 }, // edge; overlap [0.20,0.25] = 0.05
      { text: 't2', startSec: 0.25, endSec: 0.30 }, // interior; overlap [0.25,0.30] = 0.05 (sub-floor)
      { text: 't3', startSec: 0.30, endSec: 0.35 }, // interior; overlap [0.30,0.35] = 0.05 (sub-floor)
      { text: 't4', startSec: 0.35, endSec: 0.80 }, // edge; overlap [0.35,0.80] = 0.45
    ];
    const silence = { startSec: 0.20, endSec: 0.80 }; // width 0.60, covered = 0.05+0.05+0.05+0.45 = 0.60 → ratio 1.0
    expect(0.05).toBeLessThan(BREATH_TOKEN_OVERLAP_FLOOR_SEC);
    expect(BREATH_TOKEN_OVERLAP_FLOOR_SEC - 0.05).toBeCloseTo(0.04, 6); // the documented margin
    expect(isBreathSilence(silence, tokens, 0, 3)).toBe(false);
  });

  it('single-token span returns false, mirroring fillsTokenGapWithinSpan\'s own guard', () => {
    const tokens: TranscriptToken[] = [{ text: 'alpha', startSec: 0.0, endSec: 1.0 }];
    // Silence sits almost entirely inside this one token — no interior token
    // can exist, and no ratio-only case is meaningful without at least one
    // neighboring token, so this returns false unconditionally.
    expect(isBreathSilence({ startSec: 0.1, endSec: 0.9 }, tokens, 0, 0)).toBe(false);
  });

  it('sentinel (-1) span returns false — safe to call on an unmatched segment\'s indices', () => {
    const tokens: TranscriptToken[] = [{ text: 'alpha', startSec: 0.0, endSec: 1.0 }];
    expect(isBreathSilence({ startSec: 0.1, endSec: 0.9 }, tokens, -1, -1)).toBe(false);
  });
});

// ===========================================================================
// Degenerate-pair guard (defense-in-depth, rescue false-positive fix,
// 2026-07-31) — a pair whose spoken edges are inverted by more than
// TEMPORAL_TOLERANCE_MAX_SEC (5s) is the exact shape a false-positive rescue
// claim produces (whisperService.ts's Passes 2/3, closed separately by the
// forward-ordering bound above): `curr`'s `lastTokenIdx` pointing hundreds of
// seconds downstream of `next`'s `firstTokenIdx`. This is `alignments` built
// BY HAND (bypassing extractSegmentAlignments/the forward-ordering bound
// entirely) so the test exercises snapCoveredBoundaries' OWN defense
// independent of whether the upstream fix is what actually prevented it in a
// given case — this function must not trust its input's token indices
// blindly. A MILD inversion (a few hundred ms) remains untouched by this
// guard — see the existing "no-silence fallback with inverted bounds" test
// above, which stays green at ~0.4s of inversion.
// ===========================================================================
describe('snapCoveredBoundaries — degenerate-pair guard (no giant boundary from corrupted indices)', () => {
  it('an inverted pair (curr claims a token ~412s downstream of next\'s real match) writes no boundary; pre-snap timing is preserved; a later normal pair still snaps', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'heading text', startTime: 0, duration: 5, anchorStart: 0 }),
      makeSegment({ id: 's1', order: 1, text: 'alpha bravo', startTime: 5, duration: 3, anchorStart: 5 }),
      makeSegment({ id: 's2', order: 2, text: 'charlie delta', startTime: 8, duration: 4, anchorStart: 8 }),
    ];
    // Token indices referenced by the alignments below — deliberately
    // constructed, not produced by extractSegmentAlignments, to isolate this
    // function's own defense from the upstream fix.
    const tokens: TranscriptToken[] = [
      { text: 'a', startSec: 0.3, endSec: 0.7 },     // idx0 — s0.firstTokenIdx
      { text: 'b', startSec: 412.0, endSec: 412.4 }, // idx1 — s0.lastTokenIdx (the corrupted claim)
      { text: 'c', startSec: 0.5, endSec: 0.9 },     // idx2 — s1.firstTokenIdx (s1's genuine real match)
      { text: 'd', startSec: 4.0, endSec: 4.4 },     // idx3 — s1.lastTokenIdx
      { text: 'e', startSec: 8.2, endSec: 8.6 },     // idx4 — s2.firstTokenIdx
      { text: 'f', startSec: 11.5, endSec: 11.9 },   // idx5 — s2.lastTokenIdx
    ];
    const alignments: SegmentAlignment[] = [
      { t0: 0.3, t1: 412.4, firstTokenIdx: 0, lastTokenIdx: 1, confidence: 1, matched: true, matchedWords: 2, totalWords: 2, longestRun: 2 },
      { t0: 0.5, t1: 4.4, firstTokenIdx: 2, lastTokenIdx: 3, confidence: 1, matched: true, matchedWords: 2, totalWords: 2, longestRun: 2 },
      { t0: 8.2, t1: 11.9, firstTokenIdx: 4, lastTokenIdx: 5, confidence: 1, matched: true, matchedWords: 2, totalWords: 2, longestRun: 2 },
    ];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = snapCoveredBoundaries(segments, alignments, tokens, [], 15);

    // Pair (0,1) is degenerate (412.4 − 0.5 = 411.9s of inversion, far past
    // the 5s threshold): NO boundary written — both segments keep exactly
    // the pre-snap timing applyAnchorBasedTiming would have given them, not
    // a giant phantom duration derived from the corrupted indices.
    expect(out[0]!.duration).toBe(5);
    expect(out[1]!.startTime).toBe(5);
    expect(out[1]!.anchorStart).toBe(5);

    // Pair (1,2) is NOT inverted (4.4 < 8.2) and must still snap normally —
    // the degenerate pair before it must not disturb later pairs.
    // No silences supplied, so boundary = token midpoint = (4.4+8.2)/2 = 6.3.
    expect(out[1]!.duration).toBeCloseTo(1.3, 6);
    expect(out[2]!.startTime).toBeCloseTo(6.3, 6);
    expect(out[2]!.anchorStart).toBeCloseTo(6.3, 6);

    // Last survivor still extends to audioDuration.
    expect(out[2]!.duration).toBeCloseTo(15 - 6.3, 6);

    // DEV-gated warning fired for the skipped pair, naming both segments.
    expect(warnSpy.mock.calls.some(args => String(args[0]).includes('[snap] degenerate pair skipped'))).toBe(true);

    warnSpy.mockRestore();
  });

  it('does not affect a mild inversion (regression guard for the existing "words spoken close together" fixture)', () => {
    // Self-contained variant of the pre-existing "no-silence fallback with
    // inverted bounds" test (same segments/tokens/~0.4s inversion), built via
    // extractSegmentAlignments rather than twoCoveredSegments (scoped to a
    // different describe block) — re-asserted here specifically because it
    // is the fixture the degenerate-pair guard could have silently broken.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo', startTime: 0, duration: 2, anchorStart: 0, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta', startTime: 1.6, duration: 1.4, anchorStart: 1.6, anchorSource: 'whisper' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 1.0 },
      { text: 'bravo', startSec: 1.0, endSec: 2.0 },   // lastSpokenEnd = 2.0
      { text: 'charlie', startSec: 1.6, endSec: 2.4 }, // nextSpokenStart = 1.6 (< lastSpokenEnd, ~0.4s inversion)
      { text: 'delta', startSec: 2.4, endSec: 3.0 },
    ];
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    const out = snapCoveredBoundaries(segments, alignments, tokens, [], 3);
    expect(out[1]!.startTime).toBeCloseTo((2.0 + 1.6) / 2, 6);
  });
});

// ===========================================================================
// Monotonic-fallback re-check (2026-08-02 fix, closes the deferred bug noted
// in project-state.md): the token-midpoint fallback substituted when a
// proposed boundary goes backwards past `prevBoundary` used to be committed
// unconditionally — it is derived purely from THIS pair's own spoken edges,
// which carry no guarantee of sitting after a still-earlier COMMITTED
// boundary, so a sufficiently adversarial (corrupted-index) upstream input
// could make the substitute backwards too and have it land in the output
// silently.
//
// NOTE: the pre-existing "contention-aware assignment gives a contested
// silence to its better-fitting pair" test above used to exercise this
// branch (formerly titled "applies the monotonic check to a silence-derived
// boundary too", see docs/history.md) — contention-aware assignment
// (2026-07-30) resolves that fixture's non-monotonicity before the fallback
// branch is even reached, so it no longer does (see that test's own
// COVERAGE NOTE). This fixture closes that gap with fresh coverage,
// constructed the same way the degenerate-pair-guard tests above are: a
// directly hand-crafted SegmentAlignment array (not run through
// extractSegmentAlignments) so segment 1's own firstTokenIdx/lastTokenIdx can
// be set independently for pair (0,1) vs. pair (1,2) — isolating this
// function's OWN re-check from needing an implausibly-corrupted real
// alignment to reach it.
// ===========================================================================
describe('snapCoveredBoundaries — monotonic fallback re-check (2026-08-02 fix)', () => {
  it('a still-backwards fallback midpoint clamps to prevBoundary instead of committing backwards', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'a', startTime: 0, duration: 9 }),
      makeSegment({ id: 's1', order: 1, text: 'b', startTime: 9.5, duration: 1 }),
      makeSegment({ id: 's2', order: 2, text: 'c', startTime: 10.5, duration: 1 }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'w0', startSec: 0.0, endSec: 0.5 },   // idx0 — s0.firstTokenIdx
      { text: 'w1', startSec: 8.5, endSec: 9.0 },   // idx1 — s0.lastTokenIdx -> pair(0,1) lastSpokenEnd = 9.0
      { text: 'w2', startSec: 10.0, endSec: 10.3 }, // idx2 — s1.firstTokenIdx -> pair(0,1) nextSpokenStart = 10.0
      { text: 'w3', startSec: 2.6, endSec: 2.8 },   // idx3 — s1.lastTokenIdx -> pair(1,2) lastSpokenEnd = 2.8
      { text: 'w4', startSec: 3.2, endSec: 3.4 },   // idx4 — s2.firstTokenIdx -> pair(1,2) nextSpokenStart = 3.2
      { text: 'w5', startSec: 3.4, endSec: 3.6 },   // idx5 — s2.lastTokenIdx
    ];
    // Deliberately constructed (not produced by extractSegmentAlignments,
    // same technique as the degenerate-pair-guard tests above): s1's own
    // firstTokenIdx (idx2, 10.0) sits chronologically AFTER its lastTokenIdx
    // (idx3, 2.8) — this is what lets pair(0,1)'s boundary (a plain midpoint
    // of 9.0 and 10.0 -> 9.5) land AFTER pair(1,2)'s own natural midpoint
    // (2.8 and 3.2 -> 3.0), the precondition for the monotonic branch to fire
    // at all. Neither pair's OWN lastSpokenEnd/nextSpokenStart gap exceeds
    // DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC (5s), so the degenerate-pair
    // guard does not intercept this case before the monotonic check runs.
    const alignments: SegmentAlignment[] = [
      { t0: 0.0, t1: 9.0, firstTokenIdx: 0, lastTokenIdx: 1, confidence: 1, matched: true, matchedWords: 1, totalWords: 1, longestRun: 1 },
      { t0: 10.0, t1: 2.8, firstTokenIdx: 2, lastTokenIdx: 3, confidence: 1, matched: true, matchedWords: 1, totalWords: 1, longestRun: 1 },
      { t0: 3.2, t1: 3.6, firstTokenIdx: 4, lastTokenIdx: 5, confidence: 1, matched: true, matchedWords: 1, totalWords: 1, longestRun: 1 },
    ];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = snapCoveredBoundaries(segments, alignments, tokens, [], 12);

    // Pair (0,1): no silences supplied, no prevBoundary yet -> plain midpoint
    // (9.0 + 10.0) / 2 = 9.5, committed outright.
    expect(out[1]!.startTime).toBeCloseTo(9.5, 6);

    // Pair (1,2): raw proposal is s1/s2's own midpoint, (2.8 + 3.2) / 2 = 3.0
    // — backwards past prevBoundary (9.5). The pre-existing branch
    // substitutes the SAME formula (no candidate silence involved, so the
    // "substitution" is a no-op recompute) — still 3.0, still backwards. The
    // 2026-08-02 re-check now clamps the RAW boundary to prevBoundary (9.5)
    // instead of committing 3.0. This is the fix under test: pre-fix,
    // out[2].startTime would have been 3.0 here — an actual backwards jump
    // in the timeline (behind s1's own 9.5 startTime) — silently.
    //
    // Timeline visual-drift fix (2026-07-31): out[1]'s duration then floors
    // to MIN_SEGMENT_DURATION (0.1) below, which pushes its end past the
    // 9.5 boundary just written for out[2] — the contiguity fix appended
    // after the duration floor detects that (curr.startTime + curr.duration
    // = 9.6 > next.startTime = 9.5) and advances out[2].startTime to 9.6 so
    // startTime[i] + duration[i] === startTime[i+1] keeps holding. This is
    // the SAME clamped-boundary case, just carried one step further than
    // before this fix existed.
    expect(out[2]!.startTime).toBeCloseTo(9.6, 6);
    expect(out[2]!.startTime).not.toBeCloseTo(3.0, 3);

    // The pair collapses to the MIN_SEGMENT_DURATION floor — exactly what
    // committing the pre-fix backwards value would ALSO have produced once
    // the duration floor absorbed it (`Math.max(MIN_SEGMENT_DURATION, ...)`)
    // — but the boundary itself is now monotonic rather than backwards.
    expect(out[1]!.duration).toBeCloseTo(0.1, 6);

    // DEV-gated warning fired, naming both segments of the clamped pair.
    expect(warnSpy.mock.calls.some(args =>
      String(args[0]).includes('[snap] monotonic fallback still backwards'),
    )).toBe(true);
    warnSpy.mockRestore();

    // Last survivor still extends to audioDuration and the whole run stays
    // monotonic end to end. out[2].startTime is now 9.6 (contiguity-adjusted,
    // see above), so its duration to audioDuration (12) shifts to match.
    expect(out[2]!.duration).toBeCloseTo(12 - 9.6, 6);
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i + 1]!.startTime).toBeGreaterThanOrEqual(out[i]!.startTime);
    }
  });
});

// ===========================================================================
// Contention-aware silence claiming (silence-claiming starvation cascade fix,
// 2026-07-30) — confirmed via live [diag-align]/[diag-snap] instrumentation on
// a real 294-segment project: pair 248 claimed the pause belonging to pair
// 249, pair 249 then took pair 250's, and pair 250 — left with zero unused
// candidates — collapsed to the MIN_SEGMENT_DURATION floor. Token attribution
// was correct throughout (verified live); this was purely a first-come-
// first-served silence-claiming defect in snapCoveredBoundaries's left-to-
// right walk, not an alignment bug.
// ===========================================================================
describe('contention-aware silence claiming (no starvation cascade)', () => {
  it('a long segment then two short segments then a normal one: no boundary starves its rightful successor', () => {
    // Mirrors the confirmed real geometry: touching tokens at every pair
    // (spokenGapWidth 0, forcing the fixed 1.0s search radius at each
    // boundary — see the "Whisper compresses adjacent words..." branch), a
    // long segment with no silence of its own right at its end, then two
    // short segments (~0.5s and ~1.2s of real speech) each with its own
    // genuine trailing silence — but only 2 real silences across 3 pairs,
    // exactly the scarcity that lets an earlier, wide window reach past its
    // own best fit and starve a later pair of its rightful silence.
    const tokens: TranscriptToken[] = [
      { text: 'elephant', startSec: 1070.00, endSec: 1077.95 },
      { text: 'cat',      startSec: 1077.95, endSec: 1078.45 }, // ~0.5s of speech
      { text: 'dog',      startSec: 1078.45, endSec: 1079.65 }, // ~1.2s of speech
      { text: 'bird',     startSec: 1079.65, endSec: 1080.15 },
    ];
    const segments: VideoSegment[] = [
      makeSegment({ id: 'L',  order: 0, text: 'elephant', startTime: 1070.00, duration: 7.95, anchorStart: 1070.00 }),
      makeSegment({ id: 'S1', order: 1, text: 'cat',      startTime: 1077.95, duration: 0.50, anchorStart: 1077.95 }),
      makeSegment({ id: 'S2', order: 2, text: 'dog',      startTime: 1078.45, duration: 1.20, anchorStart: 1078.45 }),
      makeSegment({ id: 'N',  order: 3, text: 'bird',     startTime: 1079.65, duration: 0.50, anchorStart: 1079.65 }),
    ];
    // A sits just after S1's real speech, B just after S2's — the two pairs'
    // own genuine trailing pauses (close to the confirmed real values). No
    // silence of its own exists right at L's end — its window is wide enough
    // to reach A anyway, which is the trap.
    const silences: SilenceInterval[] = [
      { startSec: 1078.16, endSec: 1078.58 }, // A — centre 1078.37, "belongs" to the S1|S2 boundary
      { startSec: 1079.30, endSec: 1079.90 }, // B — centre 1079.60, "belongs" to the S2|N boundary
    ];

    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);

    const out = snapCoveredBoundaries(segments, alignments, tokens, silences, 1085);

    // No segment collapses toward the MIN_SEGMENT_DURATION floor.
    for (const seg of out) {
      expect(seg.duration).toBeGreaterThan(0.2);
    }
    // S1's real speech is ~0.5s — it must retain most of it, not be reduced
    // to a sliver by an earlier boundary reaching past it.
    expect(out[1]!.duration).toBeGreaterThan(0.3);
    // S2's real speech is ~1.2s — the reported bug reduced this to 0.1s.
    expect(out[2]!.duration).toBeGreaterThanOrEqual(1.0);
    // Each boundary lands on the silence that genuinely borders it.
    expect(out[2]!.startTime).toBeCloseTo(1078.37, 2); // S1|S2 boundary -> silence A's centre
    expect(out[3]!.startTime).toBeCloseTo(1079.60, 2); // S2|N  boundary -> silence B's centre
  });
});

describe('filterToCoveredSegments — keptAlignments', () => {
  it('returns the kept segments’ alignments, in the same order and the same length as kept', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'never spoken words' }),  // unmatched
      makeSegment({ id: 's2', order: 2, text: 'charlie delta' }),
      makeSegment({ id: 's3', order: 3, text: 'also never spoken' }),   // unmatched
      makeSegment({ id: 's4', order: 4, text: 'echo foxtrot' }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta echo foxtrot', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    const { kept, skipped, keptAlignments } = filterToCoveredSegments(segments, cov);

    expect(kept.map(s => s.id)).toEqual(['s0', 's2', 's4']);
    expect(skipped.map(r => r.segmentIndex)).toEqual([1, 3]);
    expect(keptAlignments).toHaveLength(kept.length);
    // Index-parallel: keptAlignments[i] is the alignment coverage[] held for
    // kept[i] at its ORIGINAL position.
    expect(keptAlignments).toEqual([cov[0], cov[2], cov[4]]);
    expect(keptAlignments.every(a => a.matched)).toBe(true);
  });
});

// ===========================================================================
// REGRESSION — the middle-gap position offset itself.
//
// Same audio, same covered scenes, two scene docs: one where the covered scenes
// are adjacent, one where unmatched scenes sit between them. Before the fix the
// covered scene after the unmatched run drifted (measured 0.13s on the real
// project) because the aligner snapped its boundary against the unmatched
// neighbour's placeholder anchors. After the fix its position is identical in
// both docs — a scene that never reaches the timeline cannot move one that does.
// ===========================================================================
describe('middle-gap position offset — unmatched neighbours no longer shift covered segments', () => {
  const AUDIO_DURATION = 6;
  // 'alpha bravo charlie delta' spoken 0.0-2.0, then a real pause, then
  // 'india juliet kilo lima' spoken 3.0-5.0.
  const TOKENS: TranscriptToken[] = [
    ...wordTokens('alpha bravo charlie delta', 0, 0.5),
    ...wordTokens('india juliet kilo lima', 3.0, 0.5),
  ];
  const SILENCES: SilenceInterval[] = [{ startSec: 2.1, endSec: 2.9 }];

  /** The production cached-token path, end to end (App.tsx handleApplySyncFromFiles
   *  + useWhisper.ts alignSegmentsFromCachedTranscript). */
  function runPipeline(segments: VideoSegment[]) {
    const alignments = alignScenestoTranscript(segments, TOKENS, SILENCES);
    const distributed = distributeSegmentTimes(segments, alignments, AUDIO_DURATION);
    const anchored = applyAnchorBasedTiming(distributed, AUDIO_DURATION);
    const { kept, keptAlignments, skipped } = filterToCoveredSegments(anchored, alignments);
    const snapped = snapCoveredBoundaries(kept, keptAlignments, TOKENS, SILENCES, AUDIO_DURATION);
    return { snapped, skipped, alignments };
  }

  const coveredScenes = () => [
    makeSegment({ id: 'c0', order: 0, text: 'alpha bravo' }),
    makeSegment({ id: 'c1', order: 1, text: 'charlie delta' }),
    makeSegment({ id: 'c2', order: 2, text: 'india juliet' }),   // the target scene
    makeSegment({ id: 'c3', order: 3, text: 'kilo lima' }),
  ];

  it('the target scene lands at the same startTime with and without unmatched scenes before it', () => {
    // Doc A — every scene is spoken.
    const docA = coveredScenes();
    // Doc B — two scenes that appear in NO part of the audio are inserted
    // immediately before the target scene.
    const docB = [
      ...coveredScenes().slice(0, 2),
      makeSegment({ id: 'u0', order: 2, text: 'zulu whiskey tango' }),
      makeSegment({ id: 'u1', order: 3, text: 'quebec sierra romeo' }),
      ...coveredScenes().slice(2),
    ];

    const a = runPipeline(docA);
    const b = runPipeline(docB);

    // Doc B really does exercise the skip path (otherwise this test proves nothing).
    expect(a.skipped).toHaveLength(0);
    expect(b.skipped.map(r => r.segmentIndex)).toEqual([2, 3]);

    // The target scene — and in fact every covered scene — occupies exactly the
    // same span in both documents.
    expect(b.snapped.map(s => s.id)).toEqual(a.snapped.map(s => s.id));
    expect(b.snapped.map(s => s.startTime)).toEqual(a.snapped.map(s => s.startTime));
    expect(b.snapped.map(s => s.duration)).toEqual(a.snapped.map(s => s.duration));
    expect(b.snapped.map(s => s.anchorStart)).toEqual(a.snapped.map(s => s.anchorStart));

    // Concretely: the boundary before the target scene is the real silence's
    // midpoint (2.5), reached from the two REAL spoken edges (2.0 and 3.0) —
    // not the 2.85 the unmatched neighbour's placeholder anchors produced.
    const target = b.snapped.find(s => s.id === 'c2')!;
    expect(target.startTime).toBeCloseTo(2.5, 6);
  });

  // UPDATED 2026-08-02 — re-examined per this test's own instruction ("if
  // this ever stops differing... this whole mechanism should be re-examined
  // rather than silently kept"), not silently patched.
  //
  // With the SHARED SILENCES fixture (2026-07-30's), this test's original
  // assertion (targetT0A !== targetT0B) now FAILS: both come out 2.5. That is
  // not a fluke of the fix disappearing — it's a direct, traceable
  // consequence of contention-aware assignment (2026-08-02 port,
  // whisperService.ts) now ALSO running on the full array. Silence [2.1, 2.9]
  // is symmetric around BOTH the meaningless all-sentinel pair (u0,u1)'s own
  // placeholder spokenMid (2.0, = c1's real end, via the Step 2 t1-chain) and
  // the real (u1,target) pair's spokenMid (3.0, = target's real start) —
  // dist 0.5 either way, an exact tie, which the assignment rule ("ties ->
  // later pair") happens to break in the CORRECT (later, real-content)
  // pair's favor for this specific fixture. That is incidental, not a
  // guarantee: it depends on the tie landing the right way, unlike
  // `snapCoveredBoundaries`'s fix (the "same startTime with and without
  // unmatched scenes" test above), which is unconditional because it never
  // touches a sentinel's placeholder anchor at all — every pair it sees is
  // genuinely matched with real spoken edges on both sides.
  //
  // The general problem — a real boundary silence landing closer to an
  // all-sentinel pair's placeholder spokenMid than to the real content
  // pair's — still reproduces the original bug post-port, once the silence
  // is placed OFF the tie point. This fixture (a fresh, off-centre silence,
  // self-contained rather than reusing the shared SILENCES) is that
  // replacement witness: `snapCoveredBoundaries` is NOT redundant.
  it('witness (re-derived post-port, 2026-08-02): an off-centre silence closer to the placeholder pair than the real one still misattributes, proving snapCoveredBoundaries is not redundant', () => {
    const docA = coveredScenes();
    const docB = [
      ...coveredScenes().slice(0, 2),
      makeSegment({ id: 'u0', order: 2, text: 'zulu whiskey tango' }),
      makeSegment({ id: 'u1', order: 3, text: 'quebec sierra romeo' }),
      ...coveredScenes().slice(2),
    ];
    // Off-centre: closer to the all-sentinel pair's placeholder spokenMid
    // (2.0, dist 0.2) than to the real (u1,target) pair's spokenMid (3.0,
    // dist 0.8) — and far enough past the real pair's own tolerance bound
    // (lastSpokenEnd - 0.3 = 2.7) that it's rejected there outright, so no
    // contention/tie is even involved this time. The true (docA) boundary
    // moves to match — the target's real audio position hasn't changed, only
    // where the silence sits relative to it.
    const offCentreSilences: SilenceInterval[] = [{ startSec: 2.1, endSec: 2.3 }];

    const targetT0A = alignScenestoTranscript(docA, TOKENS, offCentreSilences)[2]!.t0;
    const targetT0B = alignScenestoTranscript(docB, TOKENS, offCentreSilences)[4]!.t0;

    expect(targetT0A).toBeCloseTo(2.2, 6);   // docA: the real (c1,target) pair claims it outright
    expect(targetT0B).toBeCloseTo(3.0, 6);   // docB: the all-sentinel pair claims it first; target falls back to its token midpoint
    expect(targetT0B).not.toBeCloseTo(targetT0A, 3);
  });

  it('with nothing skipped, the covered-only re-snap reproduces the aligner’s own boundaries', () => {
    // The fix must be a no-op on projects where every scene is covered — the
    // overwhelmingly common case. Same window, same silence pick, same clamps.
    const docA = coveredScenes();
    const alignments = alignScenestoTranscript(docA, TOKENS, SILENCES);
    const distributed = distributeSegmentTimes(docA, alignments, AUDIO_DURATION);
    const anchored = applyAnchorBasedTiming(distributed, AUDIO_DURATION);
    const { kept, keptAlignments } = filterToCoveredSegments(anchored, alignments);

    const snapped = snapCoveredBoundaries(kept, keptAlignments, TOKENS, SILENCES, AUDIO_DURATION);

    expect(snapped.map(s => s.startTime)).toEqual(anchored.map(s => s.startTime));
    expect(snapped.map(s => s.duration)).toEqual(anchored.map(s => s.duration));
  });

  // Extends the no-op-on-nothing-skipped case above to a CONTESTED silence —
  // exactly the shape contention-aware assignment exists for. Before the
  // 2026-08-02 port, `alignScenestoTranscript`'s own gap-fill still claimed
  // silences first-come-first-served, so this fixture (reusing the geometry
  // from "contention-aware assignment gives a contested silence to its
  // better-fitting pair" above) is exactly where the two functions could
  // diverge; after the port both resolve the contest identically.
  it('parity: a contested silence resolves identically via alignScenestoTranscript’s own gap-fill and via snapCoveredBoundaries, when nothing is skipped', () => {
    const audioDuration = 5;
    const segments: VideoSegment[] = [
      makeSegment({ id: 'p0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 'p1', order: 1, text: 'charlie' }),
      makeSegment({ id: 'p2', order: 2, text: 'delta echo' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 0.5 },
      { text: 'bravo', startSec: 0.5, endSec: 1.0 },   // pair0 lastSpokenEnd = 1.0
      { text: 'charlie', startSec: 2.0, endSec: 2.2 }, // pair0 nextSpokenStart = 2.0
      { text: 'delta', startSec: 2.3, endSec: 2.8 },   // pair1 nextSpokenStart = 2.3
      { text: 'echo', startSec: 2.8, endSec: 3.3 },
    ];
    const silences: SilenceInterval[] = [
      { startSec: 2.10, endSec: 3.10 }, // contested — closer to pair1's midpoint (2.25) than pair0's (1.5)
      { startSec: 2.25, endSec: 2.45 }, // only pair1's window can see this one
    ];

    // Side A: the aligner's own gap-fill, end to end.
    const viaAligner = alignScenestoTranscript(segments, tokens, silences);

    // Side B: extractSegmentAlignments (pre-gap-fill) -> filterToCoveredSegments
    // (confirms nothing is skipped, the parity precondition) -> snapCoveredBoundaries.
    const alignments = extractSegmentAlignments(segments, tokens);
    expect(alignments.every(a => a.matched)).toBe(true);
    const { kept, keptAlignments, skipped } = filterToCoveredSegments(segments, alignments);
    expect(skipped).toHaveLength(0);
    const viaSnap = snapCoveredBoundaries(kept, keptAlignments, tokens, silences, audioDuration);

    // Both sides resolve the contested silence to pair1 (closer fit) and leave
    // pair0 with its honest token-midpoint fallback — identically.
    expect(viaSnap.map(s => s.startTime)).toEqual(viaAligner.map(a => a.t0));
  });
});

// ===========================================================================
// alignScenestoTranscript's own gap-fill — ported candidacy + contention-aware
// claiming (2026-08-02). Each fixture below is adapted from the twin
// snapBoundaries.ts fixture (see the cross-references in each test) but run
// through `alignScenestoTranscript` directly, to pin the NEW aligner behavior
// in isolation rather than only through snapCoveredBoundaries.
// ===========================================================================
describe('alignScenestoTranscript — ported gap-fill candidacy (breath/gap rejection)', () => {
  it('(a) a breath between two of one segment’s own tokens is not chosen as the gap-fill boundary', () => {
    // Adapted from snapBoundaries.test's "rejects a sub-tolerance intrusion
    // when the silence fills a gap between two of the current segment's own
    // tokens" fixture — same geometry, run through the aligner directly.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie' }),
      makeSegment({ id: 's1', order: 1, text: 'delta echo' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha',   startSec: 17.50, endSec: 18.00 },
      { text: 'bravo',   startSec: 18.00, endSec: 18.32 },
      // ...s0's own breath here, 18.32 -> 18.70, between two of ITS tokens...
      { text: 'charlie', startSec: 18.70, endSec: 18.87 }, // lastSpokenEnd = 18.87
      { text: 'delta',   startSec: 18.87, endSec: 19.40 }, // nextSpokenStart = 18.87
      { text: 'echo',    startSec: 19.40, endSec: 19.90 },
    ];
    const silences: SilenceInterval[] = [{ startSec: 18.32, endSec: 18.70 }];

    const results = alignScenestoTranscript(segments, tokens, silences);

    // Rejected -> token midpoint (both spoken edges touch at 18.87), not the
    // breath centre 18.51.
    expect(results[0]!.t1).toBeCloseTo(18.87, 6);
    expect(results[1]!.t0).toBeCloseTo(18.87, 6);
    expect(results[0]!.t1).not.toBeCloseTo(18.51, 3);
  });

  it('(b) contention: a silence overlapped by two pairs’ windows goes to the pair whose spoken midpoint it’s actually closer to', () => {
    // Same geometry as the "parity" test above — isolated here to pin the
    // aligner's OWN contention resolution directly, independent of
    // snapCoveredBoundaries.
    const segments: VideoSegment[] = [
      makeSegment({ id: 'p0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 'p1', order: 1, text: 'charlie' }),
      makeSegment({ id: 'p2', order: 2, text: 'delta echo' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 0.5 },
      { text: 'bravo', startSec: 0.5, endSec: 1.0 },
      { text: 'charlie', startSec: 2.0, endSec: 2.2 },
      { text: 'delta', startSec: 2.3, endSec: 2.8 },
      { text: 'echo', startSec: 2.8, endSec: 3.3 },
    ];
    const silences: SilenceInterval[] = [
      { startSec: 2.10, endSec: 3.10 }, // contested — assigned to pair1 (closer fit)
      { startSec: 2.25, endSec: 2.45 }, // only pair1's window can see this one
    ];

    const results = alignScenestoTranscript(segments, tokens, silences);

    expect(results[1]!.t0).toBeCloseTo(1.5, 6);  // pair0 -> no assigned silence, honest token-midpoint fallback
    expect(results[2]!.t0).toBeCloseTo(2.35, 6); // pair1 -> silence B (closer than the reassigned contested one)
  });

  it('(c) a silence intruding deeper than the tolerance is rejected as a boundary candidate', () => {
    // Adapted from snapBoundaries.test's "rejects a silence that ends well
    // before the current segment stops speaking" fixture.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie' }),
      makeSegment({ id: 's1', order: 1, text: 'delta echo' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha',   startSec: 17.50, endSec: 18.00 },
      { text: 'bravo',   startSec: 18.00, endSec: 18.32 },
      { text: 'charlie', startSec: 18.70, endSec: 19.20 }, // lastSpokenEnd = 19.20
      { text: 'delta',   startSec: 19.20, endSec: 19.70 }, // nextSpokenStart = 19.20
      { text: 'echo',    startSec: 19.70, endSec: 20.20 },
    ];
    const silences: SilenceInterval[] = [
      { startSec: 17.68, endSec: 18.08 }, // outside the window entirely
      { startSec: 18.32, endSec: 18.70 }, // in-window, but 0.50s intrusion > 0.30s tolerance — rejected
    ];

    const results = alignScenestoTranscript(segments, tokens, silences);

    expect(results[0]!.t1).toBeCloseTo(19.20, 6);
    expect(results[0]!.t1).not.toBeCloseTo(18.51, 3);
  });

  it('(d) a sentinel (-1) alignment on one side of a pair: the two new predicates no-op, plain window/tolerance candidacy still applies', () => {
    // s0 is a zero-token (empty-text) segment -> firstTokenIdx/lastTokenIdx
    // are the -1 sentinel. Unlike snapBoundaries.ts (which only ever sees
    // covered/matched segments), this full-array pass can hand -1 straight to
    // fillsTokenGapWithinSpan/isBreathSilence — both already guard on
    // `firstTokenIdx < 0` and return false, so this pair falls through to the
    // pre-existing window/tolerance test unaffected, exactly as before the
    // port. A silence is deliberately supplied (not just window bounds
    // checked) so the predicates are actually INVOKED with the sentinel,
    // rather than the filter short-circuiting on an empty silences array.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: '' }),
      makeSegment({ id: 's1', order: 1, text: 'alpha bravo' }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 2.0, endSec: 2.5 },
      { text: 'bravo', startSec: 2.5, endSec: 3.0 },
    ];
    // NOTE on lastSpokenEnd for the sentinel side: s0 is zero-token, so
    // extraction gives it t0=t1=prevAnchor=0 — but `alignScenestoTranscript`'s
    // Step 2 (which runs BEFORE gap-fill, unconditionally, for every pair)
    // already overwrites results[0].t1 to results[1].t0 (2.0, s1's real first
    // word) before this loop ever reads it. So by the time gap-fill computes
    // this pair's `?? curr.t1` fallback, lastSpokenEnd is already 2.0, not the
    // original placeholder 0 — a real subtlety of this function (absent from
    // snapBoundaries.ts, which has no analogous Step 2 pre-pass).
    const silences: SilenceInterval[] = [{ startSec: 1.75, endSec: 1.95 }];

    expect(() => alignScenestoTranscript(segments, tokens, silences)).not.toThrow();

    const results = alignScenestoTranscript(segments, tokens, silences);
    // lastSpokenEnd=2.0, nextSpokenStart=2.0 (touching) -> window [1.0,3.0],
    // tolerance bounds [1.7,2.3]. The supplied silence [1.75,1.95] sits inside
    // both and isn't flagged as a breath/gap by either -1-guarded predicate,
    // so it's chosen over the (numerically different, 2.0) fallback midpoint —
    // proving the silence genuinely won, not just that -1 didn't crash.
    expect(results[0]!.t1).toBeCloseTo(1.85, 6);
    expect(results[1]!.t0).toBeCloseTo(1.85, 6);
  });
});

// ---------------------------------------------------------------------------
// WS4 Feature 4 (decision 14a) — malformed-token filter
// ---------------------------------------------------------------------------
//
// These tokens reach the aligner straight from whisper.cpp's stdout, and their
// timestamps become segment boundaries verbatim. A single bad one can place a
// boundary at a nonsense time or NaN an entire run, so the filter runs once,
// before alignment, and reports what it dropped.

describe('filterMalformedTokens (WS4 Feature 4)', () => {
  const AUDIO_LEN = 10;

  function tok(startSec: number, endSec: number, text = 'word'): TranscriptToken {
    return { startSec, endSec, text };
  }

  it('keeps a well-formed token', () => {
    const result = filterMalformedTokens([tok(1, 2)], AUDIO_LEN);
    expect(result.tokens).toHaveLength(1);
    expect(result.skippedCount).toBe(0);
    expect(result.totalTokens).toBe(1);
  });

  it('filters a token starting before zero', () => {
    const result = filterMalformedTokens([tok(-0.5, 1)], AUDIO_LEN);
    expect(result.tokens).toEqual([]);
    expect(result.skippedCount).toBe(1);
  });

  it('filters a token ending past audioDuration + tolerance', () => {
    const result = filterMalformedTokens([tok(9, AUDIO_LEN + MALFORMED_TOKEN_DURATION_TOLERANCE_SEC + 0.01)], AUDIO_LEN);
    expect(result.tokens).toEqual([]);
    expect(result.skippedCount).toBe(1);
  });

  it('keeps a token ending within the codec-padding tolerance', () => {
    // Container duration and decoded sample count routinely disagree by a few
    // ms — the last word must not be discarded for that.
    const result = filterMalformedTokens([tok(9, AUDIO_LEN + 0.2)], AUDIO_LEN);
    expect(result.tokens).toHaveLength(1);
    expect(result.skippedCount).toBe(0);
  });

  it('filters a zero-duration token', () => {
    expect(filterMalformedTokens([tok(3, 3)], AUDIO_LEN).skippedCount).toBe(1);
  });

  it('filters an inverted token (start after end)', () => {
    expect(filterMalformedTokens([tok(4, 3)], AUDIO_LEN).skippedCount).toBe(1);
  });

  it('filters NaN and Infinity timestamps', () => {
    const result = filterMalformedTokens(
      [tok(NaN, 2), tok(1, NaN), tok(1, Infinity), tok(-Infinity, 2)],
      AUDIO_LEN,
    );
    expect(result.tokens).toEqual([]);
    expect(result.skippedCount).toBe(4);
    expect(result.totalTokens).toBe(4);
  });

  it('filters tokens whose text is empty or normalizes away', () => {
    const result = filterMalformedTokens(
      [tok(1, 2, ''), tok(2, 3, '   '), tok(3, 4, '...'), tok(4, 5, 'real')],
      AUDIO_LEN,
    );
    expect(result.tokens.map(t => t.text)).toEqual(['real']);
    expect(result.skippedCount).toBe(3);
  });

  it('keeps valid tokens and counts only the invalid ones, preserving order', () => {
    const result = filterMalformedTokens(
      [tok(0, 1, 'one'), tok(-1, 2, 'bad'), tok(1, 2, 'two'), tok(5, 5, 'bad'), tok(2, 3, 'three')],
      AUDIO_LEN,
    );
    expect(result.tokens.map(t => t.text)).toEqual(['one', 'two', 'three']);
    expect(result.skippedCount).toBe(2);
    expect(result.totalTokens).toBe(5);
  });

  it('skips the end-of-audio check when audioDuration is unusable', () => {
    // An unknown duration must not discard the entire transcript.
    for (const bad of [0, -1, NaN, Infinity]) {
      const result = filterMalformedTokens([tok(1, 2), tok(500, 600)], bad);
      expect(result.tokens).toHaveLength(2);
      expect(result.skippedCount).toBe(0);
    }
  });

  it('does not mutate the input array', () => {
    const input = [tok(1, 2), tok(-1, 0.5)];
    const copy = input.map(t => ({ ...t }));
    filterMalformedTokens(input, AUDIO_LEN);
    expect(input).toEqual(copy);
  });

  it('returns an empty result for an empty transcript', () => {
    expect(filterMalformedTokens([], AUDIO_LEN)).toEqual({
      tokens: [], skippedCount: 0, totalTokens: 0,
    });
  });

  it('leaves alignment unchanged when the filter drops the bad tokens first', () => {
    // The point of filtering BEFORE alignment: a malformed token injected into
    // a clean transcript must not move any boundary once filtered out.
    const segments = [
      makeSegment({ id: 's1', text: 'hello world', order: 0 }),
      makeSegment({ id: 's2', text: 'goodbye now', order: 1 }),
    ];
    const clean: TranscriptToken[] = [
      { startSec: 0.0, endSec: 0.5, text: 'hello' },
      { startSec: 0.5, endSec: 1.0, text: 'world' },
      { startSec: 2.0, endSec: 2.5, text: 'goodbye' },
      { startSec: 2.5, endSec: 3.0, text: 'now' },
    ];
    const polluted: TranscriptToken[] = [
      clean[0]!,
      { startSec: -5, endSec: -1, text: 'garbage' },
      clean[1]!,
      { startSec: 900, endSec: 901, text: 'garbage' },
      clean[2]!,
      clean[3]!,
    ];

    const filtered = filterMalformedTokens(polluted, 3);
    expect(filtered.skippedCount).toBe(2);
    expect(filtered.tokens).toEqual(clean);

    const fromClean = alignScenestoTranscript(segments, clean, []);
    const fromFiltered = alignScenestoTranscript(segments, filtered.tokens, []);
    expect(fromFiltered.map(a => [a.t0, a.t1])).toEqual(fromClean.map(a => [a.t0, a.t1]));
  });
});

// ---------------------------------------------------------------------------
// WS4 Feature 1 (decision 13a) — stage directions at the PIPELINE level
// ---------------------------------------------------------------------------
//
// textNormalize.test.ts covers the strip grammar in isolation. What matters
// here is the consequence: written-but-unspoken words are penalized deletions
// in the Hirschberg aligner, so they drag a segment's confidence toward the
// skip threshold. After the strip, a scene document containing directions must
// align exactly like the same document without them.

describe('stage-direction stripping through the aligner (WS4 Feature 1)', () => {
  const spokenTokens: TranscriptToken[] = [
    { startSec: 0.0, endSec: 0.4, text: 'the' },
    { startSec: 0.4, endSec: 0.8, text: 'kettle' },
    { startSec: 0.8, endSec: 1.2, text: 'is' },
    { startSec: 1.2, endSec: 1.6, text: 'boiling' },
    { startSec: 2.0, endSec: 2.4, text: 'she' },
    { startSec: 2.4, endSec: 2.8, text: 'pours' },
    { startSec: 2.8, endSec: 3.2, text: 'the' },
    { startSec: 3.2, endSec: 3.6, text: 'tea' },
  ];

  const cleanDoc = [
    makeSegment({ id: 'a', text: 'The kettle is boiling', order: 0 }),
    makeSegment({ id: 'b', text: 'She pours the tea', order: 1 }),
  ];
  const directedDoc = [
    makeSegment({ id: 'a', text: 'INT. KITCHEN - DAY\nThe kettle is boiling (steam rising)', order: 0 }),
    makeSegment({ id: 'b', text: 'She pours the tea [CLOSE UP: HANDS]', order: 1 }),
  ];

  it('gives a directed document the same confidence as a clean one', () => {
    const clean = extractSegmentAlignments(cleanDoc, spokenTokens);
    const directed = extractSegmentAlignments(directedDoc, spokenTokens);

    expect(clean.map(a => a.confidence)).toEqual([1, 1]);
    expect(directed.map(a => a.confidence)).toEqual(clean.map(a => a.confidence));
    expect(directed.map(a => a.totalWords)).toEqual(clean.map(a => a.totalWords));
  });

  it('gives a directed document the same boundaries as a clean one', () => {
    const clean = alignScenestoTranscript(cleanDoc, spokenTokens, []);
    const directed = alignScenestoTranscript(directedDoc, spokenTokens, []);

    expect(directed.map(a => [a.t0, a.t1])).toEqual(clean.map(a => [a.t0, a.t1]));
  });

  it('keeps both scenes covered where the unstripped directions would have hurt confidence', () => {
    const directed = extractSegmentAlignments(directedDoc, spokenTokens);
    expect(classifyCoverage(directed).map(c => c.covered)).toEqual([true, true]);
  });

  it('falls back to the original text when stripping would empty a segment', () => {
    // A fully-parenthesized scene keeps its words rather than collapsing to a
    // zero-word "neutral" segment, which would change its classification.
    const parenOnly = [makeSegment({ id: 'p', text: '(the kettle is boiling)', order: 0 })];
    const result = extractSegmentAlignments(parenOnly, spokenTokens);

    expect(result[0]!.totalWords).toBe(4);
    expect(result[0]!.matchedWords).toBe(4);
  });

  it('does not strip the transcript side — spoken parentheses still match', () => {
    // The subject sequence is built with `normalize`, not `normalizeSceneDoc`.
    const tokens: TranscriptToken[] = [
      { startSec: 0, endSec: 0.5, text: '(hello' },
      { startSec: 0.5, endSec: 1.0, text: 'there)' },
    ];
    const segs = [makeSegment({ id: 'x', text: 'hello there', order: 0 })];
    expect(extractSegmentAlignments(segs, tokens)[0]!.confidence).toBe(1);
  });
});

// ===========================================================================
// WS5 Feature 1 (audit finding S3) — repeated phrases + inflected forms.
//
// VERIFICATION, not new behavior. S3 asked whether the WS1a Hirschberg aligner
// needs a stemming layer to survive ordinary English morphology and repeated
// wording. These fixtures answer it with numbers, and they exist to FAIL if a
// future change regresses either property.
//
// Outcome (see the WS5 entry in project-state.md): no stemming was added. The
// worst case constructed below — a two-word segment with one inflected word —
// lands at confidence 0.5, still above LOW_CONFIDENCE_RATIO, and a realistic
// sentence lands at 0.71-0.75. Inflection alone cannot push a segment under the
// coverage threshold, and it can never cause a SKIP (skipping is decided by
// `matched`, not by confidence — see filterToCoveredSegments).
// ===========================================================================
describe('WS5/S3 — repeated phrases resolve by position, not by first occurrence', () => {
  it('scene doc says a phrase twice, audio says it once: the audio-consistent instance wins', () => {
    // The transcript order is [alpha bravo charlie delta] THEN [the cat sat...],
    // so the ONLY monotonic reading is that s2 owns the spoken phrase. A naive
    // first-occurrence matcher would have given it to s0 and dragged the whole
    // rest of the timeline backwards.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'the cat sat on the mat' }),
      makeSegment({ id: 's1', order: 1, text: 'alpha bravo charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'the cat sat on the mat' }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta the cat sat on the mat', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    expect(cov[2]!.confidence).toBe(1);   // the second instance took the audio
    expect(cov[0]!.confidence).toBe(0);   // the first is genuinely unspoken
    expect(cov[1]!.confidence).toBe(1);

    // s2's audio region is the tail of the transcript, after s1's — monotonic.
    expect(cov[2]!.t0).toBeGreaterThanOrEqual(cov[1]!.t1);
  });

  it('the duplicated-but-unspoken instance is skipped, not mistimed', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'the cat sat on the mat' }),
      makeSegment({ id: 's1', order: 1, text: 'alpha bravo charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'the cat sat on the mat' }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta the cat sat on the mat', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    const { kept, skipped } = filterToCoveredSegments(segments, cov);

    expect(kept.map(s => s.id)).toEqual(['s1', 's2']);
    expect(skipped.map(r => r.segmentIndex)).toEqual([0]);
  });

  it('audio says a phrase twice, scene doc says it once: one instance is consumed, order holds', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'the cat sat on the mat' }),
      makeSegment({ id: 's1', order: 1, text: 'zulu yankee' }),
    ];
    const tokens = wordTokens('the cat sat on the mat the cat sat on the mat zulu yankee', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    expect(cov[0]!.confidence).toBe(1);
    expect(cov[1]!.confidence).toBe(1);
    // s0 must end before s1's spoken words begin — the extra transcript copy
    // does not let s0 straddle s1.
    expect(cov[0]!.t1).toBeLessThanOrEqual(cov[1]!.t0);
  });

  it('the surplus spoken copy shows up as reduced transcript coverage, not as an abort', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'the cat sat on the mat' }),
      makeSegment({ id: 's1', order: 1, text: 'zulu yankee' }),
    ];
    const tokens = wordTokens('the cat sat on the mat the cat sat on the mat zulu yankee', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    const summary = computeCoverageSummary(cov, countTranscriptWords(tokens));

    expect(summary.sceneDocCoverage).toBe(1);          // every written word was said
    expect(summary.transcriptCoverage).toBeLessThan(1); // but the audio said more
    expect(evaluateCoverageGate(segments, cov, countTranscriptWords(tokens)).aborted).toBe(false);
  });
});

describe('WS5/S3 — inflected forms stay above the coverage threshold without stemming', () => {
  // Layered history — a two-word segment with one inflected word produces a
  // longest run of exactly 1 (the single matched word is a lone anchor; a
  // run can't start/end on a hole, so it can never be extended).
  //   - Bug C (2026-08-02, first pass): required a run of 2 for a 2-word
  //     segment, so a run of 1 fell short — an accepted, stated sacrifice at
  //     the time (the RATIO (0.5) still cleared LOW_CONFIDENCE_RATIO fine,
  //     but the independent run requirement decided `matched` first).
  //   - Threshold recalibration (second pass, 2026-08-02): 1-3-word segments
  //     now require only a run of 1 (syncConstants.ts's RUN_SURVIVAL_*
  //     header), so this single matched word qualifies directly again — the
  //     same outcome the pre-Bug-C doctrine gave this exact shape, just
  //     reached through the run mechanism rather than a bare non-zero count.
  // See the "realistic sentence"/"all-inflected" tests below for the
  // multi-word case, where an inflection surrounded by other true matches
  // still forms a real run and survives regardless of this band.
  it('"running fast" vs spoken "runs fast": confidence 0.5, survives via the 1-3-word band (isolated single-word run)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'running fast' }),
      makeSegment({ id: 's1', order: 1, text: 'alpha bravo' }),
    ];
    const tokens = wordTokens('runs fast alpha bravo', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    expect(cov[0]!.confidence).toBe(0.5);
    expect(cov[0]!.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE_RATIO);
    expect(cov[0]!.longestRun).toBe(1);
    expect(cov[0]!.matched).toBe(true);
    expect(classifyCoverage(cov)[0]!.covered).toBe(true);
  });

  it('"bigger than" vs spoken "big than": confidence 0.5, survives via the 1-3-word band (isolated single-word run)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'bigger than' }),
      makeSegment({ id: 's1', order: 1, text: 'alpha bravo' }),
    ];
    const tokens = wordTokens('big than alpha bravo', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    expect(cov[0]!.confidence).toBe(0.5);
    expect(cov[0]!.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE_RATIO);
    expect(cov[0]!.longestRun).toBe(1);
    expect(cov[0]!.matched).toBe(true);
    expect(classifyCoverage(cov)[0]!.covered).toBe(true);
  });

  it('a realistic sentence with two inflected words stays well above the threshold', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'the runner was running fast down the road' }),
      makeSegment({ id: 's1', order: 1, text: 'she walked slowly toward the bigger house' }),
    ];
    const tokens = wordTokens(
      'the runner runs fast down the road she walks slowly toward the big house', 0, 0.5,
    );
    const cov = extractSegmentAlignments(segments, tokens);

    expect(cov[0]!.confidence).toBeCloseTo(0.75, 5);
    expect(cov[1]!.confidence).toBeCloseTo(5 / 7, 5);
    // updated 2026-08-02: run-based survival (Bug C fix) — s0 (8 words)
    // splits into two candidate runs: "the runner" (2, matched consecutively)
    // and "fast down the road" (4, also matched consecutively, with no holes
    // inside it — "was"/"running" sit BEFORE it and break the chain from "the
    // runner", since "running"'s transcript counterpart "runs" occupies a
    // subject slot the pure-deletion "was" does not, so the two runs cannot
    // bridge into one). s1 (7 words) has a longest run of 3
    // ("slowly toward the" — a plain 3-word contiguous run, no holes inside
    // it either; "she"/"house" are each isolated on one side by a
    // substitution-blocked gap with nothing to extend into, since a run
    // can't start or end on a hole).
    //
    // RECALIBRATED (threshold recalibration, second pass, 2026-08-02): under
    // Bug C's ORIGINAL ratio-scaled bands, an 8-word segment required
    // ceil(0.5*8)=4 (s0's run of 4 just cleared it) and a 7-word segment also
    // required ceil(0.5*7)=4 (s1's run of 3 fell one short, so s1 used to
    // SKIP here). The flat recalibrated bands require only
    // RUN_SURVIVAL_MIN_RUN_SHORT (2) for any 4-10-word segment — both runs
    // clear it comfortably now, so s1 survives too. Confidence (5/7 ≈ 0.71)
    // was never the deciding factor either way — it is a completely separate
    // axis from run contiguity.
    expect(cov[0]!.longestRun).toBe(4);
    expect(cov[1]!.longestRun).toBe(3);
    expect(cov[0]!.matched).toBe(true);
    expect(cov[1]!.matched).toBe(true);
    expect(classifyCoverage(cov).map(c => c.covered)).toEqual([true, true]);
  });

  it('an all-inflected segment is now SKIPPED — a single isolated function-word match is no longer enough to survive (Bug C)', () => {
    // updated 2026-08-02: run-based survival (Bug C fix) — this fixture used
    // to demonstrate the OPPOSITE point ("still MATCHED, so it is never
    // skipped") under Bug 2's "any real match keeps it" doctrine. Under Bug
    // C that doctrine is superseded: s2's only true match is "the" (a single
    // isolated anchor — "walking"/"running"/"jumping"/"climbing" all fail to
    // match their inflected transcript counterparts), longest run = 1
    // against a required run of RUN_SURVIVAL_MIN_RUN_SHORT (2, recalibrated
    // second pass, 2026-08-02 — was 3 under Bug C's original ratio-scaled
    // band) for this 5-word segment. Confidence (0.2) is also far under the
    // density fallback's 0.5 floor, so neither survival mechanism rescues it.
    // The pathological no-stemming case is still real (confidence is still
    // low, still matched-not-covered in spirit) — but Bug C's judgment is
    // that ONE shared function word is too weak a signal to trust on its
    // own, so this segment still correctly skips instead of surviving on a
    // technicality.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta' }),
      makeSegment({ id: 's1', order: 1, text: 'echo foxtrot golf hotel' }),
      makeSegment({ id: 's2', order: 2, text: 'the walking running jumping climbing' }),
    ];
    const tokens = wordTokens(
      'alpha bravo charlie delta echo foxtrot golf hotel the walks runs jumps climbs', 0, 0.5,
    );
    const cov = extractSegmentAlignments(segments, tokens);

    expect(cov[2]!.confidence).toBeLessThan(LOW_CONFIDENCE_RATIO);
    expect(cov[2]!.matchedWords).toBe(1); // preserved, not zeroed
    expect(cov[2]!.longestRun).toBe(1);
    expect(cov[2]!.matched).toBe(false);
    expect(filterToCoveredSegments(segments, cov).kept.map(s => s.id))
      .toEqual(['s0', 's1']);
  });
});

// ===========================================================================
// WS5 Feature 4 — threshold boundary locks.
//
// These pin the EXACT comparison semantics of the two sync thresholds so a
// future refactor cannot quietly turn `>=` into `>` (or move a value) without a
// red test. Each fixture is constructed to land ON the boundary, not near it.
//
// NOTE on naming: there is no `R13_ABORT_THRESHOLD` constant in this codebase.
// The 0.4 value is LOW_CONFIDENCE_RATIO (per-segment coverage classification).
// The R13 abort gate is a different, two-signal mechanism entirely —
// MIN_COVERED_RUN_LENGTH (a run LENGTH, not a ratio) and NOISE_FLOOR_COVERAGE
// (0.1). Both are locked below. See the WS5 entry in project-state.md.
// ===========================================================================
describe('WS5 — LOW_CONFIDENCE_RATIO boundary is inclusive', () => {
  // s2 is built so exactly 2 of its 5 words are spoken -> confidence 0.4 exactly.
  // s3 has exactly 1 of 5 -> 0.2, comfortably under.
  //
  // updated (threshold recalibration, second pass, 2026-08-02): s2's two
  // spoken words are "kilo" and "xray" — the FIRST and LAST of its 5 query
  // words, not two adjacent ones — so its longest run stays 1 (the 3
  // unmatched words between them, "lima zulu yankee", exceed
  // RUN_SURVIVAL_MAX_HOLE (2), so the gap can never bridge regardless of
  // transcript contiguity). This is deliberate: with the recalibrated flat
  // required run of RUN_SURVIVAL_MIN_RUN_SHORT (2) for a 4-10-word segment,
  // two ADJACENT matches (as the original "kilo","lima" fixture had) would
  // themselves form a run of 2 and pass the run gate outright — defeating
  // this section's whole point of isolating the ratio's `>=` boundary from
  // the (still independent) run/density gate.
  const segments: VideoSegment[] = [
    makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta echo' }),
    makeSegment({ id: 's1', order: 1, text: 'foxtrot golf hotel india juliet' }),
    makeSegment({ id: 's2', order: 2, text: 'kilo lima zulu yankee xray' }),
    makeSegment({ id: 's3', order: 3, text: 'mike november quebec romeo sierra' }),
  ];
  const tokens = wordTokens(
    'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo xray mike', 0, 0.5,
  );

  it('the fixture really does sit exactly on the threshold', () => {
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[2]!.confidence).toBe(LOW_CONFIDENCE_RATIO); // 0.4 exactly
    expect(cov[2]!.matchedWords).toBe(2);
    expect(cov[2]!.totalWords).toBe(5);
  });

  // updated 2026-08-02: run-based survival (Bug C fix), recalibrated
  // (second pass, 2026-08-02) — this fixture's whole PURPOSE is to isolate
  // the LOW_CONFIDENCE_RATIO `>=` boundary from any other gate. s2's 2
  // matched words ("kilo","xray") sit at opposite ends of the 5-word
  // segment (3 unmatched words between them, over RUN_SURVIVAL_MAX_HOLE),
  // so the run stays 1 — one short of the recalibrated flat required run of
  // 2 for a 4-10-word segment. Confidence (0.4) is also under the density
  // fallback's 0.5 floor, so neither survival mechanism rescues it — s2
  // fails independently of clearing this ratio exactly. `classifyCoverage`
  // still ANDs `matched` into `covered`, so once `matched` is false for an
  // unrelated reason, this fixture can no longer isolate the ratio's `>=`
  // semantics in isolation — it demonstrates the AND instead. The ratio
  // comparison itself is unchanged (still `>=`); see syncConstants.ts's
  // LOW_CONFIDENCE_RATIO comment for the updated contract.
  it('confidence EXACTLY at LOW_CONFIDENCE_RATIO no longer alone decides `covered` — the run gate can independently fail it', () => {
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[2]!.longestRun).toBe(1); // "kilo","xray" — each isolated, 3 unmatched words separate them
    expect(cov[2]!.matched).toBe(false);
    expect(classifyCoverage(cov)[2]!.covered).toBe(false);
  });

  it('confidence just below LOW_CONFIDENCE_RATIO classifies as uncovered', () => {
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[3]!.confidence).toBeLessThan(LOW_CONFIDENCE_RATIO);
    expect(classifyCoverage(cov)[3]!.covered).toBe(false);
  });

  // updated 2026-08-02: run-based survival (Bug C fix), recalibrated (second
  // pass, 2026-08-02) — s2 (run 1 < recalibrated required 2, confidence 0.4
  // under the density floor of 0.5) and s3 (run 1 < required 2, its lone
  // "mike" match, confidence 0.2 also under the density floor) both fail the
  // run gate independently of their ratio, so both are skipped. Only s0/s1
  // (full 5/5 matches, run 5) survive.
  it('a segment whose real matches are too scattered to form a run is skipped, even if some clear the confidence ratio', () => {
    const cov = extractSegmentAlignments(segments, tokens);
    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s0', 's1']);
    expect(skipped.map(r => r.segmentIndex)).toEqual([2, 3]);
    expect(skipped.every(r => r.reason === 'no audio match')).toBe(true);
  });

  it('the same threshold governs the covered-run scan inside computeCoverageSummary', () => {
    const cov = extractSegmentAlignments(segments, tokens);
    // updated 2026-08-02: run-based survival (Bug C fix) — s2 no longer
    // covered (see above), so the longest covered run is now just s0,s1 -> 2,
    // not 3.
    expect(computeCoverageSummary(cov, countTranscriptWords(tokens)).longestCoveredRun).toBe(2);
  });
});

describe('WS5 — R13 gate Signal 1 boundary (MIN_COVERED_RUN_LENGTH)', () => {
  it('a covered run one short of MIN_COVERED_RUN_LENGTH aborts', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot' }),
    ];
    const tokens = wordTokens('alpha bravo', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    const summary = computeCoverageSummary(cov, countTranscriptWords(tokens));

    expect(summary.longestCoveredRun).toBe(MIN_COVERED_RUN_LENGTH - 1);
    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(true);
    if (gate.aborted) expect(gate.message).toBe(FULL_MISMATCH_MESSAGE);
  });

  it('a covered run exactly AT MIN_COVERED_RUN_LENGTH passes (>=, not >)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot' }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    const summary = computeCoverageSummary(cov, countTranscriptWords(tokens));

    expect(summary.longestCoveredRun).toBe(MIN_COVERED_RUN_LENGTH);
    expect(evaluateCoverageGate(segments, cov, countTranscriptWords(tokens)).aborted).toBe(false);
  });
});

describe('WS5 — R13 gate Signal 2 boundary (NOISE_FLOOR_COVERAGE)', () => {
  // Both fixtures hold the covered run at 2 (Signal 1 passes) and vary ONLY the
  // volume of unspoken scene-doc text, so the bidirectional coverage straddles
  // the noise floor and nothing else changes.
  // Pure-alphabetic noise words on purpose: a digit in the word would be
  // expanded to its spoken form by `canonicalize` ("noise12" -> two words), so
  // the scene-doc word count would no longer equal the noise-word count and the
  // fixture would miss the boundary it is aiming at.
  function noiseWords(count: number): string {
    return Array.from({ length: count }, (_, i) =>
      `noise${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`,
    ).join(' ');
  }

  function fixture(noiseWordCount: number) {
    const noise = noiseWords(noiseWordCount);
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: noise }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    return { segments, cov, totalTranscriptWords: countTranscriptWords(tokens) };
  }

  it('bidirectional coverage EXACTLY at NOISE_FLOOR_COVERAGE passes (abort is <, not <=)', () => {
    // 4 matched / 40 total scene-doc words = 0.1 exactly.
    const { segments, cov, totalTranscriptWords } = fixture(36);
    const summary = computeCoverageSummary(cov, totalTranscriptWords);

    expect(summary.longestCoveredRun).toBeGreaterThanOrEqual(MIN_COVERED_RUN_LENGTH);
    expect(summary.bidirectionalCoverage).toBeCloseTo(NOISE_FLOOR_COVERAGE, 10);
    expect(evaluateCoverageGate(segments, cov, totalTranscriptWords).aborted).toBe(false);
  });

  it('bidirectional coverage just below NOISE_FLOOR_COVERAGE aborts', () => {
    // 4 matched / 41 total scene-doc words = 0.0976 — one word over the line.
    const { segments, cov, totalTranscriptWords } = fixture(37);
    const summary = computeCoverageSummary(cov, totalTranscriptWords);

    expect(summary.longestCoveredRun).toBeGreaterThanOrEqual(MIN_COVERED_RUN_LENGTH);
    expect(summary.bidirectionalCoverage).toBeLessThan(NOISE_FLOOR_COVERAGE);
    const gate = evaluateCoverageGate(segments, cov, totalTranscriptWords);
    expect(gate.aborted).toBe(true);
    if (gate.aborted) expect(gate.message).toBe(FULL_MISMATCH_MESSAGE);
  });
});

describe('WS5 — full-mismatch and perfect-match end points', () => {
  it('0% overlap aborts with the full-mismatch message', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie' }),
      makeSegment({ id: 's1', order: 1, text: 'delta echo foxtrot' }),
      makeSegment({ id: 's2', order: 2, text: 'golf hotel india' }),
    ];
    const tokens = wordTokens('zulu yankee xray whiskey victor uniform tango sierra romeo', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    const summary = computeCoverageSummary(cov, countTranscriptWords(tokens));

    expect(summary.sceneDocCoverage).toBe(0);
    expect(summary.bidirectionalCoverage).toBe(0);
    expect(summary.longestCoveredRun).toBe(0);
    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(true);
    if (gate.aborted) expect(gate.message).toBe(FULL_MISMATCH_MESSAGE);
  });

  it('100% overlap covers every segment, skips nothing, and does not abort', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie' }),
      makeSegment({ id: 's1', order: 1, text: 'delta echo foxtrot' }),
      makeSegment({ id: 's2', order: 2, text: 'golf hotel india' }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta echo foxtrot golf hotel india', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    const summary = computeCoverageSummary(cov, countTranscriptWords(tokens));

    expect(summary.sceneDocCoverage).toBe(1);
    expect(summary.transcriptCoverage).toBe(1);
    expect(summary.bidirectionalCoverage).toBe(1);
    expect(summary.longestCoveredRun).toBe(3);
    expect(classifyCoverage(cov).map(c => c.covered)).toEqual([true, true, true]);
    expect(evaluateCoverageGate(segments, cov, countTranscriptWords(tokens)).aborted).toBe(false);
    expect(filterToCoveredSegments(segments, cov).skipped).toEqual([]);
  });
});

// ===========================================================================
// WS5 Feature 2 — speaker labels through the aligner.
// The unit-level grammar lives in textNormalize.test.ts; this is the end-to-end
// proof that a labelled scene doc aligns identically to an unlabelled one.
// ===========================================================================
describe('WS5 — speaker-label stripping through the aligner', () => {
  const spoken = wordTokens('the kettle is boiling she pours the tea', 0, 0.4);

  const cleanDoc = [
    makeSegment({ id: 'a', order: 0, text: 'the kettle is boiling' }),
    makeSegment({ id: 'b', order: 1, text: 'she pours the tea' }),
  ];
  const labelledDoc = [
    makeSegment({ id: 'a', order: 0, text: 'NARRATOR: the kettle is boiling' }),
    makeSegment({ id: 'b', order: 1, text: 'VOICE 2: (softly) she pours the tea' }),
  ];

  it('a labelled document aligns with the same confidence and word counts', () => {
    const clean = extractSegmentAlignments(cleanDoc, spoken);
    const labelled = extractSegmentAlignments(labelledDoc, spoken);

    expect(clean.map(a => a.confidence)).toEqual([1, 1]);
    expect(labelled.map(a => a.confidence)).toEqual(clean.map(a => a.confidence));
    expect(labelled.map(a => a.totalWords)).toEqual(clean.map(a => a.totalWords));
  });

  it('a labelled document produces the same boundaries', () => {
    const clean = alignScenestoTranscript(cleanDoc, spoken, []);
    const labelled = alignScenestoTranscript(labelledDoc, spoken, []);
    expect(labelled.map(a => [a.t0, a.t1])).toEqual(clean.map(a => [a.t0, a.t1]));
  });

  it('an unstripped label would have cost confidence — proving the strip does work', () => {
    // Same doc, but lowercase so the label rule deliberately does NOT fire.
    const lowercaseLabel = [
      makeSegment({ id: 'a', order: 0, text: 'narrator: the kettle is boiling' }),
      makeSegment({ id: 'b', order: 1, text: 'she pours the tea' }),
    ];
    const cov = extractSegmentAlignments(lowercaseLabel, spoken);
    expect(cov[0]!.totalWords).toBe(5);       // "narrator" counted as a word
    expect(cov[0]!.confidence).toBeLessThan(1);
  });

  it('does not strip the transcript side — a spoken uppercase colon phrase still matches', () => {
    const tokens: TranscriptToken[] = [
      { startSec: 0, endSec: 0.5, text: 'NARRATOR:' },
      { startSec: 0.5, endSec: 1.0, text: 'hello' },
    ];
    const segs = [makeSegment({ id: 'x', order: 0, text: 'narrator hello' })];
    expect(extractSegmentAlignments(segs, tokens)[0]!.confidence).toBe(1);
  });
});

// ===========================================================================
// WS6 — Per-segment temporal-bounding rescue (token-stealing fix, 2026-07-29)
// ===========================================================================
// Root cause (doc: "Per-Segment Temporal Bounding"): pure global Hirschberg
// alignment has no temporal awareness. A segment whose narration overflows
// its expected slot can have its own trailing words genuinely match transcript
// tokens positioned AFTER a neighbor's real content — monotonicity then
// structurally blocks that neighbor from reaching backward to its own words,
// even though nobody ever truly claims them (they end up as insertions/
// substitutions, never entering `matchedSubjectOf`). `extractSegmentAlignments`
// now runs a targeted RESCUE, after the unchanged global pass, for any segment
// left at zero true matches: bound a search to a window around its own
// anchorStart, score candidates with a temporal-proximity bonus, and fall back
// to a plain exact-text scan — but ONLY ever using transcript words no other
// segment's global pass already truly matched (`globallyClaimed`), and only
// when the segment has a real anchorStart to bound against.
describe('WS6 — per-segment temporal-bounding rescue', () => {
  // Shared repro shape across most of this block: a preceding segment (P)
  // whose OWN real trailing match is genuinely spoken AFTER a target segment's
  // (T) real words, monotonically blocking the global pass from ever giving T
  // its true match — the actual mechanism reproduced from the reported bug
  // (verified via now-removed temporary production instrumentation), not a hand-waved
  // stand-in for it.

  it('1) token-stealing repro: an overflowing neighbor traps a segment at 0/3; rescue recovers 3/3, not a fuzzy/partial match', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's151', order: 0, text: 'wool comes from sheep', anchorStart: 0 }),
      // s152 "overflows": its script continues past the disputed words with
      // its OWN real trailing content ("denim is durable"), genuinely spoken
      // AFTER "linen from flax" — which is s153's content, not s152's.
      makeSegment({ id: 's152', order: 1, text: 'garbled overflow xyzzy plugh mumble denim is durable', anchorStart: 3 }),
      makeSegment({ id: 's153', order: 2, text: 'linen from flax', anchorStart: 6 }),
      makeSegment({ id: 's154', order: 3, text: 'silk is smooth too', anchorStart: 9 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('wool comes from sheep', 0.0, 0.4),
      ...wordTokens('linen from flax', 6.0, 0.4),   // s153's real, single utterance
      ...wordTokens('denim is durable', 7.5, 0.4),  // s152's own real trailing content, spoken AFTER
      ...wordTokens('silk is smooth too', 9.0, 0.4),
    ];

    const results = extractSegmentAlignments(segments, tokens);

    // Sanity: the trap is real under the unchanged global pass — s152 only
    // truly matches its own trailing "denim is durable" (3 of 8 words); the
    // disputed "linen from flax" never enters ANYONE's true-match set.
    expect(results[1]!.matchedWords).toBe(3);
    expect(results[1]!.totalWords).toBe(8);

    // The fix: s153 is recovered to a full, exact 3/3 — not a partial or
    // fuzzy recovery.
    expect(results[2]!.matched).toBe(true);
    expect(results[2]!.matchedWords).toBe(3);
    expect(results[2]!.totalWords).toBe(3);
    expect(results[2]!.confidence).toBe(1);
    // Recovered from its real audio position (6.0s), not some other anchor.
    expect(results[2]!.t0).toBeCloseTo(6.0, 3);
    expect(results[2]!.t1).toBeCloseTo(7.2, 3);

    // Neighbors are undisturbed.
    expect(results[0]!.confidence).toBe(1);
    expect(results[3]!.confidence).toBe(1);
  });

  it('2) bounding prevents overflow: a zero-matched segment does not reach into a temporally distant neighbor\'s real content', () => {
    // A has 5 genuinely unmatched words (nothing in the transcript resembles
    // them) and a real anchor; B's true content is spoken WELL past both A's
    // window and a naive expectation, but still inside B's OWN generous window.
    const segments: VideoSegment[] = [
      makeSegment({ id: 'a', order: 0, text: 'zeta yotta wobble plink quorx', anchorStart: 0 }),
      makeSegment({ id: 'b', order: 1, text: 'hello world today', anchorStart: 10 }),
      makeSegment({ id: 'c', order: 2, text: 'closing remarks now', anchorStart: 30 }),
    ];
    // A's rescue window: [0-1.5, 10+1.5] = [-1.5, 11.5] (tolerance floors at
    // 1.5s for a 10s slot). B's real "hello world today" is spoken at 18s —
    // 8s past B's own anchor, and well outside A's window.
    const tokens: TranscriptToken[] = [
      ...wordTokens('hello world today', 18.0, 0.4),
      ...wordTokens('closing remarks now', 30.0, 0.4),
    ];

    const results = extractSegmentAlignments(segments, tokens);

    // A finds nothing — its window never reaches B's real content.
    expect(results[0]!.matched).toBe(false);
    expect(results[0]!.matchedWords).toBe(0);

    // B recovers its own words fully, from its own (wider) window.
    expect(results[1]!.matched).toBe(true);
    expect(results[1]!.matchedWords).toBe(3);
    expect(results[1]!.t0).toBeCloseTo(18.0, 3);

    expect(results[2]!.confidence).toBe(1);
  });

  it('3) monotonic exclusivity: a segment cannot recover a word another segment genuinely, globally matched', () => {
    // Only one "linen" is ever spoken, immediately followed by "shoe". C's
    // isolated "linen" and D's contiguous "linen shoe" tie in the unchanged
    // global pass, and the tie resolves entirely to D (a stronger, contiguous
    // 2-word claim) — C is left genuinely zero-matched. C's own rescue window
    // ([12-1.5, 15+1.5] = [10.5, 16.5]) temporally overlaps D's real "linen"
    // token (t=15), so this is a real test of the exclusion, not a no-op.
    const segments: VideoSegment[] = [
      makeSegment({ id: 'c', order: 0, text: 'linen', anchorStart: 12 }),
      makeSegment({ id: 'd', order: 1, text: 'linen shoe', anchorStart: 15 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('linen shoe', 15.0, 0.4),
    ];

    const results = extractSegmentAlignments(segments, tokens);

    // Sanity: the tie really did resolve entirely to D under the unchanged
    // global pass, leaving C at zero — the precondition for this test.
    expect(results[0]!.matched).toBe(false);
    expect(results[0]!.matchedWords).toBe(0);
    expect(results[1]!.matched).toBe(true);
    expect(results[1]!.matchedWords).toBe(2);

    // C's rescue must NOT poach D's real "linen" even though it falls inside
    // C's own window — C stays uncovered rather than stealing it back.
    expect(results[0]!.matched).toBe(false);
    expect(results[0]!.matchedWords).toBe(0);
  });

  it('4) temporal bonus breaks ties: a free (unclaimed) word occurring twice in the window resolves to the temporally central occurrence', () => {
    // P's own real trailing match ("gamma delta") is spoken after BOTH
    // "linen" occurrences, monotonically blocking the global pass from
    // giving C either one — exactly the trap from case (1), but engineered
    // so TWO free candidates exist in C's window: one near the window edge
    // (t=11), one dead center (t=15, matching C's expectedCenter exactly).
    const segments: VideoSegment[] = [
      makeSegment({ id: 'p', order: 0, text: 'alpha bravo gamma delta', anchorStart: 0 }),
      makeSegment({ id: 'c', order: 1, text: 'linen', anchorStart: 12 }),
      makeSegment({ id: 'next', order: 2, text: 'zulu yankee', anchorStart: 18 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo', 0.0, 0.4),   // P's real leading match
      ...wordTokens('linen', 11.0, 0.4),        // edge candidate (outside central 50%)
      ...wordTokens('linen', 15.0, 0.4),        // center candidate (= C's expectedCenter)
      ...wordTokens('gamma delta', 21.0, 0.4),  // P's real trailing match, AFTER both linens
      ...wordTokens('zulu yankee', 23.0, 0.4),
    ];

    const results = extractSegmentAlignments(segments, tokens);

    // C's window is [12-1.5, 18+1.5] = [10.5, 19.5] (tolerance floors at
    // 1.5s for a 6s slot) — both linens qualify. expectedCenter = 15, exactly
    // the second occurrence's timestamp; the first is 4s off in a 4.5s
    // half-window (outside the central 50% band, bonus 0). The rescue must
    // pick the t=15 occurrence, not merely the first one found.
    expect(results[1]!.matched).toBe(true);
    expect(results[1]!.matchedWords).toBe(1);
    expect(results[1]!.t0).toBeCloseTo(15.0, 3);
  });

  it('5) fallback recovery: a zero-matched segment\'s words, genuinely present in its window, are recovered', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 'p', order: 0, text: 'able baker torque plexus quiver zircon', anchorStart: 0 }),
      makeSegment({ id: 'c', order: 1, text: 'echo foxtrot golf', anchorStart: 6 }),
      makeSegment({ id: 'next', order: 2, text: 'hotel india', anchorStart: 12 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('able baker', 0.0, 0.4),
      ...wordTokens('echo foxtrot golf', 6.4, 0.4),        // C's real words, genuinely present
      ...wordTokens('torque plexus quiver zircon', 9.0, 0.4), // P's real trailing match (4 words,
      // outweighing C's 3 so the global tie resolves decisively toward P — see
      // case (1)'s comment on why a same-count trailing match is a fragile tie),
      // spoken AFTER C's words
      ...wordTokens('hotel india', 12.0, 0.4),
    ];

    const results = extractSegmentAlignments(segments, tokens);

    expect(results[1]!.matched).toBe(true);
    expect(results[1]!.matchedWords).toBe(3);
    expect(results[1]!.totalWords).toBe(3);
    expect(results[1]!.confidence).toBe(1);
  });

  it('6) no false positives: recovery does not fire when a zero-matched segment\'s words are genuinely absent from its window', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 'p', order: 0, text: 'able baker charlie delta', anchorStart: 0 }),
      makeSegment({ id: 'd', order: 1, text: 'nonexistent phantom words', anchorStart: 6 }),
      makeSegment({ id: 'next', order: 2, text: 'hotel india', anchorStart: 12 }),
    ];
    // D's words never occur anywhere in the transcript, at any time.
    const tokens: TranscriptToken[] = [
      ...wordTokens('able baker charlie delta', 0.0, 0.4),
      ...wordTokens('hotel india', 12.0, 0.4),
    ];

    const results = extractSegmentAlignments(segments, tokens);

    expect(results[1]!.matched).toBe(false);
    expect(results[1]!.matchedWords).toBe(0);
    expect(results[1]!.confidence).toBe(0);
  });

  it('7) regression: a cleanly-anchored, correctly-aligning multi-segment project is unaffected by bounding', () => {
    // 12 segments, each with an accurate anchorStart and real, matching
    // audio — no overflow, no ambiguity. Bounding must not cost any of them
    // a match they'd have gotten from the (unchanged) global pass alone.
    const words = [
      'one', 'two', 'three', 'four', 'five', 'six',
      'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    ];
    const segments: VideoSegment[] = words.map((w, i) =>
      makeSegment({ id: `w${i}`, order: i, text: `segment number ${w}`, anchorStart: i * 2 }),
    );
    const tokens: TranscriptToken[] = words.flatMap((w, i) =>
      wordTokens(`segment number ${w}`, i * 2, 0.4),
    );

    const results = extractSegmentAlignments(segments, tokens);
    expect(results.every(r => r.matched)).toBe(true);
    expect(results.every(r => r.confidence === 1)).toBe(true);
    expect(results.map(r => r.matchedWords)).toEqual(words.map(() => 3));
  });

  it('8) tolerance scaling: a long segment caps at 5s, a short segment floors at 1.5s (Pass 1\'s window boundary — Pass 2 still recovers past it via the unbounded global fallback)', () => {
    // Long segment: a 60s slot (anchorStart 0 -> next anchorStart 60) caps
    // Pass 1's window tolerance at TEMPORAL_TOLERANCE_MAX_SEC (5s), not
    // 0.1*60=6s. A word at expectedEnd + 4.5s (inside the cap) recovers via
    // Pass 1 (windowed). A word at expectedEnd + 5.5s (outside the cap) no
    // longer goes unrecovered as it once did — Pass 2's unbounded global
    // fallback still finds it, since it's genuinely present and unclaimed.
    // The tolerance cap now decides WHICH pass recovers a word, not whether
    // it's recovered at all — asserted here via the [align-recover] log's
    // "via fallback" (Pass 1) vs "via ... GLOBAL fallback" (Pass 2) label.
    // Uses the same "P blocks C" trap as case (1) — P's own trailing content
    // ("torque plexus"), spoken after "linen", is what forces C to zero
    // matches in the first place; without it C would just match "linen"
    // directly from the unchanged global pass and never reach the rescue's
    // window logic at all.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const longSlot = (offsetSec: number)=> {
      const linenAt = 65 + offsetSec;
      const segments: VideoSegment[] = [
        makeSegment({ id: 'p', order: 0, text: 'alpha bravo torque plexus', anchorStart: 0 }),
        makeSegment({ id: 'c', order: 1, text: 'linen', anchorStart: 5 }),
        makeSegment({ id: 'next', order: 2, text: 'zulu yankee', anchorStart: 65 }),
      ];
      const tokens: TranscriptToken[] = [
        ...wordTokens('alpha bravo', 0.0, 0.4),
        ...wordTokens('linen', linenAt, 0.4),
        ...wordTokens('torque plexus', linenAt + 5, 0.4), // P's real trailing match, after linen
        ...wordTokens('zulu yankee', linenAt + 10, 0.4),
      ];
      return extractSegmentAlignments(segments, tokens)[1]!;
    };
    // next.anchorStart=65 -> tolerance = clamp(0.1*60, 1.5, 5) = 5 (capped).
    // window = [5-5, 65+5] = [0, 70).
    logSpy.mockClear();
    expect(longSlot(4.5).matched).toBe(true);   // linen at 69.5 < 70: inside Pass 1's window
    expect(logSpy.mock.calls.some(a => String(a[0]).includes('via fallback'))).toBe(true);
    expect(logSpy.mock.calls.some(a => String(a[0]).includes('GLOBAL'))).toBe(false);

    logSpy.mockClear();
    expect(longSlot(5.5).matched).toBe(true);   // linen at 70.5 >= 70: outside the capped window,
    // but still genuinely present and unclaimed — recovered by Pass 2 instead.
    expect(logSpy.mock.calls.some(a => String(a[0]).includes('GLOBAL fallback'))).toBe(true);

    // Short segment: a 10s slot floors tolerance at 1.5s, not 0.1*10=1.0s.
    // Same P-blocks-C trap as above.
    const shortSlot = (offsetSec: number)=> {
      const linenAt = 15 + offsetSec;
      const segments: VideoSegment[] = [
        makeSegment({ id: 'p', order: 0, text: 'alpha bravo torque plexus', anchorStart: 0 }),
        makeSegment({ id: 'c', order: 1, text: 'linen', anchorStart: 5 }),
        makeSegment({ id: 'next', order: 2, text: 'zulu yankee', anchorStart: 15 }),
      ];
      const tokens: TranscriptToken[] = [
        ...wordTokens('alpha bravo', 0.0, 0.4),
        ...wordTokens('linen', linenAt, 0.4),
        ...wordTokens('torque plexus', linenAt + 5, 0.4),
        ...wordTokens('zulu yankee', linenAt + 10, 0.4),
      ];
      return extractSegmentAlignments(segments, tokens)[1]!;
    };
    // next.anchorStart=15 -> tolerance = clamp(0.1*10, 1.5, 5) = 1.5 (floored).
    // window = [5-1.5, 15+1.5] = [3.5, 16.5).
    logSpy.mockClear();
    expect(shortSlot(1.2).matched).toBe(true);   // 16.2 < 16.5: inside (only the 1.5s floor allows this)
    expect(logSpy.mock.calls.some(a => String(a[0]).includes('GLOBAL'))).toBe(false);

    logSpy.mockClear();
    expect(shortSlot(1.8).matched).toBe(true);   // 16.8 >= 16.5: outside even the floored window,
    // recovered by Pass 2 instead.
    expect(logSpy.mock.calls.some(a => String(a[0]).includes('GLOBAL fallback'))).toBe(true);

    logSpy.mockRestore();
  });

  it('9) last-segment window: with no successor, the window extends to audio end + tolerance', () => {
    // Same P-blocks-C trap: P's own trailing ("torque plexus") is spoken
    // after "omega", so the unchanged global pass gives it to P instead,
    // leaving the last segment genuinely zero-matched and dependent on the
    // rescue reaching all the way to audioDuration + tolerance.
    const segments: VideoSegment[] = [
      makeSegment({ id: 'p', order: 0, text: 'alpha bravo torque plexus', anchorStart: 0 }),
      makeSegment({ id: 'last', order: 1, text: 'omega', anchorStart: 5 }),
    ];
    // Audio actually ends at ~10.8s (the last real token's endSec, "plexus").
    // "omega" is spoken at 7.9s — past the nominal anchor but within the
    // floored 1.5s tolerance added past the (now later) audio end.
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo', 0.0, 0.4),
      ...wordTokens('omega', 7.9, 0.5),        // last segment's real word
      ...wordTokens('torque plexus', 10.0, 0.4), // P's real trailing match, after omega
    ];

    const results = extractSegmentAlignments(segments, tokens);
    expect(results[1]!.matched).toBe(true);
    expect(results[1]!.matchedWords).toBe(1);
    expect(results[1]!.t0).toBeCloseTo(7.9, 3);
  });

  it('10) global fallback: a drifted anchorStart places the real words entirely outside the windowed pass, recovered by the unbounded second pass', () => {
    // Mirrors case (1)'s trap exactly (same text, same order-inversion that
    // gives s153 zero true matches in the global pass) but with anchorStart
    // left at its original (now-wrong) estimate while the REAL audio has
    // drifted far away from it — reproducing the live bug: s153's
    // anchorStart (6) implies a rescue window of roughly [4.5, 10.5], but its
    // real "linen from flax" audio is actually spoken at 50s, ~40s past the
    // window's far edge. The windowed pass (Pass 1) must find nothing; the
    // new unbounded global pass (Pass 2) must still recover it, since the
    // words are genuinely present and unclaimed by any other segment.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's151', order: 0, text: 'wool comes from sheep', anchorStart: 0 }),
      makeSegment({ id: 's152', order: 1, text: 'garbled overflow xyzzy plugh mumble denim is durable', anchorStart: 3 }),
      makeSegment({ id: 's153', order: 2, text: 'linen from flax', anchorStart: 6 }),
      makeSegment({ id: 's154', order: 3, text: 'silk is smooth too', anchorStart: 9 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('wool comes from sheep', 0.0, 0.4),
      ...wordTokens('linen from flax', 50.0, 0.4),    // s153's real content, ~44s past its anchor
      ...wordTokens('denim is durable', 52.0, 0.4),   // s152's real trailing content, after linen
      ...wordTokens('silk is smooth too', 54.0, 0.4),
    ];

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const results = extractSegmentAlignments(segments, tokens);

    // Sanity: the trap is real — s153 gets zero true matches from the
    // unchanged global pass (same mechanism as case 1), regardless of the
    // absolute timestamps used (the global pass is text/order-based, not
    // time-based).
    expect(results[1]!.matchedWords).toBe(3); // s152 keeps its own trailing match

    // The windowed rescue (Pass 1) cannot reach t=50 from a window built
    // around anchorStart=6 — it must come up empty, forcing Pass 2.
    // Pass 2 (global, unbounded) recovers the full, exact 3/3.
    expect(results[2]!.matched).toBe(true);
    expect(results[2]!.matchedWords).toBe(3);
    expect(results[2]!.totalWords).toBe(3);
    expect(results[2]!.confidence).toBe(1);
    expect(results[2]!.t0).toBeCloseTo(50.0, 3);

    const recoverLogs = logSpy.mock.calls
      .map(args => String(args[0]))
      .filter(msg => msg.startsWith('[align-recover]') && msg.includes('seg=2'));
    expect(recoverLogs.length).toBe(1);
    expect(recoverLogs[0]).toContain('GLOBAL fallback');

    logSpy.mockRestore();
  });

  it('[align-recover] log fires only on a genuine 0-match-with-words-present recovery, never on a true 0-match', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Recovered case (mirrors test 5).
    const recoveredSegments: VideoSegment[] = [
      makeSegment({ id: 'p', order: 0, text: 'able baker torque plexus quiver zircon', anchorStart: 0 }),
      makeSegment({ id: 'c', order: 1, text: 'echo foxtrot golf', anchorStart: 6 }),
      makeSegment({ id: 'next', order: 2, text: 'hotel india', anchorStart: 12 }),
    ];
    const recoveredTokens: TranscriptToken[] = [
      ...wordTokens('able baker', 0.0, 0.4),
      ...wordTokens('echo foxtrot golf', 6.4, 0.4),
      ...wordTokens('torque plexus quiver zircon', 9.0, 0.4),
      ...wordTokens('hotel india', 12.0, 0.4),
    ];
    extractSegmentAlignments(recoveredSegments, recoveredTokens);
    const recoverLogs = logSpy.mock.calls.filter(args => String(args[0]).startsWith('[align-recover]'));
    expect(recoverLogs.length).toBe(1);
    expect(String(recoverLogs[0]![0])).toContain('seg=1 recovered 3/3');

    logSpy.mockClear();

    // True 0-match case (mirrors test 6) — no recovery, no log.
    const trueZeroSegments: VideoSegment[] = [
      makeSegment({ id: 'p', order: 0, text: 'able baker charlie delta', anchorStart: 0 }),
      makeSegment({ id: 'd', order: 1, text: 'nonexistent phantom words', anchorStart: 6 }),
      makeSegment({ id: 'next', order: 2, text: 'hotel india', anchorStart: 12 }),
    ];
    const trueZeroTokens: TranscriptToken[] = [
      ...wordTokens('able baker charlie delta', 0.0, 0.4),
      ...wordTokens('hotel india', 12.0, 0.4),
    ];
    extractSegmentAlignments(trueZeroSegments, trueZeroTokens);
    expect(logSpy.mock.calls.filter(args => String(args[0]).startsWith('[align-recover]')).length).toBe(0);

    logSpy.mockRestore();
  });
});

// ===========================================================================
// Rescue forward-ordering bound (false-positive rejection) — production
// incident fix, 2026-07-31.
//
// Root cause: Passes 2/3 above scan every unclaimed token with no relation to
// the segment's own position. A segment whose text never occurs in the audio
// (e.g. a heading) still passes the rescue's gate (matchedCount===0 &&
// anchorStart defined — true of every parsed segment, since
// applyAnchorBasedTiming forces the first segment's anchor to 0), and can
// claim a LATER segment's genuine words that were left unclaimed by the
// global pass (a substitution/gap, never a true match — globallyClaimed holds
// true matches only). That flips `matched` to true, defeats
// filterToCoveredSegments' skip-unmatched classification, and the far-away
// token indices flow into snapCoveredBoundaries as a real boundary —
// confirmed in production as a ~206s phantom first segment
// ((~412 + ~0.5)/2) that collapsed its real second segment to near-zero.
//
// The fix: a rescue claim's EARLIEST token must sit strictly before the first
// token any LATER segment truly matched in the (unchanged) global pass,
// skipping over intervening segments with no true match of their own. Order,
// not distance, is the signal — WS6 test 10 above legitimately recovers a
// word 44s from a 3s slot, so no distance/tolerance cap could exclude the
// false positive (arbitrarily far away) without also excluding that
// legitimate case.
// ===========================================================================
describe('rescue forward-ordering bound (false-positive rejection)', () => {
  it('REGRESSION: a no-audio heading (first segment) no longer steals a later true match\'s substitution material; it is skipped with "no audio match"', () => {
    // able-baker-charlie-delta-style trap, but shaped exactly like the
    // production incident: a first segment (heading) whose words never occur
    // near its own position, two genuinely-spoken segments right after it,
    // and the heading's own words sitting far downstream as UNCLAIMED tokens
    // (substitution material the global pass left over when it chose to keep
    // s1/s2's own, longer, in-order match instead — see the block comment
    // above for the LCS argument: matching the heading's 3 words instead
    // would cost s1+s2 their combined 4).
    const segments: VideoSegment[] = [
      makeSegment({ id: 'heading', order: 0, text: 'section two overview', anchorStart: 0 }),
      makeSegment({ id: 's1', order: 1, text: 'alpha bravo', anchorStart: 0.5 }),
      makeSegment({ id: 's2', order: 2, text: 'charlie delta', anchorStart: 4 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo', 0.5, 0.4),      // s1's real match
      ...wordTokens('charlie delta', 4.0, 0.4),    // s2's real match
      ...wordTokens('section two overview', 412.0, 0.4), // heading's own words,
      // genuinely present but only as leftover substitution material far
      // downstream — this is what the old code rescued from.
    ];

    const results = extractSegmentAlignments(segments, tokens);

    // Sanity: the heading really is blocked in the (unchanged) global pass —
    // s1/s2 keep their own matches (the longer, in-order chain the DP
    // prefers), leaving the heading's occurrence unclaimed but unmatched.
    expect(results[1]!.matchedWords).toBe(2);
    expect(results[2]!.matchedWords).toBe(2);

    // The fix: the heading's rescue claim (t=412) sits at/after s1's real
    // match (t=0.5, the forward bound) — rejected. No fallback timing kicks
    // in; the segment is genuinely zero-matched.
    expect(results[0]!.matched).toBe(false);
    expect(results[0]!.matchedWords).toBe(0);
    expect(results[0]!.confidence).toBe(0);

    // Rescue observability (Layer F): a REJECTED claim leaves no provenance —
    // the segment must not read as "recovered" anywhere downstream.
    expect(results[0]!.recoveredVia).toBeUndefined();
    expect(results[0]!.recoveredRegion).toBeUndefined();

    // filterToCoveredSegments must therefore skip it — this is the actual
    // user-visible behavior the fix restores (no giant phantom duration, a
    // real "no audio match" log entry instead).
    const { kept, skipped } = filterToCoveredSegments(segments, results);
    expect(kept.map(s => s.id)).toEqual(['s1', 's2']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ segmentIndex: 0, reason: 'no audio match' });
  });

  it('preserves legitimate anchor-drift recovery when the claim still precedes the next true match (mirrors WS6 test 10\'s shape)', () => {
    // Same "P blocks C" trap as WS6 test 1/10: an overflow segment (s1)
    // whose OWN real trailing content ("echo bravo hotel") is genuinely
    // spoken AFTER the trapped segment's (s2) real content ("kilo lima
    // mike"), forcing s2 to zero true matches in the global pass. s2's real
    // content is drifted far (45s) from its 6s anchor — well past Pass 1's
    // capped window — but it still sits BEFORE s3's real match (50s): a
    // legitimate rescue the forward-ordering bound must not touch.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'lions roam free', anchorStart: 0 }),
      makeSegment({ id: 's1', order: 1, text: 'mumbling jumble static noise echo bravo hotel', anchorStart: 3 }),
      makeSegment({ id: 's2', order: 2, text: 'kilo lima mike', anchorStart: 6 }),
      makeSegment({ id: 's3', order: 3, text: 'papa quebec romeo sierra', anchorStart: 9 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('lions roam free', 0.0, 0.4),
      ...wordTokens('kilo lima mike', 45.0, 0.4),          // s2's real content, drifted far from its anchor
      ...wordTokens('echo bravo hotel', 47.0, 0.4),        // s1's real trailing content, AFTER s2's — the trap
      ...wordTokens('papa quebec romeo sierra', 50.0, 0.4), // s3's real content, after s1's trailing
    ];

    const results = extractSegmentAlignments(segments, tokens);

    // Sanity: the trap is real — s1 keeps its own trailing 3-word match (the
    // longer, in-order chain the DP prefers over s2's isolated 3-word one, by
    // virtue of coming first in query order — same tie-break as WS6 test 1).
    // s2's own `results[2]` below already reflects the POST-rescue outcome
    // (extractSegmentAlignments returns only the final result), so its
    // pre-rescue zero can't be asserted directly here — it's confirmed
    // instead by the fact that recovery ran at all (recoveredVia fires only
    // when the unchanged global pass left matchedCount===0, per the
    // module doc comment) and by the `[align-recover]` log this test emits.
    expect(results[1]!.matchedWords).toBe(3);

    // The rescue still recovers s2 in full: its claim (45.0) precedes s3's
    // real match (50.0, the forward bound).
    expect(results[2]!.matched).toBe(true);
    expect(results[2]!.matchedWords).toBe(3);
    expect(results[2]!.totalWords).toBe(3);
    expect(results[2]!.t0).toBeCloseTo(45.0, 3);

    // Rescue observability (Layer F): an ACCEPTED claim carries provenance —
    // which pass recovered it, and its recovered time range.
    expect(results[2]!.recoveredVia).toBe('global');
    expect(results[2]!.recoveredRegion?.startSec).toBeCloseTo(45.0, 3);
    expect(results[2]!.recoveredRegion?.endSec).toBeCloseTo(46.2, 3);

    // updated 2026-08-02: run-based survival (Bug C fix) — discovered via the
    // full suite run under Bug C's ORIGINAL bands, NOT part of the
    // originally-identified 13 (this test's own sanity comment above only
    // ever cared about s1's matchedWords count, never its `matched` flag).
    // s1's text is 7 words long ("mumbling jumble static noise echo bravo
    // hotel"); its ONLY real content is the trailing 3-word phrase "echo
    // bravo hotel" (one clean contiguous run of 3 — the other 4 words are
    // deliberate trap filler that never occurs in the audio at all). Under
    // Bug C's original ratio-scaled bands a 7-word segment required
    // ceil(0.5*7)=4, and a run of 3 fell one short, so s1 itself used to be
    // classified unmatched and skipped.
    //
    // RECALIBRATED (threshold recalibration, second pass, 2026-08-02): the
    // flat bands require only RUN_SURVIVAL_MIN_RUN_SHORT (2) for any
    // 4-10-word segment — s1's run of 3 now clears it, so s1 SURVIVES too.
    // This test's actual point (s2's legitimate rescue survives the
    // forward-ordering bound) is unaffected — s1's own classification was
    // never what this test was about, and its recomputed value is folded in
    // here purely so the full-pipeline assertions below stay accurate.
    expect(results[1]!.matched).toBe(true);
    expect(results[1]!.longestRun).toBe(3);

    const { kept, skipped } = filterToCoveredSegments(segments, results);
    expect(skipped).toHaveLength(0);
    expect(kept.map(s => s.id)).toEqual(['s0', 's1', 's2', 's3']);
  });

  it('boundary: a claim whose earliest token startSec exactly equals the forward bound is rejected (>=, not >)', () => {
    // Same "P blocks C" trap (s1 blocks s2), but s2's rescued claim's
    // startSec is deliberately set EQUAL to s3's real match startSec. Only
    // each token's ARRAY POSITION governs the Hirschberg DP (not its raw
    // startSec value) — timestamps are read only afterward, for window/bonus/
    // bound checks — so this tie doesn't disturb the trap mechanic itself; it
    // exists purely to pin the ">=" (not ">") boundary semantics.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'lions roam free', anchorStart: 0 }),
      makeSegment({ id: 's1', order: 1, text: 'mumbling jumble static noise echo bravo hotel', anchorStart: 3 }),
      makeSegment({ id: 's2', order: 2, text: 'kilo lima mike', anchorStart: 6 }),
      makeSegment({ id: 's3', order: 3, text: 'papa quebec romeo sierra', anchorStart: 9 }),
    ];
    const tokens: TranscriptToken[] = [
      { text: 'lions', startSec: 0.0, endSec: 0.4 },
      { text: 'roam', startSec: 0.4, endSec: 0.8 },
      { text: 'free', startSec: 0.8, endSec: 1.2 },
      // s2's candidate claim — array position preserves the trap (before
      // s1's trailing below), startSec deliberately tied to s3's match time.
      { text: 'kilo', startSec: 50.0, endSec: 50.4 },
      { text: 'lima', startSec: 50.4, endSec: 50.8 },
      { text: 'mike', startSec: 50.8, endSec: 51.2 },
      // s1's real trailing content — array position AFTER s2's candidate
      // (preserves the "s1 blocks s2" ordering the DP needs).
      { text: 'echo', startSec: 51.4, endSec: 51.8 },
      { text: 'bravo', startSec: 51.8, endSec: 52.2 },
      { text: 'hotel', startSec: 52.2, endSec: 52.6 },
      // s3's real match — its startSec (50.0) is the forward bound, tied
      // exactly to s2's candidate claim's earliest token above.
      { text: 'papa', startSec: 50.0, endSec: 50.4 },
      { text: 'quebec', startSec: 50.4, endSec: 50.8 },
      { text: 'romeo', startSec: 50.8, endSec: 51.2 },
      { text: 'sierra', startSec: 51.2, endSec: 51.6 },
    ];

    const results = extractSegmentAlignments(segments, tokens);

    // Sanity: the trap still holds (array order, not startSec, drives it).
    expect(results[1]!.matchedWords).toBe(3);
    expect(results[3]!.matchedWords).toBe(4);

    // s2's claim's earliest token (50.0) === the bound (50.0) — rejected.
    expect(results[2]!.matched).toBe(false);
    expect(results[2]!.matchedWords).toBe(0);
    expect(results[2]!.recoveredVia).toBeUndefined();
    expect(results[2]!.recoveredRegion).toBeUndefined();
  });

  it('last-segment case: no successor means no bound, so a legitimate final-segment recovery is unaffected', () => {
    // Mirrors WS6 test 9 exactly (same P-blocks-last trap): the last segment
    // has no successor, so computeForwardBoundStartSec returns undefined and
    // exceedsForwardBound is always false for it — confirming the new bound
    // introduces no regression for the last-segment path.
    const segments: VideoSegment[] = [
      makeSegment({ id: 'p', order: 0, text: 'alpha bravo torque plexus', anchorStart: 0 }),
      makeSegment({ id: 'last', order: 1, text: 'omega', anchorStart: 5 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo', 0.0, 0.4),
      ...wordTokens('omega', 7.9, 0.5),
      ...wordTokens('torque plexus', 10.0, 0.4),
    ];

    const results = extractSegmentAlignments(segments, tokens);
    expect(results[1]!.matched).toBe(true);
    expect(results[1]!.matchedWords).toBe(1);
    expect(results[1]!.t0).toBeCloseTo(7.9, 3);

    // Rescue observability (Layer F): recovered via Pass 1 (windowed) —
    // the last segment's window naturally extends to audio end, so this
    // never needs the unbounded Pass 2/3 scans.
    expect(results[1]!.recoveredVia).toBe('windowed');
    expect(results[1]!.recoveredRegion?.startSec).toBeCloseTo(7.9, 3);

    const { kept, skipped } = filterToCoveredSegments(segments, results);
    expect(skipped).toHaveLength(0);
    expect(kept.map(s => s.id)).toEqual(['p', 'last']);
  });

  it('zero-match successor chain: the bound skips over intervening zero-match segments and comes from the next segment with a true match', () => {
    // h is trapped (0 global matches — its own words are genuinely present
    // but only as substitution leftovers, per the LCS argument in the
    // REGRESSION test above). z1 and z2 immediately follow h and never occur
    // in the transcript AT ALL (test-6-style true absence) — they must not
    // supply a (nonexistent) bound of their own, and must not be mistaken
    // for "no bound exists". The bound must come from r, the next segment
    // that actually has a true global match.
    const segments: VideoSegment[] = [
      makeSegment({ id: 'h', order: 0, text: 'section two', anchorStart: 0 }),
      makeSegment({ id: 'z1', order: 1, text: 'nonexistent phantom words', anchorStart: 3 }),
      makeSegment({ id: 'z2', order: 2, text: 'imaginary vanished missing', anchorStart: 6 }),
      makeSegment({ id: 'r', order: 3, text: 'papa quebec romeo sierra', anchorStart: 9 }),
    ];

    const buildTokens = (headingStrayStart: number): TranscriptToken[] => [
      { text: 'papa', startSec: 100.0, endSec: 100.4 },
      { text: 'quebec', startSec: 100.4, endSec: 100.8 },
      { text: 'romeo', startSec: 100.8, endSec: 101.2 },
      { text: 'sierra', startSec: 101.2, endSec: 101.6 },
      // h's own words, genuinely present but only as substitution leftovers
      // (array position after r's — the DP prefers r's longer 4-word chain,
      // per the same LCS argument as the REGRESSION test — see that test's
      // comment). startSec is set independently of array position to probe
      // both sides of the bound.
      { text: 'section', startSec: headingStrayStart, endSec: headingStrayStart + 0.4 },
      { text: 'two', startSec: headingStrayStart + 0.4, endSec: headingStrayStart + 0.8 },
    ];

    // Sanity shared by both cases: z1/z2 never occur anywhere, so they
    // contribute nothing to the bound scan and must classify as genuinely
    // zero-matched (not "no bound", which would be a different bug).
    const assertZ1Z2GenuinelyUnmatched = (results: ReturnType<typeof extractSegmentAlignments>) => {
      expect(results[1]!.matched).toBe(false);
      expect(results[1]!.matchedWords).toBe(0);
      expect(results[2]!.matched).toBe(false);
      expect(results[2]!.matchedWords).toBe(0);
      expect(results[3]!.matchedWords).toBe(4); // r keeps its full match
    };

    // Case 1 — h's claim (50.0) precedes r's real match (100.0, the bound
    // correctly skipping over z1/z2): recovered.
    const acceptResults = extractSegmentAlignments(segments, buildTokens(50.0));
    assertZ1Z2GenuinelyUnmatched(acceptResults);
    expect(acceptResults[0]!.matched).toBe(true);
    expect(acceptResults[0]!.matchedWords).toBe(2);
    expect(acceptResults[0]!.t0).toBeCloseTo(50.0, 3);
    // Rescue observability (Layer F): accepted -> provenance present.
    expect(acceptResults[0]!.recoveredVia).toBe('global');
    expect(acceptResults[0]!.recoveredRegion?.startSec).toBeCloseTo(50.0, 3);

    // Case 2 — h's claim (120.0) sits after r's real match (100.0): rejected.
    const rejectResults = extractSegmentAlignments(segments, buildTokens(120.0));
    assertZ1Z2GenuinelyUnmatched(rejectResults);
    expect(rejectResults[0]!.matched).toBe(false);
    expect(rejectResults[0]!.matchedWords).toBe(0);
    // Rescue observability (Layer F): rejected -> no provenance.
    expect(rejectResults[0]!.recoveredVia).toBeUndefined();
    expect(rejectResults[0]!.recoveredRegion).toBeUndefined();
  });

  it('all existing WS6 rescue tests are unaffected by the forward-ordering bound (no distance-based rejection)', () => {
    // Direct regression guard, not a duplicate of the WS6 describe block
    // above (which already runs unchanged and passing) — this re-asserts the
    // single fixture with the widest legitimate drift (WS6 test 10, 44s from
    // a 3s slot) specifically BECAUSE it is the case any distance-based fix
    // would have broken, to make the "order, not distance" design decision
    // independently verifiable from this describe block alone.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's151', order: 0, text: 'wool comes from sheep', anchorStart: 0 }),
      makeSegment({ id: 's152', order: 1, text: 'garbled overflow xyzzy plugh mumble denim is durable', anchorStart: 3 }),
      makeSegment({ id: 's153', order: 2, text: 'linen from flax', anchorStart: 6 }),
      makeSegment({ id: 's154', order: 3, text: 'silk is smooth too', anchorStart: 9 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('wool comes from sheep', 0.0, 0.4),
      ...wordTokens('linen from flax', 50.0, 0.4),
      ...wordTokens('denim is durable', 52.0, 0.4),
      ...wordTokens('silk is smooth too', 54.0, 0.4),
    ];

    const results = extractSegmentAlignments(segments, tokens);
    expect(results[2]!.matched).toBe(true);
    expect(results[2]!.matchedWords).toBe(3);
    expect(results[2]!.t0).toBeCloseTo(50.0, 3);
  });
});

// Builds the three structures `findConcatenatingMatches` needs directly, one
// token per word (no multi-word tokens) — enough to unit-test D1/D2 without
// going through the whole rescue pipeline (whose Pass 2 exact-single-token
// scan would swallow any word simple enough to also satisfy a span-1 concat
// match before Pass 3 ever runs).
function buildConcatFixture(entries: Array<{ text: string; start: number; end: number }>) {
  const tokens: TranscriptToken[] = entries.map(e => ({ text: e.text, startSec: e.start, endSec: e.end }));
  const tokenWords = entries.map((e, i) => ({ word: e.text.toLowerCase(), tokenIdx: i, startSec: e.start }));
  const unclaimed = tokenWords.map((tw, idx) => ({ word: tw.word, globalIdx: idx }));
  return { tokens, tokenWords, unclaimed };
}

describe('Pass 3 — sliding-window concatenation match (sub-word merge)', () => {
  const options = { maxConcatTokens: MAX_CONCAT_TOKENS, maxConcatGapSec: MAX_CONCAT_GAP_SEC };

  it('1) direct repro (integration): "linen"/"flax" recovered via concat, "from" stays genuinely missing', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const segments: VideoSegment[] = [
      makeSegment({ id: 'p', order: 0, text: 'able baker', anchorStart: 0 }),
      makeSegment({ id: 'c', order: 1, text: 'linen from flax', anchorStart: 6 }),
      makeSegment({ id: 'next', order: 2, text: 'hotel india', anchorStart: 12 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('able baker', 0.0, 0.4),
      ...wordTokens('lin en', 6.0, 0.2),   // "linen" split, touching (0.2s each, 0 gap)
      ...wordTokens('fl ax', 6.6, 0.2),    // "flax" split, touching — "from" never appears anywhere
      ...wordTokens('hotel india', 12.0, 0.4),
    ];

    const results = extractSegmentAlignments(segments, tokens);

    expect(results[1]!.matched).toBe(true);
    expect(results[1]!.matchedWords).toBe(2);
    expect(results[1]!.totalWords).toBe(3);
    expect(results[1]!.confidence).toBeCloseTo(2 / 3, 5);
    expect(results[1]!.t0).toBeCloseTo(6.0, 3);

    const recoverLogs = logSpy.mock.calls
      .map(args => String(args[0]))
      .filter(msg => msg.startsWith('[align-recover]') && msg.includes('seg=1'));
    expect(recoverLogs.length).toBe(1);
    expect(recoverLogs[0]).toContain('CONCAT');

    logSpy.mockRestore();
  });

  it('2) single-token word still matches (spanSize=1 preserved)', () => {
    const { tokens, tokenWords, unclaimed } = buildConcatFixture([
      { text: 'hello', start: 0, end: 0.4 },
    ]);
    const matches = findConcatenatingMatches(['hello'], unclaimed, tokenWords, tokens, options);
    expect(matches.length).toBe(1);
    expect(matches[0]).toEqual({ queryIdx: 0, tokenStartIdx: 0, tokenEndIdx: 0 });
  });

  it('3) touching tolerance enforced: a 10s gap between fragments blocks concatenation', () => {
    const { tokens, tokenWords, unclaimed } = buildConcatFixture([
      { text: 'lin', start: 10, end: 10.3 },
      { text: 'en', start: 20, end: 20.3 },
    ]);
    const matches = findConcatenatingMatches(['linen'], unclaimed, tokenWords, tokens, options);
    expect(matches.length).toBe(0);
  });

  it('4) max concat tokens enforced: a 5-fragment word exceeds MAX_CONCAT_TOKENS=3 and is not recovered', () => {
    const { tokens, tokenWords, unclaimed } = buildConcatFixture([
      { text: 'ab', start: 0.0, end: 0.2 },
      { text: 'cd', start: 0.2, end: 0.4 },
      { text: 'ef', start: 0.4, end: 0.6 },
      { text: 'gh', start: 0.6, end: 0.8 },
      { text: 'ij', start: 0.8, end: 1.0 },
    ]);
    const matches = findConcatenatingMatches(['abcdefghij'], unclaimed, tokenWords, tokens, options);
    expect(matches.length).toBe(0);
  });

  it('5) claimed tokens excluded: "lin" already claimed leaves "linen" unrecoverable', () => {
    const { tokens, tokenWords, unclaimed } = buildConcatFixture([
      { text: 'lin', start: 0.0, end: 0.2 },
      { text: 'en', start: 0.2, end: 0.4 },
    ]);
    // Simulate exclusion the same way the caller does: filter the claimed
    // token (globalIdx 0) out of `unclaimed` before calling.
    const unclaimedMinusLin = unclaimed.filter(u => u.globalIdx !== 0);
    const matches = findConcatenatingMatches(['linen'], unclaimedMinusLin, tokenWords, tokens, options);
    expect(matches.length).toBe(0);
  });

  it('6) sub-word fragments do not merge across query words: "linen" then "en" each resolve to their own tokens', () => {
    const { tokens, tokenWords, unclaimed } = buildConcatFixture([
      { text: 'lin', start: 0.0, end: 0.2 },
      { text: 'en', start: 0.2, end: 0.4 },
      { text: 'en', start: 0.4, end: 0.6 },
    ]);
    const matches = findConcatenatingMatches(['linen', 'en'], unclaimed, tokenWords, tokens, options);
    expect(matches.length).toBe(2);
    expect(matches[0]).toEqual({ queryIdx: 0, tokenStartIdx: 0, tokenEndIdx: 1 });
    expect(matches[1]).toEqual({ queryIdx: 1, tokenStartIdx: 2, tokenEndIdx: 2 });
  });

  it('7) no regression: an ordinary fully-token-matched project is unaffected (existing Pass 1/2 behavior unchanged)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 'a', order: 0, text: 'the quick brown fox', anchorStart: 0 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('the quick brown fox', 0.0, 0.4),
    ];
    const results = extractSegmentAlignments(segments, tokens);
    expect(results[0]!.matched).toBe(true);
    expect(results[0]!.matchedWords).toBe(4);
    expect(results[0]!.confidence).toBe(1);
  });
});

// ===========================================================================
// Bug C — contiguous-run survival requirement (2026-08-02)
//
// A segment survives sync (matched=true) only when its matched words form at
// least one qualifying contiguous RUN — consecutive query positions whose
// transcript-side token indices are themselves consecutive, tolerating up to
// RUN_SURVIVAL_MAX_HOLE (2) consecutive unmatched query words bridged by
// transcript contiguity. This supersedes Bug 2's "any real match keeps it"
// doctrine (see the re-partitioned Bug 2/WS5/diff-aligner tests above, each
// carrying an "updated 2026-08-02" comment). See syncConstants.ts's
// RUN_SURVIVAL_* header and whisperService.ts's `hasQualifyingRun`/
// `computeLongestRunWithHoles` for the full derivation.
// ===========================================================================
describe('Bug C — contiguous-run survival requirement', () => {
  // FLAGSHIP — the confirmed production heading shape: a 9-word segment
  // whose own content was never spoken at all, but TWO of its individual
  // (common) words coincidentally occur elsewhere in the transcript as
  // isolated, non-adjacent single-word coincidences with genuine content for
  // neighboring segments on either side. Pre-fix (matched = matchedCount >
  // 0), this segment SURVIVED on two scattered coincidences alone — exactly
  // the false-positive shape that motivated this fix. Verified to fail
  // pre-fix (see this session's report for the captured pre-fix output).
  it('FLAGSHIP: a 9-word segment with two scattered, non-adjacent coincidental word matches is skipped, not kept on two coincidences alone', () => {
    const segments: VideoSegment[] = [
      makeSegment({
        id: 'heading', order: 0,
        text: 'orbital command station requires immediate tactical tank evacuation now',
        anchorStart: 0,
      }),
      makeSegment({ id: 's1', order: 1, text: 'the crew boarded the vessel and secured every hatch', anchorStart: 1.0 }),
      makeSegment({ id: 's2', order: 2, text: 'meet me at the harbor before the tide turns', anchorStart: 4.0 }),
      makeSegment({ id: 's3', order: 3, text: 'the engineers reported the results without delay', anchorStart: 7.0 }),
    ];
    const tokens: TranscriptToken[] = [
      // Two words the heading happens to share with ordinary vocabulary,
      // spoken here as a standalone aside BEFORE any real segment's content
      // — genuinely present in the audio, unclaimed by anyone else's own
      // text, but never as a phrase the heading itself actually explains.
      ...wordTokens('station now', 0.0, 0.3),
      ...wordTokens('the crew boarded the vessel and secured every hatch', 1.0, 0.3),
      ...wordTokens('meet me at the harbor before the tide turns', 4.0, 0.3),
      ...wordTokens('the engineers reported the results without delay', 7.0, 0.3),
    ];

    const results = extractSegmentAlignments(segments, tokens);

    // Sanity: the two coincidences are real, and the neighbors are fully,
    // genuinely covered — this is not a cross-script mismatch, just a
    // heading whose own content was never spoken.
    expect(results[0]!.matchedWords).toBe(2);
    expect(results[1]!.confidence).toBe(1);
    expect(results[2]!.confidence).toBe(1);
    expect(results[3]!.confidence).toBe(1);

    // The fix: two matches 6 query-positions apart ("station" at position 2,
    // "now" at position 8) cannot bridge — far more than RUN_SURVIVAL_MAX_HOLE
    // (2) unmatched words separate them — so each is its own isolated run of 1.
    expect(results[0]!.longestRun).toBeLessThanOrEqual(1);
    expect(results[0]!.matched).toBe(false);
    // matchedWords/confidence are the REAL, preserved counts — never zeroed
    // just because the segment failed the run requirement (audit Q8).
    expect(results[0]!.matchedWords).toBe(2);
    expect(results[0]!.confidence).toBeCloseTo(2 / 9, 5);
    expect(results[0]!.totalWords).toBe(9);

    const { kept, skipped } = filterToCoveredSegments(segments, results);
    expect(kept.map(s => s.id)).toEqual(['s1', 's2', 's3']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      segmentIndex: 0,
      reason: 'no audio match',
      matchedWords: 2,
      totalWords: 9,
      longestRun: 1,
    });
  });

  // linen-from-flax preservation — the EXACT WS6 Pass 3 fixture ("Pass 3 —
  // sliding-window concatenation match" describe block above, test 1) must
  // now PASS under the holes rule: "linen" (concat-recovered, spanning
  // tokens [2,3]) and "flax" (concat-recovered, spanning tokens [4,5]) bridge
  // the single "from" hole at query position 1, because the concatenated
  // spans are NUMERICALLY TOUCHING (linen's end=3, flax's start=4) — a
  // 1-hole run spanning all 3 query positions, comfortably clearing the
  // required run of 2 for a 3-word segment.
  it('linen-from-flax preservation: the WS6 Pass 3 flagship now survives via the 1-hole rule, longestRun 3', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 'p', order: 0, text: 'able baker', anchorStart: 0 }),
      makeSegment({ id: 'c', order: 1, text: 'linen from flax', anchorStart: 6 }),
      makeSegment({ id: 'next', order: 2, text: 'hotel india', anchorStart: 12 }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('able baker', 0.0, 0.4),
      ...wordTokens('lin en', 6.0, 0.2),   // "linen" split, touching (0.2s each, 0 gap)
      ...wordTokens('fl ax', 6.6, 0.2),    // "flax" split, touching — "from" never appears anywhere
      ...wordTokens('hotel india', 12.0, 0.4),
    ];

    const results = extractSegmentAlignments(segments, tokens);

    expect(results[1]!.matched).toBe(true);
    expect(results[1]!.matchedWords).toBe(2);
    expect(results[1]!.totalWords).toBe(3);
    expect(results[1]!.confidence).toBeCloseTo(2 / 3, 5);
    expect(results[1]!.longestRun).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // computeLongestRunWithHoles — direct unit tests, hand-written occ arrays.
  // ---------------------------------------------------------------------------
  describe('computeLongestRunWithHoles', () => {
    const M = (start: number, end = start): OccEntry => ({ start, end });

    it('a clean run with no holes', () => {
      const occ: OccEntry[] = [M(0), M(1), M(2)];
      expect(computeLongestRunWithHoles(occ, 2)).toBe(3);
    });

    it('a single-hole run bridged by transcript contiguity (pure deletion — the "quick (brown) fox" shape)', () => {
      // position1 is a hole (the deleted word); position2's subject index
      // (1) immediately follows position0's (0), since nothing occupies the
      // deleted word's slot in the transcript.
      const occ: OccEntry[] = [M(0), null, M(1)];
      expect(computeLongestRunWithHoles(occ, 2)).toBe(3);
    });

    it('a two-hole run at exactly the cap still bridges', () => {
      const occ: OccEntry[] = [M(0), null, null, M(1)];
      expect(computeLongestRunWithHoles(occ, 2)).toBe(4);
    });

    it('a three-hole gap exceeds the cap and breaks the run', () => {
      const occ: OccEntry[] = [M(0), null, null, null, M(1)];
      expect(computeLongestRunWithHoles(occ, 2)).toBe(1);
    });

    it('a leading hole does not count — a run cannot start on a hole', () => {
      const occ: OccEntry[] = [null, M(0), M(1)];
      expect(computeLongestRunWithHoles(occ, 2)).toBe(2);
    });

    it('a trailing hole does not count — a run cannot end on a hole', () => {
      const occ: OccEntry[] = [M(0), M(1), null];
      expect(computeLongestRunWithHoles(occ, 2)).toBe(2);
    });

    it('a hole bridged by query adjacency but broken by a transcript insertion', () => {
      // position1 is a hole, but position2's subject index (2) does NOT
      // immediately follow position0's (0) — a real (if wrong) word occupies
      // subject slot 1, a substitution rather than a pure deletion, so the
      // "hole" is not transcript-contiguous and the chain breaks.
      const occ: OccEntry[] = [M(0), null, M(2)];
      expect(computeLongestRunWithHoles(occ, 2)).toBe(1);
    });

    it('two separate qualifying runs — picks the longer one, in either position', () => {
      const occ: OccEntry[] = [M(0), M(1), null, null, null, M(5), M(6), M(7)];
      expect(computeLongestRunWithHoles(occ, 2)).toBe(3);
    });

    it('concat-span inputs (start < end) with touching neighbors bridge across a hole', () => {
      // Mirrors the linen-from-flax shape directly: a 2-token concatenated
      // span, a hole, then another 2-token concatenated span whose start
      // numerically touches the first span's end.
      const occ: OccEntry[] = [{ start: 2, end: 3 }, null, { start: 4, end: 5 }];
      expect(computeLongestRunWithHoles(occ, 2)).toBe(3);
    });

    it('returns 0 for an all-null occupancy (true zero-match)', () => {
      const occ: OccEntry[] = [null, null, null];
      expect(computeLongestRunWithHoles(occ, 2)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // requiredRunLength / hasQualifyingRun — band boundaries.
  //
  // RECALIBRATED (threshold recalibration, second pass, 2026-08-02): the
  // ratio-scaled bands this section originally pinned (RUN_SURVIVAL_RATIO_SHORT/
  // LONG, RUN_SURVIVAL_LONG_BAND_MIN_WORDS) are gone — see syncConstants.ts's
  // RUN_SURVIVAL_* header for the production evidence. Three FLAT bands
  // replace them: 1-3 words -> 1, 4-10 words -> RUN_SURVIVAL_MIN_RUN_SHORT
  // (2), 11+ words -> RUN_SURVIVAL_MIN_RUN_LONG (4). The old
  // `hasQualifyingRun` totalWords===1 special case is gone too — it's now
  // just the general 1-3-word band's answer of 1.
  // ---------------------------------------------------------------------------
  describe('requiredRunLength / hasQualifyingRun band boundaries', () => {
    it('the 1-3-word band requires only 1 — folds the old totalWords===1 special case into the general formula', () => {
      expect(requiredRunLength(1)).toBe(1);
      expect(requiredRunLength(2)).toBe(1);
      expect(requiredRunLength(3)).toBe(1);
      expect(hasQualifyingRun(1, 1, [{ start: 0, end: 0 }])).toBe(true);
      expect(hasQualifyingRun(1, 0, [null])).toBe(false);
    });

    it('band transition: totalWords 3 (tiny band, required 1) vs totalWords 4 (short band, required 2)', () => {
      expect(requiredRunLength(3)).toBe(1);
      expect(requiredRunLength(4)).toBe(RUN_SURVIVAL_MIN_RUN_SHORT);
      expect(RUN_SURVIVAL_MIN_RUN_SHORT).toBe(2);
    });

    it('band transition: totalWords 10 (short band) and 11 (long band) are FLAT — no ratio scaling', () => {
      expect(requiredRunLength(10)).toBe(RUN_SURVIVAL_MIN_RUN_SHORT); // 2, not the old ceil(0.5*10)=5
      expect(requiredRunLength(11)).toBe(RUN_SURVIVAL_MIN_RUN_LONG);  // 4, not the old ceil(0.4*11)=5
      // The long band's requirement no longer grows with segment length at
      // all — a 21-word segment (the production project's worst fragmented
      // case: 21 words, 17 matched, longest run 7) requires the SAME 4 a
      // bare 11-word segment does, where the old ratio-scaled band would
      // have demanded ceil(0.4*21)=9.
      expect(requiredRunLength(21)).toBe(RUN_SURVIVAL_MIN_RUN_LONG);
    });

    it('holes counting toward run length at the recalibrated boundary (10-word segment, required 2)', () => {
      // Two contiguous anchors (positions 0,1, no hole) — span length 2,
      // meeting the recalibrated required 2 for a 10-word segment exactly.
      // Confidence is deliberately low (2/10 = 0.2, under
      // RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE) so this isolates the RUN gate
      // alone, not the density fallback.
      const occ: OccEntry[] = [
        { start: 0, end: 0 }, { start: 1, end: 1 }, null, null, null,
        null, null, null, null, null,
      ];
      expect(computeLongestRunWithHoles(occ, RUN_SURVIVAL_MAX_HOLE)).toBe(2);
      expect(hasQualifyingRun(10, 2, occ)).toBe(true);

      // A single isolated anchor — span length 1, one short of the required
      // 2. Confidence (1/10 = 0.1) is also under the density floor, so this
      // fails BOTH mechanisms, not just the run check.
      const shortOcc: OccEntry[] = [
        { start: 0, end: 0 }, null, null, null, null,
        null, null, null, null, null,
      ];
      expect(computeLongestRunWithHoles(shortOcc, RUN_SURVIVAL_MAX_HOLE)).toBe(1);
      expect(hasQualifyingRun(10, 1, shortOcc)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Density fallback (threshold recalibration, second pass, 2026-08-02) —
  // hasQualifyingRun/isLocallyClustered direct unit tests.
  // ---------------------------------------------------------------------------
  describe('density fallback — hasQualifyingRun', () => {
    it('a fragmented-but-mostly-matched segment survives via density when the run check alone fails', () => {
      // Mirrors the production project's worst fragmented case (21 words, 17
      // matched, longest run 7, in the long band): a 13-word segment, 9
      // matched in three clusters of 3, each separated by a 2-word gap.
      // Within each cluster the transcript indices are consecutive (a real
      // run of 3), but ACROSS clusters they jump by 10 — non-contiguous, so
      // the chain breaks there regardless of holeCount being within the cap.
      // Longest run is therefore only 3, one short of RUN_SURVIVAL_MIN_RUN_LONG
      // (4) for this 13-word (long-band) segment — but the matched transcript
      // indices (0,1,2, 10,11,12, 20,21,22) are tightly grouped relative to
      // RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP, and confidence (9/13 ≈ 0.69) is
      // well above the 0.5 density floor.
      const occ: OccEntry[] = [
        { start: 0, end: 0 }, { start: 1, end: 1 }, { start: 2, end: 2 }, null,
        null,
        { start: 10, end: 10 }, { start: 11, end: 11 }, { start: 12, end: 12 }, null,
        null,
        { start: 20, end: 20 }, { start: 21, end: 21 }, { start: 22, end: 22 },
      ];
      const totalWords = occ.length; // 13
      const matchedCount = 9;
      expect(computeLongestRunWithHoles(occ, RUN_SURVIVAL_MAX_HOLE)).toBe(3);
      expect(requiredRunLength(totalWords)).toBe(RUN_SURVIVAL_MIN_RUN_LONG); // 4 — run of 3 falls short
      // Matched subject indices: 0,1,2,10,11,12,20,21,22 — gaps (sorted):
      // 1,1,8,1,1,8,1,1 -> sorted gaps [1,1,1,1,1,1,8,8], median = mean of
      // the 4th/5th (1-indexed) = mean(1,1) = 1, comfortably at/under
      // RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP (4).
      expect(isLocallyClustered([0, 1, 2, 10, 11, 12, 20, 21, 22])).toBe(true);
      expect(hasQualifyingRun(totalWords, matchedCount, occ)).toBe(true);
    });

    it('a scattered, low-confidence segment (the heading shape) still fails even with the density fallback active', () => {
      // A 9-word segment (mirrors the FLAGSHIP heading fixture above) with
      // only 2 of 9 words matched, at opposite ends — confidence 2/9 ≈ 0.222,
      // under RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE (0.5). The confidence gate
      // alone rejects this before clustering is ever evaluated — matching
      // the real production heading (0 of 9 matched, confidence 0), which
      // fails the same gate even more trivially.
      const occ: OccEntry[] = new Array(9).fill(null);
      occ[1] = { start: 2, end: 2 };
      occ[7] = { start: 20, end: 20 };
      expect(computeLongestRunWithHoles(occ, RUN_SURVIVAL_MAX_HOLE)).toBe(1);
      expect(hasQualifyingRun(9, 2, occ)).toBe(false);
    });

    it('a scattered segment that clears the confidence floor but NOT the clustering floor still fails — clustering does real work, not just duplicating the confidence check', () => {
      // 10-word segment, 6 matched (confidence 0.6, ABOVE the 0.5 density
      // floor) at query positions 0-5, each mapped to a transcript index 20
      // apart (0,20,40,60,80,100) — every consecutive pair breaks contiguity
      // (a jump of 20, never +1), so longestRun is 1 regardless of query
      // adjacency, and the matched indices are far too spread out to cluster.
      const occ: OccEntry[] = [
        { start: 0, end: 0 }, { start: 20, end: 20 }, { start: 40, end: 40 },
        { start: 60, end: 60 }, { start: 80, end: 80 }, { start: 100, end: 100 },
        null, null, null, null,
      ];
      expect(computeLongestRunWithHoles(occ, RUN_SURVIVAL_MAX_HOLE)).toBe(1);
      expect(isLocallyClustered([0, 20, 40, 60, 80, 100])).toBe(false);
      expect(hasQualifyingRun(10, 6, occ)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isLocallyClustered — direct unit tests.
  // ---------------------------------------------------------------------------
  describe('isLocallyClustered', () => {
    it('a tight cluster (all gaps small) is clustered', () => {
      expect(isLocallyClustered([10, 11, 13, 14])).toBe(true); // gaps: 1,2,1 -> median 1
    });

    it('a scattered set (all gaps large) is not clustered', () => {
      expect(isLocallyClustered([0, 50, 100, 150])).toBe(false); // gaps: 50,50,50 -> median 50
    });

    it('exactly at the median-gap boundary (RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP) is clustered — inclusive', () => {
      expect(RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP).toBe(4);
      expect(isLocallyClustered([0, 4, 8])).toBe(true); // gaps: 4,4 -> median 4, <=4 passes
    });

    it('one unit past the median-gap boundary is not clustered', () => {
      expect(isLocallyClustered([0, 5, 10])).toBe(false); // gaps: 5,5 -> median 5, >4 fails
    });

    it('a single index is trivially clustered — nothing to scatter', () => {
      expect(isLocallyClustered([42])).toBe(true);
    });

    it('an empty index list is not clustered — no positive evidence to cluster on', () => {
      expect(isLocallyClustered([])).toBe(false);
    });

    it('an even number of gaps takes the mean of the two middle gaps (not the lower of the two)', () => {
      // 5 indices -> 4 gaps (even count). [0,6,7,8,14]: gaps 6,1,1,6 -> sorted
      // [1,1,6,6] -> mean of the middle two (1,6) = 3.5, <= 4 passes. Taking
      // the LOWER-median convention instead would read 1 here (also <=4) —
      // this case alone can't distinguish the two conventions.
      expect(isLocallyClustered([0, 6, 7, 8, 14])).toBe(true);
      // [0,7,8,9,16]: gaps 7,1,1,7 -> sorted [1,1,7,7] -> mean(1,7) = 4,
      // exactly at the boundary — passes. A lower-median convention would
      // read 1 here too (still passing), so this still doesn't distinguish
      // the two conventions on its own.
      expect(isLocallyClustered([0, 7, 8, 9, 16])).toBe(true);
      // [0,8,9,10,18]: gaps 8,1,1,8 -> sorted [1,1,8,8] -> mean(1,8) = 4.5,
      // > 4 — fails under the MEAN convention this function uses. A
      // lower-median convention would read 1 here (passing) — this is the
      // case that actually pins the choice: it fails only because the mean,
      // not the lower value, is what `isLocallyClustered` computes.
      expect(isLocallyClustered([0, 8, 9, 10, 18])).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // buildOccArrayFromGlobalMatches — direct unit test.
  // ---------------------------------------------------------------------------
  describe('buildOccArrayFromGlobalMatches', () => {
    it('slices matchedSubjectOf into a segment-local occupancy array', () => {
      // Query positions 0-1 belong to a preceding segment (subject matches
      // 10, -1); this segment's own range is [2,5).
      const matchedSubjectOf = Int32Array.from([10, -1, 20, -1, 21]);
      const occ = buildOccArrayFromGlobalMatches(matchedSubjectOf, 2, 3);
      expect(occ).toEqual([{ start: 20, end: 20 }, null, { start: 21, end: 21 }]);
    });
  });

  // ---------------------------------------------------------------------------
  // Rescue-gate widening (audit Q2b) — the rescue now ALSO fires when the
  // global pass gave a segment some real matches that fail to form a
  // qualifying run (not just a literal zero-match), but the rescue's own
  // result is adopted only if IT forms a qualifying run.
  // ---------------------------------------------------------------------------
  describe('rescue-gate widening under Bug C', () => {
    it('accepts: global pass gives a scattered single match (no run); rescue finds the real contiguous phrase in the anchor window and adopts it', () => {
      // Same "P blocks C" trap as WS6 test 1: P's own real trailing content
      // ("denim is durable") is spoken AFTER the disputed "linen from flax",
      // monotonically blocking the global pass from giving any of "linen
      // from flax" to c. Unlike WS6 test 1, c's OWN text also contains
      // "wozzle" — a word that occurs nowhere else, so the global pass
      // freely (and separately) matches it — giving c matchedCount=1 from
      // the global pass alone (not the literal 0 the original rescue gate
      // required), triggering the WIDENED gate.
      const segments: VideoSegment[] = [
        makeSegment({ id: 's0', order: 0, text: 'wool comes from sheep', anchorStart: 0 }),
        makeSegment({ id: 'p', order: 1, text: 'garbled overflow xyzzy plugh mumble denim is durable', anchorStart: 3 }),
        makeSegment({ id: 'c', order: 2, text: 'linen wozzle from flax', anchorStart: 6 }),
        makeSegment({ id: 's3', order: 3, text: 'silk is smooth too', anchorStart: 9 }),
      ];
      const tokens: TranscriptToken[] = [
        ...wordTokens('wool comes from sheep', 0.0, 0.4),
        ...wordTokens('wozzle', 5.5, 0.4),            // c's one free, scattered global match
        ...wordTokens('linen from flax', 6.0, 0.4),    // c's real, disputed content
        ...wordTokens('denim is durable', 7.5, 0.4),   // p's real trailing content, spoken AFTER
        ...wordTokens('silk is smooth too', 9.0, 0.4),
      ];

      const results = extractSegmentAlignments(segments, tokens);

      // Sanity: p keeps its own trailing match (the trap), same mechanism as
      // WS6 test 1.
      expect(results[1]!.matchedWords).toBe(3);

      // The widened rescue recovers "linen"/"from"/"flax" too (all three are
      // genuinely present, unclaimed, inside c's anchor window) — bridging
      // "wozzle" is NOT how it qualifies (the rescue's own candidate is
      // evaluated standalone, replacing the original scattered match
      // entirely, per the adopt-or-discard design) — "linen from flax" alone
      // is one clean contiguous run of 3, already well past the required 2.
      expect(results[2]!.matched).toBe(true);
      expect(results[2]!.matchedWords).toBe(3);
      expect(results[2]!.longestRun).toBe(4);
      expect(results[2]!.recoveredVia).toBe('windowed');
      expect(results[2]!.t0).toBeCloseTo(6.0, 3);
    });

    it('discards: global pass gives a scattered single match (no run); rescue finds nothing better, so the ORIGINAL matchedCount/confidence are preserved on the (still unmatched) result', () => {
      const segments: VideoSegment[] = [
        makeSegment({ id: 'n0', order: 0, text: 'alpha bravo charlie delta', anchorStart: 0 }),
        makeSegment({ id: 'c', order: 1, text: 'zephyr wozzle nautical bogus', anchorStart: 4 }),
        makeSegment({ id: 'n2', order: 2, text: 'echo foxtrot golf hotel', anchorStart: 8 }),
      ];
      const tokens: TranscriptToken[] = [
        ...wordTokens('alpha bravo charlie delta', 0.0, 0.4),
        ...wordTokens('wozzle', 3.6, 0.4),   // c's ONLY real word — the other 3 never occur anywhere
        ...wordTokens('echo foxtrot golf hotel', 8.0, 0.4),
      ];

      const results = extractSegmentAlignments(segments, tokens);

      // The widened gate fires (matchedCount=1, no qualifying run for a
      // 4-word segment) but the rescue passes find nothing to add — "zephyr"/
      // "nautical"/"bogus" are genuinely absent from the whole transcript.
      // The discard path preserves the ORIGINAL global-pass matchedCount/
      // confidence rather than collapsing them to 0.
      expect(results[1]!.matched).toBe(false);
      expect(results[1]!.matchedWords).toBe(1);
      expect(results[1]!.confidence).toBeCloseTo(0.25, 5);
      expect(results[1]!.longestRun).toBe(1);
      expect(results[1]!.recoveredVia).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // R13/coverage interaction (audit Q8) — a segment that fails the run check
  // still contributes its REAL matchedWords to the coverage numerators.
  // ---------------------------------------------------------------------------
  it('a segment failing the run check still contributes its real matchedWords to computeCoverageSummary (audit Q8)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta' }),
      // 2 of 5 matched ("kilo","xray" — the first and last word, each
      // isolated) — recalibrated required run for a 5-word segment is 2
      // (RUN_SURVIVAL_MIN_RUN_SHORT), but "lima zulu yankee" between them (3
      // unmatched words) exceeds RUN_SURVIVAL_MAX_HOLE, so the run stays 1
      // and can't bridge. Confidence (0.4) is also under the density floor
      // (0.5), so `matched` is false either way — but the 2 real matches
      // must still count toward coverage.
      makeSegment({ id: 's1', order: 1, text: 'kilo lima zulu yankee xray' }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta kilo filla fillb fillc xray', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    expect(cov[0]!.matched).toBe(true);
    expect(cov[1]!.matched).toBe(false);
    expect(cov[1]!.matchedWords).toBe(2);

    const summary = computeCoverageSummary(cov, countTranscriptWords(tokens));
    // 4 (s0) + 2 (s1, preserved despite matched=false) = 6 matched, out of
    // 4 + 5 = 9 total scene-doc words.
    expect(summary.sceneDocCoverage).toBeCloseTo(6 / 9, 5);
  });
});
