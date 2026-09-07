/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wraps mp4box.js to turn an asset URL/blob into a seekable sequence of
 * EncodedVideoChunks + a VideoDecoder config (codec/dimensions/description)
 * + track duration. This is the WebCodecs preview path's only demuxer —
 * see docs/webcodecs-architecture-plan.md Section 1.4 for why WebCodecs
 * itself has no container parser.
 *
 * Carries forward the two real bugs found and fixed in the Phase 0 spike
 * (src/dev/webcodecsSpike/main.ts) — both produced total silence (zero
 * decoded frames, zero thrown errors), not an exception, so a future
 * change here that reintroduces either is easy to misdiagnose as a
 * WebCodecs/browser limitation rather than a demuxer integration bug:
 *
 *   (a) setExtractionOptions()/start() must be called from inside onReady,
 *       and never followed by mp4boxFile.flush() for a single whole-file
 *       appendBuffer(). Calling mp4box's flush() after a single append
 *       discards buffered mdat bytes before extraction runs — flush() is
 *       for signaling end-of-stream in the incremental/fragmented case,
 *       not needed (and actively harmful) for a one-shot append.
 *   (b) createFile(true) — keepMdatData. The default (false) discards the
 *       raw buffer bytes mp4box has already box-parsed, on the assumption
 *       a streamed caller re-supplies mdat bytes progressively. For a
 *       single whole-file appendBuffer() that leaves ISOFile.getSample()
 *       with nothing to read samples back from.
 *
 * Demuxer instances are cached/reused per unique asset URL — mirrors the
 * getOrCreateVideo dedup pattern in frameRenderer.ts.
 */

import { createFile, MP4BoxBuffer, DataStream, Endianness, type Movie, type Track } from 'mp4box';

/** Track narrowed to a video track (video field present) — mp4box's generic
 *  Track type makes `video` optional since it also covers audio/subtitle/metadata tracks. */
type VideoTrack = Track & { video: { width: number; height: number } };

export interface DemuxedVideo {
  /** Ready to pass directly to `new VideoDecoder(...).configure(config)`. */
  config: VideoDecoderConfig;
  /** All samples for the video track, in container (decode) order, as
   *  EncodedVideoChunks — timestamps are presentation time in microseconds. */
  chunks: EncodedVideoChunk[];
  /** Track duration in seconds. */
  durationSec: number;
  /** Wall ms of `fetch` + `arrayBuffer` for this URL (first demux only). */
  fetchMs?: number;
  /** Wall ms of mp4box `appendBuffer`/parse until onSamples resolves. */
  parseMs?: number;
}

const demuxCache = new Map<string, Promise<DemuxedVideo>>();

/** True when `url` already has an in-flight or resolved cache entry. */
export function demuxCacheHas(url: string): boolean {
  return demuxCache.has(url);
}

/** Number of unique-URL demuxers currently resident in the module cache. */
export function demuxCacheSize(): number {
  return demuxCache.size;
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
  throw new Error('videoDemuxer: avcC/hvcC box not found on video track');
}

async function demux(url: string): Promise<DemuxedVideo> {
  const fetchStarted = performance.now();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`videoDemuxer: fetch failed (${resp.status}) for ${url}`);
  const buf = await resp.arrayBuffer();
  const fetchMs = performance.now() - fetchStarted;

  // Fix (b) — see file header. Required for a single whole-file appendBuffer().
  const mp4boxFile = createFile(true);
  const chunks: EncodedVideoChunk[] = [];
  let videoTrack: VideoTrack | null = null;
  let config: VideoDecoderConfig | null = null;
  let received = 0;

  const parseStarted = performance.now();
  await new Promise<void>((resolve, reject) => {
    mp4boxFile.onError = (module: string, msg: string) => {
      reject(new Error(`mp4box error [${module}]: ${msg}`));
    };

    mp4boxFile.onSamples = (_id: number, _user: unknown, samples) => {
      for (const sample of samples) {
        if (!sample.data) continue;
        chunks.push(
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
        reject(new Error('videoDemuxer: no video track found in asset'));
        return;
      }
      videoTrack = t as VideoTrack;

      const description = getDescription(mp4boxFile, videoTrack);
      config = {
        codec: videoTrack.codec,
        codedWidth: videoTrack.video.width,
        codedHeight: videoTrack.video.height,
        description,
      };

      // Fix (a) — see file header. Called from inside onReady; no flush() call
      // anywhere in this function for this single whole-file append.
      mp4boxFile.setExtractionOptions(videoTrack.id, null, { nbSamples: videoTrack.nb_samples });
      mp4boxFile.start();

      // A zero-sample track (nb_samples === 0) would otherwise never resolve —
      // onSamples never fires with nothing to extract.
      if (videoTrack.nb_samples === 0) resolve();
    };

    const mp4boxBuf = MP4BoxBuffer.fromArrayBuffer(buf, 0);
    mp4boxFile.appendBuffer(mp4boxBuf);
  });
  const parseMs = performance.now() - parseStarted;

  if (!config || !videoTrack) {
    throw new Error('videoDemuxer: failed to extract a valid track config');
  }
  const track: VideoTrack = videoTrack;

  return {
    config,
    chunks,
    durationSec: track.duration / track.timescale,
    fetchMs,
    parseMs,
  };
}

/**
 * Returns the demuxed chunks/config for `url`, demuxing at most once per
 * unique URL — subsequent calls (e.g. multiple segments trimmed from the
 * same source file) reuse the same in-flight or resolved promise. Mirrors
 * frameRenderer.ts's getOrCreateVideo dedup pattern.
 */
export function getOrCreateDemux(url: string): Promise<DemuxedVideo> {
  let entry = demuxCache.get(url);
  if (!entry) {
    entry = demux(url).catch((err) => {
      // Don't poison the cache with a failed demux — allow a later retry
      // (e.g. transient fetch failure) instead of permanently failing this URL.
      demuxCache.delete(url);
      throw err;
    });
    demuxCache.set(url, entry);
  }
  return entry;
}

export function clearDemuxCache(): void {
  demuxCache.clear();
}

/**
 * Drops ONE url's cache entry, returning true if there was one to drop.
 *
 * WS3 Defect 6. `decodeSegmentFrames` deliberately released nothing on exit —
 * its own comment says the cache "has no ref-counted release API (only a global
 * clearDemuxCache, which would be wrong to call here — it's a shared,
 * long-lived cache also used by preview)". That reasoning is correct about
 * `clearDemuxCache` and about the MAIN THREAD, and it is why the release below
 * is per-url and why the caller, not this module, decides when an asset is
 * finished.
 *
 * The realm argument that makes a caller-driven release safe: `demuxCache` is
 * MODULE state, and the export worker (`exportWorker.ts`) is a dedicated Worker
 * with its own module instance of this file. Preview (`videoDecoderPool.ts`,
 * main thread) holds a different Map entirely. So an export releasing a url it
 * has finished with cannot evict anything preview is using, and cannot be
 * evicted by preview either.
 *
 * A released url is not poisoned: `getOrCreateDemux` re-demuxes on the next
 * call. So a caller that releases too eagerly pays a re-fetch/re-parse, never a
 * failure — release is a memory decision, not a correctness one.
 */
export function releaseDemux(url: string): boolean {
  return demuxCache.delete(url);
}
