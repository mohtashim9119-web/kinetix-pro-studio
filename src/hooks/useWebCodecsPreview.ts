/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The replacement for the dual-slot <video> orchestration in PreviewStage.tsx
 * (Section 3.2 of docs/webcodecs-architecture-plan.md). Given segments,
 * assets, the active segment, and currentTime — read from the existing,
 * unmodified audio clock (usePlayback.ts) — returns the VideoFrame to paint
 * for the active segment's video.
 *
 * `currentSegment` is accepted directly rather than re-derived from
 * segments+currentTime: PreviewStage.tsx (and, above it, App.tsx) already
 * computes it via useMemo, including the isResizingRef freeze-during-drag
 * behavior (see App.tsx's currentSegment memo). Re-deriving it here with a
 * plain `find` would silently diverge from that during a timeline
 * resize-drag. This is a deliberate, documented deviation from the plan's
 * literal "given segments, assets, currentTime" phrasing — see the
 * WebCodecs progress tracker for the note.
 *
 * Phase 1 (single segment) + Phase 2 (multi-segment, decode-ahead, boundary
 * crossing) scope only: no transitions/overlays/filters/animations baked
 * into the frame here — that's Phase 5, applied by the caller on top of the
 * returned frame via PreviewCanvas.tsx.
 *
 * `enabled` gates ALL work in this hook, including decode session creation —
 * when false (dev toggle off, or capability unsupported), this hook must be
 * inert even though it's still mounted and called on every render, so the
 * new path never activates in the background for a real user.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset, VideoSegment } from '../types';
import { VideoDecoderPool } from '../services/videoDecoderPool';

interface UseWebCodecsPreviewParams {
  segments: VideoSegment[];
  assets: Asset[];
  currentSegment: VideoSegment | undefined;
  currentTime: number;
  enabled: boolean;
}

export interface UseWebCodecsPreviewResult {
  /** Frame to paint for the current segment's video, or null when the
   *  current segment isn't a plain video asset, or no frame is ready yet. */
  frame: VideoFrame | null;
  /** True when the current segment is a (non-heading) video asset — callers
   *  use this to decide whether to mount PreviewCanvas at all. */
  isVideoSegment: boolean;
  /** Non-fatal demux/decode error for the current segment's session, if any. */
  error: string | null;
}

/** Maps a segment-local playhead position to the source video's own time,
 *  honoring trimStart/trimEnd/playbackSpeed — mirrors the identical math in
 *  PreviewStage.tsx's legacy seek effect and frameRenderer.ts's export path,
 *  so the two video paths cannot diverge in what "the right frame" means. */
function toSourceTime(segment: VideoSegment, currentTime: number): number {
  const segmentProgress = currentTime - (segment.startTime ?? 0);
  const rawTime = (segment.trimStart || 0) + segmentProgress * (segment.playbackSpeed || 1);
  const videoTime = segment.trimEnd !== undefined ? Math.min(rawTime, segment.trimEnd) : rawTime;
  return Math.max(0, videoTime);
}

/** Source-time range [start, end] a segment's decode session must cover —
 *  end accounts for playbackSpeed the same way toSourceTime does, so a
 *  sped-up segment's session isn't truncated before its last displayed frame. */
function sourceRange(segment: VideoSegment): { start: number; end: number } {
  const start = segment.trimStart || 0;
  const speed = segment.playbackSpeed || 1;
  const end = segment.trimEnd ?? start + segment.duration * speed;
  return { start, end };
}

function isPlainVideoAsset(segment: VideoSegment | undefined, asset: Asset | undefined): boolean {
  return !!(segment && !segment.isHeading && asset?.type === 'video');
}

export function useWebCodecsPreview({
  segments,
  assets,
  currentSegment,
  currentTime,
  enabled,
}: UseWebCodecsPreviewParams): UseWebCodecsPreviewResult {
  const poolRef = useRef<VideoDecoderPool | null>(null);
  if (!poolRef.current) poolRef.current = new VideoDecoderPool();

  const [frame, setFrame] = useState<VideoFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped whenever a request is superseded before it resolves — same
  // race-guard shape as videoOpGenerationRef in PreviewStage.tsx.
  const generationRef = useRef(0);

  const currentAsset = currentSegment ? assets.find(a => a.id === currentSegment.assetId) : undefined;
  const isVideoSegment = isPlainVideoAsset(currentSegment, currentAsset);

  const nextSegment = useMemo(() => {
    if (!currentSegment) return undefined;
    const idx = segments.findIndex(s => s.id === currentSegment.id);
    return idx >= 0 ? segments[idx + 1] : undefined;
  }, [segments, currentSegment]);
  const nextAsset = nextSegment ? assets.find(a => a.id === nextSegment.assetId) : undefined;
  const nextIsVideo = isPlainVideoAsset(nextSegment, nextAsset);

  // Boundary crossing (Section 3.5): keep decode sessions for exactly the
  // current + next segment — stop pulling frames for the outgoing segment
  // the moment it's no longer either of those two. No `<video>` seeked-event
  // race and no readyState polling, because there's no <video> element in
  // this path at all.
  useEffect(() => {
    const pool = poolRef.current!;
    if (!enabled) {
      for (const id of pool.activeSegmentIds()) pool.releaseSession(id);
      return;
    }
    const keep = new Set<string>();
    if (currentSegment && isVideoSegment) keep.add(currentSegment.id);
    if (nextSegment && nextIsVideo) keep.add(nextSegment.id);
    for (const id of pool.activeSegmentIds()) {
      if (!keep.has(id)) pool.releaseSession(id);
    }
  }, [enabled, currentSegment, isVideoSegment, nextSegment, nextIsVideo]);

  // Decode-ahead (Phase 2, one segment ahead — the direct generalization of
  // the legacy dual <video>-slot ping-pong): ensure a session for the
  // current segment, and preemptively start one for the next segment so
  // it's already warm by the time playback crosses the boundary.
  useEffect(() => {
    if (!enabled) return;
    const pool = poolRef.current!;

    if (currentSegment && isVideoSegment && currentAsset) {
      const { start, end } = sourceRange(currentSegment);
      void pool.ensureSession(currentSegment.id, currentAsset.url, start, end).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    }
    if (nextSegment && nextIsVideo && nextAsset) {
      const { start, end } = sourceRange(nextSegment);
      // Decode-ahead failures for the *next* segment are non-fatal here —
      // when it becomes the current segment its own ensureSession call
      // above gets a fresh attempt and surfaces the error then.
      void pool.ensureSession(nextSegment.id, nextAsset.url, start, end).catch(() => {});
    }
  }, [enabled, currentSegment, isVideoSegment, currentAsset, nextSegment, nextIsVideo, nextAsset]);

  // Pull the frame for the current playhead position out of the (already
  // decode-ahead-warmed) current segment's session.
  useEffect(() => {
    if (!enabled || !currentSegment || !isVideoSegment || !currentAsset) {
      setFrame(null);
      return;
    }
    const generation = ++generationRef.current;
    const pool = poolRef.current!;
    const targetSec = toSourceTime(currentSegment, currentTime);
    void pool
      .getFrameAt(currentSegment.id, targetSec)
      .then((f) => {
        if (generationRef.current !== generation) return; // superseded
        setFrame(f);
        if (f) setError(null);
      })
      .catch((err) => {
        if (generationRef.current !== generation) return;
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [enabled, currentSegment, isVideoSegment, currentAsset, currentTime]);

  // Dispose the pool (closes every session and buffered VideoFrame) on unmount.
  useEffect(() => {
    return () => {
      poolRef.current?.dispose();
    };
  }, []);

  return { frame: enabled && isVideoSegment ? frame : null, isVideoSegment: enabled && isVideoSegment, error };
}
