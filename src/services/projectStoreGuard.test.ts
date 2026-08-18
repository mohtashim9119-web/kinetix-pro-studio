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
 * none. What these tests lock is the guard that makes the three SILENT failure
 * modes the store previously had impossible to hit silently again:
 *
 *   1. a zero-segment project overwriting a stored non-empty one,
 *   2. a quota/write failure swallowed by a bare `catch {}`,
 *   3. a parse failure indistinguishable from "no such project", followed by
 *      an autosave over the very bytes that failed to parse.
 *
 * The `faHighPrecisionSync` round trip and the pre-change fixture cover the
 * schema-change half of Step 3(c).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

let backing: Map<string, string>;

function installLocalStorage(opts: { throwOnSet?: () => Error | null } = {}): void {
  backing = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => {
      const err = opts.throwOnSet?.();
      if (err) throw err;
      backing.set(k, String(v));
    },
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() {
      return backing.size;
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

const KEY = 'kinetix:project:p-guard:v1';

beforeEach(() => {
  __resetStoreGuardsForTests();
  installLocalStorage();
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
  const PRE_CHANGE = JSON.stringify({
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
  });

  it('hydrates fully — every segment survives, retired fields are stripped, headings default to []', () => {
    backing.set(KEY, PRE_CHANGE);
    const loaded = loadProject('p-guard');
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

  it('a subsequent empty-project autosave does NOT write back over it', () => {
    backing.set(KEY, PRE_CHANGE);
    const before = backing.get(KEY)!;

    const outcome = saveProject(projectWith(0));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('empty-over-nonempty');
    // The decisive assertion: the stored bytes are byte-for-byte unchanged.
    expect(backing.get(KEY)).toBe(before);
    expect(loadProject('p-guard')!.project.segments).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 2. Empty-over-non-empty guard
// ---------------------------------------------------------------------------

describe('empty-over-nonempty guard', () => {
  it('refuses a 0-segment write over a stored 447-segment project', () => {
    saveProject(projectWith(447));
    expect(loadProject('p-guard')!.project.segments).toHaveLength(447);
    const before = backing.get(KEY)!;

    const outcome = saveProject(projectWith(0));

    expect(outcome).toEqual({ ok: false, reason: 'empty-over-nonempty', message: expect.any(String) });
    expect(backing.get(KEY)).toBe(before);
    expect(loadProject('p-guard')!.project.segments).toHaveLength(447);
  });

  it('logs loudly, naming both counts, so the refusal is never silent', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveProject(projectWith(447));
    saveProject(projectWith(0));
    expect(err).toHaveBeenCalled();
    const msg = err.mock.calls.map(c => String(c[0])).join('\n');
    expect(msg).toMatch(/REFUSING/);
    expect(msg).toMatch(/0 segments/);
    expect(msg).toMatch(/447/);
    err.mockRestore();
  });

  it('ALLOWS an empty first save — a brand-new project is not an overwrite', () => {
    expect(saveProject(projectWith(0)).ok).toBe(true);
    expect(loadProject('p-guard')!.project.segments).toHaveLength(0);
  });

  it('allows a deliberate emptying through the explicit opt-in', () => {
    saveProject(projectWith(447));
    expect(saveProject(projectWith(0), { allowEmptying: true }).ok).toBe(true);
    expect(loadProject('p-guard')!.project.segments).toHaveLength(0);
  });

  it('a non-empty write over a non-empty project is unaffected', () => {
    saveProject(projectWith(447));
    expect(saveProject(projectWith(448)).ok).toBe(true);
    expect(loadProject('p-guard')!.project.segments).toHaveLength(448);
  });
});

// ---------------------------------------------------------------------------
// 3. Corrupt / truncated / partial JSON — loud AND non-destructive
// ---------------------------------------------------------------------------

describe('corrupt stored values', () => {
  const CASES: [string, string][] = [
    ['truncated mid-object', '{"version":2,"savedAt":1,"project":{"id":"p-guard","segments":[{"id":"s0"'],
    ['empty string body', '{'],
    ['garbage', 'not json at all'],
    ['partial write / trailing cut', '{"version":2,"savedAt":1,"project":{"segments":[]}'],
  ];

  for (const [label, bad] of CASES) {
    it(`${label}: raw bytes survive, the error is reported, and nothing is rewritten`, () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      backing.set(KEY, bad);

      const outcome = loadProjectDetailed('p-guard');

      expect(outcome).not.toBeNull();
      expect(outcome!.ok).toBe(false);
      expect(outcome!.ok === false && outcome!.reason).toBe('parse-error');
      expect(outcome!.ok === false && outcome!.rawLength).toBe(bad.length);
      // Non-destructive: the exact bytes are still there.
      expect(backing.get(KEY)).toBe(bad);
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });
  }

  it('valid JSON of the wrong shape is reported as shape-invalid, not silently accepted', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrong = JSON.stringify({ version: 2, savedAt: 1, project: { id: 'p-guard' } });
    backing.set(KEY, wrong);
    const outcome = loadProjectDetailed('p-guard');
    expect(outcome!.ok === false && outcome!.reason).toBe('shape-invalid');
    expect(backing.get(KEY)).toBe(wrong);
    err.mockRestore();
  });

  it('an ABSENT project stays distinguishable from a broken one', () => {
    expect(loadProjectDetailed('p-guard')).toBeNull();
    expect(getLoadFailure('p-guard')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Load-throws-then-autosave-fires
// ---------------------------------------------------------------------------

describe('load failure blocks the autosave that follows it', () => {
  it('a failed load poisons the id, and the next save is refused with the raw bytes intact', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const corrupt = '{"version":2,"project":{"segments":[{"id"';
    backing.set(KEY, corrupt);

    // The app tries to open it and fails...
    const outcome = loadProjectDetailed('p-guard');
    expect(outcome!.ok).toBe(false);
    expect(getLoadFailure('p-guard')).toBeDefined();

    // ...and 500 ms later the debounced autosave fires with whatever the app
    // has in memory. THIS is the write that used to destroy the evidence.
    const saved = saveProject(projectWith(0));
    expect(saved.ok).toBe(false);
    expect(saved.ok === false && saved.reason).toBe('blocked-by-load-failure');
    expect(backing.get(KEY)).toBe(corrupt);

    // Even a well-populated project is refused — the id stays poisoned until
    // the user acts, because the app cannot know the in-memory state is right.
    const savedFull = saveProject(projectWith(447));
    expect(savedFull.ok === false && savedFull.reason).toBe('blocked-by-load-failure');
    expect(backing.get(KEY)).toBe(corrupt);

    err.mockRestore();
  });

  it('clearLoadFailure is the escape hatch, and un-poisons the id', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    backing.set(KEY, 'broken{');
    loadProjectDetailed('p-guard');
    expect(saveProject(projectWith(447)).ok).toBe(false);

    clearLoadFailure('p-guard');
    expect(saveProject(projectWith(447)).ok).toBe(true);
    expect(loadProject('p-guard')!.project.segments).toHaveLength(447);
    err.mockRestore();
  });

  it('a later CLEAN load of the same id un-poisons it automatically', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    backing.set(KEY, 'broken{');
    loadProjectDetailed('p-guard');
    expect(getLoadFailure('p-guard')).toBeDefined();

    // Repaired out-of-band (e.g. adopted from the mirror).
    backing.set(KEY, JSON.stringify({ version: 2, savedAt: 5, project: projectWith(3) }));
    const good = loadProjectDetailed('p-guard');
    expect(good!.ok).toBe(true);
    expect(getLoadFailure('p-guard')).toBeUndefined();
    err.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 5. Quota / write failure is reported, not swallowed
// ---------------------------------------------------------------------------

describe('write failures are reported', () => {
  it('a QuotaExceededError is surfaced as quota-exceeded instead of being swallowed', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const quota = new Error('The quota has been exceeded.');
    quota.name = 'QuotaExceededError';
    installLocalStorage({ throwOnSet: () => quota });

    const outcome = saveProject(projectWith(10));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('quota-exceeded');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('a write that silently does not land is caught by read-back verification', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    installLocalStorage();
    // A store that accepts writes but drops project payloads on the floor.
    const real = localStorage.setItem.bind(localStorage);
    vi.stubGlobal('localStorage', {
      ...localStorage,
      getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
      setItem: (k: string, v: string) => {
        if (k.startsWith('kinetix:project:')) return;
        real(k, v);
      },
      removeItem: (k: string) => void backing.delete(k),
    } as unknown as Storage);

    const outcome = saveProject(projectWith(10));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('verify-failed');
    err.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 6. faHighPrecisionSync round trip, with and without the key
// ---------------------------------------------------------------------------

describe('faHighPrecisionSync round trip', () => {
  it('round-trips true', () => {
    saveProject(projectWith(3, { faHighPrecisionSync: true }));
    expect(loadProject('p-guard')!.project.faHighPrecisionSync).toBe(true);
  });

  it('round-trips false (an explicit opt-out is not lost)', () => {
    saveProject(projectWith(3, { faHighPrecisionSync: false }));
    expect(loadProject('p-guard')!.project.faHighPrecisionSync).toBe(false);
  });

  it('an ABSENT key stays absent — "no preference" is never written back as a value', () => {
    const p = projectWith(3);
    delete (p as { faHighPrecisionSync?: boolean }).faHighPrecisionSync;
    saveProject(p);
    const back = loadProject('p-guard')!.project;
    expect('faHighPrecisionSync' in back).toBe(false);
    expect(back.faHighPrecisionSync).toBeUndefined();
  });

  it('survives a save→load→save→load double round trip unchanged', () => {
    saveProject(projectWith(3, { faHighPrecisionSync: true }));
    const once = loadProject('p-guard')!.project;
    saveProject(once);
    const twice = loadProject('p-guard')!.project;
    expect(twice.faHighPrecisionSync).toBe(true);
    expect(twice.segments).toHaveLength(3);
  });
});
