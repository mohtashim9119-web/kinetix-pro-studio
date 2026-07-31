/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import {
  drawWaveformRange,
  WaveformSource,
  WAVEFORM_DPR_CAP,
} from '../services/waveformPeaks';
import { computeWaveformTileSpecs } from '../services/timelineLayout';

/**
 * Tiled timeline waveform (replaces the earlier single-canvas approach, which
 * collapsed the ENTIRE voiceover into one canvas capped at ~16384px — on a
 * long voiceover at high zoom that meant many peak columns were averaged into
 * a single pixel, throwing away the extra density PEAKS_PER_SECOND provides.
 * Instead, the timeline width at the CURRENT zoom level is split into
 * multiple tiles, each drawn on its own ≤16384px canvas (drawWaveformRange,
 * services/waveformPeaks.ts), so every tile individually gets ~1 peak-column
 * per backing pixel — true 1:1 fidelity at any zoom level, not just short
 * voiceovers.
 *
 * Each tile is snapshotted to its own blob: URL. Timeline.tsx lays all tiles
 * out as CSS multi-background layers on a single shared waveform lane
 * (background-position offset by each tile's startTime), rather than the
 * old per-segment background-image slicing.
 *
 * Redraw is debounced (zoom-slider drags / +/- key bursts would otherwise
 * redraw many times a second) and re-runs whenever the peaks source or the
 * current zoom level changes.
 */

export interface WaveformTile {
  /** blob: URL of this tile's PNG snapshot. */
  url: string;
  /** Tile's start time within the full voiceover, in seconds. */
  startTime: number;
  /** Tile's end time within the full voiceover, in seconds. */
  endTime: number;
  /** Tile's CSS-pixel width at the zoom level it was drawn for. */
  width: number;
}

export interface TimelineWaveformResult {
  tiles: WaveformTile[];
  isReady: boolean;
}

/**
 * Hard browser cap on canvas dimensions (~16384px per side in WebKit/Blink).
 * Each tile's DEVICE-pixel (backing store) width must stay under this, so the
 * CSS-pixel budget per tile is this value divided by the resolved DPR.
 */
const MAX_CANVAS_WIDTH = 16384;

/**
 * Trailing debounce for tile rebuilds: +/- key presses and slider drags can
 * fire zoom changes many times a second, and each rebuild walks the full
 * peaks array + toBlob-encodes N tiles. Waiting this long after the LAST
 * change before redrawing keeps that cost off the hot path of a drag/keypress
 * burst.
 */
const REDRAW_DEBOUNCE_MS = 200;

function resolveDpr(): number {
  const raw =
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio
      : 1;
  return Math.min(Math.max(raw || 1, 1), WAVEFORM_DPR_CAP);
}

function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? URL.createObjectURL(blob) : null);
    }, 'image/png');
  });
}

function revokeTiles(tiles: WaveformTile[]): void {
  for (const t of tiles) URL.revokeObjectURL(t.url);
}

/**
 * @param waveformSource          built peaks, or null when there's no voiceover.
 * @param totalDuration           full timeline duration in seconds.
 * @param currentPixelsPerSecond  px/s at the CURRENT zoom level (Timeline's live
 *                                pixelsPerSecond, not the ppsMax ceiling) — tiles
 *                                are rebuilt (debounced) whenever this changes.
 * @returns { tiles, isReady }    ordered left-to-right, covering [0, totalDuration).
 */
export function useTimelineWaveform(
  waveformSource: WaveformSource | null,
  totalDuration: number,
  currentPixelsPerSecond: number,
): TimelineWaveformResult {
  const [state, setState] = useState<TimelineWaveformResult>({ tiles: [], isReady: false });
  const tilesRef = useRef<WaveformTile[]>([]);

  useEffect(() => {
    // No voiceover / nothing to draw → clear any prior tiles.
    if (!waveformSource || totalDuration <= 0 || currentPixelsPerSecond <= 0) {
      revokeTiles(tilesRef.current);
      tilesRef.current = [];
      setState({ tiles: [], isReady: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ tiles: prev.tiles, isReady: false }));

    const timer = setTimeout(() => {
      const dpr = resolveDpr();
      const specs = computeWaveformTileSpecs(
        totalDuration,
        currentPixelsPerSecond,
        dpr,
        MAX_CANVAS_WIDTH,
      );

      Promise.all(
        specs.map((spec) => {
          const canvas = document.createElement('canvas'); // detached — never appended
          drawWaveformRange(
            waveformSource,
            canvas,
            spec.canvasWidth,
            spec.canvasHeight,
            spec.tileStartTime,
            spec.tileEndTime,
          );
          return canvasToBlobUrl(canvas);
        }),
      ).then((urls) => {
        if (cancelled) {
          for (const u of urls) if (u) URL.revokeObjectURL(u);
          return;
        }
        revokeTiles(tilesRef.current);
        const newTiles: WaveformTile[] = [];
        for (let i = 0; i < specs.length; i++) {
          const url = urls[i];
          if (!url) continue;
          const spec = specs[i]!;
          newTiles.push({
            url,
            startTime: spec.tileStartTime,
            endTime: spec.tileEndTime,
            width: spec.tileWidthCss,
          });
        }
        tilesRef.current = newTiles;
        setState({ tiles: newTiles, isReady: true });
      });
    }, REDRAW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [waveformSource, totalDuration, currentPixelsPerSecond]);

  // Revoke the last displayed tile URLs on unmount.
  useEffect(
    () => () => {
      revokeTiles(tilesRef.current);
      tilesRef.current = [];
    },
    [],
  );

  return state;
}
