// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { SyncLoadingOverlay } from './SyncLoadingOverlay';

describe('SyncLoadingOverlay — static content', () => {
  it('shows the fresh-sync message while isProcessing is true', () => {
    const html = renderToStaticMarkup(<SyncLoadingOverlay isProcessing={true} onCancel={() => {}} />);
    expect(html).toContain('Preparing your project');
  });

  it('shows no technical jargon (no waveforms / counts)', () => {
    const html = renderToStaticMarkup(<SyncLoadingOverlay isProcessing={true} onCancel={() => {}} />);
    expect(html).not.toContain('waveform');
    expect(html).not.toContain('Building');
    expect(html).not.toContain('segment');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  it('does not render at all once isProcessing is false (never on plain reload)', () => {
    const html = renderToStaticMarkup(<SyncLoadingOverlay isProcessing={false} onCancel={() => {}} />);
    expect(html).toBe('');
  });
});

// plan-v3 item 5 (M3.5/C8) — the overlay's own Cancel control, and the
// Escape shortcut that mirrors every other blocking dialog in this app.
// beforeEach/afterEach are scoped INSIDE this describe (not module-level) so
// the static-content suite above — which never calls createRoot — doesn't
// try to unmount an undefined root.
describe('SyncLoadingOverlay — cancel wiring', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('clicking Cancel calls onCancel', async () => {
    const onCancel = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(<SyncLoadingOverlay isProcessing={true} onCancel={onCancel} />);
    });
    const button = container.querySelector<HTMLButtonElement>('[data-testid="sync-loading-cancel"]');
    expect(button).not.toBeNull();
    await act(async () => { button!.click(); });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape calls onCancel while the overlay is showing', async () => {
    const onCancel = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(<SyncLoadingOverlay isProcessing={true} onCancel={onCancel} />);
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape does nothing once the overlay has hidden — no stray listener survives isProcessing flipping false', async () => {
    const onCancel = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(<SyncLoadingOverlay isProcessing={true} onCancel={onCancel} />);
    });
    await act(async () => {
      root.render(<SyncLoadingOverlay isProcessing={false} onCancel={onCancel} />);
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
