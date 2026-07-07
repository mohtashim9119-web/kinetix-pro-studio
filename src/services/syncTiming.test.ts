import { describe, it, expect, vi } from 'vitest';
import { applyAnchorBasedTiming, computeHeadingAnchors, reinsertHeadings } from './syncEngine';
import {
  distributeSegmentTimes,
  applyHeadingTiming,
  alignScenestoTranscript,
  canonicalizeForAlignment,
  HEADING_DEFAULT_DURATION,
} from './whisperService';
import type { VideoSegment, TranscriptToken, HeadingConfig } from '../types';
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
//   applyAnchorBasedTiming -> aligner -> distributeSegmentTimes -> applyAnchorBasedTiming -> applyHeadingTiming
// This exact order was the subject of 4 bug-fix commits (d445d09, e3866d9,
// 5c8fe27, 1eb7738) around "click 1 vs click 2" timing divergence. Any change
// that alters the output below — intentionally or not — should fail this test.
describe('cached-token sync pipeline (Apply Sync, Option C)', () => {
  it('produces stable timing for a fresh project synced against cached Whisper tokens', () => {
    const AUDIO_DURATION = 11.5;

    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'Welcome to our amazing product showcase', assetId: 'a1' }),
      makeSegment({ id: 's1', order: 1, text: '', isHeading: true, headingConfig: { text: 'Chapter One' } }),
      makeSegment({ id: 's2', order: 2, text: 'It changes everything you thought you knew', assetId: 'a2' }),
      makeSegment({ id: 's3', order: 3, text: 'Get started today and see the difference', assetId: 'a3' }),
    ];

    // Whisper word timestamps: 0.4s lead-in silence before the first word,
    // a 0.6s pause over the heading card, and 0.4s of trailing silence after
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
    const reAnchored = applyAnchorBasedTiming(distributed, AUDIO_DURATION);

    // Checkpoint 1: post-reanchor, pre-heading. Segment 0's raw Whisper t0
    // (0.4s lead-in silence) must be clamped to anchor 0, and the last
    // segment must absorb trailing silence out to AUDIO_DURATION.
    expect(reAnchored.map(s => ({
      anchorStart: s.anchorStart, anchorSource: s.anchorSource, startTime: s.startTime, duration: s.duration,
    }))).toEqual([
      { anchorStart: 0, anchorSource: 'whisper', startTime: 0, duration: 3.7 },
      { anchorStart: 3.7, anchorSource: 'whisper', startTime: 3.7, duration: 0.3 },
      { anchorStart: 4, anchorSource: 'whisper', startTime: 4, duration: 3.55 },
      { anchorStart: 7.55, anchorSource: 'whisper', startTime: 7.55, duration: 3.95 },
    ]);

    const final = applyHeadingTiming(reAnchored);
    const result = final.map(s => ({
      anchorStart: s.anchorStart, anchorSource: s.anchorSource, startTime: s.startTime, duration: s.duration,
    }));

    // Checkpoint 2: final committed output. The heading pins to exactly 1.0s,
    // absorbing 50/50 from its unlocked neighbors.
    expect(result[0]).toEqual({ anchorStart: 0, anchorSource: 'whisper', startTime: 0, duration: 3.35 });
    expect(result[1]).toEqual({ anchorStart: 3.7, anchorSource: 'whisper', startTime: 3.35, duration: 1 });
    expect(result[3]).toEqual({ anchorStart: 7.55, anchorSource: 'whisper', startTime: 7.55, duration: 3.95 });

    // result[2].duration is 3.55 - 0.35 via applyHeadingTiming's GROW branch,
    // which (unlike the rest of the pipeline) does not round through
    // .toFixed(3) — it is 3.1999999999999997 in floating point, not 3.2.
    expect(result[2]?.anchorStart).toBe(4);
    expect(result[2]?.anchorSource).toBe('whisper');
    expect(result[2]?.startTime).toBe(4.35);
    expect(result[2]?.duration).toBeCloseTo(3.2, 3);

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
    const reAnchored = applyAnchorBasedTiming(distributed, AUDIO_DURATION);
    return applyHeadingTiming(reAnchored);
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

  // Reuses the oldScenes/newScenes fixture above (11→14 scenes, 4 new + 1
  // reworded boundary) to prove a heading placed in the OLD array survives
  // computeHeadingAnchors + reinsertHeadings against the NEW array — the
  // exact "drift" case Step 5/Option 1 exists to handle. '008' (salesman)
  // and '009' (Civic reveal) are unchanged and adjacent in both versions,
  // so the heading should land between them in the new array too.
  it('a heading placed in the 11-scene version survives reinsertion onto the 14-scene version', () => {
    const heading: VideoSegment = makeSegment({
      id: 'civic-heading',
      order: 6,
      text: '',
      isHeading: true,
      headingConfig: { text: 'Decision Time', color: '#ffcc00', x: 50, y: 20 },
    });
    const oldWithHeading = [...oldScenes.slice(0, 6), heading, ...oldScenes.slice(6)];

    const anchors = computeHeadingAnchors(oldWithHeading);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.afterAssetId).toBe('008');
    expect(anchors[0]?.beforeAssetId).toBe('009');

    const freshContent = newScenes.map(s => ({ ...s }));
    const result = reinsertHeadings(freshContent, anchors);

    const headingIdx = result.findIndex(s => s.isHeading);
    expect(headingIdx).toBeGreaterThan(-1);
    expect(result[headingIdx - 1]?.assetId).toBe('008');
    expect(result[headingIdx + 1]?.assetId).toBe('009');
    expect(result.find(s => s.isHeading)?.headingConfig?.text).toBe('Decision Time');
  });

  // Complements the test above with the two properties it doesn't check —
  // exactly-once survival and the duration invariant — spelled out in the
  // "heading round-trip simulation" describe block below. Lives here instead
  // of there because oldScenes/newScenes are local to this closure, not
  // module-level; this is a genuine reuse of the fixture, not a copy.
  it('a heading from the 11-scene version lands exactly once in the 14-scene version, duration-neutral', () => {
    const heading: VideoSegment = makeSegment({
      id: 'civic-heading-2',
      order: 6,
      text: '',
      isHeading: true,
      headingConfig: { text: 'Decision Time', color: '#ffcc00', x: 50, y: 20 },
    });
    const oldWithHeading = [...oldScenes.slice(0, 6), heading, ...oldScenes.slice(6)];

    const anchors = computeHeadingAnchors(oldWithHeading);
    expect(anchors).toHaveLength(1);

    const freshContent = newScenes.map(s => ({ ...s }));
    const contentTotal = freshContent.reduce((sum, s) => sum + s.duration, 0);

    const result = reinsertHeadings(freshContent, anchors);

    expect(result.filter(s => s.isHeading)).toHaveLength(1);
    const resultTotal = result.reduce((sum, s) => sum + s.duration, 0);
    expect(resultTotal).toBeCloseTo(contentTotal, 3);
  });

  // Step 7 — every test above proves one half or the other in isolation:
  // either the timing pipeline alone (NEW/OLD "synced fresh") or the heading
  // reinsertion alone (onto raw, untimed newScenes). Neither runs them
  // together in the real production order (App.tsx handleApplySyncFromFiles:
  // computeHeadingAnchors on the OLD array -> full timing pipeline on the NEW
  // array -> reinsertHeadings onto the timed result). This is that combined
  // run, asserting contiguous/sliver-free/warning-free and correct heading
  // placement simultaneously on the same final array.
  it('full pipeline: heading reinsertion survives the real 11->14 timing run, combined timeline stays contiguous/sliver-free/warning-free', () => {
    const heading: VideoSegment = makeSegment({
      id: 'civic-heading-e2e',
      order: 6,
      text: '',
      isHeading: true,
      headingConfig: { text: 'Decision Time', color: '#ffcc00', x: 50, y: 20 },
    });
    const oldWithHeading = [...oldScenes.slice(0, 6), heading, ...oldScenes.slice(6)];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const anchors = computeHeadingAnchors(oldWithHeading);
    const timedContent = runCleanSlatePipeline(newScenes);
    const result = reinsertHeadings(timedContent, anchors);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();

    // Contiguous: each segment starts exactly where the previous one ends.
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.startTime).toBeCloseTo(
        result[i - 1]!.startTime + result[i - 1]!.duration, 2,
      );
    }

    // Monotonic: no segment starts before the one before it.
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.startTime).toBeGreaterThanOrEqual(result[i - 1]!.startTime);
    }

    // Sliver-free: every CONTENT segment (excluding the heading, which has
    // its own fixed-duration target asserted separately below).
    for (const seg of result) {
      if (seg.isHeading) continue;
      expect(seg.duration).toBeGreaterThanOrEqual(0.3);
    }

    const headingSeg = result.find(s => s.isHeading)!;
    expect(headingSeg.duration).toBeCloseTo(1.0, 2);

    const total = result.reduce((sum, s) => sum + s.duration, 0);
    expect(total).toBeCloseTo(AUDIO_DURATION, 2);

    const headingIdx = result.findIndex(s => s.isHeading);
    expect(result[headingIdx - 1]?.assetId).toBe('008');
    expect(result[headingIdx + 1]?.assetId).toBe('009');
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
// Step 1.1 — computeHeadingAnchors / reinsertHeadings. Pure functions with
// no callers yet (wired onto the clean-slate pipeline in a later step); the
// real 11→14 Civic drift case above already exercises them against a real
// fixture. These cover the remaining placement/invariant/edge-case rules.
// ---------------------------------------------------------------------------
describe('computeHeadingAnchors / reinsertHeadings', () => {
  it('places a heading by assetId anchor even when scenes are inserted before and after it', () => {
    const previous: VideoSegment[] = [
      makeSegment({ id: 'p0', order: 0, text: 'Intro', assetId: 'x1' }),
      makeSegment({
        id: 'h0', order: 1, text: '', isHeading: true, headingConfig: { text: 'Chapter 1' },
        // Deliberately stale — a real timestamp from the OLD timeline that
        // has nothing to do with the fresh one below.
        anchorStart: 999, anchorSource: 'whisper',
      }),
      makeSegment({ id: 'p1', order: 2, text: 'Middle', assetId: 'x2' }),
    ];

    const anchors = computeHeadingAnchors(previous);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.afterAssetId).toBe('x1');
    expect(anchors[0]?.beforeAssetId).toBe('x2');
    expect(anchors[0]?.ordinal).toBe(1);

    // Fresh re-sync inserts a brand-new scene before AND after the anchor pair.
    const fresh: VideoSegment[] = [
      makeSegment({ id: 'f0', order: 0, text: 'New intro', assetId: 'x0' }),
      makeSegment({ id: 'f1', order: 1, text: 'Intro', assetId: 'x1' }),
      makeSegment({ id: 'f2', order: 2, text: 'Middle', assetId: 'x2' }),
      makeSegment({ id: 'f3', order: 3, text: 'New outro', assetId: 'x3' }),
    ];

    const result = reinsertHeadings(fresh, anchors);
    const headingIdx = result.findIndex(s => s.isHeading);
    expect(result[headingIdx - 1]?.assetId).toBe('x1');
    expect(result[headingIdx + 1]?.assetId).toBe('x2');

    // The stale 999 anchor must not survive — the heading's anchor now
    // reflects its position on THIS fresh timeline.
    const heading = result[headingIdx]!;
    expect(heading.anchorStart).toBe(heading.startTime);
    expect(heading.anchorSource).toBe('estimate');
  });

  it('falls back to ordinal position when the anchor assetId no longer exists', () => {
    const previous: VideoSegment[] = [
      makeSegment({ id: 'p0', order: 0, text: 'A', assetId: 'gone1' }),
      makeSegment({ id: 'p1', order: 1, text: 'B', assetId: 'gone2' }),
      makeSegment({ id: 'h0', order: 2, text: '', isHeading: true, headingConfig: { text: 'Chapter 1' } }),
      makeSegment({ id: 'p2', order: 3, text: 'C', assetId: 'gone3' }),
    ];

    const anchors = computeHeadingAnchors(previous);
    expect(anchors[0]?.ordinal).toBe(2);

    // Every asset was re-uploaded/renamed — none of the old ids exist anymore.
    const fresh: VideoSegment[] = [
      makeSegment({ id: 'f0', order: 0, text: 'A2', assetId: 'new1' }),
      makeSegment({ id: 'f1', order: 1, text: 'B2', assetId: 'new2' }),
      makeSegment({ id: 'f2', order: 2, text: 'C2', assetId: 'new3' }),
      makeSegment({ id: 'f3', order: 3, text: 'D2', assetId: 'new4' }),
    ];

    const result = reinsertHeadings(fresh, anchors);
    expect(result.findIndex(s => s.isHeading)).toBe(2);
  });

  it('preserves total duration — headings borrow time, they do not add it', () => {
    const previous: VideoSegment[] = [
      makeSegment({ id: 'p0', order: 0, text: 'A', assetId: 'a1', duration: 5 }),
      makeSegment({ id: 'h0', order: 1, text: '', isHeading: true, headingConfig: { text: 'Chapter 1' }, duration: 1 }),
      makeSegment({ id: 'p1', order: 2, text: 'B', assetId: 'a2', duration: 5 }),
    ];
    const anchors = computeHeadingAnchors(previous);

    const fresh: VideoSegment[] = [
      makeSegment({ id: 'f0', order: 0, text: 'A2', assetId: 'a1', duration: 4 }),
      makeSegment({ id: 'f1', order: 1, text: 'B2', assetId: 'a2', duration: 6 }),
    ];
    const originalTotal = fresh.reduce((sum, s) => sum + s.duration, 0);

    const result = reinsertHeadings(fresh, anchors);
    const finalTotal = result.reduce((sum, s) => sum + s.duration, 0);
    expect(finalTotal).toBeCloseTo(originalTotal, 3);
  });

  it('round-trips heading styling (color/font/position) through compute + reinsert', () => {
    const previous: VideoSegment[] = [
      makeSegment({ id: 'p0', order: 0, text: 'A', assetId: 'a1' }),
      makeSegment({
        id: 'h0', order: 1, text: '', isHeading: true,
        headingConfig: {
          text: 'Big Reveal', color: '#ff00ff', backgroundColor: '#112233',
          fontFamily: 'Impact', fontSize: 64, fontWeight: 700, x: 25, y: 80,
        },
      }),
      makeSegment({ id: 'p1', order: 2, text: 'B', assetId: 'a2' }),
    ];
    const anchors = computeHeadingAnchors(previous);

    const fresh: VideoSegment[] = [
      makeSegment({ id: 'f0', order: 0, text: 'A2', assetId: 'a1' }),
      makeSegment({ id: 'f1', order: 1, text: 'B2', assetId: 'a2' }),
    ];

    const result = reinsertHeadings(fresh, anchors);
    const heading = result.find(s => s.isHeading);
    expect(heading?.headingConfig).toEqual({
      text: 'Big Reveal', color: '#ff00ff', backgroundColor: '#112233',
      fontFamily: 'Impact', fontSize: 64, fontWeight: 700, x: 25, y: 80,
    });
  });

  it('keeps clustered headings (no content between them) in correct relative order', () => {
    const previous: VideoSegment[] = [
      makeSegment({ id: 'p0', order: 0, text: 'A', assetId: 'a1' }),
      makeSegment({ id: 'h0', order: 1, text: '', isHeading: true, headingConfig: { text: 'First' } }),
      makeSegment({ id: 'h1', order: 2, text: '', isHeading: true, headingConfig: { text: 'Second' } }),
      makeSegment({ id: 'p1', order: 3, text: 'B', assetId: 'a2' }),
    ];
    const anchors = computeHeadingAnchors(previous);
    expect(anchors).toHaveLength(2);

    const fresh: VideoSegment[] = [
      makeSegment({ id: 'f0', order: 0, text: 'A2', assetId: 'a1', duration: 5 }),
      makeSegment({ id: 'f1', order: 1, text: 'B2', assetId: 'a2', duration: 5 }),
    ];
    const result = reinsertHeadings(fresh, anchors);

    // Duration precision across a cluster is explicitly not asserted here —
    // only that both headings survive, in order, between the right neighbors.
    const headingTexts = result.filter(s => s.isHeading).map(s => s.headingConfig?.text);
    expect(headingTexts).toEqual(['First', 'Second']);

    const idxFirst = result.findIndex(s => s.headingConfig?.text === 'First');
    const idxSecond = result.findIndex(s => s.headingConfig?.text === 'Second');
    expect(idxFirst).toBeLessThan(idxSecond);
    expect(result[idxFirst - 1]?.assetId).toBe('a1');
    expect(result[idxSecond + 1]?.assetId).toBe('a2');
  });
});

// ---------------------------------------------------------------------------
// Step 5 Phase 2 — heading round-trip simulation (insert/rename/delete).
//
// HONESTY NOTE: handleInsertHeading, handleDeleteHeading, and
// handleApplySyncFromFiles are useCallback closures inside App.tsx with no
// test harness in this repo (no jsdom/testing-library) — they cannot be
// imported and called directly. What follows instead chains the PURE
// functions those handlers actually call (computeHeadingAnchors,
// reinsertHeadings), fed with input shaped exactly as each handler shapes
// it (see makeInsertedHeading below, mirrored from App.tsx
// handleInsertHeading's newHeading object at App.tsx:890-903, and the
// neighbor-duration-return math mirrored from handleDeleteHeading at
// App.tsx:942-944). These tests prove what the pure merge layer produces
// for each lifecycle step; they do NOT prove the React handlers themselves
// wire that input together correctly end-to-end.
//
// The re-sync half of each test mirrors the real order of operations in
// App.tsx handleApplySyncFromFiles: previousSegments captured pre-parse →
// computeHeadingAnchors(previousSegments) → fresh content parsed/timed →
// reinsertHeadings(timedContent, anchors) (App.tsx:1249-1359) — never the
// reverse order.
// ---------------------------------------------------------------------------
describe('heading round-trip simulation (insert/rename/delete + re-sync)', () => {
  // Mirrors the exact VideoSegment shape App.tsx handleInsertHeading
  // constructs, so these tests exercise the merge layer against realistic
  // input rather than a hand-wavy stand-in.
  function makeInsertedHeading(opts: {
    id: string;
    order: number;
    startTime: number;
    duration?: number;
    headingConfig: HeadingConfig;
  }): VideoSegment {
    return {
      id: opts.id,
      order: opts.order,
      text: '',
      heading: opts.headingConfig.text,
      isHeading: true,
      headingConfig: { x: 50, y: 50, ...opts.headingConfig },
      duration: opts.duration ?? HEADING_DEFAULT_DURATION,
      startTime: opts.startTime,
      anchorStart: opts.startTime,
      anchorSource: 'whisper',
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
    };
  }

  it('INSERT then RE-SYNC: a freshly-inserted heading survives the next sync in the right place', () => {
    // Simulates handleInsertHeading(0) on two pre-existing 5s segments —
    // insert after p0, steal 0.5s from each neighbor (App.tsx:857-868's
    // "middle" branch) — leaving previousSegments as the committed state
    // a subsequent Apply Sync would read.
    const heading = makeInsertedHeading({
      id: 'h0', order: 1, startTime: 4.5, headingConfig: { text: 'Heading 1' },
    });
    const previousSegments: VideoSegment[] = [
      makeSegment({ id: 'p0', order: 0, text: 'Intro', assetId: 'a1', duration: 4.5 }),
      heading,
      makeSegment({ id: 'p1', order: 2, text: 'Body', assetId: 'a2', duration: 4.5 }),
    ];

    const anchors = computeHeadingAnchors(previousSegments);
    expect(anchors).toHaveLength(1);

    // RE-SYNC: a fresh content-only parse comes back with new durations
    // (e.g. the voiceover changed length).
    const freshContent: VideoSegment[] = [
      makeSegment({ id: 'p0-new', order: 0, text: 'Intro', assetId: 'a1', duration: 6 }),
      makeSegment({ id: 'p1-new', order: 1, text: 'Body', assetId: 'a2', duration: 6 }),
    ];
    const contentTotal = freshContent.reduce((sum, s) => sum + s.duration, 0);

    const result = reinsertHeadings(freshContent, anchors);

    expect(result.filter(s => s.isHeading)).toHaveLength(1);
    const headingIdx = result.findIndex(s => s.isHeading);
    expect(result[headingIdx - 1]?.assetId).toBe('a1');
    expect(result[headingIdx + 1]?.assetId).toBe('a2');
    expect(result[headingIdx]?.headingConfig?.text).toBe('Heading 1');

    // DURATION INVARIANT — headings borrow time, they do not add it.
    const resultTotal = result.reduce((sum, s) => sum + s.duration, 0);
    expect(resultTotal).toBeCloseTo(contentTotal, 3);
  });

  it('RENAME then RE-SYNC: the renamed text/styling round-trips, not the original', () => {
    const heading = makeInsertedHeading({
      id: 'h0', order: 1, startTime: 4.5, headingConfig: { text: 'Heading 1' },
    });
    const previousSegments: VideoSegment[] = [
      makeSegment({ id: 'p0', order: 0, text: 'Intro', assetId: 'a1', duration: 4.5 }),
      heading,
      makeSegment({ id: 'p1', order: 2, text: 'Body', assetId: 'a2', duration: 4.5 }),
    ];

    // User renames + restyles via the BottomDrawer "Heading Style" panel
    // before the next sync — a plain immutable headingConfig update.
    const renamed = previousSegments.map(s =>
      s.id === 'h0'
        ? { ...s, headingConfig: { ...s.headingConfig!, text: 'Chapter Two', color: '#00ffcc' } }
        : s,
    );

    const anchors = computeHeadingAnchors(renamed);
    expect(anchors[0]?.heading.headingConfig?.text).toBe('Chapter Two');

    const freshContent: VideoSegment[] = [
      makeSegment({ id: 'p0-new', order: 0, text: 'Intro', assetId: 'a1', duration: 6 }),
      makeSegment({ id: 'p1-new', order: 1, text: 'Body', assetId: 'a2', duration: 6 }),
    ];
    const contentTotal = freshContent.reduce((sum, s) => sum + s.duration, 0);

    const result = reinsertHeadings(freshContent, anchors);
    const reinsertedHeading = result.find(s => s.isHeading);
    expect(reinsertedHeading?.headingConfig?.text).toBe('Chapter Two');
    expect(reinsertedHeading?.headingConfig?.color).toBe('#00ffcc');
    // The stale pre-rename text must not survive anywhere in the output.
    expect(result.some(s => s.headingConfig?.text === 'Heading 1')).toBe(false);

    const resultTotal = result.reduce((sum, s) => sum + s.duration, 0);
    expect(resultTotal).toBeCloseTo(contentTotal, 3);
  });

  it('DELETE then RE-SYNC: a deleted heading does not reappear (no resurrection)', () => {
    const heading = makeInsertedHeading({
      id: 'h0', order: 1, startTime: 4.5, headingConfig: { text: 'Heading 1' },
    });

    // Simulates handleDeleteHeading: heading removed, its duration returned
    // 50/50 to neighbors (App.tsx:942-944) BEFORE the next sync runs — so
    // previousSegments below has no heading at all, same as production.
    const previousSegments: VideoSegment[] = [
      makeSegment({ id: 'p0', order: 0, text: 'Intro', assetId: 'a1', duration: 4.5 + heading.duration / 2 }),
      makeSegment({ id: 'p1', order: 1, text: 'Body', assetId: 'a2', duration: 4.5 + heading.duration / 2 }),
    ];

    const anchors = computeHeadingAnchors(previousSegments);
    expect(anchors).toHaveLength(0);

    const freshContent: VideoSegment[] = [
      makeSegment({ id: 'p0-new', order: 0, text: 'Intro', assetId: 'a1', duration: 6 }),
      makeSegment({ id: 'p1-new', order: 1, text: 'Body', assetId: 'a2', duration: 6 }),
    ];
    const contentTotal = freshContent.reduce((sum, s) => sum + s.duration, 0);

    const result = reinsertHeadings(freshContent, anchors);
    expect(result.some(s => s.isHeading)).toBe(false);
    expect(result.find(s => s.headingConfig?.text === 'Heading 1')).toBeUndefined();

    const resultTotal = result.reduce((sum, s) => sum + s.duration, 0);
    expect(resultTotal).toBeCloseTo(contentTotal, 3);
  });

  // DRIFT is covered separately in the 'clean-slate re-sync (real 11→14
  // scene repro)' describe block above — it reuses the real Civic
  // oldScenes/newScenes fixture, which is local to that block's closure and
  // can't be referenced from here. See the test there named "a heading from
  // the 11-scene version lands exactly once in the 14-scene version,
  // duration-neutral".
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

  // Part C safety net: an UNHANDLED mismatch type (a made-up token the
  // canonicalizer can't fix) drops a segment to low confidence AND spuriously
  // matches a common word far ahead. Without the guard, the greedy cursor
  // over-advances past the following segment's true words and strands it at ~0
  // (the D16 cascade). The guard holds the cursor so the next segment still
  // finds its real position further along the audio.
  it('SAFETY NET (Part C): a low-confidence segment does not cascade drift onto the next', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta' }),
      // Two words match nothing; "hotel" spuriously matches the far-ahead
      // token, which (pre-guard) would over-advance the cursor to the end and
      // strand s2 at ~0.
      makeSegment({ id: 's1', order: 1, text: 'qwerty asdf hotel' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot golf hotel' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo charlie delta', 0.0, 0.5), // idx 0–3
      ...wordTokens('lorem ipsum dolor', 2.5, 0.5),         // idx 4–6 (s1's real, unmatched audio)
      ...wordTokens('echo foxtrot golf hotel', 4.5, 0.5),   // idx 7–10
    ];

    // Low-confidence match on s1 is expected — assert it's logged, not silent.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t0 = alignT0s(segments, tokens);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    expect(t0[0]).toBeLessThan(0.5);
    // The critical assertion: s2 lands in the second half of the audio, near its
    // true "echo foxtrot golf hotel" phrase, NOT stranded at ~0 by an
    // over-advanced cursor. Pre-guard this would collapse toward 0.
    // Since the D16 overshoot guard (see next describe block), s1 no longer
    // overshoots to ~5s but sits in its real ~2.25–3.75s window, so gap-fill now
    // places the s1→s2 boundary at the midpoint of the real silent gap (~3.75s)
    // instead of the pre-fix ~4.5s. Still firmly in the second half — no cascade.
    expect(t0[2]!).toBeGreaterThan(3.0);
  });
});

// ---------------------------------------------------------------------------
// D16 — overshoot guard (primary fix) + backstop monotonic clamp.
//
// A low-confidence segment whose best (coincidental) match lands FAR AHEAD of
// the entry cursor used to anchor its t0/t1 to that overshot position, pushing
// its span past the next segment's real match and collapsing both to ~0 (the
// real-project 48 / 152–153 / 173 / 183 repro). The primary fix snaps such an
// overshoot back to the cursor; the backstop clamp in applyAnchorBasedTiming
// guarantees anchors stay monotonic even for an overshoot the primary guard
// misses. In-tolerance low-confidence matches (bestStart at/near the cursor)
// are deliberately untouched.
// ---------------------------------------------------------------------------
describe('D16 — overshoot guard + backstop clamp', () => {
  function alignSpans(
    segments: VideoSegment[],
    tokens: TranscriptToken[],
  ): Array<{ t0: number; t1: number; dur: number }> {
    return alignScenestoTranscript(segments, tokens, []).map(a => ({
      t0: a.t0, t1: a.t1, dur: Number((a.t1 - a.t0).toFixed(3)),
    }));
  }

  // (a) Regression guard for the 8 already-safe cases: a low-confidence segment
  // whose partial match sits AT the cursor (delta 0, within tolerance) must NOT
  // be snapped — only the low-confidence hold applies, exactly as before.
  it('(a) low-confidence match AT the cursor is left untouched (no overshoot snap)', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta' }),
      // "echo" matches right at the cursor (idx 4); the other two match nothing.
      makeSegment({ id: 's1', order: 1, text: 'echo qwerty asdf' }),
      makeSegment({ id: 's2', order: 2, text: 'foxtrot golf hotel india' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo charlie delta', 0.0, 0.5), // idx 0–3
      ...wordTokens('echo lorem ipsum', 2.5, 0.5),          // idx 4–6
      ...wordTokens('foxtrot golf hotel india', 4.5, 0.5),  // idx 7–10
    ];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spans = alignSpans(segments, tokens);

    // The low-confidence hold still logs, but the overshoot branch must NOT:
    // proves this in-tolerance case takes the unchanged (byte-identical) path.
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('low-confidence'))).toBe(true);
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('overshoot'))).toBe(false);
    warnSpy.mockRestore();

    // s1 keeps a sane, non-collapsed span near its real audio; nothing strands.
    expect(spans[1]!.dur).toBeGreaterThan(0.5);
    expect(spans[0]!.t0).toBeLessThanOrEqual(spans[1]!.t0);
    expect(spans[1]!.t0).toBeLessThanOrEqual(spans[2]!.t0);
    expect(spans[2]!.t0).toBeGreaterThan(3.0);
  });

  // (b) The core fix: a low-confidence segment whose ONLY match is far ahead
  // (spurious "hotel" at idx 10) now anchors at the cursor instead of
  // overshooting — so it no longer collapses, and the next segment is unharmed.
  it('(b) far-ahead low-confidence match anchors at the cursor, not the overshoot', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta' }),
      makeSegment({ id: 's1', order: 1, text: 'qwerty asdf hotel' }),
      makeSegment({ id: 's2', order: 2, text: 'echo foxtrot golf hotel' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo charlie delta', 0.0, 0.5), // idx 0–3
      ...wordTokens('lorem ipsum dolor', 2.5, 0.5),         // idx 4–6 (s1's real, unmatched audio)
      ...wordTokens('echo foxtrot golf hotel', 4.5, 0.5),   // idx 7–10 (spurious "hotel" far ahead)
    ];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spans = alignSpans(segments, tokens);
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('overshoot'))).toBe(true);
    warnSpy.mockRestore();

    // Pre-fix: s1 overshot to ~5.0s, inverting with s2 (~4.5s) and collapsing to
    // the 0.1 floor. Post-fix: s1 sits in its real ~2.5–4s window, uncollapsed.
    expect(spans[1]!.dur).toBeGreaterThan(0.5);
    expect(spans[1]!.t0).toBeLessThan(spans[2]!.t0); // no inversion
    expect(spans[2]!.t0).toBeGreaterThan(3.0);       // s2 still near its true phrase
    expect(spans.every(s => s.dur > 0)).toBe(true);
  });

  // (c) Consecutive-pair (152/153-style): two adjacent low-confidence segments
  // that would each overshoot must resolve to sane, non-negative, non-
  // overlapping durations rather than mutually corrupting each other.
  it('(c) two consecutive overshoot segments resolve without collapse or inversion', () => {
    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'alpha bravo charlie delta' }),
      makeSegment({ id: 's1', order: 1, text: 'qwerty asdf hotel' }),  // spurious "hotel" ahead
      makeSegment({ id: 's2', order: 2, text: 'zzz yyy golf' }),        // spurious "golf" ahead
      makeSegment({ id: 's3', order: 3, text: 'echo foxtrot golf hotel' }),
    ];
    const tokens: TranscriptToken[] = [
      ...wordTokens('alpha bravo charlie delta', 0.0, 0.5),  // idx 0–3
      ...wordTokens('lorem ipsum dolor sit amet', 2.5, 0.5), // idx 4–8 (s1+s2 real, unmatched)
      ...wordTokens('echo foxtrot golf hotel', 5.5, 0.5),    // idx 9–12
    ];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spans = alignSpans(segments, tokens);
    warnSpy.mockRestore();

    // No collapse, no inversion, monotonic starts across the whole run.
    expect(spans.every(s => s.dur > 0.3)).toBe(true);
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

