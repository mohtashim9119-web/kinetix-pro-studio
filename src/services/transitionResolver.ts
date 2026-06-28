import { VideoSegment, TransitionType } from '../types';
import { TRANSITION_NONE } from '../effectsOptions';

export interface EffectiveTransition {
  transition: TransitionType | string;
  duration: number;
}

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
 * Shared by segmentEncoder, exportPipeline, and useTransitionPreview so the
 * precedence logic can't drift between them (the Σ duration ===
 * voiceoverDuration invariant depends on all three agreeing).
 */
export function resolveEffectiveTransition(
  segment: VideoSegment | undefined,
  globalTransition: TransitionType | undefined,
  globalTransitionDuration: number,
): EffectiveTransition {
  if (segment?.effectTransition && segment.effectTransition !== TRANSITION_NONE) {
    return {
      transition: segment.effectTransition,
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
