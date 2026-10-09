// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { WorkspacesPane } from './WorkspacesPane';
import { WorkspaceRegistry } from './workspaceRegistry';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

const PROJECTS = [
  { id: 'p1', name: 'One' },
  { id: 'p2', name: 'Two' },
  { id: 'p3', name: 'Three' },
];

let container: HTMLDivElement;
let root: Root;
let reg: WorkspaceRegistry;

async function mount(draftIds?: Set<string>): Promise<void> {
  reg = new WorkspaceRegistry(memStorage());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<WorkspacesPane projects={PROJECTS} draftIds={draftIds} registry={reg} />); });
}

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.querySelector<T>(`[data-testid="${id}"]`);

function setInput(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function createWs(name: string): Promise<string> {
  await act(async () => { setInput(q<HTMLInputElement>('workspace-create-name')!, name); });
  await act(async () => { q<HTMLButtonElement>('workspace-create')!.click(); });
  return reg.snapshot().find(w => w.name === name)!.id;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Workspaces tab', () => {
  it('shows the empty state with zero workspaces', async () => {
    await mount();
    expect(q('workspaces-empty')).not.toBeNull();
  });

  it('create adds a full-width card with its member count', async () => {
    await mount();
    const id = await createWs('Channel A');
    expect(q('workspaces-empty')).toBeNull();
    expect(q(`workspace-name-${id}`)!.textContent).toBe('Channel A');
    expect(q(`workspace-count-${id}`)!.textContent).toBe('0 projects');
  });

  it('add existing projects by multi-select; the count follows', async () => {
    await mount();
    const id = await createWs('A');
    await act(async () => { q<HTMLButtonElement>(`workspace-add-${id}`)!.click(); });
    await act(async () => { q<HTMLInputElement>(`workspace-pick-${id}-p1`)!.click(); });
    await act(async () => { q<HTMLInputElement>(`workspace-pick-${id}-p3`)!.click(); });
    await act(async () => { q<HTMLButtonElement>(`workspace-pick-confirm-${id}`)!.click(); });
    expect(reg.snapshot()[0]!.projectIds).toEqual(['p1', 'p3']);
    expect(q(`workspace-count-${id}`)!.textContent).toBe('2 projects');
    expect(q(`workspace-member-${id}-p1`)).not.toBeNull();
  });

  it('adding a project that lives in another workspace moves it (one workspace per project)', async () => {
    await mount();
    const a = await createWs('A');
    const b = await createWs('B');
    reg.assign(['p1'], a);
    await act(async () => { q<HTMLButtonElement>(`workspace-add-${b}`)!.click(); });
    await act(async () => { q<HTMLInputElement>(`workspace-pick-${b}-p1`)!.click(); });
    await act(async () => { q<HTMLButtonElement>(`workspace-pick-confirm-${b}`)!.click(); });
    expect(reg.workspaceOf('p1')?.id).toBe(b);
    expect(q(`workspace-count-${a}`)!.textContent).toBe('0 projects');
  });

  it('move a member to another workspace, or to unassigned, from its row', async () => {
    await mount();
    const a = await createWs('A');
    const b = await createWs('B');
    await act(async () => { reg.assign(['p2'], a); });
    await act(async () => { q<HTMLButtonElement>(`workspace-toggle-${a}`)!.click(); });
    const select = q<HTMLSelectElement>('workspace-move-p2')!;
    await act(async () => {
      select.value = b;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(reg.workspaceOf('p2')?.id).toBe(b);
    await act(async () => { q<HTMLButtonElement>(`workspace-toggle-${b}`)!.click(); });
    const again = q<HTMLSelectElement>('workspace-move-p2')!;
    await act(async () => {
      again.value = '__unassigned__';
      again.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(reg.workspaceOf('p2')).toBeUndefined();
  });

  it('rename via the inline field (Enter commits, Escape cancels)', async () => {
    await mount();
    const id = await createWs('Old');
    await act(async () => { q<HTMLButtonElement>(`workspace-rename-${id}`)!.click(); });
    const input = q<HTMLInputElement>(`workspace-rename-input-${id}`)!;
    await act(async () => { setInput(input, 'New'); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(q(`workspace-name-${id}`)!.textContent).toBe('New');
    await act(async () => { q<HTMLButtonElement>(`workspace-rename-${id}`)!.click(); });
    const second = q<HTMLInputElement>(`workspace-rename-input-${id}`)!;
    await act(async () => { setInput(second, 'Discarded'); });
    await act(async () => { second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(q(`workspace-name-${id}`)!.textContent).toBe('New');
  });

  it('delete asks first; confirming drops the workspace and its projects fall back to unassigned', async () => {
    await mount();
    const id = await createWs('Doomed');
    await act(async () => { reg.assign(['p1', 'p2'], id); });
    await act(async () => { q<HTMLButtonElement>(`workspace-delete-${id}`)!.click(); });
    expect(reg.snapshot()).toHaveLength(1);
    await act(async () => { q<HTMLButtonElement>('confirm-dialog-cancel')!.click(); });
    expect(reg.snapshot()).toHaveLength(1);
    await act(async () => { q<HTMLButtonElement>(`workspace-delete-${id}`)!.click(); });
    await act(async () => { q<HTMLButtonElement>('confirm-dialog-confirm')!.click(); });
    expect(reg.snapshot()).toHaveLength(0);
    expect(reg.workspaceOf('p1')).toBeUndefined();
    expect(q('workspaces-empty')).not.toBeNull();
  });

  it('counts unbuilt bulk drafts as members', async () => {
    await mount(new Set(['draft-1']));
    const id = await createWs('A');
    await act(async () => { reg.assign(['p1', 'draft-1', 'deleted-long-ago'], id); });
    expect(q(`workspace-count-${id}`)!.textContent).toBe('2 projects');
  });
});
