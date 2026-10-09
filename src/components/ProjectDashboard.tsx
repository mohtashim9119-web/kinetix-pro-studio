import React, { useEffect, useLayoutEffect, useState, useRef, useCallback, useSyncExternalStore } from 'react';
import { Plus, Trash2, Search, Check, Loader2, Settings, ChevronDown, Play } from 'lucide-react';
import type { ProjectMeta } from '../types';
import { loadAllMetas, commitTombstones } from '../services/projectStore';
import { cleanupDeletedProjectAssets, deleteProjectRecords } from '../services/projectDelete';
import { isTauri } from '../services/tauriFfmpeg';
import { readSyncEngineHost, onSyncEngineHostChange, type SyncEngineHost } from '../services/syncEngineHost';
import { bulkBatchRunner, queueProjectsForCloudSync } from '../services/bulkSyncQueue';
import type { CloudQueueDeps } from '../services/cloudQueueJob';
import { SyncQueuePanel } from './SyncQueuePanel';
import { BULK_COPY } from '../services/bulkContext';
import { batchProgress, unbuiltBulkRowIds } from '../services/bulkBatch';
import { killAllMemberCloudJobs } from '../services/cloudSyncEngine';
import { FailedDot, ProgressRing } from './BulkProgress';
import { Z } from './overlayLayers';
import { ProjectCardThumb } from './ProjectCardThumb';
import { WorkspacesPane, type WorkspaceProject } from './WorkspacesPane';
import { DASHBOARD_LEFT_TABS, type DashboardLeftTab } from './dashboardLeftTab';
import { inWorkspace, resolveWorkspaceFilter, useWorkspaces, workspaceRegistry, type WorkspaceFilter } from './workspaceRegistry';
import { WorkspaceTabs } from './WorkspaceTabs';
import './ProjectDashboard.css';

/**
 * Project ids this process has already shown in the dashboard grid. The
 * dashboard unmounts whenever the editor is up, so a per-component ref could
 * never tell a genuinely new project from a remount — every card would animate
 * on every return to the grid. Module scope is what outlives the unmount.
 */
const seenProjectIds = new Set<string>();

interface Props {
  currentProjectId: string | null;
  /**
   * Id of the project whose open is currently in flight, or null. The
   * dashboard stays mounted for the whole async load (App.tsx flips the view
   * at the project-state swap, not at promise resolution), so this is what
   * tells the user their click registered.
   */
  openingProjectId?: string | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  /**
   * Opens App Settings (WS2 T4.1 Step 1). THE ONLY entry point to it, and it
   * lives here rather than in the editor for a reason: App Settings is
   * machine-global, so it must be reachable with no project loaded — including
   * on a fresh install where the user's first task is downloading a model
   * before any project exists to open. App renders the modal in its outer
   * fragment so this can raise it over the dashboard.
   */
  onOpenAppSettings: () => void;
  /**
   * WS3 item H — called once, after a bulk delete, if any project's NATIVE
   * asset cleanup failed. The project record itself is still deleted either
   * way (it is gone from the grid regardless) — this is specifically about
   * the native asset bytes item B made authoritative, which can now be
   * orphaned on disk if this fires and nothing surfaces it. Optional so a
   * caller that doesn't care (a test harness) need not pass it, but App.tsx
   * always does — a failed cleanup must never simply be silent.
   */
  onAssetCleanupFailed?: (message: string) => void;
  /**
   * Wave 3 U7 — App.tsx's `parseProjectData`, injected so the bulk queue can
   * plan a stored project's scenes without importing the app. The "Sync on
   * cloud" action appears only when this is given.
   */
  parseProjectData?: CloudQueueDeps['parseProjectData'];
  /** Bumped by App when projects were created/removed behind the dashboard. */
  metasVersion?: number;
  /** The rows modal is open: the queue is shown there, not here too. */
  bulkOpen?: boolean;
  /** Ids just deleted, so the editor can drop one it still holds in memory. */
  onProjectsDeleted?: (ids: string[]) => void;
  /** The left panel's tab, when App owns it (it must know what is showing). */
  leftTab?: DashboardLeftTab;
  onLeftTabChange?: (tab: DashboardLeftTab) => void;
  /**
   * Stable elements App portals a tab's content into (Bulk Sync, Bulk Export).
   * The pane adopts its element while the dashboard is up; the content's React
   * tree lives in App and never remounts with the dashboard or the tab.
   */
  paneHosts?: Partial<Record<DashboardLeftTab, HTMLElement | null>>;
}

export { DASHBOARD_LEFT_TABS, type DashboardLeftTab };

/** Adopts App's stable host element into this pane for as long as it is mounted. */
function PaneHost({ host }: { host: HTMLElement }): React.ReactElement {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    host.style.display = 'contents';
    el.appendChild(host);
    return () => { if (host.parentNode === el) el.removeChild(host); };
  }, [host]);
  return <div ref={slot} className="kxd-pane-host" />;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

const PERFORATIONS = Array.from({ length: 8 }, (_, i) => i);

export function ProjectDashboard({
  currentProjectId,
  openingProjectId = null,
  onSelectProject,
  onNewProject,
  onOpenAppSettings,
  onAssetCleanupFailed,
  parseProjectData,
  metasVersion = 0,
  bulkOpen = false,
  onProjectsDeleted,
  leftTab: controlledLeftTab,
  onLeftTabChange,
  paneHosts,
}: Props): React.ReactElement {
  const [engineHost, setEngineHost] = useState<SyncEngineHost>(readSyncEngineHost);
  useEffect(() => onSyncEngineHostChange(setEngineHost), []);
  const [metas, setMetas] = useState<ProjectMeta[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const workspaces = useWorkspaces();
  const [gridWsRaw, setGridWs] = useState<WorkspaceFilter>('all');
  const gridWs = resolveWorkspaceFilter(workspaces, gridWsRaw);
  const [ownLeftTab, setOwnLeftTab] = useState<DashboardLeftTab>('workspaces');
  const leftTab = controlledLeftTab ?? ownLeftTab;
  const setLeftTab = (tab: DashboardLeftTab): void => {
    setOwnLeftTab(tab);
    onLeftTabChange?.(tab);
  };
  // The persistent batch: reachable from here until it is cleared, even after a reload.
  const batch = bulkBatchRunner(parseProjectData);
  const batchRows = useSyncExternalStore(l => batch.subscribe(l), () => batch.snapshot());
  const batchGroups = useSyncExternalStore(l => batch.subscribe(l), () => batch.groups());
  const bulkSignal = batchProgress(batchGroups, batchRows);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  /** Ids that were absent last time this process rendered the grid. */
  const enteringIds = useRef<Set<string>>(new Set());

  // Re-read the grid when the background pipeline makes a row ready: its
  // record was just saved with the built timeline (scene count, date).
  const readyKey = batchRows.filter(r => r.phase === 'done').map(r => r.id).join('|');
  useEffect(() => {
    const data = loadAllMetas();
    data.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    enteringIds.current = new Set(data.filter(m => !seenProjectIds.has(m.id)).map(m => m.id));
    data.forEach(m => seenProjectIds.add(m.id));
    setMetas(data);
  }, [metasVersion, readyKey]);

  useEffect(() => {
    void navigator.storage?.estimate?.().then(({ usage, quota }) => {
      if (usage !== undefined && quota) setStorage({ usage, quota });
    });
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'Escape') {
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 1.3.0 — an unbuilt bulk row is a drawer draft with no project record, so
  // it never reaches this grid; Build Timeline creates the record and that is
  // what flips the row onto it.
  // Workspaces place built projects and bulk records (named); unbuilt drafts
  // are members too, counted but not listed by name.
  const workspaceProjects = React.useMemo<WorkspaceProject[]>(() => {
    const seen = new Set(metas.map(m => m.id));
    return [
      ...metas.map(m => ({ id: m.id, name: m.name })),
      ...batchRows.filter(r => !seen.has(r.id)).map(r => ({ id: r.id, name: r.name })),
    ];
  }, [metas, batchRows]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const draftIds = React.useMemo(() => new Set(unbuiltBulkRowIds()), [metas, batchRows]);

  const filtered = metas.filter(m =>
    inWorkspace(workspaces, gridWs, m.id) && m.name.toLowerCase().includes(search.trim().toLowerCase()));
  const visibleIds = filtered.map(m => m.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const selectedCount = selectedIds.size;

  const toggleSelect = useCallback((id: string): void => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function handleSelectAllToggle(): void {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  }

  async function handleBulkDelete(): Promise<void> {
    const ids = Array.from(selectedIds);
    setShowBulkConfirm(false);
    await commitTombstones(ids);
    await deleteProjectRecords(ids);
    setMetas(prev => prev.filter(m => !ids.includes(m.id)));
    setSelectedIds(new Set());
    bulkBatchRunner(parseProjectData).forget(ids);
    workspaceRegistry().forget(ids);
    onProjectsDeleted?.(ids);
    void (async () => {
      const cleanupFailures: string[] = [];
      const batches = await Promise.all(ids.map(id => cleanupDeletedProjectAssets(id)));
      for (const f of batches) cleanupFailures.push(...f);
      if (cleanupFailures.length > 0) {
        onAssetCleanupFailed?.(
          `${cleanupFailures.length} deleted project${cleanupFailures.length === 1 ? '' : 's'} could not be fully ` +
            `cleaned up on disk — the project${cleanupFailures.length === 1 ? ' is' : 's are'} gone, but some ` +
            `asset bytes may remain. (${cleanupFailures.join('; ')})`,
        );
      }
    })();
  }

  return (
    <div className={`kxd-root fixed inset-0 ${showBulkConfirm ? Z.modal : Z.dashboard}`}>
      <aside className="kxd-left" data-testid="dashboard-left-panel" aria-label="Studio panel">
        <div className="kxd-left-head">
          <h2>Studio</h2>
        </div>
        <div role="tablist" aria-label="Studio panel tabs" className="kxd-tabs" data-testid="dashboard-left-tabs">
          {DASHBOARD_LEFT_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`kxd-tab-${t.id}`}
              aria-selected={leftTab === t.id}
              aria-controls={`kxd-pane-${t.id}`}
              data-testid={`dashboard-left-tab-${t.id}`}
              className="kxd-tab"
              onClick={() => setLeftTab(t.id)}
            >
              {t.label}
              {/* The batch at a glance: a ring + n/m from the first Build Timeline until the
                  batch is cleared (full ring when finished), a red dot when any row failed. */}
              {t.id === 'bulk-sync' && batchRows.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <ProgressRing done={bulkSignal.done} total={bulkSignal.total} size={12} />
                  <span data-testid="dashboard-bulk-count" className="text-[10px] tabular-nums">{`${bulkSignal.done}/${bulkSignal.total}`}</span>
                </span>
              )}
              {t.id === 'bulk-sync' && bulkSignal.failed > 0 && <FailedDot count={bulkSignal.failed} />}
            </button>
          ))}
        </div>
        {DASHBOARD_LEFT_TABS.map(t => (
          <div
            key={t.id}
            role="tabpanel"
            id={`kxd-pane-${t.id}`}
            aria-labelledby={`kxd-tab-${t.id}`}
            data-testid={`dashboard-left-pane-${t.id}`}
            className="kxd-left-pane"
            hidden={leftTab !== t.id}
          >
            {t.id === 'workspaces' ? (
              <WorkspacesPane projects={workspaceProjects} draftIds={draftIds} />
            ) : paneHosts?.[t.id] ? (
              <PaneHost host={paneHosts[t.id]!} />
            ) : (
              <p className="kxd-pane-placeholder">{t.label}</p>
            )}
          </div>
        ))}
      </aside>

      <section className="kxd-right" data-testid="dashboard-right-panel">
      <header className="kxd-topbar">
        <div className="kxd-brand">
          <div className="kxd-brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <path d="M3 9h18M8 5v4M16 5v4M8 15v4M16 15v4" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </div>
          <span className="kxd-brand-name">Kinetix<span>.</span></span>
          <span className="kxd-brand-sub">PRO&nbsp;STUDIO</span>
        </div>

        <div className="kxd-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search projects"
            autoComplete="off"
            aria-label="Search projects"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <kbd>⌘K</kbd>
        </div>

        <div className="kxd-actions">
          {parseProjectData && batchRows.some(r => r.phase === 'queued' || r.phase === 'cloud') && (
            <button
              className="kxd-btn kxd-btn-quiet"
              data-testid="dashboard-stop-all"
              onClick={() => { void batch.stopAllCloudWork(() => killAllMemberCloudJobs()); }}
            >
              {BULK_COPY.stopAll}
            </button>
          )}
          <button className="kxd-btn kxd-btn-accent" onClick={onNewProject}>
            <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
            New Project
          </button>

          <div className="kxd-profile" ref={profileRef}>
            <button
              className="kxd-profile-trigger"
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              aria-label="Workspace menu"
              onClick={() => setProfileOpen(o => !o)}
            >
              <span className="kxd-avatar">KX</span>
              <ChevronDown className="kxd-chev" size={13} aria-hidden="true" />
            </button>

            {/* Kept mounted so the open/close transition can run; `inert` is what
                keeps the closed menu out of the tab order and off the a11y tree. */}
            <div className={`kxd-profile-menu${profileOpen ? ' is-open' : ''}`} role="menu" inert={!profileOpen}>
              <div className="kxd-profile-menu-header">
                <span className="kxd-avatar kxd-avatar-lg">KX</span>
                <div>
                  <div className="kxd-profile-name">Local workspace</div>
                  <div className="kxd-profile-sub">Stored on this device</div>
                </div>
                <span className="kxd-plan-badge">OFFLINE</span>
              </div>

              <div className="kxd-menu-divider" />

              <button
                className="kxd-menu-item"
                role="menuitem"
                data-testid="dashboard-open-app-settings"
                onClick={() => {
                  setProfileOpen(false);
                  onOpenAppSettings();
                }}
              >
                <Settings size={16} aria-hidden="true" />
                App Settings
              </button>
              <button
                className="kxd-menu-item"
                role="menuitem"
                onClick={() => {
                  setProfileOpen(false);
                  searchRef.current?.focus();
                }}
              >
                <Search size={16} aria-hidden="true" />
                Search projects
                <span className="kxd-menu-shortcut">⌘K</span>
              </button>

              <div className="kxd-menu-divider" />

              <div className="kxd-menu-storage">
                <div className="kxd-menu-storage-row">
                  <span>Storage</span>
                  <span>
                    {storage
                      ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}`
                      : 'Unavailable'}
                  </span>
                </div>
                <div className="kxd-menu-storage-bar">
                  <div
                    className="kxd-menu-storage-fill"
                    style={{ width: storage ? `${Math.min(100, (storage.usage / storage.quota) * 100)}%` : '0%' }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="kxd-main custom-scrollbar">
        <div className="kxd-main-inner">
          {!bulkOpen && <SyncQueuePanel />}
          <div className="kxd-grid-frame" data-testid="project-grid-frame">
          <div className="kxd-section-head">
            <h1>Recent projects</h1>
            <div>
              {selectedCount > 0 ? (
                <div className="kxd-selection-bar">
                  <span className="kxd-selection-count">
                    <span>{selectedCount}</span> selected
                  </span>
                  <div className="kxd-selection-divider" />
                  <button className="kxd-text-btn" onClick={handleSelectAllToggle}>
                    {allVisibleSelected ? 'Deselect all' : 'Select all'}
                  </button>
                  {parseProjectData && isTauri() && engineHost === 'cloud' && (
                    <button
                      className="kxd-text-btn"
                      data-testid="dashboard-sync-on-cloud"
                      onClick={() => {
                        const chosen = metas.filter(m => selectedIds.has(m.id));
                        queueProjectsForCloudSync(chosen, parseProjectData);
                        setSelectedIds(new Set());
                      }}
                    >
                      Sync on cloud
                    </button>
                  )}
                  <button className="kxd-btn-sm-danger" onClick={() => setShowBulkConfirm(true)}>
                    <Trash2 size={13} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              ) : (
                <span className="kxd-project-count">
                  {metas.length === 1 ? '1 project' : `${metas.length} projects`}
                </span>
              )}
            </div>
          </div>

          <div className="kxd-ws-strip">
            <WorkspaceTabs
              workspaces={workspaces}
              value={gridWs}
              onChange={setGridWs}
              testIdPrefix="grid-ws"
              label="Project workspaces"
            />
          </div>

          {/* Project grid — inert for the duration of an in-flight open, so a
              second click can't start a competing switch while the first is
              still awaiting storage. */}
          <div
            data-testid="project-grid"
            className="kxd-grid"
            style={openingProjectId ? { pointerEvents: 'none' } : undefined}
          >
            {filtered.map(meta => {
              const isSelected = selectedIds.has(meta.id);
              const isCurrent = meta.id === currentProjectId;
              const scenes = meta.segmentCount ?? 0;
              const bulkPhase = batchRows.find(r => r.id === meta.id)?.phase;
              const bulkBadge = bulkPhase === 'paused' ? 'Paused'
                : bulkPhase === 'failed' || bulkPhase === 'finish-failed' ? 'Build failed'
                : undefined;
              const classes = [
                'kxd-card',
                isSelected ? 'is-selected' : '',
                isCurrent ? 'is-current' : '',
                enteringIds.current.has(meta.id) ? 'is-entering' : '',
              ].filter(Boolean).join(' ');

              return (
                <article
                 
                  key={meta.id}
                  data-testid={`project-card-${meta.id}`}
                  aria-busy={meta.id === openingProjectId ? true : undefined}
                  className={classes}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open "${meta.name}"`}
                  onClick={() => onSelectProject(meta.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectProject(meta.id);
                    }
                  }}
                >
                  <div className="kxd-thumb">
                    {meta.id === openingProjectId && (
                      <div className="kxd-card-spinner" data-testid={`project-card-spinner-${meta.id}`}>
                        <Loader2 size={28} className="animate-spin" aria-hidden="true" />
                      </div>
                    )}

                    <button
                      className="kxd-select-toggle"
                      aria-label={isSelected ? `Deselect "${meta.name}"` : `Select "${meta.name}"`}
                      aria-pressed={isSelected}
                      onClick={e => {
                        e.stopPropagation();
                        toggleSelect(meta.id);
                      }}
                    >
                      <Check size={12} strokeWidth={3} aria-hidden="true" />
                    </button>

                    <div className="kxd-perf kxd-perf-top">
                      {PERFORATIONS.map(i => <span key={i} />)}
                    </div>
                    <div className="kxd-perf kxd-perf-bottom">
                      {PERFORATIONS.map(i => <span key={i} />)}
                    </div>

                    <ProjectCardThumb meta={meta} />

                    <div className="kxd-play-hint">
                      <div className="kxd-play-hint-circle">
                        <Play size={15} fill="currentColor" aria-hidden="true" />
                      </div>
                    </div>

                    {bulkBadge ? (
                      <div className="kxd-scene-badge">{bulkBadge}</div>
                    ) : scenes > 0 ? (
                      <div className="kxd-scene-badge">{scenes} scene{scenes !== 1 ? 's' : ''}</div>
                    ) : null}
                    {isCurrent && <span className="kxd-current-badge">CURRENT</span>}
                  </div>

                  <div className="kxd-card-body">
                    <h3 className="kxd-card-title">{meta.name}</h3>
                    <div className="kxd-card-date">
                      {bulkBadge ? `${bulkBadge} · ` : scenes === 0 ? '0 scenes · ' : ''}
                      {meta.savedAt ? formatDate(meta.savedAt) : '—'}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="kxd-empty-state">
              <Search size={34} strokeWidth={1.5} aria-hidden="true" />
              <p>
                {search.trim()
                  ? 'No projects match your search.'
                  : gridWs !== 'all'
                    ? 'No projects in this workspace yet.'
                    : 'No projects yet — create your first one.'}
              </p>
            </div>
          )}
          </div>
        </div>
      </main>
      </section>


      {showBulkConfirm && (
        <div className="kxd-dialog-scrim">
          <div className="kxd-dialog" role="dialog" aria-modal="true" aria-label="Delete projects">
            <h3>Delete {selectedCount === 1 ? 'project' : 'projects'}</h3>
            <p>
              {selectedCount} project{selectedCount !== 1 ? 's' : ''} will be permanently deleted,
              along with all imported media. This cannot be undone.
            </p>
            <div className="kxd-dialog-actions">
              <button className="kxd-dialog-cancel" onClick={() => setShowBulkConfirm(false)}>
                Cancel
              </button>
              <button className="kxd-dialog-confirm" onClick={() => void handleBulkDelete()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
