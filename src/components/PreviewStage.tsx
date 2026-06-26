/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Maximize, Minimize, MonitorPlay } from 'lucide-react';
import { VideoSegment, Asset, TransitionType, AnimationType, TextOverlay } from '../types';
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
  isPlaying: boolean;
  isResizingRef: React.RefObject<boolean>;
  /** Called when the user drags an extra overlay to a new position. */
  onUpdateExtraOverlayPosition?: (segmentId: string, overlayId: string, x: number, y: number) => void;
  /** Global text layers rendered above all segment content. */
  textLayers?: TextOverlay[];
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
  isPlaying,
  isResizingRef,
  onUpdateExtraOverlayPosition,
  textLayers,
}: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Canvas overlay for transition blending
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // FIX 1 — Dual persistent video elements (A/B slot pingpong).
  // Neither element is ever unmounted; we swap which is visible on segment change.
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const headingVideoRef = useRef<HTMLVideoElement>(null);
  const [activeSlot, setActiveSlot] = useState<'a' | 'b'>('a');
  const activeSlotRef = useRef<'a' | 'b'>('a');
  // FIX 2 — Mirror currentTime in a ref so effects can read it without dep churn.
  const currentTimeRef = useRef(currentTime);

  // Heading container measurement — ResizeObserver drives px font sizing so
  // the heading scales with the preview container, not the viewport (vh units).
  const [headingContainerHeight, setHeadingContainerHeight] = useState(0);
  const headingContainerRef = useRef<HTMLDivElement>(null);

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

  // Suppress Framer Motion entry/exit animations while canvas is handling the transition.
  const suppressMotionAnim = transitionPreview.isActive;

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
  useEffect(() => {
    if (!currentSegment) return;
    const currentAsset = assets.find(a => a.id === currentSegment.assetId);
    if (currentAsset?.type !== 'video') return;

    // Swap slots: the idle slot was preloading this segment — promote it to active.
    const prevSlot = activeSlotRef.current;
    const newSlot: 'a' | 'b' = prevSlot === 'a' ? 'b' : 'a';
    activeSlotRef.current = newSlot;
    setActiveSlot(newSlot);

    const activeEl  = newSlot === 'a' ? videoARef.current : videoBRef.current;
    const inactiveEl = newSlot === 'a' ? videoBRef.current : videoARef.current;

    if (!activeEl) return;

    // Load current segment (no-op when preload already set the correct src).
    if (activeEl.src !== currentAsset.url) {
      activeEl.src = currentAsset.url;
      activeEl.load();
    }

    // Seek to the correct intra-segment position.
    const segmentProgress = currentTimeRef.current - (currentSegment.startTime ?? 0);
    const rawTime = (currentSegment.trimStart || 0) + segmentProgress * (currentSegment.playbackSpeed || 1);
    const videoTime = currentSegment.trimEnd !== undefined
      ? Math.min(rawTime, currentSegment.trimEnd)
      : rawTime;
    seekToTime(activeEl, Math.max(0, videoTime));

    activeEl.playbackRate = (currentSegment.playbackSpeed || 1) * globalPlaybackSpeed;

    if (isPlaying) {
      activeEl.play().catch(() => {});
    } else {
      activeEl.pause();
    }

    // Preload the next video segment into the idle slot.
    const currentSegmentIndex = segments.findIndex(s => s.id === currentSegment.id);
    const nextSeg = segments[currentSegmentIndex + 1];
    const nextAsset = nextSeg ? assets.find(a => a.id === nextSeg.assetId) : null;
    const nextVideoUrl = nextAsset?.type === 'video' ? nextAsset.url : null;

    if (inactiveEl && nextVideoUrl && inactiveEl.src !== nextVideoUrl) {
      inactiveEl.src = nextVideoUrl;
      inactiveEl.preload = 'auto';
      inactiveEl.load();
    }
  }, [currentSegment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync play/pause whenever isPlaying toggles (independent of segment changes).
  useEffect(() => {
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
  const overlayPosX = currentSegment?.overlayConfig?.x ?? 50;
  const overlayPosY = currentSegment?.overlayConfig?.y ?? 78;

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
                  return initial:{opacity:0} which would produce a black flash on entry. */}
              <motion.div
                className="absolute inset-0 overflow-hidden"
                {...(suppressMotionAnim ? {} : getAnimationWrapperProps(
                  currentSegment.animation ?? AnimationType.NONE,
                  currentSegment.duration,
                ))}
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
                        muted
                        playsInline
                        preload="auto"
                      />
                      <video
                        ref={videoBRef}
                        className={`absolute inset-0 w-full h-full object-cover${isVideoAsset && activeSlot === 'b' ? '' : ' opacity-0 pointer-events-none'}`}
                        muted
                        playsInline
                        preload="auto"
                      />
                      {/* Image segments */}
                      {asset?.url && !isVideoAsset && (
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

              {/* Main heading + body text. Fades out during canvas transition overlay to prevent
                  double-render — same 100ms ease as the canvas fade-in so they crossfade cleanly. */}
              <div
                className="absolute inset-0 pointer-events-none select-none z-10"
                style={{ opacity: transitionPreview.isActive ? 0 : 1, transition: 'opacity 100ms ease' }}
              >
                {((!hideAllText && currentSegment.text) || (currentSegment.showOverlay && currentSegment.text)) && (
                  <motion.div
                    initial={{ y: 30, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    transformTemplate={(_, generated) => `translate(-${overlayPosX}%, -${overlayPosY}%) ${generated}`}
                    className="absolute max-w-3xl px-5 py-3 rounded-3xl text-center"
                    style={{
                      left: `${overlayPosX}%`,
                      top: `${overlayPosY}%`,
                      width: 'max-content',
                      backgroundColor: currentSegment.overlayConfig?.backgroundColor || globalOverlayConfig.backgroundColor,
                    }}
                  >
                    <p
                      className="font-light leading-relaxed tracking-wide drop-shadow-md italic"
                      style={{
                        fontFamily: currentSegment.overlayConfig?.fontFamily || globalOverlayConfig.fontFamily,
                        color: currentSegment.overlayConfig?.color || globalOverlayConfig.color,
                        fontSize: `${(currentSegment.overlayConfig?.fontSize ?? 24) * (isFullscreen ? 32 / 24 : 1)}px`,
                        fontWeight: currentSegment.overlayConfig?.fontWeight || 'normal',
                        fontStyle: currentSegment.overlayConfig?.fontStyle || 'italic',
                      }}
                    >
                      {currentSegment.text}
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
            opacity: transitionPreview.isActive ? 1 : 0,
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
