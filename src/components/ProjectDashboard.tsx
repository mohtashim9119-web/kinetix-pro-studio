import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Plus, Trash2, Search, Check, Loader2, Settings, ChevronDown, Play, Image as ImageIcon } from 'lucide-react';
import type { ProjectMeta } from '../types';
import { loadAllMetas, deleteProjectData } from '../services/projectStore';
import { deleteAllAssets } from '../services/assetStore';
import { deleteAllWaveforms } from '../services/waveformStore';
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
}: Props): React.ReactElement {
  const [metas, setMetas] = useState<ProjectMeta[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
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
    for (const id of ids) {
      await deleteAllAssets(id);
      await deleteAllWaveforms(id);
      await deleteProjectData(id);
    }
    setMetas(prev => prev.filter(m => !selectedIds.has(m.id)));
    setSelectedIds(new Set());
    setShowBulkConfirm(false);
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
