/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T2.1 — gap-absorption info for the sync log.
//
// `filterToCoveredSegments` (App.tsx) drops a scene R4-1/R.10 could not place
// on the timeline; `snapCoveredBoundaries` (snapBoundaries.ts) then re-derives
// the shared boundary between the two SURVIVORS on either side of the drop
// from their own spoken-word edges, so the dropped scene's time is silently
// folded into whichever survivor now owns more of that span. This module
// computes exactly which survivor absorbed which drop and how wide/what-kind
// the reclaimable span was, purely so `App.tsx` can report it accurately in
// the sync log (the "S{n} / Clip {n} skipped — absorbed X -> Y -> Z" line and
// the "Jump to absorbing scene" deep link).
//
// REMOVED (WS2 ws2-26, round 1 of the operator's revert request): this used
// to also drive a restore UI that recreated a dropped scene from its
// absorbed span, sized either from real orphan transcript tokens or, failing
// that, character-weighted guesswork. The operator found the guessed
// durations inaccurate enough to require manual adjustment anyway and asked
// for the whole restore feature removed — recovering a dropped scene is now
// a manual `S` (split) + retype on the absorbing clip, not an automated
// reconstruction. This module keeps only the read-only reporting half.
//
// A1 — THE SPAN IS THE RECLAIMABLE REGION, NOT THE COMMITTED BOUNDARY.
// `snapCoveredBoundaries` writes ONE boundary somewhere inside
// [prevSurvivor's last spoken word end, nextSurvivor's first spoken word
// start] (a silence centre when one qualifies, the midpoint otherwise) — that
// single point is not where the dropped scene's own audio actually was. The
// span recorded here is the WHOLE interval, computed independently of
// whatever `snapCoveredBoundaries` decided, from the same real token edges.
//
// A GAP WITH NO REAL SURVIVOR ON ONE SIDE (a leading or trailing run of
// drops) is hosted by whichever survivor DOES exist (the next one for a
// leading run, the previous one for a trailing run) — the only side
// `headExtendFirstSegment`/the last-survivor-to-audioDuration rule actually
// stretches to cover it.
// ---------------------------------------------------------------------------

import type { TranscriptToken } from '../types';
import type { SegmentAlignment } from './whisperService';
import type { SilenceInterval } from './silenceDetector';

function round3(v: number): number {
  return Number(v.toFixed(3));
}

/** One dropped scene, as `filterToCoveredSegments` recorded it — only the
 *  field this module actually needs, so it doesn't import `App.tsx`'s full
 *  `SkippedSegmentRecord` (which would be a cycle: App.tsx imports this
 *  module). */
export interface AbsorbedGapSkipInput {
  segmentIndex: number;
}

/**
 * Classifies a reclaimable span by how much of it real detected silence
 * covers. A majority-overlap rule (>= 50%), not a value fitted to any
 * specific corpus row: the natural threshold for "mostly one or the other",
 * picked before this module had any test data to fit against.
 *
 * 'unknown' when the span is degenerate (end <= start) or when no silence
 * data exists at all for this run (the no-tokens fallback path, or a corpus
 * with zero detected silences) — there is nothing to test overlap against,
 * so no claim about the audio there can be made rather than a false 'speech'.
 */
export function classifyGapAudio(
  spanStart: number,
  spanEnd: number,
  silences: readonly SilenceInterval[],
): 'silent' | 'speech' | 'unknown' {
  const spanDuration = spanEnd - spanStart;
  if (spanDuration <= 0 || silences.length === 0) return 'unknown';

  let overlap = 0;
  for (const s of silences) {
    const os = Math.max(spanStart, s.startSec);
    const oe = Math.min(spanEnd, s.endSec);
    if (oe > os) overlap += oe - os;
  }
  return overlap / spanDuration >= 0.5 ? 'silent' : 'speech';
}

/** One dropped scene's absorption info — the sync log's own read model, not
 *  a persisted VideoSegment field (nothing stores this on a segment any
 *  more; it is recomputed fresh every Apply Sync run and consumed
 *  immediately while building that run's skip-log entries). */
export interface AbsorbedGap {
  /** The dropped scene's own stable content-derived id (segmentId.ts) —
   *  assigned before it was ever dropped — used to match this record back
   *  to its `SkippedSegmentRecord` by id by the caller. */
  segmentId: string;
  span: { start: number; end: number };
  /** Whether the reclaimable region was mostly silence, mostly real speech
   *  (e.g. a rescued utterance too short/uncertain to commit its own
   *  segment), or unclassifiable (no silence-detection data available for
   *  this run — the no-transcript/no-tokens fallback path). */
  gapAudio: 'silent' | 'speech' | 'unknown';
  /** The id of the survivor on the OTHER side of the gap from `hostId` (the
   *  Map key this entry sits under) — undefined for a leading/trailing run,
   *  where only one survivor exists at all. `snapCoveredBoundaries` actually
   *  writes ONE boundary shared by both neighbours (WS2 ws2-22's
   *  shared-split-point finding), so a "middle" gap's reclaimable span can
   *  end up split across both — this is who the minority side is, purely so
   *  the caller can decide whether that split is worth a note. Reporting-only,
   *  same as every other field here; carries no timing of its own. */
  otherNeighborId?: string;
}

/**
 * Computes every absorbed-gap report for one Apply Sync run, keyed by the id
 * of the SURVIVING segment hosting each gap — read-only reporting data for
 * the sync log, never persisted onto a segment.
 *
 * `preFilterSegments`/`skipped` describe the run before `filterToCoveredSegments`
 * dropped anything; `keptIds`/`keptAlignments` are index-parallel arrays
 * describing the survivors (`keptIds[i]` is `keptAlignments[i]`'s segment's
 * id — both come out of that same filter call, same convention
 * `snapCoveredBoundaries` uses for `kept`/`keptAlignments`). `tokens`/
 * `silences` are the run's own transcript tokens and detected silences —
 * pass `[]` for either when unavailable (the no-transcript fallback path);
 * the span then falls back to the dropped run's own recorded start/end and
 * `gapAudio` reports 'unknown'.
 *
 * WORD SOURCE CONTRACT — `tokens` must be THE SAME ARRAY the alignment that
 * produced `keptAlignments` ran against (App.tsx passes `aligned.tokens`,
 * which is FA's words on the FA arm and Whisper's on the Whisper arm). Every
 * span below is built by dereferencing `keptAlignments[i].lastTokenIdx` /
 * `.firstTokenIdx` INTO `tokens`; those are positional indices into that one
 * array and carry no identity of their own, so handing this function a
 * different token array (even the unfiltered original of the same arm) reads
 * the wrong tokens and mis-measures every span without erroring.
 *
 * Pure — no I/O, does not mutate any input.
 */
export function computeAbsorbedGaps(
  preFilterSegments: readonly { id: string; startTime: number; duration: number }[],
  skipped: readonly AbsorbedGapSkipInput[],
  keptIds: readonly string[],
  keptAlignments: readonly SegmentAlignment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
): Map<string, AbsorbedGap[]> {
  const result = new Map<string, AbsorbedGap[]>();
  if (skipped.length === 0) return result;

  const skippedByIndex = new Map(skipped.map(s => [s.segmentIndex, s]));

  let keptCursor = 0; // 0-based index of the NEXT (not-yet-visited) kept segment.
  let i = 0;
  while (i < preFilterSegments.length) {
    if (!skippedByIndex.has(i)) {
      keptCursor++;
      i++;
      continue;
    }

    // A run of one or more consecutive dropped indices sharing one gap.
    const runIndices: number[] = [];
    const runStart = i;
    while (i < preFilterSegments.length && skippedByIndex.has(i)) {
      runIndices.push(i);
      i++;
    }
    const runEnd = i; // exclusive

    const prevKeptIdx = keptCursor - 1;
    const nextKeptIdx = keptCursor < keptIds.length ? keptCursor : -1;
    // WS2 ws2-27 — the NEXT survivor hosts a middle run, not the previous one.
    // Measured directly against both real corpora (v6 S27-29, 173 S112): the
    // previous survivor is often a NET LOSER of duration once
    // snapCoveredBoundaries writes its shared boundary (v6: -0.17s), while the
    // next survivor is the one that actually gains materially in every
    // observed case (v6 +0.41s, 173 +1.79s) — "prev absorbed it" was simply
    // the wrong guess, not an equally-valid alternative convention. A leading
    // run (no prev) already resolved to next; this only changes the middle-run
    // case. A trailing run (no next) still falls back to prev — that's the
    // only survivor that exists.
    const hostKeptIdx = nextKeptIdx >= 0 ? nextKeptIdx : prevKeptIdx;
    if (hostKeptIdx < 0) continue; // no survivor exists at all — nothing to host this gap.

    const otherKeptIdx = hostKeptIdx === nextKeptIdx ? prevKeptIdx : nextKeptIdx;
    const otherNeighborId = otherKeptIdx >= 0 ? keptIds[otherKeptIdx] : undefined;

    const hostId = keptIds[hostKeptIdx]!;
    const prevAlign = prevKeptIdx >= 0 ? keptAlignments[prevKeptIdx] : undefined;
    const nextAlign = nextKeptIdx >= 0 ? keptAlignments[nextKeptIdx] : undefined;
    const runFirstSeg = preFilterSegments[runStart]!;
    const runLastSeg = preFilterSegments[runEnd - 1]!;

    const prevSpokenEnd = prevAlign ? tokens[prevAlign.lastTokenIdx]?.endSec : undefined;
    const nextSpokenStart = nextAlign ? tokens[nextAlign.firstTokenIdx]?.startSec : undefined;

    const spanStart = prevSpokenEnd ?? runFirstSeg.startTime;
    const spanEnd = nextSpokenStart ?? (runLastSeg.startTime + runLastSeg.duration);

    const gapAudio = classifyGapAudio(spanStart, spanEnd, silences);
    const span = { start: round3(spanStart), end: round3(Math.max(spanStart, spanEnd)) };

    const gaps: AbsorbedGap[] = runIndices.map(idx => ({
      segmentId: preFilterSegments[idx]!.id,
      span,
      gapAudio,
      otherNeighborId,
    }));

    const existing = result.get(hostId);
    result.set(hostId, existing ? [...existing, ...gaps] : gaps);
  }

  return result;
}

/**
 * Measures how much duration the OTHER (non-host) neighbour actually gained
 * from `snapCoveredBoundaries`'s single shared boundary write for this gap —
 * isolated to the one edge it shares with the host, never its own unrelated
 * far edge (which can move independently, from ITS own next-door pair's snap,
 * and would otherwise contaminate this measurement).
 *
 * `preSnap`/`postSnap` are the same segment shape before/after that boundary
 * write — App.tsx's `kept` (pre-`snapCoveredBoundaries`) and
 * `finalTimedSegments` (post-`snapCoveredBoundaries`/`headExtendFirstSegment`).
 * Returns undefined when either snapshot is missing one of the two ids
 * (defensive only — both should always be present for an id this module
 * itself produced from the same run's `kept` array).
 *
 * Pure — no I/O, does not mutate any input.
 */
export function measureOtherNeighborGain(
  hostId: string,
  otherNeighborId: string,
  preSnap: readonly { id: string; startTime: number; duration: number }[],
  postSnap: readonly { id: string; startTime: number; duration: number }[],
): number | undefined {
  const hostPre = preSnap.find(s => s.id === hostId);
  const otherPre = preSnap.find(s => s.id === otherNeighborId);
  const otherPost = postSnap.find(s => s.id === otherNeighborId);
  if (!hostPre || !otherPre || !otherPost) return undefined;

  const otherIsBeforeHost = otherPre.startTime < hostPre.startTime;
  return otherIsBeforeHost
    ? round3((otherPost.startTime + otherPost.duration) - (otherPre.startTime + otherPre.duration))
    : round3(otherPre.startTime - otherPost.startTime);
}
