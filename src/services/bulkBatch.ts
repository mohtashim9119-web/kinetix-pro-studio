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

import { laterCheckpoint } from './bulkStageChecklist';
import type { QueueItem, SyncQueue } from './syncQueue';

export type BatchPhase =
  | 'queued' | 'cloud' | 'cloud-done' | 'finishing' | 'done' | 'finish-failed'
  | 'paused' | 'failed' | 'cancelled' | 'skipped';

/** Persisted progress. Retry resumes here; a content re-key starts over. */
export type BulkCheckpoint = 'staged' | 'transcript-cached' | 'aligned' | 'built' | 'ready';

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
  /** Cloud worker-seconds this row used — its cost line survives a restart. */
  workerSec?: number;
  /** Each billed attempt (fail + retry + finish). `workerSec` is their sum. */
  billingAttempts?: { at: number; workerSec: number }[];
  /** Last gateway job id for this row — reattach polls it after a crash. */
  cloudJobId?: string;
  /** Automatic failure retries used (at most one). Operator Retry resets it. */
  autoRetries?: number;
  /** What the row held at Build Timeline (names and slots only, no bytes), so a
   *  built row still reads "17 files" with its four slots after a restart. */
  summary?: BatchRowSummary;
}

export interface BatchRowSummary {
  files: { id: string; kind: 'script' | 'scene' | 'voiceover' | 'media'; name: string }[];
  slots: { script: boolean; scene: boolean; voiceover: boolean; media: boolean };
  mediaCount: number;
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
    case 'ready': return [];
  }
}

const KEY = 'kinetix:bulk-batch:v1';
/** Where the drawer's draft rows persist (written by `bulkRows.ts`). */
export const BULK_DRAFTS_KEY = 'kinetix:bulk-drafts:v1';

/**
 * Ids of bulk rows that are not built yet: drafts with staged files (and
 * maybe bundle media) but no project record until Build Timeline. The
 * storage scanner treats these as normal rows, not orphaned data.
 */
export function unbuiltBulkRowIds(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): string[] {
  const read = (key: string): unknown => { try { const raw = storage?.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } };
  const batch = read(KEY) as { rows?: { id?: unknown }[]; groups?: { rowIds?: unknown[] }[] } | null;
  const drafts = read(BULK_DRAFTS_KEY) as { drafts?: { id?: unknown }[] } | null;
  const records = new Set((Array.isArray(batch?.rows) ? batch!.rows : []).map(r => r?.id));
  const ids = new Set<string>();
  for (const g of Array.isArray(batch?.groups) ? batch!.groups : []) {
    for (const id of Array.isArray(g?.rowIds) ? g.rowIds : []) if (typeof id === 'string') ids.add(id);
  }
  for (const d of Array.isArray(drafts?.drafts) ? drafts!.drafts : []) if (typeof d?.id === 'string') ids.add(d.id);
  return [...ids].filter(id => !records.has(id));
}

// Bulk UI rebuild U1 — GROUPS. A group is what one "Create Group" made: a
// name, a collapse toggle and its rows (draft ids and built records alike).
export const BULK_GROUP_MIN_ROWS = 2;
export const BULK_GROUP_MAX_ROWS = 30;
/** Groups that may exist at a time (operator ruling, 1.3.1). */
export const BULK_MAX_GROUPS = 5;

export interface BulkGroup {
  id: string;
  name: string;
  collapsed: boolean;
  /** Draft ids (no project yet) and batch record ids, in row order. */
  rowIds: string[];
}

export interface BulkProgress {
  done: number;
  total: number;
  failed: number;
  /** Any row still working on the cloud or finishing. */
  running: boolean;
}

const FAILED: ReadonlySet<BatchPhase> = new Set(['failed', 'finish-failed']);
const RUNNING: ReadonlySet<BatchPhase> = new Set(['queued', 'cloud', 'cloud-done', 'finishing']);

function progressOf(rowIds: readonly string[], records: readonly BatchRow[]): BulkProgress {
  const byId = new Map(records.map(r => [r.id, r]));
  const out: BulkProgress = { done: 0, total: rowIds.length, failed: 0, running: false };
  for (const id of rowIds) {
    const phase = byId.get(id)?.phase;
    if (phase === undefined) continue;
    if (phase === 'done') out.done += 1;
    if (FAILED.has(phase)) out.failed += 1;
    if (RUNNING.has(phase)) out.running = true;
  }
  return out;
}

/** "n/m done", the failed count and whether anything is running, for one group. */
export const groupProgress = (group: BulkGroup, records: readonly BatchRow[]): BulkProgress => progressOf(group.rowIds, records);

/** The same over every group (the dashboard's bulk button). */
export const batchProgress = (groups: readonly BulkGroup[], records: readonly BatchRow[]): BulkProgress =>
  progressOf(groups.flatMap(g => g.rowIds), records);

function recordQueueBilling(row: BatchRow, item: Readonly<QueueItem>, onBilled?: BatchRunnerDeps['onBilled']): boolean {
  if (!(item.workerSec > 0) || item.finishedAt === undefined) return false;
  const attempts = row.billingAttempts ?? [];
  if (attempts.some(a => a.at === item.finishedAt && a.workerSec === item.workerSec)) return false;
  attempts.push({ at: item.finishedAt, workerSec: item.workerSec });
  row.billingAttempts = attempts;
  row.workerSec = attempts.reduce((sum, a) => sum + a.workerSec, 0);
  try { onBilled?.(row.id, item.finishedAt, item.workerSec); } catch { /* display-only hook */ }
  return true;
}

const TERMINAL: ReadonlySet<BatchPhase> = new Set(['done', 'finish-failed', 'paused', 'failed', 'cancelled', 'skipped']);
export const isBatchRowFinal = (p: BatchPhase): boolean => TERMINAL.has(p);

export interface BatchRunnerDeps {
  queue: SyncQueue;
  /** Queues cloud jobs for these projects (`queueProjectsForCloudSync`). */
  enqueue: (rows: { id: string; name: string; checkpoint?: BulkCheckpoint; contentKey?: string }[], opts?: { next?: boolean }) => void;
  /** Does this project still exist? A deleted one is dropped, not built. */
  exists: (id: string) => boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Display-only hooks (the cost ledger): called after the fact, never consulted. */
  onBilled?: (rowId: string, at: number, workerSec: number) => void;
  onBuilt?: (rowId: string, sec: number) => void;
}

export class BulkBatchRunner {
  private rows: BatchRow[] = [];
  private groupList: BulkGroup[] = [];
  private groupView: readonly BulkGroup[] = [];
  private readyListeners = new Set<(row: { id: string; name: string }) => void>();
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
      const groups = (parsed as { groups?: BulkGroup[] } | null)?.groups;
      if (Array.isArray(groups)) {
        this.groupList = groups
          .filter(g => g && typeof g.id === 'string' && Array.isArray(g.rowIds))
          .map(g => ({ id: g.id, name: String(g.name ?? ''), collapsed: g.collapsed === true, rowIds: g.rowIds.filter(x => typeof x === 'string') }));
      }
    } catch { this.rows = []; this.groupList = []; }
    // A batch saved before groups existed: one default group holds every row.
    const grouped = new Set(this.groupList.flatMap(g => g.rowIds));
    const loose = this.rows.filter(r => !grouped.has(r.id)).map(r => r.id);
    if (loose.length > 0) this.groupList.push({ id: crypto.randomUUID(), name: this.nextGroupName(), collapsed: false, rowIds: loose });
    this.view = this.rows.map(r => ({ ...r }));
    this.groupView = this.groupList.map(g => ({ ...g, rowIds: [...g.rowIds] }));
  }

  groups(): readonly BulkGroup[] { return this.groupView; }

  private nextGroupName(): string {
    const used = new Set(this.groupList.map(g => g.name));
    let n = 1;
    while (used.has(`Group ${n}`)) n += 1;
    return `Group ${n}`;
  }

  canCreateGroup(): boolean { return this.groupList.length < BULK_MAX_GROUPS; }

  /** A new group over these (draft) row ids: 2–30 rows, at most 10 groups. */
  createGroup(rowIds: readonly string[], name?: string): BulkGroup | undefined {
    if (!this.canCreateGroup()) return undefined;
    if (rowIds.length < BULK_GROUP_MIN_ROWS || rowIds.length > BULK_GROUP_MAX_ROWS) return undefined;
    const group: BulkGroup = { id: crypto.randomUUID(), name: name?.trim() || this.nextGroupName(), collapsed: false, rowIds: [...rowIds] };
    this.groupList.push(group);
    this.commit();
    return { ...group, rowIds: [...group.rowIds] };
  }

  /** Rows outside any group (drafts saved before groups, or a seed) get one,
   *  so every row has its group's Build Timeline. Bypasses the create limits:
   *  these rows already exist. */
  adoptRows(rowIds: readonly string[]): BulkGroup | undefined {
    const grouped = new Set(this.groupList.flatMap(g => g.rowIds));
    const loose = rowIds.filter(id => !grouped.has(id));
    if (loose.length === 0) return undefined;
    const group: BulkGroup = { id: crypto.randomUUID(), name: this.nextGroupName(), collapsed: false, rowIds: loose };
    this.groupList.push(group);
    this.commit();
    return { ...group, rowIds: [...group.rowIds] };
  }

  /** One more row in a group, up to 30. */
  addRowToGroup(groupId: string, rowId: string): boolean {
    const group = this.groupList.find(g => g.id === groupId);
    if (!group || group.rowIds.length >= BULK_GROUP_MAX_ROWS) return false;
    if (!group.rowIds.includes(rowId)) group.rowIds.push(rowId);
    this.commit();
    return true;
  }

  setCollapsed(groupId: string, collapsed: boolean): void {
    const group = this.groupList.find(g => g.id === groupId);
    if (!group || group.collapsed === collapsed) return;
    group.collapsed = collapsed;
    this.commit();
  }

  renameGroup(groupId: string, name: string): void {
    const group = this.groupList.find(g => g.id === groupId);
    const next = name.trim();
    if (!group || !next || group.name === next) return;
    group.name = next;
    this.commit();
  }

  /** The operator deleted this row: its record and its place in its group go. */
  removeRow(id: string): void {
    this.rows = this.rows.filter(r => r.id !== id);
    this.deps.queue.cancel(id);
    this.dropFromGroups([id]);
    this.commit();
  }

  private dropFromGroups(ids: readonly string[]): void {
    const gone = new Set(ids);
    for (const g of this.groupList) g.rowIds = g.rowIds.filter(x => !gone.has(x));
    this.groupList = this.groupList.filter(g => g.rowIds.length > 0);
  }

  /** "Project N ready" — a row's timeline just finished. Nothing is opened. */
  onReady(l: (row: { id: string; name: string }) => void): () => void {
    this.readyListeners.add(l);
    return () => { this.readyListeners.delete(l); };
  }

  private commit(): void {
    this.view = this.rows.map(r => ({ ...r }));
    this.groupView = this.groupList.map(g => ({ ...g, rowIds: [...g.rowIds] }));
    try {
      if (this.rows.length === 0 && this.groupList.length === 0) this.storage?.removeItem(KEY);
      else this.storage?.setItem(KEY, JSON.stringify({ rows: this.rows, groups: this.groupList }));
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
  start(created: readonly { id: string; name: string; summary?: BatchRowSummary }[]): void {
    for (const c of created) {
      if (this.rows.some(r => r.id === c.id)) continue;
      this.rows.push({ id: c.id, name: c.name, phase: 'queued', ...(c.summary ? { summary: c.summary } : {}) });
    }
    // A row started outside any group (no drawer) still belongs to one.
    const grouped = new Set(this.groupList.flatMap(g => g.rowIds));
    const loose = created.filter(c => !grouped.has(c.id)).map(c => c.id);
    if (loose.length > 0) this.groupList.push({ id: crypto.randomUUID(), name: this.nextGroupName(), collapsed: false, rowIds: loose });
    this.commit();
    this.deps.enqueue(created.map(c => ({ id: c.id, name: c.name })));
  }

  /** App boot: pick the batch up where it stopped. */
  resume(): void {
    this.forgetMissing();
    const todo = this.rows.filter(r => r.phase === 'queued' || r.phase === 'cloud');
    if (todo.length > 0) this.deps.enqueue(todo.map(r => ({ id: r.id, name: r.name, checkpoint: r.checkpoint, contentKey: r.contentKey })));
    // A timeline that was mid-finish when the app stopped is finished again.
    // Background finish does not flip the editor, so a deferred awaitingOpen
    // row is finished on resume rather than waiting for a screen change.
    for (const r of this.rows) {
      if (r.phase === 'finishing') r.phase = 'cloud-done';
      if (r.awaitingOpen) { r.awaitingOpen = false; r.message = undefined; }
    }
    this.commit();
    this.pumpFinish();
  }

  /** Persist a stage boundary so a crash resumes here. */
  noteCheckpoint(id: string, checkpoint: BulkCheckpoint): void {
    const row = this.rows.find(r => r.id === id);
    if (!row) return;
    const next = laterCheckpoint(row.checkpoint, checkpoint);
    if (next === row.checkpoint) return;
    row.checkpoint = next;
    this.commit();
  }

  noteCloudJob(id: string, jobId: string): void {
    const row = this.rows.find(r => r.id === id);
    if (!row || row.cloudJobId === jobId) return;
    row.cloudJobId = jobId;
    this.commit();
  }

  private forgetMissing(): void {
    const missing = this.rows.filter(r => !this.deps.exists(r.id)).map(r => r.id);
    if (missing.length === 0) return;
    this.rows = this.rows.filter(r => !missing.includes(r.id));
    this.dropFromGroups(missing);
    this.commit();
  }

  /** Projects deleted from the dashboard leave the batch. */
  forget(ids: readonly string[]): void {
    const before = this.rows.length;
    this.rows = this.rows.filter(r => !ids.includes(r.id));
    for (const id of ids) this.deps.queue.cancel(id);
    if (this.rows.length !== before) { this.dropFromGroups(ids); this.commit(); }
  }

  /** Run this row again from its checkpoint. Content changes start over. */
  retry(id: string, contentKey?: string, opts?: { auto?: boolean; next?: boolean; preserveAutoRetries?: boolean }): void {
    const row = this.rows.find(r => r.id === id);
    if (!row) return;
    if (row.phase !== 'failed' && row.phase !== 'finish-failed' && row.phase !== 'paused' && row.phase !== 'cancelled' && !opts?.auto) return;
    if (!opts?.auto && !opts?.preserveAutoRetries) row.autoRetries = 0;
    if (contentKey !== undefined && row.contentKey !== undefined && contentKey !== row.contentKey) {
      row.checkpoint = undefined;
    }
    row.phase = 'queued';
    row.message = undefined;
    this.commit();
    this.deps.enqueue(
      [{ id: row.id, name: row.name, checkpoint: row.checkpoint, contentKey: row.contentKey }],
      opts?.next ? { next: true } : undefined,
    );
  }

  /** Operator Cancel of one row: DELETE the live job, park Cancelled. Pauses stay. */
  cancel(id: string): void {
    const row = this.rows.find(r => r.id === id);
    if (!row || row.phase === 'paused') return;
    this.deps.queue.cancel(id);
  }

  /** Cancel every queued/running row in this group. Paused rows are left. */
  cancelGroup(groupId: string): void {
    const group = this.groupList.find(g => g.id === groupId);
    if (!group) return;
    for (const id of group.rowIds) this.cancel(id);
  }

  /** Panic: stop every queue item and kill every server job for this user. */
  async stopAllCloudWork(killMemberJobs: () => Promise<void>): Promise<void> {
    for (const row of this.rows) {
      if (row.phase === 'paused') continue;
      this.deps.queue.cancel(row.id);
    }
    await killMemberJobs();
    for (const row of this.rows) {
      if (row.phase === 'queued' || row.phase === 'cloud') {
        row.phase = 'cancelled';
      }
    }
    this.commit();
  }

  /** Stamp the content key a checkpoint belongs to (audio|script|engine). */
  noteContent(id: string, contentKey: string): void {
    const row = this.rows.find(r => r.id === id);
    if (!row || row.contentKey === contentKey) return;
    if (row.contentKey !== undefined && row.contentKey !== contentKey) row.checkpoint = undefined;
    row.contentKey = contentKey;
    this.commit();
  }

  /** The operator clears the finished part of the batch (or of one group)
   *  from view. Only ever on the operator's click — nothing clears by itself. */
  clearFinished(groupId?: string): void {
    const scope = groupId === undefined ? undefined : new Set(this.groupList.find(g => g.id === groupId)?.rowIds ?? []);
    const gone = this.rows.filter(r => isBatchRowFinal(r.phase) && (!scope || scope.has(r.id))).map(r => r.id);
    this.rows = this.rows.filter(r => !gone.includes(r.id));
    this.dropFromGroups(gone);
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
    const items = this.deps.queue.snapshot().items;
    const latest = new Map<string, (typeof items)[number]>();
    for (const item of items) latest.set(item.id, item);
    for (const item of items) {
      const row = this.rows.find(r => r.id === item.id);
      if (row) {
        const billed = recordQueueBilling(row, item, this.deps.onBilled);
        if (billed) changed = true;
      }
      if (!row || isBatchRowFinal(row.phase) || row.phase === 'finishing') continue;
      if (latest.get(item.id) !== item) continue;
      if (item.status === 'failed' && (row.autoRetries ?? 0) < 1) {
        row.autoRetries = 1;
        this.retry(row.id, undefined, { auto: true, next: true });
        changed = true;
        continue;
      }
      const next = this.mapQueue(item, row);
      const fromPhase: BulkCheckpoint | undefined =
        item.phase === 'Aligning on the cloud…' ? 'transcript-cached'
        : item.phase === 'Transcribing on the cloud…' || item.phase === 'Checking the cloud…' ? (row.checkpoint ?? 'staged')
        : undefined;
      const checkpoint = next?.checkpoint ?? fromPhase;
      if ((next && (next.phase !== row.phase || next.message !== row.message)) || (checkpoint && checkpoint !== row.checkpoint)) {
        if (next) { row.phase = next.phase; row.message = next.message; }
        if (checkpoint) row.checkpoint = laterCheckpoint(row.checkpoint, checkpoint);
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
        if (item.detail === 'detached') return undefined;
        // "Already built" is a finished cloud state; anything else is a reason.
        return /already built/i.test(item.detail ?? '') ? { phase: 'cloud-done' } : { phase: 'skipped', message: item.detail };
      case 'paused': return { phase: 'paused', message: item.detail ?? item.reason };
      case 'failed': return { phase: 'failed', message: item.detail };
      case 'cancelled': return { phase: 'cancelled' };
    }
  }

  // Rows finish ONE AT A TIME on one promise chain — never stacked. Finish
  // runs in the background as soon as the finalizer is wired: no editor, no
  // drawer, no screen flip.
  private pumpFinish(): void {
    if (!this.finalize) return;
    for (const row of this.rows) {
      if (row.phase !== 'cloud-done' || this.finishing.has(row.id)) continue;
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

  /** An already-built row: re-run finish through the shared service (cache hits). */
  rebuildFromCache(id: string): boolean {
    const row = this.rows.find(r => r.id === id);
    if (!row || row.phase !== 'done') return false;
    this.requeueForRebuild(id, row.name, 'Rebuilding from cache');
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
      if (!this.finalize) return;
      if (!this.deps.exists(id)) { this.forget([id]); return; }
      this.set(id, 'finishing');
      let result: FinishResult;
      const builtFrom = Date.now();
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
        try { this.deps.onBuilt?.(id, (Date.now() - builtFrom) / 1000); } catch { /* display-only hook */ }
        const row = this.rows.find(r => r.id === id);
        if (row) row.checkpoint = 'ready';
        this.commit();
        if (row) for (const l of this.readyListeners) l({ id: row.id, name: row.name });
      }
    } finally {
      this.finishing.delete(id);
    }
  }
}
