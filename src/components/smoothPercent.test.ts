import { describe, it, expect } from 'vitest';
import { stepSmoothPercent, MAX_LOOKAHEAD } from './smoothPercent';

/** Plays a burst-y report schedule through 250 ms animation steps. */
function play(reports: [number, number][], seconds: number, rate: number): number[] {
  let shown = 0;
  let target = 0;
  const out: number[] = [];
  for (let t = 0; t <= seconds; t += 0.25) {
    for (const [at, pct] of reports) if (Math.abs(at - t) < 1e-9) target = pct;
    shown = stepSmoothPercent(shown, target, rate, 0.25);
    out.push(shown);
  }
  return out;
}

describe('stepSmoothPercent', () => {
  // The engine reported 1, 5, 7, 10 … in bursts a few seconds apart.
  const bursts: [number, number][] = [[1, 1], [4, 5], [6, 7], [9, 10], [12, 13]];
  const shown = play(bursts, 14, 1);

  it('never goes backwards', () => {
    for (let i = 1; i < shown.length; i++) expect(shown[i]!).toBeGreaterThanOrEqual(shown[i - 1]!);
  });

  it('never races more than the look-ahead past what the engine confirmed', () => {
    let target = 0;
    shown.forEach((v, i) => {
      for (const [at, pct] of bursts) if (Math.abs(at - i * 0.25) < 1e-9) target = pct;
      expect(v).toBeLessThanOrEqual(target + MAX_LOOKAHEAD + 1e-9);
    });
  });

  it('shows whole numbers one after another — no staircase of 4-point leaps', () => {
    const whole = [...new Set(shown.map(Math.floor))];
    for (let i = 1; i < whole.length; i++) expect(whole[i]! - whole[i - 1]!).toBe(1);
  });

  it('only a real 100 shows 100', () => {
    expect(stepSmoothPercent(98.9, 99, 5, 10)).toBeLessThan(100);
    expect(stepSmoothPercent(99, 100, 5, 10)).toBe(100);
  });
});
