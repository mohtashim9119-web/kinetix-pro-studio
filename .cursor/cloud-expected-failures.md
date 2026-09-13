# Cloud expected failures — `ws3-export-modal` @ `f81674e`

Authoritative freeze of the cloud `npm test` failure set. A later green
cloud run is judged against **35 failed tests + 1 non-loading suite**,
**not 38**. Group C (ffmpeg sidecar) is skip, not fail.

Nothing in this file is a local-machine expectation. Local baseline remains
3638 passed / 0 failed / 78 skipped = 3716 (operator machine, private corpus
and `.work-phase4/replay/` present).

## Two-run proof (deterministic)

Both runs: full `npm test`, Node v22.22.2, working tree `f81674e`, no rebase
onto storage work.

| | Totals | Start | Duration |
|---|---|---|---|
| Run 1 | 3630 passed / **35 failed** / 78 skipped = 3743 | 12:35:43 | 98.70s |
| Run 2 | 3630 passed / **35 failed** / 78 skipped = 3743 | 12:37:34 | 98.29s |

Test-file rollup, both runs: 13 failed / 203 passed / 63 skipped (279).

**Failure-name diff (run 1 vs run 2): empty.**  
**Suite-name diff (run 1 vs run 2): empty.**  
**Cloud flakes: none.** No test flipped between pass/fail/skip.

The 35 `FAIL` lines and the 1 non-loading suite name are byte-identical
across the two runs. Verbatim names are the lists below.

## Corrected census vs PR #9

PR #9 (`cursor/setup-dev-environment-01d8`) claimed the cloud reds were
**35 ENOENT private-corpus failures**. That was extrapolated from a stale
base, not measured on `fd547ce` / `f81674e`. Measured split on this tip:

| Group | Count | Kind | Cause |
|---|---|---|---|
| A | **9** failed tests | fail | private corpus at `/Users/mohtashim/Downloads/All Projects Test Data/...` |
| B | **26** failed tests + **1** non-loading suite | fail / suite | gitignored `.work-phase4/replay/` live-fidelity bundles |
| C | **0** failed tests | **skip, not fail** | gitignored `src-tauri/binaries/` ffmpeg sidecar |

9 + 26 = 35 failed tests. Plus `scripts/ws1-session-p-arms.test.ts`, which
never registers cases (`ENOENT` `.work-phase4/replay/v6/whisper_raw_tokens.json`).

**Group C is skip, not fail.** Tests that would exec
`src-tauri/binaries/ffmpeg-x86_64-apple-darwin` do not fail on this VM:

- `scripts/ws3-clean-path-artifact.test.ts` — 1 skipped (needs `WS3_ARTIFACT_DIR`)
- `scripts/ws1-session-s-measure.test.ts` — 2 skipped of 4 (heavy arm needs
  `WS1_SESSION_S_MEASURE=1`); the **2 failures** in that file are Group B
  (unstamped replay bundle), not sidecar

Do not add those skips to the expected-failure count. A future green cloud
gate means the 35 names + 1 suite below are gone **and** no new failure has
appeared. It does **not** mean 38 items went away.

## Group A — 9 — private corpus

ENOENT on the operator's local project files (not in the repo).

```
scripts/phase4-handoff-replay-sync.test.ts > Phase 3->4 handoff Step M — golden baseline replay > replays the shipped Apply-Sync pipeline for v6
scripts/phase4-handoff-replay-sync.test.ts > Phase 3->4 handoff Step M — golden baseline replay > replays the shipped Apply-Sync pipeline for 173
scripts/phase4-handoff-replay-sync.test.ts > Phase 3->4 handoff Step M — golden baseline replay > replays the shipped Apply-Sync pipeline for spanish
scripts/phase4-step-w-k13-repro.test.ts > K13 — lock preservation across Apply Sync (LIVE regression guard, production code) > PART 1 — preserveSegmentLocks restores a lock parseProjectData itself never carries
scripts/phase4-step-w-k13-repro.test.ts > K13 — lock preservation across Apply Sync (LIVE regression guard, production code) > PART 3 — writes the C11 evidence artifact for the Step X harness
scripts/ws2-27-absorption-numbering.test.ts > WS2 ws2-27 — Clip-N off-by-one fix, real corpora > v6 S27, S28, S29 — all three name the same host, Clip 27, jump resolves to 030_watching_older_hunters
scripts/ws2-27-absorption-numbering.test.ts > WS2 ws2-27 — Clip-N off-by-one fix, real corpora > 173 S1 (leading run) — S-number is 1, Clip 1, byte-identical to the pre-fix behaviour
scripts/ws2-27-absorption-numbering.test.ts > WS2 ws2-27 — Clip-N off-by-one fix, real corpora > 173 S13 — mid-script, with an unrelated upstream drop at S1: moves from Clip 11 (pre-fix) to Clip 12, jump resolves to eternal_focus
scripts/ws2-27-absorption-numbering.test.ts > WS2 ws2-27 — Clip-N off-by-one fix, real corpora > 173 S112 — moves from Clip 109 (pre-fix) to Clip 110, jump resolves to shirking_foundation, notes Clip 109's 0.63s
```

K13 PART 3 is a cascade of PART 1 (`record.part1` undefined because PART 1
never ran). Still a distinct `FAIL` line; it counts as one of the 9.

## Group B — 26 tests + 1 suite — gitignored `.work-phase4/replay/`

Regenerate locally: `python3 scripts/phase4-restore-replay-inputs.py`.

### Non-loading suite (both runs)

```
scripts/ws1-session-p-arms.test.ts
```

ENOENT `.work-phase4/replay/v6/whisper_raw_tokens.json`. Vitest reports this
as a failed suite, not as one of the 35 tests.

### Failed tests (26)

```
scripts/ws1-production-path.test.ts > WS1 production path — v6, FA ON (R-AO gate) > reproduces the live run shape: 447 parsed, 447 kept, 0 skipped
scripts/ws1-production-path.test.ts > WS1 production path — v6, FA ON (R-AO gate) > R-AO: every registry rule has an observable firing count on the production path
scripts/ws1-production-path.test.ts > WS1 production path — v6, FA ON (R-AO gate) > commits R.11 ear-correct boundaries, not the pre-fix register values
scripts/ws1-production-path.test.ts > WS1 production path — v6, FA ON (R-AO gate) > commits no boundary strictly inside an unscripted run (R.12 invariant, end to end)
scripts/ws1-production-path.test.ts > WS1 production path — v6, FA ON (R-AO gate) > preserves Model P: gapless partition and total duration
scripts/ws1-session-aj0-oracle-diff.test.ts > AJ-0 oracle diff (reporting only) — v6 > diffs the production path at HEAD against the ear-verified live export
scripts/ws1-session-aj0-oracle-diff.test.ts > AJ-0 oracle diff (reporting only) — 173 > diffs the production path at HEAD against the ear-verified live export
scripts/ws1-session-aj0-oracle-diff.test.ts > AJ-0 oracle diff (reporting only) — spanish > diffs the production path at HEAD against the ear-verified live export
scripts/ws1-session-p-invariants.test.ts > WS1 Session P — production invariants (v6 live bundle) > R.12 invariant: no committed boundary lies strictly inside an unscripted run
scripts/ws1-session-p-invariants.test.ts > WS1 Session P — production invariants (v6 live bundle) > strict monotonic ordering across every committed boundary
scripts/ws1-session-p-measure.test.ts > WS1 Session P — live-fidelity production path (measurement) > STEP 2 — reproduces the live run with raw tokens + native silences
scripts/ws1-session-q-invariants.test.ts > WS1 Session Q — R.13 production invariant (v6 live bundle) > R.13 invariant: no run-carrying segment is closed before its own utterance ends
scripts/ws1-session-q-production-pins.test.ts > WS1 Session Q/S — production-path pin set (R-AO / R-AM, live-fidelity bundle) > R.12: the SEVEN ear-verified corrected boundaries (WS1 Session T)
scripts/ws1-session-q-production-pins.test.ts > WS1 Session Q/S — production-path pin set (R-AO / R-AM, live-fidelity bundle) > R.12 fires EIGHT times on the live v6 bundle after Session S's run-edge exclusion
scripts/ws1-session-q-production-pins.test.ts > WS1 Session Q/S — production-path pin set (R-AO / R-AM, live-fidelity bundle) > L7: 266_forty_one_burden — EAR-VERIFIED at 788.75 (WS1 Session V closes the follow-up A/B)
scripts/ws1-session-q-production-pins.test.ts > WS1 Session Q/S — production-path pin set (R-AO / R-AM, live-fidelity bundle) > R.11's remaining five firings: two ear-verified, three change detectors
scripts/ws1-session-s-exclusion.test.ts > WS1 Session S — R-AP on the live v6 bundle (R-AO) > R.11 proposes SIX and keeps FIVE; the one declined is 266_forty_one_burden, whose ORIGIN is inside run 6
scripts/ws1-session-s-exclusion.test.ts > WS1 Session S — R-AP on the live v6 bundle (R-AO) > R.11's other five firings are UNCHANGED in tag and value
scripts/ws1-session-s-exclusion.test.ts > WS1 Session S — R-AP on the live v6 bundle (R-AO) > R.12 now fires EIGHT, and its eighth row commits 266_forty_one_burden at 788.75 (WS1 Session T)
scripts/ws1-session-s-exclusion.test.ts > WS1 Session S — R-AP on the live v6 bundle (R-AO) > AT REST: the shipped stage produces ZERO R-AP violations on all three corpora
scripts/ws1-session-s-exclusion.test.ts > WS1 Session S — R-AP on the live v6 bundle (R-AO) > RED BEFORE, executed: the pre-Session-S stage (all six R.11 findings applied) violates R-AP exactly once
scripts/ws1-session-s-exclusion.test.ts > WS1 Session S — R-AP on the live v6 bundle (R-AO) > MUTUAL EXCLUSION, measured: R.11's kept set and R.12's finding set are disjoint by construction
scripts/ws1-session-s-measure.test.ts > WS1 Session S — Step 2/3 structural picture of R.12's seven rows > writes the seven rows' structural descriptors, and separates the two passing rows by clamping
scripts/ws1-session-s-measure.test.ts > WS1 Session S — Step 2/3 structural picture of R.12's seven rows > WS1 Session T: the shipped correctedValue now matches all six ear-verify-t targets
scripts/ws1-silence-arms.test.ts > WS1 Session P — silence arms > 16 kHz arm: the scan reproduces all 547 committed entries value for value
scripts/ws1-silence-arms.test.ts > WS1 Session P — silence arms > native arm exists, is the live-fidelity shape, and is NOT the 16 kHz arm
```

## Group C — 0 fails — ffmpeg sidecar (skip)

No failed test reached `src-tauri/binaries/ffmpeg-*`. The sidecar is absent
on this VM (gitignored). Absence shows up as skip under env gates, not as
a `FAIL` line. Those skips are **not** part of the 35.

## How to judge a later cloud `npm test`

The **expected-failure set** is 35 failed tests + 1 non-loading suite, with
the names above. The **passed** count is not frozen: this branch may add
passing tests (see the collection reconciliation below). A later cloud run
that still has those 35 names and that suite, and no extra `FAIL`, matches
the gate even if `passed` is above 3630.

Regression: any extra `FAIL`, any missing name from the 35, any additional
failed suite, or a flake (a name that is not in both runs).

Not a regression: the Group C skips staying skipped; `passed` rising because
new tests on this branch go green.

## Collection-count reconciliation (3743 vs 3716)

Local baseline on `fd547ce`: **3716** collected (3638 passed / 0 failed / 78
skipped). Cloud on this branch at `cf3745f`: **3743** collected (3630 passed
/ 35 failed / 78 skipped). Difference: **+27**.

Counted with `npx vitest list` on this tree, not assumed.

### This branch adds 28 tests in 3 files (all new vs `fd547ce`)

| File | Tests | What they are |
|---|---|---|
| `src/components/ExportSettingsModal.test.tsx` | 10 | modal UI (bitrate default, Browse, size badge, free-space disable, commit/cancel) |
| `src/services/exportOutputEstimate.test.ts` | 10 | size-estimator arithmetic on this branch (not the modal component) |
| `src/services/exportTargetFs.test.ts` | 8 | path helpers + the thin fake used by the modal |

`git diff --name-only fd547ce HEAD -- '*.test.ts' '*.test.tsx'` is exactly
those three files. No other test file was added.

The 10 estimator tests are this branch's work, not an unrelated cloud-only
suite. They are not the modal UI; they are still Prompt 35 files, not a
fourth source.

### Cloud does not collect 1 test that local `fd547ce` does

`scripts/ws1-session-p-arms.test.ts` declares one test (`sweeps input arms`).
On a machine with `.work-phase4/replay/v6/` it loads and is part of the 3716.
In cloud, top-level `readFileSync` of `whisper_raw_tokens.json` throws before
`describe` registers, so `vitest list` returns **0** tests for that file (the
non-loading suite). That is **−1** vs local `fd547ce`, not a new test.

### Arithmetic

```
3716  (local fd547ce)
 + 10  ExportSettingsModal.test.tsx
 + 10  exportOutputEstimate.test.ts
 +  8  exportTargetFs.test.ts
 −  1  ws1-session-p-arms.test.ts not collected in cloud
 = 3743
```

No cloud-collected test exists for a reason other than this branch's three
new files. The only collection *gap* vs local `fd547ce` is `p-arms`.

### This commit (prompt-37 fake) — not part of the 27

`src/services/exportTargetFsFake.contract.test.ts` adds **8** passing
contract tests against an in-memory fake. They were not in the `cf3745f`
census. Next cloud collected = **3751** (3743 + 8). Failure set unchanged
(35 + 1 suite). Passed rises from 3630 to 3638.

