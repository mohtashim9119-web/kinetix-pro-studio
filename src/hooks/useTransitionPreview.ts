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

// [transition-debug] Toggle — set to true to enable verbose transition diagnostics.
const DEBUG_TRANSITION = true;

/** Snapshot resolution — 16:9 half-HD. Full resolution is unnecessary
 *  for preview-quality blending. */
const SNAP_W = 960;
const SNAP_H = 540;

/** How many seconds before the transition window to trigger the pre-roll.
 *  0.8s covers the worst-case parallel seek cost (~200ms per video) with a
 *  600ms safety margin. Same-asset sequential fallback costs ~400ms — still
 *  400ms of margin inside the 800ms window. */
const PRE_ROLL_LEAD_S = 0.8;

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
  /** The resolved transition type to apply. */
  effectiveTransition: TransitionType;
}

interface Params {
  segments: VideoSegment[];
  currentTime: number;
  assets: Asset[];
  globalTransition: TransitionType;
  globalTransitionDuration: number;
  globalConfig: FrameGlobalConfig;
}

export function useTransitionPreview({
  segments,
  currentTime,
  assets,
  globalTransition,
  globalTransitionDuration,
  globalConfig,
}: Params): TransitionPreviewInfo {
  const [snapshots, setSnapshots] = useState<SnapshotPair | null>(null);
  // Prevent concurrent or duplicate snapshot renders
  const pendingKeyRef = useRef<string>('');
  // Guard against setState after unmount (async renderSegmentFrame can outlive the component)
  const mountedRef = useRef<boolean>(true);
  // [transition-debug] track isActive transitions
  const prevIsActiveRef = useRef<boolean>(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ---------------------------------------------------------------------------
  // Derive relevant segments + transition metadata
  // ---------------------------------------------------------------------------
  const currentSeg = segments.find(
    s => currentTime >= s.startTime && currentTime < s.startTime + s.duration,
  );
  // Next segment: sorted by startTime, first one that begins at or after the end of currentSeg.
  // Using order sort is more robust than relying on array position.
  const nextSeg = currentSeg
    ? [...segments]
        .sort((a, b) => a.startTime - b.startTime)
        .find(s => s.startTime >= currentSeg.startTime + currentSeg.duration - 0.001 && s.id !== currentSeg.id)
    : undefined;

  const effectiveTransition: TransitionType =
    currentSeg?.transition && currentSeg.transition !== TransitionType.NONE
      ? currentSeg.transition
      : (globalTransition ?? TransitionType.NONE);

  const transitionDuration =
    effectiveTransition !== TransitionType.NONE
      ? (currentSeg?.transitionDuration ?? globalTransitionDuration)
      : 0;

  const transitionStart = nextSeg ? nextSeg.startTime - transitionDuration : Infinity;
  const transitionEnd = nextSeg ? nextSeg.startTime : Infinity;

  const inTransitionWindow =
    nextSeg !== undefined &&
    effectiveTransition !== TransitionType.NONE &&
    transitionDuration > 0 &&
    currentTime >= transitionStart &&
    currentTime < transitionEnd;

  const progress = inTransitionWindow
    ? Math.max(0, Math.min(1, (currentTime - transitionStart) / transitionDuration))
    : 0;

  // ---------------------------------------------------------------------------
  // Pre-roll: render snapshots once when approaching the transition window
  // ---------------------------------------------------------------------------
  const needsPreRoll =
    nextSeg !== undefined &&
    effectiveTransition !== TransitionType.NONE &&
    transitionDuration > 0 &&
    currentTime >= transitionStart - PRE_ROLL_LEAD_S &&
    currentTime < transitionEnd;

  useEffect(() => {
    if (DEBUG_TRANSITION) {
      console.log(
        `[transition-debug] pre-roll effect fired` +
        ` | needsPreRoll=${needsPreRoll}` +
        ` | currentSeg=${currentSeg?.id ?? 'none'}` +
        ` | nextSeg=${nextSeg?.id ?? 'none'}` +
        ` | currentTime=${currentTime.toFixed(3)}` +
        ` | transitionStart=${transitionStart === Infinity ? '∞' : transitionStart.toFixed(3)}` +
        ` | effectiveTransition=${effectiveTransition}`,
      );
    }
    if (!needsPreRoll || !currentSeg || !nextSeg) {
      if (DEBUG_TRANSITION) console.log(`[transition-debug] pre-roll early-return: needsPreRoll=${needsPreRoll} currentSeg=${!!currentSeg} nextSeg=${!!nextSeg}`);
      return;
    }

    const key = `${currentSeg.id}:${nextSeg.id}`;
    // Already have this snapshot pair or render is in flight
    if (snapshots?.key === key || pendingKeyRef.current === key) {
      if (DEBUG_TRANSITION) console.log(`[transition-debug] pre-roll skipped (already have/pending): snapshotsKey=${snapshots?.key ?? 'null'} pendingKey=${pendingKeyRef.current} wantedKey=${key}`);
      return;
    }

    if (DEBUG_TRANSITION) console.log(`[transition-debug] pre-roll starting render for key=${key}`);
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

    const currentAsset = assets.find(a => a.id === currentSeg.assetId);
    const nextAsset = assets.find(a => a.id === nextSeg.assetId);
    // Render the outgoing frame at the moment the transition window begins
    const outgoingTime = Math.max(0, transitionStart - currentSeg.startTime);

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

        const t0 = performance.now();

        if (sharesAsset) {
          // Same video element — seek sequentially to avoid race.
          const tOut0 = performance.now();
          await renderSegmentFrame({
            segment: currentSeg,
            asset: currentAsset,
            timeInSegment: outgoingTime,
            ctx: outCtx,
            width: SNAP_W,
            height: SNAP_H,
            global: globalConfig,
          });
          const tOut1 = performance.now();
          if (DEBUG_TRANSITION) console.log(`[transition-debug] outgoing frame (sequential) took ${(tOut1 - tOut0).toFixed(1)}ms | key=${key}`);

          const tIn0 = performance.now();
          await renderSegmentFrame({
            segment: nextSeg,
            asset: nextAsset,
            timeInSegment: 0,
            ctx: inCtx,
            width: SNAP_W,
            height: SNAP_H,
            global: globalConfig,
          });
          const tIn1 = performance.now();
          if (DEBUG_TRANSITION) console.log(`[transition-debug] incoming frame (sequential) took ${(tIn1 - tIn0).toFixed(1)}ms | key=${key}`);
        } else {
          // Distinct sources (or non-video) — parallel is safe.
          const tOut0 = performance.now();
          const outgoingPromise = renderSegmentFrame({
            segment: currentSeg,
            asset: currentAsset,
            timeInSegment: outgoingTime,
            ctx: outCtx,
            width: SNAP_W,
            height: SNAP_H,
            global: globalConfig,
          }).then(r => {
            if (DEBUG_TRANSITION) console.log(`[transition-debug] outgoing frame (parallel) took ${(performance.now() - tOut0).toFixed(1)}ms | key=${key}`);
            return r;
          });

          const tIn0 = performance.now();
          const incomingPromise = renderSegmentFrame({
            segment: nextSeg,
            asset: nextAsset,
            timeInSegment: 0,
            ctx: inCtx,
            width: SNAP_W,
            height: SNAP_H,
            global: globalConfig,
          }).then(r => {
            if (DEBUG_TRANSITION) console.log(`[transition-debug] incoming frame (parallel) took ${(performance.now() - tIn0).toFixed(1)}ms | key=${key}`);
            return r;
          });

          await Promise.all([outgoingPromise, incomingPromise]);
        }

        const totalMs = (performance.now() - t0).toFixed(1);
        if (DEBUG_TRANSITION) console.log(`[transition-debug] snapshot render took ${totalMs}ms | key=${key} | path=${sharesAsset ? 'sequential' : 'parallel'}`);

        if (mountedRef.current) {
          if (DEBUG_TRANSITION) console.log(`[transition-debug] snapshots ready — calling setSnapshots for key=${key}`);
          setSnapshots({ key, outgoing: outCanvas, incoming: inCanvas });
        } else {
          if (DEBUG_TRANSITION) console.log(`[transition-debug] snapshots ready but component unmounted — discarding key=${key}`);
        }
      } catch (err) {
        console.warn('[useTransitionPreview] snapshot render failed:', err);
      } finally {
        if (pendingKeyRef.current === key) pendingKeyRef.current = '';
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPreRoll, currentSeg?.id, nextSeg?.id, effectiveTransition]);

  // Clear stale snapshots when the boundary changes (e.g. user seeks back)
  useEffect(() => {
    if (!currentSeg || !nextSeg) {
      setSnapshots(null);
      return;
    }
    const key = `${currentSeg.id}:${nextSeg.id}`;
    setSnapshots(prev => (prev?.key === key ? prev : null));
  }, [currentSeg?.id, nextSeg?.id]);

  // ---------------------------------------------------------------------------
  // Compose result
  // ---------------------------------------------------------------------------
  const snapshotsReady = snapshots !== null && snapshots.key === `${currentSeg?.id}:${nextSeg?.id}`;
  const isActive = inTransitionWindow && snapshotsReady;

  // Debug log reads prevIsActiveRef.current (the OLD value) before the write below.
  if (DEBUG_TRANSITION && isActive !== prevIsActiveRef.current) {
    console.log(
      `[transition-debug] isActive changed: ${prevIsActiveRef.current} → ${isActive}` +
      ` | currentTime=${currentTime.toFixed(3)}` +
      ` | inTransitionWindow=${inTransitionWindow}` +
      ` | snapshotsReady=${snapshotsReady}` +
      ` | snapshotsKey=${snapshots?.key ?? 'null'}` +
      ` | wantedKey=${currentSeg?.id}:${nextSeg?.id}`,
    );
  }

  // Single unconditional write — used only by the [transition-debug] log above.
  prevIsActiveRef.current = isActive;

  return {
    isActive,
    progress,
    outgoing: snapshotsReady ? snapshots!.outgoing : null,
    incoming: snapshotsReady ? snapshots!.incoming : null,
    effectiveTransition,
  };
}
