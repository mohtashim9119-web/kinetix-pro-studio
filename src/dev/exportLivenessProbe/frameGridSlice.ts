/**
 * THROWAWAY — frame-grid segment timing for WS3 liveness fixtures.
 * Ensures exportWorker playhead ticks (i/fps) always land inside a segment.
 */

import { AnimationType, TransitionType, type Project, type VideoSegment } from '../../types';

export function framesPerSegment(timelineSec: number, segmentCount: number, fps: number): number {
  return Math.max(1, Math.round((timelineSec / segmentCount) * fps));
}

/** Count run-local frame indices whose playhead falls outside every segment. */
export function countPlayheadGaps(segments: readonly VideoSegment[], fps: number): number {
  if (segments.length === 0) return 0;
  const runStart = segments[0]!.startTime;
  const last = segments[segments.length - 1]!;
  const total = Math.max(0, Math.round((last.startTime + last.duration - runStart) * fps));
  let gaps = 0;
  for (let i = 0; i < total; i++) {
    const t = runStart + i / fps;
    const inside = segments.some((s) => t >= s.startTime && t < s.startTime + s.duration);
    if (!inside) gaps++;
  }
  return gaps;
}

export function sliceProjectFrameGrid(
  project: Project,
  segmentCount: number,
  timelineSec: number,
  fps = 30,
): Project {
  const fpb = framesPerSegment(timelineSec, segmentCount, fps);
  const segDur = fpb / fps;
  const videoAssets = project.assets.filter((a) => a.type === 'video');
  const src = project.segments;
  const segments: VideoSegment[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const template = src[i % src.length]!;
    const video = videoAssets[i % videoAssets.length]!;
    segments.push({
      ...template,
      id: `r6-${i}`,
      assetId: video.id,
      startTime: (i * fpb) / fps,
      duration: segDur,
      order: i,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      trimStart: 0,
      trimEnd: Math.min(segDur, video.duration ?? segDur),
      text: `Caption ${i + 1}`,
      showOverlay: true,
    });
  }
  return { ...project, segments, voiceoverId: undefined };
}
