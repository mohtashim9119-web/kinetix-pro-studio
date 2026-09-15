// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import React from 'react';

const getStorageRootStatus = vi.fn();
const relocateStorageRoot = vi.fn();
vi.mock('../services/storageRoot', () => ({
  getStorageRootStatus: (...args: unknown[]) => getStorageRootStatus(...args),
  relocateStorageRoot: (...args: unknown[]) => relocateStorageRoot(...args),
}));

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
  it('open() populates currentRoot/requiredBytes from getStorageRootStatus', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/Users/me/root', defaultRoot: '/Users/me/root', isDefault: true, managedBytes: 42 });
    await mount();
    await act(async () => { latest!.open(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(latest!.view).toEqual({
      currentRoot: '/Users/me/root',
      targetVolume: '',
      requiredBytes: 42,
      availableBytes: 0,
      validationState: 'error',
    });
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
    expect(latest!.view).toEqual({
      currentRoot: '/root',
      targetVolume: '/Volumes/Small',
      requiredBytes: 5_450_000_000,
      availableBytes: 120_000_000,
      validationState: 'insufficient',
    });
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
  });

  it('close() clears the view', async () => {
    getStorageRootStatus.mockResolvedValue({ currentRoot: '/root', defaultRoot: '/root', isDefault: true, managedBytes: 0 });
    await mount();
    await act(async () => { latest!.open(); await Promise.resolve(); });
    expect(latest!.view).not.toBeNull();
    await act(async () => { latest!.close(); });
    expect(latest!.view).toBeNull();
  });
});
