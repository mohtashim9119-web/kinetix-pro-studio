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
  if (findings.length === 0) return finalSegments as VideoSegment[];

  const byId = new Map(findings.map(f => [f.segmentId, f]));
  const out = finalSegments.map(s => ({ ...s }));

  for (let i = 0; i < out.length; i++) {
    if (i === 0) continue; // no predecessor to absorb the delta; also excluded at detection time.
    const finding = byId.get(out[i]!.id);
    if (!finding) continue;

    const delta = finding.correctedValue - out[i]!.startTime;
    const prevDuration = out[i - 1]!.duration + delta;
    const ownDuration = out[i]!.duration - delta;
    if (!(prevDuration > 0) || !(ownDuration > 0)) continue;

    out[i - 1] = { ...out[i - 1]!, duration: prevDuration };
    out[i] = { ...out[i]!, startTime: finding.correctedValue, duration: ownDuration };
  }

  return out;
}
