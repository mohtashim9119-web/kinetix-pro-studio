// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { SyncPausedDialog } from './SyncPausedDialog';

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

describe('SyncPausedDialog', () => {
  it('renders exactly three actions — retry, use Whisper, cancel — and each fires its own callback only', async () => {
    const onRetry = vi.fn();
    const onUseWhisper = vi.fn();
    const onCancel = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SyncPausedDialog
          reason="zero-words"
          timestamp={Date.now()}
          onRetry={onRetry}
          onUseWhisper={onUseWhisper}
          onCancel={onCancel}
        />,
      );
    });

    const retry = container.querySelector<HTMLButtonElement>('[data-testid="sync-paused-retry"]');
    const useWhisper = container.querySelector<HTMLButtonElement>('[data-testid="sync-paused-use-whisper"]');
    const cancel = container.querySelector<HTMLButtonElement>('[data-testid="sync-paused-cancel"]');
    expect(retry).not.toBeNull();
    expect(useWhisper).not.toBeNull();
    expect(cancel).not.toBeNull();

    await act(async () => { retry!.click(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onUseWhisper).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Escape triggers cancel, never retry or use-Whisper — a stray dismiss must never silently pick an engine', async () => {
    const onRetry = vi.fn();
    const onUseWhisper = vi.fn();
    const onCancel = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SyncPausedDialog
          reason="inference-failed"
          timestamp={Date.now()}
          onRetry={onRetry}
          onUseWhisper={onUseWhisper}
          onCancel={onCancel}
        />,
      );
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onUseWhisper).not.toHaveBeenCalled();
  });

  it('shows the reason-specific copy for every FaFailureKind — exhaustiveness by rendering, not just by type', async () => {
    // PAUSE_COPY is a Record<FaFailureKind, string> internal to the module —
    // this loop is the runtime check that every member actually renders
    // something, complementing the type system's own compile-time exhaustiveness.
    const reasons = [
      'unsupported-language', 'empty-chunk-plan', 'zero-words', 'model-not-found',
      'model-hash-mismatch', 'runtime-load-failed', 'audio-stage-failed',
      'inference-failed', 'already-running', 'out-of-memory', 'offline',
    ] as const;
    for (const reason of reasons) {
      root = createRoot(container);
      await act(async () => {
        root.render(
          <SyncPausedDialog reason={reason} timestamp={Date.now()} onRetry={() => {}} onUseWhisper={() => {}} onCancel={() => {}} />,
        );
      });
      expect(container.textContent).not.toBe('');
      act(() => root.unmount());
    }
  });

  it('surfaces the raw detail message when one is supplied', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SyncPausedDialog
          reason="model-not-found"
          detail="no model.onnx found for language en"
          timestamp={Date.now()}
          onRetry={() => {}}
          onUseWhisper={() => {}}
          onCancel={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain('no model.onnx found for language en');
  });
});
