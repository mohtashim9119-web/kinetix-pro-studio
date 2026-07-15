/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure auto color-grade heuristic (WebGL2 effects engine, Phase 4, plan
 * Section 5.3). ONE-SHOT: given a single sampled frame's pixels it derives
 * ordinary SegmentGrade values (the same −1..1 manual-control set the grade
 * shader consumes) — it is NOT a per-tick pipeline stage. The caller
 * (PreviewStage's auto-grade sampler) writes the result through the normal
 * effectGrade apply path, after which the user can freely edit the sliders.
 *
 * Method: a p2–p98 luma-percentile stretch mapped onto the grade shader's
 * ACTUAL operation order — brightness is added BEFORE contrast (pivot 0.5) in
 * GRADE_FRAGMENT_SHADER_SOURCE — and onto the EFFECTIVE ranges the compositor
 * remaps each slider into before it reaches a uniform (compositeParams.ts's
 * brightnessOffsetUniform/contrastGainUniform/temperatureTintUniform; see the
 * block comment above them for why the raw −1..1 feed was unusable).
 *
 * That remap is the whole subtlety here. The values THIS function returns live
 * in the SLIDER domain (−1..1, 0=neutral), same as the manual controls — but
 * the pixel math it is solving happens in EFFECTIVE terms. So each channel is
 * solved for the effective quantity the shader actually applies, then converted
 * back to slider terms through the matching inverse. Concretely:
 *   out_luma = ((in_luma + B_eff) − 0.5) · gain + 0.5
 * (valid in luma space because brightness adds a constant to every channel —
 * hence to luma, since the Rec.709 weights sum to 1 — and the gain step is
 * affine about 0.5). Requiring in=p2 → out≈0 and in=p98 → out≈1 gives:
 *   gain       = 1 / (p98 − p2)          → contrast   = contrastFromGain(gain)
 *   B_eff      = 0.5 − (p2 + p98) / 2    → brightness = brightnessFromOffset(B_eff)
 * plus a gray-world temperature nudge solved against the shader's real channel
 * coefficient AND the temperature remap (see GRAY_WORLD_STRENGTH below).
 * Importing the constants/inverses rather than restating the numbers is what
 * keeps Auto and the manual sliders from drifting: retuning a range in
 * compositeParams.ts retunes Auto with it, automatically.
 *
 * Saturation is intentionally left at 0 (manual only, per the approved Phase 4
 * scope). All outputs clamped to [−1, 1] — note the tightened effective ranges
 * mean Auto now clamps on frames it could previously correct exactly; a clamped
 * result is a partial correction toward the target, never an overshoot. Flat /
 * near-black frames (negligible luma spread) return neutral.
 *
 * Kept mock-free and DOM-free (reads only ImageData's data/width/height) so it
 * is unit-testable the same way compositeParams.ts is.
 */
import type { SegmentGrade } from '../../types';
import {
  SHADER_TEMPERATURE_CHANNEL_SCALE,
  TEMPERATURE_MAX_STRENGTH,
  brightnessFromOffset,
  contrastFromGain,
} from './compositeParams';

const NEUTRAL: SegmentGrade = { brightness: 0, contrast: 0, saturation: 0, temperature: 0 };

// Rec.709 luma weights — the same coefficients the grade shader uses. They sum
// to 1, which is what makes the brightness-in-luma-space reasoning above hold.
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

// Minimum p2→p98 luma spread below which a frame is treated as flat / near-
// black / near-white and left neutral — avoids a div-by-~0 contrast blow-up.
const MIN_LUMA_RANGE = 0.02;

// Gray-world temperature, solved through the temperature remap. The shader
// shifts R by +u_temperature·SHADER_TEMPERATURE_CHANNEL_SCALE and B by the same
// amount downward, and u_temperature = t·TEMPERATURE_MAX_STRENGTH — so a slider
// value t moves the R−B gap by 2·0.1·0.4·t = 0.08·t. Equalizing the two channel
// means (Δ = meanB − meanR) therefore needs t = Δ / 0.08 = 12.5·Δ. We apply half
// of that: a nudge, not a hard white-balance.
//
// Derived from the constants rather than written as 6.25 so retuning
// TEMPERATURE_MAX_STRENGTH keeps Auto's nudge visually identical instead of
// silently rescaling it. (Pre-remap this was 2.5 — the same VISUAL nudge, just
// expressed in a slider domain that was 5× hotter per unit.)
const FULL_GRAY_WORLD_STRENGTH = 1 / (2 * SHADER_TEMPERATURE_CHANNEL_SCALE * TEMPERATURE_MAX_STRENGTH);
const GRAY_WORLD_STRENGTH = FULL_GRAY_WORLD_STRENGTH / 2;

// Values whose magnitude is below this are snapped to 0 so imperceptible noise
// doesn't leave a segment marked with a non-neutral grade.
const ZERO_SNAP = 0.01;

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));
const snapZero = (v: number): number => (Math.abs(v) < ZERO_SNAP ? 0 : v);
const finalize = (v: number): number => snapZero(clamp1(v));

/** Luma value (0..1) at cumulative fraction `p` of a 256-bin histogram. */
function percentile(hist: readonly number[], total: number, p: number): number {
  const target = total * p;
  let cum = 0;
  for (let bin = 0; bin < 256; bin++) {
    cum += hist[bin]!;
    if (cum >= target) return bin / 255;
  }
  return 1;
}

export function computeAutoGrade(imageData: ImageData): SegmentGrade {
  const { data, width, height } = imageData;
  const n = Math.floor(data.length / 4);
  if (n <= 0 || width * height <= 0) return { ...NEUTRAL };

  const hist = new Array<number>(256).fill(0);
  let sumR = 0;
  let sumB = 0;
  for (let i = 0; i < n * 4; i += 4) {
    const r = data[i]! / 255;
    const g = data[i + 1]! / 255;
    const b = data[i + 2]! / 255;
    sumR += r;
    sumB += b;
    const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    hist[Math.max(0, Math.min(255, Math.round(luma * 255)))]!++;
  }

  const meanR = sumR / n;
  const meanB = sumB / n;

  const p2 = percentile(hist, n, 0.02);
  const p98 = percentile(hist, n, 0.98);
  const range = p98 - p2;

  // Flat / near-black / near-white — nothing to stretch, and a gray frame's
  // meanR≈meanB gives ~0 temperature anyway. Stay fully neutral for predictability.
  if (range < MIN_LUMA_RANGE) return { ...NEUTRAL };

  // Each channel is solved for the EFFECTIVE quantity the shader applies, then
  // converted back to the slider domain through compositeParams.ts's matching
  // inverse — see the file header.
  const contrast = finalize(contrastFromGain(1 / range));
  const brightness = finalize(brightnessFromOffset(0.5 - (p2 + p98) / 2));
  const temperature = finalize(GRAY_WORLD_STRENGTH * (meanB - meanR));

  return { brightness, contrast, saturation: 0, temperature };
}
