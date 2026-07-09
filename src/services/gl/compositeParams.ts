/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PURE derivation of per-tick WebGL2 compositor parameters from
 * (segments, currentTime, config) — docs/webgl-architecture-plan.md
 * Section 3.2/6, Phase 1. No React, no DOM, no pool/decoder dependency:
 * this is the same role toSourceTime/computeKeepSet
 * (src/hooks/useWebCodecsPreview.ts) play for the decode side, and is
 * tested the same mock-free way (see compositeParams.test.ts).
 *
 * Deliberately does NOT decide which content belongs in texture slot 'a'
 * vs 'b' — that is a Phase 3 integration concern (which frame source feeds
 * which slot), kept separate from "what should this tick's render look
 * like" so this function stays reusable, unmodified, from either a
 * playhead-driven preview loop or a future sequential export loop (Section
 * 4's design constraint).
 */

import { AnimationType, TransitionType, type VideoSegment } from '../../types';
import { ANIMATION_NONE } from '../../effectsOptions';
import { resolveEffectiveTransition } from '../transitionResolver';

/** The 4 transitions this engine implements (plan Section 5.1). Any other
 *  resolved transition (legacy enum, or an unscoped slug like
 *  'slide-push') is out of scope for the GL compositor and yields a null
 *  `transition` — Phase 3 decides what happens on that segment instead. */
export type TransitionSlug = 'cross-dissolve' | 'dip-black' | 'dip-white' | 'light-leak';

const GL_TRANSITION_SLUGS: ReadonlySet<string> = new Set<TransitionSlug>([
  'cross-dissolve',
  'dip-black',
  'dip-white',
  'light-leak',
]);

/** The 2 animations this engine implements (plan Section 5.2). */
export type ZoomAnimationSlug = 'zoom-in' | 'zoom-out';

export interface GradeParams {
  brightness: number; // -1..1, 0 = neutral
  contrast: number;   // -1..1, 0 = neutral
  saturation: number; // -1..1, 0 = neutral
  temperature: number; // -1..1, 0 = neutral (+ = warm)
}

export const NEUTRAL_GRADE: GradeParams = { brightness: 0, contrast: 0, saturation: 0, temperature: 0 };

export interface TransitionParams {
  type: TransitionSlug;
  /** 0 at the transition window's start (pure outgoing content), 1 at its
   *  end (pure incoming content), linear in between. */
  progress: number;
}

export interface CompositeParams {
  /** null when no GL-scoped transition is active this tick. */
  transition: TransitionParams | null;
  /** 1.0 = no zoom. Already the final resolved scale factor (see
   *  resolveAnimScale below) — glCompositor.ts's zoom pass consumes this
   *  directly as `u_scale`, no further derivation needed at render time. */
  animScale: number;
  grade: GradeParams;
}

export interface ProjectEffectConfig {
  /** Global transition fallback — same field `exportPipeline.ts` passes as
   *  `options.globalTransition` and `resolveEffectiveTransition` already
   *  accepts; reused unmodified here so transition *selection* can never
   *  drift between the legacy Canvas2D path and this one. */
  globalTransition?: TransitionType;
  globalTransitionDuration: number;
  /**
   * Flat, project-level grade override. Phase 4 (plan Section 5.3) will
   * make this per-segment via new `VideoSegment` fields — deliberately not
   * read from segments in this phase since those fields don't exist yet
   * (types.ts is untouched by this phase). Until then this is a pure
   * passthrough: whatever is supplied here comes back unmodified in the
   * result's `grade` field, defaulting to NEUTRAL_GRADE.
   */
  grade?: GradeParams;
}

/** Rate-based zoom math shared today by canvasAnimations.ts's ZOOM_IN/
 *  ZOOM_OUT cases (`1.0 ± 0.05*t`) and PreviewStage.tsx's
 *  getAnimationWrapperProps — ported here unchanged, not re-derived, per
 *  plan Section 5.2. `timeInSegment` is clamped to [0, duration] as a
 *  general safety bound on the formula itself (mirrors
 *  useWebCodecsPreview.ts's computeAnimTimeInSegment precedent) — not
 *  reachable today via deriveCompositeParams's own call path below, since
 *  `findContainingSegment`'s half-open window already guarantees
 *  `timeInSegment` is in range whenever a containing segment is found at
 *  all, but this keeps the formula itself correct if a future caller
 *  (e.g. a Phase 3 "held segment" concept) ever invokes it directly with
 *  an out-of-range time. */
const ZOOM_RATE_PER_SECOND = 0.05;

function resolveAnimScale(slug: ZoomAnimationSlug | null, timeInSegment: number, duration: number): number {
  if (slug === null) return 1;
  const t = Math.max(0, Math.min(duration, timeInSegment));
  if (slug === 'zoom-in') return 1.0 + ZOOM_RATE_PER_SECOND * t;
  const endScale = 1.0 + ZOOM_RATE_PER_SECOND * duration;
  return endScale - ZOOM_RATE_PER_SECOND * t;
}

/** Slug-wins-else-legacy-enum resolution, matching resolveEffectiveTransition's
 *  own precedence contract for the transition fields (own `effectAnimation`
 *  slug first if set and not the none-sentinel, else the legacy `animation`
 *  enum) — restricted to the 2 slugs this engine implements; every other
 *  animation (the other 11 AnimationTypes) is out of scope and yields null,
 *  same as an out-of-scope transition. */
function resolveEffectiveAnimation(segment: VideoSegment): ZoomAnimationSlug | null {
  if (segment.effectAnimation && segment.effectAnimation !== ANIMATION_NONE) {
    return segment.effectAnimation === 'zoom-in' || segment.effectAnimation === 'zoom-out'
      ? segment.effectAnimation
      : null;
  }
  if (segment.animation === AnimationType.ZOOM_IN) return 'zoom-in';
  if (segment.animation === AnimationType.ZOOM_OUT) return 'zoom-out';
  return null;
}

/**
 * Finds the segment `currentTime` currently falls inside, and — mirroring
 * useTransitionPreview.ts's "candidate B" (active-blend) window exactly,
 * minus that hook's pre-roll/pool-prefetch bookkeeping, which is a preview-
 * buffering concern and not part of what this tick should render — resolves
 * whether that segment is inside its own leading transition window against
 * its immediate predecessor. Duration/type are resolved against the
 * OUTGOING (previous) segment's own field via resolveEffectiveTransition,
 * never against the containing segment itself, exactly matching
 * useTransitionPreview.ts's contract and export's semantics so the three
 * call sites can't drift on which segment's field is authoritative.
 */
const CONTIGUITY_EPSILON_S = 0.001;

function findContainingSegment(segments: readonly VideoSegment[], currentTime: number): VideoSegment | undefined {
  return segments.find((s) => currentTime >= s.startTime && currentTime < s.startTime + s.duration);
}

function findPrevSegment(
  segments: readonly VideoSegment[],
  segment: VideoSegment,
): VideoSegment | undefined {
  return segments.find(
    (s) => Math.abs(s.startTime + s.duration - segment.startTime) < CONTIGUITY_EPSILON_S && s.id !== segment.id,
  );
}

function resolveTransition(
  segments: readonly VideoSegment[],
  currentTime: number,
  containingSeg: VideoSegment | undefined,
  config: ProjectEffectConfig,
): TransitionParams | null {
  if (!containingSeg) return null;
  const prevSeg = findPrevSegment(segments, containingSeg);
  if (!prevSeg) return null;

  const resolved = resolveEffectiveTransition(prevSeg, config.globalTransition, config.globalTransitionDuration);
  if (resolved.transition === TransitionType.NONE || resolved.duration <= 0) return null;
  if (!GL_TRANSITION_SLUGS.has(resolved.transition)) return null;

  const inWindow = currentTime >= containingSeg.startTime && currentTime < containingSeg.startTime + resolved.duration;
  if (!inWindow) return null;

  const progress = Math.max(0, Math.min(1, (currentTime - containingSeg.startTime) / resolved.duration));
  return { type: resolved.transition as TransitionSlug, progress };
}

/**
 * The single most important function in this module (and this phase) —
 * see the file header. Pure: identical inputs always produce an identical
 * result, so a future export loop can call this per-frame from a sequential
 * decode loop and get byte-identical parameters to whatever preview showed
 * at the same `currentTime`, per Section 4's design constraint.
 */
export function deriveCompositeParams(
  segments: readonly VideoSegment[],
  currentTime: number,
  config: ProjectEffectConfig,
): CompositeParams {
  const containingSeg = findContainingSegment(segments, currentTime);
  const transition = resolveTransition(segments, currentTime, containingSeg, config);

  const animScale = containingSeg
    ? resolveAnimScale(
        resolveEffectiveAnimation(containingSeg),
        currentTime - containingSeg.startTime,
        containingSeg.duration,
      )
    : 1;

  return {
    transition,
    animScale,
    grade: config.grade ?? NEUTRAL_GRADE,
  };
}
