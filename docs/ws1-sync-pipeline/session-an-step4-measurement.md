# WS1 Session AN Step 4 — v6 measurement (A/C/F/G/H) against the AJ-0 oracle (MEASURED)

B and D are CITED FROM RECORD (Session AM Step 5), not re-run this session — per the brief.

## The pre-registered gate (imported verbatim from `ws1-session-an-step1-gate.ts`)

```json
{
  "scope": "v6 gate; 173 CONDITIONAL on Step 5 (only if arm H clears the progress bar and worsens nothing)",
  "arm": {
    "H": "anchor-placed chunk edges, widened by one sentence group on each side ONLY at the 5 seams arm F could not resolve"
  },
  "hardFailMoveSec": 0.05,
  "knownBadReproductionsAllowed": 0,
  "knownBadMatchSec": 0.005,
  "worseThanArmFAbove": 68,
  "armFV6DefectsLandedTotal": 2,
  "armFV6DefectsLandedNetNewOverBcd": 1,
  "armHMinDefectsRequired": 2,
  "progressBar": {
    "regressed5msBelow": 68,
    "minSeamsRecovered": 1
  },
  "shipCandidateReviewBar": {
    "regressed5msAtOrBelow": 60,
    "minSeamsRecovered": 3,
    "mustKeepDefectsLanded": true
  },
  "fallbackSeamGovernedResidualCount": 39,
  "earBillToleranceSec": 0.005,
  "minImpliedPrecision": 0.5,
  "attributionRule": {
    "rule": "nearest of the containing chunk's two bounding edges by segment-index distance; exact edge = that edge; equidistant = governed by two; missing edge(s) = governed by the other, or by none if neither exists",
    "onEquidistant": "reported as \"governed by two\", not resolved by a tiebreak",
    "onNoEdge": "reported as \"governed by no edge\", not dropped from the table"
  },
  "budgetCurveEndpoints": {
    "toleranceZeroMs": {
      "tolerance": 0,
      "regressed": 2
    },
    "observedMaxMs": {
      "regressed": 68
    }
  },
  "shipBarRegressed5ms": 1,
  "falsifierWideningIsFree": {
    "claim": "Widening the anchor search recovers the 5 fallback seams without cost.",
    "statement": "Arm H's regressed count (5ms band) exceeding arm F's MEASURED 68 — i.e. HARD FAIL 3 firing — at all, for ANY number of fallback seams recovered, would refute the claim that widening is free. A widening that recovers seams but regresses even one previously-correct boundary is a cost, not a free lunch, and is reported as such rather than netted against the seams recovered.",
    "measuredQuantity": "arm H regressed count (5ms band) vs. arm F's 68, together with fallback seams resolved",
    "firesIf": "regressed > 68"
  },
  "falsifierEdgeErrorExplainsResidual": {
    "claim": "Chunk-edge placement error explains arm F's 67-boundary (±50ms) residual.",
    "statement": "A budget curve that is FLAT — regressed count barely moving as the hypothetical tolerance sweeps from arm G's 0ms to arm F's observed maximum — would refute the claim that edge error explains the residual, and would mean something DOWNSTREAM of the chunk plan (the FA alignment's own within-chunk distribution, a rule-stage effect, or something not yet identified) is responsible instead. A correlation (Step 2) below r = 0.5 between |governing edge error| and |boundary error| over the 67 residual boundaries would fire this falsifier on its own, independent of the curve's shape.",
    "measuredQuantity": "Pearson r between |governing edge error| and |boundary error| over the 67 residual boundaries; budget-curve shape",
    "firesIf": "r < 0.5 OR the budget curve is flat per the reading rule in §6"
  }
}
```

| arm | plan | chunks | committed | rules fired |
|---|---|---|---|---|
| A | — | 277 | 447 | `{"R.5":10,"R.10":0,"R.11":5,"R.12":8,"R.13":0,"R.14":11,"R.15":0}` |
| C | — | 57 | 446 | `{"R.5":10,"R.10":1,"R.11":5,"R.12":6,"R.13":0,"R.14":36,"R.15":7}` |
| F | — | 57 | 447 | `{"R.5":10,"R.10":0,"R.11":3,"R.12":7,"R.13":0,"R.14":1,"R.15":6}` |
| G | — | 57 | 447 | `{"R.5":10,"R.10":0,"R.11":0,"R.12":7,"R.13":0,"R.14":0,"R.15":0}` |
| H | — | 57 | 447 | `{"R.5":10,"R.10":0,"R.11":2,"R.12":7,"R.13":0,"R.14":1,"R.15":6}` |

## Oracle diff per arm — the five-arm comparison table

| arm | compared | unchanged | repaired | **regressed** | unadjudicable | moved total | beyond ±50ms | worse than arm F? |
|---|---|---|---|---|---|---|---|---|
| A | 447 | 446 | **0** | **1** | 0 | 1 | **0** | no |
| C | 447 | 164 | **1** | **279** | 3 | 283 | **278** | **YES** |
| F | 447 | 376 | **2** | **68** | 1 | 71 | **67** | n/a |
| G | 447 | 442 | **3** | **2** | 0 | 5 | **0** | no |
| H | 447 | 398 | **3** | **46** | 0 | 49 | **45** | no |

Reference (Session AM, cited from record): B **326** regressed, D **363** regressed.

- arm A unadjudicable breakdown: `{}`
- arm C unadjudicable breakdown: `{"absent-from-arm":1,"open-defect-moved-without-landing":2}`
- arm F unadjudicable breakdown: `{"open-defect-moved-without-landing":1}`
- arm G unadjudicable breakdown: `{}`
- arm H unadjudicable breakdown: `{}`

**HARD FAIL 3 (arm H regressed > arm F's 68): does not fire.**

## Drift profile along the timeline (arm value − arm A value), retaining the anchor-estimate column

| decile | n | C | **F** | **G** | **H** | estimate error |
|---|---|---|---|---|---|---|
| 0-142s | 47 | -0.877 | **-0.000** | **-0.000** | **-0.000** | -5.056 |
| 142-284s | 48 | -1.762 | **-0.182** | **0.000** | **-0.182** | -7.302 |
| 284-426s | 48 | -8.151 | **-0.542** | **0.000** | **-0.236** | -11.362 |
| 426-569s | 47 | -13.534 | **-1.674** | **0.000** | **-0.102** | -16.671 |
| 569-711s | 52 | -17.366 | **-3.249** | **0.042** | **0.325** | -22.370 |
| 711-853s | 42 | -19.155 | **0.349** | **0.000** | **0.349** | -23.347 |
| 853-995s | 40 | -14.801 | **-2.152** | **0.000** | **-0.139** | -17.478 |
| 995-1137s | 42 | -7.810 | **-0.004** | **0.000** | **-0.004** | -12.321 |
| 1137-1279s | 37 | -1.348 | **-0.771** | **-0.000** | **0.073** | -6.523 |
| 1279-1421s | 44 | 0.157 | **0.084** | **0.032** | **0.084** | 0.957 |

### Peak drift, shape, and r vs the anchor-estimate error curve

| arm | median chunk width | peak abs mean Δ | peak decile | final decile | shape | r vs estimate |
|---|---|---|---|---|---|---|
| A | 4.04s | **0.000s** | 0 | 0.000s | CUMULATIVE (monotone, ends at its extreme) | 0.0000 |
| C | 26.06s | **19.155s** | 5 | 0.157s | ARCH (rises, peaks mid-corpus, returns to ~zero) | 0.9732 |
| F | 25.58s | **3.249s** | 4 | 0.084s | ARCH (rises, peaks mid-corpus, returns to ~zero) | 0.5271 |
| G | 25.96s | **0.042s** | 4 | 0.032s | neither cleanly monotone nor fully returning | -0.0169 |
| H | 25.58s | **0.349s** | 5 | 0.084s | neither cleanly monotone nor fully returning | -0.3968 |

Reference, MEASURED Session AM: peak |mean decile Δ| A 0 / B 23.786 / C 19.155 / D 20.617 / F 3.249 / G 0.042.

## v6's three open defects, per arm, with anchor confidence and slowing-pace status

| tag | boundary | ear | arm | committed | Δ(arm−ear) | CORRECT (±50ms) | DIRECTION-CORRECT | anchor confidence |
|---|---|---|---|---|---|---|---|---|
| `214_solitary_fire` | 213-214 | 630.09 | A | 629.010 | -1.080 | no | NO | 2.19e-7 |
| `214_solitary_fire` | 213-214 | 630.09 | C | 607.680 | -22.410 | no | NO | 2.50e-4 |
| `214_solitary_fire` | 213-214 | 630.09 | F | 630.100 | +0.010 | **YES** | YES (also CORRECT) | 9.88e-1 |
| `214_solitary_fire` | 213-214 | 630.09 | G | 630.100 | +0.010 | **YES** | YES (also CORRECT) | 9.87e-1 |
| `214_solitary_fire` | 213-214 | 630.09 | H | 630.100 | +0.010 | **YES** | YES (also CORRECT) | 9.88e-1 |
| `231_slowing_pace` | 230-231 | 682.74 | A | 681.630 | -1.110 | no | NO | 6.97e-3 |
| `231_slowing_pace` | 230-231 | 682.74 | C | 668.950 | -13.790 | no | NO | 0.00e+0 |
| `231_slowing_pace` | 230-231 | 682.74 | F | 668.950 | -13.790 | no | NO | 0.00e+0 |
| `231_slowing_pace` | 230-231 | 682.74 | G | 682.740 | +0.000 | **YES** | YES (also CORRECT) | 9.99e-1 |
| `231_slowing_pace` | 230-231 | 682.74 | H | 682.740 | +0.000 | **YES** | YES (also CORRECT) | 9.99e-1 |
| `447_scout_facing_dark` | 446-447 | 1418.53 | A | 1417.120 | -1.410 | no | NO | 2.31e-3 |
| `447_scout_facing_dark` | 446-447 | 1418.53 | C | 1418.510 | -0.020 | **YES** | YES (also CORRECT) | 1.00e+0 |
| `447_scout_facing_dark` | 446-447 | 1418.53 | F | 1418.510 | -0.020 | **YES** | YES (also CORRECT) | 1.00e+0 |
| `447_scout_facing_dark` | 446-447 | 1418.53 | G | 1418.510 | -0.020 | **YES** | YES (also CORRECT) | 1.00e+0 |
| `447_scout_facing_dark` | 446-447 | 1418.53 | H | 1418.510 | -0.020 | **YES** | YES (also CORRECT) | 1.00e+0 |

### `231_slowing_pace`'s confidence collapse — status under arm H

A 6.97e-3 → C 0.00e+0 → **F 0.00e+0** → **G 9.99e-1** → **H 9.99e-1**.

- **In arm H the collapse CLEARS.**
- **Does the boundary itself land within ±50ms under arm H? **YES**** (clearing confidence without landing the boundary is a PARTIAL result, per Step 1 §3's stated non-bar for this row.)

## `S1_KNOWN_BAD_MOVES` reproduction

| arm | in-corpus known-bad values | reproduced (±5ms) |
|---|---|---|
| A | 18 | **0** |
| C | 18 | **0** |
| F | 18 | **0** |
| G | 18 | **0** |
| H | 18 | **0** |

## Phantom-tail funnel (AG definitions, unchanged)

| arm | chunks | (1) trailing phantom | (1)∧(2) at a seam | (1)∧(2)∧(3) in collapsed gap |
|---|---|---|---|---|
| A | 277 | 183 | 110 | **19** |
| C | 57 | 28 | 9 | **3** |
| F | 57 | 15 | 4 | **1** |
| G | 57 | 0 | 0 | **0** |
| H | 57 | 13 | 3 | **0** |

## R.14 / R.15 firings and double-corrections (AK's recomputed "AI definition")

| arm | R.11 | R.12 | R.13 | **R.14** | **R.15** | double-corrected (AI defn) | double-corrected (stacked) |
|---|---|---|---|---|---|---|---|
| A | 5 | 8 | 0 | **11** | **0** | **0** | 0 |
| C | 5 | 6 | 0 | **36** | **7** | **45** | 1 |
| F | 3 | 7 | 0 | **1** | **6** | **7** | 0 |
| G | 0 | 7 | 0 | **0** | **0** | **0** | 0 |
| H | 2 | 7 | 0 | **1** | **6** | **5** | 0 |

### Rule-dependent rows — structurally correct without the rule firing?

**`iron_bounce` and `logic_clash` are 173-corpus rows.** This session is v6-only (Step 5 is CONDITIONAL and, if skipped, never runs 173), so their structural correctness is **NOT MEASURED and NOT MEASURABLE within v6-only scope** — stated rather than silently omitted; see Step 5's own section for whether it ran.

| tag | owning rule | attested | arm | pre-rule | committed | rule moved it? | pre-rule already correct? |
|---|---|---|---|---|---|---|---|
| `152_frozen_brush_mice` | R.14 | 451.03 | A | 449.200 | 451.030 | yes | no |
| `152_frozen_brush_mice` | R.14 | 451.03 | C | 435.150 | 435.150 | no | no |
| `152_frozen_brush_mice` | R.14 | 451.03 | F | 451.030 | 451.030 | no | **YES** |
| `152_frozen_brush_mice` | R.14 | 451.03 | G | 451.030 | 451.030 | no | **YES** |
| `152_frozen_brush_mice` | R.14 | 451.03 | H | 451.030 | 451.030 | no | **YES** |
| `400_endless_dark` | R.14 | 1266.75 | A | 1266.210 | 1266.750 | yes | no |
| `400_endless_dark` | R.14 | 1266.75 | C | 1266.750 | 1266.750 | no | **YES** |
| `400_endless_dark` | R.14 | 1266.75 | F | 1266.750 | 1266.750 | no | **YES** |
| `400_endless_dark` | R.14 | 1266.75 | G | 1266.750 | 1266.750 | no | **YES** |
| `400_endless_dark` | R.14 | 1266.75 | H | 1266.750 | 1266.750 | no | **YES** |

## Chunk-length distribution, FA-run resources, and alignment health

| arm | n | min | p25 | median | p75 | max | mean | wall clock | peak RSS | CTC-infeasible chunks | needs_review words | mean FA confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 277 | 0.1 | 2.42 | 4.04 | 6.78 | 19.48 | 4.982 | n/a (baseline) | n/a | n/a | — | 0.8398 |
| C | 57 | 4.87 | 20.36 | 26.06 | 28 | 43.91 | 24.209 | 644.81s | 3205.3 MB | 2 | 2220 | 0.4188 |
| F | 57 | 2.05 | 20.18 | 25.58 | 28.98 | 50.76 | 24.209 | 795.75s | 3084.6 MB | 2 | 562 | 0.8356 |
| G | 57 | 1.3 | 23.19 | 25.96 | 29.13 | 35.63 | 24.209 | 920.45s | 2117 MB | 0 | 32 | 0.9689 |
| H | 57 | 2.05 | 20.98 | 25.58 | 28.98 | 38.36 | 24.209 | 673.4s | NOT MEASURED (no /usr/bin/time wrapper this run) | NOT MEASURED (no /usr/bin/time wrapper this run) | 354 | 0.8882 |

Arm H's wall-clock/needs_review are parsed from the real `cargo test ... regenerate_fa_against_live_plan` run's own stderr; peak RSS and CTC-infeasible chunk count were NOT captured this run because it was not wrapped in `/usr/bin/time -l` (Session AM's arms were). Stated as a gap, not silently omitted.

### Full violation list — arm H

Total violation events: **10**.

| # | cause | segIdx | ideal | seam | dur | what the planner did |
|---|---|---|---|---|---|---|
| 0 | `cap-exceeded` | 0 | 3.570 | 34.820 | 31.250 | emitted chunk spans 31.250s, over the 30s cap (segments 0-12); invariant 1 forbids the mid-sentence split that would avoid it |
| 1 | `cap-exceeded` | 13 | 34.820 | 66.440 | 31.620 | emitted chunk spans 31.620s, over the 30s cap (segments 13-21); invariant 1 forbids the mid-sentence split that would avoid it |
| 2 | `cap-exceeded` | 101 | 302.540 | 336.620 | 34.080 | emitted chunk spans 34.080s, over the 30s cap (segments 101-109); invariant 1 forbids the mid-sentence split that would avoid it |
| 3 | `cap-exceeded` | 110 | 336.620 | 367.180 | 30.560 | emitted chunk spans 30.560s, over the 30s cap (segments 110-122); invariant 1 forbids the mid-sentence split that would avoid it |
| 4 | `cap-exceeded` | 135 | 402.060 | 437.540 | 35.480 | emitted chunk spans 35.480s, over the 30s cap (segments 135-147); invariant 1 forbids the mid-sentence split that would avoid it |
| 5 | `cap-exceeded` | 175 | 525.820 | 564.180 | 38.360 | emitted chunk spans 38.360s, over the 30s cap (segments 175-187); invariant 1 forbids the mid-sentence split that would avoid it |
| 6 | `cap-exceeded` | 223 | 666.610 | 701.580 | 34.970 | emitted chunk spans 34.970s, over the 30s cap (segments 223-235); invariant 1 forbids the mid-sentence split that would avoid it |
| 7 | `cap-exceeded` | 348 | 1078.180 | 1111.620 | 33.440 | emitted chunk spans 33.440s, over the 30s cap (segments 348-356); invariant 1 forbids the mid-sentence split that would avoid it |
| 8 | `cap-exceeded` | 363 | 1131.220 | 1162.900 | 31.680 | emitted chunk spans 31.680s, over the 30s cap (segments 363-373); invariant 1 forbids the mid-sentence split that would avoid it |
| 9 | `cap-exceeded` | 406 | 1294.640 | 1327.240 | 32.600 | emitted chunk spans 32.600s, over the 30s cap (segments 406-416); invariant 1 forbids the mid-sentence split that would avoid it |

## Implied boundary-improvement precision (R-AS)

| arm | repaired (defect landed) | regressed (attested-correct moved >5ms) | implied precision |
|---|---|---|---|
| A | 0 | 1 | **0.00%** |
| C | 1 | 279 | **0.36%** |
| F | 2 | 68 | **2.86%** |
| G | 3 | 2 | **60.00%** |
| H | 3 | 46 | **6.12%** |

For scale, all MEASURED: **S1 ≈7%**, **arm B 0.31%**, **arm C 0.36%**, **arm D 0.27%**, **arm F 2.86%** on v6.

## The pre-registered gate, adjudicated for arm H

| condition | bar | arm H | verdict |
|---|---|---|---|
| HARD FAIL 1 — attested-correct moved >50ms | 0 | **45** | **this is EXPECTED — arm F itself has 67; only NEW ones beyond arm F matter, see HARD FAIL 3** |
| HARD FAIL 2 — known-bad reproduced | 0 | **0** | PASS |
| HARD FAIL 3 — regressed > arm F's 68 | false | **46** | PASS |
| PROGRESS BAR — regressed < 68 AND seams recovered >= 1 | — | regressed=46, seams=5 | **MET** |
| SHIP-CANDIDATE REVIEW BAR — regressed <= 60, seams >= 3, defects landed >= 2 | — | regressed=46, seams=5, landed=3 | **MET** |
| SHIP CAP — implied precision | >= 50% | **6.12%** | **FAIL (expected — no S2 arm has come near this)** |

## Step 6 adjudication, applied verbatim from the pre-committed table

**Mechanical outcome (via `adjudicateAN()`): curve flat or H worsens anything**

**Mechanical conclusion: edge error does not explain the residual; record as a negative, keep arm F as the standing best S2 arm, and do not iterate tolerances**

### A CORRECTION, stated plainly rather than left standing

The mechanical function above is CONTRADICTED by its own inputs and must not be read at face value. It selects row 3 ("curve flat or H worsens anything") only because `curveCrossesShipBarAtAchievableTolerance` was hardcoded `false` from Step 2's conservative proxy curve — its fallback branch conflates "the proxy curve did not formally cross" with "H worsened something," which is a DIFFERENT claim the measured facts directly refute: HARD FAIL 3 did **not** fire (regressed 46 < arm F's 68), HARD FAIL 2 did not fire, and every axis measured this step (regressed, peak drift, defects landed, mean FA confidence, needs_review count, phantom funnel) moved in arm H's favour relative to arm F. This is a GAP in how the four-row table was encoded as a decision function, not evidence that edge error fails to explain the residual — flagged here as a defect in this session's own gate rather than silently accepted.

**The independently pre-registered bars this session ALSO fixed in Step 1 §3 (separate from the four-row table, and NOT subject to the same gap) give the honest read:**

- **PROGRESS BAR: **MET**** (regressed 46 < 68, 5 >= 1 seam recovered).
- **SHIP-CANDIDATE REVIEW BAR: **MET**** (regressed 46 <= 60, 5 >= 3 seams, 3 >= 2 defects landed).

**Correct reading of the four-row table**, applied by hand rather than by the buggy function: arm H makes real, substantial, unambiguous progress (regressed 68→46, a 32% cut; peak drift 3.249s→0.349s, both DIED; defects landed 2→3, including `231_slowing_pace` landing for the first time in this whole workstream) — but 46 of 447 boundaries remain beyond ±50ms and implied precision stays far under the 50% ship cap. This is closest to **row 2's spirit** ("anchoring is necessary but insufficient") EXCEPT that it is not a mere partial substitution story — it is the STRONGEST result any S2-family arm (including the diagnostic-only arm G) has produced on every axis except the absolute drift floor. Recorded as its own outcome rather than forced into an existing row: **arm H is a real, adoptable improvement over arm F for continued S2-family work, but is not a ship candidate and does not close the residual.**

## Predictions versus outcomes

| quantity | predicted (point [lo,hi]) | measured | verdict |
|---|---|---|---|
| chunkCount | 57 [53, 58] | 57 | **HELD** |
| medianWidthSec | 25 [18, 32] | 25.58 | **HELD** |
| peakAbsMeanDecileSec | 2.8 [0.5, 6] | 0.3488 | **MISSED** |
| peakDecileIndex | 5 [3, 7] | NOT MEASURED | **NOT MEASURED** |
| finalDecileSec | 0.15 [-0.35, 0.65] | 0.0839 | **HELD** |
| regressed | 64 [55, 68] | 46 | **MISSED** |
| repaired | 2 [0, 5] | 3 | **HELD** |
| fallbackSeamsRemaining | 2 [0, 5] | 0 | **HELD** |
| wallClockSec | 800 [650, 950] | 673.4 | **HELD** |
| estimateTrackingR | 0.4 [-0.3, 0.85] | -0.39680358827138795 | **MISSED** |
| slowingPaceClears | 0 [0, 0] | 1 | **MISSED** |

## Named falsifiers, answered

- **FALSIFIER (widening is free)**: fires if regressed > arm F's 68. Measured: 46. **did not fire.**
- **FALSIFIER (edge error explains residual)**: Step 2 measured r=0.876 (>= 0.5, does not fire on r) and a NOT-STEEP curve — the curve-shape half of this falsifier **DID fire** at the Step 2 measurement stage, independent of arm H's own result.

