// @vitest-environment jsdom
/**
 * Wave 3 U1 — the cloud-key row: save goes to Rust and then tests the
 * connection; the key is never echoed back; typed failures read as sentences.
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/tauriFfmpeg', () => ({ isTauri: () => true }));

const status = vi.fn();
const setKey = vi.fn();
const clearKey = vi.fn();
const ping = vi.fn();
vi.mock('../services/cloudGateway', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/cloudGateway')>();
  return {
    ...real,
    cloudKeyStatus: () => status(),
    cloudKeySet: (k: string) => setKey(k),
    cloudKeyClear: () => clearKey(),
    cloudPing: () => ping(),
  };
});

import { CloudSyncSection } from './CloudSyncSection';
import { readSyncEngineHost, writeSyncEngineHost } from '../services/syncEngineHost';

const PING = { member: 'operator', schema: 1, engines: { transcribe: 't', align: 'a' }, limits: { maxAudioSec: 3600, maxUploadBytes: 1 }, latencyMs: 312 };

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('CloudSyncSection', () => {
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

  const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

  it('no key: shows the input; saving stores the key, clears the field, and shows the member', async () => {
    status.mockResolvedValue({ configured: false, gateway: 'g' });
    setKey.mockResolvedValue({ configured: true, gateway: 'g' });
    ping.mockResolvedValue(PING);
    await act(async () => { root.render(<CloudSyncSection />); });
    const input = q('cloud-sync-key-input') as HTMLInputElement;
    expect(input.type).toBe('password');
    await act(async () => { typeInto(input, 'kx_secret_value_1234567890'); });
    await act(async () => { (q('cloud-sync-key-save') as HTMLButtonElement).click(); });
    expect(setKey).toHaveBeenCalledWith('kx_secret_value_1234567890');
    expect(q('cloud-sync-connected')?.textContent).toContain('Connected as operator');
    expect(container.textContent).not.toContain('kx_secret_value_1234567890');
  });

  it('a stored key is tested on open; an auth refusal reads as a sentence, with Remove key available', async () => {
    status.mockResolvedValue({ configured: true, gateway: 'g' });
    ping.mockRejectedValue({ kind: 'auth' });
    clearKey.mockResolvedValue({ configured: false, gateway: 'g' });
    await act(async () => { root.render(<CloudSyncSection />); });
    expect(q('cloud-sync-error')?.textContent).toBe('The cloud sync server did not accept this key.');
    await act(async () => { (q('cloud-sync-key-remove') as HTMLButtonElement).click(); });
    expect(clearKey).toHaveBeenCalled();
    expect(q('cloud-sync-key-input')).toBeTruthy();
  });

  it('a malformed key stays on the input row with the reason', async () => {
    status.mockResolvedValue({ configured: false, gateway: 'g' });
    setKey.mockRejectedValue({ kind: 'rejected', status: 0, code: 'bad-key-format', detail: 'that is not a Kinetix cloud key (they start with kx_)' });
    await act(async () => { root.render(<CloudSyncSection />); });
    await act(async () => { typeInto(q('cloud-sync-key-input') as HTMLInputElement, 'nope'); });
    await act(async () => { (q('cloud-sync-key-save') as HTMLButtonElement).click(); });
    expect(ping).not.toHaveBeenCalled();
    expect(q('cloud-sync-error')?.textContent).toContain('start with kx_');
    expect(q('cloud-sync-key-input')).toBeTruthy();
  });

  it('Wave 3 U2 interim switch: only once connected; persists Cloud; removing the key falls back to Local', async () => {
    localStorage.clear();
    status.mockResolvedValue({ configured: true, gateway: 'g' });
    ping.mockResolvedValue(PING);
    clearKey.mockResolvedValue({ configured: false, gateway: 'g' });
    await act(async () => { root.render(<CloudSyncSection />); });
    const toggle = q('cloud-sync-host-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await act(async () => { toggle.click(); });
    expect(readSyncEngineHost()).toBe('cloud');
    expect((q('cloud-sync-host-toggle') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    await act(async () => { (q('cloud-sync-key-remove') as HTMLButtonElement).click(); });
    expect(readSyncEngineHost()).toBe('local');
    expect(q('cloud-sync-host-toggle')).toBeNull();
    writeSyncEngineHost('local');
  });
});
