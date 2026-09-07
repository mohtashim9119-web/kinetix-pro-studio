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
 *
 * That assumption holds for a single long-lived phase but not for a run that
 * also pushes an `enter()`/`leave()` pair per segment (one per cold decode
 * cursor — see `exportWorker.ts`'s `resolveSlotSource`): a multi-minute,
 * many-segment run can push far more than 128 entries over its lifetime, and
 * `attributeSilentIntervals` (`exportPipelineWebCodecs.ts`) reads this log
 * *retrospectively* at the very end of the run against an uncapped
 * `outputEvents` history — so once the log's surviving window no longer
 * reaches back to an early gap, that gap's phase/frame attribution reads as
 * the ring buffer's initialized default (`null`/`0`), not because nothing was
 * ever tracked there, but because it was evicted before anyone asked
 * (WS3, 2026-09-07 silent-gaps diagnosis, `docs/ws3-silent-gaps-diagnosis.md`).
 *
 * `DEV_PHASE_LOG_CAP` widens the window for diagnostic runs only — it is
 * resolved by Vite/esbuild at build time via `import.meta.env.DEV` and
 * dead-code-eliminated to the original 128 in a production build
 * (`npm run tauri:build`), so this is a diagnostics-only capacity increase,
 * not a behavior change: nothing in `ExportPhaseTracker` reads this value to
 * gate timing, pacing, or encoder work — it only bounds how much history a
 * plain array retains.
 */
const DEV_PHASE_LOG_CAP = 8192;

/**
 * WS3 Defect 5 — the PRODUCTION cap, raised from 128 to 1024.
 *
 * 128 was sized against "one long-lived phase at 4 pulses/s" (~32s of history)
 * and is far too small for a real export, which also pushes an `enter()` per
 * cold decode cursor. A 20-minute run evicted everything before anyone asked,
 * which is exactly why the field payloads that motivated this round carry no
 * attribution at all.
 *
 * WHY 1024, and why it cannot simply grow:
 *
 *  - It is sized to span ONE capped piece, which is now a bounded thing:
 *    MAX_ENCODER_SESSION_FRAMES (1800 frames, 60s at 30fps) at PHASE_THROTTLE_MS
 *    (250 ms) is ~240 pulses, plus one enter/leave pair per segment in the
 *    piece (~20 segments on a 3s-average project, so ~40 more). Call it ~280
 *    entries for a full piece; 1024 is ~3.6x that. A window that reaches back
 *    across the whole piece is what `attributeSilentIntervals` needs, and
 *    nothing is served by reaching further than the piece the gap happened in.
 *  - The cost is NOT one log. `WebCodecsRunDiagnostics.glPieces` retains a
 *    `phaseLog` copy per finished GL piece for the whole export, so the real
 *    memory is `cap x pieces x entry`. An `ExportPhaseLogEntry` is 8 fields
 *    including an interned phase string and an asset-id string reference —
 *    ~150 bytes in V8. At 1024 that is ~150 KB per log, and a ~23-piece export
 *    (Defect 1's plan for the 1268.7s field job) retains ~3.4 MB. At the DEV
 *    cap of 8192 the same export would retain ~28 MB, which is why the DEV
 *    value is not simply promoted to production.
 *  - `pushPhaseLogEntry` evicts with `Array.shift()`, which is O(n) once at
 *    cap. At 1024 entries and ~4 pushes/s that is negligible; at 8192+ it
 *    starts to be real work on the export's own hot path.
 *
 * So the cap multiplies with the piece count, and the piece count now grows
 * with timeline length — that product is the reason there is a ceiling here at
 * all, and the reason it is 1024 rather than "as much as we can afford".
 */
const PROD_PHASE_LOG_CAP = 1024;
export const PHASE_LOG_CAP = import.meta.env.DEV ? DEV_PHASE_LOG_CAP : PROD_PHASE_LOG_CAP;

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
  | 'append-error'
  /** Forward-progress bound (exportPipelineWebCodecs.ts's FORWARD_PROGRESS_BOUND_MS)
   *  fired: no append actually completed for the bound, even though worker
   *  messages (chunk/queue-sample) may have kept arriving and resetting the
   *  message-based WATCHDOG_MS timer in the meantime — see that constant's
   *  own doc comment for why message arrival alone is not proof of progress. */
  | 'stall';

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
  /**
   * WS3 Defect 3 — `encodeStats.chunkCount` AT THE MOMENT `encoder.flush()`
   * was entered, or `null` if the run never reached the flush phase.
   *
   * Why this exists: a legitimately slow flush and a hung flush were
   * indistinguishable in a payload. `encodedChunkCount` alone is a total, so a
   * watchdog payload with `lastPhase: "encoder-flush"` could not say whether
   * any chunk had drained SINCE the flush began. The difference
   * `encodedChunkCount - encodedChunkCountAtFlushStart` answers exactly that,
   * and costs one integer copy on the flush path.
   */
  encodedChunkCountAtFlushStart: number | null;
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
  /** Diagnostics-only (WS3 silent-gaps round): segment/asset live at `startMs`
   *  per the phase log, same eviction caveat as `phase` above — `null` once
   *  the gap predates the log's surviving window. */
  segmentIndexAtStart: number | null;
  assetIdAtStart: string | null;
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

/** Log entry live at `atMs` (last entry whose timestamp is <= atMs), or null
 *  before the log's first surviving entry / once it has been evicted —
 *  diagnostics-only, backs `segmentIndexAtStart`/`assetIdAtStart` below. */
function entryAtTime(
  log: readonly ExportPhaseLogEntry[],
  atMs: number,
): ExportPhaseLogEntry | null {
  let found: ExportPhaseLogEntry | null = null;
  for (const e of log) {
    if (e.atMs <= atMs) found = e;
    else break;
  }
  return found;
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
  const entry = entryAtTime(phaseLog, startMs);
  out.push({
    startMs,
    endMs,
    durationMs,
    phase: phaseAtTime(phaseLog, startMs),
    segmentIndexAtStart: entry?.segmentIndex ?? null,
    assetIdAtStart: entry?.assetId ?? null,
    framesEncodedAtStart: frames,
    frameIndexAtStart: frames > 0 ? frames - 1 : null,
  });
}

/**
 * WS3 Defect 7 — the INCREMENTAL form of `pushSilentGap`, for a caller that
 * records a gap the moment it closes instead of retaining every output event
 * and attributing them all at the end.
 *
 * Two reasons this is the better shape, not just the cheaper one:
 *  1. Memory. `driveGlRun` pushed one `WatchdogOutputEvent` per chunk AND per
 *     queue-sample, then called `attributeSilentIntervals` with
 *     `minDurationMs = 0`, which emits one attribution per CONSECUTIVE PAIR.
 *     On the 38061-frame field run that is ~45k events and ~45k attributions
 *     per GL piece, all retained in `WebCodecsRunDiagnostics.glPieces` for the
 *     whole export.
 *  2. Accuracy. Attributing at the END reads a phase log that has since rolled
 *     over, so an early gap resolves to the ring buffer's defaults rather than
 *     to what was actually live. Attributing at gap-close reads the log while
 *     the gap's own entries are still in it.
 */
export function buildSilentGap(
  startMs: number,
  endMs: number,
  phaseLog: readonly ExportPhaseLogEntry[],
  minDurationMs: number,
): SilentIntervalAttribution | null {
  const out: SilentIntervalAttribution[] = [];
  pushSilentGap(out, startMs, endMs, phaseLog, minDurationMs);
  return out[0] ?? null;
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
