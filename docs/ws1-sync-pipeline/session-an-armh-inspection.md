# WS1 Session AN Step 3 — arm H chunk inspection (MEASURED, v6, no FA run)

One-group-wider anchor search, tried ONLY at seams arm F's own two-group window could not resolve.
Base is ARM F, not arm C.

## The claims that make this one variable from arm F

| claim | result |
|---|---|
| `{ kind: 'silence' }` still reproduces `computeFaChunkPlanS2Excised` exactly | **true** |
| arm B still reproduces `fa_ai_chunks.json` at HEAD | **true** |
| arm C still reproduces `fa_ak_chunks.json` at HEAD | **true** |
| arm F still reproduces `fa_am_f_chunks.json` at HEAD | **true** |
| arm H text equals arm F text word for word | **true** (asserted) |

## The five fallback seams, individually resolved or not

| closing seg | arm-F chunk | resolved in H? | via widened window? | Δqi | anchor qi | arm F cut | arm H cut | Δ (s) | reason if unresolved |
|---|---|---|---|---|---|---|---|---|---|
| 100 | 11 | **YES** | YES | -9 | 812 | 299.080 | 302.540 | 3.46 | — |
| 171 | 19 | **YES** | YES | -11 | 1366 | 498.520 | 508.260 | 9.74 | — |
| 235 | 26 | **YES** | YES | 15 | 1865 | 671.480 | 701.580 | 30.1 | — |
| 295 | 34 | **YES** | YES | -7 | 2389 | 873.360 | 886.500 | 13.14 | — |
| 373 | 45 | **YES** | YES | 12 | 3167 | 1151.620 | 1162.900 | 11.28 | — |

**5 of 5 fallback seams resolved to an admissible anchor under the widened window.**

## Edge census — how each internal edge was actually placed

| cut kind | count |
|---|---|
| `anchor` | 42 |
| `excision-run-edge` | 9 |
| `anchor-widened` | 5 |
| `corpus-end` | 1 |

## Conservation properties — did either fire at this band?

- **TEXT carry-forward on a collapsed window: DID NOT FIRE.**
- **TIME monotone cursor: holds — true.**

## The complete violation list (not a summary)

Total violation events: **10** (arm F had 16).

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

