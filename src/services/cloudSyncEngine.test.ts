/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U2 — engine routing, single-flight audio prep, and cloud provenance.
// Real `cloudSyncEngine` + `cloudGateway` + `timingProvenance`; only the Tauri
// IPC boundary and the local whisper.cpp arm are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannel<T> {
    onmessage: ((message: T) => void) | undefined;
  }
  return { Channel: FakeChannel, invoke: vi.fn() };
});
vi.mock('./whisperService', () => ({
  transcribeWithProgress: vi.fn(async () => ({ tokens: [{ text: 'local', startSec: 0, endSec: 1 }], detectedLanguage: 'en' })),
}));

import { invoke } from '@tauri-apps/api/core';
import { transcribeWithProgress } from './whisperService';
import {
  CloudStageError,
  __resetCloudAudioInFlightForTests,
  cloudProgressPercent,
  prepareCloudAudioOnce,
  transcribeForHost,
} from './cloudSyncEngine';
import type { Asset } from '../types';

const mockInvoke = invoke as unknown as Mock;
const HASH = 'd'.repeat(64);
const GATEWAY_PROVENANCE = {
  engine: 'whisper-cloud',
  model: 'dropbox-dash/faster-whisper-large-v3-turbo',
  modelVersion: '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf+faster-whisper-1.1.1+ct2-4.8.2',
  language: 'en',
};

const asset = (): Asset => ({
  id: 'a', name: 'vo.m4a', url: 'blob:x', type: 'audio',
  file: new File([new Uint8Array([5, 6, 7])], 'vo.m4a'),
});

function gateway(runJob: (args: { job: { language: string } }) => unknown, opusCached: number | null = 99): void {
  mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
    switch (cmd) {
      case 'cloud_opus_cached': return opusCached;
      case 'cloud_stage_audio_raw': return HASH;
      case 'cloud_encode_opus': return 99;
      case 'cloud_upload_audio': return { uploaded: true, durationSec: 60, opusBytes: 99 };
      case 'cloud_run_job': return runJob(args as { job: { language: string } });
      case 'cloud_cancel_run': return true;
      default: throw new Error(cmd);
    }
  });
}

const doneTranscript = (detectedLanguage: string | null) => ({
  jobId: 'j', stage: 'transcribe', status: 'done', cached: false, audioDurationSec: 60, workerSec: 40, error: null,
  result: { tokens: [{ text: 'cloud', startSec: 0, endSec: 1 }], detectedLanguage, provenance: GATEWAY_PROVENANCE, createdAt: 1 },
});

beforeEach(() => {
  mockInvoke.mockReset();
  (transcribeWithProgress as unknown as Mock).mockClear();
  __resetCloudAudioInFlightForTests();
});

describe('transcribeForHost', () => {
  it('local: runs whisper.cpp and stamps `whisper`', async () => {
    const r = await transcribeForHost({
      host: 'local', asset: asset(), durationSecs: 60, language: undefined, onProgress: () => {},
      signal: new AbortController().signal,
    });
    expect(r.host).toBe('local');
    expect(r.tokens[0]!.text).toBe('local');
    expect(r.stamp({ language: 'en', completedAt: 5 }).engine).toBe('whisper');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('cloud: auto language when the project has none, and the stamp is the gateway\'s own model + revision', async () => {
    let sentLanguage: string | undefined;
    gateway(({ job }) => { sentLanguage = job.language; return doneTranscript('en'); });
    const r = await transcribeForHost({
      host: 'cloud', asset: asset(), durationSecs: 60, language: undefined, onProgress: () => {},
      signal: new AbortController().signal, audioHash: HASH,
    });
    expect(sentLanguage).toBe('auto');
    expect(r.detectedLanguage).toBe('en');
    expect(r.stamp({ language: 'en', completedAt: 7 })).toEqual({
      engine: 'whisper-cloud',
      model: GATEWAY_PROVENANCE.model,
      modelVersion: GATEWAY_PROVENANCE.modelVersion,
      schemaVersion: 1,
      language: 'en',
      completedAt: 7,
    });
    expect(transcribeWithProgress).not.toHaveBeenCalled();
  });

  it('cloud with an explicit language reports no detection (the sticky language is not a suggestion)', async () => {
    gateway(() => doneTranscript('es'));
    const r = await transcribeForHost({
      host: 'cloud', asset: asset(), durationSecs: 60, language: 'es', onProgress: () => {},
      signal: new AbortController().signal, audioHash: HASH,
    });
    expect(r.detectedLanguage).toBeUndefined();
  });

  it('cloud failures surface as a readable staging error carrying the typed cause', async () => {
    gateway(() => { throw { kind: 'auth' }; });
    const p = transcribeForHost({
      host: 'cloud', asset: asset(), durationSecs: 60, language: 'en', onProgress: () => {},
      signal: new AbortController().signal, audioHash: HASH,
    });
    await expect(p).rejects.toBeInstanceOf(CloudStageError);
    await expect(p).rejects.toMatchObject({ cloud: { kind: 'auth' }, message: expect.stringContaining('did not accept') });
  });

  it('cloud cancel is an AbortError, the same shape the staging path already treats as "back to idle"', async () => {
    gateway(() => { throw { kind: 'cancelled' }; });
    await expect(transcribeForHost({
      host: 'cloud', asset: asset(), durationSecs: 60, language: 'en', onProgress: () => {},
      signal: new AbortController().signal, audioHash: HASH,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cloud without a content hash refuses before any IPC', async () => {
    await expect(transcribeForHost({
      host: 'cloud', asset: asset(), durationSecs: 60, language: 'en', onProgress: () => {},
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(CloudStageError);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('prepareCloudAudioOnce — background encode at voiceover-add, shared with the stages', () => {
  it('two concurrent callers for one hash share ONE encode + upload', async () => {
    gateway(() => doneTranscript('en'), null);
    const file = new Blob([new Uint8Array([1])]);
    await Promise.all([prepareCloudAudioOnce(file, HASH), prepareCloudAudioOnce(file, HASH)]);
    const commands = mockInvoke.mock.calls.map(c => c[0]);
    expect(commands.filter(c => c === 'cloud_encode_opus')).toHaveLength(1);
    expect(commands.filter(c => c === 'cloud_upload_audio')).toHaveLength(1);
  });

  it('a failed attempt is forgotten, so the next caller retries', async () => {
    let fail = true;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'cloud_opus_cached') return 5;
      if (cmd === 'cloud_upload_audio') {
        if (fail) { fail = false; throw { kind: 'unreachable', detail: 'x' }; }
        return { uploaded: true, durationSec: 1, opusBytes: 5 };
      }
      throw new Error(cmd);
    });
    await expect(prepareCloudAudioOnce(new Blob([]), HASH)).rejects.toMatchObject({ kind: 'unreachable' });
    await expect(prepareCloudAudioOnce(new Blob([]), HASH)).resolves.toMatchObject({ uploaded: true });
  });
});

describe('cloudProgressPercent', () => {
  it('never reaches 100 before the result, and a cache hit jumps near the end', () => {
    expect(cloudProgressPercent({ type: 'submitted', jobId: 'j', cached: true }, 1400)).toBe(95);
    expect(cloudProgressPercent({ type: 'status', jobId: 'j', status: 'queued', elapsedSec: 20 }, 1400)).toBe(5);
    expect(cloudProgressPercent({ type: 'status', jobId: 'j', status: 'running', elapsedSec: 1e6 }, 1400)).toBe(95);
    const mid = cloudProgressPercent({ type: 'status', jobId: 'j', status: 'running', elapsedSec: 30 }, 1400);
    expect(mid).toBeGreaterThan(10);
    expect(mid).toBeLessThan(95);
  });
});
