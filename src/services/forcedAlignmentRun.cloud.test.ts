/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U2 — the cloud arm of `runForcedAlignmentForSync`. Composes the real
// runner → `cloudSyncEngine.alignViaCloud` → `cloudGateway` wrappers, mocking
// only the Tauri IPC boundary (the Rust client is covered live by
// `cloud_gateway.rs`'s `live_wire_path`). Same chunk-plan/silence mocks as
// `forcedAlignmentRun.test.ts`, so the plan the cloud receives is known.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannel<T> {
    onmessage: (message: T) => void = () => {};
  }
  return { Channel: FakeChannel, invoke: vi.fn() };
});
vi.mock('./silenceDetector', () => ({
  detectSilences: vi.fn(async () => ({ status: 'ok', silences: [] })),
  detectSilencesSingleFlight: vi.fn(async () => ({ status: 'ok', silences: [] })),
}));
vi.mock('./faChunkPlan', () => ({
  computeFaChunkPlan: vi.fn(() => [{ startSec: 0, endSec: 1, text: 'hello world' }]),
  computeUnscriptedRuns: vi.fn(() => []),
  computeRunContextAsync: vi.fn(async () => undefined),
}));

import { invoke } from '@tauri-apps/api/core';
import { runForcedAlignmentForSync } from './forcedAlignmentRun';
import { __resetCloudAudioInFlightForTests, __setCloudRetryDelayForTests } from './cloudSyncEngine';
import type { Asset, TranscriptToken, VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

const mockInvoke = invoke as unknown as Mock;
const HASH = 'c'.repeat(64);
const PROVENANCE = {
  engine: 'fa-cloud',
  model: 'mohtashim9/kinetix-fa-models/en',
  modelVersion: 'f618960d71728eba5f12528d5571838a10d262bf+ort-1.23.2+port-1',
  language: 'en',
};
const WORDS = [
  { word: 'hello', startSec: 0.1, endSec: 0.4, confidence: 0.9, needsReview: false, wordIndex: 0 },
  { word: 'world', startSec: 0.45, endSec: 0.9, confidence: 0.8, needsReview: false, wordIndex: 1 },
];

function asset(): Asset {
  return {
    id: 'vo1', name: 'voiceover.wav', url: 'blob:vo', type: 'audio',
    file: new File([new Uint8Array([1, 2, 3, 4])], 'voiceover.wav', { type: 'audio/wav' }),
  };
}
function segments(): VideoSegment[] {
  return [{ id: 's1', text: 'hello world', startTime: 0, duration: 1, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0 }];
}
const tokens: TranscriptToken[] = [
  { text: 'hello', startSec: 0, endSec: 0.4 },
  { text: 'world', startSec: 0.4, endSec: 1 },
];

function gateway(
  runJob: (args: { job: unknown }) => unknown,
  lookup: () => unknown = () => ({ cached: false, audioPresent: false, audioDurationSec: null }),
): void {
  mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
    switch (cmd) {
      case 'cloud_cache_lookup': return lookup();
      case 'cloud_opus_cached': return 1234;
      case 'cloud_upload_audio': return { uploaded: false, durationSec: 1, opusBytes: 1234 };
      case 'cloud_run_job': return runJob(args as { job: unknown });
      case 'cloud_cancel_run': return true;
      default: throw new Error(`local FA command must not run on the cloud arm: ${cmd}`);
    }
  });
}

const run = (signal?: AbortSignal, audioHash: string | undefined = HASH) =>
  runForcedAlignmentForSync(asset(), segments(), tokens, 1, 'en', signal, audioHash, undefined, 'cloud');

beforeEach(() => {
  mockInvoke.mockReset();
  __resetCloudAudioInFlightForTests();
  __setCloudRetryDelayForTests(0);
});

describe('runForcedAlignmentForSync — cloud arm (Wave 3 U2)', () => {
  it('sends the runner\'s own chunk plan to the gateway and returns FA tokens + the gateway\'s provenance', async () => {
    let sentJob: unknown;
    gateway(({ job }) => {
      sentJob = job;
      return { jobId: 'j', stage: 'align', status: 'done', cached: false, audioDurationSec: 1, workerSec: 30, error: null,
        result: { words: WORDS, nChunks: 1, nFallbackChunks: 0, provenance: PROVENANCE, createdAt: 1 } };
    });
    const result = await run();
    expect(sentJob).toEqual({ stage: 'align', audioHash: HASH, language: 'en', chunks: [{ startSec: 0, endSec: 1, text: 'hello world' }] });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.tokens.map(t => t.text)).toEqual(['hello', 'world']);
    expect(result.cloudProvenance).toEqual(PROVENANCE);
    expect(mockInvoke.mock.calls.map(c => c[0])).not.toContain('fa_align_production');
  });

  it('infeasible chunks on the cloud are degraded, exactly as locally', async () => {
    gateway(() => ({ jobId: 'j', stage: 'align', status: 'done', cached: true, audioDurationSec: 1, workerSec: 0, error: null,
      result: { words: WORDS, nChunks: 1, nFallbackChunks: 1, provenance: PROVENANCE, createdAt: 1 } }));
    const result = await run();
    expect(result).toMatchObject({ status: 'degraded', reason: 'ctc-infeasible-chunk', nFallbackChunks: 1, cloudProvenance: PROVENANCE });
  });

  it('an unreachable gateway PAUSES as offline — never a silent local fallback', async () => {
    gateway(() => { throw { kind: 'unreachable', detail: 'dns' }; });
    const result = await run();
    expect(result).toMatchObject({ status: 'paused', reason: 'offline', resumable: true });
    expect(mockInvoke.mock.calls.map(c => c[0])).not.toContain('fa_stage_audio_raw');
  });

  it('Wave 3 U4 — a refused key pauses as cloud-auth (not retried, not inference-failed)', async () => {
    gateway(() => { throw { kind: 'auth' }; });
    expect(await run()).toMatchObject({ status: 'paused', reason: 'cloud-auth', resumable: true });
    expect(mockInvoke.mock.calls.filter(c => c[0] === 'cloud_run_job')).toHaveLength(1);
  });

  it('Wave 3 U4 — one offline blip mid-alignment is absorbed by the retry: the run succeeds', async () => {
    let n = 0;
    gateway(() => {
      n += 1;
      if (n === 1) throw { kind: 'unreachable', detail: 'reset' };
      return { jobId: 'j', stage: 'align', status: 'done', cached: false, audioDurationSec: 1, workerSec: 30, error: null,
        result: { words: WORDS, nChunks: 1, nFallbackChunks: 0, provenance: PROVENANCE, createdAt: 1 } };
    });
    expect(await run()).toMatchObject({ status: 'ok' });
  });

  it('any other cloud failure pauses as inference-failed with the typed reason in detail', async () => {
    gateway(() => { throw { kind: 'jobFailed', jobId: 'j', code: 'worker-error', detail: 'x' }; });
    const result = await run();
    expect(result).toMatchObject({ status: 'paused', reason: 'inference-failed', detail: 'The cloud job failed (worker-error).' });
  });

  it('a cancelled cloud job is a cancelled run', async () => {
    gateway(() => { throw { kind: 'cancelled' }; });
    expect(await run()).toEqual({ status: 'cancelled' });
  });

  it('zero words pauses, same as the local arm', async () => {
    gateway(() => ({ jobId: 'j', stage: 'align', status: 'done', cached: false, audioDurationSec: 1, workerSec: 1, error: null,
      result: { words: [], nChunks: 1, nFallbackChunks: 0, provenance: PROVENANCE, createdAt: 1 } }));
    expect(await run()).toMatchObject({ status: 'paused', reason: 'zero-words' });
  });

  it('no content hash → typed pause before any upload', async () => {
    gateway(() => { throw new Error('must not submit'); });
    expect(await run(undefined, '')).toMatchObject({ status: 'paused', reason: 'audio-stage-failed' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  // Wave 3 U3 — Apply Sync on content the cloud has already aligned.
  it('alignment cache hit: ok with the cached words, ONE lookup call — no upload, no job', async () => {
    let lookedUp: unknown;
    mockInvoke.mockImplementation(async (cmd: string, args: { job?: unknown }) => {
      if (cmd !== 'cloud_cache_lookup') throw new Error(`must not run on a cache hit: ${cmd}`);
      lookedUp = args.job;
      return { cached: true, result: { words: WORDS, nChunks: 1, nFallbackChunks: 0, provenance: PROVENANCE, createdAt: 1 } };
    });
    const result = await run();
    expect(lookedUp).toEqual({ stage: 'align', audioHash: HASH, language: 'en', chunks: [{ startSec: 0, endSec: 1, text: 'hello world' }] });
    expect(result).toMatchObject({ status: 'ok', cloudProvenance: PROVENANCE, cloudCached: true });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('a computed (non-cache) alignment is marked cloudCached false', async () => {
    gateway(() => ({ jobId: 'j', stage: 'align', status: 'done', cached: false, audioDurationSec: 1, workerSec: 30, error: null,
      result: { words: WORDS, nChunks: 1, nFallbackChunks: 0, provenance: PROVENANCE, createdAt: 1 } }));
    expect(await run()).toMatchObject({ status: 'ok', cloudCached: false });
  });

  it('offline at the lookup, after the one retry, still PAUSES as offline', async () => {
    gateway(() => { throw new Error('must not submit'); }, () => { throw { kind: 'unreachable', detail: 'dns' }; });
    expect(await run()).toMatchObject({ status: 'paused', reason: 'offline', resumable: true });
    expect(mockInvoke.mock.calls.map(c => c[0])).toEqual(['cloud_cache_lookup', 'cloud_cache_lookup']);
  });

  it('the mid-coverage abort (G4 hopeless band) stops a mismatched script BEFORE any cloud call', async () => {
    gateway(() => { throw new Error('must not submit'); });
    const offScript: TranscriptToken[] = [
      { text: 'completely', startSec: 0, endSec: 0.3 }, { text: 'different', startSec: 0.3, endSec: 0.6 },
      { text: 'words', startSec: 0.6, endSec: 1 },
    ];
    const longScript: VideoSegment[] = [{ ...segments()[0]!, text: 'alpha beta gamma delta epsilon zeta eta theta iota kappa' }];
    const result = await runForcedAlignmentForSync(asset(), longScript, offScript, 1, 'en', undefined, HASH, undefined, 'cloud');
    expect(result).toMatchObject({ status: 'paused', reason: 'hopeless-local-coverage' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
