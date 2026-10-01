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
import { cloudSyncQueue, queueProjectsForCloudSync } from '../services/bulkSyncQueue';
import { BulkBatchRunner } from '../services/bulkBatch';
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
const memStorage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};
const makeRunner = (finalize?: (id: string, req: { userInitiated: boolean }) => Promise<{ ok: boolean; message?: string; deferred?: boolean }>): BulkBatchRunner => {
  const r = new BulkBatchRunner({
    queue: cloudSyncQueue,
    enqueue: rows => { queueProjectsForCloudSync(rows, async () => []); },
    exists: () => true,
    storage: memStorage(),
  });
  if (finalize) r.setFinalizer(finalize);
  return r;
};

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
    onOpenProject={() => {}} onClose={() => {}} store={h.store} runner={makeRunner()} {...extra}
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

  it('B5: an empty media chip reads "Optional" (no warning icon), and fills to a count once media lands', async () => {
    const h = store();
    const { host } = await mount(modal(h, 1));
    const [id] = rowIds(host);
    const chip = () => q(host, `bulk-slots-${id}`)!.querySelector('[data-slot="media"]')!;
    expect(chip().textContent).toContain('Optional');
    expect(chip().getAttribute('data-filled')).toBe('false');
    await act(async () => { await h.store.addFiles(id!, fourFiles()); });
    expect(chip().textContent).not.toContain('Optional');
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
    expect(q(host, `bulk-status-${ids[2]}`)!.textContent).toBe('Skipped — Add a scene doc and a voiceover to build the timeline');
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
    const { host } = await mount(modal(h, 1, { onOpenProject: onOpen, runner: makeRunner(finalize) }));
    const [id] = rowIds(host);
    await act(async () => { await h.store.addFiles(id!, fourFiles()); h.store.setTypedName(id!, 'Harbour'); });
    await act(async () => { (q(host, 'bulk-build') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledWith(id, { userInitiated: false }));
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
    const { host } = await mount(modal(h, 1, { runner: makeRunner(async () => ({ ok: false, message: 'Sync cancelled.' })) }));
    const [id] = rowIds(host);
    await act(async () => { await h.store.addFiles(id!, fourFiles()); h.store.setTypedName(id!, 'Harbour'); });
    await act(async () => { (q(host, 'bulk-build') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(q(host, `bulk-open-${id}`)).not.toBeNull());
    expect(q(host, `bulk-status-${id}`)!.textContent).toContain('the timeline could not be finished');
    expect(q(host, `bulk-status-${id}`)!.textContent).toContain('Sync cancelled.');
    finishAtOnce = false;
  });

  it('hiding the drawer keeps it mounted and off the editor', async () => {
    const h = store();
    const { host } = await mount(modal(h, 1, { hidden: true }));
    const drawer = q(host, 'bulk-modal')!;
    expect(drawer.getAttribute('data-hidden')).toBe('true');
    expect(drawer.className).toContain('pointer-events-none');
    expect(drawer.getAttribute('aria-hidden')).toBe('true');
    expect(rowIds(host)).toHaveLength(1);
  });

  it('v1.2.2: a mid-run hide and reopen shows the SAME running batch with live progress — no quantity prompt', async () => {
    finishAtOnce = false;
    cloudSyncQueue.clearFinished();
    const h = store();
    const runner = makeRunner();
    const { root, host } = await mount(modal(h, 1, { runner }));
    const [id] = rowIds(host);
    await act(async () => { await h.store.addFiles(id!, fourFiles()); h.store.setTypedName(id!, 'Harbour'); });
    await act(async () => { (q(host, 'bulk-build') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(q(host, `bulk-status-${id}`)!.textContent).toBe('Transcribing on the cloud…'));
    // Hide mid-run, then reopen (the dashboard's / editor handle's door).
    await act(async () => { root.render(modal(h, 0, { runner, hidden: true })); });
    expect(q(host, 'bulk-modal')!.getAttribute('data-hidden')).toBe('true');
    await act(async () => { root.render(modal(h, 0, { runner, hidden: false })); });
    expect(q(host, 'bulk-modal')!.getAttribute('data-hidden')).toBe('false');
    expect(rowIds(host)).toEqual([id]);
    expect(q(host, `bulk-status-${id}`)!.textContent).toBe('Transcribing on the cloud…');
    expect(runner.snapshot().map(r => r.phase)).toEqual(['cloud']);
    expect(host.querySelector('[data-testid="bulk-count-input"]')).toBeNull();
    await act(async () => { cloudSyncQueue.cancelAll(); });
  });

  it('v1.2.2: "New batch" lives inside the drawer — asks how many, adds that many empty rows, running rows untouched', async () => {
    const h = store();
    const { host } = await mount(modal(h, 1));
    const before = rowIds(host);
    const newBatch = q(host, 'bulk-new-batch') as HTMLButtonElement | null;
    expect(newBatch, 'the drawer has no "New batch" control').not.toBeNull();
    await act(async () => { newBatch!.click(); });
    const input = host.querySelector('[data-testid="bulk-count-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await setValue(input, '2');
    await act(async () => { (host.querySelector('[data-testid="bulk-count-confirm"]') as HTMLButtonElement).click(); });
    const after = rowIds(host);
    expect(after).toHaveLength(before.length + 2);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(host.querySelector('[data-testid="bulk-count-input"]')).toBeNull();
  });

  it('v1.2.2: a row deferred while the operator edits reads "Ready — one click to finish", and its Open finishes it', async () => {
    finishAtOnce = true;
    cloudSyncQueue.clearFinished();
    const h = store();
    const onFinishRow = vi.fn();
    const finalize = vi.fn(async () => ({ ok: false, deferred: true }));
    const runner = makeRunner(finalize);
    const { host } = await mount(modal(h, 1, { runner, onFinishRow }));
    const [id] = rowIds(host);
    await act(async () => { await h.store.addFiles(id!, fourFiles()); h.store.setTypedName(id!, 'Harbour'); });
    await act(async () => { (q(host, 'bulk-build') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(q(host, `bulk-status-${id}`)!.textContent).toBe('Ready — one click to finish'));
    expect(finalize).toHaveBeenCalledTimes(1);
    await act(async () => { (q(host, `bulk-open-${id}`) as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(onFinishRow).toHaveBeenCalledWith(id));
    finishAtOnce = false;
  });
});
