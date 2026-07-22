/**
 * THROWAWAY DIAGNOSTIC SPIKE FILE — byte-for-byte a copy of the real
 * `src/services/webcodecsExport/exportPipelineWebCodecs.ts` (production,
 * UNTOUCHED) with ADDED INSTRUMENTATION only:
 *
 *   1. Points at `./exportWorkerInstrumentedSpike.ts` instead of the real
 *      `../../services/webcodecsExport/exportWorker.ts` — the instrumented
 *      worker posts an extra `phase-timing` message this file records.
 *   2. Wraps the caller-supplied `ffmpeg` in a timing proxy
 *      (`instrumentFfmpeg`) that records wall time for every
 *      `appendFileRaw`/`exec`/`writeFile`/`readFile`/`deleteFile` call,
 *      bucketed by call type, plus a full per-call array for
 *      `appendFileRaw` (the plan's own §5 IPC-bottleneck question).
 *   3. Records the routing TIER decided for every piece (gl/plain/canvas)
 *      alongside its segment ids, and wall-clock brackets around routing,
 *      each piece's encode, concat, the frame-count guard, and mux.
 *   4. Returns an extended `{ result, diagnostics }` shape instead of the
 *      production `Promise<ExportResult>` — this file is not required to
 *      match the production call contract, only to exercise the identical
 *      orchestration logic with visibility added.
 *
 * Every other line of orchestration logic (routing, piece planning, encode
 * dispatch, concat, frame-count guard, mux) is UNCHANGED from the production
 * file — this is not a re-implementation, it is the same logic with a
 * stopwatch held up to it. Not imported by any production file. Delete
 * alongside the rest of this spike directory once this diagnostic is
 * reviewed.
 */

import type { Asset, HeadingOverlay, Project, TextOverlay, VideoSegment } from '../../types';
import {
  encodeSegment,
  encodePlainVideoSegment,
  encodeStaticImageSegment,
  type FfmpegLike,
} from '../../services/segmentEncoder';
import type { FrameGlobalConfig } from '../../services/frameRenderer';
import { resolveEffectiveTransition } from '../../services/transitionResolver';
import { isPlainVideoSegment, isPlainImageSegment } from '../../services/plainSegment';
import { isGlCompositableSegment, GL_TRANSITION_SLUGS } from '../../services/webcodecsExport/glCompositable';
import type { ExportError, ExportResult, ProgressCallback } from '../../services/exportPipeline';
import type { ProjectEffectConfig } from '../../services/gl/compositeParams';
import type {
  ExportWorkerInboundMessage,
  ExportWorkerInitMessage,
  ExportWorkerOutboundMessage,
  PhaseTimingReport,
} from './exportWorkerInstrumentedSpike';
import type { FontConfig } from '../../services/webcodecsExport/textRenderer';
import { muxOnly } from '../../services/webcodecsExport/muxOnly';

const EXPORT_FONT_CONFIGS: FontConfig[] = [];

export interface ExportOptionsWebCodecs {
  width?: number;
  height?: number;
  fps?: number;
  savePath?: string;
}

export interface WebCodecsFfmpeg extends FfmpegLike {
  appendFileRaw(path: string, data: Uint8Array): Promise<void>;
  saveSessionFile(fileName: string, destPath: string): Promise<void>;
  kill(): Promise<void>;
  destroy(): Promise<void>;
}

function causeString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// DIAGNOSTIC ADDITION 1 — ffmpeg IPC timing proxy.
// ---------------------------------------------------------------------------

export interface IpcCallTiming {
  method: string;
  args: string;
  ms: number;
}

export interface IpcTimingSummary {
  calls: IpcCallTiming[];
  totalsByMethod: Record<string, { count: number; totalMs: number; avgMs: number }>;
  appendFileRawCalls: number;
  appendFileRawTotalMs: number;
  appendFileRawAvgMs: number;
}

function instrumentFfmpeg(real: WebCodecsFfmpeg): { proxy: WebCodecsFfmpeg; timing: IpcCallTiming[] } {
  const timing: IpcCallTiming[] = [];
  function wrap<A extends unknown[], R>(method: string, fn: (...a: A) => Promise<R>, argsToString: (a: A) => string): (...a: A) => Promise<R> {
    return async (...a: A): Promise<R> => {
      const start = performance.now();
      try {
        return await fn(...a);
      } finally {
        timing.push({ method, args: argsToString(a), ms: performance.now() - start });
      }
    };
  }
  const proxy: WebCodecsFfmpeg = {
    ...real,
    writeFile: wrap<Parameters<WebCodecsFfmpeg['writeFile']>, Awaited<ReturnType<WebCodecsFfmpeg['writeFile']>>>(
      'writeFile', real.writeFile.bind(real), (a) => a[0],
    ),
    readFile: wrap<Parameters<WebCodecsFfmpeg['readFile']>, Awaited<ReturnType<WebCodecsFfmpeg['readFile']>>>(
      'readFile', real.readFile.bind(real), (a) => a[0],
    ),
    deleteFile: wrap<Parameters<WebCodecsFfmpeg['deleteFile']>, Awaited<ReturnType<WebCodecsFfmpeg['deleteFile']>>>(
      'deleteFile', real.deleteFile.bind(real), (a) => a[0],
    ),
    exec: wrap<Parameters<WebCodecsFfmpeg['exec']>, Awaited<ReturnType<WebCodecsFfmpeg['exec']>>>(
      'exec', real.exec.bind(real), (a) => a[0].join(' '),
    ),
    appendFileRaw: wrap<Parameters<WebCodecsFfmpeg['appendFileRaw']>, Awaited<ReturnType<WebCodecsFfmpeg['appendFileRaw']>>>(
      'appendFileRaw', real.appendFileRaw.bind(real), (a) => `${a[0]} (${a[1].byteLength}B)`,
    ),
    saveSessionFile: real.saveSessionFile.bind(real),
    kill: real.kill.bind(real),
    destroy: real.destroy.bind(real),
  };
  return { proxy, timing };
}

function summarizeIpcTiming(timing: IpcCallTiming[]): IpcTimingSummary {
  const totalsByMethod: Record<string, { count: number; totalMs: number; avgMs: number }> = {};
  for (const call of timing) {
    const bucket = totalsByMethod[call.method] ?? { count: 0, totalMs: 0, avgMs: 0 };
    bucket.count++;
    bucket.totalMs += call.ms;
    totalsByMethod[call.method] = bucket;
  }
  for (const key of Object.keys(totalsByMethod)) {
    const b = totalsByMethod[key]!;
    b.avgMs = b.totalMs / b.count;
  }
  const appendCalls = timing.filter((c) => c.method === 'appendFileRaw');
  const appendFileRawTotalMs = appendCalls.reduce((s, c) => s + c.ms, 0);
  return {
    calls: timing,
    totalsByMethod,
    appendFileRawCalls: appendCalls.length,
    appendFileRawTotalMs,
    appendFileRawAvgMs: appendCalls.length > 0 ? appendFileRawTotalMs / appendCalls.length : 0,
  };
}

// ---------------------------------------------------------------------------
// DIAGNOSTIC ADDITION 2 — routing + phase diagnostics accumulator.
// ---------------------------------------------------------------------------

export interface PieceDiagnostic {
  pieceIndex: number;
  tier: 'plain' | 'gl' | 'canvas';
  segmentIds: string[];
  expectedFrames: number;
  wallMs: number;
  phaseTiming: PhaseTimingReport | null;
}

export interface SegmentRoutingDiagnostic {
  segmentId: string;
  individualTier: 'plain' | 'gl' | 'canvas';
  finalTier: 'plain' | 'gl' | 'canvas';
  downgradedByGrouping: boolean;
}

export interface ExportDiagnostics {
  totalWallMs: number;
  routingMs: number;
  piecePlanningMs: number;
  encodeMs: number;
  concatMs: number;
  frameCountGuardMs: number;
  muxMs: number;
  segmentRouting: SegmentRoutingDiagnostic[];
  pieces: PieceDiagnostic[];
  ipc: IpcTimingSummary;
}

// ---------------------------------------------------------------------------
// Part 1 — Routing (UNCHANGED logic from production, only wrapped for
// diagnostics by the caller in Part 6 below).
// ---------------------------------------------------------------------------

type Tier = 'plain' | 'gl' | 'canvas';

function computeIndividualTier(
  segment: VideoSegment,
  prev: VideoSegment | undefined,
  next: VideoSegment | undefined,
  project: Project,
  assetMap: Map<string, Asset>,
): Tier {
  const asset = segment.assetId ? assetMap.get(segment.assetId) : undefined;
  const isPlain =
    (!!asset && asset.type === 'video' && isPlainVideoSegment(segment, prev, next, project)) ||
    (!!asset && asset.type === 'image' && isPlainImageSegment(segment, prev, next, project));
  if (isPlain) return 'plain';
  return isGlCompositableSegment(segment, project, { prev, next }) ? 'gl' : 'canvas';
}

class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function groupConnectedComponents(
  segments: readonly VideoSegment[],
  individualTiers: readonly Tier[],
  project: Project,
): Tier[] {
  const n = segments.length;
  const uf = new UnionFind(n);
  for (let i = 0; i < n - 1; i++) {
    const resolved = resolveEffectiveTransition(
      segments[i]!,
      project.globalTransition,
      project.globalTransitionDuration,
    );
    if (resolved.duration > 0 && GL_TRANSITION_SLUGS.has(resolved.transition)) {
      uf.union(i, i + 1);
    }
  }

  const componentHasNonGl = new Map<number, boolean>();
  for (let i = 0; i < n; i++) {
    if (individualTiers[i] === 'plain') continue;
    if (individualTiers[i] !== 'gl') componentHasNonGl.set(uf.find(i), true);
  }

  return individualTiers.map((tier, i) => {
    if (tier === 'plain') return 'plain';
    return componentHasNonGl.get(uf.find(i)) ? 'canvas' : 'gl';
  });
}

interface RoutingResult {
  tiers: Tier[];
  segmentDiagnostics: SegmentRoutingDiagnostic[];
}

function routeSegments(project: Project, assetMap: Map<string, Asset>): RoutingResult | { error: ExportError } {
  const segments = project.segments;
  const n = segments.length;
  const individualTiers: Tier[] = new Array(n);
  for (let i = 0; i < n; i++) {
    individualTiers[i] = computeIndividualTier(segments[i]!, segments[i - 1], segments[i + 1], project, assetMap);
  }
  const finalTiers = groupConnectedComponents(segments, individualTiers, project);

  for (let i = 0; i < n - 1; i++) {
    if (finalTiers[i] === finalTiers[i + 1]) continue;
    const resolved = resolveEffectiveTransition(segments[i]!, project.globalTransition, project.globalTransitionDuration);
    if (resolved.duration > 0) {
      return {
        error: {
          kind: 'concat',
          message:
            `Internal routing error: segment "${segments[i]!.id}" -> "${segments[i + 1]!.id}" ` +
            `is a real (${resolved.duration}s) transition spanning a tier boundary (${finalTiers[i]} -> ${finalTiers[i + 1]}). ` +
            'This should be structurally impossible — aborting rather than producing a broken export.',
        },
      };
    }
  }

  const segmentDiagnostics: SegmentRoutingDiagnostic[] = segments.map((s, i) => ({
    segmentId: s.id,
    individualTier: individualTiers[i]!,
    finalTier: finalTiers[i]!,
    downgradedByGrouping: individualTiers[i] !== finalTiers[i],
  }));

  return { tiers: finalTiers, segmentDiagnostics };
}

// ---------------------------------------------------------------------------
// Part 2 — Piece planning (UNCHANGED logic from production).
// ---------------------------------------------------------------------------

interface PiecePlan {
  tier: Tier;
  segments: VideoSegment[];
  startIndex: number;
  expectedFrames: number;
}

function buildPiecePlans(
  project: Project,
  tiers: readonly Tier[],
  fps: number,
  assetMap: Map<string, Asset>,
): PiecePlan[] {
  const segments = project.segments;
  const n = segments.length;
  const pieces: PiecePlan[] = [];
  let i = 0;
  while (i < n) {
    const tier = tiers[i]!;
    if (tier === 'gl') {
      let j = i;
      while (j + 1 < n && tiers[j + 1] === 'gl') j++;
      const runSegments = segments.slice(i, j + 1);
      const first = runSegments[0]!;
      const last = runSegments[runSegments.length - 1]!;
      const expectedFrames = Math.max(0, Math.round((last.startTime + last.duration - first.startTime) * fps));
      pieces.push({ tier: 'gl', segments: runSegments, startIndex: i, expectedFrames });
      i = j + 1;
    } else if (tier === 'plain') {
      const segment = segments[i]!;
      const asset = segment.assetId ? assetMap.get(segment.assetId) : undefined;
      const expectedFrames =
        asset?.type === 'video'
          ? Math.max(1, Math.ceil(segment.duration * fps))
          : Math.max(1, Math.round(segment.duration * fps));
      pieces.push({ tier: 'plain', segments: [segment], startIndex: i, expectedFrames });
      i++;
    } else {
      const segment = segments[i]!;
      const prev = segments[i - 1];
      const next = segments[i + 1];
      const startTimeOffset = prev
        ? resolveEffectiveTransition(prev, project.globalTransition, project.globalTransitionDuration).duration / 2
        : 0;
      const trailingExtension = next
        ? resolveEffectiveTransition(segment, project.globalTransition, project.globalTransitionDuration).duration / 2
        : 0;
      const expectedFrames = Math.max(1, Math.round((segment.duration - startTimeOffset + trailingExtension) * fps));
      pieces.push({ tier: 'canvas', segments: [segment], startIndex: i, expectedFrames });
      i++;
    }
  }
  return pieces;
}

// ---------------------------------------------------------------------------
// Part 3 — Driving a GL piece via the INSTRUMENTED worker (records
// phase-timing reports; everything else identical to production driveGlRun).
// ---------------------------------------------------------------------------

type RunDriveResult =
  | { ok: true; frameCount: number; phaseTiming: PhaseTimingReport | null }
  | { ok: false; error: ExportError; phaseTiming: PhaseTimingReport | null };

const WATCHDOG_MS = 30_000;

let activeWorker: Worker | null = null;

function driveGlRun(
  ffmpeg: WebCodecsFfmpeg,
  runId: string,
  runFile: string,
  segments: VideoSegment[],
  assets: Asset[],
  config: ProjectEffectConfig,
  width: number,
  height: number,
  fps: number,
  totalExpectedFrames: number,
  onFrameProgress: (frame: number, totalFrames: number) => void,
  textConfig: {
    fontConfigs: FontConfig[];
    globalOverlayConfig: Project['globalOverlayConfig'];
    textLayers: TextOverlay[];
    headings: HeadingOverlay[];
  },
): Promise<RunDriveResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./exportWorkerInstrumentedSpike.ts', import.meta.url), { type: 'module' });
    activeWorker = worker;

    let appendQueue: Promise<void> = Promise.resolve();
    let appendError: Error | null = null;
    let framesAppended = 0;
    let settled = false;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let phaseTiming: PhaseTimingReport | null = null;

    const clearWatchdog = (): void => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };
    const resetWatchdog = (): void => {
      clearWatchdog();
      watchdogTimer = setTimeout(() => {
        finish({
          ok: false,
          error: { kind: 'unknown', message: 'Export worker produced no output for 30s — aborting (watchdog).' },
          phaseTiming,
        });
      }, WATCHDOG_MS);
    };

    const finish = (result: RunDriveResult): void => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      if (activeWorker === worker) activeWorker = null;
      worker.terminate();
      resolve(result);
    };

    worker.onmessage = (ev: MessageEvent<ExportWorkerOutboundMessage>) => {
      const data = ev.data;
      switch (data.type) {
        case 'chunk': {
          resetWatchdog();
          const bytes = new Uint8Array(data.bytes);
          appendQueue = appendQueue.then(async () => {
            if (appendError || settled) return;
            try {
              await ffmpeg.appendFileRaw(runFile, bytes);
              framesAppended++;
              onFrameProgress(framesAppended, totalExpectedFrames);
            } catch (err) {
              appendError = err instanceof Error ? err : new Error(causeString(err));
            }
          });
          break;
        }
        case 'run-done':
          break;
        case 'phase-timing':
          phaseTiming = data.report;
          break;
        case 'done':
          void appendQueue.then(() => {
            if (appendError) {
              finish({
                ok: false,
                error: { kind: 'encode', message: 'Failed to append an encoded chunk to disk.', cause: appendError.message },
                phaseTiming,
              });
              return;
            }
            finish({ ok: true, frameCount: data.frameCount, phaseTiming });
          });
          break;
        case 'error':
          finish({ ok: false, error: { kind: 'encode', message: 'Export worker reported an error.', cause: data.message }, phaseTiming });
          break;
        case 'cancelled':
          finish({ ok: false, error: { kind: 'cancelled', message: 'Export cancelled.' }, phaseTiming });
          break;
        case 'queue-sample':
          resetWatchdog();
          break;
      }
    };

    worker.onerror = (ev: ErrorEvent) => {
      finish({
        ok: false,
        error: { kind: 'encode', message: 'Export worker crashed.', cause: `${ev.message} at ${ev.filename}:${ev.lineno}` },
        phaseTiming,
      });
    };

    const initMsg: ExportWorkerInitMessage = {
      type: 'init',
      runId,
      segments,
      assets,
      config,
      width,
      height,
      fps,
      fontConfigs: textConfig.fontConfigs,
      globalOverlayConfig: textConfig.globalOverlayConfig,
      textLayers: textConfig.textLayers,
      headings: textConfig.headings,
    };
    resetWatchdog();
    worker.postMessage(initMsg);
  });
}

// ---------------------------------------------------------------------------
// Part 4 — Driving Tier 1 / Tier C pieces + the annexb remux (UNCHANGED
// logic from production).
// ---------------------------------------------------------------------------

async function remuxMp4ToAnnexb(ffmpeg: WebCodecsFfmpeg, mp4File: string, h264File: string): Promise<void> {
  await ffmpeg.exec(['-i', mp4File, '-c', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', '-y', h264File]);
}

interface PieceEncodeSuccess {
  ok: true;
  h264File: string;
}
type PieceEncodeResult = PieceEncodeSuccess | { ok: false; error: ExportError };

async function encodeTier1Piece(
  ffmpeg: WebCodecsFfmpeg,
  segment: VideoSegment,
  asset: Asset,
  globalConfig: FrameGlobalConfig,
  fps: number,
  width: number,
  height: number,
  pieceIndex: number,
): Promise<PieceEncodeResult> {
  const mp4File = `tier1_piece_${pieceIndex}.mp4`;
  const h264File = `piece_${pieceIndex}.h264`;
  try {
    const mp4Bytes =
      asset.type === 'video'
        ? await encodePlainVideoSegment(segment, asset, ffmpeg, { fps, width, height })
        : await encodeStaticImageSegment(segment, asset, globalConfig, ffmpeg, { fps, width, height });
    await ffmpeg.writeFile(mp4File, mp4Bytes);
    await remuxMp4ToAnnexb(ffmpeg, mp4File, h264File);
  } catch (err) {
    return {
      ok: false,
      error: { kind: 'encode', message: `Failed to encode Tier 1 segment "${segment.id}".`, segmentIndex: pieceIndex, cause: causeString(err) },
    };
  } finally {
    await ffmpeg.deleteFile(mp4File).catch(() => undefined);
  }
  return { ok: true, h264File };
}

async function encodeCanvasPiece(
  ffmpeg: WebCodecsFfmpeg,
  plan: PiecePlan,
  project: Project,
  assetMap: Map<string, Asset>,
  globalConfig: FrameGlobalConfig,
  fps: number,
  width: number,
  height: number,
  pieceIndex: number,
  onFrameProgress: (frame: number, totalFrames: number) => void,
): Promise<PieceEncodeResult> {
  const segment = plan.segments[0]!;
  const prevSegment = project.segments[plan.startIndex - 1];
  const nextSegment = project.segments[plan.startIndex + 1];
  const asset = segment.assetId ? assetMap.get(segment.assetId) : undefined;
  const nextAsset = nextSegment?.assetId ? assetMap.get(nextSegment.assetId) : undefined;

  const startTimeOffset = prevSegment
    ? resolveEffectiveTransition(prevSegment, project.globalTransition, project.globalTransitionDuration).duration / 2
    : 0;
  const trailingExtension = nextSegment
    ? resolveEffectiveTransition(segment, project.globalTransition, project.globalTransitionDuration).duration / 2
    : 0;

  const mp4File = `canvas_piece_${pieceIndex}.mp4`;
  const h264File = `piece_${pieceIndex}.h264`;
  try {
    const mp4Bytes = await encodeSegment(segment, asset, ffmpeg, globalConfig, {
      fps,
      width,
      height,
      nextSegment,
      nextAsset,
      globalTransitionDuration: project.globalTransitionDuration,
      globalTransition: project.globalTransition,
      startTimeOffset,
      trailingExtension,
      onProgress: onFrameProgress,
    });
    await ffmpeg.writeFile(mp4File, mp4Bytes);
    await remuxMp4ToAnnexb(ffmpeg, mp4File, h264File);
  } catch (err) {
    return {
      ok: false,
      error: { kind: 'encode', message: `Failed to encode canvas segment "${segment.id}".`, segmentIndex: pieceIndex, cause: causeString(err) },
    };
  } finally {
    await ffmpeg.deleteFile(mp4File).catch(() => undefined);
  }
  return { ok: true, h264File };
}

// ---------------------------------------------------------------------------
// Part 5 — Concat + frame-count guard (UNCHANGED logic from production).
// ---------------------------------------------------------------------------

export function countAnnexbFrames(bytes: Uint8Array): number {
  let count = 0;
  const n = bytes.length;
  let i = 0;
  while (i < n - 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      const headerIdx = i + 3;
      if (headerIdx < n) {
        const nalType = bytes[headerIdx]! & 0x1f;
        if (nalType === 1 || nalType === 5) count++;
      }
      i = headerIdx;
    } else {
      i++;
    }
  }
  return count;
}

export async function concatAnnexbPieces(ffmpeg: WebCodecsFfmpeg, pieceFiles: string[], outFile: string): Promise<void> {
  await ffmpeg.exec(['-f', 'h264', '-i', `concat:${pieceFiles.join('|')}`, '-c', 'copy', '-y', outFile]);
}

// ---------------------------------------------------------------------------
// Part 6 — Main orchestrator, WITH DIAGNOSTICS.
// ---------------------------------------------------------------------------

export interface ExportProjectWebCodecsInstrumentedResult {
  result: ExportResult;
  diagnostics: ExportDiagnostics;
}

export async function exportProjectWebCodecsInstrumented(
  project: Project,
  rawFfmpeg: WebCodecsFfmpeg,
  options: ExportOptionsWebCodecs = {},
  onProgress: ProgressCallback = () => undefined,
): Promise<ExportProjectWebCodecsInstrumentedResult> {
  const totalWallStart = performance.now();
  const { proxy: ffmpeg, timing: ipcTiming } = instrumentFfmpeg(rawFfmpeg);

  const fps = options.fps ?? 30;
  const rawWidth = options.width ?? 1920;
  const rawHeight = options.height ?? 1080;
  const width = rawWidth % 2 === 0 ? rawWidth : rawWidth - 1;
  const height = rawHeight % 2 === 0 ? rawHeight : rawHeight - 1;

  const diagnostics: ExportDiagnostics = {
    totalWallMs: 0,
    routingMs: 0,
    piecePlanningMs: 0,
    encodeMs: 0,
    concatMs: 0,
    frameCountGuardMs: 0,
    muxMs: 0,
    segmentRouting: [],
    pieces: [],
    ipc: { calls: [], totalsByMethod: {}, appendFileRawCalls: 0, appendFileRawTotalMs: 0, appendFileRawAvgMs: 0 },
  };

  const segments = project.segments;
  if (segments.length === 0) {
    diagnostics.totalWallMs = performance.now() - totalWallStart;
    diagnostics.ipc = summarizeIpcTiming(ipcTiming);
    return { result: { ok: false, error: { kind: 'encode', message: 'Project has no segments to export.' } }, diagnostics };
  }

  const assetMap = new Map<string, Asset>(project.assets.map((a) => [a.id, a]));

  for (const segment of segments) {
    if (!segment.assetId) continue;
    const asset = assetMap.get(segment.assetId);
    if (!asset?.url) {
      diagnostics.totalWallMs = performance.now() - totalWallStart;
      diagnostics.ipc = summarizeIpcTiming(ipcTiming);
      return { result: { ok: false, error: { kind: 'asset_missing', message: `Segment "${segment.id}" has no asset` } }, diagnostics };
    }
  }

  const routingStart = performance.now();
  const routing = routeSegments(project, assetMap);
  diagnostics.routingMs = performance.now() - routingStart;
  if ('error' in routing) {
    diagnostics.totalWallMs = performance.now() - totalWallStart;
    diagnostics.ipc = summarizeIpcTiming(ipcTiming);
    return { result: { ok: false, error: routing.error }, diagnostics };
  }
  diagnostics.segmentRouting = routing.segmentDiagnostics;

  const piecePlanningStart = performance.now();
  const pieces = buildPiecePlans(project, routing.tiers, fps, assetMap);
  diagnostics.piecePlanningMs = performance.now() - piecePlanningStart;
  const totalExpectedFramesOverall = pieces.reduce((sum, p) => sum + p.expectedFrames, 0);

  const config: ProjectEffectConfig = {
    globalTransition: project.globalTransition,
    globalTransitionDuration: project.globalTransitionDuration,
  };
  const globalConfig: FrameGlobalConfig = {
    overlayConfig: project.globalOverlayConfig,
    globalOverlayFilter: project.globalOverlayFilter,
    globalTextLayers: project.textLayers ?? [],
    headings: project.headings ?? [],
  };

  onProgress({ type: 'loading_ffmpeg' });

  const pieceFiles: string[] = [];
  let framesCompletedBase = 0;
  const encodeStart = performance.now();

  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
    const plan = pieces[pieceIndex]!;
    const pieceWallStart = performance.now();
    const frameOffsetForThisPiece = framesCompletedBase;
    const onFrameProgress = (frame: number): void => {
      onProgress({
        type: 'encoding_segment',
        index: pieceIndex,
        total: pieces.length,
        frame: frameOffsetForThisPiece + frame,
        totalFrames: totalExpectedFramesOverall,
      });
    };

    let phaseTiming: PhaseTimingReport | null = null;

    if (plan.tier === 'gl') {
      const referencedAssets: Asset[] = [];
      const seen = new Set<string>();
      for (const segment of plan.segments) {
        if (!segment.assetId) continue;
        const asset = assetMap.get(segment.assetId);
        if (asset && !seen.has(asset.id)) {
          seen.add(asset.id);
          referencedAssets.push(asset);
        }
      }
      const runFile = `piece_${pieceIndex}.h264`;
      const driveResult = await driveGlRun(
        ffmpeg,
        `run_${pieceIndex}`,
        runFile,
        plan.segments,
        referencedAssets,
        config,
        width,
        height,
        fps,
        plan.expectedFrames,
        onFrameProgress,
        {
          fontConfigs: EXPORT_FONT_CONFIGS,
          globalOverlayConfig: project.globalOverlayConfig,
          textLayers: project.textLayers ?? [],
          headings: project.headings ?? [],
        },
      );
      phaseTiming = driveResult.phaseTiming;
      if (!driveResult.ok) {
        diagnostics.pieces.push({
          pieceIndex,
          tier: plan.tier,
          segmentIds: plan.segments.map((s) => s.id),
          expectedFrames: plan.expectedFrames,
          wallMs: performance.now() - pieceWallStart,
          phaseTiming,
        });
        diagnostics.encodeMs = performance.now() - encodeStart;
        diagnostics.totalWallMs = performance.now() - totalWallStart;
        diagnostics.ipc = summarizeIpcTiming(ipcTiming);
        return { result: { ok: false, error: driveResult.error }, diagnostics };
      }
      pieceFiles.push(runFile);
    } else if (plan.tier === 'plain') {
      const segment = plan.segments[0]!;
      const asset = assetMap.get(segment.assetId!)!;
      const result = await encodeTier1Piece(ffmpeg, segment, asset, globalConfig, fps, width, height, pieceIndex);
      onFrameProgress(plan.expectedFrames);
      if (!result.ok) {
        diagnostics.pieces.push({
          pieceIndex,
          tier: plan.tier,
          segmentIds: plan.segments.map((s) => s.id),
          expectedFrames: plan.expectedFrames,
          wallMs: performance.now() - pieceWallStart,
          phaseTiming: null,
        });
        diagnostics.encodeMs = performance.now() - encodeStart;
        diagnostics.totalWallMs = performance.now() - totalWallStart;
        diagnostics.ipc = summarizeIpcTiming(ipcTiming);
        return { result: { ok: false, error: result.error }, diagnostics };
      }
      pieceFiles.push(result.h264File);
    } else {
      const result = await encodeCanvasPiece(ffmpeg, plan, project, assetMap, globalConfig, fps, width, height, pieceIndex, onFrameProgress);
      if (!result.ok) {
        diagnostics.pieces.push({
          pieceIndex,
          tier: plan.tier,
          segmentIds: plan.segments.map((s) => s.id),
          expectedFrames: plan.expectedFrames,
          wallMs: performance.now() - pieceWallStart,
          phaseTiming: null,
        });
        diagnostics.encodeMs = performance.now() - encodeStart;
        diagnostics.totalWallMs = performance.now() - totalWallStart;
        diagnostics.ipc = summarizeIpcTiming(ipcTiming);
        return { result: { ok: false, error: result.error }, diagnostics };
      }
      pieceFiles.push(result.h264File);
    }

    diagnostics.pieces.push({
      pieceIndex,
      tier: plan.tier,
      segmentIds: plan.segments.map((s) => s.id),
      expectedFrames: plan.expectedFrames,
      wallMs: performance.now() - pieceWallStart,
      phaseTiming,
    });

    framesCompletedBase += plan.expectedFrames;
  }
  diagnostics.encodeMs = performance.now() - encodeStart;

  onProgress({ type: 'muxing' });

  const videoAllFile = 'video_all.h264';
  const concatStart = performance.now();
  try {
    if (pieceFiles.length === 1) {
      // single piece — no concat call needed (matches production)
    } else {
      await concatAnnexbPieces(ffmpeg, pieceFiles, videoAllFile);
    }
  } catch (err) {
    diagnostics.concatMs = performance.now() - concatStart;
    diagnostics.totalWallMs = performance.now() - totalWallStart;
    diagnostics.ipc = summarizeIpcTiming(ipcTiming);
    return { result: { ok: false, error: { kind: 'concat', message: 'Failed to concatenate the encoded pieces.', cause: causeString(err) } }, diagnostics };
  }
  diagnostics.concatMs = performance.now() - concatStart;
  const finalVideoFile = pieceFiles.length === 1 ? pieceFiles[0]! : videoAllFile;

  const guardStart = performance.now();
  try {
    const rawBytes = await ffmpeg.readFile(finalVideoFile);
    const bytes = typeof rawBytes === 'string' ? new TextEncoder().encode(rawBytes) : rawBytes;
    const actualFrames = countAnnexbFrames(bytes);
    diagnostics.frameCountGuardMs = performance.now() - guardStart;
    if (actualFrames !== totalExpectedFramesOverall) {
      diagnostics.totalWallMs = performance.now() - totalWallStart;
      diagnostics.ipc = summarizeIpcTiming(ipcTiming);
      return {
        result: {
          ok: false,
          error: {
            kind: 'concat',
            message:
              `Concatenated output frame count (${actualFrames}) does not match the expected total (${totalExpectedFramesOverall}) ` +
              `across ${pieces.length} piece(s) — aborting rather than shipping a corrupt export.`,
          },
        },
        diagnostics,
      };
    }
  } catch (err) {
    diagnostics.frameCountGuardMs = performance.now() - guardStart;
    diagnostics.totalWallMs = performance.now() - totalWallStart;
    diagnostics.ipc = summarizeIpcTiming(ipcTiming);
    return { result: { ok: false, error: { kind: 'concat', message: 'Failed to verify the concatenated output frame count.', cause: causeString(err) } }, diagnostics };
  }

  const outputFile = 'export_final.mp4';
  const voiceoverAsset = project.voiceoverId ? assetMap.get(project.voiceoverId) : undefined;
  let audioFile: string | null = null;

  const muxStart = performance.now();
  try {
    if (voiceoverAsset?.url) {
      audioFile = 'voiceover_audio';
      const audioResp = await fetch(voiceoverAsset.url);
      const audioBytes = new Uint8Array(await audioResp.arrayBuffer());
      await ffmpeg.writeFile(audioFile, audioBytes);
    }
  } catch (err) {
    diagnostics.muxMs = performance.now() - muxStart;
    diagnostics.totalWallMs = performance.now() - totalWallStart;
    diagnostics.ipc = summarizeIpcTiming(ipcTiming);
    return { result: { ok: false, error: { kind: 'mux', message: 'Failed to prepare the voiceover audio for muxing.', cause: causeString(err) } }, diagnostics };
  }

  try {
    await muxOnly(ffmpeg, project.id, finalVideoFile, audioFile, outputFile, fps);
  } catch (err) {
    diagnostics.muxMs = performance.now() - muxStart;
    diagnostics.totalWallMs = performance.now() - totalWallStart;
    diagnostics.ipc = summarizeIpcTiming(ipcTiming);
    return { result: { ok: false, error: { kind: 'mux', message: 'Failed to mux the encoded output with audio.', cause: causeString(err) } }, diagnostics };
  }
  diagnostics.muxMs = performance.now() - muxStart;

  const intermediates = [...pieceFiles, videoAllFile, ...(audioFile ? [audioFile] : [])].filter((f) => f !== outputFile);
  await Promise.allSettled(intermediates.map((f) => ffmpeg.deleteFile(f)));

  if (options.savePath) {
    try {
      await ffmpeg.saveSessionFile(outputFile, options.savePath);
    } catch (err) {
      diagnostics.totalWallMs = performance.now() - totalWallStart;
      diagnostics.ipc = summarizeIpcTiming(ipcTiming);
      return { result: { ok: false, error: { kind: 'unknown', message: 'Failed to save the exported file to disk.', cause: causeString(err) } }, diagnostics };
    }
  }

  diagnostics.totalWallMs = performance.now() - totalWallStart;
  diagnostics.ipc = summarizeIpcTiming(ipcTiming);
  onProgress({ type: 'done' });
  return { result: { ok: true, outputFile }, diagnostics };
}
