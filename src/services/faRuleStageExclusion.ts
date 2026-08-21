/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// BOTH SIDES (ruling R-AO). This invariant constrains a boundary's movement in
// BOTH directions across a run edge, and both directions are live:
//
//   OUT OF A RUN — the measured case. R.11 moved `266_forty_one_burden` from
//     790.33 (inside R.5 run 6) to 792.18 (past its end), dumping the whole
//     recitation into the previous scene. Clause (1) declines it.
//   INTO A RUN — the mirror, and NOT hypothetical: R.12's own header records
//     that dropping its clamp puts corrected values back inside runs on four
//     of nine rows, and `faSeamFitGate.ts` re-anchors to a chunk EDGE, which
//     can sit on either side of a run. Clause (2) declines that direction with
//     the same test, because `runEdgeCrossed` is written direction-agnostic
//     (`Math.min`/`Math.max`, not "target > origin") and is asserted to be so
//     in `faRuleStageExclusion.test.ts`'s geometry block.
//
// A version of this rule that only stopped the measured direction would be
// exactly the half-built shape R-AO exists to prevent.
//
// R-AP — THE RUN-EDGE EXCLUSION INVARIANT (WS1 Session S).
//
// THE DEFECT THAT FORCED IT, measured on the live v6 bundle. R.5 run 6's
// ACOUSTIC extent — the interval every clause of this rule is stated against,
// and the one `computeRunExtents` below returns — is [789.46, 791.69]. (Its
// RAW token span is the wider [787.85, 791.94]; earlier revisions of this
// header cited that span by mistake, which is the one quantity R-AP never
// uses. WS1 Session T's onset correction moved the acoustic start from 789.26
// to 789.46; the raw span is unchanged and still irrelevant here.) The
// committed boundary for `266_forty_one_burden` came out
// of `snapCoveredBoundaries` at 790.33 — strictly INSIDE that run, which is
// precisely R.12's defect signature. But R.11 runs FIRST, saw the same
// boundary, and moved it to 792.18: PAST the run's end. The owner's ear scored
// the result MAJOR — the entire spoken recitation landed in the previous
// scene. R.12 then found nothing to do, because by the time it looked the
// boundary was no longer inside the run.
//
// TWO RULES WANTED THE SAME ROW AND ORDERING DECIDED IT SILENTLY. That is the
// root class, not the row: the rule stage applies each rule's corrections to a
// shared array in sequence, so a later rule reads an earlier rule's output as
// if it were the pipeline's own committed value, and a conflict resolves by
// whoever ran first with no record that a conflict occurred. Rebuilding the
// stage as propose-then-arbitrate is the scheduled follow-up; this module is
// the invariant that closes the hole in the meantime, and it is stated so that
// the eventual arbitrator can adopt it unchanged.
//
// THE INVARIANT, in two clauses, both evaluated against the PRE-RULE-STAGE
// ORIGIN ARRAY:
//
//   (1) OWNERSHIP. If a boundary's ORIGIN lies strictly inside an R.5
//       unscripted run, that boundary belongs to R.12 alone. Every other rule
//       must decline it.
//   (2) NO CROSSING. No rule other than R.12 may move a boundary to the far
//       side of a run edge from its ORIGIN.
//
// R.12 IS THE NAMED EXCEPTION, and only R.12, because evicting a boundary from
// a run is its entire definition: its target interval is pinned to
// `[prevToken.endSec, run.startSec]`, the gap immediately before the run, so
// its own move crosses the run's START edge by construction. Exempting it is
// not a hole — R.12's own H7 guard already forbids its corrected value landing
// inside ANY run.
//
// WHY THE ORIGIN ARRAY AND NOT THE RUNNING ONE — THE WHOLE POINT. A
// current-state check cannot see this defect. If R.11 evaluates first and moves
// the boundary out of the run, a rule that asks "is the boundary I am looking
// at inside a run?" gets a truthful NO, and R.12 correctly declines. The
// boundary is already wrong by then. The check has to be on the PAIR (origin,
// target), against the array as it stood before ANY rule in the stage ran —
// which is why `originById` is threaded in from the call site rather than read
// off whatever array a rule happens to hold.
//
// THE RUN'S EXTENT IS ITS ACOUSTIC ONE, never the raw token span
// (`acousticRunExtent`, WS1 Session P/Q) — a run whose first unclaimed token is
// the punctuation representing the pause before it reports a `startSec` pinned
// to the END of the previous word, which would make a correctly-placed
// boundary look like it were inside the run. Reading the same view R.12 and
// R.13 read is what keeps all three rules talking about the same interval.
//
// PURE. No React, no DOM, no IPC. `silenceDetector.ts`, `snapBoundaries.ts`,
// `faAnchors.ts` and the Hirschberg aligner are all untouched by this module —
// it consumes their output and nothing else.
// ---------------------------------------------------------------------------

import { computeUnscriptedRuns } from './faChunkPlan';
import { acousticRunExtent } from './faRunPlacementGate';
import type { SilenceInterval } from './silenceDetector';
import type { TranscriptToken, VideoSegment } from '../types';

/** Comparison epsilon, matching the one `faRunPlacementGate.ts` already uses
 *  for its own interior test and H7 guard. Not a tuning parameter: it exists
 *  so a boundary sitting exactly ON a run edge counts as OUTSIDE, in every
 *  rule, identically. */
const EPS = 1e-9;

/** One run's ACOUSTIC extent — the interval every clause below is stated
 *  against. */
export interface RunExtent {
  runIndex: number;
  startSec: number;
  endSec: number;
}

/** The runs' acoustic extents, derived exactly as R.12/R.13 derive them.
 *  `parsedSegments` is the COMPLETE pre-skip array (run derivation reads only
 *  segment text and order, never timing); `tokens` are the RAW Whisper tokens,
 *  the run's own index space. */
export function computeRunExtents(
  parsedSegments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
): RunExtent[] {
  return computeUnscriptedRuns(parsedSegments, tokens, silences, audioDuration).map((run, runIndex) => {
    const e = acousticRunExtent(run, tokens, silences);
    return { runIndex, startSec: e.startSec, endSec: e.endSec };
  });
}

/** The index of the run whose acoustic extent STRICTLY contains `t`, or -1. */
export function runContaining(t: number, extents: readonly RunExtent[]): number {
  for (const e of extents) if (t > e.startSec + EPS && t < e.endSec - EPS) return e.runIndex;
  return -1;
}

/** The index of a run with an edge STRICTLY between `a` and `b`, or -1.
 *  Direction-agnostic: "across" means across, in either direction. */
export function runEdgeCrossed(a: number, b: number, extents: readonly RunExtent[]): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (const e of extents) {
    if (e.startSec > lo + EPS && e.startSec < hi - EPS) return e.runIndex;
    if (e.endSec > lo + EPS && e.endSec < hi - EPS) return e.runIndex;
  }
  return -1;
}

/** The minimum shape this module needs from any rule's finding. */
export interface BoundaryProposal {
  segmentId: string;
  correctedValue: number;
}

export interface ExcludedProposal<T> {
  finding: T;
  reason: 'origin-inside-run' | 'crosses-run-edge';
  runIndex: number;
  /** The PRE-RULE-STAGE value the verdict was reached against — recorded so a
   *  log reader can check the pair themselves rather than trusting the
   *  verdict. */
  originValue: number;
}

export interface ExclusionVerdict<T> {
  kept: T[];
  excluded: ExcludedProposal<T>[];
}

/**
 * Applies R-AP to one NON-R.12 rule's findings.
 *
 * `originById` maps segment id -> the boundary's value in the pre-rule-stage
 * array. A finding whose segment is absent from that map is KEPT: an absent id
 * means the segment was dropped upstream (R.10, the coverage skip filter), and
 * the apply step is tolerant-by-id in exactly the same way — declining here
 * would be a second, silent skip of a finding that is already a no-op.
 *
 * R.12's own findings must NOT be passed through this function. It is exempt
 * by name, for the reason this file's header gives.
 */
export function excludeRunEdgeViolations<T extends BoundaryProposal>(
  findings: readonly T[],
  originById: ReadonlyMap<string, number>,
  extents: readonly RunExtent[],
): ExclusionVerdict<T> {
  const kept: T[] = [];
  const excluded: ExcludedProposal<T>[] = [];
  for (const f of findings) {
    const origin = originById.get(f.segmentId);
    if (origin === undefined) { kept.push(f); continue; }

    // (1) OWNERSHIP first, and it is checked even when the proposed move stays
    // inside the run: a boundary whose origin is inside a run is R.12's,
    // whatever anyone else would do with it.
    const inside = runContaining(origin, extents);
    if (inside >= 0) { excluded.push({ finding: f, reason: 'origin-inside-run', runIndex: inside, originValue: origin }); continue; }

    // (2) NO CROSSING.
    const crossed = runEdgeCrossed(origin, f.correctedValue, extents);
    if (crossed >= 0) { excluded.push({ finding: f, reason: 'crosses-run-edge', runIndex: crossed, originValue: origin }); continue; }

    kept.push(f);
  }
  return { kept, excluded };
}

export interface RunEdgeViolation {
  segmentId: string;
  segmentTag?: string;
  originValue: number;
  finalValue: number;
  runIndex: number;
  runStartSec: number;
  runEndSec: number;
  kind: 'moved-across-run-edge' | 'moved-out-of-r12s-run';
}

/**
 * THE PRODUCTION ASSERTION. Given the pre-rule-stage array, the fully
 * corrected array, the run extents and the set of segment ids R.12 itself
 * claimed, returns every boundary that violates R-AP. An empty array is the
 * healthy state.
 *
 * Matched BY ID, never by index — the two arrays are the same length here, but
 * an index-keyed check would silently start comparing different segments the
 * first time anything reorders, and that is the class of bug this whole file
 * exists to close.
 */
export function findRunEdgeViolations(
  originSegments: readonly VideoSegment[],
  finalSegments: readonly VideoSegment[],
  extents: readonly RunExtent[],
  r12OwnedIds: ReadonlySet<string>,
): RunEdgeViolation[] {
  if (extents.length === 0) return [];
  const originById = new Map(originSegments.map(s => [s.id, s.startTime]));
  const out: RunEdgeViolation[] = [];

  for (const s of finalSegments) {
    if (r12OwnedIds.has(s.id)) continue; // R.12 is the named exception.
    const origin = originById.get(s.id);
    if (origin === undefined) continue;
    if (Math.abs(s.startTime - origin) <= EPS) continue; // nothing moved it.

    const tag = (s as unknown as { tag?: string }).tag;
    const inside = runContaining(origin, extents);
    if (inside >= 0) {
      const e = extents.find(x => x.runIndex === inside)!;
      out.push({
        segmentId: s.id, segmentTag: tag, originValue: origin, finalValue: s.startTime,
        runIndex: inside, runStartSec: e.startSec, runEndSec: e.endSec, kind: 'moved-out-of-r12s-run',
      });
      continue;
    }
    const crossed = runEdgeCrossed(origin, s.startTime, extents);
    if (crossed >= 0) {
      const e = extents.find(x => x.runIndex === crossed)!;
      out.push({
        segmentId: s.id, segmentTag: tag, originValue: origin, finalValue: s.startTime,
        runIndex: crossed, runStartSec: e.startSec, runEndSec: e.endSec, kind: 'moved-across-run-edge',
      });
    }
  }
  return out;
}

/** One-line human summary for a console assertion / sync log. */
export function describeRunEdgeViolation(v: RunEdgeViolation): string {
  return `${v.segmentTag ?? v.segmentId}: ${v.originValue.toFixed(3)} -> ${v.finalValue.toFixed(3)} ` +
    `${v.kind === 'moved-out-of-r12s-run' ? 'ORIGIN was inside' : 'CROSSES an edge of'} ` +
    `run ${v.runIndex} [${v.runStartSec.toFixed(3)}, ${v.runEndSec.toFixed(3)}]`;
}
