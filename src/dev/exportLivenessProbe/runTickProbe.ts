/**
 * THROWAWAY — Part 1 tick probe, shared by the spike page and Tauri autorun.
 */

import type { DemuxProbeResult, GlProbeResult, ProbeVideoSpec } from './worker';
import type { FontConfig } from '../../services/webcodecsExport/textRenderer';
import { persistLivenessReport } from './autorunFlag';

const VIDEO_URLS: ProbeVideoSpec[] = [
  { label: 'smallest', url: '/_spike/local-smallest.mp4', bytes: 954_000 },
  { label: 'largest', url: '/_spike/local-largest.mp4', bytes: 10_130_000 },
  { label: 'sample', url: '/_spike/sample.mp4', bytes: 3_670_000 },
];

async function resolveBytes(spec: ProbeVideoSpec): Promise<ProbeVideoSpec> {
  const resp = await fetch(spec.url);
  if (!resp.ok) throw new Error(`fetch ${spec.url} failed (${resp.status})`);
  const buf = await resp.arrayBuffer();
  const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));
  return { ...spec, url: blobUrl, bytes: buf.byteLength };
}

async function maybeFontConfigs(): Promise<FontConfig[]> {
  try {
    const css = await fetch(
      'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap',
    );
    if (!css.ok) return [];
    const text = await css.text();
    const m = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/.exec(text);
    if (!m) return [];
    const font = await fetch(m[1]!);
    if (!font.ok) return [];
    return [{ family: 'Inter', bytes: await font.arrayBuffer(), weight: '400' }];
  } catch {
    return [];
  }
}

export function extrapolateParseBytes(a: DemuxProbeResult, b: DemuxProbeResult, targetMs: number): number | null {
  if (a.bytes === b.bytes) return null;
  const slope = (b.parseMs - a.parseMs) / (b.bytes - a.bytes);
  if (slope <= 0) return null;
  return (targetMs - a.parseMs) / slope + a.bytes;
}

export async function runTickProbe(): Promise<{
  demux: DemuxProbeResult[];
  gl: GlProbeResult;
  parseExceeds30sBytes: number | null;
  ua: string;
}> {
  const videos: ProbeVideoSpec[] = [];
  for (const spec of VIDEO_URLS) {
    videos.push(await resolveBytes(spec));
  }
  videos.sort((x, y) => x.bytes - y.bytes);

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const demux = await new Promise<DemuxProbeResult[]>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent<{ type: string; results?: DemuxProbeResult[]; message?: string }>) => {
      if (ev.data.type === 'demux-results' && ev.data.results) resolve(ev.data.results);
      else if (ev.data.type === 'error') reject(new Error(ev.data.message));
    };
    worker.onerror = (ev) => reject(new Error(ev.message));
    worker.postMessage({ type: 'probe-demux', videos });
  });

  const fontConfigs = await maybeFontConfigs();
  const gl = await new Promise<GlProbeResult>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent<{ type: string; result?: GlProbeResult; message?: string }>) => {
      if (ev.data.type === 'gl-result' && ev.data.result) resolve(ev.data.result);
      else if (ev.data.type === 'error') reject(new Error(ev.data.message));
    };
    worker.postMessage({ type: 'probe-gl', fontConfigs });
  });
  worker.terminate();

  const smallest = demux.reduce((a, b) => (a.bytes < b.bytes ? a : b));
  const largest = demux.reduce((a, b) => (a.bytes > b.bytes ? a : b));
  const parseExceeds30sBytes = extrapolateParseBytes(smallest, largest, 30_000);
  const payload = { demux, gl, parseExceeds30sBytes, ua: navigator.userAgent };
  // eslint-disable-next-line no-console
  console.info('[ws3-liveness] part1', JSON.stringify(payload));
  persistLivenessReport('part1', payload);
  return payload;
}
