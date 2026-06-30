/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Play, Pause, RotateCcw, AlertCircle, Trash2, Heading1,
} from 'lucide-react';
import { VideoSegment, Asset } from '../types';

const MIN_SEGMENT_DURATION = 0.3; // seconds — mirrors App.tsx constant

interface Props {
  segments: VideoSegment[];
  assets: Asset[];
  currentSegmentId: string | undefined;
  currentTime: number;
  isPlaying: boolean;
  isSynced: boolean;
  sliderT: number;
  onPixelsPerSecondChange: (pps: number) => void;
  globalPlaybackSpeed: number;
  resizingId: string | null;
  resizingType: 'start' | 'end' | null;
  trimmingSegmentId: string | null;
  isAdjustingTrim: boolean;
  voiceoverName: string | undefined;
  voiceoverUrl?: string;
  voiceoverFile?: File;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onResizeStart: (id: string, type: 'start' | 'end') => void;
  onSegmentUpdate: (updater: (prev: VideoSegment[]) => VideoSegment[]) => void;
  onOpenStockSearch: (segmentId: string) => void;
  onSetTrimmingSegment: (id: string | null) => void;
  onSetAdjustingTrim: (v: boolean) => void;
  onSelectSegment?: (id: string) => void;
  onDeleteHeading?: (id: string) => void;
}

export function Timeline({
  segments,
  assets,
  currentSegmentId,
  currentTime,
  isPlaying,
  isSynced,
  sliderT,
  onPixelsPerSecondChange,
  globalPlaybackSpeed,
  resizingId,
  resizingType,
  trimmingSegmentId,
  isAdjustingTrim,
  voiceoverName,
  voiceoverUrl,
  voiceoverFile,
  onTogglePlay,
  onSeek,
  onResizeStart,
  onSegmentUpdate,
  onOpenStockSearch,
  onSetTrimmingSegment,
  onSetAdjustingTrim,
  onSelectSegment,
  onDeleteHeading,
}: Props) {
  const totalDuration = useMemo(
    () => segments.reduce((acc, s) => acc + s.duration, 0) || 1,
    [segments],
  );

  const [containerWidth, setContainerWidth] = useState(0);

  // Measure the scroll container so the zoom formula can derive ppsMin from the
  // available width. Falls back to 800 until the first observation lands.
  useEffect(() => {
    const container = document.getElementById('timeline-scroll-area');
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Single source of truth for zoom: exponential interpolation between ppsMin
  // (fit-to-width) and ppsMax (100). When ppsMin >= ppsMax the project is short
  // enough to fit, so the slider is a no-op pinned at 100.
  const pixelsPerSecond = useMemo(() => {
    const totalDur = segments.reduce((acc, s) => acc + s.duration, 0) || 1;
    const width = containerWidth || 800;
    const ppsMin = Math.min((width * 0.95) / totalDur, 100);
    const ppsMax = 100;
    if (ppsMin >= ppsMax) return ppsMax;
    return ppsMin * Math.pow(ppsMax / ppsMin, sliderT);
  }, [sliderT, containerWidth, segments]);

  // Keep App's pixelsPerSecond ref in sync for its non-rendering consumer sites.
  useEffect(() => {
    onPixelsPerSecondChange(pixelsPerSecond);
  }, [pixelsPerSecond, onPixelsPerSecondChange]);

  const [waveformBars, setWaveformBars] = useState<number[]>([]);
  // useRef available for future use (e.g. AudioContext ref)
  const _audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!voiceoverUrl) { setWaveformBars([]); return; }
    let cancelled = false;
    (async () => {
      try {
        let arrayBuf: ArrayBuffer;
        if (voiceoverFile) {
          // Prefer the raw File — avoids blob URL fetch restrictions in WebView2 (Windows)
          arrayBuf = await voiceoverFile.arrayBuffer();
        } else {
          const res = await fetch(voiceoverUrl);
          arrayBuf = await res.arrayBuffer();
        }
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        await audioCtx.close();
        const raw = decoded.getChannelData(0);
        const BAR_COUNT = 300;
        const blockSize = Math.floor(raw.length / BAR_COUNT);
        const bars: number[] = [];
        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) sum += Math.abs(raw[i * blockSize + j] ?? 0);
          bars.push(sum / blockSize);
        }
        const max = Math.max(...bars, 0.001);
        if (!cancelled) setWaveformBars(bars.map(b => b / max));
      } catch {
        if (!cancelled) setWaveformBars([]);
      }
    })();
    return () => { cancelled = true; };
  }, [voiceoverUrl, voiceoverFile]);

  // Keep the active segment visible: when the current segment changes (a segment
  // clicked in the left-panel list, a timeline click, or playback crossing a
  // boundary), scroll the timeline horizontally so it comes into view. Only
  // scrolls when the segment is off-screen, so it never fights manual scrubbing.
  useEffect(() => {
    if (!currentSegmentId) return;
    const seg = segments.find(s => s.id === currentSegmentId);
    if (!seg) return;
    const container = document.getElementById('timeline-scroll-area');
    if (!container) return;
    const left = seg.startTime * pixelsPerSecond;
    const right = (seg.startTime + seg.duration) * pixelsPerSecond;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;
    // Clamp to the timeline CONTENT width (segments), not container.scrollWidth —
    // the decorative ruler overflows the content by a few px, and using scrollWidth
    // let that overflow scroll segment 1 off the left edge.
    const maxScroll = Math.max(0, totalDuration * pixelsPerSecond - container.clientWidth);
    if (left < viewLeft) {
      container.scrollTo({ left: Math.min(maxScroll, Math.max(0, left - 24)), behavior: 'smooth' });
    } else if (right > viewRight) {
      container.scrollTo({ left: Math.min(maxScroll, Math.max(0, right - container.clientWidth + 24)), behavior: 'smooth' });
    }
  }, [currentSegmentId, pixelsPerSecond, segments]);

  // Center the active segment when the zoom slider moves. Fires ONLY on sliderT
  // change (not pixelsPerSecond/currentSegmentId/segments) so it never fights the
  // active-segment effect above, which has a different trigger. Instant, not smooth.
  useEffect(() => {
    const container = document.getElementById('timeline-scroll-area');
    if (!container || !currentSegmentId) return;
    const seg = segments.find(s => s.id === currentSegmentId);
    if (!seg) return;
    const segStart = segments
      .slice(0, segments.indexOf(seg))
      .reduce((acc, s) => acc + s.duration, 0);
    const segCenterX = (segStart + seg.duration / 2) * pixelsPerSecond;
    const targetScrollLeft = segCenterX - container.clientWidth / 2;
    // Clamp to the timeline CONTENT width (segments), not container.scrollWidth —
    // the decorative ruler overflows by a few px; when the content fits the viewport
    // maxScroll is 0 and segment 1 stays pinned to the left edge.
    const maxScroll = Math.max(0, totalDuration * pixelsPerSecond - container.clientWidth);
    container.scrollLeft = Math.min(maxScroll, Math.max(0, targetScrollLeft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderT]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden relative">
      {/* Timeline Tracks Area */}
      <div
        id="timeline-scroll-area"
        role="slider"
        tabIndex={0}
        aria-label="Timeline position"
        aria-valuenow={Math.round(currentTime * 10) / 10}
        aria-valuemin={0}
        aria-valuemax={Math.round(totalDuration * 10) / 10}
        aria-valuetext={`${Math.floor(currentTime / 60).toString().padStart(2, '0')}:${Math.floor(currentTime % 60).toString().padStart(2, '0')}`}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 5 : 1;
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            onSeek(Math.min(totalDuration, currentTime + step));
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            onSeek(Math.max(0, currentTime - step));
          }
        }}
        className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar relative bg-[#030303] flex flex-col p-0 pt-[15px] cursor-crosshair focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F27D26] focus-visible:ring-inset"
        onMouseDown={(e) => {
          const timeline = document.getElementById('timeline-scroll-area');
          if (timeline && !resizingId) {
            const rect = timeline.getBoundingClientRect();
            const x = e.clientX - rect.left + timeline.scrollLeft;
            const time = Math.max(0, x / pixelsPerSecond);
            onSeek(time);
          }
          if (resizingId) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const scrollLeft = e.currentTarget.scrollLeft;
          const x = e.clientX - rect.left + scrollLeft;
          const newTime = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
          onSeek(newTime);

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const moveX = moveEvent.clientX - rect.left + scrollLeft - 24;
            onSeek(Math.max(0, Math.min(totalDuration, moveX / pixelsPerSecond)));
          };
          const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
          };
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
        }}
      >
        {/* Time Ruler */}
        <div className="absolute top-4 left-6 right-6 h-4 border-b border-[#1A1A1A] flex items-end">
          {Array.from({ length: Math.ceil(totalDuration) + 1 }).map((_, i) => (
            <div key={i} className="flex-shrink-0" style={{ width: `${pixelsPerSecond}px` }}>
              <div className="h-2 w-px bg-gray-800" />
              <span className="text-[7px] text-gray-700 absolute -bottom-1 transform -translate-x-1/2 font-mono">{(i * 1).toFixed(1)}s</span>
            </div>
          ))}
        </div>

        {/* Tracks */}
        <div className="flex-shrink-0 flex gap-2 relative mt-0">
          {/* Playhead */}
          <motion.div
            className="absolute top-0 bottom-0 w-px bg-[#F27D26] z-50 shadow-[0_0_10px_#F27D26]"
            style={{
              left: `${currentTime * pixelsPerSecond}px`,
              transition: isPlaying ? 'none' : 'left 0.1s linear',
            }}
          >
            <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-[#F27D26] rotate-45" />
            <div className="absolute top-0 bottom-0 left-0 w-[2px] bg-white opacity-20" />
          </motion.div>

          {/* Visual Track */}
          {!isSynced ? (
            <div className="flex-1 h-20 bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg" style={{ minWidth: '100%' }} />
          ) : (
            <div className="flex h-full items-stretch">
              {segments.map((s, i) => {
                const asset = assets.find(a => a.id === s.assetId);
                const isActive = currentSegmentId === s.id;
                const isMissing = !asset && !!(s.text || s.heading || s.isHeading);

                return (
                  <div
                    key={s.id}
                    onClick={(e) => { e.stopPropagation(); onSeek(s.startTime); }}
                    onDoubleClick={(e) => { e.stopPropagation(); onSeek(s.startTime); onSelectSegment?.(s.id); }}
                    onMouseDown={(e) => {
                      if (isAdjustingTrim && trimmingSegmentId === s.id) {
                        e.stopPropagation();
                        const startX = e.clientX;
                        const startTrim = s.trimStart ?? 0;

                        const handleMouseMove = (moveEvent: MouseEvent) => {
                          const deltaX = moveEvent.clientX - startX;
                          const deltaTime = deltaX / pixelsPerSecond;
                          const maxTrim = Math.max(0, (s.sourceDuration ?? 60) - s.duration);
                          const newTrim = Math.max(0, Math.min(maxTrim, startTrim - deltaTime));
                          onSegmentUpdate(prev => prev.map(seg => seg.id === s.id ? { ...seg, trimStart: newTrim } : seg));
                        };
                        const handleMouseUp = () => {
                          window.removeEventListener('mousemove', handleMouseMove);
                          window.removeEventListener('mouseup', handleMouseUp);
                        };
                        window.addEventListener('mousemove', handleMouseMove);
                        window.addEventListener('mouseup', handleMouseUp);
                      } else {
                        e.stopPropagation();
                        if (resizingId) return;
                        onSeek(s.startTime);
                      }
                    }}
                    style={{
                      width: `${s.duration * pixelsPerSecond}px`,
                      height: '80px',
                      opacity: isAdjustingTrim && trimmingSegmentId !== s.id ? 0.3 : 1,
                      filter: isAdjustingTrim && trimmingSegmentId !== s.id ? 'grayscale(0.5)' : 'none',
                      transform: isAdjustingTrim && trimmingSegmentId === s.id ? 'scale(1.02)' : 'scale(1)',
                      boxShadow: isAdjustingTrim && trimmingSegmentId === s.id ? '0 0 30px rgba(242,125,38,0.3)' : 'none',
                      zIndex: isAdjustingTrim && trimmingSegmentId === s.id ? 50 : (isActive ? 10 : 1),
                    }}
                    className={`rounded-lg border transition-[opacity,filter,transform,box-shadow,border-color,background-color] duration-300 cursor-pointer relative flex flex-col group overflow-hidden ${isActive ? 'bg-[#151515] border-[#F27D26]' : 'bg-[#080808] border-[#1A1A1A] hover:bg-[#0C0C0C]'} ${isAdjustingTrim && trimmingSegmentId === s.id ? 'ring-2 ring-[#F27D26] ring-offset-4 ring-offset-black' : ''}`}
                  >
                    {isAdjustingTrim && trimmingSegmentId === s.id && (
                      <div className="absolute inset-x-0 top-0 h-4 bg-[#F27D26] flex items-center justify-center z-30">
                        <span className="text-[7px] font-black uppercase tracking-widest text-black">Drag to Slip Content (Start: {(s.trimStart ?? 0).toFixed(2)}s)</span>
                      </div>
                    )}

                    <div className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-20 hover:bg-[#F27D26]/20 transition-colors"
                      onMouseDown={(e) => { e.stopPropagation(); onResizeStart(s.id, 'start'); }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-20 hover:bg-[#F27D26]/20 transition-colors"
                      onMouseDown={(e) => { e.stopPropagation(); onResizeStart(s.id, 'end'); }}
                      onClick={(e) => e.stopPropagation()}
                    />

                    <div className="flex-1 relative bg-black/50">
                      {s.isHeading ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <Heading1 size={16} className="text-[#F27D26]/50" />
                        </div>
                      ) : asset?.url ? (
                        asset.type === 'video' ? (
                          <video src={asset.url} className={`w-full h-full object-cover opacity-40 ${isActive ? 'opacity-80' : ''}`} />
                        ) : (
                          <img src={asset.url} className={`w-full h-full object-cover opacity-30 transition-transform duration-700 ${isActive ? 'scale-110 opacity-70' : 'group-hover:scale-105'}`} alt={asset.name} />
                        )
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <AlertCircle size={14} className={isMissing ? 'text-red-900 animate-pulse' : 'text-gray-900'} />
                        </div>
                      )}

                      <div className="absolute inset-0 p-2 flex flex-col justify-between pointer-events-none">
                        <div className="flex justify-between items-start">
                          <div className="flex flex-col gap-1">
                            <span className="px-1 py-0.5 bg-black/60 rounded-sm text-[7px] font-mono text-[#F27D26]">#{i + 1}</span>
                            {s.playbackSpeed !== 1 && (
                              <span className="px-1 py-0.5 bg-[#F27D26]/20 text-[#F27D26] rounded-sm text-[6px] font-mono">
                                {(s.playbackSpeed ?? 1).toFixed(2)}x
                              </span>
                            )}
                            {(s.trimStart ?? 0) > 0 && (
                              <span className="px-1 py-0.5 bg-blue-500/20 text-blue-400 rounded-sm text-[6px] font-mono">
                                Slip: {(s.trimStart ?? 0).toFixed(1)}s
                              </span>
                            )}
                          </div>
                          {s.isHeading && onDeleteHeading ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); onDeleteHeading(s.id); }}
                              className="px-1.5 py-1 text-red-400 hover:text-red-300 pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label="Delete heading"
                              title="Delete heading"
                            >
                              <Trash2 size={12} />
                            </button>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); onOpenStockSearch(s.id); }}
                              className="px-1.5 py-1 bg-blue-500 text-white rounded text-[8px] font-black uppercase pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              Change
                            </button>
                          )}
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[8px] font-black text-white/90 uppercase tracking-tight truncate">{s.headingConfig?.text ?? s.heading ?? 'Scene'}</p>
                          <p className="text-[7px] text-gray-500 font-medium truncate italic">{s.text}</p>
                        </div>
                      </div>

                      {(s.trimStart ?? 0) > 0 && (
                        <div className="absolute left-0 top-0 bottom-0 w-2 bg-red-500/20 border-r border-red-500/40" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Captions track — hook-in for Task 9d (captionCues not yet wired) */}
        {false && (
          <div className="h-8 border-t border-[#1A1A1A] flex items-center px-2">
            {/* caption cues rendered here — Task 9d */}
          </div>
        )}

        {/* Audio Track */}
        {voiceoverName && (
          <div className="mt-1 h-20 w-max bg-[#0A0A0A] ring-1 ring-inset ring-[#1A1A1A] rounded-lg relative overflow-visible flex items-center">
            <div className="flex h-full w-max">
              {segments.map((s) => (
                <div
                  key={`vo-${s.id}`}
                  style={{ width: `${s.duration * pixelsPerSecond}px` }}
                  className="h-full border-r border-[#2A2A2A] relative flex items-center group flex-shrink-0"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-[#F27D26]/50"
                    onMouseDown={(e) => { e.stopPropagation(); onResizeStart(s.id, 'start'); }} />
                  <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-[#F27D26]/50"
                    onMouseDown={(e) => { e.stopPropagation(); onResizeStart(s.id, 'end'); }} />
                  <div className="flex-1 flex items-center px-1">
                    {(() => {
                      const segStart = segments.slice(0, segments.indexOf(s)).reduce((a, seg) => a + seg.duration, 0);
                      const startBar = Math.floor((segStart / totalDuration) * waveformBars.length);
                      const endBar = Math.floor(((segStart + s.duration) / totalDuration) * waveformBars.length);
                      const bars = waveformBars.slice(startBar, endBar);
                      if (bars.length === 0) return <div className="h-px bg-[#2A2A2A] w-full self-center" />;
                      return (
                        <div className="flex items-center h-full w-full gap-px px-0.5">
                          {bars.map((amp, bi) => (
                            <div
                              key={bi}
                              className="flex-1 bg-[#F27D26]/60 rounded-[1px] min-w-[1px]"
                              style={{ height: `${Math.max(6, Math.pow(amp, 0.5) * 68)}px` }}
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  {currentSegmentId === s.id && (
                    <div className="absolute inset-0 bg-[#F27D26]/5" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
