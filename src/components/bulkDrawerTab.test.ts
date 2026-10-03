import { describe, expect, it } from 'vitest';
import { statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BatchPhase, BatchRow, BulkGroup } from '../services/bulkBatch';
import {
  bulkDrawerTabForPhase, collectRetryAllRowIds, readBulkDrawerTab, writeBulkDrawerTab, BULK_DRAWER_TAB_KEY,
} from './bulkDrawerTab';

describe('T2 — bulk drawer tab membership', () => {
  it('NEW holds drafts (no record) plus staged/active phases', () => {
    expect(bulkDrawerTabForPhase(undefined)).toBe('new');
    for (const phase of ['queued', 'cloud', 'finishing', 'cloud-done'] as const) {
      expect(bulkDrawerTabForPhase(phase)).toBe('new');
    }
  });

  it('FAILED-PAUSED holds failed, finish-failed, paused, cancelled', () => {
    for (const phase of ['failed', 'finish-failed', 'paused', 'cancelled'] as const) {
      expect(bulkDrawerTabForPhase(phase)).toBe('failed-paused');
    }
  });

  it('FINISHED holds done and skipped', () => {
    expect(bulkDrawerTabForPhase('done')).toBe('finished');
    expect(bulkDrawerTabForPhase('skipped')).toBe('finished');
  });
});

describe('T4 — Retry All collection order', () => {
  it('collects failed | finish-failed | cancelled in group then FIFO; skips paused', () => {
    const groups: BulkGroup[] = [
      { id: 'g1', name: 'A', collapsed: false, rowIds: ['p', 'a', 'b'] },
      { id: 'g2', name: 'B', collapsed: false, rowIds: ['c', 'd'] },
    ];
    const records = [
      { id: 'p', name: 'P', phase: 'paused' },
      { id: 'a', name: 'A', phase: 'failed' },
      { id: 'b', name: 'B', phase: 'done' },
      { id: 'c', name: 'C', phase: 'cancelled' },
      { id: 'd', name: 'D', phase: 'finish-failed' },
    ] as BatchRow[];
    expect(collectRetryAllRowIds(groups, records)).toEqual(['a', 'c', 'd']);
  });
});

describe('T3 — selected tab persist key', () => {
  it('writes kinetix:bulk-drawer-tab:v1 and reads it back', () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
    writeBulkDrawerTab('failed-paused', storage);
    expect(m.get(BULK_DRAWER_TAB_KEY)).toBe('failed-paused');
    expect(readBulkDrawerTab(storage)).toBe('failed-paused');
    writeBulkDrawerTab('new', storage);
    storage.setItem(BULK_DRAWER_TAB_KEY, 'legacy-unknown');
    expect(readBulkDrawerTab(storage)).toBe('new');
  });
});

describe('T6 — completion chime asset', () => {
  it('is a small bundled wav replacing the old cartoon chime', () => {
    const wav = resolve(__dirname, '../assets/bulk-group-complete.wav');
    const bytes = statSync(wav).size;
    expect(bytes).toBeGreaterThan(200);
    expect(bytes).toBeLessThan(100_000);
    const buf = readFileSync(wav);
    const rate = buf.readUInt32LE(24);
    const bits = buf.readUInt16LE(34);
    const ch = buf.readUInt16LE(22);
    const data = buf.readUInt32LE(40);
    const dur = data / (rate * ch * (bits / 8));
    expect(dur).toBeGreaterThan(0.15);
    expect(dur).toBeLessThan(1);
  });
});

const ALL: BatchPhase[] = [
  'queued', 'cloud', 'cloud-done', 'finishing', 'done', 'finish-failed',
  'paused', 'failed', 'cancelled', 'skipped',
];

describe('every BatchPhase maps to exactly one tab', () => {
  it('covers the phase union', () => {
    const tabs = new Set(ALL.map(p => bulkDrawerTabForPhase(p)));
    expect([...tabs].sort()).toEqual(['failed-paused', 'finished', 'new']);
  });
});
