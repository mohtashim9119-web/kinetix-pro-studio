/**
 * THROWAWAY Step 3/4 verification spike — main-thread half.
 *
 * Upgraded from the Step 2 skeleton spike (which pixel-compared transferred
 * VideoFrames against legacy frameRenderer.ts — that compositing-parity
 * question is already answered and NOT re-verified here). This step proves
 * docs/webcodecs-export-plan.md Step 3 (exportWorker.ts's real VideoEncoder +
 * annexb streaming) actually works end-to-end:
 *
 * STEP 4 ADDITION (see `verifyMuxOnlyStep4` below): exercises the real
 * `exportPipelineWebCodecs.ts`/`muxOnly.ts` mux step against a synthetic WAV
 * tone (no dependency on project state or a fetched audio fixture) — proving
 * the exact command `muxOnly` builds produces a real, correctly-timed,
 * playable MP4 with A/V both present, plus the no-audio case. This is what
 * actually caught a real bug: the plan's original `-framerate <fps>` INPUT
 * flag (§7.2) turned out insufficient for a VideoToolbox-hardware-encoded
 * annexb stream — this run's first pass produced a 1.67s file instead of
 * 10s. `muxOnly.ts` now uses `-r <fps>` instead (see its own header for the
 * full repro). Runs inside the same `isTauri()` gate as the Step 3
 * disk-append verification, for the same reason (`appendFileRaw`/
 * `ffmpeg.exec` IPC only exists in the real Tauri WebView).
 *
 *   1. The worker encodes a real segment run to completion and streams
 *      EncodedVideoChunk bytes out as 'chunk' messages (not raw VideoFrames).
 *   2. The concatenated chunk stream is a REAL, DECODABLE annexb H.264
 *      bitstream — verified by feeding it back through a VideoDecoder
 *      configured with avc:{format:'annexb'} (the same check ffprobe would
 *      perform, done via WebCodecs directly since this spike's runtime is
 *      the in-app Browser pane's Chromium proxy, which has no bundled
 *      ffprobe binary reachable from a plain web page — see the runtime
 *      note below for why the disk-append/ffmpeg-probe half of Step 3's
 *      spec only runs when this page is loaded inside the real Tauri app).
 *   3. Frame count and timestamp formula are checked against the expected
 *      Math.round(N*1e6/fps) values (plan §7.1).
 *   4. Backpressure is checked by charting the worker's own
 *      encodeQueueSize samples ('queue-sample' messages).
 *   5. Cancel mid-stream is checked: send 'cancel' after a few chunks,
 *      confirm the worker replies exactly 'cancelled' and stops emitting.
 *
 * RUNTIME NOTE: `ffmpeg_append_file_raw` / `TauriFfmpeg` IPC only exists
 * inside the real Tauri WebView (`window.__TAURI_INTERNALS__`) — a plain
 * Chromium tab hitting the Vite dev server (this spike's normal runtime,
 * same as Step 0/2) has no such bridge. This file still implements the real
 * disk-append + ffmpeg-probe path exactly as Step 3 specifies (guarded by
 * `isTauri()`) so it exercises appendFileRaw for real when run inside
 * `npm run tauri:dev`; when it isn't, that half logs why it was skipped
 * rather than silently pretending to have run it, and the decode round-trip
 * above still gives a real, non-fabricated verification of the encoder's
 * output.
 *
 * Reuses the real public sample video (public/_spike/sample.mp4 — 10.4s,
 * H.264, 1280x720, ~29.97fps) already used by earlier spikes/fixtures in
 * this directory.
 *
 * Not imported by any real app file. Delete alongside
 * spike-webcodecs-step2.html once Step 3 is reviewed.
 *
 * WKWEBVIEW VERIFICATION PASS: this file also exfiltrates its result via
 * HTTP POST to a local listener (EXFIL_URL), mirroring
 * src/dev/webcodecsAuditSpike/main.ts's established pattern — when this page
 * is loaded inside the real Tauri WKWebView via a temporary devUrl repoint,
 * there is no interactive devtools to read window.__step3SpikeResult from,
 * so exfil is the only way to get results out.
 */

import { createFile as createMp4BoxFile, MP4BoxBuffer } from 'mp4box';
import { TransitionType, AnimationType, type VideoSegment, type Asset, type Project, type TextOverlay, type HeadingOverlay } from '../../types';
import type { ProjectEffectConfig } from '../../services/gl/compositeParams';
import { deriveCompositeParams, deriveSlotPlan } from '../../services/gl/compositeParams';
import { GlCompositor } from '../../services/gl/glCompositor';
import { computeObjectCoverUvRect } from '../../services/gl/uvRect';
import { acquireGlContext } from '../../services/gl/glContext';
import type { ExportWorkerInitMessage, ExportWorkerOutboundMessage } from '../../services/webcodecsExport/exportWorker';
import { isTauri, TauriFfmpeg } from '../../services/tauriFfmpeg';
import { muxOnly } from '../../services/webcodecsExport/muxOnly';
import { getOrCreateDemux } from '../../services/videoDemuxer';
import { exportProject } from '../../services/exportPipeline';
import {
  exportProjectWebCodecs,
  countAnnexbFrames,
} from '../../services/webcodecsExport/exportPipelineWebCodecs';
import { useEffect, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  useExport,
  isWebCodecsExportCapable,
  isWebCodecsExportGateOpen,
  setWebCodecsExportToggle,
  __resetWebCodecsExportCapabilityForTests,
  type UseExportApi,
  type UseExportState,
  type ExportResolution,
  type ExportFps,
} from '../../hooks/useExport';
import { exportProjectWebCodecsSoftwareSpike } from './exportPipelineWebCodecsSoftwareSpike';
import { exportProjectWebCodecsInstrumented } from './exportPipelineWebCodecsInstrumentedSpike';

const SAMPLE_URL = '/_spike/sample.mp4';
const WIDTH = 640;
const HEIGHT = 480; // 4:3 destination vs the source's 16:9 — real cover-fit crop, same as Step 2.
const FPS = 30;
const SEGMENT_DURATION = 10; // seconds — sample.mp4 is ~10.4s, so this stays inside the source.
const EXPORT_CODEC = 'avc1.640028'; // must match exportWorker.ts's own EXPORT_CODEC for the decode round-trip to be meaningful.
const CANCEL_AFTER_CHUNKS = 5; // for the cancel test — well before the ~300-frame run finishes.
const EXFIL_URL = 'http://127.0.0.1:8799/result';

// Step 4 — synthetic audio for the muxOnly verification. A real, ffmpeg-
// muxable audio file with no dependency on project state or a fetched
// fixture. 10s matches SEGMENT_DURATION exactly so -shortest (plan §7.2) has
// no slack to hide a timing bug in either track.
const SYNTH_AUDIO_DURATION_SEC = SEGMENT_DURATION;
const SYNTH_AUDIO_FREQ_HZ = 440;
const SYNTH_AUDIO_SAMPLE_RATE = 44100;

/** WebKit's `Error.stack` is FRAMES ONLY (unlike V8, which prepends
 *  "Name: message") — a bare `e.stack ?? e.message` on WKWebView can silently
 *  drop the actual diagnostic message and keep only an unhelpful call-frame
 *  location. Always concatenate both so a real WKWebView run's exfiltrated
 *  error text is actually diagnosable (found while debugging this exact spike
 *  on real WKWebView — a `VideoDecoder` error surfaced as just
 *  "error@sequentialDecode.ts:142:26" with the message text silently lost). */
function fullErrorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  return e.stack ? `${e.message}\n${e.stack}` : e.message;
}

/** Generic bounded-time wrapper — rejects with a clear message rather than
 *  letting a genuine stall (as opposed to a thrown error, which the
 *  try/catches elsewhere already handle) hang the whole multi-minute Step 5
 *  run with nothing ever exfiltrated. Wraps `runStep5MixedAbCompare`/
 *  `runConcatGuardNegativeTest` below — the prior WebCodecs-re-decode-based
 *  frame extraction this guarded against stalling has since been replaced
 *  with ffmpeg-based extraction (see that section's own header), but the
 *  guard is left in place as cheap insurance for any other future stall. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`withTimeout: "${label}" timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function log(msg: string): void {
  const el = document.getElementById('log');
  if (el) el.textContent += '\n' + msg;
  // eslint-disable-next-line no-console
  console.log('[STEP3-SPIKE] ' + msg);
}

/** Same pattern as webcodecsAuditSpike/main.ts's exfil(): fire-and-forget
 *  POST to a local listener, since WKWebView has no automatable devtools to
 *  read window state from directly. text/plain body => a CORS "simple
 *  request" — no preflight, so the POST reaches the listener even though the
 *  local listener's response can't necessarily be read back here. */
async function exfil(tag: string, payload: unknown): Promise<void> {
  const body = JSON.stringify({ tag, payload, ts: Date.now() });
  try {
    await fetch(EXFIL_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, mode: 'cors', keepalive: true });
  } catch (e) {
    log('exfil POST failed (listener may be down, or this runtime is not the real Tauri app): ' + (e instanceof Error ? e.message : String(e)));
  }
}

function drawToVisibleCanvas(id: string, imageData: ImageData): void {
  const canvas = document.getElementById(id) as HTMLCanvasElement | null;
  if (!canvas) return;
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  ctx?.putImageData(imageData, 0, 0);
}

function meanLuma(data: Uint8ClampedArray): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

// ---------------------------------------------------------------------------
// Worker driver
// ---------------------------------------------------------------------------

interface ChunkRecord {
  bytes: ArrayBuffer;
  chunkType: EncodedVideoChunkType;
  timestamp: number;
}

interface WorkerRunResult {
  chunks: ChunkRecord[];
  queueSamples: { frameIndex: number; size: number }[];
  runDone: { runId: string; frameCount: number } | null;
  done: { frameCount: number } | null;
  cancelled: boolean;
}

/** Drives one exportWorker.ts run to completion (or to a deliberate mid-
 *  stream cancel when `cancelAfterChunks` is set), terminating the worker
 *  afterward. */
function runWorkerOnce(init: ExportWorkerInitMessage, opts: { cancelAfterChunks?: number } = {}): Promise<WorkerRunResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let cancelSent = false;
    const worker = new Worker(new URL('../../services/webcodecsExport/exportWorker.ts', import.meta.url), { type: 'module' });
    const chunks: ChunkRecord[] = [];
    const queueSamples: { frameIndex: number; size: number }[] = [];
    let runDone: WorkerRunResult['runDone'] = null;

    worker.onmessage = (ev: MessageEvent<ExportWorkerOutboundMessage>) => {
      const data = ev.data;
      if (data.type === 'chunk') {
        chunks.push({ bytes: data.bytes, chunkType: data.chunkType, timestamp: data.timestamp });
        if (opts.cancelAfterChunks !== undefined && !cancelSent && chunks.length >= opts.cancelAfterChunks) {
          cancelSent = true;
          worker.postMessage({ type: 'cancel' });
        }
      } else if (data.type === 'queue-sample') {
        queueSamples.push({ frameIndex: data.frameIndex, size: data.size });
      } else if (data.type === 'run-done') {
        runDone = { runId: data.runId, frameCount: data.frameCount };
      } else if (data.type === 'done') {
        if (settled) return;
        settled = true;
        worker.terminate();
        resolve({ chunks, queueSamples, runDone, done: { frameCount: data.frameCount }, cancelled: false });
      } else if (data.type === 'error') {
        if (settled) return;
        settled = true;
        worker.terminate();
        reject(new Error('exportWorker posted error: ' + data.message));
      } else if (data.type === 'cancelled') {
        if (settled) return;
        settled = true;
        worker.terminate();
        resolve({ chunks, queueSamples, runDone, done: null, cancelled: true });
      }
    };
    worker.onerror = (ev: ErrorEvent) => {
      if (settled) return;
      settled = true;
      reject(new Error(`worker onerror: ${ev.message} at ${ev.filename}:${ev.lineno}`));
    };

    worker.postMessage(init);
  });
}

// ---------------------------------------------------------------------------
// Annexb decode round-trip verification — the ffprobe-equivalent check this
// spike can actually run from a plain web page (no bundled ffprobe binary is
// reachable outside the real Tauri app; see the file header runtime note).
// Feeds the chunks back through a real VideoDecoder configured for annexb,
// proving the stream is genuinely valid + decodable + frame-count-correct,
// not just "looked right by inspection".
// ---------------------------------------------------------------------------

interface DecodeVerifyResult {
  decodedFrameCount: number;
  decodeErrors: string[];
  firstFrameImageData: ImageData | null;
  firstFrameLuma: number | null;
  totalBytes: number;
}

async function verifyAnnexbDecodable(chunks: ChunkRecord[], width: number, height: number): Promise<DecodeVerifyResult> {
  return new Promise((resolve, reject) => {
    let decodedFrameCount = 0;
    const decodeErrors: string[] = [];
    let firstFrameImageData: ImageData | null = null;
    let firstFrameLuma: number | null = null;

    const decoder = new VideoDecoder({
      output: (frame) => {
        decodedFrameCount++;
        if (decodedFrameCount === 1) {
          const canvas = new OffscreenCanvas(width, height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(frame, 0, 0, width, height);
          firstFrameImageData = ctx.getImageData(0, 0, width, height);
          firstFrameLuma = meanLuma(firstFrameImageData.data);
        }
        frame.close();
      },
      error: (e) => {
        decodeErrors.push(e.message);
      },
    });

    try {
      // No `description` field: per the WebCodecs H.264 codec registration,
      // an absent `description` tells the decoder to expect Annex B (start-
      // code-prefixed, in-band SPS/PPS) rather than AVCC — there is no
      // decoder-side `avc.format` option (that only exists on the encoder
      // config; VideoDecoderConfig has no `avc` member at all, which is what
      // the initial version of this file got wrong and tsc caught).
      decoder.configure({ codec: EXPORT_CODEC, codedWidth: width, codedHeight: height });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    for (const c of chunks) {
      try {
        const chunk = new EncodedVideoChunk({ type: c.chunkType, timestamp: c.timestamp, data: c.bytes });
        decoder.decode(chunk);
      } catch (e) {
        decodeErrors.push(`decode() threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    decoder
      .flush()
      .then(() => {
        const totalBytes = chunks.reduce((sum, c) => sum + c.bytes.byteLength, 0);
        resolve({ decodedFrameCount, decodeErrors, firstFrameImageData, firstFrameLuma, totalBytes });
      })
      .catch((e: unknown) => reject(e instanceof Error ? e : new Error(String(e))))
      .finally(() => {
        try {
          if (decoder.state !== 'closed') decoder.close();
        } catch {
          // best-effort
        }
      });
  });
}

// ---------------------------------------------------------------------------
// Real disk-append + ffmpeg-probe path — only runs inside the actual Tauri
// app (isTauri() gate). Exercises appendFileRaw (Part C) and the Rust
// ffmpeg_append_file_raw command (Part A) for real, then probes the written
// file with the bundled ffmpeg sidecar the same way probe_audio_duration/
// probe_video_fps already do (the app ships no separate ffprobe binary —
// `ffmpeg -i <file>` deliberately exits non-zero and prints stream info to
// stderr, which ffmpeg_exec returns as the error text on non-zero exit; we
// parse that same text here rather than adding a new Rust command beyond
// this step's explicit A/B scope).
// ---------------------------------------------------------------------------

interface DiskVerifyResult {
  chunksAppended: number;
  expectedBytes: number;
  diskFileBytes: number | null;
  sizeMatches: boolean;
  byteIdentical: boolean | null;
  probeText: string;
  looksLikeH264: boolean;
  probeDuration: string | null;
  nullDecodeExitCode: number | null;
  nullDecodeError: string | null;
}

async function verifyViaTauriDiskAppend(chunks: ChunkRecord[]): Promise<DiskVerifyResult> {
  log('--- Tauri disk-append + ffmpeg-probe verification (real appendFileRaw IPC) ---');
  const ffmpeg = await TauriFfmpeg.create();
  const fileName = 'run_0.h264';
  const expectedBytes = chunks.reduce((sum, c) => sum + c.bytes.byteLength, 0);
  const result: DiskVerifyResult = {
    chunksAppended: 0,
    expectedBytes,
    diskFileBytes: null,
    sizeMatches: false,
    byteIdentical: null,
    probeText: '',
    looksLikeH264: false,
    probeDuration: null,
    nullDecodeExitCode: null,
    nullDecodeError: null,
  };
  try {
    log(`Appending ${chunks.length} chunks to session:${fileName} via appendFileRaw (serialized, in chunk order)...`);
    for (const c of chunks) {
      // Serialized: each appendFileRaw is awaited before the next is issued,
      // so append order matches chunk (== encode) order (plan §4.4).
      // eslint-disable-next-line no-await-in-loop
      await ffmpeg.appendFileRaw(fileName, new Uint8Array(c.bytes));
      result.chunksAppended++;
    }
    log('All chunks appended.');

    // Disk-write check: read the file back and compare against the
    // in-memory chunk bytes — proves the file exists, is the right size,
    // AND is byte-for-byte what the encoder produced (stronger than a size
    // check alone).
    const diskBytesRaw = await ffmpeg.readFile(fileName);
    const diskBytes = typeof diskBytesRaw === 'string' ? new TextEncoder().encode(diskBytesRaw) : diskBytesRaw;
    result.diskFileBytes = diskBytes.byteLength;
    result.sizeMatches = diskBytes.byteLength === expectedBytes;
    log(`Disk file size: ${diskBytes.byteLength} bytes (expected ${expectedBytes}) — sizeMatches=${result.sizeMatches}`);
    if (result.sizeMatches) {
      let identical = true;
      let offset = 0;
      for (const c of chunks) {
        const view = new Uint8Array(c.bytes);
        for (let i = 0; i < view.length; i++) {
          if (diskBytes[offset + i] !== view[i]) {
            identical = false;
            break;
          }
        }
        if (!identical) break;
        offset += view.length;
      }
      result.byteIdentical = identical;
      log(`Disk bytes byte-identical to in-memory encoded chunks: ${identical}`);
    }

    let probeOutput: string | null = null;
    let probeThrew: string | null = null;
    try {
      // `-i` with no output deliberately exits non-zero; ffmpeg_exec returns
      // that as a thrown Error whose message is the stderr tail (same trick
      // ffmpeg_probe_duration_secs/ffmpeg_probe_fps use server-side).
      await ffmpeg.exec(['-hide_banner', '-i', fileName]);
      probeOutput = '(ffmpeg -i exited 0 — unexpected for an input-only invocation, but not itself a failure)';
    } catch (e) {
      probeThrew = e instanceof Error ? e.message : String(e);
    }
    const probeText = probeThrew ?? probeOutput ?? '(no output)';
    result.probeText = probeText;
    log('ffmpeg -i probe output/error text:\n' + probeText);
    result.looksLikeH264 = /h264|avc/i.test(probeText);
    const durationMatch = probeText.match(/Duration:\s*([\d:.]+)/);
    result.probeDuration = durationMatch ? durationMatch[1]! : null;
    log(`Probe recognizes h264/avc stream info: ${result.looksLikeH264}`);
    log(`Probe Duration line: ${result.probeDuration ?? '(not found)'}`);

    // Real decode via `-f null -` (exits 0 on success): confirms the
    // ON-DISK file (not just the in-memory chunks) decodes cleanly end to
    // end through the bundled ffmpeg binary. ffmpeg_exec only returns
    // stderr text on a NON-ZERO exit (see ffmpeg.rs), so on success we only
    // get the exit code back — the exact frame count instead comes from the
    // WebCodecs decode round-trip above, which already proved 300/300 on
    // the identical in-memory bytes this file was written from, now backed
    // by the byte-identity check just above tying that proof to the actual
    // on-disk file.
    try {
      const code = await ffmpeg.exec(['-hide_banner', '-i', fileName, '-f', 'null', '-']);
      result.nullDecodeExitCode = code;
      log(`ffmpeg -i run_0.h264 -f null - exited ${code} (0 = decoded cleanly through the bundled ffmpeg binary)`);
    } catch (e) {
      result.nullDecodeError = e instanceof Error ? e.message : String(e);
      log(`ffmpeg null-decode FAILED: ${result.nullDecodeError}`);
    }
  } finally {
    await ffmpeg.destroy();
    log('Session destroyed (session dir removed).');
  }
  return result;
}

interface CancelOrphanResult {
  skipped: boolean;
  preCancelChunksWritten: number;
  firstDestroyOk: boolean;
  secondDestroyOk: boolean;
  readAfterDestroyThrew: boolean;
}

/** Cancel-mid-stream orphan check: start a fresh run, cancel it after a few
 *  chunks, append whatever chunks arrived before the cancel, destroy the
 *  session, and confirm cleanup. Beyond "destroy() didn't throw", this also
 *  attempts a readFile() on the just-destroyed session — if the session dir
 *  is genuinely gone, that read MUST throw (the directory no longer exists
 *  on disk), which is a real functional check rather than only trusting the
 *  IPC call's own success return. The host-filesystem-level confirmation
 *  (no `kinetix-export-*` directory left under $TMPDIR) is done from outside
 *  the app by whoever drives this spike — see this step's report. */
async function verifyCancelLeavesNoOrphan(cancelResult: WorkerRunResult): Promise<CancelOrphanResult> {
  log('--- Cancel-mid-stream Tauri session cleanup check ---');
  const result: CancelOrphanResult = {
    skipped: false,
    preCancelChunksWritten: 0,
    firstDestroyOk: false,
    secondDestroyOk: false,
    readAfterDestroyThrew: false,
  };
  if (!cancelResult.cancelled) {
    log('SKIPPED — the cancel-test run did not actually report cancelled=true, see cancel test above.');
    result.skipped = true;
    return result;
  }
  const ffmpeg = await TauriFfmpeg.create();
  const fileName = 'run_cancel_test.h264';
  try {
    for (const c of cancelResult.chunks) {
      // eslint-disable-next-line no-await-in-loop
      await ffmpeg.appendFileRaw(fileName, new Uint8Array(c.bytes));
      result.preCancelChunksWritten++;
    }
    log(`Wrote ${cancelResult.chunks.length} pre-cancel chunk(s) to ${fileName}, then destroying session...`);
  } finally {
    await ffmpeg.destroy();
    result.firstDestroyOk = true;
  }
  // A second destroy on the same (already-destroyed) session must be a safe
  // no-op per ffmpeg_destroy_session's own doc comment — proves the first
  // destroy actually completed rather than silently failing.
  await ffmpeg.destroy();
  result.secondDestroyOk = true;
  // NOTE: this only proves the CLIENT-SIDE TauriFfmpeg instance considers
  // itself destroyed (readFile's #assertAlive() guard throws before any IPC
  // is even sent) — it is not by itself proof the session directory is gone
  // from disk. The authoritative check for that is a host-filesystem
  // `ls $TMPDIR/kinetix-export-*` before/after, done from outside the app by
  // whoever drives this spike (see this step's report) — reported alongside
  // this in-app signal, not in place of it.
  try {
    await ffmpeg.readFile(fileName);
  } catch {
    result.readAfterDestroyThrew = true;
  }
  log(
    `Session destroy (and a redundant second destroy) both completed without error; ` +
      `post-destroy readFile threw=${result.readAfterDestroyThrew} (client-side guard only — see report for the host-filesystem check).`,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Step 4 — synthetic WAV audio + real muxOnly() verification.
//
// Reuses the SAME encoded chunks run1 already produced (re-appended into a
// fresh session — TauriFfmpeg sessions are isolated directories, and the
// Step 3 disk-append verification above already destroyed its own session
// by the time this runs). Exercises the real exportPipelineWebCodecs.ts
// building block (muxOnly.ts) against real IPC, not a re-implementation.
// ---------------------------------------------------------------------------

/** Renders a mono sine wave via OfflineAudioContext and encodes it as a
 *  16-bit PCM WAV file — a real, ffmpeg-muxable audio asset with no
 *  dependency on project state or a fetched fixture. */
async function synthesizeWavTone(durationSec: number, freqHz: number, sampleRate: number): Promise<Uint8Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(durationSec * sampleRate), sampleRate);
  const osc = ctx.createOscillator();
  osc.frequency.value = freqHz;
  osc.type = 'sine';
  osc.connect(ctx.destination);
  osc.start(0);
  osc.stop(durationSec);
  const rendered = await ctx.startRendering();
  const samples = rendered.getChannelData(0);

  const numSamples = samples.length;
  const byteRate = sampleRate * 2; // mono, 16-bit
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeAscii(offset: number, s: string): void {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  }

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM format tag
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

interface Mp4TrackProbe {
  audioPresent: boolean;
  audioCodec: string | null;
  audioDurationSec: number | null;
}

/** Metadata-only probe (no sample extraction) for the audio track — mp4box's
 *  onReady Movie info already carries nb_samples/duration/timescale/codec
 *  per track, so this doesn't need the full onSamples extraction dance
 *  videoDemuxer.ts's demux() does for the video track. Kept local to this
 *  spike rather than added to videoDemuxer.ts (out of this step's scope,
 *  and that module is intentionally video-only — see its own header). */
function probeMp4AudioTrack(bytes: Uint8Array): Promise<Mp4TrackProbe> {
  return new Promise((resolve, reject) => {
    const mp4boxFile = createMp4BoxFile();
    mp4boxFile.onError = (module: string, msg: string) => reject(new Error(`mp4box error [${module}]: ${msg}`));
    mp4boxFile.onReady = (info) => {
      const a = info.audioTracks[0];
      resolve({
        audioPresent: !!a,
        audioCodec: a?.codec ?? null,
        audioDurationSec: a ? a.duration / a.timescale : null,
      });
    };
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    mp4boxFile.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, 0));
  });
}

interface Mp4DecodeCheck {
  decodedFrameCount: number;
  decodeErrors: string[];
  lastFrameLuma: number | null;
}

/** Decodes every demuxed video sample of a REAL (AVCC, container-extracted —
 *  not annexb) track through a VideoDecoder configured with the track's own
 *  description, exactly like any real playback client would. Distinct from
 *  `verifyAnnexbDecodable` above (which round-trips the pre-mux raw annexb
 *  stream) — this proves the FINAL MUXED FILE decodes end to end, and gives
 *  a real (non-black) frame for the visual-sanity check. */
async function decodeMp4TrackAndCheck(config: VideoDecoderConfig, chunks: EncodedVideoChunk[]): Promise<Mp4DecodeCheck> {
  return new Promise((resolve, reject) => {
    let decodedFrameCount = 0;
    const decodeErrors: string[] = [];
    let lastFrameLuma: number | null = null;
    const decoder = new VideoDecoder({
      output: (frame) => {
        decodedFrameCount++;
        const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(frame, 0, 0);
        lastFrameLuma = meanLuma(ctx.getImageData(0, 0, frame.displayWidth, frame.displayHeight).data);
        frame.close();
      },
      error: (e) => decodeErrors.push(e.message),
    });
    try {
      decoder.configure(config);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    for (const c of chunks) {
      try {
        decoder.decode(c);
      } catch (e) {
        decodeErrors.push(`decode() threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    decoder
      .flush()
      .then(() => resolve({ decodedFrameCount, decodeErrors, lastFrameLuma }))
      .catch((e: unknown) => reject(e instanceof Error ? e : new Error(String(e))))
      .finally(() => {
        try {
          if (decoder.state !== 'closed') decoder.close();
        } catch {
          // best-effort
        }
      });
  });
}

interface MuxCaseResult {
  outputFile: string;
  onDiskBytes: number;
  videoFrameCount: number;
  videoFrameCountDecoded: number;
  expectedFrameCount: number;
  frameCountMatches: boolean;
  videoDurationSec: number;
  expectedDurationSec: number;
  durationOk: boolean;
  audioPresent: boolean;
  audioCodec: string | null;
  audioDurationSec: number | null;
  decodeErrors: string[];
  lastFrameLuma: number | null;
  nonBlack: boolean;
}

interface MuxVerifyResult {
  ranAtAll: boolean;
  withAudio: MuxCaseResult | null;
  noAudio: MuxCaseResult | null;
  error: string | null;
}

/** Runs one mux case (with or without audio) through the REAL `muxOnly()`
 *  (Step 4 Part B) and verifies the output via real demux/decode — no
 *  ffprobe binary is bundled, so "playable" here means "a real VideoDecoder
 *  fed the container-extracted samples produces real, correct, non-black
 *  frames," which is a strictly stronger claim than a header/magic-bytes
 *  check. `expectDurationOk`/`expectedFrameCount` given by the caller (the
 *  no-audio case has no `-shortest` audio track to be limited by, but video
 *  length is unaffected either way — see the plan's own §7.2 note that video
 *  PTS are exact by construction). */
async function runMuxCase(
  ffmpeg: TauriFfmpeg,
  videoFile: string,
  audioFile: string | null,
  outputFile: string,
  fps: number,
  expectedFrameCount: number,
  expectedDurationSec: number,
): Promise<MuxCaseResult> {
  await muxOnly(ffmpeg, 'step4-spike-session', videoFile, audioFile, outputFile, fps);
  const rawBytes = await ffmpeg.readFile(outputFile);
  const bytes = typeof rawBytes === 'string' ? new TextEncoder().encode(rawBytes) : rawBytes;

  const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'video/mp4' }));
  const demuxed = await getOrCreateDemux(blobUrl);
  const audioProbe = await probeMp4AudioTrack(bytes);
  const decodeCheck = await decodeMp4TrackAndCheck(demuxed.config, demuxed.chunks);

  const videoFrameCount = demuxed.chunks.length;
  const frameCountMatches = videoFrameCount === expectedFrameCount && decodeCheck.decodedFrameCount === expectedFrameCount;
  const durationOk = Math.abs(demuxed.durationSec - expectedDurationSec) <= 1 / fps;
  // A genuinely black frame would read ~0; the spike's actual frames are the
  // real sample.mp4 footage composited through GlCompositor, so any healthy
  // decode should read well above this floor.
  const nonBlack = decodeCheck.lastFrameLuma !== null && decodeCheck.lastFrameLuma > 5;

  return {
    outputFile,
    onDiskBytes: bytes.length,
    videoFrameCount,
    videoFrameCountDecoded: decodeCheck.decodedFrameCount,
    expectedFrameCount,
    frameCountMatches,
    videoDurationSec: demuxed.durationSec,
    expectedDurationSec,
    durationOk,
    audioPresent: audioProbe.audioPresent,
    audioCodec: audioProbe.audioCodec,
    audioDurationSec: audioProbe.audioDurationSec,
    decodeErrors: decodeCheck.decodeErrors,
    lastFrameLuma: decodeCheck.lastFrameLuma,
    nonBlack,
  };
}

/** Step 4 top-level verification: fresh session, re-append run1's chunks,
 *  synthesize + write WAV audio, run the with-audio and no-audio mux cases,
 *  destroy the session. Tauri-only (appendFileRaw/exec/readFile IPC). */
async function verifyMuxOnlyStep4(
  chunks: ChunkRecord[],
  fps: number,
  expectedFrameCount: number,
  expectedDurationSec: number,
): Promise<MuxVerifyResult> {
  log('--- Step 4: synthetic audio + real muxOnly() verification ---');
  const result: MuxVerifyResult = { ranAtAll: false, withAudio: null, noAudio: null, error: null };
  const ffmpeg = await TauriFfmpeg.create();
  try {
    const runFile = 'run_0.h264';
    log(`Re-appending ${chunks.length} chunks to a fresh session (${runFile})...`);
    for (const c of chunks) {
      // eslint-disable-next-line no-await-in-loop
      await ffmpeg.appendFileRaw(runFile, new Uint8Array(c.bytes));
    }

    log(`Synthesizing a ${SYNTH_AUDIO_DURATION_SEC}s ${SYNTH_AUDIO_FREQ_HZ}Hz mono WAV tone @ ${SYNTH_AUDIO_SAMPLE_RATE}Hz...`);
    const wavBytes = await synthesizeWavTone(SYNTH_AUDIO_DURATION_SEC, SYNTH_AUDIO_FREQ_HZ, SYNTH_AUDIO_SAMPLE_RATE);
    const audioFile = 'voiceover_audio.wav';
    await ffmpeg.writeFile(audioFile, wavBytes);
    log(`Wrote ${wavBytes.length} bytes of synthetic WAV audio to session:${audioFile}`);

    log('--- With-audio case: muxOnly -> export_final.mp4 ---');
    const withAudio = await runMuxCase(ffmpeg, runFile, audioFile, 'export_final.mp4', fps, expectedFrameCount, expectedDurationSec);
    log(
      `With-audio: onDiskBytes=${withAudio.onDiskBytes} videoFrameCount(track)=${withAudio.videoFrameCount} ` +
        `videoFrameCount(decoded)=${withAudio.videoFrameCountDecoded} expected=${withAudio.expectedFrameCount} ` +
        `frameCountMatches=${withAudio.frameCountMatches}; videoDuration=${withAudio.videoDurationSec.toFixed(3)}s ` +
        `expected=${withAudio.expectedDurationSec}s durationOk=${withAudio.durationOk}; ` +
        `audioPresent=${withAudio.audioPresent} audioCodec=${withAudio.audioCodec} ` +
        `audioDuration=${withAudio.audioDurationSec?.toFixed(3)}s; lastFrameLuma=${withAudio.lastFrameLuma?.toFixed(1)} ` +
        `nonBlack=${withAudio.nonBlack}; decodeErrors=${withAudio.decodeErrors.length}`,
    );
    if (withAudio.decodeErrors.length) log('With-audio decode errors: ' + withAudio.decodeErrors.join(' | '));
    result.withAudio = withAudio;

    log('--- No-audio case: muxOnly -> export_noaudio.mp4 ---');
    const noAudio = await runMuxCase(ffmpeg, runFile, null, 'export_noaudio.mp4', fps, expectedFrameCount, expectedDurationSec);
    log(
      `No-audio: onDiskBytes=${noAudio.onDiskBytes} videoFrameCount=${noAudio.videoFrameCount} ` +
        `expected=${noAudio.expectedFrameCount} frameCountMatches=${noAudio.frameCountMatches}; ` +
        `videoDuration=${noAudio.videoDurationSec.toFixed(3)}s durationOk=${noAudio.durationOk}; ` +
        `audioPresent=${noAudio.audioPresent} (must be false)`,
    );
    result.noAudio = noAudio;

    result.ranAtAll = true;
  } catch (e) {
    result.error = fullErrorText(e);
    log('Step 4 mux verification FAILED: ' + result.error);
  } finally {
    await ffmpeg.destroy();
    log('Step 4 mux-verification session destroyed.');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Step 5 — full-timeline routing/run-splitting/concat verification
// (docs/webcodecs-export-plan.md §3, §4.4). Everything below is new this
// step; the Step 3/4 machinery above (runWorkerOnce, verifyAnnexbDecodable,
// verifyViaTauriDiskAppend, verifyCancelLeavesNoOrphan, synthesizeWavTone,
// probeMp4AudioTrack, decodeMp4TrackAndCheck, runMuxCase/verifyMuxOnlyStep4)
// is UNCHANGED and still runs — Step 5 is additive verification, not a
// replacement.
//
// Builds a MIXED project exercising all 3 tiers plus both boundary types:
//
//   A (video, GL: zoom-in + cross-dissolve into B)   [0.0s - 2.0s]
//   B (image, GL, hard-cut into C)                   [2.0s - 3.5s]
//   C (video, Tier 1 plain — no effects at all)      [3.5s - 5.0s]
//   D (image, Tier C — legacy ken-burns, fade->E)     [5.0s - 6.5s]
//   E (video, Tier C — color filter 'noir')           [6.5s - 8.0s]
//
// Routing trace (verified by hand against glCompositable.ts/
// exportPipelineWebCodecs.ts's own logic while writing this fixture):
//   A-B: real (0.5s) 'cross-dissolve' edge, both individually GL-eligible ->
//        unioned into ONE GL piece (run of 2 segments) — exercises "a
//        transition between two same-tier segments" AND run-grouping.
//   B-C: hard cut (duration 0) — GL -> Tier1 cross-tier boundary.
//   C-D: hard cut (duration 0) — Tier1 -> Tier C cross-tier boundary.
//   D-E: real (0.5s) legacy-enum 'fade' edge, NOT a GL slug, so never
//        unioned — both sides already independently 'canvas' (D via its
//        ken-burns animation, E via its color filter) — exercises "a
//        transition between two same-tier [canvas] segments" rendered via
//        encodeSegment's own per-segment blend math, same as today.
//
// effectGrade is deliberately OMITTED from every segment here. Grade has NO
// renderer at all on the legacy canvas path (confirmed by grep — zero
// references to `effectGrade` outside the GL stack: `compositeParams.ts`,
// `autoGrade.ts`, and UI code) — so a legacy-vs-new A/B comparison that
// included grade would show a large, EXPECTED mismatch on the GL segments
// (new renders it, legacy silently never has), which is not a bug and would
// only muddy this comparison's actual purpose (checking that both pipelines
// render the SAME effects identically). Grade's own correctness is already
// covered exhaustively by glCompositable.test.ts's unit tests (grade never
// disqualifies GL routing) and by the pre-existing GL compositor pixel
// verification (docs/history.md). This spike compares zoom + both
// transition families + a legacy animation + a color filter instead.
// ---------------------------------------------------------------------------

const STEP5_TOTAL_DURATION_SEC = 8;

interface CheckPoint {
  label: string;
  t: number;
}

/** Segment boundaries: A[0,2) B[2,3.5) C[3.5,5) D[5,6.5) E[6.5,8). Transition
 *  windows are CENTERED on their boundary (resolveTransitionProgress) — the
 *  A-B dissolve (duration 0.5) spans [1.75,2.25]; the D-E fade (duration 0.5)
 *  spans [6.25,6.75]. Points below sample every tier, both transition
 *  midpoints, and both hard-cut boundaries (just past, since the boundary
 *  instant itself belongs to the outgoing segment). */
const STEP5_CHECK_POINTS: CheckPoint[] = [
  { label: 'A start (t=0.1)', t: 0.1 },
  { label: 'A mid, pre-transition (t=1.0)', t: 1.0 },
  { label: 'A-B cross-dissolve midpoint (t=2.0, boundary)', t: 2.0 },
  { label: 'B mid, post-transition (t=2.75)', t: 2.75 },
  { label: 'B->C hard cut, first frame of C (t=3.52)', t: 3.52 },
  { label: 'C mid (t=4.25, Tier 1 plain)', t: 4.25 },
  { label: 'C->D hard cut, first frame of D (t=5.02)', t: 5.02 },
  { label: 'D mid, pre-transition (t=5.6, Tier C canvas)', t: 5.6 },
  { label: 'D-E fade midpoint (t=6.5, boundary)', t: 6.5 },
  { label: 'E mid, post-transition (t=7.25, Tier C canvas)', t: 7.25 },
];

/** Same solid-color-swatch-with-label synthesis pattern as
 *  src/dev/phase6Spike/generateScaleFixture.ts's makeColorImageBlob —
 *  duplicated locally (that file is a sibling dev spike, not a shared
 *  utility module) rather than imported, to keep this throwaway spike
 *  self-contained. */
function makeColorImageBlob(color: string, label: string, w: number, h: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('makeColorImageBlob: 2D context unavailable');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('makeColorImageBlob: toBlob returned null'))), 'image/png');
  });
}

async function buildMixedProject(): Promise<Project> {
  const resp = await fetch(SAMPLE_URL);
  if (!resp.ok) throw new Error(`could not fetch ${SAMPLE_URL} (${resp.status})`);
  const videoUrl = URL.createObjectURL(await resp.blob());
  const imageBBlob = await makeColorImageBlob('#3cb44b', 'B', WIDTH, HEIGHT);
  const imageDBlob = await makeColorImageBlob('#f58231', 'D', WIDTH, HEIGHT);
  const wavBytes = await synthesizeWavTone(STEP5_TOTAL_DURATION_SEC, SYNTH_AUDIO_FREQ_HZ, SYNTH_AUDIO_SAMPLE_RATE);
  const wavUrl = URL.createObjectURL(new Blob([wavBytes as unknown as BlobPart], { type: 'audio/wav' }));

  const videoAsset: Asset = { id: 'mixed-video', name: 'sample.mp4', url: videoUrl, type: 'video' };
  const imageAssetB: Asset = { id: 'mixed-image-b', name: 'swatch-b.png', url: URL.createObjectURL(imageBBlob), type: 'image' };
  const imageAssetD: Asset = { id: 'mixed-image-d', name: 'swatch-d.png', url: URL.createObjectURL(imageDBlob), type: 'image' };
  const audioAsset: Asset = { id: 'mixed-audio', name: 'voiceover.wav', url: wavUrl, type: 'audio' };

  // Step 6 text additions (docs/webcodecs-export-plan.md §4.3/§5) — ADDED to
  // the two GL segments only (A, B), per this step's own instructions: A
  // gets a body caption (showOverlay + text + a FULLY self-specified
  // segment-level overlayConfig — see this step's report for why "fully
  // self-specified" matters: the real orchestrator does not yet thread
  // project.globalOverlayConfig into the worker's init message, so a
  // caption relying on that fallback would silently render wrong colors via
  // the GL path today), B gets an `extraOverlays` entry (TextOverlay is
  // fully self-specified by type — no global fallback involved at all).
  // `sans-serif` is used everywhere text appears in this fixture
  // deliberately — a generic CSS family needs no FontFace/self.fonts load in
  // either renderer, so this fixture's parity comparisons measure the
  // WRAPPING/POSITIONING/PILL/SHADOW logic Step 6 actually changed, not
  // incidental Canvas2D-in-worker-vs-main-thread glyph rasterization noise
  // (the plan's own §11.2 acceptance note allows for that separately).
  const segA: VideoSegment = {
    id: 'seg-a', text: 'GL video caption', assetId: videoAsset.id,
    startTime: 0, duration: 2,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0,
    trimStart: 0, trimEnd: 2,
    effectAnimation: 'zoom-in', effectAnimationScaleRate: 0.02,
    effectTransition: 'cross-dissolve', effectTransitionDuration: 0.5,
    showOverlay: true,
    overlayConfig: { color: '#ffff33', backgroundColor: 'rgba(20,20,40,0.75)', fontFamily: 'sans-serif', fontSize: 26, x: 50, y: 80 },
  };
  const segB: VideoSegment = {
    id: 'seg-b', text: '', assetId: imageAssetB.id,
    startTime: 2, duration: 1.5,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: 1,
    extraOverlays: [
      {
        id: 'overlay-b1', text: 'Overlay on B', color: '#00ffcc', backgroundColor: 'rgba(10,10,10,0.8)',
        fontFamily: 'sans-serif', fontSize: 30, position: { x: 50, y: 22 }, textAlign: 'center',
      },
    ],
  };
  const segC: VideoSegment = {
    id: 'seg-c', text: '', assetId: videoAsset.id,
    startTime: 3.5, duration: 1.5,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: 2,
    trimStart: 2, trimEnd: 3.5,
  };
  const segD: VideoSegment = {
    id: 'seg-d', text: '', assetId: imageAssetD.id,
    startTime: 5, duration: 1.5,
    transition: TransitionType.FADE, transitionDuration: 0.5, animation: AnimationType.KEN_BURNS, order: 3,
  };
  const segE: VideoSegment = {
    id: 'seg-e', text: '', assetId: videoAsset.id,
    startTime: 6.5, duration: 1.5,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: 4,
    trimStart: 3.5, trimEnd: 5,
    overlayFilter: 'noir',
  };

  return {
    id: 'step5-mixed-project',
    name: 'Step 5 Mixed Project Spike',
    script: '',
    sceneDetails: '',
    segments: [segA, segB, segC, segD, segE],
    assets: [videoAsset, imageAssetB, imageAssetD, audioAsset],
    voiceoverId: audioAsset.id,
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.6)', fontFamily: 'sans-serif' },
    // Global text layer — hidden specifically on seg-b (GL image segment),
    // visible everywhere else (seg-a [GL], seg-c/d/e [Tier1/TierC]) — the
    // fixture for both the "hiddenOnSegments respected on a GL segment"
    // check (Step 6's own text renderer) and, for free, "still visible on
    // the OTHER segments" via the unmodified legacy/TierC canvas path
    // (encodeSegment already renders `globalTextLayers` correctly — nothing
    // this step touches).
    textLayers: [MIXED_PROJECT_GLOBAL_TEXT_LAYER],
    // Path B heading — active for [0, 1.5), i.e. spans seg-a's whole run
    // (ends before seg-b starts at t=2), so it's live at BOTH of seg-a's
    // STEP5_CHECK_POINTS ('A start' t=0.1, 'A mid' t=1.0) and inactive
    // everywhere else — an unambiguous single-segment heading fixture.
    headings: [MIXED_PROJECT_HEADING],
  };
}

const MIXED_PROJECT_GLOBAL_TEXT_LAYER: TextOverlay = {
  id: 'global-layer-1', text: 'GLOBAL LAYER', color: '#ff66cc', backgroundColor: 'rgba(0,0,0,0.55)',
  fontFamily: 'sans-serif', fontSize: 20, position: { x: 18, y: 10 }, textAlign: 'left',
  hiddenOnSegments: ['seg-b'],
};

const MIXED_PROJECT_HEADING: HeadingOverlay = {
  id: 'heading-1', time: 0, duration: 1.5, text: 'INTRO HEADING',
  fontFamily: 'sans-serif', fontSize: 40, fontWeight: 'bold', color: '#ffffff',
  backgroundColor: 'rgba(10,10,45,0.55)', x: 50, y: 50,
};

// ---------------------------------------------------------------------------
// ffmpeg-based frame extraction — REPLACES the WebCodecs/mp4box re-decode
// harness above (formerly `extractFrameNear`/`extractFrameNearInner`, which
// pointed `decodeSegmentFrames` at the pipelines' OUTPUT MP4s and stalled at
// tier/concat boundaries). Root-cause hypothesis: `decodeSegmentFrames` (via
// `getOrCreateDemux`/mp4box + a real `VideoDecoder`) is designed for the
// export worker's own SOURCE assets, not for re-decoding a freshly-muxed
// A/V-interleaved output file — something about that combination (mp4box
// track/sample-table handling or VideoDecoder feed timing right at a
// concat/tier seam) hangs rather than throws. This harness sidesteps the
// question entirely by using the bundled ffmpeg sidecar as the decoder
// instead of WebCodecs: ffmpeg does not care how many tracks a container has
// and handles arbitrary MP4s the way any real player would.
//
// `ffmpeg_exec` (ffmpeg.rs) deliberately DISCARDS stdout (see its own D13-fix
// doc comment — only the exit code / stderr tail is returned), so
// `-f rawvideo - ` piped to stdout is not usable here without touching Rust.
// Instead each extraction writes ONE raw RGBA frame to a named file inside
// the existing (already-IPC-backed) session directory and reads it back via
// the existing `readFile()` IPC — no production file touched.
// ---------------------------------------------------------------------------

/** Runs `ffmpeg -ss T -i <inputFile> -frames:v 1 -f rawvideo -pix_fmt rgba
 *  <outFile>` inside `ffmpeg`'s session dir and reads the raw RGBA bytes
 *  back. `-ss` before `-i` (input seeking): modern ffmpeg (the bundled
 *  8.1.1/7.1.1 builds both postdate the mid-2010s accurate-seek fix) still
 *  decodes forward from the nearest keyframe to the exact requested
 *  timestamp for MP4/mov demuxers, so this is both fast (skips full-file
 *  decode) and frame-accurate — not the old fast-but-imprecise keyframe-only
 *  seek some ffprobe folklore warns about. Throws (with a clear message) on
 *  a non-zero exit or a wrong-sized output — e.g. a target past the file's
 *  own duration produces a short/empty file, which is a real, reportable
 *  extraction failure, not silently swallowed. */
async function extractRgbaFrameViaFfmpeg(
  ffmpeg: TauriFfmpeg,
  inputFile: string,
  targetSec: number,
  width: number,
  height: number,
  outFile: string,
): Promise<Uint8Array> {
  const clampedSec = Math.max(0, targetSec);
  await ffmpeg.exec(['-y', '-ss', clampedSec.toFixed(4), '-i', inputFile, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', outFile]);
  const raw = await ffmpeg.readFile(outFile);
  const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
  const expected = width * height * 4;
  if (bytes.length !== expected) {
    throw new Error(
      `extractRgbaFrameViaFfmpeg: ${inputFile}@${clampedSec.toFixed(4)}s produced ${bytes.length} bytes, expected ${expected} (${width}x${height}x4 RGBA) — likely past end of stream or a decode failure`,
    );
  }
  return bytes;
}

interface FrameCompareResult {
  matchPct: number;
  meanDiffR: number;
  meanDiffG: number;
  meanDiffB: number;
  maxDiffR: number;
  maxDiffG: number;
  maxDiffB: number;
}

/** Per-pixel, per-channel comparison of two raw RGBA buffers (as produced by
 *  `extractRgbaFrameViaFfmpeg` — no ImageData/canvas round-trip involved).
 *  `matchPct` = fraction of pixels where EVERY channel (R,G,B; alpha
 *  ignored — both outputs are opaque video frames) is within `tolerance`
 *  (default ±5/255, per this task's spec) — tight enough that a genuinely
 *  wrong frame (wrong content, dropped transition, wrong tier routing) reads
 *  as a clear failure, loose enough to absorb the two renderers' independent
 *  AA/rounding behavior (GL shader vs. Canvas2D) plus two independent H.264
 *  encodes of the same content. */
function compareRgbaBuffers(a: Uint8Array, b: Uint8Array, tolerance = 5): FrameCompareResult {
  const n = Math.min(a.length, b.length);
  let sumR = 0, sumG = 0, sumB = 0;
  let maxR = 0, maxG = 0, maxB = 0;
  let matching = 0;
  let samples = 0;
  for (let i = 0; i + 2 < n; i += 4) {
    const dr = Math.abs(a[i]! - b[i]!);
    const dg = Math.abs(a[i + 1]! - b[i + 1]!);
    const db = Math.abs(a[i + 2]! - b[i + 2]!);
    sumR += dr;
    sumG += dg;
    sumB += db;
    if (dr > maxR) maxR = dr;
    if (dg > maxG) maxG = dg;
    if (db > maxB) maxB = db;
    if (dr <= tolerance && dg <= tolerance && db <= tolerance) matching++;
    samples++;
  }
  return {
    matchPct: samples > 0 ? (matching / samples) * 100 : 0,
    meanDiffR: samples > 0 ? sumR / samples : 0,
    meanDiffG: samples > 0 ? sumG / samples : 0,
    meanDiffB: samples > 0 ? sumB / samples : 0,
    maxDiffR: maxR,
    maxDiffG: maxG,
    maxDiffB: maxB,
  };
}

/** ±N-frame window (at `FPS`) searched independently on each side to absorb
 *  GOP-phase differences between the two independently-encoded streams (the
 *  prior run's confounder — ~70-100ms misalignment at a nearest-decodable-
 *  frame level). This is Option B from the task brief: extract a small set
 *  of candidate frames from EACH side around the nominal checkpoint time,
 *  compare every legacy/new pair, and report the best (highest matchPct)
 *  pairing — a content-parity check (per §11.2's own stated intent), not an
 *  exact-timestamp-parity check. */
const WINDOW_OFFSET_FRAMES = [-2, -1, 0, 1, 2];

/** Diagnostic-only offsets (±1s, coarse steps) for `diagnoseTimingDrift`
 *  below — see that function's doc comment. */
const DIAGNOSTIC_OFFSET_FRAMES = [-30, -24, -18, -12, -9, -6, -3, 0, 3, 6, 9, 12, 18, 24, 30];

/** One-sided diagnostic: when the normal ±2-frame search comes back with a
 *  low match, this re-extracts the LEGACY frame at a much wider set of
 *  offsets (±1s) and compares each against a SINGLE, FIXED, already-known
 *  "new" frame (the normal search's own best match on the new side — one
 *  extra extraction, reused here rather than re-extracted per candidate).
 *  This is a cross-product-avoiding, one-sided version of Option B: legacy's
 *  own measured duration is 0.1s SHORT of the new pipeline's (7.900s vs
 *  8.000s — see the duration log line), which only makes sense as a LEGACY-
 *  side timing issue (the new pipeline's frame count/duration exactly
 *  matches the project timeline), so widening only the legacy side is both
 *  cheaper (16 ffmpeg calls instead of 42+) and the more targeted test of
 *  that specific hypothesis. If a much-better match turns up at a large
 *  legacy offset, that confirms "same content, shifted in time" (a timing
 *  bug) rather than a genuine pixel/content difference. */
async function diagnoseTimingDrift(
  legacyFfmpeg: TauriFfmpeg,
  legacyFile: string,
  fixedNewBytes: Uint8Array,
  nominalT: number,
  width: number,
  height: number,
  fps: number,
): Promise<{ bestOffsetFrames: number | null; bestTs: number | null; compare: FrameCompareResult | null; errors: string[] }> {
  const frameDur = 1 / fps;
  const errors: string[] = [];
  let best: { offset: number; ts: number; cmp: FrameCompareResult } | null = null;
  for (const offset of DIAGNOSTIC_OFFSET_FRAMES) {
    const ts = nominalT + offset * frameDur;
    try {
      // eslint-disable-next-line no-await-in-loop
      const bytes = await extractRgbaFrameViaFfmpeg(legacyFfmpeg, legacyFile, ts, width, height, `legacy_diag_${nominalT}_${offset}.rgba`);
      const cmp = compareRgbaBuffers(bytes, fixedNewBytes);
      if (!best || cmp.matchPct > best.cmp.matchPct) best = { offset, ts, cmp };
    } catch (e) {
      errors.push(fullErrorText(e));
    }
  }
  return { bestOffsetFrames: best?.offset ?? null, bestTs: best?.ts ?? null, compare: best?.cmp ?? null, errors };
}

interface CheckpointCompareResult {
  label: string;
  t: number;
  legacyExtractOk: boolean;
  legacyExtractErrors: string[];
  newExtractOk: boolean;
  newExtractErrors: string[];
  bestLegacyOffsetFrames: number | null;
  bestNewOffsetFrames: number | null;
  bestLegacyTs: number | null;
  bestNewTs: number | null;
  compare: FrameCompareResult | null;
}

/** For one checkpoint: extracts up to 5 candidate frames from each side
 *  (nominal time ± up to 2 frames at `fps`), compares every candidate pair,
 *  and keeps the best-matching pair. Each candidate extraction is
 *  independently try/catch'd — a failure at one offset (e.g. one edge of
 *  the window falls outside the file) must not abort the other offsets or
 *  the other side. */
async function compareCheckpointWithWindowSearch(
  legacyFfmpeg: TauriFfmpeg,
  newFfmpeg: TauriFfmpeg,
  legacyFile: string,
  newFile: string,
  point: CheckPoint,
  width: number,
  height: number,
  fps: number,
  offsetFrames: number[] = WINDOW_OFFSET_FRAMES,
): Promise<CheckpointCompareResult> {
  const frameDur = 1 / fps;
  const legacyCandidates: { offset: number; ts: number; bytes: Uint8Array }[] = [];
  const legacyErrors: string[] = [];
  const newCandidates: { offset: number; ts: number; bytes: Uint8Array }[] = [];
  const newErrors: string[] = [];

  for (const offset of offsetFrames) {
    const ts = point.t + offset * frameDur;
    try {
      // eslint-disable-next-line no-await-in-loop
      const bytes = await extractRgbaFrameViaFfmpeg(legacyFfmpeg, legacyFile, ts, width, height, `legacy_cp_${point.t}_${offset}.rgba`);
      legacyCandidates.push({ offset, ts, bytes });
    } catch (e) {
      legacyErrors.push(fullErrorText(e));
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const bytes = await extractRgbaFrameViaFfmpeg(newFfmpeg, newFile, ts, width, height, `new_cp_${point.t}_${offset}.rgba`);
      newCandidates.push({ offset, ts, bytes });
    } catch (e) {
      newErrors.push(fullErrorText(e));
    }
  }

  const result: CheckpointCompareResult = {
    label: point.label,
    t: point.t,
    legacyExtractOk: legacyCandidates.length > 0,
    legacyExtractErrors: legacyErrors,
    newExtractOk: newCandidates.length > 0,
    newExtractErrors: newErrors,
    bestLegacyOffsetFrames: null,
    bestNewOffsetFrames: null,
    bestLegacyTs: null,
    bestNewTs: null,
    compare: null,
  };

  if (legacyCandidates.length === 0 || newCandidates.length === 0) return result;

  let best: { legacy: (typeof legacyCandidates)[number]; next: (typeof newCandidates)[number]; cmp: FrameCompareResult } | null = null;
  for (const legacy of legacyCandidates) {
    for (const next of newCandidates) {
      const cmp = compareRgbaBuffers(legacy.bytes, next.bytes);
      if (!best || cmp.matchPct > best.cmp.matchPct || (cmp.matchPct === best.cmp.matchPct && cmp.meanDiffR + cmp.meanDiffG + cmp.meanDiffB < best.cmp.meanDiffR + best.cmp.meanDiffG + best.cmp.meanDiffB)) {
        best = { legacy, next, cmp };
      }
    }
  }
  if (best) {
    result.bestLegacyOffsetFrames = best.legacy.offset;
    result.bestNewOffsetFrames = best.next.offset;
    result.bestLegacyTs = best.legacy.ts;
    result.bestNewTs = best.next.ts;
    result.compare = best.cmp;
  }
  return result;
}

interface Step5AbResult {
  legacyOk: boolean;
  legacyError: string | null;
  legacyBytes: number | null;
  legacyDurationSec: number;
  legacyFrameCount: number;
  newOk: boolean;
  newError: string | null;
  newBytes: number | null;
  newDurationSec: number;
  newFrameCount: number;
  checks: CheckpointCompareResult[];
  frameCompareOk: boolean;
}

/** Exports the SAME mixed project via the legacy `exportPipeline.ts` AND the
 *  new `exportPipelineWebCodecs.ts`, then frame-compares both outputs at
 *  every `STEP5_CHECK_POINTS` timestamp via ffmpeg-based extraction (see the
 *  "ffmpeg-based frame extraction" section above). Each pipeline gets its
 *  OWN `TauriFfmpeg` session (isolated temp dirs) — real IPC throughout, no
 *  mocking. Both sessions are kept alive (not destroyed immediately after
 *  export, unlike the pre-Step-5 pattern) until frame extraction is done,
 *  since extraction runs ffmpeg directly against each session's own
 *  `export_final.mp4` rather than re-uploading the bytes elsewhere. */
async function runStep5MixedAbCompare(): Promise<Step5AbResult> {
  log('--- Step 5: mixed-project A/B frame-compare (legacy vs new pipeline) ---');
  log("Frame extraction method: ffmpeg-based (bundled sidecar decodes each output MP4 directly), NOT WebCodecs/mp4box re-decode — see this file's ffmpeg-based frame extraction section for why the old harness stalled.");
  const project = await buildMixedProject();
  log(
    'Mixed project: A(video,GL zoom-in+dissolve->B)[0-2s] B(image,GL,hard-cut->C)[2-3.5s] ' +
      'C(video,Tier1 plain)[3.5-5s] D(image,TierC ken-burns,fade->E)[5-6.5s] E(video,TierC filter)[6.5-8s]',
  );

  const legacyFfmpeg = await TauriFfmpeg.create();
  let legacyBytes: Uint8Array | null = null;
  let legacyError: string | null = null;
  let legacyOutputFile: string | null = null;
  try {
    const result = await exportProject(project, legacyFfmpeg, { fps: FPS, width: WIDTH, height: HEIGHT });
    if (!result.ok) {
      legacyError = JSON.stringify(result.error);
    } else {
      legacyOutputFile = result.outputFile;
      const raw = await legacyFfmpeg.readFile(result.outputFile);
      legacyBytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
    }
  } catch (e) {
    legacyError = fullErrorText(e);
  }
  log(`Legacy export (exportPipeline.ts): ${legacyError ? 'FAILED: ' + legacyError : `OK, ${legacyBytes?.length} bytes, outputFile=${legacyOutputFile}`}`);

  const newFfmpeg = await TauriFfmpeg.create();
  let newBytes: Uint8Array | null = null;
  let newError: string | null = null;
  let newOutputFile: string | null = null;
  let progressCalls = 0;
  try {
    const result = await exportProjectWebCodecs(project, newFfmpeg, { fps: FPS, width: WIDTH, height: HEIGHT }, () => {
      progressCalls++;
    });
    if (!result.ok) {
      newError = JSON.stringify(result.error);
    } else {
      newOutputFile = result.outputFile;
      const raw = await newFfmpeg.readFile(result.outputFile);
      newBytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
    }
  } catch (e) {
    newError = fullErrorText(e);
  }
  log(`New export (exportPipelineWebCodecs.ts): ${newError ? 'FAILED: ' + newError : `OK, ${newBytes?.length} bytes, outputFile=${newOutputFile}`} (${progressCalls} progress callbacks)`);

  const checks: CheckpointCompareResult[] = [];
  let frameCompareOk = legacyBytes !== null && newBytes !== null;
  let legacyDurationSec = 0;
  let newDurationSec = 0;
  let legacyFrameCount = 0;
  let newFrameCount = 0;

  try {
    if (legacyBytes && newBytes) {
      // Duration/frame-count still comes from mp4box (getOrCreateDemux) —
      // this is METADATA-ONLY extraction of the video track's own sample
      // table (see videoDemuxer.ts: it reads info.videoTracks[0] and never
      // touches the audio track), not a VideoDecoder decode cycle. This is
      // NOT the part that stalled in the prior run (only per-checkpoint
      // pixel decode via decodeSegmentFrames did) so it's left as-is.
      const legacyUrl = URL.createObjectURL(new Blob([legacyBytes as BlobPart], { type: 'video/mp4' }));
      const newUrl = URL.createObjectURL(new Blob([newBytes as BlobPart], { type: 'video/mp4' }));
      const legacyDemux = await getOrCreateDemux(legacyUrl);
      const newDemux = await getOrCreateDemux(newUrl);
      legacyDurationSec = legacyDemux.durationSec;
      newDurationSec = newDemux.durationSec;
      legacyFrameCount = legacyDemux.chunks.length;
      newFrameCount = newDemux.chunks.length;
      const expectedFrameCount = Math.round(STEP5_TOTAL_DURATION_SEC * FPS);
      log(
        `Legacy duration=${legacyDurationSec.toFixed(3)}s (${legacyFrameCount} video-track samples), ` +
          `New duration=${newDurationSec.toFixed(3)}s (${newFrameCount} video-track samples), ` +
          `project timeline duration=${STEP5_TOTAL_DURATION_SEC}s, expected frame count=${expectedFrameCount} @ ${FPS}fps`,
      );
    }

    if (legacyOutputFile && newOutputFile) {
      for (const point of STEP5_CHECK_POINTS) {
        // Each checkpoint is independently try/catch'd inside
        // compareCheckpointWithWindowSearch — a failure on ONE checkpoint
        // (e.g. right at a concat seam, which is exactly the kind of thing
        // worth finding) must not abort every OTHER checkpoint's comparison,
        // and must not crash out of this whole function (which would
        // silently lose every result gathered so far, including the
        // negative test that runs after it in `main()`).
        // eslint-disable-next-line no-await-in-loop
        const cp = await compareCheckpointWithWindowSearch(legacyFfmpeg, newFfmpeg, legacyOutputFile, newOutputFile, point, WIDTH, HEIGHT, FPS);
        checks.push(cp);
        if (!cp.legacyExtractOk || !cp.newExtractOk) {
          log(
            `  [${point.label}] EXTRACT ERROR — legacy: ${cp.legacyExtractOk ? 'ok' : cp.legacyExtractErrors.join(' | ')} | ` +
              `new: ${cp.newExtractOk ? 'ok' : cp.newExtractErrors.join(' | ')}`,
          );
          frameCompareOk = false;
          continue;
        }
        const cmp = cp.compare!;
        log(
          `  [${point.label}] bestLegacyTs=${cp.bestLegacyTs?.toFixed(4)}s (offset ${cp.bestLegacyOffsetFrames} frames) ` +
            `bestNewTs=${cp.bestNewTs?.toFixed(4)}s (offset ${cp.bestNewOffsetFrames} frames) ` +
            `matchPct=${cmp.matchPct.toFixed(1)}% meanDiff(R,G,B)=(${cmp.meanDiffR.toFixed(2)},${cmp.meanDiffG.toFixed(2)},${cmp.meanDiffB.toFixed(2)}) ` +
            `maxDiff(R,G,B)=(${cmp.maxDiffR},${cmp.maxDiffG},${cmp.maxDiffB})`,
        );
        if (cmp.matchPct < 85) frameCompareOk = false;

        // Diagnostic-only: the ±2-frame search came back with a low match —
        // re-extract the fixed "new" frame once more (its bytes weren't
        // retained by compareCheckpointWithWindowSearch) and widen ONLY the
        // legacy-side search against it (see diagnoseTimingDrift's own doc
        // comment for why one-sided). Does not affect frameCompareOk/checks
        // — purely informational, logged so the report can characterize the
        // failure rather than just stating a low number.
        if (cmp.matchPct < 50 && cp.bestNewTs !== null) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const fixedNewBytes = await extractRgbaFrameViaFfmpeg(newFfmpeg, newOutputFile, cp.bestNewTs, WIDTH, HEIGHT, `new_diag_fixed_${point.t}.rgba`);
            // eslint-disable-next-line no-await-in-loop
            const diag = await diagnoseTimingDrift(legacyFfmpeg, legacyOutputFile, fixedNewBytes, point.t, WIDTH, HEIGHT, FPS);
            if (diag.compare) {
              log(
                `    [DIAGNOSTIC ±1s legacy-side search, new fixed @${cp.bestNewTs.toFixed(4)}s] bestLegacyTs=${diag.bestTs?.toFixed(4)}s ` +
                  `(offset ${diag.bestOffsetFrames} frames) matchPct=${diag.compare.matchPct.toFixed(1)}% ` +
                  `meanDiff(R,G,B)=(${diag.compare.meanDiffR.toFixed(2)},${diag.compare.meanDiffG.toFixed(2)},${diag.compare.meanDiffB.toFixed(2)}) ` +
                  `=> ${diag.compare.matchPct >= 90 ? 'LIKELY TIMING/DURATION DRIFT (content matches once re-aligned)' : 'STILL LOW EVEN WIDE — LIKELY A REAL CONTENT DIFFERENCE'}`,
              );
            } else {
              log(`    [DIAGNOSTIC] legacy-side wide search found no usable frame — errors: ${diag.errors.join(' | ')}`);
            }
          } catch (e) {
            log(`    [DIAGNOSTIC] failed to re-extract fixed new frame: ${fullErrorText(e)}`);
          }
        }
      }
    } else {
      frameCompareOk = false;
    }
  } finally {
    await legacyFfmpeg.destroy();
    await newFfmpeg.destroy();
  }

  return {
    legacyOk: !legacyError,
    legacyError,
    legacyBytes: legacyBytes?.length ?? null,
    legacyDurationSec,
    legacyFrameCount,
    newOk: !newError,
    newError,
    newBytes: newBytes?.length ?? null,
    newDurationSec,
    newFrameCount,
    checks,
    frameCompareOk,
  };
}

interface ConcatGuardNegativeResult {
  ran: boolean;
  goodFrames: number;
  expectedFrames: number;
  actualFrames: number;
  guardTripped: boolean;
  tripMechanism: 'frame-count-mismatch' | 'ffmpeg-concat-threw' | 'none';
  concatError?: string;
}

/** Deliberately corrupts one annexb piece (truncates it by ~50%) and runs
 *  the REAL `concatAnnexbPieces`/`countAnnexbFrames` (the exact functions
 *  `exportPipelineWebCodecs.ts` uses internally) against it, confirming the
 *  guard trips rather than silently shipping a short/corrupt result. Uses a
 *  real GL-worker-encoded run (via `runWorkerOnce`, Step 3's own driver) as
 *  the source of both the "good" and "corrupted" pieces, so the corruption
 *  is a realistic truncation of a real stream, not a synthetic byte pattern. */
async function runConcatGuardNegativeTest(): Promise<ConcatGuardNegativeResult> {
  log('--- Step 5: concat-guard negative test (deliberately corrupted piece) ---');
  const ffmpeg = await TauriFfmpeg.create();
  try {
    const resp = await fetch(SAMPLE_URL);
    const assetUrl = URL.createObjectURL(await resp.blob());
    const asset: Asset = { id: 'neg-asset', name: 'sample.mp4', url: assetUrl, type: 'video' };
    const segment: VideoSegment = {
      id: 'neg-seg', text: '', assetId: asset.id, startTime: 0, duration: 2,
      transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0, trimStart: 0, trimEnd: 2,
    };
    const config: ProjectEffectConfig = { globalTransitionDuration: 0.5 };
    const run = await runWorkerOnce({ type: 'init', runId: 'neg-run', segments: [segment], assets: [asset], config, width: WIDTH, height: HEIGHT, fps: FPS });
    if (!run.done) throw new Error('negative-test setup: worker run did not complete (' + JSON.stringify(run) + ')');
    const goodFrames = run.done.frameCount;

    for (const c of run.chunks) {
      // eslint-disable-next-line no-await-in-loop
      await ffmpeg.appendFileRaw('good_piece.h264', new Uint8Array(c.bytes));
    }
    const truncatedChunks = run.chunks.slice(0, Math.floor(run.chunks.length / 2));
    for (const c of truncatedChunks) {
      // eslint-disable-next-line no-await-in-loop
      await ffmpeg.appendFileRaw('bad_piece.h264', new Uint8Array(c.bytes));
    }
    // Expected total assumes BOTH pieces are whole (good's real frame count
    // twice, since both pieces came from the identical source run) — the
    // guard's job is to notice that `bad_piece.h264` is NOT actually whole.
    const expectedFrames = goodFrames * 2;

    let actualFrames = -1;
    let tripMechanism: ConcatGuardNegativeResult['tripMechanism'] = 'none';
    let concatError: string | undefined;
    try {
      await ffmpeg.concatAnnexbPieces(['good_piece.h264', 'bad_piece.h264'], 'video_all_corrupt.h264');
      const rawBytes = await ffmpeg.readFile('video_all_corrupt.h264');
      const bytes = typeof rawBytes === 'string' ? new TextEncoder().encode(rawBytes) : rawBytes;
      actualFrames = countAnnexbFrames(bytes);
    } catch (e) {
      tripMechanism = 'ffmpeg-concat-threw';
      concatError = e instanceof Error ? e.message : String(e);
    }
    if (tripMechanism === 'none' && actualFrames !== expectedFrames) tripMechanism = 'frame-count-mismatch';
    const guardTripped = tripMechanism !== 'none';

    log(
      `Negative test: goodFrames=${goodFrames}, expectedFrames(good+would-be-whole-bad)=${expectedFrames}, ` +
        `actualFrames(after truncation)=${actualFrames}, tripMechanism=${tripMechanism}, guardTripped=${guardTripped}`,
    );
    if (concatError) log(`Negative test: ffmpeg concat/probe threw: ${concatError}`);

    return { ran: true, goodFrames, expectedFrames, actualFrames, guardTripped, tripMechanism, concatError };
  } finally {
    await ffmpeg.destroy();
    log('Negative-test session destroyed.');
  }
}

// ---------------------------------------------------------------------------
// Step 6 — GL text renderer verification (docs/webcodecs-export-plan.md
// §4.3/§5), against the SAME text-augmented mixed project (buildMixedProject
// — see the Step 6 comments on segA/segB/MIXED_PROJECT_GLOBAL_TEXT_LAYER/
// MIXED_PROJECT_HEADING above). Two parts:
//
//   1. TEXT RENDERING PARITY — segment-level elements (segA's body caption,
//      segB's extraOverlay) are fully self-specified per TextOverlay/
//      overlayConfig (no project-level fallback involved), so they get an
//      end-to-end check for FREE through the REAL, unmodified
//      exportPipelineWebCodecs.ts A/B compare (runStep5MixedAbCompare,
//      already run by Step 5 — summarizeTextParityFromStep5 below just
//      re-reads its existing per-checkpoint results with text-aware
//      commentary). Project-level elements (the global text layer, the
//      heading) do NOT get exercised that way today — see
//      runStep6TextSupplementalCheck's own doc comment for why — so they're
//      verified by driving exportWorker.ts directly instead.
//
//   2. hiddenOnSegments — proven by comparing the SAME direct-worker run
//      twice: once with the fixture's real `hiddenOnSegments: ['seg-b']`,
//      once with that layer forced visible everywhere. A real difference at
//      seg-b's own checkpoint proves genuine suppression, not coincidental
//      absence.
//
// runStep6PreviewProxyCompare (further below) is the Step 5 carry-forward
// re-verification (plan §11.2): is the Step 5 A/B legacy-vs-export mismatch
// at segment B genuinely "GL-vs-canvas divergence, not a bug" — checked by
// comparing export's B-mid frame against the SAME shared GL primitives
// (GlCompositor/compositeParams/uvRect) driven directly, standing in for a
// full PreviewStage mount (see that function's own doc comment for why).
// ---------------------------------------------------------------------------

interface TextCheckpointResult {
  label: string;
  t: number;
  compare: FrameCompareResult | null;
  errors: string[];
}

/** Extracts the same timestamp from two different (ffmpeg session, file)
 *  pairs and compares them — the same primitive compareCheckpointWithWindowSearch
 *  uses internally, but WITHOUT the ±2-frame window search (Step 6's fixture
 *  checkpoints are not adjacent to a GOP/tier boundary the way Step 5's are,
 *  so an exact-timestamp compare is the more precise, and simpler, check
 *  here). */
async function compareOneFrame(
  ffmpegA: TauriFfmpeg,
  fileA: string,
  ffmpegB: TauriFfmpeg,
  fileB: string,
  t: number,
  width: number,
  height: number,
  tag: string,
): Promise<{ compare: FrameCompareResult | null; errors: string[]; bytesB: Uint8Array | null }> {
  const errors: string[] = [];
  let bytesA: Uint8Array | null = null;
  let bytesB: Uint8Array | null = null;
  try {
    bytesA = await extractRgbaFrameViaFfmpeg(ffmpegA, fileA, t, width, height, `${tag}_a_${Math.round(t * 1000)}.rgba`);
  } catch (e) {
    errors.push(`side A extract: ${fullErrorText(e)}`);
  }
  try {
    bytesB = await extractRgbaFrameViaFfmpeg(ffmpegB, fileB, t, width, height, `${tag}_b_${Math.round(t * 1000)}.rgba`);
  } catch (e) {
    errors.push(`side B extract: ${fullErrorText(e)}`);
  }
  if (!bytesA || !bytesB) return { compare: null, errors, bytesB };
  return { compare: compareRgbaBuffers(bytesA, bytesB), errors, bytesB };
}

/** Re-reads runStep5MixedAbCompare's ALREADY-COMPUTED per-checkpoint results
 *  (Step 5 ran the real exportPipelineWebCodecs.ts A/B compare against the
 *  SAME project this step added text to — no re-export needed) and logs a
 *  text-focused summary, including the expected transition-midpoint
 *  divergence called out in resolveTextSegment's own doc comment
 *  (exportWorker.ts). */
function summarizeTextParityFromStep5(step5Ab: Step5AbResult): void {
  const labels = new Set([
    'A start (t=0.1)',
    'A mid, pre-transition (t=1.0)',
    'A-B cross-dissolve midpoint (t=2.0, boundary)',
    'B mid, post-transition (t=2.75)',
  ]);
  log(
    '--- Text rendering parity via the REAL exportPipelineWebCodecs.ts orchestrator ' +
      '(segment-level body caption [A] + extraOverlay [B], AND — as of the Step 6 amendment Part B fix — ' +
      'project-level headings/global text layers, since driveGlRun now threads fontConfigs/globalOverlayConfig/' +
      'textLayers/headings from the real project onto the worker init message. Stale note removed: this used to ' +
      'say project-level text was NOT threaded through; runStep7ProjectLevelTextPresenceCheck below isolates that ' +
      'specific claim with a with/without-text-data A/B, since these mixed-project numbers alone are confounded by ' +
      'the pre-existing zoom-animation frame-offset issue at A-start/A-mid — see that function and runStep6TextSupplementalCheck) ---',
  );
  for (const c of step5Ab.checks) {
    if (!labels.has(c.label)) continue;
    if (!c.compare) {
      log(`  [TEXT ${c.label}] no comparison available (extract error — see the Step 5 section above)`);
      continue;
    }
    const note = c.label.includes('t=2.0')
      ? ' — EXPECTED partial mismatch: at the exact transition midpoint the GL text pass SNAPS from segment A\'s ' +
        'text to segment B\'s (matching the existing grade midpoint-snap precedent in compositeParams.ts), while ' +
        'legacy BLENDS both segments\' fully-texted canvases via the transition alpha — a real, documented ' +
        'divergence (see resolveTextSegment\'s doc comment in exportWorker.ts), not a bug.'
      : '';
    log(`  [TEXT ${c.label}] matchPct=${c.compare.matchPct.toFixed(1)}%${note}`);
  }
}

// ---------------------------------------------------------------------------
// Step 7 (Step 6 amendment, 2026-07-21, Part B re-verification) — isolates
// ONE specific claim: does a project-level HEADING now actually render on a
// GL segment through the REAL exportPipelineWebCodecs.ts orchestrator (not
// the direct-worker bypass runStep6TextSupplementalCheck uses)? The mixed-
// project A-start/A-mid numbers above can't answer this cleanly — they're
// dominated by the pre-existing zoom-animation frame-offset confounder
// (bestLegacyOffsetFrames/bestNewOffsetFrames differing by up to 4 frames in
// the ±2 window search), which would produce a low match regardless of
// whether the heading renders.
//
// This uses a MUCH more robust signal than per-pixel matchPct: the fixture
// heading's `backgroundColor` (buildHeadingTextAtlas / drawHeadingLayerOverlay)
// is a FULL-FRAME solid-color fill, drawn BEFORE the heading text — so if it
// renders, EVERY pixel in the frame shifts toward that color, alpha-blended.
// A single, static (animation NONE, transition NONE) 1-segment image project
// means the two variants (with vs without the heading) are pixel-identical
// EXCEPT for that fill — no zoom motion, no frame-offset ambiguity, and mean
// frame color is immune to a few pixels of AA/encode noise the way an exact
// per-pixel match threshold is not.
// ---------------------------------------------------------------------------

interface ProjectLevelTextPresenceResult {
  ran: boolean;
  error: string | null;
  withHeadingMeanRgb: [number, number, number] | null;
  withoutHeadingMeanRgb: [number, number, number] | null;
  /** Expected direction: WITH should be measurably closer to the heading's
   *  own backgroundColor (10,10,45) than WITHOUT is — i.e. darker and bluer. */
  headingRenders: boolean | null;
}

function meanRgb(bytes: Uint8Array): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 2 < bytes.length; i += 4) {
    r += bytes[i]!;
    g += bytes[i + 1]!;
    b += bytes[i + 2]!;
    n++;
  }
  return n > 0 ? [r / n, g / n, b / n] : [0, 0, 0];
}

async function buildSingleImageProject(withHeading: boolean): Promise<Project> {
  const blob = await makeColorImageBlob('#66cc99', withHeading ? 'WITH' : 'NO-HEADING', WIDTH, HEIGHT);
  const asset: Asset = { id: 'img-1', name: 'swatch.png', url: URL.createObjectURL(blob), type: 'image' };
  const seg: VideoSegment = {
    id: 'seg-only', text: '', assetId: asset.id,
    startTime: 0, duration: 1,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0,
  };
  return {
    id: `step7-${withHeading ? 'with' : 'without'}-heading`,
    name: 'Step 7 project-level text presence probe',
    script: '', sceneDetails: '',
    segments: [seg],
    assets: [asset],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.6)', fontFamily: 'sans-serif' },
    textLayers: [],
    headings: withHeading ? [{ ...MIXED_PROJECT_HEADING, id: 'heading-probe' }] : [],
  };
}

async function runStep7ProjectLevelTextPresenceCheck(): Promise<ProjectLevelTextPresenceResult> {
  log('--- Step 7: project-level heading presence via the REAL orchestrator (with vs without heading data) ---');
  const result: ProjectLevelTextPresenceResult = { ran: false, error: null, withHeadingMeanRgb: null, withoutHeadingMeanRgb: null, headingRenders: null };
  try {
    const withProject = await buildSingleImageProject(true);
    const withoutProject = await buildSingleImageProject(false);

    const withFfmpeg = await TauriFfmpeg.create();
    const withoutFfmpeg = await TauriFfmpeg.create();
    try {
      const withResult = await exportProjectWebCodecs(withProject, withFfmpeg, { fps: FPS, width: WIDTH, height: HEIGHT });
      if (!withResult.ok) throw new Error('with-heading export failed: ' + JSON.stringify(withResult.error));
      const withoutResult = await exportProjectWebCodecs(withoutProject, withoutFfmpeg, { fps: FPS, width: WIDTH, height: HEIGHT });
      if (!withoutResult.ok) throw new Error('without-heading export failed: ' + JSON.stringify(withoutResult.error));

      const withBytes = await extractRgbaFrameViaFfmpeg(withFfmpeg, withResult.outputFile, 0.5, WIDTH, HEIGHT, 'step7_with.rgba');
      const withoutBytes = await extractRgbaFrameViaFfmpeg(withoutFfmpeg, withoutResult.outputFile, 0.5, WIDTH, HEIGHT, 'step7_without.rgba');

      const withRgb = meanRgb(withBytes);
      const withoutRgb = meanRgb(withoutBytes);
      result.withHeadingMeanRgb = withRgb;
      result.withoutHeadingMeanRgb = withoutRgb;

      // Heading backgroundColor is rgba(10,10,45,0.55) — a dark navy fill.
      // If it rendered, WITH's mean color should sit measurably closer to
      // (10,10,45) than WITHOUT's does, on every channel that matters (R,G
      // both very low in the fill color; the swatch itself is '#66cc99' —
      // R=102,G=204,B=153 — so a real fill pulls R and G down substantially).
      const distWith = Math.hypot(withRgb[0] - 10, withRgb[1] - 10, withRgb[2] - 45);
      const distWithout = Math.hypot(withoutRgb[0] - 10, withoutRgb[1] - 10, withoutRgb[2] - 45);
      result.headingRenders = distWith < distWithout && withRgb[0] < withoutRgb[0] - 10 && withRgb[1] < withoutRgb[1] - 10;

      log(
        `  WITH heading: meanRGB=(${withRgb.map((v) => v.toFixed(1)).join(',')}) distToFillColor=${distWith.toFixed(1)}; ` +
          `WITHOUT heading: meanRGB=(${withoutRgb.map((v) => v.toFixed(1)).join(',')}) distToFillColor=${distWithout.toFixed(1)} ` +
          `-> headingRenders=${result.headingRenders} (expect true: WITH must be darker/bluer than WITHOUT)`,
      );
      result.ran = true;
    } finally {
      await withFfmpeg.destroy();
      await withoutFfmpeg.destroy();
    }
  } catch (e) {
    result.error = fullErrorText(e);
    log('Step 7 FAILED: ' + result.error);
  }
  return result;
}

interface Step6RendererCheckResult {
  ranAtAll: boolean;
  error: string | null;
  legacyOutputFile: string | null;
  newOutputFile: string | null;
  forcedVisibleOutputFile: string | null;
  headingAtStartVsLegacy: TextCheckpointResult | null;
  headingAtMidVsLegacy: TextCheckpointResult | null;
  hiddenOnBVsLegacy: TextCheckpointResult | null;
  hiddenOnBVsForcedVisible: TextCheckpointResult | null;
  /** Raw RGBA bytes of the "new" (direct-worker, real hiddenOnSegments)
   *  pipeline's frame at t=2.75 — handed to runStep6PreviewProxyCompare so
   *  it doesn't need a third redundant export+mux pass for the same frame. */
  newFrameAt275: Uint8Array | null;
}

/**
 * Drives exportWorker.ts DIRECTLY (bypassing exportPipelineWebCodecs.ts) —
 * REQUIRED because that orchestrator's `driveGlRun` call does not yet
 * populate `fontConfigs`/`globalOverlayConfig`/`textLayers`/`headings` on
 * the init message it sends the worker (confirmed by reading
 * exportPipelineWebCodecs.ts's Part 3 `driveGlRun` — `initMsg` there is
 * `{ type: 'init', runId, segments, assets, config, width, height, fps }`,
 * none of the Step 6 fields). That file is explicitly OUT OF SCOPE for this
 * step (see the Step 6 report's confirmation list) — so today, a GL segment
 * exported through the real, full pipeline renders its body caption and
 * extraOverlays correctly (both fully self-specified, no project-level
 * fallback needed — see buildMixedProject's own comment) but NEVER renders
 * a project-level global text layer or a Path B heading, even though
 * GLTextRenderer itself implements both. This function proves the RENDERER
 * is correct by supplying those fields by hand; wiring
 * exportPipelineWebCodecs.ts to do so for real is flagged as follow-up work,
 * not attempted here.
 */
async function runStep6TextSupplementalCheck(): Promise<Step6RendererCheckResult> {
  log('--- Step 6: GL text renderer direct-worker verification (heading + global-layer + hiddenOnSegments) ---');
  log(
    'Driving exportWorker.ts DIRECTLY with fontConfigs/globalOverlayConfig/textLayers/headings manually ' +
      "populated in the init message — exportPipelineWebCodecs.ts does NOT yet thread these fields through " +
      '(documented gap, out of Step 6 scope; see the Step 6 report) so this is the only way today to exercise ' +
      "GLTextRenderer's heading and global-text-layer code paths end to end.",
  );
  const result: Step6RendererCheckResult = {
    ranAtAll: false,
    error: null,
    legacyOutputFile: null,
    newOutputFile: null,
    forcedVisibleOutputFile: null,
    headingAtStartVsLegacy: null,
    headingAtMidVsLegacy: null,
    hiddenOnBVsLegacy: null,
    hiddenOnBVsForcedVisible: null,
    newFrameAt275: null,
  };

  const project = await buildMixedProject();
  const segA = project.segments[0]!;
  const segB = project.segments[1]!;
  const assetMap = new Map(project.assets.map((a) => [a.id, a]));
  const referencedAssets = [assetMap.get(segA.assetId!)!, assetMap.get(segB.assetId!)!];
  const config: ProjectEffectConfig = { globalTransition: project.globalTransition, globalTransitionDuration: project.globalTransitionDuration };

  const legacyFfmpeg = await TauriFfmpeg.create();
  const newFfmpeg = await TauriFfmpeg.create();
  try {
    let legacyOutputFile: string;
    try {
      const legacyResult = await exportProject(project, legacyFfmpeg, { fps: FPS, width: WIDTH, height: HEIGHT });
      if (!legacyResult.ok) throw new Error('legacy export returned ok:false — ' + JSON.stringify(legacyResult.error));
      legacyOutputFile = legacyResult.outputFile;
    } catch (e) {
      throw new Error('legacy reference export failed: ' + fullErrorText(e));
    }
    result.legacyOutputFile = legacyOutputFile;

    // --- Direct-worker A-B run, WITH the fixture's real hiddenOnSegments ---
    const normalInit: ExportWorkerInitMessage = {
      type: 'init',
      runId: 'step6-normal',
      segments: [segA, segB],
      assets: referencedAssets,
      config,
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      fontConfigs: [], // 'sans-serif' everywhere in this fixture — no FontFace load needed
      globalOverlayConfig: project.globalOverlayConfig,
      textLayers: project.textLayers,
      headings: project.headings,
    };
    const normalRun = await runWorkerOnce(normalInit);
    if (!normalRun.done) throw new Error('direct-worker "normal" run did not complete: ' + JSON.stringify({ cancelled: normalRun.cancelled, runDone: normalRun.runDone }));
    for (const c of normalRun.chunks) {
      // eslint-disable-next-line no-await-in-loop
      await newFfmpeg.appendFileRaw('step6_normal.h264', new Uint8Array(c.bytes));
    }
    await muxOnly(newFfmpeg, 'step6-normal-session', 'step6_normal.h264', null, 'step6_normal.mp4', FPS);
    result.newOutputFile = 'step6_normal.mp4';
    log(`Direct-worker "normal" run: ${normalRun.chunks.length} chunks, frameCount=${normalRun.done.frameCount}, muxed -> step6_normal.mp4`);

    // --- Same run, with the global layer's hiddenOnSegments stripped (forced visible everywhere) ---
    const forcedLayer: TextOverlay = { ...MIXED_PROJECT_GLOBAL_TEXT_LAYER, hiddenOnSegments: [] };
    const forcedInit: ExportWorkerInitMessage = { ...normalInit, runId: 'step6-forced', textLayers: [forcedLayer] };
    const forcedRun = await runWorkerOnce(forcedInit);
    if (!forcedRun.done) throw new Error('direct-worker "forced-visible" run did not complete: ' + JSON.stringify({ cancelled: forcedRun.cancelled, runDone: forcedRun.runDone }));
    for (const c of forcedRun.chunks) {
      // eslint-disable-next-line no-await-in-loop
      await newFfmpeg.appendFileRaw('step6_forced.h264', new Uint8Array(c.bytes));
    }
    await muxOnly(newFfmpeg, 'step6-forced-session', 'step6_forced.h264', null, 'step6_forced.mp4', FPS);
    result.forcedVisibleOutputFile = 'step6_forced.mp4';
    log(`Direct-worker "forced-visible" run: ${forcedRun.chunks.length} chunks, frameCount=${forcedRun.done.frameCount}, muxed -> step6_forced.mp4`);

    // --- Checkpoint compares ---
    const headingStart = await compareOneFrame(legacyFfmpeg, legacyOutputFile, newFfmpeg, result.newOutputFile, 0.1, WIDTH, HEIGHT, 'heading_start');
    result.headingAtStartVsLegacy = { label: 'A start, heading+globalLayer+caption active (t=0.1)', t: 0.1, compare: headingStart.compare, errors: headingStart.errors };
    log(
      `  [heading+layer+caption @0.1s, new(direct-worker) vs legacy] matchPct=${headingStart.compare?.matchPct.toFixed(1)}% ` +
        `meanDiff(R,G,B)=(${headingStart.compare?.meanDiffR.toFixed(2)},${headingStart.compare?.meanDiffG.toFixed(2)},${headingStart.compare?.meanDiffB.toFixed(2)}) ` +
        `maxDiff(R,G,B)=(${headingStart.compare?.maxDiffR},${headingStart.compare?.maxDiffG},${headingStart.compare?.maxDiffB}) errors=${headingStart.errors.join(' | ')}`,
    );

    const headingMid = await compareOneFrame(legacyFfmpeg, legacyOutputFile, newFfmpeg, result.newOutputFile, 1.0, WIDTH, HEIGHT, 'heading_mid');
    result.headingAtMidVsLegacy = { label: 'A mid, heading+globalLayer+caption active (t=1.0)', t: 1.0, compare: headingMid.compare, errors: headingMid.errors };
    log(
      `  [heading+layer+caption @1.0s, new(direct-worker) vs legacy] matchPct=${headingMid.compare?.matchPct.toFixed(1)}% ` +
        `meanDiff(R,G,B)=(${headingMid.compare?.meanDiffR.toFixed(2)},${headingMid.compare?.meanDiffG.toFixed(2)},${headingMid.compare?.meanDiffB.toFixed(2)}) ` +
        `maxDiff(R,G,B)=(${headingMid.compare?.maxDiffR},${headingMid.compare?.maxDiffG},${headingMid.compare?.maxDiffB}) errors=${headingMid.errors.join(' | ')}`,
    );

    const hiddenVsLegacy = await compareOneFrame(legacyFfmpeg, legacyOutputFile, newFfmpeg, result.newOutputFile, 2.75, WIDTH, HEIGHT, 'hidden_vs_legacy');
    result.hiddenOnBVsLegacy = {
      label: 'B mid, globalLayer HIDDEN on seg-b (t=2.75), new(direct-worker,real hiddenOnSegments) vs legacy',
      t: 2.75,
      compare: hiddenVsLegacy.compare,
      errors: hiddenVsLegacy.errors,
    };
    result.newFrameAt275 = hiddenVsLegacy.bytesB;
    log(
      `  [hiddenOnSegments @2.75s, new(direct-worker,hidden) vs legacy(also never shows it on B)] matchPct=${hiddenVsLegacy.compare?.matchPct.toFixed(1)}% ` +
        `meanDiff(R,G,B)=(${hiddenVsLegacy.compare?.meanDiffR.toFixed(2)},${hiddenVsLegacy.compare?.meanDiffG.toFixed(2)},${hiddenVsLegacy.compare?.meanDiffB.toFixed(2)}) errors=${hiddenVsLegacy.errors.join(' | ')}`,
    );

    const hiddenVsForced = await compareOneFrame(newFfmpeg, result.newOutputFile, newFfmpeg, result.forcedVisibleOutputFile, 2.75, WIDTH, HEIGHT, 'hidden_vs_forced');
    result.hiddenOnBVsForcedVisible = {
      label: 'B mid (t=2.75): real-hidden run vs forced-visible run — LOW match expected (proves genuine suppression)',
      t: 2.75,
      compare: hiddenVsForced.compare,
      errors: hiddenVsForced.errors,
    };
    log(
      `  [hiddenOnSegments PROOF @2.75s, hidden-run vs forced-visible-run — EXPECT LOW MATCH] matchPct=${hiddenVsForced.compare?.matchPct.toFixed(1)}% ` +
        `meanDiff(R,G,B)=(${hiddenVsForced.compare?.meanDiffR.toFixed(2)},${hiddenVsForced.compare?.meanDiffG.toFixed(2)},${hiddenVsForced.compare?.meanDiffB.toFixed(2)}) errors=${hiddenVsForced.errors.join(' | ')}`,
    );

    result.ranAtAll = true;
  } catch (e) {
    result.error = fullErrorText(e);
    log('Step 6 renderer check FAILED: ' + result.error);
  } finally {
    await legacyFfmpeg.destroy();
    await newFfmpeg.destroy();
  }
  return result;
}

interface PreviewProxyResult {
  ran: boolean;
  error: string | null;
  compare: FrameCompareResult | null;
}

/**
 * Step 5's own carry-forward analysis (docs/webcodecs-export-plan.md §11.2)
 * says the real parity gate for GL segments is PREVIEW vs export, not
 * legacy vs export — both share the SAME GlCompositor/compositeParams/
 * uvRect code. Driving the real React preview stage (useGlPreview.ts,
 * mounted inside the full App component tree with its IndexedDB-backed
 * asset store and project state) from this standalone dev-spike HTML page
 * is impractical: it would mean bootstrapping the entire app around a
 * synthetic project just to read back one canvas's pixels once.
 *
 * ALTERNATIVE (this function): drive the SAME PRODUCTION PRIMITIVES
 * useGlPreview.ts itself calls — GlCompositor, deriveCompositeParams/
 * deriveSlotPlan, and the object-cover uvRect helper — directly, on the
 * main thread, against a plain `<canvas>`/`acquireGlContext`. The parity
 * claim plan §11.2 actually makes ("identical to preview by construction —
 * same compositor, same params") is a claim about these SHARED MODULES, so
 * exercising them directly is a faithful proxy for "does the export worker
 * drive the same GL math the same way preview does" — arguably MORE
 * targeted than screenshotting a live React tree, since it isolates the
 * shared compositing code from every other thing that differs between a
 * worker and a mounted React component (timing, DOM, React state).
 *
 * Preview itself uses object-CONTAIN, not export's object-COVER (D11 /
 * plan §4.5) — a pre-existing, deliberate, already-accepted divergence. This
 * proxy uses COVER (matching export) so the comparison isolates the
 * transition/zoom/grade math plan §11.2 is actually claiming parity for,
 * rather than re-litigating the orthogonal contain-vs-cover fit decision.
 */
async function runStep6PreviewProxyCompare(
  exportFrameAt275: Uint8Array,
  segB: VideoSegment,
  imageAssetB: Asset,
  width: number,
  height: number,
): Promise<PreviewProxyResult> {
  log('--- Step 5 carry-forward: preview-PROXY vs export frame-compare at B-mid (t=2.75) ---');
  log(
    'Driving the real GlCompositor + compositeParams + uvRect primitives directly on the main thread ' +
      "(the shared modules preview's useGlPreview.ts itself calls) rather than the full React app — see this " +
      "function's own doc comment for why mounting the real PreviewStage from this standalone spike page is impractical.",
  );
  const result: PreviewProxyResult = { ran: false, error: null, compare: null };
  let compositor: GlCompositor | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const gl = acquireGlContext(canvas, { preserveDrawingBuffer: true });
    if (!gl) throw new Error('acquireGlContext returned null (WebGL2 unavailable on the main thread)');
    compositor = new GlCompositor(gl);

    const config: ProjectEffectConfig = { globalTransitionDuration: 0.5 };
    // Single-segment array: no adjacent segment means resolveActiveBoundary
    // finds no transition partner, matching the real B-mid checkpoint (no
    // transition is active at t=2.75 — the A-B dissolve window is
    // [1.75,2.25], long over by then).
    const rawParams = deriveCompositeParams([segB], 2.75, config);
    const plan = deriveSlotPlan([segB], 2.75, rawParams.transition, config);
    if (!plan.a) throw new Error('deriveSlotPlan found no containing segment at t=2.75 for [segB] — unexpected, segB spans [2,3.5)');

    const resp = await fetch(imageAssetB.url);
    if (!resp.ok) throw new Error(`fetch(${imageAssetB.url}) failed: ${resp.status}`);
    const bmp = await createImageBitmap(await resp.blob());
    const texRect = computeObjectCoverUvRect(bmp.width, bmp.height, width, height);
    compositor.uploadFrame('a', bmp, texRect);
    compositor.renderFrame(rawParams);

    gl.finish();
    // Deliberately NOT a raw gl.readPixels + manual row-flip — that reads the
    // framebuffer's internal (bottom-up, GL window-space) byte order directly
    // and requires getting a flip exactly right by hand. Instead this reuses
    // the SAME canvas-to-canvas compositing approach this file's own
    // decodeMp4TrackAndCheck/verifyAnnexbDecodable functions already use for
    // VideoFrame->2D readback: `drawImage(glCanvas, ...)` asks the BROWSER to
    // composite the WebGL canvas's PRESENTED (already correctly-oriented, the
    // same bitmap a user would see on screen) image onto a plain 2D context,
    // sidestepping the framebuffer-orientation question entirely rather than
    // re-deriving it by hand.
    const readback = document.createElement('canvas');
    readback.width = width;
    readback.height = height;
    const readCtx = readback.getContext('2d');
    if (!readCtx) throw new Error('2D context unavailable for GL canvas readback');
    readCtx.drawImage(canvas, 0, 0, width, height);
    const rgba = new Uint8Array(readCtx.getImageData(0, 0, width, height).data.buffer);

    const compare = compareRgbaBuffers(rgba, exportFrameAt275);
    result.compare = compare;
    result.ran = true;
    log(
      `  [preview-proxy vs export @2.75s] matchPct=${compare.matchPct.toFixed(1)}% ` +
        `meanDiff(R,G,B)=(${compare.meanDiffR.toFixed(2)},${compare.meanDiffG.toFixed(2)},${compare.meanDiffB.toFixed(2)}) ` +
        `maxDiff(R,G,B)=(${compare.maxDiffR},${compare.maxDiffG},${compare.maxDiffB})`,
    );
  } catch (e) {
    result.error = fullErrorText(e);
    log('Preview-proxy compare FAILED: ' + result.error);
  } finally {
    compositor?.dispose();
  }
  return result;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const el = document.getElementById('log');
  if (el) el.textContent = '';
  log('Step 3 spike starting...');
  const runtimeIsTauri = isTauri();
  log(`Runtime: ${runtimeIsTauri ? 'Tauri WebView (real IPC available)' : 'Chromium proxy via Vite dev server (no Tauri IPC — disk-append/ffmpeg-probe steps will be skipped, decode round-trip still runs for real)'}`);
  log(`navigator.userAgent: ${navigator.userAgent}`);
  void exfil('runtime', { userAgent: navigator.userAgent, isTauri: runtimeIsTauri });

  const result: Record<string, unknown> = { userAgent: navigator.userAgent, isTauri: runtimeIsTauri };
  try {
    const resp = await fetch(SAMPLE_URL);
    if (!resp.ok) {
      throw new Error(`could not fetch ${SAMPLE_URL} (${resp.status}) — re-provision it per the Phase 0 spike (see buildScaleFixture.ts's doc comment)`);
    }
    const blob = await resp.blob();
    const assetUrl = URL.createObjectURL(blob);
    log(`Loaded ${SAMPLE_URL} (${blob.size} bytes) -> blob URL ${assetUrl}`);

    const asset: Asset = { id: 'asset-1', name: 'sample.mp4', url: assetUrl, type: 'video' };
    const segment: VideoSegment = {
      id: 'seg-1',
      text: '',
      assetId: asset.id,
      startTime: 0,
      duration: SEGMENT_DURATION,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: 0,
      trimStart: 0,
      trimEnd: SEGMENT_DURATION,
    };
    const config: ProjectEffectConfig = { globalTransitionDuration: 0.5 };
    const expectedFrames = Math.round(SEGMENT_DURATION * FPS);

    // --- Run 1: full run, no cancel ---
    log(`Run 1 (full encode): ${WIDTH}x${HEIGHT} @ ${FPS}fps, ${SEGMENT_DURATION}s segment, expecting ~${expectedFrames} frames...`);
    const wallStart = performance.now();
    const run1 = await runWorkerOnce({ type: 'init', runId: 'run_0', segments: [segment], assets: [asset], config, width: WIDTH, height: HEIGHT, fps: FPS });
    const wallMs = performance.now() - wallStart;
    log(
      `Run 1: done.frameCount=${run1.done?.frameCount}, run-done.frameCount=${run1.runDone?.frameCount}, ` +
        `chunksEmitted=${run1.chunks.length}, wall=${wallMs.toFixed(0)}ms`,
    );
    result.run1Meta = { done: run1.done, runDone: run1.runDone, chunksEmitted: run1.chunks.length, wallMs };

    const frameCountMatches = run1.done?.frameCount === expectedFrames && run1.chunks.length === run1.done?.frameCount;
    log(`Frame count check: expected=${expectedFrames} actual(done)=${run1.done?.frameCount} chunksEmitted=${run1.chunks.length} — match=${frameCountMatches}`);

    const keyChunks = run1.chunks.filter((c) => c.chunkType === 'key').length;
    log(`Chunk types: ${keyChunks} key / ${run1.chunks.length - keyChunks} delta. First chunk type: ${run1.chunks[0]?.chunkType} (must be 'key' — frame 0 of a segment is always forced)`);
    result.chunkTypeCheck = { keyChunks, total: run1.chunks.length, firstIsKey: run1.chunks[0]?.chunkType === 'key' };

    // Timestamp formula check (plan §7.1): Math.round(N*1e6/fps), not the
    // drifting N*Math.round(1e6/fps). Compare every chunk's timestamp.
    let maxTimestampDeltaUs = 0;
    run1.chunks.forEach((c, i) => {
      const expected = Math.round((i * 1_000_000) / FPS);
      const delta = Math.abs(c.timestamp - expected);
      if (delta > maxTimestampDeltaUs) maxTimestampDeltaUs = delta;
    });
    log(`Timestamp formula check: max |actual - Math.round(i*1e6/fps)| across ${run1.chunks.length} chunks = ${maxTimestampDeltaUs}us (expect 0, encoder must preserve input VideoFrame timestamps exactly)`);
    result.timestampCheck = { maxTimestampDeltaUs };

    // encodeQueueSize trajectory
    const maxQueueSize = run1.queueSamples.reduce((m, s) => Math.max(m, s.size), 0);
    log(`encodeQueueSize trajectory (${run1.queueSamples.length} samples, every 5th frame): max=${maxQueueSize}, samples=[${run1.queueSamples.map((s) => s.size).join(',')}]`);
    result.queueTrajectory = { maxQueueSize, samples: run1.queueSamples };

    // --- Annexb decode round-trip: the ffprobe-equivalent check ---
    log('Verifying the concatenated chunk stream decodes via a fresh VideoDecoder configured avc:{format:"annexb"}...');
    const decodeResult = await verifyAnnexbDecodable(run1.chunks, WIDTH, HEIGHT);
    log(
      `Decode round-trip: decodedFrameCount=${decodeResult.decodedFrameCount} (expected ${expectedFrames}), ` +
        `decodeErrors=${decodeResult.decodeErrors.length}, totalBytes=${decodeResult.totalBytes}, ` +
        `firstFrameLuma=${decodeResult.firstFrameLuma?.toFixed(1)}`,
    );
    if (decodeResult.decodeErrors.length > 0) log('Decode errors: ' + decodeResult.decodeErrors.join(' | '));
    if (decodeResult.firstFrameImageData) drawToVisibleCanvas('worker-canvas', decodeResult.firstFrameImageData);
    // firstFrameImageData omitted from result/exfil — a 640x480 ImageData's
    // Uint8ClampedArray would serialize to megabytes of JSON text; the luma
    // scalar is what the report actually needs.
    const { firstFrameImageData: _unused, ...decodeResultForResult } = decodeResult;
    void _unused;
    result.decodeRoundTrip = decodeResultForResult;

    const decodedDurationSec = decodeResult.decodedFrameCount / FPS;
    log(`Implied duration from decoded frame count: ${decodedDurationSec.toFixed(3)}s (expected ${SEGMENT_DURATION}s, tolerance ±1 frame = ±${(1 / FPS).toFixed(3)}s)`);
    const durationOk = Math.abs(decodedDurationSec - SEGMENT_DURATION) <= 1 / FPS;

    // --- Cancel test: fresh run, cancel after a few chunks ---
    log(`Run 2 (cancel test): sending 'cancel' after ${CANCEL_AFTER_CHUNKS} chunks...`);
    const run2 = await runWorkerOnce(
      { type: 'init', runId: 'run_cancel', segments: [segment], assets: [asset], config, width: WIDTH, height: HEIGHT, fps: FPS },
      { cancelAfterChunks: CANCEL_AFTER_CHUNKS },
    );
    log(`Run 2: cancelled=${run2.cancelled}, chunksReceivedBeforeStop=${run2.chunks.length}, done=${JSON.stringify(run2.done)}`);
    result.cancelTest = { cancelled: run2.cancelled, chunksReceived: run2.chunks.length, done: run2.done };
    const cancelOk = run2.cancelled === true && run2.done === null;

    // --- Tauri-only real IPC verification (guarded) ---
    let diskOk = true;
    let orphanOk = true;
    let muxOk = true;
    if (runtimeIsTauri) {
      const diskResult = await verifyViaTauriDiskAppend(run1.chunks);
      result.diskVerification = diskResult;
      diskOk = diskResult.sizeMatches && diskResult.byteIdentical === true && diskResult.nullDecodeExitCode === 0;

      const orphanResult = await verifyCancelLeavesNoOrphan(run2);
      result.cancelOrphanCheck = orphanResult;
      orphanOk = orphanResult.skipped || (orphanResult.firstDestroyOk && orphanResult.secondDestroyOk);

      // Step 4 — real muxOnly() verification (with-audio + no-audio cases).
      const muxResult = await verifyMuxOnlyStep4(run1.chunks, FPS, expectedFrames, SEGMENT_DURATION);
      result.step4MuxVerification = muxResult;
      muxOk =
        muxResult.ranAtAll &&
        muxResult.withAudio !== null &&
        muxResult.withAudio.frameCountMatches &&
        muxResult.withAudio.durationOk &&
        muxResult.withAudio.audioPresent &&
        muxResult.withAudio.nonBlack &&
        muxResult.withAudio.decodeErrors.length === 0 &&
        muxResult.noAudio !== null &&
        muxResult.noAudio.frameCountMatches &&
        muxResult.noAudio.durationOk &&
        muxResult.noAudio.audioPresent === false;
      log(`Step 4 mux verification overall: ${muxOk ? 'PASS' : 'FAIL — see step4MuxVerification above'}`);

      // Step 5 — full-timeline routing/run-splitting/concat/frame-count-guard
      // verification (mixed project A/B compare + concat-guard negative test).
      // Each half is its own try/catch: a thrown error in either one must
      // still leave everything gathered ABOVE (Step 3/4) and land a real
      // exfil'd result instead of crashing all the way out to main()'s outer
      // catch, which would otherwise silently discard every finding.
      let step5Ok = false;
      try {
        // 600s (was 120s pre-Step-5-gap-fix, then 300s before the wide-
        // window diagnostic was added): the ffmpeg-based window-search
        // extraction issues up to 10 ffmpeg subprocess invocations per
        // checkpoint (5 candidate offsets/side) instead of one WebCodecs
        // decode, PLUS up to 42 more per low-match checkpoint for the
        // diagnostic ±1s wide search — real subprocess spawn overhead adds
        // up, so this needs generous wall-clock headroom.
        const step5Ab = await withTimeout(runStep5MixedAbCompare(), 600_000, 'runStep5MixedAbCompare');
        result.step5AbCompare = step5Ab;
        summarizeTextParityFromStep5(step5Ab);
        const step5Neg = await withTimeout(runConcatGuardNegativeTest(), 60_000, 'runConcatGuardNegativeTest');
        result.step5ConcatGuardNegativeTest = step5Neg;
        const step5DurationOk = Math.abs(step5Ab.newDurationSec - STEP5_TOTAL_DURATION_SEC) <= 1 / FPS;
        step5Ok =
          step5Ab.legacyOk &&
          step5Ab.newOk &&
          step5Ab.frameCompareOk &&
          step5DurationOk &&
          step5Neg.ran &&
          step5Neg.guardTripped;
        log(
          `Step 5 overall: ${step5Ok ? 'PASS' : 'FAIL — see step5AbCompare/step5ConcatGuardNegativeTest above'} ` +
            `(legacyOk=${step5Ab.legacyOk} newOk=${step5Ab.newOk} frameCompareOk=${step5Ab.frameCompareOk} ` +
            `durationOk=${step5DurationOk} negTestRan=${step5Neg.ran} negTestGuardTripped=${step5Neg.guardTripped})`,
        );
      } catch (e) {
        const message = fullErrorText(e);
        result.step5Error = message;
        log('Step 5 verification threw and was caught here (Step 3/4 results above are still valid): ' + message);
      }
      result.step5Ok = step5Ok;

      // Step 6 — GL text renderer verification (docs/webcodecs-export-plan.md
      // §4.3/§5). Own try/catch, same rationale as Step 5's: a failure here
      // must not discard Step 3/4/5's already-gathered, already-exfil-worthy
      // results.
      let step6Ok = false;
      try {
        const step6Renderer = await withTimeout(runStep6TextSupplementalCheck(), 300_000, 'runStep6TextSupplementalCheck');
        result.step6RendererCheck = {
          ranAtAll: step6Renderer.ranAtAll,
          error: step6Renderer.error,
          headingAtStartVsLegacy: step6Renderer.headingAtStartVsLegacy,
          headingAtMidVsLegacy: step6Renderer.headingAtMidVsLegacy,
          hiddenOnBVsLegacy: step6Renderer.hiddenOnBVsLegacy,
          hiddenOnBVsForcedVisible: step6Renderer.hiddenOnBVsForcedVisible,
        };

        let previewProxy: PreviewProxyResult = { ran: false, error: 'skipped — Step 6 renderer check did not produce a t=2.75 frame', compare: null };
        if (step6Renderer.newFrameAt275) {
          const proxyProject = await buildMixedProject();
          const proxySegB = proxyProject.segments[1]!;
          const proxyImageB = proxyProject.assets.find((a) => a.id === proxySegB.assetId)!;
          previewProxy = await withTimeout(
            runStep6PreviewProxyCompare(step6Renderer.newFrameAt275, proxySegB, proxyImageB, WIDTH, HEIGHT),
            60_000,
            'runStep6PreviewProxyCompare',
          );
        } else {
          log('Skipping preview-proxy compare — Step 6 renderer check did not produce a t=2.75 "new" frame (see step6RendererCheck.error above).');
        }
        result.step6PreviewProxyCompare = previewProxy;

        // Text-heavy checkpoints use a lower bar than Step 5's generic 85% —
        // anti-aliased glyph edges (Canvas2D-in-worker vs Canvas2D-in-main-
        // thread rasterization, plan §11.2's own allowance) contribute more
        // per-pixel diff than a flat color/video frame does. 60% still fails
        // loudly on a genuinely wrong/missing/mispositioned element.
        const TEXT_MATCH_FLOOR = 60;
        const headingChecksOk =
          (step6Renderer.headingAtStartVsLegacy?.compare?.matchPct ?? 0) >= TEXT_MATCH_FLOOR &&
          (step6Renderer.headingAtMidVsLegacy?.compare?.matchPct ?? 0) >= TEXT_MATCH_FLOOR &&
          (step6Renderer.hiddenOnBVsLegacy?.compare?.matchPct ?? 0) >= TEXT_MATCH_FLOOR;
        // The suppression proof wants the OPPOSITE: a LOW match (the two
        // runs must look meaningfully different) — a suspiciously high match
        // here would mean the "forced visible" run failed to actually draw
        // the layer, i.e. the proof itself is broken, not that hiding works.
        const suppressionProofOk = (step6Renderer.hiddenOnBVsForcedVisible?.compare?.matchPct ?? 100) < 95;
        step6Ok = step6Renderer.ranAtAll && headingChecksOk && suppressionProofOk && previewProxy.ran;
        log(
          `Step 6 overall: ${step6Ok ? 'PASS' : 'FAIL — see step6RendererCheck/step6PreviewProxyCompare above'} ` +
            `(ranAtAll=${step6Renderer.ranAtAll} headingChecksOk=${headingChecksOk} suppressionProofOk=${suppressionProofOk} previewProxyRan=${previewProxy.ran})`,
        );
      } catch (e) {
        const message = fullErrorText(e);
        result.step6Error = message;
        log('Step 6 verification threw and was caught here (Step 3/4/5 results above are still valid): ' + message);
      }
      result.step6Ok = step6Ok;

      // Step 7 (Step 6 amendment Part B re-verification) — own try/catch,
      // same rationale as Step 5/6's: must not discard already-gathered results.
      try {
        const step7 = await withTimeout(runStep7ProjectLevelTextPresenceCheck(), 60_000, 'runStep7ProjectLevelTextPresenceCheck');
        result.step7ProjectLevelTextPresence = step7;
        log(`Step 7 overall: ${step7.ran && step7.headingRenders ? 'PASS' : 'FAIL — see step7ProjectLevelTextPresence above'}`);
      } catch (e) {
        const message = fullErrorText(e);
        result.step7Error = message;
        log('Step 7 verification threw and was caught here (Step 3/4/5/6 results above are still valid): ' + message);
      }

      // docs/webcodecs-export-plan.md STEP 7 — useExport.ts gate + cancel +
      // progress, through the real hook + real IPC (see this section's own
      // header, defined further down this file, for why it's distinctly
      // named `hookStep7*` rather than reusing this file's own pre-existing
      // "Step 7" key above). Own try/catch, same rationale as every other
      // step here: must not discard already-gathered results.
      try {
        const hookStep7 = await withTimeout(runHookStep7Verification(), 600_000, 'runHookStep7Verification');
        result.hookStep7GateCancelProgressOutput = hookStep7;
        log(`Step 7 (plan) hook verification overall: ${hookStep7.overallPass ? 'PASS' : 'FAIL — see hookStep7GateCancelProgressOutput above'}`);
      } catch (e) {
        const message = fullErrorText(e);
        result.hookStep7Error = message;
        log('Step 7 (plan) hook verification threw and was caught here (all prior results above are still valid): ' + message);
      }

      result.tauriVerificationRan = true;
    } else {
      log('Skipping real appendFileRaw disk-write + ffmpeg-probe + cancel-orphan-file + muxOnly + Step 5 checks — this runtime has no window.__TAURI_INTERNALS__. Run this page inside `npm run tauri:dev` to exercise that path for real.');
      result.tauriVerificationRan = false;
    }

    const step5Ok = runtimeIsTauri ? (result.step5Ok as boolean) : true;
    const step6Ok = runtimeIsTauri ? (result.step6Ok as boolean) : true;
    const overallPass =
      frameCountMatches &&
      result.chunkTypeCheck != null &&
      (result.chunkTypeCheck as { firstIsKey: boolean }).firstIsKey &&
      maxTimestampDeltaUs === 0 &&
      decodeResult.decodedFrameCount === expectedFrames &&
      decodeResult.decodeErrors.length === 0 &&
      durationOk &&
      cancelOk &&
      diskOk &&
      orphanOk &&
      muxOk &&
      step5Ok &&
      step6Ok;
    result.overallPass = overallPass;
    log(`=== OVERALL: ${overallPass ? 'PASS' : 'PARTIAL/FAIL — see fields above'} ===`);
  } catch (e) {
    const message = fullErrorText(e);
    result.error = message;
    result.overallPass = false;
    log('SPIKE FAILED: ' + message);
  }

  (window as unknown as { __step3SpikeResult: unknown }).__step3SpikeResult = result;
  log('=== SPIKE COMPLETE — full result at window.__step3SpikeResult ===');
  await exfil('step3-final', result);
  // Full accumulated on-page log text, exfiltrated separately — there is no
  // interactive devtools to read the #log element from in real WKWebView
  // (see this file's own header), so this is the only way to see every
  // per-checkpoint log() line (including "EXTRACT ERROR"/"MISSING FRAME"
  // detail the structured `result` object doesn't carry) from outside.
  const fullLogText = document.getElementById('log')?.textContent ?? '(no #log element)';
  await exfil('full-log', { text: fullLogText });
  log('=== Exfil POST sent ===');
}

// ===========================================================================
// docs/webcodecs-export-plan.md STEP 7 — useExport.ts gate + cancel +
// progress, verified through the REAL React hook (useExport itself, mounted
// via a real React root) and the REAL Tauri IPC bridge — not re-implemented
// gate logic, and not a direct exportProjectWebCodecs() call bypassing the
// hook (this step's own instruction: verify the FULL app UI path, not just
// the orchestrator directly). All result keys below are prefixed
// `hookStep7` to avoid any confusion with this file's own PRE-EXISTING
// "Step 7" section above (`runStep7ProjectLevelTextPresenceCheck` /
// `result.step7ProjectLevelTextPresence`) — that section verifies an
// unrelated thing (project-level text/heading presence) from a different,
// earlier amendment; the numbering collision is coincidental (this file's
// own internal step-numbering vs. docs/webcodecs-export-plan.md's Step 7).
//
// Only the native save-path DIALOG is stubbed (installTauriInvokeSpy below,
// intercepting exactly the 'pick_save_path' command) — every other IPC call
// useExport.ts's real code makes (ffmpeg_create_session, ffmpeg_exec,
// ffmpeg_write_file_raw, ffmpeg_append_file_raw, save_session_file,
// ffmpeg_kill_session, ffmpeg_destroy_session) goes through the real bridge
// to the real bundled ffmpeg sidecar, exactly as a real user's export would.
// ===========================================================================

/** Builds a single-segment, GL-compositable (trivially — no transition edges
 *  to disqualify it) project from the same real sample video other sections
 *  of this spike use. Used for the gate cases (fast, ~3s) and the cancel
 *  cases (longer, so there's real in-flight work to interrupt). */
async function buildSingleGlSegmentProject(id: string, durationSec: number): Promise<Project> {
  const resp = await fetch(SAMPLE_URL);
  if (!resp.ok) throw new Error(`could not fetch ${SAMPLE_URL} (${resp.status})`);
  const videoUrl = URL.createObjectURL(await resp.blob());
  const asset: Asset = { id: `${id}-asset`, name: 'sample.mp4', url: videoUrl, type: 'video' };
  const segment: VideoSegment = {
    id: `${id}-seg`, text: '', assetId: asset.id,
    startTime: 0, duration: durationSec,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0,
    trimStart: 0, trimEnd: durationSec,
  };
  return {
    id, name: id, script: '', sceneDetails: '',
    segments: [segment], assets: [asset], voiceoverId: undefined,
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.6)', fontFamily: 'sans-serif' },
  };
}

interface InvokeLogEntry { cmd: string; ts: number; }

/** Wraps the REAL `window.__TAURI_INTERNALS__.invoke` bridge (the function
 *  `@tauri-apps/api/core`'s `invoke()` delegates to directly — confirmed by
 *  reading node_modules/@tauri-apps/api/core.js). Records every command name
 *  (so gate/cancel verification can fingerprint which orchestrator ran and
 *  which cleanup calls fired) and substitutes a fixed path for exactly the
 *  'pick_save_path' command — the one call in the real flow that would
 *  otherwise block on a native OS file-chooser dialog with nothing in this
 *  headless spike able to click it. Every other command passes straight
 *  through to the real bridge, unmodified. Returns a no-op spy (empty log)
 *  if `__TAURI_INTERNALS__` doesn't exist (non-Tauri runtime) — callers of
 *  this Step 7 section only run inside the `runtimeIsTauri` guard anyway. */
function installTauriInvokeSpy(fixedSavePathProvider: () => string): { log: InvokeLogEntry[]; restore: () => void } {
  type InternalsInvoke = (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
  const win = window as unknown as { __TAURI_INTERNALS__?: { invoke: InternalsInvoke } };
  const internals = win.__TAURI_INTERNALS__;
  const log: InvokeLogEntry[] = [];
  if (!internals) return { log, restore: () => {} };
  const original = internals.invoke.bind(internals);
  internals.invoke = (async (cmd: string, args?: unknown, options?: unknown) => {
    log.push({ cmd, ts: Date.now() });
    if (cmd === 'pick_save_path') return fixedSavePathProvider();
    return original(cmd, args, options);
  }) as InternalsInvoke;
  return {
    log,
    restore: () => {
      internals.invoke = original;
    },
  };
}

/** Mounts the REAL `useExport` hook (src/hooks/useExport.ts, unmodified
 *  import) via a real React root — not a re-implementation of its gate/
 *  cancel/progress logic. `apiBox.current` holds the latest render's API
 *  (functions are useCallback-stable; the box just survives across renders
 *  since this driver code lives outside the component); `states` accumulates
 *  every `state` value the hook has produced, in order, for the progress-
 *  monotonicity check. */
function mountExportHookHarness(
  project: Project,
  resolution: ExportResolution,
  fps: ExportFps,
  onSavePath: (path: string) => void,
): { apiBox: { current: UseExportApi | null }; states: UseExportState[]; unmount: () => void } {
  const container = document.createElement('div');
  container.style.display = 'none';
  document.body.appendChild(container);
  const root = createRoot(container);
  const apiBox: { current: UseExportApi | null } = { current: null };
  const states: UseExportState[] = [];
  function HookHarness(): null {
    const api = useExport(project, resolution, fps, onSavePath);
    useEffect(() => {
      apiBox.current = api;
      states.push(api.state);
    });
    return null;
  }
  root.render(createElement(HookHarness));
  return {
    apiBox,
    states,
    unmount(): void {
      root.unmount();
      container.remove();
    },
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) {
      throw new Error(`waitUntil: "${label}" timed out after ${timeoutMs}ms`);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface HookGateCase {
  label: string;
  toggleOn: boolean;
  forceIncapable: boolean;
  sawAppendFileRaw: boolean;
  gateOpenBeforeRun: boolean;
  error: string | null;
}

/** GATE VERIFICATION (plan §4.4/§6, this step's own instructions Part 1):
 *  toggle OFF must run the legacy orchestrator; toggle ON (on a GL-eligible
 *  project) must run the new one; a forced-unsupported runtime must keep the
 *  gate closed regardless of the toggle. "Which orchestrator ran" is
 *  fingerprinted honestly, not asserted: the new path is the ONLY caller of
 *  `ffmpeg_append_file_raw` anywhere in the app (grep-confirmed — only
 *  `exportWorker.ts`'s driving orchestrator streams encoded chunks that way;
 *  the legacy path writes per-frame PNGs via `ffmpeg_write_file`/
 *  `ffmpeg_write_file_raw` and never appends), so its presence/absence in
 *  the real IPC log is a structural signal, not a guess. */
async function runHookGateVerification(): Promise<HookGateCase[]> {
  const cases: HookGateCase[] = [];

  async function runGateCase(label: string, toggleOn: boolean, idSuffix: string): Promise<HookGateCase> {
    const savedPath = `/tmp/kinetix-step7-spike-gate-${idSuffix}.mp4`;
    setWebCodecsExportToggle(toggleOn);
    const spy = installTauriInvokeSpy(() => savedPath);
    const gateOpenBeforeRun = isWebCodecsExportGateOpen();
    let errorMsg: string | null = null;
    let sawAppendFileRaw = false;
    const project = await buildSingleGlSegmentProject(`gate-${idSuffix}`, 3);
    const harness = mountExportHookHarness(project, '1080p', 30, () => {});
    try {
      harness.apiBox.current!.startExport();
      await waitUntil(
        () => harness.apiBox.current!.state.showExportSuccess === true || harness.apiBox.current!.state.error != null,
        60_000,
        `${label}: export to settle`,
      );
      if (harness.apiBox.current!.state.error) {
        errorMsg = `export ended in error: ${harness.apiBox.current!.state.error.kind} — ${harness.apiBox.current!.state.error.message}`;
      }
      sawAppendFileRaw = spy.log.some((e) => e.cmd === 'ffmpeg_append_file_raw');
    } catch (e) {
      errorMsg = fullErrorText(e);
    } finally {
      spy.restore();
      harness.unmount();
    }
    return { label, toggleOn, forceIncapable: false, sawAppendFileRaw, gateOpenBeforeRun, error: errorMsg };
  }

  cases.push(await runGateCase('toggle OFF -> expect legacy (no appendFileRaw)', false, 'off'));
  cases.push(await runGateCase('toggle ON -> expect webcodecs (appendFileRaw present)', true, 'on'));

  // Capability forced OFF: no real export run needed — this directly probes
  // the same gate function a real run would consult, live on the real
  // runtime (complements the mocked-Node vitest unit tests in
  // useExport.test.ts, which can't exercise a real `window`/`VideoEncoder`).
  {
    setWebCodecsExportToggle(true);
    const win = window as unknown as { VideoEncoder?: unknown };
    const realVideoEncoder = win.VideoEncoder;
    delete win.VideoEncoder;
    __resetWebCodecsExportCapabilityForTests();
    const capableWhenForced = isWebCodecsExportCapable();
    const gateOpenWhenForced = isWebCodecsExportGateOpen();
    win.VideoEncoder = realVideoEncoder;
    __resetWebCodecsExportCapabilityForTests();
    cases.push({
      label: 'capability forced unsupported (toggle ON) -> gate must stay closed',
      toggleOn: true,
      forceIncapable: true,
      sawAppendFileRaw: false,
      gateOpenBeforeRun: gateOpenWhenForced,
      error: capableWhenForced
        ? 'isWebCodecsExportCapable() unexpectedly stayed true after deleting window.VideoEncoder'
        : gateOpenWhenForced
          ? 'gate stayed OPEN despite a forced-incapable runtime'
          : null,
    });
  }

  return cases;
}

interface HookCancelCase {
  label: string;
  toggleOn: boolean;
  cancelled: boolean;
  progressAtCancel: number;
  sawKillSession: boolean;
  sawDestroySession: boolean;
  secondCancelWasNoOp: boolean;
  error: string | null;
}

/** CANCEL VERIFICATION (plan §9.1, this step's own instructions Part 2): for
 *  each path, start a real export on a 10s clip, cancel once real progress
 *  has been observed (not just isExporting=true — this must interrupt actual
 *  in-flight work), then confirm the cancelled state lands and the expected
 *  IPC cleanup calls fired. A second `cancelExport()` call afterward must be
 *  a no-op (tauriBackendRef already null) — fingerprinted the same
 *  IPC-log-didn't-grow way `verifyCancelLeavesNoOrphan` above reasons about
 *  session lifecycle from inside the app (the authoritative host-filesystem
 *  check — no leftover `kinetix-export-*` dir, no orphaned `ffmpeg` process —
 *  is done from outside the app; see this step's own report). */
async function runHookCancelCase(label: string, toggleOn: boolean): Promise<HookCancelCase> {
  const savedPath = `/tmp/kinetix-step7-spike-cancel-${toggleOn ? 'on' : 'off'}.mp4`;
  setWebCodecsExportToggle(toggleOn);
  const spy = installTauriInvokeSpy(() => savedPath);
  const result: HookCancelCase = {
    label, toggleOn, cancelled: false, progressAtCancel: 0,
    sawKillSession: false, sawDestroySession: false, secondCancelWasNoOp: false, error: null,
  };
  const project = await buildSingleGlSegmentProject(`cancel-${toggleOn}`, 10);
  const harness = mountExportHookHarness(project, '1080p', 30, () => {});
  try {
    harness.apiBox.current!.startExport();
    await waitUntil(
      () =>
        (harness.apiBox.current!.state.stage?.type === 'encoding_segment' && harness.apiBox.current!.state.progress > 0) ||
        harness.apiBox.current!.state.error != null,
      60_000,
      `${label}: waiting for real encode progress before cancelling`,
    );
    result.progressAtCancel = harness.apiBox.current!.state.progress;
    harness.apiBox.current!.cancelExport();
    await waitUntil(
      () => harness.apiBox.current!.state.error?.kind === 'cancelled',
      30_000,
      `${label}: waiting for cancelled state`,
    );
    result.cancelled = harness.apiBox.current!.state.error?.kind === 'cancelled';
    // The kill/destroy chain is fire-and-forget from cancelExport()'s
    // perspective (see useExport.ts's own comment on this) — give it a beat
    // to land its IPC calls before checking the log.
    await new Promise((r) => setTimeout(r, 1500));
    result.sawKillSession = spy.log.some((e) => e.cmd === 'ffmpeg_kill_session');
    result.sawDestroySession = spy.log.some((e) => e.cmd === 'ffmpeg_destroy_session');

    const callsBeforeSecondCancel = spy.log.length;
    harness.apiBox.current!.cancelExport();
    await new Promise((r) => setTimeout(r, 500));
    result.secondCancelWasNoOp = spy.log.length === callsBeforeSecondCancel;
  } catch (e) {
    result.error = fullErrorText(e);
  } finally {
    spy.restore();
    harness.unmount();
  }
  return result;
}

interface HookProgressResult {
  ran: boolean;
  progressSamples: number[];
  monotonic: boolean;
  reached100: boolean;
  distinctPieceIndices: number;
  segmentCount: number;
  error: string | null;
}

interface HookOutputResult {
  ran: boolean;
  savedPath: string | null;
  ffmpegRemuxExitCode: number | null;
  fileNonEmpty: boolean | null;
  mp4HasVideoTrack: boolean | null;
  mp4HasAudioTrack: boolean | null;
  mp4DurationSec: number | null;
  expectedDurationSec: number | null;
  durationOk: boolean;
  error: string | null;
}

/** Reads the overall movie duration + track presence from a real MP4 via
 *  mp4box — same library/pattern `probeMp4AudioTrack` above already uses,
 *  extended to also report the video track and overall duration (not just
 *  audio), since output verification here needs "is this a real, complete,
 *  correctly-timed video," not just "does it have an audio track." */
function probeMp4Info(bytes: Uint8Array): Promise<{ hasVideoTrack: boolean; hasAudioTrack: boolean; durationSec: number | null }> {
  return new Promise((resolve, reject) => {
    const mp4boxFile = createMp4BoxFile();
    mp4boxFile.onError = (module: string, msg: string) => reject(new Error(`mp4box error [${module}]: ${msg}`));
    mp4boxFile.onReady = (info) => {
      resolve({
        hasVideoTrack: info.videoTracks.length > 0,
        hasAudioTrack: info.audioTracks.length > 0,
        durationSec: info.duration && info.timescale ? info.duration / info.timescale : null,
      });
    };
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    mp4boxFile.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, 0));
  });
}

/** PROGRESS + OUTPUT VERIFICATION (this step's own instructions Parts 3/4):
 *  runs a full, real, mixed-tier export (the same `buildMixedProject()`
 *  fixture Step 5's A/B compare already uses — GL + Tier 1 + Tier C
 *  segments, plus a voiceover) all the way to completion through the real
 *  hook, then verifies progress monotonicity/completion and, separately,
 *  the actual file the hook saved to real disk (via a fresh throwaway
 *  session's remux-copy + mp4box parse — see this function's own comment on
 *  why bytes-through-renderer for the FINAL file itself is deliberately
 *  never done, matching the 2026-07-14 OOM-crash fix's contract). */
async function runHookProgressAndOutputVerification(): Promise<{ progress: HookProgressResult; output: HookOutputResult }> {
  const savedPath = '/tmp/kinetix-step7-spike-progress-output.mp4';
  const progress: HookProgressResult = {
    ran: false, progressSamples: [], monotonic: true, reached100: false,
    distinctPieceIndices: 0, segmentCount: 0, error: null,
  };
  const output: HookOutputResult = {
    ran: false, savedPath: null, ffmpegRemuxExitCode: null, fileNonEmpty: null,
    mp4HasVideoTrack: null, mp4HasAudioTrack: null, mp4DurationSec: null,
    expectedDurationSec: null, durationOk: false, error: null,
  };

  let project: Project;
  try {
    project = await buildMixedProject();
  } catch (e) {
    const msg = fullErrorText(e);
    progress.error = msg;
    output.error = msg;
    return { progress, output };
  }
  progress.segmentCount = project.segments.length;
  const expectedDurationSec = project.segments.reduce((sum, s) => sum + s.duration, 0);
  output.expectedDurationSec = expectedDurationSec;

  setWebCodecsExportToggle(true);
  const spy = installTauriInvokeSpy(() => savedPath);
  const harness = mountExportHookHarness(project, '1080p', 30, () => {});
  try {
    harness.apiBox.current!.startExport();
    await waitUntil(
      () => harness.apiBox.current!.state.showExportSuccess === true || harness.apiBox.current!.state.error != null,
      180_000,
      'mixed-project export to complete',
    );
    progress.ran = true;
    const samples = harness.states.map((s) => s.progress);
    progress.progressSamples = samples;
    let monotonic = true;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i]! < samples[i - 1]!) {
        monotonic = false;
        break;
      }
    }
    progress.monotonic = monotonic;
    progress.reached100 = samples.length > 0 && samples[samples.length - 1] === 100;
    const pieceIndices = new Set<number>();
    for (const s of harness.states) {
      if (s.stage?.type === 'encoding_segment') pieceIndices.add(s.stage.index);
    }
    progress.distinctPieceIndices = pieceIndices.size;

    const finalState = harness.apiBox.current!.state;
    if (finalState.error) {
      output.error = `export ended in error: ${finalState.error.kind} — ${finalState.error.message}`;
    } else {
      output.ran = true;
      output.savedPath = finalState.lastExportPath ?? savedPath;
      // Verify the REAL file the hook just saved to real disk, without ever
      // pulling ITS bytes through this page's renderer (that's exactly the
      // OOM-crash pattern the 2026-07-14 fix eliminated — see tauriFfmpeg.ts's
      // saveSessionFile doc comment). Instead: a brand-new throwaway
      // TauriFfmpeg session remux-copies the on-disk file (`-c copy`, an
      // absolute host path works fine as ffmpeg_exec's `-i` regardless of the
      // session's own cwd — confirmed by reading ffmpeg.rs's ffmpeg_exec,
      // which sets current_dir but never restricts args), then the SMALL
      // remuxed copy (now itself a session-relative file) is read back via
      // the existing readFile() IPC and parsed with mp4box — the same
      // bytes-stay-small discipline this file's other mp4 checks already use.
      const verifySession = await TauriFfmpeg.create();
      try {
        const exitCode = await verifySession.exec(['-hide_banner', '-i', output.savedPath, '-c', 'copy', '-y', 'verify_copy.mp4']);
        output.ffmpegRemuxExitCode = exitCode;
        const rawBytes = await verifySession.readFile('verify_copy.mp4');
        const bytes = typeof rawBytes === 'string' ? new TextEncoder().encode(rawBytes) : rawBytes;
        output.fileNonEmpty = bytes.byteLength > 0;
        const info = await probeMp4Info(bytes);
        output.mp4HasVideoTrack = info.hasVideoTrack;
        output.mp4HasAudioTrack = info.hasAudioTrack;
        output.mp4DurationSec = info.durationSec;
        output.durationOk = info.durationSec !== null && Math.abs(info.durationSec - expectedDurationSec) <= 2 / FPS;
      } finally {
        await verifySession.destroy();
      }
    }
  } catch (e) {
    const msg = fullErrorText(e);
    progress.error = progress.error ?? msg;
    output.error = output.error ?? msg;
  } finally {
    spy.restore();
    harness.unmount();
  }
  return { progress, output };
}

interface HookStep7Result {
  ranAtAll: boolean;
  gateCases: HookGateCase[];
  cancelCases: HookCancelCase[];
  progress: HookProgressResult;
  output: HookOutputResult;
  overallPass: boolean;
  error: string | null;
}

/** Top-level driver for this step's own gate/cancel/progress/output
 *  verification (docs/webcodecs-export-plan.md Step 7 Parts A/C — Part B is
 *  the toggle UI itself, a manual/visual check, not this function's job).
 *  Leaves the persisted toggle OFF on exit (the shipped default) regardless
 *  of outcome. */
async function runHookStep7Verification(): Promise<HookStep7Result> {
  const result: HookStep7Result = {
    ranAtAll: false, gateCases: [], cancelCases: [],
    progress: { ran: false, progressSamples: [], monotonic: true, reached100: false, distinctPieceIndices: 0, segmentCount: 0, error: null },
    output: { ran: false, savedPath: null, ffmpegRemuxExitCode: null, fileNonEmpty: null, mp4HasVideoTrack: null, mp4HasAudioTrack: null, mp4DurationSec: null, expectedDurationSec: null, durationOk: false, error: null },
    overallPass: false,
    error: null,
  };
  try {
    log('--- Step 7 (plan) gate verification (real useExport hook + real IPC) ---');
    result.gateCases = await runHookGateVerification();
    for (const c of result.gateCases) {
      log(`  gate case "${c.label}": gateOpenBeforeRun=${c.gateOpenBeforeRun} sawAppendFileRaw=${c.sawAppendFileRaw} error=${c.error ?? '(none)'}`);
    }

    log('--- Step 7 (plan) cancel verification (webcodecs path) ---');
    const cancelOn = await runHookCancelCase('cancel: toggle ON (webcodecs path)', true);
    result.cancelCases.push(cancelOn);
    log(`  ${JSON.stringify(cancelOn)}`);

    log('--- Step 7 (plan) cancel verification (legacy path) ---');
    const cancelOff = await runHookCancelCase('cancel: toggle OFF (legacy path, D13 unchanged)', false);
    result.cancelCases.push(cancelOff);
    log(`  ${JSON.stringify(cancelOff)}`);

    log('--- Step 7 (plan) progress + output verification (mixed-tier project, webcodecs path) ---');
    const { progress, output } = await runHookProgressAndOutputVerification();
    result.progress = progress;
    result.output = output;
    log(`  progress: ${JSON.stringify(progress)}`);
    log(`  output: ${JSON.stringify(output)}`);

    result.ranAtAll = true;
  } catch (e) {
    result.error = fullErrorText(e);
    log('Step 7 (plan) verification threw at the top level: ' + result.error);
  } finally {
    // Always leave the persisted toggle at the shipped default (OFF),
    // regardless of pass/fail/throw above.
    setWebCodecsExportToggle(false);
  }

  const gateOk =
    result.gateCases.length === 3 &&
    result.gateCases[0]!.error === null && result.gateCases[0]!.sawAppendFileRaw === false &&
    result.gateCases[1]!.error === null && result.gateCases[1]!.sawAppendFileRaw === true &&
    result.gateCases[2]!.error === null;
  const cancelOk = result.cancelCases.length === 2 && result.cancelCases.every((c) => c.error === null && c.cancelled && c.sawKillSession && c.sawDestroySession && c.secondCancelWasNoOp);
  const progressOk = result.progress.ran && result.progress.error === null && result.progress.monotonic && result.progress.reached100;
  const outputOk =
    result.output.ran &&
    result.output.error === null &&
    result.output.ffmpegRemuxExitCode === 0 &&
    result.output.fileNonEmpty === true &&
    result.output.mp4HasVideoTrack === true &&
    result.output.mp4HasAudioTrack === true &&
    result.output.durationOk;
  result.overallPass = result.ranAtAll && gateOk && cancelOk && progressOk && outputOk;
  log(
    `=== Step 7 (plan) overall: ${result.overallPass ? 'PASS' : 'FAIL — see gateCases/cancelCases/progress/output above'} ` +
      `(gateOk=${gateOk} cancelOk=${cancelOk} progressOk=${progressOk} outputOk=${outputOk}) ===`,
  );
  return result;
}

// ===========================================================================
// docs/webcodecs-export-plan.md STEP 8 — quality comparison + cutover
// recommendation. VERIFICATION ONLY: this section touches no production
// file. It runs ONE real, diverse project through THREE full, real export
// pipelines:
//   1. LEGACY      — exportPipeline.ts's real exportProject() (libx264 crf16,
//                    the current production default, toggle OFF).
//   2. HARDWARE    — exportPipelineWebCodecs.ts's real, UNMODIFIED
//                    exportProjectWebCodecs(), whose exportWorker.ts uses the
//                    real hardware-first ladder (['prefer-hardware',
//                    'no-preference', 'prefer-software']).
//   3. SOFTWARE    — this spike's own exportPipelineWebCodecsSoftwareSpike.ts
//                    (a verbatim duplicate of #2's orchestrator, see that
//                    file's header), driving exportWorkerSoftwareSpike.ts (a
//                    verbatim duplicate of exportWorker.ts with
//                    HARDWARE_LADDER forced to ['prefer-software'] only).
//                    This is the "construct its own worker" approach named
//                    as an option in this step's own instructions, chosen
//                    over adding a spike-only init-message override because
//                    the real exportWorker.ts is flatly off-limits to edit.
//
// Each run gets its own TauriFfmpeg session and is saved to a REAL,
// deterministic path on host disk via the real save_session_file IPC (the
// same native fs::copy path the app's own export flow uses — no bytes
// through the renderer), so the actual output bytes can be ffprobe'd and
// frame-compared from OUTSIDE the app (this spike has no bundled ffprobe
// reachable from a plain page — see this file's Step 3 header note; the
// real analysis in this step's report was run from a host shell against
// these exact saved files).
//
// Gated behind `?step=8` in the page URL so re-running this section does not
// require re-running the (already reviewed, already passing) Steps 3-7
// above every time — each of those is itself a multi-minute real-WKWebView
// run, and Step 8's three real hardware/software/legacy exports are
// themselves multi-minute. See `main()`'s own entry branch at the bottom of
// this file.
// ===========================================================================

const STEP8_WIDTH = 1280;
const STEP8_HEIGHT = 720;
const STEP8_FPS = 30;
const STEP8_TOTAL_DURATION_SEC = 12; // 360 frames @30fps — well above the "≥300 frames" floor.
const STEP8_LEGACY_PATH = '/tmp/kinetix-step8-legacy.mp4';
const STEP8_HARDWARE_PATH = '/tmp/kinetix-step8-hardware.mp4';
const STEP8_SOFTWARE_PATH = '/tmp/kinetix-step8-software.mp4';

/** Static-image asset for segment B: checkerboard (sharp, high-frequency
 *  edges — the classic low-bitrate quantization stress case) + flat solid
 *  color bands (flat-area banding stress) + diagonal lines + text (another
 *  sharp-edge source and, combined with segment C's captions, a second
 *  legibility data point). Deliberately drawn at the export's own target
 *  resolution so no extra scaling step is introduced between source and
 *  destination. */
function makeStep8SwatchBlob(w: number, h: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('makeStep8SwatchBlob: 2D context unavailable');
  const tile = 40;
  for (let y = 0; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      const even = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0;
      ctx.fillStyle = even ? '#10101f' : '#e8e8f2';
      ctx.fillRect(x, y, tile, tile);
    }
  }
  ctx.fillStyle = '#8020c0';
  ctx.fillRect(0, 0, w, h * 0.15);
  ctx.fillStyle = '#20c080';
  ctx.fillRect(0, h * 0.85, w, h * 0.15);
  ctx.strokeStyle = '#ff2020';
  ctx.lineWidth = 3;
  for (let i = -h; i < w; i += 24) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STATIC + GRADE', w / 2, h / 2);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('makeStep8SwatchBlob: toBlob returned null'))), 'image/png');
  });
}

/**
 * The diverse test project (this step's own instructions, Part A): 12s /
 * 360 frames @30fps, four 3s segments, boundaries at exactly 3/6/9s so the
 * required 0/25/50/75/100% checkpoints land at t=0 (start), t=3 (the A→B
 * transition's exact centered midpoint — [2.5,3.5]), t=6 (B→C hard cut),
 * t=9 (C→D hard cut), and t≈11.97 (last frame of D). Two BONUS interior
 * checkpoints (t=4.5 mid-B, t=7.5 mid-C — see runStep8FrameCompare) sample
 * the grade and text segments away from their edges too.
 *
 *   A [0,3)  video, high-motion (real footage — sample.mp4's own first 3s),
 *            zoom-in. Transition OUT: cross-dissolve, 1.0s, centered at t=3.
 *   B [3,6)  static image (checkerboard/flat-bands/lines/text swatch) +
 *            effectGrade pushed hard on all 4 channels — the color-fidelity
 *            stress case. NOTE (documented, not a bug): the legacy canvas
 *            path has NO renderer for effectGrade at all (confirmed by grep,
 *            zero references outside the GL stack — same pre-existing gap
 *            Step 5's own mixed-project fixture documents) — legacy vs
 *            hardware/software WILL diverge here by construction, not
 *            because of encoder quality. Hardware vs software both apply
 *            the identical grade (same compositor), so THAT comparison stays
 *            a pure encoder-quality signal even on this segment.
 *   C [6,9)  video (a different 3s trim window of the same source — real
 *            motion), a body caption + one extraOverlay — the text-
 *            legibility stress case.
 *   D [9,12) video (a third trim window), zoom-out.
 *
 * All four segments are individually GL-compositable (no color filter, only
 * zoom-in/zoom-out/none animation, every transition edge is either the one
 * real GL-slug transition (A→B) or a hard cut) — verified by hand against
 * glCompositable.ts's own predicate while writing this fixture — so the
 * hardware/software runs encode this ENTIRE 360-frame timeline as one single
 * continuous VideoEncoder stream (buildPiecePlans groups any run of
 * same-tier segments together regardless of whether adjacent edges are real
 * transitions or hard cuts), which is exactly the regime Step 8 needs to
 * compare: one continuous encode, same GOP/keyframe schedule, differing only
 * in hardwareAcceleration. No voiceover (deliberately — Step 8 is a VIDEO
 * quality question; muxing is already proven correct by Steps 4/5/7).
 */
async function buildStep8QualityProject(): Promise<Project> {
  const resp = await fetch(SAMPLE_URL);
  if (!resp.ok) throw new Error(`could not fetch ${SAMPLE_URL} (${resp.status})`);
  const videoUrl = URL.createObjectURL(await resp.blob());
  const swatchBlob = await makeStep8SwatchBlob(STEP8_WIDTH, STEP8_HEIGHT);
  const videoAsset: Asset = { id: 'step8-video', name: 'sample.mp4', url: videoUrl, type: 'video' };
  const imageAsset: Asset = { id: 'step8-image', name: 'swatch.png', url: URL.createObjectURL(swatchBlob), type: 'image' };

  const segA: VideoSegment = {
    id: 'step8-a', text: '', assetId: videoAsset.id,
    startTime: 0, duration: 3,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0,
    trimStart: 0, trimEnd: 3,
    effectAnimation: 'zoom-in', effectAnimationScaleRate: 0.02,
    effectTransition: 'cross-dissolve', effectTransitionDuration: 1.0,
  };
  const segB: VideoSegment = {
    id: 'step8-b', text: '', assetId: imageAsset.id,
    startTime: 3, duration: 3,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: 1,
    effectGrade: { brightness: 0.3, contrast: 0.4, saturation: 0.5, temperature: -0.3 },
  };
  const segC: VideoSegment = {
    id: 'step8-c', text: 'The quick brown fox jumps over the lazy dog — 0123456789', assetId: videoAsset.id,
    startTime: 6, duration: 3,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: 2,
    trimStart: 3, trimEnd: 6,
    showOverlay: true,
    overlayConfig: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.75)', fontFamily: 'sans-serif', fontSize: 34, x: 50, y: 82 },
    extraOverlays: [
      {
        id: 'step8-c-extra', text: 'STEP 8 QUALITY TEST', color: '#ffcc00', backgroundColor: 'rgba(20,20,20,0.8)',
        fontFamily: 'sans-serif', fontSize: 30, position: { x: 50, y: 14 }, textAlign: 'center',
      },
    ],
  };
  const segD: VideoSegment = {
    id: 'step8-d', text: '', assetId: videoAsset.id,
    startTime: 9, duration: 3,
    transition: TransitionType.NONE, animation: AnimationType.NONE, order: 3,
    trimStart: 6, trimEnd: 9,
    effectAnimation: 'zoom-out', effectAnimationScaleRate: 0.02,
  };

  return {
    id: 'step8-quality-project',
    name: 'Step 8 Quality Comparison Project',
    script: '',
    sceneDetails: '',
    segments: [segA, segB, segC, segD],
    assets: [videoAsset, imageAsset],
    voiceoverId: undefined,
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.6)', fontFamily: 'sans-serif' },
  };
}

interface Step8LadderProbeResult {
  attempts: string[];
  selectedRung: HardwareAcceleration | null;
}

/**
 * Answers "which rung of exportWorker.ts's own hardware-first ladder would
 * actually be selected on this machine" WITHOUT modifying exportWorker.ts —
 * it cannot report this itself (no such field in its message protocol, by
 * design: it's a production file, not instrumented for spikes). This probe
 * instead runs the IDENTICAL probe-then-configure sequence
 * (`VideoEncoder.isConfigSupported` then a real `new VideoEncoder(...).
 * configure(...)` attempt) against the EXACT SAME base config
 * (codec/width/height/framerate/bitrate/latencyMode/avc format) exportWorker.
 * ts's own `createEncoder`/`base`/`HARDWARE_LADDER` use (values copied
 * verbatim from that file, read directly, not guessed) — VideoEncoder
 * hardware availability is a deterministic property of this machine's OS/GPU
 * for a given config, not something that varies between two separately
 * constructed encoder instances asking the identical question in the same
 * WKWebView process. Each attempted encoder is closed immediately after the
 * verdict, never used to encode anything.
 */
async function probeStep8HardwareLadderSelection(width: number, height: number, fps: number): Promise<Step8LadderProbeResult> {
  // Copied verbatim from exportWorker.ts's own `EXPORT_CODEC`/`EXPORT_BITRATE`/`base`/`HARDWARE_LADDER`.
  const codec = 'avc1.640028';
  const bitrate = 8_000_000;
  const base = {
    codec,
    width,
    height,
    framerate: fps,
    bitrate,
    latencyMode: 'quality' as const,
    avc: { format: 'annexb' as const },
  };
  const ladder: HardwareAcceleration[] = ['prefer-hardware', 'no-preference', 'prefer-software'];
  const attempts: string[] = [];
  for (const hardwareAcceleration of ladder) {
    const config: VideoEncoderConfig = { ...base, hardwareAcceleration };
    let supported = false;
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      supported = support.supported === true;
    } catch (e) {
      attempts.push(`${hardwareAcceleration}: isConfigSupported threw: ${fullErrorText(e)}`);
      continue;
    }
    if (!supported) {
      attempts.push(`${hardwareAcceleration}: isConfigSupported=false`);
      continue;
    }
    let encoder: VideoEncoder | null = null;
    try {
      encoder = new VideoEncoder({ output: () => {}, error: () => {} });
      encoder.configure(config);
      attempts.push(`${hardwareAcceleration}: SELECTED (isConfigSupported=true, configure() succeeded)`);
      encoder.close();
      return { attempts, selectedRung: hardwareAcceleration };
    } catch (e) {
      attempts.push(`${hardwareAcceleration}: configure threw: ${fullErrorText(e)}`);
      try {
        encoder?.close();
      } catch {
        // best-effort
      }
    }
  }
  return { attempts, selectedRung: null };
}

interface Step8ExportRunResult {
  label: string;
  ok: boolean;
  error: string | null;
  wallMs: number;
  savedPath: string;
  onDiskBytes: number | null;
  hasVideoTrack: boolean | null;
  durationSec: number | null;
  durationOk: boolean | null;
}

/** Verifies the just-saved real disk file WITHOUT pulling its (multi-MB)
 *  bytes through this page's renderer wholesale — same discipline as Step
 *  7's own output verification: a throwaway TauriFfmpeg session remux-copies
 *  the absolute host path (`-c copy`, works regardless of the session's own
 *  cwd — ffmpeg_exec sets current_dir but never restricts args), then only
 *  the small remuxed copy is read back via readFile()+mp4box. The bulk
 *  ffprobe/codec/bitrate/frame-count/frame-compare analysis this step's
 *  report actually needs runs from a host shell directly against
 *  `savedPath` afterward — this in-page check only confirms "a real,
 *  non-empty, video-bearing MP4 of about the right duration landed on disk,"
 *  a fast sanity gate before the heavier host-side analysis. */
async function verifyStep8SavedFile(savedPath: string, expectedDurationSec: number, fps: number): Promise<{ onDiskBytes: number; hasVideoTrack: boolean; durationSec: number | null; durationOk: boolean }> {
  const verifySession = await TauriFfmpeg.create();
  try {
    await verifySession.exec(['-hide_banner', '-i', savedPath, '-c', 'copy', '-y', 'verify_copy.mp4']);
    const rawBytes = await verifySession.readFile('verify_copy.mp4');
    const bytes = typeof rawBytes === 'string' ? new TextEncoder().encode(rawBytes) : rawBytes;
    const info = await probeMp4Info(bytes);
    return {
      onDiskBytes: bytes.byteLength,
      hasVideoTrack: info.hasVideoTrack,
      durationSec: info.durationSec,
      durationOk: info.durationSec !== null && Math.abs(info.durationSec - expectedDurationSec) <= 2 / fps,
    };
  } finally {
    await verifySession.destroy();
  }
}

async function runStep8LegacyExport(project: Project): Promise<Step8ExportRunResult> {
  log('--- Step 8: LEGACY export (exportProject, libx264 crf16) ---');
  const ffmpeg = await TauriFfmpeg.create();
  const result: Step8ExportRunResult = {
    label: 'legacy', ok: false, error: null, wallMs: 0, savedPath: STEP8_LEGACY_PATH,
    onDiskBytes: null, hasVideoTrack: null, durationSec: null, durationOk: null,
  };
  try {
    const wallStart = performance.now();
    const exportResult = await exportProject(project, ffmpeg, { width: STEP8_WIDTH, height: STEP8_HEIGHT, fps: STEP8_FPS });
    result.wallMs = performance.now() - wallStart;
    if (!exportResult.ok) {
      result.error = `${exportResult.error.kind}: ${exportResult.error.message}${exportResult.error.cause ? ' — ' + exportResult.error.cause : ''}`;
      return result;
    }
    await ffmpeg.saveSessionFile(exportResult.outputFile, STEP8_LEGACY_PATH);
    result.ok = true;
  } catch (e) {
    result.error = fullErrorText(e);
  } finally {
    await ffmpeg.destroy();
  }
  if (result.ok) {
    try {
      const verify = await verifyStep8SavedFile(STEP8_LEGACY_PATH, STEP8_TOTAL_DURATION_SEC, STEP8_FPS);
      Object.assign(result, verify);
    } catch (e) {
      result.error = `saved OK but post-save verify threw: ${fullErrorText(e)}`;
    }
  }
  log(`  legacy: ok=${result.ok} wallMs=${result.wallMs.toFixed(0)} error=${result.error ?? '(none)'} durationSec=${result.durationSec} durationOk=${result.durationOk} onDiskBytes=${result.onDiskBytes}`);
  return result;
}

async function runStep8HardwareExport(project: Project): Promise<Step8ExportRunResult> {
  log('--- Step 8: HARDWARE export (real exportProjectWebCodecs, unmodified exportWorker.ts, hardware-first ladder) ---');
  const ffmpeg = await TauriFfmpeg.create();
  const result: Step8ExportRunResult = {
    label: 'hardware', ok: false, error: null, wallMs: 0, savedPath: STEP8_HARDWARE_PATH,
    onDiskBytes: null, hasVideoTrack: null, durationSec: null, durationOk: null,
  };
  try {
    const wallStart = performance.now();
    const exportResult = await exportProjectWebCodecs(project, ffmpeg, { width: STEP8_WIDTH, height: STEP8_HEIGHT, fps: STEP8_FPS });
    result.wallMs = performance.now() - wallStart;
    if (!exportResult.ok) {
      result.error = `${exportResult.error.kind}: ${exportResult.error.message}${exportResult.error.cause ? ' — ' + exportResult.error.cause : ''}`;
      return result;
    }
    await ffmpeg.saveSessionFile(exportResult.outputFile, STEP8_HARDWARE_PATH);
    result.ok = true;
  } catch (e) {
    result.error = fullErrorText(e);
  } finally {
    await ffmpeg.destroy();
  }
  if (result.ok) {
    try {
      const verify = await verifyStep8SavedFile(STEP8_HARDWARE_PATH, STEP8_TOTAL_DURATION_SEC, STEP8_FPS);
      Object.assign(result, verify);
    } catch (e) {
      result.error = `saved OK but post-save verify threw: ${fullErrorText(e)}`;
    }
  }
  log(`  hardware: ok=${result.ok} wallMs=${result.wallMs.toFixed(0)} error=${result.error ?? '(none)'} durationSec=${result.durationSec} durationOk=${result.durationOk} onDiskBytes=${result.onDiskBytes}`);
  return result;
}

async function runStep8SoftwareExport(project: Project): Promise<Step8ExportRunResult> {
  log('--- Step 8: SOFTWARE export (exportProjectWebCodecsSoftwareSpike, exportWorkerSoftwareSpike.ts forced prefer-software) ---');
  const ffmpeg = await TauriFfmpeg.create();
  const result: Step8ExportRunResult = {
    label: 'software', ok: false, error: null, wallMs: 0, savedPath: STEP8_SOFTWARE_PATH,
    onDiskBytes: null, hasVideoTrack: null, durationSec: null, durationOk: null,
  };
  try {
    const wallStart = performance.now();
    const exportResult = await exportProjectWebCodecsSoftwareSpike(project, ffmpeg, { width: STEP8_WIDTH, height: STEP8_HEIGHT, fps: STEP8_FPS });
    result.wallMs = performance.now() - wallStart;
    if (!exportResult.ok) {
      result.error = `${exportResult.error.kind}: ${exportResult.error.message}${exportResult.error.cause ? ' — ' + exportResult.error.cause : ''}`;
      return result;
    }
    await ffmpeg.saveSessionFile(exportResult.outputFile, STEP8_SOFTWARE_PATH);
    result.ok = true;
  } catch (e) {
    result.error = fullErrorText(e);
  } finally {
    await ffmpeg.destroy();
  }
  if (result.ok) {
    try {
      const verify = await verifyStep8SavedFile(STEP8_SOFTWARE_PATH, STEP8_TOTAL_DURATION_SEC, STEP8_FPS);
      Object.assign(result, verify);
    } catch (e) {
      result.error = `saved OK but post-save verify threw: ${fullErrorText(e)}`;
    }
  }
  log(`  software: ok=${result.ok} wallMs=${result.wallMs.toFixed(0)} error=${result.error ?? '(none)'} durationSec=${result.durationSec} durationOk=${result.durationOk} onDiskBytes=${result.onDiskBytes}`);
  return result;
}

async function runStep8QualityComparison(): Promise<void> {
  const el = document.getElementById('log');
  if (el) el.textContent = '';
  log('Step 8 quality-comparison spike starting...');
  const runtimeIsTauri = isTauri();
  log(`Runtime: ${runtimeIsTauri ? 'Tauri WebView (real IPC available)' : 'Chromium proxy via Vite dev server'}`);
  log(`navigator.userAgent: ${navigator.userAgent}`);
  void exfil('step8-runtime', { userAgent: navigator.userAgent, isTauri: runtimeIsTauri });

  const result: Record<string, unknown> = { userAgent: navigator.userAgent, isTauri: runtimeIsTauri };

  if (!runtimeIsTauri) {
    result.skipped = true;
    result.skipReason = 'Step 8 needs real Tauri IPC for all three export paths (ffmpeg sidecar for legacy AND for the new-path mux/remux/save) — nothing meaningful runs in the Chromium proxy.';
    log('SKIPPED: ' + (result.skipReason as string));
    (window as unknown as { __step8Result: unknown }).__step8Result = result;
    await exfil('step8-final', result);
    return;
  }

  try {
    log(`Building the diverse Step 8 test project (${STEP8_WIDTH}x${STEP8_HEIGHT}@${STEP8_FPS}fps, ${STEP8_TOTAL_DURATION_SEC}s / ${STEP8_TOTAL_DURATION_SEC * STEP8_FPS} frames)...`);
    const project = await buildStep8QualityProject();
    result.projectSummary = {
      segmentCount: project.segments.length,
      segmentIds: project.segments.map((s) => s.id),
      totalDurationSec: STEP8_TOTAL_DURATION_SEC,
      expectedFrames: STEP8_TOTAL_DURATION_SEC * STEP8_FPS,
    };

    log('Probing which rung of the hardware-first ladder this machine actually selects (same config exportWorker.ts itself would probe)...');
    const ladderProbe = await probeStep8HardwareLadderSelection(STEP8_WIDTH, STEP8_HEIGHT, STEP8_FPS);
    log(`  ladder probe: selectedRung=${ladderProbe.selectedRung ?? '(none supported!)'} attempts=[${ladderProbe.attempts.join(' | ')}]`);
    result.ladderProbe = ladderProbe;

    const legacy = await runStep8LegacyExport(project);
    result.legacy = legacy;
    const hardware = await runStep8HardwareExport(project);
    result.hardware = hardware;
    const software = await runStep8SoftwareExport(project);
    result.software = software;

    result.allRanOk = legacy.ok && hardware.ok && software.ok;
    log(
      `=== Step 8 export phase complete: legacy.ok=${legacy.ok} hardware.ok=${hardware.ok} software.ok=${software.ok} — ` +
        `saved to ${STEP8_LEGACY_PATH} / ${STEP8_HARDWARE_PATH} / ${STEP8_SOFTWARE_PATH} for host-side ffprobe/frame-compare ===`,
    );
  } catch (e) {
    const message = fullErrorText(e);
    result.error = message;
    log('STEP 8 SPIKE FAILED: ' + message);
  }

  (window as unknown as { __step8Result: unknown }).__step8Result = result;
  log('=== STEP 8 COMPLETE — full result at window.__step8Result ===');
  await exfil('step8-final', result);
  const fullLogText = document.getElementById('log')?.textContent ?? '(no #log element)';
  await exfil('step8-full-log', { text: fullLogText });
  log('=== Step 8 exfil POST sent ===');
}

// ===========================================================================
// STEP 9 — REAL-PROJECT EXPORT BOTTLENECK DIAGNOSTIC (throwaway, read-only
// measurement task). User report: a real 14-segment/33s project (4 video @
// 720p/24fps source, 10 images, cross-dissolve on all 13 boundaries, zoom-out
// on all, per-segment color grade on all, export at 1080p/24fps) took 116s
// with the WebCodecs toggle ON — Step 8's synthetic 360-frame/12s test
// implied a much bigger speedup than that. This step builds a project
// matching the user's real one as closely as this spike's fixtures allow,
// exports it via `exportProjectWebCodecsInstrumented` (this directory's own
// copy of the production orchestrator + worker, instrumented only, see that
// file's and `exportWorkerInstrumentedSpike.ts`'s own headers), and reports
// per-phase wall time so the dominant cost is visible instead of guessed.
//
// Source-fixture note (task's own instruction: "if you can't match the exact
// source, use the closest available and note the difference"): the only
// bundled real video fixture in this repo is `public/_spike/sample.mp4` —
// verified via `ffprobe` before writing this: H.264, 1280x720, 29.97fps
// (30000/1001), 10.4104s duration. The user's real source videos are
// 720p/24fps — same resolution, different (and slightly higher) source
// frame rate. This does NOT change which pipeline phase dominates (decode
// cost scales with how many source frames the decoder must step through per
// segment, which is comparable at 24 vs 29.97fps for a ~2.5s window), so the
// fixture is a reasonable stand-in for a BOTTLENECK-LOCATION diagnostic, but
// absolute per-segment decode times may run very slightly high vs. a true
// 24fps source. Reused 4 times with 4 different 2.5s trim windows (0-2.5,
// 2.5-5, 5-7.5, 7.5-10 — all inside the 10.4s source) so all 4 "video
// segments" are real, distinct decode workloads, not one cached repeat.
//
// 10 DISTINCT synthetic image assets (not 1 shared asset) — deliberately, so
// the image-bitmap-cache question (task item b) is a REAL test: if caching
// were broken, 10 distinct assets across ~2.3s each at 24fps (~55 frames
// each) would show 550 createImageBitmap calls instead of 10.
// ===========================================================================

const STEP9_WIDTH = 1920;
const STEP9_HEIGHT = 1080;
const STEP9_FPS = 24;
const STEP9_VIDEO_SEG_DURATION = 2.5; // x4 = 10s, fits inside the 10.4s source
const STEP9_IMAGE_SEG_DURATION = 2.3; // x10 = 23s
const STEP9_TRANSITION_DURATION = 0.5; // cross-dissolve on every one of the 13 boundaries
const STEP9_SAVE_PATH = '/tmp/kinetix-step9-diagnostic.mp4';

/** One distinctly-colored synthetic image per index — see this section's
 *  header for why these must be DISTINCT assets, not one shared swatch. */
function makeStep9ImageBlob(w: number, h: number, index: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('makeStep9ImageBlob: 2D context unavailable');
  const hue = (index * 37) % 360; // spread distinct hues across 10 indices
  ctx.fillStyle = `hsl(${hue}, 60%, 25%)`;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = `hsl(${hue}, 70%, 55%)`;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`IMG ${index}`, w / 2, h / 2);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('makeStep9ImageBlob: toBlob returned null'))), 'image/png');
  });
}

type Step9Kind = 'video' | 'image';

async function buildStep9RealisticProject(): Promise<{ project: Project; segmentKinds: Map<string, Step9Kind> }> {
  const resp = await fetch(SAMPLE_URL);
  if (!resp.ok) throw new Error(`could not fetch ${SAMPLE_URL} (${resp.status})`);
  const videoUrl = URL.createObjectURL(await resp.blob());
  const videoAsset: Asset = { id: 'step9-video', name: 'sample.mp4', url: videoUrl, type: 'video' };

  const imageAssets: Asset[] = [];
  for (let i = 0; i < 10; i++) {
    const blob = await makeStep9ImageBlob(STEP9_WIDTH, STEP9_HEIGHT, i);
    imageAssets.push({ id: `step9-image-${i}`, name: `swatch-${i}.png`, url: URL.createObjectURL(blob), type: 'image' });
  }

  // Pattern: V,I,I,V,I,I,I,V,I,I,I,V,I,I — 4 videos + 10 images = 14 segments,
  // an interleaved editing pattern rather than all-videos-then-all-images.
  const pattern: Step9Kind[] = ['video', 'image', 'image', 'video', 'image', 'image', 'image', 'video', 'image', 'image', 'image', 'video', 'image', 'image'];

  let videoIndex = 0;
  let imageIndex = 0;
  let cursor = 0;
  const segments: VideoSegment[] = [];
  const segmentKinds = new Map<string, Step9Kind>();

  for (let i = 0; i < pattern.length; i++) {
    const kind = pattern[i]!;
    const isLast = i === pattern.length - 1;
    const id = `step9-seg-${i}`;
    segmentKinds.set(id, kind);

    if (kind === 'video') {
      const trimStart = videoIndex * STEP9_VIDEO_SEG_DURATION;
      const trimEnd = trimStart + STEP9_VIDEO_SEG_DURATION;
      videoIndex++;
      segments.push({
        id,
        text: '',
        assetId: videoAsset.id,
        startTime: cursor,
        duration: STEP9_VIDEO_SEG_DURATION,
        transition: TransitionType.NONE,
        animation: AnimationType.NONE,
        order: i,
        trimStart,
        trimEnd,
        effectAnimation: 'zoom-out',
        effectAnimationScaleRate: 0.02,
        effectGrade: { brightness: 0.15, contrast: 0.12, saturation: 0.1, temperature: 0.05 },
        ...(isLast ? {} : { effectTransition: 'cross-dissolve', effectTransitionDuration: STEP9_TRANSITION_DURATION }),
      });
      cursor += STEP9_VIDEO_SEG_DURATION;
    } else {
      const asset = imageAssets[imageIndex]!;
      imageIndex++;
      segments.push({
        id,
        text: '',
        assetId: asset.id,
        startTime: cursor,
        duration: STEP9_IMAGE_SEG_DURATION,
        transition: TransitionType.NONE,
        animation: AnimationType.NONE,
        order: i,
        effectAnimation: 'zoom-out',
        effectAnimationScaleRate: 0.02,
        effectGrade: { brightness: 0.15, contrast: 0.12, saturation: 0.1, temperature: 0.05 },
        ...(isLast ? {} : { effectTransition: 'cross-dissolve', effectTransitionDuration: STEP9_TRANSITION_DURATION }),
      });
      cursor += STEP9_IMAGE_SEG_DURATION;
    }
  }

  const project: Project = {
    id: 'step9-diagnostic-project',
    name: 'Step 9 Real-Project Bottleneck Diagnostic',
    script: '',
    sceneDetails: '',
    segments,
    assets: [videoAsset, ...imageAssets],
    voiceoverId: undefined,
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: STEP9_TRANSITION_DURATION,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.6)', fontFamily: 'sans-serif' },
  };

  return { project, segmentKinds };
}

async function runStep9Diagnostic(): Promise<void> {
  const el = document.getElementById('log');
  if (el) el.textContent = '';
  log('Step 9 real-project bottleneck diagnostic starting...');
  const runtimeIsTauri = isTauri();
  log(`Runtime: ${runtimeIsTauri ? 'Tauri WebView (real IPC available)' : 'Chromium proxy via Vite dev server'}`);
  log(`navigator.userAgent: ${navigator.userAgent}`);
  void exfil('step9-runtime', { userAgent: navigator.userAgent, isTauri: runtimeIsTauri });

  const result: Record<string, unknown> = { userAgent: navigator.userAgent, isTauri: runtimeIsTauri };

  if (!runtimeIsTauri) {
    result.skipped = true;
    result.skipReason = 'Step 9 needs real Tauri IPC (ffmpeg sidecar for the WebCodecs mux/remux/append path) — nothing meaningful runs in the Chromium proxy.';
    log('SKIPPED: ' + (result.skipReason as string));
    (window as unknown as { __step9Result: unknown }).__step9Result = result;
    await exfil('step9-final', result);
    return;
  }

  try {
    log('Probing which rung of the hardware-first ladder this machine actually selects for the Step 9 export dimensions...');
    const ladderProbe = await probeStep8HardwareLadderSelection(STEP9_WIDTH, STEP9_HEIGHT, STEP9_FPS);
    log(`  ladder probe: selectedRung=${ladderProbe.selectedRung ?? '(none supported!)'} attempts=[${ladderProbe.attempts.join(' | ')}]`);
    result.ladderProbe = ladderProbe;

    log(`Building the Step 9 realistic 14-segment project (${STEP9_WIDTH}x${STEP9_HEIGHT}@${STEP9_FPS}fps export)...`);
    const { project, segmentKinds } = await buildStep9RealisticProject();
    const totalDurationSec = project.segments.reduce((max, s) => Math.max(max, s.startTime + s.duration), 0);
    log(`  project built: ${project.segments.length} segments, totalDurationSec=${totalDurationSec.toFixed(2)}`);
    result.projectSummary = {
      segmentCount: project.segments.length,
      videoCount: [...segmentKinds.values()].filter((k) => k === 'video').length,
      imageCount: [...segmentKinds.values()].filter((k) => k === 'image').length,
      totalDurationSec,
      expectedFrames: Math.round(totalDurationSec * STEP9_FPS),
    };

    const ffmpeg = await TauriFfmpeg.create();
    let exportResult: Awaited<ReturnType<typeof exportProjectWebCodecsInstrumented>> | null = null;
    let wallMs = 0;
    try {
      const wallStart = performance.now();
      exportResult = await exportProjectWebCodecsInstrumented(
        project,
        ffmpeg,
        { width: STEP9_WIDTH, height: STEP9_HEIGHT, fps: STEP9_FPS, savePath: STEP9_SAVE_PATH },
        (p) => log(`  progress: ${JSON.stringify(p)}`),
      );
      wallMs = performance.now() - wallStart;
    } finally {
      await ffmpeg.destroy();
    }

    const { result: exportOutcome, diagnostics } = exportResult;
    log(`Export outcome: ok=${exportOutcome.ok} wallMs=${wallMs.toFixed(0)}`);
    if (!exportOutcome.ok) {
      log(`  ERROR: ${exportOutcome.error.kind}: ${exportOutcome.error.message}${exportOutcome.error.cause ? ' — ' + exportOutcome.error.cause : ''}`);
    }

    // Routing table — cross-reference diagnostics.segmentRouting (produced by
    // the SAME routeSegments/groupConnectedComponents logic as production,
    // see exportPipelineWebCodecsInstrumentedSpike.ts's own header) with each
    // segment's kind (video/image) and position.
    const routingTable = diagnostics.segmentRouting.map((r, i) => ({
      index: i,
      segmentId: r.segmentId,
      kind: segmentKinds.get(r.segmentId) ?? 'unknown',
      individualTier: r.individualTier,
      finalTier: r.finalTier,
      downgradedByGrouping: r.downgradedByGrouping,
    }));
    log('Routing table:');
    for (const row of routingTable) {
      log(`  [${row.index}] ${row.segmentId} (${row.kind}): individual=${row.individualTier} final=${row.finalTier}${row.downgradedByGrouping ? ' (DOWNGRADED by grouping)' : ''}`);
    }

    log(`Pieces: ${diagnostics.pieces.length}`);
    for (const p of diagnostics.pieces) {
      log(
        `  piece[${p.pieceIndex}] tier=${p.tier} segments=[${p.segmentIds.join(',')}] expectedFrames=${p.expectedFrames} wallMs=${p.wallMs.toFixed(0)}` +
          (p.phaseTiming
            ? ` | decodeMs=${p.phaseTiming.decodeMs.toFixed(0)} uploadMs=${p.phaseTiming.uploadMs.toFixed(0)} compositeMs=${p.phaseTiming.compositeMs.toFixed(0)} (transition=${p.phaseTiming.compositeTransitionMs.toFixed(0)}/nonTransition=${p.phaseTiming.compositeNonTransitionMs.toFixed(0)}) textMs=${p.phaseTiming.textMs.toFixed(0)} backpressureWaitMs=${p.phaseTiming.backpressureWaitMs.toFixed(0)} (hits=${p.phaseTiming.backpressureHits}) frameConstructMs=${p.phaseTiming.frameConstructMs.toFixed(0)} encodeCallMs=${p.phaseTiming.encodeCallMs.toFixed(0)} frames=${p.phaseTiming.totalFrames} (transition=${p.phaseTiming.transitionFrames}/nonTransition=${p.phaseTiming.nonTransitionFrames}) imageBitmapCreateCounts=${JSON.stringify(p.phaseTiming.imageBitmapCreateCounts)} decodeCallCounts=${JSON.stringify(p.phaseTiming.decodeCallCounts)}`
            : ' | (no phase timing — non-GL piece)'),
      );
    }

    log(
      `Top-level phases: totalWallMs=${diagnostics.totalWallMs.toFixed(0)} routingMs=${diagnostics.routingMs.toFixed(2)} ` +
        `piecePlanningMs=${diagnostics.piecePlanningMs.toFixed(2)} encodeMs=${diagnostics.encodeMs.toFixed(0)} ` +
        `concatMs=${diagnostics.concatMs.toFixed(0)} frameCountGuardMs=${diagnostics.frameCountGuardMs.toFixed(0)} muxMs=${diagnostics.muxMs.toFixed(0)}`,
    );
    log(
      `IPC: totalCalls=${diagnostics.ipc.calls.length} appendFileRawCalls=${diagnostics.ipc.appendFileRawCalls} ` +
        `appendFileRawTotalMs=${diagnostics.ipc.appendFileRawTotalMs.toFixed(0)} appendFileRawAvgMs=${diagnostics.ipc.appendFileRawAvgMs.toFixed(2)} ` +
        `byMethod=${JSON.stringify(diagnostics.ipc.totalsByMethod)}`,
    );

    result.wallMs = wallMs;
    result.exportOk = exportOutcome.ok;
    result.exportError = exportOutcome.ok ? null : exportOutcome.error;
    result.routingTable = routingTable;
    result.pieces = diagnostics.pieces;
    result.topLevelPhases = {
      totalWallMs: diagnostics.totalWallMs,
      routingMs: diagnostics.routingMs,
      piecePlanningMs: diagnostics.piecePlanningMs,
      encodeMs: diagnostics.encodeMs,
      concatMs: diagnostics.concatMs,
      frameCountGuardMs: diagnostics.frameCountGuardMs,
      muxMs: diagnostics.muxMs,
    };
    // Full per-call IPC timing array can be large (~800 appendFileRaw calls) —
    // exfiltrate it, but keep the on-page log to the summary above.
    result.ipc = diagnostics.ipc;
  } catch (e) {
    const message = fullErrorText(e);
    result.error = message;
    log('STEP 9 DIAGNOSTIC FAILED: ' + message);
  }

  (window as unknown as { __step9Result: unknown }).__step9Result = result;
  log('=== STEP 9 COMPLETE — full result at window.__step9Result ===');
  await exfil('step9-final', result);
  const fullLogText = document.getElementById('log')?.textContent ?? '(no #log element)';
  await exfil('step9-full-log', { text: fullLogText });
  log('=== Step 9 exfil POST sent ===');
}

document.getElementById('rerun')?.addEventListener('click', () => void main());

// Step 8/9 are gated behind ?step=8 / ?step=9 so they don't force a re-run of
// the already-reviewed Steps 3-7 above (see this file's own Step 8/9 header
// comments) — this spike's normal load (Steps 3-7) and both `?step=` values
// are real, non-fabricated runs; the query param only selects WHICH one runs.
const stepParam = new URLSearchParams(location.search).get('step');
if (stepParam === '8') {
  void runStep8QualityComparison();
} else if (stepParam === '9') {
  void runStep9Diagnostic();
} else {
  void main();
}
