/**
 * Storage size report — presentation only.
 *
 * Renders a `StorageSizeSnapshot` from `StorageSizeReportSource`. Does not
 * invent rows, does not re-sum `totalReclaimableBytes`, and does not offer
 * a delete/reclaim control on `never-reclaimable` rows (Whisper models).
 * A row with reclaimableBytes > currentBytes is surfaced, not clamped.
 */

import React from 'react';
import { formatBytes } from '../services/webcodecsExport/diskFull';
import {
  isNeverReclaimable,
  isProtectedSweepClass,
  isReclaimableExceedsCurrent,
  type StorageSizeRow,
  type StorageSizeSnapshot,
} from '../services/storageSizeReport';

export interface StorageSizeReportProps {
  snapshot: StorageSizeSnapshot;
  /** Fired only for `sweepClass === 'reclaimable'` rows. Never for models. */
  onReclaimRow?: (row: StorageSizeRow) => void;
}

export function StorageSizeReport({
  snapshot,
  onReclaimRow,
}: StorageSizeReportProps): React.ReactElement {
  const { rows, totalReclaimableBytes } = snapshot;

  if (rows.length === 0) {
    return (
      <div data-testid="storage-size-report" className="space-y-3">
        <p data-testid="storage-empty" className="text-[11px] text-gray-500">
          No storage entries to show.
        </p>
      </div>
    );
  }

  const reclaimableRows = rows.filter((row) => row.sweepClass === 'reclaimable');
  const protectedRows = rows.filter((row) => isProtectedSweepClass(row.sweepClass));
  const violations = rows.filter(isReclaimableExceedsCurrent);

  return (
    <div data-testid="storage-size-report" className="space-y-4">
      <div
        data-testid="storage-total-reclaimable"
        className="flex items-center justify-between bg-[#1A1A1A] border border-[#282828] rounded-lg px-3 py-2"
      >
        <span className="text-[8px] uppercase tracking-widest text-gray-600">
          Total reclaimable
        </span>
        <span className="text-[11px] font-black tracking-wide text-gray-200">
          {formatBytes(totalReclaimableBytes)}
        </span>
      </div>

      {violations.length > 0 && (
        <div
          data-testid="storage-invariant-violation"
          role="alert"
          className="border border-red-500/40 bg-red-500/10 rounded-lg px-3 py-2 space-y-1"
        >
          <p className="text-[9px] font-black uppercase tracking-widest text-red-400">
            Reclaimable bytes exceed current bytes
          </p>
          {violations.map((row) => (
            <p
              key={row.path}
              data-testid="storage-invariant-violation-row"
              data-path={row.path}
              className="text-[10px] text-red-300"
            >
              {row.label}: reclaimable {formatBytes(row.reclaimableBytes)}{' '}
              &gt; current {formatBytes(row.currentBytes)}
            </p>
          ))}
        </div>
      )}

      <section data-testid="storage-group-reclaimable" className="space-y-2">
        <h3 className="text-[8px] uppercase tracking-widest text-gray-600">Reclaimable</h3>
        {reclaimableRows.length === 0 ? (
          <p className="text-[10px] text-gray-600">None</p>
        ) : (
          reclaimableRows.map((row) => (
            <StorageSizeRowView
              key={row.path}
              row={row}
              onReclaim={onReclaimRow}
            />
          ))
        )}
      </section>

      <section data-testid="storage-group-protected" className="space-y-2">
        <h3 className="text-[8px] uppercase tracking-widest text-gray-600">Protected</h3>
        {protectedRows.length === 0 ? (
          <p className="text-[10px] text-gray-600">None</p>
        ) : (
          protectedRows.map((row) => (
            <StorageSizeRowView key={row.path} row={row} />
          ))
        )}
      </section>
    </div>
  );
}

function StorageSizeRowView({
  row,
  onReclaim,
}: {
  row: StorageSizeRow;
  onReclaim?: (row: StorageSizeRow) => void;
}): React.ReactElement {
  const never = isNeverReclaimable(row);
  const canReclaim = row.sweepClass === 'reclaimable' && onReclaim !== undefined;
  return (
    <div
      data-testid="storage-row"
      data-path={row.path}
      data-sweep-class={row.sweepClass}
      className="flex items-center justify-between gap-3 bg-[#1A1A1A] border border-[#282828] rounded-lg px-3 py-2"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-bold text-gray-200 truncate">{row.label}</p>
        <p className="text-[9px] text-gray-600 truncate" title={row.path}>{row.path}</p>
        <p className="text-[9px] text-gray-500">
          {formatBytes(row.currentBytes)}
          {row.reclaimableBytes > 0 ? ` · ${formatBytes(row.reclaimableBytes)} reclaimable` : ''}
        </p>
      </div>
      {canReclaim && !never && (
        <button
          type="button"
          data-testid="storage-row-reclaim"
          onClick={() => onReclaim(row)}
          className="shrink-0 px-2 py-1 text-[9px] font-black uppercase tracking-widest border border-[#282828] rounded-lg text-gray-300 hover:text-white hover:border-gray-500"
        >
          Reclaim
        </button>
      )}
    </div>
  );
}
