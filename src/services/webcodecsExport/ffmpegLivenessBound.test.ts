/**
 * WS3 Defect 2 — liveness bounds for the opaque ffmpeg sidecar paths.
 *
 * These pin the bound MECHANISM (fires, kills, reports, resets on real
 * progress). They prove nothing about whether the chosen millisecond values
 * are right for a real machine — no export was run this round.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  withFfmpegLivenessBound,
  FfmpegBoundExpiredError,
  TIER_PIECE_BOUND_MS,
  REMUX_BOUND_MS,
  CONCAT_BOUND_MS,
  FRAME_COUNT_BOUND_MS,
  MUX_BOUND_MS,
  type FfmpegKillable,
} from './ffmpegLivenessBound';

function makeFfmpeg(kill = vi.fn(async () => undefined)): FfmpegKillable & { kill: typeof kill } {
  return { kill };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('withFfmpegLivenessBound', () => {
  it('passes a fast call straight through and arms no surviving timer', async () => {
    const ffmpeg = makeFfmpeg();
    const out = await withFfmpegLivenessBound(
      { label: 'X', boundMs: 1000, ffmpeg },
      async () => 42,
    );
    expect(out).toBe(42);
    expect(ffmpeg.kill).not.toHaveBeenCalled();
  });

  it('fires on an ffmpeg call that never settles, kills the sidecar, and carries the payload', async () => {
    vi.useFakeTimers();
    const ffmpeg = makeFfmpeg();
    const p = withFfmpegLivenessBound(
      { label: 'CONCAT_BOUND_MS', boundMs: 5_000, ffmpeg, files: ['video_all.h264'], pieceIndex: 3, pieceCount: 23 },
      // The exact shape being defended against: a bare invoke() that never
      // resolves and never rejects.
      () => new Promise<void>(() => undefined),
    );
    const settled = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_100);
    const err = await settled;
    expect(err).toBeInstanceOf(FfmpegBoundExpiredError);
    if (!(err instanceof FfmpegBoundExpiredError)) return;
    expect(ffmpeg.kill).toHaveBeenCalledTimes(1);
    expect(err.diagnostics.killed).toBe(true);
    expect(err.diagnostics.killError).toBeNull();
    expect(err.diagnostics.label).toBe('CONCAT_BOUND_MS');
    expect(err.diagnostics.boundMs).toBe(5_000);
    expect(err.diagnostics.files).toEqual(['video_all.h264']);
    expect(err.diagnostics.pieceIndex).toBe(3);
    expect(err.diagnostics.pieceCount).toBe(23);
    expect(err.message).toContain('ffmpeg liveness bound');
  });

  it('records a kill that itself failed rather than masking it', async () => {
    vi.useFakeTimers();
    const ffmpeg = makeFfmpeg(vi.fn(async () => {
      throw new Error('session already gone');
    }));
    const p = withFfmpegLivenessBound(
      { label: 'MUX_BOUND_MS', boundMs: 1_000, ffmpeg },
      () => new Promise<void>(() => undefined),
    );
    const settled = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_100);
    const err = await settled;
    expect(err).toBeInstanceOf(FfmpegBoundExpiredError);
    if (!(err instanceof FfmpegBoundExpiredError)) return;
    expect(err.diagnostics.killed).toBe(false);
    expect(err.diagnostics.killError).toBe('session already gone');
  });

  it('a resettable bound survives a slow-but-moving step (class (i), the canvas path)', async () => {
    vi.useFakeTimers();
    const ffmpeg = makeFfmpeg();
    const p = withFfmpegLivenessBound(
      { label: 'TIER_PIECE_BOUND_MS(canvas)', boundMs: 1_000, ffmpeg },
      async (handle) => {
        // 10 "frames", each taking 90% of the bound — total 9x the bound.
        for (let i = 0; i < 10; i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 900));
          handle.touch();
        }
        return 'done';
      },
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBe('done');
    expect(ffmpeg.kill).not.toHaveBeenCalled();
  });

  it('a resettable bound STILL fires once progress actually stops (destructive probe)', async () => {
    vi.useFakeTimers();
    const ffmpeg = makeFfmpeg();
    const p = withFfmpegLivenessBound(
      { label: 'TIER_PIECE_BOUND_MS(canvas)', boundMs: 1_000, ffmpeg },
      async (handle) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        handle.touch();
        await new Promise<void>(() => undefined); // then hangs forever
      },
    );
    const settled = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3_000);
    const err = await settled;
    expect(err).toBeInstanceOf(FfmpegBoundExpiredError);
    if (!(err instanceof FfmpegBoundExpiredError)) return;
    expect(err.diagnostics.progressTicks).toBe(1);
    expect(err.diagnostics.msSinceLastProgress).toBeGreaterThanOrEqual(1_000);
  });

  it('does not fire after the step already failed', async () => {
    vi.useFakeTimers();
    const ffmpeg = makeFfmpeg();
    const p = withFfmpegLivenessBound({ label: 'X', boundMs: 1_000, ffmpeg }, async () => {
      throw new Error('ffmpeg exited 1');
    });
    await expect(p).rejects.toThrow('ffmpeg exited 1');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ffmpeg.kill).not.toHaveBeenCalled();
  });

  it('native opaque steps call ffmpeg.kill() on expiry (sets Rust cooperative cancel flag)', async () => {
    vi.useFakeTimers();
    const killOrder: string[] = [];
    const ffmpeg = makeFfmpeg(vi.fn(async () => {
      killOrder.push('kill');
    }));
    const p = withFfmpegLivenessBound(
      { label: 'FRAME_COUNT_BOUND_MS', boundMs: 2_000, ffmpeg, files: ['video_all.h264'] },
      () => new Promise<void>(() => undefined),
    );
    const settled = p.catch((e: unknown) => {
      killOrder.push('reject');
      return e;
    });
    await vi.advanceTimersByTimeAsync(2_100);
    const err = await settled;
    expect(err).toBeInstanceOf(FfmpegBoundExpiredError);
    expect(killOrder).toEqual(['kill', 'reject']);
  });

  it('every bound is distinct from WATCHDOG_MS and ordered by the size of the job it covers', () => {
    // Subprocess bounds must stay above the frozen 30 s worker watchdog, except
    // REMUX which measured to 30 s itself (same number, different subsystem).
    for (const ms of [TIER_PIECE_BOUND_MS, CONCAT_BOUND_MS, FRAME_COUNT_BOUND_MS, MUX_BOUND_MS]) {
      expect(ms).not.toBe(30_000);
      expect(ms).toBeGreaterThan(30_000);
    }
    expect(REMUX_BOUND_MS).toBe(30_000);
    expect(REMUX_BOUND_MS).toBeLessThan(CONCAT_BOUND_MS);
    expect(CONCAT_BOUND_MS).toBeLessThan(MUX_BOUND_MS);
    expect(MUX_BOUND_MS).toBeLessThan(FRAME_COUNT_BOUND_MS);
  });
});
