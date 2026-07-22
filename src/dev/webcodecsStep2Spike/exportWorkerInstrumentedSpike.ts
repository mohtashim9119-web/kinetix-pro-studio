/// <reference lib="webworker" />
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THROWAWAY DIAGNOSTIC SPIKE FILE — byte-for-byte a copy of the real
 * `src/services/webcodecsExport/exportWorker.ts` (production, UNTOUCHED)
 * with ADDED PER-PHASE TIMING INSTRUMENTATION only. Exists solely to answer
 * a user-reported real-project export slowdown (14-segment/33s project took
 * 116s instead of the ~30-40s the Step 8 synthetic 360-frame test implied) —
 * this file lets the diagnostic spike see WHERE the time goes inside the
 * worker (decode vs. composite vs. encode/backpressure), which the real
 * `exportWorker.ts` cannot report (no such fields in its message protocol,
 * by design — a production file, not instrumented for spikes). Same
 * precedent as this directory's existing `exportWorkerSoftwareSpike.ts`
 * (copy + one targeted change, everything else verbatim).
 *
 * Diffs from the real file:
 *   1. Import paths adjusted for this file's directory depth (same as
 *      exportWorkerSoftwareSpike.ts).
 *   2. A new `PhaseTimers` accumulator (module-scope inside `runExport`)
 *      wraps: decode (`resolveSlotSource` calls for slot a + b), composite
 *      (`renderFrame` + text `renderFrame`, split into transition vs.
 *      non-transition frames by whether `rawParams.transition` is set),
 *      backpressure wait (`waitForDequeue`), and encode (frame construction
 *      + `encoder.encode()` call itself, excluding backpressure wait).
 *   3. A new outbound message `{ type: 'phase-timing', ... }` posted once
 *      at the end of the run (success or error) with the full breakdown.
 *   4. `queue-sample` messages now fire every frame (not every 5th) — this
 *      diagnostic explicitly needs the real backpressure trajectory, not a
 *      sampled approximation (plan `docs/webcodecs-export-plan.md` §4.1's
 *      "sampled periodically... to keep message volume sane" tradeoff is a
 *      production concern; this throwaway spike prioritizes signal).
 *
 * Not imported by any production file. Delete alongside the rest of this
 * spike directory once this diagnostic is reviewed.
 *
 * ORIGINAL HEADER (src/services/webcodecsExport/exportWorker.ts):
 * The WebCodecs+WebGL2 export worker entry point (docs/webcodecs-export-plan.md
 * §4.1). Per-frame loop for one GL-compositable RUN: DECODE (sequentialDecode
 * per segment) -> COMPOSITE (GlCompositor, unmodified) -> TEXT (GLTextRenderer)
 * -> ENCODE (backpressure-paced VideoEncoder) -> STREAM (annexb chunks to main
 * thread). Worker-safe: no React, no DOM module, no `window` anywhere in this
 * file's import graph.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced by the declare below, not used as a value
declare const self: DedicatedWorkerGlobalScope;

import type { Asset, HeadingOverlay, TextOverlay, VideoSegment } from '../../types';
import { GlCompositor, type TextureSlot, type UploadSource } from '../../services/gl/glCompositor';
import { deriveCompositeParams, deriveSlotPlan, type ProjectEffectConfig } from '../../services/gl/compositeParams';
import { acquireOffscreenGlContext } from '../../services/gl/glContext';
import { computeObjectCoverUvRect } from '../../services/gl/uvRect';
import { decodeSegmentFrames } from '../../services/webcodecsExport/sequentialDecode';
import { GLTextRenderer, type FontConfig, type TextRenderGlobalConfig } from '../../services/webcodecsExport/textRenderer';

// ---------------------------------------------------------------------------
// Message protocol
// ---------------------------------------------------------------------------

export interface ExportWorkerInitMessage {
  type: 'init';
  runId: string;
  segments: VideoSegment[];
  assets: Asset[];
  config: ProjectEffectConfig;
  width: number;
  height: number;
  fps: number;
  fontConfigs?: FontConfig[];
  globalOverlayConfig?: { color: string; backgroundColor: string; fontFamily: string; fontSize?: number };
  textLayers?: TextOverlay[];
  headings?: HeadingOverlay[];
}

export type ExportWorkerInboundMessage = ExportWorkerInitMessage | { type: 'cancel' };

/** Diagnostic-only aggregate phase timing, posted once at run end. */
export interface PhaseTimingReport {
  runId: string;
  totalFrames: number;
  transitionFrames: number;
  nonTransitionFrames: number;
  wallMs: number;
  decodeMs: number;
  /** Time spent in `compositor.uploadFrame` (texture upload to the GPU) for
   *  both slots — discovered mid-investigation to be a distinct, previously
   *  uninstrumented phase (not part of `compositeMs`, which only covers
   *  `renderFrame`'s blend/zoom/grade passes). */
  uploadMs: number;
  compositeMs: number;
  compositeTransitionMs: number;
  compositeNonTransitionMs: number;
  textMs: number;
  backpressureWaitMs: number;
  /** Time constructing `new VideoFrame(canvas, ...)` — separate from
   *  `encodeCallMs` (the `encoder.encode()` call itself) because
   *  constructing a VideoFrame from an OffscreenCanvas may itself involve a
   *  GPU readback, a distinct cost from queuing the encode. */
  frameConstructMs: number;
  encodeCallMs: number;
  backpressureHits: number;
  /** Diagnostic (item b, real-project bottleneck investigation): how many
   *  times each image asset was actually fetched+createImageBitmap'd. A
   *  correctly-cached implementation shows exactly 1 per unique asset id,
   *  regardless of how many segments/frames reference it. */
  imageBitmapCreateCounts: Record<string, number>;
  /** Diagnostic (item c): how many `frameAt` decode-advance calls were made
   *  per video segment id — confirms decode is a forward-advancing cursor
   *  (roughly one call per frame that segment is visible in, NOT a restart
   *  each time), rather than re-decoding from scratch per frame. */
  decodeCallCounts: Record<string, number>;
}

export type ExportWorkerOutboundMessage =
  | { type: 'chunk'; runId: string; bytes: ArrayBuffer; chunkType: EncodedVideoChunkType; timestamp: number }
  | { type: 'run-done'; runId: string; frameCount: number }
  | { type: 'done'; frameCount: number }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }
  | { type: 'queue-sample'; frameIndex: number; size: number }
  | { type: 'phase-timing'; report: PhaseTimingReport };

function postOut(message: ExportWorkerOutboundMessage, transfer?: Transferable[]): void {
  if (transfer) self.postMessage(message, transfer);
  else self.postMessage(message);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

// ---------------------------------------------------------------------------
// Segment-local <-> source-time mapping (duplicated from useWebCodecsPreview.ts
// for worker-safety reasons — see the real exportWorker.ts's own comment).
// ---------------------------------------------------------------------------

function toSourceTime(segment: VideoSegment, currentTime: number): number {
  const segmentProgress = currentTime - (segment.startTime ?? 0);
  const rawTime = (segment.trimStart || 0) + segmentProgress * (segment.playbackSpeed || 1);
  const videoTime = segment.trimEnd !== undefined ? Math.min(rawTime, segment.trimEnd) : rawTime;
  return Math.max(0, videoTime);
}

function sourceRange(segment: VideoSegment): { start: number; end: number } {
  const start = segment.trimStart || 0;
  const speed = segment.playbackSpeed || 1;
  const end = segment.trimEnd ?? start + segment.duration * speed;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Per-segment sequential decode cursor.
// ---------------------------------------------------------------------------

interface DecodeCursor {
  gen: AsyncGenerator<VideoFrame>;
  pending: VideoFrame | null;
  current: VideoFrame | null;
  exhausted: boolean;
}

function openCursor(segment: VideoSegment, assetUrl: string): DecodeCursor {
  const { start, end } = sourceRange(segment);
  return { gen: decodeSegmentFrames(assetUrl, start, end), pending: null, current: null, exhausted: false };
}

async function frameAt(cursor: DecodeCursor, targetSec: number): Promise<VideoFrame | null> {
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
  }
  return cursor.current;
}

async function closeCursor(cursor: DecodeCursor): Promise<void> {
  cursor.pending?.close();
  cursor.current?.close();
  cursor.pending = null;
  cursor.current = null;
  await cursor.gen.return(undefined).catch(() => {});
}

// ---------------------------------------------------------------------------
// Slot content resolution — video (via a DecodeCursor) or still image (via a
// cached ImageBitmap).
// ---------------------------------------------------------------------------

interface SlotSource {
  source: UploadSource;
  w: number;
  h: number;
}

class RunState {
  private cursors = new Map<string, DecodeCursor>();
  private imageBitmaps = new Map<string, ImageBitmap>();
  private assetById: Map<string, Asset>;
  /** Diagnostic-only (see PhaseTimingReport's own doc comments). */
  readonly imageBitmapCreateCounts = new Map<string, number>();
  readonly decodeCallCounts = new Map<string, number>();

  constructor(assets: readonly Asset[]) {
    this.assetById = new Map(assets.map((a) => [a.id, a]));
  }

  async resolveSlotSource(seg: VideoSegment, currentTime: number): Promise<SlotSource | null> {
    const asset = seg.assetId ? this.assetById.get(seg.assetId) : undefined;
    if (!asset) return null;

    if (asset.type === 'video') {
      let cursor = this.cursors.get(seg.id);
      if (!cursor) {
        cursor = openCursor(seg, asset.url);
        this.cursors.set(seg.id, cursor);
      }
      const targetSec = toSourceTime(seg, currentTime);
      this.decodeCallCounts.set(seg.id, (this.decodeCallCounts.get(seg.id) ?? 0) + 1);
      const frame = await frameAt(cursor, targetSec);
      if (!frame) return null;
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      if (!w || !h) return null;
      return { source: frame, w, h };
    }

    if (asset.type === 'image') {
      let bmp = this.imageBitmaps.get(asset.id);
      if (!bmp) {
        const resp = await fetch(asset.url);
        if (!resp.ok) throw new Error(`exportWorker: fetch failed (${resp.status}) for image asset ${asset.id} (${asset.url})`);
        bmp = await createImageBitmap(await resp.blob());
        this.imageBitmaps.set(asset.id, bmp);
        this.imageBitmapCreateCounts.set(asset.id, (this.imageBitmapCreateCounts.get(asset.id) ?? 0) + 1);
      }
      return { source: bmp, w: bmp.width, h: bmp.height };
    }

    return null;
  }

  async disposeAll(): Promise<void> {
    for (const cursor of this.cursors.values()) await closeCursor(cursor);
    this.cursors.clear();
    for (const bmp of this.imageBitmaps.values()) bmp.close();
    this.imageBitmaps.clear();
  }
}

function uploadSlot(compositor: GlCompositor, slot: TextureSlot, src: SlotSource, dstW: number, dstH: number): void {
  const texRect = computeObjectCoverUvRect(src.w, src.h, dstW, dstH);
  compositor.uploadFrame(slot, src.source, texRect);
}

// ---------------------------------------------------------------------------
// VideoEncoder construction — identical to production.
// ---------------------------------------------------------------------------

const EXPORT_CODEC = 'avc1.640028';
const EXPORT_BITRATE = 8_000_000;
const HARDWARE_LADDER: HardwareAcceleration[] = ['prefer-hardware', 'no-preference', 'prefer-software'];
const BACKPRESSURE_HIGH_WATER = 4;
function gopFrames(fps: number): number {
  return Math.max(1, Math.round(2 * fps));
}

async function createEncoder(
  width: number,
  height: number,
  fps: number,
  onOutput: (chunk: EncodedVideoChunk) => void,
  onError: (e: DOMException) => void,
): Promise<VideoEncoder> {
  const base = {
    codec: EXPORT_CODEC,
    width,
    height,
    framerate: fps,
    bitrate: EXPORT_BITRATE,
    latencyMode: 'quality' as const,
    avc: { format: 'annexb' as const },
  };

  const attempts: string[] = [];
  for (const hardwareAcceleration of HARDWARE_LADDER) {
    const config: VideoEncoderConfig = { ...base, hardwareAcceleration };

    let supported = false;
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      supported = support.supported === true;
    } catch (e) {
      attempts.push(`${hardwareAcceleration}: isConfigSupported threw: ${errMessage(e)}`);
      continue;
    }
    if (!supported) {
      attempts.push(`${hardwareAcceleration}: isConfigSupported=false`);
      continue;
    }

    let encoder: VideoEncoder | null = null;
    try {
      encoder = new VideoEncoder({ output: onOutput, error: onError });
      encoder.configure(config);
      return encoder;
    } catch (e) {
      attempts.push(`${hardwareAcceleration}: configure threw: ${errMessage(e)}`);
      try {
        encoder?.close();
      } catch {
        // best-effort
      }
    }
  }

  throw new Error(`exportWorker: no VideoEncoder config in the hardware-first ladder succeeded — [${attempts.join(' | ')}]`);
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

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

let running = false;
let cancelRequested = false;

function resolveTextSegment(
  plan: { a: VideoSegment | null; b: VideoSegment | null },
  transition: { progress: number } | null,
): VideoSegment | null {
  if (!transition) return plan.a;
  return transition.progress < 0.5 ? plan.a : plan.b;
}

/** Diagnostic phase-timing accumulator — see this file's header. */
interface PhaseTimers {
  decodeMs: number;
  uploadMs: number;
  compositeTransitionMs: number;
  compositeNonTransitionMs: number;
  textMs: number;
  backpressureWaitMs: number;
  backpressureHits: number;
  frameConstructMs: number;
  encodeCallMs: number;
  transitionFrames: number;
  nonTransitionFrames: number;
}

function mapToRecord(m: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of m) out[k] = v;
  return out;
}

function newPhaseTimers(): PhaseTimers {
  return {
    decodeMs: 0,
    uploadMs: 0,
    compositeTransitionMs: 0,
    compositeNonTransitionMs: 0,
    textMs: 0,
    backpressureWaitMs: 0,
    backpressureHits: 0,
    frameConstructMs: 0,
    encodeCallMs: 0,
    transitionFrames: 0,
    nonTransitionFrames: 0,
  };
}

async function runExport(payload: ExportWorkerInitMessage): Promise<void> {
  const runWallStart = performance.now();
  const timers = newPhaseTimers();
  const { runId, segments, assets, config, width, height, fps } = payload;
  const textGlobalConfig: TextRenderGlobalConfig = {
    overlayConfig: payload.globalOverlayConfig,
    textLayers: payload.textLayers,
    headings: payload.headings,
  };

  if (segments.length === 0) {
    postOut({ type: 'run-done', runId, frameCount: 0 });
    postOut({ type: 'done', frameCount: 0 });
    return;
  }

  const canvas = new OffscreenCanvas(width, height);
  let contextLost = false;
  const gl = acquireOffscreenGlContext(canvas, {
    onLost: () => {
      contextLost = true;
    },
  });
  if (!gl) {
    postOut({ type: 'error', message: 'exportWorker: WebGL2 context unavailable in worker (acquireOffscreenGlContext returned null)' });
    return;
  }

  let compositor: GlCompositor;
  try {
    compositor = new GlCompositor(gl);
  } catch (e) {
    postOut({ type: 'error', message: `exportWorker: GlCompositor construction failed: ${errMessage(e)}` });
    return;
  }

  let textRenderer: GLTextRenderer;
  try {
    textRenderer = new GLTextRenderer(gl);
    await textRenderer.init(payload.fontConfigs ?? []);
  } catch (e) {
    postOut({ type: 'error', message: `exportWorker: GLTextRenderer construction/init failed: ${errMessage(e)}` });
    try {
      compositor.dispose();
    } catch {
      // best-effort
    }
    return;
  }

  let encoderFatalError: Error | null = null;
  let encoder: VideoEncoder;
  try {
    encoder = await createEncoder(
      width,
      height,
      fps,
      (chunk) => {
        const buf = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(buf);
        postOut({ type: 'chunk', runId, bytes: buf, chunkType: chunk.type, timestamp: chunk.timestamp }, [buf]);
      },
      (e) => {
        if (!encoderFatalError) encoderFatalError = new Error(`exportWorker: VideoEncoder error: ${e.message}`);
      },
    );
  } catch (e) {
    postOut({ type: 'error', message: errMessage(e) });
    try {
      compositor.dispose();
    } catch {
      // best-effort
    }
    try {
      textRenderer.dispose();
    } catch {
      // best-effort
    }
    return;
  }

  const runState = new RunState(assets);
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const runStartSec = first.startTime;
  const runEndSec = last.startTime + last.duration;
  const totalFrames = Math.max(0, Math.round((runEndSec - runStartSec) * fps));
  const frameDurUs = Math.round(1_000_000 / fps);
  const gop = gopFrames(fps);

  const segmentStartFrames = new Set<number>(
    segments.map((s) => Math.round((s.startTime - runStartSec) * fps)),
  );
  function isKeyFrame(i: number): boolean {
    return segmentStartFrames.has(i) || i % gop === 0;
  }

  let framesEmitted = 0;
  let cancelled = false;
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (cancelRequested) {
        cancelled = true;
        break;
      }
      if (encoderFatalError) throw encoderFatalError as Error;
      if (contextLost) {
        throw new Error('exportWorker: WebGL2 context lost mid-export — aborting (no restore attempted, per plan §4.1)');
      }

      const currentTime = runStartSec + i / fps;

      const rawParams = deriveCompositeParams(segments, currentTime, config);
      const plan = deriveSlotPlan(segments, currentTime, rawParams.transition, config);

      if (!plan.a) continue;

      const isTransitionFrame = !!rawParams.transition;

      const decodeAStart = performance.now();
      const aSrc = await runState.resolveSlotSource(plan.a, currentTime);
      timers.decodeMs += performance.now() - decodeAStart;
      if (!aSrc) continue;
      const uploadAStart = performance.now();
      uploadSlot(compositor, 'a', aSrc, width, height);
      timers.uploadMs += performance.now() - uploadAStart;

      if (plan.b) {
        const decodeBStart = performance.now();
        const bSrc = await runState.resolveSlotSource(plan.b, currentTime);
        timers.decodeMs += performance.now() - decodeBStart;
        if (!bSrc) continue;
        const uploadBStart = performance.now();
        uploadSlot(compositor, 'b', bSrc, width, height);
        timers.uploadMs += performance.now() - uploadBStart;
      }

      const renderStart = performance.now();
      compositor.renderFrame(rawParams);
      const renderElapsed = performance.now() - renderStart;
      if (isTransitionFrame) timers.compositeTransitionMs += renderElapsed;
      else timers.compositeNonTransitionMs += renderElapsed;

      const textStart = performance.now();
      const textSegment = resolveTextSegment(plan, rawParams.transition);
      textRenderer.renderFrame({
        segment: textSegment,
        global: textGlobalConfig,
        absoluteTime: currentTime,
        frameWidth: width,
        frameHeight: height,
      });
      timers.textMs += performance.now() - textStart;

      if (isTransitionFrame) timers.transitionFrames++;
      else timers.nonTransitionFrames++;

      if (encoder.encodeQueueSize > BACKPRESSURE_HIGH_WATER) {
        timers.backpressureHits++;
        const bpStart = performance.now();
        await waitForDequeue(encoder);
        timers.backpressureWaitMs += performance.now() - bpStart;
      }
      if (encoderFatalError) throw encoderFatalError as Error;

      const frameConstructStart = performance.now();
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: frameDurUs,
      });
      timers.frameConstructMs += performance.now() - frameConstructStart;
      const encodeStart = performance.now();
      try {
        encoder.encode(frame, { keyFrame: isKeyFrame(i) });
      } finally {
        frame.close();
      }
      timers.encodeCallMs += performance.now() - encodeStart;
      framesEmitted++;
      // Diagnostic: every frame, not every 5th (see this file's header) —
      // this run explicitly needs the real backpressure trajectory.
      postOut({ type: 'queue-sample', frameIndex: i, size: encoder.encodeQueueSize });
    }

    if (cancelled) {
      encoder.reset();
      encoder.close();
      postOut({ type: 'cancelled' });
      return;
    }

    const flushStart = performance.now();
    await encoder.flush();
    const flushMs = performance.now() - flushStart;
    postOut({ type: 'run-done', runId, frameCount: framesEmitted });
    postOut({
      type: 'phase-timing',
      report: {
        runId,
        totalFrames: framesEmitted,
        transitionFrames: timers.transitionFrames,
        nonTransitionFrames: timers.nonTransitionFrames,
        wallMs: performance.now() - runWallStart,
        decodeMs: timers.decodeMs,
        uploadMs: timers.uploadMs,
        compositeMs: timers.compositeTransitionMs + timers.compositeNonTransitionMs,
        compositeTransitionMs: timers.compositeTransitionMs,
        compositeNonTransitionMs: timers.compositeNonTransitionMs,
        textMs: timers.textMs,
        backpressureWaitMs: timers.backpressureWaitMs,
        frameConstructMs: timers.frameConstructMs,
        encodeCallMs: timers.encodeCallMs + flushMs,
        backpressureHits: timers.backpressureHits,
        imageBitmapCreateCounts: mapToRecord(runState.imageBitmapCreateCounts),
        decodeCallCounts: mapToRecord(runState.decodeCallCounts),
      },
    });
    postOut({ type: 'done', frameCount: framesEmitted });
  } catch (e) {
    postOut({ type: 'error', message: errMessage(e) });
    postOut({
      type: 'phase-timing',
      report: {
        runId,
        totalFrames: framesEmitted,
        transitionFrames: timers.transitionFrames,
        nonTransitionFrames: timers.nonTransitionFrames,
        wallMs: performance.now() - runWallStart,
        decodeMs: timers.decodeMs,
        uploadMs: timers.uploadMs,
        compositeMs: timers.compositeTransitionMs + timers.compositeNonTransitionMs,
        compositeTransitionMs: timers.compositeTransitionMs,
        compositeNonTransitionMs: timers.compositeNonTransitionMs,
        textMs: timers.textMs,
        backpressureWaitMs: timers.backpressureWaitMs,
        frameConstructMs: timers.frameConstructMs,
        encodeCallMs: timers.encodeCallMs,
        backpressureHits: timers.backpressureHits,
        imageBitmapCreateCounts: mapToRecord(runState.imageBitmapCreateCounts),
        decodeCallCounts: mapToRecord(runState.decodeCallCounts),
      },
    });
  } finally {
    await runState.disposeAll();
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      // best-effort
    }
    try {
      compositor.dispose();
    } catch {
      // best-effort
    }
    try {
      textRenderer.dispose();
    } catch {
      // best-effort
    }
  }
}

self.onmessage = (ev: MessageEvent<ExportWorkerInboundMessage>) => {
  const data = ev.data;
  if (data.type === 'init') {
    if (running) return;
    running = true;
    cancelRequested = false;
    void runExport(data).finally(() => {
      running = false;
    });
  } else if (data.type === 'cancel') {
    cancelRequested = true;
  }
};
