/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Maximize, Minimize, MonitorPlay } from 'lucide-react';
import { VideoSegment, Asset, TransitionType, AnimationType, TextOverlay, HeadingOverlay } from '../types';
import { getFilterStyle, getMotionProps } from '../constants';
import { applyTransitionBlend } from '../services/frameRenderer';
import { getActiveHeadingAt } from '../services/headingLayer';
import { oscillate, interpKeyframes, easeInOutSine, easeOutQuad, springApprox } from '../services/canvasAnimations';
import { blendWrapperProps } from '../services/animBlend';
import { useTransitionPreview } from '../hooks/useTransitionPreview';
import { useFirstFrameCache } from '../hooks/useFirstFrameCache';
import { isWebCodecsPreviewSupported } from '../services/webcodecsSupport';
import {
  useWebCodecsPreview,
  isContentCaughtUp,
  computeDisplayedSegment,
  computeAnimTimeInSegment,
  computeOverlayHoldState,
  computeSnapReleaseBlend,
  computeBlendProgress,
  SNAP_RELEASE_BLEND_S,
  type OverlayHoldState,
  type SnapReleaseBlend,
} from '../hooks/useWebCodecsPreview';
import { PreviewCanvas } from './PreviewCanvas';

// Live-preview side of the animation pipeline. The export side lives in
// src/services/canvasAnimations.ts (applySegmentAnimation) — every case
// below imports and calls that module's own helper functions (oscillate,
// interpKeyframes, easeInOutSine, easeOutQuad, springApprox) rather than
// reimplementing the math, so the two paths cannot drift apart. If you add
// a new AnimationType case, add it to canvasAnimations.ts first and port
// the formula here unchanged (only the CSS transform/opacity property it's
// assigned to differs from the canvas ctx transform equivalent).
/**
 * Returns wrapper props for the intra-segment media wrapper, as a plain
 * `{ style }` object computed fresh from `timeInSegment` every render (the
 * Framer-Motion-wall-clock approach — `repeat: Infinity` keyframes,
 * mount-triggered entry tweens — was replaced in Phase A; see
 * docs/webcodecs-architecture-plan.md Section 8.1). The outer motion.div
 * drives cross-segment transition (initial/exit). This inner wrapper drives
 * the looping/entry camera-dynamics animation: pauses freeze it, seeks jump
 * it exactly, and it matches canvasAnimations.ts frame-for-frame.
 *
 * NB: segmentDuration is needed for time-scaled entry animations (ZOOM_OUT)
 * and KEN_BURNS; pass it in from the consuming component.
 */
function getAnimationWrapperProps(
  animation: AnimationType,
  segmentDuration: number,
  timeInSegment: number,
): Record<string, unknown> {
  switch (animation) {
    case AnimationType.NONE:
      return {};

    // Zoom / Ken Burns are driven by timeInSegment (the playhead position
    // within the segment), NOT Framer Motion's wall-clock. A plain static
    // `transform` recomputed each render keeps preview in lockstep with the
    // playhead — pauses freeze, seeks jump correctly, speed follows playback —
    // and mirrors the export canvas math in canvasAnimations.ts (0.05/sec).
    case AnimationType.KEN_BURNS: {
      const scale = 1.0 + 0.05 * timeInSegment;
      const translateX = 0.5 * timeInSegment; // slow pan right, px
      return { style: { transform: `scale(${scale}) translateX(${translateX}px)`, transformOrigin: 'center center' } };
    }

    case AnimationType.ZOOM_IN: {
      const scale = 1.0 + 0.05 * timeInSegment;
      return { style: { transform: `scale(${scale})`, transformOrigin: 'center center' } };
    }

    case AnimationType.ZOOM_OUT: {
      const endScale = 1.0 + 0.05 * segmentDuration;
      const scale = endScale - 0.05 * timeInSegment;
      return { style: { transform: `scale(${scale})`, transformOrigin: 'center center' } };
    }

    // Phase A (webcodecs-architecture-plan.md Section 8.1) — the remaining
    // 10 types below are all now driven by timeInSegment, mirroring the
    // exact formulas/constants in canvasAnimations.ts (same helpers,
    // imported directly — not reimplemented — to guarantee zero drift).
    // Framer's own wall-clock `repeat: Infinity` / mount-triggered tweens
    // are gone: pauses freeze, seeks jump exactly, and preview matches
    // export frame-for-frame. This intentionally drops each type's former
    // opacity fade-in (BOUNCE/ROTATE/SKEW/GLITCH) — canvas math has no
    // effect on alpha for these, so preview no longer invents one either.
    case AnimationType.FLOAT: {
      const dy = oscillate(timeInSegment, 3, 20);
      return { style: { transform: `translateY(${dy}px)` } };
    }

    case AnimationType.SHAKE: {
      const dx = oscillate(timeInSegment, 0.1, 10);
      return { style: { transform: `translateX(${dx}px)` } };
    }

    case AnimationType.PULSE: {
      const scale = 1 + 0.05 * easeInOutSine(timeInSegment % 1);
      return { style: { transform: `scale(${scale})`, transformOrigin: 'center center' } };
    }

    case AnimationType.WOBBLE: {
      const angleDeg = oscillate(timeInSegment, 1, 5);
      return { style: { transform: `rotate(${angleDeg}deg)` } };
    }

    case AnimationType.HEARTBEAT: {
      const scale = interpKeyframes((timeInSegment / 1.2) % 1, [1, 1.2, 1, 1.1, 1]);
      return { style: { transform: `scale(${scale})`, transformOrigin: 'center center' } };
    }

    case AnimationType.BOUNCE: {
      // Entry spring: from -30px to 0 over first 0.6s, then hold — matches
      // canvasAnimations.ts exactly (raw px, unscaled per decision A).
      const entryDur = 0.6;
      const progress = Math.min(timeInSegment / entryDur, 1);
      const dy = -30 * (1 - Math.min(springApprox(progress * 5), 1));
      return { style: { transform: `translateY(${dy}px)` } };
    }

    case AnimationType.ROTATE: {
      // Entry spin: -360deg → 0deg over first 1s, then hold.
      const entryDur = 1;
      const progress = Math.min(timeInSegment / entryDur, 1);
      const angleDeg = -360 * (1 - easeOutQuad(progress));
      return { style: { transform: `rotate(${angleDeg}deg)` } };
    }

    case AnimationType.SKEW: {
      // Entry skew: 45deg → 0deg over first 0.3s, then hold.
      const entryDur = 0.3;
      const progress = Math.min(timeInSegment / entryDur, 1);
      const skewXDeg = 45 * (1 - easeOutQuad(progress));
      return { style: { transform: `skewX(${skewXDeg}deg)` } };
    }

    case AnimationType.GLITCH: {
      // Deterministic per-100ms-tick jitter — same seed/formula as export,
      // so the same frame always produces the same jitter in both.
      const tick = Math.floor(timeInSegment * 10);
      const dx = ((tick * 7919) % 11) - 5;
      const dy = ((tick * 6271) % 5) - 2;
      const style: Record<string, unknown> = { transform: `translate(${dx}px, ${dy}px)` };
      if (tick % 3 === 0) style.filter = 'blur(2px)';
      return { style };
    }

    case AnimationType.NEON_FLICKER: {
      // Alpha-only flicker (glow/shadowBlur is a canvas-only export effect —
      // pre-existing, accepted preview/export divergence, unchanged here).
      const alpha = interpKeyframes((timeInSegment / 1.5) % 1, [1, 0.3, 0.8, 0.2, 1, 0.4, 0.9]);
      return { style: { opacity: alpha } };
    }

    default:
      return {};
  }
}

/**
 * Resolves which AnimationType a segment's wrapper should render —
 * effectAnimation slug wins over the legacy segment.animation field, same
 * resolution as the export path in frameRenderer.ts. Factored out so both
 * the live ("to") pose and, during a snap-back release blend (see
 * src/services/animBlend.ts), the frozen ("from") pose resolve identically
 * and can't drift apart.
 */
function resolveSegmentAnimationType(seg: VideoSegment): AnimationType {
  return ((seg.effectAnimation && seg.effectAnimation !== 'none')
    ? seg.effectAnimation as AnimationType
    : seg.animation) ?? AnimationType.NONE;
}

/**
 * Live-preview CSS for the filter/pixel clip effects (effectAnimation slug).
 * Zoom/ken-burns return {} — those are driven by the Framer Motion wrapper
 * (getAnimationWrapperProps) instead. duotone is a CSS approximation of the
 * canvas pixel op; preview ≠ export pixel-perfect by design.
 */
function getClipEffectStyle(slug: string | undefined): React.CSSProperties {
  switch (slug) {
    case 'color-grade':
      return { filter: 'brightness(1.05) contrast(1.15) saturate(1.25)' };
    case 'gaussian-blur':
      return { filter: 'blur(6px)' };
    case 'sepia':
      return { filter: 'sepia(0.85)' };
    case 'invert':
      return { filter: 'invert(1)' };
    case 'duotone':
      // CSS approximation: sepia + hue-rotate gives a duotone-like look.
      return { filter: 'sepia(1) hue-rotate(200deg) saturate(3)' };
    case 'zoom-in':
    case 'zoom-out':
    case 'ken-burns':
      return {}; // handled by Framer Motion wrapper (getAnimationWrapperProps)
    default:
      return {};
  }
}

/**
 * Phase A3 companion fix — the segment immediately preceding `seg` in
 * timeline order (its own end coincides with `seg`'s own start). Used to
 * find the OUTGOING segment for caption-hold purposes: useTransitionPreview
 * now places its blend window AFTER the nominal boundary (matching export),
 * so `currentSegment` itself flips to the INCOMING segment at the window's
 * start rather than its end. The caption must keep reading the outgoing
 * segment's text for the life of the (shifted) transition window/overlay
 * hold, or it shows the wrong segment's text for most of the blend.
 */
function findOutgoingSegment(segments: VideoSegment[], seg: VideoSegment | undefined): VideoSegment | undefined {
  if (!seg) return undefined;
  return segments.find(s => Math.abs(s.startTime + s.duration - seg.startTime) < 0.001 && s.id !== seg.id);
}

/**
 * D10 fix — resolves once a video element has actually painted a frame at
 * its current seek target, not merely "buffered enough to maybe play" (all
 * 'canplay' guarantees — it can fire before anything is decoded/presented,
 * which is why an earlier canplay-based mitigation for the preview
 * transition black-flash never engaged reliably).
 *
 * Fallback chain: requestVideoFrameCallback (fires only after a frame is
 * submitted for compositing) -> 'seeked' + one rAF tick as a best-effort
 * proxy on engines without rVFC -> a fixed timeout so callers never hang.
 * Never rejects.
 */
function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let rvfcHandle: number | undefined;
    let onSeeked: (() => void) | undefined;

    const rvfcVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (rvfcHandle !== undefined) {
        rvfcVideo.cancelVideoFrameCallback?.(rvfcHandle);
      }
      if (onSeeked) {
        video.removeEventListener('seeked', onSeeked);
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    if (typeof rvfcVideo.requestVideoFrameCallback === 'function') {
      rvfcHandle = rvfcVideo.requestVideoFrameCallback(() => finish());
    } else {
      onSeeked = () => requestAnimationFrame(() => finish());
      video.addEventListener('seeked', onSeeked);
    }

    const timeoutId = setTimeout(finish, 400);
  });
}

interface GlobalOverlayConfig {
  fontFamily: string;
  color: string;
  backgroundColor: string;
  fontWeight?: number | string;
  fontStyle?: string;
  textShadow?: string;
}

interface Props {
  segments: VideoSegment[];
  currentSegment: VideoSegment | undefined;
  currentTime: number;
  globalPlaybackSpeed: number;
  globalTransition: TransitionType;
  globalTransitionDuration: number;
  globalOverlayConfig: GlobalOverlayConfig;
  globalOverlayFilter?: string;
  assets: Asset[];
  isPlaying: boolean;
  isResizingRef: React.RefObject<boolean>;
  /** Called when the user drags an extra overlay to a new position. */
  onUpdateExtraOverlayPosition?: (segmentId: string, overlayId: string, x: number, y: number) => void;
  /** Global text layers rendered above all segment content. */
  textLayers?: TextOverlay[];
  /** Path B heading layer (docs/path-b-heading-layer-plan.md) — composited on
   *  top of the frame via getActiveHeadingAt(headings, currentTime). */
  headings?: HeadingOverlay[];
}

export function PreviewStage({
  segments,
  currentSegment,
  currentTime,
  globalPlaybackSpeed,
  globalTransition,
  globalTransitionDuration,
  globalOverlayConfig,
  globalOverlayFilter,
  assets,
  isPlaying,
  isResizingRef,
  onUpdateExtraOverlayPosition,
  textLayers,
  headings,
}: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // WebCodecs preview path — mounts whenever the runtime supports it
  // (isWebCodecsPreviewSupported is the sole gate); the legacy <video>-element
  // path below remains as the fallback for unsupported runtimes. See
  // docs/webcodecs-architecture-plan.md.
  const useWebCodecsPath = isWebCodecsPreviewSupported();
  // Read inside the legacy segment-change effect (dep array intentionally
  // excludes it, same rationale as currentTimeRef below).
  const useWebCodecsPathRef = useRef(useWebCodecsPath);
  useEffect(() => { useWebCodecsPathRef.current = useWebCodecsPath; }, [useWebCodecsPath]);

  // Canvas overlay for transition blending
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // FIX 1 — Dual persistent video elements (A/B slot pingpong).
  // Neither element is ever unmounted; we swap which is visible on segment change.
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const headingVideoRef = useRef<HTMLVideoElement>(null);
  const [activeSlot, setActiveSlot] = useState<'a' | 'b'>('a');
  const activeSlotRef = useRef<'a' | 'b'>('a');
  // D10 fix — tracks which segment id each video slot has been pre-seeked
  // and confirmed-painted for, so the swap effect can reveal instantly on
  // the common (warmed) path instead of racing video decode.
  const warmedSegmentIdRef = useRef<{ a: string | null; b: string | null }>({ a: null, b: null });
  // Per-slot generation counter — invalidates a pending warm/reveal wait
  // when a later effect run repurposes the same slot before it resolves.
  const videoOpGenerationRef = useRef<{ a: number; b: number }>({ a: 0, b: 0 });
  // FIX 2 — Mirror currentTime in a ref so effects can read it without dep churn.
  const currentTimeRef = useRef(currentTime);

  // Transition-flicker (Bug 1) / animation-hard-cut (Bug 2) fix — see the
  // synchronization block below (right after webCodecsPreview is set up)
  // for the full explanation. These are read AND written synchronously at
  // render time there, not inside effects, so refs (not state) are correct.
  const displayedSegmentRef = useRef<VideoSegment | undefined>(undefined);
  const overlayHoldStateRef = useRef<OverlayHoldState>({ wasTransitionActive: false, holding: false });

  // Snap-back fix (docs/webcodecs-architecture-plan.md, Phase A3 entry's
  // "residual issue 1") — carries the animation-transform release blend's
  // state across renders (see computeSnapReleaseBlend in
  // useWebCodecsPreview.ts), and the previous render's own animTimeInSegment
  // so the blend's "from" pose can be frozen at the exact value that was
  // actually on screen the render before release.
  const snapReleaseRef = useRef<SnapReleaseBlend>({ releaseAt: null, fromSegment: undefined, fromTimeInSegment: 0 });
  const lastAnimTimeInSegmentRef = useRef<number>(0);

  // //FFCACHE — First-frame cache (Phase 1 correctness layer). Warms a cached
  // frame per video segment at sync/idle time; `coverState` tracks which segment
  // (if any) we are currently masking with a cached frame while its live <video>
  // slot decodes. Rendered ABOVE both video slots (not below, per the naive
  // z-order) because the existing ping-pong keeps the OUTGOING slot visible until
  // the incoming slot paints — the cover must hide that stale frame. url is read
  // live from the cache at render time (below) so a frame that finishes decoding
  // after the cover is armed still appears without re-arming.
  const { getFirstFrame } = useFirstFrameCache(segments, assets, isPlaying);
  const [coverState, setCoverState] = useState<{ segmentId: string } | null>(null);

  // Heading container measurement — ResizeObserver drives px font sizing so
  // the heading scales with the preview container, not the viewport (vh units).
  const [headingContainerHeight, setHeadingContainerHeight] = useState(0);
  const headingContainerRef = useRef<HTMLDivElement>(null);

  // Stage height measurement — ResizeObserver so caption font/bubble scale
  // proportionally to the live stage size, mirroring frameRenderer's refScale math.
  const [stageHeight, setStageHeight] = useState(0);

  // Ref for the stage container — used for percentage coordinate calculation
  const stageRef = useRef<HTMLDivElement>(null);
  // Refs for individual overlay elements — keyed by overlay.id
  const overlayRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Active drag state — stored in a ref to avoid stale closures in pointer handlers
  const dragState = useRef<{
    overlayId: string;
    segmentId: string;
    startPointerX: number;
    startPointerY: number;
    startPctX: number;
    startPctY: number;
  } | null>(null);

  const handleOverlayPointerDown = useCallback((
    e: React.PointerEvent<HTMLDivElement>,
    overlayId: string,
    segmentId: string,
    currentPctX: number,
    currentPctY: number,
  ) => {
    if (!onUpdateExtraOverlayPosition) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      overlayId,
      segmentId,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startPctX: currentPctX,
      startPctY: currentPctY,
    };
  }, [onUpdateExtraOverlayPosition]);

  const handleOverlayPointerMove = useCallback((
    e: React.PointerEvent<HTMLDivElement>,
    overlayId: string,
  ) => {
    const drag = dragState.current;
    if (!drag || drag.overlayId !== overlayId) return;
    if (!onUpdateExtraOverlayPosition) return;

    const stage = stageRef.current;
    const overlayEl = overlayRefs.current.get(overlayId);
    if (!stage) return;

    const stageW = stage.offsetWidth;
    const stageH = stage.offsetHeight;
    if (stageW === 0 || stageH === 0) return;

    const dxPct = ((e.clientX - drag.startPointerX) / stageW) * 100;
    const dyPct = ((e.clientY - drag.startPointerY) / stageH) * 100;

    let newX = drag.startPctX + dxPct;
    let newY = drag.startPctY + dyPct;

    // Hard-clamp to viewport bounds (locked decision 4).
    // The overlay uses translate(-50%, -50%) so the percentage is the center.
    if (overlayEl) {
      const halfWPct = (overlayEl.offsetWidth / stageW) * 100 / 2;
      const halfHPct = (overlayEl.offsetHeight / stageH) * 100 / 2;
      newX = Math.max(halfWPct, Math.min(100 - halfWPct, newX));
      newY = Math.max(halfHPct, Math.min(100 - halfHPct, newY));
    }

    onUpdateExtraOverlayPosition(drag.segmentId, overlayId, newX, newY);
  }, [onUpdateExtraOverlayPosition]);

  const handleOverlayPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  // ---------------------------------------------------------------------------
  // Transition preview — pre-roll snapshot blend
  // ---------------------------------------------------------------------------
  const computedFilter = globalOverlayFilter ? getFilterStyle(globalOverlayFilter) : undefined;
  const globalConfig = {
    overlayConfig: globalOverlayConfig,
    globalOverlayFilter: (computedFilter && computedFilter !== 'none') ? computedFilter : undefined,
  };

  // Phase 1+2 WebCodecs preview path. `enabled` gates ALL work inside the
  // hook (including decode session creation) — when false, this call is
  // inert. Computed BEFORE useTransitionPreview below (B2 plumbing, item-4
  // audit) so its already-live `frame`/`frameSegmentId`/`pool` can be
  // threaded straight into that hook's params — useTransitionPreview
  // doesn't depend on anything defined between the two calls, so this
  // reordering is behavior-neutral for both hooks.
  const webCodecsPreview = useWebCodecsPreview({
    segments,
    assets,
    currentSegment,
    currentTime,
    enabled: useWebCodecsPath,
  });

  const transitionPreview = useTransitionPreview({
    segments,
    currentTime,
    assets,
    globalTransition,
    globalTransitionDuration,
    globalConfig,
    isResizingRef,
    // B2 plumbing (item-4 audit) — not used by useTransitionPreview yet
    // (that's B3); threaded through now so B3 doesn't need another
    // cross-file change here.
    pool: webCodecsPreview.pool,
    incomingFrame: webCodecsPreview.frame,
    incomingFrameSegmentId: webCodecsPreview.frameSegmentId,
  });

  // ---------------------------------------------------------------------------
  // Bug 1 (transition flicker) + Bug 2 (animation hard-cut) fix.
  //
  // Root cause, confirmed via the [DIAG] timestamps above: `currentSegment`
  // (and everything computed synchronously from it every render — the
  // animation transform below, useTransitionPreview's own `isActive`) flips
  // in a single render the instant currentTime crosses a segment boundary.
  // But useWebCodecsPreview's `frame` is committed asynchronously — measured
  // up to ~436ms after the flip under real decode load, with zero frame
  // updates in between — so the WebCodecs canvas keeps painting the OUTGOING
  // segment's last frame for that whole window while everything else has
  // already moved on to the incoming segment's zero-state. `frameSegmentId`
  // (see that hook) tells us exactly when the gap closes; both fixes below
  // gate on it directly instead of assuming the swap is instantaneous or
  // waiting a fixed delay.
  //
  // Computed synchronously at render time (not inside a useEffect) — the
  // very render where the boundary crosses must already reflect this, or a
  // single un-gated frame is enough to show the bug. This is the same
  // "read a ref directly at render time, not as an effect dependency"
  // pattern useTransitionPreview.ts already uses for isResizingRef, for the
  // identical reason: an effect would only correct things one paint later,
  // which is smaller than but the same class of gap this fix closes.
  // ---------------------------------------------------------------------------
  const contentCaughtUp = isContentCaughtUp(currentSegment?.id, webCodecsPreview.isVideoSegment, webCodecsPreview.frameSegmentId);

  // Bug 2 — which segment's content (and therefore which segment's own
  // animation transform) is actually on screen right now.
  const previousAnimSegment = displayedSegmentRef.current;
  displayedSegmentRef.current = computeDisplayedSegment(currentSegment, contentCaughtUp, previousAnimSegment);
  const animSegment = displayedSegmentRef.current;
  const animTimeInSegment = computeAnimTimeInSegment(animSegment, currentTime);

  // Snap-back fix (docs/webcodecs-architecture-plan.md, Phase A3 entry's
  // "residual issue 1") — the hold above makes the animation transform
  // correct WHILE content is catching up, but otherwise releases with a
  // hard one-frame snap. Detect the exact release edge and blend the
  // wrapper's own transform/opacity output (not a mask) from its frozen
  // pose toward the new segment's live pose over a short, currentTime-
  // driven window — see computeSnapReleaseBlend's own doc for why this is
  // additive to (does not modify) the Bug 2 hold above.
  snapReleaseRef.current = computeSnapReleaseBlend(
    snapReleaseRef.current,
    previousAnimSegment,
    animSegment,
    lastAnimTimeInSegmentRef.current,
    currentTime,
  );
  const animBlendProgress = computeBlendProgress(snapReleaseRef.current, currentTime, SNAP_RELEASE_BLEND_S);
  lastAnimTimeInSegmentRef.current = animTimeInSegment;

  // Bug 1 — hold the transition overlay visible (at its last-blended
  // content — the existing "do NOT clearRect" retention in the draw effect
  // below already keeps that content painted) past the moment its own
  // transition window closes, for as long as content hasn't caught up to
  // the segment it's handing off to.
  const overlayHoldState = computeOverlayHoldState(overlayHoldStateRef.current, transitionPreview.isActive, contentCaughtUp);
  overlayHoldStateRef.current = overlayHoldState;
  const showTransitionOverlay = transitionPreview.isActive || overlayHoldState.holding;

  // Phase A3 companion fix — the body caption (below) is not occluded by the
  // canvas overlay (it paints above it, z-46 vs z-45) and previously read
  // `currentSegment` directly on the assumption that `currentSegment` only
  // flips to the incoming segment exactly when the transition window ends.
  // That assumption no longer holds now that useTransitionPreview's blend
  // window sits AFTER the boundary (matching export) — `currentSegment`
  // flips at the window's START instead. Hold the caption on the outgoing
  // segment for as long as the overlay itself is showing, so the caption
  // still reads as steady throughout the crossfade.
  const captionSegment = showTransitionOverlay
    ? (findOutgoingSegment(segments, currentSegment) ?? currentSegment)
    : currentSegment;

  // Draw the transition blend onto the overlay canvas whenever preview state changes.
  // The canvas is sized to match the stage via CSS (position:absolute inset-0).
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    if (!transitionPreview.isActive || !transitionPreview.outgoing || !transitionPreview.incoming) {
      // INTENTIONAL: do NOT clearRect here.
      //
      // The canvas element has CSS `transition: opacity 100ms ease`. When isActive
      // flips false, opacity animates 1 → 0 over 100ms. Calling clearRect now would
      // erase the last drawn frame in a useEffect that fires post-paint, leaving
      // the canvas visually transparent within ~16ms (well before the 100ms CSS
      // fade completes). With nothing drawn on the canvas, bg-black underneath
      // shows through during the video decode latency window (50-200ms), producing
      // a visible black flash on video segments.
      //
      // Retaining the last frame (incoming snapshot at progress=1) keeps the canvas
      // visually showing the target media while the live video element decodes its
      // first frame underneath. The draw path below always clearRects before drawing,
      // so this stale content is cleaned up on the next transition's frame 0 — at
      // which point CSS opacity is near 0 again and the stale frame is invisible.
      return;
    }

    // Size canvas to match its CSS display size
    const w = canvas.offsetWidth || 960;
    const h = canvas.offsetHeight || 540;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // B3 (item-4 fix) — when the WebCodecs-capable live path is genuinely
    // caught up to currentSegment (contentCaughtUp, computed above from the
    // same frame/frameSegmentId this transition's own incoming side is
    // sourced from — see useWebCodecsPreview.ts), blit its live frame onto
    // transitionPreview.incoming's persistent canvas right before
    // compositing below. During an active blend window incomingSeg is
    // always currentSegment (useTransitionPreview's own candidate-B
    // window), so webCodecsPreview.frame is guaranteed to belong to the
    // right segment whenever contentCaughtUp is true — this is what makes
    // the INCOMING side of the blend live instead of a frozen one-shot
    // snapshot. Falls through to whatever transitionPreview.incoming
    // already holds (the one-shot snapshot, non-video incoming segment, or
    // a not-yet-caught-up live frame) on every other path — strictly an
    // upgrade over today's frozen behavior, never worse.
    if (useWebCodecsPath && webCodecsPreview.isVideoSegment && contentCaughtUp && webCodecsPreview.frame) {
      try {
        const incCanvas = transitionPreview.incoming;
        const incCtx = incCanvas.getContext('2d');
        const frame = webCodecsPreview.frame;
        const frameW = frame.displayWidth;
        const frameH = frame.displayHeight;
        if (incCtx && frameW && frameH) {
          // object-cover source rect — mirrors PreviewCanvas.tsx's identical
          // VideoFrame-to-canvas fit math.
          const canvasRatio = incCanvas.width / incCanvas.height;
          const frameRatio = frameW / frameH;
          let sx = 0, sy = 0, sw = frameW, sh = frameH;
          if (frameRatio > canvasRatio) {
            sw = frameH * canvasRatio;
            sx = (frameW - sw) / 2;
          } else {
            sh = frameW / canvasRatio;
            sy = (frameH - sh) / 2;
          }
          incCtx.clearRect(0, 0, incCanvas.width, incCanvas.height);
          incCtx.drawImage(frame, sx, sy, sw, sh, 0, 0, incCanvas.width, incCanvas.height);
        }
      } catch {
        // Frame closed between being handed to this component and this draw
        // running (pool eviction/scrub-reset race) — same documented hazard
        // as PreviewCanvas.tsx's own drawImage call. Skip this tick's
        // update; transitionPreview.incoming keeps whatever it last held.
      }
    }

    // Draw outgoing snapshot as the base layer
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(transitionPreview.outgoing, 0, 0, w, h);

    // Composite incoming snapshot on top via the same blend logic used in export
    applyTransitionBlend(ctx, {
      adjacentCanvas: transitionPreview.incoming,
      alpha: transitionPreview.progress,
      type: transitionPreview.effectiveTransition,
    }, w, h);
  }, [
    transitionPreview.isActive,
    transitionPreview.progress,
    transitionPreview.outgoing,
    transitionPreview.incoming,
    transitionPreview.effectiveTransition,
    useWebCodecsPath,
    webCodecsPreview.isVideoSegment,
    webCodecsPreview.frame,
    contentCaughtUp,
  ]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleNativeFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn(`Error attempting to enable full-screen mode: ${err.message}`);
        setIsFullscreen(true);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // Suppress Framer Motion entry/exit animations while canvas is handling the
  // transition — extended through the Bug 1 hold window (showTransitionOverlay),
  // not just the raw transition window, so the wrapper doesn't attempt its own
  // entrance animation while the overlay is still covering for content catch-up.
  const suppressMotionAnim = showTransitionOverlay;

  // Snap-back fix — the intra-segment animation wrapper's actual props.
  // During the release-blend window (animBlendProgress < 1), blends the
  // frozen OUTGOING pose's own transform/opacity toward the CURRENT
  // segment's live pose (src/services/animBlend.ts); otherwise this is
  // byte-identical to calling getAnimationWrapperProps directly, exactly as
  // before this fix. Gated on suppressMotionAnim the same way the direct
  // call already was — while the transition overlay is covering the
  // screen, no wrapper transform is applied at all (unchanged behavior).
  const animationWrapperProps = (() => {
    if (suppressMotionAnim) return {};
    const toSeg = animSegment ?? currentSegment;
    if (!toSeg) return {};
    const toProps = getAnimationWrapperProps(resolveSegmentAnimationType(toSeg), toSeg.duration, animTimeInSegment);
    const fromSeg = snapReleaseRef.current.fromSegment;
    if (animBlendProgress >= 1 || !fromSeg) return toProps;
    const fromProps = getAnimationWrapperProps(
      resolveSegmentAnimationType(fromSeg),
      fromSeg.duration,
      snapReleaseRef.current.fromTimeInSegment,
    );
    return blendWrapperProps(fromProps, toProps, animBlendProgress);
  })();

  // FIX 2 — Keep currentTimeRef current so the segment-change effect can read
  // playhead position without adding `currentTime` to its dep array (which would
  // fire the effect on every 100 ms playback tick and re-seek constantly).
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  // FIX 3 — Seek helper: defers the seek until the element has buffered enough
  // data (readyState >= HAVE_FUTURE_DATA) so the seek is not silently dropped on
  // a freshly loaded src.
  const seekToTime = (el: HTMLVideoElement, targetTime: number): void => {
    if (el.readyState >= 3) {
      el.currentTime = targetTime;
    } else {
      const onCanPlay = () => {
        el.currentTime = targetTime;
        el.removeEventListener('canplay', onCanPlay);
      };
      el.addEventListener('canplay', onCanPlay);
    }
  };

  // FIX 1 — Segment-change handler: swap A/B slots (pingpong), load current
  // segment into the newly active slot, preload the next segment into the idle slot.
  // Dep array is intentionally [currentSegment?.id] — volatile values (assets,
  // segments, isPlaying, globalPlaybackSpeed) are read at effect-run time; including
  // them would re-fire on every state update and defeat the preload optimisation.
  //
  // D10 fix — the idle slot is now pre-seeked (not just loaded) to the next
  // segment's start time during preload, and the active-slot reveal is gated
  // on an actual painted frame (waitForVideoFrame) rather than flipped
  // synchronously with the seek. On the common path (segment was warmed
  // during the previous segment's playback) the reveal is immediate; the
  // canvas "do NOT clearRect" hold (see the transition-blend effect above)
  // remains as the fallback visual for the rare unwarmed case.
  useEffect(() => {
    // //FFCACHE — leaving a video segment (to nothing / image / color / missing):
    // drop any cached-frame cover so it can't linger over the new content.
    if (!currentSegment) { setCoverState(null); return; }
    const currentAsset = assets.find(a => a.id === currentSegment.assetId);
    if (currentAsset?.type !== 'video') { setCoverState(null); return; }
    // WebCodecs preview path — when the runtime supports it, useWebCodecsPreview
    // owns decode/paint for this segment's video via PreviewCanvas (rendered
    // below); the legacy dual <video>-slot machinery below must not also
    // load/seek/play these elements. Read via ref (not a dep) — same rationale
    // as currentTimeRef's ref-read pattern.
    if (useWebCodecsPathRef.current) { setCoverState(null); return; }
    // D12 fix — a timeline resize-drag rewrites startTime for every segment
    // after the dragged one while currentTime stays put, which can flip
    // currentSegment?.id to a neighbor purely from the boundary shift (not a
    // real playhead move). Skip this run so we don't hard-seek to the new
    // segment's start; App clears isResizingRef (after this effect, same
    // commit — see the resizingId effect in App.tsx) once the drag settles,
    // so the next genuine currentTime change resolves normally.
    if (isResizingRef.current) return;

    // Swap slots: the idle slot was preloading this segment — promote it to active.
    const prevSlot = activeSlotRef.current;
    const newSlot: 'a' | 'b' = prevSlot === 'a' ? 'b' : 'a';

    const activeEl  = newSlot === 'a' ? videoARef.current : videoBRef.current;
    const inactiveEl = newSlot === 'a' ? videoBRef.current : videoARef.current;

    if (!activeEl) return;

    // Load current segment (no-op when preload already set the correct src).
    const isNewActiveSrc = activeEl.src !== currentAsset.url;
    if (isNewActiveSrc) {
      activeEl.src = currentAsset.url;
      activeEl.load();
      warmedSegmentIdRef.current[newSlot] = null;
    }

    // Seek to the correct intra-segment position.
    const segmentProgress = currentTimeRef.current - (currentSegment.startTime ?? 0);
    const rawTime = (currentSegment.trimStart || 0) + segmentProgress * (currentSegment.playbackSpeed || 1);
    const videoTime = currentSegment.trimEnd !== undefined
      ? Math.min(rawTime, currentSegment.trimEnd)
      : rawTime;
    const clampedVideoTime = Math.max(0, videoTime);
    seekToTime(activeEl, clampedVideoTime);

    activeEl.playbackRate = (currentSegment.playbackSpeed || 1) * globalPlaybackSpeed;

    if (isPlaying) {
      activeEl.play().catch(() => {});
    } else {
      activeEl.pause();
    }

    const segId = currentSegment.id;
    const isHeadingSeg = !!(currentSegment.isHeading || currentSegment.heading);

    // //FFCACHE — the live slot is genuinely showing THIS segment only when it
    // was preloaded+painted for this exact id (warmedSegmentIdRef) AND is still
    // decode-ready (readyState>=2). Anything less — a fresh src, a short-clip
    // race where preload hadn't painted yet, a scrub — means the visible slot is
    // still the OUTGOING frame, so we must mask it. This is evaluated on EVERY
    // segment change (playing OR paused) — the previous code short-circuited the
    // warmed path with an immediate reveal and never armed the cover during
    // playback, which is exactly why short clips black-screened.
    const liveReady =
      !isNewActiveSrc &&
      warmedSegmentIdRef.current[newSlot] === segId &&
      activeEl.readyState >= 2;

    const revealGeneration = ++videoOpGenerationRef.current[newSlot];
    const reveal = () => {
      if (videoOpGenerationRef.current[newSlot] !== revealGeneration) return; // superseded
      activeSlotRef.current = newSlot;
      setActiveSlot(newSlot);
      // //FFCACHE — live slot has painted THIS segment's frame: cross-swap off
      // the cached-frame cover. id-guarded so a late reveal from a superseded
      // ping-pong run can't tear down a cover armed for a newer segment.
      setCoverState(prev => {
        if (prev && prev.segmentId === segId) {
          console.log(`//FFCACHE segment ${segId}: cover swapped -> live`);
          return null;
        }
        return prev;
      });
    };

    if (isHeadingSeg) {
      // Heading segments render their own background layer — no cover; just
      // clear any cover armed for this id and reveal per the existing engine.
      console.log(`//FFCACHE segment ${segId}: heading (no cover)`);
      setCoverState(prev => (prev && prev.segmentId === segId) ? null : prev);
      reveal();
    } else if (liveReady) {
      // //FFCACHE — live slot already holds the correct painted frame: show it
      // immediately, no cover needed. Clear any stale cover from a prior segment.
      console.log(`//FFCACHE segment ${segId}: live-immediate (slot painted, readyState>=2, playing=${isPlaying})`);
      setCoverState(prev => (prev && prev.segmentId !== segId) ? null : prev);
      reveal();
    } else {
      // //FFCACHE — mask the still-visible OUTGOING slot with THIS segment's
      // cached first frame (or bg-black if the cache isn't ready — truthful,
      // never the wrong clip) until the live slot paints the correct frame.
      // Runs in the playing path too.
      const cached = getFirstFrame(segId);
      console.log(
        `//FFCACHE segment ${segId}: painting ${cached ? 'cached-frame' : 'bg-black-fallback (cache not ready)'} while live slot decodes (playing=${isPlaying})`,
      );
      setCoverState({ segmentId: segId });
      void waitForVideoFrame(activeEl).then(reveal);
    }

    // Preload the next video segment into the idle slot, and pre-seek it to
    // its own start time so it has already painted a frame by the time it
    // becomes active (this is what makes `alreadyWarmed` true above on the
    // next segment change).
    const currentSegmentIndex = segments.findIndex(s => s.id === currentSegment.id);
    const nextSeg = segments[currentSegmentIndex + 1];
    const nextAsset = nextSeg ? assets.find(a => a.id === nextSeg.assetId) : null;
    const nextVideoUrl = nextAsset?.type === 'video' ? nextAsset.url : null;
    const inactiveSlotName: 'a' | 'b' = newSlot === 'a' ? 'b' : 'a';

    if (inactiveEl && nextSeg && nextVideoUrl) {
      const isNewInactiveSrc = inactiveEl.src !== nextVideoUrl;
      if (isNewInactiveSrc) {
        inactiveEl.src = nextVideoUrl;
        inactiveEl.preload = 'auto';
        inactiveEl.load();
        warmedSegmentIdRef.current[inactiveSlotName] = null;
      }

      if (warmedSegmentIdRef.current[inactiveSlotName] !== nextSeg.id) {
        const warmGeneration = ++videoOpGenerationRef.current[inactiveSlotName];
        const nextTargetTime = Math.max(0, nextSeg.trimStart || 0);
        seekToTime(inactiveEl, nextTargetTime);
        void waitForVideoFrame(inactiveEl).then(() => {
          if (videoOpGenerationRef.current[inactiveSlotName] !== warmGeneration) return; // superseded
          warmedSegmentIdRef.current[inactiveSlotName] = nextSeg.id;
        });
      }
    }
  }, [currentSegment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync play/pause whenever isPlaying toggles (independent of segment changes).
  useEffect(() => {
    // WebCodecs preview path — videoARef/videoBRef never receive a src/load()/seek
    // while this path owns the current segment (see the early-return in the
    // segment-change effect above), so calling play()/pause() on them here would
    // be a no-op today, but only incidentally — gate explicitly so this stays
    // inert by construction, not by accident, matching the segment-change effect.
    if (useWebCodecsPathRef.current) return;
    const activeEl = activeSlotRef.current === 'a' ? videoARef.current : videoBRef.current;
    if (!activeEl) return;
    if (isPlaying) {
      activeEl.play().catch(() => {});
    } else {
      activeEl.pause();
    }
  }, [isPlaying]);

  // Sync heading background video to isPlaying (not covered by the dual-slot effect above).
  useEffect(() => {
    const v = headingVideoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [isPlaying]);

  // Sync playbackRate whenever playbackSpeed or global speed changes
  // without re-seeking (seek only happens on segment transition above).
  useEffect(() => {
    const activeEl = activeSlotRef.current === 'a' ? videoARef.current : videoBRef.current;
    if (!activeEl) return;
    activeEl.playbackRate = (currentSegment?.playbackSpeed || 1) * globalPlaybackSpeed;
  }, [currentSegment?.playbackSpeed, globalPlaybackSpeed]);

  // Re-observe whenever a heading segment mounts; el is null for non-heading segments
  // so the effect is a safe no-op when the heading div is not in the DOM.
  useEffect(() => {
    const el = headingContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setHeadingContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentSegment?.isHeading, currentSegment?.heading]);

  // Observe the stage element once (it is always mounted for the lifetime of
  // PreviewStage). Fires on divider-drag resize AND on fullscreen enter/exit
  // because the stage's className switches to fixed inset-0, changing its
  // layout size — ResizeObserver sees that geometry change automatically.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setStageHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Path B heading layer — active new-layer heading at the current playhead,
  // independent of currentSegment (Decision 4: composites over whichever
  // segment(s) fall within its time range).
  const activeLayerHeading = useMemo(
    () => getActiveHeadingAt(headings ?? [], currentTime),
    [headings, currentTime],
  );

  const isHeadingSegment = !!(currentSegment?.isHeading || currentSegment?.heading);
  const headingText = currentSegment?.headingConfig?.text ?? currentSegment?.heading ?? '';
  const headingLength = headingText.length;
  const baseSize = headingContainerHeight * 0.14;
  const shrinkFactor = Math.max(0.3, 1 - headingLength / 80);
  const headingFontSize = currentSegment?.headingConfig?.fontSize
    ?? Math.max(
      headingContainerHeight * 0.04,
      Math.min(headingContainerHeight * 0.14, baseSize * shrinkFactor),
    );

  // Position-aware anchor: translate(-x%, -y%) scales the inset with the box's own
  // rendered size, so at 0% the box's near edge sits at the preview edge, at 100% the
  // far edge sits at the opposite edge, and at 50% it's centered — fully inside at every value.
  const headingPosX = currentSegment?.headingConfig?.x ?? 50;
  const headingPosY = currentSegment?.headingConfig?.y ?? 50;
  // Phase A3 — driven by captionSegment (not currentSegment directly), so
  // the caption's position stays in lockstep with whichever segment's text
  // is currently shown (see captionSegment's own comment above).
  const overlayPosX = captionSegment?.overlayConfig?.x ?? 50;
  const overlayPosY = captionSegment?.overlayConfig?.y ?? 78;
  // Mirrors frameRenderer's refScale = h / 1080. Defaults to 1 (unscaled)
  // until the ResizeObserver fires after first mount.
  const captionScale = stageHeight > 0 ? stageHeight / 1080 : 1;

  return (
    <div className="w-full h-full">
      <div
        ref={stageRef}
        className={isFullscreen
          ? 'fixed inset-0 z-[5000] flex items-center justify-center bg-black overflow-hidden'
          : 'relative bg-black overflow-hidden group w-full h-full'}
      >
        {/* Floating Controls */}
        <div className="absolute top-6 right-6 z-[1001] flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={toggleNativeFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="p-3 bg-black/50 backdrop-blur-md rounded-xl text-white border border-white/10 hover:bg-[#F27D26] transition-all"
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>

        {/* Dev-only, persistent (not hover-gated) indicator of which video path is
            painting the preview — useful for debugging, has no effect on behavior. */}
        {import.meta.env.DEV && useWebCodecsPath && (
          <div className="absolute top-6 left-6 z-[1001] px-3 py-1.5 rounded-lg bg-[#F27D26] text-black text-[10px] font-black uppercase tracking-wider">
            WebCodecs Preview
          </div>
        )}

        <AnimatePresence mode="popLayout" initial={false}>
          {currentSegment ? (
            <motion.div
              initial={suppressMotionAnim || currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || globalTransition).initial}
              animate={suppressMotionAnim || currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || globalTransition).animate}
              exit={suppressMotionAnim || currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || globalTransition).exit}
              transition={{ duration: suppressMotionAnim || currentSegment.transition === TransitionType.NONE ? 0 : (currentSegment.transitionDuration ?? globalTransitionDuration) }}
              className="absolute inset-0 bg-black"
            >
              {/* Visuals — media wrapper carries intra-segment camera-dynamics animation.
                  Suppressed when canvas just handled the transition: BOUNCE/SKEW/ROTATE
                  return initial:{opacity:0} which would produce a black flash on entry.
                  animationWrapperProps (computed above) is driven by animSegment (the
                  segment whose content is actually on screen, per the WebCodecs catch-up
                  gate) — not currentSegment directly — and blends smoothly across the
                  Bug 2 hold's release edge instead of hard-cutting (see its own comment
                  and src/services/animBlend.ts). */}
              <motion.div
                className="absolute inset-0 overflow-hidden"
                {...animationWrapperProps}
              >
                {(() => {
                  const asset = assets.find(a => a.id === currentSegment.assetId);
                  // Heading backgrounds are rendered in their own block below; exclude them
                  // from the dual-slot system so the imperative src assignment doesn't fire.
                  const isVideoAsset = !isHeadingSegment && !!(asset?.url && asset.type === 'video');
                  return (
                    <>
                      {/* FIX 1 + FIX 4 — Dual persistent video slots. Both elements stay
                          in the DOM at all times; only the active slot is visible. The src
                          is set imperatively by the segment-change effect, never via JSX,
                          so React never unmounts the element when currentSegment changes.
                          preload="auto" tells the browser to buffer the full video. */}
                      <video
                        ref={videoARef}
                        className={`absolute inset-0 w-full h-full object-cover${isVideoAsset && activeSlot === 'a' ? '' : ' opacity-0 pointer-events-none'}`}
                        style={getClipEffectStyle(currentSegment.effectAnimation)}
                        muted
                        playsInline
                        preload="auto"
                      />
                      <video
                        ref={videoBRef}
                        className={`absolute inset-0 w-full h-full object-cover${isVideoAsset && activeSlot === 'b' ? '' : ' opacity-0 pointer-events-none'}`}
                        style={getClipEffectStyle(currentSegment.effectAnimation)}
                        muted
                        playsInline
                        preload="auto"
                      />
                      {/* //FFCACHE — Cached first-frame cover (Phase 1 correctness layer).
                          Painted ABOVE both video slots (later sibling → paints on top) while
                          the live slot for THIS segment is still decoding, so the preview shows
                          the CORRECT clip's frame instead of the outgoing slot's stale frame.
                          Cross-swapped off by `reveal()` the instant the live slot paints. When
                          the cache isn't ready yet it renders bg-black (truthful) — never a wrong
                          clip. Inside the animation wrapper so it inherits the same ken-burns /
                          zoom transform as the video it masks. */}
                      {isVideoAsset && coverState?.segmentId === currentSegment.id && (
                        (() => {
                          const coverUrl = getFirstFrame(coverState.segmentId);
                          return coverUrl ? (
                            <img
                              src={coverUrl}
                              className="absolute inset-0 w-full h-full object-cover"
                              style={getClipEffectStyle(currentSegment.effectAnimation)}
                              alt=""
                            />
                          ) : (
                            <div className="absolute inset-0 bg-black" />
                          );
                        })()
                      )}
                      {/* WebCodecs preview path (capability-gated) — paints above the
                          (inert, in this branch) legacy video slots and cover.
                          getClipEffectStyle is passed through so CSS clip-effect filters
                          keep applying, matching the legacy path's parity intent. */}
                      {isVideoAsset && useWebCodecsPath && webCodecsPreview.isVideoSegment && (
                        <PreviewCanvas
                          frame={webCodecsPreview.frame}
                          className="absolute inset-0 w-full h-full"
                          style={getClipEffectStyle(currentSegment.effectAnimation)}
                        />
                      )}
                      {/* Image segments */}
                      {asset?.url && !isVideoAsset && (
                        // Fade-in on segment enter; suppressed when canvas just handled the
                        // transition (suppressMotionAnim) to avoid a black-to-image stutter
                        // immediately after the canvas blend completes.
                        <motion.img
                          key={currentSegment.id}
                          src={asset.url}
                          className="w-full h-full object-cover"
                          style={getClipEffectStyle(currentSegment.effectAnimation)}
                          initial={{ opacity: suppressMotionAnim ? 1 : 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.4 }}
                        />
                      )}
                      {/* Heading segment — background (asset or solid color) + text overlay.
                          Rendered unconditionally when isHeadingSegment; asset and text are
                          independent so a background image/video does not hide the text. */}
                      {isHeadingSegment && (
                        <div
                          ref={headingContainerRef}
                          className="absolute inset-0 z-30"
                        >
                          {/* Background layer */}
                          {asset?.url ? (
                            asset.type === 'video' ? (
                              <video
                                key={asset.url}
                                ref={headingVideoRef}
                                src={asset.url}
                                muted
                                loop
                                playsInline
                                className="absolute inset-0 w-full h-full object-cover"
                              />
                            ) : (
                              <img
                                src={asset.url}
                                className="absolute inset-0 w-full h-full object-cover"
                                alt=""
                              />
                            )
                          ) : (
                            <div
                              className="absolute inset-0"
                              style={{ backgroundColor: currentSegment.headingConfig?.backgroundColor ?? '#000000' }}
                            />
                          )}
                          {/* Text overlay — always rendered on top of whatever background */}
                          <h1
                            className="absolute font-bold"
                            style={{
                              left: `${headingPosX}%`,
                              top: `${headingPosY}%`,
                              transform: `translate(-${headingPosX}%, -${headingPosY}%)`,
                              width: 'max-content',
                              maxWidth: '90%',
                              textAlign: 'center',
                              zIndex: 1,
                              fontSize: headingContainerHeight === 0 ? '5vh' : `${headingFontSize}px`,
                              fontFamily: currentSegment.headingConfig?.fontFamily ?? globalOverlayConfig.fontFamily ?? 'system-ui, sans-serif',
                              fontWeight: currentSegment.headingConfig?.fontWeight ?? 'bold',
                              color: currentSegment.headingConfig?.color ?? '#ffffff',
                              lineHeight: 1.2,
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: 6,
                              WebkitBoxOrient: 'vertical' as const,
                            }}
                          >
                            {headingText}
                          </h1>
                        </div>
                      )}
                      {/* Missing asset placeholder — not shown for heading segments */}
                      {!asset?.url && !isHeadingSegment && (
                        <div className="w-full h-full bg-gradient-to-br from-[#111] to-[#050505]
                                        flex items-center justify-center p-6 text-center">
                          <div className="flex flex-col items-center gap-3 opacity-60">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-10 h-10 text-yellow-400"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={1.5}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0
                                   2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898
                                   0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                              />
                            </svg>
                            <p className="text-yellow-400 text-sm font-medium">Missing asset</p>
                            <p className="text-gray-500 text-xs">
                              Upload or assign an asset to this segment
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </motion.div>

              {/* Extra Overlays Rendering — draggable when onUpdateExtraOverlayPosition is provided.
                  Wrapper fades out with the canvas overlay during transitions to prevent
                  double-render (canvas snapshot already contains extra overlays). */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  zIndex: 40,
                  // Bug 1 fix — extended through the hold window (showTransitionOverlay),
                  // same reasoning as the canvas overlay below: don't fade extra overlays
                  // in until the overlay they're handing off from is actually releasing.
                  opacity: showTransitionOverlay ? 0 : 1,
                  transition: 'opacity 100ms ease',
                }}
              >
                {currentSegment.extraOverlays?.map((o) => {
                  const isDraggable = !!onUpdateExtraOverlayPosition;
                  return (
                    <motion.div
                      key={o.id}
                      ref={(el) => {
                        if (el) overlayRefs.current.set(o.id, el);
                        else overlayRefs.current.delete(o.id);
                      }}
                      {...getMotionProps(o.animation || 'fade')}
                      className={`absolute p-4 rounded-xl shadow-lg border border-white/5 select-none${isDraggable ? ' cursor-move' : ' pointer-events-none'}`}
                      onPointerDown={isDraggable
                        ? (e) => handleOverlayPointerDown(e, o.id, currentSegment.id, o.position.x, o.position.y)
                        : undefined}
                      onPointerMove={isDraggable
                        ? (e) => handleOverlayPointerMove(e, o.id)
                        : undefined}
                      onPointerUp={isDraggable ? handleOverlayPointerUp : undefined}
                      style={{
                        left: `${o.position.x}%`,
                        top: `${o.position.y}%`,
                        transform: 'translate(-50%, -50%)',
                        color: o.color,
                        backgroundColor: o.backgroundColor,
                        fontFamily: o.fontFamily,
                        fontSize: `${o.fontSize}px`,
                        fontWeight: o.fontWeight || 'normal',
                        fontStyle: o.fontStyle || 'normal',
                        textShadow: o.textShadow || '0 2px 10px rgba(0,0,0,0.5)',
                        textAlign: o.textAlign || 'center',
                        whiteSpace: 'nowrap',
                        backdropFilter: 'blur(4px)',
                        touchAction: 'none', // required for pointer capture on touch
                        pointerEvents: isDraggable ? 'auto' : 'none',
                      }}
                    >
                      {o.text}
                    </motion.div>
                  );
                })}
              </div>

              {/* Global text layers — rendered above segment extra overlays, below heading/body text */}
              {(textLayers ?? []).length > 0 && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ zIndex: 45 }}
                >
                  {(textLayers ?? [])
                    .filter(l => !(l.hiddenOnSegments ?? []).includes(currentSegment.id))
                    .map((l) => (
                      <div
                        key={l.id}
                        className="absolute p-3 rounded-xl shadow-lg select-none"
                        style={{
                          left: `${l.position.x}%`,
                          top: `${l.position.y}%`,
                          transform: 'translate(-50%, -50%)',
                          color: l.color,
                          backgroundColor: l.backgroundColor,
                          fontFamily: l.fontFamily,
                          fontSize: `${l.fontSize}px`,
                          fontWeight: l.fontWeight || 'normal',
                          fontStyle: l.fontStyle || 'normal',
                          textShadow: l.textShadow || '0 2px 10px rgba(0,0,0,0.5)',
                          textAlign: l.textAlign || 'center',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {l.text}
                      </div>
                    ))}
                </div>
              )}
            </motion.div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
              <MonitorPlay size={64} className="text-gray-800" strokeWidth={1} />
              <span className="text-[10px] font-black uppercase tracking-[0.5em] text-gray-600">Sequence Standby</span>
            </div>
          )}
        </AnimatePresence>

        {/*
          Canvas overlay for preview transitions (z-index 45, above extra overlays at 40).
          CSS opacity + transition provides the 100ms edge crossfade to mask mount/unmount flash.
          pointer-events:none so it never intercepts clicks.
          Snapshots already contain text+overlays rendered via frameRenderer, so the CSS layer
          is intentionally still visible here — they fade together (canvas fades in as CSS fades
          out naturally with AnimatePresence exit). For a fully correct double-render prevention,
          see the showOverlay gate; complete CSS suppression during canvas transition is not
          needed because the CSS segment motion.div is already exiting via AnimatePresence.
        */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{
            zIndex: 45,
            // Bug 1 fix — showTransitionOverlay (not the raw transitionPreview.isActive)
            // holds this canvas at opacity 1 past the transition window's own end, for as
            // long as the WebCodecs live layer underneath hasn't caught up to the segment
            // this overlay is handing off to. The draw effect above already retains the
            // last-blended (near-fully-incoming) content on the canvas for exactly this
            // window — see its "do NOT clearRect" comment — so holding opacity just keeps
            // that correct content visible instead of prematurely revealing the still-stale
            // live layer beneath it.
            opacity: showTransitionOverlay ? 1 : 0,
            transition: 'opacity 100ms ease',
          }}
        />

        {/* Main body caption — hoisted to be a direct sibling of the transition overlay
            canvas above (not nested inside the per-segment motion.div) so it can paint
            above it. The motion.div sets no z-index of its own, but framer-motion gives
            it a `transform`, which independently forms its own stacking context — a
            z-index on a caption nested inside it would only rank among that motion.div's
            own children and could never outrank this canvas sibling. zIndex 46 clears the
            canvas's 45 while staying below Corner Stats (50). Stays visible through the
            whole transition (no opacity fade); reads captionSegment (not currentSegment
            directly, see its own comment above) so it stays on the OUTGOING segment's
            text/position for as long as the transition overlay is showing, switching to
            the incoming segment's own caption only once the overlay itself releases — so
            the caption reads as steady throughout the crossfade. The transition snapshot
            bakes no caption text (skipCaption, see useTransitionPreview.ts), so there's
            no second caption underneath to dissolve against. */}
        {captionSegment && captionSegment.showOverlay && captionSegment.text && (
          <div className="absolute inset-0 pointer-events-none select-none" style={{ zIndex: 46 }}>
            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              transformTemplate={(_, generated) => `translate(-${overlayPosX}%, -${overlayPosY}%) ${generated}`}
              className="absolute text-center"
              style={{
                left: `${overlayPosX}%`,
                top: `${overlayPosY}%`,
                width: 'max-content',
                maxWidth: '70%',
                padding: `${Math.round(12 * captionScale)}px ${Math.round(20 * captionScale)}px`,
                borderRadius: `${Math.round(24 * captionScale)}px`,
                backgroundColor: captionSegment.overlayConfig?.backgroundColor || globalOverlayConfig.backgroundColor,
              }}
            >
              <p
                className="font-light leading-relaxed tracking-wide drop-shadow-md italic"
                style={{
                  fontFamily: captionSegment.overlayConfig?.fontFamily || globalOverlayConfig.fontFamily,
                  color: captionSegment.overlayConfig?.color || globalOverlayConfig.color,
                  fontSize: `${(captionSegment.overlayConfig?.fontSize ?? 24) * captionScale}px`,
                  fontWeight: captionSegment.overlayConfig?.fontWeight || 'normal',
                  fontStyle: captionSegment.overlayConfig?.fontStyle || 'italic',
                }}
              >
                {captionSegment.text}
              </p>
            </motion.div>
          </div>
        )}

        {/* Path B heading layer — new-layer heading overlay, composited on top
            of whatever segment(s) fall within its time range (Decision 4).
            Mirrors frameRenderer.ts's drawHeadingLayerOverlay: a full-frame
            backgroundColor fill (when non-transparent) with the text
            positioned at (x%, y%) inside it — visual parity with the old
            in-array heading system, not a text-sized pill. */}
        {activeLayerHeading && activeLayerHeading.text && (
          <div className="absolute inset-0 pointer-events-none select-none" style={{ zIndex: 47 }}>
            {activeLayerHeading.backgroundColor && activeLayerHeading.backgroundColor !== 'transparent' && (
              <div
                className="absolute inset-0"
                style={{ backgroundColor: activeLayerHeading.backgroundColor }}
              />
            )}
            <div
              className="absolute text-center"
              style={{
                left: `${activeLayerHeading.x}%`,
                top: `${activeLayerHeading.y}%`,
                transform: 'translate(-50%, -50%)',
                width: 'max-content',
                maxWidth: '90%',
                color: activeLayerHeading.color,
                fontFamily: activeLayerHeading.fontFamily,
                fontSize: `${activeLayerHeading.fontSize}px`,
                fontWeight: activeLayerHeading.fontWeight,
                lineHeight: 1.2,
                whiteSpace: 'pre-wrap',
              }}
            >
              {activeLayerHeading.text}
            </div>
          </div>
        )}

        {/* Corner Stats */}
        <div className="absolute bottom-10 right-10 flex flex-col items-end gap-2" style={{ zIndex: 50 }}>
          <div className="bg-black/80 backdrop-blur-md px-4 py-2 rounded-xl border border-white/5 flex items-center gap-3">
            <span className="text-[10px] font-mono text-[#F27D26]">{currentTime.toFixed(2)}s</span>
            <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
