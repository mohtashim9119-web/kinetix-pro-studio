/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dashboard revamp — WORKSPACES. A workspace is a permanent, operator-named
// group of projects (one channel). View-layer state only: nothing in the
// sync / export queues reads it, so a project's workspace never changes what
// its pipeline does — only where its row and card are shown.
//
// One workspace per project (move semantics). Deleting a workspace never
// touches a project: its members simply fall back to "unassigned".

import { useSyncExternalStore } from 'react';

export const WORKSPACES_KEY = 'kinetix:workspaces:v1';

export interface Workspace {
  id: string;
  name: string;
  /** Project ids (bulk draft ids too — a draft's id becomes its project's id). */
  projectIds: string[];
  /** Display order, ascending. */
  order: number;
}

/** The workspace tab strips' selection: every row, or one workspace's. */
export type WorkspaceFilter = 'all' | string;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): Store | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `ws-${Date.now().toString(36)}-${Math.floor(performance.now() * 1000).toString(36)}`;
}

export class WorkspaceRegistry {
  private list: Workspace[] = [];
  private view: readonly Workspace[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Store | undefined = defaultStorage()) {
    this.load();
  }

  private load(): void {
    try {
      const raw = this.storage?.getItem(WORKSPACES_KEY);
      const parsed = raw ? JSON.parse(raw) as { workspaces?: unknown } : null;
      const items = Array.isArray(parsed?.workspaces) ? parsed!.workspaces as Partial<Workspace>[] : [];
      const claimed = new Set<string>();
      this.list = items
        .filter(w => w && typeof w.id === 'string' && Array.isArray(w.projectIds))
        .map((w, i) => ({
          id: w.id as string,
          name: String(w.name ?? '').trim() || 'Untitled workspace',
          order: typeof w.order === 'number' && Number.isFinite(w.order) ? w.order : i,
          // One workspace per project, even if storage was hand-edited.
          projectIds: (w.projectIds as unknown[]).filter((id): id is string => {
            if (typeof id !== 'string' || claimed.has(id)) return false;
            claimed.add(id);
            return true;
          }),
        }));
    } catch {
      this.list = [];
    }
    this.publish();
  }

  private publish(): void {
    this.view = [...this.list]
      .sort((a, b) => a.order - b.order)
      .map(w => ({ ...w, projectIds: [...w.projectIds] }));
  }

  private commit(): void {
    this.publish();
    try {
      this.storage?.setItem(WORKSPACES_KEY, JSON.stringify({ workspaces: this.list }));
    } catch { /* storage unavailable: still works this session */ }
    for (const l of this.listeners) l();
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  /** Ordered workspaces. Stable identity between changes (useSyncExternalStore). */
  snapshot(): readonly Workspace[] { return this.view; }

  nextDefaultName(): string {
    const used = new Set(this.list.map(w => w.name));
    let n = 1;
    while (used.has(`Workspace ${n}`)) n += 1;
    return `Workspace ${n}`;
  }

  /** A new, empty workspace at the end of the list. A blank name gets a default. */
  create(name: string): Workspace {
    const order = this.list.reduce((max, w) => Math.max(max, w.order), -1) + 1;
    const ws: Workspace = { id: newId(), name: name.trim() || this.nextDefaultName(), projectIds: [], order };
    this.list.push(ws);
    this.commit();
    return { ...ws, projectIds: [] };
  }

  rename(id: string, name: string): void {
    const ws = this.list.find(w => w.id === id);
    const next = name.trim();
    if (!ws || !next || ws.name === next) return;
    ws.name = next;
    this.commit();
  }

  /** The workspace goes; its projects stay, unassigned. */
  remove(id: string): void {
    if (!this.list.some(w => w.id === id)) return;
    this.list = this.list.filter(w => w.id !== id);
    this.commit();
  }

  /**
   * Move these projects into `workspaceId` (null = unassigned). A project is
   * in at most one workspace, so it leaves whichever one held it.
   */
  assign(projectIds: readonly string[], workspaceId: string | null): void {
    const ids = [...new Set(projectIds)];
    if (ids.length === 0) return;
    const target = workspaceId === null ? null : this.list.find(w => w.id === workspaceId);
    if (workspaceId !== null && !target) return;
    const moving = new Set(ids);
    for (const w of this.list) w.projectIds = w.projectIds.filter(id => !moving.has(id));
    if (target) target.projectIds.push(...ids);
    this.commit();
  }

  /** Deleted projects: drop them from whichever workspace held them. */
  forget(projectIds: readonly string[]): void {
    const gone = new Set(projectIds);
    if (!this.list.some(w => w.projectIds.some(id => gone.has(id)))) return;
    for (const w of this.list) w.projectIds = w.projectIds.filter(id => !gone.has(id));
    this.commit();
  }

  workspaceOf(projectId: string): Workspace | undefined {
    return this.view.find(w => w.projectIds.includes(projectId));
  }
}

let shared: WorkspaceRegistry | null = null;

/** The app's registry (localStorage-backed). Tests construct their own. */
export function workspaceRegistry(): WorkspaceRegistry {
  if (!shared) shared = new WorkspaceRegistry();
  return shared;
}

export function useWorkspaces(registry: WorkspaceRegistry = workspaceRegistry()): readonly Workspace[] {
  return useSyncExternalStore(l => registry.subscribe(l), () => registry.snapshot());
}

/** Is this id shown under this filter? "All" shows everything, assigned or not. */
export function inWorkspace(
  workspaces: readonly Workspace[],
  filter: WorkspaceFilter,
  projectId: string,
): boolean {
  if (filter === 'all') return true;
  return workspaces.find(w => w.id === filter)?.projectIds.includes(projectId) === true;
}

/** A filter that names a workspace that no longer exists falls back to All. */
export function resolveWorkspaceFilter(workspaces: readonly Workspace[], filter: WorkspaceFilter): WorkspaceFilter {
  return filter === 'all' || workspaces.some(w => w.id === filter) ? filter : 'all';
}
