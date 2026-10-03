/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BatchPhase, BatchRow, BulkGroup } from '../services/bulkBatch';

export const BULK_DRAWER_TAB_KEY = 'kinetix:bulk-drawer-tab:v1';

export type BulkDrawerTab = 'new' | 'failed-paused' | 'finished';

export const BULK_DRAWER_TABS: readonly { id: BulkDrawerTab; label: string }[] = [
  { id: 'new', label: 'NEW' },
  { id: 'failed-paused', label: 'FAILED-PAUSED' },
  { id: 'finished', label: 'FINISHED' },
];

const NEW_PHASES: ReadonlySet<BatchPhase> = new Set(['queued', 'cloud', 'finishing', 'cloud-done']);
const FAILED_PAUSED_PHASES: ReadonlySet<BatchPhase> = new Set(['failed', 'finish-failed', 'paused', 'cancelled']);
const FINISHED_PHASES: ReadonlySet<BatchPhase> = new Set(['done', 'skipped']);
const RETRY_ALL_PHASES: ReadonlySet<BatchPhase> = new Set(['failed', 'finish-failed', 'cancelled']);

/** Draft / never started (no record) and in-flight work live on NEW. */
export function bulkDrawerTabForPhase(phase: BatchPhase | undefined): BulkDrawerTab {
  if (phase === undefined || NEW_PHASES.has(phase)) return 'new';
  if (FAILED_PAUSED_PHASES.has(phase)) return 'failed-paused';
  if (FINISHED_PHASES.has(phase)) return 'finished';
  return 'new';
}

export function readBulkDrawerTab(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): BulkDrawerTab {
  try {
    const raw = storage?.getItem(BULK_DRAWER_TAB_KEY);
    if (raw === 'failed-paused' || raw === 'finished' || raw === 'new') return raw;
  } catch { /* ignore */ }
  return 'new';
}

export function writeBulkDrawerTab(
  tab: BulkDrawerTab,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
): void {
  try { storage?.setItem(BULK_DRAWER_TAB_KEY, tab); } catch { /* ignore */ }
}

/** Failed / finish-failed / cancelled only — paused rows wait for an answer. Group order, then FIFO within the group. */
export function collectRetryAllRowIds(groups: readonly BulkGroup[], records: readonly BatchRow[]): string[] {
  const byId = new Map(records.map(r => [r.id, r]));
  const ids: string[] = [];
  for (const group of groups) {
    for (const id of group.rowIds) {
      const phase = byId.get(id)?.phase;
      if (phase && RETRY_ALL_PHASES.has(phase)) ids.push(id);
    }
  }
  return ids;
}
