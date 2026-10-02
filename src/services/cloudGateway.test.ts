/**
 * Wave 3 U1 — `cloudGateway.ts` against a mocked Tauri IPC boundary. The Rust
 * side of the same wire is exercised live by `cloud_gateway.rs`'s
 * `live_wire_path` test; this file pins the frontend contract: which
 * commands run in which order, that the original bytes cross IPC only when
 * the local Opus cache misses, and that an abort always reaches Rust.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {
    onmessage: ((e: unknown) => void) | undefined;
  },
}));

import {
  describeCloudError,
  isCloudError,
  prepareCloudAudio,
  runCloudJob,
  toCloudError,
  type CloudError,
} from './cloudGateway';

const HASH = 'a'.repeat(64);

beforeEach(() => {
  invokeMock.mockReset();
});

describe('prepareCloudAudio', () => {
  it('skips staging and encoding when the local Opus cache already holds the audio', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'cloud_opus_cached') return 2_952_196;
      if (cmd === 'cloud_upload_audio') return { uploaded: false, durationSec: 1421.3, opusBytes: 2_952_196 };
      throw new Error(`unexpected ${cmd}`);
    });
    const out = await prepareCloudAudio(new Blob([new Uint8Array([1, 2, 3])]), HASH);
    expect(invokeMock.mock.calls.map(c => c[0])).toEqual(['cloud_opus_cached', 'cloud_upload_audio']);
    expect(out).toEqual({ uploaded: false, durationSec: 1421.3, opusBytes: 2_952_196, encoded: false });
  });

  it('on a cache miss sends the raw bytes with the audio-hash header, then encodes, then uploads', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'cloud_opus_cached') return null;
      if (cmd === 'cloud_stage_audio_raw') return HASH;
      if (cmd === 'cloud_encode_opus') return 1000;
      if (cmd === 'cloud_upload_audio') return { uploaded: true, durationSec: 5, opusBytes: 1000 };
      throw new Error(`unexpected ${cmd}`);
    });
    const out = await prepareCloudAudio(new Blob([new Uint8Array([9, 8, 7])]), HASH);
    const calls = invokeMock.mock.calls;
    expect(calls.map(c => c[0])).toEqual(['cloud_opus_cached', 'cloud_stage_audio_raw', 'cloud_encode_opus', 'cloud_upload_audio']);
    const [, body, options] = calls[1]!;
    expect(body).toBeInstanceOf(Uint8Array);
    expect(Array.from(body as Uint8Array)).toEqual([9, 8, 7]);
    expect(options).toEqual({ headers: { 'audio-hash': HASH } });
    expect(out.encoded).toBe(true);
  });

  it('rejects with the typed error Rust returned', async () => {
    const encodeFailure: CloudError = { kind: 'encode', detail: 'no audio stream' };
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'cloud_opus_cached') return null;
      if (cmd === 'cloud_stage_audio_raw') return HASH;
      throw encodeFailure;
    });
    await expect(prepareCloudAudio(new Blob([]), HASH)).rejects.toEqual(encodeFailure);
  });
});

describe('runCloudJob', () => {
  it('never submits when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runCloudJob({ stage: 'transcribe', audioHash: HASH, language: 'en' }, { signal: ac.signal }))
      .rejects.toEqual({ kind: 'cancelled' });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('an abort that lands before Rust registered the run keeps retrying cloud_cancel_run with the same run id', async () => {
    vi.useFakeTimers();
    let resolveRun!: (v: unknown) => void;
    let registered = false;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'cloud_run_job') return new Promise((_, reject) => { resolveRun = reject; });
      if (cmd === 'cloud_cancel_run') return Promise.resolve(registered);
      return Promise.reject(new Error(cmd));
    });
    const ac = new AbortController();
    const pending = runCloudJob({ stage: 'transcribe', audioHash: HASH, language: 'en' }, { signal: ac.signal });
    const runId = (invokeMock.mock.calls[0]![1] as { runId: string }).runId;
    ac.abort();
    await vi.advanceTimersByTimeAsync(0);
    registered = true;
    await vi.advanceTimersByTimeAsync(250);
    const cancelCalls = invokeMock.mock.calls.filter(c => c[0] === 'cloud_cancel_run');
    expect(cancelCalls.length).toBeGreaterThanOrEqual(2);
    expect(cancelCalls.every(c => (c[1] as { runId: string }).runId === runId)).toBe(true);
    expect(invokeMock.mock.calls.every(c => c[0] !== 'cloud_kill_job')).toBe(true);
    resolveRun({ kind: 'cancelled' });
    await expect(pending).rejects.toEqual({ kind: 'cancelled' });
    const after = invokeMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(invokeMock.mock.calls.length).toBe(after);
    vi.useRealTimers();
  });

  it('passes the job and a channel to cloud_run_job and resolves with the view', async () => {
    const view = { jobId: 'j', stage: 'transcribe', status: 'done', cached: true, audioDurationSec: 1, workerSec: 0, error: null, result: { tokens: [] } };
    invokeMock.mockResolvedValue(view);
    const job = { stage: 'transcribe' as const, audioHash: HASH, language: 'auto' };
    await expect(runCloudJob(job)).resolves.toEqual(view);
    const args = invokeMock.mock.calls[0]![1] as { job: unknown; onEvent: unknown; runId: string };
    expect(args.job).toEqual(job);
    expect(args.onEvent).toBeDefined();
    expect(args.runId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('CloudError', () => {
  it('typed rejections pass through; anything else becomes a protocol error', () => {
    expect(toCloudError({ kind: 'auth' })).toEqual({ kind: 'auth' });
    expect(toCloudError('command cloud_ping not found')).toEqual({ kind: 'protocol', detail: 'command cloud_ping not found' });
    expect(toCloudError(new Error('boom'))).toEqual({ kind: 'protocol', detail: 'boom' });
    expect(isCloudError({ kind: 'not-a-kind' })).toBe(false);
  });

  it('every kind has a sentence', () => {
    const all: CloudError[] = [
      { kind: 'notConfigured' }, { kind: 'unreachable', detail: '' }, { kind: 'timeout', detail: '' },
      { kind: 'auth' }, { kind: 'tooLong', detail: '' }, { kind: 'rejected', status: 400, code: 'c', detail: 'd' },
      { kind: 'server', status: 502, detail: '' }, { kind: 'jobFailed', jobId: 'j', code: 'c', detail: '' },
      { kind: 'cancelled' }, { kind: 'encode', detail: '' }, { kind: 'io', detail: '' }, { kind: 'protocol', detail: '' },
    ];
    for (const e of all) expect(describeCloudError(e).length).toBeGreaterThan(5);
  });

  it('jobFailed and server keep the gateway\'s message verbatim', () => {
    expect(describeCloudError({ kind: 'jobFailed', jobId: 'j', code: 'worker-error', detail: 'CUDA OOM on worker-7' }))
      .toContain('CUDA OOM on worker-7');
    expect(describeCloudError({ kind: 'server', status: 502, detail: 'bad gateway from modal' }))
      .toContain('bad gateway from modal');
  });
});
