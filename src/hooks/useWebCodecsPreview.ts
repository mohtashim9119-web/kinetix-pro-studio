/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The replacement for the dual-slot <video> orchestration in PreviewStage.tsx
 * (Section 3.2 of docs/webcodecs-architecture-plan.md). Given segments,
 * assets, the active segment, and currentTime — read from the existing,
 * unmodified audio clock (usePlayback.ts) — returns the VideoFrame to paint
 * for the active segment's video.
 *
 * `currentSegment` is accepted directly rather than re-derived from
 * segments+currentTime: PreviewStage.tsx (and, above it, App.tsx) already
 * computes it via useMemo, including the isResizingRef freeze-during-drag
 * behavior (see App.tsx's currentSegment memo). Re-deriving it here with a
 * plain `find` would silently diverge from that during a timeline
 * resize-drag. This is a deliberate, documented deviation from the plan's
 * literal "given segments, assets, currentTime" phrasing — see the
 * WebCodecs progress tracker for the note.
 *
 * Phase 1 (single segment) + Phase 2 (multi-segment, decode-ahead, boundary
 * crossing) scope only: no transitions/overlays/filters/animations baked
 * into the frame here — that's Phase 5, applied by the caller on top of the
 * returned frame via PreviewCanvas.tsx.
 *
 * `enabled` gates ALL work in this hook, including decode session creation —
 * when false (dev toggle off, or capability unsupported), this hook must be
 * inert even though it's still mounted and called on every render, so the
 * new path never activates in the background for a real user.
 *
 * Phase 4+6 (combined, docs/webcodecs-architecture-plan.md): this hook no
 * longer hard-releases every session outside {current, next} the moment a
 * boundary crosses — it marks {current, next} as protected
 * (pool.setProtectedIds) and lets videoDecoderPool.ts's own LRU/budget
 * enforcement decide what else survives (Section 4's windowed model).
 * Two things change as a result:
 *  1. The current segment's initial decode window is seeded at the actual
 *     playhead position (toSourceTime at the moment currentSegment changes),
 *     not the segment's own start — avoids a wasted decode-from-start pass
 *     immediately superseded by a reset when a cold scrub lands mid-segment.
 *  2. The frame-pull effect below coalesces rapid currentTime ticks (a fast
 *     drag-scrub can fire this hook many times per second, since
 *     Timeline.tsx's mousemove handler calls onSeek — and therefore
 *     setCurrentTime — synchronously and unthrottled, a file this plan does
 *     not touch) into a "latest wins" chase loop: at most one
 *     pool.getFrameAt call is ever in flight per session, and if the target
 *     moves again before it resolves, the loop re-issues for the newest
 *     target instead of racing/queueing one call per tick. This is what
 *     "deprioritize decode work for positions the playhead has already
 *     moved past" means in practice — a real VideoDecoder decode() call
 *     can't be cancelled once issued, so this coalescing is what prevents
 *     work from piling up for intermediate scrub positions, rather than
 *     trying to abort browser-side decode work directly.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset, VideoSegment } from '../types';
import { VideoDecoderPool } from '../services/videoDecoderPool';

interface UseWebCodecsPreviewParams {
  segments: VideoSegment[];
  assets: Asset[];
  currentSegment: VideoSegment | undefined;
  currentTime: number;
  enabled: boolean;
}

export interface UseWebCodecsPreviewResult {
  /** Frame to paint for the current segment's video, or null when the
   *  current segment isn't a plain video asset, or no frame is ready yet. */
  frame: VideoFrame | null;
  /** True when the current segment is a (non-heading) video asset — callers
   *  use this to decide whether to mount PreviewCanvas at all. */
  isVideoSegment: boolean;
  /** Non-fatal demux/decode error for the current segment's session, if any. */
  error: string | null;
  /**
   * The segment id `frame` actually belongs to — i.e. the last segment for
   * which a real (non-null) decoded frame has been committed to state. This
   * lags `currentSegment.id` by however long `getFrameAt` takes to resolve
   * after a boundary crossing (measured up to ~436ms under real decode load
   * — see the transition-flicker/animation-hard-cut investigation in
   * docs/webcodecs-architecture-plan.md's follow-up notes). Callers that
   * need to know "has the visible content actually caught up to
   * currentSegment yet" (PreviewStage.tsx's transition-overlay hold and
   * animation-transform freeze) compare this against `currentSegment.id`
   * directly, rather than assuming the swap is instantaneous.
   */
  frameSegmentId: string | null;
}

/**
 * Maps a segment-local playhead position to the source video's own time,
 * honoring trimStart/trimEnd/playbackSpeed — mirrors the identical math in
 * PreviewStage.tsx's legacy seek effect and frameRenderer.ts's export path,
 * so the two video paths cannot diverge in what "the right frame" means.
 *
 * Phase 3 note (audio-sync hardening — docs/webcodecs-architecture-plan.md):
 * this function takes `currentTime` verbatim from the caller and does NOT
 * multiply by `globalPlaybackSpeed`. That's intentional, not a gap — the
 * legacy path's `activeEl.playbackRate = segment.playbackSpeed *
 * globalPlaybackSpeed` (PreviewStage.tsx) exists only because a `<video>`
 * element runs its own internal clock and that clock's *real-time* advance
 * rate has to be told to match how fast `currentTime` itself is advancing
 * (which `usePlayback.ts` already governs via `audioRef.current.playbackRate
 * = globalPlaybackSpeed`). This hook has no internal clock to keep in step:
 * every call is a pull ("what frame corresponds to this currentTime"), and
 * `currentTime` handed in already reflects whatever real-time pace the audio
 * element is advancing at. So a `globalPlaybackSpeed` change mid-playback
 * needs no reinterpretation here — only `segment.playbackSpeed` (the
 * per-segment source-time stretch baked into how a segment maps its own
 * span to source time) belongs in this formula, exactly as before. Verified
 * with the pause/resume/rate-change cases in useWebCodecsPreview.test.ts.
 */
export function toSourceTime(segment: VideoSegment, currentTime: number): number {
  const segmentProgress = currentTime - (segment.startTime ?? 0);
  const rawTime = (segment.trimStart || 0) + segmentProgress * (segment.playbackSpeed || 1);
  const videoTime = segment.trimEnd !== undefined ? Math.min(rawTime, segment.trimEnd) : rawTime;
  return Math.max(0, videoTime);
}

/** Source-time range [start, end] a segment's decode session must cover —
 *  end accounts for playbackSpeed the same way toSourceTime does, so a
 *  sped-up segment's session isn't truncated before its last displayed frame. */
export function sourceRange(segment: VideoSegment): { start: number; end: number } {
  const start = segment.trimStart || 0;
  const speed = segment.playbackSpeed || 1;
  const end = segment.trimEnd ?? start + segment.duration * speed;
  return { start, end };
}

function isPlainVideoAsset(segment: VideoSegment | undefined, asset: Asset | undefined): boolean {
  return !!(segment && !segment.isHeading && asset?.type === 'video');
}

/**
 * Phase 4 scrub-coalescing primitive (docs/webcodecs-architecture-plan.md).
 * Repeatedly calls `fetch(target)` for whatever `getLatestTarget()` currently
 * returns, resolving only once a call's result corresponds to the target
 * that was STILL the latest one requested by the time that call resolved —
 * every intermediate target requested while a call was in flight is skipped
 * rather than separately fetched. This is what keeps a fast drag-scrub (which
 * can update the requested target many times per second, since
 * Timeline.tsx's mousemove handler drives currentTime synchronously and
 * unthrottled) from queueing one decode/getFrameAt call per tick: at most
 * one `fetch` call is ever in flight, always chasing the newest target.
 *
 * Extracted as a pure, dependency-free function (no VideoDecoderPool/React
 * import) so it's directly unit-testable without a hook-rendering harness —
 * this repo has no jsdom/@testing-library/react (see Phase 3's identical
 * rationale for computeKeepSet/toSourceTime above).
 */
export async function chaseLatestTarget<T>(
  getLatestTarget: () => number,
  fetch: (target: number) => Promise<T>,
): Promise<{ target: number; result: T }> {
  for (;;) {
    const target = getLatestTarget();
    const result = await fetch(target);
    if (getLatestTarget() === target) return { target, result };
    // The target moved again while `fetch` was in flight — loop and chase
    // the new one instead of settling on a now-stale result.
  }
}

/** Mutable "is a chase currently running" flag — deliberately a plain
 *  object, not a boolean, so callers can hold a stable reference (e.g. a
 *  React ref's `.current` container) across renders.
 *
 *  `epoch` supports `resetChaseMutex` (Phase 5, docs/webcodecs-architecture-plan.md)
 *  — see that function's doc for why a forced external reset needs its own
 *  guard distinct from the chase-completion release below. */
export interface ChaseMutex {
  chasing: boolean;
  epoch: number;
}

/**
 * Starts a chaseLatestTarget() run only if one isn't already in flight
 * (`mutex.chasing`) — this is the "at most one decode call in flight per
 * segment" guarantee described above chaseLatestTarget, factored out on its
 * own specifically so the mutex's release timing is directly unit-testable.
 *
 * A real deadlock was found here during Phase 4+6 manual 500-segment
 * scrub-stress testing: an earlier version of the caller (the frame-pull
 * effect in useWebCodecsPreview) reset `mutex.chasing = false` only when a
 * caller-supplied "is this still the current epoch" check passed — the
 * intent was to mirror the staleness guard used elsewhere for painting
 * (skip a stale RESULT), but applying that same guard to the MUTEX RELEASE
 * was wrong: `mutex.chasing` is a single lock shared across every epoch this
 * function is ever called for, and the `if (mutex.chasing) return` guard
 * below already guarantees at most one chase is ever in flight — so
 * whichever chase's promise is currently settling is unconditionally the
 * only one that was running, regardless of whether its "epoch" was since
 * superseded. Guarding the release let a superseded chase skip resetting
 * the mutex, and since nothing else was ever going to flip it back either
 * (a later call just sees `chasing === true` and assumes a live chase will
 * pick up its target), the whole thing deadlocked permanently — no chase
 * could ever start again for the rest of the hook instance's lifetime,
 * which manifested as a WebCodecs preview canvas that went persistently
 * black mid-playback under heavy load and never recovered, with no thrown
 * error (getFrameAt was simply never being called again). `onSettled` is
 * exactly where a caller should apply its OWN staleness check before acting
 * on `result` — that guard belongs there, not on the mutex release.
 */
export function startChaseIfIdle<T>(
  mutex: ChaseMutex,
  getLatestTarget: () => number,
  fetch: (target: number) => Promise<T>,
  onSettled: (result: T) => void,
): void {
  if (mutex.chasing) return;
  mutex.chasing = true;
  // Captured so this chase's own release can't fire after a `resetChaseMutex`
  // call has already reopened the mutex for a newer chase — see that
  // function's doc. In the common case (no reset happens) `mutex.epoch`
  // never changes, so this check always passes and release stays
  // effectively unconditional, exactly as the note above describes.
  const epoch = mutex.epoch;
  void chaseLatestTarget(getLatestTarget, fetch)
    .then(({ result }) => onSettled(result))
    .finally(() => {
      if (mutex.epoch === epoch) mutex.chasing = false;
    });
}

/**
 * Forces the mutex open and bumps its epoch — for a caller that knows the
 * chase currently (or about to be) in flight is chasing state that's about
 * to become invalid and wants a *new* chase to be able to start immediately
 * instead of waiting for the stale one's own (possibly slow, or never-firing
 * in the exact same way) settlement.
 *
 * Phase 5 fix (docs/webcodecs-architecture-plan.md): React StrictMode
 * (dev-only) double-invokes every effect once at mount — the pool-dispose
 * effect's cleanup (see useWebCodecsPreview) fires between the two passes,
 * disposing and effectively recreating every decode session. The frame-pull
 * effect's SECOND pass calls `startChaseIfIdle` again for the exact same
 * segment/target as the first — but `chaseMutexRef` is a ref, shared across
 * both passes, and the first pass's chase (now chasing a session that's
 * about to be/already closed) is very likely still `chasing === true` at
 * that moment, so the second pass's call would silently no-op (per the
 * `if (mutex.chasing) return` guard) and never call `getFrameAt` again for
 * the fresh, valid session the second pass's decode-ahead effect just
 * created. Since the first pass's chase is fetching the *same* target as
 * the second pass would (nothing moved), `chaseLatestTarget`'s own loop
 * exits after that one fetch instead of re-chasing — so without this reset,
 * nothing would ever call `getFrameAt` again for a segment landed on at
 * mount while paused, producing a permanently blank canvas. Calling this
 * from the pool-dispose cleanup, right when the old sessions are actually
 * invalidated, lets the very next `startChaseIfIdle` call proceed
 * immediately instead of silently dropping its request.
 *
 * Bumping `epoch` (not just clearing `chasing`) is what keeps this safe:
 * without it, the stale first-pass chase's own eventual `.finally()` would
 * unconditionally clear `chasing` again later — including while a second,
 * legitimate chase started by this reset is still genuinely in flight —
 * which would let a third caller believe the mutex was free and start a
 * second concurrent chase. Bumping the epoch here means that stale
 * `.finally()` finds `mutex.epoch !== epoch` (its own captured value) and
 * skips clearing `chasing`, preserving the "at most one chase in flight"
 * invariant `startChaseIfIdle` depends on.
 */
export function resetChaseMutex(mutex: ChaseMutex): void {
  mutex.chasing = false;
  mutex.epoch++;
}

/**
 * The set of segment ids whose decode sessions should survive a given
 * render (Section 3.5 boundary crossing) — exactly the current segment and
 * the next one, when each is itself a plain video segment. Extracted as a
 * pure function (used by the eviction effect below) so boundary-crossing
 * behavior — including rapid, short-segment sequences — is directly
 * unit-testable without a React rendering harness.
 */
export function computeKeepSet(
  currentSegment: VideoSegment | undefined,
  isVideoSegment: boolean,
  nextSegment: VideoSegment | undefined,
  nextIsVideo: boolean,
): Set<string> {
  const keep = new Set<string>();
  if (currentSegment && isVideoSegment) keep.add(currentSegment.id);
  if (nextSegment && nextIsVideo) keep.add(nextSegment.id);
  return keep;
}

/**
 * Bug 1 (transition flicker) / Bug 2 (animation hard-cut) fix — the core
 * predicate both fixes gate on: has the WebCodecs live layer actually
 * caught up to currentSegment yet, or is it still painting a previous
 * segment's last frame? Non-video segments (image/heading) paint
 * synchronously in the same render as a segment change, so they're always
 * considered caught up.
 *
 * Extracted as a pure function — same testability rationale as
 * computeKeepSet above — so PreviewStage.tsx's transition-overlay hold and
 * animation-transform freeze (both downstream of this) are directly
 * unit-testable without a React rendering harness.
 */
export function isContentCaughtUp(
  currentSegmentId: string | undefined,
  isVideoSegment: boolean,
  frameSegmentId: string | null,
): boolean {
  return !currentSegmentId || !isVideoSegment || frameSegmentId === currentSegmentId;
}

/**
 * Which segment's content (and therefore which segment's own animation
 * transform) is actually on screen right now — Bug 2's fix. Held at
 * `previousDisplayed` for as long as `contentCaughtUp` is false, so a
 * caller computing an animation transform from the returned segment keeps
 * using the OUTGOING segment's own values (frozen at its natural end state,
 * via computeAnimTimeInSegment's clamp below) instead of snapping to the
 * new segment's start while its content is still lingering on screen.
 * Adopts `currentSegment` immediately once caught up, or immediately when
 * there's nothing meaningful to hold yet (no previousDisplayed — e.g. the
 * very first segment ever played, before any frame has arrived).
 */
export function computeDisplayedSegment(
  currentSegment: VideoSegment | undefined,
  contentCaughtUp: boolean,
  previousDisplayed: VideoSegment | undefined,
): VideoSegment | undefined {
  if (!currentSegment || contentCaughtUp || !previousDisplayed) {
    return currentSegment;
  }
  return previousDisplayed;
}

/**
 * The playhead position to compute an animation transform from, clamped to
 * [0, segment.duration]. The upper clamp matters specifically when `segment`
 * is a held-over PREVIOUS segment (computeDisplayedSegment above) —
 * currentTime has necessarily moved past its end by then, so without the
 * clamp the animation math (e.g. Ken Burns' `1 + 0.05 * timeInSegment`)
 * would keep extrapolating past where that segment ever actually played,
 * instead of freezing at its own natural end-of-segment value.
 */
export function computeAnimTimeInSegment(
  segment: Pick<VideoSegment, 'duration' | 'startTime'> | undefined,
  currentTime: number,
): number {
  if (!segment) return 0;
  return Math.max(0, Math.min(segment.duration, currentTime - (segment.startTime ?? 0)));
}

/** Carried across renders (e.g. via a ref in PreviewStage.tsx) — see
 *  computeOverlayHoldState below. */
export interface OverlayHoldState {
  wasTransitionActive: boolean;
  holding: boolean;
}

/**
 * Bug 1's fix — whether the transition overlay should stay visible past the
 * moment its own transition window closes. A real transition window closing
 * (isTransitionActive true -> false) while content hasn't caught up yet
 * (contentCaughtUp false) engages the hold; the hold releases the instant
 * content catches up. Deliberately does NOT engage merely because
 * `!contentCaughtUp` on its own — a plain (no-transition) boundary has
 * nothing for the overlay to hold, so the hold only ever starts right at a
 * real transition's own close (`prev.wasTransitionActive` true).
 *
 * Extracted as a pure state-transition function (same shape as the
 * ChaseMutex helpers above) so the exact hold/release sequence is directly
 * unit-testable — a caller stores the returned state (e.g. in a ref) and
 * feeds it back in as `prev` on the next render.
 */
export function computeOverlayHoldState(
  prev: OverlayHoldState,
  isTransitionActive: boolean,
  contentCaughtUp: boolean,
): OverlayHoldState {
  let holding = prev.holding;
  if (isTransitionActive) {
    holding = false;
  } else if (prev.wasTransitionActive && !contentCaughtUp) {
    holding = true;
  } else if (contentCaughtUp) {
    holding = false;
  }
  return { wasTransitionActive: isTransitionActive, holding };
}

export function useWebCodecsPreview({
  segments,
  assets,
  currentSegment,
  currentTime,
  enabled,
}: UseWebCodecsPreviewParams): UseWebCodecsPreviewResult {
  const poolRef = useRef<VideoDecoderPool | null>(null);
  if (!poolRef.current) poolRef.current = new VideoDecoderPool();

  const [frame, setFrame] = useState<VideoFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The segment id the currently-committed `frame` actually belongs to — see
  // the field's doc on UseWebCodecsPreviewResult. React state (not a ref):
  // callers need a render to fire the moment this catches up to
  // currentSegment, since that's precisely the signal that unfreezes the
  // transition-overlay hold / animation-transform freeze in PreviewStage.tsx.
  const [frameSegmentId, setFrameSegmentId] = useState<string | null>(null);
  // Bumped whenever the active segment/enabled state changes, so a chase
  // loop left over from the previous segment recognizes it's stale and
  // stops without setting a stale frame — same race-guard shape as
  // videoOpGenerationRef in PreviewStage.tsx. Deliberately NOT bumped on
  // every currentTime tick within the same segment (see epochKeyRef below)
  // — only a real segment/enabled change counts as supersession.
  const generationRef = useRef(0);
  // Identifies the current "epoch" (segment id) the frame-pull effect is
  // chasing frames for — compared against on each run so generationRef
  // only advances on a genuine segment change, not every playback/scrub tick.
  const epochKeyRef = useRef<string | null>(null);
  // Phase 4 scrub coalescing (see file header) — the latest requested
  // source time for the in-flight (or about-to-start) chase loop, and
  // whether a chase loop is currently running (startChaseIfIdle's mutex).
  const latestTargetRef = useRef(0);
  const chaseMutexRef = useRef<ChaseMutex>({ chasing: false, epoch: 0 });
  /** Phase A2 (docs/webcodecs-architecture-plan.md 8.1 step 2): a pre-pulled
   *  boundary frame for the *next* segment, requested during decode-ahead
   *  (before the crossing) so the frame-pull effect's chase can adopt it
   *  immediately at the crossing instant instead of issuing a fresh
   *  getFrameAt call and waiting out whatever decode-ahead hasn't finished
   *  yet. Consumed (set back to null) the first time the chase's fetch
   *  closure uses it for a matching segmentId — deliberately single-use, so
   *  a chase loop that re-iterates for a moved target (see
   *  chaseLatestTarget) falls through to a normal pool.getFrameAt call
   *  rather than reusing a now-stale promise. Never a second,
   *  independently-mutexed getFrameAt call site: routing it through the
   *  existing chase's own fetch closure keeps "at most one getFrameAt call
   *  in flight per session" true without a new lock — a naive second call
   *  site here would race the live chase against the pre-pull on the same
   *  session the instant it becomes current (see the Phase A2 audit). */
  const pendingBoundaryPullRef = useRef<{ segmentId: string; promise: Promise<VideoFrame | null> } | null>(null);

  const currentAsset = currentSegment ? assets.find(a => a.id === currentSegment.assetId) : undefined;
  const isVideoSegment = isPlainVideoAsset(currentSegment, currentAsset);

  const nextSegment = useMemo(() => {
    if (!currentSegment) return undefined;
    const idx = segments.findIndex(s => s.id === currentSegment.id);
    return idx >= 0 ? segments[idx + 1] : undefined;
  }, [segments, currentSegment]);
  const nextAsset = nextSegment ? assets.find(a => a.id === nextSegment.assetId) : undefined;
  const nextIsVideo = isPlainVideoAsset(nextSegment, nextAsset);

  // Boundary crossing (Section 3.5) + Phase 4+6 windowed eviction (Section
  // 4). currentSegment and nextSegment are marked protected — the pool's
  // own LRU/budget enforcement (videoDecoderPool.ts) decides what else
  // survives, rather than this hook hard-releasing everything else itself.
  // This is what lets a recently-visited-but-no-longer-current segment
  // stay warm for a little while (bounded by the pool's ceilings), making
  // back-and-forth scrubbing across neighboring segments cheaper than a
  // cold reseek every time, while still guaranteeing current + next are
  // never the eviction target.
  useEffect(() => {
    const pool = poolRef.current!;
    if (!enabled) {
      pool.setProtectedIds([]);
      for (const id of pool.activeSegmentIds()) pool.releaseSession(id);
      return;
    }
    const keep = computeKeepSet(currentSegment, isVideoSegment, nextSegment, nextIsVideo);
    pool.setProtectedIds(keep);
  }, [enabled, currentSegment, isVideoSegment, nextSegment, nextIsVideo]);

  // Decode-ahead (Phase 2, one segment ahead — the direct generalization of
  // the legacy dual <video>-slot ping-pong): ensure a session for the
  // current segment, and preemptively start one for the next segment so
  // it's already warm by the time playback crosses the boundary. Phase 4+6:
  // the current segment's session is seeded at the actual playhead position
  // (not segment start) so a cold scrub landing mid-segment doesn't decode
  // from the wrong place first — see the file header note.
  useEffect(() => {
    if (!enabled) return;
    const pool = poolRef.current!;

    if (currentSegment && isVideoSegment && currentAsset) {
      const { start, end } = sourceRange(currentSegment);
      // Deliberately reads `currentTime` without listing it as a dependency
      // — this effect must NOT re-run on every playback tick (that would
      // defeat the decode-ahead warm-up and needlessly re-call
      // ensureSession every ~16ms). It only needs currentTime's value once,
      // at the exact render where currentSegment itself changed, to seed
      // the initial window at the real landing point for a cold scrub.
      // Subsequent ticks are handled entirely by the frame-pull effect
      // below, which does depend on currentTime.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const initialTarget = toSourceTime(currentSegment, currentTime);
      void pool.ensureSession(currentSegment.id, currentAsset.url, start, end, initialTarget).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    }
    if (nextSegment && nextIsVideo && nextAsset) {
      const { start, end } = sourceRange(nextSegment);
      // Decode-ahead failures for the *next* segment are non-fatal here —
      // when it becomes the current segment its own ensureSession call
      // above gets a fresh attempt and surfaces the error then. No
      // initialTargetSec override — decode-ahead for "next" always starts
      // from its own segment start, since that's where forward playback
      // will actually enter it.
      void pool.ensureSession(nextSegment.id, nextAsset.url, start, end).catch(() => {});
      // Phase A2: proactively pull (not just warm) the boundary frame — see
      // pendingBoundaryPullRef's own doc for why this is deliberately NOT a
      // second independently-awaited call site from the frame-pull effect's
      // perspective; it's consumed there, inside the existing chase's fetch
      // closure, so at most one getFrameAt call is ever in flight per
      // session.
      pendingBoundaryPullRef.current = {
        segmentId: nextSegment.id,
        promise: pool.getFrameAt(nextSegment.id, start).catch(() => null),
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, currentSegment, isVideoSegment, currentAsset, nextSegment, nextIsVideo, nextAsset]);

  // Pull the frame for the current playhead position out of the (already
  // decode-ahead-warmed) current segment's session.
  //
  // Phase 4 scrub coalescing: rather than firing one pool.getFrameAt call
  // per currentTime tick (a fast drag-scrub can produce dozens per second,
  // via Timeline.tsx's unthrottled mousemove -> onSeek -> setCurrentTime
  // chain), this effect always records the latest requested target and
  // only starts a "chase loop" if one isn't already running. The loop
  // awaits pool.getFrameAt for whatever the latest target was when it
  // checked, and if the target moved again while that call was in flight,
  // it immediately re-issues for the NEW latest target instead of
  // returning — so at most one decode/getFrameAt call is ever in flight
  // per segment, and every intermediate scrub position in between gets
  // skipped rather than separately decoded and discarded.
  useEffect(() => {
    if (!enabled || !currentSegment || !isVideoSegment || !currentAsset) {
      // Bump the generation even on this inert path — an in-flight chase
      // loop from a still-resolving previous segment must recognize it's
      // stale and stop, not paint a frame for a segment we've since left.
      // (This does NOT touch chaseMutexRef — see startChaseIfIdle's own
      // doc for why the mutex must never be gated on this generation check.)
      epochKeyRef.current = null;
      ++generationRef.current;
      setFrame(null);
      setFrameSegmentId(null);
      return;
    }
    const pool = poolRef.current!;
    const segmentId = currentSegment.id;
    // Only a genuine segment change is a new "epoch" — a currentTime tick
    // within the same segment (steady playback, or every intermediate tick
    // of a drag-scrub) must NOT bump generationRef, or it would make an
    // already-running chase loop for this same segment think it had been
    // superseded and stop early instead of settling on the latest target.
    if (epochKeyRef.current !== segmentId) {
      epochKeyRef.current = segmentId;
      ++generationRef.current;
      // Phase 5 fix (docs/webcodecs-architecture-plan.md): chaseLatestTarget's
      // `fetch` closure captures THIS effect run's segmentId once, at the
      // moment startChaseIfIdle is called — it has no way to notice a later
      // segment change. During continuous playback the loop practically
      // never exits on its own (getLatestTarget() — latestTargetRef — keeps
      // advancing every ~16ms tick regardless of which segment currentTime
      // now belongs to, so the pre-fetch/post-fetch target comparison almost
      // never matches), so a chase started for segment N can still be
      // "chasing" — mutex.chasing === true — well after the real current
      // segment has moved to N+1, N+2, etc., silently starving every later
      // segment's own startChaseIfIdle call (mutex busy) of ever issuing its
      // own getFrameAt call. The result observed in manual testing: playback
      // advances and overlays/captions update correctly (they don't depend
      // on this hook), but the WebCodecs canvas itself goes and stays black
      // across a stretch of segments until the stale chase happens to catch
      // up (which can take a while, since it's still fetching frames against
      // whatever segment N's session — usually evicted or long past its
      // relevant window — happens to return for a target meant for a much
      // later segment). Forcing the mutex open on every genuine segment
      // change — not just on pool dispose/unmount, see resetChaseMutex's own
      // doc for the original mount-time case this was written for — lets
      // the new segment's chase start immediately instead of waiting for
      // the stale one to notice; the epoch bump keeps the stale chase's own
      // eventual (now-harmless, generation-filtered) settlement from
      // clobbering the new chase's in-flight flag.
      resetChaseMutex(chaseMutexRef.current);
    }
    const generation = generationRef.current;
    latestTargetRef.current = toSourceTime(currentSegment, currentTime);

    startChaseIfIdle(
      chaseMutexRef.current,
      () => latestTargetRef.current,
      (target) => {
        // Phase A2: adopt a matching pre-pulled boundary frame instead of
        // issuing a fresh getFrameAt call — see pendingBoundaryPullRef's
        // doc. Single-use: if this chase re-iterates for a target that's
        // moved on (see chaseLatestTarget), the ref is already null by then
        // and this falls through to a normal pool.getFrameAt call below.
        const pending = pendingBoundaryPullRef.current;
        if (pending && pending.segmentId === segmentId) {
          pendingBoundaryPullRef.current = null;
          return pending.promise;
        }
        return pool.getFrameAt(segmentId, target).catch((err) => {
          if (generationRef.current === generation) {
            setError(err instanceof Error ? err.message : String(err));
          }
          return null;
        });
      },
      (result) => {
        if (generationRef.current !== generation) return; // superseded by a segment/enabled change — paint nothing
        setFrame(result);
        if (result) {
          setError(null);
          // Only a REAL frame counts as "content caught up" for this segment —
          // a null result (nothing decoded yet) must leave frameSegmentId
          // pointing at whatever segment was last genuinely displayed, so
          // callers gating on frameSegmentId === currentSegment.id keep
          // correctly reporting "not ready" rather than falsely matching.
          setFrameSegmentId(segmentId);
        }
      },
    );
  }, [enabled, currentSegment, isVideoSegment, currentAsset, currentTime]);

  // Dispose the pool (closes every session and buffered VideoFrame) on unmount.
  //
  // Phase 5 fix (docs/webcodecs-architecture-plan.md): under React
  // StrictMode (dev-only), this cleanup runs once immediately after the
  // very first mount's effects fire, then every effect re-runs a second
  // time on the same component instance — `poolRef.current` is a ref, so
  // it survives this and the SAME pool object gets reused (dispose() just
  // clears its internal maps; it doesn't need to be reconstructed to work
  // again). Two things from the first pass are still stale after this
  // cleanup runs, and both need to be invalidated here, at the exact point
  // the pool is actually invalidated, not left to whatever later moment
  // each one would otherwise settle on its own:
  //  1. `generationRef` — the first pass's in-flight `getFrameAt` call
  //     (started before this cleanup, since decode/demux is async) captured
  //     `generation` before this dispose happened; its own segment id
  //     hasn't changed between the two StrictMode passes, so the frame-pull
  //     effect's `epochKeyRef` guard never bumps `generationRef` for it on
  //     its own. Without bumping it here, that stale call's eventual
  //     (post-dispose, session.closed) null result could still satisfy the
  //     generation check in onSettled and stomp the second pass's real
  //     frame with null.
  //  2. `chaseMutexRef` — see `resetChaseMutex`'s own doc. Without this, the
  //     second pass's `startChaseIfIdle` call finds the first pass's chase
  //     still marked in-flight (chasing a session that's being closed right
  //     now) and silently no-ops, so nothing ever calls `getFrameAt` again
  //     for the fresh session the second pass's decode-ahead effect just
  //     created — a permanently blank canvas for whatever segment was
  //     current at mount, until the user happened to switch segments.
  useEffect(() => {
    return () => {
      poolRef.current?.dispose();
      ++generationRef.current;
      resetChaseMutex(chaseMutexRef.current);
    };
  }, []);

  return {
    frame: enabled && isVideoSegment ? frame : null,
    isVideoSegment: enabled && isVideoSegment,
    error,
    frameSegmentId: enabled && isVideoSegment ? frameSegmentId : null,
  };
}
