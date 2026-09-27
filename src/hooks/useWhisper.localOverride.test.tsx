// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// U4 hotfix — real-pipeline composition of the local answer: a persisted
// one-run choice (exactly what the dialog writes) -> `hostForRun` (exactly
// what App.tsx's staging call computes) -> the REAL `useWhisper` hook -> the
// REAL `transcribeForHost` local arm. Only whisper.cpp itself and the Tauri
// IPC boundary are mocked. After a simulated reload (fresh module read of
// the store) the run still goes local, stamps `whisper` provenance, and never
// touches the gateway. Fails on dac689a (no persisted store existed).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Asset, Project, TranscriptionStatus } from '../types';
import { TransitionType, AnimationType } from '../types';
import type { UseWhisperApi } from './useWhisper';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a), Channel: class {} }));
const localWhisper = vi.fn();
vi.mock('../services/whisperService', async () => {
  const actual = await vi.importActual<typeof import('../services/whisperService')>('../services/whisperService');
  return { ...actual, transcribeWithProgress: (...a: unknown[]) => localWhisper(...a) };
});
vi.mock('../services/silenceDetector', () => ({
  detectSilences: vi.fn(async () => ({ status: 'ok' as const, silences: [] })),
  detectSilencesSingleFlight: vi.fn(async () => ({ status: 'ok' as const, silences: [] })),
}));

const HASH = 'f'.repeat(64);
const asset = (): Asset => ({ id: 'vo', name: 'vo20.m4a', url: 'blob:x', type: 'audio', file: new File(['b'], 'vo20.m4a') });
const project = (): Project => ({
  id: 'p1', name: 't', script: '', sceneDetails: '', segments: [], assets: [],
  globalTransition: TransitionType.NONE, globalTransitionDuration: 0.5, globalAnimation: AnimationType.NONE,
  globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'sans-serif' },
});

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  invokeMock.mockReset();
  localWhisper.mockReset();
  vi.resetModules();
});

describe('U4 hotfix — the local answer runs locally, before and after a reload', () => {
  it('a persisted local choice routes staging to whisper.cpp; provenance stamps whisper; the gateway is never called', async () => {
    // What the dialog's answer writes, in the session before the reload.
    const before = await import('../services/syncEngineHost');
    before.writeSyncEngineHost('cloud');
    before.saveRunHostOverride({ projectId: 'p1', audioHash: HASH, host: 'local', reason: 'offline' });

    // "Reload": every module re-imported; only localStorage survives.
    vi.resetModules();
    const host = await import('../services/syncEngineHost');
    const { useWhisper } = await import('./useWhisper');
    localWhisper.mockResolvedValue({ tokens: [{ text: 'hello', startSec: 0, endSec: 0.5 }], detectedLanguage: 'en' });

    let api: UseWhisperApi | null = null;
    let status: TranscriptionStatus = { phase: 'idle' };
    const container = document.createElement('div');
    let root: Root;
    function Probe(): null { api = useWhisper(); status = api.transcriptionStatus; return null; }
    act(() => { root = createRoot(container); root.render(<Probe />); });

    const runHost = host.hostForRun(host.readSyncEngineHost(), host.readRunHostOverride('p1'), { projectId: 'p1', audioHash: HASH });
    expect(runHost).toBe('local');
    let committed: Project | null = null;
    await act(async () => {
      await api!.startTranscription(asset(), 20, [], 'en', () => {}, u => { committed = u(project()); }, { audioHash: HASH, projectId: 'p1', host: runHost });
    });

    expect(localWhisper).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls.map(c => c[0]).filter(c => String(c).startsWith('cloud_'))).toEqual([]);
    expect(committed!.timingProvenance?.transcription?.engine).toBe('whisper');
    expect(committed!.transcriptTokens?.[0]?.text).toBe('hello');
    expect(status.phase).not.toBe('error');
    expect(host.readSyncEngineHost()).toBe('cloud');
    act(() => root.unmount());
  });

  it('with NO recorded choice the same staging goes to the cloud (the ask re-presents, as designed)', async () => {
    const host = await import('../services/syncEngineHost');
    host.writeSyncEngineHost('cloud');
    expect(host.hostForRun(host.readSyncEngineHost(), host.readRunHostOverride('p1'), { projectId: 'p1', audioHash: HASH })).toBe('cloud');
  });
});
