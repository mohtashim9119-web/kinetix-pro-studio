/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useGlPreview — the thin WebGL2 preview driver (docs/webgl-architecture-plan.md
 * Section 3.2/6, Phase 3). Owns nothing about "what a frame should look like"
 * (that is compositeParams.ts's pure derivation) and nothing about GL resource
 * lifecycle math (that is glCompositor.ts / glContext.ts) — it only wires the
 * two together per playhead tick:
 *
 *   1. derive params + slot plan purely from (segments, currentTime, config),
 *   2. source each slot's content — the CURRENT/incoming frame from the
 *      already-running WebCodecs decode pool (via useWebCodecsPreview's exposed
 *      `frame`), the OUTGOING frame from that SAME pool via the Item-4 B1-B3
 *      protected-session + chase-mutex primitives (never a parallel pool),
 *   3. object-cover-fit each source onto a reused per-slot 2D canvas and upload
 *      it, then renderFrame once.
 *
 * Everything here is additive and dual-gated by the caller (PreviewStage.tsx):
 * `enabled` (isWebGL2Supported() && WebCodecs support && a dev-only toggle)
 * gates ALL work — when false this hook is inert even though it stays mounted.
 *
 * Purity / export-reuse (Section 4): the render is a pure function of
 * currentTime — deriveCompositeParams/deriveSlotPlan + toSourceTime derive
 * every transition/zoom/slot decision from (segments, currentTime, config)
 * alone, with NO retained transition state machine, NO wall clock, NO
 * hold/release. Pausing freezes it, seeking snaps it — the single stateless
 * `render(t)` that Section 1.3 prescribes as the structural cure for the
 * D10/D12/Bug1/Item-4 layer-sync bug class. The reusable pieces are the pure
 * functions and the compositor, not this React hook.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Asset, VideoSegment } from '../types';
import type { VideoDecoderPool } from '../services/videoDecoderPool';
import { GlCompositor, type TextureSlot } from '../services/gl/glCompositor';
import { acquireGlContext } from '../services/gl/glContext';
import {
  deriveCompositeParams,
  deriveSlotPlan,
  type ProjectEffectConfig,
} from '../services/gl/compositeParams';
// Read-only reuse of useWebCodecsPreview.ts's own pure primitives (that file
// is NOT modified) — the exact segment-local→source-time mapping the decode
// path already uses, and the "at most one getFrameAt in flight per session"
// chase mutex whose deadlock/starvation hazards were found and fixed there.
// Same import useTransitionPreview.ts already makes for the identical reason
// (do not rebuild a parallel, less-proven mechanism — the B3 lesson).
import {
  toSourceTime,
  startChaseIfIdle,
  resetChaseMutex,
  type ChaseMutex,
} from './useWebCodecsPreview';

interface UseGlPreviewParams {
  /** The GL canvas element PreviewStage.tsx mounts when the path is active. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  segments: VideoSegment[];
  assets: Asset[];
  /** From PreviewStage — already isResizing-frozen upstream (App.tsx). Used
   *  only to identify which segment owns the live `currentFrame`. */
  currentSegment: VideoSegment | undefined;
  currentTime: number;
  /** The SAME VideoDecoderPool useWebCodecsPreview.ts owns (threaded through
   *  its return object) — reused, never re-created. */
  pool: VideoDecoderPool;
  /** The live decoded frame for the CURRENT segment (useWebCodecsPreview's
   *  own `frame`), and the segment id it actually belongs to (`frameSegmentId`
   *  — lags currentSegment across a boundary, see that hook). Feeds slot 'b'
   *  (incoming) during a transition and slot 'a' with no transition. */
  currentFrame: VideoFrame | null;
  currentFrameSegmentId: string | null;
  config: ProjectEffectConfig;
  /** D12 — true during a timeline resize-drag; transient boundary geometry
   *  could sweep currentTime into a bogus transition window. Read directly at
   *  render (not an effect dep), mirroring useTransitionPreview.ts: while true,
   *  transitions are suppressed (plain blit of the current frame) so the drag
   *  can't swap in the wrong segment's content. */
  isResizingRef: React.RefObject<boolean>;
  /** The dual gate (isWebGL2Supported() && WebCodecs support && dev toggle),
   *  computed by PreviewStage. Gates ALL work in this hook. */
  enabled: boolean;
}

export interface UseGlPreviewResult {
  /** Non-fatal setup error (context unavailable, compositor construction
   *  failure) — surfaced for the dev badge; there is no fallback render path
   *  by design (plan Section 3.4). */
  error: string | null;
}

/**
 * object-cover source rect — the exact crop math PreviewCanvas.tsx and the
 * legacy `<video className="object-cover">`/`<img>` use, so the GL path fills
 * the stage the same way (scale to fill, center-crop the overflowing axis).
 * Pure and dependency-free so it's directly unit-testable (see
 * useGlPreview.test.ts), same discipline as toSourceTime/computeKeepSet.
 */
export function computeObjectCoverRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const dstRatio = dstW / dstH;
  const srcRatio = srcW / srcH;
  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;
  if (srcRatio > dstRatio) {
    sw = srcH * dstRatio;
    sx = (srcW - sw) / 2;
  } else {
    sh = srcW / dstRatio;
    sy = (srcH - sh) / 2;
  }
  return { sx, sy, sw, sh };
}

/** A source resolved for a slot this tick, plus its intrinsic dimensions. */
interface SlotSource {
  source: CanvasImageSource;
  w: number;
  h: number;
}

export function useGlPreview({
  canvasRef,
  segments,
  assets,
  currentSegment,
  currentTime,
  pool,
  currentFrame,
  currentFrameSegmentId,
  config,
  isResizingRef,
  enabled,
}: UseGlPreviewParams): UseGlPreviewResult {
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const compositorRef = useRef<GlCompositor | null>(null);
  const contextLostRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fit offscreen canvases — ONE per slot, allocated lazily once and
  // reused across every tick (requirement: not reallocated per frame). Only
  // their drawing-buffer dimensions are updated, and only when the target
  // size actually changes (see fitAndUpload's `!== dst` guard below).
  const fitCanvasARef = useRef<HTMLCanvasElement | null>(null);
  const fitCanvasBRef = useRef<HTMLCanvasElement | null>(null);

  // Image texture cache (image/color segments) — one HTMLImageElement per
  // asset url, decoded once; a load bumps `imageEpoch` to force one redraw.
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imageEpoch, setImageEpoch] = useState(0);

  // The OUTGOING segment's live frame, pulled from the pool during a
  // transition window (see the chase effect below). Carried in state so a
  // chase settle triggers a redraw; tagged with its segment id so a stale
  // outgoing frame can't be drawn for the wrong segment.
  const [outgoing, setOutgoing] = useState<{ frame: VideoFrame; segmentId: string } | null>(null);

  // --- Render-scope pure derivation (cheap; recomputed each render) ---------
  const rawParams = deriveCompositeParams(segments, currentTime, config);
  // D12: read the ref at render time, not as a dep — a resize-drag's transient
  // geometry must never produce a transition window here.
  const resizing = isResizingRef.current === true;
  const params = resizing ? { ...rawParams, transition: null } : rawParams;
  const plan = deriveSlotPlan(segments, currentTime, params.transition);

  // During an active transition slot 'a' is the OUTGOING (previous) segment
  // (deriveSlotPlan). The outgoing side is "live" (needs a pool pull) only
  // when it's a video asset — image outgoing content comes from the image
  // cache in the render effect, no decode session involved.
  const transitionActive = plan.b !== null;
  const outgoingSeg = transitionActive ? plan.a : null;
  const outgoingAsset = outgoingSeg ? assets.find((a) => a.id === outgoingSeg.assetId) : undefined;
  const outgoingVideoSeg = outgoingSeg && outgoingAsset?.type === 'video' ? outgoingSeg : null;

  // --- GL context + compositor lifecycle -----------------------------------
  // useLayoutEffect (not useEffect) so the context/compositor exist before the
  // render layout-effect below runs on the same commit — otherwise the first
  // enabled tick would find no compositor and skip a frame.
  useLayoutEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = acquireGlContext(canvas, {
      onContextLost: () => {
        contextLostRef.current = true;
      },
      onContextRestored: () => {
        contextLostRef.current = false;
        compositorRef.current?.handleContextRestored();
      },
    });
    if (!gl) {
      setError('WebGL2 context unavailable');
      return;
    }
    glRef.current = gl;
    contextLostRef.current = false;
    try {
      compositorRef.current = new GlCompositor(gl);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    return () => {
      compositorRef.current?.dispose();
      compositorRef.current = null;
      glRef.current = null;
      // Drop the outgoing-session protection this hook owned — when the path
      // is toggled off, useTransitionPreview.ts resumes managing this set.
      pool.setTransitionProtectedIds([]);
    };
    // canvasRef/pool identities are stable; `enabled` is the real toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // --- Outgoing session protection (Item-4 B3 mechanism, reused) ------------
  // Keep the outgoing segment's decode session alive through the transition
  // window: useWebCodecsPreview's own {current,next} protection (setProtectedIds)
  // stops covering it the instant the boundary crosses. Separate pool set
  // (transitionProtectedIds) so it never clobbers, or is clobbered by, that
  // {current,next} set — exactly as useTransitionPreview.ts uses it. GL owns
  // this set only while enabled; useTransitionPreview is inert (glPathActive)
  // in that state, so the two never fight over it.
  useEffect(() => {
    if (!enabled) return;
    pool.setTransitionProtectedIds(outgoingVideoSeg ? [outgoingVideoSeg.id] : []);
  }, [enabled, pool, outgoingVideoSeg?.id]);

  // --- Outgoing frame chase (Item-4 B3 chase-mutex, reused) -----------------
  // At most one getFrameAt in flight for the outgoing session; reset on a
  // genuine outgoing-segment change (new epoch). Mirrors useTransitionPreview's
  // own outgoing chase exactly, including why (a stale chase must not paint
  // over a new one, and its busy loop must not starve the new segment).
  const outgoingChaseMutexRef = useRef<ChaseMutex>({ chasing: false, epoch: 0 });
  const outgoingLatestTargetRef = useRef(0);
  const outgoingEpochKeyRef = useRef<string | null>(null);
  const outgoingGenerationRef = useRef(0);

  useEffect(() => {
    if (!enabled || !outgoingVideoSeg) {
      outgoingEpochKeyRef.current = null;
      ++outgoingGenerationRef.current;
      return;
    }
    const segmentId = outgoingVideoSeg.id;
    if (outgoingEpochKeyRef.current !== segmentId) {
      outgoingEpochKeyRef.current = segmentId;
      ++outgoingGenerationRef.current;
      resetChaseMutex(outgoingChaseMutexRef.current);
    }
    const generation = outgoingGenerationRef.current;
    // Uncapped source time — currentTime has advanced past the outgoing
    // segment's nominal end during a blend, so this continues its source time
    // forward (same reasoning as useTransitionPreview.ts's outgoing pull).
    outgoingLatestTargetRef.current = toSourceTime(outgoingVideoSeg, currentTime);

    startChaseIfIdle(
      outgoingChaseMutexRef.current,
      () => outgoingLatestTargetRef.current,
      (target) => pool.getFrameAt(segmentId, target).catch(() => null),
      (result) => {
        if (outgoingGenerationRef.current !== generation) return; // superseded
        if (!result) return; // nothing decoded yet / evicted — keep last drawn
        setOutgoing({ frame: result, segmentId });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, outgoingVideoSeg?.id, currentTime, pool]);

  // --- The per-tick render -------------------------------------------------
  // useLayoutEffect (the Bug-1 paint-ordering lesson): the GL bitmap must be
  // current before the browser paints this commit. When a required slot has
  // no usable fresh frame this tick, RETAIN the last GL draw (do not clear) —
  // the D10/PreviewCanvas "don't blank on nothing" discipline, so boundary
  // decode lag can't black-flash.
  useLayoutEffect(() => {
    if (!enabled) return;
    const compositor = compositorRef.current;
    const gl = glRef.current;
    const canvas = canvasRef.current;
    if (!compositor || !gl || !canvas || contextLostRef.current) return;

    const displayW = canvas.clientWidth || canvas.width;
    const displayH = canvas.clientHeight || canvas.height;
    if (displayW === 0 || displayH === 0) return;
    if (canvas.width !== displayW || canvas.height !== displayH) {
      canvas.width = displayW;
      canvas.height = displayH;
    }
    const dstW = canvas.width;
    const dstH = canvas.height;

    // Resolve the live VideoFrame for a segment: the current/incoming segment
    // uses useWebCodecsPreview's own `currentFrame` (only when caught up —
    // frameSegmentId matches); the outgoing segment uses this hook's chased
    // frame. No collision: currentFrameSegmentId is always the incoming
    // segment during a transition, never the outgoing one.
    const resolveVideoFrame = (seg: VideoSegment): VideoFrame | null => {
      if (currentFrame && currentFrameSegmentId === seg.id) return currentFrame;
      if (outgoing && outgoing.segmentId === seg.id) return outgoing.frame;
      return null;
    };

    const resolveSlotSource = (seg: VideoSegment): SlotSource | null => {
      const asset = assets.find((a) => a.id === seg.assetId);
      if (asset?.type === 'video') {
        const frame = resolveVideoFrame(seg);
        if (!frame) return null;
        const w = frame.displayWidth;
        const h = frame.displayHeight;
        if (!w || !h) return null; // a closed frame reads back 0x0 on some engines
        return { source: frame, w, h };
      }
      if (asset?.type === 'image' && asset.url) {
        const img = getImage(asset.url);
        if (!img) return null;
        return { source: img, w: img.naturalWidth, h: img.naturalHeight };
      }
      return null; // missing/color/audio — nothing GL-renderable
    };

    const getImage = (url: string): HTMLImageElement | null => {
      const cache = imageCacheRef.current;
      let img = cache.get(url);
      if (!img) {
        img = new Image();
        img.decoding = 'async';
        img.onload = () => setImageEpoch((e) => e + 1);
        img.src = url;
        cache.set(url, img);
      }
      return img.complete && img.naturalWidth > 0 ? img : null;
    };

    const getFitCanvas = (slot: TextureSlot): HTMLCanvasElement => {
      const ref = slot === 'a' ? fitCanvasARef : fitCanvasBRef;
      if (!ref.current) ref.current = document.createElement('canvas');
      return ref.current;
    };

    // object-cover-fit `src` onto the slot's reused canvas, then upload it.
    // Returns false (→ retain) on a closed-frame drawImage race.
    const fitAndUpload = (slot: TextureSlot, src: SlotSource): boolean => {
      const fit = getFitCanvas(slot);
      if (fit.width !== dstW || fit.height !== dstH) {
        fit.width = dstW;
        fit.height = dstH;
      }
      const ctx = fit.getContext('2d');
      if (!ctx) return false;
      const { sx, sy, sw, sh } = computeObjectCoverRect(src.w, src.h, dstW, dstH);
      try {
        ctx.clearRect(0, 0, dstW, dstH);
        ctx.drawImage(src.source, sx, sy, sw, sh, 0, 0, dstW, dstH);
      } catch {
        // VideoFrame closed between resolve and draw (pool eviction/scrub
        // race) — same hazard PreviewCanvas.tsx documents. Retain last frame.
        return false;
      }
      compositor.uploadFrame(slot, fit);
      return true;
    };

    if (!plan.a) return; // outside every segment — retain last frame
    const aSrc = resolveSlotSource(plan.a);
    if (!aSrc || !fitAndUpload('a', aSrc)) return; // slot a not ready — retain

    let transitionForRender = params.transition;
    if (plan.b) {
      const bSrc = resolveSlotSource(plan.b);
      // Incoming not ready yet — draw the outgoing (slot a) alone this tick
      // rather than a half-populated blend; converges to the real blend within
      // ~a tick once the incoming frame lands (the B3 convergence behavior).
      if (!bSrc || !fitAndUpload('b', bSrc)) {
        transitionForRender = null;
      }
    }

    compositor.renderFrame({ ...params, transition: transitionForRender });
    // params/plan are recomputed each render from these inputs; listing the
    // primitive drivers keeps the effect firing exactly when a redraw is
    // warranted (paused = stable currentTime = no needless redraw).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    currentTime,
    currentFrame,
    currentFrameSegmentId,
    outgoing,
    imageEpoch,
    segments,
    assets,
    // config fields that affect the derivation:
    config.globalTransition,
    config.globalTransitionDuration,
    config.grade,
  ]);

  return { error: enabled ? error : null };
}
