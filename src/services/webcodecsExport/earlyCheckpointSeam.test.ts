/**
 * Bound the checkpoint blind spot: a stall inside a piece's first 300 frames
 * used to lose everything (the first durable checkpoint is the first rotation
 * seam). One early seam inside the first session bounds that loss. This does
 * NOT fix any stall — it limits what a stall costs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHECKPOINT_SESSION_FRAMES,
  EARLY_CHECKPOINT_FRAMES,
  planEncoderSessions,
  planCheckpointSessions,
  encoderSessionLengths,
} from './encoderSessionPlan';

const WORKER_SRC = readFileSync(resolve(__dirname, 'exportWorker.ts'), 'utf8');
const PIPELINE_SRC = readFileSync(resolve(__dirname, 'exportPipelineWebCodecs.ts'), 'utf8');

const gopKey = (fps: number) => {
  const gop = Math.max(1, Math.round(2 * fps));
  return (i: number) => i % gop === 0;
};

/** Latest checkpoint seam at or before `frame` (0 = nothing durable yet). */
function lastSeamAtOrBefore(starts: readonly number[], frame: number): number {
  let s = 0;
  for (const x of starts) if (x <= frame) s = x;
  return s;
}

describe('early first seam — the value', () => {
  it('is 150 frames: ~half the 300-frame session, so neither half of the first session exceeds ~6 s at 24 fps', () => {
    expect(EARLY_CHECKPOINT_FRAMES).toBe(150);
    expect(CHECKPOINT_SESSION_FRAMES).toBe(300);
  });
});

describe('early first seam — a stall in the first window leaves a resumable checkpoint', () => {
  it('field shape (2419 frames, 24 fps, stall at frame 272): the old plan had nothing durable; the new plan has a seam at 144', () => {
    const isKey = gopKey(24);
    const old = planEncoderSessions(2419, isKey, CHECKPOINT_SESSION_FRAMES);
    const next = planCheckpointSessions(2419, isKey);
    expect(lastSeamAtOrBefore(old, 272)).toBe(0);
    expect(lastSeamAtOrBefore(next, 272)).toBe(144);
    expect(isKey(144)).toBe(true);
  });

  it('bounds the first-session loss: no session in the first window is longer than the early cap at 24/30/60 fps', () => {
    for (const fps of [24, 30, 60]) {
      const starts = planCheckpointSessions(5000, gopKey(fps));
      const lengths = encoderSessionLengths(starts, 5000);
      expect(lengths[0]!).toBeLessThanOrEqual(EARLY_CHECKPOINT_FRAMES);
      expect(starts[1]!).toBeGreaterThan(0);
    }
  });
});

describe('early first seam — a healthy plan changes only by the added seam', () => {
  it('every old seam survives, in order, and exactly one keyframe seam is inserted before the first old one', () => {
    for (const fps of [24, 25, 30, 50, 60]) {
      const isKey = gopKey(fps);
      for (const total of [400, 2419, 9000, 38061]) {
        const old = planEncoderSessions(total, isKey, CHECKPOINT_SESSION_FRAMES);
        const next = planCheckpointSessions(total, isKey);
        expect(next).toHaveLength(old.length + 1);
        expect(next.filter((s) => s !== next[1])).toEqual(old);
        expect(next[1]!).toBeGreaterThan(0);
        expect(next[1]!).toBeLessThan(old[1] ?? total);
        expect(isKey(next[1]!)).toBe(true);
      }
    }
  });

  it('adds nothing when the piece is too short to hold a keyframe inside the early window', () => {
    const isKey = gopKey(24); // first non-zero keyframe at 48
    expect(planCheckpointSessions(40, isKey)).toEqual(planEncoderSessions(40, isKey, CHECKPOINT_SESSION_FRAMES));
    expect(planCheckpointSessions(1, isKey)).toEqual([0]);
  });

  it('honours a segment-start keyframe off the GOP grid (cuts only where isKeyFrame is already true)', () => {
    const isKey = (i: number) => i === 0 || i === 37 || i % 48 === 0;
    const starts = planCheckpointSessions(2000, isKey);
    expect(starts[1]).toBe(144);
    for (const s of starts) expect(isKey(s)).toBe(true);
  });
});

describe('early first seam — resume across the change', () => {
  it('a checkpoint seam from the OLD plan is still a planned session start (the worker will accept it)', () => {
    const isKey = gopKey(24);
    const old = planEncoderSessions(2419, isKey, CHECKPOINT_SESSION_FRAMES);
    const next = planCheckpointSessions(2419, isKey);
    for (const seam of old) expect(next).toContain(seam);
    // ...but at a session index one higher than the old plan numbered it.
    expect(next.indexOf(old[1]!)).toBe(1 + 1);
  });

  it('the worker plans with the early seam and tells the orchestrator which session the run starts in', () => {
    expect(WORKER_SRC).toMatch(/planCheckpointSessions\(totalFrames, isKeyFrame\)/);
    expect(WORKER_SRC).toMatch(/startSessionIndex: initialSessionIndex/);
    expect(PIPELINE_SRC).toContain('data.startSessionIndex');
  });
});
