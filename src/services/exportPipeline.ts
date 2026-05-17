import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { Project, Asset } from '../types';
import { loadFFmpeg } from './ffmpegLoader';
import { encodeSegment } from './segmentEncoder';
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

/**
 * Full export pipeline:
 *   1. Load ffmpeg.wasm (cached after first call).
 *   2. Encode each segment to an intermediate MP4 (H.264).
 *   3. Write a concat manifest and run ffmpeg concat demuxer to join them.
 *   4. Mux in the voiceover audio (AAC) if present.
 *   5. Output a single MP4 blob.
 */
export async function exportProject(
  project: Project,
  options: ExportOptions = {},
  onProgress: ProgressCallback = () => undefined,
): Promise<Blob> {
  const fps = options.fps ?? 30;
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;

  const globalConfig: FrameGlobalConfig = {
    overlayConfig: project.globalOverlayConfig,
    hideAllText: project.hideAllText ?? false,
    globalOverlayFilter: project.globalOverlayFilter,
  };

  // ── 1. Load ffmpeg ─────────────────────────────────────────────────────────
  onProgress({ type: 'loading_ffmpeg' });
  const ffmpeg = await loadFFmpeg();

  const assetMap = new Map<string, Asset>(project.assets.map(a => [a.id, a]));
  const segments = project.segments;
  const segmentFiles: string[] = [];
  const allTempFiles: string[] = [];

  // ── 2. Encode each segment ──────────────────────────────────────────────────
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;
    const asset = segment.assetId ? assetMap.get(segment.assetId) : undefined;
    const nextSegment = segments[i + 1];
    const nextAsset = nextSegment?.assetId ? assetMap.get(nextSegment.assetId) : undefined;

    const segFile = `seg_out_${i}.mp4`;
    segmentFiles.push(segFile);
    allTempFiles.push(segFile);

    onProgress({
      type: 'encoding_segment',
      index: i,
      total: segments.length,
      frame: 0,
      totalFrames: Math.round(segment.duration * fps),
    });

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

    // Write encoded segment into ffmpeg FS under a stable name for concat
    await ffmpeg.writeFile(segFile, mp4Bytes);
  }

  // ── 3. Concatenate segments ────────────────────────────────────────────────
  onProgress({ type: 'muxing' });

  let finalVideoFile: string;

  if (segmentFiles.length === 1 && !project.voiceoverId) {
    // Single segment, no audio — just pass through
    finalVideoFile = segmentFiles[0]!;
  } else if (segmentFiles.length === 1) {
    finalVideoFile = segmentFiles[0]!;
  } else {
    // Build concat manifest
    const concatManifest = segmentFiles.map(f => `file '${f}'`).join('\n');
    const manifestFile = 'concat_list.txt';
    await ffmpeg.writeFile(manifestFile, concatManifest);
    allTempFiles.push(manifestFile);

    finalVideoFile = 'concat_video.mp4';
    allTempFiles.push(finalVideoFile);

    await ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', manifestFile,
      '-c', 'copy',
      '-y',
      finalVideoFile,
    ]);
  }

  // ── 4. Mux voiceover audio ──────────────────────────────────────────────────
  const outputFile = 'export_final.mp4';
  allTempFiles.push(outputFile);

  const voiceoverAsset = project.voiceoverId ? assetMap.get(project.voiceoverId) : undefined;

  if (voiceoverAsset?.url) {
    const audioFile = 'voiceover_audio';
    allTempFiles.push(audioFile);

    // Fetch the blob URL into ffmpeg FS
    const audioBytes = await fetchFile(voiceoverAsset.url);
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
    // No voiceover — just copy video to output
    await ffmpeg.exec([
      '-i', finalVideoFile,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      outputFile,
    ]);
  }

  // ── 5. Read output and clean up ──────────────────────────────────────────────
  const fileData = await ffmpeg.readFile(outputFile);
  const mp4Bytes =
    fileData instanceof Uint8Array
      ? fileData
      : new TextEncoder().encode(fileData as string);

  await Promise.allSettled(allTempFiles.map(f => ffmpeg.deleteFile(f)));

  const blob = new Blob([mp4Bytes], { type: 'video/mp4' });
  onProgress({ type: 'done', bytes: mp4Bytes });
  return blob;
}
