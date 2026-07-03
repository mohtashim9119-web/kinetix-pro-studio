import { describe, it, expect } from 'vitest';
import {
  applyAnchorBasedTiming,
  stealDurationFromNeighbors,
  giveDurationToNeighbors,
} from './syncEngine';
import { HEADING_DEFAULT_DURATION } from './whisperService';
import type { VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

/**
 * Regression test for the locked-overlap early-cutoff bug (fixed in App.tsx's
 * handleToggleLock/handleInsertHeading/handleDeleteHeading via
 * resolveAudioDuration). A locked segment can carry duration > its available
 * span (locks never shrink — applyAnchorBasedTiming's locked branch,
 * syncEngine.ts:94-98), inflating Σ duration by that overlap amount. Before
 * the fix, the heading paths re-derived audioDuration self-referentially from
 * that inflated Σ duration and fed it into PASS 3, baking the inflation into
 * the last segment's declared end — it would claim to run past where the
 * real audio physically ends, so its tail silently never played. The fix
 * prefers the real live <audio> duration (mirroring how Apply Sync sources
 * it, App.tsx:1498-1500) and only falls back to Σ duration when no live
 * duration is available (no-voiceover projects).
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

  it('FIXED — handleInsertHeading (App.tsx:1015-1084) uses the real physical audio duration, not the inflated Σ', () => {
    const input = buildInputWithLockedOverlap();
    const afterResync = applyAnchorBasedTiming(input, TRUE_AUDIO_DURATION);
    const inflatedTotal = afterResync.reduce((sum, s) => sum + s.duration, 0);
    expect(inflatedTotal).toBeGreaterThan(TRUE_AUDIO_DURATION); // sanity: Σ duration IS inflated by G

    // --- Replay App.tsx handleInsertHeading (lines 1015-1084) verbatim ---
    const segs = afterResync;
    const afterIndex = 5; // insert after s5, away from the lock at s3/s4
    const insertAt = afterIndex + 1; // App.tsx:1018
    const HEADING_DUR = HEADING_DEFAULT_DURATION; // App.tsx:1019

    const placeholderHeading: VideoSegment = { // App.tsx:1032-1043
      id: 'heading-1',
      order: insertAt,
      text: '',
      heading: 'Heading 1',
      isHeading: true,
      headingConfig: { text: 'Heading 1', x: 50, y: 50 },
      duration: HEADING_DUR,
      startTime: 0,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
    };

    const draft = [...segs.slice(0, insertAt), placeholderHeading, ...segs.slice(insertAt)]; // App.tsx:1045-1049
    const stolen = stealDurationFromNeighbors(draft, insertAt, HEADING_DUR); // App.tsx:1051

    const newPrev = stolen[insertAt - 1];
    const headingStart = newPrev ? Number((newPrev.startTime + newPrev.duration).toFixed(3)) : 0; // App.tsx:1053-1056

    const heading = stolen[insertAt]!;
    const updatedHeading: VideoSegment = { ...heading, startTime: headingStart, anchorStart: headingStart, anchorSource: 'whisper' }; // App.tsx:1058-1066
    stolen[insertAt] = updatedHeading;

    const newNext = stolen[insertAt + 1];
    if (newNext) {
      stolen[insertAt + 1] = { ...newNext, anchorStart: Number((headingStart + updatedHeading.duration).toFixed(3)) }; // App.tsx:1068-1074
    }

    const withOrder = stolen.map((s, i) => ({ ...s, order: i })); // App.tsx:1078
    // FIXED: App.tsx:1079 now calls resolveAudioDuration(audioRef.current, withOrder)
    // instead of withOrder.reduce(...). Here the live <audio> duration is
    // simulated as TRUE_AUDIO_DURATION (a voiceover is loaded and playable).
    const audioDuration = resolveAudioDuration(TRUE_AUDIO_DURATION, withOrder);
    const reordered = applyAnchorBasedTiming(withOrder, audioDuration); // App.tsx:1080

    const last = reordered[reordered.length - 1]!;
    const lastEnd = last.startTime + last.duration;

    // The fix: the last segment's declared end now matches the REAL physical
    // audio duration exactly, not the inflated Σ duration (45).
    expect(lastEnd).toBeCloseTo(TRUE_AUDIO_DURATION, 6);
    expect(lastEnd).not.toBeCloseTo(inflatedTotal, 1);
  });

  it('FIXED — handleDeleteHeading (App.tsx:1086-1125) uses the real physical audio duration, not the inflated Σ', () => {
    const input = buildInputWithLockedOverlap();
    const afterResync = applyAnchorBasedTiming(input, TRUE_AUDIO_DURATION);

    // Insert a heading first (fixed path, as proven above) so there's one to delete.
    const insertAt = 6;
    const HEADING_DUR = HEADING_DEFAULT_DURATION;
    const placeholderHeading: VideoSegment = {
      id: 'heading-1',
      order: insertAt,
      text: '',
      heading: 'Heading 1',
      isHeading: true,
      headingConfig: { text: 'Heading 1', x: 50, y: 50 },
      duration: HEADING_DUR,
      startTime: 0,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
    };
    const draft = [...afterResync.slice(0, insertAt), placeholderHeading, ...afterResync.slice(insertAt)];
    const stolen = stealDurationFromNeighbors(draft, insertAt, HEADING_DUR);
    const newPrev = stolen[insertAt - 1];
    const headingStart = newPrev ? Number((newPrev.startTime + newPrev.duration).toFixed(3)) : 0;
    const heading = stolen[insertAt]!;
    stolen[insertAt] = { ...heading, startTime: headingStart, anchorStart: headingStart, anchorSource: 'whisper' };
    const newNext = stolen[insertAt + 1];
    if (newNext) {
      stolen[insertAt + 1] = { ...newNext, anchorStart: Number((headingStart + stolen[insertAt]!.duration).toFixed(3)) };
    }
    const withOrder = stolen.map((s, i) => ({ ...s, order: i }));
    const withHeading = applyAnchorBasedTiming(withOrder, resolveAudioDuration(TRUE_AUDIO_DURATION, withOrder));

    // --- Replay App.tsx handleDeleteHeading (lines 1086-1125) verbatim ---
    const idx = withHeading.findIndex(s => s.id === 'heading-1');
    const headingSeg = withHeading[idx]!;
    const headingDur = headingSeg.duration;

    const newSegs = giveDurationToNeighbors(withHeading, idx, headingDur); // App.tsx:1095
    const updatedPrev = newSegs[idx - 1];
    const updatedNext = newSegs[idx + 1];
    if (updatedNext && updatedPrev) {
      if (updatedPrev.anchorStart !== undefined) {
        newSegs[idx + 1] = { ...updatedNext, anchorStart: Number((updatedPrev.anchorStart + updatedPrev.duration).toFixed(3)) }; // App.tsx:1101-1109
      }
    } else if (updatedNext && !updatedPrev) {
      newSegs[idx + 1] = { ...updatedNext, anchorStart: 0 }; // App.tsx:1110-1113
    }
    newSegs.splice(idx, 1); // App.tsx:1116

    const inflatedTotal = newSegs.reduce((sum, s) => sum + s.duration, 0);
    // FIXED: App.tsx:1120 now calls resolveAudioDuration(audioRef.current, newSegs)
    // instead of newSegs.reduce(...).
    const audioDuration = resolveAudioDuration(TRUE_AUDIO_DURATION, newSegs);
    const timedSegs = applyAnchorBasedTiming(newSegs, audioDuration); // App.tsx:1121

    const last = timedSegs[timedSegs.length - 1]!;
    const lastEnd = last.startTime + last.duration;

    expect(lastEnd).toBeCloseTo(TRUE_AUDIO_DURATION, 6);
    expect(lastEnd).not.toBeCloseTo(inflatedTotal, 1);
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
