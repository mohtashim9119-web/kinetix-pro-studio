/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Owns VideoDecoder instance lifecycle for the WebCodecs preview path:
 * configure, windowed decode-ahead scheduling, output frame queueing, LRU
 * eviction across sessions, decoder-instance reuse by asset id, and — the
 * single most important correctness rule in this module — explicit
 * VideoFrame.close() discipline. A decoded VideoFrame is a GPU/CPU-backed
 * buffer (docs/webcodecs-architecture-plan.md Section 4.2); one that is
 * never closed is a hard memory leak, not just inefficiency, because the
 * GC does not reliably reclaim it promptly.
 *
 * Phase 4+6 (combined, docs/webcodecs-architecture-plan.md) rewrite of the
 * Phase 1-3 model. What changed and why:
 *
 *  - Windowed decode-ahead (Section 4.2), not whole-segment-up-front. A
 *    session only ever feeds the decoder a rolling ~WINDOW_AHEAD_SEC window
 *    around whatever target time was last requested — it does NOT decode a
 *    segment's entire trimmed range the moment it becomes current/next.
 *    This is what makes 500+ segment scale viable: memory is bounded by the
 *    window, not by segment count or length.
 *  - Sliding (not prefix) frame buffer — WS3 sparse-keyframe fix. The buffer
 *    holds a window around the current target ([-RETAIN_BEHIND_SEC,
 *    +WINDOW_AHEAD_SEC]), evicting
 *    frames the target has already passed to make room for ones it hasn't
 *    reached yet. This is what decouples *reachable depth* from *buffer
 *    size*: reaching a target deep inside a long GOP requires decoding every
 *    frame from its keyframe forward, and on a clip whose only keyframe is
 *    at t=0 (the common case for generated/stock media, not an edge case)
 *    that is the entire clip. The previous behavior — drop the arriving
 *    frame once the per-session cap was full — made any target more than
 *    MAX_BUFFERED_FRAMES_PER_SESSION frames past its keyframe unreachable,
 *    returning a stale frame with no error.
 *  - Scrub-seek reset. A target that falls behind what's still buffered
 *    (backward scrub) or beyond the fed-plus-lookahead frontier (a jump
 *    bigger than steady playback ever produces) re-seeks the decoder to the
 *    nearest keyframe at-or-before the new target instead of decoding
 *    everything in between — this is what keeps a cold scrub-seek fast
 *    (target: under ~250ms to first correct frame, see the architecture
 *    doc's progress tracker for the measured result) instead of degrading
 *    to "decode from wherever we last were."
 *  - LRU eviction across ALL sessions, not just "current + next" hard
 *    release. Callers mark a small protected set (setProtectedIds) that can
 *    never be evicted; anything else is fair game once the pool exceeds
 *    MAX_CACHED_SESSIONS or MAX_TOTAL_BUFFERED_FRAMES, evicted
 *    least-recently-used first. This both bounds memory at 500+ segment
 *    scale AND improves scrub responsiveness versus Phase 1-3's model
 *    (which released a segment's session the instant it stopped being
 *    current/next) — a small number of recently-visited-but-not-current
 *    sessions can survive long enough to make back-and-forth scrubbing
 *    across a couple of neighboring segments instant instead of a cold
 *    reseek every time. This is exactly the reordering the Section 6 risk
 *    register flagged: designing the window/eviction policy against
 *    scrub-stress from the start, not retrofitting it.
 *  - Decoder instance reuse keyed by asset id. Section 4.2 calls for this
 *    explicitly ("segments that share the same source asset ... should
 *    share a decoder/demuxer session keyed by asset id") — Phase 1-3 only
 *    achieved this for the demuxer (videoDemuxer.ts's per-URL cache);
 *    VideoDecoder objects were constructed fresh per session and closed on
 *    eviction. This rewrite adds a small per-asset-URL idle pool of
 *    DecoderHandles: releasing a session parks its handle (reset, not
 *    closed) for potential reuse by the next session that needs the same
 *    asset, bounded by MAX_IDLE_DECODER_HANDLES_PER_ASSET. Because a real
 *    VideoDecoder's output/error callbacks are fixed at construction and
 *    cannot be rebound, reuse is implemented via a stable wrapper callback
 *    that dispatches to whichever session currently "owns" the handle
 *    (`DecoderHandle.activeSession`) — see acquireHandle/releaseHandle.
 */

import { getOrCreateDemux } from './videoDemuxer';

/** Section 4.2's "small time-buffer ahead" — how far past the last
 *  requested target a session decodes proactively. Chosen at the middle of
 *  the plan's stated 1-2s range. */
export const WINDOW_AHEAD_SEC = 1.5;

/** Leading half of the sliding window (WS3 sparse-keyframe fix, see
 *  handleDecoderOutput): how much already-passed material a session keeps
 *  buffered behind its current target instead of discarding it the instant
 *  the playhead moves on.
 *
 *  0.5s is ~12 frames at 24fps / ~15 at 30fps — small enough that the whole
 *  live window (0.5s behind + WINDOW_AHEAD_SEC=1.5s ahead = 2.0s, ~48-60
 *  frames) still sits comfortably under MAX_BUFFERED_FRAMES_PER_SESSION, and
 *  large enough to absorb the short backward movements that actually happen
 *  in this app: a frame-step back, scrub jitter inside one gesture, and a
 *  transition blend reading slightly behind the playhead. Retaining anything
 *  at all matters much more here than the exact number, because on a
 *  single-keyframe clip (the common case — see the WS3 audit's library scan)
 *  a backward target below the retained floor costs a full re-decode from
 *  t=0, so a one-frame nudge backwards must not trigger one. */
const RETAIN_BEHIND_SEC = 0.5;

/** Per-session cap on simultaneously-buffered (decoded, unconsumed)
 *  VideoFrames. Bounds this session's real memory — a VideoFrame is a live
 *  GPU/CPU buffer, not a handle — at roughly 3s of 30fps content.
 *
 *  WS3 sparse-keyframe fix: this is a genuine safety net again (a decoder
 *  emitting faster than getFrameAt consumes), NOT a limit on how deep into a
 *  clip a target may sit. It used to be both, because a full buffer dropped
 *  every newly-decoded frame — which silently capped reachable depth at
 *  90 frames past the seeding keyframe (3.75s at 24fps) and was the root
 *  cause of the WS3 preview stall. handleDecoderOutput now slides the window
 *  forward instead of dropping, so reachable depth is unbounded while the
 *  memory ceiling this constant sets is unchanged. */
const MAX_BUFFERED_FRAMES_PER_SESSION = 90;

/** Section 4.3 starting point for the pool-wide session-count ceiling:
 *  "decoded frames for at most 3 segments' worth of window at any time."
 *  Tune from the Phase 6 500-segment measurement (see the architecture
 *  doc's progress tracker for the actual measured numbers this was
 *  confirmed/refined against). */
export const MAX_CACHED_SESSIONS = 3;

/** Section 4.3's frame-count ceiling — roughly MAX_CACHED_SESSIONS sessions
 *  each holding one window's worth of buffered frames (~45 @ 30fps) plus
 *  slack. Same tuning note as above.
 *
 *  Soft ceiling for protected sessions, by design: enforceBudget() only ever
 *  evicts non-protected sessions (see evictionCandidates), so this can
 *  already be transiently exceeded today with just {current, next}
 *  protected (2 sessions x MAX_BUFFERED_FRAMES_PER_SESSION=90 = 180 > 150
 *  in the worst case). transitionProtectedIds (below) adds a third
 *  simultaneously-protected slot for the item-4 transition fix
 *  (docs/webcodecs-architecture-plan.md) — that stretches the same
 *  already-soft ceiling a bit further (3 x 90 = 270 worst-case), not a new
 *  category of risk. MAX_CACHED_SESSIONS=3 already anticipates exactly this
 *  {current, next, outgoing-during-transition} triple. */
export const MAX_TOTAL_BUFFERED_FRAMES = 150;

/** Bounds the idle decoder-handle free list kept per asset URL for reuse —
 *  small on purpose: reuse only needs to cover "the next session for this
 *  asset shows up shortly after the last one was evicted," not act as a
 *  general-purpose decoder cache. */
const MAX_IDLE_DECODER_HANDLES_PER_ASSET = 2;

interface BufferedFrame {
  frame: VideoFrame;
  timestampSec: number;
}

/** A pending `getFrameAt` call waiting for enough frames to be buffered to
 *  answer its query — resolved early by the decoder's `output` callback the
 *  moment a frame past `targetSec` arrives, or by the current feed batch
 *  settling as the fallback. */
interface FrameWaiter {
  targetSec: number;
  settle: () => void;
}

/** The next `getFrameAt` turn queued behind a session's currently-running one
 *  (WS3 concurrent-decode fix — see the class's `getFrameAt` doc comment). At
 *  most one of these ever exists per session: a call that arrives while one
 *  is already queued coalesces into it by overwriting `targetSec` and adding
 *  its own resolver, rather than queuing a separate turn. */
interface PendingCall {
  targetSec: number;
  resolvers: Array<(frame: VideoFrame | null) => void>;
}

/** Wraps a single VideoDecoder so it can be handed from one session to the
 *  next (Section 4.2 decoder reuse). The output/error callbacks are bound
 *  once, at construction, to this handle — never to a session directly —
 *  and dispatch to whichever session currently has `activeSession` set,
 *  which is how the same underlying VideoDecoder object can answer for a
 *  succession of different segments over time. */
interface DecoderHandle {
  decoder: VideoDecoder;
  assetUrl: string;
  activeSession: DecodeSession | null;
  errored: boolean;
}

interface DecodeSession {
  assetUrl: string;
  /** Segment-level source-time ceiling this session may ever decode within
   *  — the segment's own [trimStart, trimEnd]-derived range. Fixed for the
   *  life of the session; never widened by window feeding or resets. */
  startSec: number;
  endSec: number;

  chunks: readonly EncodedVideoChunk[];
  config: VideoDecoderConfig | null;
  handle: DecoderHandle | null;

  /** Next chunk index (into `chunks`) this session's current window has not
   *  yet fed to the decoder. */
  feedCursor: number;
  /** Ceiling index (inclusive) for this session's current window position —
   *  recomputed by findChunkRange on every reset (Section 4.2's scrub-reset
   *  path), since the safety cap in findChunkRange is relative to whichever
   *  keyframe the window currently starts from. */
  fullEndIndex: number;
  /** True once feedCursor has passed fullEndIndex — nothing more will ever
   *  be fed for this session's current window position. */
  fullyFed: boolean;
  /** True while a feed-then-flush batch is in flight — guards against
   *  issuing two overlapping feed batches for the same session. */
  feedInFlight: boolean;
  /** Bumped by resetSessionWindow — see the comment there for why a stale
   *  in-flight batch's own deferred `feedInFlight = false` must not be
   *  allowed to apply once a reset has happened. */
  feedGeneration: number;
  /** Timestamp (us) of the last chunk actually handed to decoder.decode()
   *  so far in the current window — used to decide whether a new target is
   *  reachable by simple forward continuation or needs a reset. */
  feedFrontierUs: number;
  /** Timestamp (us) below which this session can no longer answer a query
   *  without a reset — i.e. **the sliding window's trailing edge**.
   *
   *  WS3 sparse-keyframe fix — the contract changed here. It used to be "the
   *  most recently *selected* frame's timestamp", because forward eviction
   *  closed everything strictly older than the selection on every getFrameAt
   *  call. That made the floor a ratchet that could park above every frame
   *  the session was still able to produce: once the per-session buffer cap
   *  had dropped the frames a deep target needed, the floor advanced to the
   *  stale frame that was returned instead, and (with the session already
   *  `fullyFed`) nothing could ever move it again.
   *
   *  It is now simply **the oldest frame still buffered**, or — when nothing
   *  is buffered — the lower bound of what the current window can still
   *  produce (the seeding chunk's timestamp after seedWindow, or the
   *  retain-behind cutoff after a slide). It is maintained at exactly three
   *  sites: `seedWindow` (empty buffer), `handleDecoderOutput`'s slide
   *  eviction, and `getFrameAtInternal`'s post-selection trim. Its sole
   *  consumer is `needsReset`. */
  retainedFloorUs: number;
  /** Source time (us) the current decode window is aimed at — the last
   *  target passed to `fillWindow`/`seedWindow`. Read by
   *  `handleDecoderOutput` to decide which buffered frames the playhead has
   *  already passed and may therefore be slid out to make room; never used
   *  to select a frame to return. */
  windowTargetUs: number;

  frames: BufferedFrame[]; // ascending by timestampSec (decoder output order)
  displayedFrame: VideoFrame | null; // currently checked-out frame; also present in `frames` until superseded
  ready: Promise<void>;
  closed: boolean;
  waiters: FrameWaiter[];

  /** Tail of this session's `getFrameAt` serialization chain (WS3
   *  concurrent-decode fix) — always settled; the next turn chains onto it so
   *  it only starts once the previous one has fully finished. Independent per
   *  session, so two different sessions still decode concurrently. */
  queueTail: Promise<void>;
  /** True only while a turn's own body (`getFrameAtInternal`) is actively
   *  executing for this session — set at the start of that body, cleared at
   *  the end. A call arriving while this is true queues behind it
   *  (`pendingCall`); a call arriving while it's false becomes the next turn
   *  on `queueTail` directly. */
  turnRunning: boolean;
  /** The turn queued behind the currently-running one, if any — see
   *  `PendingCall`'s own doc comment. Only ever populated while
   *  `turnRunning` is true; a call that arrives with nothing running becomes
   *  its own turn on `queueTail` instead of populating this. */
  pendingCall: PendingCall | null;
}

/** Finds the chunk range [startIndex, endIndex] (inclusive) to feed a decoder
 *  so it can produce frames covering source time [startSec, endSec].
 *  VideoDecoder can only begin decoding at a sync (key) sample, so
 *  startIndex backs up to the last keyframe at or before startSec.
 *  endIndex includes one GOP of margin past endSec (B-frame GOPs can need a
 *  little source data beyond the last requested presentation time).
 *
 * WS3 Stage 3/4 fix: `chunks` is in DECODE (container) order but
 * timestamped by PRESENTATION time
 * (`videoDemuxer.ts`'s `sample.cts`) — for any real source with B-frames
 * this makes the array locally non-monotonic (confirmed via live
 * instrumentation on a real 10s clip: 119 timestamp inversions across 240
 * chunks). The previous version of this function did a single linear scan
 * that `break`s at the first chunk whose timestamp exceeds the target,
 * which assumes ascending order to be correct — on a non-monotonic array an
 * early out-of-order sample can trip that break many GOPs too soon,
 * resolving a deep target (e.g. 9.61s) to a stale, much-earlier frame (the
 * reproduced defect: 3.79s).
 *
 * This scans keyframes only, never a delta/B-frame timestamp, and does not
 * early-`break` on the first exceedance — it takes the LAST keyframe whose
 * own timestamp is still at-or-before the target. That's a materially
 * weaker, safer assumption than "the whole array is ascending": within a
 * well-formed GOP structure, keyframe (I-frame) presentation timestamps are
 * reliably non-decreasing across the whole file even though delta-frame
 * timestamps inside a GOP are not — B-frame reordering is confined within a
 * GOP, never across a GOP boundary. `endIndex` is found the same way (the
 * last keyframe at-or-before `endSec`), then extended one GOP further as
 * margin — the GOP-granular equivalent of the original "one chunk of
 * margin," since a per-chunk margin isn't a meaningful concept against a
 * non-monotonic array. */
export function findChunkRange(
  chunks: readonly EncodedVideoChunk[],
  startSec: number,
  endSec: number,
): { startIndex: number; endIndex: number } {
  if (chunks.length === 0) return { startIndex: 0, endIndex: -1 };
  const startUs = startSec * 1e6;
  const endUs = endSec * 1e6;

  const keyIndices: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i]!.type === 'key') keyIndices.push(i);
  }
  if (keyIndices.length === 0) keyIndices.push(0); // malformed/keyless stream — decode from the very start

  let startIndex = keyIndices[0]!;
  for (const keyIdx of keyIndices) {
    if (chunks[keyIdx]!.timestamp > startUs) break; // keyframes are reliably ordered — safe to stop here
    startIndex = keyIdx;
  }

  let endGopOrdinal = 0;
  for (let k = 0; k < keyIndices.length; k++) {
    if (chunks[keyIndices[k]!]!.timestamp > endUs) break;
    endGopOrdinal = k;
  }
  const marginKeyIndex = keyIndices[endGopOrdinal + 1];
  let endIndex = marginKeyIndex !== undefined ? marginKeyIndex : chunks.length - 1;

  // WS3 sparse-keyframe fix: this used to additionally clamp to
  // `startIndex + MAX_SESSION_FRAMES - 1` (600 chunks). That constant is
  // gone, because on a clip whose only keyframe is at t=0 — the common case,
  // not an edge case — startIndex is always 0, so the clamp was a hard
  // ceiling on how deep a target could be reached at all: past chunk 599
  // (~25s at 24fps) the session would report itself fullyFed and answer every
  // deeper target with the frame at the ceiling, forever. That is the exact
  // failure this pass fixes at the buffer-cap level, silently reintroduced at
  // a different depth. It also bounded nothing real: `chunks` is already
  // fully in memory (the demuxer owns it), per-batch feed volume is bounded
  // by `boundaryUs` in feedWindow, and live decoded-frame memory is bounded
  // by MAX_BUFFERED_FRAMES_PER_SESSION.
  endIndex = Math.min(endIndex, chunks.length - 1);
  return { startIndex, endIndex };
}

export class VideoDecoderPool {
  private sessions = new Map<string, DecodeSession>();
  private idleHandles = new Map<string, DecoderHandle[]>();
  private protectedIds = new Set<string>();
  /** Second, independent protected set for the item-4 transition fix
   *  (docs/webcodecs-architecture-plan.md) — keeps the OUTGOING segment's
   *  session alive through its own transition window even after it stops
   *  being {current, next} (see setTransitionProtectedIds). Deliberately
   *  separate from protectedIds rather than merged into it: the two sets
   *  are re-asserted by different callers on different triggers (current/
   *  next segment identity vs. transition window state), and keeping them
   *  distinct means one caller's setProtectedIds([...]) full-replace can
   *  never accidentally clobber the other's contribution. */
  private transitionProtectedIds = new Set<string>();
  private lastAccess = new Map<string, number>();
  private touchCounter = 0;

  /**
   * Ensures a decode session exists for `segmentId`, scoped to the chunk
   * range of `assetUrl` covering source time [startSec, endSec] (the
   * segment's own trim range — the ceiling this session may ever decode
   * within, not the initial decode window). Idempotent for an unchanged
   * range — safe to call on every render.
   *
   * `initialTargetSec` (defaults to startSec) seeds the FIRST decode window
   * at that source time rather than at the segment's start — a caller that
   * already knows the actual intended playhead position (e.g. a cold scrub
   * landing mid-segment) should pass it, so the first window is centered on
   * where playback will actually read from instead of wastefully decoding
   * from segment start first only to reset immediately (Phase 4's
   * cold-scrub-latency goal).
   */
  ensureSession(
    segmentId: string,
    assetUrl: string,
    startSec: number,
    endSec: number,
    initialTargetSec: number = startSec,
  ): Promise<void> {
    const existing = this.sessions.get(segmentId);
    if (
      existing &&
      !existing.closed &&
      existing.assetUrl === assetUrl &&
      existing.startSec === startSec &&
      existing.endSec === endSec
    ) {
      this.touch(segmentId);
      return existing.ready;
    }
    if (existing) this.closeSession(existing);

    const session: DecodeSession = {
      assetUrl,
      startSec,
      endSec,
      chunks: [],
      config: null,
      handle: null,
      feedCursor: 0,
      fullEndIndex: -1,
      fullyFed: true,
      feedInFlight: false,
      feedGeneration: 0,
      feedFrontierUs: -Infinity,
      retainedFloorUs: -Infinity,
      windowTargetUs: -Infinity,
      frames: [],
      displayedFrame: null,
      ready: Promise.resolve(),
      closed: false,
      waiters: [],
      queueTail: Promise.resolve(),
      turnRunning: false,
      pendingCall: null,
    };
    session.ready = this.startSession(session, assetUrl, endSec, initialTargetSec).catch((err) => {
      // Don't poison the session cache with a failed startSession — allow a
      // later ensureSession call for this segment to retry fresh instead of
      // permanently returning this same rejected promise on every
      // subsequent cache-hit (mirrors getOrCreateDemux's identical fix in
      // videoDemuxer.ts — see that function's comment for the rationale).
      // Only remove the entry if it's still THIS session — a later
      // ensureSession call for a different range may have already replaced
      // (and closed) it by the time this rejection settles, and that
      // newer session must not be evicted out from under itself.
      if (this.sessions.get(segmentId) === session) {
        this.sessions.delete(segmentId);
        this.lastAccess.delete(segmentId);
      }
      throw err;
    });
    this.sessions.set(segmentId, session);
    this.touch(segmentId);
    this.enforceBudget();
    return session.ready;
  }

  private async startSession(
    session: DecodeSession,
    assetUrl: string,
    endSec: number,
    initialTargetSec: number,
  ): Promise<void> {
    const demuxed = await getOrCreateDemux(assetUrl);
    if (session.closed) return; // released while demuxing

    session.chunks = demuxed.chunks;
    session.config = demuxed.config;

    const handle = this.acquireHandle(assetUrl);
    if (session.closed) {
      this.releaseHandle(handle);
      return;
    }
    handle.activeSession = session;
    handle.errored = false;
    session.handle = handle;
    try {
      handle.decoder.configure(demuxed.config);
    } catch (err) {
      session.handle = null;
      this.releaseHandle(handle);
      throw err;
    }

    this.seedWindow(session, initialTargetSec, endSec);
    await this.fillWindow(session, initialTargetSec);
  }

  /** Positions a session's decode window at the keyframe backing `targetSec`
   *  — used both for the very first window (startSession) and every
   *  scrub-triggered reset (resetSessionWindow calls this too). Does not
   *  feed any chunks itself; `fillWindow` does that. */
  private seedWindow(session: DecodeSession, targetSec: number, endSec: number): void {
    const { startIndex, endIndex } = findChunkRange(session.chunks, targetSec, endSec);
    session.feedCursor = startIndex;
    session.fullEndIndex = endIndex;
    session.fullyFed = startIndex > endIndex;
    session.feedFrontierUs = -Infinity;
    session.windowTargetUs = targetSec * 1e6;
    const firstChunk = session.chunks[startIndex];
    // Nothing is buffered at this point (callers reset/close the buffer
    // before reseeding), so the floor is the lower bound of what this window
    // can produce: the seeding chunk's own timestamp.
    session.retainedFloorUs = firstChunk ? firstChunk.timestamp : targetSec * 1e6;
  }

  /** True when `targetSec` can no longer be answered by this session's
   *  current window without re-seeking: either it falls before the sliding
   *  window's trailing edge (`retainedFloorUs` — a backward movement larger
   *  than RETAIN_BEHIND_SEC, or one landing before the window's own keyframe
   *  floor), or it's beyond what's been fed plus the decode-ahead lookahead
   *  (a jump larger than steady playback ever produces).
   *
   *  On a single-keyframe clip a reset means re-decoding from t=0, so the
   *  retain-behind tail exists precisely to keep small backward movements
   *  from landing here. Larger backward jumps genuinely do pay that cost —
   *  it is inherent to the encoding, not a defect in this pool — but they
   *  pay it *correctly*: the reseek completes and returns the right frame,
   *  rather than stalling or answering from stale buffer. */
  private needsReset(session: DecodeSession, targetSec: number): boolean {
    const targetUs = targetSec * 1e6;
    if (targetUs < session.retainedFloorUs) return true;
    if (!session.fullyFed && targetUs > session.feedFrontierUs + WINDOW_AHEAD_SEC * 1e6) return true;
    return false;
  }

  /** Scrub-seek reset (Section 4.2 / Phase 4): closes every buffered frame
   *  (none of them can answer `targetSec` or we wouldn't be here), rewinds
   *  the underlying decoder to an unconfigured state via reset() (aborting
   *  whatever was mid-flight and settling any pending flush()), and reseeds
   *  the window at the keyframe backing the new target. This is the fast
   *  path for both a backward scrub and a big forward jump within the same
   *  segment — decode resumes from the nearest keyframe rather than
   *  fast-forwarding through everything in between.
   *
   * Phase 5 fix (docs/webcodecs-architecture-plan.md): a prior feedWindow()
   * batch can still be "in flight" (feedInFlight === true, its flush()
   * promise not yet settled) at the moment a reset happens — e.g.
   * ensureSession's own initial fillWindow call resolves early the instant a
   * satisfying frame is buffered, while its underlying flush() keeps running
   * in the background; a getFrameAt call landing moments later can trigger
   * a reset (see needsReset) before that background flush() has settled.
   * Without the two lines below, fillWindow's next call would see
   * feedInFlight still true and passively await a waiter that nothing will
   * ever settle (the stale batch's own `.finally()` only clears the flag —
   * it does not resolve any waiter), hanging forever with a permanently
   * blank canvas and no error. Forcing feedInFlight false here lets the next
   * fillWindow call start a fresh feed for the just-reset window; bumping
   * feedGeneration stops that stale batch's eventual `.finally()` (see
   * fillWindow) from later clobbering a NEW batch's legitimately-true flag
   * if it settles after the new one has already started. */
  private resetSessionWindow(session: DecodeSession, targetSec: number): void {
    for (const entry of session.frames) entry.frame.close();
    session.frames = [];
    if (session.displayedFrame) {
      session.displayedFrame.close();
      session.displayedFrame = null;
    }
    for (const waiter of session.waiters) waiter.settle();
    session.waiters = [];

    const handle = session.handle;
    if (handle && session.config) {
      try {
        handle.decoder.reset();
        handle.decoder.configure(session.config);
      } catch {
        // Surfaced via the decoder's own error callback if fatal; nothing
        // further to do here.
      }
    }
    this.seedWindow(session, targetSec, session.endSec);
    session.feedGeneration++;
    session.feedInFlight = false;
  }

  /** Feeds chunks from `session.feedCursor` up to whichever is smaller:
   *  `targetSec + WINDOW_AHEAD_SEC`, or the session's own fullEndIndex —
   *  always feeding at least one chunk of forward progress when anything
   *  remains, even if the window boundary is already behind feedCursor
   *  (e.g. a target right at the tail of what's already been requested).
   *
   *  Flush-strategy redesign (docs/webcodecs-architecture-plan.md, Phase
   *  4+6/5 design gap, fixed here): a real `VideoDecoder.decode()` call
   *  throws SYNCHRONOUSLY — "A key frame is required after configure() or
   *  flush()" — the moment it's handed a delta chunk immediately after a
   *  settled `flush()`. The previous version of this method called
   *  `flush()` at the end of EVERY batch, so every same-session window
   *  extension after the first (continuing mid-GOP, by design — that's the
   *  whole point of the windowed model) hit this on a real decoder. The
   *  fix: `flush()` is only ever called here when this batch reaches the
   *  true end of the session's own range (`fullyFed` becomes true) — i.e.
   *  when no future `feedWindow()` call will ever run for this session
   *  again (`fillWindow`'s `fullyFed && !feedInFlight` early-return
   *  guarantees that). Every routine continuation just calls `decode()`
   *  and returns without flushing — legal on a real decoder because
   *  nothing flushed the decoder since the LAST decode() in this same
   *  session. Genuine discontinuities (session teardown in `closeSession`,
   *  backward/hard-seek resets in `resetSessionWindow`) still use
   *  `reset()`+`configure()`, which the real API explicitly permits a
   *  subsequent delta decode() after, once re-seeded at a keyframe (which
   *  `seedWindow` always does). Output for chunks fed without a flush
   *  still arrives normally via the decoder's `output` callback
   *  (`handleDecoderOutput`) — `fillWindow`'s waiter mechanism, not this
   *  method's return value, is what actually waits for it. */
  private feedWindow(session: DecodeSession, targetSec: number): Promise<void> {
    const handle = session.handle;
    if (!handle || session.closed) return Promise.resolve();
    const boundaryUs = (targetSec + WINDOW_AHEAD_SEC) * 1e6;

    // Secondary safety net only, not the primary defense (see the flush
    // strategy above): with routine batches no longer flushing, decode() is
    // never called on this handle right after a flush() with a
    // non-keyframe chunk, so the keyframe-after-flush throw this used to
    // guard against should no longer be reachable in practice. A real
    // hardware decoder can still throw for unrelated reasons (malformed
    // chunk, driver fault), so this stays as a last-resort containment:
    // freeze the segment on its last good frame rather than letting a
    // synchronous throw escape into fillWindow uncaught.
    try {
      let fed = false;
      while (session.feedCursor <= session.fullEndIndex && session.chunks[session.feedCursor]!.timestamp <= boundaryUs) {
        const chunk = session.chunks[session.feedCursor]!;
        handle.decoder.decode(chunk);
        session.feedFrontierUs = chunk.timestamp;
        session.feedCursor++;
        fed = true;
      }
      if (session.feedCursor > session.fullEndIndex) session.fullyFed = true;

      if (!fed && session.feedCursor <= session.fullEndIndex) {
        // Nothing fell within the window boundary yet (it's already behind
        // feedCursor) — feed exactly one more chunk so forward progress is
        // always made rather than spinning.
        const chunk = session.chunks[session.feedCursor]!;
        handle.decoder.decode(chunk);
        session.feedFrontierUs = chunk.timestamp;
        session.feedCursor++;
        if (session.feedCursor > session.fullEndIndex) session.fullyFed = true;
        fed = true;
      }

      if (!fed) return Promise.resolve();

      if (session.fullyFed) {
        // The ONLY place outside teardown/reset that flush() is ever
        // called: nothing will ever feed this session again, so force any
        // decoder-buffered (reorder-delayed) tail frames out now instead of
        // leaving them with nothing left to trigger their emission.
        return handle.decoder.flush().catch(() => {});
      }
      return Promise.resolve();
    } catch {
      handle.errored = true; // don't pool this handle for reuse — its decode state is now unknown
      session.fullyFed = true; // stop fillWindow from retrying the same doomed chunk forever
      return Promise.resolve();
    }
  }

  /** Feeds and waits until `session.frames` can answer `targetSec` (a frame
   *  strictly past it has arrived, so "latest at-or-before" is fully
   *  determined) or the session is fully fed with nothing more ever coming.
   *  Resolves early on either signal — never waits for a whole batch to
   *  settle if the answer is already knowable from what's buffered so far.
   *
   *  Flush-strategy redesign (docs/webcodecs-architecture-plan.md, Phase
   *  4+6/5 gap): the pre-fix version of this method tied its own wait
   *  directly to `feedWindow`'s returned promise, which used to be a real
   *  `flush()` — a genuine async operation whose settling reliably meant
   *  "every frame this batch will ever produce has arrived." Now that
   *  `feedWindow` only flushes when the session is fully exhausted (see its
   *  own doc comment), that promise settles almost instantly for a routine
   *  batch — tying a wait to it directly would busy-loop (start a batch,
   *  find nothing satisfies yet, immediately start another) without ever
   *  giving the decoder's real, asynchronous `output` callback a chance to
   *  fire. `startFeedBatch` below is what actually paces this correctly:
   *  see its own doc comment. */
  private async fillWindow(session: DecodeSession, targetSec: number): Promise<void> {
    // Aims the sliding window (handleDecoderOutput reads this to decide what
    // the playhead has already passed). Safe to assert unconditionally here:
    // getFrameAt serializes turns per session, so no two targets are ever
    // being filled for the same session at once.
    session.windowTargetUs = targetSec * 1e6;
    while (!session.closed) {
      if (session.frames.some((f) => f.timestampSec > targetSec)) return;
      if (session.fullyFed && !session.feedInFlight) return;

      if (!session.feedInFlight) {
        this.startFeedBatch(session, targetSec);
        // `feedWindow` (called synchronously by startFeedBatch, above) has
        // already fed whatever it's going to feed, and `handleDecoderOutput`
        // pushes into `session.frames` unconditionally — independent of any
        // waiter — so a decoder that emits synchronously (this file's own
        // test mocks) or had output already arrive may have already
        // satisfied `targetSec` or reached genuine exhaustion. Loop back to
        // the top to recheck fresh rather than assuming a real async gap;
        // if neither is true yet, the next iteration correctly falls
        // through to the passive wait below (feedInFlight is still true at
        // that point, since nothing has yielded since startFeedBatch set it).
        continue;
      }

      await new Promise<void>((resolve) => session.waiters.push({ targetSec, settle: resolve }));
    }
  }

  /** Issues one feed-and-maybe-flush batch for `targetSec` on `session`,
   *  marking `feedInFlight` for its duration so a concurrent `fillWindow`
   *  call for a different target on the same session waits instead of
   *  double-feeding.
   *
   *  On completion: if the session is now fully fed, the `flush()` that
   *  `feedWindow` issues in that case (see its doc comment) guarantees
   *  every decoder-buffered frame has already been delivered via
   *  `handleDecoderOutput` by the time we get here — so every still-pending
   *  waiter is force-settled; nothing is left that could ever answer them.
   *
   *  Otherwise (a routine continuation, no flush happened): `handleDecoderOutput`
   *  has already woken any waiter this batch's own output satisfied.
   *  Anyone STILL parked whose target lies beyond what this batch actually
   *  fed (`feedFrontierUs`) — not merely "output for it hasn't arrived
   *  yet" — genuinely needs the window pushed further, so this re-invokes
   *  itself for the single furthest such target (one more batch covers
   *  every nearer one too). Waiters already within the fed range are
   *  deliberately left alone here to keep waiting on real decoder output —
   *  waking them anyway (as this method's flush-timed predecessor did,
   *  when every batch really did flush) is exactly the busy-loop this
   *  redesign removes: without a flush to await, "batch completed" no
   *  longer means "we now know as much as we're going to for a while." */
  private startFeedBatch(session: DecodeSession, targetSec: number): void {
    session.feedInFlight = true;
    // Captured so this specific batch's completion can't clear a LATER
    // batch's legitimately-true feedInFlight if a reset (resetSessionWindow)
    // happens before this one settles — see that method's comment.
    const generation = session.feedGeneration;
    this.feedWindow(session, targetSec).finally(() => {
      if (session.feedGeneration !== generation) return;
      session.feedInFlight = false;

      if (session.fullyFed) {
        for (const waiter of session.waiters) waiter.settle();
        session.waiters = [];
        return;
      }

      let furthestUs = -Infinity;
      for (const waiter of session.waiters) {
        const waiterUs = waiter.targetSec * 1e6;
        if (waiterUs > session.feedFrontierUs && waiterUs > furthestUs) furthestUs = waiterUs;
      }
      if (furthestUs > -Infinity) this.startFeedBatch(session, furthestUs / 1e6);
    });
  }

  /**
   * Returns the frame to display at `targetSec` (source time, seconds) for
   * `segmentId`'s session — the latest buffered frame at or before
   * targetSec — or null if the session isn't ready, has no frames, or a
   * fatal decode error left it empty. Every frame this supersedes
   * (buffered-but-now-stale, or the previously displayed frame) is closed
   * synchronously before returning. Transparently re-seeks the session
   * (see resetSessionWindow) if `targetSec` isn't reachable from its
   * current window — this is what makes both backward scrub and a big
   * forward jump within an already-warm segment resolve correctly instead
   * of returning whatever stale frame happens to still be buffered.
   *
   * **Serialization (WS3 concurrent-decode fix).** This method is not safe
   * to run twice at once against the same session: a second call's
   * `needsReset` check can discard the frame buffer a first call is about to
   * return, and per-call eviction can close a frame already handed to
   * another caller (traced to two production failure shapes — a caller
   * handed an already-closed frame, and a caller answered with the wrong
   * frame entirely after a sibling's divergent target triggered a reset). Rather
   * than leaning on every caller to uphold "at most one call in flight per
   * session" itself (three independent chases against this pool have,
   * historically, not), this method enforces it structurally: each session
   * has its own serialization queue (`queueTail` + `turnRunning`), keyed by
   * segment id, so two different sessions still decode fully concurrently.
   *
   * A call that arrives while nothing is running for this session becomes
   * the next turn on `queueTail` directly. A call that arrives while a turn
   * IS actively running (`turnRunning`) queues behind it (`pendingCall`); a
   * further call arriving before that queued turn has actually started
   * coalesces into it by overwriting its target, rather than queuing a
   * separate turn — bounding the queue at one running + one pending turn
   * regardless of how many calls arrive while something is genuinely
   * mid-decode. This is a deliberate trade-off: scrubbing and slip-dragging
   * generate many rapid, quickly-stale targets over the course of a gesture,
   * and running every one of them in turn would add real, visible lag (each
   * queued turn can involve a real decode wait) for callers whose target is
   * already obsolete by the time their turn comes. A coalesced caller
   * resolves with whichever frame the LATEST target (at the time the queued
   * turn actually runs) produces, not its own original target — acceptable
   * here because every caller of this pool wants "the frame for wherever the
   * gesture/playhead is now," not a specific historical target. Two (or
   * more) calls that arrive in the same synchronous tick — before either has
   * had a chance to actually start running — do NOT coalesce with each
   * other (each becomes its own turn, chained sequentially); this only
   * matters for a genuinely-synchronous burst, which none of this pool's
   * real callers produce, and it stays fully correct either way, since
   * strict sequencing is what actually fixes the two failure shapes above —
   * coalescing is purely a latency optimization on top of that, not a
   * correctness requirement.
   *
   * A rejected/throwing turn still lets the next queued turn run (the
   * internal `.catch` below settles that turn's own callers with `null` and
   * lets `queueTail` proceed rather than leaving it permanently rejected).
   * Session teardown mid-queue cannot leave a caller waiting forever either:
   * `closeSession` force-settles the in-flight turn's internal waiters (see
   * `fillWindow`'s `while (!session.closed)` loop), which resolves
   * `queueTail` promptly and lets any queued turn immediately observe
   * `session.closed` and resolve `null`.
   */
  getFrameAt(segmentId: string, targetSec: number): Promise<VideoFrame | null> {
    const session = this.sessions.get(segmentId);
    if (!session || session.closed) return Promise.resolve(null);
    this.touch(segmentId);

    if (session.pendingCall) {
      // Coalesce: a turn is already queued behind the in-flight one — retarget
      // it to this newer request and share its eventual result rather than
      // queuing a second turn (see this method's doc comment).
      session.pendingCall.targetSec = targetSec;
      return new Promise((resolve) => session.pendingCall!.resolvers.push(resolve));
    }

    return new Promise<VideoFrame | null>((resolve) => {
      const pending: PendingCall = { targetSec, resolvers: [resolve] };
      // Only queue behind an ACTUALLY-RUNNING turn — a call arriving while
      // nothing has started yet (even if another call already committed to
      // running next) becomes its own sequential turn instead, per this
      // method's doc comment on same-tick bursts.
      if (session.turnRunning) session.pendingCall = pending;

      session.queueTail = session.queueTail
        .then(async () => {
          // Clear it from the session BEFORE running, but only if it's still
          // THIS turn's own pending record — a same-tick sibling turn ahead
          // of us on the chain must not clobber a genuinely later coalesced
          // pendingCall that was set after we were dispatched.
          if (session.pendingCall === pending) session.pendingCall = null;
          session.turnRunning = true;
          const frame = session.closed ? null : await this.getFrameAtInternal(session, pending.targetSec);
          session.turnRunning = false;
          for (const r of pending.resolvers) r(frame);
        })
        .catch(() => {
          // getFrameAtInternal doesn't itself throw (existing session/decoder
          // failures are already swallowed inside it), but this guarantees a
          // genuinely unexpected throw still settles this turn's callers and
          // leaves `queueTail` resolved, not permanently rejected — otherwise
          // every future call on this session would wait on a dead chain.
          if (session.pendingCall === pending) session.pendingCall = null;
          session.turnRunning = false;
          for (const r of pending.resolvers) r(null);
        });
    });
  }

  /** The actual per-call decode/selection body — see `getFrameAt`'s doc
   *  comment for why this is never invoked more than once at a time for the
   *  same `session`. */
  private async getFrameAtInternal(session: DecodeSession, targetSec: number): Promise<VideoFrame | null> {
    // Phase 5 fix (docs/webcodecs-architecture-plan.md): ensureSession() is
    // always called fire-and-forget by useWebCodecsPreview.ts (its own
    // decode-ahead effect never awaits it), and a separate effect in the
    // same render calls getFrameAt independently — so this can run before
    // startSession()'s seedWindow() has ever executed for a brand new
    // session, while its DecodeSession object literal still holds its
    // placeholder initial values (fullyFed: true, frames: []). Without
    // awaiting `ready` here first, the fillWindow() call below would read
    // that placeholder fullyFed=true and return immediately with zero
    // frames — getFrameAt then returns null, and if the caller isn't
    // actively ticking currentTime (e.g. paused right after a seek), nothing
    // ever retries: a permanently blank canvas with no error. Awaiting
    // `ready` (a no-op once already resolved) guarantees seedWindow's real
    // chunk-range-derived state is in place before needsReset/fillWindow
    // ever run.
    await session.ready;
    if (session.closed) return null;

    if (this.needsReset(session, targetSec)) {
      this.resetSessionWindow(session, targetSec);
    }
    await this.fillWindow(session, targetSec);
    if (session.closed || session.frames.length === 0) return null;

    let selected = session.frames[0]!;
    for (const entry of session.frames) {
      if (entry.timestampSec <= targetSec) selected = entry;
      else break;
    }

    // Trim the buffer's trailing edge, keeping RETAIN_BEHIND_SEC of
    // already-passed material rather than closing everything older than the
    // selection. That retained tail is what makes a short backward nudge free
    // instead of a full re-seek — which on a single-keyframe clip means
    // re-decoding from t=0 (see RETAIN_BEHIND_SEC's own comment). Measured
    // from the selected frame, never from `targetSec`: a target the decode
    // run has not reached yet sits arbitrarily far ahead of everything
    // buffered, and a target-relative cutoff would evict the very frame this
    // call is about to return.
    const evictBelowSec = selected.timestampSec - RETAIN_BEHIND_SEC;
    session.frames = session.frames.filter((entry) => {
      if (entry.timestampSec < evictBelowSec) {
        if (entry.frame === session.displayedFrame) session.displayedFrame = null;
        entry.frame.close();
        return false;
      }
      return true;
    });
    // `selected` is always retained (its own timestamp is the cutoff's
    // origin), so frames[0] exists.
    session.retainedFloorUs = session.frames[0]!.timestampSec * 1e6;

    // The previously displayed frame is deliberately NOT closed here. Under
    // the old close-everything-older-than-selected rule it had always just
    // been closed by the filter above anyway; now it may still be buffered
    // inside the retain-behind tail, and closing it would hand a later
    // getFrameAt an already-closed frame. Every frame is closed exactly once,
    // at the moment it leaves `session.frames` — via the filter above,
    // slideWindowForward, resetSessionWindow, or closeSession.
    session.displayedFrame = selected.frame;
    this.enforceBudget();
    return selected.frame;
  }

  hasSession(segmentId: string): boolean {
    return this.sessions.has(segmentId);
  }

  /**
   * Closes and discards the decode session for `segmentId` — every
   * buffered VideoFrame is closed immediately, and the underlying decoder
   * handle is returned to the per-asset idle pool for reuse (or closed, if
   * the pool for that asset is already at capacity or the decoder errored).
   * Call the moment a segment falls out of the protected set and the pool
   * needs to reclaim budget (see enforceBudget), or on unmount (dispose).
   */
  releaseSession(segmentId: string): void {
    const session = this.sessions.get(segmentId);
    if (!session) return;
    this.closeSession(session);
    this.sessions.delete(segmentId);
    this.lastAccess.delete(segmentId);
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

    if (session.handle) {
      const handle = session.handle;
      session.handle = null;
      handle.activeSession = null;
      if (session.feedInFlight) {
        // This session still has a feedWindow()/flush() batch in flight —
        // handing the handle to a new session right now (even after
        // reset()) is a real hazard found during Phase 4+6 manual
        // 500-segment scrub-stress testing: under heavy concurrent churn
        // (many segments sharing one asset, rapidly created/evicted), a
        // straggler output from the OLD batch could still land after a NEW
        // session has taken over `handle.activeSession`, corrupting that
        // new session's frame buffer with frames it never asked for (and,
        // observed in practice, leaving a session permanently starved of
        // any valid frame — a persistent blank canvas with no error, since
        // getFrameAt legitimately has nothing to return). Closing outright
        // instead of pooling is strictly safe: the in-flight flush()
        // rejects/settles harmlessly against a decoder that's already
        // closed, and this session is being discarded anyway.
        try {
          handle.decoder.close();
        } catch {
          // Already closed — safe to ignore.
        }
      } else {
        this.releaseHandle(handle);
      }
    }

    // Force-settle any in-flight getFrameAt/fillWindow waiters explicitly,
    // rather than relying solely on the decoder rejecting a pending flush()
    // on reset/close — a session closed before startSession ever reached
    // decode has no such promise to reject in the first place.
    for (const waiter of session.waiters) waiter.settle();
    session.waiters = [];
  }

  /** Acquires a DecoderHandle for `assetUrl` — reuses an idle handle from
   *  this asset's free list if one exists (Section 4.2 decoder reuse),
   *  otherwise constructs a new VideoDecoder. The output/error callbacks
   *  are bound once, here, to the handle itself (never to a session
   *  directly), and dispatch to whichever session currently owns the
   *  handle via `handle.activeSession` — this indirection is what makes it
   *  possible to hand the same underlying VideoDecoder object to a
   *  succession of different sessions over time, since a real
   *  VideoDecoder's callbacks cannot be rebound after construction. */
  private acquireHandle(assetUrl: string): DecoderHandle {
    const idle = this.idleHandles.get(assetUrl);
    if (idle && idle.length > 0) {
      return idle.pop()!;
    }
    const handle: DecoderHandle = {
      decoder: null as unknown as VideoDecoder,
      assetUrl,
      activeSession: null,
      errored: false,
    };
    handle.decoder = new VideoDecoder({
      output: (frame) => this.handleDecoderOutput(handle, frame),
      error: (e) => {
        handle.errored = true;
        console.error('[videoDecoderPool] decoder error:', e.message);
        const session = handle.activeSession;
        if (session) {
          // Nothing more will ever arrive for this session's current
          // request — settle any waiter rather than leaving it hanging.
          for (const waiter of session.waiters) waiter.settle();
          session.waiters = [];
        }
      },
    });
    return handle;
  }

  /** Returns a handle to its per-asset idle pool for reuse, unless it
   *  errored (never reused — a fresh decoder is safer than one in unknown
   *  state) or the pool for that asset is already at capacity, in which
   *  case it's closed outright. A reusable handle is reset() first so a
   *  late output/flush from the session that just released it can never be
   *  misattributed to whichever session acquires it next. */
  private releaseHandle(handle: DecoderHandle): void {
    handle.activeSession = null;
    if (handle.errored) {
      try {
        handle.decoder.close();
      } catch {
        // Already closed — safe to ignore.
      }
      return;
    }
    const idle = this.idleHandles.get(handle.assetUrl) ?? [];
    if (idle.length >= MAX_IDLE_DECODER_HANDLES_PER_ASSET) {
      try {
        handle.decoder.close();
      } catch {
        // Already closed — safe to ignore.
      }
      return;
    }
    try {
      handle.decoder.reset();
    } catch {
      // Already closed/errored — don't pool it if reset() itself failed.
      try {
        handle.decoder.close();
      } catch {
        // no-op
      }
      return;
    }
    idle.push(handle);
    this.idleHandles.set(handle.assetUrl, idle);
  }

  /** Slides the buffer's trailing edge forward to `windowTargetUs -
   *  RETAIN_BEHIND_SEC`, closing every frame the current target has already
   *  moved past (oldest first — `frames` is ascending). Returns true if it
   *  freed at least one slot.
   *
   *  This is the WS3 sparse-keyframe fix. Reaching a target deep inside a
   *  long GOP requires decoding every frame from the seeding keyframe up to
   *  it — on a single-keyframe clip, potentially the whole clip — but only a
   *  window around the target is ever wanted. Evicting behind keeps that run
   *  making progress inside a fixed buffer budget; the previous behavior
   *  (drop the arriving frame once full) meant the run filled the buffer with
   *  its own leading frames and then discarded every frame past that point,
   *  including the target's own. */
  private slideWindowForward(session: DecodeSession): boolean {
    const keepFromUs = session.windowTargetUs - RETAIN_BEHIND_SEC * 1e6;
    let freed = false;
    while (session.frames.length > 0 && session.frames[0]!.timestampSec * 1e6 < keepFromUs) {
      const evicted = session.frames.shift()!;
      // The displayed frame is always also a `frames` member — drop the
      // reference rather than leaving it pointing at a closed frame.
      if (evicted.frame === session.displayedFrame) session.displayedFrame = null;
      evicted.frame.close();
      freed = true;
    }
    if (freed) {
      session.retainedFloorUs = session.frames[0]
        ? session.frames[0].timestampSec * 1e6
        : keepFromUs;
    }
    return freed;
  }

  private handleDecoderOutput(handle: DecoderHandle, frame: VideoFrame): void {
    const session = handle.activeSession;
    if (!session || session.closed) {
      frame.close();
      return;
    }
    if (session.frames.length >= MAX_BUFFERED_FRAMES_PER_SESSION && !this.slideWindowForward(session)) {
      // Genuinely full of frames the target has NOT passed — the decoder is
      // racing ahead of consumption, which is the case this cap was always
      // meant to contain. Dropping the newest is correct here: everything
      // buffered is closer to the target than this frame is.
      frame.close();
      return;
    }
    const timestampSec = frame.timestamp / 1e6;
    session.frames.push({ frame, timestampSec });
    if (session.waiters.length > 0) {
      const stillWaiting: FrameWaiter[] = [];
      for (const waiter of session.waiters) {
        if (timestampSec > waiter.targetSec) waiter.settle();
        else stillWaiting.push(waiter);
      }
      session.waiters = stillWaiting;
    }
    this.enforceBudget();
  }

  /** Segment ids of all sessions currently held — for a caller that wants
   *  visibility into what's cached (mainly for tests/diagnostics; eviction
   *  itself is handled internally via setProtectedIds + enforceBudget). */
  activeSegmentIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Marks the given segment ids as exempt from LRU eviction — callers
   *  (useWebCodecsPreview.ts) pass the current + next segment ids here on
   *  every render via computeKeepSet. Everything else is fair game once the
   *  pool exceeds its session-count or buffered-frame ceiling, evicted
   *  least-recently-used first. Triggers an immediate budget check so
   *  shrinking the protected set (e.g. a segment falling from "next" to
   *  neither) can free budget right away rather than waiting for the next
   *  ensureSession/getFrameAt call. */
  setProtectedIds(ids: Iterable<string>): void {
    this.protectedIds = new Set(ids);
    this.enforceBudget();
  }

  /** Second, independent protected-set setter for the item-4 transition fix
   *  (docs/webcodecs-architecture-plan.md) — a caller that needs to keep the
   *  OUTGOING segment's session alive through its own transition window
   *  (after it has already stopped being {current, next}, see
   *  setProtectedIds above) asserts that segment's id here. Same full-replace
   *  contract as setProtectedIds (not additive/merged across calls) — the
   *  caller is expected to re-assert this every render/tick with whatever it
   *  currently considers "outgoing" (declarative, not a TTL/expiry: see this
   *  method's own design note in the item-4 audit for why a timer-based
   *  expiry was rejected — it would incorrectly lapse if playback is paused
   *  mid-transition). An empty iterable clears it entirely. */
  setTransitionProtectedIds(ids: Iterable<string>): void {
    this.transitionProtectedIds = new Set(ids);
    this.enforceBudget();
  }

  private touch(segmentId: string): void {
    this.lastAccess.set(segmentId, ++this.touchCounter);
  }

  private totalBufferedFrames(): number {
    let total = 0;
    for (const session of this.sessions.values()) total += session.frames.length;
    return total;
  }

  /** Non-protected session ids (checked against BOTH protected sets — see
   *  transitionProtectedIds' own doc), oldest-accessed first. */
  private evictionCandidates(): string[] {
    return Array.from(this.sessions.keys())
      .filter((id) => !this.protectedIds.has(id) && !this.transitionProtectedIds.has(id))
      .sort((a, b) => (this.lastAccess.get(a) ?? 0) - (this.lastAccess.get(b) ?? 0));
  }

  /** Enforces Section 4.3's ceilings: evicts least-recently-used
   *  non-protected sessions until both the session-count and
   *  total-buffered-frame budgets are satisfied, or nothing evictable is
   *  left (every remaining session is protected — cannot shrink further,
   *  by design, since current+next must always stay warm). */
  private enforceBudget(): void {
    while (this.sessions.size > MAX_CACHED_SESSIONS) {
      const victim = this.evictionCandidates()[0];
      if (!victim) break;
      this.releaseSession(victim);
    }
    while (this.totalBufferedFrames() > MAX_TOTAL_BUFFERED_FRAMES) {
      const victim = this.evictionCandidates()[0];
      if (!victim) break;
      this.releaseSession(victim);
    }
  }

  /** Releases every session and closes every idle pooled decoder handle —
   *  call on unmount. */
  dispose(): void {
    for (const segmentId of this.activeSegmentIds()) this.releaseSession(segmentId);
    for (const handles of this.idleHandles.values()) {
      for (const handle of handles) {
        try {
          handle.decoder.close();
        } catch {
          // Already closed — safe to ignore.
        }
      }
    }
    this.idleHandles.clear();
    this.protectedIds = new Set();
    this.transitionProtectedIds = new Set();
    this.lastAccess.clear();
  }
}
