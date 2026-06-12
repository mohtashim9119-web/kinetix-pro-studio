import { Project, Asset, VideoSegment, TransitionType } from '../types';
import { encodeSegment, FfmpegLike } from './segmentEncoder';
import { FrameGlobalConfig } from './frameRenderer';

export interface ExportOptions {
  width?: number;
  height?: number;
  fps?: number;
}

export type ExportStage =
  | { type: 'loading_ffmpeg' }
  | { type: 'encoding_segment'; index: number; total: number; frame: number; totalFrames: number }
  | { type: 'muxing' }
  | { type: 'done'; bytes: Uint8Array };

export type ProgressCallback = (stage: ExportStage) => void;

export type ExportErrorKind =
  | 'ffmpeg_load'
  | 'encode'
  | 'concat'
  | 'mux'
  | 'asset_missing'
  | 'cancelled'
  | 'unknown';

export interface ExportError {
  kind: ExportErrorKind;
  message: string;
  segmentIndex?: number;
  cause?: string;
}

export type ExportResult =
  | { ok: true; blob: Blob }
  | { ok: false; error: ExportError };

function causeString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resolves the effective outgoing transition duration for `segment` into
 * `next`. Returns 0 when there is no next segment, when the effective
 * transition is NONE, or when the resolved duration is 0/undefined.
 * Mirrors the precedence logic in segmentEncoder.ts (per-segment first,
 * global fallback when segment.transition is NONE).
 */
function effectiveTransitionOut(
  segment: VideoSegment,
  next: VideoSegment | undefined,
  globalTransition: TransitionType,
  globalTransitionDuration: number,
): number {
  if (!next) return 0;
  const effTrans =
    segment.transition && segment.transition !== TransitionType.NONE
      ? segment.transition
      : globalTransition;
  if (effTrans === TransitionType.NONE) return 0;
  return segment.transitionDuration ?? globalTransitionDuration;
}

/**
 * Full export pipeline:
 *   1. Accepts a pre-loaded FfmpegLike instance (direct FFmpeg or Comlink worker proxy).
 *   2. Encode each segment to an intermediate MP4 (H.264).
 *   3. Write a concat manifest and run ffmpeg concat demuxer to join them.
 *   4. Mux in the voiceover audio (AAC) if present.
 *   5. Output a single MP4 blob.
 *
 * Returns ExportResult — never throws. All stage failures are mapped to typed errors.
 */
export async function exportProject(
  project: Project,
  ffmpeg: FfmpegLike,
  options: ExportOptions = {},
  onProgress: ProgressCallback = () => undefined,
): Promise<ExportResult> {
  const fps = options.fps ?? 30;
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;

  const globalConfig: FrameGlobalConfig = {
    overlayConfig: project.globalOverlayConfig,
    hideAllText: project.hideAllText ?? false,
    globalOverlayFilter: project.globalOverlayFilter,
    globalTextLayers: project.textLayers ?? [],
  };

  const assetMap = new Map<string, Asset>(project.assets.map(a => [a.id, a]));
  const segments = project.segments;
  const segmentFiles: string[] = [];
  const allTempFiles: string[] = [];

  // ── 1. Encode each segment ──────────────────────────────────────────────────
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    // Treat assetId=undefined the same as a defined-but-missing asset —
    // both mean no visual content is available for this segment.
    const asset = segment.assetId ? assetMap.get(segment.assetId) : undefined;
    if (segment.assetId && !asset?.url) {
      return { ok: false, error: { kind: 'asset_missing',
        message: `Segment "${segment.heading || segment.id}" has no asset` } };
    }
    if (!segment.assetId) {
      // No asset assigned — encode black frames with text overlays only.
      // This is intentional fallback behavior, not an error.
      // Log so the user can diagnose if unexpected.
      console.warn(
        `[exportPipeline] Segment "${segment.heading || segment.id}" ` +
        `(id: ${segment.id}) has no assetId — encoding black frames.`
      );
    }
    const nextSegment = segments[i + 1];
    const nextAsset = nextSegment?.assetId ? assetMap.get(nextSegment.assetId) : undefined;
    const prevSegment = segments[i - 1];
    const startTimeOffset = prevSegment
      ? effectiveTransitionOut(prevSegment, segment, project.globalTransition, project.globalTransitionDuration)
      : 0;
    const trailingExtension = effectiveTransitionOut(
      segment, nextSegment, project.globalTransition, project.globalTransitionDuration,
    );

    const segFile = `seg_out_${i}.mp4`;
    segmentFiles.push(segFile);
    allTempFiles.push(segFile);

    const segmentFrameCount = Math.max(
      1,
      Math.round((segment.duration - startTimeOffset + trailingExtension) * fps),
    );
    onProgress({
      type: 'encoding_segment',
      index: i,
      total: segments.length,
      frame: 0,
      totalFrames: segmentFrameCount,
    });

    try {
      const mp4Bytes = await encodeSegment(
        segment,
        asset,
        ffmpeg,
        globalConfig,
        {
          fps,
          width,
          height,
          nextSegment,
          nextAsset,
          globalTransitionDuration: project.globalTransitionDuration,
          globalTransition: project.globalTransition,
          startTimeOffset,
          trailingExtension,
          onProgress: (frame, totalFrames) => {
            onProgress({
              type: 'encoding_segment',
              index: i,
              total: segments.length,
              frame,
              totalFrames,
            });
          },
        },
      );
      await ffmpeg.writeFile(segFile, mp4Bytes);
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: 'encode',
          message: `Failed to encode segment ${i + 1}.`,
          segmentIndex: i,
          cause: causeString(err),
        },
      };
    }
  }

  // ── 2. Concatenate segments ────────────────────────────────────────────────
  onProgress({ type: 'muxing' });

  let finalVideoFile: string;

  if (segmentFiles.length === 1) {
    finalVideoFile = segmentFiles[0]!;
  } else {
    const concatManifest = segmentFiles.map(f => `file '${f}'`).join('\n');
    const manifestFile = 'concat_list.txt';
    const manifestBytes = new TextEncoder().encode(concatManifest);
    allTempFiles.push(manifestFile);
    finalVideoFile = 'concat_video.mp4';
    allTempFiles.push(finalVideoFile);

    try {
      await ffmpeg.writeFile(manifestFile, manifestBytes);
      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', manifestFile,
        '-c', 'copy',
        '-y',
        finalVideoFile,
      ]);
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: 'concat',
          message: 'Failed to concatenate segments.',
          cause: causeString(err),
        },
      };
    }
  }

  // ── 3. Mux voiceover audio ──────────────────────────────────────────────────
  const outputFile = 'export_final.mp4';
  allTempFiles.push(outputFile);

  const voiceoverAsset = project.voiceoverId ? assetMap.get(project.voiceoverId) : undefined;

  try {
    if (voiceoverAsset?.url) {
      const audioFile = 'voiceover_audio';
      allTempFiles.push(audioFile);
      const audioResp = await fetch(voiceoverAsset.url);
      const audioBytes = new Uint8Array(await audioResp.arrayBuffer());
      await ffmpeg.writeFile(audioFile, audioBytes);
      await ffmpeg.exec([
        '-i', finalVideoFile,
        '-i', audioFile,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-movflags', '+faststart',
        '-y',
        outputFile,
      ]);
    } else {
      await ffmpeg.exec([
        '-i', finalVideoFile,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-y',
        outputFile,
      ]);
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'mux',
        message: 'Failed to mux audio into the final video.',
        cause: causeString(err),
      },
    };
  }

  // ── 4. Read output and clean up ──────────────────────────────────────────────
  let mp4Bytes: Uint8Array;
  try {
    const fileData = await ffmpeg.readFile(outputFile);
    mp4Bytes =
      fileData instanceof Uint8Array
        ? fileData
        : new TextEncoder().encode(fileData as string);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: 'Failed to read the exported file from the ffmpeg virtual filesystem.',
        cause: causeString(err),
      },
    };
  }

  await Promise.allSettled(allTempFiles.map(f => ffmpeg.deleteFile(f)));

  const blob = new Blob([mp4Bytes], { type: 'video/mp4' });
  onProgress({ type: 'done', bytes: mp4Bytes });
  return { ok: true, blob };
}
