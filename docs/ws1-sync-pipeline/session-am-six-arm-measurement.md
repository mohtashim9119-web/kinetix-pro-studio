# WS1 Session AM Step 5 — v6 six-arm measurement (MEASURED)

Arm E was never triggered and its label stays retired — it is absent by design, not by oversight.

## The pre-registered gate (imported verbatim from `ws1-session-am-step1-gate.ts`)

```json
{
  "scope": "v6 only — no 173, no spanish",
  "arms": {
    "F": "anchor-placed chunk edges (qi-nearest three-source-agreement anchor)",
    "G": "oracle-placed chunk edges — DIAGNOSTIC ONLY, can never ship"
  },
  "hardFailMoveSec": 0.05,
  "knownBadReproductionsAllowed": 0,
  "knownBadMatchSec": 0.005,
  "minDefectsRequired": 3,
  "defectsLandedByExistingArms": {
    "armB": 1,
    "armC": 1,
    "armD": 1,
    "theRow": "447_scout_facing_dark",
    "note": "MEASURED Session AL Step 4 — the same single row in all three arms, and it is v6's LAST boundary, where every arm's drift has already returned to ~+0.15s."
  },
  "defectLandedSec": 0.05,
  "earBillToleranceSec": 0.005,
  "minImpliedPrecision": 0.5,
  "v6AttestedTotal": 447,
  "v6AttestedCorrect": 444,
  "worseThanArmCAbove": 279,
  "worseThanProductionAbove": 1,
  "materiallyBetterAtOrBelow": 139,
  "archDiedAtOrBelowSec": 5,
  "archSurvivedAtOrAboveSec": 14,
  "targetMinSec": 10,
  "targetMaxSec": 30,
  "silenceSearchWindowSec": 5,
  "armFTolerance": {
    "space": "script-word index (qi)",
    "rule": "nearest anchor by |anchor.qi - seamQi|, admissible only within the two sentence groups the seam separates",
    "tieBreak": "on equal |Δqi|, prefer qi >= seamQi",
    "numericConstants": 0,
    "label": "GEOMETRIC (structural — derived from the planner's own group atoms; no millisecond radius, no tunable)"
  },
  "armFFallbackPartialAbove": 0.3333333333333333,
  "anchorUniformityMinDecileFraction": 0.5,
  "armGIsDiagnosticOnly": true,
  "armGShipGateApplies": false,
  "armGDefectiveOracleRows": 3,
  "falsifierF": {
    "claim": "Estimate-derived chunk-edge placement is what drives v6's S2 drift arch.",
    "statement": "Arm F's peak |mean decile Δ| at a value >= 14.0s — the SURVIVED band — while at least two thirds of its internal chunk edges are placed at three-source-agreement anchors by script-word index, would refute the claim that estimate-derived chunk-edge placement drives v6's S2 drift arch.",
    "measuredQuantity": "peak |mean decile Δ| for arm F, together with arm F's anchor-substitution rate",
    "firesAtOrAbove": 14,
    "requiresSubstitutionAtLeast": 0.6666666666666666
  },
  "falsifierG": {
    "claim": "Chunk-edge ACCURACY — of any kind, however obtained — is the mechanism behind v6's S2 drift arch.",
    "statement": "Arm G's peak |mean decile Δ| at a value >= 14.0s — the SURVIVED band — while every internal chunk edge sits at an attested oracle boundary time, would refute the claim that chunk-edge accuracy is the mechanism, and would exonerate the chunk plan entirely: no chunk-plan-based fix could then do better than a ceiling that already fails.",
    "measuredQuantity": "peak |mean decile Δ| for arm G, together with arm G's oracle-substitution rate",
    "firesAtOrAbove": 14,
    "requiresSubstitutionAtLeast": 1
  }
}
```

| arm | plan | chunks | committed | rules fired |
|---|---|---|---|---|
| A | production (`fa_live_chunks.json`) | 277 | 447 | `{"R.5":10,"R.10":0,"R.11":5,"R.12":8,"R.13":0,"R.14":11,"R.15":0}` |
| B | S2 10-30s | 54 | 445 | `{"R.5":10,"R.10":2,"R.11":2,"R.12":3,"R.13":0,"R.14":64,"R.15":7}` |
| C | S2+R.5 excision 10-30s | 57 | 446 | `{"R.5":10,"R.10":1,"R.11":5,"R.12":6,"R.13":0,"R.14":36,"R.15":7}` |
| D | period-strict 1-15s +R.5 | 110 | 447 | `{"R.5":10,"R.10":0,"R.11":4,"R.12":8,"R.13":0,"R.14":59,"R.15":6}` |
| F | **anchor-placed edges, 10-30s +R.5** | 57 | 447 | `{"R.5":10,"R.10":0,"R.11":3,"R.12":7,"R.13":0,"R.14":1,"R.15":6}` |
| G | **oracle-placed edges, 10-30s +R.5** — DIAGNOSTIC ONLY | 57 | 447 | `{"R.5":10,"R.10":0,"R.11":0,"R.12":7,"R.13":0,"R.14":0,"R.15":0}` |

## Oracle diff per arm — the headline number, six arms side by side

| arm | compared | unchanged | repaired | **regressed** | unadjudicable | moved total | beyond ±50ms |
|---|---|---|---|---|---|---|---|
| A | 447 | 446 | **0** | **1** | 0 | 1 | **0** |
| B | 447 | 116 | **1** | **326** | 4 | 331 | **325** |
| C | 447 | 164 | **1** | **279** | 3 | 283 | **278** |
| D | 447 | 81 | **1** | **363** | 2 | 366 | **362** |
| F | 447 | 376 | **2** | **68** | 1 | 71 | **67** |
| G | 447 | 442 | **3** | **2** | 0 | 5 | **0** |

Every arm's five categories sum to 447 — asserted, not asserted-in-prose.

- arm A unadjudicable breakdown: `{}`
- arm B unadjudicable breakdown: `{"absent-from-arm":2,"open-defect-moved-without-landing":2}`
- arm C unadjudicable breakdown: `{"absent-from-arm":1,"open-defect-moved-without-landing":2}`
- arm D unadjudicable breakdown: `{"open-defect-moved-without-landing":2}`
- arm F unadjudicable breakdown: `{"open-defect-moved-without-landing":1}`
- arm G unadjudicable breakdown: `{}`

## Drift profile along the timeline (arm value − arm A value)

| decile | n | B | C | D | **F** | **G** | estimate error |
|---|---|---|---|---|---|---|---|
| 0-142s | 47 | -0.968 | -0.877 | -2.238 | **-0.000** | **-0.000** | -5.056 |
| 142-284s | 48 | -2.677 | -1.762 | -5.966 | **-0.182** | **0.000** | -7.302 |
| 284-426s | 48 | -9.241 | -8.151 | -9.473 | **-0.542** | **0.000** | -11.362 |
| 426-569s | 47 | -17.353 | -13.534 | -14.243 | **-1.674** | **0.000** | -16.671 |
| 569-711s | 52 | -23.252 | -17.366 | -18.627 | **-3.249** | **0.042** | -22.370 |
| 711-853s | 42 | -23.786 | -19.155 | -20.617 | **0.349** | **0.000** | -23.347 |
| 853-995s | 40 | -17.848 | -14.801 | -15.374 | **-2.152** | **0.000** | -17.478 |
| 995-1137s | 42 | -12.318 | -7.810 | -10.364 | **-0.004** | **0.000** | -12.321 |
| 1137-1279s | 37 | -2.735 | -1.348 | -5.077 | **-0.771** | **-0.000** | -6.523 |
| 1279-1421s | 44 | 0.157 | 0.157 | 0.147 | **0.084** | **0.032** | 0.957 |

The last column is the ANCHOR-BASED ESTIMATE's own error against the oracle
(`applyAnchorBasedTiming(anchorTimed).startTime − oracle.startTime`). It involves no FA, no chunk
plan and no band, so it is identical for every arm by construction — which is exactly what makes
it usable as a reference independent of the arm under test, and why it is retained here.

### Arch verdicts, against the bands fixed numerically in Step 1

DIED at peak |mean decile Δ| <= **5s**; SURVIVED at >= **14s**;
anything strictly between is **PARTIAL** and is reported as partial. These were fixed before the
planners existed and are not retro-fitted.

| arm | median chunk width | peak abs mean Δ | peak decile | final decile | shape | **arch verdict** | r vs estimate |
|---|---|---|---|---|---|---|---|
| A | 4.04s | **0.000s** | 0 | 0.000s | CUMULATIVE (monotone, ends at its extreme) | **n/a (baseline)** | 0.0000 |
| B | 27.44s | **23.786s** | 5 | 0.157s | ARCH (rises, peaks mid-corpus, returns to ~zero) | **SURVIVED** | 0.9778 |
| C | 26.06s | **19.155s** | 5 | 0.157s | ARCH (rises, peaks mid-corpus, returns to ~zero) | **SURVIVED** | 0.9732 |
| D | 12.86s | **20.617s** | 5 | 0.147s | ARCH (rises, peaks mid-corpus, returns to ~zero) | **SURVIVED** | 0.9940 |
| F | 25.58s | **3.249s** | 4 | 0.084s | ARCH (rises, peaks mid-corpus, returns to ~zero) | **DIED** | 0.5271 |
| G | 25.96s | **0.042s** | 4 | 0.032s | neither cleanly monotone nor fully returning | **DIED** | -0.0169 |
| _estimate itself_ | — | 23.347s | 5 | 0.957s | ARCH (rises, peaks mid-corpus, returns to ~zero) | — | 1.0000 |

Sessions AK/AL measured the same r for arms B/C/D at 0.9778 / 0.9732 / 0.994, and the estimate's own peak at 23.347s. Median widths then: A 4.04 / B 27.44 / C 26.06 / D 12.86.

## Ear-verified controls (the v6 rows the operator listened to)

| arm | controls moved off the arm-A value |
|---|---|
| A | **0** / 42 |
| B | **30** / 42 |
| C | **18** / 42 |
| D | **22** / 42 |
| F | **3** / 42 |
| G | **1** / 42 |

### The 30 arm-B control regressions, per arm

| tag | A | B | C | D | F | G | arm-F status | arm-G status |
|---|---|---|---|---|---|---|---|---|
| `308_scouts_leading` | 931.400 | 909.710 | 929.960 | 929.648 | 931.400 | 931.400 | REPAIRED | REPAIRED |
| `152_frozen_brush_mice` | 451.030 | 435.150 | 435.150 | 432.640 | 451.030 | 451.030 | REPAIRED | REPAIRED |
| `226_four_scouts` | 671.170 | 648.930 | 667.179 | 667.179 | 667.179 | 671.170 | PARTIAL | REPAIRED |
| `125_night_circle` | 370.750 | 357.890 | 370.750 | 370.750 | 370.750 | 370.750 | REPAIRED | REPAIRED |
| `176_twenty_six_scout` | 522.460 | 504.800 | 522.460 | 522.460 | 522.460 | 522.460 | REPAIRED | REPAIRED |
| `266_forty_one_burden` | 788.750 | 764.250 | 788.750 | 788.750 | 788.750 | 788.750 | REPAIRED | REPAIRED |
| `340_fifty_eight` | 1045.620 | 1032.060 | 1045.620 | 1045.620 | 1045.620 | 1045.620 | REPAIRED | REPAIRED |
| `192_scout_listening` | 571.070 | 548.820 | 548.820 | 548.820 | 571.070 | 571.070 | REPAIRED | REPAIRED |
| `158_scout_false_alert` | 466.090 | 451.030 | 451.030 | 449.200 | 466.090 | 466.090 | REPAIRED | REPAIRED |
| `318_scout_on_ridge` | 969.300 | 954.440 | 954.440 | 955.830 | 969.300 | 969.300 | REPAIRED | REPAIRED |
| `087_throwing_spear_poise` | 259.880 | 252.740 | 259.880 | 257.920 | 259.880 | 259.880 | REPAIRED | REPAIRED |
| `231_slowing_pace` | 681.630 | 657.350 | 668.950 | 668.950 | 668.950 | 682.740 | PARTIAL | PARTIAL |
| `224_thirty_three` | 664.330 | 644.100 | 664.330 | 664.330 | 664.330 | 664.330 | REPAIRED | REPAIRED |
| `307_forty_nine_years` | 925.430 | 907.560 | 925.430 | 925.430 | 925.430 | 925.430 | REPAIRED | REPAIRED |
| `383_sixty_four` | 1189.050 | 1184.210 | 1189.050 | 1189.050 | 1189.050 | 1189.050 | REPAIRED | REPAIRED |
| `039_river_trap` | 114.640 | 111.910 | 111.910 | 108.550 | 114.640 | 114.640 | REPAIRED | REPAIRED |
| `221_skill_removes` | 654.450 | 634.570 | 654.450 | 654.450 | 654.450 | 654.450 | REPAIRED | REPAIRED |
| `222_long_silence` | 659.330 | 638.380 | 659.330 | 659.330 | 659.330 | 659.330 | REPAIRED | REPAIRED |
| `289_winter_predator_breach` | 865.390 | 843.500 | 843.500 | 842.270 | 865.390 | 865.390 | REPAIRED | REPAIRED |
| `057_root_trip` | 171.750 | 167.700 | 171.750 | 166.050 | 171.750 | 171.750 | REPAIRED | REPAIRED |
| `076_feeling_change` | 228.200 | 223.340 | 228.200 | 228.200 | 228.200 | 228.200 | REPAIRED | REPAIRED |
| `213_pensive_stare` | 626.770 | 604.910 | 604.910 | 604.910 | 626.770 | 626.770 | REPAIRED | REPAIRED |
| `216_chest_revelation` | 638.380 | 619.310 | 617.430 | 619.310 | 638.380 | 638.380 | REPAIRED | REPAIRED |
| `273_cold_grass` | 820.310 | 799.070 | 799.380 | 799.070 | 820.310 | 820.310 | REPAIRED | REPAIRED |
| `293_sitting_brooding` | 881.000 | 862.680 | 862.680 | 862.680 | 870.747 | 881.000 | PARTIAL | REPAIRED |
| `305_carrying_grief` | 919.180 | 900.880 | 919.180 | 900.880 | 919.180 | 919.180 | REPAIRED | REPAIRED |
| `325_contrasting_student` | 995.150 | 983.450 | 983.450 | 984.690 | 995.150 | 995.150 | REPAIRED | REPAIRED |
| `364_the_full_cost` | 1130.760 | 1124.450 | 1124.450 | 1124.450 | 1130.760 | 1130.760 | REPAIRED | REPAIRED |
| `367_dropped_torch` | 1137.430 | 1132.840 | 1137.430 | 1130.760 | 1137.430 | 1137.430 | REPAIRED | REPAIRED |
| `443_scout_cliff_edge` | 1408.760 | 1410.590 | 1410.590 | 1410.590 | 1408.760 | 1408.760 | REPAIRED | REPAIRED |

- **arm F vs the arm-B regression set: repaired 27 | partial 3 | unchanged 0 | worsened 0 | absent 0**
- **arm G vs the same set: repaired 29 | partial 1 | unchanged 0 | worsened 0 | absent 0**
- for reference, MEASURED: arm C repaired 14 / partial 4 / unchanged 11 / worsened 1; arm D repaired 14.

## v6's three open defects, per arm

| tag | boundary | ear | arm | committed | Δ(arm−ear) | CORRECT (±50ms) | DIRECTION-CORRECT | incoming anchor confidence |
|---|---|---|---|---|---|---|---|---|
| `214_solitary_fire` | 213-214 | 630.09 | A | 629.010 | -1.080 | no | NO | 2.19e-7 |
| `214_solitary_fire` | 213-214 | 630.09 | B | 607.680 | -22.410 | no | NO | 2.19e-4 |
| `214_solitary_fire` | 213-214 | 630.09 | C | 607.680 | -22.410 | no | NO | 2.50e-4 |
| `214_solitary_fire` | 213-214 | 630.09 | D | 608.770 | -21.320 | no | NO | 8.16e-1 |
| `214_solitary_fire` | 213-214 | 630.09 | F | 630.100 | +0.010 | **YES** | YES (also CORRECT) | 9.88e-1 |
| `214_solitary_fire` | 213-214 | 630.09 | G | 630.100 | +0.010 | **YES** | YES (also CORRECT) | 9.87e-1 |
| `231_slowing_pace` | 230-231 | 682.74 | A | 681.630 | -1.110 | no | NO | 6.97e-3 |
| `231_slowing_pace` | 230-231 | 682.74 | B | 657.350 | -25.390 | no | NO | 2.26e-5 |
| `231_slowing_pace` | 230-231 | 682.74 | C | 668.950 | -13.790 | no | NO | 0.00e+0 |
| `231_slowing_pace` | 230-231 | 682.74 | D | 668.950 | -13.790 | no | NO | 0.00e+0 |
| `231_slowing_pace` | 230-231 | 682.74 | F | 668.950 | -13.790 | no | NO | 0.00e+0 |
| `231_slowing_pace` | 230-231 | 682.74 | G | 682.740 | +0.000 | **YES** | YES (also CORRECT) | 9.99e-1 |
| `447_scout_facing_dark` | 446-447 | 1418.53 | A | 1417.120 | -1.410 | no | NO | 2.31e-3 |
| `447_scout_facing_dark` | 446-447 | 1418.53 | B | 1418.510 | -0.020 | **YES** | YES (also CORRECT) | 1.00e+0 |
| `447_scout_facing_dark` | 446-447 | 1418.53 | C | 1418.510 | -0.020 | **YES** | YES (also CORRECT) | 1.00e+0 |
| `447_scout_facing_dark` | 446-447 | 1418.53 | D | 1418.510 | -0.020 | **YES** | YES (also CORRECT) | 1.00e+0 |
| `447_scout_facing_dark` | 446-447 | 1418.53 | F | 1418.510 | -0.020 | **YES** | YES (also CORRECT) | 1.00e+0 |
| `447_scout_facing_dark` | 446-447 | 1418.53 | G | 1418.510 | -0.020 | **YES** | YES (also CORRECT) | 1.00e+0 |

### `231_slowing_pace`'s confidence collapse — the cleanest marker available

Arm A 6.97e-3 → B 2.26e-5 → C 0.00e+0 → D 0.00e+0 → **F 0.00e+0** → **G 9.99e-1**.

- **In arm F the collapse PERSISTS** — **COLLAPSED (0.00e+0)**.
- **In arm G the collapse DOES NOT PERSIST** — recovered above arm C.

It held identically at 0.00e+0 in arms C and D. A collapse that survives even ORACLE-PLACED
edges cannot be caused by where the chunk edge sits; one that clears under them can.

## `S1_KNOWN_BAD_MOVES` reproduction

| arm | in-corpus known-bad values | reproduced (±5ms) |
|---|---|---|
| A | 18 | **0** |
| B | 18 | **0** |
| C | 18 | **0** |
| D | 18 | **0** |
| F | 18 | **0** |
| G | 18 | **0** |

## Phantom-tail funnel (AG definitions, unchanged)

| arm | chunks | (1) trailing phantom | (1)∧(2) at a seam | (1)∧(2)∧(3) in collapsed gap | rows |
|---|---|---|---|---|---|
| A | 277 | 183 | 110 | **19** | 008_unknown_void, 009_large_shadow, 024_hand_warm_stones, 039_river_trap, 083_unbidden_alertness, 117_scout_imagined_monster, 125_night_circle, 221_skill_removes, 222_long_silence, 274_stillness_ache, 289_winter_predator_breach, 293_sitting_brooding, 313_fen_silent_gaze, 322_body_readiness, 340_fifty_eight, 368_forest_terror, 400_endless_dark, 401_nightfall_encroaching, 437_glowing_eyes_shadows |
| B | 54 | 22 | 6 | **0** | (none) |
| C | 57 | 28 | 9 | **3** | 012_sudden_hush, 078_column_stops, 373_slow_blade_draw |
| D | 110 | 27 | 8 | **2** | 012_sudden_hush, 078_column_stops |
| F | 57 | 15 | 4 | **1** | 373_slow_blade_draw |
| G | 57 | 0 | 0 | **0** | (none) |

## R.14 / R.15 firings and double-corrections

Double-correction uses **Session AK's recomputed "AI definition"**: the arm's chunk-plan change
already moved the PRE-RULE value off arm A's pre-rule value, AND some rule (R.11-R.15) still fires
on that segment. Arm C's measured value under this definition is 45; arm B's is 74.

| arm | R.11 | R.12 | R.13 | **R.14** | **R.15** | double-corrected (AI defn) | double-corrected (stacked) |
|---|---|---|---|---|---|---|---|
| A | 5 | 8 | 0 | **11** | **0** | **0** | 0 |
| B | 2 | 3 | 0 | **64** | **7** | **74** | 0 |
| C | 5 | 6 | 0 | **36** | **7** | **45** | 1 |
| D | 4 | 8 | 0 | **59** | **6** | **69** | 0 |
| F | 3 | 7 | 0 | **1** | **6** | **7** | 0 |
| G | 0 | 7 | 0 | **0** | **0** | **0** | 0 |

### Rule-dependent rows — structurally correct without the rule firing?

**`iron_bounce` and `logic_clash` are 173-corpus rows.** This session is v6-only by operator
direction and runs no 173 alignment, so their structural correctness is **NOT MEASURED and NOT
MEASURABLE within this scope** — stated rather than silently omitted. The two v6 rows follow.

| tag | owning rule | attested | arm | pre-rule | committed | rule moved it? | pre-rule already correct? |
|---|---|---|---|---|---|---|---|
| `152_frozen_brush_mice` | R.14 | 451.03 | A | 449.200 | 451.030 | yes | no |
| `152_frozen_brush_mice` | R.14 | 451.03 | B | 435.150 | 435.150 | no | no |
| `152_frozen_brush_mice` | R.14 | 451.03 | C | 435.150 | 435.150 | no | no |
| `152_frozen_brush_mice` | R.14 | 451.03 | D | 432.640 | 432.640 | no | no |
| `152_frozen_brush_mice` | R.14 | 451.03 | F | 451.030 | 451.030 | no | **YES** |
| `152_frozen_brush_mice` | R.14 | 451.03 | G | 451.030 | 451.030 | no | **YES** |
| `400_endless_dark` | R.14 | 1266.75 | A | 1266.210 | 1266.750 | yes | no |
| `400_endless_dark` | R.14 | 1266.75 | B | 1266.750 | 1266.750 | no | **YES** |
| `400_endless_dark` | R.14 | 1266.75 | C | 1266.750 | 1266.750 | no | **YES** |
| `400_endless_dark` | R.14 | 1266.75 | D | 1266.750 | 1266.750 | no | **YES** |
| `400_endless_dark` | R.14 | 1266.75 | F | 1266.750 | 1266.750 | no | **YES** |
| `400_endless_dark` | R.14 | 1266.75 | G | 1266.750 | 1266.750 | no | **YES** |

## Chunk-length distribution, FA-run resources, and alignment health

| arm | n | min | p25 | median | p75 | max | mean | wall clock | peak RSS | CTC-infeasible chunks | needs_review words |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 277 | 0.1 | 2.42 | 4.04 | 6.78 | 19.48 | 4.982 | n/a (stored arm) | n/a (stored arm) | n/a | n/a |
| B | 54 | 10.57 | 24.7 | 27.44 | 29.2 | 31.92 | 26.32 | n/a (stored arm) | n/a (stored arm) | n/a | n/a |
| C | 57 | 4.87 | 20.36 | 26.06 | 28 | 43.91 | 24.209 | 644.81s | 3205.3 MB | 2 | 2220 / 3874 |
| D | 110 | 1.71 | 10.64 | 12.86 | 14.48 | 33.01 | 12.545 | 611.6s | 2309.4 MB | 6 | 2880 / 3874 |
| F | 57 | 2.05 | 20.18 | 25.58 | 28.98 | 50.76 | 24.209 | 795.75s | 3084.6 MB | 2 | 562 / 3874 |
| G | 57 | 1.3 | 23.19 | 25.96 | 29.13 | 35.63 | 24.209 | 920.45s | 2117 MB | 0 | 32 / 3874 |

Arm C's own MEASURED resources, for scale: 644.81s, 3205.3 MB.

### Violation events, in full

**Arm F — 16 event(s).**

| # | cause | segIdx | ideal | seam | dur | what the planner did |
|---|---|---|---|---|---|---|
| 0 | `cap-exceeded` | 0 | 3.570 | 34.820 | 31.250 | emitted chunk spans 31.250s, over the 30s cap (segments 0-12); invariant 1 forbids the mid-sentence split that would avoid it |
| 1 | `cap-exceeded` | 13 | 34.820 | 66.440 | 31.620 | emitted chunk spans 31.620s, over the 30s cap (segments 13-21); invariant 1 forbids the mid-sentence split that would avoid it |
| 2 | `no-admissible-anchor` | 101 | 297.997 | — | — | no three-source-agreement anchor lies inside the two sentence groups this seam separates (script-word window [817, 842), seam at qi 821); fell back to arm C's own nearest-detected-silence cut, so this edge is NOT substituted and remains an arm-C edge |
| 3 | `cap-exceeded` | 101 | 299.080 | 336.620 | 37.540 | emitted chunk spans 37.540s, over the 30s cap (segments 101-109); invariant 1 forbids the mid-sentence split that would avoid it |
| 4 | `cap-exceeded` | 110 | 336.620 | 367.180 | 30.560 | emitted chunk spans 30.560s, over the 30s cap (segments 110-122); invariant 1 forbids the mid-sentence split that would avoid it |
| 5 | `cap-exceeded` | 135 | 402.060 | 437.540 | 35.480 | emitted chunk spans 35.480s, over the 30s cap (segments 135-147); invariant 1 forbids the mid-sentence split that would avoid it |
| 6 | `no-admissible-anchor` | 172 | 499.872 | — | — | no three-source-agreement anchor lies inside the two sentence groups this seam separates (script-word window [1370, 1389), seam at qi 1377); fell back to arm C's own nearest-detected-silence cut, so this edge is NOT substituted and remains an arm-C edge |
| 7 | `cap-exceeded` | 175 | 525.820 | 564.180 | 38.360 | emitted chunk spans 38.360s, over the 30s cap (segments 175-187); invariant 1 forbids the mid-sentence split that would avoid it |
| 8 | `no-admissible-anchor` | 236 | 672.660 | — | — | no three-source-agreement anchor lies inside the two sentence groups this seam separates (script-word window [1843, 1865), seam at qi 1850); fell back to arm C's own nearest-detected-silence cut, so this edge is NOT substituted and remains an arm-C edge |
| 9 | `cap-exceeded` | 236 | 671.480 | 722.240 | 50.760 | emitted chunk spans 50.760s, over the 30s cap (segments 236-244); invariant 1 forbids the mid-sentence split that would avoid it |
| 10 | `no-admissible-anchor` | 296 | 871.161 | — | — | no three-source-agreement anchor lies inside the two sentence groups this seam separates (script-word window [2392, 2404), seam at qi 2396); fell back to arm C's own nearest-detected-silence cut, so this edge is NOT substituted and remains an arm-C edge |
| 11 | `cap-exceeded` | 296 | 873.360 | 916.500 | 43.140 | emitted chunk spans 43.140s, over the 30s cap (segments 296-302); invariant 1 forbids the mid-sentence split that would avoid it |
| 12 | `cap-exceeded` | 348 | 1078.180 | 1111.620 | 33.440 | emitted chunk spans 33.440s, over the 30s cap (segments 348-356); invariant 1 forbids the mid-sentence split that would avoid it |
| 13 | `no-admissible-anchor` | 374 | 1151.311 | — | — | no three-source-agreement anchor lies inside the two sentence groups this seam separates (script-word window [3149, 3165), seam at qi 3155); fell back to arm C's own nearest-detected-silence cut, so this edge is NOT substituted and remains an arm-C edge |
| 14 | `cap-exceeded` | 374 | 1151.620 | 1188.050 | 36.430 | emitted chunk spans 36.430s, over the 30s cap (segments 374-381); invariant 1 forbids the mid-sentence split that would avoid it |
| 15 | `cap-exceeded` | 406 | 1294.640 | 1327.240 | 32.600 | emitted chunk spans 32.600s, over the 30s cap (segments 406-416); invariant 1 forbids the mid-sentence split that would avoid it |

**Arm G — 10 event(s).**

| # | cause | segIdx | ideal | seam | dur | what the planner did |
|---|---|---|---|---|---|---|
| 0 | `cap-exceeded` | 0 | 3.570 | 36.290 | 32.720 | emitted chunk spans 32.720s, over the 30s cap (segments 0-12); invariant 1 forbids the mid-sentence split that would avoid it |
| 1 | `cap-exceeded` | 58 | 181.730 | 211.740 | 30.010 | emitted chunk spans 30.010s, over the 30s cap (segments 58-69); invariant 1 forbids the mid-sentence split that would avoid it |
| 2 | `cap-exceeded` | 84 | 253.320 | 283.640 | 30.320 | emitted chunk spans 30.320s, over the 30s cap (segments 84-93); invariant 1 forbids the mid-sentence split that would avoid it |
| 3 | `cap-exceeded` | 110 | 336.190 | 368.450 | 32.260 | emitted chunk spans 32.260s, over the 30s cap (segments 110-122); invariant 1 forbids the mid-sentence split that would avoid it |
| 4 | `cap-exceeded` | 124 | 373.490 | 404.670 | 31.180 | emitted chunk spans 31.180s, over the 30s cap (segments 124-134); invariant 1 forbids the mid-sentence split that would avoid it |
| 5 | `cap-exceeded` | 135 | 404.670 | 437.220 | 32.550 | emitted chunk spans 32.550s, over the 30s cap (segments 135-147); invariant 1 forbids the mid-sentence split that would avoid it |
| 6 | `cap-exceeded` | 175 | 525.820 | 561.450 | 35.630 | emitted chunk spans 35.630s, over the 30s cap (segments 175-187); invariant 1 forbids the mid-sentence split that would avoid it |
| 7 | `cap-exceeded` | 223 | 666.610 | 697.050 | 30.440 | emitted chunk spans 30.440s, over the 30s cap (segments 223-235); invariant 1 forbids the mid-sentence split that would avoid it |
| 8 | `cap-exceeded` | 326 | 1005.240 | 1035.310 | 30.070 | emitted chunk spans 30.070s, over the 30s cap (segments 326-335); invariant 1 forbids the mid-sentence split that would avoid it |
| 9 | `cap-exceeded` | 406 | 1294.290 | 1324.700 | 30.410 | emitted chunk spans 30.410s, over the 30s cap (segments 406-416); invariant 1 forbids the mid-sentence split that would avoid it |

## Implied boundary-improvement precision (R-AS)

| arm | repaired (defect landed) | regressed (attested-correct moved >5ms) | implied precision |
|---|---|---|---|
| A | 0 | 1 | **0.00%** |
| B | 1 | 326 | **0.31%** |
| C | 1 | 279 | **0.36%** |
| D | 1 | 363 | **0.27%** |
| F | 2 | 68 | **2.86%** |
| G | 3 | 2 | **60.00%** |

For scale, all MEASURED: **S1 ≈7%** (rejected 18/18 on ear audit, ruling R-AS), **arm B 0.31%**, **arm C 0.36%**, **arm D 0.27%** on v6.

## The pre-registered gate, adjudicated

Arm G is DIAGNOSTIC ONLY, so the SUCCESS BAR and SHIP CAP are **not applied to it** — that was
fixed in Step 1 (`ARM_G_SHIP_GATE_APPLIES = false`). Its hard-fail rows are still
reported, because a ceiling arm reproducing a known-bad value would mean the harness is broken.

| condition | bar | arm F | verdict | arm G | verdict |
|---|---|---|---|---|---|
| HARD FAIL 1 — attested-correct moved >50ms | 0 | **67** | **FAIL** | **0** | PASS |
| HARD FAIL 2 — known-bad reproduced | 0 | **0** | PASS | **0** | PASS |
| SUCCESS BAR — open defects landed | >= 3 of 3 | **2** | **FAIL** | **3** | n/a (not applied) |
| SHIP CAP — implied precision | >= 50% | **2.86%** | **FAIL** | **60.00%** | n/a (not applied) |

**GATE VERDICT, ARM F: FAIL.** Arm G is not gated.

| statement | threshold | arm F | verdict |
|---|---|---|---|
| worse than arm C | > 279 | 68 | not worse than arm C |
| worse than production | > 1 | 68 | **WORSE THAN PRODUCTION** |
| materially better than arm C | <= 139 | 68 | **MATERIALLY BETTER — S2 family continues** |

## Predictions versus outcomes

### Arm F

| quantity | point | band | MEASURED | verdict |
|---|---|---|---|---|
| chunkCount | 57 | [52, 58] | 57 | HELD |
| medianWidthSec | 25 | [18, 32] | 25.58 | HELD |
| peakAbsMeanDecileSec | 4 | [1, 9] | 3.2494 | HELD |
| peakDecileIndex | 5 | [3, 7] | 4 | NOT SCORED (registered as conditional on amplitude >= 5.0s) |
| finalDecileSec | 0.15 | [-0.35, 0.65] | 0.0839 | HELD |
| regressed | 200 | [120, 300] | 68 | MISSED |
| wallClockSec | 650 | [520, 800] | 795.75 | HELD |
| peakRssMB | 3100 | [2400, 3800] | 3084.6 | HELD |
| estimateTrackingR | 0.6 | [-0.3, 0.9] | 0.5271 | HELD |

### Arm G

| quantity | point | band | MEASURED | verdict |
|---|---|---|---|---|
| chunkCount | 57 | [50, 58] | 57 | HELD |
| medianWidthSec | 24.2 | [19, 30] | 25.96 | HELD |
| peakAbsMeanDecileSec | 1.5 | [0, 5] | 0.0423 | HELD |
| peakDecileIndex | 5 | [0, 9] | 4 | NOT SCORED (registered as conditional on amplitude >= 5.0s) |
| finalDecileSec | 0.15 | [-0.35, 0.65] | 0.0316 | HELD |
| regressed | 170 | [90, 290] | 2 | MISSED |
| wallClockSec | 650 | [520, 800] | 920.45 | MISSED |
| peakRssMB | 3100 | [2400, 3800] | 2117 | MISSED |
| estimateTrackingR | 0.3 | [-0.5, 0.85] | -0.0169 | HELD |

## The named falsifiers

**Arm F.** _Arm F's peak |mean decile Δ| at a value >= 14.0s — the SURVIVED band — while at least two thirds of its internal chunk edges are placed at three-source-agreement anchors by script-word index, would refute the claim that estimate-derived chunk-edge placement drives v6's S2 drift arch._

- MEASURED peak: 3.249s (fires at >= 14s).
- MEASURED substitution: 42 of 56 internal edges = **75.0%** (precondition >= 66.7%); 89.4% of the 47 substitutable ones. Derived from arm F's own emitted edge census `{"anchor":42,"excision-run-edge":9,"detected-silence":5,"corpus-end":1}`, not transcribed.
- **DID IT FIRE? NO.**

**Arm G.** _Arm G's peak |mean decile Δ| at a value >= 14.0s — the SURVIVED band — while every internal chunk edge sits at an attested oracle boundary time, would refute the claim that chunk-edge accuracy is the mechanism, and would exonerate the chunk plan entirely: no chunk-plan-based fix could then do better than a ceiling that already fails._

- MEASURED peak: 0.042s (fires at >= 14s).
- MEASURED substitution: 47 of 47 substitutable edges = **100.0%** (precondition 100.0%); 83.9% of all 56 internal edges. Derived from arm G's own emitted edge census `{"attested":47,"excision-run-edge":9,"corpus-end":1}`, not transcribed.
- **DID IT FIRE? NO.**

## Step 6 — adjudication, applying the pre-committed conclusion VERBATIM

| arm | peak abs mean decile Δ | **arch verdict** |
|---|---|---|
| F | 3.249s | **DIED** |
| G | 0.042s | **DIED** |

**Outcome row selected: _arch DIES in F_.**

**CONCLUSION, quoted verbatim from the Step 1 gate's table:**

> chunk-edge placement error is the driver; S2 family is viable with anchor-placed edges; next session extends to 173 under the same gate

