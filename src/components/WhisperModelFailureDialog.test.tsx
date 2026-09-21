// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { WhisperModelFailureDialog, WHISPER_MODEL_FAILURE_COPY } from './WhisperModelFailureDialog';

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

describe('WhisperModelFailureDialog', () => {
  it('renders exactly two actions — download, cancel — and each fires its own callback only', async () => {
    const onDownloadModel = vi.fn();
    const onCancel = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <WhisperModelFailureDialog kind="model-not-found" onDownloadModel={onDownloadModel} onCancel={onCancel} />,
      );
    });

    const download = container.querySelector<HTMLButtonElement>('[data-testid="whisper-model-failure-download"]');
    const cancel = container.querySelector<HTMLButtonElement>('[data-testid="whisper-model-failure-cancel"]');
    expect(download).not.toBeNull();
    expect(cancel).not.toBeNull();

    await act(async () => { download!.click(); });
    expect(onDownloadModel).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Escape triggers cancel, never download — a stray dismiss must never kick off a download on its own', async () => {
    const onDownloadModel = vi.fn();
    const onCancel = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <WhisperModelFailureDialog kind="model-hash-mismatch" onDownloadModel={onDownloadModel} onCancel={onCancel} />,
      );
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDownloadModel).not.toHaveBeenCalled();
  });

  it('shows a distinct reason line for missing vs. corrupt — the two typed WhisperFailureKind reasons this dialog fires for', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <WhisperModelFailureDialog kind="model-not-found" onDownloadModel={() => {}} onCancel={() => {}} />,
      );
    });
    const notFoundText = container.textContent ?? '';
    expect(notFoundText).toContain(WHISPER_MODEL_FAILURE_COPY.reason['model-not-found']);
    expect(notFoundText).not.toContain(WHISPER_MODEL_FAILURE_COPY.reason['model-hash-mismatch']);
    act(() => root.unmount());

    root = createRoot(container);
    await act(async () => {
      root.render(
        <WhisperModelFailureDialog kind="model-hash-mismatch" onDownloadModel={() => {}} onCancel={() => {}} />,
      );
    });
    const mismatchText = container.textContent ?? '';
    expect(mismatchText).toContain(WHISPER_MODEL_FAILURE_COPY.reason['model-hash-mismatch']);
    expect(mismatchText).not.toContain(WHISPER_MODEL_FAILURE_COPY.reason['model-not-found']);
  });
});
