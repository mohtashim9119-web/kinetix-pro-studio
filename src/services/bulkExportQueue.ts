/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SyncQueue, type QueueJob, type QueueJobOutcome, type QueueRunContext } from './syncQueue';
import { preflightBulkExport } from './bulkExportPreflight';
import { resolveBulkExportSettings, type BulkExportSettings, type WorkspaceExportChoice } from './bulkExportSettings';
import { BULK_EXPORT_BATCH_KEY, readBulkExportSelection, writeBulkExportSelection } from './bulkExportPersist';
import type { Project } from '../types';
import { playExportCompleteChime } from './notificationSound';
import { PIPELINE_BUSY_REASON, pipelineConflict, runGuarded, waitingMessageFor } from './pipelineGuard';

/** `waiting`: the project was syncing when this row would have run — parked,
 *  never silently skipped; Retry once the sync is over. */
export type BulkExportPhase = 'idle' | 'queued' | 'exporting' | 'done' | 'failed' | 'blocked' | 'paused' | 'waiting' | 'cancelled';

export interface BulkExportRow {
  id: string;
  name: string;
  selected: boolean;
  phase: BulkExportPhase;
  message?: string;
  flags?: string[];
}

export interface BulkExportExecutorInput {
  project: Project;
  savedPath: string;
  resolution: Project['resolutionTier'];
  fps: 24 | 30 | 60;
  resume: boolean;
  signal: AbortSignal;
  setPhase(text: string): void;
}

export type BulkExportExecutor = (input: BulkExportExecutorInput) => Promise<QueueJobOutcome>;

export const BULK_EXPORT_NO_CHECKPOINT_CHECK = 'Could not check for a saved checkpoint — exporting from the start';

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A load that THREW (as opposed to "not found") — a visible block with the reason. */
const loadFailed = (err: unknown): { blocked: string; flags?: string[] } => ({ blocked: `Blocked — could not open the project: ${errorText(err)}` });

const idleEngine = {
  workerSec: () => 0,
  usdPerSec: 0,
  onDrain: () => {},
  cancelReceipt: () => '',
};

export class BulkExportRunner {
  private rows: BulkExportRow[] = [];
  private view: readonly BulkExportRow[] = [];
  private listeners = new Set<() => void>();
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
  private readonly queue: SyncQueue;
  private chimeArmed = false;
  private noticeDismissed = false;
  private noticeCache: string | null = null;
  /** Output path each project's row last claimed — a second project with the
   *  same name gets " (2)" instead of overwriting the first. */
  private claimed = new Map<string, string>();
  private execute: BulkExportExecutor;

  constructor(
    private readonly deps: {
      loadProject: (id: string) => Promise<Project | null>;
      /** Read fresh on every Start, Retry and drawer open — never cached. */
      listProjects: () => { id: string; name: string; lastExportPath?: string }[];
      execute: BulkExportExecutor;
      hasCheckpoint?: (project: Project) => Promise<boolean>;
      /** The workspace export settings that apply to this project (unassigned →
       *  the All tab's). Read fresh on every check — never cached. */
      exportSettingsFor?: (id: string) => WorkspaceExportChoice | undefined;
      storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
      playChime?: () => void;
    },
  ) {
    this.storage = deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    this.queue = new SyncQueue({
      ...idleEngine,
      onDrain: () => {
        if (this.chimeArmed && this.rows.some(r => r.phase === 'done' || r.phase === 'failed' || r.phase === 'blocked' || r.phase === 'waiting' || r.phase === 'cancelled')) {
          this.chimeArmed = false;
          if (this.rows.some(r => r.phase === 'done')) (deps.playChime ?? playExportCompleteChime)();
        }
      },
    });
    this.execute = deps.execute;
    this.queue.subscribe(() => this.onQueue());
    this.load();
    this.parkUnfinished();
    for (const id of readBulkExportSelection(this.storage)) this.ensureRow(id).selected = true;
    this.view = this.rows.map(r => ({ ...r, flags: r.flags ? [...r.flags] : undefined }));
    if (this.rows.length > 0) {
      try { this.storage?.setItem(BULK_EXPORT_BATCH_KEY, JSON.stringify({ rows: this.rows })); } catch { /* ignore */ }
    }
  }

  setExecutor(fn: BulkExportExecutor): void {
    this.execute = fn;
  }

  subscribe(l: () => void): () => void { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  snapshot(): readonly BulkExportRow[] { return this.view; }
  noticeDismissedFlag(): boolean { return this.noticeDismissed; }
  dismissNotice(): void { this.noticeDismissed = true; this.emit(); }
  runningCount(): { current: number; total: number; running: boolean } {
    const batch = this.rows.filter(r => r.phase !== 'idle');
    const live = batch.some(r => r.phase === 'exporting' || r.phase === 'queued');
    const finished = batch.filter(r => r.phase === 'done' || r.phase === 'failed' || r.phase === 'blocked' || r.phase === 'waiting' || r.phase === 'cancelled').length;
    const current = live ? Math.min(batch.length, finished + 1) : finished;
    return { current, total: batch.length, running: live };
  }

  runningNotice(): string | null {
    if (this.noticeDismissed) {
      this.noticeCache = null;
      return null;
    }
    const { current, total, running } = this.runningCount();
    const next = (!running || total === 0) ? null : `Bulk export running — ${current} of ${total}`;
    if (next !== this.noticeCache) this.noticeCache = next;
    return this.noticeCache;
  }

  listCatalog(): { id: string; name: string }[] {
    return this.deps.listProjects();
  }

  setSelected(id: string, selected: boolean): void {
    const row = this.ensureRow(id);
    row.selected = selected;
    this.persistSelection();
    this.commit();
  }

  setSelectedAll(selected: boolean): void {
    for (const p of this.deps.listProjects()) {
      this.ensureRow(p.id).selected = selected;
    }
    this.persistSelection();
    this.commit();
  }

  private persistSelection(): void {
    writeBulkExportSelection(this.rows.filter(r => r.selected).map(r => r.id), this.storage);
  }

  /** One project's pre-start verdict from FRESH reads (meta + stored record). */
  private async evaluate(meta: { id: string; lastExportPath?: string }): Promise<
    | { blocked: string; flags?: string[] }
    | { project: Project; settings: BulkExportSettings; flags: string[] }
  > {
    const project = await this.deps.loadProject(meta.id);
    if (!project) return { blocked: 'Blocked — project missing', flags: undefined };
    const takenByOthers = (path: string): boolean => {
      for (const [id, claimed] of this.claimed) if (id !== meta.id && claimed === path) return true;
      return false;
    };
    const settings = resolveBulkExportSettings(project, this.deps.exportSettingsFor?.(meta.id), meta.lastExportPath, takenByOthers);
    if ('blocked' in settings) return { blocked: settings.blocked };
    const gate = preflightBulkExport(project.segments, project.assets);
    if (gate.kind === 'block') return { blocked: gate.message, flags: [] };
    this.claimed.set(meta.id, settings.savedPath);
    return { project, settings, flags: gate.flags };
  }

  private freshMeta(id: string): { id: string; lastExportPath?: string } {
    return this.deps.listProjects().find(p => p.id === id) ?? { id };
  }

  /** Drawer open: re-check every Blocked row against fresh metas and records,
   *  so an export path confirmed (or media relinked) since the last Start
   *  clears the stale block. Rows that are still blocked keep their reason. */
  async refresh(): Promise<void> {
    let changed = false;
    for (const row of this.rows.filter(r => r.phase === 'blocked')) {
      const verdict = await this.evaluate(this.freshMeta(row.id));
      if ('blocked' in verdict) {
        if (row.message !== verdict.blocked) { row.message = verdict.blocked; changed = true; }
        continue;
      }
      row.phase = 'idle';
      row.message = undefined;
      row.flags = undefined;
      changed = true;
    }
    if (changed) this.commit();
  }

  async startSelected(): Promise<void> {
    const chosen = this.deps.listProjects().filter(p => this.ensureRow(p.id).selected);
    this.chimeArmed = true;
    this.noticeDismissed = false;
    const jobs: QueueJob[] = [];
    for (const meta of chosen) {
      const row = this.ensureRow(meta.id);
      const syncing = pipelineConflict(meta.id, 'export');
      if (syncing) {
        row.phase = 'waiting';
        row.message = waitingMessageFor(syncing);
        continue;
      }
      const verdict = await this.evaluate(meta).catch(loadFailed);
      if ('blocked' in verdict) {
        row.phase = 'blocked';
        row.message = verdict.blocked;
        if (verdict.flags) row.flags = verdict.flags;
        continue;
      }
      row.flags = verdict.flags;
      row.phase = 'queued';
      row.message = 'Queued';
      jobs.push(this.jobFor(verdict.project, verdict.settings, false));
    }
    this.commit();
    if (jobs.length > 0) this.queue.enqueue(jobs);
  }

  /** A batch is live while any row is queued or exporting (Stop all shows then). */
  isActive(): boolean {
    return this.rows.some(r => r.phase === 'queued' || r.phase === 'exporting');
  }

  /** Cancel one row. Queued: back to Ready at once, the queue unaffected.
   *  Exporting: the export is aborted and the row parks "Cancelled — Retry"
   *  (the engine keeps a checkpoint, so Retry resumes). No chime. */
  cancel(id: string): void {
    this.chimeArmed = false;
    this.queue.cancel(id);
  }

  /** Cancel every queued row and abort the active one. */
  stopAll(): void {
    this.chimeArmed = false;
    this.queue.cancelAll();
  }

  private toReady(row: BulkExportRow): void {
    row.phase = 'idle';
    row.message = undefined;
    row.flags = undefined;
  }

  /** Same fresh checks as Start (guard, path, media); every outcome lands on
   *  the row — a missing project or a throwing load is a visible block. */
  async retry(id: string): Promise<void> {
    const row = this.ensureRow(id);
    const syncing = pipelineConflict(id, 'export');
    if (syncing) {
      row.phase = 'waiting';
      row.message = waitingMessageFor(syncing);
      this.commit();
      return;
    }
    const verdict = await this.evaluate(this.freshMeta(id)).catch(loadFailed);
    if ('blocked' in verdict) {
      row.phase = 'blocked';
      row.message = verdict.blocked;
      if (verdict.flags) row.flags = verdict.flags;
      this.commit();
      return;
    }
    let resume = false;
    const flags = [...verdict.flags];
    try {
      resume = (await this.deps.hasCheckpoint?.(verdict.project)) === true;
    } catch (err) {
      console.warn('[bulk-export] checkpoint check failed; exporting from the start:', err);
      flags.push(BULK_EXPORT_NO_CHECKPOINT_CHECK);
    }
    row.flags = flags;
    row.phase = 'queued';
    row.message = 'Queued';
    this.commit();
    this.queue.enqueue([this.jobFor(verdict.project, verdict.settings, resume)]);
  }

  private jobFor(project: Project, settings: BulkExportSettings, resume: boolean): QueueJob {
    return {
      id: project.id,
      label: project.name,
      // Claimed when the row actually runs (a sync may have started since
      // Start); the claim covers the whole export and is always released.
      run: (ctx: QueueRunContext): Promise<QueueJobOutcome> => runGuarded(project.id, 'export', () => this.execute({
          project,
          savedPath: settings.savedPath,
          resolution: settings.resolution,
          fps: settings.fps,
          resume,
          signal: ctx.signal,
          setPhase: ctx.setPhase,
        })),
    };
  }

  private ensureRow(id: string): BulkExportRow {
    let row = this.rows.find(r => r.id === id);
    if (!row) {
      const meta = this.deps.listProjects().find(p => p.id === id);
      row = { id, name: meta?.name ?? id, selected: false, phase: 'idle' };
      this.rows.push(row);
    }
    return row;
  }

  private onQueue(): void {
    const snap = this.queue.snapshot();
    for (const item of snap.items) {
      const row = this.rows.find(r => r.id === item.id);
      if (!row) continue;
      if (item.status === 'queued') { row.phase = 'queued'; row.message = 'Queued'; }
      else if (item.status === 'running') { row.phase = 'exporting'; row.message = item.phase || 'Exporting'; }
      else if (item.status === 'done') { row.phase = 'done'; row.message = 'Done'; }
      else if (item.status === 'failed') { row.phase = 'failed'; row.message = item.detail ? `Failed — Retry — ${item.detail}` : 'Failed — Retry'; }
      else if (item.status === 'paused' && item.reason === PIPELINE_BUSY_REASON) { row.phase = 'waiting'; row.message = item.detail; }
      else if (item.status === 'paused') { row.phase = 'paused'; row.message = 'Paused — Retry'; }
      else if (item.status === 'cancelled') {
        // Never started: back to Ready, as if never queued. Started: parked.
        if (item.startedAt === undefined) this.toReady(row);
        else { row.phase = 'cancelled'; row.message = 'Cancelled — Retry'; }
      }
    }
    this.commit();
  }

  /** Reload safety: in-flight / queued work is not auto-restarted. */
  parkUnfinished(): void {
    let changed = false;
    for (const row of this.rows) {
      if (row.phase === 'queued' || row.phase === 'exporting') {
        row.phase = 'paused';
        row.message = 'Paused — Retry';
        changed = true;
      }
    }
    if (changed) this.commit();
  }

  private load(): void {
    try {
      const raw = this.storage?.getItem(BULK_EXPORT_BATCH_KEY);
      const parsed = raw ? JSON.parse(raw) as { rows?: BulkExportRow[] } : null;
      if (parsed?.rows && Array.isArray(parsed.rows)) {
        this.rows = parsed.rows.filter(r => r && typeof r.id === 'string');
      }
    } catch { this.rows = []; }
    this.view = this.rows.map(r => ({ ...r, flags: r.flags ? [...r.flags] : undefined }));
  }

  private commit(): void {
    this.view = this.rows.map(r => ({ ...r, flags: r.flags ? [...r.flags] : undefined }));
    try { this.storage?.setItem(BULK_EXPORT_BATCH_KEY, JSON.stringify({ rows: this.rows })); } catch { /* ignore */ }
    for (const l of this.listeners) l();
  }

  private emit(): void {
    this.view = this.rows.map(r => ({ ...r, flags: r.flags ? [...r.flags] : undefined }));
    for (const l of this.listeners) l();
  }
}
