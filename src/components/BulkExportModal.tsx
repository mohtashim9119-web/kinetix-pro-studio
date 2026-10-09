/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Z } from './overlayLayers';
import type { BulkExportPhase, BulkExportRunner } from '../services/bulkExportQueue';
import { Check, FolderOpen, Image as ImageIcon, Minus, Play, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { loadAllMetas } from '../services/projectStore';
import { ProjectCardThumb } from './ProjectCardThumb';
import { formatDuration, useProjectDurations } from './projectDurations';
import { WorkspaceTabs } from './WorkspaceTabs';
import { relinkPickFolder } from '../services/relinkNative';
import {
  FPS_OPTIONS, RESOLUTION_OPTIONS, shortFolder, useWorkspaceExportSettings, workspaceExportSettings,
  type WorkspaceExportSettingsStore,
} from './workspaceExportSettings';
import { inWorkspace, resolveWorkspaceFilter, useWorkspaces, workspaceRegistry, type WorkspaceFilter, type WorkspaceRegistry } from './workspaceRegistry';

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
      const picked = await relinkPickFolder();
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

/** Status colour from the ladder's semantic set. */
function toneOf(phase: BulkExportPhase | undefined): 'bad' | 'warn' | 'live' | 'good' | 'idle' {
  switch (phase) {
    case 'blocked': case 'failed': return 'bad';
    case 'paused': case 'waiting': return 'warn';
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
  const shown = catalog.filter(p => inWorkspace(workspaceList, wsFilter, p.id));
  const allSelected = shown.length > 0 && shown.every(p => byId.get(p.id)?.selected);
  const someShownSelected = shown.some(p => byId.get(p.id)?.selected);
  const retryableIds = shown
    .filter(p => { const ph = byId.get(p.id)?.phase; return ph === 'failed' || ph === 'paused' || ph === 'waiting'; })
    .map(p => p.id);
  // All: the runner's own select-all. A workspace: only the rows it shows.
  const selectAll = (on: boolean): void => {
    if (wsFilter === 'all') runner.setSelectedAll(on);
    else for (const p of shown) runner.setSelected(p.id, on);
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
          <ExportSettingsHeader
            scope={wsFilter}
            scopeName={wsFilter === 'all' ? null : workspaceList.find(w => w.id === wsFilter)?.name ?? null}
            store={exportSettings}
          />
          {/* Controls: selection on the left, the export actions on the right. */}
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
            {retryableIds.length > 0 && (
              <button
                type="button"
                data-testid="bulk-export-retry-all"
                className="kxd-xctl-btn"
                title="Retry every failed, paused or waiting export shown here"
                onClick={() => { for (const id of retryableIds) void runner.retry(id); }}
              >
                <RefreshCw size={11} aria-hidden="true" />
                {`Retry ${retryableIds.length}`}
              </button>
            )}
            <button
              type="button"
              data-testid="bulk-export-start"
              className="kxd-xctl-btn kxd-xctl-primary"
              disabled={selected === 0}
              title={selected === 0 ? 'Select projects to export' : `Export ${selected} selected project${selected === 1 ? '' : 's'}`}
              onClick={() => { void runner.startSelected(); }}
            >
              <Play size={10} fill="currentColor" aria-hidden="true" />
              {selected > 0 ? `Export ${selected}` : 'Export'}
            </button>
          </div>
        </div>
        <ul className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-2 custom-scrollbar">
          {shown.length === 0 && (
            <li data-testid="bulk-export-empty" className="rounded-xl border border-dashed border-[var(--kx-line-2)] px-4 py-6 text-center text-[12px] leading-snug text-[var(--kx-muted)]">
              {wsFilter === 'all' ? 'No projects yet.' : 'No projects in this workspace yet.'}
            </li>
          )}
          {shown.map(p => {
            const row = byId.get(p.id);
            const meta = metaById.get(p.id);
            const selectedRow = row?.selected === true;
            const sec = durations.get(p.id);
            const scenes = meta?.segmentCount ?? 0;
            const canRetry = row?.phase === 'failed' || row?.phase === 'paused' || row?.phase === 'waiting';
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
                {(row?.message || canRetry) && (
                  <div className="kxd-xrow-status" data-tone={toneOf(row?.phase)}>
                    <span className="kxd-xrow-dot" aria-hidden="true" />
                    <span data-testid={`bulk-export-status-${p.id}`} className="kxd-xrow-msg" title={row?.message ?? ''}>
                      {row?.message ?? ''}
                    </span>
                    {canRetry && (
                      <button
                        type="button"
                        data-testid={`bulk-export-retry-${p.id}`}
                        className="kxd-xrow-retry"
                        onClick={() => { void runner.retry(p.id); }}
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
