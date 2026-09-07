/**
 * Shared export-worker diagnostic payload — same shape on success and every
 * terminal failure path. Phase log is capped so memory stays O(1) vs project
 * size (see PHASE_LOG_CAP).
 */

import type { ExportDemuxSplit } from './exportPhaseTracker';

/**
 * Rolling phase-transition log capacity. At PHASE_THROTTLE_MS (250 ms) one
 * `pulse()` per phase yields at most 4 entries/s; 128 entries cover ~32 s of
 * continuous single-phase activity — above WATCHDOG_MS (30 s) — without
 * growing with segment or frame count.
 */
export const PHASE_LOG_CAP = 128;

export interface ExportPhaseLogEntry {
  seq: number;
  /** Milliseconds since export run start (worker or main-thread clock). */
  atMs: number;
  phase: string;
  pieceIndex: number;
  segmentIndex: number;
  assetId: string | null;
  framesEncoded: number;
  kind: 'enter' | 'pulse';
}

export type ExportFailureVia =
  | 'encoder-callback'
  | 'thrown'
  | 'gl-context-lost'
  | 'cancel'
  | 'init-error'
  | 'watchdog'
  | 'worker-crash'
  | 'append-error';

export interface ExportFailureIdentity {
  name: string | null;
  message: string;
  via: ExportFailureVia;
  frameIndex: number | null;
  timelineSec: number | null;
}

export interface ExportWorkerDiagnosticsPayload {
  phaseMs: Record<string, number>;
  instrumentationMs: number;
  demuxSplit: ExportDemuxSplit[];
  framesEncoded: number;
  pieceIndex: number;
  lastPhase: string | null;
  phaseLog: ExportPhaseLogEntry[];
  failure: ExportFailureIdentity | null;
  demuxCacheSize: number | null;
  workerHeapBytes: number | null;
  /** Cumulative decoded source VideoFrames handed to the compositor this run. */
  decodedSourceFrames: number;
  /** Encoded output chunks emitted by VideoEncoder this run. */
  encodedChunkCount: number;
  encodedKeyframeCount: number;
  encodedChunkBytes: number;
  /** VideoDecoder instances created this run (one per open decode cursor). */
  decodersCreated: number;
  /** VideoDecoder instances still open at terminal snapshot. */
  decodersOpen: number;
  /** Per-segment decode cursors opened this run. */
  cursorsCreated: number;
  /** Decode cursors still resident at terminal snapshot. */
  openCursors: number;
  /** High-water mark of simultaneously open decode cursors this run. */
  peakOpenCursors: number;
  /** Cached ImageBitmaps still open at terminal snapshot. */
  openImageBitmaps: number;
  /** Diagnostic-only: rolling SHA-256 over the RGBA of every frame submitted
   *  to the encoder, and how many frames it covers. Null unless the init
   *  message opted in via `frameContentDigest` (see frameContentDigest.ts —
   *  the encoded bytes are not reproducible run to run, so this is the gate
   *  that can actually show two runs composited the same pixels). */
  frameContentDigest: string | null;
  frameContentDigestFrames: number | null;
}

export interface WatchdogOutputEvent {
  atMs: number;
  kind: 'chunk' | 'queue-sample';
}

export interface SilentIntervalAttribution {
  startMs: number;
  endMs: number;
  durationMs: number;
  phase: string | null;
  framesEncodedAtStart: number;
  frameIndexAtStart: number | null;
}

/** Ring-buffer push — drops oldest entries once at cap. */
export function pushPhaseLogEntry(log: ExportPhaseLogEntry[], entry: ExportPhaseLogEntry): void {
  log.push(entry);
  if (log.length > PHASE_LOG_CAP) log.shift();
}

/** Phase live at `atMs`: last log entry whose timestamp is <= atMs. */
export function phaseAtTime(log: readonly ExportPhaseLogEntry[], atMs: number): string | null {
  let phase: string | null = null;
  for (const e of log) {
    if (e.atMs <= atMs) phase = e.phase;
    else break;
  }
  return phase;
}

/** Frames encoded at `atMs` from the phase log. */
export function framesAtTime(log: readonly ExportPhaseLogEntry[], atMs: number): number {
  let frames = 0;
  for (const e of log) {
    if (e.atMs <= atMs) frames = e.framesEncoded;
    else break;
  }
  return frames;
}

function pushSilentGap(
  out: SilentIntervalAttribution[],
  startMs: number,
  endMs: number,
  phaseLog: readonly ExportPhaseLogEntry[],
  minDurationMs: number,
): void {
  const durationMs = endMs - startMs;
  if (durationMs < minDurationMs) return;
  const frames = framesAtTime(phaseLog, startMs);
  out.push({
    startMs,
    endMs,
    durationMs,
    phase: phaseAtTime(phaseLog, startMs),
    framesEncodedAtStart: frames,
    frameIndexAtStart: frames > 0 ? frames - 1 : null,
  });
}

/**
 * Given watchdog-resetting output events on the main thread, list silent gaps
 * and attribute each to the phase that was live for the gap duration.
 *
 * When `endMs` is supplied (failure / watchdog paths), the terminal gap from
 * the last output event through `endMs` is always recorded — not folded into
 * `maxSilentMs` alone.
 */
export function attributeSilentIntervals(
  outputEvents: readonly WatchdogOutputEvent[],
  phaseLog: readonly ExportPhaseLogEntry[],
  minDurationMs = 0,
  endMs?: number,
): SilentIntervalAttribution[] {
  const out: SilentIntervalAttribution[] = [];

  if (outputEvents.length === 0) {
    if (endMs !== undefined) pushSilentGap(out, 0, endMs, phaseLog, minDurationMs);
    return out;
  }

  for (let i = 1; i < outputEvents.length; i++) {
    const prev = outputEvents[i - 1]!;
    const cur = outputEvents[i]!;
    pushSilentGap(out, prev.atMs, cur.atMs, phaseLog, minDurationMs);
  }

  if (endMs !== undefined) {
    const last = outputEvents[outputEvents.length - 1]!;
    pushSilentGap(out, last.atMs, endMs, phaseLog, minDurationMs);
  }

  return out;
}

export function failureFromUnknown(err: unknown, via: ExportFailureVia, frameIndex: number | null, timelineSec: number | null): ExportFailureIdentity {
  if (err instanceof DOMException) {
    return { name: err.name, message: err.message, via, frameIndex, timelineSec };
  }
  if (err instanceof Error) {
    return { name: err.name || null, message: err.stack ?? err.message, via, frameIndex, timelineSec };
  }
  return { name: null, message: String(err), via, frameIndex, timelineSec };
}

export function formatFailureMessage(f: ExportFailureIdentity): string {
  const where =
    f.frameIndex !== null && f.timelineSec !== null
      ? ` at frame ${f.frameIndex} (t=${f.timelineSec.toFixed(3)}s)`
      : f.frameIndex !== null
        ? ` at frame ${f.frameIndex}`
        : '';
  const namePart = f.name ? `${f.name}: ` : '';
  return `Export worker ${f.via}${where}: ${namePart}${f.message}`;
}
