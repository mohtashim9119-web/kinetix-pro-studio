/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '../types';
import {
  __setThumbBackendForTests,
  hasPersistedThumbnail,
  persistPreviewThumbnail,
  previewSpineHash,
  readPersistedThumbnail,
  writePersistedThumbnail,
  type ThumbBackend,
} from './projectThumbnail';
import { loadAllMetas, upsertProjectMeta } from './projectStore';

const JPEG_A = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x41, 0xFF, 0xD9]);
const JPEG_B = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x42, 0xFF, 0xD9]);

function memoryBackend(writes: string[]): ThumbBackend {
  const files = new Map<string, Uint8Array>();
  const key = (id: string, hash: string) => `${id}:${hash}`;
  return {
    async write(projectId, hash, jpeg) {
      writes.push(`${projectId}:${hash}`);
      files.set(key(projectId, hash), jpeg);
    },
    async read(projectId, hash) {
      return files.get(key(projectId, hash)) ?? null;
    },
    async has(projectId, hash) {
      return files.has(key(projectId, hash));
    },
  };
}

function project(id: string, assetId: string, extra?: Partial<Project>): Project {
  return {
    id,
    name: id,
    script: 'x',
    confirmed: true,
    headings: [],
    assets: [{ id: assetId, name: 'a.jpg', url: '', type: 'image', contentHash: `h-${assetId}` }],
    segments: [{ id: 's1', text: 'hi', assetId, startTime: 0, duration: 1, transition: 'none', animation: 'none', order: 0 }],
    ...extra,
  } as unknown as Project;
}

describe('project preview thumbnails — content-addressed store', () => {
  const writes: string[] = [];

  beforeEach(() => {
    writes.length = 0;
    localStorage.clear();
    __setThumbBackendForTests(memoryBackend(writes));
  });

  afterEach(() => {
    __setThumbBackendForTests(null);
    localStorage.clear();
  });

  it('previewSpineHash re-keys when the timeline visual changes', () => {
    const a = project('p1', 'img-a');
    const b = project('p1', 'img-b');
    expect(previewSpineHash(a)).not.toBe(previewSpineHash(b));
    expect(previewSpineHash(a)).toBe(previewSpineHash(project('p1', 'img-a')));
  });

  it('open A then B: both cards keep their own JPEG (no shared slot steal)', async () => {
    const a = project('proj-a', 'img-a');
    const b = project('proj-b', 'img-b');
    await writePersistedThumbnail(a.id, previewSpineHash(a), JPEG_A);
    await writePersistedThumbnail(b.id, previewSpineHash(b), JPEG_B);

    const gotA = await readPersistedThumbnail(a.id, previewSpineHash(a));
    const gotB = await readPersistedThumbnail(b.id, previewSpineHash(b));
    expect(Array.from(gotA ?? [])).toEqual(Array.from(JPEG_A));
    expect(Array.from(gotB ?? [])).toEqual(Array.from(JPEG_B));
    expect(gotA).not.toEqual(gotB);
  });

  it('reload: both persisted frames still present', async () => {
    await writePersistedThumbnail('proj-a', 'aaaaaaaa', JPEG_A);
    await writePersistedThumbnail('proj-b', 'bbbbbbbb', JPEG_B);
    expect(await hasPersistedThumbnail('proj-a', 'aaaaaaaa')).toBe(true);
    expect(await hasPersistedThumbnail('proj-b', 'bbbbbbbb')).toBe(true);
  });

  it('crash before write: no dest file, no corrupt JPEG served', async () => {
    expect(await hasPersistedThumbnail('proj-c', 'cccccccc')).toBe(false);
    expect(await readPersistedThumbnail('proj-c', 'cccccccc')).toBeNull();
  });

  it('re-key on timeline change writes once for the new hash, not on a repeat persist', async () => {
    const first = project('proj-d', 'img-a');
    await writePersistedThumbnail(first.id, previewSpineHash(first), JPEG_A);
    writes.length = 0;

    const unchanged = await persistPreviewThumbnail(first);
    expect(unchanged).toBe(true);
    expect(writes).toHaveLength(0);

    const changed = project('proj-d', 'img-b');
    await writePersistedThumbnail(changed.id, previewSpineHash(changed), JPEG_B);
    expect(writes.filter(w => w.endsWith(previewSpineHash(changed)))).toHaveLength(1);
    expect(await hasPersistedThumbnail(first.id, previewSpineHash(first))).toBe(true);
    expect(await hasPersistedThumbnail(changed.id, previewSpineHash(changed))).toBe(true);
  });

  it('upsertProjectMeta merge never wipes another project or an existing hash with undefined', () => {
    upsertProjectMeta({
      id: 'keep',
      name: 'Keep',
      savedAt: 1,
      segmentCount: 2,
      thumbnailHash: 'aaaaaaaa',
    });
    upsertProjectMeta({
      id: 'other',
      name: 'Other',
      savedAt: 2,
      segmentCount: 1,
      thumbnailHash: 'bbbbbbbb',
    });
    upsertProjectMeta({ id: 'keep', name: 'Keep', savedAt: 3, segmentCount: 2 });
    const metas = loadAllMetas();
    expect(metas.find(m => m.id === 'keep')?.thumbnailHash).toBe('aaaaaaaa');
    expect(metas.find(m => m.id === 'other')?.thumbnailHash).toBe('bbbbbbbb');
  });
});
