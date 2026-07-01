import { VideoSegment, Project, AnimationType } from '../types';
import { resolveEffectiveTransition } from './transitionResolver';

/**
 * Tier-1 "plain video" predicate.
 *
 * A segment is PLAIN when it is a full-frame video clip with no per-frame
 * compositing of any kind — meaning its every exported frame is exactly the
 * cover-fit source media and nothing else. Such a segment can bypass the
 * per-frame canvas/PNG/IPC pipeline entirely and instead be produced by a
 * single ffmpeg trim+scale call at CRF 16 (see encodePlainVideoSegment in
 * segmentEncoder.ts), preserving quality (one clean Lanczos re-encode) and
 * running far faster.
 *
 * The transition checks mirror exportPipeline.ts's effectiveTransitionOut math
 * exactly (via the shared resolveEffectiveTransition resolver) so a segment
 * that participates in a transition on either edge — where its own file's head
 * or tail is a cross-segment blend, not raw source — is never treated as plain.
 *
 * Pure: no I/O, no mutation. `prevSegment`/`nextSegment` are the array
 * neighbours (undefined at the ends). Returns false for anything it is not
 * certain is plain — the canvas path remains the safe default.
 */
export function isPlainVideoSegment(
  segment: VideoSegment,
  prevSegment: VideoSegment | undefined,
  nextSegment: VideoSegment | undefined,
  project: Project,
): boolean {
  // Not a heading (headings are title cards, not full-frame media).
  if (segment.isHeading || segment.heading) return false;

  // Must resolve to a usable video asset.
  const asset = segment.assetId
    ? project.assets.find(a => a.id === segment.assetId)
    : undefined;
  if (!asset || asset.type !== 'video' || !asset.url) return false;

  // No body caption drawn (showOverlay + non-empty text is the caption gate).
  if (segment.showOverlay && segment.text) return false;

  // No positioned extra overlays.
  if ((segment.extraOverlays ?? []).length > 0) return false;

  // No global text layer is visible on this segment. A layer is hidden here
  // only when this segment's id is in its hiddenOnSegments list; any layer
  // that is visible here makes the segment non-plain.
  const targetedByGlobalLayer = (project.textLayers ?? []).some(
    layer => !(layer.hiddenOnSegments ?? []).includes(segment.id),
  );
  if (targetedByGlobalLayer) return false;

  // No animation (legacy enum or effectAnimation slug — covers ken-burns/zoom
  // transforms and the filter/pixel slugs like sepia/duotone).
  if (segment.animation !== AnimationType.NONE) return false;
  if (segment.effectAnimation && segment.effectAnimation !== 'none') return false;

  // No colour filter (per-segment or global).
  if (segment.overlayFilter) return false;
  if (project.globalOverlayFilter) return false;

  // No transition overlapping either edge. Mirrors exportPipeline.ts:
  //   incoming = prev's outgoing transition into this segment
  //   outgoing = this segment's transition into next
  const incomingDuration = prevSegment
    ? resolveEffectiveTransition(
        prevSegment,
        project.globalTransition,
        project.globalTransitionDuration,
      ).duration
    : 0;
  const outgoingDuration = nextSegment
    ? resolveEffectiveTransition(
        segment,
        project.globalTransition,
        project.globalTransitionDuration,
      ).duration
    : 0;
  if (incomingDuration !== 0 || outgoingDuration !== 0) return false;

  // Normal playback rate (a speed change would re-time the source frames).
  if (segment.playbackSpeed !== undefined && segment.playbackSpeed !== 1) {
    return false;
  }

  return true;
}
