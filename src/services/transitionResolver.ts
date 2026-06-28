import { VideoSegment, TransitionType } from '../types';

export interface EffectiveTransition {
  transition: TransitionType;
  duration: number;
}

/**
 * Resolves which transition (and duration) actually applies to `segment`:
 * the segment's own transition wins if set and non-NONE, else the global
 * fallback; duration is the segment's own transitionDuration if set, else
 * the global duration — forced to 0 whenever the effective transition is
 * NONE. Shared by segmentEncoder, exportPipeline, and useTransitionPreview
 * so the precedence logic can't drift between them (the Σ duration ===
 * voiceoverDuration invariant depends on all three agreeing).
 */
export function resolveEffectiveTransition(
  segment: VideoSegment | undefined,
  globalTransition: TransitionType | undefined,
  globalTransitionDuration: number,
): EffectiveTransition {
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
