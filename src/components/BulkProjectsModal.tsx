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
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, ExternalLink, FileText, Image as ImageIcon, Mic, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { BULK_COPY, BULK_MAX_PROJECTS, BULK_MIN_PROJECTS, parseBulkCount } from '../services/bulkContext';
import { BulkRowStore, defaultBulkRowDeps, type BulkRowState } from '../services/bulkRows';
import type { Project } from '../types';
import { bulkBatchRunner, cloudSyncQueue } from '../services/bulkSyncQueue';
import {
  BULK_GROUP_MAX_ROWS, BULK_MAX_GROUPS, READY_TO_FINISH, groupProgress, isBatchRowFinal, type BatchRow, type BulkBatchRunner,
} from '../services/bulkBatch';
import { BulkGroupHeader } from './BulkProgress';
import { bulkFooterLine, cloudCostLine, type CloudQueueDeps } from '../services/cloudQueueJob';
import { bulkStageChecklist } from '../services/bulkStageChecklist';
import { collectDroppedFiles } from '../services/droppedFiles';
import { missingSpineSlots } from '../services/buildTimelineGate';
import { type QueueItem, type SyncQueue } from '../services/syncQueue';
import { readSyncEngineHost } from '../services/syncEngineHost';
import { killAllMemberCloudJobs } from '../services/cloudSyncEngine';
import { Z } from './overlayLayers';
import { ConfirmDialog } from './ConfirmDialog';
import { deleteProjectEverywhere } from '../services/projectDelete';

const DRAWER = `fixed top-0 left-0 ${Z.drawer} flex h-full w-[min(100vw,480px)] flex-col border-r border-[var(--kx-line-2)] bg-[var(--kx-bg)] will-change-transform`;
/** The panel's slide: the dashboard's glide uses the same curve (ProjectDashboard DOCK_MOTION). */
const DRAWER_MOTION: React.CSSProperties = { transition: 'transform 340ms cubic-bezier(.22, 1, .36, 1)' };
/** The dashboard's own neutral palette, so panel and dashboard read as one surface. */
const DRAWER_PALETTE = {
  '--kx-bg': '#0a0a0b',
  '--kx-panel': '#111113',
  '--kx-surface': '#19191c',
  '--kx-surface-2': '#1e1e21',
  '--kx-hover': '#242428',
  '--kx-line': 'rgba(255,255,255,.07)',
  '--kx-line-2': 'rgba(255,255,255,.12)',
} as React.CSSProperties;
/** Over content it casts a shadow; docked beside the dashboard it is a flat column. */
const DRAWER_FLOAT = 'shadow-[8px_0_40px_rgba(0,0,0,.55)]';
const LABEL = 'text-[10px] uppercase tracking-widest text-[var(--kx-muted)] font-bold block mb-2';
// Enabled: the app's one orange. Disabled: a neutral, legible outline — never a faded orange.
const BTN_PRIMARY = 'flex-1 border border-transparent bg-[var(--kx-accent)] text-[#1a0f06] p-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[var(--kx-accent-hover)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--kx-accent-line)] disabled:bg-[var(--kx-surface-2)] disabled:text-[var(--kx-faint)] disabled:border-[var(--kx-line-2)] disabled:cursor-not-allowed';
// Build Timeline stays orange in both states; disabled is a quieter orange.
const BTN_BUILD = 'border border-transparent bg-[var(--kx-accent)] text-[#1a0f06] rounded-xl text-[10px] font-black uppercase tracking-widest shadow-[0_4px_18px_rgba(255,138,60,.18)] hover:bg-[var(--kx-accent-hover)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--kx-accent-line)] disabled:opacity-55 disabled:shadow-none disabled:cursor-not-allowed disabled:hover:bg-[var(--kx-accent)]';
const FILE_LINE = 'flex items-center gap-2 px-3 py-1 text-[12px]';
const FILE_KIND = 'w-20 flex-shrink-0 whitespace-nowrap text-[10px] uppercase tracking-widest text-[var(--kx-faint)]';
const FILE_ICON = 'flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-[var(--kx-hover)] transition-colors';
const MSG_ARROW = 'w-5 h-6 flex items-center justify-center rounded text-[var(--kx-faint)] hover:text-white hover:bg-[var(--kx-hover)] transition-colors';
const FIELD = 'bg-[var(--kx-surface-2)] border border-[var(--kx-line-2)] rounded-lg font-semibold text-[var(--kx-text)] placeholder:text-[var(--kx-faint)] placeholder:font-normal outline-none focus:border-[var(--kx-accent-line)] transition-colors disabled:cursor-not-allowed disabled:opacity-70';
const ROW_BTN = 'flex-shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--kx-line-2)] bg-[var(--kx-surface-2)] text-[12px] font-semibold text-[var(--kx-text)] hover:border-[rgba(255,255,255,.22)] transition-colors disabled:text-[var(--kx-faint)] disabled:cursor-not-allowed disabled:hover:border-[var(--kx-line-2)]';
const ROW_BTN_SM = 'flex-shrink-0 h-7 px-2.5 rounded-md border border-[var(--kx-line-2)] text-[11px] font-semibold text-[var(--kx-text)] hover:border-[rgba(255,255,255,.22)] transition-colors';
const CHIP = 'flex-shrink-0 flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold px-1.5 py-0.5 rounded-[6px]';

/** Each slot's type icon, in the Files tab's per-type colours. */
const SLOT_ICON = {
  script: { Icon: FileText, color: 'var(--kx-type-script)' },
  scene: { Icon: Clapperboard, color: 'var(--kx-type-scene)' },
  voiceover: { Icon: Mic, color: 'var(--kx-type-voice)' },
  media: { Icon: ImageIcon, color: 'var(--kx-type-media)' },
} as const;
function SlotIcon({ slot }: { slot: keyof typeof SLOT_ICON }): React.ReactElement {
  const { Icon, color } = SLOT_ICON[slot];
  return <Icon size={11} aria-hidden="true" style={{ color }} />;
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
  onReplaceMedia: (files: File[]) => void;
  onRemoveMedia: () => void;
  onClearFiles: () => void;
  onRemoveRow: () => void;
  onCancel: () => void;
  onOpen: () => void;
  /** Built on the cloud but not finished yet: Open finishes it, into the editor. */
  onFinish: () => void;
  onRebuild: () => void;
  onRetry: () => void;
}

function BulkRow({ row, item, skippedReason, record, onName, onFiles, onRemoveFile, onReplaceFile, onReplaceAll, onReplaceMedia, onRemoveMedia, onClearFiles, onRemoveRow, onCancel, onOpen, onFinish, onRebuild, onRetry }: RowProps): React.ReactElement {
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceAllRef = useRef<HTMLInputElement>(null);
  const replacing = useRef<string | null>(null);
  const [over, setOver] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [confirmMediaDelete, setConfirmMediaDelete] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);
  const mediaRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  useEffect(() => { folderRef.current?.setAttribute('webkitdirectory', ''); }, []);
  const phase = record?.phase;
  const running = phase === 'queued' || phase === 'cloud';
  // Files stay editable until the first successful finish.
  const locked = row.sealed;
  const empty = !Object.values(row.slots).some(Boolean);
  const status = record
    ? phase === 'queued' ? 'Waiting'
    : phase === 'cloud' ? (item?.phase ?? 'Working on the cloud…')
    : phase === 'cloud-done' && record.awaitingOpen ? READY_TO_FINISH
    : phase === 'cloud-done' || phase === 'finishing' ? BULK_COPY.building
    : phase === 'done' ? 'Ready'
    : phase === 'finish-failed' ? BULK_COPY.finishFailed(record.message ?? '')
    : phase === 'paused' ? `Paused — ${record.message ?? 'open the project to answer'}`
    : phase === 'failed' ? (record.message ? `Failed — Retry — ${record.message}` : 'Failed — Retry')
    : phase === 'cancelled' ? 'Cancelled — Retry'
    : BULK_COPY.skipped(record.message ?? '')
    : skippedReason ? BULK_COPY.skipped(skippedReason) : '';
  const audioText = BULK_COPY.audio[row.audio.state] + (row.audio.detail ? ` (${row.audio.detail})` : '');
  // The quiet line: what the queue says, else the reason a row was left out,
  // else what the voiceover prep is doing, else how to fill the row.
  const quiet = status || audioText || (empty ? BULK_COPY.rowDrop : '');
  const dim = phase === 'skipped' || (!record && !!skippedReason);
  // Finished attempts are summed on the record; a live unfinished item adds on.
  const liveSec = item && item.finishedAt === undefined ? item.workerSec : 0;
  const workerSec = (record?.workerSec ?? 0) + liveSec;
  const cost = record && workerSec > 0 ? cloudCostLine(workerSec) : '';
  const stages = record ? bulkStageChecklist({
    checkpoint: record.checkpoint,
    phase: record.phase,
    queuePhase: item?.phase,
  }) : [];
  // The row's messages, one line at a time: its status first, then the cancel
  // receipt and any problem notes (a broken bundle, skipped files).
  const messages: { text: string; warn: boolean }[] = [
    ...(row.busy ? [{ text: row.progress || 'Adding…', warn: false }] : [{ text: `${quiet}${cost ? ` · ${cost}` : ''}`, warn: false }]),
    ...(item?.receipt ? [{ text: item.receipt, warn: true }] : []),
    ...row.notes.map(n => ({ text: n, warn: true })),
  ].filter(m => m.text.trim() !== '');
  const shown = messages.length === 0 ? 0 : Math.min(msgIdx, messages.length - 1);
  const current = messages[shown] ?? { text: '', warn: false };
  const openable = row.built || !!record;
  const failedish = phase === 'failed' || phase === 'finish-failed' || phase === 'paused' || phase === 'cancelled';
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
      className={`rounded-xl border p-3.5 transition-colors ${over
        ? 'bg-[var(--kx-accent-soft)] border-[var(--kx-accent-line)]'
        : 'bg-[var(--kx-surface)] border-[var(--kx-line-2)] hover:border-[rgba(255,255,255,.18)]'}`}
    >
      {/* Row 1 — name, Open project, Upload. */}
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
          className={`${FIELD} h-9 min-w-0 flex-1 px-3 text-[13px]`}
        />
        <button
          type="button"
          data-testid={`bulk-open-${row.projectId}`}
          disabled={!openable}
          title={openable ? undefined : BULK_COPY.openWhenReady}
          onClick={phase === 'cloud-done' ? onFinish : onOpen}
          className={`${ROW_BTN} ${openable
            ? 'border-[var(--kx-accent-line)] text-[var(--kx-accent-2)] hover:bg-[var(--kx-accent-soft)]'
            : ''}`}
        >
          <ExternalLink size={13} />
          {BULK_COPY.openShort}
        </button>
        {phase === 'done' && (
          <button
            type="button"
            data-testid={`bulk-rebuild-${row.projectId}`}
            title={BULK_COPY.rebuild}
            onClick={onRebuild}
            className={ROW_BTN}
          >
            <RefreshCw size={13} />
            {BULK_COPY.rebuild}
          </button>
        )}
        <div className="relative flex-shrink-0">
          <button
            type="button"
            data-testid={`bulk-upload-${row.projectId}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={BULK_COPY.upload}
            title={BULK_COPY.upload}
            disabled={locked || running}
            onClick={() => setMenuOpen(o => !o)}
            className={ROW_BTN}
          >
            <Upload size={13} />
            {BULK_COPY.upload}
          </button>
          {menuOpen && !locked && (
            <div role="menu" data-testid={`bulk-upload-menu-${row.projectId}`} className="absolute right-0 top-11 z-10 w-44 rounded-lg border border-[var(--kx-line-2)] bg-[var(--kx-surface-2)] py-1 shadow-2xl">
              <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-[12px] text-[var(--kx-text)] hover:bg-[var(--kx-hover)]" onClick={() => { setMenuOpen(false); filesRef.current?.click(); }}>
                {BULK_COPY.uploadFiles}
              </button>
              <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-[12px] text-[var(--kx-text)] hover:bg-[var(--kx-hover)]" onClick={() => { setMenuOpen(false); folderRef.current?.click(); }}>
                {BULK_COPY.uploadFolder}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Row 2 — file count; chips and stages live in the expanded detail so
          every collapsed row is the same height. */}
      <button
        type="button"
        data-testid={`bulk-files-toggle-${row.projectId}`}
        aria-expanded={listOpen}
        disabled={row.files.length === 0}
        onClick={() => setListOpen(o => !o)}
        className="mt-3 -ml-1.5 flex items-center gap-1 h-6 px-1.5 rounded-md text-[11px] text-[var(--kx-muted)] enabled:hover:text-[var(--kx-text)] enabled:hover:bg-[var(--kx-hover)] transition-colors disabled:cursor-default"
      >
        {BULK_COPY.filesToggle(row.files.length)}
        {listOpen && row.files.length > 0 ? <ChevronDown size={12} /> : <ChevronRight size={12} className={row.files.length === 0 ? 'opacity-40' : ''} />}
      </button>
      {listOpen && row.files.length > 0 && (
        <div className="mt-2 rounded-lg border border-[var(--kx-line)] bg-[var(--kx-panel)] py-1" data-testid={`bulk-files-${row.projectId}`}>
          <div className="px-3 pt-2 pb-1.5 flex flex-nowrap items-center gap-1 overflow-hidden" data-testid={`bulk-slots-${row.projectId}`}>
            {(['script', 'scene', 'voiceover', 'media'] as const).map(slot => (
              <span
                key={slot}
                data-slot={slot}
                data-filled={row.slots[slot]}
                className={`${CHIP} ${row.slots[slot]
                  ? 'bg-[var(--kx-ready-soft)] text-[var(--kx-ready)]'
                  : 'bg-[var(--kx-surface-2)] text-[var(--kx-muted)]'}`}
              >
                <SlotIcon slot={slot} />
                {BULK_COPY.slot[slot]}
                {slot === 'media' && row.mediaCount > 0 ? ` · ${row.mediaCount}` : ''}
                {row.slots[slot] && <Check size={11} />}
              </span>
            ))}
          </div>
          {record && stages.length > 0 && (
            <p className="px-3 pb-2 flex flex-wrap gap-1" data-testid={`bulk-stages-${row.projectId}`}>
              {stages.map(stage => (
                <span
                  key={stage.id}
                  data-testid={`bulk-stage-${row.projectId}-${stage.id}`}
                  data-tone={stage.tone}
                  className={`${CHIP} ${
                    stage.tone === 'active' ? 'bg-[var(--kx-accent-soft)] text-[var(--kx-accent-2)]'
                    : stage.tone === 'done' ? 'bg-[var(--kx-ready-soft)] text-[var(--kx-ready)]'
                    : 'bg-[var(--kx-surface-2)] text-[var(--kx-faint)]'
                  }`}
                >
                  {stage.label}
                </span>
              ))}
            </p>
          )}
          <ul>
            {(['script', 'scene', 'voiceover'] as const).map(kind => {
              const f = row.files.find(x => x.id === kind);
              return (
                <li key={kind} className={FILE_LINE}>
                  <span className={FILE_KIND}>{BULK_COPY.slot[kind]}</span>
                  <span className={`flex-1 min-w-0 truncate ${f ? 'text-[var(--kx-text)]' : 'text-[var(--kx-faint)]'}`}>{f ? f.name : BULK_COPY.notAdded}</span>
                  {!locked && (
                    <>
                  <button
                    type="button"
                    aria-label={f ? BULK_COPY.replaceFile(f.name) : BULK_COPY.addSlot(BULK_COPY.slot[kind])}
                    title={f ? BULK_COPY.replaceFile(f.name) : BULK_COPY.addSlot(BULK_COPY.slot[kind])}
                    onClick={() => { replacing.current = kind; replaceRef.current?.click(); }}
                    className={FILE_ICON}
                  >
                    {f ? <RefreshCw size={12} /> : <Upload size={12} />}
                  </button>
                  <button
                    type="button"
                    aria-label={f ? BULK_COPY.removeFile(f.name) : undefined}
                    title={f ? BULK_COPY.removeFile(f.name) : undefined}
                    disabled={!f}
                    onClick={() => f && onRemoveFile(f.id)}
                    className={`${FILE_ICON} enabled:hover:text-[var(--kx-danger)] disabled:invisible`}
                  >
                    <X size={13} />
                  </button>
                    </>
                  )}
                </li>
              );
            })}
            {(() => {
              const media = row.files.filter(x => x.kind === 'media');
              return (
                <>
                  <li className={FILE_LINE}>
                    <span className={FILE_KIND}>{BULK_COPY.slot.media}</span>
                    <button
                      type="button"
                      data-testid={`bulk-media-toggle-${row.projectId}`}
                      aria-expanded={mediaOpen}
                      disabled={media.length === 0}
                      onClick={() => setMediaOpen(o => !o)}
                      className={`flex-1 min-w-0 flex items-center gap-1 text-left ${media.length ? 'text-[var(--kx-text)] hover:text-white' : 'text-[var(--kx-faint)] cursor-default'}`}
                    >
                      <span className="truncate">{media.length ? BULK_COPY.mediaCount(media.length) : BULK_COPY.notAdded}</span>
                      {media.length > 0 && (mediaOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
                    </button>
                    {!locked && (
                      <>
                    <button
                      type="button"
                      aria-label={media.length ? BULK_COPY.replaceMedia : BULK_COPY.addSlot(BULK_COPY.slot.media)}
                      title={media.length ? BULK_COPY.replaceMedia : BULK_COPY.addSlot(BULK_COPY.slot.media)}
                      onClick={() => mediaRef.current?.click()}
                      className={FILE_ICON}
                    >
                      {media.length ? <RefreshCw size={12} /> : <Upload size={12} />}
                    </button>
                    <button
                      type="button"
                      data-testid={`bulk-media-delete-${row.projectId}`}
                      aria-label={media.length ? BULK_COPY.deleteMedia : undefined}
                      title={media.length ? BULK_COPY.deleteMedia : undefined}
                      disabled={media.length === 0}
                      onClick={() => setConfirmMediaDelete(true)}
                      className={`${FILE_ICON} enabled:hover:text-[var(--kx-danger)] disabled:invisible`}
                    >
                      <X size={13} />
                    </button>
                      </>
                    )}
                  </li>
                  {mediaOpen && media.length > 0 && (
                    <li className="mx-3 mb-1 max-h-56 overflow-y-auto custom-scrollbar rounded-md border border-[var(--kx-line)]">
                      <ul>
                        {media.map(f => (
                          <li key={f.id} className="flex items-center gap-2 pl-3 pr-1 py-0.5 text-[12px]">
                            <span className="flex-1 min-w-0 truncate text-[var(--kx-muted)]">{f.name}</span>
                            {!locked && (
                            <button
                              type="button"
                              aria-label={BULK_COPY.removeFile(f.name)}
                              title={BULK_COPY.removeFile(f.name)}
                              onClick={() => onRemoveFile(f.id)}
                              className={`${FILE_ICON} hover:text-[var(--kx-danger)]`}
                            >
                              <X size={12} />
                            </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  )}
                </>
              );
            })()}
          </ul>
          {!locked && (
          <div className="px-3 pt-1.5 pb-1 border-t border-[var(--kx-line)] mt-1 flex items-center justify-end gap-4">
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
              className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-[var(--kx-danger)] transition-colors"
            >
              <Trash2 size={12} />
              {BULK_COPY.clearFiles}
            </button>
          </div>
          )}
        </div>
      )}

      {/* Row 3 — ONE fixed-height message line (status, then any problems;
          the arrows step through them), Retry / Cancel, the bin in the corner. */}
      <div className="mt-3 pt-2.5 border-t border-[var(--kx-line)] flex items-center gap-2 h-[38px] relative">
        <button
          type="button"
          data-testid={`bulk-status-${row.projectId}`}
          role="button"
          title={current.text}
          onClick={() => { if (current.text) setStatusOpen(o => !o); }}
          className={`flex-1 min-w-0 truncate text-left text-[12px] leading-snug ${current.warn ? 'text-amber-300/90' : dim ? 'text-[var(--kx-faint)]' : 'text-[var(--kx-muted)]'}`}
        >
          {current.text}
        </button>
        {statusOpen && current.text && (
          <div
            data-testid={`bulk-status-pop-${row.projectId}`}
            className="absolute left-0 right-12 bottom-[42px] z-20 rounded-lg border border-[var(--kx-line-2)] bg-[var(--kx-surface-2)] px-3 py-2 text-[12px] text-[var(--kx-text)] shadow-2xl"
          >
            <p className="whitespace-pre-wrap break-words">{quiet || current.text}</p>
            {cost ? <p className="mt-1 text-[var(--kx-muted)]">{cost}</p> : null}
            {record?.billingAttempts && record.billingAttempts.length > 1 ? (
              <ul className="mt-1 text-[11px] text-[var(--kx-faint)]" data-testid={`bulk-cost-attempts-${row.projectId}`}>
                {record.billingAttempts.map((a, i) => (
                  <li key={`${a.at}-${i}`}>{`Attempt ${i + 1}: ${cloudCostLine(a.workerSec)}`}</li>
                ))}
              </ul>
            ) : null}
            {record?.phase ? <p className="mt-1 text-[11px] text-[var(--kx-faint)]">{status || record.phase}</p> : null}
          </div>
        )}
        {failedish && (
          <button type="button" data-testid={`bulk-retry-${row.projectId}`} className={ROW_BTN_SM} onClick={onRetry}>
            {BULK_COPY.retry}
          </button>
        )}
        {running && (
          <button type="button" data-testid={`bulk-cancel-${row.projectId}`} className={ROW_BTN_SM} onClick={onCancel}>
            {BULK_COPY.cancelRow}
          </button>
        )}
        {messages.length > 1 && (
          <div className="flex-shrink-0 flex items-center" data-testid={`bulk-msgs-${row.projectId}`}>
            <button type="button" aria-label={BULK_COPY.prevMessage} title={BULK_COPY.prevMessage} onClick={() => setMsgIdx(i => (i - 1 + messages.length) % messages.length)} className={MSG_ARROW}>
              <ChevronLeft size={13} />
            </button>
            <span className="w-7 text-center text-[10px] tabular-nums text-[var(--kx-faint)]">{`${shown + 1}/${messages.length}`}</span>
            <button type="button" aria-label={BULK_COPY.nextMessage} title={BULK_COPY.nextMessage} onClick={() => setMsgIdx(i => (i + 1) % messages.length)} className={MSG_ARROW}>
              <ChevronRight size={13} />
            </button>
          </div>
        )}
        <button
          type="button"
          aria-label={BULK_COPY.removeProject}
          title={BULK_COPY.removeProject}
          data-testid={`bulk-remove-${row.projectId}`}
          onClick={onRemoveRow}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-[var(--kx-faint)] hover:text-[var(--kx-danger)] hover:bg-[var(--kx-hover)] transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {confirmMediaDelete && (
        <ConfirmDialog
          title={BULK_COPY.deleteMediaTitle}
          body={BULK_COPY.deleteMediaBody(row.mediaCount)}
          confirmLabel={BULK_COPY.deleteRowConfirm}
          onCancel={() => setConfirmMediaDelete(false)}
          onConfirm={() => { setConfirmMediaDelete(false); setMediaOpen(false); onRemoveMedia(); }}
        />
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
      <input
        ref={mediaRef}
        type="file"
        multiple
        hidden
        onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length > 0) onReplaceMedia(files); }}
      />
    </li>
  );
}

export function BulkProjectsModal({
  createBlankProject, parseProjectData, onOpenProject, onFinishRow, onClose, onProjectsCreated,
  runner: injectedRunner, queue = cloudSyncQueue, store: injected, hidden = false, docked = false,
  deleteProject = deleteProjectEverywhere, onProjectsDeleted,
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
  /** Docked as the dashboard's left column (no shadow; the dashboard moves over). */
  docked?: boolean;
  /** Deletes a created project everywhere (default: the dashboard's own delete). */
  deleteProject?: (id: string) => Promise<string[]>;
  /** A row's project was deleted: the dashboard and editor let go of it. */
  onProjectsDeleted?: (ids: string[], failures: string[]) => void;
}): React.ReactElement {
  const runner = useMemo(() => injectedRunner ?? bulkBatchRunner(parseProjectData), [injectedRunner, parseProjectData]);
  const [store, setStore] = useState<BulkRowStore | null>(injected ?? null);
  useEffect(() => {
    if (injected) return;
    let live = true;
    void defaultBulkRowDeps(createBlankProject).then(deps => {
      if (!live) return;
      const created = new BulkRowStore(deps, BULK_MAX_GROUPS * BULK_GROUP_MAX_ROWS);
      void created.hydrate();
      setStore(created);
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
  // 1.3.1 — a group is created inline (a 2–30 field and "Create Group"),
  // never through a popup and never from the dashboard.
  const [countRaw, setCountRaw] = useState('');
  const count = parseBulkCount(countRaw, BULK_MAX_PROJECTS, BULK_MIN_PROJECTS);
  const createGroup = (): void => {
    if (!store || count === null || !runner.canCreateGroup()) return;
    const ids = store.createDrafts(count);
    if (!runner.createGroup(ids)) { void Promise.all(ids.map(id => store.discardRow(id))); return; }
    setCountRaw('');
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
  const isComplete = (r: BulkRowState): boolean => !r.built && r.typedName.trim().length > 0 && missingSpineSlots(r.slots).length === 0;
  const line = bulkFooterLine(records, queue.batchLine());

  const rowById = new Map(rows.map(r => [r.projectId, r]));
  // Every row belongs to a group (each group carries the Build Timeline): a
  // draft found outside one (saved before groups, or seeded) is adopted.
  const looseKey = rows.filter(r => !r.built && !groups.some(g => g.rowIds.includes(r.projectId))).map(r => r.projectId).join('|');
  useEffect(() => { if (looseKey) runner.adoptRows(looseKey.split('|')); }, [looseKey, runner]);
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
      onReplaceMedia={files => void store?.replaceMedia(row.projectId, files)}
      onRemoveMedia={() => void store?.removeMedia(row.projectId)}
      onClearFiles={() => void store?.clearFiles(row.projectId)}
      onRemoveRow={() => setConfirmDelete(row)}
      onCancel={() => runner.cancel(row.projectId)}
      onOpen={() => open(row.projectId)}
      onFinish={() => finishRow(row.projectId)}
      onRebuild={() => { runner.rebuildFromCache(row.projectId); }}
      onRetry={() => runner.retry(row.projectId)}
    />
  );

  const build = (groupRowIds: readonly string[]): void => {
    void (async () => {
      if (!store) return;
      // Only now do projects exist — for this group's rows. Every other row stays a draft.
      const { created, skips: left } = await store.buildReady(groupRowIds);
      setSkips(prev => {
        const next = { ...prev };
        for (const id of groupRowIds) delete next[id];
        return { ...next, ...left };
      });
      if (created.length === 0) return;
      onProjectsCreated?.();
      runner.start(created.map(c => ({ ...c, summary: store.summaryOf(c.id) })));
    })();
  };

  // U5 — nothing clears by itself: hiding, opening or finishing keeps every draft.
  const close = (): void => onClose();
  const open = (id: string): void => onOpenProject(id);
  const finishRow = (id: string): void => {
    if (onFinishRow) onFinishRow(id);
    else if (!runner.finishNow(id)) onOpenProject(id);
  };

  // U5 — per-row delete, behind a confirm: the row's record, its files, and
  // (once created) the project they belong to.
  const [confirmDelete, setConfirmDelete] = useState<BulkRowState | null>(null);
  const deleteRow = async (row: BulkRowState): Promise<void> => {
    setConfirmDelete(null);
    if (row.built) {
      runner.removeRow(row.projectId);
      store?.forgetRow(row.projectId);
      const failures = await deleteProject(row.projectId);
      onProjectsDeleted?.([row.projectId], failures);
    } else {
      await store?.discardRow(row.projectId);
      runner.removeRow(row.projectId);
    }
  };

  // First open slides in too: one painted frame off-screen, then the slide.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setEntered(true)); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, []);
  const off = hidden || !entered;

  return (
    <div
      className={`${DRAWER} ${docked ? '' : DRAWER_FLOAT} ${off ? '-translate-x-full pointer-events-none' : ''}`}
      style={{ ...DRAWER_PALETTE, ...DRAWER_MOTION }}
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
        <div className="px-6 pt-6 pb-5 flex-shrink-0 border-b border-[var(--kx-line)] bg-[var(--kx-panel)]">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2.5 text-sm font-black uppercase tracking-[0.2em] text-[var(--kx-text)]">
              <span aria-hidden="true" className="h-4 w-1 rounded-full bg-[var(--kx-accent)]" />
              {BULK_COPY.modalTitle}
            </h2>
            <div className="flex items-center gap-2">
              {records.some(r => r.phase === 'queued' || r.phase === 'cloud') && (
                <button
                  type="button"
                  data-testid="bulk-stop-all"
                  onClick={() => { void runner.stopAllCloudWork(() => killAllMemberCloudJobs()); }}
                  className="flex-shrink-0 h-8 px-3 rounded-lg border border-[var(--kx-line-2)] text-[11px] font-semibold text-[var(--kx-text)] hover:text-white hover:bg-[var(--kx-hover)] transition-colors"
                >
                  {BULK_COPY.stopAll}
                </button>
              )}
              <button
                type="button"
                aria-label={BULK_COPY.close}
                data-testid="bulk-close"
              onClick={close}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--kx-muted)] hover:text-white hover:bg-[var(--kx-hover)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--kx-accent-line)]"
            >
              <X size={16} />
            </button>
            </div>
          </div>
          <div className="mt-5">
            <span data-testid="bulk-create-heading" className={LABEL}>{BULK_COPY.newGroup}</span>
            <form
              className="flex items-center gap-2"
              onSubmit={e => { e.preventDefault(); createGroup(); }}
            >
              <input
                data-testid="bulk-create-count"
                type="number"
                inputMode="numeric"
                min={BULK_MIN_PROJECTS}
                max={BULK_MAX_PROJECTS}
                step={1}
                aria-label={BULK_COPY.groupCountLabel}
                placeholder={BULK_COPY.groupCountPlaceholder}
                value={countRaw}
                disabled={!runner.canCreateGroup()}
                onChange={e => setCountRaw(e.target.value)}
                className={`${FIELD} w-full min-w-0 flex-1 h-10 px-3 text-[13px]`}
              />
              <button
                type="submit"
                data-testid="bulk-create"
                className={`${BTN_PRIMARY} flex-none h-10 px-5 py-0 flex items-center gap-1.5`}
                disabled={!store || count === null || !runner.canCreateGroup()}
              >
                {BULK_COPY.createGroup}
              </button>
            </form>
            {!runner.canCreateGroup() ? (
              <p className="mt-2 text-[11px] leading-snug text-gray-500">{BULK_COPY.groupsFull(BULK_MAX_GROUPS)}</p>
            ) : countRaw.trim() !== '' && count === null ? (
              <p className="mt-2 text-[11px] leading-snug text-amber-300">{BULK_COPY.quantityInvalid(BULK_MAX_PROJECTS)}</p>
            ) : null}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-5 space-y-4" data-testid="bulk-groups">
          {groups.length === 0 && rows.length === 0 && (
            <p data-testid="bulk-empty" className="rounded-2xl border border-dashed border-[var(--kx-line-2)] px-4 py-8 text-center text-[12px] leading-snug text-[var(--kx-muted)]">{BULK_COPY.emptyDrawer}</p>
          )}
          {groups.map(group => {
            const members = group.rowIds.map(id => rowById.get(id)).filter((r): r is BulkRowState => !!r);
            return (
              <section
                key={group.id}
                data-testid={`bulk-group-section-${group.id}`}
                className="rounded-2xl border border-[var(--kx-line-2)] bg-[var(--kx-panel)] shadow-[0_1px_0_rgba(255,255,255,.03)_inset]"
              >
                <div className={`px-4 ${group.collapsed ? '' : 'border-b border-[var(--kx-line)]'}`}>
                <BulkGroupHeader
                  group={group}
                  progress={groupProgress(group, records)}
                  onToggle={() => runner.setCollapsed(group.id, !group.collapsed)}
                  onRename={name => runner.renameGroup(group.id, name)}
                >
                  {group.rowIds.some(id => { const p = recordById.get(id)?.phase; return p === 'queued' || p === 'cloud'; }) && (
                    <button
                      type="button"
                      data-testid={`bulk-cancel-group-${group.id}`}
                      onClick={() => runner.cancelGroup(group.id)}
                      className="flex-shrink-0 text-[11px] text-gray-400 hover:text-white transition-colors"
                    >
                      {BULK_COPY.cancelAll}
                    </button>
                  )}
                  {group.rowIds.some(id => { const p = recordById.get(id)?.phase; return p !== undefined && isBatchRowFinal(p); }) && (
                    <button
                      type="button"
                      data-testid={`bulk-clear-finished-${group.id}`}
                      onClick={() => runner.clearFinished(group.id)}
                      className="flex-shrink-0 text-[11px] text-gray-400 hover:text-white transition-colors"
                    >
                      {BULK_COPY.clearFinished}
                    </button>
                  )}
                </BulkGroupHeader>
                </div>
                {!group.collapsed && (
                  <div className="p-3">
                    <ol className="space-y-2.5">{members.map(renderRow)}</ol>
                    <div className="mt-3 px-1 flex items-center gap-3">
                      <button
                        type="button"
                        data-testid={`bulk-add-${group.id}`}
                        className="flex items-center gap-1.5 h-8 px-2 rounded-md text-[12px] font-semibold text-[var(--kx-muted)] hover:text-white hover:bg-[var(--kx-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={group.rowIds.length >= BULK_GROUP_MAX_ROWS}
                        title={group.rowIds.length >= BULK_GROUP_MAX_ROWS ? `Up to ${BULK_GROUP_MAX_ROWS} projects in a group` : undefined}
                        onClick={() => addToGroup(group.id)}
                      >
                        <Plus size={12} />
                        {BULK_COPY.addProject}
                      </button>
                      <div className="flex-1" />
                      <button
                        type="button"
                        data-testid={`bulk-build-${group.id}`}
                        className={`${BTN_BUILD} flex-none px-5 py-2.5`}
                        disabled={!cloud || !members.some(isComplete)}
                        title={!cloud ? BULK_COPY.notCloud : !members.some(isComplete) ? BULK_COPY.buildNeeds : undefined}
                        onClick={() => build(group.rowIds)}
                      >
                        {BULK_COPY.build}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
          {loose.length > 0 && <ol className="space-y-3">{loose.map(renderRow)}</ol>}
        </div>
        <div className="px-6 pt-3 pb-5 flex-shrink-0 border-t border-[var(--kx-line)] bg-[var(--kx-panel)]" data-testid="bulk-footer">
          {line && <p className="text-[11px] leading-snug text-gray-400 mb-1" data-testid="bulk-batch-line">{line}</p>}
          {!cloud && <p className="text-[11px] leading-snug text-amber-300/90 mb-1">{BULK_COPY.notCloud}</p>}
          <p className="text-[11px] leading-snug text-[var(--kx-faint)]">{BULK_COPY.footerNote}</p>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={BULK_COPY.deleteRowTitle}
          body={BULK_COPY.deleteRowBody(confirmDelete.typedName.trim(), confirmDelete.built)}
          confirmLabel={BULK_COPY.deleteRowConfirm}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { const row = confirmDelete; setConfirmDelete(null); void deleteRow(row); }}
        />
      )}
    </div>
  );
}

const EMPTY_ROWS: readonly BulkRowState[] = [];
