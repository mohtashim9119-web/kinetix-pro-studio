/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Z } from './overlayLayers';
import type { BulkExportRunner } from '../services/bulkExportQueue';
import { FolderOpen, SlidersHorizontal } from 'lucide-react';
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
const LABEL = 'text-[10px] uppercase tracking-widest text-[var(--kx-muted)] font-bold block mb-2';
const BTN_PRIMARY = 'flex-1 border border-transparent bg-[var(--kx-accent)] text-[#1a0f06] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[var(--kx-accent-hover)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--kx-accent-line)] disabled:bg-[var(--kx-surface-2)] disabled:text-[var(--kx-faint)] disabled:border-[var(--kx-line-2)] disabled:cursor-not-allowed';

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
  const rows = useSyncExternalStore(l => runner.subscribe(l), () => runner.snapshot());
  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);
  // The count is the whole selection — what Start will run — whatever tab shows.
  const selected = catalog.filter(p => byId.get(p.id)?.selected).length;
  const batchRows = rows.filter(r => r.phase !== 'idle');
  const wsRegistry = useMemo(() => injectedWorkspaces ?? workspaceRegistry(), [injectedWorkspaces]);
  const workspaceList = useWorkspaces(wsRegistry);
  const [wsFilterRaw, setWsFilter] = useState<WorkspaceFilter>('all');
  const wsFilter = resolveWorkspaceFilter(workspaceList, wsFilterRaw);
  const shown = catalog.filter(p => inWorkspace(workspaceList, wsFilter, p.id));
  const allSelected = shown.length > 0 && shown.every(p => byId.get(p.id)?.selected);
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
          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[11px] text-[var(--kx-text)]">
              <input
                type="checkbox"
                data-testid="bulk-export-select-all"
                checked={allSelected}
                onChange={e => { selectAll(e.target.checked); }}
              />
              Select all
            </label>
            <span data-testid="bulk-export-selected-count" className={`${LABEL} mb-0`}>
              {selected} selected
            </span>
          </div>
        </div>
        <ul className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2 custom-scrollbar">
          {shown.length === 0 && (
            <li data-testid="bulk-export-empty" className="rounded-xl border border-dashed border-[var(--kx-line-2)] px-4 py-6 text-center text-[12px] leading-snug text-[var(--kx-muted)]">
              {wsFilter === 'all' ? 'No projects yet.' : 'No projects in this workspace yet.'}
            </li>
          )}
          {shown.map(p => {
            const row = byId.get(p.id);
            return (
              <li
                key={p.id}
                data-testid={`bulk-export-row-${p.id}`}
                className="kx-bulk-row rounded-xl border p-3.5 bg-[var(--kx-surface)] border-[var(--kx-line-2)]"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid={`bulk-export-check-${p.id}`}
                    checked={row?.selected === true}
                    onChange={e => { runner.setSelected(p.id, e.target.checked); }}
                  />
                  <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-[var(--kx-text)]">{p.name}</span>
                </div>
                <p data-testid={`bulk-export-status-${p.id}`} className="mt-2 text-[11px] text-[var(--kx-muted)]">
                  {row?.message ?? ''}
                </p>
                {(row?.flags ?? []).map(f => (
                  <p key={f} data-testid={`bulk-export-flag-${p.id}`} className="mt-1 text-[11px] text-[var(--kx-warning,#e6b450)]">{f}</p>
                ))}
                {row?.phase === 'failed' || row?.phase === 'paused' || row?.phase === 'waiting' ? (
                  <button
                    type="button"
                    data-testid={`bulk-export-retry-${p.id}`}
                    className="mt-2 text-[11px] font-semibold text-[var(--kx-accent-2)]"
                    onClick={() => { void runner.retry(p.id); }}
                  >
                    Retry
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="flex-shrink-0 px-6 py-4 border-t border-[var(--kx-line)] bg-[var(--kx-panel)]">
          {batchRows.length > 0 && (
            <p data-testid="bulk-export-summary" className="mb-3 text-[11px] text-[var(--kx-muted)]">
              {rows.filter(r => r.phase === 'done').length} done · {rows.filter(r => r.phase === 'failed').length} failed · {rows.filter(r => r.phase === 'blocked').length} blocked
            </p>
          )}
          <button
            type="button"
            data-testid="bulk-export-start"
            className={BTN_PRIMARY}
            disabled={selected === 0}
            onClick={() => { void runner.startSelected(); }}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
