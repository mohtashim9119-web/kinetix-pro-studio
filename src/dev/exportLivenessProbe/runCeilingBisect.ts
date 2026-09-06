/**
 * THROWAWAY — Round 3 ceiling bisect variants. Dev-only.
 */

import { isTauri, TauriFfmpeg } from '../../services/tauriFfmpeg';
import {
  exportProjectWebCodecs,
  lastWebCodecsRunDiagnostics,
  type WebCodecsFfmpeg,
} from '../../services/webcodecsExport/exportPipelineWebCodecs';
import { setWebCodecsExportToggle } from '../../hooks/useExport';
import {
  generateGlWatchdogFixture,
  FIXTURE_FPS,
  FIXTURE_SEGMENT_COUNT,
  FIXTURE_SEG_DURATION_SEC,
} from './generateGlWatchdogFixture';
import { persistLivenessReport } from './autorunFlag';
import type { Project } from '../../types';

export interface BisectVariant {
  id: string;
  fps: number;
  width: number;
  height: number;
  segmentCount: number;
  uniqueVideoAssets: number;
  timelineDurationSec: number;
  expectedFrames: number;
}

export interface BisectRunResult {
  variant: BisectVariant;
  resultOk: boolean;
  framesEncoded: number | null;
  timelineSec: number | null;
  wallSec: number;
  bytesWritten: number | null;
  errorMessage: string | null;
  failureVia: string | null;
  failureFrameIndex: number | null;
  maxSilentMs: number | null;
  silentIntervalsAbove5s: { durationMs: number; phase: string | null; framesAtStart: number }[];
}

function patchProject(project: Project, variant: BisectVariant): Project {
  const segDur = variant.timelineDurationSec / variant.segmentCount;
  const segments = project.segments.slice(0, variant.segmentCount).map((s, i) => ({
    ...s,
    startTime: i * segDur,
    duration: segDur,
    trimEnd: Math.min(segDur, s.trimEnd ?? segDur),
  }));
  const videoAssets = project.assets.filter((a) => a.type === 'video');
  const pick = (i: number) => videoAssets[i % Math.min(variant.uniqueVideoAssets, videoAssets.length)]!;
  return {
    ...project,
    segments: segments.map((s, i) => ({ ...s, assetId: pick(i).id })),
  };
}

export function buildBisectVariants(): BisectVariant[] {
  const baselineTimeline = FIXTURE_SEGMENT_COUNT * FIXTURE_SEG_DURATION_SEC;
  const baselineFrames = Math.round(baselineTimeline * FIXTURE_FPS);
  return [
    {
      id: 'baseline-30fps-1080p-4assets',
      fps: FIXTURE_FPS,
      width: 1920,
      height: 1080,
      segmentCount: FIXTURE_SEGMENT_COUNT,
      uniqueVideoAssets: 4,
      timelineDurationSec: baselineTimeline,
      expectedFrames: baselineFrames,
    },
    {
      id: '15fps-same-timeline',
      fps: 15,
      width: 1920,
      height: 1080,
      segmentCount: FIXTURE_SEGMENT_COUNT,
      uniqueVideoAssets: 4,
      timelineDurationSec: baselineTimeline,
      expectedFrames: Math.round(baselineTimeline * 15),
    },
    {
      id: '720p-30fps',
      fps: FIXTURE_FPS,
      width: 1280,
      height: 720,
      segmentCount: FIXTURE_SEGMENT_COUNT,
      uniqueVideoAssets: 4,
      timelineDurationSec: baselineTimeline,
      expectedFrames: baselineFrames,
    },
    {
      id: 'longer-timeline-same-frames',
      fps: 15,
      width: 1920,
      height: 1080,
      segmentCount: FIXTURE_SEGMENT_COUNT,
      uniqueVideoAssets: 4,
      timelineDurationSec: baselineTimeline * 2,
      expectedFrames: baselineFrames,
    },
    {
      id: '1-unique-video',
      fps: FIXTURE_FPS,
      width: 1920,
      height: 1080,
      segmentCount: FIXTURE_SEGMENT_COUNT,
      uniqueVideoAssets: 1,
      timelineDurationSec: baselineTimeline,
      expectedFrames: baselineFrames,
    },
  ];
}

async function readBytesWritten(path: string): Promise<number | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const stat = await invoke<{ size: number }>('plugin:fs|stat', { path }).catch(() => null);
    if (stat && typeof stat.size === 'number') return stat.size;
  } catch {
    // fall through
  }
  try {
    const resp = await fetch(`file://${path}`);
    if (resp.ok) return (await resp.arrayBuffer()).byteLength;
  } catch {
    // unavailable
  }
  return null;
}

export async function runCeilingBisect(variantIds?: string[]): Promise<BisectRunResult[]> {
  if (!isTauri()) return [];
  setWebCodecsExportToggle(true);
  const base = await generateGlWatchdogFixture();
  const variants = buildBisectVariants().filter((v) => !variantIds || variantIds.includes(v.id));
  const results: BisectRunResult[] = [];

  for (const variant of variants) {
    const project = patchProject(base.project, variant);
    const savePath = `/tmp/ws3-bisect-${variant.id}.mp4`;
    const ffmpeg = await TauriFfmpeg.create();
    const t0 = performance.now();
    let resultOk = false;
    let errorMessage: string | null = null;
    let framesEncoded: number | null = null;
    let failureVia: string | null = null;
    let failureFrameIndex: number | null = null;
    let maxSilentMs: number | null = null;
    let silentIntervalsAbove5s: BisectRunResult['silentIntervalsAbove5s'] = [];
    let lastFrame = 0;
    try {
      const result = await exportProjectWebCodecs(
        project,
        ffmpeg as unknown as WebCodecsFfmpeg,
        { fps: variant.fps, width: variant.width, height: variant.height, savePath },
        (stage) => {
          if (stage.type === 'encoding_segment') lastFrame = stage.frame;
        },
      );
      resultOk = result.ok;
      framesEncoded = lastFrame;
      if (!result.ok) {
        errorMessage = result.error.message;
        maxSilentMs = result.error.liveness?.maxSilentMs ?? null;
        framesEncoded = result.error.liveness?.framesEncoded ?? lastFrame;
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      try { await ffmpeg.kill(); } catch { /* */ }
      try { await ffmpeg.destroy(); } catch { /* */ }
    }
    const wallSec = (performance.now() - t0) / 1000;
    const gl = lastWebCodecsRunDiagnostics?.glPieces[0];
    if (gl?.failure) {
      failureVia = gl.failure.via;
      failureFrameIndex = gl.failure.frameIndex;
    }
    if (gl) {
      maxSilentMs = gl.maxSilentMs;
      silentIntervalsAbove5s = gl.silentIntervals
        .filter((s) => s.durationMs >= 5000)
        .map((s) => ({ durationMs: s.durationMs, phase: s.phase, framesAtStart: s.framesEncodedAtStart }));
    }
    const bytesWritten = await readBytesWritten(savePath);
    const row: BisectRunResult = {
      variant,
      resultOk,
      framesEncoded,
      timelineSec: framesEncoded !== null ? framesEncoded / variant.fps : null,
      wallSec,
      bytesWritten,
      errorMessage,
      failureVia,
      failureFrameIndex,
      maxSilentMs,
      silentIntervalsAbove5s,
    };
    results.push(row);
    persistLivenessReport(`bisect-${variant.id}`, row);
  }
  persistLivenessReport('bisect-summary', results);
  return results;
}
