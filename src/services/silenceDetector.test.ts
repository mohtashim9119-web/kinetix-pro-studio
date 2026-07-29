// WS4 Feature 3 (decision 11a) — silence detection fails loud.
//
// Two things are under test: the new structured error contract, and the fact
// that the detection MATH is untouched by it (the regression cases below assert
// the same intervals the pre-WS4 implementation produced).
//
// AudioContext does not exist in the node test environment, so it is stubbed —
// which is also what lets the decode-failure path be exercised deterministically.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectSilences } from './silenceDetector';

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
