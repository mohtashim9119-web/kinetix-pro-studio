/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T2.1 Commit 3 — restoring an absorbed-gap cluster back onto the
// timeline.
//
// A cluster is every `AbsorbedGap` entry on one host segment that shares the
// identical `span` (computed together, in one `computeAbsorbedGaps` run —
// see absorbedGaps.ts). Restoring a cluster:
//   1. shrinks the host segment back to its pre-absorption boundary (A1's
//      `span.start` — the host's own last spoken word end);
//   2. inserts one or more new segments filling `[span.start, span.end)`;
//   3. pushes the FOLLOWING survivor's startTime forward to `span.end`,
//      shrinking its own duration by the same delta so its own END (which
//      has nothing to do with this gap) does not move.
//
// SUB-FRAME RULE (owner decision, WS2 session ws2-22): a cluster whose
// per-piece share of the span would fall under a frame-based floor (too
// small to select or usefully prune on the timeline) is restored as ONE
// merged slot carrying every piece's text concatenated, instead of N
// unselectable slivers.
//
// KNOWN LIMITATION, NOT FIXED HERE: if `span.end - next.startTime` (the
// delta the following survivor must shrink by) exceeds that survivor's own
// duration, the `MIN_SEGMENT_DURATION` floor below keeps it from going
// negative, but its own END then moves forward — which could, in principle,
// require the SAME cascading fix `dragCascade.ts` uses for an analogous
// shrink-propagation problem. Not implemented: a gap this large relative to
// its very next neighbour's own duration has not been observed or
// ear-verified in any corpus this feature was built against.
// ---------------------------------------------------------------------------

import type { AbsorbedGap, VideoSegment } from '../types';
import { makeSliceSegmentId } from './segmentId';
import { splitRegionByCharCount } from './charWeightedSplit';

/** Mirrors snapBoundaries.ts's/charWeightedSplit.ts's own ENGINE floor — see
 *  syncConstants.ts's header for why the MIN_SEGMENT_DURATION copies are
 *  deliberately not merged across files. */
const MIN_SEGMENT_DURATION = 0.1;

/** A cluster whose EVERY piece would land below this many frames at the
 *  project's fps is restored as one merged slot instead of N slivers. */
export const RESTORE_SUB_FRAME_FLOOR_FRAMES = 2;

function round3(v: number): number {
  return Number(v.toFixed(3));
}

export function subFrameFloorSeconds(fps: number): number {
  return RESTORE_SUB_FRAME_FLOOR_FRAMES / fps;
}

/** Builds the VideoSegment shell for one restored piece. Carries over none
 *  of the host's own visual settings (transition/filter/etc.) — a restored
 *  scene is a fresh segment, not a copy of its absorbing neighbour. Callers
 *  needing defaults should apply them the same way any newly-created
 *  segment gets them elsewhere in the app. */
function makeRestoredSegment(id: string, text: string, startTime: number, duration: number): VideoSegment {
  return {
    id,
    text,
    startTime: round3(startTime),
    duration: round3(Math.max(MIN_SEGMENT_DURATION, duration)),
    transition: 'none',
    animation: 'none',
    order: 0,
  } as VideoSegment;
}

export interface RestoreClusterPlan {
  /** True when the sub-frame rule forced a single merged slot instead of one
   *  segment per gap entry. */
  merged: boolean;
  /** The new segment(s) to insert, in time order, already contiguous and
   *  spanning exactly `[span.start, span.end)`. */
  segments: VideoSegment[];
}

/**
 * Plans the restored segment(s) for one shared-span cluster. `gaps` must all
 * carry the identical `span` (a precondition — `computeAbsorbedGaps` only
 * ever produces same-span clusters together) and must be non-empty, in their
 * original document order.
 *
 * Pure. Does not know about the host segment or the rest of the timeline —
 * see `applyRestoreToSegments` for that.
 */
export function planRestoreCluster(
  gaps: readonly AbsorbedGap[],
  hostId: string,
  fps: number,
): RestoreClusterPlan {
  const { start, end } = gaps[0]!.span;
  const floor = subFrameFloorSeconds(fps);
  const perPieceShare = (end - start) / gaps.length;
  const wouldBeSubFrame = gaps.length > 1 && perPieceShare < floor;

  if (wouldBeSubFrame) {
    const mergedText = gaps.map(g => g.text).join(' ');
    return {
      merged: true,
      segments: [makeRestoredSegment(makeSliceSegmentId(hostId, 0), mergedText, start, end - start)],
    };
  }

  const pieces = splitRegionByCharCount(gaps.map(g => ({ text: g.text })), start, end);
  return {
    merged: false,
    segments: gaps.map((g, i) => makeRestoredSegment(g.segmentId, g.text, pieces[i]!.startTime, pieces[i]!.duration)),
  };
}

/**
 * Applies a restore for one cluster hosted on `segments[hostIndex]` to the
 * FULL committed segments array, returning a new array. `gapsToRestore` must
 * be a subset (or all) of `segments[hostIndex].absorbedGaps` sharing one
 * span. Preserves Model P (gapless partition) around the edit:
 *   - the host shrinks to end exactly at `span.start`;
 *   - the restored piece(s) are contiguous and span exactly
 *     `[span.start, span.end)` (`splitRegionByCharCount`'s own exactness
 *     guarantee);
 *   - the FOLLOWING segment (if any) is pushed to start exactly at
 *     `span.end`, its own duration shrunk by the same delta so its end does
 *     not move (see this module's header for the known floor-collision
 *     limitation);
 *   - with no following segment (the host was the last segment), the LAST
 *     restored piece is stretched to the host's pre-restore end instead,
 *     mirroring the "last segment runs to audioDuration" rule.
 *
 * Pure — returns a new array; does not mutate `segments`.
 */
export function applyRestoreToSegments(
  segments: readonly VideoSegment[],
  hostIndex: number,
  gapsToRestore: readonly AbsorbedGap[],
  fps: number,
): VideoSegment[] {
  if (gapsToRestore.length === 0) return segments as VideoSegment[];
  const host = segments[hostIndex];
  if (!host) return segments as VideoSegment[];

  const { start, end } = gapsToRestore[0]!.span;
  const plan = planRestoreCluster(gapsToRestore, host.id, fps);

  const out = segments.map(s => ({ ...s }));
  const newHost = out[hostIndex]!;
  const oldHostEnd = round3(newHost.startTime + newHost.duration);
  newHost.duration = round3(Math.max(0, start - newHost.startTime));

  const restoredIds = new Set(gapsToRestore.map(g => g.segmentId));
  const remainingGaps = (newHost.absorbedGaps ?? []).filter(g => !restoredIds.has(g.segmentId));
  if (remainingGaps.length > 0) {
    newHost.absorbedGaps = remainingGaps;
  } else {
    delete newHost.absorbedGaps;
  }

  const nextIndex = hostIndex + 1;
  let restored = plan.segments;
  if (nextIndex < out.length) {
    const next = out[nextIndex]!;
    const delta = round3(end - next.startTime);
    next.startTime = round3(end);
    next.duration = round3(Math.max(MIN_SEGMENT_DURATION, next.duration - delta));
  } else {
    const extra = round3(oldHostEnd - end);
    if (extra > 0) {
      const lastIdx = restored.length - 1;
      restored = restored.map((r, i) => (i === lastIdx ? { ...r, duration: round3(r.duration + extra) } : r));
    }
  }

  out.splice(nextIndex, 0, ...restored);
  return out;
}

/**
 * Restores every dropped scene named in `gapSegmentIds` (matched against
 * `AbsorbedGap.segmentId`, wherever it is currently hosted), across the
 * WHOLE committed segments array. Used both by the interactive restore UI
 * (Commit 3) and by the T2.2 override-store rehydration that re-applies a
 * user's past restores after a fresh Apply Sync run.
 *
 * A host segment can carry more than one independent cluster (different
 * `span`s, from more than one drop run over the project's lifetime) — this
 * groups its own `absorbedGaps` by shared span before checking membership,
 * so restoring one cluster never disturbs another cluster on the same host.
 *
 * Processes hosts from the END of the array backwards, so an earlier host's
 * insert never invalidates a not-yet-processed host's own index. Pure.
 */
export function restoreSegmentsByGapId(
  segments: readonly VideoSegment[],
  gapSegmentIds: ReadonlySet<string>,
  fps: number,
): VideoSegment[] {
  if (gapSegmentIds.size === 0) return segments as VideoSegment[];

  let out = segments as VideoSegment[];
  for (let hostIndex = out.length - 1; hostIndex >= 0; hostIndex--) {
    const gaps = out[hostIndex]!.absorbedGaps;
    if (!gaps || gaps.length === 0) continue;

    const bySpanKey = new Map<string, AbsorbedGap[]>();
    for (const g of gaps) {
      const key = `${g.span.start}|${g.span.end}`;
      const arr = bySpanKey.get(key);
      if (arr) arr.push(g); else bySpanKey.set(key, [g]);
    }

    for (const clusterGaps of bySpanKey.values()) {
      const toRestore = clusterGaps.filter(g => gapSegmentIds.has(g.segmentId));
      if (toRestore.length > 0) {
        out = applyRestoreToSegments(out, hostIndex, toRestore, fps);
      }
    }
  }
  return out;
}
