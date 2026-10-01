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

import { BulkProjectsModal } from './BulkProjectsModal';
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
  return { store: new BulkRowStore(deps, 300), created, purged };
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
/** `count` loose draft rows seeded into the store (0: leave it as it is). */
const modal = (h: Harness, count: number, extra: Partial<React.ComponentProps<typeof BulkProjectsModal>> = {}): React.ReactElement => {
  if (count > 0) h.store.init(count);
  return modalEl(h, extra);
};
const modalEl = (h: Harness, extra: Partial<React.ComponentProps<typeof BulkProjectsModal>>): React.ReactElement => (
  <BulkProjectsModal
    createBlankProject={blank} parseProjectData={async () => []}
    onOpenProject={() => {}} onClose={() => {}} store={h.store} runner={makeRunner()} {...extra}
  />
);
/** The Build Timeline button of the group holding this row. */
const buildFor = (host: HTMLElement, rowId: string): HTMLButtonElement =>
  q(host, `bulk-row-${rowId}`)!.closest('section')!.querySelector('[data-testid^="bulk-build-"]') as HTMLButtonElement;
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
    expect(buildFor(host, a!).disabled).toBe(true);
    const name = q(host, `bulk-name-${a}`) as HTMLInputElement;
    expect(name.placeholder).toBe('Project name');
    expect(name.getAttribute('aria-required')).toBe('true');
    await setValue(name, '  Harbour  ');
    expect(buildFor(host, a!).disabled).toBe(false);
  });

  it('B5: an empty media chip reads just "Media" (media stays optional for Build), and fills to a count once media lands', async () => {
    const h = store();
    const { host } = await mount(modal(h, 1));
    const [id] = rowIds(host);
    const chip = async () => {
      const toggle = q(host, `bulk-files-toggle-${id}`) as HTMLButtonElement;
      if (toggle.getAttribute('aria-expanded') !== 'true') await act(async () => { toggle.click(); });
      return q(host, `bulk-slots-${id}`)!.querySelector('[data-slot="media"]')!;
    };
    await act(async () => {
      await h.store.addFiles(id!, [new File(['line'], 'script.txt'), new File(['[a] x\n[b] y\n[c] z'], 'scene.txt'), new File(['a'], 'vo.wav')]);
    });
    expect((await chip()).textContent).toBe('Media');
    expect((await chip()).getAttribute('data-filled')).toBe('false');
    await act(async () => { await h.store.addFiles(id!, [new File(['i'], 'a.png')]); });
    expect((await chip()).textContent).toBe('Media · 1');
    expect((await chip()).getAttribute('data-filled')).toBe('true');
  });

  it('a group\'s Add project appends a row to it, and stops at 30', async () => {
    const h = store();
    const runner = makeRunner();
    const g = runner.createGroup(h.store.createDrafts(29))!;
    const { host } = await mount(modal(h, 0, { runner }));
    await act(async () => { (q(host, `bulk-add-${g.id}`) as HTMLButtonElement).click(); });
    expect(rowIds(host)).toHaveLength(30);
    expect((q(host, `bulk-add-${g.id}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it('wrong files can be removed one by one, or all at once (Clear files), and a whole row can be removed', async () => {
    const h = store();
    const { host } = await mount(modal(h, 2));
    const [a, b] = rowIds(host);
    await act(async () => { await h.store.addFiles(a!, [...fourFiles(), new File(['j'], 'wrong.png')]); });
    await act(async () => { (q(host, `bulk-files-toggle-${a}`) as HTMLButtonElement).click(); });
    // Media is one row; its own arrow lists the individual files.
    await act(async () => { (q(host, `bulk-media-toggle-${a}`) as HTMLButtonElement).click(); });
    expect(q(host, `bulk-files-${a}`)!.textContent).toContain('wrong.png');
    await act(async () => { (host.querySelector('[aria-label="Delete wrong.png"]') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(q(host, `bulk-files-${a}`)!.textContent).not.toContain('wrong.png'));
    expect(q(host, `bulk-files-${a}`)!.textContent).toContain('a.png');
    await act(async () => { (q(host, `bulk-clear-${a}`) as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(q(host, `bulk-files-toggle-${a}`)!.textContent).toBe('0 files'));
    await act(async () => { (q(host, `bulk-remove-${b}`) as HTMLButtonElement).click(); });
    await act(async () => { (document.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(rowIds(host)).toEqual([a]));
  });

  it('Build creates only the real projects: 5 rows, 2 filled -> 2 projects, the rest stay drafts (the half-filled one with its reason); hiding clears nothing', async () => {
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
    await act(async () => { buildFor(host, ids[0]!).click(); });
    await vi.waitFor(() => expect(h.created).toEqual(['Alpine', 'Valley']));
    expect(onCreated).toHaveBeenCalled();
    await vi.waitFor(() => expect(rowIds(host)).toEqual(ids));
    expect(q(host, `bulk-status-${ids[2]}`)!.textContent).toBe('Skipped — Add a scene doc and a voiceover to build the timeline');
    expect(q(host, `bulk-status-${ids[0]}`)!.textContent).toBe('Transcribing on the cloud…');
    // Files stay editable until the first successful finish.
    expect((q(host, `bulk-name-${ids[0]}`) as HTMLInputElement).disabled).toBe(false);
    // Hiding: every row stays (U5 — nothing clears by itself); running jobs are not touched.
    await act(async () => { (q(host, 'bulk-close') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.purged).toEqual([]);
    expect(h.store.snapshot().map(r => r.projectId)).toEqual(ids);
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
    await act(async () => { buildFor(host, id!).click(); });
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledWith(id, { userInitiated: false }));
    expect(q(host, `bulk-status-${id}`)!.textContent).toBe('Building the timeline…');
    expect((q(host, `bulk-open-${id}`) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { finish({ ok: true }); });
    await vi.waitFor(() => expect(q(host, `bulk-status-${id}`)!.textContent).toBe('Ready'));
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
    await act(async () => { buildFor(host, id!).click(); });
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
    await act(async () => { buildFor(host, id!).click(); });
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

  it('create a group inline: a 2–30 field and "Create Group" — the group appears at once, no popup', async () => {
    const h = store();
    const runner = makeRunner();
    const { host } = await mount(modal(h, 0, { runner }));
    expect(q(host, 'bulk-create-heading')!.textContent).toBe('New group');
    const field = q(host, 'bulk-create-count') as HTMLInputElement;
    const create = q(host, 'bulk-create') as HTMLButtonElement;
    expect(field.getAttribute('aria-label')).toBe('Number of projects');
    expect(field.min).toBe('2');
    expect(field.max).toBe('30');
    for (const bad of ['1', '31', '', '2.5']) {
      await setValue(field, bad);
      expect(create.disabled, `"${bad}" must not create`).toBe(true);
    }
    await setValue(field, '4');
    expect(create.textContent).toBe('Create Group');
    await act(async () => { create.click(); });
    expect(document.querySelector('[data-testid="bulk-count-input"]')).toBeNull();
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(runner.groups()).toHaveLength(1);
    const group = runner.groups()[0]!;
    expect(q(host, `bulk-group-section-${group.id}`)!.querySelectorAll('[data-testid^="bulk-row-"]')).toHaveLength(4);
    // A group's own "Add project" adds a row to THAT group.
    await act(async () => { (q(host, `bulk-add-${group.id}`) as HTMLButtonElement).click(); });
    expect(runner.groups()[0]!.rowIds).toHaveLength(5);
  });

  it('at most 5 groups exist at a time: at 5, "Create Group" is off and says why', async () => {
    const h = store();
    const runner = makeRunner();
    for (let g = 0; g < 5; g += 1) runner.createGroup([`g${g}a`, `g${g}b`]);
    const { host } = await mount(modal(h, 0, { runner }));
    expect((q(host, 'bulk-create') as HTMLButtonElement).disabled).toBe(true);
    expect(host.textContent).toContain('Up to 5 groups');
  });

  it('a group can be renamed in place (Enter saves, Escape cancels)', async () => {
    const h = store();
    const runner = makeRunner();
    const g = runner.createGroup(h.store.createDrafts(2))!;
    const { host } = await mount(modal(h, 0, { runner }));
    await act(async () => { (q(host, `bulk-group-rename-${g.id}`) as HTMLButtonElement).click(); });
    const input = q(host, `bulk-group-name-${g.id}`) as HTMLInputElement;
    expect(input.value).toBe('Group 1');
    await setValue(input, 'Client A');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(runner.groups()[0]!.name).toBe('Client A');
    expect(q(host, `bulk-group-${g.id}`)!.textContent).toContain('Client A');
    await act(async () => { (q(host, `bulk-group-rename-${g.id}`) as HTMLButtonElement).click(); });
    const again = q(host, `bulk-group-name-${g.id}`) as HTMLInputElement;
    await setValue(again, 'Nope');
    await act(async () => { again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(runner.groups()[0]!.name).toBe('Client A');
  });

  it('each group has its own Build Timeline: it builds only that group\'s rows; there is no bottom Build or Cancel-all button and no intro text', async () => {
    finishAtOnce = false;
    cloudSyncQueue.clearFinished();
    const h = store();
    const runner = makeRunner();
    const g1 = runner.createGroup(h.store.createDrafts(2))!;
    const g2 = runner.createGroup(h.store.createDrafts(2))!;
    const { host } = await mount(modal(h, 0, { runner }));
    expect(q(host, 'bulk-build')).toBeNull();
    expect(q(host, 'bulk-cancel-all')).toBeNull();
    expect(host.textContent).not.toContain('Drop files onto a row');
    await act(async () => {
      await h.store.addFiles(g1.rowIds[0]!, fourFiles()); h.store.setTypedName(g1.rowIds[0]!, 'One');
      await h.store.addFiles(g2.rowIds[0]!, fourFiles()); h.store.setTypedName(g2.rowIds[0]!, 'Two');
    });
    const b1 = q(host, `bulk-build-${g1.id}`) as HTMLButtonElement;
    expect(b1.textContent).toBe('Build Timeline');
    await act(async () => { b1.click(); });
    await vi.waitFor(() => expect(h.created).toEqual(['One']));
    expect(runner.snapshot().map(r => r.id)).toEqual([g1.rowIds[0]]);
    expect((q(host, `bulk-build-${g2.id}`) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { cloudSyncQueue.cancelAll(); });
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
    await act(async () => { buildFor(host, id!).click(); });
    await vi.waitFor(() => expect(q(host, `bulk-status-${id}`)!.textContent).toBe('Ready — one click to finish'));
    expect(finalize).toHaveBeenCalledTimes(1);
    await act(async () => { (q(host, `bulk-open-${id}`) as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(onFinishRow).toHaveBeenCalledWith(id));
    finishAtOnce = false;
  });
});

const seededRunner = (rows: { id: string; name: string; phase: string }[], groups: { id: string; name: string; collapsed: boolean; rowIds: string[] }[]): BulkBatchRunner => {
  const disk = memStorage();
  disk.setItem('kinetix:bulk-batch:v1', JSON.stringify({ rows, groups }));
  return new BulkBatchRunner({ queue: cloudSyncQueue, enqueue: () => {}, exists: () => true, storage: disk });
};

describe('Bulk UI rebuild U2 — left-edge drawer with group headers', () => {
  it('the drawer sits on the LEFT edge and slides out to the left when hidden', async () => {
    const h = store();
    const { root, host } = await mount(modal(h, 0));
    const drawer = q(host, 'bulk-modal')!;
    expect(drawer.className).toContain('left-0');
    expect(drawer.className).not.toContain('right-0');
    await act(async () => { root.render(modal(h, 0, { hidden: true })); });
    expect(q(host, 'bulk-modal')!.className).toContain('-translate-x-full');
  });

  it('rows render under their group header (ring, n/m done, red dot); collapse hides the rows and persists', async () => {
    const h = store();
    const runner = seededRunner(
      [{ id: 'a', name: 'A', phase: 'done' }, { id: 'b', name: 'B', phase: 'failed' }, { id: 'c', name: 'C', phase: 'done' }, { id: 'd', name: 'D', phase: 'done' }],
      [{ id: 'g1', name: 'Client A', collapsed: false, rowIds: ['a', 'b'] }, { id: 'g2', name: 'Client B', collapsed: false, rowIds: ['c', 'd'] }],
    );
    const { host } = await mount(modal(h, 0, { runner }));
    const g1 = q(host, 'bulk-group-section-g1')!;
    expect(g1.querySelector('[data-testid="bulk-group-count-g1"]')!.textContent).toBe('1/2 done');
    expect(g1.querySelector('[data-testid="bulk-failed-dot"]')!.textContent).toBe('1');
    expect(g1.querySelectorAll('[data-testid^="bulk-row-"]')).toHaveLength(2);
    expect(q(host, 'bulk-group-section-g2')!.querySelector('[data-testid="bulk-failed-dot"]')).toBeNull();
    await act(async () => { (q(host, 'bulk-group-toggle-g1') as HTMLButtonElement).click(); });
    expect(q(host, 'bulk-group-section-g1')!.querySelectorAll('[data-testid^="bulk-row-"]')).toHaveLength(0);
    expect(runner.groups()[0]!.collapsed).toBe(true);
  });
});

const pick = async (input: HTMLInputElement, files: File[]): Promise<void> => {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
};

describe('Bulk UI rebuild U4 — row files', () => {
  it('one Upload button opens a small menu: "Files & zips…" and "Folder…"', async () => {
    const h = store();
    const { host } = await mount(modal(h, 2));
    const [a] = rowIds(host);
    expect(host.querySelectorAll(`[data-testid="bulk-row-${a}"] [aria-label="Upload"]`)).toHaveLength(1);
    expect(q(host, `bulk-upload-menu-${a}`)).toBeNull();
    await act(async () => { (q(host, `bulk-upload-${a}`) as HTMLButtonElement).click(); });
    const items = [...q(host, `bulk-upload-menu-${a}`)!.querySelectorAll('[role="menuitem"]')].map(el => el.textContent);
    expect(items).toEqual(['Files & zips…', 'Folder…']);
  });

  it('expanded: each file can be replaced or deleted, and the whole row replaced or deleted', async () => {
    const h = store();
    const { host } = await mount(modal(h, 2));
    const [a, b] = rowIds(host);
    await act(async () => { await h.store.addFiles(a!, fourFiles()); await h.store.addFiles(b!, fourFiles()); });
    await act(async () => { (q(host, `bulk-files-toggle-${a}`) as HTMLButtonElement).click(); });
    const list = q(host, `bulk-files-${a}`)!;
    expect(list.querySelector('[aria-label="Replace script.txt"]')).not.toBeNull();
    expect(list.querySelector('[aria-label="Delete script.txt"]')).not.toBeNull();
    // Replace the script.
    await act(async () => { (list.querySelector('[aria-label="Replace script.txt"]') as HTMLButtonElement).click(); });
    await pick(q(host, `bulk-replace-input-${a}`) as HTMLInputElement, [new File(['new'], 'better.txt')]);
    await vi.waitFor(() => expect(q(host, `bulk-files-${a}`)!.textContent).toContain('better.txt'));
    expect(q(host, `bulk-files-${a}`)!.textContent).not.toContain('script.txt');
    // Replace all.
    await pick(q(host, `bulk-replace-all-input-${a}`) as HTMLInputElement, [new File(['x'], 'only.png')]);
    await vi.waitFor(() => expect(h.store.snapshot().find(r => r.projectId === a)!.files.map(f => f.name)).toEqual(['only.png']));
    // Delete all.
    await act(async () => { (q(host, `bulk-clear-${a}`) as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(h.store.snapshot().find(r => r.projectId === a)!.files).toEqual([]));
    // Row b never moved.
    expect(h.store.snapshot().find(r => r.projectId === b)!.files.map(f => f.name)).toEqual(['script.txt', 'scene.txt', 'vo.wav', 'a.png']);
  });

  it('the four chips read Script · Scenes · Audio · Media, each with its type icon, on one line — inside the expanded detail', async () => {
    const h = store();
    const { host } = await mount(modal(h, 2));
    const [a] = rowIds(host);
    expect(q(host, `bulk-slots-${a}`)).toBeNull();
    await act(async () => { await h.store.addFiles(a!, fourFiles()); });
    await act(async () => { (q(host, `bulk-files-toggle-${a}`) as HTMLButtonElement).click(); });
    const slots = q(host, `bulk-slots-${a}`)!;
    expect(slots.className).toContain('flex-nowrap');
    const chips = [...slots.querySelectorAll('[data-slot]')];
    expect(chips.map(c => c.textContent)).toEqual(['Script', 'Scenes', 'Audio', 'Media · 1']);
    for (const c of chips) expect(c.querySelector('svg')).not.toBeNull();
  });
});

describe('Bulk UI rebuild U5 — delete and persist', () => {
  it('deleting a draft row asks first; Cancel keeps it, Delete removes the row, its files and its group slot', async () => {
    const h = store();
    const runner = makeRunner();
    const g = runner.createGroup(h.store.createDrafts(3))!;
    const { host } = await mount(modal(h, 0, { runner }));
    const [a] = g.rowIds;
    await act(async () => { await h.store.addFiles(a!, fourFiles()); });
    await act(async () => { (q(host, `bulk-remove-${a}`) as HTMLButtonElement).click(); });
    expect(document.querySelector('[role="dialog"][aria-label="Delete this project?"]')).not.toBeNull();
    await act(async () => { (document.querySelector('[data-testid="confirm-dialog-cancel"]') as HTMLButtonElement).click(); });
    expect(rowIds(host)).toContain(a);
    expect(h.purged).toEqual([]);
    await act(async () => { (q(host, `bulk-remove-${a}`) as HTMLButtonElement).click(); });
    await act(async () => { (document.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(rowIds(host)).not.toContain(a));
    expect(h.purged).toEqual([a]);
    expect(runner.groups()[0]!.rowIds).toEqual(g.rowIds.slice(1));
  });

  it('deleting a built row removes its record and deletes the project (files included)', async () => {
    const h = store();
    const runner = seededRunner(
      [{ id: 'p1', name: 'One', phase: 'done' }, { id: 'p2', name: 'Two', phase: 'failed' }],
      [{ id: 'g1', name: 'G', collapsed: false, rowIds: ['p1', 'p2'] }],
    );
    const deleted: string[] = [];
    const onProjectsDeleted = vi.fn();
    const { host } = await mount(modal(h, 0, { runner, deleteProject: async id => { deleted.push(id); return []; }, onProjectsDeleted }));
    await act(async () => { (q(host, 'bulk-remove-p2') as HTMLButtonElement).click(); });
    expect(document.querySelector('[role="dialog"][aria-label="Delete this project?"]')!.textContent).toContain('and the project with them');
    await act(async () => { (document.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(deleted).toEqual(['p2']));
    expect(runner.snapshot().map(r => r.id)).toEqual(['p1']);
    expect(rowIds(host)).toEqual(['p1']);
    expect(onProjectsDeleted).toHaveBeenCalledWith(['p2'], []);
  });

  it('each group has its own "Clear finished", shown only when it has finished rows; it clears only that group', async () => {
    const h = store();
    const runner = seededRunner(
      [{ id: 'a', name: 'A', phase: 'done' }, { id: 'b', name: 'B', phase: 'cloud' }, { id: 'c', name: 'C', phase: 'done' }, { id: 'd', name: 'D', phase: 'queued' }],
      [{ id: 'g1', name: 'One', collapsed: false, rowIds: ['a', 'b'] }, { id: 'g2', name: 'Two', collapsed: false, rowIds: ['c', 'd'] }],
    );
    const { host } = await mount(modal(h, 0, { runner }));
    expect(q(host, 'bulk-clear-finished')).toBeNull();
    await act(async () => { (q(host, 'bulk-clear-finished-g1') as HTMLButtonElement).click(); });
    expect(runner.snapshot().map(r => r.id)).toEqual(['b', 'c', 'd']);
    expect(q(host, 'bulk-clear-finished-g1')).toBeNull();
    expect(q(host, 'bulk-clear-finished-g2')).not.toBeNull();
  });
});

describe('1.3.0 landing — the background pipeline drives drawer rows to ready', () => {
  it('with the drawer hidden, Build Timeline → cloud → background finish → "Ready" with Open enabled; nothing opens or navigates', async () => {
    finishAtOnce = true;
    cloudSyncQueue.clearFinished();
    const h = store();
    const onOpen = vi.fn();
    const onFinishRow = vi.fn();
    const finalize = vi.fn(async () => ({ ok: true }));
    const runner = makeRunner(finalize);
    const g = runner.createGroup(h.store.createDrafts(2))!;
    const [id] = g.rowIds;
    const { root, host } = await mount(modal(h, 0, { runner, onOpenProject: onOpen, onFinishRow }));
    await act(async () => { await h.store.addFiles(id!, fourFiles()); h.store.setTypedName(id!, 'Harbour'); });
    await act(async () => { buildFor(host, id!).click(); });
    await act(async () => { root.render(modal(h, 0, { runner, onOpenProject: onOpen, onFinishRow, hidden: true })); });
    await vi.waitFor(() => expect(runner.snapshot().find(r => r.id === id)?.phase).toBe('done'));
    expect(finalize).toHaveBeenCalledWith(id, { userInitiated: false });
    expect(q(host, `bulk-status-${id}`)!.textContent).toBe('Ready');
    const open = q(host, `bulk-open-${id}`) as HTMLButtonElement;
    expect(open).not.toBeNull();
    expect(open.disabled).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onFinishRow).not.toHaveBeenCalled();
    expect(q(host, `bulk-group-count-${g.id}`)!.textContent).toBe('1/2 done');
    finishAtOnce = false;
  });
});

describe('1.3.2 — operator 1.3.1 follow-ups', () => {
  it('F6: stage chips live only in the expanded file list, and Open is enabled once the project record exists (paused/failed included)', async () => {
    const h = store();
    const runner = makeRunner();
    const g = runner.createGroup(h.store.createDrafts(2))!;
    const [id] = g.rowIds;
    runner.start([{ id: id!, name: 'Harbour' }]);
    const row = runner.snapshot().find(r => r.id === id)!;
    row.phase = 'paused';
    row.message = 'CUDA OOM on worker-7';
    row.checkpoint = 'staged';
    const { host } = await mount(modal(h, 0, { runner }));
    expect(q(host, `bulk-stages-${id}`)).toBeNull();
    await act(async () => { await h.store.addFiles(id!, fourFiles()); });
    expect(q(host, `bulk-stages-${id}`)).toBeNull();
    await act(async () => { (q(host, `bulk-files-toggle-${id}`) as HTMLButtonElement).click(); });
    expect(q(host, `bulk-stages-${id}`)).not.toBeNull();
    const open = q(host, `bulk-open-${id}`) as HTMLButtonElement;
    expect(open.disabled).toBe(false);
  });

  it('F5: the truncated status line is clickable and the popover shows the full message', async () => {
    const h = store();
    const runner = makeRunner();
    const g = runner.createGroup(h.store.createDrafts(2))!;
    const [id] = g.rowIds;
    runner.start([{ id: id!, name: 'Harbour' }]);
    const row = runner.snapshot().find(r => r.id === id)!;
    row.phase = 'failed';
    row.message = 'The cloud job failed (worker-error). CUDA OOM on worker-7: device-side assert';
    row.workerSec = 12;
    const { host } = await mount(modal(h, 0, { runner }));
    const status = q(host, `bulk-status-${id}`)!;
    expect(status.getAttribute('role')).toBe('button');
    await act(async () => { (status as HTMLButtonElement).click(); });
    const pop = q(host, `bulk-status-pop-${id}`)!;
    expect(pop.textContent).toContain('CUDA OOM on worker-7');
    expect(pop.textContent).toMatch(/\$|s worked/);
  });

  it('F6: footer grammar is "1 project" and the cost line counts failed-row GPU time', async () => {
    const h = store();
    const runner = makeRunner();
    const g = runner.createGroup(h.store.createDrafts(2))!;
    const [id] = g.rowIds;
    runner.start([{ id: id!, name: 'Harbour' }]);
    const row = runner.snapshot().find(r => r.id === id)!;
    row.phase = 'failed';
    row.workerSec = 40;
    const { host } = await mount(modal(h, 0, { runner }));
    const footer = q(host, 'bulk-batch-line')?.textContent ?? q(host, 'bulk-footer')!.textContent ?? '';
    expect(footer).not.toMatch(/1 projects/);
    expect(footer).not.toContain('no cloud GPU time used');
    expect(footer).toMatch(/40 s worked/);
  });
});

describe('1.3.1 — row files, message line, docking', () => {
  it('every row shows its file count on its own line — "0 files" (arrow off) before any upload', async () => {
    const h = store();
    const { host } = await mount(modal(h, 2));
    const [a] = rowIds(host);
    const toggle = q(host, `bulk-files-toggle-${a}`) as HTMLButtonElement;
    expect(toggle.textContent).toBe('0 files');
    expect(toggle.disabled).toBe(true);
  });

  it('the Media row replaces or deletes ONLY the media (delete asks first); script, scenes and audio stay', async () => {
    const h = store();
    const { host } = await mount(modal(h, 2));
    const [a] = rowIds(host);
    await act(async () => { await h.store.addFiles(a!, [...fourFiles(), new File(['j'], 'b.png')]); });
    await act(async () => { (q(host, `bulk-files-toggle-${a}`) as HTMLButtonElement).click(); });
    const list = q(host, `bulk-files-${a}`)!;
    expect(list.querySelector('[aria-label="Replace all media (a bundle zip replaces every slot)"]')).not.toBeNull();
    await act(async () => { await h.store.replaceMedia(a!, [new File(['n'], 'new.png'), new File(['t'], 'ignored.txt')]); });
    const names = (): string[] => h.store.snapshot().find(r => r.projectId === a)!.files.map(f => f.name);
    expect(names()).toEqual(['script.txt', 'scene.txt', 'vo.wav', 'new.png']);
    await act(async () => { (q(host, `bulk-media-delete-${a}`) as HTMLButtonElement).click(); });
    expect(document.querySelector('[role="dialog"][aria-label="Delete all media?"]')).not.toBeNull();
    await act(async () => { (document.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(names()).toEqual(['script.txt', 'scene.txt', 'vo.wav']));
  });

  it('several messages share ONE line: ‹ n/m › steps through them; the status comes first', async () => {
    const h = store();
    const { host } = await mount(modal(h, 2));
    const [a] = rowIds(host);
    await act(async () => { await h.store.addFiles(a!, [...fourFiles(), new File(['?'], 'notes.pdf')]); });
    const status = (): string => q(host, `bulk-status-${a}`)!.textContent ?? '';
    const first = status();
    const arrows = q(host, `bulk-msgs-${a}`)!;
    expect(arrows.textContent).toContain('1/2');
    await act(async () => { (arrows.querySelector('[aria-label="Next message"]') as HTMLButtonElement).click(); });
    expect(status()).toContain('skipped');
    await act(async () => { (q(host, `bulk-msgs-${a}`)!.querySelector('[aria-label="Previous message"]') as HTMLButtonElement).click(); });
    expect(status()).toBe(first);
  });

  it('docked beside the dashboard it is a flat column; over content it casts a shadow', async () => {
    const h = store();
    const { root, host } = await mount(modal(h, 0, { docked: true }));
    expect(q(host, 'bulk-modal')!.className).not.toContain('shadow-[');
    await act(async () => { root.render(modal(h, 0, { docked: false })); });
    expect(q(host, 'bulk-modal')!.className).toContain('shadow-[');
  });
});
