/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canvas animation primitives for segment "Camera Dynamics" (AnimationType).
 * Applied to the background media layer in frameRenderer.ts via
 * applySegmentAnimation(). Each case manipulates the canvas transform
 * before the media is drawn, then the caller calls ctx.restore().
 *
 * All time arguments are in seconds.
 */

import { AnimationType } from '../types';

// ---------------------------------------------------------------------------
// Easing functions — t must be in [0, 1]
// ---------------------------------------------------------------------------

export const easeLinear = (t: number): number => t;

export const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);

export const easeInOutSine = (t: number): number =>
  -(Math.cos(Math.PI * t) - 1) / 2;

/**
 * Damped-sine approximation of a Framer Motion spring with bounce ~0.7.
 * Reaches 1 asymptotically; caller should clamp output for draw safety.
 */
export const springApprox = (t: number, bounce = 0.7): number =>
  1 - Math.exp(-3 * t) * Math.cos(8 * t * (1 - bounce));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a value oscillating between -amp and +amp with the given period
 * (in seconds) at elapsed time t.
 */
export const oscillate = (t: number, periodSec: number, amp: number): number =>
  amp * Math.sin((t / periodSec) * Math.PI * 2);

/**
 * Multi-keyframe interpolator matching Framer Motion array-value semantics.
 * keyframes are distributed evenly over [0, 1].
 */
export const interpKeyframes = (t: number, keyframes: readonly number[]): number => {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0]!;
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (keyframes.length - 1);
  const idx = Math.floor(scaled);
  const frac = scaled - idx;
  const a = keyframes[idx] ?? 0;
  const b = keyframes[Math.min(idx + 1, keyframes.length - 1)] ?? a;
  return a + (b - a) * frac;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AnimationFrameInput {
  animation: AnimationType;
  /** Elapsed seconds within this segment (0 … segmentDuration). */
  timeInSegment: number;
  /** Total segment duration in seconds. */
  segmentDuration: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface AnimationFrameResult {
  /**
   * When present, the caller must set ctx.globalAlpha = postDrawAlpha
   * BEFORE calling ctx.restore(), then restore globalAlpha to 1 after.
   * Used by NEON_FLICKER which needs the alpha applied to the drawn image.
   */
  postDrawAlpha?: number;
}

// Export-side animation renderer. The live-preview side lives in
// src/components/PreviewStage.tsx (getAnimationWrapperProps).
// Both must remain visually consistent — see comment
// there for full rationale.
/**
 * Applies a canvas transform representing the segment animation.
 * Call this AFTER ctx.save() and BEFORE drawing media.
 * After drawing, call ctx.restore().
 *
 * Returns AnimationFrameResult for any post-draw effects the caller
 * must apply.
 */
export function applySegmentAnimation(
  ctx: CanvasRenderingContext2D,
  input: AnimationFrameInput,
): AnimationFrameResult {
  const { animation, timeInSegment: t, segmentDuration: dur, canvasWidth: w, canvasHeight: h } = input;

  switch (animation) {
    // ── Identity / Ken Burns ───────────────────────────────────────────────
    case AnimationType.NONE:
      return {};

    case AnimationType.KEN_BURNS: {
      // Slow zoom: 1.0 → 1.1 over the full segment duration
      const progress = dur > 0 ? Math.min(t / dur, 1) : 0;
      const scale = 1.0 + 0.1 * progress;
      ctx.translate(w / 2, h / 2);
      ctx.scale(scale, scale);
      ctx.translate(-w / 2, -h / 2);
      return {};
    }

    // ── Translate Y family ─────────────────────────────────────────────────
    case AnimationType.FLOAT: {
      // 0 → -20px → 0 loop, 3s period
      const dy = oscillate(t, 3, 20);
      ctx.translate(0, dy);
      return {};
    }

    case AnimationType.BOUNCE: {
      // Entry spring: from -30px to 0 over first 0.6s, then hold
      const entryDur = 0.6;
      const progress = Math.min(t / entryDur, 1);
      const dy = -30 * (1 - Math.min(springApprox(progress * 5), 1));
      ctx.translate(0, dy);
      return {};
    }

    // ── Scale (uniform) family ─────────────────────────────────────────────
    case AnimationType.PULSE: {
      // 1.0 → 1.05 → 1.0 oscillating, 1s period
      const scale = 1 + 0.05 * easeInOutSine((t / 1) % 1);
      ctx.translate(w / 2, h / 2);
      ctx.scale(scale, scale);
      ctx.translate(-w / 2, -h / 2);
      return {};
    }

    case AnimationType.HEARTBEAT: {
      // Double-pulse pattern: [1, 1.2, 1, 1.1, 1], 1.2s period
      const scale = interpKeyframes((t / 1.2) % 1, [1, 1.2, 1, 1.1, 1]);
      ctx.translate(w / 2, h / 2);
      ctx.scale(scale, scale);
      ctx.translate(-w / 2, -h / 2);
      return {};
    }

    // ── Rotate family ──────────────────────────────────────────────────────
    case AnimationType.WOBBLE: {
      // ±5° oscillating, 1s period
      const angle = (5 * Math.PI / 180) * Math.sin((t / 1) * Math.PI * 2);
      ctx.translate(w / 2, h / 2);
      ctx.rotate(angle);
      ctx.translate(-w / 2, -h / 2);
      return {};
    }

    case AnimationType.ROTATE: {
      // Entry spin: -360° → 0° over first 1s (locked decision: entry spin)
      const entryDur = 1;
      const progress = Math.min(t / entryDur, 1);
      const angle = -2 * Math.PI * (1 - easeOutQuad(progress));
      ctx.translate(w / 2, h / 2);
      ctx.rotate(angle);
      ctx.translate(-w / 2, -h / 2);
      return {};
    }

    // ── Translate X family ─────────────────────────────────────────────────
    case AnimationType.SHAKE: {
      // Fast jitter: ±10px, 0.1s period
      const dx = oscillate(t, 0.1, 10);
      ctx.translate(dx, 0);
      return {};
    }

    // ── Skew family ────────────────────────────────────────────────────────
    case AnimationType.SKEW: {
      // Entry skew: 45° → 0° over first 0.3s
      const entryDur = 0.3;
      const progress = Math.min(t / entryDur, 1);
      const skewX = (45 * Math.PI / 180) * (1 - easeOutQuad(progress));
      // ctx.transform(a, b, c, d, e, f) — c = Math.tan(skewX) for X skew
      ctx.transform(1, 0, Math.tan(skewX), 1, 0, 0);
      return {};
    }

    // ── Complex family ─────────────────────────────────────────────────────
    case AnimationType.GLITCH: {
      // Every 100ms tick, random offset + occasional blur
      const tick = Math.floor(t * 10); // changes every 100ms
      // Use tick as a deterministic seed so the same frame always
      // produces the same jitter (reproducible across export frames).
      const dx = ((tick * 7919) % 11) - 5; // -5 to +5
      const dy = ((tick * 6271) % 5) - 2;  // -2 to +2
      ctx.translate(dx, dy);
      if (tick % 3 === 0) {
        ctx.filter = (ctx.filter === 'none' || ctx.filter === '')
          ? 'blur(2px)'
          : ctx.filter + ' blur(2px)';
      }
      return {};
    }

    // NEON_FLICKER: keyframe alpha pulse + cyan shadow glow pass.
    // If glow ever looks wrong (e.g. on dark backgrounds), reduce
    // shadowBlur or fall back to alpha-only.
    case AnimationType.NEON_FLICKER: {
      // Alpha flicker: [1, 0.3, 0.8, 0.2, 1, 0.4, 0.9], 1.5s period
      const alpha = interpKeyframes((t / 1.5) % 1, [1, 0.3, 0.8, 0.2, 1, 0.4, 0.9]);
      // Glow pass: cyan shadowBlur (locked decision 3 — drop if visually bad)
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#0ff';
      return { postDrawAlpha: alpha };
    }

    default:
      // Unrecognised value — identity (no transform)
      return {};
  }
}

// ---------------------------------------------------------------------------
// Dev-only guard: assert every ANIMATION_OPTIONS entry has a non-default case.
// Import ANIMATION_OPTIONS lazily to avoid circular dep with constants.ts.
// ---------------------------------------------------------------------------
if (import.meta.env.DEV) {
  // We check at module load time after a microtask to let constants.ts register first.
  void Promise.resolve().then(async () => {
    const { ANIMATION_OPTIONS } = await import('../constants');
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    for (const anim of ANIMATION_OPTIONS) {
      if (anim === AnimationType.NONE) continue;
      ctx.save();
      const result = applySegmentAnimation(ctx, {
        animation: anim,
        timeInSegment: 1,
        segmentDuration: 5,
        canvasWidth: 16,
        canvasHeight: 16,
      });
      ctx.restore();
      // If postDrawAlpha came back undefined AND the transform matrix is
      // identity, consider it a no-op (likely a missing case).
      const m = ctx.getTransform();
      const isIdentity = m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
      if (isIdentity && result.postDrawAlpha === undefined) {
        console.assert(
          false,
          `[canvasAnimations] ANIMATION_OPTIONS contains "${anim}" but applySegmentAnimation returns identity. Either implement it or remove it.`,
        );
      }
    }
  });
}
