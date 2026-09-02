// @vitest-environment jsdom
//
// WS2 T4.1 Step 2 — Save/Cancel semantics, stated once for both settings
// surfaces.
//
// THIS FILE IS A REFACTOR'S PROOF, NOT A DEFECT'S. The Step 0 sweep asked
// whether Export Engine, the FA toggle or the language dropdown wrote on
// INTERACTION rather than on Save — which would mean Cancel was lying. Read
// against source, all three already held draft state and wrote only inside
// their `handleSave`. So nothing in this file fixes a bug; it pins a property
// that was true and had nothing asserting it, which is why the ONE genuine
// defect in this family (the overlay cascade, D4) could sit next to them
// unnoticed and shipped in its own commit (da2d255).
//
// The property, stated as one rule for every control on both surfaces: a
// control's value reaches storage ONLY through that surface's Save button.
// Interacting with it writes nothing. Cancel and Escape write nothing.
//
// THE ONE EXEMPTION, by owner ruling: model install and delete in App
// Settings' block 2 are immediate filesystem side effects. A 1.2 GiB download
// cannot be "pending until Save" and must not look as though it is. That
// exemption is asserted in `App.appSettings.test.tsx` (block 2 states it in
// its own copy); nothing here covers it, deliberately.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { AppSettingsModal } from './AppSettingsModal';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { isWebCodecsExportToggleOn } from '../hooks/useExport';
import { readNewProjectDefaults, writeNewProjectDefaults, SHIPPED_NEW_PROJECT_DEFAULTS } from '../services/appDefaults';
import { AnimationType, TransitionType, type ResolutionTier, type VideoSegment } from '../types';

vi.mock('../services/models', async () => {
  const actual = await vi.importActual<typeof import('../services/models')>('../services/models');
  return {
    ...actual,
    checkInstalledModels: async () => ({ whisper: { installed: false, bytes: 0 }, fa: {} }),
    getAvailableDiskSpace: async () => 50 * 1024 ** 3,
    importLocalModel: async () => ({ cancelled: true }),
    deleteInstalledModel: async () => {},
    downloadFaModel: async () => {},
    cancelFaModelDownload: () => {},
  };
});
// Both toggles are capability-gated and both probes are false under jsdom
// (`VideoEncoder` is absent; `isTauri()` is false), so without these the
// controls render DISABLED and every click in this file would be inert — the
// tests would pass for the wrong reason. Only the PROBES are faked; the real
// read/write functions are what the assertions run against.
vi.mock('../hooks/useExport', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useExport')>('../hooks/useExport');
  return { ...actual, isWebCodecsExportCapable: () => true };
});
vi.mock('../services/tauriFfmpeg', async () => {
  const actual = await vi.importActual<typeof import('../services/tauriFfmpeg')>('../services/tauriFfmpeg');
  return { ...actual, isTauri: () => true };
});

vi.mock('../services/modelDownload', () => ({
  getWhisperModelStatus: async () => ({ present: false, partialBytes: 0, totalBytes: 1 }),
  downloadWhisperModel: async () => {},
  cancelWhisperModelDownload: () => {},
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  localStorage.clear();
  vi.clearAllMocks();
  // Both capability results are memoized; clear them so the faked probes above
  // are what each test actually observes.
  const { __resetWebCodecsExportCapabilityForTests } = await import('../hooks/useExport');
  const { __resetFaCapabilityForTests } = await import('../services/faGate');
  __resetWebCodecsExportCapabilityForTests();
  __resetFaCapabilityForTests();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function click(label: string): Promise<void> {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  expect(btn, `no button labelled "${label}"`).toBeTruthy();
  return act(async () => { btn!.click(); });
}

function press(key: string): Promise<void> {
  return act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
}

// ── App Settings ───────────────────────────────────────────────────────────

async function renderAppSettings(): Promise<void> {
  root = createRoot(container);
  await act(async () => { root.render(<AppSettingsModal onClose={() => {}} />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function toggleWebcodecs(): Promise<void> {
  const t = container.querySelector<HTMLButtonElement>('[data-testid="app-settings-webcodecs-toggle"]')!;
  await act(async () => { t.click(); });
}

async function setDefaultLanguage(value: string): Promise<void> {
  const sel = container.querySelector<HTMLSelectElement>('#app-default-language')!;
  await act(async () => {
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('WS2 T4.1 — App Settings writes only on Save', () => {
  it('toggling the renderer writes nothing until Save', async () => {
    const before = isWebCodecsExportToggleOn();
    await renderAppSettings();
    await toggleWebcodecs();
    expect(isWebCodecsExportToggleOn(), 'the toggle wrote on interaction').toBe(before);
    await click('Save');
    expect(isWebCodecsExportToggleOn()).toBe(!before);
  });

  it('Cancel discards a renderer change', async () => {
    const before = isWebCodecsExportToggleOn();
    await renderAppSettings();
    await toggleWebcodecs();
    await click('Cancel');
    expect(isWebCodecsExportToggleOn()).toBe(before);
  });

  it('Escape discards a renderer change', async () => {
    const before = isWebCodecsExportToggleOn();
    await renderAppSettings();
    await toggleWebcodecs();
    await press('Escape');
    expect(isWebCodecsExportToggleOn()).toBe(before);
  });

  it('a New Project Defaults change writes nothing until Save', async () => {
    await renderAppSettings();
    await setDefaultLanguage('de');
    expect(readNewProjectDefaults().language, 'the dropdown wrote on interaction').toBe(
      SHIPPED_NEW_PROJECT_DEFAULTS.language,
    );
    await click('Save');
    expect(readNewProjectDefaults().language).toBe('de');
  });

  it('Cancel discards a New Project Defaults change', async () => {
    writeNewProjectDefaults({ ...SHIPPED_NEW_PROJECT_DEFAULTS, language: 'fr' });
    await renderAppSettings();
    await setDefaultLanguage('de');
    await click('Cancel');
    expect(readNewProjectDefaults().language).toBe('fr');
  });

  it('Save commits both blocks together, in one gesture', async () => {
    const beforeWc = isWebCodecsExportToggleOn();
    await renderAppSettings();
    await toggleWebcodecs();
    await setDefaultLanguage('pt');
    await click('Save');
    expect(isWebCodecsExportToggleOn()).toBe(!beforeWc);
    expect(readNewProjectDefaults().language).toBe('pt');
  });
});

// ── Project Settings ───────────────────────────────────────────────────────

function seg(id: string, showOverlay: boolean): VideoSegment {
  return {
    id, text: id, startTime: 0, duration: 1,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0, showOverlay,
  };
}

interface Writes {
  tier: ReturnType<typeof vi.fn<(v: ResolutionTier) => void>>;
  fa: ReturnType<typeof vi.fn<(v: boolean) => void>>;
  language: ReturnType<typeof vi.fn<(v: string | undefined) => void>>;
  overlay: ReturnType<typeof vi.fn<(v: boolean) => void>>;
}

async function renderProjectSettings(): Promise<Writes> {
  const writes: Writes = {
    tier: vi.fn<(v: ResolutionTier) => void>(),
    fa: vi.fn<(v: boolean) => void>(),
    language: vi.fn<(v: string | undefined) => void>(),
    overlay: vi.fn<(v: boolean) => void>(),
  };
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ProjectSettingsModal
        segments={[seg('a', true), seg('b', true)]}
        aspectRatio="16:9"
        resolutionTier="1080p"
        onResolutionTierChange={writes.tier}
        onSetAllOverlay={writes.overlay}
        language={undefined}
        onLanguageChange={writes.language}
        faEnabled={false}
        onFaEnabledChange={writes.fa}
        onClose={() => {}}
      />,
    );
  });
  return writes;
}

function noneWritten(w: Writes): void {
  expect(w.tier).not.toHaveBeenCalled();
  expect(w.fa).not.toHaveBeenCalled();
  expect(w.language).not.toHaveBeenCalled();
  expect(w.overlay).not.toHaveBeenCalled();
}

async function editEverything(): Promise<void> {
  const selects = container.querySelectorAll<HTMLSelectElement>('select');
  await act(async () => {
    selects[0]!.value = '720p';
    selects[0]!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    selects[1]!.value = 'es';
    selects[1]!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  for (const label of ['Enable High-Precision Auto-Sync', 'Hide overlay text on all segments']) {
    const btn = Array.from(container.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === label);
    expect(btn, `control not found: ${label}`).toBeTruthy();
    await act(async () => { btn!.click(); });
  }
}

describe('WS2 T4.1 — Project Settings writes only on Save', () => {
  it('editing every control writes nothing until Save', async () => {
    const w = await renderProjectSettings();
    await editEverything();
    noneWritten(w);
    await click('Save');
    expect(w.tier).toHaveBeenCalledWith('720p');
    expect(w.language).toHaveBeenCalledWith('es');
    expect(w.fa).toHaveBeenCalledWith(true);
    expect(w.overlay).toHaveBeenCalledWith(false);
  });

  it('Cancel discards every control', async () => {
    const w = await renderProjectSettings();
    await editEverything();
    await click('Cancel');
    noneWritten(w);
  });

  it('Escape discards every control', async () => {
    const w = await renderProjectSettings();
    await editEverything();
    await press('Escape');
    noneWritten(w);
  });

  it('Save on an untouched modal writes only the fields with no absent-means-default semantics', async () => {
    // Resolution tier is written unconditionally because there is nothing an
    // absent value could mean. FA, language and the overlay cascade all carry
    // "the user expressed no preference" as a distinct state, so an untouched
    // Save must leave all three alone — the D4 lesson, generalised.
    const w = await renderProjectSettings();
    await click('Save');
    expect(w.tier).toHaveBeenCalledWith('1080p');
    expect(w.fa).not.toHaveBeenCalled();
    expect(w.overlay).not.toHaveBeenCalled();
  });
});
