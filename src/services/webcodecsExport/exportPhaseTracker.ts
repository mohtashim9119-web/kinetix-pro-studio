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
}

export class ExportPhaseTracker {
  private seq = 0;
  private lastPostedAt = Number.NEGATIVE_INFINITY;
  private current: string | null = null;
  private currentStartedAt = 0;
  private readonly totals = new Map<string, number>();
  private instrumentationMs = 0;
  private framesEncoded = 0;
  private segmentIndex = 0;
  private assetId: string | null = null;
  private readonly demuxSplit: ExportDemuxSplit[] = [];

  constructor(
    private readonly post: (msg: ExportPhaseToken) => void,
    private readonly pieceIndex: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

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

  /** Ends the previous phase (if any) and starts `phase`. Posts immediately. */
  enter(phase: string): void {
    const t0 = this.now();
    this.flushCurrent(t0);
    this.current = phase;
    this.currentStartedAt = t0;
    this.postNow(phase, t0);
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
    if (this.current && t0 - this.lastPostedAt >= PHASE_THROTTLE_MS) {
      this.postNow(this.current, t0);
    }
    this.instrumentationMs += this.now() - t0;
  }

  finish(): ExportPhaseBreakdown {
    const t0 = this.now();
    this.flushCurrent(t0);
    this.current = null;
    const phaseMs: Record<string, number> = {};
    for (const [k, v] of this.totals) phaseMs[k] = v;
    this.instrumentationMs += this.now() - t0;
    return {
      phaseMs,
      instrumentationMs: this.instrumentationMs,
      demuxSplit: this.demuxSplit.slice(),
    };
  }

  private flushCurrent(now: number): void {
    if (!this.current) return;
    const elapsed = now - this.currentStartedAt;
    this.totals.set(this.current, (this.totals.get(this.current) ?? 0) + elapsed);
  }

  private postNow(phase: string, now: number): void {
    this.lastPostedAt = now;
    this.seq += 1;
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
