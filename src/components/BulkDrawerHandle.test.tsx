// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BulkDrawerHandle } from './BulkDrawerHandle';
import { Z } from './overlayLayers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

function mount(count: number, drawerOpen: boolean, onOpen = vi.fn()): ReturnType<typeof vi.fn> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<BulkDrawerHandle count={count} drawerOpen={drawerOpen} onOpen={onOpen} />); });
  return onOpen;
}
const handle = (): HTMLElement | null => container!.querySelector('[data-testid="bulk-drawer-handle"]');

describe('BulkDrawerHandle', () => {
  it('shows the batch size while a batch exists and the drawer is closed', () => {
    mount(3, false);
    expect(handle()).not.toBeNull();
    expect(container!.querySelector('[data-testid="bulk-drawer-handle-count"]')!.textContent).toBe('3');
    expect(handle()!.getAttribute('aria-label')).toBe('Bulk builds (3)');
  });
  it('is absent when there is no batch', () => {
    mount(0, false);
    expect(handle()).toBeNull();
  });
  it('is hidden while the drawer is open', () => {
    mount(3, true);
    expect(handle()).toBeNull();
  });
  it('opens through the supplied open logic', () => {
    const onOpen = mount(2, false);
    act(() => { handle()!.click(); });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it('sits on the drawer layer — above editor content, below every modal', () => {
    mount(1, false);
    expect(handle()!.className).toContain(Z.drawer);
  });
});
