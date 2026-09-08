/**
 * WS3 — decode-cursor GRANULARITY, locked against the "make it per-asset" change.
 *
 * The audit that prompted these tests proposed keying cursor release (and, to
 * reach its stated goal of "4 cursors instead of 332", cursor IDENTITY) by
 * ASSET rather than by SEGMENT. These tests record why that cannot work, in the
 * two independent ways it fails, so a future session does not re-derive it:
 *
 *  1. Release timing cannot change the OPEN COUNT at all. The playhead is
 *     monotone and each segment occupies one contiguous interval, so a
 *     segment-keyed cursor is opened exactly once no matter when it is
 *     released. There are zero reopens to eliminate.
 *  2. Asset-keyed cursor IDENTITY is unsound on the field shape, because a
 *     cursor is a forward-only generator over one segment's source range and
 *     slideshow segments all restart that range at `trimStart: 0`.
 */
import { describe, it, expect } from 'vitest';
import { AnimationType, TransitionType, type VideoSegment } from '../../types';
import type { ProjectEffectConfig } from '../gl/compositeParams';
import {
  MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS,
  assetLastNeededSecByAsset,
  assetSourceTimeIsMonotone,
} from './decodeCursorLifetime';
import { probeFrameLoopCursorPeak } from './exportWorker';

const SEG_DUR = 0.4;
const FPS = 30;
const ASSETS = ['a0', 'a1', 'a2', 'a3'] as const;

/** The field shape: 332 segments cycling 4 unique assets, every `trimStart: 0`
 *  (matching `src/dev/exportLivenessProbe/generatePartCFixture.ts`). */
function fieldTimeline(count = 332, trimStart = 0): VideoSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    text: '',
    assetId: ASSETS[i % ASSETS.length]!,
    startTime: i * SEG_DUR,
    duration: SEG_DUR,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: i,
    trimStart,
  }));
}

const NO_TRANSITION: ProjectEffectConfig = {
  globalTransition: TransitionType.NONE,
  globalTransitionDuration: 0,
  globalAnimation: AnimationType.NONE,
} as ProjectEffectConfig;

const CROSS_DISSOLVE: ProjectEffectConfig = {
  globalTransition: 'cross-dissolve' as TransitionType,
  globalTransitionDuration: 0.2,
  globalAnimation: AnimationType.NONE,
} as ProjectEffectConfig;

describe('decode-cursor granularity (332 segments / 4 assets)', () => {
  it('opens one cursor per SEGMENT, and every open is a first touch — no reopens', async () => {
    const segments = fieldTimeline();
    const r = await probeFrameLoopCursorPeak(segments, NO_TRANSITION, FPS);

    // The count under audit. It is the segment count, not the unique-asset count.
    expect(r.cursorsCreated).toBe(332);
    expect(new Set(segments.map((s) => s.assetId)).size).toBe(4);

    // The load-bearing half: 332 opens across 332 segments means each segment
    // opened exactly once. There is no reopen for a later release to prevent,
    // so moving release from per-segment to per-asset cannot lower this number.
    expect(r.cursorsCreated).toBe(segments.length);
  });

  it('holds the peak-open bound at 2 under a centered GL transition', async () => {
    const r = await probeFrameLoopCursorPeak(fieldTimeline(), CROSS_DISSOLVE, FPS);
    expect(r.peakOpenCursors).toBeLessThanOrEqual(MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS);
    expect(r.peakOpenCursors).toBe(2);
    expect(r.cursorsCreated).toBe(332);
  });

  it('per-asset release would free nothing: every asset is last needed at the end of the run', () => {
    const segments = fieldTimeline();
    const runEnd = 332 * SEG_DUR;
    const lastNeeded = assetLastNeededSecByAsset(segments, NO_TRANSITION);

    expect(lastNeeded.size).toBe(4);
    // Assets are cycled, so each one's LAST referencing segment sits in the
    // final four segments of the run. Releasing on the per-asset max therefore
    // releases nothing until the run is already over — while raising the number
    // of simultaneously-open cursors from 2 to 4 (one per unique asset).
    for (const [, sec] of lastNeeded) {
      expect(sec).toBeGreaterThan(runEnd - 4 * SEG_DUR - 1e-9);
    }
  });

  it('rejects asset-keyed cursor identity: source time is not monotone on the field shape', () => {
    // trimStart 0 on every segment — each reuse of an asset restarts its source
    // range at zero, which a forward-only cursor cannot serve.
    expect(assetSourceTimeIsMonotone(fieldTimeline())).toBe(false);

    // Control: the same helper accepts a timeline that DOES read each asset
    // forward, which is the precondition an asset-keyed cursor would require.
    const monotone: VideoSegment[] = ASSETS.flatMap((assetId, a) =>
      [0, 1, 2].map((k) => ({
        id: `m${a}-${k}`,
        text: '',
        assetId,
        startTime: (a * 3 + k) * SEG_DUR,
        duration: SEG_DUR,
        transition: TransitionType.NONE,
        animation: AnimationType.NONE,
        order: a * 3 + k,
        trimStart: k * SEG_DUR,
      })),
    );
    expect(assetSourceTimeIsMonotone(monotone)).toBe(true);
  });
});
