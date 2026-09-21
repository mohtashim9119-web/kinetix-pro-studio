// WS4 Feature 3 (decision 11a) — silence detection fails loud.
//
// Two things are under test: the new structured error contract, and the fact
// that the detection MATH is untouched by it (the regression cases below assert
// the same intervals the pre-WS4 implementation produced).
//
// AudioContext does not exist in the node test environment, so it is stubbed —
// which is also what lets the decode-failure path be exercised deterministically.
import { beforeEach, describe, it, expect, vi, afterEach } from 'vitest';
import {
  __getSilenceDetectionDispatchCountForTests,
  __resetSilenceDetectionCacheForTests,
  detectSilences,
  detectSilencesSingleFlight,
} from './silenceDetector';

const SAMPLE_RATE = 1000;

/** A minimal stand-in for the parts of AudioBuffer the detector reads. */
function fakeBuffer(samples: Float32Array): unknown {
  return {
    sampleRate: SAMPLE_RATE,
    length: samples.length,
    numberOfChannels: 1,
    duration: samples.length / SAMPLE_RATE,
    getChannelData: () => samples,
  };
}

/** Builds a mono signal from [amplitude, sampleCount] runs. */
function signal(...runs: Array<[number, number]>): Float32Array {
  const total = runs.reduce((n, [, count]) => n + count, 0);
  const out = new Float32Array(total);
  let i = 0;
  for (const [amplitude, count] of runs) {
    out.fill(amplitude, i, i + count);
    i += count;
  }
  return out;
}

const closeSpy = vi.fn().mockResolvedValue(undefined);

/** Installs an AudioContext whose decodeAudioData resolves with `samples`. */
function stubDecodeOk(samples: Float32Array): void {
  vi.stubGlobal('AudioContext', class {
    decodeAudioData = (): Promise<unknown> => Promise.resolve(fakeBuffer(samples));
    close = closeSpy;
  });
}

/** Installs an AudioContext whose decodeAudioData rejects. */
function stubDecodeFails(message: string): void {
  vi.stubGlobal('AudioContext', class {
    decodeAudioData = (): Promise<unknown> => Promise.reject(new Error(message));
    close = closeSpy;
  });
}

function blob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3, 4])]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  closeSpy.mockClear();
});

describe('detectSilences — error contract', () => {
  it('returns status "error" with the decoder message when decoding fails', async () => {
    stubDecodeFails('Unable to decode audio data');
    const result = await detectSilences(blob());

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('expected error');
    expect(result.errorMessage).toBe('Unable to decode audio data');
  });

  it('returns status "error" when the AudioContext itself cannot be created', async () => {
    vi.stubGlobal('AudioContext', class {
      constructor() { throw new Error('audio backend unavailable'); }
    });
    const result = await detectSilences(blob());

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('expected error');
    expect(result.errorMessage).toBe('audio backend unavailable');
  });

  it('returns status "error" when the blob cannot be read', async () => {
    stubDecodeOk(signal([0.5, 100]));
    const unreadable = {
      arrayBuffer: () => Promise.reject(new Error('blob is detached')),
    } as unknown as Blob;

    const result = await detectSilences(unreadable);
    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('expected error');
    expect(result.errorMessage).toBe('blob is detached');
  });

  it('never throws — a rejected decode resolves to an error result', async () => {
    stubDecodeFails('boom');
    await expect(detectSilences(blob())).resolves.toMatchObject({ status: 'error' });
  });

  it('closes the AudioContext even when decoding fails', async () => {
    stubDecodeFails('boom');
    await detectSilences(blob());
    expect(closeSpy).toHaveBeenCalled();
  });

  it('reports a frame size below one sample as an error, not as "no silence"', async () => {
    stubDecodeOk(signal([0.5, 1000]));
    const result = await detectSilences(blob(), { frameSizeMs: 0.0001 });

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('expected error');
    expect(result.errorMessage).toContain('below one sample');
  });
});

describe('detectSilences — detection behaviour (regression)', () => {
  it('finds an interior silence between two loud runs', async () => {
    // 1s loud, 1s digital silence, 1s loud at 1000Hz.
    stubDecodeOk(signal([0.5, 1000], [0, 1000], [0.5, 1000]));
    const result = await detectSilences(blob());

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.silences).toEqual([{ startSec: 1, endSec: 2 }]);
  });

  it('finds a trailing silence that runs to the end of the audio', async () => {
    stubDecodeOk(signal([0.5, 1000], [0, 2000]));
    const result = await detectSilences(blob());

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.silences).toEqual([{ startSec: 1, endSec: 3 }]);
  });

  it('returns status "ok" with an empty array when the audio is never silent', async () => {
    stubDecodeOk(signal([0.5, 3000]));
    const result = await detectSilences(blob());

    expect(result).toEqual({ status: 'ok', silences: [] });
  });

  it('ignores a silence shorter than minDurationSec', async () => {
    // 100ms of silence, below the 250ms default floor.
    stubDecodeOk(signal([0.5, 1000], [0, 100], [0.5, 1000]));
    const result = await detectSilences(blob());

    expect(result).toEqual({ status: 'ok', silences: [] });
  });

  it('honours a custom thresholdDb', async () => {
    // RMS in dB: 0.5 -> -6.0, 0.1 -> -20.0. A -10dB threshold therefore reads
    // the middle run as silence and the outer runs as speech; the -45dB default
    // reads all three as speech.
    stubDecodeOk(signal([0.5, 1000], [0.1, 1000], [0.5, 1000]));
    const strict = await detectSilences(blob(), { thresholdDb: -10 });
    expect(strict.status).toBe('ok');
    if (strict.status !== 'ok') throw new Error('expected ok');
    expect(strict.silences).toEqual([{ startSec: 1, endSec: 2 }]);

    stubDecodeOk(signal([0.5, 1000], [0.1, 1000], [0.5, 1000]));
    await expect(detectSilences(blob())).resolves.toEqual({ status: 'ok', silences: [] });
  });
});

// ---------------------------------------------------------------------------
// WS2 Wave 2 Group 2 completion, Unit 2 — single-flight detectSilences,
// keyed by audioHash. Today `forcedAlignmentRun.ts`'s `runFaAttempt` and
// `useWhisper.ts`'s `alignSegmentsFromCachedTranscript` each run an
// independent `detectSilences` pass on the SAME staged audio within one
// Apply Sync — same audio, content-equal output, never the same array
// reference, which is why `computeRunContext`'s own reference-identity memo
// (`faChunkPlan.ts`, G2 item 1) has to hold TWO entries per sync instead of
// one (G2 end-of-group report, sighting #2). This closes that gap.
// ---------------------------------------------------------------------------
describe('detectSilencesSingleFlight (WS2 G2 completion, Unit 2)', () => {
  beforeEach(() => {
    __resetSilenceDetectionCacheForTests();
  });

  it('a second call with the SAME audioHash reuses the first dispatch and returns the SAME array reference (old-bug proof: fails without the cache — the pre-Unit-2 call shape dispatches twice and never shares a reference)', async () => {
    stubDecodeOk(signal([0.5, 1000], [0, 100], [0.5, 1000]));
    const b = blob();

    const first = await detectSilencesSingleFlight('hash-a', b);
    const second = await detectSilencesSingleFlight('hash-a', b);

    expect(__getSilenceDetectionDispatchCountForTests()).toBe(1);
    expect(second).toBe(first); // SAME object reference, not just equal.
    expect(first.status === 'ok' && second.status === 'ok' && second.silences).toBe(
      first.status === 'ok' ? first.silences : undefined,
    );
  });

  it('joins the SAME in-flight promise when the second call arrives before the first settles (true single-flight, not just result caching)', async () => {
    let resolveDecode!: (buf: unknown) => void;
    vi.stubGlobal('AudioContext', class {
      decodeAudioData = (): Promise<unknown> => new Promise(r => { resolveDecode = r; });
      close = closeSpy;
    });
    const b = blob();

    const p1 = detectSilencesSingleFlight('hash-b', b);
    const p2 = detectSilencesSingleFlight('hash-b', b);
    expect(__getSilenceDetectionDispatchCountForTests()).toBe(1);

    // Let the microtask queue drain up to the `blob.arrayBuffer()` await
    // inside `detectSilences` so `decodeAudioData` (and therefore
    // `resolveDecode`) has actually been called before we resolve it.
    await Promise.resolve();
    await Promise.resolve();
    resolveDecode(fakeBuffer(signal([0.5, 500])));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r2).toBe(r1);
  });

  it('a DIFFERENT audioHash (an audio swap) always misses and detects fresh — silence data cannot go stale across a swap', async () => {
    stubDecodeOk(signal([0.5, 1000], [0, 500], [0.5, 1000]));
    const first = await detectSilencesSingleFlight('hash-old', blob());

    stubDecodeOk(signal([0.5, 1000])); // a different audio: no silence at all.
    const second = await detectSilencesSingleFlight('hash-new', blob());

    expect(__getSilenceDetectionDispatchCountForTests()).toBe(2);
    expect(second).not.toBe(first);
    expect(first.status === 'ok' && first.silences.length).toBeGreaterThan(0);
    expect(second.status === 'ok' && second.silences.length).toBe(0);
  });

  it('an undefined audioHash (no computable hash) never caches — always dispatches fresh, matching pre-Unit-2 behavior exactly', async () => {
    stubDecodeOk(signal([0.5, 1000], [0, 100], [0.5, 1000]));
    const b = blob();

    const first = await detectSilencesSingleFlight(undefined, b);
    const second = await detectSilencesSingleFlight(undefined, b);

    expect(__getSilenceDetectionDispatchCountForTests()).toBe(2);
    expect(second).not.toBe(first);
    expect(second).toEqual(first); // still content-equal, just not the same object.
  });
});
