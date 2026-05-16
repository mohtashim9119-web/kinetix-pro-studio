/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layout, Maximize, Minimize, MonitorPlay } from 'lucide-react';
import { VideoSegment, Asset, TransitionType } from '../types';
import { getMotionProps } from '../constants';

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
}: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMidView, setIsMidView] = useState(false);

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
    <div className="flex-1 flex items-center justify-center">
      <div
        className={`relative mx-auto bg-black rounded-[40px] border border-[#1A1A1A] overflow-hidden shadow-2xl group ${isFullscreen ? 'fixed inset-0 z-[5000] !rounded-none !max-w-none !w-screen !h-screen flex items-center justify-center bg-black' : 'transition-all duration-500 ' + (isMidView ? 'aspect-video w-[900px] h-auto' : 'aspect-video max-w-5xl w-full h-auto')}`}
      >
        {/* Floating Controls */}
        <div className="absolute top-6 right-6 z-[1001] flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setIsMidView(!isMidView)}
            className="p-3 bg-black/50 backdrop-blur-md rounded-xl text-white border border-white/10 hover:bg-[#F27D26] transition-all"
          >
            <Layout size={20} />
          </button>
          <button
            onClick={toggleNativeFullscreen}
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
              {/* Visuals */}
              <div className="absolute inset-0 overflow-hidden">
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
                              const videoTime = (currentSegment.trimStart || 0) + (segmentProgress * (currentSegment.playbackSpeed || 1));
                              if (Math.abs(el.currentTime - videoTime) > 0.1) {
                                el.currentTime = videoTime;
                              }
                            }
                          }}
                        />
                      );
                    }
                    return (
                      <motion.img
                        src={asset.url}
                        className="w-full h-full object-cover"
                        initial={{ scale: 1, opacity: 0 }}
                        animate={{ scale: 1.1, opacity: 1 }}
                        transition={{ duration: currentSegment.duration, ease: "linear" }}
                      />
                    );
                  }
                  return (
                    <div className="w-full h-full bg-gradient-to-br from-[#111] to-[#050505] flex items-center justify-center p-20 text-center" />
                  );
                })()}
              </div>

              {/* Main Overlays Gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 pointer-events-none" />

              {/* Extra Overlays Rendering */}
              {currentSegment.extraOverlays?.map((o) => (
                <motion.div
                  key={o.id}
                  {...getMotionProps(o.animation || 'fade')}
                  className="absolute pointer-events-none p-4 rounded-xl shadow-lg border border-white/5"
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
                  }}
                >
                  {o.text}
                </motion.div>
              ))}

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
