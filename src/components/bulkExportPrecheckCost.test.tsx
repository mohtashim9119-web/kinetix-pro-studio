// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { PrecheckCache, useExportPrecheck, type PrecheckTarget } from './bulkExportPrecheck';

let root: Root | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; });

type Api = ReturnType<typeof useExportPrecheck>;

async function mountHook(
  targets: PrecheckTarget[], nonce: number, check: (id: string) => Promise<string | null>, cache: PrecheckCache,
): Promise<{ rerender(t: PrecheckTarget[], n: number): Promise<void>; api(): Api }> {
  let api!: Api;
  const Probe = ({ t, n }: { t: PrecheckTarget[]; n: number }): React.ReactElement => {
    api = useExportPrecheck(t, n, { check, cache });
    return <></>;
  };
  const el = document.createElement('div');
  root = createRoot(el);
  await act(async () => { root!.render(<Probe t={targets} n={nonce} />); });
  return {
    rerender: async (t, n) => { await act(async () => { root!.render(<Probe t={t} n={n} />); }); },
    api: () => api,
  };
}

describe('pre-check cost — each stored record is loaded at most once per save', () => {
  const projects = (n: number, savedAt = 100): PrecheckTarget[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, savedAt }));

  it('many large projects: opening the pane again re-reads none of them', async () => {
    const loads = new Map<string, number>();
    const check = vi.fn(async (id: string) => { loads.set(id, (loads.get(id) ?? 0) + 1); return null; });
    const cache = new PrecheckCache();
    const targets = projects(40);
    const h = await mountHook(targets, 1, check, cache);
    expect(check).toHaveBeenCalledTimes(40);
    // The pane comes on screen three more times (nonce moves), nothing saved.
    await h.rerender(targets, 2);
    await h.rerender(targets, 3);
    await h.rerender(targets, 4);
    expect(check).toHaveBeenCalledTimes(40);
    expect([...loads.values()].every(n => n === 1)).toBe(true);
  });

  it('a project saved again is re-read exactly once; the rest stay cached', async () => {
    const check = vi.fn(async (_id: string) => null);
    const cache = new PrecheckCache();
    const targets = projects(5);
    const h = await mountHook(targets, 1, check, cache);
    const saved = targets.map(t => (t.id === 'p2' ? { ...t, savedAt: 200 } : t));
    await h.rerender(saved, 2);
    expect(check).toHaveBeenCalledTimes(6);
    expect(check.mock.calls.filter(c => c[0] === 'p2')).toHaveLength(2);
  });

  it('Retry\'s re-check bypasses the cache (reads the record again)', async () => {
    const check = vi.fn(async (_id: string) => null);
    const cache = new PrecheckCache();
    const h = await mountHook(projects(2), 1, check, cache);
    expect(check).toHaveBeenCalledTimes(2);
    await act(async () => { await h.api().recheck(['p1']); });
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('a verdict survives the cache: a blocked project stays blocked without a reload', async () => {
    const check = vi.fn(async (id: string) => (id === 'p1' ? 'Blocked — offline' : null));
    const cache = new PrecheckCache();
    const targets = projects(3);
    const h = await mountHook(targets, 1, check, cache);
    await h.rerender(targets, 2);
    expect(h.api().verdicts.get('p1')).toBe('Blocked — offline');
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('a check that throws is not cached', async () => {
    const cache = new PrecheckCache();
    const compute = vi.fn()
      .mockRejectedValueOnce(new Error('idb'))
      .mockResolvedValue(null);
    await expect(cache.check('x', 5, compute)).rejects.toThrow('idb');
    await expect(cache.check('x', 5, compute)).resolves.toBeNull();
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('a record with no save time is never cached', async () => {
    const cache = new PrecheckCache();
    const compute = vi.fn(async () => null);
    await cache.check('x', undefined, compute);
    await cache.check('x', undefined, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
