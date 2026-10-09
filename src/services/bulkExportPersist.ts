/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const BULK_EXPORT_SELECTION_KEY = 'kinetix:bulk-export-selection:v1';
export const BULK_EXPORT_BATCH_KEY = 'kinetix:bulk-export-batch:v1';

export function readBulkExportSelection(storage: Pick<Storage, 'getItem'> | undefined = fallback()): string[] {
  try {
    const raw = storage?.getItem(BULK_EXPORT_SELECTION_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

export function writeBulkExportSelection(ids: readonly string[], storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = fallback()): void {
  try {
    if (!storage) return;
    if (ids.length === 0) storage.removeItem(BULK_EXPORT_SELECTION_KEY);
    else storage.setItem(BULK_EXPORT_SELECTION_KEY, JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

function fallback(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}
