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

/** Snapshot resolution — 16:9 half-HD. Full resolution is unnecessary
 *  for preview-quality blending. */
const SNAP_W = 960;
const SNAP_H = 540;

/** How many seconds before the transition window to trigger the pre-roll. */
const PRE_ROLL_LEAD_S = 0.4;

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

  // ---------------------------------------------------------------------------
  // Derive relevant segments + transition metadata
  // ---------------------------------------------------------------------------
  const currentSeg = segments.find(
    s => currentTime >= s.startTime && currentTime < s.startTime + s.duration,
  );
  // Next segment in timeline order (first segment whose startTime > currentSeg.startTime)
  const nextSeg = currentSeg
    ? segments.find(s => s.startTime >= currentSeg.startTime + currentSeg.duration - 0.001)
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
    if (!needsPreRoll || !currentSeg || !nextSeg) return;

    const key = `${currentSeg.id}:${nextSeg.id}`;
    // Already have this snapshot pair or render is in flight
    if (snapshots?.key === key || pendingKeyRef.current === key) return;

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
        await renderSegmentFrame({
          segment: currentSeg,
          asset: currentAsset,
          timeInSegment: outgoingTime,
          ctx: outCtx,
          width: SNAP_W,
          height: SNAP_H,
          global: globalConfig,
        });
        await renderSegmentFrame({
          segment: nextSeg,
          asset: nextAsset,
          timeInSegment: 0, // first frame of incoming segment
          ctx: inCtx,
          width: SNAP_W,
          height: SNAP_H,
          global: globalConfig,
        });
        setSnapshots({ key, outgoing: outCanvas, incoming: inCanvas });
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

  return {
    isActive: inTransitionWindow && snapshotsReady,
    progress,
    outgoing: snapshotsReady ? snapshots!.outgoing : null,
    incoming: snapshotsReady ? snapshots!.incoming : null,
    effectiveTransition,
  };
}
