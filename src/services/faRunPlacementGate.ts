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
import { alignScenestoTranscript } from './whisperService';
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

  const findings: RunPlacementFinding[] = [];

  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri]!;

    // A run at CORPUS START has no preceding token, so the legal placement
    // interval does not exist and there is nothing to correct toward. This is
    // structural, not a special case bolted on — V6's tenth recitation is
    // exactly this shape (`exciseUnscriptedRuns` trims rather than splits it
    // for the mirror-image reason).
    const prevToken = tokens[run.tokenLo - 1];
    if (!prevToken) continue;

    const gapStartSec = prevToken.endSec;
    const gapEndSec = run.startSec;
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
    if (runs.some(u => correctedValue > u.startSec + 1e-9 && correctedValue < u.endSec - 1e-9)) continue;

    for (let i = 0; i < committedSegments.length; i++) {
      // Index 0 is never a candidate: `headExtendFirstSegment` unconditionally
      // forces the first committed segment's start to 0, so no correction here
      // could survive to be observed. Same exclusion, same reason, as R.11's.
      if (i === 0) continue;
      const committedValue = committedSegments[i]!.startTime;
      if (!(committedValue > run.startSec + 1e-9 && committedValue < run.endSec - 1e-9)) continue;
      if (Math.abs(correctedValue - committedValue) <= R12_MIN_CORRECTION_SEC) continue;

      findings.push({
        segmentIndex: i,
        segmentId: committedSegments[i]!.id,
        segmentTag: (committedSegments[i] as unknown as { tag?: string }).tag,
        runIndex: ri,
        runStartSec: run.startSec,
        runEndSec: run.endSec,
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

  const findings: UtterancePlacementFinding[] = [];

  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri]!;

    // The carrier is the committed segment whose span holds the run's onset.
    // Model P makes this unambiguous — exactly one segment contains any time.
    const ci = committedSegments.findIndex(
      s => run.startSec >= s.startTime && run.startSec < s.startTime + s.duration,
    );
    if (ci < 0 || ci + 1 >= committedSegments.length) continue;

    const carrier = committedSegments[ci]!;
    const a = alignById.get(carrier.id);
    if (!a || !a.matched || a.lastTokenIdx < 0) continue; // no own words to protect.

    const utteranceEndSec = tokens[a.lastTokenIdx]!.endSec;
    // DEFENSIVE, AND SAID TO BE: the carrier's own line must come AFTER the
    // run, or this is not the shape R.13 describes.
    //
    // In the shipped pipeline this branch is UNREACHABLE, and the proof is
    // short enough to keep here. The carrier contains the run's onset, so the
    // successor's start is after it; if the carrier's own line ended at or
    // before the run's end, the detection test below would additionally put
    // that start before the run's end — i.e. strictly inside the run, which is
    // R.12's territory and R.12 has already corrected it by the time R.13
    // runs. So the guard is a restatement of R.12's precedence, not a second
    // decision. It is kept because R.13 is a public function that can be
    // called on an uncorrected array (its own tests do exactly that), and
    // declining is the right answer there.
    //
    // MEASURED, not assumed: removing this line leaves the whole suite GREEN
    // (WS1 Session K's M8-B mutation). That is reported as a green mutation in
    // `scripts/phase4-fa-replay.test.ts` rather than dressed up as a red one —
    // an unreachable guard with no failing mutation is exactly the kind of
    // thing a mutation matrix exists to tell the truth about.
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
