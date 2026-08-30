/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T2.1 — gap-absorption metadata.
//
// `filterToCoveredSegments` (App.tsx) drops a scene R4-1/R.10 could not place
// on the timeline; `snapCoveredBoundaries` (snapBoundaries.ts) then re-derives
// the shared boundary between the two SURVIVORS on either side of the drop
// from their own spoken-word edges, so the dropped scene's time is silently
// folded into whichever survivor now owns more of that span. This module
// records what got folded in and where, so a later restore/split UI
// (Commits 3-4) can recreate the dropped scene without re-running sync.
//
// A1 — THE SPAN IS THE RECLAIMABLE REGION, NOT THE COMMITTED BOUNDARY.
// `snapCoveredBoundaries` writes ONE boundary somewhere inside
// [prevSurvivor's last spoken word end, nextSurvivor's first spoken word
// start] (a silence centre when one qualifies, the midpoint otherwise) — that
// single point is not where the dropped scene's own audio actually was. The
// span recorded here is the WHOLE interval, computed independently of
// whatever `snapCoveredBoundaries` decided, from the same real token edges.
//
// A2 — gapAudio IS COMPUTED HERE AND PERSISTED, NEVER RE-DERIVED LATER.
// Detected silences are a live artifact of one sync run (`aligned.silences`)
// and are never saved with the project, so classifying "was this gap mostly
// silence or mostly speech" must happen now, at absorption time, while the
// silence array still exists — a restore built months later has no silence
// data left to consult.
//
// A GAP WITH NO REAL SURVIVOR ON ONE SIDE (a leading or trailing run of
// drops) is hosted by whichever survivor DOES exist (the next one for a
// leading run, the previous one for a trailing run) — the only side
// `headExtendFirstSegment`/the last-survivor-to-audioDuration rule actually
// stretches to cover it. This host choice is a design decision made without
// corpus verification (no such run has been ear-audited); flagged here
// rather than silently assumed correct.
// ---------------------------------------------------------------------------

import type { AbsorbedGap, TranscriptToken, VideoSegment } from '../types';
import type { SegmentAlignment } from './whisperService';
import type { SilenceInterval } from './silenceDetector';

function round3(v: number): number {
  return Number(v.toFixed(3));
}

/** One dropped scene, as `filterToCoveredSegments` recorded it — only the
 *  fields this module actually needs, so it doesn't import `App.tsx`'s full
 *  `SkippedSegmentRecord` (which would be a cycle: App.tsx imports this
 *  module). `reason` is intentionally untyped as a bare string here — this
 *  module never branches on which skip reason it was. */
export interface AbsorbedGapSkipInput {
  segmentIndex: number;
  segmentText: string;
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
): AbsorbedGap['gapAudio'] {
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

/**
 * Computes every absorbed-gap record for one Apply Sync run, keyed by the
 * id of the SURVIVING segment hosting each gap.
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
  preFilterSegments: readonly VideoSegment[],
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
    const runRecords: AbsorbedGapSkipInput[] = [];
    const runStart = i;
    while (i < preFilterSegments.length && skippedByIndex.has(i)) {
      runRecords.push(skippedByIndex.get(i)!);
      i++;
    }
    const runEnd = i; // exclusive

    const prevKeptIdx = keptCursor - 1;
    const nextKeptIdx = keptCursor < keptIds.length ? keptCursor : -1;
    const hostKeptIdx = prevKeptIdx >= 0 ? prevKeptIdx : nextKeptIdx;
    if (hostKeptIdx < 0) continue; // no survivor exists at all — nothing to host this gap.

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

    const gaps: AbsorbedGap[] = runRecords.map(r => ({
      segmentId: preFilterSegments[r.segmentIndex]!.id,
      text: r.segmentText,
      span,
      gapAudio,
    }));

    const existing = result.get(hostId);
    result.set(hostId, existing ? [...existing, ...gaps] : gaps);
  }

  return result;
}

/** Merges computed absorbed-gap records onto the final committed segments by
 *  id. Pure — returns a new array; a segment with no gaps to host is
 *  returned unchanged (same reference), so callers that compare by
 *  reference elsewhere aren't disturbed. */
export function applyAbsorbedGaps(
  segments: readonly VideoSegment[],
  gapsByHostId: ReadonlyMap<string, AbsorbedGap[]>,
): VideoSegment[] {
  if (gapsByHostId.size === 0) return segments as VideoSegment[];
  return segments.map(s => {
    const gaps = gapsByHostId.get(s.id);
    return gaps ? { ...s, absorbedGaps: gaps } : s;
  });
}
