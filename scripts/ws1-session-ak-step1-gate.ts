/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ===========================================================================
// WS1 Session AK — STEP 1. THE PRE-REGISTERED GATE.
//
// R-AS APPLIED PROSPECTIVELY. Session AH's ruling says a detector-based
// repair's go/no-go gate is its PRECISION, stated BEFORE the repair is built —
// never a collateral ratio computed after the fact. S1 passed a
// measured-afterwards bar and was then rejected 18/18 on ear audit. This file
// is the same discipline applied to a planner change instead of a detector:
// every threshold below is fixed and committed BEFORE arms B and C run, so the
// result is judged against a standard rather than the standard fitted to the
// result.
//
// This module is DATA AND PREDICATES ONLY. It computes no measurement and
// reads no arm. The measurement harness imports it and reports itself against
// it; it cannot be quietly relaxed in the same commit that produces the
// numbers, because it is committed first.
// ===========================================================================

import type { Corpus } from './ws1-ear-pass-ledger.js';

// ---------------------------------------------------------------------------
// HARD FAIL CONDITIONS. Either of these, on any corpus, ends the arm.
// ---------------------------------------------------------------------------

/**
 * HARD FAIL 1 — movement away from an attested-correct boundary.
 *
 * The operator's full-pass attestation covers v6 (447) and 173 (173): 620
 * boundaries, of which 615 are attested CORRECT and 5 are the named open
 * defects. Any of those 615 moving further than this from its oracle value is
 * a hard fail, at any count above zero.
 *
 * NOT a tuned number — it is the brief's own stated condition, and it is the
 * band inside which the operator has declined to treat a difference as a
 * defect (the two 10ms supersessions this session applies are both inside it).
 */
export const HARD_FAIL_MOVE_SEC = 0.050;

/**
 * HARD FAIL 2 — reproduction of a known-bad value. `S1_KNOWN_BAD_MOVES` is the
 * project's only labelled NEGATIVE ground truth: 19 values a candidate change
 * proposed and the operator's ears rejected. An arm that lands on one of them
 * has reproduced a move already adjudicated wrong.
 */
export const KNOWN_BAD_REPRODUCTIONS_ALLOWED = 0;

/** Match tolerance for "reproduced a known-bad value" — the register's own pin
 *  tolerance, unchanged (`EAR_PIN_TOLERANCE_SEC`). */
export const KNOWN_BAD_MATCH_SEC = 0.005;

// ---------------------------------------------------------------------------
// THE SUCCESS BAR.
// ---------------------------------------------------------------------------

/** The five open defects, at their ear targets. */
export const OPEN_DEFECTS: ReadonlyArray<{
  corpus: Corpus; tag: string; boundary: string; prod: number; ear: number; operatorTargeted: boolean;
}> = [
  { corpus: 'v6', tag: '214_solitary_fire', boundary: '213-214', prod: 629.01, ear: 630.09, operatorTargeted: true },
  { corpus: 'v6', tag: '231_slowing_pace', boundary: '230-231', prod: 681.63, ear: 682.74, operatorTargeted: true },
  { corpus: 'v6', tag: '447_scout_facing_dark', boundary: '446-447', prod: 1417.12, ear: 1418.53, operatorTargeted: true },
  { corpus: '173', tag: 'lethal_nature_hazard', boundary: '5-6', prod: 18.51, ear: 19.27, operatorTargeted: true },
  { corpus: '173', tag: 'gadget_decay', boundary: '106-107', prod: 427.48, ear: 427.60, operatorTargeted: false },
];

/** A defect COUNTS AS LANDED at this tolerance. Same band as HARD_FAIL_MOVE_SEC
 *  by construction: a boundary cannot be "close enough to be correct" at one
 *  tolerance and "far enough to be a regression" at another. */
export const DEFECT_LANDED_SEC = 0.050;

/**
 * MINIMUM DEFECTS THAT MUST LAND — **4 of 5**, and specifically the four the
 * operator named (`operatorTargeted`). Not lowered, and here is why lowering it
 * would be indefensible:
 *
 *   * A bar of 2 is NO IMPROVEMENT AT ALL. Arm B — S2 without excision, the
 *     arm this session exists to improve on — already lands exactly 2 of the 5
 *     (`447_scout_facing_dark` and `lethal_nature_hazard`), at a measured cost
 *     of 36 ear-verified control regressions. A bar it already clears cannot
 *     distinguish excision's contribution from zero.
 *   * A bar of 3 means excision bought exactly one additional defect while the
 *     arm still moves hundreds of boundaries. Against 615 attested-correct
 *     boundaries that is not a trade anyone can sign.
 *   * The operator named four. A bar set below the operator's own stated
 *     target would be this session choosing its own success criterion after
 *     seeing which rows are easy, which is exactly what R-AS forbids.
 *
 * The fifth (`gadget_decay`, 173 106-107, a 0.12s defect) is REPORTED but not
 * required — the operator did not name it.
 */
export const MIN_DEFECTS_REQUIRED = 4;

/**
 * MAXIMUM TOTAL BOUNDARIES A SHIPPABLE ARM MAY MOVE.
 *
 * Stated as a RATIO, not a count, because a count would be fitted to these
 * three corpora and would not transfer. The derivation, in three steps:
 *
 *   1. The ear ledger's own matching rule (`earPassAuthorising`) authorises a
 *      value within `EAR_PIN_TOLERANCE_SEC` = 5ms of a scored one. So a move
 *      of <= 5ms PRESERVES the operator's standing verdict; a move of > 5ms
 *      does NOT — `earPassAuthorising` stops authorising the new value, and
 *      the boundary needs re-verification.
 *   2. Therefore every boundary moving > 5ms among the 615 attested-correct
 *      creates exactly one unit of ear work. Every open defect landed removes
 *      exactly one. This is the EAR BILL, and it is measurable, not a matter
 *      of taste.
 *   3. A change that creates more ear work than it closes cannot be shipped on
 *      the strength of its own measurement — it hands the operator a bigger
 *      listening pass than the one that produced the attestation it is
 *      spending. So: **moves > 5ms among the attested-correct must not exceed
 *      the number of open defects landed.**
 *
 * Equivalently: **implied boundary-improvement precision >= 50%**. For scale,
 * both measured: S1 was rejected at ~7%, and arm B (global S2, no excision)
 * sits at ~0.3% on v6 (1 improvement / 331 moved).
 */
export const EAR_BILL_TOLERANCE_SEC = 0.005;
export const MIN_IMPLIED_PRECISION = 0.50;

/** The result that ends this line of work rather than iterating it. */
export const STOP_CONDITION = [
  'RECOMMEND AGAINST SHIPPING GLOBAL S2 EVEN AFTER EXCISION if 173\'s six arm-B control',
  'regressions survive arm C UNCHANGED. 173 carries ZERO R.5 runs (MEASURED, Session AK Step 0),',
  'so excision is a structural no-op there by construction. If those six regressions are still',
  'present, then S2 has a regression mechanism that is NOT recitation-related, operating on a',
  'corpus with no recitations at all — and repairing v6 would be treating one instance of a',
  'cause rather than the cause. Excision could then be at best a v6-local contributor, never',
  'the explanation, and global S2 would still be shipping an unexplained regression mechanism.',
].join(' ');

// ---------------------------------------------------------------------------
// THE PRE-REGISTERED PREDICTIONS. Registering these BEFORE the run is what
// makes the v6 result interpretable: v6 is the only arm that can move, so a
// v6-only improvement is evidence, while any movement on 173 or spanish is a
// falsifier of the integration itself.
// ---------------------------------------------------------------------------

export interface ArmPrediction {
  corpus: Corpus;
  r5Runs: number;
  prediction: string;
  falsifier: string;
}

export const PREDICTIONS: readonly ArmPrediction[] = [
  {
    corpus: '173',
    r5Runs: 0,
    prediction:
      'BIT-IDENTICAL to arm B on all 173 boundaries. All SIX arm-B control regressions survive '
      + 'unchanged, with identical values. R.5 excision cannot repair any of them, because there is '
      + 'nothing to excise: computeUnscriptedRuns returns ZERO runs on this corpus (MEASURED, Step 0). '
      + 'The chunk plan, the FA words and the committed array must all match arm B exactly.',
    falsifier:
      'ANY 173 boundary differing between arms B and C. That would mean the excision integration '
      + 'changes the plan on a corpus with no runs — i.e. it is doing something other than excising '
      + 'runs, and every v6 result it produces is uninterpretable until that is explained.',
  },
  {
    corpus: 'spanish',
    r5Runs: 0,
    prediction:
      'BIT-IDENTICAL to arm B, which is itself bit-identical to arm A (Session AI measured 0 of 27 '
      + 'boundaries moving under S2). Spanish is the double null: no runs to excise, and no movement '
      + 'to explain even before excision.',
    falsifier: 'Any spanish boundary moving in arm C. Same reading as 173\'s falsifier, and stronger.',
  },
  {
    corpus: 'v6',
    r5Runs: 10,
    prediction:
      'THE ONLY ARM THAT CAN MOVE. Ten runs, 41.31s total, 2.91% of the 1421.29s audio (MEASURED, '
      + 'Step 0). If R.5 excision is the cause of arm B\'s -27.7s back-half drift, the drift profile '
      + 'must COLLAPSE here and the 30 control regressions must largely repair. If excision is a '
      + 'contributor, drift shrinks but persists and some controls repair. If it is a red herring, '
      + 'the drift profile is unchanged within noise and the control count barely moves.',
    falsifier:
      'v6 arm C reproducing arm B\'s drift profile essentially unchanged falsifies the claim that '
      + 'R.5 excision fixes v6\'s regressions.',
  },
];

/**
 * A STANDING INFERENCE, recorded before the run because it follows from Step
 * 0's census alone and does not need arm C at all:
 *
 * 173 shows SIX ear-verified control regressions under arm B and carries ZERO
 * R.5 runs. Whatever mechanism produced those six is therefore, with certainty,
 * NOT recitation excision. So excision cannot be the general explanation for
 * S2's regressions before a single arm-C boundary is computed — the only open
 * question is whether it is additionally a v6-specific contributor. Arm C
 * measures the size of that contribution; it cannot promote excision to a
 * general cause.
 */
export const STANDING_INFERENCE_173 = true;

/** Every gate quantity in one object, for the harness to print verbatim. */
export const GATE = {
  hardFailMoveSec: HARD_FAIL_MOVE_SEC,
  knownBadReproductionsAllowed: KNOWN_BAD_REPRODUCTIONS_ALLOWED,
  minDefectsRequired: MIN_DEFECTS_REQUIRED,
  defectLandedSec: DEFECT_LANDED_SEC,
  earBillToleranceSec: EAR_BILL_TOLERANCE_SEC,
  minImpliedPrecision: MIN_IMPLIED_PRECISION,
  attestedCorrectCount: 615,
  attestedTotal: 620,
} as const;
