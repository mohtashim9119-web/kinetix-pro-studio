/**
 * In-memory fake for `StorageSizeReportSource`.
 *
 * CC replaces `invoke` with the real Tauri `storage_size_report` command.
 * This module never imports `@tauri-apps` and never talks to Rust. It never
 * invents a row: whatever snapshot the caller injects is what `load` returns,
 * including a total that need not equal the sum of row.reclaimableBytes.
 *
 * Command name (must stay byte-identical to `createInvokeStorageSizeReportSource`):
 *   storage_size_report
 */

import {
  createInvokeStorageSizeReportSource,
  type StorageSizeReportSource,
  type StorageSizeSnapshot,
} from './storageSizeReport';

export const STORAGE_SIZE_REPORT = 'storage_size_report';

export interface StorageSizeReportFake {
  source: StorageSizeReportSource;
  /**
   * Same-command `invoke` `createInvokeStorageSizeReportSource` already binds.
   * Round 24a: CC substitutes the real `invoke` and leaves the adapter.
   */
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  adapted: StorageSizeReportSource;
  setSnapshot(snapshot: StorageSizeSnapshot): void;
}

const EMPTY: StorageSizeSnapshot = { rows: [], totalReclaimableBytes: 0 };

export function createStorageSizeReportFake(
  initial: StorageSizeSnapshot = EMPTY,
): StorageSizeReportFake {
  let snapshot: StorageSizeSnapshot = {
    rows: initial.rows.slice(),
    totalReclaimableBytes: initial.totalReclaimableBytes,
  };

  const source: StorageSizeReportSource = {
    async load(): Promise<StorageSizeSnapshot> {
      return {
        rows: snapshot.rows.slice(),
        totalReclaimableBytes: snapshot.totalReclaimableBytes,
      };
    },
  };

  const invoke = async <T>(cmd: string, _args?: Record<string, unknown>): Promise<T> => {
    if (cmd === STORAGE_SIZE_REPORT) {
      return source.load() as Promise<T>;
    }
    throw new Error(`StorageSizeReport fake: unknown command ${cmd}`);
  };

  return {
    source,
    invoke,
    adapted: createInvokeStorageSizeReportSource(invoke),
    setSnapshot(next: StorageSizeSnapshot): void {
      snapshot = {
        rows: next.rows.slice(),
        totalReclaimableBytes: next.totalReclaimableBytes,
      };
    },
  };
}
