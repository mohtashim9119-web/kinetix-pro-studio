// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Reload with unfinished rows in BOTH bulk queues. Each restores from its own
// key without touching the other's; bulk export never auto-starts (Paused —
// Retry); bulk sync resumes its cloud work per its standing ruling
// (bulkBatch.ts header) — and a restore never starts the same row twice nor
// lets one project sync and export at once.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BulkExportRunner } from './bulkExportQueue';
import { BULK_EXPORT_BATCH_KEY } from './bulkExportPersist';
import { BulkBatchRunner } from './bulkBatch';
import { SyncQueue, type QueueJob } from './syncQueue';
import { __resetPipelineGuardForTests, heldPipelines, runGuarded, WAITING_FOR_SYNC } from './pipelineGuard';
import type { Asset, Project, VideoSegment } from '../types';

const BULK_SYNC_KEY = 'kinetix:bulk-batch:v1';

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { raw: Map<string, string> } => {
  const m = new Map<string, string>();
  return { raw: m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};

const project = (id: string): Project => ({
  id, name: id, script: '', sceneDetails: '', lastExportPath: `/out/${id}.mp4`,
  segments: [{ id: 's1', startTime: 0, duration: 1, assetId: 'a1', text: '' } as VideoSegment],
  assets: [{ id: 'a1', name: 'a1', type: 'image', url: 'blob:x' } as Asset],
} as unknown as Project);

const idleEngine = { workerSec: () => 0, usdPerSec: 0, onDrain: () => {}, cancelReceipt: () => '' };

/** Storage as a reload finds it: export A + X mid-run, sync B + X mid-run. */
function midParallelStorage(): ReturnType<typeof mem> {
  const storage = mem();
  storage.setItem(BULK_EXPORT_BATCH_KEY, JSON.stringify({ rows: [
    { id: 'A', name: 'A', selected: true, phase: 'exporting', message: 'Exporting' },
    { id: 'X', name: 'X', selected: true, phase: 'queued', message: 'Queued' },
  ] }));
  storage.setItem(BULK_SYNC_KEY, JSON.stringify({ rows: [
    { id: 'B', name: 'B', phase: 'cloud' },
    { id: 'X', name: 'X', phase: 'queued' },
  ], groups: [{ id: 'g', name: 'Group 1', collapsed: false, rowIds: ['B', 'X'] }] }));
  return storage;
}

beforeEach(() => __resetPipelineGuardForTests());

describe('reload mid-parallel', () => {
  it('each queue restores from its own key; export parks Paused — Retry, sync resumes; neither clobbers the other', async () => {
    const storage = midParallelStorage();
    const exported = vi.fn();
    const exportRunner = new BulkExportRunner({
      listProjects: () => ['A', 'X'].map(id => ({ id, name: id })),
      loadProject: async id => project(id),
      storage, playChime: () => {},
      execute: async ({ project: p }) => { exported(p.id); return { status: 'done' }; },
    });

    const q = new SyncQueue(idleEngine);
    const synced: string[] = [];
    let openX!: () => void;
    const xGate = new Promise<void>(r => { openX = r; });
    const syncRunner = new BulkBatchRunner({
      queue: q, storage, exists: () => true,
      enqueue: rows => q.enqueue(rows.map((r): QueueJob => ({
        id: r.id, label: r.name,
        run: () => runGuarded(r.id, 'sync', async () => {
          synced.push(r.id);
          if (r.id === 'X') await xGate;
          return { status: 'done' };
        }),
      }))),
    });

    expect(exportRunner.snapshot().map(r => [r.id, r.phase, r.message])).toEqual([
      ['A', 'paused', 'Paused — Retry'], ['X', 'paused', 'Paused — Retry'],
    ]);

    syncRunner.resume();
    syncRunner.resume(); // a second boot pass must not double-start anything
    await vi.waitFor(() => expect(heldPipelines().get('X')).toBe('sync'));
    expect(q.snapshot().items.map(i => i.id)).toEqual(['B', 'X']);

    // X is syncing again after the reload: its export Retry parks Waiting.
    await exportRunner.retry('X');
    expect(exportRunner.snapshot().find(r => r.id === 'X')).toMatchObject({ phase: 'waiting', message: WAITING_FOR_SYNC });
    // A (no sync) retries and exports normally, alongside X's sync.
    await exportRunner.retry('A');
    await vi.waitFor(() => expect(exportRunner.snapshot().find(r => r.id === 'A')?.phase).toBe('done'));

    openX();
    await vi.waitFor(() => expect(syncRunner.snapshot().every(r => r.phase === 'cloud-done')).toBe(true));
    expect(synced).toEqual(['B', 'X']);
    expect(exported.mock.calls.map(c => c[0])).toEqual(['A']);
    expect(heldPipelines().size).toBe(0);

    // Both keys still hold their own rows.
    const exportRows = (JSON.parse(storage.raw.get(BULK_EXPORT_BATCH_KEY)!) as { rows: { id: string }[] }).rows.map(r => r.id);
    const syncRows = (JSON.parse(storage.raw.get(BULK_SYNC_KEY)!) as { rows: { id: string }[] }).rows.map(r => r.id);
    expect(exportRows.sort()).toEqual(['A', 'X']);
    expect(syncRows.sort()).toEqual(['B', 'X']);
  });

  it('a second export runner over the same storage (HMR / remount) starts nothing on restore', () => {
    const storage = midParallelStorage();
    const execute = vi.fn(async () => ({ status: 'done' as const }));
    const mk = (): BulkExportRunner => new BulkExportRunner({
      listProjects: () => ['A', 'X'].map(id => ({ id, name: id })),
      loadProject: async id => project(id),
      storage, playChime: () => {}, execute,
    });
    mk();
    const second = mk();
    expect(second.snapshot().every(r => r.phase === 'paused')).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('a Waiting row survives a reload as Waiting — Retry, still never auto-started', () => {
    const storage = mem();
    storage.setItem(BULK_EXPORT_BATCH_KEY, JSON.stringify({ rows: [
      { id: 'W', name: 'W', selected: true, phase: 'waiting', message: WAITING_FOR_SYNC },
    ] }));
    const execute = vi.fn(async () => ({ status: 'done' as const }));
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'W', name: 'W' }],
      loadProject: async id => project(id),
      storage, playChime: () => {}, execute,
    });
    expect(runner.snapshot()[0]).toMatchObject({ phase: 'waiting', message: WAITING_FOR_SYNC });
    expect(execute).not.toHaveBeenCalled();
  });
});
