// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach, vi } from 'vitest';

const pick = vi.hoisted(() => vi.fn());
vi.mock('../services/relinkNative', () => ({ relinkPickFolder: pick }));
import { BulkExportModal, EXPORT_FOLDER_PICK_TITLE } from './BulkExportModal';
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

async function mount(runner: BulkExportRunner, workspaces = new WorkspaceRegistry(wsMem()), hidden = false, onOpenProject?: (id: string) => void): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<BulkExportModal runner={runner} workspaces={workspaces} hidden={hidden} onOpenProject={onOpenProject} />);
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
    // Nothing selected: no count, no checkmarks anywhere.
    expect(container.querySelector('[data-testid="bulk-export-selected-count"]')).toBeNull();
    expect(container.querySelector('.kxd-check')).toBeNull();
    const selectAll = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-select-all"]')!;
    expect(selectAll().textContent).toBe('Select all');
    expect(selectAll().querySelector('.kxd-check')).toBeNull();
    await act(async () => { selectAll().click(); });
    expect(container.querySelector('[data-testid="bulk-export-selected-count"]')?.textContent).toContain('2 selected');
    expect(container.querySelectorAll('.kxd-check')).toHaveLength(2);
    expect(selectAll().textContent).toBe('Deselect all');
    await act(async () => { selectAll().click(); });
    expect(container.querySelector('[data-testid="bulk-export-selected-count"]')).toBeNull();
    expect(selectAll().textContent).toBe('Select all');
  });

  it('clicking a project anywhere but Open selects it; the checkmark shows only on selected rows', async () => {
    const projects = [project('a'), project('b')];
    const runner = runnerOf(projects);
    const opened: string[] = [];
    await mount(runner, undefined, false, id => opened.push(id));
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-ready"]')!.click(); });
    const row = (id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-testid="bulk-export-row-${id}"]`)!;
    await act(async () => { row('a').querySelector<HTMLElement>('.kxd-xrow-name')!.click(); });
    expect(runner.snapshot().find(r => r.id === 'a')?.selected).toBe(true);
    expect(row('a').querySelector('.kxd-check')).not.toBeNull();
    expect(row('b').querySelector('.kxd-check')).toBeNull();
    await act(async () => { row('a').querySelector<HTMLElement>('.kxd-xrow-name')!.click(); });
    expect(runner.snapshot().find(r => r.id === 'a')?.selected).toBe(false);
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-open-b"]')!.click(); });
    expect(opened).toEqual(['b']);
    expect(runner.snapshot().find(r => r.id === 'b')?.selected ?? false).toBe(false);
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

  it('tabs are ordered Ready | Blocked | Failed | Active | Finished', async () => {
    await mount(runnerOf([project('a')]));
    const labels = [...container.querySelectorAll('[data-testid="bulk-export-tabs"] .kxd-subtab-label')].map(e => e.textContent);
    expect(labels).toEqual(['Ready', 'Blocked', 'Failed', 'Active', 'Finished']);
    expect(container.querySelector('[data-testid="bulk-export-counts"]')).toBeNull();
    expect(container.querySelector('[data-testid="bulk-export-retry-all"]')).toBeNull();
  });

  it('Active: Cancel all and a per-row Cancel; no selecting', async () => {
    const runner = new BulkExportRunner({
      listProjects: () => [project('a'), project('b')].map(p => ({ id: p.id, name: p.name, lastExportPath: `/out/${p.id}.mp4` })),
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(),
      playChime: () => {},
      execute: input => new Promise(resolve => input.signal.addEventListener('abort', () => resolve({ status: 'failed', detail: 'cancelled' }))),
    });
    await mount(runner);
    runner.setSelectedAll(true);
    await act(async () => { await runner.startSelected(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-active"]')!.click(); });
    expect(container.querySelector('[data-testid="bulk-export-select-all"]')).toBeNull();
    expect(container.querySelector('[data-testid="bulk-export-check-a"]')).toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-cancel-b"]')!.click(); });
    expect(runner.snapshot().find(r => r.id === 'b')?.phase).toBe('idle');
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-cancel-all"]')!.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(runner.snapshot().find(r => r.id === 'a')?.phase).toBe('cancelled');
    expect(container.querySelector('[data-testid="bulk-export-cancel-all"]')).toBeNull();
  });

  it('Blocked: Open and the reason only — no select, no Retry; Finished: when, per-row Clear and Clear all', async () => {
    const noPath = { ...project('n'), lastExportPath: undefined } as unknown as Project;
    const runner = runnerOf([project('a'), noPath]);
    await mount(runner, undefined, false, () => {});
    runner.setSelectedAll(true);
    await act(async () => { await runner.startSelected(); });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-blocked"]')!.click(); });
    expect(container.querySelector('[data-testid="bulk-export-open-n"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bulk-export-status-n"]')!.textContent).toBe(BULK_EXPORT_NO_PATH);
    expect(container.querySelector('[data-testid="bulk-export-retry-n"]')).toBeNull();
    expect(container.querySelector('[data-testid="bulk-export-select-all"]')).toBeNull();
    expect(container.querySelector('[data-testid="bulk-export-check-n"]')).toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-finished"]')!.click(); });
    expect(container.querySelector('[data-testid="bulk-export-when-a"]')!.textContent).toMatch(/^Exported /);
    expect(container.querySelector('[data-testid="bulk-export-open-a"]')).toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-clear-a"]')!.click(); });
    expect(runner.snapshot().find(r => r.id === 'a')?.phase).toBe('idle');
    expect(container.querySelector('[data-testid="bulk-export-clear-all"]')).toBeNull();
  });

  it('each row has an Open action (outside the select button) and a status dot on its edge', async () => {
    const opened: string[] = [];
    const noPath = { ...project('n'), lastExportPath: undefined } as unknown as Project;
    const runner = runnerOf([project('a'), noPath]);
    await mount(runner, undefined, false, id => opened.push(id));
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-ready"]')!.click(); });
    const open = container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-open-a"]')!;
    expect(open.getAttribute('aria-label')).toBe('Open a');
    expect(open.closest('[data-testid="bulk-export-check-a"]')).toBeNull();
    await act(async () => { open.click(); });
    expect(opened).toEqual(['a']);
    expect(runner.snapshot().find(r => r.id === 'a')?.selected ?? false).toBe(false);
    expect(container.querySelector('[data-testid="bulk-export-dot-a"]')!.getAttribute('data-tone')).toBe('idle');
    runner.setSelected('n', true);
    await act(async () => { await runner.startSelected(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-blocked"]')!.click(); });
    expect(container.querySelector('[data-testid="bulk-export-dot-n"]')!.getAttribute('data-tone')).toBe('bad');
  });

  it('a project without a thumbnail shows the fallback mark, not a broken image', async () => {
    await mount(runnerOf([project('a')]));
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-ready"]')!.click(); });
    const thumb = container.querySelector('[data-testid="bulk-export-row-a"] .kxd-xrow-thumb')!;
    expect(thumb.querySelector('img')).toBeNull();
    expect(thumb.querySelector('.kxd-art-empty svg')).not.toBeNull();
  });

  it('a failed export lands in Failed (not Blocked) with its reason, Open and Retry', async () => {
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'f', name: 'f', lastExportPath: '/out/f.mp4' }],
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(),
      playChime: () => {},
      execute: async () => ({ status: 'failed', detail: 'disk full' }),
    });
    await mount(runner, undefined, false, () => {});
    runner.setSelected('f', true);
    await act(async () => { await runner.startSelected(); });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(container.querySelector('[data-testid="bulk-export-tab-count-failed"]')!.textContent).toBe('1');
    expect(container.querySelector('[data-testid="bulk-export-tab-count-blocked"]')!.textContent).toBe('0');
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-failed"]')!.click(); });
    expect(container.querySelector('[data-testid="bulk-export-status-f"]')!.textContent).toContain('disk full');
    expect(container.querySelector('[data-testid="bulk-export-retry-f"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bulk-export-open-f"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bulk-export-select-all"]')).toBeNull();
  });
});
