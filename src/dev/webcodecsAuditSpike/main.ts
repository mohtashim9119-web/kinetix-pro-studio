/**
 * THROWAWAY AUDIT SPIKE — WebCodecs VideoDecoder + VideoEncoder feasibility check.
 *
 * Standalone. Not imported by any real app code. Purpose: on the REAL Tauri
 * WKWebView (macOS), independently confirm, first-hand, whether:
 *   - VideoDecoder.isConfigSupported() agrees with a real configure()/decode() cycle
 *   - VideoEncoder.isConfigSupported() agrees with a real configure()/encode()/flush() cycle
 * for the exact codec the app's export uses (H.264 High @ 1080p/30, libx264/yuv420p).
 *
 * It exfiltrates its structured result via HTTP POST to a local listener (see
 * EXFIL_URL) AND to console, because this must run inside WKWebView (not Chromium)
 * and there is no interactive devtools in the automated run.
 *
 * Delete src/dev/webcodecsAuditSpike/ + spike-webcodecs-audit.html when done.
 */

import { createFile, MP4BoxBuffer, DataStream, Endianness, type Movie, type Track } from 'mp4box';

type VideoTrack = Track & { video: { width: number; height: number } };

const SAMPLE_URL = '/_spike/sample.mp4';
const EXFIL_URL = 'http://127.0.0.1:8799/result';

// The app's real export target: H.264 High profile, yuv420p, 1080p, 30fps (libx264 crf16).
const EXPORT_CODEC = 'avc1.640028'; // H.264 High @ Level 4.0
const W = 1920;
const H = 1080;
const FPS = 30;
const FRAME_DUR_US = Math.round(1_000_000 / FPS);
const ENCODE_FRAMES = 15;
const FLUSH_TIMEOUT_MS = 8000;

/* eslint-disable @typescript-eslint/no-explicit-any */

function log(msg: string): void {
  const el = document.getElementById('log');
  if (el) el.textContent += '\n' + msg;
  // eslint-disable-next-line no-console
  console.log('[AUDIT] ' + msg);
}

async function exfil(tag: string, payload: unknown): Promise<void> {
  const body = JSON.stringify({ tag, payload, ts: Date.now() });
  // text/plain => "simple request", no CORS preflight. Fire-and-forget; the
  // listener receives the body regardless of whether JS can read the response.
  try {
    await fetch(EXFIL_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, mode: 'cors', keepalive: true });
  } catch (e) {
    log('exfil POST failed (listener may be down): ' + (e instanceof Error ? e.message : String(e)));
  }
}

function getDescription(isoFile: ReturnType<typeof createFile>, track: VideoTrack): Uint8Array {
  const trak = isoFile.getTrackById(track.id);
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = (entry as any).avcC ?? (entry as any).hvcC;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  }
  throw new Error('avcC/hvcC box not found on video track');
}

// ---------------------------------------------------------------------------
// DECODER
// ---------------------------------------------------------------------------

interface DecoderReport {
  api: 'VideoDecoder';
  present: boolean;
  // isConfigSupported() for a synthetic 1080p config (matches the encoder target)
  isConfigSupported_1080p: unknown;
  // isConfigSupported() for the real asset's actual config (what we then decode)
  isConfigSupported_asset: unknown;
  assetConfig: { codec: string; codedWidth: number; codedHeight: number } | null;
  configuredOk: boolean;
  chunksFed: number;
  framesDecoded: number;
  outputMonotonic: boolean | null;
  decodeMs: number | null;
  fps: number | null;
  // The discrepancy the task cares about: isConfigSupported true but real path failed
  supportedButFailed: boolean;
  error: string | null;
}

async function runDecoder(): Promise<DecoderReport> {
  const r: DecoderReport = {
    api: 'VideoDecoder',
    present: typeof (globalThis as any).VideoDecoder !== 'undefined' && typeof (globalThis as any).EncodedVideoChunk !== 'undefined',
    isConfigSupported_1080p: null,
    isConfigSupported_asset: null,
    assetConfig: null,
    configuredOk: false,
    chunksFed: 0,
    framesDecoded: 0,
    outputMonotonic: null,
    decodeMs: null,
    fps: null,
    supportedButFailed: false,
    error: null,
  };

  log('=== VideoDecoder ===');
  log('present: ' + r.present);
  if (!r.present) {
    r.error = 'VideoDecoder/EncodedVideoChunk not present in this runtime';
    return r;
  }

  // (a) isConfigSupported for a synthetic 1080p decode config (no description needed)
  try {
    const res = await VideoDecoder.isConfigSupported({ codec: EXPORT_CODEC, codedWidth: W, codedHeight: H });
    r.isConfigSupported_1080p = { supported: res.supported, config: res.config };
    log('isConfigSupported(1080p ' + EXPORT_CODEC + '): supported=' + res.supported);
  } catch (e) {
    r.isConfigSupported_1080p = { threw: e instanceof Error ? e.message : String(e) };
    log('isConfigSupported(1080p) THREW: ' + r.isConfigSupported_1080p);
  }

  // (b) real functional decode of the actual asset. Demux via mp4box (no container
  //     parser in WebCodecs), feed encoded chunks sequentially, no seeking.
  const outputsTsMs: number[] = [];
  let firstOutputAt: number | null = null;
  let lastOutputAt: number | null = null;
  let decodeStartedAt: number | null = null;

  const decoder = new VideoDecoder({
    output(frame) {
      r.framesDecoded++;
      outputsTsMs.push(frame.timestamp / 1000);
      if (firstOutputAt === null) firstOutputAt = performance.now();
      lastOutputAt = performance.now();
      frame.close();
    },
    error(e) {
      r.error = 'decoder error cb: ' + e.message;
      log('DECODER ERROR CB: ' + e.message);
    },
  });

  try {
    const resp = await fetch(SAMPLE_URL);
    if (!resp.ok) throw new Error('fetch sample.mp4 failed: ' + resp.status);
    const buf = await resp.arrayBuffer();

    const mp4boxFile = createFile(true);
    let videoTrack: VideoTrack | null = null;
    let received = 0;

    await new Promise<void>((resolve, reject) => {
      mp4boxFile.onError = (module: string, msg: string) => reject(new Error(`mp4box [${module}]: ${msg}`));

      mp4boxFile.onSamples = (_id: number, _u: unknown, samples) => {
        for (const s of samples) {
          if (!s.data) continue;
          r.chunksFed++;
          decoder.decode(new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: (1e6 * s.cts) / s.timescale,
            duration: (1e6 * s.duration) / s.timescale,
            data: s.data,
          }));
        }
        received += samples.length;
        if (videoTrack && received >= videoTrack.nb_samples) resolve();
      };

      mp4boxFile.onReady = (info: Movie) => {
        const t = info.videoTracks[0];
        if (!t || !t.video) { reject(new Error('no video track')); return; }
        videoTrack = t as VideoTrack;
        r.assetConfig = { codec: videoTrack.codec, codedWidth: videoTrack.video.width, codedHeight: videoTrack.video.height };
        const description = getDescription(mp4boxFile, videoTrack);
        const config: VideoDecoderConfig = {
          codec: videoTrack.codec,
          codedWidth: videoTrack.video.width,
          codedHeight: videoTrack.video.height,
          description,
        };
        log('asset config: ' + JSON.stringify(r.assetConfig));
        void (async () => {
          try {
            const sup = await VideoDecoder.isConfigSupported(config);
            r.isConfigSupported_asset = { supported: sup.supported };
            log('isConfigSupported(asset): supported=' + sup.supported);
            decoder.configure(config);
            r.configuredOk = true;
            decodeStartedAt = performance.now();
            mp4boxFile.setExtractionOptions(videoTrack!.id, null, { nbSamples: videoTrack!.nb_samples });
            mp4boxFile.start();
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      };

      mp4boxFile.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buf, 0));
    });

    await decoder.flush();
    r.outputMonotonic = outputsTsMs.every((v, i) => i === 0 || v >= outputsTsMs[i - 1]!);
    if (decodeStartedAt !== null && lastOutputAt !== null) {
      r.decodeMs = lastOutputAt - decodeStartedAt;
      r.fps = r.framesDecoded / (r.decodeMs / 1000);
    }
    log(`decoded ${r.framesDecoded}/${r.chunksFed} frames, monotonic=${r.outputMonotonic}, ${r.fps?.toFixed(0)} fps`);
  } catch (e) {
    r.error = (r.error ? r.error + ' | ' : '') + (e instanceof Error ? e.message : String(e));
    log('DECODER FUNCTIONAL FAILED: ' + r.error);
  }

  // Discrepancy: isConfigSupported said yes for the asset but the real cycle failed
  const assetSaysYes = (r.isConfigSupported_asset as any)?.supported === true;
  if (assetSaysYes && (!r.configuredOk || r.framesDecoded === 0 || r.error)) {
    r.supportedButFailed = true;
  }
  return r;
}

// ---------------------------------------------------------------------------
// ENCODER
// ---------------------------------------------------------------------------

interface EncoderConfigReport {
  label: string;
  hardwareAcceleration: string;
  bitstream: string;
  isConfigSupported: unknown; // { supported, config } | { threw }
  constructedOk: boolean;
  configuredOk: boolean;
  framesSubmitted: number;
  chunksEmitted: number;
  encodeQueueSizeAfterSubmit: number | null;
  encodeQueueSizeAtEnd: number | null;
  flushResolved: boolean;
  flushTimedOut: boolean;
  encoderStateAtEnd: string | null;
  errorCbFired: boolean;
  wallMs: number | null;
  // Proof the output is real bitstream, not empty/garbage:
  totalEncodedBytes: number;
  firstChunkType: string | null;
  firstChunkBytes: number | null;
  chunkKeyCount: number;
  // isConfigSupported true, but encode/flush hung or produced no output
  supportedButFailed: boolean;
  error: string | null;
}

function makeFrame(i: number, ctx: CanvasRenderingContext2D): VideoFrame {
  // Per-frame varying content so the encoder has real inter-frame deltas.
  ctx.fillStyle = `hsl(${(i * 24) % 360}, 70%, 45%)`;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = '120px sans-serif';
  ctx.fillText('frame ' + i, 80 + (i * 13) % 400, 300 + (i * 7) % 300);
  return new VideoFrame(ctx.canvas, { timestamp: i * FRAME_DUR_US, duration: FRAME_DUR_US });
}

async function runEncoderConfig(
  label: string,
  hardwareAcceleration: HardwareAcceleration,
  bitstream: 'avc' | 'annexb',
  canvas: HTMLCanvasElement,
): Promise<EncoderConfigReport> {
  const rep: EncoderConfigReport = {
    label,
    hardwareAcceleration,
    bitstream,
    isConfigSupported: null,
    constructedOk: false,
    configuredOk: false,
    framesSubmitted: 0,
    chunksEmitted: 0,
    encodeQueueSizeAfterSubmit: null,
    encodeQueueSizeAtEnd: null,
    flushResolved: false,
    flushTimedOut: false,
    encoderStateAtEnd: null,
    errorCbFired: false,
    wallMs: null,
    totalEncodedBytes: 0,
    firstChunkType: null,
    firstChunkBytes: null,
    chunkKeyCount: 0,
    supportedButFailed: false,
    error: null,
  };

  const config: VideoEncoderConfig = {
    codec: EXPORT_CODEC,
    width: W,
    height: H,
    bitrate: 8_000_000,
    framerate: FPS,
    hardwareAcceleration,
    avc: { format: bitstream },
  };

  log(`--- encoder config [${label}]: hw=${hardwareAcceleration} bitstream=${bitstream} ---`);

  // (a) isConfigSupported first
  try {
    const res = await VideoEncoder.isConfigSupported(config);
    rep.isConfigSupported = { supported: res.supported, config: res.config };
    log(`  isConfigSupported: supported=${res.supported}`);
  } catch (e) {
    rep.isConfigSupported = { threw: e instanceof Error ? e.message : String(e) };
    log('  isConfigSupported THREW: ' + JSON.stringify(rep.isConfigSupported));
  }

  // (b) real construct + configure + encode + flush
  const ctx = canvas.getContext('2d')!;
  const start = performance.now();
  let encoder: VideoEncoder | null = null;
  try {
    encoder = new VideoEncoder({
      output(chunk) {
        rep.chunksEmitted++;
        rep.totalEncodedBytes += chunk.byteLength;
        if (chunk.type === 'key') rep.chunkKeyCount++;
        if (rep.firstChunkType === null) {
          rep.firstChunkType = chunk.type;
          rep.firstChunkBytes = chunk.byteLength;
        }
      },
      error(e) {
        rep.errorCbFired = true;
        rep.error = 'encoder error cb: ' + e.message;
        log('  ENCODER ERROR CB: ' + e.message);
      },
    });
    rep.constructedOk = true;

    encoder.configure(config);
    rep.configuredOk = true;
    log('  configured OK, feeding ' + ENCODE_FRAMES + ' frames...');

    for (let i = 0; i < ENCODE_FRAMES; i++) {
      const frame = makeFrame(i, ctx);
      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
      rep.framesSubmitted++;
    }
    rep.encodeQueueSizeAfterSubmit = encoder.encodeQueueSize;
    log('  submitted ' + rep.framesSubmitted + ' frames, encodeQueueSize=' + rep.encodeQueueSizeAfterSubmit + ', chunksEmitted=' + rep.chunksEmitted);

    // flush() with a hard timeout — the known WKWebView failure mode is a silent hang
    const flushPromise = encoder.flush().then(() => { rep.flushResolved = true; });
    const timeout = new Promise<void>((res) => setTimeout(() => { rep.flushTimedOut = true; res(); }, FLUSH_TIMEOUT_MS));
    await Promise.race([flushPromise, timeout]);

    rep.encodeQueueSizeAtEnd = encoder.encodeQueueSize;
    rep.encoderStateAtEnd = encoder.state;
    if (rep.flushTimedOut) {
      log(`  ⚠️ flush() TIMED OUT after ${FLUSH_TIMEOUT_MS}ms — HANG. queueSize=${rep.encodeQueueSizeAtEnd} chunksEmitted=${rep.chunksEmitted} state=${rep.encoderStateAtEnd}`);
    } else {
      log(`  flush() resolved. chunksEmitted=${rep.chunksEmitted} state=${rep.encoderStateAtEnd}`);
    }
  } catch (e) {
    rep.error = (rep.error ? rep.error + ' | ' : '') + (e instanceof Error ? e.message : String(e));
    log('  ENCODER THREW: ' + rep.error);
  } finally {
    rep.wallMs = performance.now() - start;
    try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch { /* hung encoder may throw on close */ }
  }

  const saysYes = (rep.isConfigSupported as any)?.supported === true;
  if (saysYes && (rep.flushTimedOut || rep.chunksEmitted === 0 || rep.error)) {
    rep.supportedButFailed = true;
  }
  return rep;
}

async function runEncoder(): Promise<{
  api: 'VideoEncoder';
  present: boolean;
  configs: EncoderConfigReport[];
}> {
  log('=== VideoEncoder ===');
  const present = typeof (globalThis as any).VideoEncoder !== 'undefined' && typeof (globalThis as any).VideoFrame !== 'undefined';
  log('present: ' + present);
  if (!present) return { api: 'VideoEncoder', present, configs: [] };

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;

  const configs: EncoderConfigReport[] = [];
  // Mirror B0's matrix: {hardware, software} x {avc, annexb}
  configs.push(await runEncoderConfig('hw+avc', 'prefer-hardware', 'avc', canvas));
  configs.push(await runEncoderConfig('sw+avc', 'prefer-software', 'avc', canvas));
  configs.push(await runEncoderConfig('hw+annexb', 'prefer-hardware', 'annexb', canvas));
  configs.push(await runEncoderConfig('sw+annexb', 'prefer-software', 'annexb', canvas));
  return { api: 'VideoEncoder', present, configs };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const el = document.getElementById('log');
  if (el) el.textContent = '';
  log('WebCodecs AUDIT spike starting — UA: ' + navigator.userAgent);

  const env = {
    userAgent: navigator.userAgent,
    hasVideoDecoder: typeof (globalThis as any).VideoDecoder !== 'undefined',
    hasVideoEncoder: typeof (globalThis as any).VideoEncoder !== 'undefined',
    hasEncodedVideoChunk: typeof (globalThis as any).EncodedVideoChunk !== 'undefined',
    hasVideoFrame: typeof (globalThis as any).VideoFrame !== 'undefined',
  };
  log('env: ' + JSON.stringify(env));
  await exfil('env', env);

  const decoder = await runDecoder();
  await exfil('decoder', decoder);

  const encoder = await runEncoder();
  await exfil('encoder', encoder);

  const summary = {
    env,
    decoder,
    encoder,
    verdict: {
      decoderWorks: decoder.configuredOk && decoder.framesDecoded > 0 && decoder.outputMonotonic === true,
      encoderAnyConfigWorks: encoder.configs.some((c) => c.flushResolved && c.chunksEmitted > 0),
      encoderSupportedButFailedCount: encoder.configs.filter((c) => c.supportedButFailed).length,
    },
  };
  (window as any).__auditResult = summary;
  log('=== VERDICT: ' + JSON.stringify(summary.verdict));
  log('=== AUDIT COMPLETE — full result at window.__auditResult and exfil listener ===');
  await exfil('DONE', summary);
}

document.getElementById('rerun')?.addEventListener('click', () => void main());
void main();
