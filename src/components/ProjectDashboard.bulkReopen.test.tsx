// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dashboard revamp — the header's bulk button is gone: bulk lives in the
// permanent left panel's Bulk Sync tab, which carries the batch signal. A
// bulk project shows on the grid only once it is built; until then it lives
// in the Bulk Sync tab.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let metas: { id: string; name: string; savedAt: number; segmentCount: number }[] = [];
vi.mock('../services/projectStore', () => ({ loadAllMetas: () => metas, loadProject: async () => null, deleteProjectData: async () => undefined, commitTombstones: async () => undefined, deletedProjectIds: () => new Set() }));
vi.mock('../services/syncEngineHost', async importActual => ({
  ...(await importActual<typeof import('../services/syncEngineHost')>()),
  readSyncEngineHost: () => 'cloud',
}));
vi.mock('../services/cloudSyncEngine', () => ({
  killAllMemberCloudJobs: async () => {},
}));

let batchRows: { id: string; name: string; phase: string }[] = [];
let groupsFor: unknown;
let groupsView: unknown[] = [];
vi.mock('../services/bulkSyncQueue', async () => {
  const { SyncQueue } = await import('../services/syncQueue');
  const queue = new SyncQueue({ workerSec: () => 0, usdPerSec: 0, onDrain: () => {}, cancelReceipt: () => '' });
  return {
    cloudSyncQueue: queue,
    queueProjectsForCloudSync: () => 0,
    bulkBatchRunner: () => ({
      subscribe: () => () => undefined,
      snapshot: () => batchRows,
      groups: () => {
        if (groupsFor !== batchRows) { groupsFor = batchRows; groupsView = [{ id: 'g', name: 'G', collapsed: false, rowIds: batchRows.map(r => r.id) }]; }
        return groupsView;
      },
      forget: () => undefined,
    }),
  };
});

// eslint-disable-next-line import/first
import { ProjectDashboard } from './ProjectDashboard';

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
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
      />,
    );
  });
}

const bulkButtons = (): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="dashboard-left-tab-bulk-sync"]'));

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  batchRows = [];
  metas = [];
});

describe('dashboard bulk door — the left panel Bulk Sync tab, never a header button', () => {
  it('with a batch running: no header bulk button; one Bulk Sync tab that selects its pane, no quantity prompt', async () => {
    batchRows = [{ id: 'p1', name: 'One', phase: 'cloud' }, { id: 'p2', name: 'Two', phase: 'queued' }];
    await mount();
    expect(container.querySelector('[data-testid="dashboard-bulk"]')).toBeNull();
    expect(bulkButtons()).toHaveLength(1);
    await act(async () => { bulkButtons()[0]!.click(); });
    expect(bulkButtons()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-testid="bulk-count-input"]')).toBeNull();
  });

  it('with no batch: the same tab, no quantity prompt', async () => {
    await mount();
    expect(bulkButtons()).toHaveLength(1);
    expect(container.querySelector('[data-testid="bulk-count-input"]')).toBeNull();
  });

  it('1.3.0: Build Timeline flips a row onto the grid — a created bulk project shows while its pipeline runs; a draft (no record yet) never does', async () => {
    metas = [
      { id: 'mine', name: 'Hand made', savedAt: 3, segmentCount: 2 },
      { id: 'p1', name: 'Bulk running', savedAt: 2, segmentCount: 0 },
      { id: 'p2', name: 'Bulk failed', savedAt: 1, segmentCount: 0 },
      { id: 'p3', name: 'Bulk built', savedAt: 0, segmentCount: 5 },
    ];
    batchRows = [{ id: 'p1', name: 'Bulk running', phase: 'cloud' }, { id: 'p2', name: 'Bulk failed', phase: 'failed' }, { id: 'p3', name: 'Bulk built', phase: 'done' }];
    await mount();
    for (const id of ['mine', 'p1', 'p2', 'p3']) expect(container.querySelector(`[data-testid="project-card-${id}"]`)).not.toBeNull();
    expect(container.querySelector('[data-testid="project-card-draft-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="project-card-p2"]')!.textContent).toMatch(/Build failed/);
    batchRows = [{ id: 'p1', name: 'Bulk running', phase: 'cloud' }, { id: 'p2', name: 'Bulk failed', phase: 'paused' }, { id: 'p3', name: 'Bulk built', phase: 'done' }];
    await act(async () => {
      root.render(
        <ProjectDashboard currentProjectId={null} onSelectProject={() => {}} onNewProject={() => {}} onOpenAppSettings={() => {}} parseProjectData={async () => []} />,
      );
    });
    expect(container.querySelector('[data-testid="project-card-p2"]')!.textContent).toMatch(/Paused/);
  });

  it('1.3.0: when the background pipeline makes a row ready, the grid re-reads it (its built scene count shows)', async () => {
    metas = [{ id: 'p1', name: 'Bulk', savedAt: 1, segmentCount: 0 }];
    batchRows = [{ id: 'p1', name: 'Bulk', phase: 'finishing' }];
    await mount();
    expect(container.querySelector('[data-testid="project-card-p1"]')!.textContent).toContain('0 scenes');
    // The pipeline saved the record (7 scenes) and the row turned ready.
    metas = [{ id: 'p1', name: 'Bulk', savedAt: 2, segmentCount: 7 }];
    batchRows = [{ id: 'p1', name: 'Bulk', phase: 'done' }];
    await act(async () => {
      root.render(
        <ProjectDashboard currentProjectId={null} onSelectProject={() => {}} onNewProject={() => {}} onOpenAppSettings={() => {}} parseProjectData={async () => []} />,
      );
    });
    expect(container.querySelector('[data-testid="project-card-p1"]')!.textContent).toContain('7 scenes');
  });
});

describe('U6 — the Bulk Sync tab carries the batch signal', () => {
  it('while running: a small progress ring and "n/m"', async () => {
    batchRows = [{ id: 'p1', name: 'One', phase: 'done' }, { id: 'p2', name: 'Two', phase: 'cloud' }, { id: 'p3', name: 'Three', phase: 'queued' }];
    await mount();
    const button = bulkButtons()[0]!;
    expect(button.querySelector('[data-testid="bulk-ring"]')).not.toBeNull();
    expect(button.querySelector('[data-testid="dashboard-bulk-count"]')!.textContent).toBe('1/3');
    expect(button.querySelector('[data-testid="bulk-failed-dot"]')).toBeNull();
  });

  it('a failed row: a red dot with the count', async () => {
    batchRows = [{ id: 'p1', name: 'One', phase: 'failed' }, { id: 'p2', name: 'Two', phase: 'finish-failed' }, { id: 'p3', name: 'Three', phase: 'done' }];
    await mount();
    expect(bulkButtons()[0]!.querySelector('[data-testid="bulk-failed-dot"]')!.textContent).toBe('2');
  });

  it('1.3.1: after the batch finishes the signal stays — a full ring and "n/m" — until the batch is cleared', async () => {
    batchRows = [{ id: 'p1', name: 'One', phase: 'done' }, { id: 'p2', name: 'Two', phase: 'done' }];
    await mount();
    const button = bulkButtons()[0]!;
    expect(button.querySelector('[data-testid="bulk-ring"]')!.getAttribute('data-progress')).toBe('1');
    expect(button.querySelector('[data-testid="dashboard-bulk-count"]')!.textContent).toBe('2/2');
    expect(button.querySelector('[data-testid="bulk-failed-dot"]')).toBeNull();
  });

  it('no batch at all (or only drafts, nothing built yet): the plain tab', async () => {
    await mount();
    const button = bulkButtons()[0]!;
    expect(button.querySelector('[data-testid="bulk-ring"]')).toBeNull();
    expect(button.textContent).toBe('Bulk Sync');
  });
});
