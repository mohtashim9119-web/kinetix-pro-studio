/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minimal canvas paint surface for the WebCodecs preview path (Phase 1+2
 * scope of docs/webcodecs-architecture-plan.md). Draws whatever VideoFrame
 * useWebCodecsPreview.ts hands it, fit via the same object-contain behavior
 * the legacy <video className="object-contain"> elements use (media-fit
 * preview fix — the whole frame fits inside the canvas, letterboxed/
 * pillarboxed where its aspect ratio doesn't match; export's own cover-fill
 * pipeline, frameRenderer.ts's drawImageCover, is untouched).
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
 *
 * NOTE (WebGL2 Phase 5 cutover): the transition-overlay canvas this rationale
 * turns on no longer exists, and this component now only mounts on a runtime
 * with WebCodecs but no WebGL2 (PreviewStage's `!glPathActive` branch), where
 * no transition renders at all. The useLayoutEffect is KEPT regardless — it is
 * the strictly safer ordering for a draw that must land in its own commit, and
 * nothing here depends on the overlay being gone. The original reasoning is
 * preserved below as the historical record of why it is not a plain useEffect.
 *
 * Transition flash-back fix (S2 -> S1 -> S2 on cross-dissolve boundaries):
 * this draw must run as a `useLayoutEffect`, not `useEffect`. PreviewStage's
 * transition-overlay canvas (z-45, above this component) and this
 * component's own canvas both react to the SAME commit the moment
 * useWebCodecsPreview's `frameSegmentId` catches up to the new segment
 * (that's precisely what flips PreviewStage's `showTransitionOverlay` to
 * false, revealing this canvas underneath). `frame` and `frameSegmentId`
 * are set together in that same onSettled callback, so `frame` here is
 * already correct in that render — but a passive `useEffect` is only
 * guaranteed to run AFTER the browser paints the commit, while the
 * overlay's opacity style is applied synchronously as part of the same
 * commit's render. With `useEffect`, the browser could paint the overlay
 * already fading toward opacity 0 before this component's drawImage call
 * has replaced the canvas bitmap — revealing the PREVIOUS segment's last
 * painted frame for one paint (sometimes more, if the passive-effect flush
 * is delayed) before this effect finally runs and snaps the picture
 * forward to the real, current frame. `useLayoutEffect` runs synchronously
 * during the commit, before paint, so the bitmap is guaranteed current by
 * the time the overlay's opacity is actually painted — no timer, no extra
 * gating, just closing the one-paint ordering gap.
 */

import { useLayoutEffect, useRef } from 'react';

interface Props {
  frame: VideoFrame | null;
  className?: string;
  style?: React.CSSProperties;
  /** Backing-buffer dimensions (NOT the CSS display size) — the project's
   *  native resolution, derived via resolutionConfig.ts's resolveDimensions
   *  from (project.aspectRatio, project.resolutionTier). The canvas still
   *  fills its CSS box via `className`/`style` (w-full h-full); the browser
   *  scales this fixed-size backing buffer to fit, so the object-contain
   *  fit math below (canvasRatio vs frameRatio) always compares against the
   *  project's real aspect ratio rather than whatever size the panel happens
   *  to be measured at. */
  width: number;
  height: number;
  /** PreviewStage's fullscreen flag. The draw effect below is keyed only to
   *  `frame`, so a paused fullscreen toggle left the last-painted bitmap
   *  stretched to the old CSS box until the next frame arrived. Listing it
   *  here forces one extra re-run right when the stage resizes — the backing
   *  buffer itself no longer depends on the CSS box size, but a re-run still
   *  guarantees a fresh draw at the (unchanged) native resolution the moment
   *  fullscreen toggles. */
  isFullscreen?: boolean;
}

export function PreviewCanvas({ frame, className, style, width, height, isFullscreen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (width === 0 || height === 0) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    if (!frame) {
      // INTENTIONAL: do NOT clearRect here. `frame` goes null transiently
      // during decode-ahead catch-up on hard-cut (non-transition) segment
      // boundaries — see the file header's note on frameSegmentId lag —
      // because the new segment's decode session hasn't produced a buffered
      // frame yet (videoDecoderPool.ts getFrameAt: no session, closed, or
      // zero frames). Clearing would blank this canvas straight down to
      // bg-black for that gap. Retaining the last painted frame keeps the
      // outgoing segment's content on screen until a real frame supersedes
      // it — the branch below always clearRects immediately before its own
      // drawImage, so this stale content is replaced the instant that
      // happens. Mirrors PreviewStage.tsx's transition-overlay canvas
      // (identical rationale, identical "don't clear on nothing" pattern).
      return;
    }

    try {
      const frameW = frame.displayWidth;
      const frameH = frame.displayHeight;
      if (!frameW || !frameH) return; // a closed frame reads back as 0x0 on some engines — nothing to paint

      const canvasRatio = canvas.width / canvas.height;
      const frameRatio = frameW / frameH;

      // object-contain: scale the WHOLE source to fit inside the canvas,
      // letterboxing/pillarboxing whichever axis doesn't match — mirrors the
      // legacy <video>'s CSS object-contain. clearRect leaves the margin
      // transparent; the stage container behind this canvas is bg-black, so
      // the margin reads as black bars.
      let dx = 0;
      let dy = 0;
      let dw = canvas.width;
      let dh = canvas.height;
      if (frameRatio > canvasRatio) {
        dh = canvas.width / frameRatio;
        dy = (canvas.height - dh) / 2;
      } else {
        dw = canvas.height * frameRatio;
        dx = (canvas.width - dw) / 2;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(frame, 0, 0, frameW, frameH, dx, dy, dw, dh);
    } catch {
      // The frame was closed (by pool eviction/scrub-reset) between being
      // handed to this component and this effect actually running — see the
      // file header. Skip this tick's paint rather than crash; the next
      // frame supersedes it almost immediately regardless.
    }
  }, [frame, width, height, isFullscreen]);

  return <canvas ref={canvasRef} className={className} style={style} />;
}
