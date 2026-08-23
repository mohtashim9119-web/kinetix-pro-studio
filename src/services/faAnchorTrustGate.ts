/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AE — THE ANCHOR-TRUST GATE. R.14 and R.15.
//
// WHAT THIS FILE IS FOR, stated as the measurement that produced it. WS1
// Session AE's interval-word census (Step 1) took every boundary an ear pass
// has scored — 15 defects and 37 confirmed-correct controls across v6, 173 and
// Spanish — and asked one question per row: WHERE, in FA's own token ordinals,
// does the committed boundary sit relative to the two segments' own claimed
// words? The answer split the defects into two disjoint classes that no single
// rule covers, and the split is visible in a single integer:
//
//   ordinalDelta := (index of the last FA token whose ONSET precedes the
//                    committed boundary) - (the left segment's own last
//                    claimed token index)
//
//   * ordinalDelta == 0  — the boundary sits exactly between the two segments'
//     own words, so nobody's words are on the wrong side. Every defect here is
//     a PLACEMENT defect: FA smeared the incoming segment's opening words
//     BACKWARD across a real silence with collapsed confidence, the word gap
//     collapsed to one or two frames, and `snapCoveredBoundaries` snapped into
//     the middle of the smear instead of the middle of the silence. 8 of v6's
//     9 ear-scored defects, plus `008_unknown_void`. R.14 owns these.
//
//   * ordinalDelta < 0 — the committed boundary precedes the onset of the LEFT
//     segment's own last claimed word, so the outgoing scene's final words are
//     played under the incoming one. A genuine ATTRIBUTION defect. 3 of 173's
//     5, and ZERO of v6's 446 and Spanish's 26 boundaries — measured, not
//     assumed. R.15 owns these.
//
// THE TWO RULES ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION, twice over: their
// ordinal conditions are disjoint (`== 0` vs `< 0`), and their confidence
// conditions are complementary (`< CONF_MIN_FALLBACK` vs `>=`). Neither can
// ever propose a correction for a boundary the other also claims, so their
// order in the rule stage cannot matter — which is deliberate, after R.11/R.12's
// own measured collision (`faRuleStageExclusion.ts`).
//
// WHY THE CONFIDENCE CONJUNCT IS NOT DECORATION. It is what stops R.15 firing
// on `vessel_damage_clue`, the one 173 row whose ordinalDelta is negative but
// whose defect is NOT attribution: BOTH its anchors are sub-reliability smear,
// its ear-verified value (174.74) is a silence midpoint 1.4s past anything the
// word gap can reach, and R.15's placement would have moved it to 173.30 — a
// correction away from the right answer. Measured, and the reason the conjunct
// exists.
//
// WHAT THESE RULES DO NOT REACH, named rather than papered over:
//   * `214_solitary_fire` (v6) — ordinalDelta +1: the INCOMING segment's own
//     first claimed word starts before the committed boundary. That is the
//     mirror of R.15's defect and neither rule claims it. Widening R.14 to
//     `ordinalDelta >= 0` was measured and REJECTED: it turns three
//     ear-CORRECT controls (`087_throwing_spear_poise`, `192_scout_listening`,
//     `318_scout_on_ridge`) into false positives.
//   * `447_scout_facing_dark` (v6) — word gap 0.360s, wider than
//     `SILENCE_MIN_DETECTABLE_SEC`, so R.14's existence bound correctly
//     declines it.
//   * `231_slowing_pace` (v6) — declined by R.14's reliable-onset guard: its
//     ear-verified value sits 0.70s PAST the point FA reliably places the
//     incoming segment's own speech. Keeping it would have cost a 3.30s
//     unverified move elsewhere in v6 (`289_winter_predator_breach`) and two
//     more on Spanish, one of which landed exactly on the next committed
//     boundary. The guard is worth more than the row; both halves measured.
//   * `lethal_nature_hazard` / `gadget_decay` (173) — ordinalDelta 0 with a
//     RELIABLE right anchor. Their committed value is a real silence's
//     midpoint; it is simply the wrong silence. Neither rule addresses the
//     wrong-landmark class and neither pretends to.
//
// ---------------------------------------------------------------------------
// WS1 SESSIONS AG/AH — WHAT THIS GATE IS *FOR*, NOW THAT THE CAUSE IS KNOWN.
//
// READ THIS BEFORE CHANGING OR DELETING EITHER RULE.
//
// R.14 repairs a SYMPTOM. The cause is upstream, in the chunk planner:
// `computeFaChunkPlan` can file script text into a chunk window's silent tail,
// and a forced aligner must return a time for every word it is given, so that
// text comes back with a timestamp and a collapsed posterior — a PHANTOM.
//
// Session AG built a cleanup for that (S1, `faChunkPlan.ts`'s trailing-silence
// fold), drove it through a real ONNX re-run on all three corpora, and measured
// R.14's v6 firing count dropping 11 -> 1. SESSION AH ROLLED S1 BACK AS A
// PERMANENT NEGATIVE. The operator ear-audited all 18 boundaries S1 moved
// without prior ear evidence and every single one was a REGRESSION: the
// production cut was already right. The detector S1 keys on fires on 183 of 277
// v6 chunks against ~13 true defects — ~7% precision — so a repair keyed on it
// moves ~13 right and ~170 wrong. Cleanup at the DETECTION layer is rejected;
// prevention at the PARTITION layer (S2) is the successor. See
// `docs/ws1-sync-pipeline/fa-chunk-phantom-root-cause.md` §8.
//
// SO THIS GATE STAYS, AND NEITHER RULE IS SCOPED DOWN:
//
//   1. THE UPSTREAM FIX DOES NOT EXIST. On the configuration that ships today
//      — the only one that has ever existed in production — R.14 fires all 11
//      times and every one of those firings is doing real work. Narrowing the
//      rule would reopen eight register rows to fix a problem production does
//      not have.
//   2. EVEN UNDER S1 THE FIRING COUNT WAS NOT ZERO, AND THE RESIDUAL FIRING WAS
//      LOAD-BEARING. `011_shivering_by_fire` has a base pre-rule value of
//      28.890 (correct, no rule needed) and an S1 pre-rule value of 28.470 —
//      R.14 corrected it back to 28.890. The patch was repairing a regression
//      the fix introduced. Any future upstream fix must be re-measured the same
//      way before either rule is touched.
//
// DELETION GATE, in order — all three, not any one:
//   (a) an upstream fix that is SHIPPED, not merely measured (S1 failed this);
//   (b) GOLDEN COVERAGE BUILT FOR THE RULE STAGE. There is none today:
//       `scripts/phase4-handoff-replay-sync.test.ts` contains zero references
//       to this file, to `faChunkPlan.ts`, or to FA at all — it is a
//       Whisper-token replay that stops at `snapCoveredBoundaries`. Deleting
//       either rule today would be deleting code no fixture protects.
//   (c) a measured firing count of zero with all rows still correct.
//
// Full evidence: `sync-pipeline-v2-plan.md` Parts AA/AB, `docs/work-in-progress.md`
// §§11i/11j.
// ---------------------------------------------------------------------------
//
// NO AMPLITUDE, NO ENERGY, NO SILENCE-PROXIMITY ANYWHERE IN EITHER DETECTION
// DECISION. R.14's three conjuncts are a token ordinal, an aligner posterior
// and a token-geometry width; R.15's two are a token ordinal and a posterior.
// Silence enters only in R.14's PLACEMENT, and then as a containment/ordering
// selection ("the first silence whose own midpoint lies after the boundary"),
// never as a proximity match between two timestamps — the failure mode
// CLAUDE.md's "timestamps may measure distance, they must never decide
// identity" invariant names.
// ---------------------------------------------------------------------------

import {
  CONF_MIN_FALLBACK, SILENCE_MIN_DETECTABLE_SEC, FA_FRAME_SEC,
} from './syncConstants';
import type { SilenceInterval } from './silenceDetector';
import type { TranscriptToken, VideoSegment } from '../types';

/** The two fields this gate needs out of an `AlignResult`. Declared
 *  structurally rather than importing `SegmentAlignment` so this module stays
 *  dependency-light (CLAUDE.md's services layering) and so a caller can pass
 *  the same array `snapCoveredBoundaries` was given without adaptation. */
export interface AnchorTrustAlignment {
  firstTokenIdx: number;
  lastTokenIdx: number;
}

export interface AnchorTrustFinding {
  rule: 'R.14' | 'R.15';
  /** Index into the COMMITTED array passed to the detector. */
  segmentIndex: number;
  segmentId: string;
  segmentTag?: string;
  committedValue: number;
  correctedValue: number;
  delta: number;
  /** The integer that decides which class this row is. */
  ordinalDelta: number;
  /** `[left segment's last claimed word end, right segment's first claimed
   *  word start]` — the word gap, recorded so a log reader can check the
   *  placement themselves. */
  gapStartSec: number;
  gapEndSec: number;
  /** R.14 only — the silence whose midpoint the corrected value IS. */
  backingSilence?: { startSec: number; endSec: number };
  leftAnchorConfidence: number;
  rightAnchorConfidence: number;
}

/** Float-noise guard for the ordering comparison. A midpoint is computed as
 *  `(a + b) / 2`, so a corrected value that is mathematically EQUAL to the next
 *  boundary can land one ulp below it — which would let a zero-duration
 *  correction through a strict `<`. Nine decimal places is far below any
 *  quantity in this pipeline (the aligner's own grid is 20 ms) and far above
 *  double-precision noise at these magnitudes. */
const ORDER_EPS_SEC = 1e-9;

const confOf = (t: TranscriptToken | undefined): number =>
  t === undefined ? 0 : ((t as { confidence?: number }).confidence ?? 0);

const tagOf = (s: VideoSegment): string | undefined =>
  (s as unknown as { tag?: string }).tag;

/**
 * The last token whose ONSET precedes `boundary`, or -1. Onset, not end:
 * the question this answers is "which word had already started when the cut
 * happened", and a word whose onset is after the cut is unambiguously on the
 * far side of it however far its own end reaches.
 *
 * `tokens` is the same ascending-onset array the aligner indexed, so this is a
 * binary search, not a scan — the detector runs once per boundary.
 */
function lastOnsetBefore(tokens: readonly TranscriptToken[], boundary: number): number {
  let lo = 0, hi = tokens.length - 1, out = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid]!.startSec < boundary) { out = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return out;
}

/** The onset of the first token this segment claims whose confidence reaches
 *  the reliability line — the first instant FA offers trustworthy evidence
 *  that this segment is actually being spoken. `null` when it claims none. */
function firstReliableOnset(
  tokens: readonly TranscriptToken[], align: AnchorTrustAlignment,
): number | null {
  if (align.firstTokenIdx < 0 || align.lastTokenIdx < 0) return null;
  for (let t = align.firstTokenIdx; t <= align.lastTokenIdx && t < tokens.length; t++) {
    if (confOf(tokens[t]) >= CONF_MIN_FALLBACK) return tokens[t]!.startSec;
  }
  return null;
}

/**
 * R.14 — SMEARED-ANCHOR PLACEMENT, and R.15 — TAIL ATTRIBUTION, detected in
 * one pass because they read the same three inputs and are defined as each
 * other's complement.
 *
 * `alignments` MUST be index-parallel with `committed` (i.e. the
 * `keptAlignments` array `filterToCoveredSegments` produced and
 * `snapCoveredBoundaries` was given), and `tokens` MUST be the same filtered
 * FA array those indices address. Passing a differently-filtered array
 * silently shifts every ordinal — the exact hazard `ProductionRun.keptAlignments`
 * exists to remove.
 *
 * Pure: reads its inputs, allocates findings, mutates nothing.
 */
export function detectAnchorTrustDefects(
  committed: readonly VideoSegment[],
  alignments: readonly AnchorTrustAlignment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
): AnchorTrustFinding[] {
  const out: AnchorTrustFinding[] = [];
  if (tokens.length === 0 || committed.length !== alignments.length) return out;

  for (let i = 1; i < committed.length; i++) {
    const seg = committed[i]!;
    const boundary = seg.startTime;
    const lAlign = alignments[i - 1]!, rAlign = alignments[i]!;
    if (lAlign.lastTokenIdx < 0 || rAlign.firstTokenIdx < 0) continue;

    const lTok = tokens[lAlign.lastTokenIdx];
    const rTok = tokens[rAlign.firstTokenIdx];
    if (lTok === undefined || rTok === undefined) continue;

    const ordinalDelta = lastOnsetBefore(tokens, boundary) - lAlign.lastTokenIdx;
    const lConf = confOf(lTok), rConf = confOf(rTok);
    const gapStartSec = lTok.endSec, gapEndSec = rTok.startSec;
    const nextBoundary = i + 1 < committed.length ? committed[i + 1]!.startTime : undefined;

    const base = {
      segmentIndex: i, segmentId: seg.id, segmentTag: tagOf(seg),
      committedValue: boundary, ordinalDelta, gapStartSec, gapEndSec,
      leftAnchorConfidence: lConf, rightAnchorConfidence: rConf,
    };

    // ---- R.14: placement class. -------------------------------------------
    if (ordinalDelta === 0 && rConf < CONF_MIN_FALLBACK
        && gapEndSec - gapStartSec < SILENCE_MIN_DETECTABLE_SEC) {
      // The first detected silence whose OWN MIDPOINT lies after the committed
      // boundary. Midpoint, not start: a boundary already sitting exactly on a
      // silence's midpoint has used that silence up, and the correction it
      // needs is the next one (measured: `214`/`447` both sit on a midpoint,
      // `008`/`400` sit inside a silence they have NOT been placed at).
      const backing = silences.find(s => (s.startSec + s.endSec) / 2 > boundary);
      const corrected = backing === undefined ? undefined : (backing.startSec + backing.endSec) / 2;
      if (backing !== undefined && corrected !== undefined
          // Never move backwards, and never to a no-op.
          && corrected > boundary
          // ORDERING GUARD: a correction may not reach or pass the next
          // committed boundary. Without it the rule produced a zero-duration
          // segment on Spanish (`022_ship_trapped` landing exactly on
          // `023_scylla_six_sailors`'s own ear-verified boundary) — measured.
          && (nextBoundary === undefined || corrected < nextBoundary - ORDER_EPS_SEC)) {
        // RELIABLE-ONSET GUARD: never place the seam after the point FA
        // reliably says the INCOMING segment is already speaking — that would
        // truncate its opening words, trading one defect for another.
        const reliable = firstReliableOnset(tokens, rAlign);
        if (reliable === null || corrected < reliable) {
          out.push({
            ...base, rule: 'R.14', correctedValue: corrected, delta: corrected - boundary,
            backingSilence: { startSec: backing.startSec, endSec: backing.endSec },
          });
        }
      }
      continue;
    }

    // ---- R.15: attribution class. -----------------------------------------
    if (ordinalDelta < 0 && rConf >= CONF_MIN_FALLBACK) {
      // One aligner frame before the incoming segment's own first word — the
      // smallest step FA can express, clamped so it can never cut into the
      // outgoing segment's own last word.
      const corrected = Math.max(gapStartSec, gapEndSec - FA_FRAME_SEC);
      if (corrected > boundary && (nextBoundary === undefined || corrected < nextBoundary - ORDER_EPS_SEC)) {
        out.push({ ...base, rule: 'R.15', correctedValue: corrected, delta: corrected - boundary });
      }
    }
  }
  return out;
}

/**
 * Applies findings to the committed array BY ID, in Model P: correcting
 * `segments[i].startTime` moves the shared boundary with `segments[i-1]`, so
 * `segments[i-1].duration` absorbs the same delta in the opposite direction —
 * Σ duration and the gapless partition are preserved exactly and segment i's
 * own END never moves. A finding whose segment is absent (dropped upstream by
 * R.10 or the coverage filter) is silently skipped, the tolerant-by-id pattern
 * every other gate in this stage uses. A correction that would drive either
 * duration non-positive is declined.
 *
 * Immutable: returns a new array, never mutates its input (CLAUDE.md).
 */
export function applyAnchorTrustCorrections(
  finalSegments: readonly VideoSegment[],
  findings: readonly AnchorTrustFinding[],
): VideoSegment[] {
  if (findings.length === 0) return finalSegments as VideoSegment[];
  const correctedById = new Map(findings.map(f => [f.segmentId, f.correctedValue]));
  const out = finalSegments.map(s => ({ ...s }));
  for (let i = 1; i < out.length; i++) {
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
