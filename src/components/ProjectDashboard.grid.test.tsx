// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dashboard revamp Stage 5 — the right panel: smaller cards in a centred
// five-per-row grid, and workspace tabs (All + each workspace) above it that
// filter the cards. Card content is unchanged.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../services/projectStore', () => ({
  loadAllMetas: () => [
    { id: 'p1', name: 'One', savedAt: 3, segmentCount: 2 },
    { id: 'p2', name: 'Two', savedAt: 2, segmentCount: 0 },
    { id: 'p3', name: 'Three', savedAt: 1, segmentCount: 5 },
  ],
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
// eslint-disable-next-line import/first
import { workspaceRegistry } from './workspaceRegistry';

let container: HTMLDivElement;
let root: Root;

const cards = (): string[] =>
  [...container.querySelectorAll('[data-testid^="project-card-"]')]
    .map(el => el.getAttribute('data-testid')!)
    .filter(id => !id.startsWith('project-card-spinner-'))
    .map(id => id.replace('project-card-', ''));

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<ProjectDashboard currentProjectId={null} onSelectProject={() => {}} onNewProject={() => {}} onOpenAppSettings={() => {}} />);
  });
}

beforeEach(() => {
  // The app's registry is a module singleton: start each test with no workspaces.
  const reg = workspaceRegistry();
  for (const w of reg.snapshot()) reg.remove(w.id);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('right panel — workspace tabs above the grid', () => {
  it('All + each workspace; a workspace tab shows only its cards; All shows every card', async () => {
    const reg = workspaceRegistry();
    const w = reg.create('Cooking');
    reg.assign(['p1', 'p3'], w.id);
    await mount();
    const strip = container.querySelector('[data-testid="grid-ws-tabs"]')!;
    // Each tab reads its name, then the number of projects it holds.
    expect([...strip.querySelectorAll('[role="tab"]')].map(t => t.textContent)).toEqual(['All3', 'Cooking2']);
    expect(cards()).toEqual(['p1', 'p2', 'p3']);
    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="grid-ws-${w.id}"]`)!.click(); });
    expect(cards()).toEqual(['p1', 'p3']);
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="grid-ws-all"]')!.click(); });
    expect(cards()).toEqual(['p1', 'p2', 'p3']);
  });

  it('the strip sits above the grid, inside the centred frame', async () => {
    await mount();
    const frame = container.querySelector('[data-testid="project-grid-frame"]')!;
    const strip = container.querySelector('[data-testid="grid-ws-tabs"]')!;
    const grid = container.querySelector('[data-testid="project-grid"]')!;
    expect(frame.contains(strip) && frame.contains(grid)).toBe(true);
    expect(strip.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('an empty workspace says so; card content is unchanged (title, scene badge)', async () => {
    const reg = workspaceRegistry();
    const w = reg.create('Empty');
    await mount();
    expect(container.querySelector('[data-testid="project-card-p1"]')!.textContent).toContain('One');
    expect(container.querySelector('[data-testid="project-card-p1"]')!.textContent).toContain('2 scenes');
    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="grid-ws-${w.id}"]`)!.click(); });
    expect(cards()).toEqual([]);
    expect(container.textContent).toContain('No projects in this workspace yet.');
  });
});

describe('right panel — five-per-row centred grid (CSS contract)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/components/ProjectDashboard.css'), 'utf8');
  it('five equal columns that shrink together, in a frame centred with margin auto', () => {
    expect(css).toMatch(/\.kxd-grid \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.kxd-grid-frame \{[^}]*max-width: calc\(5 \* var\(--kxd-card-w\) \+ 4 \* var\(--kxd-grid-gap\)\)/);
    expect(css).toMatch(/\.kxd-grid-frame \{[^}]*margin: 0 auto/);
  });
  it('the narrow-window rule keeps five a row (no auto-fill fallback)', () => {
    expect(css).not.toMatch(/\.kxd-grid \{ grid-template-columns: repeat\(auto-fill/);
  });
});
