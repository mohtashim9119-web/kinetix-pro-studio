// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach } from 'vitest';
import { BulkExportModal } from './BulkExportModal';
import { BulkExportRunner } from '../services/bulkExportQueue';
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

async function mount(runner: BulkExportRunner): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<BulkExportModal runner={runner} onClose={() => {}} />);
  });
}

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
