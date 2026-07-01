import { VideoSegment, Asset, TransitionType } from '../types';
import { renderSegmentFrame, FrameGlobalConfig } from './frameRenderer';
import { resolveEffectiveTransition } from './transitionResolver';

/**
 * Minimal ffmpeg FS/exec interface.  Both a direct `FFmpeg` instance and the
 * Comlink-proxied `FfmpegWorkerService` satisfy this contract.
 */
export interface FfmpegLike {
  writeFile(path: string, data: Uint8Array): Promise<boolean | void>;
  exec(args: string[]): Promise<number>;
  readFile(path: string): Promise<Uint8Array | string>;
  deleteFile(path: string): Promise<boolean | void>;
}

export interface EncodeSegmentOptions {
  fps?: number;
  width?: number;
  height?: number;
  /** The segment that follows this one, used for transition blending. */
  nextSegment?: VideoSegment;
  nextAsset?: Asset | undefined;
  /** Global transition duration fallback (seconds). */
  globalTransitionDuration?: number;
  /** Global transition type fallback — used when the segment's own transition is NONE. */
  globalTransition?: TransitionType;
  onProgress?: (framesWritten: number, totalFrames: number) => void;
  /** Seconds to skip at the start of this segment. Paid back by the previous
   *  segment's trailing transition overlap. Default 0. */
  startTimeOffset?: number;
  /** Seconds to encode past `segment.duration`. Equal to the outgoing transition
   *  duration when this segment transitions into a next one. Default 0. */
  trailingExtension?: number;
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
  ffmpeg: FfmpegLike,
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Separate canvas for rendering the adjacent (incoming) segment's frame
  // during transition blending. Created lazily only when needed.
  let blendCanvas: HTMLCanvasElement | null = null;
  let blendCtx: CanvasRenderingContext2D | null = null;

  const { transition: effectiveTransition, duration: transitionDuration } =
    resolveEffectiveTransition(segment, options.globalTransition, globalTransitionDuration);
  const hasTransition = effectiveTransition !== TransitionType.NONE && !!options.nextSegment && transitionDuration > 0;

  if (hasTransition) {
    blendCanvas = document.createElement('canvas');
    blendCanvas.width = w;
    blendCanvas.height = h;
    blendCtx = blendCanvas.getContext('2d');
    if (blendCtx) {
      blendCtx.imageSmoothingEnabled = true;
      blendCtx.imageSmoothingQuality = 'high';
    }
  }

  const startTimeOffset = options.startTimeOffset ?? 0;
  const trailingExtension = options.trailingExtension ?? 0;
  const encodeStart = startTimeOffset;
  const encodeEnd = segment.duration + trailingExtension;
  const encodeDuration = Math.max(0, encodeEnd - encodeStart);
  const totalFrames = Math.max(1, Math.round(encodeDuration * fps));
  const writtenFiles: string[] = [];

  // -------------------------------------------------------------------------
  // Render and write frames
  // -------------------------------------------------------------------------
  for (let i = 0; i < totalFrames; i++) {
    const timeInSegment = encodeStart + i / fps;

    if (import.meta.env.DEV) {
      console.debug(
        `[encode] frame ${i + 1}/${totalFrames} time=${timeInSegment.toFixed(3)}s` +
        ` (offset=${startTimeOffset.toFixed(3)} ext=${trailingExtension.toFixed(3)})` +
        ` asset=${asset ? `${asset.type}:${asset.name}` : 'none'}`,
      );
    }

    // Compute transition blend alpha for frames in the trailing extension window.
    // Path B: the outgoing segment extends trailingExtension seconds past segment.duration
    // into the fade window; the incoming segment is rendered with advancing timeInSegment
    // so it plays live during the blend. The next segment's encoder call skips its first
    // transitionDuration seconds via startTimeOffset, so no duplicate emission occurs.
    // In/out overlap contributions cancel pairwise: Σ encoded = Σ duration = voiceoverDuration.
    // Audio sync is preserved because total encoded duration is unchanged.
    let blendParams: import('./frameRenderer').TransitionBlendParams | undefined;
    if (hasTransition && blendCanvas && blendCtx && options.nextSegment) {
      if (timeInSegment >= segment.duration && timeInSegment < segment.duration + transitionDuration) {
        const timeIntoTransition = timeInSegment - segment.duration;
        const alpha = Math.max(0, Math.min(1, timeIntoTransition / transitionDuration));
        const nextTimeInSegment = timeIntoTransition;

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
          type: effectiveTransition,
        };
      }
    }

    // NOTE: for segments with a trailingExtension, the video element may be seeked
    // past trimStart + duration * playbackSpeed. The video element holds its last
    // decoded frame in that case, which is acceptable since the segment is being faded
    // out and visually replaced by the incoming side.
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
    '-crf', '16',
    '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
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

export interface EncodePlainVideoOptions {
  fps?: number;
  width?: number;
  height?: number;
}

/**
 * Tier-1 fast path: encodes a "plain" video segment (see isPlainVideoSegment in
 * plainSegment.ts) with a single ffmpeg trim+scale call, bypassing the per-frame
 * canvas/PNG/IPC pipeline entirely.
 *
 * The source video bytes are written into the ffmpeg session FS, then a single
 * exec trims [trimStart, trimStart+duration] and cover-fits to W×H via Lanczos.
 * Output flags are kept byte-for-byte compatible with the canvas path's segment
 * mp4s (libx264 / yuv420p / same W×H / bt709 color / forced fps / video-only)
 * so both can be joined by the concat demuxer with `-c copy`.
 *
 * Trim accuracy: input-side `-ss` with `-accurate_seek` is frame-accurate under
 * re-encode (the decoder discards up to the exact target frame) and far faster
 * than output-side seeking, which would decode from t=0.
 *
 * @returns Raw MP4 bytes for the segment (same contract as encodeSegment).
 */
export async function encodePlainVideoSegment(
  segment: VideoSegment,
  asset: Asset,
  ffmpeg: FfmpegLike,
  options: EncodePlainVideoOptions = {},
): Promise<Uint8Array> {
  const fps = options.fps ?? 30;
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;

  // Width and height must both be even for yuv420p — match the canvas path.
  const w = width % 2 === 0 ? width : width - 1;
  const h = height % 2 === 0 ? height : height - 1;

  const ext = safeVideoExt(asset.name);
  const srcFile = `tier1_src_${segment.id}.${ext}`;
  const outputFile = `tier1_out_${segment.id}.mp4`;

  // Pull the source bytes out of the blob URL and into the session FS so the
  // native ffmpeg process can read the file directly (same fetch→writeFile
  // pattern the audio-mux step uses in exportPipeline).
  const resp = await fetch(asset.url);
  const srcBytes = new Uint8Array(await resp.arrayBuffer());
  await ffmpeg.writeFile(srcFile, srcBytes);

  const trimStart = segment.trimStart ?? 0;
  const duration = segment.duration;

  // Cover-fit: scale up until both dims cover W×H (Lanczos), then centre-crop to
  // exactly W×H, then normalize SAR. Mirrors frameRenderer.ts drawImageCover.
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1`;

  await ffmpeg.exec([
    '-accurate_seek',
    '-ss', String(trimStart),
    '-i', srcFile,
    '-t', String(duration),
    '-vf', vf,
    '-r', String(fps),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '16',
    '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-movflags', '+faststart',
    '-y',
    outputFile,
  ]);

  const fileData = await ffmpeg.readFile(outputFile);
  const mp4Bytes =
    fileData instanceof Uint8Array
      ? fileData
      : new TextEncoder().encode(fileData as string);

  await cleanupFiles(ffmpeg, [srcFile, outputFile]);

  return mp4Bytes;
}

export interface EncodeStaticImageOptions {
  fps?: number;
  width?: number;
  height?: number;
}

/**
 * Tier-2 fast path: encodes a "plain" image segment (see isPlainImageSegment in
 * plainSegment.ts) by rendering ONE frame and looping it, instead of rendering,
 * PNG-encoding, and IPC-writing N byte-identical frames.
 *
 * For a plain image the media draw has no time dependence at all, so a single
 * renderSegmentFrame at t=0 reproduces exactly what the per-frame canvas loop
 * would emit for every frame. That one W×H PNG is written once, then a single
 * ffmpeg `-loop 1` encode synthesizes the segment's full duration.
 *
 * Output flags are kept byte-for-byte compatible with the canvas path's segment
 * mp4s (libx264 / preset fast / crf 16 / yuv420p / bt709 color / +faststart) so
 * all three paths (canvas, Tier-1 video, Tier-2 image) join under the concat
 * demuxer with `-c copy`. The single rendered frame is already exactly W×H with
 * square pixels, so — unlike the Tier-1 video path — no scale/crop/setsar filter
 * is needed. The frame count is capped with `-frames:v N` using the SAME
 * N = max(1, round(duration*fps)) the exportPipeline/canvas path computes, so
 * the segment's duration is frame-exact (preserves audio sync under -shortest).
 *
 * @returns Raw MP4 bytes for the segment (same contract as encodeSegment).
 */
export async function encodeStaticImageSegment(
  segment: VideoSegment,
  asset: Asset,
  globalConfig: FrameGlobalConfig,
  ffmpeg: FfmpegLike,
  options: EncodeStaticImageOptions = {},
): Promise<Uint8Array> {
  const fps = options.fps ?? 30;
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;

  // Width and height must both be even for yuv420p — match the canvas path.
  const w = width % 2 === 0 ? width : width - 1;
  const h = height % 2 === 0 ? height : height - 1;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('encodeStaticImageSegment: failed to get 2D canvas context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Render the single representative frame. A plain image segment has no
  // startTimeOffset/trailingExtension (no transition edge), so t=0 is the
  // exact frame the canvas loop would produce at every step.
  await renderSegmentFrame({
    segment,
    asset,
    timeInSegment: 0,
    ctx,
    width: w,
    height: h,
    global: globalConfig,
  });

  const pngBytes = await canvasToPng(canvas);
  const frameFile = `static_img_${segment.id}.png`;
  const outputFile = `static_out_${segment.id}.mp4`;
  await ffmpeg.writeFile(frameFile, pngBytes);

  // Frame-exact count: identical to segmentFrameCount in exportPipeline and to
  // the canvas path's totalFrames, so segment duration matches to the frame.
  const totalFrames = Math.max(1, Math.round(segment.duration * fps));

  await ffmpeg.exec([
    '-loop', '1',
    '-framerate', String(fps),
    '-i', frameFile,
    '-frames:v', String(totalFrames),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '16',
    '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-movflags', '+faststart',
    '-y',
    outputFile,
  ]);

  const fileData = await ffmpeg.readFile(outputFile);
  const mp4Bytes =
    fileData instanceof Uint8Array
      ? fileData
      : new TextEncoder().encode(fileData as string);

  await cleanupFiles(ffmpeg, [frameFile, outputFile]);

  return mp4Bytes;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives a safe, session-FS-legal file extension from an asset name.
 * validate_path (ffmpeg.rs) only permits [A-Za-z0-9_.-], so the extension is
 * lower-cased and sanity-checked; anything unusable falls back to 'mp4'.
 * ffmpeg probes input by content, so an imperfect extension is non-fatal.
 */
function safeVideoExt(name: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  const ext = m ? m[1]!.toLowerCase() : 'mp4';
  return /^[a-z0-9]+$/.test(ext) ? ext : 'mp4';
}

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

async function cleanupFiles(ffmpeg: FfmpegLike, files: string[]): Promise<void> {
  await Promise.allSettled(files.map(f => ffmpeg.deleteFile(f)));
}
