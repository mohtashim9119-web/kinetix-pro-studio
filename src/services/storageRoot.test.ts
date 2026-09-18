/**
 * WS3 items C+H — the storage root / size report TS client. Pins the IPC
 * command names and argument shapes so Cursor's three consumers (the
 * relocation view's byte props, the size report, the relocate action) wire
 * mechanically against this module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// D18 fix (WS3 Round 29) — `relocateStorageRoot` now opens a real
// `Channel<RelocationEvent>` (live copy-progress IPC) alongside `invoke`, so
// the mock must supply a minimal but functioning `Channel` too — a bare
// class with the one property (`onmessage`) the service assigns is enough;
// nothing in these tests actually needs it to deliver an event.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((event: unknown) => void) | undefined;
  },
}));
vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));

import { invoke } from '@tauri-apps/api/core';
import { getStorageRootStatus, relocateStorageRoot, getSizeReport } from './storageRoot';

const mockInvoke = invoke as unknown as Mock;

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('getStorageRootStatus', () => {
  it('calls storage_root_status with no args and returns it verbatim', async () => {
    const status = { currentRoot: '/a', defaultRoot: '/a', isDefault: true, managedBytes: 1024 };
    mockInvoke.mockResolvedValueOnce(status);
    const result = await getStorageRootStatus();
    expect(mockInvoke).toHaveBeenCalledWith('storage_root_status');
    expect(result).toEqual(status);
  });
});

describe('relocateStorageRoot', () => {
  it('passes newRoot through and returns the report', async () => {
    const report = { from: '/a', to: '/b', moved: ['assets', 'projects'], bytesMoved: 500 };
    mockInvoke.mockResolvedValueOnce(report);
    const result = await relocateStorageRoot('/b');
    expect(mockInvoke).toHaveBeenCalledWith('storage_root_relocate', { newRoot: '/b', onEvent: expect.anything() });
    expect(result).toEqual(report);
  });

  it('propagates a refusal as a rejection — never swallowed', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('not enough free space'));
    await expect(relocateStorageRoot('/b')).rejects.toThrow('not enough free space');
  });
});

describe('getSizeReport', () => {
  it('calls size_report with no args and returns the rows verbatim', async () => {
    const rows = [
      { path: '/a/assets', label: 'Project assets', currentBytes: 100, reclaimableBytes: 0, sweepClassification: 'never-reclaimable' },
      { path: '/a/cache', label: 'Cache', currentBytes: 50, reclaimableBytes: 50, sweepClassification: 'reclaimable' },
    ];
    mockInvoke.mockResolvedValueOnce(rows);
    const result = await getSizeReport();
    expect(mockInvoke).toHaveBeenCalledWith('size_report');
    expect(result).toEqual(rows);
  });
});

describe('outside Tauri', () => {
  it('every function throws rather than silently no-op-ing', async () => {
    vi.doMock('./tauriFfmpeg', () => ({ isTauri: () => false }));
    vi.resetModules();
    const outside = await import('./storageRoot');
    await expect(outside.getStorageRootStatus()).rejects.toThrow();
    await expect(outside.getSizeReport()).rejects.toThrow();
    await expect(outside.relocateStorageRoot('/x')).rejects.toThrow();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
