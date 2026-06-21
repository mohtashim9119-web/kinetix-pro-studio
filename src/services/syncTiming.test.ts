import { describe, it, expect } from 'vitest';
import { applyAnchorBasedTiming, resolveAnchorSource, getSegmentStableKey } from './syncEngine';
import {
  distributeSegmentTimes,
  applyHeadingTiming,
  alignScenestoTranscript,
  alignScenesToTranscriptAnchorAware,
} from './whisperService';
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

  // Mixed-provenance case: per-slot re-sync will demote exactly one segment
  // back to 'estimate' while its neighbors keep their precise 'whisper'
  // anchors from a prior full sync. hasAnyWhisperAnchor (useWhisper.ts
  // alignSegmentsFromCachedTranscript) must route this through
  // alignScenesToTranscriptAnchorAware rather than the plain aligner — this
  // test locks in that the anchor-aware path produces correct, monotonic
  // output for a real mixed array instead of assuming all-or-nothing.
  it('realigns a single demoted estimate segment inside its whisper-pinned neighbors without disturbing them', () => {
    const AUDIO_DURATION = 16.0;

    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'Welcome to our amazing product showcase', assetId: 'a1', anchorStart: 0, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'It changes everything you thought you knew', assetId: 'a2', anchorStart: 4.0, anchorSource: 'whisper' }),
      // Demoted by a per-slot edit: stale/wrong anchor guess, provenance downgraded to 'estimate'.
      makeSegment({ id: 's2', order: 2, text: 'Get started today and see the difference', assetId: 'a3', anchorStart: 10.5, anchorSource: 'estimate' }),
      makeSegment({ id: 's3', order: 3, text: 'Thanks for watching to the end today', assetId: 'a4', anchorStart: 12.0, anchorSource: 'whisper' }),
    ];

    const tokens: TranscriptToken[] = [
      ...wordTokens('Welcome to our amazing product showcase', 0.4, 0.5),
      ...wordTokens('It changes everything you thought you knew', 4.0, 0.5),
      ...wordTokens('Get started today and see the difference', 8.0, 0.5),
      ...wordTokens('Thanks for watching to the end today', 12.0, 0.5),
    ];

    const silences: SilenceInterval[] = [
      { startSec: 0, endSec: 0.4 },
      { startSec: 3.4, endSec: 4.0 },
      { startSec: 7.5, endSec: 8.0 },
      { startSec: 11.5, endSec: 12.0 },
    ];

    // Production order (App.tsx handleApplySyncFromFiles + useWhisper.ts
    // alignSegmentsFromCachedTranscript): applyAnchorBasedTiming -> aligner ->
    // distributeSegmentTimes -> applyAnchorBasedTiming -> applyHeadingTiming.
    const anchorTimed = applyAnchorBasedTiming(segments, AUDIO_DURATION);

    const hasAnyWhisperAnchor = anchorTimed.some(s => s.anchorSource === 'whisper');
    expect(hasAnyWhisperAnchor).toBe(true); // confirms this array hits the anchor-aware aligner in production

    const alignments = alignScenesToTranscriptAnchorAware(anchorTimed, tokens, silences, AUDIO_DURATION);
    const distributed = distributeSegmentTimes(anchorTimed, alignments, AUDIO_DURATION);
    const reAnchored = applyAnchorBasedTiming(distributed, AUDIO_DURATION);
    const final = applyHeadingTiming(reAnchored);

    const result = final.map(s => ({
      anchorStart: s.anchorStart, anchorSource: s.anchorSource, startTime: s.startTime, duration: s.duration,
    }));

    // Baseline captured from a real run of the chain above.
    expect(result).toEqual([
      { anchorStart: 0, anchorSource: 'whisper', startTime: 0, duration: 4 },
      { anchorStart: 4, anchorSource: 'whisper', startTime: 4, duration: 4 },
      { anchorStart: 8, anchorSource: 'whisper', startTime: 8, duration: 4 },
      { anchorStart: 12, anchorSource: 'whisper', startTime: 12, duration: 4 },
    ]);

    // (1) Whisper-pinned segments keep their original anchor positions —
    // the anchor-aware aligner must not move a 'whisper' segment's t0.
    expect(result[0]?.anchorStart).toBe(0);
    expect(result[1]?.anchorStart).toBe(4);
    expect(result[3]?.anchorStart).toBe(12);

    // (2) The estimate segment is realigned strictly inside the gap between
    // its whisper neighbors — not left at its stale guess (10.5) — and the
    // neighbors are not pushed (already covered by (1), restated here as an
    // explicit "no push" check on the gap bounds themselves).
    expect(result[2]?.anchorSource).toBe('whisper'); // promoted after realignment
    expect(result[2]!.anchorStart!).toBeGreaterThan(result[1]!.anchorStart!);
    expect(result[2]!.anchorStart!).toBeLessThan(result[3]!.anchorStart!);
    expect(result[1]!.anchorStart).toBe(4); // unpushed
    expect(result[3]!.anchorStart).toBe(12); // unpushed

    // (3) Seams stay monotonic across the whole array.
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.startTime).toBeGreaterThanOrEqual(result[i - 1]!.startTime);
    }

    const totalDuration = final.reduce((sum, s) => sum + s.duration, 0);
    expect(totalDuration).toBeCloseTo(AUDIO_DURATION, 3);
  });
});

// Coverage for commit 2 (text-aware anchor demotion): resolveAnchorSource is
// the single helper both finalizeSync and handleApplySyncFromFiles (App.tsx)
// call inside their stable-key merge loops to decide whether a carried-forward
// 'whisper' anchor is still trustworthy once a segment's text has changed.
describe('resolveAnchorSource (text-aware anchor demotion)', () => {
  const OLD_TEXT = 'Get started today and see the difference';

  it('keeps a whisper anchor when an asset-keyed segment\'s text is unchanged', () => {
    const prev = makeSegment({ id: 'p', order: 2, assetId: 'a3', text: OLD_TEXT, anchorStart: 8, anchorSource: 'whisper' });
    const next = makeSegment({ id: 'n', order: 2, assetId: 'a3', text: OLD_TEXT, anchorStart: 6, anchorSource: 'estimate' });

    expect(resolveAnchorSource(prev, next)).toBe('whisper');
  });

  it('demotes a whisper anchor to estimate when an asset-keyed segment\'s text materially changed', () => {
    const prev = makeSegment({ id: 'p', order: 2, assetId: 'a3', text: OLD_TEXT, anchorStart: 8, anchorSource: 'whisper' });
    const next = makeSegment({ id: 'n', order: 2, assetId: 'a3', text: 'Sign up now and claim your discount', anchorStart: 6, anchorSource: 'estimate' });

    expect(resolveAnchorSource(prev, next)).toBe('estimate');
  });

  it('does not demote on cosmetic-only edits — extra whitespace, punctuation, case', () => {
    const prev = makeSegment({ id: 'p', order: 2, assetId: 'a3', text: OLD_TEXT, anchorStart: 8, anchorSource: 'whisper' });
    const next = makeSegment({ id: 'n', order: 2, assetId: 'a3', text: '  GET STARTED, today...   and see the difference!! ', anchorStart: 6, anchorSource: 'estimate' });

    // Anti-spurious-demotion guard: normalize() strips case/punctuation/whitespace
    // before comparison, so this must NOT be treated as a material change.
    expect(resolveAnchorSource(prev, next)).toBe('whisper');
  });

  it('treats a heading whose text changed as unmatched upstream — key changes, so resolveAnchorSource sees no prev and keeps the fresh estimate', () => {
    // getSegmentStableKey keys headings BY their own text, so a renamed heading
    // can never reach resolveAnchorSource with a mismatched prev/next text pair —
    // the lookup itself misses. This test exercises that real lookup, not a
    // hand-fabricated mismatch.
    const oldHeading = makeSegment({
      id: 'h-old', order: 1, text: '', isHeading: true,
      headingConfig: { text: 'Chapter One' }, anchorStart: 3.7, anchorSource: 'whisper',
    });
    const prevByKey = new Map<string, VideoSegment>();
    prevByKey.set(getSegmentStableKey(oldHeading), oldHeading);

    const newHeading = makeSegment({
      id: 'h-new', order: 1, text: '', isHeading: true,
      headingConfig: { text: 'Chapter Two' }, // user renamed the heading
      anchorStart: 3.9, anchorSource: 'estimate', // fresh bootstrap from re-parse
    });

    const prev = prevByKey.get(getSegmentStableKey(newHeading));
    expect(prev).toBeUndefined(); // different heading text -> different stable key -> no match

    expect(resolveAnchorSource(prev, newHeading)).toBe('estimate');
  });

  it('never promotes an estimate anchor back to whisper, regardless of text', () => {
    const prevUnchanged = makeSegment({ id: 'p1', order: 2, assetId: 'a3', text: OLD_TEXT, anchorStart: 8, anchorSource: 'estimate' });
    const nextUnchanged = makeSegment({ id: 'n1', order: 2, assetId: 'a3', text: OLD_TEXT, anchorStart: 6, anchorSource: 'estimate' });
    expect(resolveAnchorSource(prevUnchanged, nextUnchanged)).toBe('estimate');

    const prevChanged = makeSegment({ id: 'p2', order: 2, assetId: 'a3', text: OLD_TEXT, anchorStart: 8, anchorSource: 'estimate' });
    const nextChanged = makeSegment({ id: 'n2', order: 2, assetId: 'a3', text: 'Totally different wording here', anchorStart: 6, anchorSource: 'estimate' });
    expect(resolveAnchorSource(prevChanged, nextChanged)).toBe('estimate');
  });

  // The real per-slot scenario: a re-sync edits one segment's text while its
  // neighbors are untouched. resolveAnchorSource demotes the edited segment
  // (driven by an actual text change, not a hardcoded fixture), and the same
  // cached-token chain from the "mixed-provenance" test above must re-derive
  // its true position from the unchanged audio while leaving whisper-pinned
  // neighbors exactly where they are.
  it('demotes a re-synced segment via resolveAnchorSource, then the anchor-aware chain re-derives its true position while neighbors stay put', () => {
    const AUDIO_DURATION = 16.0;

    // Prior full sync: this slot (asset a3) was whisper-pinned at 10.5s under
    // now-stale text.
    const prevS2 = makeSegment({
      id: 'old-s2', order: 2, assetId: 'a3',
      text: 'Pick up your copy now',
      anchorStart: 10.5, anchorSource: 'whisper',
    });

    // Re-sync: parseProjectData re-parses the edited script and produces a
    // fresh segment for the same asset slot — new text, bootstrap estimate anchor.
    const freshS2 = makeSegment({
      id: 'new-s2', order: 2, assetId: 'a3',
      text: OLD_TEXT,
      anchorStart: 6.0, anchorSource: 'estimate',
    });

    const resolved = resolveAnchorSource(prevS2, freshS2);
    expect(resolved).toBe('estimate'); // demoted: text materially changed

    // Mirrors the App.tsx merge loop: anchorStart carries forward from prev
    // regardless of demotion — this stale 10.5 is exactly what the anchor-aware
    // aligner must correct using freshS2's new text.
    const mergedS2: VideoSegment = { ...freshS2, anchorStart: prevS2.anchorStart, anchorSource: resolved };

    const segments: VideoSegment[] = [
      makeSegment({ id: 's0', order: 0, text: 'Welcome to our amazing product showcase', assetId: 'a1', anchorStart: 0, anchorSource: 'whisper' }),
      makeSegment({ id: 's1', order: 1, text: 'It changes everything you thought you knew', assetId: 'a2', anchorStart: 4.0, anchorSource: 'whisper' }),
      mergedS2,
      makeSegment({ id: 's3', order: 3, text: 'Thanks for watching to the end today', assetId: 'a4', anchorStart: 12.0, anchorSource: 'whisper' }),
    ];

    const tokens: TranscriptToken[] = [
      ...wordTokens('Welcome to our amazing product showcase', 0.4, 0.5),
      ...wordTokens('It changes everything you thought you knew', 4.0, 0.5),
      ...wordTokens(OLD_TEXT, 8.0, 0.5),
      ...wordTokens('Thanks for watching to the end today', 12.0, 0.5),
    ];

    const silences: SilenceInterval[] = [
      { startSec: 0, endSec: 0.4 },
      { startSec: 3.4, endSec: 4.0 },
      { startSec: 7.5, endSec: 8.0 },
      { startSec: 11.5, endSec: 12.0 },
    ];

    // Same composition as the "mixed-provenance" test above (App.tsx
    // handleApplySyncFromFiles + useWhisper.ts alignSegmentsFromCachedTranscript).
    const anchorTimed = applyAnchorBasedTiming(segments, AUDIO_DURATION);
    const alignments = alignScenesToTranscriptAnchorAware(anchorTimed, tokens, silences, AUDIO_DURATION);
    const distributed = distributeSegmentTimes(anchorTimed, alignments, AUDIO_DURATION);
    const reAnchored = applyAnchorBasedTiming(distributed, AUDIO_DURATION);
    const final = applyHeadingTiming(reAnchored);

    const result = final.map(s => ({
      anchorStart: s.anchorStart, anchorSource: s.anchorSource, startTime: s.startTime, duration: s.duration,
    }));

    expect(result).toEqual([
      { anchorStart: 0, anchorSource: 'whisper', startTime: 0, duration: 4 },
      { anchorStart: 4, anchorSource: 'whisper', startTime: 4, duration: 4 },
      { anchorStart: 8, anchorSource: 'whisper', startTime: 8, duration: 4 },
      { anchorStart: 12, anchorSource: 'whisper', startTime: 12, duration: 4 },
    ]);

    // The demoted segment is re-derived to its true position (8.0) — not left
    // at the stale carried-forward guess (10.5) — and promoted back to
    // 'whisper' after a confident realignment.
    expect(result[2]?.anchorStart).toBe(8);
    expect(result[2]?.anchorSource).toBe('whisper');

    // Whisper-pinned neighbors are untouched.
    expect(result[0]?.anchorStart).toBe(0);
    expect(result[1]?.anchorStart).toBe(4);
    expect(result[3]?.anchorStart).toBe(12);
  });
});
