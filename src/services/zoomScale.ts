/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single source of truth for Zoom In / Zoom Out scale math, shared by the
 * WebGL2 preview compositor (services/gl/compositeParams.ts `resolveAnimScale`)
 * and the export canvas renderer (services/canvasAnimations.ts ZOOM_IN /
 * ZOOM_OUT). Both import `computeZoomScale` — the old duplicated `1.0 ± 0.05*t`
 * literal that each engine carried independently was deleted in favour of this
 * module so preview and export can never drift.
 *
 * Model (rate-based, duration-scaled):
 *   Peak Scale = min(MAX_PEAK_SCALE, 1 + rate * duration)
 *   Zoom In  : 1.0        → Peak Scale  linearly over `duration`
 *   Zoom Out : Peak Scale → 1.0         linearly over `duration`
 *
 * `rate` is a per-second zoom rate (scale units / second). The UI slider ranges
 * MIN_ZOOM_SCALE_RATE..computeMaxRate(duration); computeMaxRate keeps the
 * uncapped peak ≤ MAX_PEAK_SCALE for every slider-reachable rate, so the
 * MAX_PEAK_SCALE clamp inside computeZoomScale is a safety net for out-of-range
 * values (legacy / hand-authored), not a path the UI normally reaches.
 *
 * NB: Ken Burns (canvasAnimations.ts / PreviewStage.tsx) is intentionally NOT
 * routed through here — it keeps its own 0.05/sec literal. This module owns the
 * two user-facing zoom animations only.
 */

export type ZoomDirection = 'in' | 'out';

/** Per-second zoom rate written to new segments' `effectAnimationScaleRate`,
 *  and the render-time default for any segment that carries none (including
 *  legacy segments persisted before this field existed). */
export const DEFAULT_ZOOM_SCALE_RATE = 0.010;

/** UI slider lower bound — fixed. */
export const MIN_ZOOM_SCALE_RATE = 0.010;

/** UI slider global upper bound. The effective per-segment max is the smaller
 *  of this and computeMaxRate(duration). */
export const MAX_ZOOM_SCALE_RATE = 0.100;

/** Hard ceiling on peak scale — a frame is never zoomed past this. */
export const MAX_PEAK_SCALE = 1.99;

export interface ZoomScaleInput {
  /** Per-second zoom rate (scale units / second). */
  rate: number;
  /** Segment duration in seconds. */
  duration: number;
  /** Elapsed seconds within the segment; clamped to [0, duration]. */
  elapsed: number;
  direction: ZoomDirection;
}

/** Peak scale a segment reaches given its rate and duration, clamped to
 *  MAX_PEAK_SCALE. Returns 1 (no zoom) for a non-positive duration. */
export function computePeakScale(rate: number, duration: number): number {
  if (!(duration > 0)) return 1;
  return Math.min(MAX_PEAK_SCALE, 1 + rate * duration);
}

/** The zoom scale factor at `elapsed` seconds. 1.0 = no zoom. */
export function computeZoomScale({ rate, duration, elapsed, direction }: ZoomScaleInput): number {
  if (!(duration > 0)) return 1;
  const peak = computePeakScale(rate, duration);
  const t = Math.max(0, Math.min(duration, elapsed));
  const frac = t / duration; // 0 .. 1
  return direction === 'in'
    ? 1 + (peak - 1) * frac
    : peak - (peak - 1) * frac;
}

/** Largest rate whose uncapped peak stays ≤ MAX_PEAK_SCALE for `duration`:
 *  min(MAX_ZOOM_SCALE_RATE, (MAX_PEAK_SCALE - 1) / duration). Used both as the
 *  UI slider's per-segment max bound and as the apply-to-all per-segment cap.
 *  A non-positive/absent duration is treated as unbounded → MAX_ZOOM_SCALE_RATE. */
export function computeMaxRate(duration: number): number {
  if (!(duration > 0)) return MAX_ZOOM_SCALE_RATE;
  return Math.min(MAX_ZOOM_SCALE_RATE, (MAX_PEAK_SCALE - 1) / duration);
}

/** UI-only slider max bound: computeMaxRate floored at MIN_ZOOM_SCALE_RATE so
 *  the rate input never renders with max < min for a very long segment (where
 *  computeMaxRate can fall below the fixed min). Purely cosmetic — the applied
 *  rate is still capped by capRateForDuration (raw computeMaxRate), so a long
 *  segment's written rate can legitimately sit below this floor. */
export function sliderMaxRate(duration: number): number {
  return Math.max(MIN_ZOOM_SCALE_RATE, computeMaxRate(duration));
}

/** Per-segment cap applied when a chosen rate is pushed onto segments of
 *  differing lengths (apply-to-all): never let a chosen rate drive a segment's
 *  peak past MAX_PEAK_SCALE. */
export function capRateForDuration(chosenRate: number, duration: number): number {
  return Math.min(chosenRate, computeMaxRate(duration));
}

/** Decide how the ANIMATIONS rate input should sync when the active segment
 *  changes. Returns `changed: true` (with the value to display) ONLY when the
 *  active SEGMENT id has actually changed since the last sync — so a sync never
 *  fires while the user is typing on the SAME segment, which is what keeps live
 *  edits from being clobbered (same guard shape as GradeSection's Bug B fix,
 *  keyed on segment identity rather than value). `value` is the segment's
 *  stored rate formatted to 3dp, or the default when the segment has none. */
export function resolveRateInputSync(
  lastSyncedId: string | undefined,
  activeId: string | undefined,
  activeStoredRate: number | undefined,
): { changed: boolean; value: string } {
  if (activeId === lastSyncedId) return { changed: false, value: '' };
  return { changed: true, value: (activeStoredRate ?? DEFAULT_ZOOM_SCALE_RATE).toFixed(3) };
}

/** True when `rate` sits at (or above) the duration-imposed cap AND that cap is
 *  below the global max the user could otherwise pick — i.e. this segment's
 *  rate is limited by its length rather than by the user's choice. Drives the
 *  BottomDrawer "capped" indicator. (A user who deliberately dials a long
 *  segment to its own max will also read as capped — that is accurate: the
 *  segment is at the fastest zoom its length allows.) */
export function isRateCapped(rate: number, duration: number): boolean {
  const max = computeMaxRate(duration);
  return max < MAX_ZOOM_SCALE_RATE && rate >= max - 1e-9;
}
