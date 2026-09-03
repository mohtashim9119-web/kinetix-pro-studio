// @vitest-environment jsdom
//
// WS2 T4.1 Step 1 — the App Settings surface, asserted through App rather than
// against the component in isolation.
//
// WHY THROUGH APP. Three of the four claims this file makes are claims about
// WIRING, not about rendering: that the gear reaches App Settings with NO
// PROJECT LOADED, that the modal is mounted outside the editor branch (so it
// can render over the dashboard at all), and that Project Settings exposes no
// models entry point. A component-level test of `AppSettingsModal` would pass
// against a build where the modal is unreachable, which is exactly the defect
// the hoist exists to prevent.
//
// Same jsdom + react-dom/client + act pattern and the same mock set as
// `App.projectSwitch.test.tsx` (no @testing-library in this repo).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Project, ProjectMeta } from './types';

function meta(id: string, name: string): ProjectMeta {
  return { id, name, savedAt: Date.now(), segmentCount: 0 };
}

function storedProject(id: string, name: string): Project {
  return {
    id, name, script: '', segments: [], assets: [], headings: [], confirmed: true,
  } as unknown as Project;
}

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

// The models backend is Tauri IPC; stub it so the inline section renders its
// "nothing installed" state rather than rejecting.
vi.mock('./services/models', async () => {
  const actual = await vi.importActual<typeof import('./services/models')>('./services/models');
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

vi.mock('./services/modelDownload', () => ({
  getWhisperModelStatus: async () => ({ present: false, partialBytes: 0, totalBytes: 1_624_555_275 }),
  downloadWhisperModel: async () => {},
  cancelWhisperModelDownload: () => {},
}));

const { default: App } = await import('./App');

const TARGET_ID = 'target-project-id';

let container: HTMLDivElement;
let root: Root;

async function mountApp(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await act(async () => { await Promise.resolve(); });
}

async function openAppSettings(): Promise<HTMLElement> {
  const gear = container.querySelector<HTMLButtonElement>('[data-testid="dashboard-open-app-settings"]');
  expect(gear, 'dashboard gear not found').not.toBeNull();
  await act(async () => { gear!.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const modal = document.querySelector<HTMLElement>('[data-testid="app-settings-modal"]');
  expect(modal, 'App Settings did not open').not.toBeNull();
  return modal!;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockLoadAllMetas.mockReturnValue([]);
  mockSaveProject.mockResolvedValue({ ok: true });
  mockGetLastOpenedProjectId.mockReturnValue(null);
  mockGetAllAssetsForProject.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('WS2 T4.1 Step 1 — App Settings opens from the dashboard with no project', () => {
  it('the gear is present on an EMPTY dashboard (no projects at all)', async () => {
    await mountApp();
    // The fresh-install case: this is the machine state in which a user most
    // needs App Settings (download a model before any project exists), and the
    // one an editor-only entry point could never serve.
    expect(container.querySelector('[data-testid="project-grid"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="editor-root"]')).toBeNull();
    expect(container.querySelector('[data-testid="dashboard-open-app-settings"]')).not.toBeNull();
  });

  it('clicking it opens App Settings over the dashboard, with the dashboard still mounted', async () => {
    await mountApp();
    await openAppSettings();
    // Mounted OUTSIDE the editor branch: the dashboard is still the view
    // underneath, and no editor was conjured to host the modal.
    expect(container.querySelector('[data-testid="project-grid"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="editor-root"]')).toBeNull();
  });

  it('Escape and Cancel both close it', async () => {
    await mountApp();
    await openAppSettings();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[data-testid="app-settings-modal"]')).toBeNull();

    const modal = await openAppSettings();
    const cancel = Array.from(modal.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel');
    await act(async () => { cancel!.click(); });
    expect(document.querySelector('[data-testid="app-settings-modal"]')).toBeNull();
  });
});

describe('WS2 T4.1 Step 1 — all three blocks render on one flat surface', () => {
  it('renders Export Engine, Models & Add-ons and New Project Defaults', async () => {
    await mountApp();
    const modal = await openAppSettings();
    expect(modal.querySelector('[data-testid="app-settings-block-rendering"]')).not.toBeNull();
    expect(modal.querySelector('[data-testid="app-settings-block-models"]')).not.toBeNull();
    expect(modal.querySelector('[data-testid="app-settings-block-new-project-defaults"]')).not.toBeNull();
  });

  it('block 2 is the models section INLINE — no nested dialog is raised', async () => {
    await mountApp();
    const modal = await openAppSettings();
    const models = modal.querySelector('[data-testid="app-settings-block-models"]');
    // The extracted section is a DESCENDANT of block 2, not a sibling dialog.
    expect(models!.querySelector('[data-testid="models-section"]')).not.toBeNull();
    // Exactly one dialog on screen. A nested ManageModelsModal would make two.
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(document.querySelector('[aria-label="Manage Models & Add-ons"]')).toBeNull();
  });

  it('block 2 lists the whisper engine and all five FA packs', async () => {
    await mountApp();
    const modal = await openAppSettings();
    const models = modal.querySelector('[data-testid="app-settings-block-models"]')!;
    const text = models.textContent ?? '';
    expect(text).toContain('Whisper');
    for (const label of ['English', 'Spanish', 'French', 'Portuguese', 'German']) {
      expect(text, `FA pack row missing: ${label}`).toContain(label);
    }
    // Five download buttons, one per pack (nothing is installed in this mock).
    const faDownloads = Array.from(models.querySelectorAll('button'))
      .filter((b) => b.textContent?.trim() === 'Download');
    expect(faDownloads.length).toBe(6); // 5 packs + whisper
  });

  it('block 2 states its actions are immediate, not held until Save', async () => {
    // The owner ruling made install/delete exempt from draft semantics; the
    // requirement attached to that exemption is that the block must not LOOK
    // pending. This pins the copy that discharges it.
    await mountApp();
    const modal = await openAppSettings();
    const models = modal.querySelector('[data-testid="app-settings-block-models"]')!;
    expect(models.textContent).toMatch(/take effect immediately/i);
  });

  it('the three blocks are separated by hairlines, not nested in cards', async () => {
    await mountApp();
    const modal = await openAppSettings();
    const blocks = ['rendering', 'models', 'new-project-defaults'].map((n) => {
      const el = modal.querySelector(`[data-testid="app-settings-block-${n}"]`);
      expect(el, `block missing: ${n}`).not.toBeNull();
      return el as HTMLElement;
    });
    // All three are siblings of one another — one flat scrolling surface.
    const parents = new Set(blocks.map((b) => b.parentElement));
    expect(parents.size).toBe(1);
    // Blocks 2 and 3 carry the divider; block 1 leads and does not.
    const [rendering, models, defaults] = blocks as [HTMLElement, HTMLElement, HTMLElement];
    expect(models.className).toContain('border-t');
    expect(defaults.className).toContain('border-t');
    expect(rendering.className).not.toContain('border-t');
  });
});

describe('WS2 T4.1 Step 1 — Project Settings exposes no models entry point', () => {
  async function openProjectSettings(): Promise<HTMLElement> {
    // Restored via `getLastOpenedProjectId`, the same route
    // `App.projectSwitch.test.tsx`'s `openEditorOnTarget` uses — the load
    // result is a `{ ok, project, savedAt }` envelope, not a bare Project.
    mockLoadAllMetas.mockReturnValue([meta(TARGET_ID, 'Target')]);
    mockGetLastOpenedProjectId.mockReturnValue(TARGET_ID);
    mockLoadProjectDetailed.mockResolvedValue({
      ok: true,
      project: storedProject(TARGET_ID, 'Target'),
      savedAt: Date.now(),
    });
    await mountApp();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="editor-root"]'), 'editor did not open').not.toBeNull();
    const openBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Project Settings');
    expect(openBtn, 'Project Settings button not found in the editor').not.toBeNull();
    await act(async () => { openBtn!.click(); });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Project Settings"]');
    expect(dialog, 'Project Settings did not open').not.toBeNull();
    return dialog!;
  }

  it('has no App Settings deep link', async () => {
    const dialog = await openProjectSettings();
    expect(dialog.querySelector('[data-testid="project-settings-open-app-settings"]')).toBeNull();
    expect(dialog.textContent).not.toMatch(/app settings/i);
  });

  it('has no models MANAGEMENT — no section, no list, no whisper engine, no dialog', async () => {
    // NARROWED in Step 3, deliberately and with the reason recorded. Step 1
    // asserted the absence of the words "models/add-ons/download" anywhere in
    // this dialog. Step 3 then added, by instruction, a targeted single-pack
    // affordance for the selected language — so the guarded property is not
    // "the word models never appears" but "no general models MANAGEMENT
    // surface is reachable from here". A word blocklist would have had to be
    // relaxed on any copy change; this asserts the structures instead.
    const dialog = await openProjectSettings();
    expect(dialog.querySelector('[data-testid="models-section"]')).toBeNull();
    expect(dialog.textContent).not.toMatch(/whisper|transcription engine|manage models/i);
    // And opening it raised no models dialog anywhere on the page.
    expect(document.querySelector('[aria-label="Manage Models & Add-ons"]')).toBeNull();
  });
});
