/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Film, Ban } from 'lucide-react';
import { VideoSegment, Asset, HeadingOverlay } from '../types';
import { FONT_FAMILIES, TEXT_ANIMATIONS } from '../constants';

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

const SLIDER_STYLE = `
  .rm-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 2px; outline: none; cursor: pointer; background: #e07c3a; }
  .rm-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%; background: #fff; cursor: pointer; border: 2px solid #e07c3a; margin-top: -4.5px; }
  .rm-slider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: #e07c3a; }
  .rm-slider::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; background: #fff; cursor: pointer; border: 2px solid #e07c3a; }
  .rm-slider::-moz-range-track { height: 4px; border-radius: 2px; background: #e07c3a; }
  .rm-swatch { padding: 2px; }
  .rm-swatch::-webkit-color-swatch-wrapper { padding: 0; }
  .rm-swatch::-webkit-color-swatch { border: none; border-radius: 5px; }
  .rm-swatch::-moz-color-swatch { border: none; border-radius: 5px; }
`;

interface SegmentControlsProps {
  /** Scene/content segment target — mutually exclusive with `heading`. */
  segment?: VideoSegment;
  index?: number;
  /** Path B (docs/history.md ("Path B — Separate Heading Layer — Design Decisions", archived), Phase 5) — top-level
   *  HeadingOverlay target, mutually exclusive with `segment`. Renders a
   *  dedicated editor reading/writing HeadingOverlay fields directly. */
  heading?: HeadingOverlay;
  /** Raw asset list — non-audio filtering happens internally here. */
  assets: Asset[];
  globalOverlayConfig: NonNullable<VideoSegment['overlayConfig']>;
  onUpdateSegment: (idx: number, updates: Partial<VideoSegment>) => void;
  onUpdateSegmentOverlay: (idx: number, updates: Partial<NonNullable<VideoSegment['overlayConfig']>>) => void;
  /** Required when `heading` is passed. */
  onUpdateHeading?: (updates: Partial<HeadingOverlay>) => void;
  onOpenStockSearch: (segmentId: string) => void;
}

/**
 * SegmentControls — the controls column shared by the Review Mapping card and
 * the bottom drawer. Renders the heading-overlay and scene-card layouts; the
 * thumbnail (and all its proportional-scaling math) lives only in the Review
 * Mapping row and is intentionally NOT part of this component.
 *
 * Rows per card:
 *   HeadingOverlay (Path B) — text · font/weight/size · colors + X/Y
 *   scene                   — text + visibility · asset/stock · font/weight/italic/size/animation · colors/no-bg + X/Y
 */
export function SegmentControls({
  segment,
  index,
  heading,
  assets,
  globalOverlayConfig,
  onUpdateSegment,
  onUpdateSegmentOverlay,
  onUpdateHeading,
  onOpenStockSearch,
}: SegmentControlsProps) {
  // One filter home — both parents pass raw assets.
  const visibleAssets = assets.filter(a => a.type !== 'audio');

  // Path B Phase 5 — HeadingOverlay target. Entirely separate render path.
  if (heading) {
    const h = heading;
    const update = (updates: Partial<HeadingOverlay>) => onUpdateHeading?.(updates);
    return (
      <>
        <style>{SLIDER_STYLE}</style>
        <div className="flex-1 min-w-0 px-[13px] py-[11px] flex flex-col gap-[7px] justify-center">
          {/* Row 1 — heading text */}
          <input
            type="text"
            value={h.text}
            onChange={(e) => update({ text: e.target.value })}
            placeholder="Heading text"
            aria-label="Heading text"
            className={`${FIELD} text-white w-full`}
          />

          {/* Row 2 — font + weight + size */}
          <div className="flex items-center gap-[7px]">
            <select
              value={h.fontFamily}
              onChange={(e) => update({ fontFamily: e.target.value })}
              aria-label="Heading font family"
              className={`${SELECT} flex-[4] min-w-0`}
            >
              {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <select
              value={String(h.fontWeight)}
              onChange={(e) => update({ fontWeight: e.target.value })}
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
              value={h.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) || h.fontSize })}
              aria-label="Heading font size"
              className={`${NUMBER} flex-[3] min-w-0`}
            />
          </div>

          {/* Row 3 — colors + X/Y position */}
          <div className="flex items-center gap-[7px]">
            <input
              type="color"
              value={h.color}
              onChange={(e) => update({ color: e.target.value })}
              title="Text color"
              aria-label="Heading text color"
              className={SWATCH}
            />
            <input
              type="color"
              value={h.backgroundColor}
              onChange={(e) => update({ backgroundColor: e.target.value })}
              title="BG color"
              aria-label="Heading background color"
              className={SWATCH}
            />

            <span className="text-[#888888] text-[11px] font-medium flex-shrink-0">X</span>
            <input
              type="range"
              min={0}
              max={100}
              value={h.x}
              onChange={(e) => update({ x: Number(e.target.value) })}
              aria-label="Heading horizontal position"
              className="rm-slider flex-1 min-w-0"
            />
            <span className="text-[#e07c3a] text-[10px] font-medium min-w-[28px] text-right flex-shrink-0">
              {h.x}%
            </span>

            <span className="text-[#888888] text-[11px] font-medium flex-shrink-0">Y</span>
            <input
              type="range"
              min={0}
              max={100}
              value={h.y}
              onChange={(e) => update({ y: Number(e.target.value) })}
              aria-label="Heading vertical position"
              className="rm-slider flex-1 min-w-0"
            />
            <span className="text-[#e07c3a] text-[10px] font-medium min-w-[28px] text-right flex-shrink-0">
              {h.y}%
            </span>
          </div>
        </div>
      </>
    );
  }

  if (!segment || index === undefined) return null;
  const seg = segment;
  const idx = index;

  // Scene overlay-text formatting state (falls back to global config / defaults).
  const oc = seg.overlayConfig;
  const isItalic = oc?.fontStyle === 'italic';
  const isBgNone = oc?.backgroundColor === 'transparent';

  return (
    <>
      <style>{SLIDER_STYLE}</style>

      <div className="flex-1 min-w-0 px-[13px] py-[11px] flex flex-col gap-[7px] justify-center">
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
                onChange={(e) => onUpdateSegment(idx, { assetId: e.target.value || undefined })}
                aria-label="Scene asset"
                className={`${SELECT} flex-1 min-w-0`}
              >
                <option value="">No asset</option>
                {visibleAssets.map(a => (
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
      </div>
    </>
  );
}
