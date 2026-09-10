/**
 * THROWAWAY — WS3 Round 10, Blocker 4: the mixed-rung parameter-set spike.
 *
 * Encodes two short pieces with the SAME production config, one on
 * `prefer-hardware` and one on `prefer-software` — the two rungs Rung 5a's
 * failover can put on either side of a concat join — then:
 *
 *   1. diffs their emitted SPS and PPS (profile, constraint flags, level,
 *      chroma format, bit depths, entropy coding mode, and the raw payloads);
 *   2. concatenates hardware-then-software and runs OUR OWN picture-accurate
 *      counter over the join;
 *   3. feeds the concatenated stream to a `VideoDecoder` and reports how many
 *      frames come back out.
 *
 * (3) is the part the counter cannot do: `countAnnexbAccessUnits` never opens
 * an SPS, so a profile mismatch is invisible to it by construction. A decoder
 * that returns every frame across the join is evidence the change is followed;
 * one that errors or drops frames is evidence it is not.
 *
 * Not imported by production. Reached only via `spike-parameter-sets.html`.
 */
import {
  countAnnexbAccessUnits,
  scanAnnexbNals,
} from '../../services/webcodecsExport/annexbFrameCount';
import {
  diffParameterSets,
  summarizeParameterSets,
  type ParameterSetSummary,
} from '../../services/webcodecsExport/h264ParameterSets';

const CODEC = 'avc1.640028';
const BITRATE = 8_000_000;
const WIDTH = 640;
const HEIGHT = 360;
const FPS = 30;
const FRAMES = 30;

function log(msg: string): void {
  const el = document.getElementById('log');
  if (el) el.textContent += msg + '\n';
  // eslint-disable-next-line no-console
  console.info('[ws3-paramsets]', msg);
}

function frameCanvas(i: number): OffscreenCanvas {
  const c = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `hsl(${(i * 11) % 360} 70% 45%)`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#fff';
  ctx.font = '48px sans-serif';
  ctx.fillText(String(i), 24, 96);
  return c;
}

interface RungResult {
  rung: HardwareAcceleration;
  bytes: Uint8Array;
  pictures: number;
  chunkCount: number;
  configured: boolean;
  error: string | null;
}

async function encodeRung(rung: HardwareAcceleration): Promise<RungResult> {
  const parts: Uint8Array[] = [];
  let chunkCount = 0;
  let error: string | null = null;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      parts.push(buf);
      chunkCount++;
    },
    error: (e) => { error = e.message; },
  });
  encoder.configure({
    codec: CODEC,
    width: WIDTH,
    height: HEIGHT,
    bitrate: BITRATE,
    framerate: FPS,
    hardwareAcceleration: rung,
    avc: { format: 'annexb' },
  });
  for (let i = 0; i < FRAMES; i++) {
    const frame = new VideoFrame(frameCanvas(i), {
      timestamp: Math.round((i * 1e6) / FPS),
      duration: Math.round(1e6 / FPS),
    });
    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
    if (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 0));
  }
  await encoder.flush();
  encoder.close();
  const total = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  return {
    rung, bytes, chunkCount, configured: true, error,
    pictures: countAnnexbAccessUnits(bytes).pictures,
  };
}

async function decodeCount(bytes: Uint8Array, description?: Uint8Array): Promise<{ frames: number; error: string | null }> {
  let frames = 0;
  let error: string | null = null;
  const decoder = new VideoDecoder({
    output: (f) => { frames++; f.close(); },
    error: (e) => { error = e.message; },
  });
  try {
    decoder.configure({ codec: CODEC, ...(description ? { description } : {}) });
  } catch (e) {
    return { frames: 0, error: `configure failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  // Split the concatenated annexb into access units and feed one chunk each.
  const nals = scanAnnexbNals(bytes);
  const auStarts: number[] = [];
  for (let i = 0; i < nals.length; i++) {
    const n = nals[i]!;
    if (n.nalType !== 1 && n.nalType !== 5) continue;
    let j = i - 1;
    while (j >= 0 && nals[j]!.nalType !== 1 && nals[j]!.nalType !== 5) j--;
    auStarts.push(nals[j + 1]!.start);
  }
  for (let k = 0; k < auStarts.length; k++) {
    const start = auStarts[k]!;
    const end = auStarts[k + 1] ?? bytes.length;
    const slice = bytes.subarray(start, end);
    const isKey = scanAnnexbNals(slice).some((n) => n.nalType === 5);
    try {
      decoder.decode(new EncodedVideoChunk({
        type: isKey ? 'key' : 'delta',
        timestamp: Math.round((k * 1e6) / FPS),
        data: slice,
      }));
    } catch (e) {
      error ??= `decode threw at AU ${k}: ${e instanceof Error ? e.message : String(e)}`;
      break;
    }
  }
  try {
    await decoder.flush();
  } catch (e) {
    error ??= `flush threw: ${e instanceof Error ? e.message : String(e)}`;
  }
  try { decoder.close(); } catch { /* already closed on error */ }
  return { frames, error };
}

async function run(): Promise<void> {
  const report: Record<string, unknown> = {
    userAgent: navigator.userAgent,
    codec: CODEC, width: WIDTH, height: HEIGHT, fps: FPS, frames: FRAMES,
  };
  log(`UA: ${navigator.userAgent}`);

  const rungs: HardwareAcceleration[] = ['prefer-hardware', 'prefer-software'];
  const results: RungResult[] = [];
  for (const rung of rungs) {
    log(`encoding with hardwareAcceleration=${rung} …`);
    try {
      const r = await encodeRung(rung);
      results.push(r);
      log(`  chunks=${r.chunkCount} bytes=${r.bytes.length} pictures=${r.pictures} error=${r.error ?? 'none'}`);
    } catch (e) {
      log(`  FAILED: ${e instanceof Error ? e.message : String(e)}`);
      report[`${rung}.failure`] = e instanceof Error ? e.message : String(e);
    }
  }

  if (results.length !== 2) {
    report.verdict = 'INCOMPLETE — one rung did not encode';
    (window as unknown as { __paramSetReport: unknown }).__paramSetReport = report;
    log(JSON.stringify(report, null, 2));
    return;
  }

  const scan = (b: Uint8Array) => scanAnnexbNals(b).map((n) => ({ ...n }));
  const summaries: ParameterSetSummary[] = results.map((r) => summarizeParameterSets(r.bytes, scan));
  const differences = diffParameterSets(summaries[0]!, summaries[1]!);

  report.hardware = { ...summaries[0], pictures: results[0]!.pictures, bytes: results[0]!.bytes.length };
  report.software = { ...summaries[1], pictures: results[1]!.pictures, bytes: results[1]!.bytes.length };
  report.differences = differences;
  log(`parameter-set differences: ${differences.length === 0 ? 'NONE' : ''}`);
  for (const d of differences) log(`  ${d.field}: hw=${JSON.stringify(d.a)} sw=${JSON.stringify(d.b)}`);

  // ── The join ──────────────────────────────────────────────────────────────
  const joined = new Uint8Array(results[0]!.bytes.length + results[1]!.bytes.length);
  joined.set(results[0]!.bytes, 0);
  joined.set(results[1]!.bytes, results[0]!.bytes.length);
  const joinedCount = countAnnexbAccessUnits(joined);
  report.joined = {
    bytes: joined.length,
    pictures: joinedCount.pictures,
    vclNals: joinedCount.vclNals,
    expected: results[0]!.pictures + results[1]!.pictures,
    counterAccepts: joinedCount.pictures === results[0]!.pictures + results[1]!.pictures,
  };
  log(`our counter over the join: pictures=${joinedCount.pictures} expected=${results[0]!.pictures + results[1]!.pictures}`);

  for (const [label, bytes] of [
    ['hardware-only', results[0]!.bytes],
    ['software-only', results[1]!.bytes],
    ['hardware-then-software', joined],
  ] as const) {
    const d = await decodeCount(bytes);
    report[`decode.${label}`] = d;
    log(`decoder over ${label}: frames=${d.frames} error=${d.error ?? 'none'}`);
  }

  (window as unknown as { __paramSetReport: unknown; __paramSetStreams: unknown }).__paramSetReport = report;
  // Stashed so the round can hand the SAME joined bytes to the real ffmpeg
  // sidecar binary, which is the second half of the acceptance question.
  (window as unknown as { __paramSetStreams: unknown }).__paramSetStreams = {
    hardware: results[0]!.bytes, software: results[1]!.bytes, joined,
  };
  log('--- REPORT ---');
  log(JSON.stringify(report, null, 2));
}

void run().catch((e: unknown) => log(`SPIKE FAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`));
