/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layout, Maximize, Minimize, MonitorPlay } from 'lucide-react';
import { VideoSegment, Asset, TransitionType, AnimationType } from '../types';
import { getMotionProps } from '../constants';
import { applyTransitionBlend } from '../services/frameRenderer';
import { useTransitionPreview } from '../hooks/useTransitionPreview';

// Live-preview side of the animation pipeline. The export side
// lives in src/services/canvasAnimations.ts (applySegmentAnimation).
// Both must remain visually consistent — if you change motion
// parameters here, port the change to canvasAnimations.ts and
// vice versa. Drift between the two will cause preview-vs-export
// mismatches that are tedious to diagnose.
/**
 * Returns Framer Motion props for the intra-segment media wrapper.
 * The outer motion.div drives cross-segment transition (initial/exit).
 * This inner wrapper drives the looping/entry camera-dynamics animation.
 *
 * NB: segmentDuration is needed for time-scaled entry animations (ROTATE, SKEW, BOUNCE)
 * and KEN_BURNS; pass it in from the consuming component.
 */
function getAnimationWrapperProps(
  animation: AnimationType,
  segmentDuration: number,
): Record<string, unknown> {
  switch (animation) {
    case AnimationType.NONE:
      return {};

    case AnimationType.KEN_BURNS:
      return {
        initial: { scale: 1 },
        animate: { scale: 1.1 },
        transition: { duration: segmentDuration, ease: 'linear' },
        style: { transformOrigin: 'center center' },
      };

    case AnimationType.FLOAT:
      return getMotionProps('float');

    case AnimationType.SHAKE:
      return getMotionProps('shake');

    case AnimationType.PULSE:
      return getMotionProps('pulse');

    case AnimationType.WOBBLE:
      return getMotionProps('wobble');

    case AnimationType.HEARTBEAT:
      return getMotionProps('heartbeat');

    case AnimationType.BOUNCE:
      return getMotionProps('bounce');

    case AnimationType.ROTATE:
      // Entry spin: rotate -360 → 0 (entry only, no exit)
      return { initial: { rotate: -360, opacity: 0 }, animate: { rotate: 0, opacity: 1 }, transition: { duration: 1, ease: 'easeOut' } };

    case AnimationType.SKEW:
      return getMotionProps('skew');

    case AnimationType.GLITCH:
      return getMotionProps('glitch');

    case AnimationType.NEON_FLICKER:
      // Opacity flicker only (textShadow is CSS-only; canvas export handles glow separately)
      return {
        animate: { opacity: [1, 0.3, 0.8, 0.2, 1, 0.4, 0.9] },
        transition: { duration: 1.5, repeat: Infinity },
      };

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
  hideAllText: boolean;
  assets: Asset[];
  /** Called when the user drags an extra overlay to a new position. */
  onUpdateExtraOverlayPosition?: (segmentId: string, overlayId: string, x: number, y: number) => void;
}

export function PreviewStage({
  segments,
  currentSegment,
  currentTime,
  globalPlaybackSpeed,
  globalTransition,
  globalTransitionDuration,
  globalOverlayConfig,
  hideAllText,
  assets,
  onUpdateExtraOverlayPosition,
}: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMidView, setIsMidView] = useState(false);

  // Canvas hold — keeps the canvas visible after isActive=false until the
  // incoming media element reports it has decoded its first frame. Without
  // this, the 100ms CSS fade-out completes while the video is still at
  // readyState=0, exposing bg-black for 200-300ms+. See hold effect below.
  const [canvasHoldActive, setCanvasHoldActive] = useState(false);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Canvas overlay for transition blending
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  // [black-fade-debug] tracks previous isActive to detect true→false transitions
  const prevIsActiveForDebugRef = useRef<boolean>(false);

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
  const globalConfig = {
    overlayConfig: globalOverlayConfig,
    hideAllText,
    globalOverlayFilter: undefined as string | undefined,
  };

  const transitionPreview = useTransitionPreview({
    segments,
    currentTime,
    assets,
    globalTransition,
    globalTransitionDuration,
    globalConfig,
  });

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
  ]);

  // [black-fade-debug] Sample every layer that could contribute a black frame in the
  // 0–300ms window after isActive flips false. Fires only on true→false transitions.
  useEffect(() => {
    const isNowActive = transitionPreview.isActive;
    const wasActive = prevIsActiveForDebugRef.current;
    prevIsActiveForDebugRef.current = isNowActive;

    // Only instrument the true → false edge
    if (!wasActive || isNowActive) return;

    const t0 = performance.now();
    const stage = stageRef.current;
    const canvas = overlayCanvasRef.current;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const snapshot = (label: string) => {
      const elapsed = (performance.now() - t0).toFixed(1);

      // Canvas opacity (CSS computed — not the inline style value)
      const canvasComputed = canvas ? window.getComputedStyle(canvas) : null;
      const canvasOpacity = canvasComputed?.opacity ?? 'n/a';
      const canvasInDOM = canvas ? document.contains(canvas) : false;

      // Canvas pixel content — sample centre pixel to detect clearRect vs retained frame
      let centerPixel = 'n/a';
      if (canvas) {
        if (canvas.width > 0 && canvas.height > 0) {
          try {
            const ctx2d = canvas.getContext('2d');
            if (ctx2d) {
              const cx = Math.floor(canvas.width / 2);
              const cy = Math.floor(canvas.height / 2);
              const d = ctx2d.getImageData(cx, cy, 1, 1).data;
              centerPixel = `rgba(${d[0]},${d[1]},${d[2]},${d[3]})`;
            }
          } catch { centerPixel = 'getImageData-error'; }
        } else {
          centerPixel = `zero-dims(${canvas.width}x${canvas.height})`;
        }
      }

      // Outer AnimatePresence segment wrapper
      const segRoot = stage?.querySelector('[data-segment-root]') as HTMLElement | null;
      const segRootOpacity = segRoot
        ? window.getComputedStyle(segRoot).opacity
        : 'MISSING-no-data-segment-root-in-DOM';

      // Inner media wrapper
      const mediaWrapper = stage?.querySelector('[data-media-wrapper]') as HTMLElement | null;
      const mediaWrapperOpacity = mediaWrapper
        ? window.getComputedStyle(mediaWrapper).opacity
        : 'MISSING-no-data-media-wrapper-in-DOM';

      // Video element
      const video = stage?.querySelector('video') as HTMLVideoElement | null;
      const videoInfo = video
        ? `readyState=${video.readyState} videoWidth=${video.videoWidth} ` +
          `currentTime=${video.currentTime.toFixed(3)} paused=${video.paused} ` +
          `networkState=${video.networkState}`
        : 'none';

      // Image element
      const img = stage?.querySelector('img') as HTMLImageElement | null;
      const imgInfo = img
        ? `complete=${img.complete} naturalWidth=${img.naturalWidth}`
        : 'none';

      console.log(
        `[black-fade-debug] @t+${label} (actual +${elapsed}ms since isActive→false)\n` +
        `  canvas : opacity=${canvasOpacity} inDOM=${canvasInDOM}` +
        ` dims=${canvas?.width ?? '?'}x${canvas?.height ?? '?'} centerPixel=${centerPixel}\n` +
        `  segRoot: opacity=${segRootOpacity}\n` +
        `  mediaWr: opacity=${mediaWrapperOpacity}\n` +
        `  video  : ${videoInfo}\n` +
        `  img    : ${imgInfo}`,
      );

      // DOM snapshot at t+50ms only — outerHTML is expensive
      if (label === '50ms') {
        const html = segRoot?.outerHTML?.slice(0, 500) ?? 'no [data-segment-root] found';
        console.log(`[black-fade-debug] DOM snapshot @t+50ms (first 500 chars):\n${html}`);
      }
    };

    timers.push(setTimeout(() => snapshot('0ms'),   0));
    timers.push(setTimeout(() => snapshot('50ms'),  50));
    timers.push(setTimeout(() => snapshot('150ms'), 150));
    timers.push(setTimeout(() => snapshot('300ms'), 300));

    return () => { timers.forEach(clearTimeout); };
  }, [transitionPreview.isActive]);

  // ---------------------------------------------------------------------------
  // Canvas hold: extend canvas visibility past isActive=false until the
  // incoming media element is renderable (video canplay / img load), or until
  // an 800ms failsafe fires — whichever comes first.
  //
  // The CSS `opacity 100ms ease` on the canvas still applies when the hold
  // releases, so the crossfade from canvas-frame to live media is smooth.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (transitionPreview.isActive) {
      // New transition starting — cancel any hold left over from a prior one.
      if (holdTimeoutRef.current !== null) {
        clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = null;
      }
      setCanvasHoldActive(false);
      return;
    }

    // Only activate on the single render where isActive flips true → false.
    if (!transitionPreview.justCompleted) return;

    setCanvasHoldActive(true);

    const stage = stageRef.current;
    const video = stage?.querySelector('video') as HTMLVideoElement | null;
    const img   = stage?.querySelector('img')   as HTMLImageElement | null;

    // Mutable ref so the cleanup can nullify it after removal.
    let removeMediaListener: (() => void) | null = null;

    const release = () => {
      removeMediaListener?.();
      removeMediaListener = null;
      if (holdTimeoutRef.current !== null) {
        clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = null;
      }
      setCanvasHoldActive(false);
    };

    if (video) {
      // HAVE_FUTURE_DATA (3) or HAVE_ENOUGH_DATA (4) — already decoded.
      // React 18 batches the setCanvasHoldActive(true) above with the
      // setCanvasHoldActive(false) here → net result is false; no visible hold.
      if (video.readyState >= 3) {
        release();
        return () => { /* nothing pending — already released */ };
      }
      const onReady = () => release();
      video.addEventListener('canplay', onReady, { once: true });
      removeMediaListener = () => video.removeEventListener('canplay', onReady);
    } else if (img) {
      if (img.complete && img.naturalWidth > 0) {
        release();
        return () => { /* nothing pending — already released */ };
      }
      const onLoad = () => release();
      img.addEventListener('load', onLoad, { once: true });
      removeMediaListener = () => img.removeEventListener('load', onLoad);
    }
    // If neither (placeholder segment) the failsafe below is the only release.

    // Failsafe: 800ms cap prevents a stuck canvas if media never loads.
    holdTimeoutRef.current = setTimeout(() => {
      holdTimeoutRef.current = null;
      release();
    }, 800);

    return () => {
      // Cleanup on re-run or unmount — always cancel hold so the canvas
      // doesn't stay visible past component teardown or dep changes.
      removeMediaListener?.();
      removeMediaListener = null;
      if (holdTimeoutRef.current !== null) {
        clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = null;
      }
      setCanvasHoldActive(false);
    };
  }, [transitionPreview.isActive, transitionPreview.justCompleted]);

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

  // True while the canvas overlay covers the stage (isActive) OR on the one render where
  // it just finished (justCompleted). Both conditions require the AnimatePresence motion.div
  // and motion.img to be no-ops — the canvas already showed the visual transition, so
  // letting these layers animate produces a double-transition underneath.
  const suppressMotionAnim = transitionPreview.isActive || transitionPreview.justCompleted;

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center">
      <div
        ref={stageRef}
        className={isFullscreen
          ? 'fixed inset-0 z-[5000] flex items-center justify-center bg-black overflow-hidden'
          : `relative mx-auto bg-black rounded-[40px] border border-[#1A1A1A] overflow-hidden shadow-2xl group transition-all duration-500 ${isMidView ? 'aspect-video w-[900px] h-auto' : 'aspect-video max-w-5xl w-full h-auto'}`}
      >
        {/* Floating Controls */}
        <div className="absolute top-6 right-6 z-[1001] flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setIsMidView(!isMidView)}
            aria-label={isMidView ? 'Collapse preview' : 'Expand preview'}
            className="p-3 bg-black/50 backdrop-blur-md rounded-xl text-white border border-white/10 hover:bg-[#F27D26] transition-all"
          >
            <Layout size={20} />
          </button>
          <button
            onClick={toggleNativeFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="p-3 bg-black/50 backdrop-blur-md rounded-xl text-white border border-white/10 hover:bg-[#F27D26] transition-all"
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>

        <AnimatePresence mode="popLayout" initial={false}>
          {currentSegment ? (
            <motion.div
              key={currentSegment.id}
              initial={suppressMotionAnim || currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || globalTransition).initial}
              animate={suppressMotionAnim || currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || globalTransition).animate}
              exit={suppressMotionAnim || currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || globalTransition).exit}
              transition={{ duration: suppressMotionAnim || currentSegment.transition === TransitionType.NONE ? 0 : (currentSegment.transitionDuration ?? globalTransitionDuration) }}
              className="absolute inset-0 bg-black"
              data-segment-root=""
            >
              {/* Visuals — media wrapper carries intra-segment camera-dynamics animation.
                  Suppressed when canvas just handled the transition: BOUNCE/SKEW/ROTATE
                  return initial:{opacity:0} which would produce a black flash on entry. */}
              <motion.div
                className="absolute inset-0 overflow-hidden"
                data-media-wrapper=""
                {...(suppressMotionAnim ? {} : getAnimationWrapperProps(
                  currentSegment.animation ?? AnimationType.NONE,
                  currentSegment.duration,
                ))}
              >
                {(() => {
                  const asset = assets.find(a => a.id === currentSegment.assetId);
                  if (asset?.url) {
                    if (asset.type === 'video') {
                      return (
                        <video
                          key={asset.id}
                          src={asset.url}
                          className="w-full h-full object-cover"
                          autoPlay
                          muted={currentSegment.isMuted}
                          playsInline
                          ref={(el) => {
                            if (el) {
                              el.playbackRate = (currentSegment.playbackSpeed || 1) * globalPlaybackSpeed;
                              const segmentProgress = currentTime - currentSegment.startTime;
                              const rawTime = (currentSegment.trimStart || 0) + (segmentProgress * (currentSegment.playbackSpeed || 1));
                              // undefined trimEnd = "play to end of media"
                              const videoTime = currentSegment.trimEnd !== undefined
                                ? Math.min(rawTime, currentSegment.trimEnd)
                                : rawTime;
                              if (Math.abs(el.currentTime - videoTime) > 0.1) {
                                el.currentTime = videoTime;
                              }
                            }
                          }}
                        />
                      );
                    }
                    return (
                      // Fade-in on segment enter; suppressed when canvas just handled the
                      // transition (suppressMotionAnim) to avoid a black-to-image stutter
                      // immediately after the canvas blend completes.
                      <motion.img
                        src={asset.url}
                        className="w-full h-full object-cover"
                        initial={{ opacity: suppressMotionAnim ? 1 : 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.4 }}
                      />
                    );
                  }
                  return (
                    <div className="w-full h-full bg-gradient-to-br from-[#111] to-[#050505] flex items-center justify-center p-20 text-center" />
                  );
                })()}
              </motion.div>

              {/* Main Overlays Gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 pointer-events-none" />

              {/* Extra Overlays Rendering — draggable when onUpdateExtraOverlayPosition is provided.
                  Wrapper fades out with the canvas overlay during transitions to prevent
                  double-render (canvas snapshot already contains extra overlays). */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  zIndex: 40,
                  opacity: transitionPreview.isActive ? 0 : 1,
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

              {/* Main heading + body text. Fades out during canvas transition overlay to prevent
                  double-render — same 100ms ease as the canvas fade-in so they crossfade cleanly. */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center p-20 text-center pointer-events-none select-none z-10"
                style={{ opacity: transitionPreview.isActive ? 0 : 1, transition: 'opacity 100ms ease' }}
              >
                {currentSegment.heading && (currentSegment.showOverlay || !hideAllText) && (
                  <motion.h3
                    {...currentSegment.overlayConfig?.animation ? getMotionProps(currentSegment.overlayConfig.animation) : { initial: { opacity: 0, y: -20 }, animate: { opacity: 1, y: 0 } }}
                    className="mb-4 drop-shadow-2xl"
                    style={{
                      fontFamily: currentSegment.overlayConfig?.fontFamily || globalOverlayConfig.fontFamily,
                      color: currentSegment.overlayConfig?.color || globalOverlayConfig.color,
                      fontSize: `${isFullscreen ? 80 : 60}px`,
                      fontWeight: currentSegment.overlayConfig?.fontWeight || 900,
                      fontStyle: currentSegment.overlayConfig?.fontStyle || 'normal',
                      textShadow: currentSegment.overlayConfig?.textShadow || '0 4px 15px rgba(0,0,0,0.5)',
                    }}
                  >
                    {currentSegment.heading}
                  </motion.h3>
                )}
                {((!hideAllText && currentSegment.text) || (currentSegment.showOverlay && currentSegment.text)) && (
                  <motion.div
                    initial={{ y: 30, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="max-w-3xl px-10 py-6 rounded-3xl"
                    style={{
                      backgroundColor: currentSegment.overlayConfig?.backgroundColor || globalOverlayConfig.backgroundColor,
                    }}
                  >
                    <p
                      className="font-light leading-relaxed tracking-wide drop-shadow-md italic"
                      style={{
                        fontFamily: currentSegment.overlayConfig?.fontFamily || globalOverlayConfig.fontFamily,
                        color: currentSegment.overlayConfig?.color || globalOverlayConfig.color,
                        fontSize: `${isFullscreen ? 32 : 24}px`,
                        fontWeight: currentSegment.overlayConfig?.fontWeight || 'normal',
                        fontStyle: currentSegment.overlayConfig?.fontStyle || 'italic',
                      }}
                    >
                      &ldquo;{currentSegment.text}&rdquo;
                    </p>
                  </motion.div>
                )}
              </div>
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
          see the hideAllText prop path; complete CSS suppression during canvas transition is not
          needed because the CSS segment motion.div is already exiting via AnimatePresence.
        */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{
            zIndex: 45,
            opacity: (transitionPreview.isActive || canvasHoldActive) ? 1 : 0,
            transition: 'opacity 100ms ease',
          }}
        />

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
