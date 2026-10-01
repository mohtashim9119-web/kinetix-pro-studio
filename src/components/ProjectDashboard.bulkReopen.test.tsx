// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// v1.2.2 — operator report on v1.2.1: closing the bulk drawer mid-run and
// pressing the dashboard's bulk button asked for a NEW batch quantity instead
// of showing the running batch. With a batch, the dashboard's ONE bulk button
// opens that batch; creating a new one lives inside the drawer. With no batch,
// the button starts a create exactly as before.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../services/projectStore', () => ({ loadAllMetas: () => [], loadProject: async () => null, deleteProjectData: async () => undefined }));
vi.mock('../services/syncEngineHost', async importActual => ({
  ...(await importActual<typeof import('../services/syncEngineHost')>()),
  readSyncEngineHost: () => 'cloud',
}));

let batchRows: { id: string; name: string; phase: string }[] = [];
vi.mock('../services/bulkSyncQueue', async () => {
  const { SyncQueue } = await import('../services/syncQueue');
  const queue = new SyncQueue({ workerSec: () => 0, usdPerSec: 0, onDrain: () => {}, cancelReceipt: () => '' });
  return {
    cloudSyncQueue: queue,
    queueProjectsForCloudSync: () => 0,
    bulkBatchRunner: () => ({
      subscribe: () => () => undefined,
      snapshot: () => batchRows,
      forget: () => undefined,
    }),
  };
});

// eslint-disable-next-line import/first
import { ProjectDashboard } from './ProjectDashboard';

let container: HTMLDivElement;
let root: Root;

async function mount(onBulkStart: (n: number) => void): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ProjectDashboard
        currentProjectId={null}
        onSelectProject={() => {}}
        onNewProject={() => {}}
        onOpenAppSettings={() => {}}
        parseProjectData={async () => []}
        onBulkStart={onBulkStart}
      />,
    );
  });
}

const bulkButtons = (): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid^="dashboard-bulk"]'));

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  batchRows = [];
});

describe('dashboard bulk entry — a running batch is reopened, never re-created', () => {
  it('with a batch running, the one bulk button opens THAT batch and never asks for a quantity', async () => {
    batchRows = [
      { id: 'p1', name: 'One', phase: 'cloud' },
      { id: 'p2', name: 'Two', phase: 'queued' },
      { id: 'p3', name: 'Three', phase: 'queued' },
    ];
    const onBulkStart = vi.fn();
    await mount(onBulkStart);
    const buttons = bulkButtons();
    expect(
      buttons.map(b => b.textContent),
      'a running batch must leave ONE dashboard door, and it must be the existing batch',
    ).toEqual(['View batch (3)']);
    await act(async () => { buttons[0]!.click(); });
    expect(onBulkStart).toHaveBeenCalledWith(0);
    expect(container.querySelector('[data-testid="bulk-count-input"]'), 'a mid-run reopen prompted for a new quantity').toBeNull();
  });

  it('with no batch, the button starts a create as today (how many? then the rows)', async () => {
    const onBulkStart = vi.fn();
    await mount(onBulkStart);
    const buttons = bulkButtons();
    expect(buttons.map(b => b.textContent)).toEqual(['Bulk Projects']);
    await act(async () => { buttons[0]!.click(); });
    expect(container.querySelector('[data-testid="bulk-count-input"]')).not.toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-count-confirm"]')!.click(); });
    expect(onBulkStart).toHaveBeenCalledWith(3);
  });
});
