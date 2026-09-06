/**
 * THROWAWAY — Round 5 Part 1: pipeline bisection arms A/B/(C).
 * Dev-only — not imported by production.
 */

import { GlCompositor } from '../../services/gl/glCompositor';
import { NEUTRAL_GRADE } from '../../services/gl/compositeParams';
import { acquireOffscreenGlContext } from '../../services/gl/glContext';
import { computeObjectCoverUvRect } from '../../services/gl/uvRect';
import { WATCHDOG_MS } from '../../services/webcodecsExport/exportPipelineWebCodecs';
import { GLTextRenderer, type TextRenderGlobalConfig } from '../../services/webcodecsExport/textRenderer';
import {
  decodeSegmentFrames,
  decodeResourceCounts,
  resetDecodeResourceCounts,
} from '../../services/webcodecsExport/sequentialDecode';
import { demuxCacheSize, clearDemuxCache } from '../../services/videoDemuxer';
import { AnimationType, TransitionType, type VideoSegment } from '../../types';
import { persistLivenessReport } from './autorunFlag';

const EXPORT_CODEC = 'avc1.640028';
const EXPORT_BITRATE = 8_000_000;
const HARDWARE_LADDER = ['prefer-hardware', 'no-preference', 'prefer-software'] as const;
const BACKPRESSURE_HIGH_WATER = 4;
const TIMELINE_SEC = 200;
const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
const SEG_DUR_SEC = 0.4;

const VIDEO_SPECS = [
  { path: '/_spike/local-smallest.mp4', duration: 1.28 },
  { path: '/_spike/local-mid-a.mp4', duration: 10.01 },
  { path: '/_spike/sample.mp4', duration: 10.4 },
  { path: '/_spike/local-largest.mp4', duration: 5.0 },
] as const;

export type PipelineBisectArm = 'arm-a-encoder-gl' | 'arm-b-encoder-decode' | 'arm-c-encoder-gl-decode';

export interface PipelineBisectResult {
  arm: PipelineBisectArm;
  framesTarget: number;
  framesEncoded: number;
  timelineSec: number;
  wallSec: number;
  chunkCount: number;
  keyframeCount: number;
  encodedBytes: number;
  decodedSourceFrames: number;
  uniqueDemuxCount: number;
  decodersCreated: number;
  decodersOpen: number;
  cursorsCreated: number;
  openCursors: number;
  maxOpenCursors: number;
  openImageBitmaps: number;
  appendCallCount: number;
  appendBytes: number;
  glContextLost: boolean;
  glContextLostAt: string | null;
  failure: string | null;
  failureVia: string | null;
  workerHeapBytes: number | null;
}

function workerHeapBytes(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return typeof mem?.usedJSHeapSize === 'number' ? mem.usedJSHeapSize : null;
}

function gopFrames(fps: number): number {
  return Math.max(1, Math.round(2 * fps));
}

async function createProductionEncoder(
  onChunk: (chunk: EncodedVideoChunk) => void,
  onError: (e: DOMException) => void,
): Promise<VideoEncoder> {
  const base = {
    codec: EXPORT_CODEC,
    width: WIDTH,
    height: HEIGHT,
    framerate: FPS,
    bitrate: EXPORT_BITRATE,
    latencyMode: 'quality' as const,
    avc: { format: 'annexb' as const },
  };
  for (const hardwareAcceleration of HARDWARE_LADDER) {
    const config: VideoEncoderConfig = { ...base, hardwareAcceleration };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (!support.supported) continue;
      const encoder = new VideoEncoder({ output: onChunk, error: onError });
      encoder.configure(config);
      return encoder;
    } catch {
      // try next rung
    }
  }
  throw new Error('runPipelineBisectRound5: no VideoEncoder config succeeded');
}

function waitForDequeue(encoder: VideoEncoder): Promise<void> {
  return new Promise((resolve) => {
    const handler = (): void => {
      encoder.removeEventListener('dequeue', handler);
      resolve();
    };
    encoder.addEventListener('dequeue', handler);
  });
}

function buildSegments(): VideoSegment[] {
  const count = Math.ceil(TIMELINE_SEC / SEG_DUR_SEC);
  const segments: VideoSegment[] = [];
  for (let i = 0; i < count; i++) {
    const assetIdx = i % VIDEO_SPECS.length;
    const asset = VIDEO_SPECS[assetIdx]!;
    segments.push({
      id: `seg-${i}`,
      text: `Caption ${i + 1}`,
      assetId: `asset-${assetIdx}`,
      startTime: i * SEG_DUR_SEC,
      duration: SEG_DUR_SEC,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: i,
      showOverlay: true,
      trimStart: 0,
      trimEnd: Math.min(SEG_DUR_SEC, asset.duration),
    });
  }
  return segments;
}

async function makeSourceBitmap(seed: number): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  g.addColorStop(0, `hsl(${seed % 360} 70% 40%)`);
  g.addColorStop(1, `hsl(${(seed + 120) % 360} 70% 55%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return createImageBitmap(c);
}

interface DecodeCursor {
  gen: AsyncGenerator<VideoFrame>;
  pending: VideoFrame | null;
  current: VideoFrame | null;
  exhausted: boolean;
}

function toSourceTime(seg: VideoSegment, currentTime: number, sourceDuration: number): number {
  const local = currentTime - seg.startTime;
  const trimStart = seg.trimStart ?? 0;
  const trimEnd = seg.trimEnd ?? sourceDuration;
  const raw = trimStart + local;
  return Math.min(raw, trimEnd);
}

function openDecodeCursor(seg: VideoSegment, assetUrl: string, sourceDuration: number): DecodeCursor {
  const trimStart = seg.trimStart ?? 0;
  const trimEnd = seg.trimEnd ?? sourceDuration;
  return {
    gen: decodeSegmentFrames(assetUrl, trimStart, trimEnd),
    pending: null,
    current: null,
    exhausted: false,
  };
}

async function frameAt(cursor: DecodeCursor, targetSec: number, onNewDecode?: () => void): Promise<VideoFrame | null> {
  for (;;) {
    if (cursor.pending) {
      const pendingSec = cursor.pending.timestamp / 1e6;
      if (pendingSec > targetSec) {
        if (cursor.current) break;
        cursor.current = cursor.pending;
        cursor.pending = null;
        break;
      }
      if (cursor.current) cursor.current.close();
      cursor.current = cursor.pending;
      cursor.pending = null;
    }
    if (cursor.exhausted) break;
    const { value, done } = await cursor.gen.next();
    if (done) {
      cursor.exhausted = true;
      break;
    }
    cursor.pending = value;
    onNewDecode?.();
  }
  return cursor.current;
}

function segmentAtTime(segments: VideoSegment[], t: number): VideoSegment {
  const idx = Math.min(Math.floor(t / SEG_DUR_SEC), segments.length - 1);
  return segments[idx]!;
}

export async function runPipelineBisectArm(arm: PipelineBisectArm): Promise<PipelineBisectResult> {
  clearDemuxCache();
  resetDecodeResourceCounts();

  const framesTarget = Math.round(TIMELINE_SEC * FPS);
  const gop = gopFrames(FPS);
  const segments = buildSegments();
  const textGlobal: TextRenderGlobalConfig = {
    overlayConfig: { color: '#ffffff', backgroundColor: '#000000', fontFamily: 'Inter' },
    textLayers: [],
    headings: [],
  };

  let chunkCount = 0;
  let keyframeCount = 0;
  let encodedBytes = 0;
  let decodedSourceFrames = 0;
  let failure: string | null = null;
  let failureVia: string | null = null;
  let framesEncoded = 0;
  let lastOutputAt = performance.now();
  let glContextLost = false;
  let glContextLostAt: string | null = null;

  let cursorsCreated = 0;
  let maxOpenCursors = 0;
  let openCursorsAtEnd = 0;
  const cursors = new Map<string, DecodeCursor>();

  const noteOutput = (): void => {
    lastOutputAt = performance.now();
  };

  const checkWatchdog = (): boolean => {
    if (performance.now() - lastOutputAt >= WATCHDOG_MS) {
      failure = `watchdog: no encoded output for ${WATCHDOG_MS}ms at frame ${framesEncoded} (t=${(framesEncoded / FPS).toFixed(3)}s)`;
      failureVia = 'watchdog';
      return true;
    }
    return false;
  };

  /** Race `work` against the same 30 s silence bound production uses — decode can block past one loop tick. */
  async function withWatchdog<T>(work: () => Promise<T>): Promise<T | null> {
    let interval: ReturnType<typeof setInterval> | null = null;
    try {
      return await Promise.race([
        work(),
        new Promise<null>((resolve) => {
          interval = setInterval(() => {
            if (checkWatchdog()) resolve(null);
          }, 250);
        }),
      ]);
    } finally {
      if (interval) clearInterval(interval);
    }
  }

  const encoder = await createProductionEncoder(
    (chunk) => {
      chunkCount++;
      if (chunk.type === 'key') keyframeCount++;
      encodedBytes += chunk.byteLength;
      noteOutput();
    },
    (e) => {
      failure = `${e.name}: ${e.message}`;
      failureVia = 'encoder-callback';
    },
  );

  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const frameDurUs = Math.round(1_000_000 / FPS);
  const t0 = performance.now();

  const useGl = arm === 'arm-a-encoder-gl' || arm === 'arm-c-encoder-gl-decode';
  const useDecode = arm === 'arm-b-encoder-decode' || arm === 'arm-c-encoder-gl-decode';

  let compositor: GlCompositor | null = null;
  let textRenderer: GLTextRenderer | null = null;
  let synthBmp: ImageBitmap | null = null;

  try {
    if (useGl) {
      const gl = acquireOffscreenGlContext(canvas, {
        onLost: (event) => {
          glContextLost = true;
          glContextLostAt = 'src/services/gl/glContext.ts:acquireOffscreenGlContext onLost';
          failure = `gl-context-lost: ${event.type}`;
          failureVia = 'gl-context-lost';
        },
      });
      if (!gl) throw new Error('WebGL2 unavailable');
      compositor = new GlCompositor(gl);
      textRenderer = new GLTextRenderer(gl);
      await textRenderer.init([]);
      synthBmp = await makeSourceBitmap(42);
    }

    for (let i = 0; i < framesTarget; i++) {
      if (failure) break;
      if (checkWatchdog()) break;

      const currentTime = i / FPS;
      const seg = segmentAtTime(segments, currentTime);

      let encodeSource: VideoFrame | CanvasImageSource = canvas;

      if (useDecode) {
        const segIndex = Math.min(Math.floor(currentTime / SEG_DUR_SEC), segments.length - 1);
        const assetIdx = segIndex % VIDEO_SPECS.length;
        const spec = VIDEO_SPECS[assetIdx]!;
        let cursor = cursors.get(seg.id);
        if (!cursor) {
          cursor = openDecodeCursor(seg, spec.path, spec.duration);
          cursors.set(seg.id, cursor);
          cursorsCreated++;
          maxOpenCursors = Math.max(maxOpenCursors, cursors.size);
        }
        const targetSec = toSourceTime(seg, currentTime, spec.duration);
        const decoded = await withWatchdog(() =>
          frameAt(cursor, targetSec, () => {
            decodedSourceFrames++;
          }),
        );
        if (failure) break;
        if (!decoded) {
          failure = `decode exhausted at frame ${i} seg=${seg.id}`;
          failureVia = 'thrown';
          break;
        }

        if (useGl && compositor && synthBmp) {
          const texRect = computeObjectCoverUvRect(decoded.displayWidth, decoded.displayHeight, WIDTH, HEIGHT);
          compositor.uploadFrame('a', decoded, texRect);
          compositor.renderFrame({
            transition: null,
            animScaleA: 1,
            animScaleB: 1,
            grade: NEUTRAL_GRADE,
          });
          textRenderer!.renderFrame({
            segment: seg,
            global: textGlobal,
            absoluteTime: currentTime,
            frameWidth: WIDTH,
            frameHeight: HEIGHT,
          });
        } else {
          encodeSource = decoded;
        }
      } else if (useGl && compositor && synthBmp) {
        const texRect = computeObjectCoverUvRect(synthBmp.width, synthBmp.height, WIDTH, HEIGHT);
        compositor.uploadFrame('a', synthBmp, texRect);
        compositor.renderFrame({
          transition: null,
          animScaleA: 1,
          animScaleB: 1,
          grade: NEUTRAL_GRADE,
        });
        textRenderer!.renderFrame({
          segment: seg,
          global: textGlobal,
          absoluteTime: currentTime,
          frameWidth: WIDTH,
          frameHeight: HEIGHT,
        });
      }

      if (encoder.encodeQueueSize > BACKPRESSURE_HIGH_WATER) await waitForDequeue(encoder);

      const frame =
        encodeSource instanceof VideoFrame
          ? new VideoFrame(encodeSource, {
              timestamp: Math.round((i * 1_000_000) / FPS),
              duration: frameDurUs,
            })
          : new VideoFrame(canvas, {
              timestamp: Math.round((i * 1_000_000) / FPS),
              duration: frameDurUs,
            });

      try {
        encoder.encode(frame, { keyFrame: i % gop === 0 });
        framesEncoded++;
        noteOutput();
        if (i > 0 && i % 300 === 0) {
          persistLivenessReport(`round5-${arm}-progress`, { framesEncoded, timelineSec: framesEncoded / FPS, openCursors: cursors.size, maxOpenCursors });
        }
      } finally {
        frame.close();
      }
    }

    if (!failure) await encoder.flush();
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
    failureVia = failureVia ?? 'thrown';
  }

  openCursorsAtEnd = cursors.size;
  const { decodersCreated, decodersOpen } = decodeResourceCounts();

  try {
    for (const cursor of cursors.values()) {
      cursor.pending?.close();
      cursor.current?.close();
      await cursor.gen.return(undefined).catch(() => undefined);
    }
    cursors.clear();
    synthBmp?.close();
    compositor?.dispose();
    textRenderer?.dispose();
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      // best-effort
    }
  } catch {
    // cleanup best-effort
  }

  const wallSec = (performance.now() - t0) / 1000;

  const result: PipelineBisectResult = {
    arm,
    framesTarget,
    framesEncoded,
    timelineSec: framesEncoded / FPS,
    wallSec,
    chunkCount,
    keyframeCount,
    encodedBytes,
    decodedSourceFrames,
    uniqueDemuxCount: demuxCacheSize(),
    decodersCreated,
    decodersOpen,
    cursorsCreated,
    openCursors: openCursorsAtEnd,
    maxOpenCursors,
    openImageBitmaps: synthBmp ? 0 : 0,
    appendCallCount: 0,
    appendBytes: 0,
    glContextLost,
    glContextLostAt,
    failure,
    failureVia,
    workerHeapBytes: workerHeapBytes(),
  };

  persistLivenessReport(`round5-${arm}`, result);
  return result;
}

export async function runPipelineBisectSuite(): Promise<PipelineBisectResult[]> {
  const results: PipelineBisectResult[] = [];

  const armA = await runPipelineBisectArm('arm-a-encoder-gl');
  results.push(armA);

  const armB = await runPipelineBisectArm('arm-b-encoder-decode');
  results.push(armB);

  const aClean = armA.failure === null && armA.framesEncoded >= armA.framesTarget;
  const bClean = armB.failure === null && armB.framesEncoded >= armB.framesTarget;

  if (aClean && bClean) {
    persistLivenessReport('round5-both-clean', { reason: 'GL and decode each clean alone — running arm C' });
    const armC = await runPipelineBisectArm('arm-c-encoder-gl-decode');
    results.push(armC);
  }

  persistLivenessReport('round5-bisect-summary', results);
  return results;
}
