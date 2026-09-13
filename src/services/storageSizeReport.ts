/**
 * Narrow injected surface for the storage size report.
 *
 * The presentation layer (`StorageSizeReport`, `LowDiskPreflightDialog`)
 * never talks to Tauri and never invents a row. CC owns the real 13-row
 * data source on `ws3-storage-unified` (Round 24a). This module is the
 * TypeScript contract both lanes agree on.
 *
 * Command name the Tauri adapter will bind (documented here so both lanes
 * agree; this file itself never calls it):
 *
 *   storage_size_report  () → StorageSizeSnapshot
 */

export type StorageSweepClass = 'reclaimable' | 'protected' | 'never-reclaimable';

/**
 * One line of the storage report. Every field is owned by the data source.
 * Presentation must not derive path, label, bytes, or classification.
 */
export interface StorageSizeRow {
  path: string;
  label: string;
  currentBytes: number;
  reclaimableBytes: number;
  sweepClass: StorageSweepClass;
}

/**
 * Payload the UI renders. `totalReclaimableBytes` is owned by the source
 * so the summary cannot silently re-sum the rows.
 */
export interface StorageSizeSnapshot {
  rows: readonly StorageSizeRow[];
  totalReclaimableBytes: number;
}

export interface StorageSizeReportSource {
  load(): Promise<StorageSizeSnapshot>;
}

/**
 * Production adapter. `invoke` is passed in so this module never imports
 * `@tauri-apps`. CC substitutes the real `invoke`; the command name stays.
 */
export function createInvokeStorageSizeReportSource(
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
): StorageSizeReportSource {
  return {
    async load(): Promise<StorageSizeSnapshot> {
      return invoke<StorageSizeSnapshot>('storage_size_report');
    },
  };
}

/** True when a row's reclaimable figure exceeds what it currently occupies. */
export function isReclaimableExceedsCurrent(row: StorageSizeRow): boolean {
  return row.reclaimableBytes > row.currentBytes;
}

export function isNeverReclaimable(row: StorageSizeRow): boolean {
  return row.sweepClass === 'never-reclaimable';
}

export function isProtectedSweepClass(sweepClass: StorageSweepClass): boolean {
  return sweepClass === 'protected' || sweepClass === 'never-reclaimable';
}
