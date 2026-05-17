import { FFmpeg } from '@ffmpeg/ffmpeg';
import { VideoSegment, Asset, TransitionType } from '../types';
import { renderSegmentFrame, FrameGlobalConfig } from './frameRenderer';

export interface EncodeSegmentOptions {
  fps?: number;
  width?: number;
  height?: number;
  /** The segment that follows this one, used for transition blending. */
  nextSegment?: VideoSegment;
  nextAsset?: Asset | undefined;
  /** Global transition duration fallback (seconds). */
  globalTransitionDuration?: number;
  onProgress?: (framesWritten: number, totalFrames: number) => void;
}

/**
 * Encodes one segment to an in-memory MP4 (H.264 / yuv420p).
 *
 * Pipeline:
 *   1. Renders every frame to an offscreen canvas via renderSegmentFrame.
 *      If nextSegment is provided and the segment has a non-NONE transition,
 *      frames in the last `transitionDuration` seconds are blended with the
 *      incoming segment's first frame.
 *   2. Writes each frame as frame_%05d.png into ffmpeg's virtual FS.
 *   3. Runs libx264 with fast preset, crf 23, yuv420p, faststart.
 *   4. Reads the resulting MP4 bytes and deletes all temp FS files.
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
  const globalTransitionDuration = options.globalTransitionDuration ?? 0.5;

  // Width and height must both be even for yuv420p
  const w = width % 2 === 0 ? width : width - 1;
  const h = height % 2 === 0 ? height : height - 1;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('segmentEncoder: failed to get 2D canvas context');

  // Separate canvas for rendering the adjacent (incoming) segment's frame
  // during transition blending. Created lazily only when needed.
  let blendCanvas: HTMLCanvasElement | null = null;
  let blendCtx: CanvasRenderingContext2D | null = null;

  const transition = segment.transition ?? TransitionType.NONE;
  const transitionDuration =
    transition !== TransitionType.NONE
      ? (segment.transitionDuration ?? globalTransitionDuration)
      : 0;
  const hasTransition = transition !== TransitionType.NONE && !!options.nextSegment && transitionDuration > 0;

  if (hasTransition) {
    blendCanvas = document.createElement('canvas');
    blendCanvas.width = w;
    blendCanvas.height = h;
    blendCtx = blendCanvas.getContext('2d');
  }

  const totalFrames = Math.max(1, Math.round(segment.duration * fps));
  const writtenFiles: string[] = [];

  // Surface ffmpeg's internal log to the browser console for diagnostics.
  const ffmpegLogHandler = ({ message }: { message: string }) => {
    console.debug('[ffmpeg]', message);
  };
  ffmpeg.on('log', ffmpegLogHandler);

  // -------------------------------------------------------------------------
  // Render and write frames
  // -------------------------------------------------------------------------
  for (let i = 0; i < totalFrames; i++) {
    const timeInSegment = i / fps;

    console.debug(
      `[encode] frame ${i + 1}/${totalFrames} time=${timeInSegment.toFixed(3)}s` +
      ` asset=${asset ? `${asset.type}:${asset.name}` : 'none'}`,
    );

    // Compute transition blend alpha for frames near the outgoing boundary
    let blendParams: import('./frameRenderer').TransitionBlendParams | undefined;
    if (hasTransition && blendCanvas && blendCtx && options.nextSegment) {
      const timeFromEnd = segment.duration - timeInSegment;
      if (timeFromEnd <= transitionDuration) {
        // alpha: 0 at start of transition zone → 1 at segment end
        const alpha = Math.max(0, Math.min(1, 1 - timeFromEnd / transitionDuration));
        // Incoming segment time: mirror of timeFromEnd into the start of next segment
        const nextTimeInSegment = transitionDuration - timeFromEnd;

        await renderSegmentFrame({
          segment: options.nextSegment,
          asset: options.nextAsset,
          timeInSegment: nextTimeInSegment,
          ctx: blendCtx,
          width: w,
          height: h,
          global: globalConfig,
        });

        blendParams = {
          adjacentCanvas: blendCanvas,
          alpha,
          type: transition,
        };
      }
    }

    await renderSegmentFrame({
      segment,
      asset,
      timeInSegment,
      ctx,
      width: w,
      height: h,
      global: globalConfig,
      transition: blendParams,
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
  ffmpeg.off('log', ffmpegLogHandler);

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
