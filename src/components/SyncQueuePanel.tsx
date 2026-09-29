/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7 — the bulk queue's progress panel (project dashboard). Every
// sentence a person reads here lives in QUEUE_COPY, for operator sign-off.

import React, { useSyncExternalStore } from 'react';
import { cloudSyncQueue } from '../services/bulkSyncQueue';
import type { QueueItemStatus, SyncQueue } from '../services/syncQueue';

export const QUEUE_COPY = {
  title: 'Cloud sync queue',
  status: {
    queued: 'Waiting',
    running: 'Syncing',
    done: 'Ready — press Build Timeline in the project',
    skipped: 'Skipped',
    paused: 'Paused — open the project to answer',
    failed: 'Failed',
    cancelled: 'Cancelled',
  } satisfies Record<QueueItemStatus, string>,
  cancel: 'Cancel',
  cancelAll: 'Cancel all',
  clear: 'Clear',
  hint: 'Projects sync one after another on one cloud GPU start. A project that stops waits for you; the rest carry on.',
} as const;

export function SyncQueuePanel({ queue = cloudSyncQueue }: { queue?: SyncQueue }): React.ReactElement | null {
  const snap = useSyncExternalStore(
    listener => queue.subscribe(listener),
    () => queue.snapshot(),
  );
  if (snap.items.length === 0) return null;
  const total = snap.items.length;
  const line = queue.batchLine();
  return (
    <section
      data-testid="sync-queue-panel"
      aria-label={QUEUE_COPY.title}
      className="mb-6 rounded-xl border border-[#282828] bg-[#111] p-4 text-[11px] text-gray-300"
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em]">{QUEUE_COPY.title}</h2>
        <div className="flex gap-3">
          {snap.running ? (
            <button type="button" data-testid="sync-queue-cancel-all" className="kxd-text-btn" onClick={() => queue.cancelAll()}>
              {QUEUE_COPY.cancelAll}
            </button>
          ) : (
            <button type="button" data-testid="sync-queue-clear" className="kxd-text-btn" onClick={() => queue.clearFinished()}>
              {QUEUE_COPY.clear}
            </button>
          )}
        </div>
      </div>
      <ol className="space-y-1.5">
        {snap.items.map(item => (
          <li key={item.id} data-testid={`sync-queue-item-${item.id}`} data-status={item.status} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate">
                <span className="text-gray-500 mr-2">{item.position} of {total}</span>
                {item.label}
              </p>
              <p className="text-[10px] text-gray-500 leading-snug">
                {item.status === 'running' && item.phase ? item.phase : QUEUE_COPY.status[item.status]}
                {item.status !== 'running' && item.detail ? ` — ${item.detail}` : ''}
              </p>
              {item.receipt && <p className="text-[10px] text-amber-400 leading-snug" data-testid={`sync-queue-receipt-${item.id}`}>{item.receipt}</p>}
            </div>
            {(item.status === 'queued' || item.status === 'running') && (
              <button
                type="button"
                data-testid={`sync-queue-cancel-${item.id}`}
                className="kxd-text-btn shrink-0"
                onClick={() => queue.cancel(item.id)}
              >
                {QUEUE_COPY.cancel}
              </button>
            )}
          </li>
        ))}
      </ol>
      {line && <p className="mt-3 text-[10px] text-gray-400" data-testid="sync-queue-batch-line">{line}</p>}
      <p className="mt-2 text-[9px] text-gray-600 leading-snug">{QUEUE_COPY.hint}</p>
    </section>
  );
}
