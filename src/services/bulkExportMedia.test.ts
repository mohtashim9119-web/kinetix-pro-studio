/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { loadProjectMedia, withStorageAvailability, STORAGE_AVAILABLE_URL } from './bulkExportMedia';
import { BulkExportRunner } from './bulkExportQueue';
import { BULK_EXPORT_OFFLINE } from './bulkExportPreflight';
import type { Asset, Project, VideoSegment } from '../types';

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};
const seg = (id: string, assetId?: string): VideoSegment => ({ id, startTime: 0, duration: 1, assetId, text: '' } as VideoSegment);
/** A STORED asset: url '' always, exactly as projectStore writes it. */
const stored = (id: string): Asset => ({ id, name: `${id}.png`, type: 'image', url: '' } as Asset);
const record = (assets: Asset[], segments = [seg('s1', 'a1')]): Project =>
  ({ id: 'P', name: 'P', segments, assets, lastExportPath: '/out/P.mp4' }) as unknown as Project;
const status = (resolved: Record<string, boolean>) => async () => ({
  projectId: 'P', projectName: 'P', loadFailure: null, allResolved: true,
  assets: Object.entries(resolved).map(([assetId, r]) => ({ assetId, name: assetId, type: 'image' as const, cacheResolved: r, nativeResolved: false, resolved: r })),
});

describe('withStorageAvailability — stored url:"" is not offline', () => {
  it('stamps assets storage holds; leaves missing ones offline', async () => {
    const p = await withStorageAvailability(record([stored('a1'), stored('a2')]), status({ a1: true, a2: false }));
    expect(p.assets[0]).toMatchObject({ url: STORAGE_AVAILABLE_URL, unresolved: false });
    expect(p.assets[1]).toMatchObject({ url: '', unresolved: true });
  });

  it('Start check passes for a project whose media is on disk (not "offline")', async () => {
    const rec = record([stored('a1')]);
    const started: string[] = [];
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'P', name: 'P', lastExportPath: '/out/P.mp4' }],
      loadProject: () => withStorageAvailability(rec, status({ a1: true })),
      storage: mem(), playChime: () => {},
      execute: async ({ project }) => { started.push(project.id); return { status: 'done' }; },
    });
    runner.setSelected('P', true);
    await runner.startSelected();
    await vi.waitFor(() => expect(runner.snapshot()[0]!.phase).toBe('done'));
    expect(started).toEqual(['P']);
  });

  it('Start check still blocks when storage truly lacks the file', async () => {
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'P', name: 'P', lastExportPath: '/out/P.mp4' }],
      loadProject: () => withStorageAvailability(record([stored('a1')]), status({ a1: false })),
      storage: mem(), playChime: () => {},
      execute: async () => ({ status: 'done' }),
    });
    runner.setSelected('P', true);
    await runner.startSelected();
    expect(runner.snapshot()[0]).toMatchObject({ phase: 'blocked', message: BULK_EXPORT_OFFLINE });
  });

  it('unreadable storage marks nothing offline (the real load decides)', async () => {
    const p = await withStorageAvailability(record([stored('a1')]), async () => { throw new Error('idb dead'); });
    expect(p.assets[0]!.url).toBe(STORAGE_AVAILABLE_URL);
  });
});

describe('loadProjectMedia — the export runs the shared media preparation', () => {
  const blob = new Blob(['x'], { type: 'image/png' });
  const sa = (id: string) => ({ projectId: 'P', id, blob, name: `${id}.png`, mimeType: 'image/png' });
  const setup = (over: Record<string, unknown> = {}) => {
    const minted: string[] = [];
    const revoked: string[] = [];
    return {
      minted, revoked,
      deps: {
        readStored: async () => [sa('a1')],
        repairNative: async () => ({ repaired: [], failed: [] }),
        repairVault: async () => ({ repaired: [], failed: [] }),
        resolveByProvenance: async () => ({ resolved: [], needsConfirmation: [], folderPickOnly: [] }),
        makeUrl: () => { const u = `blob:${minted.length}`; minted.push(u); return u; },
        probeVideoDuration: async () => 7,
        ...over,
      },
      revokeUrl: (u: string) => { revoked.push(u); },
    };
  };

  it('gives every used asset a real blob URL and a file', async () => {
    const d = setup();
    const loaded = await loadProjectMedia(record([stored('a1')]), d.deps, d.revokeUrl);
    expect(loaded.project.assets[0]!.url).toBe('blob:0');
    expect(loaded.project.assets[0]!.file).toBeInstanceOf(File);
  });

  it('revoke frees every minted URL, once', async () => {
    const d = setup();
    const loaded = await loadProjectMedia(record([stored('a1')]), d.deps, d.revokeUrl);
    loaded.revoke(); loaded.revoke();
    expect(d.revoked).toEqual(['blob:0']);
  });

  it('throws a plain reason — and frees what it minted — when a used asset is nowhere', async () => {
    const d = setup({ readStored: async () => [] });
    await expect(loadProjectMedia(record([stored('a1'), stored('a2')], [seg('s1', 'a1')]), d.deps, d.revokeUrl))
      .rejects.toThrow(/media could not be loaded from storage for 1 scene/);
    expect(d.minted).toEqual(d.revoked);
  });

  it('old project: asset missing from IndexedDB, present at its original path, no duration — bulk equals opening', async () => {
    const video = { id: 'v1', name: 'v1.mp4', type: 'video', url: '' } as Asset; // no duration
    const rec = record([video], [seg('s1', 'v1')]);
    // Storage gains the bytes only once the by-path ladder re-imports them.
    let imported = false;
    const common = {
      readStored: async () => (imported ? [{ ...sa('v1'), name: 'v1.mp4' }] : []),
      resolveByProvenance: async () => { imported = true; return { resolved: ['v1'], needsConfirmation: [], folderPickOnly: [] }; },
    };
    const bulk = setup(common);
    const loadedBulk = await loadProjectMedia(rec, bulk.deps, bulk.revokeUrl);
    // "Opening in the editor first" runs the very same preparation.
    imported = false;
    const open = setup(common);
    const { prepareProjectMedia } = await import('./projectMediaPreparation');
    const opened = await prepareProjectMedia('P', rec.assets, { deps: open.deps });
    expect(imported).toBe(true);
    expect(loadedBulk.project.assets[0]).toMatchObject({ url: 'blob:0', duration: 7, unresolved: false });
    expect(loadedBulk.project.assets.map(a => ({ ...a, file: undefined })))
      .toEqual(opened.assets.map(a => ({ ...a, file: undefined })));
  });
});
