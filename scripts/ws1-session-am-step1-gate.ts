/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ===========================================================================
// WS1 Session AM — STEP 1. THE PRE-REGISTERED GATE.
//
// Committed as a STANDALONE SHA before `computeFaChunkPlanS2EdgeArm` exists,
// before the substitution surface is measured, and before either arm F or arm
// G is aligned. Ruling R-AS applied prospectively: the result is judged
// against a standard, never the standard fitted to the result.
//
// This module is DATA AND PREDICATES ONLY. It computes no measurement, reads
// no arm, and imports nothing from `src/`. The measurement harness imports it
// and reports itself against it.
//
// SCOPE: v6 ONLY. The operator directs a v6-only test this session; 173 and
// spanish are explicitly NOT run.
//
// THE QUESTION THIS SESSION ASKS. Session AL closed chunk WIDTH negative:
// halving the band (arm D, median 12.86s) RAISED peak drift to -20.617s
// against arm C's -19.155s at 26.06s, and broke the monotone-in-width
// ordering the width hypothesis required. The same session found the arch in
// `applyAnchorBasedTiming`'s OWN per-decile error against the oracle (peak
// -23.347s) and measured r = 0.9940 / 0.9778 / 0.9732 between that curve and
// arms D / B / C. Every S2-family arm places its chunk edges by snapping a
// detected silence to a seam time READ OFF THAT ESTIMATE. Production does not:
// `computeFaChunkPlan` pairs each chunk edge with a `faAnchors.ts`
// three-source-agreement anchor BY SCRIPT-WORD INDEX (`runQiRanges`), never by
// time, and production's per-decile drift is identically zero.
//
//   ARM F asks: does replacing the estimate-derived edge with an anchor-placed
//               one kill the arch?
//   ARM G asks: if chunk edges were PERFECT, would the arch go away at all?
//               It is the CEILING for any chunk-plan-based fix, and it can
//               never ship — it consumes the oracle.
// ===========================================================================

import type { Corpus } from './ws1-ear-pass-ledger.js';

// ---------------------------------------------------------------------------
// 1. HARD FAILS. Verbatim from the operator's brief; not restated in new words.
// ---------------------------------------------------------------------------

/** HARD FAIL 1 — any attested-correct v6 boundary moving beyond ±50ms from its
 *  oracle value. NOT a tuned number: it is the brief's own stated condition and
 *  the band inside which the operator has declined to treat a difference as a
 *  defect. Carried unchanged from Sessions AK and AL. */
export const HARD_FAIL_MOVE_SEC = 0.050;

/** HARD FAIL 2 — reproduction of any of the 18 v6 `S1_KNOWN_BAD_MOVES` values.
 *  That set is the project's only labelled NEGATIVE ground truth. */
export const KNOWN_BAD_REPRODUCTIONS_ALLOWED = 0;

/** Match tolerance for "reproduced a known-bad value" — the ear ledger's own
 *  pin tolerance (`EAR_PIN_TOLERANCE_SEC`), unchanged. */
export const KNOWN_BAD_MATCH_SEC = 0.005;

// ---------------------------------------------------------------------------
// 2. THE SUCCESS BAR — required, and stated as one number, with its
//    justification against the fact that arms B/C/D already land exactly 1.
// ---------------------------------------------------------------------------

/** v6's three open defects at their ear targets. Values carried verbatim from
 *  `ws1-session-al-step1-gate.ts`; this session adds and moves nothing. */
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
 * The brief requires this number justified against the measured fact that arms
 * B, C and D each already land exactly 1 — `447_scout_facing_dark` — and that
 * they do so identically. Stated before any arm F/G number exists:
 *
 *   * A BAR OF 1 IS NO BAR AT ALL. It is already cleared by three arms this
 *     session exists to improve on, two of which were rejected. A bar an
 *     existing rejected arm clears cannot distinguish this change's
 *     contribution from zero, and would let arm F "pass" while doing nothing.
 *   * WORSE: the one row all three land is the SAME row every time, and it is
 *     v6's LAST boundary (index 446 of 447). Session AL measured the final
 *     decile of every arm's drift at ~+0.15s — i.e. every S2 arm is already
 *     accurate at the corpus end regardless of what it does everywhere else.
 *     `447_scout_facing_dark` is therefore the row LEAST diagnostic of an
 *     edge-placement change; crediting it is crediting the corpus's geometry,
 *     not the arm.
 *   * A BAR OF 2 buys exactly one genuinely new row while the arm stays free
 *     to move hundreds of the 444 attested-correct boundaries. That is not a
 *     trade anyone can sign, and it is the same reasoning Sessions AK and AL
 *     used to refuse their own reduced bars.
 *   * The operator named all three. Setting a bar below the operator's own
 *     stated target after seeing which row is easy is exactly what R-AS
 *     forbids.
 *
 * NOTE the asymmetry deliberately: this bar is NECESSARY for a ship-track
 * pass, not SUFFICIENT. The ship cap below can fail an arm that lands 3 of 3.
 * And it does not apply to arm G at all — arm G cannot ship on any result.
 */
export const MIN_DEFECTS_REQUIRED = 3;

/** The measured, identical baseline the bar above is justified against. */
export const DEFECTS_LANDED_BY_EXISTING_ARMS = {
  armB: 1, armC: 1, armD: 1,
  theRow: '447_scout_facing_dark',
  note: 'MEASURED Session AL Step 4 — the same single row in all three arms, and it is v6\'s LAST '
    + 'boundary, where every arm\'s drift has already returned to ~+0.15s.',
} as const;

// ---------------------------------------------------------------------------
// 3. REGRESSION THRESHOLDS.
// ---------------------------------------------------------------------------

/** Arm C's MEASURED v6 control-regression count against the AJ-0 oracle
 *  (Session AK Step 5, re-confirmed Session AL Step 4): 279 attested-correct
 *  boundaries moved more than `EAR_BILL_TOLERANCE_SEC` off their oracle value. */
export const ARM_C_V6_REGRESSIONS = 279;
/** MEASURED Session AI/AL. */
export const ARM_B_V6_REGRESSIONS = 326;
/** MEASURED Session AL. */
export const ARM_D_V6_REGRESSIONS = 363;

/**
 * Production's (arm A's) MEASURED v6 count: 1. That single row is
 * `102_frozen_scouts`, oracle 306.42 vs committed 306.43 — a 10ms bookkeeping
 * difference well inside `HARD_FAIL_MOVE_SEC`, i.e. production has ZERO
 * boundaries the operator would hear as moved. Both bands are recorded so
 * neither can be quietly swapped for the other.
 */
export const ARM_A_V6_REGRESSIONS_5MS = 1;
export const ARM_A_V6_REGRESSIONS_50MS = 0;

/** WORSE THAN ARM C: regressions **> 279**. */
export const WORSE_THAN_ARM_C_ABOVE = ARM_C_V6_REGRESSIONS;

/** WORSE THAN PRODUCTION: regressions **> 1** at the 5ms ear-bill band
 *  (equivalently **> 0** at the 50ms hard-fail band). Any arm that moves a
 *  second attested-correct v6 boundary off its oracle value is, on this measure
 *  alone, worse than what ships today. */
export const WORSE_THAN_PRODUCTION_ABOVE = ARM_A_V6_REGRESSIONS_5MS;

/**
 * MATERIALLY BETTER THAN ARM C — the figure that would justify continuing the
 * S2 family, fixed now with its reasoning so it cannot be relaxed afterwards to
 * rescue a disappointing arm, or tightened to bury a good one: **<= 139**, i.e.
 * arm C's count at least HALVED.
 *
 * Why half, and not "any improvement":
 *
 *   * The S2 family's measured spread from ALREADY-TESTED, NON-EDGE variables
 *     is 326 -> 279 -> 363. R.5 excision alone bought 47 rows (14.4%); a
 *     halved band cost 84. So a movement of a few tens of rows is inside the
 *     range that variables having nothing to do with edge placement already
 *     move, and attributing such a movement to edge placement is not
 *     supportable.
 *   * 139 is still 139x production's 1. Halving is a diagnostic threshold for
 *     "keep going", NOT a ship threshold — the ship threshold is
 *     `MIN_IMPLIED_PRECISION` below, which is far harsher and which nothing in
 *     the S2 family has come near.
 */
export const MATERIALLY_BETTER_AT_OR_BELOW = Math.floor(ARM_C_V6_REGRESSIONS / 2);

// ---------------------------------------------------------------------------
// 4. ARCH-SURVIVAL BANDS. NUMERIC AND FIXED NOW.
//
// The brief fixes these; they are transcribed, not chosen. Anything strictly
// between the two bands is PARTIAL and is REPORTED as partial — the band is
// never retro-fitted after the number is seen, and Step 6's PARTIAL row
// (ship nothing, iterate no bands, name the one resolving measurement) is the
// pre-committed consequence.
// ---------------------------------------------------------------------------

/** DIED: peak |mean decile Δ| <= 5.0s. */
export const ARCH_DIED_AT_OR_BELOW_SEC = 5.0;
/** SURVIVED: peak |mean decile Δ| >= 14.0s. */
export const ARCH_SURVIVED_AT_OR_ABOVE_SEC = 14.0;

export type ArchVerdict = 'DIED' | 'PARTIAL' | 'SURVIVED';

/** The ONLY classifier. No arm gets its own. */
export function archVerdict(peakAbsMeanDecileSec: number): ArchVerdict {
  if (peakAbsMeanDecileSec <= ARCH_DIED_AT_OR_BELOW_SEC) return 'DIED';
  if (peakAbsMeanDecileSec >= ARCH_SURVIVED_AT_OR_ABOVE_SEC) return 'SURVIVED';
  return 'PARTIAL';
}

// ---------------------------------------------------------------------------
// 5. THE MEASURED BASELINE ARMS AND ANCHOR-ESTIMATE CURVE, so the harness
//    compares against them without re-deriving Sessions AK/AL's tables.
//    MEASURED, `.work-phase4/session-al/step4-measure.json`.
// ---------------------------------------------------------------------------

export const AL_V6_DRIFT_MEAN: ReadonlyArray<{
  decile: number; n: number; armB: number; armC: number; armD: number; estimate: number;
}> = [
  { decile: 0, n: 47, armB: -0.9678, armC: -0.8767, armD: -2.2383, estimate: -5.0556 },
  { decile: 1, n: 48, armB: -2.6771, armC: -1.7619, armD: -5.9656, estimate: -7.3021 },
  { decile: 2, n: 48, armB: -9.2406, armC: -8.1508, armD: -9.4733, estimate: -11.3624 },
  { decile: 3, n: 47, armB: -17.3534, armC: -13.5338, armD: -14.2430, estimate: -16.6710 },
  { decile: 4, n: 52, armB: -23.2519, armC: -17.3663, armD: -18.6271, estimate: -22.3701 },
  { decile: 5, n: 42, armB: -23.7864, armC: -19.1546, armD: -20.6175, estimate: -23.3473 },
  { decile: 6, n: 40, armB: -17.8480, armC: -14.8012, armD: -15.3744, estimate: -17.4776 },
  { decile: 7, n: 42, armB: -12.3181, armC: -7.8098, armD: -10.3641, estimate: -12.3208 },
  { decile: 8, n: 37, armB: -2.7351, armC: -1.3478, armD: -5.0773, estimate: -6.5227 },
  { decile: 9, n: 44, armB: 0.1573, armC: 0.1573, armD: 0.1466, estimate: 0.9570 },
];

/** MEASURED peak |mean decile Δ| per already-run arm. */
export const AL_V6_PEAK_ABS_SEC = { A: 0.000, B: 23.786, C: 19.155, D: 20.617 } as const;
/** MEASURED median chunk widths per already-run arm. */
export const AL_V6_MEDIAN_WIDTH_SEC = { A: 4.04, B: 27.44, C: 26.06, D: 12.86 } as const;
/** MEASURED chunk counts per already-run arm. */
export const AL_V6_CHUNK_COUNT = { A: 277, B: 54, C: 57, D: 110 } as const;
/** MEASURED Pearson r between each arm's per-decile drift and the anchor-based
 *  estimate's own per-decile error. The estimate curve involves no FA, no chunk
 *  plan and no band, so it is identical across every arm by construction — the
 *  one reference in this workstream that an arm cannot move. */
export const AL_V6_ESTIMATE_R = { B: 0.9778, C: 0.9732, D: 0.9940 } as const;
/** MEASURED anchor-estimate error peak — the amplitude every S2 arm's arch
 *  sits at or below. */
export const ESTIMATE_PEAK_ABS_SEC = 23.347;

/** MEASURED arm C resources, Session AK. Arm F and arm G are predicted against
 *  these because both share arm C's packing exactly. */
export const ARM_C_RESOURCES = { wallClockSec: 644.81, peakRssMB: 3205.3 } as const;

// ---------------------------------------------------------------------------
// 6. THE EDGE-PLACEMENT TOLERANCE, registered BEFORE the substitution surface
//    is measured — which is the whole point of registering it.
// ---------------------------------------------------------------------------

/**
 * ARM F's anchor search is INDEX-SPACE, and its tolerance is STRUCTURAL —
 * **GEOMETRIC, not FITTED**, and carries no numeric constant at all.
 *
 * THE RULE, fixed here: a chunk seam sits at a definite script-word index
 * `seamQi` (the `queryWords` boundary between the last segment of the closing
 * sentence group and the first segment of the opening one). Arm F takes the
 * anchor whose OWN `qi` is nearest `seamQi` **measured in index space**, and
 * commits that anchor's `timeSec`. The anchor is admissible only if its `qi`
 * lies inside the two sentence groups the seam separates — the closing group
 * and the opening group. Nothing else is admissible; there is no millisecond
 * window and no tunable radius.
 *
 * WHY INDEX SPACE AND NOT A TIME WINDOW. `CLAUDE.md` §4: "Timestamps may
 * measure distance; they must never decide identity." Deciding WHICH anchor IS
 * this seam is an identity question, and the worked violation named in that
 * invariant is `faAnchors.ts`'s own `findAgreeingSilence` matching by
 * timestamp proximity. A time-radius search would also be self-defeating here:
 * the ideal seam time is READ OFF THE ESTIMATE, so searching near it in time
 * would re-import the very error arm F exists to remove. Index space is the
 * only space in which the seam and the anchor can be compared without the
 * estimate in the loop.
 *
 * WHY THE TWO-GROUP WINDOW IS STRUCTURAL. Sentence groups are the planner's
 * own atoms — the only places invariant 2 permits an edge. An anchor outside
 * the group pair belongs to a DIFFERENT legal seam, and committing it here
 * would place this chunk's edge at another chunk's boundary. The window is
 * therefore a consequence of a rule already in force, not a parameter.
 *
 * AN EXACT HIT (`anchor.qi === seamQi`) IS THE SEAM ITSELF, not an
 * approximation: `faAnchors.ts` defines an anchor's `timeSec` as the END of
 * the detected silence spanning the token seam immediately before script word
 * `qi`, which is precisely "the instant word `qi` begins". Δqi = 0 means the
 * anchor IS the boundary.
 *
 * TIE-BREAK, stated so it is a decision rather than an accident: on equal
 * |Δqi| prefer the anchor at or after the seam (`qi >= seamQi`). Structural
 * reasoning — a chunk's TEXT is fixed by packing, so an edge placed late
 * leaves the closing chunk holding audio for words it also holds text for,
 * while an edge placed early hands the opening chunk audio for words whose
 * text stayed behind. Late is the recoverable direction.
 */
export const ARM_F_TOLERANCE = {
  space: 'script-word index (qi)',
  rule: 'nearest anchor by |anchor.qi - seamQi|, admissible only within the two sentence groups the seam separates',
  tieBreak: 'on equal |Δqi|, prefer qi >= seamQi',
  numericConstants: 0,
  label: 'GEOMETRIC (structural — derived from the planner\'s own group atoms; no millisecond radius, no tunable)',
} as const;

/**
 * FALLBACK, and the honesty condition the brief attaches to it. Where no
 * admissible anchor exists, arm F falls back to ARM C'S OWN cut
 * (`s2NearestSilenceCut` against the estimate-derived ideal seam) — i.e. that
 * edge is NOT substituted and remains an arm-C edge.
 *
 * If the fallback rate EXCEEDS ONE THIRD of internal seams, arm F is a PARTIAL
 * SUBSTITUTION and its result cannot fully answer the question. That is stated
 * plainly in the report and is not softened afterwards. Registered as a number
 * so it cannot be re-read as a judgement call.
 */
export const ARM_F_FALLBACK_PARTIAL_ABOVE = 1 / 3;

/**
 * THE CONFOUND CHECK, registered before the anchor set is looked at. If
 * `faAnchors.ts`'s v6 anchor coverage is itself FRONT-LOADED along the
 * timeline — dense early, sparse mid-corpus — then arm F would produce an arch
 * BY ITSELF, from its own fallback pattern, and a surviving arch would be
 * uninterpretable. Registered threshold: anchors are UNIFORM if every decile
 * holds at least half the mean per-decile anchor count, FRONT-LOADED
 * otherwise. Reported either way.
 */
export const ANCHOR_UNIFORMITY_MIN_DECILE_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// 7. ARM G — THE CEILING. DIAGNOSTIC ONLY; CAN NEVER SHIP.
// ---------------------------------------------------------------------------

/**
 * Arm G places every internal chunk edge at the ORACLE's own attested boundary
 * time for the segment that opens the next chunk. It consumes ground truth,
 * so:
 *
 *   * it CANNOT SHIP, on any result, ever;
 *   * it has NO PRODUCTION CALLER and cannot be reached by any default path —
 *     the attested table is a REQUIRED parameter with no default, so an arm-G
 *     plan is unconstructible without a caller that already holds all 447
 *     oracle values;
 *   * the gate's SUCCESS BAR and SHIP CAP are NOT APPLIED to it. Applying a
 *     ship gate to an unshippable arm would be theatre.
 *
 * Its single job is to answer: IF CHUNK EDGES WERE PERFECT, WOULD THE ARCH GO
 * AWAY? Its `HARD FAIL` rows are still reported, because a ceiling arm that
 * reproduced a known-bad value would indicate the harness is broken.
 */
export const ARM_G_IS_DIAGNOSTIC_ONLY = true;
export const ARM_G_SHIP_GATE_APPLIES = false;

/**
 * ARM G'S FIDELITY CAVEAT, registered before the mapping is measured, because
 * the worth of arm G's answer is exactly the fidelity of this mapping.
 *
 * The AJ-0 oracle carries 447 boundaries, one per segment index, contiguous —
 * so EVERY segment that could open a chunk has an attested time and the
 * seam -> time mapping is TOTAL. But THREE of those 447 values are v6's OPEN
 * DEFECTS, and for those rows the oracle stores the DEFECTIVE production value
 * (629.01 / 681.63 / 1417.12), not the ear target. If a chunk seam lands on one
 * of those three segments, arm G's "perfect" edge is at a known-wrong time.
 * Measured and reported in Step 4; the ceiling's interpretation is qualified by
 * it rather than the caveat being dropped.
 */
export const ARM_G_DEFECTIVE_ORACLE_ROWS = 3;

// ---------------------------------------------------------------------------
// 8. THE SHIP CAP — carried verbatim from Sessions AK and AL, unchanged.
// ---------------------------------------------------------------------------

/** A move of <= 5ms preserves the operator's standing verdict
 *  (`earPassAuthorising`); a larger move does not, and creates exactly one unit
 *  of ear work. Every open defect landed removes exactly one. */
export const EAR_BILL_TOLERANCE_SEC = 0.005;

/** A change that creates more ear work than it closes cannot be shipped on the
 *  strength of its own measurement. Equivalently: implied boundary-improvement
 *  precision >= 50%. For scale, all MEASURED: S1 ~7% (rejected 18/18 on ear
 *  audit, ruling R-AS), arm B 0.31% on v6, arm C 0.36%, arm D 0.27%. */
export const MIN_IMPLIED_PRECISION = 0.50;

/** MEASURED R-AS precision of each already-run arm, for the report's scale row. */
export const AL_V6_PRECISION = { S1: 0.07, B: 0.0031, C: 0.0036, D: 0.0027 } as const;

/** v6's attested-correct count: 447 boundaries, 3 of which are the open
 *  defects. */
export const V6_ATTESTED_TOTAL = 447;
export const V6_ATTESTED_CORRECT = 444;

// ---------------------------------------------------------------------------
// 9. OPERATOR-DIRECTED PARAMETERS. Labelled as such — NOT derived from any
//    corpus row and NOT fitted.
// ---------------------------------------------------------------------------

/** OPERATOR-DIRECTED, and inherited UNCHANGED from arm C so arm F is one
 *  variable from an EXISTING arm. The brief names arm C — not arm D — as the
 *  base, so the band is 10-30s, not 1-15s. */
export const AM_TARGET_MIN_SEC = 10;
/** OPERATOR-DIRECTED, inherited unchanged from arm C. */
export const AM_TARGET_MAX_SEC = 30;
/** OPERATOR-DIRECTED, inherited unchanged from arm C — used ONLY by the
 *  fallback path and by violation classification, never by the anchor search. */
export const AM_SILENCE_SEARCH_WINDOW_SEC = 5.0;

// ---------------------------------------------------------------------------
// 10. PREDICTIONS. Every one carries a POINT and a BAND, for BOTH arms, and is
//     registered before the planner exists. Nine quantities each, per the brief.
// ---------------------------------------------------------------------------

export interface Prediction {
  point: number;
  lo: number;
  hi: number;
  reasoning: string;
}

const P = (point: number, lo: number, hi: number, reasoning: string): Prediction =>
  ({ point, lo, hi, reasoning });

export const PREDICTIONS_F: Readonly<Record<string, Prediction>> = {
  chunkCount: P(57, 52, 58,
    'Arm F changes ONLY where an edge is cut, never how groups are packed: same groups, same 10-30s band, '
    + 'same net-of-excision weights, same forced breaks. So the chunk count must equal arm C\'s MEASURED 57 '
    + 'unless an anchor-placed cut lands behind a cursor and collapses a window (the arm-C/arm-D collapse '
    + 'path), which can only ever REMOVE chunks. Point 57; lo 52 allows up to five collapses.'),
  medianWidthSec: P(25.0, 18.0, 32.0,
    'Same packing means the same text per chunk, so each chunk\'s width tends to the TRUE audio span of its '
    + 'text. Total is 1421.29s minus ~41.3s of excised recitation over ~57 chunks = 24.2s mean. Arm C\'s '
    + 'median is 26.06s because its edges are displaced by the estimate; anchor-placed edges should pull the '
    + 'median toward the true value. Point 25.0s, band [18, 32] — wide, because a handful of anchor cuts '
    + 'that move several seconds can shift a 57-sample median.'),
  peakAbsMeanDecileSec: P(4.0, 1.0, 9.0,
    'THE LOAD-BEARING PREDICTION. If estimate-derived edge placement is the mechanism, removing it removes '
    + 'the arch: DIED, i.e. <= 5.0s. Point 4.0s rather than ~0 because arm F is a PARTIAL substitution by '
    + 'construction — every run-opening edge stays at its R.5 run boundary, the final edge stays at '
    + 'audioDuration, and any seam without an admissible anchor falls back to arm C\'s own cut, so some '
    + 'estimate-derived edges survive no matter how good the anchor coverage is. hi = 9.0 admits a PARTIAL '
    + 'outcome; a value >= 14.0 fires the arm-F falsifier below.'),
  peakDecileIndex: P(5, 3, 7,
    'CONDITIONAL, and stated as such: a peak decile is only meaningful for a curve with real amplitude. If '
    + 'peak |Δ| < 5.0s the peak index is noise and this prediction is NOT scored. If the arch survives at '
    + 'all, it must peak where every measured arch peaks — arms B, C, D and the estimate curve itself all '
    + 'peak at decile 5.'),
  finalDecileSec: P(0.150, -0.350, 0.650,
    'Every arm measured — B, C and D — returns to +0.157 / +0.157 / +0.147 in decile 9, and the estimate '
    + 'curve to +0.957. The corpus end re-anchors regardless of what the middle does, and arm F changes '
    + 'nothing about that. Band ±0.5s.'),
  regressed: P(200, 120, 300,
    'Regression is counted at the 5ms EAR-BILL band, so it measures ANY movement, not drift: an arm can kill '
    + 'the arch and still regress hundreds of rows. What better edges buy is EXACT agreement — arm C already '
    + 'matches 164 of 447 to 1e-9 because snapCoveredBoundaries snaps both arms to the same silence. Better '
    + 'edges should raise the exact-match count and lower the regressed count below arm C\'s 279 without '
    + 'approaching production\'s 1. Point 200; hi 300 admits NO improvement at all.'),
  wallClockSec: P(650, 520, 800,
    'Transformer cost tracks the SUM OF SQUARED chunk durations. Arm F has arm C\'s chunk count and a '
    + 'similar width distribution, so the cost should sit near arm C\'s MEASURED 644.81s. Band [520, 800] '
    + 'allows the width redistribution anchor-placed edges cause.'),
  peakRssMB: P(3100, 2400, 3800,
    'Peak RSS is dominated by the LARGEST single chunk over a fixed model/session baseline (~1938 MB, pinned '
    + 'by spanish). Arm C\'s largest chunk is 43.91s at 3205.3 MB. Arm F\'s largest is unpredictable in sign '
    + '— a moved edge can lengthen or shorten the widest chunk — so the point sits just under arm C\'s with '
    + 'a symmetric band.'),
  estimateTrackingR: P(0.60, -0.30, 0.90,
    'If the arch dies, arm F\'s decile curve is small and its correlation with the estimate\'s large arch is '
    + 'not meaningful — r can be anything, which is why the band is wide and centred low. The REGISTERED '
    + 'claim is the negative one: r < 0.85, i.e. arm F must NOT track the estimate the way arms B (0.9778), '
    + 'C (0.9732) and D (0.9940) all do. r >= 0.85 with a surviving arch means the estimate is still in the '
    + 'loop and the substitution did not take.'),
};

export const PREDICTIONS_G: Readonly<Record<string, Prediction>> = {
  chunkCount: P(57, 50, 58,
    'Identical reasoning to arm F: packing is untouched, only cut times move. Arm G\'s edges move FURTHER '
    + 'from arm C\'s than arm F\'s do (an oracle time is the true boundary, and the estimate is up to 23s off '
    + 'mid-corpus), so the collapse path is more likely and lo is one lower.'),
  medianWidthSec: P(24.2, 19.0, 30.0,
    'Arm G\'s edges are the TRUE boundaries, so each chunk\'s width IS the true audio span of its text. Total '
    + '1421.29s minus ~41.3s excised over 57 chunks = 24.2s mean exactly. A tighter band than arm F\'s '
    + 'because nothing here is approximate.'),
  peakAbsMeanDecileSec: P(1.5, 0.0, 5.0,
    'THE CEILING. If chunk-edge accuracy is the mechanism at all, perfect edges must kill the arch outright: '
    + 'DIED, <= 5.0s. Point 1.5s rather than 0 because three of arm G\'s available oracle values are '
    + 'themselves the open defects, and because run-opening and corpus-end edges are still not oracle-placed. '
    + 'A value >= 14.0s here fires the arm-G falsifier and exonerates the chunk plan entirely.'),
  peakDecileIndex: P(5, 0, 9,
    'CONDITIONAL and NOT scored below 5.0s of amplitude, same rule as arm F. At the predicted 1.5s the peak '
    + 'index is expected to be arbitrary, which is why the band is the whole range — a deliberate '
    + 'no-information prediction rather than a false-precision one.'),
  finalDecileSec: P(0.150, -0.350, 0.650,
    'Same reasoning as arm F: the corpus end re-anchors in every arm measured.'),
  regressed: P(170, 90, 290,
    'Better than arm F by the same logic that makes arm G the ceiling, but still far above production\'s 1: '
    + 'even a perfectly-windowed 57-chunk plan is a DIFFERENT alignment from production\'s 277-chunk plan, '
    + 'and the 5ms band counts every difference. Point 170; hi 290 admits no improvement over arm C.'),
  wallClockSec: P(650, 520, 800,
    'Same chunk count and comparable widths as arm C, so the same reasoning and the same band as arm F.'),
  peakRssMB: P(3100, 2400, 3800,
    'Same reasoning and band as arm F — largest-chunk driven over the fixed baseline.'),
  estimateTrackingR: P(0.30, -0.50, 0.85,
    'Arm G removes the estimate from edge placement COMPLETELY, so its residual curve should have no reason '
    + 'to resemble the estimate\'s arch. Registered claim: r < 0.85. If arm G STILL tracks the estimate at '
    + 'r >= 0.85 while the arch survives, the estimate is reaching the boundaries through a route that is '
    + 'not the chunk plan at all.'),
};

// ---------------------------------------------------------------------------
// 11. THE NAMED FALSIFIERS. One per arm, in the brief's required form, and
//     answered explicitly at report time.
// ---------------------------------------------------------------------------

export const FALSIFIER_F = {
  claim: 'Estimate-derived chunk-edge placement is what drives v6\'s S2 drift arch.',
  statement:
    'Arm F\'s peak |mean decile Δ| at a value >= 14.0s — the SURVIVED band — while at least two thirds of '
    + 'its internal chunk edges are placed at three-source-agreement anchors by script-word index, would '
    + 'refute the claim that estimate-derived chunk-edge placement drives v6\'s S2 drift arch.',
  measuredQuantity: 'peak |mean decile Δ| for arm F, together with arm F\'s anchor-substitution rate',
  firesAtOrAbove: ARCH_SURVIVED_AT_OR_ABOVE_SEC,
  requiresSubstitutionAtLeast: 2 / 3,
} as const;

export const FALSIFIER_G = {
  claim: 'Chunk-edge ACCURACY — of any kind, however obtained — is the mechanism behind v6\'s S2 drift arch.',
  statement:
    'Arm G\'s peak |mean decile Δ| at a value >= 14.0s — the SURVIVED band — while every internal chunk edge '
    + 'sits at an attested oracle boundary time, would refute the claim that chunk-edge accuracy is the '
    + 'mechanism, and would exonerate the chunk plan entirely: no chunk-plan-based fix could then do better '
    + 'than a ceiling that already fails.',
  measuredQuantity: 'peak |mean decile Δ| for arm G, together with arm G\'s oracle-substitution rate',
  firesAtOrAbove: ARCH_SURVIVED_AT_OR_ABOVE_SEC,
  requiresSubstitutionAtLeast: 1.0,
} as const;

// ---------------------------------------------------------------------------
// 12. STEP 6'S ADJUDICATION TABLE, transcribed from the brief and committed
//     here so the conclusion is applied VERBATIM rather than composed after
//     the numbers land.
// ---------------------------------------------------------------------------

export const ADJUDICATION: ReadonlyArray<{ outcome: string; conclusion: string }> = [
  {
    outcome: 'arch DIES in F',
    conclusion:
      'chunk-edge placement error is the driver; S2 family is viable with anchor-placed edges; next session '
      + 'extends to 173 under the same gate',
  },
  {
    outcome: 'arch SURVIVES F, DIES in G',
    conclusion:
      'anchors are too sparse or too biased, but edge accuracy is still the mechanism; the problem is edge '
      + 'placement, not S2 architecture; state the accuracy budget implied by the gap',
  },
  {
    outcome: 'arch SURVIVES both',
    conclusion:
      'the chunk plan is exonerated entirely and the cause is downstream of chunking; close the S2 family as '
      + 'a permanent negative, record it in `sync-pipeline-v2-plan.md` and the root-cause doc with all six '
      + 'arms\' numbers, and do not propose a replacement architecture in this session',
  },
  {
    outcome: 'PARTIAL in either',
    conclusion:
      'report as partial, ship nothing, iterate no bands, and state which single measurement would resolve it',
  },
];

/** Selects the pre-committed conclusion from the two arch verdicts. Pure —
 *  the harness never composes a conclusion of its own. */
export function adjudicate(f: ArchVerdict, g: ArchVerdict): { outcome: string; conclusion: string } {
  if (f === 'PARTIAL' || g === 'PARTIAL') return ADJUDICATION[3]!;
  if (f === 'DIED') return ADJUDICATION[0]!;
  if (g === 'DIED') return ADJUDICATION[1]!;
  return ADJUDICATION[2]!;
}

// ---------------------------------------------------------------------------
// Every gate quantity in one object, for the harness to print verbatim.
// ---------------------------------------------------------------------------

export const AM_GATE = {
  scope: 'v6 only — no 173, no spanish',
  arms: { F: 'anchor-placed chunk edges (qi-nearest three-source-agreement anchor)', G: 'oracle-placed chunk edges — DIAGNOSTIC ONLY, can never ship' },
  hardFailMoveSec: HARD_FAIL_MOVE_SEC,
  knownBadReproductionsAllowed: KNOWN_BAD_REPRODUCTIONS_ALLOWED,
  knownBadMatchSec: KNOWN_BAD_MATCH_SEC,
  minDefectsRequired: MIN_DEFECTS_REQUIRED,
  defectsLandedByExistingArms: DEFECTS_LANDED_BY_EXISTING_ARMS,
  defectLandedSec: DEFECT_LANDED_SEC,
  earBillToleranceSec: EAR_BILL_TOLERANCE_SEC,
  minImpliedPrecision: MIN_IMPLIED_PRECISION,
  v6AttestedTotal: V6_ATTESTED_TOTAL,
  v6AttestedCorrect: V6_ATTESTED_CORRECT,
  worseThanArmCAbove: WORSE_THAN_ARM_C_ABOVE,
  worseThanProductionAbove: WORSE_THAN_PRODUCTION_ABOVE,
  materiallyBetterAtOrBelow: MATERIALLY_BETTER_AT_OR_BELOW,
  archDiedAtOrBelowSec: ARCH_DIED_AT_OR_BELOW_SEC,
  archSurvivedAtOrAboveSec: ARCH_SURVIVED_AT_OR_ABOVE_SEC,
  targetMinSec: AM_TARGET_MIN_SEC,
  targetMaxSec: AM_TARGET_MAX_SEC,
  silenceSearchWindowSec: AM_SILENCE_SEARCH_WINDOW_SEC,
  armFTolerance: ARM_F_TOLERANCE,
  armFFallbackPartialAbove: ARM_F_FALLBACK_PARTIAL_ABOVE,
  anchorUniformityMinDecileFraction: ANCHOR_UNIFORMITY_MIN_DECILE_FRACTION,
  armGIsDiagnosticOnly: ARM_G_IS_DIAGNOSTIC_ONLY,
  armGShipGateApplies: ARM_G_SHIP_GATE_APPLIES,
  armGDefectiveOracleRows: ARM_G_DEFECTIVE_ORACLE_ROWS,
  falsifierF: FALSIFIER_F,
  falsifierG: FALSIFIER_G,
} as const;
