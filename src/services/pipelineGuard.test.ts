// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// One pipeline per project: never syncing AND exporting at once — bulk sync
// (cloud job + background finish), editor sync, bulk export, manual export.
// Overlap parks the late one as Waiting (queue advances, nothing silently
// skipped); different projects in both queues run side by side.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannel<T> { onmessage: ((message: T) => void) | undefined; }
  return { Channel: FakeChannel, invoke: vi.fn() };
});

import {
  __resetPipelineGuardForTests, claimPipeline, heldPipelines, runGuarded,
  WAITING_FOR_EXPORT, WAITING_FOR_SYNC, PIPELINE_BUSY_REASON,
} from './pipelineGuard';
import { BulkExportRunner } from './bulkExportQueue';
import { BulkBatchRunner } from './bulkBatch';
import { SyncQueue, type QueueJob } from './syncQueue';
import { cloudQueueEngine, createCloudProjectJob, type CloudQueueDeps } from './cloudQueueJob';
import type { Asset, Project, VideoSegment } from '../types';
import { selectAll } from './bulkExportTestUtil';

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};

const project = (id: string): Project => ({
  id, name: id, script: '', sceneDetails: '', lastExportPath: `/out/${id}.mp4`,
  segments: [{ id: 's1', startTime: 0, duration: 1, assetId: 'a1', text: '' } as VideoSegment],
  assets: [{ id: 'a1', name: 'a1', type: 'image', url: 'blob:x' } as Asset],
} as unknown as Project);

const idleEngine = { workerSec: () => 0, usdPerSec: 0, onDrain: () => {}, cancelReceipt: () => '' };

/** A sync job the way the cloud job runs it: under the guard, as 'sync'. */
function syncJob(id: string, body: () => Promise<void>, seen: string[]): QueueJob {
  return {
    id, label: id,
    run: () => runGuarded(id, 'sync', async () => { seen.push(id); await body(); return { status: 'done' }; }),
  };
}

/** Records any moment one project is held by both pipelines (must never happen). */
function overlapProbe(): { check(id: string, kind: 'sync' | 'export'): void; overlaps: string[] } {
  const overlaps: string[] = [];
  return {
    overlaps,
    check(id, kind) {
      const held = heldPipelines().get(id);
      if (held && held !== kind) overlaps.push(`${id}:${held}+${kind}`);
    },
  };
}

function exportRunner(projects: Project[], execute: ConstructorParameters<typeof BulkExportRunner>[0]['execute']): BulkExportRunner {
  return new BulkExportRunner({
    listProjects: () => projects.map(p => ({ id: p.id, name: p.name })),
    loadProject: async id => projects.find(p => p.id === id) ?? null,
    storage: mem(),
    playChime: () => {},
    execute,
  });
}

beforeEach(() => __resetPipelineGuardForTests());

describe('pipeline guard', () => {
  it('sync and export on one project exclude each other; same kind stacks; release is idempotent', () => {
    const sync = claimPipeline('p', 'sync')!;
    expect(claimPipeline('p', 'export')).toBeNull();
    const sync2 = claimPipeline('p', 'sync')!;
    sync(); sync();
    expect(claimPipeline('p', 'export')).toBeNull();
    sync2();
    expect(claimPipeline('p', 'export')).not.toBeNull();
    expect(claimPipeline('q', 'sync')).not.toBeNull();
  });
});

describe('bulk export ↔ sync overlap', () => {
  it('Start on a project mid-sync parks it Waiting (no export started), the queue advances to the next project', async () => {
    const releaseSync = claimPipeline('a', 'sync')!;
    const started: string[] = [];
    const runner = exportRunner([project('a'), project('b')], async ({ project: p }) => { started.push(p.id); return { status: 'done' }; });
    selectAll(runner);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot().find(r => r.id === 'b')?.phase).toBe('done'));
    expect(runner.snapshot().find(r => r.id === 'a')).toMatchObject({ phase: 'waiting', message: WAITING_FOR_SYNC });
    expect(started).toEqual(['b']);

    // Retry once the sync is over: it runs.
    releaseSync();
    await runner.retry('a');
    await vi.waitFor(() => expect(runner.snapshot().find(r => r.id === 'a')?.phase).toBe('done'));
    expect(started).toEqual(['b', 'a']);
  });

  it('a sync that starts after Start but before the row runs still parks it (guard checked at run time)', async () => {
    const started: string[] = [];
    let releaseSync: (() => void) | null = null;
    const runner = exportRunner([project('x'), project('y')], async ({ project: p }) => {
      started.push(p.id);
      if (p.id === 'x') releaseSync = claimPipeline('y', 'sync'); // y starts syncing while x exports
      return { status: 'done' };
    });
    selectAll(runner);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot().find(r => r.id === 'y')?.phase).toBe('waiting'));
    expect(started).toEqual(['x']);
    expect(runner.snapshot().find(r => r.id === 'y')?.message).toBe(WAITING_FOR_SYNC);
    releaseSync!();
  });

  it('the cloud sync job on a project mid-export parks Waiting before opening anything, and the queue advances', async () => {
    const releaseExport = claimPipeline('A', 'export')!;
    const loaded: string[] = [];
    const deps: CloudQueueDeps = {
      loadProject: async id => { loaded.push(id); return null; },
      loadVoiceover: async () => null,
      parseProjectData: async () => [],
    };
    const q = new SyncQueue(cloudQueueEngine);
    q.enqueue([createCloudProjectJob({ id: 'A', name: 'A' }, deps), createCloudProjectJob({ id: 'B', name: 'B' }, deps)]);
    await vi.waitFor(() => expect(q.snapshot().running).toBe(false));
    const [a, b] = q.snapshot().items;
    expect(a).toMatchObject({ status: 'paused', reason: PIPELINE_BUSY_REASON, detail: WAITING_FOR_EXPORT });
    expect(b!.status).toBe('skipped'); // B ran (its own "can't sync yet" reason)
    expect(loaded).toEqual(['B']);
    releaseExport();
  });

  it('a bulk-sync row parked by an export shows Waiting and can be retried', async () => {
    const storage = mem();
    const q = new SyncQueue(idleEngine);
    const enqueued: string[] = [];
    const runner = new BulkBatchRunner({
      queue: q, storage, exists: () => true,
      enqueue: rows => {
        for (const r of rows) enqueued.push(r.id);
        q.enqueue(rows.map(r => ({ id: r.id, label: r.name, run: () => runGuarded(r.id, 'sync', async () => ({ status: 'done' })) })));
      },
    });
    const releaseExport = claimPipeline('P', 'export')!;
    runner.start([{ id: 'P', name: 'P' }]);
    await vi.waitFor(() => expect(runner.snapshot()[0]?.phase).toBe('paused'));
    expect(runner.snapshot()[0]?.message).toBe(WAITING_FOR_EXPORT);
    releaseExport();
    runner.retry('P');
    await vi.waitFor(() => expect(runner.snapshot()[0]?.phase).toBe('cloud-done'));
  });

  it('background finish (Build Timeline) waits while the project exports, then finishes once the export ends', async () => {
    const q = new SyncQueue(idleEngine);
    const runner = new BulkBatchRunner({ queue: q, storage: mem(), exists: () => true, enqueue: () => {} });
    const finalize = vi.fn(async () => ({ ok: true as const }));
    const releaseExport = claimPipeline('F', 'export')!;
    runner.requeueForRebuild('F', 'F', 'Rebuilding from cache');
    runner.setFinalizer(finalize);
    await vi.waitFor(() => expect(runner.snapshot()[0]?.message).toBe(WAITING_FOR_EXPORT));
    expect(finalize).not.toHaveBeenCalled();
    expect(runner.snapshot()[0]?.phase).toBe('cloud-done');

    releaseExport();
    await vi.waitFor(() => expect(runner.snapshot()[0]?.phase).toBe('done'));
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('different projects in both queues run concurrently and both finish; no project is ever held by both', async () => {
    const probe = overlapProbe();
    let openExport!: () => void;
    const exportGate = new Promise<void>(r => { openExport = r; });
    const exportStarted = vi.fn();
    const runner = exportRunner([project('E1'), project('E2')], async ({ project: p }) => {
      probe.check(p.id, 'export');
      exportStarted(p.id);
      if (p.id === 'E1') await exportGate;
      return { status: 'done' };
    });
    selectAll(runner);
    await runner.startSelected();
    await vi.waitFor(() => expect(exportStarted).toHaveBeenCalledWith('E1'));

    // While E1 is exporting, a sync batch over S1, S2 runs to completion.
    const seen: string[] = [];
    const q = new SyncQueue(idleEngine);
    q.enqueue(['S1', 'S2'].map(id => syncJob(id, async () => { probe.check(id, 'sync'); }, seen)));
    await vi.waitFor(() => expect(q.snapshot().running).toBe(false));
    expect(q.snapshot().items.map(i => i.status)).toEqual(['done', 'done']);
    expect(runner.snapshot().find(r => r.id === 'E1')?.phase).toBe('exporting');

    openExport();
    await vi.waitFor(() => expect(runner.snapshot().every(r => r.phase === 'done')).toBe(true));
    expect(probe.overlaps).toEqual([]);
    expect(heldPipelines().size).toBe(0);
  });
});
