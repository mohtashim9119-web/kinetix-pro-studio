// @vitest-environment jsdom
//
// Cold boot vs in-session reload routing for the last-opened project id.
//
// `kinetix:lastOpenedProjectId` (localStorage) survives app restarts; the
// editor-resume token (sessionStorage + app-process token) survives reload only.
// Cold boot must land on the dashboard while keeping lastOpened persisted.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Project, ProjectMeta } from './types';
import {
  getLastOpenedProjectId,
  markEditorSessionActive,
  setLastOpenedProjectId,
} from './services/projectStore';
import { getAppSessionToken } from './services/historyPersist';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const TARGET_ID = 'last-open-project-id';

function meta(id: string): ProjectMeta {
  return { id, name: 'Last Open', savedAt: Date.now(), segmentCount: 0 };
}

function storedProject(id: string): Project {
  return {
    id,
    name: 'Last Open',
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

vi.mock('./services/projectStore', async () => {
  const actual = await vi.importActual<typeof import('./services/projectStore')>('./services/projectStore');
  return {
    ...actual,
    loadAllMetas: () => mockLoadAllMetas(),
    loadProjectDetailed: (id: string) => mockLoadProjectDetailed(id),
    upsertProjectMeta: vi.fn(),
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

const { default: App } = await import('./App');

let container: HTMLDivElement;
let root: Root;

function view(): 'dashboard' | 'editor' | 'none' {
  if (container.querySelector('[data-testid="editor-root"]')) return 'editor';
  if (container.querySelector('[data-testid="project-grid"]')) return 'dashboard';
  return 'none';
}

async function mountApp(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mockLoadAllMetas.mockReturnValue([meta(TARGET_ID)]);
  mockGetAllAssetsForProject.mockResolvedValue([]);
  setLastOpenedProjectId(TARGET_ID);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('cold boot vs reload — last-opened project routing', () => {
  it('cold boot lands on the dashboard while lastOpenedProjectId stays persisted', async () => {
    await mountApp();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(view()).toBe('dashboard');
    expect(getLastOpenedProjectId()).toBe(TARGET_ID);
    expect(mockLoadProjectDetailed).not.toHaveBeenCalled();
  });

  it('in-session reload reopens the last-opened project when the resume token matches', async () => {
    const token = await getAppSessionToken();
    markEditorSessionActive(token);

    const load = deferred<unknown>();
    const assets = deferred<unknown[]>();
    mockLoadProjectDetailed.mockReturnValue(load.promise);
    mockGetAllAssetsForProject.mockReturnValue(assets.promise);

    await mountApp();
    load.resolve({ ok: true, project: storedProject(TARGET_ID), savedAt: Date.now() });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    assets.resolve([]);
    await act(async () => { await assets.promise; await Promise.resolve(); });

    expect(view()).toBe('editor');
    expect(container.querySelector('[data-testid="editor-root"]')!.getAttribute('data-project-id')).toBe(TARGET_ID);
  });

  it('a stale resume token (cold boot) does not reopen even when lastOpened matches', async () => {
    markEditorSessionActive('stale-token-from-prior-process');

    await mountApp();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(view()).toBe('dashboard');
    expect(getLastOpenedProjectId()).toBe(TARGET_ID);
    expect(mockLoadProjectDetailed).not.toHaveBeenCalled();
  });
});
