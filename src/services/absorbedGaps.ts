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
import { canonicalize } from './textNormalize';
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

/** One dropped scene's own share of a cluster's orphan-token region. */
export interface OrphanRegion {
  /** Index into the cluster's own `runRecords` order. */
  pieceIndex: number;
  start: number;
  end: number;
}

/**
 * WS2 session ws2-25 Commit 2 — THE ORPHAN TOKENS INSIDE ONE ABSORBED SPAN.
 *
 * "Orphan" = a transcript token strictly between the previous survivor's LAST
 * matched token and the next survivor's FIRST matched token. Selected in INDEX
 * space (`lastTokenIdx + 1 .. firstTokenIdx - 1`), never by timestamp
 * proximity to the span bounds — CLAUDE.md's standing rule: timestamps may
 * measure distance, they must never decide identity. A token's membership in
 * the gap is settled by the alignment's own ordinals, which is exactly what
 * makes it an orphan (no segment's alignment claimed it).
 *
 * With no previous survivor (a LEADING run of drops) the scan starts at token
 * 0; with no next survivor (a TRAILING run) it runs to the end of the array.
 */
export function collectOrphanTokens(
  tokens: readonly TranscriptToken[],
  prevLastTokenIdx: number | undefined,
  nextFirstTokenIdx: number | undefined,
): TranscriptToken[] {
  if (tokens.length === 0) return [];
  const from = prevLastTokenIdx === undefined ? 0 : prevLastTokenIdx + 1;
  const to = nextFirstTokenIdx === undefined ? tokens.length : nextFirstTokenIdx;
  const out: TranscriptToken[] = [];
  for (let t = Math.max(0, from); t < Math.min(tokens.length, to); t++) {
    const tok = tokens[t];
    if (tok) out.push(tok);
  }
  return out;
}

/**
 * Attributes each orphan token to one of the cluster's dropped scenes by
 * MATCHING TOKEN TEXT TO SCRIPT TEXT, monotonically: scene i's tokens must all
 * precede scene i+1's. Returns `null` when a clean monotone attribution cannot
 * be made (any scene would get zero tokens, or the texts simply do not line
 * up) — the caller then falls back to character-weighted division of the same
 * orphan region, which is the honest answer when the transcript does not say
 * which scene owns what.
 *
 * A single-scene cluster is the trivial case and always succeeds: every orphan
 * token belongs to the one scene there is.
 */
export function attributeOrphansByText(
  orphans: readonly TranscriptToken[],
  pieceTexts: readonly string[],
): number[] | null {
  if (orphans.length === 0 || pieceTexts.length === 0) return null;
  if (pieceTexts.length === 1) return orphans.map(() => 0);

  // One canonical word list per scene, and one canonical form per orphan token.
  const pieceWords = pieceTexts.map(t => canonicalize(t));
  const orphanWords = orphans.map(o => canonicalize(o.text)[0] ?? '');

  const assignment: number[] = new Array(orphans.length).fill(-1);
  let piece = 0;
  let wordCursor = 0;
  let assignedInPiece = 0;
  let textHits = 0;

  for (let i = 0; i < orphans.length; i++) {
    const w = orphanWords[i];
    if (!w) { assignment[i] = piece; continue; }

    // Advance past scenes this token cannot belong to, but only once the
    // current scene has actually taken something — never skip a scene empty.
    while (piece < pieceWords.length - 1) {
      const remaining = pieceWords[piece]!.slice(wordCursor);
      if (remaining.includes(w)) break;
      if (assignedInPiece === 0) break; // would leave this scene with nothing
      piece++;
      wordCursor = 0;
      assignedInPiece = 0;
    }

    const remaining = pieceWords[piece]!.slice(wordCursor);
    const hit = remaining.indexOf(w);
    if (hit >= 0) {
      wordCursor += hit + 1;
      textHits++;
    }
    assignment[i] = piece;
    assignedInPiece++;
  }

  // At least one orphan token must genuinely match the script. Without a
  // single hit this walk has only chopped the tokens by POSITION and calling
  // that a text attribution would overstate what the transcript said — the
  // caller's character-weighted fallback is the honest answer instead.
  if (textHits === 0) return null;

  // Every scene must have received at least one token for this to be an
  // attribution rather than a guess.
  const counts = new Array(pieceTexts.length).fill(0) as number[];
  for (const a of assignment) {
    if (a < 0) return null;
    counts[a] = (counts[a] ?? 0) + 1;
  }
  if (counts.some(c => c === 0)) return null;
  return assignment;
}

/**
 * Divides a cluster's orphan-token region among its dropped scenes, producing
 * one contiguous `[start, end)` per scene covering exactly
 * `[firstOrphanStart, lastOrphanEnd)`. Text attribution first (above);
 * character-weighted division of the same region when that declines.
 *
 * Returns `[]` when there are no orphan tokens — the caller must then decide
 * what to do with a gap the transcript says nothing about (see
 * `absorbedGapRestore.ts`'s refusal rule), rather than inventing a duration.
 */
export function computeOrphanRegions(
  orphans: readonly TranscriptToken[],
  pieceTexts: readonly string[],
): OrphanRegion[] {
  if (orphans.length === 0 || pieceTexts.length === 0) return [];
  const regionStart = orphans[0]!.startSec;
  const regionEnd = Math.max(regionStart, orphans[orphans.length - 1]!.endSec);

  const assignment = attributeOrphansByText(orphans, pieceTexts);
  if (assignment) {
    // Scene boundaries land on the ONSET of the first token of the next scene,
    // so no scene is credited with speech that is audibly the next scene's.
    const firstTokenOf = new Map<number, number>();
    for (let i = 0; i < assignment.length; i++) {
      const p = assignment[i]!;
      if (!firstTokenOf.has(p)) firstTokenOf.set(p, i);
    }
    const out: OrphanRegion[] = [];
    for (let p = 0; p < pieceTexts.length; p++) {
      const startIdx = firstTokenOf.get(p);
      if (startIdx === undefined) return charWeightedOrphanRegions(pieceTexts, regionStart, regionEnd);
      const nextIdx = firstTokenOf.get(p + 1);
      const start = p === 0 ? regionStart : orphans[startIdx]!.startSec;
      const end = nextIdx === undefined ? regionEnd : orphans[nextIdx]!.startSec;
      out.push({ pieceIndex: p, start: round3(start), end: round3(Math.max(start, end)) });
    }
    return out;
  }

  return charWeightedOrphanRegions(pieceTexts, regionStart, regionEnd);
}

function charWeightedOrphanRegions(
  pieceTexts: readonly string[], regionStart: number, regionEnd: number,
): OrphanRegion[] {
  const counts = pieceTexts.map(t => t.length);
  const total = counts.reduce((a, b) => a + b, 0);
  const width = Math.max(0, regionEnd - regionStart);
  const out: OrphanRegion[] = [];
  let cursor = regionStart;
  for (let p = 0; p < pieceTexts.length; p++) {
    const isLast = p === pieceTexts.length - 1;
    const share = total > 0 ? width * (counts[p]! / total) : width / pieceTexts.length;
    const start = cursor;
    const end = isLast ? regionEnd : start + share;
    out.push({ pieceIndex: p, start: round3(start), end: round3(Math.max(start, end)) });
    cursor = end;
  }
  return out;
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

    // WS2 session ws2-25 Commit 2 — what the transcript actually recorded
    // inside this span, and which dropped scene owns each part of it. Selected
    // by TOKEN INDEX (see `collectOrphanTokens`), so a token that merely sits
    // near a span bound in time is never mistaken for one inside it.
    const orphans = collectOrphanTokens(tokens, prevAlign?.lastTokenIdx, nextAlign?.firstTokenIdx);
    const orphanRegions = computeOrphanRegions(orphans, runRecords.map(r => r.segmentText));

    const gaps: AbsorbedGap[] = runRecords.map((r, pieceIndex) => {
      const region = orphanRegions[pieceIndex];
      return {
        segmentId: preFilterSegments[r.segmentIndex]!.id,
        text: r.segmentText,
        span,
        gapAudio,
        orphanCount: orphans.length,
        ...(region ? { spokenSpan: { start: region.start, end: region.end } } : {}),
      };
    });

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
