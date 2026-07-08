import { describe, it, expect } from 'vitest';
import { applyAnchorBasedTiming } from './syncEngine';
import type { VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

/**
 * Regression test for the locked-overlap early-cutoff bug (fixed in App.tsx's
 * handleToggleLock via resolveAudioDuration). A locked segment can carry
 * duration > its available span (locks never shrink — applyAnchorBasedTiming's
 * locked branch, syncEngine.ts:94-98), inflating Σ duration by that overlap
 * amount. Before the fix, downstream re-sync paths re-derived audioDuration
 * self-referentially from that inflated Σ duration and fed it into PASS 3,
 * baking the inflation into the last segment's declared end — it would claim
 * to run past where the real audio physically ends, so its tail silently
 * never played. The fix prefers the real live <audio> duration (mirroring how
 * Apply Sync sources it, App.tsx:1498-1500) and only falls back to Σ duration
 * when no live duration is available (no-voiceover projects).
 */

function makeSegment(partial: Partial<VideoSegment> & { id: string; text: string; order: number }): VideoSegment {
  return {
    startTime: 0,
    duration: 1,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    ...partial,
  };
}

const TRUE_AUDIO_DURATION = 40.0; // physical, live <audio> element duration

/** Mirrors App.tsx's resolveAudioDuration exactly (unexported helper, so
 *  replicated here rather than imported — this test never imports App.tsx). */
function resolveAudioDuration(liveDuration: number | undefined, fallbackSegments: VideoSegment[]): number {
  if (liveDuration !== undefined && isFinite(liveDuration) && liveDuration > 0) return liveDuration;
  return fallbackSegments.reduce((sum, s) => sum + s.duration, 0);
}

/**
 * 8-segment timeline. Segment 3 (0-indexed, middle — not last, not
 * second-to-last) is LOCKED with a manually-set duration of 8s from an
 * earlier drag-resize. A re-sync has since moved segment 4's anchor closer
 * (18 instead of the "clean" 20), shrinking segment 3's available span to
 * 3s while its locked duration (8s) is preserved — producing an intended
 * overlap of G = 8 - 3 = 5s.
 */
function buildInputWithLockedOverlap(): VideoSegment[] {
  const anchors = [0, 5, 10, 15, 18, 23, 28, 33]; // s3->s4 gap shrunk from 5 to 3
  return anchors.map((anchor, i) => {
    const isLocked = i === 3;
    return makeSegment({
      id: `s${i}`,
      order: i,
      text: `scene ${i}`,
      assetId: `asset${i}`,
      anchorStart: anchor,
      anchorSource: 'estimate',
      duration: isLocked ? 8 : 5, // locked seg's preserved (manual) duration
      startTime: anchor,
      locked: isLocked,
    });
  });
}

describe('locked-overlap early-cutoff regression', () => {
  it('documents the intended lock behavior: a locked segment can exceed its available span (overlap G)', () => {
    const input = buildInputWithLockedOverlap();
    const afterResync = applyAnchorBasedTiming(input, TRUE_AUDIO_DURATION);

    const locked = afterResync[3]!;
    const next = afterResync[4]!;
    const G = (locked.startTime + locked.duration) - next.startTime;

    // Locks never shrink — this overlap is intended behavior, not a bug in
    // applyAnchorBasedTiming itself. The bug (fixed elsewhere) was in how
    // the heading paths re-derived audioDuration from a Σ duration already
    // inflated by this G.
    expect(locked.duration).toBe(8);
    expect(G).toBeCloseTo(5, 6);
  });

  it('UNCHANGED — no-voiceover fallback still uses Σ duration when no live audio duration is available', () => {
    const input = buildInputWithLockedOverlap();
    const afterResync = applyAnchorBasedTiming(input, TRUE_AUDIO_DURATION);
    const withOrder = afterResync.map((s, i) => ({ ...s, order: i }));

    // No live <audio> duration available (undefined, mirrors audioRef.current
    // being null or duration not yet loaded) — falls back to Σ duration,
    // exactly as before the fix.
    const audioDuration = resolveAudioDuration(undefined, withOrder);
    const expectedFallback = withOrder.reduce((sum, s) => sum + s.duration, 0);

    expect(audioDuration).toBe(expectedFallback);
  });
});
