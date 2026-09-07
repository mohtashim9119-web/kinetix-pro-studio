/**
 * THROWAWAY — Round 4 Part 2: five-variant failure quantity table.
 */

import { isTauri, TauriFfmpeg } from '../../services/tauriFfmpeg';
import {
  exportProjectWebCodecs,
  lastWebCodecsRunDiagnostics,
  type WebCodecsFfmpeg,
} from '../../services/webcodecsExport/exportPipelineWebCodecs';
import { demuxCacheSize } from '../../services/videoDemuxer';
import { setWebCodecsExportToggle } from '../../hooks/useExport';
import { persistLivenessReport } from './autorunFlag';
import {
  buildBisectVariants,
  type BisectVariant,
} from './runCeilingBisect';
import { generateGlWatchdogFixture } from './generateGlWatchdogFixture';
import type { Project } from '../../types';

export interface VariantQuantityRow {
  variant: BisectVariant;
  resultOk: boolean;
  framesEncoded: number | null;
  timelineSec: number | null;
  wallSec: number;
  failureVia: string | null;
  failureFrameIndex: number | null;
  encodedChunkBytes: number | null;
  encodedChunkCount: number | null;
  encodedKeyframeCount: number | null;
  appendCallCount: number | null;
  appendBytes: number | null;
  uniqueDemuxCount: number | null;
  decodedSourceFrames: number | null;
  decodersCreated: number | null;
  decodersOpen: number | null;
  cursorsCreated: number | null;
  openCursors: number | null;
  peakOpenCursors: number | null;
  openImageBitmaps: number | null;
  workerHeapBytes: number | null;
  terminalSilentInterval: { durationMs: number; phase: string | null } | null;
  /** 1-asset outlier fields */
  assetDurationSec: number | null;
  assetReuseCount: number | null;
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

async function readWorkspaceBytes(path: string): Promise<number | null> {
  try {
    const resp = await fetch(path);
    if (resp.ok) return (await resp.arrayBuffer()).byteLength;
  } catch {
    // fall through
  }
  return null;
}

export async function runVariantQuantities(variantIds?: string[]): Promise<VariantQuantityRow[]> {
  if (!isTauri()) return [];
  setWebCodecsExportToggle(true);
  const base = await generateGlWatchdogFixture();
  const variants = buildBisectVariants().filter((v) => !variantIds || variantIds.includes(v.id));
  const rows: VariantQuantityRow[] = [];

  for (const variant of variants) {
    const project = patchProject(base.project, variant);
    const savePath = `/tmp/ws3-bisect-${variant.id}.mp4`;
    const workspaceH264 = `/_spike/ws3-bisect-${variant.id}.h264`;
    const ffmpeg = await TauriFfmpeg.create();
    const t0 = performance.now();
    let resultOk = false;
    let framesEncoded: number | null = null;
    let failureVia: string | null = null;
    let failureFrameIndex: number | null = null;
    try {
      const result = await exportProjectWebCodecs(
        project,
        ffmpeg as unknown as WebCodecsFfmpeg,
        { fps: variant.fps, width: variant.width, height: variant.height, savePath },
        (stage) => {
          if (stage.type === 'encoding_segment') framesEncoded = stage.frame;
        },
      );
      resultOk = result.ok;
      if (!result.ok) {
        framesEncoded = result.error.liveness?.framesEncoded ?? framesEncoded;
      }
    } catch (e) {
      failureVia = e instanceof Error ? e.message : String(e);
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
    const terminal = gl?.silentIntervals.length
      ? gl.silentIntervals[gl.silentIntervals.length - 1]!
      : null;

    let assetDurationSec: number | null = null;
    let assetReuseCount: number | null = null;
    if (variant.id === '1-unique-video') {
      const sole = project.assets.find((a) => a.type === 'video');
      assetDurationSec = sole?.duration ?? null;
      assetReuseCount = project.segments.filter((s) => s.assetId === sole?.id).length;
    }

    const row: VariantQuantityRow = {
      variant,
      resultOk,
      framesEncoded,
      timelineSec: framesEncoded !== null ? framesEncoded / variant.fps : null,
      wallSec,
      failureVia,
      failureFrameIndex,
      encodedChunkBytes: gl?.encodedChunkBytes ?? null,
      encodedChunkCount: gl?.encodedChunkCount ?? null,
      encodedKeyframeCount: gl?.encodedKeyframeCount ?? null,
      appendCallCount: gl?.appendCallCount ?? null,
      appendBytes: gl?.appendBytes ?? null,
      uniqueDemuxCount: gl?.demuxCacheSize ?? demuxCacheSize(),
      decodedSourceFrames: gl?.decodedSourceFrames ?? null,
      decodersCreated: gl?.decodersCreated ?? null,
      decodersOpen: gl?.decodersOpen ?? null,
      cursorsCreated: gl?.cursorsCreated ?? null,
      openCursors: gl?.openCursors ?? null,
      peakOpenCursors: gl?.peakOpenCursors ?? null,
      openImageBitmaps: gl?.openImageBitmaps ?? null,
      workerHeapBytes: gl?.workerHeapBytes ?? null,
      terminalSilentInterval: terminal
        ? { durationMs: terminal.durationMs, phase: terminal.phase }
        : null,
      assetDurationSec,
      assetReuseCount,
    };
    rows.push(row);
    persistLivenessReport(`quantities-${variant.id}`, row);
    void readWorkspaceBytes(workspaceH264);
  }
  persistLivenessReport('quantities-summary', rows);
  return rows;
}
