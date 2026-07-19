// waveformPipeline.ts — the ONE upfront decode + waveform-build pass, run during
// the Apply-Sync flow (docs/history.md ("Waveform Rewrite — Implementation Record", archived) §3, §4.3). Relocated verbatim
// out of Timeline.tsx's render-triggered decode effect so the heavy work runs once,
// on Apply Sync, instead of every time the voiceover props change.
//
// Two things this module fixes about the old inline effect:
//   1. Location — the decode + heavy synchronous peak loop used to live inside
//      Timeline.tsx's effect keyed on [voiceoverUrl, voiceoverFile]. They now run
//      here, invoked once from App.tsx's handleApplySyncFromFiles (and a reload
//      effect), and the result is threaded back into Timeline as data props.
//   2. Blocking — buildWaveformSource's peak loop is ~60M operations on a 21-min
//      voiceover. Run synchronously it froze the main thread for the entire build
//      (2+ min in production). Here the loop YIELDs to the browser on a time
//      budget (see YIELD_BUDGET_MS), so the main thread is never blocked for more
//      than ~one budget at a stretch, regardless of file size. Yielding changes
//      ONLY the timing of the work, not its output — buildSourceChunked is
//      byte-identical to waveformPeaks.ts's synchronous buildWaveformSource
//      (asserted in waveformPipeline.test.ts).
//
// Instrumentation: the syncMark call sites moved here from Timeline.tsx keep the
// dormant __SYNC_INSTRUMENT__ timing visibility across the relocation (labels
// re-namespaced from `timeline:*` to `waveform:*` to match the new location).

import { syncMark } from './syncInstrument';
import { PEAKS_PER_SECOND, WaveformSource } from './waveformPeaks';

/**
 * Longest the chunked loop may run before yielding to the browser. Kept under
 * one frame (~16ms) so layout/paint/input can interleave between chunks even on
 * a slow machine or large file. The yield adds latency but never blocks.
 */
const YIELD_BUDGET_MS = 8;

export interface WaveformPipelineResult {
  /** Peak-based per-segment source, or null when there is no audio. */
  source: WaveformSource | null;
}

export interface WaveformPipelineInput {
  /** Preferred: the raw File (avoids blob-URL fetch restrictions in WebView2). */
  file?: File;
  /** Fallback source when no File is available (blob: or http URL). */
  url: string;
}

/** Optional knobs — only the yield BUDGET, which changes timing, never output. */
interface ChunkOpts {
  /** Override the yield budget (ms). Used by tests to force deterministic yields. */
  budgetMs?: number;
}

/**
 * Yield the main thread back to the browser between chunks. Prefers the platform
 * scheduler.yield() where available (Chromium/WebView2); otherwise a macrotask via
 * setTimeout(0), which reliably lets layout/paint/input run between chunks in every
 * engine (incl. WebKit/Tauri).
 */
function yieldToBrowser(): Promise<void> {
  const sched = (globalThis as unknown as {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (sched && typeof sched.yield === 'function') return sched.yield();
  return new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}

interface DecodedPcm {
  pcm: Float32Array;
  sampleRate: number;
  duration: number;
}

/**
 * Decode the voiceover to channel-0 PCM. Prefers the raw File (matches the old
 * effect's WebView2 workaround) and falls back to fetching the URL.
 */
async function decodePcm(input: WaveformPipelineInput): Promise<DecodedPcm> {
  let arrayBuf: ArrayBuffer;
  if (input.file) {
    arrayBuf = await input.file.arrayBuffer();
  } else {
    const res = await fetch(input.url);
    arrayBuf = await res.arrayBuffer();
  }
  syncMark('waveform:arrayBuffer-ready');
  const audioCtx = new AudioContext();
  const decoded = await audioCtx.decodeAudioData(arrayBuf);
  await audioCtx.close();
  syncMark('waveform:decodeAudioData-done');
  return {
    pcm: decoded.getChannelData(0),
    sampleRate: decoded.sampleRate,
    duration: decoded.duration,
  };
}

/**
 * Peak-based source — MAX-abs per block, global-max normalized. This is the
 * chunked, yielding twin of waveformPeaks.ts's synchronous buildWaveformSource;
 * its output is identical (verified in waveformPipeline.test.ts). The peak loop's
 * yield check is gated to every 1024 columns so performance.now() itself isn't
 * called 60M times.
 */
export async function buildSourceChunked(
  pcm: Float32Array,
  sampleRate: number,
  duration: number,
  opts?: ChunkOpts,
): Promise<WaveformSource> {
  const budget = opts?.budgetMs ?? YIELD_BUDGET_MS;
  const blockSize = Math.max(1, Math.round(sampleRate / PEAKS_PER_SECOND));
  const totalColumns = Math.max(0, Math.ceil(pcm.length / blockSize));
  const peaks = new Float32Array(totalColumns);

  // Peak (max-abs) per block — transient-preserving, unlike the legacy mean.
  let clock = performance.now();
  for (let c = 0; c < totalColumns; c++) {
    const from = c * blockSize;
    const to = Math.min(from + blockSize, pcm.length);
    let peak = 0;
    for (let j = from; j < to; j++) {
      const a = Math.abs(pcm[j]!);
      if (a > peak) peak = a;
    }
    peaks[c] = peak;
    if ((c & 0x3ff) === 0 && performance.now() - clock > budget) {
      await yieldToBrowser();
      clock = performance.now();
    }
  }

  // Global-max normalization; avoid /0 on silence (globalMax || 1e-3).
  let globalMax = 0;
  for (let c = 0; c < totalColumns; c++) {
    if (peaks[c]! > globalMax) globalMax = peaks[c]!;
  }
  const norm = globalMax > 0 ? globalMax : 1e-3;
  for (let c = 0; c < totalColumns; c++) {
    peaks[c] = peaks[c]! / norm;
  }

  return { peaks, peaksPerSecond: PEAKS_PER_SECOND, totalDuration: duration };
}

/**
 * The ONE upfront waveform build: decode → peak source, the heavy loop yielding
 * to the browser. Call once from the Apply-Sync flow (and the reload effect) in
 * App.tsx; store the result in App state and pass it into Timeline as props.
 * Never invoke from a render-triggered effect in Timeline — that was the whole
 * freeze.
 */
export async function buildWaveformPipeline(
  input: WaveformPipelineInput,
): Promise<WaveformPipelineResult> {
  const { pcm, sampleRate, duration } = await decodePcm(input);
  const source = await buildSourceChunked(pcm, sampleRate, duration);
  syncMark('waveform:source-done');
  return { source };
}
