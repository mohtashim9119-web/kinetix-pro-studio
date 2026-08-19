/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// R.12 — THE ATOMIC-RUN INVARIANT (WS1 Session H).
//
// THE INVARIANT, in one line: NO COMMITTED SEGMENT BOUNDARY MAY LIE STRICTLY
// INSIDE AN UNSCRIPTED RUN.
//
// An unscripted run (`faChunkPlan.ts`'s `computeUnscriptedRuns`, R.5's own
// unit of work) is a maximal stretch of transcribed audio that NO segment's
// script accounts for — V6's ten spoken "Level N …" chapter recitations are
// the measured instance. It is one continuous utterance that belongs to no
// scene. A segment boundary landing in the middle of one splits a single
// spoken sentence across two scenes, so the first scene ends holding half a
// recitation it has no words for and the second opens holding the other half.
// That is wrong under any reading of Model P, and it is wrong STRUCTURALLY —
// there is no threshold, no confidence, and no corpus-fitted number anywhere
// in this rule. A boundary is either inside a run or it is not.
//
// HOW IT GETS THERE. R.5 excises the run from the CHUNK PLAN, so forced
// alignment is never offered those frames and cannot mis-time a word into
// them. But the committed boundary is not produced by the chunk plan: it comes
// out of `snapBoundaries.ts`'s `snapCoveredBoundaries`, which snaps the
// seam between two segments onto the midpoint of the nearest detected
// silence. A recitation has its own internal breath pauses, and those are real
// detected silences — so the nearest one to the seam is very often INSIDE the
// recitation. Measured on the committed corpora: all nine defective values are
// EXACT midpoints of real silences lying strictly inside a run. The defect is
// therefore downstream of everything R.5 can reach.
//
// BOTH ENGINES SHARE IT. Eight of the nine committed FA values are
// bit-identical to Whisper's own value at the same boundary — the mechanism is
// in the shared snap, not in forced alignment. (The exception is v6
// `085_the_spear_bearer`, where Whisper lands correctly outside the run at
// 250.81 and FA alone is wrong at 252.74.) This rule is wired into the FA path
// only, matching R.10's and R.11's own gating; the identical Whisper-path
// defect is real, recorded, and deliberately NOT fixed here — doing so would
// move the Whisper golden baseline, which is a separate, larger change.
//
// WHERE THE BOUNDARY GOES — AND WHY THIS REVERSES R-E. Ruling R-E ("Model P
// outranks R.5") assigned the excised span to the PRECEDING segment, which
// would put the boundary at the run's END. WS1 Session H's owner ruling 3
// REVERSES that destination for the committed boundary: the correct place is
// BEFORE the run, in the gap `[prevToken.endSec, run.startSec]`, so the whole
// run is carried by the FOLLOWING segment. That is not a preference — it is
// what the owner's ear scored correct on all twelve rows of the Session H
// listening pass. R-E's site (`faChunkPlan.ts`'s R.5 header) and its
// citations carry the amendment explicitly; this is a recorded reversal, not
// a silent contradiction.
//
// CLAMPED MIDPOINT, FORCED BY MEASUREMENT. Within that gap the value is the
// midpoint of (the leading silence ∩ the gap), falling back to `run.startSec`
// when no silence overlaps the gap at all. The INTERSECTION is load-bearing:
// a detected silence routinely starts before a run and runs on past its onset
// (the narrator pauses, then begins the recitation), and taking such a
// silence's whole midpoint puts the boundary back INSIDE the run — measured on
// four of the nine rows (R4/R5/R7/R8), and on R5 it reproduces the current
// defect value exactly. Clamping is not taste; unclamped placement fails on
// its own corpus.
//
// A STRUCTURAL SIDE EFFECT WORTH NAMING: because the interval's left edge is
// the END of the last token before the run, a correction can never strip the
// preceding segment of its own last word — the same property the drag cascade
// enforces by hand (`dragCascade.ts`). It falls out here for free.
//
// WHY THIS RUNS AFTER INFERENCE, NOT IN THE CHUNK PLAN. Every input R.12
// reads (runs, tokens, silences) exists BEFORE inference, which makes
// `faChunkPlan.ts` tempting — but the DEFECT does not exist until the
// committed boundary does, and that boundary is produced two stages
// downstream by `snapCoveredBoundaries` + `headExtendFirstSegment`. This is
// the same availability-point argument R.10's and R.11's headers make, and
// it decides the surface for the same reason: convenience is not the
// criterion. `faChunkPlan.ts`, `faAnchors.ts` and `snapBoundaries.ts` are all
// READ (their real output is required input) and none is modified or
// re-invoked with different arguments — verified by chunk-plan byte equality
// on all three corpora.
//
// MUTUAL EXCLUSION (measured, all three corpora):
//   - R.5  — acts on chunk TEXT/WINDOWS pre-inference; feeding R.12's output
//            back through `computeFaChunkPlan` reproduces the plan byte for
//            byte, so the two cannot collide.
//   - R.10 — fires only on 173 (`perilous_realms`, `blue_monkey`); 173 has
//            ZERO unscripted runs. Empty intersection by construction.
//   - R.11 — fires on 4 rows, none of them among R.12's nine. The one place
//            they could have met is v6 `125_night_circle` (372.35): R.11's
//            fit conjunct alone flags it, and its THIRD conjunct declines it
//            on a real 0.0301 span confidence. That conjunct is what keeps
//            the two rules exclusive, and it is now the stated reason the
//            conjunct exists.
//   - R-U/R-AA — item 6 lives in 173; no runs, no overlap.
// ---------------------------------------------------------------------------

import { computeUnscriptedRuns } from './faChunkPlan';
import { alignScenestoTranscript, normalize } from './whisperService';
import type { UnscriptedRun } from './faChunkPlan';
import { R12_MIN_CORRECTION_SEC } from './syncConstants';
import type { SilenceInterval } from './silenceDetector';
import type { TranscriptToken, VideoSegment } from '../types';

/** One boundary R.12 proposes to correct, with the evidence that produced it.
 *  `segmentIndex`/`segmentId` name the segment whose OWN `startTime` is the
 *  boundary in question (the shared edge with its predecessor, per Model P) —
 *  the same convention `SeamFitFinding` and `UnspokenScriptFinding` use. */
export interface RunPlacementFinding {
  /** Index into the COMMITTED array passed to the detector. */
  segmentIndex: number;
  segmentId: string;
  segmentTag?: string;
  /** Which unscripted run the committed boundary fell inside. */
  runIndex: number;
  runStartSec: number;
  runEndSec: number;
  runTokenLo: number;
  runTokenHi: number;
  /** `[prevToken.endSec, run.startSec]` — the ONLY interval a corrected value
   *  may occupy. Recorded so a log reader can check the placement themselves. */
  gapStartSec: number;
  gapEndSec: number;
  /** The detected silence the corrected value is the clamped midpoint of.
   *  Absent on the fallback path. */
  backingSilence?: { startSec: number; endSec: number };
  placement: 'silence-midpoint' | 'run-start-fallback';
  committedValue: number;
  correctedValue: number;
  /** `correctedValue - committedValue` — always negative in practice (the
   *  boundary moves EARLIER, out of the run), but not asserted to be: the rule
   *  is "outside the run", not "earlier". */
  delta: number;
}

/** A token that carries real speech. Whisper's raw output is a CONTIGUOUS
 *  partition of the timeline — punctuation tokens occupy the inter-word
 *  pauses, so `tokens[i].endSec === tokens[i+1].startSec` for 97.8% of
 *  adjacent pairs on the v6 corpus (measured, WS1 Session P Step 5b). A token
 *  whose text normalizes to nothing is that pause, not a word; it is exactly
 *  what `filterMalformedTokens` drops with reason `empty-text`, for the reason
 *  stated at its own drop site: "its timestamps can still be picked as a
 *  segment edge". */
const isSubstantiveToken = (t: TranscriptToken | undefined): boolean =>
  t !== undefined && normalize(t.text).length > 0;

/** An unscripted run's ACOUSTIC extent: first to last token in it that carries
 *  speech, rather than the raw token span's own edges.
 *
 *  WHY THIS EXISTS (WS1 Session P Step 5b — a measured production defect, not
 *  a refinement). `computeUnscriptedRuns` sets `startSec = tokens[lo].startSec`
 *  where `lo` is the first UNCLAIMED token index. When the token immediately
 *  preceding an unscripted utterance is the punctuation that represents the
 *  pause before it — the common case, since a recitation is preceded by a full
 *  stop — that punctuation token is itself unclaimed, so it becomes the run's
 *  first token and the run's `startSec` is pinned to the END of the previous
 *  word. Three consequences, all measured on the live production bundle:
 *
 *    1. R.12's placement gap `[prevToken.endSec, run.startSec]` is EMPTY by
 *       construction (width exactly 0 on 9 of 9 runs), so the rule declined
 *       every run and reported zero findings while nine boundaries sat inside
 *       runs. R.12's nine historical firings were all measured on a
 *       pre-FILTERED token array, in which the punctuation token is absent and
 *       the gap is therefore real (width 0.25-2.06 s on the same nine runs).
 *    2. The run's reported onset is earlier than any unscripted speech, so a
 *       correctly-placed boundary looks like it is "inside" the run.
 *    3. The H7 guard (a correction may not land inside a run) then rejects the
 *       rule's own correct output, because that output sits in the punctuation
 *       token's span.
 *
 *  Reading the run in substantive-token space fixes all three at once, and it
 *  is the same principle CLAUDE.md already states for this pipeline: identity
 *  is decided on token content, never on raw-timestamp adjacency. No constant
 *  is introduced — this changes WHICH tokens bound the interval, not any
 *  threshold.
 *
 *  Falls back to the run's raw span when it contains no substantive token at
 *  all (structurally possible, never observed) — declining to guess rather
 *  than fabricating an extent. */
function acousticRunExtent(
  run: UnscriptedRun,
  tokens: readonly TranscriptToken[],
): { startSec: number; endSec: number; onsetIndex: number } {
  let lo = run.tokenLo;
  while (lo <= run.tokenHi && !isSubstantiveToken(tokens[lo])) lo++;
  let hi = run.tokenHi;
  while (hi >= run.tokenLo && !isSubstantiveToken(tokens[hi])) hi--;
  const onset = tokens[lo];
  const offset = tokens[hi];
  if (!onset || !offset || lo > hi) {
    return { startSec: run.startSec, endSec: run.endSec, onsetIndex: run.tokenLo };
  }
  return { startSec: onset.startSec, endSec: offset.endSec, onsetIndex: lo };
}

/**
 * R.12's detector. Pure — no React, no DOM, no IPC.
 *
 * TWO segment arrays, deliberately:
 *
 *  - `parsedSegments` is the COMPLETE, pre-skip-filter array in the exact
 *    order `computeUnscriptedRuns` needs (mirrors `App.tsx`'s `anchorTimed`,
 *    the same array `runForcedAlignmentForSync` receives). Run derivation is a
 *    pure function of segment TEXT and ORDER — it never reads segment timing —
 *    so this array's own `startTime`s are irrelevant here and only its script
 *    matters.
 *  - `committedSegments` is the FINAL, fully-timed array (post
 *    `snapCoveredBoundaries` + `headExtendFirstSegment`) whose boundaries are
 *    the thing under test. Splitting the two is what lets the detector read a
 *    real committed value rather than a pre-alignment estimate.
 *
 * `tokens` are Whisper tokens (the run's own index space); `silences` are the
 * real detected silences.
 */
export function detectRunPlacementDefects(
  parsedSegments: readonly VideoSegment[],
  committedSegments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
): RunPlacementFinding[] {
  if (parsedSegments.length === 0 || committedSegments.length === 0 || tokens.length === 0) return [];

  const runs: UnscriptedRun[] = computeUnscriptedRuns(parsedSegments, tokens, silences, audioDuration);
  if (runs.length === 0) return [];

  // Every run's acoustic extent, computed once — see `acousticRunExtent` for
  // why the raw token span's own edges cannot be used here. Both the interior
  // test and the H7 guard below read THIS view, not `run.startSec`/`endSec`;
  // mixing the two is what made the rule reject its own correct output.
  const extents = runs.map(run => acousticRunExtent(run, tokens));

  const findings: RunPlacementFinding[] = [];

  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri]!;
    const extent = extents[ri]!;

    // A run at CORPUS START has no preceding token, so the legal placement
    // interval does not exist and there is nothing to correct toward. This is
    // structural, not a special case bolted on — V6's tenth recitation is
    // exactly this shape (`exciseUnscriptedRuns` trims rather than splits it
    // for the mirror-image reason). Scanning backward for a SUBSTANTIVE token
    // (not simply `tokens[run.tokenLo - 1]`) is the same content-not-adjacency
    // rule `acousticRunExtent` applies at the other end of the gap.
    let prevIndex = run.tokenLo - 1;
    while (prevIndex >= 0 && !isSubstantiveToken(tokens[prevIndex])) prevIndex--;
    const prevToken = tokens[prevIndex];
    if (!prevToken) continue;

    const gapStartSec = prevToken.endSec;
    const gapEndSec = extent.startSec;
    if (!(gapEndSec - gapStartSec > 0)) continue; // no room between the last word and the run.

    // The clamped candidate: every silence with POSITIVE overlap with the gap,
    // strongest overlap first. Ties break on the LATER silence, then the later
    // end — fully deterministic, so two runs of this function on the same
    // input can never disagree. Measured on the committed corpora: at most one
    // silence ever intersects a gap, so the tiebreak never binds today; it
    // exists so that it cannot become a source of nondeterminism later.
    let best: { silence: SilenceInterval; lo: number; hi: number } | undefined;
    for (const s of silences) {
      const lo = Math.max(s.startSec, gapStartSec);
      const hi = Math.min(s.endSec, gapEndSec);
      if (!(hi - lo > 1e-9)) continue;
      if (
        best === undefined ||
        hi - lo > best.hi - best.lo + 1e-12 ||
        (Math.abs((hi - lo) - (best.hi - best.lo)) <= 1e-12 &&
          (s.startSec > best.silence.startSec ||
            (s.startSec === best.silence.startSec && s.endSec > best.silence.endSec)))
      ) {
        best = { silence: s, lo, hi };
      }
    }

    const correctedValue = best ? (best.lo + best.hi) / 2 : gapEndSec;

    // H7, as a permanent guard rather than a one-off check: a corrected value
    // may never itself land inside a run. It cannot today — the gap sits
    // between a CLAIMED token and the run's own onset — but Whisper token
    // spans can overlap in principle, which would let an earlier run's `endSec`
    // reach past `gapStartSec`. R.12 declines rather than relocating a defect.
    if (extents.some(u => correctedValue > u.startSec + 1e-9 && correctedValue < u.endSec - 1e-9)) continue;

    for (let i = 0; i < committedSegments.length; i++) {
      // Index 0 is never a candidate: `headExtendFirstSegment` unconditionally
      // forces the first committed segment's start to 0, so no correction here
      // could survive to be observed. Same exclusion, same reason, as R.11's.
      if (i === 0) continue;
      const committedValue = committedSegments[i]!.startTime;
      if (!(committedValue > extent.startSec + 1e-9 && committedValue < extent.endSec - 1e-9)) continue;
      if (Math.abs(correctedValue - committedValue) <= R12_MIN_CORRECTION_SEC) continue;

      findings.push({
        segmentIndex: i,
        segmentId: committedSegments[i]!.id,
        segmentTag: (committedSegments[i] as unknown as { tag?: string }).tag,
        runIndex: ri,
        runStartSec: extent.startSec,
        runEndSec: extent.endSec,
        runTokenLo: run.tokenLo,
        runTokenHi: run.tokenHi,
        gapStartSec,
        gapEndSec,
        ...(best ? { backingSilence: { startSec: best.silence.startSec, endSec: best.silence.endSec } } : {}),
        placement: best ? 'silence-midpoint' : 'run-start-fallback',
        committedValue,
        correctedValue,
        delta: correctedValue - committedValue,
      });
    }
  }

  // Stable order: ascending segment index, so `applyRunPlacementCorrections`
  // composes left to right deterministically.
  findings.sort((a, b) => a.segmentIndex - b.segmentIndex);
  return findings;
}

/**
 * The Model-P boundary move both halves of this rule share, by ID.
 *
 * Kept as ONE function on purpose: R.12 and R.13 move different edges, and the
 * only way to guarantee they conserve the partition identically is for them to
 * do the arithmetic in the same place. A finding whose segment was dropped
 * upstream (R.10, the coverage skip filter) or reordered simply has no match
 * and is silently skipped — the same tolerant-by-id pattern
 * `applySeamFitCorrections` and `applyUnspokenScriptGate` use.
 *
 * Correcting `segments[i].startTime` moves the shared boundary with
 * `segments[i-1]`, so `segments[i-1].duration` absorbs the same delta in the
 * opposite direction — Sigma duration and the gapless partition are preserved
 * exactly, and segment i's own END never moves. A correction that would drive
 * either duration non-positive is declined.
 *
 * Immutable: returns a new array, never mutates its input (CLAUDE.md).
 */
function applyBoundaryMoves(
  finalSegments: readonly VideoSegment[],
  correctedById: ReadonlyMap<string, number>,
): VideoSegment[] {
  if (correctedById.size === 0) return finalSegments as VideoSegment[];
  const out = finalSegments.map(s => ({ ...s }));
  for (let i = 0; i < out.length; i++) {
    if (i === 0) continue; // no predecessor to absorb the delta; also excluded at detection time.
    const corrected = correctedById.get(out[i]!.id);
    if (corrected === undefined) continue;

    const delta = corrected - out[i]!.startTime;
    const prevDuration = out[i - 1]!.duration + delta;
    const ownDuration = out[i]!.duration - delta;
    if (!(prevDuration > 0) || !(ownDuration > 0)) continue;

    out[i - 1] = { ...out[i - 1]!, duration: prevDuration };
    out[i] = { ...out[i]!, startTime: corrected, duration: ownDuration };
  }
  return out;
}

/**
 * Applies findings to the final committed segment array BY ID — a finding
 * whose segment was dropped upstream (R.10, the coverage skip filter) or
 * reordered simply has no match and is silently skipped, the same
 * tolerant-by-id pattern `applySeamFitCorrections` and `applyUnspokenScriptGate`
 * use.
 *
 * Model P: correcting `segments[i].startTime` moves the shared boundary with
 * `segments[i-1]`, so `segments[i-1].duration` absorbs the same delta in the
 * opposite direction — Σ duration and the gapless partition are preserved
 * exactly, and segment i's own END never moves. A correction that would drive
 * either duration non-positive is declined (defensive; on the committed
 * corpora the tightest of the nine leaves 1.24s of predecessor, measured).
 *
 * Immutable: returns a new array, never mutates its input (CLAUDE.md).
 */
export function applyRunPlacementCorrections(
  finalSegments: readonly VideoSegment[],
  findings: readonly RunPlacementFinding[],
): VideoSegment[] {
  return applyBoundaryMoves(finalSegments, new Map(findings.map(f => [f.segmentId, f.correctedValue])));
}

// ---------------------------------------------------------------------------
// R.13 — THE ATOMIC-UTTERANCE INVARIANT (WS1 Session K).
//
// THE CLOSING HALF OF R.12, and it lives in this file for that reason: a rule
// that constrains one edge of a thing must state and test the other, and
// keeping the pair apart is exactly how the gap below survived a full session.
//
// BOTH SIDES, stated together:
//   OPENING (R.12) — no committed boundary may lie strictly inside an
//                    unscripted run.
//   CLOSING (R.13) — the boundary that CLOSES the segment carrying a run may
//                    not lie before that segment's own utterance has finished.
//
// WHY THE OPENING HALF ALONE IS NOT ENOUGH. R.12 pulls the run-carrying
// segment's START back to before the run, so that segment now owns the whole
// recitation. Its own scripted line is spoken AFTER the recitation. Nothing in
// R.12 looks at where that segment ENDS — so its closing boundary can still sit
// on the pause BETWEEN the recitation and its own line, which leaves the
// carrier holding a recitation it has no words for and hands its own line to
// the next scene. Measured on v6: nine of ten recitations are already clean on
// this edge and one is not (`225_night_scouts`, 667.47 -> 669.05).
//
// WHY THE EXACT MIRROR OF R.12 DOES NOT WORK, AND WHAT REPLACES IT. R.12's
// legal interval is `[prevToken.endSec, run.startSec]`. The naive mirror is
// `[carrier's own last token end, next segment's own first token onset]` — and
// it FAILS on the one defective row, because Whisper's timings in the region
// immediately after a run are not trustworthy: on v6 run 5 the token "the" is
// given the span [668.650, 669.400] and swallows the entire real silence the
// boundary belongs in, and forced alignment's confidence there collapses to
// 1e-5..1e-4 against a corpus median of 0.9985 (R.5 excised the run using that
// same smeared span, so FA was never offered the right frames). The mirror
// lands at 667.73 — a 0.26s move that is still audibly wrong.
//
// The fix is to drop the upper clamp and anchor on the ONE quantity in that
// neighbourhood that is reliable: the END of the carrier's own last matched
// token. It is reliable because it is the far side of the carrier's own
// utterance, past the smeared region, and because it is a token-INDEX fact
// (which words are the carrier's) rather than a timestamp-proximity guess —
// the distinction CLAUDE.md's sync invariant requires. The corrected value is
// the midpoint of the FIRST detected silence starting at or after it. Detected
// silences come from the waveform, not from either token stream, and on the
// defective row the detector's [668.700, 669.400] matches the owner's ear
// ("...till 668.85s, then at 669.37s...") to within 0.15s.
//
// NO THRESHOLD ANYWHERE. Detection is the strict comparison
// `closingBoundary < carrier's own utterance end`. Placement is the first
// qualifying silence. `R12_MIN_CORRECTION_SEC` is reused only as the
// don't-churn epsilon the opening half already uses, never as a detector.
//
// COST. This rule needs the carrier's own token span in the RUN's index space
// (Whisper), which is not the space `App.tsx`'s `aligned.coverage` uses when FA
// is on. It therefore runs its own `alignScenestoTranscript` internally rather
// than accepting an alignment argument that could silently arrive in the wrong
// space — the same self-contained choice `faUnspokenGate.ts` makes, and for
// the same reason.
//
// MUTUAL EXCLUSION (measured, all three corpora — see the test file):
//   - R.12 — moves the CARRIER's start; R.13 moves the carrier's SUCCESSOR's
//            start. Different boundaries; both apply as deltas, so composing
//            them is exact and order-independent in effect.
//   - R.11 — 4 rows, none of them R.13's. `226_four_scouts` is adjacent (it is
//            the carrier's successor's successor) but is a different boundary.
//   - R.5  — pre-inference, chunk text/windows; feeding R.13's output back
//            through `computeFaChunkPlan` reproduces the plan byte for byte.
//   - R.10 — 173-only; 173 has zero unscripted runs.
//   - R-U/R-AA — item 6 lives in 173; no runs, no overlap.
//
// WS1 SESSION Q — R.13 FIRED ZERO ON THE LIVE V6 BUNDLE FOR A REAL, DIFFERENT
// REASON THAN R.12'S PART N(e) HYPOTHESIS, NOW FIXED.
//
// `sync-pipeline-v2-plan.md` Part N(e) left open whether R.13's zero live
// firings were the same raw-token-inflation defect Session P found for R.12
// (there, `run.endSec`'s raw value sits LATER than the run's true acoustic end
// when the run terminates in a punctuation token, making the guard below
// harder to satisfy). MEASURED, not assumed: it is not — the raw-vs-acoustic
// `run.endSec` delta is 0.08s-0.40s on all ten v6 runs
// (`scripts/ws1-session-q-r13-tail.test.ts`), while the guard actually failed
// by 2.98s-5.61s on nine of them. Two orders of magnitude too small to be the
// explanation.
//
// THE REAL DEFECT was in the CARRIER lookup just below, not the guard: it used
// `run.startSec` (raw), the same punctuation-inflated quantity R.12's own fix
// replaced for its OWN purposes. Once R.12 has run, a run's true carrier (its
// successor, whose start R.12 corrected to the run's ACOUSTIC onset) begins
// AFTER `run.startSec` — so a lookup keyed on `run.startSec` finds that
// successor's own PRECEDING, UNRELATED neighbour instead (its span still
// contains the punctuation-inflated raw onset). That neighbour's own line
// trivially ends before the run even starts, so the guard below declines by
// roughly the recitation's own length — exactly the 2.98s-5.61s measured.
// Fixed the same structural way R.12 was: the lookup now uses `extent`
// (`acousticRunExtent(run, tokens)`, the same helper R.12 already computes),
// not `run.startSec`. RED-before/GREEN-after:
// `faRunPlacementGate.test.ts`'s "the carrier is found by the run's ACOUSTIC
// onset" case.
//
// AFTER THE FIX, R.13 STILL FIRES ZERO ON V6 — and this time for a verified
// reason, not a suppressed one: `scripts/ws1-session-q-invariants.test.ts`
// asserts the CORRECTLY-carrier-identified invariant directly (not through
// this file's own — now also fixed — lookup) and it is GREEN. All nine v6
// runs where the shape applies (`utteranceEndSec > run's acoustic end`) are
// ALREADY legal once the true carrier is used: R.12's Session P fix, by
// placing each successor at the run's acoustic onset, empirically also
// leaves that successor's OWN closing boundary past its own utterance end on
// this corpus. R.13 has real work only when that does not hold — as it did
// not for `225_night_scouts` on the pre-Session-P vintage this file's
// fixture-based corpus tests still pin.
// ---------------------------------------------------------------------------

/** One closing boundary R.13 proposes to correct. */
export interface UtterancePlacementFinding {
  /** Index into the COMMITTED array passed to the detector — the segment whose
   *  own `startTime` is the boundary in question, i.e. the carrier's
   *  SUCCESSOR. Same convention as `RunPlacementFinding`. */
  segmentIndex: number;
  segmentId: string;
  segmentTag?: string;
  /** The run-carrying segment whose own utterance this boundary cut into. */
  carrierIndex: number;
  carrierId: string;
  carrierTag?: string;
  runIndex: number;
  runStartSec: number;
  runEndSec: number;
  /** End of the last transcript token the carrier's own script matched — the
   *  earliest legal value for this boundary, and the anchor placement uses. */
  utteranceEndSec: number;
  backingSilence?: { startSec: number; endSec: number };
  placement: 'silence-midpoint' | 'utterance-end-fallback';
  committedValue: number;
  correctedValue: number;
  /** `correctedValue - committedValue` — always positive in practice (the
   *  boundary moves LATER, past the carrier's own line), not asserted to be. */
  delta: number;
}

/**
 * R.13's detector. Pure — no React, no DOM, no IPC.
 *
 * Same two-array contract as `detectRunPlacementDefects`: `parsedSegments` is
 * the COMPLETE pre-skip array (run derivation reads only its text and order),
 * `committedSegments` is the FINAL, fully-timed array whose boundaries are
 * under test — in production, the array R.12 has already corrected.
 *
 * `tokens` MUST be the Whisper tokens, the run's own index space. The
 * carrier's own token span is derived here, from those same tokens, rather
 * than accepted as an argument: with the FA gate on, `App.tsx`'s
 * `aligned.coverage` indexes FA tokens, and silently mixing the two spaces is
 * precisely the class of defect this rule exists to close.
 */
export function detectUtterancePlacementDefects(
  parsedSegments: readonly VideoSegment[],
  committedSegments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
): UtterancePlacementFinding[] {
  if (parsedSegments.length === 0 || committedSegments.length === 0 || tokens.length === 0) return [];

  const runs: UnscriptedRun[] = computeUnscriptedRuns(parsedSegments, tokens, silences, audioDuration);
  if (runs.length === 0) return [];

  // The carrier's OWN words, in the run's index space. By id, never by index —
  // `parsedSegments` and `committedSegments` are different index spaces
  // whenever anything upstream dropped a scene.
  const alignments = alignScenestoTranscript(
    parsedSegments as VideoSegment[],
    tokens as TranscriptToken[],
    silences as SilenceInterval[],
    audioDuration,
  );
  const alignById = new Map<string, (typeof alignments)[number]>();
  parsedSegments.forEach((s, i) => { const a = alignments[i]; if (a) alignById.set(s.id, a); });

  // Every run's ACOUSTIC onset (WS1 Session Q) — see `acousticRunExtent`'s own
  // doc comment for why `run.startSec` is not it: it is pinned to the END of
  // the token immediately before the run, which is the pause-marking
  // punctuation token when one exists, not the run's own first spoken word.
  // R.12 already had to make this same correction for its own placement gap;
  // R.13's carrier lookup below needed the identical fix for a different
  // reason — see that lookup's own comment.
  const extents = runs.map(run => acousticRunExtent(run, tokens));

  const findings: UtterancePlacementFinding[] = [];

  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri]!;
    const extent = extents[ri]!;

    // The carrier is the committed segment whose span holds the run's
    // ACOUSTIC onset — NOT `run.startSec` (WS1 Session Q, measured, not
    // theoretical). Once R.12 has run, a run-carrying segment's SUCCESSOR is
    // corrected to start AT or after the run's acoustic onset, which sits
    // strictly after the punctuation-inflated `run.startSec` on every v6 run
    // that has a leading punctuation token. Looking the committed array up by
    // `run.startSec` then finds the SUCCESSOR's own PREDECESSOR instead — an
    // unrelated segment whose own line trivially ends before the run starts,
    // whose guard below therefore always declines by multiple seconds. This
    // is not the tail-side `run.endSec` inflation `sync-pipeline-v2-plan.md`
    // Part N(e) asked about — it is a head-side effect on carrier IDENTITY,
    // measured over all ten v6 runs: the pre-fix lookup names the wrong
    // carrier on ten of ten, nine of which decline on the guard below by
    // 2.98s-5.61s (`scripts/ws1-session-q-r13-tail.test.ts`), and the tenth
    // (run 0, corpus start) happens to still land on the right segment only
    // because there is no predecessor to misfire into. Model P still makes
    // the corrected lookup unambiguous — exactly one segment contains any
    // time.
    const ci = committedSegments.findIndex(
      s => extent.startSec >= s.startTime && extent.startSec < s.startTime + s.duration,
    );
    if (ci < 0 || ci + 1 >= committedSegments.length) continue;

    const carrier = committedSegments[ci]!;
    const a = alignById.get(carrier.id);
    if (!a || !a.matched || a.lastTokenIdx < 0) continue; // no own words to protect.

    const utteranceEndSec = tokens[a.lastTokenIdx]!.endSec;
    // DEFENSIVE, AND SAID TO BE: the carrier's own line must come AFTER the
    // run, or this is not the shape R.13 describes.
    //
    // WHEN IT IS REACHABLE, exactly — corrected in WS1 Session L, because
    // Session K's version of this comment was too generous to itself. It said
    // the guard was reachable because R.13 "is a public function that can be
    // called on an uncorrected array". That is not sufficient, and the reason
    // is worth keeping: `detectUnscriptedRuns` marks a segment's WHOLE matched
    // token span in `claimed[]`, so no segment's `lastTokenIdx` can lie inside
    // a run's token range at all. The carrier's last token is therefore
    // strictly before `run.tokenLo` or strictly after `run.tokenHi`:
    //   - before  -> monotonic token times give `utteranceEndSec <=
    //     run.startSec`, and the carrier contains the run's onset, so the
    //     detection test below (`committedValue < utteranceEndSec`) demands a
    //     successor start that is simultaneously after `run.startSec` and
    //     before it. Unreachable, on any array, corrected or not.
    //   - after   -> `utteranceEndSec >= run.endSec`.
    // So the ONLY value that reaches this guard is EQUALITY, and it requires a
    // zero-width token ending exactly at `run.endSec` — which Whisper does
    // emit. On that input, with an UNCORRECTED array whose successor still
    // opens strictly inside the run, both rules want the same edge and want
    // different values for it. The guard is what makes R.12's claim win.
    //
    // MEASURED, not assumed, and now COVERED: Session K reported M8-B (drop
    // this line) GREEN and recorded it as an uncovered guard. Session L built
    // the equality-boundary fixture above's shape in
    // `faRunPlacementGate.test.ts` ("the guard"), and M8-B is now RED — 1
    // failure, R.13 emitting 4.825 against R.12's 2.50 on the same boundary.
    // The green mutation is retired; nothing here is uncovered-by-design.
    if (!(utteranceEndSec > run.endSec + 1e-9)) continue;

    const successor = committedSegments[ci + 1]!;
    const committedValue = successor.startTime;
    if (!(committedValue < utteranceEndSec - 1e-9)) continue; // already legal.

    // Placement: the FIRST detected silence starting at or after the carrier's
    // own utterance ends. Deterministic — ties break on the shorter silence,
    // then the earlier end, so two runs on the same input cannot disagree.
    let best: SilenceInterval | undefined;
    for (const s of silences) {
      if (!(s.startSec >= utteranceEndSec - 1e-9)) continue;
      if (
        best === undefined ||
        s.startSec < best.startSec - 1e-12 ||
        (Math.abs(s.startSec - best.startSec) <= 1e-12 && s.endSec < best.endSec)
      ) {
        best = s;
      }
    }

    const correctedValue = best ? (best.startSec + best.endSec) / 2 : utteranceEndSec;

    // H7, mirrored: a corrected value may never itself land inside a run.
    if (runs.some(u => correctedValue > u.startSec + 1e-9 && correctedValue < u.endSec - 1e-9)) continue;
    // The move must not reach or pass the successor's OWN end, which would
    // invert the partition. Declining is correct; relocating is not.
    const nextBoundary = committedSegments[ci + 2]?.startTime ?? audioDuration;
    if (!(correctedValue < nextBoundary - 1e-9)) continue;
    if (Math.abs(correctedValue - committedValue) <= R12_MIN_CORRECTION_SEC) continue;

    findings.push({
      segmentIndex: ci + 1,
      segmentId: successor.id,
      segmentTag: (successor as unknown as { tag?: string }).tag,
      carrierIndex: ci,
      carrierId: carrier.id,
      carrierTag: (carrier as unknown as { tag?: string }).tag,
      runIndex: ri,
      runStartSec: run.startSec,
      runEndSec: run.endSec,
      utteranceEndSec,
      ...(best ? { backingSilence: { startSec: best.startSec, endSec: best.endSec } } : {}),
      placement: best ? 'silence-midpoint' : 'utterance-end-fallback',
      committedValue,
      correctedValue,
      delta: correctedValue - committedValue,
    });
  }

  findings.sort((a2, b2) => a2.segmentIndex - b2.segmentIndex);
  return findings;
}

/** R.13's application — the same Model-P move the opening half uses. */
export function applyUtterancePlacementCorrections(
  finalSegments: readonly VideoSegment[],
  findings: readonly UtterancePlacementFinding[],
): VideoSegment[] {
  return applyBoundaryMoves(finalSegments, new Map(findings.map(f => [f.segmentId, f.correctedValue])));
}
