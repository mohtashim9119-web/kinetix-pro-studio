# Measurement Data Index

Raw output from completed, scored, or superseded measurement phases of the
sync-pipeline research programme (Phase 2b through Phase 4's
structural-check/scoring passes). WS1 research data — accepted findings live
in `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`; these files are the raw
numbers behind them. None of these files is read by hardcoded path in any
executable `scripts/*.py` or `scripts/*.ts` (a handful are write-only outputs
of the scripts named in their own row below — moving them only required
updating that script's write-target path, not any read path). All CSV/JSON
rows below are unchanged from their original commit, never deleted or edited.

**Restored 2026-08-15** (deleted by the 2026-08-14 WS1 doc consolidation,
`9cf5867`, then restored during that consolidation's close-out audit — CLAUDE.md
§7 asserts this file's existence as the measurements index, so deleting it was
itself a defect). The eight `.md` rows below (`d10`–`d15`, `fa-vocab-representability`,
`runtime-spike`, `runtime-unblock`) describe design/measurement memos that
**were** deleted by that consolidation and were not restored — each row is
marked below with where its conclusions now live and its git retrieval command.
Full retrieval index for all 29 files the consolidation deleted:
`docs/work-in-progress.md` §12.

For files that ARE read by hardcoded path in a test or reusable script (the
Step M golden baseline, forced-alignment ground truth, transcript-inspector
exports) see `scripts/fixtures/README.md` instead — those live in
`scripts/fixtures/`, beside the code that reads them.

| File | Phase | Date | Purpose |
|---|---|---|---|
| `v6-smear-baseline.csv` | Phase 1b/2a | 2026-08-04 | Full per-token transcript-inspector output, V6 project (447-seg, base.en model pre-Phase-2a). Cited by row number in `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`'s smear-mechanism writeups (e.g. row 1179, segment 144's displacement). |
| `173-smear-baseline.csv` | Phase 1b/2a | 2026-08-04 | Same, 173-seg project. |
| `phase2b-onset-173-turbo-dtw.csv` | Phase 2b | 2026-08-05 | Per-pause word-onset error, project 173, turbo model + DTW. Part of the measurement that led to DTW being permanently abandoned (changed timestamps by exactly 0.000000000s). |
| `phase2b-onset-173-turbo-raw.csv` | Phase 2b | 2026-08-05 | Same, turbo model without DTW (the no-DTW control). |
| `phase2b-onset-v6-turbo-dtw.csv` | Phase 2b | 2026-08-05 | Per-pause word-onset error, V6 project, turbo model + DTW. |
| `phase2b-onset-v6-turbo-raw.csv` | Phase 2b | 2026-08-05 | Same, turbo model without DTW. |
| `phase3-onset-173-hf.csv` | Phase 3 follow-up, Task 2 | 2026-08-05 | Per-pause onset error, project 173, jonatasgrosman/wav2vec2 commercial CTC model (Apache-2.0 de-risking measurement). |
| `phase3-onset-v6-hf.csv` | Phase 3 follow-up, Task 2 | 2026-08-05 | Same model, V6 project. |
| `phase3-onset-spanish-hf.csv` | Phase 3 follow-up, Task 2 | 2026-08-06 | Same model, Spanish project. |
| `phase3-onset-v6-fa-ratio.csv` | Phase 3, Blocker 2 | 2026-08-05 | V6 severity-ratio join (error, committed duration, ratio, FA confidence) against every V6 boundary scoring >250ms. |
| `phase3-onset-173-wtext.csv` | Phase 3 data-cleaning, Step 4 | 2026-08-05 | Project 173, whisper-text-mode forced alignment (alignment against Whisper's own transcript rather than the script, the drifted-audio fallback mode). |
| `phase3-onset-v6-wtext.csv` | Phase 3 data-cleaning, Step 4 | 2026-08-05 | Same, V6 project. |
| `phase3-step-c-clips-manifest.csv` | Phase 3, Step C | 2026-08-06 | Public manifest (script text only, no answer key) for the 12-clip blinded listening batch. Batch scored — see `docs/history.md`'s "Phase 3/4 Blinded Listening Protocols" archive entry. Read via a required `--batch1-manifest` CLI argument in `scripts/phase3-step-i-l-audit.py`, not a hardcoded path. |
| `phase3-step-e-stale-pause-audit.csv` | Phase 3 reference-correction, Step E | 2026-08-06 | Stale-pause selection audit against all 446 real V6 boundaries — found the selection rule correct 95% of the time. Write-only output of `scripts/phase3-stale-pause-audit.py`'s `--out-csv`. |
| `phase3-step-h-batch2-manifest.csv` | Phase 3, Step H | 2026-08-06 | Public manifest for the second, independent 20-clip V6 confirmation batch. Batch scored — same archive entry as Step C above. Read via `--batch2-manifest`, not a hardcoded path. |
| `phase3-step-i-transcript-audit.csv` | Phase 3 blinded-batch scoring, Step I | 2026-08-06 | Export-integrity audit — confirmed only clip2_11 was a genuine content mismatch (segment 320's zero-FA-token cascade), all other clips clean. |
| `phase3-step-j-batch2-scored.csv` | Phase 3 blinded-batch scoring, Step J | 2026-08-06 | Scored results for the 17 valid clips from Step H's batch, excluding clip 11. |
| `phase3-step-k-heading-sweep.csv` | Phase 3 blinded-batch scoring, Step K | 2026-08-06 | Full-transcript sweep finding all 10 of V6's unscripted chapter-heading recitations. |
| `phase3-step2-joint-context-results.csv` | Phase 3 data-cleaning, Step 2 | 2026-08-05 | Joint multi-segment-context re-measurement of the 49 remaining >250ms V6 failures after Step 1's scorer-bug fix. |
| `phase3-step2-targets-v6.json` | Phase 3 data-cleaning, Step 2 | 2026-08-05 | Target segment set for the Step 2 joint-context re-measurement. |
| `phase3-step4-script-vs-whisper.csv` | Phase 3 data-cleaning, Step 4 | 2026-08-05 | Script-text-mode vs. whisper-text-mode FA comparison on the WER/CER-verified-faithful subset. |
| `phase3-step4-wer-cer.csv` | Phase 3 data-cleaning, Step 4 | 2026-08-05 | WER/CER classification (V6/173/Spanish) establishing all three transcripts as faithful before any FA comparison. |
| `phase3-step-a-threshold-sweep.csv` | Phase 3 reference-validity, Step A | 2026-08-05 | Full per-row, per-floor threshold sweep. Write-only output of `scripts/phase3-reference-validity-step-a-sweep.py`; no other script reads it back. |
| `phase3-step-b-phoneme-bucket.csv` | Phase 3 reference-validity, Step B | 2026-08-05 | Every V6 boundary tagged by phoneme bucket. Write-only output of `scripts/phase3-reference-validity-step-b-phoneme.py`; no other script reads it back. |
| `phase4-step-q-integrity-check.csv` | Phase 4, Step Q | 2026-08-06 | Spanish blinded-clip export-integrity check. Write-only output of `scripts/phase4-step-q-spanish-clips.py`; no other script reads it back. |
| `phase4-step-q-spanish-manifest.csv` | Phase 4, Step Q | 2026-08-06 | Public manifest for the Spanish blinded-clip batch. Write-only output of `scripts/phase4-step-q-spanish-clips.py`; no other script reads it back. |
| `phase4-step-s-check-results.csv` | Phase 4, Step S | 2026-08-06 | Structural-check results (V6/173/Spanish baselines). Write-only output of `scripts/phase4-step-s-structural-checks.py`; no other script reads it back. |
| `phase4-step-u-spanish-scored.csv` | Phase 4, Step U | 2026-08-06 | Scored results for the Spanish blinded batch. Write-only output of `scripts/phase4-step-u-score-spanish.py`; no other script reads it back. |
| `runtime-spike-2026-08-11.md` | Runtime spike (Task 5 pre-work) | 2026-08-11 | **Deleted 2026-08-14** (`9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/measurements/runtime-spike-2026-08-11.md`). FA native-runtime feasibility spike: 5-language wav2vec2 load/inference (G1), uroman-vs-naive disagreement (G2), `ort`/onnxruntime version-deadlock evidence (G4), ONNX export fidelity (G5). Fed rulings R-M/R-N — conclusions survive in `docs/work-in-progress.md` §7 item 4 (R-M/R-N ratification proposal). |
| `fa-vocab-representability-2026-08-12.md` | WS1 corpus representability measurement | 2026-08-12 | **Deleted 2026-08-14** (`9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/measurements/fa-vocab-representability-2026-08-12.md`). `faTextNormalize.ts` run against real project script text (en/es) and Common Voice fallback sentences (fr/de/pt) for all five shipping vocabs — unrepresentable-word rate, reason breakdown, digit-deferral verdict for Phase 3b. Conclusions survive in `docs/work-in-progress.md` §10 (Non-English Normalizer Gap). |
| `runtime-unblock-2026-08-12.md` | Runtime unblock investigation (Task 5 pre-work) | 2026-08-12 | **Deleted 2026-08-14** (`9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/measurements/runtime-unblock-2026-08-12.md`). Follow-up to the runtime spike's G4: the `ort`/onnxruntime ≥1.27 deadlock is resolved by disabling `api-NN` Cargo features (floor drops 27→17, satisfied by the prebuilt binary) — no from-source build needed. Conclusions survive in `docs/work-in-progress.md` §7 item 4 (primary source for the R-M/R-N ratification proposal). |
| `d10-runtime-observations-2026-08-13.md` | WS1 Task 5 Slice D10 (`3787b11`) live-run findings | 2026-08-13 | **Deleted 2026-08-14** (`9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/measurements/d10-runtime-observations-2026-08-13.md`). Whole-file memory duration ladder (the finding that made windowing mandatory); FA-vs-Whisper `anchorStart` delta; `exp(score)` confidence range across e2e fixtures. Conclusions survive in `docs/work-in-progress.md` §5 (D10 row) and §6 (whole-file memory ladder table). |
| `d11-chunked-alignment-2026-08-13.md` | WS1 Task 5 Slice D11 (`eda13b1`) real-corpus measurements, produced at Slice D12's (`dda07b7`) landing pass | 2026-08-13 | **Deleted 2026-08-14** (`9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/measurements/d11-chunked-alignment-2026-08-13.md`). 240s excerpt whole-file-vs-windowed agreement table, 709s full-project memory/wall-clock, 2/97 CTC-infeasibility cases. Conclusions survive in `docs/work-in-progress.md` §5 (D11 row) and §6 (attribution isolation paragraph). |
| `d13-index-attribution-2026-08-13.md` | WS1 Task 5 Slice D13 real-corpus measurements | 2026-08-13 | **Deleted 2026-08-14** (`9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/measurements/d13-index-attribution-2026-08-13.md`). Whether index-derived text attribution reaches D12's oracle bound; B-control; a real coalescing bug caught and fixed. Conclusions survive in `docs/work-in-progress.md` §5 (D13 row) and §6 (attribution isolation, CTC-infeasibility paragraphs). |
| `d14-measurement-closure-2026-08-13.md` | WS1 Task 5 Slice D14 (Track A) real-corpus measurement closure | 2026-08-13 | **Deleted 2026-08-14** (`9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/measurements/d14-measurement-closure-2026-08-13.md`). Verifies D13's Whisper-triage coincidence directly; adds `B-control-45s`; weak per-chunk correlation (r≤0.24). Conclusions survive in `docs/work-in-progress.md` §5 (D14 row). |
| `d15-mis-assignment-diagnostic-2026-08-13.md` | WS1 Task 5 Slice D15 (Track A) real-corpus diagnostic, no ONNX run | 2026-08-13 | **Deleted 2026-08-14** (`9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/measurements/d15-mis-assignment-diagnostic-2026-08-13.md`). Direct word-by-word mis-assignment diagnostic: 5/569 words (0.9%) mis-assigned at 45s, carrying the entire START/END max error. Conclusions survive in `docs/work-in-progress.md` §5 (D15 row) and §6 (mis-assignment diagnostic paragraph). |

## Whole-file-agreement proxy — RETIRED (WS1 Task 5 Slice D16, 2026-08-13)

The **whole-file-agreement proxy** (scoring a windowed/chunked attribution
rule by its agreement against the whole-file FA reference — the metric every
row in D12-D15's combined tables above is expressed against) is retired for
any future work aimed at *improving* reference agreement specifically. Not
because it reached zero — because it has **saturated against real,
independent ground truth**: D13's own Whisper-triage finding (re-verified
directly by D14 §A1) already showed index-45s is statistically
indistinguishable from the whole-file reference itself when both are checked
against Whisper (p90 0.70s vs. 0.72s, p99 identical at 1.02s, max identical
at 1.20s, start side). D16's own A1 traced the residual gap the proxy still
reports (5/569 words at 45s, 0.76s max) to its root cause and found it is
**Whisper-token-timestamp-intrinsic** — see
`docs/work-in-progress.md` §5's D16 row (`task5-slice-ledger.md`, its original
source, was deleted 2026-08-14, `9cf5867`; retrieve: `git show
251be64:docs/ws1-sync-pipeline/task5-slice-ledger.md`) for the full word-level
trace. Squeezing index-45s's reference
agreement further toward B-control-45s's 0.30s oracle floor would not be
observable by any real consumer, because the metric being optimized has
already saturated at a level the reference's own Whisper-agreement cannot
resolve past.

**The 0.3s figure quoted throughout D15's combined table is B-control-45s's
own oracle floor — provisional, and not a CI gate.** It is a headroom
number (what a perfect-text-attribution rule would still cost at this window
size), not a pass/fail threshold; no owner sign-off has made it one, and it
is not wired to any test or CI check.

Further agreement work should target something with finer discriminating
power than Whisper timestamps (independently hand-labeled word boundaries,
or direct perceptual testing once a real per-word timing consumer exists —
see `docs/work-in-progress.md` §7 item 2 (`task5-integration-scope.md`, its
original source, was deleted 2026-08-14, `9cf5867`; retrieve: `git show
251be64:docs/ws1-sync-pipeline/task5-integration-scope.md`)) — not tighter
fitting against the whole-file reference used above.

## Rescued data

One exception to "nothing here was deleted or edited": `rescued-2026-08-07-model-p-park/` was never previously committed anywhere reachable from `main`. It's a byte-for-byte preservation copy, pulled 2026-08-11 from the orphaned, unmerged branch `wip/preserve-2026-08-07` (commit `79f779523a35920320ce0f791415d9783e493197`) before that branch could be pruned with no other copy of its data existing. See the folder's own `PROVENANCE.md` for the full per-file manifest and byte-identity verification; indexed here at folder grain only.

| Folder | Phase | Date | Purpose |
|---|---|---|---|
| `rescued-2026-08-07-model-p-park/answer-keys/` | Phase 4, Step Q | data 2026-08-06, rescued 2026-08-11 | Spanish blinded-listening ground truth (10-clip answer key + human transcripts). |
| `rescued-2026-08-07-model-p-park/listening-clips/spanish-batch/` | Phase 4, Step Q | data 2026-08-06, rescued 2026-08-11 | The 10 Spanish `.wav` clips those answer keys score. |
| `rescued-2026-08-07-model-p-park/work-phase4/replay/{173,spanish,v6}/` | Phase 4, Step M | data 2026-08-07, rescued 2026-08-11 | Golden-baseline replay snapshots (segments, silences, transcript tokens, audio) + Task 5 boundary-audit reports for the three real corpus projects. |
| `rescued-2026-08-07-model-p-park/work-phase4/` (root files + `step-x-clips/`) | Phase 4, Steps U/W/X/AA | data 2026-08-06/07, rescued 2026-08-11 | Spanish breath-aware reference + 22-pause targets (cited by the Spanish gate scoring — see `docs/work-in-progress.md` §6, "Spanish language gate"; original source `spanish-gate-scoring.md` was deleted 2026-08-14, `9cf5867`, retrieve: `git show 251be64:docs/ws1-sync-pipeline/spanish-gate-scoring.md`); K13/K14 live-repro evidence; 5 named structural-check audio clips (C02–C10). |
