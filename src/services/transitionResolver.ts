import { VideoSegment, TransitionType } from '../types';
import { TRANSITION_NONE } from '../effectsOptions';

export interface EffectiveTransition {
  transition: TransitionType | string;
  duration: number;
}

/**
 * Slugs retired at the WebGL2 Phase 5 cutover (docs/webgl-architecture-plan.md
 * Section 6), mapped to the surviving slug they now resolve to.
 *
 * These five were removed from `effectsOptions.ts`'s TRANSITIONS list because
 * the GL effects engine never implemented them — only the CSS/Canvas2D
 * snapshot path (useTransitionPreview.ts) Phase 5 deletes ever rendered them
 * in preview. A saved project can still carry one, so they are folded in HERE
 * rather than migrated in the persistence layer: this resolver is the single
 * function preview (compositeParams.ts) and export (segmentEncoder.ts /
 * exportPipeline.ts) both resolve through, so mapping at this one point keeps
 * the two in agreement BY CONSTRUCTION and covers every source of a stored
 * value at once — localStorage load, JSON import, and look presets — with no
 * migration pass to write, version, or forget to run.
 *
 * cross-dissolve is the target because all five were "a transition happens
 * here" effects; resolving them to hard-cut would silently drop the transition
 * the user deliberately placed. The look changes either way — that is
 * unavoidable once the effect no longer exists — but the transition itself,
 * and its duration, survive.
 */
const RETIRED_TRANSITIONS: ReadonlyMap<string, string> = new Map([
  ['wipe', 'cross-dissolve'],
  ['slide-push', 'cross-dissolve'],
  ['glitch-rgb', 'cross-dissolve'],
  ['whip-pan', 'cross-dissolve'],
  ['zoom', 'cross-dissolve'],
]);

/**
 * Resolves which transition (and duration) actually applies to `segment`.
 *
 * The slug field (`effectTransition`) is the source of truth when set and
 * not the hard-cut sentinel. Otherwise falls back to the legacy
 * `segment.transition` / global `TransitionType` precedence exactly as
 * before (own transition wins if set and non-NONE, else the global
 * fallback). Duration is the matching duration field if set, else the
 * global duration — forced to 0 whenever the effective transition is a
 * no-op (legacy NONE, or hard-cut routed through to the legacy branch).
 * Shared by segmentEncoder, exportPipeline, and the GL preview derivation
 * (compositeParams.ts) so the precedence logic can't drift between them (the Σ duration ===
 * voiceoverDuration invariant depends on all three agreeing).
 */
export function resolveEffectiveTransition(
  segment: VideoSegment | undefined,
  globalTransition: TransitionType | undefined,
  globalTransitionDuration: number,
): EffectiveTransition {
  if (segment?.effectTransition && segment.effectTransition !== TRANSITION_NONE) {
    return {
      // Retired slugs (see RETIRED_TRANSITIONS) fold into their surviving
      // equivalent here, so preview and export resolve a stored value the
      // same way. A live slug passes through untouched.
      transition: RETIRED_TRANSITIONS.get(segment.effectTransition) ?? segment.effectTransition,
      duration: segment.effectTransitionDuration ?? globalTransitionDuration,
    };
  }

  const transition =
    segment?.transition && segment.transition !== TransitionType.NONE
      ? segment.transition
      : (globalTransition ?? TransitionType.NONE);
  const duration =
    transition !== TransitionType.NONE
      ? (segment?.transitionDuration ?? globalTransitionDuration)
      : 0;
  return { transition, duration };
}

/**
 * Centered transition-window progress — the single shared arithmetic behind
 * the boundary-centered timing spec (docs/webgl-architecture-plan.md's
 * transition-centering entry; supersedes the old 100/0-split-at-the-boundary
 * behavior, D7 in project-state.md's Ignored Low Risk Bugs).
 *
 * A transition of `duration` seconds is centered ON `boundaryTime` — half
 * before it, half after: window = [boundaryTime - duration/2, boundaryTime +
 * duration/2). Progress runs 0 (window open, pure outgoing) to 1 (window
 * close approached, pure incoming), linear, landing at EXACTLY 0.5 when
 * `currentTime === boundaryTime`. Half-open on the high end, matching every
 * other segment-boundary convention in this codebase (findContainingSegment
 * et al.). Returns null when `currentTime` is outside the window, or when
 * `duration` is non-positive (division-by-zero guard, and a 0-length
 * transition never activates).
 *
 * Coordinate-system agnostic: `boundaryTime`/`currentTime` can be absolute
 * project time (compositeParams.ts) or a segment-
 * local time (segmentEncoder.ts, where `boundaryTime` is the outgoing
 * segment's own `duration`) — the arithmetic doesn't care which, as long as
 * both arguments share the same coordinate system.
 *
 * Shared by compositeParams.ts and segmentEncoder.ts so the window/progress
 * math can't drift between preview and export the way the pre-centering
 * anchored-at-B-start logic once did (it was hand-duplicated in all three
 * places, the third being the since-deleted useTransitionPreview.ts).
 */
export function resolveTransitionProgress(
  boundaryTime: number,
  duration: number,
  currentTime: number,
): number | null {
  if (duration <= 0) return null;
  const half = duration / 2;
  const start = boundaryTime - half;
  const end = boundaryTime + half;
  if (currentTime < start || currentTime >= end) return null;
  return Math.max(0, Math.min(1, (currentTime - start) / duration));
}
