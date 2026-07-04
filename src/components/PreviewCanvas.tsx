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

    const frameW = frame.displayWidth;
    const frameH = frame.displayHeight;
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
  }, [frame]);

  return <canvas ref={canvasRef} className={className} style={style} />;
}
