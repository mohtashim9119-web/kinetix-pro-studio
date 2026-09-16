/**
 * App Settings — storage root status, size report, relocation, and reclaim.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { isTauri } from '../services/tauriFfmpeg';
import {
  cleanupAllStaleRoots,
  getSizeReport,
  getStorageRootStatus,
  type SizeReportRow,
  type StorageRootStatus,
} from '../services/storageRoot';
import { formatBytes } from '../services/webcodecsExport/diskFull';
import { invoke } from '@tauri-apps/api/core';

const HAIRLINE = 'pt-6 mt-6 border-t border-white/[0.06]';
const BLOCK_TITLE = 'text-[9px] font-black uppercase tracking-widest text-[#F27D26]';

export interface StorageSettingsSectionProps {
  /**
   * WS3 Batch 2 (STEP 3, 3A) — "Move storage root…" no longer picks a
   * folder and relocates inline; it hands off to the parent, which mounts
   * `StorageRootRelocationView` (a full-screen modal, App.tsx-level, same
   * as every other top-level overlay) so the operator sees current root /
   * target / required / available BEFORE anything is copied, instead of a
   * native folder picker appearing with zero context.
   */
  onOpenRelocation: () => void;
  /**
   * Bumped by the parent after a relocation actually completes, so this
   * section's own status/size-report re-fetch without a page reload —
   * `refresh` below is otherwise only triggered by this component's own
   * mount effect.
   */
  refreshSignal?: number;
}

export function StorageSettingsSection({ onOpenRelocation, refreshSignal }: StorageSettingsSectionProps): React.ReactElement {
  const [status, setStatus] = useState<StorageRootStatus | null>(null);
  const [rows, setRows] = useState<SizeReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reclaimBusy, setReclaimBusy] = useState(false);
  const [cleanupAllBusy, setCleanupAllBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!isTauri()) return;
    try {
      const [s, r] = await Promise.all([getStorageRootStatus(), getSizeReport()]);
      setStatus(s);
      setRows(r);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshSignal]);

  if (!isTauri()) {
    return (
      <section data-testid="app-settings-block-storage" className={HAIRLINE}>
        <p className={BLOCK_TITLE}>Storage</p>
        <p className="text-[9px] text-gray-600 mt-2">Available in the desktop app only.</p>
      </section>
    );
  }

  // Stale-root fix (WS3 Round 29) — 'stale-root' rows are deliberately
  // excluded here: the generic "Free up cached data" button below
  // (`storage_root_reclaim`) cannot free them, only "Clean up all stale
  // storage locations" can — folding them in would make this button's
  // advertised total include bytes it can't actually reclaim.
  const totalReclaimable = rows
    .filter((row) => row.sweepClassification === 'reclaimable')
    .reduce((sum, row) => sum + row.reclaimableBytes, 0);
  // Resume/no-auto-delete fix (WS3 Round 29, operator decision) — can be
  // more than one location (a completed relocation's old root AND/OR any
  // number of failed/cancelled relocations' abandoned targets, accumulated
  // across as many hops as the operator makes) — summed into ONE row and
  // cleaned up by ONE button, per an explicit "just add up, one cleanup
  // deletes everything" operator decision, rather than a button per folder.
  const staleRootRows = rows.filter((row) => row.sweepClassification === 'stale-root');
  const staleRootTotalBytes = staleRootRows.reduce((sum, row) => sum + row.currentBytes, 0);
  const staleRootPaths = staleRootRows.map((row) => row.path);

  return (
    <section data-testid="app-settings-block-storage" className={HAIRLINE}>
      <p className={BLOCK_TITLE}>Storage</p>
      <p className="text-[9px] text-gray-600 mt-1 mb-3">
        Project assets and downloaded models are never reclaimable — only cache and aged backups can be cleared.
      </p>

      {error && <p className="text-[9px] text-red-400 mb-2">{error}</p>}

      {status && (
        <dl className="space-y-2 mb-4">
          <div>
            <dt className="text-[8px] uppercase tracking-widest text-gray-600">Current root</dt>
            <dd className="text-[10px] text-gray-300 break-all">{status.currentRoot}</dd>
          </div>
          {status.managedBytes !== null && (
            <div>
              <dt className="text-[8px] uppercase tracking-widest text-gray-600">Managed data</dt>
              <dd className="text-[10px] text-gray-300">{formatBytes(status.managedBytes)}</dd>
            </div>
          )}
        </dl>
      )}

      {rows.length > 0 && (
        <div className="space-y-2 mb-4" data-testid="storage-size-report">
          {rows
            .filter((row) => row.sweepClassification !== 'stale-root')
            .map((row) => (
              <button
                key={row.path}
                type="button"
                data-testid={`storage-size-row-${row.label}`}
                title={row.path}
                onClick={() => {
                  void invoke('reveal_in_finder', { path: row.path }).catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                  });
                }}
                className="w-full flex items-center justify-between text-[10px] text-left hover:bg-white/[0.04] rounded-md px-1 -mx-1 py-0.5 transition-colors"
              >
                <span className="text-gray-400">{row.label}</span>
                <span className="text-gray-200 font-bold">
                  {formatBytes(row.currentBytes)}
                  {row.sweepClassification === 'reclaimable' && row.reclaimableBytes > 0 && (
                    <span className="text-gray-500 font-normal ml-1">
                      ({formatBytes(row.reclaimableBytes)} reclaimable)
                    </span>
                  )}
                </span>
              </button>
            ))}
          {/* Resume/no-auto-delete fix (WS3 Round 29, operator decision) —
              one aggregated row summing every stale location this app
              knows about, however many hops accumulated it — see the
              cleanup button below for why this is deliberately ONE row,
              not one per folder. */}
          {staleRootRows.length > 0 && (
            <button
              type="button"
              data-testid="storage-size-row-stale-root"
              title={staleRootPaths.join('\n')}
              onClick={() => {
                void invoke('reveal_in_finder', { path: staleRootPaths[0] }).catch((err) => {
                  setError(err instanceof Error ? err.message : String(err));
                });
              }}
              className="w-full flex items-center justify-between text-[10px] text-left hover:bg-white/[0.04] rounded-md px-1 -mx-1 py-0.5 transition-colors"
            >
              <span className="text-gray-400">
                Stale root{staleRootRows.length > 1 ? ` (${staleRootRows.length} locations)` : ''}
              </span>
              <span className="text-gray-200 font-bold">{formatBytes(staleRootTotalBytes)}</span>
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          data-testid="storage-relocate-open"
          onClick={onOpenRelocation}
          className="w-full bg-transparent border border-[#282828] p-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-white hover:border-gray-500 transition-all disabled:opacity-40"
        >
          Move storage root…
        </button>
        {totalReclaimable > 0 && (
          <button
            type="button"
            data-testid="storage-reclaim"
            disabled={reclaimBusy}
            onClick={() => {
              void (async () => {
                setReclaimBusy(true);
                try {
                  await invoke<number>('storage_root_reclaim');
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setReclaimBusy(false);
                }
              })();
            }}
            className="w-full bg-[#F27D26] text-white p-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all disabled:opacity-40"
          >
            Free up cached data
          </button>
        )}
        {staleRootRows.length > 0 && (
          <button
            type="button"
            data-testid="storage-cleanup-all-stale-roots"
            disabled={cleanupAllBusy}
            title={staleRootPaths.join('\n')}
            onClick={() => {
              void (async () => {
                setCleanupAllBusy(true);
                try {
                  await cleanupAllStaleRoots();
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setCleanupAllBusy(false);
                }
              })();
            }}
            className="w-full bg-[#F27D26] text-white p-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all disabled:opacity-40"
          >
            Clean up all stale storage locations
          </button>
        )}
      </div>
    </section>
  );
}
