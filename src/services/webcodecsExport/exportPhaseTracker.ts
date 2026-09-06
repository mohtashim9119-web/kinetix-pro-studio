/**
 * Worker-side export phase / work-token tracker.
 *
 * Posts a `{ type: 'phase' }` token on every phase change (few of those)
 * and at most once per `PHASE_THROTTLE_MS` while a phase is in progress
 * (so the frame loop cannot flood `postMessage`). Accumulates per-phase
 * elapsed ms for the terminal `done` message.
 *
 * Instrumentation cost is measured by wrapping every public method with
 * `now()` and summing into `instrumentationMs` — the same shape as
 * `src-tauri/src/fa_timing.rs`'s StageAccumulator overhead probe.
 *
 * Output-neutral by construction: this module never touches encoder
 * configuration, frame timestamps, compositing, or piece boundaries. The
 * worker calls it around existing work; it does not replace any of it.
 */

import {
  PHASE_LOG_CAP,
  pushPhaseLogEntry,
  type ExportPhaseLogEntry,
} from './exportWorkerDiagnostics';

export const PHASE_THROTTLE_MS = 250;

export interface ExportPhaseToken {
  type: 'phase';
  phase: string;
  pieceIndex: number;
  segmentIndex: number;
  assetId: string | null;
  framesEncoded: number;
  seq: number;
}

export interface ExportDemuxSplit {
  assetId: string;
  fetchMs: number;
  parseMs: number;
}

export interface ExportPhaseBreakdown {
  phaseMs: Record<string, number>;
  instrumentationMs: number;
  demuxSplit: ExportDemuxSplit[];
  phaseLog: ExportPhaseLogEntry[];
  lastPhase: string | null;
  framesEncoded: number;
}

export class ExportPhaseTracker {
  private seq = 0;
  private lastPostedAt = Number.NEGATIVE_INFINITY;
  /** Nested phase stack — innermost active phase is the top entry. */
  private readonly stack: string[] = [];
  private phaseStartedAt = 0;
  private readonly totals = new Map<string, number>();
  private instrumentationMs = 0;
  private framesEncoded = 0;
  private segmentIndex = 0;
  private assetId: string | null = null;
  private readonly demuxSplit: ExportDemuxSplit[] = [];
  private readonly phaseLog: ExportPhaseLogEntry[] = [];
  private readonly runStartedAt: number;
  private lastPhaseName: string | null = null;

  private currentPhase(): string | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1]! : null;
  }

  constructor(
    private readonly post: (msg: ExportPhaseToken) => void,
    private readonly pieceIndex: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.runStartedAt = this.now();
  }

  setContext(segmentIndex: number, assetId: string | null): void {
    const t0 = this.now();
    this.segmentIndex = segmentIndex;
    this.assetId = assetId;
    this.instrumentationMs += this.now() - t0;
  }

  setFramesEncoded(n: number): void {
    const t0 = this.now();
    this.framesEncoded = n;
    this.instrumentationMs += this.now() - t0;
  }

  /** Push `phase` onto the stack (nested inside the current phase, if any). Posts immediately. */
  enter(phase: string): void {
    const t0 = this.now();
    this.flushCurrent(t0);
    this.stack.push(phase);
    this.phaseStartedAt = t0;
    this.postNow(phase, t0, 'enter');
    this.instrumentationMs += this.now() - t0;
  }

  /** Pop the innermost phase and resume timing on the parent. Posts the parent phase. */
  leave(): void {
    const t0 = this.now();
    this.flushCurrent(t0);
    if (this.stack.length > 0) this.stack.pop();
    this.phaseStartedAt = t0;
    const parent = this.currentPhase();
    if (parent) this.postNow(parent, t0, 'enter');
    this.instrumentationMs += this.now() - t0;
  }

  /**
   * Accumulates `ms` into `phase` without changing the current phase.
   * Used for overlapping sub-timers (waitForDequeue inside the frame loop,
   * fetch vs parse inside a demux wall-clock).
   */
  add(phase: string, ms: number): void {
    const t0 = this.now();
    this.totals.set(phase, (this.totals.get(phase) ?? 0) + ms);
    this.instrumentationMs += this.now() - t0;
  }

  recordDemuxSplit(assetId: string, fetchMs: number, parseMs: number): void {
    const t0 = this.now();
    this.demuxSplit.push({ assetId, fetchMs, parseMs });
    this.instrumentationMs += this.now() - t0;
  }

  /**
   * Throttled work-token while staying in the current phase. No-op when
   * called more often than `PHASE_THROTTLE_MS`.
   */
  pulse(): void {
    const t0 = this.now();
    const phase = this.currentPhase();
    if (phase && t0 - this.lastPostedAt >= PHASE_THROTTLE_MS) {
      this.postNow(phase, t0, 'pulse');
    }
    this.instrumentationMs += this.now() - t0;
  }

  finish(): ExportPhaseBreakdown {
    const t0 = this.now();
    this.flushCurrent(t0);
    this.stack.length = 0;
    const phaseMs: Record<string, number> = {};
    for (const [k, v] of this.totals) phaseMs[k] = v;
    this.instrumentationMs += this.now() - t0;
    return {
      phaseMs,
      instrumentationMs: this.instrumentationMs,
      demuxSplit: this.demuxSplit.slice(),
      phaseLog: this.phaseLog.slice(),
      lastPhase: this.lastPhaseName,
      framesEncoded: this.framesEncoded,
    };
  }

  /** Live snapshot without closing the run — for request-diagnostics / abort. */
  snapshot(): ExportPhaseBreakdown {
    const t0 = this.now();
    const phaseMs: Record<string, number> = {};
    for (const [k, v] of this.totals) phaseMs[k] = v;
    const live = this.currentPhase();
    if (live) {
      const elapsed = t0 - this.phaseStartedAt;
      phaseMs[live] = (phaseMs[live] ?? 0) + elapsed;
    }
    this.instrumentationMs += this.now() - t0;
    return {
      phaseMs,
      instrumentationMs: this.instrumentationMs,
      demuxSplit: this.demuxSplit.slice(),
      phaseLog: this.phaseLog.slice(),
      lastPhase: this.lastPhaseName ?? live,
      framesEncoded: this.framesEncoded,
    };
  }

  private flushCurrent(now: number): void {
    const live = this.currentPhase();
    if (!live) return;
    const elapsed = now - this.phaseStartedAt;
    this.totals.set(live, (this.totals.get(live) ?? 0) + elapsed);
  }

  private postNow(phase: string, now: number, kind: 'enter' | 'pulse'): void {
    this.lastPostedAt = now;
    this.lastPhaseName = phase;
    this.seq += 1;
    pushPhaseLogEntry(this.phaseLog, {
      seq: this.seq,
      atMs: now - this.runStartedAt,
      phase,
      pieceIndex: this.pieceIndex,
      segmentIndex: this.segmentIndex,
      assetId: this.assetId,
      framesEncoded: this.framesEncoded,
      kind,
    });
    this.post({
      type: 'phase',
      phase,
      pieceIndex: this.pieceIndex,
      segmentIndex: this.segmentIndex,
      assetId: this.assetId,
      framesEncoded: this.framesEncoded,
      seq: this.seq,
    });
  }
}
