# Spanish Gate — Owner's Ear, 10 Blinded Clips

Dated: 2026-08-10. Attributed to: the owner's ear (verbatim as supplied to the assistant).

Clip 1:  Seg A end 01.003s | Breath: inaudible/N-A            | Seg B start 01.742s
Clip 2:  Seg A end 01.050s | Breath: 01.571s - 01.758s        | Seg B start 01.837s
Clip 3:  Seg A end 00.999s | Breath: 01.652s - 01.804s        | Seg B start 01.902s
Clip 4:  Seg A end 01.002s | Breath: inaudible/N-A            | Seg B start 01.744s
Clip 5:  Seg A end 00.996s | Breath: inaudible/N-A            | Seg B start 01.293s
Clip 6:  Seg A end 00.722s | Breath: 01.242s - 01.336s        | Seg B start 01.425s
Clip 7:  Seg A end 00.986s | Breath: 01.211s - 01.423s        | Seg B start 01.543s
Clip 8:  Seg A end 00.926s | Breath: 01.227s - 01.375s        | Seg B start 01.440s
Clip 9:  Seg A end 01.012s | Breath: 01.240s - 01.433s        | Seg B start 01.485s
Clip 10: Seg A end 01.002s | Breath: 01.253s - 01.396s        | Seg B start 01.452s

## Computed table (Part 1D)

All times clip-local seconds (owner's labels) / absolute seconds (FA, from `.answer-keys/step_q_answer_key.json`, recovered read-only via `git show 79f7795:.answer-keys/step_q_answer_key.json`). FA err = FA onset − human B onset, signed, ms (positive = late). Source of true-onset and FA columns: `docs/ws1-sync-pipeline/measurements/phase4-step-u-spanish-scored.csv` (already committed on `main`), cross-checked field-by-field against the owner's clip-local labels above (all 10 `b_start` values match to the millisecond).

| Clip | Kind | True onset (human B, abs s) | FA predicted onset (abs s) | Signed error (ms) |
|---|---|---|---|---|
| clip3_01 | control | 45.293 | 45.322 | +29 |
| clip3_02 | failure | 27.962 | 27.982 | +20 |
| clip3_03 | failure | 65.579 | 65.622 | +43 |
| clip3_04 | failure | 84.332 | 84.371 | +39 |
| clip3_05 | control | 17.417 | 17.431 | +14 |
| clip3_06 | failure | 1.425 | 0.341 | −1084 |
| clip3_07 | control | 20.170 | 20.152 | −18 |
| clip3_08 | failure | 34.467 | 34.490 | +23 |
| clip3_09 | failure | 6.308 | 6.292 | −16 |
| clip3_10 | failure | 13.125 | 13.152 | +27 |

10-clip sample (deliberately oversampled toward failures — not the gate population): mean |err| 131.4ms, median |err| 25.1ms, p95 |err| 615.7ms, max |err| 1084.0ms. Excluding clip3_06 (named, structural, corpus-start case): median 22.8ms, max 43.4ms.

Corpus-wide gate figures (all 22 scored Spanish pauses, independently recomputed from `scripts/fixtures/phase3-onset-spanish-fa.csv` and the breath-aware reference recovered via `git show 79f7795:.work-phase4/spanish-breath-ref.json`):

| Reference | median | p95 | max | rows >250ms | vs 250ms gate |
|---|---|---|---|---|---|
| raw `silencedetect` | 61.2ms | 282.1ms | 1085.1ms | 2 of 22 | FAIL |
| Step F breath-aware | 30.3ms | 50.4ms | 1183.7ms | 1 of 22 | PASS |
