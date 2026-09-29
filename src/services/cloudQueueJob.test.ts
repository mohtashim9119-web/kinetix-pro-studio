// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7 — three real projects through the real queue, cloud job, engine,
// intent and gateway wrapper; only the Tauri IPC boundary (a fake gateway
// that honours holds and hand-offs like `sync_service.py`) and the local
// alignment/segment code are faked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannel<T> {
    onmessage: ((message: T) => void) | undefined;
  }
  return { Channel: FakeChannel, invoke: vi.fn() };
});
vi.mock('./whisperService', () => ({ transcribeWithProgress: vi.fn() }));
vi.mock('./syncEngine', () => ({ applyAnchorBasedTiming: (segments: unknown) => segments }));
// The cloud call inside Apply Sync's aligner is the REAL `alignViaCloud`; only
// the local planning around it (coverage gate, chunk plan) is stood in for.
vi.mock('./forcedAlignmentRun', async () => {
  const engine = await import('./cloudSyncEngine');
  return {
    runForcedAlignmentForSync: async (
      voiceover: { file: Blob }, _segs: unknown, _tokens: unknown, _dur: number, _lang: unknown,
      signal: AbortSignal | undefined, audioHash: string,
    ) => {
      const out = await engine.alignViaCloud({
        voiceoverBlob: voiceover.file, audioHash, chunks: [{ startSec: 0, endSec: 1, text: 'x' }], language: 'en', signal,
      });
      if (out.status === 'cancelled') return { status: 'cancelled' };
      if (out.status === 'failed') return { status: 'paused', reason: 'offline', detail: out.error.kind };
      return { status: 'ok', cloudHandedOff: out.handedOff, cloudCached: out.cached };
    },
  };
});

import { invoke } from '@tauri-apps/api/core';
import { SyncQueue } from './syncQueue';
import { cloudQueueEngine, createCloudProjectJob, type CloudQueueDeps } from './cloudQueueJob';
import { __resetCloudAudioInFlightForTests, __setCloudRetryDelayForTests } from './cloudSyncEngine';
import { __resetCancelReceiptsForTests } from './cloudCancelReceipts';
import { readFaPause } from './faSyncPauseStore';
import type { Project } from '../types';

const mockInvoke = invoke as unknown as Mock;

const project = (id: string): Project => ({
  id, name: `Project ${id}`, script: `script ${id}`, sceneDetails: `scenes ${id}`, voiceoverId: 'v',
  language: 'en', faHighPrecisionSync: true, segments: [],
  assets: [
    { id: 'v', name: 'v.wav', url: '', type: 'audio', duration: 60 },
    { id: 'm', name: 'm.mp4', url: '', type: 'video', duration: 5 },
  ],
} as unknown as Project);

const deps = (projects: Project[]): CloudQueueDeps => ({
  loadProject: async id => {
    const p = projects.find(x => x.id === id);
    return p ? { project: p } : null;
  },
  // Distinct bytes per project: distinct content hash per project.
  loadVoiceover: async p => new File([new TextEncoder().encode(`audio-of-${p.id}`)], 'v.wav'),
  parseProjectData: async () => [{ id: 's1' } as never],
});

interface Sent { stage: string; hold?: boolean; holdJobId?: string; audioHash: string }
let sent: Sent[];
let released: string[];
let failTranscribeFor: string | undefined;
let blockTranscribeFor: string | undefined;
let cancelFlag: (() => void) | undefined;
let counter: number;
const hashOf = new Map<string, string>();

function fakeGateway(): void {
  counter = 0;
  mockInvoke.mockImplementation(async (cmd: string, args: { job?: Sent; jobId?: string }) => {
    switch (cmd) {
      case 'cloud_cache_lookup': return { cached: false, audioPresent: true, audioDurationSec: 60 };
      case 'cloud_release_job': released.push(args.jobId!); return true;
      case 'cloud_cancel_run': cancelFlag?.(); return true;
      case 'cloud_run_job': {
        const job = args.job!;
        if (job.stage === 'transcribe' && blockTranscribeFor && job.audioHash === blockTranscribeFor) {
          // A job on the GPU until the app cancels it; the gateway then answers with U5's receipt.
          await new Promise<void>(resolve => { cancelFlag = resolve; });
          (args as unknown as { onEvent: { onmessage: (e: unknown) => void } }).onEvent.onmessage({
            type: 'cancelled', jobId: 'jx', confirmed: true, started: true, workerSec: 12.3, estimatedUsd: 0.0026,
          });
          throw { kind: 'cancelled' };
        }
        sent.push({ stage: job.stage, hold: job.hold, holdJobId: job.holdJobId, audioHash: job.audioHash });
        if (job.stage === 'transcribe' && failTranscribeFor && job.audioHash === failTranscribeFor) throw { kind: 'auth' };
        const jobId = `j${++counter}`;
        return {
          jobId, stage: job.stage, status: 'done', cached: false, audioDurationSec: 60, workerSec: 10, error: null,
          handedOff: Boolean(job.holdJobId),
          result: job.stage === 'transcribe'
            ? { tokens: [{ startSec: 0, endSec: 1, text: 'hi' }], detectedLanguage: 'en', provenance: { engine: 'whisper-cloud', model: 'm', modelVersion: 'v', language: 'en' }, createdAt: 1 }
            : { words: [], nChunks: 1, nFallbackChunks: 0, provenance: { engine: 'fa-cloud', model: 'm', modelVersion: 'v', language: 'en' }, createdAt: 1 },
        };
      }
      default: throw new Error(cmd);
    }
  });
}

const settle = (q: SyncQueue) => vi.waitFor(() => expect(q.snapshot().running).toBe(false), { timeout: 5000 });

beforeEach(() => {
  mockInvoke.mockReset();
  __resetCloudAudioInFlightForTests();
  __resetCancelReceiptsForTests();
  __setCloudRetryDelayForTests(0);
  localStorage.clear();
  sent = []; released = []; failTranscribeFor = undefined; blockTranscribeFor = undefined; cancelFlag = undefined; hashOf.clear();
  fakeGateway();
});

describe('Wave 3 U7 — three projects, one container', () => {
  it('chains transcribe→align→transcribe→align… through ONE held container: every job after the first is handed over, nothing is released early, the last does not hold', async () => {
    const ps = [project('A'), project('B'), project('C')];
    const q = new SyncQueue(cloudQueueEngine);
    q.enqueue(ps.map(p => createCloudProjectJob(p, deps(ps))));
    await settle(q);
    expect(q.snapshot().items.map(i => i.status)).toEqual(['done', 'done', 'done']);
    // Job ids are j1..j6 in run order: A.t=j1 A.a=j2 B.t=j3 B.a=j4 C.t=j5 C.a=j6.
    expect(sent.map(s => [s.stage, s.hold ?? false, s.holdJobId ?? null])).toEqual([
      ['transcribe', true, null],   // A: opens the container, keeps it for its own alignment
      ['align', true, 'j1'],        // A: aligned in that container; B is behind, so keep it
      ['transcribe', true, 'j2'],   // B: handed A's container — no second boot
      ['align', true, 'j3'],
      ['transcribe', true, 'j4'],   // C: still the same container
      ['align', false, 'j5'],       // C is last: nothing behind, so nothing kept
    ]);
    expect(released).toEqual([]);
    // Six jobs at 10 s each, priced at the rate card, in one batch line.
    expect(q.snapshot().batch?.workerSec).toBe(60);
    expect(q.batchLine()).toMatch(/^3 projects: 3 built · about \$0\.\d+ of cloud GPU \(60 s worked\)$/);
  });

  it('a project that fails pauses ITSELF (restart-safe record saved), the container it was handed is let go, and the queue carries on with the rest', async () => {
    const ps = [project('A'), project('B'), project('C')];
    const d = deps(ps);
    const q = new SyncQueue(cloudQueueEngine);
    // Fail B's transcription: find B's hash the same way the job computes it.
    const { computeAudioHash } = await import('./spine');
    failTranscribeFor = await computeAudioHash(new File([new TextEncoder().encode('audio-of-B')], 'v.wav'));
    q.enqueue(ps.map(p => createCloudProjectJob(p, d)));
    await settle(q);
    expect(q.snapshot().items.map(i => i.status)).toEqual(['done', 'paused', 'done']);
    expect(q.snapshot().items[1]!.reason).toBe('cloud-auth');
    const record = readFaPause('B');
    expect(record).toMatchObject({ projectId: 'B', reason: 'cloud-auth', host: 'cloud', stage: 'transcribe' });
    // A's kept container was not used by B, so it was released, not left idle…
    expect(released).toEqual(['j2']);
    // …and C ran on its own (a second boot), starting a fresh chain.
    const c = sent.filter(s => s.audioHash !== failTranscribeFor).slice(2);
    expect(c[0]).toMatchObject({ stage: 'transcribe', hold: true });
    expect(c[0]!.holdJobId).toBeUndefined();
    expect(q.snapshot().items[2]!.status).toBe('done');
  });

  it('cancelling a queued project before it starts: no cloud job for it, nothing charged, the others chain on', async () => {
    const ps = [project('A'), project('B'), project('C')];
    const q = new SyncQueue(cloudQueueEngine);
    let releaseFirst!: () => void;
    const held = new Promise<void>(r => { releaseFirst = r; });
    const d = deps(ps);
    const realLoad = d.loadVoiceover;
    d.loadVoiceover = async (p, a) => { if (p.id === 'A') await held; return realLoad(p, a); };
    q.enqueue(ps.map(p => createCloudProjectJob(p, d)));
    await vi.waitFor(() => expect(q.snapshot().items[0]!.status).toBe('running'));
    q.cancel('B');
    expect(q.snapshot().items[1]).toMatchObject({ status: 'cancelled', receipt: 'It hadn’t started, so nothing was charged.' });
    releaseFirst();
    await settle(q);
    expect(q.snapshot().items.map(i => i.status)).toEqual(['done', 'cancelled', 'done']);
    // A (with C behind) kept its container; C picked it up. B never touched the wire.
    expect(sent.map(s => s.stage)).toEqual(['transcribe', 'align', 'transcribe', 'align']);
    expect(sent[2]!.holdJobId).toBe('j2');
    expect(q.batchLine()).toContain('2 built, 1 cancelled');
  });

  it('cancelling the project that is RUNNING mid-queue: U5 receipt on its row, its chain is dropped, the next project still builds', async () => {
    const ps = [project('A'), project('B'), project('C')];
    const { computeAudioHash } = await import('./spine');
    blockTranscribeFor = await computeAudioHash(new File([new TextEncoder().encode('audio-of-B')], 'v.wav'));
    const q = new SyncQueue(cloudQueueEngine);
    q.enqueue(ps.map(p => createCloudProjectJob(p, deps(ps))));
    // B is on the GPU (its transcription is in flight) once A has finished.
    await vi.waitFor(() => expect(cancelFlag).toBeTypeOf('function'), { timeout: 5000 });
    expect(q.snapshot().items.map(i => i.status)).toEqual(['done', 'running', 'queued']);
    q.cancel('B');
    await settle(q);
    const items = q.snapshot().items;
    expect(items.map(i => i.status)).toEqual(['done', 'cancelled', 'done']);
    expect(items[1]!.receipt).toContain('The cloud had already worked 12.3 s on transcription');
    expect(items[1]!.receipt).toContain('billed');
    // The queue kept going: C built, on a fresh container (the chain broke with the cancel).
    const c = sent.filter(s => s.audioHash !== blockTranscribeFor).slice(2);
    expect(c[0]!.holdJobId).toBeUndefined();
    expect(q.batchLine()).toContain('2 built, 1 cancelled');
  });

  it('an incomplete project (no media) is skipped with the reason — never a failure, never a job', async () => {
    const p = project('A');
    p.assets = p.assets.filter(a => a.type === 'audio');
    const q = new SyncQueue(cloudQueueEngine);
    q.enqueue([createCloudProjectJob(p, deps([p]))]);
    await settle(q);
    expect(q.snapshot().items[0]).toMatchObject({ status: 'skipped' });
    expect(q.snapshot().items[0]!.detail).toContain('Add media to build the timeline');
    expect(sent).toEqual([]);
  });

  it('FA off for a project: transcript only, no alignment, no container kept', async () => {
    const p = project('A');
    p.faHighPrecisionSync = false;
    const q = new SyncQueue(cloudQueueEngine);
    q.enqueue([createCloudProjectJob(p, deps([p]))]);
    await settle(q);
    expect(sent.map(s => [s.stage, s.hold ?? false])).toEqual([['transcribe', false]]);
    expect(q.snapshot().items[0]!.status).toBe('done');
  });
});
