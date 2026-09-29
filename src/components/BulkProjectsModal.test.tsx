// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7.5 — the Bulk Projects modal: rows, slot state, the batch gate,
// per-row phase / cancel / open, close-does-not-cancel.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let finishAtOnce = false;

vi.mock('../services/syncEngineHost', async importActual => ({
  ...(await importActual<typeof import('../services/syncEngineHost')>()),
  readSyncEngineHost: () => 'cloud',
}));
vi.mock('../services/bulkSyncQueue', async () => {
  const { SyncQueue } = await import('../services/syncQueue');
  const engine = {
    workerSec: () => 0, usdPerSec: 0.001, onDrain: () => {},
    cancelReceipt: (_i: unknown, started: boolean) => (started ? 'The cloud had already worked 4.0 s.' : 'It hadn’t started, so nothing was charged.'),
  };
  const queue = new SyncQueue(engine);
  return {
    cloudSyncQueue: queue,
    queueProjectsForCloudSync: (ps: { id: string; name: string }[]) => queue.enqueue(ps.map(p => ({
      id: p.id, label: p.name,
      run: async ctx => { if (finishAtOnce) return { status: 'done' as const }; ctx.setPhase('Transcribing on the cloud…'); await new Promise<void>((_, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('x')))).catch(() => undefined); return { status: 'done' as const }; },
    }))),
  };
});

import { BulkCountDialog, BulkProjectsModal } from './BulkProjectsModal';
import { BulkRowStore, type BulkRowDeps } from '../services/bulkRows';
import { cloudSyncQueue } from '../services/bulkSyncQueue';
import { classifyAndIngestBundleZip } from '../services/bundleIngest';
import type { StagedFiles } from './DropZonePanel';

interface Harness { store: BulkRowStore; created: string[]; purged: string[] }
function store(): Harness {
  const staged = new Map<string, StagedFiles>();
  const created: string[] = [];
  const purged: string[] = [];
  const deps: BulkRowDeps = {
    loadStaged: async id => staged.get(id) ?? null,
    writeStaged: async (id, _p, next) => { staged.set(id, next); },
    createProject: async info => { created.push(info.name); return true; },
    purge: async id => { purged.push(id); staged.delete(id); },
    removeBundleAsset: async () => {},
    hashAudio: async () => 'h', probeDuration: async () => 30,
    cloudActive: () => true, stageAudio: async () => ({}), ingestBundle: classifyAndIngestBundleZip,
  };
  return { store: new BulkRowStore(deps, 25), created, purged };
}
const blank = (): never => ({} as never);

const mount = async (el: React.ReactElement): Promise<{ root: ReturnType<typeof createRoot>; host: HTMLElement }> => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(el); });
  return { root, host };
};
const q = (host: HTMLElement, id: string): HTMLElement | null => host.querySelector(`[data-testid="${id}"]`);

describe('BulkCountDialog', () => {
  it('confirms a whole number in range and refuses everything else', async () => {
    const onConfirm = vi.fn();
    const { host } = await mount(<BulkCountDialog onConfirm={onConfirm} onCancel={() => {}} />);
    const input = q(host, 'bulk-count-input') as HTMLInputElement;
    const confirm = q(host, 'bulk-count-confirm') as HTMLButtonElement;
    expect(input.value).toBe('3');
    const set = async (v: string): Promise<void> => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await set('26');
    expect(confirm.disabled).toBe(true);
    expect(host.textContent).toContain('Enter a whole number from 1 to 25.');
    await set('4');
    expect(confirm.disabled).toBe(false);
    await act(async () => { confirm.click(); });
    expect(onConfirm).toHaveBeenCalledWith(4);
  });
});

const fourFiles = (): File[] => [
  new File(['line'], 'script.txt'), new File(['[a] x\n[b] y\n[c] z'], 'scene.txt'),
  new File(['a'], 'vo.wav'), new File(['i'], 'a.png'),
];
const setValue = async (el: HTMLInputElement, v: string): Promise<void> => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const modal = (h: Harness, count: number, extra: Partial<React.ComponentProps<typeof BulkProjectsModal>> = {}): React.ReactElement => (
  <BulkProjectsModal
    initialCount={count} createBlankProject={blank} parseProjectData={async () => []}
    onOpenProject={() => {}} onClose={() => {}} store={h.store} {...extra}
  />
);
const rowIds = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('[data-testid^="bulk-row-"]')].map(el => el.getAttribute('data-testid')!.replace('bulk-row-', ''));

describe('BulkProjectsModal — draft rows', () => {
  it('opens with N empty rows, creates NOTHING, and Build is off until a row is named and has all four slots', async () => {
    const h = store();
    const { host } = await mount(modal(h, 5));
    expect(rowIds(host)).toHaveLength(5);
    expect(h.created).toEqual([]);
    const [a] = rowIds(host);
    await act(async () => { await h.store.addFiles(a!, fourFiles()); });
    expect((q(host, 'bulk-build') as HTMLButtonElement).disabled).toBe(true);
    const name = q(host, `bulk-name-${a}`) as HTMLInputElement;
    expect(name.placeholder).toBe('Project name (required)');
    await setValue(name, '  Harbour  ');
    expect((q(host, 'bulk-build') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Add project appends a row', async () => {
    const h = store();
    const { host } = await mount(modal(h, 2));
    await act(async () => { (q(host, 'bulk-add') as HTMLButtonElement).click(); });
    expect(rowIds(host)).toHaveLength(3);
  });

  it('wrong files can be removed one by one, or all at once (Clear files), and a whole row can be removed', async () => {
    const h = store();
    const { host } = await mount(modal(h, 2));
    const [a, b] = rowIds(host);
    await act(async () => { await h.store.addFiles(a!, [...fourFiles(), new File(['j'], 'wrong.png')]); });
    await act(async () => { (q(host, `bulk-files-toggle-${a}`) as HTMLButtonElement).click(); });
    expect(q(host, `bulk-files-${a}`)!.textContent).toContain('wrong.png');
    await act(async () => { (host.querySelector('[aria-label="Remove wrong.png"]') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(q(host, `bulk-files-${a}`)!.textContent).not.toContain('wrong.png'));
    expect(q(host, `bulk-files-${a}`)!.textContent).toContain('a.png');
    await act(async () => { (q(host, `bulk-clear-${a}`) as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(q(host, `bulk-slots-${a}`)!.querySelectorAll('[data-filled="true"]')).toHaveLength(0));
    await act(async () => { (q(host, `bulk-remove-${b}`) as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(rowIds(host)).toEqual([a]));
  });

  it('Build creates only the real projects: 5 rows, 2 filled -> 2 projects, the empty ones discarded, the half-filled one kept with its reason; closing discards leftover drafts', async () => {
    finishAtOnce = false;
    cloudSyncQueue.clearFinished();
    const h = store();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const { host } = await mount(modal(h, 5, { onProjectsCreated: onCreated, onClose }));
    const ids = rowIds(host);
    await act(async () => {
      await h.store.addFiles(ids[0]!, fourFiles()); h.store.setTypedName(ids[0]!, 'Alpine');
      await h.store.addFiles(ids[1]!, fourFiles()); h.store.setTypedName(ids[1]!, 'Valley');
      await h.store.addFiles(ids[2]!, [new File(['s'], 'script.txt')]); h.store.setTypedName(ids[2]!, 'Half');
    });
    await act(async () => { (q(host, 'bulk-build') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(h.created).toEqual(['Alpine', 'Valley']));
    expect(onCreated).toHaveBeenCalled();
    await vi.waitFor(() => expect(rowIds(host)).toEqual([ids[0], ids[1], ids[2]]));
    expect(q(host, `bulk-status-${ids[2]}`)!.textContent).toBe('Skipped — Add a scene doc, a voiceover and media to build the timeline');
    expect(q(host, `bulk-status-${ids[0]}`)!.textContent).toBe('Transcribing on the cloud…');
    // The built rows are read-outs now.
    expect((q(host, `bulk-name-${ids[0]}`) as HTMLInputElement).disabled).toBe(true);
    // Closing: the half-filled draft goes; the built ones stay; running jobs are not touched.
    await act(async () => { (q(host, 'bulk-close') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.purged).toContain(ids[2]);
    expect(h.store.snapshot().map(r => r.projectId)).toEqual([ids[0], ids[1]]);
    expect(cloudSyncQueue.snapshot().items[0]!.status).toBe('running');
    // Cancel all: the running row gets its receipt (the queue is a shared singleton).
    await act(async () => { cloudSyncQueue.cancelAll(); });
    await vi.waitFor(() => expect(cloudSyncQueue.snapshot().running).toBe(false));
    await act(async () => {});
    expect(cloudSyncQueue.snapshot().items[0]!.receipt).toBe('The cloud had already worked 4.0 s.');
  });

  it('after the cloud work the modal builds the real timeline: "Building the timeline…" until finished, and only then Open project (one click, already built)', async () => {
    finishAtOnce = true;
    cloudSyncQueue.clearFinished();
    const h = store();
    const onOpen = vi.fn();
    let finish!: (r: { ok: boolean; message?: string }) => void;
    const finalize = vi.fn(() => new Promise<{ ok: boolean; message?: string }>(r => { finish = r; }));
    const { host } = await mount(modal(h, 1, { onOpenProject: onOpen, finalizeProject: finalize }));
    const [id] = rowIds(host);
    await act(async () => { await h.store.addFiles(id!, fourFiles()); h.store.setTypedName(id!, 'Harbour'); });
    await act(async () => { (q(host, 'bulk-build') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledWith(id));
    expect(q(host, `bulk-status-${id}`)!.textContent).toBe('Building the timeline…');
    expect(q(host, `bulk-open-${id}`)).toBeNull();
    await act(async () => { finish({ ok: true }); });
    await vi.waitFor(() => expect(q(host, `bulk-open-${id}`)).not.toBeNull());
    expect(q(host, `bulk-status-${id}`)!.textContent).toBe('Ready');
    await act(async () => { (q(host, `bulk-open-${id}`) as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledWith(id));
    finishAtOnce = false;
  });

  it('a timeline that could not be finished says so and still offers Open project (the project itself is intact)', async () => {
    finishAtOnce = true;
    cloudSyncQueue.clearFinished();
    const h = store();
    const { host } = await mount(modal(h, 1, { finalizeProject: async () => ({ ok: false, message: 'Sync cancelled.' }) }));
    const [id] = rowIds(host);
    await act(async () => { await h.store.addFiles(id!, fourFiles()); h.store.setTypedName(id!, 'Harbour'); });
    await act(async () => { (q(host, 'bulk-build') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(q(host, `bulk-open-${id}`)).not.toBeNull());
    expect(q(host, `bulk-status-${id}`)!.textContent).toContain('the timeline could not be finished');
    expect(q(host, `bulk-status-${id}`)!.textContent).toContain('Sync cancelled.');
    finishAtOnce = false;
  });
});
