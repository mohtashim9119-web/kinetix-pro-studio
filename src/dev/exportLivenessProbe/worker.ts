/// <reference lib="webworker" />
/**
 * THROWAWAY — Round 2 tick-yield probe. Not imported by any production file.
 *
 * Starts a 1 ms setInterval, then runs the REAL getOrCreateDemux path and
 * the REAL GlCompositor / GLTextRenderer constructors so we can count how
 * many timer ticks fire during each synchronous block.
 */

import { getOrCreateDemux, clearDemuxCache } from '../../services/videoDemuxer';
import { GlCompositor } from '../../services/gl/glCompositor';
import { acquireOffscreenGlContext } from '../../services/gl/glContext';
import { GLTextRenderer, type FontConfig } from '../../services/webcodecsExport/textRenderer';

export interface ProbeVideoSpec {
  label: string;
  url: string;
  bytes: number;
}

export interface DemuxProbeResult {
  label: string;
  bytes: number;
  fetchMs: number;
  parseMs: number;
  wallMs: number;
  ticksDuringFetch: number;
  ticksDuringParse: number;
  ticksDuringWholeCall: number;
  observedTickIntervalMs: number;
}

export interface GlProbeResult {
  compositorCompileMs: number;
  compositorTicks: number;
  textCtorMs: number;
  textCtorTicks: number;
  textInitMs: number;
  textInitTicks: number;
}

type Inbound =
  | { type: 'probe-demux'; videos: ProbeVideoSpec[] }
  | { type: 'probe-gl'; fontConfigs: FontConfig[] };

function startTick(): { ticks: () => number; stop: () => void; stamps: () => number[] } {
  const stamps: number[] = [];
  const id = setInterval(() => {
    stamps.push(performance.now());
  }, 1);
  return {
    ticks: () => stamps.length,
    stamps: () => stamps,
    stop: () => clearInterval(id),
  };
}

function countInWindow(stamps: number[], start: number, end: number): number {
  let n = 0;
  for (const t of stamps) {
    if (t >= start && t < end) n++;
  }
  return n;
}

async function probeDemux(videos: ProbeVideoSpec[]): Promise<DemuxProbeResult[]> {
  const out: DemuxProbeResult[] = [];
  for (const v of videos) {
    clearDemuxCache();
    const counter = startTick();
    // Warm the interval so the first sample isn't the 1 ms scheduling delay.
    await new Promise((r) => setTimeout(r, 16));
    const t0 = performance.now();
    const ticksBefore = counter.ticks();
    const demuxed = await getOrCreateDemux(v.url);
    const t1 = performance.now();
    const stamps = counter.stamps();
    const ticksWhole = stamps.length - ticksBefore;
    counter.stop();
    const fetchMs = demuxed.fetchMs ?? 0;
    const parseMs = demuxed.parseMs ?? 0;
    const fetchStart = t0;
    const fetchEnd = t0 + fetchMs;
    const parseStart = fetchEnd;
    const parseEnd = parseStart + parseMs;
    const ticksDuringFetch = countInWindow(stamps, fetchStart, fetchEnd);
    const ticksDuringParse = countInWindow(stamps, parseStart, parseEnd);
    out.push({
      label: v.label,
      bytes: v.bytes,
      fetchMs,
      parseMs,
      wallMs: t1 - t0,
      ticksDuringFetch,
      ticksDuringParse,
      ticksDuringWholeCall: ticksWhole,
      observedTickIntervalMs: stamps.length >= 2
        ? (stamps[stamps.length - 1]! - stamps[0]!) / (stamps.length - 1)
        : 1,
    });
  }
  return out;
}

async function probeGl(fontConfigs: FontConfig[]): Promise<GlProbeResult> {
  const canvas = new OffscreenCanvas(1920, 1080);
  const gl = acquireOffscreenGlContext(canvas);
  if (!gl) throw new Error('probe-gl: WebGL2 unavailable in worker');

  const c1 = startTick();
  await new Promise((r) => setTimeout(r, 16));
  const t0 = performance.now();
  const ticks0 = c1.ticks();
  const compositor = new GlCompositor(gl);
  const compositorCompileMs = performance.now() - t0;
  const compositorTicks = c1.ticks() - ticks0;
  c1.stop();

  const c2 = startTick();
  await new Promise((r) => setTimeout(r, 16));
  const t1 = performance.now();
  const ticks1 = c2.ticks();
  const textRenderer = new GLTextRenderer(gl);
  const textCtorMs = performance.now() - t1;
  const textCtorTicks = c2.ticks() - ticks1;
  c2.stop();

  const c3 = startTick();
  await new Promise((r) => setTimeout(r, 16));
  const t2 = performance.now();
  const ticks2 = c3.ticks();
  await textRenderer.init(fontConfigs);
  const textInitMs = performance.now() - t2;
  const textInitTicks = c3.ticks() - ticks2;
  c3.stop();

  try { compositor.dispose(); } catch { /* best-effort */ }
  try { textRenderer.dispose(); } catch { /* best-effort */ }
  return { compositorCompileMs, compositorTicks, textCtorMs, textCtorTicks, textInitMs, textInitTicks };
}

self.onmessage = (ev: MessageEvent<Inbound>) => {
  const data = ev.data;
  void (async () => {
    try {
      if (data.type === 'probe-demux') {
        const results = await probeDemux(data.videos);
        self.postMessage({ type: 'demux-results', results });
      } else if (data.type === 'probe-gl') {
        const result = await probeGl(data.fontConfigs);
        self.postMessage({ type: 'gl-result', result });
      }
    } catch (e) {
      self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  })();
};
