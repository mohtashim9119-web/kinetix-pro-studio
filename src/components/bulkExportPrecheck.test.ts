// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { precheckProject } from './bulkExportPrecheck';
import { withStorageAvailability } from '../services/bulkExportMedia';
import { BULK_EXPORT_OFFLINE } from '../services/bulkExportPreflight';
import type { Asset, Project, SyncLogEntry, VideoSegment } from '../types';

const seg = (id: string, assetId: string): VideoSegment => ({ id, startTime: 0, duration: 1, assetId, text: '' } as VideoSegment);
/** A stored asset: url '' exactly as projectStore writes it. */
const stored = (id: string, extra: Partial<Asset> = {}): Asset => ({ id, name: id, type: 'image', url: '', ...extra } as Asset);
const entry = (type: string, extra: Partial<SyncLogEntry> = {}): SyncLogEntry =>
  ({ id: `e-${type}`, timestamp: 1, syncRunId: 'r1', type, message: type, ...extra }) as SyncLogEntry;
const project = (assets: Asset[], syncLog: SyncLogEntry[] = []): Project =>
  ({ id: 'P', name: 'P', segments: [seg('s1', 'a1')], assets, syncLog, syncRunSummaries: [] }) as unknown as Project;
const status = (resolved: boolean) => async () => ({
  projectId: 'P', projectName: 'P', loadFailure: null, allResolved: resolved,
  assets: [{ assetId: 'a1', name: 'a1', type: 'image' as const, cacheResolved: resolved, nativeResolved: false, resolved }],
});
const check = (p: Project, onDisk: boolean) =>
  precheckProject('P', { load: async () => ({ project: p }), withAvailability: q => withStorageAvailability(q, status(onDisk)) });

describe('bulk export pre-check — media actions are live, not the log', () => {
  it('a sync-time "missing media" record is stale once the scene has media (permanent fix)', async () => {
    const p = project([stored('a1')], [entry('no-asset', { segmentIndex: 0 })]);
    expect(await check(p, true)).toBeNull();
  });

  it('a scene with no media assigned right now still blocks', async () => {
    const p = { ...project([stored('a1')], [entry('info', { message: 'Sync completed' })]), segments: [{ id: 's1', startTime: 0, duration: 1, text: '' } as VideoSegment] } as Project;
    expect(await check(p, true)).toMatch(/Missing media/);
  });
});

describe('bulk export pre-check — offline media is judged from storage', () => {
  it('real-offline (storage has no bytes) blocks', async () => {
    expect(await check(project([stored('a1')]), false)).toBe(BULK_EXPORT_OFFLINE);
  });

  it('a stale log-recorded offline snapshot with the file present passes', async () => {
    const p = project([stored('a1', { unresolved: true })], [entry('warning', { message: 'Offline media: a1' })]);
    expect(await check(p, true)).toBeNull();
  });

  it('other newest-sync action kinds still block (sync stopped)', async () => {
    const p = project([stored('a1')], [entry('abort')]);
    expect(await check(p, true)).toMatch(/Blocked — 1 unresolved action in the sync log \(Sync stopped\)/);
  });
});
