// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach, vi } from 'vitest';

const pick = vi.hoisted(() => vi.fn());
const precheckTargets = vi.hoisted(() => ({ last: [] as { id: string }[] }));
vi.mock('../services/relinkNative', () => ({ relinkPickFolder: pick }));
vi.mock('./bulkExportPrecheck', async (importOriginal) => {
  const real = await importOriginal<typeof import('./bulkExportPrecheck')>();
  return {
    ...real,
    // Records what the pane asks the pre-check to look at; the real hook runs.
    useExportPrecheck: (...args: Parameters<typeof real.useExportPrecheck>) => {
      precheckTargets.last = [...args[0]];
      return real.useExportPrecheck(...args);
    },
  };
});
import { BulkExportModal, EXPORT_FOLDER_PICK_TITLE, clock, etaText, tookText } from './BulkExportModal';
import { BulkExportRunner } from '../services/bulkExportQueue';
import { BULK_EXPORT_NO_PATH } from '../services/bulkExportSettings';
import { WorkspaceRegistry } from './workspaceRegistry';
import type { Project } from '../types';
import { selectAll } from '../services/bulkExportTestUtil';

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

/** Polls inside act so timer-driven updates (the Active row's clock) are flushed
 *  and never land outside it. */
const waitInAct = async (check: () => void, timeoutMs = 4000): Promise<void> => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try { check(); return; } catch (err) {
      if (Date.now() > end) throw err;
    }
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  }
};

const confirmDialog = async (): Promise<void> => {
  await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="confirm-dialog-confirm"]')!.click(); });
};

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

  it('the pre-check only looks at the selected workspace tab\'s projects', async () => {
    const reg = new WorkspaceRegistry(wsMem());
    const w1 = reg.create('Cooking');
    const w2 = reg.create('Travel');
    reg.assign(['a'], w1.id);
    reg.assign(['b'], w2.id);
    await mount(runnerOf([project('a'), project('b'), project('c')]), reg);
    expect(precheckTargets.last.map(t => t.id)).toEqual(['a', 'b', 'c']);
    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="bulk-export-ws-${w1.id}"]`)!.click(); });
    expect(precheckTargets.last.map(t => t.id)).toEqual(['a']);
    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="bulk-export-ws-${w2.id}"]`)!.click(); });
    expect(precheckTargets.last.map(t => t.id)).toEqual(['b']);
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
    act(() => { selectAll(runner); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-active"]')!.click(); });
    expect(container.querySelector('[data-testid="bulk-export-select-all"]')).toBeNull();
    expect(container.querySelector('[data-testid="bulk-export-check-a"]')).toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-cancel-b"]')!.click(); });
    // Asked first: nothing is cancelled until the warning is confirmed.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(runner.snapshot().find(r => r.id === 'b')?.phase).toBe('queued');
    await confirmDialog();
    expect(runner.snapshot().find(r => r.id === 'b')?.phase).toBe('idle');
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-cancel-all"]')!.click(); });
    expect(runner.snapshot().find(r => r.id === 'a')?.phase).toBe('exporting');
    await confirmDialog();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(runner.snapshot().find(r => r.id === 'a')?.phase).toBe('cancelled');
    expect(container.querySelector('[data-testid="bulk-export-cancel-all"]')).toBeNull();
  });

  it('the Cancel-all confirm dialog\'s one action is runner.stopAll(ids) — a per-row Cancel stays runner.cancel(id)', async () => {
    const runner = new BulkExportRunner({
      listProjects: () => [project('a'), project('b'), project('c')].map(p => ({ id: p.id, name: p.name, lastExportPath: `/out/${p.id}.mp4` })),
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(), playChime: () => {},
      execute: input => new Promise(resolve => input.signal.addEventListener('abort', () => resolve({ status: 'failed', detail: 'cancelled' }))),
    });
    const stopAll = vi.spyOn(runner, 'stopAll');
    const cancel = vi.spyOn(runner, 'cancel');
    await mount(runner);
    act(() => { selectAll(runner); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-active"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-cancel-c"]')!.click(); });
    await confirmDialog();
    expect(cancel).toHaveBeenCalledWith('c');
    expect(stopAll).not.toHaveBeenCalled();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-cancel-all"]')!.click(); });
    await confirmDialog();
    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(stopAll.mock.calls[0]![0]).toEqual(['a', 'b']);
    expect(cancel).toHaveBeenCalledTimes(1);   // Cancel all adds no per-row loop of its own
  });

  it('Blocked: Open and the reason only — no select, no Retry; Finished: when, per-row Clear and Clear all', async () => {
    const noPath = { ...project('n'), lastExportPath: undefined } as unknown as Project;
    const runner = runnerOf([project('a'), noPath]);
    await mount(runner, undefined, false, () => {});
    act(() => { selectAll(runner); });
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
    act(() => { runner.setSelected('n', true); });
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
    act(() => { runner.setSelected('f', true); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(container.querySelector('[data-testid="bulk-export-tab-count-failed"]')!.textContent).toBe('1');
    expect(container.querySelector('[data-testid="bulk-export-tab-count-blocked"]')!.textContent).toBe('0');
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-failed"]')!.click(); });
    expect(container.querySelector('[data-testid="bulk-export-status-f"]')!.textContent).toContain('disk full');
    expect(container.querySelector('[data-testid="bulk-export-retry-f"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bulk-export-open-f"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bulk-export-select-all"]')).toBeNull();
    // Cancel gives up on it: back to Ready.
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-dismiss-f"]')!.click(); });
    expect(runner.snapshot().find(r => r.id === 'f')?.phase).toBe('idle');
    expect(container.querySelector('[data-testid="bulk-export-tab-count-ready"]')!.textContent).toBe('1');
    expect(container.querySelector('[data-testid="bulk-export-tab-count-failed"]')!.textContent).toBe('0');
  });

  it('Active shows a live bar, percent, stage, timer + ETA, the output file and Cancel', async () => {
    let report!: (p: { pct: number; stage: string }) => void;
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'a', name: 'a', lastExportPath: '/out/a.mp4' }],
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(),
      playChime: () => {},
      execute: input => new Promise(resolve => {
        report = input.setProgress;
        input.signal.addEventListener('abort', () => resolve({ status: 'failed', detail: 'cancelled' }));
      }),
    });
    await mount(runner);
    act(() => { runner.setSelected('a', true); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-active"]')!.click(); });
    expect(container.querySelector('[data-testid="bulk-export-pct-a"]')!.textContent).toBe('—');
    await act(async () => { report({ pct: 10, stage: 'Encoding segment 1 / 20' }); });
    await act(async () => { report({ pct: 42, stage: 'Encoding segment 3 / 20' }); });
    const bar = container.querySelector('[data-testid="bulk-export-progress-a"] [role="progressbar"]')!;
    // The shown percent glides to the engine's number (it never overshoots it by more than the look-ahead).
    await waitInAct(() => expect(container.querySelector('[data-testid="bulk-export-pct-a"]')!.textContent).toBe('42.00%'));
    expect(bar.getAttribute('aria-valuenow')).toBeTruthy();
    // No "Encoding segment x / n", no output file name: resolution and fps only.
    const card = container.querySelector('[data-testid="bulk-export-progress-a"]')!;
    expect(card.textContent).not.toMatch(/Encoding segment/);
    expect(card.textContent).not.toContain('a.mp4');
    expect(card.textContent).toMatch(/1080p · 30 fps|720p · 30 fps/);
    expect(container.querySelector('[data-testid="bulk-export-time-a"]')!.textContent).toMatch(/^\d+:\d{2}\|(Estimating…|finishing…|~[\w ]+ left)$/);
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-cancel-a"]')!.click(); });
    await confirmDialog();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(runner.progressSnapshot().has('a')).toBe(false);
  });

  it('the runner stamps when the mux stage began, so its tail can be modelled', async () => {
    let report!: (p: { pct: number; stage: string }) => void;
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'a', name: 'a', lastExportPath: '/out/a.mp4' }],
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(), playChime: () => {},
      execute: input => new Promise(() => { report = input.setProgress; }),
    });
    act(() => { runner.setSelected('a', true); });
    await runner.startSelected();
    await vi.waitFor(() => expect(report).toBeTypeOf('function'));
    report({ pct: 60, stage: 'Encoding' });
    expect(runner.progressSnapshot().get('a')!.muxAt).toBeUndefined();
    report({ pct: 93, stage: 'Muxing & packaging…' });
    const first = runner.progressSnapshot().get('a')!.muxAt;
    expect(first).toBeTypeOf('number');
    report({ pct: 93, stage: 'Muxing & packaging…' });
    expect(runner.progressSnapshot().get('a')!.muxAt).toBe(first);   // set once
  });

  it('a resumed export: the bar never reports below the resume point, and the row carries the note', async () => {
    let report!: (p: { pct: number; stage: string; note?: string; resumedFromPct?: number }) => void;
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'a', name: 'a', lastExportPath: '/out/a.mp4' }],
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(), playChime: () => {},
      execute: input => new Promise(() => { report = input.setProgress; }),
    });
    await mount(runner);
    act(() => { runner.setSelected('a', true); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-active"]')!.click(); });
    await vi.waitFor(() => expect(report).toBeTypeOf('function'));
    await act(async () => { report({ pct: 40, stage: 'Resuming…', note: 'Resuming from checkpoint — 40% done', resumedFromPct: 40 }); });
    // The engine's first readings (before it has re-encoded a frame) are 0: the bar must not fall back.
    await act(async () => { report({ pct: 0, stage: 'Loading ffmpeg…', note: 'Resuming from checkpoint — 40% done', resumedFromPct: 40 }); });
    const live = runner.progressSnapshot().get('a')!;
    expect(live.pct).toBe(40);
    expect(live.basePct).toBe(40);
    expect(container.querySelector('[data-testid="bulk-export-note-a"]')!.textContent).toBe('Resuming from checkpoint — 40% done');
  });

  it('clock and ETA read plainly', () => {
    expect(clock(134)).toBe('2:14');
    expect(clock(3725)).toBe('1:02:05');
    // 5% took 30 s -> 10 minutes in all -> ~10 minutes left at that moment, counting down.
    expect(etaText(0, 30_000, 30_000)).toBe('~10 minutes left');
    expect(etaText(0, 30_000, 330_000)).toBe('~5 minutes left');
    expect(etaText(0, 30_000, 570_000)).toBe('~1 minute left');
    expect(etaText(0, 30_000, 700_000)).toBe('finishing…');
    expect(etaText(0, 1_800_000, 1_800_000)).toBe('~9 h 30 min left');   // 5% took 30 min -> 10 h in all
    expect(etaText(0, undefined, 60_000)).toBeNull();               // before 5%: no number
  });

  it('Export switches to Active; a cancelled export lands in Failed; a finished one shows how long it took', async () => {
    let release!: () => void;
    const runner = new BulkExportRunner({
      listProjects: () => ['a', 'b'].map(id => ({ id, name: id, lastExportPath: `/out/${id}.mp4` })),
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(),
      playChime: () => {},
      execute: input => new Promise(resolve => {
        if (input.project.id === 'a') { release = () => resolve({ status: 'done' }); }
        input.signal.addEventListener('abort', () => resolve({ status: 'failed', detail: 'cancelled' }));
      }),
    });
    await mount(runner);
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-ready"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-select-all"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-start"]')!.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(container.querySelector('[data-testid="bulk-export-tab-active"]')!.getAttribute('aria-selected')).toBe('true');
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-cancel-b"]')!.click(); });
    await confirmDialog();
    await act(async () => { release(); await new Promise(r => setTimeout(r, 10)); });
    expect(runner.snapshot().find(r => r.id === 'a')?.exportMs).toBeGreaterThanOrEqual(0);
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-finished"]')!.click(); });
    expect(container.querySelector('[data-testid="bulk-export-when-a"]')!.textContent).toMatch(/· took \d/);
  });

  it('cancelled and interrupted exports sit in Failed, not Blocked', async () => {
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'c', name: 'c', lastExportPath: '/out/c.mp4' }],
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(),
      playChime: () => {},
      execute: input => new Promise(resolve => input.signal.addEventListener('abort', () => resolve({ status: 'failed', detail: 'cancelled' }))),
    });
    await mount(runner);
    act(() => { runner.setSelected('c', true); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { runner.cancel('c'); await new Promise(r => setTimeout(r, 10)); });
    expect(container.querySelector('[data-testid="bulk-export-tab-count-failed"]')!.textContent).toBe('1');
    expect(container.querySelector('[data-testid="bulk-export-tab-count-blocked"]')!.textContent).toBe('0');
  });

  it('took-time reads plainly', () => {
    expect(tookText(42)).toBe('42s');
    expect(tookText(252)).toBe('4m 12s');
    expect(tookText(3900)).toBe('1h 05m');
  });

  it('Ready: search filters by name, sort reorders, Select all acts on what is shown', async () => {
    const mk = (id: string, name: string): Project => ({ ...project(id), name } as Project);
    const projects = [mk('a', 'Banana'), mk('b', 'apple 10'), mk('c', 'apple 2')];
    const runner = new BulkExportRunner({
      listProjects: () => projects.map(p => ({ id: p.id, name: p.name, lastExportPath: `/out/${p.id}.mp4` })),
      loadProject: async id => projects.find(p => p.id === id) ?? null,
      storage: mem(), playChime: () => {}, execute: async () => ({ status: 'done' }),
    });
    await mount(runner);
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-ready"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-sort"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-sort-name-az"]')!.click(); });
    expect(rows()).toEqual(['c', 'b', 'a']);              // natural order: apple 2 before apple 10
    // Search is a small icon until clicked; then it opens into the field.
    expect(container.querySelector('[data-testid="bulk-export-search"]')).toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-search-open"]')!.click(); });
    const search = container.querySelector<HTMLInputElement>('[data-testid="bulk-export-search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(search, 'APPLE'); search.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(rows()).toEqual(['c', 'b']);
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-select-all"]')!.click(); });
    expect(runner.snapshot().filter(r => r.selected).map(r => r.id).sort()).toEqual(['b', 'c']);
    await act(async () => { setter.call(search, 'zzz'); search.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(container.querySelector('[data-testid="bulk-export-empty"]')!.textContent).toContain('No projects match');
    expect(container.querySelector('[data-testid="bulk-export-search"]')).not.toBeNull();   // the box survives an empty result
  });

  it('Active keeps the queue order: a retried export lands last, under the queued ones', async () => {
    const ids = ['d', 'a', 'b'];   // d is FIRST in the catalog
    const releases = new Map<string, () => void>();
    const runner = new BulkExportRunner({
      listProjects: () => ids.map(id => ({ id, name: id, lastExportPath: `/out/${id}.mp4` })),
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(),
      playChime: () => {},
      execute: input => new Promise(resolve => {
        releases.set(input.project.id, () => resolve({ status: input.project.id === 'd' && !releases.has('d-retry') ? 'failed' : 'done', detail: 'x' }));
      }),
    });
    await mount(runner);
    // d fails first; then a runs with b queued; retrying d must put it behind them.
    act(() => { runner.setSelected('d', true); });
    await act(async () => { await runner.startSelected(); });
    await vi.waitFor(() => expect(releases.has('d')).toBe(true));
    await act(async () => { releases.get('d')!(); await new Promise(r => setTimeout(r, 10)); });
    expect(runner.snapshot().find(r => r.id === 'd')?.phase).toBe('failed');
    releases.set('d-retry', () => {});
    act(() => { runner.setSelected('a', true); runner.setSelected('b', true); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { await runner.retry('d'); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-active"]')!.click(); });
    const order = [...container.querySelectorAll('[data-testid^="bulk-export-row-"]')].map(el => el.getAttribute('data-testid')!.replace('bulk-export-row-', ''));
    expect(order).toEqual(['a', 'b', 'd']);
  });

  it('Retry all (Failed), Cancel all (Active) and Clear all (Finished) share the Select all style', async () => {
    const runner = new BulkExportRunner({
      listProjects: () => ['f1', 'f2'].map(id => ({ id, name: id, lastExportPath: `/out/${id}.mp4` })),
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(),
      playChime: () => {},
      execute: async () => ({ status: 'failed', detail: 'disk full' }),
    });
    await mount(runner);
    act(() => { selectAll(runner); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-failed"]')!.click(); });
    const retryAll = container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-retry-all"]')!;
    expect(retryAll.className).toContain('kxd-selall');
    expect(retryAll.textContent).toBe('Retry all');
    await act(async () => { retryAll.click(); await new Promise(r => setTimeout(r, 30)); });
    expect(runner.snapshot().every(r => r.phase !== 'idle')).toBe(true);
    // Retry all follows the work to Active, as Export does.
    expect(container.querySelector('[data-testid="bulk-export-tab-active"]')!.getAttribute('aria-selected')).toBe('true');
  });

  it('Active: drag a queued card anywhere to reorder; the running one cannot be dragged; a plain click does not reorder', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    const runner = new BulkExportRunner({
      listProjects: () => ids.map(id => ({ id, name: id, lastExportPath: `/out/${id}.mp4` })),
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(),
      playChime: () => {},
      execute: input => new Promise(resolve => input.signal.addEventListener('abort', () => resolve({ status: 'failed', detail: 'cancelled' }))),
    });
    await mount(runner);
    act(() => { selectAll(runner); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-active"]')!.click(); });
    const order = (): string[] => [...container.querySelectorAll('[data-testid^="bulk-export-row-"]')].map(el => el.getAttribute('data-testid')!.replace('bulk-export-row-', ''));
    expect(order()).toEqual(['a', 'b', 'c', 'd']);
    expect(container.querySelector('[data-testid="bulk-export-row-a"]')!.classList.contains('is-reorderable')).toBe(false);   // running
    expect(container.querySelector('[data-testid^="bulk-export-grip"]')).toBeNull();                                           // no handle: the card itself drags
    // jsdom has no layout: stub each row's box (100px tall, stacked).
    ids.forEach((id, i) => {
      container.querySelector<HTMLElement>(`[data-testid="bulk-export-row-${id}"]`)!.getBoundingClientRect =
        () => ({ top: i * 100, bottom: i * 100 + 90, left: 0, right: 300, width: 300, height: 90, x: 0, y: i * 100, toJSON: () => ({}) });
    });
    const pointer = (type: string, y: number): Event => Object.assign(new MouseEvent(type, { bubbles: true, clientY: y }), {});
    // A click without movement changes nothing.
    await act(async () => { container.querySelector('[data-testid="bulk-export-row-d"]')!.dispatchEvent(pointer('pointerdown', 330)); });
    await act(async () => { window.dispatchEvent(pointer('pointerup', 331)); });
    expect(order()).toEqual(['a', 'b', 'c', 'd']);
    await act(async () => { container.querySelector('[data-testid="bulk-export-row-d"]')!.dispatchEvent(pointer('pointerdown', 330)); });
    await act(async () => { window.dispatchEvent(pointer('pointermove', 120)); });       // above b's middle (145)
    await act(async () => { window.dispatchEvent(pointer('pointerup', 120)); });
    expect(order()).toEqual(['a', 'd', 'b', 'c']);
    // Keyboard: Alt+ArrowDown moves one step; Alt+ArrowUp cannot pass the running export.
    await act(async () => {
      container.querySelector('[data-testid="bulk-export-row-d"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    });
    expect(order()).toEqual(['a', 'b', 'd', 'c']);
    await act(async () => {
      container.querySelector('[data-testid="bulk-export-row-b"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));
    });
    expect(order()).toEqual(['a', 'b', 'd', 'c']);
  });

  it('a queued export reads as a small "Queued" badge', async () => {
    const runner = new BulkExportRunner({
      listProjects: () => ['a', 'b'].map(id => ({ id, name: id, lastExportPath: `/out/${id}.mp4` })),
      loadProject: async id => ({ ...project(id), segments: [], assets: [] }),
      storage: mem(), playChime: () => {},
      execute: input => new Promise(resolve => input.signal.addEventListener('abort', () => resolve({ status: 'failed', detail: 'cancelled' }))),
    });
    await mount(runner);
    act(() => { selectAll(runner); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-active"]')!.click(); });
    const badge = container.querySelector('[data-testid="bulk-export-status-b"]')!;
    expect(badge.textContent).toBe('Queued');
    expect(badge.className).toContain('kxd-xrow-qbadge');
  });

  it('Blocked has Re-check all (and a hint); Finished has the same search + sort', async () => {
    const noPath = { ...project('n'), lastExportPath: undefined } as unknown as Project;
    const names: Record<string, string> = { a: 'Banana', b: 'Apple' };
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'a', name: 'Banana', lastExportPath: '/out/a.mp4' }, { id: 'b', name: 'Apple', lastExportPath: '/out/b.mp4' }, { id: 'n', name: 'n' }],
      loadProject: async id => (id === 'n' ? { ...noPath, segments: [], assets: [] } : { ...project(id), name: names[id]!, segments: [], assets: [] }),
      storage: mem(), playChime: () => {}, execute: async () => ({ status: 'done' }),
    });
    await mount(runner);
    act(() => { selectAll(runner); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-blocked"]')!.click(); });
    const recheck = container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-recheck-all"]')!;
    expect(recheck.className).toContain('kxd-selall');
    expect(container.querySelector('[data-testid="bulk-export-blocked-hint"]')).not.toBeNull();
    await act(async () => { recheck.click(); await new Promise(r => setTimeout(r, 10)); });   // still no path: stays blocked
    expect(runner.snapshot().find(r => r.id === 'n')?.phase).toBe('blocked');
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-finished"]')!.click(); });
    expect(container.querySelector('[data-testid="bulk-export-search-open"]')).not.toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-sort"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-sort-name-az"]')!.click(); });
    const order = [...container.querySelectorAll('[data-testid^="bulk-export-row-"]')].map(el => el.getAttribute('data-testid')!.replace('bulk-export-row-', ''));
    expect(order).toEqual(['b', 'a']);   // Apple, Banana
  });
});

describe('BulkExportModal — a finished row carries its notice', () => {
  async function finishedWith(detail: string | undefined): Promise<void> {
    const projects = [project('a')];
    const runner = new BulkExportRunner({
      listProjects: () => projects.map(p => ({ id: p.id, name: p.name })),
      loadProject: async id => projects.find(p => p.id === id) ?? null,
      storage: mem(),
      playChime: () => {},
      execute: async () => ({ status: 'done', ...(detail ? { detail } : {}) }),
    });
    await mount(runner);
    act(() => { selectAll(runner); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-tab-finished"]')!.click(); });
  }

  it('a deviation notice shows on the Finished row', async () => {
    await finishedWith('Piece 3: 1,795 frames rendered, 1,796 planned');
    expect(container.querySelector('[data-testid="bulk-export-status-a"]')!.textContent).toContain('Piece 3');
  });

  it('a clean Finished row shows no status line (pin)', async () => {
    await finishedWith(undefined);
    expect(container.querySelector('[data-testid="bulk-export-status-a"]')).toBeNull();
  });
});

describe('BulkExportModal — a finished row reveals its exported file', () => {
  type Reveal = (path: string) => Promise<void>;
  async function mountWith(runner: BulkExportRunner, reveal: Reveal): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<BulkExportModal runner={runner} workspaces={new WorkspaceRegistry(wsMem())} revealPath={reveal} />);
    });
  }
  const tab = async (name: string): Promise<void> => {
    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="bulk-export-tab-${name}"]`)!.click(); });
  };
  async function runWith(outcome: 'done' | 'failed' | 'hang', reveal: Reveal): Promise<BulkExportRunner> {
    const projects = [project('a')];
    const runner = new BulkExportRunner({
      listProjects: () => projects.map(p => ({ id: p.id, name: p.name, lastExportPath: `/out/${p.id}.mp4` })),
      loadProject: async id => projects.find(p => p.id === id) ?? null,
      storage: mem(),
      playChime: () => {},
      fileExists: async () => false,
      execute: () => outcome === 'hang' ? new Promise(() => {}) : Promise.resolve({ status: outcome, detail: 'x' }),
    });
    await mountWith(runner, reveal);
    act(() => { selectAll(runner); });
    await act(async () => { await runner.startSelected(); });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    return runner;
  }

  it('a Finished row has a keyboard-reachable, labelled reveal action that shows on hover and on focus', async () => {
    await runWith('done', vi.fn(async () => {}));
    await tab('finished');
    const btn = container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-reveal-a"]');
    expect(btn).not.toBeNull();
    expect(btn!.tagName).toBe('BUTTON');
    expect(btn!.getAttribute('aria-label')).toBe('Open file location of a');
    expect(btn!.title).toBe('Open file location');
    // `.kxd-xrow-open` is the shared hover / focus-within reveal (ProjectDashboard.css).
    expect(btn!.classList.contains('kxd-xrow-open')).toBe(true);
    btn!.focus();
    expect(document.activeElement).toBe(btn);
  });

  it('a queued / running row and a failed row have no reveal action', async () => {
    await runWith('hang', vi.fn(async () => {}));
    await tab('active');
    expect(container.querySelector('[data-testid^="bulk-export-reveal-"]')).toBeNull();
    act(() => root.unmount()); container.remove();
    await runWith('failed', vi.fn(async () => {}));
    await tab('failed');
    expect(container.querySelector('[data-testid="bulk-export-row-a"]')).not.toBeNull();
    expect(container.querySelector('[data-testid^="bulk-export-reveal-"]')).toBeNull();
  });

  it('activating it reveals that row\'s exact exported path', async () => {
    const reveal = vi.fn(async () => {});
    const runner = await runWith('done', reveal);
    expect(runner.snapshot().find(r => r.id === 'a')!.outputPath).toBe('/out/a.mp4');
    await tab('finished');
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-reveal-a"]')!.click(); });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith('/out/a.mp4');
  });

  it('a Finished row with no recorded path (an older batch) offers no reveal', async () => {
    const storage = mem();
    storage.setItem('kinetix:bulk-export-batch:v1', JSON.stringify({ rows: [{ id: 'a', name: 'a', selected: false, phase: 'done', message: 'Done', finishedAt: 1 }] }));
    const reveal = vi.fn(async () => {});
    const runner = new BulkExportRunner({
      listProjects: () => [{ id: 'a', name: 'a' }], loadProject: async () => project('a'),
      storage, playChime: () => {}, execute: async () => ({ status: 'done' }),
    });
    await mountWith(runner, reveal);
    await tab('finished');
    expect(container.querySelector('[data-testid="bulk-export-row-a"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bulk-export-reveal-a"]')).toBeNull();
    expect(reveal).not.toHaveBeenCalled();
  });

  it('a failed reveal (file moved / deleted) shows a message; the row and its state are unchanged', async () => {
    const runner = await runWith('done', vi.fn(async () => { throw new Error('No such file'); }));
    await tab('finished');
    const before = runner.snapshot().find(r => r.id === 'a');
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bulk-export-reveal-a"]')!.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(container.querySelector('[data-testid="bulk-export-reveal-error-a"]')!.textContent).toContain('Could not open the file location');
    expect(container.querySelector('[data-testid="bulk-export-row-a"]')).not.toBeNull();
    expect(runner.snapshot().find(r => r.id === 'a')).toEqual(before);
  });
});
