/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SyncQueue, type QueueJob, type QueueJobOutcome, type QueueRunContext } from './syncQueue';
import { preflightBulkExport } from './bulkExportPreflight';
import { settingsFromProject } from './bulkExportSettings';
import { BULK_EXPORT_BATCH_KEY, readBulkExportSelection, writeBulkExportSelection } from './bulkExportPersist';
import type { Project } from '../types';
import { playExportCompleteChime } from './notificationSound';

export type BulkExportPhase = 'idle' | 'queued' | 'exporting' | 'done' | 'failed' | 'blocked' | 'paused';

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
  private execute: BulkExportExecutor;

  constructor(
    private readonly deps: {
      loadProject: (id: string) => Promise<Project | null>;
      listProjects: () => { id: string; name: string }[];
      execute: BulkExportExecutor;
      hasCheckpoint?: (project: Project) => Promise<boolean>;
      storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
      playChime?: () => void;
    },
  ) {
    this.storage = deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    this.queue = new SyncQueue({
      ...idleEngine,
      onDrain: () => {
        if (this.chimeArmed && this.rows.some(r => r.phase === 'done' || r.phase === 'failed' || r.phase === 'blocked')) {
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
    const finished = batch.filter(r => r.phase === 'done' || r.phase === 'failed' || r.phase === 'blocked').length;
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

  async startSelected(): Promise<void> {
    const chosen = this.deps.listProjects().filter(p => this.ensureRow(p.id).selected);
    this.chimeArmed = true;
    this.noticeDismissed = false;
    const jobs: QueueJob[] = [];
    for (const meta of chosen) {
      const row = this.ensureRow(meta.id);
      const project = await this.deps.loadProject(meta.id);
      if (!project) {
        row.phase = 'blocked';
        row.message = 'Blocked — project missing';
        continue;
      }
      const settings = settingsFromProject(project);
      if ('blocked' in settings) {
        row.phase = 'blocked';
        row.message = settings.blocked;
        continue;
      }
      const gate = preflightBulkExport(project.segments, project.assets);
      if (gate.kind === 'block') {
        row.phase = 'blocked';
        row.message = gate.message;
        row.flags = [];
        continue;
      }
      row.flags = gate.flags;
      row.phase = 'queued';
      row.message = 'Queued';
      jobs.push(this.jobFor(project, settings.savedPath, false));
    }
    this.commit();
    if (jobs.length > 0) this.queue.enqueue(jobs);
  }

  async retry(id: string): Promise<void> {
    const project = await this.deps.loadProject(id);
    if (!project) return;
    const settings = settingsFromProject(project);
    if ('blocked' in settings) {
      this.ensureRow(id).phase = 'blocked';
      this.ensureRow(id).message = settings.blocked;
      this.commit();
      return;
    }
    const resume = (await this.deps.hasCheckpoint?.(project)) === true;
    const row = this.ensureRow(id);
    row.phase = 'queued';
    row.message = 'Queued';
    this.commit();
    this.queue.enqueue([this.jobFor(project, settings.savedPath, resume)]);
  }

  private jobFor(project: Project, savedPath: string, resume: boolean): QueueJob {
    return {
      id: project.id,
      label: project.name,
      run: async (ctx: QueueRunContext): Promise<QueueJobOutcome> => {
        return this.execute({
          project,
          savedPath,
          resolution: project.resolutionTier,
          fps: 30,
          resume,
          signal: ctx.signal,
          setPhase: ctx.setPhase,
        });
      },
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
      else if (item.status === 'failed') { row.phase = 'failed'; row.message = 'Failed — Retry'; }
      else if (item.status === 'paused') { row.phase = 'paused'; row.message = 'Paused — Retry'; }
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
