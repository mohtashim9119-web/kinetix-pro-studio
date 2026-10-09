/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { Z } from './overlayLayers';
import type { BulkExportRunner } from '../services/bulkExportQueue';

const DRAWER = `fixed top-0 left-0 ${Z.drawer} flex h-full w-[min(100vw,480px)] flex-col border-r border-[var(--kx-line-2)] bg-[var(--kx-bg)] will-change-transform`;
const DRAWER_MOTION: React.CSSProperties = { transition: 'transform 340ms cubic-bezier(.22, 1, .36, 1)' };
const DRAWER_PALETTE = {
  '--kx-bg': '#0a0a0b',
  '--kx-panel': '#111113',
  '--kx-surface': '#19191c',
  '--kx-surface-2': '#1e1e21',
  '--kx-hover': '#242428',
  '--kx-line': 'rgba(255,255,255,.07)',
  '--kx-line-2': 'rgba(255,255,255,.12)',
} as React.CSSProperties;
const DRAWER_FLOAT = 'shadow-[8px_0_40px_rgba(0,0,0,.55)]';
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

export function BulkExportModal({
  runner, hidden = false, docked = false, onClose,
}: {
  runner: BulkExportRunner;
  hidden?: boolean;
  docked?: boolean;
  onClose: () => void;
}): React.ReactElement {
  const catalog = useMemo(() => runner.listCatalog(), [runner]);
  const rows = useSyncExternalStore(l => runner.subscribe(l), () => runner.snapshot());
  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);
  const selected = catalog.filter(p => byId.get(p.id)?.selected).length;
  const batchRows = rows.filter(r => r.phase !== 'idle');
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setEntered(true)); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, []);
  const off = hidden || !entered;
  const allSelected = catalog.length > 0 && catalog.every(p => byId.get(p.id)?.selected);
  return (
    <div
      className={`${DRAWER} ${docked ? '' : DRAWER_FLOAT} ${off ? '-translate-x-full pointer-events-none' : ''}`}
      style={{ ...DRAWER_PALETTE, ...DRAWER_MOTION }}
      data-testid="bulk-export-modal"
      data-hidden={hidden ? 'true' : 'false'}
      aria-hidden={hidden}
    >
      <div role="dialog" aria-modal="false" aria-label="Bulk Export" className="flex flex-col h-full min-h-0">
        <div className="px-6 pt-6 pb-5 flex-shrink-0 border-b border-[var(--kx-line)] bg-[var(--kx-panel)]">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2.5 text-sm font-black uppercase tracking-[0.2em] text-[var(--kx-text)]">
              <span aria-hidden="true" className="h-4 w-1 rounded-full bg-[var(--kx-accent)]" />
              Bulk Export
            </h2>
            <button
              type="button"
              aria-label="Close"
              data-testid="bulk-export-close"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--kx-muted)] hover:text-white hover:bg-[var(--kx-hover)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--kx-accent-line)]"
            >
              <X size={16} />
            </button>
          </div>
          <div className="mt-5 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[12px] text-[var(--kx-text)]">
              <input
                type="checkbox"
                data-testid="bulk-export-select-all"
                checked={allSelected}
                onChange={e => { runner.setSelectedAll(e.target.checked); }}
              />
              Select all
            </label>
            <span data-testid="bulk-export-selected-count" className={`${LABEL} mb-0`}>
              {selected} selected
            </span>
          </div>
        </div>
        <ul className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2 custom-scrollbar">
          {catalog.map(p => {
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
                {row?.phase === 'failed' || row?.phase === 'paused' ? (
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
