import { describe, it, expect, vi } from 'vitest';
import { applyAnchorBasedTiming } from './syncEngine';
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
} from './whisperService';
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
import { snapCoveredBoundaries } from './snapBoundaries';
import { LOW_CONFIDENCE_RATIO, MALFORMED_TOKEN_DURATION_TOLERANCE_SEC } from './syncConstants';
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

    // s1 is partially covered (1 of 3 words) — covered, not stranded.
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[1]!.matched).toBe(true);
    expect(cov[1]!.confidence).toBeCloseTo(1 / 3, 5);

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
    // A skipped segment is by construction unmatched (matched === false, WS1a),
    // so matchedWords/confidence are always 0 here — only totalWords varies.
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
  it('keeps a segment that matched below LOW_CONFIDENCE_RATIO instead of skipping it (Bug 2)', () => {
    // 1 of 6 words spoken → confidence 0.167, under the 0.4 threshold: matched,
    // but not "covered". Under the old (buggy) behavior this was skipped with
    // reason 'low confidence'; the fix keeps it on the timeline.
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
      makeSegment({ id: 's2', order: 2, text: 'zulu victor whiskey xray yankee echo' }),
    ];
    const tokens = wordTokens('alpha bravo charlie delta echo', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);
    expect(cov[2]!.matched).toBe(true);
    expect(cov[2]!.confidence).toBeLessThan(LOW_CONFIDENCE_RATIO);
    // `covered` (R13 input) is still false — unaffected by the fix.
    expect(classifyCoverage(cov)[2]!.covered).toBe(false);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s0', 's1', 's2']);
    expect(skipped).toEqual([]);
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
    // A mix of unmatched and weakly-matched segments — only the fully unmatched
    // one should appear in `skipped`, and always with 'no audio match'.
    const spoken = ['alpha bravo', 'charlie delta echo foxtrot golf'];
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: spoken[0]! }),
      // 1 of 5 words spoken → weak match, confidence 0.2 — kept, not skipped.
      makeSegment({ id: 's1', order: 1, text: spoken[1]! }),
      makeSegment({ id: 's2', order: 2, text: 'never spoken at all' }),
    ];
    const tokens = wordTokens('alpha bravo charlie', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    const { kept, skipped } = filterToCoveredSegments(segments, cov);
    expect(kept.map(s => s.id)).toEqual(['s0', 's1']);
    expect(skipped.map(r => r.reason)).toEqual(['no audio match']);
    expect(skipped.every(r => r.reason === 'no audio match')).toBe(true);
  });

  it('294-segment-like fixture: a weakly-matched segment (confidence 0.33, mirroring the reported segment 135) is kept while R13 passes on the strongly-covered majority (Bug 2 + regression)', () => {
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
    expect(cov[weakIdx]!.matchedWords).toBe(1);
    expect(cov[weakIdx]!.totalWords).toBe(3);
    expect(cov[weakIdx]!.confidence).toBeCloseTo(1 / 3, 4);
    expect(cov[weakIdx]!.confidence).toBeLessThan(LOW_CONFIDENCE_RATIO);
    // `covered` (R13 input) is false for this segment — unaffected by the fix.
    expect(classifyCoverage(cov)[weakIdx]!.covered).toBe(false);

    // R13 gate: still passes — the strongly-covered runs are long enough, and
    // overall bidirectional coverage clears the noise floor.
    const gate = evaluateCoverageGate(segments, cov, countTranscriptWords(tokens));
    expect(gate.aborted).toBe(false);

    // Bug 2 fix: the weak segment is KEPT (matched === true), not skipped.
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
    const segments: VideoSegment[] = Array.from({ length: 6 }, (_, i) =>
      makeSegment({
        id: `s${i}`,
        order: i,
        // 5 words per segment; only 1 will match → confidence 0.2, matched=true.
        text: `zulu${i} victor${i} whiskey${i} xray${i} common`,
      }),
    );
    const tokens = wordTokens('common common common common common common', 0, 0.5);
    const cov = extractSegmentAlignments(segments, tokens);

    // Every segment is matched (weakly) but none is `covered`.
    const flags = classifyCoverage(cov);
    expect(cov.every(a => a.matched)).toBe(true);
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

  it('a silence centre before lastSpokenEnd - tolerance is NOT clamped (silence wins)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo' }),
      makeSegment({ id: 's1', order: 1, text: 'charlie delta' }),
    ];
    // lastSpokenEnd (bravo) = 2.0; nextSpokenStart (charlie) = 4.0.
    // backwardBound would be 2.0 - 0.15 = 1.85; the silence centre (1.65) is
    // before it and is kept anyway.
    const tokens: TranscriptToken[] = [
      { text: 'alpha', startSec: 0.0, endSec: 1.0 },
      { text: 'bravo', startSec: 1.0, endSec: 2.0 },
      { text: 'charlie', startSec: 4.0, endSec: 4.5 },
      { text: 'delta', startSec: 4.5, endSec: 5.0 },
    ];
    const silences: SilenceInterval[] = [{ startSec: 1.6, endSec: 1.7 }];
    const results = alignScenestoTranscript(segments, tokens, silences);
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

  it('the same inverted-bounds fixture keeps the silence centre when a silence IS found', () => {
    // Same tokens as above, but a real silence now overlaps the search window
    // ([0.8, 3.0] here, capped at next's last spoken end). Its centre (2.7) is
    // far from either spoken edge and is kept: a silence-derived boundary is
    // never clamped. This is the deliberate precedence rule, not an oversight —
    // the search window already bounds the silence to the pair's own spoken
    // extent.
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
    // Forward: a silence centred at 2.6, well past nextSpokenStart (2.0).
    {
      const { segments, tokens, alignments } = twoCoveredSegments();
      const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 2.3, endSec: 2.9 }], 5);
      expect(out[1]!.startTime).toBeCloseTo(2.6, 6);           // NOT 2.15
      expect(out[1]!.startTime).toBeGreaterThan(2.0 + 0.15);
    }
    // Backward: a silence centred at 0.45, well before lastSpokenEnd (1.0).
    {
      const { segments, tokens, alignments } = twoCoveredSegments();
      const out = snapCoveredBoundaries(segments, alignments, tokens, [{ startSec: 0.2, endSec: 0.7 }], 5);
      expect(out[1]!.startTime).toBeCloseTo(0.45, 6);          // NOT 0.85
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

  it('applies the monotonic check to a silence-derived boundary too', () => {
    // Three covered segments. Pair 0 claims silence A (centre 2.6, well past
    // its own search window's right edge — legal, the window only requires
    // OVERLAP). Pair 1's only remaining candidate is silence B (centre 2.35),
    // which would move the boundary BACKWARDS past pair 0's — so the monotonic
    // safety net fires and the pair falls back to its spoken-word midpoint
    // (2.2 + 2.3) / 2 = 2.25, unclamped.
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
      { startSec: 2.10, endSec: 3.10 }, // A — centre 2.60, claimed by pair 0
      { startSec: 2.25, endSec: 2.45 }, // B — centre 2.35, only pair 1 can see it
    ];
    const out = snapCoveredBoundaries(segments, alignments, tokens, silences, 5);

    expect(out[1]!.startTime).toBeCloseTo(2.6, 6);  // pair 0 → silence A's centre
    expect(out[2]!.startTime).toBeCloseTo(2.25, 6); // pair 1 → monotonic fallback, not 2.35
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

  it('pre-fix witness: the aligner alone DOES shift the target when unmatched scenes precede it', () => {
    // This is the bug, isolated: alignScenestoTranscript's own snap (the FULL
    // array, unmatched segments included) gives the target a different t0 in the
    // two documents. It documents WHY snapCoveredBoundaries exists — if this
    // ever stops differing, the covered-only re-snap has become redundant and
    // this whole mechanism should be re-examined rather than silently kept.
    const docA = coveredScenes();
    const docB = [
      ...coveredScenes().slice(0, 2),
      makeSegment({ id: 'u0', order: 2, text: 'zulu whiskey tango' }),
      makeSegment({ id: 'u1', order: 3, text: 'quebec sierra romeo' }),
      ...coveredScenes().slice(2),
    ];

    const targetT0A = alignScenestoTranscript(docA, TOKENS, SILENCES)[2]!.t0;
    const targetT0B = alignScenestoTranscript(docB, TOKENS, SILENCES)[4]!.t0;

    expect(targetT0A).toBeCloseTo(2.5, 6);
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
