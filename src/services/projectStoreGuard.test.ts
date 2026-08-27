/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WS1 Session O — the data-loss guard's regression lock.
 *
 * PROVENANCE OF THE SHAPES TESTED HERE. Session O's forensics preserved and
 * parsed the real on-disk stores before any code was touched. Every project in
 * both origin stores hydrated cleanly through the production `loadProject`
 * path (12/12, registry `segmentCount` matching hydrated `segments.length`),
 * so NOTHING here is regression-locking a measured corruption — there was
 * none. What these tests lock is the guard that makes the silent failure
 * modes the store previously had impossible to hit silently again:
 *
 *   1. a zero-segment project overwriting a stored non-empty one,
 *   2. a quota/write failure swallowed instead of reported,
 *   3. a malformed stored record indistinguishable from "no such project",
 *      followed by an autosave over the very record that failed to load.
 *
 * 2026-08-25 — project bodies moved from `localStorage` (a shared ~5-10 MB
 * origin budget that a real 21-min-audio project's ~915,000-char JSON started
 * blowing through) to IndexedDB (`projectDataStore.ts`). This suite now mocks
 * that module directly with a Map-backed fake plus per-test failure
 * injection, rather than a `localStorage` stub — it is testing `saveProject`
 * / `loadProjectDetailed`'s GUARD LOGIC (poisoning, empty-over-nonempty,
 * quota/verify reporting), not IndexedDB itself.
 *
 * The `faHighPrecisionSync` round trip and the pre-change fixture cover the
 * schema-change half of Step 3(c).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProjectRecord } from './projectDataStore';

// ---------------------------------------------------------------------------
// Fake `projectDataStore` — a Map-backed IndexedDB stand-in with injectable
// failures, so quota/verify-failure paths can be tested deterministically
// without depending on a real engine's quota enforcement (fake-indexeddb
// does not enforce one).
// ---------------------------------------------------------------------------

let idbBacking: Map<string, ProjectRecord>;
let putFailure: (() => Error) | null = null;
let getFailure: (() => Error) | null = null;
/** When set, `getProjectRecord` returns this instead of the real backing entry — for the verify-failed path. */
let getOverride: ((id: string) => ProjectRecord | null) | null = null;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

vi.mock('./projectDataStore', () => ({
  putProjectRecord: (record: ProjectRecord) => {
    if (putFailure) return Promise.reject(putFailure());
    idbBacking.set(record.id, clone(record));
    return Promise.resolve();
  },
  getProjectRecord: (id: string) => {
    if (getFailure) return Promise.reject(getFailure());
    if (getOverride) return Promise.resolve(getOverride(id));
    return Promise.resolve(idbBacking.has(id) ? clone(idbBacking.get(id)!) : null);
  },
  deleteProjectRecord: (id: string) => {
    idbBacking.delete(id);
    return Promise.resolve();
  },
  getAllProjectIds: () => Promise.resolve([...idbBacking.keys()]),
}));

import {
  saveProject,
  loadProject,
  loadProjectDetailed,
  getLoadFailure,
  clearLoadFailure,
  __resetStoreGuardsForTests,
} from './projectStore';
import type { Project, VideoSegment } from '../types';
import { AnimationType, TransitionType } from '../types';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let registryBacking: Map<string, string>;

function installLocalStorage(): void {
  registryBacking = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (registryBacking.has(k) ? registryBacking.get(k)! : null),
    setItem: (k: string, v: string) => registryBacking.set(k, String(v)),
    removeItem: (k: string) => void registryBacking.delete(k),
    clear: () => registryBacking.clear(),
    key: (i: number) => [...registryBacking.keys()][i] ?? null,
    get length() {
      return registryBacking.size;
    },
  } as Storage);
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as unknown as Storage);
}

function seg(i: number): VideoSegment {
  return {
    id: `seg-${i}`,
    text: `segment ${i}`,
    startTime: i * 2,
    duration: 2,
    showOverlay: true,
  } as VideoSegment;
}

function projectWith(segments: number, over: Partial<Project> = {}): Project {
  return {
    id: 'p-guard',
    name: 'Guard Fixture',
    script: 'x',
    sceneDetails: '',
    segments: Array.from({ length: segments }, (_, i) => seg(i)),
    headings: [],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    textLayers: [],
    globalOverlayConfig: { color: '#FFFFFF', backgroundColor: '#000000', fontFamily: 'Inter' },
    confirmed: true,
    aspectRatio: '16:9',
    resolutionTier: '1080p',
    ...over,
  } as Project;
}

beforeEach(() => {
  __resetStoreGuardsForTests();
  installLocalStorage();
  idbBacking = new Map();
  putFailure = null;
  getFailure = null;
  getOverride = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  __resetStoreGuardsForTests();
});

// ---------------------------------------------------------------------------
// 1. Pre-change fixture hydrates, with no write-back of empty state
// ---------------------------------------------------------------------------

describe('pre-change project fixture', () => {
  /**
   * A project saved BEFORE the schema changes this codebase has since made:
   * carries the retired `playbackSpeed`/`sourceDuration` per-segment fields,
   * carries no `headings` layer, and carries no `faHighPrecisionSync`.
   */
  const PRE_CHANGE: ProjectRecord = {
    id: 'p-guard',
    version: 2,
    savedAt: 1_700_000_000_000,
    project: {
      id: 'p-guard',
      name: 'Pre-change Project',
      script: 'legacy',
      sceneDetails: '',
      segments: [
        { id: 's0', text: 'a', startTime: 0, duration: 2, showOverlay: true, playbackSpeed: 2, sourceDuration: 9 },
        { id: 's1', text: 'b', startTime: 2, duration: 2, showOverlay: true, playbackSpeed: 1, sourceDuration: 9 },
        { id: 's2', text: 'c', startTime: 4, duration: 2, showOverlay: true },
      ],
      assets: [],
      globalTransition: 'none',
      globalTransitionDuration: 0.5,
      globalAnimation: 'none',
      textLayers: [],
      globalOverlayConfig: { color: '#FFFFFF', backgroundColor: '#000000', fontFamily: 'Inter' },
      confirmed: true,
      aspectRatio: '16:9',
      resolutionTier: '1080p',
    },
  };

  it('hydrates fully — every segment survives, retired fields are stripped, headings default to []', async () => {
    idbBacking.set('p-guard', PRE_CHANGE);
    const loaded = await loadProject('p-guard');
    expect(loaded).not.toBeNull();
    expect(loaded!.project.segments).toHaveLength(3);
    expect(loaded!.project.segments.map(s => s.text)).toEqual(['a', 'b', 'c']);
    expect(loaded!.project.headings).toEqual([]);
    expect(loaded!.savedAt).toBe(1_700_000_000_000);
    for (const s of loaded!.project.segments) {
      expect(s).not.toHaveProperty('playbackSpeed');
      expect(s).not.toHaveProperty('sourceDuration');
    }
    // Durations are untouched by the strip — Piece 2's Case A/B contract.
    expect(loaded!.project.segments.map(s => s.duration)).toEqual([2, 2, 2]);
  });

  it('a subsequent empty-project autosave does NOT write back over it', async () => {
    idbBacking.set('p-guard', PRE_CHANGE);
    const before = clone(idbBacking.get('p-guard')!);

    const outcome = await saveProject(projectWith(0));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('empty-over-nonempty');
    // The decisive assertion: the stored record is byte-for-byte unchanged.
    expect(idbBacking.get('p-guard')).toEqual(before);
    expect((await loadProject('p-guard'))!.project.segments).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 2. Empty-over-non-empty guard
// ---------------------------------------------------------------------------

describe('empty-over-nonempty guard', () => {
  it('refuses a 0-segment write over a stored 447-segment project', async () => {
    await saveProject(projectWith(447));
    expect((await loadProject('p-guard'))!.project.segments).toHaveLength(447);
    const before = clone(idbBacking.get('p-guard')!);

    const outcome = await saveProject(projectWith(0));

    expect(outcome).toEqual({ ok: false, reason: 'empty-over-nonempty', message: expect.any(String) });
    expect(idbBacking.get('p-guard')).toEqual(before);
    expect((await loadProject('p-guard'))!.project.segments).toHaveLength(447);
  });

  it('logs loudly, naming both counts, so the refusal is never silent', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await saveProject(projectWith(447));
    await saveProject(projectWith(0));
    expect(err).toHaveBeenCalled();
    const msg = err.mock.calls.map(c => String(c[0])).join('\n');
    expect(msg).toMatch(/REFUSING/);
    expect(msg).toMatch(/0 segments/);
    expect(msg).toMatch(/447/);
    err.mockRestore();
  });

  it('ALLOWS an empty first save — a brand-new project is not an overwrite', async () => {
    expect((await saveProject(projectWith(0))).ok).toBe(true);
    expect((await loadProject('p-guard'))!.project.segments).toHaveLength(0);
  });

  it('allows a deliberate emptying through the explicit opt-in', async () => {
    await saveProject(projectWith(447));
    expect((await saveProject(projectWith(0), { allowEmptying: true })).ok).toBe(true);
    expect((await loadProject('p-guard'))!.project.segments).toHaveLength(0);
  });

  it('a non-empty write over a non-empty project is unaffected', async () => {
    await saveProject(projectWith(447));
    expect((await saveProject(projectWith(448))).ok).toBe(true);
    expect((await loadProject('p-guard'))!.project.segments).toHaveLength(448);
  });
});

// ---------------------------------------------------------------------------
// 3. Malformed stored records — loud AND non-destructive
// ---------------------------------------------------------------------------

describe('malformed stored records', () => {
  const CASES: [string, unknown][] = [
    ['missing project entirely', { id: 'p-guard', version: 2, savedAt: 1 }],
    ['project present but no segments array', { id: 'p-guard', version: 2, savedAt: 1, project: { id: 'p-guard' } }],
    ['segments is not an array', { id: 'p-guard', version: 2, savedAt: 1, project: { id: 'p-guard', segments: 'nope' } }],
  ];

  for (const [label, bad] of CASES) {
    it(`${label}: the stored record survives, the error is reported, and nothing is rewritten`, async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      idbBacking.set('p-guard', bad as ProjectRecord);

      const outcome = await loadProjectDetailed('p-guard');

      expect(outcome).not.toBeNull();
      expect(outcome!.ok).toBe(false);
      expect(outcome!.ok === false && outcome!.reason).toBe('shape-invalid');
      // Non-destructive: the exact record is still there.
      expect(idbBacking.get('p-guard')).toEqual(bad);
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });
  }

  it('a genuinely unreadable store (IndexedDB open/read throws) is reported as storage-unavailable', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    getFailure = () => new Error('IndexedDB is not available');

    const outcome = await loadProjectDetailed('p-guard');

    expect(outcome!.ok).toBe(false);
    expect(outcome!.ok === false && outcome!.reason).toBe('storage-unavailable');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('an ABSENT project stays distinguishable from a broken one', async () => {
    expect(await loadProjectDetailed('p-guard')).toBeNull();
    expect(getLoadFailure('p-guard')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Load-throws-then-autosave-fires
// ---------------------------------------------------------------------------

describe('load failure blocks the autosave that follows it', () => {
  it('a failed load poisons the id, and the next save is refused with the stored record intact', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const corrupt = { id: 'p-guard', version: 2, savedAt: 1, project: { id: 'p-guard' } } as ProjectRecord;
    idbBacking.set('p-guard', corrupt);

    // The app tries to open it and fails...
    const outcome = await loadProjectDetailed('p-guard');
    expect(outcome!.ok).toBe(false);
    expect(getLoadFailure('p-guard')).toBeDefined();

    // ...and 500 ms later the debounced autosave fires with whatever the app
    // has in memory. THIS is the write that used to destroy the evidence.
    const saved = await saveProject(projectWith(0));
    expect(saved.ok).toBe(false);
    expect(saved.ok === false && saved.reason).toBe('blocked-by-load-failure');
    expect(idbBacking.get('p-guard')).toEqual(corrupt);

    // Even a well-populated project is refused — the id stays poisoned until
    // the user acts, because the app cannot know the in-memory state is right.
    const savedFull = await saveProject(projectWith(447));
    expect(savedFull.ok === false && savedFull.reason).toBe('blocked-by-load-failure');
    expect(idbBacking.get('p-guard')).toEqual(corrupt);

    err.mockRestore();
  });

  it('clearLoadFailure is the escape hatch, and un-poisons the id', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    idbBacking.set('p-guard', { id: 'p-guard', version: 2, savedAt: 1, project: {} } as ProjectRecord);
    await loadProjectDetailed('p-guard');
    expect((await saveProject(projectWith(447))).ok).toBe(false);

    clearLoadFailure('p-guard');
    expect((await saveProject(projectWith(447))).ok).toBe(true);
    expect((await loadProject('p-guard'))!.project.segments).toHaveLength(447);
    err.mockRestore();
  });

  it('a later CLEAN load of the same id un-poisons it automatically', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    idbBacking.set('p-guard', { id: 'p-guard', version: 2, savedAt: 1, project: {} } as ProjectRecord);
    await loadProjectDetailed('p-guard');
    expect(getLoadFailure('p-guard')).toBeDefined();

    // Repaired out-of-band (e.g. adopted from the mirror).
    idbBacking.set('p-guard', { id: 'p-guard', version: 2, savedAt: 5, project: projectWith(3) } as unknown as ProjectRecord);
    const good = await loadProjectDetailed('p-guard');
    expect(good!.ok).toBe(true);
    expect(getLoadFailure('p-guard')).toBeUndefined();
    err.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 5. Quota / write failure is reported, not swallowed
// ---------------------------------------------------------------------------

describe('write failures are reported', () => {
  it('a QuotaExceededError is surfaced as quota-exceeded instead of being swallowed', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    putFailure = () => {
      const e = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return e as unknown as Error;
    };

    const outcome = await saveProject(projectWith(10));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('quota-exceeded');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('a write that resolves but does not land is caught by read-back verification', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // put() "succeeds" (does nothing) but get() reports the record is not there.
    getOverride = () => null;

    const outcome = await saveProject(projectWith(10));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('verify-failed');
    err.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 6. faHighPrecisionSync round trip, with and without the key
// ---------------------------------------------------------------------------

describe('faHighPrecisionSync round trip', () => {
  it('round-trips true', async () => {
    await saveProject(projectWith(3, { faHighPrecisionSync: true }));
    expect((await loadProject('p-guard'))!.project.faHighPrecisionSync).toBe(true);
  });

  it('round-trips false (an explicit opt-out is not lost)', async () => {
    await saveProject(projectWith(3, { faHighPrecisionSync: false }));
    expect((await loadProject('p-guard'))!.project.faHighPrecisionSync).toBe(false);
  });

  it('an ABSENT key stays absent — "no preference" is never written back as a value', async () => {
    const p = projectWith(3);
    delete (p as { faHighPrecisionSync?: boolean }).faHighPrecisionSync;
    await saveProject(p);
    const back = (await loadProject('p-guard'))!.project;
    expect('faHighPrecisionSync' in back).toBe(false);
    expect(back.faHighPrecisionSync).toBeUndefined();
  });

  it('survives a save→load→save→load double round trip unchanged', async () => {
    await saveProject(projectWith(3, { faHighPrecisionSync: true }));
    const once = (await loadProject('p-guard'))!.project;
    await saveProject(once);
    const twice = (await loadProject('p-guard'))!.project;
    expect(twice.faHighPrecisionSync).toBe(true);
    expect(twice.segments).toHaveLength(3);
  });
});
