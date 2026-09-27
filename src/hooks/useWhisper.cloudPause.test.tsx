// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U4 — staging transcription on the cloud: a failure past its one
// retry becomes a typed PAUSE status (drives CloudTranscriptionPausedDialog),
// and a one-run host override reaches the engine seam without touching the
// standing Cloud/Local choice. Real hook; only the engine seam is mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { Asset, TranscriptionStatus } from '../types';
import type { UseWhisperApi } from './useWhisper';

const mockTranscribeForHost = vi.fn();
vi.mock('../services/cloudSyncEngine', async () => {
  const actual = await vi.importActual<typeof import('../services/cloudSyncEngine')>('../services/cloudSyncEngine');
  return { ...actual, transcribeForHost: (...args: unknown[]) => mockTranscribeForHost(...args) };
});
vi.mock('../services/silenceDetector', () => ({
  detectSilences: vi.fn(async () => ({ status: 'ok' as const, silences: [] })),
  detectSilencesSingleFlight: vi.fn(async () => ({ status: 'ok' as const, silences: [] })),
}));

const { useWhisper } = await import('./useWhisper');
const { CloudStageError } = await import('../services/cloudSyncEngine');
const { SYNC_ENGINE_HOST_KEY, readSyncEngineHost, writeSyncEngineHost } = await import('../services/syncEngineHost');

const HASH = 'e'.repeat(64);
const asset = (): Asset => ({
  id: 'vo', name: 'vo.mp3', url: 'blob:x', type: 'audio',
  file: new File(['bytes'], 'vo.mp3', { type: 'audio/mpeg' }),
});

function mount(): { api: () => UseWhisperApi; status: () => TranscriptionStatus } {
  let latest: UseWhisperApi | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  function Probe(): null { latest = useWhisper(); return null; }
  act(() => { root = createRoot(container); root.render(<Probe />); });
  return { api: () => latest!, status: () => latest!.transcriptionStatus };
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mockTranscribeForHost.mockReset();
  localStorage.clear();
});

describe('useWhisper — Wave 3 U4 cloud pause', () => {
  it('an offline cloud failure is a PAUSE status (cloudReason), not a model-failure kind', async () => {
    writeSyncEngineHost('cloud');
    mockTranscribeForHost.mockRejectedValue(new CloudStageError({ kind: 'unreachable', detail: 'dns' }, 'Cloud transcription failed: the sync server could not be reached.'));
    const h = mount();
    await act(async () => {
      await h.api().startTranscription(asset(), 30, [], 'en', () => {}, () => {}, { audioHash: HASH, projectId: 'p1' });
    });
    const s = h.status();
    expect(s.phase).toBe('error');
    if (s.phase !== 'error') return;
    expect(s.cloudReason).toBe('offline');
    expect(s.kind).toBeUndefined();
  });

  it('a refused key pauses as cloud-auth', async () => {
    writeSyncEngineHost('cloud');
    mockTranscribeForHost.mockRejectedValue(new CloudStageError({ kind: 'auth' }, 'Cloud transcription failed: key refused.'));
    const h = mount();
    await act(async () => {
      await h.api().startTranscription(asset(), 30, [], 'en', () => {}, () => {}, { audioHash: HASH, projectId: 'p1' });
    });
    expect(h.status()).toMatchObject({ phase: 'error', cloudReason: 'cloud-auth' });
  });

  it('a one-run host override reaches the engine seam; the standing choice stays Cloud', async () => {
    writeSyncEngineHost('cloud');
    mockTranscribeForHost.mockResolvedValue({ tokens: [], stamp: () => ({}), host: 'local' });
    const h = mount();
    await act(async () => {
      await h.api().startTranscription(asset(), 30, [], 'en', () => {}, () => {}, { audioHash: HASH, projectId: 'p1', host: 'local' });
    });
    expect(mockTranscribeForHost).toHaveBeenCalledTimes(1);
    expect(mockTranscribeForHost.mock.calls[0]![0]).toMatchObject({ host: 'local' });
    expect(readSyncEngineHost()).toBe('cloud');
    expect(localStorage.getItem(SYNC_ENGINE_HOST_KEY)).toBe('cloud');
  });

  it('without an override the standing choice routes the run', async () => {
    writeSyncEngineHost('cloud');
    mockTranscribeForHost.mockResolvedValue({ tokens: [], stamp: () => ({}), host: 'cloud' });
    const h = mount();
    await act(async () => {
      await h.api().startTranscription(asset(), 30, [], 'en', () => {}, () => {}, { audioHash: HASH, projectId: 'p1' });
    });
    expect(mockTranscribeForHost.mock.calls[0]![0]).toMatchObject({ host: 'cloud' });
  });
});
