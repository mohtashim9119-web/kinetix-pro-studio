/**
 * WS3 item B addition — the recovery-screen data source and re-link command.
 *
 * Harness mirrors `projectStoreGuard.test.ts`'s: a Map-backed fake for
 * `projectStoreClient` (the OS project store) so `loadProjectDetailed` (the
 * real implementation, not mocked) behaves realistically, plus a Map-backed
 * fake IndexedDB (`assetStore.ts`'s `getAsset`/`putAsset`) and a mocked
 * `invoke` standing in for the native asset store (`asset_store_*`
 * commands) — the same shape `tauriFfmpeg.diagnostics.test.ts` already uses
 * for native-command assertions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

let osBacking: Map<string, string>;
let cacheBacking: Map<string, Blob>; // key: `${projectId}:${assetId}`
let nativeBacking: Map<string, { name: string; mimeType: string }>; // key: `${projectId}:${assetId}`
/** Count of actual `osStoreWrite` calls — a direct "did a write reach project.json" proof, independent of content diffing. */
let osWriteCount = 0;

vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));

vi.mock('./projectStoreClient', () => ({
  osStoreWrite: (id: string, contents: string) => {
    osWriteCount += 1;
    osBacking.set(id, contents);
    return Promise.resolve();
  },
  osStoreRead: (id: string) => Promise.resolve(osBacking.has(id) ? osBacking.get(id)! : null),
  osStoreDelete: (id: string) => {
    osBacking.delete(id);
    return Promise.resolve();
  },
  osStoreListIds: () => Promise.resolve([...osBacking.keys()]),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('./assetStore', () => ({
  getAllAssetsForProject: (projectId: string) => {
    const assets: { projectId: string; id: string; blob: Blob; name: string; mimeType: string }[] = [];
    for (const [key, blob] of cacheBacking.entries()) {
      const [pid, id] = key.split(':');
      if (pid === projectId && id !== undefined) {
        assets.push({ projectId, id, blob, name: 'x', mimeType: blob.type });
      }
    }
    return Promise.resolve(assets);
  },
  getAsset: (projectId: string, id: string) => {
    const blob = cacheBacking.get(`${projectId}:${id}`);
    return Promise.resolve(blob ? { projectId, id, blob, name: 'x', mimeType: blob.type } : null);
  },
  putAsset: (projectId: string, id: string, blob: Blob) => {
    cacheBacking.set(`${projectId}:${id}`, blob);
    return Promise.resolve();
  },
}));

import { invoke } from '@tauri-apps/api/core';
import { saveProject, loadProjectDetailed, __resetStoreGuardsForTests, getLoadFailure } from './projectStore';
import { getProjectAssetRecoveryStatus, relinkAsset, attachNewAssetToSegment } from './assetRecovery';
import type { Project, VideoSegment, Asset } from '../types';
import { AnimationType, TransitionType } from '../types';

const mockInvoke = invoke as unknown as Mock;

function installLocalStorage(): void {
  const backing = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() { return backing.size; },
  } as Storage);
}

function asset(id: string, name: string): Asset {
  return { id, name, url: '', type: 'video' } as Asset;
}
function seg(id: string, assetId: string): VideoSegment {
  return { id, text: '', assetId, startTime: 0, duration: 1, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0 } as VideoSegment;
}
function segNoAsset(id: string): VideoSegment {
  return { id, text: '', assetId: undefined, startTime: 0, duration: 1, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0 } as VideoSegment;
}

function projectWith(assets: Asset[], segments: VideoSegment[]): Project {
  return {
    id: 'p-recovery', name: 'Recovery Fixture', script: '', sceneDetails: '',
    segments, headings: [], assets,
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    textLayers: [], globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    confirmed: true, aspectRatio: '16:9', resolutionTier: '1080p',
  } as Project;
}

/** Native asset_store_status responses keyed to whatever bytesPresent map is given. */
function mockNativeStatus(present: Record<string, boolean>): void {
  mockInvoke.mockImplementationOnce((_cmd: string, args: { assetIds: string[] }) =>
    Promise.resolve(args.assetIds.map((assetId) => ({
      assetId, bytesPresent: present[assetId] ?? false, metaPresent: present[assetId] ?? false,
      bytes: null, name: null, mimeType: null,
    }))),
  );
}

beforeEach(() => {
  __resetStoreGuardsForTests();
  installLocalStorage();
  osBacking = new Map();
  cacheBacking = new Map();
  nativeBacking = new Map();
  osWriteCount = 0;
  mockInvoke.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  __resetStoreGuardsForTests();
});

describe('getProjectAssetRecoveryStatus', () => {
  it('returns null when the project JSON itself cannot be read', async () => {
    const status = await getProjectAssetRecoveryStatus('never-saved');
    expect(status).toBeNull();
  });

  it('reports per-asset resolution across cache and native, even for a project with no load failure', async () => {
    const a1 = asset('a1', 'clip.mp4');
    const a2 = asset('a2', 'photo.png');
    await saveProject(projectWith([a1, a2], [seg('s0', 'a1'), seg('s1', 'a2')]));
    cacheBacking.set('p-recovery:a1', new Blob(['x']));
    mockNativeStatus({ a2: true }); // a2 resolvable natively, not in cache

    const status = await getProjectAssetRecoveryStatus('p-recovery');

    expect(status).not.toBeNull();
    expect(status!.loadFailure).toBeNull();
    expect(status!.assets).toEqual([
      { assetId: 'a1', name: 'clip.mp4', type: 'video', cacheResolved: true, nativeResolved: false, resolved: true },
      { assetId: 'a2', name: 'photo.png', type: 'video', cacheResolved: false, nativeResolved: true, resolved: true },
    ]);
    expect(status!.allResolved).toBe(true);
  });

  it('reports an unresolved asset (missing from both stores) and surfaces the load failure', async () => {
    const a1 = asset('a1', 'clip.mp4');
    await saveProject(projectWith([a1], [seg('s0', 'a1')]));
    mockNativeStatus({}); // nothing native

    const status = await getProjectAssetRecoveryStatus('p-recovery');
    expect(status!.assets).toEqual([
      { assetId: 'a1', name: 'clip.mp4', type: 'video', cacheResolved: false, nativeResolved: false, resolved: false },
    ]);
    expect(status!.allResolved).toBe(false);
  });
});

describe('relinkAsset', () => {
  it('writes the picked file natively and to the cache, and clears the load failure once ALL assets resolve', async () => {
    const a1 = asset('a1', 'clip.mp4');
    await saveProject(projectWith([a1], [seg('s0', 'a1')]));
    // Simulate item A having poisoned the project (the real flow: App.tsx's
    // orphan check calls reportAssetResolutionFailure).
    const { reportAssetResolutionFailure } = await import('./projectStore');
    reportAssetResolutionFailure('p-recovery', 'asset a1 unresolvable');
    expect(getLoadFailure('p-recovery')).toBeDefined();

    mockInvoke.mockResolvedValueOnce(undefined); // asset_store_write
    mockNativeStatus({ a1: true }); // post-write status check sees it resolved

    const file = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' });
    const outcome = await relinkAsset('p-recovery', 'a1', file);

    expect(outcome.ok).toBe(true);
    expect(outcome.status?.allResolved).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('asset_store_write', expect.any(Uint8Array), {
      headers: { 'project-id': 'p-recovery', 'asset-id': 'a1', name: 'clip.mp4', 'mime-type': 'video/mp4' },
    });
    // The load failure is now cleared — autosave can proceed.
    expect(getLoadFailure('p-recovery')).toBeUndefined();
    // Cache was repopulated too.
    expect(cacheBacking.has('p-recovery:a1')).toBe(true);
  });

  it('does NOT clear the load failure when other assets are still unresolved', async () => {
    const a1 = asset('a1', 'clip.mp4');
    const a2 = asset('a2', 'photo.png');
    await saveProject(projectWith([a1, a2], [seg('s0', 'a1'), seg('s1', 'a2')]));
    const { reportAssetResolutionFailure } = await import('./projectStore');
    reportAssetResolutionFailure('p-recovery', 'assets unresolvable');

    mockInvoke.mockResolvedValueOnce(undefined); // asset_store_write for a1
    mockNativeStatus({ a1: true }); // a2 still not present natively

    const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });
    const outcome = await relinkAsset('p-recovery', 'a1', file);

    expect(outcome.ok).toBe(true);
    expect(outcome.status?.allResolved).toBe(false);
    expect(getLoadFailure('p-recovery')).toBeDefined(); // still poisoned — a2 is unresolved
  });

  it('a native write failure is reported, never swallowed', async () => {
    const a1 = asset('a1', 'clip.mp4');
    await saveProject(projectWith([a1], [seg('s0', 'a1')]));
    mockInvoke.mockRejectedValueOnce(new Error('disk full'));
    mockNativeStatus({}); // status recheck after the failed write — still unresolved

    const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });
    const outcome = await relinkAsset('p-recovery', 'a1', file);

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/disk full/);
    expect(cacheBacking.has('p-recovery:a1')).toBe(false); // cache write never attempted
  });
});

describe('attachNewAssetToSegment', () => {
  it('mints a new asset, writes it natively and to cache, and points the segment at it', async () => {
    await saveProject(projectWith([], [segNoAsset('s0')]));
    // A fixture id like 's0' gets backfilled to segmentId.ts's content-hash
    // format on LOAD (not on save — the stored bytes keep 's0' verbatim), so
    // read it back through loadProjectDetailed, the same path
    // attachNewAssetToSegment itself uses, rather than the raw stored id.
    const realSegmentId = (await loadProjectDetailed('p-recovery'))!.ok
      ? (await loadProjectDetailed('p-recovery') as { project: Project }).project.segments[0]!.id
      : (() => { throw new Error('setup failed'); })();
    mockInvoke.mockResolvedValueOnce(undefined); // asset_store_write
    mockInvoke.mockResolvedValueOnce(undefined); // project_mirror_write_project (saveProject's mirror side effect)
    mockNativeStatus({});

    const file = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' });
    const outcome = await attachNewAssetToSegment('p-recovery', realSegmentId, file);

    expect(outcome.ok).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('asset_store_write', expect.any(Uint8Array), {
      headers: expect.objectContaining({ 'project-id': 'p-recovery', name: 'clip.mp4', 'mime-type': 'video/mp4' }),
    });
    // project.json now has one asset, and the segment points at it.
    const stored = JSON.parse(osBacking.get('p-recovery')!) as { project: Project };
    expect(stored.project.assets).toHaveLength(1);
    const newAssetId = stored.project.assets[0]!.id;
    expect(newAssetId).not.toBe('');
    expect(stored.project.segments[0]!.assetId).toBe(newAssetId);
    // Cache was populated too.
    expect(cacheBacking.has(`p-recovery:${newAssetId}`)).toBe(true);
  });

  it('refuses when the segment already has an asset', async () => {
    const a1 = asset('a1', 'clip.mp4');
    await saveProject(projectWith([a1], [seg('s0', 'a1')]));
    const realSegmentId = (await loadProjectDetailed('p-recovery') as { project: Project }).project.segments[0]!.id;
    mockNativeStatus({ a1: true }); // the refusal path still recomputes `status` for the return value
    const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });

    const outcome = await attachNewAssetToSegment('p-recovery', realSegmentId, file);

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/already has an asset/);
  });

  it('refuses when the segment does not exist', async () => {
    await saveProject(projectWith([], [segNoAsset('s0')]));
    const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });

    const outcome = await attachNewAssetToSegment('p-recovery', 'no-such-segment', file);

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/Segment not found/);
  });
});

// ---------------------------------------------------------------------------
// Machine-1 end-to-end: the exact shape from the incident write-up —
// project.json intact, registry intact, IndexedDB empty, source files
// available on the user's own disk — proved against the REAL `saveProject`
// (not a mock), so Guard 2's refusal and its release are both exercised for
// real rather than assumed. This is the negative the incident actually
// needed asserted directly: a write reaching project.json while assets are
// still unresolved is precisely the shape that destroyed twenty projects.
// ---------------------------------------------------------------------------
describe('Machine-1 shape — no persistence while unresolved, exactly one write once resolved', () => {
  it('refuses every write and never rotates a backup while unresolved, then writes and rotates exactly once resolved', async () => {
    const a1 = asset('a1', 'clip.mp4');
    // project.json intact + registry intact.
    await saveProject(projectWith([a1], [seg('s0', 'a1')]));
    const storedBeforeLoss = osBacking.get('p-recovery');
    expect(storedBeforeLoss).toBeDefined();
    mockInvoke.mockClear(); // only count invokes from here on.
    osWriteCount = 0; // only count writes from here on.

    // The loss: IndexedDB empty (cacheBacking was never populated) and the
    // native store has nothing either (mockNativeStatus({}) below) — bytes
    // are gone everywhere except the user's own source file. App.tsx's
    // orphan check is what discovers this in production; simulated directly
    // here since that check itself is exercised in App.projectSwitch.test.tsx.
    const { reportAssetResolutionFailure } = await import('./projectStore');
    reportAssetResolutionFailure('p-recovery', 'asset a1 unresolvable from storage');
    expect(getLoadFailure('p-recovery')?.reason).toBe('asset-unresolvable');

    // ---- NEGATIVE: while unresolved, a save attempt is refused outright. ----
    const refused = await saveProject(projectWith([a1], [seg('s0', 'a1')]));
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.reason).toBe('blocked-by-load-failure');
    // Not one byte of project.json changed...
    expect(osBacking.get('p-recovery')).toBe(storedBeforeLoss);
    expect(osWriteCount).toBe(0);
    // ...and the native mirror/backup-rotation command was never invoked —
    // `project_mirror_write_project` is the one call path into the Rust side
    // that performs backup rotation, so "never invoked" is "never rotated".
    expect(mockInvoke).not.toHaveBeenCalledWith('project_mirror_write_project', expect.anything());
    // ...and the poison itself is untouched — a status check must not be
    // what silently un-poisons it (the exact bug this whole guard exists for).
    expect(getLoadFailure('p-recovery')?.reason).toBe('asset-unresolvable');

    // ---- The user picks their surviving source file. ----
    mockInvoke.mockResolvedValueOnce(undefined); // asset_store_write
    mockNativeStatus({ a1: true }); // post-write status check sees it resolved
    const file = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' });
    const relinked = await relinkAsset('p-recovery', 'a1', file);
    expect(relinked.ok).toBe(true);
    expect(relinked.status?.allResolved).toBe(true);

    // ---- POSITIVE: poison clears — exactly now, not before. ----
    expect(getLoadFailure('p-recovery')).toBeUndefined();

    // ---- POSITIVE: the project now opens normally, i.e. a save is no
    // longer refused, and it actually reaches project.json plus rotates a
    // backup — exactly once. ----
    mockInvoke.mockClear();
    osWriteCount = 0;
    const saved = await saveProject(projectWith([a1], [seg('s0', 'a1')]));
    expect(saved.ok).toBe(true);
    expect(osWriteCount).toBe(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('project_mirror_write_project', expect.anything());
  });
});
