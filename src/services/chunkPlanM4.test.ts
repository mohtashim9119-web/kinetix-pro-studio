/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// M4 discipline — the permanent net under the amount-drop fix.
//
//  (b) Chunk plans for v6 and 173 stay BYTE-EQUAL to pre-F1. Spanish is the
//      one F1 re-key: an over-cap silence-bounded window is now split at a
//      word near the midpoint (5→6 chunks). Amount-bearing 14-seg exceptions
//      stay pinned as before.
//  (c) A plan built by the BATCH path (`runCloudSyncIntent`, the bulk queue's
//      unit of work) and by the DIRECT path (`runForcedAlignmentForSync`, what
//      Apply Sync calls) is the same chunk array — hence the same plan hash and
//      the same gateway alignment key — for both engines' dialects.
//      The plan hash is `cloud/sync_core.py::chunk_plan_hash`'s own input string
//      hashed here; `cloud/test_plan_hash_keys.py` checks the Python side of the
//      same committed constants, so TS and Python agree by construction.
//  (d) Restart stability: rebuilding every plan from a FRESH module graph, in a
//      different order, gives the identical plan (no process-local state — memo,
//      Map order, clock, id — leaks into what is sent to the gateway).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannel<T> { onmessage: (message: T) => void = () => {}; }
  return { Channel: FakeChannel, invoke: vi.fn() };
});
vi.mock('./silenceDetector', () => {
  const fixture = JSON.parse(readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'fixtures', 'amount-14seg-silences.json'), 'utf-8',
  )) as { silences: unknown[] };
  return {
    detectSilences: vi.fn(async () => ({ status: 'ok', silences: fixture.silences })),
    detectSilencesSingleFlight: vi.fn(async () => ({ status: 'ok', silences: fixture.silences })),
  };
});

import { invoke } from '@tauri-apps/api/core';
import { parseProjectData } from '../App';
import { applyAnchorBasedTiming } from './syncEngine';
import { runForcedAlignmentForSync } from './forcedAlignmentRun';
import { runCloudSyncIntent } from './cloudSyncIntent';
import { __resetCloudAudioInFlightForTests, __setCloudRetryDelayForTests } from './cloudSyncEngine';
import { computeFaChunkPlan } from './faChunkPlan';
import { loadFaLanguageData } from './faLanguageData';
import { CORPORA, buildCorpusPlan, planHash, type CorpusKey, type PlanChunk } from '../../scripts/chunkPlanCorpora';
import type { Asset, TranscriptToken, VideoSegment } from '../types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = (n: string): string => resolve(ROOT, 'scripts', 'fixtures', n);

interface M4Fixture {
  corpora: Record<string, { prod: { chunks: number; digest: string }; raw: { chunks: number; digest: string }; planHash: string }>;
  amountBearing: Record<string, {
    before: { planHash: string; chunks: PlanChunk[] };
    after: { planHash: string; chunks: PlanChunk[] };
    changedChunkIndexes: number[];
  }>;
}
const m4 = JSON.parse(readFileSync(FIX('m4-chunk-plan-digests.json'), 'utf-8')) as M4Fixture;

const DURATION = 32.69;
const HASH = 'ab5e4f1864cf92ccb9b24555a97bc329ad25907de99a49cc7bd87dd2414f9983';
const tokensOf = (engine: 'cloud' | 'local'): TranscriptToken[] =>
  (JSON.parse(readFileSync(FIX(`amount-14seg-${engine}-tokens.json`), 'utf-8')) as { tokens: TranscriptToken[] }).tokens;
const silences14 = (JSON.parse(readFileSync(FIX('amount-14seg-silences.json'), 'utf-8')) as { silences: Array<{ startSec: number; endSec: number }> }).silences;

async function segments14(): Promise<VideoSegment[]> {
  const parsed = await parseProjectData(
    readFileSync(FIX('amount-14seg-script.txt'), 'utf-8'), readFileSync(FIX('amount-14seg-scene-details.txt'), 'utf-8'), [], DURATION,
  );
  return applyAnchorBasedTiming(parsed, DURATION);
}

describe('(b) M4 — v6 / 173 / Spanish chunk plans are byte-equal to the pre-fix plans', () => {
  for (const key of Object.keys(CORPORA) as CorpusKey[]) {
    for (const shape of ['prod', 'raw'] as const) {
      it(`${key} (${shape})`, () => {
        const plan = buildCorpusPlan(key, shape);
        const want = m4.corpora[key]![shape];
        expect(plan).toHaveLength(want.chunks);
        expect(planHash(plan).slice(0, 16)).toBe(want.digest);
      }, 120_000);
    }
    it(`${key}: the plan hash the gateway keys on is the recorded one`, () => {
      expect(planHash(buildCorpusPlan(key, 'prod'))).toBe(m4.corpora[key]!.planHash);
    }, 120_000);
  }
});

describe('(b) the ONLY plans that changed are amount-bearing — each exception pinned', () => {
  const AMOUNT_WORDS = /\b(?:eleven thousand dollars|nine thousand four hundred dollars)\b ?/g;
  for (const engine of ['cloud', 'local'] as const) {
    it(`14-segment project, ${engine} transcript`, async () => {
      const data = loadFaLanguageData('en')!;
      const now = computeFaChunkPlan(await segments14(), tokensOf(engine), silences14, DURATION, undefined, 'en', data.vocabChars, data.cardinalData);
      const rec = m4.amountBearing[`14seg-${engine}`]!;
      expect(planHash(now)).toBe(rec.after.planHash);
      expect(planHash(now)).not.toBe(rec.before.planHash);

      const changed = now.flatMap((c, i) => (JSON.stringify(c) === JSON.stringify(rec.before.chunks[i]) ? [] : [i]));
      expect(changed).toEqual(rec.changedChunkIndexes);
      // Same windows, same count; the text differs by the amount words alone.
      expect(now).toHaveLength(rec.before.chunks.length);
      for (const i of changed) {
        expect(now[i]!.startSec).toBe(rec.before.chunks[i]!.startSec);
        expect(now[i]!.endSec).toBe(rec.before.chunks[i]!.endSec);
        expect(now[i]!.text.replace(AMOUNT_WORDS, '')).toBe(rec.before.chunks[i]!.text);
        expect(now[i]!.text).toMatch(AMOUNT_WORDS);
      }
    });
  }
});

describe('(c) direct-vs-batch — the same plan, hence the same plan hash and alignment key', () => {
  const mockInvoke = invoke as unknown as Mock;
  const asset = (): Asset => ({
    id: 'vo1', name: 'voiceover.mp3', url: 'blob:vo', type: 'audio', duration: DURATION,
    file: new File([new Uint8Array([1, 2, 3, 4])], 'voiceover.mp3', { type: 'audio/mpeg' }),
  });
  const WORDS = [{ word: 'you', startSec: 0.1, endSec: 0.4, confidence: 0.9, needsReview: false, wordIndex: 0 }];
  const PROV = { engine: 'fa-cloud', model: 'm/en', modelVersion: 'v', language: 'en' };
  let sent: Array<{ audioHash: string; language: string; chunks: PlanChunk[] }>;

  beforeEach(() => {
    sent = [];
    mockInvoke.mockReset();
    __resetCloudAudioInFlightForTests();
    __setCloudRetryDelayForTests(0);
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      switch (cmd) {
        case 'cloud_cache_lookup': return { cached: false, audioPresent: true, audioDurationSec: DURATION };
        case 'cloud_opus_cached': return 1234;
        case 'cloud_upload_audio': return { uploaded: false, durationSec: DURATION, opusBytes: 1234 };
        case 'cloud_run_job': {
          sent.push((args as { job: (typeof sent)[number] }).job);
          return { jobId: 'j', stage: 'align', status: 'done', cached: false, audioDurationSec: DURATION, workerSec: 1, error: null,
            result: { words: WORDS, nChunks: 1, nFallbackChunks: 0, provenance: PROV, createdAt: 1 } };
        }
        case 'cloud_cancel_run': return true;
        default: throw new Error(`unexpected command on the cloud arm: ${cmd}`);
      }
    });
  });

  for (const engine of ['cloud', 'local'] as const) {
    it(`${engine} dialect: Apply Sync's call and the bulk queue's call send one identical plan`, async () => {
      const tokens = tokensOf(engine);

      await runForcedAlignmentForSync(asset(), await segments14(), tokens, DURATION, 'en', undefined, HASH, undefined, 'cloud');
      const direct = sent.pop()!;

      const outcome = await runCloudSyncIntent({
        spineKey: `${HASH}|script|cloud:fa`, voiceover: asset(), audioHash: HASH, audioDurationSec: DURATION,
        tokens, language: 'en', prepareSegments: segments14,
      });
      expect(outcome.status).toBe('ready');
      const batch = sent.pop()!;

      expect(batch).toEqual(direct);
      expect(planHash(batch.chunks)).toBe(planHash(direct.chunks));
      // ...and it is the very plan the fixture records for that engine.
      expect(planHash(direct.chunks)).toBe(m4.amountBearing[`14seg-${engine}`]!.after.planHash);
      expect(direct.audioHash).toBe(HASH);
      expect(direct.language).toBe('en');
    });
  }
});

describe('(d) restart stability — a fresh module graph rebuilds the identical plans', () => {
  it('every corpus plan is identical across a reset, and independent of build order', async () => {
    const forward: Record<string, string> = {};
    for (const key of Object.keys(CORPORA) as CorpusKey[]) forward[key] = planHash(buildCorpusPlan(key, 'prod'));

    vi.resetModules();
    const fresh = await import('../../scripts/chunkPlanCorpora');
    const reversed: Record<string, string> = {};
    for (const key of (Object.keys(CORPORA) as CorpusKey[]).reverse()) reversed[key] = fresh.planHash(fresh.buildCorpusPlan(key, 'prod'));

    expect(reversed).toEqual(forward);
    for (const key of Object.keys(CORPORA)) expect(forward[key]).toBe(m4.corpora[key]!.planHash);
  }, 120_000);
});
