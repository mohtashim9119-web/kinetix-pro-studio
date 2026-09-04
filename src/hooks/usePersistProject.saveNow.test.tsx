// @vitest-environment jsdom
//
// WS2 T4.6 — `saveNow()` is awaitable.
//
// WHY THIS FILE EXISTS SEPARATELY FROM `teardownFlush.test.ts`. That file proves
// the budget primitive in isolation. This one proves the OTHER half of the same
// claim, and the half that is easy to get subtly wrong: that the thing the
// teardown path awaits actually corresponds to the write landing. A `saveNow`
// that returns a promise resolving on the next microtask would satisfy every
// call site, pass a typecheck, and persist nothing — the `beforeunload` trap in
// a different costume, which is exactly what the owner named as the risk. So the
// central assertion below is NEGATIVE: the promise must still be pending while
// the write is pending.
//
// jsdom + `react-dom/client` + `act`, the same pattern as
// `App.projectSwitch.test.tsx` (no @testing-library in this repo). The hook is
// driven through a one-line probe component because that is the only way to get
// a real React render, and the wiring (refs, `enabled`, the debounce effect) is
// part of what is under test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Project } from '../types';

// ---------------------------------------------------------------------------
// projectStore is mocked so the test controls exactly when a write settles —
// the whole point here is the interval DURING which it has not.
// ---------------------------------------------------------------------------
const saveProjectMock = vi.fn<(p: Project) => Promise<{ ok: true } | { ok: false; reason: string; message: string }>>();
const upsertProjectMetaMock = vi.fn();

vi.mock('../services/projectStore', () => ({
  saveProject: (p: Project) => saveProjectMock(p),
  upsertProjectMeta: (m: unknown) => upsertProjectMetaMock(m),
}));

import { usePersistProject, type PersistHandle } from './usePersistProject';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    script: '',
    segments: [],
    assets: [],
    headings: [],
    confirmed: true,
    ...overrides,
  } as unknown as Project;
}

let container: HTMLDivElement;
let root: Root;
let handle: PersistHandle | null = null;

function Probe({ p, enabled }: { p: Project; enabled: boolean }): null {
  handle = usePersistProject(p, enabled);
  return null;
}

async function mount(p: Project, enabled = true): Promise<void> {
  await act(async () => {
    root.render(<Probe p={p} enabled={enabled} />);
  });
}

/** Lets pending microtasks drain without letting the test conclude prematurely. */
async function settleMicrotasks(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('usePersistProject — saveNow() awaitability (WS2 T4.6)', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    handle = null;
    saveProjectMock.mockReset();
    upsertProjectMetaMock.mockReset();
    // No image asset in these fixtures, so persistMeta's thumbnail path is a
    // no-op; it still runs, and is deliberately NOT awaited by saveNow.
    saveProjectMock.mockResolvedValue({ ok: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.restoreAllMocks();
  });

  it('returns a promise (not undefined)', async () => {
    await mount(project());
    let returned: unknown;
    await act(async () => { returned = handle!.saveNow(); await returned; });
    expect(returned).toBeInstanceOf(Promise);
  });

  // THE CENTRAL ASSERTION. If this passes with the promise resolving early, the
  // whole teardown feature is decorative.
  it('stays PENDING while the underlying write is in flight, and resolves when it lands', async () => {
    let releaseWrite!: () => void;
    saveProjectMock.mockImplementation(
      () => new Promise(resolve => { releaseWrite = () => resolve({ ok: true }); }),
    );

    await mount(project());

    let resolved = false;
    let promise!: Promise<void>;
    await act(async () => {
      promise = handle!.saveNow();
      void promise.then(() => { resolved = true; });
    });

    // The write has not settled, so neither may the flush.
    await settleMicrotasks();
    expect(saveProjectMock).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);

    await act(async () => { releaseWrite(); await promise; });
    expect(resolved).toBe(true);
  });

  // A teardown must not stall on a refused/failed write. The outcome is still
  // reported through `saveError` — resolving is not the same as succeeding.
  it('resolves (does not reject or hang) when the write is REFUSED', async () => {
    saveProjectMock.mockResolvedValue({
      ok: false, reason: 'empty-over-nonempty', message: 'refused',
    });
    await mount(project());
    await act(async () => { await expect(handle!.saveNow()).resolves.toBeUndefined(); });
    expect(handle!.saveError).not.toBeNull();
  });

  // The two early-return guards, probed one at a time — each must resolve
  // immediately AND must not have attempted a write.
  it('resolves immediately without writing when persistence is disabled (hydrating)', async () => {
    await mount(project(), /* enabled */ false);
    await act(async () => { await handle!.saveNow(); });
    expect(saveProjectMock).not.toHaveBeenCalled();
  });

  it('resolves immediately without writing when the project is unconfirmed', async () => {
    await mount(project({ confirmed: false } as Partial<Project>));
    await act(async () => { await handle!.saveNow(); });
    expect(saveProjectMock).not.toHaveBeenCalled();
  });

  // NORMAL SAVES UNAFFECTED — the debounced autosave still fires on its own 500 ms
  // timer and is still fire-and-forget. This is the regression guard for the
  // `runSave` signature change.
  it('leaves the debounced autosave behaviour unchanged', async () => {
    vi.useFakeTimers();
    try {
      await mount(project());
      expect(saveProjectMock).not.toHaveBeenCalled(); // first render never saves

      await mount(project({ name: 'Renamed' }));
      expect(saveProjectMock).not.toHaveBeenCalled(); // still inside the debounce

      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(saveProjectMock).toHaveBeenCalledTimes(1);
      expect(saveProjectMock.mock.calls[0]![0]!.name).toBe('Renamed');
    } finally {
      vi.useRealTimers();
    }
  });

  // The supersede guard predates this round; it must survive the refactor from
  // `.then()` to `async/await`, because a teardown flush racing the debounced
  // autosave is now a routine occurrence rather than a rare one.
  it('does not let a superseded in-flight save report its outcome', async () => {
    const releases: Array<() => void> = [];
    saveProjectMock.mockImplementation(
      () => new Promise(resolve => { releases.push(() => resolve({ ok: true })); }),
    );

    await mount(project());

    let firstDone = false;
    let secondDone = false;
    await act(async () => {
      void handle!.saveNow().then(() => { firstDone = true; });
      void handle!.saveNow().then(() => { secondDone = true; });
    });
    expect(releases).toHaveLength(2);

    // Land the FIRST (now superseded) write last-but-one; it must not stamp state.
    await act(async () => { releases[0]!(); await Promise.resolve(); });
    expect(firstDone).toBe(true); // it still settles — a teardown awaiting it is never stranded
    expect(handle!.lastSavedAt).toBeNull(); // but it did not write through

    await act(async () => { releases[1]!(); await Promise.resolve(); await Promise.resolve(); });
    expect(secondDone).toBe(true);
  });
});
