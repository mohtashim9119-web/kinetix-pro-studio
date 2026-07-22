/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GL-compositable routing predicate (docs/webcodecs-export-plan.md §3.2) — a
 * sibling of `../plainSegment.ts`, same philosophy: conservative by design;
 * anything not certain to be GL-expressible routes to the proven canvas
 * path (Tier C, `encodeSegment` — unchanged). This is Step 5 of that plan.
 *
 * PURE: no I/O, no DOM, no React — worker-safe (this predicate is also
 * evaluated on the main thread by the orchestrator, but nothing here
 * prevents it from running inside a worker too). Only imports `../../types`,
 * `../transitionResolver`, and `../../effectsOptions` — the same import
 * shape as `plainSegment.ts`.
 *
 * A segment is GL-compositable when ALL of:
 *   1. Its effective animation slug resolves to zoom-in / zoom-out / none —
 *      see `isGlCompatibleAnimationSlug` below.
 *   2. It carries no color filter (`segment.overlayFilter` /
 *      `project.globalOverlayFilter`, the 24-filter CSS system in
 *      `constants.ts`'s `getFilterStyle`) — see `hasNoColorFilter`.
 *   3. The resolved transition on BOTH edges (this segment's own outgoing
 *      edge into `neighbors.next`, and `neighbors.prev`'s outgoing edge into
 *      this segment) is a GL slug, a hard-cut, or a zero-duration no-op —
 *      see `isGlCompatibleTransitionEdge`.
 *   4. It resolves to a real, GL-renderable (video/image) asset — see
 *      `hasGlRenderableAsset`. NOT one of the plan's own §3.2 bullets, but
 *      required by construction: `exportWorker.ts`'s `RunState.
 *      resolveSlotSource` returns `null` for a segment with no asset (or a
 *      non-video/non-image asset), and the per-tick render loop's `if
 *      (!aSrc) continue;` SKIPS that tick's frame entirely rather than
 *      encoding a black frame — routing such a segment into a GL run would
 *      silently shorten that run's output (missing frames), exactly the
 *      class of bug the plan's frame-count guard exists to catch. Since the
 *      worker has no code path that renders a no-asset/audio-only segment
 *      today, this predicate must fail it conservatively rather than assume
 *      the worker will do something reasonable — read directly from
 *      `exportWorker.ts`, not from the plan text (which does not call this
 *      case out).
 *
 * Text (captions, extra overlays, global text layers, headings) is
 * deliberately NOT checked — the GL text renderer (plan §4.3, Step 6) will
 * render all of it; this predicate only decides whether the MEDIA/transition
 * compositing for a segment is GL-expressible today.
 * `playbackSpeed !== 1` is deliberately NOT checked — sequential decode maps
 * segment-local time to source time exactly like `toSourceTime` does for
 * preview, independent of speed.
 * Grade never disqualifies — it is GL-native (`compositeParams.ts`'s own
 * per-segment `effectGrade` resolution).
 */

import { AnimationType, type Project, type VideoSegment } from '../../types';
import { ANIMATION_NONE } from '../../effectsOptions';
import { resolveEffectiveTransition, type EffectiveTransition } from '../transitionResolver';

/**
 * The clip-effect slugs sharing `VideoSegment.effectAnimation`'s field with
 * the two real GL animation slugs, for historical reasons — see
 * `effectsOptions.ts`'s own TODO(filters-tab) comment (lines 61–70): these
 * five are FILTERS, not animations, fully implemented on the legacy path via
 * `frameRenderer.ts`'s `resolveClipEffectFilter` (color-grade, gaussian-blur,
 * sepia, invert — CSS filter strings) and `applyDuotone` (duotone — a
 * getImageData/putImageData pixel op). None has a GL implementation.
 * Restated here as a named set (rather than left as an implicit "anything
 * that isn't zoom-in/zoom-out/none/undefined") purely so this predicate's
 * disqualification list is self-documenting against effectsOptions.ts's own
 * catalog, even though `isGlCompatibleAnimationSlug` below would reject them
 * either way (they are not 'zoom-in'/'zoom-out').
 */
const CLIP_EFFECT_SLUGS: ReadonlySet<string> = new Set([
  'color-grade',
  'gaussian-blur',
  'sepia',
  'invert',
  'duotone',
]);

/**
 * The 4 transition slugs the GL engine implements — duplicated from
 * `compositeParams.ts`'s own (private, non-exported) `GL_TRANSITION_SLUGS`
 * rather than imported, because that constant has no `export` keyword and
 * the plan's explicit scope for this step does not modify
 * `compositeParams.ts` (see docs/webcodecs-export-plan.md §2 and this
 * project's own "files NOT modified" list). Same duplication precedent as
 * `exportWorker.ts`'s `toSourceTime`/`sourceRange` (copied from
 * `useWebCodecsPreview.ts` for the identical reason — a private export
 * living in a file this work must not touch). Keep byte-identical to
 * `compositeParams.ts`'s set if that one ever changes; a divergence here
 * would silently misroute segments between GL and canvas tiers.
 *
 * Exported (not just an internal constant) because `exportPipelineWebCodecs.ts`
 * needs the identical set for its own cross-segment consistency pass
 * (`groupConnectedComponents`) — both must agree on exactly which resolved
 * transition slugs count as "GL-compatible."
 */
export const GL_TRANSITION_SLUGS: ReadonlySet<string> = new Set([
  'cross-dissolve',
  'dip-black',
  'dip-white',
  'light-leak',
]);

/**
 * Mirrors `compositeParams.ts`'s private `resolveEffectiveAnimation`
 * PRECEDENCE (own `effectAnimation` slug wins over the legacy `animation`
 * enum when set and not the none-sentinel) but NOT its return semantics:
 * that function collapses every non-zoom slug (ken-burns, the 5 clip-effect
 * slugs, and any legacy `AnimationType` other than ZOOM_IN/ZOOM_OUT) to
 * `null`, which `deriveCompositeParams` correctly reads as "no zoom scale
 * applied" — true for what the GL compositor renders, but silently wrong as
 * a routing signal: a `ken-burns` segment renders a REAL pan/zoom transform
 * on the legacy canvas path (`canvasAnimations.ts`), so treating
 * `resolveEffectiveAnimation`'s `null` as "safe to route to GL" would drop
 * that visible animation from the export. This function therefore asks a
 * different question — "is the segment's effective animation slug ITSELF
 * one the GL engine implements" — and returns `false` (never a silent pass)
 * for every slug that isn't zoom-in/zoom-out/none/unset, including the 5
 * clip-effect slugs and every other legacy `AnimationType` member
 * (KEN_BURNS, FLOAT, BOUNCE, PULSE, HEARTBEAT, WOBBLE, ROTATE, …).
 */
function isGlCompatibleAnimationSlug(segment: VideoSegment): boolean {
  if (segment.effectAnimation && segment.effectAnimation !== ANIMATION_NONE) {
    // Explicit reject for the 5 clip-effect slugs (redundant with the
    // zoom-in/zoom-out check below, since none of them equal either — kept
    // as its own branch so `CLIP_EFFECT_SLUGS` is load-bearing, not just
    // documentary, and so a future GL clip-effect pass has one obvious place
    // to widen).
    if (CLIP_EFFECT_SLUGS.has(segment.effectAnimation)) return false;
    return segment.effectAnimation === 'zoom-in' || segment.effectAnimation === 'zoom-out';
  }
  return segment.animation === AnimationType.NONE
    || segment.animation === AnimationType.ZOOM_IN
    || segment.animation === AnimationType.ZOOM_OUT;
}

/**
 * No color filter set, on either the segment or the project-global fallback
 * (`segment.overlayFilter` / `project.globalOverlayFilter`, the 24-named-
 * filter CSS system — `constants.ts`'s `FILTERS`/`getFilterStyle`, applied
 * on the legacy path via `frameRenderer.ts`'s `ctx.filter = filterStr`).
 * `'none'` (the FILTERS[0] off-state, and the literal value
 * `onApplyFilterToAll`/the Effects tab can persist onto a segment or the
 * project) is treated as EQUIVALENT to unset, per the plan's own "unset/
 * none" phrasing (§3.2) — a stricter `if (segment.overlayFilter) return
 * false` (matching `plainSegment.ts`'s own check) would incorrectly treat a
 * segment explicitly reset to "no filter" as filtered, needlessly losing GL
 * eligibility for a segment that renders identically either way (no visual
 * difference at 'none' vs. unset — `getFilterStyle` returns the same 'none'
 * no-op CSS string for both).
 */
function hasNoColorFilter(segment: VideoSegment, project: Project): boolean {
  const isUnsetOrNone = (v: string | undefined): boolean => !v || v === 'none';
  return isUnsetOrNone(segment.overlayFilter) && isUnsetOrNone(project.globalOverlayFilter);
}

/**
 * Whether ONE edge's resolved transition is GL-compatible: a zero-duration
 * resolution (no-op — nothing ever blends, regardless of which `transition`
 * value it carries) always passes; otherwise the resolved `transition` slug
 * must be one of the 4 GL_TRANSITION_SLUGS. Any legacy `TransitionType` enum
 * value (FADE, SLIDE, WIPE, ZOOM, BLUR, …) with a real (>0) duration fails —
 * per plan §3.2, "a legacy enum transition on either edge fails the
 * predicate for BOTH segments sharing that edge": calling this once per
 * side, from each segment's own perspective, with the SAME shared boundary
 * (both sides resolve through `resolveEffectiveTransition` keyed off the
 * OUTGOING segment's own field, exactly like `compositeParams.ts`'s
 * `resolveActiveBoundary` and `plainSegment.ts`'s own edge checks) is what
 * makes both segments independently fail without any special cross-segment
 * signaling — see this file's own top-level doc comment.
 *
 * `hasNeighbor` mirrors `plainSegment.ts`'s own edge-existence gating
 * (`nextSegment ? resolveEffectiveTransition(...) : 0`): a segment at either
 * end of the timeline has no real edge to fail on that side.
 */
function isGlCompatibleTransitionEdge(
  edgeOutgoingSegment: VideoSegment | undefined,
  hasNeighbor: boolean,
  project: Project,
): boolean {
  if (!hasNeighbor || !edgeOutgoingSegment) return true;
  const resolved: EffectiveTransition = resolveEffectiveTransition(
    edgeOutgoingSegment,
    project.globalTransition,
    project.globalTransitionDuration,
  );
  if (resolved.duration <= 0) return true;
  return GL_TRANSITION_SLUGS.has(resolved.transition);
}

/**
 * Resolves to a real video/image asset the GL worker can actually source a
 * texture from today — see this file's top-level doc comment, point 4, for
 * why this is required despite not being one of the plan's own §3.2
 * bullets. Mirrors `plainSegment.ts`'s own asset-resolution shape
 * (`segment.assetId ? project.assets.find(...) : undefined`).
 */
function hasGlRenderableAsset(segment: VideoSegment, project: Project): boolean {
  const asset = segment.assetId ? project.assets.find((a) => a.id === segment.assetId) : undefined;
  return !!asset && (asset.type === 'video' || asset.type === 'image') && !!asset.url;
}

export interface GlCompositableNeighbors {
  prev?: VideoSegment;
  next?: VideoSegment;
}

/**
 * The routing predicate itself — see this file's top-level doc comment for
 * the full rule list. Pure; returns `false` (never throws, never assumes)
 * for anything it is not certain is GL-expressible.
 */
export function isGlCompositableSegment(
  segment: VideoSegment,
  project: Project,
  neighbors: GlCompositableNeighbors,
): boolean {
  if (!hasGlRenderableAsset(segment, project)) return false;
  if (!isGlCompatibleAnimationSlug(segment)) return false;
  if (!hasNoColorFilter(segment, project)) return false;
  // Outgoing edge: this segment's own transition into `neighbors.next`.
  if (!isGlCompatibleTransitionEdge(segment, !!neighbors.next, project)) return false;
  // Incoming edge: `neighbors.prev`'s transition into this segment.
  if (!isGlCompatibleTransitionEdge(neighbors.prev, !!neighbors.prev, project)) return false;
  return true;
}
