// @vitest-environment jsdom
//
// WS2 T4.1 Step 2b — view-flip regression coverage for the dashboard/editor
// transition.
//
// The defect this locks out: `showDashboard` was flipped when an async
// operation STARTED (or when its load promise RESOLVED), not when the project
// state actually changed. Both variants render the editor over the OUTGOING
// project for the duration of the remaining awaits.
//
// The discriminating assertion is therefore taken at each await BOUNDARY, not
// after the whole switch settles: a test that only checks the end state passes
// against both the fixed and the broken code. Same jsdom + react-dom/client +
// act pattern as ManageModelsModal.test.tsx (no @testing-library in this repo).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Project, ProjectMeta } from './types';

// ---------------------------------------------------------------------------
// Deferred promises — the whole point of this file. Each await inside
// handleSwitchProject is held open so the DOM can be inspected mid-flight.
// ---------------------------------------------------------------------------
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const OUTGOING_ID = 'outgoing-project-id';
const TARGET_ID = 'target-project-id';

function meta(id: string, name: string): ProjectMeta {
  return { id, name, savedAt: Date.now(), segmentCount: 0 };
}

function storedProject(id: string, name: string): Project {
  return {
    id,
    name,
    script: '',
    segments: [],
    assets: [],
    headings: [],
    confirmed: true,
  } as unknown as Project;
}

const mockLoadProjectDetailed = vi.fn();
const mockGetAllAssetsForProject = vi.fn();
const mockLoadAllMetas = vi.fn();
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
  return {
    ...actual,
    getAllAssetsForProject: (id: string) => mockGetAllAssetsForProject(id),
    getLegacyAssets: async () => [],
  };
});

vi.mock('./services/historyPersist', async () => {
  const actual = await vi.importActual<typeof import('./services/historyPersist')>('./services/historyPersist');
  return { ...actual, loadHistory: async () => null, clearPersistedHistory: async () => {}, saveHistory: async () => {} };
});

// Imported AFTER the mocks are registered.
const { default: App } = await import('./App');

let container: HTMLDivElement;
let root: Root;

/** The pair (view, rendered project identity) — the thing under test. */
function view(): { view: 'dashboard' | 'editor' | 'none'; projectId: string | null } {
  const editor = container.querySelector('[data-testid="editor-root"]');
  if (editor) return { view: 'editor', projectId: editor.getAttribute('data-project-id') };
  if (container.querySelector('[data-testid="project-grid"]')) {
    return { view: 'dashboard', projectId: null };
  }
  return { view: 'none', projectId: null };
}

async function mountApp(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<App />); });
  // Drain the mount hydration effect's awaits.
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadAllMetas.mockReturnValue([meta(OUTGOING_ID, 'Outgoing'), meta(TARGET_ID, 'Target')]);
  mockSaveProject.mockResolvedValue({ ok: true });
  mockGetLastOpenedProjectId.mockReturnValue(null);
  mockGetAllAssetsForProject.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('WS2 T4.1 — dashboard/editor view flip', () => {
  it('never renders the editor over the outgoing project during an async switch', async () => {
    const load = deferred<unknown>();
    const assets = deferred<unknown[]>();
    mockLoadProjectDetailed.mockReturnValue(load.promise);
    mockGetAllAssetsForProject.mockReturnValue(assets.promise);

    await mountApp();
    expect(view().view).toBe('dashboard');

    const card = container.querySelector<HTMLElement>(`[data-testid="project-card-${TARGET_ID}"]`);
    expect(card).not.toBeNull();

    // --- Boundary 1: the switch has STARTED, nothing has resolved. ---
    await act(async () => { card!.click(); });
    expect(view()).toEqual({ view: 'dashboard', projectId: null });

    // --- Boundary 2: the load promise has RESOLVED, but the project state has
    // NOT been swapped yet (asset rehydration is still in flight). This is the
    // assertion that fails on a regression back to flipping at the resolution
    // of `loadProjectDetailed`. ---
    load.resolve({
      ok: true,
      project: storedProject(TARGET_ID, 'Target'),
      savedAt: Date.now(),
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(view()).toEqual({ view: 'dashboard', projectId: null });

    // --- Boundary 3: the state swap runs. Only now does the editor mount, and
    // it mounts on the TARGET project, never the outgoing one. ---
    assets.resolve([]);
    await act(async () => { await assets.promise; await Promise.resolve(); });
    expect(view()).toEqual({ view: 'editor', projectId: TARGET_ID });
  });

  it('marks the clicked card pending while the switch is in flight', async () => {
    const load = deferred<unknown>();
    mockLoadProjectDetailed.mockReturnValue(load.promise);

    await mountApp();
    const card = container.querySelector<HTMLElement>(`[data-testid="project-card-${TARGET_ID}"]`);
    await act(async () => { card!.click(); });

    expect(
      container.querySelector(`[data-testid="project-card-${TARGET_ID}"]`)!.getAttribute('aria-busy'),
    ).toBe('true');
    expect(
      container.querySelector(`[data-testid="project-card-spinner-${TARGET_ID}"]`),
    ).not.toBeNull();
    // The other card is not marked, and the grid is inert.
    expect(
      container.querySelector(`[data-testid="project-card-${OUTGOING_ID}"]`)!.getAttribute('aria-busy'),
    ).toBeNull();
    expect(
      (container.querySelector<HTMLElement>('[data-testid="project-grid"]')!).style.pointerEvents,
    ).toBe('none');

    load.resolve({ ok: true, project: storedProject(TARGET_ID, 'Target'), savedAt: Date.now() });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });

  it('clears the pending state on the ERROR path, not just the success path', async () => {
    const load = deferred<unknown>();
    mockLoadProjectDetailed.mockReturnValue(load.promise);

    await mountApp();
    const card = container.querySelector<HTMLElement>(`[data-testid="project-card-${TARGET_ID}"]`);
    await act(async () => { card!.click(); });
    expect(
      container.querySelector(`[data-testid="project-card-spinner-${TARGET_ID}"]`),
    ).not.toBeNull();

    // Present-but-broken: `loadProjectDetailed` resolves with ok:false and the
    // handler early-returns. The pending state must be released by `finally`.
    load.resolve({ ok: false, reason: 'corrupt', rawLength: 1234 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(view()).toEqual({ view: 'dashboard', projectId: null });
    expect(
      container.querySelector(`[data-testid="project-card-spinner-${TARGET_ID}"]`),
    ).toBeNull();
    expect(
      container.querySelector(`[data-testid="project-card-${TARGET_ID}"]`)!.getAttribute('aria-busy'),
    ).toBeNull();
    expect(
      (container.querySelector<HTMLElement>('[data-testid="project-grid"]')!).style.pointerEvents,
    ).toBe('');
  });

  it('keeps the dashboard mounted while the New Project modal is open', async () => {
    await mountApp();
    expect(view().view).toBe('dashboard');

    const newBtn = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent?.includes('New Project'));
    expect(newBtn).toBeDefined();

    await act(async () => { newBtn!.click(); });

    // The modal is up AND the dashboard is still the mounted view — the editor
    // must not appear behind it over the outgoing project.
    expect(document.body.textContent).toContain('New Project');
    expect(view().view).toBe('dashboard');
    expect(container.querySelector('[data-testid="editor-root"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WS2 T4.1 Step 2c — the FOURTH view-flip site: the mount hydration effect's
// reload branch.
//
// It used to flip unconditionally after awaiting `handleSwitchProject`. That
// handler flips for itself on success and deliberately does NOT flip on either
// of its early returns (project id in the registry but absent from storage, or
// present-but-unreadable), leaving `project` as the empty default. The extra
// flip therefore unmounted the dashboard and left the user staring at an editor
// with no project loaded.
//
// The load promise is again held open so the assertion can be taken at the
// await boundary rather than only after everything settles.
// ---------------------------------------------------------------------------
describe('WS2 T4.1 — mount hydration of the last-opened project', () => {
  it('leaves the dashboard mounted when the last-opened project is MISSING from storage', async () => {
    mockGetLastOpenedProjectId.mockReturnValue(TARGET_ID);
    const load = deferred<unknown>();
    mockLoadProjectDetailed.mockReturnValue(load.promise);

    await mountApp();
    // Boundary: hydration is still in flight — neither view has committed yet.
    expect(view().view).toBe('none');

    // `loadProjectDetailed` resolving to null is the "registry says it exists,
    // storage disagrees" case.
    load.resolve(null);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(view()).toEqual({ view: 'dashboard', projectId: null });
    expect(container.querySelector('[data-testid="editor-root"]')).toBeNull();
  });

  it('leaves the dashboard mounted when the last-opened project is present but BROKEN', async () => {
    mockGetLastOpenedProjectId.mockReturnValue(TARGET_ID);
    const load = deferred<unknown>();
    mockLoadProjectDetailed.mockReturnValue(load.promise);

    await mountApp();
    load.resolve({ ok: false, reason: 'corrupt', rawLength: 4096 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(view()).toEqual({ view: 'dashboard', projectId: null });
    expect(container.querySelector('[data-testid="editor-root"]')).toBeNull();
  });

  it('still opens the editor on the last-opened project when the load SUCCEEDS', async () => {
    // The success path must be byte-for-byte unchanged by the deletion: the
    // handler's own flip, adjacent to its state swap, is what mounts the editor.
    mockGetLastOpenedProjectId.mockReturnValue(TARGET_ID);
    const load = deferred<unknown>();
    const assets = deferred<unknown[]>();
    mockLoadProjectDetailed.mockReturnValue(load.promise);
    mockGetAllAssetsForProject.mockReturnValue(assets.promise);

    await mountApp();
    load.resolve({ ok: true, project: storedProject(TARGET_ID, 'Target'), savedAt: Date.now() });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Boundary: load resolved, state not yet swapped — still no editor.
    expect(container.querySelector('[data-testid="editor-root"]')).toBeNull();

    assets.resolve([]);
    await act(async () => { await assets.promise; await Promise.resolve(); });
    expect(view()).toEqual({ view: 'editor', projectId: TARGET_ID });
  });
});
