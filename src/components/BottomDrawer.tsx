/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, Lock, Unlock, Video, Music, ChevronDown, ChevronUp } from 'lucide-react';
import { VideoSegment, Asset, HeadingConfig } from '../types';
import { FONT_FAMILIES, TEXT_ANIMATIONS } from '../constants';

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
  const [formattingOpen, setFormattingOpen] = useState(false);
  const trimTrackRef = useRef<HTMLDivElement>(null);

  const s = segment;
  const idx = segmentIndex;

  // Reset formatting panel when switching segments
  useEffect(() => {
    setFormattingOpen(false);
  }, [s?.id]);

  const asset = s ? assets.find(a => a.id === s.assetId) : undefined;
  const isVideo = asset?.type === 'video';
  const srcDur = s?.sourceDuration ?? 60;
  const trimStart = s?.trimStart ?? 0;
  // Bar width is always fixed = segment.duration (slip model — only position slides)
  const widthPct = srcDur > 0 && s ? (s.duration / srcDur) * 100 : 0;
  const leftPct  = srcDur > 0 ? (trimStart / srcDur) * 100 : 0;

  const hc = s?.headingConfig;
  const updateHC = (updates: Partial<HeadingConfig>) => {
    if (!s) return;
    const next: Partial<VideoSegment> = {
      headingConfig: { ...(hc ?? { text: '' }), ...updates },
      ...('text' in updates ? { heading: String(updates.text ?? '') } : {}),
    };
    if ('assetId' in updates) next.assetId = updates.assetId;
    onUpdateSegment(idx, next);
  };
  const fontSizeAuto = !hc?.fontSize;

  return (
    <AnimatePresence>
      {s && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="absolute bottom-0 left-0 right-0 z-50
                     bg-[#0A0A0A] border-t border-[#1A1A1A]
                     rounded-t-3xl shadow-2xl"
          style={{ maxHeight: '45vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-[#1A1A1A]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-1 rounded-full bg-[#282828]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                {s.headingConfig?.text || s.heading || `Scene ${idx + 1}`}
              </span>
              <span className="px-2 py-0.5 bg-[#1A1A1A] rounded text-[9px] font-mono text-gray-500">
                {s.duration.toFixed(1)}s
              </span>
            </div>
            <div className="flex items-center gap-2">
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

            {/* Standard two-column: Asset + Overlay — hidden for heading segments */}
            {!s.isHeading && (
              <div className="grid grid-cols-2 gap-4">

                {/* Left — Visual Asset */}
                <div className="space-y-2">
                  <label className="text-[7px] uppercase font-bold text-gray-500 block">Visual Asset</label>
                  <select
                    value={s.assetId ?? ''}
                    onChange={(e) => onUpdateSegment(idx, { assetId: e.target.value })}
                    className="w-full bg-[#121212] border border-[#282828] px-3 py-2 rounded-xl text-[10px] font-bold outline-none focus:border-[#F27D26] cursor-pointer"
                  >
                    <option value="">No Asset</option>
                    {assets.filter(a => a.type !== 'audio').map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => onOpenStockSearch(s.id)}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-blue-500 hover:text-white transition-all"
                  >
                    <Video size={12} /> Stock Search
                  </button>
                </div>

                {/* Right — Overlay Text */}
                <div className="space-y-2">
                  <label className="text-[7px] uppercase font-bold text-gray-500 block">Overlay Text</label>
                  <textarea
                    value={s.text}
                    onChange={(e) => onUpdateSegment(idx, { text: e.target.value })}
                    className="w-full bg-[#121212] border border-[#282828] px-3 py-2 rounded-xl text-[10px] h-14 outline-none focus:border-[#F27D26] resize-none"
                    placeholder="Scene overlay text…"
                  />
                  <button
                    onClick={() => setFormattingOpen(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-1.5 bg-[#121212] border border-[#282828] rounded-xl text-[9px] font-bold uppercase tracking-widest text-gray-500 hover:border-[#F27D26] hover:text-gray-300 transition-all"
                  >
                    <span>Formatting</span>
                    {formattingOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </button>
                </div>
              </div>
            )}

            {/* Full heading editor — shown for heading segments */}
            {s.isHeading && (
              <div className="p-4 bg-[#0D0D0D] border border-[#F27D26]/10 rounded-2xl space-y-3">
                <p className="text-[7px] font-black uppercase tracking-widest text-[#F27D26]">Heading Style</p>

                {/* Text */}
                <div className="space-y-1">
                  <label className="text-[7px] uppercase font-bold text-gray-600">Text</label>
                  <input
                    value={hc?.text ?? ''}
                    onChange={(e) => updateHC({ text: e.target.value })}
                    className="w-full bg-[#050505] border border-[#282828] px-3 py-2 rounded-xl text-[11px] font-bold outline-none focus:border-[#F27D26]"
                    placeholder="Heading text"
                  />
                </div>

                {/* Font family + weight */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Font</label>
                    <select
                      value={hc?.fontFamily ?? 'Inter'}
                      onChange={(e) => updateHC({ fontFamily: e.target.value })}
                      className="w-full bg-[#050505] border border-[#282828] px-2 py-1.5 rounded-lg text-[10px]"
                    >
                      {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Weight</label>
                    <select
                      value={String(hc?.fontWeight ?? 'bold')}
                      onChange={(e) => updateHC({ fontWeight: e.target.value })}
                      className="w-full bg-[#050505] border border-[#282828] px-2 py-1.5 rounded-lg text-[10px]"
                    >
                      <option value="normal">Normal</option>
                      <option value="bold">Bold</option>
                      <option value="900">Black</option>
                    </select>
                  </div>
                </div>

                {/* Font size + auto toggle */}
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Size (px)</label>
                    <input
                      type="number"
                      min={8} max={400}
                      disabled={fontSizeAuto}
                      value={hc?.fontSize ?? 100}
                      onChange={(e) => updateHC({ fontSize: Number(e.target.value) || undefined })}
                      className="w-full bg-[#050505] border border-[#282828] px-2 py-1.5 rounded-lg text-[10px] disabled:opacity-40"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer pb-1.5">
                    <input
                      type="checkbox"
                      checked={fontSizeAuto}
                      onChange={(e) => updateHC({ fontSize: e.target.checked ? undefined : 100 })}
                      className="accent-[#F27D26]"
                    />
                    <span className="text-[8px] uppercase font-bold text-gray-600">Auto fit</span>
                  </label>
                </div>

                {/* Text color + BG color */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Text Color</label>
                    <input
                      type="color"
                      value={hc?.color ?? '#ffffff'}
                      onChange={(e) => updateHC({ color: e.target.value })}
                      className="w-full h-8 bg-transparent border-none cursor-pointer rounded"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">BG Color</label>
                    <input
                      type="color"
                      value={hc?.backgroundColor ?? '#000000'}
                      onChange={(e) => updateHC({ backgroundColor: e.target.value })}
                      className="w-full h-8 bg-transparent border-none cursor-pointer rounded"
                    />
                  </div>
                </div>

                {/* X / Y position sliders */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">X: {hc?.x ?? 50}%</label>
                    <input
                      type="range"
                      min={0} max={100}
                      value={hc?.x ?? 50}
                      onChange={(e) => updateHC({ x: Number(e.target.value) })}
                      className="w-full accent-[#F27D26]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Y: {hc?.y ?? 50}%</label>
                    <input
                      type="range"
                      min={0} max={100}
                      value={hc?.y ?? 50}
                      onChange={(e) => updateHC({ y: Number(e.target.value) })}
                      className="w-full accent-[#F27D26]"
                    />
                  </div>
                </div>

                {/* Background asset */}
                <div className="space-y-1">
                  <label className="text-[7px] uppercase font-bold text-gray-600">BG Asset (optional)</label>
                  <select
                    value={hc?.assetId ?? ''}
                    onChange={(e) => updateHC({ assetId: e.target.value || undefined })}
                    className="w-full bg-[#050505] border border-[#282828] px-2 py-1.5 rounded-lg text-[10px]"
                  >
                    <option value="">None (solid color)</option>
                    {assets.filter(a => a.type !== 'audio').map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>

              </div>
            )}

            {/* Formatting panel — collapsed by default; hidden for heading segments */}
            {!s.isHeading && formattingOpen && (
              <div className="p-4 bg-[#0D0D0D] border border-[#1E1E1E] rounded-2xl space-y-3">
                <p className="text-[7px] font-black uppercase tracking-widest text-[#F27D26]">Text Formatting</p>
                <div className="grid grid-cols-2 gap-3">

                  <div className="space-y-1 col-span-2">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Font</label>
                    <select
                      value={s.overlayConfig?.fontFamily ?? globalOverlayConfig.fontFamily}
                      onChange={(e) => onUpdateSegmentOverlay(idx, { fontFamily: e.target.value })}
                      className="w-full bg-[#050505] border border-[#282828] px-2 py-1.5 rounded-lg text-[10px]"
                    >
                      {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Size</label>
                    <input
                      type="number"
                      value={s.overlayConfig?.fontSize ?? 60}
                      onChange={(e) => onUpdateSegmentOverlay(idx, { fontSize: parseInt(e.target.value) })}
                      className="w-full bg-[#050505] border border-[#282828] px-2 py-1.5 rounded-lg text-[10px]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Weight</label>
                    <select
                      value={s.overlayConfig?.fontWeight ?? 'bold'}
                      onChange={(e) => onUpdateSegmentOverlay(idx, { fontWeight: e.target.value })}
                      className="w-full bg-[#050505] border border-[#282828] px-2 py-1.5 rounded-lg text-[10px]"
                    >
                      <option value="normal">Normal</option>
                      <option value="bold">Bold</option>
                      <option value="900">Black</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Color</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={s.overlayConfig?.color ?? '#FFFFFF'}
                        onChange={(e) => onUpdateSegmentOverlay(idx, { color: e.target.value })}
                        className="h-8 flex-1 bg-transparent rounded cursor-pointer"
                      />
                      <button
                        onClick={() => onUpdateSegmentOverlay(idx, {
                          fontStyle: s.overlayConfig?.fontStyle === 'italic' ? 'normal' : 'italic',
                        })}
                        className={`px-2 py-1.5 rounded text-[9px] font-black italic ${
                          s.overlayConfig?.fontStyle === 'italic'
                            ? 'bg-[#F27D26] text-white'
                            : 'bg-[#050505] border border-[#282828] text-gray-500'
                        }`}
                      >I</button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Shadow</label>
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() => onUpdateSegmentOverlay(idx, {
                          textShadow: s.overlayConfig?.textShadow ? '' : '0 4px 15px rgba(0,0,0,1)',
                        })}
                        className={`flex-1 py-1.5 rounded text-[7px] font-black ${
                          s.overlayConfig?.textShadow
                            ? 'bg-[#F27D26] text-white'
                            : 'bg-[#050505] border border-[#282828] text-gray-500'
                        }`}
                      >Shadow</button>
                      <input
                        type="color"
                        value="#000000"
                        onChange={(e) => onUpdateSegmentOverlay(idx, {
                          textShadow: `0 4px 15px ${e.target.value}`,
                        })}
                        className="h-8 w-8 bg-transparent rounded cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="space-y-1 col-span-2">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Animation</label>
                    <select
                      value={s.overlayConfig?.animation ?? 'fade'}
                      onChange={(e) => onUpdateSegmentOverlay(idx, { animation: e.target.value })}
                      className="w-full bg-[#050505] border border-[#282828] px-2 py-1.5 rounded-lg text-[10px] uppercase font-bold"
                    >
                      {TEXT_ANIMATIONS.map(a => (
                        <option key={a} value={a}>{a.replace(/-/g, ' ')}</option>
                      ))}
                    </select>
                  </div>

                </div>
              </div>
            )}

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

            {/* Mute toggle — hidden for heading segments (no embedded audio) */}
            {!s.isHeading && (
              <div className="flex items-center pt-1 pb-1">
                <button
                  onClick={() => onUpdateSegment(idx, { isMuted: !s.isMuted })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[8px] uppercase font-black tracking-widest transition-all ${
                    s.isMuted
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : 'bg-green-500/10 text-green-400 border border-green-500/20'
                  }`}
                >
                  <Music size={10} className={s.isMuted ? 'opacity-40' : ''} />
                  {s.isMuted ? 'Muted' : 'Audio On'}
                </button>
              </div>
            )}

          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
