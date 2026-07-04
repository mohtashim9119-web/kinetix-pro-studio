/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Owns VideoDecoder instance lifecycle for the WebCodecs preview path:
 * configure, decode-ahead scheduling, output frame queueing, and — the
 * single most important correctness rule in this module — explicit
 * VideoFrame.close() discipline. A decoded VideoFrame is a GPU/CPU-backed
 * buffer (docs/webcodecs-architecture-plan.md Section 4.2); one that is
 * never closed is a hard memory leak, not just inefficiency, because the
 * GC does not reliably reclaim it promptly.
 *
 * Phase 1+2 scope (per the plan): decode-ahead for exactly ONE segment
 * ahead — the direct generalization of the legacy dual `<video>`-slot
 * ping-pong, not the full multi-second windowed cache Phase 6 builds.
 * Each session here decodes its whole segment's trimmed frame range up
 * front (bounded by MAX_SESSION_FRAMES as a safety cap) rather than a
 * rolling few-second window — acceptable at today's typical segment
 * lengths, and explicitly flagged in the architecture doc's progress
 * tracker as the piece Phase 6 replaces with real LRU windowing for
 * 500+ segment scale.
 *
 * This pool is deliberately segment-count-agnostic (sessions are keyed by
 * caller-supplied segmentId) — enforcing "keep only current + next"
 * eviction is the caller's job (useWebCodecsPreview.ts), via releaseSession.
 */

import { getOrCreateDemux } from './videoDemuxer';

/** Safety cap on frames buffered per session — guards against a single very
 *  long segment exhausting memory before Phase 6's real windowed cache
 *  exists. ~20s at 30fps; generous for this app's typical per-segment
 *  lengths (voiceover-script-line-scale, usually a few seconds). */
const MAX_SESSION_FRAMES = 600;

interface BufferedFrame {
  frame: VideoFrame;
  timestampSec: number;
}

interface DecodeSession {
  assetUrl: string;
  startSec: number;
  endSec: number;
  decoder: VideoDecoder | null;
  frames: BufferedFrame[]; // ascending by timestampSec (decoder output order)
  displayedFrame: VideoFrame | null; // currently checked-out frame; also present in `frames` until superseded
  ready: Promise<void>;
  closed: boolean;
}

/** Finds the chunk range [startIndex, endIndex] (inclusive) to feed a decoder
 *  so it can produce frames covering source time [startSec, endSec].
 *  VideoDecoder can only begin decoding at a sync (key) sample, so
 *  startIndex backs up to the last keyframe at or before startSec.
 *  endIndex includes one chunk past endSec as a margin (B-frame GOPs can
 *  need a little source data beyond the last requested presentation time). */
export function findChunkRange(
  chunks: readonly EncodedVideoChunk[],
  startSec: number,
  endSec: number,
): { startIndex: number; endIndex: number } {
  if (chunks.length === 0) return { startIndex: 0, endIndex: -1 };
  const startUs = startSec * 1e6;
  const endUs = endSec * 1e6;

  let startIndex = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    if (chunk.timestamp > startUs) break;
    if (chunk.type === 'key') startIndex = i;
  }

  let endIndex = chunks.length - 1;
  for (let i = startIndex; i < chunks.length; i++) {
    if (chunks[i]!.timestamp > endUs) {
      endIndex = i;
      break;
    }
  }

  endIndex = Math.min(endIndex, startIndex + MAX_SESSION_FRAMES - 1, chunks.length - 1);
  return { startIndex, endIndex };
}

export class VideoDecoderPool {
  private sessions = new Map<string, DecodeSession>();

  /**
   * Ensures a decode session exists for `segmentId`, decoding the chunk
   * range of `assetUrl` covering source time [startSec, endSec]. Idempotent
   * for an unchanged range — safe to call on every render.
   */
  ensureSession(segmentId: string, assetUrl: string, startSec: number, endSec: number): Promise<void> {
    const existing = this.sessions.get(segmentId);
    if (
      existing &&
      !existing.closed &&
      existing.assetUrl === assetUrl &&
      existing.startSec === startSec &&
      existing.endSec === endSec
    ) {
      return existing.ready;
    }
    if (existing) this.closeSession(existing);

    const session: DecodeSession = {
      assetUrl,
      startSec,
      endSec,
      decoder: null,
      frames: [],
      displayedFrame: null,
      ready: Promise.resolve(),
      closed: false,
    };
    session.ready = this.startSession(session, assetUrl, startSec, endSec);
    this.sessions.set(segmentId, session);
    return session.ready;
  }

  private async startSession(
    session: DecodeSession,
    assetUrl: string,
    startSec: number,
    endSec: number,
  ): Promise<void> {
    const demuxed = await getOrCreateDemux(assetUrl);
    if (session.closed) return; // released while demuxing

    const decoder = new VideoDecoder({
      output: (frame) => {
        if (session.closed || session.frames.length >= MAX_SESSION_FRAMES) {
          frame.close();
          return;
        }
        session.frames.push({ frame, timestampSec: frame.timestamp / 1e6 });
      },
      error: (e) => {
        console.error('[videoDecoderPool] decoder error:', e.message);
      },
    });
    session.decoder = decoder;

    if (session.closed) {
      decoder.close();
      return;
    }

    decoder.configure(demuxed.config);
    const { startIndex, endIndex } = findChunkRange(demuxed.chunks, startSec, endSec);
    for (let i = startIndex; i <= endIndex; i++) {
      decoder.decode(demuxed.chunks[i]!);
    }
    if (endIndex >= startIndex) {
      await decoder.flush();
    }
  }

  /**
   * Returns the frame to display at `targetSec` (source time, seconds) for
   * `segmentId`'s session — the latest buffered frame at or before
   * targetSec — or null if the session isn't ready or has no frames.
   * Every frame this supersedes (buffered-but-now-stale, or the previously
   * displayed frame) is closed synchronously before returning.
   */
  async getFrameAt(segmentId: string, targetSec: number): Promise<VideoFrame | null> {
    const session = this.sessions.get(segmentId);
    if (!session || session.closed) return null;
    await session.ready;
    if (session.closed || session.frames.length === 0) return null;

    let selected = session.frames[0]!;
    for (const entry of session.frames) {
      if (entry.timestampSec <= targetSec) selected = entry;
      else break;
    }

    // Close every buffered frame strictly older than the selected one —
    // under forward playback they can never be needed again.
    session.frames = session.frames.filter((entry) => {
      if (entry.timestampSec < selected.timestampSec) {
        entry.frame.close();
        return false;
      }
      return true;
    });

    if (session.displayedFrame && session.displayedFrame !== selected.frame) {
      session.displayedFrame.close();
    }
    session.displayedFrame = selected.frame;
    return selected.frame;
  }

  hasSession(segmentId: string): boolean {
    return this.sessions.has(segmentId);
  }

  /**
   * Closes and discards the decode session for `segmentId` — every
   * buffered VideoFrame is closed immediately, and the underlying
   * VideoDecoder is closed. Call the moment a segment stops being the
   * current or decode-ahead-next segment (Section 3.5 boundary crossing).
   */
  releaseSession(segmentId: string): void {
    const session = this.sessions.get(segmentId);
    if (!session) return;
    this.closeSession(session);
    this.sessions.delete(segmentId);
  }

  private closeSession(session: DecodeSession): void {
    session.closed = true;
    for (const entry of session.frames) entry.frame.close();
    session.frames = [];
    // displayedFrame is always the same underlying frame as one of the
    // `frames` entries until superseded (never removed from `frames` until
    // then), so it has already been closed above — just drop the reference,
    // do not close it again.
    session.displayedFrame = null;
    try {
      session.decoder?.close();
    } catch {
      // Already closed (e.g. the decoder errored) — safe to ignore.
    }
  }

  /** Segment ids of all sessions currently held — for a caller implementing
   *  a "keep only current + next" eviction policy externally. */
  activeSegmentIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Releases every session — call on unmount. */
  dispose(): void {
    for (const segmentId of this.activeSegmentIds()) this.releaseSession(segmentId);
  }
}
