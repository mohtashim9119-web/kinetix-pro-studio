/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { X, Video, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { VideoSegment, Asset } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { SegmentControls } from './SegmentControls';

// Shared field/button/icon styling used by SegmentControls now lives in
// SegmentControls.tsx (single source of truth). This modal only keeps the
// thumbnail + card chrome.

interface ReviewMappingModalProps {
  segments: VideoSegment[];
  assets: Asset[];
  globalOverlayConfig: NonNullable<VideoSegment['overlayConfig']>;
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
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-[#2a2a2a] flex-shrink-0">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.09em] text-white">Review Mapping</h2>
          <button
            onClick={onClose}
            aria-label="Close review mapping"
            className="h-[32px] w-[32px] flex-shrink-0 flex items-center justify-center rounded-[7px] border transition-colors bg-[#2a2a2a] border-[#3a3a3a] text-[#aaa] hover:text-white hover:border-white/40"
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
              assets={assets}
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
  const { ref: thumbRef, height: thumbHeight } = useThumbnailHeight();
  const scale = thumbHeight / REFERENCE_PREVIEW_HEIGHT;

  const asset = assets.find(a => a.id === seg.assetId);
  const isMissing = !asset && !!(seg.text || seg.heading || seg.isHeading);
  const label = seg.headingConfig?.text || seg.heading || asset?.name || `Scene ${idx + 1}`;
  const meta = `${seg.duration.toFixed(1)}s · ${formatTime(seg.startTime)} — ${formatTime(seg.startTime + seg.duration)}`;

  const hc = seg.headingConfig;

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

  // Scene overlay-text thumbnail math (falls back to global config / defaults).
  const oc = seg.overlayConfig;
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

            {!seg.isHeading && seg.text && seg.showOverlay && (
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

        {/* Controls — right 65%. Shared with the bottom drawer. */}
        <SegmentControls
          segment={seg}
          index={idx}
          assets={assets}
          globalOverlayConfig={globalOverlayConfig}
          onUpdateSegment={onUpdateSegment}
          onUpdateSegmentOverlay={onUpdateSegmentOverlay}
          onOpenStockSearch={onOpenStockSearch}
        />
      </div>
    </div>
  );
}
