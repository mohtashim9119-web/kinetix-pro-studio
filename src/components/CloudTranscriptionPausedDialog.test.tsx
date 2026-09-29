// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Wave 3 U4 — the cloud transcription pause: three visible answers, Escape is
// Cancel (never an engine pick), every reason has its own sentence.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { CloudTranscriptionPausedDialog, CLOUD_TRANSCRIPTION_PAUSE_COPY } from './CloudTranscriptionPausedDialog';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('CloudTranscriptionPausedDialog', () => {
  it('retry / transcribe on this computer / cancel — each fires only its own callback', async () => {
    const onRetry = vi.fn(); const onUseLocal = vi.fn(); const onCancel = vi.fn();
    await act(async () => {
      root.render(<CloudTranscriptionPausedDialog reason="offline" detail="Cloud transcription failed: dns" onRetry={onRetry} onUseLocal={onUseLocal} onCancel={onCancel} />);
    });
    expect(container.querySelectorAll('button')).toHaveLength(3);
    expect(container.textContent).toContain(CLOUD_TRANSCRIPTION_PAUSE_COPY.reason.offline);
    expect(container.textContent).toContain('Cloud transcription failed: dns');
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="cloud-transcription-use-local"]')!.click(); });
    expect(onUseLocal).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="cloud-transcription-retry"]')!.click(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Escape is Cancel — a stray dismiss never picks an engine', async () => {
    const onRetry = vi.fn(); const onUseLocal = vi.fn(); const onCancel = vi.fn();
    await act(async () => {
      root.render(<CloudTranscriptionPausedDialog reason="cloud-auth" onRetry={onRetry} onUseLocal={onUseLocal} onCancel={onCancel} />);
    });
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onUseLocal).not.toHaveBeenCalled();
  });

  it('every pause reason renders its own sentence', async () => {
    for (const reason of ['offline', 'cloud-auth', 'inference-failed'] as const) {
      await act(async () => {
        root.render(<CloudTranscriptionPausedDialog reason={reason} onRetry={() => {}} onUseLocal={() => {}} onCancel={() => {}} />);
      });
      expect(container.textContent).toContain(CLOUD_TRANSCRIPTION_PAUSE_COPY.reason[reason]);
    }
  });
});
