// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../services/projectStore', () => ({
  loadAllMetas: () => [{ id: 'p1', name: 'One', savedAt: 1, segmentCount: 1 }],
  loadProject: async () => null,
  deleteProjectData: async () => undefined,
  commitTombstones: async () => undefined,
  deletedProjectIds: () => new Set(),
}));
vi.mock('../services/syncEngineHost', async importActual => ({
  ...(await importActual<typeof import('../services/syncEngineHost')>()),
  readSyncEngineHost: () => 'local',
}));
const emptyRows: unknown[] = [];
const emptyGroups: unknown[] = [];
vi.mock('../services/bulkSyncQueue', async () => {
  const { SyncQueue } = await import('../services/syncQueue');
  const queue = new SyncQueue({ workerSec: () => 0, usdPerSec: 0, onDrain: () => {}, cancelReceipt: () => '' });
  return {
    cloudSyncQueue: queue,
    queueProjectsForCloudSync: () => 0,
    bulkBatchRunner: () => ({
      subscribe: () => () => undefined,
      snapshot: () => emptyRows,
      groups: () => emptyGroups,
      forget: () => undefined,
    }),
  };
});

import { ProjectDashboard } from './ProjectDashboard';

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('dashboard Bulk Export door', () => {
  it('the header has no Bulk Export button; Bulk Export is a left-panel tab', async () => {
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
        />,
      );
    });
    expect(container.querySelector('[data-testid="dashboard-bulk-export"]')).toBeNull();
    const tab = container.querySelector<HTMLButtonElement>('[data-testid="dashboard-left-tab-bulk-export"]');
    expect(tab?.textContent).toBe('Bulk Export');
    await act(async () => { tab!.click(); });
    expect(tab!.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector<HTMLElement>('[data-testid="dashboard-left-pane-bulk-export"]')!.hidden).toBe(false);
  });
});
