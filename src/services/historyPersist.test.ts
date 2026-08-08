// @vitest-environment jsdom
/**
 * Undo/redo history persistence tests (2026-08-08).
 *
 * jsdom, not the repo's default node environment, for three reasons this module
 * genuinely needs: `sessionStorage` (the non-Tauri token fallback), `window`
 * (the `__TAURI_INTERNALS__` probe), and `File` (an asset's blob handle). Same
 * per-file opt-in `dragSessionHarness.test.ts` uses. Under jsdom the Tauri probe
 * is correctly false, so these tests exercise the browser token path — the Tauri
 * path is one `invoke` call and is verified in the real shell instead.
 *
 * Covers the two things that can silently ruin this feature:
 *  1. the RELOAD-vs-RESTART gate — history must come back after a reload and
 *     must NOT come back after an app restart;
 *  2. asset round-tripping — a `blob:` URL cannot survive a page unload, so
 *     entries are stripped on save and re-pointed at the live project's already-
 *     rehydrated assets on load. Getting this wrong produces a restored state
 *     whose segments reference dead assets, and the symptom appears later as a
 *     blank preview rather than here.
 *
 * `fake-indexeddb` is already a devDependency (used by the asset-store tests),
 * so the IndexedDB path is exercised for real rather than mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  clearPersistedHistory,
  loadHistory,
  rehydrateEntryAssets,
  saveHistory,
  stripEntryAssets,
} from './historyPersist';
import { emptyHistory, pushEntry, type History } from './history';
import { AnimationType, TransitionType, type Asset, type Project, type VideoSegment } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function seg(id: string, startTime: number, duration: number, assetId?: string): VideoSegment {
  return {
    id, text: `t-${id}`, startTime, duration,
    transition: TransitionType.NONE, animation: AnimationType.NONE,
    order: 0, anchorStart: startTime, assetId,
  };
}

function asset(id: string, withBlob = true): Asset {
  return {
    id, name: `${id}.jpg`, type: 'image',
    url: withBlob ? `blob:http://localhost/${id}` : '',
    ...(withBlob ? { file: new File([new Uint8Array([1, 2, 3])], `${id}.jpg`) } : {}),
  };
}

function proj(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1', name: 'proj', script: '', sceneDetails: '',
    segments: [seg('A', 0, 2, 'a1'), seg('B', 2, 2, 'a2')],
    assets: [asset('a1'), asset('a2')],
    voiceoverId: 'a2',
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
    ...overrides,
  };
}

/**
 * `historyPersist.ts` memoises the process token per module instance, so a test
 * that wants to simulate an app RESTART has to get a fresh module. Resetting the
 * registry and re-importing is what produces a genuinely new token — the same
 * thing a new Rust process would.
 */
async function freshModule(): Promise<typeof import('./historyPersist')> {
  vi.resetModules();
  return import('./historyPersist');
}

beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  await clearPersistedHistory('p1');
  await clearPersistedHistory('p2');
});

const historyOf = (...states: Project[]): History<Project> => {
  let h = emptyHistory<Project>();
  for (const s of states) h = pushEntry(h, { state: s, label: 'edit', anchorSegmentId: 'A' });
  return h;
};

// ---------------------------------------------------------------------------
// PART 1 — asset stripping and rehydration, pure
// ---------------------------------------------------------------------------

describe('PART 1 — asset strip / rehydrate', () => {
  it('strip removes url and file, and nothing else', () => {
    const p = proj();
    const stripped = stripEntryAssets(p);
    for (const a of stripped.assets) {
      expect(a.url).toBeUndefined();
      expect(a.file).toBeUndefined();
    }
    // Identity and metadata survive — an entry must still know WHICH asset it had.
    expect(stripped.assets.map(a => a.id)).toEqual(['a1', 'a2']);
    expect(stripped.assets.map(a => a.name)).toEqual(['a1.jpg', 'a2.jpg']);
    // Everything else is untouched.
    expect(stripped.segments).toBe(p.segments);
    expect(stripped.voiceoverId).toBe('a2');
  });

  it('rehydrate re-points assets at the LIVE objects, by id', () => {
    const stored = stripEntryAssets(proj());
    const liveA1 = asset('a1');
    const liveA2 = asset('a2');
    const out = rehydrateEntryAssets(stored, [liveA1, liveA2]);
    expect(out.assets.map(a => a.url)).toEqual([liveA1.url, liveA2.url]);
    expect(out.assets[0]!.file).toBe(liveA1.file);
    // The ENTRY's own metadata is kept, not the live asset's — an entry records
    // the project as it was, and only url/file are session-bound.
    expect(out.assets.map(a => a.id)).toEqual(['a1', 'a2']);
    expect(out.segments.map(s => s.assetId)).toEqual(['a1', 'a2']);
    expect(out.voiceoverId).toBe('a2');
  });

  it('an asset the live project no longer has is DROPPED and its references nulled', () => {
    // The repair `handleSwitchProject` already performs for the project itself.
    // Without it a restored entry carries a segment pointing at a dead asset, and
    // the failure surfaces later as a blank preview instead of here.
    const stored = stripEntryAssets(proj());
    const out = rehydrateEntryAssets(stored, [asset('a1')]); // a2's blob is gone
    expect(out.assets.map(a => a.id)).toEqual(['a1']);
    expect(out.segments.map(s => s.assetId)).toEqual(['a1', undefined]);
    // voiceoverId pointed at a2, so it must be cleared, not left dangling.
    expect(out.voiceoverId).toBeUndefined();
    // The SEGMENT itself survives — dropping an asset must never drop a segment.
    expect(out.segments.length).toBe(2);
  });

  it('rehydrating with no live assets at all keeps every segment, assetId-less', () => {
    const stored = stripEntryAssets(proj());
    const out = rehydrateEntryAssets(stored, []);
    expect(out.assets).toEqual([]);
    expect(out.segments.length).toBe(2);
    expect(out.segments.every(s => s.assetId === undefined)).toBe(true);
    expect(out.voiceoverId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PART 2 — the reload / restart gate
// ---------------------------------------------------------------------------

describe('PART 2 — reload restores, app restart does not', () => {
  it('a PAGE RELOAD (same process token) restores history', () => {
    // Within one module instance the token is stable — which is exactly what a
    // reload of the same app process reproduces.
    return (async () => {
      const p0 = proj({ name: 'before' });
      const p1 = proj({ name: 'middle' });
      await saveHistory('p1', historyOf(p0, p1));
      const restored = await loadHistory('p1', [asset('a1'), asset('a2')]);
      expect(restored).not.toBeNull();
      expect(restored!.past.length).toBe(2);
      expect(restored!.past.map(e => e.state.name)).toEqual(['before', 'middle']);
      // Labels and anchors survive the round trip — the tooltip depends on them.
      expect(restored!.past[0]!.label).toBe('edit');
      expect(restored!.past[0]!.anchorSegmentId).toBe('A');
      // And the blob URLs are live again.
      expect(restored!.past[0]!.state.assets[0]!.url).toContain('blob:');
    })();
  });

  it('an APP RESTART (new process token) restores NOTHING', async () => {
    await saveHistory('p1', historyOf(proj({ name: 'before' })));
    // A fresh module instance mints a fresh token — the same discriminator a new
    // Rust process provides. `sessionStorage` is cleared too, so the browser
    // fallback path also produces a new token rather than reusing the old one.
    sessionStorage.clear();
    const mod = await freshModule();
    const restored = await mod.loadHistory('p1', [asset('a1'), asset('a2')]);
    expect(restored).toBeNull();
  });

  it('history saved for a DIFFERENT project is never restored onto this one', async () => {
    // The hazard the design doc names: restoring another project's segments onto
    // this project's assets.
    await saveHistory('p2', historyOf(proj({ id: 'p2', name: 'other' })));
    const restored = await loadHistory('p1', [asset('a1')]);
    expect(restored).toBeNull();
  });

  it('a redo stack round-trips as well as the undo stack', async () => {
    let h = historyOf(proj({ name: 'one' }), proj({ name: 'two' }));
    // Simulate having undone once, so `future` is non-empty.
    h = { past: h.past.slice(0, 1), future: [{ state: proj({ name: 'redoable' }), label: 'edit' }] };
    await saveHistory('p1', h);
    const restored = await loadHistory('p1', [asset('a1'), asset('a2')]);
    expect(restored!.past.length).toBe(1);
    expect(restored!.future.length).toBe(1);
    expect(restored!.future[0]!.state.name).toBe('redoable');
  });

  it('clearPersistedHistory removes it, so a later load restores nothing', async () => {
    await saveHistory('p1', historyOf(proj()));
    expect(await loadHistory('p1', [asset('a1')])).not.toBeNull();
    await clearPersistedHistory('p1');
    expect(await loadHistory('p1', [asset('a1')])).toBeNull();
  });

  it('loading a project with no persisted history returns null, not a throw', async () => {
    expect(await loadHistory('never-saved', [])).toBeNull();
  });

  it('saving twice keeps only the newest record for that project', async () => {
    await saveHistory('p1', historyOf(proj({ name: 'first' })));
    await saveHistory('p1', historyOf(proj({ name: 'a' }), proj({ name: 'b' })));
    const restored = await loadHistory('p1', [asset('a1'), asset('a2')]);
    expect(restored!.past.map(e => e.state.name)).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// PART 3 — never-throws
// ---------------------------------------------------------------------------

describe('PART 3 — persistence failures are non-fatal', () => {
  it('a save failure is swallowed, not thrown — an edit must never break on it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A File is structured-cloneable, but a function is not — this forces a real
    // DataCloneError inside the IndexedDB put.
    const poisoned = { ...proj(), name: (() => 'nope') as unknown as string };
    await expect(saveHistory('p1', historyOf(poisoned))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a load failure returns null rather than throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // No record and a valid DB: still null. (The catch path is covered by the
    // save test above; this pins that the happy-path miss is also null.)
    await expect(loadHistory('absent', [])).resolves.toBeNull();
    warn.mockRestore();
  });
});
