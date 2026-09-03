// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// WS2 T4.6 — a page reload must re-attach to a running download, not offer a
// second one.
//
// Operator sequence: pause a download mid-transfer by reloading the app
// (Cmd+R / the dev server's own refresh), then click Resume. The Rust task
// SURVIVES a webview reload — `tauri::async_runtime` does not cancel a
// spawned command future when the page that started it goes away — so the
// download is still running, and the click was refused: "already running".
// Quitting the app instead worked, because quitting actually kills the task,
// leaving an ordinary `.part` to resume from cold.
//
// So a fresh page must be able to tell "this is running" apart from "this has
// a partial on disk", which the filesystem alone cannot do (a growing `.part`
// and an abandoned one are the same `stat`), and re-attach to the SAME
// transfer's event stream instead of starting a second one.
//
// This file covers the UI half: `ModelDownloadStatus.inFlight` drives
// `adoptInFlight`, which calls the attach commands rather than the plain
// download commands, and the row renders exactly as if it had started the
// transfer itself. `model_download.rs`'s own tests (`a_reloaded_page_
// attaches_to_the_running_download_and_receives_its_events` and its
// neighbours) cover the Rust side — the sink swap, and that a second attempt
// no longer means a second writer.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ModelsSection } from './ModelsSection';
import { isDownloadInFlight, __resetDownloadStoreForTests } from '../services/modelDownloadStore';

const mockCheckInstalledModels = vi.fn();
const mockGetAvailableDiskSpace = vi.fn();
const mockDownloadFaModel = vi.fn();
const mockAttachFaModelDownload = vi.fn();
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
    attachFaModelDownload: (...a: unknown[]) => mockAttachFaModelDownload(...a),
    cancelFaModelDownload: (...a: unknown[]) => mockCancelFaModelDownload(...a),
    faModelStatus: (...a: unknown[]) => mockFaModelStatus(...a),
  };
});

vi.mock('../services/modelDownload', () => ({
  getWhisperModelStatus: vi.fn().mockResolvedValue({
    present: false,
    partialBytes: 0,
    totalBytes: 0,
    inFlight: false,
  }),
  downloadWhisperModel: vi.fn(),
  attachWhisperModelDownload: vi.fn(),
  cancelWhisperModelDownload: vi.fn(),
}));

const TOTAL = 1_262_619_311;
const FR = ['fr'] as const;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  __resetDownloadStoreForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  mockCheckInstalledModels.mockResolvedValue({
    whisper: { installed: false, bytes: 0 },
    fa: { fr: { installed: false, bytes: 0 } },
  });
  mockGetAvailableDiskSpace.mockResolvedValue(50 * 1024 ** 3);
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
    await Promise.resolve();
  });
}

function cancelButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel');
}

function resumeOrDownloadButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.includes('Resume') || b.textContent?.includes('Download'),
  );
}

describe('ModelsSection — a reload re-attaches to a running download (WS2 T4.6)', () => {
  it('shows live progress and Cancel, not Resume, when status reports the target in flight', async () => {
    mockFaModelStatus.mockResolvedValue({
      present: false,
      partialBytes: 600_000_000,
      totalBytes: TOTAL,
      inFlight: true,
    });
    mockAttachFaModelDownload.mockImplementation(
      () => new Promise<void>(() => {}), // still running; never resolves in this test
    );

    await mount();

    expect(mockAttachFaModelDownload).toHaveBeenCalledWith('fr', expect.any(Function), expect.any(Function));
    // NOT the plain downloader — attaching must never start a second transfer.
    expect(mockDownloadFaModel).not.toHaveBeenCalled();
    expect(isDownloadInFlight('fa-fr')).toBe(true);
    expect(cancelButton()).toBeTruthy();
    expect(resumeOrDownloadButton()).toBeUndefined();
  });

  it('receives the running transfer\'s progress through the attach channel', async () => {
    let progress: (d: number, t: number) => void = () => {};
    mockFaModelStatus.mockResolvedValue({
      present: false,
      partialBytes: 600_000_000,
      totalBytes: TOTAL,
      inFlight: true,
    });
    mockAttachFaModelDownload.mockImplementation(
      (_lang: string, onProgress: (d: number, t: number) => void) =>
        new Promise<void>((resolve) => {
          progress = onProgress;
          void resolve;
        }),
    );

    await mount();
    await act(async () => progress(900_000_000, TOTAL));

    expect(container.textContent).toContain('(71%)');
  });

  it('lands as INSTALLED when the re-attached transfer completes', async () => {
    let finish: () => void = () => {};
    mockFaModelStatus.mockResolvedValue({
      present: false,
      partialBytes: 600_000_000,
      totalBytes: TOTAL,
      inFlight: true,
    });
    mockAttachFaModelDownload.mockImplementation(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    await mount();
    expect(cancelButton()).toBeTruthy();

    mockCheckInstalledModels.mockResolvedValue({
      whisper: { installed: false, bytes: 0 },
      fa: { fr: { installed: true, bytes: TOTAL } },
    });
    mockFaModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: TOTAL, inFlight: false });
    await act(async () => {
      finish();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Installed');
  });

  it('does not attach twice when refreshResumable re-runs while the target is still in flight', async () => {
    // `subscribeDownloadSettled` re-runs `refreshResumable` for EVERY row
    // whenever ANY tracked download settles — so a second, unrelated
    // download finishing while `fr` is still mid-transfer must not cause a
    // second `attachFaModelDownload` call for `fr`. Without the
    // `isDownloadInFlight` guard in `adoptInFlight`, the second status probe
    // reporting the same `inFlight: true` would trigger exactly that.
    mockFaModelStatus.mockResolvedValue({
      present: false,
      partialBytes: 600_000_000,
      totalBytes: TOTAL,
      inFlight: true,
    });
    mockAttachFaModelDownload.mockImplementation(() => new Promise<void>(() => {}));

    await mount();
    expect(mockAttachFaModelDownload).toHaveBeenCalledTimes(1);

    const { startDownload: startUnrelated } = await import('../services/modelDownloadStore');
    await act(async () => {
      startUnrelated('whisper', () => Promise.resolve());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAttachFaModelDownload).toHaveBeenCalledTimes(1);
  });

  it('still offers a plain Resume for a genuine idle partial (inFlight: false)', async () => {
    mockFaModelStatus.mockResolvedValue({
      present: false,
      partialBytes: 600_000_000,
      totalBytes: TOTAL,
      inFlight: false,
    });
    await mount();

    expect(mockAttachFaModelDownload).not.toHaveBeenCalled();
    expect(resumeOrDownloadButton()?.textContent).toContain('Resume');
  });

  it('clicking Resume on a genuinely idle partial still calls the plain downloader, not attach', async () => {
    mockFaModelStatus.mockResolvedValue({
      present: false,
      partialBytes: 600_000_000,
      totalBytes: TOTAL,
      inFlight: false,
    });
    mockDownloadFaModel.mockImplementation(() => new Promise<void>(() => {}));
    await mount();

    await act(async () => {
      resumeOrDownloadButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockDownloadFaModel).toHaveBeenCalledWith('fr', expect.any(Function), expect.any(Function));
    expect(mockAttachFaModelDownload).not.toHaveBeenCalled();
  });
});
