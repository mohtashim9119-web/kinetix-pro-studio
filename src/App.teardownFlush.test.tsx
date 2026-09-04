// @vitest-environment jsdom
//
// WS2 T4.6 — teardown persistence, asserted through App rather than in isolation.
//
// WHY THROUGH APP, following the same argument `App.appSettings.test.tsx` makes
// for itself: every claim here is a claim about WIRING. `teardownFlush.test.ts`
// already proves the budget primitive and `usePersistProject.saveNow.test.tsx`
// already proves the flush is genuinely awaitable — both would stay green
// against a build where NOTHING CALLS EITHER OF THEM. What is unproven until it
// is proven here is that Cmd+R actually waits, that the window-close listener is
// actually registered and actually holds the close, and that history rides along
// on the reload path but not on the close path.
//
// Same jsdom + react-dom/client + act + mock set as `App.projectSwitch.test.tsx`
// (no @testing-library in this repo).
//
// WHAT THIS FILE CANNOT REACH, stated plainly so a green run is not over-read:
//  - Cmd+Q. Not reachable from JS at all (macOS routes the predefined Quit item
//    to AppKit `terminate:`), which is the entire reason Commit 2 exists. Its
//    JS half is the `app-quit-requested` listener; its Rust half owns the budget
//    and is covered by `lib.rs`'s own `await_flush` tests. The two halves meeting
//    is MANUAL-ONLY.
//  - That a real write lands on a real disk. That is `projectStore`'s coverage
//    and the shell's.
//  - The actual OS close gesture. `onCloseRequested` is mocked here; that Tauri
//    delivers it for Cmd+W and the red button is manual.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Project, ProjectMeta } from './types';

const PROJECT_ID = 'teardown-project-id';

function meta(id: string, name: string): ProjectMeta {
  return { id, name, savedAt: Date.now(), segmentCount: 0 };
}

function storedProject(id: string, name: string): Project {
  return {
    id, name, script: '', segments: [], assets: [], headings: [], confirmed: true,
  } as unknown as Project;
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

const mockLoadProjectDetailed = vi.fn();
const mockGetAllAssetsForProject = vi.fn();
const mockLoadAllMetas = vi.fn();
const mockSaveProject = vi.fn();
const mockGetLastOpenedProjectId = vi.fn<() => string | null>();
const mockSaveHistory = vi.fn();

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
  return {
    ...actual,
    loadHistory: async () => null,
    clearPersistedHistory: async () => {},
    saveHistory: (...a: unknown[]) => mockSaveHistory(...a),
  };
});

// The window API the close-requested listener reaches for. `onCloseRequested`
// hands its handler back to the test so a close gesture can be simulated
// without an OS.
let closeHandler: ((e: { preventDefault: () => void }) => unknown) | null = null;
const mockDestroy = vi.fn(async () => {});
const mockUnlisten = vi.fn();
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy: mockDestroy,
    onCloseRequested: async (h: (e: { preventDefault: () => void }) => unknown) => {
      closeHandler = h;
      return mockUnlisten;
    },
  }),
}));

// The Cmd+Q path's JS half: Rust emits `app-quit-requested`, this side flushes
// and then reports back through the `quit_flush_complete` command. Both ends are
// captured here so the round trip can be driven without a Rust process.
let quitHandler: (() => unknown) | null = null;
const mockInvoke = vi.fn(async () => {});
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: () => unknown) => {
    if (name === 'app-quit-requested') quitHandler = h;
    return () => {};
  },
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => mockInvoke(...(a as [])),
}));

// Imported AFTER the mocks are registered.
const { default: App } = await import('./App');

let container: HTMLDivElement;
let root: Root;
let reloadSpy: ReturnType<typeof vi.fn>;

async function mountEditor(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await act(async () => { await Promise.resolve(); });
  // Land in the editor: the keydown handler and the close listener both live
  // there, and a dashboard-only mount would assert nothing.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

/** Fires the real Cmd+R chord at the real window listener App installs. */
async function pressReloadChord(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'r', code: 'KeyR', metaKey: true, bubbles: true, cancelable: true,
    }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  closeHandler = null;
  quitHandler = null;
  mockInvoke.mockResolvedValue(undefined);
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  mockLoadAllMetas.mockReturnValue([meta(PROJECT_ID, 'Teardown')]);
  mockSaveProject.mockResolvedValue({ ok: true });
  mockSaveHistory.mockResolvedValue(undefined);
  mockGetLastOpenedProjectId.mockReturnValue(PROJECT_ID);
  mockLoadProjectDetailed.mockResolvedValue({
    ok: true, project: storedProject(PROJECT_ID, 'Teardown'), savedAt: Date.now(),
  });
  mockGetAllAssetsForProject.mockResolvedValue([]);

  reloadSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadSpy },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('WS2 T4.6 — reload flush', () => {
  // THE CENTRAL CLAIM of the reload half. An edit made inside the 500 ms
  // autosave debounce is lost today; it must be written before the page dies.
  it('persists BEFORE reloading, and does not reload until the write lands', async () => {
    const write = deferred<{ ok: true }>();
    mockSaveProject.mockReturnValue(write.promise);

    await mountEditor();
    mockSaveProject.mockClear();

    await pressReloadChord();

    // Boundary 1: the flush has started and the page is still here.
    expect(mockSaveProject).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();

    // Boundary 2: the write lands — only now may the page go.
    await act(async () => { write.resolve({ ok: true }); await Promise.resolve(); });
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // The reload path is the ONE path that also flushes history, because a reload
  // is the one teardown where the process token survives to read it back.
  it('flushes undo history too, ahead of the 400 ms debounce', async () => {
    await mountEditor();
    mockSaveHistory.mockClear();

    await pressReloadChord();
    await act(async () => { await Promise.resolve(); });

    expect(mockSaveHistory).toHaveBeenCalledTimes(1);
    expect(mockSaveHistory.mock.calls[0]![0]).toBe(PROJECT_ID);
  });

  // THE HAZARD. A wedged write must cost the user at most the budget, never
  // their reload — a reload is often what they are reaching for BECAUSE
  // something is stuck.
  it('reloads anyway when the write never settles, after the 2 s budget', async () => {
    vi.useFakeTimers();
    try {
      mockSaveProject.mockReturnValue(new Promise(() => { /* never settles */ }));
      await mountEditor();
      await pressReloadChord();

      await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
      expect(reloadSpy).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reloads anyway when the write REJECTS', async () => {
    mockSaveProject.mockRejectedValue(new Error('bridge gone'));
    await mountEditor();

    await pressReloadChord();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

describe('WS2 T4.6 — window close flush (Cmd+W / red button)', () => {
  it('registers a close-requested listener', async () => {
    await mountEditor();
    expect(closeHandler).not.toBeNull();
  });

  it('holds the close, flushes, then destroys the window', async () => {
    const write = deferred<{ ok: true }>();
    mockSaveProject.mockReturnValue(write.promise);

    await mountEditor();
    mockSaveProject.mockClear();

    const preventDefault = vi.fn();
    let handled!: Promise<unknown>;
    await act(async () => { handled = Promise.resolve(closeHandler!({ preventDefault })); });

    // The native close must be held while the flush runs, or the whole thing is
    // decorative — the window would be gone before the write finished.
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mockSaveProject).toHaveBeenCalledTimes(1);
    expect(mockDestroy).not.toHaveBeenCalled();

    await act(async () => { write.resolve({ ok: true }); await handled; });
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  // The same unclosable-app hazard as the reload path, on the path a user hits
  // far more often.
  it('destroys the window anyway when the write never settles', async () => {
    vi.useFakeTimers();
    try {
      mockSaveProject.mockReturnValue(new Promise(() => {}));
      await mountEditor();

      let handled!: Promise<unknown>;
      await act(async () => {
        handled = Promise.resolve(closeHandler!({ preventDefault: vi.fn() }));
      });

      await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
      expect(mockDestroy).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(1); await handled; });
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys the window anyway when the write REJECTS', async () => {
    mockSaveProject.mockRejectedValue(new Error('bridge gone'));
    await mountEditor();

    await act(async () => { await closeHandler!({ preventDefault: vi.fn() }); });
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  // Undo history dies with the session (owner ruling, Q3). On a close the Rust
  // process ends, so a new `app_session_token` makes anything written here
  // unreadable by construction — writing it would spend teardown budget on bytes
  // nothing can load.
  it('does NOT flush undo history on close', async () => {
    await mountEditor();
    mockSaveHistory.mockClear();

    await act(async () => { await closeHandler!({ preventDefault: vi.fn() }); });
    expect(mockSaveHistory).not.toHaveBeenCalled();
  });

  // A second Cmd+W while the first flush is still running must not start a
  // second one, or the window can be left waiting on a queue of them.
  it('ignores a second close request while one is already flushing', async () => {
    mockSaveProject.mockReturnValue(new Promise(() => {}));
    await mountEditor();
    mockSaveProject.mockClear();

    await act(async () => { void closeHandler!({ preventDefault: vi.fn() }); });
    await act(async () => { void closeHandler!({ preventDefault: vi.fn() }); });

    expect(mockSaveProject).toHaveBeenCalledTimes(1);
  });
});

describe('WS2 T4.6 — Cmd+Q, the JS half of the deferred quit', () => {
  // Rust cannot know when to stop waiting unless this side answers. These tests
  // are about the ANSWER always being sent, never about the wait — the wait is
  // Rust's, and is covered by `lib.rs`'s `await_flush` tests.
  it('listens for the quit request Rust emits', async () => {
    await mountEditor();
    expect(quitHandler).not.toBeNull();
  });

  it('flushes, then reports completion back to Rust', async () => {
    const write = deferred<{ ok: true }>();
    mockSaveProject.mockReturnValue(write.promise);

    await mountEditor();
    mockSaveProject.mockClear();
    mockInvoke.mockClear();

    await act(async () => { void quitHandler!(); });
    expect(mockSaveProject).toHaveBeenCalledTimes(1);
    // Reporting before the write lands would defeat the whole mechanism.
    expect(mockInvoke).not.toHaveBeenCalledWith('quit_flush_complete');

    await act(async () => { write.resolve({ ok: true }); await Promise.resolve(); });
    expect(mockInvoke).toHaveBeenCalledWith('quit_flush_complete');
  });

  // THE HAZARD, on this side. A failed flush that stayed silent would cost the
  // user the full 2 s budget for a quit that could have happened at once.
  it('still reports completion when the flush REJECTS', async () => {
    mockSaveProject.mockRejectedValue(new Error('bridge gone'));
    await mountEditor();
    mockInvoke.mockClear();

    await act(async () => {
      await quitHandler!();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockInvoke).toHaveBeenCalledWith('quit_flush_complete');
  });

  // Undo history dies with the session (owner ruling, Q3) — the quit path uses
  // the same project-only flush the close path does.
  it('does NOT flush undo history on quit', async () => {
    await mountEditor();
    mockSaveHistory.mockClear();

    await act(async () => {
      await quitHandler!();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSaveHistory).not.toHaveBeenCalled();
  });
});
