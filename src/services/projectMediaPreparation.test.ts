/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { prepareProjectMedia, MediaLoadTimeoutError, MEDIA_PROBE_TIMEOUT_MS, type MediaPreparationDeps } from './projectMediaPreparation';
import { loadProjectMedia } from './bulkExportMedia';
import type { Asset, Project } from '../types';

const video = (id: string): Asset => ({ id, name: `${id}.mp4`, type: 'video', url: '' } as Asset);
const image = (id: string): Asset => ({ id, name: `${id}.png`, type: 'image', url: '', duration: 0 } as Asset);

function deps(over: Partial<MediaPreparationDeps> = {}): { deps: Partial<MediaPreparationDeps>; minted: string[]; revoked: string[] } {
  const minted: string[] = [];
  const revoked: string[] = [];
  let n = 0;
  return {
    minted, revoked,
    deps: {
      readStored: async (_p, _l) => ['v1', 'v2', 'i1'].map(id => ({ id, blob: new Blob(['x'], { type: id.startsWith('v') ? 'video/mp4' : 'image/png' }) })) as never,
      makeUrl: () => { const u = `blob:${++n}`; minted.push(u); return u; },
      revokeUrl: u => { revoked.push(u); },
      ...over,
    },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('prepareProjectMedia — a hung duration probe fails loudly', () => {
  it('a never-loading video fails "media would not load" after the bound, revoking every URL it minted', async () => {
    vi.useFakeTimers();
    const d = deps({ probeVideoDuration: () => new Promise<number>(() => {}) });
    const outcome = prepareProjectMedia('P', [video('v1'), video('v2'), image('i1')], { deps: d.deps })
      .then(() => 'resolved', (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(MEDIA_PROBE_TIMEOUT_MS - 1);
    expect(d.revoked).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    const err = await outcome;
    expect(err).toBeInstanceOf(MediaLoadTimeoutError);
    expect((err as Error).message).toBe('media would not load');
    expect(d.minted.length).toBe(3);
    expect([...d.revoked].sort()).toEqual([...d.minted].sort());
  });

  it('a probe that answers in time is untouched and mints/keeps its URLs', async () => {
    const d = deps({ probeVideoDuration: async () => 4.2 });
    const { assets } = await prepareProjectMedia('P', [video('v1'), image('i1')], { deps: d.deps });
    expect(assets.find(a => a.id === 'v1')?.duration).toBe(4.2);
    expect(d.revoked).toEqual([]);
  });

  it('the bulk load surfaces the same failure (nothing left minted) — the row can park', async () => {
    vi.useFakeTimers();
    const d = deps({ probeVideoDuration: () => new Promise<number>(() => {}) });
    const project = { id: 'P', name: 'P', segments: [], assets: [video('v1')] } as unknown as Project;
    const out = loadProjectMedia(project, d.deps).then(() => 'resolved', (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(MEDIA_PROBE_TIMEOUT_MS + 1);
    expect(await out).toBeInstanceOf(MediaLoadTimeoutError);
    expect(d.revoked.length).toBe(d.minted.length);
  });
});

describe('the editor open path fails loud on the same error', () => {
  it('handleSwitchProject catches a preparation failure, toasts the timeout shape, and stays closed', () => {
    const app = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
    const at = app.indexOf('const prepared = await prepareProjectMedia(');
    expect(at).toBeGreaterThan(-1);
    const seg = app.slice(at, at + 2600);
    expect(seg).toMatch(/\.catch\(\(err: unknown\) => \{/);
    expect(seg).toContain('err instanceof MediaLoadTimeoutError');
    expect(seg).toMatch(/return null;\s*\}\);\s*if \(!prepared\) return;/);
  });
});
