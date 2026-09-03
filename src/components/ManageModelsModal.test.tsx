// @vitest-environment jsdom
// WS2 Step 12 (A3) ManageModelsModal + WS2 Step 13 (status-bug fix, real FA
// download engine) regression coverage. Same jsdom + react-dom/client + act
// pattern BottomDrawer.trimDrag.test.tsx already uses (no @testing-library
// dependency in this repo).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ManageModelsModal } from './ManageModelsModal';
import { __resetDownloadStoreForTests, startDownload } from '../services/modelDownloadStore';

const mockCheckInstalledModels = vi.fn();
const mockImportLocalModel = vi.fn();
const mockDeleteInstalledModel = vi.fn();
const mockGetAvailableDiskSpace = vi.fn();
const mockDownloadFaModel = vi.fn();
const mockCancelFaModelDownload = vi.fn();
const mockFaModelStatus = vi.fn();

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
    faModelStatus: (...args: unknown[]) => mockFaModelStatus(...args),
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
  // Download state is module-level now (WS2 T4.4) so it survives unmount —
  // which also means it survives a test. A test that leaves a transfer
  // pending must not hand it to the next one.
  __resetDownloadStoreForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  mockCheckInstalledModels.mockResolvedValue(realShapedReport());
  mockGetAvailableDiskSpace.mockResolvedValue(50 * 1024 ** 3);
  mockGetWhisperModelStatus.mockResolvedValue({ present: false, partialBytes: 0, totalBytes: 1_624_555_275 });
  mockFaModelStatus.mockResolvedValue({ present: false, partialBytes: 0, totalBytes: 1_262_545_511 });
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
    // Third argument (WS2 T4.3) is the between-attempts retry callback.
    expect(mockDownloadFaModel).toHaveBeenCalledWith('es', expect.any(Function), expect.any(Function));
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

// ---------------------------------------------------------------------------
// WS2 T4.3 — resume affordance + between-attempts notice.
//
// The defect these lock: an FA row had no status command at all, so a pack
// with 1.02 GiB of resumable `.part` on disk rendered as "0 B" with a bare
// "Download", and a bounded retry inside the Rust engine looked from here like
// a frozen progress bar.
// ---------------------------------------------------------------------------

describe('ModelsSection — resume affordance (WS2 T4.3)', () => {
  function faButton(): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find(
      (b) =>
        (b.textContent?.includes('Download') || b.textContent?.includes('Resume')) &&
        b.closest('section')?.textContent?.includes('Forced Alignment'),
    );
  }

  it('offers Resume with the resumable byte count when fa_model_status reports a partial', async () => {
    mockFaModelStatus.mockResolvedValue({
      present: false,
      partialBytes: 1_071_567_076,
      totalBytes: 1_262_619_311,
    });
    await renderModal();
    expect(mockFaModelStatus).toHaveBeenCalledWith('es');
    const btn = faButton();
    expect(btn?.textContent).toContain('Resume');
    // 1_071_567_076 B is 0.998 GiB, so `formatBytes` renders MiB — this is
    // the operator's real French partial, kept as the fixture value.
    expect(btn?.textContent).toContain('1021.9 MiB');
  });

  it('offers a plain Download when the Rust side reports no resumable bytes', async () => {
    mockFaModelStatus.mockResolvedValue({ present: false, partialBytes: 0, totalBytes: 1_262_619_311 });
    await renderModal();
    const btn = faButton();
    expect(btn?.textContent).toContain('Download');
    expect(btn?.textContent).not.toContain('Resume');
  });

  it('falls back to Download rather than an error banner when the status lookup fails', async () => {
    mockFaModelStatus.mockRejectedValue(new Error('IPC channel not available'));
    await renderModal();
    expect(faButton()?.textContent).toContain('Download');
    // Not knowing whether a partial exists must never surface as an error —
    // the download resumes correctly either way.
    expect(container.textContent).not.toContain('IPC channel not available');
  });

  it('shows a Reconnecting line while the engine is between retry attempts, and clears it when bytes move again', async () => {
    let fireRetry: (n: { attempt: number; maxAttempts: number; reason: string }) => void = () => {};
    let fireProgress: (d: number, t: number) => void = () => {};
    let resolveDownload: () => void = () => {};
    mockDownloadFaModel.mockImplementation(
      (
        _lang: string,
        onProgress: (d: number, t: number) => void,
        onRetry: (n: { attempt: number; maxAttempts: number; reason: string }) => void,
      ) =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
          fireProgress = onProgress;
          fireRetry = onRetry;
          onProgress(50_000, 1_262_619_311);
        }),
    );
    await renderModal();
    await act(async () => {
      faButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="retry-notice"]')).toBeNull();

    await act(async () => {
      fireRetry({ attempt: 2, maxAttempts: 3, reason: 'error decoding response body' });
    });
    const notice = container.querySelector('[data-testid="retry-notice"]');
    expect(notice).toBeTruthy();
    expect(notice?.textContent).toContain('attempt 2 of 3');
    expect(notice?.textContent).toContain('error decoding response body');

    // A Progress event means bytes moved, so the notice is stale.
    await act(async () => {
      fireProgress(60_000, 1_262_619_311);
    });
    expect(container.querySelector('[data-testid="retry-notice"]')).toBeNull();
    resolveDownload();
  });

  it('re-reads the resume affordance after a failed download, since the engine may have kept or deleted the partial', async () => {
    mockFaModelStatus.mockResolvedValue({ present: false, partialBytes: 0, totalBytes: 1_262_619_311 });
    mockDownloadFaModel.mockRejectedValue(
      new Error('download interrupted after 3 attempts: connection reset — kept 1.00 GiB of 1.18 GiB'),
    );
    await renderModal();
    const callsBefore = mockFaModelStatus.mock.calls.length;
    await act(async () => {
      faButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockFaModelStatus.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(container.textContent).toContain('kept 1.00 GiB');
  });
});

describe('ModelsSection — progress never reads complete while bytes are short (WS2 T4.3)', () => {
  it('floors the percentage, so 99.9% of a pack does not display as 100%', async () => {
    const TOTAL = 1_262_619_311;
    let resolveDownload: () => void = () => {};
    let fireProgress: (d: number, t: number) => void = () => {};
    mockDownloadFaModel.mockImplementation(
      (_lang: string, onProgress: (d: number, t: number) => void) =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
          fireProgress = onProgress;
          onProgress(1, TOTAL);
        }),
    );
    await renderModal();
    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Download') && b.closest('section')?.textContent?.includes('Forced Alignment'),
    );
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // 99.9% — `Math.round` reported this as "100%" while ~1.2 MiB was still
    // missing, so a failure here read as a failure after completion.
    await act(async () => {
      fireProgress(Math.floor(TOTAL * 0.999), TOTAL);
    });
    expect(container.textContent).toContain('(99%)');
    expect(container.textContent).not.toContain('(100%)');

    // 100% only at the exact byte count the engine sends just before Done.
    await act(async () => {
      fireProgress(TOTAL, TOTAL);
    });
    expect(container.textContent).toContain('(100%)');
    resolveDownload();
  });
});

// ---------------------------------------------------------------------------
// WS2 T4.5 — a completed model must never render as "RESUME <full size>".
//
// The operator saw every installed row — Whisper and all five FA packs —
// offering "RESUME 1.51 GiB" / "RESUME 1.18 GiB". Those are
// `formatBytes(MODEL_SIZE_BYTES)` and `formatBytes(the fr manifest byteSize)`
// exactly, which is what identified the source: `status_for_target` returned
// `partial_bytes: expected_size` on its target-exists branch, and
// `refreshResumable` fed that straight to the Resume label without ever
// consulting `present`.
//
// Two independent guards are asserted here, because the row was wrong on both
// halves: the Rust side no longer reports a completed target's own size as
// resumable, AND the row withholds Download/Resume whenever a full-size file
// occupies the target path — a download there would be a no-op, since
// `stream_download_verified` returns Done on `final_path.exists()`.
// ---------------------------------------------------------------------------
describe('ModelsSection — an installed model never offers Resume (WS2 T4.5)', () => {
  const WHISPER_BYTES = 1_624_555_275;
  const FA_BYTES = 1_262_619_311;

  /** All six rows installed — the state the operator's machine was actually
   *  in (five FA packs at their exact manifest sizes plus the whisper model),
   *  so "not one row offers Resume" is a claim about every row rendered, not
   *  about one row surrounded by four that were never installed. */
  function installedReport() {
    return {
      whisper: { installed: true, bytes: WHISPER_BYTES },
      fa: Object.fromEntries(
        ['en', 'es', 'fr', 'de', 'pt'].map((l) => [l, { installed: true, bytes: FA_BYTES }]),
      ),
    };
  }

  it('renders READY / INSTALLED with no Resume button when both probes agree the model is complete', async () => {
    mockCheckInstalledModels.mockResolvedValue(installedReport());
    mockGetWhisperModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: WHISPER_BYTES });
    mockFaModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: FA_BYTES });
    await renderModal();

    expect(container.textContent).toContain('Ready');
    expect(container.querySelectorAll('[aria-label="INSTALLED"]')).toHaveLength(5);
    expect(container.textContent).not.toContain('Resume');
    expect(container.textContent).not.toContain('Checking');
    expect(container.textContent).not.toContain('Unverified');
    expect(container.textContent).not.toContain('1.51 GiB / ');
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(labels.some((t) => t.includes('Resume') || t.includes('Download'))).toBe(false);
    expect(labels.some((t) => t.includes('Import'))).toBe(false);
  });

  it('withholds Resume for a complete model while the authoritative check is still running', async () => {
    // `check_installed_models` is one blocking call across every row and pays
    // a full file hash for any row without its `.sha256` cache, so this window
    // is real and can last seconds. It is the window the operator was looking
    // at: nothing had reported `installed` yet, so every row fell through to
    // its download affordance.
    mockCheckInstalledModels.mockReturnValue(new Promise(() => {}));
    mockGetWhisperModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: WHISPER_BYTES });
    mockFaModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: FA_BYTES });
    await renderModal();

    expect(container.textContent).not.toContain('Resume');
    expect(container.textContent).not.toContain('Download');
    // …and says so, rather than silently rendering an empty row.
    expect(container.querySelector('[data-testid="whisper-target-occupied"]')?.textContent).toBe('Checking…');
    expect(container.querySelector('[data-testid="fa-target-occupied-es"]')?.textContent).toBe('Checking…');
  });

  it('offers Delete, not Download, for a full-size file the authoritative check rejects', async () => {
    // Right size, failed verification. A Download button here is a trap: the
    // engine returns Done the instant the target exists, so clicking it would
    // appear to succeed and change nothing. Delete is the only action that can
    // move this row forward.
    mockCheckInstalledModels.mockResolvedValue({
      whisper: { installed: false, bytes: WHISPER_BYTES },
      fa: { es: { installed: false, bytes: FA_BYTES } },
    });
    mockGetWhisperModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: WHISPER_BYTES });
    mockFaModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: FA_BYTES });
    await renderModal();

    expect(container.querySelector('[data-testid="whisper-target-occupied"]')?.textContent).toBe('Unverified');
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(labels.some((t) => t.includes('Resume') || t.includes('Download'))).toBe(false);
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) => b.getAttribute('aria-label') === 'Delete whisper model',
      ),
    ).toBe(true);
  });

  it('still offers Download when the target path holds no complete file', async () => {
    // The guard must not swallow the ordinary missing-model case, or every row
    // becomes un-downloadable.
    mockGetWhisperModelStatus.mockResolvedValue({ present: false, partialBytes: 0, totalBytes: WHISPER_BYTES });
    mockFaModelStatus.mockResolvedValue({ present: false, partialBytes: 0, totalBytes: FA_BYTES });
    await renderModal();
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(labels.some((t) => t.includes('Download'))).toBe(true);
  });

  it('still offers Resume for a genuine partial, which is what the Resume label is for', async () => {
    mockGetWhisperModelStatus.mockResolvedValue({ present: false, partialBytes: 0, totalBytes: WHISPER_BYTES });
    mockFaModelStatus.mockResolvedValue({
      present: false,
      partialBytes: 1_071_567_076,
      totalBytes: FA_BYTES,
    });
    await renderModal();
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Resume'),
    );
    expect(btn?.textContent).toContain('1021.9 MiB');
  });

  it('clears a stale download error once the model is on disk', async () => {
    // The store keeps a failure across an unmount (WS2 T4.4), which is right —
    // but not once the thing it failed to fetch is sitting there installed.
    mockCheckInstalledModels.mockResolvedValue(installedReport());
    mockFaModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: FA_BYTES });
    mockGetWhisperModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: WHISPER_BYTES });
    startDownload('fa-es', () => Promise.reject(new Error('download interrupted after 3 attempts')));
    // (rejection is handled inside the store; nothing here observes it)
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await renderModal();
    expect(container.textContent).not.toContain('download interrupted');
    expect(container.textContent).toContain('Installed');
  });
});
