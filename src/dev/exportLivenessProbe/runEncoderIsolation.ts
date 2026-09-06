/**
 * THROWAWAY — Round 4 Part 1: isolated VideoEncoder ceiling harness.
 * Exercises VideoEncoder alone, then +GL composite, then +demux/decode.
 * Dev-only — not imported by production.
 */

import { GlCompositor } from '../../services/gl/glCompositor';
import { NEUTRAL_GRADE } from '../../services/gl/compositeParams';
import { computeObjectCoverUvRect } from '../../services/gl/uvRect';
import { decodeSegmentFrames } from '../../services/webcodecsExport/sequentialDecode';
import { demuxCacheSize } from '../../services/videoDemuxer';
import { persistLivenessReport } from './autorunFlag';

const EXPORT_CODEC = 'avc1.640028';
const EXPORT_BITRATE = 8_000_000;
const HARDWARE_LADDER = ['prefer-hardware', 'no-preference', 'prefer-software'] as const;
const BACKPRESSURE_HIGH_WATER = 4;
const TIMELINE_SEC = 200;
const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

export type EncoderIsolationMode = 'encoder-only' | 'encoder-gl' | 'encoder-demux';

export interface EncoderIsolationResult {
  mode: EncoderIsolationMode;
  framesTarget: number;
  framesEncoded: number;
  timelineSec: number;
  wallSec: number;
  chunkCount: number;
  keyframeCount: number;
  encodedBytes: number;
  decodedSourceFrames: number;
  uniqueDemuxCount: number;
  failure: string | null;
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
  throw new Error('runEncoderIsolation: no VideoEncoder config succeeded');
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

async function drawSynthetic2d(canvas: OffscreenCanvas, i: number): Promise<void> {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `hsl(${(i * 7) % 360} 60% 45%)`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#fff';
  ctx.font = '24px sans-serif';
  ctx.fillText(`frame ${i}`, 40, 60);
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

export async function runEncoderIsolation(mode: EncoderIsolationMode): Promise<EncoderIsolationResult> {
  const framesTarget = Math.round(TIMELINE_SEC * FPS);
  const gop = gopFrames(FPS);
  let chunkCount = 0;
  let keyframeCount = 0;
  let encodedBytes = 0;
  let decodedSourceFrames = 0;
  let failure: string | null = null;
  let framesEncoded = 0;

  const encoder = await createProductionEncoder(
    (chunk) => {
      chunkCount++;
      if (chunk.type === 'key') keyframeCount++;
      encodedBytes += chunk.byteLength;
    },
    (e) => {
      failure = `${e.name}: ${e.message}`;
    },
  );

  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const frameDurUs = Math.round(1_000_000 / FPS);
  const t0 = performance.now();

  try {
    if (mode === 'encoder-only') {
      for (let i = 0; i < framesTarget; i++) {
        if (failure) break;
        await drawSynthetic2d(canvas, i);
        if (encoder.encodeQueueSize > BACKPRESSURE_HIGH_WATER) await waitForDequeue(encoder);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((i * 1_000_000) / FPS),
          duration: frameDurUs,
        });
        try {
          encoder.encode(frame, { keyFrame: i % gop === 0 });
          framesEncoded++;
        } finally {
          frame.close();
        }
      }
    } else if (mode === 'encoder-gl') {
      const gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('WebGL2 unavailable');
      const compositor = new GlCompositor(gl);
      const bmp = await makeSourceBitmap(42);
      const texRect = computeObjectCoverUvRect(bmp.width, bmp.height, WIDTH, HEIGHT);
      for (let i = 0; i < framesTarget; i++) {
        if (failure) break;
        compositor.uploadFrame('a', bmp, texRect);
        compositor.renderFrame({
          transition: null,
          animScaleA: 1,
          animScaleB: 1,
          grade: NEUTRAL_GRADE,
        });
        if (encoder.encodeQueueSize > BACKPRESSURE_HIGH_WATER) await waitForDequeue(encoder);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((i * 1_000_000) / FPS),
          duration: frameDurUs,
        });
        try {
          encoder.encode(frame, { keyFrame: i % gop === 0 });
          framesEncoded++;
        } finally {
          frame.close();
        }
      }
      bmp.close();
      compositor.dispose();
    } else {
      const assetUrl = '/_spike/local-smallest.mp4';
      const gen = decodeSegmentFrames(assetUrl, 0, TIMELINE_SEC);
      let pending: VideoFrame | null = null;
      for (let i = 0; i < framesTarget; i++) {
        if (failure) break;
        while (!pending) {
          const { value, done } = await gen.next();
          if (done) break;
          pending = value;
          decodedSourceFrames++;
        }
        if (!pending) break;
        if (encoder.encodeQueueSize > BACKPRESSURE_HIGH_WATER) await waitForDequeue(encoder);
        const frame = new VideoFrame(pending, {
          timestamp: Math.round((i * 1_000_000) / FPS),
          duration: frameDurUs,
        });
        try {
          encoder.encode(frame, { keyFrame: i % gop === 0 });
          framesEncoded++;
        } finally {
          frame.close();
        }
        pending.close();
        pending = null;
      }
      await gen.return(undefined).catch(() => undefined);
    }

    if (!failure) await encoder.flush();
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      // best-effort
    }
  }

  const wallSec = (performance.now() - t0) / 1000;
  const result: EncoderIsolationResult = {
    mode,
    framesTarget,
    framesEncoded,
    timelineSec: framesEncoded / FPS,
    wallSec,
    chunkCount,
    keyframeCount,
    encodedBytes,
    decodedSourceFrames,
    uniqueDemuxCount: demuxCacheSize(),
    failure,
    workerHeapBytes: workerHeapBytes(),
  };
  persistLivenessReport(`encoder-isolation-${mode}`, result);
  return result;
}

export async function runEncoderIsolationSuite(): Promise<EncoderIsolationResult[]> {
  const modes: EncoderIsolationMode[] = ['encoder-only', 'encoder-gl', 'encoder-demux'];
  const results: EncoderIsolationResult[] = [];
  for (const mode of modes) {
    results.push(await runEncoderIsolation(mode));
    if (mode === 'encoder-only' && results[0]!.failure === null && results[0]!.framesEncoded >= Math.round(TIMELINE_SEC * FPS)) {
      persistLivenessReport('encoder-isolation-stop', { reason: 'encoder-only reached 200s clean — pipeline ceiling' });
    }
  }
  persistLivenessReport('encoder-isolation-summary', results);
  return results;
}
