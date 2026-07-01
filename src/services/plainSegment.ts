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
  return isPlainMediaSegment(segment, prevSegment, nextSegment, project, 'video');
}

/**
 * Tier-2 "plain image" predicate — the image counterpart of
 * isPlainVideoSegment. A plain image segment is a full-frame image clip with
 * no per-frame compositing, so its every exported frame is byte-identical: the
 * cover-fit still and nothing else. Such a segment can be produced by rendering
 * ONE frame and letting ffmpeg loop it for the segment's duration (see
 * encodeStaticImageSegment in segmentEncoder.ts), skipping the N-identical-PNG
 * render/IPC/disk churn the canvas path would otherwise do.
 *
 * Shares every condition with isPlainVideoSegment via isPlainMediaSegment; the
 * only difference is the required asset type ('image'). Unlike video, an image
 * media draw has no time dependence at all, so the same no-caption/no-overlay/
 * no-global-layer/no-animation/no-filter/no-transition-edge/normal-speed gates
 * are sufficient to guarantee frame-identity.
 *
 * Pure: no I/O, no mutation. Returns false for anything it is not certain is
 * plain — the canvas path remains the safe default.
 */
export function isPlainImageSegment(
  segment: VideoSegment,
  prevSegment: VideoSegment | undefined,
  nextSegment: VideoSegment | undefined,
  project: Project,
): boolean {
  return isPlainMediaSegment(segment, prevSegment, nextSegment, project, 'image');
}

/**
 * Shared core for the plain-video and plain-image predicates. Identical logic
 * for both; `mediaType` selects the required asset type. Keeping this in one
 * place means the two fast paths can never drift apart on the compositing
 * checks that guarantee frame-identity.
 */
function isPlainMediaSegment(
  segment: VideoSegment,
  prevSegment: VideoSegment | undefined,
  nextSegment: VideoSegment | undefined,
  project: Project,
  mediaType: 'video' | 'image',
): boolean {
  // Not a heading (headings are title cards, not full-frame media).
  if (segment.isHeading || segment.heading) return false;

  // Must resolve to a usable asset of the expected media type.
  const asset = segment.assetId
    ? project.assets.find(a => a.id === segment.assetId)
    : undefined;
  if (!asset || asset.type !== mediaType || !asset.url) return false;

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
