/**
 * THROWAWAY — B0 RECONCILIATION harness (Part 1).
 *
 * B0's ORIGINAL encoder spike is unrecoverable from git (commit 1cd8d03 is
 * docs-only; the spike files were never committed). This reconstructs B0's
 * methodology exactly as the writeup recorded it — 15 synthetic canvas frames,
 * VideoFrame(canvas, {timestamp}), close-after-encode, hw/sw x avc/annexb,
 * isConfigSupported first, flush() with a hard timeout — and sweeps the config
 * fields B0 did NOT record (codec string, resolution, latencyMode) to find
 * which, if any, reproduces B0's "encodeQueueSize 15->11 then plateau, 0 chunks,
 * flush never resolves" hang signature on today's runtime.
 *
 * Polls encodeQueueSize DURING the flush wait so a plateau (B0's signature) is
 * characterized, not just pass/fail.
 *
 * Exfils to the same local listener. Delete when done.
 */

const EXFIL_URL = 'http://127.0.0.1:8799/result';
const W_1080 = 1920, H_1080 = 1080;
const ENCODE_FRAMES = 15;
const FLUSH_TIMEOUT_MS = 10000;

/* eslint-disable @typescript-eslint/no-explicit-any */

function log(msg: string): void {
  const el = document.getElementById('log');
  if (el) el.textContent += '\n' + msg;
  // eslint-disable-next-line no-console
  console.log('[B0REPRO] ' + msg);
}

async function exfil(tag: string, payload: unknown): Promise<void> {
  try {
    await fetch(EXFIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ tag, payload, ts: Date.now() }),
      mode: 'cors',
      keepalive: true,
    });
  } catch (e) {
    log('exfil failed: ' + (e instanceof Error ? e.message : String(e)));
  }
}

interface Spec {
  label: string;
  hypothesis: string;
  codec: string;
  width: number;
  height: number;
  hw: HardwareAcceleration;
  format: 'avc' | 'annexb';
  latencyMode: LatencyMode;
}

interface Result {
  spec: Spec;
  isConfigSupported: unknown;
  constructedOk: boolean;
  configuredOk: boolean;
  framesSubmitted: number;
  chunksEmitted: number;
  totalBytes: number;
  firstChunkType: string | null;
  queueAfterSubmit: number | null;
  queueSamples: number[]; // encodeQueueSize sampled ~every 500ms during flush wait
  flushResolved: boolean;
  flushTimedOut: boolean;
  stateAtEnd: string | null;
  errorCbFired: boolean;
  wallMs: number | null;
  hangSignatureMatch: boolean; // isCfgSup true, flush timed out, 0 chunks -> B0's signature
  error: string | null;
}

function makeFrame(i: number, ctx: CanvasRenderingContext2D, w: number, h: number): VideoFrame {
  ctx.fillStyle = `hsl(${(i * 24) % 360}, 70%, 45%)`;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(h / 9)}px sans-serif`;
  ctx.fillText('frame ' + i, 40 + (i * 13) % 200, Math.round(h / 3) + (i * 7) % 200);
  return new VideoFrame(ctx.canvas, { timestamp: i * 33333, duration: 33333 });
}

async function runSpec(spec: Spec): Promise<Result> {
  const r: Result = {
    spec,
    isConfigSupported: null,
    constructedOk: false,
    configuredOk: false,
    framesSubmitted: 0,
    chunksEmitted: 0,
    totalBytes: 0,
    firstChunkType: null,
    queueAfterSubmit: null,
    queueSamples: [],
    flushResolved: false,
    flushTimedOut: false,
    stateAtEnd: null,
    errorCbFired: false,
    wallMs: null,
    hangSignatureMatch: false,
    error: null,
  };

  const config: VideoEncoderConfig = {
    codec: spec.codec,
    width: spec.width,
    height: spec.height,
    bitrate: 8_000_000,
    framerate: 30,
    hardwareAcceleration: spec.hw,
    latencyMode: spec.latencyMode,
    avc: { format: spec.format },
  };

  log(`--- [${spec.label}] ${spec.codec} ${spec.width}x${spec.height} hw=${spec.hw} fmt=${spec.format} lat=${spec.latencyMode}`);
  log(`    hypothesis: ${spec.hypothesis}`);

  try {
    const sup = await VideoEncoder.isConfigSupported(config);
    r.isConfigSupported = { supported: sup.supported, config: sup.config };
    log(`    isConfigSupported: ${sup.supported}`);
  } catch (e) {
    r.isConfigSupported = { threw: e instanceof Error ? e.message : String(e) };
    log('    isConfigSupported THREW: ' + JSON.stringify(r.isConfigSupported));
  }

  const canvas = document.createElement('canvas');
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d')!;
  const start = performance.now();
  let encoder: VideoEncoder | null = null;

  try {
    encoder = new VideoEncoder({
      output(chunk) {
        r.chunksEmitted++;
        r.totalBytes += chunk.byteLength;
        if (r.firstChunkType === null) r.firstChunkType = chunk.type;
      },
      error(e) {
        r.errorCbFired = true;
        r.error = 'error cb: ' + e.message;
        log('    ENCODER ERROR CB: ' + e.message);
      },
    });
    r.constructedOk = true;
    encoder.configure(config);
    r.configuredOk = true;

    for (let i = 0; i < ENCODE_FRAMES; i++) {
      const f = makeFrame(i, ctx, spec.width, spec.height);
      encoder.encode(f, { keyFrame: i === 0 });
      f.close();
      r.framesSubmitted++;
    }
    r.queueAfterSubmit = encoder.encodeQueueSize;
    log(`    submitted ${r.framesSubmitted}, queue=${r.queueAfterSubmit}, chunks=${r.chunksEmitted}`);

    // Poll queue size during the flush wait to catch a plateau (B0's signature).
    let polling = true;
    const poller = (async () => {
      while (polling) {
        r.queueSamples.push(encoder!.encodeQueueSize);
        await new Promise((res) => setTimeout(res, 500));
      }
    })();

    const flushP = encoder.flush().then(() => { r.flushResolved = true; });
    const timeoutP = new Promise<void>((res) => setTimeout(() => { r.flushTimedOut = true; res(); }, FLUSH_TIMEOUT_MS));
    await Promise.race([flushP, timeoutP]);
    polling = false;
    await poller;

    r.stateAtEnd = encoder.state;
    if (r.flushTimedOut) {
      log(`    ⚠️ HANG: flush timed out. queueSamples=[${r.queueSamples.join(',')}] chunks=${r.chunksEmitted} state=${r.stateAtEnd}`);
    } else {
      log(`    ✓ flush resolved. chunks=${r.chunksEmitted} bytes=${r.totalBytes} firstChunk=${r.firstChunkType}`);
    }
  } catch (e) {
    r.error = (r.error ? r.error + ' | ' : '') + (e instanceof Error ? e.message : String(e));
    log('    THREW: ' + r.error);
  } finally {
    r.wallMs = performance.now() - start;
    try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch { /* hung encoder */ }
  }

  const saysYes = (r.isConfigSupported as any)?.supported === true;
  r.hangSignatureMatch = saysYes && r.flushTimedOut && r.chunksEmitted === 0;
  return r;
}

// Matrix: the underspecified B0 fields. Control (my new harness) first, then
// the canonical-sample Baseline strings B0 most likely used, at 1080p (level
// overflow suspect) and at the sample's own small resolution (should work).
const SPECS: Spec[] = [
  { label: 'control-my-new', hypothesis: 'my 2026-07-09 harness config — expected WORK', codec: 'avc1.640028', width: W_1080, height: H_1080, hw: 'prefer-hardware', format: 'avc', latencyMode: 'quality' },
  { label: 'baseline31@1080-hw', hypothesis: 'canonical avc1.42001f (Baseline L3.1) fed 1080p — level overflow, HANG suspect', codec: 'avc1.42001f', width: W_1080, height: H_1080, hw: 'prefer-hardware', format: 'avc', latencyMode: 'quality' },
  { label: 'baseline31@1080-sw', hypothesis: 'same, software path', codec: 'avc1.42001f', width: W_1080, height: H_1080, hw: 'prefer-software', format: 'avc', latencyMode: 'quality' },
  { label: 'baseline30@1080-hw', hypothesis: 'avc1.42E01E (Baseline L3.0) fed 1080p — worse level overflow', codec: 'avc1.42E01E', width: W_1080, height: H_1080, hw: 'prefer-hardware', format: 'avc', latencyMode: 'quality' },
  { label: 'baseline31@640-hw', hypothesis: 'canonical avc1.42001f at sample size 640x480 — expected WORK', codec: 'avc1.42001f', width: 640, height: 480, hw: 'prefer-hardware', format: 'avc', latencyMode: 'quality' },
  { label: 'main40@1080-hw', hypothesis: 'avc1.4d0028 (Main L4.0) 1080p — profile variant', codec: 'avc1.4d0028', width: W_1080, height: H_1080, hw: 'prefer-hardware', format: 'avc', latencyMode: 'quality' },
  { label: 'realtime@1080-hw', hypothesis: 'my config but latencyMode=realtime', codec: 'avc1.640028', width: W_1080, height: H_1080, hw: 'prefer-hardware', format: 'avc', latencyMode: 'realtime' },
  { label: 'baseline31@1080-annexb', hypothesis: 'baseline 1080p + annexb format', codec: 'avc1.42001f', width: W_1080, height: H_1080, hw: 'prefer-hardware', format: 'annexb', latencyMode: 'quality' },
];

async function main(): Promise<void> {
  const el = document.getElementById('log');
  if (el) el.textContent = '';
  log('B0 RECONCILIATION harness — UA: ' + navigator.userAgent);
  await exfil('b0_env', { userAgent: navigator.userAgent, hasVideoEncoder: typeof (globalThis as any).VideoEncoder !== 'undefined' });

  const results: Result[] = [];
  for (const spec of SPECS) {
    const r = await runSpec(spec);
    results.push(r);
    await exfil('b0_result', r);
  }

  const summary = {
    total: results.length,
    worked: results.filter((r) => r.flushResolved && r.chunksEmitted > 0).map((r) => r.spec.label),
    hung: results.filter((r) => r.hangSignatureMatch).map((r) => r.spec.label),
    threw: results.filter((r) => r.error && !r.hangSignatureMatch).map((r) => ({ label: r.spec.label, error: r.error })),
  };
  (window as any).__b0Result = { results, summary };
  log('=== SUMMARY: ' + JSON.stringify(summary, null, 2));
  await exfil('b0_DONE', { summary, results });
  log('=== B0 RECONCILIATION COMPLETE ===');
}

document.getElementById('rerun')?.addEventListener('click', () => void main());
void main();
