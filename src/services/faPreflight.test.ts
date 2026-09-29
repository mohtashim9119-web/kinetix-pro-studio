/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session M, Step 4 — the FA readiness PRE-FLIGHT's own contract:
// `runFaPreflight` folds the four readiness signals (capability, resolved
// language, native runtime load, model presence) into one verdict, up front,
// and NEVER throws — every not-ready condition is a structured result, not an
// exception. Each blocking path is exercised, not just the ready one.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
// isFaCapable() reads isTauri(); drive it directly so these tests don't depend
// on an ambient window shape.
vi.mock('./tauriFfmpeg', () => ({ isTauri: vi.fn(() => true) }));

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauriFfmpeg';
import { runFaPreflight, computeSyncEngineKey, resolveSyncEngine } from './faPreflight';
import { __resetFaCapabilityForTests } from './faGate';

const mockInvoke = invoke as unknown as Mock;
const mockIsTauri = isTauri as unknown as Mock;

const READY_REPORT = {
  featureCompiled: true,
  runtimeOk: true,
  runtimeDetail: 'onnxruntime loaded from /Applications/Kinetix.app/.../libonnxruntime.1.23.2.dylib',
  modelPresent: true,
  modelDetail: '/Users/x/Library/Application Support/com.kinetix.pro-studio/fa-models/en/model.onnx',
  language: 'en',
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockIsTauri.mockReset();
  mockIsTauri.mockReturnValue(true);
  __resetFaCapabilityForTests();
});

describe('runFaPreflight — readiness verdict, never throws', () => {
  it('reports ready when capable, language resolves, runtime loads and model present', async () => {
    mockInvoke.mockResolvedValue(READY_REPORT);
    const r = await runFaPreflight({ language: 'en' });
    expect(r.ready).toBe(true);
    expect(r.resolvedLanguage).toBe('en');
    expect(r.blockingDetail).toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith('fa_preflight', { language: 'en' });
  });

  it('uses detectedLanguage when the sticky language is unset (the auto-detect fix)', async () => {
    mockInvoke.mockResolvedValue({ ...READY_REPORT, language: 'es' });
    const r = await runFaPreflight({ language: undefined, detectedLanguage: 'es' });
    expect(r.ready).toBe(true);
    expect(r.resolvedLanguage).toBe('es');
    expect(mockInvoke).toHaveBeenCalledWith('fa_preflight', { language: 'es' });
  });

  it('is not ready and never calls the backend when not capable (plain browser)', async () => {
    mockIsTauri.mockReturnValue(false);
    __resetFaCapabilityForTests();
    const r = await runFaPreflight({ language: 'en' });
    expect(r.ready).toBe(false);
    expect(r.capable).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(r.fixHint).toBeTruthy();
  });

  it('is not ready with no backend call when no language resolves', async () => {
    const r = await runFaPreflight({ language: undefined, detectedLanguage: undefined });
    expect(r.ready).toBe(false);
    expect(r.languageSupported).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(r.blockingDetail).toContain('no language');
  });

  it('is not ready with no backend call for an unsupported resolved language', async () => {
    const r = await runFaPreflight({ language: 'ja' });
    expect(r.ready).toBe(false);
    expect(r.languageSupported).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(r.blockingDetail).toContain('ja');
  });

  it('surfaces the verbatim runtime error as the blocking cause when the runtime does not load', async () => {
    mockInvoke.mockResolvedValue({
      ...READY_REPORT,
      runtimeOk: false,
      runtimeDetail: 'failed to initialize onnxruntime: ORT_DYLIB_PATH not set',
    });
    const r = await runFaPreflight({ language: 'en' });
    expect(r.ready).toBe(false);
    expect(r.blockingDetail).toBe('failed to initialize onnxruntime: ORT_DYLIB_PATH not set');
  });

  it('reports the missing model as the blocking cause when the runtime loads but the model is absent', async () => {
    mockInvoke.mockResolvedValue({
      ...READY_REPORT,
      modelPresent: false,
      modelDetail: 'No FA model found for language "en". Tried: /a, /b.',
    });
    const r = await runFaPreflight({ language: 'en' });
    expect(r.ready).toBe(false);
    expect(r.blockingDetail).toContain('No FA model found');
  });

  it('does not throw when the backend probe itself rejects', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC channel closed'));
    const r = await runFaPreflight({ language: 'en' });
    expect(r.ready).toBe(false);
    expect(r.blockingDetail).toBe('IPC channel closed');
  });

  it('G6 Step 0a — says plainly the build was never compiled, never that forced alignment merely needs a retry', async () => {
    mockInvoke.mockResolvedValue({
      ...READY_REPORT,
      featureCompiled: false,
      runtimeOk: false,
      runtimeDetail: 'fa-inference feature not compiled',
    });
    const r = await runFaPreflight({ language: 'en' });
    expect(r.ready).toBe(false);
    expect(r.featureCompiled).toBe(false);
    expect(r.fixHint).toMatch(/isn't compiled into this build/i);
    expect(r.fixHint).toMatch(/tauri:dev:fa/i);
  });
});

// ---------------------------------------------------------------------------
// G2 close-out FIX 1 — `computeSyncEngineKey`, the "engine state" half of the
// honest-Apply-Sync spine (`spine.ts`'s `SyncSpine.engineKey`). OLD BUG this
// proves fixed: before FIX 1, `lastSyncSpine` carried only audioHash +
// scriptHash, so `spineEquals` reported "unchanged" (greying Apply Sync out)
// purely off content — flipping the FA toggle, or the FA pack finishing its
// download, after a sync changed NOTHING this key would have compared, so
// the button stayed stuck on "Already synced" with no way to re-run on the
// new engine short of editing the audio/script. `computeSyncEngineKey` is
// the value that closes that gap; `spine.test.ts` proves `spineEquals`
// actually consumes it.
// ---------------------------------------------------------------------------
describe('computeSyncEngineKey — the engine half of the honest-Apply-Sync spine', () => {
  it('is "whisper" when the FA gate is closed (toggle off), no backend call made', async () => {
    const key = await computeSyncEngineKey({ faHighPrecisionSync: false });
    expect(key).toBe('whisper');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('is "whisper" when FA-capable but the project never opted in (default off)', async () => {
    const key = await computeSyncEngineKey({ faHighPrecisionSync: undefined });
    expect(key).toBe('whisper');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('is "fa:ready" when the toggle is on and the pre-flight reports ready', async () => {
    mockInvoke.mockResolvedValue(READY_REPORT);
    const key = await computeSyncEngineKey({ faHighPrecisionSync: true, language: 'en' });
    expect(key).toBe('fa:ready');
  });

  it('is "fa:not-ready" when the toggle is on but the model pack is missing', async () => {
    mockInvoke.mockResolvedValue({ ...READY_REPORT, modelPresent: false, modelDetail: 'No FA model found for language "en".' });
    const key = await computeSyncEngineKey({ faHighPrecisionSync: true, language: 'en' });
    expect(key).toBe('fa:not-ready');
  });

  it('OLD BUG — toggling on turns a "whisper" key into a real "fa:*" key (was invisible to the spine before FIX 1)', async () => {
    const before = await computeSyncEngineKey({ faHighPrecisionSync: false });
    mockInvoke.mockResolvedValue(READY_REPORT);
    const after = await computeSyncEngineKey({ faHighPrecisionSync: true, language: 'en' });
    expect(before).not.toBe(after);
  });

  it('OLD BUG — the FA pack finishing its download flips "fa:not-ready" to "fa:ready" for the SAME toggle position', async () => {
    mockInvoke.mockResolvedValue({ ...READY_REPORT, modelPresent: false, modelDetail: 'No FA model found for language "en".' });
    const beforeDownload = await computeSyncEngineKey({ faHighPrecisionSync: true, language: 'en' });
    mockInvoke.mockResolvedValue(READY_REPORT);
    const afterDownload = await computeSyncEngineKey({ faHighPrecisionSync: true, language: 'en' });
    expect(beforeDownload).toBe('fa:not-ready');
    expect(afterDownload).toBe('fa:ready');
    expect(beforeDownload).not.toBe(afterDownload);
  });
});

// ---------------------------------------------------------------------------
// G3 Unit 1 — `resolveSyncEngine`, the single resolver `computeSyncEngineKey`
// now delegates to and Apply Sync gating (`App.tsx`) now calls directly
// instead of running its own `isFaGateOpenForProject` + `runFaPreflight`
// chain. Proves the wrapper relationship holds (its `.key` always equals
// what `computeSyncEngineKey` returns for the same input) and that the
// richer fields (`engine`/`gateOpen`/`ready`/`preflight`) carry the
// information Apply Sync gating and the Settings Sync tab need.
// ---------------------------------------------------------------------------
describe('resolveSyncEngine — the single toggle+pack+model resolver', () => {
  it('gate closed: engine "whisper", ready, no preflight, no backend call', async () => {
    const r = await resolveSyncEngine({ faHighPrecisionSync: false });
    expect(r).toEqual({ engine: 'whisper', gateOpen: false, ready: true, preflight: undefined, key: 'whisper', host: 'local' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('gate open + ready: engine "fa", gateOpen true, ready true, preflight populated', async () => {
    mockInvoke.mockResolvedValue(READY_REPORT);
    const r = await resolveSyncEngine({ faHighPrecisionSync: true, language: 'en' });
    expect(r.engine).toBe('fa');
    expect(r.gateOpen).toBe(true);
    expect(r.ready).toBe(true);
    expect(r.key).toBe('fa:ready');
    expect(r.preflight?.ready).toBe(true);
  });

  it('gate open + not ready: engine "fa", ready false, key "fa:not-ready"', async () => {
    mockInvoke.mockResolvedValue({ ...READY_REPORT, modelPresent: false, modelDetail: 'No FA model found for language "en".' });
    const r = await resolveSyncEngine({ faHighPrecisionSync: true, language: 'en' });
    expect(r.engine).toBe('fa');
    expect(r.gateOpen).toBe(true);
    expect(r.ready).toBe(false);
    expect(r.key).toBe('fa:not-ready');
  });

  it('`.key` always matches what computeSyncEngineKey returns for the same input (wrapper relationship)', async () => {
    for (const report of [READY_REPORT, { ...READY_REPORT, modelPresent: false, modelDetail: 'missing' }]) {
      mockInvoke.mockResolvedValue(report);
      const project = { faHighPrecisionSync: true, language: 'en' };
      const resolution = await resolveSyncEngine(project);
      const key = await computeSyncEngineKey(project);
      expect(resolution.key).toBe(key);
    }
  });
});
