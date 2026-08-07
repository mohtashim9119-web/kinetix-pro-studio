import { Project, Asset, VideoSegment, TransitionType } from '../types';
import { encodeSegment, encodePlainVideoSegment, encodeStaticImageSegment, FfmpegLike } from './segmentEncoder';
import { FrameGlobalConfig } from './frameRenderer';
import { resolveEffectiveTransition } from './transitionResolver';
import { isPlainVideoSegment, isPlainImageSegment } from './plainSegment';
import { findPartitionViolations } from './timelinePartition';

export interface ExportOptions {
  width?: number;
  height?: number;
  fps?: number;
}

export type ExportStage =
  | { type: 'loading_ffmpeg' }
  | { type: 'encoding_segment'; index: number; total: number; frame: number; totalFrames: number }
  | { type: 'muxing' }
  | { type: 'done' };

export type ProgressCallback = (stage: ExportStage) => void;

export type ExportErrorKind =
  | 'ffmpeg_load'
  | 'encode'
  | 'concat'
  | 'mux'
  | 'asset_missing'
  | 'cancelled'
  | 'timeline_gap'
  | 'unknown';

export interface ExportError {
  kind: ExportErrorKind;
  message: string;
  segmentIndex?: number;
  cause?: string;
}

export type ExportResult =
  | { ok: true; outputFile: string }
  | { ok: false; error: ExportError };

function causeString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * TASK 4 (2026-08-07) — the export guard the ruling asked to be made explicit.
 *
 * **`segmentEncoder.ts` still ignores `startTime` entirely.** It always has:
 * a segment's frame count comes from `duration` alone (`segmentEncoder.ts`'s
 * own `totalFrames = max(1, round(segment.duration * fps))`), and segments are
 * concatenated in ARRAY ORDER, not by position. That was §1.3's finding in
 * `docs/segments-invariant-ruling.md`, and Model P does not change it — it
 * changes what upstream GUARANTEES about the array before export ever sees it.
 *
 * So export's correctness now rests entirely on a PRECONDITION it does not
 * itself produce: that `project.segments` is already a gapless, contiguous
 * partition by the time it reaches here. Every writer of `segments` in
 * `App.tsx` (Apply Sync, the lock toggle, the drag commit) now routes through
 * `enforceGaplessPartition` (`timelinePartition.ts`), so that precondition
 * holds for anything produced going forward — but "holds for anything produced
 * going forward" is an argument about the REST of the codebase, not a fact
 * export can verify about itself. A project persisted before this fix, or
 * loaded from an external source, is not bound by that argument at all.
 *
 * Rather than leave that correct-by-coincidence, this function makes the
 * precondition an EXPLICIT, checked gate: every segment writer already routes
 * through `enforceGaplessPartition`, so a well-formed project always passes it
 * for free, and a project that still carries a real gap (legacy data, or a
 * lock-lock conflict `timelinePartition.ts` can report but not silently
 * close — ruling §4.1) fails LOUDLY, before a single frame is rendered,
 * instead of silently producing the A/V-desynced, heading-dropping export
 * `docs/segments-invariant-ruling.md` §1.3 first found. Called once, from both
 * export entry points (`exportProject` here and
 * `webcodecsExport/exportPipelineWebCodecs.ts`'s `exportProjectWebCodecs`), so
 * neither path can regress independently of the other.
 *
 * Deliberately does NOT check against `audioDuration` (a head/tail mismatch
 * against the voiceover's own length): that is a video/audio LENGTH
 * difference, already handled by ffmpeg's `-shortest` mux flag, not the
 * INTERNAL segment-position divergence this guard exists to catch. An
 * interior gap or overlap is the only shape that can make the exported video's
 * own frame positions disagree with what the editor showed.
 */
export function checkTimelineIsGapless(segments: VideoSegment[]): ExportError | null {
  const violations = findPartitionViolations(segments);
  if (violations.length === 0) return null;
  const detail = violations
    .map(v => `segment ${v.index + 1} (${v.kind}, ${v.amountSec.toFixed(3)}s)`)
    .join('; ');
  return {
    kind: 'timeline_gap',
    message:
      `Export aborted — the timeline has ${violations.length} unassigned or overlapping span(s) that would ` +
      `desync audio/video in the exported file: ${detail}. This happens when two locked segments leave a gap ` +
      `neither can absorb. Unlock one of the segments named above and re-run Apply Sync, then export again.`,
  };
}

/**
 * Resolves the effective outgoing transition duration for `segment` into
 * `next`. Returns 0 when there is no next segment, when the effective
 * transition is NONE, or when the resolved duration is 0/undefined.
 * Delegates the per-segment/global precedence to the shared
 * resolveEffectiveTransition resolver (transitionResolver.ts).
 */
function effectiveTransitionOut(
  segment: VideoSegment,
  next: VideoSegment | undefined,
  globalTransition: TransitionType,
  globalTransitionDuration: number,
): number {
  if (!next) return 0;
  return resolveEffectiveTransition(segment, globalTransition, globalTransitionDuration).duration;
}

/**
 * Full export pipeline:
 *   1. Accepts a pre-loaded FfmpegLike instance (direct FFmpeg or Comlink worker proxy).
 *   2. Encode each segment to an intermediate MP4 (H.264).
 *   3. Write a concat manifest and run ffmpeg concat demuxer to join them.
 *   4. Mux in the voiceover audio (AAC) if present.
 *   5. Output a single MP4 blob.
 *
 * Returns ExportResult — never throws. All stage failures are mapped to typed errors.
 */
export async function exportProject(
  project: Project,
  ffmpeg: FfmpegLike,
  options: ExportOptions = {},
  onProgress: ProgressCallback = () => undefined,
): Promise<ExportResult> {
  const fps = options.fps ?? 30;
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;

  const globalConfig: FrameGlobalConfig = {
    overlayConfig: project.globalOverlayConfig,
    globalOverlayFilter: project.globalOverlayFilter,
    globalTextLayers: project.textLayers ?? [],
    headings: project.headings ?? [],
  };

  const assetMap = new Map<string, Asset>(project.assets.map(a => [a.id, a]));
  const segments = project.segments;
  const segmentFiles: string[] = [];
  const allTempFiles: string[] = [];

  // TASK 4 — explicit gapless-partition guard (see checkTimelineIsGapless's
  // own doc comment). Before any ffmpeg work happens.
  const gapError = checkTimelineIsGapless(segments);
  if (gapError) return { ok: false, error: gapError };

  // ── 1. Encode each segment ──────────────────────────────────────────────────
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    // Treat assetId=undefined the same as a defined-but-missing asset —
    // both mean no visual content is available for this segment.
    const asset = segment.assetId ? assetMap.get(segment.assetId) : undefined;
    if (segment.assetId && !asset?.url) {
      return { ok: false, error: { kind: 'asset_missing',
        message: `Segment "${segment.id}" has no asset` } };
    }
    if (!segment.assetId) {
      // No asset assigned — encode black frames with text overlays only.
      // This is intentional fallback behavior, not an error.
      // Log so the user can diagnose if unexpected.
      console.warn(
        `[exportPipeline] Segment (id: ${segment.id}) has no assetId — encoding black frames.`
      );
    }
    const nextSegment = segments[i + 1];
    const nextAsset = nextSegment?.assetId ? assetMap.get(nextSegment.assetId) : undefined;
    const prevSegment = segments[i - 1];
    // Centered transition window (docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20)'s
    // transition-centering entry — supersedes the old 100%-after-the-
    // boundary placement, D7 in project-state.md's Ignored Low Risk Bugs):
    // the blend zone straddles the boundary 50/50, so only HALF of the
    // resolved transition duration extends into this segment's neighbor on
    // either edge. effectiveTransitionOut still returns the FULL duration
    // (the value alpha ramps across, and what segmentEncoder.ts's
    // resolveBlendFrameParams needs to reconstruct the centered zone) —
    // only the encode-range skip/extension is halved here.
    const startTimeOffset = prevSegment
      ? effectiveTransitionOut(prevSegment, segment, project.globalTransition, project.globalTransitionDuration) / 2
      : 0;
    const trailingExtension = effectiveTransitionOut(
      segment, nextSegment, project.globalTransition, project.globalTransitionDuration,
    ) / 2;

    const segFile = `seg_out_${i}.mp4`;
    segmentFiles.push(segFile);
    allTempFiles.push(segFile);

    const segmentFrameCount = Math.max(
      1,
      Math.round((segment.duration - startTimeOffset + trailingExtension) * fps),
    );
    onProgress({
      type: 'encoding_segment',
      index: i,
      total: segments.length,
      frame: 0,
      totalFrames: segmentFrameCount,
    });

    // Tier 1: a plain full-frame video segment (no caption/overlay/animation/
    // filter/transition/speed change) is produced by a single ffmpeg trim+scale
    // call instead of the per-frame canvas pipeline. Output flags match the
    // canvas path exactly so both concat cleanly. Everything else — composited
    // segments, images, headings — stays on the unchanged canvas path below.
    const isPlain =
      !!asset &&
      asset.type === 'video' &&
      isPlainVideoSegment(segment, prevSegment, nextSegment, project);

    // Tier 2: a plain full-frame image segment (same no-compositing conditions
    // as Tier 1) is byte-identical every frame, so render one frame and let
    // ffmpeg loop it for the duration instead of writing N identical PNGs.
    // Animated/captioned/filtered/transitioned image segments stay on the
    // canvas path below.
    const isPlainImage =
      !!asset &&
      asset.type === 'image' &&
      isPlainImageSegment(segment, prevSegment, nextSegment, project);

    try {
      const mp4Bytes = isPlain
        ? await encodePlainVideoSegment(segment, asset!, ffmpeg, { fps, width, height })
        : isPlainImage
        ? await encodeStaticImageSegment(segment, asset!, globalConfig, ffmpeg, { fps, width, height })
        : await encodeSegment(
            segment,
            asset,
            ffmpeg,
            globalConfig,
            {
              fps,
              width,
              height,
              nextSegment,
              nextAsset,
              globalTransitionDuration: project.globalTransitionDuration,
              globalTransition: project.globalTransition,
              startTimeOffset,
              trailingExtension,
              onProgress: (frame, totalFrames) => {
                onProgress({
                  type: 'encoding_segment',
                  index: i,
                  total: segments.length,
                  frame,
                  totalFrames,
                });
              },
            },
          );
      await ffmpeg.writeFile(segFile, mp4Bytes);
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: 'encode',
          message: `Failed to encode segment ${i + 1}.`,
          segmentIndex: i,
          cause: causeString(err),
        },
      };
    }
  }

  // ── 2. Concatenate segments ────────────────────────────────────────────────
  onProgress({ type: 'muxing' });

  let finalVideoFile: string;

  if (segmentFiles.length === 1) {
    finalVideoFile = segmentFiles[0]!;
  } else {
    const concatManifest = segmentFiles.map(f => `file '${f}'`).join('\n');
    const manifestFile = 'concat_list.txt';
    const manifestBytes = new TextEncoder().encode(concatManifest);
    allTempFiles.push(manifestFile);
    finalVideoFile = 'concat_video.mp4';
    allTempFiles.push(finalVideoFile);

    try {
      await ffmpeg.writeFile(manifestFile, manifestBytes);
      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', manifestFile,
        '-c', 'copy',
        '-y',
        finalVideoFile,
      ]);
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: 'concat',
          message: 'Failed to concatenate segments.',
          cause: causeString(err),
        },
      };
    }
  }

  // ── 3. Mux voiceover audio ──────────────────────────────────────────────────
  const outputFile = 'export_final.mp4';
  allTempFiles.push(outputFile);

  const voiceoverAsset = project.voiceoverId ? assetMap.get(project.voiceoverId) : undefined;

  try {
    if (voiceoverAsset?.url) {
      const audioFile = 'voiceover_audio';
      allTempFiles.push(audioFile);
      const audioResp = await fetch(voiceoverAsset.url);
      const audioBytes = new Uint8Array(await audioResp.arrayBuffer());
      await ffmpeg.writeFile(audioFile, audioBytes);
      await ffmpeg.exec([
        '-i', finalVideoFile,
        '-i', audioFile,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-movflags', '+faststart',
        '-y',
        outputFile,
      ]);
    } else {
      await ffmpeg.exec([
        '-i', finalVideoFile,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-y',
        outputFile,
      ]);
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'mux',
        message: 'Failed to mux audio into the final video.',
        cause: causeString(err),
      },
    };
  }

  // ── 4. Clean up intermediates; leave the final MP4 in the session dir ────────
  // The final file is deliberately NOT read back into renderer memory. Reading it
  // over IPC (ffmpeg_read_file) returns a JSON number[] (~8× the file size in the
  // WebView heap), which the old save path then re-copied as a Uint8Array, a Blob,
  // an arrayBuffer(), and a ~1.37× base64 string — a 5–6× pile-up that crashed
  // WebView2's OOM guard (STATUS_BREAKPOINT) on large exports. Instead the native
  // save path copies export_final.mp4 straight from the session temp dir to the
  // user's chosen path (save_session_file), so its bytes never enter the renderer.
  //
  // `outputFile` is excluded from the cleanup below so it survives for that copy;
  // the whole session dir (including it) is removed by ffmpeg_destroy_session on
  // teardown.
  const intermediates = allTempFiles.filter(f => f !== outputFile);
  await Promise.allSettled(intermediates.map(f => ffmpeg.deleteFile(f)));

  onProgress({ type: 'done' });
  return { ok: true, outputFile };
}
