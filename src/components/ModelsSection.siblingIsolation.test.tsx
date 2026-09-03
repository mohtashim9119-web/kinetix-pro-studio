// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// WS2 T4.7 — operator question: "if I download one pack, will the OTHER
// installed packs be unaffected?" Every prior lifecycle/reattach test in this
// repo mounts a SINGLE language (`faLanguages = ['fr']`), so none of them can
// actually observe a sibling row — a regression that only shows up with two
// or more rows on screen was structurally invisible to the existing suite.
// This file mounts two: `es` (already installed, untouched throughout) and
// `fr` (downloading, then completing), and asserts `es` never flickers to
// Checking/Unverified/Resume while `fr` is in flight or when it finishes —
// `refresh()`'s `checkInstalledModels` call covers every row at once, and a
// stale/racy update there is exactly what could leak between rows.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ModelsSection } from './ModelsSection';
import { __resetDownloadStoreForTests } from '../services/modelDownloadStore';

const mockCheckInstalledModels = vi.fn();
const mockGetAvailableDiskSpace = vi.fn();
const mockDownloadFaModel = vi.fn();
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
    attachFaModelDownload: vi.fn(),
    cancelFaModelDownload: vi.fn(),
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

const FR_TOTAL = 1_262_619_311;
const ES_TOTAL = 1_262_545_511;
const LANGS = ['es', 'fr'] as const;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  __resetDownloadStoreForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  mockCheckInstalledModels.mockResolvedValue({
    whisper: { installed: false, bytes: 0 },
    fa: {
      es: { installed: true, bytes: ES_TOTAL },
      fr: { installed: false, bytes: 0 },
    },
  });
  mockGetAvailableDiskSpace.mockResolvedValue(50 * 1024 ** 3);
  mockFaModelStatus.mockImplementation((lang: string) =>
    Promise.resolve(
      lang === 'es'
        ? { present: true, partialBytes: 0, totalBytes: ES_TOTAL, inFlight: false }
        : { present: false, partialBytes: 0, totalBytes: FR_TOTAL, inFlight: false },
    ),
  );
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
    root!.render(<ModelsSection faLanguages={LANGS} includeWhisper={false} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function esRowText(): string {
  const row = Array.from(container.querySelectorAll('[data-testid^="fa-target-occupied-"], .space-y-2 > div')).find(
    (el) => el.textContent?.includes('Spanish'),
  );
  return row?.textContent ?? '';
}

function frDownloadButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent?.includes('Download') || b.textContent?.includes('Resume')) &&
      b.closest('div[style]')?.textContent?.includes('French'),
  );
}

describe('ModelsSection — one pack downloading does not disturb an installed sibling (WS2 T4.7)', () => {
  it('keeps es rendered Installed, with no Resume/Checking/Unverified, for the entire fr download + completion', async () => {
    let progress: (d: number, t: number) => void = () => {};
    let finish: () => void = () => {};
    mockDownloadFaModel.mockImplementation(
      (lang: string, onProgress: (d: number, t: number) => void) => {
        if (lang !== 'fr') return new Promise<void>(() => {});
        return new Promise<void>((resolve) => {
          progress = onProgress;
          finish = resolve;
        });
      },
    );

    await mount();
    expect(esRowText()).toContain('Installed');
    expect(esRowText()).not.toContain('Resume');
    expect(esRowText()).not.toContain('Checking');
    expect(esRowText()).not.toContain('Unverified');

    await act(async () => {
      frDownloadButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => progress(600_000_000, FR_TOTAL));

    // Mid-transfer: es must be completely unaffected by fr's own progress
    // events and its own `refreshResumable` cycle.
    expect(esRowText()).toContain('Installed');
    expect(esRowText()).not.toContain('Resume');
    expect(esRowText()).not.toContain('Checking');

    // fr completes — this is what fires `subscribeDownloadSettled`, which
    // calls `refresh()`/`refreshResumable()` for EVERY row, es included. The
    // real check_installed_models command can take real time (WS2 T4.6: a
    // missing sidecar makes it hash a ~1.2 GiB file), so `checkInstalledModels`
    // is held PENDING here deliberately — a probe run with an earlier draft
    // of this test proved that resolving it in the same tick as `finish()`
    // hides a real regression: `report` briefly reset to null by a mistaken
    // edit read as "still installed" because React had already settled by the
    // time the DOM was inspected. Holding the promise open is what makes the
    // window observable.
    let resolveCheck: (r: unknown) => void = () => {};
    mockCheckInstalledModels.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    mockFaModelStatus.mockImplementation((lang: string) =>
      Promise.resolve(
        lang === 'es'
          ? { present: true, partialBytes: 0, totalBytes: ES_TOTAL, inFlight: false }
          : { present: true, partialBytes: 0, totalBytes: FR_TOTAL, inFlight: false },
      ),
    );
    await act(async () => {
      finish();
      await Promise.resolve();
      await Promise.resolve();
    });

    // check_installed_models is still pending here — this is the exact window
    // WS2 T4.6's "all six rows flip to Checking" bug lived in. es must stay
    // Installed throughout it, from the STALE report alone.
    expect(esRowText()).toContain('Installed');
    expect(esRowText()).not.toContain('Checking');
    expect(esRowText()).not.toContain('Resume');

    await act(async () => {
      resolveCheck({
        whisper: { installed: false, bytes: 0 },
        fa: {
          es: { installed: true, bytes: ES_TOTAL },
          fr: { installed: true, bytes: FR_TOTAL },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both installed now, neither offering a download affordance.
    expect(esRowText()).toContain('Installed');
    expect(frDownloadButton()).toBeUndefined();
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(buttons.some((t) => t.includes('Resume'))).toBe(false);
  });
});
