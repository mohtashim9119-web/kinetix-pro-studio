/**
 * App Settings — storage root status, size report, relocation, and reclaim.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { isTauri } from '../services/tauriFfmpeg';
import {
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

  const totalReclaimable = rows.reduce((sum, row) => sum + row.reclaimableBytes, 0);

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
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between text-[10px]">
              <span className="text-gray-400">{row.label}</span>
              <span className="text-gray-200 font-bold">
                {formatBytes(row.currentBytes)}
                {row.sweepClassification === 'reclaimable' && row.reclaimableBytes > 0 && (
                  <span className="text-gray-500 font-normal ml-1">
                    ({formatBytes(row.reclaimableBytes)} reclaimable)
                  </span>
                )}
              </span>
            </div>
          ))}
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
            className="w-full bg-[#F27D26] text-black p-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all disabled:opacity-40"
          >
            Reclaim {formatBytes(totalReclaimable)}
          </button>
        )}
      </div>
    </section>
  );
}
