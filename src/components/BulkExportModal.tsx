/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Z } from './overlayLayers';
import type { BulkExportPhase, BulkExportProgress, BulkExportRunner } from '../services/bulkExportQueue';
import { ArrowDownUp, Check, FolderOpen, Search, Clapperboard, ExternalLink, Play, RefreshCw, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { loadAllMetas } from '../services/projectStore';
import { ProjectCardThumb } from './ProjectCardThumb';
import { formatDuration, useProjectDurations } from './projectDurations';
import { useExportPrecheck } from './bulkExportPrecheck';
import { stepSmoothPercent } from './smoothPercent';
import { ConfirmDialog } from './ConfirmDialog';
import { WorkspaceTabs } from './WorkspaceTabs';
import { relinkPickFolder } from '../services/relinkNative';
import {
  FPS_OPTIONS, RESOLUTION_OPTIONS, shortFolder, useWorkspaceExportSettings, workspaceExportSettings,
  type WorkspaceExportSettingsStore,
} from './workspaceExportSettings';
import { inWorkspace, resolveWorkspaceFilter, useWorkspaces, workspaceRegistry, type WorkspaceFilter, type WorkspaceRegistry } from './workspaceRegistry';

/** The export-folder picker's dialog title (not the relink one). */
export const EXPORT_FOLDER_PICK_TITLE = 'Choose where exports are saved';

/** Dashboard revamp — the Bulk Export tab's pane (in flow, fills the left panel). */
const PANE = 'flex flex-1 h-full w-full min-h-0 flex-col bg-[var(--kx-bg)]';
/** Colours come from the dashboard's one grey ladder (ProjectDashboard.css maps
 *  every --kx-* onto it). Only the text rendering is set here: the dashboard
 *  root thins text (antialiased); the pane's small type needs normal weight. */
const DRAWER_PALETTE = {
  WebkitFontSmoothing: 'subpixel-antialiased',
} as React.CSSProperties;

export function BulkExportRunningNotice({ runner }: { runner: BulkExportRunner }): React.ReactElement | null {
  const notice = useSyncExternalStore(
    l => runner.subscribe(l),
    () => runner.runningNotice(),
  );
  if (!notice) return null;
  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 ${Z.banner} rounded-xl border border-[#282828] bg-[#111] px-4 py-3 text-sm text-zinc-200 shadow-2xl flex items-center gap-3`}
      data-testid="bulk-export-running-notice"
    >
      <span>{notice}</span>
      <button type="button" className="text-zinc-500 hover:text-zinc-300" onClick={() => runner.dismissNotice()} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

/**
 * The selected workspace's export defaults — resolution, frame rate, folder.
 * Under All: the defaults for projects that belong to no workspace.
 *
 * Low-focus settings: the header shows them as ONE quiet summary line; the
 * controls live in a small popover opened from it (Edit).
 */
function ExportSettingsHeader({
  scope, scopeName, store,
}: {
  scope: string;
  scopeName: string | null;
  store?: WorkspaceExportSettingsStore;
}): React.ReactElement {
  const settingsStore = store ?? workspaceExportSettings();
  const settings = useWorkspaceExportSettings(scope, settingsStore);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (picking) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, picking]);
  const chooseFolder = async (): Promise<void> => {
    setPicking(true);
    try {
      const picked = await relinkPickFolder(EXPORT_FOLDER_PICK_TITLE);
      if (picked) settingsStore.set(scope, { folder: picked });
    } finally {
      setPicking(false);
    }
  };
  const folderName = settings.folder ? settings.folder.split(/[\\/]/).filter(Boolean).pop() ?? settings.folder : null;
  const scopeLine = scopeName ? `Applies to every project in ${scopeName}` : 'Applies to projects without a workspace';
  return (
    <div className="kxd-xsum-wrap" ref={rootRef} data-testid="bulk-export-settings">
      <button
        type="button"
        className="kxd-xsum"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="bulk-export-settings-summary"
        title={`${scopeLine}${settings.folder ? ` · ${settings.folder}` : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <SlidersHorizontal size={12} aria-hidden="true" className="kxd-xsum-icon" />
        <span className="kxd-xsum-values">
          <span>{settings.resolution}</span>
          <span className="kxd-xsum-sep" aria-hidden="true">·</span>
          <span>{settings.fps} fps</span>
          <span className="kxd-xsum-sep" aria-hidden="true">·</span>
          {folderName
            ? <span className="kxd-xsum-folder">{folderName}</span>
            : <span className="kxd-xsum-missing" data-testid="bulk-export-folder-missing">No export folder</span>}
        </span>
        <span className="kxd-xsum-edit">{open ? 'Done' : 'Edit'}</span>
      </button>

      {open && (
        <div className="kxd-xpop" role="dialog" aria-label="Export settings" data-testid="bulk-export-settings-pop">
          <p className="kxd-xpop-scope">{scopeLine}</p>
          <div className="kxd-xpop-row">
            <span className="kxd-xpop-label">Resolution</span>
            <div className="kxd-seg" role="radiogroup" aria-label="Export resolution">
              {RESOLUTION_OPTIONS.map(r => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={settings.resolution === r}
                  data-testid={`bulk-export-res-${r}`}
                  className="kxd-seg-item"
                  onClick={() => settingsStore.set(scope, { resolution: r })}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="kxd-xpop-row">
            <span className="kxd-xpop-label">Frame rate</span>
            <div className="kxd-seg" role="radiogroup" aria-label="Export frame rate">
              {FPS_OPTIONS.map(f => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={settings.fps === f}
                  data-testid={`bulk-export-fps-${f}`}
                  className="kxd-seg-item"
                  onClick={() => settingsStore.set(scope, { fps: f })}
                >
                  {f} fps
                </button>
              ))}
            </div>
          </div>
          <div className="kxd-xpop-row">
            <span className="kxd-xpop-label">Folder</span>
            <button
              type="button"
              className={`kxd-folder-btn${settings.folder ? '' : ' is-empty'}`}
              data-testid="bulk-export-folder"
              title={settings.folder ?? 'Choose the folder exports are saved to'}
              disabled={picking}
              onClick={() => { void chooseFolder(); }}
            >
              <FolderOpen size={12} aria-hidden="true" className="kxd-folder-icon" />
              <span className="kxd-folder-path">{settings.folder ? shortFolder(settings.folder, 30) : 'Choose folder…'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The dashboard's selection mark (the grid's orange check). Shown only on a selected row. */
function KxCheck(): React.ReactElement {
  return (
    <span className="kxd-check kxd-xrow-pick" data-state="on" aria-hidden="true">
      <Check size={10} strokeWidth={3.5} />
    </span>
  );
}

/** Ready-tab sorting. */
type ReadySort = 'newest' | 'oldest' | 'name-az' | 'name-za' | 'longest' | 'scenes';
const READY_SORTS: readonly { id: ReadySort; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'name-az', label: 'Name A–Z' },
  { id: 'name-za', label: 'Name Z–A' },
  { id: 'longest', label: 'Longest' },
  { id: 'scenes', label: 'Most scenes' },
];
const READY_SORT_KEY = 'kinetix:bulk-export-sort:v1';
function readReadySort(): ReadySort {
  try {
    const raw = localStorage.getItem(READY_SORT_KEY);
    if (READY_SORTS.some(o => o.id === raw)) return raw as ReadySort;
  } catch { /* storage unavailable */ }
  return 'newest';
}

/** The Ready tab's search: a small icon that opens into a field; it folds back
 *  to the icon when it loses focus empty. */
function SearchBox({ value, onChange }: { value: string; onChange: (next: string) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const expanded = open || value !== '';
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  if (!expanded) {
    return (
      <button type="button" className="kxd-xicon" data-testid="bulk-export-search-open" aria-label="Search ready projects" title="Search" onClick={() => setOpen(true)}>
        <Search size={13} aria-hidden="true" />
      </button>
    );
  }
  return (
    <label className="kxd-xsearch">
      <Search size={12} aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        data-testid="bulk-export-search"
        aria-label="Search ready projects"
        placeholder="Search"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => { if (value === '') setOpen(false); }}
        onKeyDown={e => { if (e.key === 'Escape') { onChange(''); setOpen(false); } }}
      />
      {value && (
        <button type="button" className="kxd-xsearch-clear" aria-label="Clear search" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(''); inputRef.current?.focus(); }}>
          <X size={11} aria-hidden="true" />
        </button>
      )}
    </label>
  );
}

/** The Ready tab's sort: a dashboard-styled menu (not the system select). */
function SortMenu({ value, onChange }: { value: ReadySort; onChange: (next: ReadySort) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);
  const current = READY_SORTS.find(o => o.id === value) ?? READY_SORTS[0]!;
  return (
    <div className="kxd-xsort-wrap" ref={rootRef}>
      <button
        type="button"
        className="kxd-xsort"
        data-testid="bulk-export-sort"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort ready projects: ${current.label}`}
        title={`Sort: ${current.label}`}
        onClick={() => setOpen(o => !o)}
      >
        <ArrowDownUp size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="kxd-xsort-menu" role="listbox" aria-label="Sort ready projects" data-testid="bulk-export-sort-menu">
          {READY_SORTS.map(o => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              data-testid={`bulk-export-sort-${o.id}`}
              className="kxd-menu-item"
              onClick={() => { onChange(o.id); setOpen(false); }}
            >
              <span className="flex-1">{o.label}</span>
              {o.id === value && <Check size={12} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "2:14" — an elapsed clock. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** "4m 12s" — how long an export took. */
export function tookText(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

/** Remaining time once the export has reached 20%: how long it took to get
 *  there, times five, is the whole run; what is left of it counts down. Before
 *  20% there is nothing trustworthy to say (setup and warm-up skew early
 *  speed), so this returns null and the UI says "Estimating…". */
export function etaText(startedAt: number, reached20At: number | undefined, now: number): string | null {
  if (reached20At === undefined) return null;
  const total = (reached20At - startedAt) * 5;
  const left = Math.max(0, Math.round((startedAt + total - now) / 1000));
  if (left < 1) return 'finishing…';
  if (left < 60) return `${left}s left`;
  if (left < 3600) return `${Math.floor(left / 60)}m ${String(left % 60).padStart(2, '0')}s left`;
  return `${Math.floor(left / 3600)}h ${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}m left`;
}

/** An Active row: live bar; elapsed | time left and the percent; resolution,
 *  fps and a hover-only Cancel (which asks first). */
function ActiveProgress({
  id, phase, progress, onCancel,
}: {
  id: string;
  phase: BulkExportPhase | undefined;
  progress: BulkExportProgress | undefined;
  onCancel: () => void;
}): React.ReactElement {
  const [now, setNow] = useState(() => Date.now());
  // The engine reports in bursts; the shown percent glides (see smoothPercent.ts).
  const [shown, setShown] = useState(() => progress?.pct ?? 0);
  const latest = useRef(progress);
  latest.current = progress;
  useEffect(() => {
    if (phase !== 'exporting') return;
    let last = Date.now();
    const t = setInterval(() => {
      const at = Date.now();
      const p = latest.current;
      if (p) {
        const b = p.rateBase;
        const rate = b && at - b.at > 3000 && p.pct > b.pct ? (p.pct - b.pct) / ((at - b.at) / 1000) : 0;
        const dt = (at - last) / 1000; // read now: the updater below runs later
        setShown(prev => stepSmoothPercent(prev, p.pct, rate, dt));
      }
      last = at;
      setNow(at);
    }, 250);
    return () => clearInterval(t);
  }, [phase]);
  const cancel = (
    <button type="button" className="kxd-xrow-retry kxd-xrow-hovercancel" data-testid={`bulk-export-cancel-${id}`} onClick={onCancel}>
      <X size={11} aria-hidden="true" />
      Cancel
    </button>
  );
  if (phase !== 'exporting' || !progress) {
    return (
      <div className="kxd-xrow-prog" data-testid={`bulk-export-progress-${id}`}>
        <div className="kxd-xrow-prog-line">
          <span className="kxd-xrow-prog-stage" data-testid={`bulk-export-status-${id}`}>Waiting in the queue</span>
          {cancel}
        </div>
      </div>
    );
  }
  const value = progress.pct >= 100 ? 100 : shown;
  const pct = Math.floor(value);
  const starting = progress.pct <= 0;
  const elapsed = (now - progress.startedAt) / 1000;
  const eta = etaText(progress.startedAt, progress.reached20At, now);
  return (
    <div className="kxd-xrow-prog" data-testid={`bulk-export-progress-${id}`}>
      <div className="kx-bulk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={starting ? undefined : pct} aria-label="Export progress">
        <div
          className="kx-bulk-bar-fill kxd-xrow-bar-fill"
          data-kind={starting ? 'indeterminate' : 'determinate'}
          data-glow="true"
          style={{ width: `${starting ? 42 : value}%` }}
        >
          <span className="kx-bulk-bar-sheen" aria-hidden="true" />
        </div>
      </div>
      <div className="kxd-xrow-prog-line">
        <span className="kxd-xrow-prog-time" data-testid={`bulk-export-time-${id}`}>
          <span>{clock(elapsed)}</span>
          <span className="kxd-xrow-sep" aria-hidden="true">|</span>
          <span data-testid={`bulk-export-eta-${id}`}>{eta ?? 'Estimating…'}</span>
        </span>
        <span className="flex-1" />
        <span className="kxd-xrow-pct" data-testid={`bulk-export-pct-${id}`}>{starting ? '—' : `${pct}%`}</span>
      </div>
      <div className="kxd-xrow-prog-line is-meta">
        <span className="kxd-xrow-prog-file">{progress.resolution} · {progress.fps} fps</span>
        {cancel}
      </div>
    </div>
  );
}

/** Ready | Blocked | Failed | Active | Finished — Bulk Sync's sub-tabs, for exports.
 *  Ready: not started (the only tab where projects can be selected). Blocked
 *  holds what needs the operator before an export can start (blocked, waiting
 *  on a sync); Failed holds exports that ran and did not finish — failed,
 *  cancelled, interrupted (Retry); once resolved a row moves to Active, then Finished. */
type ExportTab = 'ready' | 'blocked' | 'failed' | 'active' | 'finished';
const EXPORT_TABS: readonly { id: ExportTab; label: string }[] = [
  { id: 'ready', label: 'Ready' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'failed', label: 'Failed' },
  { id: 'active', label: 'Active' },
  { id: 'finished', label: 'Finished' },
];

/** "Oct 10, 3:42 PM" — when a project last finished exporting. */
function exportedAt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const EXPORT_TAB_KEY = 'kinetix:bulk-export-tab:v1';
function exportTabOf(phase: BulkExportPhase | undefined, preBlocked = false): ExportTab {
  // An export that ran and did not finish — failed, cancelled, or interrupted
  // (paused by a reload) — is a Failed one: Retry resumes it.
  if (phase === 'failed' || phase === 'cancelled' || phase === 'paused') return 'failed';
  if (phase === 'blocked' || phase === 'waiting') return 'blocked';
  // Not started, but the pre-check found something to resolve first.
  if ((phase === undefined || phase === 'idle') && preBlocked) return 'blocked';
  if (phase === 'done') return 'finished';
  if (phase === undefined || phase === 'idle') return 'ready';
  return 'active';
}
function readExportTab(): ExportTab {
  try {
    const raw = localStorage.getItem(EXPORT_TAB_KEY);
    if (raw === 'ready' || raw === 'active' || raw === 'blocked' || raw === 'failed' || raw === 'finished') return raw;
  } catch { /* storage unavailable */ }
  return 'ready';
}

/** Status colour from the ladder's semantic set. */
function toneOf(phase: BulkExportPhase | undefined): 'bad' | 'warn' | 'live' | 'run' | 'good' | 'idle' {
  switch (phase) {
    case 'blocked': case 'failed': return 'bad';
    case 'paused': case 'waiting': case 'cancelled': return 'warn';
    case 'queued': return 'live';
    case 'exporting': return 'run';
    case 'done': return 'good';
    default: return 'idle';
  }
}

export function BulkExportModal({
  runner, hidden = false, workspaces: injectedWorkspaces, exportSettings, onOpenProject,
}: {
  runner: BulkExportRunner;
  /** Not on screen (another tab, or the editor is up). The queue runs regardless. */
  hidden?: boolean;
  /** The workspace registry (default: the app's). */
  workspaces?: WorkspaceRegistry;
  /** Per-workspace export defaults (default: the app's). */
  exportSettings?: WorkspaceExportSettingsStore;
  /** Opens a project in the editor (the row's hover / focus action). */
  onOpenProject?: (id: string) => void;
}): React.ReactElement {
  // Fresh on every open (the tab coming on screen): the catalog and every
  // Blocked row are re-read, never a snapshot from when the pane first mounted.
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    if (hidden) return;
    setOpened(n => n + 1);
    void runner.refresh();
  }, [hidden, runner]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const catalog = useMemo(() => runner.listCatalog(), [runner, opened]);
  // The dashboard's own records (thumbnail, scene count, save time), re-read
  // with the catalog; durations load from each record, cached by save time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const metaById = useMemo(() => new Map(loadAllMetas().map(m => [m.id, m])), [opened]);
  const durations = useProjectDurations(useMemo(
    () => catalog.map(p => ({ id: p.id, savedAt: metaById.get(p.id)?.savedAt })),
    [catalog, metaById],
  ));
  const rows = useSyncExternalStore(l => runner.subscribe(l), () => runner.snapshot());
  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);
  const liveProgress = useSyncExternalStore(l => runner.subscribeProgress(l), () => runner.progressSnapshot());
  // The count is what Start will run: selected Ready projects (the only
  // selectable ones), whatever tab shows.
  const isNotStarted = (id: string): boolean => { const ph = byId.get(id)?.phase; return ph === undefined || ph === 'idle'; };
  const selected = catalog.filter(p => isNotStarted(p.id) && byId.get(p.id)?.selected).length;
  const wsRegistry = useMemo(() => injectedWorkspaces ?? workspaceRegistry(), [injectedWorkspaces]);
  const workspaceList = useWorkspaces(wsRegistry);
  const [wsFilterRaw, setWsFilter] = useState<WorkspaceFilter>('all');
  const wsFilter = resolveWorkspaceFilter(workspaceList, wsFilterRaw);
  // Pre-check every not-started project (Start's own checks + unresolved
  // sync-log actions) as soon as the pane shows; blocked ones go to Blocked.
  const notStarted = useMemo(() => catalog
    .filter(p => { const ph = byId.get(p.id)?.phase; return ph === undefined || ph === 'idle'; })
    .map(p => ({ id: p.id, savedAt: metaById.get(p.id)?.savedAt, lastExportPath: metaById.get(p.id)?.lastExportPath })),
  [catalog, byId, metaById]);
  const { verdicts, checking, recheck } = useExportPrecheck(notStarted, opened);
  /** Retry = re-check first; only a project that is now clear goes back to the queue. */
  const retryChecked = (ids: readonly string[]): void => {
    void recheck(ids).then(fresh => {
      for (const id of ids) if (!fresh.get(id)) void runner.retry(id);
    });
  };
  /** Export skips anything the pre-check holds in Blocked. */
  const startExport = (): void => {
    for (const p of catalog) if (verdicts.has(p.id) && byId.get(p.id)?.selected) runner.setSelected(p.id, false);
    // Follow the work: whatever Start queued is on the Active tab.
    void runner.startSelected().then(() => {
      if (runner.isActive()) setTab('active');
    });
  };
  // A changed export folder / setting can clear a "no export path" block: re-check.
  const settingsStore = exportSettings ?? workspaceExportSettings();
  const settingsVersion = useSyncExternalStore(l => settingsStore.subscribe(l), () => settingsStore.getVersion());
  useEffect(() => { if (settingsVersion > 0) void runner.refresh(); }, [settingsVersion, runner]);
  // Cancelling an export is destructive: always asked first (one row or all).
  const [confirmCancel, setConfirmCancel] = useState<{ ids: string[]; name?: string; running: boolean } | null>(null);
  const [tab, setTabRaw] = useState<ExportTab>(readExportTab);
  const setTab = (next: ExportTab): void => {
    try { localStorage.setItem(EXPORT_TAB_KEY, next); } catch { /* this session only */ }
    setTabRaw(next);
  };
  const inScope = catalog.filter(p => inWorkspace(workspaceList, wsFilter, p.id));
  const tabCounts: Record<ExportTab, number> = { ready: 0, blocked: 0, failed: 0, active: 0, finished: 0 };
  const tabOf = (id: string): ExportTab => exportTabOf(byId.get(id)?.phase, verdicts.has(id));
  for (const p of inScope) tabCounts[tabOf(p.id)] += 1;
  // Ready only: search by name, and sort.
  const [query, setQuery] = useState('');
  const [sort, setSortRaw] = useState<ReadySort>(readReadySort);
  const setSort = (next: ReadySort): void => {
    try { localStorage.setItem(READY_SORT_KEY, next); } catch { /* this session only */ }
    setSortRaw(next);
  };
  const q = query.trim().toLowerCase();
  const readyOrder = (a: { id: string; name: string }, b: { id: string; name: string }): number => {
    switch (sort) {
      case 'oldest': return (metaById.get(a.id)?.savedAt ?? 0) - (metaById.get(b.id)?.savedAt ?? 0);
      case 'name-az': return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'name-za': return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'longest': return (durations.get(b.id) ?? 0) - (durations.get(a.id) ?? 0);
      case 'scenes': return (metaById.get(b.id)?.segmentCount ?? 0) - (metaById.get(a.id)?.segmentCount ?? 0);
      default: return (metaById.get(b.id)?.savedAt ?? 0) - (metaById.get(a.id)?.savedAt ?? 0);
    }
  };
  const tabRows = inScope.filter(p => tabOf(p.id) === tab);
  const shown = tab === 'ready'
    ? tabRows.filter(p => !q || p.name.toLowerCase().includes(q)).sort(readyOrder)
    : tabRows;
  const allSelected = shown.length > 0 && shown.every(p => byId.get(p.id)?.selected);
  // Select all selects exactly the rows this workspace + tab shows.
  const selectAll = (on: boolean): void => {
    for (const p of shown) runner.setSelected(p.id, on);
  };
  return (
    <div
      className={PANE}
      style={DRAWER_PALETTE}
      data-testid="bulk-export-modal"
      data-hidden={hidden ? 'true' : 'false'}
      aria-hidden={hidden}
    >
      <div role="region" aria-label="Bulk Export" className="flex flex-col h-full min-h-0">
        <div className="px-5 pt-4 pb-4 flex-shrink-0 border-b border-[var(--kx-line)] bg-[var(--kx-panel)]">
          <WorkspaceTabs
            workspaces={workspaceList}
            value={wsFilter}
            onChange={setWsFilter}
            testIdPrefix="bulk-export-ws"
            label="Bulk Export workspaces"
          />
          {/* Row 2 mirrors Bulk Sync's (field + orange action): settings + Export. */}
          <div className="kxd-xrow2">
            <ExportSettingsHeader
              scope={wsFilter}
              scopeName={wsFilter === 'all' ? null : workspaceList.find(w => w.id === wsFilter)?.name ?? null}
              store={exportSettings}
            />
            <button
              type="button"
              data-testid="bulk-export-start"
              className="kxd-xctl-btn kxd-xctl-primary kxd-xstart"
              disabled={selected === 0}
              title={selected === 0 ? 'Select projects to export' : `Export ${selected} selected project${selected === 1 ? '' : 's'}`}
              onClick={startExport}
            >
              <Play size={10} fill="currentColor" aria-hidden="true" />
              {selected > 0 ? `Export ${selected}` : 'Export'}
            </button>
          </div>
          {/* Row 3: Active | Blocked | Finished — Bulk Sync's sub-tabs. */}
          <div role="tablist" aria-label="Export rows" data-testid="bulk-export-tabs" className="kxd-subtabs mt-4">
            {EXPORT_TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                data-testid={`bulk-export-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className="kxd-subtab"
              >
                <span className="kxd-subtab-label">{t.label}</span>
                <span className="kxd-subtab-count" data-testid={`bulk-export-tab-count-${t.id}`}>{tabCounts[t.id]}</span>
              </button>
            ))}
          </div>
        </div>
        {/* One action per tab, no status clutter (the tabs carry the counts):
            Ready selects, Active cancels, Finished clears; Blocked and Failed have none. */}
        {tab !== 'blocked' && tab !== 'failed' && (tab === 'ready' ? tabRows.length > 0 : shown.length > 0) && (
          <div className="kxd-xctl">
            {tab === 'ready' && (
              <>
                <button
                  type="button"
                  data-testid="bulk-export-select-all"
                  className="kxd-selall"
                  data-active={allSelected}
                  onClick={() => selectAll(!allSelected)}
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
                {selected > 0 && (
                  <span data-testid="bulk-export-selected-count" className="kxd-xctl-count">
                    {selected} selected
                  </span>
                )}
                <span className="flex-1" />
                {checking && <span className="kxd-xctl-checking" data-testid="bulk-export-checking">Checking…</span>}
                <SearchBox value={query} onChange={setQuery} />
                <SortMenu value={sort} onChange={setSort} />
              </>
            )}
            {tab === 'active' && (
              <>
                <span className="flex-1" />
                <button
                  type="button"
                  data-testid="bulk-export-cancel-all"
                  className="kxd-xctl-btn"
                  title="Cancel every queued export shown here and stop the one running"
                  onClick={() => setConfirmCancel({ ids: shown.map(p => p.id), running: shown.some(p => byId.get(p.id)?.phase === 'exporting') })}
                >
                  Cancel all
                </button>
              </>
            )}
            {tab === 'finished' && (
              <>
                <span className="flex-1" />
                <button
                  type="button"
                  data-testid="bulk-export-clear-all"
                  className="kxd-xctl-btn"
                  title="Clear the finished exports shown here — the files stay on disk"
                  onClick={() => runner.clearFinished(shown.map(p => p.id))}
                >
                  Clear all
                </button>
              </>
            )}
          </div>
        )}
        <ul className="flex-1 min-h-0 overflow-y-auto px-5 pt-1 pb-3 space-y-2 custom-scrollbar">
          {shown.length === 0 && (
            <li data-testid="bulk-export-empty" className="rounded-xl border border-dashed border-[var(--kx-line-2)] px-4 py-6 text-center text-[12px] leading-snug text-[var(--kx-muted)]">
              {tab === 'blocked' ? 'Nothing blocked.'
                : tab === 'failed' ? 'No failed exports.'
                : tab === 'finished' ? 'Nothing exported yet.'
                : tab === 'active' ? 'Nothing exporting right now.'
                : q ? `No projects match “${query.trim()}”.`
                : wsFilter === 'all' ? 'No projects yet.' : 'No projects in this workspace yet.'}
            </li>
          )}
          {shown.map(p => {
            const row = byId.get(p.id);
            const meta = metaById.get(p.id);
            const selectedRow = row?.selected === true;
            const sec = durations.get(p.id);
            const scenes = meta?.segmentCount ?? 0;
            const preReason = (row?.phase === undefined || row?.phase === 'idle') ? verdicts.get(p.id) : undefined;
            const message = row?.message ?? preReason;
            // Retry only where it is the way forward (a failed / stopped / waiting
            // export); a Blocked row clears itself once the cause is fixed.
            const canRetry = row?.phase === 'failed' || row?.phase === 'paused' || row?.phase === 'waiting' || row?.phase === 'cancelled';
            const pickable = tab === 'ready';
            const statusTone = preReason ? 'bad' : toneOf(row?.phase);
            const body = (
              <>
                {pickable && selectedRow && <KxCheck />}
                <span className="kxd-xrow-thumb" aria-hidden="true">
                  {meta ? <ProjectCardThumb meta={meta} /> : <span className="kxd-art-empty"><Clapperboard size={14} strokeWidth={1.5} /></span>}
                </span>
                <span className="kxd-xrow-body">
                  <span className="kxd-xrow-name" title={p.name}>{p.name}</span>
                  <span className="kxd-xrow-meta">
                    <span>{sec !== undefined ? formatDuration(sec) : '—'}</span>
                    <span className="kxd-xrow-sep" aria-hidden="true">·</span>
                    <span>{scenes === 1 ? '1 scene' : `${scenes} scenes`}</span>
                  </span>
                  {tab === 'finished' && row?.finishedAt !== undefined && (
                    <span className="kxd-xrow-when" data-testid={`bulk-export-when-${p.id}`}>Exported {exportedAt(row.finishedAt)}{row.exportMs !== undefined ? ` · took ${tookText(row.exportMs / 1000)}` : ''}</span>
                  )}
                </span>
              </>
            );
            return (
              <li
                key={p.id}
                data-testid={`bulk-export-row-${p.id}`}
                data-phase={row?.phase ?? 'idle'}
                className={`kx-bulk-row kxd-xrow${pickable ? ' is-pickable' : ''}${pickable && selectedRow ? ' is-selected' : ''}`}
                onClick={pickable ? () => runner.setSelected(p.id, !selectedRow) : undefined}
              >
                <div className="kxd-xrow-top">
                  {pickable ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={selectedRow}
                      aria-label={`Select ${p.name}`}
                      className="kxd-xrow-main"
                      data-testid={`bulk-export-check-${p.id}`}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="kxd-xrow-main is-static">{body}</div>
                  )}
                  <div className="kxd-xrow-actions">
                    {/* Ready: Open on hover. Blocked / Failed: Open, always there. */}
                    {onOpenProject && (tab === 'ready' || tab === 'blocked' || tab === 'failed') && (
                      <button
                        type="button"
                        className={`kxd-xrow-open${tab === 'blocked' || tab === 'failed' ? ' is-always' : ''}`}
                        data-testid={`bulk-export-open-${p.id}`}
                        aria-label={`Open ${p.name}`}
                        title="Open project"
                        onClick={e => { e.stopPropagation(); onOpenProject(p.id); }}
                      >
                        <ExternalLink size={13} aria-hidden="true" />
                      </button>
                    )}
                    {tab === 'finished' && (
                      <button
                        type="button"
                        className="kxd-xrow-open"
                        data-testid={`bulk-export-clear-${p.id}`}
                        aria-label={`Clear ${p.name}`}
                        title="Clear"
                        onClick={() => runner.clearFinished([p.id])}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    )}
                    <span
                      className="kxd-xrow-dot"
                      data-testid={`bulk-export-dot-${p.id}`}
                      data-tone={statusTone}
                      aria-hidden="true"
                    />
                  </div>
                </div>
                {tab === 'active' && (
                  <ActiveProgress id={p.id} phase={row?.phase} progress={liveProgress.get(p.id)} onCancel={() => setConfirmCancel({ ids: [p.id], name: p.name, running: row?.phase === 'exporting' })} />
                )}
                {tab !== 'ready' && tab !== 'finished' && tab !== 'active' && (message || canRetry) && (
                  <div className="kxd-xrow-status" data-tone={statusTone}>
                    <span data-testid={`bulk-export-status-${p.id}`} className="kxd-xrow-msg" title={message ?? ''}>
                      {message ?? ''}
                    </span>
                    {canRetry && (
                      <button
                        type="button"
                        data-testid={`bulk-export-retry-${p.id}`}
                        className="kxd-xrow-retry"
                        onClick={() => retryChecked([p.id])}
                      >
                        <RefreshCw size={11} aria-hidden="true" />
                        Retry
                      </button>
                    )}
                  </div>
                )}
                {(row?.flags ?? []).map(f => (
                  <p key={f} data-testid={`bulk-export-flag-${p.id}`} className="kxd-xrow-flag">{f}</p>
                ))}
              </li>
            );
          })}
        </ul>
      </div>
      {confirmCancel && (
        <ConfirmDialog
          title={confirmCancel.ids.length === 1 ? 'Cancel this export?' : `Cancel ${confirmCancel.ids.length} exports?`}
          body={
            confirmCancel.ids.length === 1
              ? (confirmCancel.running
                ? `The export of “${confirmCancel.name}” stops right now and no video file is finished. It goes to Failed; Retry starts it again (it resumes from a saved checkpoint where there is one, otherwise from the start).`
                : `“${confirmCancel.name}” is taken out of the queue and goes back to Ready.`)
              : `Every export in this list is cancelled. Queued ones go back to Ready${confirmCancel.running ? '; the running one stops immediately, no video file is finished, and it goes to Failed (Retry resumes from a saved checkpoint where there is one, otherwise from the start)' : ''}.`
          }
          confirmLabel={confirmCancel.ids.length === 1 ? 'Cancel export' : 'Cancel all exports'}
          cancelLabel="Keep exporting"
          onCancel={() => setConfirmCancel(null)}
          onConfirm={() => { const ids = confirmCancel.ids; setConfirmCancel(null); for (const id of ids) runner.cancel(id); }}
        />
      )}
    </div>
  );
}
