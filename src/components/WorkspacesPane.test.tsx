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

/** The stat tiles read "Projects" then the number — the number is the <dd>. */
const countOf = (id: string): string => q(`workspace-count-${id}`)!.querySelector('dd')!.textContent!;

describe('Workspaces tab', () => {
  it('shows the empty state with zero workspaces', async () => {
    await mount();
    expect(q('workspaces-empty')).not.toBeNull();
  });

  it('create adds a card with its member count', async () => {
    await mount();
    const id = await createWs('Channel A');
    expect(q('workspaces-empty')).toBeNull();
    expect(q(`workspace-name-${id}`)!.textContent).toBe('Channel A');
    expect(countOf(id)).toBe('0');
  });

  it('add existing projects by multi-select; the count follows', async () => {
    await mount();
    const id = await createWs('A');
    await act(async () => { q<HTMLButtonElement>(`workspace-add-${id}`)!.click(); });
    await act(async () => { q<HTMLInputElement>(`workspace-pick-${id}-p1`)!.click(); });
    await act(async () => { q<HTMLInputElement>(`workspace-pick-${id}-p3`)!.click(); });
    await act(async () => { q<HTMLButtonElement>(`workspace-pick-confirm-${id}`)!.click(); });
    expect(reg.snapshot()[0]!.projectIds).toEqual(['p1', 'p3']);
    expect(countOf(id)).toBe('2');
  });

  it('adding a project that lives in another workspace moves it (one workspace per project)', async () => {
    await mount();
    const a = await createWs('A');
    const b = await createWs('B');
    await act(async () => { reg.assign(['p1'], a); });
    await act(async () => { q<HTMLButtonElement>(`workspace-add-${b}`)!.click(); });
    await act(async () => { q<HTMLInputElement>(`workspace-pick-${b}-p1`)!.click(); });
    await act(async () => { q<HTMLButtonElement>(`workspace-pick-confirm-${b}`)!.click(); });
    expect(reg.workspaceOf('p1')?.id).toBe(b);
    expect(countOf(a)).toBe('0');
    expect(countOf(b)).toBe('1');
  });

  it('rename opens a dialog: Save commits, Cancel and Escape discard', async () => {
    await mount();
    const id = await createWs('Old');
    await act(async () => { q<HTMLButtonElement>(`workspace-rename-${id}`)!.click(); });
    await act(async () => { setInput(q<HTMLInputElement>(`workspace-rename-input-${id}`)!, 'New'); });
    await act(async () => { q<HTMLButtonElement>('workspace-rename-save')!.click(); });
    expect(q(`workspace-name-${id}`)!.textContent).toBe('New');
    await act(async () => { q<HTMLButtonElement>(`workspace-rename-${id}`)!.click(); });
    await act(async () => { setInput(q<HTMLInputElement>(`workspace-rename-input-${id}`)!, 'Discarded'); });
    await act(async () => { q<HTMLButtonElement>('workspace-dialog-cancel')!.click(); });
    expect(q(`workspace-name-${id}`)!.textContent).toBe('New');
    await act(async () => { q<HTMLButtonElement>(`workspace-rename-${id}`)!.click(); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(q(`workspace-rename-input-${id}`)).toBeNull();
    expect(q(`workspace-name-${id}`)!.textContent).toBe('New');
  });

  it('delete asks first; confirming drops the workspace and its projects fall back to unassigned', async () => {
    await mount();
    const id = await createWs('Doomed');
    await act(async () => { reg.assign(['p1', 'p2'], id); });
    await act(async () => { q<HTMLButtonElement>(`workspace-delete-${id}`)!.click(); });
    expect(reg.snapshot()).toHaveLength(1);
    await act(async () => { q<HTMLButtonElement>('workspace-dialog-cancel')!.click(); });
    expect(reg.snapshot()).toHaveLength(1);
    await act(async () => { q<HTMLButtonElement>(`workspace-delete-${id}`)!.click(); });
    await act(async () => { q<HTMLButtonElement>('workspace-delete-confirm')!.click(); });
    expect(reg.snapshot()).toHaveLength(0);
    expect(reg.workspaceOf('p1')).toBeUndefined();
    expect(q('workspaces-empty')).not.toBeNull();
  });

  it('counts unbuilt bulk drafts as members', async () => {
    await mount(new Set(['draft-1']));
    const id = await createWs('A');
    await act(async () => { reg.assign(['p1', 'draft-1', 'deleted-long-ago'], id); });
    expect(countOf(id)).toBe('2');
  });
});
