/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// F4 — Cancel / Stop all, with Bulk Sync's semantics: a queued row goes back
// to Ready at once; the active row aborts and parks "Cancelled — Retry"
// (Retry resumes); Stop all does both; nothing chimes on a cancel.

import { describe, it, expect, vi } from 'vitest';
import { BulkExportRunner, type BulkExportExecutorInput } from './bulkExportQueue';
import type { Asset, Project, VideoSegment } from '../types';
import { selectAll } from './bulkExportTestUtil';

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};
const project = (id: string): Project => ({
  id, name: id, script: '', sceneDetails: '', lastExportPath: `/out/${id}.mp4`,
  segments: [{ id: 's', startTime: 0, duration: 1, assetId: 'a', text: '' } as VideoSegment],
  assets: [{ id: 'a', name: 'a', type: 'image', url: 'blob:x' } as Asset],
}) as unknown as Project;

/** An executor that holds every export open until it is aborted or released. */
function harness(ids: string[], opts: { hasCheckpoint?: boolean } = {}) {
  const projects = ids.map(project);
  const runs: BulkExportExecutorInput[] = [];
  const releases = new Map<string, () => void>();
  let chimes = 0;
  const runner = new BulkExportRunner({
    listProjects: () => projects.map(p => ({ id: p.id, name: p.name, lastExportPath: `/out/${p.id}.mp4` })),
    loadProject: async id => projects.find(p => p.id === id) ?? null,
    hasCheckpoint: async () => opts.hasCheckpoint === true,
    storage: mem(),
    playChime: () => { chimes++; },
    execute: input => new Promise(resolve => {
      runs.push(input);
      releases.set(input.project.id, () => resolve({ status: 'done' }));
      input.signal.addEventListener('abort', () => resolve({ status: 'failed', detail: 'cancelled' }));
    }),
  });
  return { runner, runs, releases, chimes: () => chimes };
}
const phaseOf = (r: BulkExportRunner, id: string) => r.snapshot().find(x => x.id === id)?.phase;

describe('Cancel / Stop all', () => {
  it('a queued row returns to Ready at once; the queue is unaffected', async () => {
    const h = harness(['a', 'b', 'c']);
    selectAll(h.runner);
    await h.runner.startSelected();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'a')).toBe('exporting'));
    h.runner.cancel('b');
    expect(phaseOf(h.runner, 'b')).toBe('idle');
    expect(h.runner.snapshot().find(x => x.id === 'b')?.message).toBeUndefined();
    h.releases.get('a')!();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'c')).toBe('exporting'));
    h.releases.get('c')!();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'c')).toBe('done'));
    expect(h.runs.map(r => r.project.id)).toEqual(['a', 'c']);
  });

  it('the active row aborts and parks "Cancelled — Retry"; the next row runs; no chime', async () => {
    const h = harness(['a', 'b']);
    selectAll(h.runner);
    await h.runner.startSelected();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'a')).toBe('exporting'));
    h.runner.cancel('a');
    expect(h.runs[0]!.signal.aborted).toBe(true);
    await vi.waitFor(() => expect(phaseOf(h.runner, 'a')).toBe('cancelled'));
    expect(h.runner.snapshot().find(x => x.id === 'a')?.message).toBe('Cancelled — Retry');
    await vi.waitFor(() => expect(phaseOf(h.runner, 'b')).toBe('exporting'));
    h.releases.get('b')!();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'b')).toBe('done'));
    expect(h.chimes()).toBe(0);
  });

  it('Retry on a cancelled row resumes from the checkpoint', async () => {
    const h = harness(['a'], { hasCheckpoint: true });
    h.runner.setSelected('a', true);
    await h.runner.startSelected();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'a')).toBe('exporting'));
    h.runner.cancel('a');
    await vi.waitFor(() => expect(phaseOf(h.runner, 'a')).toBe('cancelled'));
    await h.runner.retry('a');
    await vi.waitFor(() => expect(h.runs).toHaveLength(2));
    expect(h.runs[1]!.resume).toBe(true);
  });

  it('Stop all cancels every queued row and aborts the active one', async () => {
    const h = harness(['a', 'b', 'c']);
    selectAll(h.runner);
    await h.runner.startSelected();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'a')).toBe('exporting'));
    expect(h.runner.isActive()).toBe(true);
    h.runner.stopAll();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'a')).toBe('cancelled'));
    expect(phaseOf(h.runner, 'b')).toBe('idle');
    expect(phaseOf(h.runner, 'c')).toBe('idle');
    expect(h.runs).toHaveLength(1);
    expect(h.runner.isActive()).toBe(false);
    expect(h.chimes()).toBe(0);
  });
});

describe('stopAll(ids) — a scoped Cancel all', () => {
  it('cancels only the listed rows; the rest of the queue carries on', async () => {
    const h = harness(['a', 'b', 'c']);
    selectAll(h.runner);
    await h.runner.startSelected();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'a')).toBe('exporting'));
    h.runner.stopAll(['b']);
    expect(phaseOf(h.runner, 'b')).toBe('idle');
    expect(phaseOf(h.runner, 'c')).toBe('queued');
    expect(phaseOf(h.runner, 'a')).toBe('exporting');
    expect(h.chimes()).toBe(0);
    h.releases.get('a')!();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'c')).toBe('exporting'));
  });
});

describe('Finished rows and spent selections', () => {
  it('Done stamps when it finished; Start spends the selection; Clear returns the row to Ready, deselected', async () => {
    const h = harness(['a']);
    h.runner.setSelected('a', true);
    await h.runner.startSelected();
    expect(h.runner.snapshot()[0]!.selected).toBe(false);
    await vi.waitFor(() => expect(phaseOf(h.runner, 'a')).toBe('exporting'));
    h.releases.get('a')!();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'a')).toBe('done'));
    expect(h.runner.snapshot()[0]!.finishedAt).toBeGreaterThan(0);
    h.runner.clearFinished(['a']);
    expect(h.runner.snapshot()[0]).toMatchObject({ phase: 'idle', selected: false, finishedAt: undefined });
  });
});

describe('Reordering the queue', () => {
  it('the operator\'s order decides who exports next; the running export stays first', async () => {
    const h = harness(['a', 'b', 'c', 'd']);
    selectAll(h.runner);
    await h.runner.startSelected();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'a')).toBe('exporting'));
    h.runner.reorderQueue(['d', 'b', 'c']);
    expect([...h.runner.queueOrder().entries()].sort((x, y) => x[1] - y[1]).map(e => e[0])).toEqual(['a', 'd', 'b', 'c']);
    h.releases.get('a')!();
    await vi.waitFor(() => expect(phaseOf(h.runner, 'd')).toBe('exporting'));
    expect(h.runs.map(r => r.project.id)).toEqual(['a', 'd']);
  });
});
