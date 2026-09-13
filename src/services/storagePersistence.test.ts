/**
 * WS3 item D — requesting durable storage and recording what came back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));

import { invoke } from '@tauri-apps/api/core';
import {
  requestStoragePersistence,
  getStoragePersistenceResult,
  __resetStoragePersistenceForTests,
} from './storagePersistence';

const mockInvoke = invoke as unknown as Mock;
const originalStorage = navigator.storage;

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
  __resetStoragePersistenceForTests();
});
afterEach(() => {
  Object.defineProperty(navigator, 'storage', { value: originalStorage, configurable: true });
});

describe('requestStoragePersistence', () => {
  it('records supported:true, persisted:true when the browser grants it', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { persist: vi.fn().mockResolvedValue(true) },
      configurable: true,
    });

    const result = await requestStoragePersistence();

    expect(result.supported).toBe(true);
    expect(result.persisted).toBe(true);
    expect(result.error).toBeUndefined();
    expect(getStoragePersistenceResult()).toEqual(result);
    expect(mockInvoke).toHaveBeenCalledWith('log_storage_persistence', { supported: true, persisted: true });
  });

  it('records a refusal without throwing — persisted:false is a normal outcome, not an error', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { persist: vi.fn().mockResolvedValue(false) },
      configurable: true,
    });

    const result = await requestStoragePersistence();

    expect(result.supported).toBe(true);
    expect(result.persisted).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('log_storage_persistence', { supported: true, persisted: false });
  });

  it('reports supported:false when the API does not exist in this WebView, without ever calling it', async () => {
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });

    const result = await requestStoragePersistence();

    expect(result.supported).toBe(false);
    expect(result.persisted).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('log_storage_persistence', { supported: false, persisted: false });
  });

  it('never throws even if the API itself throws — the throw is recorded, not propagated', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { persist: vi.fn().mockRejectedValue(new Error('permission policy blocked')) },
      configurable: true,
    });

    const result = await requestStoragePersistence();

    expect(result.supported).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.error).toMatch(/permission policy blocked/);
  });

  it('never throws even if the native logging call itself fails', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { persist: vi.fn().mockResolvedValue(true) },
      configurable: true,
    });
    mockInvoke.mockRejectedValue(new Error('ipc unavailable'));

    await expect(requestStoragePersistence()).resolves.toMatchObject({ persisted: true });
  });
});
