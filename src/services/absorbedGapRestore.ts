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
import { makeSliceSegmentId, MERGE_SLOT_ORDINAL } from './segmentId';
import { splitRegionByCharCount } from './charWeightedSplit';

/** Mirrors snapBoundaries.ts's/charWeightedSplit.ts's own ENGINE floor — see
 *  syncConstants.ts's header for why the MIN_SEGMENT_DURATION copies are
 *  deliberately not merged across files. */
const MIN_SEGMENT_DURATION = 0.1;

/** A cluster whose EVERY piece would land below this many frames at the
 *  project's fps is restored as one merged slot instead of N slivers. */
export const RESTORE_SUB_FRAME_FLOOR_FRAMES = 2;

/**
 * WS2 session ws2-25 Commit 2 — the refusal floor.
 *
 * A cluster whose transcript recorded NOTHING between the two survivors
 * (`orphanCount === 0`) and whose whole span is narrower than this is refused
 * rather than restored: there is no evidence of speech to size a segment from,
 * and the span is too small to be anything but the seam between two adjacent
 * words. Restoring it can only produce slivers carved out of neighbours that
 * legitimately own that time.
 *
 * NOT a sync-timing constant and deliberately not in `syncConstants.ts`: it
 * decides whether a USER-INITIATED restore proceeds, and moves no boundary the
 * sync pipeline placed. It is an operator-specified UI floor (WS2 session
 * ws2-25), not a value derived from an acoustic property — stated plainly here
 * so it is never mistaken for one.
 */
export const RESTORE_MIN_SILENT_GAP_SECONDS = 0.25;

/** Why a restore was refused — surfaced to the user verbatim. Worded for what
 *  was actually tested: the TRANSCRIPT recorded no words here. It does not
 *  claim the audio is silent (nothing in this path listens to audio), and on
 *  the Whisper arm it is entirely possible for real speech to exist that
 *  Whisper failed to transcribe — measured, v6 78.7-90.1s. */
export const RESTORE_REFUSAL_MESSAGE = 'Nothing spoken here — the transcript recorded no words in this gap.';

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
    // WS2 ws2-25 Commit 3 (3a) — NO FLOOR HERE. `splitRegionByCharCount` is the
    // one place MIN_SEGMENT_DURATION is applied, and it applies it only when the
    // region can afford it for every piece, precisely so the pieces still tile
    // the region exactly. Re-applying the floor here raised individual durations
    // WITHOUT moving the startTimes they were computed against, which is what
    // made restored pieces overlap: v6 26/27/28 committed i26 ending at 78.830
    // against i27 starting at 78.799, a 0.031-0.082s overlap that reversed sign
    // with piece order. A piece below the floor is now handled by merging the
    // whole cluster (3b below), never by silently stretching one piece past its
    // neighbour's onset.
    duration: round3(Math.max(0, duration)),
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
   *  spanning exactly `[region.start, region.end)`. Empty when `refused`. */
  segments: VideoSegment[];
  /** WS2 ws2-25 Commit 2 — the interval the restore actually occupies. This is
   *  the cluster's ORPHAN-TOKEN region when the transcript recorded words
   *  inside the absorbed span, and the full span only when it did not. The
   *  host shrinks to `region.start` and the following survivor resumes at
   *  `region.end`, so neighbours give back only time that was spoken. */
  region: { start: number; end: number };
  /** Set when the cluster was refused outright (no recorded speech, span below
   *  `RESTORE_MIN_SILENT_GAP_SECONDS`). `segments` is empty and the caller must
   *  leave the timeline untouched and surface `refusedReason`. */
  refused?: boolean;
  refusedReason?: string;
}

/** The interval a cluster's restore should occupy: the union of its entries'
 *  own `spokenSpan`s when the transcript recorded words inside the absorbed
 *  span, else the absorbed span itself.
 *
 *  THE SPAN BETWEEN NEIGHBOURS IS NOT FREE TIME. `span` measures the distance
 *  between two survivors' token edges; when real tokens sit inside it, that
 *  time is the dropped scene's own speech and the rest still belongs to the
 *  neighbours. Sizing from `spokenSpan` is what keeps a restore from taking
 *  more than was actually spoken — measured, 173 `shadow_loss` occupies 1.54s
 *  of speech inside a 2.42s span, so the host keeps 0.63s and the following
 *  survivor keeps 0.25s that the span-sized restore used to take from them. */
export function resolveRestoreRegion(gaps: readonly AbsorbedGap[]): { start: number; end: number } {
  const spoken = gaps.map(g => g.spokenSpan).filter((x): x is { start: number; end: number } => !!x);
  if (spoken.length === 0) return { ...gaps[0]!.span };
  return {
    start: round3(Math.min(...spoken.map(s => s.start))),
    end: round3(Math.max(...spoken.map(s => s.end))),
  };
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
  const span = gaps[0]!.span;
  const region = resolveRestoreRegion(gaps);

  // REFUSAL — nothing was recorded here and the seam is too narrow to be
  // anything else. Only an explicit 0 counts: `undefined` is a gap recorded
  // before the count existed, and refusing on absent evidence would be a
  // guess (see AbsorbedGap.orphanCount).
  const orphanCount = gaps[0]!.orphanCount;
  if (orphanCount === 0 && span.end - span.start < RESTORE_MIN_SILENT_GAP_SECONDS) {
    return { merged: false, segments: [], region, refused: true, refusedReason: RESTORE_REFUSAL_MESSAGE };
  }

  const start = region.start;
  const end = region.end;
  const floor = subFrameFloorSeconds(fps);

  // Prefer each entry's own token-derived interval; character-weighted
  // division of the same region when the transcript attributed nothing.
  const haveSpoken = gaps.every(g => !!g.spokenSpan);
  const pieces = haveSpoken
    ? gaps.map((g, i) => {
        const st = i === 0 ? start : g.spokenSpan!.start;
        const en = i === gaps.length - 1 ? end : gaps[i + 1]!.spokenSpan!.start;
        return { startTime: round3(st), duration: round3(Math.max(0, en - st)) };
      })
    : splitRegionByCharCount(gaps.map(g => ({ text: g.text })), start, end);

  // 3b — THE MERGE RULE, decided on the ACTUAL pieces. If any one piece would
  // land below the frame floor, the whole cluster becomes a single slot rather
  // than emitting a mix of usable segments and unselectable slivers. Tested
  // here, after the pieces exist, rather than on an estimated per-piece share:
  // a share can clear the floor while a real piece does not (character
  // weighting and token attribution both divide unevenly), and it is the real
  // piece the user has to click on.
  if (gaps.length > 1 && pieces.some(pc => pc.duration < floor)) {
    return {
      merged: true,
      region,
      segments: [makeRestoredSegment(makeSliceSegmentId(hostId, MERGE_SLOT_ORDINAL), gaps.map(g => g.text).join(' '), start, end - start)],
    };
  }

  return {
    merged: false,
    region,
    segments: gaps.map((g, i) => makeRestoredSegment(g.segmentId, g.text, pieces[i]!.startTime, pieces[i]!.duration)),
  };
}

/**
 * Applies a restore for one cluster hosted on `segments[hostIndex]` to the
 * FULL committed segments array, returning a new array. `gapsToRestore` must
 * be a subset (or all) of `segments[hostIndex].absorbedGaps` sharing one
 * span. Preserves Model P (gapless partition) around the edit.
 *
 * TWO DIRECTIONS (WS2 ws2-25 Commit 3, Bug 1). Which one applies is the
 * cluster's own recorded `hostSide`, not an assumption:
 *
 * `'after'` — the ordinary case. The gap follows its host:
 *   - the host shrinks to end exactly at `region.start`;
 *   - the restored piece(s) tile exactly `[region.start, region.end)`;
 *   - the FOLLOWING segment (if any) is pushed to start exactly at
 *     `region.end`, its own duration shrunk by the same delta so its end does
 *     not move (see this module's header for the known floor-collision
 *     limitation);
 *   - with no following segment (the host was last), the LAST restored piece
 *     is stretched to the host's pre-restore end instead, mirroring the "last
 *     segment runs to audioDuration" rule.
 *
 * `'before'` — a LEADING run of drops, which has no survivor before it and is
 * therefore hosted by the survivor AFTER it:
 *   - the restored piece(s) are inserted BEFORE the host;
 *   - the host's START moves forward to `region.end`, its duration shrinking
 *     by the same delta so its own end does not move;
 *   - the piece(s) begin at the host's original start when nothing precedes it
 *     (the timeline must still begin at 0 — a leading restore cannot open a
 *     hole in front of itself), otherwise the preceding segment shrinks to end
 *     at `region.start`.
 *
 * Handling `'before'` as if it were `'after'` is what collapsed a leading-run
 * host to zero duration: `region.start - host.startTime` is <= 0 there, so the
 * host's own duration floored to 0 and the pieces were inserted after it.
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

  const plan = planRestoreCluster(gapsToRestore, host.id, fps);
  if (plan.refused) return segments as VideoSegment[];
  const { end } = plan.region;
  let { start } = plan.region;

  const out = segments.map(s => ({ ...s }));
  const newHost = out[hostIndex]!;

  const restoredIds = new Set(gapsToRestore.map(g => g.segmentId));
  const remainingGaps = (newHost.absorbedGaps ?? []).filter(g => !restoredIds.has(g.segmentId));
  if (remainingGaps.length > 0) {
    newHost.absorbedGaps = remainingGaps;
  } else {
    delete newHost.absorbedGaps;
  }

  // `undefined` means a gap recorded before hostSide existed, all of which
  // were written assuming the gap follows its host.
  const hostSide = gapsToRestore[0]!.hostSide ?? 'after';
  let restored = plan.segments;

  if (hostSide === 'before') {
    const oldHostStart = newHost.startTime;
    const prev = hostIndex > 0 ? out[hostIndex - 1] : undefined;
    if (prev) {
      prev.duration = round3(Math.max(0, start - prev.startTime));
    } else if (start > oldHostStart) {
      // Nothing precedes the host, so the pieces must begin where it began —
      // the timeline cannot start with a hole.
      const shift = round3(start - oldHostStart);
      restored = restored.map((r, i) => (i === 0
        ? { ...r, startTime: round3(oldHostStart), duration: round3(r.duration + shift) }
        : r));
      start = oldHostStart;
    }
    const delta = round3(end - oldHostStart);
    newHost.startTime = round3(end);
    newHost.duration = round3(Math.max(MIN_SEGMENT_DURATION, newHost.duration - delta));
    out.splice(hostIndex, 0, ...restored);
    return out;
  }

  const oldHostEnd = round3(newHost.startTime + newHost.duration);
  newHost.duration = round3(Math.max(0, start - newHost.startTime));

  const nextIndex = hostIndex + 1;
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
    for (const clusterGaps of clustersOf(out[hostIndex]!)) {
      const toRestore = clusterGaps.filter(g => gapSegmentIds.has(g.segmentId));
      if (toRestore.length > 0) {
        out = applyRestoreToSegments(out, hostIndex, toRestore, fps);
      }
    }
  }
  return out;
}

/** Groups one host's `absorbedGaps` into same-span clusters, in host order. A
 *  host can carry more than one independent cluster (different drop runs over
 *  the project's lifetime), and restoring one must never disturb another. */
function clustersOf(host: VideoSegment): AbsorbedGap[][] {
  const gaps = host.absorbedGaps;
  if (!gaps || gaps.length === 0) return [];
  const bySpanKey = new Map<string, AbsorbedGap[]>();
  for (const g of gaps) {
    const key = `${g.span.start}|${g.span.end}`;
    const arr = bySpanKey.get(key);
    if (arr) arr.push(g); else bySpanKey.set(key, [g]);
  }
  return [...bySpanKey.values()];
}

/**
 * How many clusters a `restoreSegmentsByGapId` call would REFUSE. Called on
 * the pre-restore array (the same one handed to that function) so the caller
 * can tell the user why nothing moved — an ignored restore and a broken one
 * are indistinguishable from the outside otherwise. Pure; changes nothing.
 */
export function countRefusedRestores(
  segments: readonly VideoSegment[],
  gapSegmentIds: ReadonlySet<string>,
  fps: number,
): number {
  if (gapSegmentIds.size === 0) return 0;
  let refused = 0;
  for (const host of segments) {
    for (const clusterGaps of clustersOf(host)) {
      const toRestore = clusterGaps.filter(g => gapSegmentIds.has(g.segmentId));
      if (toRestore.length > 0 && planRestoreCluster(toRestore, host.id, fps).refused) refused++;
    }
  }
  return refused;
}
