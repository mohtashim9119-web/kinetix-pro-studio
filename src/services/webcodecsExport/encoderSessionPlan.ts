/**
 * WS3 Defect 1b — the ENCODER-SESSION plan, inside one GL run.
 *
 * WHY THIS EXISTS (and why the piece-level cap was not enough).
 *
 * `exportPipelineWebCodecs.ts`'s `planGlRunPieceStarts` bounds a GL PIECE at
 * `MAX_ENCODER_SESSION_FRAMES`, but it may only cut where a segment boundary
 * carries NO transition (a hard cut) — cutting mid-blend would move half a
 * cross-dissolve into a piece whose `segments` array no longer contains the
 * outgoing segment, and `deriveSlotPlan` would then composite something
 * different. On a timeline with a transition on EVERY boundary there is no
 * hard cut anywhere, so that planner correctly returns a single piece and the
 * cap never engages. Field evidence: a 332-segment, fully-transitioned 1080p30
 * project still ran ONE VideoEncoder session across 38061 frames and hung in
 * `encoder-flush` with the piece cap already shipped. The cap was unreachable
 * for exactly the class of project that needed it.
 *
 * This module bounds the ENCODER SESSION instead of the piece. A session
 * boundary is not a piece boundary: the worker keeps one GL context, one
 * compositor, one text renderer, one `segments` array, one demux cache and one
 * set of decode cursors across it, and only the `VideoEncoder` is flushed,
 * closed and rebuilt. So it is reachable on ANY timeline — transitions do not
 * constrain it at all, because nothing about compositing changes.
 *
 * OUTPUT-NEUTRALITY, BY CONSTRUCTION — three guarantees, none measured:
 *
 *  1. NO FRAME IS ADDED OR DROPPED. The frame loop is untouched: it still
 *     walks `i` from 0 to `totalFrames - 1` on the same absolute grid and
 *     still submits exactly one `VideoFrame` per `i`. A rotation happens
 *     BETWEEN two `encode()` calls, never in place of one.
 *  2. NO KEYFRAME IS ADDED. A new encoder session always begins with an IDR,
 *     so a rotation at frame `i` forces `i` to be a keyframe. `planEncoderSessions`
 *     therefore only ever cuts where `isKeyFrame(i)` is ALREADY true — the
 *     caller's own predicate, the same one the unsplit run would have passed to
 *     `encoder.encode()`. The frame that starts a session was going to be an
 *     IDR either way, so the keyframe pattern of the output stream is
 *     identical.
 *  3. NO TIMESTAMP CHANGES. Frame timestamps are computed from the absolute
 *     index (`Math.round(i * 1e6 / fps)`) and do not consult the encoder, so a
 *     session change cannot perturb them. The mux writes per-packet duration
 *     from `-r <fps>` regardless (see CLAUDE.md §4 Export).
 *
 * And the stream stays decodable across the seam because the encoder is
 * configured `avc: { format: 'annexb' }` (`exportWorker.ts`'s `createEncoder`),
 * which emits SPS/PPS inline ahead of every IDR — so session N+1's first chunk
 * carries its own parameter sets rather than depending on session N's
 * out-of-band `description`. That is precisely the property AVCC lacks and the
 * reason annexb is mandatory on this path.
 */

/**
 * Maximum frames one `VideoEncoder` session may span. 1800 = 60s at 30fps.
 *
 * Stated in FRAMES, not seconds, because every accumulator this bounds — the
 * encoder's internal reference/reorder state and its output bookkeeping —
 * grows per frame, not per second.
 *
 * HONEST CAVEAT (carried forward from the piece cap this replaces as the
 * reachable bound): 1800 is a judgement call, not a measured cliff. The prior
 * "~62s platform ceiling" was REFUTED in this repo's own history (commit
 * 4d4922c) and is deliberately NOT the basis for this number. The 38061-frame
 * field failure gives an upper bound on what is too much and no lower bound on
 * what is enough. What 1800 buys is a 21x reduction in per-session encoder
 * state against a per-rotation fixed cost of one flush plus one
 * `createEncoder` ladder pass. Tune it from a real run's `phaseMs`, not from
 * this comment.
 */
export const MAX_ENCODER_SESSION_FRAMES = 1800;

/**
 * Frame indices (run-local, 0-based) at which a new `VideoEncoder` session
 * begins. Always starts with `0`.
 *
 * Greedy, and deliberately the same shape as `planGlRunPieceStarts`: extend
 * the current session until it would exceed `capFrames`, then cut at the LAST
 * frame since the session began for which `isKeyFrame` was already true.
 * Cutting BACKWARD to the last keyframe rather than forward to the next is
 * what makes the bound a real ceiling — a forward cut would overshoot by up to
 * one GOP.
 *
 * `isKeyFrame(0)` is true by construction in every caller (`i % gop === 0`),
 * so the first session opens on an IDR like any other.
 *
 * `capFrames` is a strict ceiling WHENEVER a keyframe exists inside the window
 * — which is the production case, since `gopFrames(fps)` is `2 * fps` (60
 * frames at 30fps) against a cap of 1800. If the caller ever supplies a cap
 * SMALLER than its own GOP there is no keyframe to cut to inside the window,
 * and the plan cuts at the first keyframe past the cap instead: the session is
 * then bounded by `capFrames + gop`, not by `capFrames`. Overshooting is the
 * only alternative to not bounding at all, and it is stated here rather than
 * silently assumed away.
 *
 * Degenerate inputs return `[0]` — one session, i.e. exactly the pre-rotation
 * behaviour:
 *  - `totalFrames <= 1`, or `capFrames <= 0` (nothing to bound);
 *  - a run with no keyframe at all after index 0 (cannot cut neutrally).
 */
export function planEncoderSessions(
  totalFrames: number,
  isKeyFrame: (i: number) => boolean,
  capFrames: number = MAX_ENCODER_SESSION_FRAMES,
): number[] {
  const starts = [0];
  if (!Number.isFinite(totalFrames) || totalFrames <= 1) return starts;
  if (!Number.isFinite(capFrames) || capFrames <= 0) return starts;

  let sessionStart = 0;
  let lastKey = -1;
  for (let i = 1; i < totalFrames; i++) {
    // Overflow is tested BEFORE `i` becomes a cut candidate. Order matters: if
    // `lastKey` were updated first, the frame that TRIPS the overflow could
    // also be the frame cut to, and the session would come out at exactly
    // `capFrames + 1`. Testing first keeps every candidate strictly inside the
    // window, which is what makes `capFrames` a ceiling rather than a target.
    if (i - sessionStart > capFrames && lastKey > sessionStart) {
      starts.push(lastKey);
      sessionStart = lastKey;
      // Resume scanning FROM the cut, so keyframes between `lastKey` and `i`
      // are still available to the new session. Terminates: `lastKey` is
      // strictly greater than the previous session start every time, so the
      // start sequence is strictly increasing and bounded by `totalFrames`.
      i = lastKey;
      lastKey = -1;
      continue;
    }
    if (isKeyFrame(i)) lastKey = i;
  }
  return starts;
}

/**
 * Per-session frame counts for a plan, in order. They sum to `totalFrames` by
 * construction — the plan partitions `[0, totalFrames)` and never renumbers
 * anything — which is the arithmetic form of guarantee 1 above.
 */
export function encoderSessionLengths(starts: readonly number[], totalFrames: number): number[] {
  return starts.map((s, i) => (i + 1 < starts.length ? starts[i + 1]! : totalFrames) - s);
}
