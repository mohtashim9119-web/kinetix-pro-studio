/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sequential, in-order VideoFrame decode for the WebCodecs+WebGL2 export
 * worker pipeline (docs/webcodecs-export-plan.md §4.2). This is Step 1 of
 * that plan — a standalone decode source, not yet wired to any worker or
 * compositor.
 *
 * Deliberately NOT a retrofit of videoDecoderPool.ts. That module's
 * windowed decode-ahead / LRU-across-sessions / decoder-handle-reuse
 * machinery exists to serve a scrubbable, randomly-seekable PREVIEW
 * timeline shared across many segments. Export has none of those
 * requirements — it walks each GL-compositable run's source range exactly
 * once, start to end, and wants the simplest possible decoder that can do
 * that reliably. So this file drives one dedicated VideoDecoder per call,
 * with no pooling and no contention with preview's own decoders.
 *
 * Reused from the preview stack (read end-to-end before touching this
 * file): `getOrCreateDemux` (../videoDemuxer.ts) for the chunk list +
 * decoder config, and `findChunkRange` (../videoDecoderPool.ts) for
 * keyframe-backed range selection — the same "back up to the last
 * keyframe at or before startSec, include one chunk past endSec as
 * reorder margin" logic the preview pool already relies on. Both are pure
 * with respect to this file (no shared mutable state, no session/window
 * concept crosses the boundary).
 *
 * Worker-safe: no DOM, no React, no `window`/`document` reference anywhere
 * in this file. Only WebCodecs globals (VideoDecoder/VideoFrame/
 * EncodedVideoChunk), which exist identically on `self` in a dedicated
 * worker and on `window` on the main thread.
 */

import { getOrCreateDemux } from '../videoDemuxer';
import { findChunkRange } from '../videoDecoderPool';

/** Bounds how many decoded-but-not-yet-yielded VideoFrames this generator
 *  will hold at once. VideoDecoder output can arrive faster than the
 *  consumer (GL upload + encode) drains it; without a cap, decode would
 *  race ahead and accumulate an unbounded number of live VideoFrame
 *  buffers (real GPU/CPU memory, not just bytes) in this generator's
 *  internal queue. Chosen per plan §4.2 ("≤ 8 undelivered frames"). */
const DECODE_AHEAD_CAP = 8;

export interface DecodeSegmentFramesOptions {
  /** Called once per frame actually yielded, with the running count and an
   *  approximate total (see `estimateFrameCount` below) — a hint for
   *  progress UI, not a contract. VFR content or the keyframe-preroll
   *  margin can make the real yielded count differ slightly from this
   *  estimate. */
  onProgress?: (decoded: number, total: number) => void;
}

/**
 * Pure frame-count estimate for source time [startSec, endSec) — the
 * number of samples whose presentation timestamp actually falls in that
 * window, restricted to the keyframe-backed chunk range `findChunkRange`
 * selects for it. Exported (rather than left inline in
 * `decodeSegmentFrames`) purely so this one piece of new, non-decoder
 * logic in this file is unit-testable on its own.
 *
 * This is a proxy for "expected frame count", not the literal chunk range
 * size: `findChunkRange`'s `endIndex` intentionally includes one chunk of
 * margin past `endSec` (B-frame/reorder headroom for the decoder), which
 * would over-count by one if used directly — filtering by actual
 * timestamp keeps the estimate tight for CFR content (VFR is a hint only,
 * per the exported generator's own contract).
 */
export function estimateFrameCount(
  chunks: readonly EncodedVideoChunk[],
  startSec: number,
  endSec: number,
): number {
  const { startIndex, endIndex } = findChunkRange(chunks, startSec, endSec);
  if (startIndex > endIndex) return 0;
  const startUs = startSec * 1e6;
  const endUs = endSec * 1e6;
  return chunks
    .slice(startIndex, endIndex + 1)
    .filter((c) => c.timestamp >= startUs && c.timestamp < endUs).length;
}

/**
 * Yields VideoFrames in presentation order (ascending `frame.timestamp`,
 * microseconds) covering source time [startSec, endSec) of the video
 * asset at `assetUrl`.
 *
 * Contract (see file header + docs/webcodecs-export-plan.md §4.2):
 *  - The consumer MUST call `frame.close()` on every yielded frame once
 *    done with it. This generator never closes a frame after handing it
 *    to the caller via `yield`.
 *  - Breaking the `for await` loop early (or calling `.return()`/`.throw()`
 *    on the generator) is safe: the `finally` block below stops the feed
 *    loop, closes any frames still buffered internally (never yielded, so
 *    never the consumer's responsibility), and closes the decoder.
 *  - Errors (demux failure, decoder configure/decode failure) throw out of
 *    the generator — a `for await` over it will see them as a normal
 *    thrown exception. Never swallowed.
 */
export async function* decodeSegmentFrames(
  assetUrl: string,
  startSec: number,
  endSec: number,
  options: DecodeSegmentFramesOptions = {},
): AsyncGenerator<VideoFrame> {
  let demuxed;
  try {
    demuxed = await getOrCreateDemux(assetUrl);
  } catch (err) {
    throw new Error(
      `sequentialDecode: demux failed for ${assetUrl} [${startSec}s-${endSec}s]: ${(err as Error).message}`,
    );
  }
  const { chunks, config } = demuxed;

  // findChunkRange backs startIndex up to the keyframe at or before
  // startSec (a VideoDecoder can only begin decoding at a sync sample) and
  // includes one chunk past endSec as B-frame/reorder margin — the exact
  // preroll logic videoDecoderPool.ts's getFrameAt already relies on, and
  // the reason we reuse it rather than re-deriving keyframe lookup here.
  const { startIndex, endIndex } = findChunkRange(chunks, startSec, endSec);
  if (startIndex > endIndex) return; // nothing to decode in this range (e.g. empty/degenerate asset)

  const startUs = startSec * 1e6;
  const endUs = endSec * 1e6;
  const totalExpected = estimateFrameCount(chunks, startSec, endSec);

  // Frames the decoder has already output but this generator has not yet
  // handed to the consumer via `yield`. Presentation-order already,
  // because the WebCodecs spec requires VideoDecoder output callbacks to
  // fire in presentation order (the browser resolves any B-frame/decode-
  // order reshuffling internally) — videoDecoderPool.ts's own BufferedFrame
  // array relies on this same guarantee ("ascending by timestampSec
  // (decoder output order)"), so no manual PTS-sort buffer is needed here.
  const outputQueue: VideoFrame[] = [];

  let fatalError: Error | null = null;
  // Set once decoder.flush() (feed loop, true end-of-range only) has
  // resolved — at that point every frame this decode will ever produce has
  // already reached `outputQueue` via the output callback, per the flush
  // semantics documented in videoDecoderPool.ts's feedWindow.
  let flushed = false;
  // Set the moment this generator is torn down (normal completion or an
  // early break/.return()) — guards the feed loop and the output callback
  // against doing any more work once cleanup has started.
  let stopped = false;
  let wake: (() => void) | null = null;

  function signalChange(): void {
    if (wake) {
      const fn = wake;
      wake = null;
      fn();
    }
  }

  const decoder = new VideoDecoder({
    output: (frame) => {
      if (stopped) {
        frame.close();
        return;
      }
      if (frame.timestamp < startUs) {
        // Keyframe-preroll frame decoded only to seed the GOP — never
        // shown, closed immediately rather than buffered.
        frame.close();
        signalChange();
        return;
      }
      outputQueue.push(frame);
      signalChange();
    },
    error: (e) => {
      fatalError = new Error(
        `sequentialDecode: VideoDecoder error for ${assetUrl} [${startSec}s-${endSec}s] (chunks ${startIndex}-${endIndex}): ${e.message}`,
      );
      signalChange();
    },
  });

  try {
    decoder.configure(config);
  } catch (err) {
    try {
      decoder.close();
    } catch {
      // Configure failed before any state change that would make close() unsafe — best-effort only.
    }
    throw new Error(
      `sequentialDecode: VideoDecoder.configure failed for ${assetUrl} (codec=${config.codec}): ${(err as Error).message}`,
    );
  }

  // Feed loop: pushes encoded chunks into the decoder from startIndex to
  // endIndex, pausing whenever `outputQueue` is at DECODE_AHEAD_CAP (the
  // backpressure the plan requires) and resuming as soon as the consumer
  // drains a frame (see the `yield` loop below, which calls
  // signalChange() right after shifting a frame out). flush() is called
  // exactly once, only after every chunk in range has been fed — never
  // mid-loop to "catch up" — per the flush-after-continuation hazard
  // documented in videoDecoderPool.ts's feedWindow (a real VideoDecoder
  // throws synchronously if decode() is called with a non-keyframe chunk
  // right after a settled flush()). Since this generator never continues
  // feeding after its one flush(), that hazard cannot arise here.
  const feedDone = (async () => {
    try {
      for (let i = startIndex; i <= endIndex; i++) {
        while (outputQueue.length >= DECODE_AHEAD_CAP && !stopped && !fatalError) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        if (stopped || fatalError) return;
        decoder.decode(chunks[i]!);
      }
      if (!stopped && !fatalError) {
        await decoder.flush();
      }
    } catch (err) {
      if (!fatalError) {
        fatalError = new Error(
          `sequentialDecode: decode/flush failed for ${assetUrl} [${startSec}s-${endSec}s] (chunks ${startIndex}-${endIndex}): ${(err as Error).message}`,
        );
      }
    } finally {
      flushed = true;
      signalChange();
    }
  })();

  let yieldedCount = 0;
  try {
    while (true) {
      if (fatalError) throw fatalError as Error;

      if (outputQueue.length > 0) {
        const frame = outputQueue.shift()!;
        yieldedCount++;
        options.onProgress?.(yieldedCount, totalExpected);
        // Free a decode-ahead slot for the feed loop before yielding —
        // the consumer may not resume us (via .next()) for a while.
        signalChange();
        yield frame;
        continue;
      }

      if (flushed) return; // fully fed, decoder drained, nothing left to ever arrive

      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    // Runs on BOTH normal completion and early termination (caller break /
    // .return() / .throw()) — safe either way since by normal completion
    // the feed loop has already finished and outputQueue is already empty.
    stopped = true;
    signalChange();
    await feedDone.catch(() => {});
    for (const frame of outputQueue) frame.close();
    outputQueue.length = 0;
    try {
      if (decoder.state !== 'closed') decoder.close();
    } catch {
      // Already closed (e.g. the decoder's own error callback path) — safe to ignore.
    }
    // No per-asset demux release: getOrCreateDemux's cache has no
    // ref-counted "release" API (only a global clearDemuxCache, which
    // would be wrong to call here — it's a shared, long-lived cache also
    // used by preview). Nothing to release for a single call's exit.
  }
}
