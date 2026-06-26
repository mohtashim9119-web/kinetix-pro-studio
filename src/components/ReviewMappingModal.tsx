/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { X, Film, Video, AlertCircle, Image as ImageIcon, Maximize2, Ban } from 'lucide-react';
import { VideoSegment, Asset, HeadingConfig } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { FONT_FAMILIES, TEXT_ANIMATIONS } from '../constants';

interface ReviewMappingModalProps {
  segments: VideoSegment[];
  assets: Asset[];
  globalOverlayConfig: NonNullable<VideoSegment['overlayConfig']>;
  hideAllText: boolean;
  onClose: () => void;
  onUpdateSegment: (idx: number, updates: Partial<VideoSegment>) => void;
  onUpdateSegmentOverlay: (idx: number, updates: Partial<NonNullable<VideoSegment['overlayConfig']>>) => void;
  onOpenStockSearch: (segmentId: string) => void;
}

// Both PreviewStage (heading auto-fit) and frameRenderer (scene overlay export, see
// `h / 1080` in frameRenderer.ts) treat font sizes as calibrated against a 1080-tall
// reference frame. The thumbnail is far smaller than that, so explicit (non-auto-fit)
// font sizes are scaled by measuredThumbnailHeight / REFERENCE_PREVIEW_HEIGHT to stay
// proportionally correct instead of rendering at full literal px.
const REFERENCE_PREVIEW_HEIGHT = 1080;

// Measures the live rendered height of a thumbnail box so overlay/heading text can be
// scaled proportionally to it, mirroring how PreviewStage measures its own container.
function useThumbnailHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, height };
}

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

// ---------------------------------------------------------------------------
// Shared control styling — single source of truth so nothing drifts.
// Every control: 32px tall, 7px radius, 1px #3a3a3a border, #2a2a2a bg, one
// orange (#e07c3a) for focus + active. px-[9px] on text controls.
// ---------------------------------------------------------------------------
const FIELD = 'h-[32px] bg-[#2a2a2a] border border-[#3a3a3a] rounded-[7px] px-[9px] text-[12px] outline-none focus:border-[#e07c3a]';
const SELECT = `${FIELD} text-[#e0e0e0] cursor-pointer`;
const NUMBER = 'h-[32px] bg-[#2a2a2a] border border-[#3a3a3a] rounded-[7px] px-1 text-center text-[12px] text-white outline-none focus:border-[#e07c3a] disabled:opacity-40';
const BTN_BASE = 'h-[32px] flex items-center justify-center rounded-[7px] border transition-colors';
const ICON_BTN = `${BTN_BASE} w-[32px] flex-shrink-0`;
const ICON_IDLE = 'bg-[#2a2a2a] border-[#3a3a3a] text-[#aaa] hover:text-white hover:border-white/40';
const TOGGLE_ON = 'bg-[#e07c3a] border-[#e07c3a] text-white';
const TOGGLE_OFF = 'bg-transparent border-[#3a3a3a] text-[#aaa] hover:text-white hover:border-white/40';
const SWATCH = 'rm-swatch w-[32px] h-[32px] flex-shrink-0 rounded-[7px] border border-[#3a3a3a] bg-[#2a2a2a] cursor-pointer';

export function ReviewMappingModal({
  segments,
  assets,
  globalOverlayConfig,
  hideAllText,
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
          .rm-swatch { padding: 2px; }
          .rm-swatch::-webkit-color-swatch-wrapper { padding: 0; }
          .rm-swatch::-webkit-color-swatch { border: none; border-radius: 5px; }
          .rm-swatch::-moz-color-swatch { border: none; border-radius: 5px; }
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
              hideAllText={hideAllText}
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
// always visible (no formatting toggle). Both card types share a 35%
// thumbnail + 65% controls column with four rows: text + visibility,
// asset/stock (50/50), formatting (font/weight/italic/size + animation,
// or font/weight/size + autofit for heading — heading has no italic yet),
// and colors/no-bg + X/Y position.
// ---------------------------------------------------------------------------

interface ReviewMappingRowProps {
  segment: VideoSegment;
  index: number;
  assets: Asset[];
  globalOverlayConfig: NonNullable<VideoSegment['overlayConfig']>;
  hideAllText: boolean;
  onUpdateSegment: (idx: number, updates: Partial<VideoSegment>) => void;
  onUpdateSegmentOverlay: (idx: number, updates: Partial<NonNullable<VideoSegment['overlayConfig']>>) => void;
  onOpenStockSearch: (segmentId: string) => void;
}

function ReviewMappingRow({
  segment: seg,
  index: idx,
  assets,
  globalOverlayConfig,
  hideAllText,
  onUpdateSegment,
  onUpdateSegmentOverlay,
  onOpenStockSearch,
}: ReviewMappingRowProps) {
  const { ref: thumbRef, height: thumbHeight } = useThumbnailHeight();
  const scale = thumbHeight / REFERENCE_PREVIEW_HEIGHT;

  const asset = assets.find(a => a.id === seg.assetId);
  const isMissing = !asset && !!(seg.text || seg.heading || seg.isHeading);
  const label = seg.headingConfig?.text || seg.heading || asset?.name || `Scene ${idx + 1}`;
  const meta = `${seg.duration.toFixed(1)}s · ${formatTime(seg.startTime)} — ${formatTime(seg.startTime + seg.duration)}`;

  const hc = seg.headingConfig;
  const isAutoFit = !hc?.fontSize;

  // Live thumbnail overlay math — mirrors PreviewStage's heading font-size formula
  // (a pure fraction of container height, so it's already proportional) and scales
  // explicit font sizes by `scale` so they look right at thumbnail size (see
  // REFERENCE_PREVIEW_HEIGHT above). X/Y need no scaling: percentage + translate(-x%,-y%)
  // already resolves against this thumbnail's own box, same as PreviewStage's container.
  const headingText = hc?.text ?? seg.heading ?? '';
  const headingPosX = hc?.x ?? 50;
  const headingPosY = hc?.y ?? 50;
  const headingAutoFitSize = (() => {
    const baseSize = thumbHeight * 0.14;
    const shrinkFactor = Math.max(0.3, 1 - headingText.length / 80);
    return Math.max(thumbHeight * 0.04, Math.min(thumbHeight * 0.14, baseSize * shrinkFactor));
  })();
  const headingFontSizePx = thumbHeight === 0
    ? 0
    : (hc?.fontSize ? hc.fontSize * scale : headingAutoFitSize);

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
  const isBgNone = oc?.backgroundColor === 'transparent';
  const overlayPosX = oc?.x ?? 50;
  const overlayPosY = oc?.y ?? 78;
  const overlayFontSizePx = (oc?.fontSize ?? 24) * scale;
  // Base px values mirror PreviewStage's bubble classes (px-5 py-3 rounded-3xl == 20/12/24px).
  const bubblePadX = 20 * scale;
  const bubblePadY = 12 * scale;
  const bubbleRadius = 24 * scale;

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
        {/* Thumbnail — left 35%. Background asset/color + a live overlay/heading text
            layer scaled proportionally to this box (see useThumbnailHeight above). */}
        <div className="w-[35%] flex-shrink-0 border-r border-[#1f1f1f] flex items-center">
          <div
            ref={thumbRef}
            className={`relative w-full aspect-video overflow-hidden flex items-center justify-center ${
              seg.isHeading ? '' : 'bg-[#0D0D0D]'
            }`}
            style={seg.isHeading ? { backgroundColor: hc?.backgroundColor ?? '#000000' } : undefined}
          >
            {seg.isHeading ? (
              asset?.url && asset.type === 'image' ? (
                <img src={asset.url} className="w-full h-full object-cover" alt="" />
              ) : asset?.type === 'video' ? (
                <Video size={22} className="text-blue-400" />
              ) : null
            ) : asset?.url && asset.type === 'image' ? (
              <img src={asset.url} className="w-full h-full object-cover" alt="" />
            ) : asset?.type === 'video' ? (
              <Video size={22} className="text-blue-400" />
            ) : isMissing ? (
              <AlertCircle size={22} className="text-yellow-500" />
            ) : (
              <ImageIcon size={22} className="text-[#555555]" />
            )}

            {seg.isHeading && headingText && (
              <div
                className="absolute text-center pointer-events-none"
                style={{
                  left: `${headingPosX}%`,
                  top: `${headingPosY}%`,
                  transform: `translate(-${headingPosX}%, -${headingPosY}%)`,
                  width: 'max-content',
                  maxWidth: '90%',
                  zIndex: 1,
                  fontSize: `${headingFontSizePx}px`,
                  fontFamily: hc?.fontFamily || globalOverlayConfig.fontFamily,
                  fontWeight: hc?.fontWeight ?? 'bold',
                  color: hc?.color ?? '#ffffff',
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 6,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {headingText}
              </div>
            )}

            {!seg.isHeading && seg.text && (!hideAllText || seg.showOverlay) && (
              <div
                className="absolute text-center pointer-events-none"
                style={{
                  left: `${overlayPosX}%`,
                  top: `${overlayPosY}%`,
                  transform: `translate(-${overlayPosX}%, -${overlayPosY}%)`,
                  width: 'max-content',
                  maxWidth: '90%',
                  zIndex: 1,
                  backgroundColor: oc?.backgroundColor || globalOverlayConfig.backgroundColor,
                  padding: `${bubblePadY}px ${bubblePadX}px`,
                  borderRadius: `${bubbleRadius}px`,
                }}
              >
                <span
                  style={{
                    fontFamily: oc?.fontFamily || globalOverlayConfig.fontFamily,
                    color: oc?.color || globalOverlayConfig.color,
                    fontSize: `${overlayFontSizePx}px`,
                    fontWeight: oc?.fontWeight || 'normal',
                    fontStyle: oc?.fontStyle || 'italic',
                    lineHeight: 1.3,
                  }}
                >
                  {seg.text}
                </span>
              </div>
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

              {/* Row 2 — background asset (50%) + stock search (50%) */}
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
                  className={`${BTN_BASE} ${ICON_IDLE} gap-[5px] text-[12px] flex-1 min-w-0`}
                >
                  <Film size={14} /> <span className="truncate">Stock</span>
                </button>
              </div>

              {/* Row 3 — font + weight + size + autofit */}
              <div className="flex items-center gap-[7px]">
                <select
                  value={hc?.fontFamily ?? 'Inter'}
                  onChange={(e) => updateHC({ fontFamily: e.target.value })}
                  aria-label="Heading font family"
                  className={`${SELECT} flex-[4] min-w-0`}
                >
                  {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select
                  value={String(hc?.fontWeight ?? 'bold')}
                  onChange={(e) => updateHC({ fontWeight: e.target.value })}
                  aria-label="Heading font weight"
                  className={`${SELECT} flex-[3] min-w-0`}
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
                  className={`${NUMBER} flex-[3] min-w-0`}
                />
                <button
                  type="button"
                  onClick={() => updateHC({ fontSize: hc?.fontSize ? undefined : 100 })}
                  title="Auto fit"
                  aria-pressed={isAutoFit}
                  aria-label="Toggle auto-fit font size"
                  className={`${BTN_BASE} flex-[3] min-w-0 ${isAutoFit ? TOGGLE_ON : TOGGLE_OFF}`}
                >
                  <Maximize2 size={14} />
                </button>
              </div>

              {/* Row 4 — colors (inline) + X/Y position */}
              <div className="flex items-center gap-[7px]">
                <input
                  type="color"
                  value={hc?.color ?? '#ffffff'}
                  onChange={(e) => updateHC({ color: e.target.value })}
                  title="Text color"
                  aria-label="Heading text color"
                  className={SWATCH}
                />
                <input
                  type="color"
                  value={hc?.backgroundColor ?? '#000000'}
                  onChange={(e) => updateHC({ backgroundColor: e.target.value })}
                  title="BG color"
                  aria-label="Heading background color"
                  className={SWATCH}
                />

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
              {/* Row 1 — overlay text + visibility toggle switch */}
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
                  role="switch"
                  aria-checked={!!seg.showOverlay}
                  aria-label="Toggle overlay text visibility"
                  title={seg.showOverlay ? 'Overlay text shown' : 'Overlay text hidden'}
                  className={`relative w-10 h-[32px] flex-shrink-0 rounded-[7px] border transition-colors ${
                    seg.showOverlay ? 'bg-[#e07c3a] border-[#e07c3a]' : 'bg-[#2a2a2a] border-[#3a3a3a]'
                  }`}
                >
                  <span
                    className={`absolute top-1/2 -translate-y-1/2 w-[14px] h-6 rounded-[3px] bg-white transition-all ${
                      seg.showOverlay ? 'left-[22px]' : 'left-[4px]'
                    }`}
                  />
                </button>
              </div>

              {/* Row 2 — asset (50%) + stock search (50%) */}
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
                  className={`${BTN_BASE} ${ICON_IDLE} gap-[5px] text-[12px] flex-1 min-w-0`}
                >
                  <Film size={14} /> <span className="truncate">Stock</span>
                </button>
              </div>

              {/* Row 3 — font + weight + italic + size + animation */}
              <div className="flex items-center gap-[7px]">
                <select
                  value={oc?.fontFamily ?? globalOverlayConfig.fontFamily}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { fontFamily: e.target.value })}
                  aria-label="Overlay font family"
                  className={`${SELECT} flex-[4] min-w-0`}
                >
                  {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select
                  value={String(oc?.fontWeight ?? 'bold')}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { fontWeight: e.target.value })}
                  aria-label="Overlay font weight"
                  className={`${SELECT} flex-[3] min-w-0`}
                >
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                  <option value="900">Black</option>
                </select>
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
                <input
                  type="number"
                  min={8}
                  max={400}
                  value={oc?.fontSize ?? 60}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { fontSize: Number(e.target.value) || 60 })}
                  aria-label="Overlay font size"
                  className={`${NUMBER} flex-[3] min-w-0`}
                />
                <select
                  value={oc?.animation ?? 'fade'}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { animation: e.target.value })}
                  aria-label="Overlay text animation"
                  className={`${SELECT} flex-[3] min-w-0`}
                >
                  {TEXT_ANIMATIONS.map(a => (
                    <option key={a} value={a}>{a.replace(/-/g, ' ')}</option>
                  ))}
                </select>
              </div>

              {/* Row 4 — colors + no-bg toggle + X/Y position */}
              <div className="flex items-center gap-[7px]">
                <input
                  type="color"
                  value={oc?.color ?? '#FFFFFF'}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { color: e.target.value })}
                  title="Text color"
                  aria-label="Overlay text color"
                  className={SWATCH}
                />
                <input
                  type="color"
                  value={isBgNone ? '#000000' : (oc?.backgroundColor ?? '#000000')}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { backgroundColor: e.target.value })}
                  title="BG color"
                  aria-label="Overlay background color"
                  className={`${SWATCH} ${isBgNone ? 'opacity-40' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => onUpdateSegmentOverlay(idx, { backgroundColor: isBgNone ? '#000000' : 'transparent' })}
                  title="No background"
                  aria-pressed={isBgNone}
                  aria-label="Toggle no background"
                  className={`${ICON_BTN} ${isBgNone ? TOGGLE_ON : TOGGLE_OFF}`}
                >
                  <Ban size={14} />
                </button>

                <span className="text-[#888888] text-[11px] font-medium flex-shrink-0">X</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={oc?.x ?? 50}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { x: Number(e.target.value) })}
                  aria-label="Overlay horizontal position"
                  className="rm-slider flex-1 min-w-0"
                />
                <span className="text-[#e07c3a] text-[10px] font-medium min-w-[28px] text-right flex-shrink-0">
                  {oc?.x ?? 50}%
                </span>

                <span className="text-[#888888] text-[11px] font-medium flex-shrink-0">Y</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={oc?.y ?? 78}
                  onChange={(e) => onUpdateSegmentOverlay(idx, { y: Number(e.target.value) })}
                  aria-label="Overlay vertical position"
                  className="rm-slider flex-1 min-w-0"
                />
                <span className="text-[#e07c3a] text-[10px] font-medium min-w-[28px] text-right flex-shrink-0">
                  {oc?.y ?? 78}%
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
