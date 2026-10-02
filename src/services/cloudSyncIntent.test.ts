/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U4.5 — the cloud sync intent, composed on the REAL chain: staging
// transcription (`transcribeViaCloud`, held) -> intent -> REAL
// `runForcedAlignmentForSync` (G4 coverage check + chunk plan) -> REAL
// `alignViaCloud` -> `cloudGateway` wrappers. Only the Tauri IPC boundary
// (and the same chunk-plan/silence mocks as the FA cloud-arm test) are
// mocked. Every behaviour here is new in U4.5 — the module did not exist.

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
import {
  __resetCloudAudioInFlightForTests,
  __resetHeldTranscriptionsForTests,
  __setCloudRetryDelayForTests,
  hasHeldTranscription,
  transcribeForHost,
} from './cloudSyncEngine';
import {
  __resetSyncIntentsForTests,
  cancelOtherSyncIntents,
  getSyncIntent,
  runCloudSyncIntent,
  startSyncIntent,
  subscribeSyncIntents,
  type SyncIntentInputs,
} from './cloudSyncIntent';
import type { Asset, TranscriptToken, VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

const mockInvoke = invoke as unknown as Mock;
const HASH = 'b'.repeat(64);
const PROVENANCE = { engine: 'fa-cloud', model: 'm/en', modelVersion: 'v', language: 'en' };
const T_PROV = { engine: 'whisper-cloud', model: 'w', modelVersion: 'v', language: 'en' };
const WORDS = [
  { word: 'hello', startSec: 0.1, endSec: 0.4, confidence: 0.9, needsReview: false, wordIndex: 0 },
  { word: 'world', startSec: 0.45, endSec: 0.9, confidence: 0.8, needsReview: false, wordIndex: 1 },
];
const TOKENS: TranscriptToken[] = [{ text: 'hello', startSec: 0, endSec: 0.4 }, { text: 'world', startSec: 0.4, endSec: 1 }];

const asset = (): Asset => ({
  id: 'vo', name: 'vo.wav', url: 'blob:vo', type: 'audio', duration: 1,
  file: new File([new Uint8Array([1, 2, 3])], 'vo.wav', { type: 'audio/wav' }),
});
const seg = (text: string): VideoSegment =>
  ({ id: 's1', text, startTime: 0, duration: 1, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0 }) as VideoSegment;

function inputs(over: Partial<SyncIntentInputs> = {}): SyncIntentInputs {
  return {
    spineKey: `${HASH}|script|cloud:fa`, voiceover: asset(), audioHash: HASH, audioDurationSec: 1,
    tokens: TOKENS, language: 'en', prepareSegments: async () => [seg('hello world')], ...over,
  };
}

interface Gw { submits: Array<Record<string, unknown>>; releases: string[] }
function gateway(opts: {
  transcribeLookup?: unknown; alignLookup?: unknown; align?: (job: Record<string, unknown>) => unknown;
} = {}): Gw {
  const gw: Gw = { submits: [], releases: [] };
  mockInvoke.mockImplementation(async (cmd: string, args: { job?: Record<string, unknown>; jobId?: string }) => {
    switch (cmd) {
      case 'cloud_cache_lookup':
        return args.job!.stage === 'transcribe'
          ? (opts.transcribeLookup ?? { cached: false, audioPresent: true, audioDurationSec: 1 })
          : (opts.alignLookup ?? { cached: false, audioPresent: true, audioDurationSec: 1 });
      case 'cloud_run_job': {
        const job = args.job!;
        gw.submits.push(job);
        if (job.stage === 'transcribe') {
          return { jobId: 'a1b2', stage: 'transcribe', status: 'done', cached: false, audioDurationSec: 1, workerSec: 6, error: null,
            taskId: 'ta-1', result: { tokens: TOKENS, detectedLanguage: null, provenance: T_PROV, createdAt: 1 } };
        }
        if (opts.align) return opts.align(job);
        return { jobId: 'c3d4', stage: 'align', status: 'done', cached: false, audioDurationSec: 1, workerSec: 5, error: null,
          taskId: 'ta-1', handedOff: Boolean(job.holdJobId),
          result: { words: WORDS, nChunks: 1, nFallbackChunks: 0, provenance: PROVENANCE, createdAt: 1 } };
      }
      case 'cloud_release_job': gw.releases.push(args.jobId!); return true;
      case 'cloud_cancel_run': return true;
      default: throw new Error(`unexpected IPC ${cmd}`);
    }
  });
  return gw;
}

async function stageHeld(): Promise<void> {
  await transcribeForHost({
    host: 'cloud', asset: asset(), durationSecs: 1, language: 'en', onProgress: () => {},
    signal: new AbortController().signal, audioHash: HASH, hold: true,
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
  __resetCloudAudioInFlightForTests();
  __resetHeldTranscriptionsForTests();
  __resetSyncIntentsForTests();
  __setCloudRetryDelayForTests(0);
});

describe('Wave 3 U4.5 — one boot: the intent aligns in the staging transcription\'s held container', () => {
  it('staging asks for a hold; the intent hands its plan to that job; the result is ready + handed off', async () => {
    const gw = gateway();
    await stageHeld();
    expect(gw.submits[0]).toMatchObject({ stage: 'transcribe', hold: true });
    expect(hasHeldTranscription(HASH)).toBe(true);

    const outcome = await runCloudSyncIntent(inputs());
    expect(outcome).toEqual({ status: 'ready', handedOff: true, cached: false });
    expect(gw.submits[1]).toMatchObject({ stage: 'align', holdJobId: 'a1b2', chunks: [{ startSec: 0, endSec: 1, text: 'hello world' }] });
    expect(hasHeldTranscription(HASH)).toBe(false);
  });

  it('a cached transcript has no container to hold — the alignment spawns normally (staggered physics)', async () => {
    const gw = gateway({ transcribeLookup: { cached: true, result: { tokens: TOKENS, detectedLanguage: null, provenance: T_PROV, createdAt: 1 } } });
    await stageHeld();
    expect(hasHeldTranscription(HASH)).toBe(false);
    await runCloudSyncIntent(inputs());
    expect(gw.submits.find(s => s.stage === 'align')!.holdJobId).toBeUndefined();
  });

  it('an alignment already cached still submits with holdJobId so the last stage attaches (held=0)', async () => {
    const gw = gateway({
      alignLookup: { cached: true, result: { words: WORDS, nChunks: 1, nFallbackChunks: 0, provenance: PROVENANCE, createdAt: 1 } },
      align: (job) => ({
        jobId: 'c3d4', stage: 'align', status: 'done', cached: true, audioDurationSec: 1, workerSec: 0, error: null,
        taskId: 'ta-1', handedOff: Boolean(job.holdJobId),
        result: { words: WORDS, nChunks: 1, nFallbackChunks: 0, provenance: PROVENANCE, createdAt: 1 },
      }),
    });
    await stageHeld();
    expect(await runCloudSyncIntent(inputs())).toEqual({ status: 'ready', handedOff: true, cached: true });
    expect(gw.submits.find(s => s.stage === 'align')).toMatchObject({ holdJobId: 'a1b2' });
    expect(gw.releases).toEqual([]);
  });
});

describe('Wave 3 U4.5 — held-entry lifetime', () => {
  it('an entry older than the gateway\'s hold window is not sent (the gateway closed it anyway)', async () => {
    const gw = gateway();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await stageHeld();
      vi.setSystemTime(Date.now() + 26_000);
      expect(hasHeldTranscription(HASH)).toBe(false);
      await runCloudSyncIntent(inputs());
      expect(gw.submits.find(s => s.stage === 'align')!.holdJobId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed alignment releases the held container', async () => {
    const gw = gateway({ align: () => { throw { kind: 'auth' }; } });
    await stageHeld();
    const outcome = await runCloudSyncIntent(inputs());
    expect(outcome.status).toBe('paused');
    if (outcome.status === 'paused') expect(outcome.faRun.reason).toBe('cloud-auth');
    expect(gw.releases).toEqual(['a1b2']);
  });
});

describe('Wave 3 U4.5 — the coverage gate runs inside the session, before any FA charge', () => {
  it('a mismatched script is hard-blocked: paused hopeless-local-coverage, NO alignment submitted, held container released', async () => {
    const gw = gateway();
    await stageHeld();
    const outcome = await runCloudSyncIntent(inputs({
      prepareSegments: async () => [seg('alpha beta gamma delta epsilon zeta eta theta iota kappa')],
      tokens: [{ text: 'completely', startSec: 0, endSec: 0.3 }, { text: 'different', startSec: 0.3, endSec: 0.6 }, { text: 'words', startSec: 0.6, endSec: 1 }],
    }));
    expect(outcome.status).toBe('paused');
    if (outcome.status === 'paused') expect(outcome.faRun.reason).toBe('hopeless-local-coverage');
    expect(gw.submits.filter(s => s.stage === 'align')).toHaveLength(0);
    expect(mockInvoke.mock.calls.filter(c => c[0] === 'cloud_cache_lookup' && (c[1] as { job: { stage: string } }).job.stage === 'align')).toHaveLength(0);
    expect(gw.releases).toEqual(['a1b2']);
  });

  it('offline mid-intent pauses as offline (after the one retry) — never silent', async () => {
    gateway({ align: () => { throw { kind: 'unreachable', detail: 'wifi off' }; } });
    await stageHeld();
    const outcome = await runCloudSyncIntent(inputs());
    expect(outcome.status).toBe('paused');
    if (outcome.status === 'paused') expect(outcome.faRun.reason).toBe('offline');
  });

  it('a scene doc with no scenes skips (and releases) — Apply Sync reports that in its own words', async () => {
    const gw = gateway();
    await stageHeld();
    expect(await runCloudSyncIntent(inputs({ prepareSegments: async () => [] }))).toMatchObject({ status: 'skipped' });
    expect(gw.releases).toEqual(['a1b2']);
  });
});

describe('Wave 3 U4.5 — intent registry (what the reveal waits on)', () => {
  it('one intent per spine: a second start returns the same run', async () => {
    const run = vi.fn(async () => ({ status: 'ready' as const, handedOff: true, cached: false }));
    const a = startSyncIntent(inputs(), run);
    const b = startSyncIntent(inputs(), run);
    expect(a).toBe(b);
    await a.promise;
    expect(run).toHaveBeenCalledTimes(1);
    expect(getSyncIntent(inputs().spineKey)).toMatchObject({ phase: 'ready', outcome: { status: 'ready' } });
  });

  it('phase follows the gateway\'s own job states, and subscribers hear it', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    gateway({ align: async (job) => { await gate; return { jobId: 'c3d4', stage: 'align', status: 'done', cached: false, audioDurationSec: 1, workerSec: 5, error: null, handedOff: Boolean(job.holdJobId), result: { words: WORDS, nChunks: 1, nFallbackChunks: 0, provenance: PROVENANCE, createdAt: 1 } }; } });
    const seen: string[] = [];
    const off = subscribeSyncIntents(() => { const e = getSyncIntent(inputs().spineKey); if (e) seen.push(e.phase); });
    const entry = startSyncIntent(inputs());
    expect(getSyncIntent(inputs().spineKey)!.phase).toBe('planning');
    release();
    await entry.promise;
    off();
    expect(seen.at(-1)).toBe('ready');
  });

  it('a spine change aborts the stale intent (its cached stages stay on the server)', async () => {
    const aborted = vi.fn();
    const stale = startSyncIntent(inputs({ spineKey: 'old' }), (_i, signal) => new Promise(resolve => {
      signal.addEventListener('abort', () => { aborted(); resolve({ status: 'cancelled' }); });
    }));
    cancelOtherSyncIntents('new');
    await stale.promise;
    expect(aborted).toHaveBeenCalled();
    expect(getSyncIntent('old')).toBeUndefined();
  });

  it('a skipped/cancelled intent can run again for the same spine; a ready one is final', async () => {
    startSyncIntent(inputs(), async () => ({ status: 'skipped' as const, reason: 'x' }));
    await getSyncIntent(inputs().spineKey)!.promise;
    expect(getSyncIntent(inputs().spineKey)).toBeUndefined();
  });
});
