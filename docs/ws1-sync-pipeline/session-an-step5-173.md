# WS1 Session AN Step 5 — 173 extension (MEASURED)

Arm H, UNCHANGED from the v6 run (no re-tuning), extended to 173. 173 carries ZERO R.5 runs, so the excision-seam machinery both arms share is structurally inert here.

## Oracle diff — A vs C vs H, 173 (173 boundaries total)

| arm | unchanged | repaired | regressed | unadjudicable | beyond ±50ms |
|---|---|---|---|---|---|
| A | 173 | 0 | **0** | 0 | **0** |
| C | 130 | 1 | **40** | 2 | **39** |
| H | 140 | 1 | **31** | 1 | **30** |

**Does 173 show an arch at all (arm C, peak abs mean decile Δ > 5.0s)? **NO**** (peak C = 3.854s, peak H = 1.988s).

## 173's two open defects, per arm

| tag | ear | A | landed(A) | C | landed(C) | H | landed(H) |
|---|---|---|---|---|---|---|---|
| `lethal_nature_hazard` | 19.27 | 18.510 | false | 19.230 | true | 19.230 | **true** |
| `gadget_decay` | 427.6 | 427.480 | false | 427.470 | false | 427.470 | **false** |

## The "6 previously unexplained 173 control regressions from arm C"

**NOT DETERMINED.** A targeted search of `docs/work-in-progress.md` and `sync-pipeline-v2-plan.md` did not turn up an explicit, unambiguous list of six specific tags under this description. The closest match found is `vessel_damage_clue` (Session AI's original 173 "control regression" set), which Sessions AJ-0/AK already resolved as a stale-bundle-provenance artifact (172.910 vs the correct 174.740), not a real edge-placement regression — so it is not part of any regression set arm H could meaningfully repair. Stated as a gap rather than a fabricated list: this sub-claim is NEITHER MEASURED NOR INFERRED this session.

