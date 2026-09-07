import { describe, it, expect } from 'vitest';
import { AnimationType, TransitionType, type VideoSegment } from '../../types';
import { deriveCompositeParams, deriveSlotPlan, type ProjectEffectConfig } from '../gl/compositeParams';
import {
  DecodeCursorRegistry,
  MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS,
  cursorLastNeededSec,
  shouldReleaseDecodeCursor,
  assetLastNeededSecByAsset,
} from './decodeCursorLifetime';
import { probeFrameLoopCursorPeak } from './exportWorker';

function makeSegment(overrides: Partial<VideoSegment> & { id: string; startTime: number }): VideoSegment {
  return {
    text: '',
    assetId: 'asset-1',
    duration: 1,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    ...overrides,
  };
}

function chain(count: number, duration: number, outgoing?: { effectTransition: string; effectTransitionDuration: number }): VideoSegment[] {
  return Array.from({ length: count }, (_, i) =>
    makeSegment({
      id: `s${i}`,
      startTime: i * duration,
      duration,
      order: i,
      ...(outgoing && i < count - 1 ? outgoing : {}),
    }),
  );
}

async function walkPeak(
  segments: VideoSegment[],
  config: ProjectEffectConfig,
  fps: number,
  release: boolean,
): Promise<{ peak: number; created: number; openAtEnd: number }> {
  const registry = new DecodeCursorRegistry<string>();
  const runStart = segments[0]!.startTime;
  const last = segments[segments.length - 1]!;
  const total = Math.round((last.startTime + last.duration - runStart) * fps);
  for (let i = 0; i < total; i++) {
    const currentTime = runStart + i / fps;
    const raw = deriveCompositeParams(segments, currentTime, config);
    const plan = deriveSlotPlan(segments, currentTime, raw.transition, config);
    if (plan.a && !registry.get(plan.a.id)) registry.open(plan.a.id, plan.a.id);
    if (plan.b && !registry.get(plan.b.id)) registry.open(plan.b.id, plan.b.id);
    if (release) {
      await registry.releaseStale(currentTime, segments, config, async () => undefined);
    }
  }
  return { peak: registry.peakOpenCursors, created: registry.cursorsCreated, openAtEnd: registry.size };
}

const none: ProjectEffectConfig = { globalTransitionDuration: 0.5 };

describe('cursorLastNeededSec', () => {
  it('is the exclusive segment end when there is no outgoing GL transition', () => {
    const segments = chain(3, 1);
    expect(cursorLastNeededSec(segments[0]!, segments, none)).toBe(1);
    expect(cursorLastNeededSec(segments[2]!, segments, none)).toBe(3);
  });

  it('extends through the outgoing centered-transition tail', () => {
    const segments = chain(3, 1, { effectTransition: 'cross-dissolve', effectTransitionDuration: 0.4 });
    expect(cursorLastNeededSec(segments[0]!, segments, none)).toBe(1.2);
    expect(shouldReleaseDecodeCursor(segments[0]!, 1.199, segments, none)).toBe(false);
    expect(shouldReleaseDecodeCursor(segments[0]!, 1.2, segments, none)).toBe(true);
  });
});

describe('decode-cursor accumulation (the test that stops the leak returning)', () => {
  it(`peak simultaneous open cursors stays <= ${MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS} across a synthetic multi-segment run`, async () => {
    const segments = chain(8, 1);
    const released = await walkPeak(segments, none, 30, true);
    expect(released.created).toBe(8);
    expect(released.peak).toBeLessThanOrEqual(MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS);
    expect(released.openAtEnd).toBeLessThanOrEqual(1);
  });

  it(`same bound holds when every boundary is a centered GL transition`, async () => {
    const segments = chain(8, 1, { effectTransition: 'cross-dissolve', effectTransitionDuration: 0.4 });
    const released = await walkPeak(segments, none, 30, true);
    expect(released.created).toBe(8);
    expect(released.peak).toBeLessThanOrEqual(MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS);
  });

  it('without release, cursors accumulate to the segment count (the defect this test is built to see)', async () => {
    const segments = chain(8, 1);
    const leaked = await walkPeak(segments, none, 30, false);
    expect(leaked.peak).toBe(8);
    expect(leaked.openAtEnd).toBe(8);
  });

  it('exportWorker frame loop keeps peakOpenCursors <= 2 on a synthetic multi-segment run', async () => {
    const segments = chain(8, 1);
    const result = await probeFrameLoopCursorPeak(segments, none, 30);
    expect(result.cursorsCreated).toBe(8);
    expect(result.peakOpenCursors).toBeLessThanOrEqual(MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS);
    expect(result.openAtEnd).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// WS3 Defect 6/7 — per-ASSET lifetime (the demux cache and ImageBitmap map).
// ---------------------------------------------------------------------------

describe('assetLastNeededSecByAsset', () => {
  const noTransition: ProjectEffectConfig = {
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
  };

  it('an asset used by exactly one segment is finished when that cursor is', () => {
    const segments = [
      makeSegment({ id: 's0', startTime: 0, duration: 2, assetId: 'a' }),
      makeSegment({ id: 's1', startTime: 2, duration: 3, assetId: 'b' }),
    ];
    const out = assetLastNeededSecByAsset(segments, noTransition);
    expect(out.get('a')).toBe(cursorLastNeededSec(segments[0]!, segments, noTransition));
    expect(out.get('b')).toBe(cursorLastNeededSec(segments[1]!, segments, noTransition));
    expect(out.get('a')).toBe(2);
    expect(out.get('b')).toBe(5);
  });

  it('an asset REUSED later is held to the LATER segment — a revisit is never a reopen', () => {
    // The failure mode this rule exists to prevent: releasing 'a' at t=2 and
    // then needing it again at t=5.
    const segments = [
      makeSegment({ id: 's0', startTime: 0, duration: 2, assetId: 'a' }),
      makeSegment({ id: 's1', startTime: 2, duration: 3, assetId: 'b' }),
      makeSegment({ id: 's2', startTime: 5, duration: 4, assetId: 'a' }),
    ];
    const out = assetLastNeededSecByAsset(segments, noTransition);
    expect(out.get('a')).toBe(9);
    expect(out.get('b')).toBe(5);
  });

  it('inherits the outgoing GL transition tail from cursorLastNeededSec', () => {
    const segments = chain(2, 2, { effectTransition: 'cross-dissolve', effectTransitionDuration: 1 }).map((s, i) => ({
      ...s,
      assetId: `a${i}`,
    }));
    const out = assetLastNeededSecByAsset(segments, noTransition);
    // Segment 0 ends at 2 but stays selectable through boundary + D/2 = 2.5.
    expect(out.get('a0')).toBe(2.5);
  });

  it('ignores segments with no assetId', () => {
    const segments = [
      makeSegment({ id: 's0', startTime: 0, duration: 2, assetId: undefined }),
      makeSegment({ id: 's1', startTime: 2, duration: 2, assetId: 'a' }),
    ];
    const out = assetLastNeededSecByAsset(segments, noTransition);
    expect(out.size).toBe(1);
    expect(out.get('a')).toBe(4);
  });

  it('a long single-piece run releases assets progressively, not all at the end', () => {
    // The Defect 6 shape: 300 segments, one asset each. Before this rule every
    // demux entry lived until disposeAll; now each is finished at its own
    // segment's end, so at any instant at most a bounded few are still needed.
    const segments = Array.from({ length: 300 }, (_, i) =>
      makeSegment({ id: `s${i}`, startTime: i * 4, duration: 4, order: i, assetId: `a${i}` }),
    );
    const out = assetLastNeededSecByAsset(segments, noTransition);
    expect(out.size).toBe(300);
    const halfway = 150 * 4;
    const stillNeeded = [...out.values()].filter((t) => t > halfway).length;
    expect(stillNeeded).toBe(150);
    // Destructive-probe posture: this must NOT be 300 (the pre-fix behaviour,
    // where nothing was ever finished before the run ended).
    expect(stillNeeded).toBeLessThan(300);
  });
});
