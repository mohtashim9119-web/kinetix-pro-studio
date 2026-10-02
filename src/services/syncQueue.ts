/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U7 — the bulk queue: N sync jobs, back to back.
//
// ENGINE-AGNOSTIC. Nothing in this file knows about the cloud, projects or
// Modal. A `QueueJob` is "an id, a label, and an async run"; the engine
// supplies four hooks (`QueueEngine`: a GPU-seconds counter, a price, a
// cancel-receipt sentence, and a drain hook). A future job shape (the
// Frontier pipeline) plugs in by writing its own `QueueJob`s and engine.
//
// WHAT THE QUEUE GUARANTEES
//  - Strictly one job at a time, next one starts the moment the last ends —
//    no timers, no polling, no idle gap the queue itself introduces. The next
//    job's `prepare` runs WHILE the current one runs, so its inputs are ready
//    before the GPU is free.
//  - A job that PAUSES or FAILS stops only itself. The queue moves on.
//  - `carry` is an opaque per-batch value passed job to job. The cloud job
//    uses it to hand a kept GPU container down the line (one cold start).
//    When the batch drains, or a cancel breaks the chain, `engine.onDrain`
//    lets go of whatever is still carried.
//  - Cancel anywhere. Queued: nothing had started, nothing is charged.
//    Running: the job's signal aborts and the engine writes the receipt (U5
//    semantics). Either way the queue continues with the next job.
//  - Honest progress: every item exposes its 1-based position, its state and
//    its current phase text; the batch exposes done/paused/failed/cancelled
//    counts and one cost line.
// ---------------------------------------------------------------------------

export type QueueItemStatus = 'queued' | 'running' | 'done' | 'skipped' | 'paused' | 'failed' | 'cancelled';

export type QueueJobOutcome =
  | { status: 'done'; detail?: string }
  /** Nothing to do (already up to date, not eligible): not a failure. */
  | { status: 'skipped'; detail: string }
  /** The job stopped itself and left its own restart-safe ask. */
  | { status: 'paused'; reason: string; detail?: string }
  | { status: 'failed'; detail: string };

export interface QueueRunContext {
  signal: AbortSignal;
  /** 1-based position in the batch. */
  position: number;
  total: number;
  /** Another job is queued behind this one. */
  hasNext: boolean;
  setPhase(text: string): void;
  carry: { get(): unknown; set(value: unknown): void };
}

export interface QueueJob {
  id: string;
  label: string;
  /** Called while the job BEFORE this one runs. Best effort; must be safe to
   *  call and to skip. */
  prepare?(): Promise<void>;
  run(ctx: QueueRunContext): Promise<QueueJobOutcome>;
}

export interface QueueEngine {
  /** Monotonic total of billable GPU seconds worked so far. */
  workerSec(): number;
  /** USD per worked second (a rate-card estimate). */
  usdPerSec: number;
  /** The receipt sentence for a cancelled item. `started`: it was running. */
  cancelReceipt(item: Readonly<QueueItem>, started: boolean): string;
  /** After a running item's cancel: wait for the gateway's answer. */
  settleCancel?(): Promise<void>;
  /** Operator Cancel of the live gateway job (DELETE). Lifecycle abort must not. */
  killLive?(): Promise<void> | void;
  /** The batch drained or the chain broke: let go of anything carried. */
  onDrain(carry: unknown): void;
}

export interface QueueItem {
  id: string;
  label: string;
  status: QueueItemStatus;
  /** 1-based position in the batch. */
  position: number;
  phase?: string;
  detail?: string;
  reason?: string;
  receipt?: string;
  workerSec: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface QueueBatch {
  startedAt: number;
  finishedAt?: number;
  workerSec: number;
  estimatedUsd: number;
}

export interface QueueSnapshot {
  items: readonly Readonly<QueueItem>[];
  running: boolean;
  batch: Readonly<QueueBatch> | null;
}

const TERMINAL: ReadonlySet<QueueItemStatus> = new Set(['done', 'skipped', 'paused', 'failed', 'cancelled']);

export class SyncQueue {
  private jobs = new Map<string, QueueJob>();
  private items: QueueItem[] = [];
  private controllers = new Map<string, AbortController>();
  private cancelRequested = new Set<string>();
  private carry: unknown = undefined;
  private pumping = false;
  private batch: QueueBatch | null = null;
  private listeners = new Set<() => void>();
  private view: QueueSnapshot = { items: [], running: false, batch: null };

  constructor(private readonly engine: QueueEngine) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Stable between changes, so it is safe as a `useSyncExternalStore` snapshot. */
  snapshot(): QueueSnapshot {
    return this.view;
  }

  private emit(): void {
    this.view = {
      items: this.items.map(i => ({ ...i })),
      running: this.pumping,
      batch: this.batch ? { ...this.batch } : null,
    };
    for (const listener of this.listeners) listener();
  }

  /** Adds jobs to the batch (starting one if idle). A job whose id is already
   *  queued or running is not added twice. Returns how many were added. */
  enqueue(newJobs: readonly QueueJob[], opts?: { next?: boolean }): number {
    // A finished batch is history once new work arrives.
    if (!this.pumping && this.items.every(i => TERMINAL.has(i.status))) {
      this.items = [];
      this.jobs.clear();
      this.batch = null;
    }
    let added = 0;
    for (const job of newJobs) {
      const live = this.items.find(i => i.id === job.id && !TERMINAL.has(i.status));
      if (live) continue;
      this.jobs.set(job.id, job);
      const item: QueueItem = { id: job.id, label: job.label, status: 'queued', position: this.items.length + 1, workerSec: 0 };
      if (opts?.next) {
        const idx = this.items.findIndex(i => i.status === 'queued');
        if (idx === -1) this.items.push(item);
        else this.items.splice(idx, 0, item);
      } else {
        this.items.push(item);
      }
      added++;
    }
    this.items.forEach((it, i) => { it.position = i + 1; });
    if (added > 0) {
      this.emit();
      void this.pump();
    }
    return added;
  }

  /** Cancels one item, wherever it is. */
  cancel(id: string): void {
    const item = this.items.find(i => i.id === id);
    if (!item || TERMINAL.has(item.status)) return;
    if (item.status === 'queued') {
      item.status = 'cancelled';
      item.receipt = this.engine.cancelReceipt(item, false);
      item.finishedAt = Date.now();
      this.emit();
      return;
    }
    this.cancelRequested.add(id);
    this.controllers.get(id)?.abort();
    void this.engine.killLive?.();
    item.phase = 'Stopping…';
    this.emit();
  }

  cancelAll(): void {
    for (const item of [...this.items]) this.cancel(item.id);
  }

  /** Drops finished items from view (a drained batch's history). */
  clearFinished(): void {
    if (this.pumping) return;
    this.items = [];
    this.jobs.clear();
    this.batch = null;
    this.emit();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    if (!this.batch) this.batch = { startedAt: Date.now(), workerSec: 0, estimatedUsd: 0 };
    const batchStartSec = this.engine.workerSec();
    this.emit();
    try {
      for (;;) {
        const item = this.items.find(i => i.status === 'queued');
        if (!item) break;
        await this.runOne(item);
        this.batch.workerSec = round(this.engine.workerSec() - batchStartSec);
        this.batch.estimatedUsd = round(this.batch.workerSec * this.engine.usdPerSec, 6);
      }
    } finally {
      this.pumping = false;
      if (this.batch) this.batch.finishedAt = Date.now();
      const carried = this.carry;
      this.carry = undefined;
      try { this.engine.onDrain(carried); } catch { /* releasing is best effort */ }
      this.emit();
    }
  }

  private async runOne(item: QueueItem): Promise<void> {
    const job = this.jobs.get(item.id)!;
    const controller = new AbortController();
    this.controllers.set(item.id, controller);
    item.status = 'running';
    item.startedAt = Date.now();
    item.phase = 'Starting…';
    const before = this.engine.workerSec();
    const behind = this.items.filter(i => i.status === 'queued');
    // The next job's inputs load while this one runs (no idle GPU gap).
    const next = behind[0] ? this.jobs.get(behind[0].id) : undefined;
    if (next?.prepare) void next.prepare().catch(() => undefined);
    this.emit();

    const queue = this;
    let outcome: QueueJobOutcome;
    try {
      outcome = await job.run({
        signal: controller.signal,
        position: item.position,
        total: queue.items.length,
        // Live: later cancels of the last queued item must not leave a
        // container held for a job that will never come.
        get hasNext() { return queue.items.some(i => i.status === 'queued'); },
        setPhase: text => { item.phase = text; queue.emit(); },
        carry: { get: () => queue.carry, set: value => { queue.carry = value; } },
      } satisfies QueueRunContext);
    } catch (err) {
      outcome = controller.signal.aborted
        ? { status: 'skipped', detail: 'cancelled' }
        : { status: 'failed', detail: err instanceof Error ? err.message : String(err) };
    }
    item.workerSec = round(this.engine.workerSec() - before);
    item.finishedAt = Date.now();
    item.phase = undefined;
    this.controllers.delete(item.id);
    if (this.cancelRequested.delete(item.id)) {
      item.status = 'cancelled';
      await this.engine.settleCancel?.();
      item.receipt = this.engine.cancelReceipt(item, true);
      // The chain is broken: the next job boots normally.
      const carried = this.carry;
      this.carry = undefined;
      try { this.engine.onDrain(carried); } catch { /* best effort */ }
    } else if (outcome.status === 'done') {
      item.status = 'done';
      item.detail = outcome.detail;
    } else if (outcome.status === 'skipped') {
      item.status = 'skipped';
      item.detail = outcome.detail;
    } else if (outcome.status === 'paused') {
      item.status = 'paused';
      item.reason = outcome.reason;
      item.detail = outcome.detail;
    } else {
      item.status = 'failed';
      item.detail = outcome.detail;
    }
    this.emit();
  }

  /** One line for the whole batch: what happened and what it cost. */
  batchLine(): string | null {
    const b = this.view.batch;
    if (!b || this.view.running || this.view.items.length === 0) return null;
    const count = (s: QueueItemStatus): number => this.view.items.filter(i => i.status === s).length;
    const parts = [
      [count('done'), 'built'], [count('skipped'), 'already up to date'],
      [count('paused'), 'paused'], [count('failed'), 'failed'], [count('cancelled'), 'cancelled'],
    ].filter(([n]) => (n as number) > 0).map(([n, label]) => `${n} ${label}`);
    const cost = b.workerSec > 0
      ? `about ${formatUsd(b.estimatedUsd)} of cloud GPU (${b.workerSec.toFixed(0)} s worked)`
      : 'no cloud GPU time used';
    const n = this.view.items.length;
    return `${n} ${n === 1 ? 'project' : 'projects'}: ${parts.join(', ')} · ${cost}`;
  }
}

function round(value: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export function formatUsd(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}
