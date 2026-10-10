/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BulkExportRunner } from './bulkExportQueue';
import type { Asset, Project, VideoSegment } from '../types';

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};
const seg = (id: string, assetId?: string): VideoSegment => ({ id, startTime: 0, duration: 1, assetId, text: '' } as VideoSegment);
const asset = (id: string): Asset => ({ id, name: id, type: 'image', url: 'blob:x' } as Asset);
const project = (id: string, name: string, lastExportPath?: string): Project =>
  ({ id, name, script: '', sceneDetails: '', segments: [seg('s1', 'a1')], assets: [asset('a1')], lastExportPath }) as unknown as Project;

/** Starts every project once on a disk holding `onDisk`; returns each one's chosen output path. */
async function pathsFor(projects: Project[], onDisk: string[], folder = '/out'): Promise<Record<string, string>> {
  const disk = new Set(onDisk);
  const saved: Record<string, string> = {};
  const runner = new BulkExportRunner({
    listProjects: () => projects.map(p => ({ id: p.id, name: p.name, lastExportPath: p.lastExportPath })),
    loadProject: async id => projects.find(p => p.id === id) ?? null,
    exportSettingsFor: () => ({ resolution: '1080p', fps: 30, folder }),
    fileExists: async path => disk.has(path),
    storage: mem(), playChime: () => {},
    execute: async ({ project: p, savedPath }) => { saved[p.id] = savedPath; return { status: 'done' }; },
  });
  runner.setSelectedAll(true);
  await runner.startSelected();
  await vi.waitFor(() => expect(Object.keys(saved)).toHaveLength(projects.length));
  return saved;
}

describe('Bulk Export output path — file-exists guard', () => {
  it('re-exporting the same project onto its own recorded file overwrites (update semantics)', async () => {
    const out = await pathsFor([project('a', 'Clip', '/out/Clip.mp4')], ['/out/Clip.mp4']);
    expect(out.a).toBe('/out/Clip.mp4');
  });

  it('a different project with the same name is suffixed, never overwriting the first one\'s file', async () => {
    const out = await pathsFor(
      [project('a', 'Clip', '/out/Clip.mp4'), project('b', 'Clip', '/old/Other.mp4')],
      ['/out/Clip.mp4'],
    );
    expect(out.a).toBe('/out/Clip.mp4');
    expect(out.b).toBe('/out/Clip (2).mp4');
  });

  it('a first export into a folder holding an unrelated same-named file is suffixed', async () => {
    const out = await pathsFor([project('a', 'Clip', '/old/Clip.mp4')], ['/out/Clip.mp4', '/out/Clip (2).mp4']);
    expect(out.a).toBe('/out/Clip (3).mp4');
  });

  it('a project that last exported to "Clip (2).mp4" overwrites that file, skipping the unrelated Clip.mp4', async () => {
    const out = await pathsFor(
      [project('a', 'Clip', '/out/Clip (2).mp4')],
      ['/out/Clip.mp4', '/out/Clip (2).mp4'],
    );
    expect(out.a).toBe('/out/Clip (2).mp4');
  });

  it('nothing on disk: the plain name', async () => {
    const out = await pathsFor([project('a', 'Clip')], [], '/fresh');
    expect(out.a).toBe('/fresh/Clip.mp4');
  });

  it('a Windows-style recorded path still counts as the same file', async () => {
    const out = await pathsFor([project('a', 'Clip', 'C:\\Out\\Clip.mp4')], ['C:\\Out/Clip.mp4'], 'C:\\Out');
    expect(out.a).toBe('C:\\Out\\Clip.mp4');
  });
});
