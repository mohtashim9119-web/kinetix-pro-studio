/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import {
  drawFullWaveform,
  WaveformSource,
  LANE_HEIGHT_PX,
  WAVEFORM_DPR_CAP,
} from '../services/waveformPeaks';

/**
 * Single-canvas timeline waveform (replaces the per-segment SegmentWaveform
 * fan-out — docs/history.md). The ENTIRE voiceover is drawn ONCE to one wide
 * off-screen canvas at max-zoom resolution, snapshotted to a blob: URL, and
 * displayed by Timeline.tsx as a CSS background-image sliced per segment. Zoom
 * changes only re-scale that background via background-size — no redraw — so
 * quality is preserved down-zoom (image is downscaled) and 1:1 at max zoom.
 *
 * This replaces 294 per-segment canvases + IndexedDB image-cache lookups + 294
 * independent setState commits (the ~4s reload fan-out) with a single draw and
 * a single state commit.
 */

/**
 * Browser hard cap on canvas dimensions (~16384px per side in WebKit/Blink).
 * The max-zoom timeline can be far wider than this for a long voiceover; when
 * the target width exceeds the cap the bitmap is drawn narrower and CSS upscales
 * it at extreme zoom (an accepted trade-off — the peaks are 10/sec anyway).
 */
const MAX_CANVAS_WIDTH = 16384;

function resolveDpr(): number {
  const raw =
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio
      : 1;
  return Math.min(Math.max(raw || 1, 1), WAVEFORM_DPR_CAP);
}

/**
 * @param waveformSource      built peaks, or null when there's no voiceover.
 * @param totalDuration       full timeline duration in seconds.
 * @param maxPixelsPerSecond  px/s at max zoom (Timeline's ppsMax, = WAVEFORM_MAX_PPS).
 * @returns { waveformUrl }   blob: URL of the full-waveform image, or null.
 */
export function useTimelineWaveform(
  waveformSource: WaveformSource | null,
  totalDuration: number,
  maxPixelsPerSecond: number,
): { waveformUrl: string | null } {
  const [waveformUrl, setWaveformUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    // No voiceover / nothing to draw → clear any prior image.
    if (!waveformSource || totalDuration <= 0 || maxPixelsPerSecond <= 0) {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setWaveformUrl(null);
      return;
    }

    const dpr = resolveDpr();
    const cssMaxWidthPx = totalDuration * maxPixelsPerSecond;
    const canvasWidth = Math.min(
      MAX_CANVAS_WIDTH,
      Math.max(1, Math.round(cssMaxWidthPx * dpr)),
    );
    const canvasHeight = Math.max(1, Math.round(LANE_HEIGHT_PX * dpr));

    const canvas = document.createElement('canvas'); // detached — never appended
    drawFullWaveform(waveformSource, canvas, canvasWidth, canvasHeight);

    let cancelled = false;
    canvas.toBlob(
      (blob) => {
        if (cancelled || !blob) return;
        const url = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setWaveformUrl(url);
      },
      'image/png',
    );

    return () => {
      cancelled = true;
    };
  }, [waveformSource, totalDuration, maxPixelsPerSecond]);

  // Revoke the last displayed blob URL on unmount.
  useEffect(
    () => () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    },
    [],
  );

  return { waveformUrl };
}
