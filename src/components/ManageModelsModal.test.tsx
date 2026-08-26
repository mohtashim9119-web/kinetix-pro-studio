// @vitest-environment jsdom
// WS2 Step 12 (A3) ManageModelsModal + WS2 Step 13 (status-bug fix, real FA
// download engine) regression coverage. Same jsdom + react-dom/client + act
// pattern BottomDrawer.trimDrag.test.tsx already uses (no @testing-library
// dependency in this repo).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ManageModelsModal } from './ManageModelsModal';

const mockCheckInstalledModels = vi.fn();
const mockImportLocalModel = vi.fn();
const mockDeleteInstalledModel = vi.fn();
const mockGetAvailableDiskSpace = vi.fn();
const mockDownloadFaModel = vi.fn();
const mockCancelFaModelDownload = vi.fn();

vi.mock('../services/models', async () => {
  const actual = await vi.importActual<typeof import('../services/models')>('../services/models');
  return {
    ...actual,
    checkInstalledModels: (...args: unknown[]) => mockCheckInstalledModels(...args),
    importLocalModel: (...args: unknown[]) => mockImportLocalModel(...args),
    deleteInstalledModel: (...args: unknown[]) => mockDeleteInstalledModel(...args),
    getAvailableDiskSpace: (...args: unknown[]) => mockGetAvailableDiskSpace(...args),
    downloadFaModel: (...args: unknown[]) => mockDownloadFaModel(...args),
    cancelFaModelDownload: (...args: unknown[]) => mockCancelFaModelDownload(...args),
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

// The REAL command shape (WS2 Step 13 Phase 2.6): a plain object with a
// `whisper` field and an `fa` map, exactly what `check_installed_models`'s
// Rust `InstalledModelsReport` serializes to and what the live probe
// (`src-tauri/tests/models_status_live.rs`) printed against real files on
// disk — not a shape hand-picked to make the mocked rendering path pass.
function realShapedReport() {
  return {
    whisper: { installed: false, bytes: 0 },
    fa: { en: { installed: true, bytes: 1_262_512_711 } },
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockCheckInstalledModels.mockResolvedValue(realShapedReport());
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

describe('ManageModelsModal — installed vs missing (real command shape)', () => {
  it('shows the installed badge for a language check_installed_models reports installed', async () => {
    await renderModal();
    expect(container.textContent).toContain('English');
    expect(container.textContent).toContain('Installed');
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

// WS2 Step 13 Phase 1/2.6 — the actual bug: a failed status check used to be
// swallowed into console.error, leaving every row silently rendered as
// "not installed" with no visible signal — indistinguishable from a genuine
// empty state. This is the test that WOULD have caught it: it asserts a
// visible error surfaces, not merely that rows render some default.
describe('ManageModelsModal — status-check failure is visible, not silently swallowed', () => {
  it('renders a visible error banner when check_installed_models rejects, instead of silently showing every row as missing', async () => {
    mockCheckInstalledModels.mockReset();
    mockCheckInstalledModels.mockRejectedValue(new Error('IPC channel not available'));
    await renderModal();
    expect(container.textContent).toContain('Could not check installed models');
    expect(container.textContent).toContain('IPC channel not available');
  });

  it('a Retry action re-invokes check_installed_models', async () => {
    mockCheckInstalledModels.mockReset();
    mockCheckInstalledModels.mockRejectedValueOnce(new Error('IPC channel not available'));
    mockCheckInstalledModels.mockResolvedValueOnce(realShapedReport());
    await renderModal();
    expect(mockCheckInstalledModels).toHaveBeenCalledTimes(1);

    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Retry status check',
    );
    expect(retryButton).toBeTruthy();
    await act(async () => {
      retryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCheckInstalledModels).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('Could not check installed models');
  });
});

describe('ManageModelsModal — refreshStatus runs on every completion path (Phase 2.4)', () => {
  it('re-invokes check_installed_models after a successful import', async () => {
    mockImportLocalModel.mockResolvedValue({ cancelled: false });
    await renderModal();
    expect(mockCheckInstalledModels).toHaveBeenCalledTimes(1);
    const importButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Import') && b.closest('section')?.textContent?.includes('Transcription'),
    );
    await act(async () => {
      importButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCheckInstalledModels).toHaveBeenCalledTimes(2);
  });

  it('re-invokes check_installed_models after a FAILED import too', async () => {
    mockImportLocalModel.mockRejectedValue(new Error('wrong file'));
    await renderModal();
    expect(mockCheckInstalledModels).toHaveBeenCalledTimes(1);
    const importButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Import') && b.closest('section')?.textContent?.includes('Transcription'),
    );
    await act(async () => {
      importButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCheckInstalledModels).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('wrong file');
  });

  it('re-invokes check_installed_models after delete', async () => {
    mockDeleteInstalledModel.mockResolvedValue(undefined);
    await renderModal();
    expect(mockCheckInstalledModels).toHaveBeenCalledTimes(1);
    const deleteButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('Delete English'),
    );
    await act(async () => {
      deleteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCheckInstalledModels).toHaveBeenCalledTimes(2);
  });

  it('re-invokes check_installed_models after a completed FA download', async () => {
    mockDownloadFaModel.mockImplementation((_lang: string, onProgress: (d: number, t: number) => void) => {
      onProgress(1_262_512_711, 1_262_512_711);
      return Promise.resolve();
    });
    await renderModal();
    expect(mockCheckInstalledModels).toHaveBeenCalledTimes(1);
    const downloadButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Download') && b.closest('section')?.textContent?.includes('Forced Alignment'),
    );
    await act(async () => {
      downloadButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCheckInstalledModels).toHaveBeenCalledTimes(2);
  });
});

describe('ManageModelsModal — FA download is real (WS2 Step 13 Phase 3.7)', () => {
  it('clicking Download invokes downloadFaModel with the language code and shows live progress', async () => {
    let resolveDownload: () => void = () => {};
    mockDownloadFaModel.mockImplementation(
      (lang: string, onProgress: (d: number, t: number) => void) =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
          onProgress(500_000, 1_262_512_711);
        }),
    );
    await renderModal();
    const downloadButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Download') && b.closest('section')?.textContent?.includes('Forced Alignment'),
    );
    await act(async () => {
      downloadButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockDownloadFaModel).toHaveBeenCalledWith('es', expect.any(Function));
    expect(container.textContent).toContain('%');
    resolveDownload();
  });

  it('clicking Cancel during an FA download invokes the real per-language cancel command', async () => {
    let resolveDownload: () => void = () => {};
    mockDownloadFaModel.mockImplementation(
      (_lang: string, onProgress: (d: number, t: number) => void) =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
          onProgress(100, 1_262_512_711);
        }),
    );
    await renderModal();
    const downloadButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Download') && b.closest('section')?.textContent?.includes('Forced Alignment'),
    );
    await act(async () => {
      downloadButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const cancelButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Cancel');
    expect(cancelButton).toBeTruthy();
    await act(async () => {
      cancelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockCancelFaModelDownload).toHaveBeenCalledWith('es');
    resolveDownload();
  });
});

describe('ManageModelsModal — import busyness (Phase 2.3)', () => {
  it('disables the Import button and shows a busy indicator while importing', async () => {
    let resolveImport: (r: { cancelled: boolean }) => void = () => {};
    mockImportLocalModel.mockImplementation(() => new Promise((resolve) => { resolveImport = resolve; }));
    await renderModal();
    const importButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Import') && b.closest('section')?.textContent?.includes('Transcription'),
    ) as HTMLButtonElement;
    await act(async () => {
      importButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(importButton.disabled).toBe(true);
    expect(container.textContent).toContain('Importing');
    resolveImport({ cancelled: false });
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
