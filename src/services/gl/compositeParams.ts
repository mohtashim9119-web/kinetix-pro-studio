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

/**
 * ---------------------------------------------------------------------------
 * Grade slider → shader-uniform remaps (grade range audit).
 * ---------------------------------------------------------------------------
 *
 * `GradeParams`' four channels are the SLIDER domain: −1..1, 0 = neutral. That
 * domain is what segments persist (`effectGrade`), what the EffectsPanel shows,
 * and what autoGrade.ts produces. It is NOT what the grade shader's uniforms
 * want. shaders.ts's GRADE_FRAGMENT_SHADER_SOURCE (deliberately untouched by
 * this work — see below) computes, per pixel:
 *
 *   c += u_brightness;                            // additive
 *   c  = (c − 0.5) * (1.0 + u_contrast) + 0.5;    // LINEAR gain about 0.5
 *   c  = mix(vec3(luma), c, 1.0 + u_saturation);  // LINEAR mix factor
 *   c.r += u_temperature * 0.1;  c.b -= u_temperature * 0.1;
 *
 * Feeding the raw slider value straight into those uniforms made the practical
 * range unusable, in two distinct ways:
 *
 *   1. A DEAD state. contrast = −1 makes the gain `(1 + −1) = 0`: every pixel
 *      collapses to flat mid-gray REGARDLESS OF CONTENT (and brightness is
 *      erased with it, since it is added before this pivot), which temperature
 *      then tints uniformly — the original "solid brown at extreme values"
 *      finding. Fix A replaced the 1:1 feed with an exponential gain
 *      (`2^contrast`), which removed the dead state but left the span wide.
 *   2. Unusable EXTREMES across the whole set. ±1 additive brightness is 100%
 *      of the channel range — +0.57 already blows toward white — and any two
 *      sliders near their ends drove the frame to solid white/black. The
 *      sliders were nominally −1..1 but only the middle ~quarter was useful.
 *
 * These functions are the CPU-side remap glCompositor.ts's drawGrade applies
 * once, at the render boundary, right before each `gl.uniform1f(…)`. Each maps
 * the full −1..1 slider sweep onto a gentler EFFECTIVE range, so every slider
 * position is a usable position. Nothing else moves: `GradeParams`, persistence,
 * the slider UI's own −1..1 bounds, and autoGrade.ts's output domain all stay
 * exactly as they were. Doing it here rather than in the shader keeps the
 * remap unit-testable on the CPU (see compositeParams.test.ts) and keeps the
 * shader a plain, color-space-agnostic transform per Section 4.
 *
 * autoGrade.ts imports the constants and inverses below rather than restating
 * the numbers, so Auto-adjust always solves in the SAME effective ranges a
 * user gets by hand-setting the sliders — the two cannot drift.
 */

/** Effective brightness at slider ±1, additive in normalized RGB. ±0.25 of the
 *  0..1 channel range is a firm push that still leaves headroom at both ends;
 *  the old 1:1 feed spent the whole channel range by ±0.57. */
export const BRIGHTNESS_MAX_OFFSET = 0.25;

/** Effective contrast GAIN at slider +1, and (as 1/CONTRAST_GAIN_MAX ≈ 0.625)
 *  at slider −1 — the exponential `gain = CONTRAST_GAIN_MAX^contrast` is
 *  symmetric in log space, so one constant fixes both ends. Tightens Fix A's
 *  2^contrast curve (0.5×–2×) to a practical 0.625×–1.6× span. */
export const CONTRAST_GAIN_MAX = 1.6;

/** Effective saturation mix-factor deviation at slider ±1 → factor 0.4×–1.6×.
 *  Note −1 is a strong desaturation, not full grayscale; full grayscale is a
 *  LOOK, not a range endpoint, and the −1..1 sweep is spent on gradations that
 *  are all usable. */
export const SATURATION_MAX_SCALE = 0.6;

/** Effective temperature strength at slider ±1. The shader shifts R/B by
 *  ±u_temperature * SHADER_TEMPERATURE_CHANNEL_SCALE, so ±1 on the slider is a
 *  ±0.04 channel shift — a tint, not a channel-clipping cast. */
export const TEMPERATURE_MAX_STRENGTH = 0.4;

/** The shader's own per-channel temperature coefficient (`c.r += u_temperature
 *  * 0.1`). Mirrored here ONLY so autoGrade.ts can solve its gray-world
 *  correction against the real pipeline instead of a hard-coded magic number. */
export const SHADER_TEMPERATURE_CHANNEL_SCALE = 0.1;

/** Slider −1..1 → the shader's additive `u_brightness`. */
export function brightnessOffsetUniform(brightness: number): number {
  return brightness * BRIGHTNESS_MAX_OFFSET;
}

/** Inverse of brightnessOffsetUniform: a desired additive offset → the slider
 *  value producing it. Un-clamped — callers clamp into −1..1 themselves. */
export function brightnessFromOffset(offset: number): number {
  return offset / BRIGHTNESS_MAX_OFFSET;
}

/** Slider −1..1 → the shader's `u_contrast`, solved so the shader's LINEAR
 *  `(1 + u_contrast)` gain equals the exponential `CONTRAST_GAIN_MAX^contrast`:
 *  `1 + u_contrast = G^c  =>  u_contrast = G^c − 1`. Exactly neutral at 0
 *  (G^0 = 1 => 0), and the gain is strictly positive for every finite input —
 *  the flat-gray state is unreachable by construction. */
export function contrastGainUniform(contrast: number): number {
  return Math.pow(CONTRAST_GAIN_MAX, contrast) - 1;
}

/** Inverse of contrastGainUniform, in GAIN terms: a desired gain → the slider
 *  value producing it (`log_G(gain)`). Un-clamped — callers clamp themselves. */
export function contrastFromGain(gain: number): number {
  return Math.log(gain) / Math.log(CONTRAST_GAIN_MAX);
}

/** Slider −1..1 → the shader's `u_saturation` (its mix factor is
 *  `1 + u_saturation`). */
export function saturationMixUniform(saturation: number): number {
  return saturation * SATURATION_MAX_SCALE;
}

/** Slider −1..1 → the shader's `u_temperature`. */
export function temperatureTintUniform(temperature: number): number {
  return temperature * TEMPERATURE_MAX_STRENGTH;
}

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
   * Flat, project-level grade FALLBACK. Phase 4 (plan Section 5.3) made grade
   * per-segment via `VideoSegment.effectGrade`, which `deriveCompositeParams`
   * now reads from the containing segment as the primary source. This field is
   * only consulted when the containing segment carries no `effectGrade` of its
   * own (and defaults to NEUTRAL_GRADE if unset here too) — it preserves a
   * project-wide grade override without competing with an explicit per-segment
   * value.
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

  // Grade is a single post-blend operation (the grade shader samples the
  // already-composited render target once), so it must resolve to ONE value
  // per tick — it can't be per-slot the way animScaleA/B are. It follows the
  // CONTAINING segment (the one currentTime is literally inside): during a
  // centered transition window the playhead is inside the outgoing segment for
  // the first half and the incoming for the second, so the grade snaps at the
  // boundary midpoint. That midpoint-snap is the accepted Phase 4 limitation
  // (no grade cross-fade). config.grade remains a project-level fallback for a
  // segment that carries no effectGrade of its own.
  const grade: GradeParams = containingSeg?.effectGrade ?? config.grade ?? NEUTRAL_GRADE;

  return {
    transition: boundary ? { type: boundary.type, progress: boundary.progress } : null,
    animScaleA,
    animScaleB,
    grade,
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
