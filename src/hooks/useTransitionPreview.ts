/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useTransitionPreview — pre-roll snapshot blend for preview transitions.
 *
 * Decision (b) from Fidelity Polish kickoff: universal coverage via a
 * pre-roll snapshot approach. Renders outgoing + incoming segment frames
 * to offscreen canvases once (~50–200ms cost), then blends them over the
 * transition window. Works for image↔image, image↔video, video↔video.
 */

import { useRef, useEffect, useState } from 'react';
import { VideoSegment, Asset, TransitionType } from '../types';
import { renderSegmentFrame, FrameGlobalConfig } from '../services/frameRenderer';
import { resolveEffectiveTransition } from '../services/transitionResolver';

/** Snapshot resolution — 16:9 half-HD. Full resolution is unnecessary
 *  for preview-quality blending. */
const SNAP_W = 960;
const SNAP_H = 540;

/** How many seconds before the transition window to trigger the pre-roll.
 *  0.8s covers the worst-case parallel seek cost (~200ms per video) with a
 *  600ms safety margin. Same-asset sequential fallback costs ~400ms — still
 *  400ms of margin inside the 800ms window. */
const PRE_ROLL_LEAD_S = 0.8;

/** Tolerance for "does this segment start where that one ends" contiguity
 *  checks — matches the rounding tolerance segment timing already accrues
 *  elsewhere (e.g. syncEngine.ts's anchor math). */
const CONTIGUITY_EPSILON_S = 0.001;

/** Safety margin subtracted from the outgoing segment's own duration when
 *  sampling its final frame for the outgoing snapshot — avoids seeking at
 *  (or, from floating-point error, past) the source's own end. */
const OUTGOING_SNAPSHOT_EPSILON_S = 0.05;

interface SnapshotPair {
  /** Unique key identifying this boundary: `${outId}:${inId}` */
  key: string;
  outgoing: HTMLCanvasElement;
  incoming: HTMLCanvasElement;
}

export interface TransitionPreviewInfo {
  /** True when the playhead is inside the transition window AND snapshots are ready. */
  isActive: boolean;
  /** Blend factor 0..1 (0 = fully outgoing, 1 = fully incoming). */
  progress: number;
  /** Pre-rendered outgoing frame (at transition start time). */
  outgoing: HTMLCanvasElement | null;
  /** Pre-rendered incoming frame (first frame of next segment). */
  incoming: HTMLCanvasElement | null;
  /** The resolved transition type to apply (slug string or legacy enum). */
  effectiveTransition: TransitionType | string;
}

interface Params {
  segments: VideoSegment[];
  currentTime: number;
  assets: Asset[];
  globalTransition: TransitionType;
  globalTransitionDuration: number;
  globalConfig: FrameGlobalConfig;
  /** D12 fix — true while a timeline resize-drag is in progress. Segment
   *  boundaries are transiently distorted during a drag (cascade compensation
   *  is deferred to release), which can sweep currentTime into a bogus
   *  transition window. Suppress activation entirely while true; read
   *  directly at render time (not an effect dep) so there's no ordering
   *  concern like the seek-effect guard had to work around. */
  isResizingRef: React.RefObject<boolean>;
}

export function useTransitionPreview({
  segments,
  currentTime,
  assets,
  globalTransition,
  globalTransitionDuration,
  globalConfig,
  isResizingRef,
}: Params): TransitionPreviewInfo {
  const [snapshots, setSnapshots] = useState<SnapshotPair | null>(null);
  // Prevent concurrent or duplicate snapshot renders
  const pendingKeyRef = useRef<string>('');
  // Guard against setState after unmount (async renderSegmentFrame can outlive the component)
  const mountedRef = useRef<boolean>(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ---------------------------------------------------------------------------
  // Derive relevant segments + transition metadata
  //
  // Export places its blend AFTER the nominal boundary (inside the incoming
  // segment's own slot — see segmentEncoder.ts/exportPipeline.ts). Preview
  // must match that placement, which means the segment containing
  // `currentTime` is NOT reliably "the outgoing segment" the way it was when
  // the window sat entirely before the boundary — it can be either side
  // depending on where the playhead currently sits relative to a boundary.
  // Two candidate windows are evaluated every render, both anchored off
  // whichever segment currently contains the playhead:
  //   A) containingSeg is about to END — pre-roll lead-in only, no blend yet
  //      (the blend itself will happen inside the NEXT segment's own slot).
  //   B) containingSeg just STARTED — the real, active blend window, sitting
  //      inside containingSeg's own leading `duration` seconds.
  // Candidate B always wins if both were somehow true at once (degenerate
  // sub-`duration`-long segments) — an active blend is the "real" state.
  // ---------------------------------------------------------------------------
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const containingSeg = sorted.find(
    s => currentTime >= s.startTime && currentTime < s.startTime + s.duration,
  );
  const nextOf = (seg: VideoSegment) =>
    sorted.find(s => s.startTime >= seg.startTime + seg.duration - CONTIGUITY_EPSILON_S && s.id !== seg.id);
  const prevOf = (seg: VideoSegment) =>
    sorted.find(s => Math.abs(s.startTime + s.duration - seg.startTime) < CONTIGUITY_EPSILON_S && s.id !== seg.id);

  // Candidate A — containingSeg is the OUTGOING side, approaching its own end.
  const nextSegA = containingSeg ? nextOf(containingSeg) : undefined;
  const resolvedA = resolveEffectiveTransition(containingSeg, globalTransition, globalTransitionDuration);
  const preRollOnlyActive =
    containingSeg !== undefined &&
    nextSegA !== undefined &&
    resolvedA.transition !== TransitionType.NONE &&
    resolvedA.duration > 0 &&
    currentTime >= nextSegA.startTime - resolvedA.duration - PRE_ROLL_LEAD_S &&
    currentTime < nextSegA.startTime;

  // Candidate B — containingSeg is the INCOMING side, inside its own leading
  // transition window. Duration/type are resolved against the OUTGOING
  // segment's own field (prevSegB), matching resolveEffectiveTransition's
  // contract and export's semantics — never against containingSeg itself.
  const prevSegB = containingSeg ? prevOf(containingSeg) : undefined;
  const resolvedB = resolveEffectiveTransition(prevSegB, globalTransition, globalTransitionDuration);
  const activeBlendActive =
    containingSeg !== undefined &&
    prevSegB !== undefined &&
    resolvedB.transition !== TransitionType.NONE &&
    resolvedB.duration > 0 &&
    currentTime >= containingSeg.startTime &&
    currentTime < containingSeg.startTime + resolvedB.duration;

  let outgoingSeg: VideoSegment | undefined;
  let incomingSeg: VideoSegment | undefined;
  let transitionDuration = 0;
  let effectiveTransition: TransitionType | string = TransitionType.NONE;
  let isActiveWindow = false;
  let needsPreRollWindow = false;

  if (activeBlendActive) {
    outgoingSeg = prevSegB;
    incomingSeg = containingSeg;
    transitionDuration = resolvedB.duration;
    effectiveTransition = resolvedB.transition;
    isActiveWindow = true;
    needsPreRollWindow = true;
  } else if (preRollOnlyActive) {
    outgoingSeg = containingSeg;
    incomingSeg = nextSegA;
    transitionDuration = resolvedA.duration;
    effectiveTransition = resolvedA.transition;
    needsPreRollWindow = true;
  }

  const inTransitionWindow = !isResizingRef.current && isActiveWindow;

  const progress = inTransitionWindow && incomingSeg
    ? Math.max(0, Math.min(1, (currentTime - incomingSeg.startTime) / transitionDuration))
    : 0;

  // ---------------------------------------------------------------------------
  // Pre-roll: render snapshots once when approaching the transition window
  // ---------------------------------------------------------------------------
  const needsPreRoll = !isResizingRef.current && needsPreRollWindow;

  useEffect(() => {
    if (!needsPreRoll || !outgoingSeg || !incomingSeg) {
      return;
    }

    const key = `${outgoingSeg.id}:${incomingSeg.id}`;
    // Already have this snapshot pair or render is in flight
    if (snapshots?.key === key || pendingKeyRef.current === key) {
      return;
    }

    pendingKeyRef.current = key;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = SNAP_W;
    outCanvas.height = SNAP_H;
    const inCanvas = document.createElement('canvas');
    inCanvas.width = SNAP_W;
    inCanvas.height = SNAP_H;

    const outCtx = outCanvas.getContext('2d');
    const inCtx = inCanvas.getContext('2d');
    if (!outCtx || !inCtx) {
      pendingKeyRef.current = '';
      return;
    }

    const currentAsset = assets.find(a => a.id === outgoingSeg.assetId);
    const nextAsset = assets.find(a => a.id === incomingSeg.assetId);
    // Render the outgoing frame at its own final instant — the blend always
    // starts exactly at the shared segment boundary now (matching export),
    // so "outgoing" is always sampled at its own last frame, not partway
    // through. Clamped below its own duration to avoid an out-of-range seek.
    const outgoingTime = Math.max(0, outgoingSeg.duration - OUTGOING_SNAPSHOT_EPSILON_S);

    void (async () => {
      try {
        // When both segments reference the same video URL, videoCache returns
        // the same HTMLVideoElement. Concurrent seeks on the same element race
        // (the second seek cancels the first), so fall back to sequential in
        // that case. For all other combinations (distinct URLs, or non-video
        // assets) parallel rendering is safe and halves the snapshot cost.
        const sharesAsset =
          currentAsset?.type === 'video' &&
          nextAsset?.type === 'video' &&
          currentAsset.url === nextAsset.url;

        if (sharesAsset) {
          // Same video element — seek sequentially to avoid race.
          await renderSegmentFrame({
            segment: outgoingSeg,
            asset: currentAsset,
            timeInSegment: outgoingTime,
            ctx: outCtx,
            width: SNAP_W,
            height: SNAP_H,
            // The live DOM caption (PreviewStage.tsx) now stays visible throughout the
            // transition, so this snapshot must not bake its own copy of the body
            // caption underneath it — a size/position mismatch between the two was the
            // source of a visible "pop" at the transition's end. Headings and extra
            // overlays are unaffected by this flag.
            skipCaption: true,
            global: globalConfig,
          });
          await renderSegmentFrame({
            segment: incomingSeg,
            asset: nextAsset,
            timeInSegment: 0,
            ctx: inCtx,
            width: SNAP_W,
            height: SNAP_H,
            // The live DOM caption (PreviewStage.tsx) now stays visible throughout the
            // transition, so this snapshot must not bake its own copy of the body
            // caption underneath it — a size/position mismatch between the two was the
            // source of a visible "pop" at the transition's end. Headings and extra
            // overlays are unaffected by this flag.
            skipCaption: true,
            global: globalConfig,
          });
        } else {
          // Distinct sources (or non-video) — parallel is safe.
          const outgoingPromise = renderSegmentFrame({
            segment: outgoingSeg,
            asset: currentAsset,
            timeInSegment: outgoingTime,
            ctx: outCtx,
            width: SNAP_W,
            height: SNAP_H,
            // The live DOM caption (PreviewStage.tsx) now stays visible throughout the
            // transition, so this snapshot must not bake its own copy of the body
            // caption underneath it — a size/position mismatch between the two was the
            // source of a visible "pop" at the transition's end. Headings and extra
            // overlays are unaffected by this flag.
            skipCaption: true,
            global: globalConfig,
          });

          const incomingPromise = renderSegmentFrame({
            segment: incomingSeg,
            asset: nextAsset,
            timeInSegment: 0,
            ctx: inCtx,
            width: SNAP_W,
            height: SNAP_H,
            // The live DOM caption (PreviewStage.tsx) now stays visible throughout the
            // transition, so this snapshot must not bake its own copy of the body
            // caption underneath it — a size/position mismatch between the two was the
            // source of a visible "pop" at the transition's end. Headings and extra
            // overlays are unaffected by this flag.
            skipCaption: true,
            global: globalConfig,
          });

          await Promise.all([outgoingPromise, incomingPromise]);
        }

        if (mountedRef.current) {
          setSnapshots({ key, outgoing: outCanvas, incoming: inCanvas });
        }
      } catch (err) {
        console.warn('[useTransitionPreview] snapshot render failed:', err);
      } finally {
        if (pendingKeyRef.current === key) pendingKeyRef.current = '';
      }
    })();
  // outgoingSeg/incomingSeg effectAnimation are included so changing a clip
  // effect re-renders the snapshot — otherwise a cached snapshot keeps
  // showing the old (or absent) filter through the transition.
  // renderSegmentFrame bakes resolveClipEffectFilter into the snapshot, so a
  // fresh render is all that's needed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPreRoll, outgoingSeg?.id, incomingSeg?.id, effectiveTransition, outgoingSeg?.effectAnimation, incomingSeg?.effectAnimation]);

  // Clear stale snapshots when the boundary changes (e.g. user seeks back)
  useEffect(() => {
    if (!outgoingSeg || !incomingSeg) {
      setSnapshots(null);
      return;
    }
    const key = `${outgoingSeg.id}:${incomingSeg.id}`;
    setSnapshots(prev => (prev?.key === key ? prev : null));
  }, [outgoingSeg?.id, incomingSeg?.id]);

  // ---------------------------------------------------------------------------
  // Compose result
  // ---------------------------------------------------------------------------
  const snapshotsReady = snapshots !== null && snapshots.key === `${outgoingSeg?.id}:${incomingSeg?.id}`;
  const isActive = inTransitionWindow && snapshotsReady;

  return {
    isActive,
    progress,
    outgoing: snapshotsReady ? snapshots!.outgoing : null,
    incoming: snapshotsReady ? snapshots!.incoming : null,
    effectiveTransition,
  };
}
