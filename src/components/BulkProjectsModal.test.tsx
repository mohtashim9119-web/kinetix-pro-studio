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

function store(): BulkRowStore {
  const staged = new Map<string, StagedFiles>();
  const deps: BulkRowDeps = {
    loadStaged: async id => staged.get(id) ?? null,
    writeStaged: async (id, _p, next) => { staged.set(id, next); },
    loadProject: async id => ({ project: { id, assets: [] } as never }),
    saveProject: async () => ({ ok: true }),
    hashAudio: async () => 'h', probeDuration: async () => 30,
    cloudActive: () => true, stageAudio: async () => ({}), ingestBundle: classifyAndIngestBundleZip,
  };
  return new BulkRowStore(deps);
}

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

describe('BulkProjectsModal', () => {
  it('one row per project; Build is off until a row has all four slots; incomplete rows are skipped with their reason; a built row offers Open project; closing does not cancel', async () => {
    const s = store();
    const projects = [{ id: 'p1', name: 'Bulk Project 1' }, { id: 'p2', name: 'Bulk Project 2' }, { id: 'p3', name: 'Bulk Project 3' }];
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const { host } = await mount(
      <BulkProjectsModal projects={projects} parseProjectData={async () => []} onOpenProject={onOpen} onClose={onClose} store={s} />,
    );
    expect(host.querySelectorAll('[data-testid^="bulk-row-"]')).toHaveLength(3);
    expect((q(host, 'bulk-build') as HTMLButtonElement).disabled).toBe(true);

    // Row 1 gets all four slots (a bundle zip's own fill is bulkRows.test.ts, against
    // real jszip); row 2 only a script; row 3 nothing.
    await act(async () => { await s.addFiles('p2', [new File(['just a script'], 'script.txt')]); });
    await act(async () => {
      await s.addFiles('p1', [
        new File(['line'], 'script.txt'), new File(['[a] x\n[b] y\n[c] z'], 'scene.txt'),
        new File(['a'], 'vo.wav'), new File(['i'], 'a.png'),
      ]);
    });
    expect(q(host, 'bulk-slots-p1')!.querySelectorAll('[data-filled="true"]')).toHaveLength(4);
    expect(q(host, 'bulk-slots-p2')!.querySelectorAll('[data-filled="true"]')).toHaveLength(1);
    expect((q(host, 'bulk-build') as HTMLButtonElement).disabled).toBe(false);

    await act(async () => { (q(host, 'bulk-build') as HTMLButtonElement).click(); });
    expect(q(host, 'bulk-status-p2')!.textContent).toBe('Skipped — Add a scene doc, a voiceover and media to build the timeline');
    expect(q(host, 'bulk-status-p3')!.textContent).toBe('Skipped — Add a script, a scene doc, a voiceover and media to build the timeline');
    // p1 is running: live phase, a Cancel, no Open yet.
    expect(q(host, 'bulk-status-p1')!.textContent).toBe('Transcribing on the cloud…');
    expect(q(host, 'bulk-open-p1')).toBeNull();

    // Closing the modal does not touch the queue.
    await act(async () => { (q(host, 'bulk-close') as HTMLButtonElement).click(); });
    expect(onClose).toHaveBeenCalled();
    expect(cloudSyncQueue.snapshot().items[0]!.status).toBe('running');

    // Cancel the running row: receipt on the row, queue idle.
    await act(async () => { (q(host, 'bulk-cancel-p1') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(cloudSyncQueue.snapshot().running).toBe(false));
    await act(async () => {});
    expect(q(host, 'bulk-receipt-p1')!.textContent).toBe('The cloud had already worked 4.0 s.');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a project whose timeline is built shows Open project, which opens exactly that project', async () => {
    finishAtOnce = true;
    cloudSyncQueue.clearFinished();
    const s = store();
    const onOpen = vi.fn();
    const { host } = await mount(
      <BulkProjectsModal projects={[{ id: 'z1', name: 'Bulk Project 1' }]} parseProjectData={async () => []} onOpenProject={onOpen} onClose={() => {}} store={s} />,
    );
    await act(async () => {
      await s.addFiles('z1', [
        new File(['line'], 'script.txt'), new File(['[a] x\n[b] y\n[c] z'], 'scene.txt'),
        new File(['a'], 'vo.wav'), new File(['i'], 'a.png'),
      ]);
    });
    await act(async () => { (q(host, 'bulk-build') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(q(host, 'bulk-open-z1')).not.toBeNull());
    await act(async () => { (q(host, 'bulk-open-z1') as HTMLButtonElement).click(); });
    expect(onOpen).toHaveBeenCalledWith('z1');
    expect(q(host, 'bulk-batch-line')!.textContent).toContain('1 projects: 1 built');
    finishAtOnce = false;
  });
});
