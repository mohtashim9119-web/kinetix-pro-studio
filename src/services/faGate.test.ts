/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isFaCapable,
  __resetFaCapabilityForTests,
  isFaToggleOn,
  setFaToggle,
  isFaGateOpen,
} from './faGate';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage);
}

describe('isFaCapable', () => {
  beforeEach(() => {
    __resetFaCapabilityForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetFaCapabilityForTests();
  });

  it('returns false when window is unavailable (non-browser runtime)', () => {
    vi.stubGlobal('window', undefined);
    expect(isFaCapable()).toBe(false);
  });

  it('returns false when window exists but has no __TAURI_INTERNALS__ (plain `npm run dev`)', () => {
    vi.stubGlobal('window', {});
    expect(isFaCapable()).toBe(false);
  });

  it('returns true when __TAURI_INTERNALS__ is present (tauri:dev / built app)', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isFaCapable()).toBe(true);
  });

  it('memoizes the result — a second call does not re-probe', () => {
    vi.stubGlobal('window', {});
    expect(isFaCapable()).toBe(false);
    // Change the stub after the first (memoized) call — if the function
    // re-probed, this would now see __TAURI_INTERNALS__ and return true.
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isFaCapable()).toBe(false);
  });
});

describe('isFaToggleOn / setFaToggle', () => {
  beforeEach(() => {
    installLocalStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to OFF when nothing has been persisted (owner ruling D2)', () => {
    expect(isFaToggleOn()).toBe(false);
  });

  it('persists true/false through setFaToggle and reads it back', () => {
    setFaToggle(true);
    expect(isFaToggleOn()).toBe(true);
    setFaToggle(false);
    expect(isFaToggleOn()).toBe(false);
  });

  it('returns false (not throw) when localStorage is unavailable', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', undefined);
    expect(isFaToggleOn()).toBe(false);
  });
});

describe('isFaGateOpen', () => {
  beforeEach(() => {
    installLocalStorage();
    __resetFaCapabilityForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetFaCapabilityForTests();
  });

  it('defaults closed on a fresh profile (both capability and toggle absent)', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isFaGateOpen()).toBe(false);
  });

  it('stays closed when the toggle is on but the runtime is incapable', () => {
    vi.stubGlobal('window', {});
    setFaToggle(true);
    expect(isFaGateOpen()).toBe(false);
  });

  it('stays closed when the runtime is capable but the toggle is off', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    setFaToggle(false);
    expect(isFaGateOpen()).toBe(false);
  });

  it('opens only when both capability and toggle are true', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    setFaToggle(true);
    expect(isFaGateOpen()).toBe(true);
  });
});
