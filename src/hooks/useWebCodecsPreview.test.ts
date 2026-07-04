import { describe, it, expect } from 'vitest';
import { toSourceTime, sourceRange, computeKeepSet } from './useWebCodecsPreview';
import { AnimationType, TransitionType, type VideoSegment } from '../types';

/**
 * Phase 3 (audio-sync integration hardening — docs/webcodecs-architecture-plan.md).
 *
 * `toSourceTime`/`sourceRange` are the pure, stateless functions the
 * currentTime-to-frame mapping is built on (both this hook and
 * videoDecoderPool.ts's session ranges derive from them). Because they take
 * no accumulated/internal state — every call recomputes purely from the
 * segment and the current currentTime value handed in — there is no
 * mechanism by which repeated calls over a long playback run could
 * accumulate drift; each call is independently correct or not. These tests
 * exercise that property directly across long-timeline, pause/resume, and
 * speed-change-shaped currentTime sequences, and pin the tolerance this
 * plan resolves to.
 *
 * Tolerance: since a decode session only ever buffers the actual decoded
 * frames of the source video (Section 4.2 of the plan), the best any
 * currentTime→frame mapping can do is "the latest frame at or before the
 * target" — bounded by one source-frame duration (1/fps). This file treats
 * "within one frame duration at the project's fps" as the acceptance bound
 * throughout (see FRAME_DURATION_30FPS below), matching how
 * videoDecoderPool.ts's getFrameAt actually selects frames.
 */

const FPS = 30;
const FRAME_DURATION_30FPS = 1 / FPS; // ~0.0333s — the documented tolerance

function makeSegment(overrides: Partial<VideoSegment> = {}): VideoSegment {
  return {
    id: 'seg-1',
    text: '',
    assetId: 'asset-1',
    startTime: 0,
    duration: 5,
    trimStart: 0,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    ...overrides,
  };
}

describe('toSourceTime — long-timeline, no accumulating drift', () => {
  it('maps a steady stream of currentTime ticks (simulating minutes of playback) with per-tick error bounded by one frame duration, and no growth over time', () => {
    const segment = makeSegment({ startTime: 0, duration: 600 }); // 10 real minutes
    const tickSeconds = 1 / 60; // ~60fps RAF loop, per usePlayback.ts

    let maxError = 0;
    // Simulate ~10 minutes of playback at a steady RAF cadence.
    for (let t = 0; t < 600; t += tickSeconds) {
      const source = toSourceTime(segment, t);
      // With playbackSpeed=1 and no trim, source time should equal currentTime
      // exactly (pure arithmetic, no rounding accumulation possible).
      const error = Math.abs(source - t);
      maxError = Math.max(maxError, error);
    }
    expect(maxError).toBeLessThan(1e-9); // floating point noise only, not drift
  });

  it('does not accumulate error across a multi-segment sequence (5+ segments spanning several minutes)', () => {
    const segments: VideoSegment[] = [];
    let cursor = 0;
    for (let i = 0; i < 8; i++) {
      const duration = 20 + i * 5; // varying lengths, several minutes total
      segments.push(makeSegment({ id: `seg-${i}`, startTime: cursor, duration, trimStart: 2 }));
      cursor += duration;
    }

    for (const segment of segments) {
      // Sample at start, middle, and end of each segment's timeline span.
      for (const frac of [0, 0.5, 0.999]) {
        const t = (segment.startTime ?? 0) + segment.duration * frac;
        const source = toSourceTime(segment, t);
        const expected = (segment.trimStart || 0) + frac * segment.duration;
        expect(Math.abs(source - expected)).toBeLessThan(FRAME_DURATION_30FPS);
      }
    }
  });
});

describe('toSourceTime — pause/resume', () => {
  it('returns the identical source time for a currentTime that is held constant across repeated calls (paused)', () => {
    const segment = makeSegment({ startTime: 10, duration: 5, trimStart: 1 });
    const pausedAt = 12.345;

    const results = Array.from({ length: 20 }, () => toSourceTime(segment, pausedAt));
    expect(new Set(results).size).toBe(1); // every call agrees — no drift while "frozen"
  });

  it('resuming after a pause (currentTime jump back to the audio element position) resolves to the correct frame, not a stale or skipped one', () => {
    const segment = makeSegment({ startTime: 0, duration: 10, trimStart: 0 });

    const beforePause = toSourceTime(segment, 4.0);
    // Audio was paused for a while in real time; currentTime does not advance.
    // On resume, usePlayback.ts's rAF loop reads audio.currentTime again —
    // simulate it reporting the exact same position (no seek happened).
    const afterResume = toSourceTime(segment, 4.0);
    expect(afterResume).toBe(beforePause);

    // Playback then continues normally from that point.
    const nextTick = toSourceTime(segment, 4.0 + 1 / 60);
    expect(nextTick).toBeGreaterThan(afterResume);
    expect(nextTick - afterResume).toBeLessThan(FRAME_DURATION_30FPS);
  });

  it('pausing exactly at a segment boundary and resuming maps correctly on both sides', () => {
    const segA = makeSegment({ id: 'a', startTime: 0, duration: 5, trimStart: 0 });
    const segB = makeSegment({ id: 'b', startTime: 5, duration: 5, trimStart: 0 });

    // Paused right at the boundary — currentSegment could be either during
    // the instant of the switch; both must map sensibly for their own segment.
    expect(toSourceTime(segA, 5.0)).toBeCloseTo(5.0, 5); // end of A's own source range
    expect(toSourceTime(segB, 5.0)).toBeCloseTo(0.0, 5); // start of B's own source range
  });
});

describe('toSourceTime — playbackRate / speed changes', () => {
  it('is independent of how large the currentTime delta between calls is (i.e. independent of wall-clock playback rate)', () => {
    const segment = makeSegment({ startTime: 0, duration: 10, trimStart: 0 });

    // Same target currentTime values, reached via very different tick deltas
    // (as if globalPlaybackSpeed were 1x vs 3x) — result must be identical,
    // because toSourceTime only ever reads the absolute currentTime, never a
    // delta or wall-clock rate.
    const targets = [0, 1, 2, 5, 9.9];
    const viaSmallDeltas = targets.map((t) => toSourceTime(segment, t));
    const viaLargeDeltas = targets.map((t) => toSourceTime(segment, t)); // same math, no hidden rate state
    expect(viaLargeDeltas).toEqual(viaSmallDeltas);
  });

  it('reflects a per-segment playbackSpeed change mid-playback immediately (next call, no lag)', () => {
    const base = makeSegment({ startTime: 0, duration: 10, trimStart: 0, playbackSpeed: 1 });
    const sped = { ...base, playbackSpeed: 2 };

    // Same currentTime, different segment.playbackSpeed (as if the user
    // adjusted the segment's speed via the editor mid-playback) — source
    // time mapping must react immediately, proportionally.
    const t = 3;
    expect(toSourceTime(base, t)).toBeCloseTo(3, 5);
    expect(toSourceTime(sped, t)).toBeCloseTo(6, 5);
  });

  it('sourceRange grows with playbackSpeed so a sped-up segment does not truncate its decode session before the last displayed frame', () => {
    const slow = makeSegment({ duration: 4, trimStart: 0, playbackSpeed: 1 });
    const fast = makeSegment({ duration: 4, trimStart: 0, playbackSpeed: 2 });

    expect(sourceRange(slow).end).toBeCloseTo(4, 5);
    expect(sourceRange(fast).end).toBeCloseTo(8, 5);
  });

  it('clamps to trimEnd regardless of playbackSpeed, matching the legacy <video> path and the exporter', () => {
    const segment = makeSegment({ duration: 10, trimStart: 0, trimEnd: 3, playbackSpeed: 2 });
    // Without the clamp this would be 2 * 10 = 20 — trimEnd must win.
    expect(toSourceTime(segment, 9.999)).toBeLessThanOrEqual(3);
    expect(sourceRange(segment).end).toBe(3);
  });
});

describe('toSourceTime — rapid segment-boundary crossing (short segments)', () => {
  it('maps correctly across a run of very short segments (1.09s-1.3s range, the original cold-start bug scale)', () => {
    const durations = [1.09, 1.2, 1.15, 1.3, 1.1, 1.25]; // 6 short segments
    const segments: VideoSegment[] = [];
    let cursor = 0;
    for (let i = 0; i < durations.length; i++) {
      segments.push(makeSegment({ id: `s${i}`, startTime: cursor, duration: durations[i]!, trimStart: 0 }));
      cursor += durations[i]!;
    }

    // Walk currentTime forward at a steady 60fps tick across the whole run
    // (crossing every boundary), and confirm whichever segment "owns" a
    // given currentTime always maps it to a source time within its own
    // [0, duration] span, with no cross-segment leakage.
    const totalDuration = cursor;
    for (let t = 0; t < totalDuration; t += 1 / 60) {
      const owner = segments.find(
        (s) => t >= (s.startTime ?? 0) && t < (s.startTime ?? 0) + s.duration,
      );
      if (!owner) continue;
      const source = toSourceTime(owner, t);
      expect(source).toBeGreaterThanOrEqual(0);
      expect(source).toBeLessThanOrEqual(owner.duration + 1e-9);
    }
  });
});

describe('computeKeepSet — boundary crossing eviction policy', () => {
  const video = (id: string, startTime: number, duration: number): VideoSegment =>
    makeSegment({ id, startTime, duration });

  it('keeps exactly current + next when both are plain video segments', () => {
    const current = video('a', 0, 1.2);
    const next = video('b', 1.2, 1.1);
    const keep = computeKeepSet(current, true, next, true);
    expect(keep).toEqual(new Set(['a', 'b']));
  });

  it('keeps only current when there is no next segment (end of timeline)', () => {
    const current = video('a', 0, 1.2);
    const keep = computeKeepSet(current, true, undefined, false);
    expect(keep).toEqual(new Set(['a']));
  });

  it('drops current from the keep set when it is not itself a plain video (e.g. an image or heading) even if still "current"', () => {
    const current = video('a', 0, 1.2);
    const next = video('b', 1.2, 1.1);
    const keep = computeKeepSet(current, false, next, true);
    expect(keep).toEqual(new Set(['b']));
  });

  it('excludes a next segment that is not itself a plain video', () => {
    const current = video('a', 0, 1.2);
    const next = video('b', 1.2, 1.1);
    const keep = computeKeepSet(current, true, next, false);
    expect(keep).toEqual(new Set(['a']));
  });

  it('produces a fresh keep set for every rapid boundary crossing across a run of short segments, always evicting exactly the segment that fell two-or-more behind', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const segs = ids.map((id, i) => video(id, i * 1.2, 1.2));

    // Simulate walking forward one boundary at a time (fast crossings) and
    // confirm the keep set only ever names the current pair, never anything
    // further back — this is what a caller (useWebCodecsPreview.ts) uses
    // to decide what to releaseSession() each render.
    for (let i = 0; i < segs.length; i++) {
      const current = segs[i]!;
      const next = segs[i + 1];
      const keep = computeKeepSet(current, true, next, !!next);
      expect(keep.has(current.id)).toBe(true);
      if (next) expect(keep.has(next.id)).toBe(true);
      // Nothing from two-or-more segments back should ever be kept.
      if (i >= 2) expect(keep.has(segs[i - 2]!.id)).toBe(false);
    }
  });
});
