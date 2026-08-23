# Stage 1 — WS1 Session AI Ear List (S2 measurement)

> **What this is:** the listening bill S2 (the sentence-bounded chunk planner,
> `computeFaChunkPlanS2`, measurement arm only — not shipped) incurs. Ordered
> highest-value listening first: (1) the five open defects, (2) any ear-verified
> control that moved, (3) boundaries whose incoming FA confidence changed by more
> than an order of magnitude, (4) the remaining moved-without-evidence set. Worked
> THROUGH against the audio, not read. Verdict and Class columns are deliberately blank.
>
> **S2 IS NOT SHIPPED.** `computeFaChunkPlanS2` has no production caller. This sheet is
> what has to be adjudicated before any ship decision — a decision this session does not
> take.
>
> **Not blinded, and deliberately so** — same discipline as every prior WS1 ear list.

## Open defects that did NOT move under S2 (nothing new to listen to)

(none — every one of the five moved; see the section below)

## How to play a row

```bash
ffplay -autoexit -nodisp -ss <window start> -t <window length> "<audio>"
```

Fill in **Verdict** (`BEFORE` if the current value is right and S2 makes it worse /
`AFTER` if S2 improves it / `NEITHER`) and **Class**.

## v6 — 329 rows

### 1. The five open defects — did S2 move them, and in which direction?

| # | scene tag | before | after | delta | conf before | conf after | listening window | verdict | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `214_solitary_fire` | 629.010 | 607.680 | -21.330 | 2.19e-7 | 2.19e-4 | 605.18–631.51 |  |  |
| 2 | `231_slowing_pace` | 681.630 | 657.350 | -24.280 | 6.97e-3 | 2.26e-5 | 654.85–684.13 |  |  |
| 3 | `447_scout_facing_dark` | 1417.120 | 1418.510 | +1.390 | 2.31e-3 | 1.00e+0 | 1414.62–1421.01 |  |  |

<details><summary>Play commands and scripted text</summary>

**1. `214_solitary_fire`** — before 629.010, after 607.680 (ledger CORRECT value 630.090)

```bash
ffplay -autoexit -nodisp -ss 605.18 -t 26.33 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You only know you are at the fire because whatever it was let you leave.

**2. `231_slowing_pace`** — before 681.630, after 657.350 (ledger CORRECT value 682.740)

```bash
ffplay -autoexit -nodisp -ss 654.85 -t 29.28 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> they slow.

**3. `447_scout_facing_dark`** — before 1417.120, after 1418.510 (ledger CORRECT value 1418.530)

```bash
ffplay -autoexit -nodisp -ss 1414.62 -t 6.39 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Only the ones who learn to face it.

</details>

### 2. Ear-verified controls that MOVED — a verdict of BEFORE on any of these is a regression

| # | scene tag | before | after | delta | conf before | conf after | listening window | verdict | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `039_river_trap` | 114.640 | 111.910 | -2.730 | 2.12e-7 | 1.80e-7 | 109.41–117.14 |  |  |
| 2 | `057_root_trip` | 171.750 | 167.700 | -4.050 | 2.77e-7 | 3.33e-1 | 165.20–174.25 |  |  |
| 3 | `076_feeling_change` | 228.200 | 223.340 | -4.860 | 9.07e-8 | 3.83e-2 | 220.84–230.70 |  |  |
| 4 | `087_throwing_spear_poise` | 259.880 | 252.740 | -7.140 | 4.69e-7 | 1.00e+0 | 250.24–262.38 |  |  |
| 5 | `125_night_circle` | 370.750 | 357.890 | -12.860 | 1.91e-2 | 1.00e+0 | 355.39–373.25 |  |  |
| 6 | `152_frozen_brush_mice` | 451.030 | 435.150 | -15.880 | 1.49e-3 | 1.71e-5 | 432.65–453.53 |  |  |
| 7 | `158_scout_false_alert` | 466.090 | 451.030 | -15.060 | 9.45e-1 | 1.82e-6 | 448.53–468.59 |  |  |
| 8 | `176_twenty_six_scout` | 522.460 | 504.800 | -17.660 | 9.86e-1 | 9.90e-1 | 502.30–524.96 |  |  |
| 9 | `192_scout_listening` | 571.070 | 548.820 | -22.250 | 4.07e-5 | 2.58e-5 | 546.32–573.57 |  |  |
| 10 | `213_pensive_stare` | 626.770 | 604.910 | -21.860 | 6.43e-8 | 9.72e-1 | 602.41–629.27 |  |  |
| 11 | `216_chest_revelation` | 638.380 | 619.310 | -19.070 | 1.00e-6 | 4.71e-4 | 616.81–640.88 |  |  |
| 12 | `221_skill_removes` | 654.450 | 634.570 | -19.880 | 8.08e-6 | 8.13e-6 | 632.07–656.95 |  |  |
| 13 | `222_long_silence` | 659.330 | 638.380 | -20.950 | 1.09e-7 | 1.96e-2 | 635.88–661.83 |  |  |
| 14 | `224_thirty_three` | 664.330 | 644.100 | -20.230 | 1.00e+0 | 2.13e-6 | 641.60–666.83 |  |  |
| 15 | `226_four_scouts` | 671.170 | 648.930 | -22.240 | 9.79e-4 | 4.24e-5 | 646.43–673.67 |  |  |
| 16 | `266_forty_one_burden` | 788.750 | 764.250 | -24.500 | 4.16e-6 | 1.00e+0 | 761.75–791.25 |  |  |
| 17 | `273_cold_grass` | 820.310 | 799.070 | -21.240 | 1.00e+0 | 5.94e-6 | 796.57–822.81 |  |  |
| 18 | `289_winter_predator_breach` | 865.390 | 843.500 | -21.890 | 1.01e-7 | 1.43e-6 | 841.00–867.89 |  |  |
| 19 | `293_sitting_brooding` | 881.000 | 862.680 | -18.320 | 2.62e-8 | 1.21e-4 | 860.18–883.50 |  |  |
| 20 | `305_carrying_grief` | 919.180 | 900.880 | -18.300 | 2.64e-7 | 6.84e-7 | 898.38–921.68 |  |  |
| 21 | `307_forty_nine_years` | 925.430 | 907.560 | -17.870 | 9.51e-1 | 9.76e-1 | 905.06–927.93 |  |  |
| 22 | `308_scouts_leading` | 931.400 | 909.710 | -21.690 | 1.81e-7 | 6.54e-4 | 907.21–933.90 |  |  |
| 23 | `318_scout_on_ridge` | 969.300 | 954.440 | -14.860 | 2.68e-7 | 9.83e-1 | 951.94–971.80 |  |  |
| 24 | `325_contrasting_student` | 995.150 | 983.450 | -11.700 | 9.95e-1 | 3.56e-4 | 980.95–997.65 |  |  |
| 25 | `340_fifty_eight` | 1045.620 | 1032.060 | -13.560 | 1.61e-2 | 9.01e-1 | 1029.56–1048.12 |  |  |
| 26 | `364_the_full_cost` | 1130.760 | 1124.450 | -6.310 | 4.60e-8 | 2.67e-5 | 1121.95–1133.26 |  |  |
| 27 | `367_dropped_torch` | 1137.430 | 1132.840 | -4.590 | 1.55e-7 | 1.00e+0 | 1130.34–1139.93 |  |  |
| 28 | `383_sixty_four` | 1189.050 | 1184.210 | -4.840 | 1.00e+0 | 5.81e-7 | 1181.71–1191.55 |  |  |
| 29 | `443_scout_cliff_edge` | 1408.760 | 1410.590 | +1.830 | 4.12e-7 | 3.74e-7 | 1406.26–1413.09 |  |  |

<details><summary>Play commands and scripted text</summary>

**1. `039_river_trap`** — before 114.640, after 111.910 (ledger CORRECT value 114.640)

```bash
ffplay -autoexit -nodisp -ss 109.41 -t 7.73 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> It is as deliberate as any trap your father sets in the river shallows.

**2. `057_root_trip`** — before 171.750, after 167.700 (ledger CORRECT value 171.750)

```bash
ffplay -autoexit -nodisp -ss 165.20 -t 9.05 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You catch a root you did not see and the flame hits the ground and sputters and for three full heartbeats the column loses half its light.

**3. `076_feeling_change`** — before 228.200, after 223.340 (ledger CORRECT value 228.200)

```bash
ffplay -autoexit -nodisp -ss 220.84 -t 9.86 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You learn to feel the column change before you see it change.

**4. `087_throwing_spear_poise`** — before 259.880, after 252.740 (ledger CORRECT value 259.880)

```bash
ffplay -autoexit -nodisp -ss 250.24 -t 12.14 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> A throwing spear

**5. `125_night_circle`** — before 370.750, after 357.890 (ledger CORRECT value 370.750)

```bash
ffplay -autoexit -nodisp -ss 355.39 -t 17.86 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are twenty and you have your first real position in the night circle.

**6. `152_frozen_brush_mice`** — before 451.030, after 435.150 (ledger CORRECT value 451.030)

```bash
ffplay -autoexit -nodisp -ss 432.65 -t 20.88 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> When the brush mice stop moving through dry leaves

**7. `158_scout_false_alert`** — before 466.090, after 451.030 (ledger CORRECT value 466.090)

```bash
ffplay -autoexit -nodisp -ss 448.53 -t 20.06 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The first time you raise an alert for a branch dropping from a snow-loaded tree.

**8. `176_twenty_six_scout`** — before 522.460, after 504.800 (ledger CORRECT value 522.460)

```bash
ffplay -autoexit -nodisp -ss 502.30 -t 22.66 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are twenty-six.

**9. `192_scout_listening`** — before 571.070, after 548.820 (ledger CORRECT value 571.070)

```bash
ffplay -autoexit -nodisp -ss 546.32 -t 27.25 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You listen.

**10. `213_pensive_stare`** — before 626.770, after 604.910 (ledger CORRECT value 626.770)

```bash
ffplay -autoexit -nodisp -ss 602.41 -t 26.86 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You do not know what it decided or why.

**11. `216_chest_revelation`** — before 638.380, after 619.310 (ledger CORRECT value 638.380)

```bash
ffplay -autoexit -nodisp -ss 616.81 -t 24.07 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> It does not sit in the same place.

**12. `221_skill_removes`** — before 654.450, after 634.570 (ledger CORRECT value 654.450)

```bash
ffplay -autoexit -nodisp -ss 632.07 -t 24.88 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> and in that space lives an element that no amount of skill removes entirely.

**13. `222_long_silence`** — before 659.330, after 638.380 (ledger CORRECT value 659.330)

```bash
ffplay -autoexit -nodisp -ss 635.88 -t 25.95 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You do not say this to anyone for a long time.

**14. `224_thirty_three`** — before 664.330, after 644.100 (ledger CORRECT value 664.330)

```bash
ffplay -autoexit -nodisp -ss 641.60 -t 25.23 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are thirty-three.

**15. `226_four_scouts`** — before 671.170, after 648.930 (ledger CORRECT value 671.180)

```bash
ffplay -autoexit -nodisp -ss 646.43 -t 27.24 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Four of them besides yourself

**16. `266_forty_one_burden`** — before 788.750, after 764.250 (ledger CORRECT value 788.750)

```bash
ffplay -autoexit -nodisp -ss 761.75 -t 29.50 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are forty-one.

**17. `273_cold_grass`** — before 820.310, after 799.070 (ledger CORRECT value 820.310)

```bash
ffplay -autoexit -nodisp -ss 796.57 -t 26.24 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Long crouches in cold grass.

**18. `289_winter_predator_breach`** — before 865.390, after 843.500 (ledger CORRECT value 865.390)

```bash
ffplay -autoexit -nodisp -ss 841.00 -t 26.89 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> A predator gets through the western perimeter on a winter night and kills one of the youngest members of the band before anyone can reach the site.

**19. `293_sitting_brooding`** — before 881.000, after 862.680 (ledger CORRECT value 881.000)

```bash
ffplay -autoexit -nodisp -ss 860.18 -t 23.32 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You sit with that for a long time.

**20. `305_carrying_grief`** — before 919.180, after 900.880 (ledger CORRECT value 919.180)

```bash
ffplay -autoexit -nodisp -ss 898.38 -t 23.30 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You do not put down the grief.

**21. `307_forty_nine_years`** — before 925.430, after 907.560 (ledger CORRECT value 925.430)

```bash
ffplay -autoexit -nodisp -ss 905.06 -t 22.87 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are forty-nine.

**22. `308_scouts_leading`** — before 931.400, after 909.710 (ledger CORRECT value 931.400)

```bash
ffplay -autoexit -nodisp -ss 907.21 -t 26.69 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Three of your old scouts lead their own groups now in different parts of the territory.

**23. `318_scout_on_ridge`** — before 969.300, after 954.440 (ledger CORRECT value 969.300)

```bash
ffplay -autoexit -nodisp -ss 951.94 -t 19.86 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The fear itself is not the problem.

**24. `325_contrasting_student`** — before 995.150, after 983.450 (ledger CORRECT value 995.150)

```bash
ffplay -autoexit -nodisp -ss 980.95 -t 16.70 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The other one is nearly the opposite.

**25. `340_fifty_eight`** — before 1045.620, after 1032.060 (ledger CORRECT value 1045.620)

```bash
ffplay -autoexit -nodisp -ss 1029.56 -t 18.56 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are fifty-eight.

**26. `364_the_full_cost`** — before 1130.760, after 1124.450 (ledger CORRECT value 1130.760)

```bash
ffplay -autoexit -nodisp -ss 1121.95 -t 11.31 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You tell them the full cost

**27. `367_dropped_torch`** — before 1137.430, after 1132.840 (ledger CORRECT value 1137.430)

```bash
ffplay -autoexit -nodisp -ss 1130.34 -t 9.59 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You tell them about the dropped torch

**28. `383_sixty_four`** — before 1189.050, after 1184.210 (ledger CORRECT value 1189.050)

```bash
ffplay -autoexit -nodisp -ss 1181.71 -t 9.84 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are sixty-four.

**29. `443_scout_cliff_edge`** — before 1408.760, after 1410.590 (ledger CORRECT value 1408.760)

```bash
ffplay -autoexit -nodisp -ss 1406.26 -t 6.83 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> They will spend a whole life finding out what the night holds.

</details>

### 3. Incoming FA confidence changed by >1 order of magnitude

| # | scene tag | before | after | delta | conf before | conf after | listening window | verdict | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `010_close_danger` | 27.450 | 27.140 | -0.310 | 1.17e-7 | 1.19e-5 | 24.64–29.95 |  |  |
| 2 | `012_sudden_hush` | 32.300 | 28.890 | -3.410 | 1.00e+0 | 1.76e-6 | 26.39–34.80 |  |  |
| 3 | `013_silent_prehistoric_night` | 34.320 | 29.640 | -4.680 | 9.65e-7 | 1.00e+0 | 27.14–36.82 |  |  |
| 4 | `021_heavy_flint_spear` | 59.750 | 56.560 | -3.190 | 1.00e+0 | 9.52e-8 | 54.06–62.25 |  |  |
| 5 | `022_fire_boundary_void` | 61.110 | 57.090 | -4.020 | 3.01e-7 | 9.96e-1 | 54.59–63.61 |  |  |
| 6 | `030_watching_older_hunters` | 87.230 | 80.740 | -6.490 | 9.08e-1 | 5.64e-7 | 78.24–89.73 |  |  |
| 7 | `031_sunset_gaze` | 90.140 | 83.530 | -6.610 | 9.01e-1 | 3.65e-4 | 81.03–92.64 |  |  |
| 8 | `037_inner_circle` | 108.550 | 108.050 | -0.500 | 2.05e-7 | 1.70e-5 | 105.55–111.05 |  |  |
| 9 | `046_sinew_binding` | 138.910 | 138.640 | -0.270 | 1.00e+0 | 1.60e-5 | 136.14–141.41 |  |  |
| 10 | `047_proper_hold` | 140.170 | 138.910 | -1.260 | 1.00e+0 | 1.78e-6 | 136.41–142.67 |  |  |
| 11 | `048_flickering_wind` | 142.850 | 140.170 | -2.680 | 9.98e-1 | 8.18e-3 | 137.67–145.35 |  |  |
| 12 | `050_hunters_ahead` | 149.120 | 142.850 | -6.270 | 1.00e+0 | 7.63e-8 | 140.35–151.62 |  |  |
| 13 | `051_center_column` | 151.190 | 143.350 | -7.840 | 9.99e-1 | 1.22e-6 | 140.85–153.69 |  |  |
| 14 | `052_rear_guards` | 154.590 | 146.380 | -8.210 | 9.92e-1 | 2.43e-4 | 143.88–157.09 |  |  |
| 15 | `053_silent_men` | 162.050 | 154.590 | -7.460 | 8.60e-4 | 3.25e-5 | 152.09–164.55 |  |  |
| 16 | `054_silent_tool` | 164.420 | 156.880 | -7.540 | 9.94e-1 | 1.07e-4 | 154.38–166.92 |  |  |
| 17 | `055_spear_comparison` | 166.050 | 158.270 | -7.780 | 9.98e-1 | 4.00e-5 | 155.77–168.55 |  |  |
| 18 | `061_elder_touch` | 187.760 | 187.110 | -0.650 | 8.73e-1 | 8.22e-6 | 184.61–190.26 |  |  |
| 19 | `062_firm_grip` | 189.270 | 187.410 | -1.860 | 9.98e-1 | 1.60e-6 | 184.91–191.77 |  |  |
| 20 | `063_scout_silhouette` | 190.560 | 187.760 | -2.800 | 9.93e-1 | 2.97e-7 | 185.26–193.06 |  |  |
| 21 | `064_lighting_torch` | 192.050 | 189.270 | -2.780 | 1.65e-7 | 2.42e-6 | 186.77–194.55 |  |  |
| 22 | `065_elder_leaves` | 197.010 | 190.560 | -6.450 | 9.78e-1 | 1.48e-6 | 188.06–199.51 |  |  |
| 23 | `074_erratic_wind` | 220.690 | 219.910 | -0.780 | 9.47e-1 | 6.54e-5 | 217.41–223.19 |  |  |
| 24 | `075_rhythmic_movement` | 223.340 | 220.690 | -2.650 | 9.95e-1 | 1.78e-6 | 218.19–225.84 |  |  |
| 25 | `085_the_spear_bearer` | 250.810 | 249.770 | -1.040 | 9.99e-1 | 5.86e-7 | 247.27–253.31 |  |  |
| 26 | `086_spear_contrast` | 256.740 | 250.810 | -5.930 | 1.00e+0 | 1.09e-7 | 248.31–259.24 |  |  |
| 27 | `090_tethered_distance` | 271.110 | 270.750 | -0.360 | 1.00e+0 | 2.98e-6 | 268.25–273.61 |  |  |
| 28 | `092_moving_with_korik` | 274.090 | 271.810 | -2.280 | 1.00e+0 | 2.35e-7 | 269.31–276.59 |  |  |
| 29 | `093_korik_scout` | 275.770 | 272.540 | -3.230 | 9.92e-1 | 7.30e-6 | 270.04–278.27 |  |  |
| 30 | `094_scouts_ahead` | 278.640 | 274.090 | -4.550 | 7.08e-7 | 6.03e-5 | 271.59–281.14 |  |  |
| 31 | `095_reading_ground` | 283.640 | 275.770 | -7.870 | 9.64e-1 | 2.90e-5 | 273.27–286.14 |  |  |
| 32 | `101_shared_realization` | 304.700 | 304.380 | -0.320 | 1.00e+0 | 1.35e-5 | 301.88–307.20 |  |  |
| 33 | `102_frozen_scouts` | 306.430 | 304.700 | -1.730 | 1.00e+0 | 2.82e-6 | 302.20–308.93 |  |  |
| 34 | `103_held_breath` | 309.540 | 306.430 | -3.110 | 1.00e+0 | 2.36e-6 | 303.93–312.04 |  |  |
| 35 | `104_silent_retreat` | 313.240 | 308.470 | -4.770 | 6.41e-8 | 2.13e-4 | 305.97–315.74 |  |  |
| 36 | `105_careful_steps` | 316.620 | 309.540 | -7.080 | 1.00e+0 | 5.78e-4 | 307.04–319.12 |  |  |
| 37 | `110_long_stare` | 334.240 | 331.570 | -2.670 | 1.00e+0 | 2.65e-7 | 329.07–336.74 |  |  |
| 38 | `111_scout_returning_camp` | 336.190 | 332.230 | -3.960 | 4.29e-8 | 4.31e-5 | 329.73–338.69 |  |  |
| 39 | `112_scout_reporting_mission` | 338.440 | 332.910 | -5.530 | 1.33e-7 | 1.04e-5 | 330.41–340.94 |  |  |
| 40 | `113_scout_hiding_shadows` | 340.220 | 333.270 | -6.950 | 9.43e-1 | 3.49e-7 | 330.77–342.72 |  |  |
| 41 | `114_scout_restrained_grip` | 341.850 | 333.550 | -8.300 | 9.56e-5 | 5.82e-7 | 331.05–344.35 |  |  |
| 42 | `115_scout_observing_turning` | 343.600 | 334.240 | -9.360 | 1.00e+0 | 9.35e-7 | 331.74–346.10 |  |  |
| 43 | `116_scout_missed_threat` | 346.680 | 334.570 | -12.110 | 1.00e+0 | 8.46e-7 | 332.07–349.18 |  |  |
| 44 | `117_scout_imagined_monster` | 349.680 | 336.190 | -13.490 | 9.26e-8 | 1.03e-5 | 333.69–352.18 |  |  |
| 45 | `118_scout_delivering_truth` | 353.430 | 340.220 | -13.210 | 5.83e-8 | 1.76e-5 | 337.72–355.93 |  |  |
| 46 | `119_scout_inner_tremble` | 357.890 | 345.850 | -12.040 | 1.61e-8 | 3.68e-7 | 343.35–360.39 |  |  |
| 47 | `120_scout_steady_voice` | 360.230 | 346.680 | -13.550 | 9.87e-1 | 1.02e-5 | 344.18–362.73 |  |  |
| 48 | `121_still_hands` | 362.190 | 349.680 | -12.510 | 1.00e+0 | 4.30e-4 | 347.18–364.69 |  |  |
| 49 | `122_daret_watching` | 364.030 | 352.270 | -11.760 | 8.05e-1 | 7.20e-4 | 349.77–366.53 |  |  |
| 50 | `123_catching_gaze` | 366.830 | 354.590 | -12.240 | 3.54e-7 | 5.14e-6 | 352.09–369.33 |  |  |
| 51 | `124_working_hands` | 368.450 | 355.810 | -12.640 | 1.00e+0 | 3.90e-5 | 353.31–370.95 |  |  |
| 52 | `126_eastern_post` | 378.900 | 362.190 | -16.710 | 2.91e-7 | 1.19e-5 | 359.69–381.40 |  |  |
| 53 | `127_river_treeline` | 380.600 | 364.030 | -16.570 | 1.00e+0 | 7.33e-6 | 361.53–383.10 |  |  |
| 54 | `129_warmth_and_cold` | 389.390 | 375.500 | -13.890 | 9.96e-1 | 4.44e-2 | 373.00–391.89 |  |  |
| 55 | `131_drifting_guard` | 396.320 | 382.570 | -13.750 | 1.00e+0 | 1.03e-6 | 380.07–398.82 |  |  |
| 56 | `132_guarding_stretch` | 398.200 | 383.740 | -14.460 | 3.22e-8 | 1.00e+0 | 381.24–400.70 |  |  |
| 57 | `133_wake_man` | 399.790 | 385.130 | -14.660 | 1.00e+0 | 4.58e-5 | 382.63–402.29 |  |  |
| 58 | `134_exhausted_sleep` | 401.020 | 386.530 | -14.490 | 1.00e+0 | 9.99e-7 | 384.03–403.52 |  |  |
| 59 | `136_nightly_rotation` | 404.670 | 389.910 | -14.760 | 9.63e-1 | 5.47e-2 | 387.41–407.17 |  |  |
| 60 | `137_harsh_weather` | 406.650 | 391.730 | -14.920 | 1.00e+0 | 2.04e-3 | 389.23–409.15 |  |  |
| 61 | `138_cracking_ice` | 407.810 | 394.110 | -13.700 | 9.99e-1 | 1.64e-5 | 391.61–410.31 |  |  |
| 62 | `139_restless_tribe` | 412.510 | 399.110 | -13.400 | 1.00e+0 | 1.12e-5 | 396.61–415.01 |  |  |
| 63 | `140_sudden_alertness` | 416.130 | 404.670 | -11.460 | 1.79e-7 | 3.85e-4 | 402.17–418.63 |  |  |
| 64 | `141_night_listening` | 421.100 | 408.670 | -12.430 | 3.92e-7 | 9.62e-1 | 406.17–423.60 |  |  |
| 65 | `142_noisy_void` | 423.230 | 409.630 | -13.600 | 9.99e-1 | 3.55e-3 | 407.13–425.73 |  |  |
| 66 | `143_meaningless_noises` | 425.170 | 410.990 | -14.180 | 1.00e+0 | 6.04e-5 | 408.49–427.67 |  |  |
| 67 | `144_howling_wind` | 427.670 | 412.510 | -15.160 | 1.00e+0 | 2.42e-5 | 410.01–430.17 |  |  |
| 68 | `145_scurrying_creature` | 429.080 | 413.130 | -15.950 | 9.95e-1 | 5.25e-6 | 410.63–431.58 |  |  |
| 69 | `146_fire_settling` | 430.930 | 414.060 | -16.870 | 8.09e-1 | 6.48e-6 | 411.56–433.43 |  |  |
| 70 | `147_frozen_branches` | 432.640 | 416.130 | -16.510 | 6.91e-7 | 1.01e-3 | 413.63–435.14 |  |  |
| 71 | `148_breathing_clan` | 435.150 | 418.210 | -16.940 | 1.00e+0 | 4.31e-5 | 415.71–437.65 |  |  |
| 72 | `149_month_rotation` | 437.220 | 421.100 | -16.120 | 1.66e-8 | 4.86e-6 | 418.60–439.72 |  |  |
| 73 | `150_listening_intent` | 445.140 | 430.930 | -14.210 | 1.19e-7 | 4.37e-6 | 428.43–447.64 |  |  |
| 74 | `151_scout_listening_void` | 448.020 | 433.230 | -14.790 | 3.25e-5 | 8.44e-7 | 430.73–450.52 |  |  |
| 75 | `153_something_stopped_them` | 454.330 | 438.350 | -15.980 | 9.83e-1 | 1.52e-3 | 435.85–456.83 |  |  |
| 76 | `154_silent_night_birds` | 455.860 | 439.480 | -16.380 | 9.71e-1 | 4.25e-6 | 436.98–458.36 |  |  |
| 77 | `155_predator_passing_under` | 457.810 | 440.950 | -16.860 | 9.98e-1 | 1.29e-4 | 438.45–460.31 |  |  |
| 78 | `156_scout_deep_realization` | 459.870 | 442.270 | -17.600 | 2.08e-6 | 3.68e-2 | 439.77–462.37 |  |  |
| 79 | `157_scout_nervous_reflection` | 463.370 | 445.140 | -18.230 | 1.24e-7 | 8.12e-1 | 442.64–465.87 |  |  |
| 80 | `159_camp_standing_alert` | 470.880 | 455.240 | -15.640 | 1.01e-6 | 8.96e-1 | 452.74–473.38 |  |  |
| 81 | `160_camp_forgiveness` | 474.490 | 459.870 | -14.620 | 9.30e-1 | 3.51e-6 | 457.37–476.99 |  |  |
| 82 | `162_false_alarm_burn` | 479.300 | 463.990 | -15.310 | 9.35e-1 | 1.79e-6 | 461.49–481.80 |  |  |
| 83 | `163_not_carrying_feeling` | 481.560 | 466.090 | -15.470 | 9.99e-1 | 2.59e-6 | 463.59–484.06 |  |  |
| 84 | `164_waiting_too_long` | 484.330 | 469.420 | -14.910 | 1.22e-6 | 7.97e-5 | 466.92–486.83 |  |  |
| 85 | `165_talking_out_trust` | 486.980 | 470.880 | -16.100 | 9.37e-1 | 1.20e-6 | 468.38–489.48 |  |  |
| 86 | `166_dire_wolf_perimeter` | 490.910 | 476.740 | -14.170 | 4.06e-1 | 2.87e-5 | 474.24–493.41 |  |  |
| 87 | `167_smell_of_butchery` | 494.770 | 481.560 | -13.210 | 2.34e-6 | 3.15e-5 | 479.06–497.27 |  |  |
| 88 | `168_daret_thrown_stone` | 497.970 | 484.330 | -13.640 | 1.01e-7 | 1.99e-5 | 481.83–500.47 |  |  |
| 89 | `169_daret_meets_scout` | 503.530 | 488.410 | -15.120 | 1.00e+0 | 1.19e-5 | 485.91–506.03 |  |  |
| 90 | `170_daret_speaks` | 506.170 | 490.910 | -15.260 | 7.53e-7 | 9.65e-1 | 488.41–508.67 |  |  |
| 91 | `171_scout_carrying_load` | 507.970 | 493.890 | -14.080 | 1.18e-7 | 8.39e-6 | 491.39–510.47 |  |  |
| 92 | `173_broken_track_pattern` | 513.460 | 497.970 | -15.490 | 9.98e-1 | 1.72e-3 | 495.47–515.96 |  |  |
| 93 | `174_enough_standing_tall` | 516.760 | 501.000 | -15.760 | 9.85e-1 | 3.18e-3 | 498.50–519.26 |  |  |
| 94 | `175_stepping_into_void` | 518.400 | 503.530 | -14.870 | 8.90e-1 | 2.01e-2 | 501.03–520.90 |  |  |
| 95 | `177_leading_in_darkness` | 528.030 | 507.970 | -20.060 | 9.97e-1 | 3.64e-5 | 505.47–530.53 |  |  |
| 96 | `178_fear_running_alongside` | 531.480 | 509.700 | -21.780 | 7.18e-7 | 1.00e+0 | 507.20–533.98 |  |  |
| 97 | `179_not_in_charge` | 533.370 | 511.980 | -21.390 | 9.98e-1 | 2.52e-5 | 509.48–535.87 |  |  |
| 98 | `180_late_autumn_transformation` | 535.660 | 513.460 | -22.200 | 1.29e-6 | 7.94e-2 | 510.96–538.16 |  |  |
| 99 | `183_chasing_hunters` | 547.610 | 528.030 | -19.580 | 1.00e+0 | 3.28e-3 | 525.53–550.11 |  |  |
| 100 | `185_yaro_running` | 552.080 | 530.740 | -21.340 | 9.86e-1 | 6.69e-7 | 528.24–554.58 |  |  |
| 101 | `186_yaro_age` | 554.170 | 531.480 | -22.690 | 1.00e+0 | 4.06e-4 | 528.98–556.67 |  |  |
| 102 | `187_composed_yaro` | 555.560 | 533.370 | -22.190 | 1.38e-7 | 3.88e-5 | 530.87–558.06 |  |  |
| 103 | `190_yaro_signal` | 567.050 | 546.230 | -20.820 | 9.97e-1 | 8.63e-7 | 543.73–569.55 |  |  |
| 104 | `191_both_still` | 569.150 | 547.610 | -21.540 | 1.55e-7 | 8.85e-2 | 545.11–571.65 |  |  |
| 105 | `193_low_ground` | 572.240 | 549.910 | -22.330 | 9.73e-1 | 1.33e-4 | 547.41–574.74 |  |  |
| 106 | `194_breathing_tension` | 577.270 | 555.560 | -21.710 | 5.51e-7 | 3.65e-5 | 553.06–579.77 |  |  |
| 107 | `195_unseen_woods` | 580.160 | 559.040 | -21.120 | 1.00e+0 | 3.87e-7 | 556.54–582.66 |  |  |
| 108 | `197_yaro_still` | 583.700 | 562.210 | -21.490 | 9.51e-1 | 3.40e-5 | 559.71–586.20 |  |  |
| 109 | `198_stopped_breathing` | 585.890 | 562.870 | -23.020 | 1.60e-6 | 6.28e-4 | 560.37–588.39 |  |  |
| 110 | `199_three_seconds` | 587.800 | 563.560 | -24.240 | 1.00e+0 | 2.65e-5 | 561.06–590.30 |  |  |
| 111 | `201_stealthy_footstep` | 592.070 | 565.260 | -26.810 | 1.00e+0 | 2.82e-6 | 562.76–594.57 |  |  |
| 112 | `202_mirroring_scout` | 593.350 | 565.850 | -27.500 | 1.00e+0 | 3.44e-6 | 563.35–595.85 |  |  |
| 113 | `203_backward_retreat` | 595.830 | 569.150 | -26.680 | 9.90e-1 | 1.87e-3 | 566.65–598.33 |  |  |
| 114 | `204_meadow_run` | 602.860 | 577.270 | -25.590 | 9.96e-1 | 1.63e-5 | 574.77–605.36 |  |  |
| 115 | `205_instinctual_flight` | 606.180 | 580.620 | -25.560 | 1.99e-7 | 9.95e-1 | 578.12–608.68 |  |  |
| 116 | `206_scouts_sprinting` | 607.680 | 582.220 | -25.460 | 1.00e+0 | 2.23e-4 | 579.72–610.18 |  |  |
| 117 | `207_reporting_to_leader` | 608.770 | 583.700 | -25.070 | 9.70e-1 | 3.10e-5 | 581.20–611.27 |  |  |
| 118 | `209_empty_meadow` | 614.170 | 592.070 | -22.100 | 1.00e+0 | 9.98e-5 | 589.57–616.67 |  |  |
| 119 | `210_ominous_timber` | 615.940 | 593.350 | -22.590 | 4.24e-7 | 2.87e-5 | 590.85–618.44 |  |  |
| 120 | `211_hearth_reflection` | 619.310 | 599.280 | -20.030 | 2.04e-7 | 4.43e-2 | 596.78–621.81 |  |  |
| 121 | `212_watching_eyes` | 623.580 | 601.490 | -22.090 | 9.88e-1 | 5.89e-4 | 598.99–626.08 |  |  |
| 122 | `215_spear_grip` | 634.570 | 614.170 | -20.400 | 8.77e-1 | 6.02e-4 | 611.67–637.07 |  |  |
| 123 | `217_still_silence` | 641.230 | 621.050 | -20.180 | 9.93e-1 | 3.85e-2 | 618.55–643.73 |  |  |
| 124 | `218_upright_posture` | 643.020 | 623.580 | -19.440 | 9.99e-1 | 6.35e-3 | 621.08–645.52 |  |  |
| 125 | `219_starry_void` | 646.220 | 625.180 | -21.040 | 2.90e-8 | 9.58e-1 | 622.68–648.72 |  |  |
| 126 | `220_lethal_gap` | 650.620 | 629.010 | -21.610 | 9.56e-1 | 3.25e-5 | 626.51–653.12 |  |  |
| 127 | `223_carrying_weight` | 662.550 | 643.020 | -19.530 | 9.27e-1 | 1.59e-4 | 640.52–665.05 |  |  |
| 128 | `225_night_scouts` | 669.060 | 646.220 | -22.840 | 7.00e-8 | 9.97e-1 | 643.72–671.56 |  |  |
| 129 | `227_scout_ages` | 672.800 | 650.620 | -22.180 | 9.99e-1 | 4.69e-6 | 648.12–675.30 |  |  |
| 130 | `228_informal_bond` | 675.550 | 652.250 | -23.300 | 3.36e-6 | 3.40e-5 | 649.75–678.05 |  |  |
| 131 | `229_no_formal_sense` | 678.580 | 654.450 | -24.130 | 9.47e-1 | 1.72e-3 | 651.95–681.08 |  |  |
| 132 | `230_slowing_pace` | 680.990 | 656.510 | -24.480 | 5.03e-8 | 1.68e-5 | 654.01–683.49 |  |  |
| 133 | `232_sudden_halt` | 684.090 | 657.900 | -26.190 | 3.58e-4 | 7.10e-6 | 655.40–686.59 |  |  |
| 134 | `233_firelight_speech` | 686.540 | 659.330 | -27.210 | 2.21e-4 | 3.06e-6 | 656.83–689.04 |  |  |
| 135 | `234_focused_attention` | 689.390 | 664.330 | -25.060 | 9.41e-1 | 7.81e-5 | 661.83–691.89 |  |  |
| 136 | `235_unasked_burden` | 692.890 | 667.470 | -25.420 | 9.99e-1 | 1.24e-5 | 664.97–695.39 |  |  |
| 137 | `236_uncertain_start` | 694.950 | 669.060 | -25.890 | 9.99e-1 | 1.07e-4 | 666.56–697.45 |  |  |
| 138 | `238_youthful_fear` | 701.290 | 675.550 | -25.740 | 1.00e+0 | 7.65e-5 | 673.05–703.79 |  |  |
| 139 | `239_internal_burden` | 703.510 | 678.580 | -24.930 | 9.97e-1 | 1.40e-2 | 676.08–706.01 |  |  |
| 140 | `240_tribal_survival` | 705.360 | 679.960 | -25.400 | 9.96e-1 | 4.13e-7 | 677.46–707.86 |  |  |
| 141 | `242_fen_excited_run` | 710.110 | 684.090 | -26.020 | 9.00e-1 | 1.93e-6 | 681.59–712.61 |  |  |
| 142 | `243_fen_too_quick` | 714.450 | 689.390 | -25.060 | 9.99e-1 | 1.33e-2 | 686.89–716.95 |  |  |
| 143 | `244_elder_watching_fen` | 716.350 | 692.890 | -23.460 | 1.00e+0 | 6.67e-5 | 690.39–718.85 |  |  |
| 144 | `245_seasonal_contrast` | 719.910 | 694.950 | -24.960 | 1.30e-7 | 9.96e-1 | 692.45–722.41 |  |  |
| 145 | `246_elder_speaks_plainly` | 721.930 | 697.050 | -24.880 | 6.80e-7 | 4.70e-2 | 694.55–724.43 |  |  |
| 146 | `247_danger_lesson` | 724.960 | 701.290 | -23.670 | 1.00e+0 | 1.52e-5 | 698.79–727.46 |  |  |
| 147 | `249_fast_after_decision` | 731.020 | 705.360 | -25.660 | 8.56e-1 | 3.59e-4 | 702.86–733.52 |  |  |
| 148 | `250_before_the_moment` | 734.660 | 707.190 | -27.470 | 1.00e+0 | 1.80e-3 | 704.69–737.16 |  |  |
| 149 | `251_main_focused_observation` | 735.910 | 708.950 | -26.960 | 1.00e+0 | 9.75e-4 | 706.45–738.41 |  |  |
| 150 | `252_fen_slowing_run` | 738.120 | 712.370 | -25.750 | 9.30e-1 | 1.12e-5 | 709.87–740.62 |  |  |
| 151 | `253_fen_measured_movement` | 740.020 | 714.450 | -25.570 | 1.00e+0 | 1.90e-6 | 711.95–742.52 |  |  |
| 152 | `254_main_observing_fen` | 741.440 | 716.350 | -25.090 | 9.81e-1 | 2.44e-6 | 713.85–743.94 |  |  |
| 153 | `255_daret_hand_on_shoulder` | 743.130 | 719.910 | -23.220 | 1.54e-1 | 5.11e-5 | 717.41–745.63 |  |  |
| 154 | `256_korik_stopping_in_dark` | 747.380 | 721.930 | -25.450 | 9.99e-1 | 6.12e-6 | 719.43–749.88 |  |  |
| 155 | `258_main_contemplative_ridge` | 755.140 | 732.880 | -22.260 | 7.27e-7 | 9.72e-1 | 730.38–757.64 |  |  |
| 156 | `259_mentors_around_hearth` | 759.530 | 735.910 | -23.620 | 8.37e-8 | 4.85e-2 | 733.41–762.03 |  |  |
| 157 | `261_weary_leader` | 768.720 | 745.350 | -23.370 | 1.20e-7 | 3.14e-2 | 742.85–771.22 |  |  |
| 158 | `262_stern_warning` | 770.600 | 747.380 | -23.220 | 6.01e-1 | 2.00e-3 | 744.88–773.10 |  |  |
| 159 | `263_temporary_dawn` | 779.220 | 757.270 | -21.950 | 9.99e-1 | 5.61e-4 | 754.77–781.72 |  |  |
| 160 | `264_feeding_fire` | 781.980 | 758.230 | -23.750 | 9.98e-1 | 1.84e-6 | 755.73–784.48 |  |  |
| 161 | `265_unending_dark` | 785.580 | 763.320 | -22.260 | 9.51e-1 | 2.20e-5 | 760.82–788.08 |  |  |
| 162 | `267_leader_of_children` | 794.190 | 768.720 | -25.470 | 1.47e-7 | 1.02e-4 | 766.22–796.69 |  |  |
| 163 | `269_gift_of_meat` | 808.530 | 782.500 | -26.030 | 9.89e-1 | 4.04e-5 | 780.00–811.03 |  |  |
| 164 | `270_silent_departure` | 810.510 | 785.580 | -24.930 | 1.00e+0 | 4.13e-5 | 783.08–813.01 |  |  |
| 165 | `271_holding_meat` | 812.750 | 787.080 | -25.670 | 9.78e-7 | 2.27e-5 | 784.58–815.25 |  |  |
| 166 | `274_stillness_ache` | 822.620 | 799.510 | -23.110 | 1.11e-7 | 7.45e-1 | 797.01–825.12 |  |  |
| 167 | `275_morning_knees` | 825.840 | 803.380 | -22.460 | 1.07e-7 | 1.01e-5 | 800.88–828.34 |  |  |
| 168 | `276_not_old` | 830.470 | 807.200 | -23.270 | 3.25e-8 | 9.98e-1 | 804.70–832.97 |  |  |
| 169 | `277_night_body` | 833.100 | 809.550 | -23.550 | 3.70e-8 | 2.51e-4 | 807.05–835.60 |  |  |
| 170 | `278_faster_men` | 838.080 | 816.050 | -22.030 | 9.03e-1 | 2.17e-3 | 813.55–840.58 |  |  |
| 171 | `279_sharper_ears` | 839.980 | 817.960 | -22.020 | 9.86e-1 | 6.59e-5 | 815.46–842.48 |  |  |
| 172 | `280_saying_so` | 842.270 | 820.880 | -21.390 | 1.00e+0 | 4.60e-3 | 818.38–844.77 |  |  |
| 173 | `281_hearth_counsel` | 843.500 | 822.620 | -20.880 | 9.75e-1 | 4.25e-5 | 820.12–846.00 |  |  |
| 174 | `282_fen_leading` | 844.830 | 825.840 | -18.990 | 9.91e-1 | 2.74e-5 | 823.34–847.33 |  |  |
| 175 | `283_fen_keen_ears` | 848.340 | 827.350 | -20.990 | 9.97e-1 | 1.43e-4 | 824.85–850.84 |  |  |
| 176 | `284_fen_modesty` | 851.820 | 830.470 | -21.350 | 1.00e+0 | 1.80e-3 | 827.97–854.32 |  |  |
| 177 | `287_growing_responsibility` | 859.200 | 836.550 | -22.650 | 9.96e-1 | 1.48e-4 | 834.05–861.70 |  |  |
| 178 | `290_tragic_aftermath` | 872.860 | 851.820 | -21.040 | 3.72e-7 | 8.33e-3 | 849.32–875.36 |  |  |
| 179 | `291_eastern_post` | 875.440 | 854.360 | -21.080 | 1.85e-8 | 9.89e-1 | 851.86–877.94 |  |  |
| 180 | `292_distant_attack` | 877.600 | 856.540 | -21.060 | 1.44e-7 | 4.12e-2 | 854.04–880.10 |  |  |
| 181 | `295_defensive_positioning` | 886.110 | 868.690 | -17.420 | 4.23e-5 | 1.92e-6 | 866.19–888.61 |  |  |
| 182 | `298_heavy_burden` | 892.810 | 875.440 | -17.370 | 9.70e-1 | 4.30e-5 | 872.94–895.31 |  |  |
| 183 | `299_realization_moment` | 895.010 | 877.600 | -17.410 | 9.99e-1 | 1.21e-4 | 875.10–897.51 |  |  |
| 184 | `300_night_gap` | 896.530 | 879.240 | -17.290 | 1.00e+0 | 1.18e-4 | 876.74–899.03 |  |  |
| 185 | `301_hearth_reflection` | 905.150 | 888.370 | -16.780 | 9.99e-1 | 8.46e-6 | 885.87–907.65 |  |  |
| 186 | `302_night_sprint` | 911.420 | 895.010 | -16.410 | 9.71e-1 | 3.24e-5 | 892.51–913.92 |  |  |
| 187 | `303_rebuilding_shelter` | 914.510 | 897.260 | -17.250 | 9.82e-1 | 4.20e-5 | 894.76–917.01 |  |  |
| 188 | `304_closing_gap` | 916.070 | 897.570 | -18.500 | 2.44e-7 | 8.72e-1 | 895.07–918.57 |  |  |
| 189 | `306_flint_knapping` | 921.360 | 905.150 | -16.210 | 9.71e-1 | 1.99e-7 | 902.65–923.86 |  |  |
| 190 | `309_wide_river_meeting` | 936.250 | 916.070 | -20.180 | 1.70e-7 | 4.22e-6 | 913.57–938.75 |  |  |
| 191 | `310_scouts_at_fire` | 940.090 | 919.180 | -20.910 | 9.99e-1 | 2.28e-4 | 916.68–942.59 |  |  |
| 192 | `311_quiet_hearth_talk` | 941.980 | 923.680 | -18.300 | 1.00e+0 | 1.41e-2 | 921.18–944.48 |  |  |
| 193 | `312_fen_scouts_introduction` | 950.900 | 933.910 | -16.990 | 2.68e-2 | 1.08e-4 | 931.41–953.40 |  |  |
| 194 | `315_observing_over_time` | 961.530 | 945.570 | -15.960 | 1.77e-8 | 1.22e-6 | 943.07–964.03 |  |  |
| 195 | `316_scout_instinct_fear` | 964.450 | 947.990 | -16.460 | 5.17e-7 | 9.08e-3 | 945.49–966.95 |  |  |
| 196 | `317_sharpening_bone_tool` | 967.300 | 950.900 | -16.400 | 8.32e-7 | 2.13e-5 | 948.40–969.80 |  |  |
| 197 | `319_eye_reflection_awareness` | 971.910 | 955.820 | -16.090 | 9.98e-1 | 1.03e-3 | 953.32–974.41 |  |  |
| 198 | `320_body_warning_signal` | 974.260 | 957.140 | -17.120 | 9.89e-1 | 5.93e-2 | 954.64–976.76 |  |  |
| 199 | `321_hearth_counsel` | 980.170 | 967.300 | -12.870 | 1.42e-6 | 4.87e-3 | 964.80–982.67 |  |  |
| 200 | `322_body_readiness` | 986.880 | 975.530 | -11.350 | 7.09e-7 | 2.95e-4 | 973.03–989.38 |  |  |
| 201 | `323_direct_speech` | 988.810 | 977.620 | -11.190 | 5.58e-8 | 6.10e-6 | 975.12–991.31 |  |  |
| 202 | `324_youth_realization` | 993.100 | 982.260 | -10.840 | 1.00e+0 | 2.03e-6 | 979.76–995.60 |  |  |
| 203 | `326_careless_ease` | 998.150 | 984.690 | -13.460 | 1.00e+0 | 8.09e-4 | 982.19–1000.65 |  |  |
| 204 | `327_perimeter_lesson` | 1005.240 | 993.100 | -12.140 | 3.19e-7 | 7.90e-6 | 990.60–1007.74 |  |  |
| 205 | `328_obvious_sights` | 1011.750 | 1002.240 | -9.510 | 1.03e-7 | 1.86e-3 | 999.74–1014.25 |  |  |
| 206 | `329_patient_silence` | 1014.600 | 1003.840 | -10.760 | 1.00e+0 | 1.82e-5 | 1001.34–1017.10 |  |  |
| 207 | `330_finer_observations` | 1015.920 | 1005.240 | -10.680 | 4.62e-7 | 1.11e-2 | 1002.74–1018.42 |  |  |
| 208 | `331_scent_at_slope` | 1017.820 | 1008.020 | -9.800 | 1.00e+0 | 5.47e-6 | 1005.52–1020.32 |  |  |
| 209 | `332_fading_sound` | 1020.650 | 1008.730 | -11.920 | 1.22e-6 | 7.43e-5 | 1006.23–1023.15 |  |  |
| 210 | `333_passing_knowledge` | 1024.810 | 1011.750 | -13.060 | 9.12e-8 | 5.45e-6 | 1009.25–1027.31 |  |  |
| 211 | `334_internal_noticing` | 1026.500 | 1012.940 | -13.560 | 1.00e+0 | 4.23e-3 | 1010.44–1029.00 |  |  |
| 212 | `335_tracking_skill` | 1028.580 | 1015.920 | -12.660 | 1.00e+0 | 1.99e-3 | 1013.42–1031.08 |  |  |
| 213 | `336_uncertain_mentorship` | 1031.570 | 1017.820 | -13.750 | 2.28e-7 | 2.55e-5 | 1015.32–1034.07 |  |  |
| 214 | `337_mutual_exchange` | 1035.310 | 1021.710 | -13.600 | 1.00e+0 | 6.14e-6 | 1019.21–1037.81 |  |  |
| 215 | `338_final_gift` | 1039.480 | 1026.500 | -12.980 | 9.84e-1 | 4.54e-7 | 1024.00–1041.98 |  |  |
| 216 | `339_night_voyage` | 1041.560 | 1028.580 | -12.980 | 9.83e-1 | 5.74e-6 | 1026.08–1044.06 |  |  |
| 217 | `341_aging_temples` | 1051.650 | 1033.090 | -18.560 | 1.41e-7 | 9.44e-2 | 1030.59–1054.15 |  |  |
| 218 | `342_steady_grip` | 1054.370 | 1035.310 | -19.060 | 2.77e-8 | 9.88e-1 | 1032.81–1056.87 |  |  |
| 219 | `343_shaking_scout` | 1056.420 | 1039.480 | -16.940 | 1.49e-7 | 4.06e-3 | 1036.98–1058.92 |  |  |
| 220 | `344_marked_palms` | 1061.000 | 1043.230 | -17.770 | 1.00e+0 | 1.41e-4 | 1040.73–1063.50 |  |  |
| 221 | `345_palm_scar` | 1064.190 | 1045.620 | -18.570 | 2.15e-6 | 1.60e-2 | 1043.12–1066.69 |  |  |
| 222 | `346_shortened_finger` | 1068.550 | 1054.370 | -14.180 | 9.14e-8 | 2.04e-5 | 1051.87–1071.05 |  |  |
| 223 | `347_thickened_knuckles` | 1073.140 | 1064.190 | -8.950 | 1.00e+0 | 2.15e-2 | 1061.69–1075.64 |  |  |
| 224 | `348_distant_bands` | 1077.740 | 1065.760 | -11.980 | 9.45e-1 | 3.43e-4 | 1063.26–1080.24 |  |  |
| 225 | `349_stoic_presence` | 1079.710 | 1067.130 | -12.580 | 3.38e-7 | 2.27e-4 | 1064.63–1082.21 |  |  |
| 226 | `350_mountain_ridge` | 1082.990 | 1070.080 | -12.910 | 9.95e-1 | 9.57e-4 | 1067.58–1085.49 |  |  |
| 227 | `351_river_crossing` | 1085.580 | 1073.140 | -12.440 | 1.00e+0 | 7.63e-4 | 1070.64–1088.08 |  |  |
| 228 | `354_dark_beast` | 1095.170 | 1081.530 | -13.640 | 9.79e-1 | 1.82e-2 | 1079.03–1097.67 |  |  |
| 229 | `355_reading_tracks` | 1096.610 | 1082.990 | -13.620 | 9.86e-1 | 1.06e-4 | 1080.49–1099.11 |  |  |
| 230 | `356_respectful_glance` | 1101.060 | 1088.360 | -12.700 | 3.07e-6 | 1.35e-4 | 1085.86–1103.56 |  |  |
| 231 | `357_sitting_quietly` | 1103.490 | 1092.150 | -11.340 | 1.00e+0 | 1.34e-4 | 1089.65–1105.99 |  |  |
| 232 | `358_knowledge_face` | 1106.380 | 1095.170 | -11.210 | 9.69e-1 | 3.16e-5 | 1092.67–1108.88 |  |  |
| 233 | `359_listening_hunters` | 1113.570 | 1101.060 | -12.510 | 9.48e-1 | 9.61e-3 | 1098.56–1116.07 |  |  |
| 234 | `360_scout_wisdom` | 1117.080 | 1106.380 | -10.700 | 1.00e+0 | 4.55e-4 | 1103.88–1119.58 |  |  |
| 235 | `361_daret_observation` | 1118.530 | 1111.380 | -7.150 | 9.99e-1 | 2.02e-4 | 1108.88–1121.03 |  |  |
| 236 | `362_survival_proof` | 1121.310 | 1113.020 | -8.290 | 1.00e+0 | 1.24e-3 | 1110.52–1123.81 |  |  |
| 237 | `363_facing_night` | 1124.450 | 1116.180 | -8.270 | 1.72e-7 | 1.00e+0 | 1113.68–1126.95 |  |  |
| 238 | `365_recurrent_storytelling` | 1132.840 | 1126.230 | -6.610 | 1.00e+0 | 1.38e-5 | 1123.73–1135.34 |  |  |
| 239 | `372_wide_eyed_fear` | 1153.710 | 1153.310 | -0.400 | 8.45e-1 | 4.19e-5 | 1150.81–1156.21 |  |  |
| 240 | `373_slow_blade_draw` | 1156.220 | 1153.710 | -2.510 | 1.00e+0 | 3.89e-6 | 1151.21–1158.72 |  |  |
| 241 | `374_scout_instinct` | 1157.930 | 1154.030 | -3.900 | 9.97e-1 | 1.41e-5 | 1151.53–1160.43 |  |  |
| 242 | `375_group_incomprehension` | 1159.890 | 1154.900 | -4.990 | 9.99e-1 | 1.02e-6 | 1152.40–1162.39 |  |  |
| 243 | `376_observing_the_unready` | 1162.490 | 1155.580 | -6.910 | 8.97e-7 | 1.48e-4 | 1153.08–1164.99 |  |  |
| 244 | `377_main_character_memory` | 1164.920 | 1156.220 | -8.700 | 9.97e-1 | 1.17e-4 | 1153.72–1167.42 |  |  |
| 245 | `384_night_scouts` | 1193.770 | 1184.630 | -9.140 | 9.97e-1 | 3.88e-4 | 1182.13–1196.27 |  |  |
| 246 | `385_lost_precision` | 1196.310 | 1185.360 | -10.950 | 1.05e-6 | 1.70e-5 | 1182.86–1198.81 |  |  |
| 247 | `386_quiet_knowing` | 1202.460 | 1193.770 | -8.690 | 1.59e-8 | 2.94e-2 | 1191.27–1204.96 |  |  |
| 248 | `387_handing_spear` | 1205.510 | 1197.820 | -7.690 | 9.99e-1 | 2.28e-5 | 1195.32–1208.01 |  |  |
| 249 | `388_fen_teaching` | 1211.400 | 1202.460 | -8.940 | 1.00e+0 | 8.45e-7 | 1199.96–1213.90 |  |  |
| 250 | `389_unnamed_role` | 1214.970 | 1209.220 | -5.750 | 9.95e-1 | 1.15e-3 | 1206.72–1217.47 |  |  |
| 251 | `407_shadow_movement` | 1294.290 | 1296.420 | +2.130 | 8.34e-8 | 1.23e-2 | 1291.79–1298.92 |  |  |
| 252 | `408_shifting_air` | 1296.420 | 1297.550 | +1.130 | 9.08e-1 | 5.28e-7 | 1293.92–1300.05 |  |  |

<details><summary>Play commands and scripted text</summary>

**1. `010_close_danger`** — before 27.450, after 27.140

```bash
ffplay -autoexit -nodisp -ss 24.64 -t 5.31 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> it is close

**2. `012_sudden_hush`** — before 32.300, after 28.890

```bash
ffplay -autoexit -nodisp -ss 26.39 -t 8.41 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The sound stops.

**3. `013_silent_prehistoric_night`** — before 34.320, after 29.640

```bash
ffplay -autoexit -nodisp -ss 27.14 -t 9.68 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The night goes quiet.

**4. `021_heavy_flint_spear`** — before 59.750, after 56.560

```bash
ffplay -autoexit -nodisp -ss 54.06 -t 8.19 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> It has weight.

**5. `022_fire_boundary_void`** — before 61.110, after 57.090

```bash
ffplay -autoexit -nodisp -ss 54.59 -t 9.02 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The fire is the line between you and whatever lives on the other side of it.

**6. `030_watching_older_hunters`** — before 87.230, after 80.740

```bash
ffplay -autoexit -nodisp -ss 78.24 -t 11.49 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You start watching the older hunters differently.

**7. `031_sunset_gaze`** — before 90.140, after 83.530

```bash
ffplay -autoexit -nodisp -ss 81.03 -t 11.61 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You notice where their eyes go when the sun drops.

**8. `037_inner_circle`** — before 108.550, after 108.050

```bash
ffplay -autoexit -nodisp -ss 105.55 -t 5.50 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Certain men sleep closest to the fire’s edge.

**9. `046_sinew_binding`** — before 138.910, after 138.640

```bash
ffplay -autoexit -nodisp -ss 136.14 -t 5.27 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> bound with sinew

**10. `047_proper_hold`** — before 140.170, after 138.910

```bash
ffplay -autoexit -nodisp -ss 136.41 -t 6.26 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> held in both hands out in front of your body.

**11. `048_flickering_wind`** — before 142.850, after 140.170

```bash
ffplay -autoexit -nodisp -ss 137.67 -t 7.68 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The flame bends in the wind and you curve yourself around it

**12. `050_hunters_ahead`** — before 149.120, after 142.850

```bash
ffplay -autoexit -nodisp -ss 140.35 -t 11.27 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The hunters move ahead.

**13. `051_center_column`** — before 151.190, after 143.350

```bash
ffplay -autoexit -nodisp -ss 140.85 -t 12.84 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You stay in the center column with the women and older children.

**14. `052_rear_guards`** — before 154.590, after 146.380

```bash
ffplay -autoexit -nodisp -ss 143.88 -t 13.21 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Behind you, two of the most experienced men walk the rear with thrusting spears angled outward into the dark.

**15. `053_silent_men`** — before 162.050, after 154.590

```bash
ffplay -autoexit -nodisp -ss 152.09 -t 12.46 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> They do not speak on night marches.

**16. `054_silent_tool`** — before 164.420, after 156.880

```bash
ffplay -autoexit -nodisp -ss 154.38 -t 12.54 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Their silence is a tool

**17. `055_spear_comparison`** — before 166.050, after 158.270

```bash
ffplay -autoexit -nodisp -ss 155.77 -t 12.78 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> same as the spear.

**18. `061_elder_touch`** — before 187.760, after 187.110

```bash
ffplay -autoexit -nodisp -ss 184.61 -t 5.65 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Not hard.

**19. `062_firm_grip`** — before 189.270, after 187.410

```bash
ffplay -autoexit -nodisp -ss 184.91 -t 6.86 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Not gentle.

**20. `063_scout_silhouette`** — before 190.560, after 187.760

```bash
ffplay -autoexit -nodisp -ss 185.26 -t 7.80 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Just there.

**21. `064_lighting_torch`** — before 192.050, after 189.270

```bash
ffplay -autoexit -nodisp -ss 186.77 -t 7.78 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> He holds it until you have the torch burning again from the second carrier’s coals.

**22. `065_elder_leaves`** — before 197.010, after 190.560

```bash
ffplay -autoexit -nodisp -ss 188.06 -t 11.45 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Then he walks back to his post without a word.

**23. `074_erratic_wind`** — before 220.690, after 219.910

```bash
ffplay -autoexit -nodisp -ss 217.41 -t 5.78 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Wind through pine moves without any pattern.

**24. `075_rhythmic_movement`** — before 223.340, after 220.690

```bash
ffplay -autoexit -nodisp -ss 218.19 -t 7.65 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Something large moving through pine has a rhythm even when it is trying to suppress one.

**25. `085_the_spear_bearer`** — before 250.810, after 249.770

```bash
ffplay -autoexit -nodisp -ss 247.27 -t 6.04 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are sixteen and you carry your own spear.

**26. `086_spear_contrast`** — before 256.740, after 250.810

```bash
ffplay -autoexit -nodisp -ss 248.31 -t 10.93 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Not the heavy thrusting spear of the senior hunters.

**27. `090_tethered_distance`** — before 271.110, after 270.750

```bash
ffplay -autoexit -nodisp -ss 268.25 -t 5.36 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Never far.

**28. `092_moving_with_korik`** — before 274.090, after 271.810

```bash
ffplay -autoexit -nodisp -ss 269.31 -t 7.28 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You go with Korik

**29. `093_korik_scout`** — before 275.770, after 272.540

```bash
ffplay -autoexit -nodisp -ss 270.04 -t 8.23 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> twenty-two, who has been scouting for four years.

**30. `094_scouts_ahead`** — before 278.640, after 274.090

```bash
ffplay -autoexit -nodisp -ss 271.59 -t 9.55 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The two of you move ahead of the main group by about the distance a man can shout and be heard.

**31. `095_reading_ground`** — before 283.640, after 275.770

```bash
ffplay -autoexit -nodisp -ss 273.27 -t 12.87 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Your job is to read the ground before everyone else walks onto it.

**32. `101_shared_realization`** — before 304.700, after 304.380

```bash
ffplay -autoexit -nodisp -ss 301.88 -t 5.32 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> He has it too.

**33. `102_frozen_scouts`** — before 306.430, after 304.700

```bash
ffplay -autoexit -nodisp -ss 302.20 -t 6.73 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The two of you stand without moving for a long count

**34. `103_held_breath`** — before 309.540, after 306.430

```bash
ffplay -autoexit -nodisp -ss 303.93 -t 8.11 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> long enough for your own breathing to feel very loud.

**35. `104_silent_retreat`** — before 313.240, after 308.470

```bash
ffplay -autoexit -nodisp -ss 305.97 -t 9.77 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You back out the way water runs in reverse.

**36. `105_careful_steps`** — before 316.620, after 309.540

```bash
ffplay -autoexit -nodisp -ss 307.04 -t 12.08 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Slow, continuous, nothing sudden enough to announce you.

**37. `110_long_stare`** — before 334.240, after 331.570

```bash
ffplay -autoexit -nodisp -ss 329.07 -t 7.67 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You look at it for a long time.

**38. `111_scout_returning_camp`** — before 336.190, after 332.230

```bash
ffplay -autoexit -nodisp -ss 329.73 -t 8.96 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You bring the information back.

**39. `112_scout_reporting_mission`** — before 338.440, after 332.910

```bash
ffplay -autoexit -nodisp -ss 330.41 -t 10.53 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> That is the job.

**40. `113_scout_hiding_shadows`** — before 340.220, after 333.270

```bash
ffplay -autoexit -nodisp -ss 330.77 -t 11.95 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Not to engage.

**41. `114_scout_restrained_grip`** — before 341.850, after 333.550

```bash
ffplay -autoexit -nodisp -ss 331.05 -t 13.30 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Not to prove anything.

**42. `115_scout_observing_turning`** — before 343.600, after 334.240

```bash
ffplay -autoexit -nodisp -ss 331.74 -t 14.36 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> See, register, return.

**43. `116_scout_missed_threat`** — before 346.680, after 334.570

```bash
ffplay -autoexit -nodisp -ss 332.07 -t 17.11 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> A scout who sees too little endangers the band.

**44. `117_scout_imagined_monster`** — before 349.680, after 336.190

```bash
ffplay -autoexit -nodisp -ss 333.69 -t 18.49 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> A scout who imagines too much does the same.

**45. `118_scout_delivering_truth`** — before 353.430, after 340.220

```bash
ffplay -autoexit -nodisp -ss 337.72 -t 18.21 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> What the job requires is exact truth delivered without drama.

**46. `119_scout_inner_tremble`** — before 357.890, after 345.850

```bash
ffplay -autoexit -nodisp -ss 343.35 -t 17.04 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are not yet calm about it.

**47. `120_scout_steady_voice`** — before 360.230, after 346.680

```bash
ffplay -autoexit -nodisp -ss 344.18 -t 18.55 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Your voice holds when you report

**48. `121_still_hands`** — before 362.190, after 349.680

```bash
ffplay -autoexit -nodisp -ss 347.18 -t 17.51 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> but your hands do not.

**49. `122_daret_watching`** — before 364.030, after 352.270

```bash
ffplay -autoexit -nodisp -ss 349.77 -t 16.76 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Daret watches your hands when you speak.

**50. `123_catching_gaze`** — before 366.830, after 354.590

```bash
ffplay -autoexit -nodisp -ss 352.09 -t 17.24 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You see him doing it.

**51. `124_working_hands`** — before 368.450, after 355.810

```bash
ffplay -autoexit -nodisp -ss 353.31 -t 17.64 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You start working on the hands.

**52. `126_eastern_post`** — before 378.900, after 362.190

```bash
ffplay -autoexit -nodisp -ss 359.69 -t 21.71 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The eastern post

**53. `127_river_treeline`** — before 380.600, after 364.030

```bash
ffplay -autoexit -nodisp -ss 361.53 -t 21.57 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> facing the tree line where the river bends out of sight.

**54. `129_warmth_and_cold`** — before 389.390, after 375.500

```bash
ffplay -autoexit -nodisp -ss 373.00 -t 18.89 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The fire’s warmth is on your back and the night’s cold is on your face.

**55. `131_drifting_guard`** — before 396.320, after 382.570

```bash
ffplay -autoexit -nodisp -ss 380.07 -t 18.75 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> It keeps you from drifting.

**56. `132_guarding_stretch`** — before 398.200, after 383.740

```bash
ffplay -autoexit -nodisp -ss 381.24 -t 19.46 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You guard your stretch

**57. `133_wake_man`** — before 399.790, after 385.130

```bash
ffplay -autoexit -nodisp -ss 382.63 -t 19.66 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> wake the next man

**58. `134_exhausted_sleep`** — before 401.020, after 386.530

```bash
ffplay -autoexit -nodisp -ss 384.03 -t 19.49 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> sleep.

**59. `136_nightly_rotation`** — before 404.670, after 389.910

```bash
ffplay -autoexit -nodisp -ss 387.41 -t 19.76 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> This runs every night

**60. `137_harsh_weather`** — before 406.650, after 391.730

```bash
ffplay -autoexit -nodisp -ss 389.23 -t 19.92 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> no matter the weather.

**61. `138_cracking_ice`** — before 407.810, after 394.110

```bash
ffplay -autoexit -nodisp -ss 391.61 -t 18.70 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> On the coldest nights when the river ice cracks and carries those sounds through the valley

**62. `139_restless_tribe`** — before 412.510, after 399.110

```bash
ffplay -autoexit -nodisp -ss 396.61 -t 18.40 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> nobody sleeps deep and nobody sleeps long.

**63. `140_sudden_alertness`** — before 416.130, after 404.670

```bash
ffplay -autoexit -nodisp -ss 402.17 -t 16.46 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The body does not wait for the mind to decide if a sound is worth waking for.

**64. `141_night_listening`** — before 421.100, after 408.670

```bash
ffplay -autoexit -nodisp -ss 406.17 -t 17.43 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Night is not quiet.

**65. `142_noisy_void`** — before 423.230, after 409.630

```bash
ffplay -autoexit -nodisp -ss 407.13 -t 18.60 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> It is full of noise

**66. `143_meaningless_noises`** — before 425.170, after 410.990

```bash
ffplay -autoexit -nodisp -ss 408.49 -t 19.18 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> almost all of it meaningless.

**67. `144_howling_wind`** — before 427.670, after 412.510

```bash
ffplay -autoexit -nodisp -ss 410.01 -t 20.16 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Wind.

**68. `145_scurrying_creature`** — before 429.080, after 413.130

```bash
ffplay -autoexit -nodisp -ss 410.63 -t 20.95 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Small animals.

**69. `146_fire_settling`** — before 430.930, after 414.060

```bash
ffplay -autoexit -nodisp -ss 411.56 -t 21.87 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The fire settling.

**70. `147_frozen_branches`** — before 432.640, after 416.130

```bash
ffplay -autoexit -nodisp -ss 413.63 -t 21.51 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Branches pulling tight in the cold.

**71. `148_breathing_clan`** — before 435.150, after 418.210

```bash
ffplay -autoexit -nodisp -ss 415.71 -t 21.94 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Sleeping people breathing.

**72. `149_month_rotation`** — before 437.220, after 421.100

```bash
ffplay -autoexit -nodisp -ss 418.60 -t 21.12 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You spend your second month in rotation learning to separate the sounds that matter from the enormous volume that do not.

**73. `150_listening_intent`** — before 445.140, after 430.930

```bash
ffplay -autoexit -nodisp -ss 428.43 -t 19.21 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are not listening for a sound.

**74. `151_scout_listening_void`** — before 448.020, after 433.230

```bash
ffplay -autoexit -nodisp -ss 430.73 -t 19.79 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are listening for the absence of one.

**75. `153_something_stopped_them`** — before 454.330, after 438.350

```bash
ffplay -autoexit -nodisp -ss 435.85 -t 20.98 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> something stopped them.

**76. `154_silent_night_birds`** — before 455.860, after 439.480

```bash
ffplay -autoexit -nodisp -ss 436.98 -t 21.38 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> When the night birds cut off mid-call

**77. `155_predator_passing_under`** — before 457.810, after 440.950

```bash
ffplay -autoexit -nodisp -ss 438.45 -t 21.86 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> something passed under them.

**78. `156_scout_deep_realization`** — before 459.870, after 442.270

```bash
ffplay -autoexit -nodisp -ss 439.77 -t 22.60 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> These gaps tell you more than any loud noise could.

**79. `157_scout_nervous_reflection`** — before 463.370, after 445.140

```bash
ffplay -autoexit -nodisp -ss 442.64 -t 23.23 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You get it wrong twice in your first season.

**80. `159_camp_standing_alert`** — before 470.880, after 455.240

```bash
ffplay -autoexit -nodisp -ss 452.74 -t 20.64 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The whole camp stands up and it takes several minutes to settle.

**81. `160_camp_forgiveness`** — before 474.490, after 459.870

```bash
ffplay -autoexit -nodisp -ss 457.37 -t 19.62 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Nobody is angry with you.

**82. `162_false_alarm_burn`** — before 479.300, after 463.990

```bash
ffplay -autoexit -nodisp -ss 461.49 -t 20.31 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> the specific burn of a false alarm

**83. `163_not_carrying_feeling`** — before 481.560, after 466.090

```bash
ffplay -autoexit -nodisp -ss 463.59 -t 20.47 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> and you do not want to carry that feeling again.

**84. `164_waiting_too_long`** — before 484.330, after 469.420

```bash
ffplay -autoexit -nodisp -ss 466.92 -t 19.91 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The second time you wait too long.

**85. `165_talking_out_trust`** — before 486.980, after 470.880

```bash
ffplay -autoexit -nodisp -ss 468.38 -t 21.10 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You hear the interruption and you talk yourself out of trusting it.

**86. `166_dire_wolf_perimeter`** — before 490.910, after 476.740

```bash
ffplay -autoexit -nodisp -ss 474.24 -t 19.17 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The threat is a lone dire wolf testing the perimeter

**87. `167_smell_of_butchery`** — before 494.770, after 481.560 (ledger CORRECT value 494.750)

```bash
ffplay -autoexit -nodisp -ss 479.06 -t 18.21 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> drawn by the smell of the previous day’s butchering.

**88. `168_daret_thrown_stone`** — before 497.970, after 484.330

```bash
ffplay -autoexit -nodisp -ss 481.83 -t 18.64 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Daret spots it from his post and turns it back with a thrown stone before it gets close.

**89. `169_daret_meets_scout`** — before 503.530, after 488.410

```bash
ffplay -autoexit -nodisp -ss 485.91 -t 20.12 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> He finds you at your post afterward.

**90. `170_daret_speaks`** — before 506.170, after 490.910

```bash
ffplay -autoexit -nodisp -ss 488.41 -t 20.26 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> He tells you one thing

**91. `171_scout_carrying_load`** — before 507.970, after 493.890

```bash
ffplay -autoexit -nodisp -ss 491.39 -t 19.08 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> and you never stop carrying it.

**92. `173_broken_track_pattern`** — before 513.460, after 497.970

```bash
ffplay -autoexit -nodisp -ss 495.47 -t 20.49 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> When something in you says a pattern has broken

**93. `174_enough_standing_tall`** — before 516.760, after 501.000

```bash
ffplay -autoexit -nodisp -ss 498.50 -t 20.76 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> that is enough.

**94. `175_stepping_into_void`** — before 518.400, after 503.530

```bash
ffplay -autoexit -nodisp -ss 501.03 -t 19.87 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Stop waiting for your mind to finish arguing.

**95. `177_leading_in_darkness`** — before 528.030, after 507.970

```bash
ffplay -autoexit -nodisp -ss 505.47 -t 25.06 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Fear no longer leads when you move in darkness.

**96. `178_fear_running_alongside`** — before 531.480, after 509.700

```bash
ffplay -autoexit -nodisp -ss 507.20 -t 26.78 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> It runs alongside you now

**97. `179_not_in_charge`** — before 533.370, after 511.980

```bash
ffplay -autoexit -nodisp -ss 509.48 -t 26.39 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> present but not in charge.

**98. `180_late_autumn_transformation`** — before 535.660, after 513.460

```bash
ffplay -autoexit -nodisp -ss 510.96 -t 27.20 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The night that changes you comes in late autumn.

**99. `183_chasing_hunters`** — before 547.610, after 528.030

```bash
ffplay -autoexit -nodisp -ss 525.53 -t 24.58 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Two hunters go after them.

**100. `185_yaro_running`** — before 552.080, after 530.740

```bash
ffplay -autoexit -nodisp -ss 528.24 -t 26.34 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The other is Yaro

**101. `186_yaro_age`** — before 554.170, after 531.480

```bash
ffplay -autoexit -nodisp -ss 528.98 -t 27.69 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> thirty years old

**102. `187_composed_yaro`** — before 555.560, after 533.370

```bash
ffplay -autoexit -nodisp -ss 530.87 -t 27.19 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> the most composed man on any hunt you have been on.

**103. `190_yaro_signal`** — before 567.050, after 546.230

```bash
ffplay -autoexit -nodisp -ss 543.73 -t 25.82 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Yaro signals to stop.

**104. `191_both_still`** — before 569.150, after 547.610

```bash
ffplay -autoexit -nodisp -ss 545.11 -t 26.54 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You both go still.

**105. `193_low_ground`** — before 572.240, after 549.910

```bash
ffplay -autoexit -nodisp -ss 547.41 -t 27.33 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> What you hear instead of aurochs is something low and close to the ground.

**106. `194_breathing_tension`** — before 577.270, after 555.560

```bash
ffplay -autoexit -nodisp -ss 553.06 -t 26.71 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> A breathing that belongs to neither of you.

**107. `195_unseen_woods`** — before 580.160, after 559.040

```bash
ffplay -autoexit -nodisp -ss 556.54 -t 26.12 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You cannot locate it in the trees.

**108. `197_yaro_still`** — before 583.700, after 562.210

```bash
ffplay -autoexit -nodisp -ss 559.71 -t 26.49 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Yaro does not move.

**109. `198_stopped_breathing`** — before 585.890, after 562.870

```bash
ffplay -autoexit -nodisp -ss 560.37 -t 28.02 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The breathing stops.

**110. `199_three_seconds`** — before 587.800, after 563.560

```bash
ffplay -autoexit -nodisp -ss 561.06 -t 29.24 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Three seconds.

**111. `201_stealthy_footstep`** — before 592.070, after 565.260

```bash
ffplay -autoexit -nodisp -ss 562.76 -t 31.81 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> one foot at a time

**112. `202_mirroring_scout`** — before 593.350, after 565.850

```bash
ffplay -autoexit -nodisp -ss 563.35 -t 32.50 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> and you mirror him exactly.

**113. `203_backward_retreat`** — before 595.830, after 569.150

```bash
ffplay -autoexit -nodisp -ss 566.65 -t 31.68 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You walk backward out of the forest with your spear forward and your free hand trailing behind you to feel for the tree line.

**114. `204_meadow_run`** — before 602.860, after 577.270

```bash
ffplay -autoexit -nodisp -ss 574.77 -t 30.59 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You reach the open meadow and you both run

**115. `205_instinctual_flight`** — before 606.180, after 580.620

```bash
ffplay -autoexit -nodisp -ss 578.12 -t 30.56 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> not deciding to run

**116. `206_scouts_sprinting`** — before 607.680, after 582.220

```bash
ffplay -autoexit -nodisp -ss 579.72 -t 30.46 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> just running.

**117. `207_reporting_to_leader`** — before 608.770, after 583.700

```bash
ffplay -autoexit -nodisp -ss 581.20 -t 30.07 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You return to the main group and report.

**118. `209_empty_meadow`** — before 614.170, after 592.070

```bash
ffplay -autoexit -nodisp -ss 589.57 -t 27.10 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The aurochs are gone.

**119. `210_ominous_timber`** — before 615.940, after 593.350

```bash
ffplay -autoexit -nodisp -ss 590.85 -t 27.59 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Whatever shared that timber with you was not worth finding.

**120. `211_hearth_reflection`** — before 619.310, after 599.280

```bash
ffplay -autoexit -nodisp -ss 596.78 -t 25.03 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> That night by the fire you think about the three seconds after the breathing stopped.

**121. `212_watching_eyes`** — before 623.580, after 601.490

```bash
ffplay -autoexit -nodisp -ss 598.99 -t 27.09 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Something in the dark assessed you and made a decision.

**122. `215_spear_grip`** — before 634.570, after 614.170

```bash
ffplay -autoexit -nodisp -ss 611.67 -t 25.40 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> That is a different kind of knowledge than anything you were taught.

**123. `217_still_silence`** — before 641.230, after 621.050

```bash
ffplay -autoexit -nodisp -ss 618.55 -t 25.18 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You get quieter after that.

**124. `218_upright_posture`** — before 643.020, after 623.580

```bash
ffplay -autoexit -nodisp -ss 621.08 -t 24.44 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Not afraid, but rearranged inside.

**125. `219_starry_void`** — before 646.220, after 625.180

```bash
ffplay -autoexit -nodisp -ss 622.68 -t 26.04 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You understand that surviving is not only about what you do.

**126. `220_lethal_gap`** — before 650.620, after 629.010

```bash
ffplay -autoexit -nodisp -ss 626.51 -t 26.61 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> There is a space between your action and something else’s action

**127. `223_carrying_weight`** — before 662.550, after 643.020

```bash
ffplay -autoexit -nodisp -ss 640.52 -t 24.53 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You carry it.

**128. `225_night_scouts`** — before 669.060, after 646.220

```bash
ffplay -autoexit -nodisp -ss 643.72 -t 27.84 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You lead the night scouts now.

**129. `227_scout_ages`** — before 672.800, after 650.620

```bash
ffplay -autoexit -nodisp -ss 648.12 -t 27.18 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> ranging from seventeen to twenty-four.

**130. `228_informal_bond`** — before 675.550, after 652.250

```bash
ffplay -autoexit -nodisp -ss 649.75 -t 28.30 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> They are not yours in any formal sense.

**131. `229_no_formal_sense`** — before 678.580, after 654.450

```bash
ffplay -autoexit -nodisp -ss 651.95 -t 29.13 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> There is no formal sense here.

**132. `230_slowing_pace`** — before 680.990, after 656.510

```bash
ffplay -autoexit -nodisp -ss 654.01 -t 29.48 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> But when you slow

**133. `232_sudden_halt`** — before 684.090, after 657.900

```bash
ffplay -autoexit -nodisp -ss 655.40 -t 31.19 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> When you stop, they stop.

**134. `233_firelight_speech`** — before 686.540, after 659.330

```bash
ffplay -autoexit -nodisp -ss 656.83 -t 32.21 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> When you speak at the fire before a hard night

**135. `234_focused_attention`** — before 689.390, after 664.330

```bash
ffplay -autoexit -nodisp -ss 661.83 -t 30.06 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> their attention is different from what they give anyone else.

**136. `235_unasked_burden`** — before 692.890, after 667.470

```bash
ffplay -autoexit -nodisp -ss 664.97 -t 30.42 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You did not ask for this.

**137. `236_uncertain_start`** — before 694.950, after 669.060

```bash
ffplay -autoexit -nodisp -ss 666.56 -t 30.89 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are not sure when it started.

**138. `238_youthful_fear`** — before 701.290, after 675.550

```bash
ffplay -autoexit -nodisp -ss 673.05 -t 30.74 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> That fear was about your own body.

**139. `239_internal_burden`** — before 703.510, after 678.580

```bash
ffplay -autoexit -nodisp -ss 676.08 -t 29.93 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> This sits differently.

**140. `240_tribal_survival`** — before 705.360, after 679.960

```bash
ffplay -autoexit -nodisp -ss 677.46 -t 30.40 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> It is about theirs.

**141. `242_fen_excited_run`** — before 710.110, after 684.090

```bash
ffplay -autoexit -nodisp -ss 681.59 -t 31.02 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> He has the instincts but his feet carry his excitement on runs.

**142. `243_fen_too_quick`** — before 714.450, after 689.390

```bash
ffplay -autoexit -nodisp -ss 686.89 -t 30.06 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Too quick, consistently.

**143. `244_elder_watching_fen`** — before 716.350, after 692.890

```bash
ffplay -autoexit -nodisp -ss 690.39 -t 28.46 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You watch him for two full seasons and say almost nothing.

**144. `245_seasonal_contrast`** — before 719.910, after 694.950

```bash
ffplay -autoexit -nodisp -ss 692.45 -t 29.96 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You let him see the contrast.

**145. `246_elder_speaks_plainly`** — before 721.930, after 697.050

```bash
ffplay -autoexit -nodisp -ss 694.55 -t 29.88 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Then one evening before a run you tell him plainly

**146. `247_danger_lesson`** — before 724.960, after 701.290

```bash
ffplay -autoexit -nodisp -ss 698.79 -t 28.67 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> slow is not about the danger being less.

**147. `249_fast_after_decision`** — before 731.020, after 705.360

```bash
ffplay -autoexit -nodisp -ss 702.86 -t 30.66 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Fast is for after the decision has already been made.

**148. `250_before_the_moment`** — before 734.660, after 707.190

```bash
ffplay -autoexit -nodisp -ss 704.69 -t 32.47 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Before that moment

**149. `251_main_focused_observation`** — before 735.910, after 708.950

```bash
ffplay -autoexit -nodisp -ss 706.45 -t 31.96 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> slow is the sharpest thing you have.

**150. `252_fen_slowing_run`** — before 738.120, after 712.370

```bash
ffplay -autoexit -nodisp -ss 709.87 -t 30.75 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> On the next run he slows.

**151. `253_fen_measured_movement`** — before 740.020, after 714.450

```bash
ffplay -autoexit -nodisp -ss 711.95 -t 30.57 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Not completely.

**152. `254_main_observing_fen`** — before 741.440, after 716.350

```bash
ffplay -autoexit -nodisp -ss 713.85 -t 30.09 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> But you can see it.

**153. `255_daret_hand_on_shoulder`** — before 743.130, after 719.910

```bash
ffplay -autoexit -nodisp -ss 717.41 -t 28.22 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You remember Daret’s hand on your shoulder over the dropped torch.

**154. `256_korik_stopping_in_dark`** — before 747.380, after 721.930

```bash
ffplay -autoexit -nodisp -ss 719.43 -t 30.45 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You remember Korik stopping half a step after you in the dark

**155. `258_main_contemplative_ridge`** — before 755.140, after 732.880

```bash
ffplay -autoexit -nodisp -ss 730.38 -t 27.26 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The things that kept you alive were not only your own choices.

**156. `259_mentors_around_hearth`** — before 759.530, after 735.910

```bash
ffplay -autoexit -nodisp -ss 733.41 -t 28.62 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> They were built into you by people who made room for you to learn without killing your willingness to try.

**157. `261_weary_leader`** — before 768.720, after 745.350

```bash
ffplay -autoexit -nodisp -ss 742.85 -t 28.37 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You do not always manage it.

**158. `262_stern_warning`** — before 770.600, after 747.380

```bash
ffplay -autoexit -nodisp -ss 744.88 -t 28.22 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Some nights the danger is too close and you have to be hard with them in ways you regret by the time you are sitting at the fire watching their faces.

**159. `263_temporary_dawn`** — before 779.220, after 757.270

```bash
ffplay -autoexit -nodisp -ss 754.77 -t 26.95 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Every dawn is temporary.

**160. `264_feeding_fire`** — before 781.980, after 758.230

```bash
ffplay -autoexit -nodisp -ss 755.73 -t 28.75 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The dark comes back the same way your mother fed the fire

**161. `265_unending_dark`** — before 785.580, after 763.320

```bash
ffplay -autoexit -nodisp -ss 760.82 -t 27.26 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> without announcement, without end.

**162. `267_leader_of_children`** — before 794.190, after 768.720

```bash
ffplay -autoexit -nodisp -ss 766.22 -t 30.47 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> There are children here who have never known a night where someone other than you was the person the adults looked to when something moved at the perimeter.

**163. `269_gift_of_meat`** — before 808.530, after 782.500

```bash
ffplay -autoexit -nodisp -ss 780.00 -t 31.03 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> puts a piece of dried meat in your hand

**164. `270_silent_departure`** — before 810.510, after 785.580

```bash
ffplay -autoexit -nodisp -ss 783.08 -t 29.93 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> and walks away without any explanation.

**165. `271_holding_meat`** — before 812.750, after 787.080

```bash
ffplay -autoexit -nodisp -ss 784.58 -t 30.67 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You hold the meat and understand you have become something this group has no simple word for.

**166. `274_stillness_ache`** — before 822.620, after 799.510

```bash
ffplay -autoexit -nodisp -ss 797.01 -t 28.11 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The particular ache of held stillness.

**167. `275_morning_knees`** — before 825.840, after 803.380

```bash
ffplay -autoexit -nodisp -ss 800.88 -t 27.46 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Your knees announce themselves on cold mornings before you are fully awake.

**168. `276_not_old`** — before 830.470, after 807.200

```bash
ffplay -autoexit -nodisp -ss 804.70 -t 28.27 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are not old by some measures.

**169. `277_night_body`** — before 833.100, after 809.550

```bash
ffplay -autoexit -nodisp -ss 807.05 -t 28.55 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> But you are old the way that twenty years of moving at night makes a body old.

**170. `278_faster_men`** — before 838.080, after 816.050

```bash
ffplay -autoexit -nodisp -ss 813.55 -t 27.03 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> There are faster men now.

**171. `279_sharper_ears`** — before 839.980, after 817.960

```bash
ffplay -autoexit -nodisp -ss 815.46 -t 27.02 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> There are scouts with sharper ears.

**172. `280_saying_so`** — before 842.270, after 820.880

```bash
ffplay -autoexit -nodisp -ss 818.38 -t 26.39 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You say so.

**173. `281_hearth_counsel`** — before 843.500, after 822.620

```bash
ffplay -autoexit -nodisp -ss 820.12 -t 25.88 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You tell Fen

**174. `282_fen_leading`** — before 844.830, after 825.840

```bash
ffplay -autoexit -nodisp -ss 823.34 -t 23.99 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> twenty-five now and leading runs you no longer go on

**175. `283_fen_keen_ears`** — before 848.340, after 827.350

```bash
ffplay -autoexit -nodisp -ss 824.85 -t 25.99 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> that his ears are better than yours in the birch stands.

**176. `284_fen_modesty`** — before 851.820, after 830.470

```bash
ffplay -autoexit -nodisp -ss 827.97 -t 26.35 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> He takes it as modesty at first.

**177. `287_growing_responsibility`** — before 859.200, after 836.550

```bash
ffplay -autoexit -nodisp -ss 834.05 -t 27.65 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> and acting on it correctly means his responsibility at night is larger than it was

**178. `290_tragic_aftermath`** — before 872.860, after 851.820

```bash
ffplay -autoexit -nodisp -ss 849.32 -t 26.04 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The child is barely four years old.

**179. `291_eastern_post`** — before 875.440, after 854.360

```bash
ffplay -autoexit -nodisp -ss 851.86 -t 26.08 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are at the eastern post.

**180. `292_distant_attack`** — before 877.600, after 856.540

```bash
ffplay -autoexit -nodisp -ss 854.04 -t 26.06 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The attack comes from the direction that is not yours.

**181. `295_defensive_positioning`** — before 886.110, after 868.690

```bash
ffplay -autoexit -nodisp -ss 866.19 -t 22.42 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The positioning was right.

**182. `298_heavy_burden`** — before 892.810, after 875.440

```bash
ffplay -autoexit -nodisp -ss 872.94 -t 22.37 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> None of that lifts the weight.

**183. `299_realization_moment`** — before 895.010, after 877.600

```bash
ffplay -autoexit -nodisp -ss 875.10 -t 22.41 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> What you arrive at

**184. `300_night_gap`** — before 896.530, after 879.240

```bash
ffplay -autoexit -nodisp -ss 876.74 -t 22.29 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> eventually, is that you can build the best structure knowledge and experience allow and the night will still find the gap that structure cannot close.

**185. `301_hearth_reflection`** — before 905.150, after 888.370

```bash
ffplay -autoexit -nodisp -ss 885.87 -t 21.78 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Accepting that without it hollowing out your readiness is harder than any technique you have ever learned.

**186. `302_night_sprint`** — before 911.420, after 895.010

```bash
ffplay -autoexit -nodisp -ss 892.51 -t 21.41 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Harder than any night run in open ground.

**187. `303_rebuilding_shelter`** — before 914.510, after 897.260

```bash
ffplay -autoexit -nodisp -ss 894.76 -t 22.25 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You rebuild.

**188. `304_closing_gap`** — before 916.070, after 897.570

```bash
ffplay -autoexit -nodisp -ss 895.07 -t 23.50 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You add a post that covers the gap the night found.

**189. `306_flint_knapping`** — before 921.360, after 905.150

```bash
ffplay -autoexit -nodisp -ss 902.65 -t 21.21 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You carry it alongside everything else and you keep working.

**190. `309_wide_river_meeting`** — before 936.250, after 916.070

```bash
ffplay -autoexit -nodisp -ss 913.57 -t 25.18 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> When the bands come together at the seasonal meeting place by the wide river

**191. `310_scouts_at_fire`** — before 940.090, after 919.180

```bash
ffplay -autoexit -nodisp -ss 916.68 -t 25.91 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> those men find you at the fire

**192. `311_quiet_hearth_talk`** — before 941.980, after 923.680

```bash
ffplay -autoexit -nodisp -ss 921.18 -t 23.30 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> sit close, and the talk moves between ordinary things and the kind of talk that only happens between people who have shared a particular kind of night.

**193. `312_fen_scouts_introduction`** — before 950.900, after 933.910

```bash
ffplay -autoexit -nodisp -ss 931.41 -t 21.99 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Fen brings two young scouts to you at the gathering.

**194. `315_observing_over_time`** — before 961.530, after 945.570

```bash
ffplay -autoexit -nodisp -ss 943.07 -t 20.96 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You watch the two of them over several evenings.

**195. `316_scout_instinct_fear`** — before 964.450, after 947.990

```bash
ffplay -autoexit -nodisp -ss 945.49 -t 21.46 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> One has good instincts but is afraid of fear

**196. `317_sharpening_bone_tool`** — before 967.300, after 950.900

```bash
ffplay -autoexit -nodisp -ss 948.40 -t 21.40 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> which is the worst combination you know.

**197. `319_eye_reflection_awareness`** — before 971.910, after 955.820

```bash
ffplay -autoexit -nodisp -ss 953.32 -t 21.09 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Fear is information.

**198. `320_body_warning_signal`** — before 974.260, after 957.140

```bash
ffplay -autoexit -nodisp -ss 954.64 -t 22.12 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The problem is what happens when the body’s warning triggers a second signal that overrides the first.

**199. `321_hearth_counsel`** — before 980.170, after 967.300

```bash
ffplay -autoexit -nodisp -ss 964.80 -t 17.87 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> That young man needs to understand that the tightness in his chest before a hard night is not a sign of weakness arriving.

**200. `322_body_readiness`** — before 986.880, after 975.530

```bash
ffplay -autoexit -nodisp -ss 973.03 -t 16.35 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> It is the body getting ready.

**201. `323_direct_speech`** — before 988.810, after 977.620

```bash
ffplay -autoexit -nodisp -ss 975.12 -t 16.19 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You tell him directly because he is young enough that direct still works.

**202. `324_youth_realization`** — before 993.100, after 982.260

```bash
ffplay -autoexit -nodisp -ss 979.76 -t 15.84 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You see it take in his face.

**203. `326_careless_ease`** — before 998.150, after 984.690

```bash
ffplay -autoexit -nodisp -ss 982.19 -t 18.46 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> She moves into dark terrain with an ease that looks like calm but is actually the absence of proper attention.

**204. `327_perimeter_lesson`** — before 1005.240, after 993.100

```bash
ffplay -autoexit -nodisp -ss 990.60 -t 17.14 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You take her to the perimeter edge one evening and ask her to stand still and report what she notices.

**205. `328_obvious_sights`** — before 1011.750, after 1002.240

```bash
ffplay -autoexit -nodisp -ss 999.74 -t 14.51 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> At first she reports the obvious.

**206. `329_patient_silence`** — before 1014.600, after 1003.840

```bash
ffplay -autoexit -nodisp -ss 1001.34 -t 15.76 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You wait.

**207. `330_finer_observations`** — before 1015.920, after 1005.240

```bash
ffplay -autoexit -nodisp -ss 1002.74 -t 15.68 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The reports get finer.

**208. `331_scent_at_slope`** — before 1017.820, after 1008.020

```bash
ffplay -autoexit -nodisp -ss 1005.52 -t 14.80 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> A smell change at the base of a slope.

**209. `332_fading_sound`** — before 1020.650, after 1008.730

```bash
ffplay -autoexit -nodisp -ss 1006.23 -t 16.92 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> A sound she had not consciously registered until it was gone.

**210. `333_passing_knowledge`** — before 1024.810, after 1011.750

```bash
ffplay -autoexit -nodisp -ss 1009.25 -t 18.06 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You tell her that.

**211. `334_internal_noticing`** — before 1026.500, after 1012.940

```bash
ffplay -autoexit -nodisp -ss 1010.44 -t 18.56 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> That second kind of noticing.

**212. `335_tracking_skill`** — before 1028.580, after 1015.920

```bash
ffplay -autoexit -nodisp -ss 1013.42 -t 17.66 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> That is where the whole skill lives.

**213. `336_uncertain_mentorship`** — before 1031.570, after 1017.820

```bash
ffplay -autoexit -nodisp -ss 1015.32 -t 18.75 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are not certain you gave either of them what they needed.

**214. `337_mutual_exchange`** — before 1035.310, after 1021.710

```bash
ffplay -autoexit -nodisp -ss 1019.21 -t 18.60 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You were not certain Daret and Korik gave you everything you needed.

**215. `338_final_gift`** — before 1039.480, after 1026.500

```bash
ffplay -autoexit -nodisp -ss 1024.00 -t 17.98 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You gave what you had.

**216. `339_night_voyage`** — before 1041.560, after 1028.580

```bash
ffplay -autoexit -nodisp -ss 1026.08 -t 17.98 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The rest belongs to the nights they will face without you.

**217. `341_aging_temples`** — before 1051.650, after 1033.090

```bash
ffplay -autoexit -nodisp -ss 1030.59 -t 23.56 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Your hair has gone pale at the edges.

**218. `342_steady_grip`** — before 1054.370, after 1035.310

```bash
ffplay -autoexit -nodisp -ss 1032.81 -t 24.06 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Your hands are steady now

**219. `343_shaking_scout`** — before 1056.420, after 1039.480

```bash
ffplay -autoexit -nodisp -ss 1036.98 -t 21.94 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> the same hands that could not hold still over your first real guarding post.

**220. `344_marked_palms`** — before 1061.000, after 1043.230

```bash
ffplay -autoexit -nodisp -ss 1040.73 -t 22.77 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> They are also marked with everything the years put into them.

**221. `345_palm_scar`** — before 1064.190, after 1045.620

```bash
ffplay -autoexit -nodisp -ss 1043.12 -t 23.57 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The white line across your left palm from a night in the limestone hills.

**222. `346_shortened_finger`** — before 1068.550, after 1054.370

```bash
ffplay -autoexit -nodisp -ss 1051.87 -t 19.18 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The shortened finger on your right hand from something you do not describe in detail.

**223. `347_thickened_knuckles`** — before 1073.140, after 1064.190

```bash
ffplay -autoexit -nodisp -ss 1061.69 -t 13.95 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The thickened knuckles from four decades of gripping things hard in the cold.

**224. `348_distant_bands`** — before 1077.740, after 1065.760

```bash
ffplay -autoexit -nodisp -ss 1063.26 -t 16.98 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Other bands know your name.

**225. `349_stoic_presence`** — before 1079.710, after 1067.130

```bash
ffplay -autoexit -nodisp -ss 1064.63 -t 17.58 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Not the way a man is known for a single event.

**226. `350_mountain_ridge`** — before 1082.990, after 1070.080

```bash
ffplay -autoexit -nodisp -ss 1067.58 -t 17.91 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The way a specific ridge is known

**227. `351_river_crossing`** — before 1085.580, after 1073.140

```bash
ffplay -autoexit -nodisp -ss 1070.64 -t 17.44 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> or a reliable river crossing.

**228. `354_dark_beast`** — before 1095.170, after 1081.530

```bash
ffplay -autoexit -nodisp -ss 1079.03 -t 18.64 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> to what lives in it

**229. `355_reading_tracks`** — before 1096.610, after 1082.990

```bash
ffplay -autoexit -nodisp -ss 1080.49 -t 18.62 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> to how to read an animal that is following you against one that only crossed your path

**230. `356_respectful_glance`** — before 1101.060, after 1088.360

```bash
ffplay -autoexit -nodisp -ss 1085.86 -t 17.70 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> people look toward where you are sitting.

**231. `357_sitting_quietly`** — before 1103.490, after 1092.150

```bash
ffplay -autoexit -nodisp -ss 1089.65 -t 16.34 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Not because you stand and announce anything.

**232. `358_knowledge_face`** — before 1106.380, after 1095.170

```bash
ffplay -autoexit -nodisp -ss 1092.67 -t 16.21 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Because over enough years your name has attached to a kind of knowledge people understand is not easily replaced.

**233. `359_listening_hunters`** — before 1113.570, after 1101.060

```bash
ffplay -autoexit -nodisp -ss 1098.56 -t 17.51 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Young hunters from other bands sit near your fire and listen.

**234. `360_scout_wisdom`** — before 1117.080, after 1106.380

```bash
ffplay -autoexit -nodisp -ss 1103.88 -t 15.70 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You know what they see.

**235. `361_daret_observation`** — before 1118.530, after 1111.380

```bash
ffplay -autoexit -nodisp -ss 1108.88 -t 12.15 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The same thing you saw when you first looked at Daret.

**236. `362_survival_proof`** — before 1121.310, after 1113.020

```bash
ffplay -autoexit -nodisp -ss 1110.52 -t 13.29 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Proof that surviving a long time is possible.

**237. `363_facing_night`** — before 1124.450, after 1116.180

```bash
ffplay -autoexit -nodisp -ss 1113.68 -t 13.27 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> An answer to the question of whether you can face the night across a whole life without it eventually winning.

**238. `365_recurrent_storytelling`** — before 1132.840, after 1126.230

```bash
ffplay -autoexit -nodisp -ss 1123.73 -t 11.61 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> same as you always do.

**239. `372_wide_eyed_fear`** — before 1153.710, after 1153.310

```bash
ffplay -autoexit -nodisp -ss 1150.81 -t 5.40 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Fear as a tool.

**240. `373_slow_blade_draw`** — before 1156.220, after 1153.710

```bash
ffplay -autoexit -nodisp -ss 1151.21 -t 7.51 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Slow as a weapon.

**241. `374_scout_instinct`** — before 1157.930, after 1154.030

```bash
ffplay -autoexit -nodisp -ss 1151.53 -t 8.90 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The body ahead of the mind.

**242. `375_group_incomprehension`** — before 1159.890, after 1154.900

```bash
ffplay -autoexit -nodisp -ss 1152.40 -t 9.99 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> They do not take in the losses the same way.

**243. `376_observing_the_unready`** — before 1162.490, after 1155.580

```bash
ffplay -autoexit -nodisp -ss 1153.08 -t 11.91 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> They are not ready for them yet.

**244. `377_main_character_memory`** — before 1164.920, after 1156.220

```bash
ffplay -autoexit -nodisp -ss 1153.72 -t 13.70 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You know this because you were not ready either

**245. `384_night_scouts`** — before 1193.770, after 1184.630

```bash
ffplay -autoexit -nodisp -ss 1182.13 -t 14.14 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The night runs belong to someone else now.

**246. `385_lost_precision`** — before 1196.310, after 1185.360

```bash
ffplay -autoexit -nodisp -ss 1182.86 -t 15.95 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Your legs still work but your eyes have lost the edge-of-darkness precision that forward scouting demands.

**247. `386_quiet_knowing`** — before 1202.460, after 1193.770

```bash
ffplay -autoexit -nodisp -ss 1191.27 -t 13.69 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You know this without needing anyone to tell you.

**248. `387_handing_spear`** — before 1205.510, after 1197.820

```bash
ffplay -autoexit -nodisp -ss 1195.32 -t 12.69 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Three winters ago you stepped back from active perimeter work and gave it fully to Fen’s people

**249. `388_fen_teaching`** — before 1211.400, after 1202.460

```bash
ffplay -autoexit -nodisp -ss 1199.96 -t 13.94 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> who have by now become the ones teaching the people after them.

**250. `389_unnamed_role`** — before 1214.970, after 1209.220

```bash
ffplay -autoexit -nodisp -ss 1206.72 -t 10.75 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> What you do now is harder to put a name to.

**251. `407_shadow_movement`** — before 1294.290, after 1296.420

```bash
ffplay -autoexit -nodisp -ss 1291.79 -t 7.13 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You still catch the interruptions.

**252. `408_shifting_air`** — before 1296.420, after 1297.550

```bash
ffplay -autoexit -nodisp -ss 1293.92 -t 6.13 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You still feel when the air outside the camp shifts in a certain way.

</details>

### 4. Remaining moved-without-evidence set

| # | scene tag | before | after | delta | conf before | conf after | listening window | verdict | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `011_shivering_by_fire` | 28.890 | 27.450 | -1.440 | 4.59e-6 | 3.67e-6 | 24.95–31.39 |  |  |
| 2 | `020_lurking_darkness` | 56.560 | 55.850 | -0.710 | 8.53e-7 | 8.11e-6 | 53.35–59.06 |  |  |
| 3 | `038_spear_glint` | 111.910 | 108.550 | -3.360 | 1.83e-7 | 7.23e-7 | 106.05–114.41 |  |  |
| 4 | `040_outside_circle` | 119.210 | 114.640 | -4.570 | 1.00e+0 | 9.94e-1 | 112.14–121.71 |  |  |
| 5 | `049_chest_protection` | 146.380 | 141.850 | -4.530 | 3.74e-6 | 8.94e-6 | 139.35–148.88 |  |  |
| 6 | `056_dropping_torch` | 167.700 | 159.980 | -7.720 | 4.26e-8 | 7.74e-8 | 157.48–170.20 |  |  |
| 7 | `066_torch_reflection` | 200.160 | 192.050 | -8.110 | 9.99e-1 | 9.92e-1 | 189.55–202.66 |  |  |
| 8 | `091_scouts_walking` | 272.540 | 271.460 | -1.080 | 9.97e-1 | 9.63e-1 | 268.96–275.04 |  |  |
| 9 | `096_smell_first` | 287.440 | 279.320 | -8.120 | 9.69e-1 | 9.46e-1 | 276.82–289.94 |  |  |
| 10 | `128_back_to_fire` | 383.740 | 366.830 | -16.910 | 1.00e+0 | 9.95e-1 | 364.33–386.24 |  |  |
| 11 | `130_discomfort_point` | 394.110 | 381.150 | -12.960 | 9.93e-1 | 9.80e-1 | 378.65–396.61 |  |  |
| 12 | `135_three_hours` | 401.780 | 389.390 | -12.390 | 5.98e-7 | 1.40e-6 | 386.89–404.28 |  |  |
| 13 | `161_waste_chest` | 476.740 | 461.480 | -15.260 | 4.32e-8 | 2.55e-7 | 458.98–479.24 |  |  |
| 14 | `172_body_instinct_grip` | 510.450 | 495.660 | -14.790 | 9.94e-1 | 1.00e+0 | 493.16–512.95 |  |  |
| 15 | `181_aurochs_drive` | 538.910 | 516.760 | -22.150 | 2.85e-7 | 5.93e-7 | 514.26–541.41 |  |  |
| 16 | `182_breaking_aurochs` | 542.820 | 522.460 | -20.360 | 8.73e-7 | 2.60e-6 | 519.96–545.32 |  |  |
| 17 | `184_mc_running` | 549.910 | 530.250 | -19.660 | 9.38e-1 | 9.22e-1 | 527.75–552.41 |  |  |
| 18 | `188_fading_light` | 559.040 | 536.000 | -23.040 | 9.99e-1 | 9.96e-1 | 533.50–561.54 |  |  |
| 19 | `189_heavy_timber` | 561.450 | 537.000 | -24.450 | 9.24e-1 | 1.00e+0 | 534.50–563.95 |  |  |
| 20 | `196_main_frozen` | 582.220 | 561.450 | -20.770 | 9.95e-1 | 9.98e-1 | 558.95–584.72 |  |  |
| 21 | `200_yaro_shifts` | 589.540 | 563.970 | -25.570 | 1.00e+0 | 1.53e-1 | 561.47–592.04 |  |  |
| 22 | `208_leader_decision` | 611.300 | 587.800 | -23.500 | 9.98e-1 | 9.90e-1 | 585.30–613.80 |  |  |
| 23 | `237_heavy_weight` | 697.050 | 671.170 | -25.880 | 9.99e-1 | 9.98e-1 | 668.67–699.55 |  |  |
| 24 | `241_fen_young_scout` | 707.190 | 681.820 | -25.370 | 9.05e-1 | 1.05e-1 | 679.32–709.69 |  |  |
| 25 | `248_stealthy_movement` | 727.730 | 701.780 | -25.950 | 1.93e-7 | 1.29e-6 | 699.28–730.23 |  |  |
| 26 | `257_wordless_confirmation_scent` | 751.100 | 727.730 | -23.370 | 8.41e-7 | 1.18e-6 | 725.23–753.60 |  |  |
| 27 | `260_main_teaching_fen` | 765.860 | 743.130 | -22.730 | 9.99e-1 | 9.99e-1 | 740.63–768.36 |  |  |
| 28 | `268_morning_visitor` | 803.380 | 775.680 | -27.700 | 9.64e-1 | 1.12e-1 | 773.18–805.88 |  |  |
| 29 | `272_hunched_back` | 817.960 | 794.190 | -23.770 | 5.37e-7 | 1.64e-6 | 791.69–820.46 |  |  |
| 30 | `285_elder_seriousness` | 854.360 | 833.100 | -21.260 | 9.98e-1 | 9.97e-1 | 830.60–856.86 |  |  |
| 31 | `286_fact_to_act` | 856.540 | 834.830 | -21.710 | 6.16e-3 | 1.27e-3 | 832.33–859.04 |  |  |
| 32 | `288_not_smaller` | 864.440 | 841.430 | -23.010 | 1.65e-7 | 1.77e-7 | 838.93–866.94 |  |  |
| 33 | `294_intense_thought` | 883.210 | 865.390 | -17.820 | 4.88e-8 | 1.33e-7 | 862.89–885.71 |  |  |
| 34 | `296_orderly_rotations` | 888.370 | 870.380 | -17.990 | 9.99e-1 | 9.56e-1 | 867.88–890.87 |  |  |
| 35 | `297_standard_arrangement` | 890.110 | 872.860 | -17.250 | 9.99e-1 | 6.41e-1 | 870.36–892.61 |  |  |
| 36 | `313_fen_silent_gaze` | 954.440 | 936.250 | -18.190 | 5.41e-7 | 2.82e-6 | 933.75–956.94 |  |  |
| 37 | `314_scouts_settle_down` | 957.140 | 938.510 | -18.630 | 1.72e-7 | 4.35e-7 | 936.01–959.64 |  |  |
| 38 | `352_orient_landmark` | 1088.360 | 1074.850 | -13.510 | 1.45e-6 | 3.36e-6 | 1072.35–1090.86 |  |  |
| 39 | `353_gathering_bands` | 1092.150 | 1077.740 | -14.410 | 7.52e-7 | 4.16e-6 | 1075.24–1094.65 |  |  |
| 40 | `366_missing_calm` | 1134.380 | 1127.350 | -7.030 | 2.23e-7 | 2.76e-7 | 1124.85–1136.88 |  |  |
| 41 | `390_center_fire` | 1218.570 | 1211.400 | -7.170 | 9.98e-1 | 1.00e+0 | 1208.90–1221.07 |  |  |
| 42 | `395_darets_hand` | 1240.240 | 1238.430 | -1.810 | 1.00e+0 | 2.15e-1 | 1235.93–1242.74 |  |  |
| 43 | `396_forest_yaro` | 1245.180 | 1240.960 | -4.220 | 9.75e-1 | 1.02e-1 | 1238.46–1247.68 |  |  |
| 44 | `429_night_after_night` | 1365.190 | 1365.200 | +0.010 | 9.90e-1 | 9.83e-1 | 1362.69–1367.70 |  |  |
| 45 | `444_scout_past_watch` | 1412.570 | 1413.000 | +0.430 | 1.89e-1 | 9.99e-1 | 1410.07–1415.50 |  |  |

<details><summary>Play commands and scripted text</summary>

**1. `011_shivering_by_fire`** — before 28.890, after 27.450

```bash
ffplay -autoexit -nodisp -ss 24.95 -t 6.44 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> and the fire is the only reason you are not screaming.

**2. `020_lurking_darkness`** — before 56.560, after 55.850

```bash
ffplay -autoexit -nodisp -ss 53.35 -t 5.71 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The darkness past the firelight is not empty.

**3. `038_spear_glint`** — before 111.910, after 108.550

```bash
ffplay -autoexit -nodisp -ss 106.05 -t 8.36 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The arrangement is not accidental.

**4. `040_outside_circle`** — before 119.210, after 114.640

```bash
ffplay -autoexit -nodisp -ss 112.14 -t 9.57 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are not old enough to hold a position in that shape.

**5. `049_chest_protection`** — before 146.380, after 141.850

```bash
ffplay -autoexit -nodisp -ss 139.35 -t 9.53 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> using your chest against the cold air.

**6. `056_dropping_torch`** — before 167.700, after 159.980 (ledger CORRECT value 167.700)

```bash
ffplay -autoexit -nodisp -ss 157.48 -t 12.72 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You drop the torch on the third night of your second season carrying it.

**7. `066_torch_reflection`** — before 200.160, after 192.050

```bash
ffplay -autoexit -nodisp -ss 189.55 -t 13.11 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The lesson in that touch

**8. `091_scouts_walking`** — before 272.540, after 271.460

```bash
ffplay -autoexit -nodisp -ss 268.96 -t 6.08 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Never alone.

**9. `096_smell_first`** — before 287.440, after 279.320

```bash
ffplay -autoexit -nodisp -ss 276.82 -t 13.12 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You learn to smell before you look.

**10. `128_back_to_fire`** — before 383.740, after 366.830

```bash
ffplay -autoexit -nodisp -ss 364.33 -t 21.91 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You sit with your back to the fire so your eyes can adjust fully to the dark beyond the camp’s edge.

**11. `130_discomfort_point`** — before 394.110, after 381.150

```bash
ffplay -autoexit -nodisp -ss 378.65 -t 17.96 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The discomfort is the point.

**12. `135_three_hours`** — before 401.780, after 389.390

```bash
ffplay -autoexit -nodisp -ss 386.89 -t 17.39 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Three hours at most before you are back up.

**13. `161_waste_chest`** — before 476.740, after 461.480

```bash
ffplay -autoexit -nodisp -ss 458.98 -t 20.26 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> But the waste of it stays in your chest

**14. `172_body_instinct_grip`** — before 510.450, after 495.660

```bash
ffplay -autoexit -nodisp -ss 493.16 -t 19.79 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The body knows before the mind agrees.

**15. `181_aurochs_drive`** — before 538.910, after 516.760

```bash
ffplay -autoexit -nodisp -ss 514.26 -t 27.15 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Your group drives a small aurochs herd toward a valley narrowing

**16. `182_breaking_aurochs`** — before 542.820, after 522.460

```bash
ffplay -autoexit -nodisp -ss 519.96 -t 25.36 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> and three animals break sideways into the trees instead of funneling through.

**17. `184_mc_running`** — before 549.910, after 530.250

```bash
ffplay -autoexit -nodisp -ss 527.75 -t 24.66 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You are one.

**18. `188_fading_light`** — before 559.040, after 536.000

```bash
ffplay -autoexit -nodisp -ss 533.50 -t 28.04 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The light is going fast.

**19. `189_heavy_timber`** — before 561.450, after 537.000

```bash
ffplay -autoexit -nodisp -ss 534.50 -t 29.45 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You push through the tree line into heavier timber and the animals are already gone ahead of you into the dark.

**20. `196_main_frozen`** — before 582.220, after 561.450

```bash
ffplay -autoexit -nodisp -ss 558.95 -t 25.77 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You do not move.

**21. `200_yaro_shifts`** — before 589.540, after 563.970

```bash
ffplay -autoexit -nodisp -ss 561.47 -t 30.57 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Then Yaro shifts his weight back

**22. `208_leader_decision`** — before 611.300, after 587.800

```bash
ffplay -autoexit -nodisp -ss 585.30 -t 28.50 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The hunt leader listens and sends nobody back.

**23. `237_heavy_weight`** — before 697.050, after 671.170

```bash
ffplay -autoexit -nodisp -ss 668.67 -t 30.88 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The weight of it is not the same as the fear from your younger years.

**24. `241_fen_young_scout`** — before 707.190, after 681.820

```bash
ffplay -autoexit -nodisp -ss 679.32 -t 30.37 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Your youngest scout is Fen.

**25. `248_stealthy_movement`** — before 727.730, after 701.780

```bash
ffplay -autoexit -nodisp -ss 699.28 -t 30.95 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Slow is about being harder to detect.

**26. `257_wordless_confirmation_scent`** — before 751.100, after 727.730

```bash
ffplay -autoexit -nodisp -ss 725.23 -t 28.37 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> that wordless confirmation that your nose had caught something real.

**27. `260_main_teaching_fen`** — before 765.860, after 743.130

```bash
ffplay -autoexit -nodisp -ss 740.63 -t 27.73 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You try to build that same room for Fen.

**28. `268_morning_visitor`** — before 803.380, after 775.680

```bash
ffplay -autoexit -nodisp -ss 773.18 -t 32.70 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> That reaches you one morning when a girl of about nine walks to you at the fire’s edge

**29. `272_hunched_back`** — before 817.960, after 794.190

```bash
ffplay -autoexit -nodisp -ss 791.69 -t 28.77 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> Your back has decades stored in it.

**30. `285_elder_seriousness`** — before 854.360, after 833.100

```bash
ffplay -autoexit -nodisp -ss 830.60 -t 26.26 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You explain that it is not.

**31. `286_fact_to_act`** — before 856.540, after 834.830 (ledger CORRECT value 856.520)

```bash
ffplay -autoexit -nodisp -ss 832.33 -t 26.71 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> It is a fact he needs to act on

**32. `288_not_smaller`** — before 864.440, after 841.430

```bash
ffplay -autoexit -nodisp -ss 838.93 -t 28.01 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> not smaller.

**33. `294_intense_thought`** — before 883.210, after 865.390

```bash
ffplay -autoexit -nodisp -ss 862.89 -t 22.82 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You go back through every decision of that night.

**34. `296_orderly_rotations`** — before 888.370, after 870.380

```bash
ffplay -autoexit -nodisp -ss 867.88 -t 22.99 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The rotations were right.

**35. `297_standard_arrangement`** — before 890.110, after 872.860

```bash
ffplay -autoexit -nodisp -ss 870.36 -t 22.25 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> The arrangement was what it has always been.

**36. `313_fen_silent_gaze`** — before 954.440, after 936.250

```bash
ffplay -autoexit -nodisp -ss 933.75 -t 23.19 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> He does not ask you to teach them anything.

**37. `314_scouts_settle_down`** — before 957.140, after 938.510

```bash
ffplay -autoexit -nodisp -ss 936.01 -t 23.63 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> He places them near you and you understand what he is asking.

**38. `352_orient_landmark`** — before 1088.360, after 1074.850

```bash
ffplay -autoexit -nodisp -ss 1072.35 -t 18.51 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> A feature of the world that people orient by.

**39. `353_gathering_bands`** — before 1092.150, after 1077.740

```bash
ffplay -autoexit -nodisp -ss 1075.24 -t 19.41 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> When the bands gather and the talk turns to the night

**40. `366_missing_calm`** — before 1134.380, after 1127.350

```bash
ffplay -autoexit -nodisp -ss 1124.85 -t 12.03 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You tell them the calm they see was not always there.

**41. `390_center_fire`** — before 1218.570, after 1211.400

```bash
ffplay -autoexit -nodisp -ss 1208.90 -t 12.17 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You sit at the center fire on long winter nights when the band is settled deep in the valley and the cold has pulled everything close.

**42. `395_darets_hand`** — before 1240.240, after 1238.430

```bash
ffplay -autoexit -nodisp -ss 1235.93 -t 6.81 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You describe what Daret’s hand felt like on your shoulder and what it meant.

**43. `396_forest_yaro`** — before 1245.180, after 1240.960

```bash
ffplay -autoexit -nodisp -ss 1238.46 -t 9.22 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> You describe the three seconds in the forest with Yaro when something in the dark made a choice.

**44. `429_night_after_night`** — before 1365.190, after 1365.200

```bash
ffplay -autoexit -nodisp -ss 1362.69 -t 5.01 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> night after night

**45. `444_scout_past_watch`** — before 1412.570, after 1413.000

```bash
ffplay -autoexit -nodisp -ss 1410.07 -t 5.43 "/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a"
```

> They always have.

</details>

## 173 — 43 rows

### 1. The five open defects — did S2 move them, and in which direction?

| # | scene tag | before | after | delta | conf before | conf after | listening window | verdict | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `lethal_nature_hazard` | 18.510 | 19.230 | +0.720 | 9.66e-1 | 9.94e-1 | 16.01–21.73 |  |  |
| 2 | `gadget_decay` | 427.480 | 427.470 | -0.010 | 9.59e-1 | 9.47e-1 | 424.97–429.98 |  |  |

<details><summary>Play commands and scripted text</summary>

**1. `lethal_nature_hazard`** — before 18.510, after 19.230 (ledger CORRECT value 19.270)

```bash
ffplay -autoexit -nodisp -ss 16.01 -t 5.72 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> because the environment was already doing the killing before the enemy showed up.

**2. `gadget_decay`** — before 427.480, after 427.470 (ledger CORRECT value 427.600)

```bash
ffplay -autoexit -nodisp -ss 424.97 -t 5.01 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> requires specialized instruments that themselves degrade the deeper in you go.

</details>

### 2. Ear-verified controls that MOVED — a verdict of BEFORE on any of these is a regression

| # | scene tag | before | after | delta | conf before | conf after | listening window | verdict | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `abysmal_opinion` | 17.880 | 18.510 | +0.630 | 1.58e-2 | 2.98e-3 | 15.38–21.01 |  |  |
| 2 | `wall_split_path` | 162.460 | 162.450 | -0.010 | 9.98e-1 | 9.97e-1 | 159.95–164.96 |  |  |
| 3 | `vessel_damage_clue` | 172.910 | 174.740 | +1.830 | 1.37e-5 | 9.98e-1 | 170.41–177.24 |  |  |
| 4 | `rapid_skirmish_clash` | 348.930 | 353.920 | +4.990 | 1.00e+0 | 5.58e-7 | 346.43–356.42 |  |  |
| 5 | `explosive_focus` | 399.290 | 409.910 | +10.620 | 1.00e+0 | 4.33e-4 | 396.79–412.41 |  |  |
| 6 | `logic_clash` | 418.140 | 421.550 | +3.410 | 9.99e-1 | 2.07e-7 | 415.64–424.05 |  |  |

<details><summary>Play commands and scripted text</summary>

**1. `abysmal_opinion`** — before 17.880, after 18.510 (ledger CORRECT value 17.880)

```bash
ffplay -autoexit -nodisp -ss 15.38 -t 5.63 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> They’re the worst

**2. `wall_split_path`** — before 162.460, after 162.450 (ledger CORRECT value 162.460)

```bash
ffplay -autoexit -nodisp -ss 159.95 -t 5.01 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> directions in rooms separated by a single bulkhead.

**3. `vessel_damage_clue`** — before 172.910, after 174.740 (ledger CORRECT value 174.740)

```bash
ffplay -autoexit -nodisp -ss 170.41 -t 6.83 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> of whatever the last crew left behind, which includes whatever finished them.

**4. `rapid_skirmish_clash`** — before 348.930, after 353.920 (ledger CORRECT value 348.930)

```bash
ffplay -autoexit -nodisp -ss 346.43 -t 9.99 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> not a question anyone fighting inside has time to settle.

**5. `explosive_focus`** — before 399.290, after 409.910 (ledger CORRECT value 399.290)

```bash
ffplay -autoexit -nodisp -ss 396.79 -t 15.62 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> and treating the structure as a demolition target instead.

**6. `logic_clash`** — before 418.140, after 421.550 (ledger CORRECT value 418.140)

```bash
ffplay -autoexit -nodisp -ss 415.64 -t 8.41 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> governing material reality are contested in ways standard military planning doesn’t account for.

</details>

### 3. Incoming FA confidence changed by >1 order of magnitude

| # | scene tag | before | after | delta | conf before | conf after | listening window | verdict | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `ancient_training_grounds` | 24.930 | 30.060 | +5.130 | 9.99e-1 | 4.19e-6 | 22.43–32.56 |  |  |
| 2 | `historical_visual` | 30.060 | 32.190 | +2.130 | 6.11e-6 | 1.85e-4 | 27.56–34.69 |  |  |
| 3 | `sight_blur` | 52.190 | 54.330 | +2.140 | 9.76e-1 | 5.23e-6 | 49.69–56.83 |  |  |
| 4 | `signal_static_frustration` | 54.330 | 55.130 | +0.800 | 9.99e-1 | 7.30e-7 | 51.83–57.63 |  |  |
| 5 | `vicious_growth` | 80.300 | 86.250 | +5.950 | 1.00e+0 | 1.84e-5 | 77.80–88.75 |  |  |
| 6 | `danger_soil` | 86.250 | 88.570 | +2.320 | 1.01e-1 | 1.52e-5 | 83.75–91.07 |  |  |
| 7 | `fatal_acceptance` | 218.480 | 220.640 | +2.160 | 9.94e-1 | 3.71e-7 | 215.98–223.14 |  |  |
| 8 | `trench_siege` | 222.390 | 223.970 | +1.580 | 1.00e+0 | 2.77e-7 | 219.89–226.47 |  |  |
| 9 | `hazard_fluid` | 261.110 | 266.510 | +5.400 | 9.96e-1 | 1.49e-6 | 258.61–269.01 |  |  |
| 10 | `liquid_hazard` | 266.510 | 269.260 | +2.750 | 1.00e+0 | 1.16e-5 | 264.01–271.76 |  |  |
| 11 | `ground_morph` | 291.370 | 295.570 | +4.200 | 7.35e-8 | 3.17e-5 | 288.87–298.07 |  |  |
| 12 | `unstable_land` | 295.570 | 296.720 | +1.150 | 3.55e-1 | 1.45e-2 | 293.07–299.22 |  |  |
| 13 | `unnatural_fungi_inspection` | 296.720 | 297.950 | +1.230 | 9.96e-1 | 3.83e-5 | 294.22–300.45 |  |  |
| 14 | `strategy_predetermined` | 317.780 | 321.950 | +4.170 | 9.99e-1 | 1.01e-3 | 315.28–324.45 |  |  |
| 15 | `ancient_structure` | 320.840 | 325.360 | +4.520 | 1.00e+0 | 1.01e-6 | 318.34–327.86 |  |  |
| 16 | `ancient_mechanical_lure` | 323.930 | 326.520 | +2.590 | 9.99e-1 | 2.38e-4 | 321.43–329.02 |  |  |
| 17 | `glitch_check` | 345.380 | 352.500 | +7.120 | 3.55e-7 | 1.41e-3 | 342.88–355.00 |  |  |
| 18 | `recovery_formation` | 352.500 | 355.750 | +3.250 | 9.97e-1 | 1.65e-7 | 350.00–358.25 |  |  |
| 19 | `distinctive_property_highlight` | 355.750 | 356.270 | +0.520 | 9.10e-1 | 6.73e-7 | 353.25–358.77 |  |  |
| 20 | `architectural_pivot` | 373.540 | 381.190 | +7.650 | 9.93e-1 | 2.62e-6 | 371.04–383.69 |  |  |
| 21 | `tactical_bypass` | 393.180 | 400.880 | +7.700 | 3.38e-7 | 2.44e-5 | 390.68–403.38 |  |  |
| 22 | `vicious_wilds` | 403.140 | 411.560 | +8.420 | 7.78e-1 | 2.89e-4 | 400.64–414.06 |  |  |
| 23 | `heavy_effort` | 406.760 | 417.150 | +10.390 | 1.64e-7 | 6.51e-3 | 404.26–419.65 |  |  |
| 24 | `void_guardian_watch` | 411.560 | 418.390 | +6.830 | 5.63e-8 | 6.96e-3 | 409.06–420.89 |  |  |
| 25 | `void_boundary` | 413.690 | 419.810 | +6.120 | 2.64e-1 | 1.34e-5 | 411.19–422.31 |  |  |
| 26 | `shirking_foundation` | 444.960 | 447.970 | +3.010 | 1.00e+0 | 8.33e-7 | 442.46–450.47 |  |  |
| 27 | `routine_protocol` | 492.370 | 497.480 | +5.110 | 9.96e-1 | 1.75e-3 | 489.87–499.98 |  |  |
| 28 | `extraordinary_divide` | 497.480 | 499.970 | +2.490 | 9.89e-1 | 9.11e-3 | 494.98–502.47 |  |  |
| 29 | `perilous_overpass_doom` | 520.580 | 522.270 | +1.690 | 1.00e+0 | 2.75e-6 | 518.08–524.77 |  |  |
| 30 | `mystic_corridor` | 524.330 | 526.450 | +2.120 | 9.96e-1 | 5.98e-5 | 521.83–528.95 |  |  |
| 31 | `strange_fate_occurs` | 548.650 | 551.720 | +3.070 | 9.95e-1 | 1.17e-3 | 546.15–554.22 |  |  |
| 32 | `chaotic_rot_witness` | 553.430 | 556.270 | +2.840 | 9.95e-1 | 2.26e-5 | 550.93–558.77 |  |  |
| 33 | `chronal_drift` | 572.840 | 579.710 | +6.870 | 1.00e+0 | 3.69e-5 | 570.34–582.21 |  |  |

<details><summary>Play commands and scripted text</summary>

**1. `ancient_training_grounds`** — before 24.930, after 30.060

```bash
ffplay -autoexit -nodisp -ss 22.43 -t 10.13 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Before Catachan produced the Imperium’s most capable baseline human soldiers,

**2. `historical_visual`** — before 30.060, after 32.190

```bash
ffplay -autoexit -nodisp -ss 27.56 -t 7.13 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> the planet had a simpler reputation.

**3. `sight_blur`** — before 52.190, after 54.330

```bash
ffplay -autoexit -nodisp -ss 49.69 -t 7.14 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Optical scopes fog permanently.

**4. `signal_static_frustration`** — before 54.330, after 55.130

```bash
ffplay -autoexit -nodisp -ss 51.83 -t 5.80 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> The canopy generates a biological electrical field that jams vox-casters,

**5. `vicious_growth`** — before 80.300, after 86.250

```bash
ffplay -autoexit -nodisp -ss 77.80 -t 10.95 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Strangler plants drop tendrils that sever limbs before the soldier registers contact.

**6. `danger_soil`** — before 86.250, after 88.570

```bash
ffplay -autoexit -nodisp -ss 83.75 -t 7.32 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Miral land sharks track ground vibration.

**7. `fatal_acceptance`** — before 218.480, after 220.640

```bash
ffplay -autoexit -nodisp -ss 215.98 -t 7.16 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> That’s the best available outcome and everyone going in knows it.

**8. `trench_siege`** — before 222.390, after 223.970

```bash
ffplay -autoexit -nodisp -ss 219.89 -t 6.58 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Number Four, Vraks.

**9. `hazard_fluid`** — before 261.110, after 266.510

```bash
ffplay -autoexit -nodisp -ss 258.61 -t 10.40 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> The Chaos-aligned defenders added persistent acidic chemical compounds to that problem,

**10. `liquid_hazard`** — before 266.510, after 269.260

```bash
ffplay -autoexit -nodisp -ss 264.01 -t 7.75 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> agents that pooled in low ground, degraded respirator seals over extended exposure, and corrupted the soil chemistry across entire operating sectors.

**11. `ground_morph`** — before 291.370, after 295.570

```bash
ffplay -autoexit -nodisp -ss 288.87 -t 9.20 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> After seventeen years of that, the battlefield substrate changed.

**12. `unstable_land`** — before 295.570, after 296.720

```bash
ffplay -autoexit -nodisp -ss 293.07 -t 6.15 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> The soil churned.

**13. `unnatural_fungi_inspection`** — before 296.720, after 297.950

```bash
ffplay -autoexit -nodisp -ss 294.22 -t 6.23 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Contaminated zones developed biological properties that had no business being there.

**14. `strategy_predetermined`** — before 317.780, after 321.950

```bash
ffplay -autoexit -nodisp -ss 315.28 -t 9.17 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> It was built into the calculation from the start.

**15. `ancient_structure`** — before 320.840, after 325.360

```bash
ffplay -autoexit -nodisp -ss 318.34 -t 9.52 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Number Three, Necron Tomb Complexes.

**16. `ancient_mechanical_lure`** — before 323.930, after 326.520

```bash
ffplay -autoexit -nodisp -ss 321.43 -t 7.59 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> A Necron tomb world has been a trap for several million years.

**17. `glitch_check`** — before 345.380, after 352.500

```bash
ffplay -autoexit -nodisp -ss 342.88 -t 12.12 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Whether that’s a sensor artifact or accurate data is

**18. `recovery_formation`** — before 352.500, after 355.750

```bash
ffplay -autoexit -nodisp -ss 350.00 -t 8.25 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> The defenders reassemble after being destroyed.

**19. `distinctive_property_highlight`** — before 355.750, after 356.270

```bash
ffplay -autoexit -nodisp -ss 353.25 -t 5.52 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> That single feature separates this from every other hostile environment on this list.

**20. `architectural_pivot`** — before 373.540, after 381.190

```bash
ffplay -autoexit -nodisp -ss 371.04 -t 12.65 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> The structure itself continuously reconfigures around the intrusion, sealing corridors, shifting gravity orientations, cycling through

**21. `tactical_bypass`** — before 393.180, after 400.880

```bash
ffplay -autoexit -nodisp -ss 390.68 -t 12.70 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> The only thing that worked was abandoning the model of fighting through an enemy position entirely

**22. `vicious_wilds`** — before 403.140, after 411.560

```bash
ffplay -autoexit -nodisp -ss 400.64 -t 13.42 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> The environment didn’t stop being hostile after that decision.

**23. `heavy_effort`** — before 406.760, after 417.150

```bash
ffplay -autoexit -nodisp -ss 404.26 -t 15.39 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> It just became a problem with a physical solution rather than a tactical one.

**24. `void_guardian_watch`** — before 411.560, after 418.390

```bash
ffplay -autoexit -nodisp -ss 409.06 -t 11.83 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Number Two, Cadian Space.

**25. `void_boundary`** — before 413.690, after 419.810

```bash
ffplay -autoexit -nodisp -ss 411.19 -t 11.12 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Cadia sits at the edge of a permanent spatial rupture where the laws

**26. `shirking_foundation`** — before 444.960, after 447.970

```bash
ffplay -autoexit -nodisp -ss 442.46 -t 8.01 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> For ground forces during active incursions, the problem is reality as an unreliable physical substrate.

**27. `routine_protocol`** — before 492.370, after 497.480

```bash
ffplay -autoexit -nodisp -ss 489.87 -t 10.11 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> They treated it as standard operating parameters rather than emergency conditions.

**28. `extraordinary_divide`** — before 497.480, after 499.970

```bash
ffplay -autoexit -nodisp -ss 494.98 -t 7.49 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> That gap between a force that had normalized the impossible

**29. `perilous_overpass_doom`** — before 520.580, after 522.270

```bash
ffplay -autoexit -nodisp -ss 518.08 -t 6.69 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Nobody has survived losing control of that crossing.

**30. `mystic_corridor`** — before 524.330, after 526.450

```bash
ffplay -autoexit -nodisp -ss 521.83 -t 7.12 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> The Warp enables faster-than-light travel.

**31. `strange_fate_occurs`** — before 548.650, after 551.720

```bash
ffplay -autoexit -nodisp -ss 546.15 -t 8.07 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> The crew doesn’t die the way crews die when life support fails.

**32. `chaotic_rot_witness`** — before 553.430, after 556.270

```bash
ffplay -autoexit -nodisp -ss 550.93 -t 7.84 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> The deterioration comes from outside in and doesn’t follow a sequence anyone has successfully predicted.

**33. `chronal_drift`** — before 572.840, after 579.710

```bash
ffplay -autoexit -nodisp -ss 570.34 -t 11.87 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Time becomes operationally non-linear: vessels have exited transit weeks before they entered,

</details>

### 4. Remaining moved-without-evidence set

| # | scene tag | before | after | delta | conf before | conf after | listening window | verdict | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `gloomy_hollow` | 89.460 | 89.700 | +0.240 | 1.00e+0 | 1.00e+0 | 86.96–92.20 |  |  |
| 2 | `duration_recollection` | 223.970 | 224.270 | +0.300 | 1.00e+0 | 2.14e-1 | 221.47–226.77 |  |  |

<details><summary>Play commands and scripted text</summary>

**1. `gloomy_hollow`** — before 89.460, after 89.700

```bash
ffplay -autoexit -nodisp -ss 86.96 -t 5.24 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Every shadow has been occupying it longer than any patrol has been searching it.

**2. `duration_recollection`** — before 223.970, after 224.270

```bash
ffplay -autoexit -nodisp -ss 221.47 -t 5.30 "/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a"
```

> Seventeen years.

</details>

## Counts

- total rows: **372**
- open-defect: 5
- control-moved: 35
- confidence-jump: 285
- no-evidence: 47
