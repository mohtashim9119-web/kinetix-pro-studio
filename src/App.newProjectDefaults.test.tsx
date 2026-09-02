// @vitest-environment jsdom
//
// WS2 T4.1 Step 2 — New Project Defaults, asserted on the PROJECT THAT GETS
// SAVED rather than on what the modal rendered.
//
// WHY THE SAVED PROJECT IS THE ASSERTION TARGET. Every claim here is about
// what ends up persisted: that Auto-detect stores no `language` key at all,
// that an untouched FA toggle stores no `faHighPrecisionSync` key at all, and
// that an explicit choice does store one. A test that read the dropdown's
// value would pass against a build that renders the right thing and writes the
// wrong one — which is precisely the failure mode, since the defect being
// locked out is a WRITE that should not have happened.
//
// The seeds-only contract is the other half: an App Settings default is read
// once, when the modal opens, and never reaches a project that already exists.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Project } from './types';
import { writeNewProjectDefaults, SHIPPED_NEW_PROJECT_DEFAULTS } from './services/appDefaults';
import { FA_PROJECT_DEFAULT_ON, __resetFaCapabilityForTests } from './services/faGate';

// FA capability is `isTauri()` (faGate.ts), which is false under jsdom — so the
// FA toggle renders DISABLED by default and a click on it does nothing. That is
// correct behaviour, and it is also not what most of this file is about, so the
// bridge is faked per-test through this flag. `__resetFaCapabilityForTests`
// clears faGate's memo between tests; without it the first test's answer would
// be the only one any test ever sees.
let fakeTauri = true;
vi.mock('./services/tauriFfmpeg', async () => {
  const actual = await vi.importActual<typeof import('./services/tauriFfmpeg')>('./services/tauriFfmpeg');
  return { ...actual, isTauri: () => fakeTauri };
});

const mockLoadAllMetas = vi.fn();
const mockLoadProjectDetailed = vi.fn();
const mockGetAllAssetsForProject = vi.fn();
const mockSaveProject = vi.fn();
const mockGetLastOpenedProjectId = vi.fn<() => string | null>();

vi.mock('./services/projectStore', async () => {
  const actual = await vi.importActual<typeof import('./services/projectStore')>('./services/projectStore');
  return {
    ...actual,
    loadAllMetas: () => mockLoadAllMetas(),
    loadProjectDetailed: (id: string) => mockLoadProjectDetailed(id),
    saveProject: (...a: unknown[]) => mockSaveProject(...a),
    upsertProjectMeta: vi.fn(),
    setLastOpenedProjectId: vi.fn(),
    clearLastOpenedProjectId: vi.fn(),
    getLastOpenedProjectId: () => mockGetLastOpenedProjectId(),
    migrateLegacyIfNeeded: async () => null,
    migrateLocalStorageProjectsToOsStore: async () => ({ migrated: [], failed: [] }),
    adoptMirroredProjects: async () => ({ adopted: [], skipped: [], failed: [] }),
  };
});

vi.mock('./services/assetStore', async () => {
  const actual = await vi.importActual<typeof import('./services/assetStore')>('./services/assetStore');
  return { ...actual, getAllAssetsForProject: (id: string) => mockGetAllAssetsForProject(id), getLegacyAssets: async () => [] };
});

vi.mock('./services/historyPersist', async () => {
  const actual = await vi.importActual<typeof import('./services/historyPersist')>('./services/historyPersist');
  return { ...actual, loadHistory: async () => null, clearPersistedHistory: async () => {}, saveHistory: async () => {} };
});

const { default: App } = await import('./App');

let container: HTMLDivElement;
let root: Root;

async function mountApp(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await act(async () => { await Promise.resolve(); });
}

async function openNewProject(): Promise<HTMLElement> {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'New Project');
  expect(btn, 'New Project button not found on the dashboard').toBeDefined();
  await act(async () => { btn!.click(); });
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="New Project"]');
  expect(dialog, 'New Project modal did not open').not.toBeNull();
  return dialog!;
}

function field(dialog: HTMLElement, id: string): HTMLSelectElement {
  const el = dialog.querySelector<HTMLSelectElement>(`#${id}`);
  expect(el, `field #${id} not found`).not.toBeNull();
  return el!;
}

async function setSelect(el: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function create(dialog: HTMLElement): Promise<Project> {
  const btn = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Create');
  await act(async () => { btn!.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(mockSaveProject, 'the new project was never saved').toHaveBeenCalled();
  return mockSaveProject.mock.calls[0]![0] as Project;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fakeTauri = true;
  __resetFaCapabilityForTests();
  mockLoadAllMetas.mockReturnValue([]);
  mockSaveProject.mockResolvedValue({ ok: true });
  mockGetLastOpenedProjectId.mockReturnValue(null);
  mockGetAllAssetsForProject.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('WS2 T4.1 Step 2 — the modal pre-fills from New Project Defaults', () => {
  it('a fresh install pre-fills the shipped defaults', async () => {
    await mountApp();
    const dialog = await openNewProject();
    expect(field(dialog, 'new-project-resolution').value).toBe(SHIPPED_NEW_PROJECT_DEFAULTS.resolutionTier);
    expect(field(dialog, 'new-project-language').value).toBe(SHIPPED_NEW_PROJECT_DEFAULTS.language);
    const fa = dialog.querySelector('[data-testid="new-project-fa-toggle"]');
    expect(fa!.getAttribute('aria-pressed')).toBe(String(SHIPPED_NEW_PROJECT_DEFAULTS.faHighPrecisionSync));
    const selectedRatio = dialog.querySelector('[role="radio"][aria-checked="true"]');
    expect(selectedRatio!.textContent!.trim()).toBe(SHIPPED_NEW_PROJECT_DEFAULTS.aspectRatio);
  });

  it('stored defaults pre-fill every one of the four modal fields', async () => {
    writeNewProjectDefaults({
      aspectRatio: '9:16',
      resolutionTier: '720p',
      language: 'es',
      faHighPrecisionSync: !FA_PROJECT_DEFAULT_ON,
      textOverlay: true,
    });
    await mountApp();
    const dialog = await openNewProject();
    expect(field(dialog, 'new-project-resolution').value).toBe('720p');
    expect(field(dialog, 'new-project-language').value).toBe('es');
    expect(dialog.querySelector('[data-testid="new-project-fa-toggle"]')!.getAttribute('aria-pressed'))
      .toBe(String(!FA_PROJECT_DEFAULT_ON));
    expect(dialog.querySelector('[role="radio"][aria-checked="true"]')!.textContent!.trim()).toBe('9:16');
  });

  it('the language dropdown offers Auto-detect plus exactly the five supported codes', async () => {
    await mountApp();
    const dialog = await openNewProject();
    const values = Array.from(field(dialog, 'new-project-language').options).map((o) => o.value);
    expect(values).toEqual(['auto', 'en', 'es', 'fr', 'pt', 'de']);
  });
});

describe('WS2 T4.1 Step 2 — what actually gets written to the saved project', () => {
  it('Auto-detect writes NO language key at all', async () => {
    await mountApp();
    const saved = await create(await openNewProject());
    // Not `toBeUndefined()`: the key must be ABSENT, because a present
    // `language: undefined` survives a JSON round-trip as nothing but reads as
    // a decision to anyone inspecting the object.
    expect(Object.prototype.hasOwnProperty.call(saved, 'language')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(saved, 'detectedLanguage')).toBe(false);
  });

  it('an explicit language choice DOES write the code', async () => {
    await mountApp();
    const dialog = await openNewProject();
    await setSelect(field(dialog, 'new-project-language'), 'es');
    const saved = await create(dialog);
    expect(saved.language).toBe('es');
  });

  it('choosing a language and going back to Auto-detect writes nothing', async () => {
    await mountApp();
    const dialog = await openNewProject();
    await setSelect(field(dialog, 'new-project-language'), 'fr');
    await setSelect(field(dialog, 'new-project-language'), 'auto');
    const saved = await create(dialog);
    expect(Object.prototype.hasOwnProperty.call(saved, 'language')).toBe(false);
  });

  it('an untouched FA toggle writes NO faHighPrecisionSync key — no preference stays no preference', async () => {
    await mountApp();
    const saved = await create(await openNewProject());
    expect(Object.prototype.hasOwnProperty.call(saved, 'faHighPrecisionSync')).toBe(false);
  });

  it('moving the FA toggle away from the read-time default DOES write it', async () => {
    await mountApp();
    const dialog = await openNewProject();
    const toggle = dialog.querySelector<HTMLButtonElement>('[data-testid="new-project-fa-toggle"]')!;
    await act(async () => { toggle.click(); });
    const saved = await create(dialog);
    expect(saved.faHighPrecisionSync).toBe(!FA_PROJECT_DEFAULT_ON);
  });

  it('an App Settings FA default equal to the read-time default still writes nothing', async () => {
    // The discriminating case for "seeing a control is not choosing". The
    // stored default agrees with FA_PROJECT_DEFAULT_ON, the user leaves it
    // alone, and the project must remain reachable by a future default flip.
    writeNewProjectDefaults({ ...SHIPPED_NEW_PROJECT_DEFAULTS, faHighPrecisionSync: FA_PROJECT_DEFAULT_ON });
    await mountApp();
    const saved = await create(await openNewProject());
    expect(Object.prototype.hasOwnProperty.call(saved, 'faHighPrecisionSync')).toBe(false);
  });

  it('aspect ratio and resolution are always written — they have no absent-means-default semantics', async () => {
    writeNewProjectDefaults({ ...SHIPPED_NEW_PROJECT_DEFAULTS, aspectRatio: '1:1', resolutionTier: '720p' });
    await mountApp();
    const saved = await create(await openNewProject());
    expect(saved.aspectRatio).toBe('1:1');
    expect(saved.resolutionTier).toBe('720p');
  });

  it('a text-overlay default of true is stored on the project, not left in the global', async () => {
    writeNewProjectDefaults({ ...SHIPPED_NEW_PROJECT_DEFAULTS, textOverlay: true });
    await mountApp();
    const saved = await create(await openNewProject());
    expect(saved.defaultTextOverlay).toBe(true);
  });

  it('a text-overlay default of false writes nothing — the built-in fallback already is false', async () => {
    await mountApp();
    const saved = await create(await openNewProject());
    expect(Object.prototype.hasOwnProperty.call(saved, 'defaultTextOverlay')).toBe(false);
  });
});

describe('WS2 T4.1 Step 2 — the FA toggle respects runtime capability', () => {
  it('is disabled outside the desktop runtime, and a click on it cannot write', async () => {
    // Not decoration: `isFaCapable()` is `isTauri()`, so in a plain browser the
    // control must not be able to promise alignment that cannot run. A stored
    // App Settings default of ON must still not reach the project from here.
    fakeTauri = false;
    __resetFaCapabilityForTests();
    writeNewProjectDefaults({ ...SHIPPED_NEW_PROJECT_DEFAULTS, faHighPrecisionSync: !FA_PROJECT_DEFAULT_ON });
    await mountApp();
    const dialog = await openNewProject();
    const toggle = dialog.querySelector<HTMLButtonElement>('[data-testid="new-project-fa-toggle"]')!;
    expect(toggle.disabled).toBe(true);
    await act(async () => { toggle.click(); });
    // The seeded value is still what it was — the click was inert.
    expect(toggle.getAttribute('aria-pressed')).toBe(String(!FA_PROJECT_DEFAULT_ON));
    expect(dialog.textContent).toMatch(/not available outside the desktop app/i);
  });
});
