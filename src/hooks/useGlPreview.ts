/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useGlPreview — the thin WebGL2 preview driver (docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20)
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
 *   3. upload each source DIRECTLY to its GPU texture slot (no intermediate
 *      2D canvas — see computeObjectCoverUvRect's doc comment for why: an
 *      earlier CPU-canvas-pre-fit version of this step measured 36-58ms/frame
 *      on WKWebView, ~1800-2900x slower than a direct upload), with the
 *      object-cover crop expressed as a UV-rect uniform the shader applies
 *      (shaders.ts's u_texRectA/u_texRectB) instead of a CPU-side draw, then
 *      renderFrame once.
 *
 * `enabled` (isWebGL2Supported() && WebCodecs support), computed by the caller
 * (PreviewStage.tsx), gates ALL work — when false this hook is inert even though
 * it stays mounted. Phase 5's cutover removed the dev-only toggle that used to
 * be the second half of that gate, so this is now the app's only effects path;
 * there is no fallback by design (plan Section 3.4).
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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Asset, VideoSegment } from '../types';
import type { VideoDecoderPool } from '../services/videoDecoderPool';
import { GlCompositor, type TextureSlot, type UploadSource } from '../services/gl/glCompositor';
import { acquireGlContext } from '../services/gl/glContext';
import { computeObjectContainUvRect } from '../services/gl/uvRect';
// Re-exported for useGlPreview.test.ts (and any other existing importer),
// which imports both functions from this module's own path — this file no
// longer defines them (moved verbatim to services/gl/uvRect.ts, docs/webcodecs-export-plan.md
// §4.5), but its public surface stays the same so nothing else needs updating.
export { computeObjectCoverUvRect, computeObjectContainUvRect } from '../services/gl/uvRect';
import {
  deriveCompositeParams,
  deriveSlotPlan,
  type ProjectEffectConfig,
} from '../services/gl/compositeParams';
// Read-only reuse of useWebCodecsPreview.ts's own pure primitives (that file
// is NOT modified) — the exact segment-local→source-time mapping the decode
// path already uses, and the "at most one getFrameAt in flight per session"
// chase mutex whose deadlock/starvation hazards were found and fixed there.
// The import the (now-deleted) useTransitionPreview.ts made for the identical
// reason (do not rebuild a parallel, less-proven mechanism — the B3 lesson).
import {
  toSourceTime,
  startChaseIfIdle,
  resetChaseMutex,
  type ChaseMutex,
} from './useWebCodecsPreview';

interface UseGlPreviewParams {
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
   *  render (not an effect dep), as the deleted useTransitionPreview.ts also
   *  did: while true, transitions are suppressed (plain blit of the current
   *  frame) so the drag can't swap in the wrong segment's content. */
  isResizingRef: React.RefObject<boolean>;
  /** The capability gate (isWebGL2Supported() && WebCodecs support), computed
   *  by PreviewStage. Gates ALL work in this hook. Carried a dev-only toggle too
   *  until the Phase 5 cutover removed it. */
  enabled: boolean;
  /** Backing-buffer dimensions (NOT the CSS display size) — the project's
   *  native resolution, derived via resolutionConfig.ts's resolveDimensions
   *  from (project.aspectRatio, project.resolutionTier). The GL canvas still
   *  fills its CSS box via the caller's className/style (w-full h-full); the
   *  browser scales this fixed-size backing buffer to fit. */
  nativeWidth: number;
  nativeHeight: number;
  /** PreviewStage's fullscreen flag. The per-tick render effect below only
   *  reruns when one of its listed deps changes; listing isFullscreen forces
   *  exactly one extra re-run on toggle so a paused fullscreen entry still
   *  gets a fresh draw at the (unchanged) native resolution the moment the
   *  stage resizes. */
  isFullscreen: boolean;
}

export interface UseGlPreviewResult {
  /** Non-fatal setup error (context unavailable, compositor construction
   *  failure) — surfaced by PreviewStage as a visible error banner, because
   *  there is no fallback render path by design (plan Section 3.4) and a silent
   *  black stage would be worse than a message. */
  error: string | null;
  /** Callback ref for the caller (PreviewStage.tsx) to attach to its GL
   *  `<canvas>` element — replaces a plain `useRef` so the canvas's actual
   *  DOM attach/detach participates in React's effect-dependency diffing
   *  (Bug 4 fix). A plain ref's `.current` assignment happens silently
   *  during commit and is invisible to `useLayoutEffect` dependency arrays;
   *  if `enabled` was already `true` on this hook's very first render (which,
   *  post-cutover, is the normal case on any capable runtime) while the canvas hadn't
   *  mounted yet (e.g. `currentSegment` — and so the canvas's own JSX
   *  condition — hadn't hydrated yet), the context-acquisition effect below
   *  would fire once, find no canvas, bail silently, and never fire again,
   *  since `enabled` never changes value a second time in that session. */
  canvasRef: (node: HTMLCanvasElement | null) => void;
}

/** A source resolved for a slot this tick, plus its intrinsic dimensions. */
interface SlotSource {
  source: UploadSource;
  w: number;
  h: number;
}

export function useGlPreview({
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
  nativeWidth,
  nativeHeight,
  isFullscreen,
}: UseGlPreviewParams): UseGlPreviewResult {
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const compositorRef = useRef<GlCompositor | null>(null);
  const contextLostRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // The GL <canvas> DOM node, tracked as state (not a plain useRef) so a
  // canvas that mounts AFTER `enabled` was already true — e.g. the dev
  // toggle's persisted localStorage value is already true on cold load,
  // before `currentSegment` (and so the canvas's own JSX condition) has
  // hydrated — still shows up as a genuine dependency change and re-fires
  // the effects below (Bug 4 fix; see UseGlPreviewResult.canvasRef's doc).
  const [canvasNode, setCanvasNode] = useState<HTMLCanvasElement | null>(null);
  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    setCanvasNode(node);
  }, []);

  // Image texture cache (image/color segments) — one HTMLImageElement per
  // asset url, decoded once; a load bumps `imageEpoch` to force one redraw.
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imageEpoch, setImageEpoch] = useState(0);

  // The OUTGOING segment's live frame, pulled from the pool during a
  // transition window (see the chase effect below). Carried in state so a
  // chase settle triggers a redraw; tagged with its segment id so a stale
  // outgoing frame can't be drawn for the wrong segment.
  const [outgoing, setOutgoing] = useState<{ frame: VideoFrame; segmentId: string } | null>(null);

  // The INCOMING segment's live frame, pulled from the pool during the
  // PRE-boundary half of a centered transition window — the symmetric
  // counterpart to `outgoing` above. Same carried-in-state + segment-id-tag
  // discipline: a settle triggers a redraw, and the tag guards against
  // drawing a stale incoming frame for the wrong segment. See the incoming
  // chase effect below for why this is needed only before currentTime crosses
  // the boundary (afterwards useWebCodecsPreview's own `currentFrame` covers
  // the incoming segment, since it has become `current`).
  const [incoming, setIncoming] = useState<{ frame: VideoFrame; segmentId: string } | null>(null);

  // --- Render-scope pure derivation (cheap; recomputed each render) ---------
  const rawParams = deriveCompositeParams(segments, currentTime, config);
  // D12: read the ref at render time, not as a dep — a resize-drag's transient
  // geometry must never produce a transition window here.
  const resizing = isResizingRef.current === true;
  const params = resizing ? { ...rawParams, transition: null } : rawParams;
  const plan = deriveSlotPlan(segments, currentTime, params.transition, config);

  // During an active transition slot 'a' is the OUTGOING (previous) segment
  // (deriveSlotPlan). The outgoing side is "live" (needs a pool pull) only
  // when it's a video asset — image outgoing content comes from the image
  // cache in the render effect, no decode session involved.
  const transitionActive = plan.b !== null;
  const outgoingSeg = transitionActive ? plan.a : null;
  const outgoingAsset = outgoingSeg ? assets.find((a) => a.id === outgoingSeg.assetId) : undefined;
  const outgoingVideoSeg = outgoingSeg && outgoingAsset?.type === 'video' ? outgoingSeg : null;

  // The incoming side (slot 'b') is "live" (needs a pool pull) only when it's
  // a video asset — image incoming content comes from the image cache in the
  // render effect, no decode session involved. Symmetric to outgoingVideoSeg.
  const incomingSeg = transitionActive ? plan.b : null;
  const incomingAsset = incomingSeg ? assets.find((a) => a.id === incomingSeg.assetId) : undefined;
  const incomingVideoSeg = incomingSeg && incomingAsset?.type === 'video' ? incomingSeg : null;

  // --- GL context + compositor lifecycle -----------------------------------
  // useLayoutEffect (not useEffect) so the context/compositor exist before the
  // render layout-effect below runs on the same commit — otherwise the first
  // enabled tick would find no compositor and skip a frame.
  useLayoutEffect(() => {
    if (!enabled) return;
    const canvas = canvasNode;
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
      // Drop the outgoing-session protection this hook owned. Nothing takes it
      // over: since the Phase 5 cutover this hook is the pool's only
      // transitionProtectedIds client (useTransitionPreview.ts, the previous
      // one, is deleted), so releasing it on teardown just leaves the set empty.
      pool.setTransitionProtectedIds([]);
    };
    // pool identity is stable; `enabled` is the capability gate (the dev toggle
    // it also used to carry was removed at the Phase 5 cutover), and
    // `canvasNode` (Bug 4 fix) is what makes this effect re-run once the
    // canvas actually mounts even if `enabled` was already true beforehand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, canvasNode]);

  // --- Outgoing session protection (Item-4 B3 mechanism, reused) ------------
  // Keep the outgoing segment's decode session alive through the transition
  // window: useWebCodecsPreview's own {current,next} protection (setProtectedIds)
  // stops covering it the instant the boundary crosses. Separate pool set
  // (transitionProtectedIds) so it never clobbers, or is clobbered by, that
  // {current,next} set. Since the Phase 5 cutover this hook is that set's only
  // client — the other one, useTransitionPreview.ts, is deleted — so nothing is
  // left to contend with it while `enabled`.
  useEffect(() => {
    if (!enabled) return;
    pool.setTransitionProtectedIds(outgoingVideoSeg ? [outgoingVideoSeg.id] : []);
  }, [enabled, pool, outgoingVideoSeg?.id]);

  // --- Outgoing frame chase (Item-4 B3 chase-mutex, reused) -----------------
  // At most one getFrameAt in flight for the outgoing session; reset on a
  // genuine outgoing-segment change (new epoch). Mirrored the deleted
  // useTransitionPreview's own outgoing chase exactly, including why (a stale chase must not paint
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
    // forward (the same reasoning the deleted useTransitionPreview.ts's
    // outgoing pull used).
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

  // --- Incoming frame chase (symmetric counterpart of the outgoing chase) ---
  // The centering fix (D7) opens the transition window duration/2 BEFORE the
  // A/B boundary, so for that whole pre-boundary half currentTime is still
  // bounds-inside the OUTGOING segment — useWebCodecsPreview.ts's `currentFrame`
  // therefore still belongs to the outgoing segment and can't source the
  // incoming (slot 'b') content, collapsing the blend to "outgoing alone" (the
  // deterministic no-blend gap this effect fixes). This pulls the incoming
  // segment's frame straight from the SAME pool, mirroring the outgoing chase
  // above exactly (chase-mutex, epoch/generation staleness guards, single
  // getFrameAt in flight, last-frame retention on a null result).
  //
  // Deliberately does NOT touch transitionProtectedIds: the incoming segment
  // is already the pool's `next` (pre-boundary) and then `current`
  // (post-boundary) in useWebCodecsPreview.ts's own {current,next} protected
  // set, so its session is continuously protected and warmed without this
  // hook asserting anything — and asserting it here would full-replace (and so
  // clobber) the outgoing protection the effect above owns.
  //
  // Runs ONLY while the incoming segment is not yet the pool's `current`
  // segment (currentSegment?.id !== incomingVideoSeg.id): once currentTime
  // crosses the boundary, useWebCodecsPreview.ts owns that segment's frame-pull
  // via `currentFrame`, and a second concurrent getFrameAt on the same session
  // here would race it. The last frame this chase committed stays available to
  // the render's resolver across that handoff (see resolveVideoFrame), so the
  // brief post-boundary `currentFrame` catch-up lag keeps blending instead of
  // dropping to outgoing-alone.
  const incomingChaseMutexRef = useRef<ChaseMutex>({ chasing: false, epoch: 0 });
  const incomingLatestTargetRef = useRef(0);
  const incomingEpochKeyRef = useRef<string | null>(null);
  const incomingGenerationRef = useRef(0);

  useEffect(() => {
    if (!enabled || !incomingVideoSeg || currentSegment?.id === incomingVideoSeg.id) {
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
    // Pre-boundary, currentTime is before the incoming segment's own start, so
    // toSourceTime's segment-local progress is negative and floors at 0 — this
    // pulls the incoming segment's opening frame (source time 0 / trimStart),
    // exactly the frame it should fade in on. It advances into real source time
    // naturally as currentTime approaches the boundary.
    incomingLatestTargetRef.current = toSourceTime(incomingVideoSeg, currentTime);

    startChaseIfIdle(
      incomingChaseMutexRef.current,
      () => incomingLatestTargetRef.current,
      (target) => pool.getFrameAt(segmentId, target).catch(() => null),
      (result) => {
        if (incomingGenerationRef.current !== generation) return; // superseded
        if (!result) return; // nothing decoded yet / evicted — keep last drawn
        // Commit a NEW object reference only when the resolved frame or its
        // segment actually changes — the incoming target is pinned near
        // source-time 0 for the whole pre-boundary half, so getFrameAt keeps
        // returning the SAME VideoFrame object; a fresh `{frame, segmentId}`
        // wrapper each settle would still change `incoming`'s identity and
        // fire a redundant render pass (`incoming` is a render-effect dep).
        // Returning `prev` unchanged makes React bail out of that re-render.
        setIncoming((prev) =>
          prev && prev.frame === result && prev.segmentId === segmentId
            ? prev
            : { frame: result, segmentId },
        );
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, incomingVideoSeg?.id, currentSegment?.id, currentTime, pool]);

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
    const canvas = canvasNode;
    if (!compositor || !gl || !canvas || contextLostRef.current) return;

    if (nativeWidth === 0 || nativeHeight === 0) return;
    if (canvas.width !== nativeWidth || canvas.height !== nativeHeight) {
      canvas.width = nativeWidth;
      canvas.height = nativeHeight;
    }
    const dstW = canvas.width;
    const dstH = canvas.height;

    // Resolve the live VideoFrame for a segment, in priority order:
    //   1. useWebCodecsPreview's own `currentFrame`, when it belongs to this
    //      segment (frameSegmentId matches) — the caught-up current segment.
    //   2. this hook's OUTGOING chased frame (the segment a transition fades
    //      from, after it stops being `current`).
    //   3. this hook's INCOMING chased frame (the segment a transition fades
    //      to, before currentTime crosses the boundary — see the incoming
    //      chase effect above for why `currentFrame` can't cover it yet).
    // The three tags never collide for the same seg at the same tick: (1) is
    // whichever segment is bounds-current, (2) is always the pre-boundary
    // segment, (3) always the post-boundary segment; and (1) is checked first
    // so it wins the instant currentFrame catches up to the incoming segment.
    //
    // Fixes the post-transition-centering (D7) no-blend gap: the centered
    // window opens duration/2 ahead of the A/B boundary while currentTime is
    // still bounds-inside the outgoing segment, so before this incoming chase
    // existed `bSrc` resolved null for that whole first half and the render
    // below fell back to blitting slot 'a' (outgoing) alone. Item 3 supplies
    // the incoming frame across exactly that half.
    const resolveVideoFrame = (seg: VideoSegment): VideoFrame | null => {
      if (currentFrame && currentFrameSegmentId === seg.id) return currentFrame;
      if (outgoing && outgoing.segmentId === seg.id) return outgoing.frame;
      if (incoming && incoming.segmentId === seg.id) return incoming.frame;
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

    // Uploads `src` DIRECTLY to `slot` — no intermediate 2D canvas (see
    // computeObjectCoverUvRect's/shaders.ts's u_texRectA doc comments for
    // why: the removed CPU-canvas-then-texImage2D(canvas) path measured
    // 36-58ms/frame on WKWebView vs 2.82ms for a direct upload). The
    // object-contain fit (media-fit preview fix — export's own cover-fill
    // pipeline is untouched) is computed as a UV rect and stored on the
    // compositor for drawStage1 to wire as a shader uniform, not applied
    // here. Returns false (→ retain) on a closed-frame upload race (the
    // frame was resolved earlier this tick but the pool evicted/reset its
    // session before this synchronous gl.texImage2D call ran) — same hazard
    // PreviewCanvas.tsx's drawImage documents, now guarding texImage2D
    // instead.
    const uploadSlot = (slot: TextureSlot, src: SlotSource): boolean => {
      const texRect = computeObjectContainUvRect(src.w, src.h, dstW, dstH);
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

    // plan.b non-null ⇒ deriveSlotPlan found a REAL active transition (it only
    // assigns slot 'b' when params.transition is non-null and a boundary
    // resolves). So a null/closed incoming frame here is a transient
    // frame-lifecycle race (the pool closes a session's previous displayed
    // frame the instant a newer one is selected), NOT "no transition." RETAIN
    // the last validly composited frame — same discipline as the aSrc
    // early-return above — instead of forcing transition to null, which would
    // pop the blend to segment A at full opacity for that one pass and read as
    // a flicker. The legitimate no-transition case (plan.b === null) is
    // distinct: it skips this block entirely and renders slot 'a' normally
    // below with params.transition already null.
    if (plan.b) {
      const bSrc = resolveSlotSource(plan.b);
      if (!bSrc || !uploadSlot('b', bSrc)) return; // incoming transiently closed — retain, don't pop to A-solo
    }

    compositor.renderFrame({ ...params });
    // params/plan are recomputed each render from these inputs; listing the
    // primitive drivers keeps the effect firing exactly when a redraw is
    // warranted (paused = stable currentTime = no needless redraw).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    // Bug 4 fix: a canvas that mounts after `enabled` was already true (see
    // canvasNode's own doc above) must also re-trigger this render pass —
    // otherwise a paused session with no other input changing could leave
    // the now-ready compositor/gl un-drawn-to until the next unrelated tick.
    canvasNode,
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
    // The backing buffer now tracks the project's native resolution
    // (nativeWidth/nativeHeight) rather than the CSS box size, so a
    // resolutionTier change must re-fire this effect to resize the canvas.
    nativeWidth,
    nativeHeight,
    // Stretch-on-fullscreen-while-paused fix: none of the deps above change
    // when the stage's CSS box resizes (e.g. on a fullscreen toggle while
    // currentTime is frozen). The backing buffer itself no longer depends on
    // the CSS box, but this still forces one extra re-run — and one fresh
    // draw — right when the stage actually changes shape.
    isFullscreen,
  ]);

  return { error: enabled ? error : null, canvasRef: setCanvasRef };
}
