/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7.5 — the Bulk Projects modal: N rows, one per project, each an
// upload surface; then one Build Timeline for the whole batch. Every sentence
// lives in BULK_COPY (services/bulkContext.ts) for operator sign-off.

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { BULK_COPY, BULK_MAX_PROJECTS, parseBulkCount } from '../services/bulkContext';
import { BulkRowStore, defaultBulkRowDeps, type BulkRowState } from '../services/bulkRows';
import { cloudSyncQueue, queueProjectsForCloudSync } from '../services/bulkSyncQueue';
import { CLOUD_USD_PER_WORKER_SEC, type CloudQueueDeps } from '../services/cloudQueueJob';
import { collectDroppedFiles } from '../services/droppedFiles';
import { missingSlots, missingSlotsReason } from '../services/buildTimelineGate';
import { formatUsd, type QueueItem, type SyncQueue } from '../services/syncQueue';
import { readSyncEngineHost } from '../services/syncEngineHost';

/** The "how many?" question. */
export function BulkCountDialog({ onConfirm, onCancel, max = BULK_MAX_PROJECTS }: {
  onConfirm: (count: number) => void;
  onCancel: () => void;
  max?: number;
}): React.ReactElement {
  const [raw, setRaw] = useState('3');
  const count = parseBulkCount(raw, max);
  return (
    <div className="kxd-dialog-scrim">
      <form
        className="kxd-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={BULK_COPY.dialogTitle}
        onSubmit={e => { e.preventDefault(); if (count !== null) onConfirm(count); }}
      >
        <h3>{BULK_COPY.dialogTitle}</h3>
        <label className="block text-[12px] mb-1" htmlFor="bulk-count">{BULK_COPY.quantityLabel}</label>
        <input
          id="bulk-count"
          data-testid="bulk-count-input"
          type="number"
          min={1}
          max={max}
          step={1}
          value={raw}
          onChange={e => setRaw(e.target.value)}
          className="w-24 rounded bg-[#1a1a1a] border border-[#333] px-2 py-1 text-[13px]"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <p className="mt-2 text-[11px] text-gray-500">
          {count === null && raw.trim() !== '' ? BULK_COPY.quantityInvalid(max) : BULK_COPY.quantityHint(max)}
        </p>
        <div className="kxd-dialog-actions">
          <button type="button" className="kxd-dialog-cancel" onClick={onCancel}>{BULK_COPY.cancel}</button>
          <button type="submit" data-testid="bulk-count-confirm" className="kxd-dialog-confirm" disabled={count === null}>
            {BULK_COPY.create}
          </button>
        </div>
      </form>
    </div>
  );
}

function rowCost(item: Readonly<QueueItem>): string {
  return `${item.workerSec.toFixed(0)} s worked · about ${formatUsd(item.workerSec * CLOUD_USD_PER_WORKER_SEC)}`;
}

interface RowProps {
  row: BulkRowState;
  item: Readonly<QueueItem> | undefined;
  skippedReason: string | undefined;
  onFiles: (files: File[]) => void;
  onCancel: () => void;
  onOpen: () => void;
}

function BulkRow({ row, item, skippedReason, onFiles, onCancel, onOpen }: RowProps): React.ReactElement {
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => { folderRef.current?.setAttribute('webkitdirectory', ''); }, []);
  const locked = item !== undefined && (item.status === 'queued' || item.status === 'running');
  const status = item?.status === 'running'
    ? (item.phase ?? 'Starting…')
    : item?.status === 'queued' ? 'Waiting'
    : item?.status === 'done' ? 'Ready'
    : item?.status === 'paused' ? `Paused — ${item.reason ?? 'open the project to answer'}`
    : item?.status === 'failed' ? `Failed — ${item.detail ?? ''}`
    : item?.status === 'cancelled' ? 'Cancelled'
    : item?.status === 'skipped' ? BULK_COPY.skipped(item.detail ?? '')
    : skippedReason ? BULK_COPY.skipped(skippedReason) : '';
  const audioText = BULK_COPY.audio[row.audio.state] + (row.audio.detail ? ` (${row.audio.detail})` : '');
  return (
    <li
      data-testid={`bulk-row-${row.projectId}`}
      data-status={item?.status ?? 'idle'}
      onDragOver={e => { e.preventDefault(); if (!locked) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault();
        setOver(false);
        if (locked) return;
        void collectDroppedFiles(e.dataTransfer).then(onFiles);
      }}
      className={`rounded-lg border p-3 ${over ? 'border-[#F27D26] bg-[#1c1510]' : 'border-[#282828] bg-[#111]'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12px] text-gray-200">{row.name}</p>
          <div className="mt-1 flex flex-wrap gap-1.5" data-testid={`bulk-slots-${row.projectId}`}>
            {(['script', 'scene', 'voiceover', 'media'] as const).map(slot => (
              <span
                key={slot}
                data-slot={slot}
                data-filled={row.slots[slot]}
                className={`rounded px-1.5 py-0.5 text-[10px] ${row.slots[slot] ? 'bg-emerald-900/50 text-emerald-300' : 'bg-[#1d1d1d] text-gray-500'}`}
              >
                {BULK_COPY.slot[slot]}{slot === 'media' && row.mediaCount > 0 ? ` (${row.mediaCount})` : ''}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!locked && (
            <>
              <button type="button" className="kxd-text-btn" onClick={() => filesRef.current?.click()}>{BULK_COPY.rowBrowseFiles}</button>
              <button type="button" className="kxd-text-btn" onClick={() => folderRef.current?.click()}>{BULK_COPY.rowBrowseFolder}</button>
            </>
          )}
          {locked && (
            <button type="button" data-testid={`bulk-cancel-${row.projectId}`} className="kxd-text-btn" onClick={onCancel}>
              {BULK_COPY.cancelRow}
            </button>
          )}
          {item?.status === 'done' && (
            <button type="button" data-testid={`bulk-open-${row.projectId}`} className="kxd-text-btn" onClick={onOpen}>
              {BULK_COPY.open}
            </button>
          )}
        </div>
      </div>
      <input ref={filesRef} type="file" multiple hidden onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <input ref={folderRef} type="file" multiple hidden onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      {row.busy && <p className="mt-1 text-[10px] text-gray-500">Adding files…</p>}
      {audioText && <p data-testid={`bulk-audio-${row.projectId}`} className="mt-1 text-[10px] text-gray-500">{audioText}</p>}
      {status && <p data-testid={`bulk-status-${row.projectId}`} className="mt-1 text-[10px] text-gray-300">{status}</p>}
      {item && item.workerSec > 0 && <p data-testid={`bulk-cost-${row.projectId}`} className="text-[10px] text-gray-500">{rowCost(item)}</p>}
      {item?.receipt && <p data-testid={`bulk-receipt-${row.projectId}`} className="text-[10px] text-amber-400">{item.receipt}</p>}
      {row.notes.map((n, i) => <p key={i} className="mt-1 text-[10px] text-amber-400">{n}</p>)}
    </li>
  );
}

export function BulkProjectsModal({
  projects, parseProjectData, onOpenProject, onClose, queue = cloudSyncQueue, store: injected,
}: {
  projects: readonly { id: string; name: string }[];
  parseProjectData: CloudQueueDeps['parseProjectData'];
  onOpenProject: (id: string) => void;
  onClose: () => void;
  queue?: SyncQueue;
  store?: BulkRowStore;
}): React.ReactElement {
  const [store, setStore] = useState<BulkRowStore | null>(injected ?? null);
  useEffect(() => {
    if (injected) return;
    let live = true;
    void defaultBulkRowDeps().then(deps => { if (live) setStore(new BulkRowStore(deps)); });
    return () => { live = false; };
  }, [injected]);
  useEffect(() => { store?.init(projects); }, [store, projects]);
  const rows = useSyncExternalStore(
    l => store?.subscribe(l) ?? (() => undefined),
    () => store?.snapshot() ?? EMPTY_ROWS,
  );
  const snap = useSyncExternalStore(l => queue.subscribe(l), () => queue.snapshot());
  const [skips, setSkips] = useState<Record<string, string>>({});
  const cloud = readSyncEngineHost() === 'cloud';
  const items = useMemo(() => new Map(snap.items.map(i => [i.id, i])), [snap.items]);
  const complete = rows.filter(r => missingSlots(r.slots).length === 0);
  const canBuild = cloud && complete.length > 0 && !snap.running;
  const line = queue.batchLine();

  const build = (): void => {
    const next: Record<string, string> = {};
    for (const r of rows) {
      const why = missingSlotsReason(r.slots);
      if (why) next[r.projectId] = why;
    }
    setSkips(next);
    queueProjectsForCloudSync(complete.map(r => ({ id: r.projectId, name: r.name })), parseProjectData);
  };

  return (
    <div className="kxd-dialog-scrim" data-testid="bulk-modal">
      <div className="kxd-dialog" role="dialog" aria-modal="true" aria-label={BULK_COPY.modalTitle} style={{ width: 'min(720px, 92vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-start justify-between">
          <h3>{BULK_COPY.modalTitle}</h3>
          <button type="button" aria-label={BULK_COPY.close} className="kxd-text-btn" data-testid="bulk-close" onClick={onClose}><X size={14} /></button>
        </div>
        <p className="text-[11px] text-gray-400 mb-3">{BULK_COPY.modalIntro}</p>
        <ol className="space-y-2 overflow-y-auto pr-1" style={{ minHeight: 0 }}>
          {rows.map(row => (
            <BulkRow
              key={row.projectId}
              row={row}
              item={items.get(row.projectId)}
              skippedReason={skips[row.projectId]}
              onFiles={files => void store?.addFiles(row.projectId, files)}
              onCancel={() => queue.cancel(row.projectId)}
              onOpen={() => onOpenProject(row.projectId)}
            />
          ))}
        </ol>
        {line && <p className="mt-3 text-[11px] text-gray-300" data-testid="bulk-batch-line">{line}</p>}
        <div className="kxd-dialog-actions" style={{ marginTop: 12 }}>
          {snap.running && (
            <button type="button" data-testid="bulk-cancel-all" className="kxd-dialog-cancel" onClick={() => queue.cancelAll()}>
              {BULK_COPY.cancelAll}
            </button>
          )}
          <button
            type="button"
            data-testid="bulk-build"
            className="kxd-dialog-confirm"
            disabled={!canBuild}
            title={!cloud ? BULK_COPY.notCloud : complete.length === 0 ? BULK_COPY.buildNeeds : undefined}
            onClick={build}
          >
            {BULK_COPY.build}
          </button>
        </div>
        <p className="mt-2 text-[9px] text-gray-600 leading-snug">{BULK_COPY.closeNote}</p>
      </div>
    </div>
  );
}

const EMPTY_ROWS: readonly BulkRowState[] = [];
