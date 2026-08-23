# WS1 Session AM Step 3 — arm F chunk inspection (MEASURED, v6, no FA run)

Anchor-placed internal chunk edges. **Base is ARM C, not arm D** — the 10-30s operator-directed
band, R.5 excision ON, `s2UnbreakableGroups` atoms, net-of-excision greedy packing, all inherited
unchanged. The only line that differs is where an internal seam is cut.

## The three claims that make this one variable from arm C

| claim | result |
|---|---|
| `{ kind: 'silence' }` reproduces `computeFaChunkPlanS2Excised` exactly | **true** |
| arm B still reproduces `fa_ai_chunks.json` at HEAD | **true** |
| arm C still reproduces `fa_ak_chunks.json` at HEAD | **true** |
| arm F text equals arm C text word for word | **true** (asserted) |

The first row is the load-bearing one: the parameterised path is not merely *described* as arm C
plus an edge rule, it is *measured* to be, at the same band, on the same corpus, at this commit.

## Edge census — how each internal edge was actually placed

| cut kind | count | substituted? |
|---|---|---|
| `anchor` | 42 | **YES — anchor-placed** |
| `excision-run-edge` | 9 | no — not estimate-derived in any arm |
| `detected-silence` | 5 | no — fell back to arm C's cut |
| `corpus-end` | 1 | no — not estimate-derived in any arm |

## Distribution

- n **57** | min **2.05s** | p25 20.18s | **median 25.58s** | p75 28.98s | max **50.76s** | mean 24.209s
- chunks under 10s: **5** | chunks over 30s: **11**
- arm C's own median, MEASURED Session AL: 26.06s

## Session AL's two conservation properties — did either fire at this band?

- **TEXT carry-forward on a collapsed window: DID NOT FIRE.** The silence control fired it 0 time(s), so any difference is attributable to edge placement rather than to the shared packing.
- **TIME monotone cursor: holds — true.** No emitted window starts behind its predecessor's end.

## The complete violation list (not a summary)

Total violation events: **16**.

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

## Every chunk

| # | start | end | dur | cut | ideal | Δideal | Δqi | anchor qi | segs | >cap |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 3.570 | 34.820 | 31.250 | anchor | 31.338 | +3.482 | -2 | 86 | 0-12 | **YES** |
| 1 | 34.820 | 66.440 | 31.620 | anchor | 61.130 | +5.310 | 2 | 172 | 13-21 | **YES** |
| 2 | 66.440 | 93.600 | 27.160 | anchor | 88.182 | +5.418 | 2 | 241 | 22-30 |  |
| 3 | 93.600 | 123.200 | 29.600 | anchor | 117.062 | +6.138 | 3 | 322 | 31-39 |  |
| 4 | 123.200 | 125.250 | 2.050 | excision-run-edge | 120.927 | +4.323 | — | — | 40-40 |  |
| 5 | 129.150 | 156.100 | 26.950 | anchor | 147.206 | +8.894 | 4 | 407 | 41-50 |  |
| 6 | 156.100 | 183.180 | 27.080 | anchor | 175.945 | +7.235 | 4 | 485 | 51-57 |  |
| 7 | 183.180 | 212.160 | 28.980 | anchor | 204.683 | +7.477 | 1 | 564 | 58-69 |  |
| 8 | 212.160 | 238.400 | 26.240 | anchor | 231.806 | +6.594 | 4 | 640 | 70-79 |  |
| 9 | 238.400 | 249.500 | 11.100 | excision-run-edge | 243.821 | +5.679 | — | — | 80-83 |  |
| 10 | 253.320 | 278.900 | 25.580 | anchor | 275.019 | +3.881 | -20 | 736 | 84-93 |  |
| 11 | 278.900 | 299.080 | 20.180 | detected-silence | 297.997 | +1.083 | — | — | 94-100 |  |
| 12 | 299.080 | 336.620 | 37.540 | anchor | 327.788 | +8.832 | 2 | 906 | 101-109 | **YES** |
| 13 | 336.620 | 367.180 | 30.560 | anchor | 356.037 | +11.143 | -2 | 979 | 110-122 | **YES** |
| 14 | 367.180 | 369.750 | 2.570 | excision-run-edge | 358.215 | +11.535 | — | — | 123-123 |  |
| 15 | 373.490 | 402.060 | 28.570 | anchor | 390.467 | +11.593 | -6 | 1076 | 124-134 |  |
| 16 | 402.060 | 437.540 | 35.480 | anchor | 419.839 | +17.701 | 3 | 1162 | 135-147 | **YES** |
| 17 | 437.540 | 463.560 | 26.020 | anchor | 446.891 | +16.669 | 1 | 1229 | 148-155 |  |
| 18 | 463.560 | 485.960 | 22.400 | anchor | 472.749 | +13.211 | -1 | 1301 | 156-163 |  |
| 19 | 485.960 | 498.520 | 12.560 | detected-silence | 499.872 | -1.352 | — | — | 164-171 |  |
| 20 | 498.520 | 521.250 | 22.730 | excision-run-edge | 507.391 | +13.859 | — | — | 172-174 |  |
| 21 | 525.820 | 564.180 | 38.360 | anchor | 539.153 | +25.027 | 10 | 1493 | 175-187 | **YES** |
| 22 | 564.180 | 593.600 | 29.420 | anchor | 565.925 | +27.675 | 11 | 1567 | 188-198 |  |
| 23 | 593.600 | 616.340 | 22.740 | anchor | 592.837 | +23.503 | 1 | 1632 | 199-208 |  |
| 24 | 616.340 | 638.960 | 22.620 | anchor | 621.787 | +17.173 | -6 | 1704 | 209-215 |  |
| 25 | 638.960 | 663.630 | 24.670 | excision-run-edge | 644.271 | +19.359 | — | — | 216-222 |  |
| 26 | 666.610 | 671.480 | 4.870 | detected-silence | 672.660 | -1.180 | — | — | 223-235 |  |
| 27 | 671.480 | 722.240 | 50.760 | anchor | 696.901 | +25.339 | 1 | 1917 | 236-244 | **YES** |
| 28 | 722.240 | 751.500 | 29.260 | anchor | 722.128 | +29.372 | 14 | 2000 | 245-254 |  |
| 29 | 751.500 | 769.040 | 17.540 | anchor | 747.775 | +21.265 | -4 | 2051 | 255-260 |  |
| 30 | 769.040 | 787.850 | 18.810 | excision-run-edge | 766.395 | +21.455 | — | — | 261-264 |  |
| 31 | 791.940 | 820.560 | 28.620 | anchor | 799.139 | +21.421 | 0 | 2196 | 265-271 |  |
| 32 | 820.560 | 848.520 | 27.960 | anchor | 821.835 | +26.685 | 14 | 2271 | 272-279 |  |
| 33 | 848.520 | 865.520 | 17.000 | anchor | 843.196 | +22.324 | 1 | 2322 | 280-287 |  |
| 34 | 865.520 | 873.360 | 7.840 | detected-silence | 871.161 | +2.199 | — | — | 288-295 |  |
| 35 | 873.360 | 916.500 | 43.140 | anchor | 899.338 | +17.162 | 1 | 2467 | 296-302 | **YES** |
| 36 | 916.500 | 924.500 | 8.000 | excision-run-edge | 909.246 | +15.254 | — | — | 303-305 |  |
| 37 | 929.330 | 957.460 | 28.130 | anchor | 941.427 | +16.033 | 2 | 2583 | 306-312 |  |
| 38 | 957.460 | 980.540 | 23.080 | anchor | 966.020 | +14.520 | 2 | 2648 | 313-319 |  |
| 39 | 980.540 | 1005.820 | 25.280 | anchor | 994.056 | +11.764 | 4 | 2726 | 320-325 |  |
| 40 | 1005.820 | 1032.060 | 26.240 | anchor | 1022.795 | +9.265 | -9 | 2793 | 326-335 |  |
| 41 | 1032.060 | 1044.470 | 12.410 | excision-run-edge | 1033.194 | +11.276 | — | — | 336-338 |  |
| 42 | 1050.080 | 1078.180 | 28.100 | anchor | 1066.992 | +11.188 | -3 | 2916 | 339-347 |  |
| 43 | 1078.180 | 1111.620 | 33.440 | anchor | 1094.818 | +16.802 | 17 | 3015 | 348-356 | **YES** |
| 44 | 1111.620 | 1131.220 | 19.600 | anchor | 1123.345 | +7.875 | 2 | 3074 | 357-362 |  |
| 45 | 1131.220 | 1151.620 | 20.400 | detected-silence | 1151.311 | +0.309 | — | — | 363-373 |  |
| 46 | 1151.620 | 1188.050 | 36.430 | excision-run-edge | 1181.245 | +6.805 | — | — | 374-381 | **YES** |
| 47 | 1192.330 | 1216.640 | 24.310 | anchor | 1210.545 | +6.095 | -4 | 3316 | 382-388 |  |
| 48 | 1216.640 | 1243.900 | 27.260 | anchor | 1240.339 | +3.561 | -1 | 3402 | 389-394 |  |
| 49 | 1243.900 | 1269.920 | 26.020 | anchor | 1267.885 | +2.035 | 1 | 3483 | 395-399 |  |
| 50 | 1269.920 | 1294.640 | 24.720 | anchor | 1296.063 | -1.423 | 2 | 3566 | 400-405 |  |
| 51 | 1294.640 | 1327.240 | 32.600 | anchor | 1325.575 | +1.665 | 7 | 3651 | 406-416 | **YES** |
| 52 | 1327.240 | 1340.720 | 13.480 | anchor | 1340.260 | +0.460 | 0 | 3687 | 417-421 |  |
| 53 | 1340.720 | 1361.080 | 20.360 | anchor | 1360.708 | +0.372 | 3 | 3741 | 422-425 |  |
| 54 | 1361.080 | 1384.620 | 23.540 | anchor | 1384.669 | -0.049 | 1 | 3801 | 426-434 |  |
| 55 | 1384.620 | 1409.120 | 24.500 | anchor | 1410.317 | -1.197 | 2 | 3871 | 435-441 |  |
| 56 | 1409.120 | 1421.290 | 12.170 | corpus-end | 1421.290 | +0.000 | — | — | 442-446 |  |

