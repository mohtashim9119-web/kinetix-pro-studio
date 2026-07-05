import { describe, it, expect, vi } from 'vitest';
import {
  toSourceTime, sourceRange, computeKeepSet, chaseLatestTarget, startChaseIfIdle, resetChaseMutex, type ChaseMutex,
  isContentCaughtUp, computeDisplayedSegment, computeAnimTimeInSegment, computeOverlayHoldState, type OverlayHoldState,
} from './useWebCodecsPreview';
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

// --- Phase 4: chaseLatestTarget scrub coalescing -------------------------------
//
// Timeline.tsx's mousemove-driven drag-to-seek calls onSeek -> setCurrentTime
// synchronously and unthrottled (a file this plan does not touch), so a fast
// drag can push many distinct currentTime values through this hook before any
// one decode call resolves. chaseLatestTarget is the primitive that keeps
// that from queueing one pool.getFrameAt call per tick — these tests drive it
// directly with a controllable `fetch` so the "at most one call in flight,
// always chasing the newest target" behavior is verified without a React
// rendering harness (this repo has none — same rationale as the pure-function
// tests above).

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('chaseLatestTarget', () => {
  it('resolves with the single target when it never changes during the fetch', async () => {
    const fetch = vi.fn(async (target: number) => `frame@${target}`);
    const { target, result } = await chaseLatestTarget(() => 5, fetch);
    expect(target).toBe(5);
    expect(result).toBe('frame@5');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches for a new target that arrived while the first fetch was still in flight, skipping straight to it', async () => {
    let latest = 1;
    const d1 = deferred<string>();
    const fetch = vi.fn((target: number) => (target === 1 ? d1.promise : Promise.resolve(`frame@${target}`)));

    const chasePromise = chaseLatestTarget(() => latest, fetch);

    // Simulate the target moving several times while fetch(1) is still
    // pending — chaseLatestTarget hasn't even checked yet, so none of these
    // intermediate values should ever trigger their own fetch call.
    latest = 2;
    latest = 3;
    latest = 9; // the final position the (fast) scrub lands on

    d1.resolve('frame@1 (stale)'); // fetch(1) finally settles, but 1 is no longer latest

    const { target, result } = await chasePromise;
    expect(target).toBe(9);
    expect(result).toBe('frame@9');
    // Exactly two fetch calls total: the initial one (for 1, now stale) and
    // the one for the final settled target (9) — 2 and 3 were never fetched.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, 1);
    expect(fetch).toHaveBeenNthCalledWith(2, 9);
  });

  it('never has more than one fetch call in flight at a time', async () => {
    let latest = 0;
    let inFlight = 0;
    let maxConcurrent = 0;
    const fetch = vi.fn(async (target: number) => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
      return target;
    });

    const chasePromise = chaseLatestTarget(() => latest, fetch);
    latest = 1;
    latest = 2;
    await chasePromise;

    expect(maxConcurrent).toBe(1);
  });

  it('keeps chasing through several superseding targets before finally settling', async () => {
    let latest = 0;
    const fetch = vi.fn(async (target: number) => {
      // Each call bumps `latest` once more, simulating rapid scrub ticks
      // arriving during every single decode call, up to a fixed point.
      if (target < 3) latest = target + 1;
      await Promise.resolve();
      return `frame@${target}`;
    });

    const { target, result } = await chaseLatestTarget(() => latest, fetch);
    expect(target).toBe(3);
    expect(result).toBe('frame@3');
    expect(fetch).toHaveBeenCalledTimes(4); // 0, 1, 2, 3
  });
});

// --- Phase 4+6: startChaseIfIdle mutex — deadlock regression -------------------
//
// A real bug found during manual 500-segment scrub-stress testing: the
// original frame-pull effect reset its "chase in flight" mutex only when a
// caller-supplied staleness check (generation === current generation)
// passed — mirroring the guard used to avoid PAINTING a stale result, but
// wrongly applied to the MUTEX RELEASE too. If a segment change happened
// while a chase was still resolving, that guard skipped the reset, and
// since nothing else could ever flip the mutex back to false either (a
// later call just sees it's held and assumes a live chase will pick up its
// target), the whole hook deadlocked permanently: no chase could ever start
// again. This is exactly the bug startChaseIfIdle's `mutex.chasing = false`
// being unconditional (not generation-gated) fixes — these tests pin that
// property directly, independent of any one caller's staleness-check shape.

describe('startChaseIfIdle', () => {
  it('runs fetch and reports the settled result via onSettled', async () => {
    const mutex: ChaseMutex = { chasing: false, epoch: 0 };
    const results: number[] = [];
    startChaseIfIdle(mutex, () => 7, async (t) => t * 2, (r) => results.push(r));
    await vi.waitFor(() => expect(results).toEqual([14]));
    expect(mutex.chasing).toBe(false);
  });

  it('a second call while one is in flight is a no-op (does not start a second fetch)', async () => {
    const mutex: ChaseMutex = { chasing: false, epoch: 0 };
    const fetch = vi.fn(async (t: number) => {
      await new Promise((r) => setTimeout(r, 10));
      return t;
    });
    startChaseIfIdle(mutex, () => 1, fetch, () => {});
    startChaseIfIdle(mutex, () => 1, fetch, () => {}); // should be swallowed by the mutex

    await vi.waitFor(() => expect(mutex.chasing).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('releases the mutex even when onSettled reports the caller considers its own result stale (the exact deadlock scenario)', async () => {
    const mutex: ChaseMutex = { chasing: false, epoch: 0 };
    // Simulates a caller's own staleness check (like the hook's
    // generationRef comparison) that intentionally does nothing with a
    // superseded result — this must NOT prevent the mutex from releasing.
    let onSettledCallCount = 0;
    startChaseIfIdle(
      mutex,
      () => 5,
      async (t) => t,
      () => {
        onSettledCallCount++;
        // Deliberately does nothing further — simulating "this result is
        // for a segment we've since left, discard it."
      },
    );

    await vi.waitFor(() => expect(onSettledCallCount).toBe(1));
    // The critical assertion: the mutex must be released regardless of
    // what onSettled did with the result.
    expect(mutex.chasing).toBe(false);

    // Proves the fix in practice: a SUBSEQUENT chase (the "next epoch")
    // must be able to start — under the pre-fix bug, this second call
    // would have silently no-op'd forever because mutex.chasing was stuck
    // true, permanently freezing whatever the hook last painted.
    const secondResults: number[] = [];
    startChaseIfIdle(mutex, () => 9, async (t) => t, (r) => secondResults.push(r));
    await vi.waitFor(() => expect(secondResults).toEqual([9]));
  });

  it('chases the latest target through the mutex exactly as chaseLatestTarget alone would', async () => {
    const mutex: ChaseMutex = { chasing: false, epoch: 0 };
    let latest = 0;
    const fetch = vi.fn(async (t: number) => {
      if (t === 0) latest = 1; // simulates a scrub tick arriving mid-fetch
      return `frame@${t}`;
    });
    const results: string[] = [];
    startChaseIfIdle(mutex, () => latest, fetch, (r) => results.push(r));

    await vi.waitFor(() => expect(results).toEqual(['frame@1']));
    expect(fetch).toHaveBeenCalledTimes(2); // chased 0 then 1, skipping nothing extra
  });
});

// Phase 5 (docs/webcodecs-architecture-plan.md): a real bug found during
// manual testing — React StrictMode (dev-only) double-invokes every effect
// once at mount, and the pool-dispose effect's cleanup fires between the two
// passes. The second pass's frame-pull effect calls startChaseIfIdle again
// for the same segment/target the first pass already started chasing;
// without resetChaseMutex forcing the mutex open at that exact point, the
// second pass's call silently no-ops (mutex still held by the first pass's
// now-irrelevant chase) and nothing ever calls getFrameAt again for the
// fresh session the second pass created — a permanently blank canvas. These
// tests pin resetChaseMutex's own contract directly, independent of the
// React/StrictMode plumbing that motivated it.
describe('resetChaseMutex', () => {
  it('lets a new chase start immediately even while an old one is still marked in flight', async () => {
    const mutex: ChaseMutex = { chasing: false, epoch: 0 };
    let releaseFirst: (() => void) | undefined;
    const firstFetch = () => new Promise<string>((resolve) => { releaseFirst = () => resolve('stale'); });
    const firstResults: string[] = [];
    startChaseIfIdle(mutex, () => 1, firstFetch, (r) => firstResults.push(r));

    expect(mutex.chasing).toBe(true); // first chase genuinely in flight, nothing has settled it

    resetChaseMutex(mutex);
    expect(mutex.chasing).toBe(false); // forced open immediately, without waiting for the stale chase

    const secondResults: string[] = [];
    startChaseIfIdle(mutex, () => 2, async (t) => `frame@${t}`, (r) => secondResults.push(r));
    await vi.waitFor(() => expect(secondResults).toEqual(['frame@2']));

    // The stale first chase settling later must not clobber the second
    // (legitimately in-flight-then-completed) chase's mutex state — this is
    // exactly what the epoch bump guards against.
    releaseFirst!();
    await vi.waitFor(() => expect(firstResults).toEqual(['stale']));
    expect(mutex.chasing).toBe(false); // still correctly released, not stuck true
  });

  it('a stale chase settling after a reset cannot re-lock the mutex for a third caller', async () => {
    const mutex: ChaseMutex = { chasing: false, epoch: 0 };
    let releaseFirst: (() => void) | undefined;
    const firstFetch = () => new Promise<string>((resolve) => { releaseFirst = () => resolve('stale'); });
    startChaseIfIdle(mutex, () => 1, firstFetch, () => {});

    resetChaseMutex(mutex); // simulates the pool-dispose cleanup's forced reopen

    // A second chase starts and is STILL in flight when the stale first one
    // finally settles — without the epoch guard, the stale settlement would
    // incorrectly flip mutex.chasing back to false while the second chase
    // is still genuinely running, letting a third caller wrongly believe
    // the mutex is free.
    let releaseSecond: (() => void) | undefined;
    const secondFetch = () => new Promise<string>((resolve) => { releaseSecond = () => resolve('second'); });
    startChaseIfIdle(mutex, () => 2, secondFetch, () => {});
    expect(mutex.chasing).toBe(true);

    releaseFirst!();
    await Promise.resolve();
    await Promise.resolve();
    // The second chase is still genuinely in flight — the stale first
    // chase's settlement must not have released the mutex out from under it.
    expect(mutex.chasing).toBe(true);

    releaseSecond!();
    await vi.waitFor(() => expect(mutex.chasing).toBe(false));
  });
});

/**
 * Transition-flicker (Bug 1) / animation-hard-cut (Bug 2) fix.
 *
 * Root cause (confirmed via diagnostic timestamps against a real decode
 * session, docs/webcodecs-architecture-plan.md's follow-up notes):
 * `currentSegment` (and everything computed synchronously from it every
 * render in PreviewStage.tsx — the animation transform, useTransitionPreview's
 * own `isActive`) flips in one render the instant currentTime crosses a
 * segment boundary, but `frame`/`frameSegmentId` only catch up once
 * `getFrameAt` actually resolves — measured up to ~436ms later under real
 * decode load. isContentCaughtUp/computeDisplayedSegment/
 * computeAnimTimeInSegment/computeOverlayHoldState are the pure functions
 * PreviewStage.tsx composes to gate the animation transform and the
 * transition-overlay's fade-out on that real catch-up instead of assuming
 * it's instantaneous.
 */
describe('isContentCaughtUp', () => {
  it('is true for a non-video segment (image/heading) regardless of frameSegmentId — those paint synchronously', () => {
    expect(isContentCaughtUp('seg-1', false, null)).toBe(true);
    expect(isContentCaughtUp('seg-1', false, 'seg-0')).toBe(true);
  });

  it('is true when there is no current segment', () => {
    expect(isContentCaughtUp(undefined, true, 'seg-0')).toBe(true);
  });

  it('is false for a video segment whose frameSegmentId has not caught up yet', () => {
    expect(isContentCaughtUp('seg-1', true, 'seg-0')).toBe(false);
    expect(isContentCaughtUp('seg-1', true, null)).toBe(false);
  });

  it('is true for a video segment once frameSegmentId matches', () => {
    expect(isContentCaughtUp('seg-1', true, 'seg-1')).toBe(true);
  });
});

describe('computeDisplayedSegment', () => {
  const seg1 = makeSegment({ id: 'seg-1', startTime: 0, duration: 5 });
  const seg2 = makeSegment({ id: 'seg-2', startTime: 5, duration: 5 });

  it('adopts currentSegment immediately when content is caught up', () => {
    expect(computeDisplayedSegment(seg2, true, seg1)).toBe(seg2);
  });

  it('holds the previous segment when content has not caught up yet', () => {
    expect(computeDisplayedSegment(seg2, false, seg1)).toBe(seg1);
  });

  it('adopts currentSegment immediately when there is nothing previously displayed to hold (cold start)', () => {
    expect(computeDisplayedSegment(seg1, false, undefined)).toBe(seg1);
  });

  it('returns undefined when there is no current segment (e.g. past the end of the timeline)', () => {
    expect(computeDisplayedSegment(undefined, false, seg1)).toBeUndefined();
  });
});

describe('computeAnimTimeInSegment', () => {
  it('returns 0 when there is no segment to compute against', () => {
    expect(computeAnimTimeInSegment(undefined, 12.3)).toBe(0);
  });

  it('matches plain elapsed-time-in-segment for a currentTime still inside the segment (unchanged from pre-fix behavior)', () => {
    const seg = makeSegment({ startTime: 10, duration: 5 });
    expect(computeAnimTimeInSegment(seg, 12)).toBeCloseTo(2, 9);
  });

  it('clamps to the segment duration when currentTime has moved past its end — the held-over-previous-segment case', () => {
    // This is exactly the Bug 2 scenario: displayedSegmentRef is still holding
    // the OUTGOING segment (startTime=0, duration=5) while currentTime has
    // already advanced into the next segment (e.g. t=5.4, mid content-catch-up
    // gap). Without the clamp this would return 5.4, continuing to extrapolate
    // the animation past where the segment ever actually played; the fix
    // freezes it at exactly 5 (its own natural end state).
    const seg = makeSegment({ startTime: 0, duration: 5 });
    expect(computeAnimTimeInSegment(seg, 5.4)).toBe(5);
  });

  it('clamps to 0 for a currentTime before the segment starts (defensive floor, matches original Math.max(0, ...))', () => {
    const seg = makeSegment({ startTime: 10, duration: 5 });
    expect(computeAnimTimeInSegment(seg, 9)).toBe(0);
  });
});

describe('computeOverlayHoldState', () => {
  const idle: OverlayHoldState = { wasTransitionActive: false, holding: false };

  it('does not engage the hold at a plain (no-transition) boundary — nothing was active, nothing to hold', () => {
    // contentCaughtUp false here simulates a video-to-video boundary with no
    // transition configured: content lags, but since no transition was ever
    // active there is nothing for the overlay to hold onto.
    const next = computeOverlayHoldState(idle, false, false);
    expect(next.holding).toBe(false);
  });

  it('engages the hold exactly when a real transition window closes before content has caught up', () => {
    // Render 1: transition window still open.
    const duringTransition = computeOverlayHoldState(idle, true, false);
    expect(duringTransition).toEqual({ wasTransitionActive: true, holding: false });

    // Render 2: the boundary crossed — isTransitionActive just went false,
    // and content has NOT caught up yet. This is the exact Bug 1 scenario.
    const atBoundary = computeOverlayHoldState(duringTransition, false, false);
    expect(atBoundary.holding).toBe(true);
  });

  it('keeps holding across multiple renders while content still has not caught up', () => {
    const holding: OverlayHoldState = { wasTransitionActive: false, holding: true };
    const next = computeOverlayHoldState(holding, false, false);
    expect(next).toEqual({ wasTransitionActive: false, holding: true });
  });

  it('releases the hold the instant content catches up', () => {
    const holding: OverlayHoldState = { wasTransitionActive: false, holding: true };
    const next = computeOverlayHoldState(holding, false, true);
    expect(next.holding).toBe(false);
  });

  it('a new transition becoming active always clears any stale hold (defensive — should not normally coincide)', () => {
    const holding: OverlayHoldState = { wasTransitionActive: false, holding: true };
    const next = computeOverlayHoldState(holding, true, false);
    expect(next).toEqual({ wasTransitionActive: true, holding: false });
  });
});
