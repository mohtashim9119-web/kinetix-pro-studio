// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// G3 tail Step 0 — Settings' whisper row must show one of three HONEST
// states: installed+verified, found-but-unverified (with a real explanation
// and a real way forward), or not-found (Download wired to the existing
// download flow).
//
// OLD BUG (operator click-through, G3 tail brief): after G3 Unit 2 widened
// `whisper_model_status`'s `present` flag to match every fallback location
// `whisper.rs::model_path` accepts, a model found ONLY via a fallback (not
// the managed download slot) rendered "Unverified" with NO explanation and
// NO way forward — `occupiesTarget` hid both Download and Import, and Delete
// (the only button left) targets the managed slot alone, so it could not
// touch a file living at a fallback location. The row was stuck.
//
// The real fix is on the Rust side (`models.rs::whisper_installed_status`,
// mirroring D22's `fa_installed_status`, plus reverting the `present`
// widening in `model_download.rs::whisper_model_status`) — this file tests
// the frontend CONTRACT `ModelsSection` must uphold once that data is
// correct: three distinguishable, always-actionable states.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ModelsSection } from './ModelsSection';
import { __resetDownloadStoreForTests } from '../services/modelDownloadStore';

const mockCheckInstalledModels = vi.fn();
const mockGetAvailableDiskSpace = vi.fn();
const mockFaModelStatus = vi.fn();
const mockGetWhisperModelStatus = vi.fn();

vi.mock('../services/models', async () => {
  const actual = await vi.importActual<typeof import('../services/models')>('../services/models');
  return {
    ...actual,
    checkInstalledModels: (...a: unknown[]) => mockCheckInstalledModels(...a),
    importLocalModel: vi.fn(),
    deleteInstalledModel: vi.fn(),
    getAvailableDiskSpace: (...a: unknown[]) => mockGetAvailableDiskSpace(...a),
    faModelStatus: (...a: unknown[]) => mockFaModelStatus(...a),
  };
});

vi.mock('../services/modelDownload', () => ({
  getWhisperModelStatus: (...a: unknown[]) => mockGetWhisperModelStatus(...a),
  downloadWhisperModel: vi.fn(),
  attachWhisperModelDownload: vi.fn(),
  cancelWhisperModelDownload: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root | null = null;

function reportWith(whisperInstalled: boolean) {
  return { whisper: { installed: whisperInstalled, bytes: whisperInstalled ? 1_624_555_275 : 0 }, fa: {} };
}

beforeEach(() => {
  __resetDownloadStoreForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  mockGetAvailableDiskSpace.mockResolvedValue(50 * 1024 ** 3);
  mockFaModelStatus.mockResolvedValue({ present: false, partialBytes: 0, totalBytes: 0, inFlight: false });
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
    root!.render(<ModelsSection faLanguages={[]} includeWhisper />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function whisperRow(): HTMLElement {
  return container.querySelector('[data-testid="models-section"] section') as HTMLElement;
}

function actionButtonLabels(): string[] {
  return Array.from(whisperRow().querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

describe('Settings whisper row — three honest status states (G3 tail Step 0)', () => {
  it('not found: no report row, present=false — Download and Import are offered, no badge', async () => {
    mockCheckInstalledModels.mockResolvedValue(reportWith(false));
    mockGetWhisperModelStatus.mockResolvedValue({ present: false, partialBytes: 0, totalBytes: 0, inFlight: false });
    await mount();

    const row = whisperRow();
    expect(row.querySelector('[data-testid="whisper-target-occupied"]')).toBeNull();
    const labels = actionButtonLabels();
    expect(labels.some((l) => l.includes('Download'))).toBe(true);
    expect(labels.some((l) => l.includes('Import'))).toBe(true);
  });

  it('installed and verified: Ready badge, Delete only, no stray "Unverified" explainer', async () => {
    mockCheckInstalledModels.mockResolvedValue(reportWith(true));
    mockGetWhisperModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: 0, inFlight: false });
    await mount();

    const row = whisperRow();
    expect(row.textContent).toContain('Ready');
    expect(row.querySelector('[data-testid="whisper-unverified-explainer"]')).toBeNull();
    const labels = actionButtonLabels();
    expect(labels.some((l) => l.includes('Download'))).toBe(false);
    expect(labels.some((l) => l.includes('Import'))).toBe(false);
  });

  it(
    'found but unverified (OLD BUG regression): a file sits at the managed target but is not ' +
      'yet confirmed installed — the row must show "Unverified" WITH a real explanation, not a ' +
      'silent dead end. Before the fix this state offered nothing but a Delete that could not ' +
      'reach a fallback-location file; this fixture is the managed-target case, where Delete IS ' +
      'the correct remedy and the explainer says so.',
    async () => {
      mockCheckInstalledModels.mockResolvedValue(reportWith(false));
      mockGetWhisperModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: 0, inFlight: false });
      await mount();

      const row = whisperRow();
      expect(row.querySelector('[data-testid="whisper-target-occupied"]')?.textContent).toBe('Unverified');
      // OLD BUG: this explainer did not exist — the row gave no reason and
      // no path forward beyond a Delete button with no context.
      const explainer = row.querySelector('[data-testid="whisper-unverified-explainer"]');
      expect(explainer, 'unverified state must explain itself, not just show a badge').not.toBeNull();
      expect(explainer!.textContent).toMatch(/didn't match|delete/i);
      // A real way forward must exist — Delete is offered (it targets the
      // same managed slot this fixture's file occupies, so it genuinely
      // works), even though Download itself stays withheld until then.
      const labels = actionButtonLabels();
      expect(labels.some((l) => l.includes('Download'))).toBe(false);
      expect(row.querySelector('[aria-label="Delete whisper model"]')).not.toBeNull();
    },
  );

  it('checking: neither badge nor explainer renders before the authoritative report resolves', async () => {
    mockCheckInstalledModels.mockReturnValue(new Promise(() => {})); // never resolves
    mockGetWhisperModelStatus.mockResolvedValue({ present: true, partialBytes: 0, totalBytes: 0, inFlight: false });
    await mount();

    const row = whisperRow();
    expect(row.querySelector('[data-testid="whisper-target-occupied"]')?.textContent).toBe('Checking…');
    expect(row.querySelector('[data-testid="whisper-unverified-explainer"]')).toBeNull();
  });
});
