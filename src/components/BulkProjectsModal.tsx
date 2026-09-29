/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7.5 — the Bulk Projects modal: N rows, one per project, each an
// upload surface; then one Build Timeline for the whole batch. Every sentence
// lives in BULK_COPY (services/bulkContext.ts) for operator sign-off.
//
// U7.5b — styled in the app's own language, nothing new: the modal shell is
// NewProjectModal's / SyncPausedDialog's (bg-[#111], border-[#282828],
// rounded-2xl, uppercase tracked title, orange primary + bordered secondary);
// a row is DropZonePanel's SlotRow (kx-surface card, accent-soft on drag-over)
// with its Ready / Empty status chips as the four slot chips; the batch line
// is the sync-log Details line's quiet register.

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, Check, FilePlus, FolderPlus, X } from 'lucide-react';
import { BULK_COPY, BULK_MAX_PROJECTS, parseBulkCount } from '../services/bulkContext';
import { BulkRowStore, defaultBulkRowDeps, type BulkRowState } from '../services/bulkRows';
import { cloudSyncQueue, queueProjectsForCloudSync } from '../services/bulkSyncQueue';
import { CLOUD_USD_PER_WORKER_SEC, type CloudQueueDeps } from '../services/cloudQueueJob';
import { collectDroppedFiles } from '../services/droppedFiles';
import { missingSlots, missingSlotsReason } from '../services/buildTimelineGate';
import { formatUsd, type QueueItem, type SyncQueue } from '../services/syncQueue';
import { readSyncEngineHost } from '../services/syncEngineHost';

const SHELL = 'fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-sm';
const LABEL = 'text-[10px] uppercase tracking-widest text-gray-500 font-bold block mb-2';
const BTN_CANCEL = 'flex-1 bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-gray-500';
const BTN_PRIMARY = 'flex-1 bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#F27D26]';
const ICON_BTN = 'flex items-center justify-center w-8 h-8 rounded-[8px] bg-[var(--kx-surface-2)] border border-[var(--kx-line)] text-[var(--kx-muted)] hover:text-[var(--kx-text)] hover:border-[var(--kx-line-2)] transition-colors flex-shrink-0';
const CHIP = 'flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[6px]';

/** The "how many?" question. */
export function BulkCountDialog({ onConfirm, onCancel, max = BULK_MAX_PROJECTS }: {
  onConfirm: (count: number) => void;
  onCancel: () => void;
  max?: number;
}): React.ReactElement {
  const [raw, setRaw] = useState('3');
  const count = parseBulkCount(raw, max);
  const invalid = count === null && raw.trim() !== '';
  return (
    <div className={SHELL}>
      <form
        className="bg-[#111] border border-[#282828] rounded-2xl p-8 w-full max-w-sm shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={BULK_COPY.dialogTitle}
        onSubmit={e => { e.preventDefault(); if (count !== null) onConfirm(count); }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">{BULK_COPY.dialogTitle}</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={BULK_COPY.close}
            className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
          >
            <X size={16} />
          </button>
        </div>
        <label className={LABEL} htmlFor="bulk-count">{BULK_COPY.quantityLabel}</label>
        <input
          id="bulk-count"
          data-testid="bulk-count-input"
          type="number"
          min={1}
          max={max}
          step={1}
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
          className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-sm font-bold outline-none focus:border-[#F27D26] transition-colors"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <p className={`mt-2 text-[9px] uppercase tracking-widest ${invalid ? 'text-amber-300' : 'text-gray-600'}`}>
          {invalid ? BULK_COPY.quantityInvalid(max) : BULK_COPY.quantityHint(max)}
        </p>
        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onCancel} className={BTN_CANCEL}>{BULK_COPY.cancel}</button>
          <button type="submit" data-testid="bulk-count-confirm" className={BTN_PRIMARY} disabled={count === null}>
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
  const empty = !Object.values(row.slots).some(Boolean);
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
  // The quiet line: what the queue says, else the reason a row was left out,
  // else what the voiceover prep is doing, else how to fill the row.
  const quiet = status || audioText || (empty ? BULK_COPY.rowDrop : '');
  const dim = item?.status === 'skipped' || (!item && !!skippedReason);
  const cost = item && item.workerSec > 0 ? rowCost(item) : '';
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
      className={`rounded-[13px] border px-3 py-2.5 transition-colors bg-[var(--kx-surface)] border-[var(--kx-line)] hover:border-[var(--kx-line-2)] ${over ? 'bg-[var(--kx-accent-soft)]' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-[14px] font-semibold text-[var(--kx-text)] truncate">{row.name}</span>
          <span
            data-testid={`bulk-status-${row.projectId}`}
            className={`text-[11.5px] truncate ${dim ? 'text-[var(--kx-faint)]' : 'text-[var(--kx-muted)]'}`}
          >
            {quiet}{cost ? ` · ${cost}` : ''}
          </span>
        </div>
        {row.busy && <span className="text-[11px] text-[var(--kx-faint)]">Adding…</span>}
        {item?.status === 'done' && (
          <button
            type="button"
            data-testid={`bulk-open-${row.projectId}`}
            onClick={onOpen}
            className="flex-shrink-0 text-[12px] px-2.5 py-1.5 rounded-[8px] bg-[var(--kx-surface-2)] border border-[var(--kx-line)] text-[var(--kx-muted)] hover:text-[var(--kx-text)] hover:border-[var(--kx-line-2)] transition-colors"
          >
            {BULK_COPY.open}
          </button>
        )}
        {locked ? (
          <button
            type="button"
            data-testid={`bulk-cancel-${row.projectId}`}
            onClick={onCancel}
            className="flex-shrink-0 text-[12px] text-gray-500 hover:text-white transition-colors"
          >
            {BULK_COPY.cancelRow}
          </button>
        ) : (
          <>
            <button type="button" aria-label={BULK_COPY.rowBrowseFiles} title={BULK_COPY.rowBrowseFiles} onClick={() => filesRef.current?.click()} className={ICON_BTN}>
              <FilePlus size={14} />
            </button>
            <button type="button" aria-label={BULK_COPY.rowBrowseFolder} title={BULK_COPY.rowBrowseFolder} onClick={() => folderRef.current?.click()} className={ICON_BTN}>
              <FolderPlus size={14} />
            </button>
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 pl-0.5" data-testid={`bulk-slots-${row.projectId}`}>
        {(['script', 'scene', 'voiceover', 'media'] as const).map(slot => (
          <span
            key={slot}
            data-slot={slot}
            data-filled={row.slots[slot]}
            className={`${CHIP} ${row.slots[slot]
              ? 'bg-[var(--kx-ready-soft)] text-[var(--kx-ready)]'
              : 'bg-[var(--kx-surface-2)] text-[var(--kx-faint)]'}`}
          >
            {row.slots[slot] ? <Check size={11} /> : <AlertCircle size={11} />}
            {BULK_COPY.slot[slot]}{slot === 'media' && row.mediaCount > 0 ? ` · ${row.mediaCount}` : ''}
          </span>
        ))}
      </div>
      <input ref={filesRef} type="file" multiple hidden onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <input ref={folderRef} type="file" multiple hidden onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      {item?.receipt && <p data-testid={`bulk-receipt-${row.projectId}`} className="mt-1.5 text-[11px] text-amber-300/80">{item.receipt}</p>}
      {row.notes.map((n, i) => <p key={i} className="mt-1.5 text-[11px] text-amber-300/80">{n}</p>)}
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
    <div className={SHELL} data-testid="bulk-modal">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={BULK_COPY.modalTitle}
        className="bg-[#111] border border-[#282828] rounded-2xl w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col"
      >
        <div className="px-8 pt-8 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-black uppercase tracking-[0.2em]">{BULK_COPY.modalTitle}</h2>
            <button
              type="button"
              aria-label={BULK_COPY.close}
              data-testid="bulk-close"
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
            >
              <X size={16} />
            </button>
          </div>
          <p className="text-xs text-gray-500">{BULK_COPY.modalIntro}</p>
        </div>
        <ol className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-8 py-1 space-y-2">
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
        <div className="px-8 pt-4 pb-8 flex-shrink-0">
          <div className="border-t border-white/[0.06] pt-3">
            {line && <p className="text-[11px] leading-snug text-gray-600 mb-2" data-testid="bulk-batch-line">{line}</p>}
            {!canBuild && !snap.running && (
              <p className="text-[11px] leading-snug text-gray-600 mb-2">{!cloud ? BULK_COPY.notCloud : BULK_COPY.buildNeeds}</p>
            )}
            <div className="flex gap-3">
              {snap.running && (
                <button type="button" data-testid="bulk-cancel-all" className={BTN_CANCEL} onClick={() => queue.cancelAll()}>
                  {BULK_COPY.cancelAll}
                </button>
              )}
              <button
                type="button"
                data-testid="bulk-build"
                className={BTN_PRIMARY}
                disabled={!canBuild}
                title={!cloud ? BULK_COPY.notCloud : complete.length === 0 ? BULK_COPY.buildNeeds : undefined}
                onClick={build}
              >
                {BULK_COPY.build}
              </button>
            </div>
            <p className="mt-2 text-[9px] leading-snug text-gray-600">{BULK_COPY.closeNote}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const EMPTY_ROWS: readonly BulkRowState[] = [];
