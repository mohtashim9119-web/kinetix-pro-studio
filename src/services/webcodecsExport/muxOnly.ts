/**
 * Mux-only ffmpeg step (docs/webcodecs-export-plan.md §3.5, §7.2) — takes one
 * already-encoded, timing-free annexb H.264 stream (the WebCodecs export
 * worker's output, concatenated across runs by Step 5's orchestrator — Step
 * 4 only ever has one run) plus an optional audio file and produces the
 * final MP4. Kept as a small, separately-callable/testable function per the
 * plan's own note ("small, but separated for testability") rather than
 * inlined into exportPipelineWebCodecs.ts.
 *
 * TWO CORRECTIONS TO THE PLAN, both found via this step's real-WKWebView
 * verification (docs/webcodecs-export-plan.md §7.2's single-command shape
 * turned out insufficient for a REAL VideoToolbox-hardware-encoded annexb
 * stream — raw annexb carries no per-packet PTS, and stream-copying it
 * directly into an mp4 muxer has two distinct failure modes, not one):
 *
 * 1. INPUT FRAME-RATE FLAG: the plan specifies `-framerate <fps>`. That flag
 *    alone only affects the demuxer's DISPLAYED `r_frame_rate` (what
 *    `ffmpeg -i` prints) — NOT the per-packet duration the mp4 muxer writes
 *    into the track's stts table when doing `-c:v copy` on packets that
 *    carry no PTS (annexb has none). Reproduced directly against the bundled
 *    ffmpeg binary: a `h264_videotoolbox`-encoded 300-frame/30fps stream
 *    muxed with `-framerate 30` produced a 1.67s (179.97fps) file — wrong by
 *    exactly 6x. The same command with `-r 30` in place of `-framerate 30`
 *    produced the correct 10.00s/30fps file. (A `libx264`-encoded stream
 *    happened to mux correctly under either flag, which is why this would
 *    not have surfaced without testing the real hardware-encoder output the
 *    production path actually uses.) `buildVideoRemuxArgs` below uses `-r`.
 *
 * 2. `-shortest` SILENTLY DROPS AUDIO ENTIRELY when combined in the SAME
 *    ffmpeg invocation as a `-c:v copy` video stream that still has no real
 *    PTS (i.e. muxing straight from the raw .h264 with `-r <fps>` and audio
 *    together in one command). Reproduced repeatedly: `ffmpeg -r 30 -i
 *    run_0.h264 -i audio.wav -c:v copy -c:a aac -shortest ... out.mp4`
 *    produces a file byte-for-byte identical in size to the no-audio case —
 *    ffmpeg logs `audio:0KiB` in its own muxing-overhead summary even though
 *    it visibly ran the AAC encoder (`Qavg: ...` printed). Removing
 *    `-shortest` alone fixes it (audio present), confirming `-shortest`'s
 *    runtime "which stream is shorter" comparison reads the still-unset
 *    video PTS as effectively zero and truncates audio to nothing before the
 *    video stream's real duration is ever resolved. Neither swapping input
 *    order, `-map`-ing explicitly, `-fflags +genpts`, nor
 *    `-max_interleave_delta 0` fixed it — all tested directly against the
 *    bundled ffmpeg binary with a real VideoToolbox-encoded stream.
 *
 *    THE FIX: two ffmpeg calls instead of one when audio is present.
 *    Step 1 remuxes the raw annexb ALONE (`buildVideoRemuxArgs` — same
 *    command as the no-audio case) into a session-relative intermediate
 *    file, which forces ffmpeg to write real per-packet PTS into that
 *    intermediate's container. Step 2 (`buildAudioMuxArgs`) mixes in audio
 *    + `-shortest` against that ALREADY-TIMED intermediate, never against
 *    the raw timestamp-less stream — confirmed working (audio present,
 *    correct duration) against the same real stream that failed in one
 *    step. The intermediate is deleted after step 2. This is a genuine,
 *    necessary deviation from the plan's literal single-command text — audio
 *    being silently dropped is a correctness regression this project's own
 *    "never ship silently corrupt output" standard cannot tolerate; do not
 *    collapse this back to one command without re-verifying against a real
 *    VideoToolbox-encoded stream with a real audio track.
 *
 * 3. COLOR SPACE TAGGING (Step 6 amendment, 2026-07-21, Part A): both
 *    commands below also set `-colorspace bt709 -color_primaries bt709
 *    -color_trc bt709` — the same three output flags `segmentEncoder.ts`
 *    already sets on every legacy encode. This is NOT the fix the
 *    amendment originally proposed (an explicit `colorSpace` on
 *    `exportWorker.ts`'s `VideoFrame`/`VideoEncoder` construction) — that
 *    mechanism does not exist in the WebCodecs API: `VideoFrameInit` (the
 *    dictionary `new VideoFrame(canvas, init)` actually uses for a
 *    canvas-sourced frame — the only overload `exportWorker.ts` can use)
 *    has no `colorSpace` member (confirmed against MDN's documented
 *    property list, confirmed empirically in a real browser — passing one
 *    anyway is silently ignored — and confirmed by `tsc --noEmit`, which
 *    rejects it outright: "No overload matches this call ... 'colorSpace'
 *    does not exist in type 'VideoFrameInit'"), and `VideoEncoderConfig`
 *    has no `colorSpace` field either. The browser's own H.264 encoder
 *    (VideoToolbox hardware or software) is therefore the only thing that
 *    decides the actual RGB->YUV conversion matrix for a GL-composited
 *    frame, with no public API lever to steer it from `exportWorker.ts`.
 *    This file is the first and only ffmpeg touchpoint for that
 *    browser-encoded bitstream (unlike the legacy path, where
 *    `segmentEncoder.ts`'s own libx264 call already tags bt709 at encode
 *    time), so it is the closest available point to correct the OUTPUT
 *    container's color tags to match what the legacy path already claims.
 *    `-c:v copy` means this never touches the actual encoded picture data
 *    or the bitstream's own internal SPS VUI (whatever the browser encoder
 *    wrote there is unchanged) — only the MP4 container-level color tags
 *    change, mirroring the legacy path's own "tag bt709, no real
 *    conversion" posture (plan §10: no worse than today, real conversion
 *    deferred to Phase C). Applied to BOTH `buildVideoRemuxArgs` (the
 *    no-audio final file AND the with-audio intermediate) and
 *    `buildAudioMuxArgs` (the with-audio final mux) so the final output is
 *    explicitly tagged regardless of whether ffmpeg would otherwise
 *    propagate color metadata through a second `-c:v copy` pass.
 */

import type { FfmpegLike } from '../segmentEncoder';

function causeString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Args for a plain video-copy remux: real per-packet PTS get synthesized by
 * writing the raw annexb into an mp4 container (see file header, correction
 * 1 — `-r`, not `-framerate`, is what actually fixes the copied stream's
 * timing). This is the WHOLE command in the no-audio case (`outputFile` IS
 * the final file); in the with-audio case it targets an intermediate file
 * (see `buildAudioMuxArgs`). Exported for unit testing (muxOnly.test.ts).
 */
export function buildVideoRemuxArgs(videoFile: string, outputFile: string, fps: number): string[] {
  return [
    '-r', String(fps),
    '-i', videoFile,
    '-c:v', 'copy',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-movflags', '+faststart',
    '-y',
    outputFile,
  ];
}

/**
 * Args for the second step of the with-audio case: mixes audio into an
 * ALREADY-REAL-PTS video file (never the raw annexb directly — see file
 * header, correction 2, for why that combination silently drops the whole
 * audio track). Exported for unit testing (muxOnly.test.ts).
 */
export function buildAudioMuxArgs(premuxedVideoFile: string, audioFile: string, outputFile: string): string[] {
  return [
    '-i', premuxedVideoFile,
    '-i', audioFile,
    '-c:v', 'copy',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    '-y',
    outputFile,
  ];
}

/**
 * Runs the mux-only step via `ffmpeg.exec` — one call (no audio) or two
 * (with audio, see file header). Never resolves on ffmpeg failure — throws a
 * typed Error the caller (exportPipelineWebCodecs.ts) catches and converts
 * into an `ExportError`.
 *
 * `sessionId` is not passed to ffmpeg.exec (TauriFfmpeg already scopes exec
 * to its own internal, private session id) — it exists purely so a failure
 * message identifies which export run it came from, since TauriFfmpeg does
 * not expose its session id to callers.
 */
export async function muxOnly(
  ffmpeg: FfmpegLike,
  sessionId: string,
  videoFile: string,
  audioFile: string | null,
  outputFile: string,
  fps: number,
): Promise<void> {
  if (!audioFile) {
    try {
      await ffmpeg.exec(buildVideoRemuxArgs(videoFile, outputFile, fps));
    } catch (err) {
      throw new Error(
        `muxOnly failed (session ${sessionId}, video=${videoFile}, audio=none, fps=${fps}): ${causeString(err)}`,
      );
    }
    return;
  }

  const premuxFile = `${videoFile}.premux.mp4`;
  try {
    await ffmpeg.exec(buildVideoRemuxArgs(videoFile, premuxFile, fps));
  } catch (err) {
    throw new Error(
      `muxOnly failed at the video-premux step (session ${sessionId}, video=${videoFile}, fps=${fps}): ${causeString(err)}`,
    );
  }

  try {
    await ffmpeg.exec(buildAudioMuxArgs(premuxFile, audioFile, outputFile));
  } catch (err) {
    throw new Error(
      `muxOnly failed at the audio-mux step (session ${sessionId}, video=${premuxFile}, audio=${audioFile}, fps=${fps}): ${causeString(err)}`,
    );
  } finally {
    // Best-effort cleanup of the intermediate — a failure here must not mask
    // whatever mux result/error already happened above.
    try {
      await ffmpeg.deleteFile(premuxFile);
    } catch {
      // best-effort
    }
  }
}
