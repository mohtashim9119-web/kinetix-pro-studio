/**
 * THROWAWAY — Round 6: 40s output-equivalence + post-fix ceiling runs.
 * Dev-only — not imported by production.
 */

import { isTauri, TauriFfmpeg } from '../../services/tauriFfmpeg';
import {
  exportProjectWebCodecs,
  lastWebCodecsRunDiagnostics,
  type WebCodecsFfmpeg,
} from '../../services/webcodecsExport/exportPipelineWebCodecs';
import { sha256Hex, type EncodedOutputDigest, type ChunkFingerprint } from '../../services/webcodecsExport/annexbChunkCompare';
import { setWebCodecsExportToggle } from '../../hooks/useExport';
import { persistLivenessReport } from './autorunFlag';
import { generateGlWatchdogFixture } from './generateGlWatchdogFixture';
import { buildBisectVariants } from './runCeilingBisect';
import { AnimationType, TransitionType, type Project, type VideoSegment } from '../../types';

export interface Round6ExportRow {
  id: string;
  resultOk: boolean;
  framesEncoded: number | null;
  timelineSec: number | null;
  wallSec: number;
  completed: boolean;
  peakOpenCursors: number | null;
  openCursors: number | null;
  cursorsCreated: number | null;
  longestSilent: { durationMs: number; phase: string | null } | null;
  failureVia: string | null;
  failureMessage: string | null;
  digest: EncodedOutputDigest | null;
}

function sliceProject(project: Project, segmentCount: number, timelineSec: number, fps = 30): Project {
  // Frame-grid alignment: i/fps must land inside some [start, start+duration).
  // `k * (timelineSec/segmentCount)` leaves IEEE holes (100×0.4s @ 30fps → 20
  // skipped ticks → concat 1180 vs 1200). Integer frame spans have zero holes.
  const framesPerSeg = Math.max(1, Math.round((timelineSec / segmentCount) * fps));
  const segDur = framesPerSeg / fps;
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
      startTime: (i * framesPerSeg) / fps,
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
  // Voiceover stays at the full 263-seg fixture length; a 40s/200s slice
  // then fails mux (-shortest against a much longer wav). Video-only remux
  // is enough for the annexb equivalence + ceiling gates.
  return { ...project, segments, voiceoverId: undefined };
}

function hashingFfmpeg(inner: TauriFfmpeg): { ffmpeg: WebCodecsFfmpeg; fingerprints: ChunkFingerprint[] } {
  const fingerprints: ChunkFingerprint[] = [];
  const orig = inner.appendFileRaw.bind(inner);
  inner.appendFileRaw = async (path: string, data: Uint8Array) => {
    // Hash the live buffer in place; keep only the hex digest — retaining every
    // annexb chunk pinned tens of MB and stalled appendFileRaw at ~1170 chunks.
    if (path.endsWith('.h264')) {
      fingerprints.push({
        index: fingerprints.length,
        sha256: await sha256Hex(data),
        byteLength: data.byteLength,
        timestamp: null,
      });
    }
    return orig(path, data);
  };
  return { ffmpeg: inner as unknown as WebCodecsFfmpeg, fingerprints };
}

async function runProductionExport(
  id: string,
  project: Project,
  opts: { fps: number; width: number; height: number; savePath: string },
  hashChunks: boolean,
): Promise<Round6ExportRow> {
  persistLivenessReport(`round6-${id}-start`, { t: Date.now(), fps: opts.fps, savePath: opts.savePath });
  const ffmpeg = await TauriFfmpeg.create();
  const { ffmpeg: wrapped, fingerprints } = hashingFfmpeg(ffmpeg);
  const t0 = performance.now();
  let framesEncoded: number | null = null;
  let resultOk = false;
  let failureMessage: string | null = null;
  try {
    const result = await exportProjectWebCodecs(project, wrapped, opts, (stage) => {
      if (stage.type === 'encoding_segment') {
        framesEncoded = stage.frame;
        if (stage.frame > 0 && stage.frame % 150 === 0) {
          persistLivenessReport(`round6-${id}-progress`, {
            framesEncoded: stage.frame,
            timelineSec: stage.frame / opts.fps,
          });
        }
      }
    });
    resultOk = result.ok;
    if (!result.ok) {
      failureMessage = [result.error.message, result.error.cause].filter(Boolean).join(' | ');
      framesEncoded = result.error.liveness?.framesEncoded ?? framesEncoded;
    }
  } catch (e) {
    failureMessage = e instanceof Error ? e.message : String(e);
  } finally {
    try { await ffmpeg.kill(); } catch { /* */ }
    try { await ffmpeg.destroy(); } catch { /* */ }
  }
  const wallSec = (performance.now() - t0) / 1000;
  const gl = lastWebCodecsRunDiagnostics?.glPieces[0];
  const terminal = gl?.silentIntervals.length ? gl.silentIntervals[gl.silentIntervals.length - 1]! : null;
  const longest = (gl?.silentIntervals ?? []).reduce<{ durationMs: number; phase: string | null } | null>((acc, s) => {
    if (!acc || s.durationMs > acc.durationMs) return { durationMs: s.durationMs, phase: s.phase };
    return acc;
  }, terminal ? { durationMs: terminal.durationMs, phase: terminal.phase } : null);

  persistLivenessReport(`round6-${id}-export-returned`, {
    resultOk,
    framesEncoded: gl?.framesEncoded ?? framesEncoded,
    peakOpenCursors: gl?.peakOpenCursors ?? null,
    failureVia: gl?.failure?.via ?? null,
    failureMessage: (gl?.failure?.message ?? failureMessage)?.slice(0, 400) ?? null,
  });

  let digest: EncodedOutputDigest | null = null;
  if (hashChunks && fingerprints.length > 0) {
    const hexJoined = fingerprints.map((f) => f.sha256).join('');
    digest = {
      pieceSha256: await sha256Hex(new TextEncoder().encode(hexJoined)),
      chunkCount: gl?.encodedChunkCount ?? fingerprints.length,
      keyframeCount: gl?.encodedKeyframeCount ?? 0,
      encodedBytes: gl?.encodedChunkBytes ?? fingerprints.reduce((n, f) => n + f.byteLength, 0),
      chunks: [fingerprints[0]!, fingerprints[fingerprints.length - 1]!],
    };
    // Full per-chunk hex list for firstChunkMismatch — jsonl only, not the row.
    persistLivenessReport(`round6-${id}-chunk-hashes`, fingerprints.map((f) => f.sha256));
  }

  const row: Round6ExportRow = {
    id,
    resultOk,
    framesEncoded: gl?.framesEncoded ?? framesEncoded,
    timelineSec: (gl?.framesEncoded ?? framesEncoded ?? 0) / opts.fps,
    wallSec,
    completed: resultOk,
    peakOpenCursors: gl?.peakOpenCursors ?? null,
    openCursors: gl?.openCursors ?? null,
    cursorsCreated: gl?.cursorsCreated ?? null,
    longestSilent: longest,
    failureVia: gl?.failure?.via ?? null,
    failureMessage: gl?.failure ? gl.failure.message : failureMessage,
    digest,
  };
  persistLivenessReport(`round6-${id}`, row);
  return row;
}

export async function runRound6Equivalence40s(): Promise<Round6ExportRow> {
  setWebCodecsExportToggle(true);
  const base = await generateGlWatchdogFixture();
  const project = sliceProject(base.project, 100, 40);
  return runProductionExport(
    'equiv-40s-4assets',
    project,
    { fps: 30, width: 1920, height: 1080, savePath: '/tmp/ws3-r6-equiv-40s.mp4' },
    true,
  );
}

export async function runRound6CeilingSuite(): Promise<Round6ExportRow[]> {
  setWebCodecsExportToggle(true);
  const rows: Round6ExportRow[] = [];
  const base = await generateGlWatchdogFixture();
  const baseline = buildBisectVariants().find((v) => v.id === 'baseline-30fps-1080p-4assets')!;
  const unique = buildBisectVariants().find((v) => v.id === '1-unique-video')!;

  const baselineProject = sliceProject(base.project, baseline.segmentCount, baseline.timelineDurationSec);
  rows.push(await runProductionExport(
    baseline.id,
    baselineProject,
    { fps: baseline.fps, width: baseline.width, height: baseline.height, savePath: `/tmp/ws3-r6-${baseline.id}.mp4` },
    false,
  ));

  const long200 = sliceProject(base.project, 500, 200);
  rows.push(await runProductionExport(
    '200s-4assets',
    long200,
    { fps: 30, width: 1920, height: 1080, savePath: '/tmp/ws3-r6-200s-4assets.mp4' },
    false,
  ));

  const uniqueProject = sliceProject(base.project, unique.segmentCount, unique.timelineDurationSec);
  const sole = uniqueProject.assets.find((a) => a.type === 'video');
  const oneAsset = uniqueProject.segments.map((s) => ({ ...s, assetId: sole?.id ?? s.assetId }));
  rows.push(await runProductionExport(
    unique.id,
    { ...uniqueProject, segments: oneAsset },
    { fps: unique.fps, width: unique.width, height: unique.height, savePath: `/tmp/ws3-r6-${unique.id}.mp4` },
    false,
  ));

  persistLivenessReport('round6-ceiling-summary', rows);
  return rows;
}
