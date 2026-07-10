/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useTransitionPreview — pre-roll snapshot blend for preview transitions.
 *
 * Decision (b) from Fidelity Polish kickoff: universal coverage via a
 * pre-roll snapshot approach. Renders outgoing + incoming segment frames
 * to offscreen canvases once (~50–200ms cost), then blends them over the
 * transition window. Works for image↔image, image↔video, video↔video.
 */

import { useRef, useEffect, useState } from 'react';
import { VideoSegment, Asset, TransitionType, AnimationType } from '../types';
import { renderSegmentFrame, FrameGlobalConfig } from '../services/frameRenderer';
import { resolveEffectiveTransition, resolveTransitionProgress } from '../services/transitionResolver';
import { applySegmentAnimation } from '../services/canvasAnimations';
import type { VideoDecoderPool } from '../services/videoDecoderPool';
import { isWebCodecsPreviewSupported } from '../services/webcodecsSupport';
// B3 (item-4 fix) — reusing these pure, already-tested primitives from
// useWebCodecsPreview.ts (read-only import, that file is not modified)
// rather than re-implementing them: toSourceTime is the exact same
// segment-local-time -> decoder-source-time mapping the main hook already
// uses, and startChaseIfIdle/resetChaseMutex (built on chaseLatestTarget
// internally) are the "at most one getFrameAt call in flight per session"
// primitive that hook's own file header documents at length (a real
// deadlock/starvation class of bug was found and fixed there — reusing it
// here avoids reintroducing the same class of race for the OUTGOING
// segment's session instead of building a parallel, less-proven mechanism).
import {
  toSourceTime,
  startChaseIfIdle,
  resetChaseMutex,
  type ChaseMutex,
} from './useWebCodecsPreview';

/** Snapshot resolution — 16:9 half-HD. Full resolution is unnecessary
 *  for preview-quality blending. */
const SNAP_W = 960;
const SNAP_H = 540;

/** How many seconds before the transition window to trigger the pre-roll.
 *  0.8s covers the worst-case parallel seek cost (~200ms per video) with a
 *  600ms safety margin. Same-asset sequential fallback costs ~400ms — still
 *  400ms of margin inside the 800ms window. */
const PRE_ROLL_LEAD_S = 0.8;

/** Tolerance for "does this segment start where that one ends" contiguity
 *  checks — matches the rounding tolerance segment timing already accrues
 *  elsewhere (e.g. syncEngine.ts's anchor math). */
const CONTIGUITY_EPSILON_S = 0.001;

/** Safety margin subtracted from the outgoing segment's own duration when
 *  sampling its final frame for the outgoing snapshot — avoids seeking at
 *  (or, from floating-point error, past) the source's own end. */
const OUTGOING_SNAPSHOT_EPSILON_S = 0.05;

interface SnapshotPair {
  /** Unique key identifying this boundary: `${outId}:${inId}` */
  key: string;
  outgoing: HTMLCanvasElement;
  incoming: HTMLCanvasElement;
}

/**
 * A fully-composited blend state captured as one atomic unit — canvases,
 * progress, and transition type together — so it can be held and redrawn
 * as a single frozen "last good frame" rather than as independently-stale
 * pieces (see resolveRetainedBlend below for why progress/canvases must
 * never be mixed from different moments).
 */
export interface RetainedBlend<TCanvas> {
  outgoing: TCanvas;
  incoming: TCanvas;
  progress: number;
  effectiveTransition: TransitionType | string;
}

/** Inputs resolveRetainedBlend needs each render — the live (not-yet-retained)
 *  candidate state for whichever boundary is currently being evaluated. */
export interface BlendRetentionInput<TCanvas> {
  /** True when currentTime is genuinely inside an active transition window
   *  (both halves, centered) — not merely the pre-roll lead-in. */
  inTransitionWindow: boolean;
  /** True when THIS boundary's own snapshot pair has finished rendering. */
  snapshotsReady: boolean;
  outgoing: TCanvas | null;
  incoming: TCanvas | null;
  progress: number;
  effectiveTransition: TransitionType | string;
}

export interface BlendRetentionResult<TCanvas> {
  isActive: boolean;
  outgoing: TCanvas | null;
  incoming: TCanvas | null;
  progress: number;
  effectiveTransition: TransitionType | string;
  /** The value the caller's ref should hold going into the next render. */
  nextRetained: RetainedBlend<TCanvas> | null;
}

/**
 * Video-video pre-boundary retention fix (see this file's own header note
 * on the useTransitionPreview export, and docs/webgl-architecture-plan.md's
 * "video-video transition blend gap" closeout entry).
 *
 * A video-video boundary's pre-roll snapshot pair can need up to two
 * concurrent <video> seeks (frameRenderer.ts's seekVideo/awaitSeeked,
 * ~200-400ms each) racing against useWebCodecsPreview's own two concurrent
 * decode sessions (current + next) for CPU/decoder time — on constrained
 * hardware this can miss PRE_ROLL_LEAD_S's lead-in, so `snapshotsReady` is
 * still false at the exact moment `inTransitionWindow` goes true. Falling
 * straight through to "nothing to show" in that case drops the overlay's
 * CSS opacity to 0 (PreviewStage.tsx) and reveals the raw underlying
 * outgoing layer with no blend for however long the snapshot takes to
 * land — a hard cut indistinguishable from the old pre-centering D7 bug.
 * Extending the lead time doesn't fix this: it's a race whose worst case
 * scales with device load, not a fixed constant.
 *
 * This is the architectural fix instead: retain the last FULLY composited
 * blend state (canvases + progress + transition type, captured together,
 * never mixed across moments — mixing stale canvases with live progress
 * would blend mismatched content) and keep returning it, unchanged, for as
 * long as we're genuinely inside a transition window but this boundary's
 * fresh pair isn't ready yet. `isActive` stays true throughout, so the
 * overlay's opacity never drops to 0 and never re-triggers its own CSS
 * transition — the composited content simply swaps to the live pair the
 * moment it lands, via one ordinary per-tick update, not a pop back in from
 * a hidden state. Only the very first transition of a session (nothing
 * ever retained yet) has no fallback to fall back to and behaves as before
 * (bare outgoing content, no blend, until its own snapshot lands).
 *
 * Pure and generic over the canvas type so it's directly unit-testable
 * without a DOM/canvas-capable test environment (this repo has no jsdom —
 * same precedent as every other pure helper in this file/useWebCodecsPreview.ts).
 * `prevRetained`/the return's `nextRetained` are the caller's ref value
 * going in and coming out — mirrors computeOverlayHoldState's/
 * computeSnapReleaseBlend's prev-state-in/next-state-out shape.
 */
export function resolveRetainedBlend<TCanvas>(
  prevRetained: RetainedBlend<TCanvas> | null,
  input: BlendRetentionInput<TCanvas>,
): BlendRetentionResult<TCanvas> {
  const freshlyActive = input.inTransitionWindow && input.snapshotsReady && input.outgoing !== null && input.incoming !== null;
  if (freshlyActive) {
    const nextRetained: RetainedBlend<TCanvas> = {
      outgoing: input.outgoing as TCanvas,
      incoming: input.incoming as TCanvas,
      progress: input.progress,
      effectiveTransition: input.effectiveTransition,
    };
    return { isActive: true, ...nextRetained, nextRetained };
  }

  const usingRetainedFallback = input.inTransitionWindow && prevRetained !== null;
  if (usingRetainedFallback) {
    return { isActive: true, ...prevRetained!, nextRetained: prevRetained };
  }

  return {
    isActive: false,
    outgoing: null,
    incoming: null,
    progress: input.progress,
    effectiveTransition: input.effectiveTransition,
    nextRetained: prevRetained,
  };
}

/**
 * Resolves which AnimationType a segment's camera-dynamics transform should
 * use — effectAnimation slug wins over the legacy segment.animation field.
 * Identical resolution to frameRenderer.ts:479-482 and PreviewStage.tsx's
 * own resolveSegmentAnimationType — kept as a small local copy (same as
 * those two files each already do independently) rather than a shared
 * cross-file helper, consistent with how this exact three-line resolution
 * is already duplicated between a service and a component in this codebase.
 */
function resolveAnimationType(seg: VideoSegment): AnimationType {
  return ((seg.effectAnimation && seg.effectAnimation !== 'none')
    ? seg.effectAnimation as AnimationType
    : seg.animation) ?? AnimationType.NONE;
}

export interface TransitionPreviewInfo {
  /** True when the playhead is inside the transition window AND there is
   *  composited content to show — either this boundary's own fresh
   *  snapshots, or (resolveRetainedBlend) the last good composited frame
   *  retained from a moment earlier, while a fresh pair is still loading. */
  isActive: boolean;
  /** Blend factor 0..1 (0 = fully outgoing, 1 = fully incoming). */
  progress: number;
  /** Pre-rendered outgoing frame (at transition start time). */
  outgoing: HTMLCanvasElement | null;
  /** Pre-rendered incoming frame (first frame of next segment). */
  incoming: HTMLCanvasElement | null;
  /** The resolved transition type to apply (slug string or legacy enum). */
  effectiveTransition: TransitionType | string;
  /**
   * The id of the OUTGOING segment for whichever boundary is currently
   * active (isActive true), else null. Added for the centered window (see
   * this file's own window-derivation comment below): under the old
   * anchored-at-B-start placement, PreviewStage.tsx's caption-hold logic
   * could safely assume `currentSegment` (bounds-based, computed elsewhere)
   * was ALWAYS the incoming side for the whole active window, so it derived
   * "outgoing" itself via a contiguous-predecessor lookup. Centering breaks
   * that assumption — for the pre-boundary half, currentSegment IS the
   * outgoing segment, not the incoming one — so callers that need "which
   * segment is outgoing right now" must read it from here instead of
   * re-deriving it from currentSegment, which this hook already resolved
   * correctly for whichever candidate (A or B) is actually active.
   */
  outgoingSegmentId: string | null;
  /**
   * The id of the INCOMING segment for whichever boundary is currently
   * active, else null. Companion to outgoingSegmentId, for the same reason:
   * PreviewStage.tsx's WebCodecs live-pull upgrade for the incoming canvas
   * (B3, item-4 fix) needs to know whether `currentSegment` (bounds-based)
   * is ACTUALLY this transition's incoming side before treating its live
   * decoded frame as this transition's incoming content — under the
   * centered window, currentSegment is the OUTGOING side for the whole
   * pre-boundary half, so blindly trusting "currentSegment == incoming"
   * (safe under the old anchored-at-B-start window, where it always was)
   * would blit the outgoing segment's own live frame onto what's meant to
   * be the incoming snapshot.
   */
  incomingSegmentId: string | null;
}

interface Params {
  segments: VideoSegment[];
  currentTime: number;
  assets: Asset[];
  globalTransition: TransitionType;
  globalTransitionDuration: number;
  globalConfig: FrameGlobalConfig;
  /** D12 fix — true while a timeline resize-drag is in progress. Segment
   *  boundaries are transiently distorted during a drag (cascade compensation
   *  is deferred to release), which can sweep currentTime into a bogus
   *  transition window. Suppress activation entirely while true; read
   *  directly at render time (not an effect dep) so there's no ordering
   *  concern like the seek-effect guard had to work around. */
  isResizingRef: React.RefObject<boolean>;
  /**
   * B2 plumbing (item-4 audit, docs/webcodecs-architecture-plan.md) — the
   * SAME VideoDecoderPool instance useWebCodecsPreview.ts owns (exposed via
   * its own return object), threaded in by PreviewStage.tsx. B3 will call
   * getFrameAt/setTransitionProtectedIds on it directly for the OUTGOING
   * segment during a transition window — a segment useWebCodecsPreview.ts
   * itself stops tracking the instant it falls out of {current, next}.
   * Optional and unused in this task: accepted and stored only, no
   * behavior change yet.
   */
  pool?: VideoDecoderPool;
  /**
   * B2 plumbing — the parent's already-live frame/frameSegmentId for
   * whichever segment useWebCodecsPreview.ts currently considers current.
   * B3 will source the INCOMING side of the transition blend from these
   * instead of issuing an independent getFrameAt call for the same
   * segment — the item-4 audit confirmed a second call site would race
   * useWebCodecsPreview.ts's own documented pendingBoundaryPullRef
   * chase-mutex (see that hook's file header). Optional and unused in
   * this task: accepted and stored only, no behavior change yet.
   */
  incomingFrame?: VideoFrame | null;
  incomingFrameSegmentId?: string | null;
  /**
   * Phase 3 (docs/webgl-architecture-plan.md) — true when the dual-gated
   * WebGL2 preview path (useGlPreview.ts) is active. Purely additive
   * suppression, in the same style as `isResizingRef`: when true this hook
   * goes inert — it reports `isActive:false`, renders no snapshots, and does
   * NOT touch the pool's `transitionProtectedIds` (useGlPreview owns that set
   * while it's active). This prevents (a) the legacy transition-overlay canvas
   * compositing on top of the GL canvas, and (b) the two hooks fighting over
   * the single `transitionProtectedIds` set. Defaults undefined/false — the
   * shipped path — in which case behavior is byte-identical to before Phase 3.
   */
  glPathActive?: boolean;
}

export function useTransitionPreview({
  segments,
  currentTime,
  assets,
  globalTransition,
  globalTransitionDuration,
  globalConfig,
  isResizingRef,
  pool,
  incomingFrame,
  incomingFrameSegmentId,
  glPathActive,
}: Params): TransitionPreviewInfo {
  const [snapshots, setSnapshots] = useState<SnapshotPair | null>(null);
  // Video-video pre-boundary retention fix — see resolveRetainedBlend's own
  // doc above. Plain ref (not state): updated every render as a byproduct of
  // computing this hook's return value, not something that itself needs to
  // trigger a re-render (the state that actually changes visible output —
  // snapshots/currentTime/etc. — already does).
  const retainedBlendRef = useRef<RetainedBlend<HTMLCanvasElement> | null>(null);
  // Prevent concurrent or duplicate snapshot renders
  const pendingKeyRef = useRef<string>('');
  // Guard against setState after unmount (async renderSegmentFrame can outlive the component)
  const mountedRef = useRef<boolean>(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // B2 plumbing (item-4 audit) — stored for B3 to read; nothing in this
  // task uses these yet, so capturing them in a plain-object ref (updated
  // every render, not inside an effect) causes no behavior change. See the
  // Params fields' own docs above for what each is for.
  const liveSourceRef = useRef({ pool, incomingFrame, incomingFrameSegmentId });
  liveSourceRef.current = { pool, incomingFrame, incomingFrameSegmentId };

  // B3 (item-4 fix) — the same capability gate PreviewStage.tsx already
  // uses to choose the WebCodecs vs. legacy <video> preview path (see
  // isWebCodecsPreviewSupported's own doc: memoized, sole gate). Gates the
  // live-pull branch below; when false, this hook's behavior is IDENTICAL
  // to before this task (the one-shot renderSegmentFrame snapshot effect
  // is untouched and remains the only source for both canvases).
  const webCodecsCapable = isWebCodecsPreviewSupported();

  // Mirrors `snapshots` state in a ref so the live-pull effect below (which
  // fires on its own schedule, independent of whatever triggered the last
  // render) can always read the current canvas pair without needing
  // `snapshots` in its own dependency array.
  const snapshotsRef = useRef<SnapshotPair | null>(null);
  snapshotsRef.current = snapshots;

  // ---------------------------------------------------------------------------
  // Derive relevant segments + transition metadata
  //
  // The transition window is CENTERED on the boundary between two adjacent
  // segments (docs/webgl-architecture-plan.md's transition-centering entry —
  // supersedes the old anchored-entirely-AFTER-the-boundary placement, D7 in
  // project-state.md's Ignored Low Risk Bugs, where the whole blend played
  // inside the incoming segment's own slot). Half the duration now sits
  // BEFORE the boundary (while, by plain bounds, currentTime is still inside
  // the OUTGOING segment's own span) and half AFTER (inside the INCOMING
  // segment's own span). So the segment containing `currentTime` is NOT
  // reliably "the incoming segment" the way it always was under the old
  // anchoring — it can be either side depending on where the playhead
  // currently sits relative to a boundary. Two candidate boundaries are
  // evaluated every render, both anchored off whichever segment currently
  // contains the playhead:
  //   A) containingSeg is the OUTGOING side of the boundary AHEAD (into
  //      nextSegA) — active (blending, not just pre-roll) for containingSeg's
  //      own last duration/2 seconds; pure pre-roll lead-in before that.
  //   B) containingSeg is the INCOMING side of the boundary BEHIND (from
  //      prevSegB) — active for containingSeg's own first duration/2 seconds.
  // Candidate B always wins if both were somehow true at once (degenerate
  // sub-`duration`-long segments) — an active blend is the "real" state.
  // ---------------------------------------------------------------------------
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const containingSeg = sorted.find(
    s => currentTime >= s.startTime && currentTime < s.startTime + s.duration,
  );
  const nextOf = (seg: VideoSegment) =>
    sorted.find(s => s.startTime >= seg.startTime + seg.duration - CONTIGUITY_EPSILON_S && s.id !== seg.id);
  const prevOf = (seg: VideoSegment) =>
    sorted.find(s => Math.abs(s.startTime + s.duration - seg.startTime) < CONTIGUITY_EPSILON_S && s.id !== seg.id);

  // Candidate A — containingSeg is the OUTGOING side of the boundary ahead.
  const nextSegA = containingSeg ? nextOf(containingSeg) : undefined;
  const resolvedA = resolveEffectiveTransition(containingSeg, globalTransition, globalTransitionDuration);
  const hasTransitionA =
    nextSegA !== undefined && resolvedA.transition !== TransitionType.NONE && resolvedA.duration > 0;
  // null outside the centered window; 0..1 inside it (0.5 exactly at nextSegA.startTime).
  const progressA = hasTransitionA
    ? resolveTransitionProgress(nextSegA!.startTime, resolvedA.duration, currentTime)
    : null;
  const windowAStart = hasTransitionA ? nextSegA!.startTime - resolvedA.duration / 2 : 0;
  const preRollOnlyActive =
    hasTransitionA &&
    progressA === null &&
    currentTime >= windowAStart - PRE_ROLL_LEAD_S &&
    currentTime < windowAStart;

  // Candidate B — containingSeg is the INCOMING side of the boundary behind.
  // Duration/type are resolved against the OUTGOING segment's own field
  // (prevSegB), matching resolveEffectiveTransition's contract and export's
  // semantics — never against containingSeg itself.
  const prevSegB = containingSeg ? prevOf(containingSeg) : undefined;
  const resolvedB = resolveEffectiveTransition(prevSegB, globalTransition, globalTransitionDuration);
  const hasTransitionB =
    prevSegB !== undefined && resolvedB.transition !== TransitionType.NONE && resolvedB.duration > 0;
  const progressB =
    hasTransitionB && containingSeg
      ? resolveTransitionProgress(containingSeg.startTime, resolvedB.duration, currentTime)
      : null;

  let outgoingSeg: VideoSegment | undefined;
  let incomingSeg: VideoSegment | undefined;
  let transitionDuration = 0;
  let effectiveTransition: TransitionType | string = TransitionType.NONE;
  let isActiveWindow = false;
  let needsPreRollWindow = false;
  let activeProgress = 0;

  if (progressB !== null) {
    outgoingSeg = prevSegB;
    incomingSeg = containingSeg;
    transitionDuration = resolvedB.duration;
    effectiveTransition = resolvedB.transition;
    isActiveWindow = true;
    needsPreRollWindow = true;
    activeProgress = progressB;
  } else if (progressA !== null) {
    outgoingSeg = containingSeg;
    incomingSeg = nextSegA;
    transitionDuration = resolvedA.duration;
    effectiveTransition = resolvedA.transition;
    isActiveWindow = true;
    needsPreRollWindow = true;
    activeProgress = progressA;
  } else if (preRollOnlyActive) {
    outgoingSeg = containingSeg;
    incomingSeg = nextSegA;
    transitionDuration = resolvedA.duration;
    effectiveTransition = resolvedA.transition;
    needsPreRollWindow = true;
  }

  // glPathActive suppresses the whole active window (same lever as
  // isResizingRef) so the legacy overlay never shows while GL owns the frame.
  const inTransitionWindow = !isResizingRef.current && !glPathActive && isActiveWindow;

  const progress = inTransitionWindow ? activeProgress : 0;

  // ---------------------------------------------------------------------------
  // B3 (item-4 fix) — transition-protect the OUTGOING session.
  //
  // useWebCodecsPreview.ts's own {current, next} protection (setProtectedIds)
  // stops covering outgoingSeg the instant the boundary crosses and it's no
  // longer `current` — without this, its decode session is fair game for
  // LRU eviction mid-blend. Declarative, not TTL-based (see B1's own doc):
  // re-asserted every time outgoingSeg's identity changes, cleared the
  // moment it becomes undefined. Harmless no-op when `pool` wasn't passed
  // in (Params field is optional) or outgoingSeg is the current segment
  // itself (pre-roll-only candidate A — already protected by the other set;
  // this just adds a redundant, harmless entry).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // glPathActive: useGlPreview.ts owns transitionProtectedIds while the GL
    // path is active — don't touch it here (glPathActive is a dep so this
    // re-runs and resumes managing the set the moment GL is toggled off).
    if (!pool || glPathActive) return;
    pool.setTransitionProtectedIds(outgoingSeg ? [outgoingSeg.id] : []);
  }, [pool, outgoingSeg?.id, glPathActive]);

  // ---------------------------------------------------------------------------
  // B3 (item-4 fix) — live per-tick render for the OUTGOING segment's video
  // content, layered ON TOP of the one-shot snapshot effect below rather
  // than replacing it: the one-shot effect still runs unconditionally, in
  // every mode, and creates/owns the canvas pair. This effect's own
  // `onSettled` callback looks up that canvas via `snapshotsRef` at the
  // moment its async `getFrameAt` call resolves — on the very first tick or
  // two of a brand-new boundary the one-shot effect's canvases may not
  // exist yet (its own `renderSegmentFrame` calls are the slower,
  // ~200-400ms HTML5-seek path), in which case this callback simply finds
  // no canvas and no-ops for that tick. Because this effect re-fires every
  // tick (`currentTime` is in its dependency array) for as long as
  // needsPreRollWindow/isActiveWindow holds, it converges to live content
  // within roughly one more tick after the one-shot snapshot lands — not a
  // same-commit ordering guarantee, just fast convergence. A non-capable
  // runtime (webCodecsCapable false), a missing `pool`, or a non-video
  // outgoing asset (image/heading — no VideoFrame to pull; B3's scope is
  // decode-side video content only, per the item-4 audit) all leave the
  // one-shot snapshot as the sole, unchanged source for the outgoing canvas
  // for the life of the transition.
  // ---------------------------------------------------------------------------
  const outgoingAsset = outgoingSeg ? assets.find(a => a.id === outgoingSeg.assetId) : undefined;
  const liveOutgoingActive = webCodecsCapable && !glPathActive && !!pool && !!outgoingSeg && outgoingAsset?.type === 'video';

  // At most one getFrameAt call in flight for the outgoing session at a
  // time (see the chase-primitive import note above); reset whenever
  // outgoingSeg's own identity changes (a genuine new "epoch" — mirrors
  // useWebCodecsPreview.ts's own epochKeyRef/generationRef pattern for its
  // frame-pull effect exactly, including why: a stale chase from a
  // previous outgoing segment must not paint over a new one, and its own
  // busy loop must not silently starve the new segment of ever chasing).
  const outgoingChaseMutexRef = useRef<ChaseMutex>({ chasing: false, epoch: 0 });
  const outgoingLatestTargetRef = useRef(0);
  const outgoingEpochKeyRef = useRef<string | null>(null);
  const outgoingGenerationRef = useRef(0);

  useEffect(() => {
    if (!liveOutgoingActive || !outgoingSeg || !pool) {
      // Not (or no longer) live for this render — bump the generation so a
      // chase left over from a previous outgoing segment recognizes it's
      // stale and stops painting, mirroring useWebCodecsPreview.ts's own
      // inert-path handling.
      outgoingEpochKeyRef.current = null;
      ++outgoingGenerationRef.current;
      return;
    }

    const segmentId = outgoingSeg.id;
    const boundaryKey = `${outgoingSeg.id}:${incomingSeg?.id ?? ''}`;

    if (outgoingEpochKeyRef.current !== segmentId) {
      outgoingEpochKeyRef.current = segmentId;
      ++outgoingGenerationRef.current;
      resetChaseMutex(outgoingChaseMutexRef.current);
    }
    const generation = outgoingGenerationRef.current;
    // toSourceTime deliberately doesn't clamp segment-local progress to the
    // segment's own `duration` — for the SECOND half of a centered blend
    // window, currentTime has advanced past outgoingSeg's nominal end (it's
    // no longer the bounds-containing segment), so this naturally continues
    // the outgoing video's own source time forward instead of freezing at
    // its last frame. For the FIRST half, currentTime is still within
    // outgoingSeg's own nominal span, so this is just its ordinary
    // (non-extrapolated) source time — same call, both cases fall out of the
    // same unclamped formula.
    outgoingLatestTargetRef.current = toSourceTime(outgoingSeg, currentTime);

    startChaseIfIdle(
      outgoingChaseMutexRef.current,
      () => outgoingLatestTargetRef.current,
      (target) => {
        // TEMP RACE-DIAG (remove before commit) — see the video-video
        // flicker investigation. Timestamps this call so it can be
        // correlated against useWebCodecsPreview.ts's main chase and
        // videoDecoderPool.ts's internal reset/close events for the same
        // segment id.
        const __raceDiagT0 = performance.now();
        console.log(`[RACE-DIAG-OUTGOING] CALL seg=${segmentId} target=${target.toFixed(3)} t=${__raceDiagT0.toFixed(1)}`);
        return pool.getFrameAt(segmentId, target).then((r) => {
          console.log(`[RACE-DIAG-OUTGOING] SETTLE seg=${segmentId} target=${target.toFixed(3)} dur=${(performance.now() - __raceDiagT0).toFixed(1)}ms result=${r ? 'frame' : 'null'}`);
          return r;
        }).catch(() => {
          console.log(`[RACE-DIAG-OUTGOING] ERROR seg=${segmentId} target=${target.toFixed(3)} dur=${(performance.now() - __raceDiagT0).toFixed(1)}ms`);
          return null;
        });
      },
      (result) => {
        if (outgoingGenerationRef.current !== generation) return; // superseded
        if (!result) return; // nothing decoded yet / evicted — keep last drawn content
        const canvas = snapshotsRef.current?.key === boundaryKey ? snapshotsRef.current.outgoing : null;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        try {
          const frame = result;
          const frameW = frame.displayWidth;
          const frameH = frame.displayHeight;
          if (!frameW || !frameH) return; // closed frame reads back as 0x0 on some engines

          // object-cover source rect — mirrors PreviewCanvas.tsx's identical
          // VideoFrame-to-canvas fit math (same convention used everywhere
          // else a raw decoded frame is painted in this app).
          const canvasRatio = canvas.width / canvas.height;
          const frameRatio = frameW / frameH;
          let sx = 0, sy = 0, sw = frameW, sh = frameH;
          if (frameRatio > canvasRatio) {
            sw = frameH * canvasRatio;
            sx = (frameW - sw) / 2;
          } else {
            sh = frameW / canvasRatio;
            sy = (frameH - sh) / 2;
          }

          // Segment-local elapsed time (uncapped — same "continues past
          // nominal duration" reasoning as the source-time computation
          // above) drives the camera-dynamics transform, matching
          // frameRenderer.ts's own applySegmentAnimation call site exactly
          // (canvas transform, not the CSS getAnimationWrapperProps wrapper
          // PreviewStage.tsx uses for DOM-wrapped media — this is a raw
          // <canvas>, so the canvas-native function is the correct one).
          const timeInSegment = currentTime - (outgoingSeg.startTime ?? 0);
          const animation = resolveAnimationType(outgoingSeg);

          ctx.save();
          const animResult = applySegmentAnimation(ctx, {
            animation,
            timeInSegment,
            segmentDuration: outgoingSeg.duration,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
          });
          if (animResult.postDrawAlpha !== undefined) {
            ctx.globalAlpha = animResult.postDrawAlpha;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          ctx.restore();
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
          ctx.shadowColor = 'rgba(0,0,0,0)';
        } catch {
          // Frame closed between resolving and this draw (pool eviction/
          // scrub-reset race) — same documented hazard as PreviewCanvas.tsx's
          // own drawImage call. Skip this tick; the canvas keeps whatever it
          // last held, superseded moments later by the next live frame.
        }
      },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveOutgoingActive, outgoingSeg?.id, incomingSeg?.id, currentTime, pool]);

  // ---------------------------------------------------------------------------
  // Pre-roll: render snapshots once when approaching the transition window
  // ---------------------------------------------------------------------------
  const needsPreRoll = !isResizingRef.current && !glPathActive && needsPreRollWindow;

  useEffect(() => {
    if (!needsPreRoll || !outgoingSeg || !incomingSeg) {
      return;
    }

    const key = `${outgoingSeg.id}:${incomingSeg.id}`;
    // Already have this snapshot pair or render is in flight
    if (snapshots?.key === key || pendingKeyRef.current === key) {
      return;
    }

    pendingKeyRef.current = key;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = SNAP_W;
    outCanvas.height = SNAP_H;
    const inCanvas = document.createElement('canvas');
    inCanvas.width = SNAP_W;
    inCanvas.height = SNAP_H;

    const outCtx = outCanvas.getContext('2d');
    const inCtx = inCanvas.getContext('2d');
    if (!outCtx || !inCtx) {
      pendingKeyRef.current = '';
      return;
    }

    const currentAsset = assets.find(a => a.id === outgoingSeg.assetId);
    const nextAsset = assets.find(a => a.id === incomingSeg.assetId);
    // Static outgoing/incoming snapshots: outgoing sampled at its own final
    // instant, incoming at its own first frame (timeInSegment: 0 below) —
    // held fixed and cross-blended via `progress` for the WHOLE centered
    // window, both halves. This is an approximation (a real per-tick render
    // would show the incoming clip visibly held at its own t=0 through the
    // pre-boundary half, then advancing after), consistent with this hook's
    // documented pre-roll SNAPSHOT design (see file header) — it was already
    // an approximation before centering, this doesn't newly introduce one.
    // Clamped below its own duration to avoid an out-of-range seek.
    const outgoingTime = Math.max(0, outgoingSeg.duration - OUTGOING_SNAPSHOT_EPSILON_S);

    void (async () => {
      try {
        // When both segments reference the same video URL, videoCache returns
        // the same HTMLVideoElement. Concurrent seeks on the same element race
        // (the second seek cancels the first), so fall back to sequential in
        // that case. For all other combinations (distinct URLs, or non-video
        // assets) parallel rendering is safe and halves the snapshot cost.
        const sharesAsset =
          currentAsset?.type === 'video' &&
          nextAsset?.type === 'video' &&
          currentAsset.url === nextAsset.url;

        if (sharesAsset) {
          // Same video element — seek sequentially to avoid race.
          await renderSegmentFrame({
            segment: outgoingSeg,
            asset: currentAsset,
            timeInSegment: outgoingTime,
            ctx: outCtx,
            width: SNAP_W,
            height: SNAP_H,
            // The live DOM caption (PreviewStage.tsx) now stays visible throughout the
            // transition, so this snapshot must not bake its own copy of the body
            // caption underneath it — a size/position mismatch between the two was the
            // source of a visible "pop" at the transition's end. Headings and extra
            // overlays are unaffected by this flag.
            skipCaption: true,
            global: globalConfig,
          });
          await renderSegmentFrame({
            segment: incomingSeg,
            asset: nextAsset,
            timeInSegment: 0,
            ctx: inCtx,
            width: SNAP_W,
            height: SNAP_H,
            // The live DOM caption (PreviewStage.tsx) now stays visible throughout the
            // transition, so this snapshot must not bake its own copy of the body
            // caption underneath it — a size/position mismatch between the two was the
            // source of a visible "pop" at the transition's end. Headings and extra
            // overlays are unaffected by this flag.
            skipCaption: true,
            global: globalConfig,
          });
        } else {
          // Distinct sources (or non-video) — parallel is safe.
          const outgoingPromise = renderSegmentFrame({
            segment: outgoingSeg,
            asset: currentAsset,
            timeInSegment: outgoingTime,
            ctx: outCtx,
            width: SNAP_W,
            height: SNAP_H,
            // The live DOM caption (PreviewStage.tsx) now stays visible throughout the
            // transition, so this snapshot must not bake its own copy of the body
            // caption underneath it — a size/position mismatch between the two was the
            // source of a visible "pop" at the transition's end. Headings and extra
            // overlays are unaffected by this flag.
            skipCaption: true,
            global: globalConfig,
          });

          const incomingPromise = renderSegmentFrame({
            segment: incomingSeg,
            asset: nextAsset,
            timeInSegment: 0,
            ctx: inCtx,
            width: SNAP_W,
            height: SNAP_H,
            // The live DOM caption (PreviewStage.tsx) now stays visible throughout the
            // transition, so this snapshot must not bake its own copy of the body
            // caption underneath it — a size/position mismatch between the two was the
            // source of a visible "pop" at the transition's end. Headings and extra
            // overlays are unaffected by this flag.
            skipCaption: true,
            global: globalConfig,
          });

          await Promise.all([outgoingPromise, incomingPromise]);
        }

        if (mountedRef.current) {
          setSnapshots({ key, outgoing: outCanvas, incoming: inCanvas });
        }
      } catch (err) {
        console.warn('[useTransitionPreview] snapshot render failed:', err);
      } finally {
        if (pendingKeyRef.current === key) pendingKeyRef.current = '';
      }
    })();
  // outgoingSeg/incomingSeg effectAnimation are included so changing a clip
  // effect re-renders the snapshot — otherwise a cached snapshot keeps
  // showing the old (or absent) filter through the transition.
  // renderSegmentFrame bakes resolveClipEffectFilter into the snapshot, so a
  // fresh render is all that's needed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPreRoll, outgoingSeg?.id, incomingSeg?.id, effectiveTransition, outgoingSeg?.effectAnimation, incomingSeg?.effectAnimation]);

  // Clear stale snapshots when the boundary changes (e.g. user seeks back)
  useEffect(() => {
    if (!outgoingSeg || !incomingSeg) {
      setSnapshots(null);
      return;
    }
    const key = `${outgoingSeg.id}:${incomingSeg.id}`;
    setSnapshots(prev => (prev?.key === key ? prev : null));
  }, [outgoingSeg?.id, incomingSeg?.id]);

  // ---------------------------------------------------------------------------
  // Compose result — see resolveRetainedBlend's own doc (top of file) for why
  // this doesn't just gate on `inTransitionWindow && snapshotsReady` anymore.
  // ---------------------------------------------------------------------------
  const snapshotsReady = snapshots !== null && snapshots.key === `${outgoingSeg?.id}:${incomingSeg?.id}`;
  const blend = resolveRetainedBlend(retainedBlendRef.current, {
    inTransitionWindow,
    snapshotsReady,
    outgoing: snapshotsReady ? snapshots!.outgoing : null,
    incoming: snapshotsReady ? snapshots!.incoming : null,
    progress,
    effectiveTransition,
  });
  retainedBlendRef.current = blend.nextRetained;
  const isActive = blend.isActive;

  return {
    isActive,
    progress: blend.progress,
    outgoing: blend.outgoing,
    incoming: blend.incoming,
    effectiveTransition: blend.effectiveTransition,
    outgoingSegmentId: isActive ? (outgoingSeg?.id ?? null) : null,
    incomingSegmentId: isActive ? (incomingSeg?.id ?? null) : null,
  };
}
