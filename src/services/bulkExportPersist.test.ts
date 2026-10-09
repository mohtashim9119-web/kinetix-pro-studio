import { describe, it, expect } from 'vitest';
import {
  readBulkExportDrawerOpen, writeBulkExportDrawerOpen,
  readBulkExportSelection, writeBulkExportSelection,
} from './bulkExportPersist';

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};

describe('bulk export drawer/selection persist', () => {
  it('round-trips open flag and selected ids (same convention as Bulk Projects)', () => {
    const s = mem();
    expect(readBulkExportDrawerOpen(s)).toBe(false);
    writeBulkExportDrawerOpen(true, s);
    expect(readBulkExportDrawerOpen(s)).toBe(true);
    writeBulkExportSelection(['a', 'b'], s);
    expect(readBulkExportSelection(s)).toEqual(['a', 'b']);
  });
});
