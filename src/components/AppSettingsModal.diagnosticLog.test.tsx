// @vitest-environment jsdom
/**
 * Round 28 — the "View diagnostic logs" entry point lives as its own last
 * block in App Settings (moved here from StorageSettingsSection per the
 * owner's placement call). Pins: it renders after every other block, opens
 * the modal, and Escape while the log modal is open closes only the log
 * modal, not the whole settings surface.
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/tauriFfmpeg', () => ({
  isTauri: () => false,
}));

vi.mock('../services/exportDiagnosticLog', () => ({
  getDiagnosticLogText: vi.fn().mockResolvedValue('No log entries recorded yet.'),
}));

import { AppSettingsModal } from './AppSettingsModal';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('AppSettingsModal — Diagnostics block', () => {
  it('renders the Diagnostics block as the last block, after New Project Defaults', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(<AppSettingsModal onClose={() => {}} onOpenStorageRelocation={() => {}} />);
    });
    const blocks = [...container.querySelectorAll('[data-testid^="app-settings-block-"]')];
    const testIds = blocks.map((b) => b.getAttribute('data-testid'));
    expect(testIds[testIds.length - 1]).toBe('app-settings-block-diagnostics');
    expect(testIds).toContain('app-settings-block-new-project-defaults');
  });

  it('opens the diagnostic log modal from the Diagnostics block', async () => {
    await import('./DiagnosticLogModal');
    root = createRoot(container);
    await act(async () => {
      root.render(<AppSettingsModal onClose={() => {}} onOpenStorageRelocation={() => {}} />);
    });
    expect(container.querySelector('[data-testid="diagnostic-log-modal"]')).toBeNull();
    const button = container.querySelector<HTMLButtonElement>('[data-testid="app-settings-view-diagnostic-log"]');
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[data-testid="diagnostic-log-modal"]')).not.toBeNull();
  });

  it('Escape closes only the log modal, not the outer settings modal, while it is open', async () => {
    await import('./DiagnosticLogModal');
    let outerClosed = 0;
    root = createRoot(container);
    await act(async () => {
      root.render(<AppSettingsModal onClose={() => { outerClosed += 1; }} onOpenStorageRelocation={() => {}} />);
    });
    const button = container.querySelector<HTMLButtonElement>('[data-testid="app-settings-view-diagnostic-log"]');
    await act(async () => {
      button!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[data-testid="diagnostic-log-modal"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[data-testid="diagnostic-log-modal"]')).toBeNull();
    expect(outerClosed).toBe(0);
  });
});
