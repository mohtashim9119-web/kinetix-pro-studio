// @vitest-environment jsdom
/**
 * Round 28 — in-app diagnostic log viewer. Pins: loads via
 * `getDiagnosticLogText` on mount, Refresh re-invokes it, Copy writes the
 * currently-displayed text to the clipboard, and Escape/close call back
 * out to the caller.
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getDiagnosticLogText = vi.fn();
vi.mock('../services/exportDiagnosticLog', () => ({
  getDiagnosticLogText: (...args: unknown[]) => getDiagnosticLogText(...args),
}));

import { DiagnosticLogModal } from './DiagnosticLogModal';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  getDiagnosticLogText.mockReset();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(onClose: () => void = () => {}): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(<DiagnosticLogModal onClose={onClose} />);
    await Promise.resolve();
  });
}

describe('DiagnosticLogModal', () => {
  it('loads the log text on mount', async () => {
    getDiagnosticLogText.mockResolvedValue('line one\nline two');
    await render();
    expect(getDiagnosticLogText).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="diagnostic-log-text"]')?.textContent)
      .toBe('line one\nline two');
  });

  it('shows the empty-state sentinel when no log entries exist', async () => {
    getDiagnosticLogText.mockResolvedValue('No log entries recorded yet.');
    await render();
    expect(container.querySelector('[data-testid="diagnostic-log-text"]')?.textContent)
      .toBe('No log entries recorded yet.');
  });

  it('Refresh re-invokes getDiagnosticLogText', async () => {
    getDiagnosticLogText.mockResolvedValue('first read');
    await render();
    getDiagnosticLogText.mockResolvedValue('second read');
    const refresh = container.querySelector<HTMLButtonElement>('[data-testid="diagnostic-log-refresh"]');
    await act(async () => {
      refresh!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getDiagnosticLogText).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="diagnostic-log-text"]')?.textContent).toBe('second read');
  });

  it('Copy writes the currently-displayed text to the clipboard', async () => {
    getDiagnosticLogText.mockResolvedValue('copy me');
    await render();
    const copyBtn = container.querySelector<HTMLButtonElement>('[data-testid="diagnostic-log-copy"]');
    await act(async () => {
      copyBtn!.click();
      await Promise.resolve();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copy me');
  });

  it('calls onClose on close button click and on Escape', async () => {
    getDiagnosticLogText.mockResolvedValue('x');
    let closed = 0;
    await render(() => { closed += 1; });
    const closeBtn = container.querySelector<HTMLButtonElement>('[data-testid="diagnostic-log-close"]');
    await act(async () => { closeBtn!.click(); });
    expect(closed).toBe(1);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closed).toBe(2);
  });
});
