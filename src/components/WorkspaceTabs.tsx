/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dashboard revamp — the horizontal workspace strip (All + each workspace)
// shared by the Bulk Sync tab, the Bulk Export tab and the project grid.
// Each surface keeps its own selection; the strip only filters what shows.

import React from 'react';
import type { Workspace, WorkspaceFilter } from './workspaceRegistry';

export function WorkspaceTabs({
  workspaces, value, onChange, testIdPrefix, label = 'Workspaces', variant = 'compact', counts,
}: {
  workspaces: readonly Workspace[];
  value: WorkspaceFilter;
  onChange: (next: WorkspaceFilter) => void;
  /** e.g. "bulk-sync-ws" → `bulk-sync-ws-all`, `bulk-sync-ws-<id>`. */
  testIdPrefix: string;
  label?: string;
  /** `prominent`: the project grid's primary navigation (larger, with counts). */
  variant?: 'compact' | 'prominent';
  /** Count badge per tab id (`all` + each workspace id). */
  counts?: Readonly<Record<string, number>>;
}): React.ReactElement {
  const prominent = variant === 'prominent';
  const tabs: { id: WorkspaceFilter; name: string }[] = [
    { id: 'all', name: 'All' },
    ...workspaces.map(w => ({ id: w.id, name: w.name })),
  ];
  return (
    <div
      role="tablist"
      aria-label={label}
      data-testid={`${testIdPrefix}-tabs`}
      className={prominent ? 'flex gap-2 overflow-x-auto custom-scrollbar pb-1' : 'flex gap-1 overflow-x-auto custom-scrollbar pb-1'}
    >
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          data-testid={`${testIdPrefix}-${t.id}`}
          title={t.name}
          onClick={() => onChange(t.id)}
          className={prominent
            ? `flex-shrink-0 max-w-[240px] inline-flex items-center gap-2 h-9 pl-4 pr-2 rounded-[10px] border text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kx-accent-line)] ${
              value === t.id
                ? 'border-[var(--kx-accent-line)] bg-[var(--kx-accent-soft)] text-[var(--kx-accent-2)] shadow-[0_0_0_1px_rgba(255,138,60,.18),0_8px_20px_-10px_rgba(255,138,60,.45)]'
                : 'border-[var(--kx-line-2)] bg-[rgba(255,255,255,.02)] text-[var(--kx-muted)] hover:text-[var(--kx-text)] hover:bg-[rgba(255,255,255,.05)] hover:border-[rgba(255,255,255,.22)]'
            }`
            : `flex-shrink-0 max-w-[180px] truncate h-7 px-3 rounded-full border text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kx-accent-line)] ${
              value === t.id
                ? 'border-[var(--kx-accent-line)] bg-[var(--kx-accent-soft)] text-[var(--kx-accent-2)]'
                : 'border-[var(--kx-line-2)] text-[var(--kx-muted)] hover:text-[var(--kx-text)] hover:border-[rgba(255,255,255,.22)]'
            }`}
        >
          {prominent ? <span className="truncate">{t.name}</span> : t.name}
          {prominent && counts && (
            <span
              data-testid={`${testIdPrefix}-count-${t.id}`}
              className={`flex-shrink-0 min-w-[22px] h-[20px] px-1.5 inline-flex items-center justify-center rounded-md font-mono text-[11px] tabular-nums ${
                value === t.id ? 'bg-[rgba(255,138,60,.2)] text-[var(--kx-accent-2)]' : 'bg-[rgba(255,255,255,.06)] text-[var(--kx-faint)]'
              }`}
            >
              {counts[t.id] ?? 0}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
