/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  planRestoreCluster, applyRestoreToSegments, restoreSegmentsByGapId, subFrameFloorSeconds,
  resolveRestoreRegion, RESTORE_REFUSAL_MESSAGE, RESTORE_MIN_SILENT_GAP_SECONDS,
} from './absorbedGapRestore';
import { isSliceSegmentId } from './segmentId';

function round3(v: number): number {
  return Number(v.toFixed(3));
}
import type { AbsorbedGap, VideoSegment } from '../types';

function seg(id: string, startTime: number, duration: number, extra?: Partial<VideoSegment>): VideoSegment {
  return { id, text: '', startTime, duration, transition: 'none', animation: 'none', order: 0, ...extra } as VideoSegment;
}

function gap(segmentId: string, text: string, start: number, end: number, gapAudio: AbsorbedGap['gapAudio'] = 'silent'): AbsorbedGap {
  return { segmentId, text, span: { start, end }, gapAudio };
}

/** A gap whose transcript DID record speech — `spokenSpan` is the sub-interval
 *  of `span` the orphan tokens actually cover. */
function spokenGap(
  segmentId: string, text: string, start: number, end: number,
  spokenStart: number, spokenEnd: number, orphanCount = 4,
): AbsorbedGap {
  return {
    segmentId, text, span: { start, end }, gapAudio: 'speech',
    spokenSpan: { start: spokenStart, end: spokenEnd }, orphanCount,
  };
}

function assertGapless(segments: readonly VideoSegment[]): void {
  for (let i = 0; i < segments.length - 1; i++) {
    const end = Number((segments[i]!.startTime + segments[i]!.duration).toFixed(3));
    expect(end).toBeCloseTo(segments[i + 1]!.startTime, 3);
  }
}

describe('subFrameFloorSeconds', () => {
  it('is 2 frames at the given fps', () => {
    expect(subFrameFloorSeconds(24)).toBeCloseTo(2 / 24, 6);
  });
});

describe('planRestoreCluster', () => {
  it('produces one segment per gap, each carrying its own original id, when pieces clear the frame floor', () => {
    const gaps = [gap('d1', 'First.', 10, 12)];
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.merged).toBe(false);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]!.id).toBe('d1');
    expect(plan.segments[0]!.startTime).toBe(10);
    expect(plan.segments[0]!.duration).toBe(2);
  });

  it('splits a multi-gap cluster by character count, contiguous and exact', () => {
    const gaps = [gap('d1', 'AB', 10, 14), gap('d2', 'AAAABBBB', 10, 14)]; // 2 chars vs 8 chars
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.merged).toBe(false);
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0]!.startTime).toBe(10);
    const end0 = plan.segments[0]!.startTime + plan.segments[0]!.duration;
    expect(plan.segments[1]!.startTime).toBeCloseTo(end0, 3);
    const end1 = plan.segments[1]!.startTime + plan.segments[1]!.duration;
    expect(end1).toBeCloseTo(14, 3);
  });

  it('merges a cluster into ONE slice-id slot when per-piece share falls under the frame floor', () => {
    // v6-shaped case: 3 skips sharing 0.24s at 24fps -> 0.08s/piece, well under 2/24 (~0.083s).
    const gaps = [gap('d1', 'One.', 10, 10.24), gap('d2', 'Two.', 10, 10.24), gap('d3', 'Three.', 10, 10.24)];
    const plan = planRestoreCluster(gaps, 'hostA', 24);
    expect(plan.merged).toBe(true);
    expect(plan.segments).toHaveLength(1);
    expect(isSliceSegmentId(plan.segments[0]!.id)).toBe(true);
    expect(plan.segments[0]!.text).toBe('One. Two. Three.');
    expect(plan.segments[0]!.startTime).toBe(10);
    expect(plan.segments[0]!.duration).toBeCloseTo(0.24, 3);
  });

  it('never merges a single-gap cluster even if it is itself sub-frame', () => {
    const gaps = [gap('d1', 'Solo.', 10, 10.01)];
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.merged).toBe(false);
    expect(plan.segments[0]!.id).toBe('d1');
  });
});

describe('applyRestoreToSegments', () => {
  it('restores a single dropped scene between two survivors, staying gapless', () => {
    // host [0,2) shrunk into the gap up to boundary 2.5; next starts at 2.5.
    // True reclaimable span (A1) is [1.8, 3.4).
    const segments = [
      seg('host', 0, 2.5, { absorbedGaps: [gap('d1', 'Dropped.', 1.8, 3.4)] }),
      seg('next', 2.5, 2),
    ];
    const out = applyRestoreToSegments(segments, 0, [gap('d1', 'Dropped.', 1.8, 3.4)], 24);

    expect(out).toHaveLength(3);
    expect(out[0]!.id).toBe('host');
    expect(out[0]!.duration).toBeCloseTo(1.8, 3); // shrunk back to span.start
    expect(out[0]!.absorbedGaps).toBeUndefined();
    expect(out[1]!.id).toBe('d1');
    expect(out[1]!.startTime).toBeCloseTo(1.8, 3);
    expect(out[2]!.id).toBe('next');
    expect(out[2]!.startTime).toBeCloseTo(3.4, 3);
    assertGapless(out);
  });

  it('keeps other absorbedGaps entries on the host that were not restored', () => {
    const segments = [
      seg('host', 0, 2.5, {
        absorbedGaps: [gap('d1', 'Dropped.', 1.8, 3.4), gap('d2', 'Other.', 5, 6)],
      }),
      seg('next', 2.5, 2),
    ];
    const out = applyRestoreToSegments(segments, 0, [gap('d1', 'Dropped.', 1.8, 3.4)], 24);
    expect(out[0]!.absorbedGaps).toHaveLength(1);
    expect(out[0]!.absorbedGaps![0]!.segmentId).toBe('d2');
  });

  it('restores a multi-gap cluster as contiguous inserted segments, staying gapless', () => {
    const gaps = [gap('d1', 'AB', 1.8, 3.4), gap('d2', 'AAAABBBB', 1.8, 3.4)];
    const segments = [
      seg('host', 0, 2.5, { absorbedGaps: gaps }),
      seg('next', 2.5, 2),
    ];
    const out = applyRestoreToSegments(segments, 0, gaps, 24);
    expect(out).toHaveLength(4);
    assertGapless(out);
    expect(out[3]!.startTime).toBeCloseTo(3.4, 3);
  });

  it('restoring the trailing gap on the LAST segment stretches the restored piece to the host\'s old end', () => {
    // host [0,5) is the LAST segment, previously extended to audioDuration = 5
    // by the last-survivor rule. True reclaimable span [1.8, 3.4).
    const segments = [seg('host', 0, 5, { absorbedGaps: [gap('d1', 'Tail.', 1.8, 3.4)] })];
    const out = applyRestoreToSegments(segments, 0, [gap('d1', 'Tail.', 1.8, 3.4)], 24);
    expect(out).toHaveLength(2);
    expect(out[0]!.duration).toBeCloseTo(1.8, 3);
    expect(out[1]!.startTime).toBeCloseTo(1.8, 3);
    // stretched from [1.8,3.4) (1.6s) out to the host's old end (5s) -> 3.2s total duration
    expect(out[1]!.duration).toBeCloseTo(3.2, 3);
    expect(out[1]!.startTime + out[1]!.duration).toBeCloseTo(5, 3);
    assertGapless(out);
  });

  it('a merged sub-frame cluster restores as one gapless slot carrying every piece\'s text', () => {
    const gaps = [gap('d1', 'One.', 1.8, 2.04), gap('d2', 'Two.', 1.8, 2.04), gap('d3', 'Three.', 1.8, 2.04)];
    const segments = [
      seg('host', 0, 1.9, { absorbedGaps: gaps }),
      seg('next', 1.9, 3),
    ];
    const out = applyRestoreToSegments(segments, 0, gaps, 24);
    expect(out).toHaveLength(3);
    expect(isSliceSegmentId(out[1]!.id)).toBe(true);
    expect(out[1]!.text).toBe('One. Two. Three.');
    assertGapless(out);
  });

  it('is a no-op when gapsToRestore is empty', () => {
    const segments = [seg('host', 0, 2), seg('next', 2, 2)];
    const out = applyRestoreToSegments(segments, 0, [], 24);
    expect(out).toEqual(segments);
  });

  it('is pure — does not mutate the input array', () => {
    const segments = [
      seg('host', 0, 2.5, { absorbedGaps: [gap('d1', 'Dropped.', 1.8, 3.4)] }),
      seg('next', 2.5, 2),
    ];
    const snapshot = JSON.parse(JSON.stringify(segments));
    applyRestoreToSegments(segments, 0, [gap('d1', 'Dropped.', 1.8, 3.4)], 24);
    expect(segments).toEqual(snapshot);
  });
});

describe('restoreSegmentsByGapId', () => {
  it('restores a named gap wherever it is hosted, leaving unrelated gaps untouched', () => {
    // Current (pre-restore) boundaries sit at the SNAPPED midpoint of each
    // gap's span (2.6 for [1.8,3.4), 7.6 for [7.2,8.0)) — the realistic
    // post-snapCoveredBoundaries shape, not the already-restored shape.
    const segments = [
      seg('a', 0, 2.6, { absorbedGaps: [gap('d1', 'One.', 1.8, 3.4)] }),
      seg('b', 2.6, 3.0),
      seg('c', 5.6, 2.0, { absorbedGaps: [gap('d2', 'Two.', 7.2, 8.0)] }),
      seg('d', 7.6, 2.4),
    ];
    assertGapless(segments); // fixture sanity
    const out = restoreSegmentsByGapId(segments, new Set(['d1']), 24);
    assertGapless(out);
    expect(out.map(s => s.id)).toEqual(['a', 'd1', 'b', 'c', 'd']);
    expect(out.find(s => s.id === 'c')!.absorbedGaps).toHaveLength(1); // d2 untouched
  });

  it('restores clusters on two different hosts in one call without index corruption', () => {
    const segments = [
      seg('a', 0, 2.6, { absorbedGaps: [gap('d1', 'One.', 1.8, 3.4)] }),
      seg('b', 2.6, 5.0, { absorbedGaps: [gap('d2', 'Two.', 7.2, 8.0)] }),
      seg('c', 7.6, 2.4),
    ];
    assertGapless(segments); // fixture sanity
    const out = restoreSegmentsByGapId(segments, new Set(['d1', 'd2']), 24);
    assertGapless(out);
    expect(out.map(s => s.id)).toEqual(['a', 'd1', 'b', 'd2', 'c']);
  });

  it('restores only ONE of two independent clusters hosted on the same segment', () => {
    const segments = [
      seg('a', 0, 1.9, { absorbedGaps: [gap('d1', 'One.', 1.8, 2.0)] }),
      seg('m', 1.9, 2.2, { absorbedGaps: [gap('d2', 'Two.', 4.0, 4.2)] }),
      seg('b', 4.1, 2),
    ];
    assertGapless(segments); // fixture sanity
    const out = restoreSegmentsByGapId(segments, new Set(['d2']), 24);
    assertGapless(out);
    expect(out.map(s => s.id)).toEqual(['a', 'm', 'd2', 'b']);
  });

  it('is a no-op for an empty id set', () => {
    const segments = [seg('a', 0, 2)];
    expect(restoreSegmentsByGapId(segments, new Set(), 24)).toEqual(segments);
  });
});

// ---------------------------------------------------------------------------
// WS2 session ws2-25, Commit 2 — RESTORE FROM ORPHAN TOKENS, NOT GAP WIDTH.
//
// The span between two survivors measures the distance between their own token
// edges. It is not free time to hand back: when transcript tokens sit inside
// it, that time is the dropped scene's speech and the remainder still belongs
// to the neighbours. Sizing from `spokenSpan` means a restore takes only what
// was spoken.
//
// The real row this is built against (173 `shadow_loss`, "Some don't emerge."):
// span 442.940 -> 445.360 (2.42s), orphan tokens `don 't emerge Fore` spanning
// 443.820 -> 445.360 (1.54s). The host keeps the 0.88s nobody spoke into.
// ---------------------------------------------------------------------------
describe('restore sizing from orphan tokens', () => {
  it('sizes the restored segment from the spoken span, not the gap width (173 shadow_loss)', () => {
    const gaps = [spokenGap('d1', 'Some don’t emerge.', 442.94, 445.36, 443.82, 445.36)];
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.refused).toBeFalsy();
    expect(plan.region).toEqual({ start: 443.82, end: 445.36 });
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]!.startTime).toBe(443.82);
    expect(plan.segments[0]!.duration).toBe(1.54);
    // The span-sized answer this replaces would have been 2.42s.
    expect(plan.segments[0]!.duration).not.toBe(2.42);
  });

  it('leaves the host the time nobody spoke into', () => {
    const segments = [
      seg('host', 440, 5),      // 440 -> 445
      seg('after', 445, 5),     // 445 -> 450
    ];
    const gaps = [spokenGap('d1', 'Some don’t emerge.', 442.94, 445.36, 443.82, 445.36)];
    const out = applyRestoreToSegments(segments, 0, gaps, 24);
    // Host now ends at the SPOKEN start (443.82), not at the span start (442.94):
    // it keeps the 0.88s of its own span the transcript never filled.
    expect(out[0]!.startTime + out[0]!.duration).toBeCloseTo(443.82, 3);
    expect(out[1]!.id).toBe('d1');
    expect(out[1]!.duration).toBe(1.54);
    assertGapless(out);
  });

  it('falls back to the full span when the transcript recorded nothing but the gap is wide', () => {
    const gaps: AbsorbedGap[] = [{ ...gap('d1', 'Unheard line.', 37.06, 37.94), orphanCount: 0 }];
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.refused).toBeFalsy();
    expect(plan.region).toEqual({ start: 37.06, end: 37.94 });
    expect(plan.segments[0]!.duration).toBeCloseTo(0.88, 3);
  });

  it('divides a multi-scene cluster at its own spoken boundaries', () => {
    const gaps = [
      spokenGap('d1', 'But something stayed.', 78, 90, 79.0, 80.3),
      spokenGap('d2', 'Small and permanent.', 78, 90, 81.34, 82.86),
    ];
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.merged).toBe(false);
    expect(plan.region).toEqual({ start: 79, end: 82.86 });
    expect(plan.segments[0]!.startTime).toBe(79);
    expect(plan.segments[1]!.startTime).toBe(81.34);
    expect(plan.segments[1]!.duration).toBeCloseTo(1.52, 3);
    // Contiguous, covering exactly the spoken region.
    expect(plan.segments[0]!.startTime + plan.segments[0]!.duration).toBeCloseTo(81.34, 3);
  });
});

describe('restore refusal — no recorded speech in a narrow gap', () => {
  const narrow = (): AbsorbedGap[] => [
    { ...gap('d1', 'But something stayed in you.', 78.73, 78.97), orphanCount: 0 },
    { ...gap('d2', 'Small and permanent.', 78.73, 78.97), orphanCount: 0 },
    { ...gap('d3', 'A new understanding of what the night actually is.', 78.73, 78.97), orphanCount: 0 },
  ];

  it('refuses rather than minting sub-frame slivers (v6 26-28)', () => {
    const plan = planRestoreCluster(narrow(), 'host', 24);
    expect(plan.refused).toBe(true);
    expect(plan.segments).toEqual([]);
    expect(plan.refusedReason).toBe(RESTORE_REFUSAL_MESSAGE);
  });

  it('leaves the timeline byte-identical when refused', () => {
    const segments = [seg('host', 70, 8.97), seg('after', 78.97, 11.17)];
    const out = applyRestoreToSegments(segments, 0, narrow(), 24);
    expect(out).toEqual(segments);
  });

  it('does not refuse when the transcript DID record words, however narrow the gap', () => {
    const gaps = [spokenGap('d1', 'Yes.', 10.0, 10.2, 10.05, 10.18, 1)];
    expect(planRestoreCluster(gaps, 'host', 24).refused).toBeFalsy();
  });

  it('does not refuse on a legacy gap with no recorded count — undefined is unknown, not zero', () => {
    const legacy = [gap('d1', 'Recorded before orphanCount existed.', 78.73, 78.97)];
    expect(legacy[0]!.orphanCount).toBeUndefined();
    expect(planRestoreCluster(legacy, 'host', 24).refused).toBeFalsy();
  });

  it('does not refuse a wide silent gap — the floor is narrowness AND no speech', () => {
    const wide = [{ ...gap('d1', 'Long unheard line.', 10, 12), orphanCount: 0 }];
    expect(planRestoreCluster(wide, 'host', 24).refused).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// WS2 session ws2-25, Commit 3 — GEOMETRY.
//
// Order: 3a (drop the double floor), 1 (bidirectional insert), 3b (merge on
// any sub-floor piece). Real-corpus note: 173's only leading run (index 0,
// "The Hardest Warhammer 40K...") has zero orphan tokens in a 0.16s span, so
// Commit 2's refusal rule fires on it before this geometry ever runs — these
// cases are therefore synthetic, built to the same shape (a leading run hosted
// by the survivor AFTER it) but with recorded speech so the restore proceeds.
// ---------------------------------------------------------------------------
describe('applyRestoreToSegments — hostSide (Bug 1, leading run)', () => {
  function beforeGap(segmentId: string, text: string, start: number, end: number): AbsorbedGap {
    return {
      segmentId, text, span: { start, end }, gapAudio: 'speech',
      spokenSpan: { start, end }, orphanCount: 3, hostSide: 'before',
    };
  }

  it('does NOT collapse the host to zero duration (the bug this fixes)', () => {
    // The host is the survivor AFTER the leading run — exactly 173 index 0's
    // shape: nothing precedes the gap, and the host's own start (0.16) is
    // LESS than the region it must give up (region.start would be 0 under the
    // old span-based math), which is what floored the host's duration to 0.
    const segments = [seg('host', 0.16, 5)]; // 0.16 -> 5.16
    const gaps = [beforeGap('d1', 'Leading line.', 0, 0.16)];
    const out = applyRestoreToSegments(segments, 0, gaps, 24);

    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe('d1');
    expect(out[0]!.startTime).toBe(0);
    expect(out[0]!.duration).toBeCloseTo(0.16, 3);
    // The host itself is untouched — the SAME duration as it had before
    // restoring the gap in front of it, not floored to 0.
    expect(out[1]!.id).toBe('host');
    expect(out[1]!.startTime).toBeCloseTo(0.16, 3);
    expect(out[1]!.duration).toBeCloseTo(5, 3);
    assertGapless(out);
  });

  it('inserts BEFORE the host, not after it', () => {
    const segments = [seg('before', 0, 1), seg('host', 3, 2)];
    const gaps = [beforeGap('d1', 'Line.', 1, 3)];
    const out = applyRestoreToSegments(segments, 1, gaps, 24);
    expect(out.map(s => s.id)).toEqual(['before', 'd1', 'host']);
    expect(out[0]!.duration).toBeCloseTo(1, 3); // preceding segment shrinks to region.start
    assertGapless(out);
  });

  it('shrinks the PRECEDING segment (not the host) to region.start when one exists', () => {
    const segments = [seg('before', 0, 2), seg('host', 3, 2)]; // before: 0->2, gap 2->3, host: 3->5
    const gaps = [beforeGap('d1', 'Line.', 2, 3)];
    const out = applyRestoreToSegments(segments, 1, gaps, 24);
    expect(out[0]!.startTime + out[0]!.duration).toBeCloseTo(2, 3);
    expect(out[2]!.id).toBe('host');
    expect(out[2]!.startTime).toBeCloseTo(3, 3);
    expect(out[2]!.duration).toBeCloseTo(2, 3); // host's own end (5) untouched
    assertGapless(out);
  });

  it('holds the timeline start at 0 when nothing precedes a leading restore', () => {
    const segments = [seg('host', 0.5, 4)];
    const gaps = [beforeGap('d1', 'Line.', 0, 0.5)];
    const out = applyRestoreToSegments(segments, 0, gaps, 24);
    expect(out[0]!.startTime).toBe(0);
    assertGapless(out);
  });

  it('defaults to \'after\' semantics for a gap recorded before hostSide existed', () => {
    const segments = [seg('host', 0, 5), seg('after', 5, 5)];
    const g: AbsorbedGap = { segmentId: 'd1', text: 'Line.', span: { start: 4, end: 5 }, gapAudio: 'speech', spokenSpan: { start: 4, end: 5 }, orphanCount: 2 };
    expect(g.hostSide).toBeUndefined();
    const out = applyRestoreToSegments(segments, 0, [g], 24);
    expect(out.map(s => s.id)).toEqual(['host', 'd1', 'after']);
  });
});

describe('planRestoreCluster — merge rule decided on real pieces (3b)', () => {
  it('merges the whole cluster when ANY piece — not just the average share — lands below the floor', () => {
    // Two pieces with very unequal token-derived shares: one comfortably clears
    // 2 frames at 24fps (2/24 ≈ 0.083s), the other does not, even though a flat
    // per-piece average of the total region would have cleared it.
    const gaps = [
      spokenGap('d1', 'Short.', 10, 10.5, 10.0, 10.04),   // 0.04s piece — sub-floor
      spokenGap('d2', 'Longer piece here.', 10, 10.5, 10.04, 10.5), // 0.46s piece — fine
    ];
    const avgShare = 0.5 / 2; // 0.25s — would have cleared the floor under a flat estimate
    expect(avgShare).toBeGreaterThan(2 / 24);
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.merged).toBe(true);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]!.text).toBe('Short. Longer piece here.');
  });

  it('does not merge a single-entry cluster regardless of its own duration', () => {
    const gaps = [spokenGap('d1', 'Tiny.', 10, 10.02, 10.0, 10.02)];
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.merged).toBe(false);
  });
});

describe('geometry — no overlap regardless of piece order (Commit 3 assertion)', () => {
  // Reproduces the shape of the reported defect (i26 ending 78.830 while i27
  // started 78.799, a +0.082s overlap that reversed sign with piece order) —
  // built with orphan tokens present so the cluster is NOT refused by Commit 2,
  // letting the geometry itself be exercised.
  function threeWaySpokenGaps(reverseOrder: boolean): AbsorbedGap[] {
    const texts = ['But something stayed in you.', 'Small and permanent.', 'A new understanding of what the night actually is.'];
    const spoken = [
      { start: 79.0, end: 80.26 },
      { start: 81.34, end: 82.86 },
      { start: 84.2, end: 86.54 },
    ];
    const order = reverseOrder ? [2, 1, 0] : [0, 1, 2];
    return order.map((idx, i) => spokenGap(`d${i}`, texts[idx]!, 78.7, 87.0, spoken[idx]!.start, spoken[idx]!.end));
  }

  function worstOverlap(segments: readonly VideoSegment[]): number {
    let worst = 0;
    for (let i = 0; i + 1 < segments.length; i++) {
      const end = Number((segments[i]!.startTime + segments[i]!.duration).toFixed(3));
      const overlap = Number((end - segments[i + 1]!.startTime).toFixed(3));
      if (overlap > worst) worst = overlap;
    }
    return worst;
  }

  it('produces zero overlap in forward order', () => {
    const segments = [seg('host', 70, 8.7), seg('after', 87.0, 5)];
    const out = applyRestoreToSegments(segments, 0, threeWaySpokenGaps(false), 24);
    expect(worstOverlap(out)).toBe(0);
    assertGapless(out);
  });

  it('produces zero overlap in reversed order too', () => {
    const segments = [seg('host', 70, 8.7), seg('after', 87.0, 5)];
    const out = applyRestoreToSegments(segments, 0, threeWaySpokenGaps(true), 24);
    expect(worstOverlap(out)).toBe(0);
    assertGapless(out);
  });
});


describe('3a — narrow band where the old double-floor bug is NOT masked by 3b\'s merge', () => {
  it('does not overlap when every piece independently clears the 2-frame merge floor but not the old 0.1s re-floor', () => {
    // 4 equal-length texts over a 0.36s span: canApplyFloor is false
    // (4*0.1 > 0.36), so splitRegionByCharCount deliberately leaves each
    // piece at its true 0.09s share. 0.09s clears the 2-frame merge floor
    // (2/24 \u2248 0.0833s) so 3b does NOT fold this into one slot \u2014 which
    // means this case exercises 3a in isolation. Under the OLD code,
    // makeRestoredSegment re-floored every 0.09s piece up to 0.1s WITHOUT
    // recomputing the next piece\'s startTime, overlapping each piece\'s end
    // 0.01s into its successor\'s start.
    const texts = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd'];
    const gaps: AbsorbedGap[] = texts.map((text, i) => ({
      segmentId: `d${i}`, text, span: { start: 10, end: 10.36 }, gapAudio: 'silent', orphanCount: 0,
    }));
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.merged).toBe(false); // confirms 3b did not intervene here
    expect(plan.segments).toHaveLength(4);
    for (const p of plan.segments) expect(p.duration).toBeCloseTo(0.09, 3);
    for (let i = 0; i + 1 < plan.segments.length; i++) {
      const end = Number((plan.segments[i]!.startTime + plan.segments[i]!.duration).toFixed(3));
      expect(end).toBeLessThanOrEqual(plan.segments[i + 1]!.startTime);
    }
    const last = plan.segments[3]!;
    expect(round3(last.startTime + last.duration)).toBeCloseTo(10.36, 3);
  });
});

describe('3a — no double floor application (root cause of the reported overlap)', () => {
  it('does not re-apply MIN_SEGMENT_DURATION on top of splitRegionByCharCount\'s own floor decision', () => {
    // A region too small to afford the floor for every piece (3 * 0.1 > 0.3),
    // so splitRegionByCharCount deliberately skips the floor and lets pieces
    // stay sub-floor rather than overshoot the region end. The OLD
    // makeRestoredSegment then silently bumped each piece back up to 0.1
    // WITHOUT recomputing later pieces' startTimes — producing exactly the
    // reported pattern (a piece's end running past its neighbour's start).
    const gaps: AbsorbedGap[] = [
      { segmentId: 'd1', text: 'But something stayed in you.', span: { start: 78.7, end: 79.0 }, gapAudio: 'silent', orphanCount: 0 },
      { segmentId: 'd2', text: 'Small and permanent.', span: { start: 78.7, end: 79.0 }, gapAudio: 'silent', orphanCount: 0 },
      { segmentId: 'd3', text: 'A new understanding of what the night actually is.', span: { start: 78.7, end: 79.0 }, gapAudio: 'silent', orphanCount: 0 },
    ];
    // Not refused: span (0.3s) >= RESTORE_MIN_SILENT_GAP_SECONDS (0.25s).
    expect(0.3).toBeGreaterThanOrEqual(RESTORE_MIN_SILENT_GAP_SECONDS);
    const plan = planRestoreCluster(gaps, 'host', 24);
    expect(plan.refused).toBeFalsy();

    if (plan.merged) {
      // 3b may legitimately collapse this into one slot — either resolution
      // must still be non-overlapping and exact.
      expect(plan.segments[0]!.startTime + plan.segments[0]!.duration).toBeCloseTo(79.0, 3);
    } else {
      for (let i = 0; i + 1 < plan.segments.length; i++) {
        const end = Number((plan.segments[i]!.startTime + plan.segments[i]!.duration).toFixed(3));
        expect(end).toBeLessThanOrEqual(plan.segments[i + 1]!.startTime + 1e-9);
      }
      const last = plan.segments[plan.segments.length - 1]!;
      expect(round3(last.startTime + last.duration)).toBeCloseTo(79.0, 3);
    }
  });
});
