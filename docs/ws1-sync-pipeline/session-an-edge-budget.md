# WS1 Session AN Step 2 — the edge-accuracy budget (MEASURED, v6, no new planner)

Arm F's chunk plan and inspection array recomputed FRESH from `computeFaChunkPlanS2EdgeArm`
(`{kind: 'anchor'}`) at HEAD — not read from a prior session's scratch dump. Arm F's and arm
G's STORED FA alignments are reused per the established convention.

## The attribution rule (imported from the Step 1 gate, fixed before this table was built)

```json
{
  "rule": "nearest of the containing chunk's two bounding edges by segment-index distance; exact edge = that edge; equidistant = governed by two; missing edge(s) = governed by the other, or by none if neither exists",
  "onEquidistant": "reported as \"governed by two\", not resolved by a tiebreak",
  "onNoEdge": "reported as \"governed by no edge\", not dropped from the table"
}
```

Applied to all 67 of arm F's beyond-±50ms residual boundaries: 0 governed by no edge, 1 governed by two (equidistant), 66 governed by exactly one.

## Correlation: |governing edge error| vs |boundary error|

| quantity | value |
|---|---|
| n (boundaries with an attributable edge) | 67 |
| Pearson r | **0.8757** |
| falsifier fires (r < 0.5)? | no |

| distribution | n | min | p25 | median | p75 | max |
|---|---|---|---|---|---|---|
| \|edge error\| (ms) | 67 | 130 | 1930 | **4740** | 13135 | 25570 |
| \|boundary error\| (ms) | 67 | 240 | 1830 | **4170** | 10262 | 25420 |

## The 67-residual attribution table

| tag | seg | boundary Δ (ms) | governed by | edge Δ (ms) | fallback-seam governed? |
|---|---|---|---|---|---|
| 052_rear_guards | 51 | 1280 | start-edge | 1510 | no |
| 092_moving_with_korik | 91 | -470 | end-edge | -4740 | no |
| 093_korik_scout | 92 | -1680 | end-edge | -4740 | no |
| 094_scouts_ahead | 93 | -2870 | end-edge | -4740 | no |
| 095_reading_ground | 94 | -5000 | start-edge | -4740 | no |
| 099_sudden_stop | 98 | -2740 | end-edge | -7340 | YES |
| 100_korik_stops | 99 | -5120 | end-edge | -7340 | YES |
| 101_shared_realization | 100 | -6750 | end-edge | -7340 | YES |
| 102_frozen_scouts | 101 | -7690 | start-edge | -7340 | YES |
| 134_exhausted_sleep | 133 | -240 | end-edge | -2610 | no |
| 135_three_hours | 134 | -860 | end-edge | -2610 | no |
| 136_nightly_rotation | 135 | -2620 | start-edge | -2610 | no |
| 165_talking_out_trust | 164 | -1040 | start-edge | -1020 | no |
| 166_dire_wolf_perimeter | 165 | -3930 | start-edge | -1020 | no |
| 167_smell_of_butchery | 166 | -5720 | start-edge | -1020 | no |
| 168_daret_thrown_stone | 167 | -7060 | start-edge | -1020 | no |
| 169_daret_meets_scout | 168 | -10280 | end-edge | -14940 | YES |
| 170_daret_speaks | 169 | -11400 | end-edge | -14940 | YES |
| 171_scout_carrying_load | 170 | -12460 | end-edge | -14940 | YES |
| 172_body_instinct_grip | 171 | -14140 | end-edge | -14940 | YES |
| 173_broken_track_pattern | 172 | -15490 | start-edge | -14940 | YES |
| 189_heavy_timber | 188 | 2520 | start-edge | 2730 | no |
| 190_yaro_signal | 189 | 310 | start-edge | 2730 | no |
| 200_yaro_shifts | 199 | 3810 | start-edge | 4060 | no |
| 201_stealthy_footstep | 200 | 1280 | start-edge | 4060 | no |
| 202_mirroring_scout | 201 | 1830 | start-edge | 4060 | no |
| 203_backward_retreat | 202 | 550 | start-edge | 4060 | no |
| 225_night_scouts | 224 | -2260 | start-edge | -700 | no |
| 226_four_scouts | 225 | -3991 | start-edge | -700 | no |
| 227_scout_ages | 226 | -5330 | start-edge | -700 | no |
| 228_informal_bond | 227 | -7738 | start-edge | -700 | no |
| 229_no_formal_sense | 228 | -10262 | start-edge | -700 | no |
| 230_slowing_pace | 229 | -12293 | both | 13135 | YES |
| 232_sudden_halt | 231 | -15030 | end-edge | -25570 | YES |
| 233_firelight_speech | 232 | -17147 | end-edge | -25570 | YES |
| 234_focused_attention | 233 | -19365 | end-edge | -25570 | YES |
| 235_unasked_burden | 234 | -22232 | end-edge | -25570 | YES |
| 236_uncertain_start | 235 | -23780 | end-edge | -25570 | YES |
| 237_heavy_weight | 236 | -25420 | start-edge | -25570 | YES |
| 256_korik_stopping_in_dark | 255 | 3720 | start-edge | 4120 | no |
| 257_wordless_confirmation_scent | 256 | 1730 | start-edge | 4120 | no |
| 261_weary_leader | 260 | -450 | end-edge | -1560 | no |
| 262_stern_warning | 261 | -1880 | start-edge | -1560 | no |
| 281_hearth_counsel | 280 | 4840 | start-edge | 5020 | no |
| 282_fen_leading | 281 | 4080 | start-edge | 5020 | no |
| 283_fen_keen_ears | 282 | 2130 | start-edge | 5020 | no |
| 284_fen_modesty | 283 | 480 | start-edge | 5020 | no |
| 290_tragic_aftermath | 289 | -4170 | start-edge | 130 | no |
| 291_eastern_post | 290 | -6366 | start-edge | 130 | no |
| 292_distant_attack | 291 | -7899 | start-edge | 130 | no |
| 293_sitting_brooding | 292 | -10253 | end-edge | -16750 | YES |
| 294_intense_thought | 293 | -11627 | end-edge | -16750 | YES |
| 295_defensive_positioning | 294 | -13586 | end-edge | -16750 | YES |
| 296_orderly_rotations | 295 | -15510 | end-edge | -16750 | YES |
| 297_standard_arrangement | 296 | -16680 | start-edge | -16750 | YES |
| 336_uncertain_mentorship | 335 | -960 | end-edge | -3250 | no |
| 337_mutual_exchange | 336 | -3250 | start-edge | -3250 | no |
| 349_stoic_presence | 348 | -1320 | start-edge | -1530 | no |
| 358_knowledge_face | 357 | 5000 | start-edge | 5240 | no |
| 359_listening_hunters | 358 | 380 | start-edge | 5240 | no |
| 371_listening_scouts | 370 | -1710 | end-edge | -8270 | YES |
| 372_wide_eyed_fear | 371 | -3660 | end-edge | -8270 | YES |
| 373_slow_blade_draw | 372 | -5850 | end-edge | -8270 | YES |
| 374_scout_instinct | 373 | -7030 | end-edge | -8270 | YES |
| 375_group_incomprehension | 374 | -8130 | start-edge | -8270 | YES |
| 390_center_fire | 389 | -2150 | start-edge | -1930 | no |
| 418_eyes_sweep | 417 | 2290 | start-edge | 2540 | no |

**26 of the 67 residual boundaries are governed by one of the 5 fallback seams** (strict nearest-single-edge attribution, this step's own rule) — the set arm H (Step 3) targets. This is the ceiling on what recovering all 5 seams could plausibly fix; it is not a promise that all of them land, since most of these boundaries are ALSO shaped by their chunk's OTHER (already anchor-placed) edge and by FA's own within-chunk distribution.

Note: Step 1's gate registered a LOOSER estimate of 39 ("falls somewhere inside the window a fallback seam bounds"), computed before this table existed. This step's 26 supersedes it — the STRICT nearest-single-governing-edge rule is narrower by construction, since a window-membership test credits a fallback seam for boundaries actually governed by their chunk's OTHER, already-correct edge. 26 is the number the arm-H success bar (Step 1 §3) should be read against.

## The budget curve (INFERRED between two MEASURED endpoints — see Step 1's acceptance rule)

Arm G (0ms, oracle-placed edges): **2 regressed** — a REAL measured arm run, not this proxy.
Arm F (observed max edge error, 25570ms): **67** boundaries beyond ±50ms — this 
step's own denominator, a real measured count.

| tolerance (ms) | edges at-or-below tolerance | regressed-remaining under the stated proxy model |
|---|---|---|
| 0 | 0/56 | 67 |
| 1278.5 | 33/56 | 55 |
| 2557 | 43/56 | 49 |
| 3835.5 | 46/56 | 42 |
| 5114 | 50/56 | 28 |
| 6392.5 | 51/56 | 26 |
| 7671 | 52/56 | 22 |
| 8949.5 | 53/56 | 17 |
| 10228 | 53/56 | 17 |
| 11506.5 | 53/56 | 17 |
| 12785 | 53/56 | 17 |
| 14063.5 | 53/56 | 16 |
| 15342 | 54/56 | 11 |
| 16620.5 | 54/56 | 11 |
| 17899 | 55/56 | 6 |
| 19177.5 | 55/56 | 6 |
| 20456 | 55/56 | 6 |
| 21734.5 | 55/56 | 6 |
| 23013 | 55/56 | 6 |
| 24291.5 | 55/56 | 6 |
| 25570 | 56/56 | 0 |

Ship-bar (regressed <= 1) crossing tolerance: **25570ms**.

Curve shape: 34 of 56 substitutable edges (60.7%) carry at least half of the total |edge error| mass — **NOT STEEP** (above the pre-registered steepness line).

**Reading (per the pre-registered rule): error is spread broadly across many edges — not economically closable by widening or densifying anchors at a handful of seams.**

