import { VideoSegment, Asset, TransitionType } from '../types';
import { renderSegmentFrame, releaseBlendVideo, FrameGlobalConfig } from './frameRenderer';
import { resolveEffectiveTransition, resolveTransitionProgress } from './transitionResolver';

/**
 * Minimal ffmpeg FS/exec interface.  Both a direct `FFmpeg` instance and the
 * Comlink-proxied `FfmpegWorkerService` satisfy this contract.
 */
export interface FfmpegLike {
  writeFile(path: string, data: Uint8Array): Promise<boolean | void>;
  /**
   * Optional raw-binary write — same on-disk result as writeFile but sends the
   * bytes without a base64 round-trip (Tauri v2 raw invoke body). When present,
   * the per-frame export write uses it to shed the base64 encode/decode + string
   * IPC cost; when absent (any implementer that doesn't provide it), callers fall
   * back to writeFile with identical behavior.
   */
  writeFileRaw?(path: string, data: Uint8Array): Promise<boolean | void>;
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
   *  segment's trailing transition overlap — half the transition duration
   *  under the centered window (see resolveBlendFrameParams). Default 0. */
  startTimeOffset?: number;
  /** Seconds to encode past `segment.duration`. Half the outgoing transition
   *  duration when this segment transitions into a next one — the centered
   *  window's blend zone straddles the boundary, so only half of it extends
   *  past this segment's own nominal end (see resolveBlendFrameParams).
   *  Default 0. */
  trailingExtension?: number;
}

/**
 * Pure blend-window math for the outgoing segment's per-frame render loop —
 * the centered-window spec (docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20)'s transition-
 * centering entry; supersedes the old 100%-after-the-boundary placement, D7
 * in project-state.md's Ignored Low Risk Bugs) applied in SEGMENT-LOCAL time.
 *
 * The blend zone is `transitionDuration` seconds wide, centered on this
 * segment's own nominal end (`segmentDuration`): it opens at
 * `segmentDuration - transitionDuration/2` (still inside this segment's own
 * un-extended span) and closes at `segmentDuration + transitionDuration/2`
 * (the `trailingExtension` past nominal end — see EncodeSegmentOptions).
 * Returns null outside that zone.
 *
 * `alpha` is the outgoing→incoming blend factor via resolveTransitionProgress
 * (0 at zone open, 1 approached at zone close, exactly 0.5 at
 * `timeInSegment === segmentDuration` — the actual A/B boundary).
 *
 * `nextTimeInSegment` is how far into the INCOMING segment's own footage to
 * render for this frame: held at 0 (its own true start) for the entire
 * pre-boundary half, then advances forward from 0 for the post-boundary
 * half — so the incoming clip is never asked to seek before its own official
 * start (no source "handle" past trimStart is required). This matches
 * useTransitionPreview.ts's static incoming snapshot, which also holds the
 * incoming clip's frame-at-0 fixed through the whole window — export and
 * preview agree on what the incoming side shows, not just on the timing.
 */
export function resolveBlendFrameParams(
  timeInSegment: number,
  segmentDuration: number,
  transitionDuration: number,
): { alpha: number; nextTimeInSegment: number } | null {
  const progress = resolveTransitionProgress(segmentDuration, transitionDuration, timeInSegment);
  if (progress === null) return null;
  const half = transitionDuration / 2;
  const nextTimeInSegment = Math.max(0, progress * transitionDuration - half);
  return { alpha: progress, nextTimeInSegment };
}

/**
 * Encodes one segment to an in-memory MP4 (H.264 / yuv420p).
 *
 * Pipeline:
 *   1. Renders every frame to an offscreen canvas via renderSegmentFrame.
 *      If nextSegment is provided and the segment has a non-NONE transition,
 *      frames in the centered `transitionDuration`-wide zone around this
 *      segment's own nominal end are blended with the incoming segment's
 *      frame (see resolveBlendFrameParams).
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

  // Renders frame `i` onto the main-thread canvas (`ctx`). Pure side effect —
  // leaves the finished frame in the canvas backing store for the caller to
  // read out. Factored out so the worker-pipelined path and the sequential
  // fallback path share one copy of the blend + draw logic.
  const renderFrameToCanvas = async (i: number): Promise<void> => {
    const timeInSegment = encodeStart + i / fps;

    if (import.meta.env.DEV) {
      console.debug(
        `[encode] frame ${i + 1}/${totalFrames} time=${timeInSegment.toFixed(3)}s` +
        ` (offset=${startTimeOffset.toFixed(3)} ext=${trailingExtension.toFixed(3)})` +
        ` asset=${asset ? `${asset.type}:${asset.name}` : 'none'}`,
      );
    }

    // Compute transition blend alpha for frames in the centered blend zone
    // (docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20)'s transition-centering entry —
    // supersedes the old 100%-after-the-boundary placement, D7 in
    // project-state.md's Ignored Low Risk Bugs). The zone is centered on
    // segment.duration (this segment's own nominal end): half sits BEFORE it
    // (still within this segment's own un-extended span) and half AFTER it
    // (the trailingExtension). The incoming segment renders held at its own
    // t=0 through the pre-boundary half, then advances live for the post-
    // boundary half — see resolveBlendFrameParams. The next segment's
    // encoder call skips forward by transitionDuration/2 via startTimeOffset
    // (exportPipeline.ts), matching where this zone's post-boundary half
    // ends, so no duplicate emission occurs. In/out overlap contributions
    // cancel pairwise: Σ encoded = Σ duration = voiceoverDuration. Audio
    // sync is preserved because total encoded duration is unchanged.
    let blendParams: import('./frameRenderer').TransitionBlendParams | undefined;
    if (hasTransition && blendCanvas && blendCtx && options.nextSegment) {
      const blend = resolveBlendFrameParams(timeInSegment, segment.duration, transitionDuration);
      if (blend) {
        await renderSegmentFrame({
          segment: options.nextSegment,
          asset: options.nextAsset,
          timeInSegment: blend.nextTimeInSegment,
          ctx: blendCtx,
          width: w,
          height: h,
          global: globalConfig,
          // The absolute project time THIS output frame represents — same
          // value the primary (outgoing) render below uses. NOT derived from
          // nextSegment.startTime + nextTimeInSegment: under the centered
          // window nextTimeInSegment is held at 0 through the pre-boundary
          // half, so that formula (correct only by coincidence in the old
          // anchored-at-B-start scheme, where the two were always equal)
          // would understate how far into the blend zone this frame actually
          // is — wrong for heading-layer lookup (compositeActiveHeading
          // keys strictly off absoluteTime).
          absoluteTime: segment.startTime + timeInSegment,
          // Isolate the incoming segment's video element from the primary cache
          // so a same-URL transition doesn't thrash one shared <video> between
          // the outgoing and incoming seek targets every frame. Released in the
          // finally at the end of encodeSegment.
          useBlendVideoCache: true,
        });

        blendParams = {
          adjacentCanvas: blendCanvas,
          alpha: blend.alpha,
          type: effectiveTransition,
        };
      }
    }

    // NOTE: for segments with a trailingExtension, the video element may be seeked
    // past trimStart + duration (or past sourceDuration for a clip shorter than its
    // segment — the WS3 Batch B freeze-last-frame case). The video element holds its
    // last decoded frame in either case, which is acceptable since the segment is
    // being faded out and visually replaced by the incoming side.
    await renderSegmentFrame({
      segment,
      asset,
      timeInSegment,
      ctx,
      width: w,
      height: h,
      global: globalConfig,
      transition: blendParams,
      absoluteTime: segment.startTime + timeInSegment,
    });
  };

  const frameName = (i: number): string => `frame_${String(i + 1).padStart(5, '0')}.png`;

  // -------------------------------------------------------------------------
  // Render and write frames
  //
  // Fast path (worker pipeline): the main thread renders frame N+1 while a
  // worker pool PNG-encodes frame N off-thread; the main thread then does the
  // (unchanged) bytesToBase64 + ffmpeg.writeFile IPC. PNG bytes, frame ordering
  // (each frame → its own frame_%05d.png), and the IPC call shape are identical
  // to the sequential path — this is a scheduling change only. See
  // docs/history.md ("Export Rendering Profiling — Phase 7 Task 1", archived).
  //
  // Fallback path: the original fully-sequential render → toBlob → writeFile
  // loop, used when OffscreenCanvas/convertToBlob/Worker are unavailable.
  // -------------------------------------------------------------------------
  const pool = createFrameEncoderPool();

  // URL of the incoming segment's video loaded into the ISOLATED blend cache by
  // the transition-blend render (renderFrameToCanvas above, useBlendVideoCache).
  // Released in the finally once this segment's whole transition window is
  // encoded. undefined when this segment has no transition or no next asset.
  const blendVideoUrl = hasTransition ? options.nextAsset?.url : undefined;

  try {
    if (pool) {
      try {
        // Bounded number of frames encoded-but-not-yet-written, to cap memory
        // (each in-flight frame holds one W×H RGBA buffer). One slot per worker
        // plus one lets a worker stay fed while the main thread renders ahead.
        const maxInflight = pool.size + 1;
        const inflight: Promise<void>[] = [];
        let completed = 0;
        let firstError: unknown = null;

        for (let i = 0; i < totalFrames; i++) {
          if (firstError !== null) break;

          await renderFrameToCanvas(i);
          // Exact, non-premultiplied sRGB pixels — same bytes canvas.toBlob would
          // have PNG-encoded. Buffer is transferred (zero-copy) into the worker.
          const imageData = ctx.getImageData(0, 0, w, h);
          const filename = frameName(i);
          writtenFiles.push(filename);

          const job = (async () => {
            try {
              const pngBytes = await pool.encode(imageData);
              // Prefer the raw-binary write (no base64 round-trip) when the ffmpeg
              // backend provides it; fall back to the base64 writeFile otherwise.
              // Same on-disk PNG, same frame_%05d filename — transport-only change.
              if (ffmpeg.writeFileRaw) {
                await ffmpeg.writeFileRaw(filename, pngBytes);
              } else {
                await ffmpeg.writeFile(filename, pngBytes);
              }
              completed++;
              options.onProgress?.(completed, totalFrames);
            } catch (err) {
              if (firstError === null) firstError = err;
            }
          })();
          inflight.push(job);

          // Backpressure: keep at most `maxInflight` frames outstanding.
          if (inflight.length >= maxInflight) {
            await inflight.shift();
          }
        }

        await Promise.all(inflight);
        if (firstError !== null) {
          throw firstError instanceof Error ? firstError : new Error(String(firstError));
        }
      } finally {
        pool.dispose();
      }
    } else {
      // Sequential fallback — byte-identical output, no pipelining.
      for (let i = 0; i < totalFrames; i++) {
        await renderFrameToCanvas(i);
        const pngBytes = await canvasToPng(canvas);
        const filename = frameName(i);
        await ffmpeg.writeFile(filename, pngBytes);
        writtenFiles.push(filename);
        options.onProgress?.(i + 1, totalFrames);
      }
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
  } finally {
    // Cleanup decision — RELEASE (not promote): the incoming segment becomes
    // CURRENT on the next encodeSegment call and loads into the PRIMARY cache,
    // so keeping the blend element would mean two loaded <video> elements for
    // the same source URL (memory doubling). Promotion was rejected because the
    // blend element was only ever seeked to the transition window (t≈0..
    // transitionDuration), which the incoming segment's primary render skips via
    // startTimeOffset — so a promoted element carries no useful warm-seek state.
    // In a finally so it runs on the error path too (at most one blend element
    // is ever live, keyed by URL). No-op when blendVideoUrl is undefined.
    if (blendVideoUrl) releaseBlendVideo(blendVideoUrl);
  }
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
  // pattern the audio-mux step uses in exportPipeline). Prefers the
  // already-in-memory File — a bare `fetch(blob:)` fails on Windows WebView2.
  const srcBytes = asset.file
    ? new Uint8Array(await asset.file.arrayBuffer())
    : new Uint8Array(await (await fetch(asset.url)).arrayBuffer());
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
    absoluteTime: segment.startTime,
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
// Off-main-thread PNG encoding (Phase 7 export speedup)
// ---------------------------------------------------------------------------

interface WorkerResponse {
  id: number;
  pngBuffer?: ArrayBuffer;
  error?: string;
}

/**
 * A small pool of workers that PNG-encode RGBA frames off the main thread.
 * Each `encode()` transfers the ImageData buffer (zero-copy) to the next
 * worker round-robin; a single worker processes its queue sequentially, so N
 * workers give N-way parallelism across CPU cores. Frames complete out of
 * order, which is safe: each frame is written to its own indexed file, so
 * ordering is carried by the filename, not by completion order.
 */
class FrameEncoderPool {
  readonly size: number;
  #workers: Worker[];
  #pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();
  #nextId = 0;
  #rr = 0;
  #disposed = false;

  constructor(size: number) {
    this.size = size;
    this.#workers = [];
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./frameEncodeWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.#onMessage(e.data);
      worker.onerror = (e) => this.#onWorkerError(e);
      this.#workers.push(worker);
    }
  }

  encode(imageData: ImageData): Promise<Uint8Array> {
    if (this.#disposed) return Promise.reject(new Error('FrameEncoderPool: already disposed'));
    const id = this.#nextId++;
    const worker = this.#workers[this.#rr]!;
    this.#rr = (this.#rr + 1) % this.#workers.length;
    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const buffer = imageData.data.buffer;
      worker.postMessage(
        { id, buffer, width: imageData.width, height: imageData.height },
        [buffer],
      );
    });
  }

  #onMessage(data: WorkerResponse): void {
    const entry = this.#pending.get(data.id);
    if (!entry) return;
    this.#pending.delete(data.id);
    if (data.error !== undefined || !data.pngBuffer) {
      entry.reject(new Error(data.error ?? 'frameEncodeWorker: empty response'));
    } else {
      entry.resolve(new Uint8Array(data.pngBuffer));
    }
  }

  #onWorkerError(e: ErrorEvent): void {
    // A worker-level crash can't be tied to a specific request id, so fail every
    // outstanding job — the export surfaces it as an encode error and aborts.
    const err = new Error(`frameEncodeWorker crashed: ${e.message || 'unknown error'}`);
    for (const { reject } of this.#pending.values()) reject(err);
    this.#pending.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const w of this.#workers) w.terminate();
    this.#workers = [];
    this.#pending.clear();
  }
}

/**
 * Builds a worker pool for off-thread PNG encoding, or returns null when the
 * runtime can't support it (OffscreenCanvas / convertToBlob / Worker missing,
 * or worker construction throws). Null routes encodeSegment to the unchanged
 * sequential main-thread fallback. Pool size is capped at 4 and leaves a core
 * for the main-thread render/seek work.
 */
function createFrameEncoderPool(): FrameEncoderPool | null {
  if (
    typeof Worker === 'undefined' ||
    typeof OffscreenCanvas === 'undefined' ||
    typeof OffscreenCanvas.prototype.convertToBlob !== 'function'
  ) {
    console.log('[export] Using sequential fallback (worker/OffscreenCanvas unsupported)');
    return null;
  }
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4;
  const size = Math.max(1, Math.min(4, cores - 1));
  try {
    const pool = new FrameEncoderPool(size);
    console.log(`[export] Using pipelined worker encode (pool size ${size})`);
    return pool;
  } catch (err) {
    console.log('[export] Using sequential fallback (worker/OffscreenCanvas unsupported)');
    if (import.meta.env.DEV) console.warn('[segmentEncoder] worker pool construction failed:', err);
    return null;
  }
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
