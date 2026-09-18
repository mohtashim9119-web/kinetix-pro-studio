// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import React from 'react';

const getStorageRootStatus = vi.fn();
const relocateStorageRoot = vi.fn();
const cancelStorageRootRelocation = vi.fn();
// Round 29 — the hook now imports `RELOCATION_CANCELLED_MESSAGE` and
// `cancelStorageRootRelocation` (D15's real mid-copy cancel support) in
// addition to the two exports this mock originally covered. A `vi.mock`
// factory must supply every named export the module under test imports —
// missing one throws lazily, the first time the hook code path that
// references it actually runs (this broke silently until `npm test` was
// run for the first time this round, at `useStorageRootRelocation.ts:304`).
vi.mock('../services/storageRoot', () => ({
  getStorageRootStatus: (...args: unknown[]) => getStorageRootStatus(...args),
  relocateStorageRoot: (...args: unknown[]) => relocateStorageRoot(...args),
  cancelStorageRootRelocation: (...args: unknown[]) => cancelStorageRootRelocation(...args),
  // A literal, not a reference to the `RELOCATION_CANCELLED_MESSAGE` const
  // below — `vi.mock` factories are hoisted above every top-level
  // declaration in this file, so referencing that const here throws
  // "Cannot access before initialization". Kept in sync with the real
  // module's own literal, which the hook imports as a named export.
  RELOCATION_CANCELLED_MESSAGE: 'relocation cancelled by operator',
}));

const RELOCATION_CANCELLED_MESSAGE = 'relocation cancelled by operator';

const relinkPickFolder = vi.fn();
vi.mock('../services/relinkNative', () => ({
  relinkPickFolder: (...args: unknown[]) => relinkPickFolder(...args),
}));

// No mock for '@tauri-apps/api/core' — same technique
// StorageSettingsSection.wrapperUsage.test.tsx already used: a raw
// invoke('relink_pick_folder') call would hit the real, unimplemented-
// outside-Tauri module and throw, so this proves the wrapper is used.

import { useStorageRootRelocation, type UseStorageRootRelocation } from './useStorageRootRelocation';

let container: HTMLDivElement;
let root: Root;
let latest: UseStorageRootRelocation | null = null;

function Harness({ onRelocated }: { onRelocated?: (to: string) => void }): React.ReactElement {
  latest = useStorageRootRelocation(onRelocated);
  return React.createElement('div');
}

// Round 29 — `view` grew several fields (`verifying`, `errorMessage`,
// `defaultRoot`, `isDefault`) since this file was first written. A helper
// keeps each test's expected object terse and lets it assert only the
// fields that test actually cares about, spread over these steady-state
// defaults, instead of every test hand-rolling the full shape.
function baseView(overrides: Partial<NonNullable<UseStorageRootRelocation['view']>>) {
  return {
    currentRoot: '',
    targetVolume: '',
    requiredBytes: 0,
    availableBytes: 0,
    validationState: 'error' as const,
    copying: false,
    cancelling: false,
    progress: null,
    verifying: false,
    errorMessage: null,
    defaultRoot: '',
    isDefault: false,
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  latest = null;
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(onRelocated?: (to: string) => void): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Harness, { onRelocated }));
  });
}

describe('useStorageRootRelocation', () => {
  it('open() populates currentRoot/requiredBytes/defaultRoot/isDefault from getStorageRootStatus', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/Users/me/root', defaultRoot: '/Users/me/root', isDefault: true, managedBytes: 42 });
    await mount();
    await act(async () => { latest!.open(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(latest!.view).toEqual(baseView({
      currentRoot: '/Users/me/root',
      requiredBytes: 42,
      defaultRoot: '/Users/me/root',
      isDefault: true,
    }));
  });

  it('chooseFolder() routes through the relinkPickFolder wrapper, not a raw invoke', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/root', defaultRoot: '/root', isDefault: true, managedBytes: 0 });
    relinkPickFolder.mockResolvedValue(null); // operator cancelled the picker
    await mount();
    await act(async () => { latest!.open(); await Promise.resolve(); });
    await act(async () => { latest!.chooseFolder(); await Promise.resolve(); });
    expect(relinkPickFolder).toHaveBeenCalledTimes(1);
    expect(relocateStorageRoot).not.toHaveBeenCalled();
  });

  it('a successful relocate clears the view and calls onRelocated with the new root', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/root', defaultRoot: '/root', isDefault: true, managedBytes: 100 });
    relinkPickFolder.mockResolvedValue('/Volumes/Media');
    relocateStorageRoot.mockResolvedValue({ from: '/root', to: '/Volumes/Media', moved: ['assets'], bytesMoved: 100, cleanupWarnings: [] });
    const onRelocated = vi.fn();
    await mount(onRelocated);
    await act(async () => { latest!.open(); await Promise.resolve(); });
    await act(async () => { latest!.chooseFolder(); await Promise.resolve(); await Promise.resolve(); });
    expect(latest!.view).toBeNull();
    expect(onRelocated).toHaveBeenCalledWith('/Volumes/Media');
  });

  it('insufficient-space rejection keeps the view open with parsed required/available bytes', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/root', defaultRoot: '/root', isDefault: true, managedBytes: 100 });
    relinkPickFolder.mockResolvedValue('/Volumes/Small');
    relocateStorageRoot.mockRejectedValue(
      new Error('not enough free space: needs about 5450000000 bytes, 120000000 available at /Volumes/Small'),
    );
    await mount();
    await act(async () => { latest!.open(); await Promise.resolve(); });
    await act(async () => { latest!.chooseFolder(); await Promise.resolve(); await Promise.resolve(); });
    expect(latest!.view).toEqual(baseView({
      currentRoot: '/root',
      targetVolume: '/Volumes/Small',
      requiredBytes: 5_450_000_000,
      availableBytes: 120_000_000,
      validationState: 'insufficient',
      defaultRoot: '/root',
      isDefault: true,
    }));
  });

  it('an unparseable refusal keeps the view open as validationState error, never crashes', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/root', defaultRoot: '/root', isDefault: true, managedBytes: 100 });
    relinkPickFolder.mockResolvedValue('/Volumes/Weird');
    relocateStorageRoot.mockRejectedValue(new Error('cannot canonicalize /Volumes/Weird: no such file'));
    await mount();
    await act(async () => { latest!.open(); await Promise.resolve(); });
    await act(async () => { latest!.chooseFolder(); await Promise.resolve(); await Promise.resolve(); });
    expect(latest!.view?.validationState).toBe('error');
    expect(latest!.view?.targetVolume).toBe('/Volumes/Weird');
    expect(latest!.view?.errorMessage).toBe('cannot canonicalize /Volumes/Weird: no such file');
  });

  it('close() clears the view', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/root', defaultRoot: '/root', isDefault: true, managedBytes: 0 });
    await mount();
    await act(async () => { latest!.open(); await Promise.resolve(); });
    expect(latest!.view).not.toBeNull();
    await act(async () => { latest!.close(); });
    expect(latest!.view).toBeNull();
  });

  // Round 28 Increment 1 — cancel affordance, pre-copy.
  it('cancel() before any copy starts dismisses the modal, initiating no copy and committing nothing', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/root', defaultRoot: '/root', isDefault: true, managedBytes: 0 });
    await mount();
    await act(async () => { latest!.open(); await Promise.resolve(); });
    expect(latest!.view).not.toBeNull();
    expect(latest!.view!.copying).toBe(false);

    await act(async () => { latest!.cancel(); });

    expect(latest!.view).toBeNull();
    expect(relinkPickFolder).not.toHaveBeenCalled();
    expect(relocateStorageRoot).not.toHaveBeenCalled();
    expect(cancelStorageRootRelocation).not.toHaveBeenCalled();
  });

  it('chooseFolder() sets copying:true for the span of the relocate call', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/root', defaultRoot: '/root', isDefault: true, managedBytes: 100 });
    relinkPickFolder.mockResolvedValue('/Volumes/Media');
    let resolveRelocate!: (v: unknown) => void;
    relocateStorageRoot.mockReturnValue(new Promise((resolve) => { resolveRelocate = resolve; }));
    await mount();
    await act(async () => { latest!.open(); await Promise.resolve(); });
    await act(async () => { latest!.chooseFolder(); await Promise.resolve(); await Promise.resolve(); });

    expect(latest!.view!.copying).toBe(true);

    await act(async () => {
      resolveRelocate({ from: '/root', to: '/Volumes/Media', moved: [], bytesMoved: 0, cleanupWarnings: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest!.view).toBeNull();
  });

  // D15 follow-up (WS3 Round 29) — Cancel while copying now genuinely signals
  // the native cancel command (real mid-copy cancellation, not the old
  // no-abort-channel refusal) and sets `cancelling`, but the modal itself
  // only closes once the in-flight `relocateStorageRoot` call actually
  // rejects — never optimistically. Simplified UI fix (WS3 Round 29): the
  // relocation modal now hides "Choose folder"/"Reset to default location"
  // while `copying` is true, independent of this behavior.
  it('cancel() while copying signals the native cancel and sets cancelling, but the view stays open until the call rejects', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/root', defaultRoot: '/root', isDefault: true, managedBytes: 100 });
    relinkPickFolder.mockResolvedValue('/Volumes/Media');
    cancelStorageRootRelocation.mockResolvedValue(undefined);
    let rejectRelocate!: (e: unknown) => void;
    relocateStorageRoot.mockReturnValue(new Promise((_resolve, reject) => { rejectRelocate = reject; }));
    await mount();
    await act(async () => { latest!.open(); await Promise.resolve(); });
    await act(async () => { latest!.chooseFolder(); await Promise.resolve(); await Promise.resolve(); });
    expect(latest!.view!.copying).toBe(true);

    await act(async () => { latest!.cancel(); });
    expect(cancelStorageRootRelocation).toHaveBeenCalledTimes(1);
    expect(latest!.view).not.toBeNull();
    expect(latest!.view!.copying).toBe(true);
    expect(latest!.view!.cancelling).toBe(true);

    // A second cancel click while already cancelling must not re-signal.
    await act(async () => { latest!.cancel(); });
    expect(cancelStorageRootRelocation).toHaveBeenCalledTimes(1);

    // The native call settles by rejecting with the cancellation message —
    // a clean dismiss, not an error state.
    await act(async () => {
      rejectRelocate(new Error(RELOCATION_CANCELLED_MESSAGE));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest!.view).toBeNull();
  });

  // Background-continuation fix (WS3 Round 29, operator decision) — `dismiss`
  // (the X button / Escape) is distinct from `cancel`: it only hides the
  // modal while a copy is in flight, never touches the native call, and the
  // relocation keeps running and keeps updating `session` even while nothing
  // is rendered — the next `open()` picks it back up live.
  it('dismiss() while copying hides the modal without cancelling; open() resumes the same live session', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/root', defaultRoot: '/root', isDefault: true, managedBytes: 100 });
    relinkPickFolder.mockResolvedValue('/Volumes/Media');
    let emitProgress!: (event: { event: string; data?: unknown }) => void;
    let resolveRelocate!: (v: unknown) => void;
    relocateStorageRoot.mockImplementation((_picked: string, onEvent: (e: { event: string; data?: unknown }) => void) => {
      emitProgress = onEvent;
      return new Promise((resolve) => { resolveRelocate = resolve; });
    });
    await mount();
    await act(async () => { latest!.open(); await Promise.resolve(); });
    await act(async () => { latest!.chooseFolder(); await Promise.resolve(); await Promise.resolve(); });
    expect(latest!.view!.copying).toBe(true);

    await act(async () => { latest!.dismiss(); });
    expect(latest!.view).toBeNull();
    expect(cancelStorageRootRelocation).not.toHaveBeenCalled();
    expect(relocateStorageRoot).toHaveBeenCalledTimes(1);

    // The relocation keeps running and keeps updating state while hidden.
    await act(async () => {
      emitProgress({ event: 'Progress', data: { bytesDone: 50, bytesTotal: 100 } });
      await Promise.resolve();
    });

    // Re-opening picks the SAME session back up, live, and never starts a
    // second relocate call — `open()` does re-fetch status (harmless), but
    // must NOT apply it on top of an in-flight session: prove that by
    // having this second fetch return a DIFFERENT root and confirming the
    // live session's own `currentRoot` (from before dismiss) wins.
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/somewhere/else', defaultRoot: '/root', isDefault: false, managedBytes: 999 });
    await act(async () => { latest!.open(); await Promise.resolve(); await Promise.resolve(); });
    expect(latest!.view!.copying).toBe(true);
    expect(latest!.view!.progress).toEqual({ bytesDone: 50, bytesTotal: 100 });
    expect(latest!.view!.currentRoot).toBe('/root');
    expect(relocateStorageRoot).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRelocate({ from: '/root', to: '/Volumes/Media', moved: ['assets'], bytesMoved: 100, cleanupWarnings: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest!.view).toBeNull();
  });

  // "Reset to default location" fix (WS3 Round 29, approved) — relocates
  // straight to `defaultRoot` with no folder picker, and is a no-op when
  // already at default, when `defaultRoot` hasn't loaded, or mid-copy.
  it('resetToDefault() relocates to defaultRoot without a folder picker', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/custom/root', defaultRoot: '/os/default', isDefault: false, managedBytes: 100 });
    relocateStorageRoot.mockResolvedValue({ from: '/custom/root', to: '/os/default', moved: ['assets'], bytesMoved: 100, cleanupWarnings: [] });
    const onRelocated = vi.fn();
    await mount(onRelocated);
    await act(async () => { latest!.open(); await Promise.resolve(); await Promise.resolve(); });
    expect(latest!.view!.isDefault).toBe(false);

    await act(async () => { latest!.resetToDefault(); await Promise.resolve(); await Promise.resolve(); });

    expect(relinkPickFolder).not.toHaveBeenCalled();
    expect(relocateStorageRoot).toHaveBeenCalledWith('/os/default', expect.any(Function));
    expect(onRelocated).toHaveBeenCalledWith('/os/default');
  });

  it('resetToDefault() is a no-op when currentRoot already IS defaultRoot', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/os/default', defaultRoot: '/os/default', isDefault: true, managedBytes: 100 });
    await mount();
    await act(async () => { latest!.open(); await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { latest!.resetToDefault(); });

    expect(relocateStorageRoot).not.toHaveBeenCalled();
  });
});
