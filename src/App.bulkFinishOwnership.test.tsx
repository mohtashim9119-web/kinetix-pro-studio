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
    loadAllMetas: () => [meta(ROW_A, 'Row A'), meta(ROW_B, 'Row B')],
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
      tokens: [{ text: 'hello', start: 0, end: 0.5 }],
      language: 'auto',
    }),
    runBulkProjectFinish: (id: string, deps: Parameters<typeof actual.runBulkProjectFinish>[1]) =>
      actual.runBulkProjectFinish(id, {
        ...deps,
        adoptCachedTranscript: async pid => { const r = await deps.adoptCachedTranscript(pid); readyTrace.push(`adopt=${r}`); return r; },
        readReady: () => { const r = deps.readReady(); readyTrace.push(JSON.stringify(r)); return r; },
      }, 3_000),
  };
});

// What Build Timeline hashes is what it built from: record it per project.
const readyTrace: string[] = [];
const assetWrites: { projectId: string; name: string }[] = [];
const scriptReads: { projectId: string; script: string; scene: string }[] = [];
let liveProjectId = '';
vi.mock('./services/spine', async () => {
  const actual = await vi.importActual<typeof import('./services/spine')>('./services/spine');
  return {
    ...actual,
    computeScriptHash: async (script: string, scene: string) => {
      scriptReads.push({ projectId: liveProjectId, script, scene });
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
let finalizer: ((id: string) => Promise<{ ok: boolean; message?: string }>) | undefined;

function editorProjectId(): string | null {
  return container.querySelector('[data-testid="editor-root"]')?.getAttribute('data-project-id') ?? null;
}

beforeEach(async () => {
  localStorage.clear();
  stored.clear();
  scriptReads.length = 0;
  assetWrites.length = 0;
  readyTrace.length = 0;
  stagedRows.clear();
  stored.set(ROW_A, bulkProject(ROW_A, 'Row A'));
  stored.set(ROW_B, bulkProject(ROW_B, 'Row B'));
  await deleteAllStagedForProject(ROW_A);
  await deleteAllStagedForProject(ROW_B);
  await seedStaged(ROW_A, 'A');
  await seedStaged(ROW_B, 'B');
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
  it('adopts the cached transcript right after the switch (no force-start)', async () => {
    const card = container.querySelector<HTMLElement>(`[data-testid="project-card-${ROW_A}"]`);
    liveProjectId = ROW_A;
    await act(async () => { card!.click(); });
    await flush();
    readyTrace.length = 0;
    liveProjectId = ROW_B;
    let done = false;
    void finalizer!(ROW_B).then(() => { done = true; });
    for (let i = 0; i < 60 && !readyTrace.some(t => t.startsWith('adopt=')) && !done; i++) await flush(50);
    expect(
      readyTrace.find(t => t.startsWith('adopt=')),
      'adopt checked the post-render projectRef, which still names the OUTGOING project right after ' +
        'the switch — the cache hit is never adopted and finish always force-starts a transcription.',
    ).toBe('adopt=true');
    for (let i = 0; i < 80 && !done; i++) await flush(50);
  }, 20_000);

  it('finishing row B after row A reads B’s script and scene doc, never A’s', async () => {
    expect(finalizer, 'App never handed the runner its finalizer').toBeDefined();

    // Row A finished first: the editor is open on A with A's staged files.
    const card = container.querySelector<HTMLElement>(`[data-testid="project-card-${ROW_A}"]`);
    liveProjectId = ROW_A;
    await act(async () => { card!.click(); });
    await flush();
    expect(editorProjectId()).toBe(ROW_A);

    // The batch finishes row B — an in-editor switch, no dashboard between.
    liveProjectId = ROW_B;
    let done = false;
    let finishResult: { ok: boolean; message?: string } | undefined;
    void finalizer!(ROW_B).then(r => { done = true; finishResult = r; });
    for (let i = 0; i < 60 && !scriptReads.some(r => r.projectId === ROW_B) && !done; i++) await flush(50);

    expect(editorProjectId()).toBe(ROW_B);
    const readsForB = scriptReads.filter(r => r.projectId === ROW_B);
    expect(readsForB.length, 'Build Timeline never ran for row B').toBeGreaterThan(0);
    for (const read of readsForB) {
      expect(
        { script: read.script, scene: read.scene },
        'Build Timeline for row B read row A’s files — the record B is written from is A’s content.',
      ).toEqual({ script: 'script B', scene: '[Scene 1] scene B' });
    }
    expect(
      assetWrites.filter(w => w.projectId === ROW_B).map(w => w.name),
      'row A’s voiceover was persisted as row B’s voiceover asset',
    ).not.toContain('vo-A.m4a');
    void finishResult;
  }, 20_000);
});
