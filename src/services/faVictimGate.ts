/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 1 hotfix, FIX 1 REDO — FA VICTIM RE-TIMING (Option A, armored).
//
// WHAT WAS WRONG (a80cc74's FIX 1 did not cover this). R.10
// (`faUnspokenGate.ts`) only catches a segment Whisper itself refused
// (`matched === false`). A segment whose script text WAS genuinely spoken but
// whose FA chunk was CTC-infeasible (`faInfeasibleFinding.ts`, plan-v3 item 6)
// stays `matched: true` — Whisper attests it, so R.10 correctly does not drop
// it — but its committed FA word timings are `fallback_words_for_infeasible_
// chunk`'s even-spread fabrication (`fa_onnx.rs`), not a real alignment. That
// segment is a VICTIM: genuinely spoken, fabricated timing.
//
// DETECTION. A covered (matched, non-R.10-skipped) segment whose committed
// FA token span (`coverage[i].firstTokenIdx..lastTokenIdx`, read against the
// SAME filtered token array those indices address) overlaps an infeasible
// chunk's window — the exact predicate `faInfeasibleFinding.ts`'s
// `estimatedTokensInInfeasibleChunks` already uses, at segment-span
// granularity instead of per-word.
//
// REPLACEMENT TIMING. NO NEW COMPUTE: `faUnspokenGate.ts`'s
// `detectUnspokenScriptSegmentsFromWhisperFull` already derives a full,
// index-parallel Whisper-space `SegmentAlignment[]` for every segment and
// used to discard it for anything not flagged unspoken. That is the victim's
// own trusted evidence — first/last matched Whisper token's start/end become
// the TRUSTED SPAN, and the victim's fabricated FA words are re-timed
// proportionally across it (identical technique to
// `skippedScenePlaceholders.ts`'s `stampEstimatedWordTimings`, applied to a
// measured span instead of a computed gap-slot) and flagged
// `needsReview: true` — the SAME item-6 flag every other Estimated-timing
// consumer already reads.
//
// WHY THIS IS SAFE FOR SNAP / PLACEHOLDER / R.14-R.15 WITHOUT TOUCHING THEM.
// The replacement patches TOKEN VALUES at their EXISTING array positions
// (`coverage[i].firstTokenIdx..lastTokenIdx`) — it never renumbers or
// reorders anything, so every index-parallel consumer downstream
// (`snapCoveredBoundaries`, `insertSkippedScenePlaceholders`,
// `faAnchorTrustGate.ts`'s R.14/R.15) keeps reading the SAME indices into the
// SAME array and, by construction, now finds trusted (victim-replaced or
// healthy-FA) boundary timestamps there instead of fabricated ones — never a
// second, differently-indexed token array mixed into one call (the hazard
// `faAnchorTrustGate.ts`'s own doc comment warns about).
//
// RUN-LEVEL EDGE (item 4). When EVERY covered segment in the run is a victim
// candidate (its span overlaps an infeasible chunk), there is no healthy FA
// timing left to anchor ANYTHING against — that is a run-level failure, not a
// per-segment degradation, and must pause-and-ask (`allCoveredSegmentsAre
// Victims` below), never silently auto-fallback. Conservative on purpose: a
// single healthy covered segment is enough to skip the pause.
// ---------------------------------------------------------------------------

import type { SegmentAlignment } from './whisperService';
import type { FaInfeasibleChunk } from './faBoundaryTypes';
import type { TranscriptToken, VideoSegment } from '../types';

const round3 = (v: number): number => Number(v.toFixed(3));

/** App-level pause reason for the run-level victim edge (item 4). Distinct
 *  from `forcedAlignmentRun.ts`'s `FaFailureKind` — that union is exhaustive
 *  over `runForcedAlignmentForSync`'s OWN return-on-failure sites (its own
 *  doc comment says so); this pause is decided later, in `App.tsx`'s sync
 *  pipeline, AFTER a `'degraded'`/`'ctc-infeasible-chunk'` FA run already
 *  completed and produced tokens — never a bail-out inside that function.
 *  `faSyncPauseStore.ts` and `SyncPausedDialog` widen to
 *  `FaFailureKind | FaVictimPauseReason` to carry it through the SAME
 *  restart-safe pause-and-ask machinery every other typed pause uses. */
export type FaVictimPauseReason = 'all-covered-fabricated';

/** One covered segment whose committed FA span overlaps an infeasible chunk —
 *  the candidate set the run-level check (item 4) counts, whether or not a
 *  Whisper-space replacement was available for it. */
export interface FaVictimCandidate {
  /** Index into the PRE-filter segments array — same space
   *  `UnspokenScriptFinding.segmentIndex` uses. */
  segmentIndex: number;
  segmentId: string;
  segmentTag?: string;
}

/** A candidate that WAS successfully re-timed from its own Whisper-space
 *  alignment. */
export interface FaVictimFinding extends FaVictimCandidate {
  trustedStartSec: number;
  trustedEndSec: number;
  /** How many of this segment's FA words were re-timed and flagged
   *  Estimated. */
  estimatedWordCount: number;
}

export interface FaVictimRetimeResult {
  candidates: FaVictimCandidate[];
  retimed: FaVictimFinding[];
  /** Old token object -> retimed token object. Apply to BOTH the filtered
   *  committed token array (the `tokens` argument's own array, so the snap /
   *  placeholder / R.14-R.15 stages downstream read trusted values) and
   *  `faWordTimings` (the persisted array), same join-by-identity-then-
   *  wordIndex pattern `stampEstimatedWordTimings` already uses. */
  replacement: Map<TranscriptToken, TranscriptToken>;
  replacementByWordIndex: Map<number, TranscriptToken>;
}

/**
 * Detects FA victims and computes their replacement timing. Pure — never
 * mutates its inputs; `applyVictimReplacement` below does the actual
 * substitution.
 *
 * `coverage` is the POST-R.10-gate coverage array (pre-filter index space —
 * same space `segments` uses). `tokens` is the SAME filtered committed FA
 * token array `coverage[i].firstTokenIdx/lastTokenIdx` index into (i.e.
 * `aligned.tokens`, App.tsx's own naming). `whisperAlignments`/
 * `whisperTokensFiltered` are `detectUnspokenScriptSegmentsFromWhisperFull`'s
 * OWN already-computed Whisper-space alignment and its filtered token array —
 * no second alignment pass. `unspokenIndices` is R.10's own flagged set: a
 * segment R.10 already dropped is not a victim, it is a skip.
 */
export function detectAndRetimeFaVictims(
  segments: readonly VideoSegment[],
  coverage: readonly SegmentAlignment[],
  tokens: readonly TranscriptToken[],
  infeasibleChunks: readonly FaInfeasibleChunk[],
  whisperAlignments: readonly SegmentAlignment[],
  whisperTokensFiltered: readonly TranscriptToken[],
  unspokenIndices: ReadonlySet<number>,
): FaVictimRetimeResult {
  const candidates: FaVictimCandidate[] = [];
  const retimed: FaVictimFinding[] = [];
  const replacement = new Map<TranscriptToken, TranscriptToken>();
  const replacementByWordIndex = new Map<number, TranscriptToken>();
  if (infeasibleChunks.length === 0) return { candidates, retimed, replacement, replacementByWordIndex };

  for (let i = 0; i < segments.length; i++) {
    if (unspokenIndices.has(i)) continue;
    const cov = coverage[i];
    if (!cov || cov.matched !== true) continue;
    if (cov.firstTokenIdx < 0 || cov.lastTokenIdx < cov.firstTokenIdx) continue;

    const segStart = tokens[cov.firstTokenIdx]?.startSec;
    const segEnd = tokens[cov.lastTokenIdx]?.endSec;
    if (segStart === undefined || segEnd === undefined) continue;
    const overlapsInfeasible = infeasibleChunks.some(c => segStart < c.endSec && segEnd > c.startSec);
    if (!overlapsInfeasible) continue;

    const seg = segments[i]!;
    candidates.push({ segmentIndex: i, segmentId: seg.id, segmentTag: seg.tag || undefined });

    // Genuinely-spoken evidence: R.10's own discarded Whisper-space
    // alignment for this same segment. No usable evidence means no safe
    // replacement — leave it fabricated (still flagged Estimated by item 6's
    // existing `needsReview` stamp on the FA fallback words themselves); it
    // still counts as a candidate for the run-level check above.
    const wAlign = whisperAlignments[i];
    if (!wAlign || wAlign.firstTokenIdx < 0 || wAlign.lastTokenIdx < wAlign.firstTokenIdx) continue;
    const trustedStart = whisperTokensFiltered[wAlign.firstTokenIdx]?.startSec;
    const trustedEnd = whisperTokensFiltered[wAlign.lastTokenIdx]?.endSec;
    if (trustedStart === undefined || trustedEnd === undefined || trustedEnd <= trustedStart) continue;

    const slice = tokens.slice(cov.firstTokenIdx, cov.lastTokenIdx + 1);
    if (slice.length === 0) continue;
    const weights = slice.map(t => Math.max(1, t.text.length));
    const total = weights.reduce((a, b) => a + b, 0);
    const span = trustedEnd - trustedStart;
    let cursor = trustedStart;
    slice.forEach((t, k) => {
      const end = k === slice.length - 1 ? trustedEnd : round3(cursor + span * (weights[k]! / total));
      const retimedToken: TranscriptToken = { ...t, startSec: cursor, endSec: end, needsReview: true };
      replacement.set(t, retimedToken);
      if (typeof t.wordIndex === 'number') replacementByWordIndex.set(t.wordIndex, retimedToken);
      cursor = end;
    });

    retimed.push({
      segmentIndex: i,
      segmentId: seg.id,
      segmentTag: seg.tag || undefined,
      trustedStartSec: trustedStart,
      trustedEndSec: trustedEnd,
      estimatedWordCount: slice.length,
    });
  }

  return { candidates, retimed, replacement, replacementByWordIndex };
}

/** Applies a victim replacement map to a token array — same join-by-identity-
 *  then-wordIndex-fallback shape `stampEstimatedWordTimings` uses, so it
 *  applies equally to the filtered committed array (`aligned.tokens`) and to
 *  `faWordTimings` (which may be the unfiltered array; `wordIndex` is the
 *  join key that survives filtering). Returns the SAME array reference when
 *  there is nothing to replace. */
export function applyVictimReplacement(
  tokens: readonly TranscriptToken[],
  replacement: ReadonlyMap<TranscriptToken, TranscriptToken>,
  replacementByWordIndex: ReadonlyMap<number, TranscriptToken>,
): TranscriptToken[] {
  if (replacement.size === 0) return tokens as TranscriptToken[];
  return tokens.map(t =>
    replacement.get(t)
      ?? (typeof t.wordIndex === 'number' ? replacementByWordIndex.get(t.wordIndex) : undefined)
      ?? t,
  );
}

/** Item 4's run-level edge: true only when there is at least one covered
 *  segment AND every one of them is a victim candidate. A run with zero
 *  covered segments is the coverage gate's own problem (`evaluateCoverageGate`
 *  aborts earlier) — never this check's to decide. */
export function allCoveredSegmentsAreVictims(
  coverage: readonly SegmentAlignment[],
  candidates: readonly FaVictimCandidate[],
): boolean {
  const coveredCount = coverage.filter(c => c?.matched === true).length;
  return coveredCount > 0 && candidates.length === coveredCount;
}
