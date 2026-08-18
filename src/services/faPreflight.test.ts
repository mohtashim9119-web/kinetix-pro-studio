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
import { runFaPreflight } from './faPreflight';
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
});
