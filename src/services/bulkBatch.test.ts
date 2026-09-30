// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7.5 — a bulk batch built from STAGED rows (script/scene/voiceover
// staged, nothing committed to the project) through the real queue, cloud job,
// intent and gateway wrapper. Only the Tauri IPC boundary is faked: a gateway
// that keeps an audio cache, honours holds and hand-offs like `sync_service.py`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannel<T> { onmessage: ((message: T) => void) | undefined; }
  return { Channel: FakeChannel, invoke: vi.fn() };
});
vi.mock('./whisperService', () => ({ transcribeWithProgress: vi.fn() }));
vi.mock('./syncEngine', () => ({ applyAnchorBasedTiming: (segments: unknown) => segments }));
vi.mock('./forcedAlignmentRun', async () => {
  const engine = await import('./cloudSyncEngine');
  return {
    runForcedAlignmentForSync: async (
      voiceover: { file: Blob }, _s: unknown, _t: unknown, _d: number, _l: unknown,
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
import { __resetCloudAudioInFlightForTests, __setCloudRetryDelayForTests, stageCloudAudioOnly } from './cloudSyncEngine';
import { __resetCancelReceiptsForTests } from './cloudCancelReceipts';
import { computeAudioHash } from './spine';
import type { StagedFiles } from '../components/DropZonePanel';
import type { Project } from '../types';

const mockInvoke = invoke as unknown as Mock;
const SCENE = '[a] one\n[b] two\n[c] three';

/** A bulk project as the batch finds it: EMPTY on disk, everything staged. */
const bare = (id: string): Project => ({
  id, name: `Bulk Project ${id}`, script: '', sceneDetails: '', language: 'en', faHighPrecisionSync: true,
  segments: [], assets: [], bulkContext: true,
} as unknown as Project);
const file = (name: string, body: string): File => new File([body], name);
const stagedRow = (id: string, over: Partial<StagedFiles> = {}): StagedFiles => ({
  scriptFile: { file: file('s.txt', `script ${id}`), key: 's' },
  sceneFile: { file: file('c.txt', SCENE), key: 'c' },
  voiceoverFile: { file: file('v.wav', `audio-of-${id}`), key: 'v' },
  assetFiles: [{ file: file('m.png', 'img'), key: 'm' }],
  zipFiles: [],
  ...over,
});

interface Sent { stage: string; hold?: boolean; holdJobId?: string; audioHash: string }
let wire: string[];
let sent: Sent[];
let onGateway: Set<string>;
let counter: number;
let blockTranscribeFor: string | undefined;
let everythingCached = false;
let cancelFlag: (() => void) | undefined;
const phasesByHash = new Map<string, string[]>();

function gateway(): void {
  counter = 0;
  mockInvoke.mockImplementation(async (cmd: string, args: { job?: Sent; jobId?: string; audioHash?: string; onEvent?: { onmessage: (e: unknown) => void } }) => {
    wire.push(cmd);
    switch (cmd) {
      case 'cloud_opus_cached': return null;
      case 'cloud_stage_audio_raw': return 'staged';
      case 'cloud_encode_opus': return 1000;
      case 'cloud_upload_audio': onGateway.add(args.audioHash!); return { uploaded: true, durationSec: 30, opusBytes: 1000 };
      case 'cloud_cache_lookup':
        if (everythingCached) {
          return { cached: true, result: args.job!.stage === 'transcribe'
            ? { tokens: [{ startSec: 0, endSec: 1, text: 'hi' }], detectedLanguage: 'en', provenance: { engine: 'whisper-cloud', model: 'm', modelVersion: 'v', language: 'en' }, createdAt: 1 }
            : { words: [], nChunks: 1, nFallbackChunks: 0, provenance: { engine: 'fa-cloud', model: 'm', modelVersion: 'v', language: 'en' }, createdAt: 1 } };
        }
        return { cached: false, audioPresent: onGateway.has(args.job!.audioHash), audioDurationSec: 30 };
      case 'cloud_release_job': return true;
      case 'cloud_cancel_run': cancelFlag?.(); return true;
      case 'cloud_run_job': {
        const job = args.job!;
        if (!onGateway.has(job.audioHash)) throw { kind: 'rejected', status: 404, code: 'audio-missing', detail: 'no audio' };
        args.onEvent?.onmessage({ type: 'submitted', jobId: 'jx', cached: false });
        if (job.stage === 'transcribe' && blockTranscribeFor === job.audioHash) {
          args.onEvent?.onmessage({ type: 'status', jobId: 'jx', status: 'running', elapsedSec: 1 });
          await new Promise<void>(resolve => { cancelFlag = resolve; });
          args.onEvent?.onmessage({ type: 'cancelled', jobId: 'jx', confirmed: true, started: true, workerSec: 12.3, estimatedUsd: 0.0026 });
          throw { kind: 'cancelled' };
        }
        args.onEvent?.onmessage({ type: 'status', jobId: 'jx', status: 'running', elapsedSec: 1 });
        sent.push({ stage: job.stage, hold: job.hold, holdJobId: job.holdJobId, audioHash: job.audioHash });
        const jobId = `j${++counter}`;
        return {
          jobId, stage: job.stage, status: 'done', cached: false, audioDurationSec: 30, workerSec: 10, error: null,
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

function depsFor(projects: Project[], rows: Map<string, StagedFiles>): CloudQueueDeps {
  return {
    loadProject: async id => { const p = projects.find(x => x.id === id); return p ? { project: p } : null; },
    loadVoiceover: async () => null,
    loadStaged: async id => rows.get(id) ?? null,
    probeDuration: async () => 30,
    parseProjectData: async () => [{ id: 's1' } as never],
  };
}

const settle = (q: SyncQueue) => vi.waitFor(() => expect(q.snapshot().running).toBe(false), { timeout: 5000 });

beforeEach(() => {
  mockInvoke.mockReset();
  __resetCloudAudioInFlightForTests();
  __resetCancelReceiptsForTests();
  __setCloudRetryDelayForTests(0);
  localStorage.clear();
  everythingCached = false; wire = []; sent = []; onGateway = new Set(); blockTranscribeFor = undefined; cancelFlag = undefined; phasesByHash.clear();
  gateway();
});

async function stageAllAudio(rows: Map<string, StagedFiles>): Promise<void> {
  for (const staged of rows.values()) {
    const f = staged.voiceoverFile!.file;
    await stageCloudAudioOnly(f, await computeAudioHash(f), { durationSec: 30 });
  }
}

describe('Wave 3 U7.5 — a batch of staged rows', () => {
  it('ONE container: T→A→T→A→T→A chained, the final align holds nothing; every job finds its audio already there, so the batch uploads NOTHING; zero meter-line-shaped traffic during staging', async () => {
    const ps = [bare('A'), bare('B'), bare('C')];
    const rows = new Map(ps.map(p => [p.id, stagedRow(p.id)]));
    await stageAllAudio(rows);
    // The staging window: three uploads, no job, no lookup.
    expect(wire.filter(c => c === 'cloud_upload_audio')).toHaveLength(3);
    expect(wire).not.toContain('cloud_run_job');
    expect(wire).not.toContain('cloud_cache_lookup');

    wire.length = 0;
    const q = new SyncQueue(cloudQueueEngine);
    q.enqueue(ps.map(p => createCloudProjectJob(p, depsFor(ps, rows))));
    await settle(q);
    expect(q.snapshot().items.map(i => i.status)).toEqual(['done', 'done', 'done']);
    expect(sent.map(s => [s.stage, s.hold ?? false, s.holdJobId ?? null])).toEqual([
      ['transcribe', true, null], ['align', true, 'j1'],
      ['transcribe', true, 'j2'], ['align', true, 'j3'],
      ['transcribe', true, 'j4'], ['align', false, 'j5'],
    ]);
    // Pre-uploaded audio: lookup-hit-skip-upload per job.
    expect(wire).not.toContain('cloud_upload_audio');
    expect(wire).not.toContain('cloud_encode_opus');
    // One batch cost line: 6 jobs x 10 s.
    expect(q.snapshot().batch?.workerSec).toBe(60);
    expect(q.batchLine()).toMatch(/^3 projects: 3 built · about \$0\.\d+ of cloud GPU \(60 s worked\)$/);
    expect(q.snapshot().items.map(i => i.workerSec)).toEqual([20, 20, 20]);
  });

  it('audio that did NOT get pre-staged (offline at drop time) is uploaded by its own job, once — the eager step is an optimisation, never a requirement', async () => {
    const ps = [bare('A')];
    const rows = new Map([['A', stagedRow('A')]]);
    const q = new SyncQueue(cloudQueueEngine);
    q.enqueue([createCloudProjectJob(ps[0]!, depsFor(ps, rows))]);
    await settle(q);
    expect(q.snapshot().items[0]!.status).toBe('done');
    expect(wire.filter(c => c === 'cloud_upload_audio')).toHaveLength(1);
  });

  it('an incomplete row is skipped with its stated reason and never touches the wire (a bundle-less row with no media here)', async () => {
    const ps = [bare('A'), bare('B')];
    const rows = new Map([['A', stagedRow('A')], ['B', stagedRow('B', { assetFiles: [], sceneFile: null })]]);
    await stageAllAudio(rows);
    wire.length = 0;
    const q = new SyncQueue(cloudQueueEngine);
    q.enqueue(ps.map(p => createCloudProjectJob(p, depsFor(ps, rows))));
    await settle(q);
    const [a, b] = q.snapshot().items;
    expect(a!.status).toBe('done');
    expect(b).toMatchObject({ status: 'skipped' });
    expect(b!.detail).toBe('Can’t sync yet: Add a scene doc to build the timeline.');
    // B never reached the wire; the container A kept for it was let go at once.
    expect(sent.map(s => s.stage)).toEqual(['transcribe', 'align']);
    expect(wire.filter(c => c === 'cloud_run_job')).toHaveLength(2);
    expect(wire).toContain('cloud_release_job');
  });

  it('cancel mid-batch: the running row gets its U5 receipt, its chain is dropped, the queue continues with the next row', async () => {
    const ps = [bare('A'), bare('B'), bare('C')];
    const rows = new Map(ps.map(p => [p.id, stagedRow(p.id)]));
    await stageAllAudio(rows);
    blockTranscribeFor = await computeAudioHash(rows.get('B')!.voiceoverFile!.file);
    const q = new SyncQueue(cloudQueueEngine);
    q.enqueue(ps.map(p => createCloudProjectJob(p, depsFor(ps, rows))));
    await vi.waitFor(() => expect(cancelFlag).toBeTypeOf('function'), { timeout: 5000 });
    q.cancel('B');
    await settle(q);
    const items = q.snapshot().items;
    expect(items.map(i => i.status)).toEqual(['done', 'cancelled', 'done']);
    expect(items[1]!.receipt).toContain('12.3 s');
    const c = sent.filter(s => s.audioHash !== blockTranscribeFor).slice(2);
    expect(c[0]!.holdJobId).toBeUndefined(); // the chain broke with the cancel: C boots on its own
  });

  it('the per-row phase feed follows the gateway: waiting for a cloud GPU -> transcribing -> aligning', async () => {
    const ps = [bare('A')];
    const rows = new Map([['A', stagedRow('A')]]);
    await stageAllAudio(rows);
    const seen: string[] = [];
    const q = new SyncQueue(cloudQueueEngine);
    q.subscribe(() => { const p = q.snapshot().items[0]?.phase; if (p && seen.at(-1) !== p) seen.push(p); });
    q.enqueue([createCloudProjectJob(ps[0]!, depsFor(ps, rows))]);
    await settle(q);
    expect(seen).toEqual(expect.arrayContaining(['Waiting for a cloud GPU…', 'Transcribing on the cloud…', 'Aligning on the cloud…']));
    const at = (text: string, from: number): number => seen.indexOf(text, from);
    const w = at('Waiting for a cloud GPU…', 0);
    const t = at('Transcribing on the cloud…', w);
    const a = at('Aligning on the cloud…', t);
    expect([w, t, a].every(i => i >= 0)).toBe(true);
  });
});

describe('Wave 3 U7.5 — restart mid-batch', () => {
  it('a fresh queue does NOT restart the batch; a rebuild after the server finished is all cache hits (no job, no upload, no GPU)', async () => {
    const ps = [bare('R1'), bare('R2')];
    const rows = new Map(ps.map(p => [p.id, stagedRow(p.id)]));
    // "Restart": nothing in memory. (The staged rows' own persistence is
    // bulkRowsPersist.test.ts, against the real store.)
    const fresh = new SyncQueue(cloudQueueEngine);
    expect(fresh.snapshot()).toMatchObject({ items: [], running: false, batch: null });
    expect(wire).toEqual([]); // no auto-restart: nothing was sent

    // The in-flight jobs finished server-side into the cache; the per-project
    // click (or a re-run) now only reads it.
    everythingCached = true;
    fresh.enqueue(ps.map(p => createCloudProjectJob(p, depsFor(ps, rows))));
    await settle(fresh);
    expect(fresh.snapshot().items.map(i => i.status)).toEqual(['done', 'done']);
    expect(wire).not.toContain('cloud_run_job');
    expect(wire).not.toContain('cloud_upload_audio');
    expect(fresh.snapshot().batch?.workerSec).toBe(0);
    expect(fresh.batchLine()).toContain('no cloud GPU time used');
  });
});
