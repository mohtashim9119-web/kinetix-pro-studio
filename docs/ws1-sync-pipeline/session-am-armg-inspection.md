# WS1 Session AM Step 4 — arm G, the oracle-placed ceiling (MEASURED, v6, no FA run)

> ## *** DIAGNOSTIC ONLY. ARM G CAN NEVER SHIP. ***
>
> This arm places chunk edges at the AJ-0 oracle's own attested boundary times. It CONSUMES
> GROUND TRUTH. No result it produces — including a good one — makes it a shipping candidate,
> and the session gate's SUCCESS BAR and SHIP CAP are deliberately NOT applied to it, because
> applying a ship gate to an unshippable arm would be theatre. Its single job is to answer:
> **if chunk edges were perfect, would the arch go away?**

## Unreachability from production — checked, not asserted

| condition | result |
|---|---|
| files under `src/` that read the oracle fixture | **0** |
| files under `src/` that CONSTRUCT the attested placement (object literal supplying the table) | **0** |
| files under `src/` that mention the discriminant at all | 1 (`src/services/faChunkPlan.ts` — the declaration and branch site, asserted to be the only one) |
| `src/` files scanned | 229 |
| attested table has a default value | **no — required field** |

The required-field construction is what makes this structural rather than conventional: an arm-G
plan is unconstructible without a caller that already holds every one of the 447 oracle values
and passes them in explicitly. Nothing inside the app can supply one.

## How the 447 oracle values map onto permitted sentence-group ends

| quantity | value |
|---|---|
| oracle boundaries | 447 (one per segment, indices contiguous) |
| segments that can OPEN a chunk (group firsts, excluding the corpus's first) | 367 |
| of those, with an attested oracle time | **367** |
| of those, WITHOUT one | **0** |
| of those, whose oracle value is itself an OPEN DEFECT | **2** |

**Where a group end has no oracle boundary: this never happens on v6.** The oracle carries one
boundary per segment index and the indices are contiguous, so the seam -> attested-time mapping
is TOTAL. The `no-attested-time` violation path exists in the planner as a correctness guard and
fired 0 times here.

## Is the mapping lossy? Yes, in one specific and stateable way.

It is not lossy in COVERAGE — every seam gets a time. It is lossy in TRUTH, on exactly three
rows. 3 of the 447 oracle values are v6's OPEN DEFECTS, and for those the oracle stores the
DEFECTIVE production value, not the ear target:

| tag | oracle (stored) | ear target | error carried |
|---|---|---|---|
| `214_solitary_fire` | 629.01 | 630.09 | -1.08s |
| `231_slowing_pace` | 681.63 | 682.74 | -1.11s |
| `447_scout_facing_dark` | 1417.12 | 1418.53 | -1.41s |

**Did any chunk seam actually land on one of those three rows? **NO — zero of them.****

So arm G's edges are attested-correct on every seam it actually uses, and the three defective
values never enter the plan. The ceiling is therefore worth its full face value on v6 — stated
as a measurement, not as a hope, and it could easily have gone the other way.

A second, weaker caveat, stated rather than buried: an oracle value is production's own COMMITTED
boundary after the full rule stage, not an independent physical measurement. It is the project's
ground truth and 444 of its 447 rows are ear-verified, but "perfect" here means "matches the
ear-verified live export", not "matches the acoustic waveform".

## Edge census

| cut kind | count |
|---|---|
| `attested` | 47 |
| `excision-run-edge` | 9 |
| `corpus-end` | 1 |

## Distribution and how far the edges actually moved

- n **57** | min 1.3s | p25 23.19s | **median 25.96s** | p75 29.13s | max 35.63s | mean 24.209s | over cap 10
- `|attested cut − estimate ideal|` over the 47 attested edges: min 0.040s | median 11.562s | max 25.252s
- signed: 42 positive, 5 negative

## Conservation properties

- TEXT carry-forward on a collapsed window: DID NOT FIRE
- TIME monotone cursor: holds — true

## The complete violation list

Total: **10**.

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

## Every chunk

| # | start | end | dur | cut | ideal | Δideal | segs | >cap |
|---|---|---|---|---|---|---|---|---|
| 0 | 3.570 | 36.290 | 32.720 | attested | 31.338 | +4.952 | 0-12 | **YES** |
| 1 | 36.290 | 65.770 | 29.480 | attested | 61.130 | +4.640 | 13-21 |  |
| 2 | 65.770 | 93.130 | 27.360 | attested | 88.182 | +4.948 | 22-30 |  |
| 3 | 93.130 | 122.640 | 29.510 | attested | 117.062 | +5.578 | 31-39 |  |
| 4 | 122.640 | 125.250 | 2.610 | excision-run-edge | 120.927 | +4.323 | 40-40 |  |
| 5 | 129.150 | 154.590 | 25.440 | attested | 147.206 | +7.384 | 41-50 |  |
| 6 | 154.590 | 181.730 | 27.140 | attested | 175.945 | +5.785 | 51-57 |  |
| 7 | 181.730 | 211.740 | 30.010 | attested | 204.683 | +7.057 | 58-69 | **YES** |
| 8 | 211.740 | 237.760 | 26.020 | attested | 231.806 | +5.954 | 70-79 |  |
| 9 | 237.760 | 249.500 | 11.740 | excision-run-edge | 243.821 | +5.679 | 80-83 |  |
| 10 | 253.320 | 283.640 | 30.320 | attested | 275.019 | +8.621 | 84-93 | **YES** |
| 11 | 283.640 | 306.420 | 22.780 | attested | 297.997 | +8.423 | 94-100 |  |
| 12 | 306.420 | 336.190 | 29.770 | attested | 327.788 | +8.402 | 101-109 |  |
| 13 | 336.190 | 368.450 | 32.260 | attested | 356.037 | +12.413 | 110-122 | **YES** |
| 14 | 368.450 | 369.750 | 1.300 | excision-run-edge | 358.215 | +11.535 | 123-123 |  |
| 15 | 373.490 | 404.670 | 31.180 | attested | 390.467 | +14.203 | 124-134 | **YES** |
| 16 | 404.670 | 437.220 | 32.550 | attested | 419.839 | +17.381 | 135-147 | **YES** |
| 17 | 437.220 | 463.370 | 26.150 | attested | 446.891 | +16.479 | 148-155 |  |
| 18 | 463.370 | 486.980 | 23.610 | attested | 472.749 | +14.231 | 156-163 |  |
| 19 | 486.980 | 513.460 | 26.480 | attested | 499.872 | +13.588 | 164-171 |  |
| 20 | 513.460 | 521.250 | 7.790 | excision-run-edge | 507.391 | +13.859 | 172-174 |  |
| 21 | 525.820 | 561.450 | 35.630 | attested | 539.153 | +22.297 | 175-187 | **YES** |
| 22 | 561.450 | 589.540 | 28.090 | attested | 565.925 | +23.615 | 188-198 |  |
| 23 | 589.540 | 615.940 | 26.400 | attested | 592.837 | +23.103 | 199-208 |  |
| 24 | 615.940 | 641.230 | 25.290 | attested | 621.787 | +19.443 | 209-215 |  |
| 25 | 641.230 | 663.630 | 22.400 | excision-run-edge | 644.271 | +19.359 | 216-222 |  |
| 26 | 666.610 | 697.050 | 30.440 | attested | 672.660 | +24.390 | 223-235 | **YES** |
| 27 | 697.050 | 721.930 | 24.880 | attested | 696.901 | +25.029 | 236-244 |  |
| 28 | 721.930 | 747.380 | 25.450 | attested | 722.128 | +25.252 | 245-254 |  |
| 29 | 747.380 | 770.600 | 23.220 | attested | 747.775 | +22.825 | 255-260 |  |
| 30 | 770.600 | 787.850 | 17.250 | excision-run-edge | 766.395 | +21.455 | 261-264 |  |
| 31 | 791.940 | 820.310 | 28.370 | attested | 799.139 | +21.171 | 265-271 |  |
| 32 | 820.310 | 843.500 | 23.190 | attested | 821.835 | +21.665 | 272-279 |  |
| 33 | 843.500 | 865.390 | 21.890 | attested | 843.196 | +22.194 | 280-287 |  |
| 34 | 865.390 | 890.110 | 24.720 | attested | 871.161 | +18.949 | 288-295 |  |
| 35 | 890.110 | 916.070 | 25.960 | attested | 899.338 | +16.732 | 296-302 |  |
| 36 | 916.070 | 924.500 | 8.430 | excision-run-edge | 909.246 | +15.254 | 303-305 |  |
| 37 | 929.330 | 957.140 | 27.810 | attested | 941.427 | +15.713 | 306-312 |  |
| 38 | 957.140 | 980.170 | 23.030 | attested | 966.020 | +14.150 | 313-319 |  |
| 39 | 980.170 | 1005.240 | 25.070 | attested | 994.056 | +11.184 | 320-325 |  |
| 40 | 1005.240 | 1035.310 | 30.070 | attested | 1022.795 | +12.515 | 326-335 | **YES** |
| 41 | 1035.310 | 1044.470 | 9.160 | excision-run-edge | 1033.194 | +11.276 | 336-338 |  |
| 42 | 1050.080 | 1079.710 | 29.630 | attested | 1066.992 | +12.718 | 339-347 |  |
| 43 | 1079.710 | 1106.380 | 26.670 | attested | 1094.818 | +11.562 | 348-356 |  |
| 44 | 1106.380 | 1130.760 | 24.380 | attested | 1123.345 | +7.415 | 357-362 |  |
| 45 | 1130.760 | 1159.890 | 29.130 | attested | 1151.311 | +8.579 | 363-373 |  |
| 46 | 1159.890 | 1188.050 | 28.160 | excision-run-edge | 1181.245 | +6.805 | 374-381 |  |
| 47 | 1192.330 | 1218.570 | 26.240 | attested | 1210.545 | +8.025 | 382-388 |  |
| 48 | 1218.570 | 1245.180 | 26.610 | attested | 1240.339 | +4.841 | 389-394 |  |
| 49 | 1245.180 | 1269.620 | 24.440 | attested | 1267.885 | +1.735 | 395-399 |  |
| 50 | 1269.620 | 1294.290 | 24.670 | attested | 1296.063 | -1.773 | 400-405 |  |
| 51 | 1294.290 | 1324.700 | 30.410 | attested | 1325.575 | -0.875 | 406-416 | **YES** |
| 52 | 1324.700 | 1340.300 | 15.600 | attested | 1340.260 | +0.040 | 417-421 |  |
| 53 | 1340.300 | 1360.470 | 20.170 | attested | 1360.708 | -0.238 | 422-425 |  |
| 54 | 1360.470 | 1384.260 | 23.790 | attested | 1384.669 | -0.409 | 426-434 |  |
| 55 | 1384.260 | 1408.760 | 24.500 | attested | 1410.317 | -1.557 | 435-441 |  |
| 56 | 1408.760 | 1421.290 | 12.530 | corpus-end | 1421.290 | +0.000 | 442-446 |  |

