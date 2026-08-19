/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session Q — STEP 4. NEGATIVE RESULT: "NEAREST SILENCE" IS A DETECTION
// SIGNAL, NOT A CORRECTOR. DO NOT SHIP.
//
// Step 3's measurement (`ws1-session-q-silence-distance.test.ts`) found that
// `d = |committed - nearest silence midpoint|` separates 7 of the 9 known
// register rows (Class B's 5, plus Class A's `152_frozen_brush_mice` and
// `231_slowing_pace`) from a 403-boundary control population whose own `d` is
// machine-epsilon (2.27e-13). That part of this file's first draft held up.
//
// WHAT DID NOT HOLD UP, caught before anything shipped: the CORRECTED VALUE
// this detector would propose — that same "nearest silence"'s own midpoint —
// is WRONG on both catchable Class A rows, measured against the already
// ear-verified targets:
//
//   152_frozen_brush_mice: committed 449.20. Nearest silence to that value
//     is [447.xx, 448.xx] -> midpoint 448.02. The EAR-CORRECT target is
//     450.99, which is [450.36, 451.70]'s own midpoint (451.03, 0.04s off
//     the ear value) — a DIFFERENT, farther silence, the same one R.11's own
//     chunk-fit logic already identifies as the chunk's own end anchor.
//   231_slowing_pace: committed 681.63. Nearest silence gives 680.99
//     (BEHIND the committed value). Ear-correct is 682.74 = [682.42,
//     683.06]'s own midpoint — AHEAD of it, a different silence again.
//
// This is exactly the distinction the session brief's own phrasing warned
// about — "if the new detector is silence-based rather than chunk-edge-based,
// confirm it reaches 231." It reaches 231 as a DETECTION (d=0.64 stands out
// from the control population), but a plain nearest-silence search is not
// chunk-edge-based, and it picks the wrong side. The two rows this file can
// even ATTEMPT sit exactly where multiple real silences compete near one
// seam, and "nearest to the wrong value" has no reason to agree with "the one
// the chunk's own boundary actually anchors to" — R.11's mechanism, which
// this file does not reimplement.
//
// CONSEQUENCE: no detector ships from this file. What follows is preserved as
// a MEASUREMENT of the negative result — the firing signal's own blast
// radius/sensitivity/hold-out/mutual-exclusion properties, worth having on
// record — plus the correction-accuracy check that caught the flaw, so this
// specific mistake cannot quietly resurface as "well, it fires on 152/231, so
// wire it up." The next real discriminator needs the SAME candidate-silence
// selection R.11 already does (chunk-edge anchoring), not raw proximity to
// wherever the pipeline currently, wrongly, sits.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { computeBoundarySearchWindow, boundaryUsedFallback } from '../src/services/snapBoundaries';
import { alignScenestoTranscript, distributeSegmentTimes } from '../src/services/whisperService';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { R12_MIN_CORRECTION_SEC } from '../src/services/syncConstants';
import { CORPORA, OUT_ROOT, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import { nearestSilenceMidpoint } from './ws1-session-q-silence-distance.test.js';

const MEASURE = process.env.WS1_SESSION_Q_MEASURE === '1';

/** GEOMETRIC threshold, deliberately NOT fitted: the healthy (snapped,
 *  rule-untouched) population's own max `d` is machine-epsilon (2.27e-13 —
 *  see Step 3). `R12_MIN_CORRECTION_SEC` (0.05s) is the existing no-op
 *  epsilon this codebase already uses for "float/rounding noise, not a
 *  semantic distance" (R.11, R.12's own MIN_CORRECTION constants) — reused
 *  here rather than minting a new constant, and justified below by
 *  sensitivity analysis showing the entire (epsilon, 0.64) interval gives an
 *  IDENTICAL firing set. */
const THRESHOLD_SEC = R12_MIN_CORRECTION_SEC;

interface Candidate {
  tag: string; segmentIndex: number; committed: number;
  nearestMid: number; d: number; kind: string;
}

/** The detector's own candidate pool: index>0, snapped (not fallback), and
 *  untouched by R.11/R.12/R.13 this run — see header for why the exclusion
 *  is structural, not incidental. */
async function computeCandidates(): Promise<{ candidates: Candidate[]; excludedByRule: Set<string> }> {
  const spec = CORPORA.v6!;
  const r = await runProductionPath(spec);

  const usable = r.usableFaTokens;
  const alignedSegments = applyAnchorBasedTiming(
    distributeSegmentTimes(
      r.anchorTimed,
      alignScenestoTranscript(r.anchorTimed, usable, r.silences, spec.audioDuration),
      'forced-alignment',
    ),
    spec.audioDuration,
  );
  const alignments = alignScenestoTranscript(alignedSegments, usable, r.silences, spec.audioDuration);

  const excludedByRule = new Set<string>([
    ...r.r11.map(f => f.segmentId), ...r.r12.map(f => f.segmentId), ...r.r13.map(f => f.segmentId),
  ]);

  const candidates: Candidate[] = [];
  for (let i = 1; i < r.committed.length; i++) {
    const s = r.committed[i]!;
    if (excludedByRule.has(s.id)) continue;

    const ca = alignments[i - 1]; const na = alignments[i];
    let usedFallback: boolean | undefined;
    if (ca && na && ca.firstTokenIdx >= 0 && ca.lastTokenIdx >= 0 && na.firstTokenIdx >= 0 && na.lastTokenIdx >= 0) {
      const w = computeBoundarySearchWindow(
        usable[ca.lastTokenIdx]!.endSec, usable[na.firstTokenIdx]!.startSec,
        usable[ca.firstTokenIdx]!.startSec, usable[na.lastTokenIdx]!.endSec,
      );
      usedFallback = boundaryUsedFallback(
        usable, r.silences, w, ca.firstTokenIdx, ca.lastTokenIdx, na.firstTokenIdx, na.lastTokenIdx,
      );
    }
    if (usedFallback !== false) continue; // only the SNAPPED population — fallback is Step 6's domain.

    const n = nearestSilenceMidpoint(s.startTime, r.silences);
    if (!n) continue;
    candidates.push({ tag: tagOf(s), segmentIndex: i, committed: s.startTime, nearestMid: n.mid, d: n.d, kind: n.kind });
  }
  return { candidates, excludedByRule };
}

describe.skipIf(!MEASURE)('WS1 Session Q — silence-choice detector validation (Step 4)', () => {
  it('blast radius, sensitivity and hold-out, predicted before and measured after', async () => {
    const { candidates } = await computeCandidates();
    mkdirSync(OUT_ROOT, { recursive: true });

    const fire = (t: number): Candidate[] => candidates.filter(c => c.d > t);

    const CLASS_A_CATCHABLE = new Set(['152_frozen_brush_mice', '231_slowing_pace']);
    const CLASS_A_BLIND = new Set(['214_solitary_fire', '447_scout_facing_dark']);

    // PREDICTION, before measuring the swept thresholds: given Step 3 already
    // measured the exact healthy max (2.27e-13) and the two catchable rows'
    // exact d (1.18, 0.64), the firing set at THRESHOLD_SEC should be exactly
    // {152_frozen_brush_mice, 231_slowing_pace} — predicted 2, blast radius
    // 2 of however many candidates remain after R.11/12/13 exclusion.
    const predicted = new Set(['152_frozen_brush_mice', '231_slowing_pace']);

    const atThreshold = fire(THRESHOLD_SEC);
    const firedTags = new Set(atThreshold.map(c => c.tag));

    // Sensitivity, BOTH directions: sweep from just-above-zero to just-below
    // the lowest catchable defect. If the firing set is IDENTICAL across the
    // whole interval, the threshold is not fragile — contrast with R.11's own
    // 1.2857/1.3333 squeeze (this file's header).
    const sweep = [0.001, 0.01, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.63];
    const sweepResults = sweep.map(t => ({ t, tags: [...fire(t)].map(c => c.tag).sort() }));
    const allIdentical = sweepResults.every(r => JSON.stringify(r.tags) === JSON.stringify([...firedTags].sort()));

    // HOLD-OUT: derive the threshold using only 231 (d=0.64, the SMALLER of
    // the two — the harder case) plus the full healthy population; validate
    // it independently reaches the HELD-OUT 152 (d=1.18). Then swap.
    const holdOutA = { derivedOn: '231_slowing_pace', heldOut: '152_frozen_brush_mice', derivedD: 0.64 };
    const thresholdFromA = holdOutA.derivedD / 2; // geometric-midpoint-style: halfway between 0 (healthy) and 0.64
    const reachesHeldOutA = fire(thresholdFromA).some(c => c.tag === holdOutA.heldOut);

    const holdOutB = { derivedOn: '152_frozen_brush_mice', heldOut: '231_slowing_pace', derivedD: 1.18 };
    const thresholdFromB = 0.05; // must stay below 231's own 0.64 to reach it — this is the actual shipped constant
    const reachesHeldOutB = fire(thresholdFromB).some(c => c.tag === holdOutB.heldOut);

    // Mutual exclusion, MEASURED: does excluding R.11/12/13's own targets
    // matter? Re-run WITHOUT the exclusion and confirm 6 of R.12's 9 would
    // false-fire (the clamp-vs-full-midpoint gap Step 3 found).
    const spec = CORPORA.v6!;
    const r = await runProductionPath(spec);
    const r12Tags = new Set(r.r12.map(f => f.segmentTag));
    const withoutExclusion: string[] = [];
    for (let i = 1; i < r.committed.length; i++) {
      const s = r.committed[i]!;
      if (!r12Tags.has(tagOf(s))) continue;
      const n = nearestSilenceMidpoint(s.startTime, r.silences);
      if (n && n.d > THRESHOLD_SEC) withoutExclusion.push(tagOf(s));
    }

    // THE DECISIVE CHECK — correction accuracy, not merely firing. Both known
    // ear-correct targets are on record (Session P): 152 -> 450.99,
    // 231 -> 682.74. Compare this detector's PROPOSED correction (the nearest
    // silence's own midpoint) against them.
    const EAR_CORRECT: Record<string, number> = { '152_frozen_brush_mice': 450.99, '231_slowing_pace': 682.74 };
    const correctionAccuracy = [...CLASS_A_CATCHABLE].map(tag => {
      const c = candidates.find(x => x.tag === tag);
      const ear = EAR_CORRECT[tag]!;
      const proposedError = c ? Math.abs(c.nearestMid - ear) : null;
      return { tag, committed: c?.committed ?? null, proposedCorrection: c?.nearestMid ?? null, earCorrect: ear, proposedErrorSec: proposedError };
    });
    const correctionIsUsable = correctionAccuracy.every(x => x.proposedErrorSec !== null && x.proposedErrorSec < 0.2);

    const out = {
      candidatePoolSize: candidates.length,
      predicted: [...predicted],
      firedAtThreshold: [...firedTags],
      matchesPrediction: JSON.stringify([...firedTags].sort()) === JSON.stringify([...predicted].sort()),
      blindSpotConfirmedStillBlind: [...CLASS_A_BLIND].every(t => !firedTags.has(t)),
      sensitivitySweep: sweepResults,
      sensitivityStable: allIdentical,
      holdOut: {
        A: { ...holdOutA, thresholdUsed: thresholdFromA, reachesHeldOut: reachesHeldOutA },
        B: { ...holdOutB, thresholdUsed: thresholdFromB, reachesHeldOut: reachesHeldOutB },
      },
      mutualExclusion: {
        r12OwnCorrectionsExcludedFromCandidatePool: r12Tags.size,
        wouldFalseFireWithoutExclusion: withoutExclusion,
      },
      reaches231AsDetection: firedTags.has('231_slowing_pace'),
      correctionAccuracy,
      correctionIsUsable,
      verdict: correctionIsUsable
        ? 'usable: proposed correction agrees with the ear-correct target'
        : 'NOT SHIPPABLE: fires correctly as a detector, but proposes the WRONG silence as the correction on both catchable rows — needs chunk-edge selection (R.11-style), not nearest-to-committed proximity',
    };
    writeFileSync(resolve(OUT_ROOT, 'stepQ4-detector-validation.json'), JSON.stringify(out, null, 2));
    // eslint-disable-next-line no-console
    console.log('[STEP Q4]', JSON.stringify(out, null, 2));

    // The DETECTION signal's own properties still hold, and are worth
    // asserting so this measurement stays reproducible.
    expect(out.matchesPrediction, 'blast radius must match the pre-registered prediction').toBe(true);
    expect(out.blindSpotConfirmedStillBlind, '214/447 must remain unreached by this detector').toBe(true);
    expect(out.sensitivityStable, 'the firing set must be threshold-stable across the whole safe interval').toBe(true);
    expect(reachesHeldOutA, 'hold-out A: deriving on 231 must still reach 152').toBe(true);
    expect(reachesHeldOutB, 'hold-out B: deriving on 152 must still reach 231').toBe(true);
    expect(out.reaches231AsDetection, '231 was never an R.11 candidate — this detector reaches it AS A DETECTION').toBe(true);
    expect(withoutExclusion.length, 'without exclusion, R.12 own clamp corrections would false-fire').toBeGreaterThan(0);

    // THE NEGATIVE RESULT ITSELF, asserted so it cannot silently flip to
    // "usable" on a future re-run without someone noticing and updating this
    // file's own header. Measured: FALSE — both proposed corrections are 1+
    // seconds from the ear-correct silence.
    expect(correctionIsUsable, 'nearest-silence-to-committed-value is NOT the right correction rule — see header').toBe(false);
  }, 900_000);
});
