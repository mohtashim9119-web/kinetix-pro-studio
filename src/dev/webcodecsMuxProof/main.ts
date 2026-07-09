/**
 * THROWAWAY — Part 2 end-to-end MUX + ROUND-TRIP proof.
 *
 * In the real Tauri WKWebView:
 *   1. VideoEncoder encodes 60 real canvas frames (1080p/30, H.264 High, annexb).
 *   2. Round-trips those exact encoded chunks back through VideoDecoder and
 *      confirms they decode to frames in monotonic order (closes the loop).
 *   3. Concatenates the annexb chunks into a raw H.264 elementary stream and
 *      exfils it (base64) so the bundled ffmpeg sidecar can mux it to MP4 and
 *      we can verify the file actually plays / is visually correct.
 *
 * Delete src/dev/webcodecsMuxProof/ + spike-webcodecs-muxproof.html when done.
 */

const EXFIL_URL = 'http://127.0.0.1:8799/result';
const W = 1920, H = 1080, FPS = 30, FRAMES = 60;
const FRAME_DUR_US = Math.round(1_000_000 / FPS);

/* eslint-disable @typescript-eslint/no-explicit-any */

function log(msg: string): void {
  const el = document.getElementById('log');
  if (el) el.textContent += '\n' + msg;
  // eslint-disable-next-line no-console
  console.log('[MUXPROOF] ' + msg);
}

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as unknown as number[]);
  }
  return btoa(out);
}

async function exfil(tag: string, payload: unknown): Promise<void> {
  try {
    // No keepalive: WebKit caps keepalive request bodies at ~64KB and the H.264
    // stream payload is ~750KB base64. The page stays open, so keepalive is unneeded.
    await fetch(EXFIL_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ tag, payload, ts: Date.now() }), mode: 'cors' });
  } catch (e) { log('exfil failed: ' + (e instanceof Error ? e.message : String(e))); }
}

interface Saved { type: 'key' | 'delta'; timestamp: number; duration: number | null; bytes: Uint8Array; }

function makeFrame(i: number, ctx: CanvasRenderingContext2D): VideoFrame {
  // Moving content so playback / frame extraction is visually verifiable.
  ctx.fillStyle = `hsl(${(i * 6) % 360}, 65%, 40%)`;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 160px sans-serif';
  ctx.fillText('FRAME ' + i, 120 + (i * 20) % 900, 560);
  ctx.fillStyle = '#0f6';
  ctx.fillRect((i / FRAMES) * W, H - 80, 60, 80); // a marker sweeping left->right over time
  return new VideoFrame(ctx.canvas, { timestamp: i * FRAME_DUR_US, duration: FRAME_DUR_US });
}

async function main(): Promise<void> {
  const el = document.getElementById('log');
  if (el) el.textContent = '';
  log('Part 2 mux+roundtrip proof — UA: ' + navigator.userAgent);

  const summary: any = {
    userAgent: navigator.userAgent,
    framesSubmitted: 0,
    chunksEmitted: 0,
    keyframes: 0,
    streamBytes: 0,
    decoderConfig: null,
    roundtripDecoded: 0,
    roundtripMonotonic: null,
    encodeError: null,
    decodeError: null,
  };

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const saved: Saved[] = [];
  let decoderConfig: VideoDecoderConfig | null = null;

  // ---- ENCODE ----
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      summary.chunksEmitted++;
      if (chunk.type === 'key') summary.keyframes++;
      if (!decoderConfig && metadata?.decoderConfig) {
        decoderConfig = metadata.decoderConfig;
        summary.decoderConfig = {
          codec: decoderConfig.codec,
          codedWidth: decoderConfig.codedWidth,
          codedHeight: decoderConfig.codedHeight,
          hasDescription: !!decoderConfig.description,
        };
      }
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      saved.push({ type: chunk.type, timestamp: chunk.timestamp, duration: chunk.duration, bytes: buf });
    },
    error(e) { summary.encodeError = e.message; log('ENCODER ERROR: ' + e.message); },
  });

  const config: VideoEncoderConfig = {
    codec: 'avc1.640028', width: W, height: H, bitrate: 8_000_000, framerate: FPS,
    hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality', avc: { format: 'annexb' },
  };
  log('encoder isConfigSupported: ' + JSON.stringify((await VideoEncoder.isConfigSupported(config)).supported));
  encoder.configure(config);
  for (let i = 0; i < FRAMES; i++) {
    const f = makeFrame(i, ctx);
    encoder.encode(f, { keyFrame: i % 30 === 0 });
    f.close();
    summary.framesSubmitted++;
  }
  await encoder.flush();
  encoder.close();
  log(`encoded ${summary.chunksEmitted} chunks (${summary.keyframes} keyframes) from ${summary.framesSubmitted} frames`);

  // ---- ROUND-TRIP DECODE (same chunks back through VideoDecoder) ----
  const decodedTs: number[] = [];
  const decoder = new VideoDecoder({
    output(frame) { decodedTs.push(frame.timestamp); frame.close(); },
    error(e) { summary.decodeError = e.message; log('DECODER ERROR: ' + e.message); },
  });
  try {
    const dcfg: VideoDecoderConfig = decoderConfig ?? { codec: 'avc1.640028', codedWidth: W, codedHeight: H };
    const dsup = await VideoDecoder.isConfigSupported(dcfg);
    log('roundtrip decoder isConfigSupported: ' + JSON.stringify(dsup.supported) + ' desc=' + (!!dcfg.description));
    decoder.configure(dcfg);
    for (const s of saved) {
      decoder.decode(new EncodedVideoChunk({ type: s.type, timestamp: s.timestamp, duration: s.duration ?? undefined, data: s.bytes }));
    }
    await decoder.flush();
    summary.roundtripDecoded = decodedTs.length;
    summary.roundtripMonotonic = decodedTs.every((v, i) => i === 0 || v >= decodedTs[i - 1]!);
    log(`round-trip decoded ${summary.roundtripDecoded}/${summary.chunksEmitted} frames, monotonic=${summary.roundtripMonotonic}`);
  } catch (e) {
    summary.decodeError = (summary.decodeError ? summary.decodeError + ' | ' : '') + (e instanceof Error ? e.message : String(e));
    log('ROUND-TRIP FAILED: ' + summary.decodeError);
  }

  // ---- CONCATENATE annexb stream + exfil for ffmpeg mux ----
  const total = saved.reduce((n, s) => n + s.bytes.length, 0);
  const stream = new Uint8Array(total);
  let off = 0;
  for (const s of saved) { stream.set(s.bytes, off); off += s.bytes.length; }
  summary.streamBytes = total;
  log(`concatenated annexb elementary stream: ${total} bytes; exfiling for ffmpeg mux...`);
  await exfil('h264_b64', bytesToBase64(stream));

  (window as any).__muxProof = summary;
  await exfil('mux_DONE', summary);
  log('=== DONE: ' + JSON.stringify(summary, null, 2));
}

document.getElementById('rerun')?.addEventListener('click', () => void main());
void main();
