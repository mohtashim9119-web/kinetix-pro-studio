// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Fail loud, both runners: every thrown/rejected step lands in a visible row
// state with a plain message — never console-only, never swallowed — and a
// failure in one queue never disturbs the other.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannel<T> { onmessage: ((message: T) => void) | undefined; }
  return { Channel: FakeChannel, invoke: vi.fn() };
});

import { BulkExportRunner } from './bulkExportQueue';
import { SyncQueue } from './syncQueue';
import { BulkBatchRunner } from './bulkBatch';
import { cloudQueueEngine, createCloudProjectJob, type CloudQueueDeps } from './cloudQueueJob';
import { __resetPipelineGuardForTests, runGuarded, heldPipelines } from './pipelineGuard';
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

beforeEach(() => __resetPipelineGuardForTests());

describe('bulk export fails loud', () => {
  it('a project whose load throws is Blocked with the reason; Start still runs the others', async () => {
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'bad', name: 'bad' }, { id: 'ok', name: 'ok' }],
      loadProject: async id => { if (id === 'bad') throw new Error('disk read failed'); return project(id); },
      storage: mem(), playChime: () => {},
      execute: async () => ({ status: 'done' }),
    });
    selectAll(runner);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot().find(r => r.id === 'ok')?.phase).toBe('done'));
    expect(runner.snapshot().find(r => r.id === 'bad')).toMatchObject({
      phase: 'blocked', message: 'Blocked — could not open the project: disk read failed',
    });
  });

  it('a failed export shows its reason on the row, not just "Failed"', async () => {
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'x', name: 'x' }],
      loadProject: async id => project(id),
      storage: mem(), playChime: () => {},
      execute: async () => { throw new Error('ffmpeg exited 1'); },
    });
    runner.setSelected('x', true);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot()[0]?.phase).toBe('failed'));
    expect(runner.snapshot()[0]?.message).toBe('Failed — Retry — ffmpeg exited 1');
  });

  it('Retry on a project that is gone says so instead of doing nothing', async () => {
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'gone', name: 'gone' }],
      loadProject: async () => null,
      storage: mem(), playChime: () => {},
      execute: async () => ({ status: 'done' }),
    });
    await runner.retry('gone');
    expect(runner.snapshot().find(r => r.id === 'gone')).toMatchObject({ phase: 'blocked', message: 'Blocked — project missing' });
  });

  it('Retry whose load or checkpoint check throws lands a visible state', async () => {
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'r', name: 'r' }],
      loadProject: async () => project('r'),
      hasCheckpoint: async () => { throw new Error('peek failed'); },
      storage: mem(), playChime: () => {},
      execute: async ({ resume }) => ({ status: resume ? 'failed' : 'done', detail: 'resumed' }),
    });
    await runner.retry('r');
    await vi.waitFor(() => expect(runner.snapshot()[0]?.phase).toBe('done'));
  });
});

describe('bulk sync fails loud', () => {
  it('a staged-files read failure is a visible reason, not a silent fall-back to the stored text', async () => {
    const deps: CloudQueueDeps = {
      loadProject: async id => ({ project: { ...project(id), voiceoverId: 'v' } }),
      loadVoiceover: async () => null,
      loadStaged: async () => { throw new Error('IndexedDB closed'); },
      parseProjectData: async () => [],
    };
    const q = new SyncQueue(cloudQueueEngine);
    q.enqueue([createCloudProjectJob({ id: 'S', name: 'S' }, deps)]);
    await vi.waitFor(() => expect(q.snapshot().running).toBe(false));
    expect(q.snapshot().items[0]).toMatchObject({ status: 'skipped' });
    expect(q.snapshot().items[0]!.detail).toMatch(/staged files could not be read.*IndexedDB closed/);
  });
});

describe('mid-parallel failures stay in their own queue', () => {
  it('an export failure and a sync failure at once: each row shows its state, the other rows finish', async () => {
    const exportRunner = new BulkExportRunner({
      listProjects: () => ['E1', 'E2'].map(id => ({ id, name: id })),
      loadProject: async id => project(id),
      storage: mem(), playChime: () => {},
      execute: async ({ project: p }) => {
        if (p.id === 'E1') throw new Error('encoder crashed');
        return { status: 'done' };
      },
    });
    const q = new SyncQueue(idleEngine);
    const syncRunner = new BulkBatchRunner({
      queue: q, storage: mem(), exists: () => true,
      enqueue: rows => q.enqueue(rows.map(r => ({
        id: r.id, label: r.name,
        run: () => runGuarded(r.id, 'sync', async () => {
          if (r.id === 'S1') throw new Error('gateway 502');
          return { status: 'done' };
        }),
      }))),
    });

    selectAll(exportRunner);
    const started = exportRunner.startSelected();
    syncRunner.start([{ id: 'S1', name: 'S1' }, { id: 'S2', name: 'S2' }]);
    await started;

    await vi.waitFor(() => {
      expect(exportRunner.snapshot().find(r => r.id === 'E2')?.phase).toBe('done');
      expect(syncRunner.snapshot().find(r => r.id === 'S2')?.phase).toBe('cloud-done');
      // S1 fails, auto-retries once (existing policy), then lands Failed with its reason.
      expect(syncRunner.snapshot().find(r => r.id === 'S1')).toMatchObject({ phase: 'failed', message: 'gateway 502' });
    });
    expect(exportRunner.snapshot().find(r => r.id === 'E1')).toMatchObject({ phase: 'failed', message: 'Failed — Retry — encoder crashed' });
    expect(heldPipelines().size).toBe(0);
  });
});
