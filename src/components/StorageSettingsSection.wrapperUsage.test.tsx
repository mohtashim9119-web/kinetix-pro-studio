// @vitest-environment jsdom
/**
 * Q3 (Round 28 quick-close batch): the "Relocate" button used to call
 * `invoke('relink_pick_folder')` directly instead of going through the
 * typed `relinkPickFolder()` wrapper in `services/relinkNative.ts`. This
 * pins that it now goes through the wrapper — the raw `invoke` mock is
 * left unset so a direct `invoke('relink_pick_folder')` call would throw.
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/tauriFfmpeg', () => ({
  isTauri: () => true,
}));

vi.mock('../services/storageRoot', () => ({
  getStorageRootStatus: vi.fn().mockResolvedValue({ path: '/root', isDefault: true }),
  getSizeReport: vi.fn().mockResolvedValue([]),
  relocateStorageRoot: vi.fn().mockResolvedValue(undefined),
}));

const relinkPickFolder = vi.fn().mockResolvedValue(null);
vi.mock('../services/relinkNative', () => ({
  relinkPickFolder: (...args: unknown[]) => relinkPickFolder(...args),
}));

// No mock for '@tauri-apps/api/core' — a direct invoke('relink_pick_folder')
// call would hit the real (unimplemented-outside-Tauri) module and throw.

import { StorageSettingsSection } from './StorageSettingsSection';

describe('StorageSettingsSection — Q3 wrapper usage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('routes the folder pick through relinkPickFolder(), not a raw invoke call', async () => {
    await act(async () => {
      root.render(<StorageSettingsSection />);
    });
    const button = container.querySelector<HTMLButtonElement>('[data-testid="storage-relocate-open"]');
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });
    expect(relinkPickFolder).toHaveBeenCalledTimes(1);
  });
});
