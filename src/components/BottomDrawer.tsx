/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, Lock, Unlock, ArrowLeftRight, Sparkles, Layers } from 'lucide-react';
import { VideoSegment, Asset } from '../types';
import { SegmentControls } from './SegmentControls';
import { labelOf, TRANSITIONS, ANIMATIONS, OVERLAYS, TRANSITION_NONE, ANIMATION_NONE, OVERLAY_NONE } from '../effectsOptions';

interface Props {
  segment: VideoSegment | null;
  segmentIndex: number;
  assets: Asset[];
  globalOverlayConfig: NonNullable<VideoSegment['overlayConfig']>;
  onClose: () => void;
  onUpdateSegment: (idx: number, updates: Partial<VideoSegment>) => void;
  onUpdateSegmentOverlay: (idx: number, updates: Partial<NonNullable<VideoSegment['overlayConfig']>>) => void;
  onOpenStockSearch: (segmentId: string) => void;
  onToggleLock: (segmentId: string) => void;
  onSeek?: (time: number) => void;
}

export function BottomDrawer({
  segment,
  segmentIndex,
  assets,
  globalOverlayConfig,
  onClose,
  onUpdateSegment,
  onUpdateSegmentOverlay,
  onOpenStockSearch,
  onToggleLock,
  onSeek,
}: Props) {
  const trimTrackRef = useRef<HTMLDivElement>(null);

  const s = segment;
  const idx = segmentIndex;

  const effectPills = s && !s.isHeading ? [
    s.effectTransition && s.effectTransition !== TRANSITION_NONE
      ? { icon: ArrowLeftRight, label: labelOf(TRANSITIONS, s.effectTransition) }
      : null,
    s.effectAnimation && s.effectAnimation !== ANIMATION_NONE
      ? { icon: Sparkles, label: labelOf(ANIMATIONS, s.effectAnimation) }
      : null,
    s.effectOverlay && s.effectOverlay !== OVERLAY_NONE
      ? { icon: Layers, label: labelOf(OVERLAYS, s.effectOverlay) }
      : null,
  ].filter((p): p is { icon: typeof ArrowLeftRight; label: string } => p !== null && p.label !== undefined) : [];

  const asset = s ? assets.find(a => a.id === s.assetId) : undefined;
  const isVideo = asset?.type === 'video';
  const srcDur = s?.sourceDuration ?? 60;
  const trimStart = s?.trimStart ?? 0;
  // Bar width is always fixed = segment.duration (slip model — only position slides)
  const widthPct = srcDur > 0 && s ? (s.duration * (s.playbackSpeed ?? 1) / srcDur) * 100 : 0;
  const leftPct  = srcDur > 0 ? (trimStart / srcDur) * 100 : 0;

  return (
    <AnimatePresence>
      {s && (
        <motion.div
          initial={{ y: '100%', x: '-50%' }}
          animate={{ y: 0, x: '-50%' }}
          exit={{ y: '100%', x: '-50%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed bottom-0 z-50
                     bg-[#0A0A0A] border-t border-[#1A1A1A]
                     rounded-t-3xl shadow-2xl"
          style={{ maxHeight: '45vh', left: '50%', width: '50vw' }}
        >
          {/* Header */}
          <div className="grid grid-cols-3 items-center px-6 py-3 border-b border-[#1A1A1A]">
            <div className="flex items-center gap-3 justify-self-start">
              <div className="w-8 h-1 rounded-full bg-[#282828]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                {s.headingConfig?.text || s.heading || `Scene ${idx + 1}`}
              </span>
              <span className="px-2 py-0.5 bg-[#1A1A1A] rounded text-[9px] font-mono text-gray-500">
                {s.duration.toFixed(1)}s
              </span>
            </div>
            <div className="flex items-center gap-2 justify-self-center">
              {effectPills.map(({ icon: Icon, label }, i) => (
                <div
                  key={i}
                  title={label}
                  className="flex items-center justify-center gap-1.5 px-2 py-1.5 w-[110px]
                             rounded-lg border border-[#282828] bg-[#1A1A1A]
                             text-[9px] font-black uppercase tracking-widest
                             whitespace-nowrap overflow-hidden text-gray-400"
                >
                  <Icon className="w-3 h-3 shrink-0 text-gray-500" />
                  <span className="truncate">{label}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 justify-self-end">
              <button
                onClick={() => onToggleLock(s.id)}
                className="flex items-center gap-1 text-[9px] uppercase tracking-widest transition-colors"
                style={{ color: s.locked ? '#F27D26' : '#4B5563' }}
              >
                {s.locked ? <><Lock size={10} /> Locked</> : <><Unlock size={10} /> Lock</>}
              </button>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-[#1A1A1A] transition-colors"
              >
                <X size={14} className="text-gray-500" />
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto p-5 space-y-4" style={{ maxHeight: 'calc(45vh - 52px)' }}>

            {/* Shared controls — same set as the Review Mapping card (no thumbnail) */}
            <SegmentControls
              segment={s}
              index={idx}
              assets={assets}
              globalOverlayConfig={globalOverlayConfig}
              onUpdateSegment={onUpdateSegment}
              onUpdateSegmentOverlay={onUpdateSegmentOverlay}
              onOpenStockSearch={onOpenStockSearch}
            />

            {/* Visual Trim Bar — video segments only (slip model) */}
            {isVideo && s && (
              <div className="space-y-2 pt-1">
                <label className="text-[7px] uppercase font-bold text-gray-500 block">Clip Trim</label>

                {/* Track */}
                <div className="relative h-6 select-none" ref={trimTrackRef}>
                  <div className="absolute inset-y-0 left-0 right-0 flex items-center">
                    <div className="relative w-full h-2.5 rounded-full bg-[#161616]">
                      {/* Active zone — fixed width = segment.duration / srcDur.
                          Drag to slip (move window), click to seek preview. */}
                      <div
                        className="absolute top-0 bottom-0 bg-[#F27D26] rounded-full cursor-grab active:cursor-grabbing"
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (srcDur <= 0) return;
                          const track = trimTrackRef.current;
                          if (!track) return;
                          const startX = e.clientX;
                          const rect = track.getBoundingClientRect();
                          const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                          const offsetInTime = clickRatio * srcDur - trimStart;
                          const maxStart = Math.max(0, srcDur - s.duration);
                          let didMove = false;
                          const handleMove = (me: PointerEvent) => {
                            if (!didMove && Math.abs(me.clientX - startX) < 3) return;
                            didMove = true;
                            const r = trimTrackRef.current?.getBoundingClientRect();
                            if (!r) return;
                            const ratio = Math.max(0, Math.min(1, (me.clientX - r.left) / r.width));
                            const newStart = Math.max(0, Math.min(maxStart, ratio * srcDur - offsetInTime));
                            onUpdateSegment(idx, { trimStart: newStart, trimEnd: newStart + s.duration });
                          };
                          const cleanup = (ue: Event) => {
                            window.removeEventListener('pointermove', handleMove);
                            window.removeEventListener('pointerup', cleanup);
                            if (!didMove && onSeek) {
                              const r = trimTrackRef.current?.getBoundingClientRect();
                              if (!r) return;
                              const pe = ue as PointerEvent;
                              const ratio = Math.max(0, Math.min(1, (pe.clientX - r.left) / r.width));
                              onSeek(s.startTime + ratio * s.duration);
                            }
                          };
                          window.addEventListener('pointermove', handleMove);
                          window.addEventListener('pointerup', cleanup);
                        }}
                      />
                    </div>
                  </div>

                  {/* Left handle — left edge of window tracks mouse */}
                  <div
                    className="absolute inset-y-0 z-10 flex items-center justify-center cursor-col-resize"
                    style={{ left: `calc(${leftPct}% - 5px)`, width: '10px' }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (srcDur <= 0) return;
                      const maxStart = Math.max(0, srcDur - s.duration);
                      const handleMove = (me: PointerEvent) => {
                        const r = trimTrackRef.current?.getBoundingClientRect();
                        if (!r) return;
                        const ratio = Math.max(0, Math.min(1, (me.clientX - r.left) / r.width));
                        const newStart = Math.max(0, Math.min(maxStart, ratio * srcDur));
                        onUpdateSegment(idx, { trimStart: newStart, trimEnd: newStart + s.duration });
                      };
                      const cleanup = () => {
                        window.removeEventListener('pointermove', handleMove);
                        window.removeEventListener('pointerup', cleanup);
                      };
                      window.addEventListener('pointermove', handleMove);
                      window.addEventListener('pointerup', cleanup);
                    }}
                  >
                    <div className="w-[3px] h-5 rounded-full bg-blue-400 shadow-lg" />
                  </div>

                  {/* Right handle — right edge of window tracks mouse */}
                  <div
                    className="absolute inset-y-0 z-10 flex items-center justify-center cursor-col-resize"
                    style={{ left: `calc(${leftPct + widthPct}% - 5px)`, width: '10px' }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (srcDur <= 0) return;
                      const maxStart = Math.max(0, srcDur - s.duration);
                      const handleMove = (me: PointerEvent) => {
                        const r = trimTrackRef.current?.getBoundingClientRect();
                        if (!r) return;
                        const ratio = Math.max(0, Math.min(1, (me.clientX - r.left) / r.width));
                        const newStart = Math.max(0, Math.min(maxStart, ratio * srcDur - s.duration));
                        onUpdateSegment(idx, { trimStart: newStart, trimEnd: newStart + s.duration });
                      };
                      const cleanup = () => {
                        window.removeEventListener('pointermove', handleMove);
                        window.removeEventListener('pointerup', cleanup);
                      };
                      window.addEventListener('pointermove', handleMove);
                      window.addEventListener('pointerup', cleanup);
                    }}
                  >
                    <div className="w-[3px] h-5 rounded-full bg-purple-400 shadow-lg" />
                  </div>
                </div>

                {/* Time labels: start · total · end of window */}
                <div className="flex justify-between text-[7px] font-mono">
                  <span className="text-blue-400">{trimStart.toFixed(1)}s</span>
                  <span className="text-gray-600">{srcDur.toFixed(1)}s total</span>
                  <span className="text-purple-400">{(trimStart + s.duration).toFixed(1)}s</span>
                </div>
              </div>
            )}

          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
