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
  workspaces, value, onChange, testIdPrefix, label = 'Workspaces',
}: {
  workspaces: readonly Workspace[];
  value: WorkspaceFilter;
  onChange: (next: WorkspaceFilter) => void;
  /** e.g. "bulk-sync-ws" → `bulk-sync-ws-all`, `bulk-sync-ws-<id>`. */
  testIdPrefix: string;
  label?: string;
}): React.ReactElement {
  const tabs: { id: WorkspaceFilter; name: string }[] = [
    { id: 'all', name: 'All' },
    ...workspaces.map(w => ({ id: w.id, name: w.name })),
  ];
  return (
    <div
      role="tablist"
      aria-label={label}
      data-testid={`${testIdPrefix}-tabs`}
      className="flex gap-1 overflow-x-auto custom-scrollbar pb-1"
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
          className={`flex-shrink-0 max-w-[180px] truncate h-7 px-3 rounded-full border text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kx-accent-line)] ${
            value === t.id
              ? 'border-[var(--kx-accent-line)] bg-[var(--kx-accent-soft)] text-[var(--kx-accent-2)]'
              : 'border-[var(--kx-line-2)] text-[var(--kx-muted)] hover:text-[var(--kx-text)] hover:border-[rgba(255,255,255,.22)]'
          }`}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}
