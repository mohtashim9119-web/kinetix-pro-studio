/**
 * THROWAWAY WKWebView GATE SPIKE — worker half.
 *
 * Runs entirely inside a MODULE WEB WORKER. This is the load-bearing
 * combination the WebCodecs+WebGL2-in-Worker export architecture depends on,
 * proven separately + main-thread on WKWebView (Phase 6 / mux-proof) but NEVER
 * recorded together in a worker on WKWebView. This spike measures exactly that.
 *
 * Everything here is exercised in the worker, ALL INSIDE ONE WORKER:
 *   (b) new OffscreenCanvas(1920,1080).getContext('webgl2')  — non-null?
 *   (c) construct the REAL production GlCompositor and render a real frame
 *       (services/gl/glCompositor.ts — the actual shipped compositor, not a stub)
 *   (d) new VideoFrame(webgl2OffscreenCanvas, {...})          — constructs?
 *   (e) VideoEncoder hardware: encode >=600 frames from the worker GL canvas,
 *       flush, report chunks / flush-resolved / queue trajectory / errors / ms
 *   (f) fallback ladder: prefer-software, no-preference
 *   (g) VideoFrame transfer across the worker boundary: main thread constructs a
 *       VideoFrame, postMessages it (transfer list), the worker uploadFrame()s it
 *       to a GL texture via the real compositor  — mirrors the audit's B4 spike
 *   D2(a) drawImage(glCanvas -> 2dCanvas) per-frame ms across >=100 frames
 *   D3  self.fonts / FontFace availability inside the worker
 *
 * Results are postMessage'd back to the main-thread half (main.ts), which owns
 * the HTTP exfil to 127.0.0.1:8799 (same methodology as spike-webcodecs-audit).
 *
 * Delete src/dev/webcodecsWorkerSpike/ + spike-webcodecs-worker.html when the
 * gate is decided.
 */

import { GlCompositor } from '../../services/gl/glCompositor';
import type { CompositeParams } from '../../services/gl/compositeParams';

/* eslint-disable @typescript-eslint/no-explicit-any */

const W = 1920;
const H = 1080;
const FPS = 30;
const FRAME_DUR_US = Math.round(1_000_000 / FPS);
const EXPORT_CODEC = 'avc1.640028'; // H.264 High @ Level 4.0 — the app's real export target
const ENCODE_FRAMES = 600; // 20s at 30fps
const FLUSH_TIMEOUT_MS = 15_000;
const QUEUE_HIGH_WATER = 30; // yield to let the encoder drain when the queue climbs past this

function wlog(msg: string): void {
  // eslint-disable-next-line no-console
  console.log('[WORKER-SPIKE] ' + msg);
  (self as any).postMessage({ type: 'log', msg });
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx]!;
}

// ---------------------------------------------------------------------------
// Shared GL state, built once by setupGl(), reused by every sub-test.
// ---------------------------------------------------------------------------

interface GlState {
  canvas: OffscreenCanvas;
  gl: WebGL2RenderingContext;
  compositor: GlCompositor;
}

let glState: GlState | null = null;

/** Draw a colored gradient onto a 2D OffscreenCanvas → ImageBitmap, so the
 *  real GlCompositor has genuine content to sample (not a black texture). */
async function makeSourceBitmap(seed: number): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${(seed * 47) % 360}, 70%, 45%)`);
  g.addColorStop(1, `hsl(${(seed * 47 + 140) % 360}, 70%, 55%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = '160px sans-serif';
  ctx.fillText('GL ' + seed, 120, 540);
  return await createImageBitmap(c);
}

/** Vary grade + zoom per frame so the encoder sees real inter-frame deltas and
 *  the render actually exercises the full render-target pass chain (blit→zoom→grade),
 *  not just the single-blit fast path. */
function paramsForFrame(i: number): CompositeParams {
  return {
    transition: null,
    animScaleA: 1 + 0.25 * Math.abs(Math.sin(i * 0.05)),
    animScaleB: 1,
    grade: { brightness: 0.3 * Math.sin(i * 0.11), contrast: 0, saturation: 0, temperature: 0 },
  };
}

function readCenterPixel(gl: WebGL2RenderingContext): [number, number, number, number] {
  const px = new Uint8Array(4);
  gl.readPixels(Math.floor(W / 2), Math.floor(H / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [px[0]!, px[1]!, px[2]!, px[3]!];
}

// ---------------------------------------------------------------------------
// (b) + (c) OffscreenCanvas+WebGL2 in worker, real GlCompositor constructs+renders
// ---------------------------------------------------------------------------

interface GlReport {
  offscreenCanvasPresent: boolean;
  webgl2ContextNonNull: boolean;
  glVersion: string | null;
  glRenderer: string | null;
  unmaskedRenderer: string | null;
  compositorConstructed: boolean;
  renderedFrame: boolean;
  centerPixelNonBlack: boolean | null;
  centerPixel: number[] | null;
  error: string | null;
}

async function setupGl(): Promise<GlReport> {
  const r: GlReport = {
    offscreenCanvasPresent: typeof (self as any).OffscreenCanvas !== 'undefined',
    webgl2ContextNonNull: false,
    glVersion: null,
    glRenderer: null,
    unmaskedRenderer: null,
    compositorConstructed: false,
    renderedFrame: false,
    centerPixelNonBlack: null,
    centerPixel: null,
    error: null,
  };
  try {
    if (!r.offscreenCanvasPresent) throw new Error('OffscreenCanvas not present in worker');
    const canvas = new OffscreenCanvas(W, H);
    // preserveDrawingBuffer so readPixels + VideoFrame capture see the last draw
    // even across task boundaries; the real compositor won't need it.
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    r.webgl2ContextNonNull = gl !== null;
    if (!gl) throw new Error('getContext("webgl2") returned null in worker');

    r.glVersion = gl.getParameter(gl.VERSION) as string;
    r.glRenderer = gl.getParameter(gl.RENDERER) as string;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) r.unmaskedRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;

    // (c) the REAL production compositor — same class the app ships.
    const compositor = new GlCompositor(gl);
    r.compositorConstructed = true;

    const bmp = await makeSourceBitmap(1);
    compositor.uploadFrame('a', bmp);
    compositor.renderFrame(paramsForFrame(0));
    gl.finish();
    r.renderedFrame = true;
    const px = readCenterPixel(gl);
    r.centerPixel = px;
    r.centerPixelNonBlack = px[0] + px[1] + px[2] > 30;
    bmp.close();

    glState = { canvas, gl, compositor };
  } catch (e) {
    r.error = e instanceof Error ? (e.stack ?? e.message) : String(e);
    wlog('setupGl FAILED: ' + r.error);
  }
  return r;
}

// ---------------------------------------------------------------------------
// (d) + (e) + (f) VideoFrame from worker GL canvas, encode 600 frames, ladder
// ---------------------------------------------------------------------------

interface EncoderReport {
  label: string;
  hardwareAcceleration: string;
  isConfigSupported: unknown;
  constructedOk: boolean;
  configuredOk: boolean;
  videoFrameFromGlCanvas: boolean; // (d)
  framesSubmitted: number;
  chunksEmitted: number;
  keyChunks: number;
  totalEncodedBytes: number;
  firstChunkType: string | null;
  queueTrajectory: number[]; // encodeQueueSize sampled every ~60 frames
  encodeQueueSizeAtEnd: number | null;
  flushResolved: boolean;
  flushTimedOut: boolean;
  encoderStateAtEnd: string | null;
  errorCbFired: boolean;
  error: string | null;
  wallMs: number | null;
  fps: number | null;
}

async function runEncoderConfig(label: string, hw: HardwareAcceleration): Promise<EncoderReport> {
  const rep: EncoderReport = {
    label,
    hardwareAcceleration: hw,
    isConfigSupported: null,
    constructedOk: false,
    configuredOk: false,
    videoFrameFromGlCanvas: false,
    framesSubmitted: 0,
    chunksEmitted: 0,
    keyChunks: 0,
    totalEncodedBytes: 0,
    firstChunkType: null,
    queueTrajectory: [],
    encodeQueueSizeAtEnd: null,
    flushResolved: false,
    flushTimedOut: false,
    encoderStateAtEnd: null,
    errorCbFired: false,
    error: null,
    wallMs: null,
    fps: null,
  };

  if (!glState) {
    rep.error = 'no GL state (setupGl failed) — cannot source frames';
    return rep;
  }
  if (typeof (self as any).VideoEncoder === 'undefined' || typeof (self as any).VideoFrame === 'undefined') {
    rep.error = 'VideoEncoder/VideoFrame not present in worker';
    return rep;
  }

  const { gl, compositor, canvas } = glState;

  const config: VideoEncoderConfig = {
    codec: EXPORT_CODEC,
    width: W,
    height: H,
    bitrate: 8_000_000,
    framerate: FPS,
    hardwareAcceleration: hw,
    avc: { format: 'annexb' },
  };

  try {
    const sup = await (self as any).VideoEncoder.isConfigSupported(config);
    rep.isConfigSupported = { supported: sup.supported };
    wlog(`[${label}] isConfigSupported: ${sup.supported}`);
  } catch (e) {
    rep.isConfigSupported = { threw: e instanceof Error ? e.message : String(e) };
  }

  const start = performance.now();
  let encoder: VideoEncoder | null = null;
  try {
    encoder = new VideoEncoder({
      output(chunk) {
        rep.chunksEmitted++;
        rep.totalEncodedBytes += chunk.byteLength;
        if (chunk.type === 'key') rep.keyChunks++;
        if (rep.firstChunkType === null) rep.firstChunkType = chunk.type;
      },
      error(e) {
        rep.errorCbFired = true;
        rep.error = 'encoder error cb: ' + e.message;
        wlog(`[${label}] ENCODER ERROR CB: ${e.message}`);
      },
    });
    rep.constructedOk = true;
    encoder.configure(config);
    rep.configuredOk = true;
    wlog(`[${label}] configured OK — encoding ${ENCODE_FRAMES} frames from worker GL canvas...`);

    for (let i = 0; i < ENCODE_FRAMES; i++) {
      compositor.renderFrame(paramsForFrame(i));
      // (d) VideoFrame constructed from the worker's WebGL2 OffscreenCanvas.
      const frame = new VideoFrame(canvas as unknown as CanvasImageSource, {
        timestamp: i * FRAME_DUR_US,
        duration: FRAME_DUR_US,
      });
      rep.videoFrameFromGlCanvas = true;
      encoder.encode(frame, { keyFrame: i % 60 === 0 });
      frame.close();
      rep.framesSubmitted++;

      if (i % 60 === 0) rep.queueTrajectory.push(encoder.encodeQueueSize);
      // Backpressure: don't let the queue run away on the slower software path.
      if (encoder.encodeQueueSize > QUEUE_HIGH_WATER) {
        await new Promise<void>((res) => setTimeout(res, 0));
      }
    }
    wlog(`[${label}] submitted ${rep.framesSubmitted}, queue=${encoder.encodeQueueSize}, chunks=${rep.chunksEmitted} — flushing...`);

    // The losing side of a Promise.race is NOT cancelled — its setTimeout still
    // fires later and would otherwise mutate rep.flushTimedOut well after this
    // function has returned (observed once during the initial harness run:
    // flush resolved cleanly, but a stray 15s timer fired ~9s into the NEXT
    // encoder config's run and flipped this rep's flushTimedOut to true after
    // the fact). Track + clear whichever timer loses explicitly.
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const flushPromise = encoder.flush().then(() => {
      rep.flushResolved = true;
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    });
    const timeout = new Promise<void>((res) => {
      timeoutHandle = setTimeout(() => { rep.flushTimedOut = true; res(); }, FLUSH_TIMEOUT_MS);
    });
    await Promise.race([flushPromise, timeout]);

    rep.encodeQueueSizeAtEnd = encoder.encodeQueueSize;
    rep.encoderStateAtEnd = encoder.state;
    if (rep.flushTimedOut) {
      wlog(`[${label}] ⚠️ flush TIMED OUT after ${FLUSH_TIMEOUT_MS}ms — HANG. chunks=${rep.chunksEmitted}`);
    } else {
      wlog(`[${label}] flush resolved. chunks=${rep.chunksEmitted} state=${rep.encoderStateAtEnd}`);
    }
    void gl; // (kept so the destructure reads intentional)
  } catch (e) {
    rep.error = (rep.error ? rep.error + ' | ' : '') + (e instanceof Error ? e.message : String(e));
    wlog(`[${label}] ENCODER THREW: ${rep.error}`);
  } finally {
    rep.wallMs = performance.now() - start;
    if (rep.wallMs > 0 && rep.framesSubmitted > 0) rep.fps = rep.framesSubmitted / (rep.wallMs / 1000);
    try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch { /* hung encoder may throw */ }
  }
  return rep;
}

// ---------------------------------------------------------------------------
// D2(a) drawImage(glCanvas -> 2dCanvas) per-frame cost
// ---------------------------------------------------------------------------

interface DrawImageReport {
  frames: number;
  medianMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  error: string | null;
}

async function runDrawImageTest(): Promise<DrawImageReport> {
  const r: DrawImageReport = { frames: 0, medianMs: null, p95Ms: null, maxMs: null, error: null };
  try {
    if (!glState) throw new Error('no GL state');
    const { compositor, canvas } = glState;
    const dst = new OffscreenCanvas(W, H);
    const ctx = dst.getContext('2d');
    if (!ctx) throw new Error('2d context null on OffscreenCanvas');
    const N = 120;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      compositor.renderFrame(paramsForFrame(i));
      (glState.gl as WebGL2RenderingContext).finish();
      const t0 = performance.now();
      ctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
      // Force the draw to actually complete before timing (read one pixel back).
      ctx.getImageData(0, 0, 1, 1);
      samples.push(performance.now() - t0);
      r.frames++;
    }
    r.medianMs = median(samples);
    r.p95Ms = percentile(samples, 95);
    r.maxMs = Math.max(...samples);
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
    wlog('drawImage test FAILED: ' + r.error);
  }
  return r;
}

// ---------------------------------------------------------------------------
// D3 self.fonts / FontFace in worker
// ---------------------------------------------------------------------------

interface FontReport {
  fontFaceConstructorPresent: boolean;
  selfFontsPresent: boolean;
  selfFontsAddPresent: boolean;
  addSucceeded: boolean;
  loadAttempted: boolean;
  loadResolved: boolean;
  loadError: string | null;
}

async function runFontProbe(): Promise<FontReport> {
  const r: FontReport = {
    fontFaceConstructorPresent: typeof (self as any).FontFace !== 'undefined',
    selfFontsPresent: typeof (self as any).fonts !== 'undefined' && (self as any).fonts !== null,
    selfFontsAddPresent: false,
    addSucceeded: false,
    loadAttempted: false,
    loadResolved: false,
    loadError: null,
  };
  try {
    r.selfFontsAddPresent = r.selfFontsPresent && typeof (self as any).fonts.add === 'function';
    if (r.fontFaceConstructorPresent) {
      // A woff2 whose bytes are a valid font would be needed to fully load; the
      // point of D3 is whether the API EXISTS + is callable in the worker, not
      // that this particular URL resolves. We attempt against a same-origin URL
      // and report whether load() rejects (API present, resource missing) vs the
      // constructor/add being absent entirely.
      const ff = new (self as any).FontFace('TestFont', 'url(/_spike/nonexistent.woff2)');
      if (r.selfFontsAddPresent) {
        (self as any).fonts.add(ff);
        r.addSucceeded = true;
      }
      r.loadAttempted = true;
      try {
        await ff.load();
        r.loadResolved = true;
      } catch (e) {
        r.loadError = e instanceof Error ? e.message : String(e);
      }
    }
  } catch (e) {
    r.loadError = (r.loadError ? r.loadError + ' | ' : '') + (e instanceof Error ? e.message : String(e));
  }
  return r;
}

// ---------------------------------------------------------------------------
// (g) VideoFrame transferred from main thread → uploadFrame to GL texture
// ---------------------------------------------------------------------------

interface TransferReport {
  received: boolean;
  isVideoFrame: boolean;
  codedWidth: number | null;
  codedHeight: number | null;
  uploadedToTexture: boolean;
  renderedAfterUpload: boolean;
  centerPixelNonBlack: boolean | null;
  centerPixel: number[] | null;
  error: string | null;
}

function runTransferTest(frame: any): TransferReport {
  const r: TransferReport = {
    received: true,
    isVideoFrame: typeof (self as any).VideoFrame !== 'undefined' && frame instanceof (self as any).VideoFrame,
    codedWidth: null,
    codedHeight: null,
    uploadedToTexture: false,
    renderedAfterUpload: false,
    centerPixelNonBlack: null,
    centerPixel: null,
    error: null,
  };
  try {
    r.codedWidth = frame.codedWidth ?? frame.displayWidth ?? null;
    r.codedHeight = frame.codedHeight ?? frame.displayHeight ?? null;
    if (!glState) throw new Error('no GL state — cannot upload transferred frame');
    const { gl, compositor } = glState;
    // Upload the transferred VideoFrame through the REAL compositor path.
    compositor.uploadFrame('a', frame as VideoFrame);
    r.uploadedToTexture = true;
    compositor.renderFrame({ transition: null, animScaleA: 1, animScaleB: 1, grade: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 } });
    gl.finish();
    r.renderedAfterUpload = true;
    const px = readCenterPixel(gl);
    r.centerPixel = px;
    r.centerPixelNonBlack = px[0] + px[1] + px[2] > 30;
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
    wlog('transfer test FAILED: ' + r.error);
  } finally {
    try { frame.close(); } catch { /* noop */ }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function runAll(): Promise<void> {
  const env = {
    userAgent: (self as any).navigator?.userAgent ?? '(no navigator in worker)',
    hasOffscreenCanvas: typeof (self as any).OffscreenCanvas !== 'undefined',
    hasVideoEncoder: typeof (self as any).VideoEncoder !== 'undefined',
    hasVideoFrame: typeof (self as any).VideoFrame !== 'undefined',
    hasVideoDecoder: typeof (self as any).VideoDecoder !== 'undefined',
  };
  wlog('worker env: ' + JSON.stringify(env));

  const gl = await setupGl();
  (self as any).postMessage({ type: 'partial', tag: 'gl', payload: gl });

  // (e) hardware, (f) software + no-preference — reuse the one GL canvas.
  const encoderHw = await runEncoderConfig('hw', 'prefer-hardware');
  (self as any).postMessage({ type: 'partial', tag: 'encoder-hw', payload: encoderHw });
  const encoderSw = await runEncoderConfig('sw', 'prefer-software');
  (self as any).postMessage({ type: 'partial', tag: 'encoder-sw', payload: encoderSw });
  const encoderNp = await runEncoderConfig('no-pref', 'no-preference');
  (self as any).postMessage({ type: 'partial', tag: 'encoder-nopref', payload: encoderNp });

  const drawImage = await runDrawImageTest();
  (self as any).postMessage({ type: 'partial', tag: 'drawImage', payload: drawImage });

  const fonts = await runFontProbe();
  (self as any).postMessage({ type: 'partial', tag: 'fonts', payload: fonts });

  (self as any).postMessage({
    type: 'selfTestsDone',
    payload: { env, gl, encoderHw, encoderSw, encoderNp, drawImage, fonts },
  });
}

self.onmessage = (ev: MessageEvent) => {
  const data = ev.data;
  if (data?.type === 'runAll') {
    void runAll();
  } else if (data?.type === 'transferFrame') {
    const report = runTransferTest(data.frame);
    (self as any).postMessage({ type: 'transferResult', payload: report });
  }
};

// Signal readiness (proves the module worker actually loaded + evaluated).
(self as any).postMessage({ type: 'workerReady' });
