/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dashboard revamp Stage 2 — the Workspaces tab: a vertical list of
// full-width workspace cards. Create, rename, delete (behind a confirm — its
// projects fall back to unassigned, nothing is lost), add existing projects
// (multi-select), and move a project between workspaces (one per project).

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { useWorkspaces, workspaceRegistry, type Workspace, type WorkspaceRegistry } from './workspaceRegistry';

export interface WorkspaceProject {
  id: string;
  name: string;
}

const UNASSIGNED = '__unassigned__';

export function WorkspacesPane({
  projects,
  draftIds,
  registry = workspaceRegistry(),
}: {
  /** Every project the operator can place (built projects and bulk records). */
  projects: readonly WorkspaceProject[];
  /** Bulk drafts not built yet: members, counted, but not in `projects`. */
  draftIds?: ReadonlySet<string>;
  registry?: WorkspaceRegistry;
}): React.ReactElement {
  const workspaces = useWorkspaces(registry);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Workspace | null>(null);
  const byId = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);

  const create = (): void => {
    registry.create(newName);
    setNewName('');
  };

  const memberCount = (ws: Workspace): number =>
    ws.projectIds.filter(id => byId.has(id) || draftIds?.has(id) === true).length;

  return (
    <div className="kxd-ws" data-testid="workspaces-pane">
      <form
        className="kxd-ws-create"
        onSubmit={e => { e.preventDefault(); create(); }}
      >
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
            <p className="kxd-ws-empty-sub">A workspace groups the projects of one channel. Create one above.</p>
          </div>
        ) : (
          <ol className="kxd-ws-cards">
            {workspaces.map(ws => (
              <WorkspaceCard
                key={ws.id}
                ws={ws}
                workspaces={workspaces}
                projects={projects}
                byId={byId}
                count={memberCount(ws)}
                registry={registry}
                onDelete={() => setConfirmDelete(ws)}
              />
            ))}
          </ol>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete workspace"
          body={`Delete "${confirmDelete.name}"? Its ${memberCount(confirmDelete)} project${memberCount(confirmDelete) === 1 ? '' : 's'} stay — they move to unassigned. No project is deleted.`}
          confirmLabel="Delete workspace"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { const ws = confirmDelete; setConfirmDelete(null); registry.remove(ws.id); }}
        />
      )}
    </div>
  );
}

function WorkspaceCard({
  ws, workspaces, projects, byId, count, registry, onDelete,
}: {
  ws: Workspace;
  workspaces: readonly Workspace[];
  projects: readonly WorkspaceProject[];
  byId: ReadonlyMap<string, WorkspaceProject>;
  count: number;
  registry: WorkspaceRegistry;
  onDelete: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(ws.name);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const members = ws.projectIds.map(id => byId.get(id)).filter((p): p is WorkspaceProject => !!p);
  const candidates = projects.filter(p => !ws.projectIds.includes(p.id));
  const homeOf = (id: string): Workspace | undefined => workspaces.find(w => w.projectIds.includes(id));

  const commitRename = (): void => {
    registry.rename(ws.id, draftName);
    setRenaming(false);
  };

  const togglePick = (id: string): void => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <li className="kxd-ws-card" data-testid={`workspace-card-${ws.id}`}>
      <div className="kxd-ws-card-head">
        <button
          type="button"
          className="kxd-ws-icon-btn"
          aria-expanded={open}
          aria-label={open ? `Collapse ${ws.name}` : `Expand ${ws.name}`}
          data-testid={`workspace-toggle-${ws.id}`}
          onClick={() => setOpen(o => !o)}
        >
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        </button>
        {renaming ? (
          <input
            autoFocus
            type="text"
            aria-label="Workspace name"
            data-testid={`workspace-rename-input-${ws.id}`}
            className="kxd-ws-input kxd-ws-rename"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') { setDraftName(ws.name); setRenaming(false); }
            }}
          />
        ) : (
          <h3 className="kxd-ws-name" data-testid={`workspace-name-${ws.id}`} title={ws.name}>{ws.name}</h3>
        )}
        <span className="kxd-ws-count" data-testid={`workspace-count-${ws.id}`}>
          {count === 1 ? '1 project' : `${count} projects`}
        </span>
      </div>
      <div className="kxd-ws-actions">
        <button
          type="button"
          className="kxd-text-btn"
          data-testid={`workspace-add-${ws.id}`}
          aria-expanded={picking}
          onClick={() => { setPicking(p => !p); setPicked(new Set()); }}
        >
          <Plus size={12} aria-hidden="true" /> Add projects
        </button>
        <button
          type="button"
          className="kxd-text-btn"
          data-testid={`workspace-rename-${ws.id}`}
          onClick={() => { setDraftName(ws.name); setRenaming(true); }}
        >
          <Pencil size={12} aria-hidden="true" /> Rename
        </button>
        <button
          type="button"
          className="kxd-text-btn kxd-ws-danger"
          data-testid={`workspace-delete-${ws.id}`}
          onClick={onDelete}
        >
          <Trash2 size={12} aria-hidden="true" /> Delete
        </button>
      </div>

      {picking && (
        <div className="kxd-ws-picker" data-testid={`workspace-picker-${ws.id}`}>
          {candidates.length === 0 ? (
            <p className="kxd-ws-muted">Every project is already in this workspace.</p>
          ) : (
            <ul className="kxd-ws-picker-list custom-scrollbar">
              {candidates.map(p => {
                const home = homeOf(p.id);
                return (
                  <li key={p.id}>
                    <label className="kxd-ws-pick">
                      <input
                        type="checkbox"
                        data-testid={`workspace-pick-${ws.id}-${p.id}`}
                        checked={picked.has(p.id)}
                        onChange={() => togglePick(p.id)}
                      />
                      <span className="kxd-ws-pick-name">{p.name}</span>
                      {home && <span className="kxd-ws-muted">in {home.name}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="kxd-ws-picker-foot">
            <button type="button" className="kxd-text-btn" onClick={() => { setPicking(false); setPicked(new Set()); }}>
              Cancel
            </button>
            <button
              type="button"
              className="kxd-btn kxd-btn-accent kxd-ws-picker-add"
              data-testid={`workspace-pick-confirm-${ws.id}`}
              disabled={picked.size === 0}
              onClick={() => {
                registry.assign([...picked], ws.id);
                setPicked(new Set());
                setPicking(false);
                setOpen(true);
              }}
            >
              {picked.size > 0 ? `Add ${picked.size}` : 'Add'}
            </button>
          </div>
        </div>
      )}

      {open && (
        <ul className="kxd-ws-members" data-testid={`workspace-members-${ws.id}`}>
          {members.length === 0 ? (
            <li className="kxd-ws-muted">No projects yet.</li>
          ) : members.map(p => (
            <li key={p.id} className="kxd-ws-member" data-testid={`workspace-member-${ws.id}-${p.id}`}>
              <span className="kxd-ws-member-name" title={p.name}>{p.name}</span>
              <select
                aria-label={`Move ${p.name} to`}
                data-testid={`workspace-move-${p.id}`}
                className="kxd-ws-select"
                value={ws.id}
                onChange={e => registry.assign([p.id], e.target.value === UNASSIGNED ? null : e.target.value)}
              >
                {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                <option value={UNASSIGNED}>Unassigned</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
