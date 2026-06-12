/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from 'motion/react';
import {
  Play, Pause, RotateCcw, Music, AlertCircle,
} from 'lucide-react';
import { VideoSegment, Asset } from '../types';

interface Props {
  segments: VideoSegment[];
  assets: Asset[];
  currentSegmentId: string | undefined;
  currentTime: number;
  isPlaying: boolean;
  isSynced: boolean;
  zoomLevel: number;
  globalPlaybackSpeed: number;
  resizingId: string | null;
  resizingType: 'start' | 'end' | null;
  trimmingSegmentId: string | null;
  isAdjustingTrim: boolean;
  voiceoverName: string | undefined;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onZoomChange: (zoom: number) => void;
  onResizeStart: (id: string, type: 'start' | 'end') => void;
  onSegmentUpdate: (updater: (prev: VideoSegment[]) => VideoSegment[]) => void;
  onOpenStockSearch: (segmentId: string) => void;
  onSetTrimmingSegment: (id: string | null) => void;
  onSetAdjustingTrim: (v: boolean) => void;
}

export function Timeline({
  segments,
  assets,
  currentSegmentId,
  currentTime,
  isPlaying,
  isSynced,
  zoomLevel,
  globalPlaybackSpeed,
  resizingId,
  resizingType,
  trimmingSegmentId,
  isAdjustingTrim,
  voiceoverName,
  onTogglePlay,
  onSeek,
  onZoomChange,
  onResizeStart,
  onSegmentUpdate,
  onOpenStockSearch,
  onSetTrimmingSegment,
  onSetAdjustingTrim,
}: Props) {
  const totalDuration = segments.reduce((acc, s) => acc + s.duration, 0) || 1;
  const pixelsPerSecond = 100 * zoomLevel;

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden relative">
      {/* Timeline Toolbar */}
      <div className="h-8 flex-shrink-0 px-4 border-b border-[#1A1A1A] flex items-center gap-4 bg-[#080808]">
        <button
          onClick={() => onSeek(0)}
          aria-label="Seek to start"
          className="p-1 text-gray-600 hover:text-white transition-colors"
        >
          <RotateCcw size={12} />
        </button>
        <button
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="w-6 h-6 bg-[#F27D26] rounded-full text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
        >
          {isPlaying ? <Pause size={10} /> : <Play size={10} fill="currentColor" />}
        </button>
        <span className="text-[10px] font-mono text-gray-400 tracking-widest">
          {Math.floor(currentTime / 60).toString().padStart(2, '0')}:
          {Math.floor(currentTime % 60).toString().padStart(2, '0')}:
          {Math.floor((currentTime % 1) * 100).toString().padStart(2, '0')}
        </span>
        <div className="flex-1" />
        <span className="text-[9px] uppercase tracking-widest text-gray-700">Zoom</span>
        <input
          type="range" min="0.5" max="10" step="0.1"
          value={zoomLevel}
          onChange={(e) => onZoomChange(parseFloat(e.target.value))}
          aria-label="Zoom level"
          className="w-24 h-1 bg-[#1A1A1A] rounded-full appearance-none accent-[#F27D26] cursor-pointer"
        />
      </div>

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
        className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar relative bg-[#030303] flex flex-col p-6 pt-10 cursor-crosshair focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F27D26] focus-visible:ring-inset"
        onMouseDown={(e) => {
          const timeline = document.getElementById('timeline-scroll-area');
          if (timeline && !resizingId) {
            const rect = timeline.getBoundingClientRect();
            const x = e.clientX - rect.left + timeline.scrollLeft - 24;
            const time = Math.max(0, x / pixelsPerSecond);
            onSeek(time);
          }
          if (resizingId) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const scrollLeft = e.currentTarget.scrollLeft;
          const x = e.clientX - rect.left + scrollLeft - 24;
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
          {Array.from({ length: Math.ceil(segments.reduce((acc, s) => acc + s.duration, 0) || 30) + 1 }).map((_, i) => (
            <div key={i} className="flex-shrink-0" style={{ width: `${pixelsPerSecond}px` }}>
              <div className="h-2 w-px bg-gray-800" />
              <span className="text-[7px] text-gray-700 absolute -bottom-1 transform -translate-x-1/2 font-mono">{(i * 1).toFixed(1)}s</span>
            </div>
          ))}
        </div>

        {/* Tracks */}
        <div className="flex-1 flex gap-2 relative mt-4">
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
            <div className="flex-1 h-14 bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg" style={{ minWidth: '100%' }} />
          ) : (
            <div className="flex gap-1 h-full items-stretch">
              {segments.map((s, i) => {
                const asset = assets.find(a => a.id === s.assetId);
                const isActive = currentSegmentId === s.id;
                const isMissing = !asset && !!(s.text || s.heading);

                return (
                  <div
                    key={s.id}
                    onClick={(e) => { e.stopPropagation(); onSeek(s.startTime); }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (trimmingSegmentId === s.id) {
                        onSetTrimmingSegment(null);
                        onSetAdjustingTrim(false);
                      } else {
                        onSetTrimmingSegment(s.id);
                        onSetAdjustingTrim(true);
                      }
                    }}
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
                      height: '56px',
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
                      {asset?.url ? (
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
                          <button
                            onClick={(e) => { e.stopPropagation(); onOpenStockSearch(s.id); }}
                            className="px-1.5 py-1 bg-blue-500 text-white rounded text-[8px] font-black uppercase pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            Change
                          </button>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[8px] font-black text-white/90 uppercase tracking-tight truncate">{s.heading ?? 'Scene'}</p>
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
          <div className="mt-2 h-12 bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg relative overflow-hidden flex items-center">
            <div className="absolute left-0 top-0 bottom-0 w-6 bg-[#F27D26]/10 flex items-center justify-center border-r border-[#F27D26]/20 z-10">
              <Music size={10} className="text-[#F27D26]" />
            </div>
            <div className="flex-1 flex h-full ml-6">
              {segments.map((s) => (
                <div
                  key={`vo-${s.id}`}
                  style={{ width: `${s.duration * pixelsPerSecond}px` }}
                  className="h-full border-r border-[#1A1A1A] relative flex items-center px-2 group"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-[#F27D26]/50"
                    onMouseDown={(e) => { e.stopPropagation(); onResizeStart(s.id, 'start'); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-[#F27D26]/50"
                    onMouseDown={(e) => { e.stopPropagation(); onResizeStart(s.id, 'end'); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex-1 flex items-center px-2">
                    <div className="h-px bg-[#2A2A2A] w-full" />
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
