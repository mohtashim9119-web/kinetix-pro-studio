// @vitest-environment jsdom
/**
 * THE GENERALISED GUARD — no drag gesture may change total timeline duration.
 *
 * Owner ruling 2026-08-08, `docs/decisions/2026-08-08-last-segment-edge.md`
 * (semantic option (i)): the last segment's right edge is not draggable, which
 * makes `segments[N-1].end === mediaDuration` a hard invariant with respect to
 * drag. This file states that as a PROPERTY over every drag the timeline can
 * express, rather than as an assertion about the one edge that was reported.
 *
 * Why a property and not a special case. The reported instance — grabbing the
 * last card's right handle — is one of three ways the pre-ruling code could
 * lengthen the timeline. The other two never touch that edge:
 *
 *   - a RIGHT-edge drag on segment **N-2** whose overflow exceeds what segment
 *     N-1 can yield above `MIN_SEGMENT_DURATION`. The cascade's giveback was
 *     scoped `hi < segs.length - 1`, so when the touched window happened to end
 *     at the last index the unabsorbed remainder was simply kept;
 *   - a LEFT-edge drag on segment 0 of a **single-segment** timeline, where
 *     `lo === hi === segs.length - 1` reaches the same exemption.
 *
 * Both were found by reading `dragCascade.ts`, not by any test — the suite was
 * fully green at 1514 with all three live. Locking only the affordance would
 * have left the other two, which is the whole argument for this file.
 *
 * TWO LAYERS, deliberately.
 *   PART 1 sweeps the pure cascade (`computeDragCascade` under
 *          `DRAG_CASCADE_OPTIONS`) exhaustively — every index, both edges, both
 *          directions, overshoot far past the media bounds, with and without a
 *          word floor, with locks in every position.
 *   PART 2 re-proves the same property end-to-end through the REAL
 *          `startDragSession` (`DragSessionHarness`), so the property holds of
 *          the gesture a user actually performs, not merely of the function it
 *          eventually calls. This is what would catch the option being dropped
 *          somewhere in the plumbing between the two.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  computeDragCascade,
  isDragEdgeLocked,
  resolveDragPreview,
  DRAG_CASCADE_OPTIONS,
} from './dragCascade';
import { DragSessionHarness } from './dragSessionHarness';
import { checkTimelineIsGapless, PARTITION_EPSILON_SEC } from './timelinePartition';
import { computeTotalDuration } from '../components/Timeline';
import { TransitionType, AnimationType, type TranscriptToken, type VideoSegment } from '../types';

function seg(
  id: string,
  startTime: number,
  duration: number,
  extra: Partial<VideoSegment> = {},
): VideoSegment {
  return {
    id,
    text: `text-${id}`,
    startTime,
    duration,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    anchorStart: startTime,
    ...extra,
  };
}

/** `n` contiguous 5s segments starting at 0 — total duration exactly `5n`. */
function gaplessArray(n: number, extra: (i: number) => Partial<VideoSegment> = () => ({})): VideoSegment[] {
  return Array.from({ length: n }, (_, i) =>
    seg(String.fromCharCode(65 + i), i * 5, 5, extra(i)));
}

/** Four words inside each 5s slot, with ~0.15s of leading silence — the shape
 *  `snapCoveredBoundaries` actually produces (a boundary at a silence CENTRE
 *  leaves each side roughly half an inter-word gap). Gives the K15b word floor
 *  something real to bind against. */
function wordsFor(n: number): TranscriptToken[] {
  const out: TranscriptToken[] = [];
  for (let i = 0; i < n; i++) {
    const from = i * 5;
    out.push(
      { startSec: from + 0.15, endSec: from + 0.9, text: 'w' },
      { startSec: from + 1.4, endSec: from + 2.2, text: 'w' },
      { startSec: from + 2.7, endSec: from + 3.5, text: 'w' },
      { startSec: from + 3.9, endSec: from + 4.8, text: 'w' },
    );
  }
  return out;
}

const noBlock = (): void => undefined;

/**
 * The property, asserted on one committed array.
 *
 * Tolerance is `PARTITION_EPSILON_SEC` (1.5ms) rather than exact equality, for
 * the same reason `timelinePartition.ts` uses it: every `startTime`/`duration`
 * in this pipeline passes through `Number(v.toFixed(3))`, so two values equal
 * in intent can differ by up to half a millisecond of representation. 1.5ms is
 * comfortably above that and two orders of magnitude below
 * `MIN_SEGMENT_DURATION`, so it cannot mask a real change.
 */
type TimedSegment = Pick<VideoSegment, 'id' | 'startTime' | 'duration' | 'locked'>;

function assertDurationInvariant(
  before: TimedSegment[],
  after: TimedSegment[],
  label: string,
): void {
  const wanted = computeTotalDuration(before);
  const got = computeTotalDuration(after);
  expect(
    Math.abs(got - wanted),
    `${label}: total duration moved ${wanted.toFixed(6)} -> ${got.toFixed(6)}`,
  ).toBeLessThanOrEqual(PARTITION_EPSILON_SEC);
  expect(checkTimelineIsGapless(after), `${label}: partition broken`).toBeNull();
}

// ---------------------------------------------------------------------------
// PART 1 — the pure cascade, swept exhaustively.
// ---------------------------------------------------------------------------
describe('PART 1 — no drag changes total duration (pure cascade sweep)', () => {
  // Deliberately includes overshoot far past any plausible media bound in both
  // directions: 200s of grow on a 25s timeline, and a shrink demand larger than
  // the whole array. Those are the cases where the giveback and the
  // MIN_SEGMENT_DURATION clamp interact, and where the pre-ruling exemption did
  // its damage.
  const DELTAS = [-200, -12, -4.9, -1, -0.05, 0.05, 1, 4.9, 12, 200];
  const SIZES = [1, 2, 3, 5];

  it('holds for every index, both edges, both directions, including overshoot', () => {
    for (const n of SIZES) {
      for (let idx = 0; idx < n; idx++) {
        for (const direction of ['right', 'left'] as const) {
          for (const delta of DELTAS) {
            const before = gaplessArray(n);
            const edge = direction === 'right' ? 'end' : 'start';
            // The affordance/defensive layers refuse this pair outright, so the
            // cascade is never asked about it. Asserting a value for it here
            // would be asserting behaviour no gesture can reach.
            if (isDragEdgeLocked(before, idx, edge)) continue;
            const out = computeDragCascade(
              before, idx, Math.max(0.1, before[idx]!.duration + delta), 0,
              direction, noBlock, undefined, DRAG_CASCADE_OPTIONS,
            );
            if (out === null) continue; // blocked — nothing committed
            assertDurationInvariant(before, out, `n=${n} idx=${idx} ${direction} ${delta}`);
          }
        }
      }
    }
  });

  it('holds with the K15b word floor active (a real transcript in hand)', () => {
    for (const n of SIZES) {
      const tokens = wordsFor(n);
      for (let idx = 0; idx < n; idx++) {
        for (const direction of ['right', 'left'] as const) {
          for (const delta of DELTAS) {
            const before = gaplessArray(n);
            const edge = direction === 'right' ? 'end' : 'start';
            if (isDragEdgeLocked(before, idx, edge)) continue;
            const out = computeDragCascade(
              before, idx, Math.max(0.1, before[idx]!.duration + delta), 0,
              direction, noBlock, tokens, DRAG_CASCADE_OPTIONS,
            );
            if (out === null) continue;
            assertDurationInvariant(before, out, `words n=${n} idx=${idx} ${direction} ${delta}`);
          }
        }
      }
    }
  });

  it('holds with a lock in every position', () => {
    const n = 5;
    for (let lockIdx = 0; lockIdx < n; lockIdx++) {
      for (let idx = 0; idx < n; idx++) {
        for (const direction of ['right', 'left'] as const) {
          for (const delta of [-200, -3, 3, 200]) {
            const before = gaplessArray(n, i => (i === lockIdx ? { locked: true } : {}));
            const edge = direction === 'right' ? 'end' : 'start';
            if (isDragEdgeLocked(before, idx, edge)) continue;
            const out = computeDragCascade(
              before, idx, Math.max(0.1, before[idx]!.duration + delta), 0,
              direction, noBlock, undefined, DRAG_CASCADE_OPTIONS,
            );
            if (out === null) continue;
            assertDurationInvariant(before, out, `lock@${lockIdx} idx=${idx} ${direction} ${delta}`);
          }
        }
      }
    }
  });

  it('the LIVE PREVIEW obeys it too, on every frame', () => {
    // A preview that lengthened the timeline while the commit did not would
    // reintroduce K17's release-jump in its most visible form: the whole
    // timeline rescaling under the pointer and snapping back on release.
    for (const n of SIZES) {
      for (let idx = 0; idx < n; idx++) {
        for (const direction of ['right', 'left'] as const) {
          for (const delta of [-200, -2, 2, 200]) {
            const before = gaplessArray(n);
            const edge = direction === 'right' ? 'end' : 'start';
            if (isDragEdgeLocked(before, idx, edge)) continue;
            const preview = resolveDragPreview(
              before, idx, Math.max(0.1, before[idx]!.duration + delta), 0, direction,
            );
            assertDurationInvariant(before, preview, `preview n=${n} idx=${idx} ${direction} ${delta}`);
          }
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // The two entry points the affordance lock alone would have missed. Pinned
  // individually as well as by the sweep, so a regression names itself rather
  // than surfacing as one of several hundred sweep iterations.
  // -------------------------------------------------------------------------
  it('REGRESSION — a right-edge drag on N-2 cannot push the overflow off the end of the array', () => {
    // Grow B by 100s on a 3-segment array. C can yield only 4.7s before hitting
    // MIN_SEGMENT_DURATION; pre-ruling, the remaining ~95.3s was kept and the
    // timeline grew by exactly that much.
    const before = gaplessArray(3); // A,B,C — total 15s
    const out = computeDragCascade(
      before, 1, before[1]!.duration + 100, 0, 'right', noBlock, undefined, DRAG_CASCADE_OPTIONS,
    )!;
    expect(out).not.toBeNull();
    expect(computeTotalDuration(out)).toBeCloseTo(15, 6);
    // B took exactly what C could give, and no more.
    expect(out[2]!.duration).toBeCloseTo(0.3, 6);
    expect(out[1]!.duration).toBeCloseTo(9.7, 6);
  });

  it('REGRESSION — a left-edge drag on the only segment of a one-segment timeline is a no-op', () => {
    const before = gaplessArray(1); // A — total 5s
    const out = computeDragCascade(
      before, 0, before[0]!.duration + 3, 0, 'left', noBlock, undefined, DRAG_CASCADE_OPTIONS,
    )!;
    expect(computeTotalDuration(out)).toBeCloseTo(5, 6);
    expect(out[0]!.duration).toBeCloseTo(5, 6);
  });

  it('the NON-drag caller is unaffected — omitting the options keeps pre-ruling behaviour', () => {
    // `handlePlaybackSpeedChange` reaches this same function through
    // `applyDurationChange` and legitimately changes the last segment's
    // duration (decision doc §4). If the conservation were made the default
    // instead of an opt-in, the speed slider would silently stop working on the
    // last segment — this is the test that would fail.
    const before = gaplessArray(3);
    const out = computeDragCascade(before, 2, 8, 0, 'right', noBlock)!;
    expect(out[2]!.duration).toBeCloseTo(8, 6);
    expect(computeTotalDuration(out)).toBeCloseTo(18, 6); // deliberately CHANGED
  });
});

// ---------------------------------------------------------------------------
// PART 2 — the same property, end-to-end through the real drag session.
// ---------------------------------------------------------------------------
describe('PART 2 — no drag changes total duration (real session, end to end)', () => {
  let active: DragSessionHarness | null = null;
  afterEach(() => { active?.dispose(); active = null; });

  const harnessOf = (
    segments: VideoSegment[],
    config?: ConstructorParameters<typeof DragSessionHarness>[1],
  ): DragSessionHarness => {
    active = new DragSessionHarness(segments, config);
    return active;
  };

  it('holds across every edge of every segment, both directions, including overshoot', () => {
    const SIZES = [1, 2, 3, 4];
    const DELTAS = [-100, -6, -0.4, 0.4, 6, 100];
    for (const n of SIZES) {
      for (let idx = 0; idx < n; idx++) {
        for (const edge of ['start', 'end'] as const) {
          for (const delta of DELTAS) {
            const before = gaplessArray(n);
            const h = harnessOf(before);
            const id = before[idx]!.id;
            const out = h.grab(id, edge).moveBy(delta).release();
            assertDurationInvariant(
              before, out.segments, `session n=${n} idx=${idx} ${edge} ${delta}`,
            );
            h.dispose();
            active = null;
          }
        }
      }
    }
  });

  it('holds after EVERY FRAME of a multi-frame drag, not just at release', () => {
    // The live DOM is what the user is looking at; a preview that lengthens the
    // timeline mid-gesture is the reported defect even if the commit is clean.
    const before = gaplessArray(4);
    const h = harnessOf(before);
    h.grab('B', 'end');
    let cumulative = 0;
    for (const step of [2.0, -5.0, 40.0, -0.3, 12.0, -60.0]) {
      cumulative += step;
      h.moveBy(step);
      assertDurationInvariant(
        before, h.readLiveSegments(before), `frame at cumulative ${cumulative}`,
      );
    }
    const out = h.release();
    assertDurationInvariant(before, out.segments, 'release');
  });

  it('holds across a long chain of gestures in one session, with no reset between them', () => {
    // Drift is cumulative by nature: a per-gesture rounding leak would pass
    // every single-gesture assertion above and still walk the tail over time.
    const before = gaplessArray(5);
    const h = harnessOf(before);
    const script: Array<[string, 'start' | 'end', number]> = [
      ['A', 'end', 1.7], ['B', 'start', -2.3], ['C', 'end', 30], ['E', 'start', -4.1],
      ['D', 'end', -3.3], ['B', 'end', 0.9], ['E', 'end', 25], ['A', 'start', -9],
      ['C', 'start', 1.2], ['D', 'start', -0.6],
    ];
    for (const [id, edge, delta] of script) {
      h.grab(id, edge).moveBy(delta).release();
      assertDurationInvariant(before, h.currentSegments, `after ${id} ${edge} ${delta}`);
    }
  });

  it('holds with locks present, where the cascade may be refused mid-array', () => {
    for (let lockIdx = 0; lockIdx < 4; lockIdx++) {
      for (const edge of ['start', 'end'] as const) {
        for (const delta of [-50, -2, 2, 50]) {
          const before = gaplessArray(4, i => (i === lockIdx ? { locked: true } : {}));
          const h = harnessOf(before);
          for (const s of before) {
            h.grab(s.id, edge).moveBy(delta).release();
            assertDurationInvariant(
              before, h.currentSegments, `lock@${lockIdx} drag ${s.id} ${edge} ${delta}`,
            );
          }
          h.dispose();
          active = null;
        }
      }
    }
  });

  it('holds when the drag is discarded by pointercancel rather than released', () => {
    const before = gaplessArray(3);
    const h = harnessOf(before);
    const out = h.grab('B', 'end').moveBy(50).cancel();
    expect(out.kind).toBe('reverted-cancelled');
    assertDurationInvariant(before, out.segments, 'cancelled');
  });
});
