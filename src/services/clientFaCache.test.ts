/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { FaWordSpan } from './faBoundaryTypes';
import { makeClientFaCache, planHashOf, readClientFaCache, withClientFaCache } from './clientFaCache';
import { runForcedAlignmentForSync } from './forcedAlignmentRun';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock('./silenceDetector', () => ({
  detectSilencesSingleFlight: vi.fn(async () => ({ status: 'ok', silences: [] })),
}));
vi.mock('./faChunkPlan', () => ({
  computeFaChunkPlan: vi.fn(() => [{ startSec: 0, endSec: 1, text: 'hello' }]),
  computeUnscriptedRuns: vi.fn(() => []),
  computeRunContextAsync: vi.fn(async () => undefined),
}));
vi.mock('./cloudSyncEngine', async () => {
  const actual = await vi.importActual<typeof import('./cloudSyncEngine')>('./cloudSyncEngine');
  return { ...actual, alignViaCloud: vi.fn() };
});

import { alignViaCloud } from './cloudSyncEngine';

const WORDS: FaWordSpan[] = [
  { word: 'hello', startSec: 0.1, endSec: 0.4, confidence: 0.9, needsReview: false, wordIndex: 0 },
];

const key = {
  audioHash: 'a', scriptHash: 's', engineKey: 'e',
  planHash: planHashOf([{ startSec: 0, endSec: 1, text: 'hello' }]),
};

describe('client FA cache', () => {
  it('serves byte-identical timings when every hash matches, and re-keys otherwise', () => {
    const cache = makeClientFaCache(key, WORDS, 'fa-cloud client-cache@k');
    expect(readClientFaCache(cache, key)).toEqual(WORDS);
    expect(readClientFaCache(cache, { ...key, planHash: 'other' })).toBeNull();
    expect(readClientFaCache(cache, { ...key, scriptHash: 'edited' })).toBeNull();
    expect(readClientFaCache(cache, { ...key, engineKey: 'local' })).toBeNull();
    expect(readClientFaCache(cache, { ...key, audioHash: 'new-audio' })).toBeNull();
  });

  it('a cached Build Timeline does not call the cloud aligner', async () => {
    const cache = makeClientFaCache(key, WORDS, 'fa-cloud m@v');
    const asset = { id: 'v', name: 'v.wav', url: '', type: 'audio' as const, file: new File(['x'], 'v.wav') };
    const segment = { id: 's', text: 'hello', startTime: 0, duration: 1, order: 0 } as never;
    const result = await withClientFaCache({ cache, scriptHash: key.scriptHash, engineKey: key.engineKey }, () =>
      runForcedAlignmentForSync(asset, [segment], [{ text: 'hello', startSec: 0, endSec: 1 }], 1, 'en', undefined, key.audioHash, true, 'cloud'),
    );
    expect(alignViaCloud).not.toHaveBeenCalled();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.tokens.map(t => t.text)).toEqual(['hello']);
      expect(result.cloudCached).toBe(true);
    }
  });
});
