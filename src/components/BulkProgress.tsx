/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk UI rebuild — the progress read-outs the drawer's group headers and the
// dashboard's bulk button share: a small ring, "n/m done", and a red dot with
// a count when any row failed. Same palette as the drawer (orange progress on
// the #282828 line, the app's red for failure).

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { BULK_COPY } from '../services/bulkContext';
import type { BulkGroup, BulkProgress } from '../services/bulkBatch';

export function ProgressRing({ done, total, size = 16 }: { done: number; total: number; size?: number }): React.ReactElement {
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg
      data-testid="bulk-ring"
      data-progress={String(Math.round(p * 1000) / 1000)}
      role="img"
      aria-label={BULK_COPY.ringLabel(done, total)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="flex-shrink-0 -rotate-90"
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#282828" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F27D26" strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={c * (1 - p)} strokeLinecap="round"
      />
    </svg>
  );
}

export function FailedDot({ count }: { count: number }): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <span
      data-testid="bulk-failed-dot"
      aria-label={BULK_COPY.failedCount(count)}
      title={BULK_COPY.failedCount(count)}
      className="flex-shrink-0 min-w-[16px] h-4 rounded-full bg-red-500 px-1 text-center text-[9px] font-black leading-4 text-white"
    >
      {count}
    </span>
  );
}

export function BulkGroupHeader({ group, progress, onToggle, onRename, children }: {
  group: BulkGroup;
  progress: BulkProgress;
  onToggle: () => void;
  /** Rename in place (Enter / blur saves, Escape cancels). Absent: no rename. */
  onRename?: (name: string) => void;
  /** Group actions (Clear finished), right-aligned. */
  children?: React.ReactNode;
}): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const save = (): void => {
    if (draft !== null && draft.trim() && draft.trim() !== group.name) onRename?.(draft.trim());
    setDraft(null);
  };
  if (draft !== null) {
    return (
      <div data-testid={`bulk-group-${group.id}`} className="flex items-center gap-2 py-2">
        <input
          data-testid={`bulk-group-name-${group.id}`}
          aria-label={BULK_COPY.groupNameLabel}
          value={draft}
          maxLength={60}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
          }}
          className="h-7 min-w-0 flex-1 bg-[#1A1A1A] border border-[#333] px-2 rounded-md text-[12px] font-semibold text-[var(--kx-text)] outline-none focus:border-[#F27D26]"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </div>
    );
  }
  return (
    <div data-testid={`bulk-group-${group.id}`} className="flex items-center gap-2 py-2">
      <button
        type="button"
        data-testid={`bulk-group-toggle-${group.id}`}
        aria-expanded={!group.collapsed}
        aria-label={group.collapsed ? BULK_COPY.expandGroup(group.name) : BULK_COPY.collapseGroup(group.name)}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-gray-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 rounded"
      >
        {group.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <ProgressRing done={progress.done} total={progress.total} />
        <span className="truncate text-[11px] font-black uppercase tracking-[0.2em] text-[var(--kx-text)]">{group.name}</span>
        <span data-testid={`bulk-group-count-${group.id}`} className="flex-shrink-0 text-[11px] text-[var(--kx-muted)]">
          {BULK_COPY.doneCount(progress.done, progress.total)}
        </span>
        <FailedDot count={progress.failed} />
      </button>
      {onRename && (
        <button
          type="button"
          data-testid={`bulk-group-rename-${group.id}`}
          aria-label={BULK_COPY.renameGroup(group.name)}
          title={BULK_COPY.renameGroup(group.name)}
          onClick={() => setDraft(group.name)}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white transition-colors"
        >
          <Pencil size={12} />
        </button>
      )}
      {children}
    </div>
  );
}
