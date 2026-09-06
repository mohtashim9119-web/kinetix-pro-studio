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

/**
 * Given watchdog-resetting output events on the main thread, list silent gaps
 * and attribute each to the phase that was live for the gap duration.
 */
export function attributeSilentIntervals(
  outputEvents: readonly WatchdogOutputEvent[],
  phaseLog: readonly ExportPhaseLogEntry[],
  minDurationMs = 0,
): SilentIntervalAttribution[] {
  if (outputEvents.length < 2) return [];
  const out: SilentIntervalAttribution[] = [];
  for (let i = 1; i < outputEvents.length; i++) {
    const prev = outputEvents[i - 1]!;
    const cur = outputEvents[i]!;
    const durationMs = cur.atMs - prev.atMs;
    if (durationMs < minDurationMs) continue;
    const phase = phaseAtTime(phaseLog, prev.atMs);
    out.push({
      startMs: prev.atMs,
      endMs: cur.atMs,
      durationMs,
      phase,
      framesEncodedAtStart: framesAtTime(phaseLog, prev.atMs),
      frameIndexAtStart: framesAtTime(phaseLog, prev.atMs) > 0 ? framesAtTime(phaseLog, prev.atMs) - 1 : null,
    });
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
