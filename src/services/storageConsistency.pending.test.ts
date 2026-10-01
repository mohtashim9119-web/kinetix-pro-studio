/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// 1.3.0 — the storage scan is told which ids are unbuilt bulk rows, so their
// staged media reads as a normal row, not leftover data.

import { describe, it, expect, vi } from 'vitest';

const invoke = vi.fn(async () => ({ findings: [], totalBytes: 0, idsExamined: 0 }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));
vi.mock('./projectStore', () => ({ loadAllMetas: () => [{ id: 'p1' }], deletedProjectIds: () => new Set(['gone']) }));
vi.mock('./bulkBatch', () => ({ unbuiltBulkRowIds: () => ['draft-1'] }));

const { scanStorageConsistency } = await import('./storageConsistency');

describe('scanStorageConsistency', () => {
  it('passes the unbuilt bulk row ids as pendingIds', async () => {
    await scanStorageConsistency();
    expect(invoke).toHaveBeenCalledWith('storage_consistency_scan', {
      dashboardIds: ['p1'], deletedIds: ['gone'], pendingIds: ['draft-1'],
    });
  });
});
