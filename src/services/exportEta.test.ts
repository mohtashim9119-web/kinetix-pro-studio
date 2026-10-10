/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  displayTargetPct, muxTailMs, remainingMs, MUX_PCT, MUX_TAIL_MAX_MS, MUX_TAIL_MIN_MS, MUX_TAIL_CEILING_PCT,
} from './exportEta';
import { etaText } from '../components/BulkExportModal';

const S = 1000;

describe('muxTailMs — a bounded estimate', () => {
  it('is a fraction of how long encoding took, clamped both ways', () => {
    expect(muxTailMs(900 * S)).toBe(MUX_TAIL_MAX_MS);
    expect(muxTailMs(10 * S)).toBe(MUX_TAIL_MIN_MS);
    expect(muxTailMs(10_000 * S)).toBe(MUX_TAIL_MAX_MS);
    expect(muxTailMs(450 * S)).toBe(50 * S);
  });
});

describe('remainingMs — rolling, not frozen after 5%', () => {
  it('before 5% there is no number', () => {
    expect(remainingMs(0, undefined, 60 * S, { pct: 3 })).toBeNull();
  });

  it('the frozen estimate is unchanged when no live reading is given', () => {
    expect(remainingMs(0, 30 * S, 30 * S)).toBe(570 * S);   // 5% took 30 s -> 600 s in all
  });

  it('a run SLOWER than its first seconds stretches the estimate instead of sitting at "finishing…"', () => {
    // 5% took 30 s (frozen model: 600 s in all). It then crawls: only 25% after 300 s.
    const frozen = remainingMs(0, 30 * S, 300 * S);
    const rolling = remainingMs(0, 30 * S, 300 * S, { pct: 25 });
    expect(frozen).toBe(300 * S);
    expect(rolling!).toBeGreaterThan(frozen!);
    // 20 points in 270 s -> 13.5 s/pt; 65 pts left = 877 s of encode, plus a tail.
    expect(rolling!).toBeGreaterThan(877 * S);
  });

  it('a run FASTER than its first seconds shortens it', () => {
    const frozen = remainingMs(0, 30 * S, 120 * S)!;       // 480 s left by the frozen model
    const rolling = remainingMs(0, 30 * S, 120 * S, { pct: 60 })!;
    expect(rolling).toBeLessThan(frozen);
  });

  it('is recomputed on every reading: more progress -> a different answer', () => {
    const a = remainingMs(0, 30 * S, 100 * S, { pct: 20 })!;
    const b = remainingMs(0, 30 * S, 200 * S, { pct: 60 })!;
    expect(b).not.toBe(a);
    expect(b).toBeLessThan(a);
  });

  it('too little window since 5% falls back to the first estimate (no division noise)', () => {
    const v = remainingMs(0, 30 * S, 32 * S, { pct: 6 })!;
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });
});

describe('the mux tail 93 → 100 moves instead of stalling', () => {
  const startedAt = 0;
  const muxAt = 450 * S;   // encoding took 450 s -> a 50 s tail estimate
  const live = { pct: MUX_PCT, muxAt };

  it('the time left counts down through the tail, then reads "finishing…"', () => {
    expect(remainingMs(startedAt, 25 * S, muxAt, live)).toBe(50 * S);
    expect(remainingMs(startedAt, 25 * S, muxAt + 20 * S, live)).toBe(30 * S);
    expect(remainingMs(startedAt, 25 * S, muxAt + 60 * S, live)!).toBeLessThan(0);
    expect(etaText(startedAt, 25 * S, muxAt + 60 * S, live)).toBe('finishing…');
    expect(etaText(startedAt, 25 * S, muxAt + 20 * S, live)).toBe('~1 minute left');
  });

  it('the displayed target keeps advancing while the engine reports a flat 93', () => {
    const at = (dt: number): number => displayTargetPct(startedAt, muxAt + dt, live);
    const samples = [0, 5, 10, 20, 35, 50, 80].map(s => at(s * S));
    expect(samples[0]).toBe(MUX_PCT);
    for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeGreaterThan(samples[i - 1]! - 1e-9);
    expect(samples[1]!).toBeGreaterThan(MUX_PCT);          // moving within seconds of the mux start
    expect(samples[4]!).toBeGreaterThan(samples[2]!);      // still moving mid-tail
  });

  it('never reaches 99 or 100 on its own — only the real 100 does', () => {
    expect(displayTargetPct(startedAt, muxAt + 10_000 * S, live)).toBeLessThan(MUX_TAIL_CEILING_PCT);
    expect(displayTargetPct(startedAt, muxAt + 10 * S, { pct: 100, muxAt })).toBe(100);
  });

  it('before the mux the engine\'s own percent is the target', () => {
    expect(displayTargetPct(startedAt, 100 * S, { pct: 41 })).toBe(41);
  });
});

describe('a RESUMED run: the ETA counts only what is left, from where it started', () => {
  it('resumed at 40%: after 5 new points in 30 s the rest (60 points) is ~6 min — not the fresh run\'s 10', () => {
    // 5 points in 30 s -> 6 s per point -> 60 points left -> 360 s in all; 30 s gone.
    expect(remainingMs(0, 30 * S, 30 * S, { pct: 45, basePct: 40 })).toBe(330 * S);
    // The same readings without knowing it was a resume would badly overshoot.
    expect(remainingMs(0, 30 * S, 30 * S)).toBe(570 * S);
  });

  it('the already-encoded portion is not counted as speed (rolling estimate)', () => {
    // Resumed at 40: 10 new points in 60 s -> 6 s/pt; 45 points of encode left -> 270 s + a tail.
    const left = remainingMs(0, 30 * S, 60 * S, { pct: 50, basePct: 40 })!;
    expect(left).toBeGreaterThan(270 * S);
    expect(left).toBeLessThan(270 * S + MUX_TAIL_MAX_MS + 1);
    // Treating 0→50 as the run's speed would have promised far less.
    const naive = remainingMs(0, 30 * S, 60 * S, { pct: 50 })!;
    expect(left).toBeGreaterThan(naive);
  });
});
