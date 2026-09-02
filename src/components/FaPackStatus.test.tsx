// @vitest-environment jsdom
//
// WS2 T4.1 Step 3 — the per-project FA pack detector.
//
// WHAT THIS FILE IS REALLY GUARDING. Not "does a green tick appear" but the
// DECISION TABLE: five distinct conditions that a naive detector collapses into
// two. The two that must never be collapsed:
//
//   • Auto-detect is neither installed nor missing. The project stores no
//     language and the pack it will need is chosen by Whisper on the first
//     transcription, so "missing" would be false (nothing is missing) and
//     "installed" would be false too (nothing was checked).
//   • `featureCompiled: false` is not a missing pack. `fa-inference` is not in
//     `Cargo.toml`'s default features, so a shipped binary returns
//     `not_implemented` for every alignment no matter what is on disk. A
//     detector that offered a 1.2 GiB download there would be promising
//     precision the build cannot deliver — the exact failure this step exists
//     to avoid — so `unbuilt` renders NO install affordance at all.
//
// The probes are mocked because both are Tauri IPC; the decision table is not.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { FaPackStatus, resolveFaPackState, AUTO_DETECT_VALUE } from './FaPackStatus';
import { ProjectSettingsModal } from './ProjectSettingsModal';

const mockProbe = vi.fn();
const mockCheckInstalled = vi.fn();

vi.mock('../services/faPreflight', async () => {
  const actual = await vi.importActual<typeof import('../services/faPreflight')>('../services/faPreflight');
  return { ...actual, probeFaReadiness: (lang: string) => mockProbe(lang) };
});

vi.mock('../services/models', async () => {
  const actual = await vi.importActual<typeof import('../services/models')>('../services/models');
  return {
    ...actual,
    checkInstalledModels: () => mockCheckInstalled(),
    getAvailableDiskSpace: async () => 50 * 1024 ** 3,
    importLocalModel: async () => ({ cancelled: true }),
    deleteInstalledModel: async () => {},
    downloadFaModel: async () => {},
    cancelFaModelDownload: () => {},
  };
});
vi.mock('../services/modelDownload', () => ({
  getWhisperModelStatus: async () => ({ present: false, partialBytes: 0, totalBytes: 1 }),
  downloadWhisperModel: async () => {},
  cancelWhisperModelDownload: () => {},
}));

/** The shape `fa_preflight.rs` actually serializes (serde camelCase). */
function report(over: Partial<{ featureCompiled: boolean; runtimeOk: boolean; modelPresent: boolean }> = {}) {
  return {
    featureCompiled: true,
    runtimeOk: true,
    runtimeDetail: 'onnxruntime loaded from /x/libonnxruntime.dylib',
    modelPresent: true,
    modelDetail: '/x/fa-en',
    language: 'en',
    ...over,
  };
}

function installedReport(langs: Record<string, boolean>) {
  return {
    whisper: { installed: true, bytes: 1 },
    fa: Object.fromEntries(Object.entries(langs).map(([k, v]) => [k, { installed: v, bytes: v ? 1 : 0 }])),
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  vi.clearAllMocks();
  mockProbe.mockResolvedValue(report());
  mockCheckInstalled.mockResolvedValue(installedReport({ en: true, es: false }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(language: string): Promise<HTMLElement> {
  root = createRoot(container);
  await act(async () => { root.render(<FaPackStatus language={language} />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return container.querySelector<HTMLElement>('[data-testid="fa-pack-status"]')!;
}

async function rerender(language: string): Promise<HTMLElement> {
  await act(async () => { root.render(<FaPackStatus language={language} />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return container.querySelector<HTMLElement>('[data-testid="fa-pack-status"]')!;
}

describe('WS2 T4.1 Step 3 — the detector distinguishes five conditions', () => {
  it('INSTALLED: green indicator, no warning, no install affordance', async () => {
    const el = await render('en');
    expect(el.dataset.state).toBe('installed');
    expect(el.textContent).toMatch(/English alignment pack installed/i);
    expect(el.querySelector('[data-testid="fa-pack-install-link"]')).toBeNull();
    // The green is the indicator, and it is the INSTALLED green, not the warn amber.
    expect(el.querySelector('span[style*="rgb(0, 230, 118)"], span[style*="#00E676"]')).not.toBeNull();
  });

  it('MISSING: a warning plus an install affordance', async () => {
    const el = await render('es');
    expect(el.dataset.state).toBe('missing');
    expect(el.textContent).toMatch(/Spanish alignment pack is not installed/i);
    expect(el.textContent).toMatch(/fall back to standard timing/i);
    expect(el.querySelector('[data-testid="fa-pack-install-link"]')).not.toBeNull();
  });

  it('AUTO-DETECT: neither installed nor missing, and nothing is probed at all', async () => {
    const el = await render(AUTO_DETECT_VALUE);
    expect(el.dataset.state).toBe('auto');
    expect(el.textContent).toMatch(/no single pack to check/i);
    expect(el.querySelector('[data-testid="fa-pack-install-link"]')).toBeNull();
    // Not merely "renders differently": the probe is never called, because
    // there is no language to probe FOR. A detector that probed something and
    // then hid the answer would be a different, worse thing.
    expect(mockProbe).not.toHaveBeenCalled();
    expect(mockCheckInstalled).not.toHaveBeenCalled();
  });

  it('UNBUILT (featureCompiled: false): warns, and offers NO download', async () => {
    mockProbe.mockResolvedValue(report({ featureCompiled: false }));
    // The discriminating setup: the pack IS on disk. A detector keyed on pack
    // presence alone would render a confident green here, in a binary where
    // every alignment returns not_implemented.
    mockCheckInstalled.mockResolvedValue(installedReport({ en: true }));
    const el = await render('en');
    expect(el.dataset.state).toBe('unbuilt');
    expect(el.textContent).toMatch(/cannot run high-precision sync at all/i);
    expect(el.textContent).not.toMatch(/install/i);
    expect(el.querySelector('[data-testid="fa-pack-install-link"]')).toBeNull();
    // And it never consulted disk — build failure short-circuits before it.
    expect(mockCheckInstalled).not.toHaveBeenCalled();
  });

  it('UNAVAILABLE (probe returns null): status unknown, stated as unknown', async () => {
    mockProbe.mockResolvedValue(null);
    const el = await render('en');
    expect(el.dataset.state).toBe('unavailable');
    expect(el.textContent).toMatch(/unavailable outside the desktop app/i);
    expect(el.querySelector('[data-testid="fa-pack-install-link"]')).toBeNull();
  });

  it('UNSUPPORTED language: no pack exists, and none is offered', async () => {
    const el = await render('ja');
    expect(el.dataset.state).toBe('unsupported');
    expect(el.textContent).toMatch(/No alignment pack exists/i);
    expect(mockProbe).not.toHaveBeenCalled();
  });
});

describe('WS2 T4.1 Step 3 — it is live on the dropdown, not on Save', () => {
  it('re-probes and changes verdict when the language prop changes', async () => {
    let el = await render('en');
    expect(el.dataset.state).toBe('installed');
    el = await rerender('es');
    expect(el.dataset.state).toBe('missing');
    expect(mockProbe).toHaveBeenCalledTimes(2);
    expect(mockProbe).toHaveBeenLastCalledWith('es');
  });

  it('a stale probe cannot overwrite a newer one', async () => {
    // The dropdown moves faster than IPC. Hold the first probe open, switch
    // language, resolve the OLD one last, and assert the newer verdict stands.
    let resolveSlow!: (v: unknown) => void;
    mockProbe.mockImplementationOnce(() => new Promise((r) => { resolveSlow = r; }));
    root = createRoot(container);
    await act(async () => { root.render(<FaPackStatus language="en" />); });

    mockProbe.mockResolvedValue(report());
    await act(async () => { root.render(<FaPackStatus language="es" />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector<HTMLElement>('[data-testid="fa-pack-status"]')!.dataset.state).toBe('missing');

    await act(async () => { resolveSlow(report()); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector<HTMLElement>('[data-testid="fa-pack-status"]')!.dataset.state).toBe('missing');
  });
});

describe('WS2 T4.1 Step 3 — the install affordance opens ONE pack', () => {
  it('reveals the Models section filtered to exactly one language, with no whisper row', async () => {
    const el = await render('es');
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="fa-pack-install-link"]')!.click();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const installer = container.querySelector<HTMLElement>('[data-testid="fa-pack-installer"]');
    expect(installer, 'the filtered installer did not open').not.toBeNull();
    // It is the SAME component as App Settings' block 2 — same download
    // engine, same progress, same completion refresh — with a shorter list.
    expect(installer!.querySelector('[data-testid="models-section"]')).not.toBeNull();

    // EXACTLY ONE pack is offered.
    const downloads = Array.from(installer!.querySelectorAll('button'))
      .filter((b) => b.textContent?.trim() === 'Download');
    expect(downloads.length).toBe(1);
    expect(installer!.textContent).toContain('Spanish');
    for (const other of ['English', 'French', 'Portuguese', 'German']) {
      expect(installer!.textContent, `filtered surface leaked ${other}`).not.toContain(other);
    }
    // And no transcription-engine row: it is not what the user came for.
    expect(installer!.textContent).not.toMatch(/whisper|transcription engine/i);
  });
});

describe('WS2 T4.1 Step 3 — resolveFaPackState, the decision table without React', () => {
  it('checks the BUILD before disk — order is the order the real run fails in', async () => {
    mockProbe.mockResolvedValue(report({ featureCompiled: false }));
    mockCheckInstalled.mockResolvedValue(installedReport({ en: true }));
    expect(await resolveFaPackState('en')).toEqual({ kind: 'unbuilt' });
    expect(mockCheckInstalled).not.toHaveBeenCalled();
  });

  it('a failing disk check degrades to unavailable, never to "missing"', async () => {
    // A rejected status probe is NOT evidence the pack is absent — that
    // conflation is the WS2 Step 13 Phase 1 defect, in a new place.
    mockCheckInstalled.mockRejectedValue(new Error('IPC down'));
    expect(await resolveFaPackState('en')).toEqual({ kind: 'unavailable' });
  });

  it('auto short-circuits before any probe', async () => {
    expect(await resolveFaPackState(AUTO_DETECT_VALUE)).toEqual({ kind: 'auto' });
    expect(mockProbe).not.toHaveBeenCalled();
  });
});

describe('WS2 T4.1 Step 3 — Project Settings binds the detector to the DRAFT language', () => {
  // ADDED AFTER A DESTRUCTIVE PROBE FOUND NOTHING GUARDING IT. Probe P6
  // rebound the detector from `draftLanguage` to the SAVED `language` — the
  // difference between answering "would this language work?" while the user is
  // deciding and answering it only after they commit — and the whole suite
  // stayed green, because every other test drives `FaPackStatus` directly and
  // therefore cannot see which value the modal hands it. This is the
  // integration assertion that closes that gap.
  it('changing the dropdown re-probes immediately, with no Save', async () => {
    mockCheckInstalled.mockResolvedValue(installedReport({ en: true, es: false }));
    const onLanguageChange = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectSettingsModal
          segments={[]}
          aspectRatio="16:9"
          resolutionTier="1080p"
          onResolutionTierChange={() => {}}
          onSetAllOverlay={() => {}}
          language="en"
          onLanguageChange={onLanguageChange}
          faEnabled={false}
          onFaEnabledChange={() => {}}
          onClose={() => {}}
        />,
      );
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    const detector = (): HTMLElement =>
      container.querySelector<HTMLElement>('[data-testid="fa-pack-status"]')!;
    expect(detector().dataset.state).toBe('installed');

    // The language <select> is the one holding the auto-detect sentinel.
    const select = Array.from(container.querySelectorAll('select'))
      .find((s) => Array.from(s.options).some((o) => o.value === AUTO_DETECT_VALUE));
    expect(select, 'language select not found').toBeTruthy();
    await act(async () => {
      select!.value = 'es';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(detector().dataset.state, 'the detector did not follow the draft').toBe('missing');
    expect(mockProbe).toHaveBeenLastCalledWith('es');
    // And nothing was committed: this happened before any Save.
    expect(onLanguageChange).not.toHaveBeenCalled();
  });
});
