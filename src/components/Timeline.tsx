/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Play, Pause, RotateCcw, AlertCircle, Heading1,
} from 'lucide-react';
import { VideoSegment, Asset, HeadingOverlay } from '../types';
import { patchUiState } from '../services/uiStateStore';
import { resizeHeading } from '../services/headingLayer';
import { WaveformSource } from '../services/waveformPeaks';
import { SegmentWaveform } from './SegmentWaveform';

const MIN_SEGMENT_DURATION = 0.3; // seconds — mirrors App.tsx constant

interface Props {
  segments: VideoSegment[];
  assets: Asset[];
  headings: HeadingOverlay[];
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
  // Waveform data is built ONCE upfront in App.tsx's Apply-Sync flow (and a reload
  // effect) via services/waveformPipeline, then passed in here. Timeline no longer
  // decodes/builds anything itself — that render-triggered decode effect was the
  // multi-minute freeze (docs/waveform-rewrite-plan.md §3).
  waveformSource: WaveformSource | null;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onResizeStart: (id: string, type: 'start' | 'end') => void;
  onSegmentUpdate: (updater: (prev: VideoSegment[]) => VideoSegment[]) => void;
  onOpenStockSearch: (segmentId: string) => void;
  onSetTrimmingSegment: (id: string | null) => void;
  onSetAdjustingTrim: (v: boolean) => void;
  onSelectSegment?: (id: string) => void;
  onHeadingResizeCommit?: (id: string, next: { time: number; duration: number }) => void;
  initialScrollLeft?: number;
}

export function Timeline({
  segments,
  assets,
  headings,
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
  waveformSource,
  onTogglePlay,
  onSeek,
  onResizeStart,
  onSegmentUpdate,
  onOpenStockSearch,
  onSetTrimmingSegment,
  onSetAdjustingTrim,
  onSelectSegment,
  onHeadingResizeCommit,
  initialScrollLeft,
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

  // Waveform data (legacy bars + peak source) now arrives as props, built once
  // upfront by services/waveformPipeline during Apply Sync / reload — see the
  // Props comment above. No decode/build happens in this component anymore.

  // One-shot scroll restore. Deferred until containerWidth first lands (non-zero)
  // from the ResizeObserver above — only then are pixelsPerSecond and the segment
  // (content) widths final. Restoring earlier (against the 800px fallback layout)
  // let the browser clamp scrollLeft to 0 because the content didn't yet overflow
  // the real viewport, producing the "0 then scroll" flash. useLayoutEffect
  // applies it before the paint of the measured frame; the two auto-scroll effects
  // below are gated on didRestoreRef so neither can clobber it before it lands.
  const didRestoreRef = useRef(false);
  useLayoutEffect(() => {
    if (didRestoreRef.current || containerWidth === 0) return;
    const el = document.getElementById('timeline-scroll-area');
    if (!el) return;
    if (initialScrollLeft) el.scrollLeft = initialScrollLeft;
    didRestoreRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerWidth]);

  // Attach the scroll listener here, where timeline-scroll-area is guaranteed
  // to exist in the DOM.
  useEffect(() => {
    const el = document.getElementById('timeline-scroll-area');
    if (!el) return;
    // Persist on scroll (debounced 300ms)
    let timer: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        patchUiState({ timelineScrollLeft: el.scrollLeft });
      }, 300);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener('scroll', handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skip the first execution on mount so the restored scrollLeft from
  // kinetix:ui:v1 is never overwritten before the user has interacted.
  const hasMountedRef = useRef(false);

  // Keep the active segment visible: when the current segment changes (a segment
  // clicked in the left-panel list, a timeline click, or playback crossing a
  // boundary), scroll the timeline horizontally so it comes into view. Only
  // scrolls when the segment is off-screen, so it never fights manual scrubbing.
  useEffect(() => {
    // Gate until the one-shot scroll restore has applied, so the mount-time and
    // width-settle runs can't override it. Checked before hasMountedRef so those
    // pre-restore runs don't consume the mount-skip; the first run AFTER restore
    // (the ResizeObserver pixelsPerSecond settle) is then absorbed by hasMountedRef.
    if (!didRestoreRef.current) return;
    if (!hasMountedRef.current) { hasMountedRef.current = true; return; }
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
    // Gate until the one-shot scroll restore has applied — this effect has no
    // mount guard of its own, so on reload it would otherwise center the current
    // segment and override the restored scroll. sliderT is stable through the
    // mount settle, so after restore this fires only on genuine zoom changes.
    if (!didRestoreRef.current) return;
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

  // Path B Phase 4 (docs/path-b-heading-layer-plan.md) — heading band edge-drag.
  // Reuses the f4da926 ref+rAF live-drag pattern: no setProject/onHeadingResizeCommit
  // per mousemove, live visual feedback via direct DOM style writes on the band
  // element (found via data-heading-id), the real commit fires exactly once on
  // mouseup. Fully independent of segment resize/layout — a heading band is an
  // absolutely-positioned overlay, not a flex track item.
  const handleHeadingResizeStart = (
    e: React.MouseEvent,
    heading: HeadingOverlay,
    edge: 'start' | 'end',
  ): void => {
    e.stopPropagation();
    const el = document.querySelector<HTMLElement>(`[data-heading-id="${heading.id}"]`);
    if (!el) return;
    const startClientX = e.clientX;
    const pps = pixelsPerSecond;
    let pendingClientX: number | null = null;
    let hasMoved = false;
    let rafId: number | null = null;

    const applyFrame = (): void => {
      rafId = null;
      if (pendingClientX === null) return;
      const deltaSeconds = (pendingClientX - startClientX) / pps;
      const next = resizeHeading(heading, edge, deltaSeconds);
      el.style.left = `${next.time * pps}px`;
      el.style.width = `${next.duration * pps}px`;
    };
    const handleMove = (moveEvent: MouseEvent): void => {
      pendingClientX = moveEvent.clientX;
      hasMoved = true;
      if (rafId === null) rafId = requestAnimationFrame(applyFrame);
    };
    const handleUp = (): void => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      if (!hasMoved || pendingClientX === null) return;
      const deltaSeconds = (pendingClientX - startClientX) / pps;
      onHeadingResizeCommit?.(heading.id, resizeHeading(heading, edge, deltaSeconds));
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

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
        onMouseDownCapture={(e) => {
          // Suppress the browser's default click-to-focus behavior for this
          // element specifically — role="slider" + tabIndex make it keyboard-
          // focusable (arrow-key seek, onKeyDown above) and its focus-visible
          // ring is legitimate for that path, but WebKit/Tauri's focus-visible
          // heuristic was also firing it on ordinary mouse clicks/drags inside
          // the timeline (scrubbing, resize-handles, heading drags), showing an
          // orange ring around the whole timeline during normal mouse use.
          // preventDefault on the capture-phase mousedown stops the native
          // focus-shift before any descendant's bubble-phase stopPropagation()
          // can leave it unaffected; real keyboard Tab-focus is untouched since
          // Tab never dispatches a mousedown.
          e.preventDefault();
        }}
        onMouseDown={(e) => {
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
        {/* Path B corrective fix (docs/path-b-heading-layer-plan.md, Phase 3/4/5
            correction) — three stacked lanes, top to bottom: headings, segments,
            voiceover waveform, each with the same bounded-lane border/background
            (bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg). Originally a
            ring-inset box-shadow (matching the waveform track's pre-existing
            style), but that was optically masked on the waveform lane — its
            cells sit flush edge-to-edge with near-full-height bars, unlike the
            heading/segment lanes which have visible background showing through
            gaps — so it's a real border now, which always paints at the box
            edge regardless of child content density. Same horizontal time-to-pixel
            mapping/scroll/zoom for all three. The playhead lives at THIS
            wrapper's level (not inside any one lane) so it spans the full
            vertical height of whichever lanes are currently rendered — 2 lanes
            (segments+waveform) with no headings yet, 3 once a heading exists —
            as one continuous line (CapCut-style), instead of being confined to
            the segment track's own height. */}
        <div className="flex-shrink-0 flex flex-col gap-1 relative">
          {/* Playhead — absolutely positioned against the lanes wrapper above,
              so top-0/bottom-0 spans every rendered lane. Horizontal position
              and smooth-follow animation are unchanged. */}
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

          {/* Heading lane — Path B new-layer headings (Phase 4). Own horizontal
              lane; never overlaps the segment track below. pointer-events-none
              on each band so clicks pass through; only the edge handles (and,
              going forward, any lane-level interactions) are interactive. */}
          {isSynced && headings.length > 0 && (
            <div className="relative h-20 flex-shrink-0 bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg">
              {headings.map((h) => (
                <div
                  key={h.id}
                  data-heading-id={h.id}
                  className="absolute top-0 bottom-0 z-30 bg-[#F27D26]/10 border-2 border-[#F27D26]/70 rounded-lg pointer-events-none flex items-center justify-center overflow-hidden"
                  style={{ left: `${h.time * pixelsPerSecond}px`, width: `${h.duration * pixelsPerSecond}px` }}
                >
                  <div className="flex items-center gap-1 px-1 max-w-full">
                    <Heading1 size={11} className="text-[#F27D26] flex-shrink-0" />
                    <span className="text-[7px] font-black uppercase tracking-wide text-[#F27D26] truncate">
                      {h.text || 'Heading'}
                    </span>
                  </div>
                  {h.needsReview && (
                    <div
                      className="absolute top-1 right-1 flex items-center gap-0.5 px-1 py-0.5 rounded-[4px] bg-[rgba(255,193,7,0.15)]"
                      title="Re-sync clamped this heading's time — review its position"
                    >
                      <AlertCircle size={9} className="text-[#ffc107]" />
                    </div>
                  )}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize pointer-events-auto hover:bg-[#F27D26]/40"
                    onMouseDown={(e) => handleHeadingResizeStart(e, h, 'start')}
                  />
                  <div
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize pointer-events-auto hover:bg-[#F27D26]/40"
                    onMouseDown={(e) => handleHeadingResizeStart(e, h, 'end')}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Segment track (unchanged internals — segment thumbnails; playhead
              now lives at the lanes-wrapper level above, spanning all lanes).
              Bounded-lane border/background matches the heading lane and
              waveform track for visual consistency across all three. */}
          <div className="flex-shrink-0 flex gap-2 bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg">
          {/* Visual Track */}
          {!isSynced ? (
            <div className="flex-1 h-20 bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg" style={{ minWidth: '100%' }} />
          ) : (
            <div className="flex h-full items-stretch">
              {segments.map((s, i) => {
                const asset = assets.find(a => a.id === s.assetId);
                const isActive = currentSegmentId === s.id;
                const isMissing = !asset && !!s.text;

                return (
                  <div
                    key={s.id}
                    data-seg-id={s.id}
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
                      {asset?.url ? (
                        asset.type === 'video' ? (
                          <video src={asset.url} className={`w-full h-full object-cover opacity-40 ${isActive ? 'opacity-80' : ''}`} />
                        ) : (
                          <img src={asset.url} draggable={false} className={`w-full h-full object-cover opacity-30 transition-transform duration-700 ${isActive ? 'scale-110 opacity-70' : 'group-hover:scale-105'}`} alt={asset.name} />
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
                          <p className="text-[8px] font-black text-white/90 uppercase tracking-tight truncate">Scene</p>
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

          {/* Audio waveform lane — the peak-based <SegmentWaveform> canvas path.
              Renders one per-segment waveform image from the WaveformSource built
              once by the Apply-Sync pipeline (services/waveformPipeline). This lane
              has NO data-seg-id (so App.tsx's resize-drag querySelectorAll never
              touches it) and NO resize handles — purely visual. */}
          {voiceoverName && (
            <div className="h-20 bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg relative overflow-visible flex items-center">
              <div className="flex h-full w-max">
                {segments.map((s) => (
                  <div
                    key={`vo-new-${s.id}`}
                    style={{ width: `${s.duration * pixelsPerSecond}px` }}
                    className="h-full border-r border-[#2A2A2A] relative flex items-center flex-shrink-0"
                  >
                    <SegmentWaveform segment={s} source={waveformSource} />
                    {currentSegmentId === s.id && (
                      <div className="absolute inset-0 bg-[#F27D26]/5 pointer-events-none" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Captions track — hook-in for Task 9d (captionCues not yet wired) */}
        {false && (
          <div className="h-8 border-t border-[#1A1A1A] flex items-center px-2">
            {/* caption cues rendered here — Task 9d */}
          </div>
        )}
      </div>
    </div>
  );
}
