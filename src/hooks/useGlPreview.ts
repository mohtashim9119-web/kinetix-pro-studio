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
 *   2. source each slot's content — whichever side bounds-based
 *      `currentSegment` currently is gets its frame from the already-running
 *      WebCodecs decode pool via useWebCodecsPreview's exposed `frame`; the
 *      OTHER side (outgoing pre-boundary is already `current`, so this only
 *      ever means the outgoing side post-boundary or the incoming side
 *      pre-boundary) gets its own symmetric chase-pull from that SAME pool
 *      via the Item-4 B1-B3 protected-session + chase-mutex primitives
 *      (never a parallel pool) — see resolveChasedVideoFrame's own doc,
 *   3. upload each source DIRECTLY to its GPU texture slot (no intermediate
 *      2D canvas — see computeObjectCoverUvRect's doc comment for why: an
 *      earlier CPU-canvas-pre-fit version of this step measured 36-58ms/frame
 *      on WKWebView, ~1800-2900x slower than a direct upload), with the
 *      object-cover crop expressed as a UV-rect uniform the shader applies
 *      (shaders.ts's u_texRectA/u_texRectB) instead of a CPU-side draw, then
 *      renderFrame once.
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
import { GlCompositor, type TextureSlot, type TexRect, type UploadSource } from '../services/gl/glCompositor';
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
   *  — lags currentSegment across a boundary, see that hook). Since
   *  `currentSegment` is bounds-based (unaware of the centered transition
   *  window), this feeds whichever slot that segment happens to be during a
   *  transition — the outgoing slot pre-boundary, the incoming slot
   *  post-boundary — via resolveChasedVideoFrame's first branch; the other
   *  slot for each half is covered by this hook's own outgoing/incoming
   *  chase state instead. With no transition active it's simply slot 'a'. */
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
 * object-cover UV-crop rect — the exact crop math PreviewCanvas.tsx and the
 * legacy `<video className="object-cover">`/`<img>` use (scale to fill,
 * center-crop the overflowing axis), expressed in the SOURCE's own [0,1] UV
 * space rather than destination pixels, so it can be fed directly to
 * GlCompositor.uploadFrame's texRect param and wired as shaders.ts's
 * u_texRectA/u_texRectB uniform (see that file's doc comment for the
 * mechanism and why: a CPU-side pixel-rect pre-fit onto an intermediate 2D
 * canvas — this function's original form, and the ONLY reason a canvas hop
 * ever existed in this hook — measured 36-58ms/frame on WKWebView, ~1800-
 * 2900x slower than uploading the raw source directly; see
 * docs/webgl-architecture-plan.md Section 7's [CORRECTED] object-cover row).
 *
 * Pure and dependency-free so it's directly unit-testable (see
 * useGlPreview.test.ts), same discipline as toSourceTime/computeKeepSet.
 * Same-aspect source/destination yields identity (0,0,1,1) — full [0,1] UV,
 * no crop.
 */
export function computeObjectCoverUvRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): TexRect {
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
  return { uOffset: sx / srcW, vOffset: sy / srcH, uScale: sw / srcW, vScale: sh / srcH };
}

/** A source resolved for a slot this tick, plus its intrinsic dimensions. */
interface SlotSource {
  source: UploadSource;
  w: number;
  h: number;
}

/** A chase-pulled live VideoFrame, tagged with the segment id it belongs to
 *  — the shape both the outgoing and incoming chase state slots share. */
export interface ChasedFrame {
  frame: VideoFrame;
  segmentId: string;
}

/**
 * Resolves the live VideoFrame to upload for `segmentId`'s slot this tick —
 * pure, so the outgoing/incoming symmetric resolution is directly
 * unit-testable without a hook-rendering harness (same precedent as
 * computeObjectCoverUvRect above and useWebCodecsPreview.ts's own pure
 * helpers; this repo has no jsdom/@testing-library/react).
 *
 * Three sources, checked in order:
 *  1. `currentFrame`/`currentFrameSegmentId` — useWebCodecsPreview's own
 *     live frame for whichever segment bounds-based `currentSegment`
 *     currently is. Covers the OUTGOING slot pre-boundary (currentSegment
 *     IS the outgoing segment for that half) and the INCOMING slot
 *     post-boundary (currentSegment has flipped to the incoming segment by
 *     then).
 *  2. `outgoing` — this hook's own chase-pulled frame for the OUTGOING
 *     segment, needed once currentSegment stops covering it (post-boundary,
 *     since useWebCodecsPreview drops protection for a segment the instant
 *     it's no longer {current, next}).
 *  3. `incoming` — the symmetric chase-pulled frame for the INCOMING
 *     segment, needed pre-boundary (currentSegment hasn't reached it yet,
 *     so branch 1 can't cover it, and branch 2 only ever tracks the
 *     outgoing side). This closes the gap this hook used to have: before
 *     this fix, nothing ever chased a live frame for the incoming segment
 *     pre-boundary, so the render effect fell back to blitting the outgoing
 *     slot alone (no blend) for the whole pre-boundary half whenever the
 *     incoming segment was video (see docs/webgl-architecture-plan.md's
 *     "video-video transition blend gap" closeout entry).
 */
export function resolveChasedVideoFrame(
  segmentId: string,
  currentFrame: VideoFrame | null,
  currentFrameSegmentId: string | null,
  outgoing: ChasedFrame | null,
  incoming: ChasedFrame | null,
): VideoFrame | null {
  if (currentFrame && currentFrameSegmentId === segmentId) return currentFrame;
  if (outgoing && outgoing.segmentId === segmentId) return outgoing.frame;
  if (incoming && incoming.segmentId === segmentId) return incoming.frame;
  return null;
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

  // Image texture cache (image/color segments) — one HTMLImageElement per
  // asset url, decoded once; a load bumps `imageEpoch` to force one redraw.
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imageEpoch, setImageEpoch] = useState(0);

  // The OUTGOING segment's live frame, pulled from the pool during a
  // transition window (see the chase effect below). Carried in state so a
  // chase settle triggers a redraw; tagged with its segment id so a stale
  // outgoing frame can't be drawn for the wrong segment.
  const [outgoing, setOutgoing] = useState<ChasedFrame | null>(null);
  // The INCOMING segment's live frame — symmetric counterpart to `outgoing`,
  // needed pre-boundary (see the incoming chase effect below and
  // resolveChasedVideoFrame's own doc for why the outgoing chase alone
  // can't cover this side).
  const [incoming, setIncoming] = useState<ChasedFrame | null>(null);

  // --- Render-scope pure derivation (cheap; recomputed each render) ---------
  const rawParams = deriveCompositeParams(segments, currentTime, config);
  // D12: read the ref at render time, not as a dep — a resize-drag's transient
  // geometry must never produce a transition window here.
  const resizing = isResizingRef.current === true;
  const params = resizing ? { ...rawParams, transition: null } : rawParams;
  const plan = deriveSlotPlan(segments, currentTime, params.transition, config);

  // During an active transition slot 'a' is the OUTGOING (previous) segment
  // and slot 'b' is the INCOMING (next) segment (deriveSlotPlan). Each side
  // is "live" (needs its own pool chase) only when it's a video asset —
  // image content comes from the image cache in the render effect, no
  // decode session involved.
  const transitionActive = plan.b !== null;
  const outgoingSeg = transitionActive ? plan.a : null;
  const outgoingAsset = outgoingSeg ? assets.find((a) => a.id === outgoingSeg.assetId) : undefined;
  const outgoingVideoSeg = outgoingSeg && outgoingAsset?.type === 'video' ? outgoingSeg : null;

  const incomingSeg = transitionActive ? plan.b : null;
  const incomingAsset = incomingSeg ? assets.find((a) => a.id === incomingSeg.assetId) : undefined;
  const incomingVideoSeg = incomingSeg && incomingAsset?.type === 'video' ? incomingSeg : null;

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

  // --- Transition session protection (Item-4 B3 mechanism, reused + made
  // symmetric) ----------------------------------------------------------------
  // Keep BOTH sides' decode sessions alive through the transition window:
  // useWebCodecsPreview's own {current,next} protection (setProtectedIds)
  // only ever covers whichever segment bounds-based currentSegment considers
  // {current, next} — that drops the outgoing segment the instant the
  // boundary crosses, and (symmetrically) never specially protects the
  // incoming segment beyond its ordinary "next" coverage. Separate pool set
  // (transitionProtectedIds) so this never clobbers, or is clobbered by,
  // that {current,next} set — exactly as useTransitionPreview.ts uses it.
  // GL owns this set only while enabled; useTransitionPreview is inert
  // (glPathActive) in that state, so the two never fight over it.
  useEffect(() => {
    if (!enabled) return;
    const ids: string[] = [];
    if (outgoingVideoSeg) ids.push(outgoingVideoSeg.id);
    if (incomingVideoSeg) ids.push(incomingVideoSeg.id);
    pool.setTransitionProtectedIds(ids);
  }, [enabled, pool, outgoingVideoSeg?.id, incomingVideoSeg?.id]);

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

  // --- Incoming frame chase (symmetric fix for the pre-boundary blend gap) --
  // Mirrors the outgoing chase above exactly, targeting plan.b instead of
  // plan.a. `toSourceTime` naturally does the right thing for both halves of
  // the window without any special-casing here: while currentTime is still
  // before the incoming segment's own nominal startTime (the pre-boundary
  // half), toSourceTime's `Math.max(0, ...)` clamp makes this converge on
  // and hold the incoming segment's own first frame — the same "incoming
  // sampled at its own t=0, held fixed" approximation
  // useTransitionPreview.ts's legacy path already uses deliberately, just
  // arrived at for free via the same formula the outgoing chase already
  // uses. Once currentTime crosses into the incoming segment's own span
  // (post-boundary half) this naturally tracks its real advancing playback
  // position too, though by then `currentFrame` (useWebCodecsPreview, now
  // treating this segment as `current`) already resolves it via
  // resolveChasedVideoFrame's first branch — this chase becomes redundant
  // for that half, harmless, the same relationship the outgoing chase has
  // with the pre-boundary half.
  const incomingChaseMutexRef = useRef<ChaseMutex>({ chasing: false, epoch: 0 });
  const incomingLatestTargetRef = useRef(0);
  const incomingEpochKeyRef = useRef<string | null>(null);
  const incomingGenerationRef = useRef(0);

  useEffect(() => {
    if (!enabled || !incomingVideoSeg) {
      incomingEpochKeyRef.current = null;
      ++incomingGenerationRef.current;
      return;
    }
    const segmentId = incomingVideoSeg.id;
    if (incomingEpochKeyRef.current !== segmentId) {
      incomingEpochKeyRef.current = segmentId;
      ++incomingGenerationRef.current;
      resetChaseMutex(incomingChaseMutexRef.current);
    }
    const generation = incomingGenerationRef.current;
    incomingLatestTargetRef.current = toSourceTime(incomingVideoSeg, currentTime);

    startChaseIfIdle(
      incomingChaseMutexRef.current,
      () => incomingLatestTargetRef.current,
      (target) => pool.getFrameAt(segmentId, target).catch(() => null),
      (result) => {
        if (incomingGenerationRef.current !== generation) return; // superseded
        if (!result) return; // nothing decoded yet / evicted — keep last drawn
        setIncoming({ frame: result, segmentId });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, incomingVideoSeg?.id, currentTime, pool]);

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

    // Resolve the live VideoFrame for a segment via the shared pure resolver
    // (resolveChasedVideoFrame, above) — currentFrame covers whichever side
    // bounds-based currentSegment currently is (outgoing pre-boundary,
    // incoming post-boundary), and the outgoing/incoming chase state each
    // cover their own side for the half currentFrame can't reach. Previously
    // only the outgoing side had a chase (documented here as a KNOWN GAP,
    // see docs/webgl-architecture-plan.md's "video-video transition blend
    // gap" closeout entry for the fix) — the incoming chase effect above
    // closes that symmetrically.
    const resolveSlotSource = (seg: VideoSegment): SlotSource | null => {
      const asset = assets.find((a) => a.id === seg.assetId);
      if (asset?.type === 'video') {
        const frame = resolveChasedVideoFrame(seg.id, currentFrame, currentFrameSegmentId, outgoing, incoming);
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

    // Uploads `src` DIRECTLY to `slot` — no intermediate 2D canvas (see
    // computeObjectCoverUvRect's/shaders.ts's u_texRectA doc comments for
    // why: the removed CPU-canvas-then-texImage2D(canvas) path measured
    // 36-58ms/frame on WKWebView vs 2.82ms for a direct upload). The
    // object-cover crop is computed as a UV rect and stored on the
    // compositor for drawStage1 to wire as a shader uniform, not applied
    // here. Returns false (→ retain) on a closed-frame upload race (the
    // frame was resolved earlier this tick but the pool evicted/reset its
    // session before this synchronous gl.texImage2D call ran) — same hazard
    // PreviewCanvas.tsx's drawImage documents, now guarding texImage2D
    // instead.
    const uploadSlot = (slot: TextureSlot, src: SlotSource): boolean => {
      const texRect = computeObjectCoverUvRect(src.w, src.h, dstW, dstH);
      try {
        compositor.uploadFrame(slot, src.source, texRect);
      } catch {
        return false;
      }
      return true;
    };

    if (!plan.a) return; // outside every segment — retain last frame
    const aSrc = resolveSlotSource(plan.a);
    if (!aSrc || !uploadSlot('a', aSrc)) return; // slot a not ready — retain

    let transitionForRender = params.transition;
    if (plan.b) {
      const bSrc = resolveSlotSource(plan.b);
      // Incoming not ready yet — draw the outgoing (slot a) alone this tick
      // rather than a half-populated blend; converges to the real blend within
      // ~a tick once the incoming frame lands (the B3 convergence behavior).
      if (!bSrc || !uploadSlot('b', bSrc)) {
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
    incoming,
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
