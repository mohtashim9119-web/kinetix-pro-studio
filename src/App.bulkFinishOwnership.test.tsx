// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// v1.2.1 P0 — bulk finish wrote ROW 1's content into every row's record.
//
// The real finish path, end to end in the real App: the editor is open on row
// A (its staged files restored by the panel, exactly as finishing row A leaves
// it), the batch finishes row B through the finalizer App hands the runner,
// and Build Timeline runs. What Build Timeline READS is the evidence: the
// script/scene text it hashes into B's spine must be B's own, and the record
// written for B must carry B's own spine, never A's.
//
// jsdom cannot prove finish ORDER in the real window (DnD ruling) — the
// operator's real-window pass is the final proof. This pins the ownership.
// ---------------------------------------------------------------------------

import 'fake-indexeddb/auto';
import type { StoredStagedFile } from './services/stagedFilesStore';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Project, ProjectMeta } from './types';
import type { StagedFiles } from './components/DropZonePanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

const ROW_A = 'bulk-row-a';
const ROW_B = 'bulk-row-b';
const ROW_C = 'bulk-row-c';
const AUTO = { userInitiated: false } as const;

function meta(id: string, name: string): ProjectMeta {
  return { id, name, savedAt: Date.now(), segmentCount: 0 };
}

function bulkProject(id: string, name: string): Project {
  return {
    id, name, script: '', sceneDetails: '', segments: [], assets: [], headings: [],
    confirmed: true, bulkContext: true,
  } as unknown as Project;
}

const stored = new Map<string, Project>();
const mockSaveProject = vi.fn(async (p: Project) => { stored.set(p.id, p); return { ok: true }; });

vi.mock('./services/projectStore', async () => {
  const actual = await vi.importActual<typeof import('./services/projectStore')>('./services/projectStore');
  return {
    ...actual,
    loadAllMetas: () => [meta(ROW_A, 'Row A'), meta(ROW_B, 'Row B'), meta(ROW_C, 'Row C')],
    loadProject: async (id: string) => {
      const p = stored.get(id);
      return p ? { project: p, savedAt: Date.now() } : null;
    },
    loadProjectDetailed: async (id: string) => {
      const p = stored.get(id);
      return p ? { ok: true, project: p, savedAt: Date.now() } : null;
    },
    saveProject: (p: Project) => mockSaveProject(p),
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
    getAllAssetsForProject: async () => [],
    getLegacyAssets: async () => [],
    putAsset: async (projectId: string, _id: string, _blob: Blob, m: { name: string }) => {
      assetWrites.push({ projectId, name: m.name });
    },
  };
});

vi.mock('./services/historyPersist', async () => {
  const actual = await vi.importActual<typeof import('./services/historyPersist')>('./services/historyPersist');
  return { ...actual, loadHistory: async () => null, clearPersistedHistory: async () => {}, saveHistory: async () => {} };
});

// The batch's cloud transcript is a cache hit for every row.
vi.mock('./services/bulkFinish', async () => {
  const actual = await vi.importActual<typeof import('./services/bulkFinish')>('./services/bulkFinish');
  return {
    ...actual,
    lookupBatchTranscript: async () => ({
      tokens: [{ text: 'hello', startSec: 0, endSec: 0.5 }],
      language: 'auto',
    }),
  };
});

// What Build Timeline hashes is what it built from: record it per project.
const assetWrites: { projectId: string; name: string }[] = [];
const scriptReads: { script: string; scene: string }[] = [];
vi.mock('./services/spine', async () => {
  const actual = await vi.importActual<typeof import('./services/spine')>('./services/spine');
  return {
    ...actual,
    computeScriptHash: async (script: string, scene: string) => {
      scriptReads.push({ script, scene });
      return actual.computeScriptHash(script, scene);
    },
  };
});

// fake-indexeddb under jsdom reduces a Blob to {} (see
// dropZonePanel.stagedPersistence.test.tsx); a Map keeps the real bytes.
const stagedRows = new Map<string, StoredStagedFile>();
vi.mock('./services/stagedFilesStore', async () => {
  const actual = await vi.importActual<typeof import('./services/stagedFilesStore')>('./services/stagedFilesStore');
  return {
    ...actual,
    putStagedFile: async (row: StoredStagedFile) => { stagedRows.set(`${row.projectId}|${row.slotKey}`, row); },
    getStagedFilesForProject: async (projectId: string) =>
      [...stagedRows.values()].filter(r => r.projectId === projectId),
    deleteStagedFile: async (projectId: string, slotKey: string) => { stagedRows.delete(`${projectId}|${slotKey}`); },
    deleteAllStagedForProject: async (projectId: string) => {
      for (const k of [...stagedRows.keys()]) if (k.startsWith(`${projectId}|`)) stagedRows.delete(k);
    },
    countStagedFiles: async (projectId: string) =>
      [...stagedRows.values()].filter(r => r.projectId === projectId).length,
  };
});

const { default: App } = await import('./App');
const { bulkBatchRunner } = await import('./services/bulkSyncQueue');
const { putStagedFile, deleteAllStagedForProject } = await import('./services/stagedFilesStore');
const { ALL_PERSISTED_SLOTS, planStagedReconcile, toStoredRow } = await import('./services/stagedFilesPersist');

async function seedStaged(projectId: string, tag: string): Promise<void> {
  const next: StagedFiles = {
    scriptFile: { file: new File([`script ${tag}`], `script-${tag}.txt`, { type: 'text/plain' }), key: `s-${tag}` },
    sceneFile: { file: new File([`[Scene 1] scene ${tag}`], `scenes-${tag}.txt`, { type: 'text/plain' }), key: `c-${tag}` },
    voiceoverFile: { file: new File([`audio ${tag}`], `vo-${tag}.m4a`, { type: 'audio/mp4' }), key: `v-${tag}` },
    assetFiles: [],
    zipFiles: [],
  };
  const empty: StagedFiles = { scriptFile: null, sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [] };
  for (const e of planStagedReconcile(empty, next, ALL_PERSISTED_SLOTS).write) {
    await putStagedFile(await toStoredRow(projectId, e));
  }
}

let container: HTMLDivElement;
let root: Root;
let finalizer: ((id: string, req: { userInitiated: boolean }) => Promise<{ ok: boolean; message?: string; deferred?: boolean }>) | undefined;

function editorProjectId(): string | null {
  return container.querySelector('[data-testid="editor-root"]')?.getAttribute('data-project-id') ?? null;
}

beforeEach(async () => {
  localStorage.clear();
  stored.clear();
  scriptReads.length = 0;
  assetWrites.length = 0;
  stagedRows.clear();
  stored.set(ROW_A, bulkProject(ROW_A, 'Row A'));
  stored.set(ROW_B, bulkProject(ROW_B, 'Row B'));
  stored.set(ROW_C, bulkProject(ROW_C, 'Row C'));
  await seedStaged(ROW_A, 'A');
  await seedStaged(ROW_B, 'B');
  await seedStaged(ROW_C, 'C');
  const runner = bulkBatchRunner();
  vi.spyOn(runner, 'setFinalizer').mockImplementation(f => { finalizer = f; });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await act(async () => { await Promise.resolve(); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function flush(ms = 40): Promise<void> {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

describe('bulk finish — every row is built from its OWN inputs', () => {
  it('finishes in the background without opening the editor', async () => {
    expect(container.querySelector('[data-testid="project-grid"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dashboard-bulk"]')).not.toBeNull();
    let done = false;
    void finalizer!(ROW_B, AUTO).then(() => { done = true; });
    for (let i = 0; i < 80 && !done; i++) await flush(50);
    expect(done).toBe(true);
    expect(editorProjectId()).toBeNull();
    expect(container.querySelector('[data-testid="project-grid"]')).not.toBeNull();
  }, 20_000);

  it('finishing row B while the editor is on A reads B’s script and scene doc, never A’s, and does not switch', async () => {
    expect(finalizer, 'App never handed the runner its finalizer').toBeDefined();

    const card = container.querySelector<HTMLElement>(`[data-testid="project-card-${ROW_A}"]`);
    await act(async () => { card!.click(); });
    await flush();
    expect(editorProjectId()).toBe(ROW_A);
    expect(container.querySelector('[data-testid="bulk-drawer-handle"]')).toBeNull();
    expect(container.querySelector('[data-testid="dashboard-bulk"]')).toBeNull();
    const drawer = container.querySelector('[data-testid="bulk-modal"]');
    if (drawer) expect(drawer.getAttribute('data-hidden')).toBe('true');
    let done = false;
    void finalizer!(ROW_B, AUTO).then(() => { done = true; });
    for (let i = 0; i < 60 && !scriptReads.some(r => r.script === 'script B') && !done; i++) await flush(50);

    expect(editorProjectId()).toBe(ROW_A);
    const readsForB = scriptReads.filter(r => r.script.includes('script B'));
    expect(readsForB.length, 'Build Timeline never ran for row B').toBeGreaterThan(0);
    for (const read of readsForB) {
      expect({ script: read.script, scene: read.scene }).toEqual({ script: 'script B', scene: '[Scene 1] scene B' });
    }
    expect(
      assetWrites.filter(w => w.projectId === ROW_B).map(w => w.name),
    ).not.toContain('vo-A.m4a');
    for (let i = 0; i < 40 && !done; i++) await flush(50);
  }, 20_000);

  it('20 runs × 3 distinct cached rows, finished in order from the dashboard: each row reads only its own files, and the operator ends where they were', async () => {
    const rows = [[ROW_A, 'A'], [ROW_B, 'B'], [ROW_C, 'C']] as const;
    for (let run = 0; run < 20; run += 1) {
      scriptReads.length = 0;
      assetWrites.length = 0;
      expect(container.querySelector('[data-testid="project-grid"]'), `run ${run}: not on the dashboard`).not.toBeNull();
      for (const [id] of rows) {
        let done = false;
        void finalizer!(id, AUTO).then(() => { done = true; });
        for (let i = 0; i < 100 && !done; i++) await flush(20);
        expect(done, `run ${run}: ${id} never settled`).toBe(true);
      }
      for (const [, tag] of rows) {
        const reads = scriptReads.filter(r => r.script === `script ${tag}`);
        expect(reads.length, `run ${run}: Build Timeline never ran for ${tag}`).toBeGreaterThan(0);
        for (const r of reads) expect({ script: r.script, scene: r.scene }, `run ${run}: ${tag}`).toEqual({ script: `script ${tag}`, scene: `[Scene 1] scene ${tag}` });
        const vo = assetWrites.filter(w => w.name === `vo-${tag}.m4a`);
        expect(vo.length, `run ${run}: ${tag} voiceover`).toBeGreaterThan(0);
      }
      expect(editorProjectId(), `run ${run}: finishing left the editor open`).toBeNull();
    }
  }, 120_000);

  it('an operator ACTIVELY editing is not flipped away: background finish leaves the editor put', async () => {
    const card = container.querySelector<HTMLElement>(`[data-testid="project-card-${ROW_A}"]`);
    await act(async () => { card!.click(); });
    await flush();
    expect(editorProjectId()).toBe(ROW_A);
    await act(async () => {
      container.querySelector('[data-testid="editor-root"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    await finalizer!(ROW_B, AUTO);
    await flush();
    expect(editorProjectId()).toBe(ROW_A);
  });

  it('finishing a row while they are editing stays in the project they were editing', async () => {
    const card = container.querySelector<HTMLElement>(`[data-testid="project-card-${ROW_A}"]`);
    await act(async () => { card!.click(); });
    await flush();
    await act(async () => {
      container.querySelector('[data-testid="editor-root"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    let done = false;
    void finalizer!(ROW_B, { userInitiated: true }).then(() => { done = true; });
    for (let i = 0; i < 100 && !done; i++) await flush(20);
    expect(scriptReads.filter(r => r.script === 'script B').map(r => r.script)).toEqual(['script B']);
    expect(editorProjectId()).toBe(ROW_A);
  });

  it('after finishing a row the editor stays on the project the operator was on', async () => {
    const card = container.querySelector<HTMLElement>(`[data-testid="project-card-${ROW_A}"]`);
    await act(async () => { card!.click(); });
    await flush();
    let done = false;
    void finalizer!(ROW_B, AUTO).then(() => { done = true; });
    for (let i = 0; i < 100 && !done; i++) await flush(20);
    expect(scriptReads.some(r => r.script === 'script B')).toBe(true);
    await flush();
    expect(editorProjectId()).toBe(ROW_A);
  });

  it('an operator who opens something mid-finish is not dragged back', async () => {
    let result: { ok: boolean; deferred?: boolean } | undefined;
    void finalizer!(ROW_B, AUTO).then(r => { result = r; });
    const card = container.querySelector<HTMLElement>(`[data-testid="project-card-${ROW_C}"]`);
    await act(async () => { card!.click(); });
    for (let i = 0; i < 100 && !result; i++) await flush(20);
    await flush();
    expect(editorProjectId()).toBe(ROW_C);
    expect(container.querySelector('[data-testid="project-grid"]')).toBeNull();
  });
});
