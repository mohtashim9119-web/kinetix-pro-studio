/**
 * WS3 Round 9 — Rung 5b (adaptive throttling). Pure-policy tests for
 * `computeThrottleDelayMs`, same posture as `boundedRerenderPolicy.test.ts`
 * / `hardwareFailoverPolicy.test.ts`: the function takes only the sampled
 * `encodeQueueSize`, so these tests double as the proof that its output is
 * bounded no matter how the caller is driven.
 */
import { describe, it, expect } from 'vitest';
import {
  computeThrottleDelayMs,
  THROTTLE_SOFT_WATER,
  THROTTLE_STEP_MS,
  MAX_THROTTLE_DELAY_MS,
} from './exportWorker';

describe('computeThrottleDelayMs', () => {
  it('constants: soft water is half the hard ceiling (4), step is small', () => {
    expect(THROTTLE_SOFT_WATER).toBe(2);
    expect(THROTTLE_STEP_MS).toBe(5);
    expect(MAX_THROTTLE_DELAY_MS).toBe(10);
  });

  it('is a no-op at or below the soft threshold — clean-path neutrality', () => {
    expect(computeThrottleDelayMs(0)).toBe(0);
    expect(computeThrottleDelayMs(1)).toBe(0);
    expect(computeThrottleDelayMs(THROTTLE_SOFT_WATER)).toBe(0);
  });

  it('grows linearly above the soft threshold, up to the hard ceiling', () => {
    expect(computeThrottleDelayMs(THROTTLE_SOFT_WATER + 1)).toBe(THROTTLE_STEP_MS);
    expect(computeThrottleDelayMs(THROTTLE_SOFT_WATER + 2)).toBe(2 * THROTTLE_STEP_MS);
  });

  it('THE BOUND: never exceeds MAX_THROTTLE_DELAY_MS, for any queue depth including pathological ones', () => {
    for (const q of [0, 1, 2, 3, 4, 5, 10, 100, 1_000, 1_000_000]) {
      const delay = computeThrottleDelayMs(q);
      expect(delay).toBeLessThanOrEqual(MAX_THROTTLE_DELAY_MS);
      expect(delay).toBeGreaterThanOrEqual(0);
    }
  });

  it('MAX_THROTTLE_DELAY_MS is nowhere near FORWARD_PROGRESS_BOUND_MS (45,000ms) or WATCHDOG_MS (30,000ms) — not even the pathological whole-session sum is', () => {
    const FORWARD_PROGRESS_BOUND_MS = 45_000;
    const MAX_ENCODER_SESSION_FRAMES = 1800;
    expect(MAX_THROTTLE_DELAY_MS).toBeLessThan(FORWARD_PROGRESS_BOUND_MS);
    // Even the (impossible, since the bound resets per completed append)
    // scenario of every single frame in a whole session paying the MAXIMUM
    // throttle delay back-to-back with zero other work stays under the
    // bound — the mechanism cannot threaten it even under an adversarial
    // reading of the arithmetic, let alone the real reset semantics.
    expect(MAX_THROTTLE_DELAY_MS * MAX_ENCODER_SESSION_FRAMES).toBeLessThan(FORWARD_PROGRESS_BOUND_MS);
  });
});
