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
import { AlertCircle, Check, ChevronDown, ChevronRight, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { BULK_COPY, BULK_MAX_PROJECTS, BULK_MIN_PROJECTS, parseBulkCount } from '../services/bulkContext';
import { BulkRowStore, defaultBulkRowDeps, type BulkRowState } from '../services/bulkRows';
import type { Project } from '../types';
import { bulkBatchRunner, cloudSyncQueue } from '../services/bulkSyncQueue';
import {
  BULK_GROUP_MAX_ROWS, BULK_MAX_GROUPS, READY_TO_FINISH, groupProgress, isBatchRowFinal, type BatchRow, type BulkBatchRunner,
} from '../services/bulkBatch';
import { BulkGroupHeader } from './BulkProgress';
import { CLOUD_USD_PER_WORKER_SEC, type CloudQueueDeps } from '../services/cloudQueueJob';
import { collectDroppedFiles } from '../services/droppedFiles';
import { missingSpineSlots } from '../services/buildTimelineGate';
import { formatUsd, type QueueItem, type SyncQueue } from '../services/syncQueue';
import { readSyncEngineHost } from '../services/syncEngineHost';
import { Z } from './overlayLayers';

const SHELL = `fixed inset-0 ${Z.dialog} flex items-center justify-center bg-black/80 backdrop-blur-sm`;
const DRAWER = `fixed top-0 left-0 ${Z.drawer} flex h-full w-[min(100vw,420px)] flex-col border-r border-[#282828] bg-[#111] shadow-2xl transition-transform duration-200`;
const LABEL = 'text-[10px] uppercase tracking-widest text-gray-500 font-bold block mb-2';
const BTN_CANCEL = 'flex-1 bg-transparent border border-[#282828] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:border-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-gray-500';
const BTN_PRIMARY = 'flex-1 bg-[#F27D26] text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#F27D26]';
const ICON_BTN = 'flex items-center justify-center w-9 h-9 rounded-[8px] bg-[var(--kx-surface-2)] border border-[var(--kx-line-2)] text-[var(--kx-text)] opacity-80 hover:opacity-100 hover:border-[#F27D26] transition flex-shrink-0';
const CHIP = 'flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[6px]';

/** The "how many?" question. */
export function BulkCountDialog({ onConfirm, onCancel, max = BULK_MAX_PROJECTS, min = BULK_MIN_PROJECTS }: {
  onConfirm: (count: number) => void;
  onCancel: () => void;
  max?: number;
  min?: number;
}): React.ReactElement {
  const [raw, setRaw] = useState('3');
  const count = parseBulkCount(raw, max, min);
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
          min={min}
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
          {invalid ? BULK_COPY.quantityInvalid(max, min) : BULK_COPY.quantityHint(max, min)}
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
  /** The persistent batch's record for this row (once its project exists). */
  record: BatchRow | undefined;
  onName: (typed: string) => void;
  onFiles: (files: File[]) => void;
  onRemoveFile: (fileId: string) => void;
  onReplaceFile: (fileId: string, file: File) => void;
  onReplaceAll: (files: File[]) => void;
  onClearFiles: () => void;
  onRemoveRow: () => void;
  onCancel: () => void;
  onOpen: () => void;
  /** Built on the cloud but not finished yet: Open finishes it, into the editor. */
  onFinish: () => void;
  onRetry: () => void;
}

function BulkRow({ row, item, skippedReason, record, onName, onFiles, onRemoveFile, onReplaceFile, onReplaceAll, onClearFiles, onRemoveRow, onCancel, onOpen, onFinish, onRetry }: RowProps): React.ReactElement {
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceAllRef = useRef<HTMLInputElement>(null);
  const replacing = useRef<string | null>(null);
  const [over, setOver] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { folderRef.current?.setAttribute('webkitdirectory', ''); }, []);
  const phase = record?.phase;
  const running = phase === 'queued' || phase === 'cloud';
  // Once the project exists the row is a read-out, not an editor.
  const locked = row.built;
  const empty = !Object.values(row.slots).some(Boolean);
  const status = record
    ? phase === 'queued' ? 'Waiting'
    : phase === 'cloud' ? (item?.phase ?? 'Working on the cloud…')
    : phase === 'cloud-done' && record.awaitingOpen ? READY_TO_FINISH
    : phase === 'cloud-done' || phase === 'finishing' ? BULK_COPY.building
    : phase === 'done' ? 'Ready'
    : phase === 'finish-failed' ? BULK_COPY.finishFailed(record.message ?? '')
    : phase === 'paused' ? `Paused — ${record.message ?? 'open the project to answer'}`
    : phase === 'failed' ? `Failed — ${record.message ?? ''}`
    : phase === 'cancelled' ? 'Cancelled'
    : BULK_COPY.skipped(record.message ?? '')
    : skippedReason ? BULK_COPY.skipped(skippedReason) : '';
  const audioText = BULK_COPY.audio[row.audio.state] + (row.audio.detail ? ` (${row.audio.detail})` : '');
  // The quiet line: what the queue says, else the reason a row was left out,
  // else what the voiceover prep is doing, else how to fill the row.
  const quiet = status || audioText || (empty ? BULK_COPY.rowDrop : '');
  const dim = phase === 'skipped' || phase === 'cancelled' || (!record && !!skippedReason);
  const cost = item && item.workerSec > 0 && record ? rowCost(item) : '';
  return (
    <li
      data-testid={`bulk-row-${row.projectId}`}
      data-status={phase ?? 'idle'}
      onDragOver={e => { e.preventDefault(); if (!locked) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault();
        setOver(false);
        if (locked) return;
        void collectDroppedFiles(e.dataTransfer).then(onFiles);
      }}
      className={`rounded-[13px] border px-4 py-3.5 transition-colors bg-[var(--kx-surface)] border-[var(--kx-line-2)] hover:border-[rgba(255,255,255,.18)] ${over ? 'bg-[var(--kx-accent-soft)]' : ''}`}
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          aria-label={BULK_COPY.nameLabel}
          aria-required="true"
          data-testid={`bulk-name-${row.projectId}`}
          value={row.typedName}
          placeholder={BULK_COPY.namePlaceholder}
          disabled={locked}
          onChange={e => onName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          className="w-64 max-w-[60%] h-9 bg-[#1A1A1A] border border-[#333] px-3 rounded-lg text-[13px] font-semibold text-[var(--kx-text)] placeholder:text-gray-500 placeholder:font-normal outline-none focus:border-[#F27D26] transition-colors disabled:cursor-not-allowed"
        />
        <div className="flex-1" />
        {row.busy && <span className="text-[11px] text-[var(--kx-muted)]">Adding…</span>}
        {(phase === 'done' || phase === 'finish-failed' || (phase === 'cloud-done' && record?.awaitingOpen)) && (
          <button
            type="button"
            data-testid={`bulk-open-${row.projectId}`}
            onClick={phase === 'cloud-done' ? onFinish : onOpen}
            className="flex-shrink-0 h-8 text-[12px] px-3 rounded-[8px] bg-[var(--kx-surface-2)] border border-[var(--kx-line-2)] text-[var(--kx-text)] hover:border-[#F27D26] transition-colors"
          >
            {BULK_COPY.open}
          </button>
        )}
        {running ? (
          <button
            type="button"
            data-testid={`bulk-cancel-${row.projectId}`}
            onClick={onCancel}
            className="flex-shrink-0 h-8 px-2 text-[12px] text-gray-400 hover:text-white transition-colors"
          >
            {BULK_COPY.cancelRow}
          </button>
        ) : !locked && (
          <>
            <div className="relative flex-shrink-0">
              <button
                type="button"
                data-testid={`bulk-upload-${row.projectId}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={BULK_COPY.upload}
                title={BULK_COPY.upload}
                onClick={() => setMenuOpen(o => !o)}
                className={ICON_BTN}
              >
                <Upload size={15} />
              </button>
              {menuOpen && (
                <div role="menu" data-testid={`bulk-upload-menu-${row.projectId}`} className="absolute right-0 top-10 z-10 w-40 rounded-lg border border-[#282828] bg-[#111] py-1 shadow-2xl">
                  <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--kx-text)] hover:bg-[var(--kx-surface-2)]" onClick={() => { setMenuOpen(false); filesRef.current?.click(); }}>
                    {BULK_COPY.uploadFiles}
                  </button>
                  <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--kx-text)] hover:bg-[var(--kx-surface-2)]" onClick={() => { setMenuOpen(false); folderRef.current?.click(); }}>
                    {BULK_COPY.uploadFolder}
                  </button>
                </div>
              )}
            </div>
            <button type="button" aria-label={BULK_COPY.removeProject} title={BULK_COPY.removeProject} data-testid={`bulk-remove-${row.projectId}`} onClick={onRemoveRow} className={ICON_BTN}>
              <X size={15} />
            </button>
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid={`bulk-slots-${row.projectId}`}>
        {(['script', 'scene', 'voiceover', 'media'] as const).map(slot => (
          <span
            key={slot}
            data-slot={slot}
            data-filled={row.slots[slot]}
            className={`${CHIP} ${row.slots[slot]
              ? 'bg-[var(--kx-ready-soft)] text-[var(--kx-ready)]'
              : 'bg-[var(--kx-surface-2)] text-[var(--kx-muted)]'}`}
          >
            {row.slots[slot] ? <Check size={11} /> : slot === 'media' ? null : <AlertCircle size={11} />}
            {BULK_COPY.slot[slot]}
            {slot === 'media' && row.mediaCount > 0 ? ` · ${row.mediaCount}` : ''}
            {slot === 'media' && !row.slots.media ? ` · ${BULK_COPY.optional}` : ''}
          </span>
        ))}
        {row.files.length > 0 && !locked && (
          <button
            type="button"
            data-testid={`bulk-files-toggle-${row.projectId}`}
            aria-expanded={listOpen}
            onClick={() => setListOpen(o => !o)}
            className="ml-1 flex items-center gap-1 text-[11px] text-[var(--kx-muted)] hover:text-[var(--kx-text)] transition-colors"
          >
            {listOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {BULK_COPY.filesToggle(row.files.length)}
          </button>
        )}
      </div>
      {listOpen && row.files.length > 0 && !locked && (
        <div className="mt-2.5 rounded-lg border border-[var(--kx-line)] bg-[#0f1319] py-1" data-testid={`bulk-files-${row.projectId}`}>
          <ul>
            {row.files.map(f => (
              <li key={f.id} className="flex items-center gap-2 px-3 py-1 text-[12px]">
                <span className="w-24 flex-shrink-0 whitespace-nowrap text-[10px] uppercase tracking-widest text-[var(--kx-faint)]">{BULK_COPY.slot[f.kind]}</span>
                <span className="flex-1 min-w-0 truncate text-[var(--kx-text)]">{f.name}</span>
                {!f.id.startsWith('bundle:') && (
                  <button
                    type="button"
                    aria-label={BULK_COPY.replaceFile(f.name)}
                    title={BULK_COPY.replaceFile(f.name)}
                    onClick={() => { replacing.current = f.id; replaceRef.current?.click(); }}
                    className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white transition-colors"
                  >
                    <RefreshCw size={12} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={BULK_COPY.removeFile(f.name)}
                  title={BULK_COPY.removeFile(f.name)}
                  onClick={() => onRemoveFile(f.id)}
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white transition-colors"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <div className="px-3 pt-1 pb-1 border-t border-[var(--kx-line)] mt-1 flex items-center gap-4">
            <button
              type="button"
              data-testid={`bulk-replace-all-${row.projectId}`}
              onClick={() => replaceAllRef.current?.click()}
              className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-white transition-colors"
            >
              <RefreshCw size={12} />
              {BULK_COPY.replaceAll}
            </button>
            <button
              type="button"
              data-testid={`bulk-clear-${row.projectId}`}
              onClick={onClearFiles}
              className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-white transition-colors"
            >
              <Trash2 size={12} />
              {BULK_COPY.clearFiles}
            </button>
          </div>
        </div>
      )}
      <p
        data-testid={`bulk-status-${row.projectId}`}
        className={`mt-2.5 text-[12px] leading-snug ${dim ? 'text-[var(--kx-faint)]' : 'text-[var(--kx-muted)]'}`}
      >
        {quiet}{cost ? ` · ${cost}` : ''}
      </p>
      {record?.checkpoint && (
        <p className="mt-1.5 flex flex-wrap gap-1" data-testid={`bulk-stages-${row.projectId}`}>
          {(['staged', 'transcript-cached', 'aligned', 'built'] as const).map(stage => (
            <span key={stage} className={`${CHIP} ${record.checkpoint === stage ? 'bg-[#F27D26]/20 text-[#F27D26]' : 'bg-[var(--kx-surface-2)] text-[var(--kx-faint)]'}`}>
              {stage}
            </span>
          ))}
        </p>
      )}
      {(phase === 'failed' || phase === 'finish-failed' || phase === 'paused') && (
        <button type="button" data-testid={`bulk-retry-${row.projectId}`} className={`${BTN_CANCEL} mt-2`} onClick={onRetry}>
          {BULK_COPY.retry}
        </button>
      )}
      <input ref={filesRef} type="file" multiple hidden onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <input ref={folderRef} type="file" multiple hidden onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <input
        ref={replaceRef}
        data-testid={`bulk-replace-input-${row.projectId}`}
        type="file"
        hidden
        onChange={e => {
          const file = e.target.files?.[0];
          const target = replacing.current;
          replacing.current = null;
          e.target.value = '';
          if (file && target) onReplaceFile(target, file);
        }}
      />
      <input
        ref={replaceAllRef}
        data-testid={`bulk-replace-all-input-${row.projectId}`}
        type="file"
        multiple
        hidden
        onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length > 0) onReplaceAll(files); }}
      />
      {item?.receipt && <p data-testid={`bulk-receipt-${row.projectId}`} className="mt-1.5 text-[11px] text-amber-300/80">{item.receipt}</p>}
      {row.notes.map((n, i) => <p key={i} className="mt-1.5 text-[11px] text-amber-300/80">{n}</p>)}
    </li>
  );
}

export function BulkProjectsModal({
  createBlankProject, parseProjectData, onOpenProject, onFinishRow, onClose, onProjectsCreated,
  runner: injectedRunner, queue = cloudSyncQueue, store: injected, hidden = false,
}: {
  createBlankProject: () => Project;
  parseProjectData: CloudQueueDeps['parseProjectData'];
  onOpenProject: (id: string) => void;
  /** A row built on the cloud and waiting for its Open: finish it now. */
  onFinishRow?: (id: string) => void;
  onClose: () => void;
  /** Projects were just created (Build Timeline): the dashboard should refresh. */
  onProjectsCreated?: () => void;
  /** The persistent batch (default: the app's). It keeps working after this
   *  window closes, and after a reload it is reachable from the dashboard. */
  runner?: BulkBatchRunner;
  queue?: SyncQueue;
  store?: BulkRowStore;
  /** Hide keeps the batch mounted and running. It does not close it. */
  hidden?: boolean;
}): React.ReactElement {
  const runner = useMemo(() => injectedRunner ?? bulkBatchRunner(parseProjectData), [injectedRunner, parseProjectData]);
  const [store, setStore] = useState<BulkRowStore | null>(injected ?? null);
  useEffect(() => {
    if (injected) return;
    let live = true;
    void defaultBulkRowDeps(createBlankProject).then(deps => {
      if (!live) return;
      setStore(new BulkRowStore(deps, BULK_MAX_GROUPS * BULK_GROUP_MAX_ROWS));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injected]);
  const rows = useSyncExternalStore(
    l => store?.subscribe(l) ?? (() => undefined),
    () => store?.snapshot() ?? EMPTY_ROWS,
  );
  const snap = useSyncExternalStore(l => queue.subscribe(l), () => queue.snapshot());
  const records = useSyncExternalStore(l => runner.subscribe(l), () => runner.snapshot());
  const groups = useSyncExternalStore(l => runner.subscribe(l), () => runner.groups());
  const [skips, setSkips] = useState<Record<string, string>>({});
  // Bulk UI rebuild U3 — creating lives HERE, never on the dashboard: one
  // "Create Projects" is one new group of 2–30 empty draft rows.
  const [askingCreate, setAskingCreate] = useState(false);
  const createGroup = (count: number): void => {
    if (!store || !runner.canCreateGroup()) return;
    const ids = store.createDrafts(count);
    if (!runner.createGroup(ids)) void Promise.all(ids.map(id => store.discardRow(id)));
  };
  const addToGroup = (groupId: string): void => {
    const id = store?.addRow();
    if (id && !runner.addRowToGroup(groupId, id)) void store?.discardRow(id);
  };
  // While this window is open, finished cloud work is turned into real timelines.
  useEffect(() => runner.holdFinishOpen(), [runner]);
  // The rows of projects the batch already made (a reopened window) come from its record.
  useEffect(() => { store?.syncBuilt(records); }, [store, records]);
  const cloud = readSyncEngineHost() === 'cloud';
  const items = useMemo(() => new Map(snap.items.map(i => [i.id, i])), [snap.items]);
  const recordById = useMemo(() => new Map(records.map(r => [r.id, r])), [records]);
  const complete = rows.filter(r => !r.built && r.typedName.trim().length > 0 && missingSpineSlots(r.slots).length === 0);
  const canBuild = cloud && complete.length > 0;
  const anyRunning = records.some(r => r.phase === 'queued' || r.phase === 'cloud');
  const anyFinal = records.some(r => isBatchRowFinal(r.phase));
  const line = queue.batchLine();

  const rowById = new Map(rows.map(r => [r.projectId, r]));
  const inGroup = new Set(groups.flatMap(g => g.rowIds));
  const loose = rows.filter(r => !inGroup.has(r.projectId));
  const renderRow = (row: BulkRowState): React.ReactElement => (
    <BulkRow
      key={row.projectId}
      row={row}
      item={items.get(row.projectId)}
      skippedReason={skips[row.projectId]}
      record={recordById.get(row.projectId)}
      onName={typed => store?.setTypedName(row.projectId, typed)}
      onFiles={files => void store?.addFiles(row.projectId, files)}
      onRemoveFile={fileId => void store?.removeFile(row.projectId, fileId)}
      onReplaceFile={(fileId, file) => void store?.replaceFile(row.projectId, fileId, file)}
      onReplaceAll={files => void store?.replaceAll(row.projectId, files)}
      onClearFiles={() => void store?.clearFiles(row.projectId)}
      onRemoveRow={() => void store?.discardRow(row.projectId)}
      onCancel={() => queue.cancel(row.projectId)}
      onOpen={() => open(row.projectId)}
      onFinish={() => finishRow(row.projectId)}
      onRetry={() => runner.retry(row.projectId)}
    />
  );

  const build = (): void => {
    void (async () => {
      if (!store) return;
      // Only now do projects exist: the real rows are created, empty drafts discarded.
      const { created, skips: left } = await store.buildReady();
      setSkips(left);
      if (created.length === 0) return;
      onProjectsCreated?.();
      runner.start(created);
    })();
  };

  const close = (): void => { void (store?.discardUnbuilt() ?? Promise.resolve()).finally(onClose); };
  const open = (id: string): void => { void (store?.discardUnbuilt() ?? Promise.resolve()).finally(() => onOpenProject(id)); };
  const finishRow = (id: string): void => {
    void (store?.discardUnbuilt() ?? Promise.resolve()).finally(() => {
      if (onFinishRow) onFinishRow(id);
      else if (!runner.finishNow(id)) onOpenProject(id);
    });
  };

  return (
    <div
      className={`${DRAWER} ${hidden ? '-translate-x-full pointer-events-none' : ''}`}
      data-testid="bulk-modal"
      data-hidden={hidden ? 'true' : 'false'}
      aria-hidden={hidden}
    >
      <div
        role="dialog"
        aria-modal="false"
        aria-label={BULK_COPY.modalTitle}
        className="flex flex-col h-full min-h-0"
      >
        <div className="px-8 pt-7 pb-5 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-black uppercase tracking-[0.2em]">{BULK_COPY.modalTitle}</h2>
            <button
              type="button"
              aria-label={BULK_COPY.close}
              data-testid="bulk-close"
              onClick={close}
              className="text-gray-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F27D26] rounded"
            >
              <X size={16} />
            </button>
          </div>
          <p className="text-xs leading-relaxed text-gray-400">{BULK_COPY.modalIntro}</p>
          <button
            type="button"
            data-testid="bulk-create"
            className={`${BTN_PRIMARY} mt-4 w-full flex items-center justify-center gap-1.5`}
            disabled={!store || !runner.canCreateGroup()}
            title={runner.canCreateGroup() ? undefined : BULK_COPY.groupsFull(BULK_MAX_GROUPS)}
            onClick={() => setAskingCreate(true)}
          >
            <Plus size={13} />
            {BULK_COPY.createProjects}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-8 py-2 space-y-3" data-testid="bulk-groups">
          {groups.length === 0 && rows.length === 0 && (
            <p data-testid="bulk-empty" className="text-[12px] leading-snug text-[var(--kx-muted)]">{BULK_COPY.emptyDrawer}</p>
          )}
          {groups.map(group => {
            const members = group.rowIds.map(id => rowById.get(id)).filter((r): r is BulkRowState => !!r);
            return (
              <section key={group.id} data-testid={`bulk-group-section-${group.id}`}>
                <BulkGroupHeader
                  group={group}
                  progress={groupProgress(group, records)}
                  onToggle={() => runner.setCollapsed(group.id, !group.collapsed)}
                />
                {!group.collapsed && (
                  <>
                    <ol className="space-y-3">{members.map(renderRow)}</ol>
                    <button
                      type="button"
                      data-testid={`bulk-add-${group.id}`}
                      className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      disabled={group.rowIds.length >= BULK_GROUP_MAX_ROWS}
                      title={group.rowIds.length >= BULK_GROUP_MAX_ROWS ? `Up to ${BULK_GROUP_MAX_ROWS} projects in a group` : undefined}
                      onClick={() => addToGroup(group.id)}
                    >
                      <Plus size={12} />
                      {BULK_COPY.addProject}
                    </button>
                  </>
                )}
              </section>
            );
          })}
          {loose.length > 0 && <ol className="space-y-3">{loose.map(renderRow)}</ol>}
        </div>
        <div className="px-8 pt-4 pb-8 flex-shrink-0">
          <div className="border-t border-white/[0.06] pt-3">
            {line && <p className="text-[11px] leading-snug text-gray-400 mb-2" data-testid="bulk-batch-line">{line}</p>}
            {!canBuild && !anyRunning && (
              <p className="text-[11px] leading-snug text-gray-400 mb-3">{!cloud ? BULK_COPY.notCloud : BULK_COPY.buildNeeds}</p>
            )}
            <div className="flex gap-3">
              {anyFinal && (
                <button type="button" data-testid="bulk-clear-finished" className={BTN_CANCEL} onClick={() => runner.clearFinished()}>
                  {BULK_COPY.clearFinished}
                </button>
              )}
              {anyRunning && (
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
            <p className="mt-3 text-[10px] leading-snug text-gray-500">{BULK_COPY.closeNote}</p>
          </div>
        </div>
      </div>
      {askingCreate && (
        <BulkCountDialog
          onCancel={() => setAskingCreate(false)}
          onConfirm={count => { setAskingCreate(false); createGroup(count); }}
        />
      )}
    </div>
  );
}

const EMPTY_ROWS: readonly BulkRowState[] = [];
