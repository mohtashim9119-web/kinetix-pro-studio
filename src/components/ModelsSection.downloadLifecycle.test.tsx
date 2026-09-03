// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// WS2 T4.4 Defect B — a download is a background transfer, not modal state.
//
// The defect: closing the dialog mid-download and reopening it showed
// "Resume" while the transfer was still running, because `ModelsSection` held
// the whole observable state in `useState` and re-derived the row from disk on
// remount. Clicking that Resume started a SECOND writer on the same `.part`,
// which is Defect A's root cause — so these two defects are one mechanism seen
// from two ends, and the Rust-side single-flight registry
// (`model_download.rs::try_acquire_in_flight`) is what actually holds. These
// tests cover the UI half: what the user is shown, and what they are offered.
//
// Same jsdom + react-dom/client + act pattern as ManageModelsModal.test.tsx —
// no @testing-library dependency in this repo.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ModelsSection } from './ModelsSection';
import {
  startDownload,
  isDownloadInFlight,
  getDownloadRecord,
  __resetDownloadStoreForTests,
} from '../services/modelDownloadStore';

const mockCheckInstalledModels = vi.fn();
const mockGetAvailableDiskSpace = vi.fn();
const mockDownloadFaModel = vi.fn();
const mockCancelFaModelDownload = vi.fn();
const mockFaModelStatus = vi.fn();

vi.mock('../services/models', async () => {
  const actual = await vi.importActual<typeof import('../services/models')>('../services/models');
  return {
    ...actual,
    checkInstalledModels: (...a: unknown[]) => mockCheckInstalledModels(...a),
    importLocalModel: vi.fn(),
    deleteInstalledModel: vi.fn(),
    getAvailableDiskSpace: (...a: unknown[]) => mockGetAvailableDiskSpace(...a),
    downloadFaModel: (...a: unknown[]) => mockDownloadFaModel(...a),
    cancelFaModelDownload: (...a: unknown[]) => mockCancelFaModelDownload(...a),
    faModelStatus: (...a: unknown[]) => mockFaModelStatus(...a),
  };
});

vi.mock('../services/modelDownload', () => ({
  getWhisperModelStatus: vi.fn().mockResolvedValue({ present: false, partialBytes: 0, totalBytes: 0 }),
  downloadWhisperModel: vi.fn(),
  cancelWhisperModelDownload: vi.fn(),
}));

const TOTAL = 1_262_619_311;
const FR = ['fr'] as const;

let container: HTMLDivElement;
let root: Root | null = null;

function reportWith(installed: boolean) {
  return { whisper: { installed: false, bytes: 0 }, fa: { fr: { installed, bytes: installed ? TOTAL : 0 } } };
}

beforeEach(() => {
  __resetDownloadStoreForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  mockCheckInstalledModels.mockResolvedValue(reportWith(false));
  mockGetAvailableDiskSpace.mockResolvedValue(50 * 1024 ** 3);
  // A substantial resumable partial on disk: this is what made the old code
  // render "Resume" over a live transfer, so it must be present for these
  // tests to be able to fail.
  mockFaModelStatus.mockResolvedValue({ present: false, partialBytes: 900_000_000, totalBytes: TOTAL });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container.remove();
  vi.clearAllMocks();
  __resetDownloadStoreForTests();
});

async function mount(): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root!.render(<ModelsSection faLanguages={FR} includeWhisper={false} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The modal being closed. Nothing else — deliberately no cancel call, which
 *  is the behaviour under test. */
async function unmount(): Promise<void> {
  await act(async () => {
    root!.unmount();
  });
  root = null;
}

function actionButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.includes('Download') || b.textContent?.includes('Resume'),
  );
}

function cancelButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel');
}

/** Starts a download through the row's own button and hands back its
 *  channel callbacks, so a test drives the same path a user does. */
async function startViaUi(): Promise<{
  progress: (d: number, t: number) => void;
  finish: () => void;
  fail: (e: unknown) => void;
}> {
  let progress: (d: number, t: number) => void = () => {};
  let finish: () => void = () => {};
  let fail: (e: unknown) => void = () => {};
  mockDownloadFaModel.mockImplementation(
    (_lang: string, onProgress: (d: number, t: number) => void) =>
      new Promise<void>((resolve, reject) => {
        progress = onProgress;
        finish = resolve;
        fail = reject;
      }),
  );
  await act(async () => {
    actionButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return { progress, finish, fail };
}

describe('ModelsSection — a download outlives the modal (WS2 T4.4, Defect B)', () => {
  it('shows the live progress bar again on remount, not Resume, while the transfer is still running', async () => {
    await mount();
    const t = await startViaUi();
    await act(async () => t.progress(600_000_000, TOTAL));
    expect(container.textContent).toContain('(47%)');

    await unmount();
    // Bytes keep arriving with nobody watching — the transfer never knew the
    // dialog was closed.
    await act(async () => t.progress(900_000_000, TOTAL));

    await mount();
    expect(isDownloadInFlight('fa-fr')).toBe(true);
    expect(container.textContent).toContain('(71%)');
    expect(container.querySelector('[data-testid="models-section"]')?.textContent).toContain('Cancel');
    t.finish();
  });

  it('offers neither Download nor Resume for a pack already in flight', async () => {
    await mount();
    const t = await startViaUi();
    await act(async () => t.progress(600_000_000, TOTAL));
    await unmount();
    await mount();

    // The status probe still reports 900 MB of resumable partial on disk —
    // the exact input that made the old code offer Resume over a live
    // transfer. Offering it is what let a second writer onto the `.part`.
    expect(mockFaModelStatus).toHaveBeenCalledWith('fr');
    expect(actionButton()).toBeUndefined();
    expect(container.textContent).not.toContain('Resume');
    t.finish();
  });

  it('lands as installed when the transfer completes while the modal is closed', async () => {
    await mount();
    const t = await startViaUi();
    await act(async () => t.progress(600_000_000, TOTAL));
    await unmount();

    mockCheckInstalledModels.mockResolvedValue(reportWith(true));
    await act(async () => {
      t.finish();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(isDownloadInFlight('fa-fr')).toBe(false);

    await mount();
    expect(container.textContent).toContain('Installed');
    expect(actionButton()).toBeUndefined();
  });

  it('flips a mounted row to installed the moment a transfer it did not start settles', async () => {
    await mount();
    expect(container.textContent).not.toContain('Installed');

    // Started from another surface entirely (owner ruling A2/Q2: download
    // state is globally readable, whichever surface began it).
    let finish: () => void = () => {};
    startDownload('fa-fr', () => new Promise<void>((resolve) => { finish = resolve; }));
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('Cancel');

    mockCheckInstalledModels.mockResolvedValue(reportWith(true));
    await act(async () => {
      finish();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Installed');
  });

  it('does not cancel the transfer when the modal closes — only Cancel does', async () => {
    await mount();
    const t = await startViaUi();
    await act(async () => t.progress(600_000_000, TOTAL));

    await unmount();
    expect(mockCancelFaModelDownload).not.toHaveBeenCalled();
    expect(isDownloadInFlight('fa-fr')).toBe(true);

    await mount();
    await act(async () => {
      cancelButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockCancelFaModelDownload).toHaveBeenCalledWith('fr');

    // The Rust side answers a cancel with an AbortError, which returns the row
    // to idle with its partial offered for Resume.
    await act(async () => {
      t.fail(new DOMException('Aborted', 'AbortError'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(isDownloadInFlight('fa-fr')).toBe(false);
    expect(actionButton()?.textContent).toContain('Resume');
  });

  it('keeps a failure visible: an error raised while the modal was closed is on the row when it reopens', async () => {
    await mount();
    const t = await startViaUi();
    await act(async () => t.progress(600_000_000, TOTAL));
    await unmount();

    await act(async () => {
      t.fail(new Error('download interrupted after 3 attempts: connection closed — kept 858.3 MiB of 1.18 GiB'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await mount();
    expect(container.textContent).toContain('download interrupted after 3 attempts');
    // …and the row is actionable again without the user having to close and
    // reopen the dialog a second time.
    expect(actionButton()?.textContent).toContain('Resume');
  });
});

describe('modelDownloadStore — the UI half of single flight', () => {
  it('refuses to start a second transfer for a model already in flight', async () => {
    const runner = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    expect(startDownload('fa-fr', runner)).toBe(true);
    expect(startDownload('fa-fr', runner)).toBe(false);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('is keyed per model, so a second language still starts', () => {
    const runner = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    expect(startDownload('fa-fr', runner)).toBe(true);
    expect(startDownload('fa-de', runner)).toBe(true);
    expect(startDownload('whisper', runner)).toBe(true);
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it('drops the record once a transfer settles, so the model can be started again', async () => {
    let finish: () => void = () => {};
    startDownload('fa-fr', () => new Promise<void>((r) => { finish = r; }));
    expect(getDownloadRecord('fa-fr')?.phase).toBe('downloading');
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(getDownloadRecord('fa-fr')).toBeUndefined();
    expect(startDownload('fa-fr', () => new Promise<void>(() => {}))).toBe(true);
  });
});
