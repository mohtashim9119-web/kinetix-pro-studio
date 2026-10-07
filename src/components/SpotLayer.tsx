/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Layer 2 preview rectangle — a DOM sibling layer of the stage (the caption
 * pattern), deliberately NOT the WebCodecs decoder pool: clips are a plain muted
 * <video>, stills a plain <img>. The stage's master <audio> time is the ONLY
 * clock (`currentTime`); the element is seeked on enter / on drift / on scrub
 * and paused outside its window (unmounted when no spot is active). Sizing uses
 * container-query units on an inset-0 wrapper, so it tracks the frame in
 * windowed and fullscreen alike. See `spotPreviewMath` for the layout contract
 * shared with export.
 */

import { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import type { Asset } from '../types';
import {
  SPOT_BORDER_PCT,
  SPOT_Z_INDEX,
  activeSpotAt,
  computeSpotSync,
  type PreviewSpotItem,
} from '../services/spots/spotPreviewMath';
import { moveRect, rectToCss, resizeRect, type PctRect, type ResizeHandle } from '../services/spots/spotGeometry';

export interface SpotLayerProps {
  items: readonly PreviewSpotItem[];
  assets: readonly Asset[];
  /** The master audio clock (seconds). */
  currentTime: number;
  isPlaying: boolean;
  /** Editing: present => the box is draggable (move) and has 8 resize handles. */
  onCommitRect?: (spotId: string, rect: PctRect, individual: boolean) => void;
  /** Called continuously while dragging (and with null on release) so the panel's
   *  geometry row updates in realtime. */
  onLiveRect?: (spotId: string, rect: PctRect | null, individual: boolean) => void;
  /** The rect currently being dragged (display override). scope 'project' = the
   *  per-project default is being dragged: every non-custom block follows. */
  liveRect?: { id: string; rect: PctRect; scope: 'project' | 'block' } | null;
  onSelect?: (spotId: string) => void;
  selectedSpotId?: string | null;
}

/** Invisible hit zones (no visible dots): thin edge strips + corner squares. */
const HANDLES: { h: ResizeHandle; style: React.CSSProperties; cursor: string }[] = [
  { h: 'nw', style: { left: 0, top: 0, width: 12, height: 12 }, cursor: 'nwse-resize' },
  { h: 'ne', style: { right: 0, top: 0, width: 12, height: 12 }, cursor: 'nesw-resize' },
  { h: 'se', style: { right: 0, bottom: 0, width: 12, height: 12 }, cursor: 'nwse-resize' },
  { h: 'sw', style: { left: 0, bottom: 0, width: 12, height: 12 }, cursor: 'nesw-resize' },
  { h: 'n', style: { left: 12, right: 12, top: 0, height: 6 }, cursor: 'ns-resize' },
  { h: 's', style: { left: 12, right: 12, bottom: 0, height: 6 }, cursor: 'ns-resize' },
  { h: 'e', style: { top: 12, bottom: 12, right: 0, width: 6 }, cursor: 'ew-resize' },
  { h: 'w', style: { top: 12, bottom: 12, left: 0, width: 6 }, cursor: 'ew-resize' },
];

function SpotVideo({ item, asset, currentTime, isPlaying }: {
  item: PreviewSpotItem; asset: Asset; currentTime: number; isPlaying: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.readyState < 1) return;
    const { seekTo, shouldPlay } = computeSpotSync({
      t: currentTime, item, clipDuration: asset.duration, elTime: el.currentTime, isPlaying,
    });
    if (seekTo !== undefined) el.currentTime = seekTo;
    if (shouldPlay && el.paused) void el.play().catch(() => {});
    else if (!shouldPlay && !el.paused) el.pause();
  }, [currentTime, isPlaying, item, asset.duration]);
  return (
    <video
      ref={ref}
      src={asset.url}
      muted
      playsInline
      preload="auto"
      className="w-full h-full object-cover block"
      onLoadedMetadata={e => {
        const v = e.currentTarget;
        // Seek-on-enter: the sync effect above skipped while metadata was unavailable.
        const { seekTo } = computeSpotSync({ t: currentTime, item, clipDuration: asset.duration, elTime: v.currentTime, isPlaying });
        if (seekTo !== undefined) v.currentTime = seekTo;
        if (isPlaying) void v.play().catch(() => {});
      }}
    />
  );
}

export function SpotLayer({ items, assets, currentTime, isPlaying, onCommitRect, onLiveRect, liveRect, onSelect, selectedSpotId }: SpotLayerProps) {
  const active = activeSpotAt(items, currentTime);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: 'move' | ResizeHandle; startX: number; startY: number; start: PctRect; last: PctRect; w: number; h: number; individual: boolean } | null>(null);
  if (!active) return null;
  const asset = active.assetId ? assets.find(a => a.id === active.assetId) : undefined;
  const usable = asset && asset.url && !asset.unresolved && (asset.type === 'video' || asset.type === 'image') ? asset : undefined;
  const editable = !!onCommitRect;
  const rect =
    liveRect && (liveRect.id === active.id || (liveRect.scope === 'project' && !active.custom))
      ? liveRect.rect
      : active.rect;

  const begin = (e: React.PointerEvent, mode: 'move' | ResizeHandle) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, start: rect, last: rect, w: box.width, h: box.height, individual: e.altKey };
    onSelect?.(active.id);
  };
  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = ((e.clientX - d.startX) / d.w) * 100;
    const dy = ((e.clientY - d.startY) / d.h) * 100;
    d.last = d.mode === 'move' ? moveRect(d.start, dx, dy) : resizeRect(d.start, d.mode, dx, dy, d.w / d.h);
    onLiveRect?.(active.id, d.last, d.individual);
  };
  const end = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    onLiveRect?.(active.id, null, d.individual);
    if (d.last !== d.start) onCommitRect?.(active.id, d.last, d.individual);
  };

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 pointer-events-none select-none"
      style={{ zIndex: SPOT_Z_INDEX, containerType: 'size' }}
      data-testid="spot-layer"
    >
      {/* The white border is the box's OUTER edge (padding on a white box), so a box
          pushed to the frame edge keeps its whole border on screen. Export insets its
          media by the same thickness. */}
      <div
        className={`absolute${editable ? ' cursor-move' : ''}`}
        style={{
          ...rectToCss(rect),
          backgroundColor: '#fff',
          padding: `${SPOT_BORDER_PCT}cqh`,
          boxSizing: 'border-box',
          pointerEvents: editable ? 'auto' : 'none',
          touchAction: 'none',
        }}
        onPointerDown={editable ? e => begin(e, 'move') : undefined}
        onPointerMove={editable ? move : undefined}
        onPointerUp={editable ? end : undefined}
        onPointerCancel={editable ? end : undefined}
      >
        <div className="relative w-full h-full overflow-hidden bg-black">
          {usable?.type === 'video' && (
            <SpotVideo key={active.id} item={active} asset={usable} currentTime={currentTime} isPlaying={isPlaying} />
          )}
          {usable?.type === 'image' && <img src={usable.url} alt="" className="w-full h-full object-cover block" draggable={false} />}
          {!usable && (
            <div className="kx-art-empty flex-col gap-1">
              <AlertCircle size={16} className="opacity-70" />
              <span className="text-[10px] font-semibold tracking-wide">NO CLIP</span>
            </div>
          )}
        </div>
        {editable &&
          HANDLES.map(({ h, style, cursor }) => (
            <div
              key={h}
              data-spot-handle={h}
              className="absolute"
              style={{ ...style, cursor }}
              onPointerDown={e => begin(e, h)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
          ))}
      </div>
    </div>
  );
}
