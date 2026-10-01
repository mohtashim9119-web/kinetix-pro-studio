/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U7.8 — the bulk batch as a PERSISTENT background job.
//
// Until now a batch lived in the modal and the in-memory queue: close the
// window or reload and it was gone. The runner below owns it instead:
//
//  - Every row's phase is written to storage on each change
//    (`kinetix:bulk-batch:v1`), so a reload, quit or crash loses nothing.
//  - `resume()` (App boot) re-enqueues the cloud work for rows that had not
//    finished. That is cheap and safe: finished stages are gateway cache hits,
//    and a job still running server-side is reused by the gateway's in-flight
//    de-duplication, so nothing is billed twice. (This reverses U5's "no
//    auto-restart" ruling for bulk batches, at the operator's request.)
//  - The cloud phase runs whether or not any window is open. FINISHING a
//    timeline (the app's own Build Timeline, run in the editor) needs the
//    editor, so it runs while the batch window is open or the operator asked
//    for it; until then a row reads "ready on the cloud" and opening the
//    project is a free cache-hit build.
//  - The batch is reachable from the dashboard until the operator clears it.
// ---------------------------------------------------------------------------

import type { QueueItem, SyncQueue } from './syncQueue';

export type BatchPhase =
  | 'queued' | 'cloud' | 'cloud-done' | 'finishing' | 'done' | 'finish-failed'
  | 'paused' | 'failed' | 'cancelled' | 'skipped';

/** Persisted progress. Retry resumes here; a content re-key starts over. */
export type BulkCheckpoint = 'staged' | 'transcript-cached' | 'aligned' | 'built';

export interface BatchRow {
  id: string;
  name: string;
  phase: BatchPhase;
  message?: string;
  checkpoint?: BulkCheckpoint;
  /** `audioHash|scriptHash|engineKey` the checkpoint was written against. */
  contentKey?: string;
  /** v1.2.2 — finished on the cloud, but the operator was busy in the editor,
   *  so the flip into this project was deferred: it waits for its own Open
   *  ("ready — one click to finish") instead of finishing on its own. */
  awaitingOpen?: boolean;
}

export interface FinishRequest {
  /** The operator asked for this row (its Open): no deferral, no return trip. */
  userInitiated: boolean;
}

export interface FinishResult {
  ok: boolean;
  message?: string;
  /** Not run (the operator is busy, or navigated mid-finish): wait for Open. */
  deferred?: boolean;
}

/** The status line of a deferred row. */
export const READY_TO_FINISH = 'Ready — one click to finish';

/**
 * Stages still to run. A checkpoint skips what the gateway cache already
 * holds. A changed content key (or no checkpoint) starts from scratch.
 */
export function stagesToRun(
  checkpoint: BulkCheckpoint | undefined,
  contentChanged: boolean,
): readonly ('transcribe' | 'align' | 'build')[] {
  if (contentChanged || checkpoint === undefined) return ['transcribe', 'align', 'build'];
  switch (checkpoint) {
    case 'staged': return ['transcribe', 'align', 'build'];
    case 'transcript-cached': return ['align', 'build'];
    case 'aligned': return ['build'];
    case 'built': return [];
  }
}

const KEY = 'kinetix:bulk-batch:v1';

const TERMINAL: ReadonlySet<BatchPhase> = new Set(['done', 'finish-failed', 'paused', 'failed', 'cancelled', 'skipped']);
export const isBatchRowFinal = (p: BatchPhase): boolean => TERMINAL.has(p);

export interface BatchRunnerDeps {
  queue: SyncQueue;
  /** Queues cloud jobs for these projects (`queueProjectsForCloudSync`). */
  enqueue: (rows: { id: string; name: string; checkpoint?: BulkCheckpoint; contentKey?: string }[]) => void;
  /** Does this project still exist? A deleted one is dropped, not built. */
  exists: (id: string) => boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export class BulkBatchRunner {
  private rows: BatchRow[] = [];
  private listeners = new Set<() => void>();
  private view: readonly BatchRow[] = [];
  private finalize: ((id: string, req: FinishRequest) => Promise<FinishResult>) | undefined;
  private finishEnabled = 0;
  private chain: Promise<void> = Promise.resolve();
  private finishing = new Set<string>();
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;

  constructor(private readonly deps: BatchRunnerDeps) {
    this.storage = deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    this.load();
    deps.queue.subscribe(() => this.onQueue());
  }

  subscribe(l: () => void): () => void { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  snapshot(): readonly BatchRow[] { return this.view; }

  private load(): void {
    try {
      const raw = this.storage?.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) as { rows?: BatchRow[] } : null;
      if (parsed?.rows && Array.isArray(parsed.rows)) this.rows = parsed.rows.filter(r => r && typeof r.id === 'string');
    } catch { this.rows = []; }
    this.view = this.rows.map(r => ({ ...r }));
  }

  private commit(): void {
    this.view = this.rows.map(r => ({ ...r }));
    try {
      if (this.rows.length === 0) this.storage?.removeItem(KEY);
      else this.storage?.setItem(KEY, JSON.stringify({ rows: this.rows }));
    } catch { /* storage unavailable: still works this session */ }
    for (const l of this.listeners) l();
  }

  private set(id: string, phase: BatchPhase, message?: string): void {
    const row = this.rows.find(r => r.id === id);
    if (!row || (row.phase === phase && row.message === message)) return;
    row.phase = phase;
    row.message = message;
    this.commit();
  }

  /** New projects were created: record them and queue their cloud work. */
  start(created: readonly { id: string; name: string }[]): void {
    for (const c of created) {
      if (this.rows.some(r => r.id === c.id)) continue;
      this.rows.push({ id: c.id, name: c.name, phase: 'queued' });
    }
    this.commit();
    this.deps.enqueue(created.map(c => ({ id: c.id, name: c.name })));
  }

  /** App boot: pick the batch up where it stopped. */
  resume(): void {
    this.forgetMissing();
    const todo = this.rows.filter(r => r.phase === 'queued' || r.phase === 'cloud');
    if (todo.length > 0) this.deps.enqueue(todo.map(r => ({ id: r.id, name: r.name, checkpoint: r.checkpoint, contentKey: r.contentKey })));
    // A timeline that was mid-finish when the app stopped is finished again.
    for (const r of this.rows) if (r.phase === 'finishing') r.phase = 'cloud-done';
    this.commit();
    this.pumpFinish();
  }

  private forgetMissing(): void {
    const before = this.rows.length;
    this.rows = this.rows.filter(r => this.deps.exists(r.id));
    if (this.rows.length !== before) this.commit();
  }

  /** Projects deleted from the dashboard leave the batch. */
  forget(ids: readonly string[]): void {
    const before = this.rows.length;
    this.rows = this.rows.filter(r => !ids.includes(r.id));
    for (const id of ids) this.deps.queue.cancel(id);
    if (this.rows.length !== before) this.commit();
  }

  /** Run this row again from its checkpoint. Content changes start over. */
  retry(id: string, contentKey?: string): void {
    const row = this.rows.find(r => r.id === id);
    if (!row) return;
    if (row.phase !== 'failed' && row.phase !== 'finish-failed' && row.phase !== 'paused') return;
    if (contentKey !== undefined && row.contentKey !== undefined && contentKey !== row.contentKey) {
      row.checkpoint = undefined;
    }
    row.phase = 'queued';
    row.message = undefined;
    this.commit();
    this.deps.enqueue([{ id: row.id, name: row.name, checkpoint: row.checkpoint, contentKey: row.contentKey }]);
  }

  /** Stamp the content key a checkpoint belongs to (audio|script|engine). */
  noteContent(id: string, contentKey: string): void {
    const row = this.rows.find(r => r.id === id);
    if (!row || row.contentKey === contentKey) return;
    if (row.contentKey !== undefined && row.contentKey !== contentKey) row.checkpoint = undefined;
    row.contentKey = contentKey;
    this.commit();
  }

  /** The operator clears the finished part of the batch from view. */
  clearFinished(): void {
    this.rows = this.rows.filter(r => !isBatchRowFinal(r.phase));
    this.commit();
  }

  /** App wires the editor-side finish (open the project, Build Timeline, save). */
  setFinalizer(f: (id: string, req: FinishRequest) => Promise<FinishResult>): void {
    this.finalize = f;
    this.pumpFinish();
  }

  /** Finishing runs while at least one "window" (the batch modal) holds this. */
  holdFinishOpen(): () => void {
    this.finishEnabled += 1;
    this.pumpFinish();
    let released = false;
    return () => { if (!released) { released = true; this.finishEnabled -= 1; } };
  }

  private onQueue(): void {
    let changed = false;
    for (const item of this.deps.queue.snapshot().items) {
      const row = this.rows.find(r => r.id === item.id);
      if (!row || isBatchRowFinal(row.phase) || row.phase === 'finishing') continue;
      const next = this.mapQueue(item, row);
      const fromPhase: BulkCheckpoint | undefined =
        item.phase === 'Aligning on the cloud…' ? 'transcript-cached'
        : item.phase === 'Transcribing on the cloud…' || item.phase === 'Checking the cloud…' ? (row.checkpoint ?? 'staged')
        : undefined;
      const checkpoint = next?.checkpoint ?? fromPhase;
      if ((next && (next.phase !== row.phase || next.message !== row.message)) || (checkpoint && checkpoint !== row.checkpoint)) {
        if (next) { row.phase = next.phase; row.message = next.message; }
        if (checkpoint) row.checkpoint = checkpoint;
        changed = true;
      }
    }
    if (changed) { this.commit(); this.pumpFinish(); }
  }

  private mapQueue(item: Readonly<QueueItem>, row: BatchRow): { phase: BatchPhase; message?: string; checkpoint?: BulkCheckpoint } | undefined {
    switch (item.status) {
      case 'queued': return row.phase === 'cloud-done' ? undefined : { phase: 'queued' };
      case 'running': return { phase: 'cloud' };
      case 'done': return { phase: 'cloud-done', checkpoint: 'aligned' };
      case 'skipped':
        // "Already built" is a finished cloud state; anything else is a reason.
        return /already built/i.test(item.detail ?? '') ? { phase: 'cloud-done' } : { phase: 'skipped', message: item.detail };
      case 'paused': return { phase: 'paused', message: item.reason };
      case 'failed': return { phase: 'failed', message: item.detail };
      case 'cancelled': return { phase: 'cancelled' };
    }
  }

  // Rows finish ONE AT A TIME on one promise chain — never stacked. A row the
  // operator deferred (busy in the editor) waits for its own Open.
  private pumpFinish(): void {
    if (!this.finalize || this.finishEnabled <= 0) return;
    for (const row of this.rows) {
      if (row.phase !== 'cloud-done' || row.awaitingOpen || this.finishing.has(row.id)) continue;
      this.finishing.add(row.id);
      this.chain = this.chain.then(() => this.finishOne(row.id, false));
    }
  }

  /** The operator's Open on a row that is built on the cloud: finish it now
   *  (after whatever row is finishing), into the editor, and stay there. */
  finishNow(id: string): boolean {
    const row = this.rows.find(r => r.id === id);
    if (!row || row.phase !== 'cloud-done' || !this.finalize) return false;
    if (row.awaitingOpen) { row.awaitingOpen = false; row.message = undefined; this.commit(); }
    if (this.finishing.has(id)) return true;
    this.finishing.add(id);
    this.chain = this.chain.then(() => this.finishOne(id, true));
    return true;
  }

  /** A record the bulk guard reset (`bulkRepair.ts`): rebuild it from its own
   *  files. Its cloud work is cached, so it goes straight to finishing. */
  requeueForRebuild(id: string, name: string, message: string): void {
    let row = this.rows.find(r => r.id === id);
    if (!row) { row = { id, name, phase: 'cloud-done' }; this.rows.push(row); }
    row.phase = 'cloud-done';
    row.checkpoint = 'aligned';
    row.awaitingOpen = false;
    row.message = message;
    this.commit();
    this.pumpFinish();
  }

  private async finishOne(id: string, userInitiated: boolean): Promise<void> {
    try {
      const row = this.rows.find(r => r.id === id);
      if (!row || row.phase !== 'cloud-done') return;
      // Window closed since this was queued: leave it for next time.
      if ((!userInitiated && this.finishEnabled <= 0) || !this.finalize) return;
      if (!userInitiated && row.awaitingOpen) return;
      if (!this.deps.exists(id)) { this.forget([id]); return; }
      this.set(id, 'finishing');
      let result: FinishResult;
      try { result = await this.finalize(id, { userInitiated }); } catch (err) { result = { ok: false, message: err instanceof Error ? err.message : String(err) }; }
      const after = this.rows.find(r => r.id === id);
      if (!after) return; // deleted meanwhile
      if (result.deferred) {
        after.phase = 'cloud-done';
        after.awaitingOpen = true;
        after.message = READY_TO_FINISH;
        this.commit();
        return;
      }
      this.set(id, result.ok ? 'done' : 'finish-failed', result.ok ? undefined : result.message);
      if (result.ok) {
        const row = this.rows.find(r => r.id === id);
        if (row) row.checkpoint = 'built';
        this.commit();
      }
    } finally {
      this.finishing.delete(id);
    }
  }
}
