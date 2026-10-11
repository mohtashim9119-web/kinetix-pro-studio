import { describe, it, expect, vi } from 'vitest';
import { BulkExportRunner } from './bulkExportQueue';
import { BULK_EXPORT_BATCH_KEY } from './bulkExportPersist';
import { BULK_EXPORT_OFFLINE, BULK_EXPORT_SOFT_FLAG } from './bulkExportPreflight';
import { BULK_EXPORT_NO_PATH } from './bulkExportSettings';
import type { Asset, Project, VideoSegment } from '../types';
import { selectAll } from './bulkExportTestUtil';

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};

const seg = (id: string, assetId?: string): VideoSegment => ({ id, startTime: 0, duration: 1, assetId, text: '' } as VideoSegment);
const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({ id, name: id, type: 'image', url: extra.url ?? 'blob:x', ...extra } as Asset);

function project(id: string, extra: Partial<Project> = {}): Project {
  return {
    id, name: id, script: '', sceneDetails: '', segments: extra.segments ?? [seg('s1', 'a1')],
    assets: extra.assets ?? [asset('a1')], lastExportPath: extra.lastExportPath ?? `/out/${id}.mp4`,
    ...extra,
  } as unknown as Project;
}

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

describe('BulkExportRunner', () => {
  it('runs selected projects strictly one at a time', async () => {
    const live: string[] = [];
    const max = { n: 0 };
    const projects = [project('a'), project('b')];
    const runner = new BulkExportRunner({
      listProjects: () => projects.map(p => ({ id: p.id, name: p.name })),
      loadProject: async id => projects.find(p => p.id === id) ?? null,
      storage: mem(),
      playChime: () => {},
      execute: async ({ project: p }) => {
        live.push(p.id);
        max.n = Math.max(max.n, live.length);
        await flush();
        live.pop();
        return { status: 'done' };
      },
    });
    selectAll(runner);
    await runner.startSelected();
    await vi.waitFor(() => {
      expect(runner.snapshot().filter(r => r.phase === 'done').map(r => r.id).sort()).toEqual(['a', 'b']);
    });
    expect(max.n).toBe(1);
  });

  it('blocks offline media and never starts that row', async () => {
    const started: string[] = [];
    const offline = project('off', { assets: [asset('a1', { url: '', unresolved: true })] });
    const ok = project('ok');
    const runner = new BulkExportRunner({
      listProjects: () => [offline, ok].map(p => ({ id: p.id, name: p.name })),
      loadProject: async id => id === 'off' ? offline : ok,
      storage: mem(),
      playChime: () => {},
      execute: async ({ project: p }) => { started.push(p.id); return { status: 'done' }; },
    });
    selectAll(runner);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot().find(r => r.id === 'ok')?.phase).toBe('done'));
    expect(runner.snapshot().find(r => r.id === 'off')).toMatchObject({ phase: 'blocked', message: BULK_EXPORT_OFFLINE });
    expect(started).toEqual(['ok']);
  });

  it('flags missing/damaged media and still exports because Start was clicked', async () => {
    const p = project('soft', {
      segments: [seg('s1'), seg('s2', 'a2')],
      assets: [asset('a2', { corrupt: 'image-decode' })],
    });
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: p.id, name: p.name }],
      loadProject: async () => p,
      storage: mem(),
      playChime: () => {},
      execute: async () => ({ status: 'done' }),
    });
    runner.setSelected('soft', true);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot()[0]?.phase).toBe('done'));
    expect(runner.snapshot()[0]?.flags).toContain(BULK_EXPORT_SOFT_FLAG);
  });

  it('parks a failure as Failed — Retry and advances immediately', async () => {
    const order: string[] = [];
    const runner = new BulkExportRunner({
      listProjects: () => [project('bad'), project('ok')].map(p => ({ id: p.id, name: p.name })),
      loadProject: async id => project(id),
      storage: mem(),
      playChime: () => {},
      execute: async ({ project: p }) => {
        order.push(p.id);
        if (p.id === 'bad') return { status: 'failed', detail: 'boom' };
        return { status: 'done' };
      },
    });
    selectAll(runner);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot().find(r => r.id === 'ok')?.phase).toBe('done'));
    expect(runner.snapshot().find(r => r.id === 'bad')).toMatchObject({ phase: 'failed', message: 'Failed — Retry — boom' });
    expect(order).toEqual(['bad', 'ok']);
  });

  it('reload parks unfinished rows as Paused — Retry (checkpoint seam, no auto-restart)', () => {
    const storage = mem();
    storage.setItem(BULK_EXPORT_BATCH_KEY, JSON.stringify({
      rows: [
        { id: 'a', name: 'a', selected: true, phase: 'exporting', message: 'Exporting' },
        { id: 'b', name: 'b', selected: true, phase: 'queued', message: 'Queued' },
        { id: 'c', name: 'c', selected: false, phase: 'done', message: 'Done' },
      ],
    }));
    const runner = new BulkExportRunner({
      listProjects: () => ['a', 'b', 'c'].map(id => ({ id, name: id })),
      loadProject: async () => null,
      storage,
      playChime: () => {},
      execute: async () => ({ status: 'done' }),
    });
    expect(runner.snapshot().find(r => r.id === 'a')).toMatchObject({ phase: 'paused', message: 'Paused — Retry' });
    expect(runner.snapshot().find(r => r.id === 'b')).toMatchObject({ phase: 'paused', message: 'Paused — Retry' });
    expect(runner.snapshot().find(r => r.id === 'c')?.phase).toBe('done');
  });

  it('retry asks the executor to resume when a checkpoint exists', async () => {
    const seen: boolean[] = [];
    const p = project('r');
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: p.id, name: p.name }],
      loadProject: async () => p,
      hasCheckpoint: async () => true,
      storage: mem(),
      playChime: () => {},
      execute: async ({ resume }) => { seen.push(resume); return { status: 'done' }; },
    });
    await runner.retry('r');
    await vi.waitFor(() => expect(seen).toEqual([true]));
  });

  it('plays the export chime once at batch end, not per row', async () => {
    let chimes = 0;
    const runner = new BulkExportRunner({
      listProjects: () => [project('a'), project('b')].map(p => ({ id: p.id, name: p.name })),
      loadProject: async id => project(id),
      storage: mem(),
      playChime: () => { chimes += 1; },
      execute: async () => ({ status: 'done' }),
    });
    selectAll(runner);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot().every(r => r.phase === 'done')).toBe(true));
    await flush();
    await flush();
    expect(chimes).toBe(1);
  });

  it('blocks a project with no saved export path (settings seam)', async () => {
    const p = project('nopath', { lastExportPath: undefined });
    delete (p as { lastExportPath?: string }).lastExportPath;
    const started: string[] = [];
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: p.id, name: p.name }],
      loadProject: async () => p,
      storage: mem(),
      playChime: () => {},
      execute: async ({ project: x }) => { started.push(x.id); return { status: 'done' }; },
    });
    runner.setSelected('nopath', true);
    await runner.startSelected();
    expect(runner.snapshot()[0]).toMatchObject({ phase: 'blocked', message: BULK_EXPORT_NO_PATH });
    expect(started).toEqual([]);
  });
});

describe('BulkExportRunner — a done row can carry a notice', () => {
  const runWith = async (outcome: { status: 'done'; detail?: string }) => {
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'a', name: 'a' }],
      loadProject: async id => project(id),
      storage: mem(),
      playChime: () => {},
      execute: async () => outcome,
    });
    selectAll(runner);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot()[0]?.phase).toBe('done'));
    return runner.snapshot()[0]!;
  };

  it('a done outcome with a detail shows it after "Done"', async () => {
    const row = await runWith({ status: 'done', detail: 'Piece 3: 1,795 frames rendered, 1,796 planned' });
    expect(row.message).toBe('Done — Piece 3: 1,795 frames rendered, 1,796 planned');
  });

  it('a clean done outcome still reads exactly "Done" (pin)', async () => {
    const row = await runWith({ status: 'done' });
    expect(row.message).toBe('Done');
  });
});
