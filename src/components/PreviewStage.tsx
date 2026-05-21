/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layout, Maximize, Minimize, MonitorPlay } from 'lucide-react';
import { VideoSegment, Asset, TransitionType, AnimationType } from '../types';
import { getMotionProps } from '../constants';

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
  currentSegment: VideoSegment | undefined;
  currentTime: number;
  globalPlaybackSpeed: number;
  globalTransition: string;
  globalTransitionDuration: number;
  globalOverlayConfig: GlobalOverlayConfig;
  hideAllText: boolean;
  assets: Asset[];
  /** Called when the user drags an extra overlay to a new position. */
  onUpdateExtraOverlayPosition?: (segmentId: string, overlayId: string, x: number, y: number) => void;
}

export function PreviewStage({
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
              initial={currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || globalTransition).initial}
              animate={currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || globalTransition).animate}
              exit={currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || globalTransition).exit}
              transition={{ duration: currentSegment.transition === TransitionType.NONE ? 0 : (currentSegment.transitionDuration ?? globalTransitionDuration) }}
              className="absolute inset-0 bg-black"
            >
              {/* Visuals — media wrapper carries intra-segment camera-dynamics animation */}
              <motion.div
                className="absolute inset-0 overflow-hidden"
                {...getAnimationWrapperProps(
                  currentSegment.animation ?? AnimationType.NONE,
                  currentSegment.duration,
                )}
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
                      // Fade-in on segment enter; scale animation driven by wrapper (KEN_BURNS etc.)
                      <motion.img
                        src={asset.url}
                        className="w-full h-full object-cover"
                        initial={{ opacity: 0 }}
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

              {/* Extra Overlays Rendering — draggable when onUpdateExtraOverlayPosition is provided */}
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
                      zIndex: 40,
                      backdropFilter: 'blur(4px)',
                      touchAction: 'none', // required for pointer capture on touch
                    }}
                  >
                    {o.text}
                  </motion.div>
                );
              })}

              <div className="absolute inset-0 flex flex-col items-center justify-center p-20 text-center pointer-events-none select-none z-10">
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

        {/* Corner Stats */}
        <div className="absolute bottom-10 right-10 flex flex-col items-end gap-2">
          <div className="bg-black/80 backdrop-blur-md px-4 py-2 rounded-xl border border-white/5 flex items-center gap-3">
            <span className="text-[10px] font-mono text-[#F27D26]">{currentTime.toFixed(2)}s</span>
            <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
