import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Plus, Trash2, Search, Check, Loader2, Settings, ChevronDown, Play, Image as ImageIcon } from 'lucide-react';
import type { Project, ProjectMeta } from '../types';
import { loadAllMetas, loadProject, deleteProjectData, saveProject, upsertProjectMeta } from '../services/projectStore';
import { deleteAllStagedForProject } from '../services/stagedFilesStore';
import { deleteAllAssets } from '../services/assetStore';
import { deleteProjectAssetsNativeStrict } from '../services/nativeAssetStore';
import { deleteAllWaveforms } from '../services/waveformStore';
import { mediaVaultUnreference } from '../services/mediaVaultClient';
import { isTauri } from '../services/tauriFfmpeg';
import { readSyncEngineHost, onSyncEngineHostChange, type SyncEngineHost } from '../services/syncEngineHost';
import { queueProjectsForCloudSync } from '../services/bulkSyncQueue';
import type { CloudQueueDeps } from '../services/cloudQueueJob';
import { SyncQueuePanel } from './SyncQueuePanel';
import { BulkCountDialog, BulkProjectsModal } from './BulkProjectsModal';
import { BULK_COPY, createBulkProjects } from '../services/bulkContext';
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
  /**
   * Wave 3 U7.5 — App.tsx's blank-project factory. The "Bulk Projects" button
   * appears only when this and `parseProjectData` are given.
   */
  createBlankProject?: () => Project;
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
  createBlankProject,
}: Props): React.ReactElement {
  const [engineHost, setEngineHost] = useState<SyncEngineHost>(readSyncEngineHost);
  useEffect(() => onSyncEngineHostChange(setEngineHost), []);
  const [metas, setMetas] = useState<ProjectMeta[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Wave 3 U7.5 — Bulk Projects: the "how many?" step, then the rows modal.
  const [bulkAsking, setBulkAsking] = useState(false);
  const [bulkProjects, setBulkProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  /** Ids that were absent last time this process rendered the grid. */
  const enteringIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const data = loadAllMetas();
    data.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    enteringIds.current = new Set(data.filter(m => !seenProjectIds.has(m.id)).map(m => m.id));
    data.forEach(m => seenProjectIds.add(m.id));
    setMetas(data);
  }, []);

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

  const filtered = metas.filter(m => m.name.toLowerCase().includes(search.trim().toLowerCase()));
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
    // WS3 item H — native asset cleanup failures, collected across the whole
    // batch and surfaced ONCE at the end (not fire-and-forget, not silent —
    // "we just spent a round learning what swallowed filesystem errors
    // cost"). The project record is still deleted either way: a project
    // whose native cleanup failed is still gone from the grid, but its
    // bytes may remain on disk, which the user is now told rather than
    // never finding out.
    const cleanupFailures: string[] = [];
    for (const id of ids) {
      // G6 Step 6 (dead-feature-gap fix) — read the project's assets BEFORE
      // any deletion, so the media-vault reference this project holds on
      // each distinct contentHash can be dropped. Project gone means all its
      // references are gone, same as if every asset had been deleted
      // individually. Best-effort: a project record that fails to load
      // (already-corrupt/missing) simply has no known contentHashes to
      // unreference — mirrors this loop's existing non-fatal cleanup
      // posture for waveforms/staged files.
      const loaded = await loadProject(id).catch(() => null);
      const contentHashes = new Set(
        (loaded?.project.assets ?? []).map(a => a.contentHash).filter((h): h is string => !!h),
      );

      await deleteAllAssets(id);
      await deleteAllWaveforms(id);
      // WS2-50 — a deleted project's staged slots go with it. Without this the
      // rows outlive the only thing that could ever restore them.
      await deleteAllStagedForProject(id);
      try {
        await deleteProjectAssetsNativeStrict(id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        cleanupFailures.push(`${id}: ${message}`);
        console.error(`[ProjectDashboard] native asset cleanup FAILED for deleted project ${id}:`, message);
      }
      await Promise.all(Array.from(contentHashes, hash => mediaVaultUnreference(hash, id)));
      await deleteProjectData(id);
    }
    setMetas(prev => prev.filter(m => !selectedIds.has(m.id)));
    setSelectedIds(new Set());
    setShowBulkConfirm(false);
    if (cleanupFailures.length > 0) {
      onAssetCleanupFailed?.(
        `${cleanupFailures.length} deleted project${cleanupFailures.length === 1 ? '' : 's'} could not be fully ` +
          `cleaned up on disk — the project${cleanupFailures.length === 1 ? ' is' : 's are'} gone, but some ` +
          `asset bytes may remain. (${cleanupFailures.join('; ')})`,
      );
    }
  }

  return (
    <div className="kxd-root fixed inset-0 z-[200]">
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
          {createBlankProject && parseProjectData && (
            <button className="kxd-btn kxd-btn-quiet" data-testid="dashboard-bulk-projects" onClick={() => { setBulkError(null); setBulkAsking(true); }}>
              {BULK_COPY.button}
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
          {bulkProjects === null && <SyncQueuePanel />}
          {bulkError && <p className="mb-3 text-[11px] text-amber-300/80" data-testid="bulk-error">{bulkError}</p>}
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

                    {meta.thumbnailUrl ? (
                      <img src={meta.thumbnailUrl} alt="" draggable={false} />
                    ) : (
                      <div className="kxd-art-empty">
                        <ImageIcon size={26} strokeWidth={1.5} aria-hidden="true" />
                      </div>
                    )}

                    <div className="kxd-play-hint">
                      <div className="kxd-play-hint-circle">
                        <Play size={15} fill="currentColor" aria-hidden="true" />
                      </div>
                    </div>

                    {scenes > 0 && (
                      <div className="kxd-scene-badge">{scenes} scene{scenes !== 1 ? 's' : ''}</div>
                    )}
                    {isCurrent && <span className="kxd-current-badge">CURRENT</span>}
                  </div>

                  <div className="kxd-card-body">
                    <h3 className="kxd-card-title">{meta.name}</h3>
                    <div className="kxd-card-date">
                      {scenes === 0 ? '0 scenes · ' : ''}
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
                  : 'No projects yet — create your first one.'}
              </p>
            </div>
          )}
        </div>
      </main>

      {bulkAsking && createBlankProject && (
        <BulkCountDialog
          onCancel={() => setBulkAsking(false)}
          onConfirm={count => {
            setBulkAsking(false);
            void createBulkProjects(count, {
              makeBlankProject: createBlankProject,
              save: p => saveProject(p),
              upsertMeta: upsertProjectMeta,
            }).then(made => {
              // Every project is on the dashboard at once, then the rows open.
              const data = loadAllMetas();
              data.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
              data.forEach(m => seenProjectIds.add(m.id));
              setMetas(data);
              setBulkProjects(made.map(m => ({ id: m.id, name: m.name })));
            }).catch((err: unknown) => setBulkError(err instanceof Error ? err.message : String(err)));
          }}
        />
      )}
      {bulkProjects !== null && parseProjectData && (
        <BulkProjectsModal
          projects={bulkProjects}
          parseProjectData={parseProjectData}
          onOpenProject={id => { setBulkProjects(null); onSelectProject(id); }}
          onClose={() => setBulkProjects(null)}
        />
      )}

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
