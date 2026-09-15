// @vitest-environment jsdom
/**
 * Q3 (Round 28 quick-close batch), updated for WS3 Batch 2 (STEP 3, 3A):
 * "Move storage root…" no longer picks a folder or relocates inline — it
 * hands off to the parent via `onOpenRelocation`, which mounts
 * `StorageRootRelocationView` at the App.tsx level. The original guarantee
 * this test protected (folder picking goes through the typed
 * `relinkPickFolder()` wrapper, never a raw `invoke('relink_pick_folder')`)
 * now lives in `useStorageRootRelocation.test.tsx`, which uses the exact
 * same technique (no mock for '@tauri-apps/api/core', so a raw invoke call
 * would throw). This file now only pins that the button calls the callback
 * prop and does nothing else itself.
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/tauriFfmpeg', () => ({
  isTauri: () => true,
}));

vi.mock('../services/storageRoot', () => ({
  getStorageRootStatus: vi.fn().mockResolvedValue({ currentRoot: '/root', defaultRoot: '/root', isDefault: true, managedBytes: 0 }),
  getSizeReport: vi.fn().mockResolvedValue([]),
}));

import { StorageSettingsSection } from './StorageSettingsSection';

describe('StorageSettingsSection — Q3 wrapper usage (updated for 3A hand-off)', () => {
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

  it('"Move storage root…" calls onOpenRelocation and does no folder-picking itself', async () => {
    const onOpenRelocation = vi.fn();
    await act(async () => {
      root.render(<StorageSettingsSection onOpenRelocation={onOpenRelocation} />);
    });
    const button = container.querySelector<HTMLButtonElement>('[data-testid="storage-relocate-open"]');
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    expect(onOpenRelocation).toHaveBeenCalledTimes(1);
  });
});
