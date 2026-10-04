/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The per-project cost + time ledger in a bulk row: a credits icon beside the
// bin and a small popover (same discipline as the log-title popover). Display
// only — it reads the ledger and the row's billing record, nothing else.

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronRight, Coins } from 'lucide-react';
import { projectCostLedger } from '../services/projectCostLedgerShared';
import { LEDGER_STAGE_LABEL, summarizeLedger, type StageSummary } from '../services/projectCostLedger';
import { CLOUD_USD_PER_WORKER_SEC } from '../services/cloudQueueJob';
import { formatUsd } from '../services/syncQueue';

// One ledger popover open at a time, across rows.
let openId: string | null = null;
const openListeners = new Set<() => void>();
export function setLedgerOpen(id: string | null): void {
  if (openId === id) return;
  openId = id;
  for (const l of openListeners) l();
}
const subscribeOpen = (l: () => void): (() => void) => { openListeners.add(l); return () => { openListeners.delete(l); }; };
const readOpen = (): string | null => openId;

export const formatLedgerTime = (sec: number): string =>
  sec < 60 ? `${sec.toFixed(sec < 10 && sec > 0 ? 1 : 0)} s` : `${Math.floor(sec / 60)} m ${Math.round(sec % 60)} s`;

function stageLine(s: StageSummary, built: boolean): { value: string; time: string } {
  if (!s.ran) return { value: s.stage === 'timeline' && !built ? 'not run' : '—', time: '' };
  if (s.cachedOnly) return { value: 'cached · $0', time: '' };
  return { value: s.stage === 'timeline' ? 'free' : formatUsd(s.usd), time: formatLedgerTime(s.sec) };
}

export function BulkCostLedger({
  projectId, billingAttempts, onOpen,
}: {
  projectId: string;
  billingAttempts: readonly { at: number; workerSec: number }[] | undefined;
  /** The row closes its own status popover when this one opens. */
  onOpen?: () => void;
}): React.ReactElement {
  const ledger = projectCostLedger();
  useSyncExternalStore(ledger.subscribe.bind(ledger), () => ledger.getVersion());
  const open = useSyncExternalStore(subscribeOpen, readOpen) === projectId;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const summary = summarizeLedger(ledger.get(projectId), billingAttempts, CLOUD_USD_PER_WORKER_SEC);
  const built = (ledger.get(projectId)?.entries ?? []).some(e => e.stage === 'timeline');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setLedgerOpen(null); };
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      if (!t?.closest?.(`[data-ledger-root="${projectId}"]`)) setLedgerOpen(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [open, projectId]);

  return (
    <>
      <button
        type="button"
        aria-label="Cost and time"
        title="Cost and time"
        data-testid={`bulk-ledger-${projectId}`}
        data-ledger-root={projectId}
        onClick={() => { setLedgerOpen(open ? null : projectId); if (!open) onOpen?.(); }}
        className="relative flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-[var(--kx-faint)] hover:text-white hover:bg-[var(--kx-hover)] transition-colors"
      >
        <Coins size={14} />
        {summary.paid ? <span data-testid={`bulk-ledger-dot-${projectId}`} className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--kx-accent)]" /> : null}
      </button>
      {open && (
        <div
          data-testid={`bulk-ledger-pop-${projectId}`}
          data-ledger-root={projectId}
          className="absolute right-0 bottom-[42px] z-20 w-[min(20rem,100%)] max-h-[60vh] overflow-y-auto rounded-lg border border-[var(--kx-line-2)] bg-[var(--kx-surface-2)] px-3 py-2 text-[12px] text-[var(--kx-text)] shadow-2xl"
        >
          <div className="flex items-baseline justify-between gap-2" data-testid={`bulk-ledger-total-${projectId}`}>
            <span className="font-medium">{formatUsd(summary.totalUsd)}</span>
            <span className="text-[var(--kx-muted)]">{summary.totalSec > 0 ? `${formatLedgerTime(summary.totalSec)} on this project` : 'no time recorded yet'}</span>
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {summary.stages.map(s => {
              const line = stageLine(s, built);
              const canExpand = s.attempts.length > 0;
              const isOpen = !!expanded[s.stage];
              return (
                <li key={s.stage} data-testid={`bulk-ledger-stage-${s.stage}-${projectId}`}>
                  <button
                    type="button"
                    disabled={!canExpand}
                    onClick={() => setExpanded(e => ({ ...e, [s.stage]: !e[s.stage] }))}
                    className="w-full flex items-center gap-1 text-left min-w-0 disabled:cursor-default"
                  >
                    {canExpand ? (isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : <span className="w-[11px]" />}
                    <span className="flex-1 min-w-0 truncate text-[var(--kx-muted)]">{LEDGER_STAGE_LABEL[s.stage]}</span>
                    <span className="tabular-nums">{line.value}</span>
                    <span className="w-14 text-right tabular-nums text-[var(--kx-faint)]">{line.time}</span>
                  </button>
                  {isOpen && (
                    <ul className="pl-4 text-[11px] text-[var(--kx-faint)]">
                      {s.attempts.map((a, i) => (
                        <li key={i} className="break-words">
                          {`Attempt ${a.attempt}: ${a.cached ? 'served from cache, $0' : `${s.stage === 'timeline' ? 'free' : formatUsd(a.usd)}, ${formatLedgerTime(a.sec)}${a.bootIncluded ? ' · includes cold boot' : ''}`}${a.note ? ` · ${a.note}` : ''}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {summary.legacy.length > 0 && (
            <div className="mt-1.5 text-[11px] text-[var(--kx-faint)]" data-testid={`bulk-ledger-legacy-${projectId}`}>
              <p>Earlier attempts (recorded before the ledger — total only, not split by stage):</p>
              {summary.legacy.map(l => <p key={l.attempt}>{`Attempt ${l.attempt}: ${formatUsd(l.usd)}, ${formatLedgerTime(l.sec)}`}</p>)}
            </div>
          )}
          {summary.stages.some(s => s.bootIncluded) && (
            <p className="mt-1.5 text-[11px] text-[var(--kx-faint)]">Cold-boot time is metered inside the stage that paid for it, not as a separate line.</p>
          )}
        </div>
      )}
    </>
  );
}
