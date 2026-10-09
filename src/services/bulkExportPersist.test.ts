import { describe, it, expect } from 'vitest';
import { readBulkExportSelection, writeBulkExportSelection } from './bulkExportPersist';

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};

describe('bulk export selection persist', () => {
  it('round-trips selected ids', () => {
    const s = mem();
    writeBulkExportSelection(['a', 'b'], s);
    expect(readBulkExportSelection(s)).toEqual(['a', 'b']);
  });
});
