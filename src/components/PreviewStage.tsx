/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Maximize, Minimize, MonitorPlay, Play, Pause } from 'lucide-react';
import { SpeedBadge } from './SpeedBadge';
import { VideoSegment, Asset, TransitionType, AnimationType, TextOverlay, HeadingOverlay, type SegmentGrade } from '../types';
import { getFilterStyle, getMotionProps } from '../constants';
import { getActiveHeadingAt } from '../services/headingLayer';
import { waitForVideoFrame } from '../services/waitForVideoFrame';
import { oscillate, interpKeyframes, easeInOutSine, easeOutQuad, springApprox } from '../services/canvasAnimations';
import { blendWrapperProps } from '../services/animBlend';
import { useFirstFrameCache } from '../hooks/useFirstFrameCache';
import { isWebCodecsPreviewSupported } from '../services/webcodecsSupport';
import {
  useWebCodecsPreview,
  isContentCaughtUp,
  computeDisplayedSegment,
  computeAnimTimeInSegment,
  computeSnapReleaseBlend,
  computeBlendProgress,
  toSourceTime,
  sourceRange,
  SNAP_RELEASE_BLEND_S,
  type SnapReleaseBlend,
} from '../hooks/useWebCodecsPreview';
import { PreviewCanvas } from './PreviewCanvas';
import { isWebGL2Supported } from '../services/gl/glContext';
import { useGlPreview } from '../hooks/useGlPreview';
import { computeAutoGrade } from '../services/gl/autoGrade';

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
 * docs/webcodecs-architecture-plan.md Section 8.1). This wrapper drives the
 * looping/entry camera-dynamics animation: pauses freeze it, seeks jump it
 * exactly, and it matches canvasAnimations.ts frame-for-frame.
 *
 * Scope, post-Phase-5-cutover: this renders the 11 animations OUTSIDE the GL
 * engine's scope. ZOOM_IN/ZOOM_OUT are GL-scoped and have no case here (see
 * where they used to sit, below); the outer motion.div no longer drives a
 * cross-segment transition either — the GL compositor owns every transition.
 *
 * NB: segmentDuration is needed for time-scaled entry animations and
 * KEN_BURNS; pass it in from the consuming component.
 */
function getAnimationWrapperProps(
  animation: AnimationType,
  segmentDuration: number,
  timeInSegment: number,
): Record<string, unknown> {
  switch (animation) {
    case AnimationType.NONE:
      return {};

    // Ken Burns is driven by timeInSegment (the playhead position within the
    // segment), NOT Framer Motion's wall-clock. A plain static `transform`
    // recomputed each render keeps preview in lockstep with the playhead —
    // pauses freeze, seeks jump correctly, speed follows playback — and mirrors
    // the export canvas math in canvasAnimations.ts (0.05/sec).
    case AnimationType.KEN_BURNS: {
      const scale = 1.0 + 0.05 * timeInSegment;
      const translateX = 0.5 * timeInSegment; // slow pan right, px
      return { style: { transform: `scale(${scale}) translateX(${translateX}px)`, transformOrigin: 'center center' } };
    }

    // ZOOM_IN / ZOOM_OUT deliberately have no case here — they fall through to
    // `default: {}`. Both are GL-scoped effects (docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20)
    // Section 5.2) and the compositor renders them as a UV transform, per-layer,
    // so they stay continuous across a transition boundary (Bug 2). Their CSS
    // copies were deleted at the Phase 5 cutover: keeping them would double-apply
    // the zoom on top of the GL canvas.
    //
    // KEN_BURNS above keeps its CSS zoom precisely because it is NOT in GL scope
    // (it is one of the other 11 animations) — the compositor never touches it,
    // so this wrapper is still the only thing rendering it. Same 0.05/sec rate,
    // and canvasAnimations.ts (export) is untouched for all three.

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
  assets: Asset[];
  isPlaying: boolean;
  isResizingRef: React.RefObject<boolean>;
  /** Called when the user drags an extra overlay to a new position. */
  onUpdateExtraOverlayPosition?: (segmentId: string, overlayId: string, x: number, y: number) => void;
  /** Global text layers rendered above all segment content. */
  textLayers?: TextOverlay[];
  /** Path B heading layer (docs/history.md ("Path B — Separate Heading Layer — Design Decisions", archived)) — composited on
   *  top of the frame via getActiveHeadingAt(headings, currentTime). */
  headings?: HeadingOverlay[];
  /** WebGL2 Phase 4 auto-grade: PreviewStage owns the decode pool + assets, so
   *  it populates this ref with a per-segment sampler that App's handleAutoGrade
   *  calls. Assigned on mount, cleared on unmount. */
  autoGradeSamplerRef?: React.MutableRefObject<AutoGradeSampler | null>;
  /** Callback for the floating play/pause button shown in fullscreen mode. */
  onTogglePlay: () => void;
  /** Callback for the floating SpeedBadge click shown in fullscreen mode. */
  onSpeedCycle: () => void;
}

export interface PreviewStageHandle {
  toggleFullscreen: () => void;
}

/** Samples one clean source frame for `segment` and returns its auto-grade, or
 *  null when the segment has no analyzable frame (missing/color/audio asset, or
 *  a decode/load failure). */
export type AutoGradeSampler = (segment: VideoSegment) => Promise<SegmentGrade | null>;

// Downsample size for auto-grade analysis — small enough to be cheap, large
// enough for stable luma percentiles / channel means (~14k px). 16:9; source
// aspect is intentionally not preserved (we sample color distribution, not
// geometry).
const AUTO_GRADE_W = 160;
const AUTO_GRADE_H = 90;

/** Loads an image URL for one-shot auto-grade sampling; resolves null on error
 *  rather than rejecting, so a single bad asset is a per-segment skip, not a
 *  thrown auto-grade run. */
function loadImageForSampling(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Focus-bug fix — Tauri's getCurrentWindow().setFocus() restores OS-level
 *  window focus but has been observed to NOT reliably carry focus down into
 *  the embedded WebView (WKWebView/WebView2) after a fullscreen exit, leaving
 *  keydown events undelivered until the user clicks inside the app. Tries
 *  several DOM-level focus targets, most-specific to most-general, since
 *  different WebViews/OSes respond to different ones — cheap, and harmless
 *  if a given strategy is a no-op on a given platform. Also calls Tauri's
 *  WebView-level setFocus (distinct from the Window-level one already called
 *  by our callers) — that is the layer that actually receives keyboard
 *  events; a window can be the frontmost OS window while its embedded
 *  WebView still isn't the focused responder within it. Dynamically
 *  imported, like the existing @tauri-apps/api/window import, so browser
 *  builds don't bundle Tauri APIs. */
async function restoreWebViewFocus() {
  try {
    window.focus();
  } catch {
    // ignore
  }
  try {
    document.body.focus();
  } catch {
    // ignore
  }
  // If body has no tabindex it can't actually receive focus; the app root
  // container (made focusable via the tabindex="-1" effect below) is a more
  // reliable fallback target.
  const root = document.getElementById('root');
  if (root) {
    try {
      (root as HTMLElement).focus();
    } catch {
      // ignore
    }
  }

  if (window.__TAURI_INTERNALS__) {
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().setFocus();
    } catch (err) {
      console.warn('Failed to set WebView focus:', err);
    }
  }
}

export const PreviewStage = forwardRef<PreviewStageHandle, Props>(function PreviewStage({
  segments,
  currentSegment,
  currentTime,
  globalPlaybackSpeed,
  globalTransition,
  globalTransitionDuration,
  globalOverlayConfig,
  assets,
  isPlaying,
  isResizingRef,
  onUpdateExtraOverlayPosition,
  textLayers,
  headings,
  autoGradeSamplerRef,
  onTogglePlay,
  onSpeedCycle,
}, ref) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Tracks the previous fullscreen value across onResized events (focus-bug
  // fix, see the Tauri onResized listener below) — only a true→false edge
  // (fullscreen exit) should refocus the window; every other resize
  // (windowed→fullscreen, or a same-state resize) must not.
  const prevFullscreenRef = useRef(false);

  // Focus-bug fix — document.body has no tabindex by default, so
  // restoreWebViewFocus()'s document.body.focus() call is a no-op without
  // this. tabindex="-1" makes it programmatically focusable (via .focus())
  // without adding it to the Tab order — a permanent, harmless attribute set
  // once on mount, not per fullscreen toggle.
  useEffect(() => {
    if (!document.body.hasAttribute('tabindex')) {
      document.body.setAttribute('tabindex', '-1');
    }
  }, []);

  // WebCodecs preview path — mounts whenever the runtime supports it
  // (isWebCodecsPreviewSupported is the sole gate); the legacy <video>-element
  // path below remains as the fallback for unsupported runtimes. See
  // docs/webcodecs-architecture-plan.md.
  const useWebCodecsPath = isWebCodecsPreviewSupported();
  // Read inside the legacy segment-change effect (dep array intentionally
  // excludes it, same rationale as currentTimeRef below).
  const useWebCodecsPathRef = useRef(useWebCodecsPath);
  useEffect(() => { useWebCodecsPathRef.current = useWebCodecsPath; }, [useWebCodecsPath]);

  // WebGL2 effects preview path (docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20) Phase 5 —
  // the cutover). Capability-gated ONLY: Phase 3's dual gate (import.meta.env
  // .DEV + a persisted dev toggle) was removed here, so this is now the sole
  // path that renders the scoped effects — the 4 transitions, both zooms, and
  // color grading. WebCodecs support stays a structural prerequisite because GL
  // sources its frames from that decode pool.
  //
  // There is deliberately NO fallback (plan Section 3.4): the CSS/Canvas2D
  // snapshot path that used to render transitions was deleted at this cutover,
  // not gated. isWebGL2Supported() survives purely as a diagnostic —
  // glUnavailable below drives a visible error surface, because a clear message
  // beats a silent black stage. It is not a router to a second implementation.
  const webgl2Supported = isWebGL2Supported();
  const glPathActive = useWebCodecsPath && webgl2Supported;
  const glUnavailable = !webgl2Supported;

  // FIX 1 — Dual persistent video elements (A/B slot pingpong).
  // Neither element is ever unmounted; we swap which is visible on segment change.
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
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

  // Animation-hard-cut (Bug 2) fix — see the synchronization block below
  // (right after webCodecsPreview is set up) for the full explanation. Read
  // AND written synchronously at render time there, not inside an effect, so
  // a ref (not state) is correct.
  //
  // Bug 1's companion `overlayHoldStateRef` was deleted at the Phase 5 cutover
  // along with the transition overlay it held visible.
  const displayedSegmentRef = useRef<VideoSegment | undefined>(undefined);

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

  // Phase 5 cutover — `globalConfig` (overlayConfig + the resolved
  // globalOverlayFilter CSS string) was built here purely to feed
  // useTransitionPreview's snapshot renderer, which baked both into the
  // pre-roll canvases. That hook is deleted, and the GL compositor bakes
  // nothing — overlays and captions are DOM layers above its canvas (Section
  // 5.4 keeps them out of GL scope) — so both it and its `computedFilter`
  // helper are gone with it.

  // Phase 1+2 WebCodecs preview path. `enabled` gates ALL work inside the
  // hook (including decode session creation) — when false, this call is
  // inert. Computed before the GL driver below so its already-live
  // `frame`/`frameSegmentId`/`pool` can be threaded straight into it.
  const webCodecsPreview = useWebCodecsPreview({
    segments,
    assets,
    currentSegment,
    currentTime,
    enabled: useWebCodecsPath,
  });

  // Phase 5 cutover — the useTransitionPreview call that stood here is gone,
  // along with the hook itself (src/hooks/useTransitionPreview.ts, deleted).
  // It drove the CSS/Canvas2D pre-roll snapshot blend; the GL compositor now
  // owns every transition this app renders. It was already fully inert
  // whenever the GL path was active (its own glPathActive guard), so removing
  // it changes nothing about what the GL path draws.

  // WebGL2 preview driver (docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20) Phase 3). `enabled`
  // gates ALL work — inert when the dual gate is false. Sources the current/
  // incoming frame from the SAME pool useWebCodecsPreview owns (via its
  // exposed frame/pool), and the outgoing frame via that pool's B3 protected-
  // session + chase-mutex primitives. Grade (Phase 4) is per-segment: it flows
  // through `segments` (already passed to useGlPreview below), which
  // deriveCompositeParams reads the containing segment's `effectGrade` from —
  // no grade field is threaded through glConfig. `config.grade` here would only
  // be a project-level fallback; it's intentionally left unset.
  const glConfig = useMemo(
    () => ({ globalTransition, globalTransitionDuration }),
    [globalTransition, globalTransitionDuration],
  );
  const glPreview = useGlPreview({
    segments,
    assets,
    currentSegment,
    currentTime,
    pool: webCodecsPreview.pool,
    currentFrame: webCodecsPreview.frame,
    currentFrameSegmentId: webCodecsPreview.frameSegmentId,
    config: glConfig,
    isResizingRef,
    enabled: glPathActive,
    isFullscreen,
  });

  // WebGL2 Phase 4 — auto color-grade sampler. Pulls ONE clean source frame per
  // segment at its own start time and derives grade values via the pure
  // computeAutoGrade heuristic. This samples the RAW source (a decoded frame /
  // the loaded image), never a composited or transition-blended output, so the
  // result reflects only that segment's content. One-shot per user click (never
  // per tick). Video frames come from the SAME decode pool useWebCodecsPreview
  // owns (ensureSession seeds a session at the start time, getFrameAt reads it);
  // image sources load directly from the asset URL. Anything without a
  // renderable frame (color/audio/missing asset, or a decode/load failure)
  // resolves null → a non-blocking per-segment skip, surfaced in the Auto
  // button's flash rather than silently swallowed.
  const autoGradeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const getAutoGradeCtx = useCallback((): CanvasRenderingContext2D | null => {
    let c = autoGradeCanvasRef.current;
    if (!c) {
      c = document.createElement('canvas');
      c.width = AUTO_GRADE_W;
      c.height = AUTO_GRADE_H;
      autoGradeCanvasRef.current = c;
    }
    return c.getContext('2d', { willReadFrequently: true });
  }, []);

  const autoGradePool = webCodecsPreview.pool;
  const sampleAutoGrade = useCallback<AutoGradeSampler>(
    async (segment) => {
      const asset = assets.find((a) => a.id === segment.assetId);
      if (!asset || !asset.url) return null;
      const ctx = getAutoGradeCtx();
      if (!ctx) return null;

      let source: CanvasImageSource | null = null;
      if (asset.type === 'image') {
        source = await loadImageForSampling(asset.url);
      } else if (asset.type === 'video') {
        const { start, end } = sourceRange(segment);
        const target = toSourceTime(segment, segment.startTime);
        try {
          await autoGradePool.ensureSession(segment.id, asset.url, start, end, target);
          source = await autoGradePool.getFrameAt(segment.id, target);
        } catch {
          source = null;
        }
      }
      if (!source) return null;

      try {
        ctx.clearRect(0, 0, AUTO_GRADE_W, AUTO_GRADE_H);
        ctx.drawImage(source, 0, 0, AUTO_GRADE_W, AUTO_GRADE_H);
        const data = ctx.getImageData(0, 0, AUTO_GRADE_W, AUTO_GRADE_H);
        return computeAutoGrade(data);
      } catch {
        return null; // e.g. a pool-owned frame closed between resolve and draw
      }
    },
    [assets, autoGradePool, getAutoGradeCtx],
  );

  useEffect(() => {
    if (!autoGradeSamplerRef) return;
    autoGradeSamplerRef.current = sampleAutoGrade;
    return () => {
      if (autoGradeSamplerRef) autoGradeSamplerRef.current = null;
    };
  }, [autoGradeSamplerRef, sampleAutoGrade]);

  // ---------------------------------------------------------------------------
  // Bug 1 (transition flicker) + Bug 2 (animation hard-cut) fix.
  //
  // Root cause, confirmed via the [DIAG] timestamps above: `currentSegment`
  // (and everything computed synchronously from it every render — the
  // animation transform below) flips
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
  // pattern useGlPreview.ts uses for isResizingRef, for the identical
  // reason: an effect would only correct things one paint later,
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

  // Phase 5 cutover — the caption now always reads `currentSegment`.
  //
  // It used to hold the OUTGOING segment's text for the life of the CSS/Canvas2D
  // transition overlay, so the caption read as steady while that overlay
  // crossfaded beneath it. Both the overlay and the hold state (Bug 1) are gone:
  // the GL compositor owns the whole blend on one canvas and retains its last
  // draw, so there is no separate overlay to stay in sync with and nothing to
  // hold a caption across.
  //
  // Not a behaviour change for anyone: useTransitionPreview reported isActive
  // false whenever the GL path was on, so showTransitionOverlay was already
  // always false there and the caption already tracked currentSegment. This is
  // byte-identical to the GL path that was manually verified pre-cutover — it
  // only deletes the branch that the (now-removed) legacy path used.
  const captionSegment = currentSegment;

  // Syncs isFullscreen to the real window/document state. Tauri's WebView
  // (WKWebView/WebView2) doesn't reliably honor the browser Fullscreen API
  // (see toggleNativeFullscreen below), so inside Tauri we track the native
  // OS window's fullscreen state via onResized (fires on Escape, the macOS
  // traffic-light button, or any other OS-level exit that bypasses our own
  // handler) instead of the DOM's fullscreenchange event, which Tauri's
  // WebView never fires since requestFullscreen() never actually engages.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    if (window.__TAURI_INTERNALS__) {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        if (cancelled) return;
        const win = getCurrentWindow();
        win.onResized(async () => {
          try {
            const fullscreen = await win.isFullscreen();
            // Focus-bug fix: Escape, the macOS traffic-light button, and
            // Windows' restore control all exit fullscreen WITHOUT going
            // through toggleNativeFullscreen below, and each has been
            // observed to leave the OS window (and so its embedded WebView)
            // without keyboard focus — no keydown reaches the app's window
            // listener until the user clicks back in. Only the true→false
            // edge should refocus; windowed→fullscreen and same-state
            // resizes must not.
            if (prevFullscreenRef.current && !fullscreen) {
              try {
                await win.setFocus();
              } catch (err) {
                console.warn('Failed to refocus window:', err);
              }
              // setFocus() restores OS-level window focus but has been
              // observed to not reliably carry down into the embedded
              // WebView — belt-and-suspenders DOM-level + WebView-level
              // restoration too.
              await restoreWebViewFocus();
            }
            prevFullscreenRef.current = fullscreen;
            setIsFullscreen(fullscreen);
          } catch (err) {
            console.warn('Failed to query Tauri fullscreen state:', err);
          }
        }).then(fn => {
          if (cancelled) fn();
          else unlisten = fn;
        });
      }).catch(err => {
        console.warn('Failed to load Tauri window API for fullscreen listener:', err);
      });

      return () => {
        cancelled = true;
        unlisten?.();
      };
    }

    // Browser preview fallback (dev server without the Tauri shell).
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // The browser Fullscreen API (document.documentElement.requestFullscreen())
  // either silently fails or isn't enabled by default inside Tauri's embedded
  // WebView (WKWebView on macOS, WebView2 on Windows) — a native desktop app
  // window isn't the same context the Fullscreen API was designed for. Tauri
  // exposes the OS window's own fullscreen state directly via
  // getCurrentWindow().setFullscreen(), which is what actually works there.
  // Falls back to the browser API when not running inside Tauri (e.g. the
  // Vite dev server preview), so that path keeps working too.
  const toggleNativeFullscreen = useCallback(async () => {
    if (window.__TAURI_INTERNALS__) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        const currentlyFullscreen = await win.isFullscreen();
        await win.setFullscreen(!currentlyFullscreen);
        // Focus-bug fix: re-focus the window immediately after toggling —
        // don't wait for onResized's own refocus (below), since that only
        // fires once the OS resize event lands. Harmless no-op on the
        // windowed→fullscreen edge; setFocus() is idempotent.
        try {
          await win.setFocus();
        } catch (err) {
          console.warn('Failed to refocus window:', err);
        }
        // setFocus() restores OS-level window focus but has been observed to
        // not reliably carry down into the embedded WebView — belt-and-
        // suspenders DOM-level + WebView-level restoration too.
        await restoreWebViewFocus();
        // onResized will also sync this, but set it explicitly to avoid a
        // visible lag between the API call resolving and the resize event.
        setIsFullscreen(!currentlyFullscreen);
      } catch (err) {
        console.warn('Tauri fullscreen failed:', err);
      }
    } else {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
          console.warn(`Browser fullscreen failed: ${err.message}`);
        });
      } else {
        // exitFullscreen() is async — restoreWebViewFocus() must run after
        // it resolves (or the browser hasn't actually exited yet).
        document.exitFullscreen().then(() => restoreWebViewFocus()).catch(() => {});
      }
      // State syncs via the fullscreenchange listener above.
    }
  }, []);

  useImperativeHandle(ref, () => ({
    toggleFullscreen: toggleNativeFullscreen,
  }), [toggleNativeFullscreen]);

  // Snap-back fix — the intra-segment animation wrapper's actual props.
  // During the release-blend window (animBlendProgress < 1), blends the
  // frozen OUTGOING pose's own transform/opacity toward the CURRENT
  // segment's live pose (src/services/animBlend.ts); otherwise this is
  // byte-identical to calling getAnimationWrapperProps directly.
  //
  // Phase 5 cutover — two gates that used to wrap this are gone:
  //  1. `suppressMotionAnim` (returned {} for the life of the CSS/Canvas2D
  //     transition overlay, which is deleted). It derived from
  //     showTransitionOverlay, which was already always false whenever the GL
  //     path was on, so dropping it changes nothing the GL path rendered.
  //  2. `resolveWrapperAnimationType` (mapped ZOOM_IN/ZOOM_OUT to NONE while GL
  //     was active, so zoom wasn't applied twice). Redundant now that
  //     getAnimationWrapperProps has no zoom cases at all — the compositor is
  //     the only thing that renders zoom, as a UV transform.
  //
  // The other 11 animation types stay on this CSS wrapper (out of GL scope,
  // Section 5.2) and simply transform the GL canvas element.
  const animationWrapperProps = (() => {
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
          return null;
        }
        return prev;
      });
    };

    if (liveReady) {
      // //FFCACHE — live slot already holds the correct painted frame: show it
      // immediately, no cover needed. Clear any stale cover from a prior segment.
      setCoverState(prev => (prev && prev.segmentId !== segId) ? null : prev);
      reveal();
    } else {
      // //FFCACHE — mask the still-visible OUTGOING slot with THIS segment's
      // cached first frame (or bg-black if the cache isn't ready — truthful,
      // never the wrong clip) until the live slot paints the correct frame.
      // Runs in the playing path too.
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

  // Sync playbackRate whenever playbackSpeed or global speed changes
  // without re-seeking (seek only happens on segment transition above).
  useEffect(() => {
    const activeEl = activeSlotRef.current === 'a' ? videoARef.current : videoBRef.current;
    if (!activeEl) return;
    activeEl.playbackRate = (currentSegment?.playbackSpeed || 1) * globalPlaybackSpeed;
  }, [currentSegment?.playbackSpeed, globalPlaybackSpeed]);

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
        <div
          className={`absolute top-6 right-6 z-[1001] flex items-center gap-3 transition-opacity ${
            isFullscreen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <button
            onClick={toggleNativeFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="p-3 bg-black/50 backdrop-blur-md rounded-xl text-white border border-white/10 hover:bg-[#F27D26] transition-all"
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>

        {/* Fullscreen-only floating playback controls — always visible (no hover-gate),
            since there's no other UI surface available once the editor chrome is hidden. */}
        {isFullscreen && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1001] flex items-center gap-3 bg-black/40 backdrop-blur-md rounded-full px-4 py-2 border border-white/10">
            <button
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="text-white hover:text-[#F27D26] transition-colors"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <SpeedBadge speed={globalPlaybackSpeed} onCycle={onSpeedCycle} />
          </div>
        )}
        {isFullscreen && (
          <div className="absolute top-6 left-6 z-[1001] text-[10px] text-white/50 bg-black/30 px-2 py-1 rounded">
            Press Esc to exit
          </div>
        )}

        {/* Dev-only, persistent (not hover-gated) indicator of which video path is
            painting the preview — useful for debugging, has no effect on behavior. */}
        {import.meta.env.DEV && useWebCodecsPath && (
          <div className="absolute top-6 left-6 z-[1001] px-3 py-1.5 rounded-lg bg-[#F27D26] text-black text-[10px] font-black uppercase tracking-wider">
            WebCodecs Preview
          </div>
        )}

        {/* WebGL2 unavailable — the Phase 5 diagnostic (plan Section 3.4). The
            effects engine has no fallback path by design, so rather than leave a
            silently effect-less (or black) stage, say so plainly. This is an
            error surface, NOT a router: nothing re-renders the scoped effects
            when it shows. */}
        {glUnavailable && (
          <div className="absolute top-16 left-6 z-[1001] px-3 py-2 rounded-lg bg-red-600 text-white text-[10px] max-w-[320px] leading-relaxed">
            <div className="font-black uppercase tracking-wider mb-0.5">Effects unavailable</div>
            WebGL2 is not available in this runtime, so transitions, zoom, and
            colour grading cannot render. Playback and export are unaffected.
          </div>
        )}
        {glPathActive && glPreview.error && (
          <div className="absolute top-16 left-6 z-[1001] px-3 py-2 rounded-lg bg-red-600 text-white text-[10px] max-w-[320px] leading-relaxed">
            <div className="font-black uppercase tracking-wider mb-0.5">Effects engine error</div>
            <span className="font-mono">{glPreview.error}</span>
          </div>
        )}

        {/* Phase 5 cutover — the CSS/Framer cross-segment transition path is deleted
            (plan Section 3.4 names it alongside useTransitionPreview's snapshot
            machinery). The motion.div below used to drive initial/animate/exit from
            getMotionProps(currentSegment.transition), i.e. the LEGACY TransitionType
            enum. The GL compositor is now the only thing that renders a transition,
            so those props are pinned inert.

            Already inert in practice before this commit: `segment.transition` is
            written TransitionType.NONE at creation (App.tsx) and reset to NONE by
            every Effects-tab apply, and no live UI can set it (its picker was
            replaced by the slug-based EffectsPanel in the Effects Tab Rebuild) — so
            the NONE branch was the only one this ever took. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {currentSegment ? (
            <motion.div
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 1 }}
              transition={{ duration: 0 }}
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
                  const isVideoAsset = !!(asset?.url && asset.type === 'video');
                  return (
                    <>
                      {/* FIX 1 + FIX 4 — Dual persistent video slots. Both elements stay
                          in the DOM at all times; only the active slot is visible. The src
                          is set imperatively by the segment-change effect, never via JSX,
                          so React never unmounts the element when currentSegment changes.
                          preload="auto" tells the browser to buffer the full video. */}
                      <video
                        ref={videoARef}
                        className={`absolute inset-0 w-full h-full object-contain${isVideoAsset && activeSlot === 'a' ? '' : ' opacity-0 pointer-events-none'}`}
                        style={getClipEffectStyle(currentSegment.effectAnimation)}
                        muted
                        playsInline
                        preload="auto"
                      />
                      <video
                        ref={videoBRef}
                        className={`absolute inset-0 w-full h-full object-contain${isVideoAsset && activeSlot === 'b' ? '' : ' opacity-0 pointer-events-none'}`}
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
                              className="absolute inset-0 w-full h-full object-contain"
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
                          keep applying, matching the legacy path's parity intent.
                          Suppressed when the GL path owns the frame (glPathActive) — the
                          GL canvas below is then the sole visible media layer. */}
                      {isVideoAsset && useWebCodecsPath && webCodecsPreview.isVideoSegment && !glPathActive && (
                        <PreviewCanvas
                          frame={webCodecsPreview.frame}
                          className="absolute inset-0 w-full h-full"
                          style={getClipEffectStyle(currentSegment.effectAnimation)}
                          isFullscreen={isFullscreen}
                        />
                      )}
                      {/* WebGL2 effects preview path (docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20)
                          Phase 3, dual-gated). One persistent canvas mounted for the
                          whole life of glPathActive (kept mounted across segments so the
                          GL context/compositor survive) — it renders the scoped
                          transitions + zoom for BOTH video and image segments, replacing
                          PreviewCanvas (video) and the <img> (image) above/below. Hidden
                          (display:none → clientWidth 0 → the driver's render effect no-ops
                          and retains) on a missing-asset segment so the placeholder below
                          shows through without tearing down the GL context. Inside the
                          animation wrapper so the non-scoped CSS animations still transform
                          it; getClipEffectStyle preserves the CSS clip-effect filters. */}
                      {glPathActive && (
                        <canvas
                          ref={glPreview.canvasRef}
                          className="absolute inset-0 w-full h-full"
                          style={{
                            ...getClipEffectStyle(currentSegment.effectAnimation),
                            display: asset?.url ? undefined : 'none',
                          }}
                        />
                      )}
                      {/* Image segments — suppressed when the GL path owns the frame
                          (glPathActive); the GL canvas above renders image content too. */}
                      {asset?.url && !isVideoAsset && !glPathActive && (
                        // Fade-in on segment enter. The old `suppressMotionAnim ? 1 : 0`
                        // initial existed to skip this fade right after the deleted canvas
                        // overlay finished a blend (it would have read as a black-to-image
                        // stutter); with no overlay there is nothing to stutter against, so
                        // the fade is unconditional. Only reachable when the GL path is off.
                        <motion.img
                          key={currentSegment.id}
                          src={asset.url}
                          className="w-full h-full object-contain"
                          style={getClipEffectStyle(currentSegment.effectAnimation)}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.4 }}
                        />
                      )}
                      {/* Missing asset placeholder */}
                      {!asset?.url && (
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
                  Phase 5 cutover: this wrapper used to fade to opacity 0 for the life of the
                  CSS/Canvas2D transition overlay, because that overlay's snapshots already
                  had the extra overlays baked in and showing both would double-render them.
                  The GL compositor bakes nothing — overlays are a DOM layer above its canvas
                  (Section 5.4 keeps them out of GL scope) — so there is nothing to
                  double-render and the fade is gone. Already the GL path's behaviour before
                  this commit: showTransitionOverlay was always false whenever GL was on. */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ zIndex: 40 }}
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

        {/* Phase 5 cutover — the CSS/Canvas2D transition-overlay canvas that sat
            here (z-index 45) is deleted. The GL compositor renders the whole
            blend onto its own canvas inside the animation wrapper above, so
            there is no second surface to composite, fade, or keep in sync. */}

        {/* Main body caption — a direct sibling of the per-segment motion.div rather
            than nested inside it, so it can outrank it. The motion.div sets no z-index
            of its own, but framer-motion gives it a `transform`, which independently
            forms its own stacking context — a z-index on a caption nested inside it
            would only rank among that motion.div's own children. zIndex 46 stays below
            Corner Stats (50).

            Phase 5 cutover: this used to also have to clear the transition-overlay
            canvas's z-index 45, and captionSegment used to hold the OUTGOING segment's
            text for the life of that overlay. Both are gone — the GL compositor owns the
            blend on its own canvas inside the wrapper, and captionSegment is now just
            currentSegment (see its own comment above). */}
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
});
