# Stage 1 — WS1 Session AG Ear List (S1 collateral)

> **What this is:** the listening bill S1 (the trailing-silence chunk-text fold) incurs.
> Every boundary S1 moved that has **no ear evidence at all**, plus every
> **ear-verified control that moved off its verified value**. Worked THROUGH against the
> audio, not read. Verdict and Class columns are deliberately blank.
>
> **S1 IS NOT SHIPPED.** `foldPhantomTails` defaults to `false`. This sheet is what has to
> be adjudicated before that default flips — the rows below are what would change.
>
> **Not blinded, and deliberately so.** Both the current and the proposed value are named,
> because the question is which of two specific instants is right. Play them A/B:
> `ear-verify-t` measured that two candidates inside one silence can be indistinguishable
> played alone and clearly ordered played side by side.

## Counts — predicted vs actual

| quantity | predicted (Step 1 census) | actual (Step 5 measurement) |
|---|---|---|
| boundaries with no ear evidence | 14 | 17 |
| ear-verified controls in the blast radius | 7 | 2 moved off value |
| **total rows on this sheet** | **21** | **19** |

- **173**: 1 boundaries moved — 0 unaudited, 0 verified controls moved off value, 1 known defect targets (not listed here).
- **v6**: 21 boundaries moved — 17 unaudited, 1 verified controls moved off value, 3 known defect targets (not listed here).
- **spanish**: 1 boundaries moved — 0 unaudited, 1 verified controls moved off value, 0 known defect targets (not listed here).

## How to play a row

```bash
ffplay -autoexit -nodisp -ss <window start> -t <window length> "<audio>"
```

Listen for where the scene should cut. Then fill in **Verdict** (`BEFORE` if the current
value is right and S1 makes it worse / `AFTER` if S1 improves it / `NEITHER`) and **Class**.

## v6 — 18 rows

### Ear-verified controls that MOVED — a verdict of BEFORE on any of these is a regression

| # | scene tag | before | after | delta | listening window | verdict | class |
|---|---|---|---|---|---|---|---|
| 1 | `318_scout_on_ridge` | 969.300 | 969.760 | +0.460 | 966.80–972.26 |  |  |

<details><summary>Play commands and scripted text</summary>

**1. `318_scout_on_ridge`** — before 969.300, after 969.760 (ledger CORRECT value 969.300)

```bash
ffplay -autoexit -nodisp -ss 966.80 -t 5.46 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The fear itself is not the problem.

</details>

### No ear evidence either way

| # | scene tag | before | after | delta | listening window | verdict | class |
|---|---|---|---|---|---|---|---|
| 1 | `023_sleeping_mother_side` | 65.770 | 66.590 | +0.820 | 63.27–69.09 |  |  |
| 2 | `041_elder_lesson` | 122.640 | 123.310 | +0.670 | 120.14–125.81 |  |  |
| 3 | `057_root_trip` | 171.750 | 172.470 | +0.720 | 169.25–174.97 |  |  |
| 4 | `076_feeling_change` | 228.200 | 228.650 | +0.450 | 225.70–231.15 |  |  |
| 5 | `213_pensive_stare` | 626.770 | 627.360 | +0.590 | 624.27–629.86 |  |  |
| 6 | `216_chest_revelation` | 638.380 | 639.250 | +0.870 | 635.88–641.75 |  |  |
| 7 | `273_cold_grass` | 820.310 | 820.600 | +0.290 | 817.81–823.10 |  |  |
| 8 | `293_sitting_brooding` | 881.000 | 881.530 | +0.530 | 878.50–884.03 |  |  |
| 9 | `305_carrying_grief` | 919.180 | 919.730 | +0.550 | 916.68–922.23 |  |  |
| 10 | `325_contrasting_student` | 995.150 | 996.480 | +1.330 | 992.65–998.98 |  |  |
| 11 | `364_the_full_cost` | 1130.760 | 1131.410 | +0.650 | 1128.26–1133.91 |  |  |
| 12 | `367_dropped_torch` | 1137.430 | 1137.930 | +0.500 | 1134.93–1140.43 |  |  |
| 13 | `380_scarred_hands_experience` | 1174.730 | 1175.530 | +0.800 | 1172.23–1178.03 |  |  |
| 14 | `382_honesty_transfer` | 1182.810 | 1183.190 | +0.380 | 1180.31–1185.69 |  |  |
| 15 | `402_cyclical_darkness` | 1271.460 | 1271.790 | +0.330 | 1268.96–1274.29 |  |  |
| 16 | `421_hidden_observer_perspective` | 1335.570 | 1336.030 | +0.460 | 1333.07–1338.53 |  |  |
| 17 | `443_scout_cliff_edge` | 1408.760 | 1409.210 | +0.450 | 1406.26–1411.71 |  |  |

<details><summary>Play commands and scripted text</summary>

**1. `023_sleeping_mother_side`** — before 65.770, after 66.590

```bash
ffplay -autoexit -nodisp -ss 63.27 -t 5.82 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You fall asleep against her side

**2. `041_elder_lesson`** — before 122.640, after 123.310

```bash
ffplay -autoexit -nodisp -ss 120.14 -t 5.67 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> But you are old enough to start learning what it means.

**3. `057_root_trip`** — before 171.750, after 172.470

```bash
ffplay -autoexit -nodisp -ss 169.25 -t 5.72 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You catch a root you did not see and the flame hits the ground and sputters and for three full heartbeats the column loses half its light.

**4. `076_feeling_change`** — before 228.200, after 228.650

```bash
ffplay -autoexit -nodisp -ss 225.70 -t 5.45 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You learn to feel the column change before you see it change.

**5. `213_pensive_stare`** — before 626.770, after 627.360

```bash
ffplay -autoexit -nodisp -ss 624.27 -t 5.59 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You do not know what it decided or why.

**6. `216_chest_revelation`** — before 638.380, after 639.250

```bash
ffplay -autoexit -nodisp -ss 635.88 -t 5.87 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> It does not sit in the same place.

**7. `273_cold_grass`** — before 820.310, after 820.600

```bash
ffplay -autoexit -nodisp -ss 817.81 -t 5.29 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Long crouches in cold grass.

**8. `293_sitting_brooding`** — before 881.000, after 881.530

```bash
ffplay -autoexit -nodisp -ss 878.50 -t 5.53 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You sit with that for a long time.

**9. `305_carrying_grief`** — before 919.180, after 919.730

```bash
ffplay -autoexit -nodisp -ss 916.68 -t 5.55 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You do not put down the grief.

**10. `325_contrasting_student`** — before 995.150, after 996.480

```bash
ffplay -autoexit -nodisp -ss 992.65 -t 6.33 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The other one is nearly the opposite.

**11. `364_the_full_cost`** — before 1130.760, after 1131.410

```bash
ffplay -autoexit -nodisp -ss 1128.26 -t 5.65 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You tell them the full cost

**12. `367_dropped_torch`** — before 1137.430, after 1137.930

```bash
ffplay -autoexit -nodisp -ss 1134.93 -t 5.50 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You tell them about the dropped torch

**13. `380_scarred_hands_experience`** — before 1174.730, after 1175.530

```bash
ffplay -autoexit -nodisp -ss 1172.23 -t 5.80 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The knowledge that comes from actual experience cannot be handed over by talking.

**14. `382_honesty_transfer`** — before 1182.810, after 1183.190

```bash
ffplay -autoexit -nodisp -ss 1180.31 -t 5.38 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> All you can do is be honest and let them take what they are able to carry right now.

**15. `402_cyclical_darkness`** — before 1271.460, after 1271.790

```bash
ffplay -autoexit -nodisp -ss 1268.96 -t 5.33 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> the same as it always has

**16. `421_hidden_observer_perspective`** — before 1335.570, after 1336.030

```bash
ffplay -autoexit -nodisp -ss 1333.07 -t 5.46 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> She does not know you are watching.

**17. `443_scout_cliff_edge`** — before 1408.760, after 1409.210

```bash
ffplay -autoexit -nodisp -ss 1406.26 -t 5.45 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> They will spend a whole life finding out what the night holds.

</details>

## spanish — 1 rows

### Ear-verified controls that MOVED — a verdict of BEFORE on any of these is a regression

| # | scene tag | before | after | delta | listening window | verdict | class |
|---|---|---|---|---|---|---|---|
| 1 | `023_scylla_six_sailors` | 65.120 | 66.730 | +1.610 | 62.62–69.23 |  |  |

<details><summary>Play commands and scripted text</summary>

**1. `023_scylla_six_sailors`** — before 65.120, after 66.730 (ledger CORRECT value 65.120)

```bash
ffplay -autoexit -nodisp -ss 62.62 -t 6.61 "/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish VOiceover.m4a"
```

> Navegar cerca de Scylla cuesta seis marineros.

</details>

