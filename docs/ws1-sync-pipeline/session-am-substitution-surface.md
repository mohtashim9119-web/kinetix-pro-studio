# WS1 Session AM Step 2 — the anchor substitution surface (MEASURED, v6, no FA run)

Computed at HEAD from `computeS2SeamSurface`, which reuses `computeRunContext` unchanged — so
every anchor below is bit-for-bit the anchor production's own `runQiRanges` would use. No audio
was aligned to produce this table.

## The tolerance, imported from the Step 1 gate (committed as its own SHA before this file existed)

```json
{
  "space": "script-word index (qi)",
  "rule": "nearest anchor by |anchor.qi - seamQi|, admissible only within the two sentence groups the seam separates",
  "tieBreak": "on equal |Δqi|, prefer qi >= seamQi",
  "numericConstants": 0,
  "label": "GEOMETRIC (structural — derived from the planner's own group atoms; no millisecond radius, no tunable)"
}
```

**Label: GEOMETRIC (structural — derived from the planner's own group atoms; no millisecond radius, no tunable).** It carries 0 numeric constants,
so there is nothing in it that could have been fitted to a corpus row.

## 1. The anchor set

| quantity | value |
|---|---|
| total anchors `faAnchors.ts` emits for v6 | **325** |
| of those, carrying THREE-SOURCE AGREEMENT | **325** |
| script words (`totalQi`) | 3900 |
| sentence groups | 368 |
| group ends a chunk edge may fall at | 367 |
| anchor qi strictly ascending | true |
| anchor qi non-descending | true |
| anchor times non-descending | true |

Run-partition boundary provenance census: `{"agreed-anchor":325,"corpus-end":1}`. A
`forced-split-*` boundary is NOT an anchor and is never counted as one.

**Why the two anchor counts are equal is a code-path fact, not a coincidence.** `computeAnchors`
emits an anchor only when all three sources agree: the Hirschberg op is a `match` (script agrees
with the Whisper token), the token is R-O-distinctive inside a match run of at least
`RUN_SURVIVAL_MIN_RUN_LONG`, AND a detected silence spans the token seam immediately before it
(R.1(c) + I6). There is no weaker-provenance anchor in the array to filter out — so
"how many carry three-source agreement" is answered by construction.

## 2. Per-group-end coverage — every seam the planner may break at

| quantity | value |
|---|---|
| group ends examined | 367 |
| with an ADMISSIBLE anchor (inside the two-group window) | **314** (85.6%) |
| of those, an EXACT hit (Δqi = 0 — the anchor IS the seam) | **28** (7.6% of all group ends) |
| with NO admissible anchor | 53 |

### |anchor − estimate| at the covered group ends, in milliseconds

REPORTED ONLY. This quantity is never a decision input — arm F selects by |Δqi|, never by this.
It is here to size how far the substitution actually moves an edge.

| distribution | n | min | p25 | median | p75 | max | mean |
|---|---|---|---|---|---|---|---|
| `|anchor − estimate|` (ms) | 314 | 49 | 5451 | **11143** | 18089 | 29372 | 11915 |
| `|arm C silence cut − estimate|` (ms), same seams | 367 | 3 | 264 | **622** | 1153 | 2554 | 748.9 |

Signed `anchor − estimate`: 30 negative, 284 positive, 0 exactly zero.
Index distance `|Δqi|`: `{"n":314,"min":0,"p25":1,"median":2,"p75":5,"max":20,"mean":3.9}`.

## 3. Coverage and fallback over the edges ARM F WILL ACTUALLY PLACE

The denominator that matters is arm C's own internal chunk edges, not all group ends — arm C
emits 57 chunks and therefore 56 internal edges, against 367 group ends.
Conflating the two would flatter the coverage number by an order of magnitude.

| edge kind | count | substituted by arm F? |
|---|---|---|
| `silence-cut` | 47 | yes, where an admissible anchor exists |
| `excision-run-edge` | 9 | NO — not estimate-derived; left exactly as arm C places it |

| quantity | value |
|---|---|
| internal chunk edges | 56 |
| substitutable (estimate-derived silence cuts) | 47 |
| **actually substituted with an anchor** | **42** |
| fell back to arm C's silence cut | 5 |
| **fallback rate over ALL internal edges** | **25.0%** |
| fallback rate over substitutable edges only | 10.6% |

**THE FALLBACK RULE, stated:** where no anchor is admissible for a seam, arm F commits ARM C's
OWN cut — `s2NearestSilenceCut` against the estimate-derived ideal seam. That edge is therefore
not substituted at all and remains an arm-C edge. Nothing is invented and nothing is dropped.

**PARTIAL-SUBSTITUTION VERDICT, against the pre-registered one-third line: arm F is NOT a partial substitution.**

## 4. The front-loading confound

Registered in Step 1 before the anchor set was looked at: a FRONT-LOADED anchor set — dense
early, sparse mid-corpus — would produce an arch BY ITSELF out of its own fallback pattern, and
would make a surviving arch uninterpretable. It is a confound, not a fix.

| decile | anchors | group ends | group ends with an anchor | coverage |
|---|---|---|---|---|
| 0 | 30 | 42 | 34 | 81.0% |
| 1 | 30 | 41 | 34 | 82.9% |
| 2 | 23 | 43 | 35 | 81.4% |
| 3 | 27 | 40 | 33 | 82.5% |
| 4 | 29 | 41 | 33 | 80.5% |
| 5 | 34 | 30 | 26 | 86.7% |
| 6 | 43 | 34 | 32 | 94.1% |
| 7 | 40 | 34 | 29 | 85.3% |
| 8 | 30 | 29 | 26 | 89.7% |
| 9 | 39 | 33 | 32 | 97.0% |

Mean anchors per decile: 32.5. Uniformity threshold (pre-registered): every
decile must hold at least 50% of the mean.

**VERDICT: the anchor set is UNIFORM along the timeline.** No decile falls below the threshold, so the anchor set cannot manufacture an arch of its own.

## Appendix — every substitutable internal edge, with its pick

| chunk | closing seg | edge kind | anchor? | Δqi | anchor − estimate (ms) |
|---|---|---|---|---|---|
| 0 | 12 | `silence-cut` | YES | -2 | 3482 |
| 1 | 21 | `silence-cut` | YES | 2 | 5310 |
| 2 | 30 | `silence-cut` | YES | 2 | 5418 |
| 3 | 39 | `silence-cut` | YES | 3 | 6138 |
| 4 | 40 | `excision-run-edge` | no | -7 | 2273 |
| 5 | 50 | `silence-cut` | YES | 4 | 8894 |
| 6 | 57 | `silence-cut` | YES | 4 | 7235 |
| 7 | 69 | `silence-cut` | YES | 1 | 7477 |
| 8 | 79 | `silence-cut` | YES | 4 | 6594 |
| 9 | 83 | `excision-run-edge` | no | -4 | 3859 |
| 10 | 93 | `silence-cut` | YES | -20 | 3881 |
| 11 | 100 | `silence-cut` | no | — | — |
| 12 | 109 | `silence-cut` | YES | 2 | 8832 |
| 13 | 122 | `silence-cut` | YES | -2 | 11143 |
| 14 | 123 | `excision-run-edge` | no | 2 | 15745 |
| 15 | 134 | `silence-cut` | YES | -6 | 11593 |
| 16 | 147 | `silence-cut` | YES | 3 | 17701 |
| 17 | 155 | `silence-cut` | YES | 1 | 16669 |
| 18 | 163 | `silence-cut` | YES | -1 | 13211 |
| 19 | 171 | `silence-cut` | no | — | — |
| 20 | 174 | `excision-run-edge` | no | — | — |
| 21 | 187 | `silence-cut` | YES | 10 | 25027 |
| 22 | 198 | `silence-cut` | YES | 11 | 27675 |
| 23 | 208 | `silence-cut` | YES | 1 | 23503 |
| 24 | 215 | `silence-cut` | YES | -6 | 17173 |
| 25 | 222 | `excision-run-edge` | no | — | — |
| 26 | 235 | `silence-cut` | no | — | — |
| 27 | 244 | `silence-cut` | YES | 1 | 25339 |
| 28 | 254 | `silence-cut` | YES | 14 | 29372 |
| 29 | 260 | `silence-cut` | YES | -4 | 21265 |
| 30 | 264 | `excision-run-edge` | no | 1 | 25985 |
| 31 | 271 | `silence-cut` | YES | 0 | 21421 |
| 32 | 279 | `silence-cut` | YES | 14 | 26685 |
| 33 | 287 | `silence-cut` | YES | 1 | 22324 |
| 34 | 295 | `silence-cut` | no | — | — |
| 35 | 302 | `silence-cut` | YES | 1 | 17162 |
| 36 | 305 | `excision-run-edge` | no | -2 | 14614 |
| 37 | 312 | `silence-cut` | YES | 2 | 16033 |
| 38 | 319 | `silence-cut` | YES | 2 | 14520 |
| 39 | 325 | `silence-cut` | YES | 4 | 11764 |
| 40 | 335 | `silence-cut` | YES | -9 | 9265 |
| 41 | 338 | `excision-run-edge` | no | 1 | 16986 |
| 42 | 347 | `silence-cut` | YES | -3 | 11188 |
| 43 | 356 | `silence-cut` | YES | 17 | 16802 |
| 44 | 362 | `silence-cut` | YES | 2 | 7875 |
| 45 | 373 | `silence-cut` | no | — | — |
| 46 | 381 | `excision-run-edge` | no | -19 | 1895 |
| 47 | 388 | `silence-cut` | YES | -4 | 6095 |
| 48 | 394 | `silence-cut` | YES | -1 | 3561 |
| 49 | 399 | `silence-cut` | YES | 1 | 2035 |
| 50 | 405 | `silence-cut` | YES | 2 | -1423 |
| 51 | 416 | `silence-cut` | YES | 7 | 1665 |
| 52 | 421 | `silence-cut` | YES | 0 | 460 |
| 53 | 425 | `silence-cut` | YES | 3 | 372 |
| 54 | 434 | `silence-cut` | YES | 1 | -49 |
| 55 | 441 | `silence-cut` | YES | 2 | -1197 |

