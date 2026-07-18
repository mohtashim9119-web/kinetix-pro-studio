import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildSourceChunked } from './waveformPipeline';
import { buildWaveformSource } from './waveformPeaks';

// Deterministic pseudo-random PCM in [-1, 1] — a mulberry32 so the two builders
// are compared over the SAME samples across runs.
function makePcm(n: number, seed: number): Float32Array {
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0,1)
    out[i] = r * 2 - 1; // [-1,1)
  }
  return out;
}

afterEach(() => {
  // Remove any scheduler shim a test installed.
  delete (globalThis as unknown as { scheduler?: unknown }).scheduler;
  vi.restoreAllMocks();
});

describe('waveformPipeline — output identity (relocation must not change pixels)', () => {
  it('buildSourceChunked is byte-for-byte identical to synchronous buildWaveformSource', async () => {
    const sampleRate = 48000;
    const duration = 3.0;
    const pcm = makePcm(Math.round(sampleRate * duration), 12345);

    const chunked = await buildSourceChunked(pcm, sampleRate, duration);
    const sync = buildWaveformSource(pcm, sampleRate, duration);

    expect(chunked.peaksPerSecond).toBe(sync.peaksPerSecond);
    expect(chunked.totalDuration).toBe(sync.totalDuration);
    expect(chunked.peaks.length).toBe(sync.peaks.length);
    for (let i = 0; i < sync.peaks.length; i++) {
      // Exact equality — same ops, same order; the yield only defers timing.
      expect(chunked.peaks[i]).toBe(sync.peaks[i]);
    }
  });

  it('buildSourceChunked matches the sync builder at a second sample rate', async () => {
    const sampleRate = 44100;
    const duration = 1.7;
    const pcm = makePcm(Math.round(sampleRate * duration), 777);

    const chunked = await buildSourceChunked(pcm, sampleRate, duration);
    const sync = buildWaveformSource(pcm, sampleRate, duration);

    expect(chunked.peaks.length).toBe(sync.peaks.length);
    for (let i = 0; i < sync.peaks.length; i++) {
      expect(chunked.peaks[i]).toBe(sync.peaks[i]);
    }
  });
});

describe('waveformPipeline — chunked yielding behavior', () => {
  it('buildSourceChunked yields to the browser during a large build', async () => {
    // Install a fake scheduler.yield so we can count yields without touching timers.
    const yieldSpy = vi.fn().mockResolvedValue(undefined);
    (globalThis as unknown as { scheduler: { yield: () => Promise<void> } }).scheduler = {
      yield: yieldSpy,
    };

    const sampleRate = 48000;
    const duration = 30; // ~6000 columns → several 1024-column yield checkpoints
    const pcm = makePcm(sampleRate * duration, 4242);

    // budgetMs: 0 forces a yield at every checkpoint where the clock advanced.
    await buildSourceChunked(pcm, sampleRate, duration, { budgetMs: 0 });

    expect(yieldSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it('output is unchanged whether or not it yields (budget 0 vs large)', async () => {
    const sampleRate = 48000;
    const duration = 5;
    const pcm = makePcm(sampleRate * duration, 31337);

    const yielded = await buildSourceChunked(pcm, sampleRate, duration, { budgetMs: 0 });
    const notYielded = await buildSourceChunked(pcm, sampleRate, duration, { budgetMs: 1e9 });

    expect(yielded.peaks.length).toBe(notYielded.peaks.length);
    for (let i = 0; i < yielded.peaks.length; i++) {
      expect(yielded.peaks[i]).toBe(notYielded.peaks[i]);
    }
  });
});
