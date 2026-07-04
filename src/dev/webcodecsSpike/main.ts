/**
 * THROWAWAY — Phase 0 WebCodecs feasibility spike.
 *
 * Not imported by any real app code (App.tsx, PreviewStage.tsx, etc. are untouched).
 * Demuxes a real MP4 asset via mp4box.js, decodes it with WebCodecs VideoDecoder,
 * paints frames to a bare <canvas>, and checks the four things Section 1.5 of
 * docs/webcodecs-architecture-plan.md requires before Phase 1 can proceed:
 *   1. VideoDecoder exists and a real configure()/decode() cycle succeeds.
 *   2. mp4box.js correctly extracts chunks + avcC description from a real asset.
 *   3. Decoded VideoFrames paint to canvas.
 *   4. Frames arrive in correct presentation order despite a real B-frame GOP
 *      (verified via ffprobe on the source asset: I,B,B,B,P,B,B,B,P... pattern).
 *
 * Delete this file (and spike-webcodecs.html, public/_spike/) once Phase 0 is reviewed.
 */

import { createFile, MP4BoxBuffer, DataStream, Endianness, type Movie, type Track } from 'mp4box';

/** Track narrowed to a video track (video field present) — mp4box's generic Track type
 *  makes `video` optional since it covers audio/subtitle/metadata tracks too. */
type VideoTrack = Track & { video: { width: number; height: number } };

const SAMPLE_URL = '/_spike/sample.mp4';

interface SpikeResult {
  videoDecoderSupported: boolean;
  configSupported: boolean | null;
  codec: string | null;
  codedWidth: number | null;
  codedHeight: number | null;
  chunksFed: number;
  framesDecoded: number;
  decodeMs: number | null;
  fps: number | null;
  feedOrderCtsMs: number[];
  outputOrderTsMs: number[];
  outputOrderIsMonotonic: boolean | null;
  error: string | null;
}

function freshResult(): SpikeResult {
  return {
    videoDecoderSupported: false,
    configSupported: null,
    codec: null,
    codedWidth: null,
    codedHeight: null,
    chunksFed: 0,
    framesDecoded: 0,
    decodeMs: null,
    fps: null,
    feedOrderCtsMs: [],
    outputOrderTsMs: [],
    outputOrderIsMonotonic: null,
    error: null,
  };
}

// Counts invocations of runSpike() — logged on every run so a repeat/duplicate
// invocation (e.g. from HMR re-executing this entry script without a full page
// reload) is immediately visible in the log rather than silently corrupting a
// shared result object. This bit us once already: an earlier version of this file
// declared `result` at module scope and never reset it per-run, so a page that
// re-ran the spike multiple times without a full navigation accumulated frame
// counts across runs (e.g. 936 = 3 × the real 312-sample count) and made a
// perfectly correct per-run monotonic sequence look like a reordering failure
// when checked across the concatenated total. Every run now gets its own fresh
// SpikeResult object (see runSpike below) so this class of bug can't recur.
let runInvocationCount = 0;

function log(msg: string): void {
  const el = document.getElementById('log');
  if (el) el.textContent += '\n' + msg;
  // eslint-disable-next-line no-console
  console.log('[SPIKE] ' + msg);
}

function getDescription(isoFile: ReturnType<typeof createFile>, track: VideoTrack): Uint8Array {
  const trak = isoFile.getTrackById(track.id);
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = (entry as unknown as Record<string, { write: (s: DataStream) => void } | undefined>).avcC
      ?? (entry as unknown as Record<string, { write: (s: DataStream) => void } | undefined>).hvcC;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // strip box header
    }
  }
  throw new Error('avcC/hvcC box not found on video track');
}

async function runSpike(): Promise<void> {
  runInvocationCount++;
  const result = freshResult();
  (window as unknown as { __spikeResult: SpikeResult }).__spikeResult = result;

  const logEl = document.getElementById('log');
  if (logEl) logEl.textContent = '';
  log(`--- WebCodecs Phase 0 Spike (run #${runInvocationCount}) ---`);

  result.videoDecoderSupported = typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
  log(`Check 1 — VideoDecoder/EncodedVideoChunk present: ${result.videoDecoderSupported}`);
  if (!result.videoDecoderSupported) {
    log('ABORT: VideoDecoder not available in this runtime. This is exactly the fallback case Section 1.6 plans for.');
    return;
  }

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  let decodeStartedAt: number | null = null;
  let lastOutputAt: number | null = null;

  const decoder = new VideoDecoder({
    output(frame) {
      result.framesDecoded++;
      const tsMs = frame.timestamp / 1000;
      result.outputOrderTsMs.push(tsMs);
      lastOutputAt = performance.now();
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#00ff66';
      ctx.font = '16px monospace';
      ctx.fillText(`frame #${result.framesDecoded}  pts=${tsMs.toFixed(1)}ms`, 10, 20);
      frame.close();
    },
    error(e) {
      result.error = e.message;
      log('DECODER ERROR: ' + e.message);
    },
  });

  try {
    log('Fetching real Pexels-sourced H.264 MP4 asset (confirmed via ffprobe: High profile, yuv420p, B-frame GOP)...');
    const resp = await fetch(SAMPLE_URL);
    if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    log(`Fetched ${(buf.byteLength / 1024 / 1024).toFixed(2)} MiB`);

    // createFile(true) — keepMdatData. mp4box.js defaults to discarding the raw buffer
    // bytes it has already box-parsed (createFile()'s default keepMdatData=false), on the
    // assumption that a streamed/incremental caller re-supplies mdat bytes progressively.
    // Diagnosed via window.__mp4boxFile in the browser console: with the default false,
    // f.stream.buffers.length was 0 and f.mdats[0].stream was undefined after a single
    // whole-file appendBuffer() call, so ISOFile.getSample() had nowhere left to read
    // sample bytes from — onSamples never fired even though the full 312-entry sample
    // table (offsets/sizes/timing) was built correctly. keepMdatData=true retains the
    // buffer so a single-shot (non-streamed) appendBuffer() actually works.
    const mp4boxFile = createFile(true);
    // Exposed for interactive debugging via the browser console (window.__mp4boxFile).
    (window as unknown as { __mp4boxFile: unknown }).__mp4boxFile = mp4boxFile;
    let videoTrack: VideoTrack | null = null;
    let received = 0;

    // setExtractionOptions()+start() are called from inside onReady, and there is
    // deliberately no flush() call anywhere in this function — onReady already fires once
    // the full moov box has been parsed from the single whole-file appendBuffer() call, and
    // flush() is for signaling end-of-stream in the incremental/fragmented case the official
    // demo is built for.
    await new Promise<void>((resolve, reject) => {
      mp4boxFile.onError = (module: string, msg: string) => {
        reject(new Error(`mp4box error [${module}]: ${msg}`));
      };

      mp4boxFile.onSamples = (_id: number, _user: unknown, samples) => {
        for (const sample of samples) {
          if (!sample.data) continue;
          result.chunksFed++;
          const ctsMs = (1e6 * sample.cts) / sample.timescale / 1000;
          if (result.feedOrderCtsMs.length < 32) result.feedOrderCtsMs.push(ctsMs);
          decoder.decode(
            new EncodedVideoChunk({
              type: sample.is_sync ? 'key' : 'delta',
              timestamp: (1e6 * sample.cts) / sample.timescale,
              duration: (1e6 * sample.duration) / sample.timescale,
              data: sample.data,
            }),
          );
        }
        received += samples.length;
        if (videoTrack && received >= videoTrack.nb_samples) resolve();
      };

      mp4boxFile.onReady = (info: Movie) => {
        const t = info.videoTracks[0];
        if (!t || !t.video) {
          reject(new Error('no video track found in asset'));
          return;
        }
        videoTrack = t as VideoTrack;
        log(
          `Check 2 — mp4box demux ready: codec=${videoTrack.codec} ${videoTrack.video.width}x${videoTrack.video.height} nb_samples=${videoTrack.nb_samples}`,
        );

        const description = getDescription(mp4boxFile, videoTrack);
        result.codec = videoTrack.codec;
        result.codedWidth = videoTrack.video.width;
        result.codedHeight = videoTrack.video.height;

        const config: VideoDecoderConfig = {
          codec: videoTrack.codec,
          codedWidth: videoTrack.video.width,
          codedHeight: videoTrack.video.height,
          description,
        };

        void (async () => {
          const supportCheck = await VideoDecoder.isConfigSupported(config);
          result.configSupported = supportCheck.supported ?? false;
          log(`isConfigSupported: ${JSON.stringify(supportCheck.supported)}`);
          if (!result.configSupported || !videoTrack) {
            reject(new Error('config not supported by this runtime'));
            return;
          }

          decoder.configure(config);
          log('Decoder configured. Feeding EncodedVideoChunks in container (decode) order...');
          mp4boxFile.setExtractionOptions(videoTrack.id, null, { nbSamples: videoTrack.nb_samples });
          decodeStartedAt = performance.now();
          mp4boxFile.start();
        })();
      };

      const mp4boxBuf = MP4BoxBuffer.fromArrayBuffer(buf, 0);
      mp4boxFile.appendBuffer(mp4boxBuf);
    });

    log(`Chunks fed: ${result.chunksFed}`);
    await decoder.flush();

    const isMonotonic = result.outputOrderTsMs.every((v, i) => i === 0 || v >= result.outputOrderTsMs[i - 1]!);
    result.outputOrderIsMonotonic = isMonotonic;

    if (decodeStartedAt !== null && lastOutputAt !== null) {
      result.decodeMs = lastOutputAt - decodeStartedAt;
      result.fps = result.framesDecoded / (result.decodeMs / 1000);
    }

    log(`Check 3 — frames painted to canvas: ${result.framesDecoded}`);
    log(
      `Check 4 — output order monotonic (correct B-frame reordering): ${isMonotonic}` +
        (isMonotonic ? '' : '  <-- FAIL: frames arrived out of presentation order'),
    );
    log(`Feed order (decode order) first 32 cts, ms: [${result.feedOrderCtsMs.map((v) => v.toFixed(0)).join(', ')}]`);
    log(
      `Output order (presentation order) first 32 ts, ms: [${result.outputOrderTsMs
        .slice(0, 32)
        .map((v) => v.toFixed(0))
        .join(', ')}]`,
    );
    log(`Decode wall time: ${result.decodeMs?.toFixed(1)}ms for ${result.framesDecoded} frames`);
    log(`Throughput: ${result.fps?.toFixed(1)} fps`);
    log('--- Spike complete. See window.__spikeResult for the full structured result. ---');
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    log('SPIKE FAILED: ' + result.error);
  }
}

document.getElementById('rerun')?.addEventListener('click', () => void runSpike());
void runSpike();
