/// <reference lib="webworker" />
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The WebCodecs+WebGL2 export worker entry point (docs/webcodecs-export-plan.md
 * §4.1). This is Step 3 of that plan: decode → composite → ENCODE → STREAM.
 * Step 2's postMessage-frame-out flow (transferring raw VideoFrames to the
 * main thread for pixel verification) is gone — replaced with a real
 * VideoEncoder whose annexb-formatted EncodedVideoChunk bytes stream to the
 * main thread for append-to-disk. NO text renderer (Step 6) and NO multi-run
 * orchestration (Step 5 — this worker still processes exactly one GL-
 * compositable run per `init` message, matching Step 2's protocol) — both
 * deliberately absent, not stubbed.
 *
 * Per-frame loop for one GL-compositable RUN (docs/webcodecs-export-plan.md
 * §3.3 — a maximal contiguous span of segments the plan's routing predicate
 * has already decided are GL-expressible; that predicate itself is Step 5
 * scope, already implemented in glCompositable.ts/exportPipelineWebCodecs.ts):
 *
 *   1. DECODE    — sequentialDecode.decodeSegmentFrames (Step 1), one
 *                  dedicated decode cursor per segment, opened lazily.
 *   2. COMPOSITE — deriveSlotPlan + deriveCompositeParams (compositeParams.ts,
 *                  unmodified) decide what this tick looks like and which
 *                  segment(s) feed texture slots 'a'/'b'; GlCompositor
 *                  (glCompositor.ts, unmodified, the REAL production class)
 *                  uploads + renders.
 *   3. TEXT      — GLTextRenderer (Step 6, textRenderer.ts) draws every
 *                  visible text element (extraOverlays, global text layers,
 *                  body caption, Path B heading) on top of the composited
 *                  frame — see resolveTextSegment's own doc comment below
 *                  for which segment's text shows during an active
 *                  transition.
 *   4. ENCODE    — backpressure-paced VideoEncoder.encode() of a VideoFrame
 *                  wrapping the composited OffscreenCanvas, annexb output.
 *   5. STREAM    — each EncodedVideoChunk's bytes are copied out and
 *                  transferred to the main thread (zero-copy) for the
 *                  orchestrator to append to this run's .h264 file.
 *
 * Worker-safe: no React, no DOM module, no `window` anywhere in this file's
 * import graph. Traced import-by-import in this step's own report.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced by the declare below, not used as a value
declare const self: DedicatedWorkerGlobalScope;

import type { Asset, HeadingOverlay, TextOverlay, VideoSegment } from '../../types';
import { GlCompositor, type TextureSlot, type UploadSource } from '../gl/glCompositor';
import { deriveCompositeParams, deriveSlotPlan, type ProjectEffectConfig } from '../gl/compositeParams';
import { acquireOffscreenGlContext } from '../gl/glContext';
import { computeObjectCoverUvRect } from '../gl/uvRect';
import { decodeSegmentFrames } from './sequentialDecode';
import { GLTextRenderer, type FontConfig, type TextRenderGlobalConfig } from './textRenderer';

// ---------------------------------------------------------------------------
// Message protocol
// ---------------------------------------------------------------------------

export interface ExportWorkerInitMessage {
  type: 'init';
  /** Identifies this run to the main-thread orchestrator — echoed back on
   *  every `chunk`/`run-done` message so a caller managing several runs
   *  (Step 5) can route bytes to the right `run_K.h264`. This worker only
   *  ever processes ONE run per `init` (Step 5's multi-run-per-worker
   *  sequencing is out of this step's scope), so `run-done` always follows
   *  immediately by `done`. */
  runId: string;
  /** One GL-compositable run, in timeline order — length 1 for a plain
   *  segment, length > 1 when adjacent segments share a real transition.
   *  `deriveCompositeParams`/`deriveSlotPlan` only ever look within this
   *  array (they take `segments` as a parameter), so passing a run's own
   *  slice here — rather than the whole project — is correct and is exactly
   *  how Step 5's real orchestrator will call this worker per run. */
  segments: VideoSegment[];
  /** Every asset any segment in `segments` references. `asset.url` must be
   *  fetchable from this worker — a blob: URL created on the main thread is
   *  (videoDemuxer.ts's own doc comment: "Blob URLs created on the main
   *  thread are fetchable from a same-origin dedicated worker"). */
  assets: Asset[];
  config: ProjectEffectConfig;
  width: number;
  height: number;
  fps: number;
  /**
   * Step 6 text-rendering config (docs/webcodecs-export-plan.md §4.3/§8) —
   * ALL OPTIONAL. `exportPipelineWebCodecs.ts` (explicitly out of this
   * step's scope — see the Step 6 report) does not yet populate these when
   * it constructs a real init message, so every text-consuming code path
   * below must degrade gracefully to "render no global/heading text, and a
   * body caption against DEFAULT_GLOBAL_OVERLAY_CONFIG" rather than throw
   * or crash when they're absent — exactly the posture `segment.extraOverlays`
   * (never optional-by-omission; always present or `undefined` on the
   * segment itself) already has today.
   */
  fontConfigs?: FontConfig[];
  globalOverlayConfig?: { color: string; backgroundColor: string; fontFamily: string; fontSize?: number };
  textLayers?: TextOverlay[];
  headings?: HeadingOverlay[];
}

export type ExportWorkerInboundMessage = ExportWorkerInitMessage | { type: 'cancel' };

export type ExportWorkerOutboundMessage =
  // chunkType/timestamp are diagnostic additions beyond the plan's minimal
  // {type,runId,bytes} shape (§4.1) — free to include (already available in
  // the encoder's output callback) and let a consumer reconstruct real
  // EncodedVideoChunk objects for a decode round-trip, which is exactly how
  // this step's own spike verifies the stream without a bundled ffprobe
  // binary. `bytes` remains the field an appendFileRaw-based orchestrator
  // actually needs; the extra fields are additive, never required.
  | { type: 'chunk'; runId: string; bytes: ArrayBuffer; chunkType: EncodedVideoChunkType; timestamp: number }
  | { type: 'run-done'; runId: string; frameCount: number }
  | { type: 'done'; frameCount: number }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }
  // Diagnostic-only, sampled periodically (not every frame, to keep message
  // volume sane on a long real export) — lets a caller (this step's own
  // spike) chart the backpressure trajectory. No orchestrator depends on
  // this; safe to ignore.
  | { type: 'queue-sample'; frameIndex: number; size: number };

function postOut(message: ExportWorkerOutboundMessage, transfer?: Transferable[]): void {
  if (transfer) self.postMessage(message, transfer);
  else self.postMessage(message);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

// ---------------------------------------------------------------------------
// Segment-local <-> source-time mapping.
//
// Deliberately duplicated from src/hooks/useWebCodecsPreview.ts's toSourceTime
// (lines 129-134) and sourceRange (lines 139-144) rather than imported — that
// file is a React hook module (`import { useEffect, ... } from 'react'` at
// module scope), and the plan's worker-safety rule (§4.1: "No React, no DOM
// module in the graph") forbids pulling any part of it into this worker's
// bundle, even a single otherwise-pure named export. This is a real gap in
// the plan's own written import graph (§4.1 does not list a worker-safe
// source-time helper at all) — flagged in this step's report rather than
// silently working around it. Keep these two functions byte-identical to
// their hook-file counterparts if either ever changes; a divergence here
// would silently desync preview and export's idea of "the right frame",
// exactly the drift class Section 4 of the plan exists to prevent.
// ---------------------------------------------------------------------------

function toSourceTime(
  segment: VideoSegment,
  currentTime: number,
  sourceDuration: number | undefined,
): number {
  const segmentProgress = currentTime - (segment.startTime ?? 0);
  const rawTime = (segment.trimStart || 0) + segmentProgress;
  const videoTime = sourceDuration !== undefined
    ? Math.min(rawTime, sourceDuration)
    : rawTime;
  return Math.max(0, videoTime);
}

function sourceRange(
  segment: VideoSegment,
  sourceDuration: number | undefined,
): { start: number; end: number } {
  const start = segment.trimStart || 0;
  const rawEnd = start + segment.duration;
  const end = sourceDuration !== undefined
    ? Math.min(rawEnd, sourceDuration)
    : rawEnd;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Per-segment sequential decode cursor.
//
// Wraps ONE decodeSegmentFrames() generator (Step 1) per video segment and
// exposes "give me the frame at-or-before this source time," pulling more
// decoded frames forward as needed and closing whatever is superseded — the
// same selection semantics videoDecoderPool.ts's getFrameAt documents, but
// over a plain forward generator instead of a session/window/LRU pool: export
// walks every segment's source time strictly forward within a run (no scrub,
// no backward seek), so none of that pool's reset/eviction machinery applies
// here. NOT a retrofit of that pool, matching sequentialDecode.ts's own
// design note.
// ---------------------------------------------------------------------------

interface DecodeCursor {
  gen: AsyncGenerator<VideoFrame>;
  /** Most recently decoded frame not yet confirmed <= the requested target —
   *  becomes `current` once a target at or past it is requested. */
  pending: VideoFrame | null;
  /** The frame last handed back by `frameAt` — owned by this cursor (closed
   *  here when superseded), NOT by whichever render tick borrowed it. */
  current: VideoFrame | null;
  /** True once the generator has yielded its last frame for this segment's range. */
  exhausted: boolean;
}

function openCursor(segment: VideoSegment, assetUrl: string, sourceDuration: number | undefined): DecodeCursor {
  const { start, end } = sourceRange(segment, sourceDuration);
  return { gen: decodeSegmentFrames(assetUrl, start, end), pending: null, current: null, exhausted: false };
}

/** Advances `cursor` until the latest decoded frame at-or-before `targetSec`
 *  is known, returning it (or null if the segment's range produced nothing
 *  yet). Frames superseded along the way are closed — this cursor is their
 *  only owner once `decodeSegmentFrames` yields them.
 *
 *  Frame-0 fix (Step 3, replacing Step 2's known limitation): when NO earlier
 *  frame exists yet (`cursor.current` is still null) and the next decoded
 *  frame lands strictly after `targetSec`, use it anyway instead of returning
 *  null. An arbitrary trim point rarely lands exactly on the source's frame
 *  grid, so the segment's first decoded frame can legitimately have a
 *  timestamp a few milliseconds past the requested target — legacy
 *  frameRenderer.ts's seekVideo has the same shape (it sets
 *  `<video>.currentTime` and draws whatever frame the browser resolves the
 *  seek to, not strictly the frame at-or-before), so this matches the
 *  parity baseline rather than inventing new behavior. Once `current` is
 *  set for the first time, every later call reverts to strict at-or-before
 *  selection. */
async function frameAt(cursor: DecodeCursor, targetSec: number): Promise<VideoFrame | null> {
  for (;;) {
    if (cursor.pending) {
      const pendingSec = cursor.pending.timestamp / 1e6;
      if (pendingSec > targetSec) {
        if (cursor.current) break; // current already IS the at-or-before answer
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
  // Drains the generator's own cleanup (finally block — closes its decoder)
  // by signaling early termination, exactly the contract sequentialDecode.ts
  // documents for a caller that stops before the generator runs itself dry.
  await cursor.gen.return(undefined).catch(() => {});
}

// ---------------------------------------------------------------------------
// Slot content resolution — video (via a DecodeCursor) or still image (via a
// cached ImageBitmap). No color/missing-asset handling: this skeleton's own
// GL-compositable-segment scope (Step 5's routing predicate, not yet built)
// is video/image content only.
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

  constructor(assets: readonly Asset[]) {
    this.assetById = new Map(assets.map((a) => [a.id, a]));
  }

  async resolveSlotSource(seg: VideoSegment, currentTime: number): Promise<SlotSource | null> {
    const asset = seg.assetId ? this.assetById.get(seg.assetId) : undefined;
    if (!asset) return null;

    if (asset.type === 'video') {
      let cursor = this.cursors.get(seg.id);
      if (!cursor) {
        cursor = openCursor(seg, asset.url, asset.duration);
        this.cursors.set(seg.id, cursor);
      }
      const targetSec = toSourceTime(seg, currentTime, asset.duration);
      const frame = await frameAt(cursor, targetSec);
      if (!frame) return null;
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      if (!w || !h) return null; // a closed/superseded frame reads back 0x0 on some engines
      return { source: frame, w, h };
    }

    if (asset.type === 'image') {
      let bmp = this.imageBitmaps.get(asset.id);
      if (!bmp) {
        const resp = await fetch(asset.url);
        if (!resp.ok) throw new Error(`exportWorker: fetch failed (${resp.status}) for image asset ${asset.id} (${asset.url})`);
        bmp = await createImageBitmap(await resp.blob());
        this.imageBitmaps.set(asset.id, bmp);
      }
      return { source: bmp, w: bmp.width, h: bmp.height };
    }

    return null; // audio/other — nothing GL-renderable, matches useGlPreview.ts's own resolveSlotSource
  }

  async disposeAll(): Promise<void> {
    for (const cursor of this.cursors.values()) await closeCursor(cursor);
    this.cursors.clear();
    for (const bmp of this.imageBitmaps.values()) bmp.close();
    this.imageBitmaps.clear();
  }
}

function uploadSlot(compositor: GlCompositor, slot: TextureSlot, src: SlotSource, dstW: number, dstH: number): void {
  // COVER, not preview's contain — matching legacy export's drawImageCover
  // (docs/webcodecs-export-plan.md §4.5's explicit decision; frameRenderer.ts
  // is the parity baseline, untouched).
  const texRect = computeObjectCoverUvRect(src.w, src.h, dstW, dstH);
  compositor.uploadFrame(slot, src.source, texRect);
}

// ---------------------------------------------------------------------------
// VideoEncoder construction — hardware-first ladder with per-rung probe AND
// configure-time fallback (plan §4.1: isConfigSupported can pass and
// configure() can still fail — both routes must fall through to the next
// rung, not just the probe).
// ---------------------------------------------------------------------------

/** H.264 High profile, level 4.0 — appropriate for the 1080p30 spike target;
 *  a higher level would be needed for 4K (noted, not this step's scope). */
const EXPORT_CODEC = 'avc1.640028';
/** Visually-acceptable for the Step 3 spike; NOT quality-matched to the
 *  legacy libx264 crf16 path — that comparison is Step 8's job. Tuning point,
 *  not a permanent setting. */
const EXPORT_BITRATE = 8_000_000;
const HARDWARE_LADDER: HardwareAcceleration[] = ['prefer-hardware', 'no-preference', 'prefer-software'];
/** Backpressure threshold (plan §4.1) — encodeQueueSize above this pauses the
 *  frame loop until the encoder dequeues work, bounding in-flight VideoFrames. */
const BACKPRESSURE_HIGH_WATER = 4;
/** 2-second GOP cap (plan §4.1 item 4e), in frames. */
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
    avc: { format: 'annexb' as const }, // REQUIRED — WebCodecs defaults to AVCC (length-prefixed, out-of-band
    // description); concatenating AVCC chunk payloads as a raw .h264 file
    // produces an undecodable stream. annexb (start-code-prefixed) is what
    // ffmpeg expects reading `-f h264`.
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

    // isConfigSupported passing does not guarantee configure() succeeds
    // (plan §9.2 / §4.1) — a real construction+configure attempt is required.
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
        // best-effort — configure failure may leave the encoder in a state where close() itself throws
      }
    }
  }

  throw new Error(`exportWorker: no VideoEncoder config in the hardware-first ladder succeeded — [${attempts.join(' | ')}]`);
}

/** Resolves the next time `encoder.encodeQueueSize` decreases. Registered
 *  synchronously right after the caller's own size check (no `await` in
 *  between), so there is no window for a 'dequeue' event to fire and be
 *  missed between the check and the listener attaching. */
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

/**
 * Which segment's text (extraOverlays / global text layers / body caption)
 * shows this tick — the question the plan's §4.3 element-set description
 * leaves implicit for the "is a transition active" case (it describes ONE
 * segment's fields; frameRenderer.ts's answer during a transition is "both,
 * blended together" since each segment's fully-texted canvas is blended by
 * the transition's own alpha — a compositing model this GL pipeline does
 * not have, since text is a single post-blend pass over an already-blended
 * VIDEO frame, not two independently-texted frames).
 *
 * This resolves the ambiguity the SAME way compositeParams.ts's own grade
 * derivation already does for the identical problem (grade is also a single
 * post-blend pass — see deriveCompositeParams's `grade` derivation and its
 * doc comment: "It follows the CONTAINING segment ... during a centered
 * transition window the playhead is inside the outgoing segment for the
 * first half and the incoming for the second, so it snaps at the boundary
 * midpoint. That midpoint-snap is the accepted Phase 4 limitation."): text
 * snaps from the outgoing segment's text to the incoming segment's text at
 * the SAME transition-progress midpoint (0.5) grade already snaps at,
 * derived here from the same `rawParams.transition.progress` value
 * `deriveCompositeParams` already computed this tick (no re-derivation of
 * `resolveActiveBoundary`'s private logic needed) rather than a real
 * cross-fade of two text layers. Flagged plainly: this is a real,
 * deliberate divergence from `frameRenderer.ts`'s blended-both-segments'-
 * text behavior during a transition window, made because it is the already-
 * accepted, already-precedented answer to the identical "two segments, one
 * post-blend pass" shape, not a new limitation invented for text.
 */
function resolveTextSegment(
  plan: { a: VideoSegment | null; b: VideoSegment | null },
  transition: { progress: number } | null,
): VideoSegment | null {
  if (!transition) return plan.a;
  return transition.progress < 0.5 ? plan.a : plan.b;
}

async function runExport(payload: ExportWorkerInitMessage): Promise<void> {
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
      // Hard fail (plan §4.1) — no restore attempt. The loop below checks
      // this flag every tick and stops rather than issuing more GL calls
      // against a lost context.
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

  // Frame indices (run-local, 0-based) that must be keyframes because they
  // are the first frame of a segment within this run (plan §4.1 item 4e).
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

      // Absolute-index timestamps (plan §7.1): rounding the PRODUCT, not the
      // per-frame step, so timestamps never drift across a long run. `i` is
      // this RUN's own frame index (Step 5's multi-run orchestrator will
      // drive one worker call per run, same as this step) — raw annexb
      // carries no embedded container timing anyway (plan §7.2), so what
      // matters here is monotonic, gap-free per-run ordering for the
      // encoder's own GOP/reorder bookkeeping, which a run-local index gives
      // exactly as well as a whole-project index would.
      const currentTime = runStartSec + i / fps;

      const rawParams = deriveCompositeParams(segments, currentTime, config);
      const plan = deriveSlotPlan(segments, currentTime, rawParams.transition, config);

      if (!plan.a) continue; // outside every segment this tick — should not happen within [runStartSec, runEndSec), defensive only

      const aSrc = await runState.resolveSlotSource(plan.a, currentTime);
      if (!aSrc) continue; // decode not ready yet this tick
      uploadSlot(compositor, 'a', aSrc, width, height);

      if (plan.b) {
        const bSrc = await runState.resolveSlotSource(plan.b, currentTime);
        if (!bSrc) continue;
        uploadSlot(compositor, 'b', bSrc, width, height);
      }

      compositor.renderFrame(rawParams);

      // Step 6 text pass — after GlCompositor's grade pass, before the
      // VideoFrame is constructed from this same canvas (plan §4.1 item 2 /
      // §4.3 point 2: text composites on top of video+grade+transition).
      // See resolveTextSegment's own doc comment for which segment's text
      // shows during an active transition.
      const textSegment = resolveTextSegment(plan, rawParams.transition);
      textRenderer.renderFrame({
        segment: textSegment,
        global: textGlobalConfig,
        absoluteTime: currentTime,
        frameWidth: width,
        frameHeight: height,
      });

      // Backpressure (plan §4.1, required): GL compositing is fast relative
      // to hardware encode; without this, in-flight VideoFrames would queue
      // unboundedly. Checked AFTER compositing (so the GL work for this tick
      // is already done) and BEFORE constructing/encoding this tick's frame.
      if (encoder.encodeQueueSize > BACKPRESSURE_HIGH_WATER) {
        await waitForDequeue(encoder);
      }
      if (encoderFatalError) throw encoderFatalError as Error;

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: frameDurUs,
      });
      try {
        encoder.encode(frame, { keyFrame: isKeyFrame(i) });
      } finally {
        // encode() snapshots/refs the frame synchronously per spec — safe
        // (and required, to bound worker memory) to close immediately after.
        frame.close();
      }
      framesEmitted++;
      if (i % 5 === 0) postOut({ type: 'queue-sample', frameIndex: i, size: encoder.encodeQueueSize });
    }

    if (cancelled) {
      // Cancel primitive (plan §9.1): reset() drops all queued/in-flight
      // encoder work synchronously — NEVER flush() on cancel, which would
      // instead wait for that work to finish (the opposite of cancel).
      encoder.reset();
      encoder.close();
      postOut({ type: 'cancelled' });
      return;
    }

    await encoder.flush();
    postOut({ type: 'run-done', runId, frameCount: framesEmitted });
    postOut({ type: 'done', frameCount: framesEmitted });
  } catch (e) {
    postOut({ type: 'error', message: errMessage(e) });
  } finally {
    await runState.disposeAll();
    // Single close point for every path (success, error, cancel already
    // closed it itself and this is then a guarded no-op) — flush() does not
    // close the encoder, so the success path still needs this.
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      // best-effort — a close failure must not mask whatever error/result already posted above
    }
    try {
      compositor.dispose();
    } catch {
      // best-effort — a dispose failure must not mask whatever error/result already posted above
    }
    try {
      textRenderer.dispose();
    } catch {
      // best-effort — a dispose failure must not mask whatever error/result already posted above
    }
  }
}

self.onmessage = (ev: MessageEvent<ExportWorkerInboundMessage>) => {
  const data = ev.data;
  if (data.type === 'init') {
    if (running) return; // single export at a time (plan §9.3) — ignore a second init while one run is active
    running = true;
    cancelRequested = false;
    void runExport(data).finally(() => {
      running = false;
    });
  } else if (data.type === 'cancel') {
    cancelRequested = true;
  }
};
