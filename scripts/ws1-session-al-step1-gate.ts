/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ===========================================================================
// WS1 Session AL — STEP 1. THE PRE-REGISTERED GATE.
//
// SAME DISCIPLINE AS SESSION AK's STEP 1, APPLIED TO A WIDTH CHANGE. Every
// threshold, bar and prediction below is fixed and committed BEFORE arm D's
// planner is written and BEFORE any alignment runs, so the result is judged
// against a standard rather than the standard fitted to the result (ruling
// R-AS, applied prospectively).
//
// This module is DATA AND PREDICATES ONLY. It computes no measurement and
// reads no arm. The measurement harness imports it and reports itself against
// it.
//
// SCOPE: v6 ONLY. The operator directs a v6-only width test this session; 173
// and spanish are NOT run (Session AK already established, MEASURED, that
// both carry zero R.5 runs and that 173 regressed 40 boundaries identically
// under arms B and C).
// ===========================================================================

import type { Corpus } from './ws1-ear-pass-ledger.js';

// ---------------------------------------------------------------------------
// HARD FAILS. Verbatim from the operator's brief; not restated in new words.
// ---------------------------------------------------------------------------

/** HARD FAIL 1 — any attested-correct v6 boundary moving beyond ±50ms from
 *  its oracle value. NOT a tuned number: it is the brief's own stated
 *  condition and the band inside which the operator has declined to treat a
 *  difference as a defect. Carried unchanged from Session AK. */
export const HARD_FAIL_MOVE_SEC = 0.050;

/** HARD FAIL 2 — reproduction of any of the 18 v6 `S1_KNOWN_BAD_MOVES`
 *  values. That set is the project's only labelled NEGATIVE ground truth. */
export const KNOWN_BAD_REPRODUCTIONS_ALLOWED = 0;

/** Match tolerance for "reproduced a known-bad value" — the ear ledger's own
 *  pin tolerance (`EAR_PIN_TOLERANCE_SEC`), unchanged. */
export const KNOWN_BAD_MATCH_SEC = 0.005;

// ---------------------------------------------------------------------------
// THE SUCCESS BAR — required, and stated as one number per the brief.
// ---------------------------------------------------------------------------

/** v6's three open defects at their ear targets. Values carried verbatim from
 *  `ws1-session-ak-step1-gate.ts`; this session adds and moves nothing. */
export const V6_OPEN_DEFECTS: ReadonlyArray<{
  corpus: Corpus; tag: string; boundary: string; prod: number; ear: number; operatorTargeted: boolean;
}> = [
  { corpus: 'v6', tag: '214_solitary_fire', boundary: '213-214', prod: 629.01, ear: 630.09, operatorTargeted: true },
  { corpus: 'v6', tag: '231_slowing_pace', boundary: '230-231', prod: 681.63, ear: 682.74, operatorTargeted: true },
  { corpus: 'v6', tag: '447_scout_facing_dark', boundary: '446-447', prod: 1417.12, ear: 1418.53, operatorTargeted: true },
];

/** A defect COUNTS AS LANDED at this tolerance — the same band as
 *  `HARD_FAIL_MOVE_SEC` by construction, because a boundary cannot be "close
 *  enough to be correct" at one tolerance and "far enough to be a regression"
 *  at another. */
export const DEFECT_LANDED_SEC = 0.050;

/**
 * MY BAR: **3 of 3.** All three of v6's open defects must land within ±50ms.
 *
 * Why not lower, stated before the numbers exist:
 *
 *   * A bar of 1 IS NO BAR. Arm C — the arm this session exists to improve on
 *     — already lands exactly 1 of v6's 3 (`447_scout_facing_dark`, MEASURED
 *     Session AK), and so does arm B. A bar an existing arm already clears
 *     cannot distinguish this change's contribution from zero.
 *   * A bar of 2 buys exactly one additional defect while the arm is still
 *     free to move hundreds of the 444 attested-correct v6 boundaries. That
 *     is not a trade anyone can sign, and it is the same reasoning Session AK
 *     used to refuse a bar of 3-of-5.
 *   * The operator named all three. Setting a bar below the operator's own
 *     stated target after seeing which row is easy is exactly what R-AS
 *     forbids.
 *
 * NOTE the asymmetry deliberately: this bar is NECESSARY for a ship-track
 * pass, not SUFFICIENT. The ship cap below can fail an arm that lands 3 of 3.
 */
export const MIN_DEFECTS_REQUIRED = 3;

// ---------------------------------------------------------------------------
// REGRESSION THRESHOLDS — the second thing the brief requires stated up front.
// ---------------------------------------------------------------------------

/**
 * Arm C's MEASURED v6 control-regression count against the AJ-0 oracle
 * (Session AK Step 5): 279 attested-correct boundaries moved more than
 * `EAR_BILL_TOLERANCE_SEC` off their oracle value.
 */
export const ARM_C_V6_REGRESSIONS = 279;

/**
 * Production's (arm A's) MEASURED v6 count: 1. That single row is
 * `102_frozen_scouts`, oracle 306.42 vs committed 306.43 — a 10ms bookkeeping
 * difference well inside `HARD_FAIL_MOVE_SEC`, i.e. production has ZERO
 * boundaries the operator would hear as moved. The brief's "production's 0" is
 * this, stated at the 50ms band; the 1 is stated at the 5ms ear-bill band.
 * Both are recorded so neither can be quietly swapped for the other.
 */
export const ARM_A_V6_REGRESSIONS_5MS = 1;
export const ARM_A_V6_REGRESSIONS_50MS = 0;

/** WORSE THAN ARM C: arm D regressions **> 279**. */
export const WORSE_THAN_ARM_C_ABOVE = ARM_C_V6_REGRESSIONS;

/** WORSE THAN PRODUCTION: arm D regressions **> 1** at the 5ms ear-bill band
 *  (equivalently **> 0** at the 50ms hard-fail band). Any arm that moves a
 *  second attested-correct v6 boundary off its oracle value is, on this
 *  measure alone, worse than what ships today. Stated plainly because it is
 *  the bar that actually matters for shipping and the one every S2 arm so far
 *  has failed by two orders of magnitude. */
export const WORSE_THAN_PRODUCTION_ABOVE = ARM_A_V6_REGRESSIONS_5MS;

/**
 * MATERIALLY BETTER THAN ARM C — the Step 5 arm-E trigger, fixed now so it
 * cannot be relaxed to justify running arm E (or tightened to avoid running
 * it). Arm D must at least HALVE arm C's count: **<= 139**.
 *
 * Half is not arbitrary. Arm C already bought a 14.3% reduction off arm B
 * (326 -> 279) from excision alone. A width change that cannot beat that by a
 * wide margin is inside the range one already-measured, non-width variable
 * moves, and attributing anything to width in that regime is not supportable.
 */
export const MATERIALLY_BETTER_AT_OR_BELOW = Math.floor(ARM_C_V6_REGRESSIONS / 2);

/** NOT MATERIALLY BETTER (no arm E, report the negative): anything above the
 *  line above. A count in (139, 279] is an improvement that does not license
 *  an attribution run; a count > 279 is a straight regression against arm C. */

// ---------------------------------------------------------------------------
// THE SHIP CAP — carried verbatim from Session AK's gate, unchanged.
// ---------------------------------------------------------------------------

/** A move of <= 5ms preserves the operator's standing verdict
 *  (`earPassAuthorising`); a larger move does not, and creates exactly one
 *  unit of ear work. Every open defect landed removes exactly one. */
export const EAR_BILL_TOLERANCE_SEC = 0.005;

/** A change that creates more ear work than it closes cannot be shipped on the
 *  strength of its own measurement. Equivalently: implied boundary-improvement
 *  precision >= 50%. For scale, both MEASURED: S1 ~7% (rejected 18/18 on ear
 *  audit), arm B ~0.3% on v6, arm C 0.36% on v6. */
export const MIN_IMPLIED_PRECISION = 0.50;

/** v6's attested-correct count: 447 boundaries, 3 of which are the open
 *  defects. */
export const V6_ATTESTED_TOTAL = 447;
export const V6_ATTESTED_CORRECT = 444;

// ---------------------------------------------------------------------------
// OPERATOR-DIRECTED PARAMETERS. Labelled as such, per the brief — these are
// NOT derived from any corpus row and NOT fitted. They are the band the
// operator asked to be tested.
// ---------------------------------------------------------------------------

/** OPERATOR-DIRECTED (this session's brief: "period-strict 1-15s chunking"). */
export const AL_TARGET_MIN_SEC = 1;
/** OPERATOR-DIRECTED, and a HARD CAP per invariant 5. */
export const AL_TARGET_MAX_SEC = 15;
/** OPERATOR-DIRECTED — inherited unchanged from `S2_SILENCE_SEARCH_WINDOW_SEC`
 *  so this stays a ONE-VARIABLE change from arm C. Not re-derived, not
 *  re-tuned; see the self-check in the session report. */
export const AL_SILENCE_SEARCH_WINDOW_SEC = 5.0;

// ---------------------------------------------------------------------------
// PREDICTION 1 — CHUNK COUNT AND RESOURCES.
//
// Derived from ARITHMETIC ON ALREADY-PUBLISHED NUMBERS ONLY. Registered before
// the planner exists, so no v6 group-duration table informs it.
// ---------------------------------------------------------------------------

export const PREDICTION_CHUNK_COUNT = {
  point: 115,
  lo: 95,
  hi: 150,
  reasoning: [
    'v6 is 1421.29s. A greedy packer with a 15s hard cap cannot average more than 15s per chunk,',
    'so 1421.29/15 = 94.8 is a FLOOR (hence lo = 95). Sentence groups are the atoms; arm A emitted',
    '277 chunks at mean 4.98s, and S2 groups are the same order, so the expected shortfall from the',
    'cap is about half an atom, giving a mean of roughly 15 - 4/2 = 13s and 1421.29/13 = 109 chunks.',
    'Ten R.5 excision seams force up to 10 additional breaks, and the anti-degeneracy merge removes',
    'at most one. Point estimate 115; hi = 150 allows for atoms materially larger than arm A\'s mean.',
  ].join(' '),
} as const;

export const PREDICTION_RESOURCES = {
  armCWallClockSec: 644.81,
  armCPeakRssMB: 3205.3,
  wallClockLoSec: 300,
  wallClockHiSec: 450,
  peakRssLoMB: 2100,
  peakRssHiMB: 2600,
  reasoning: [
    'BOTH DOWN, and for different reasons. Wall clock: transformer attention is quadratic in chunk',
    'length, so total cost tracks the sum of squared chunk durations, not total audio. Arm C is',
    '57 chunks at mean 24.2s (sum of squares on the order of 3.6e4 s^2); arm D at ~115 chunks and a',
    '~13s mean is on the order of 1.9e4 s^2, a ratio near 0.53, giving 644.81 * 0.53 = 342s. Band',
    '300-450s. Peak RSS: dominated by the LARGEST single chunk (arm C\'s was 43.91s) over a fixed',
    'model/session baseline that spanish pins at about 1938 MB. Arm D\'s largest chunk is 15s except',
    'at a cap violation, so the marginal term should fall to roughly a third of arm C\'s. Band',
    '2100-2600 MB. A peak RSS ABOVE arm C\'s would mean peak memory is not chunk-width-driven at all.',
  ].join(' '),
} as const;

// ---------------------------------------------------------------------------
// PREDICTION 2 — THE DRIFT SHAPE. The load-bearing one. BOTH branches are
// registered so the result is interpretable whichever way it lands.
//
// Session AK MEASURED v6's S2 drift as an ARCH in both arms: mean per-decile
// delta rises from about -0.9s, peaks at decile 5 (arm B -23.786s, arm C
// -19.155s), and returns to +0.157s in decile 9 — identically in both arms.
// That retired the "cumulative drift" framing. This session asks a different
// question of the same curve: is its AMPLITUDE set by chunk width?
// ---------------------------------------------------------------------------

/** The measured arm-B and arm-C per-decile mean deltas, so the harness can
 *  compare against them without re-deriving Session AK's table. MEASURED,
 *  Session AK Step 5, `.work-phase4/session-ak/step4-measure.json`. */
export const AK_V6_DRIFT_MEAN: ReadonlyArray<{ decile: number; armB: number; armC: number }> = [
  { decile: 0, armB: -0.968, armC: -0.877 },
  { decile: 1, armB: -2.677, armC: -1.762 },
  { decile: 2, armB: -9.241, armC: -8.151 },
  { decile: 3, armB: -17.353, armC: -13.534 },
  { decile: 4, armB: -23.252, armC: -17.366 },
  { decile: 5, armB: -23.786, armC: -19.155 },
  { decile: 6, armB: -17.848, armC: -14.801 },
  { decile: 7, armB: -12.318, armC: -7.810 },
  { decile: 8, armB: -2.735, armC: -1.348 },
  { decile: 9, armB: 0.157, armC: 0.157 },
];

/** MEASURED median chunk widths, Session AK Step 5. Arm D's is measured in
 *  Step 3 of this session and compared against these. */
export const AK_V6_MEDIAN_WIDTH_SEC = { A: 4.04, B: 27.44, C: 26.06 } as const;

/**
 * IF CHUNK WIDTH CAUSES THE ARCH. The arch's amplitude is a function of how
 * much audio one chunk spans, so halving the median width must roughly halve
 * the peak. Concretely, registered as three simultaneous conditions:
 *
 *   (a) peak |mean decile delta| <= 10.0s — i.e. at most ~52% of arm C's
 *       19.155s, tracking arm D's median width being ~50% of arm C's;
 *   (b) the amplitude ordering A < D < C < B holds across all four arms, i.e.
 *       peak |drift| is MONOTONE INCREASING in median chunk width; and
 *   (c) the curve keeps its arch shape — still peaking mid-corpus and still
 *       returning to |final decile| < 1.0s — because width scales the
 *       amplitude, it does not change what re-anchors the ends.
 *
 * The strong form, also registered: arm A's median width is 4.04s at ~0 drift
 * and arm C's is 26.06s at 19.155s, so a purely width-driven mechanism
 * interpolated linearly puts arm D's ~13s median at about 8.2s of peak drift.
 */
export const SHAPE_IF_WIDTH_CAUSES = {
  peakAbsMeanAtMostSec: 10.0,
  linearInterpolationPointSec: 8.2,
  requiresMonotoneInWidth: true,
  requiresArchRetained: true,
  finalDecileAbsAtMostSec: 1.0,
} as const;

/**
 * IF WIDTH IS IRRELEVANT. The arch is set by something every S2-family arm
 * shares regardless of band, so arm D reproduces it at essentially arm C's
 * amplitude despite roughly half the width:
 *
 *   (a) peak |mean decile delta| >= 14.0s — within ~25% of arm C's 19.155s;
 *   (b) the peak sits in the SAME decile (4, 5 or 6) as arms B and C; and
 *   (c) the final decile returns to the same +0.157s ± 0.5s.
 *
 * WHAT THAT WOULD ELIMINATE, registered now so it is not invented afterwards:
 * it eliminates chunk WIDTH as the driver and leaves the mechanisms that are
 * INVARIANT across the 1-15s, 10-30s and excised 10-30s bands — chiefly that
 * every S2-family arm places its chunk edges from `applyAnchorBasedTiming`'s
 * character-weight ESTIMATE (via `segment.startTime`), whereas production's
 * `computeFaChunkPlan` places them at `faAnchors.ts`'s three-source-agreement
 * anchors. It does NOT by itself prove that alternative; it removes width.
 */
export const SHAPE_IF_WIDTH_IRRELEVANT = {
  peakAbsMeanAtLeastSec: 14.0,
  peakDecileIn: [4, 5, 6] as readonly number[],
  finalDecileSec: 0.157,
  finalDecileToleranceSec: 0.5,
} as const;

/**
 * THE INDEPENDENT DISCRIMINATOR, registered before it is computed. If width is
 * irrelevant and the estimate-placed-edge mechanism is what remains, then arm
 * D's per-decile drift must track the per-decile error of the ANCHOR-BASED
 * ESTIMATE itself (`applyAnchorBasedTiming(anchorTimed)` minus the oracle) —
 * a quantity that involves no FA, no chunk plan and no band at all, and that
 * is therefore identical for arms B, C and D by construction.
 *
 * Registered threshold: Pearson r >= 0.85 between arm D's ten per-decile mean
 * deltas and the estimate's ten per-decile mean errors counts as TRACKING.
 * Below 0.5 counts as NOT TRACKING and leaves the mechanism open.
 *
 * This is a DIAGNOSTIC, not a proposal. Session AL ships no architecture.
 */
export const ESTIMATE_TRACKING_R_AT_LEAST = 0.85;
export const ESTIMATE_TRACKING_R_BELOW = 0.50;

/**
 * THE FALSIFIER for "chunk width drives v6's drift", stated as one sentence so
 * the self-check can answer whether it fired:
 *
 *   Arm D reproducing the arch at an amplitude that does NOT scale down with
 *   its median chunk width — peak |mean decile delta| >= 14.0s at a median
 *   width near half arm C's — falsifies the claim.
 */
export const WIDTH_FALSIFIER = [
  'Arm D reproducing the arch at an amplitude that does not scale down with its median chunk width',
  '(peak |mean decile delta| >= 14.0s at a median width near half of arm C\'s 26.06s) falsifies the',
  'claim that chunk width drives v6\'s drift.',
].join(' ');

/** Every gate quantity in one object, for the harness to print verbatim. */
export const AL_GATE = {
  scope: 'v6 only',
  hardFailMoveSec: HARD_FAIL_MOVE_SEC,
  knownBadReproductionsAllowed: KNOWN_BAD_REPRODUCTIONS_ALLOWED,
  minDefectsRequired: MIN_DEFECTS_REQUIRED,
  defectLandedSec: DEFECT_LANDED_SEC,
  earBillToleranceSec: EAR_BILL_TOLERANCE_SEC,
  minImpliedPrecision: MIN_IMPLIED_PRECISION,
  v6AttestedTotal: V6_ATTESTED_TOTAL,
  v6AttestedCorrect: V6_ATTESTED_CORRECT,
  worseThanArmCAbove: WORSE_THAN_ARM_C_ABOVE,
  worseThanProductionAbove: WORSE_THAN_PRODUCTION_ABOVE,
  materiallyBetterAtOrBelow: MATERIALLY_BETTER_AT_OR_BELOW,
  targetMinSec: AL_TARGET_MIN_SEC,
  targetMaxSec: AL_TARGET_MAX_SEC,
  silenceSearchWindowSec: AL_SILENCE_SEARCH_WINDOW_SEC,
} as const;
