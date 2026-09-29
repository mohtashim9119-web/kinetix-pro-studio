/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U6 — the one-hour audio cap, client layer. Real `cloudSyncEngine` +
// `cloudGateway` + `cloudCancelReceipts`; only the Tauri IPC boundary is
// mocked. Every "refused" test asserts the IPC log: a refusal is free — no
// lookup, no staging, no encode, no upload, no job (so no meter line and no
// cancel receipt).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannel<T> {
    onmessage: ((message: T) => void) | undefined;
  }
  return { Channel: FakeChannel, invoke: vi.fn() };
});
vi.mock('./whisperService', () => ({
  transcribeWithProgress: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import {
  CloudStageError,
  __resetCloudAudioInFlightForTests,
  __setCloudRetryDelayForTests,
  runStageCacheFirst,
  transcribeForHost,
} from './cloudSyncEngine';
import { describeCloudError, type CloudError } from './cloudGateway';
import { __resetCancelReceiptsForTests, takeCancelReceiptsSince } from './cloudCancelReceipts';
import {
  AUDIO_DURATION_TOLERANCE_SEC,
  MAX_AUDIO_SEC,
  MAX_UPLOAD_BYTES,
  OPUS_HOUR_BYTES,
  estimateOpusSec,
  tooLongMessage,
} from './cloudAudioLimit';
import type { Asset } from '../types';

const mockInvoke = invoke as unknown as Mock;
const HASH = 'e'.repeat(64);

const asset = (): Asset => ({
  id: 'a', name: 'vo.wav', url: 'blob:x', type: 'audio',
  file: new File([new Uint8Array([1, 2, 3])], 'vo.wav'),
});

const DONE = {
  jobId: 'j', stage: 'transcribe', status: 'done', cached: false, audioDurationSec: 60, workerSec: 40, error: null,
  result: { tokens: [], detectedLanguage: 'en', provenance: { engine: 'whisper-cloud', model: 'm', modelVersion: 'v', language: 'en' }, createdAt: 1 },
};

/** A gateway that has nothing cached and does not hold the audio. */
function gateway(opts: { opusCached?: number | null; encodedBytes?: number } = {}): void {
  const { opusCached = null, encodedBytes = 1000 } = opts;
  mockInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'cloud_cache_lookup': return { cached: false, audioPresent: false, audioDurationSec: null };
      case 'cloud_opus_cached': return opusCached;
      case 'cloud_stage_audio_raw': return HASH;
      case 'cloud_encode_opus': return encodedBytes;
      case 'cloud_upload_audio': return { uploaded: true, durationSec: 60, opusBytes: encodedBytes };
      case 'cloud_run_job': return DONE;
      case 'cloud_cancel_run': return true;
      default: throw new Error(cmd);
    }
  });
}

const commands = (): string[] => mockInvoke.mock.calls.map(c => c[0] as string);

const transcribe = (durationSecs: number, signal = new AbortController().signal) =>
  transcribeForHost({
    host: 'cloud', asset: asset(), durationSecs, language: undefined, onProgress: () => {}, signal, audioHash: HASH,
  });

beforeEach(() => {
  mockInvoke.mockReset();
  __resetCloudAudioInFlightForTests();
  __resetCancelReceiptsForTests();
  __setCloudRetryDelayForTests(0);
});

describe('Wave 3 U6 — client pre-flight: duration', () => {
  it('OLD BUG: a 1h05 voiceover was encoded and uploaded unchecked; now it is refused with nothing sent', async () => {
    gateway();
    const err = await transcribe(3900).catch(e => e);
    expect(err).toBeInstanceOf(CloudStageError);
    expect((err as CloudStageError).cloud.kind).toBe('tooLong');
    expect(commands()).toEqual([]); // not even the (free) cache lookup
    expect(commands()).not.toContain('cloud_encode_opus');
    expect(commands()).not.toContain('cloud_upload_audio');
    expect(commands()).not.toContain('cloud_run_job');
  });

  it('the refusal names the length in hours and says what to do', async () => {
    gateway();
    const err = (await transcribe(5040).catch(e => e)) as CloudStageError; // 1.4 h
    expect(err.message).toContain('This voiceover is about 1.4 hours');
    expect(err.message).toContain('the cloud sync supports up to 1 hour');
    expect(err.message).toContain('Split it or use Local.');
    expect((err.cloud as { detail: string }).detail).toBe(tooLongMessage(5040));
    expect(describeCloudError(err.cloud)).toBe(tooLongMessage(5040));
  });

  it('exactly one hour is allowed (encoded, uploaded, run), and so is the gateway\'s own 1 s probe tolerance', async () => {
    for (const seconds of [MAX_AUDIO_SEC, MAX_AUDIO_SEC + AUDIO_DURATION_TOLERANCE_SEC]) {
      mockInvoke.mockReset();
      __resetCloudAudioInFlightForTests();
      gateway();
      await transcribe(seconds);
      expect(commands()).toEqual([
        'cloud_cache_lookup', 'cloud_opus_cached', 'cloud_stage_audio_raw', 'cloud_encode_opus', 'cloud_upload_audio', 'cloud_run_job',
      ]);
    }
  });

  it('just over one hour is refused', async () => {
    gateway();
    const err = await transcribe(MAX_AUDIO_SEC + AUDIO_DURATION_TOLERANCE_SEC + 0.5).catch(e => e);
    expect((err as CloudStageError).cloud.kind).toBe('tooLong');
    expect(commands()).toEqual([]);
  });

  it('a refusal is never retried (deterministic: no second attempt, no wait)', async () => {
    gateway();
    await transcribe(9000).catch(() => {});
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('cancel after a refusal leaves nothing behind: no job was ever submitted, so no receipt and no charge', async () => {
    gateway();
    const since = Date.now() - 1;
    const controller = new AbortController();
    const err = await transcribe(4000, controller.signal).catch(e => e);
    expect((err as CloudStageError).cloud.kind).toBe('tooLong');
    controller.abort();
    await Promise.resolve();
    expect(commands()).toEqual([]);
    expect(takeCancelReceiptsSince(since)).toEqual([]);
  });
});

describe('Wave 3 U6 — client pre-flight: bytes at the CBR rate', () => {
  const run = (durationSec?: number) =>
    runStageCacheFirst(
      { stage: 'align', audioHash: HASH, language: 'en', chunks: [] },
      async () => new Blob([new Uint8Array([1])]),
      { audioDurationSec: durationSec },
    );

  it('duration unknown, encoded Opus over the cap: refused BEFORE the upload (no upload, no job)', async () => {
    gateway({ encodedBytes: MAX_UPLOAD_BYTES + 1 });
    const err = (await run().catch(e => e)) as CloudError;
    expect(err.kind).toBe('tooLong');
    expect(commands()).toContain('cloud_encode_opus');
    expect(commands()).not.toContain('cloud_upload_audio');
    expect(commands()).not.toContain('cloud_run_job');
  });

  it('a locally cached over-cap Opus is refused without staging, encoding, or uploading anything', async () => {
    gateway({ opusCached: MAX_UPLOAD_BYTES + 1 });
    const err = (await run().catch(e => e)) as CloudError;
    expect(err.kind).toBe('tooLong');
    expect(commands()).toEqual(['cloud_cache_lookup', 'cloud_opus_cached']);
  });

  it('the byte estimate reads an over-hour file as its length in hours', async () => {
    gateway({ opusCached: Math.round(OPUS_HOUR_BYTES * 1.5) });
    const err = (await run().catch(e => e)) as { kind: 'tooLong'; detail: string };
    expect(err.detail).toBe(tooLongMessage(5400));
  });

  it('exactly one hour of bytes, and the top of the margin, are allowed', async () => {
    for (const bytes of [OPUS_HOUR_BYTES, MAX_UPLOAD_BYTES]) {
      mockInvoke.mockReset();
      __resetCloudAudioInFlightForTests();
      gateway({ opusCached: bytes });
      await run();
      expect(commands()).toContain('cloud_upload_audio');
    }
  });

  it('a real-duration <= 1h file whose bytes sit in the margin is NOT refused by the byte estimate', async () => {
    // 1% over the nominal hour: the byte estimate alone reads 3636 s.
    const bytes = Math.round(OPUS_HOUR_BYTES * 1.01);
    expect(estimateOpusSec(bytes)).toBeGreaterThan(MAX_AUDIO_SEC);
    gateway({ opusCached: bytes });
    await run(3600);
    expect(commands()).toContain('cloud_upload_audio');
    expect(commands()).toContain('cloud_run_job');
  });
});

describe('Wave 3 U6 — one constant across the language boundary', () => {
  const py = readFileSync(new URL('../../cloud/sync_core.py', import.meta.url), 'utf8');
  const pyInt = (name: string): number => {
    const m = new RegExp(`^${name}\\s*=\\s*([0-9_.]+)`, 'm').exec(py);
    if (!m) throw new Error(`${name} not found in cloud/sync_core.py`);
    return Number(m[1]!.replace(/_/g, ''));
  };

  it('TS and Python agree on every limit', () => {
    expect(pyInt('OPUS_HOUR_BYTES')).toBe(OPUS_HOUR_BYTES);
    expect(pyInt('MAX_AUDIO_SEC')).toBe(MAX_AUDIO_SEC);
    expect(pyInt('AUDIO_DURATION_TOLERANCE_SEC')).toBe(AUDIO_DURATION_TOLERANCE_SEC);
    expect(py).toMatch(/^MAX_UPLOAD_BYTES = OPUS_HOUR_BYTES \+ OPUS_HOUR_BYTES \/\/ 50$/m);
    expect(MAX_UPLOAD_BYTES).toBe(OPUS_HOUR_BYTES + Math.floor(OPUS_HOUR_BYTES / 50));
  });
});
