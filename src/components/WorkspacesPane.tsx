/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dashboard revamp — the Workspaces tab. A workspace carries a whole channel,
// so each is a fixed, full-width card: its name and three totals — projects,
// timeline duration and the real cloud cost those projects consumed. Add
// projects sits top-right; Rename (beside the name) and Delete (bottom-left)
// show on hover only and both go through a dialog — Delete spells out exactly
// what is and is not lost. The Add projects dialog lists every project with
// its dashboard thumbnail, grouped by workspace (every workspace appears,
// empty or not); picking one from another workspace moves it (one per project).

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, FolderPlus, Image as ImageIcon, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { ProjectMeta } from '../types';
import type { BatchPhase } from '../services/bulkBatch';
import { projectCostLedger } from '../services/projectCostLedgerShared';
import { summarizeLedger } from '../services/projectCostLedger';
import { CLOUD_USD_PER_WORKER_SEC } from '../services/cloudQueueJob';
import { formatUsd } from '../services/syncQueue';
import { ProjectCardThumb } from './ProjectCardThumb';
import { formatDuration, useProjectDurations } from './projectDurations';
import { useWorkspaces, workspaceRegistry, type Workspace, type WorkspaceRegistry } from './workspaceRegistry';

export interface WorkspaceProject {
  id: string;
  name: string;
  /** Last saved (built projects). */
  savedAt?: number;
  segmentCount?: number;
  /** The dashboard's record (its thumbnail). Absent for a bulk record not on the grid yet. */
  meta?: ProjectMeta;
  /** Its bulk batch phase, when it has one. */
  phase?: BatchPhase;
  /** Cloud attempts its bulk record billed (summed into the cost with the ledger). */
  billingAttempts?: readonly { at: number; workerSec: number }[];
}

const RUNNING: ReadonlySet<BatchPhase> = new Set(['queued', 'cloud', 'cloud-done', 'finishing']);

interface WorkspaceStats {
  projects: number;
  /** Timeline seconds over the projects whose record has loaded. */
  durationSec: number;
  /** Projects whose duration is still loading (or has none yet). */
  durationPending: number;
  costUsd: number;
  running: number;
  lastActivity: number | null;
}

function statsOf(
  ws: Workspace,
  byId: ReadonlyMap<string, WorkspaceProject>,
  draftIds: ReadonlySet<string> | undefined,
  durations: ReadonlyMap<string, number>,
  costOf: (p: WorkspaceProject) => number,
): WorkspaceStats {
  const out: WorkspaceStats = { projects: 0, durationSec: 0, durationPending: 0, costUsd: 0, running: 0, lastActivity: null };
  for (const id of ws.projectIds) {
    const p = byId.get(id);
    if (!p) {
      if (draftIds?.has(id)) out.projects += 1;
      continue;
    }
    out.projects += 1;
    const sec = durations.get(id);
    if (sec !== undefined) out.durationSec += sec;
    else if (p.savedAt) out.durationPending += 1;
    out.costUsd += costOf(p);
    if (p.savedAt) out.lastActivity = Math.max(out.lastActivity ?? 0, p.savedAt);
    if (p.phase && RUNNING.has(p.phase)) out.running += 1;
  }
  return out;
}

function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'W';
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words[1]![0]}`;
  return letters.toUpperCase();
}

function formatActivity(ts: number | null): string {
  if (!ts) return 'No activity yet';
  return `Updated ${new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

type DialogState =
  | { kind: 'rename'; ws: Workspace }
  | { kind: 'delete'; ws: Workspace }
  | { kind: 'add'; ws: Workspace }
  | null;

export function WorkspacesPane({
  projects,
  draftIds,
  registry = workspaceRegistry(),
  selectedId = null,
  onSelect,
}: {
  /** Every project the operator can place (built projects and bulk records). */
  projects: readonly WorkspaceProject[];
  /** Bulk drafts not built yet: members, counted, but not in `projects`. */
  draftIds?: ReadonlySet<string>;
  registry?: WorkspaceRegistry;
  /** The workspace the project grid is filtered to (null = All). */
  selectedId?: string | null;
  /** A card was clicked: filter the grid to it (null = back to All). */
  onSelect?: (id: string | null) => void;
}): React.ReactElement {
  const workspaces = useWorkspaces(registry);
  const [newName, setNewName] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const byId = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);

  // Real cloud spend: the per-project cost ledger plus any billed bulk attempt
  // it never saw (the same sum the bulk row's cost popover shows).
  const ledger = projectCostLedger();
  useSyncExternalStore(ledger.subscribe.bind(ledger), () => ledger.getVersion());
  const costOf = (p: WorkspaceProject): number =>
    summarizeLedger(ledger.get(p.id), p.billingAttempts, CLOUD_USD_PER_WORKER_SEC).totalUsd;

  const members = useMemo(() => {
    const ids = new Set(workspaces.flatMap(w => w.projectIds));
    return projects.filter(p => ids.has(p.id));
  }, [projects, workspaces]);
  const durations = useProjectDurations(members);
  const stats = (ws: Workspace): WorkspaceStats => statsOf(ws, byId, draftIds, durations, costOf);

  const create = (): void => {
    registry.create(newName);
    setNewName('');
  };

  return (
    <div className="kxd-ws" data-testid="workspaces-pane">
      <form className="kxd-ws-create" onSubmit={e => { e.preventDefault(); create(); }}>
        <input
          type="text"
          data-testid="workspace-create-name"
          aria-label="New workspace name"
          placeholder={registry.nextDefaultName()}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          className="kxd-ws-input"
        />
        <button type="submit" data-testid="workspace-create" className="kxd-btn kxd-btn-accent kxd-ws-create-btn">
          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
          Create
        </button>
      </form>

      <div className="kxd-ws-list custom-scrollbar">
        {workspaces.length === 0 ? (
          <div className="kxd-ws-empty" data-testid="workspaces-empty">
            <FolderPlus size={28} strokeWidth={1.5} aria-hidden="true" />
            <p>No workspaces yet.</p>
            <p className="kxd-ws-empty-sub">A workspace holds the projects of one channel. Create one above.</p>
          </div>
        ) : (
          <ol className="kxd-ws-cards">
            {workspaces.map(ws => (
              <WorkspaceCard
                key={ws.id}
                ws={ws}
                stats={stats(ws)}
                selected={ws.id === selectedId}
                onSelect={onSelect ? () => onSelect(ws.id === selectedId ? null : ws.id) : undefined}
                onRename={() => setDialog({ kind: 'rename', ws })}
                onDelete={() => setDialog({ kind: 'delete', ws })}
                onAdd={() => setDialog({ kind: 'add', ws })}
              />
            ))}
          </ol>
        )}
      </div>

      {dialog?.kind === 'rename' && (
        <RenameDialog
          ws={dialog.ws}
          onCancel={() => setDialog(null)}
          onSave={name => { registry.rename(dialog.ws.id, name); setDialog(null); }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          ws={dialog.ws}
          stats={stats(dialog.ws)}
          onCancel={() => setDialog(null)}
          onConfirm={() => { registry.remove(dialog.ws.id); setDialog(null); }}
        />
      )}
      {dialog?.kind === 'add' && (
        <AddProjectsDialog
          ws={dialog.ws}
          workspaces={workspaces}
          projects={projects}
          onCancel={() => setDialog(null)}
          onAdd={ids => { registry.assign(ids, dialog.ws.id); setDialog(null); }}
        />
      )}
    </div>
  );
}

function WorkspaceCard({
  ws, stats, selected, onSelect, onRename, onDelete, onAdd,
}: {
  ws: Workspace;
  stats: WorkspaceStats;
  selected: boolean;
  /** Click (or Enter / Space) anywhere but its buttons. */
  onSelect?: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAdd: () => void;
}): React.ReactElement {
  const durationText = stats.durationSec > 0 || stats.durationPending === 0 ? formatDuration(stats.durationSec) : '…';
  return (
    <li
      className={`kxd-wsc${selected ? ' is-selected' : ''}${onSelect ? ' is-selectable' : ''}`}
      data-testid={`workspace-card-${ws.id}`}
      aria-current={selected ? 'true' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={onSelect ? `${selected ? 'Showing' : 'Show'} ${ws.name} in the project grid` : undefined}
      onClick={e => {
        if (!onSelect || (e.target as Element).closest('button')) return;
        onSelect();
      }}
      onKeyDown={e => {
        if (!onSelect || e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      }}
    >
      <div className="kxd-wsc-head">
        <span className="kxd-wsc-mark" aria-hidden="true">{monogram(ws.name)}</span>
        <div className="kxd-wsc-title">
          <span className="kxd-wsc-eyebrow">Workspace</span>
          <div className="kxd-wsc-name-row">
            <h3 className="kxd-wsc-name" data-testid={`workspace-name-${ws.id}`} title={ws.name}>{ws.name}</h3>
            <button
              type="button"
              className="kxd-wsc-tool kxd-wsc-hover"
              data-testid={`workspace-rename-${ws.id}`}
              aria-label={`Rename ${ws.name}`}
              title="Rename"
              onClick={onRename}
            >
              <Pencil size={12} aria-hidden="true" />
            </button>
          </div>
        </div>
        <button type="button" className="kxd-wsc-add" data-testid={`workspace-add-${ws.id}`} onClick={onAdd}>
          <Plus size={12} strokeWidth={2.4} aria-hidden="true" />
          Add projects
        </button>
      </div>

      <dl className="kxd-wsc-stats">
        <div data-testid={`workspace-count-${ws.id}`}>
          <dt>Projects</dt>
          <dd className="kxd-wsc-stat-lead">{stats.projects}</dd>
        </div>
        <div data-testid={`workspace-duration-${ws.id}`} title={stats.durationPending > 0 ? `${plural(stats.durationPending, 'project')} still loading` : undefined}>
          <dt>Duration</dt>
          <dd>{durationText}</dd>
        </div>
        <div data-testid={`workspace-cost-${ws.id}`} title="Cloud spend these projects consumed (transcription, alignment, retries)">
          <dt>Cloud cost</dt>
          <dd>{stats.costUsd > 0 ? formatUsd(stats.costUsd) : '$0.00'}</dd>
        </div>
      </dl>

      <div className="kxd-wsc-foot">
        <button
          type="button"
          className="kxd-wsc-tool kxd-wsc-tool-danger kxd-wsc-hover"
          data-testid={`workspace-delete-${ws.id}`}
          aria-label={`Delete ${ws.name}`}
          title="Delete workspace"
          onClick={onDelete}
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
        <span className="kxd-wsc-activity">
          {stats.running > 0 ? <span className="kxd-wsc-live">{`${stats.running} syncing · `}</span> : null}
          {formatActivity(stats.lastActivity)}
        </span>
      </div>
    </li>
  );
}

/** The dashboard's dialog shell, with Escape to cancel. */
function Dialog({ label, wide, onCancel, children }: { label: string; wide?: boolean; onCancel: () => void; children: React.ReactNode }): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="kxd-dialog-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={`kxd-dialog kxd-ws-dialog${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function RenameDialog({ ws, onCancel, onSave }: { ws: Workspace; onCancel: () => void; onSave: (name: string) => void }): React.ReactElement {
  const [name, setName] = useState(ws.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const valid = name.trim().length > 0;
  return (
    <Dialog label="Rename workspace" onCancel={onCancel}>
      <h3>Rename workspace</h3>
      <form onSubmit={e => { e.preventDefault(); if (valid) onSave(name); }}>
        <input
          ref={ref}
          type="text"
          aria-label="Workspace name"
          data-testid={`workspace-rename-input-${ws.id}`}
          className="kxd-ws-input kxd-ws-dialog-input"
          value={name}
          maxLength={80}
          onChange={e => setName(e.target.value)}
        />
        <p className="kxd-ws-dialog-note">Only the name changes — its projects and their pipelines are untouched.</p>
        <div className="kxd-dialog-actions">
          <button type="button" className="kxd-dialog-cancel" data-testid="workspace-dialog-cancel" onClick={onCancel}>Cancel</button>
          <button type="submit" className="kxd-btn kxd-btn-accent kxd-ws-dialog-primary" data-testid="workspace-rename-save" disabled={!valid}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteDialog({ ws, stats, onCancel, onConfirm }: { ws: Workspace; stats: WorkspaceStats; onCancel: () => void; onConfirm: () => void }): React.ReactElement {
  return (
    <Dialog label="Delete workspace" onCancel={onCancel}>
      <h3>Delete “{ws.name}”?</h3>
      <ul className="kxd-ws-warnings">
        <li>
          <strong>{plural(stats.projects, 'project')}</strong> leave this workspace and become unassigned.
          No project, media file, timeline, export or cost record is deleted.
        </li>
        {stats.running > 0 && (
          <li><strong>{plural(stats.running, 'project')}</strong> still syncing keep running — they show under All.</li>
        )}
        <li>Bulk Sync, Bulk Export and the project grid switch back to All wherever this workspace was selected.</li>
        <li className="kxd-ws-warning-strong">
          This cannot be undone. The workspace’s name and its membership are lost — to rebuild it you would
          create a new workspace and add every project again.
        </li>
      </ul>
      <div className="kxd-dialog-actions">
        <button type="button" className="kxd-dialog-cancel" data-testid="workspace-dialog-cancel" onClick={onCancel}>Cancel</button>
        <button type="button" className="kxd-dialog-confirm" data-testid="workspace-delete-confirm" onClick={onConfirm}>
          Delete workspace
        </button>
      </div>
    </Dialog>
  );
}

function PickThumb({ project }: { project: WorkspaceProject }): React.ReactElement {
  return (
    <span className="kxd-pick-thumb" aria-hidden="true">
      {project.meta ? <ProjectCardThumb meta={project.meta} /> : <span className="kxd-art-empty"><ImageIcon size={14} strokeWidth={1.5} /></span>}
    </span>
  );
}

function AddProjectsDialog({
  ws, workspaces, projects, onCancel, onAdd,
}: {
  ws: Workspace;
  workspaces: readonly Workspace[];
  projects: readonly WorkspaceProject[];
  onCancel: () => void;
  onAdd: (ids: string[]) => void;
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();
  const matches = (p: WorkspaceProject): boolean => p.name.toLowerCase().includes(q);
  const homeOf = (id: string): Workspace | undefined => workspaces.find(w => w.projectIds.includes(id));
  // Every workspace appears — named or default, empty or not — then Unassigned.
  // This workspace's own projects show as already added.
  const sections: { id: string; title: string; current: boolean; rows: WorkspaceProject[] }[] = [
    ...workspaces.map(w => ({
      id: w.id,
      title: w.name,
      current: w.id === ws.id,
      rows: projects.filter(p => w.projectIds.includes(p.id) && matches(p)),
    })),
    { id: '__unassigned__', title: 'Unassigned', current: false, rows: projects.filter(p => !homeOf(p.id) && matches(p)) },
  ];
  // This workspace first, so what is already here reads at a glance.
  sections.sort((a, b) => Number(b.current) - Number(a.current));
  const moving = [...picked].filter(id => homeOf(id)).length;
  const toggle = (id: string): void => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <Dialog label="Add projects" wide onCancel={onCancel}>
      <h3>Add projects to “{ws.name}”</h3>
      <label className="kxd-ws-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="text"
          autoFocus
          aria-label="Search projects"
          placeholder="Search projects"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </label>
      <div className="kxd-pick-scroll custom-scrollbar" data-testid={`workspace-picker-${ws.id}`}>
        {sections.map(section => (
          <section key={section.id} className="kxd-pick-section" data-testid={`workspace-picker-section-${section.id}`}>
            <header className="kxd-pick-section-head">
              <span className="kxd-pick-section-title">{section.title}</span>
              {section.current && <span className="kxd-pick-badge">This workspace</span>}
              <span className="kxd-pick-section-count">{section.rows.length}</span>
            </header>
            {section.rows.length === 0 ? (
              <p className="kxd-pick-empty">{q ? 'No matches.' : 'No projects yet.'}</p>
            ) : (
              <ul className="kxd-pick-list">
                {section.rows.map(p => {
                  const on = picked.has(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={`kxd-pick-row${on ? ' is-on' : ''}${section.current ? ' is-here' : ''}`}
                        data-testid={`workspace-pick-${ws.id}-${p.id}`}
                        aria-pressed={section.current ? true : on}
                        disabled={section.current}
                        onClick={() => toggle(p.id)}
                      >
                        <PickThumb project={p} />
                        <span className="kxd-pick-name" title={p.name}>{p.name}</span>
                        <span className="kxd-pick-check" aria-hidden="true">
                          {(on || section.current) && <Check size={12} strokeWidth={3} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
      {moving > 0 && (
        <p className="kxd-ws-dialog-note">
          {plural(moving, 'project')} will move here from {moving === 1 ? 'its' : 'their'} current workspace — a project lives in one workspace.
        </p>
      )}
      <div className="kxd-dialog-actions">
        <button type="button" className="kxd-dialog-cancel" data-testid="workspace-dialog-cancel" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="kxd-btn kxd-btn-accent kxd-ws-dialog-primary"
          data-testid={`workspace-pick-confirm-${ws.id}`}
          disabled={picked.size === 0}
          onClick={() => onAdd([...picked])}
        >
          {picked.size > 0 ? `Add ${picked.size}` : 'Add'}
        </button>
      </div>
    </Dialog>
  );
}
