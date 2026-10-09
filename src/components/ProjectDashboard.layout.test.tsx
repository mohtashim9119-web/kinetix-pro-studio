// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dashboard revamp Stage 1 — two fixed panels: a permanent left panel
// (Workspaces | Bulk Sync | Bulk Export, no close button) and the right
// panel (the grid), whose header keeps New Project but no bulk buttons.

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

const q = (id: string): HTMLElement | null => container.querySelector(`[data-testid="${id}"]`);

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('dashboard — two fixed panels', () => {
  it('renders the left panel and the right panel side by side', async () => {
    await mount();
    const left = q('dashboard-left-panel');
    const right = q('dashboard-right-panel');
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left!.parentElement).toBe(right!.parentElement);
    expect(left!.classList.contains('kxd-left')).toBe(true);
    expect(right!.classList.contains('kxd-right')).toBe(true);
  });

  it('the left panel has a title, three tabs in order, and NO close button', async () => {
    await mount();
    const left = q('dashboard-left-panel')!;
    expect(left.querySelector('h2')?.textContent).toBe('Studio');
    const tabs = Array.from(left.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map(t => t.textContent)).toEqual(['Workspaces', 'Bulk Sync', 'Bulk Export']);
    expect(left.querySelector('[aria-label="Close"]')).toBeNull();
    expect(left.querySelector('[data-testid="bulk-close"]')).toBeNull();
    expect(left.querySelector('[data-testid="bulk-export-close"]')).toBeNull();
  });

  it('exactly one pane shows at a time and a tab click switches it', async () => {
    await mount();
    const visible = (): string[] =>
      Array.from(container.querySelectorAll<HTMLElement>('[role="tabpanel"]')).filter(p => !p.hidden).map(p => p.dataset.testid ?? '');
    expect(visible()).toHaveLength(1);
    await act(async () => { (q('dashboard-left-tab-bulk-sync') as HTMLButtonElement).click(); });
    expect(visible()).toEqual(['dashboard-left-pane-bulk-sync']);
    expect(q('dashboard-left-tab-bulk-sync')!.getAttribute('aria-selected')).toBe('true');
    await act(async () => { (q('dashboard-left-tab-bulk-export') as HTMLButtonElement).click(); });
    expect(visible()).toEqual(['dashboard-left-pane-bulk-export']);
  });

  it('the right header keeps New Project and has no Bulk Projects / Bulk Export buttons', async () => {
    await mount();
    const right = q('dashboard-right-panel')!;
    expect(right.querySelector('[data-testid="dashboard-bulk"]')).toBeNull();
    expect(right.querySelector('[data-testid="dashboard-bulk-export"]')).toBeNull();
    expect(Array.from(right.querySelectorAll('button')).some(b => b.textContent?.includes('New Project'))).toBe(true);
  });
});

describe('dashboard — tab content App keeps mounted (Bulk Sync / Bulk Export)', () => {
  it('the pane adopts App\'s stable host element; unmounting the dashboard (editor up) only detaches it', async () => {
    const host = document.createElement('div');
    const content = document.createElement('p');
    content.dataset.testid = 'portaled-content';
    host.appendChild(content);
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
          leftTab="bulk-sync"
          paneHosts={{ 'bulk-sync': host }}
        />,
      );
    });
    expect(q('dashboard-left-pane-bulk-sync')!.contains(content)).toBe(true);
    act(() => root.unmount());
    expect(host.isConnected).toBe(false);
    expect(host.firstChild).toBe(content);
    // afterEach unmounts again: give it a fresh root.
    root = createRoot(container);
  });

  it('a controlled left tab reports clicks and follows the prop', async () => {
    const seen: string[] = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const render = async (tab: 'workspaces' | 'bulk-sync' | 'bulk-export'): Promise<void> => {
      await act(async () => {
        root.render(
          <ProjectDashboard
            currentProjectId={null}
            onSelectProject={() => {}}
            onNewProject={() => {}}
            onOpenAppSettings={() => {}}
            leftTab={tab}
            onLeftTabChange={t => seen.push(t)}
          />,
        );
      });
    };
    await render('workspaces');
    await act(async () => { (q('dashboard-left-tab-bulk-export') as HTMLButtonElement).click(); });
    expect(seen).toEqual(['bulk-export']);
    await render('bulk-export');
    expect(q('dashboard-left-tab-bulk-export')!.getAttribute('aria-selected')).toBe('true');
  });
});
