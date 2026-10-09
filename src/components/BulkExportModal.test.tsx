// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach } from 'vitest';
import { BulkExportModal } from './BulkExportModal';
import { BulkExportRunner } from '../services/bulkExportQueue';
import { BULK_EXPORT_NO_PATH } from '../services/bulkExportSettings';
import { WorkspaceRegistry } from './workspaceRegistry';
import type { Project } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function project(id: string): Project {
  return {
    id, name: id, script: '', sceneDetails: '', segments: [], assets: [],
    lastExportPath: `/out/${id}.mp4`,
  } as unknown as Project;
}

const wsMem = (): Storage => {
  const m = new Map<string, string>();
  return {
    getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); },
    clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size; },
  };
};

async function mount(runner: BulkExportRunner, workspaces = new WorkspaceRegistry(wsMem()), hidden = false): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<BulkExportModal runner={runner} workspaces={workspaces} hidden={hidden} />);
  });
}

const runnerOf = (projects: Project[]): BulkExportRunner => new BulkExportRunner({
  listProjects: () => projects.map(p => ({ id: p.id, name: p.name, lastExportPath: (p as { lastExportPath?: string }).lastExportPath })),
  loadProject: async id => projects.find(p => p.id === id) ?? null,
  storage: mem(),
  playChime: () => {},
  execute: async () => ({ status: 'done' }),
});
const rows = (): string[] =>
  [...container.querySelectorAll('[data-testid^="bulk-export-row-"]')].map(el => el.getAttribute('data-testid')!.replace('bulk-export-row-', ''));

describe('BulkExportModal', () => {
  it('lists projects with select-all, count, and Start', async () => {
    const projects = [project('a'), project('b')];
    const runner = new BulkExportRunner({
      listProjects: () => projects.map(p => ({ id: p.id, name: p.name })),
      loadProject: async id => projects.find(p => p.id === id) ?? null,
      storage: mem(),
      playChime: () => {},
      execute: async () => ({ status: 'done' }),
    });
    await mount(runner);
    expect(container.querySelector('[data-testid="bulk-export-row-a"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="bulk-export-row-b"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="bulk-export-start"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="bulk-export-selected-count"]')?.textContent).toContain('0 selected');
    await act(async () => {
      container.querySelector<HTMLInputElement>('[data-testid="bulk-export-select-all"]')!.click();
    });
    expect(container.querySelector('[data-testid="bulk-export-selected-count"]')?.textContent).toContain('2 selected');
  });
});

describe('BulkExportModal — Dashboard revamp Stage 4 (Bulk Export tab)', () => {
  it('sits in flow in its tab: no fixed drawer, no close button', async () => {
    await mount(runnerOf([project('a')]));
    const pane = container.querySelector<HTMLElement>('[data-testid="bulk-export-modal"]')!;
    expect(pane.className).not.toContain('fixed');
    expect(pane.className).not.toContain('-translate-x-full');
    expect(container.querySelector('[data-testid="bulk-export-close"]')).toBeNull();
  });

  it('workspace tabs: All + each workspace filter the rows; All shows everything', async () => {
    const reg = new WorkspaceRegistry(wsMem());
    const w1 = reg.create('Cooking');
    const w2 = reg.create('Travel');
    reg.assign(['a'], w1.id);
    reg.assign(['b'], w2.id);
    await mount(runnerOf([project('a'), project('b'), project('c')]), reg);
    const tabs = [...container.querySelector('[data-testid="bulk-export-ws-tabs"]')!.querySelectorAll('[role="tab"]')].map(t => t.textContent);
    expect(tabs).toEqual(['All', 'Cooking', 'Travel']);
    expect(rows()).toEqual(['a', 'b', 'c']);
    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="bulk-export-ws-${w1.id}"]`)!.click(); });
    expect(rows()).toEqual(['a']);
    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="bulk-export-ws-${w2.id}"]`)!.click(); });
    expect(rows()).toEqual(['b']);
  });

  it('under a workspace, Select all selects only its rows; the count stays the whole selection', async () => {
    const reg = new WorkspaceRegistry(wsMem());
    const w = reg.create('Cooking');
    reg.assign(['a', 'b'], w.id);
    const runner = runnerOf([project('a'), project('b'), project('c')]);
    await mount(runner, reg);
    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="bulk-export-ws-${w.id}"]`)!.click(); });
    await act(async () => { container.querySelector<HTMLInputElement>('[data-testid="bulk-export-select-all"]')!.click(); });
    expect(runner.snapshot().filter(r => r.selected).map(r => r.id).sort()).toEqual(['a', 'b']);
    expect(container.querySelector('[data-testid="bulk-export-selected-count"]')?.textContent).toContain('2 selected');
  });

  it('a project with no workspace folder and no saved export path reads the new Blocked copy', async () => {
    expect(BULK_EXPORT_NO_PATH).toBe("Blocked — no export path. Set a folder in this workspace's export settings, or open the project and export once.");
    const noPath = { ...project('n'), lastExportPath: undefined } as unknown as Project;
    const runner = runnerOf([noPath]);
    await mount(runner);
    await act(async () => { container.querySelector<HTMLInputElement>('[data-testid="bulk-export-check-n"]')!.click(); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-blocked"]')!.click(); });
    expect(container.querySelector('[data-testid="bulk-export-status-n"]')!.textContent).toBe(BULK_EXPORT_NO_PATH);
  });
});
