/**
 * THROWAWAY WKWebView GATE SPIKE — main-thread half.
 *
 * Standalone. Not imported by any real app code. Purpose: this is Step 0 of
 * the WebCodecs+WebGL2-in-Worker export architecture — the ONE true blocker
 * the feasibility audit identified. The audit proved the full worker +
 * OffscreenCanvas + WebGL2 + real GlCompositor + VideoFrame + hardware
 * VideoEncoder chain end-to-end on Chromium/Electron (600/600 chunks, 87fps,
 * clean flush). That is a proxy for Windows/WebView2, NOT for macOS WKWebView.
 * On WKWebView the load-bearing pieces have only been proven separately and
 * MAIN-THREAD (Phase 6, mux-proof) — never together, never in a worker. This
 * harness answers that question directly on the real runtime.
 *
 * (a) new Worker(new URL('./worker.ts', import.meta.url), {type:'module'}) —
 *     module worker loads. worker.ts does everything else (b)-(f) + D2(a) +
 *     D3 internally and posts results back here.
 * (g) VideoFrame transfer across the worker boundary: THIS thread constructs
 *     a VideoFrame (from a 2D canvas — any 1920x1080 source), postMessages it
 *     to the worker in the transfer list, and the worker uploadFrame()s it to
 *     a GL texture via the real GlCompositor (mirrors the audit's B4 spike).
 *
 * Exfiltrates via HTTP POST to 127.0.0.1:8799 (same listener/pattern as
 * spike-webcodecs-audit.html, spike-webgl.html) AND to console + on-page log,
 * because the definitive run happens inside WKWebView with no interactive
 * devtools.
 *
 * TO RUN AGAINST THE REAL TAURI WKWEBVIEW: temporarily repoint
 * src-tauri/tauri.conf.json's `build.devUrl` at this page
 * (http://localhost:3000/spike-webcodecs-worker.html), same method documented
 * in src/dev/webcodecsAuditSpike/main.ts's header — launch `npm run
 * tauri:dev`, let the spike run, capture the exfil'd result, then revert
 * tauri.conf.json to zero git diff.
 *
 * Delete src/dev/webcodecsWorkerSpike/ + spike-webcodecs-worker.html +
 * this harness's tauri.conf.json repoint discipline notes when the gate is
 * decided (see the task's Step 7 finding).
 */

const EXFIL_URL = 'http://127.0.0.1:8799/result';
const W = 1920;
const H = 1080;

/* eslint-disable @typescript-eslint/no-explicit-any */

function log(msg: string): void {
  const el = document.getElementById('log');
  if (el) el.textContent += '\n' + msg;
  // eslint-disable-next-line no-console
  console.log('[MAIN-SPIKE] ' + msg);
}

async function exfil(tag: string, payload: unknown): Promise<void> {
  const body = JSON.stringify({ tag, payload, ts: Date.now() });
  try {
    await fetch(EXFIL_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, mode: 'cors', keepalive: true });
  } catch (e) {
    log('exfil POST failed (listener may be down): ' + (e instanceof Error ? e.message : String(e)));
  }
}

/** Builds a real 1920x1080 VideoFrame on the MAIN thread (any source is fine
 *  for the transfer test — a 2D canvas), for postMessage-with-transfer to the
 *  worker. Mirrors the audit's B4 spike. */
function makeMainThreadVideoFrame(): VideoFrame {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2a6df5';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = '160px sans-serif';
  ctx.fillText('MAIN->WORKER', 80, 540);
  return new VideoFrame(c, { timestamp: 0, duration: 33333 });
}

async function main(): Promise<void> {
  const el = document.getElementById('log');
  if (el) el.textContent = '';
  log('WKWebView worker-gate spike starting — UA: ' + navigator.userAgent);

  const envTop = {
    userAgent: navigator.userAgent,
    hasWorker: typeof Worker !== 'undefined',
    hasWebCodecsTop: typeof (globalThis as any).VideoEncoder !== 'undefined',
  };
  log('top-level env: ' + JSON.stringify(envTop));
  await exfil('top-env', envTop);

  // (a) module worker load — this line either throws/never-loads or succeeds.
  let worker: Worker;
  let workerLoadedOk = false;
  const workerLoadTimeout = new Promise<void>((res) => setTimeout(res, 10_000));
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log('MODULE WORKER CONSTRUCTION THREW: ' + err);
    await exfil('DONE', { envTop, verdict: { moduleWorkerLoads: false, reason: 'constructor threw: ' + err } });
    return;
  }

  const workerResults: Record<string, unknown> = {};
  let selfTestsDone: any = null;
  let transferResult: any = null;
  const readyPromise = new Promise<void>((resolveReady) => {
    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (data?.type === 'workerReady') {
        workerLoadedOk = true;
        log('worker: READY (module worker loaded and evaluated OK)');
        resolveReady();
      } else if (data?.type === 'log') {
        log('[worker] ' + data.msg);
      } else if (data?.type === 'partial') {
        workerResults[data.tag] = data.payload;
        log('worker partial [' + data.tag + ']: ' + JSON.stringify(data.payload).slice(0, 500));
        void exfil('worker-' + data.tag, data.payload);
      } else if (data?.type === 'selfTestsDone') {
        selfTestsDone = data.payload;
      } else if (data?.type === 'transferResult') {
        transferResult = data.payload;
        log('worker transferResult: ' + JSON.stringify(data.payload));
      }
    };
    worker.onerror = (ev: ErrorEvent) => {
      log('WORKER ONERROR: ' + ev.message + ' at ' + ev.filename + ':' + ev.lineno);
      void exfil('worker-onerror', { message: ev.message, filename: ev.filename, lineno: ev.lineno });
      resolveReady(); // don't hang the harness on a worker crash
    };
  });

  await Promise.race([readyPromise, workerLoadTimeout]);
  await exfil('module-worker-load', { workerLoadedOk });
  if (!workerLoadedOk) {
    log('MODULE WORKER NEVER SIGNALED READY within 10s — treating as load failure.');
    await exfil('DONE', { envTop, verdict: { moduleWorkerLoads: false, reason: 'no workerReady message within 10s' } });
    return;
  }

  // Kick off (b)-(f) + D2(a) + D3 inside the worker.
  worker.postMessage({ type: 'runAll' });

  // Wait for the worker's self-contained test suite to finish (bounded wait —
  // the worker's own flush() calls already carry their own timeouts).
  const selfTestsTimeout = new Promise<void>((res) => setTimeout(res, 120_000));
  await Promise.race([
    new Promise<void>((res) => {
      const check = setInterval(() => {
        if (selfTestsDone) { clearInterval(check); res(); }
      }, 250);
    }),
    selfTestsTimeout,
  ]);

  if (!selfTestsDone) {
    log('⚠️ worker self-tests did NOT complete within 120s — proceeding with partials only.');
  }

  // (g) VideoFrame transfer across the worker boundary.
  log('running (g) VideoFrame transfer test — constructing on main thread, transferring to worker...');
  let transferOk = false;
  try {
    const frame = makeMainThreadVideoFrame();
    worker.postMessage({ type: 'transferFrame', frame }, [frame as unknown as Transferable]);
    transferOk = true;
  } catch (e) {
    log('(g) postMessage transfer THREW: ' + (e instanceof Error ? e.message : String(e)));
    await exfil('transfer-postmessage-error', { error: e instanceof Error ? e.message : String(e) });
  }

  if (transferOk) {
    const transferTimeout = new Promise<void>((res) => setTimeout(res, 15_000));
    await Promise.race([
      new Promise<void>((res) => {
        const check = setInterval(() => {
          if (transferResult) { clearInterval(check); res(); }
        }, 200);
      }),
      transferTimeout,
    ]);
  }
  await exfil('transfer-result', { transferOk, transferResult });

  // ---------------------------------------------------------------------
  // Verdict assembly
  // ---------------------------------------------------------------------
  const gl = (selfTestsDone?.gl ?? workerResults['gl']) as any;
  const encHw = (selfTestsDone?.encoderHw ?? workerResults['encoder-hw']) as any;
  const encSw = (selfTestsDone?.encoderSw ?? workerResults['encoder-sw']) as any;
  const encNp = (selfTestsDone?.encoderNp ?? workerResults['encoder-nopref']) as any;
  const drawImage = (selfTestsDone?.drawImage ?? workerResults['drawImage']) as any;
  const fonts = (selfTestsDone?.fonts ?? workerResults['fonts']) as any;

  const anyEncoderWorks = [encHw, encSw, encNp].some((e) => e && e.flushResolved && e.chunksEmitted >= 600 && !e.errorCbFired);

  const verdict = {
    moduleWorkerLoads: workerLoadedOk,
    offscreenCanvasWebgl2InWorker: gl?.webgl2ContextNonNull === true,
    glCompositorConstructsInWorker: gl?.compositorConstructed === true,
    glCompositorRendersInWorker: gl?.renderedFrame === true && gl?.centerPixelNonBlack === true,
    videoFrameFromWorkerGlCanvas: !!(encHw?.videoFrameFromGlCanvas || encSw?.videoFrameFromGlCanvas || encNp?.videoFrameFromGlCanvas),
    encoderHardware: encHw ? { chunks: encHw.chunksEmitted, flushResolved: encHw.flushResolved, flushTimedOut: encHw.flushTimedOut, errors: encHw.errorCbFired, error: encHw.error } : null,
    encoderSoftware: encSw ? { chunks: encSw.chunksEmitted, flushResolved: encSw.flushResolved, flushTimedOut: encSw.flushTimedOut, errors: encSw.errorCbFired, error: encSw.error } : null,
    encoderNoPreference: encNp ? { chunks: encNp.chunksEmitted, flushResolved: encNp.flushResolved, flushTimedOut: encNp.flushTimedOut, errors: encNp.errorCbFired, error: encNp.error } : null,
    anyEncoderConfigWorks: anyEncoderWorks,
    videoFrameTransferAcrossBoundary: transferResult?.uploadedToTexture === true && transferResult?.centerPixelNonBlack === true,
    drawImageMedianMs: drawImage?.medianMs ?? null,
    drawImageP95Ms: drawImage?.p95Ms ?? null,
    fontFaceInWorker: fonts?.fontFaceConstructorPresent === true && fonts?.selfFontsPresent === true,
    glError: gl?.error ?? null,
  };

  const overallPass =
    verdict.moduleWorkerLoads &&
    verdict.offscreenCanvasWebgl2InWorker &&
    verdict.glCompositorConstructsInWorker &&
    verdict.glCompositorRendersInWorker &&
    verdict.videoFrameFromWorkerGlCanvas &&
    verdict.anyEncoderConfigWorks &&
    verdict.videoFrameTransferAcrossBoundary &&
    (verdict.drawImageMedianMs ?? 999) < 5 &&
    !verdict.glError;

  const summary = {
    envTop,
    gl,
    encoderHw: encHw,
    encoderSw: encSw,
    encoderNoPreference: encNp,
    drawImage,
    fonts,
    transfer: transferResult,
    verdict,
    overallPass,
  };
  (window as any).__workerSpikeResult = summary;
  log('=== VERDICT: ' + JSON.stringify(verdict, null, 2));
  log('=== OVERALL: ' + (overallPass ? 'PASS' : 'PARTIAL/FAIL — see verdict fields above') + ' ===');
  log('=== SPIKE COMPLETE — full result at window.__workerSpikeResult and exfil listener ===');
  await exfil('DONE', summary);
}

document.getElementById('rerun')?.addEventListener('click', () => void main());
void main();
