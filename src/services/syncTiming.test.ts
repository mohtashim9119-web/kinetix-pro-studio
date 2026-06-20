import { describe, it, expect } from 'vitest';
import { applyAnchorBasedTiming } from './syncEngine';
import { distributeSegmentTimes, applyHeadingTiming, alignScenestoTranscript } from './whisperService';
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
});
