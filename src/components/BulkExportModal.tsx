/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Z } from './overlayLayers';
import type { BulkExportPhase, BulkExportRunner } from '../services/bulkExportQueue';
import { Check, FolderOpen, Image as ImageIcon, Minus, Play, RefreshCw, SlidersHorizontal, Square, X } from 'lucide-react';
import { loadAllMetas } from '../services/projectStore';
import { ProjectCardThumb } from './ProjectCardThumb';
import { formatDuration, useProjectDurations } from './projectDurations';
import { useExportPrecheck } from './bulkExportPrecheck';
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

/** The dashboard's selection mark (the grid's orange check), as a checkbox. */
function KxCheck({ state }: { state: boolean | 'mixed' }): React.ReactElement {
  return (
    <span className="kxd-check" data-state={state === 'mixed' ? 'mixed' : state ? 'on' : 'off'} aria-hidden="true">
      {state === 'mixed' ? <Minus size={10} strokeWidth={3.5} /> : <Check size={10} strokeWidth={3.5} />}
    </span>
  );
}

/** Ready | Active | Blocked | Finished — Bulk Sync's sub-tabs, for exports.
 *  Ready: not started. Blocked holds what needs the operator (blocked, failed,
 *  paused); once resolved and retried a row moves to Active, then Finished. */
type ExportTab = 'ready' | 'active' | 'blocked' | 'finished';
const EXPORT_TABS: readonly { id: ExportTab; label: string }[] = [
  { id: 'ready', label: 'Ready' },
  { id: 'active', label: 'Active' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'finished', label: 'Finished' },
];
const EXPORT_TAB_KEY = 'kinetix:bulk-export-tab:v1';
function exportTabOf(phase: BulkExportPhase | undefined, preBlocked = false): ExportTab {
  if (phase === 'blocked' || phase === 'failed' || phase === 'paused' || phase === 'cancelled') return 'blocked';
  // Not started, but the pre-check found something to resolve first.
  if ((phase === undefined || phase === 'idle') && preBlocked) return 'blocked';
  if (phase === 'done') return 'finished';
  if (phase === undefined || phase === 'idle') return 'ready';
  return 'active';
}
function readExportTab(): ExportTab {
  try {
    const raw = localStorage.getItem(EXPORT_TAB_KEY);
    if (raw === 'ready' || raw === 'active' || raw === 'blocked' || raw === 'finished') return raw;
  } catch { /* storage unavailable */ }
  return 'ready';
}

/** Status colour from the ladder's semantic set. */
function toneOf(phase: BulkExportPhase | undefined): 'bad' | 'warn' | 'live' | 'good' | 'idle' {
  switch (phase) {
    case 'blocked': case 'failed': return 'bad';
    case 'paused': case 'waiting': case 'cancelled': return 'warn';
    case 'queued': case 'exporting': return 'live';
    case 'done': return 'good';
    default: return 'idle';
  }
}

export function BulkExportModal({
  runner, hidden = false, workspaces: injectedWorkspaces, exportSettings,
}: {
  runner: BulkExportRunner;
  /** Not on screen (another tab, or the editor is up). The queue runs regardless. */
  hidden?: boolean;
  /** The workspace registry (default: the app's). */
  workspaces?: WorkspaceRegistry;
  /** Per-workspace export defaults (default: the app's). */
  exportSettings?: WorkspaceExportSettingsStore;
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
  // The count is the whole selection — what Start will run — whatever tab shows.
  const selected = catalog.filter(p => byId.get(p.id)?.selected).length;
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
    void runner.startSelected();
  };
  const [tab, setTabRaw] = useState<ExportTab>(readExportTab);
  const setTab = (next: ExportTab): void => {
    try { localStorage.setItem(EXPORT_TAB_KEY, next); } catch { /* this session only */ }
    setTabRaw(next);
  };
  const inScope = catalog.filter(p => inWorkspace(workspaceList, wsFilter, p.id));
  const tabCounts: Record<ExportTab, number> = { ready: 0, active: 0, blocked: 0, finished: 0 };
  const tabOf = (id: string): ExportTab => exportTabOf(byId.get(id)?.phase, verdicts.has(id));
  for (const p of inScope) tabCounts[tabOf(p.id)] += 1;
  const shown = inScope.filter(p => tabOf(p.id) === tab);
  // done / failed / blocked across this workspace's rows (blocked includes the pre-check's).
  const doneCount = inScope.filter(p => byId.get(p.id)?.phase === 'done').length;
  const failedCount = inScope.filter(p => byId.get(p.id)?.phase === 'failed').length;
  const blockedCount = inScope.filter(p => byId.get(p.id)?.phase === 'blocked' || (byId.get(p.id)?.phase ?? 'idle') === 'idle' && verdicts.has(p.id)).length;
  const allSelected = shown.length > 0 && shown.every(p => byId.get(p.id)?.selected);
  const someShownSelected = shown.some(p => byId.get(p.id)?.selected);
  // Retry all (Blocked tab): every row there — re-checked against fresh
  // records, so a resolved one moves to Active, then Finished.
  const retryableIds = tab === 'blocked' ? shown.map(p => p.id) : [];
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
        {/* List toolbar: selection on the left; Retry all on Blocked. */}
        <div className="kxd-xctl">
          <button
            type="button"
            role="checkbox"
            aria-checked={someShownSelected && !allSelected ? 'mixed' : allSelected}
            data-testid="bulk-export-select-all"
            className="kxd-xctl-select"
            disabled={shown.length === 0}
            onClick={() => selectAll(!allSelected)}
          >
            <KxCheck state={someShownSelected && !allSelected ? 'mixed' : allSelected} />
            <span>Select all</span>
          </button>
          <span data-testid="bulk-export-selected-count" className="kxd-xctl-count">
            {selected} selected
          </span>
          <span className="flex-1" />
          {doneCount + failedCount + blockedCount > 0 && (
            <span data-testid="bulk-export-counts" className="kxd-xctl-count">
              {doneCount} done · {failedCount} failed · {blockedCount} blocked
            </span>
          )}
          {checking && <span className="kxd-xctl-checking" data-testid="bulk-export-checking">Checking projects…</span>}
          {rows.some(r => r.phase === 'queued' || r.phase === 'exporting') && (
            <button
              type="button"
              data-testid="bulk-export-stop-all"
              className="kxd-xctl-btn"
              title="Cancel every queued export and stop the one running"
              onClick={() => runner.stopAll()}
            >
              <Square size={10} fill="currentColor" aria-hidden="true" />
              Stop all
            </button>
          )}
          {retryableIds.length > 0 && (
            <button
              type="button"
              data-testid="bulk-export-retry-all"
              className="kxd-xctl-btn"
              title="Re-check and retry every blocked export shown here — resolved ones move to Active"
              onClick={() => retryChecked(retryableIds)}
            >
              <RefreshCw size={11} aria-hidden="true" />
              {`Retry all (${retryableIds.length})`}
            </button>
          )}
        </div>
        <ul className="flex-1 min-h-0 overflow-y-auto px-5 pt-1 pb-3 space-y-2 custom-scrollbar">
          {shown.length === 0 && (
            <li data-testid="bulk-export-empty" className="rounded-xl border border-dashed border-[var(--kx-line-2)] px-4 py-6 text-center text-[12px] leading-snug text-[var(--kx-muted)]">
              {tab === 'blocked' ? 'Nothing blocked.'
                : tab === 'finished' ? 'Nothing exported yet.'
                : tab === 'active' ? 'Nothing exporting right now.'
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
            const canRetry = row?.phase === 'failed' || row?.phase === 'paused' || row?.phase === 'waiting'
              || row?.phase === 'blocked' || row?.phase === 'cancelled' || preReason !== undefined;
            const canCancel = row?.phase === 'queued' || row?.phase === 'exporting';
            return (
              <li
                key={p.id}
                data-testid={`bulk-export-row-${p.id}`}
                data-phase={row?.phase ?? 'idle'}
                className={`kx-bulk-row kxd-xrow${selectedRow ? ' is-selected' : ''}`}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selectedRow}
                  aria-label={`Select ${p.name}`}
                  className="kxd-xrow-main"
                  data-testid={`bulk-export-check-${p.id}`}
                  onClick={() => { runner.setSelected(p.id, !selectedRow); }}
                >
                  <KxCheck state={selectedRow} />
                  <span className="kxd-xrow-thumb" aria-hidden="true">
                    {meta ? <ProjectCardThumb meta={meta} /> : <span className="kxd-art-empty"><ImageIcon size={14} strokeWidth={1.5} /></span>}
                  </span>
                  <span className="kxd-xrow-body">
                    <span className="kxd-xrow-name" title={p.name}>{p.name}</span>
                    <span className="kxd-xrow-meta">
                      <span>{sec !== undefined ? formatDuration(sec) : '—'}</span>
                      <span className="kxd-xrow-sep" aria-hidden="true">·</span>
                      <span>{scenes === 1 ? '1 scene' : `${scenes} scenes`}</span>
                    </span>
                  </span>
                </button>
                {(message || canRetry || canCancel) && (
                  <div className="kxd-xrow-status" data-tone={preReason ? 'bad' : toneOf(row?.phase)}>
                    <span className="kxd-xrow-dot" aria-hidden="true" />
                    <span data-testid={`bulk-export-status-${p.id}`} className="kxd-xrow-msg" title={message ?? ''}>
                      {message ?? ''}
                    </span>
                    {canCancel && (
                      <button
                        type="button"
                        data-testid={`bulk-export-cancel-${p.id}`}
                        className="kxd-xrow-retry"
                        onClick={() => runner.cancel(p.id)}
                      >
                        <X size={11} aria-hidden="true" />
                        Cancel
                      </button>
                    )}
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
    </div>
  );
}
