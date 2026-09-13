// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { LowDiskPreflightDialog } from './LowDiskPreflightDialog';
import { formatBytes } from '../services/webcodecsExport/diskFull';

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

async function renderDialog(props: {
  requiredBytes: number;
  availableBytes: number;
  reclaimableBytes: number;
  showReclaimAction: boolean;
}): Promise<{ onReclaim: ReturnType<typeof vi.fn>; onDismiss: ReturnType<typeof vi.fn> }> {
  const onReclaim = vi.fn();
  const onDismiss = vi.fn();
  root = createRoot(container);
  await act(async () => {
    root.render(
      <LowDiskPreflightDialog
        requiredBytes={props.requiredBytes}
        availableBytes={props.availableBytes}
        reclaimableBytes={props.reclaimableBytes}
        showReclaimAction={props.showReclaimAction}
        onReclaim={onReclaim}
        onDismiss={onDismiss}
      />,
    );
  });
  return { onReclaim, onDismiss };
}

describe('LowDiskPreflightDialog', () => {
  it('renders the three byte props and does not derive a fourth', async () => {
    await renderDialog({
      requiredBytes: 1_720_320_000,
      availableBytes: 100_000_000,
      reclaimableBytes: 400_000_000,
      showReclaimAction: false,
    });
    expect(container.querySelector('[data-testid="low-disk-required"]')?.textContent)
      .toBe(formatBytes(1_720_320_000));
    expect(container.querySelector('[data-testid="low-disk-available"]')?.textContent)
      .toBe(formatBytes(100_000_000));
    expect(container.querySelector('[data-testid="low-disk-reclaimable"]')?.textContent)
      .toBe(formatBytes(400_000_000));
  });

  it('shows the inline reclaim action when showReclaimAction is true', async () => {
    const { onReclaim } = await renderDialog({
      requiredBytes: 500,
      availableBytes: 100,
      reclaimableBytes: 50,
      showReclaimAction: true,
    });
    const button = container.querySelector<HTMLButtonElement>('[data-testid="low-disk-reclaim"]');
    expect(button).not.toBeNull();
    await act(async () => { button!.click(); });
    expect(onReclaim).toHaveBeenCalledTimes(1);
  });

  it('hides the reclaim action when showReclaimAction is false, even if available + reclaimable would cover required', async () => {
    await renderDialog({
      requiredBytes: 100,
      availableBytes: 40,
      reclaimableBytes: 80,
      showReclaimAction: false,
    });
    expect(container.querySelector('[data-testid="low-disk-reclaim"]')).toBeNull();
  });

  it('shows the reclaim action when showReclaimAction is true, even if available + reclaimable would not cover required', async () => {
    await renderDialog({
      requiredBytes: 1_000,
      availableBytes: 10,
      reclaimableBytes: 10,
      showReclaimAction: true,
    });
    expect(container.querySelector('[data-testid="low-disk-reclaim"]')).not.toBeNull();
  });
});
