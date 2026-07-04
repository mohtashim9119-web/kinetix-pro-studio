/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minimal canvas paint surface for the WebCodecs preview path (Phase 1+2
 * scope of docs/webcodecs-architecture-plan.md). Draws whatever VideoFrame
 * useWebCodecsPreview.ts hands it, fit via the same object-cover behavior
 * the legacy <video className="object-cover"> elements use.
 *
 * Overlays/filters/animations/captions integration is explicitly Phase 5 —
 * not built here. `style` is accepted only so the existing CSS-filter clip
 * effects (getClipEffectStyle in PreviewStage.tsx) can keep applying without
 * a canvas-native reimplementation yet.
 *
 * Phase 4+6 hardening (docs/webcodecs-architecture-plan.md): a `frame` prop
 * value handed to this component is not guaranteed to still be open by the
 * time this effect actually runs. videoDecoderPool.ts's LRU eviction and
 * scrub-reset (Section 4) can close a session's `displayedFrame` — including
 * one already handed to a caller — the moment a newer request supersedes it,
 * and under load (found via manual 500-segment scrub-stress testing: heavy
 * background work, e.g. useFirstFrameCache.ts's per-segment decode warm-up,
 * plus this pool's own bookkeeping, can delay React's commit/effect cycle
 * relative to how fast frames are being superseded) that closure can land
 * before this effect's drawImage call runs, throwing
 * "Failed to execute 'drawImage' ... The VideoFrame has been closed" and
 * crashing the whole preview via ErrorBoundary. This is an inherent hazard
 * of any pool-managed VideoFrame crossing an async render boundary, not a
 * bug in one specific place to "fix at the source" — the standard, safe
 * handling is to treat a closed frame as "nothing to paint this tick" and
 * move on; the next tick's frame supersedes it moments later regardless.
 */

import { useEffect, useRef } from 'react';

interface Props {
  frame: VideoFrame | null;
  className?: string;
  style?: React.CSSProperties;
}

export function PreviewCanvas({ frame, className, style }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const displayW = canvas.clientWidth || canvas.width;
    const displayH = canvas.clientHeight || canvas.height;
    if (displayW === 0 || displayH === 0) return;
    if (canvas.width !== displayW || canvas.height !== displayH) {
      canvas.width = displayW;
      canvas.height = displayH;
    }

    if (!frame) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    try {
      const frameW = frame.displayWidth;
      const frameH = frame.displayHeight;
      if (!frameW || !frameH) return; // a closed frame reads back as 0x0 on some engines — nothing to paint

      const canvasRatio = canvas.width / canvas.height;
      const frameRatio = frameW / frameH;

      // object-cover: scale to fill the canvas, cropping whichever source
      // dimension overflows — mirrors the legacy <video>'s CSS object-cover.
      let sx = 0;
      let sy = 0;
      let sw = frameW;
      let sh = frameH;
      if (frameRatio > canvasRatio) {
        sw = frameH * canvasRatio;
        sx = (frameW - sw) / 2;
      } else {
        sh = frameW / canvasRatio;
        sy = (frameH - sh) / 2;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    } catch {
      // The frame was closed (by pool eviction/scrub-reset) between being
      // handed to this component and this effect actually running — see the
      // file header. Skip this tick's paint rather than crash; the next
      // frame supersedes it almost immediately regardless.
    }
  }, [frame]);

  return <canvas ref={canvasRef} className={className} style={style} />;
}
