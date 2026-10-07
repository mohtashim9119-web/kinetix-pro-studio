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

import { useEffect, useRef, useState } from 'react';
import type { Asset } from '../types';
import {
  SPOT_BORDER_PCT,
  SPOT_Z_INDEX,
  activeSpotAt,
  computeSpotSync,
  spotBoxStyle,
  type PreviewSpotItem,
} from '../services/spots/spotPreviewMath';

export interface SpotLayerProps {
  items: readonly PreviewSpotItem[];
  assets: readonly Asset[];
  /** The master audio clock (seconds). */
  currentTime: number;
  isPlaying: boolean;
}

function SpotVideo({ item, asset, currentTime, isPlaying, onAspect }: {
  item: PreviewSpotItem; asset: Asset; currentTime: number; isPlaying: boolean; onAspect: (a: number) => void;
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
        if (v.videoWidth && v.videoHeight) onAspect(v.videoWidth / v.videoHeight);
        // Seek-on-enter: the sync effect above skipped while metadata was unavailable.
        const { seekTo } = computeSpotSync({ t: currentTime, item, clipDuration: asset.duration, elTime: v.currentTime, isPlaying });
        if (seekTo !== undefined) v.currentTime = seekTo;
        if (isPlaying) void v.play().catch(() => {});
      }}
    />
  );
}

export function SpotLayer({ items, assets, currentTime, isPlaying }: SpotLayerProps) {
  const active = activeSpotAt(items, currentTime);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  if (!active) return null;
  const asset = active.assetId ? assets.find(a => a.id === active.assetId) : undefined;
  const usable = asset && asset.url && !asset.unresolved && (asset.type === 'video' || asset.type === 'image') ? asset : undefined;
  const aspect = (usable && aspects[usable.id]) || 16 / 9;
  const setAspect = (a: number) => {
    if (usable && aspects[usable.id] !== a) setAspects(p => ({ ...p, [usable.id]: a }));
  };

  return (
    <div
      className="absolute inset-0 pointer-events-none select-none"
      style={{ zIndex: SPOT_Z_INDEX, containerType: 'size' }}
      data-testid="spot-layer"
    >
      <div
        className="absolute overflow-hidden bg-black"
        style={{
          ...spotBoxStyle(active.corner, active.heightPct, aspect),
          border: `${SPOT_BORDER_PCT}cqh solid rgba(255,255,255,0.9)`,
          boxSizing: 'border-box',
        }}
      >
        {usable?.type === 'video' && (
          <SpotVideo key={active.id} item={active} asset={usable} currentTime={currentTime} isPlaying={isPlaying} onAspect={setAspect} />
        )}
        {usable?.type === 'image' && (
          <img
            src={usable.url}
            alt=""
            className="w-full h-full object-cover block"
            onLoad={e => {
              const i = e.currentTarget;
              if (i.naturalWidth && i.naturalHeight) setAspect(i.naturalWidth / i.naturalHeight);
            }}
          />
        )}
        {!usable && (
          <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-yellow-400 text-[10px] font-semibold tracking-wide">
            NO CLIP
          </div>
        )}
      </div>
    </div>
  );
}
