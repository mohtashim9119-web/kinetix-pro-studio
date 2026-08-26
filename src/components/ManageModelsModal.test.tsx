// @vitest-environment jsdom
// WS2 Step 12 (A3) — ManageModelsModal: renders installed vs missing state
// from a mocked check_installed_models, Download stays enabled-but-explains
// (Q3), and cancel/import wire to the real service calls. Same
// jsdom + react-dom/client + act pattern BottomDrawer.trimDrag.test.tsx
// already uses (no @testing-library dependency in this repo).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ManageModelsModal } from './ManageModelsModal';

const mockCheckInstalledModels = vi.fn();
const mockImportLocalModel = vi.fn();
const mockDeleteInstalledModel = vi.fn();
const mockGetAvailableDiskSpace = vi.fn();

vi.mock('../services/models', async () => {
  const actual = await vi.importActual<typeof import('../services/models')>('../services/models');
  return {
    ...actual,
    checkInstalledModels: (...args: unknown[]) => mockCheckInstalledModels(...args),
    importLocalModel: (...args: unknown[]) => mockImportLocalModel(...args),
    deleteInstalledModel: (...args: unknown[]) => mockDeleteInstalledModel(...args),
    getAvailableDiskSpace: (...args: unknown[]) => mockGetAvailableDiskSpace(...args),
  };
});

const mockGetWhisperModelStatus = vi.fn();
const mockDownloadWhisperModel = vi.fn();
const mockCancelWhisperModelDownload = vi.fn();

vi.mock('../services/modelDownload', () => ({
  getWhisperModelStatus: (...args: unknown[]) => mockGetWhisperModelStatus(...args),
  downloadWhisperModel: (...args: unknown[]) => mockDownloadWhisperModel(...args),
  cancelWhisperModelDownload: (...args: unknown[]) => mockCancelWhisperModelDownload(...args),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockCheckInstalledModels.mockResolvedValue({
    whisper: { installed: false, bytes: 0 },
    fa: { en: { installed: true, bytes: 1_262_512_711 } },
  });
  mockGetAvailableDiskSpace.mockResolvedValue(50 * 1024 ** 3);
  mockGetWhisperModelStatus.mockResolvedValue({ present: false, partialBytes: 0, totalBytes: 1_624_555_275 });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function renderModal(props: Partial<React.ComponentProps<typeof ManageModelsModal>> = {}) {
  root = createRoot(container);
  await act(async () => {
    root.render(<ManageModelsModal onClose={() => {}} {...props} />);
  });
  // Flush the async checkInstalledModels/getAvailableDiskSpace effects.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ManageModelsModal — installed vs missing', () => {
  it('shows the installed badge for a language check_installed_models reports installed', async () => {
    await renderModal();
    expect(container.textContent).toContain('English');
    const enRow = Array.from(container.querySelectorAll('div')).find((el) =>
      el.textContent?.includes('English'),
    );
    expect(enRow?.querySelector('svg')).toBeTruthy(); // CheckCircle2 icon present somewhere in the row tree
  });

  it('shows Import and Download controls for a model reported as not installed', async () => {
    await renderModal();
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons.some((t) => t?.includes('Import'))).toBe(true);
    expect(buttons.some((t) => t?.includes('Download'))).toBe(true);
  });

  it('marks the project-needed language row', async () => {
    await renderModal({ projectLanguage: 'es' });
    expect(container.textContent).toContain('Needed by this project');
  });
});

describe('ManageModelsModal — Download stays enabled, explains rather than fails silently', () => {
  it('Download button is not disabled, and clicking it surfaces an actionable message instead of attempting a network call', async () => {
    await renderModal();
    const downloadButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('Download'),
    );
    // FA Download button — the whisper one goes through a real downloader
    // and is asserted separately below.
    const faDownload = downloadButtons.find((b) => !b.closest('section')?.textContent?.includes('Transcription'));
    expect(faDownload).toBeTruthy();
    expect(faDownload?.disabled).toBeFalsy();

    await act(async () => {
      faDownload!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('not yet configured');
  });
});

describe('ManageModelsModal — cancel and import wire to the real service calls', () => {
  it('clicking Import invokes importLocalModel with the whisper model id', async () => {
    mockImportLocalModel.mockResolvedValue({ cancelled: false });
    await renderModal();
    const importButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Import') && b.closest('section')?.textContent?.includes('Transcription'),
    );
    await act(async () => {
      importButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockImportLocalModel).toHaveBeenCalledWith('whisper');
  });

  it('surfaces the verbatim backend import error text in the row', async () => {
    mockImportLocalModel.mockRejectedValue(new Error('imported file does not start with the ggml magic bytes'));
    await renderModal();
    const importButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Import') && b.closest('section')?.textContent?.includes('Transcription'),
    );
    await act(async () => {
      importButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain('imported file does not start with the ggml magic bytes');
  });

  it('clicking Cancel during a whisper download invokes the real cancel command', async () => {
    let resolveDownload: () => void = () => {};
    mockDownloadWhisperModel.mockImplementation(
      (onProgress: (d: number, t: number) => void) =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
          onProgress(100, 1_624_555_275);
        }),
    );
    await renderModal();
    const startButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Download') && b.closest('section')?.textContent?.includes('Transcription'),
    );
    await act(async () => {
      startButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const cancelButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Cancel');
    expect(cancelButton).toBeTruthy();
    await act(async () => {
      cancelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockCancelWhisperModelDownload).toHaveBeenCalled();
    resolveDownload();
  });
});
