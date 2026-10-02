/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U2 — engine routing, single-flight audio prep, and cloud provenance.
// Wave 3 U3 — cache first: the lookup is asked before any encode/upload.
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
  __setCloudRetryDelayForTests,
  cloudFailureReport,
  cloudPauseReason,
  cloudProgressPercent,
  isRetryableCloudError,
  prepareCloudAudioOnce,
  runStageCacheFirst,
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

const MISS_NO_AUDIO = { cached: false, audioPresent: false, audioDurationSec: null };

function gateway(
  runJob: (args: { job: { language: string } }) => unknown,
  opusCached: number | null = 99,
  lookup: () => unknown = () => MISS_NO_AUDIO,
): void {
  mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
    switch (cmd) {
      case 'cloud_cache_lookup': return lookup();
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
  __setCloudRetryDelayForTests(0);
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

  it('a failing call surfaces the gateway\'s real reason and server message, not only inference-failed', async () => {
    const SERVER = 'CUDA OOM on worker-7: device-side assert';
    gateway(() => { throw { kind: 'jobFailed', jobId: 'j9', code: 'worker-error', detail: SERVER }; });
    const err = await transcribeForHost({
      host: 'cloud', asset: asset(), durationSecs: 60, language: 'en', onProgress: () => {},
      signal: new AbortController().signal, audioHash: HASH,
    }).catch(e => e);
    expect(err).toBeInstanceOf(CloudStageError);
    const cloud = (err as CloudStageError).cloud;
    expect(cloud).toMatchObject({ kind: 'jobFailed', code: 'worker-error', detail: SERVER });
    const report = cloudFailureReport(cloud);
    expect(report.pauseReason).toBe('inference-failed');
    expect(report.typedKind).toBe('jobFailed');
    expect(report.serverMessage).toBe(SERVER);
    expect(err.message).toContain(SERVER);
    expect(report.display).toContain(SERVER);
    expect(report.display).toContain('worker-error');
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

  it('Wave 3 U7: Cloud with no key is a typed cloud-auth failure — the local engine is NEVER run in its place', async () => {
    mockInvoke.mockRejectedValue({ kind: 'notConfigured' });
    const err = await transcribeForHost({
      host: 'cloud', asset: asset(), durationSecs: 60, language: undefined, onProgress: () => {},
      signal: new AbortController().signal, audioHash: HASH,
    }).catch(e => e);
    expect(err).toBeInstanceOf(CloudStageError);
    expect(cloudPauseReason((err as CloudStageError).cloud)).toBe('cloud-auth');
    expect(transcribeWithProgress).not.toHaveBeenCalled();
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

describe('prepareCloudAudioOnce — single-flight audio prep shared by both stages', () => {
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

describe('Wave 3 U3 — cache first: nothing is encoded or uploaded before the lookup says it must be', () => {
  const PREP_COMMANDS = ['cloud_opus_cached', 'cloud_stage_audio_raw', 'cloud_encode_opus', 'cloud_upload_audio'];
  const commands = (): string[] => mockInvoke.mock.calls.map(c => c[0] as string);
  const stage = (lang = 'en') => transcribeForHost({
    host: 'cloud', asset: asset(), durationSecs: 60, language: lang, onProgress: () => {},
    signal: new AbortController().signal, audioHash: HASH,
  });

  // The U2 bug this unit fixes: a transcript the gateway already had still
  // cost an encode, a HEAD/upload, and a job. Fails on U2's code.
  it('transcript cache hit: ONE lookup call — no encode, no upload, no job', async () => {
    gateway(() => { throw new Error('must not submit'); }, null, () => ({ cached: true, result: doneTranscript('en').result }));
    const r = await stage();
    expect(commands()).toEqual(['cloud_cache_lookup']);
    expect(r.cached).toBe(true);
    expect(r.tokens[0]!.text).toBe('cloud');
    expect(r.stamp({ language: 'en', completedAt: 1 }).engine).toBe('whisper-cloud');
  });

  it('the lookup asks with the SAME request the submit would send', async () => {
    const sent: unknown[] = [];
    mockInvoke.mockImplementation(async (cmd: string, args: { job?: unknown }) => {
      if (cmd === 'cloud_cache_lookup' || cmd === 'cloud_run_job') sent.push(args.job);
      if (cmd === 'cloud_cache_lookup') return { cached: false, audioPresent: true, audioDurationSec: 60 };
      if (cmd === 'cloud_run_job') return doneTranscript(null);
      throw new Error(cmd);
    });
    await transcribeForHost({
      host: 'cloud', asset: asset(), durationSecs: 60, language: undefined, onProgress: () => {},
      signal: new AbortController().signal, audioHash: HASH,
    });
    expect(sent).toEqual([
      { stage: 'transcribe', audioHash: HASH, language: 'auto' },
      { stage: 'transcribe', audioHash: HASH, language: 'auto' },
    ]);
  });

  it('miss on audio the gateway already holds: job runs, but nothing is encoded or uploaded', async () => {
    gateway(() => doneTranscript('en'), null, () => ({ cached: false, audioPresent: true, audioDurationSec: 60 }));
    const r = await stage();
    expect(commands()).toEqual(['cloud_cache_lookup', 'cloud_run_job']);
    expect(r.cached).toBe(false);
  });

  it('miss on audio the gateway lacks: lookup first, THEN one encode + upload, then the job', async () => {
    gateway(() => doneTranscript('en'), null);
    await stage();
    const c = commands();
    expect(c[0]).toBe('cloud_cache_lookup');
    expect(c.filter(x => x === 'cloud_encode_opus')).toHaveLength(1);
    expect(c.filter(x => x === 'cloud_upload_audio')).toHaveLength(1);
    expect(c.at(-1)).toBe('cloud_run_job');
  });

  it('audio purged between lookup and submit: the typed audio-missing refusal uploads once and resubmits', async () => {
    let submits = 0;
    gateway(() => {
      submits += 1;
      if (submits === 1) throw { kind: 'rejected', status: 409, code: 'audio-missing', detail: 'upload first' };
      return doneTranscript('en');
    }, 99, () => ({ cached: false, audioPresent: true, audioDurationSec: 60 }));
    const r = await stage();
    expect(submits).toBe(2);
    expect(commands().filter(x => x === 'cloud_upload_audio')).toHaveLength(1);
    expect(r.tokens[0]!.text).toBe('cloud');
  });

  it('any other refusal is NOT retried with an upload', async () => {
    gateway(() => { throw { kind: 'rejected', status: 400, code: 'bad-chunks', detail: 'x' }; }, 99,
      () => ({ cached: false, audioPresent: true, audioDurationSec: 60 }));
    await expect(stage()).rejects.toMatchObject({ cloud: { code: 'bad-chunks' } });
    expect(commands().filter(x => PREP_COMMANDS.includes(x))).toEqual([]);
  });

  it('offline at the lookup (twice: U4 retries once) is the same typed failure — and nothing was encoded', async () => {
    gateway(() => doneTranscript('en'), null, () => { throw { kind: 'unreachable', detail: 'dns' }; });
    await expect(stage()).rejects.toMatchObject({ cloud: { kind: 'unreachable' } });
    expect(commands()).toEqual(['cloud_cache_lookup', 'cloud_cache_lookup']);
  });

  it('an abort before the lookup never reaches IPC; an abort after a miss prepares nothing', async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(runStageCacheFirst({ stage: 'transcribe', audioHash: HASH, language: 'en' }, async () => new Blob([]), { signal: aborted.signal }))
      .rejects.toEqual({ kind: 'cancelled' });
    expect(mockInvoke).not.toHaveBeenCalled();

    const late = new AbortController();
    gateway(() => doneTranscript('en'), null, () => { late.abort(); return MISS_NO_AUDIO; });
    await expect(runStageCacheFirst({ stage: 'transcribe', audioHash: HASH, language: 'en' }, async () => new Blob([]), { signal: late.signal }))
      .rejects.toEqual({ kind: 'cancelled' });
    expect(commands()).toEqual(['cloud_cache_lookup']);
  });

  it('the audio source is only read when bytes must actually be sent', async () => {
    const audio = vi.fn(async () => new Blob([new Uint8Array([1])]));
    gateway(() => doneTranscript('en'), null, () => ({ cached: false, audioPresent: true, audioDurationSec: 60 }));
    await runStageCacheFirst({ stage: 'transcribe', audioHash: HASH, language: 'en' }, audio);
    expect(audio).not.toHaveBeenCalled();
    mockInvoke.mockReset();
    gateway(() => doneTranscript('en'), null);
    const r = await runStageCacheFirst({ stage: 'transcribe', audioHash: HASH, language: 'en' }, audio);
    expect(audio).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ cached: false, uploaded: true, encoded: true });
  });
});

describe('Wave 3 U4 — retry once, then surface (never a silent loop)', () => {
  const REQ = { stage: 'transcribe' as const, audioHash: HASH, language: 'en' };
  const HELD = () => ({ cached: false, audioPresent: true, audioDurationSec: 60 });
  const submits = (): number => mockInvoke.mock.calls.filter(c => c[0] === 'cloud_run_job').length;

  // The U3 bug this unit fixes: one network blip ended the run. Fails on U3.
  it('a transient failure is retried exactly once, and the retry\'s result is returned', async () => {
    let n = 0;
    const onRetry = vi.fn();
    gateway(() => { n += 1; if (n === 1) throw { kind: 'unreachable', detail: 'reset' }; return doneTranscript('en'); }, 99, HELD);
    const run = await runStageCacheFirst(REQ, async () => new Blob([]), { onRetry });
    expect(run).toMatchObject({ retried: true, cached: false });
    expect(submits()).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({ kind: 'unreachable', detail: 'reset' });
  });

  it('the retry starts from the cache lookup — a job that finished meanwhile is a free hit', async () => {
    let lookups = 0;
    gateway(() => { throw { kind: 'timeout', detail: 'poll' }; }, 99, () => {
      lookups += 1;
      return lookups === 1 ? HELD() : { cached: true, result: doneTranscript('en').result };
    });
    const run = await runStageCacheFirst(REQ, async () => new Blob([]));
    expect(run).toMatchObject({ retried: true, cached: true });
    expect(submits()).toBe(1);
  });

  it('two transient failures in a row surface the second — two attempts, never a third', async () => {
    gateway(() => { throw { kind: 'server', status: 502, detail: 'bad gateway' }; }, 99, HELD);
    await expect(runStageCacheFirst(REQ, async () => new Blob([]))).rejects.toMatchObject({ kind: 'server' });
    expect(submits()).toBe(2);
  });

  it.each([
    [{ kind: 'auth' }],
    [{ kind: 'tooLong', detail: 'x' }],
    [{ kind: 'rejected', status: 400, code: 'bad-chunks', detail: 'x' }],
    [{ kind: 'jobFailed', jobId: 'j', code: 'worker-error', detail: 'x' }],
    [{ kind: 'jobFailed', jobId: 'j', code: 'worker-timeout', detail: 'x' }],
  ])('a failure a retry cannot change is NOT retried (and so never re-billed): %j', async (err) => {
    gateway(() => { throw err; }, 99, HELD);
    await expect(runStageCacheFirst(REQ, async () => new Blob([]))).rejects.toMatchObject({ kind: err.kind });
    expect(submits()).toBe(1);
  });

  it('a lost or crashed worker IS retried', async () => {
    let n = 0;
    gateway(() => { n += 1; if (n === 1) throw { kind: 'jobFailed', jobId: 'j', code: 'worker-lost', detail: 'x' }; return doneTranscript('en'); }, 99, HELD);
    await expect(runStageCacheFirst(REQ, async () => new Blob([]))).resolves.toMatchObject({ retried: true });
  });

  it('cancel during the retry wait ends the run as cancelled with no second attempt', async () => {
    __setCloudRetryDelayForTests(60_000);
    const controller = new AbortController();
    gateway(() => { throw { kind: 'unreachable', detail: 'x' }; }, 99, HELD);
    const p = runStageCacheFirst(REQ, async () => new Blob([]), { signal: controller.signal, onRetry: () => controller.abort() });
    await expect(p).rejects.toEqual({ kind: 'cancelled' });
    expect(submits()).toBe(1);
  });

  it('retryable and pause-reason tables', () => {
    expect(isRetryableCloudError({ kind: 'unreachable', detail: '' })).toBe(true);
    expect(isRetryableCloudError({ kind: 'timeout', detail: '' })).toBe(true);
    expect(isRetryableCloudError({ kind: 'server', status: 503, detail: '' })).toBe(true);
    expect(isRetryableCloudError({ kind: 'notConfigured' })).toBe(false);
    expect(isRetryableCloudError({ kind: 'cancelled' })).toBe(false);
    expect(isRetryableCloudError({ kind: 'encode', detail: '' })).toBe(false);
    expect(cloudPauseReason({ kind: 'unreachable', detail: '' })).toBe('offline');
    expect(cloudPauseReason({ kind: 'timeout', detail: '' })).toBe('offline');
    expect(cloudPauseReason({ kind: 'auth' })).toBe('cloud-auth');
    expect(cloudPauseReason({ kind: 'notConfigured' })).toBe('cloud-auth');
    expect(cloudPauseReason({ kind: 'server', status: 500, detail: '' })).toBe('inference-failed');
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

describe('P9 align detach vs kill', () => {
  it('killing the client mid-align polls the live job on relaunch and does not DELETE', async () => {
    const { alignViaCloud } = await import('./cloudSyncEngine');
    const cmds: string[] = [];
    mockInvoke.mockImplementation(async (cmd: string) => {
      cmds.push(cmd);
      if (cmd === 'cloud_list_jobs') {
        return [{ jobId: 'ja', stage: 'align', status: 'running', projectId: 'p1', rowId: 'p1', taskId: 'ta-1' }];
      }
      if (cmd === 'cloud_poll_job') {
        return {
          jobId: 'ja', stage: 'align', status: 'done', cached: false, workerSec: 3, error: null,
          result: { words: [], nFallbackChunks: 0, provenance: { engine: 'fa-cloud', model: 'm', modelVersion: '1', language: 'en' } },
        };
      }
      if (cmd === 'cloud_cache_lookup') return { cached: false, audioPresent: true, audioDurationSec: 10 };
      throw new Error(cmd);
    });
    const out = await alignViaCloud({
      voiceoverBlob: new Blob([new Uint8Array([1])]),
      audioHash: HASH,
      chunks: [{ startSec: 0, endSec: 1, text: 'hi' }],
      language: 'en',
      projectId: 'p1',
      rowId: 'p1',
    });
    expect(out.status).toBe('ok');
    expect(cmds).toContain('cloud_poll_job');
    expect(cmds).not.toContain('cloud_run_job');
    expect(cmds).not.toContain('cloud_kill_job');
  });

  it('an aborted align poller DETACHES and must not release or kill the GPU job', async () => {
    const { alignViaCloud } = await import('./cloudSyncEngine');
    const cmds: string[] = [];
    mockInvoke.mockImplementation(async (cmd: string) => {
      cmds.push(cmd);
      if (cmd === 'cloud_cache_lookup') return { cached: false, audioPresent: true, audioDurationSec: 10 };
      if (cmd === 'cloud_run_job') throw { kind: 'cancelled' };
      if (cmd === 'cloud_list_jobs') return [];
      return true;
    });
    const out = await alignViaCloud({
      voiceoverBlob: new Blob([new Uint8Array([1])]),
      audioHash: HASH,
      chunks: [{ startSec: 0, endSec: 1, text: 'hi' }],
      language: 'en',
      projectId: 'p1',
      rowId: 'p1',
    });
    expect(out.status).toBe('cancelled');
    expect(cmds).not.toContain('cloud_kill_job');
    expect(cmds).not.toContain('cloud_release_job');
  });
});
