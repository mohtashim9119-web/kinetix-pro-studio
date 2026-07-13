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
 * `deriveCompositeParams` deliberately does NOT decide which content
 * belongs in texture slot 'a' vs 'b' — it answers only "what should this
 * tick's render look like" (transition type/progress, zoom scale, grade).
 * The slot-assignment decision (which SEGMENT's decoded content feeds slot
 * 'a' vs 'b') is `deriveSlotPlan` below — added in Phase 3 (plan Section 6)
 * as the separate pure function that decision was always reserved for. Both
 * stay React/DOM/pool-free so either a playhead-driven preview loop
 * (useGlPreview.ts) or a future sequential export loop can reuse them
 * unmodified (Section 4's design constraint).
 */

import { AnimationType, TransitionType, type VideoSegment } from '../../types';
import { ANIMATION_NONE } from '../../effectsOptions';
import { resolveEffectiveTransition, resolveTransitionProgress } from '../transitionResolver';

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
  /**
   * Zoom scale for texture slot A — the OUTGOING segment during an active
   * transition, or the single containing segment when no transition is
   * active. 1.0 = no zoom. Already the final resolved scale factor (see
   * resolveAnimScale below); glCompositor.ts's per-slot prep pass consumes
   * this directly as `u_scale` for slot A, no further derivation at render
   * time.
   *
   * Split from the pre-Bug-2 single `animScale` field: one scalar applied to
   * the ALREADY-BLENDED A/B composite was discontinuous at transition
   * progress 0.5 (the containing segment flips there, so the one scale
   * snapped from the outgoing segment's accumulated zoom to the incoming
   * segment's fresh zoom mid-blend — a visible pop). Deriving a scale per
   * slot from each segment's OWN clock, applied BEFORE the blend, makes each
   * layer's zoom continuous across the boundary.
   */
  animScaleA: number;
  /**
   * Zoom scale for texture slot B — the INCOMING segment during an active
   * transition. 1.0 (unused) whenever no transition is active (slot B is not
   * drawn then). See animScaleA for the full rationale.
   */
  animScaleB: number;
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
 * Finds the segment `currentTime` currently falls inside via plain
 * [start, start+duration) bounds — used for animScale (zoom always follows
 * whichever segment's own clock currentTime is literally inside, independent
 * of transition state) and as the no-transition fallback for slot planning.
 * NOT used to decide transition activity any more — see resolveActiveBoundary
 * below for why a bounds-only "containing" segment can no longer stand in for
 * "the incoming side of an active transition" once the window is centered on
 * the boundary instead of anchored to it.
 */
const CONTIGUITY_EPSILON_S = 0.001;

function findContainingSegment(segments: readonly VideoSegment[], currentTime: number): VideoSegment | undefined {
  return segments.find((s) => currentTime >= s.startTime && currentTime < s.startTime + s.duration);
}

function findNextSegment(
  segments: readonly VideoSegment[],
  segment: VideoSegment,
): VideoSegment | undefined {
  return segments.find(
    (s) => Math.abs(segment.startTime + segment.duration - s.startTime) < CONTIGUITY_EPSILON_S && s.id !== segment.id,
  );
}

interface ActiveBoundary {
  outgoing: VideoSegment;
  incoming: VideoSegment;
  type: TransitionSlug;
  progress: number;
}

/**
 * Finds the single adjacent segment pair (if any) whose CENTERED transition
 * window currently contains `currentTime` — the shared boundary-resolution
 * source for BOTH deriveCompositeParams and deriveSlotPlan below, so the two
 * can never disagree about which two segments are involved in "this tick's"
 * transition (they call this with the same (segments, currentTime, config)
 * and get the same answer back, by construction, not by convention).
 *
 * Superseded design note: before centering, the window sat entirely inside
 * the INCOMING segment's own [start, start+duration) span, so "the segment
 * currentTime bounds-contains" and "the incoming side of the active
 * transition" were always the same segment — findContainingSegment + a
 * predecessor lookup was sufficient. Centering breaks that equivalence: for
 * the first half of the window, currentTime is still bounds-inside the
 * OUTGOING segment. This function iterates adjacent pairs directly instead
 * of relying on bounds-containment to identify which side of the boundary
 * currentTime happens to sit on.
 *
 * Duration/type are always resolved against the OUTGOING segment's own field
 * via resolveEffectiveTransition, exactly matching useTransitionPreview.ts's
 * and export's (segmentEncoder.ts/exportPipeline.ts) contract, so all three
 * call sites can't drift on which segment's field is authoritative.
 */
function resolveActiveBoundary(
  segments: readonly VideoSegment[],
  currentTime: number,
  config: ProjectEffectConfig,
): ActiveBoundary | null {
  for (const outgoing of segments) {
    const incoming = findNextSegment(segments, outgoing);
    if (!incoming) continue;

    const resolved = resolveEffectiveTransition(outgoing, config.globalTransition, config.globalTransitionDuration);
    if (resolved.transition === TransitionType.NONE || resolved.duration <= 0) continue;
    if (!GL_TRANSITION_SLUGS.has(resolved.transition)) continue;

    const progress = resolveTransitionProgress(incoming.startTime, resolved.duration, currentTime);
    if (progress === null) continue;

    return { outgoing, incoming, type: resolved.transition as TransitionSlug, progress };
  }
  return null;
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
  const boundary = resolveActiveBoundary(segments, currentTime, config);

  // Per-slot zoom: each scale is derived from its OWN segment's clock, so it
  // stays continuous across the transition boundary (resolveAnimScale clamps
  // timeInSegment to [0, duration], so the outgoing layer HOLDS at its
  // end-scale past the boundary and the incoming layer holds at its
  // start-scale before it — no mid-blend snap). See CompositeParams's
  // animScaleA/animScaleB docs for why the pre-Bug-2 single-scalar model
  // popped at progress 0.5.
  const scaleFor = (seg: VideoSegment): number =>
    resolveAnimScale(resolveEffectiveAnimation(seg), currentTime - seg.startTime, seg.duration);

  let animScaleA: number;
  let animScaleB: number;
  if (boundary) {
    // Slot A = outgoing, slot B = incoming (matching deriveSlotPlan's a/b
    // assignment) — each zoomed by its own segment before they are blended.
    animScaleA = scaleFor(boundary.outgoing);
    animScaleB = scaleFor(boundary.incoming);
  } else {
    // No transition: only slot A is drawn (the containing segment); slot B is
    // unused, so its scale is a neutral 1.
    animScaleA = containingSeg ? scaleFor(containingSeg) : 1;
    animScaleB = 1;
  }

  return {
    transition: boundary ? { type: boundary.type, progress: boundary.progress } : null,
    animScaleA,
    animScaleB,
    grade: config.grade ?? NEUTRAL_GRADE,
  };
}

/**
 * Which SEGMENT's content feeds each of the compositor's two texture slots
 * this tick (plan Section 3.2/6, Phase 3 — the slot-assignment decision
 * `deriveCompositeParams` deliberately left out, see the file header).
 *
 * The compositor's shaders read `u_texA` at progress 0 and `u_texB` at
 * progress 1; `TransitionParams.progress` is 0 = pure OUTGOING, 1 = pure
 * INCOMING. So during an active transition slot 'a' MUST be the outgoing
 * (previous) segment and slot 'b' the incoming (containing) one — do not be
 * misled by glCompositor.ts's prose "'a' = current segment", which only
 * describes the no-transition case (a single frame blitted from 'a').
 *
 *  - No transition: slot 'a' = the containing (current) segment, 'b' = null.
 *  - Active transition: slot 'a' = outgoing (previous) segment,
 *    slot 'b' = incoming (containing/current) segment.
 *  - currentTime outside every segment: both null (nothing to draw).
 *
 * Returns the SEGMENTS (not source times or textures): the source-time
 * mapping (`toSourceTime`) and the video-frame-vs-image texture sourcing are
 * the driver's concern (useGlPreview.ts), kept out of here so this stays a
 * pure segments+time+transition → assignment function, unit-testable with no
 * pool/asset/React dependency (same mock-free discipline as
 * deriveCompositeParams above).
 *
 * `transition` is passed in (rather than trusted implicitly) purely as an
 * ACTIVATION GATE — a non-null value says "yes, render a blend"; null says
 * "no, single-slot" — so the caller's own suppression decisions (an
 * isResizing-suppressed `null`, plan Section 6 / D12) collapse cleanly to
 * the no-transition assignment regardless of what the boundary math would
 * otherwise find. It does NOT carry which two segments are involved — under
 * the centered window (see resolveActiveBoundary above) that pairing can no
 * longer be recovered from `currentTime` + bounds-containment alone, so
 * `config` is required here too: this function re-derives the pairing via
 * the exact same resolveActiveBoundary deriveCompositeParams already called,
 * guaranteeing the two agree on which segments are outgoing/incoming (not
 * merely on whether a transition is active) whenever both are called with
 * the same (segments, currentTime, config).
 */
export interface SlotPlan {
  /** Outgoing (previous) segment during a transition; the current/containing
   *  segment when no transition is active; null when currentTime is outside
   *  every segment. */
  a: VideoSegment | null;
  /** Incoming (containing/current) segment during an active transition; null
   *  otherwise. */
  b: VideoSegment | null;
}

export function deriveSlotPlan(
  segments: readonly VideoSegment[],
  currentTime: number,
  transition: TransitionParams | null,
  config: ProjectEffectConfig,
): SlotPlan {
  const containing = findContainingSegment(segments, currentTime);
  if (!transition) return containing ? { a: containing, b: null } : { a: null, b: null };

  const boundary = resolveActiveBoundary(segments, currentTime, config);
  // A non-null `transition` from deriveCompositeParams at this SAME
  // (segments, currentTime, config) always finds a boundary here too — this
  // fallback is defensive only, mirroring the old findPrevSegment fallback's
  // own "never reached" caveat.
  if (!boundary) return containing ? { a: containing, b: null } : { a: null, b: null };
  return { a: boundary.outgoing, b: boundary.incoming };
}
