import { FFmpeg } from '@ffmpeg/ffmpeg';
import { VideoSegment, Asset } from '../types';
import { renderSegmentFrame, FrameGlobalConfig } from './frameRenderer';

export interface EncodeSegmentOptions {
  fps?: number;
  width?: number;
  height?: number;
  onProgress?: (framesWritten: number, totalFrames: number) => void;
}

/**
 * Encodes one segment to an in-memory MP4 (H.264 / yuv420p).
 *
 * Pipeline:
 *   1. Renders every frame to an offscreen canvas via renderSegmentFrame.
 *   2. Writes each frame as a PNG into ffmpeg's virtual FS.
 *   3. Runs `ffmpeg -framerate fps -i frame_%05d.png -c:v libx264 -pix_fmt yuv420p`.
 *   4. Reads the resulting MP4 bytes.
 *   5. Deletes all temporary FS files.
 *
 * @returns Raw MP4 bytes for the segment.
 */
export async function encodeSegment(
  segment: VideoSegment,
  asset: Asset | undefined,
  ffmpeg: FFmpeg,
  globalConfig: FrameGlobalConfig,
  options: EncodeSegmentOptions = {},
): Promise<Uint8Array> {
  const fps = options.fps ?? 30;
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;

  // Width and height must both be even for yuv420p
  const w = width % 2 === 0 ? width : width - 1;
  const h = height % 2 === 0 ? height : height - 1;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('segmentEncoder: failed to get 2D canvas context');

  const totalFrames = Math.max(1, Math.round(segment.duration * fps));
  const writtenFiles: string[] = [];

  // -------------------------------------------------------------------------
  // Render and write frames
  // -------------------------------------------------------------------------
  for (let i = 0; i < totalFrames; i++) {
    const timeInSegment = i / fps;

    await renderSegmentFrame({
      segment,
      asset,
      timeInSegment,
      ctx,
      width: w,
      height: h,
      global: globalConfig,
    });

    const pngBytes = await canvasToPng(canvas);
    const filename = `frame_${String(i + 1).padStart(5, '0')}.png`;
    await ffmpeg.writeFile(filename, pngBytes);
    writtenFiles.push(filename);

    options.onProgress?.(i + 1, totalFrames);
  }

  // -------------------------------------------------------------------------
  // Encode
  // -------------------------------------------------------------------------
  const outputFile = `seg_${segment.id}.mp4`;
  writtenFiles.push(outputFile);

  await ffmpeg.exec([
    '-framerate', String(fps),
    '-i', 'frame_%05d.png',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    outputFile,
  ]);

  // -------------------------------------------------------------------------
  // Read result and clean up FS
  // -------------------------------------------------------------------------
  const fileData = await ffmpeg.readFile(outputFile);
  const mp4Bytes =
    fileData instanceof Uint8Array
      ? fileData
      : new TextEncoder().encode(fileData as string);

  await cleanupFiles(ffmpeg, writtenFiles);

  return mp4Bytes;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) { reject(new Error('canvasToPng: toBlob returned null')); return; }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      'image/png',
    );
  });
}

async function cleanupFiles(ffmpeg: FFmpeg, files: string[]): Promise<void> {
  await Promise.allSettled(files.map(f => ffmpeg.deleteFile(f)));
}
