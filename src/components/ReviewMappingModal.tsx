/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { X, Film, Eye, Video, AlertCircle, Image as ImageIcon, Maximize2 } from 'lucide-react';
import { VideoSegment, Asset, HeadingConfig } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { FONT_FAMILIES, TEXT_ANIMATIONS } from '../constants';

interface ReviewMappingModalProps {
  segments: VideoSegment[];
  assets: Asset[];
  globalOverlayConfig: NonNullable<VideoSegment['overlayConfig']>;
  onClose: () => void;
  onUpdateSegment: (idx: number, updates: Partial<VideoSegment>) => void;
  onUpdateSegmentOverlay: (idx: number, updates: Partial<NonNullable<VideoSegment['overlayConfig']>>) => void;
  onOpenStockSearch: (segmentId: string) => void;
}

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

// Pull a #rrggbb out of a CSS text-shadow string for the swatch display.
// Falls back to black for empty / rgba()-style shadows (input[type=color] needs hex).
const extractShadowHex = (shadow: string | undefined): string => {
  const m = shadow?.match(/#[0-9a-fA-F]{6}/);
  return m?.[0] ?? '#000000';
};

// ---------------------------------------------------------------------------
// Shared control styling — single source of truth so nothing drifts.
// Every control: 32px tall, 7px radius, 1px #3a3a3a border, #2a2a2a bg, one
// orange (#e07c3a) for focus + active. px-[9px] on text controls.
// ---------------------------------------------------------------------------
const FIELD = 'h-[32px] bg-[#2a2a2a] border border-[#3a3a3a] rounded-[7px] px-[9px] text-[12px] outline-none focus:border-[#e07c3a]';
const SELECT = `${FIELD} text-[#e0e0e0] cursor-pointer`;
const NUMBER = 'h-[32px] w-[46px] flex-shrink-0 bg-[#2a2a2a] border border-[#3a3a3a] rounded-[7px] px-1 text-center text-[12px] text-white outline-none focus:border-[#e07c3a] disabled:opacity-40';
const ICON_BTN = 'w-[32px] h-[32px] flex-shrink-0 flex items-center justify-center rounded-[7px] border transition-colors';
const ICON_IDLE = 'bg-[#2a2a2a] border-[#3a3a3a] text-[#aaa] hover:text-white hover:border-white/40';
const TOGGLE_ON = 'bg-[#e07c3a] border-[#e07c3a] text-white';
const TOGGLE_OFF = 'bg-transparent border-[#3a3a3a] text-[#aaa] hover:text-white hover:border-white/40';

export function ReviewMappingModal({
  segments,
  assets,
  globalOverlayConfig,
  onClose,
  onUpdateSegment,
  onUpdateSegmentOverlay,
  onOpenStockSearch,
}: ReviewMappingModalProps) {
  const trapRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const nonAudioAssets = assets.filter(a => a.type !== 'audio');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Review Mapping"
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
        className="w-[60vw] max-h-[78vh] bg-[#181818] border border-[#2a2a2a] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        <style>{`
          .rm-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 2px; outline: none; cursor: pointer; background: #e07c3a; }
          .rm-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%; background: #fff; cursor: pointer; border: 2px solid #e07c3a; margin-top: -4.5px; }
          .rm-slider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: #e07c3a; }
          .rm-slider::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; background: #fff; cursor: pointer; border: 2px solid #e07c3a; }
          .rm-slider::-moz-range-track { height: 4px; border-radius: 2px; background: #e07c3a; }
        `}</style>

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-[#2a2a2a] flex-shrink-0">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.09em] text-white">Review Mapping</h2>
          <button
            onClick={onClose}
            aria-label="Close review mapping"
            className={`${ICON_BTN} ${ICON_IDLE}`}
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-3">
          {segments.length === 0 && (
            <p className="text-[11px] text-[#6a6a6a] italic px-1 py-6">
              No segments yet — apply sync to generate.
            </p>
          )}
          {segments.map((seg, i) => (
            <ReviewMappingRow
              key={seg.id}
              segment={seg}
              index={i}
              assets={nonAudioAssets}
              globalOverlayConfig={globalOverlayConfig}
              onUpdateSegment={onUpdateSegment}
              onUpdateSegmentOverlay={onUpdateSegmentOverlay}
              onOpenStockSearch={onOpenStockSearch}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewMappingRow — one segment's mapping review card. All controls are
// always visible (no formatting toggle). Scene cards expose asset + stock
// search, overlay text + visibility toggle, and overlay-text formatting
// (font/weight/size/animation, text + shadow color, italic). Heading cards
// expose heading text, background asset + stock search, heading-text
// formatting (font/weight/size/autofit), text + bg color, and X/Y position.
// ---------------------------------------------------------------------------

interface ReviewMappingRowProps {
  segment: VideoSegment;
  index: number;
  assets: Asset[];
  globalOverlayConfig: NonNullable<VideoSegment['overlayConfig']>;
  onUpdateSegment: (idx: number, updates: Partial<VideoSegment>) => void;
  onUpdateSegmentOverlay: (idx: number, updates: Partial<NonNullable<VideoSegment['overlayConfig']>>) => void;
  onOpenStockSearch: (segmentId: string) => void;
}

function ReviewMappingRow({
  segment: seg,
  index: idx,
  assets,
  globalOverlayConfig,
  onUpdateSegment,
  onUpdateSegmentOverlay,
  onOpenStockSearch,
}: ReviewMappingRowProps) {
  const textColorRef = useRef<HTMLInputElement>(null);
  const bgColorRef = useRef<HTMLInputElement>(null);
  const shadowColorRef = useRef<HTMLInputElement>(null);

  const asset = assets.find(a => a.id === seg.assetId);
  const isMissing = !asset && !!(seg.text || seg.heading || seg.isHeading);
  const label = seg.headingConfig?.text || seg.heading || asset?.name || `Scene ${idx + 1}`;
  const meta = `${seg.duration.toFixed(1)}s · ${formatTime(seg.startTime)} — ${formatTime(seg.startTime + seg.duration)}`;

  const hc = seg.headingConfig;
  const isAutoFit = !hc?.fontSize;

  // Mirrors BottomDrawer's updateHC: an `assetId` write must also land on the
  // segment's top-level assetId — that's the only field PreviewStage/export
  // actually read for a heading's background asset.
  const updateHC = (updates: Partial<HeadingConfig>) => {
    const next: Partial<VideoSegment> = {
      headingConfig: { ...(hc ?? { text: '' }), ...updates },
      ...('text' in updates ? { heading: String(updates.text ?? '') } : {}),
    };
    if ('assetId' in updates) next.assetId = updates.assetId;
    onUpdateSegment(idx, next);
  };

  // Scene overlay-text formatting state (falls back to global config / defaults).
  const oc = seg.overlayConfig;
  const isItalic = oc?.fontStyle === 'italic';
  const shadowHex = extractShadowHex(oc?.textShadow);

  return (
    <div
      className={`rounded-xl overflow-hidden bg-[#111111] border ${
        seg.isHeading ? 'border-[rgba(224,124,58,0.3)]' : 'border-[#2A2A2A]'
      }`}
    >
      {/* Card header */}
      <div className="h-[34px] px-[14px] border-b border-[#1f1f1f] flex items-center justify-between gap-2">
        {seg.isHeading ? (
          <div className="flex items-center gap-[7px] min-w-0 overflow-hidden">
            <span className="flex-shrink-0 bg-[#e07c3a] text-white text-[9px] font-bold px-[6px] py-[3px] rounded-[4px]">
              H
            </span>
            <span className="text-[12px] text-[#dcdcdc] truncate">{label}</span>
          </div>
        ) : (
          <span className="text-[12px] text-[#dcdcdc] truncate min-w-0">{label}</span>
        )}
        <span className="text-[11px] text-[#6a6a6a] whitespace-nowrap flex-shrink-0">{meta}</span>
      </div>

      {/* Body */}
      <div className="flex flex-row items-stretch">
        {/* Thumbnail — left 35% */}
        <div className="w-[35%] flex-shrink-0 border-r border-[#1f1f1f] flex items-center">
          <div
            className={`w-full aspect-video overflow-hidden flex items-center justify-center ${
              seg.isHeading ? 'bg-black' : 'bg-[#0D0D0D]'
            }`}
          >
            {seg.isHeading ? (
              <span className="text-white font-bold text-[15px] text-center px-1.5 break-words line-clamp-3">
                {label}
              </span>
            ) : asset?.url && asset.type === 'image' ? (
              <img src={asset.url} className="w-full h-full object-cover" alt="" />
            ) : asset?.type === 'video' ? (
              <Video size={22} className="text-blue-400" />
            ) : isMissing ? (
              <AlertCircle size={22} className="text-yellow-500" />
            ) : (
              <ImageIcon size={22} className="text-[#555555]" />
            )}
          </div>
        </div>

        {/* Controls — right 65% */}
        <div className="flex-1 min-w-0 px-[13px] py-[11px] flex flex-col gap-[7px] justify-center">
          {seg.isHeading ? (
            <>
              {/* Row 1 — heading text */}
              <input
                type="text"
                value={hc?.text ?? ''}
                onChange={(e) => updateHC({ text: e.target.value })}
                placeholder="Heading text"
                aria-label="Heading text"
                className={`${FIELD} text-white w-full`}
              />

              {/* Row 2 — background asset + stock search */}
              <div className="flex items-center gap-[7px]">
                <select
                  value={hc?.assetId ?? ''}
                  onChange={(e) => updateHC({ assetId: e.target.value || undefined })}
                  aria-label="Heading background asset"
                  className={`${SELECT} flex-1 min-w-0`}
                >
                  <option value="">None (solid color)</option>
                  {assets.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onOpenStockSearch(seg.id)}
                  title="Search stock footage"
                  aria-label="Search stock footage"
                  className={`${ICON_BTN} ${ICON_IDLE}`}
                >
                  <Film size={14} />
                </button>
              </div>

              {/* Row 3 — font + weight + size + autofit */}
              <div className="flex items-center gap-[7px]">
                <select
                  value={hc?.fontFamily ?? 'Inter'}
                  onChange={(e) => updateHC({ fontFamily: e.target.value })}
                  aria-label="Heading font family"
                  className={`${SELECT} flex-[2] min-w-0`}
                >
                  {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select
                  value={String(hc?.fontWeight ?? 'bold')}
                  onChange={(e) => updateHC({ fontWeight: e.target.value })}
                  aria-label="Heading font weight"
                  className={`${SELECT} flex-[1.3] min-w-0`}
                >
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                  <option value="900">Black</option>
                </select>
                <input
                  type="number"
                  min={8}
                  max={400}
                  disabled={isAutoFit}
                  value={hc?.fontSize ?? 100}
                  onChange={(e) => updateHC({ fontSize: Number(e.target.value) || undefined })}
                  aria-label="Heading font size"
                  className={NUMBER}
                />
                <button
                  type="button"
                  onClick={() => updateHC({ fontSize: hc?.fontSize ? undefined : 100 })}
                  title="Auto fit"
                  aria-pressed={isAutoFit}
                  aria-label="Toggle auto-fit font size"
                  className={`${ICON_BTN} ${isAutoFit ? TOGGLE_ON : TOGGLE_OFF}`}
                >
                  <Maximize2 size={14} />
                </button>
              </div>

              {/* Row 4 — colors + X/Y position */}
              <div className="flex items-center gap-[7px]">
                <div className="relative w-[32px] h-[32px] flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => textColorRef.current?.click()}
                    title="Text color"
                    aria-label="Heading text color"
                    style={{ background: hc?.color ?? '#ffffff' }}
                    className="w-full h-full rounded-[7px] border border-[#3a3a3a]"
                  />
                  <input
                    ref={textColorRef}
                    type="color"
                    value={hc?.color ?? '#ffffff'}
                    onChange={(e) => updateHC({ color: e.target.value })}
                    tabIndex={-1}
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
                  />
                </div>
                <div className="relative w-[32px] h-[32px] flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => bgColorRef.current?.click()}
                    title="BG color"
                    aria-label="Heading background color"
                    style={{ background: hc?.backgroundColor ?? '#000000' }}
                    className="w-full h-full rounded-[7px] border border-[#3a3a3a]"
                  />
                  <input
                    ref={bgColorRef}
                    type="color"
                    value={hc?.backgroundColor ?? '#000000'}
                    onChange={(e) => updateHC({ backgroundColor: e.target.value })}
                    tabIndex={-1}
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
                  />
                </div>

                <span className="text-[#888888] text-[11px] font-medium flex-shrink-0">X</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={hc?.x ?? 50}
                  onChange={(e) => updateHC({ x: Number(e.target.value) })}
                  aria-label="Heading horizontal position"
                  className="rm-slider flex-1 min-w-0"
                />
                <span className="text-[#e07c3a] text-[10px] font-medium min-w-[28px] text-right flex-shrink-0">
                  {hc?.x ?? 50}%
                </span>

                <span className="text-[#888888] text-[11px] font-medium flex-shrink-0">Y</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={hc?.y ?? 50}
                  onChange={(e) => updateHC({ y: Number(e.target.value) })}
                  aria-label="Heading vertical position"
                  className="rm-slider flex-1 min-w-0"
                />
                <span className="text-[#e07c3a] text-[10px] font-medium min-w-[28px] text-right flex-shrink-0">
                  {hc?.y ?? 50}%
                </span>
              </div>
            </>
          ) : (
            <>
              {/* Row 1 — asset + stock search */}
              <div className="flex items-center gap-[7px]">
                <select
                  value={seg.assetId ?? ''}
                  onChange={(e) => onUpdateSegment(idx, { assetId: e.target.value })}
                  aria-label="Scene asset"
                  className={`${SELECT} flex-1 min-w-0`}
                >
                  <option value="">No asset</option>
                  {assets.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onOpenStockSearch(seg.id)}
                  title="Search stock footage"
                  aria-label="Search stock footage"
                  className={`${ICON_BTN} ${ICON_IDLE}`}
                >
                  <Film size={14} />
                </button>
              </div>

              {/* Row 2 — overlay text + visibility toggle */}
              <div className="flex items-center gap-[7px]">
                <input
                  type="text"
                  value={seg.text}
                  onChange={(e) => onUpdateSegment(idx, { text: e.target.value })}
                  placeholder="Overlay text"
                  aria-label="Overlay text"
                  className={`${FIELD} text-white flex-1 min-w-0`}
                />
                <button
                  type="button"
                  onClick={() => onUpdateSegment(idx, { showOverlay: !seg.showOverlay })}
                  title={seg.showOverlay ? 'Overlay text shown' : 'Overlay text hidden'}
                  aria-pressed={!!seg.showOverlay}
                  aria-label="Toggle overlay text visibility"
                  className={`${ICON_BTN} ${seg.showOverlay ? TOGGLE_ON : TOGGLE_OFF}`}
                >
                  <Eye size={14} />
                </button>
              </div>

              {/* Row 3 — font + weight + size + animation */}
              <div className="flex items-center gap-[7px]">
                <select
                  value={oc?.fontFamily ?? globalOverlayConfig.fontFamily}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { fontFamily: e.target.value })}
                  aria-label="Overlay font family"
                  className={`${SELECT} flex-[2] min-w-0`}
                >
                  {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select
                  value={String(oc?.fontWeight ?? 'bold')}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { fontWeight: e.target.value })}
                  aria-label="Overlay font weight"
                  className={`${SELECT} flex-[1.3] min-w-0`}
                >
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                  <option value="900">Black</option>
                </select>
                <input
                  type="number"
                  min={8}
                  max={400}
                  value={oc?.fontSize ?? 60}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { fontSize: Number(e.target.value) || 60 })}
                  aria-label="Overlay font size"
                  className={NUMBER}
                />
                <select
                  value={oc?.animation ?? 'fade'}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { animation: e.target.value })}
                  aria-label="Overlay text animation"
                  className={`${SELECT} flex-[1.3] min-w-0`}
                >
                  {TEXT_ANIMATIONS.map(a => (
                    <option key={a} value={a}>{a.replace(/-/g, ' ')}</option>
                  ))}
                </select>
              </div>

              {/* Row 4 — text color + shadow color + italic */}
              <div className="flex items-center gap-[7px]">
                <div className="relative w-[32px] h-[32px] flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => textColorRef.current?.click()}
                    title="Text color"
                    aria-label="Overlay text color"
                    style={{ background: oc?.color ?? '#FFFFFF' }}
                    className="w-full h-full rounded-[7px] border border-[#3a3a3a]"
                  />
                  <input
                    ref={textColorRef}
                    type="color"
                    value={oc?.color ?? '#FFFFFF'}
                    onChange={(e) => onUpdateSegmentOverlay(idx, { color: e.target.value })}
                    tabIndex={-1}
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
                  />
                </div>
                <div className="relative w-[32px] h-[32px] flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => shadowColorRef.current?.click()}
                    title="Shadow color"
                    aria-label="Overlay text shadow color"
                    style={{ background: shadowHex }}
                    className="w-full h-full rounded-[7px] border border-[#3a3a3a]"
                  />
                  <input
                    ref={shadowColorRef}
                    type="color"
                    value={shadowHex}
                    onChange={(e) => onUpdateSegmentOverlay(idx, { textShadow: `0 4px 15px ${e.target.value}` })}
                    tabIndex={-1}
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onUpdateSegmentOverlay(idx, { fontStyle: isItalic ? 'normal' : 'italic' })}
                  title="Italic"
                  aria-pressed={isItalic}
                  aria-label="Toggle italic overlay text"
                  className={`${ICON_BTN} ${isItalic ? TOGGLE_ON : TOGGLE_OFF} font-serif italic text-[14px]`}
                >
                  I
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
