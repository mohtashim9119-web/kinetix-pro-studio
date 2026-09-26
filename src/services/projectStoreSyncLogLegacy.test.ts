/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Operator ruling (sync-log user view) — 'fa-fallback' retired from the
 * entry-type union. A project persisted before plan-v3 Wave 1 can carry
 * 'fa-fallback' entries on disk; the REAL loader must open it, drop those
 * entries, keep every other entry, and the user view must build over what
 * remains.
 *
 * Same fake OS-store harness as `projectStoreV6.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let osBacking: Map<string, string>;

vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));

vi.mock('./projectStoreClient', () => ({
  osStoreWrite: (id: string, contents: string) => {
    osBacking.set(id, contents);
    return Promise.resolve();
  },
  osStoreRead: (id: string) => Promise.resolve(osBacking.has(id) ? osBacking.get(id)! : null),
  osStoreDelete: (id: string) => {
    osBacking.delete(id);
    return Promise.resolve();
  },
  osStoreListIds: () => Promise.resolve([...osBacking.keys()]),
}));

import { loadProjectDetailed, __resetStoreGuardsForTests } from './projectStore';
import { buildSyncEngineEntry, buildFaPreflightEntry } from './syncLog';
import { buildSyncLogUserView } from './syncLogUserView';
import { buildSyncInfoEntry } from '../App';
import { AnimationType, TransitionType } from '../types';

const AT = 1_700_000_000_000;

beforeEach(() => {
  __resetStoreGuardsForTests();
  const registry = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (registry.has(k) ? registry.get(k)! : null),
    setItem: (k: string, v: string) => registry.set(k, String(v)),
    removeItem: (k: string) => void registry.delete(k),
    clear: () => registry.clear(),
    key: (i: number) => [...registry.keys()][i] ?? null,
    get length() { return registry.size; },
  } as Storage);
  osBacking = new Map();
});

describe('old project with persisted fa-fallback entries', () => {
  it('loads through the real loader with fa-fallback filtered out and everything else kept', async () => {
    const preflight = buildFaPreflightEntry('run-old', { ready: true, summary: 'Forced alignment ready (en).' }, AT);
    const engine = buildSyncEngineEntry('run-old', 'whisper', 120, AT);
    const info = buildSyncInfoEntry('run-old', 4, 4, 0, AT);
    // Verbatim shape of a pre-Wave-1 `buildFaFallbackEntry` record.
    const legacyFallback = {
      id: 'legacy-fa', timestamp: AT, syncRunId: 'run-old', type: 'fa-fallback',
      message: 'High-precision sync was ON but did not run — the alignment engine reported an error. This run used Whisper timing instead.',
      owningRule: 'FA', reason: 'inference-error', severity: 'warning',
      errorMessage: 'failed to initialize onnxruntime', fixHint: 'Run Apply Sync again.',
    };
    const record = {
      version: 4,
      savedAt: AT,
      project: {
        id: 'p-legacy', name: 'Pre-Wave-1', script: 'x', sceneDetails: '', headings: [], assets: [],
        segments: [{ id: 'x', order: 0, text: 'One.', startTime: 0, duration: 2, transition: TransitionType.NONE, animation: AnimationType.NONE }],
        globalTransition: TransitionType.NONE, globalTransitionDuration: 0.5, globalAnimation: AnimationType.NONE,
        textLayers: [], globalOverlayConfig: { color: '#FFFFFF', backgroundColor: '#000000', fontFamily: 'Inter' },
        confirmed: true, aspectRatio: '16:9', resolutionTier: '1080p',
        syncLog: [preflight, legacyFallback, engine, info],
        syncRunSummaries: [{ syncRunId: 'run-old', timestamp: AT, totalSegments: 4, coveredSegments: 4, skippedSegments: 0, aborted: false }],
      },
    };
    osBacking.set('p-legacy', JSON.stringify(record));

    const loaded = await loadProjectDetailed('p-legacy');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.syncLog?.map(e => e.id)).toEqual([preflight.id, engine.id, info.id]);

    const view = buildSyncLogUserView(loaded.project.syncLog ?? [], loaded.project.syncRunSummaries);
    expect(view.details.total).toBe(3);
    expect(view.headline.engine).toBe('whisper');
    expect(view.attention).toEqual([]);
  });

  it('a project with no syncLog field at all still loads (pre-WS-logs)', async () => {
    osBacking.set('p-none', JSON.stringify({
      version: 4, savedAt: AT,
      project: { id: 'p-none', name: 'n', headings: [], assets: [], segments: [] },
    }));
    const loaded = await loadProjectDetailed('p-none');
    if (!loaded || !loaded.ok) throw new Error('load failed');
    expect(loaded.project.syncLog).toBeUndefined();
  });
});
